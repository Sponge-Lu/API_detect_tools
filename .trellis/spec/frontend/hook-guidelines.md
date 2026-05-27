# Hook Guidelines

> How hooks are used in this project.

---

## Overview

Hooks are the main place for reusable renderer-side business logic. They typically do one or more of
the following:

- coordinate IPC calls
- normalize shared data for the UI
- manage timers or lifecycle-sensitive behavior
- encapsulate feature workflows that would otherwise bloat page components

This project does not use React Query, SWR, or another dedicated frontend data-fetching library.
Hooks and stores call `window.electronAPI` directly.

---

## Custom Hook Patterns

### Preferred shape

- Accept a single options object when a hook needs multiple dependencies or callbacks.
- Return named methods/state in an object, not a tuple.
- Keep the hook focused on one domain workflow.
- Move repeatable page logic into a hook only when it is reused or too large to leave inline.

Examples:

1. `src/renderer/hooks/useDataLoader.ts`
   - accepts injected setters and optional CLI-detection helpers
   - returns a single named action: `loadCachedData`
   - transforms cached account/site data before pushing it into stores

2. `src/renderer/hooks/useAutoRefresh.ts`
   - accepts `sites`, `accounts`, `detectSingle`, and callback handlers in one options object
   - returns `activeTimerCount`
   - uses refs to avoid stale closures inside intervals

3. `src/renderer/hooks/useSiteGroups.ts`
   - owns dialog-local state and group-management actions
   - relies on injected `saveConfig`, `showDialog`, and `showAlert` callbacks instead of importing
     every dependency directly

4. `src/renderer/hooks/useTheme.ts`
   - owns a small focused concern: theme persistence and DOM application
   - keeps side effects local to the hook

---

## Data Fetching

Actual current pattern:

- Async work is performed with `window.electronAPI` calls.
- Hooks either call IPC directly or receive async callbacks from the caller.
- Stores may also own persistence/refetch logic when it is clearly store-domain logic.

Examples:

1. `useDataLoader.ts`
   reads cached config-derived data and optionally triggers CLI config detection.

2. `useAutoRefresh.ts`
   repeatedly calls the injected `detectSingle` async function on a timer.

3. `useTheme.ts`
   saves theme mode both to `localStorage` and to `window.electronAPI.theme.save`.

4. `useCheckIn.ts` and `useCredit.ts`
   call Electron bridge methods directly inside hook logic when the hook owns that workflow.

Implication for new code:

- Do not introduce a separate fetch library unless the architecture actually changes.
- Prefer existing IPC-first patterns over adding browser-only REST clients in the renderer.
- When a hook initializes from cached data and then performs a live status probe, treat the cached
  data as a fallback view until the probe succeeds; do not discard the cached UI just because the
  status probe failed or the IPC status endpoint was temporarily unavailable.

---

## Naming Conventions

- Hooks are named `useX`.
- Public hooks are re-exported from `src/renderer/hooks/index.ts` when they are part of the normal
  renderer surface.
- Co-locate hook-specific exported types next to the hook when the type is part of the hook
  contract.

Examples:

1. `hooks/index.ts` re-exports `useDataLoader`, `useTheme`, `useSiteDetection`,
   `useSiteGroups`, `useAutoRefresh`, and related types.

2. `useAutoRefresh.ts` exports both `UseAutoRefreshOptions` and `UseAutoRefreshReturn`.

3. `useTokenManagement.ts` exports `NewApiTokenForm`, which is then imported by pages.

---

## Common Mistakes

- Avoid stale-closure bugs in timers or subscriptions; use refs like `useAutoRefresh.ts`.
- Avoid duplicating shared key-building or cache-normalization logic in multiple pages.
- Avoid long positional hook parameter lists when an options object is clearer.
- Avoid hiding IPC shape changes inside hooks without updating shared types and bridge typings.
- Avoid copying legacy `alert(...)` validation branches into new hooks.
- Avoid swallowing async action failures after only updating local hook state. If the caller needs to
  show a toast, disable a button, or branch on success/failure, rethrow the error after recording
  local `error` state.
