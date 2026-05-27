# brainstorm: unify cli compatibility persistence

## Goal

Unify persistence and presentation rules for CLI compatibility results between the Sites page and
the CLI Usability view, while keeping Custom CLI test results isolated because they represent
standalone user-defined configurations that are not shown in the route-level CLI Usability page.

## What I already know

* Sites page CLI compatibility tests currently save summary results into
  `cached_data.cli_compatibility`.
* Sites page unified CLI config dialog also persists per-model `testResults` inside `cli_config`.
* Route CLI Usability uses a separate `routing.cliProbe.{config,latest,history}` persistence model.
* Custom CLI test results are stored separately under `custom-cli-configs.json` as
  `cliSettings[*].testState`.
* The user wants Sites page and CLI Usability to share one compatibility result source, and Sites
  page should always show the latest result regardless of which page triggered the test.
* The user wants CLI Usability history bars collapsed to one line per CLI/site instead of three
  model-specific lines, while latest per-model details can still be shown below.

## Assumptions (temporary)

* "CLI compatibility result" here refers to route probe / real test execution outcome, not merely
  saved config state.
* Custom CLI remains out of the shared persistence flow because its configs are not part of route
  site/account usability views.
* We should preserve enough detail for latest per-model display even if history visualization is
  collapsed.

## Open Questions

* None currently.

## Requirements (evolving)

* Keep Custom CLI test results persisted independently from site/route compatibility data.
* Unify persistence for Sites page CLI compatibility and Route CLI Usability compatibility tests.
* Sites page should always display the newest unified compatibility result, regardless of where the
  test originated.
* Sites page card display is account-first; if the current card has no own latest result, it may
  fall back to the site's newest route-origin result with explicit source labeling.
* Route CLI Usability history chart should render one aggregated history row instead of three
  model-specific rows.
* Route CLI Usability should still show latest per-model test detail information below the
  aggregated history.
* Collapsed CLI Usability history bars use optimistic aggregation: if any model in the bucket
  succeeds, the bucket is shown as success.
* Unified compatibility persistence keeps detailed Codex/Gemini protocol metadata
  (`responses` / `native` / `proxy`) so Sites page can preserve existing detailed hints and config
  generation.

## Acceptance Criteria (evolving)

* [ ] A test triggered from Sites page updates the same compatibility source consumed by CLI
      Usability.
* [ ] A test triggered from CLI Usability updates the same compatibility source consumed by Sites
      page.
* [ ] Sites page shows the newest result after either page performs a test.
* [ ] Sites page prefers account-specific latest result and falls back to site-level latest route
      result with a source label when necessary.
* [ ] Unified compatibility persistence retains Codex/Gemini detail fields used by Sites page.
* [ ] Custom CLI test persistence remains isolated and unaffected.
* [ ] CLI Usability history chart renders one aggregated row per CLI/site(account) grouping.
* [ ] Aggregated history uses "any success means success" for each bucket.
* [ ] CLI Usability still shows latest per-model detail for the most recent test set.

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* Changing Custom CLI persistence format or merging Custom CLI into route usability.
* Redesigning unrelated route metrics, proxy stats, or site refresh flows.
* Refactoring the entire routing config schema beyond what is needed for unified compatibility
  persistence.

## Technical Notes

* Current Sites page persistence entry points:
  `src/main/handlers/cli-compat-handlers.ts`,
  `src/renderer/hooks/useCliCompatTest.ts`,
  `src/renderer/components/dialogs/UnifiedCliConfigDialog.tsx`,
  `src/renderer/pages/SitesPage.tsx`
* Current Route CLI Usability persistence entry points:
  `src/main/route-cli-probe-service.ts`,
  `src/main/handlers/route-handlers.ts`,
  `src/renderer/store/routeStore.ts`,
  `src/renderer/components/Route/Usability/CliUsabilityTab.tsx`
* Current Custom CLI persistence entry points:
  `src/main/handlers/custom-cli-config-handlers.ts`,
  `src/renderer/store/customCliConfigStore.ts`,
  `src/renderer/pages/CustomCliPage.tsx`

## Research Notes

### What the current code already implies

* Sites page reads compatibility from `cached_data.cli_compatibility` during startup hydration via
  `useDataLoader`.
* Sites page uses `cli_config.testResults` for per-model slots in the unified CLI config dialog.
* Route CLI Usability uses `routing.cliProbe.latest/history` as its only history-capable data
  source.
* Route CLI Usability currently renders three stacked history segments because history is grouped by
  model, not by one aggregated test batch.
* `cli_compatibility` already belongs to runtime cache semantics, while `cliProbe` is persisted in
  routing config. Today they are parallel stores for related truth.

### Constraints from this repo

* If Sites page must always show the newest result from either page, we need a single canonical
  source or deterministic projection rule.
* If CLI Usability keeps historical bars, `cli_compatibility` alone is insufficient because it only
  stores one latest summary, not historical samples.
* Custom CLI cannot be merged into route usability without adding new route-level concepts that do
  not exist today.

### Feasible approaches here

**Approach A: Make `routing.cliProbe` the canonical compatibility store** (Recommended)

* How it works:
  Sites page tests also write probe-style samples/latest, then Sites page reads a projected latest
  compatibility view from `cliProbe`.
* Pros:
  One canonical history-capable source; Route page stays natural; Sites page can always project the
  newest result.
* Cons:
  Requires projection logic for Sites page summary compatibility and potentially writing probe
  samples from manual site tests.

**Approach B: Keep `cli_compatibility` as summary source and backfill from `cliProbe`**

* How it works:
  Route probe continues writing `cliProbe`, then additionally updates `cached_data.cli_compatibility`
  with a latest summary projection.
* Pros:
  Smaller Sites page display changes.
* Cons:
  Still dual-write; higher drift risk; history remains elsewhere.

**Approach C: Dual-read with timestamp arbitration**

* How it works:
  Keep both stores; Sites page compares timestamps from `cli_compatibility` and `cliProbe.latest`
  and shows the newer one.
* Pros:
  Lower migration cost.
* Cons:
  Two truths remain; long-term maintenance cost is worst.

### Initial recommendation

* Use Approach A for canonical compatibility truth.
* Keep `cli_config.testResults` for per-model UI state in Sites page config dialogs.
* Keep Custom CLI `testState` isolated in `custom-cli-configs.json`.

## Decision (ADR-lite)

**Context**: CLI Usability currently renders three stacked history segments because probe history is
tracked per model, but the desired UI is a single-row history with detailed latest model results
shown below.

**Decision**: Aggregate each history bucket optimistically: if any model tested in the bucket
succeeds, the bucket is shown as success.

**Consequences**:

* The compressed history row reflects whether the CLI had at least one usable model in that time
  bucket.
* Failure-only buckets remain visible as failure.
* Mixed success/failure buckets lose per-model distinction in the bar itself, so latest model detail
  remains necessary below.

## Decision (ADR-lite) - Sites Page Latest Ownership

**Context**: Sites page is rendered per account card, while Route CLI Usability currently probes only
one selected account per site.

**Decision**: Sites page display is account-first. If the current card has no own latest result, it
falls back to the site's newest route-origin result and explicitly labels the source.

**Consequences**:

* Sites page can satisfy "always show latest result" without discarding account semantics.
* Users still need source labeling to avoid confusing route fallback with a direct test of the
  current account.

## Decision (ADR-lite) - Detail Preservation

**Context**: Route probe already executes detail-capable tests for Codex and Gemini, but the current
`cliProbe` schema only persists coarse success/failure status.

**Decision**: Extend unified `cliProbe` persistence to retain Codex `responses` detail and Gemini
`native/proxy` detail so Sites page can continue rendering detailed hints and generating configs
without relying on a second compatibility store.

**Consequences**:

* Unified compatibility truth remains single-source instead of falling back to dual storage.
* Route-side persistence schema and projections need to grow slightly.
* Sites page can keep current UX fidelity after the compatibility source is unified.

## Decision (ADR-lite) - Legacy Migration

**Context**: Existing users may already have visible compatibility summaries stored only in legacy
`cached_data.cli_compatibility`. If the app switches to `cliProbe` as the canonical source without
migration, Sites page could temporarily lose the latest visible status until the next real test.

**Decision**: On load/normalization, migrate legacy `cli_compatibility` into `routing.cliProbe.latest`
only. Do not fabricate `cliProbe.history`.

**Consequences**:

* Existing users keep a latest visible result immediately after upgrade.
* History remains semantically clean because only real probe/manual samples appear there.
* Migration must synthesize deterministic latest keys and mark origin/source metadata for fallback
  display.

## Technical Approach

1. Extend `route-proxy` probe types so latest/history-capable records can retain:
   * test origin/source
   * Codex detail (`responses`)
   * Gemini detail (`native/proxy`)
2. Route probe service writes those detail fields instead of discarding them.
3. Sites page manual compatibility test writes into the same `cliProbe` persistence model.
4. Add a projection layer from `cliProbe.latest` to Sites page compatibility display:
   * prefer exact account-card latest
   * otherwise fall back to latest site-level route-origin result
   * expose source label for tooltip/UI
5. Keep `cli_config.testResults` unchanged for dialog-local per-model slot UI state.
6. Keep Custom CLI `testState` unchanged in `custom-cli-configs.json`.
7. Change CLI Usability history rendering from per-model stacked bars to one aggregated row per CLI
   with optimistic bucket aggregation ("any success means success"), while keeping latest per-model
   detail rows below.
8. During config load/normalization, backfill legacy `cached_data.cli_compatibility` into
   `routing.cliProbe.latest` without generating fake history.

## Implementation Plan (small PRs)

* PR1: Extend shared route probe types + persistence + legacy migration + tests.
* PR2: Unify manual Sites page compatibility writes onto `cliProbe` and add Sites page projection /
  source-label display.
* PR3: Update CLI Usability aggregated history rendering and latest detail view tests.
