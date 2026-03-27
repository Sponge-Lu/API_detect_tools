# API Hub UI Redesign Design Spec

Date: 2026-03-27
Status: Drafted and approved in terminal conversation
Scope: Full UI redesign design only; no React implementation in this spec

## 1. Goal

Redesign the full Electron renderer UI into a high-density desktop workbench with a restrained minimalist temperament.

The redesign must satisfy all of the following:

1. Preserve or improve information density.
2. Replace the current fragmented card-first page organization with a more stable workbench structure.
3. Follow the project-local visual rules in `.claude/UI_style.md`.
4. Provide three selectable light themes:
   - Cement gray + cool blue accent
   - Warm off-white gray + graphite accent
   - Mist gray-green + dark gray accent
5. Provide one unified dark mode instead of three dark variants.
6. Produce high-fidelity design output in Stitch first, then implement in React only after design review.

## 2. Evidence Basis

This design is grounded in the current renderer structure and not derived from generic dashboard assumptions.

Primary code evidence:

1. Root shell and page mounting are defined in `src/renderer/App.tsx`.
2. Primary navigation is defined in `src/renderer/components/Sidebar/VerticalSidebar.tsx`.
3. The current top status/header area is defined in `src/renderer/components/Header/Header.tsx`.
4. The highest-density operational page is `src/renderer/pages/SitesPage.tsx`, which currently mixes grouping, filtering, sorting, account flattening, result display, model data, and many actions inside a card flow.
5. Route management is organized in `src/renderer/pages/RoutePage.tsx` with sub-tabs from `src/renderer/components/Route/RouteSubTabs.tsx`.
6. Custom CLI management currently uses a configuration card grid in `src/renderer/pages/CustomCliPage.tsx`.
7. Credit management currently uses a prominent gradient hero card in `src/renderer/pages/CreditPage.tsx`, which conflicts with `UI_style.md`.
8. Settings page composition is centered around `src/renderer/components/SettingsPanel.tsx`.
9. Existing global styling and iOS-oriented design tokens are in `src/renderer/index.css`.
10. Existing architecture documentation references the current iOS design system in `docs/ARCHITECTURE.md`.

Conclusion from code evidence:

1. A shell-only reskin is insufficient because the current information architecture itself is the main density bottleneck.
2. The redesign should target structural reorganization first, then visual refinement.
3. The current gradient-heavy emphasis in `CreditPage` must be removed to satisfy the local style brief.

## 3. Explicit Product Decisions

These decisions were confirmed with the user during brainstorming:

1. Redesign scope is the whole app shell plus all major pages.
2. Desired temperament is restrained minimalist, not expressive or decorative.
3. The redesign must not reduce information density.
4. Three light themes must be supported.
5. There will be only one unified dark mode.
6. This phase produces Stitch high-fidelity design only.
7. React implementation is deferred until the design is reviewed and approved.

## 4. Recommended Direction

Recommended direction: Data Workbench Reorganization.

Rationale:

1. The current `SitesPage` is the dominant operational surface and has the highest interaction density.
2. Card-first organization works poorly when the user needs to scan many metrics across many sites or accounts.
3. A workbench layout makes it possible to separate:
   - filtering and grouping,
   - dense primary data scan,
   - contextual detail and actions.
4. This direction best matches the requested restrained, high-density tool UI.

Rejected directions:

1. Shell-first unification only:
   - Lower risk.
   - Insufficient structural improvement.
2. Modular card rearrangement:
   - Easier transition.
   - Still tends toward fragmentation and lower density.

## 5. Global Information Architecture

The whole application should use one stable desktop workbench frame.

### 5.1 Shell

1. Left side uses persistent vertical navigation.
2. Top area becomes a real page header, not just a thin status strip.
3. Main content area uses a workbench layout with explicit zones.
4. Right side contextual inspector becomes a first-class pattern across pages.

### 5.2 Global Page Structure

Each major page should follow this structure:

1. Page header:
   - page title,
   - short contextual description,
   - page-level metrics,
   - global/page actions,
   - current state summary.
2. Summary/filter band:
   - group filters,
   - status chips,
   - search,
   - sort controls,
   - dense KPI rows where useful.
3. Primary work area:
   - dense table,
   - list,
   - registry,
   - rules panel,
   - or transaction stream.
4. Contextual inspector:
   - selected object details,
   - inline edits,
   - local actions,
   - warnings,
   - related metadata.

### 5.3 Modal Policy

Reduce modal usage.

Priority order for interactions:

1. Inline editing inside the current surface.
2. Right inspector or side drawer.
3. Modal only for destructive, risky, or deeply isolated flows.

## 6. Page-by-Page Design

### 6.1 Sites Management

Current evidence: `src/renderer/pages/SitesPage.tsx`

New structure:

1. Left filter rail:
   - site groups,
   - overall/all filter,
   - detection state,
   - compatibility flags,
   - abnormal state filters,
   - optional balance or usage band filters.
2. Center main registry:
   - row-based display for site or account entities,
   - columns for site, balance, today usage, total tokens, prompt, completion, requests, RPM, TPM, model count, last update, compatibility, LDC ratio,
   - expandable rows for compact secondary details.
3. Right inspector:
   - selected site or account details,
   - model list,
   - API keys,
   - user groups,
   - pricing,
   - quick actions,
   - warnings,
   - auth or refresh status.

Key rule:

The default shape must be a dense registry, not a large stack of cards.

### 6.2 Route Management

Current evidence: `src/renderer/pages/RoutePage.tsx`

New structure:

1. Keep the three modes:
   - model redirection,
   - CLI usability,
   - proxy and statistics.
2. Treat sub-tabs as mode switches inside one workbench instead of three visually disconnected pages.
3. Reuse a shared grammar:
   - top runtime status strip,
   - central main grid or rule registry,
   - right inspector for selected route rule, proxy channel, or runtime entity.

Design intent:

All route subpages should feel like one instrument panel.

### 6.3 Custom CLI

Current evidence: `src/renderer/pages/CustomCliPage.tsx`

New structure:

1. Default view becomes a registry, not a card wall.
2. Left or center list shows CLI configurations.
3. Main columns show:
   - name,
   - base URL,
   - mapped models,
   - availability or test state,
   - update info,
   - copy/access actions.
4. Right inspector shows:
   - full config details,
   - model mappings,
   - validation or test state,
   - edit actions.

Optional card view may exist later, but should not be the default.

### 6.4 Credit

Current evidence: `src/renderer/pages/CreditPage.tsx`

New structure:

1. Replace the gradient hero with restrained KPI cards using neutral tone separation.
2. Top KPI strip shows:
   - available balance,
   - total income,
   - total expense,
   - remaining quota,
   - refresh state.
3. Center area shows:
   - income stats,
   - expense stats,
   - trend or periodic summaries.
4. Right area shows:
   - transaction stream,
   - recharge entry,
   - local account actions.
5. Logged-out state remains tool-like rather than becoming a large empty landing card.

### 6.5 Settings

Current evidence: `src/renderer/components/SettingsPanel.tsx`

New structure:

1. Keep left section navigation.
2. Change the main form zone into a denser settings work table.
3. Each setting row should show:
   - label and explanation,
   - input/control,
   - impact or state note.
4. Add a right-side impact panel for:
   - affected features,
   - restart requirements,
   - risk notes,
   - related actions.
5. Dangerous operations are grouped into a dedicated danger area and visually separated from normal settings.

## 7. Visual System

### 7.1 Shared Foundation

All themes share the same:

1. grid system,
2. typography scale,
3. spacing rhythm,
4. radius scale,
5. component hierarchy,
6. state semantics,
7. dark mode structure.

This is one product with multiple skins, not three independent visual languages.

### 7.2 Visual Principles from UI_style.md

Required visual principles derived from `.claude/UI_style.md`:

1. No gradients.
2. Low saturation palette.
3. Minimal border usage.
4. Layering by micro contrast, shadow restraint, and spacing.
5. Swiss-style discipline in layout and whitespace.
6. Material-like shape logic in UI object construction, but without colorful material emphasis.

### 7.3 Theme Set

Light theme A:

1. Cement gray background family.
2. Cool blue as the main accent for selection and status emphasis.
3. Best suited for analytical and routing surfaces.

Light theme B:

1. Warm off-white gray background family.
2. Graphite accent and neutral dark emphasis.
3. Strongest restrained minimalist character.
4. Recommended as the baseline Stitch design theme.

Light theme C:

1. Mist gray-green base family.
2. Dark gray emphasis with very limited cool natural undertone.
3. Must remain restrained and not drift into a “fresh lifestyle” look.

Unified dark mode:

1. One shared graphite-based dark theme.
2. Low-chroma cool-neutral layering.
3. One consistent accent logic across all pages.
4. No per-theme dark variants.

### 7.4 Component-Level Rules

1. Sidebar:
   - instrument-like,
   - low-noise,
   - selected state through tone and weight rather than bright fill.
2. Header:
   - workbench page header,
   - not an ornamental toolbar.
3. Tables:
   - tight row rhythm,
   - precise alignment,
   - strong scan lines.
4. Inspector:
   - structured fields,
   - grouped metadata,
   - restrained action cluster.
5. Tags and status:
   - low-saturation monochrome or near-monochrome tone logic.
6. Empty states:
   - still feel like tool UI,
   - no playful illustration-centric treatment.
7. Radius:
   - moderate and restrained,
   - prefer roughly 10/12/14 px classes rather than exaggerated soft corners.

## 8. Interaction and Feedback

### 8.1 Interaction Rules

1. High-frequency tasks stay in context.
2. Hover, focus, and selected states are subtle but unambiguous.
3. Motion is short, functional, and non-celebratory.
4. Expansion, mode switch, refresh, and selection states should help orientation rather than draw attention.

### 8.2 State Expression

Global states such as:

1. saving,
2. refreshing,
3. update available,
4. auth error,
5. background job state,

should move into a consistent top status band or persistent status surface.

Local object-specific states should appear in the contextual inspector.

Toast should remain only for short outcome notifications, not as the main state carrier.

## 9. Stitch Deliverables

This design phase should produce the following in Stitch:

1. Global design system:
   - three light themes,
   - one dark theme,
   - color roles,
   - typography roles,
   - radius,
   - spacing,
   - state color rules.
2. App shell:
   - sidebar,
   - top page header,
   - global status band,
   - contextual inspector shell.
3. High-fidelity pages:
   - Sites,
   - Route,
   - Custom CLI,
   - Credit,
   - Settings.
4. Key reusable components:
   - dense registry row,
   - filter band,
   - KPI strip,
   - inspector section,
   - status tags,
   - form rows,
   - danger area,
   - modal pattern,
   - empty state pattern.

## 10. Verification Criteria

Design review should verify:

1. Sites page scan efficiency improves materially over the current card-first structure.
2. Information density is preserved or increased without visual noise explosion.
3. The three light themes preserve structure rather than changing layout semantics.
4. The unified dark mode remains readable and restrained.
5. Credit page no longer relies on gradients or visually loud hero treatment.
6. Major pages clearly belong to one product family.

## 11. Non-Goals

This spec does not include:

1. React implementation details,
2. component-level engineering breakdown,
3. state migration strategy,
4. IPC or data model changes,
5. prototype-grade interaction wiring beyond the design rules above.

## 12. Risks and Notes

1. The repository is currently in a dirty worktree; any later implementation must avoid overwriting unrelated user changes.
2. The visual companion generated a local `.superpowers/` directory. It should not be committed. Consider adding `.superpowers/` to `.gitignore` if this workflow will be reused.
3. The current app has an established iOS-oriented visual system in `src/renderer/index.css`. Implementation should replace or evolve it intentionally rather than mixing two competing design languages.

## 13. Next Step

After the user reviews and approves this spec, the next step is:

1. create a written implementation plan,
2. then use Stitch to generate the high-fidelity redesign based on this spec,
3. and only after that start React implementation.
