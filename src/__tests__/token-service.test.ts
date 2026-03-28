/**
 * 输入: TokenService / ApiService 的最小模拟依赖、API Key 创建/缓存场景
 * 输出: API Key 原始值保留回归测试结果
 * 定位: 测试层 - 验证创建后和持久化时不会把原始 API Key 覆盖成脱敏值
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - src/__tests__/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadTokenServiceModule(
  httpPostResult: any,
  options?: {
    httpGetImpl?: (...args: any[]) => any;
    httpPostImpl?: (...args: any[]) => any;
    runOnPageQueueImpl?: (...args: any[]) => any;
  }
) {
  vi.resetModules();

  const httpGet = options?.httpGetImpl ? vi.fn(options.httpGetImpl) : vi.fn();
  const httpPost = options?.httpPostImpl
    ? vi.fn(options.httpPostImpl)
    : vi.fn(async () => httpPostResult);

  vi.doMock('../main/chrome-manager', () => ({
    ChromeManager: class ChromeManager {},
  }));

  vi.doMock('../main/utils/http-client', () => ({
    httpGet,
    httpPost,
    httpRequest: vi.fn(),
  }));

  vi.doMock('../main/utils/logger', () => ({
    default: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

  vi.doMock('../main/utils/page-exec-queue', () => ({
    runOnPageQueue: options?.runOnPageQueueImpl ? vi.fn(options.runOnPageQueueImpl) : vi.fn(),
  }));

  return {
    ...(await import('../main/token-service')),
    httpGet,
    httpPost,
  };
}

async function loadApiServiceModule() {
  vi.resetModules();

  const updateAccountCachedData = vi.fn(async () => true);
  const updateSite = vi.fn(async () => true);

  vi.doMock('../main/chrome-manager', () => ({
    ChromeManager: class ChromeManager {},
  }));

  vi.doMock('../main/unified-config-manager', () => ({
    unifiedConfigManager: {
      getSiteByUrl: vi.fn(() => ({
        id: 'site-1',
        url: 'https://demo.example.com',
      })),
      getAccountById: vi.fn(() => ({
        id: 'acct-1',
        site_id: 'site-1',
      })),
      updateAccountCachedData,
      updateSite,
    },
  }));

  vi.doMock('../main/utils/http-client', () => ({
    httpGet: vi.fn(),
    httpPost: vi.fn(),
  }));

  vi.doMock('../main/utils/request-manager', () => ({
    requestManager: {},
    RequestManager: class RequestManager {},
  }));

  vi.doMock('../main/utils/logger', () => ({
    default: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

  vi.doMock('../main/utils/page-exec-queue', () => ({
    runOnPageQueue: vi.fn(),
  }));

  return {
    ...(await import('../main/api-service')),
    updateAccountCachedData,
    updateSite,
  };
}

async function loadTokenHandlersModule() {
  vi.resetModules();

  const registeredHandlers = new Map<string, (...args: any[]) => any>();
  const ipcHandle = vi.fn((channel: string, handler: (...args: any[]) => any) => {
    registeredHandlers.set(channel, handler);
  });
  const updateAccountCachedData = vi.fn(async () => true);
  const updateSite = vi.fn(async () => true);

  vi.doMock('electron', () => ({
    ipcMain: {
      handle: ipcHandle,
    },
    BrowserWindow: class BrowserWindow {},
  }));

  vi.doMock('../main/utils/logger', () => ({
    default: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

  vi.doMock('../main/unified-config-manager', () => ({
    unifiedConfigManager: {
      loadConfig: vi.fn(async () => true),
      getAccountById: vi.fn((accountId: string) =>
        accountId === 'acct-1'
          ? {
              id: 'acct-1',
              site_id: 'site-1',
            }
          : undefined
      ),
      getAccountsBySiteId: vi.fn(() => [{ id: 'acct-1', site_id: 'site-1' }]),
      getSiteByUrl: vi.fn(() => ({
        id: 'site-1',
        url: 'https://demo.example.com',
        cached_data: {
          api_keys: [
            {
              id: 2,
              name: 'raw-token',
              group: 'default',
              key: 'sk-old****5678',
              status: 1,
            },
          ],
        },
      })),
      updateAccountCachedData,
      updateSite,
    },
  }));

  return {
    ...(await import('../main/handlers/token-handlers')),
    registeredHandlers,
    updateAccountCachedData,
    updateSite,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('token-service API key 保留', () => {
  it('resolveUsableApiKeyValue 遇到脱敏 key 时应按 id 获取明文', async () => {
    const { TokenService, httpPost } = await loadTokenServiceModule(null, {
      httpPostImpl: async () => ({
        status: 200,
        data: {
          success: true,
          data: {
            key: 'sk-resolved-raw-12345678',
          },
        },
      }),
    });

    const service = new TokenService({ createPage: vi.fn() } as any);

    const resolved = await service.resolveUsableApiKeyValue(
      'https://demo.example.com',
      1,
      'access-token',
      {
        id: 55092,
        key: 'sk-demo****5678',
      }
    );

    expect(httpPost).toHaveBeenCalledTimes(1);
    expect(httpPost.mock.calls[0]?.[0]).toBe('https://demo.example.com/api/token/55092/key');
    expect(resolved).toBe('sk-resolved-raw-12345678');
  });

  it('resolveUsableApiKeyValue 在按 id 请求被拦截时应回退到浏览器模式', async () => {
    const { TokenService, httpPost } = await loadTokenServiceModule(null, {
      httpPostImpl: async () => {
        const error = new Error('HTTP 403') as Error & { status?: number };
        error.status = 403;
        throw error;
      },
      runOnPageQueueImpl: async (_page: any, task: () => Promise<any>) => task(),
    });

    const page = {
      bringToFront: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      content: vi.fn(async () => '<html>ok</html>'),
      evaluate: vi.fn(async () => ({
        ok: true,
        status: 200,
        isJson: true,
        data: {
          data: {
            key: 'sk-browser-raw-12345678',
          },
        },
      })),
      isClosed: vi.fn(() => false),
    };
    const release = vi.fn();
    const service = new TokenService({
      createPage: vi.fn(async () => ({ page, release })),
    } as any);

    const resolved = await service.resolveUsableApiKeyValue(
      'https://demo.example.com',
      1,
      'access-token',
      {
        id: 55092,
        key: 'sk-demo****5678',
      },
      {
        allowBrowserFallback: true,
        challengeWaitMs: 10,
      }
    );

    expect(httpPost).toHaveBeenCalledTimes(1);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(resolved).toBe('sk-browser-raw-12345678');
  });

  it('resolveUsableApiKeyValue 在 POST 失败且站点使用 GET 时应回退到 GET 获取明文', async () => {
    const { TokenService, httpGet, httpPost } = await loadTokenServiceModule(null, {
      httpGetImpl: async (url: string) => {
        if (url === 'https://demo.example.com/api/token/55092/key') {
          return {
            status: 200,
            data: {
              success: true,
              data: {
                key: 'sk-get-raw-12345678',
              },
            },
          };
        }

        throw new Error(`Unexpected GET ${url}`);
      },
      httpPostImpl: async () => {
        const error = new Error('HTTP 405') as Error & { status?: number };
        error.status = 405;
        throw error;
      },
    });

    const service = new TokenService({ createPage: vi.fn() } as any);

    const resolved = await service.resolveUsableApiKeyValue(
      'https://demo.example.com',
      1,
      'access-token',
      {
        id: 55092,
        key: 'sk-demo****5678',
      },
      {
        allowBrowserFallback: false,
      }
    );

    expect(httpPost).toHaveBeenCalledTimes(1);
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(httpGet.mock.calls[0]?.[0]).toBe('https://demo.example.com/api/token/55092/key');
    expect(resolved).toBe('sk-get-raw-12345678');
  });

  it('fetchApiTokens 遇到脱敏 key 时应按 id 再获取明文 key', async () => {
    const { TokenService, httpPost } = await loadTokenServiceModule(null, {
      httpGetImpl: async () => ({
        status: 200,
        data: {
          data: [
            {
              id: 55092,
              name: 'masked-token',
              group: 'default',
              key: 'sk-demo****5678',
              status: 1,
            },
          ],
        },
      }),
      httpPostImpl: async () => ({
        status: 200,
        data: {
          success: true,
          data: {
            key: 'sk-demo-raw-12345678',
          },
        },
      }),
    });

    const service = new TokenService({ createPage: vi.fn() } as any);

    const tokens = await service.fetchApiTokens('https://demo.example.com', 1, 'access-token');

    expect(httpPost).toHaveBeenCalledTimes(1);
    expect(httpPost.mock.calls[0]?.[0]).toBe('https://demo.example.com/api/token/55092/key');
    expect(tokens[0]?.key).toBe('sk-demo-raw-12345678');
  });

  it('fetchApiTokens 在明文补拉失败时应保留原脱敏值', async () => {
    const { TokenService, httpPost } = await loadTokenServiceModule(null, {
      httpGetImpl: async () => ({
        status: 200,
        data: {
          data: [
            {
              id: 55092,
              name: 'masked-token',
              group: 'default',
              key: 'sk-demo****5678',
              status: 1,
            },
          ],
        },
      }),
      httpPostImpl: async () => {
        throw new Error('HTTP 404');
      },
    });

    const service = new TokenService({ createPage: vi.fn() } as any);

    const tokens = await service.fetchApiTokens('https://demo.example.com', 1, 'access-token');

    expect(httpPost).toHaveBeenCalledTimes(1);
    expect(tokens[0]?.key).toBe('sk-demo****5678');
  });

  it('createApiToken 应保留创建响应中的原始 key，而不是使用列表接口返回的脱敏值', async () => {
    const { TokenService } = await loadTokenServiceModule({
      status: 200,
      data: {
        success: true,
        data: {
          id: 2,
          key: 'sk-new-raw-12345678',
        },
      },
    });

    const service = new TokenService({ createPage: vi.fn() } as any);

    const beforeTokens = [
      {
        id: 1,
        name: 'old-token',
        group: 'default',
        key: 'sk-old-raw-11111111',
        unlimited_quota: false,
        remain_quota: 1000,
        expired_time: -1,
      },
    ];

    const afterTokens = [
      ...beforeTokens,
      {
        id: 2,
        name: 'new-token',
        group: 'default',
        key: 'sk-new****5678',
        unlimited_quota: false,
        remain_quota: 500000,
        expired_time: -1,
      },
    ];

    vi.spyOn(service, 'fetchApiTokens')
      .mockResolvedValueOnce(beforeTokens)
      .mockResolvedValueOnce(afterTokens);

    const result = await service.createApiToken('https://demo.example.com', 1, 'access-token', {
      name: 'new-token',
      remain_quota: 500000,
      expired_time: -1,
      unlimited_quota: false,
      model_limits_enabled: false,
      model_limits: '',
      allow_ips: '',
      group: 'default',
    });

    expect(result.success).toBe(true);
    expect(result.data?.find(token => token.id === 2)?.key).toBe('sk-new-raw-12345678');
  });
});

describe('api-service API key 持久化', () => {
  it('保存缓存时应保留已有原始 key，不应被后续列表接口返回的脱敏值覆盖', async () => {
    const { ApiService, updateAccountCachedData } = await loadApiServiceModule();

    const service = new ApiService();

    await (service as any).saveCachedDisplayData(
      'https://demo.example.com',
      {
        name: 'Demo Site',
        url: 'https://demo.example.com',
        status: 'success',
        models: [],
        has_checkin: false,
        apiKeys: [
          {
            id: 2,
            name: 'new-token',
            group: 'default',
            key: 'sk-new****5678',
            status: 1,
          },
        ],
      },
      { accountId: 'acct-1' }
    );

    expect(updateAccountCachedData).toHaveBeenCalledTimes(1);

    const updater = updateAccountCachedData.mock.calls[0][1];
    const next = updater({
      api_keys: [
        {
          id: 2,
          name: 'new-token',
          group: 'default',
          key: 'sk-new-raw-12345678',
          status: 1,
        },
      ],
    });

    expect(next.api_keys?.[0]?.key).toBe('sk-new-raw-12345678');
  });
});

describe('token-handlers API key 持久化', () => {
  it('fetch-api-tokens 返回明文 key 时应立即持久化，覆盖旧的脱敏值', async () => {
    const { registerTokenHandlers, registeredHandlers, updateAccountCachedData } =
      await loadTokenHandlersModule();

    const tokenService = {
      fetchApiTokens: vi.fn(async () => [
        {
          id: 2,
          name: 'raw-token',
          group: 'default',
          key: 'sk-new-raw-12345678',
          status: 1,
        },
      ]),
    };

    registerTokenHandlers(tokenService as any, {} as any, () => null);

    const fetchHandler = registeredHandlers.get('token:fetch-api-tokens');
    expect(fetchHandler).toBeTypeOf('function');

    const result = await fetchHandler?.(
      {},
      'https://demo.example.com',
      1,
      'access-token',
      'acct-1'
    );

    expect(result?.success).toBe(true);
    expect(result?.data?.[0]?.key).toBe('sk-new-raw-12345678');
    expect(updateAccountCachedData).toHaveBeenCalledTimes(1);

    const updater = updateAccountCachedData.mock.calls[0][1];
    const next = updater({
      api_keys: [
        {
          id: 2,
          name: 'raw-token',
          group: 'default',
          key: 'sk-old****5678',
          status: 1,
        },
      ],
    });

    expect(next.api_keys?.[0]?.key).toBe('sk-new-raw-12345678');
  });
});
