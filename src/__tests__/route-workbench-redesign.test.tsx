import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDisplayItemViews,
  buildRecommendedCliModelOptions,
  ModelRedirectionTab,
  shouldRefreshRegistrySourceDetails,
} from '../renderer/components/Route/Redirection/ModelRedirectionTab';
import { RoutePage } from '../renderer/pages/RoutePage';
import { ConfigFilesPage } from '../renderer/pages/ConfigFilesPage';
import { useCustomCliConfigStore } from '../renderer/store/customCliConfigStore';
import { buildRouteApiKeyPriorityKey, buildRoutePathStateKey } from '../shared/types/route-proxy';
import type {
  RouteRequestLogItem,
  RouteModelDisplayItem,
  RouteModelRegistryConfig,
  RouteModelSourceRef,
  RoutingConfig,
} from '../shared/types/route-proxy';
import type { CustomCliConfig } from '../shared/types/custom-cli-config';
import type { UnifiedConfig } from '../shared/types/site';

const mockUpsertMappingOverride = vi.fn();
const mockUpsertDisplayItem = vi.fn();
const mockDeleteDisplayItem = vi.fn();
const mockDeleteMappingOverride = vi.fn();
const mockRebuildModelRegistry = vi.fn();
const mockSyncModelRegistrySources = vi.fn();
const mockRefreshRuntimeState = vi.fn();
const mockResetPathStates = vi.fn();
const mockWriteConfig = vi.fn();
const mockClearCache = vi.fn();
const mockGetAnalyticsSummary = vi.fn();
const mockGetRequestLogs = vi.fn();
const mockOnRequestLogAppended = vi.fn();
const mockLoadConfig = vi.fn();
const mockCreateApiToken = vi.fn();
const mockSaveCliModelSelections = vi.fn();
const mockSaveCliThinkingEffortSelections = vi.fn();
const mockSaveServerConfig = vi.fn();
const mockRegenerateApiKey = vi.fn();
const mockStartServer = vi.fn();
const mockStopServer = vi.fn();

let mockConfig: RoutingConfig;

type MockElectronApi = {
  loadConfig?: typeof mockLoadConfig;
  appData?: {
    onChanged: ReturnType<typeof vi.fn>;
  };
  token?: {
    createApiToken?: typeof mockCreateApiToken;
  };
  route: {
    getAnalyticsSummary: typeof mockGetAnalyticsSummary;
    getRequestLogs?: typeof mockGetRequestLogs;
    onRequestLogAppended?: typeof mockOnRequestLogAppended;
  };
  cliCompat?: {
    writeConfig?: typeof mockWriteConfig;
  };
  configDetection?: {
    clearCache?: typeof mockClearCache;
  };
};

type MockRouteStoreShape = {
  config: RoutingConfig;
  loading: boolean;
  serverRunning: boolean;
  refreshRuntimeState: typeof mockRefreshRuntimeState;
  rebuildModelRegistry: typeof mockRebuildModelRegistry;
  syncModelRegistrySources: typeof mockSyncModelRegistrySources;
  saveCliModelSelections: typeof mockSaveCliModelSelections;
  saveCliThinkingEffortSelections: typeof mockSaveCliThinkingEffortSelections;
  saveServerConfig: typeof mockSaveServerConfig;
  regenerateApiKey: typeof mockRegenerateApiKey;
  startServer: typeof mockStartServer;
  stopServer: typeof mockStopServer;
  upsertMappingOverride: typeof mockUpsertMappingOverride;
  upsertDisplayItem: typeof mockUpsertDisplayItem;
  deleteDisplayItem: typeof mockDeleteDisplayItem;
  deleteMappingOverride: typeof mockDeleteMappingOverride;
  resetPathStates: typeof mockResetPathStates;
};

vi.mock('zustand/shallow', () => ({
  useShallow: (selector: unknown) => selector,
}));

vi.mock('../renderer/store/toastStore', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../renderer/store/routeStore', () => ({
  useRouteStore: (selector: (store: MockRouteStoreShape) => unknown) =>
    selector({
      config: mockConfig,
      loading: false,
      serverRunning: true,
      refreshRuntimeState: mockRefreshRuntimeState,
      rebuildModelRegistry: mockRebuildModelRegistry,
      syncModelRegistrySources: mockSyncModelRegistrySources,
      saveCliModelSelections: mockSaveCliModelSelections,
      saveCliThinkingEffortSelections: mockSaveCliThinkingEffortSelections,
      saveServerConfig: mockSaveServerConfig,
      regenerateApiKey: mockRegenerateApiKey,
      startServer: mockStartServer,
      stopServer: mockStopServer,
      upsertMappingOverride: mockUpsertMappingOverride,
      upsertDisplayItem: mockUpsertDisplayItem,
      deleteDisplayItem: mockDeleteDisplayItem,
      deleteMappingOverride: mockDeleteMappingOverride,
      resetPathStates: mockResetPathStates,
    }),
}));

function getRedirectRowByName(displayName: string): HTMLElement {
  const row = screen
    .getAllByTestId('redirect-list-row')
    .find(candidate => within(candidate).queryByText(displayName));

  if (!row) {
    throw new Error(`Redirect row not found: ${displayName}`);
  }

  return row;
}

function selectRedirectRow(displayName: string): void {
  fireEvent.click(getRedirectRowByName(displayName));
}

async function findPriorityDetailPane(): Promise<HTMLElement> {
  const detailPane = await screen.findByTestId('redirect-detail-pane');
  await within(detailPane).findByTestId('redirect-detail-actions');
  await within(detailPane).findByTestId('priority-detail-compact-list');
  return detailPane;
}

function getPrioritySiteSections(detailPane: HTMLElement): HTMLElement[] {
  return Array.from(
    detailPane.querySelectorAll('[data-testid="priority-detail-site-group"]')
  ) as HTMLElement[];
}

function createFirstHitRouteLog(overrides: Partial<RouteRequestLogItem> = {}): RouteRequestLogItem {
  return {
    id: 'route-log-live-1',
    requestId: 'req-live',
    attempt: 1,
    cliType: 'claudeCode',
    requestedModel: 'claude-opus-4.6-20260201',
    canonicalModel: 'claude-opus-4-6',
    routeRuleId: 'rule-claude',
    siteId: 'site-1',
    siteName: 'Claude Site',
    accountId: 'acc-1',
    accountName: 'Main',
    userGroupKey: 'team-beta',
    apiKeyId: 'backup-key-id',
    apiKeyName: 'backup-key',
    resolvedModel: 'claude-opus-4.6-20260201',
    outcome: 'success',
    createdAt: 1_800_000_000_000,
    ...overrides,
  };
}

function createSource(overrides: Partial<RouteModelSourceRef>): RouteModelSourceRef {
  return {
    sourceKey: 'site-1:acc-1:model-a',
    siteId: 'site-1',
    siteName: 'Default Site',
    accountId: 'acc-1',
    accountName: 'Main',
    sourceType: 'account',
    originalModel: 'model-a',
    vendor: 'claude',
    availableUserGroups: [],
    availableApiKeys: [],
    firstSeenAt: 1,
    lastSeenAt: 1,
    ...overrides,
  };
}

function createCustomCliStoreConfig(overrides: Partial<CustomCliConfig> = {}): CustomCliConfig {
  return {
    id: 'duckcoding',
    name: 'DuckCoding',
    baseUrl: 'https://duck.example.com',
    apiKey: 'sk-duck',
    groupMultiplier: 0.001,
    models: ['duckcoding'],
    manualModels: [],
    notes: '',
    modelPricing: {
      data: {
        duckcoding: { input: 2, output: 4, quota_type: 0 },
      },
    },
    cliSettings: {
      claudeCode: {
        enabled: false,
        model: null,
      },
      codex: {
        enabled: true,
        model: 'duckcoding',
      },
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createModelRegistryConfig(): RouteModelRegistryConfig {
  const claudeOpusSource = createSource({
    sourceKey: 'site-1:acc-1:claude-opus-4.6-20260201',
    siteId: 'site-1',
    siteName: 'Claude Site',
    accountId: 'acc-1',
    accountName: 'Main',
    originalModel: 'claude-opus-4.6-20260201',
    vendor: 'claude',
    userGroupKeys: ['team-alpha', 'team-beta'],
    apiKeyGroups: ['team-beta'],
    apiKeyNamesByGroup: {
      'team-beta': ['main-key', 'backup-key'],
    },
    availableUserGroups: ['team-alpha', 'team-beta'],
    availableApiKeys: [
      {
        apiKeyId: 'main-key-id',
        apiKeyName: 'main-key',
        accountId: 'acc-1',
        accountName: 'Main',
        group: 'team-beta',
      },
      {
        apiKeyId: 'backup-key-id',
        apiKeyName: 'backup-key',
        accountId: 'acc-1',
        accountName: 'Main',
        group: 'team-beta',
      },
    ],
    firstSeenAt: 10,
    lastSeenAt: 10,
  });
  const claudeOpusBackupSource = createSource({
    sourceKey: 'site-1:acc-9:claude-opus-4.6-20260201',
    siteId: 'site-1',
    siteName: 'Claude Site',
    accountId: 'acc-9',
    accountName: 'Backup',
    originalModel: 'claude-opus-4.6-20260201',
    vendor: 'claude',
    userGroupKeys: ['team-delta'],
    apiKeyGroups: ['team-delta'],
    apiKeyNamesByGroup: {
      'team-delta': ['backup-site-key'],
    },
    availableUserGroups: ['team-delta'],
    availableApiKeys: [
      {
        apiKeyId: 'backup-site-key-id',
        apiKeyName: 'backup-site-key',
        accountId: 'acc-9',
        accountName: 'Backup',
        group: 'team-delta',
      },
    ],
    firstSeenAt: 10,
    lastSeenAt: 10,
  });
  const claudeSonnetSource = createSource({
    sourceKey: 'site-1:acc-1:claude-sonnet-4.6-20260201',
    siteId: 'site-1',
    siteName: 'Claude Site',
    accountId: 'acc-1',
    accountName: 'Main',
    originalModel: 'claude-sonnet-4.6-20260201',
    vendor: 'claude',
    userGroupKeys: ['team-alpha'],
    apiKeyGroups: [],
    apiKeyNamesByGroup: {},
    availableUserGroups: ['team-alpha'],
    availableApiKeys: [],
    firstSeenAt: 11,
    lastSeenAt: 11,
  });
  const claudeHaikuSource = createSource({
    sourceKey: 'site-2:acc-2:claude-haiku-4.5-20251001',
    siteId: 'site-2',
    siteName: 'Claude Site 2',
    accountId: 'acc-2',
    accountName: 'Secondary',
    originalModel: 'claude-haiku-4.5-20251001',
    vendor: 'claude',
    userGroupKeys: ['team-gamma'],
    apiKeyGroups: ['team-gamma'],
    apiKeyNamesByGroup: {
      'team-gamma': ['shared-key'],
    },
    availableUserGroups: ['team-gamma'],
    availableApiKeys: [
      {
        apiKeyId: 'shared-key-id',
        apiKeyName: 'shared-key',
        accountId: 'acc-2',
        accountName: 'Secondary',
        group: 'team-gamma',
      },
    ],
    firstSeenAt: 12,
    lastSeenAt: 12,
  });
  const claudeInstantSource = createSource({
    sourceKey: 'site-0:acc-0:claude-instant-4.5-20251001',
    siteId: 'site-0',
    siteName: 'Claude Site 0',
    accountId: 'acc-0',
    accountName: 'Empty',
    originalModel: 'claude-instant-4.5-20251001',
    vendor: 'claude',
    userGroupKeys: ['team-zeta'],
    apiKeyGroups: [],
    apiKeyNamesByGroup: {},
    availableUserGroups: ['team-zeta'],
    availableApiKeys: [],
    firstSeenAt: 9,
    lastSeenAt: 9,
  });
  const gpt54LatestSource = createSource({
    sourceKey: 'site-3:acc-3:gpt-5.4-latest',
    siteId: 'site-3',
    siteName: 'OpenAI Site',
    accountId: 'acc-3',
    accountName: 'Main',
    originalModel: 'gpt-5.4-latest',
    vendor: 'gpt',
    availableUserGroups: ['shared'],
    availableApiKeys: [
      {
        apiKeyId: 'gpt-main-key-id',
        apiKeyName: 'gpt-main-key',
        accountId: 'acc-3',
        accountName: 'Main',
        group: 'shared',
      },
    ],
    firstSeenAt: 13,
    lastSeenAt: 13,
  });
  const gpt54ExperimentalSource = createSource({
    sourceKey: 'site-4:acc-4:gpt-5.4-experimental',
    siteId: 'site-4',
    siteName: 'Legacy OpenAI Site',
    accountId: 'acc-4',
    accountName: 'Legacy',
    originalModel: 'gpt-5.4-experimental',
    vendor: 'gpt',
    availableUserGroups: ['legacy-group'],
    availableApiKeys: [
      {
        apiKeyId: 'legacy-key-id',
        apiKeyName: 'legacy-key',
        accountId: 'acc-4',
        accountName: 'Legacy',
        group: 'legacy-group',
      },
    ],
    firstSeenAt: 13,
    lastSeenAt: 13,
  });
  const gpt5Source = createSource({
    sourceKey: 'site-3:acc-3:gpt-5-latest',
    siteId: 'site-3',
    siteName: 'OpenAI Site',
    accountId: 'acc-3',
    accountName: 'Main',
    originalModel: 'gpt-5-latest',
    vendor: 'gpt',
    availableUserGroups: [],
    availableApiKeys: [],
    firstSeenAt: 14,
    lastSeenAt: 14,
  });
  const o3Source = createSource({
    sourceKey: 'site-3:acc-3:o3-latest',
    siteId: 'site-3',
    siteName: 'OpenAI Site',
    accountId: 'acc-3',
    accountName: 'Main',
    originalModel: 'o3-latest',
    vendor: 'gpt',
    availableUserGroups: [],
    availableApiKeys: [],
    firstSeenAt: 15,
    lastSeenAt: 15,
  });
  const gpt41Source = createSource({
    sourceKey: 'site-3:acc-3:gpt-4.1-edge',
    siteId: 'site-3',
    siteName: 'OpenAI Site',
    accountId: 'acc-3',
    accountName: 'Main',
    originalModel: 'gpt-4.1-edge',
    vendor: 'gpt',
    availableUserGroups: [],
    availableApiKeys: [],
    firstSeenAt: 16,
    lastSeenAt: 16,
  });
  const customCliSource = createSource({
    sourceKey: 'custom-cli-site-duckcoding:custom-cli-account-duckcoding:duckcoding',
    siteId: 'custom-cli-site-duckcoding',
    siteName: 'DuckCoding',
    accountId: 'custom-cli-account-duckcoding',
    accountName: '自定义 CLI',
    sourceType: 'customCli',
    originalModel: 'duckcoding',
    vendor: 'unknown',
    availableCliTypes: ['codex'],
    userGroupKeys: ['custom-cli'],
    apiKeyGroups: ['custom-cli'],
    apiKeyNamesByGroup: {
      'custom-cli': ['DuckCoding Key'],
    },
    availableUserGroups: ['custom-cli'],
    availableApiKeys: [
      {
        apiKeyId: 'custom-cli-key-duckcoding',
        apiKeyName: 'DuckCoding Key',
        accountId: 'custom-cli-account-duckcoding',
        accountName: '自定义 CLI',
        group: 'custom-cli',
      },
    ],
    firstSeenAt: 17,
    lastSeenAt: 17,
  });

  const sources = [
    claudeInstantSource,
    claudeOpusSource,
    claudeOpusBackupSource,
    claudeSonnetSource,
    claudeHaikuSource,
    gpt54LatestSource,
    gpt54ExperimentalSource,
    gpt5Source,
    o3Source,
    gpt41Source,
    customCliSource,
  ];

  const displayItems: RouteModelDisplayItem[] = [
    {
      id: 'manual:claude-opus-4-6',
      vendor: 'claude',
      canonicalName: 'claude-opus-4-6',
      sourceKeys: [
        claudeInstantSource.sourceKey,
        claudeOpusSource.sourceKey,
        claudeOpusBackupSource.sourceKey,
        claudeSonnetSource.sourceKey,
        claudeHaikuSource.sourceKey,
      ],
      originalModelOrder: [
        claudeInstantSource.originalModel,
        claudeOpusSource.originalModel,
        claudeSonnetSource.originalModel,
        claudeHaikuSource.originalModel,
      ],
      priorityConfig: {
        sitePriorities: {
          'site-1': 5,
          'site-2': 9,
        },
        apiKeyPriorities: {
          [buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'backup-key-id')]: 1,
          [buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'main-key-id')]: 3,
          [buildRouteApiKeyPriorityKey('site-1', 'acc-9', 'backup-site-key-id')]: 5,
          [buildRouteApiKeyPriorityKey('site-2', 'acc-2', 'shared-key-id')]: 3,
        },
      },
      mode: 'manual',
      createdAt: 10,
      updatedAt: 10,
    },
    {
      id: 'manual:gpt-5.4',
      vendor: 'gpt',
      canonicalName: 'gpt-5.4',
      sourceKeys: [gpt54LatestSource.sourceKey, gpt54ExperimentalSource.sourceKey],
      originalModelOrder: [gpt54LatestSource.originalModel, gpt54ExperimentalSource.originalModel],
      priorityConfig: {
        sitePriorities: {},
        apiKeyPriorities: {},
      },
      mode: 'manual',
      createdAt: 13,
      updatedAt: 13,
    },
  ];

  return {
    version: 1,
    sources,
    entries: {
      'claude-opus-4-6': {
        vendor: 'claude',
        canonicalName: 'claude-opus-4-6',
        aliases: [
          claudeInstantSource.originalModel,
          claudeOpusSource.originalModel,
          claudeOpusBackupSource.originalModel,
          claudeSonnetSource.originalModel,
          claudeHaikuSource.originalModel,
        ],
        sources: [
          claudeInstantSource,
          claudeOpusSource,
          claudeOpusBackupSource,
          claudeSonnetSource,
          claudeHaikuSource,
        ],
        hasOverride: true,
        createdAt: 10,
        updatedAt: 40,
      },
      'gpt-5.4': {
        vendor: 'gpt',
        canonicalName: 'gpt-5.4',
        aliases: [gpt54LatestSource.originalModel, gpt54ExperimentalSource.originalModel],
        sources: [gpt54LatestSource, gpt54ExperimentalSource],
        hasOverride: false,
        createdAt: 13,
        updatedAt: 34,
      },
      'gpt-5': {
        vendor: 'gpt',
        canonicalName: 'gpt-5',
        aliases: [gpt5Source.originalModel],
        sources: [gpt5Source],
        hasOverride: false,
        createdAt: 14,
        updatedAt: 33,
      },
      o3: {
        vendor: 'gpt',
        canonicalName: 'o3',
        aliases: [o3Source.originalModel],
        sources: [o3Source],
        hasOverride: false,
        createdAt: 15,
        updatedAt: 32,
      },
      'gpt-4.1': {
        vendor: 'gpt',
        canonicalName: 'gpt-4.1',
        aliases: [gpt41Source.originalModel],
        sources: [gpt41Source],
        hasOverride: false,
        createdAt: 16,
        updatedAt: 31,
      },
    },
    overrides: [
      {
        id: 'override-1',
        sourceKey: claudeSonnetSource.sourceKey,
        canonicalName: 'claude-opus-4-6',
        action: 'rename',
        createdAt: 30,
        updatedAt: 40,
      },
      {
        id: 'override-2',
        sourceKey: claudeHaikuSource.sourceKey,
        canonicalName: 'claude-opus-4-6',
        action: 'rename',
        createdAt: 31,
        updatedAt: 40,
      },
    ],
    displayItems,
    vendorPriorities: {},
    lastAggregatedAt: 100,
  };
}

function createRoutingConfig(
  options: { includeSuccessfulPathState?: boolean } = {}
): RoutingConfig {
  const disabledPathState = {
    routeRuleId: 'rule-claude',
    siteId: 'site-1',
    accountId: 'acc-1',
    apiKeyId: 'main-key-id',
    cliType: 'claudeCode' as const,
    canonicalModel: 'claude-opus-4-6',
    resolvedModel: 'claude-opus-4.6-20260201',
    windowStartedAt: 100,
    windowRequestCount: 1,
    windowSuccessCount: 0,
    successRate: 0,
    disabledUntil: 4_102_444_800_000,
    disabledReason: 'success_rate_below_threshold' as const,
    lastOutcome: 'failure' as const,
    lastStatusCode: 502,
    lastUsedAt: 100,
    lastFailureAt: 100,
    updatedAt: 100,
  };
  const routePathStates: RoutingConfig['routePathStates'] = {
    [buildRoutePathStateKey(disabledPathState)]: disabledPathState,
  };

  if (options.includeSuccessfulPathState) {
    const now = Date.now();
    const successfulPathState = {
      routeRuleId: 'rule-claude',
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'backup-key-id',
      cliType: 'claudeCode' as const,
      targetProtocol: 'native' as const,
      canonicalModel: 'claude-opus-4-6',
      resolvedModel: 'claude-opus-4.6-20260201',
      windowStartedAt: now - 120_000,
      windowRequestCount: 2,
      windowSuccessCount: 2,
      successRate: 1,
      lastOutcome: 'success' as const,
      lastStatusCode: 200,
      lastUsedAt: now - 30_000,
      lastSuccessAt: now - 30_000,
      updatedAt: now - 30_000,
    };
    routePathStates[buildRoutePathStateKey(successfulPathState)] = successfulPathState;
  }

  return {
    modelRegistry: createModelRegistryConfig(),
    cliModelSelections: {
      claudeCode: 'claude-opus-4-6',
      codex: 'gpt-5.4',
      openCode: 'gpt-5.4',
      grokBuild: 'gpt-5.4',
    },
    cliThinkingEffortSelections: {
      claudeCode: null,
      codex: null,
      openCode: null,
      grokBuild: null,
    },
    routePathStates,
    server: { host: '127.0.0.1', port: 3000, unifiedApiKey: 'route-key' },
  } as RoutingConfig;
}

function createUnifiedConfigFixture(): UnifiedConfig {
  return {
    version: '1',
    sites: [
      {
        id: 'site-1',
        name: 'Claude Site',
        url: 'https://claude-site.example.com',
        site_type: 'newapi',
        enabled: true,
        group: 'default',
        has_checkin: false,
        force_enable_checkin: false,
        extra_links: '',
        auto_refresh: false,
        auto_refresh_interval: 60,
      },
      {
        id: 'site-2',
        name: 'Claude Site 2',
        url: 'https://claude-site-2.example.com',
        site_type: 'newapi',
        enabled: true,
        group: 'default',
        has_checkin: false,
        force_enable_checkin: false,
        extra_links: '',
        auto_refresh: false,
        auto_refresh_interval: 60,
      },
    ],
    accounts: [
      {
        id: 'acc-1',
        site_id: 'site-1',
        account_name: 'Main',
        user_id: '101',
        access_token: 'access-main',
        auth_source: 'cookie',
        status: 'active',
        cached_data: {
          balance: 12.5,
          user_groups: {
            'team-alpha': { desc: 'Alpha', ratio: 1.2 },
            'team-beta': { desc: 'Beta', ratio: 1.5 },
          },
          model_pricing: {
            data: {
              'claude-opus-4.6-20260201': {
                model_price: { input: 0.001, output: 0.002 },
              },
              'claude-sonnet-4.6-20260201': {
                input: 0.0008,
                output: 0.0016,
              },
            },
          },
        },
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 'acc-9',
        site_id: 'site-1',
        account_name: 'Backup',
        user_id: '109',
        access_token: 'access-backup',
        auth_source: 'cookie',
        status: 'active',
        cached_data: {
          balance: 3,
          user_groups: {
            'team-delta': { desc: 'Delta', ratio: 2 },
          },
          model_pricing: {
            data: {
              'claude-opus-4.6-20260201': {
                model_price: { input: 0.001, output: 0.002 },
              },
            },
          },
        },
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 'acc-2',
        site_id: 'site-2',
        account_name: 'Secondary',
        user_id: '102',
        access_token: 'access-secondary',
        auth_source: 'cookie',
        status: 'active',
        cached_data: {
          balance: -1,
          user_groups: {
            'team-gamma': { desc: 'Gamma', ratio: 1 },
          },
          model_pricing: {
            data: {
              'claude-haiku-4.5-20251001': {
                model_ratio: 0.5,
                completion_ratio: 3,
              },
            },
          },
        },
        created_at: 1,
        updated_at: 1,
      },
    ],
    siteGroups: [],
    settings: {},
    last_updated: 1,
  } as UnifiedConfig;
}

function createRegistryWithCreatedTeamAlphaKey(): RouteModelRegistryConfig {
  const registry = createModelRegistryConfig();
  const enrichSource = (source: RouteModelSourceRef): RouteModelSourceRef => {
    if (source.siteId !== 'site-1' || source.accountId !== 'acc-1') {
      return source;
    }

    return {
      ...source,
      apiKeyGroups: Array.from(new Set([...(source.apiKeyGroups || []), 'team-alpha'])),
      apiKeyNamesByGroup: {
        ...(source.apiKeyNamesByGroup || {}),
        'team-alpha': ['team-alpha-key'],
      },
      availableApiKeys: [
        ...(source.availableApiKeys || []),
        {
          apiKeyId: 'team-alpha-key-id',
          apiKeyName: 'team-alpha-key',
          accountId: 'acc-1',
          accountName: 'Main',
          group: 'team-alpha',
        },
      ],
    };
  };

  return {
    ...registry,
    sources: registry.sources.map(enrichSource),
    entries: {
      ...registry.entries,
      'claude-opus-4-6': {
        ...registry.entries['claude-opus-4-6']!,
        sources: registry.entries['claude-opus-4-6']!.sources.map(enrichSource),
      },
    },
  };
}

beforeEach(() => {
  mockConfig = createRoutingConfig();
  useCustomCliConfigStore.setState({
    configs: [],
    activeConfigId: null,
    loading: false,
    saving: false,
    fetchingModels: {},
  });

  mockWriteConfig.mockReset().mockResolvedValue({
    success: true,
    writtenPaths: ['~/.claude/settings.json', '~/.claude/config.json'],
  });
  mockClearCache.mockReset().mockResolvedValue({ success: true });
  mockUpsertMappingOverride.mockReset().mockResolvedValue({
    id: 'override-new',
    sourceKey: 'site-2:acc-2:claude-haiku-4.5-20251001',
    canonicalName: 'claude-team-route',
    action: 'rename',
    createdAt: 50,
    updatedAt: 50,
  });
  mockUpsertDisplayItem.mockReset().mockImplementation(async displayItem => {
    const nextRegistry = {
      ...createModelRegistryConfig(),
      displayItems: createModelRegistryConfig().displayItems.map(item =>
        item.id === displayItem.id || item.canonicalName === displayItem.canonicalName
          ? {
              ...item,
              ...displayItem,
            }
          : item
      ),
    };
    mockConfig = {
      ...mockConfig,
      modelRegistry: nextRegistry,
    };
    return nextRegistry;
  });
  mockDeleteDisplayItem.mockReset().mockResolvedValue(createModelRegistryConfig());
  mockDeleteMappingOverride.mockReset().mockResolvedValue(true);
  mockRebuildModelRegistry.mockReset().mockResolvedValue(createModelRegistryConfig());
  mockSyncModelRegistrySources.mockReset().mockResolvedValue(createModelRegistryConfig());
  mockRefreshRuntimeState.mockReset().mockResolvedValue(undefined);
  mockResetPathStates.mockReset().mockResolvedValue(1);
  mockSaveCliModelSelections.mockReset().mockResolvedValue(undefined);
  mockSaveCliThinkingEffortSelections.mockReset().mockResolvedValue(undefined);
  mockSaveServerConfig.mockReset().mockResolvedValue(undefined);
  mockRegenerateApiKey.mockReset().mockResolvedValue('sk-route-new');
  mockStartServer.mockReset().mockResolvedValue(true);
  mockStopServer.mockReset().mockResolvedValue(true);
  mockLoadConfig.mockReset().mockResolvedValue(createUnifiedConfigFixture());
  mockCreateApiToken.mockReset().mockResolvedValue({
    success: true,
    data: [],
  });
  mockGetAnalyticsSummary.mockReset().mockResolvedValue({
    success: true,
    data: {
      totalRequests: 12,
      successRate: 100,
      promptTokens: 2048,
      completionTokens: 1024,
    },
  });
  mockGetRequestLogs.mockReset().mockResolvedValue({ success: true, data: [] });
  mockOnRequestLogAppended.mockReset().mockReturnValue(vi.fn());

  const electronApi = (window as Window & typeof globalThis & { electronAPI: MockElectronApi })
    .electronAPI;
  electronApi.route = {
    getAnalyticsSummary: mockGetAnalyticsSummary,
    getRequestLogs: mockGetRequestLogs,
    onRequestLogAppended: mockOnRequestLogAppended,
    previewProfileStateClear: vi.fn(),
    clearProfileState: vi.fn(),
  };
  electronApi.cliCompat = {
    ...(electronApi.cliCompat || {}),
    writeConfig: mockWriteConfig,
  };
  electronApi.configDetection = {
    ...(electronApi.configDetection || {}),
    clearCache: mockClearCache,
  };
  electronApi.loadConfig = mockLoadConfig;
  electronApi.appData = {
    onChanged: vi.fn(() => vi.fn()),
  };
  electronApi.configFileProfiles = {
    load: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockImplementation(async ({ profile }: any) => profile),
    delete: vi.fn().mockResolvedValue(undefined),
    getTargetCatalog: vi.fn().mockResolvedValue([]),
    restoreBuiltin: vi.fn(),
    readFiles: vi.fn().mockResolvedValue([]),
    preview: vi.fn().mockResolvedValue({ files: [] }),
    previewDirectEdit: vi.fn().mockResolvedValue({ files: [] }),
    resolveValues: vi.fn().mockImplementation(async ({ profile }: any) => ({
      baseUrl: profile.target.kind === 'local-route' ? 'http://127.0.0.1:3000/v1' : '',
      apiKey: profile.localRouteCredential?.apiKey || '',
      model: profile.target.model || '',
    })),
    generateRouteKey: vi.fn(),
    previewRouteKeyRotation: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
    validateSessionRecord: vi.fn().mockResolvedValue({ records: [], diagnostics: [] }),
  };
  electronApi.token = {
    ...(electronApi.token || {}),
    createApiToken: mockCreateApiToken,
  };
});

describe('route workbench redesign', () => {
  it('renders the combined route page without the legacy route workbench shell', async () => {
    render(<RoutePage />);

    await waitFor(() => {
      expect(screen.queryByTestId('route-workbench-header')).not.toBeInTheDocument();
    });

    expect(screen.getByText('代理服务器')).toBeInTheDocument();
    expect(screen.getByLabelText('代理')).toBeInTheDocument();
    expect(screen.getByText('会话路由')).toBeInTheDocument();
    expect(screen.getByTestId('route-page-server-row')).toBeInTheDocument();
    const serverSectionCard = screen.getByTestId('route-server-section-card');
    expect(serverSectionCard).toHaveClass('w-full');
    expect(screen.queryByTestId('route-cli-model-section-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('redirect-two-pane-layout')).not.toBeInTheDocument();
    expect(within(serverSectionCard).getByRole('button', { name: '停止' })).toBeInTheDocument();
    const serverPrimaryRow = screen.getByTestId('route-server-primary-config-row');
    expect(serverSectionCard.firstElementChild).toHaveClass('p-4');
    expect(serverPrimaryRow).toHaveClass('grid', 'grid-cols-1', 'md:grid-cols-3', 'gap-3');
    expect(serverPrimaryRow).not.toContainElement(
      within(serverSectionCard).getByRole('button', { name: '停止' })
    );
    expect(within(serverPrimaryRow).getByText('端口')).toBeInTheDocument();
    const serverFieldLabels = [
      within(serverPrimaryRow).getByText('端口'),
      within(serverPrimaryRow).getByText('代理'),
      within(serverPrimaryRow).getByText('Base URL'),
    ];
    serverFieldLabels.forEach(label => {
      expect(label).toHaveClass('text-sm', 'font-medium', 'text-[var(--text-primary)]');
    });
    const portInput = screen.getByDisplayValue('3000');
    expect(portInput).toHaveAttribute('type', 'text');
    expect(portInput).toHaveAttribute('inputmode', 'numeric');
    expect(portInput).toHaveClass(
      'w-full',
      'bg-[var(--surface-2)]',
      'text-[var(--text-primary)]',
      'rounded-[10px]'
    );
    const upstreamProxyInput = within(serverPrimaryRow).getByLabelText('代理');
    expect(upstreamProxyInput).toBeInTheDocument();
    expect(upstreamProxyInput).toHaveClass(
      'w-full',
      'bg-[var(--surface-2)]',
      'text-[var(--text-primary)]',
      'rounded-[10px]'
    );
    expect(within(serverPrimaryRow).getByText('Base URL')).toBeInTheDocument();
    expect(screen.queryByText('迁移兼容 Key')).not.toBeInTheDocument();
    expect(screen.queryByTestId('route-server-credential-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('route-cli-actions-claudeCode')).not.toBeInTheDocument();
    expect(screen.queryByText('CLI 路由模型选择')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '预览 Claude Code 路由配置' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('入口端点')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/写入 CLI 本地配置时仅生成连接到本地代理的配置/)
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/当 CLI 使用本地应用路由 URL 时/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('redirect-two-pane-layout')).not.toBeInTheDocument();
    expect(screen.queryByText('统计已迁移到数据总览')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开数据总览' })).not.toBeInTheDocument();
  }, 15_000);

  it('does not expose a Conversations state default channel setting', async () => {
    render(<RoutePage />);

    expect(await screen.findByText('客户端独立凭证')).toBeInTheDocument();
    expect(screen.queryByLabelText('Responses 状态默认通道')).not.toBeInTheDocument();
    expect(screen.getByTestId('route-page-scroll-container')).toHaveClass(
      'overflow-y-auto',
      'overflow-x-hidden',
      '[scrollbar-gutter:stable]'
    );
    expect(screen.getByTestId('route-page-primary-row')).toHaveClass('shrink-0');
    expect(screen.getByTestId('route-page-primary-row')).not.toHaveClass('flex-1');
  });

  it('lists local-route profiles and generates a key only for the selected client', async () => {
    const api = window.electronAPI.configFileProfiles as any;
    const profiles = [
      {
        id: 'client-a',
        name: 'Client A',
        files: [],
        sessionRecordConnectors: [],
        sessionRecordPaths: [],
        target: { kind: 'local-route', model: null },
        builtin: {
          clientType: 'claudeCode',
          version: 1,
          fingerprint: 'builtin-client-a',
        },
        revision: 2,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'client-b',
        name: 'Client B',
        files: [],
        sessionRecordConnectors: [],
        sessionRecordPaths: [],
        target: { kind: 'local-route', model: null },
        localRouteCredential: {
          id: 'credential-b',
          apiKey: 'sk-route-client-b',
          createdAt: 1,
        },
        revision: 4,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'direct-client',
        name: 'Direct Client',
        files: [],
        sessionRecordConnectors: [],
        sessionRecordPaths: [],
        target: { kind: 'direct', configId: 'direct-a', model: null },
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    api.load.mockResolvedValue(profiles);
    api.generateRouteKey.mockResolvedValue({
      ...profiles[0],
      revision: 3,
      localRouteCredential: {
        id: 'credential-a',
        apiKey: 'sk-route-client-a',
        createdAt: 2,
      },
    });

    render(<RoutePage />);

    expect(await screen.findByText('Client A')).toBeInTheDocument();
    expect(screen.getByText('Client B')).toBeInTheDocument();
    expect(screen.getByTestId('route-profile-credentials')).toHaveClass('grid', 'grid-cols-3');
    const clientA = screen.getByTestId('route-profile-credential-client-a');
    const clientB = screen.getByTestId('route-profile-credential-client-b');
    const clientAControls = screen.getByTestId('route-profile-credential-controls-client-a');
    const clientBActions = screen.getByTestId('route-profile-credential-actions-client-b');
    expect(clientA).toHaveClass('min-w-0', 'space-y-1.5');
    expect(within(clientA).getByTitle('Claude Code')).toHaveAttribute(
      'data-agent-logo',
      'claudeCode'
    );
    expect(clientAControls).toHaveClass('flex', 'items-center', 'gap-1');
    expect(within(clientAControls).getByLabelText('Client A API Key')).toHaveClass(
      'min-w-0',
      'flex-1'
    );
    expect(within(clientAControls).getByRole('button', { name: '生成' })).toBeInTheDocument();
    expect(screen.getByLabelText('Client B API Key')).toHaveAttribute('type', 'password');
    expect(clientBActions).toHaveClass('gap-0.5');
    expect(within(clientBActions).getAllByRole('button')).toHaveLength(4);
    within(clientBActions)
      .getAllByRole('button')
      .forEach(button => expect(button).toHaveClass('h-7', 'w-7'));
    fireEvent.click(within(clientB).getByRole('button', { name: '显示 Client B API Key' }));
    expect(screen.getByLabelText('Client B API Key')).toHaveAttribute('type', 'text');
    expect(screen.queryByText('Direct Client')).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByTestId('route-profile-credentials')).getByRole('button', { name: '生成' })
    );

    await waitFor(() =>
      expect(api.generateRouteKey).toHaveBeenCalledWith({
        profileId: 'client-a',
        expectedRevision: 2,
      })
    );
    expect(await screen.findByDisplayValue('sk-route-client-a')).toHaveAttribute(
      'type',
      'password'
    );
    expect(screen.getByLabelText('Client B API Key')).toHaveValue('sk-route-client-b');
  });

  it('adds a credential-only client with a selected logo and generated key', async () => {
    const api = window.electronAPI.configFileProfiles as any;
    api.load.mockResolvedValue([]);
    api.upsert.mockImplementation(async ({ profile }: any) => ({ ...profile, revision: 1 }));
    api.generateRouteKey.mockImplementation(async ({ profileId }: any) => ({
      id: profileId,
      name: 'Aider Workbench',
      agentLogoId: 'cursor',
      credentialOnly: true,
      files: [],
      sessionRecordConnectors: [],
      sessionRecordPaths: [],
      target: { kind: 'local-route', model: null },
      localRouteCredential: {
        id: 'credential-aider',
        apiKey: 'sk-route-aider',
        createdAt: 1,
      },
      revision: 2,
      createdAt: 1,
      updatedAt: 1,
    }));

    render(<RoutePage />);
    fireEvent.click(await screen.findByRole('button', { name: '新增客户端' }));
    fireEvent.change(screen.getByLabelText('客户端名称'), {
      target: { value: '  Aider Workbench  ' },
    });
    fireEvent.change(screen.getByLabelText('客户端 Logo'), {
      target: { value: 'cursor' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存并生成' }));

    await waitFor(() =>
      expect(api.upsert).toHaveBeenCalledWith({
        profile: expect.objectContaining({
          name: 'Aider Workbench',
          agentLogoId: 'cursor',
          credentialOnly: true,
          files: [],
          target: { kind: 'local-route', model: null },
        }),
      })
    );
    expect(api.generateRouteKey).toHaveBeenCalledWith({
      profileId: expect.any(String),
      expectedRevision: 1,
    });
    expect(await screen.findByLabelText('Aider Workbench API Key')).toHaveValue('sk-route-aider');
    expect(screen.getByLabelText('Aider Workbench API Key')).toHaveAttribute('type', 'password');
    expect(screen.getByTitle('Cursor')).toHaveAttribute('data-agent-logo', 'cursor');
  });

  it('previews and commits one profile key rotation before reloading credentials', async () => {
    const api = window.electronAPI.configFileProfiles as any;
    const profile = {
      id: 'client-a',
      name: 'Client A',
      files: [{ id: 'file-a', path: 'C:\\client-a.json', template: '{}' }],
      sessionRecordConnectors: [],
      sessionRecordPaths: [],
      target: { kind: 'local-route', model: null },
      localRouteCredential: { id: 'credential-a', apiKey: 'old-key', createdAt: 1 },
      revision: 5,
      createdAt: 1,
      updatedAt: 1,
    };
    api.load.mockResolvedValueOnce([profile]).mockResolvedValueOnce([
      {
        ...profile,
        revision: 6,
        localRouteCredential: { ...profile.localRouteCredential, apiKey: 'new-key', rotatedAt: 2 },
      },
    ]);
    api.previewRouteKeyRotation.mockResolvedValue({
      transactionId: 'rotation-a',
      profileId: profile.id,
      profileRevision: profile.revision,
      operation: 'key-rotation',
      createdAt: 1,
      expiresAt: 2,
      files: [
        {
          fileId: 'file-a',
          path: 'C:\\client-a.json',
          exists: true,
          content: 'old-key',
          nextContent: 'new-key',
          hash: 'hash',
          mtimeMs: 1,
          matchCounts: { baseUrl: 0, apiKey: 1, model: 0 },
          changed: true,
        },
      ],
    });

    render(<RoutePage />);
    fireEvent.click(await screen.findByRole('button', { name: '显示 Client A API Key' }));
    expect(screen.getByDisplayValue('old-key')).toHaveAttribute('type', 'text');
    fireEvent.click(await screen.findByRole('button', { name: '轮换 Client A API Key' }));
    expect(await screen.findByText('C:\\client-a.json')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认轮换' }));

    await waitFor(() => expect(api.commit).toHaveBeenCalledWith({ transactionId: 'rotation-a' }));
    expect(await screen.findByDisplayValue('new-key')).toHaveAttribute('type', 'password');
  });

  it('reloads client credentials when configuration profiles change', async () => {
    const electronApi = window.electronAPI as any;
    const api = electronApi.configFileProfiles;
    const previous = {
      id: 'client-a',
      name: 'Client A',
      files: [],
      sessionRecordConnectors: [],
      sessionRecordPaths: [],
      target: { kind: 'local-route', model: null },
      localRouteCredential: { id: 'credential-a', apiKey: 'old-key', createdAt: 1 },
      revision: 2,
      createdAt: 1,
      updatedAt: 1,
    };
    api.load.mockResolvedValueOnce([previous]).mockResolvedValue([
      {
        ...previous,
        revision: 3,
        localRouteCredential: { ...previous.localRouteCredential, apiKey: 'new-key', rotatedAt: 2 },
      },
    ]);

    render(<RoutePage />);
    expect(await screen.findByLabelText('Client A API Key')).toHaveValue('old-key');

    const onChanged = electronApi.appData.onChanged.mock.calls.at(-1)?.[0];
    act(() => {
      onChanged({ domains: ['config-file-profiles'], emittedAt: Date.now() });
    });

    await waitFor(() => expect(screen.getByLabelText('Client A API Key')).toHaveValue('new-key'));
  });

  it('rotates credential-only keys with a transaction that does not require file matches', async () => {
    const api = window.electronAPI.configFileProfiles as any;
    const profile = {
      id: 'credential-only',
      name: 'Standalone Client',
      credentialOnly: true,
      files: [],
      sessionRecordConnectors: [],
      sessionRecordPaths: [],
      target: { kind: 'local-route', model: null },
      localRouteCredential: { id: 'credential-a', apiKey: 'old-key', createdAt: 1 },
      revision: 4,
      createdAt: 1,
      updatedAt: 1,
    };
    const updated = {
      ...profile,
      revision: 5,
      localRouteCredential: { ...profile.localRouteCredential, apiKey: 'new-key', rotatedAt: 2 },
    };
    api.load.mockResolvedValueOnce([profile]).mockResolvedValue([updated]);
    api.previewRouteKeyRotation.mockResolvedValue({
      transactionId: 'credential-only-rotation',
      profileId: profile.id,
      profileRevision: profile.revision,
      operation: 'key-rotation',
      createdAt: 1,
      expiresAt: 2,
      files: [],
    });

    render(<RoutePage />);
    fireEvent.click(await screen.findByRole('button', { name: '轮换 Standalone Client API Key' }));

    await waitFor(() =>
      expect(api.previewRouteKeyRotation).toHaveBeenCalledWith({
        profileId: 'credential-only',
        expectedRevision: 4,
      })
    );
    expect(
      screen.getByText('此客户端没有关联配置文件；确认后只更新客户端独立凭证。')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认轮换' }));
    await waitFor(() =>
      expect(api.commit).toHaveBeenCalledWith({ transactionId: 'credential-only-rotation' })
    );
    expect(await screen.findByLabelText('Standalone Client API Key')).toHaveValue('new-key');
    expect(api.generateRouteKey).not.toHaveBeenCalled();
  });

  it('previews profile state impact before allowing confirmed cleanup', async () => {
    const api = window.electronAPI.configFileProfiles as any;
    const routeApi = window.electronAPI.route as any;
    api.load.mockResolvedValue([
      {
        id: 'client-a',
        name: 'Client A',
        files: [],
        sessionRecordConnectors: [],
        sessionRecordPaths: [],
        target: { kind: 'local-route', model: null },
        localRouteCredential: { id: 'credential-a', apiKey: 'client-key', createdAt: 1 },
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    routeApi.previewProfileStateClear.mockResolvedValue({
      success: true,
      data: {
        profileId: 'client-a',
        total: 6,
        responses: 2,
        conversations: 1,
        conversationItems: 3,
      },
    });
    routeApi.clearProfileState.mockResolvedValue({ success: true, data: { removed: 6 } });

    render(<RoutePage />);
    fireEvent.click(await screen.findByRole('button', { name: '清理 Client A 状态资源' }));

    expect(routeApi.previewProfileStateClear).toHaveBeenCalledWith('client-a');
    expect(routeApi.clearProfileState).not.toHaveBeenCalled();
    expect(await screen.findByText(/将删除此客户端的 6 条本地亲和映射/)).toBeInTheDocument();
    expect(screen.getByText('Responses').parentElement).toHaveTextContent('2Responses');
    expect(screen.getByText('Conversations').parentElement).toHaveTextContent('1Conversations');
    expect(screen.getByText('Items').parentElement).toHaveTextContent('3Items');

    fireEvent.click(screen.getByRole('button', { name: '确认清理' }));
    await waitFor(() => expect(routeApi.clearProfileState).toHaveBeenCalledWith('client-a'));
  });

  it(
    'renders four example profiles through the shared configuration-card schema',
    { timeout: 15_000 },
    async () => {
      const profiles = [
        ...['Claude Code', 'Codex', 'OpenCode', 'Grok Build'].map((name, index) => ({
          id: `example-${index}`,
          name,
          files: [
            {
              id: `file-${index}`,
              path: `~/.${index}.config`,
              template: '{{BASE_URL}} {{API_KEY}} {{MODEL}}',
            },
          ],
          sessionRecordConnectors: [],
          sessionRecordPaths: [],
          target: { kind: 'local-route', model: null },
          isExample: true,
          createdAt: 1,
          updatedAt: 1,
        })),
        {
          id: 'credential-only',
          name: 'Route Only Client',
          credentialOnly: true,
          files: [],
          sessionRecordConnectors: [],
          sessionRecordPaths: [],
          target: { kind: 'local-route', model: null },
          createdAt: 1,
          updatedAt: 1,
        },
      ];
      (window.electronAPI.configFileProfiles.load as ReturnType<typeof vi.fn>).mockResolvedValue(
        profiles
      );
      render(<ConfigFilesPage />);
      for (const name of ['Claude Code', 'Codex', 'OpenCode', 'Grok Build']) {
        expect(await screen.findByText(name)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: `${name} 编辑` })).toBeInTheDocument();
      }
      expect(screen.queryByLabelText('配置卡片名称')).not.toBeInTheDocument();
      expect(screen.queryByText('Route Only Client')).not.toBeInTheDocument();
      expect(screen.queryByText(/应用 .* 路由配置/)).not.toBeInTheDocument();
      expect(screen.getByText('4 个方案 · 4 个文件')).toBeInTheDocument();
      expect(screen.getAllByText('内置')).toHaveLength(4);
      expect(screen.getByLabelText('Claude Code 配置卡片').parentElement).toHaveClass(
        'lg:grid-cols-2'
      );
      expect(screen.getByRole('button', { name: 'Claude Code 更多操作' })).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      fireEvent.click(screen.getByRole('button', { name: 'Claude Code 编辑' }));
      expect(await screen.findByText('基本信息')).toBeInTheDocument();
      expect(screen.getByLabelText('Claude Code Logo')).toBeInTheDocument();
      expect(screen.getByText('文件规则')).toBeInTheDocument();
      expect(screen.getByText('会话关联')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '预览写入' })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: '恢复最新示例' })).toBeInTheDocument();
    }
  );

  it(
    'previews and commits an edited configuration card transaction',
    { timeout: 15_000 },
    async () => {
      const profile = {
        id: 'user-profile',
        name: '我的编辑器',
        files: [
          {
            id: 'file-1',
            path: 'C:/editor/config.json',
            template: '{"base":"{{BASE_URL}}","model":"{{MODEL}}"}',
          },
        ],
        sessionRecordConnectors: [
          {
            id: 'connector-1',
            path: 'C:/editor/sessions.jsonl',
            format: 'jsonl',
            namespace: 'editor',
            sessionIdPath: 'id',
          },
        ],
        sessionRecordPaths: [],
        target: { kind: 'local-route', model: null },
        createdAt: 1,
        updatedAt: 1,
      };
      const preview = {
        transactionId: 'tx-1',
        profileId: profile.id,
        createdAt: 1,
        expiresAt: 999999,
        files: [
          {
            fileId: 'file-1',
            path: profile.files[0].path,
            exists: true,
            content: 'before',
            hash: 'hash',
            mtimeMs: 1,
            nextContent: 'after',
            matchCounts: { baseUrl: 1, apiKey: 0, model: 1 },
            changed: true,
          },
        ],
      };
      const api = window.electronAPI.configFileProfiles as any;
      api.load.mockResolvedValue([profile]);
      api.getTargetCatalog.mockResolvedValue([
        {
          value: 'local-route',
          label: '本地路由',
          available: true,
          allModels: [],
          apiKeys: [],
        },
      ]);
      api.upsert.mockImplementation(async ({ profile: value }: any) => ({ ...value, revision: 1 }));
      api.preview = vi.fn();
      api.commit = vi.fn();
      api.preview.mockResolvedValue(preview);
      api.commit.mockResolvedValue(undefined);
      render(<ConfigFilesPage />);
      expect(await screen.findByText('我的编辑器')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '预览套用' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '我的编辑器 编辑' }));
      expect(await screen.findByDisplayValue('我的编辑器')).toBeInTheDocument();
      expect(screen.getByText('窗口打开状态路径')).toBeInTheDocument();
      expect(screen.getByText('窗口当前 Session ID 路径')).toBeInTheDocument();
      expect(screen.getByText(/只有窗口状态明确为打开时/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '预览写入' }));
      await waitFor(() =>
        expect(api.preview).toHaveBeenCalledWith({
          profileId: profile.id,
          expectedRevision: 1,
          applyMode: 'merge',
        })
      );
      expect(await screen.findByText('确认写入内容')).toBeInTheDocument();
      expect(screen.getByText('+ after')).toBeInTheDocument();
      expect(screen.getByText('- before')).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: '应用到本地' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '确认写入' }));
      await waitFor(() => expect(api.commit).toHaveBeenCalledWith({ transactionId: 'tx-1' }));
    }
  );

  it('does not render the legacy CLI thinking selector on the local route page', () => {
    render(<RoutePage />);
    expect(screen.queryByTestId('route-cli-thinking-effort-claudeCode')).not.toBeInTheDocument();
    expect(screen.getByText('会话路由')).toBeInTheDocument();
  });

  it('keeps real file editing separate from template preview', async () => {
    const profile = {
      id: 'real-file-profile',
      name: '真实文件卡片',
      files: [
        {
          id: 'file-1',
          path: 'C:/editor/config.json',
          template: '{"model":"{{MODEL}}"}',
        },
      ],
      sessionRecordConnectors: [],
      sessionRecordPaths: [],
      target: { kind: 'local-route', model: null },
      createdAt: 1,
      updatedAt: 1,
    };
    const api = window.electronAPI.configFileProfiles as any;
    api.load.mockResolvedValue([profile]);
    api.getTargetCatalog.mockResolvedValue([
      {
        value: 'local-route',
        label: '本地路由',
        available: true,
        allModels: [],
        apiKeys: [],
      },
    ]);
    api.upsert.mockImplementation(async ({ profile: value }: any) => ({ ...value, revision: 1 }));
    api.readFiles.mockResolvedValue([
      {
        fileId: 'file-1',
        path: profile.files[0].path,
        exists: true,
        content: '{"model":"old"}',
        hash: 'hash',
        mtimeMs: 1,
      },
    ]);
    render(<ConfigFilesPage />);
    expect(await screen.findByText('真实文件卡片')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '真实文件卡片 编辑' }));
    expect(await screen.findByDisplayValue('真实文件卡片')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    expect(await screen.findByDisplayValue('{"model":"old"}')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存配置' })).toBeInTheDocument();
  });

  // P0-2: CliUsabilityTab 已合并到 RoutePage，该测试不再需要
  // 相关功能已在 RoutePage 的集成测试中覆盖

  it('renders redirect list and selected detail without vendor grouping', async () => {
    render(<ModelRedirectionTab />);

    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument();
    expect(screen.queryByText('OpenAI')).not.toBeInTheDocument();
    expect(screen.getAllByText('claude-opus-4-6').length).toBeGreaterThan(0);
    expect(screen.getByText('gpt-5.4')).toBeInTheDocument();
    expect(screen.queryByText('gpt-5')).not.toBeInTheDocument();
    const priorityPane = await screen.findByTestId('redirect-detail-priority');
    expect(within(priorityPane).getAllByText(/暂停至/).length).toBeGreaterThan(0);
    expect(priorityPane.querySelector('[title*="60分钟成功率 0%"]')).not.toBeNull();
    expect(screen.queryByTestId('redirect-card-header')).not.toBeInTheDocument();
    expect(screen.getByTestId('redirect-two-pane-layout')).toHaveClass(
      'grid',
      'grid-cols-[minmax(198px,0.3825fr)_minmax(189px,0.3825fr)_minmax(0,1.335fr)]'
    );
    const toolbar = screen.getByTestId('redirect-list-toolbar');
    const redirectToolbarTitle = within(toolbar).getByText('重定向模型');
    const redirectToolbarCount = within(toolbar).getByText(/\d+ 项/);
    expect(redirectToolbarTitle.parentElement).toBe(redirectToolbarCount.parentElement);
    expect(redirectToolbarTitle.parentElement).toHaveClass('items-baseline', 'gap-1.5');
    const syncSourcesButton = within(toolbar).getByRole('button', { name: '同步来源' });
    const createRedirectButton = within(toolbar).getByRole('button', { name: '新增重定向' });
    expect(syncSourcesButton).toBeInTheDocument();
    expect(createRedirectButton).toBeInTheDocument();
    expect(syncSourcesButton.querySelector('svg')).toBeNull();
    expect(createRedirectButton.querySelector('svg')).toBeNull();
    expect(screen.queryByRole('button', { name: '重置默认重定向' })).not.toBeInTheDocument();

    expect(screen.getByTestId('redirect-workspace')).toHaveClass('border-[var(--line-muted)]');
    const redirectRows = screen.getAllByTestId('redirect-list-row');
    expect(redirectRows.length).toBeGreaterThan(0);
    expect(redirectRows[0]).toHaveAttribute('data-selected', 'true');
    expect(redirectRows[0]).toHaveClass('border-b', 'border-l-2', 'px-3', 'py-2');
    expect(redirectRows[0]).toHaveClass('border-[var(--line-muted)]');
    expect(redirectRows[0]).not.toHaveClass('rounded-[var(--radius-lg)]');
    expect(redirectRows[0]).not.toHaveClass('bg-[var(--surface-2)]/70');
    expect(within(redirectRows[0]).queryByText(/\d+ 站点/)).not.toBeInTheDocument();
    expect(within(redirectRows[0]).queryByText(/来源/)).not.toBeInTheDocument();
    expect(within(redirectRows[0]).queryByText(/路径 \d+ 次/)).not.toBeInTheDocument();

    const detailActions = screen.getByTestId('redirect-detail-actions');
    expect(within(detailActions).getByRole('button', { name: '规则' })).toBeInTheDocument();
    expect(
      within(detailActions).getByRole('button', { name: '恢复 claude-opus-4-6 路由路径' })
    ).toBeInTheDocument();
    expect(
      within(detailActions).queryByRole('button', { name: '编辑 claude-opus-4-6' })
    ).not.toBeInTheDocument();
    expect(
      within(detailActions).queryByRole('button', { name: '删除 claude-opus-4-6' })
    ).not.toBeInTheDocument();
    const originalPane = screen.getByTestId('redirect-original-pane');
    const editButton = within(originalPane).getByRole('button', {
      name: '编辑 claude-opus-4-6',
    });
    expect(editButton).toHaveTextContent('编辑');
    expect(editButton.className).toMatch(/!h-6/);
    expect(editButton).not.toHaveClass('w-6');
    expect(within(detailActions).queryByText(/\d+ 站点/)).not.toBeInTheDocument();
    expect(within(detailActions).getByText('优先级排序')).toBeInTheDocument();
    expect(screen.getByTestId('redirect-original-pane')).toBeInTheDocument();

    const originalModelFrame = screen.getByText('claude-opus-4.6-20260201').parentElement;
    expect(originalModelFrame).not.toBeNull();
    const originalModelsList = screen.getByTestId('redirect-detail-original-models');
    const renderedOriginalModels = Array.from(originalModelsList.querySelectorAll('code'));
    expect(renderedOriginalModels.length).toBeGreaterThan(1);
    expect(within(originalModelsList).queryByText(',')).not.toBeInTheDocument();
    expect(within(originalModelsList).queryByText(/暂停至/)).not.toBeInTheDocument();
    expect(originalModelFrame).toHaveClass('border', 'bg-[var(--surface-2)]', 'px-2', 'py-1');
    expect(screen.getByText('claude-opus-4.6-20260201')).toHaveClass('leading-4');
    expect(screen.queryByText('手工新增')).not.toBeInTheDocument();
    expect(screen.queryByText('示例')).not.toBeInTheDocument();
    expect(
      within(priorityPane).queryByText('站点与 API Key 按当前顺序尝试。')
    ).not.toBeInTheDocument();
    expect(within(detailActions).getByRole('button', { name: '保存' }).parentElement).toHaveClass(
      'ml-auto',
      'justify-end'
    );
    expect(await screen.findByTestId('priority-detail-compact-list')).toBeInTheDocument();
  });

  it('warns when selected redirect sources only have site-level model cache', async () => {
    const siteOnlySource = createSource({
      sourceKey: 'site-only:site:claude-opus-4-8',
      siteId: 'site-only',
      siteName: 'Site Only Claude',
      accountId: undefined,
      accountName: undefined,
      sourceType: 'site',
      originalModel: 'claude-opus-4-8',
      availableUserGroups: undefined,
      availableApiKeys: [],
      firstSeenAt: 20,
      lastSeenAt: 20,
    });
    const baseRegistry = createModelRegistryConfig();
    const baseDisplayItem = baseRegistry.displayItems.find(
      item => item.canonicalName === 'claude-opus-4-6'
    )!;
    const nextDisplayItem: RouteModelDisplayItem = {
      ...baseDisplayItem,
      sourceKeys: [...baseDisplayItem.sourceKeys, siteOnlySource.sourceKey],
      originalModelOrder: [
        ...(baseDisplayItem.originalModelOrder || []),
        siteOnlySource.originalModel,
      ],
    };

    mockConfig = {
      ...mockConfig,
      modelRegistry: {
        ...baseRegistry,
        sources: [...baseRegistry.sources, siteOnlySource],
        entries: {
          ...baseRegistry.entries,
          'claude-opus-4-6': {
            ...baseRegistry.entries['claude-opus-4-6']!,
            aliases: [
              ...baseRegistry.entries['claude-opus-4-6']!.aliases,
              siteOnlySource.originalModel,
            ],
            sources: [...baseRegistry.entries['claude-opus-4-6']!.sources, siteOnlySource],
          },
        },
        displayItems: baseRegistry.displayItems.map(item =>
          item.id === baseDisplayItem.id ? nextDisplayItem : item
        ),
      },
    };

    render(<ModelRedirectionTab />);

    const warning = await screen.findByTestId('priority-detail-site-only-warning');
    expect(warning).toHaveTextContent('部分站点需要重新添加后才能参与本地路由');
    expect(warning).toHaveTextContent('Site Only Claude');
    expect(warning).toHaveTextContent('claude-opus-4-8');
    expect(warning).toHaveTextContent('重新添加或刷新站点账户');
  });

  it('resets suspended route paths for the selected redirect detail', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: '恢复 claude-opus-4-6 路由路径' }));

    await waitFor(() => {
      expect(mockResetPathStates).toHaveBeenCalledWith({
        canonicalModel: 'claude-opus-4-6',
      });
    });
  });

  it('resets the current priority hit route channel without narrowing to one resolved model', async () => {
    mockGetRequestLogs.mockResolvedValueOnce({
      success: true,
      data: [createFirstHitRouteLog()],
    });

    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    const backupKeyRow = await waitFor(() => {
      const row = within(detailPane)
        .getByText('backup-key（Main / team-beta / ×1.50）')
        .closest('[data-testid="priority-detail-api-key-row"]') as HTMLElement | null;
      expect(row).not.toBeNull();
      expect(row).toHaveAttribute('data-priority-hit', 'true');
      return row!;
    });

    const detailActions = screen.getByTestId('redirect-detail-actions');
    const actionLabels = within(detailActions)
      .getAllByRole('button')
      .map(button => button.textContent?.trim())
      .filter(Boolean);
    expect(actionLabels.slice(0, 2)).toEqual(['重置命中', '恢复']);

    fireEvent.click(
      within(detailActions).getByRole('button', {
        name: '重置 claude-opus-4-6 当前优先命中路径',
      })
    );

    await waitFor(() => {
      expect(mockResetPathStates).toHaveBeenCalledWith({
        canonicalModel: 'claude-opus-4-6',
        siteId: 'site-1',
        accountId: 'acc-1',
        apiKeyId: 'backup-key-id',
        targetProtocol: 'native',
      });
    });

    await waitFor(() => {
      expect(backupKeyRow).not.toHaveAttribute('data-priority-hit', 'true');
      expect(within(backupKeyRow).queryByText('当前优先命中')).not.toBeInTheDocument();
    });
  });

  it('places sync and create actions above the redirect list without reset defaults', async () => {
    render(<ModelRedirectionTab />);
    await findPriorityDetailPane();

    const toolbar = screen.getByTestId('redirect-list-toolbar');
    const buttons = within(toolbar)
      .getAllByRole('button')
      .map(button => button.textContent?.trim())
      .filter(text => text === '同步来源' || text === '新增重定向');

    expect(buttons).toEqual(['同步来源', '新增重定向']);
    expect(screen.queryByRole('button', { name: '重置默认重定向' })).not.toBeInTheDocument();
  });

  it('does not expose reset-defaults rebuild as a visible redirect action', async () => {
    render(<ModelRedirectionTab />);
    await findPriorityDetailPane();

    expect(screen.queryByRole('button', { name: '重置默认重定向' })).not.toBeInTheDocument();
    expect(mockRebuildModelRegistry).not.toHaveBeenCalled();
  });

  it('filters out all legacy seeded display items', () => {
    const views = buildDisplayItemViews({
      ...createModelRegistryConfig(),
      displayItems: [
        ...createModelRegistryConfig().displayItems,
        {
          id: 'seeded:gpt-5',
          vendor: 'gpt',
          canonicalName: 'gpt-5',
          sourceKeys: ['site-3:acc-3:gpt-5-latest'],
          originalModelOrder: ['gpt-5-latest'],
          priorityConfig: {
            sitePriorities: {},
            apiKeyPriorities: {},
          },
          mode: 'seeded',
          createdAt: 14,
          updatedAt: 14,
        },
      ],
    });

    expect(views.map(view => view.displayName)).toEqual(['claude-opus-4-6', 'gpt-5.4']);
  });

  it('does not synthesize or bootstrap a redirect from legacy registry entries', async () => {
    const registry = createModelRegistryConfig();
    mockConfig = {
      ...mockConfig,
      modelRegistry: {
        ...registry,
        overrides: [],
        displayItems: [],
        lastAggregatedAt: undefined,
      },
    };

    render(<ModelRedirectionTab />);

    expect(await screen.findByText('暂无模型重定向')).toBeInTheDocument();
    expect(screen.queryByTestId('redirect-list-row')).not.toBeInTheDocument();
    expect(screen.queryByText('示例')).not.toBeInTheDocument();
    expect(mockRebuildModelRegistry).not.toHaveBeenCalled();
  });

  it('lists manual redirects in local route model options even before their entry is rebuilt', () => {
    const options = buildRecommendedCliModelOptions({
      ...createModelRegistryConfig(),
      displayItems: [
        ...createModelRegistryConfig().displayItems,
        {
          id: 'manual:deepseek-v4-pro',
          vendor: 'deepseek',
          canonicalName: 'deepseek-v4-pro',
          sourceKeys: ['site-9:acc-9:deepseek-v4-pro'],
          originalModelOrder: ['deepseek-v4-pro'],
          priorityConfig: {
            sitePriorities: {},
            apiKeyPriorities: {},
          },
          mode: 'manual',
          createdAt: 90,
          updatedAt: 90,
        },
      ],
    });

    expect(options.map(option => option.canonicalName)).toContain('deepseek-v4-pro');
  });

  it('renders override-backed redirects even when no display item was persisted', async () => {
    const registry = createModelRegistryConfig();
    const deepseekSource = createSource({
      sourceKey: 'site-9:acc-9:deepseek-v4',
      siteId: 'site-9',
      siteName: 'DeepSeek Site',
      accountId: 'acc-9',
      accountName: 'DeepSeek Main',
      originalModel: 'deepseek-v4',
      vendor: 'deepseek',
      availableUserGroups: ['default'],
      availableApiKeys: [
        {
          apiKeyId: 'deepseek-key-id',
          apiKeyName: 'deepseek-key',
          accountId: 'acc-9',
          accountName: 'DeepSeek Main',
          group: 'default',
        },
      ],
      firstSeenAt: 90,
      lastSeenAt: 90,
    });
    mockConfig = {
      ...mockConfig,
      modelRegistry: {
        ...registry,
        sources: [...registry.sources, deepseekSource],
        entries: {
          ...registry.entries,
          'deepseek-v4-pro': {
            vendor: 'deepseek',
            canonicalName: 'deepseek-v4-pro',
            aliases: ['deepseek-v4'],
            sources: [deepseekSource],
            hasOverride: true,
            createdAt: 90,
            updatedAt: 91,
          },
        },
        overrides: [
          ...registry.overrides,
          {
            id: 'override-deepseek-v4-pro',
            sourceKey: deepseekSource.sourceKey,
            canonicalName: 'deepseek-v4-pro',
            action: 'rename',
            createdAt: 90,
            updatedAt: 91,
          },
        ],
        displayItems: registry.displayItems,
      },
    };
    mockGetRequestLogs.mockResolvedValueOnce({
      success: true,
      data: [
        createFirstHitRouteLog({
          id: 'route-log-override-backed-card',
          canonicalModel: 'deepseek-v4-pro',
          requestedModel: 'deepseek-v4',
          siteId: 'site-9',
          siteName: 'DeepSeek Site',
          accountId: 'acc-9',
          accountName: 'DeepSeek Main',
          apiKeyId: 'deepseek-key-id',
          apiKeyName: 'deepseek-key',
          resolvedModel: 'deepseek-v4',
        }),
      ],
    });

    render(<ModelRedirectionTab />);

    const deepseekRedirect = await screen.findByText('deepseek-v4-pro');
    fireEvent.click(deepseekRedirect.closest('[data-testid="redirect-list-row"]')!);

    const detailPane = await findPriorityDetailPane();
    const deepseekKeyRow = await waitFor(() => {
      const row = within(detailPane)
        .getByText(/deepseek-key/)
        .closest('[data-testid="priority-detail-api-key-row"]') as HTMLElement | null;
      expect(row).not.toBeNull();
      return row!;
    });
    expect(deepseekKeyRow).toHaveAttribute('data-priority-hit', 'true');
  });

  it('supports searching and multi-selecting original models when creating a redirect', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: '新增重定向' }));

    const dialog = await screen.findByRole('dialog', { name: '新增模型重定向' });
    const candidateList = within(dialog).getByTestId('original-model-candidate-list');

    fireEvent.change(screen.getByLabelText('重定向名称'), {
      target: { value: 'claude-team-route' },
    });
    fireEvent.change(screen.getByLabelText('搜索原始名称'), {
      target: { value: 'claude' },
    });

    fireEvent.click(within(candidateList).getByText('claude-opus-4.6-20260201').closest('label')!);
    fireEvent.click(within(candidateList).getByText('claude-haiku-4.5-20251001').closest('label')!);

    fireEvent.click(within(dialog).getByRole('button', { name: '新增重定向' }));

    await waitFor(() => {
      expect(mockUpsertMappingOverride).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceKey: 'site-1:acc-1:claude-opus-4.6-20260201',
          canonicalName: 'claude-team-route',
          action: 'rename',
        })
      );
      expect(mockUpsertMappingOverride).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceKey: 'site-2:acc-2:claude-haiku-4.5-20251001',
          canonicalName: 'claude-team-route',
          action: 'rename',
        })
      );
      expect(mockUpsertDisplayItem).toHaveBeenCalledWith(
        expect.objectContaining({
          canonicalName: 'claude-team-route',
          originalModelOrder: ['claude-opus-4.6-20260201', 'claude-haiku-4.5-20251001'],
          priorityConfig: {
            sitePriorities: {},
            apiKeyPriorities: {},
          },
        })
      );
      expect(mockUpsertDisplayItem.mock.invocationCallOrder[0]).toBeLessThan(
        mockUpsertMappingOverride.mock.invocationCallOrder[0]!
      );
    });
  });

  it('rejects duplicate canonical names across existing redirections', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: '新增重定向' }));
    const dialog = await screen.findByRole('dialog', { name: '新增模型重定向' });

    fireEvent.change(screen.getByLabelText('重定向名称'), {
      target: { value: 'claude-opus-4-6' },
    });
    fireEvent.change(screen.getByLabelText('搜索原始名称'), {
      target: { value: 'gpt-5' },
    });
    fireEvent.click(screen.getByText('gpt-5-latest').closest('label')!);
    fireEvent.click(within(dialog).getByRole('button', { name: '新增重定向' }));

    expect(
      await within(dialog).findByText('该重定向名称已存在，请直接编辑已有卡片')
    ).toBeInTheDocument();
    expect(mockUpsertDisplayItem).not.toHaveBeenCalled();
  });

  it('allows removing selected original models directly inside the edit dialog', async () => {
    render(<ModelRedirectionTab />);

    selectRedirectRow('gpt-5.4');
    const originalPane = screen.getByTestId('redirect-original-pane');
    fireEvent.click(within(originalPane).getByRole('button', { name: '编辑 gpt-5.4' }));

    const dialog = await screen.findByRole('dialog', { name: '编辑模型重定向' });
    expect(
      within(dialog).getByRole('button', { name: '取消选择 gpt-5.4-latest' })
    ).toBeInTheDocument();

    act(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: '取消选择 gpt-5.4-latest' }));
    });

    expect(
      within(dialog).queryByRole('button', { name: '取消选择 gpt-5.4-latest' })
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText('还没有选择原始模型')).not.toBeInTheDocument();
    expect(within(dialog).getByText('已选 1')).toBeInTheDocument();
  });

  it('keeps the editor layout with bounded internal scroll areas', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: '新增重定向' }));

    const dialog = await screen.findByRole('dialog', { name: '新增模型重定向' });
    const inputRow = within(dialog).getByTestId('redirect-editor-input-row');
    const candidateList = within(dialog).getByTestId('original-model-candidate-list');
    expect(inputRow.className).toContain('md:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]');

    act(() => {
      fireEvent.click(within(candidateList).getByText('gpt-5.4-latest').closest('label')!);
      fireEvent.click(within(candidateList).getByText('gpt-5.4-experimental').closest('label')!);
      fireEvent.click(within(candidateList).getByText('o3-latest').closest('label')!);
    });

    expect(dialog.className).toContain('h-[72vh]');
    expect(dialog.className).toContain('max-h-[72vh]');
    expect(dialog.className).toContain('max-w-4xl');

    const overlayBody = within(dialog).getByTestId('overlay-body');
    expect(overlayBody.className).toContain('flex');
    expect(overlayBody.className).toContain('flex-1');
    expect(overlayBody.className).toContain('max-h-none');
    expect(overlayBody.className).toContain('overflow-hidden');
    expect(within(dialog).getByText('已选 3')).toBeInTheDocument();

    const selectedList = within(dialog).getByTestId('selected-original-models-list');
    expect(selectedList.className).toContain('max-h-56');
    expect(selectedList.className).toContain('overflow-y-auto');
    expect(selectedList.className).toContain('md:flex-1');
    expect(selectedList.className).toContain('md:basis-0');
    expect(selectedList.className).toContain('md:max-h-none');
    expect(selectedList.className).toContain('[scrollbar-gutter:stable]');

    expect(candidateList.className).toContain('flex-1');
    expect(candidateList.className).toContain('basis-0');
    expect(candidateList.className).toContain('overflow-y-auto');
  });

  it('keeps wheel scrolling inside the nested selected and candidate lists', async () => {
    render(<ModelRedirectionTab />);

    selectRedirectRow('gpt-5.4');
    const originalPane = screen.getByTestId('redirect-original-pane');
    fireEvent.click(within(originalPane).getByRole('button', { name: '编辑 gpt-5.4' }));

    const dialog = await screen.findByRole('dialog', { name: '编辑模型重定向' });
    const bubbleSpy = vi.fn();
    dialog.addEventListener('wheel', bubbleSpy);

    fireEvent.wheel(within(dialog).getByTestId('selected-original-models-list'), {
      deltaY: 120,
    });
    fireEvent.wheel(within(dialog).getByTestId('original-model-candidate-list'), {
      deltaY: 120,
    });

    expect(bubbleSpy).not.toHaveBeenCalled();
  });

  it('shows all site models in the redirect editor candidate list regardless of current cards', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: '新增重定向' }));
    await screen.findByRole('dialog', { name: '新增模型重定向' });

    fireEvent.change(screen.getByLabelText('搜索原始名称'), {
      target: { value: 'gpt-4.1' },
    });

    expect(screen.getByText('gpt-4.1-edge')).toBeInTheDocument();
    expect(screen.getByText('1 站点 / 1 来源')).toBeInTheDocument();
  });

  it('shows custom CLI config models in the redirect editor candidate list', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: '新增重定向' }));
    const dialog = await screen.findByRole('dialog', { name: '新增模型重定向' });

    fireEvent.change(screen.getByLabelText('搜索原始名称'), {
      target: { value: 'duckcoding' },
    });

    const candidateList = within(dialog).getByTestId('original-model-candidate-list');
    expect(within(candidateList).getByText('duckcoding')).toBeInTheDocument();
    expect(within(candidateList).getByText('1 站点 / 1 来源')).toBeInTheDocument();
  });

  it('keeps all override-only original models when a stale entry has partial sources', () => {
    const registry = createModelRegistryConfig();
    const gptSource = registry.sources.find(source => source.originalModel === 'gpt-5-latest')!;
    const customCliSource = registry.sources.find(source => source.originalModel === 'duckcoding')!;
    const staleCanonicalName = 'mixed-route';

    const views = buildDisplayItemViews({
      ...registry,
      entries: {
        ...registry.entries,
        [staleCanonicalName]: {
          canonicalName: staleCanonicalName,
          vendor: 'unknown',
          aliases: [gptSource.originalModel],
          sources: [gptSource],
          hasOverride: true,
          createdAt: 80,
          updatedAt: 80,
        },
      },
      overrides: [
        ...registry.overrides,
        {
          id: 'override-mixed-gpt',
          sourceKey: gptSource.sourceKey,
          canonicalName: staleCanonicalName,
          action: 'rename',
          createdAt: 81,
          updatedAt: 82,
        },
        {
          id: 'override-mixed-custom-cli',
          sourceKey: customCliSource.sourceKey,
          canonicalName: staleCanonicalName,
          action: 'rename',
          createdAt: 81,
          updatedAt: 82,
        },
      ],
      displayItems: [],
    });

    const mixedRouteView = views.find(view => view.item.canonicalName === staleCanonicalName);

    expect(mixedRouteView?.selectedOriginalModels).toEqual(['gpt-5-latest', 'duckcoding']);
    expect(mixedRouteView?.entry?.sources.map(source => source.sourceKey)).toEqual([
      gptSource.sourceKey,
      customCliSource.sourceKey,
    ]);
    expect(mixedRouteView?.item.sourceKeys).toEqual([
      gptSource.sourceKey,
      customCliSource.sourceKey,
    ]);
  });

  it('keeps override original models on stale persisted display items', () => {
    const registry = createModelRegistryConfig();
    const gptSource = registry.sources.find(source => source.originalModel === 'gpt-5-latest')!;
    const customCliSource = registry.sources.find(source => source.originalModel === 'duckcoding')!;
    const staleCanonicalName = 'mixed-route';

    const views = buildDisplayItemViews({
      ...registry,
      entries: {
        ...registry.entries,
        [staleCanonicalName]: {
          canonicalName: staleCanonicalName,
          vendor: 'unknown',
          aliases: [gptSource.originalModel],
          sources: [gptSource],
          hasOverride: true,
          createdAt: 80,
          updatedAt: 80,
        },
      },
      overrides: [
        ...registry.overrides,
        {
          id: 'override-mixed-custom-cli',
          sourceKey: customCliSource.sourceKey,
          canonicalName: staleCanonicalName,
          action: 'rename',
          createdAt: 81,
          updatedAt: 82,
        },
      ],
      displayItems: [
        {
          id: 'manual:mixed-route',
          vendor: 'unknown',
          canonicalName: staleCanonicalName,
          sourceKeys: [gptSource.sourceKey],
          originalModelOrder: [gptSource.originalModel],
          priorityConfig: {
            sitePriorities: {},
            apiKeyPriorities: {},
          },
          mode: 'manual',
          createdAt: 80,
          updatedAt: 80,
        },
      ],
    });

    const mixedRouteView = views.find(view => view.item.canonicalName === staleCanonicalName);

    expect(mixedRouteView?.selectedOriginalModels).toEqual(['gpt-5-latest', 'duckcoding']);
    expect(mixedRouteView?.entry?.sources.map(source => source.sourceKey)).toEqual([
      gptSource.sourceKey,
      customCliSource.sourceKey,
    ]);
    expect(mixedRouteView?.item.sourceKeys).toEqual([
      gptSource.sourceKey,
      customCliSource.sourceKey,
    ]);
  });

  it(
    'shows grouped site account api key details and missing key reminders in the detail pane',
    { timeout: 15_000 },
    async () => {
      render(<ModelRedirectionTab />);

      const detailPane = await findPriorityDetailPane();
      await waitFor(() => expect(mockRefreshRuntimeState).toHaveBeenCalled());
      const compactList = within(detailPane).getByTestId('priority-detail-compact-list');
      expect(compactList.className).toContain('overflow-hidden');
      expect(compactList.className).not.toContain('rounded');
      expect(compactList.className).not.toContain('border');
      expect(
        within(detailPane).getByRole('radio', { name: '选择 Claude Site' })
      ).toBeInTheDocument();
      expect(
        within(detailPane).getByRole('radio', { name: '选择 Claude Site 2' })
      ).toBeInTheDocument();
      expect(
        within(detailPane).queryByRole('radio', { name: '选择 Claude Site 0' })
      ).not.toBeInTheDocument();
      const siteSections = getPrioritySiteSections(detailPane);
      expect(siteSections).toHaveLength(2);
      expect(siteSections[0]?.className).not.toContain('rounded');
      expect(siteSections[0]?.className).not.toContain('shadow');
      expect(siteSections[0]?.firstElementChild).toHaveClass(
        'grid-cols-[minmax(0,calc(43%_+_64px))_minmax(0,calc(57%_-_94px))_76px_44px]'
      );
      expect(
        within(siteSections[0]!).getByRole('radio', { name: '选择 Claude Site' })
      ).toBeChecked();
      const firstSiteHeader = siteSections[0]!.firstElementChild as HTMLElement;
      const firstSiteCells = Array.from(firstSiteHeader.children) as HTMLElement[];
      expect(firstSiteCells).toHaveLength(3);
      expect(firstSiteCells[0]).toHaveClass('col-span-2');
      expect(
        within(firstSiteCells[0]!).queryByRole('button', { name: 'Claude Site 上移' })
      ).not.toBeInTheDocument();
      expect(within(firstSiteCells[0]!).getByTitle('Claude Site')).toHaveClass(
        'max-w-full',
        'whitespace-normal',
        'break-words'
      );
      expect(within(firstSiteCells[1]!).queryByText(/claude-/)).not.toBeInTheDocument();
      expect(within(firstSiteCells[0]!).queryByText(/暂停至/)).not.toBeInTheDocument();
      expect(
        within(firstSiteCells[1]!).queryByRole('button', { name: 'Claude Site 上移' })
      ).not.toBeInTheDocument();
      expect(firstSiteCells[2]).toHaveAttribute('aria-label', 'Claude Site 禁用');
      expect(firstSiteCells[2]).toHaveClass('h-6', 'min-w-10', 'text-[11px]');
      expect(firstSiteCells[2]).toHaveTextContent('禁用');
      expect(within(detailPane).getByText('来源')).toBeInTheDocument();
      expect(within(detailPane).getByText('优先级')).toBeInTheDocument();
      expect(within(detailPane).queryByText('站点优先级')).not.toBeInTheDocument();
      expect(within(detailPane).queryByText('API Key 优先级')).not.toBeInTheDocument();
      expect(within(detailPane).queryAllByRole('spinbutton')).toHaveLength(0);
      expect(within(compactList).queryByRole('button', { name: '置顶' })).not.toBeInTheDocument();
      expect(within(detailPane).getByRole('button', { name: '置顶' })).toBeInTheDocument();
      expect(
        within(detailPane)
          .getAllByTestId('priority-detail-site-priority')
          .map(node => node.textContent)
      ).toEqual(['0', '1']);
      expect(within(detailPane).getAllByText('站点')).toHaveLength(2);
      const apiKeyBadges = within(detailPane).getAllByText('API Key');
      expect(apiKeyBadges).toHaveLength(4);
      expect(apiKeyBadges[0]).toHaveClass('px-1', 'py-px', 'text-[9px]', 'font-bold');
      expect(within(detailPane).getAllByText('折叠')).toHaveLength(1);
      expect(within(detailPane).getByRole('button', { name: '展开折叠站点' })).toBeInTheDocument();
      const missingKeyToggles = within(detailPane).getAllByTestId(
        'priority-detail-missing-key-toggle'
      );
      expect(missingKeyToggles).toHaveLength(1);
      expect(within(detailPane).queryAllByTestId('priority-detail-missing-key-row')).toHaveLength(
        0
      );
      expect(within(detailPane).queryByRole('button', { name: '创建' })).not.toBeInTheDocument();
      expect(
        within(detailPane).queryByText(
          'Main / team-alpha（claude-opus-4.6-20260201、claude-sonnet-4.6-20260201）未创建可用 API key'
        )
      ).not.toBeInTheDocument();
      missingKeyToggles.forEach(toggle => fireEvent.click(toggle));
      fireEvent.click(within(detailPane).getByRole('button', { name: '展开折叠站点' }));
      fireEvent.click(within(detailPane).getByRole('button', { name: 'Claude Site 0 展开折叠项' }));
      await waitFor(() => {
        expect(within(detailPane).getByTitle('Claude Site')).toBeInTheDocument();
        expect(within(detailPane).getByText('（$15.50）')).toBeInTheDocument();
        expect(within(detailPane).getByTitle('Claude Site 2')).toBeInTheDocument();
        expect(within(detailPane).getByText('（无限额度）')).toBeInTheDocument();
        expect(
          within(detailPane).getByText('backup-key（Main / team-beta / ×1.50）')
        ).toBeInTheDocument();
        expect(
          within(detailPane).getByText('backup-site-key（Backup / team-delta / ×2）')
        ).toBeInTheDocument();
        expect(
          within(detailPane).getAllByText('claude-opus-4.6-20260201（↑$0.001 ↓$0.002）').length
        ).toBeGreaterThan(0);
        expect(
          within(detailPane).getByText('claude-haiku-4.5-20251001（↑$1 ↓$3）')
        ).toBeInTheDocument();
      });
      const apiKeyRows = within(detailPane).getAllByTestId('priority-detail-api-key-row');
      expect(apiKeyRows).toHaveLength(4);
      expect(apiKeyRows[0]).toHaveClass(
        'grid-cols-[minmax(0,calc(43%_+_64px))_minmax(0,calc(57%_-_94px))_76px_44px]'
      );
      expect(apiKeyRows[0]?.className).toContain('text-xs');
      expect(apiKeyRows[0]?.className).not.toContain('text-sm');
      expect(within(apiKeyRows[0]!).queryByText('--')).not.toBeInTheDocument();
      expect(apiKeyRows[0]).not.toHaveAttribute('data-priority-hit', 'true');
      expect(apiKeyRows[0]).not.toHaveAttribute('aria-current', 'true');
      expect(apiKeyRows[0]).not.toHaveClass('bg-[var(--success-soft)]');
      expect(within(apiKeyRows[0]!).queryByText('当前优先命中')).not.toBeInTheDocument();
      expect(apiKeyRows.every(row => row.getAttribute('data-priority-hit') !== 'true')).toBe(true);
      const firstApiKeyCells = Array.from(apiKeyRows[0]!.children) as HTMLElement[];
      expect(
        within(firstApiKeyCells[0]!).getByRole('button', { name: 'backup-key 下移' })
      ).toBeInTheDocument();
      expect(
        within(firstApiKeyCells[2]!).queryByRole('button', { name: 'backup-key 下移' })
      ).not.toBeInTheDocument();
      expect(firstApiKeyCells[3]).toHaveAttribute('aria-label', 'backup-key 禁用');
      expect(firstApiKeyCells[3]).toHaveClass('h-5', 'min-w-8', 'text-[10px]');
      expect(firstApiKeyCells[3]).toHaveTextContent('禁用');
      expect(
        within(apiKeyRows[0]!).queryByTestId('priority-detail-api-key-priority')
      ).not.toBeInTheDocument();
      const firstApiKeyMoveButton = within(firstApiKeyCells[0]!).getByRole('button', {
        name: 'backup-key 下移',
      });
      expect(firstApiKeyMoveButton).toHaveClass('p-0');
      expect(firstApiKeyMoveButton.querySelector('svg')).toHaveClass('h-2.5', 'w-2.5');
      expect(
        within(detailPane).getByText('backup-key（Main / team-beta / ×1.50）')
      ).toBeInTheDocument();
      expect(
        within(detailPane).getByText('backup-site-key（Backup / team-delta / ×2）')
      ).toBeInTheDocument();
      expect(
        within(detailPane).getByText('main-key（Main / team-beta / ×1.50）')
      ).toBeInTheDocument();
      const mainKeyRow = within(detailPane)
        .getByText('main-key（Main / team-beta / ×1.50）')
        .closest('[data-testid="priority-detail-api-key-row"]') as HTMLElement;
      expect(mainKeyRow).not.toBeNull();
      const mainKeyCells = Array.from(mainKeyRow.children) as HTMLElement[];
      expect(within(mainKeyCells[0]!).queryByText(/暂停至/)).not.toBeInTheDocument();
      expect(within(mainKeyCells[1]!).getByText(/claude-opus.*暂停至/)).toBeInTheDocument();
      expect(mainKeyCells[1]).toHaveAttribute('title', expect.stringContaining('60分钟成功率 0%'));
      expect(within(mainKeyCells[1]!).getByText(/claude-opus.*暂停至/).textContent).toMatch(
        /claude-opus-4\.6-20260201（.*暂停至/
      );
      expect(
        within(detailPane).getByText('shared-key（Secondary / team-gamma / ×1）')
      ).toBeInTheDocument();
      expect(
        within(detailPane).getByText(
          'Main / team-alpha（claude-opus-4.6-20260201、claude-sonnet-4.6-20260201）未创建可用 API key'
        )
      ).toBeInTheDocument();
      expect(
        within(detailPane).getByText(
          'Empty / team-zeta（claude-instant-4.5-20251001）未创建可用 API key'
        )
      ).toBeInTheDocument();
      const createButtons = within(detailPane).getAllByRole('button', { name: '创建' });
      expect(createButtons).toHaveLength(2);
      expect(createButtons[0]?.className).toContain('!h-6');
      expect(createButtons[0]?.className).toContain('!min-h-6');
      expect(createButtons[0]?.className).toContain('w-14');
      expect(createButtons[0]?.className).toContain('justify-self-end');
      expect((missingKeyToggles[0]?.children[1] as HTMLElement | undefined)?.className).toContain(
        'justify-end'
      );
    }
  );

  it('highlights the api key from the latest persisted first-hit route log', async () => {
    mockGetRequestLogs.mockResolvedValueOnce({
      success: true,
      data: [
        createFirstHitRouteLog({
          id: 'route-log-retry',
          attempt: 2,
          apiKeyId: 'main-key-id',
          apiKeyName: 'main-key',
          createdAt: 1_800_000_000_500,
        }),
        createFirstHitRouteLog(),
      ],
    });

    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    const backupKeyRow = await waitFor(() => {
      const row = within(detailPane)
        .getByText('backup-key（Main / team-beta / ×1.50）')
        .closest('[data-testid="priority-detail-api-key-row"]') as HTMLElement | null;
      expect(row).not.toBeNull();
      expect(row).toHaveAttribute('data-priority-hit', 'true');
      return row!;
    });

    expect(mockGetRequestLogs).toHaveBeenCalledWith({ limit: 200 });
    expect(backupKeyRow).toHaveAttribute('aria-current', 'true');
    expect(backupKeyRow).toHaveClass('bg-[var(--success-soft)]');
    expect(within(backupKeyRow).getByText('当前优先命中')).toBeInTheDocument();

    const mainKeyRow = within(detailPane)
      .getByText('main-key（Main / team-beta / ×1.50）')
      .closest('[data-testid="priority-detail-api-key-row"]') as HTMLElement;
    expect(mainKeyRow).not.toHaveAttribute('data-priority-hit', 'true');
  });

  it('ignores logs before the persisted priority boundary and accepts later selections', async () => {
    const affinityInvalidatedAt = Date.now() - 1_000;
    const registry = createModelRegistryConfig();
    registry.displayItems = registry.displayItems.map(item =>
      item.canonicalName === 'claude-opus-4-6'
        ? {
            ...item,
            priorityConfig: {
              ...item.priorityConfig!,
              affinityInvalidatedAt,
            },
          }
        : item
    );
    mockConfig = {
      ...createRoutingConfig(),
      modelRegistry: registry,
    };
    mockGetRequestLogs.mockResolvedValueOnce({
      success: true,
      data: [
        createFirstHitRouteLog({
          requestSelectionStartedAt: affinityInvalidatedAt - 1,
        }),
      ],
    });
    let routeLogCallback: ((item: RouteRequestLogItem) => void) | null = null;
    mockOnRequestLogAppended.mockImplementation(callback => {
      routeLogCallback = callback;
      return vi.fn();
    });

    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    const backupKeyRow = within(detailPane)
      .getByText('backup-key（Main / team-beta / ×1.50）')
      .closest('[data-testid="priority-detail-api-key-row"]') as HTMLElement;
    await waitFor(() => expect(mockGetRequestLogs).toHaveBeenCalled());
    expect(backupKeyRow).not.toHaveAttribute('data-priority-hit', 'true');

    act(() => {
      routeLogCallback?.(
        createFirstHitRouteLog({
          id: 'route-log-after-priority-boundary',
          requestSelectionStartedAt: affinityInvalidatedAt + 1,
          createdAt: Date.now(),
        })
      );
    });

    await waitFor(() => expect(backupKeyRow).toHaveAttribute('data-priority-hit', 'true'));
  });

  it('skips first-hit route log loading and subscription while inactive', async () => {
    render(<ModelRedirectionTab isActive={false} />);

    await findPriorityDetailPane();

    expect(mockRefreshRuntimeState).not.toHaveBeenCalled();
    expect(mockGetRequestLogs).not.toHaveBeenCalled();
    expect(mockOnRequestLogAppended).not.toHaveBeenCalled();
  });

  it('restores the priority hit api key from persisted route path state after restart', async () => {
    mockConfig = createRoutingConfig({ includeSuccessfulPathState: true });
    mockGetRequestLogs.mockResolvedValueOnce({ success: true, data: [] });

    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    const backupKeyRow = await waitFor(() => {
      const row = within(detailPane)
        .getByText('backup-key（Main / team-beta / ×1.50）')
        .closest('[data-testid="priority-detail-api-key-row"]') as HTMLElement | null;
      expect(row).not.toBeNull();
      expect(row).toHaveAttribute('data-priority-hit', 'true');
      return row!;
    });

    expect(backupKeyRow).toHaveAttribute('aria-current', 'true');
    expect(within(backupKeyRow).getByText('当前优先命中')).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByTestId('redirect-detail-actions')).getByRole('button', {
        name: '重置 claude-opus-4-6 当前优先命中路径',
      })
    );

    await waitFor(() => {
      expect(mockResetPathStates).toHaveBeenCalledWith({
        canonicalModel: 'claude-opus-4-6',
        siteId: 'site-1',
        accountId: 'acc-1',
        apiKeyId: 'backup-key-id',
        targetProtocol: 'native',
      });
    });
  });

  it('clears stale same-channel first-hit logs after resetting a persisted priority hit path', async () => {
    mockConfig = createRoutingConfig({ includeSuccessfulPathState: true });
    mockGetRequestLogs.mockResolvedValueOnce({
      success: true,
      data: [
        createFirstHitRouteLog({
          routeRuleId: 'rule-other',
          targetProtocol: 'native',
          resolvedModel: 'claude-opus-4.6-alt-20260201',
          createdAt: Date.now(),
        }),
      ],
    });
    mockResetPathStates.mockImplementationOnce(async () => {
      mockConfig = {
        ...mockConfig,
        routePathStates: Object.fromEntries(
          Object.entries(mockConfig.routePathStates).filter(
            ([, state]) => state.lastOutcome !== 'success'
          )
        ),
      };
      return 1;
    });

    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    const backupKeyRow = await waitFor(() => {
      const row = within(detailPane)
        .getByText('backup-key（Main / team-beta / ×1.50）')
        .closest('[data-testid="priority-detail-api-key-row"]') as HTMLElement | null;
      expect(row).not.toBeNull();
      expect(row).toHaveAttribute('data-priority-hit', 'true');
      return row!;
    });

    fireEvent.click(
      within(screen.getByTestId('redirect-detail-actions')).getByRole('button', {
        name: '重置 claude-opus-4-6 当前优先命中路径',
      })
    );

    await waitFor(() => {
      expect(backupKeyRow).not.toHaveAttribute('data-priority-hit', 'true');
      expect(within(backupKeyRow).queryByText('当前优先命中')).not.toBeInTheDocument();
    });
  });

  it('does not restore a priority hit from request logs loaded before reset', async () => {
    mockConfig = createRoutingConfig({ includeSuccessfulPathState: true });
    let resolveRequestLogs!: (value: { success: boolean; data: RouteRequestLogItem[] }) => void;
    mockGetRequestLogs.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveRequestLogs = resolve;
        })
    );
    mockResetPathStates.mockImplementationOnce(async () => {
      mockConfig = {
        ...mockConfig,
        routePathStates: Object.fromEntries(
          Object.entries(mockConfig.routePathStates).filter(
            ([, state]) => state.lastOutcome !== 'success'
          )
        ),
      };
      return 1;
    });

    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    const backupKeyRow = await waitFor(() => {
      const row = within(detailPane)
        .getByText('backup-key（Main / team-beta / ×1.50）')
        .closest('[data-testid="priority-detail-api-key-row"]') as HTMLElement | null;
      expect(row).toHaveAttribute('data-priority-hit', 'true');
      return row!;
    });

    fireEvent.click(
      within(screen.getByTestId('redirect-detail-actions')).getByRole('button', {
        name: '重置 claude-opus-4-6 当前优先命中路径',
      })
    );
    await waitFor(() => expect(backupKeyRow).not.toHaveAttribute('data-priority-hit', 'true'));

    await act(async () => {
      resolveRequestLogs({ success: true, data: [createFirstHitRouteLog()] });
      await Promise.resolve();
    });

    expect(backupKeyRow).not.toHaveAttribute('data-priority-hit', 'true');
  });

  it('does not restore a priority hit from a request selected before reset', async () => {
    mockConfig = createRoutingConfig({ includeSuccessfulPathState: true });
    let routeLogCallback: ((item: RouteRequestLogItem) => void) | null = null;
    mockOnRequestLogAppended.mockImplementation(callback => {
      routeLogCallback = callback;
      return vi.fn();
    });
    mockResetPathStates.mockImplementationOnce(async () => {
      mockConfig = {
        ...mockConfig,
        routePathStates: Object.fromEntries(
          Object.entries(mockConfig.routePathStates).filter(
            ([, state]) => state.lastOutcome !== 'success'
          )
        ),
      };
      return 1;
    });

    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    const backupKeyRow = await waitFor(() => {
      const row = within(detailPane)
        .getByText('backup-key（Main / team-beta / ×1.50）')
        .closest('[data-testid="priority-detail-api-key-row"]') as HTMLElement | null;
      expect(row).toHaveAttribute('data-priority-hit', 'true');
      return row!;
    });
    const requestSelectionStartedAt = Date.now() - 10_000;

    fireEvent.click(
      within(screen.getByTestId('redirect-detail-actions')).getByRole('button', {
        name: '重置 claude-opus-4-6 当前优先命中路径',
      })
    );
    await waitFor(() => expect(backupKeyRow).not.toHaveAttribute('data-priority-hit', 'true'));

    act(() => {
      routeLogCallback?.(
        createFirstHitRouteLog({
          id: 'route-log-completed-after-reset',
          requestSelectionStartedAt,
          createdAt: Date.now() + 1,
        })
      );
    });

    expect(backupKeyRow).not.toHaveAttribute('data-priority-hit', 'true');
  });

  it('does not restore a hit from a request selected while reset is still pending', async () => {
    mockConfig = createRoutingConfig({ includeSuccessfulPathState: true });
    let routeLogCallback: ((item: RouteRequestLogItem) => void) | null = null;
    let resolveReset!: (value: number) => void;
    mockOnRequestLogAppended.mockImplementation(callback => {
      routeLogCallback = callback;
      return vi.fn();
    });
    mockResetPathStates.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveReset = resolve;
        })
    );

    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    const backupKeyRow = await waitFor(() => {
      const row = within(detailPane)
        .getByText('backup-key（Main / team-beta / ×1.50）')
        .closest('[data-testid="priority-detail-api-key-row"]') as HTMLElement | null;
      expect(row).toHaveAttribute('data-priority-hit', 'true');
      return row!;
    });

    fireEvent.click(
      within(screen.getByTestId('redirect-detail-actions')).getByRole('button', {
        name: '重置 claude-opus-4-6 当前优先命中路径',
      })
    );
    await waitFor(() => expect(mockResetPathStates).toHaveBeenCalled());
    await new Promise(resolve => window.setTimeout(resolve, 5));
    const requestSelectionStartedAt = Date.now();

    await act(async () => {
      resolveReset(1);
      await Promise.resolve();
    });
    await waitFor(() => expect(backupKeyRow).not.toHaveAttribute('data-priority-hit', 'true'));

    act(() => {
      routeLogCallback?.(
        createFirstHitRouteLog({
          id: 'route-log-selected-during-reset',
          requestSelectionStartedAt,
          createdAt: Date.now() + 1,
        })
      );
    });

    expect(backupKeyRow).not.toHaveAttribute('data-priority-hit', 'true');
  });

  it('updates the highlighted api key from appended first-hit route logs in real time', async () => {
    let routeLogCallback: ((item: RouteRequestLogItem) => void) | null = null;
    mockOnRequestLogAppended.mockImplementation(callback => {
      routeLogCallback = callback;
      return vi.fn();
    });

    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    await waitFor(() => expect(mockOnRequestLogAppended).toHaveBeenCalled());
    const apiKeyRows = within(detailPane).getAllByTestId('priority-detail-api-key-row');
    expect(apiKeyRows.every(row => row.getAttribute('data-priority-hit') !== 'true')).toBe(true);

    act(() => {
      routeLogCallback?.(
        createFirstHitRouteLog({
          id: 'route-log-ignored-retry',
          attempt: 2,
          apiKeyId: 'main-key-id',
          apiKeyName: 'main-key',
          createdAt: 1_800_000_000_600,
        })
      );
    });
    expect(apiKeyRows.every(row => row.getAttribute('data-priority-hit') !== 'true')).toBe(true);

    act(() => {
      routeLogCallback?.(
        createFirstHitRouteLog({
          id: 'route-log-outside-source-set',
          apiKeyId: 'unknown-key-id',
          apiKeyName: 'unknown-key',
          createdAt: 1_800_000_000_700,
        })
      );
    });
    expect(apiKeyRows.every(row => row.getAttribute('data-priority-hit') !== 'true')).toBe(true);

    act(() => {
      routeLogCallback?.(createFirstHitRouteLog());
    });

    const backupKeyRow = await waitFor(() => {
      const row = within(detailPane)
        .getByText('backup-key（Main / team-beta / ×1.50）')
        .closest('[data-testid="priority-detail-api-key-row"]') as HTMLElement | null;
      expect(row).not.toBeNull();
      expect(row).toHaveAttribute('data-priority-hit', 'true');
      return row!;
    });
    expect(within(backupKeyRow).getByText('当前优先命中')).toBeInTheDocument();

    act(() => {
      routeLogCallback?.(
        createFirstHitRouteLog({
          id: 'route-log-other-model',
          canonicalModel: 'gpt-5.4',
          siteId: 'site-3',
          accountId: 'acc-3',
          apiKeyId: 'gpt-main-key-id',
          apiKeyName: 'gpt-main-key',
          createdAt: 1_800_000_000_800,
        })
      );
    });

    expect(backupKeyRow).toHaveAttribute('data-priority-hit', 'true');
  });

  it('shortens default account labels in api key rows', async () => {
    const defaultAccountSourceKey = 'site-1:acc-1:claude-opus-4.6-20260201';
    const renameDefaultAccount = (source: RouteModelSourceRef): RouteModelSourceRef =>
      source.sourceKey === defaultAccountSourceKey
        ? {
            ...source,
            accountName: '默认账户',
            availableApiKeys: source.availableApiKeys.map(apiKey => ({
              ...apiKey,
              accountName: '默认账户',
            })),
          }
        : source;

    mockConfig = {
      ...mockConfig,
      modelRegistry: {
        ...mockConfig.modelRegistry,
        sources: mockConfig.modelRegistry.sources.map(renameDefaultAccount),
        entries: {
          ...mockConfig.modelRegistry.entries,
          'claude-opus-4-6': {
            ...mockConfig.modelRegistry.entries['claude-opus-4-6']!,
            sources:
              mockConfig.modelRegistry.entries['claude-opus-4-6']?.sources.map(
                renameDefaultAccount
              ) ?? [],
          },
        },
      },
    };

    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    expect(
      within(detailPane).getByText('backup-key（默认 / team-beta / ×1.50）')
    ).toBeInTheDocument();
    expect(
      within(detailPane).queryByText('backup-key（默认账户 / team-beta / ×1.50）')
    ).not.toBeInTheDocument();
  });

  it('folds site groups without api keys by default', async () => {
    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    const siteSections = getPrioritySiteSections(detailPane);

    expect(siteSections).toHaveLength(2);
    expect(
      within(siteSections[0]!).getByRole('radio', { name: '选择 Claude Site' })
    ).toBeInTheDocument();
    expect(
      within(siteSections[1]!).getByRole('radio', { name: '选择 Claude Site 2' })
    ).toBeInTheDocument();
    expect(
      within(detailPane).queryByRole('radio', { name: '选择 Claude Site 0' })
    ).not.toBeInTheDocument();

    const foldedSitesRow = within(detailPane).getByTestId('priority-detail-folded-sites');
    expect(foldedSitesRow).toHaveClass('border-[var(--line-muted)]', 'bg-[var(--surface-2)]');
    expect(foldedSitesRow).not.toHaveClass('border-[var(--warning)]/25');

    fireEvent.click(within(detailPane).getByRole('button', { name: '展开折叠站点' }));

    const expandedSiteSections = getPrioritySiteSections(detailPane);
    expect(expandedSiteSections).toHaveLength(3);
    expect(
      within(expandedSiteSections[2]!).getByRole('radio', { name: '选择 Claude Site 0' })
    ).toBeDisabled();
  });

  it('creates an api key from the missing hint row and refreshes the detail pane', async () => {
    mockSyncModelRegistrySources.mockResolvedValue(createRegistryWithCreatedTeamAlphaKey());

    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    fireEvent.click(within(detailPane).getByRole('button', { name: 'Claude Site 展开折叠项' }));
    const missingHint = within(detailPane).getByText(
      'Main / team-alpha（claude-opus-4.6-20260201、claude-sonnet-4.6-20260201）未创建可用 API key'
    );

    fireEvent.click(
      within(
        missingHint.closest('[data-testid="priority-detail-missing-key-row"]') as HTMLElement
      ).getByRole('button', { name: '创建' })
    );

    const createDialog = await screen.findByRole('dialog', { name: '创建 API Key' });
    fireEvent.change(within(createDialog).getByPlaceholderText('输入令牌名称'), {
      target: { value: 'team-alpha-key' },
    });
    fireEvent.click(within(createDialog).getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(mockLoadConfig).toHaveBeenCalledTimes(2);
      expect(mockCreateApiToken).toHaveBeenCalledWith(
        'https://claude-site.example.com',
        101,
        'access-main',
        expect.objectContaining({
          name: 'team-alpha-key',
          group: 'team-alpha',
        }),
        'acc-1'
      );
      expect(mockSyncModelRegistrySources).toHaveBeenCalledWith(true);
    });

    await waitFor(() => {
      expect(
        within(screen.getByTestId('redirect-detail-priority')).getByText(
          'team-alpha-key（Main / team-alpha / ×1.20）'
        )
      ).toBeInTheDocument();
    });
    expect(
      within(screen.getByTestId('redirect-detail-priority')).queryByText(
        'Main / team-alpha（claude-opus-4.6-20260201、claude-sonnet-4.6-20260201）未创建可用 API key'
      )
    ).not.toBeInTheDocument();
  });

  it('reorders site groups immediately when site priority changes', async () => {
    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();

    let siteSections = getPrioritySiteSections(detailPane);
    expect(
      within(siteSections[0]!).getByRole('radio', { name: '选择 Claude Site' })
    ).toBeInTheDocument();
    expect(
      within(siteSections[1]!).getByRole('radio', { name: '选择 Claude Site 2' })
    ).toBeInTheDocument();
    expect(
      within(detailPane).queryByRole('radio', { name: '选择 Claude Site 0' })
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(siteSections[1]!).getByRole('radio', { name: '选择 Claude Site 2' }));
      fireEvent.click(within(detailPane).getByRole('button', { name: '上移' }));
    });

    siteSections = getPrioritySiteSections(detailPane);
    expect(
      within(siteSections[0]!).getByRole('radio', { name: '选择 Claude Site 2' })
    ).toBeInTheDocument();
    expect(
      within(siteSections[1]!).getByRole('radio', { name: '选择 Claude Site' })
    ).toBeInTheDocument();
    expect(
      within(detailPane).queryByRole('radio', { name: '选择 Claude Site 0' })
    ).not.toBeInTheDocument();

    fireEvent.click(within(siteSections[0]!).getByRole('radio', { name: '选择 Claude Site 2' }));
    fireEvent.click(within(detailPane).getByRole('button', { name: '置底' }));

    siteSections = getPrioritySiteSections(detailPane);
    expect(
      within(siteSections[0]!).getByRole('radio', { name: '选择 Claude Site' })
    ).toBeInTheDocument();
    expect(
      within(siteSections[1]!).getByRole('radio', { name: '选择 Claude Site 2' })
    ).toBeInTheDocument();
    expect(
      within(detailPane).queryByRole('radio', { name: '选择 Claude Site 0' })
    ).not.toBeInTheDocument();
  });

  it('saves detail priorities back into the current display item', async () => {
    mockGetRequestLogs.mockResolvedValueOnce({
      success: true,
      data: [
        createFirstHitRouteLog({
          targetProtocol: 'native',
        }),
      ],
    });
    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    let siteSections = getPrioritySiteSections(detailPane);

    fireEvent.click(within(siteSections[1]!).getByRole('radio', { name: '选择 Claude Site 2' }));
    fireEvent.click(within(detailPane).getByRole('button', { name: '上移' }));
    siteSections = getPrioritySiteSections(detailPane);
    const primarySite = siteSections.find(section =>
      within(section).queryByRole('radio', { name: '选择 Claude Site' })
    ) as HTMLElement;
    fireEvent.click(within(primarySite).getByRole('button', { name: 'main-key 下移' }));

    fireEvent.click(within(detailPane).getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(mockUpsertDisplayItem).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'manual:claude-opus-4-6',
          canonicalName: 'claude-opus-4-6',
          priorityConfig: {
            sitePriorities: {
              'site-2': 0,
              'site-1': 1,
            },
            apiKeyPriorities: {
              [buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'backup-key-id')]: 0,
              [buildRouteApiKeyPriorityKey('site-1', 'acc-9', 'backup-site-key-id')]: 1,
              [buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'main-key-id')]: 2,
              [buildRouteApiKeyPriorityKey('site-2', 'acc-2', 'shared-key-id')]: 0,
            },
          },
        })
      );
    });
    expect(mockResetPathStates).not.toHaveBeenCalled();
  });

  it('auto-saves when an api key is disabled or re-enabled without dirtying the save button', async () => {
    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    fireEvent.click(within(detailPane).getByRole('button', { name: 'main-key 禁用' }));

    await waitFor(() => {
      expect(
        within(detailPane).queryByText('main-key（Main / team-beta / ×1.50）')
      ).not.toBeInTheDocument();
      expect(within(detailPane).getByRole('button', { name: 'Claude Site 展开折叠项' }));
    });

    fireEvent.click(within(detailPane).getByRole('button', { name: 'Claude Site 展开折叠项' }));

    const disabledMainKeyRow = await waitFor(() => {
      const row = within(detailPane)
        .getByText('main-key（Main / team-beta / ×1.50）')
        .closest('[data-testid="priority-detail-disabled-api-key-row"]') as HTMLElement | null;
      expect(row).not.toBeNull();
      return row!;
    });
    expect(within(disabledMainKeyRow).getByText('已禁用')).toBeInTheDocument();
    expect(within(disabledMainKeyRow).getByRole('button', { name: 'main-key 启用' })).toHaveClass(
      'h-5',
      'min-w-8',
      'text-[10px]'
    );

    await waitFor(() => {
      expect(mockUpsertDisplayItem).toHaveBeenCalledWith(
        expect.objectContaining({
          priorityConfig: {
            sitePriorities: {
              'site-1': 0,
              'site-2': 1,
            },
            apiKeyPriorities: {
              [buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'backup-key-id')]: 0,
              [buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'main-key-id')]: 1,
              [buildRouteApiKeyPriorityKey('site-1', 'acc-9', 'backup-site-key-id')]: 2,
              [buildRouteApiKeyPriorityKey('site-2', 'acc-2', 'shared-key-id')]: 0,
            },
            disabledApiKeyPriorityKeys: [
              buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'main-key-id'),
            ],
          },
        })
      );
    });
    await waitFor(() => {
      expect(within(detailPane).getByTestId('priority-save-button')).toHaveAttribute(
        'data-priority-dirty',
        'false'
      );
    });

    fireEvent.click(within(disabledMainKeyRow).getByRole('button', { name: 'main-key 启用' }));

    await waitFor(() => {
      const apiKeyRows = within(detailPane).getAllByTestId('priority-detail-api-key-row');
      expect(apiKeyRows[0]).toHaveTextContent('backup-key（Main / team-beta / ×1.50）');
      expect(apiKeyRows[1]).toHaveTextContent('main-key（Main / team-beta / ×1.50）');
      expect(apiKeyRows[2]).toHaveTextContent('backup-site-key（Backup / team-delta / ×2）');
    });
    await waitFor(() => {
      expect(mockUpsertDisplayItem).toHaveBeenLastCalledWith(
        expect.objectContaining({
          priorityConfig: expect.not.objectContaining({
            disabledApiKeyPriorityKeys: expect.anything(),
          }),
        })
      );
    });
    await waitFor(() => {
      expect(within(detailPane).getByTestId('priority-save-button')).toHaveAttribute(
        'data-priority-dirty',
        'false'
      );
    });
  });

  it('auto-saves when a site is disabled or re-enabled without dirtying the save button', async () => {
    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    fireEvent.click(within(detailPane).getByRole('button', { name: 'Claude Site 2 禁用' }));

    await waitFor(() => {
      expect(
        within(detailPane)
          .getAllByTestId('priority-detail-site-priority')
          .map(node => node.textContent)
      ).toEqual(['0']);
      expect(
        within(detailPane).queryByRole('button', { name: 'Claude Site 2 启用' })
      ).not.toBeInTheDocument();
      expect(
        within(detailPane).queryByText('shared-key（Secondary / team-gamma / ×1）')
      ).not.toBeInTheDocument();
    });

    fireEvent.click(within(detailPane).getByRole('button', { name: '展开折叠站点' }));
    expect(within(detailPane).getByRole('button', { name: 'Claude Site 2 启用' }));
    fireEvent.click(within(detailPane).getByRole('button', { name: 'Claude Site 2 展开折叠项' }));

    const disabledSharedKeyRow = await waitFor(() => {
      const row = within(detailPane)
        .getByText('shared-key（Secondary / team-gamma / ×1）')
        .closest('[data-testid="priority-detail-disabled-api-key-row"]') as HTMLElement | null;
      expect(row).not.toBeNull();
      return row!;
    });
    expect(within(disabledSharedKeyRow).getByText('随站点禁用')).toBeInTheDocument();
    expect(
      within(disabledSharedKeyRow).getByRole('button', { name: 'shared-key 启用' })
    ).toBeDisabled();

    await waitFor(() => {
      expect(mockUpsertDisplayItem).toHaveBeenCalledWith(
        expect.objectContaining({
          priorityConfig: {
            sitePriorities: {
              'site-1': 0,
              'site-2': 1,
            },
            apiKeyPriorities: {
              [buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'backup-key-id')]: 0,
              [buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'main-key-id')]: 1,
              [buildRouteApiKeyPriorityKey('site-1', 'acc-9', 'backup-site-key-id')]: 2,
              [buildRouteApiKeyPriorityKey('site-2', 'acc-2', 'shared-key-id')]: 0,
            },
            disabledSiteIds: ['site-2'],
          },
        })
      );
    });
    await waitFor(() => {
      expect(within(detailPane).getByTestId('priority-save-button')).toHaveAttribute(
        'data-priority-dirty',
        'false'
      );
    });

    fireEvent.click(within(detailPane).getByRole('button', { name: 'Claude Site 2 启用' }));

    await waitFor(() => {
      expect(
        within(detailPane)
          .getAllByTestId('priority-detail-site-priority')
          .map(node => node.textContent)
          .filter(text => text !== '--')
      ).toEqual(['0', '1']);
      expect(
        within(detailPane).getByText('shared-key（Secondary / team-gamma / ×1）')
      ).toBeInTheDocument();
      expect(within(detailPane).queryByText('随站点禁用')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(within(detailPane).getByTestId('priority-save-button')).toHaveAttribute(
        'data-priority-dirty',
        'false'
      );
    });
  });

  it('keeps a disabled site folded after syncing sources refreshes the selected detail', async () => {
    const { rerender } = render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    fireEvent.click(within(detailPane).getByRole('button', { name: 'Claude Site 2 禁用' }));

    await waitFor(() => {
      expect(
        within(detailPane).queryByRole('button', { name: 'Claude Site 2 启用' })
      ).not.toBeInTheDocument();
      expect(
        within(detailPane).queryByText('shared-key（Secondary / team-gamma / ×1）')
      ).not.toBeInTheDocument();
    });

    const syncedRegistry = createModelRegistryConfig();
    mockSyncModelRegistrySources.mockResolvedValueOnce(syncedRegistry);
    fireEvent.click(screen.getByRole('button', { name: '同步来源' }));

    await waitFor(() => {
      expect(mockSyncModelRegistrySources).toHaveBeenCalledWith(true);
    });

    await act(async () => {
      mockConfig = {
        ...mockConfig,
        modelRegistry: syncedRegistry,
      };
      rerender(<ModelRedirectionTab />);
    });

    await waitFor(() => {
      expect(
        within(detailPane).queryByRole('button', { name: 'Claude Site 2 启用' })
      ).not.toBeInTheDocument();
      expect(
        within(detailPane).queryByText('shared-key（Secondary / team-gamma / ×1）')
      ).not.toBeInTheDocument();
    });

    fireEvent.click(within(detailPane).getByRole('button', { name: '展开折叠站点' }));
    expect(within(detailPane).getByRole('button', { name: 'Claude Site 2 启用' }));
  });

  it('keeps a disabled api key folded after restoring route paths refreshes config', async () => {
    const { rerender } = render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    fireEvent.click(within(detailPane).getByRole('button', { name: 'main-key 禁用' }));

    await waitFor(() => {
      expect(
        within(detailPane).queryByText('main-key（Main / team-beta / ×1.50）')
      ).not.toBeInTheDocument();
      expect(within(detailPane).getByRole('button', { name: 'Claude Site 展开折叠项' }));
    });

    fireEvent.click(screen.getByRole('button', { name: '恢复 claude-opus-4-6 路由路径' }));

    await waitFor(() => {
      expect(mockResetPathStates).toHaveBeenCalledWith({
        canonicalModel: 'claude-opus-4-6',
      });
    });

    await act(async () => {
      mockConfig = {
        ...mockConfig,
        modelRegistry: createModelRegistryConfig(),
        routePathStates: {},
      };
      rerender(<ModelRedirectionTab />);
    });

    await waitFor(() => {
      expect(
        within(detailPane).queryByText('main-key（Main / team-beta / ×1.50）')
      ).not.toBeInTheDocument();
      expect(within(detailPane).getByRole('button', { name: 'Claude Site 展开折叠项' }));
    });

    fireEvent.click(within(detailPane).getByRole('button', { name: 'Claude Site 展开折叠项' }));
    expect(within(detailPane).getByText('main-key（Main / team-beta / ×1.50）'));
  });

  it('auto-saves when all api keys of a site are disabled and keeps the site folded', async () => {
    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();

    fireEvent.click(within(detailPane).getByRole('button', { name: 'backup-key 禁用' }));
    fireEvent.click(within(detailPane).getByRole('button', { name: 'main-key 禁用' }));
    fireEvent.click(within(detailPane).getByRole('button', { name: 'backup-site-key 禁用' }));

    await waitFor(() => {
      expect(
        within(detailPane)
          .getAllByTestId('priority-detail-site-priority')
          .map(node => node.textContent)
      ).toEqual(['0']);
      expect(within(detailPane).getByRole('button', { name: '展开折叠站点' }));
      expect(
        within(detailPane).queryByRole('button', { name: 'Claude Site 展开折叠项' })
      ).not.toBeInTheDocument();
      expect(
        within(detailPane).queryByText('backup-key（Main / team-beta / ×1.50）')
      ).not.toBeInTheDocument();
      expect(
        within(detailPane).queryByText('main-key（Main / team-beta / ×1.50）')
      ).not.toBeInTheDocument();
      expect(
        within(detailPane).queryByText('backup-site-key（Backup / team-delta / ×2）')
      ).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockUpsertDisplayItem).toHaveBeenCalledWith(
        expect.objectContaining({
          priorityConfig: {
            sitePriorities: {
              'site-1': 0,
              'site-2': 1,
            },
            apiKeyPriorities: {
              [buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'backup-key-id')]: 0,
              [buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'main-key-id')]: 1,
              [buildRouteApiKeyPriorityKey('site-1', 'acc-9', 'backup-site-key-id')]: 2,
              [buildRouteApiKeyPriorityKey('site-2', 'acc-2', 'shared-key-id')]: 0,
            },
            disabledApiKeyPriorityKeys: [
              buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'backup-key-id'),
              buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'main-key-id'),
              buildRouteApiKeyPriorityKey('site-1', 'acc-9', 'backup-site-key-id'),
            ],
          },
        })
      );
    });
    await waitFor(() => {
      expect(within(detailPane).getByTestId('priority-save-button')).toHaveAttribute(
        'data-priority-dirty',
        'false'
      );
    });

    fireEvent.click(within(detailPane).getByRole('button', { name: '展开折叠站点' }));
    fireEvent.click(within(detailPane).getByRole('button', { name: 'Claude Site 展开折叠项' }));
    fireEvent.click(within(detailPane).getByRole('button', { name: 'backup-key 启用' }));

    await waitFor(() => {
      expect(
        within(detailPane)
          .getAllByTestId('priority-detail-site-priority')
          .map(node => node.textContent)
          .filter(text => text !== '--')
      ).toEqual(['0', '1']);
      expect(
        within(detailPane).getByText('backup-key（Main / team-beta / ×1.50）')
      ).toBeInTheDocument();
    });
  });

  it('marks the priority save button dirty/red after reordering without saving', async () => {
    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    const saveButton = within(detailPane).getByTestId('priority-save-button');
    expect(saveButton).toHaveAttribute('data-priority-dirty', 'false');
    expect(saveButton.className).not.toContain('bg-[var(--danger-soft)]');

    const siteSections = getPrioritySiteSections(detailPane);
    fireEvent.click(within(siteSections[1]!).getByRole('radio', { name: '选择 Claude Site 2' }));
    fireEvent.click(within(detailPane).getByRole('button', { name: '上移' }));

    await waitFor(() => {
      expect(saveButton).toHaveAttribute('data-priority-dirty', 'true');
    });
    expect(saveButton.className).toContain('bg-[var(--danger-soft)]');
    expect(mockUpsertDisplayItem).not.toHaveBeenCalled();
  });

  it('syncs model sources from the list toolbar without rebuilding defaults', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: '同步来源' }));

    await waitFor(() => {
      expect(mockSyncModelRegistrySources).toHaveBeenCalledWith(true);
    });
    expect(mockRebuildModelRegistry).not.toHaveBeenCalled();
  });

  it('deletes a redirect after confirming in the danger dialog', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: '删除 claude-opus-4-6' }));

    const confirmDialog = await screen.findByRole('dialog', { name: '删除重定向模型' });
    expect(mockDeleteDisplayItem).not.toHaveBeenCalled();

    fireEvent.click(within(confirmDialog).getByTestId('confirm-delete-redirect'));

    await waitFor(() => {
      expect(mockDeleteDisplayItem).toHaveBeenCalledWith('manual:claude-opus-4-6');
    });
  });

  it('marks persisted registry entries without detail metadata for source detail refresh', () => {
    expect(
      shouldRefreshRegistrySourceDetails({
        version: 1,
        sources: [],
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
        entries: {
          'claude-opus-4-6': {
            vendor: 'claude',
            canonicalName: 'claude-opus-4-6',
            aliases: ['claude-opus-4.6-20260201'],
            sources: [
              {
                sourceKey: 'site-1:acc-1:claude-opus-4.6-20260201',
                siteId: 'site-1',
                siteName: 'Claude Site',
                accountId: 'acc-1',
                accountName: 'Main',
                sourceType: 'account',
                originalModel: 'claude-opus-4.6-20260201',
                vendor: 'claude',
                apiKeyGroups: ['team-beta'],
                userGroupKeys: ['team-beta'],
                firstSeenAt: 10,
                lastSeenAt: 10,
              },
            ],
            hasOverride: false,
            createdAt: 10,
            updatedAt: 40,
          },
        },
      })
    ).toBe(true);

    expect(
      shouldRefreshRegistrySourceDetails({
        version: 1,
        sources: [],
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
        entries: {
          'claude-opus-4-6': {
            vendor: 'claude',
            canonicalName: 'claude-opus-4-6',
            aliases: ['claude-opus-4.6-20260201'],
            sources: [
              {
                sourceKey: 'site-1:acc-1:claude-opus-4.6-20260201',
                siteId: 'site-1',
                siteName: 'Claude Site',
                accountId: 'acc-1',
                accountName: 'Main',
                sourceType: 'account',
                originalModel: 'claude-opus-4.6-20260201',
                vendor: 'claude',
                apiKeyGroups: ['team-beta'],
                apiKeyNamesByGroup: {
                  'team-beta': ['main-key'],
                },
                userGroupKeys: ['team-beta'],
                availableUserGroups: ['team-beta'],
                availableApiKeys: [
                  {
                    apiKeyId: 'main-key-id',
                    apiKeyName: 'main-key',
                    accountId: 'acc-1',
                    accountName: 'Main',
                    group: 'team-beta',
                  },
                ],
                firstSeenAt: 10,
                lastSeenAt: 10,
              },
            ],
            hasOverride: false,
            createdAt: 10,
            updatedAt: 40,
          },
        },
      })
    ).toBe(false);
  });

  it('prefers persisted display items without deriving fallback examples', () => {
    const views = buildDisplayItemViews({
      version: 1,
      sources: [
        createSource({
          sourceKey: 'site-1:acc-1:claude-opus-4.6-20260201',
          originalModel: 'claude-opus-4.6-20260201',
          vendor: 'claude',
        }),
      ],
      overrides: [],
      vendorPriorities: {},
      lastAggregatedAt: 100,
      entries: {
        'claude-opus-4-6': {
          vendor: 'claude',
          canonicalName: 'claude-opus-4-6',
          aliases: ['claude-opus-4.6-20260201'],
          sources: [],
          hasOverride: false,
          createdAt: 1,
          updatedAt: 2,
        },
      },
      displayItems: [
        {
          id: 'manual:claude:1',
          vendor: 'claude',
          canonicalName: 'claude-team-opus',
          sourceKeys: ['site-1:acc-1:claude-opus-4.6-20260201'],
          originalModelOrder: ['claude-opus-4.6-20260201'],
          priorityConfig: {
            sitePriorities: {},
            apiKeyPriorities: {},
          },
          mode: 'manual',
          createdAt: 1,
          updatedAt: 4,
        },
      ],
    });

    expect(views.map(view => view.displayName)).toEqual(['claude-team-opus']);
  });

  it('does not derive a redirect from registry entries before the first aggregation', () => {
    const views = buildDisplayItemViews({
      version: 1,
      sources: [],
      overrides: [],
      vendorPriorities: {},
      entries: {
        'claude-opus-4-6': {
          vendor: 'claude',
          canonicalName: 'claude-opus-4-6',
          aliases: ['claude-opus-4.6-20260201'],
          sources: [
            createSource({
              sourceKey: 'site-1:acc-1:claude-opus-4.6-20260201',
              siteId: 'site-1',
              siteName: 'Claude Site',
              accountId: 'acc-1',
              accountName: 'Main',
              originalModel: 'claude-opus-4.6-20260201',
              vendor: 'claude',
            }),
          ],
          hasOverride: false,
          createdAt: 1,
          updatedAt: 2,
        },
      },
      displayItems: [],
    });

    expect(views).toEqual([]);
  });

  it('saves display-order priorities when the detail draft is unchanged', async () => {
    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();

    fireEvent.click(within(detailPane).getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(mockUpsertDisplayItem).toHaveBeenCalledWith(
        expect.objectContaining({
          priorityConfig: {
            sitePriorities: {
              'site-1': 0,
              'site-2': 1,
            },
            apiKeyPriorities: {
              [buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'backup-key-id')]: 0,
              [buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'main-key-id')]: 1,
              [buildRouteApiKeyPriorityKey('site-1', 'acc-9', 'backup-site-key-id')]: 2,
              [buildRouteApiKeyPriorityKey('site-2', 'acc-2', 'shared-key-id')]: 0,
            },
          },
        })
      );
    });
  });

  it('saves per-model route runtime rules from the selected detail action', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getAllByRole('button', { name: '规则' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'claude-opus-4-6 路由规则' });
    const saveButton = within(dialog).getByTestId('route-rule-save-button');
    expect(saveButton).toHaveAttribute('data-dirty', 'false');
    expect(saveButton.className).not.toContain('bg-[var(--danger-soft)]');

    fireEvent.change(within(dialog).getByLabelText('每条路由路径尝试次数'), {
      target: { value: '2' },
    });
    fireEvent.change(within(dialog).getByLabelText('禁用路由时间（分钟）'), {
      target: { value: '45' },
    });
    fireEvent.change(within(dialog).getByLabelText('成功率计算时间（分钟）'), {
      target: { value: '12' },
    });
    fireEvent.change(within(dialog).getByLabelText('最低成功率（%）'), {
      target: { value: '75' },
    });

    await waitFor(() => {
      expect(saveButton).toHaveAttribute('data-dirty', 'true');
    });
    expect(saveButton.className).toContain('bg-[var(--danger-soft)]');

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockUpsertDisplayItem).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'manual:claude-opus-4-6',
          runtimeConfig: {
            maxAttemptsPerRoutePath: 2,
            successRateWindowMinutes: 12,
            disableDurationMinutes: 45,
            minSuccessRate: 0.75,
          },
        })
      );
    });
  });

  it('preserves a newer auto-saved priority disable when saving route runtime rules from an older dialog snapshot', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getAllByRole('button', { name: '规则' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'claude-opus-4-6 路由规则' });

    const detailPane = await findPriorityDetailPane();
    fireEvent.click(within(detailPane).getByRole('button', { name: 'main-key 禁用' }));

    await waitFor(() => {
      expect(mockUpsertDisplayItem).toHaveBeenCalledWith(
        expect.objectContaining({
          priorityConfig: expect.objectContaining({
            disabledApiKeyPriorityKeys: [
              buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'main-key-id'),
            ],
          }),
        })
      );
    });

    fireEvent.change(within(dialog).getByLabelText('每条路由路径尝试次数'), {
      target: { value: '2' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存路由规则' }));

    await waitFor(() => {
      expect(mockUpsertDisplayItem).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'manual:claude-opus-4-6',
          runtimeConfig: expect.objectContaining({
            maxAttemptsPerRoutePath: 2,
          }),
          priorityConfig: expect.objectContaining({
            disabledApiKeyPriorityKeys: [
              buildRouteApiKeyPriorityKey('site-1', 'acc-1', 'main-key-id'),
            ],
          }),
        })
      );
    });
  });
});
