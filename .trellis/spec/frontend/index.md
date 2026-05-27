# Frontend Development Guidelines

> Project-specific conventions for the Electron renderer in this repository.

---

## Overview

The frontend is a single React 18 renderer app under `src/renderer/`, built with Vite and styled
with Tailwind utility classes plus a large CSS-token layer in `src/renderer/index.css`.

Key architectural facts:

- No client-side router is used today. `src/renderer/App.tsx` is the shell and controls visible
  pages with store-driven tab state.
- IPC is the main backend boundary. Renderer code talks to Electron through
  `window.electronAPI`.
- Shared contracts live under `src/shared/` and are consumed by both main and renderer code.
- Zustand is the default shared-state solution. Page-local ephemeral state stays inside React
  components.

---

## Pre-Development Checklist

Read these files before editing renderer code:

1. Always read [Directory Structure](./directory-structure.md) to place code in the existing layout.
2. Read [Component Guidelines](./component-guidelines.md) when touching UI, dialogs, layout, or
   primitive controls.
3. Read [Hook Guidelines](./hook-guidelines.md) when adding async UI logic, timers, or reusable
   business logic.
4. Read [State Management](./state-management.md) when touching Zustand stores or shared UI state.
5. Read [Type Safety](./type-safety.md) when changing IPC payloads, shared data models, or theme
   constants.
6. Read [Quality Guidelines](./quality-guidelines.md) before finishing work.

Also read `.trellis/spec/guides/index.md` and then the relevant thinking guide when the task spans
multiple layers or introduces a new helper/config value.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Documented |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | Documented |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | Documented |
| [State Management](./state-management.md) | Local state, global state, persistence boundaries | Documented |
| [Quality Guidelines](./quality-guidelines.md) | Linting, testing, accessibility, project-specific checks | Documented |
| [Type Safety](./type-safety.md) | Shared contracts, IPC typing, import patterns | Documented |

---

## How To Use This Directory

- Treat these files as descriptions of the current codebase, not aspirational style guides.
- Prefer patterns that appear in multiple real files over one-off experiments.
- If you change renderer conventions, update the relevant guideline file in the same task.
- If you change module structure, also update `PROJECT_INDEX.md` and the relevant `FOLDER_INDEX.md`
  files, because the repository relies on its fractal index system.

---

## Primary Examples

- Shell and page switching: `src/renderer/App.tsx`
- Global styling tokens: `src/renderer/index.css`
- Shared types and site contracts: `src/shared/types/site.ts`
- Primitive UI contract: `src/renderer/components/AppButton/AppButton.tsx`
- Shared UI state: `src/renderer/store/uiStore.ts`
- Hook-based async orchestration: `src/renderer/hooks/useDataLoader.ts`

---

**Language**: Keep Trellis spec documents in English even if product UI strings are Chinese.
