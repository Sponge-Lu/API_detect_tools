# Fix route model redirection dialog overflow

## Goal
Prevent the route page "edit model redirection" dialog from shifting its content upward when the
selected original-model chip area overflows.

## Requirements
- Keep the modal header, body, and footer in a stable vertical layout.
- Allow the selected original-model chip/card area to scroll internally when many models are
  selected.
- Preserve the candidate model list as the primary flexible scroll area inside the dialog.
- Keep the change scoped to the route redirection edit dialog and related regression coverage.

## Acceptance Criteria
- [ ] Opening the edit dialog with many selected original models does not move the overall modal
      content upward or leave blank space under the footer.
- [ ] The selected original-model area scrolls internally once it exceeds its cap.
- [ ] The main candidate list remains usable after the change.
- [ ] Relevant tests pass.

## Technical Notes
- Follow frontend modal layout guidance in `.trellis/spec/frontend/component-guidelines.md`.
- Avoid broad refactors outside the dialog layout and regression tests.
