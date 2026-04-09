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
});
