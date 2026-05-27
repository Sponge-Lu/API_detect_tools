# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

Frontend quality in this repository is enforced through four layers:

1. formatting and linting
2. strict TypeScript
3. Vitest + React Testing Library + property tests
4. project-specific documentation/index maintenance

---

## Forbidden Patterns

- Do not ship renderer changes without updating or extending tests when behavior changed.
- Do not bypass `window.electronAPI` typing or mocking in tests with uncontrolled globals.
- Do not hardcode colors, radii, or spacing if shared tokens already exist.
- Do not edit generated output folders.
- Do not forget index/doc maintenance after structural source changes.
- Do not introduce raw browser dialogs as a new default UI pattern.

---

## Required Patterns

Current repo-level rules:

- Prettier is the formatting source of truth.
- ESLint runs on `src/**/*.{ts,tsx}`.
- Renderer style uses single quotes, semicolons, 2-space indentation, trailing commas `es5`,
  `printWidth: 100`, and `arrowParens: avoid`.
- Hooks rules are active (`react-hooks/rules-of-hooks` error, `exhaustive-deps` warn).
- `no-explicit-any` is a warning, not a hard error.
- Structural code changes require updating `PROJECT_INDEX.md` and the relevant `FOLDER_INDEX.md`
  files.

Primary config sources:

- `package.json`
- `.prettierrc`
- `eslint.config.mjs`
- `tsconfig.json`
- `AGENTS.md`
- `CLAUDE.md`

---

## Testing Requirements

### Current stack

- Vitest
- `jsdom`
- React Testing Library
- `fast-check` property tests

Primary test config:

- `vitest.config.mts`
- `src/__tests__/setup.ts`

### Current test patterns

- Primitive contract tests are common.
- Property-based tests are heavily used for UI contracts and utility invariants.
- Hook tests use `renderHook`.
- Renderer tests stub `window.electronAPI` in shared setup.

Examples:

1. `src/__tests__/app-button.property.test.tsx`
   verifies token-driven class contracts, disabled behavior, and loading behavior of `AppButton`.

2. `src/__tests__/useSiteGroups.test.ts`
   tests a custom hook with `renderHook`, mocked callbacks, and `act(...)`.

3. `src/__tests__/responsive-layout.property.test.tsx`
   checks layout utility invariants and responsive CSS expectations.

4. `src/__tests__/setup.ts`
   stubs `alert` and the Electron bridge for renderer tests.

What to test when touching frontend code:

- Shared primitives: add or update focused primitive contract tests.
- Reusable hooks: add hook tests or property tests for the changed behavior.
- Layout/theme/token changes: add tests that cover token contracts or responsive behavior.
- Electron bridge interactions: extend mocks/stubs in `setup.ts` or local test scaffolding.
- Dense scroll surfaces: add a focused regression test for the chosen performance guardrails
  (for example, blur disabled on the main data card, `content-visibility` on repeated rows, or
  memoized rendering paths that should remain stable).

---

## Code Review Checklist

Before finishing frontend work:

1. Run `npm run lint`.
2. Run targeted `npm test` coverage for the changed renderer area, or the full test suite if the
   change crosses boundaries.
3. Confirm TypeScript strictness still passes through the normal build/test flow.
4. If you changed shared UI tokens, responsive behavior, or theme behavior, update related property
   tests.
5. If you changed source structure, update `PROJECT_INDEX.md` and the relevant `FOLDER_INDEX.md`
   files.
6. Re-check the shared types and `window.electronAPI` declaration when an IPC contract changes.
7. For data-dense scrollable pages, explicitly inspect whether large blurred containers,
   row-by-row heavy recomputation, or missing containment could cause jank before considering the
   task done.
