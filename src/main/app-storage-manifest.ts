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

export type AppStorageBackupMode = 'lightweight-config' | 'full-manifest' | 'explicit-sensitive';

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
    id: 'stable-config',
    kind: 'stable-config',
    owner: 'UnifiedConfigManager',
    source: 'User-maintained sites, accounts, settings, and stable routing intent',
    basePath: 'userData',
    pathSegments: ['config.json'],
    description: 'Stable configuration file. Runtime/cache payloads must not grow here.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'replace-by-key',
      rebuildable: false,
      dedupeKey: 'site.id,account.id,route.rule.id,route.modelRegistry.displayItem.canonicalName',
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: true,
      modes: ['lightweight-config', 'full-manifest'],
      reason: 'Primary user intent and compatibility config.',
    },
    containsSecrets: true,
  },
  {
    id: 'runtime-detection-cache',
    kind: 'runtime-cache',
    owner: 'RuntimeCacheManager',
    source: 'Site/account detection results and overview snapshots',
    basePath: 'userData',
    pathSegments: ['runtime-cache.json'],
    description: 'Current runtime cache location kept for compatibility during the storage split.',
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
    kind: 'runtime-state',
    owner: 'UnifiedConfigManager route runtime split',
    source: 'Route stats, route path suspension, and channel health',
    basePath: 'userData',
    pathSegments: ['state', 'route-runtime.json'],
    description: 'Target file for route runtime state after it is removed from config.json.',
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
    id: 'route-probe-state',
    kind: 'runtime-state',
    owner: 'RouteCliProbeService',
    source: 'CLI probe latest snapshots and bounded probe history',
    basePath: 'userData',
    pathSegments: ['state', 'route-probes.json'],
    description: 'Target file for CLI probe diagnostics after route runtime split.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'ttl-and-max-items',
      rebuildable: true,
      dedupeKey: 'probeKey/sampleId',
      ttlDays: 30,
      maxItems: 10000,
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
    kind: 'statistics',
    owner: 'RouteAnalyticsService',
    source: 'Route analytics buckets; request logs stay memory-only',
    basePath: 'userData',
    pathSegments: ['state', 'route-analytics.json'],
    description: 'Target file for durable analytics buckets after route runtime split.',
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
    kind: 'runtime-state',
    owner: 'RouteModelRegistryService',
    source: 'Model registry source snapshots rebuilt from site/account/custom CLI sources',
    basePath: 'userData',
    pathSegments: ['state', 'route-model-sources.json'],
    description: 'Target file for high-volume model source snapshots if split from routing config.',
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
    kind: 'sensitive-settings',
    owner: 'CustomCliConfigService',
    source: 'User-defined OpenAI-compatible CLI endpoints and API keys',
    basePath: 'userData',
    pathSegments: ['custom-cli-configs.json'],
    description:
      'Sensitive custom CLI settings. Encryption/migration is out of scope for this task.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'replace-by-key',
      rebuildable: false,
      dedupeKey: 'config.id',
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: false,
      modes: ['explicit-sensitive'],
      requiresExplicitInclude: true,
      reason: 'Contains API keys; sensitive backup behavior is deferred.',
    },
    containsSecrets: true,
  },
  {
    id: 'credit-settings',
    kind: 'sensitive-settings',
    owner: 'CreditService',
    source: 'Linux Do Credit cookies and cached account info',
    basePath: 'userData',
    pathSegments: ['credit-settings.json'],
    description: 'Sensitive credit settings. Encryption/migration is out of scope for this task.',
    mutationPolicy: 'app-managed',
    retention: {
      mode: 'replace-by-key',
      rebuildable: false,
      dedupeKey: 'linux-do-user',
      pruneTrigger: 'on-write',
    },
    backup: {
      defaultIncluded: false,
      modes: ['explicit-sensitive'],
      requiresExplicitInclude: true,
      reason: 'Contains cookies; sensitive backup behavior is deferred.',
    },
    containsSecrets: true,
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
