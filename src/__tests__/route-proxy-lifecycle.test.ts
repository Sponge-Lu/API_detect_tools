import * as http from 'http';
const TEST_PORT = 39217;
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: {
    mutateConfig: async <T>(operation: () => Promise<T>) => operation(),
    getRoutingConfig: vi.fn(() => ({
      server: { enabled: true, host: '127.0.0.1', port: TEST_PORT, unifiedApiKey: 'sk-route' },
    })),
  },
}));

import {
  getProxyStatus,
  initializeRouteProxy,
  startProxyServer,
  stopProxyServer,
} from '../main/route-proxy-service';
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

beforeEach(() => {
  vi.spyOn(http.Server.prototype, 'listen');
  vi.mocked(unifiedConfigManager.getRoutingConfig).mockReturnValue({
    server: { enabled: true, host: '127.0.0.1', port: TEST_PORT, unifiedApiKey: 'sk-route' },
  } as never);
});

afterEach(async () => {
  await stopProxyServer();
  for (const server of vi.mocked(http.Server.prototype.listen).mock.contexts) {
    if (server.listening) {
      await new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
  }
  vi.mocked(http.Server.prototype.listen).mockRestore();
});

describe('route proxy default enablement', () => {
  it('defaults to disabled until the user explicitly starts the local route', () => {
    expect(DEFAULT_ROUTE_PROXY_SERVER_CONFIG.enabled).toBe(false);
  });

  it('does not create a listener during initialization when disabled', async () => {
    vi.mocked(unifiedConfigManager.getRoutingConfig).mockReturnValue({
      server: { enabled: false, host: '127.0.0.1', port: TEST_PORT, unifiedApiKey: 'sk-route' },
    } as never);

    await initializeRouteProxy();

    expect(http.Server.prototype.listen).not.toHaveBeenCalled();
    expect(getProxyStatus().running).toBe(false);
  });
});

describe('route proxy stop actually stops serving', () => {
  it('finishes stopping when stop is requested while the listener is starting', async () => {
    const starting = startProxyServer();
    const stopping = stopProxyServer();
    await Promise.all([starting, stopping]);

    expect(getProxyStatus().running).toBe(false);
    await expect(requestOver(new http.Agent({ keepAlive: false }), TEST_PORT)).rejects.toThrow();
  });

  it('shares one listener when concurrent callers request startup', async () => {
    await expect(Promise.all([startProxyServer(), startProxyServer()])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(http.Server.prototype.listen).toHaveBeenCalledTimes(1);
    expect(getProxyStatus().running).toBe(true);
  });

  it('keeps the final requested state when start, stop and restart overlap', async () => {
    await Promise.all([startProxyServer(), stopProxyServer(), startProxyServer()]);
    expect(getProxyStatus().running).toBe(true);
    const agent = new http.Agent({ keepAlive: false });
    try {
      const response = await requestOver(agent, TEST_PORT);
      expect(response.status).not.toBe(503);
      expect(response.body).not.toContain('route_proxy_stopped');
    } finally {
      agent.destroy();
    }
  });

  it('can start again after a port conflict without leaving a failed listener behind', async () => {
    const blocker = http.createServer();
    await new Promise<void>(resolve => blocker.listen(TEST_PORT, '127.0.0.1', resolve));
    try {
      await expect(startProxyServer()).rejects.toThrow('port conflict');
      expect(getProxyStatus().running).toBe(false);
    } finally {
      await new Promise<void>(resolve => blocker.close(() => resolve()));
    }

    await startProxyServer();
    expect(getProxyStatus().running).toBe(true);
  });

  it('reports the running state through getProxyStatus', async () => {
    expect(getProxyStatus().running).toBe(false);
    await startProxyServer();
    expect(getProxyStatus().running).toBe(true);
    await stopProxyServer();
    expect(getProxyStatus().running).toBe(false);
  });

  it('refuses requests as soon as the persisted server switch is disabled', async () => {
    await startProxyServer();
    vi.mocked(unifiedConfigManager.getRoutingConfig).mockReturnValue({
      server: { enabled: false, host: '127.0.0.1', port: TEST_PORT, unifiedApiKey: 'sk-route' },
    } as never);

    const agent = new http.Agent({ keepAlive: false });
    try {
      const response = await requestOver(agent, TEST_PORT);
      expect(response.status).toBe(503);
      expect(response.body).toContain('route_proxy_stopped');
    } finally {
      agent.destroy();
    }
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
