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
}) {
  vi.resetModules();

  const routingConfig = {
    ...config.routingConfig,
    cliProbe: {
      config: {
        enabled: true,
        intervalMinutes: 60,
        modelsPerCli: 3,
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

  vi.doMock('../main/route-model-registry-service', () => ({
    listModelRegistryEntries: vi.fn(() => config.registryEntries || []),
    resolveRawModelForChannel: config.resolveRawModelForChannel || vi.fn(() => null),
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
    const siteViews = getCliProbeView({ window: '24h' });

    expect(siteViews).toHaveLength(2);
    expect(siteViews.map(siteView => siteView.accountId).sort()).toEqual([
      'acct-default',
      'acct-fallback',
    ]);
    expect(siteViews.every(siteView => siteView.isFallbackAccount === false)).toBe(true);
  });

  it('即时探测任务会覆盖同站点的全部活跃账户', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
      }))
    );

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

    const { runCliProbeNow } = await loadProbeService(config);
    const result = await runCliProbeNow();

    expect(result.totalSamples).toBe(2);
    expect(result.successSamples).toBe(2);
    expect(result.failureSamples).toBe(0);
  });

  it('应用重启后会按最近一次探测时间恢复下一次定时探测', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T10:00:00.000Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
      }))
    );

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

    expect(unifiedConfigManager.appendRouteCliProbeSamples).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    expect(unifiedConfigManager.appendRouteCliProbeSamples).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(unifiedConfigManager.appendRouteCliProbeSamples).toHaveBeenCalledTimes(1);

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
    const siteViews = getCliProbeView({ window: '24h' });

    expect(siteViews).toHaveLength(1);
    expect(siteViews[0].siteId).toBe('site-1');
    expect(siteViews[0].siteName).toBe('Demo Site');
  });

  it('不可用分组站点不会进入 CLI 探测任务', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
      }))
    );

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
    const siteViews = getCliProbeView({ window: '24h' });

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
    const siteViews = getCliProbeView({ window: '24h' });

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
    const siteViews = getCliProbeView({ window: '24h' });

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
    const siteViews = getCliProbeView({ window: '24h' });

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
    const siteViews = getCliProbeView({ window: '24h' });

    expect(siteViews[0].clis.codex.models[0]).toMatchObject({
      statusCode: 429,
      error: 'status code 429: Too Many Requests',
      codexDetail: { responses: false },
    });
  });
});
