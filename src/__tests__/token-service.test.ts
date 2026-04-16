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
    siteType?: 'newapi' | 'sub2api';
    httpGetImpl?: (...args: any[]) => any;
    httpPostImpl?: (...args: any[]) => any;
    httpRequestImpl?: (...args: any[]) => any;
    runOnPageQueueImpl?: (...args: any[]) => any;
  }
) {
  vi.resetModules();

  const httpGet = options?.httpGetImpl ? vi.fn(options.httpGetImpl) : vi.fn();
  const httpPost = options?.httpPostImpl
    ? vi.fn(options.httpPostImpl)
    : vi.fn(async () => httpPostResult);
  const httpRequest = options?.httpRequestImpl ? vi.fn(options.httpRequestImpl) : vi.fn();

  vi.doMock('../main/chrome-manager', () => ({
    ChromeManager: class ChromeManager {},
  }));

  vi.doMock('../main/utils/http-client', () => ({
    httpGet,
    httpPost,
    httpRequest,
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
      getSiteById: vi.fn((siteId: string) => ({
        id: siteId,
        url: 'https://demo.example.com',
        site_type: options?.siteType || 'newapi',
      })),
      getSiteByUrl: vi.fn(() => ({
        id: 'site-1',
        url: 'https://demo.example.com',
        site_type: options?.siteType || 'newapi',
      })),
    },
  }));

  vi.doMock('../main/site-type-detector', () => ({
    detectSiteType: vi.fn(async () => ({
      siteType: options?.siteType || 'newapi',
      detectionMethod: 'fallback',
    })),
  }));

  vi.doMock('../main/utils/page-exec-queue', () => ({
    runOnPageQueue: options?.runOnPageQueueImpl ? vi.fn(options.runOnPageQueueImpl) : vi.fn(),
  }));

  return {
    ...(await import('../main/token-service')),
    httpGet,
    httpPost,
    httpRequest,
  };
}

async function loadApiServiceModule(options?: { siteType?: 'newapi' | 'sub2api' }) {
  vi.resetModules();

  const updateAccountCachedData = vi.fn(async () => true);
  const updateSite = vi.fn(async () => true);
  const detectSiteType = vi.fn(async () => ({
    siteType: options?.siteType || 'newapi',
    detectionMethod: 'api-status',
  }));

  const httpGet = vi.fn();
  const httpPost = vi.fn();

  vi.doMock('../main/chrome-manager', () => ({
    ChromeManager: class ChromeManager {},
  }));

  vi.doMock('../main/unified-config-manager', () => ({
    unifiedConfigManager: {
      getSiteById: vi.fn((siteId: string) => ({
        id: siteId,
        url: 'https://demo.example.com',
        site_type: options?.siteType || 'newapi',
      })),
      getSiteByUrl: vi.fn(() => ({
        id: 'site-1',
        url: 'https://demo.example.com',
        site_type: options?.siteType || 'newapi',
      })),
      getAccountById: vi.fn(() => ({
        id: 'acct-1',
        site_id: 'site-1',
      })),
      updateAccountCachedData,
      updateSite,
    },
  }));

  vi.doMock('../main/site-type-detector', () => ({
    detectSiteType,
  }));

  vi.doMock('../main/utils/http-client', () => ({
    httpGet,
    httpPost,
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
    detectSiteType,
    httpGet,
    httpPost,
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
      getSiteById: vi.fn(() => ({
        id: 'site-1',
        url: 'https://demo.example.com',
        site_type: 'newapi',
      })),
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

describe('initializeSiteAccount site_type 驱动', () => {
  it('应先识别站点类型，并按注册表把 site_type 透传给 localStorage / 返回结果', async () => {
    const { TokenService } = await loadTokenServiceModule(null, {
      siteType: 'sub2api',
    });

    const chromeManager = {
      getLocalStorageData: vi.fn(async (_url, _wait, _max, _status, options) => {
        expect(options).toEqual({ loginMode: false, siteType: 'sub2api' });
        return {
          userId: 9,
          username: 'sub-user',
          systemName: 'Sub2API Site',
          accessToken: 'sub-jwt-token',
          supportsCheckIn: false,
          canCheckIn: false,
        };
      }),
      createAccessTokenForLogin: vi.fn(),
    };

    const service = new TokenService(chromeManager as any);
    const result = await service.initializeSiteAccount('https://demo.example.com');

    expect(result.site_type).toBe('sub2api');
    expect(result.access_token).toBe('sub-jwt-token');
    expect(chromeManager.createAccessTokenForLogin).not.toHaveBeenCalled();
  });

  it('sub2api 初始化时应预取首个 API Key 供新增站点表单回填', async () => {
    const { TokenService } = await loadTokenServiceModule(null, {
      siteType: 'sub2api',
    });

    const chromeManager = {
      getLocalStorageData: vi.fn(async () => ({
        userId: 9,
        username: 'sub-user',
        systemName: 'AC_公益站',
        accessToken: 'sub-jwt-token',
        supportsCheckIn: false,
        canCheckIn: false,
      })),
      createAccessTokenForLogin: vi.fn(),
    };

    const service = new TokenService(chromeManager as any);
    const fetchApiTokensSpy = vi.spyOn(service, 'fetchApiTokens').mockResolvedValue([
      {
        id: 1001,
        name: 'default-key',
        key: 'sk-sub2api-raw-12345678',
        group: 'default',
      },
    ]);

    const result = await service.initializeSiteAccount('https://demo.example.com');

    expect(fetchApiTokensSpy).toHaveBeenCalledWith('https://demo.example.com', 9, 'sub-jwt-token', {
      siteType: 'sub2api',
    });
    expect((result as any).api_key).toBe('sk-sub2api-raw-12345678');
    expect((result as any).api_keys).toEqual([
      expect.objectContaining({
        id: 1001,
        key: 'sk-sub2api-raw-12345678',
      }),
    ]);
  });

  it('当站点类型不支持自动创建访问令牌时，应直接报错而不是回退到 legacy token 端点', async () => {
    const { TokenService } = await loadTokenServiceModule(null, {
      siteType: 'sub2api',
    });

    const chromeManager = {
      getLocalStorageData: vi.fn(async () => ({
        userId: 9,
        username: 'sub-user',
        systemName: 'Sub2API Site',
        accessToken: null,
        supportsCheckIn: false,
        canCheckIn: false,
      })),
      createAccessTokenForLogin: vi.fn(),
    };

    const service = new TokenService(chromeManager as any);

    await expect(service.initializeSiteAccount('https://demo.example.com')).rejects.toThrow(
      '未在 localStorage 中返回有效访问令牌'
    );
    expect(chromeManager.createAccessTokenForLogin).not.toHaveBeenCalled();
  });

  it('当初始判型回退为 newapi，但登录态暴露 sub2api 线索时，应修正最终 site_type', async () => {
    const { TokenService } = await loadTokenServiceModule(null, {
      siteType: 'newapi',
    });

    const chromeManager = {
      getLocalStorageData: vi.fn(async () => ({
        userId: 2848,
        username: 'Lu_Hang',
        systemName: null,
        accessToken: 'jwt-token',
        siteTypeHint: 'sub2api',
        supportsCheckIn: false,
        canCheckIn: false,
      })),
      createAccessTokenForLogin: vi.fn(),
    };

    const service = new TokenService(chromeManager as any);
    const result = await service.initializeSiteAccount('https://ai.acmi.run');

    expect(result.site_type).toBe('sub2api');
    expect(result.access_token).toBe('jwt-token');
    expect(chromeManager.createAccessTokenForLogin).not.toHaveBeenCalled();
  });
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

  it('sub2api 应使用新的 keys/usage/group 接口映射 API Key 分组和用量', async () => {
    const { TokenService, httpGet, httpPost } = await loadTokenServiceModule(null, {
      siteType: 'sub2api',
      httpGetImpl: async (url: string) => {
        if (url.includes('/api/v1/keys?page=1&page_size=100')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'ok',
              data: {
                items: [
                  {
                    id: 1001,
                    name: 'sub2api-key',
                    key: 'sk-sub2api-raw-12345678',
                    group_id: 10,
                    quota: 8,
                    quota_used: 2,
                    expires_at: null,
                  },
                ],
              },
            },
          };
        }

        if (url.endsWith('/api/v1/groups/available')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'ok',
              data: [{ id: 10, name: 'vip', description: 'VIP 分组', rate_multiplier: 0.8 }],
            },
          };
        }

        throw new Error(`Unexpected GET ${url}`);
      },
      httpPostImpl: async (url: string) => {
        if (url.endsWith('/api/v1/usage/dashboard/api-keys-usage')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'ok',
              data: {
                stats: {
                  '1001': {
                    api_key_id: 1001,
                    today_actual_cost: 0.5,
                    total_actual_cost: 1.5,
                  },
                },
              },
            },
          };
        }

        throw new Error(`Unexpected POST ${url}`);
      },
    });

    const service = new TokenService({ createPage: vi.fn() } as any);
    const tokens = await service.fetchApiTokens('https://demo.example.com', 1, 'jwt-token');

    expect(httpGet.mock.calls[0]?.[0]).toBe(
      'https://demo.example.com/api/v1/keys?page=1&page_size=100'
    );
    expect(httpPost).toHaveBeenCalledWith(
      'https://demo.example.com/api/v1/usage/dashboard/api-keys-usage',
      { api_key_ids: [1001] },
      expect.any(Object)
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.key).toBe('sk-sub2api-raw-12345678');
    expect(tokens[0]?.group).toBe('vip');
    expect(tokens[0]?.group_id).toBe(10);
    expect(tokens[0]?.today_actual_cost).toBe(0.5);
    expect(tokens[0]?.total_actual_cost).toBe(1.5);
    expect(tokens[0]?.used_quota).toBe(750000);
  });

  it('fetchApiTokens 在站点未落库时仍应按显式 siteType 走 sub2api keys 端点', async () => {
    const { TokenService, httpGet, httpPost } = await loadTokenServiceModule(null, {
      siteType: 'newapi',
      httpGetImpl: async (url: string) => {
        if (url.includes('/api/v1/keys?page=1&page_size=100')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'ok',
              data: {
                items: [
                  {
                    id: 1002,
                    name: 'sub2api-key',
                    key: 'sk-explicit-raw-12345678',
                    group_id: 10,
                    status: 'active',
                  },
                ],
              },
            },
          };
        }

        if (url.endsWith('/api/v1/groups/available')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'ok',
              data: [{ id: 10, name: 'vip', description: 'VIP 分组', rate_multiplier: 0.8 }],
            },
          };
        }

        throw new Error(`Unexpected GET ${url}`);
      },
      httpPostImpl: async (url: string) => {
        if (url.endsWith('/api/v1/usage/dashboard/api-keys-usage')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'ok',
              data: {
                stats: {},
              },
            },
          };
        }

        throw new Error(`Unexpected POST ${url}`);
      },
    });

    const service = new TokenService({ createPage: vi.fn() } as any);
    const tokens = await service.fetchApiTokens('https://demo.example.com', 1, 'jwt-token', {
      siteType: 'sub2api',
    });

    expect(httpGet).toHaveBeenCalledWith(
      'https://demo.example.com/api/v1/keys?page=1&page_size=100',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-token',
        }),
      })
    );
    expect(httpPost).toHaveBeenCalledWith(
      'https://demo.example.com/api/v1/usage/dashboard/api-keys-usage',
      { api_key_ids: [1002] },
      expect.any(Object)
    );
    expect(tokens[0]?.key).toBe('sk-explicit-raw-12345678');
    expect(tokens[0]?.group).toBe('vip');
  });

  it('sub2api keys 首个兼容 URL 失败时应继续尝试后续端点', async () => {
    const { TokenService, httpGet, httpPost } = await loadTokenServiceModule(null, {
      siteType: 'sub2api',
      httpGetImpl: async (url: string) => {
        if (url.includes('/api/v1/keys?page=1&page_size=100')) {
          return {
            status: 200,
            data: {
              code: 1001,
              message: 'invalid query parameter',
            },
          };
        }

        if (url.includes('/api/v1/keys?page=1&page_size=20')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'ok',
              data: {
                items: [
                  {
                    id: 1003,
                    name: 'fallback-key',
                    key: 'sk-sub2api-fallback-raw',
                    group_id: 10,
                    status: 'active',
                  },
                ],
              },
            },
          };
        }

        if (url.endsWith('/api/v1/groups/available')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'ok',
              data: [{ id: 10, name: 'vip', description: 'VIP 分组', rate_multiplier: 0.8 }],
            },
          };
        }

        throw new Error(`Unexpected GET ${url}`);
      },
      httpPostImpl: async (url: string) => {
        if (url.endsWith('/api/v1/usage/dashboard/api-keys-usage')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'ok',
              data: {
                stats: {},
              },
            },
          };
        }

        throw new Error(`Unexpected POST ${url}`);
      },
    });

    const service = new TokenService({ createPage: vi.fn() } as any);
    const tokens = await service.fetchApiTokens('https://demo.example.com', 1, 'jwt-token');

    expect(httpGet.mock.calls[0]?.[0]).toBe(
      'https://demo.example.com/api/v1/keys?page=1&page_size=100'
    );
    expect(httpGet.mock.calls[1]?.[0]).toBe(
      'https://demo.example.com/api/v1/keys?page=1&page_size=20'
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.key).toBe('sk-sub2api-fallback-raw');
    expect(tokens[0]?.group).toBe('vip');
  });

  it('sub2api API Key 接口返回 TOKEN_EXPIRED 时应抛出认证过期错误', async () => {
    const { TokenService } = await loadTokenServiceModule(null, {
      siteType: 'sub2api',
      httpGetImpl: async (url: string) => {
        if (url.includes('/api/v1/keys')) {
          return {
            status: 200,
            data: {
              code: 'TOKEN_EXPIRED',
              message: 'Token has expired',
            },
          };
        }

        throw new Error(`Unexpected GET ${url}`);
      },
    });

    const service = new TokenService({ createPage: vi.fn() } as any);

    await expect(
      service.fetchApiTokens('https://demo.example.com', 1, 'jwt-token')
    ).rejects.toThrow('登录已过期或未登录');
  });

  it('sub2api 应将 groups/available 数组响应转换为用户分组映射', async () => {
    const { TokenService } = await loadTokenServiceModule(null, {
      siteType: 'sub2api',
      httpGetImpl: async () => ({
        status: 200,
        data: {
          code: 0,
          message: 'ok',
          data: [
            { name: 'default', display_name: '默认分组', ratio: 1 },
            { id: 'vip', desc: 'VIP 分组', multiplier: 0.8 },
          ],
        },
      }),
    });

    const service = new TokenService({ createPage: vi.fn() } as any);
    const groups = await service.fetchUserGroups('https://demo.example.com', 1, 'jwt-token');

    expect(groups).toEqual({
      default: { id: undefined, desc: '默认分组', ratio: 1 },
      vip: { id: 'vip', desc: 'VIP 分组', ratio: 0.8 },
    });
  });

  it('sub2api 创建 API Key 时应提交 group_id/quota/expires_in_days 到 /api/v1/keys', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T00:00:00Z'));

    const { TokenService, httpPost } = await loadTokenServiceModule(null, {
      siteType: 'sub2api',
      httpPostImpl: async (url: string) => {
        if (url.endsWith('/api/v1/keys')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'success',
              data: {
                id: 2,
                key: 'sk-created-raw-12345678',
                name: 'group-key',
                group_id: 10,
                quota: 3,
                quota_used: 0,
                status: 'active',
              },
            },
          };
        }

        throw new Error(`Unexpected POST ${url}`);
      },
    });

    const service = new TokenService({ createPage: vi.fn() } as any);
    vi.spyOn(service, 'fetchUserGroups').mockResolvedValue({
      vip: { id: 10, desc: 'VIP 分组', ratio: 0.8 },
    });
    vi.spyOn(service, 'fetchApiTokens')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 2,
          name: 'group-key',
          key: 'sk-created-raw-12345678',
          group: 'vip',
          group_id: 10,
          quota: 3,
          quota_used: 0,
          status: 'active',
        },
      ]);

    const result = await service.createApiToken('https://demo.example.com', 1, 'jwt-token', {
      name: 'group-key',
      remain_quota: 1500000,
      expired_time: Math.floor(new Date('2026-04-17T00:00:00Z').getTime() / 1000),
      unlimited_quota: false,
      model_limits_enabled: false,
      model_limits: '',
      allow_ips: '',
      group: 'vip',
    });

    expect(httpPost).toHaveBeenCalledWith(
      'https://demo.example.com/api/v1/keys',
      {
        name: 'group-key',
        group_id: 10,
        quota: 3,
        expires_in_days: 2,
      },
      expect.any(Object)
    );
    expect(result.success).toBe(true);
    expect(result.data?.[0]?.key).toBe('sk-created-raw-12345678');

    vi.useRealTimers();
  });

  it('sub2api 删除 API Key 时应调用 /api/v1/keys/:id', async () => {
    const { TokenService, httpRequest } = await loadTokenServiceModule(null, {
      siteType: 'sub2api',
      httpRequestImpl: async () => ({
        status: 200,
        data: {
          code: 0,
          message: 'success',
        },
      }),
    });

    const service = new TokenService({ createPage: vi.fn() } as any);
    const result = await service.deleteApiToken('https://demo.example.com', 1, 'jwt-token', {
      id: 1001,
    });

    expect(httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        url: 'https://demo.example.com/api/v1/keys/1001',
      })
    );
    expect(result).toEqual({ success: true });
  });

  it('sub2api 刷新显示数据时应组合 auth/me 与 usage/stats，且模型定价返回空对象', async () => {
    const { TokenService } = await loadTokenServiceModule(null, {
      siteType: 'sub2api',
      httpGetImpl: async (url: string) => {
        if (url.endsWith('/api/v1/auth/me')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'ok',
              data: {
                balance: 88.5,
              },
            },
          };
        }

        if (url.endsWith('/api/v1/usage/stats')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'ok',
              data: {
                today_actual_cost: 1.25,
                today_prompt_tokens: 100,
                today_completion_tokens: 50,
                today_requests: 3,
              },
            },
          };
        }

        if (url.includes('/api/v1/keys?page=1&page_size=100')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'ok',
              data: {
                items: [{ id: 1, name: 'default-key', key: 'sk-sub2api-raw-1' }],
              },
            },
          };
        }

        if (url.endsWith('/api/v1/groups/available')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'ok',
              data: [{ name: 'default', display_name: '默认分组', ratio: 1 }],
            },
          };
        }

        throw new Error(`Unexpected GET ${url}`);
      },
      httpPostImpl: async (url: string) => {
        if (url.endsWith('/api/v1/usage/dashboard/api-keys-usage')) {
          return {
            status: 200,
            data: {
              code: 0,
              message: 'ok',
              data: {
                stats: {
                  '1': {
                    api_key_id: 1,
                    today_actual_cost: 0.25,
                    total_actual_cost: 0.75,
                  },
                },
              },
            },
          };
        }

        throw new Error(`Unexpected POST ${url}`);
      },
    });

    const service = new TokenService({ createPage: vi.fn() } as any);
    const result = await service.refreshDisplayData({
      id: 'acct-1',
      site_name: 'Sub2API Site',
      site_url: 'https://demo.example.com',
      user_id: 1,
      access_token: 'jwt-token',
    } as any);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      quota: 88.5,
      today_quota_consumption: 1.25,
      today_prompt_tokens: 100,
      today_completion_tokens: 50,
      today_requests_count: 3,
      models: [],
      apiKeys: [
        expect.objectContaining({
          id: 1,
          name: 'default-key',
          key: 'sk-sub2api-raw-1',
          today_actual_cost: 0.25,
          total_actual_cost: 0.75,
        }),
      ],
      userGroups: {
        default: { id: undefined, desc: '默认分组', ratio: 1 },
      },
      modelPricing: { data: {} },
    });
  });
});

describe('api-service API key 持久化', () => {
  it('旧站点首次检测时应自动识别并持久化 site_type，后续不再重复检测', async () => {
    const { ApiService, updateSite, detectSiteType } = await loadApiServiceModule();

    const service = new ApiService();
    const siteWithoutType = {
      id: 'site-legacy',
      name: 'Legacy Site',
      url: 'https://demo.example.com',
      system_token: 'access-token',
      user_id: '1',
    } as any;

    const resolved = await (service as any).ensureSiteType(siteWithoutType);
    expect(detectSiteType).toHaveBeenCalledTimes(1);
    expect(resolved.site_type).toBe('newapi');
    expect(updateSite).toHaveBeenCalledWith('site-legacy', {
      site_type: 'newapi',
    });

    updateSite.mockClear();
    detectSiteType.mockClear();

    const resolvedAgain = await (service as any).ensureSiteType({
      ...siteWithoutType,
      site_type: 'newapi',
    });
    expect(resolvedAgain.site_type).toBe('newapi');
    expect(detectSiteType).not.toHaveBeenCalled();
    expect(updateSite).not.toHaveBeenCalled();
  });

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

  it('余额端点缓存回退后应保留模型端点缓存', async () => {
    const { ApiService } = await loadApiServiceModule();

    const service = new ApiService();
    const site = {
      id: 'site-1',
      name: 'Demo Site',
      url: 'https://demo.example.com',
      user_id: '1',
      system_token: 'access-token',
    } as any;

    (service as any).setEpCache(site, 'models', '/api/user/models');
    (service as any).setEpCache(site, 'balance', '/api/user/self');

    (service as any).fetchWithBrowserFallback = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 404'))
      .mockRejectedValueOnce(new Error('HTTP 404'))
      .mockResolvedValueOnce({ result: 12.34, pageRelease: undefined });

    const result = await (service as any).fetchBalance(site, 3000, 'access-token');

    expect(result?.balance).toBe(12.34);
    expect((service as any).fetchWithBrowserFallback.mock.calls[0]?.[0]).toBe(
      'https://demo.example.com/api/user/self'
    );
    expect((service as any).fetchWithBrowserFallback.mock.calls[1]?.[0]).toBe(
      'https://demo.example.com/api/user/self'
    );
    expect((service as any).fetchWithBrowserFallback.mock.calls[2]?.[0]).toBe(
      'https://demo.example.com/api/user/dashboard'
    );
    expect((service as any).getEpCache(site, 'models')).toBe('/api/user/models');
    expect((service as any).getEpCache(site, 'balance')).toBe('/api/user/dashboard');
  });

  it('sub2api 未配置 API Key 时应跳过模型列表请求而不是按旧端点报错', async () => {
    const { ApiService } = await loadApiServiceModule({ siteType: 'sub2api' });
    const service = new ApiService();
    (service as any).fetchWithBrowserFallback = vi.fn();

    const result = await (service as any).getModels(
      {
        id: 'site-1',
        name: 'Sub2API Site',
        url: 'https://demo.example.com',
        site_type: 'sub2api',
        system_token: 'jwt-token',
      },
      3000
    );

    expect(result).toEqual({ models: [] });
    expect((service as any).fetchWithBrowserFallback).not.toHaveBeenCalled();
  });

  it('api_key 鉴权下 /v1/models 返回 code/message 且无 data 时，应提示 API Key 失效而不是登录过期', async () => {
    const { ApiService } = await loadApiServiceModule({ siteType: 'sub2api' });
    const service = new ApiService();
    (service as any).fetchWithBrowserFallback = vi.fn().mockResolvedValue({
      result: [],
      page: undefined,
      pageRelease: undefined,
    });

    await expect(
      (service as any).getModels(
        {
          id: 'site-1',
          name: 'Sub2API Site',
          url: 'https://demo.example.com',
          site_type: 'sub2api',
          system_token: 'jwt-token',
          api_key: 'sk-demo-key',
        },
        3000
      )
    ).rejects.toThrow('API Key 可能已失效或无权访问');
  });

  it('sub2api 应按 API Key 所属分组聚合 /v1/models 并生成 enable_groups 映射', async () => {
    const { ApiService, httpGet } = await loadApiServiceModule({ siteType: 'sub2api' });
    const service = new ApiService();

    httpGet.mockImplementation(async (_url: string, options: any) => {
      const authHeader = options?.headers?.Authorization;
      if (authHeader === 'Bearer sk-group-a') {
        return {
          data: {
            object: 'list',
            data: [{ id: 'claude-3-7-sonnet' }, { id: 'gpt-4o-mini' }],
          },
        };
      }

      if (authHeader === 'Bearer sk-group-b') {
        return {
          data: {
            object: 'list',
            data: [{ id: 'gpt-4o-mini' }, { id: 'gemini-2.5-pro' }],
          },
        };
      }

      throw new Error(`Unexpected Authorization ${authHeader}`);
    });

    const result = await (service as any).fetchSub2ApiGroupedModels(
      {
        id: 'site-1',
        name: 'Sub2API Site',
        url: 'https://demo.example.com',
        site_type: 'sub2api',
      },
      [
        { id: 1, key: 'sk-group-a', group_id: 10 },
        { id: 2, key: 'sk-group-b', group_id: 20 },
      ],
      {
        alpha: { id: 10, desc: 'Alpha', ratio: 1 },
        beta: { id: 20, desc: 'Beta', ratio: 1 },
      }
    );

    expect(result.models.sort()).toEqual(['claude-3-7-sonnet', 'gemini-2.5-pro', 'gpt-4o-mini']);
    expect(result.modelPricing.data['claude-3-7-sonnet']).toEqual({
      enable_groups: ['alpha'],
    });
    expect(result.modelPricing.data['gemini-2.5-pro']).toEqual({
      enable_groups: ['beta'],
    });
    expect(result.modelPricing.data['gpt-4o-mini']?.enable_groups.sort()).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('sub2api 分组模型发现时应优先选择 active key，而不是同组首个 inactive key', async () => {
    const { ApiService, httpGet } = await loadApiServiceModule({ siteType: 'sub2api' });
    const service = new ApiService();

    httpGet.mockImplementation(async (_url: string, options: any) => {
      const authHeader = options?.headers?.Authorization;
      if (authHeader === 'Bearer sk-group-active') {
        return {
          data: {
            object: 'list',
            data: [{ id: 'gpt-4o-mini' }],
          },
        };
      }

      throw new Error(`Unexpected Authorization ${authHeader}`);
    });

    const result = await (service as any).fetchSub2ApiGroupedModels(
      {
        id: 'site-1',
        name: 'Sub2API Site',
        url: 'https://demo.example.com',
        site_type: 'sub2api',
      },
      [
        { id: 1, key: 'sk-group-inactive', group_id: 10, status: 'inactive' },
        { id: 2, key: 'sk-group-active', group_id: 10, status: 'active' },
      ],
      {
        alpha: { id: 10, desc: 'Alpha', ratio: 1 },
      }
    );

    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(httpGet.mock.calls[0]?.[1]?.headers?.Authorization).toBe('Bearer sk-group-active');
    expect(result.models).toEqual(['gpt-4o-mini']);
    expect(result.modelPricing.data['gpt-4o-mini']).toEqual({
      enable_groups: ['alpha'],
    });
  });

  it('sub2api 应使用 auth/me 与 usage/stats 组合余额和今日用量', async () => {
    const { ApiService } = await loadApiServiceModule({ siteType: 'sub2api' });
    const service = new ApiService();
    (service as any).fetchWithBrowserFallback = vi
      .fn()
      .mockResolvedValueOnce({
        result: {
          balance: 66.6,
        },
        pageRelease: undefined,
      })
      .mockResolvedValueOnce({
        result: {
          today_actual_cost: 2.5,
          today_prompt_tokens: 120,
          today_completion_tokens: 30,
          today_requests: 4,
        },
        pageRelease: undefined,
      });

    const result = await (service as any).getBalanceAndUsage(
      {
        id: 'site-1',
        name: 'Sub2API Site',
        url: 'https://demo.example.com',
        site_type: 'sub2api',
        system_token: 'jwt-token',
      },
      3000
    );

    expect((service as any).fetchWithBrowserFallback.mock.calls[0]?.[0]).toBe(
      'https://demo.example.com/api/v1/auth/me'
    );
    expect((service as any).fetchWithBrowserFallback.mock.calls[1]?.[0]).toBe(
      'https://demo.example.com/api/v1/usage/stats'
    );
    expect(result).toMatchObject({
      balance: 66.6,
      todayUsage: 2.5,
      todayPromptTokens: 120,
      todayCompletionTokens: 30,
      todayTotalTokens: 150,
      todayRequests: 4,
    });
  });

  it('sub2api 扩展数据中的 API Key 鉴权过期时，detectSite 应返回失败状态而不是空列表成功', async () => {
    const { ApiService } = await loadApiServiceModule({ siteType: 'sub2api' });
    const tokenService = {
      fetchApiTokens: vi.fn(async () => {
        throw new Error(
          '登录已过期或未登录，请点击"重新获取"登录站点 (sub2api API Key 接口返回: Token has expired)'
        );
      }),
      fetchUserGroups: vi.fn(async () => ({ default: { desc: '默认分组', ratio: 1 } })),
      fetchModelPricing: vi.fn(async () => ({ data: {} })),
      checkSiteSupportsCheckIn: vi.fn(async () => false),
    };
    const service = new ApiService(tokenService as any);
    (service as any).fetchWithBrowserFallback = vi
      .fn()
      .mockResolvedValueOnce({
        result: {
          balance: 66.6,
        },
        pageRelease: undefined,
      })
      .mockResolvedValueOnce({
        result: {
          today_actual_cost: 2.5,
          today_prompt_tokens: 120,
          today_completion_tokens: 30,
          today_requests: 4,
        },
        pageRelease: undefined,
      });

    const result = await service.detectSite(
      {
        id: 'site-1',
        name: 'Sub2API Site',
        url: 'https://demo.example.com',
        site_type: 'sub2api',
        system_token: 'jwt-token',
        user_id: '1',
        api_key: '',
        enabled: true,
      },
      3000,
      false,
      undefined,
      false,
      { accountId: 'acct-1', browserSlot: 0 }
    );

    expect(result.status).toBe('失败');
    expect(result.error).toContain('登录已过期或未登录');
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
