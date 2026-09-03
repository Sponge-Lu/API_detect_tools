import * as http from 'http';
const TEST_PORT = 39217;
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../main/utils/logger', () => {
  const stub = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    scope: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
  return { default: stub, Logger: stub };
});
vi.mock('../main/route-health-service', () => ({
  startHealthCheckTimer: vi.fn(),
  stopHealthCheckTimer: vi.fn(),
}));
vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: {
    getRoutingConfig: vi.fn(() => ({
      server: { enabled: true, host: '127.0.0.1', port: TEST_PORT, unifiedApiKey: 'sk-route' },
    })),
  },
}));

import { getProxyStatus, startProxyServer, stopProxyServer } from '../main/route-proxy-service';
import { DEFAULT_ROUTE_PROXY_SERVER_CONFIG } from '../shared/types/route-proxy';
import { unifiedConfigManager } from '../main/unified-config-manager';

function requestOver(agent: http.Agent, port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: '/v1/messages', method: 'POST', agent },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    request.on('error', reject);
    request.end('{}');
  });
}

afterEach(async () => {
  await stopProxyServer();
});

describe('route proxy default enablement', () => {
  it('defaults to enabled so a restart keeps forwarding through the local route', () => {
    // 默认关闭会让 CLI 的请求绕过本地路由直连上游，规则、故障转移、统计全部失效
    expect(DEFAULT_ROUTE_PROXY_SERVER_CONFIG.enabled).toBe(true);
  });
});

describe('route proxy stop actually stops serving', () => {
  it('reports the running state through getProxyStatus', async () => {
    expect(getProxyStatus().running).toBe(false);
    await startProxyServer();
    expect(getProxyStatus().running).toBe(true);
    await stopProxyServer();
    expect(getProxyStatus().running).toBe(false);
  });

  it('refuses requests arriving on a kept-alive connection after stop', async () => {
    vi.mocked(unifiedConfigManager.getRoutingConfig).mockReturnValue({
      server: { enabled: true, host: '127.0.0.1', port: TEST_PORT, unifiedApiKey: 'sk-route' },
    } as never);

    await startProxyServer();
    const port = TEST_PORT;
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

    // 先建立一条 keep-alive 连接，模拟正在使用的 CLI
    const first = await requestOver(agent, port);
    expect(first.status).not.toBe(0);

    await stopProxyServer();
    expect(getProxyStatus().running).toBe(false);

    // 停止后同一条连接上的后续请求必须失败或被明确拒绝，绝不能继续转发上游
    let refused = false;
    try {
      const second = await requestOver(agent, port);
      refused = second.status === 503 && second.body.includes('route_proxy_stopped');
    } catch {
      refused = true; // 连接已被切断
    }
    agent.destroy();

    expect(refused).toBe(true);
  });

  it('resolves instead of hanging when a keep-alive connection is still open', async () => {
    await startProxyServer();
    const port = TEST_PORT;
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    await requestOver(agent, port);

    // server.close() 的回调要等所有连接排空；不切断存量连接就会永久挂起
    await expect(
      Promise.race([
        stopProxyServer().then(() => 'stopped'),
        new Promise(resolve => setTimeout(() => resolve('timeout'), 3000)),
      ])
    ).resolves.toBe('stopped');

    agent.destroy();
  });
});
