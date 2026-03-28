/**
 * 输入: 模拟的多账户站点配置、CLI 探测路由状态
 * 输出: CLI 探测账户选择回归测试结果
 * 定位: 测试层 - 验证 CLI 可用性视图默认账户优先与余额不足回退逻辑
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
      config: {},
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

  vi.doMock('../main/cli-compat-service', () => ({
    cliCompatService: {
      testClaudeCode: vi.fn(async () => true),
      testCodexWithDetail: vi.fn(async () => ({ supported: true })),
      testGeminiWithDetail: vi.fn(async () => ({ supported: true })),
    },
  }));

  vi.doMock('../main/route-model-registry-service', () => ({
    listModelRegistryEntries: vi.fn(() => config.registryEntries || []),
    resolveRawModelForChannel: config.resolveRawModelForChannel || vi.fn(() => null),
  }));

  return import('../main/route-cli-probe-service');
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
    testedAt: Date.now(),
    ...overrides,
  };
}

describe('route-cli-probe-service', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('优先选择默认账户，即使旧配置缺少 status 字段', async () => {
    const config = {
      sites: [createSite()],
      accounts: [
        createAccount('acct-default', { status: undefined }),
        createAccount('acct-fallback'),
      ],
    };

    const { getCliProbeView } = await loadProbeService(config);
    const siteView = getCliProbeView({ window: '24h' })[0];

    expect(siteView.accountId).toBe('acct-default');
    expect(siteView.accountName).toBe('默认账户');
    expect(siteView.isFallbackAccount).toBe(false);
    expect(siteView.accountReason).toBe('default_account');
  });

  it('仅当默认账户余额不足时才回退到顺位账户', async () => {
    const config = {
      sites: [createSite()],
      accounts: [
        createAccount('acct-default', {
          status: undefined,
          cached_data: { balance: 0 },
        }),
        createAccount('acct-fallback'),
      ],
    };

    const { getCliProbeView } = await loadProbeService(config);
    const siteView = getCliProbeView({ window: '24h' })[0];

    expect(siteView.accountId).toBe('acct-fallback');
    expect(siteView.accountName).toBe('顺位账户');
    expect(siteView.isFallbackAccount).toBe(true);
    expect(siteView.accountReason).toBe('default_balance_insufficient');
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

  it('未配置 API Key 和测试模型时，不从模型注册表推断 CLI 模型', async () => {
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
    expect(siteViews).toHaveLength(0);
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
});
