import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDisplayItemViews,
  buildRecommendedCliModelOptions,
  ModelRedirectionTab,
  shouldRefreshRegistrySourceDetails,
} from '../renderer/components/Route/Redirection/ModelRedirectionTab';
import { RoutePage } from '../renderer/pages/RoutePage';
import { useCustomCliConfigStore } from '../renderer/store/customCliConfigStore';
import {
  buildProbeKey,
  buildRouteApiKeyPriorityKey,
  buildRoutePathStateKey,
} from '../shared/types/route-proxy';
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
const mockFetchCliProbeData = vi.fn();
const mockRunProbeNow = vi.fn();
const mockSaveCliProbeConfig = vi.fn();
const mockSaveCliModelSelections = vi.fn();
const mockSaveServerConfig = vi.fn();
const mockRegenerateApiKey = vi.fn();
const mockStartServer = vi.fn();
const mockStopServer = vi.fn();

let mockConfig: RoutingConfig;

type MockElectronApi = {
  loadConfig?: typeof mockLoadConfig;
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
  cliProbeView: [];
  cliProbeTimeRange: '7d';
  cliProbeLoaded: boolean;
  cliProbeError: null;
  serverRunning: boolean;
  refreshRuntimeState: typeof mockRefreshRuntimeState;
  rebuildModelRegistry: typeof mockRebuildModelRegistry;
  syncModelRegistrySources: typeof mockSyncModelRegistrySources;
  fetchCliProbeData: typeof mockFetchCliProbeData;
  runProbeNow: typeof mockRunProbeNow;
  saveCliProbeConfig: typeof mockSaveCliProbeConfig;
  saveCliModelSelections: typeof mockSaveCliModelSelections;
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
      cliProbeView: [],
      cliProbeTimeRange: '7d',
      cliProbeLoaded: true,
      cliProbeError: null,
      serverRunning: true,
      refreshRuntimeState: mockRefreshRuntimeState,
      rebuildModelRegistry: mockRebuildModelRegistry,
      syncModelRegistrySources: mockSyncModelRegistrySources,
      fetchCliProbeData: mockFetchCliProbeData,
      runProbeNow: mockRunProbeNow,
      saveCliProbeConfig: mockSaveCliProbeConfig,
      saveCliModelSelections: mockSaveCliModelSelections,
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
  const detailPane = await screen.findByTestId('redirect-detail-priority');
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
  const testedAt = 1_800_000_001_000;

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
        testModels: [],
        testState: null,
      },
      codex: {
        enabled: true,
        model: 'duckcoding',
        testModels: ['duckcoding'],
        testState: {
          status: true,
          testedAt,
          slots: [{ model: 'duckcoding', success: true, timestamp: testedAt }, null, null],
        },
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
      id: 'seeded:claude-opus-4-6',
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
      mode: 'seeded',
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
  const claudeProbeKey = buildProbeKey('site-1', 'acc-1', 'claudeCode', 'claude-opus-4-6');
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
    cliProbe: {
      config: { enabled: true, intervalMinutes: 240 },
      latest: {
        [claudeProbeKey]: {
          probeKey: claudeProbeKey,
          siteId: 'site-1',
          accountId: 'acc-1',
          cliType: 'claudeCode',
          canonicalModel: 'claude-opus-4-6',
          rawModel: 'claude-opus-4.6-20260201',
          healthy: true,
          lastSample: {
            sampleId: 'sample-claude-opus',
            probeKey: claudeProbeKey,
            siteId: 'site-1',
            accountId: 'acc-1',
            cliType: 'claudeCode',
            canonicalModel: 'claude-opus-4-6',
            rawModel: 'claude-opus-4.6-20260201',
            success: true,
            source: 'routeProbe',
            testedAt: 100,
          },
          lastSuccessAt: 100,
        },
      },
      history: {},
    },
    cliModelSelections: {
      claudeCode: 'claude-opus-4-6',
      codex: 'gpt-5.4',
      geminiCli: null,
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
  mockUpsertDisplayItem.mockReset().mockResolvedValue(createModelRegistryConfig());
  mockDeleteDisplayItem.mockReset().mockResolvedValue(createModelRegistryConfig());
  mockDeleteMappingOverride.mockReset().mockResolvedValue(true);
  mockRebuildModelRegistry.mockReset().mockResolvedValue(createModelRegistryConfig());
  mockSyncModelRegistrySources.mockReset().mockResolvedValue(createModelRegistryConfig());
  mockRefreshRuntimeState.mockReset().mockResolvedValue(undefined);
  mockResetPathStates.mockReset().mockResolvedValue(1);
  mockFetchCliProbeData.mockReset().mockResolvedValue(undefined);
  mockRunProbeNow.mockReset().mockResolvedValue(null);
  mockSaveCliProbeConfig.mockReset().mockResolvedValue(undefined);
  mockSaveCliModelSelections.mockReset().mockResolvedValue(undefined);
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
    expect(screen.getByLabelText('上游代理')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('Gemini CLI')).toBeInTheDocument();
    expect(screen.getByTestId('route-page-server-row')).toBeInTheDocument();
    const primaryRow = screen.getByTestId('route-page-primary-row');
    expect(primaryRow).toHaveClass('min-w-0');
    expect(screen.getByTestId('redirect-leading-pane')).toBeInTheDocument();
    expect(screen.getByTestId('redirect-two-pane-layout')).toHaveClass(
      'xl:grid-cols-[minmax(168px,0.176fr)_minmax(192px,0.448fr)_minmax(0,1.676fr)]'
    );
    const serverSectionCard = screen.getByTestId('route-server-section-card');
    expect(serverSectionCard).toHaveClass('w-full');
    expect(screen.getByTestId('route-cli-model-section-card')).toHaveClass('h-full');
    expect(serverSectionCard).not.toHaveClass('h-fit', 'self-start');
    expect(screen.getByTestId('route-cli-model-section-card')).not.toHaveClass('h-fit');
    const guardToggle = within(serverSectionCard).getByRole('checkbox', {
      name: '阻断 Gemini CLI 内部工具/回退模型请求',
    });
    const stopButton = within(serverSectionCard).getByRole('button', { name: '停止' });
    expect(guardToggle.compareDocumentPosition(stopButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const serverPrimaryRow = screen.getByTestId('route-server-primary-config-row');
    const serverCredentialRow = screen.getByTestId('route-server-credential-row');
    expect(serverSectionCard.firstElementChild).toHaveClass('p-3');
    expect(screen.getByTestId('route-cli-model-section-card').firstElementChild).toHaveClass(
      'px-3',
      'py-2'
    );
    expect(serverPrimaryRow).toHaveClass(
      'md:grid-cols-4',
      'xl:grid-cols-[7rem_minmax(10rem,1fr)_minmax(13rem,1.15fr)_minmax(17rem,1.45fr)]'
    );
    expect(serverCredentialRow).toHaveClass('contents');
    expect(serverPrimaryRow).toHaveClass('gap-2');
    expect(within(serverPrimaryRow).getByText('端口')).toBeInTheDocument();
    const serverFieldLabels = [
      within(serverPrimaryRow).getByText('端口'),
      within(serverPrimaryRow).getByText('上游代理'),
      within(serverCredentialRow).getByText('Base URL'),
      within(serverCredentialRow).getByText('路由 API Key'),
    ];
    serverFieldLabels.forEach(label => {
      expect(label).toHaveClass('mb-0.5', 'text-xs', 'leading-4', 'text-[var(--text-secondary)]');
      expect(label).not.toHaveClass('font-medium', 'text-[var(--text-primary)]');
    });
    const portInput = screen.getByDisplayValue('3000');
    expect(portInput).toHaveAttribute('type', 'text');
    expect(portInput).toHaveAttribute('inputmode', 'numeric');
    expect(portInput).toHaveClass(
      'h-6',
      'rounded',
      'bg-[var(--surface-2)]',
      'px-2',
      'py-1',
      'font-mono',
      'text-xs',
      'leading-4',
      'text-[var(--text-secondary)]'
    );
    const upstreamProxyInput = within(serverPrimaryRow).getByLabelText('上游代理');
    expect(upstreamProxyInput).toBeInTheDocument();
    expect(upstreamProxyInput).toHaveClass(
      'h-6',
      'rounded',
      'bg-[var(--surface-2)]',
      'px-2',
      'py-1',
      'font-mono',
      'text-xs',
      'leading-4',
      'text-[var(--text-secondary)]'
    );
    expect(within(serverCredentialRow).getByText('Base URL')).toBeInTheDocument();
    expect(within(serverCredentialRow).getByText('路由 API Key')).toBeInTheDocument();
    expect(within(serverCredentialRow).getByTestId('route-server-base-url-value')).toHaveClass(
      'h-6',
      'rounded',
      'bg-[var(--surface-2)]',
      'px-2',
      'py-1',
      'font-mono',
      'text-xs',
      'leading-4',
      'text-[var(--text-secondary)]'
    );
    expect(within(serverCredentialRow).getByTestId('route-server-api-key-value')).toHaveClass(
      'h-6',
      'rounded',
      'bg-[var(--surface-2)]',
      'px-2',
      'py-1',
      'font-mono',
      'text-xs',
      'leading-4',
      'text-[var(--text-secondary)]'
    );
    const claudeRouteActions = screen.getByTestId('route-cli-actions-claudeCode');
    const previewClaudeRouteButton = screen.getByRole('button', {
      name: '预览 Claude Code 路由配置',
    });
    const applyClaudeRouteButton = screen.getByRole('button', {
      name: '应用 Claude Code 路由配置',
    });
    expect(claudeRouteActions).toHaveClass('grid', 'grid-cols-2', 'gap-2');
    expect(previewClaudeRouteButton).toHaveClass('h-7', 'w-full', 'min-w-0', 'whitespace-nowrap');
    expect(applyClaudeRouteButton).toHaveClass('h-7', 'w-full', 'min-w-0', 'whitespace-nowrap');
    expect(screen.getByDisplayValue('claude-opus-4-6')).toHaveClass('h-7', 'py-1', 'rounded-md');
    expect(screen.getByDisplayValue('gpt-5.4')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'gpt-4.1' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: 'claude-opus-4-6' }).length).toBeGreaterThan(0);
    expect(screen.getByText('CLI 路由模型选择')).toBeInTheDocument();
    expect(screen.getByText(/应用本地路由后，只需修改此处重定向模型即可/)).toHaveClass(
      'text-[11px]',
      'text-[var(--text-secondary)]'
    );
    const claudeRouteLabel = screen.getByText('Claude Code').closest('label');
    expect(claudeRouteLabel?.querySelector('img[aria-hidden="true"]')).not.toBeNull();
    expect(
      screen.queryByText(/写入 CLI 本地配置时仅生成连接到本地代理的配置/)
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/当 CLI 使用本地应用路由 URL 时/)).not.toBeInTheDocument();
    expect(screen.getByTestId('redirect-two-pane-layout')).toBeInTheDocument();
    expect(screen.getAllByText('claude-opus-4-6').length).toBeGreaterThan(0);
    expect(screen.queryByText('统计已迁移到数据总览')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开数据总览' })).not.toBeInTheDocument();
  }, 15_000);

  it('supports previewing and applying route-generated CLI configs from the proxy panel', async () => {
    render(<RoutePage />);

    fireEvent.click(screen.getByRole('button', { name: '预览 Claude Code 路由配置' }));

    const previewDialog = await screen.findByRole('dialog', { name: 'Claude Code 路由配置预览' });
    expect(within(previewDialog).getByText('~/.claude/settings.json')).toBeInTheDocument();
    expect(within(previewDialog).getByText(/127\.0\.0\.1:3000/)).toBeInTheDocument();
    expect(within(previewDialog).getByText(/sk-route-key/)).toBeInTheDocument();
    expect(within(previewDialog).getByRole('button', { name: '重置' })).toBeInTheDocument();
    expect(within(previewDialog).getByRole('button', { name: '编辑' })).toBeInTheDocument();

    fireEvent.click(within(previewDialog).getByRole('button', { name: '编辑' }));

    const settingsEditor = within(previewDialog).getByRole('textbox', {
      name: '~/.claude/settings.json',
    });
    fireEvent.change(settingsEditor, {
      target: {
        value: (settingsEditor as HTMLTextAreaElement).value.replace(
          'sk-route-key',
          'sk-route-edited'
        ),
      },
    });

    fireEvent.click(within(previewDialog).getByRole('button', { name: '保存' }));
    expect(within(previewDialog).getByText(/sk-route-edited/)).toBeInTheDocument();

    fireEvent.click(within(previewDialog).getByRole('button', { name: '关闭预览' }));

    fireEvent.click(screen.getByRole('button', { name: '应用 Claude Code 路由配置' }));
    const mergeButton = screen.getByRole('button', { name: '合并' });
    expect(mergeButton.parentElement?.parentElement).toBe(document.body);
    fireEvent.click(mergeButton);

    await waitFor(() => {
      expect(mockWriteConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          cliType: 'claudeCode',
          applyMode: 'merge',
        })
      );
    });

    const writtenConfig = mockWriteConfig.mock.calls[0]?.[0];
    const settingsFile = writtenConfig.files.find(
      (file: { path: string; content: string }) => file.path === '~/.claude/settings.json'
    );

    expect(settingsFile?.content).toContain('http://127.0.0.1:3000');
    expect(settingsFile?.content).toContain('sk-route-edited');
    expect(mockClearCache).toHaveBeenCalledWith('claudeCode');
  }, 15_000);

  it('generates Codex and Gemini route configs that target the local route proxy', async () => {
    mockConfig = {
      ...mockConfig,
      cliModelSelections: {
        ...mockConfig.cliModelSelections,
        geminiCli: 'gpt-5.4',
      },
    };

    render(<RoutePage />);

    fireEvent.click(screen.getByRole('button', { name: '预览 Codex 路由配置' }));

    const codexPreview = await screen.findByRole('dialog', { name: 'Codex 路由配置预览' });
    expect(within(codexPreview).getByText('~/.codex/config.toml')).toBeInTheDocument();
    expect(within(codexPreview).getByText('~/.codex/auth.json')).toBeInTheDocument();
    expect(
      within(codexPreview).getByText(/base_url = "http:\/\/127\.0\.0\.1:3000\/v1"/)
    ).toBeInTheDocument();
    expect(within(codexPreview).getByText(/OPENAI_API_KEY/)).toBeInTheDocument();
    expect(within(codexPreview).getByText(/sk-route-key/)).toBeInTheDocument();

    fireEvent.click(within(codexPreview).getByRole('button', { name: '关闭预览' }));

    fireEvent.click(screen.getByRole('button', { name: '预览 Gemini CLI 路由配置' }));

    const geminiPreview = await screen.findByRole('dialog', { name: 'Gemini CLI 路由配置预览' });
    expect(within(geminiPreview).getByText('~/.gemini/settings.json')).toBeInTheDocument();
    expect(within(geminiPreview).getByText('~/.gemini/.env')).toBeInTheDocument();
    expect(
      within(geminiPreview).getByText(/GOOGLE_GEMINI_BASE_URL=http:\/\/127\.0\.0\.1:3000/)
    ).toBeInTheDocument();
    expect(within(geminiPreview).getByText(/GEMINI_API_KEY=sk-route-key/)).toBeInTheDocument();
    expect(within(geminiPreview).getByText(/GEMINI_MODEL=gpt-5\.4/)).toBeInTheDocument();
  });

  it('resets saved route preview edits back to the generated config', async () => {
    render(<RoutePage />);

    fireEvent.click(screen.getByRole('button', { name: '预览 Claude Code 路由配置' }));

    const previewDialog = await screen.findByRole('dialog', { name: 'Claude Code 路由配置预览' });
    fireEvent.click(within(previewDialog).getByRole('button', { name: '编辑' }));

    const settingsEditor = within(previewDialog).getByRole('textbox', {
      name: '~/.claude/settings.json',
    });
    fireEvent.change(settingsEditor, {
      target: {
        value: (settingsEditor as HTMLTextAreaElement).value.replace(
          'sk-route-key',
          'sk-route-edited'
        ),
      },
    });
    fireEvent.click(within(previewDialog).getByRole('button', { name: '保存' }));

    expect(within(previewDialog).getByText(/sk-route-edited/)).toBeInTheDocument();

    fireEvent.click(within(previewDialog).getByRole('button', { name: '重置' }));

    expect(within(previewDialog).queryByText(/sk-route-edited/)).not.toBeInTheDocument();
    expect(within(previewDialog).getByText(/sk-route-key/)).toBeInTheDocument();
  });

  // P0-2: CliUsabilityTab 已合并到 RoutePage，该测试不再需要
  // 相关功能已在 RoutePage 的集成测试中覆盖

  it('renders redirect list and selected detail without vendor grouping', async () => {
    render(<ModelRedirectionTab />);

    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument();
    expect(screen.queryByText('OpenAI')).not.toBeInTheDocument();
    expect(screen.getAllByText('claude-opus-4-6').length).toBeGreaterThan(1);
    expect(screen.getByText('gpt-5.4')).toBeInTheDocument();
    expect(screen.queryByText('gpt-5')).not.toBeInTheDocument();
    const priorityPane = await screen.findByTestId('redirect-detail-priority');
    expect(within(priorityPane).getAllByText(/暂停至/).length).toBeGreaterThan(0);
    expect(priorityPane.querySelector('[title*="60分钟成功率 0%"]')).not.toBeNull();
    expect(screen.queryByTestId('redirect-card-header')).not.toBeInTheDocument();
    expect(screen.getByTestId('redirect-two-pane-layout')).toHaveClass(
      'grid',
      'xl:grid-cols-[minmax(192px,0.448fr)_minmax(0,1.632fr)]'
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
    expect(within(detailActions).getByRole('button', { name: '路由规则' })).toBeInTheDocument();
    expect(
      within(detailActions).getByRole('button', { name: '恢复 claude-opus-4-6 路由路径' })
    ).toBeInTheDocument();
    const editButton = within(detailActions).getByRole('button', {
      name: '编辑 claude-opus-4-6',
    });
    const deleteButton = within(detailActions).getByRole('button', {
      name: '删除 claude-opus-4-6',
    });
    expect(editButton).toHaveClass('h-7', 'w-7');
    expect(deleteButton).toHaveClass('h-7', 'w-7');
    expect(within(detailActions).queryByText(/\d+ 站点/)).not.toBeInTheDocument();

    const originalModelFrame = screen.getByText('claude-opus-4.6-20260201').parentElement;
    expect(originalModelFrame).not.toBeNull();
    const originalModelsList = screen.getByTestId('redirect-detail-original-models');
    const renderedOriginalModels = Array.from(originalModelsList.querySelectorAll('code'));
    expect(renderedOriginalModels.length).toBeGreaterThan(1);
    expect(within(originalModelsList).queryByText(',')).not.toBeInTheDocument();
    expect(within(originalModelsList).queryByText(/暂停至/)).not.toBeInTheDocument();
    expect(originalModelFrame).toHaveClass('border', 'bg-[var(--surface-2)]', 'px-2', 'py-0');
    expect(screen.getByText('claude-opus-4.6-20260201')).toHaveClass('leading-4');
    expect(screen.queryByText('手工新增')).not.toBeInTheDocument();
    expect(screen.queryByText('默认示例')).not.toBeInTheDocument();
    const exampleBadge = screen.getAllByText('示例')[0];
    expect(exampleBadge).toHaveClass(
      'rounded-full',
      'bg-[var(--surface-2)]',
      'px-1.5',
      'py-0.5',
      'text-[11px]',
      'text-[var(--text-secondary)]'
    );
    expect(
      within(priorityPane).queryByText('站点与 API Key 按当前顺序尝试。')
    ).not.toBeInTheDocument();
    expect(
      within(priorityPane).getByRole('button', { name: '保存优先级' }).parentElement
    ).toHaveClass('ml-auto', 'justify-end');
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
      data: [
        createFirstHitRouteLog({
          targetProtocol: 'native',
        }),
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

    const detailActions = screen.getByTestId('redirect-detail-actions');
    const actionLabels = within(detailActions)
      .getAllByRole('button')
      .map(button => button.textContent?.trim())
      .filter(Boolean);
    expect(actionLabels.slice(0, 2)).toEqual(['重置优先命中', '恢复路径']);

    fireEvent.click(
      within(detailActions).getByRole('button', {
        name: '重置 claude-opus-4-6 当前优先命中路径',
      })
    );

    await waitFor(() => {
      expect(mockResetPathStates).toHaveBeenCalledWith({
        routeRuleId: 'rule-claude',
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

  it('filters out legacy seeded display items that are not the default example', () => {
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

    render(<ModelRedirectionTab />);

    expect(await screen.findByText('deepseek-v4-pro')).toBeInTheDocument();
    await findPriorityDetailPane();
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
    const detailActions = screen.getByTestId('redirect-detail-actions');
    fireEvent.click(within(detailActions).getByRole('button', { name: '编辑 gpt-5.4' }));

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
    const detailActions = screen.getByTestId('redirect-detail-actions');
    fireEvent.click(within(detailActions).getByRole('button', { name: '编辑 gpt-5.4' }));

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

  it('shows custom CLI local test results after covered models in priority details', async () => {
    const registry = createModelRegistryConfig();
    const customCliSource = registry.sources.find(source => source.originalModel === 'duckcoding')!;

    mockConfig = {
      ...mockConfig,
      modelRegistry: {
        ...registry,
        entries: {
          ...registry.entries,
          'duckcoding-route': {
            canonicalName: 'duckcoding-route',
            vendor: 'unknown',
            aliases: [customCliSource.originalModel],
            sources: [customCliSource],
            hasOverride: true,
            createdAt: 90,
            updatedAt: 90,
          },
        },
        displayItems: [
          ...registry.displayItems,
          {
            id: 'manual:duckcoding-route',
            vendor: 'unknown',
            canonicalName: 'duckcoding-route',
            sourceKeys: [customCliSource.sourceKey],
            originalModelOrder: [customCliSource.originalModel],
            priorityConfig: {
              sitePriorities: {},
              apiKeyPriorities: {},
            },
            mode: 'manual',
            createdAt: 90,
            updatedAt: 90,
          },
        ],
      },
      cliProbe: {
        ...mockConfig.cliProbe,
        latest: {},
        history: {},
      },
    };
    useCustomCliConfigStore.setState({
      configs: [createCustomCliStoreConfig()],
    });

    render(<ModelRedirectionTab />);
    await screen.findByText('duckcoding-route');
    selectRedirectRow('duckcoding-route');

    const detailPane = await findPriorityDetailPane();

    await waitFor(() => {
      expect(within(detailPane).getByText('直连')).toBeInTheDocument();
      expect(within(detailPane).getByTitle('DuckCoding')).toBeInTheDocument();
      expect(within(detailPane).queryByText('自定义 CLI / DuckCoding')).not.toBeInTheDocument();
      expect(within(detailPane).queryByText(/自定义 CLI \/ custom-cli \/ 倍率/u)).not.toBeInTheDocument();
      expect(
        within(detailPane).getByText('DuckCoding Key（×0.001）')
      ).toBeInTheDocument();
      expect(
        within(detailPane).getByText('duckcoding（↑$2 ↓$4 / 测试通过）')
      ).toBeInTheDocument();
    });
  });

  it('omits failure codes after original model test results in priority details', async () => {
    const claudeProbeKey = buildProbeKey('site-1', 'acc-1', 'claudeCode', 'claude-opus-4-6');
    const latestProbe = mockConfig.cliProbe.latest[claudeProbeKey]!;

    mockConfig = {
      ...mockConfig,
      cliProbe: {
        ...mockConfig.cliProbe,
        latest: {
          ...mockConfig.cliProbe.latest,
          [claudeProbeKey]: {
            ...latestProbe,
            healthy: false,
            lastSample: {
              ...latestProbe.lastSample,
              success: false,
              statusCode: 503,
              error: 'status code 503: upstream unavailable',
              testedAt: 101,
            },
            lastSuccessAt: undefined,
            lastFailureAt: 101,
          },
        },
      },
    };

    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();

    await waitFor(() => {
      expect(
        within(detailPane).getAllByText('claude-opus-4.6-20260201（↑$0.001 ↓$0.002 / 测试失败）')
          .length
      ).toBeGreaterThan(0);
    });
    expect(within(detailPane).queryByText(/HTTP503|错误码\s*503/)).not.toBeInTheDocument();
    expect(within(detailPane).queryByTitle(/HTTP503|错误码\s*503/)).not.toBeInTheDocument();
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

  it('shows grouped site account api key details and missing key reminders in the detail pane', async () => {
    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();
    await waitFor(() => expect(mockRefreshRuntimeState).toHaveBeenCalled());
    const compactList = within(detailPane).getByTestId('priority-detail-compact-list');
    expect(compactList.className).toContain('overflow-hidden');
    expect(compactList.className).not.toContain('rounded');
    expect(compactList.className).not.toContain('border');
    expect(within(detailPane).getByRole('radio', { name: '选择 Claude Site' })).toBeInTheDocument();
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
    expect(within(siteSections[0]!).getByRole('radio', { name: '选择 Claude Site' })).toBeChecked();
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
    expect(
      within(compactList).queryByRole('button', { name: '移到第一个' })
    ).not.toBeInTheDocument();
    expect(within(detailPane).getByRole('button', { name: '移到第一个' })).toBeInTheDocument();
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
    expect(within(detailPane).queryAllByTestId('priority-detail-missing-key-row')).toHaveLength(0);
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
        within(detailPane).getAllByText('claude-opus-4.6-20260201（↑$0.001 ↓$0.002 / 测试通过）')
          .length
      ).toBeGreaterThan(0);
      expect(
        within(detailPane).getByText('claude-haiku-4.5-20251001（↑$1 ↓$3 / 未测试）')
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
  });

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
        routeRuleId: 'rule-claude',
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
    fireEvent.click(within(detailPane).getByRole('button', { name: '移到末尾' }));

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

    fireEvent.click(within(detailPane).getByRole('button', { name: '保存优先级' }));

    await waitFor(() => {
      expect(mockUpsertDisplayItem).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'seeded:claude-opus-4-6',
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
  });

  it('folds a disabled api key and preserves it in saved priority memory', async () => {
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

    fireEvent.click(within(detailPane).getByRole('button', { name: '保存优先级' }));

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

    fireEvent.click(within(disabledMainKeyRow).getByRole('button', { name: 'main-key 启用' }));

    await waitFor(() => {
      const apiKeyRows = within(detailPane).getAllByTestId('priority-detail-api-key-row');
      expect(apiKeyRows[0]).toHaveTextContent('backup-key（Main / team-beta / ×1.50）');
      expect(apiKeyRows[1]).toHaveTextContent('main-key（Main / team-beta / ×1.50）');
      expect(apiKeyRows[2]).toHaveTextContent('backup-site-key（Backup / team-delta / ×2）');
    });
  });

  it('folds a disabled site and preserves its saved priority memory', async () => {
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

    fireEvent.click(within(detailPane).getByRole('button', { name: '保存优先级' }));

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

  it('folds a site and preserves its priority when all of its api keys are disabled', async () => {
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

    fireEvent.click(within(detailPane).getByRole('button', { name: '保存优先级' }));

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

  it('syncs model sources from the list toolbar without rebuilding defaults', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: '同步来源' }));

    await waitFor(() => {
      expect(mockSyncModelRegistrySources).toHaveBeenCalledWith(true);
    });
    expect(mockRebuildModelRegistry).not.toHaveBeenCalled();
  });

  it('deletes a redirect through the selected detail action', async () => {
    render(<ModelRedirectionTab />);

    fireEvent.click(screen.getByRole('button', { name: '删除 claude-opus-4-6' }));

    await waitFor(() => {
      expect(mockDeleteDisplayItem).toHaveBeenCalledWith('seeded:claude-opus-4-6');
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

  it('prefers persisted display items over fallback example derivation', () => {
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

  it('falls back to the single example redirect before the first aggregation', () => {
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

    expect(views.map(view => view.displayName)).toEqual(['claude-opus-4-6']);
    expect(views[0]?.selectedOriginalModels).toEqual(['claude-opus-4.6-20260201']);
    expect(views[0]?.item.priorityConfig).toEqual({
      sitePriorities: {},
      apiKeyPriorities: {},
    });
  });

  it('saves display-order priorities when the detail draft is unchanged', async () => {
    render(<ModelRedirectionTab />);

    const detailPane = await findPriorityDetailPane();

    fireEvent.click(within(detailPane).getByRole('button', { name: '保存优先级' }));

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

    fireEvent.click(screen.getAllByRole('button', { name: '路由规则' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'claude-opus-4-6 路由规则' });

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
    fireEvent.click(within(dialog).getByRole('button', { name: '保存路由规则' }));

    await waitFor(() => {
      expect(mockUpsertDisplayItem).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'seeded:claude-opus-4-6',
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
});
