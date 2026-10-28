import type { Config } from './renderer-config';
import type {
  SiteConfig,
  DetectionResult,
  AccountBrowserProfileOptions,
  BrowserProfileOption,
  BrowserProfileOptionId,
  SiteDailySnapshot,
} from './site';
import type {
  RouteAnalyticsOverview,
  RouteAnalyticsObjectStatsItem,
  RouteAnalyticsObjectStatsQuery,
  RouteAnalyticsWindowQuery,
  RouteHistoryBucketsQuery,
  HistoryEndpointTrack,
  RoutePathStateResetParams,
  RouteRequestLogItem,
  RouteRequestLogQuery,
  RouteStateAffinitySummary,
  RouteSessionActivity,
  RouteSessionCandidate,
  RouteSessionExtractionRule,
  RouteSessionOverride,
  RouteSessionRoutingConfig,
  RouteInstance,
  RouteInstanceUpdate,
} from './route-proxy';
import type {
  EndpointTestResult,
  EndpointTestSelectionInput,
  EndpointTestSelectionState,
  EndpointTestStateView,
  EndpointTestTarget,
} from './endpoint-test';
import type { ThemeMode } from '../theme/themePresets';
import type {
  ConfigFileBackupInput,
  PreviewConfigFileBackupRestoreInput,
  CommitConfigFileProfileInput,
  ConfigFileTargetCatalogEntry,
  ConfigFileResolvedTargetValues,
  ConfigFilePreviewTransaction,
  ConfigFileProfile,
  ConfigFileSnapshot,
  ConfigFileBackup,
  ConfigSessionRecordScanResult,
  DeleteConfigFileProfileInput,
  GenerateConfigFileProfileRouteKeyInput,
  PreviewConfigFileDirectEditInput,
  PreviewConfigFileProfileInput,
  PreviewConfigFileProfileRouteKeyRotationInput,
  RestoreBuiltinConfigFileProfileInput,
  SwitchBuiltinConfigFileProfileAuthModeInput,
  ResolveConfigFileProfileValuesInput,
  UpsertConfigFileProfileInput,
  ValidateSessionRecordConnectorInput,
} from './config-file-profile';

export interface ElectronAPI {
  loadConfig: () => Promise<Config>;
  saveConfig: (config: Config) => Promise<Config | void>;
  sites?: {
    add: (site: SiteConfig) => Promise<{ success: boolean; data?: SiteConfig; error?: string }>;
    update: (
      id: string,
      updates: Partial<SiteConfig>
    ) => Promise<{ success: boolean; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
  };
  launchChromeForLogin: (url: string) => Promise<{ success: boolean; message: string }>;
  closeBrowser: () => Promise<void>;
  closeLoginBrowser: () => Promise<void>;
  appData?: {
    onChanged: (
      callback: (payload: {
        domains: Array<'site-config' | 'site-overview' | 'route-overview' | 'config-file-profiles'>;
        emittedAt: number;
        restored?: boolean;
        generation?: string;
      }) => void
    ) => () => void;
  };
  fetchWithCookies: (
    url: string,
    options: any
  ) => Promise<{ ok: boolean; status: number; statusText: string; data: any }>;
  detectSite: (
    site: SiteConfig,
    timeout: number,
    quickRefresh?: boolean,
    cachedData?: DetectionResult,
    forceAcceptEmpty?: boolean,
    accountId?: string
  ) => Promise<DetectionResult>;
  openUrl: (url: string) => Promise<void>;
  getAllAccounts: () => Promise<any[]>;
  token?: any;
  storage?: any;
  theme?: {
    save: (themeMode: ThemeMode) => Promise<{ success: boolean }>;
    load: () => Promise<{ success: boolean; data?: ThemeMode }>;
  };
  webdav?: {
    testConnection: (config: any) => Promise<{ success: boolean; error?: string }>;
    saveConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
    getConfig: () => Promise<{ success: boolean; data?: any; error?: string }>;
    listBackups: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
    uploadBackup: () => Promise<{ success: boolean; data?: string; error?: string }>;
    restoreBackup: (filename: string) => Promise<{ success: boolean; error?: string }>;
    deleteBackup: (filename: string) => Promise<{ success: boolean; error?: string }>;
  };
  backup?: {
    list: () => Promise<any[]>;
    exportPackage?: () => Promise<{
      success: boolean;
      data?: { filename: string; content: string; kind: string; mode?: string };
      error?: string;
    }>;
    importPackage?: (content: string) => Promise<{
      success: boolean;
      data?: {
        kind: 'storage-bundle' | 'legacy-config';
        mode?: string;
        restoredFiles: string[];
        reconcile?: { reboundAccounts: number; createdSlots: number };
      };
      error?: string;
    }>;
  };
  update?: {
    check: () => Promise<{
      hasUpdate: boolean;
      hasPreReleaseUpdate: boolean;
      currentVersion: string;
      latestVersion: string;
      latestPreReleaseVersion?: string;
      releaseInfo?: {
        version: string;
        releaseDate: string;
        releaseNotes: string;
        downloadUrl: string;
        htmlUrl: string;
        isPreRelease: boolean;
      };
      preReleaseInfo?: {
        version: string;
        releaseDate: string;
        releaseNotes: string;
        downloadUrl: string;
        htmlUrl: string;
        isPreRelease: boolean;
      };
    }>;
    getCurrentVersion: () => Promise<string>;
    openDownload: (url: string) => Promise<void>;
    getSettings: () => Promise<{
      autoCheckEnabled: boolean;
      includePreRelease: boolean;
      lastCheckTime?: string;
    }>;
    saveSettings: (settings: {
      autoCheckEnabled: boolean;
      includePreRelease: boolean;
      lastCheckTime?: string;
    }) => Promise<void>;
    startDownload: (url: string) => Promise<string>;
    cancelDownload: () => Promise<void>;
    installUpdate: (filePath: string) => Promise<void>;
    onDownloadProgress: (
      callback: (progress: {
        percent: number;
        transferred: number;
        total: number;
        speed: number;
      }) => void
    ) => () => void;
  };
  cliCompat: {
    saveConfig: (
      siteUrl: string,
      config: any,
      accountId?: string
    ) => Promise<{ success: boolean; error?: string }>;
    writeConfig: (params: {
      cliType: 'claudeCode' | 'codex' | 'openCode' | 'grokBuild';
      files: Array<{
        path: string;
        content: string;
      }>;
      applyMode?: 'merge' | 'overwrite';
    }) => Promise<{ success: boolean; writtenPaths: string[]; error?: string }>;
  };
  configDetection: {
    detectCliConfig: (
      cliType: 'claudeCode' | 'codex' | 'openCode' | 'grokBuild',
      sites: Array<{ id: string; name: string; url: string }>
    ) => Promise<any>;
    detectAllCliConfig: (
      sites: Array<{ id: string; name: string; url: string }>
    ) => Promise<import('./config-detection').AllCliDetectionResult>;
    clearCache: (cliType?: 'claudeCode' | 'codex' | 'openCode' | 'grokBuild') => Promise<void>;
    resetCliConfig: (cliType: 'claudeCode' | 'codex' | 'openCode' | 'grokBuild') => Promise<{
      success: boolean;
      deletedPaths: string[];
      error?: string;
    }>;
    readCliConfigFiles: (cliType: 'claudeCode' | 'codex' | 'openCode' | 'grokBuild') => Promise<{
      success: boolean;
      files: Array<{
        key: string;
        relativePath: string;
        absolutePath: string;
        content: string | null;
        exists: boolean;
      }>;
      error?: string;
    }>;
    saveCliConfigFile: (
      absolutePath: string,
      content: string
    ) => Promise<{
      success: boolean;
      error?: string;
    }>;
  };
  closeBehavior?: {
    getSettings: () => Promise<{
      success: boolean;
      data?: { behavior: 'ask' | 'quit' | 'minimize' };
      error?: string;
    }>;
    saveSettings: (settings: {
      behavior: 'ask' | 'quit' | 'minimize';
    }) => Promise<{ success: boolean; error?: string }>;
    onShowDialog: (callback: () => void) => () => void;
    respondToDialog: (response: {
      action: 'quit' | 'minimize';
      remember: boolean;
    }) => Promise<{ success: boolean; error?: string }>;
    minimizeToTray: () => Promise<{ success: boolean; error?: string }>;
    quitApp: () => Promise<{ success: boolean; error?: string }>;
  };
  accounts?: {
    list: (siteId: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    add: (data: {
      site_id: string;
      account_name: string;
      user_id: string;
      username?: string;
      access_token: string;
      api_key?: string;
      auth_source: string;
      browser_profile_path?: string;
      automation_slot?: number;
      anyRouterConfig?: { userHash?: string };
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    update: (
      accountId: string,
      updates: {
        account_name?: string;
        access_token?: string;
        api_key?: string;
        user_id?: string;
        auto_refresh?: boolean;
        auto_refresh_interval?: number;
        anyRouterConfig?: { userHash?: string };
      }
    ) => Promise<{ success: boolean; error?: string }>;
    delete: (accountId: string) => Promise<{ success: boolean; error?: string }>;
  };
  browserProfile?: {
    detect: () => Promise<{ success: boolean; data?: string | null; error?: string }>;
    isChromeRunning: () => Promise<{ success: boolean; data?: boolean; error?: string }>;
    listAccountOptions: (
      siteId: string,
      accountId: string
    ) => Promise<{
      success: boolean;
      data?: AccountBrowserProfileOptions;
      error?: string;
    }>;
    bindAccount: (
      siteId: string,
      accountId: string,
      optionId: BrowserProfileOptionId
    ) => Promise<{ success: boolean; data?: BrowserProfileOption; error?: string }>;
    loginMain: (siteUrl: string) => Promise<{
      success: boolean;
      data?: {
        userId: number;
        username: string;
        accessToken: string;
        authSource: 'main_profile';
      };
      error?: string;
    }>;
    loginIsolated: (
      siteId: string,
      siteUrl: string,
      accountId: string
    ) => Promise<{
      success: boolean;
      data?: {
        userId: number;
        username: string;
        accessToken: string;
        authSource: 'isolated_profile';
        profilePath: string;
      };
      error?: string;
    }>;
    openSite: (
      siteId: string | undefined,
      siteUrl: string,
      accountId?: string
    ) => Promise<{ success: boolean; message?: string; error?: string }>;
    openSiteForCheckin: (
      siteId: string | undefined,
      siteUrl: string,
      accountId?: string
    ) => Promise<{ success: boolean; message?: string; error?: string }>;
    persistCheckinCompletion: (
      siteId: string | undefined,
      accountId: string | undefined,
      cachedData: {
        last_refresh?: number;
        has_checkin?: boolean;
        can_check_in?: boolean;
        checkin_stats?: {
          today_quota?: number;
          checkin_count?: number;
          total_checkins?: number;
          site_type?: 'veloera' | 'newapi';
        };
      }
    ) => Promise<{ success: boolean; error?: string }>;
    deleteProfile: (
      siteId: string,
      accountId: string
    ) => Promise<{ success: boolean; error?: string }>;
  };
  endpointTest?: {
    getState: (
      target: EndpointTestTarget
    ) => Promise<{ success: boolean; data?: EndpointTestStateView; error?: string }>;
    saveSelection: (
      input: EndpointTestSelectionInput
    ) => Promise<{ success: boolean; data?: EndpointTestSelectionState; error?: string }>;
    run: (
      input: EndpointTestSelectionInput
    ) => Promise<{ success: boolean; data?: EndpointTestResult; error?: string }>;
  };
  configFileProfiles: {
    load: () => Promise<ConfigFileProfile[]>;
    upsert: (input: UpsertConfigFileProfileInput) => Promise<ConfigFileProfile>;
    delete: (input: DeleteConfigFileProfileInput) => Promise<void>;
    generateRouteKey: (input: GenerateConfigFileProfileRouteKeyInput) => Promise<ConfigFileProfile>;
    getTargetCatalog: () => Promise<ConfigFileTargetCatalogEntry[]>;
    resolveValues: (
      input: ResolveConfigFileProfileValuesInput
    ) => Promise<ConfigFileResolvedTargetValues>;
    restoreBuiltin: (input: RestoreBuiltinConfigFileProfileInput) => Promise<ConfigFileProfile>;
    restoreMissingBuiltins: () => Promise<ConfigFileProfile[]>;
    switchAuthMode: (
      input: SwitchBuiltinConfigFileProfileAuthModeInput
    ) => Promise<ConfigFileProfile>;
    readFiles: (profileId: string) => Promise<ConfigFileSnapshot[]>;
    listBackups: (input: ConfigFileBackupInput) => Promise<ConfigFileBackup[]>;
    previewBackupRestore: (
      input: PreviewConfigFileBackupRestoreInput
    ) => Promise<ConfigFilePreviewTransaction>;
    preview: (input: PreviewConfigFileProfileInput) => Promise<ConfigFilePreviewTransaction>;
    previewRouteKeyRotation: (
      input: PreviewConfigFileProfileRouteKeyRotationInput
    ) => Promise<ConfigFilePreviewTransaction>;
    previewDirectEdit: (
      input: PreviewConfigFileDirectEditInput
    ) => Promise<ConfigFilePreviewTransaction>;
    commit: (input: CommitConfigFileProfileInput) => Promise<void>;
    validateSessionRecord: (
      input: ValidateSessionRecordConnectorInput
    ) => Promise<ConfigSessionRecordScanResult>;
  };
  route?: {
    getConfig: () => Promise<{ success: boolean; data?: any; error?: string }>;
    saveServerConfig: (updates: any) => Promise<{ success: boolean; error?: string }>;
    listRules: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
    upsertRule: (rule: any) => Promise<{ success: boolean; data?: any; error?: string }>;
    deleteRule: (ruleId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    listStats: () => Promise<{ success: boolean; data?: any; error?: string }>;
    resetStats: (ruleId?: string) => Promise<{ success: boolean; error?: string }>;
    resetPathStates: (
      params?: RoutePathStateResetParams
    ) => Promise<{ success: boolean; data?: { cleared: number }; error?: string }>;
    getRuntimeStatus: () => Promise<{ success: boolean; data?: any; error?: string }>;
    startServer: () => Promise<{ success: boolean; error?: string }>;
    stopServer: () => Promise<{ success: boolean; error?: string }>;
    regenerateApiKey: () => Promise<{ success: boolean; data?: any; error?: string }>;
    getModelRegistry: () => Promise<{ success: boolean; data?: any; error?: string }>;
    refreshModelMetadata: () => Promise<{ success: boolean; error?: string }>;
    onModelMetadataUpdated: (callback: () => void) => () => void;
    rebuildModelRegistry: (params?: {
      force?: boolean;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    syncModelRegistrySources: (params?: {
      force?: boolean;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    upsertModelMappingOverride: (
      override: any
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    upsertModelDisplayItem: (
      displayItem: any
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    deleteModelDisplayItem: (
      displayItemId: string
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    deleteModelMappingOverride: (
      overrideId: string
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    saveCliModelSelections: (selections: any) => Promise<{ success: boolean; error?: string }>;
    saveCliThinkingEffortSelections: (
      selections: any
    ) => Promise<{ success: boolean; error?: string }>;
    listSessions?: (scope?: 'active' | 'recent' | 'history' | 'all') => Promise<{
      success: boolean;
      data?: RouteSessionActivity[];
      error?: string;
    }>;
    updateClientRouting?: (
      profileId: string,
      updates: Partial<import('./route-proxy').RouteClientRoutingConfig>
    ) => Promise<{
      success: boolean;
      data?: import('./route-proxy').RouteClientRoutingConfig;
      error?: string;
    }>;
    upsertGlobalModelRoute?: (
      id: string | undefined,
      updates: Partial<Omit<import('./route-proxy').GlobalModelRoute, 'id'>>
    ) => Promise<{
      success: boolean;
      data?: import('./route-proxy').GlobalModelRoute;
      error?: string;
    }>;
    deleteGlobalModelRoute?: (id: string) => Promise<{
      success: boolean;
      data?: boolean;
      error?: string;
    }>;
    listRouteInstances?: () => Promise<{
      success: boolean;
      data?: RouteInstance[];
      error?: string;
    }>;
    createArmedRouteInstance?: (input: {
      modelId?: string;
      reasoningEffort?: string;
    }) => Promise<{ success: boolean; data?: RouteInstance; error?: string }>;
    updateRouteInstance?: (
      instanceId: string,
      updates: RouteInstanceUpdate
    ) => Promise<{ success: boolean; data?: RouteInstance; error?: string }>;
    closeRouteInstance?: (
      instanceId: string
    ) => Promise<{ success: boolean; data?: RouteInstance; error?: string }>;
    cancelArmedRouteInstance?: (
      instanceId: string
    ) => Promise<{ success: boolean; data?: RouteInstance; error?: string }>;
    archiveRouteInstance?: (
      instanceId: string
    ) => Promise<{ success: boolean; data?: { archived: boolean }; error?: string }>;
    restoreRouteInstance?: (
      instanceId: string
    ) => Promise<{ success: boolean; data?: RouteInstance; error?: string }>;
    upsertSessionOverride?: (
      override: RouteSessionOverride
    ) => Promise<{ success: boolean; data?: RouteSessionOverride; error?: string }>;
    deleteSessionOverride?: (
      key: string
    ) => Promise<{ success: boolean; data?: { deleted: boolean }; error?: string }>;
    previewProfileStateClear?: (profileId: string) => Promise<{
      success: boolean;
      data?: RouteStateAffinitySummary;
      error?: string;
    }>;
    clearProfileState?: (profileId: string) => Promise<{
      success: boolean;
      data?: { removed: number };
      error?: string;
    }>;
    clearSessionActivity?: (key?: string) => Promise<{ success: boolean; error?: string }>;
    listSessionRules?: () => Promise<{
      success: boolean;
      data?: RouteSessionExtractionRule[];
      error?: string;
    }>;
    upsertSessionRule?: (
      rule: RouteSessionExtractionRule
    ) => Promise<{ success: boolean; data?: RouteSessionExtractionRule; error?: string }>;
    deleteSessionRule?: (
      ruleId: string
    ) => Promise<{ success: boolean; data?: { deleted: boolean }; error?: string }>;
    rollbackSessionRule?: (
      ruleId: string,
      version: number
    ) => Promise<{ success: boolean; data?: RouteSessionExtractionRule; error?: string }>;
    listSessionCandidates?: () => Promise<{
      success: boolean;
      data?: RouteSessionCandidate[];
      error?: string;
    }>;
    updateSessionSettings?: (
      settings: Partial<
        Pick<
          RouteSessionRoutingConfig,
          | 'activeWindowMinutes'
          | 'recentWindowHours'
          | 'historyRetentionDays'
          | 'overrideRetentionDays'
        >
      >
    ) => Promise<{ success: boolean; error?: string }>;
    getAnalyticsSummary: (
      params: RouteAnalyticsWindowQuery
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    getAnalyticsDistribution: (
      params: RouteAnalyticsWindowQuery
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    getAnalyticsOverview?: (
      params: RouteAnalyticsWindowQuery
    ) => Promise<{ success: boolean; data?: RouteAnalyticsOverview; error?: string }>;
    getObjectStats: (
      params: RouteAnalyticsObjectStatsQuery
    ) => Promise<{ success: boolean; data?: RouteAnalyticsObjectStatsItem[]; error?: string }>;
    resetAnalytics: (params?: any) => Promise<{ success: boolean; error?: string }>;
    getRequestLogs: (
      params?: RouteRequestLogQuery
    ) => Promise<{ success: boolean; data?: RouteRequestLogItem[]; error?: string }>;
    clearRequestLogs: () => Promise<{ success: boolean; error?: string }>;
    getHistoryBuckets: (
      query: RouteHistoryBucketsQuery
    ) => Promise<{ success: boolean; data?: HistoryEndpointTrack[]; error?: string }>;
    onRequestLogAppended?: (callback: (item: RouteRequestLogItem) => void) => () => void;
    fetchLatestLog: (params: {
      siteId: string;
      model?: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
  };
  overview?: {
    getSiteDailySnapshots: (params?: { siteId?: string; days?: number }) => Promise<{
      success: boolean;
      data?: Record<string, SiteDailySnapshot[]>;
      error?: string;
    }>;
  };
}
