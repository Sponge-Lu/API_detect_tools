# brainstorm: merge latest site test results display

## Goal

Unify CLI test results and site detection results so both site management and site detection surfaces show the merged latest detection state consistently. Update the site detection history display to focus on 7-day history, group multiple model results from the same detection run into one history bar, and expose per-model details through hover interactions.

## What I already know

* The current site management CLI test results and site detection results appear to be stored or surfaced together, but the UI does not consistently show the merged latest result in both places.
* The site detection page should show only 7-day results and remove the 24-hour result display.
* For one detection run with multiple tested models, the results should render in a single history bar.
* History bar color should be derived from all model outcomes in that run:
  * all successful: green
  * all failed: red
  * mixed success/failure: orange
* Hovering the history bar should show multiple tested model results.
* Each tested model summary shown in the history bar hover should be limited to 200 characters.
* Hovering the model test result under the bar should keep the current display behavior.
* Code inspection shows manual site-management tests are persisted into `routing.cliProbe` with `source: siteManual`.
* Code inspection shows immediate/scheduled site detection tests are persisted into the same `routing.cliProbe` structure with `source: routeProbe`.
* The site detection/CLI usability UI currently has a `24h` / `7d` time range toggle, with `24h` as the default.
* The current history bar renderer flattens per-model history samples into individual bars instead of grouping multiple model samples from the same detection run.
* `RouteCliProbeSample` currently has `sampleId`, `probeKey`, `siteId`, `accountId`, `cliType`, model fields, result details, source, and `testedAt`, but no explicit run/batch id.

## Assumptions (temporary)

* "CLI test results" means test records created from the site management CLI/test action, not a separate command-line application outside Electron.
* "Site detection results" means records rendered on the site detection page history UI.
* The desired merge is at display/query level unless code inspection shows separate persistence paths that need normalization.
* A "same detection run" will be identified from a new explicit detection run/batch id on newly generated records.

## Open Questions

* None currently.

## Requirements (evolving)

* Site management and site detection must both show the merged latest result across CLI-originated tests and site-detection-originated tests.
* Site detection history must show a 7-day view and remove the 24-hour result display.
* Multiple model results from the same detection run must be represented by one history bar.
* Grouping must be based on a new explicit detection run/batch id on newly generated samples.
* Old samples without the new run/batch id do not need compatibility grouping; they can be ignored for grouped history display or treated as ungroupable legacy data according to the smallest safe implementation.
* History bar color must reflect aggregate run state: green for all success, red for all failure, orange for mixed.
* History bar hover must list per-model results, with each model summary capped at 200 characters.
* Existing hover behavior for model test results below the history bar must remain unchanged.

## Acceptance Criteria (evolving)

* [x] A site with latest CLI test and site detection records shows the same merged latest result in both site management and site detection.
* [x] Site detection no longer displays a 24-hour history/result block.
* [x] Site detection displays the last 7 days of history.
* [x] One new detection run with multiple model results sharing the same run/batch id renders as one history bar.
* [x] Old records without the new run/batch id are not required to participate in grouped history behavior.
* [x] History bar aggregate colors match all-success/all-failure/mixed result combinations.
* [x] Hovering a grouped history bar shows every tested model result, with each summary truncated to 200 characters.
* [x] Hovering the individual model test result under the bar preserves the existing UI behavior.

## Definition of Done (team quality bar)

* Tests added/updated where the data grouping and display behavior can be verified.
* Lint/typecheck/test commands relevant to changed files pass.
* Project index files updated if modules are added or removed.
* Behavior changes documented in task notes or specs if they create a reusable UI/data pattern.

## Out of Scope (explicit)

* Changing provider/model testing semantics beyond display/query merging.
* Adding new chart libraries unless existing rendering cannot support grouped bars/tooltips.
* Redesigning unrelated site management or site detection UI.

## Technical Notes

* Task directory: `.trellis/tasks/05-09-merge-latest-site-test-results`
* Relevant UI: `src/renderer/components/Route/Usability/CliUsabilityTab.tsx`
  * `TimeRange = '24h' | '7d'`
  * `CLI_PROBE_TIME_RANGES = ['24h', '7d']`
  * `HistoryBars` builds `HistorySlot[]` from flattened per-model samples.
  * `buildHistoryTooltip` currently handles one model/sample per bar.
  * `buildModelResultTooltip` controls the existing model-result hover below the bar and should remain unchanged.
* Relevant renderer store: `src/renderer/store/routeStore.ts`
  * `cliProbeTimeRange` defaults to `24h`.
  * `fetchCliProbeData(timeRange)` calls `route:get-cli-probe-view` with the selected window.
* Relevant persistence/data flow:
  * `src/main/handlers/cli-compat-handlers.ts` maps manual CLI compatibility samples to `RouteCliProbeSample` and persists them with `source: siteManual`.
  * `src/main/route-cli-probe-service.ts` persists immediate/scheduled route probe samples with `source: routeProbe`.
  * `src/main/route-cli-probe-service.ts#getCliProbeView` returns model views with latest sample fields and summarized per-model history.
  * `src/renderer/services/cli-compat-projection.ts` projects `routing.cliProbe.latest` back into the site management compatibility cards.
* Existing tests to update:
  * `src/__tests__/cli-usability-tab.test.tsx`
  * `src/__tests__/route-cli-probe-service.test.ts`
  * likely `src/__tests__/useCliCompatTest.test.ts` if default/fetch behavior changes from `24h` to `7d`.

## Implementation Notes

* Added optional `RouteCliProbeSample.probeRunId` to identify one generated detection batch.
* Added `generateProbeRunId()` in `src/main/route-cli-probe-service.ts`.
* `runCliProbeNow()` assigns the same `route_*` run id to every sample from one immediate/scheduled probe run.
* `cli-compat:save-result` assigns the same `manual_*` run id to every sample from one site-management manual test save.
* `CliUsabilityTab` now:
  * fixed-loads `7d` data,
  * removes the `24h` / `7d` switch and the component-local `24h` history config,
  * groups history bars by `probeRunId`,
  * colors grouped bars green/red/orange for all-success/all-failure/mixed,
  * shows grouped per-model hover details with 200-character history summaries,
  * keeps model-row hover behavior on the existing tooltip path.
* Manual test persistence refresh now reloads route CLI probe data with `7d`.
* Verification:
  * `npm test -- src/__tests__/route-workbench-redesign.test.tsx src/__tests__/cli-usability-tab.test.tsx src/__tests__/route-cli-probe-service.test.ts src/__tests__/useCliCompatTest.test.ts src/__tests__/unified-cli-config-dialog.test.tsx`
  * `npm run build:main`
  * `npm run build:renderer`
  * `npm run lint` passed with 0 errors and existing warning-level findings.

## Research Notes

### Constraints from our repo/project

* Both manual and route probe results already share `routing.cliProbe`, so the merge should preserve that as the single source of truth.
* The main missing datum for exact grouping is a run/batch identifier.
* The UI currently uses native `title`/`aria-label` hover text for history bars, so multiline grouped tooltip content can be implemented without introducing a new tooltip library unless richer styling is required.

### Feasible approaches here

**Approach A: Add explicit run id for new data** (Selected)

* How it works: add an optional run/batch field to `RouteCliProbeSample`; assign the same id to all samples produced by one manual compatibility test or one route probe run; group history bars by that id.
* Pros: stable grouping for new data; makes future batch-level UI and diagnostics easier.
* Cons: touches shared type, persistence creation sites, route probe service tests, and UI tests; old history without the field will not be grouped.

**Approach B: Display-only time-bucket grouping**

* How it works: leave persisted data unchanged; group samples in the history renderer by site/account/CLI plus a time bucket.
* Pros: smaller code change; no data model change.
* Cons: can incorrectly merge separate runs close in time or split one slow sequential run across buckets; less reliable for manual tests that run models sequentially.

**Approach C: Backend view-only grouping without persisting run id**

* How it works: keep stored samples unchanged, but have `getCliProbeView` return pre-grouped history events based on backend time heuristics.
* Pros: reduces UI logic complexity.
* Cons: still heuristic; changes API shape more than Approach B without gaining exact grouping.

## Decision (ADR-lite)

**Context**: History bars must represent one detection run, but current samples only have per-sample ids and timestamps. Timestamp inference can merge separate runs or split one slow run.

**Decision**: Add an explicit run/batch id for newly generated CLI probe samples and use that id as the grouping key. Do not implement legacy compatibility grouping for old samples without this field.

**Consequences**: New data has deterministic grouping. Existing old history may not appear in the new grouped history behavior, which is acceptable for this task.
