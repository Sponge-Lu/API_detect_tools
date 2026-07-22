# Electron renderer recovery

## Repository evidence

* `src/main/main.ts` waits for `ready-to-show` but does not observe `did-fail-load`, `preload-error`, `render-process-gone`, or `unresponsive`.
* `src/renderer/main.tsx` mounts `App` without a root error boundary.
* `src/renderer/App.tsx` mounts every page under one `Suspense` boundary and hides inactive pages with CSS. An exception from any mounted page can therefore take down the shared React root.
* `LogsPage` already uses a complete `Record<RouteRequestLogItem['cliType'], ...>` icon map in `HEAD`, including `grokBuild`; it is not evidence for the reported white screen and remains outside this fix.
* The persistent main-process log contains business request failures but no renderer lifecycle diagnostics, so current reports cannot distinguish a load failure, renderer crash, or React exception.

## Official API findings

* [`webContents`](https://electronjs.org/docs/latest/api/web-contents) documents `did-fail-load`, `preload-error`, `render-process-gone`, `unresponsive`, and `responsive`.
* The same documentation recommends `forcefullyCrashRenderer()` followed immediately by `reload()` when recovering an unusable renderer process.
* These APIs are present in the Electron 28 type surface used by this project.

## Constraints for this project

* Recovery must be bounded to avoid an infinite crash/reload loop.
* Main-frame failures should be handled; subframe failures must not reload the application.
* Expected navigation cancellation errors must not be treated as application failures.
* React exceptions need a visible fallback and an explicit user-triggered retry even if automatic Electron recovery is exhausted.

## Recommended scope

Use layered containment: record Electron lifecycle failures, perform one bounded automatic recovery for an unexpected renderer exit or main-frame load failure, and add a React root error boundary with a visible reload action. Avoid speculative GPU switches because no GPU-process evidence exists.
