# Backend Development Guidelines

> Project-specific contracts for Electron main-process services and shared runtime behavior.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Storage Runtime](./storage-runtime.md) | Stable config, runtime sidecars, manifest backup/restore, and migration contracts | Documented |
| [Route Runtime](./route-runtime.md) | Route proxy ordering, per-path health state, and cross-layer display contract | Documented |
| [Site Detection Runtime](./site-detection.md) | Site refresh response parsing and account-level check-in credential contract | Documented |
| [Token Service](./token-service.md) | Data source categories (browser vs API), token lifecycle, and refresh vs recovery semantics | Documented |

---

## How To Use This Directory

- Treat these files as executable contracts for `src/main/` services and shared types.
- When a backend behavior is also rendered in `src/renderer/`, keep the shared payload shape in `src/shared/` and document the boundary here.
- If a behavior changes error codes, persisted config fields, or IPC payloads, update the relevant spec in the same task.
