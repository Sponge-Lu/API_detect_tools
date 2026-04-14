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

    const { TokenService } = await import('../main/token-service');

    const chromeManager = {
      getLocalStorageData: vi.fn(async (_url, _wait, _max, _status, options) => {
        expect(options).toEqual({ loginMode: true });
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
});
