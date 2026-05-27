# Directory Structure

> How frontend code is organized in this project.

---

## Overview

The renderer is organized by responsibility, not by route packages. The top-level split is stable:

- `src/renderer/` contains UI code.
- `src/shared/` contains cross-process types, constants, schemas, and theme helpers.
- `src/__tests__/` contains most renderer tests and shared frontend test setup.

Within `src/renderer/`, the project uses a mixed structure:

- page-level containers under `pages/`
- reusable UI under `components/`
- reusable business logic under `hooks/`
- shared state under `store/`
- small renderer-only helpers under `utils/` and `services/`

There is no router directory because the app does not use React Router. Tab/page visibility is
controlled in `src/renderer/App.tsx`.

---

## Directory Layout

```text
src/
├── renderer/
│   ├── main.tsx                 # React entrypoint
│   ├── App.tsx                  # Root shell, page mounting, global dialogs
│   ├── index.css                # Global tokens, utilities, responsive + a11y rules
│   ├── pages/                   # Page-level containers
│   ├── components/              # UI primitives and feature components
│   ├── hooks/                   # Reusable renderer business logic
│   ├── store/                   # Zustand stores
│   ├── services/                # Small renderer-side service helpers
│   ├── utils/                   # Pure helpers for UI behavior and formatting
│   └── assets/                  # SVGs and icon assets
├── shared/
│   ├── types/                   # Shared contracts used by main and renderer
│   ├── constants/               # Shared constants
│   └── theme/                   # Theme contracts and normalization helpers
└── __tests__/                   # Vitest + RTL + property tests
```

---

## Module Organization

### Entry and shell

- `src/renderer/main.tsx` mounts the app and imports `index.css`.
- `src/renderer/App.tsx` is the root shell. It owns high-level initialization, page switching,
  global dialogs, and top-level IPC bootstrapping.

### Pages

- `src/renderer/pages/` holds page-sized containers such as `SitesPage.tsx`,
  `CustomCliPage.tsx`, `SettingsPage.tsx`, and `RoutePage.tsx`.
- Pages are allowed to own substantial local UI state.
- Pages compose feature components, hooks, and stores. They are not the place for shared primitive
  styling rules.

### Components

- `src/renderer/components/` mixes:
  - primitive families such as `AppButton/`, `AppInput/`, `AppCard/`, `AppModal/`, `AppIcon/`,
    `DataTable/`
  - feature families such as `Route/`, `SiteCard/`, `Sidebar/`, `Toast/`, `dialogs/`
  - single-file components such as `ConfirmDialog.tsx` and `SiteEditor.tsx`
- Use a new folder when a surface needs multiple files or private helper types.
- Use a single `.tsx` file for simple standalone components.

### Hooks

- `src/renderer/hooks/` contains reusable business logic such as `useDataLoader`,
  `useAutoRefresh`, `useTheme`, `useSiteGroups`, and `useCliCompatTest`.
- Hooks are used to pull orchestration logic out of large page containers.

### Stores

- `src/renderer/store/` uses one Zustand store per domain:
  `configStore.ts`, `uiStore.ts`, `detectionStore.ts`, `routeStore.ts`,
  `toastStore.ts`, `customCliConfigStore.ts`.

### Shared contracts

- Cross-process types belong in `src/shared/types/*`.
- Shared constants belong in `src/shared/constants/*`.
- Theme keys and normalization helpers belong in `src/shared/theme/*`.

---

## Naming Conventions

- React components and pages use `PascalCase.tsx`.
- Hooks use `useX.ts`.
- Stores use `camelCaseStore.ts`.
- Utilities use `camelCase.ts` or `camelCase.tsx`.
- Folder names are usually `PascalCase` for UI component families and lowercase for
  non-component domains (`hooks`, `store`, `utils`, `services`, `pages`).
- `index.ts` barrel files are common in folders, but not mandatory. Follow the local pattern of the
  folder you are editing.

---

## Placement Rules

- New page-level workflows go under `src/renderer/pages/` and must be mounted from `App.tsx`.
- New reusable visual primitives belong under `src/renderer/components/`.
- New reusable async/business logic belongs under `src/renderer/hooks/`.
- New cross-component state belongs under `src/renderer/store/`.
- New types that must match main/preload/renderer behavior belong under `src/shared/`, not only in
  renderer code.
- Do not place source files under `dist/`, `dist-renderer/`, or `release/`.

---

## Examples

1. Root shell and page switching:
   `src/renderer/App.tsx` keeps the sidebar, command bar, page header, and global dialogs together,
   then toggles pages with CSS visibility classes rather than route objects.

2. Primitive family:
   `src/renderer/components/AppCard/` groups `AppCard.tsx`, `index.ts`, and `primitives.ts` under
   one folder because the primitive has multiple exported pieces.

3. Feature family:
   `src/renderer/components/Route/` splits a large feature into subfolders
   (`Redirection/`, `Usability/`, `ProxyStats/`) while keeping route-specific UI out of generic
   pages.

4. Shared contract boundary:
   `src/shared/types/site.ts` is the source of truth for site-related payloads used by renderer,
   tests, and Electron handlers.

---

## Anti-Patterns

- Do not introduce a second frontend source root outside `src/renderer/`.
- Do not put shared IPC payload types only inside renderer files.
- Do not add routing-specific abstractions unless the app actually adopts a router.
- Do not use generated output folders as source-of-truth references.
