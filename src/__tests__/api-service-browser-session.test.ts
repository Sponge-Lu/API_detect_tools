/**
 * 输入: ApiService、受 Bot/Cloudflare 保护的响应、浏览器会话传输模拟
 * 输出: 主进程浏览器会话回退与认证错误分流的回归测试
 * 定位: 测试层 - 验证站点检测不依赖页面内 fetch
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - src/__tests__/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

interface LoadOptions {
  httpGetResult?: any;
  httpPostResult?: any;
}

async function loadApiService(options: LoadOptions = {}) {
  vi.resetModules();

  const httpGet = vi.fn(async () => options.httpGetResult);
  const httpPost = vi.fn(async () => options.httpPostResult);

  vi.doMock('../main/utils/http-client', () => ({ httpGet, httpPost }));
  vi.doMock('../main/utils/request-manager', () => ({
    requestManager: {
      request: vi.fn(async (_key: string, fetcher: () => Promise<any>) => fetcher()),
    },
    RequestManager: class RequestManager {
      static key(...parts: Array<string | number>) {
        return parts.join(':');
      }
    },
  }));
  vi.doMock('../main/utils/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  vi.doMock('../main/unified-config-manager', () => ({
    unifiedConfigManager: {
      getSiteByUrl: vi.fn(),
      getSiteById: vi.fn(),
      getAccountById: vi.fn(),
    },
  }));
  vi.doMock('../main/overview-service', () => ({
    captureSiteDailySnapshot: vi.fn(async () => undefined),
  }));
  vi.doMock('../main/site-type-detector', () => ({
    detectSiteType: vi.fn(async () => ({ siteType: 'newapi', detectionMethod: 'fallback' })),
  }));

  return { ...(await import('../main/api-service')), httpGet, httpPost };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('ApiService browser-session fallback', () => {
  it('普通 JSON 成功响应不应启动浏览器', async () => {
    const { ApiService } = await loadApiService({
      httpGetResult: { status: 200, data: { success: true, data: ['model-a'] } },
    });
    const chromeManager = {
      createPage: vi.fn(),
      requestWithBrowserSession: vi.fn(),
    };
    const service = new ApiService({ chromeManager } as any);

    const result = await (service as any).fetchWithBrowserFallback(
      'https://plain.example.com/api/user/models',
      { Authorization: 'Bearer durable-token' },
      {
        id: 'site-1',
        name: 'Plain Site',
        url: 'https://plain.example.com',
        site_type: 'newapi',
        user_id: '7',
        system_token: 'durable-token',
      },
      15,
      (data: any) => data.data
    );

    expect(result.result).toEqual(['model-a']);
    expect(chromeManager.createPage).not.toHaveBeenCalled();
    expect(chromeManager.requestWithBrowserSession).not.toHaveBeenCalled();
  });

  it('Bot HTML 后应使用主进程浏览器会话请求，并保留页面和释放函数', async () => {
    const { ApiService } = await loadApiService({
      httpGetResult: {
        status: 200,
        data: '<!doctype html><html><title>Just a moment...</title></html>',
      },
    });
    const page = {
      isClosed: vi.fn(() => false),
      evaluate: vi.fn(() => {
        throw new Error('page-context fetch must not be used');
      }),
    };
    const release = vi.fn();
    const requestWithBrowserSession = vi.fn(async () => ({
      status: 200,
      statusText: 'OK',
      text: '{"success":true,"data":[{"id":"gpt-4o-mini"}]}',
    }));
    const chromeManager = {
      createPage: vi.fn(async () => ({ page, release })),
      requestWithBrowserSession,
    };
    const service = new ApiService({ chromeManager } as any);
    vi.spyOn(service as any, 'waitForCloudflareChallenge').mockResolvedValue(undefined);

    const result = await (service as any).fetchWithBrowserFallback(
      'https://chy.example.com/api/user/models',
      { Authorization: 'Bearer durable-token' },
      {
        id: 'site-1',
        name: 'CHY',
        url: 'https://chy.example.com',
        site_type: 'newapi',
        user_id: '7',
        system_token: 'durable-token',
      },
      15,
      (data: any) => data.data.map((item: any) => item.id),
      undefined,
      undefined,
      undefined,
      { browserSlot: 2 }
    );

    expect(result.result).toEqual(['gpt-4o-mini']);
    expect(result.page).toBe(page);
    expect(result.pageRelease).toBe(release);
    expect(chromeManager.createPage).toHaveBeenCalledWith('https://chy.example.com', { slot: 2 });
    expect(requestWithBrowserSession).toHaveBeenCalledWith(
      page,
      'https://chy.example.com/api/user/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer durable-token',
          'New-API-User': '7',
        }),
        allowNodeFallback: false,
      })
    );
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('浏览器会话仍返回挑战页时只重试一次，并透传 POST body', async () => {
    const { ApiService } = await loadApiService({
      httpPostResult: {
        status: 403,
        data: '<html><title>Just a moment...</title></html>',
        headers: { 'cf-mitigated': 'challenge' },
      },
    });
    const page = { isClosed: vi.fn(() => false) };
    const release = vi.fn();
    const requestWithBrowserSession = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        text: '<html>checking your browser</html>',
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        text: '{"success":true,"data":{"ok":true}}',
      });
    const chromeManager = {
      createPage: vi.fn(async () => ({ page, release })),
      requestWithBrowserSession,
    };
    const service = new ApiService({ chromeManager } as any);
    const waitForChallenge = vi
      .spyOn(service as any, 'waitForCloudflareChallenge')
      .mockResolvedValue(undefined);

    const result = await (service as any).fetchWithBrowserFallback(
      'https://chy.example.com/api/refresh',
      { Authorization: 'Bearer durable-token', 'Content-Type': 'application/json' },
      {
        id: 'site-1',
        name: 'CHY',
        url: 'https://chy.example.com',
        site_type: 'newapi',
        user_id: '7',
        system_token: 'durable-token',
      },
      15,
      (data: any) => data.data,
      undefined,
      undefined,
      { method: 'POST', data: { refresh: true } }
    );

    expect(result.result).toEqual({ ok: true });
    expect(requestWithBrowserSession).toHaveBeenCalledTimes(2);
    expect(requestWithBrowserSession).toHaveBeenCalledWith(
      page,
      'https://chy.example.com/api/refresh',
      expect.objectContaining({
        method: 'POST',
        body: '{"refresh":true}',
        allowNodeFallback: false,
      })
    );
    expect(waitForChallenge).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])('JSON HTTP %s 不应误入 Cloudflare 浏览器回退', async status => {
    const { ApiService } = await loadApiService({
      httpPostResult: { status, data: { success: false, message: 'Unauthorized' } },
    });
    const chromeManager = {
      createPage: vi.fn(),
      requestWithBrowserSession: vi.fn(),
    };
    const service = new ApiService({ chromeManager } as any);

    await expect(
      (service as any).fetchWithBrowserFallback(
        'https://chy.example.com/api/refresh',
        { Authorization: 'Bearer expired-token' },
        {
          id: 'site-1',
          name: 'CHY',
          url: 'https://chy.example.com',
          site_type: 'newapi',
          user_id: '7',
          system_token: 'expired-token',
        },
        15,
        (data: any) => data,
        undefined,
        undefined,
        { method: 'POST', data: {} }
      )
    ).rejects.toMatchObject({ response: { status } });
    expect(chromeManager.createPage).not.toHaveBeenCalled();
    expect(chromeManager.requestWithBrowserSession).not.toHaveBeenCalled();
  });
});
