# Route Data Trend Full X Axis Date

## Goal

When the route data page has less than a full `24h` or `7d` worth of analytics buckets, the
running trend chart should still render the complete x-axis date range for the selected window.

## Requirements

* The route overview running trend chart must build a complete time series for the selected
  window:
  * `24h`: hourly labels for the full 24-hour window.
  * `7d`: daily labels for the full 7-day window.
* Buckets with no route data must remain visible on the x-axis and contribute zero values to
  request, success, failure, token, slow-request, and first-byte metrics.
* Empty buckets before the first real bucket in the selected window must show only x-axis labels;
  they must not draw request bars or trend lines.
* Empty buckets after the first real bucket, including gaps in the middle of the window, must keep
  the existing empty-bucket rendering behavior.
* Existing scope filtering (`all`, site, custom CLI) must continue to apply before trend
  aggregation.
* Existing KPI, heatmap, scatter, and Sankey behavior is out of scope.

## Acceptance Criteria

* [ ] With only partial route bucket data, the `24h` trend chart exposes 24 x-axis labels.
* [ ] With only partial route bucket data, the `7d` trend chart exposes 7 x-axis labels.
* [ ] Leading empty dates/hours do not render request bars or success/TTFB line segments.
* [ ] Middle empty dates/hours after the first real bucket continue to render as the current empty
  bucket behavior.
* [ ] Existing non-empty buckets continue to aggregate into the matching hour/day.
* [ ] Empty buckets do not inflate route totals or percentile calculations.
* [ ] Relevant route overview tests pass.

## Definition of Done

* Tests added or updated for the partial-window trend axis behavior.
* Lint/type/test commands are run as appropriate for the touched area.
* No unrelated dirty files are reverted or included.

## Technical Approach

Update `src/renderer/pages/DataOverviewPage.tsx` so `buildRouteTrendPoints` pre-seeds a full set
of hour/day trend points for the selected window and then merges filtered route buckets into those
points. Anchor the generated range to the current time unless real buckets extend beyond that
anchor, so test and runtime data remain deterministic around existing analytics timestamps.

## Out of Scope

* Backend analytics storage changes.
* Route KPI calculations.
* Visual redesign of the chart.
* Changes to the header `24h` / `7d` controls.

## Technical Notes

* Main chart implementation: `src/renderer/pages/DataOverviewPage.tsx`.
* Existing tests: `src/__tests__/data-overview-page.test.tsx`.
* Project index already identifies the route view as the owner for running trend, model heatmap,
  channel scatter, and Sankey visualizations.
