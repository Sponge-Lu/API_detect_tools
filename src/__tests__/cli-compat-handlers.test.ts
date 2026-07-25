import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
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
  const testClaudeCodeWithDetail = vi.fn();
  const testCodexWithDetail = vi.fn();
  const persistCliProbeSamples = vi.fn(async () => undefined);

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
      testClaudeCodeWithDetail,
      testCodexWithDetail,
    },
  }));
  vi.doMock('../main/route-cli-probe-service', () => ({
    generateProbeRunId: vi.fn(() => 'manual_1'),
    persistCliProbeSamples,
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
    testClaudeCodeWithDetail,
    testCodexWithDetail,
    persistCliProbeSamples,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('cli compat handlers', () => {
  it('rejects OpenCode manual probe payloads before invoking an executor', async () => {
    const {
      registerCliCompatHandlers,
      registeredHandlers,
      testClaudeCodeWithDetail,
      testCodexWithDetail,
    } = await loadCliCompatHandlersModule();

    registerCliCompatHandlers();
    const testHandler = registeredHandlers.get('cli-compat:test-with-wrapper');

    await expect(
      testHandler?.(
        {},
        {
          siteUrl: 'https://demo.example.com',
          configs: [
            {
              cliType: 'openCode',
              apiKey: 'sk-test',
              model: 'gpt-4.1',
            },
          ],
        }
      )
    ).resolves.toEqual({
      success: false,
      error: 'CLI probe is not supported for: openCode',
    });
    expect(testClaudeCodeWithDetail).not.toHaveBeenCalled();
    expect(testCodexWithDetail).not.toHaveBeenCalled();
  });

  it('rejects forged OpenCode samples before persisting manual probe history', async () => {
    const { registerCliCompatHandlers, registeredHandlers, persistCliProbeSamples } =
      await loadCliCompatHandlersModule();

    registerCliCompatHandlers();
    const saveHandler = registeredHandlers.get('cli-compat:save-result');

    await expect(
      saveHandler?.(
        {},
        'https://demo.example.com',
        {
          claudeCode: null,
          codex: null,
          openCode: true,
          testedAt: Date.now(),
        },
        'acct-1',
        [
          {
            cliType: 'openCode',
            model: 'gpt-4.1',
            success: true,
            testedAt: Date.now(),
          },
        ]
      )
    ).resolves.toEqual({
      success: false,
      error: 'CLI probe is not supported for: openCode',
    });
    expect(persistCliProbeSamples).not.toHaveBeenCalled();
  });

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

  it('deep-merges managed OpenCode providers without replacing user providers', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-detect-opencode-'));
    const configPath = path.join(tempDir, 'opencode.json');
    const existingConfig = {
      $schema: 'https://opencode.ai/config.json',
      model: 'user-provider/user-model',
      provider: {
        'user-provider': {
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL: 'https://user.example.com/v1' },
          models: { 'user-model': { name: 'User model' } },
        },
      },
    };
    const managedConfig = {
      $schema: 'https://opencode.ai/config.json',
      model: 'api-detect-responses/route-model',
      provider: Object.fromEntries(
        ['api-detect-anthropic', 'api-detect-responses', 'api-detect-chat'].map(providerId => [
          providerId,
          {
            options: {
              baseURL: 'http://127.0.0.1:3210/v1',
              headers: { 'x-api-detect-cli': 'openCode' },
            },
            models: { 'route-model': { name: 'route-model' } },
          },
        ])
      ),
    };

    try {
      await fs.writeFile(configPath, JSON.stringify(existingConfig), 'utf-8');
      const { registerCliCompatHandlers, registeredHandlers } = await loadCliCompatHandlersModule();
      registerCliCompatHandlers();
      const writeHandler = registeredHandlers.get('cli-compat:write-config');
      expect(writeHandler).toBeDefined();

      const payload = {
        cliType: 'openCode',
        files: [{ path: configPath, content: JSON.stringify(managedConfig) }],
        applyMode: 'merge',
      };
      await expect(writeHandler?.({}, payload)).resolves.toMatchObject({ success: true });
      await expect(writeHandler?.({}, payload)).resolves.toMatchObject({ success: true });

      const merged = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      expect(merged.model).toBe('api-detect-responses/route-model');
      expect(merged.provider['user-provider']).toEqual(existingConfig.provider['user-provider']);
      expect(Object.keys(merged.provider)).toEqual(
        expect.arrayContaining([
          'user-provider',
          'api-detect-anthropic',
          'api-detect-responses',
          'api-detect-chat',
        ])
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('merges Grok Build managed models without deleting user model sections', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-detect-grok-build-'));
    const configPath = path.join(tempDir, 'config.toml');
    const existingConfig = `[models]
default = "user-model"

[model.user-model]
model = "grok-code-fast-1"
base_url = "https://user.example.com/v1"
api_backend = "responses"

[mcp.user-tool]
command = "user-tool"`;
    const managedConfig = `[models]
default = "api-detect-grok-responses"

[model.api-detect-grok-responses]
model = "route-model"
base_url = "http://127.0.0.1:3210/v1"
api_key = "sk-route"
api_backend = "responses"
extra_headers = { "x-api-detect-cli" = "grokBuild" }

[model.api-detect-grok-chat]
model = "route-model"
base_url = "http://127.0.0.1:3210/v1"
api_key = "sk-route"
api_backend = "chat_completions"

[model.api-detect-grok-messages]
model = "route-model"
base_url = "http://127.0.0.1:3210/v1"
api_key = "sk-route"
api_backend = "messages"`;

    try {
      await fs.writeFile(configPath, `\uFEFF${existingConfig}`, 'utf-8');
      const { registerCliCompatHandlers, registeredHandlers } = await loadCliCompatHandlersModule();
      registerCliCompatHandlers();
      const writeHandler = registeredHandlers.get('cli-compat:write-config');
      const payload = {
        cliType: 'grokBuild',
        files: [{ path: configPath, content: managedConfig }],
        applyMode: 'merge',
      };

      await expect(writeHandler?.({}, payload)).resolves.toMatchObject({ success: true });
      await expect(writeHandler?.({}, payload)).resolves.toMatchObject({ success: true });

      const merged = await fs.readFile(configPath, 'utf-8');
      expect(merged.charCodeAt(0)).not.toBe(0xfeff);
      expect(merged).toContain('default = "api-detect-grok-responses"');
      expect(merged).toContain('[model.user-model]');
      expect(merged).toContain('base_url = "https://user.example.com/v1"');
      expect(merged).toContain('[mcp.user-tool]');
      expect(merged).toContain('[model.api-detect-grok-responses]');
      expect(merged).toContain('[model.api-detect-grok-chat]');
      expect(merged).toContain('[model.api-detect-grok-messages]');
      expect(merged).not.toContain('disable_response_storage');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
