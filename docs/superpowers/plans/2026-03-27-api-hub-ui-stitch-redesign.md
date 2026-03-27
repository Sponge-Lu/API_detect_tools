# API Hub Stitch UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved high-fidelity Stitch redesign for the API Hub desktop app, covering the global shell, theme system, and five major pages before any React implementation begins.

**Architecture:** Create one Stitch project for the approved redesign, anchor the visuals in Theme B as the baseline workbench language, then generate the shell and all major screens in sequence. Create separate design system assets for Theme A, Theme B, Theme C, and the unified dark mode, and validate the non-baseline themes through a dedicated theme kit screen plus reusable component samples.

**Tech Stack:** Stitch MCP, project-local design spec, Electron/React renderer references, design-system assets, desktop screen generation, manual visual verification

---

## Runtime Values Used Throughout Execution

Capture these values from Stitch tool responses and reuse them consistently in later tasks:

- `projectId`
- `designSystemThemeB`
- `designSystemThemeA`
- `designSystemThemeC`
- `designSystemDark`
- `screenShell`
- `screenThemeKit`
- `screenSites`
- `screenRoute`
- `screenCustomCli`
- `screenCredit`
- `screenSettings`

## File Structure

**Reference Files:**
- `docs/superpowers/specs/2026-03-27-api-hub-ui-redesign-design.md`
- `src/renderer/App.tsx`
- `src/renderer/components/Sidebar/VerticalSidebar.tsx`
- `src/renderer/components/Header/Header.tsx`
- `src/renderer/pages/SitesPage.tsx`
- `src/renderer/pages/RoutePage.tsx`
- `src/renderer/components/Route/RouteSubTabs.tsx`
- `src/renderer/pages/CustomCliPage.tsx`
- `src/renderer/pages/CreditPage.tsx`
- `src/renderer/components/SettingsPanel.tsx`
- `src/renderer/index.css`
- `.claude/UI_style.md`

**Execution Log File:**
- Create: `docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md`
  - Responsibility: Record Stitch project ID, design system asset IDs, screen IDs, review notes, and any model/tool limitations discovered during execution.

## Task 1: Create the Stitch Project, Baseline Theme, and Execution Log

**Files:**
- Reference: `docs/superpowers/specs/2026-03-27-api-hub-ui-redesign-design.md`
- Reference: `src/renderer/App.tsx`
- Reference: `src/renderer/components/Sidebar/VerticalSidebar.tsx`
- Reference: `src/renderer/components/Header/Header.tsx`
- Create: `docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md`

- [ ] **Step 1: Create the execution log file**

```md
# API Hub UI Stitch Execution Log

## Project
- Project title:
- projectId:
- Generator model note:

## Design Systems
- designSystemThemeB:
- designSystemThemeA:
- designSystemThemeC:
- designSystemDark:

## Screens
- screenShell:
- screenThemeKit:
- screenSites:
- screenRoute:
- screenCustomCli:
- screenCredit:
- screenSettings:

## Review Notes
- Theme B baseline status:
- Theme variants status:
- Density review:
- Gradient removal review:
- Open issues:
```

- [ ] **Step 2: Create the Stitch project**

Use:

```json
{
  "tool": "create_project",
  "title": "API Hub UI Redesign"
}
```

Expected: a successful response with a new `projectId`.

- [ ] **Step 3: Create the Theme B baseline design system**

Use:

```text
Theme name: API Hub Theme B Baseline
Intent: restrained minimalist desktop workbench for a high-density Electron operations tool
Color direction:
- canvas: #F4F1EC
- surface: #EBE6E0
- elevated surface: #DFD8D0
- hairline border: #D1C8BE
- primary text: #1F1D1A
- secondary text: #67635E
- tertiary text: #85807A
- neutral accent / emphasis: #2C2A28
- cool utility accent: #596674
- success: #667565
- warning: #887050
- danger: #855B5B
Typography:
- desktop-focused grotesk or neo-grotesk
- compact title rhythm
- dense but readable data rows
Shape:
- restrained corners around 10, 12, and 14 px
Appearance:
- Light mode is the baseline
- Unified dark mode will be a separate asset
Design instructions:
- no gradients
- no glossy glassmorphism
- minimal border noise
- structure pages as a workbench with left navigation, top page header, summary/filter band, dense central registry, and right inspector
- default emphasis comes from value hierarchy, alignment, and tone separation, not large saturated buttons
- keep information density high
- preserve an enterprise-tool rhythm rather than a marketing layout
```

Then immediately apply it with `update_design_system` to the same project.

Expected: one project-linked design system asset recorded as `designSystemThemeB`.

- [ ] **Step 4: Record `projectId` and `designSystemThemeB` in the execution log**

Append the actual values returned in Steps 2 and 3 under their matching labels. Under `Generator model note:`, record either the exact Gemini 3.1 Pro-capable model path used by Stitch or the sentence `Model selection not exposed by Stitch tool; default generator used.` Add one sentence under `Theme B baseline status:` saying the baseline theme asset is ready.

- [ ] **Step 5: Verify project and baseline design system, then commit the log**

Use:

```json
{ "tool": "get_project", "name": "projects/{projectId}" }
```

and

```json
{ "tool": "list_design_systems", "projectId": "{projectId}" }
```

Expected: the project exists and exactly one design system is listed for the project.

Then commit only the log file:

```bash
git add docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md
git commit -m "docs(plan): initialize stitch ui redesign execution log"
```

## Task 2: Create Theme A, Theme C, and Unified Dark Design Systems

**Files:**
- Reference: `docs/superpowers/specs/2026-03-27-api-hub-ui-redesign-design.md`
- Reference: `.claude/UI_style.md`
- Modify: `docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md`

- [ ] **Step 1: Create Theme A design system**

Use:

```text
Theme name: API Hub Theme A Cement Gray
Intent: colder analytical variant of the approved desktop workbench
Color direction:
- canvas: #F1F2F0
- surface: #E6E8E4
- elevated surface: #D8DCD7
- hairline border: #C8CDC8
- primary text: #1E2124
- secondary text: #60676E
- tertiary text: #7B848C
- cool blue accent: #6A7B90
- success: #66756D
- warning: #7D7359
- danger: #855E63
Typography and shape: keep identical to Theme B
Design instructions:
- no gradients
- preserve the same workbench hierarchy as Theme B
- use the cool blue accent only for selected state, focus, and important system indicators
- do not make the product feel glossy or futuristic
```

Expected: one additional project-linked design system asset recorded as `designSystemThemeA`.

- [ ] **Step 2: Create Theme C design system**

Use:

```text
Theme name: API Hub Theme C Mist Gray Green
Intent: restrained natural-cool variant of the approved desktop workbench
Color direction:
- canvas: #F1F3EF
- surface: #E7EBE4
- elevated surface: #D8DED6
- hairline border: #C8CFC6
- primary text: #1E211D
- secondary text: #5E665F
- tertiary text: #7A827A
- muted green-gray accent: #6B7B71
- support accent: #56626A
- success: #667565
- warning: #7D7255
- danger: #855D5D
Typography and shape: keep identical to Theme B
Design instructions:
- no gradients
- no lifestyle-brand softness
- the green undertone must remain subtle and architectural
- preserve the exact same structural hierarchy as Theme B
```

Expected: one additional project-linked design system asset recorded as `designSystemThemeC`.

- [ ] **Step 3: Create the unified dark design system**

Use:

```text
Theme name: API Hub Unified Dark
Intent: one shared dark mode for all light theme variants
Color direction:
- canvas: #141618
- surface: #1B1E21
- elevated surface: #23272B
- hairline border: #30353A
- primary text: #E6E2DC
- secondary text: #B4B0AA
- tertiary text: #8A8F95
- accent: #7B8794
- success: #7A8A79
- warning: #9B8866
- danger: #9A6C6C
Typography and shape: keep identical to Theme B
Design instructions:
- no gradients
- avoid neon and saturated dark UI tropes
- preserve high-density scan ability in tables and registries
- dark mode must feel restrained and tool-like, not cinematic
```

Expected: one additional project-linked design system asset recorded as `designSystemDark`.

- [ ] **Step 4: Record `designSystemThemeA`, `designSystemThemeC`, and `designSystemDark` in the execution log**

Update the matching labels and add one sentence under `Theme variants status:` saying all non-baseline design system assets are created.

- [ ] **Step 5: Verify there are four design systems in the project, then commit the log**

Use:

```json
{ "tool": "list_design_systems", "projectId": "{projectId}" }
```

Expected: exactly four project-linked design systems are listed.

Then commit only the log file:

```bash
git add docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md
git commit -m "docs(plan): record stitch design system assets"
```

## Task 3: Generate the App Shell Screen

**Files:**
- Reference: `src/renderer/App.tsx`
- Reference: `src/renderer/components/Sidebar/VerticalSidebar.tsx`
- Reference: `src/renderer/components/Header/Header.tsx`
- Modify: `docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md`

- [ ] **Step 1: Generate the app shell screen using Theme B as the baseline**

Use:

```text
Design a desktop Electron application shell for a high-density API operations tool.

Visual direction:
- restrained minimalist
- no gradients
- baseline theme is warm off-white gray with graphite emphasis
- desktop workbench, not a marketing dashboard
- strong typography and alignment discipline
- low-saturation palette
- moderate corners only

Layout requirements:
- far-left narrow navigation rail that can hold icons and labels without looking heavy
- top page header area with page title, one-line page description, compact summary stats, save/update state, and quick actions
- central content canvas designed to host dense tools and registries
- persistent right-side contextual inspector area for selected item details and actions
- summary/filter band below the page header
- subtle global status band for save, refresh, update, and auth events

Component language:
- quiet sidebar selection states
- dense table-ready center panel
- inspector sections with structured metadata groups
- small status tags and compact action buttons
- no oversized cards
- no large empty hero areas

Output:
- one high-fidelity shell screen that clearly shows the layout system and reusable shell components
```

Expected: one new screen recorded as `screenShell`.

- [ ] **Step 2: Record `screenShell` in the execution log**

Add the actual screen ID under `screenShell:` and add one bullet in `Review Notes` describing whether the shell already expresses the left-nav / top-header / right-inspector workbench pattern.

- [ ] **Step 3: Verify the shell screen exists**

Use:

```json
{ "tool": "list_screens", "projectId": "{projectId}" }
```

and then inspect it with:

```json
{ "tool": "get_screen", "projectId": "{projectId}", "screenId": "{screenShell}", "name": "projects/{projectId}/screens/{screenShell}" }
```

Expected: the screen exists and the shell structure is visible in the returned data.

- [ ] **Step 4: If the shell uses a large hero card, oversized empty spacing, or gradients, refine it immediately**

Use `edit_screens` on `screenShell` with this exact prompt:

```text
Tighten the layout into a true desktop workbench. Remove any hero-card feeling, remove gradients, reduce decorative spacing, make the summary band denser, keep the sidebar quiet, and make the right inspector feel like a functional metadata panel rather than a marketing card.
```

Expected: the shell becomes more tool-like and denser.

- [ ] **Step 5: Commit the updated execution log**

```bash
git add docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md
git commit -m "docs(plan): record stitch shell screen"
```

## Task 4: Generate the Theme Kit Screen

**Files:**
- Reference: `docs/superpowers/specs/2026-03-27-api-hub-ui-redesign-design.md`
- Reference: `.claude/UI_style.md`
- Modify: `docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md`

- [ ] **Step 1: Generate a dedicated theme kit screen**

Use:

```text
Design a desktop theme kit screen for the API Hub redesign.

Show four clearly labeled columns or panels:
- Theme A Cement Gray
- Theme B Warm Off-White Gray
- Theme C Mist Gray Green
- Unified Dark

Each column must show the same component samples:
- one sidebar selection sample
- one compact page header sample
- one filter band sample
- one dense registry row sample
- one KPI strip sample
- one right inspector section sample
- one form row sample
- one danger area sample
- one set of status tags

Rules:
- no gradients
- keep all structure identical across themes
- only color, tone, and emphasis materials should change
- this is a component comparison board, not a marketing palette poster
- typography must remain compact and dense
```

Expected: one new screen recorded as `screenThemeKit`.

- [ ] **Step 2: Record `screenThemeKit` in the execution log**

Add the actual screen ID under `screenThemeKit:` and write one sentence under `Theme variants status:` confirming the theme kit exists.

- [ ] **Step 3: Verify the theme kit exists**

Use:

```json
{ "tool": "get_screen", "projectId": "{projectId}", "screenId": "{screenThemeKit}", "name": "projects/{projectId}/screens/{screenThemeKit}" }
```

Expected: the screen shows all four theme variants and the same component samples.

- [ ] **Step 4: If the non-baseline themes drift in layout, normalize them**

Use `edit_screens` on `screenThemeKit` with this exact prompt:

```text
Normalize the four theme columns so they are structurally identical. Keep the same component layout, spacing, radius, and typography. Only the surface tones, accents, and contrast materials may differ. Remove any decorative styling that makes one theme feel like a different product.
```

Expected: all four theme panels share one structural language.

- [ ] **Step 5: Commit the updated execution log**

```bash
git add docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md
git commit -m "docs(plan): record stitch theme kit screen"
```

## Task 5: Generate the Sites Management Screen

**Files:**
- Reference: `src/renderer/pages/SitesPage.tsx`
- Reference: `src/renderer/store/uiStore.ts`
- Modify: `docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md`

- [ ] **Step 1: Generate the Sites screen**

Use:

```text
Design the main Sites Management screen for the API Hub desktop app using Theme B baseline.

This is the highest-density operational page in the product.

Required structure:
- top page header with title, short description, and compact summary stats
- summary/filter band under the header
- left filter rail for site groups, status filters, compatibility filters, and abnormal-state filters
- center dense registry for site or account rows
- right contextual inspector for the selected site/account

Required center registry columns:
- site name
- balance
- today usage
- total tokens
- prompt tokens
- completion tokens
- requests
- RPM
- TPM
- model count
- last update
- compatibility indicator
- LDC ratio

Required inspector content:
- selected entity metadata
- model list preview
- API key section
- user group section
- pricing section
- quick actions
- warnings or auth issues

Visual rules:
- no gradients
- no oversized cards
- dense scanability is the priority
- use compact rows and precise alignment
- make the screen feel like a tool registry, not a card gallery
```

Expected: one new screen recorded as `screenSites`.

- [ ] **Step 2: Record `screenSites` in the execution log**

Add the actual screen ID under `screenSites:` and write one sentence under `Density review:` describing whether the center registry is denser than the current card-first layout.

- [ ] **Step 3: Verify the Sites screen exists and inspect it**

Use:

```json
{ "tool": "get_screen", "projectId": "{projectId}", "screenId": "{screenSites}", "name": "projects/{projectId}/screens/{screenSites}" }
```

Expected: the screen clearly shows the left filter rail, central registry, and right inspector.

- [ ] **Step 4: If the center area is still card-heavy, refine it immediately**

Use `edit_screens` on `screenSites` with this exact prompt:

```text
Reduce the card feeling and push the center area toward a true dense registry. Tighten row height, align numeric columns more strictly, keep the inspector separate on the right, and remove any decorative spacing that lowers scan efficiency.
```

Expected: the center section becomes visibly more registry-like and scan-friendly.

- [ ] **Step 5: Commit the updated execution log**

```bash
git add docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md
git commit -m "docs(plan): record stitch sites screen"
```

## Task 6: Generate the Route Management Screen

**Files:**
- Reference: `src/renderer/pages/RoutePage.tsx`
- Reference: `src/renderer/components/Route/RouteSubTabs.tsx`
- Modify: `docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md`

- [ ] **Step 1: Generate the Route screen**

Use:

```text
Design the Route Management screen for the API Hub desktop app using Theme B baseline.

This screen must unify three route modes inside one instrument-like workbench:
- model redirection
- CLI usability
- proxy and statistics

Required structure:
- top page header with runtime summary
- compact segmented mode switch below the header
- central rule or registry area that can adapt to the selected route mode
- right inspector for selected rule, route channel, or runtime entity
- subtle system status line for runtime and update state

Visual rules:
- no gradients
- keep the route modes as one product family
- the mode switch must feel like a functional control, not a decorative tab bar
- the main content should be dense and tool-like
```

Expected: one new screen recorded as `screenRoute`.

- [ ] **Step 2: Record `screenRoute` in the execution log**

Add the actual screen ID under `screenRoute:` and add one bullet in `Review Notes` describing whether the segmented mode switch and inspector feel integrated.

- [ ] **Step 3: Verify the Route screen exists and inspect it**

Use:

```json
{ "tool": "get_screen", "projectId": "{projectId}", "screenId": "{screenRoute}", "name": "projects/{projectId}/screens/{screenRoute}" }
```

Expected: the screen shows one shared workbench instead of three disconnected subpages.

- [ ] **Step 4: If the screen feels like separate pages stitched together, refine it**

Use `edit_screens` on `screenRoute` with this exact prompt:

```text
Strengthen the feeling that all route modes belong to one shared instrument panel. Keep one continuous page header, one summary language, one inspector system, and a compact segmented mode switch. Remove anything that makes the modes look like separate mini products.
```

Expected: the route screen reads as one coherent control surface.

- [ ] **Step 5: Commit the updated execution log**

```bash
git add docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md
git commit -m "docs(plan): record stitch route screen"
```

## Task 7: Generate the Custom CLI Screen

**Files:**
- Reference: `src/renderer/pages/CustomCliPage.tsx`
- Modify: `docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md`

- [ ] **Step 1: Generate the Custom CLI screen**

Use:

```text
Design the Custom CLI Management screen for the API Hub desktop app using Theme B baseline.

Required structure:
- top page header with compact summary information
- main registry view instead of a card wall
- left or center list of CLI configurations
- columns for name, base URL, mapped model count, status or availability, and quick actions
- right inspector with full configuration details, model mappings, validation state, and edit actions

Visual rules:
- no gradients
- no default card-wall layout
- the default view must support comparison and scanning across many CLI configurations
- keep the inspector dense and technical rather than decorative
```

Expected: one new screen recorded as `screenCustomCli`.

- [ ] **Step 2: Record `screenCustomCli` in the execution log**

Add the actual screen ID under `screenCustomCli:` and write one sentence under `Density review:` describing whether the default view is registry-first.

- [ ] **Step 3: Verify the Custom CLI screen exists and inspect it**

Use:

```json
{ "tool": "get_screen", "projectId": "{projectId}", "screenId": "{screenCustomCli}", "name": "projects/{projectId}/screens/{screenCustomCli}" }
```

Expected: the screen shows a registry-like configuration management view.

- [ ] **Step 4: If the generator falls back to a card grid, refine it immediately**

Use `edit_screens` on `screenCustomCli` with this exact prompt:

```text
Replace the card-wall feeling with a denser configuration registry. Reduce oversized blocks, introduce clearer column logic, and make the right inspector carry detail instead of duplicating summary content in multiple cards.
```

Expected: the main area becomes a comparative registry rather than a set of isolated cards.

- [ ] **Step 5: Commit the updated execution log**

```bash
git add docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md
git commit -m "docs(plan): record stitch custom cli screen"
```

## Task 8: Generate the Credit Screen

**Files:**
- Reference: `src/renderer/pages/CreditPage.tsx`
- Modify: `docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md`

- [ ] **Step 1: Generate the Credit screen**

Use:

```text
Design the Credit screen for the API Hub desktop app using Theme B baseline.

Required structure:
- top page header with refresh and account state
- compact KPI strip for available balance, total income, total expense, remaining quota, and refresh state
- center area for income stats, expense stats, and trend summaries
- right area for transaction stream, recharge entry, and local account actions
- logged-out state should still look like a tool interface, not a giant empty sign-in card

Critical rule:
- remove the current gradient hero-card idea entirely

Visual rules:
- no gradients
- no marketing dashboard look
- keep the balance emphasis strong through contrast and hierarchy only
```

Expected: one new screen recorded as `screenCredit`.

- [ ] **Step 2: Record `screenCredit` in the execution log**

Add the actual screen ID under `screenCredit:` and add one sentence under `Gradient removal review:` confirming whether the hero-gradient pattern is gone.

- [ ] **Step 3: Verify the Credit screen exists and inspect it**

Use:

```json
{ "tool": "get_screen", "projectId": "{projectId}", "screenId": "{screenCredit}", "name": "projects/{projectId}/screens/{screenCredit}" }
```

Expected: the screen uses restrained KPI emphasis and no gradient hero card.

- [ ] **Step 4: If any gradient or glossy emphasis remains, refine it**

Use `edit_screens` on `screenCredit` with this exact prompt:

```text
Remove any remaining gradient, gloss, or hero-card treatment. Rebuild the top balance emphasis as a restrained high-contrast KPI block inside the same workbench language as the rest of the product.
```

Expected: the credit screen matches the approved restrained visual system.

- [ ] **Step 5: Commit the updated execution log**

```bash
git add docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md
git commit -m "docs(plan): record stitch credit screen"
```

## Task 9: Generate the Settings Screen

**Files:**
- Reference: `src/renderer/components/SettingsPanel.tsx`
- Modify: `docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md`

- [ ] **Step 1: Generate the Settings screen**

Use:

```text
Design the Settings screen for the API Hub desktop app using Theme B baseline.

Required structure:
- left settings section navigation
- central dense settings work table instead of long stacked cards
- each setting row shows label and explanation, control, and impact or state note
- right-side impact panel for affected features, restart requirements, risk notes, and related actions
- danger area clearly separated from normal settings

Visual rules:
- no gradients
- compact table-like discipline
- settings should feel precise and operational, not cozy or app-store-like
```

Expected: one new screen recorded as `screenSettings`.

- [ ] **Step 2: Record `screenSettings` in the execution log**

Add the actual screen ID under `screenSettings:` and add one bullet in `Review Notes` describing whether the central settings area feels like a dense work table.

- [ ] **Step 3: Verify the Settings screen exists and inspect it**

Use:

```json
{ "tool": "get_screen", "projectId": "{projectId}", "screenId": "{screenSettings}", "name": "projects/{projectId}/screens/{screenSettings}" }
```

Expected: the screen preserves the left navigation but upgrades the main form into a denser operational settings layout.

- [ ] **Step 4: If the settings screen still feels like stacked cards, refine it**

Use `edit_screens` on `screenSettings` with this exact prompt:

```text
Increase the table discipline of the settings body. Reduce the feeling of independent cards, align labels and controls more strictly, and make the right-side impact panel carry explanation and risk instead of duplicating decorative summary blocks.
```

Expected: the settings screen feels denser and more precise.

- [ ] **Step 5: Commit the updated execution log**

```bash
git add docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md
git commit -m "docs(plan): record stitch settings screen"
```

## Task 10: Run a Global Polish Pass and Final Design Review

**Files:**
- Reference: `docs/superpowers/specs/2026-03-27-api-hub-ui-redesign-design.md`
- Modify: `docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md`

- [ ] **Step 1: Verify all expected screens exist**

Use:

```json
{ "tool": "list_screens", "projectId": "{projectId}" }
```

Expected: exactly these design screens exist in the project and are recorded in the log:
- `screenShell`
- `screenThemeKit`
- `screenSites`
- `screenRoute`
- `screenCustomCli`
- `screenCredit`
- `screenSettings`

- [ ] **Step 2: Run a single global refinement pass across all screens**

Use `edit_screens` on all seven screens with this exact prompt:

```text
Unify all selected screens into one restrained high-density desktop workbench system. Tighten spacing where decorative whitespace remains, keep corners restrained, remove any residual gradients, normalize header rhythm, align filter bands and inspector sections, and make tables or registries feel scanable and precise. Preserve the approved Theme B baseline while keeping the Theme Kit structurally identical across all theme columns.
```

Expected: all screens feel like one product family.

- [ ] **Step 3: Review the final screens against the spec**

Check each of the following directly in Stitch and write one short note for each in the execution log:

1. Sites page is denser than the current card-first UI.
2. Route screen feels like one instrument panel.
3. Custom CLI screen is registry-first.
4. Credit screen has no hero gradient.
5. Settings screen uses a denser work-table body.
6. Theme kit shows all four themes with identical structure.

Expected: each line in the log has a direct pass/fail style note.

- [ ] **Step 4: Record final review results and any remaining issues**

Update `Open issues:` in the execution log with either `None` or a concise flat list of remaining design problems that must be fixed before React work begins.

- [ ] **Step 5: Commit the final execution log**

```bash
git add docs/superpowers/plans/2026-03-27-api-hub-ui-stitch-execution-log.md
git commit -m "docs(plan): finalize stitch ui redesign review log"
```

