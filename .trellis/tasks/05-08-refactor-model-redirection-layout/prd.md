# Refactor Model Redirection Layout

## Goal

Refactor the local Route page model redirection section from stacked cards into a Custom CLI style left-list/right-detail layout. The redesign should make model redirection rules easier to scan and edit while preserving all existing data, controls, and routing behavior.

## What I already know

* The user wants the model redirection card on the local Route page rebuilt as a two-pane layout similar to the Custom CLI page.
* The left pane should be a redirection model table/list.
* The left pane should have the primary list toolbar above the table/list.
* Each left-row first line should show the redirected model name, rule tag, and `site` source information.
* Each left-row second line should show concrete route rules and allow editing.
* Selecting a row should show the right pane with, top to bottom:
  * recover route path control
  * edit control
  * delete control
  * original model information
  * priority sorting table
* Existing information must not be lost.
* Existing behavior must not be affected.
* Initial code retrieval found the current implementation in `src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx`.
* Initial code retrieval found the comparable two-pane pattern in `src/renderer/pages/CustomCliPage.tsx`.

## Assumptions (temporary)

* This is a renderer-only refactor unless code inspection finds a missing shared contract or IPC change.
* Existing store actions, registry data shapes, and backend route behavior should stay unchanged.
* Existing model-name/original-model editor modal and route-rule editor modal should be reused; priority editing should move into the selected right detail pane.

## Open Questions

* None.

## Requirements (evolving)

* Replace the stacked redirection cards with a left-list/right-detail layout.
* Preserve existing controls for source sync, creation, route path recovery, route-rule editing, model editing, deletion, and priority updates.
* Move `同步来源` and `新增重定向` into a toolbar above the left redirection list.
* Remove the visible `重置默认重定向` action from the redesigned model redirection section.
* Preserve existing display data: canonical redirection name, selected original models, rule/mode labels, source/site context, suspended route path indicators, runtime route rule values, and priority details.
* Keep the Custom CLI page's dense operational layout style: selectable table/list on the left, selected item details/actions on the right.
* The left row first line should show the redirected model name, the manual/default rule label, and source/site summary.
* The left row second line should show route runtime rule details.
* The right pane should show a single selected-item action row first: recover route path, route-rule button, edit button, and delete button.
* The right pane should then show original model/source details and priority sorting details.
* The right pane should embed the priority sorting table for the selected redirection item rather than requiring a separate priority modal.
* Route runtime rule editing should continue to use the existing route-rule modal opened from the right-pane action row.
* Use fewer card-like containers: prefer table/list rows, section dividers, plain panels, and compact headers instead of repeated cards or nested cards.
* Do not change persisted route registry, route override, route runtime config, or priority config semantics.

## Acceptance Criteria (evolving)

* [ ] Route page model redirection uses a two-pane layout when display items exist.
* [ ] Left pane toolbar contains `同步来源` and `新增重定向`.
* [ ] The redesigned section does not show a `重置默认重定向` button.
* [ ] Left pane rows show redirected model name, rule label, site/source summary, and concrete route rule details.
* [ ] Selecting a left row updates the right detail pane without opening a modal.
* [ ] Right pane exposes route path recovery, route-rule, edit, and delete controls in one action row for the selected redirection item.
* [ ] Right pane exposes original model details and priority sorting controls for the selected redirection item.
* [ ] Route-rule editing still uses the existing modal flow and is reachable from the right-pane action row.
* [ ] The redesigned section minimizes card styling: no nested cards, no per-redirection card tiles, and no decorative card-heavy layout.
* [ ] Add/edit/delete/recover/priority save behavior remains functionally equivalent to the current implementation.
* [ ] Route-rule edits still persist through `upsertDisplayItem(...runtimeConfig...)` and preserve the existing validation bounds.
* [ ] Priority edits still persist through `upsertDisplayItem(...priorityConfig...)` and preserve existing site/API-key ordering behavior.
* [ ] Existing tests for model redirection continue to pass after updating layout assertions.
* [ ] No route registry or backend storage contract changes are introduced.

## Definition of Done (team quality bar)

* Tests added/updated for the new selected-row/detail-pane behavior.
* Existing route workbench tests updated instead of removed where behavior remains.
* Lint/typecheck pass for touched files.
* `PROJECT_INDEX.md` and relevant `FOLDER_INDEX.md` files updated only if module structure changes.
* Rollback risk is low because persisted data shape is unchanged.

## Out of Scope (explicit)

* Changing the route selection algorithm or backend proxy behavior.
* Changing the route model registry persistence format.
* Removing backend/store support for reset-defaults rebuild behavior; this task only removes the visible redesigned-section button.
* Introducing a new client-side router or moving Route page ownership.
* Redesigning Custom CLI page beyond using it as an interaction/layout reference.
* Direct inline editing of route runtime rule numeric fields inside the left table row.

## Technical Notes

* Current redirection implementation: `src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx`.
* Current page composition: `src/renderer/pages/RoutePage.tsx`.
* Reference layout: `src/renderer/pages/CustomCliPage.tsx`.
* Existing route redirection tests appear concentrated in `src/__tests__/route-workbench-redesign.test.tsx`.
* `ModelRedirectionTab` already owns the relevant local state: editor modal state, priority detail state, route-rule modal state, path reset state, missing-key expansion state, and create API-key dialog state.
* Existing display data comes from `buildDisplayItemViews(registry)`, `formatSourceSummary(entry.sources)`, `formatRouteRuntimeSummary(item.runtimeConfig)`, `getActiveRoutePathSuspensions(...)`, and `buildDetailSiteAccountGroups(...)`.
* Existing route-rule save flow validates `maxAttemptsPerRoutePath`, `successRateWindowMinutes`, `disableDurationMinutes`, and `minSuccessRatePercent`, then saves normalized runtime config through `upsertDisplayItem`.
* Existing priority save flow builds `sitePriorities` and `apiKeyPriorities` from sorted detail groups, then saves through `upsertDisplayItem`.
* Existing priority detail UI is already a compact table-like list with source/model/priority columns and movement controls; it is a strong candidate for extraction into a right-pane subcomponent.
* Existing tests assert the current stacked card structure (`redirect-card-list`, `redirect-card-item`, primary/secondary action clusters) and modal-based priority behavior. These should be rewritten to assert selected-row/detail-pane behavior rather than deleted wholesale.
* The user added a layout constraint to minimize card usage. Implementation should avoid per-item `article` card tiles and favor a Custom CLI style list/detail split with borders and dividers.
* Frontend guidelines relevant to implementation:
  * Keep route-specific UI under `src/renderer/components/Route/Redirection/`.
  * Reuse primitives such as `AppButton`, `AppCard`, and `AppModal` when the visual contract matches.
  * Use tokenized Tailwind classes and preserve accessibility labels for raw buttons/inputs.
  * Update tests for renderer behavior changes; run targeted Vitest coverage.

## Code Research Notes

### What the comparable Custom CLI layout does

* Uses one flex row with a left table/list and right detail/editor section: `flex flex-1 min-h-0 gap-4 p-4`.
* Left rows are clickable, use `data-selected`, and show dense summary columns.
* Right section displays details and actions for the selected row without navigating or changing persisted data shape.
* The layout keeps scroll ownership inside each pane with `min-h-0` and `overflow-y-auto`.

### Constraints from the current redirection component

* The component is large, but behavior is already centralized; a layout refactor can avoid store/type/backend changes.
* Priority details currently fetch full config through `window.electronAPI.loadConfig()` when opened. A persistent right pane should initialize the same data when selection changes or when the user explicitly opens/loads the priority section.
* The priority table includes nested API-key rows and missing-key creation. Moving it inline increases vertical density and must keep scroll boundaries stable.
* Existing route-rule editing is modal-based and should remain modal-based. Its button moves into the right-pane selected-item action row.

### Feasible approaches

**Approach A: Two-pane layout with embedded priority table and modal route-rule editor** (Chosen)

* How it works: left pane lists redirection items and shows route-rule summary. Right pane embeds a selected-item action row with recover route path, route-rule button, edit button, and delete button, followed by original model details and the existing priority table/save controls. The route-rule button opens the existing route-rule editor modal.
* Pros: Meets the main layout goal, moves priority sorting into the selected detail pane, preserves existing route-rule validation/modal lifecycle, and keeps implementation risk moderate.
* Cons: Route-rule editing remains modal-based; the second line is informational rather than directly editable.

**Approach B: Right-pane route-rule editor + embedded priority table**

* How it works: left pane lists redirection items and shows route-rule summary; selecting a row shows the right pane with actions, route-rule numeric fields, original model/source details, and priority table/save controls.
* Pros: Keeps editing concentrated in the selected detail pane and removes the route-rule modal without putting numeric editors inside every left-row.
* Cons: Requires refactoring route-rule draft/errors from modal lifecycle to selected-item detail lifecycle, so tests must cover selection changes and unsaved draft behavior.

**Approach C: Full inline row refactor**

* How it works: left pane row second line becomes an inline route-rule editor for the selected row, while right pane embeds actions, original model details, and priority sorting.
* Pros: Closest to direct row editing if every row needs in-place numeric fields.
* Cons: Larger state refactor, more layout/test churn, higher risk of regressions around validation, dirty draft state, cancel/save behavior, and scroll density.

**Approach D: Shell-first refactor with existing modals preserved**

* How it works: convert stacked cards into selectable left rows and right summary/actions, but keep priority sorting and route-rule editing in existing modals.
* Pros: Lowest risk and fastest implementation.
* Cons: Does not fully satisfy the requested right-pane priority sorting table.

## Expansion Sweep

### Future evolution

* The right pane can later support search/filtering by source site, account, original model, or suspended route path.
* The selected-row model can later support keyboard navigation and bulk operations if redirection items grow.

### Related scenarios

* Empty state, source sync, and create flow should remain visually consistent with the Route page header/list-toolbar actions.
* Custom CLI layout consistency matters, but the route page is denser and should preserve route-specific action ordering.

### Failure and edge cases

* If the selected item is deleted or source details become unavailable after sync/reset, selection should move to the next available item or show a stable empty detail state.
* If `loadConfig()` fails for priority details, original model data should still render and the priority table should degrade the same way the current modal does.

## Technical Approach

Implement Approach A. Keep the existing route registry and route rule persistence flows intact, while reshaping the `ModelRedirectionTab` render surface into:

* Left-list toolbar actions: sync sources and create redirection.
* Left pane: selectable redirection rows with redirected model name, mode/rule label, source summary, and route runtime summary.
* Right pane: selected item action row with recover route path, route-rule, edit, and delete controls; original model/source details including suspended-path indicators; embedded priority sorting table with save/reorder controls.
* Visual structure: one bounded redirection workspace is acceptable, but individual rows/details should use table/list/divider styling rather than nested cards.

The implementation should prefer extracting private render helpers/subcomponents inside `ModelRedirectionTab.tsx` only if it reduces local complexity without changing public module structure.

## Decision (ADR-lite)

**Context**: The current stacked card layout repeats actions per card and hides priority ordering behind a modal. The user wants a Custom CLI style list/detail workflow while preserving all existing information and route behavior.

**Decision**: Use Approach A: two-pane layout, embedded right-pane priority sorting table, and existing modal-based route-rule editing opened from the right-pane action row.

**Consequences**: This satisfies the main UX restructure while preserving the existing route-rule modal and validation lifecycle. Tests should shift from stacked-card structure assertions to selected-row/detail-pane behavior assertions, while keeping behavioral coverage for the modal route-rule save flow.

## Implementation Plan

* Step 1: Add selected redirection item state and stable fallback selection behavior when items load, delete, sync, or reset.
* Step 2: Replace stacked card rendering with the left-list/right-detail layout based on the Custom CLI page pattern, with sync/create controls above the left list.
* Step 3: Move selected-item actions into one right-pane row: recover route path, route-rule, edit, and delete.
* Step 4: Move original-model details into the right pane while preserving suspended-path indicators.
* Step 5: Embed the existing priority table and save/move controls into the right pane, keeping create API-key dialog behavior intact.
* Step 6: Update route workbench tests for the new layout and keep behavioral assertions for route-rule save, priority save, delete, and path recovery.
* Step 7: Run targeted tests for `route-workbench-redesign.test.tsx`; run lint/typecheck if touched scope or time warrants broader validation.
