# Data Overview Page

## Goal

Create a dedicated top-level page named `数据总览`, place it as the first primary navigation entry,
and use it as the app's unified metrics landing page. The page should combine route analytics with
site-level balance / consumption information so users can understand overall system health, traffic
quality, and resource consumption from a single screen, including persisted historical data where
needed.

## What I already know

* The current route overview page (`src/renderer/pages/RoutePage.tsx`) embeds a small `StatsDashboard`
  beside the server card and the model redirection surface.
* The current dashboard only shows four values:
  * total requests
  * success rate
  * prompt tokens
  * completion tokens
* The current dashboard only supports `24h` and `7d` windows, even though the main-process analytics
  service already supports `24h`, `7d`, and `30d`.
* The analytics backend already aggregates data by multiple dimensions:
  * time window
  * CLI type
  * route rule
  * canonical model
  * site
  * account
* The analytics bucket schema already contains:
  * request count
  * success / failure / neutral counts
  * prompt / completion / total tokens
  * status-code histogram
  * total latency histogram
  * first-byte latency histogram
* The app also already keeps route request logs for the current running session, with fields such as
  CLI type, requested / canonical / resolved model, route rule, site, account, status code, latency,
  first-byte latency, outcome, and error.
* Site / account detection already persists the latest balance and today's usage-related values:
  * `balance`
  * `today_usage`
  * `today_prompt_tokens`
  * `today_completion_tokens`
  * `today_requests`
  * `last_refresh`
* Those site/account values are stored as latest snapshots in persisted config/runtime cache, not as
  historical time-series arrays.
* Linux Do Credit already has a separate persisted history-like data source:
  * `cachedDailyStats`
  * `cachedTransactions`
  * persisted by `CreditService` to `credit-settings.json`
* A new standalone page is feasible within the current app shell:
  * page registration lives in `src/renderer/components/AppShell/pageMeta.ts`
  * sidebar rendering lives in `src/renderer/components/Sidebar/VerticalSidebar.tsx`
  * page mounting lives in `src/renderer/App.tsx`
* Current top-level page order is driven by `APP_PAGE_ORDER`, which currently starts with `sites`.
  Moving `数据总览` to the first position is a localized shell/navigation change plus related tests.

## Assumptions (temporary)

* This brainstorm is about information architecture and product scope first, but persistence choices
  must be explicit because they affect backend scope.
* The route overview page should become lighter after extraction, keeping route operation/config
  content and linking into `数据总览` when needed.
* Route analytics history can be reused from existing persisted buckets for MVP.
* Site balance / usage history cannot be shown as a true trend unless the app starts persisting
  snapshots over time beyond the current latest-value cache.

## Open Questions

* None for MVP.

## Requirements (evolving)

* Add a new top-level page named `数据总览`.
* Place `数据总览` as the first primary navigation entry in the sidebar.
* Move route statistics out of the current route overview page so the route page is no longer
  responsible for both operation/config and analytics browsing.
* Expand the new page beyond route-only analytics; it must also surface site-level balance /
  consumption information.
* The page must expose more than the current four-number route dashboard.
* The page should make it easy to answer at least these questions:
  * Is the route layer healthy?
  * Which sites are consuming the most resources?
  * Which sites currently have the highest / lowest balance?
  * Which CLI / model / site is contributing most traffic?
  * Where are failures concentrated?
  * Is latency getting worse?
  * Where should the user drill down next?
* The page should support time-range switching and surface trends, not just snapshot totals.
* Route analytics and site resource information should be visually distinct but live on the same
  page.
* Historical data that users expect to still exist after reopening the app must be persisted.
* Site balance / consumption history for MVP should be persisted as daily snapshots so historical
  trends remain visible after app restart without introducing high-frequency noisy storage.
* The default site-resource view on `数据总览` should be site-aggregated rather than account-expanded.
* Account-level differences should be available as drill-down detail rather than being the default
  first-screen grouping.
* Route rules must be explainable in the UI rather than shown as raw names only.
* Wherever route rules are surfaced in overview/ranking/log-related UI, the user should be able to
  understand at least:
  * which CLI the rule applies to
  * what model pattern it matches
  * what scope restrictions apply (site/account/API key group)
  * why this rule is selected before other rules (priority / matching specificity)
* The route-rule representation should include a human-readable summary sentence plus compact tags,
  not only internal field names.
* Site daily snapshots for MVP should persist:
  * balance
  * today usage / consumption
  * today request count
  * today prompt tokens
  * today completion tokens
  * derived total tokens
  * snapshot date / capture time
* The page should use display forms that match the data shape:
  * KPI cards for top-level health
  * trend charts for time evolution
  * histograms for latency / status-code distributions
  * ranked tables or bars for CLI / model / site comparisons
  * ranked tables or bars for site balance / consumption comparisons
  * log linkage for diagnosis
* The site/business section should include a daily check-in overview based on persisted detection cache data.
* Sites in the built-in `unavailable` group should not be shown in the data-overview site/business panels.
* The overview page should visually separate site/business data from route/runtime data instead of mixing them in one KPI band.
* The overview page should switch between site/business data and route/runtime data via top buttons, similar to the logs page view switch pattern.

## Acceptance Criteria (evolving)

* [ ] A concrete information architecture exists for `数据总览`.
* [ ] `数据总览` is defined as the first top-level navigation destination.
* [ ] The proposed page structure is grounded in data already available in the codebase.
* [ ] The proposal distinguishes route analytics, site resource metrics, and drill-down dimensions.
* [ ] The proposal defines which information should remain on `路由` and which moves to `数据总览`.
* [ ] The proposal explicitly states which currently persisted data can be reused as-is and which
      historical site metrics require new persistence.
* [ ] The MVP persistence strategy for site history is fixed as daily snapshots.
* [ ] The default resource overview grain is fixed as site-aggregated.
* [ ] The MVP snapshot schema is fixed as balance + consumption + request/token metrics.
* [ ] Route-rule visibility requirements are fixed as explainable UI, not rule-name-only display.
* [ ] MVP scope and non-MVP items are explicit.

## Definition of Done (team quality bar)

* PRD captures the agreed data-overview page scope
* Key display modules and data sources are identified
* Implementation can proceed without re-discovering product requirements

## Out of Scope (explicit)

* Replacing the route request log page entirely
* Deep BI-style custom reporting or arbitrary query builder UX
* Rebuilding the existing LDC credit workflow itself

## Research Notes

### Constraints from the current codebase

* Current renderer card: `StatsDashboard` in
  `src/renderer/components/Route/ProxyStats/ProxyStatsTab.tsx`
* Current summary API: `route:get-analytics-summary`
* Current distribution API: `route:get-analytics-distribution`
* Current request-log API: `route:get-request-logs`
* Current analytics types:
  * `RouteAnalyticsBucket`
  * `RouteRequestLogItem`
* Current site detection persistence:
  * latest values are persisted in site/account cache fields such as `balance`, `today_usage`,
    `today_prompt_tokens`, `today_completion_tokens`, `today_requests`, `last_refresh`
  * runtime cache file path is `userData/runtime-cache.json`
  * this is latest-state persistence, not historical snapshots
* Current LDC persistence:
  * `CreditService` persists `cachedInfo`, `cachedDailyStats`, and `cachedTransactions` into
    `userData/credit-settings.json`
* Current site metric sources:
  * latest values already come from persisted detection cache/runtime cache fields such as `balance`,
    `today_usage`, `today_prompt_tokens`, `today_completion_tokens`, `today_requests`
  * those values can seed the first daily snapshot mechanism instead of requiring a separate fetch path
* Existing page-pattern references:
  * sidebar/page metadata registry in `src/renderer/components/AppShell/pageMeta.ts`
  * top-level page mounting in `src/renderer/App.tsx`
  * logs page layout in `src/renderer/pages/LogsPage.tsx`

### Feasible approaches here

**Approach A: Overview page with latest site snapshots only**

* How it works:
  * route overview uses persisted analytics buckets
  * site section only shows currently persisted latest site-aggregated balance / usage snapshots
  * no new site-history persistence model
* Pros:
  * fastest to build
  * reuses existing persisted data almost entirely
* Cons:
  * users cannot see true historical balance/consumption trends after restart
  * weaker match to the new requirement about historical visibility

**Approach B: Layered data overview with daily site snapshots** (recommended)

* How it works:
  * section 1: global overview KPIs
  * section 2: route traffic and quality trends
  * section 3: site-aggregated balance / consumption overview and daily trends
  * section 4: dimension ranking by CLI / model / site
  * section 5: diagnostic distributions and anomaly / log entry points
  * add a lightweight persisted daily snapshot store for site balance/usage
* Pros:
  * balanced between scanability, resource awareness, and diagnosis
  * satisfies the request for reopening the app and still seeing history
  * daily snapshots are enough for trend direction without excessive storage volume
* Cons:
  * adds a new persistence surface for site metrics

**Approach C: Full unified analytics workbench**

* How it works:
  * adds richer filters plus more granular site-history persistence
* Pros:
  * highest analytical power
* Cons:
  * much heavier UX and backend scope

## Technical Notes

* Code references inspected:
  * `src/renderer/pages/RoutePage.tsx`
  * `src/renderer/components/Route/ProxyStats/ProxyStatsTab.tsx`
  * `src/renderer/pages/CreditPage.tsx`
  * `src/renderer/components/SiteCard/SiteCard.tsx`
  * `src/renderer/components/SiteCard/SiteCardHeader.tsx`
  * `src/renderer/store/routeStore.ts`
  * `src/main/route-analytics-service.ts`
  * `src/main/handlers/route-handlers.ts`
  * `src/main/api-service.ts`
  * `src/main/runtime-cache-manager.ts`
  * `src/main/credit-service.ts`
  * `src/shared/types/route-proxy.ts`
  * `src/shared/types/site.ts`
  * `src/renderer/components/AppShell/pageMeta.ts`
  * `src/renderer/App.tsx`
  * `src/renderer/pages/LogsPage.tsx`
* Evidence captured from code:
  * Current route page embeds statistics rather than dedicating a separate navigation destination.
  * Current renderer dashboard underuses the analytics data already collected by the main process.
  * Existing analytics data is already rich enough for trends, distributions, ranking, and drill-down
    entry points.
  * Current site/account balance and usage values are persisted, but only as latest snapshots.
  * Current persisted time-series style history already exists for route analytics and LDC credit, not
    for generic site balance/usage.
  * User decision confirmed: `数据总览` should be the first top-level page and replace the earlier
    `路由统计` naming/scope.
  * User decision confirmed: site balance/consumption history should use daily snapshots for MVP.
  * User decision confirmed: the default homepage resource grain should be site-aggregated, with
    account detail treated as drill-down rather than the main overview layer.
  * User decision confirmed: the daily snapshot schema should include balance, consumption, request
    count, prompt tokens, completion tokens, and total tokens for MVP.

## Technical Approach

1. Add a new top-level `数据总览` page and move it to the first sidebar position.
2. Keep `路由` as an operations/configuration page and replace the embedded stats surface with a
   lightweight summary + link into `数据总览`.
3. Build the `数据总览` page in layered sections:
   * top KPI overview
   * route trends
   * site resource overview
   * site daily trends
   * diagnostic distributions
   * anomaly/log entry points
   * route-rule ranking/summary with explainable rule descriptions
4. Reuse persisted route analytics buckets for route history/trends.
5. Introduce a lightweight persisted daily snapshot store for site-aggregated metrics with fields:
   * siteId
   * snapshotDate
   * capturedAt
   * balance
   * todayUsage
   * todayRequests
   * todayPromptTokens
   * todayCompletionTokens
   * totalTokens
6. Populate site daily snapshots from the already persisted latest detection cache/runtime values,
   avoiding a second independent metrics collection pipeline in MVP.
7. Keep account-level resource differences as drill-down data, not default homepage grouping.
8. Represent route rules with an explainable view-model that can render:
   * a human-readable summary sentence
   * CLI label
   * match type + pattern
   * scope tags
   * priority cue / selection reason
   This representation should be reusable in the overview page and route-related log/detail surfaces.
9. Update sidebar/page registration, top-level page rendering, persistence contracts, and relevant
   renderer/main tests.

## Decision (ADR-lite)

**Context**: The app currently splits operational information across multiple pages and underuses the
persisted route analytics data. It also persists only the latest site balance/usage snapshot, which
is insufficient for a homepage-style overview that still makes sense after restart.

**Decision**: Introduce a first-position top-level page named `数据总览` as the default metrics landing
page. Use existing route analytics buckets for route history. Add a lightweight site daily snapshot
store for persisted site-aggregated history. Keep the homepage grouped by site rather than by
site-account rows. Persist balance, consumption, request count, prompt tokens, completion tokens, and
total tokens in daily snapshots for MVP. Treat route rules as explainable product objects in the UI,
not opaque internal identifiers.

**Consequences**:
* The page can show both traffic-quality history and site resource history after app restart.
* MVP remains lighter than a full analytics workbench because account granularity is kept behind
  drill-down.
* Backend scope increases modestly due to the new daily snapshot persistence model.
* Renderer scope also includes an explainable route-rule presentation layer.
