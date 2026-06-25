/**
 * 输入: 模拟的多账户站点配置、CLI 探测路由状态
 * 输出: CLI 探测账户覆盖与视图回归测试结果
 * 定位: 测试层 - 验证 CLI 可用性视图按账户展开、探测任务覆盖全部账户
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - src/__tests__/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProbeKey } from '../shared/types/route-proxy';
import {
  buildCustomCliRouteAccountId,
  buildCustomCliRouteApiKeyId,
  buildCustomCliRouteSiteId,
  isCustomCliRouteSiteId,
} from '../shared/utils/customCliRouteId';

function createSite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'site-1',
    name: 'Demo Site',
    url: 'https://demo.example.com',
    enabled: true,
    group: 'default',
    api_key: 'sk-site-key',
    cli_config: {
      codex: {
        enabled: true,
        testModels: ['gpt-4.1-mini'],
      },
    },
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function createAccount(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    site_id: 'site-1',
    account_name: id === 'acct-default' ? '默认账户' : '顺位账户',
    user_id: `user-${id}`,
    access_token: `token-${id}`,
    auth_source: 'manual',
    status: 'active',
    cached_data: {},
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

async function loadProbeService(config: {
  sites: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
  routingConfig?: {
    cliProbe?: {
      config?: Record<string, unknown>;
      latest?: Record<string, unknown>;
      history?: Record<string, unknown>;
    };
  };
  registryEntries?: Array<{ canonicalName: string }>;
  resolveRawModelForChannel?: ReturnType<typeof vi.fn>;
  customCliStorage?: {
    configs?: Array<Record<string, unknown>>;
    activeConfigId?: string | null;
  };
}) {
  vi.resetModules();

  const routingConfig = {
    ...config.routingConfig,
    cliProbe: {
      config: {
        enabled: true,
        intervalMinutes: 240,
        modelsPerCli: 1,
        requestTimeoutMs: 30_000,
        maxConcurrency: 2,
        retentionDays: 7,
        runOnStartup: false,
      },
      latest: {},
      history: {},
      ...config.routingConfig?.cliProbe,
    },
  };

  vi.doMock('../main/utils/logger', () => ({
    default: {
      scope: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      })),
    },
  }));

  vi.doMock('../main/unified-config-manager', () => ({
    unifiedConfigManager: {
      exportConfigSync: vi.fn(() => config),
      getRoutingConfig: vi.fn(() => routingConfig),
      getSiteById: vi.fn((siteId: string) => config.sites.find(site => site.id === siteId) || null),
      getAccountById: vi.fn(
        (accountId: string) => config.accounts.find(account => account.id === accountId) || null
      ),
      getAccountsBySiteId: vi.fn((siteId: string) =>
        config.accounts.filter(account => account.site_id === siteId)
      ),
      persistRouteCliProbeSamples: vi.fn(),
      appendRouteCliProbeSamples: vi.fn(),
      upsertRouteCliProbeLatest: vi.fn(),
      pruneRouteCliProbeHistory: vi.fn(),
    },
  }));

  vi.doMock('../main/cli-wrapper-compat-service', () => ({
    cliWrapperCompatService: {
      testClaudeCodeWithDetail: vi.fn(async () => ({ supported: true, detail: {} })),
      testCodexWithDetail: vi.fn(async () => ({ supported: true, detail: { responses: true } })),
      testGeminiWithDetail: vi.fn(async () => ({
        supported: true,
        detail: { native: true, proxy: null },
      })),
    },
  }));

  vi.doMock('../main/route-proxy-service', () => ({
    ensureRouteProxyReady: vi.fn(async () => ({
      baseUrl: 'http://127.0.0.1:3210',
      unifiedApiKey: 'sk-route',
    })),
  }));

  vi.doMock('../main/route-probe-lock', () => ({
    buildProbeLockRouteApiKey: vi.fn(
      (
        _unifiedApiKey: string,
        lock: { cliType: string; apiKeyId: string; canonicalModel: string }
      ) => `probe-lock:${lock.cliType}:${lock.apiKeyId}:${lock.canonicalModel}`
    ),
  }));

  vi.doMock('../main/route-model-registry-service', () => ({
    listModelRegistryEntries: vi.fn(() => config.registryEntries || []),
    resolveRawModelForChannel: config.resolveRawModelForChannel || vi.fn(() => null),
    resolveApiKeyId: vi.fn((apiKey: { id?: number | string; key?: string }) =>
      apiKey.id !== undefined ? String(apiKey.id) : String(apiKey.key || 'unknown')
    ),
  }));

  vi.doMock('../main/custom-cli-config-service', () => ({
    buildCustomCliRouteAccountId,
    buildCustomCliRouteApiKeyId,
    buildCustomCliRouteSiteId,
    isCustomCliRouteSiteId,
    loadCustomCliConfigStorage: vi.fn(async () => ({
      configs: config.customCliStorage?.configs || [],
      activeConfigId: config.customCliStorage?.activeConfigId ?? null,
    })),
  }));

  const service = await import('../main/route-cli-probe-service');
  const { unifiedConfigManager } = await import('../main/unified-config-manager');

  return {
    ...service,
    unifiedConfigManager,
  };
}

function createProbeSample(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sampleId: 'sample-1',
    probeKey: buildProbeKey('site-1', 'acct-default', 'codex', 'gpt-4.1-mini'),
    siteId: 'site-1',
    accountId: 'acct-default',
    cliType: 'codex',
    canonicalModel: 'gpt-4.1-mini',
    rawModel: 'gpt-4.1-mini',
    success: true,
    source: 'routeProbe',
    testedAt: Date.now(),
    ...overrides,
  };
}

function createCustomCliConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'duckcoding',
    name: 'DuckCoding',
    baseUrl: 'https://duck.example.com',
    apiKey: 'sk-duck',
    models: ['duckcoding'],
    manualModels: [],
    cliSettings: {
      claudeCode: { enabled: false, model: null, testModels: [] },
      codex: {
        enabled: true,
        model: 'duckcoding',
        testModels: ['duckcoding'],
        targetProtocol: 'openai-responses',
      },
      geminiCli: { enabled: false, model: null, testModels: [] },
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('route-cli-probe-service', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('CLI 可用性视图会为同站点的每个活跃账户分别生成一行', async () => {
    const config = {
      sites: [createSite()],
      accounts: [
        createAccount('acct-default', { status: undefined }),
        createAccount('acct-fallback'),
      ],
    };

    const { getCliProbeView } = await loadProbeService(config);
    const siteViews = await getCliProbeView({ window: '24h' });

    expect(siteViews).toHaveLength(2);
    expect(siteViews.map(siteView => siteView.accountId).sort()).toEqual([
      'acct-default',
      'acct-fallback',
    ]);
    expect(siteViews.every(siteView => siteView.isFallbackAccount === false)).toBe(true);
  });

  it('即时探测任务会覆盖同站点的全部活跃账户', async () => {
    const config = {
      sites: [createSite()],
      accounts: [
        createAccount('acct-default', {
          status: undefined,
          cached_data: {
            api_keys: [{ id: 1, key: 'sk-default-key', status: 1 }],
          },
        }),
        createAccount('acct-fallback', {
          cached_data: {
            api_keys: [{ id: 2, key: 'sk-fallback-key', status: 1 }],
          },
        }),
      ],
    };

    const { runCliProbeNow, unifiedConfigManager } = await loadProbeService(config);
    const result = await runCliProbeNow();

    expect(result.totalSamples).toBe(2);
    expect(result.successSamples).toBe(2);
    expect(result.failureSamples).toBe(0);
    const persistedSamples = vi.mocked(unifiedConfigManager.persistRouteCliProbeSamples).mock
      .calls[0][0];
    expect(new Set(persistedSamples.map(sample => sample.probeRunId)).size).toBe(1);
    expect(persistedSamples[0].probeRunId).toMatch(/^route_/);
  });

  it('即时探测只使用每个 CLI 配置中选择的单个测试模型，不受全局 modelsPerCli 影响', async () => {
    const config = {
      sites: [
        createSite({
          cli_config: {
            codex: {
              enabled: true,
              testModels: ['gpt-4.1-mini', 'gpt-4.1', 'o3-mini'],
            },
          },
        }),
      ],
      accounts: [
        createAccount('acct-default', {
          cached_data: {
            api_keys: [{ id: 1, key: 'sk-default-key', status: 1 }],
          },
        }),
      ],
      routingConfig: {
        cliProbe: {
          config: {
            enabled: true,
            intervalMinutes: 240,
            modelsPerCli: 99,
            requestTimeoutMs: 30_000,
            maxConcurrency: 2,
            retentionDays: 7,
            runOnStartup: false,
          },
        },
      },
    };

    const { runCliProbeNow, unifiedConfigManager } = await loadProbeService(config);
    const result = await runCliProbeNow({
      siteId: 'site-1',
      accountId: 'acct-default',
      cliType: 'codex',
    });

    expect(result.totalSamples).toBe(1);
    const persistedSamples = vi.mocked(unifiedConfigManager.persistRouteCliProbeSamples).mock
      .calls[0][0];
    expect(persistedSamples).toHaveLength(1);
    expect(persistedSamples[0]).toMatchObject({
      cliType: 'codex',
      canonicalModel: 'gpt-4.1-mini',
      rawModel: 'gpt-4.1-mini',
    });
  });

  it('即时探测优先使用账户级 CLI 配置选择模型', async () => {
    const config = {
      sites: [
        createSite({
          cli_config: {
            codex: {
              enabled: false,
              testModels: ['site-legacy-model'],
            },
          },
        }),
      ],
      accounts: [
        createAccount('acct-default', {
          cli_config: {
            codex: {
              enabled: true,
              testModels: ['account-model'],
            },
          },
          cached_data: {
            api_keys: [{ id: 1, key: 'sk-default-key', status: 1 }],
          },
        }),
      ],
    };

    const { selectProbeModelsForCli } = await loadProbeService(config);

    expect(
      selectProbeModelsForCli({
        siteId: 'site-1',
        accountId: 'acct-default',
        cliType: 'codex',
        limit: 3,
      })
    ).toEqual([{ canonicalModel: 'account-model', rawModel: 'account-model' }]);
  });

  it('账户级 CLI 配置关闭时不会退回到站点级旧配置执行探测', async () => {
    const config = {
      sites: [
        createSite({
          cli_config: {
            codex: {
              enabled: true,
              testModels: ['site-legacy-model'],
            },
          },
        }),
      ],
      accounts: [
        createAccount('acct-default', {
          cli_config: {
            codex: {
              enabled: false,
              testModels: ['account-model'],
            },
          },
        }),
      ],
    };

    const { selectProbeModelsForCli } = await loadProbeService(config);

    expect(
      selectProbeModelsForCli({
        siteId: 'site-1',
        accountId: 'acct-default',
        cliType: 'codex',
        limit: 3,
      })
    ).toEqual([]);
  });

  it('账户缺少 CLI 配置时仍兼容站点级旧配置', async () => {
    const config = {
      sites: [
        createSite({
          cli_config: {
            codex: {
              enabled: true,
              testModels: ['site-legacy-model'],
            },
          },
        }),
      ],
      accounts: [createAccount('acct-default')],
    };

    const { selectProbeModelsForCli } = await loadProbeService(config);

    expect(
      selectProbeModelsForCli({
        siteId: 'site-1',
        accountId: 'acct-default',
        cliType: 'codex',
        limit: 3,
      })
    ).toEqual([{ canonicalModel: 'site-legacy-model', rawModel: 'site-legacy-model' }]);
  });

  it('自动探测通过本地 route proxy 执行真实 CLI 测试', async () => {
    const config = {
      sites: [createSite()],
      accounts: [
        createAccount('acct-default', {
          status: undefined,
          cached_data: {
            api_keys: [{ id: 7, key: 'sk-default-key', status: 'active' }],
          },
        }),
      ],
    };

    const { runCliProbeNow } = await loadProbeService(config);
    const { cliWrapperCompatService } = await import('../main/cli-wrapper-compat-service');
    const { ensureRouteProxyReady } = await import('../main/route-proxy-service');
    const { buildProbeLockRouteApiKey } = await import('../main/route-probe-lock');

    const result = await runCliProbeNow({
      siteId: 'site-1',
      accountId: 'acct-default',
      cliType: 'codex',
    });

    expect(result.totalSamples).toBe(1);
    expect(ensureRouteProxyReady).toHaveBeenCalledWith({ autoEnable: true });
    expect(buildProbeLockRouteApiKey).toHaveBeenCalledWith(
      'sk-route',
      expect.objectContaining({
        siteId: 'site-1',
        accountId: 'acct-default',
        apiKeyId: '7',
        cliType: 'codex',
        canonicalModel: 'gpt-4.1-mini',
        rawModel: 'gpt-4.1-mini',
      })
    );
    expect(cliWrapperCompatService.testCodexWithDetail).toHaveBeenCalledWith(
      'http://127.0.0.1:3210',
      'probe-lock:codex:7:gpt-4.1-mini',
      'gpt-4.1-mini',
      30000
    );
  });

  it('应用重启后会按最近一次探测时间恢复下一次定时探测', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T10:00:00.000Z'));

    const latestSample = createProbeSample({
      testedAt: Date.now() - 30 * 60 * 1000,
    });
    const probeKey = buildProbeKey('site-1', 'acct-default', 'codex', 'gpt-4.1-mini');
    const config = {
      sites: [createSite()],
      accounts: [
        createAccount('acct-default', {
          status: undefined,
          cached_data: {
            api_keys: [{ id: 1, key: 'sk-default-key', status: 1 }],
          },
        }),
      ],
      routingConfig: {
        cliProbe: {
          latest: {
            [probeKey]: {
              probeKey,
              siteId: 'site-1',
              accountId: 'acct-default',
              cliType: 'codex',
              canonicalModel: 'gpt-4.1-mini',
              rawModel: 'gpt-4.1-mini',
              healthy: true,
              lastSample: latestSample,
              lastSuccessAt: latestSample.testedAt,
            },
          },
          history: {
            [probeKey]: [latestSample],
          },
        },
      },
    };

    const { startCliProbeTimer, stopCliProbeTimer, unifiedConfigManager } =
      await loadProbeService(config);
    startCliProbeTimer({ resumeFromLatest: true });

    expect(unifiedConfigManager.persistRouteCliProbeSamples).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(209 * 60 * 1000);
    expect(unifiedConfigManager.persistRouteCliProbeSamples).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(unifiedConfigManager.persistRouteCliProbeSamples).toHaveBeenCalledTimes(1);

    stopCliProbeTimer();
  });

  it('CLI 可用性视图不显示不可用分组站点', async () => {
    const config = {
      sites: [
        createSite(),
        createSite({
          id: 'site-2',
          name: 'Unavailable Site',
          group: 'unavailable',
        }),
      ],
      accounts: [
        createAccount('acct-default'),
        createAccount('acct-unavailable', {
          site_id: 'site-2',
          account_name: '不可用账户',
        }),
      ],
    };

    const { getCliProbeView } = await loadProbeService(config);
    const siteViews = await getCliProbeView({ window: '24h' });

    expect(siteViews).toHaveLength(1);
    expect(siteViews[0].siteId).toBe('site-1');
    expect(siteViews[0].siteName).toBe('Demo Site');
  });

  it('不可用分组站点不会进入 CLI 探测任务', async () => {
    const config = {
      sites: [
        createSite({
          group: 'unavailable',
        }),
      ],
      accounts: [createAccount('acct-default')],
    };

    const { runCliProbeNow } = await loadProbeService(config);
    const result = await runCliProbeNow();

    expect(result.totalSamples).toBe(0);
    expect(result.successSamples).toBe(0);
    expect(result.failureSamples).toBe(0);
  });

  it('当站点所有 CLI 开关都关闭时，不显示在 CLI 可用性视图中', async () => {
    const config = {
      sites: [
        createSite({
          cli_config: {
            claudeCode: { enabled: false },
            codex: { enabled: false },
            geminiCli: { enabled: false },
          },
        }),
      ],
      accounts: [createAccount('acct-default')],
    };

    const { getCliProbeView } = await loadProbeService(config);
    const siteViews = await getCliProbeView({ window: '24h' });

    expect(siteViews).toHaveLength(0);
  });

  it('未配置 API Key 和测试模型时，站点仍显示但不从模型注册表推断 CLI 模型', async () => {
    const resolveRawModelForChannel = vi.fn(() => 'gpt-4.1-mini');
    const config = {
      sites: [
        createSite({
          cli_config: {
            codex: { enabled: true },
          },
        }),
      ],
      accounts: [
        createAccount('acct-default', {
          cached_data: {
            api_keys: [{ id: 1, key: 'sk-account-key', status: 1 }],
          },
        }),
      ],
      registryEntries: [{ canonicalName: 'gpt-4.1-mini' }],
      resolveRawModelForChannel,
    };

    const { getCliProbeView, selectProbeModelsForCli } = await loadProbeService(config);

    const selectedModels = selectProbeModelsForCli({
      siteId: 'site-1',
      accountId: 'acct-default',
      cliType: 'codex',
      limit: 3,
    });
    const siteViews = await getCliProbeView({ window: '24h' });

    expect(selectedModels).toEqual([]);
    expect(siteViews).toHaveLength(1);
    expect(siteViews[0].siteId).toBe('site-1');
    expect(siteViews[0].clis.codex.enabled).toBe(true);
    expect(siteViews[0].clis.codex.models).toEqual([]);
    expect(resolveRawModelForChannel).not.toHaveBeenCalled();
  });

  it('无显式测试模型时，不从历史 latest 回填模型到 CLI 可用性视图', async () => {
    const testedAt = Date.now();
    const codexProbe = createProbeSample({ testedAt });
    const codexProbeKey = buildProbeKey('site-1', 'acct-default', 'codex', 'gpt-4.1-mini');

    const config = {
      sites: [
        createSite({
          cli_config: {
            claudeCode: {
              enabled: true,
              apiKeyId: 1,
              testModels: ['claude-3-5-sonnet'],
            },
            codex: { enabled: true },
          },
        }),
      ],
      accounts: [
        createAccount('acct-default', {
          cached_data: {
            api_keys: [{ id: 1, key: 'sk-account-key', status: 1 }],
          },
        }),
      ],
      routingConfig: {
        cliProbe: {
          latest: {
            [codexProbeKey]: {
              probeKey: codexProbeKey,
              siteId: 'site-1',
              accountId: 'acct-default',
              cliType: 'codex',
              canonicalModel: 'gpt-4.1-mini',
              rawModel: 'gpt-4.1-mini',
              healthy: true,
              lastSample: codexProbe,
              lastSuccessAt: testedAt,
            },
          },
          history: {
            [codexProbeKey]: [codexProbe],
          },
        },
      },
    };

    const { getCliProbeView } = await loadProbeService(config);
    const siteViews = await getCliProbeView({ window: '24h' });

    expect(siteViews).toHaveLength(1);
    expect(siteViews[0].clis.claudeCode.models).toHaveLength(1);
    expect(siteViews[0].clis.claudeCode.models[0].canonicalModel).toBe('claude-3-5-sonnet');
    expect(siteViews[0].clis.codex.models).toEqual([]);
  });

  it('将最新 probe detail 透传到 CLI 可用性视图模型详情中', async () => {
    const testedAt = Date.now();
    const codexProbe = createProbeSample({
      testedAt,
      codexDetail: { responses: true },
    });
    const codexProbeKey = buildProbeKey('site-1', 'acct-default', 'codex', 'gpt-4.1-mini');

    const config = {
      sites: [createSite()],
      accounts: [
        createAccount('acct-default', {
          cached_data: {
            api_keys: [{ id: 1, key: 'sk-account-key', status: 1 }],
          },
        }),
      ],
      routingConfig: {
        cliProbe: {
          latest: {
            [codexProbeKey]: {
              probeKey: codexProbeKey,
              siteId: 'site-1',
              accountId: 'acct-default',
              cliType: 'codex',
              canonicalModel: 'gpt-4.1-mini',
              rawModel: 'gpt-4.1-mini',
              healthy: true,
              lastSample: codexProbe,
              lastSuccessAt: testedAt,
            },
          },
          history: {
            [codexProbeKey]: [codexProbe],
          },
        },
      },
    };

    const { getCliProbeView } = await loadProbeService(config);
    const siteViews = await getCliProbeView({ window: '24h' });

    expect(siteViews[0].clis.codex.models[0]).toMatchObject({
      source: 'routeProbe',
      codexDetail: { responses: true },
    });
  });

  it('将最新 probe 的错误码与错误信息透传到 CLI 可用性视图模型详情中', async () => {
    const testedAt = Date.now();
    const codexProbe = createProbeSample({
      success: false,
      statusCode: 429,
      error: 'status code 429: Too Many Requests',
      testedAt,
      codexDetail: { responses: false },
    });
    const codexProbeKey = buildProbeKey('site-1', 'acct-default', 'codex', 'gpt-4.1-mini');

    const config = {
      sites: [createSite()],
      accounts: [
        createAccount('acct-default', {
          cached_data: {
            api_keys: [{ id: 1, key: 'sk-account-key', status: 1 }],
          },
        }),
      ],
      routingConfig: {
        cliProbe: {
          latest: {
            [codexProbeKey]: {
              probeKey: codexProbeKey,
              siteId: 'site-1',
              accountId: 'acct-default',
              cliType: 'codex',
              canonicalModel: 'gpt-4.1-mini',
              rawModel: 'gpt-4.1-mini',
              healthy: false,
              lastSample: codexProbe,
              lastFailureAt: testedAt,
            },
          },
          history: {
            [codexProbeKey]: [codexProbe],
          },
        },
      },
    };

    const { getCliProbeView } = await loadProbeService(config);
    const siteViews = await getCliProbeView({ window: '24h' });

    expect(siteViews[0].clis.codex.models[0]).toMatchObject({
      statusCode: 429,
      error: 'status code 429: Too Many Requests',
      codexDetail: { responses: false },
    });
  });

  it('CLI 可用性视图会加入自定义 CLI 配置行', async () => {
    const customConfig = createCustomCliConfig();
    const config = {
      sites: [
        createSite(),
        createSite({
          id: 'site-2',
          name: 'ZZZ Site',
        }),
      ],
      accounts: [
        createAccount('acct-default'),
        createAccount('acct-site-2', {
          site_id: 'site-2',
          account_name: 'Second Account',
        }),
      ],
      customCliStorage: {
        configs: [customConfig],
      },
    };

    const { getCliProbeView } = await loadProbeService(config);
    const siteViews = await getCliProbeView({ window: '24h' });
    const customView = siteViews.find(siteView => siteView.siteId === 'custom-cli-site-duckcoding');

    expect(customView).toMatchObject({
      siteId: 'custom-cli-site-duckcoding',
      siteName: '自定义 CLI',
      accountId: 'custom-cli-account-duckcoding',
      accountName: 'DuckCoding',
    });
    const customIndex = siteViews.findIndex(
      siteView => siteView.siteId === 'custom-cli-site-duckcoding'
    );
    const regularIndexes = siteViews
      .map((siteView, index) => (siteView.siteId.startsWith('custom-cli-site-') ? -1 : index))
      .filter(index => index >= 0);
    expect(customIndex).toBeGreaterThan(Math.max(...regularIndexes));
    expect(customView?.clis.codex.enabled).toBe(true);
    expect(customView?.clis.codex.accountName).toBe('DuckCoding');
    expect(customView?.clis.codex.models).toEqual([
      expect.objectContaining({
        canonicalModel: 'duckcoding',
        rawModel: 'duckcoding',
        targetProtocol: 'openai-responses',
        targetEndpoint: '/v1/responses',
        success: null,
      }),
    ]);
    expect(customView?.clis.claudeCode.enabled).toBe(false);
  });

  it('即时探测会为自定义 CLI 配置生成带上游信息的探测任务', async () => {
    const config = {
      sites: [],
      accounts: [],
      customCliStorage: {
        configs: [createCustomCliConfig()],
      },
    };

    const { runCliProbeNow, unifiedConfigManager } = await loadProbeService(config);
    const { buildProbeLockRouteApiKey } = await import('../main/route-probe-lock');

    const result = await runCliProbeNow({
      siteId: 'custom-cli-site-duckcoding',
      accountId: 'custom-cli-account-duckcoding',
      cliType: 'codex',
    });

    expect(result.totalSamples).toBe(1);
    expect(buildProbeLockRouteApiKey).toHaveBeenCalledWith(
      'sk-route',
      expect.objectContaining({
        siteId: 'custom-cli-site-duckcoding',
        accountId: 'custom-cli-account-duckcoding',
        apiKeyId: 'custom-cli-key-duckcoding',
        cliType: 'codex',
        canonicalModel: 'duckcoding',
        rawModel: 'duckcoding',
        targetProtocol: 'openai-responses',
        upstreamBaseUrl: 'https://duck.example.com',
        upstreamApiKey: 'sk-duck',
      })
    );

    const persistedSamples = vi.mocked(unifiedConfigManager.persistRouteCliProbeSamples).mock
      .calls[0][0];
    expect(persistedSamples[0]).toMatchObject({
      siteId: 'custom-cli-site-duckcoding',
      accountId: 'custom-cli-account-duckcoding',
      cliType: 'codex',
      canonicalModel: 'duckcoding',
      rawModel: 'duckcoding',
      success: true,
    });
  });
});
