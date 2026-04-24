import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('browser login flow', () => {
  it('initializeSiteAccount uses login browser state when loginMode is enabled', async () => {
    vi.doMock('../main/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
    vi.doMock('../main/utils/http-client', () => ({
      httpGet: vi.fn(),
      httpPost: vi.fn(),
      httpRequest: vi.fn(),
    }));
    vi.doMock('../main/utils/page-exec-queue', () => ({
      runOnPageQueue: vi.fn(),
    }));
    vi.doMock('../main/site-type-detector', () => ({
      detectSiteType: vi.fn(async () => ({
        siteType: 'newapi',
        detectionMethod: 'fallback',
      })),
    }));
    vi.doMock('../main/unified-config-manager', () => ({
      unifiedConfigManager: {
        getSiteByUrl: vi.fn(() => ({
          id: 'site-1',
          url: 'https://demo.example.com',
          site_type: 'newapi',
        })),
      },
    }));

    const { TokenService } = await import('../main/token-service');

    const chromeManager = {
      getLocalStorageData: vi.fn(async (_url, _wait, _max, _status, options) => {
        expect(options).toEqual({ loginMode: true, siteType: 'newapi' });
        return {
          userId: 7,
          username: 'demo',
          systemName: 'Demo Site',
          accessToken: null,
          supportsCheckIn: true,
          canCheckIn: true,
        };
      }),
      createAccessTokenForLogin: vi.fn(async () => 'login-browser-token'),
    };

    const service = new TokenService(chromeManager as any);
    const result = await service.initializeSiteAccount(
      'https://demo.example.com',
      true,
      600000,
      undefined,
      { loginMode: true }
    );

    expect(chromeManager.createAccessTokenForLogin).toHaveBeenCalledWith(
      'https://demo.example.com',
      7
    );
    expect(result.access_token).toBe('login-browser-token');
  });

  it('createAccessTokenForLogin 应优先复用已回到目标站点的登录页', async () => {
    vi.doMock('puppeteer-core', () => ({
      default: {},
    }));
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => 'C:/tmp'),
      },
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const { ChromeManager } = await import('../main/chrome-manager');
    const manager = new ChromeManager();

    const oauthPage = {
      url: vi.fn(() => 'https://accounts.example.com/oauth'),
      goto: vi.fn(async () => undefined),
      evaluate: vi.fn(),
      isClosed: vi.fn(() => false),
    };
    const sitePage = {
      url: vi.fn(() => 'https://demo.example.com/dashboard'),
      goto: vi.fn(async () => undefined),
      evaluate: vi.fn(async (_fn: any, apiUrl: string, uid: number) => {
        expect(apiUrl).toBe('https://demo.example.com/api/user/token');
        expect(uid).toBe(7);
        return 'login-browser-token';
      }),
      isClosed: vi.fn(() => false),
    };

    (manager as any).loginBrowserState = {
      browser: {
        pages: vi.fn(async () => [oauthPage, sitePage]),
      },
      chromeProcess: null,
      debugPort: 0,
      isClosed: false,
      abortController: new AbortController(),
    };

    const token = await manager.createAccessTokenForLogin('https://demo.example.com', 7);

    expect(token).toBe('login-browser-token');
    expect(sitePage.evaluate).toHaveBeenCalledTimes(1);
    expect(sitePage.goto).not.toHaveBeenCalled();
    expect(oauthPage.goto).not.toHaveBeenCalled();
  });

  it('createAccessTokenForLogin 在当前页不在目标域名时应先导航回站点', async () => {
    vi.doMock('puppeteer-core', () => ({
      default: {},
    }));
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => 'C:/tmp'),
      },
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const { ChromeManager } = await import('../main/chrome-manager');
    const manager = new ChromeManager();

    const page = {
      url: vi.fn(() => 'https://accounts.example.com/oauth'),
      goto: vi.fn(async () => undefined),
      evaluate: vi.fn(async (_fn: any, apiUrl: string, uid: number) => {
        expect(apiUrl).toBe('https://demo.example.com/api/user/token');
        expect(uid).toBe(7);
        return 'login-browser-token';
      }),
      isClosed: vi.fn(() => false),
    };

    (manager as any).loginBrowserState = {
      browser: {
        pages: vi.fn(async () => [page]),
      },
      chromeProcess: null,
      debugPort: 0,
      isClosed: false,
      abortController: new AbortController(),
    };

    const token = await manager.createAccessTokenForLogin('https://demo.example.com', 7);

    expect(token).toBe('login-browser-token');
    expect(page.goto).toHaveBeenCalledWith('https://demo.example.com', {
      waitUntil: 'networkidle0',
      timeout: 10000,
    });
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('createAccessTokenForLogin 应使用当前页面的 https origin 修正 http 站点基址', async () => {
    vi.doMock('puppeteer-core', () => ({
      default: {},
    }));
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => 'C:/tmp'),
      },
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const { ChromeManager } = await import('../main/chrome-manager');
    const manager = new ChromeManager();

    const page = {
      url: vi.fn(() => 'https://demo.example.com/dashboard'),
      goto: vi.fn(async () => undefined),
      evaluate: vi.fn(async (_fn: any, apiUrl: string, uid: number) => {
        expect(apiUrl).toBe('https://demo.example.com/api/user/token');
        expect(uid).toBe(7);
        return 'login-browser-token';
      }),
      isClosed: vi.fn(() => false),
    };

    (manager as any).loginBrowserState = {
      browser: {
        pages: vi.fn(async () => [page]),
      },
      chromeProcess: null,
      debugPort: 0,
      isClosed: false,
      abortController: new AbortController(),
    };

    const token = await manager.createAccessTokenForLogin('http://demo.example.com', 7);

    expect(token).toBe('login-browser-token');
    expect(page.goto).not.toHaveBeenCalled();
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('getUserDataFromApi 应在 API 验证阶段使用页面实际的 https origin', async () => {
    vi.doMock('puppeteer-core', () => ({
      default: {},
    }));
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => 'C:/tmp'),
      },
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const { ChromeManager } = await import('../main/chrome-manager');
    const manager = new ChromeManager();

    const page = {
      url: vi.fn(() => ':'),
      goto: vi.fn(async () => undefined),
      evaluate: vi.fn(async (...args: any[]) => {
        const requestUrl = args[1];
        if (typeof requestUrl !== 'string') {
          return 'https://demo.example.com/dashboard';
        }
        if (requestUrl === 'https://demo.example.com/api/user/self') {
          return {
            userId: 7,
            username: 'demo',
            accessToken: null,
            systemName: null,
            siteTypeHint: null,
          };
        }
        if (requestUrl === 'https://demo.example.com/api/status') {
          return 'Demo Site';
        }
        throw new Error(`Unexpected URL: ${requestUrl}`);
      }),
      isClosed: vi.fn(() => false),
    };

    (manager as any).loginBrowserState = {
      browser: null,
      chromeProcess: null,
      debugPort: 0,
      isClosed: false,
      abortController: new AbortController(),
    };

    const result = await (manager as any).getUserDataFromApi(
      page,
      'http://demo.example.com',
      'newapi',
      true
    );

    expect(result).toMatchObject({
      userId: 7,
      username: 'demo',
      systemName: 'Demo Site',
    });
    expect(page.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      'https://demo.example.com/api/user/self'
    );
    expect(page.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      'https://demo.example.com/api/status'
    );
  });

  it('getLocalStorageData 在首次 API 验证成功后不应重复请求 API 补全', async () => {
    vi.doMock('puppeteer-core', () => ({
      default: {},
    }));
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => 'C:/tmp'),
      },
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const { ChromeManager } = await import('../main/chrome-manager');
    const manager = new ChromeManager();

    const page = {
      isClosed: vi.fn(() => false),
    };

    (manager as any).loginBrowserState = {
      browser: {
        pages: vi.fn(async () => [page]),
      },
      chromeProcess: null,
      debugPort: 0,
      isClosed: false,
      abortController: new AbortController(),
    };

    vi.spyOn(manager as any, 'waitAndReadLocalStorage').mockResolvedValue({
      userId: 7,
      username: 'demo',
      systemName: 'Demo Site',
      accessToken: null,
      siteTypeHint: null,
      resolvedBaseUrl: null,
      dataSource: 'localStorage',
      supportsCheckIn: true,
      canCheckIn: true,
    });
    const getUserDataFromApiSpy = vi.spyOn(manager as any, 'getUserDataFromApi').mockResolvedValue({
      userId: 7,
      username: 'demo',
      systemName: 'Demo Site',
      accessToken: null,
      siteTypeHint: null,
      resolvedBaseUrl: null,
      dataSource: 'api',
      supportsCheckIn: true,
      canCheckIn: true,
    });
    vi.spyOn(manager as any, 'resolveEffectiveBaseUrl').mockResolvedValue(
      'https://demo.example.com'
    );

    const result = await (manager as any).getLocalStorageData(
      'http://demo.example.com',
      true,
      600000,
      undefined,
      {
        loginMode: true,
        siteType: 'newapi',
      }
    );

    expect(getUserDataFromApiSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      userId: 7,
      dataSource: 'mixed',
      resolvedBaseUrl: 'https://demo.example.com',
    });
  });

  it('close-login-browser only cleans the login browser state', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();

    vi.doMock('electron', () => ({
      ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
          handlers.set(channel, handler);
        }),
        on: vi.fn(),
      },
      shell: { openExternal: vi.fn() },
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
    vi.doMock('../main/unified-config-manager', () => ({
      unifiedConfigManager: {
        getAccountById: vi.fn(),
        getAccountsBySiteId: vi.fn(() => []),
      },
    }));
    vi.doMock('../main/config-detection-service', () => ({
      configDetectionService: {
        detectClaudeCode: vi.fn(),
        detectCodex: vi.fn(),
        detectGeminiCli: vi.fn(),
        detectAll: vi.fn(),
      },
    }));

    const { registerDetectionHandlers } = await import('../main/handlers/detection-handlers');
    const chromeManager = {
      cleanup: vi.fn(),
      cleanupLoginBrowser: vi.fn(),
      launchForLogin: vi.fn(),
    };

    registerDetectionHandlers({} as any, chromeManager as any, {} as any);
    await handlers.get('close-login-browser')?.({});

    expect(chromeManager.cleanupLoginBrowser).toHaveBeenCalledTimes(1);
    expect(chromeManager.cleanup).not.toHaveBeenCalled();
  });

  it('tryGetFromLocalStorage 应从 __APP_CONFIG__.site_subtitle 提取 sub2api 公益站名称', async () => {
    vi.doMock('puppeteer-core', () => ({
      default: {},
    }));
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => 'C:/tmp'),
      },
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const { ChromeManager } = await import('../main/chrome-manager');
    const manager = new ChromeManager();

    const page = {
      evaluate: vi.fn(async (fn: () => any) => {
        const originalLocalStorage = (globalThis as any).localStorage;
        const originalAppConfig = (globalThis as any).__APP_CONFIG__;

        (globalThis as any).localStorage = {
          getItem: (key: string) => {
            if (key === 'auth_token') return 'jwt-token';
            if (key === 'auth_user') return JSON.stringify({ id: 9, username: 'sub-user' });
            return null;
          },
        };
        (globalThis as any).__APP_CONFIG__ = {
          site_subtitle: 'AC_公益站',
          custom_menu_items: [],
          backend_mode_enabled: false,
        };

        try {
          return fn();
        } finally {
          (globalThis as any).localStorage = originalLocalStorage;
          (globalThis as any).__APP_CONFIG__ = originalAppConfig;
        }
      }),
    };

    const result = await (manager as any).tryGetFromLocalStorage(page);

    expect(result.systemName).toBe('AC_公益站');
    expect(result.siteTypeHint).toBe('sub2api');
  });

  it('detect-site for account uses canonical site info and retries once after refreshing token', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const updateAccount = vi.fn(async () => true);
    const getAccountById = vi.fn(() => ({
      id: 'acct-1',
      site_id: 'site-1',
      user_id: '6110',
      access_token: 'old-token',
    }));
    const getSiteById = vi.fn(() => ({
      id: 'site-1',
      name: 'Huan API',
      url: 'https://ai.huan666.de/',
      enabled: true,
      group: 'default',
    }));

    vi.doMock('electron', () => ({
      ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
          handlers.set(channel, handler);
        }),
        on: vi.fn(),
      },
      shell: { openExternal: vi.fn() },
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
    vi.doMock('../main/unified-config-manager', () => ({
      unifiedConfigManager: {
        loadConfig: vi.fn(async () => true),
        getAccountById,
        getSiteById,
        getAccountsBySiteId: vi.fn(() => [{ id: 'acct-1' }]),
        updateAccount,
      },
    }));
    vi.doMock('../main/config-detection-service', () => ({
      configDetectionService: {
        detectClaudeCode: vi.fn(),
        detectCodex: vi.fn(),
        detectGeminiCli: vi.fn(),
        detectAll: vi.fn(),
      },
    }));

    const { registerDetectionHandlers } = await import('../main/handlers/detection-handlers');
    const apiService = {
      detectSite: vi
        .fn()
        .mockResolvedValueOnce({
          name: 'Huan API',
          url: 'https://ai.huan666.de/',
          status: '失败',
          error: '模型接口返回空数据 (登录可能已过期，请点击"重新获取"登录站点)',
          models: [],
          has_checkin: false,
        })
        .mockResolvedValueOnce({
          name: 'Huan API',
          url: 'https://ai.huan666.de/',
          status: '成功',
          models: ['gpt-4o'],
          has_checkin: false,
        }),
    };
    const tokenService = {
      recreateAccessTokenFromBrowser: vi.fn(async () => 'new-token'),
    };

    registerDetectionHandlers(apiService as any, {} as any, tokenService as any);

    const detectHandler = handlers.get('detect-site');
    const result = await detectHandler?.(
      {},
      { id: 'site-1', name: 'stale-name', url: 'https://stale.example.com/' },
      30,
      true,
      undefined,
      false,
      'acct-1'
    );

    expect(apiService.detectSite).toHaveBeenCalledTimes(2);
    expect(apiService.detectSite.mock.calls[0][0]).toMatchObject({
      id: 'site-1',
      name: 'Huan API',
      url: 'https://ai.huan666.de/',
      system_token: 'old-token',
      user_id: '6110',
    });
    expect(tokenService.recreateAccessTokenFromBrowser).toHaveBeenCalledWith(
      'https://ai.huan666.de/',
      6110,
      {
        browserSlot: 0,
        challengeWaitMs: 10000,
      }
    );
    expect(updateAccount).toHaveBeenCalledWith('acct-1', {
      access_token: 'new-token',
      status: 'active',
    });
    expect(apiService.detectSite.mock.calls[1][0]).toMatchObject({
      url: 'https://ai.huan666.de/',
      system_token: 'new-token',
    });
    expect(result?.status).toBe('成功');
  });

  it('detect-site for account should not retry access_token refresh when error points to invalid api_key', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const updateAccount = vi.fn(async () => true);
    const getAccountById = vi.fn(() => ({
      id: 'acct-1',
      site_id: 'site-1',
      user_id: '6173',
      access_token: 'old-token',
    }));
    const getSiteById = vi.fn(() => ({
      id: 'site-1',
      name: 'API Site',
      url: 'https://sub.jlypx.de/',
      enabled: true,
      group: 'default',
      site_type: 'sub2api',
    }));

    vi.doMock('electron', () => ({
      ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
          handlers.set(channel, handler);
        }),
        on: vi.fn(),
      },
      shell: { openExternal: vi.fn() },
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
    vi.doMock('../main/unified-config-manager', () => ({
      unifiedConfigManager: {
        loadConfig: vi.fn(async () => true),
        getAccountById,
        getSiteById,
        getAccountsBySiteId: vi.fn(() => [{ id: 'acct-1' }]),
        updateAccount,
      },
    }));
    vi.doMock('../main/config-detection-service', () => ({
      configDetectionService: {
        detectClaudeCode: vi.fn(),
        detectCodex: vi.fn(),
        detectGeminiCli: vi.fn(),
        detectAll: vi.fn(),
      },
    }));

    const { registerDetectionHandlers } = await import('../main/handlers/detection-handlers');
    const apiService = {
      detectSite: vi.fn().mockResolvedValue({
        name: 'API Site',
        url: 'https://sub.jlypx.de/',
        status: '失败',
        error: '模型接口返回空数据 (API Key 可能已失效或无权访问，请检查或重新同步 API Key)',
        models: [],
        has_checkin: false,
      }),
    };
    const tokenService = {
      recreateAccessTokenFromBrowser: vi.fn(async () => 'new-token'),
    };

    registerDetectionHandlers(apiService as any, {} as any, tokenService as any);

    const detectHandler = handlers.get('detect-site');
    const result = await detectHandler?.(
      {},
      { id: 'site-1', name: 'stale-name', url: 'https://stale.example.com/' },
      30,
      true,
      undefined,
      false,
      'acct-1'
    );

    expect(apiService.detectSite).toHaveBeenCalledTimes(1);
    expect(tokenService.recreateAccessTokenFromBrowser).not.toHaveBeenCalled();
    expect(updateAccount).not.toHaveBeenCalled();
    expect(result?.status).toBe('失败');
  });
});
