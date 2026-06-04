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

  it('recreateSub2ApiAccessTokenFromBrowser reads and validates browser JWT', async () => {
    const runOnPageQueue = vi.fn(async (_page: any, task: () => Promise<any>) => task());
    vi.doMock('../main/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
    vi.doMock('../main/utils/http-client', () => ({
      httpGet: vi.fn(),
      httpPost: vi.fn(),
      httpRequest: vi.fn(),
    }));
    vi.doMock('../main/utils/page-exec-queue', () => ({
      runOnPageQueue,
    }));
    vi.doMock('../main/site-type-detector', () => ({
      detectSiteType: vi.fn(async () => ({
        siteType: 'sub2api',
        detectionMethod: 'html-marker',
      })),
    }));
    vi.doMock('../main/unified-config-manager', () => ({
      unifiedConfigManager: {
        getSiteByUrl: vi.fn(() => ({
          id: 'site-sub2',
          url: 'https://sub2.example.com',
          site_type: 'sub2api',
        })),
      },
    }));

    const { TokenService } = await import('../main/token-service');

    const page = {
      content: vi.fn(async () => '<html><body>ok</body></html>'),
      isClosed: vi.fn(() => false),
      close: vi.fn(async () => undefined),
      evaluate: vi.fn(async (_fn: any, apiUrl: string, token: string) => {
        expect(apiUrl).toBe('https://sub2.example.com/api/v1/auth/me');
        expect(token).toBe('fresh-jwt');
        return {
          ok: true,
          status: 200,
          data: { code: 0, message: 'success', data: { id: 11154 } },
          text: '',
        };
      }),
    };
    const release = vi.fn();
    const chromeManager = {
      createPage: vi.fn(async () => ({ page, release })),
      readAuthDataFromPage: vi.fn(async () => ({
        userId: 11154,
        username: 'demo',
        systemName: 'Sub2 Site',
        accessToken: 'fresh-jwt',
        siteTypeHint: 'sub2api',
        dataSource: 'localStorage',
      })),
    };

    const service = new TokenService(chromeManager as any);
    const token = await service.recreateSub2ApiAccessTokenFromBrowser(
      'https://sub2.example.com/',
      11154,
      {
        browserSlot: 2,
        challengeWaitMs: 1,
      }
    );

    expect(token).toBe('fresh-jwt');
    expect(chromeManager.createPage).toHaveBeenCalledWith('https://sub2.example.com', {
      slot: 2,
    });
    expect(chromeManager.readAuthDataFromPage).toHaveBeenCalledWith(
      page,
      'https://sub2.example.com',
      { siteType: 'sub2api' }
    );
    expect(runOnPageQueue).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
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

  it('openSiteWithProfileForCheckin 应复用账户 Profile 登录态并在识别后等待关闭', async () => {
    vi.useFakeTimers();

    try {
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
      const launchForLoginSpy = vi
        .spyOn(manager, 'launchForLogin')
        .mockResolvedValue({ success: true, message: 'ok' });
      const getLocalStorageDataSpy = vi.spyOn(manager, 'getLocalStorageData').mockResolvedValue({
        userId: 7,
        username: 'demo',
        systemName: 'Any Router',
        accessToken: 'token',
        siteTypeHint: 'newapi',
        resolvedBaseUrl: 'https://anyrouter.top',
        dataSource: 'mixed',
        supportsCheckIn: true,
        canCheckIn: false,
      } as any);
      const cleanupLoginBrowserSpy = vi
        .spyOn(manager, 'cleanupLoginBrowser')
        .mockImplementation(() => {});

      const resultPromise = manager.openSiteWithProfileForCheckin(
        'https://anyrouter.top',
        { userDataDir: 'C:/profiles/acct-1' },
        {
          siteType: 'newapi',
          maxWaitTimeMs: 30000,
          closeDelayMs: 2000,
        }
      );

      await vi.advanceTimersByTimeAsync(2000);
      const result = await resultPromise;

      expect(launchForLoginSpy).toHaveBeenCalledWith(
        'https://anyrouter.top',
        { userDataDir: 'C:/profiles/acct-1' },
        { preserveSession: true }
      );
      expect(getLocalStorageDataSpy).toHaveBeenCalledWith(
        'https://anyrouter.top',
        true,
        30000,
        undefined,
        {
          loginMode: true,
          siteType: 'newapi',
        }
      );
      expect(cleanupLoginBrowserSpy).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        success: true,
        message: '已识别到账户登录状态并完成签到浏览器流程',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('browser-profile:open-site-for-checkin 应按账户 Profile 打开站点并在识别登录后 2 秒关闭', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const loadConfig = vi.fn(async () => undefined);
    const getSiteById = vi.fn(() => ({
      id: 'site-1',
      site_type: 'newapi',
    }));
    const getAccountById = vi.fn(() => ({
      id: 'acct-1',
      site_id: 'site-1',
      auth_source: 'isolated_profile',
      browser_profile_path: 'C:/profiles/acct-1',
    }));
    const openSiteWithProfileForCheckin = vi.fn(async () => ({ success: true }));

    vi.doMock('electron', () => ({
      ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
          handlers.set(channel, handler);
        }),
      },
      shell: { openExternal: vi.fn() },
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
    vi.doMock('../main/unified-config-manager', () => ({
      unifiedConfigManager: {
        loadConfig,
        getAccountById,
        getSiteById,
      },
    }));
    vi.doMock('../main/browser-profile-manager', () => ({
      browserProfileManager: {
        detectMainChromeProfile: vi.fn(),
        getIsolatedProfileLaunchOptions: vi.fn(),
        deleteIsolatedProfile: vi.fn(),
        getMainProfileLaunchOptions: vi.fn(),
        isChromeRunning: vi.fn(),
      },
    }));
    vi.doMock('../main/site-type-detector', () => ({
      detectSiteType: vi.fn(),
    }));
    vi.doMock('../main/site-type-registry', () => ({
      getSiteTypeProfile: vi.fn(() => ({ accessTokenMode: 'create-if-missing' })),
    }));

    const { registerBrowserProfileHandlers } = await import(
      '../main/handlers/browser-profile-handlers'
    );
    registerBrowserProfileHandlers(
      {
        openSiteWithProfileForCheckin,
      } as any,
      () => null
    );

    const result = await handlers.get('browser-profile:open-site-for-checkin')?.(
      {},
      'site-1',
      'https://anyrouter.top',
      'acct-1'
    );

    expect(loadConfig).toHaveBeenCalledTimes(3);
    expect(getAccountById).toHaveBeenCalledWith('acct-1');
    expect(getSiteById).toHaveBeenCalledWith('site-1');
    expect(openSiteWithProfileForCheckin).toHaveBeenCalledWith(
      'https://anyrouter.top',
      {
        userDataDir: 'C:/profiles/acct-1',
      },
      {
        siteType: 'newapi',
        maxWaitTimeMs: 120000,
        closeDelayMs: 2000,
      }
    );
    expect(result).toEqual({ success: true });
  });

  it('browser-profile:open-site-for-checkin 应让 manual 默认账户复用默认浏览器链路', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const loadConfig = vi.fn(async () => undefined);
    const getAccountById = vi.fn(() => ({
      id: 'acct-default',
      site_id: 'site-1',
      account_name: '默认账户',
      auth_source: 'manual',
    }));
    const openExternal = vi.fn(async () => undefined);
    const openSiteWithProfileForCheckin = vi.fn(async () => ({ success: true }));

    vi.doMock('electron', () => ({
      ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
          handlers.set(channel, handler);
        }),
      },
      shell: { openExternal },
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
    vi.doMock('../main/unified-config-manager', () => ({
      unifiedConfigManager: {
        loadConfig,
        getAccountById,
      },
    }));
    vi.doMock('../main/browser-profile-manager', () => ({
      browserProfileManager: {
        detectMainChromeProfile: vi.fn(),
        getIsolatedProfileLaunchOptions: vi.fn(),
        deleteIsolatedProfile: vi.fn(),
        getMainProfileLaunchOptions: vi.fn(),
        isChromeRunning: vi.fn(),
      },
    }));
    vi.doMock('../main/site-type-detector', () => ({
      detectSiteType: vi.fn(),
    }));
    vi.doMock('../main/site-type-registry', () => ({
      getSiteTypeProfile: vi.fn(() => ({ accessTokenMode: 'create-if-missing' })),
    }));

    const { registerBrowserProfileHandlers } = await import(
      '../main/handlers/browser-profile-handlers'
    );
    registerBrowserProfileHandlers(
      {
        openSiteWithProfileForCheckin,
      } as any,
      () => null
    );

    const result = await handlers.get('browser-profile:open-site-for-checkin')?.(
      {},
      'site-1',
      'https://anyrouter.top',
      'acct-default'
    );

    expect(loadConfig).toHaveBeenCalledTimes(2);
    expect(getAccountById).toHaveBeenCalledWith('acct-default');
    expect(openExternal).toHaveBeenCalledWith('https://anyrouter.top');
    expect(openSiteWithProfileForCheckin).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: '已使用默认浏览器打开站点并记为签到完成',
    });
  });

  it('browser-profile:persist-checkin-completion 应将签到状态写入账户 cached_data', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const loadConfig = vi.fn(async () => undefined);
    const getAccountById = vi.fn(() => ({
      id: 'acct-anyrouter',
      site_id: 'site-1',
    }));
    const updateAccountCachedData = vi.fn(async (_accountId: string, updater: any) => {
      const next = updater({
        has_checkin: true,
        can_check_in: true,
        checkin_stats: {
          checkin_count: 3,
        },
      });
      expect(next).toEqual({
        has_checkin: true,
        can_check_in: false,
        last_refresh: 1234567890,
        checkin_stats: {
          today_quota: 12500000,
          checkin_count: 3,
          site_type: 'newapi',
        },
      });
      return true;
    });

    vi.doMock('electron', () => ({
      ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
          handlers.set(channel, handler);
        }),
      },
      shell: { openExternal: vi.fn() },
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
    vi.doMock('../main/unified-config-manager', () => ({
      unifiedConfigManager: {
        loadConfig,
        getAccountById,
        updateAccountCachedData,
      },
    }));
    vi.doMock('../main/browser-profile-manager', () => ({
      browserProfileManager: {
        detectMainChromeProfile: vi.fn(),
        getIsolatedProfileLaunchOptions: vi.fn(),
        deleteIsolatedProfile: vi.fn(),
        getMainProfileLaunchOptions: vi.fn(),
        isChromeRunning: vi.fn(),
      },
    }));
    vi.doMock('../main/site-type-detector', () => ({
      detectSiteType: vi.fn(),
    }));
    vi.doMock('../main/site-type-registry', () => ({
      getSiteTypeProfile: vi.fn(() => ({ accessTokenMode: 'create-if-missing' })),
    }));

    const { registerBrowserProfileHandlers } = await import(
      '../main/handlers/browser-profile-handlers'
    );
    registerBrowserProfileHandlers({} as any, () => null);

    const result = await handlers.get('browser-profile:persist-checkin-completion')?.(
      {},
      'site-1',
      'acct-anyrouter',
      {
        has_checkin: true,
        can_check_in: false,
        last_refresh: 1234567890,
        checkin_stats: {
          today_quota: 12500000,
          checkin_count: 3,
          site_type: 'newapi',
        },
      }
    );

    expect(loadConfig).toHaveBeenCalledTimes(2);
    expect(getAccountById).toHaveBeenCalledWith('acct-anyrouter');
    expect(updateAccountCachedData).toHaveBeenCalledWith('acct-anyrouter', expect.any(Function));
    expect(result).toEqual({ success: true });
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

  it('tryGetFromLocalStorage 不应仅因 auth_user/auth_token 推断为 sub2api', async () => {
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
            if (key === 'auth_user') return JSON.stringify({ id: 9, username: 'newapi-user' });
            return null;
          },
        };
        delete (globalThis as any).__APP_CONFIG__;

        try {
          return fn();
        } finally {
          (globalThis as any).localStorage = originalLocalStorage;
          (globalThis as any).__APP_CONFIG__ = originalAppConfig;
        }
      }),
    };

    const result = await (manager as any).tryGetFromLocalStorage(page);

    expect(result.userId).toBe(9);
    expect(result.accessToken).toBe('jwt-token');
    expect(result.siteTypeHint).toBeNull();
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

  it('detect-site for sub2api account re-reads browser JWT instead of creating access token', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const updateAccount = vi.fn(async () => true);
    const getAccountById = vi.fn(() => ({
      id: 'acct-sub2',
      site_id: 'site-sub2',
      user_id: '11154',
      access_token: 'old-jwt',
    }));
    const getSiteById = vi.fn(() => ({
      id: 'site-sub2',
      name: 'Sub2 Site',
      url: 'https://sub2.example.com/',
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
        getAccountsBySiteId: vi.fn(() => [{ id: 'acct-sub2' }]),
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
          name: 'Sub2 Site',
          url: 'https://sub2.example.com/',
          status: '失败',
          error:
            '登录已过期或未登录，请点击"重新获取"登录站点 (sub2api API Key 接口返回: Token has expired)',
          models: [],
          has_checkin: false,
        })
        .mockResolvedValueOnce({
          name: 'Sub2 Site',
          url: 'https://sub2.example.com/',
          status: '成功',
          models: ['gpt-4o'],
          has_checkin: false,
        }),
    };
    const tokenService = {
      recreateSub2ApiAccessTokenFromBrowser: vi.fn(async () => 'fresh-sub2-jwt'),
      recreateAccessTokenFromBrowser: vi.fn(async () => 'generic-token'),
    };

    registerDetectionHandlers(apiService as any, {} as any, tokenService as any);

    const detectHandler = handlers.get('detect-site');
    const result = await detectHandler?.(
      {},
      { id: 'site-sub2', name: 'stale-name', url: 'https://stale.example.com/' },
      30,
      true,
      undefined,
      false,
      'acct-sub2'
    );

    expect(tokenService.recreateSub2ApiAccessTokenFromBrowser).toHaveBeenCalledWith(
      'https://sub2.example.com/',
      11154,
      {
        browserSlot: 0,
        challengeWaitMs: 10000,
      }
    );
    expect(tokenService.recreateAccessTokenFromBrowser).not.toHaveBeenCalled();
    expect(updateAccount).toHaveBeenCalledWith('acct-sub2', {
      access_token: 'fresh-sub2-jwt',
      status: 'active',
    });
    expect(apiService.detectSite.mock.calls[1][0]).toMatchObject({
      url: 'https://sub2.example.com/',
      system_token: 'fresh-sub2-jwt',
      user_id: '11154',
    });
    expect(result?.status).toBe('成功');
  });

  it('detect-site for sub2api account keeps the first failure when browser JWT renewal fails', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const updateAccount = vi.fn(async () => true);
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
        getAccountById: vi.fn(() => ({
          id: 'acct-sub2',
          site_id: 'site-sub2',
          user_id: '11154',
          access_token: 'old-jwt',
        })),
        getSiteById: vi.fn(() => ({
          id: 'site-sub2',
          name: 'Sub2 Site',
          url: 'https://sub2.example.com/',
          enabled: true,
          group: 'default',
          site_type: 'sub2api',
        })),
        getAccountsBySiteId: vi.fn(() => [{ id: 'acct-sub2' }]),
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
    const firstFailure = {
      name: 'Sub2 Site',
      url: 'https://sub2.example.com/',
      status: '失败',
      error:
        '登录已过期或未登录，请点击"重新获取"登录站点 (sub2api API Key 接口返回: Token has expired)',
      models: [],
      has_checkin: false,
    };
    const apiService = {
      detectSite: vi.fn().mockResolvedValue(firstFailure),
    };
    const tokenService = {
      recreateSub2ApiAccessTokenFromBrowser: vi.fn(async () => {
        throw new Error('sub2api 浏览器登录态中未找到 JWT 凭证，请重新登录站点');
      }),
      recreateAccessTokenFromBrowser: vi.fn(async () => 'generic-token'),
    };

    registerDetectionHandlers(apiService as any, {} as any, tokenService as any);

    const detectHandler = handlers.get('detect-site');
    const result = await detectHandler?.(
      {},
      { id: 'site-sub2', name: 'stale-name', url: 'https://stale.example.com/' },
      30,
      true,
      undefined,
      false,
      'acct-sub2'
    );

    expect(apiService.detectSite).toHaveBeenCalledTimes(1);
    expect(tokenService.recreateSub2ApiAccessTokenFromBrowser).toHaveBeenCalledTimes(1);
    expect(tokenService.recreateAccessTokenFromBrowser).not.toHaveBeenCalled();
    expect(updateAccount).not.toHaveBeenCalled();
    expect(result).toBe(firstFailure);
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
