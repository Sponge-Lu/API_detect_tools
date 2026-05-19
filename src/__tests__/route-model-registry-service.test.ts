import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RouteModelMappingOverride,
  RouteModelRegistryConfig,
  RouteModelSourceRef,
  RouteRule,
} from '../shared/types/route-proxy';
import { buildProbeKey, buildRouteOverrideDisplayItemId } from '../shared/types/route-proxy';

const { unifiedConfigManagerMock, loggerScopeMock, customCliStorageMock } = vi.hoisted(() => ({
  unifiedConfigManagerMock: {
    exportConfigSync: vi.fn(),
    getRoutingConfig: vi.fn(),
    updateRouteModelRegistry: vi.fn(),
    ensureRouteRuleForCliModelSelection: vi.fn(),
    upsertRouteModelMappingOverride: vi.fn(),
    deleteRouteModelDisplayItem: vi.fn(),
    deleteRouteModelMappingOverride: vi.fn(),
    updateRouteVendorPriorityConfig: vi.fn(),
  },
  loggerScopeMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  customCliStorageMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'D:/api-detect-tools-test-user-data'),
  },
}));

vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: unifiedConfigManagerMock,
}));

vi.mock('../main/custom-cli-config-service', async () => {
  const actual = await vi.importActual<typeof import('../main/custom-cli-config-service')>(
    '../main/custom-cli-config-service'
  );
  return {
    ...actual,
    loadCustomCliConfigStorage: customCliStorageMock,
  };
});

vi.mock('../main/utils/logger', () => ({
  default: {
    scope: () => loggerScopeMock,
  },
}));

import {
  deleteModelDisplayItem,
  rebuildModelRegistry,
  resetModelRegistryDefaults,
  resolveCanonicalName,
  syncModelRegistrySources,
} from '../main/route-model-registry-service';
import {
  resolveChannelCredentials,
  resolveChannelTarget,
  resolveChannels,
} from '../main/route-channel-resolver';
import { sortChannelsByScore } from '../main/route-stats-service';
import {
  buildCustomCliRouteAccountId,
  buildCustomCliRouteApiKeyId,
  buildCustomCliRouteSiteId,
  CUSTOM_CLI_ROUTE_GROUP,
} from '../main/custom-cli-config-service';
import type { CustomCliConfig } from '../shared/types/custom-cli-config';

function createSourceOverride(
  override: Partial<RouteModelMappingOverride> = {}
): RouteModelMappingOverride {
  return {
    id: 'manual-1',
    sourceKey: 'site-1:acc-1:gpt-4.1-preview',
    canonicalName: 'gpt-4.1',
    action: 'rename',
    createdAt: 10,
    updatedAt: 20,
    ...override,
  };
}

function createRegistryConfig(
  overrides: RouteModelMappingOverride[] = []
): RouteModelRegistryConfig {
  return {
    version: 1,
    sources: [],
    entries: {},
    overrides,
    displayItems: [],
    vendorPriorities: {},
  };
}

function createCustomCliConfig(overrides: Partial<CustomCliConfig> = {}): CustomCliConfig {
  return {
    id: 'duckcoding',
    name: 'DuckCoding',
    baseUrl: 'https://duck.example.com',
    apiKey: 'sk-duck',
    models: [],
    cliSettings: {
      claudeCode: {
        enabled: false,
        model: null,
        testModels: [],
        testState: null,
      },
      codex: {
        enabled: true,
        model: 'duckcoding',
        testModels: [],
        testState: null,
      },
      geminiCli: {
        enabled: false,
        model: null,
        testModels: [],
        testState: null,
      },
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createRouteRule(overrides: Partial<RouteRule> = {}): RouteRule {
  return {
    id: 'rule-1',
    name: 'Route Rule',
    enabled: true,
    priority: 1,
    cliType: 'claudeCode',
    patternType: 'wildcard',
    pattern: '*',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createSource(overrides: Partial<RouteModelSourceRef> = {}): RouteModelSourceRef {
  return {
    sourceKey: 'site-1:acc-1:raw-a',
    siteId: 'site-1',
    siteName: 'Site 1',
    accountId: 'acc-1',
    accountName: 'Primary',
    sourceType: 'account',
    originalModel: 'raw-a',
    vendor: 'claude',
    availableUserGroups: ['team-a'],
    availableApiKeys: [],
    firstSeenAt: 1,
    lastSeenAt: 1,
    ...overrides,
  };
}

describe('route model registry service', () => {
  beforeEach(() => {
    unifiedConfigManagerMock.exportConfigSync.mockReset();
    unifiedConfigManagerMock.getRoutingConfig.mockReset();
    unifiedConfigManagerMock.updateRouteModelRegistry.mockReset().mockResolvedValue(undefined);
    unifiedConfigManagerMock.ensureRouteRuleForCliModelSelection
      .mockReset()
      .mockResolvedValue(undefined);
    unifiedConfigManagerMock.upsertRouteModelMappingOverride.mockReset();
    unifiedConfigManagerMock.deleteRouteModelDisplayItem.mockReset();
    unifiedConfigManagerMock.deleteRouteModelMappingOverride.mockReset();
    unifiedConfigManagerMock.updateRouteVendorPriorityConfig.mockReset();
    customCliStorageMock.mockReset().mockResolvedValue({
      configs: [],
      activeConfigId: null,
    });
  });

  it('applies source-scoped overrides while rebuilding the registry', async () => {
    const registry = createRegistryConfig([createSourceOverride()]);

    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [{ id: 'site-1', name: 'Site 1', cached_data: undefined }],
      accounts: [
        {
          id: 'acc-1',
          site_id: 'site-1',
          account_name: 'Primary',
          status: 'active',
          cached_data: {
            models: ['gpt-4.1-preview'],
            api_keys: [
              {
                id: 'key-1',
                name: 'main-key',
                group: 'team-beta',
              },
              {
                id: 'key-2',
                token_id: 'token-2',
                group: 'team-beta',
              },
            ],
            user_groups: {
              'team-beta': {
                desc: 'Beta Team',
                ratio: 1,
              },
            },
          },
        },
      ],
    });
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      modelRegistry: registry,
    });

    const result = await rebuildModelRegistry(true);

    expect(result.sources).toEqual([
      expect.objectContaining({
        sourceKey: 'site-1:acc-1:gpt-4.1-preview',
        originalModel: 'gpt-4.1-preview',
        availableUserGroups: ['team-beta'],
        availableApiKeys: [
          {
            apiKeyId: 'key-1',
            apiKeyName: 'main-key',
            accountId: 'acc-1',
            accountName: 'Primary',
            group: 'team-beta',
          },
          {
            apiKeyId: 'key-2',
            apiKeyName: 'token-2',
            accountId: 'acc-1',
            accountName: 'Primary',
            group: 'team-beta',
          },
        ],
        apiKeyGroups: ['team-beta'],
        apiKeyNamesByGroup: {
          'team-beta': ['main-key', 'token-2'],
        },
        userGroupKeys: ['team-beta'],
      }),
    ]);
    expect(unifiedConfigManagerMock.updateRouteModelRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            sourceKey: 'site-1:acc-1:gpt-4.1-preview',
          }),
        ]),
      })
    );
  });

  it('prefers a source-scoped manual override when resolving canonical names', () => {
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      modelRegistry: createRegistryConfig([createSourceOverride()]),
    });

    expect(
      resolveCanonicalName({
        rawModel: 'gpt-4.1-preview',
        siteId: 'site-1',
        accountId: 'acc-1',
      })
    ).toBe('gpt-4.1');
  });

  it('seeds only the single default example display item during rebuild', async () => {
    const registry = createRegistryConfig();

    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [{ id: 'site-1', name: 'Site 1', cached_data: undefined }],
      accounts: [
        {
          id: 'acc-1',
          site_id: 'site-1',
          account_name: 'Primary',
          status: 'active',
          cached_data: {
            models: [
              'claude-opus-4.6-20260201',
              'gpt-5.4-20260101',
              'o3-20260101',
              'gpt-5-20260101',
              'gpt-4.1-20260101',
            ],
            api_keys: [],
            user_groups: {},
          },
        },
      ],
    });
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      modelRegistry: registry,
    });

    const result = await rebuildModelRegistry(true);

    expect(result.sources.map(source => source.originalModel)).toEqual([
      'claude-opus-4.6-20260201',
      'gpt-5.4-20260101',
      'o3-20260101',
      'gpt-5-20260101',
      'gpt-4.1-20260101',
    ]);
    expect(result.entries['gpt-4.1']).toBeUndefined();
    expect(result.displayItems).toEqual([
      expect.objectContaining({
        canonicalName: 'claude-opus-4-6',
        mode: 'seeded',
        sourceKeys: ['site-1:acc-1:claude-opus-4.6-20260201'],
        priorityConfig: {
          sitePriorities: {},
          apiKeyPriorities: {},
        },
      }),
    ]);
  });

  it('resets the default opus display item without preserving old overrides targeting it', async () => {
    const opusModel = 'claude-opus-4.6-20260201';
    const sonnetModel = 'claude-sonnet-4.6-20260201';
    const opusSourceKey = `site-1:acc-1:${opusModel}`;
    const sonnetSourceKey = `site-1:acc-1:${sonnetModel}`;
    const registry = createRegistryConfig([
      createSourceOverride({
        id: 'old-default-override',
        sourceKey: sonnetSourceKey,
        canonicalName: 'claude-opus-4-6',
      }),
    ]);
    registry.displayItems = [
      {
        id: 'seeded:claude-opus-4-6',
        vendor: 'claude',
        canonicalName: 'claude-opus-4-6',
        sourceKeys: [sonnetSourceKey, opusSourceKey],
        originalModelOrder: [sonnetModel, opusModel],
        priorityConfig: {
          sitePriorities: {
            'site-old': 0,
          },
          apiKeyPriorities: {},
        },
        mode: 'seeded',
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [{ id: 'site-1', name: 'Site 1', cached_data: undefined }],
      accounts: [
        {
          id: 'acc-1',
          site_id: 'site-1',
          account_name: 'Primary',
          status: 'active',
          cached_data: {
            models: [opusModel, sonnetModel],
            api_keys: [],
            user_groups: {},
          },
        },
      ],
    });
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      modelRegistry: registry,
    });

    const result = await resetModelRegistryDefaults();

    expect(result.overrides).toEqual([]);
    expect(result.displayItems).toEqual([
      expect.objectContaining({
        id: 'seeded:claude-opus-4-6',
        canonicalName: 'claude-opus-4-6',
        mode: 'seeded',
        sourceKeys: [opusSourceKey],
        originalModelOrder: [opusModel],
        priorityConfig: {
          sitePriorities: {},
          apiKeyPriorities: {},
        },
      }),
    ]);
    expect(result.entries['claude-opus-4-6']?.aliases).toEqual([opusModel]);
    expect(result.entries['claude-sonnet-4-6']).toBeUndefined();
    expect(unifiedConfigManagerMock.updateRouteModelRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: [],
        displayItems: [
          expect.objectContaining({
            canonicalName: 'claude-opus-4-6',
            sourceKeys: [opusSourceKey],
          }),
        ],
      })
    );
    expect(unifiedConfigManagerMock.ensureRouteRuleForCliModelSelection).toHaveBeenCalledWith(
      'claudeCode',
      'claude-opus-4-6'
    );
  });

  it('syncs sources without overwriting persisted display items', async () => {
    const registry = createRegistryConfig();
    registry.displayItems = [
      {
        id: 'seeded:gpt:0',
        vendor: 'gpt',
        canonicalName: 'gpt-5-4',
        sourceKeys: ['site-1:acc-1:gpt-5.4-20260101'],
        originalModelOrder: ['gpt-5.4-20260101'],
        mode: 'seeded',
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [{ id: 'site-1', name: 'Site 1', cached_data: undefined }],
      accounts: [
        {
          id: 'acc-1',
          site_id: 'site-1',
          account_name: 'Primary',
          status: 'active',
          cached_data: {
            models: ['gpt-5.4-20260101', 'gpt-5-20260101'],
            api_keys: [],
            user_groups: {},
          },
        },
      ],
    });
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      modelRegistry: registry,
    });

    const result = await syncModelRegistrySources(true);

    expect(result.sources.map(source => source.originalModel)).toEqual([
      'gpt-5.4-20260101',
      'gpt-5-20260101',
    ]);
    expect(result.displayItems).toEqual([
      expect.objectContaining({
        id: 'seeded:gpt:0',
        canonicalName: 'gpt-5-4',
        sourceKeys: ['site-1:acc-1:gpt-5.4-20260101'],
        originalModelOrder: ['gpt-5.4-20260101'],
        mode: 'seeded',
      }),
    ]);
    expect(result.entries['gpt-5-4']).toBeDefined();
    expect(result.entries['gpt-5']).toBeUndefined();
  });

  it('deletes override-backed display items that have no persisted display item', async () => {
    const override = createSourceOverride({
      id: 'override-deepseek-v4-pro',
      sourceKey: 'site-1:acc-1:deepseek-v4',
      canonicalName: 'deepseek-v4-pro',
    });
    const registry = createRegistryConfig([override]);
    registry.entries['deepseek-v4-pro'] = {
      canonicalName: 'deepseek-v4-pro',
      vendor: 'deepseek',
      aliases: ['deepseek-v4'],
      sources: [
        createSource({
          sourceKey: 'site-1:acc-1:deepseek-v4',
          originalModel: 'deepseek-v4',
          vendor: 'deepseek',
        }),
      ],
      hasOverride: true,
      createdAt: 10,
      updatedAt: 20,
    };

    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [{ id: 'site-1', name: 'Site 1', cached_data: undefined }],
      accounts: [
        {
          id: 'acc-1',
          site_id: 'site-1',
          account_name: 'Primary',
          status: 'active',
          cached_data: {
            models: ['deepseek-v4'],
            api_keys: [],
            user_groups: {},
          },
        },
      ],
    });
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      modelRegistry: registry,
    });
    unifiedConfigManagerMock.deleteRouteModelMappingOverride.mockImplementation(async id => {
      registry.overrides = registry.overrides.filter(item => item.id !== id);
    });

    const result = await deleteModelDisplayItem(buildRouteOverrideDisplayItemId('deepseek-v4-pro'));

    expect(unifiedConfigManagerMock.deleteRouteModelMappingOverride).toHaveBeenCalledWith(
      'override-deepseek-v4-pro'
    );
    expect(result).not.toBeNull();
    expect(result?.entries['deepseek-v4-pro']).toBeUndefined();
  });

  it('treats models with empty enable_groups as unavailable for routing groups', async () => {
    const registry = createRegistryConfig();

    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [{ id: 'site-1', name: 'Site 1', cached_data: undefined }],
      accounts: [
        {
          id: 'acc-1',
          site_id: 'site-1',
          account_name: 'Primary',
          status: 'active',
          cached_data: {
            models: ['claude-opus-4.6-20260201'],
            api_keys: [
              {
                id: 'key-1',
                name: 'main-key',
                group: 'team-beta',
              },
            ],
            user_groups: {
              'team-beta': {
                desc: 'Beta Team',
                ratio: 1,
              },
            },
            model_pricing: {
              data: {
                'claude-opus-4.6-20260201': {
                  enable_groups: [],
                },
              },
            },
          },
        },
      ],
    });
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      modelRegistry: registry,
    });

    const result = await syncModelRegistrySources(true);

    expect(result.sources).toEqual([
      expect.objectContaining({
        originalModel: 'claude-opus-4.6-20260201',
        availableUserGroups: [],
        availableApiKeys: [],
        apiKeyGroups: [],
      }),
    ]);
    expect(result.entries).toEqual({});
  });

  it('skips disabled or unavailable-group sites when syncing route model sources', async () => {
    const registry = createRegistryConfig();

    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [
        {
          id: 'site-1',
          name: 'Available Site',
          enabled: true,
          group: 'default',
          cached_data: undefined,
        },
        {
          id: 'site-2',
          name: '奶龙API',
          enabled: true,
          group: 'unavailable',
          cached_data: undefined,
        },
        {
          id: 'site-3',
          name: 'Disabled Site',
          enabled: false,
          group: 'default',
          cached_data: undefined,
        },
      ],
      accounts: [
        {
          id: 'acc-1',
          site_id: 'site-1',
          account_name: 'Primary',
          status: 'active',
          cached_data: {
            models: ['gpt-5.4-20260101'],
            api_keys: [],
            user_groups: {},
          },
        },
        {
          id: 'acc-2',
          site_id: 'site-2',
          account_name: 'Unavailable',
          status: 'active',
          cached_data: {
            models: ['claude-opus-4.6-20260201'],
            api_keys: [],
            user_groups: {},
          },
        },
        {
          id: 'acc-3',
          site_id: 'site-3',
          account_name: 'Disabled',
          status: 'active',
          cached_data: {
            models: ['o3-20260101'],
            api_keys: [],
            user_groups: {},
          },
        },
      ],
    });
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      modelRegistry: registry,
    });

    const result = await syncModelRegistrySources(true);

    expect(result.sources.map(source => source.siteName)).toEqual(['Available Site']);
    expect(result.sources.map(source => source.originalModel)).toEqual(['gpt-5.4-20260101']);
    expect(result.sources.some(source => source.siteName === '奶龙API')).toBe(false);
    expect(result.sources.some(source => source.siteName === 'Disabled Site')).toBe(false);
  });

  it('includes custom CLI config models in the route model source pool', async () => {
    const registry = createRegistryConfig();
    const customConfig = createCustomCliConfig({
      models: ['duckcoding', 'gpt-5.4-duck'],
      cliSettings: {
        claudeCode: {
          enabled: false,
          model: null,
          testModels: [],
          testState: null,
        },
        codex: {
          enabled: true,
          model: 'duckcoding',
          testModels: ['codex-extra'],
          testState: {
            status: true,
            testedAt: 2,
            slots: [{ model: 'codex-tested', success: true, timestamp: 2 }, null, null],
          },
        },
        geminiCli: {
          enabled: true,
          model: 'gemini-duck',
          testModels: [],
          testState: null,
        },
      },
    });
    const siteId = buildCustomCliRouteSiteId(customConfig.id);
    const accountId = buildCustomCliRouteAccountId(customConfig.id);
    const apiKeyId = buildCustomCliRouteApiKeyId(customConfig.id);

    customCliStorageMock.mockResolvedValue({
      configs: [customConfig],
      activeConfigId: customConfig.id,
    });
    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [],
      accounts: [],
    });
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      modelRegistry: registry,
    });

    const result = await rebuildModelRegistry(true);

    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: `${siteId}:${accountId}:duckcoding`,
          siteId,
          siteName: '自定义 CLI / DuckCoding',
          accountId,
          accountName: '自定义 CLI',
          sourceType: 'customCli',
          originalModel: 'duckcoding',
          availableCliTypes: ['codex', 'geminiCli'],
          apiKeyGroups: [CUSTOM_CLI_ROUTE_GROUP],
          availableUserGroups: [CUSTOM_CLI_ROUTE_GROUP],
          availableApiKeys: [
            {
              apiKeyId,
              apiKeyName: 'DuckCoding Key',
              accountId,
              accountName: '自定义 CLI',
              group: CUSTOM_CLI_ROUTE_GROUP,
            },
          ],
        }),
        expect.objectContaining({
          sourceKey: `${siteId}:${accountId}:codex-tested`,
          originalModel: 'codex-tested',
          availableCliTypes: ['codex'],
        }),
        expect.objectContaining({
          sourceKey: `${siteId}:${accountId}:gemini-duck`,
          originalModel: 'gemini-duck',
          availableCliTypes: ['geminiCli'],
        }),
      ])
    );
  });

  it('resolves custom CLI display items to route channels and credentials', async () => {
    const customConfig = createCustomCliConfig();
    const siteId = buildCustomCliRouteSiteId(customConfig.id);
    const accountId = buildCustomCliRouteAccountId(customConfig.id);
    const apiKeyId = buildCustomCliRouteApiKeyId(customConfig.id);
    const sourceKey = `${siteId}:${accountId}:duckcoding`;
    const registry = createRegistryConfig();
    registry.displayItems = [
      {
        id: 'manual:duckcoding',
        vendor: 'unknown',
        canonicalName: 'duckcoding-route',
        sourceKeys: [sourceKey],
        originalModelOrder: ['duckcoding'],
        priorityConfig: {
          sitePriorities: {
            [siteId]: 4,
          },
          apiKeyPriorities: {
            [`${siteId}:${accountId}:${apiKeyId}`]: 1,
          },
        },
        mode: 'manual',
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    customCliStorageMock.mockResolvedValue({
      configs: [customConfig],
      activeConfigId: customConfig.id,
    });
    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [],
      accounts: [],
    });
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      modelRegistry: registry,
    });

    const synced = await syncModelRegistrySources(true);

    expect(synced.entries['duckcoding-route']).toEqual(
      expect.objectContaining({
        canonicalName: 'duckcoding-route',
        aliases: ['duckcoding'],
      })
    );

    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      cliProbe: { latest: {} },
      modelRegistry: synced,
    });

    const codexChannels = resolveChannels(
      createRouteRule({
        id: 'rule-1',
        name: 'Codex',
        cliType: 'codex',
      }),
      'duckcoding-route'
    );
    const geminiChannels = resolveChannels(
      createRouteRule({
        id: 'rule-2',
        name: 'Gemini',
        cliType: 'geminiCli',
      }),
      'duckcoding-route'
    );

    expect(codexChannels).toEqual([
      expect.objectContaining({
        siteId,
        accountId,
        apiKeyId,
        canonicalModel: 'duckcoding-route',
        resolvedModel: 'duckcoding',
        sitePriority: 4,
        apiKeyPriority: 1,
      }),
    ]);
    expect(geminiChannels).toEqual([]);
    await expect(resolveChannelCredentials(siteId, accountId, apiKeyId)).resolves.toEqual({
      baseUrl: customConfig.baseUrl,
      apiKey: customConfig.apiKey,
    });
  });

  it('preserves customCli configured targetProtocol through resolveChannelTarget', async () => {
    const customConfig = createCustomCliConfig({
      cliSettings: {
        claudeCode: {
          enabled: false,
          model: null,
          testModels: [],
          testState: null,
        },
        codex: {
          enabled: true,
          model: 'duckcoding',
          testModels: [],
          testState: null,
          targetProtocol: 'openai-chat-completions',
        },
        geminiCli: {
          enabled: false,
          model: null,
          testModels: [],
          testState: null,
        },
      },
    });
    const siteId = buildCustomCliRouteSiteId(customConfig.id);
    const accountId = buildCustomCliRouteAccountId(customConfig.id);
    const apiKeyId = buildCustomCliRouteApiKeyId(customConfig.id);
    const sourceKey = `${siteId}:${accountId}:duckcoding`;
    const registry = createRegistryConfig();
    registry.displayItems = [
      {
        id: 'manual:duckcoding-protocol',
        vendor: 'unknown',
        canonicalName: 'duckcoding-route',
        sourceKeys: [sourceKey],
        originalModelOrder: ['duckcoding'],
        priorityConfig: { sitePriorities: {}, apiKeyPriorities: {} },
        mode: 'manual',
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    customCliStorageMock.mockResolvedValue({
      configs: [customConfig],
      activeConfigId: customConfig.id,
    });
    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [],
      accounts: [],
    });
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      modelRegistry: registry,
    });

    const synced = await syncModelRegistrySources(true);
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      cliProbe: { latest: {} },
      modelRegistry: synced,
    });

    const channels = resolveChannels(
      createRouteRule({ id: 'rule-codex', name: 'Codex', cliType: 'codex' }),
      'duckcoding-route'
    );

    expect(channels).toHaveLength(1);
    // Resolver must NOT pre-set targetProtocol for customCli channels, so
    // resolveChannelTarget can fall back to the customCli's own cliSettings.
    expect(channels[0].targetProtocol).toBeUndefined();

    const resolved = await resolveChannelTarget(channels[0]);
    expect(resolved.targetProtocol).toBe('openai-chat-completions');
    expect(resolved.targetEndpoint).toBe('/v1/chat/completions');
  });

  it('does not route an unknown requested model through generic channels once registry data exists', () => {
    const source = createSource({
      sourceKey: 'site-nhh:acc-nhh:duckcoding',
      siteId: 'site-nhh',
      siteName: 'nhh',
      accountId: 'acc-nhh',
      accountName: 'NHH Account',
      originalModel: 'duckcoding',
      vendor: 'unknown',
      availableApiKeys: [
        {
          apiKeyId: 'key-nhh',
          apiKeyName: 'NHH Key',
          accountId: 'acc-nhh',
          accountName: 'NHH Account',
          group: 'team-a',
        },
      ],
    });

    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [{ id: 'site-nhh', name: 'nhh', enabled: true, url: 'https://nhh.example.com' }],
      accounts: [
        {
          id: 'acc-nhh',
          site_id: 'site-nhh',
          account_name: 'NHH Account',
          status: 'active',
          cached_data: {
            api_keys: [{ id: 'key-nhh', key: 'sk-nhh', status: 1, group: 'team-a' }],
          },
        },
      ],
    });
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      cliProbe: { latest: {} },
      modelRegistry: {
        version: 1,
        sources: [source],
        entries: {
          duckcoding: {
            canonicalName: 'duckcoding',
            vendor: 'unknown',
            aliases: ['duckcoding'],
            sources: [source],
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [
          {
            id: 'manual:duckcoding',
            vendor: 'unknown',
            canonicalName: 'duckcoding',
            sourceKeys: [source.sourceKey],
            originalModelOrder: ['duckcoding'],
            priorityConfig: {
              sitePriorities: { 'site-nhh': 0 },
              apiKeyPriorities: {},
            },
            mode: 'manual',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        vendorPriorities: {},
      },
    });

    const channels = resolveChannels(
      createRouteRule({
        id: 'rule-gemini',
        name: 'Gemini wildcard',
        cliType: 'geminiCli',
        pattern: '*',
      }),
      'gemini-2.5-flash-lite'
    );

    expect(channels).toEqual([]);
  });

  it('keeps generic routing available for legacy configs without model registry data', () => {
    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [
        { id: 'site-1', name: 'Legacy Site', enabled: true, url: 'https://site.example.com' },
      ],
      accounts: [
        {
          id: 'acc-1',
          site_id: 'site-1',
          account_name: 'Legacy Account',
          status: 'active',
          cached_data: {
            api_keys: [{ id: 'key-a', key: 'sk-legacy', status: 1, group: 'team-a' }],
          },
        },
      ],
    });
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      cliProbe: { latest: {} },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {},
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    });

    const channels = resolveChannels(
      createRouteRule({
        id: 'rule-legacy',
        name: 'Legacy wildcard',
        cliType: 'geminiCli',
        pattern: '*',
      }),
      'gemini-2.5-flash-lite'
    );

    expect(channels).toEqual([
      expect.objectContaining({
        routeRuleId: 'rule-legacy',
        siteId: 'site-1',
        accountId: 'acc-1',
        apiKeyId: 'key-a',
        cliType: 'geminiCli',
        canonicalModel: 'gemini-2.5-flash-lite',
        resolvedModel: 'gemini-2.5-flash-lite',
      }),
    ]);
  });

  it('does not let an unrelated failed CLI probe hide the priority zero route channel', () => {
    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [
        { id: 'site-1', name: 'Priority 0', enabled: true, url: 'https://site-1.example.com' },
        { id: 'site-2', name: 'Priority 1', enabled: true, url: 'https://site-2.example.com' },
      ],
      accounts: [
        { id: 'acc-1', site_id: 'site-1', account_name: 'Primary', status: 'active' },
        { id: 'acc-2', site_id: 'site-2', account_name: 'Backup', status: 'active' },
      ],
    });

    const unrelatedProbeKey = buildProbeKey('site-1', 'acc-1', 'claudeCode', 'unrelated-model');
    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      cliProbe: {
        latest: {
          [unrelatedProbeKey]: {
            probeKey: unrelatedProbeKey,
            siteId: 'site-1',
            accountId: 'acc-1',
            cliType: 'claudeCode',
            canonicalModel: 'unrelated-model',
            rawModel: 'unrelated-model',
            healthy: false,
            lastSample: {
              sampleId: 'sample-1',
              probeKey: unrelatedProbeKey,
              siteId: 'site-1',
              accountId: 'acc-1',
              cliType: 'claudeCode',
              canonicalModel: 'unrelated-model',
              rawModel: 'unrelated-model',
              success: false,
              source: 'routeProbe',
              testedAt: 10,
            },
          },
        },
      },
      modelRegistry: {
        version: 1,
        sources: [
          {
            sourceKey: 'site-1:acc-1:raw-current',
            siteId: 'site-1',
            siteName: 'Priority 0',
            accountId: 'acc-1',
            accountName: 'Primary',
            sourceType: 'account',
            originalModel: 'raw-current',
            vendor: 'claude',
            availableUserGroups: ['team-a'],
            availableApiKeys: [
              {
                apiKeyId: 'key-a',
                apiKeyName: 'key-a',
                accountId: 'acc-1',
                accountName: 'Primary',
                group: 'team-a',
              },
            ],
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
          {
            sourceKey: 'site-2:acc-2:raw-current',
            siteId: 'site-2',
            siteName: 'Priority 1',
            accountId: 'acc-2',
            accountName: 'Backup',
            sourceType: 'account',
            originalModel: 'raw-current',
            vendor: 'claude',
            availableUserGroups: ['team-a'],
            availableApiKeys: [
              {
                apiKeyId: 'key-b',
                apiKeyName: 'key-b',
                accountId: 'acc-2',
                accountName: 'Backup',
                group: 'team-a',
              },
            ],
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
        ],
        entries: {
          'claude-route': {
            canonicalName: 'claude-route',
            vendor: 'claude',
            aliases: ['raw-current'],
            sources: [],
            hasOverride: true,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [
          {
            id: 'manual:claude-route',
            vendor: 'claude',
            canonicalName: 'claude-route',
            sourceKeys: ['site-1:acc-1:raw-current', 'site-2:acc-2:raw-current'],
            originalModelOrder: ['raw-current'],
            priorityConfig: {
              sitePriorities: {
                'site-1': 0,
                'site-2': 1,
              },
              apiKeyPriorities: {},
            },
            mode: 'manual',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        vendorPriorities: {},
      },
    });

    const channels = sortChannelsByScore(
      resolveChannels(
        createRouteRule({
          id: 'rule-1',
          name: 'Claude',
          cliType: 'claudeCode',
        }),
        'claude-route'
      )
    );

    expect(
      channels.map(channel => ({
        siteId: channel.siteId,
        apiKeyId: channel.apiKeyId,
        sitePriority: channel.sitePriority,
      }))
    ).toEqual([
      { siteId: 'site-1', apiKeyId: 'key-a', sitePriority: 0 },
      { siteId: 'site-2', apiKeyId: 'key-b', sitePriority: 1 },
    ]);
  });

  it('does not use failed CLI probe samples as route candidate filters', () => {
    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [
        { id: 'site-1', name: 'Priority 0', enabled: true, url: 'https://site-1.example.com' },
        { id: 'site-2', name: 'Priority 1', enabled: true, url: 'https://site-2.example.com' },
      ],
      accounts: [
        { id: 'acc-1', site_id: 'site-1', account_name: 'Primary', status: 'active' },
        { id: 'acc-2', site_id: 'site-1', account_name: 'Secondary', status: 'active' },
        { id: 'acc-3', site_id: 'site-1', account_name: 'Tertiary', status: 'active' },
        { id: 'acc-4', site_id: 'site-2', account_name: 'Backup', status: 'active' },
      ],
    });

    const failedPrimaryProbeKey = buildProbeKey('site-1', 'acc-1', 'claudeCode', 'raw-current');
    const successfulSecondaryProbeKey = buildProbeKey(
      'site-1',
      'acc-2',
      'claudeCode',
      'raw-current'
    );
    const failedTertiaryProbeKey = buildProbeKey('site-1', 'acc-3', 'claudeCode', 'raw-current');
    const failedBackupProbeKey = buildProbeKey('site-2', 'acc-4', 'claudeCode', 'raw-current');

    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      cliProbe: {
        latest: {
          [failedPrimaryProbeKey]: {
            probeKey: failedPrimaryProbeKey,
            siteId: 'site-1',
            accountId: 'acc-1',
            cliType: 'claudeCode',
            canonicalModel: 'claude-route',
            rawModel: 'raw-current',
            healthy: false,
            lastSample: {
              sampleId: 'sample-primary',
              probeKey: failedPrimaryProbeKey,
              siteId: 'site-1',
              accountId: 'acc-1',
              cliType: 'claudeCode',
              canonicalModel: 'claude-route',
              rawModel: 'raw-current',
              success: false,
              source: 'routeProbe',
              testedAt: 10,
            },
          },
          [successfulSecondaryProbeKey]: {
            probeKey: successfulSecondaryProbeKey,
            siteId: 'site-1',
            accountId: 'acc-2',
            cliType: 'claudeCode',
            canonicalModel: 'claude-route',
            rawModel: 'raw-current',
            healthy: true,
            lastSample: {
              sampleId: 'sample-secondary',
              probeKey: successfulSecondaryProbeKey,
              siteId: 'site-1',
              accountId: 'acc-2',
              cliType: 'claudeCode',
              canonicalModel: 'claude-route',
              rawModel: 'raw-current',
              success: true,
              source: 'routeProbe',
              testedAt: 11,
            },
          },
          [failedTertiaryProbeKey]: {
            probeKey: failedTertiaryProbeKey,
            siteId: 'site-1',
            accountId: 'acc-3',
            cliType: 'claudeCode',
            canonicalModel: 'claude-route',
            rawModel: 'raw-current',
            healthy: false,
            lastSample: {
              sampleId: 'sample-tertiary',
              probeKey: failedTertiaryProbeKey,
              siteId: 'site-1',
              accountId: 'acc-3',
              cliType: 'claudeCode',
              canonicalModel: 'claude-route',
              rawModel: 'raw-current',
              success: false,
              source: 'siteManual',
              testedAt: 12,
            },
          },
          [failedBackupProbeKey]: {
            probeKey: failedBackupProbeKey,
            siteId: 'site-2',
            accountId: 'acc-4',
            cliType: 'claudeCode',
            canonicalModel: 'claude-route',
            rawModel: 'raw-current',
            healthy: false,
            lastSample: {
              sampleId: 'sample-backup',
              probeKey: failedBackupProbeKey,
              siteId: 'site-2',
              accountId: 'acc-4',
              cliType: 'claudeCode',
              canonicalModel: 'claude-route',
              rawModel: 'raw-current',
              success: false,
              source: 'legacyCache',
              testedAt: 13,
            },
          },
        },
      },
      modelRegistry: {
        version: 1,
        sources: [
          {
            sourceKey: 'site-1:acc-1:raw-current',
            siteId: 'site-1',
            siteName: 'Priority 0',
            accountId: 'acc-1',
            accountName: 'Primary',
            sourceType: 'account',
            originalModel: 'raw-current',
            vendor: 'claude',
            availableUserGroups: ['team-a'],
            availableApiKeys: [
              {
                apiKeyId: 'key-a',
                apiKeyName: 'key-a',
                accountId: 'acc-1',
                accountName: 'Primary',
                group: 'team-a',
              },
            ],
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
          {
            sourceKey: 'site-1:acc-2:raw-current',
            siteId: 'site-1',
            siteName: 'Priority 0',
            accountId: 'acc-2',
            accountName: 'Secondary',
            sourceType: 'account',
            originalModel: 'raw-current',
            vendor: 'claude',
            availableUserGroups: ['team-a'],
            availableApiKeys: [
              {
                apiKeyId: 'key-b',
                apiKeyName: 'key-b',
                accountId: 'acc-2',
                accountName: 'Secondary',
                group: 'team-a',
              },
            ],
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
          {
            sourceKey: 'site-1:acc-3:raw-current',
            siteId: 'site-1',
            siteName: 'Priority 0',
            accountId: 'acc-3',
            accountName: 'Tertiary',
            sourceType: 'account',
            originalModel: 'raw-current',
            vendor: 'claude',
            availableUserGroups: ['team-a'],
            availableApiKeys: [
              {
                apiKeyId: 'key-c',
                apiKeyName: 'key-c',
                accountId: 'acc-3',
                accountName: 'Tertiary',
                group: 'team-a',
              },
            ],
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
          {
            sourceKey: 'site-2:acc-4:raw-current',
            siteId: 'site-2',
            siteName: 'Priority 1',
            accountId: 'acc-4',
            accountName: 'Backup',
            sourceType: 'account',
            originalModel: 'raw-current',
            vendor: 'claude',
            availableUserGroups: ['team-a'],
            availableApiKeys: [
              {
                apiKeyId: 'key-d',
                apiKeyName: 'key-d',
                accountId: 'acc-4',
                accountName: 'Backup',
                group: 'team-a',
              },
            ],
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
        ],
        entries: {
          'claude-route': {
            canonicalName: 'claude-route',
            vendor: 'claude',
            aliases: ['raw-current'],
            sources: [],
            hasOverride: true,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [
          {
            id: 'manual:claude-route',
            vendor: 'claude',
            canonicalName: 'claude-route',
            sourceKeys: [
              'site-1:acc-1:raw-current',
              'site-1:acc-2:raw-current',
              'site-1:acc-3:raw-current',
              'site-2:acc-4:raw-current',
            ],
            originalModelOrder: ['raw-current'],
            priorityConfig: {
              sitePriorities: {
                'site-1': 0,
                'site-2': 1,
              },
              apiKeyPriorities: {
                'site-1:acc-1:key-a': 1,
                'site-1:acc-2:key-b': 2,
                'site-1:acc-3:key-c': 3,
                'site-2:acc-4:key-d': 1,
              },
            },
            mode: 'manual',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        vendorPriorities: {},
      },
    });

    const channels = sortChannelsByScore(
      resolveChannels(
        createRouteRule({
          id: 'rule-1',
          name: 'Claude',
          cliType: 'claudeCode',
        }),
        'claude-route'
      )
    );

    expect(
      channels.map(channel => ({
        siteId: channel.siteId,
        accountId: channel.accountId,
        apiKeyId: channel.apiKeyId,
        sitePriority: channel.sitePriority,
        apiKeyPriority: channel.apiKeyPriority,
      }))
    ).toEqual([
      {
        siteId: 'site-1',
        accountId: 'acc-1',
        apiKeyId: 'key-a',
        sitePriority: 0,
        apiKeyPriority: 1,
      },
      {
        siteId: 'site-1',
        accountId: 'acc-2',
        apiKeyId: 'key-b',
        sitePriority: 0,
        apiKeyPriority: 2,
      },
      {
        siteId: 'site-1',
        accountId: 'acc-3',
        apiKeyId: 'key-c',
        sitePriority: 0,
        apiKeyPriority: 3,
      },
      {
        siteId: 'site-2',
        accountId: 'acc-4',
        apiKeyId: 'key-d',
        sitePriority: 1,
        apiKeyPriority: 1,
      },
    ]);
  });

  it('appends sites without explicit priority after all configured site priorities', () => {
    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [
        { id: 'site-1', name: 'Priority 4', enabled: true, url: 'https://site-1.example.com' },
        { id: 'site-2', name: 'Priority 9', enabled: true, url: 'https://site-2.example.com' },
        {
          id: 'site-3',
          name: 'Missing Priority',
          enabled: true,
          url: 'https://site-3.example.com',
        },
      ],
      accounts: [
        { id: 'acc-1', site_id: 'site-1', account_name: 'Primary', status: 'active' },
        { id: 'acc-2', site_id: 'site-2', account_name: 'Secondary', status: 'active' },
        { id: 'acc-3', site_id: 'site-3', account_name: 'Tertiary', status: 'active' },
      ],
    });

    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      cliProbe: { latest: {} },
      modelRegistry: {
        version: 1,
        sources: [
          createSource({
            sourceKey: 'site-1:acc-1:raw-a',
            siteId: 'site-1',
            siteName: 'Priority 4',
            accountId: 'acc-1',
            accountName: 'Primary',
            originalModel: 'raw-a',
            availableApiKeys: [
              {
                apiKeyId: 'key-a',
                apiKeyName: 'key-a',
                accountId: 'acc-1',
                accountName: 'Primary',
                group: 'team-a',
              },
            ],
          }),
          createSource({
            sourceKey: 'site-2:acc-2:raw-a',
            siteId: 'site-2',
            siteName: 'Priority 9',
            accountId: 'acc-2',
            accountName: 'Secondary',
            originalModel: 'raw-a',
            availableApiKeys: [
              {
                apiKeyId: 'key-b',
                apiKeyName: 'key-b',
                accountId: 'acc-2',
                accountName: 'Secondary',
                group: 'team-a',
              },
            ],
          }),
          createSource({
            sourceKey: 'site-3:acc-3:raw-a',
            siteId: 'site-3',
            siteName: 'Missing Priority',
            accountId: 'acc-3',
            accountName: 'Tertiary',
            originalModel: 'raw-a',
            availableApiKeys: [
              {
                apiKeyId: 'key-c',
                apiKeyName: 'key-c',
                accountId: 'acc-3',
                accountName: 'Tertiary',
                group: 'team-a',
              },
            ],
          }),
        ],
        entries: {
          'claude-route': {
            canonicalName: 'claude-route',
            vendor: 'claude',
            aliases: ['raw-a'],
            sources: [],
            hasOverride: true,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [
          {
            id: 'manual:claude-route',
            vendor: 'claude',
            canonicalName: 'claude-route',
            sourceKeys: ['site-1:acc-1:raw-a', 'site-2:acc-2:raw-a', 'site-3:acc-3:raw-a'],
            originalModelOrder: ['raw-a'],
            priorityConfig: {
              sitePriorities: {
                'site-1': 4,
                'site-2': 9,
              },
              apiKeyPriorities: {},
            },
            mode: 'manual',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        vendorPriorities: {},
      },
    });

    const channels = sortChannelsByScore(
      resolveChannels(
        createRouteRule({
          id: 'rule-1',
          name: 'Claude',
          cliType: 'claudeCode',
        }),
        'claude-route'
      )
    );

    expect(
      channels.map(channel => ({
        siteId: channel.siteId,
        apiKeyId: channel.apiKeyId,
        sitePriority: channel.sitePriority,
      }))
    ).toEqual([
      { siteId: 'site-1', apiKeyId: 'key-a', sitePriority: 4 },
      { siteId: 'site-2', apiKeyId: 'key-b', sitePriority: 9 },
      { siteId: 'site-3', apiKeyId: 'key-c', sitePriority: 10 },
    ]);
  });

  it('appends api keys without explicit priority after configured api key priorities', () => {
    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [
        { id: 'site-1', name: 'Priority 0', enabled: true, url: 'https://site-1.example.com' },
      ],
      accounts: [{ id: 'acc-1', site_id: 'site-1', account_name: 'Primary', status: 'active' }],
    });

    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      cliProbe: { latest: {} },
      modelRegistry: {
        version: 1,
        sources: [
          createSource({
            sourceKey: 'site-1:acc-1:raw-a',
            siteId: 'site-1',
            siteName: 'Priority 0',
            accountId: 'acc-1',
            accountName: 'Primary',
            originalModel: 'raw-a',
            availableApiKeys: [
              {
                apiKeyId: 'key-a',
                apiKeyName: 'key-a',
                accountId: 'acc-1',
                accountName: 'Primary',
                group: 'team-a',
              },
              {
                apiKeyId: 'key-b',
                apiKeyName: 'key-b',
                accountId: 'acc-1',
                accountName: 'Primary',
                group: 'team-a',
              },
              {
                apiKeyId: 'key-c',
                apiKeyName: 'key-c',
                accountId: 'acc-1',
                accountName: 'Primary',
                group: 'team-a',
              },
            ],
          }),
        ],
        entries: {
          'claude-route': {
            canonicalName: 'claude-route',
            vendor: 'claude',
            aliases: ['raw-a'],
            sources: [],
            hasOverride: true,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [
          {
            id: 'manual:claude-route',
            vendor: 'claude',
            canonicalName: 'claude-route',
            sourceKeys: ['site-1:acc-1:raw-a'],
            originalModelOrder: ['raw-a'],
            priorityConfig: {
              sitePriorities: {
                'site-1': 0,
              },
              apiKeyPriorities: {
                'site-1:acc-1:key-b': 9,
              },
            },
            mode: 'manual',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        vendorPriorities: {},
      },
    });

    const channels = sortChannelsByScore(
      resolveChannels(
        createRouteRule({
          id: 'rule-1',
          name: 'Claude',
          cliType: 'claudeCode',
        }),
        'claude-route'
      )
    );

    expect(
      channels.map(channel => ({
        apiKeyId: channel.apiKeyId,
        apiKeyPriority: channel.apiKeyPriority,
      }))
    ).toEqual([
      { apiKeyId: 'key-b', apiKeyPriority: 9 },
      { apiKeyId: 'key-a', apiKeyPriority: 10 },
      { apiKeyId: 'key-c', apiKeyPriority: 11 },
    ]);
  });

  it('resolves channels by site priority, api key priority, and original model order', () => {
    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [
        { id: 'site-1', name: 'Site 1', enabled: true, url: 'https://site-1.example.com' },
        { id: 'site-2', name: 'Site 2', enabled: true, url: 'https://site-2.example.com' },
      ],
      accounts: [
        { id: 'acc-1', site_id: 'site-1', account_name: 'Primary', status: 'active' },
        { id: 'acc-2', site_id: 'site-2', account_name: 'Backup', status: 'active' },
      ],
    });

    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      cliProbe: { latest: {} },
      modelRegistry: {
        version: 1,
        sources: [
          {
            sourceKey: 'site-1:acc-1:raw-a',
            siteId: 'site-1',
            siteName: 'Site 1',
            accountId: 'acc-1',
            accountName: 'Primary',
            sourceType: 'account',
            originalModel: 'raw-a',
            vendor: 'claude',
            availableUserGroups: ['team-a'],
            availableApiKeys: [
              {
                apiKeyId: 'key-a',
                apiKeyName: 'key-a',
                accountId: 'acc-1',
                accountName: 'Primary',
                group: 'team-a',
              },
              {
                apiKeyId: 'key-b',
                apiKeyName: 'key-b',
                accountId: 'acc-1',
                accountName: 'Primary',
                group: 'team-a',
              },
            ],
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
          {
            sourceKey: 'site-1:acc-1:raw-b',
            siteId: 'site-1',
            siteName: 'Site 1',
            accountId: 'acc-1',
            accountName: 'Primary',
            sourceType: 'account',
            originalModel: 'raw-b',
            vendor: 'claude',
            availableUserGroups: ['team-a'],
            availableApiKeys: [
              {
                apiKeyId: 'key-a',
                apiKeyName: 'key-a',
                accountId: 'acc-1',
                accountName: 'Primary',
                group: 'team-a',
              },
              {
                apiKeyId: 'key-b',
                apiKeyName: 'key-b',
                accountId: 'acc-1',
                accountName: 'Primary',
                group: 'team-a',
              },
            ],
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
          {
            sourceKey: 'site-2:acc-2:raw-a',
            siteId: 'site-2',
            siteName: 'Site 2',
            accountId: 'acc-2',
            accountName: 'Backup',
            sourceType: 'account',
            originalModel: 'raw-a',
            vendor: 'claude',
            availableUserGroups: ['team-a'],
            availableApiKeys: [
              {
                apiKeyId: 'key-c',
                apiKeyName: 'key-c',
                accountId: 'acc-2',
                accountName: 'Backup',
                group: 'team-a',
              },
            ],
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
        ],
        entries: {
          'claude-route': {
            canonicalName: 'claude-route',
            vendor: 'claude',
            aliases: ['raw-a', 'raw-b'],
            sources: [],
            hasOverride: true,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [
          {
            id: 'seeded:claude:0',
            vendor: 'claude',
            canonicalName: 'claude-route',
            sourceKeys: ['site-1:acc-1:raw-a', 'site-1:acc-1:raw-b', 'site-2:acc-2:raw-a'],
            originalModelOrder: ['raw-b', 'raw-a'],
            priorityConfig: {
              sitePriorities: {
                'site-1': 5,
                'site-2': 9,
              },
              apiKeyPriorities: {
                'site-1:acc-1:key-b': 1,
                'site-1:acc-1:key-a': 3,
                'site-2:acc-2:key-c': 3,
              },
            },
            mode: 'seeded',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        vendorPriorities: {},
      },
    });

    const channels = sortChannelsByScore(
      resolveChannels(
        createRouteRule({
          id: 'rule-1',
          name: 'Claude',
          cliType: 'claudeCode',
        }),
        'claude-route'
      )
    );

    expect(
      channels.map(channel => ({
        siteId: channel.siteId,
        apiKeyId: channel.apiKeyId,
        resolvedModel: channel.resolvedModel,
      }))
    ).toEqual([
      { siteId: 'site-1', apiKeyId: 'key-b', resolvedModel: 'raw-b' },
      { siteId: 'site-1', apiKeyId: 'key-b', resolvedModel: 'raw-a' },
      { siteId: 'site-1', apiKeyId: 'key-a', resolvedModel: 'raw-b' },
      { siteId: 'site-1', apiKeyId: 'key-a', resolvedModel: 'raw-a' },
      { siteId: 'site-2', apiKeyId: 'key-c', resolvedModel: 'raw-a' },
    ]);
  });

  it('expands a selected original model to all same-site accounts before moving to the next site', () => {
    unifiedConfigManagerMock.exportConfigSync.mockReturnValue({
      sites: [
        { id: 'site-1', name: 'Site 1', enabled: true, url: 'https://site-1.example.com' },
        { id: 'site-2', name: 'Site 2', enabled: true, url: 'https://site-2.example.com' },
      ],
      accounts: [
        { id: 'acc-1', site_id: 'site-1', account_name: 'Primary', status: 'active' },
        { id: 'acc-2', site_id: 'site-1', account_name: 'Secondary', status: 'active' },
        { id: 'acc-3', site_id: 'site-2', account_name: 'Backup', status: 'active' },
      ],
    });

    unifiedConfigManagerMock.getRoutingConfig.mockReturnValue({
      cliProbe: { latest: {} },
      modelRegistry: {
        version: 1,
        sources: [
          {
            sourceKey: 'site-1:acc-1:raw-a',
            siteId: 'site-1',
            siteName: 'Site 1',
            accountId: 'acc-1',
            accountName: 'Primary',
            sourceType: 'account',
            originalModel: 'raw-a',
            vendor: 'claude',
            availableUserGroups: ['team-a'],
            availableApiKeys: [
              {
                apiKeyId: 'key-a',
                apiKeyName: 'key-a',
                accountId: 'acc-1',
                accountName: 'Primary',
                group: 'team-a',
              },
            ],
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
          {
            sourceKey: 'site-1:acc-2:raw-a',
            siteId: 'site-1',
            siteName: 'Site 1',
            accountId: 'acc-2',
            accountName: 'Secondary',
            sourceType: 'account',
            originalModel: 'raw-a',
            vendor: 'claude',
            availableUserGroups: ['team-a'],
            availableApiKeys: [
              {
                apiKeyId: 'key-b',
                apiKeyName: 'key-b',
                accountId: 'acc-2',
                accountName: 'Secondary',
                group: 'team-a',
              },
            ],
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
          {
            sourceKey: 'site-2:acc-3:raw-a',
            siteId: 'site-2',
            siteName: 'Site 2',
            accountId: 'acc-3',
            accountName: 'Backup',
            sourceType: 'account',
            originalModel: 'raw-a',
            vendor: 'claude',
            availableUserGroups: ['team-a'],
            availableApiKeys: [
              {
                apiKeyId: 'key-c',
                apiKeyName: 'key-c',
                accountId: 'acc-3',
                accountName: 'Backup',
                group: 'team-a',
              },
            ],
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
        ],
        entries: {
          'claude-route': {
            canonicalName: 'claude-route',
            vendor: 'claude',
            aliases: ['raw-a'],
            sources: [],
            hasOverride: true,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [
          {
            id: 'manual:claude:stale',
            vendor: 'claude',
            canonicalName: 'claude-route',
            sourceKeys: ['site-1:acc-1:raw-a'],
            originalModelOrder: ['raw-a'],
            priorityConfig: {
              sitePriorities: {
                'site-1': 0,
                'site-2': 1,
              },
              apiKeyPriorities: {},
            },
            mode: 'manual',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        vendorPriorities: {},
      },
    });

    const channels = sortChannelsByScore(
      resolveChannels(
        createRouteRule({
          id: 'rule-1',
          name: 'Claude',
          cliType: 'claudeCode',
        }),
        'claude-route'
      )
    );

    expect(
      channels.map(channel => ({
        siteId: channel.siteId,
        accountId: channel.accountId,
        apiKeyId: channel.apiKeyId,
      }))
    ).toEqual([
      { siteId: 'site-1', accountId: 'acc-1', apiKeyId: 'key-a' },
      { siteId: 'site-1', accountId: 'acc-2', apiKeyId: 'key-b' },
      { siteId: 'site-2', accountId: 'acc-3', apiKeyId: 'key-c' },
    ]);
  });
});
