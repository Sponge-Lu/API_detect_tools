# Type Safety

> Type safety patterns in this project.

---

## Overview

The renderer runs with strict TypeScript settings and relies heavily on shared contracts from
`src/shared/`.

Relevant compiler/tooling facts from the current repo:

- `tsconfig.json` enables `strict`, `noUnusedLocals`, `noUnusedParameters`,
  and `noFallthroughCasesInSwitch`.
- ESLint warns on `@typescript-eslint/no-explicit-any`.
- The main shared contract boundary is `src/shared/types/*`, not renderer-local ad hoc interfaces.

---

## Type Organization

### Source-of-truth locations

- Cross-process data models: `src/shared/types/*`
- Shared constants: `src/shared/constants/*`
- Theme contracts: `src/shared/theme/*`
- Renderer-only component or hook types: keep them next to the component/hook

Examples:

1. `src/shared/types/site.ts`
   is the main contract for site config, accounts, detection results, CLI compatibility, and helper
   factories such as `generateSiteId()` and `generateAccountId()`.

2. `src/renderer/store/routeStore.ts`
   imports route workbench contracts from `src/shared/types/route-proxy`.

3. `src/renderer/store/uiStore.ts`
   imports `DEFAULT_COLUMN_WIDTHS` from `src/shared/constants`.

4. `src/renderer/components/AppButton/AppButton.tsx`
   keeps component-local prop types in the same file because they are renderer-only.

---

## Validation

This codebase uses a mixed validation approach:

- TypeScript for static contracts
- bridge-level runtime checks and conditional guards
- schema-based validation in shared areas when the domain already has schema support

For renderer work, the most important rule is to assume external data can be partial or stale and
normalize it before use.

Examples:

1. `useDataLoader.ts`
   checks whether CLI compatibility data has the expected keys before storing it.

2. `useTheme.ts`
   normalizes the theme mode through `normalizeThemeMode(...)` instead of trusting raw storage.

3. `routeStore.ts`
   checks `res?.success` before reading IPC response payloads.

---

## Common Patterns

Current patterns to follow:

- Prefer `import type` for pure type imports.
- Prefer literal unions and `as const` exported arrays for enumerated values.
- Prefer helper functions that normalize or split shared contracts rather than copying shape logic.
- Keep the Electron bridge typed through the `window.electronAPI` declaration in `App.tsx`.

Examples:

1. `src/shared/types/site.ts`
   exports `SITE_TYPES` as `const`, then derives `SiteType`.

2. `src/shared/types/site.ts`
   uses helpers such as `splitDetectionCacheData()` and `mergeDetectionCacheData()` to keep cache
   transformations centralized.

3. `src/renderer/App.tsx`
   declares the current `window.electronAPI` surface for config, route, theme, update,
   config-detection, accounts, browser-profile, and other features.

4. `src/renderer/hooks/useTheme.ts`
   depends on the shared `ThemeMode` contract from `src/shared/theme/themePresets`.

---

## Forbidden Patterns

- Do not introduce a new IPC payload shape without updating all affected layers.
- Do not duplicate literal values such as site types when a shared exported constant exists.
- Do not add renderer-local copies of contracts that already exist in `src/shared/`.
- Do not widen types to `any` at the first sign of friction; isolate unknown values and normalize
  them.
- Do not forget to update tests when shared contracts or token shapes change.
- Do not test API key activity with renderer-local checks such as `status === 1`; use the shared
  `getApiKeyAvailability()` / `isApiKeyActive()` helpers from `src/shared/types/site.ts`.

Current reality note:

- Some renderer files still import `Config`, `SiteConfig`, or `Settings` from `App.tsx` instead of
  importing directly from `src/shared/types/site.ts`. This exists today and should be treated as a
  legacy convenience path, not the preferred long-term source of truth for new cross-layer work.

---

## Scenario: API Key Availability Uses Shared Normalization

### 1. Scope / Trigger

- Trigger: site payloads can expose API key activity with `status`, `status_str`, `state`, or
  `enabled`, and both renderer display code and route probe execution must make the same
  active/inactive decision.
- Files: `src/shared/types/site.ts`, `src/main/route-cli-probe-service.ts`,
  `src/renderer/components/SiteCard/SiteCardDetails.tsx`, and related tests.

### 2. Signatures

```ts
// src/shared/types/site.ts
export interface ApiKeyInfo {
  status?: number | string;
  status_str?: string;
  state?: number | string | boolean;
  enabled?: number | string | boolean;
}

export type ApiKeyAvailability = 'active' | 'inactive' | 'unknown';

export function getApiKeyAvailability(
  apiKey: Pick<ApiKeyInfo, 'status' | 'status_str' | 'state' | 'enabled'>
): ApiKeyAvailability;

export function isApiKeyActive(
  apiKey: Pick<ApiKeyInfo, 'status' | 'status_str' | 'state' | 'enabled'>
): boolean;
```

### 3. Contracts

- `getApiKeyAvailability()` is the display-facing normalization boundary. It returns:
  - `active` for `1`, `true`, `active`, `enabled`, `available`, `valid`, and `ok`.
  - `inactive` for `0`, `false`, `inactive`, `expired`, `quota_exhausted`, `disabled`, `revoked`,
    and `deleted`.
  - `unknown` when no status field exists, the field is empty, or the value is unrecognized.
- `isApiKeyActive()` returns `true` for `active` and `unknown`, and `false` only for explicit
  inactive states. This preserves backward compatibility for legacy cached keys that predate status
  fields.
- UI badges and route probe API-key filtering must import the shared helpers; they must not duplicate
  status parsing in component, hook, or service code.
- When a route probe needs an executable key, `isApiKeyActive(apiKey)` is necessary but not
  sufficient: the caller must also require an actual `key` or `token` value.

### 4. Validation & Error Matrix

| Case | Boundary | Expected behavior |
|------|----------|-------------------|
| API key has `status: 1` | shared helper | `getApiKeyAvailability()` returns `active` |
| API key has `status_str: 'disabled'` | shared helper | returns `inactive`; route probe excludes it |
| API key has `state: false` | shared helper | returns `inactive` |
| API key has `enabled: 'true'` | shared helper | returns `active` |
| API key has no status fields | shared helper | returns `unknown`; `isApiKeyActive()` returns `true` |
| API key is active but has no `key`/`token` | route probe | excluded from execution because no secret can be resolved |

### 5. Good / Base / Bad Cases

- Good: `SiteCardDetails` renders an API key with `status_str: 'disabled'` as inactive even when
  numeric `status` is missing.
- Good: route CLI probe skips a key with `enabled: false` and uses the next available active key.
- Base: a legacy cached API key has no status fields; UI can show unknown/usable, and route probe may
  try it if a real token exists.
- Bad: `apiKey.status === 1` in renderer code marks `status_str: 'active'` as inactive/unknown.
- Bad: route probe treats unknown status as inactive and breaks older stored configs.

### 6. Tests Required

- `src/__tests__/sites-page-redesign.test.tsx`: assert `SiteCardDetails` displays active/inactive
  state through shared helper semantics, including `status_str`, `state`, and `enabled`.
- `src/__tests__/route-cli-probe-service.test.ts`: assert route probe API-key selection excludes
  explicit inactive states, includes unknown legacy states, and still requires `key` or `token`.
- `src/__tests__/site-types.test.ts` or the nearest shared-type test: assert
  `getApiKeyAvailability()` covers numeric, boolean, string, empty, and unknown values.

### 7. Wrong vs Correct

#### Wrong

```ts
// Misses status_str/state/enabled payloads and rejects legacy unknown statuses.
const activeKeys = apiKeys.filter(apiKey => apiKey.status === 1);
```

#### Correct

```ts
const activeKeys = apiKeys.filter(apiKey => {
  return isApiKeyActive(apiKey) && Boolean(apiKey.key || apiKey.token);
});
```

---

## Scenario: Route Analytics Object Stats Uses Token-Aware Aggregation

### 1. Scope / Trigger

- Trigger: route analytics data now flows from proxy request logging through shared types, main IPC,
  preload, renderer bridge typing, and the Data Overview route dashboard.
- Files: `src/shared/types/route-proxy.ts`, `src/main/route-analytics-service.ts`,
  `src/main/handlers/route-handlers.ts`, `src/main/preload.ts`, `src/renderer/App.tsx`,
  `src/renderer/pages/DataOverviewPage.tsx`.

### 2. Signatures

- Shared log fields:
  - `RouteRequestLogItem.promptTokens?: number`
  - `RouteRequestLogItem.completionTokens?: number`
  - `RouteRequestLogItem.totalTokens?: number`
- Shared bucket dimension:
  - `RouteAnalyticsBucket.apiKeyId?: string`
  - `buildBucketKey(..., apiKeyId?)` includes API key identity when present.
- Object stats query:
  - `RouteAnalyticsWindow = '24h' | '7d'`
  - `RouteAnalyticsObjectStatsQuery = { window: RouteAnalyticsWindow; limit?: number; sortBy?: 'requests' | 'tokens' | 'failureRisk' | 'successRate' }`
  - `RouteAnalyticsObjectStatsItem` includes `siteName`, `accountName`, `apiKeyName`,
    `requestCount`, `successCount`, `failureCount`, `successRate`, and token totals.
- IPC:
  - Main handler: `route:get-object-stats`
  - Preload bridge: `window.electronAPI.route.getObjectStats(params)`
  - Renderer type: `getObjectStats(params: RouteAnalyticsObjectStatsQuery)`.

### 3. Contracts

- Request logging is the source of truth for per-request usage tokens. Missing upstream usage is
  represented as `0` or absent fields, not fabricated estimates.
- Route request log cost estimates must use only recorded usage fields and known model prices:
  `promptTokens` uses input price, `completionTokens` uses output price, `cacheCreationTokens`
  use input price times `1.25`, and `cacheReadTokens` use input price times `0.1`. When
  `cachedTokens` is present, the cache-hit tokens are already included in the provider's
  `promptTokens` value, so the estimate must subtract those tokens from the normal input-price
  portion before adding the cache-specific charges.
- Analytics buckets keep API key identity so later object stats can group by `site / account /
  apiKey`.
- `getRouteObjectStats()` aggregates over the selected window and returns display-ready object
  labels plus counts and token totals.
- Object stats grouping normally preserves the raw `siteId/accountId/apiKeyId` bucket identity.
  Custom CLI sources are the exception: they can have multiple virtual ids that all display as the
  same `config / 默认 / 默认`, so `sourceType: 'customCli'` rows must merge by resolved display
  identity before sorting and limiting.
- Route object stats can be sorted by success rate before limiting; the route overview active
  object card uses this ordering by default.
- Route analytics summary, distribution, and object stats surfaces support only `24h` and `7d`.
  `30d` must not be exposed in the route data UI or accepted as a typed analytics window.
- The route overview dashboard must read object rankings from `getObjectStats()`, not recompute
  success-rate rankings from the current request-log page.
- Renderer must tolerate absent `getObjectStats` during bridge skew by showing an empty object list.

### 4. Validation & Error Matrix

| Case | Boundary | Expected behavior |
|------|----------|-------------------|
| Upstream usage omitted | request log / bucket | token fields resolve to `0` or empty UI state |
| Missing API key id | bucket / object stats | group remains valid with fallback API key name |
| Duplicate custom CLI virtual ids | object stats | merge into one displayed object row before `limit` |
| Empty analytics window | object stats IPC | return `success: true` with `data: []` |
| Unsupported bridge during version skew | renderer | optional call yields empty object stats, no crash |
| `sortBy: 'tokens'` with zero tokens | object stats | keep deterministic request-based fallback ordering |

### 5. Good / Base / Bad Cases

- Good:
  - Route overview shows `siteName / accountName`, `apiKeyName`, request count, success rate,
    failure count, and total tokens from `RouteAnalyticsObjectStatsItem`.
  - Token KPI uses real `promptTokens + completionTokens` from route analytics summary.
- Base:
  - No token data is available yet; dashboard shows request and success/failure health while token
    UI says usage is unavailable.
- Bad:
  - Deriving object health only from the last 200 request logs.
  - Dropping `apiKeyId` from bucket keys and merging different API keys under one account.
  - Grouping custom CLI object stats only by raw virtual ids, causing duplicate rows with identical
    display labels.
  - Guessing token consumption from request count.

### 6. Tests Required

- Service:
  - `src/__tests__/route-analytics-service.test.ts`
  - Assert request logs persist token fields and object stats aggregate tokens by site/account/API
    key.
  - Assert duplicate custom CLI virtual ids with the same display identity merge into one object
    stats row.
- Renderer:
  - `src/__tests__/data-overview-page.test.tsx`
  - Mock `getObjectStats`, assert route dashboard renders active objects and reloads the endpoint on
    overview change events.
  - `src/__tests__/logs-page.test.tsx`
  - Assert route log cost estimates include cache creation at 1.25x input price, cache hits at one
    tenth of input price, and do not double-count `cachedTokens` that are already included in
    `promptTokens`.
- Build:
  - `npm run build:main`
  - `npm run build:renderer`

### 7. Wrong vs Correct

#### Wrong

- Compute `site / account / apiKey` rankings in `DataOverviewPage` from whichever request logs are
  currently loaded.
- Treat missing token usage as an inferred value.

#### Correct

- Keep aggregation in `RouteAnalyticsService.getRouteObjectStats()` and expose it through the typed
  route IPC contract.
- Preserve raw bucket ids for real site/account/API key objects, but merge custom CLI virtual ids by
  resolved display identity before applying ranking and `limit`.
- Surface missing token usage explicitly while continuing to show request and health metrics.

---

## Scenario: Route Redirection Uses Card-Scoped Priority

### 1. Scope / Trigger

- Trigger: model redirection changed across shared types, main-process routing, IPC/store, and the
  redirection UI.
- Files: `src/shared/types/route-proxy.ts`, `src/main/unified-config-manager.ts`,
  `src/main/route-model-registry-service.ts`, `src/main/route-channel-resolver.ts`,
  `src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx`,
  `src/renderer/store/routeStore.ts`.

### 2. Signatures

- Shared type:
  - `RouteModelDisplayItem.priorityConfig?: RouteDisplayItemPriorityConfig`
  - `RouteDisplayItemPriorityConfig = { sitePriorities: Record<string, number>; apiKeyPriorities: Record<string, number>; disabledSiteIds?: string[]; disabledApiKeyPriorityKeys?: string[] }`
  - `buildRouteApiKeyPriorityKey(siteId, accountId, apiKeyId): string`
- Persistence:
  - `UnifiedConfigManager.upsertRouteModelDisplayItem(displayItem)`
  - `UnifiedConfigManager.updateRouteCliModelSelections(selections)`
  - `UnifiedConfigManager.ensureRouteRuleForCliModelSelection(cliType, canonicalModel)`
- Runtime:
  - `resolveChannels(rule, canonicalModel)`
  - `buildCanonicalDisplayItems(registry, entry)` must resolve to at most one active display item
    per `canonicalName`
- Renderer:
  - `routeStore.upsertDisplayItem(displayItem)`
  - `ModelRedirectionTab.handleSaveDetails()`

### 3. Contracts

- `RouteModelRegistryConfig.displayItems` is the source of truth for redirection cards shown in the
  UI.
- One `canonicalName` maps to exactly one redirect card. Duplicate cards for the same
  `canonicalName` are invalid.
- Legacy override-backed cards are reconstructed from `routing.modelRegistry.overrides`, but the
  override group remains part of the display contract. If `registry.entries[canonicalName].sources`
  or a persisted display item is present but stale or partial, renderer reconstruction must union
  entry sources, display-item sources, and grouped override sources by `sourceKey` before deriving
  `sourceKeys` and `originalModelOrder`.
- The redirection editor must save the `RouteModelDisplayItem` before per-source overrides. The
  display item is the routing/display unit, and saving it first prevents a long multi-source save
  from leaving the UI stuck on an old single-model card if per-source override writes are interrupted.
- Seeded defaults are intentionally reduced to one real example:
  - `DEFAULT_ROUTE_REDIRECTION_EXAMPLE_CANONICAL_NAME = 'claude-opus-4-6'`
- Channel ranking must read `displayItem.priorityConfig`, not `vendorPriorities`.
- CLI probe compatibility filtering is model-scoped. A failed probe may exclude a channel only when
  the probe `canonicalModel` or `rawModel` matches the requested canonical model or the source
  original model. Unrelated failed probes for the same site/account/CLI must not hide a priority-0
  channel.
- The details modal is grouped by `site / account / apiKey` for the current card.
- User groups with model access but without an eligible API key must render as reminder text only;
  they do not receive editable priority controls and must not be written into
  `priorityConfig.apiKeyPriorities`.
- Site-level model sources (`sourceType: 'site'` or missing `accountId`) are diagnostic-only in the
  redirection detail pane. They may prove that a site advertises the model, but they cannot
  participate in local routing priority until the site has an account/API-key-backed source. The UI
  must warn the user to re-add or refresh the site/account instead of silently hiding the reason.
- The priority table can disable a whole site or an individual API key. Disabled API keys render in
  the folded section and must be listed in `disabledApiKeyPriorityKeys`; disabled sites render in
  the folded site section and must be listed in `disabledSiteIds`. Numeric `sitePriorities` and
  `apiKeyPriorities` are priority memory and must keep disabled site/API-key entries so re-enabling
  restores their previous order. Empty disabled lists must not be persisted.
- Resetting defaults is not the same as rebuilding the model registry. The renderer must call
  `routeStore.rebuildModelRegistry(true, { resetDefaults: true })`, the IPC handler must route that
  to `resetModelRegistryDefaults()`, and the service must drop existing display items and overrides
  whose `canonicalName` is `claude-opus-4-6` before reseeding the current default example.
- A CLI default model selection is only runnable when an enabled `RouteRule` can match
  `cliType + canonicalModel`. Saving CLI model selections must ensure this rule exists after
  canonicalization.
- `resetModelRegistryDefaults()` must also ensure a Claude Code exact rule for
  `claude-opus-4-6`, because resetting the default display item is the user-facing repair path for
  stale default redirection state.
- Automatic CLI/model rules are a fallback, not an override. If any enabled manual rule already
  matches the same `cliType + canonicalModel` by exact, wildcard, regex, or `*`, do not create a
  duplicate. If no match exists, create/update a stable exact rule with priority `0`.
- After a reset-default operation changes both `modelRegistry` and `rules`, the renderer store must
  refresh the full route config, not only replace `config.modelRegistry`.
- Active `routePathStates` belong to the concrete route path surface in the redirection detail
  pane. The renderer must show `disabledUntil` labels inside the matching API-key row's covered
  original-model details, while site names, API key names, and original-model chips remain identity
  or coverage only.

### 4. Validation & Error Matrix

| Case | Boundary | Expected behavior |
|------|----------|-------------------|
| Empty `canonicalName` | `upsertRouteModelDisplayItem` | throw `Model display item requires canonicalName` |
| Empty `sourceKeys` | `upsertRouteModelDisplayItem` | throw `Model display item requires sourceKeys` |
| Same `canonicalName`, different `id` | `upsertRouteModelDisplayItem` | reject duplicate card |
| `displayItems` empty before first aggregation | renderer fallback | show only `claude-opus-4-6` example when entry exists |
| Selected model has groups but no API keys | details modal | show reminder text, no priority input |
| Selected model has only a site-level source for one site | details modal | show a re-add/refresh warning naming that site; do not create priority controls |
| User disables an API key | details modal -> persistence | move it to the folded section, save it in `disabledApiKeyPriorityKeys`, and keep its numeric priority for later restore |
| User disables a whole site | details modal -> persistence | fold the site, save it in `disabledSiteIds`, and keep its site/API-key priorities for later restore |
| All API keys under a site are disabled | details modal -> persistence | treat the site as non-sortable/folded while keeping its site priority memory |
| Multiple persisted cards share same `canonicalName` in legacy data | normalization / resolver | keep one effective card, prefer manual and newer data |
| Override-backed card has partial stale entry or display-item sources | renderer projection | show every grouped override source plus any entry/display-item sources; do not collapse selected original models to the stale projection |
| Failed CLI probe for unrelated model | channel resolver | ignore it for the current model, preserve priority-0 channel |
| Active route path suspension | renderer detail pane | show `暂停至 HH:mm` after the matching covered original model inside the API-key row, not beside site/API key names and not in original-model chips |
| User clicks reset default redirection | renderer -> IPC -> service | remove stale `claude-opus-4-6` display item/overrides, then seed the current default source |
| CLI default selection has no matching rule | `updateRouteCliModelSelections` | create an enabled exact fallback rule for the normalized canonical model |
| Manual rule already matches the selected model | `updateRouteCliModelSelections` | preserve the manual rule and do not create an automatic duplicate |
| Reset default redirection repairs default opus | `resetModelRegistryDefaults` | reseed `claude-opus-4-6` and ensure the Claude Code exact fallback rule exists |

### 5. Good / Base / Bad Cases

- Good:
  - `claude-opus-4-6` card includes multiple selected original models and persists one
    `priorityConfig`.
  - Disabling `main-key` moves it into the folded section, persists
    `disabledApiKeyPriorityKeys`, and keeps its old API-key priority for restore.
  - Disabling `Claude Site 2` keeps the site visible with an enable control, removes it from
    sortable site priorities, and prevents its API keys from being individually re-enabled until the
    site is enabled.
  - Details pane shows `Claude Site / Main / backup-key`, any active `暂停至 HH:mm` route-path
    labels inside the matching API-key row's original-model details, and reminder text for
    `team-alpha（claude-sonnet-4.6-20260201）未创建可用 API key`.
- Base:
  - Only the seeded `claude-opus-4-6` example exists; other models remain available in the create
    dialog candidate list.
- Bad:
  - Reintroducing vendor sections in the UI.
  - Ranking channels from `registry.vendorPriorities[vendor]`.
  - Allowing two cards with the same `canonicalName`.
  - Updating `cliModelSelections` without creating any matching route rule, which makes the proxy
    return `no_matching_rule`.
  - Dropping disabled site/API-key ids from numeric priority maps after the user disables them,
    which prevents restoring their original order.
  - Showing `routePathStates.disabledUntil` below original model chips, beside site names, or beside
    API key names, which hides or crowds the concrete model/path context that is paused.

### 6. Tests Required

- Renderer:
  - `src/__tests__/route-workbench-redesign.test.tsx`
  - Assert flat cards, duplicate rejection, site/account/apiKey grouping, missing-key reminders,
    site-only source re-add/refresh warnings,
    active suspension labels in API-key row covered-model details, no suspension labels in
    site/API-key names or original-model chips, priority save payloads, save ordering with display
    item before overrides, and override-backed cards preserving all grouped original models when an
    entry or display item is stale.
  - Assert disabling a site or API key folds it, persists non-empty disabled lists, and preserves
    numeric priority memory so re-enabling restores the previous order.
- Registry / runtime:
  - `src/__tests__/route-model-registry-service.test.ts`
  - Assert single seeded example and display-item-scoped channel ordering.
  - Assert unrelated failed CLI probes do not hide a priority-0 channel.
  - Assert `resetModelRegistryDefaults()` removes stale `claude-opus-4-6` overrides before reseeding.
- Persistence:
  - `src/__tests__/unified-config-manager.test.ts`
  - Assert `priorityConfig` persistence and duplicate `canonicalName` rejection.
  - Assert saving a CLI model selection creates an automatic exact rule only when no enabled manual
    rule already matches.
- Renderer:
  - Assert the reset-default button calls `rebuildModelRegistry(true, { resetDefaults: true })`.

### 7. Wrong vs Correct

#### Wrong

- Keep `vendorPriorities` as the active runtime ordering source while the dialog only edits the
  current card.
- Show multiple cards for the same `canonicalName` and let routing guess which card is intended.
- Reconstruct an override-backed card from `registry.entries[canonicalName].sources` or persisted
  `displayItem.sourceKeys` alone and ignore grouped overrides, because stale projections can hide
  selected original models and custom CLI sources.
- Treat the latest failed CLI probe for a site/account/CLI as a global failure across all models.
- Implement the reset-default button as a normal rebuild that preserves stale default-card overrides.
- Assume `cliModelSelections.claudeCode = 'claude-opus-4-6'` is enough for proxy routing without a
  matching `RouteRule`.

#### Correct

- Treat `RouteModelDisplayItem` as the routing-scoped redirection unit.
- Persist ranking on `displayItem.priorityConfig`.
- Resolve channels against the single effective card for that `canonicalName`.
- Match CLI probe health by `canonicalModel`/`rawModel` before excluding a channel.
- Use an explicit `{ resetDefaults: true }` path that removes stale `claude-opus-4-6` state and
  reseeds the current default example.
- Treat CLI model selection and route-rule matching as one write contract: selection persistence
  must leave the proxy with at least one enabled rule that can match the canonical model.

---

## Scenario: Check-In Completion State Survives Same-Day Refresh

### 1. Scope / Trigger

- Trigger: account-browser/manual check-in flows can mark a site/account as completed locally before
  the next full site detection.
- Files: `src/renderer/hooks/useCheckIn.ts`, `src/main/api-service.ts`,
  `src/main/handlers/browser-profile-handlers.ts`, `src/renderer/hooks/useDataLoader.ts`.

### 2. Signatures

- Renderer result fields:
  - `DetectionResult.can_check_in?: boolean`
  - `DetectionResult.lastRefresh?: number`
  - `DetectionResult.checkinStats?: { todayQuota?: number; checkinCount?: number; totalCheckins?: number; siteType?: 'veloera' | 'newapi' }`
- Persisted cache fields:
  - `DetectionCacheData.can_check_in?: boolean`
  - `DetectionCacheData.last_refresh?: number`
  - `DetectionCacheData.checkin_stats?: { today_quota?: number; checkin_count?: number; total_checkins?: number; site_type?: 'veloera' | 'newapi' }`
- Browser profile IPC:
  - `browserProfile.persistCheckinCompletion(siteId, accountId, cachedData)`.

### 3. Contracts

- `can_check_in: false` plus a same-local-day `last_refresh` / `lastRefresh` means the UI should
  show the account as checked in for the current day.
- Manual check-in completion paths, including ordinary "open site manually" flows and Any Router
  browser-profile flows, must call `browserProfile.persistCheckinCompletion(siteId, accountId,
  cachedData)` after updating renderer state.
- Same-day refresh detection must not turn a locally completed check-in back into `can_check_in:
  true` unless the cached completion is from a previous local day.
- `ApiService.detectSite()` must evaluate both the renderer-provided `cachedData` and the persisted
  owner cache resolved from `siteUrl + accountId` before composing the returned `DetectionResult`.
  Persisted cache is the fallback when a refresh entry point omits or has stale frontend cache.
- If a later detection says `has_checkin: false`, stale check-in stats must be cleared instead of
  preserved.
- `checkin_stats` should preserve the local completion reward/stat fields when the refresh endpoint
  does not return replacement stats.

### 4. Validation & Error Matrix

| Case | Boundary | Expected behavior |
|------|----------|-------------------|
| Any Router browser check-in succeeds | renderer -> browser profile IPC | mark result and account cache `can_check_in: false` with today's `last_refresh` |
| Ordinary manual check-in opens the target site | renderer -> browser profile IPC | mark result and persist the same completion cache for the site/account owner |
| Refresh runs later the same day and endpoint reports `can_check_in: true` | main detection -> renderer result/cache | preserve `can_check_in: false` and existing check-in stats |
| Refresh omits renderer `cachedData` but persisted owner cache has same-day completion | main detection -> renderer result/cache | returned `DetectionResult` still has `can_check_in: false` |
| Refresh runs on the next local day | main detection -> renderer result/cache | accept the endpoint's new `can_check_in` value |
| Site no longer supports check-in | main detection cache save | write `has_checkin: false` and clear stale `checkin_stats` |

### 5. Good / Base / Bad Cases

- Good: Any Router shows as checked in after browser check-in and remains checked in after a normal
  site refresh on the same day.
- Base: A standard New API site whose check-in status endpoint returns `false` persists that value
  directly.
- Bad: A refresh overwrites same-day local completion with `can_check_in: true`, making the SiteCard
  icon look unchecked again.

### 6. Tests Required

- `src/__tests__/useCheckIn.test.ts`: Any Router browser check-in calls
  `persistCheckinCompletion()` with `can_check_in: false`; ordinary manual check-in paths also
  persist the completion cache.
- `src/__tests__/browser-login-flow.test.ts`: browser profile handler writes check-in completion
  into account `cached_data`.
- `src/__tests__/token-service.test.ts`: `ApiService.detectSite()` preserves same-day completed
  check-in state in both the returned result and the saved detection cache, including the case where
  renderer `cachedData` is absent and the completion marker exists only in persisted cache.

### 7. Wrong vs Correct

#### Wrong

- Treat every successful refresh result as authoritative for `can_check_in`, ignoring a same-day
  local completion cache.
- Preserve only from renderer `cachedData`, so alternate refresh entry points can return
  `can_check_in: true` even though the account cache records same-day completion.

#### Correct

- During detection result normalization and cache save, preserve `can_check_in: false` when the
  existing cache records a same-local-day completion and the new result still supports check-in.
- Resolve the persisted owner cache in `ApiService.detectSite()` and use it as a same-day completion
  source for the returned result as well as for cache save.
