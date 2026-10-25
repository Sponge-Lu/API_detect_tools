import * as path from 'path';

export type AppStorageBasePath = 'userData' | 'home' | 'temp' | 'localAppData';

export type AppStorageKind =
  | 'stable-config'
  | 'settings'
  | 'runtime-cache'
  | 'runtime-state'
  | 'statistics'
  | 'logs'
  | 'backup'
  | 'sensitive-settings'
  | 'browser-operational-state'
  | 'update-cache';

export type AppStorageMutationPolicy =
  | 'app-managed'
  | 'external-tool-owned'
  | 'protected-do-not-mutate';

export type AppStorageBackupMode =
  | 'lightweight-config'
  | 'full-manifest'
  | 'portable-config'
  | 'explicit-sensitive';

export type RetentionMode =
  | 'none'
  | 'replace-by-key'
  | 'ttl'
  | 'max-items'
  | 'ttl-and-max-items'
  | 'size-cap'
  | 'external-owner';

export interface AppStorageRetentionPolicy {
  mode: RetentionMode;
  rebuildable: boolean;
  dedupeKey?: string;
  ttlDays?: number;
  maxItems?: number;
  maxBytes?: number;
  pruneTrigger: 'never' | 'on-write' | 'scheduled' | 'manual' | 'external-owner';
}

export interface AppStorageBackupPolicy {
  defaultIncluded: boolean;
  modes: AppStorageBackupMode[];
  requiresExplicitInclude?: boolean;
  reason: string;
}

export interface AppStorageEntry {
  databaseTables?: readonly string[];
  id: string;
  kind: AppStorageKind;
  owner: string;
  source: string;
  basePath: AppStorageBasePath;
  pathSegments: string[];
  description: string;
  mutationPolicy: AppStorageMutationPolicy;
  retention: AppStorageRetentionPolicy;
  backup: AppStorageBackupPolicy;
  containsSecrets: boolean;
}

export interface AppStorageRoots {
  userData: string;
  home: string;
  temp: string;
  localAppData?: string;
}

export interface ResolvedAppStorageEntry extends AppStorageEntry {
  absolutePath: string | null;
}

export const APP_STORAGE_MANIFEST_VERSION = 1;

export const APP_STORAGE_ENTRIES: readonly AppStorageEntry[] = [
  {
    id: 'application-database',
    kind: 'stable-config',
    owner: 'ApplicationStorage',
    source: 'Authoritative application data; WAL and SHM are managed by SQLite',
    basePath: 'userData',
    pathSegments: ['storage', 'app.db'],
    description: 'Live database. Export logical documents or use the online snapshot API.',
    mutationPolicy: 'app-managed',
    retention: { mode: 'replace-by-key', rebuildable: false, pruneTrigger: 'never' },
    backup: { defaultIncluded: false, modes: [], reason: 'Never copy an active database file.' },
    containsSecrets: true,
  },
  {
    id: 'client-file-backups',
    kind: 'backup',
    owner: 'ConfigFileBackups',
    source: 'Protected CLI file originals, rotating snapshots, and imported history',
    basePath: 'userData',
    pathSegments: ['backups', 'cli-config'],
    description: 'Encrypted new snapshots; original and imported history are retained.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'max-items',
      rebuildable: false,
      maxItems: 10,
      dedupeKey: 'targetPath/snapshotId',
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: false,
      modes: [],
      reason: 'Separate file rollback history; exclude recursive backups.',
    },
    containsSecrets: true,
  },
  {
    id: 'public-model-metadata',
    kind: 'runtime-cache',
    owner: 'ModelMetadataService',
    source: 'Public models.dev metadata',
    basePath: 'userData',
    pathSegments: ['model-metadata.json'],
    description: 'Rebuildable public metadata; independent of application restore.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'ttl',
      rebuildable: true,
      ttlDays: 1,
      dedupeKey: 'modelId',
      pruneTrigger: 'on-write',
    },
    backup: { defaultIncluded: false, modes: [], reason: 'Rebuilt from public metadata.' },
    containsSecrets: false,
  },
  {
    id: 'stable-config',
    databaseTables: [
      'site_groups',
      'sites',
      'accounts',
      'account_keys',
      'route_rules',
      'rule_sites',
      'rule_accounts',
      'model_redirects',
      'model_exclusions',
      'client_routing',
      'session_choices',
      'document_records',
      'app_preferences',
      'document_metadata',
    ],
    kind: 'stable-config',
    owner: 'UnifiedConfigManager',
    source: 'User-maintained sites, accounts, settings, and stable routing intent',
    basePath: 'userData',
    pathSegments: ['config.json'],
    description:
      'Logical stable configuration backed by storage/app.db. JSON path is an exchange identifier.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'replace-by-key',
      rebuildable: false,
      dedupeKey: 'site.id,account.id,route.rule.id,route.modelRegistry.displayItem.canonicalName',
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: true,
      modes: ['lightweight-config', 'full-manifest', 'portable-config'],
      reason: 'Primary user intent and compatibility config.',
    },
    containsSecrets: true,
  },
  {
    id: 'runtime-detection-cache',
    databaseTables: [
      'detection_cache',
      'site_daily_snapshots',
      'document_metadata',
      'app_preferences',
    ],
    kind: 'runtime-cache',
    owner: 'RuntimeCacheManager',
    source: 'Site/account detection results and overview snapshots',
    basePath: 'userData',
    pathSegments: ['runtime-cache.json'],
    description: 'Logical detection cache backed by storage/app.db.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'ttl-and-max-items',
      rebuildable: true,
      dedupeKey: 'siteId/accountId/snapshotDate',
      ttlDays: 90,
      maxItems: 120,
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: true,
      modes: ['full-manifest'],
      reason: 'Useful for restore continuity, but excluded from lightweight config snapshots.',
    },
    containsSecrets: false,
  },
  {
    id: 'route-runtime-state',
    databaseTables: ['route_runtime', 'document_metadata', 'app_preferences'],
    kind: 'runtime-state',
    owner: 'UnifiedConfigManager route runtime split',
    source: 'Route stats, route path suspension, and channel health',
    basePath: 'userData',
    pathSegments: ['state', 'route-runtime.json'],
    description: 'Logical route runtime state backed by storage/app.db.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'ttl-and-max-items',
      rebuildable: true,
      dedupeKey: 'routeRuleId/siteId/accountId/apiKeyId/canonicalModel/resolvedModel',
      ttlDays: 30,
      maxItems: 5000,
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: true,
      modes: ['full-manifest'],
      reason: 'Runtime continuity only; never part of lightweight stable config backup.',
    },
    containsSecrets: false,
  },
  {
    id: 'route-endpoint-test-state',
    databaseTables: ['document_records', 'document_metadata', 'app_preferences'],
    kind: 'runtime-state',
    owner: 'EndpointTestService',
    source: 'Per-target endpoint selections and latest manual test results',
    basePath: 'userData',
    pathSegments: ['state', 'route-endpoint-tests.json'],
    description: 'Latest manual endpoint test state, separate from stable configuration.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'ttl-and-max-items',
      rebuildable: true,
      dedupeKey: 'targetKey/protocol',
      maxItems: 5000,
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: true,
      modes: ['full-manifest'],
      reason: 'Diagnostics continuity only; never part of lightweight stable config backup.',
    },
    containsSecrets: false,
  },
  {
    id: 'route-analytics-state',
    databaseTables: ['route_analytics_buckets', 'document_metadata', 'app_preferences'],
    kind: 'statistics',
    owner: 'RouteAnalyticsService',
    source: 'Route analytics buckets; request logs stay memory-only',
    basePath: 'userData',
    pathSegments: ['state', 'route-analytics.json'],
    description: 'Logical analytics document backed by indexed SQLite buckets.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'ttl-and-max-items',
      rebuildable: true,
      dedupeKey: 'bucketKey',
      ttlDays: 30,
      maxItems: 50000,
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: true,
      modes: ['full-manifest'],
      reason: 'Analytics continuity only; never part of lightweight stable config backup.',
    },
    containsSecrets: false,
  },
  {
    id: 'model-registry-source-state',
    databaseTables: [
      'route_model_sources',
      'document_records',
      'document_metadata',
      'app_preferences',
    ],
    kind: 'runtime-state',
    owner: 'RouteModelRegistryService',
    source: 'Model registry source snapshots rebuilt from site/account/custom CLI sources',
    basePath: 'userData',
    pathSegments: ['state', 'route-model-sources.json'],
    description: 'Rebuildable model source rows in storage/app.db.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'max-items',
      rebuildable: true,
      dedupeKey: 'sourceKey',
      maxItems: 20000,
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: false,
      modes: [],
      reason: 'Rebuildable from current sites, accounts, and custom CLI configs.',
    },
    containsSecrets: false,
  },
  {
    id: 'theme-settings',
    databaseTables: ['app_preferences', 'document_metadata'],
    kind: 'settings',
    owner: 'theme handlers',
    source: 'Renderer theme selection',
    basePath: 'userData',
    pathSegments: ['theme-settings.json'],
    description: 'Theme preference settings.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'replace-by-key',
      rebuildable: false,
      dedupeKey: 'themeMode',
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: true,
      modes: ['full-manifest'],
      reason: 'User preference.',
    },
    containsSecrets: false,
  },
  {
    id: 'close-behavior-settings',
    databaseTables: ['app_preferences', 'document_metadata'],
    kind: 'settings',
    owner: 'CloseBehaviorManager',
    source: 'Window close behavior preference',
    basePath: 'userData',
    pathSegments: ['close-behavior-settings.json'],
    description: 'Window close behavior settings.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'replace-by-key',
      rebuildable: false,
      dedupeKey: 'closeBehavior',
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: true,
      modes: ['full-manifest'],
      reason: 'User preference.',
    },
    containsSecrets: false,
  },
  {
    id: 'update-settings',
    databaseTables: ['app_preferences', 'document_metadata'],
    kind: 'settings',
    owner: 'UpdateService',
    source: 'Update preference and update state',
    basePath: 'userData',
    pathSegments: ['update-settings.json'],
    description: 'Update behavior settings.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'replace-by-key',
      rebuildable: false,
      dedupeKey: 'settingsVersion',
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: true,
      modes: ['full-manifest'],
      reason: 'User preference.',
    },
    containsSecrets: false,
  },
  {
    id: 'custom-cli-configs',
    databaseTables: [
      'custom_cli_configs',
      'custom_cli_keys',
      'app_preferences',
      'document_metadata',
    ],
    kind: 'sensitive-settings',
    owner: 'CustomCliConfigService',
    source: 'User-defined OpenAI-compatible CLI endpoints and API keys',
    basePath: 'userData',
    pathSegments: ['custom-cli-configs.json'],
    description:
      'Direct CLI configs. Disk writes encrypt apiKey field-level; backups include the encrypted file as-is.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'replace-by-key',
      rebuildable: false,
      dedupeKey: 'config.id',
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: true,
      modes: ['full-manifest', 'portable-config'],
      reason:
        'User direct CLI endpoints/keys travel with portable/full-manifest backups; apiKey stays field-encrypted on disk.',
    },
    containsSecrets: true,
  },
  {
    id: 'config-file-profiles',
    databaseTables: [
      'config_file_profiles',
      'profile_files',
      'document_metadata',
      'app_preferences',
    ],
    kind: 'settings',
    owner: 'ConfigFileProfileService',
    source: 'User-defined client configuration file profiles and templates',
    basePath: 'userData',
    pathSegments: ['config-file-profiles.json'],
    description: 'Client file paths, templates, replacement tokens, and target references.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'replace-by-key',
      rebuildable: false,
      dedupeKey: 'profile.id',
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: true,
      modes: ['full-manifest', 'portable-config'],
      reason: 'User-authored configuration profiles should travel with configuration backups.',
    },
    containsSecrets: true,
  },
  {
    id: 'route-state-affinity',
    databaseTables: ['response_affinity', 'document_metadata', 'app_preferences'],
    kind: 'settings',
    owner: 'RouteStateAffinityService',
    source: 'Provider-owned Responses and Conversations resource affinity',
    basePath: 'userData',
    pathSegments: ['state', 'route-state-affinity.json'],
    description: 'Resource IDs mapped to stable profile and exact route channel identifiers.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'ttl-and-max-items',
      rebuildable: false,
      dedupeKey: 'resourceId',
      ttlDays: 30,
      maxItems: 5000,
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: true,
      modes: ['full-manifest'],
      reason: 'Stateful provider resources require affinity across application restarts.',
    },
    containsSecrets: false,
  },
  {
    id: 'route-session-activity',
    databaseTables: ['session_activity', 'document_metadata', 'app_preferences'],
    kind: 'runtime-state',
    owner: 'RouteSessionActivityService',
    source: 'High-frequency RouteInstance last-request timestamps',
    basePath: 'userData',
    pathSegments: ['state', 'route-session-activity.json'],
    description: 'Coalesced RouteInstance activity kept outside stable routing configuration.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'ttl-and-max-items',
      rebuildable: true,
      dedupeKey: 'instanceId',
      ttlDays: 30,
      maxItems: 5000,
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: true,
      modes: ['full-manifest'],
      reason: 'Preserves recent-session ordering without entering stable configuration backups.',
    },
    containsSecrets: false,
  },
  {
    id: 'route-session-bindings',
    kind: 'runtime-state',
    owner: 'RouteSessionBindingService',
    source: 'Recent session to exact channel bindings',
    basePath: 'userData',
    pathSegments: ['state', 'route-session-bindings.json'],
    databaseTables: ['session_bindings'],
    description: 'Logical exchange document; persisted in storage/app.db.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'ttl-and-max-items',
      rebuildable: true,
      dedupeKey: 'instanceId',
      ttlDays: 0.5,
      maxItems: 5000,
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: true,
      modes: ['full-manifest'],
      reason: 'Recent session continuity; reset when missing from a full restore.',
    },
    containsSecrets: false,
  },
  {
    id: 'main-logs',
    kind: 'logs',
    owner: 'Logger',
    source: 'electron-log main process log files',
    basePath: 'userData',
    pathSegments: ['logs'],
    description: 'Application logs. No redaction behavior changes are part of this task.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'size-cap',
      rebuildable: true,
      maxBytes: 5 * 1024 * 1024,
      pruneTrigger: 'external-owner',
    },
    backup: {
      defaultIncluded: false,
      modes: [],
      reason: 'Diagnostics are optional and should not bloat backups by default.',
    },
    containsSecrets: true,
  },
  {
    id: 'local-config-backups',
    kind: 'backup',
    owner: 'BackupManager',
    source: 'Local lightweight snapshots and future manifest bundles',
    basePath: 'home',
    pathSegments: ['.api-hub-management-tools'],
    description: 'Local backup directory preserved outside app uninstall data.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'max-items',
      rebuildable: false,
      dedupeKey: 'backup.contentHash',
      maxItems: 10,
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: false,
      modes: [],
      reason: 'Backups must not recursively include themselves.',
    },
    containsSecrets: true,
  },
  {
    id: 'persistent-browser-profiles',
    kind: 'browser-operational-state',
    owner: 'BrowserProfileManager',
    source: 'Persistent per-account browser profiles',
    basePath: 'userData',
    pathSegments: ['browser-profiles'],
    description:
      'Protected multi-account browser state; do not migrate, delete, compact, or back up by default.',
    mutationPolicy: 'protected-do-not-mutate',
    retention: {
      mode: 'external-owner',
      rebuildable: false,
      pruneTrigger: 'external-owner',
    },
    backup: {
      defaultIncluded: false,
      modes: [],
      reason: 'Protected browser operational state is explicitly out of mutation scope.',
    },
    containsSecrets: true,
  },
  {
    id: 'temp-main-browser-profile',
    kind: 'browser-operational-state',
    owner: 'ChromeManager',
    source: 'Temporary shared Chrome user data directory',
    basePath: 'temp',
    pathSegments: ['api-detector-chrome'],
    description: 'Protected browser operational state; do not clean in this task.',
    mutationPolicy: 'protected-do-not-mutate',
    retention: {
      mode: 'external-owner',
      rebuildable: false,
      pruneTrigger: 'external-owner',
    },
    backup: {
      defaultIncluded: false,
      modes: [],
      reason: 'Protected browser operational state is explicitly out of mutation scope.',
    },
    containsSecrets: true,
  },
  {
    id: 'temp-login-browser-profile',
    kind: 'browser-operational-state',
    owner: 'ChromeManager',
    source: 'Temporary login Chrome user data directory',
    basePath: 'temp',
    pathSegments: ['api-detector-chrome-login'],
    description: 'Protected browser operational state; do not clean in this task.',
    mutationPolicy: 'protected-do-not-mutate',
    retention: {
      mode: 'external-owner',
      rebuildable: false,
      pruneTrigger: 'external-owner',
    },
    backup: {
      defaultIncluded: false,
      modes: [],
      reason: 'Protected browser operational state is explicitly out of mutation scope.',
    },
    containsSecrets: true,
  },
  {
    id: 'temp-isolated-browser-profiles',
    kind: 'browser-operational-state',
    owner: 'ChromeManager',
    source: 'Temporary isolated Chrome profile directories',
    basePath: 'temp',
    pathSegments: ['api-detector-chrome-isolated-*'],
    description: 'Protected browser operational state; do not clean in this task.',
    mutationPolicy: 'protected-do-not-mutate',
    retention: {
      mode: 'external-owner',
      rebuildable: false,
      pruneTrigger: 'external-owner',
    },
    backup: {
      defaultIncluded: false,
      modes: [],
      reason: 'Protected browser operational state is explicitly out of mutation scope.',
    },
    containsSecrets: true,
  },
  {
    id: 'updater-cache',
    kind: 'update-cache',
    owner: 'UpdateService/electron-updater',
    source: 'Downloaded update packages and updater metadata',
    basePath: 'localAppData',
    pathSegments: ['api-hub-management-tools-updater'],
    description: 'Rebuildable updater cache outside userData.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'ttl-and-max-items',
      rebuildable: true,
      dedupeKey: 'update.version/artifactName',
      ttlDays: 14,
      maxItems: 5,
      pruneTrigger: 'scheduled',
    },
    backup: {
      defaultIncluded: false,
      modes: [],
      reason: 'Downloaded updates are rebuildable and should not enter backups.',
    },
    containsSecrets: false,
  },
] as const;

export function resolveAppStorageEntryPath(
  entry: AppStorageEntry,
  roots: AppStorageRoots
): string | null {
  const root = roots[entry.basePath];

  if (!root) {
    return null;
  }

  return path.join(root, ...entry.pathSegments);
}

export function resolveAppStorageManifest(roots: AppStorageRoots): ResolvedAppStorageEntry[] {
  return APP_STORAGE_ENTRIES.map(entry => ({
    ...entry,
    absolutePath: resolveAppStorageEntryPath(entry, roots),
  }));
}

export function findAppStorageEntry(entryId: string): AppStorageEntry | undefined {
  return APP_STORAGE_ENTRIES.find(entry => entry.id === entryId);
}

export function getAppStorageEntriesByKind(kind: AppStorageKind): AppStorageEntry[] {
  return APP_STORAGE_ENTRIES.filter(entry => entry.kind === kind);
}
