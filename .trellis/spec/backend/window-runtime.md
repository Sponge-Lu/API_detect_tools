# Window Runtime

## Scenario: Renderer Fault Containment

### 1. Scope / Trigger

Apply this contract when changing the Electron main window, renderer entrypoint, or preload loading.

### 2. Signatures

```ts
createRendererHealthMonitor(
  webContents: WebContents,
  options: {
    loadRenderer: () => Promise<void>;
    logger: RendererHealthLogger;
    maxRecoveries?: number;
    unresponsiveTimeoutMs?: number;
    stabilityWindowMs?: number;
  }
): { load: () => Promise<void>; dispose: () => void };
```

The renderer entrypoint must mount `App` inside `AppErrorBoundary`.

### 3. Contracts

* Observe `did-fail-load`, `preload-error`, `render-process-gone`, `unresponsive`, `responsive`, and `destroyed` on the main window web contents.
* Automatically recover at most once within one stability window. Reset the budget only after a successful page load remains stable for the configured window.
* An unresponsive renderer is forcefully terminated before loading the application again.
* After the automatic budget is exhausted, load a built-in error page with an explicit manual retry action.
* Root React exceptions render a visible reload action instead of leaving an empty document.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Main-frame `did-fail-load`, error other than `-3` | Log details and consume one automatic recovery attempt |
| Subframe load failure | Log only if needed; never reload the application |
| `ERR_ABORTED` (`-3`) | Ignore as expected navigation cancellation |
| `render-process-gone: clean-exit` | Record as normal exit; do not recover |
| Unexpected renderer exit | Log `reason`/`exitCode` and recover within budget |
| `unresponsive` followed by `responsive` before timeout | Cancel pending recovery |
| Persistent failure after budget exhaustion | Show built-in retry page; never loop automatically |
| React render/lifecycle exception | Show `AppErrorBoundary` fallback |

### 5. Good / Base / Bad Cases

* Good: one OOM exit reloads the renderer; a second immediate exit shows the recovery page.
* Base: a stable renderer resets the budget and a later independent failure may recover once.
* Bad: every `did-fail-load` calls `reload()` without a counter.

### 6. Tests Required

* Unit-test one recovery followed by fallback on the next failure.
* Unit-test stability-window budget reset.
* Unit-test synchronous `render-process-gone` during forced unresponsive recovery.
* Unit-test subframe and `ERR_ABORTED` exclusions.
* Render a throwing React child and assert the reload fallback is operable.

### 7. Wrong vs Correct

#### Wrong

```ts
webContents.on('render-process-gone', () => webContents.reload());
```

#### Correct

```ts
const monitor = createRendererHealthMonitor(webContents, { loadRenderer, logger });
```
