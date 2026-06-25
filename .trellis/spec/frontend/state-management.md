# State Management

> How state is managed in this project.

---

## Overview

Zustand is the default shared-state solution for the renderer. The project does not use Redux,
React Context as a global state layer, or a dedicated server-state library.

Actual state split:

- shared cross-component or cross-page state -> Zustand store
- page-only ephemeral UI state -> local React state in the page/component
- backend data fetching/persistence -> manual async IPC calls from hooks or stores

---

## State Categories

### Global shared state

The project uses one store file per domain instead of a single mega-store with slices.

| Store | Responsibility | Persistence |
|------|----------------|-------------|
| `configStore.ts` | config data, site CRUD, save/load flags | manual save through IPC |
| `detectionStore.ts` | detection results, API keys, user groups, CLI compatibility/config | in-memory |
| `uiStore.ts` | tabs, dialogs, list UI state, sort state, token dialog state | Zustand `persist` with partialize |
| `routeStore.ts` | route workbench config, runtime status, probe data | in-memory + `localStorage` for sub-tab |
| `toastStore.ts` | toast queue | in-memory |
| `customCliConfigStore.ts` | custom CLI configs and model fetch state | manual save through IPC |

Examples:

1. `src/renderer/store/configStore.ts`
   updates config state optimistically, then persists with `window.electronAPI.saveConfig()`.

2. `src/renderer/store/uiStore.ts`
   uses Zustand `persist`, but only stores `sidebarDisplayMode` in persisted storage.

3. `src/renderer/store/detectionStore.ts`
   keeps `Set`-based membership state such as `detectingSites` and `cliTestingSites`.

4. `src/renderer/store/routeStore.ts`
   keeps feature-local route workbench state isolated from the rest of the app.

### Zustand selector stability

Zustand selectors used directly in React components must return a stable snapshot unless the
underlying store value changed. Do not allocate derived arrays or objects inside the selector, such
as `useToastStore(state => state.eventHistory.filter(...))`; React's `useSyncExternalStore`
integration can treat each render as a changed snapshot and enter a maximum-update-depth loop.

Preferred pattern:

```tsx
const eventHistory = useToastStore(state => state.eventHistory);
const actionEvents = useMemo(
  () => eventHistory.filter(event => event.kind === 'action'),
  [eventHistory]
);
```

Use this pattern for filtered/sorted store data that is consumed by dialogs, dense lists, or mounted
page surfaces.

### Canonical runtime projections

When a runtime result is persisted in a shared canonical cache, renderer state must distinguish the
canonical record from each surface-specific projection. Do not let one page's local state become an
independent source of truth for the same result.

Current rule:

- `routing.cliProbe.latest` is the canonical latest-result source for CLI probe/test outcomes.
- Route usability, site-management compatibility summaries, and the site-management CLI config
  dialog's per-model test result slots all project from that same source.
- Projection identity is `siteId + accountId + cliType + canonicalModel`; display keys such as
  site names are only renderer lookup keys.
- `cli_config.[cli].testResults` may keep the user's last dialog-local slot state, but a fresher
  `routing.cliProbe.latest` entry for the same configured test model must be shown as the latest
  result in the dialog instead of leaving the slot stale.
- Site-card CLI icons must also compare the projected compatibility timestamp with persisted
  `cli_config.[cli].testResults`; persisted slot state is only a fallback when it is newer or no
  canonical projection exists.
- After manual site-management tests or route/site detection probes persist new CLI samples, mounted
  consumers must reload or re-project the affected `routing.cliProbe.latest` data before declaring
  the workflow complete.
- Route log rows derive site priority from the current `routeStore.config.modelRegistry`, not from
  the persisted `RouteRequestLogItem`. Any route-store action that receives a fresh model registry
  from IPC, such as `upsertDisplayItem()` or `syncModelRegistrySources()`, must merge it into the
  loaded route config; if the full config is currently missing, the action must refetch
  `route:getConfig` so mounted consumers can recompute display-only route log fields from the latest
  registry.

### Account-scoped CLI config projections

Managed-site CLI config is persisted on accounts, not sites. Renderer startup and config reload
paths must therefore project `accounts[].cli_config` into the same per-account card identity that
the site-management list and side panel use.

Current rule:

- Use `siteName::accountId` for account card CLI config entries.
- Use the bare `siteName` key only for no-account legacy site config fallback.
- Do not load an account's CLI config into the bare site-name key; doing so makes every account row
  look like it shares the same CLI settings and can hide account-specific scheduled probe behavior.
- If an account lacks `cli_config`, renderer loading may fall back to `account.cached_data.cli_config`
  and then legacy `site.cli_config` for that account row.
- Tests that cover CLI config loading must assert the exact store key, not only the config object.

### Local component/page state

Keep local React state when the state is:

- only used by one page
- short-lived
- purely presentational
- too specific to justify polluting a global store

Examples:

1. `src/renderer/pages/SitesPage.tsx`
   owns many dialog toggles, anchor elements, selected config objects, and temporary form context.

2. `src/renderer/pages/CustomCliPage.tsx`
   keeps preview modal state, selected config id, testing flags, and local editing state inside the
   page container.

3. `src/renderer/components/AppInput/AppInput.tsx`
   keeps purely local UI state like password visibility and focus styling.

---

## When to Use Global State

Promote state to a store when:

- multiple pages/components need it
- it must survive remounts or tab switches
- it represents app-level state rather than one UI widget
- it mirrors persisted config or cached detection data

Keep it local when:

- only one page needs it
- it is temporary UI workflow state
- serializing it would create noise without value

Examples:

1. `uiStore.ts` holds active tab, dialog state, and persistent sidebar mode because those values are
   shared shell concerns.

2. `configStore.ts` holds the loaded config because many features read and mutate it.

3. `SitesPage.tsx` keeps backup dialog anchor/data locally because that state is page-specific.

---

## Server State

There is no separate client cache layer like React Query. Persistence is handled manually.

Actual patterns:

- Renderer reads/writes via `window.electronAPI`.
- Hooks orchestrate async workflows.
- Stores may own domain-specific save/refetch logic.
- Config and cached detection data are loaded at startup and then pushed into stores.

Examples:

1. `src/renderer/hooks/useDataLoader.ts`
   reads cached site/account data and writes the normalized result into stores.

2. `src/renderer/store/configStore.ts`
   persists config mutations directly through the Electron bridge.

3. `src/renderer/store/customCliConfigStore.ts`
   loads/saves custom CLI configs and fetches models through renderer-to-main bridge methods.

4. `src/renderer/store/routeStore.ts`
   fetches runtime status and route probe data on demand and stores the results locally.

---

## Common Mistakes

- Do not move page-only state into a global store just because the page is large.
- Do not persist every UI flag; keep persisted state minimal.
- Do not duplicate the same source of truth in both a store and local state unless there is a clear
  synchronization reason.
- Do not bypass shared stores with ad hoc module-level singletons.
- Do not return freshly allocated derived arrays/objects from a Zustand selector in a component.
  Subscribe to the raw store value first, then derive with `useMemo`.
- Do not forget race protection for async state updates; `routeStore.ts` uses `cliProbeRequestId`
  for a reason.
- Do not update only the initiating surface after writing a shared runtime cache. Bidirectional
  display expectations need tests for both directions, such as site-management manual CLI test ->
  route usability and route/site detection probe -> CLI config dialog model slot.
- Do not treat a registry-only route-store update as enough when `routeStore.config` is `null`.
  Mounted route log consumers need a complete config refresh before display fields such as site
  priority can update.
