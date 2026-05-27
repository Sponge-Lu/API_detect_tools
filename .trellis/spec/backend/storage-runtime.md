# Storage Runtime

## Scenario: Local Storage Split, Manifest Bundles, And Migration

### 1. Scope / Trigger

- Trigger: `config.json` must stay small and stable while runtime detection cache, route runtime
  state, route diagnostics, and analytics are written to bounded sidecar files.
- Trigger: local/WebDAV backups must restore the same storage structure without mutating protected
  browser profile state.
- Files: `src/main/app-storage-manifest.ts`, `src/main/app-storage-bundle.ts`,
  `src/main/backup-manager.ts`, `src/main/webdav-manager.ts`,
  `src/main/runtime-cache-manager.ts`, `src/main/route-state-manager.ts`,
  `src/main/unified-config-manager.ts`, `src/main/utils/atomic-json.ts`, and
  `scripts/migrate-config-v224-to-v301.cjs`.

### 2. Signatures

```ts
// src/main/app-storage-manifest.ts
export interface AppStorageEntry {
  id: string;
  kind:
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
  mutationPolicy: 'app-managed' | 'external-tool-owned' | 'protected-do-not-mutate';
  backup: {
    defaultIncluded: boolean;
    modes: Array<'lightweight-config' | 'full-manifest' | 'explicit-sensitive'>;
    requiresExplicitInclude?: boolean;
  };
  retention: { mode: string; ttlDays?: number; maxItems?: number; maxBytes?: number };
  containsSecrets: boolean;
}

// src/main/app-storage-bundle.ts
export interface AppStorageBundle {
  format: 'api-hub-storage-bundle';
  version: 1;
  manifestVersion: 1;
  mode: 'full-manifest';
  createdAt: number;
  files: AppStorageBundleFile[];
}

export function createAppStorageBundleContent(): Promise<string>;
export function extractStableConfigFromBackupContent(content: string): unknown;
export function restoreAppStorageBackupContent(
  content: string,
  targetConfigPath: string
): Promise<{ kind: 'storage-bundle' | 'legacy-config'; restoredFiles: string[] }>;

// scripts/migrate-config-v224-to-v301.cjs
node scripts/migrate-config-v224-to-v301.cjs [--path <config.json>] [--dry-run]

// src/main/utils/atomic-json.ts
export function writeTextFileAtomically(targetPath: string, content: string): Promise<void>;
export function writeJsonFileAtomically<T>(targetPath: string, value: T): Promise<void>;
```

### 3. Contracts

- `config.json` owns stable user intent only: sites, accounts, settings, stable routing rules,
  model display items, mappings, priorities, server config, CLI selections, and probe/analytics
  config.
- `config.json` must not persist `site.cached_data`, `account.cached_data`,
  `routing.stats`, `routing.routePathStates`, `routing.health`, `routing.cliProbe.latest`,
  `routing.cliProbe.history`, `routing.analytics.buckets`, `routing.modelRegistry.sources`, or
  `routing.modelRegistry.lastAggregatedAt`.
- `config.json` load failures other than `ENOENT` must be retried briefly before backup recovery,
  because a concurrent writer can make the file transiently unreadable without durable corruption.
- `runtime-cache.json` owns detection cache and site daily snapshots. Daily snapshots are bounded
  to 90 days and 120 items per site.
- `state/route-runtime.json` owns route channel stats, route path suspension state, and health.
  Writes are TTL + max-item bounded.
- `state/route-probes.json` owns CLI probe latest/history diagnostics. Writes are TTL + max-item
  bounded.
- `state/route-analytics.json` owns durable route analytics buckets. Writes are TTL + max-item
  bounded.
- `state/route-model-sources.json` owns rebuildable model source snapshots and is max-item bounded.
- Route runtime-only writes must call the route state manager directly and must not trigger
  `backupManager.backupFile(configPath)`.
- Atomic JSON/text writes must serialize concurrent writes to the same target path and retry
  transient final-rename errors (`EACCES`, `EBUSY`, `ENOTEMPTY`, `EPERM`) before surfacing a save
  failure. They must not fall back to non-atomic overwrite/copy of the target file, because readers
  can observe a partially replaced file on Windows.
- Automatic config backup remains lightweight and config-only, with throttle + content dedupe.
  Manual local backup and WebDAV upload use a `full-manifest` storage bundle.
- Bundle restore may write only manifest entries where `backup.defaultIncluded === true` and
  `backup.modes` contains `full-manifest`.
- Legacy config-only restore must preserve existing managed runtime/cache/state files. A config-only
  backup has no authority over sidecar state, so preserving sidecars prevents automatic recovery from
  deleting runtime continuity after a transient config read failure.
- Browser operational state entries are protected: do not migrate, compact, delete, back up by
  default, or restore them from bundles.
- `custom-cli-configs.json` and `credit-settings.json` are explicitly sensitive and excluded from
  default bundles until an explicit-sensitive flow exists.
- Logs are excluded from default backups and this storage split does not add log redaction.

### 4. Validation & Error Matrix

| Case | Boundary | Expected behavior |
| --- | --- | --- |
| Missing `config.json` during bundle upload | bundle creation -> upload | Reject because no `stable-config` can be extracted |
| Bundle has unknown or protected entry id | restore | Reject before mutating any file |
| Bundle file hash mismatch | restore | Reject before mutating any file |
| `config.json` contains transient invalid JSON during a write | load -> recovery | Retry before attempting backup restore |
| Legacy config-only restore with stale `runtime-cache.json` | restore -> load | Preserve managed runtime/cache/state sidecars, then write config |
| Full bundle lacks an optional state file | restore | Remove the previous file so stale local runtime does not survive |
| Browser profile directory exists | backup/restore | Leave untouched; it is not in bundle scope |
| Windows temporarily locks `state/route-probes.json` during final rename | atomic write | Retry the rename, keep the temp file only while retrying, then commit or clean it up on failure |
| Runtime route stats update | route service -> config manager | Persist sidecar state only; no config write and no config backup |
| v2.1.24 config contains cached data and route runtime | migration script | Write clean config plus `runtime-cache.json` and `state/route-*.json` |
| Migration script reruns after split state exists | migration script | Merge existing sidecars with any legacy payload instead of wiping state |

### 5. Good/Base/Bad Cases

- Good: saving a site with fresh detection cache hydrates the renderer compatibility view, but the
  persisted `config.json` has no `cached_data`.
- Good: restoring a WebDAV manifest bundle restores config, runtime cache, route state, and settings
  included by the manifest while leaving browser profiles intact.
- Base: restoring an old `config_*.json` backup restores only stable config and preserves existing
  runtime sidecars; full-manifest restore is required to replace sidecar state.
- Bad: adding a new runtime file without an `AppStorageEntry`; backup/restore and migration will
  drift.
- Bad: using recursive directory copy for `userData`; this can include protected browser profiles,
  logs, and backup directories.
- Bad: pruning or deleting `browser-profiles`, `api-detector-chrome*`, or isolated profile paths as
  part of storage cleanup.

### 6. Tests Required

- `src/__tests__/storage-manifest.test.ts`: manifest ids, protected browser entries, sensitive
  explicit backup policy, and retention/cap declarations.
- `src/__tests__/app-storage-bundle.test.ts`: bundle inclusion/exclusion, bundle restore clearing
  stale managed files, and legacy config-only restore preserving runtime sidecars.
- `src/__tests__/backup-manager.test.ts`: automatic backup throttle/dedupe and forced retention.
- `src/__tests__/atomic-json.test.ts`: parent directory creation, transient final-rename retry,
  no non-atomic overwrite fallback, same-target write serialization, missing-file defaults, and
  temp-file cleanup on failure.
- `src/__tests__/unified-config-manager.test.ts`: cached data split, route state sidecar writes,
  backup suppression for runtime writes, state hydration, transient config read retry, and daily
  snapshot preservation.
- `src/__tests__/migrate-config-v224-to-v301-script.test.ts`: v2.1.24 split output and rerun
  preservation of existing state.
- `npm run build:main`: verifies main-process imports and bundle/restore contracts compile.

### 7. Wrong vs Correct

#### Wrong

```ts
// Runtime-only change rewrites stable config and creates frequent backups.
routing.stats[key] = nextStats;
await unifiedConfigManager.saveConfig();
```

#### Correct

```ts
// Stable config is untouched; only bounded runtime sidecar state changes.
routing.stats[key] = nextStats;
await routeStateManager.saveRuntimeState(routing);
```

#### Wrong

```ts
// Copies all userData, including browser profiles and logs.
await copyDirectory(app.getPath('userData'), backupDir);
```

#### Correct

```ts
// Includes only manifest-approved full-manifest files.
const content = await createAppStorageBundleContent();
```
