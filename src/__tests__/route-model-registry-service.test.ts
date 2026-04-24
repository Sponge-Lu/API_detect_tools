import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RouteModelMappingOverride,
  RouteModelRegistryConfig,
} from '../shared/types/route-proxy';

const { unifiedConfigManagerMock, loggerScopeMock } = vi.hoisted(() => ({
  unifiedConfigManagerMock: {
    exportConfigSync: vi.fn(),
    getRoutingConfig: vi.fn(),
    updateRouteModelRegistry: vi.fn(),
    upsertRouteModelMappingOverride: vi.fn(),
    deleteRouteModelMappingOverride: vi.fn(),
    updateRouteVendorPriorityConfig: vi.fn(),
  },
  loggerScopeMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: unifiedConfigManagerMock,
}));

vi.mock('../main/utils/logger', () => ({
  default: {
    scope: () => loggerScopeMock,
  },
}));

import {
  rebuildModelRegistry,
  resolveCanonicalName,
  syncModelRegistrySources,
} from '../main/route-model-registry-service';
import { resolveChannels } from '../main/route-channel-resolver';
import { sortChannelsByScore } from '../main/route-stats-service';

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

describe('route model registry service', () => {
  beforeEach(() => {
    unifiedConfigManagerMock.exportConfigSync.mockReset();
    unifiedConfigManagerMock.getRoutingConfig.mockReset();
    unifiedConfigManagerMock.updateRouteModelRegistry.mockReset().mockResolvedValue(undefined);
    unifiedConfigManagerMock.upsertRouteModelMappingOverride.mockReset();
    unifiedConfigManagerMock.deleteRouteModelMappingOverride.mockReset();
    unifiedConfigManagerMock.updateRouteVendorPriorityConfig.mockReset();
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

    expect(result.entries['gpt-4.1']).toMatchObject({
      canonicalName: 'gpt-4.1',
      vendor: 'gpt',
      aliases: ['gpt-4.1-preview'],
      hasOverride: true,
      sources: [
        expect.objectContaining({
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
      ],
    });
    expect(unifiedConfigManagerMock.updateRouteModelRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: expect.objectContaining({
          'gpt-4.1': expect.any(Object),
        }),
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

  it('seeds only the top three display items per vendor during rebuild', async () => {
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
            models: ['gpt-5.4-20260101', 'o3-20260101', 'gpt-5-20260101', 'gpt-4.1-20260101'],
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
      'gpt-5.4-20260101',
      'o3-20260101',
      'gpt-5-20260101',
      'gpt-4.1-20260101',
    ]);
    expect(result.entries['gpt-4.1']).toBeUndefined();
    expect(
      result.displayItems
        .filter(item => item.vendor === 'gpt')
        .map(item => ({ canonicalName: item.canonicalName, mode: item.mode }))
    ).toEqual([
      { canonicalName: 'gpt-5-4', mode: 'seeded' },
      { canonicalName: 'o3', mode: 'seeded' },
      { canonicalName: 'gpt-5', mode: 'seeded' },
    ]);
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
            mode: 'seeded',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        vendorPriorities: {
          claude: {
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
        },
      },
    });

    const channels = sortChannelsByScore(
      resolveChannels(
        {
          id: 'rule-1',
          name: 'Claude',
          enabled: true,
          priority: 1,
          cliType: 'claudeCode',
        } as any,
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
});
