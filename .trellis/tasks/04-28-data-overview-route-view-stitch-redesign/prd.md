# brainstorm: redesign data overview route view with stitch

## Goal

Redesign only the `route` view inside `src/renderer/pages/DataOverviewPage.tsx` so it becomes
visually cleaner, chart-forward, and aligned with the current light theme language, while keeping
all primary route-view data visible at once in the largest desktop layout without outer page
scrolling. Inner-card scrolling is allowed for dense ranked/detail lists.

## What I already know

* The current route-data view already exists in
  `src/renderer/pages/DataOverviewPage.tsx`.
* The top-level page container is currently `flex-1 overflow-y-auto px-6 py-4`, so the page itself
  is allowed to scroll.
* The current route view renders these major modules in one vertical stack:
  * 4 KPI cards
  * 1 route-trend card containing 4 mini trend tiles
  * 1 diagnostics/success-rate card
  * 1 route-rule insights card
  * 1 recent failing requests card
* The current route view therefore tries to show 6 major surfaces plus nested detail content in a
  stacked flow, which explains the current "information all present but not one-glance" feeling.
* Some inner-card scroll already exists today:
  * success-rate list: `max-h-[184px] overflow-y-auto`
  * ranked lists in site view: `overflow-y-auto`
* The route page itself no longer owns analytics. It links users into `数据总览`, so redesign scope
  is localized to the overview page instead of the old route workbench.
* Theme and primitive evidence already exists in code:
  * global tokens: `src/renderer/index.css`
  * cards: `src/renderer/components/AppCard/AppCard.tsx`
  * buttons: `src/renderer/components/AppButton/AppButton.tsx`
* The current token palette is already close to a restrained slate/neutral system:
  * accent `#5c6b78`
  * success `#5d7d72`
  * warning `#b28a57`
  * danger `#a55e63`
* There are existing local mockups for this surface:
  * `output/mockups/data-overview-route-content-only*.html`
  * `output/mockups/data-overview-route-view-1300x800.html`
  * `output/mockups/data-overview-route-view-stitch.html`
* There is an existing Stitch project directly related to this page:
  * `projects/4925020879765681484` titled `Data Overview Trend Redesign`
* That Stitch project already contains multiple desktop screens for route/overview trend exploration.
* The Stitch project also exposes two relevant design systems:
  * `assets/de36f35c47454093a23aabc8dbe95f63` — `Foundry Slate`
  * `assets/ff8b38ea9392461aa417b7e84bd52349` — `Metric Slate`
* Test coverage already exists around this page and surrounding shell:
  * `src/__tests__/data-overview-page.test.tsx`
  * `src/__tests__/app-shell-redesign.test.tsx`
  * `src/__tests__/route-workbench-redesign.test.tsx`

## Assumptions (temporary)

* This task is a UI/UX restructure first, not a new data-source task.
* The set of displayed route metrics can stay roughly the same for MVP if the layout becomes more
  information-dense and visually calmer.
* "No outer scrollbar" applies to the main overview canvas in the largest desktop layout, not to
  every smaller viewport.
* It is acceptable to compress secondary explanation text, reduce repeated captions, and move dense
  content into fixed-height side cards with local scrolling.
* Stitch should be used as the design-generation surface, but the final renderer implementation must
  still follow the repository's existing tokens/components rather than importing a parallel theme.

## Open Questions

* None for MVP.

## Requirements (evolving)

* Redesign only the `路由数据` view of `DataOverviewPage`.
* Preserve current route-theme compatibility with the app's existing light theme and token system.
* Use Stitch to generate or refine the layout direction before implementation.
* The main route-view canvas must avoid outer-page scrolling in the largest desktop layout.
* Small cards may scroll internally when content volume is high.
* The page must still expose all currently important route-view information at first glance:
  * overall request volume
  * success/failure health
  * token volume
  * latency/slow-request signal
  * status/latency distribution
  * route-rule insight
  * recent failing requests
* The redesigned charts should feel more elegant than the current mini-tile stack and should avoid a
  "crowded metrics board" look.
* The layout should reduce repeated framing, repeated borders, and unnecessary vertical stacking.
* The route view should privilege scanability first and drill-down second.
* In the cockpit bottom row, `最近异常请求` should get more visual weight than `路由规则洞察`.
* `路由规则洞察` should remain present, but as a denser secondary support card rather than a
  co-equal hero surface.
* Empty states and low-data states must still fit the fixed-height design without collapsing the
  grid rhythm.

## Acceptance Criteria (evolving)

* [x] A concrete route-view redesign direction is chosen.
* [ ] The redesign direction is grounded in existing data already used by `DataOverviewPage`.
* [ ] The redesign uses Stitch and stays visually compatible with the current theme language.
* [ ] The route-view information hierarchy is defined clearly enough for implementation.
* [ ] The main route-view layout is explicitly designed to avoid outer-page scroll in the largest
      desktop layout.
* [ ] Internal scrolling is limited to dense detail cards only.
* [ ] Existing important route metrics remain represented after the simplification.
* [x] Bottom-row emphasis is fixed: recent failing requests outweigh route-rule insight.
* [ ] Target tests to update are identified before implementation.

## Definition of Done (team quality bar)

* A finalized PRD exists for the route-view redesign.
* A chosen Stitch direction or screen instance is identified as the implementation source.
* Layout constraints, visual priorities, and scrolling rules are explicit enough to implement
  without re-discovery.

## Out of Scope (explicit)

* Rebuilding the site-management view in the same task
* Adding new backend analytics fields
* Reworking the logs page
* Reworking the route configuration page
* Replacing the app's global design token system

## Research Notes

### Current implementation constraints from code

* Top-level page scroll currently comes from:
  * `src/renderer/pages/DataOverviewPage.tsx` -> `className="flex-1 overflow-y-auto px-6 py-4"`
* Current route view is rendered as three stacked zones:
  * KPI strip
  * trend + diagnostics row
  * rules + failing requests row
* The current route trend surface is still nested-card-heavy:
  * one large card
  * four `TrendMetricTile` blocks inside it
* Several current components still use explicit borders on inner surfaces
  (`border border-[var(--line-soft)]`), which works functionally but contributes to a busy look.

### Current visual language from the repo

* Theme source of truth is `src/renderer/index.css`, not external design files.
* Existing palette already supports restrained analytics UI:
  * neutral/slate structural surfaces
  * muted semantic accents
  * rounded cards
* Existing primitives favor compact desktop controls and are reusable for implementation.

### Stitch evidence

* Relevant Stitch project:
  * `projects/4925020879765681484` — `Data Overview Trend Redesign`
  * `projects/5361977025743526530` — `API Detect Tools - 数据总览 UI Mockup`
* Relevant Stitch design systems:
  * `Foundry Slate` (`assets/de36f35c47454093a23aabc8dbe95f63`)
  * `Metric Slate` (`assets/ff8b38ea9392461aa417b7e84bd52349`)
  * `Precision Slate` (`assets/d0f03632fc4f4a5b985fc8619b05c8e3`)
* Existing Stitch screens in that project already explore:
  * analytics cards modules
  * refined analytics layouts
  * polished module redesigns
  * final concept screens
* Final generated implementation source for this task:
  * `projects/5361977025743526530/screens/2858353fe2244b8cb874de869de2bba9`
  * title: `数据总览 - 路由数据 (Executive Cockpit)`

### Feasible approaches here

**Approach A: Executive Cockpit** (Recommended)

* How it works:
  * row 1: compact KPI strip
  * row 2: one wide hero analytics canvas for the most important trend signals
  * right rail: two compact stacked diagnostic cards
  * bottom row: compact rule insight card + larger recent failing requests card
* Pros:
  * strongest one-glance scanability
  * easiest path to "no outer scroll"
  * simplest mapping from current data to a calmer visual rhythm
* Cons:
  * route-rule narrative space becomes tighter

**Status**:
* User selected this approach for MVP on 2026-04-28.

**Approach B: Balanced Dense Grid**

* How it works:
  * preserve almost all current modules, but repack them into a stricter 2-row fixed-height grid
    with smaller chart chrome and denser labels
* Pros:
  * minimal information loss
  * lower implementation risk
* Cons:
  * more likely to still feel busy
  * elegant charts are harder to achieve because too many modules compete equally

**Approach C: Diagnostics-First Board**

* How it works:
  * compress trends into one smaller summary surface
  * allocate more height/width to failures, status distribution, and rule objects
* Pros:
  * strongest for troubleshooting
* Cons:
  * weaker for executive overview
  * less aligned with the user's request for "一眼看到所有展示的数据" in a simplified way

## Technical Notes

* Code references inspected:
  * `src/renderer/pages/DataOverviewPage.tsx`
  * `src/renderer/pages/RoutePage.tsx`
  * `src/renderer/index.css`
  * `src/renderer/components/AppCard/AppCard.tsx`
  * `src/renderer/components/AppButton/AppButton.tsx`
  * `src/__tests__/data-overview-page.test.tsx`
  * `src/__tests__/app-shell-redesign.test.tsx`
  * `src/__tests__/route-workbench-redesign.test.tsx`
  * `PROJECT_INDEX.md`
* Local mockup references:
  * `output/mockups/data-overview-route-content-only-v2.html`
  * `output/mockups/data-overview-route-content-only-v3.html`
  * `output/mockups/data-overview-route-view-1300x800.html`
  * `output/mockups/data-overview-route-view-stitch.html`
* Main implementation surface is renderer-only unless acceptance later demands a new viewport rule or
  additional test helpers.

## Technical Approach

1. Keep the route view inside `DataOverviewPage`, but convert it from a vertical document flow into a
   fixed-height cockpit layout for large desktop windows.
2. Use a three-zone structure:
   * top: compact KPI strip
   * middle: wide hero analytics canvas + compact right rail diagnostics
   * bottom: two secondary fixed-height cards for route rules and failing requests
3. Keep only secondary cards scrollable internally.
4. Use Stitch as the layout source, then implement with existing renderer primitives and tokens.
5. Reduce repeated borders, repeated captions, and stacked mini-cards in favor of larger shared
   chart surfaces and calmer hierarchy.

## Decision (ADR-lite)

**Context**: The current route-data view already has the right data, but its vertically stacked
layout and page-level scrolling prevent one-glance comprehension.

**Decision**: Use the `Executive Cockpit` layout as the MVP redesign direction for the route-data
view.

**Consequences**:
* The main route overview becomes more scannable and more likely to fit without outer scroll in the
  largest desktop layout.
* Some narrative/detail modules must become denser and more compact.
* The bottom row should allocate more width and/or stronger visual focus to recent failing requests,
  while route-rule insight becomes a denser secondary explanation surface.
