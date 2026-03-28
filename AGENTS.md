# Repository Guidelines

## Project Structure & Module Organization

- `src/main/`: Electron main process (window lifecycle, Node-side services). IPC handlers live in `src/main/handlers/`.
- `src/renderer/`: React UI (Vite entrypoints, components, hooks, Zustand store).
- `src/shared/`: shared types/constants/schemas used by both processes.
- `src/__tests__/`: Vitest setup and most tests (see `src/__tests__/setup.ts`).
- `docs/`: user/developer/architecture docs.
- Generated outputs: `dist/`, `dist-renderer/`, `release/` (do not edit or commit).

If you add/remove modules, update `PROJECT_INDEX.md` and the relevant `FOLDER_INDEX.md` files under `src/`.

## Build, Test, and Development Commands

Prereqs: Node.js >= 18 and Chrome installed (used for browser automation flows).

- `npm install` (or `npm ci` for a clean, lockfile-driven install)
- `npm run dev`: start renderer (Vite) and main (Electron) together
- `npm run build`: compile main + renderer into `dist/` and `dist-renderer/`
- `npm run dist:win` / `npm run dist:mac` / `npm run dist:linux`: package with electron-builder into `release/`
- `npm run lint` / `npm run lint:fix`: ESLint checks (and auto-fixes)
- `npm run format`: Prettier formatting for `src/**/*.{ts,tsx,css}`

## Coding Style & Naming Conventions

- TypeScript for all new code; keep `tsconfig` strictness passing.
- Prettier is the source of truth: 2-space indent, single quotes, semicolons, `printWidth: 100`.
- Naming: React components `PascalCase.tsx`; functions/variables `camelCase`.
- Prefer `@/…` imports where applicable (`@` aliases to `src/` in Vite/Vitest).

## Testing Guidelines

- Framework: Vitest (`jsdom` environment) + React Testing Library; property tests use `fast-check`.
- Naming: `*.test.ts(x)` / `*.spec.ts(x)`; property tests end with `*.property.test.ts`.
- Run: `npm test`, `npm run test:watch`, `npm run test:coverage`.

## Commit & Pull Request Guidelines

- Git history mostly follows Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, often with scopes (e.g. `fix(update): …`).
- Release/version bumps commonly use `vX.Y.Z: …` (e.g. `v2.1.24: …`). Keep `package.json` `version` and `build.buildVersion` in sync for releases.
- Pre-commit hooks use Husky + lint-staged to run ESLint/Prettier on staged files; fix locally with `npm run lint:fix` and `npm run format`.
- PRs should include: a clear description + test plan, linked issues when relevant, and screenshots/recordings for UI changes. Call out which OS you tested on (win/mac/linux) for Electron-impacting changes.

## Security & Configuration Tips

- Do not commit real tokens/keys or `.env*` files (see `.gitignore`).
- Runtime state (config, backups, logs) is stored under Electron `userData` (for example `config.json` and `logs/`), not in the repository.
