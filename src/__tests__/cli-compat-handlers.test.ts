import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadCliCompatHandlersModule() {
  vi.resetModules();

  const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    registeredHandlers.set(channel, handler);
  });
  const site = { id: 'site-1', name: 'Demo Site', url: 'https://demo.example.com' };
  const account = { id: 'acct-1', site_id: 'site-1', status: 'active' };
  const updateAccount = vi.fn(async () => true);
  const updateSite = vi.fn(async () => true);

  vi.doMock('electron', () => ({
    ipcMain: {
      handle: ipcHandle,
    },
  }));
  vi.doMock('../main/utils/logger', () => ({
    default: {
      scope: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    },
  }));
  vi.doMock('../main/cli-wrapper-compat-service', () => ({
    cliWrapperCompatService: {
      testClaudeCodeWithDetail: vi.fn(),
      testCodexWithDetail: vi.fn(),
      testGeminiWithDetail: vi.fn(),
    },
  }));
  vi.doMock('../main/route-cli-probe-service', () => ({
    generateProbeRunId: vi.fn(() => 'manual_1'),
    persistCliProbeSamples: vi.fn(async () => undefined),
  }));
  vi.doMock('../main/custom-cli-config-service', () => ({
    buildCustomCliRouteAccountId: vi.fn((id: string) => `custom-account:${id}`),
    buildCustomCliRouteApiKeyId: vi.fn((id: string) => `custom-key:${id}`),
    buildCustomCliRouteSiteId: vi.fn((id: string) => `custom-site:${id}`),
    loadCustomCliConfigStorage: vi.fn(async () => ({ configs: [], activeConfigId: null })),
  }));
  vi.doMock('../main/route-model-registry-service', () => ({
    resolveApiKeyId: vi.fn((apiKey: { id?: number | string; key?: string }) =>
      String(apiKey.id ?? apiKey.key ?? 'unknown')
    ),
  }));
  vi.doMock('../main/route-proxy-service', () => ({
    ensureRouteProxyReady: vi.fn(async () => ({ baseUrl: 'http://127.0.0.1:3210' })),
  }));
  vi.doMock('../main/route-probe-lock', () => ({
    buildProbeLockRouteApiKey: vi.fn(() => 'probe-lock:key'),
  }));
  vi.doMock('../main/unified-config-manager', () => ({
    unifiedConfigManager: {
      getSiteByUrl: vi.fn(() => site),
      getAccountById: vi.fn((accountId: string) => (accountId === account.id ? account : null)),
      exportConfigSync: vi.fn(() => ({ sites: [site], accounts: [account] })),
      updateAccount,
      updateSite,
    },
  }));

  return {
    ...(await import('../main/handlers/cli-compat-handlers')),
    registeredHandlers,
    updateAccount,
    updateSite,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('cli compat handlers', () => {
  it('saves managed CLI config to the selected account instead of the site', async () => {
    const { registerCliCompatHandlers, registeredHandlers, updateAccount, updateSite } =
      await loadCliCompatHandlersModule();
    const cliConfig = {
      codex: {
        enabled: true,
        testModels: ['account-model'],
      },
    };

    registerCliCompatHandlers();
    const saveHandler = registeredHandlers.get('cli-compat:save-config');
    expect(saveHandler).toBeDefined();

    await expect(
      saveHandler?.({}, 'https://demo.example.com', cliConfig, 'acct-1')
    ).resolves.toEqual({
      success: true,
    });

    expect(updateAccount).toHaveBeenCalledWith('acct-1', { cli_config: cliConfig });
    expect(updateSite).not.toHaveBeenCalled();
  });
});
