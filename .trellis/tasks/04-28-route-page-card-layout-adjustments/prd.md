# Route Page Card Layout Adjustments

## Goal
Adjust the top-row card layout on the route page so the statistics card on the right side of the
first row is removed, CLI-related configuration moves to the right side, and the proxy server card
becomes moderately narrower.

## Requirements
- Remove the statistics card shown on the right side of the first row in the route page layout.
- Move the CLI-related configuration card or section to the right-side area previously occupied by
  the statistics card.
- Reduce the width of the proxy server card while keeping the layout balanced and readable.
- Preserve existing route page behavior outside of the requested layout changes.

## Acceptance Criteria
- [ ] The first-row right-side statistics card no longer renders on the route page.
- [ ] CLI-related configuration appears in the right-side first-row area.
- [ ] The proxy server card width is smaller than before without causing layout breakage.
- [ ] Existing route page interactions continue to work after the layout change.

## Technical Notes
- Expected scope is renderer/frontend only unless route page composition unexpectedly depends on
  shared layout contracts.
- Follow the current route page card and grid patterns instead of introducing a new layout system.
