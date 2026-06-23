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

export interface CreateAppStorageBundleContentOptions {
  includeExplicitSensitive?: boolean;
  explicitSensitiveEntryIds?: string[];
  encrypt?: boolean;
}

export function getUserConfigPackageBundleOptions(): CreateAppStorageBundleContentOptions;
export function createAppStorageBundleContent(
  roots?: AppStorageRoots,
  options?: CreateAppStorageBundleContentOptions
): Promise<string>;
export function decryptBackupContentIfNeeded(content: string): Promise<string>;
export function extractStableConfigFromBackupContent(content: string): unknown;
export function restoreAppStorageBackupContent(
  content: string,
  targetConfigPath: string
): Promise<{ kind: 'storage-bundle' | 'legacy-config'; restoredFiles: string[] }>;

// src/main/app-storage-backup-crypto.ts
export const ENCRYPTED_APP_STORAGE_BACKUP_FORMAT = 'api-hub-encrypted-storage-backup';
export const ENCRYPTED_APP_STORAGE_BACKUP_EXTENSION = '.ahubpkg';
export function encryptAppStorageBackupContent(plaintext: string): Promise<string>;
export function decryptAppStorageBackupContent(content: string): Promise<string>;

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
  Manual local backup, WebDAV upload, and settings-page export use an encrypted `.ahubpkg` user
  config package: AES-256-GCM envelope + gzip-compressed manifest plaintext.
- `getUserConfigPackageBundleOptions()` is the only standard explicit-sensitive package preset. It
  may include `custom-cli-configs.json`, but must not include `credit-settings.json` or browser
  operational state.
- Bundle restore may write only manifest entries where `backup.defaultIncluded === true` and
  `backup.modes` contains `full-manifest`, plus explicitly allowed sensitive entries from the
  user config package preset.
- Legacy config-only restore must preserve existing managed runtime/cache/state files. A config-only
  backup has no authority over sidecar state, so preserving sidecars prevents automatic recovery from
  deleting runtime continuity after a transient config read failure.
- Browser operational state entries are protected: do not migrate, compact, delete, back up by
  default, or restore them from bundles.
- `custom-cli-configs.json` and `credit-settings.json` are explicitly sensitive and excluded from
  default plaintext bundles. The encrypted user config package explicitly includes
  `custom-cli-configs.json` so direct CLI credentials migrate with user config; `credit-settings.json`
  remains excluded because credit cookies are not part of the portable config package contract.
- Logs are excluded from default backups and this storage split does not add log redaction.

### 4. Validation & Error Matrix

| Case | Boundary | Expected behavior |
| --- | --- | --- |
| Missing `config.json` during bundle upload | bundle creation -> upload | Reject because no `stable-config` can be extracted |
| Bundle has unknown or protected entry id | restore | Reject before mutating any file |
| Encrypted package key id does not match this install | decrypt -> restore | Reject before mutating any file with `备份加密密钥不匹配，无法解密该配置包` |
| User config package contains `custom-cli-configs` | restore | Restore it only from the encrypted explicit-sensitive package flow |
| User config package omits `credit-settings` | restore | Preserve any existing local `credit-settings.json` because package restore has no authority over credit cookies |
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
- Good: restoring a WebDAV/user-export `.ahubpkg` restores config, runtime cache, route state,
  default settings, and `custom-cli-configs.json` while leaving browser profiles and
  `credit-settings.json` intact.
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
- `src/__tests__/app-storage-bundle.test.ts`: bundle inclusion/exclusion, encrypted user config
  package hides plaintext secrets, includes `custom-cli-configs`, excludes/preserves
  `credit-settings`, bundle restore clearing stale managed files, and legacy config-only restore
  preserving runtime sidecars.
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
// Uses the package preset: encrypted envelope + only approved explicit-sensitive entries.
const content = await createAppStorageBundleContent(
  undefined,
  getUserConfigPackageBundleOptions()
);
```

## Scenario: Managed Site Account-Scoped Persistence

### 1. Scope / Trigger

- Trigger: adding a managed site from the renderer collects both site identity and login/account
  credentials, but only site-shared intent may be written to `config.sites`.
- Trigger: legacy configs can contain account-private data on a site even after an account record
  already exists, so main-process load must repair the boundary before normal saves continue.
- Files: `src/renderer/pages/SitesPage.tsx`, `src/renderer/components/SiteEditor.tsx`,
  `src/main/handlers/account-handlers.ts`, `src/main/preload.ts`,
  `src/main/unified-config-manager.ts`, `src/renderer/App.tsx`, and
  `src/__tests__/unified-config-manager.test.ts`.

### 2. Signatures

```ts
// Renderer add flow
window.electronAPI.sites.add(siteSharedPayload);
window.electronAPI.accounts.add({
  site_id: string;
  account_name: string;
  user_id: string;
  access_token: string;
  auth_source: 'manual' | 'main_profile' | 'isolated_profile';
  browser_profile_path?: string;
  anyRouterConfig?: { userHash?: string };
});

// Main load repair
UnifiedConfigManager.loadConfig(): Promise<UnifiedConfig>;
```

### 3. Contracts

- New managed-site creation is a two-record write:
  - `sites.add(...)` receives only site-shared fields such as id/name/url/site type and stable
    site-level configuration.
  - `accounts.add(...)` receives account-specific credentials and private account configuration.
- `SiteEditor` may collect `systemToken`, `userId`, `accountName`, and Any Router user hash for the
  initial account, but `SitesPage` must strip those fields before calling `sites.add(...)`.
- `config.sites[]` must not persist account-private fields: `access_token`, `system_token`,
  `user_id`, `cached_data`, `api_keys`, balance/usage counters, or Any Router user hash.
- `config.accounts[]` owns stable account intent: account name, credential source, user id, access
  token, browser profile binding, auto-refresh settings, account-scoped CLI config, and Any Router
  user hash.
- Detection/runtime values that differ by account, such as balance, today usage, API keys, check-in
  state, and request/token counters, are stored in `runtime-cache.json` under the account owner.
- When a config is loaded and a site has existing accounts plus legacy site-level auth/cache fields,
  `UnifiedConfigManager` must migrate missing credential/cache values to the matching or first
  account, then remove the legacy fields from the site before saving.

### 4. Validation & Error Matrix

| Case | Boundary | Expected behavior |
| --- | --- | --- |
| Smart/manual add returns `systemToken` and `userId` | renderer -> IPC | Create the site via `sites.add(siteSharedPayload)`, then create the default account via `accounts.add(...)` |
| `accounts.add(...)` includes `anyRouterConfig.userHash` | IPC -> config manager | Persist the hash on the account record, never on the site |
| Site add succeeds but account add fails | renderer workflow | Surface the account creation error instead of silently leaving credentials on the site |
| Legacy site has accounts plus site-level `access_token`/`user_id` | load migration | Copy missing values to the matching account and delete the site-level fields |
| Legacy site has site-level `cached_data` | load migration | Move owner cache to account runtime cache and delete `site.cached_data` |
| Legacy site has no accounts but has site-level credentials | load migration | Repair a default account first, then continue with account-scoped persistence |
| Detection refresh writes balance/API keys/today usage | service -> storage | Persist runtime cache for the account owner; stable `config.json` stays free of detection cache |

### 5. Good/Base/Bad Cases

- Good: a newly added managed site stores only site identity/shared config on `config.sites[]`, while
  the default account stores the token, user id, auth source, and Any Router user hash.
- Good: restarting the app after a legacy save removes site-level auth/cache fields and keeps the
  account usable because the data was migrated to the account owner.
- Base: `auth_source: 'manual'` is valid for smart-add login flows that used a temporary login
  browser rather than a persistent main/isolated browser profile.
- Bad: calling the legacy `addSite(site)` path with `system_token` or `user_id` in the site payload;
  this recreates site-level credentials and makes multi-account state ambiguous.
- Bad: saving balance, today usage, or API keys to a site object because those values can differ per
  account and must survive through account-owned runtime cache instead.

### 6. Tests Required

- `src/__tests__/sites-page-redesign.test.tsx`: assert new managed-site creation calls
  `sites.add(buildSitePayloadForCreate(site))` and then `accounts.add(...)`, and does not call the
  legacy store-level site add path with credential fields.
- `src/__tests__/unified-config-manager.test.ts`: assert loading a config with existing accounts and
  legacy site-level auth/cache fields migrates those values to the account owner and clears the
  site-level fields from persisted config.
- IPC bridge tests or source contract assertions must cover any new `accounts.add(...)` field that
  crosses preload/main/renderer typing, such as `anyRouterConfig`.

### 7. Wrong vs Correct

#### Wrong

```ts
// Persists account credentials on the site and lets the legacy repair path guess later.
await addSite({
  ...site,
  system_token: autoInfo.systemToken,
  user_id: autoInfo.userId,
});
```

#### Correct

```ts
const siteResult = await window.electronAPI.sites.add(buildSitePayloadForCreate(site));
await window.electronAPI.accounts.add({
  site_id: siteResult.data.id,
  account_name: accountName || '默认账户',
  user_id: autoInfo.userId,
  access_token: autoInfo.systemToken,
  auth_source: 'manual',
  anyRouterConfig,
});
```
