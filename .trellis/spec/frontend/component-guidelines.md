# Component Guidelines

> How components are built in this project.

---

## Overview

The current UI component system is based on a small set of reusable primitives plus feature-specific
compositions.

Actual renderer patterns:

- Shared primitives encapsulate the visual contract:
  `AppButton`, `AppInput`, `AppCard`, `AppModal`, `AppIcon`, `DataTable`.
- Feature components build workflows on top of those primitives:
  `ConfirmDialog`, `SiteCard/*`, `Route/*`, `dialogs/*`, `CliConfigStatus/*`.
- Some page-specific controls still use raw `input`, `select`, and `button` elements when the UI is
  highly specialized, but those elements are still styled with the same token system.

Preferred direction based on current code: reuse a primitive when the visual and behavioral pattern
already exists; use raw elements only when the surface is too custom for a primitive.

---

## Component Structure

- Keep simple standalone components in one `.tsx` file.
- Use a folder when a component family needs helper files, private subcomponents, or local types.
- Export one obvious public surface per component family.
- Favor composition over deep inheritance or helper-heavy abstraction layers.
- Before changing a user-visible workflow, prove the active render owner from the route/page first.
  Start at `src/renderer/App.tsx` or the owning route, then follow imports into the rendered page.
  Do not infer ownership from component names such as `*Dialog`, `*Editor`, or legacy list drawers.
- If the same domain has both a page workflow and a dialog/drawer workflow, update the page that is
  actually mounted for the user's navigation path and add or update that page's regression test.
  Example: the Custom CLI navigation renders `src/renderer/pages/CustomCliPage.tsx`; the old
  `CustomCliConfigEditorDialog.tsx` is not the active left-right custom CLI configuration surface.

Examples:

1. `src/renderer/components/AppButton/AppButton.tsx`
   is a single-file primitive because it exposes one main public control.

2. `src/renderer/components/SiteCard/`
   is a folder because the card is split into header/details/actions/types files.

3. `src/renderer/components/Route/`
   is structured by sub-surface instead of one giant route workbench component.

---

## Props Conventions

- Define an explicit props interface for every reusable component.
- When the component wraps a DOM element, extend the relevant React DOM attributes interface.
- Use `forwardRef` for primitives that are expected to behave like native controls.
- Keep variant and size options as string unions, not free-form strings.
- Use optional `className` extension points instead of exposing many styling booleans.

Examples:

1. `src/renderer/components/AppButton/AppButton.tsx`
   - `AppButtonProps` extends `React.ButtonHTMLAttributes<HTMLButtonElement>`
   - `variant`, `size`, and `loading` are explicit unions/booleans
   - native button props are forwarded through `...props`

2. `src/renderer/components/AppInput/AppInput.tsx`
   - `AppInputProps` extends input attributes and adds `label`, `errorMessage`, `helpText`,
     `leftIcon`, and `showPasswordToggle`
   - ids are generated with `useId()` and wired into `aria-describedby`

3. `src/renderer/components/AppCard/AppCard.tsx`
   - `AppCardProps` keeps layout and accessibility behavior explicit:
     `variant`, `blur`, `hoverable`, `expanded`, `draggable`, `focusable`, `aria-label`

---

## Styling Patterns

Renderer components use:

- Tailwind utility classes in JSX
- CSS custom properties from `src/renderer/index.css`
- occasional shared utilities defined in `index.css` for performance, accessibility, and layout

Current styling rules to follow:

- Prefer tokenized values such as `var(--accent)`, `var(--surface-1)`, `var(--radius-md)`.
- Prefer utility strings inside the component over separate CSS files.
- Match the existing neutral surface system instead of adding isolated color palettes.
- Use `var(--line-muted)` for dense table/list separators and low-emphasis card outlines that can
  look too bright in dark mode. Keep `var(--line-soft)` for normal controls, inputs, buttons, and
  modal surfaces that need a clearer boundary.
- Reuse shared focus, transition, and disabled behavior patterns where possible.
- For large scrollable grids, logs, or matrix views, do not keep heavyweight glassmorphism effects
  such as `backdrop-blur` on the full scrolling container. Use the existing primitive escape hatch
  (`blur={false}` / `hoverable={false}` on `AppCard`) when the card wraps dense data.
- For repeated rows in long scroll containers, prefer browser-level containment such as
  `content-visibility: auto` plus a reasonable `contain-intrinsic-size` so offscreen rows do not
  pay full paint/layout cost during scroll.
- Memoize expensive derived render data for dense repeated visuals (history bars, per-row
  aggregation, availability summaries) instead of rebuilding those arrays and tooltips in the hot
  render path.
- In fixed-height dialogs with stacked optional panels and a primary scroll area, cap optional
  panels with their own internal scrolling and reserve remaining height for the primary list using
  `min-h-0` plus `basis-0`/`flex-1`.
- When a dialog also has a footer, constrain the modal root as a vertical flex container and let the
  body use `min-h-0` plus `flex-1`; do not fake full-height layouts by setting a fixed height only
  on the scroll body, or the header/footer stack can drift and leave unusable blank space.
- When a fixed-height dialog body contains its own nested column layout, make the body itself a
  flex container and let the inner wrapper use `flex-1`/`basis-0`; relying on an inner `h-full`
  block is brittle and can leave the footer floating above empty space once optional panels appear.
- When a fixed-height dialog splits a secondary summary panel and a primary chooser list side by
  side, avoid a hard `h-*` on the secondary panel's scroll region. Use a capped `max-h-*` together
  with breakpoint-aware `min-h-0`/`flex-1`/`basis-0` so shorter windows can shrink that panel
  instead of pushing the footer upward.
- In shared modal primitives, do not combine the viewport scroll container and the flex centering
  container on the same node. Keep the outer overlay responsible for scrolling/backdrop, then use a
  separate `min-h-full` inner wrapper for centering; otherwise near-viewport-height dialogs can
  jump vertically when their content height changes.
- In Chromium/Electron, do not use `overflow: hidden` on the dialog surface itself when nested
  content changes height during interaction. That makes the surface a scroll container with a
  mutable `scrollTop`, so the browser can roll the whole modal body/header/footer upward. Use
  `overflow: clip` on the surface and keep scrolling owned by dedicated body/list containers.
- Do not let explanatory helper copy compete with dense selection/search workflows for vertical
  space inside modals; remove or collapse it when the workflow already makes the action obvious.
- For responsive inline charts that use SVG with `preserveAspectRatio="none"`, do not draw data
  point markers as SVG `<circle>` elements. Non-uniform scaling turns circles into ellipses, and
  edge points can be clipped by the viewBox. Keep line/bar geometry in SVG, inset line coordinates
  by at least the marker/stroke radius, set `vectorEffect="non-scaling-stroke"` on stroked paths,
  and render point markers as fixed-size absolutely positioned HTML dots over the chart.
- For fixed-window time-series charts, generate the complete selected window before merging real
  buckets. A `24h` window should expose 24 hourly x-axis points, and a `7d` window should expose 7
  daily x-axis points even when analytics data is partial. Missing buckets should stay at zero for
  aggregation, but leading empty buckets before the first real point should render only axis labels,
  not bars or line segments.
- For dot-matrix charts, do not let each grid cell be the dot. Grid cells change aspect ratio as the
  card resizes, producing rounded rectangles or invisible points. Center a fixed-width/fixed-height
  rounded dot inside each cell, and use token classes without unsupported opacity suffixes on CSS
  variable arbitrary colors.

Examples:

1. `src/renderer/components/AppButton/AppButton.tsx`
   uses token-driven classes for variants and focus styles.

2. `src/renderer/components/AppInput/AppInput.tsx`
   uses tokenized borders, shadows, and focus rings; no CSS module is involved.

3. `src/renderer/components/AppCard/AppCard.tsx`
   uses tokenized shadows, radii, blur, and performance hints directly in class strings.

4. `src/renderer/pages/CustomCliPage.tsx`
   shows the accepted fallback pattern for custom form layouts: native controls with the same token
   classes as the primitives.

5. `src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx`
   caps the "selected original models" chip area with its own scroll container and gives the
   candidate list the remaining height, preventing optional summary content from squeezing the main
   chooser list out of view.

6. `src/renderer/components/Route/Usability/CliUsabilityTab.tsx`
   disables card blur for the dense availability matrix, memoizes history-bar derivations, and uses
   `content-visibility` on site rows to keep vertical scrolling smooth.

---

## Accessibility

- Use labels, `aria-*` attributes, and semantic roles when behavior is not obvious from the element.
- Preserve keyboard accessibility for dialogs, icon buttons, toggles, and custom controls.
- Respect the global focus-visible system defined in `index.css`.
- Prefer `useId()` for connecting labels/help/error text.

Examples:

1. `AppInput.tsx` sets `aria-invalid`, `aria-required`, and `aria-describedby`.
2. `ConfirmDialog.tsx` autofocuses the confirm button and handles `Enter` confirmation.
3. `CustomCliPage.tsx` marks the switch as `role="switch"` and uses `aria-checked`.

---

## Common Mistakes

- Do not hardcode raw colors or spacing when a shared token already exists.
- Do not add a new primitive when a page-specific wrapper around an existing primitive is enough.
- Do not copy browser `alert`/`confirm` flows into new UI; use the modal/dialog path instead.
- Do not expose untyped `any` prop bags on reusable components.
- Do not forget accessibility wiring when using raw `button`, `input`, or `select` elements.

Legacy note:

- `src/renderer/hooks/useSiteGroups.ts` still contains direct `alert(...)` calls for a couple of
  validation branches. Treat that as existing debt, not as the preferred component pattern.
