# brainstorm: polish cli usability page

## Goal

Refine the Route page `CLI 可用性` sub-tab so the configuration controls become inline instead of
modal, the history visualization becomes denser and more informative, and the CLI headers use the
existing colored product icons rather than color bars for distinction.

## What I already know

* The current implementation lives in
  `src/renderer/components/Route/Usability/CliUsabilityTab.tsx`.
* The current settings modal only contains two settings:
  `enabled` and `intervalMinutes`.
* The top-right action row currently shows time range buttons, status text, a `Settings2` icon
  button, and `立即探测`.
* The current history chart already uses aggregated single-row bars and currently renders:
  * `24h` => 24 bars
  * `7d` => 28 bars (6-hour buckets)
* The area below history currently shows `PAST / count / NOW`, not an availability rate.
* The repo already contains reusable colored CLI icons under `src/renderer/assets/cli-icons/`, and
  they are already used in `CustomCliPage`, `CliCompatibilityIcons`, and related dialogs.

## Assumptions (temporary)

* The inline settings row should replace the modal entirely rather than keeping both.
* The availability rate should be computed from actual probe samples within the selected time-range,
  excluding empty buckets and untested slots.
* Reusing the existing CLI SVG assets is preferable to introducing new lucide-style icons.
* The requested `+30%` history height can be implemented with a token-aligned rounded value rather
  than a fractional pixel height.

## Open Questions

* None currently.

## Requirements (evolving)

* Remove the settings modal from `CLI 可用性`.
* Move all existing detection settings into the same top control row as the current settings button.
* Increase history bar density moderately from the current sparse state.
* Increase history bar height by about 30% from the current implementation.
* Replace the bar-count text below history with an availability metric.
* Availability rate formula is `passed tests / executed tests`; untested data is excluded.
* Availability label follows the current selected range:
  * `24h` => `最近24小时可用率`
  * `7d` => `最近7天可用率`
* Table headers should use `彩色 CLI 图标 + CLI 名称` together.
* Remove the current colored bar/chip-style header distinction once icon+name headers are present.
* When a site row has a CLI that is not enabled, show explicit reminder text instead of a silent
  blank area.

## Acceptance Criteria (evolving)

* [ ] The settings modal is no longer used by `CLI 可用性`.
* [ ] Users can edit `启用定时检测` and `检测间隔` inline in the top row.
* [ ] History bars are denser than the current implementation without becoming visually noisy.
* [ ] History bar height is visibly about 30% taller than the current version.
* [ ] The text below each history bar shows availability rate instead of bar-count.
* [ ] Availability text follows the selected range and excludes untested data from the denominator.
* [ ] Table headers display the correct `彩色图标 + CLI 名称` combination.
* [ ] Header differentiation no longer depends on colored bars/chips.
* [ ] Disabled CLI cells show explicit reminder text for the user.
* [ ] Existing detail text and aggregated tooltip behavior remain intact.

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* Changing CLI probe persistence or aggregation semantics beyond this page's display needs
* Redesigning other Route page tabs
* Changing Sites page CLI compatibility UI

## Technical Notes

* Main UI file:
  `src/renderer/components/Route/Usability/CliUsabilityTab.tsx`
* Current focused test:
  `src/__tests__/cli-usability-tab.test.tsx`
* Existing reusable colored icons:
  * `src/renderer/assets/cli-icons/claude-code.svg`
  * `src/renderer/assets/cli-icons/codex.svg`
  * `src/renderer/assets/cli-icons/gemini.svg`
* Existing icon usage patterns:
  * `src/renderer/components/CliCompatibilityIcons/CliCompatibilityIcons.tsx`
  * `src/renderer/pages/CustomCliPage.tsx`

## Research Notes

### What the current code already implies

* Inline settings is low-risk because the modal currently only wraps two primitive controls and a
  save action.
* The page already has a compact top action bar, so inline controls need to remain horizontally
  efficient.
* The bar density is currently controlled centrally by `HISTORY_CONFIG`, so this can be adjusted
  without changing persistence shape.
* Availability can be derived from raw history samples directly; no backend schema change is needed.
* Disabled / no-account / no-model states are already rendered as text blocks in the current cell
  component, so adding a clearer disabled reminder is a display-level change.

### Constraints from this repo

* The page should remain theme-token based and follow the current Route page layout.
* The same page is already relatively dense, so inline settings must not create excessive wrapping
  on narrower desktop widths.
* Existing SVG assets should be preferred over inventing new visual language.

### Feasible approaches here

**Approach A: Compact inline settings row** (Recommended)

* How it works:
  Replace the settings button with a switch, interval input, and save/apply button inline beside
  the current status text and `立即探测`.
* Pros:
  Matches the user's request directly; fastest interaction; no hidden state.
* Cons:
  Needs careful spacing to avoid crowding.

**Approach B: Inline settings strip with wrap-to-second-line fallback**

* How it works:
  Keep controls inline in the same header block, but allow them to wrap below the action row on
  narrower widths.
* Pros:
  Safer responsiveness.
* Cons:
  Slightly less strict than "same line" if width is limited.

### Initial recommendation

* Use Approach A as the default layout.
* Reuse the existing colored CLI SVG icons from other surfaces.
* Compute availability from actual samples in the selected display context, and let the label follow
  the selected range (`最近24小时` / `最近7天`).
* Keep headers readable by showing icon and label together, not icon-only.
