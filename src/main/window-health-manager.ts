import type { RenderProcessGoneDetails, WebContents } from 'electron';

const RECOVERY_RETRY_URL = 'apihub-recovery://retry';
const DEFAULT_MAX_RECOVERIES = 1;
const DEFAULT_UNRESPONSIVE_TIMEOUT_MS = 5000;
const DEFAULT_STABILITY_WINDOW_MS = 30000;

export interface RendererHealthLogger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
}

export interface RendererHealthOptions {
  loadRenderer: () => Promise<void>;
  logger: RendererHealthLogger;
  maxRecoveries?: number;
  unresponsiveTimeoutMs?: number;
  stabilityWindowMs?: number;
}

export interface RendererHealthMonitor {
  load: () => Promise<void>;
  dispose: () => void;
}

interface RendererHealthState {
  disposed: boolean;
  loading: boolean;
  showingFallback: boolean;
  recoveryAttempts: number;
  unresponsiveTimer: ReturnType<typeof setTimeout> | null;
  stabilityTimer: ReturnType<typeof setTimeout> | null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    character =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character] ?? character
  );
}

export function buildRendererRecoveryPage(reason: string): string {
  const safeReason = escapeHtml(reason);
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>API Hub Management Tools</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f8fa; color: #1f2937; }
      main { width: min(460px, calc(100vw - 48px)); padding: 32px; border: 1px solid #d7dce3; border-radius: 12px; background: #fff; box-shadow: 0 12px 32px rgb(15 23 42 / 10%); }
      h1 { margin: 0 0 12px; font-size: 20px; }
      p { margin: 8px 0; line-height: 1.6; }
      code { display: block; margin: 16px 0; padding: 10px 12px; overflow-wrap: anywhere; border-radius: 6px; background: #f0f2f5; color: #586174; font-size: 12px; }
      button { min-height: 40px; padding: 0 16px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; cursor: pointer; font-size: 14px; }
      button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
      @media (prefers-color-scheme: dark) {
        body { background: #111827; color: #e5e7eb; }
        main { border-color: #374151; background: #1f2937; box-shadow: 0 12px 32px rgb(0 0 0 / 30%); }
        code { background: #111827; color: #aeb8c8; }
      }
    </style>
  </head>
  <body>
    <main role="alert">
      <h1>页面暂时无法加载</h1>
      <p>应用已停止自动重试，以避免反复刷新。请重新加载页面。</p>
      <code>${safeReason}</code>
      <button type="button" onclick="location.href='${RECOVERY_RETRY_URL}'">重新加载</button>
    </main>
  </body>
</html>`;
}

export function createRendererHealthMonitor(
  webContents: WebContents,
  options: RendererHealthOptions
): RendererHealthMonitor {
  const maxRecoveries = Math.max(0, options.maxRecoveries ?? DEFAULT_MAX_RECOVERIES);
  const unresponsiveTimeoutMs = Math.max(
    0,
    options.unresponsiveTimeoutMs ?? DEFAULT_UNRESPONSIVE_TIMEOUT_MS
  );
  const stabilityWindowMs = Math.max(0, options.stabilityWindowMs ?? DEFAULT_STABILITY_WINDOW_MS);
  const state: RendererHealthState = {
    disposed: false,
    loading: false,
    showingFallback: false,
    recoveryAttempts: 0,
    unresponsiveTimer: null,
    stabilityTimer: null,
  };

  const clearUnresponsiveTimer = () => {
    if (state.unresponsiveTimer) {
      clearTimeout(state.unresponsiveTimer);
      state.unresponsiveTimer = null;
    }
  };

  const clearStabilityTimer = () => {
    if (state.stabilityTimer) {
      clearTimeout(state.stabilityTimer);
      state.stabilityTimer = null;
    }
  };

  const showFallback = async (reason: string) => {
    if (state.disposed || webContents.isDestroyed()) return;

    state.showingFallback = true;
    clearStabilityTimer();
    const wasLoading = state.loading;
    state.loading = true;
    try {
      await webContents.loadURL(
        `data:text/html;charset=UTF-8,${encodeURIComponent(buildRendererRecoveryPage(reason))}`
      );
    } catch (error) {
      options.logger.error('[RendererHealth] 加载恢复页面失败:', error);
    } finally {
      state.loading = wasLoading;
    }
  };

  const loadRenderer = async () => {
    if (state.disposed || webContents.isDestroyed()) return;

    clearUnresponsiveTimer();
    clearStabilityTimer();
    state.loading = true;
    state.showingFallback = false;
    try {
      await options.loadRenderer();
    } catch (error) {
      const message = getErrorMessage(error);
      options.logger.error('[RendererHealth] 加载渲染页面失败:', message);
      await showFallback(message);
    } finally {
      state.loading = false;
    }
  };

  const recover = async (reason: string, forceCrash: boolean) => {
    if (state.disposed || state.loading || state.showingFallback) return;

    if (state.recoveryAttempts >= maxRecoveries) {
      options.logger.error('[RendererHealth] 自动恢复次数已达上限:', reason);
      await showFallback(reason);
      return;
    }

    state.recoveryAttempts += 1;
    options.logger.warn(
      `[RendererHealth] 尝试恢复渲染页面 (${state.recoveryAttempts}/${maxRecoveries}):`,
      reason
    );

    if (forceCrash) {
      state.loading = true;
      try {
        webContents.forcefullyCrashRenderer();
      } catch (error) {
        options.logger.warn('[RendererHealth] 终止失效渲染进程失败:', getErrorMessage(error));
      }
    }

    await loadRenderer();
  };

  const retryFromFallback = async () => {
    if (state.disposed || state.loading || !state.showingFallback) return;
    state.recoveryAttempts = 0;
    state.showingFallback = false;
    await loadRenderer();
  };

  const scheduleStabilityReset = () => {
    clearStabilityTimer();
    state.stabilityTimer = setTimeout(() => {
      state.recoveryAttempts = 0;
      state.stabilityTimer = null;
      options.logger.info('[RendererHealth] 渲染页面稳定，已重置自动恢复预算');
    }, stabilityWindowMs);
  };

  const handleDidFinishLoad = () => {
    if (!state.showingFallback) scheduleStabilityReset();
  };

  const handleDidFailLoad = (
    _event: Electron.Event,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean
  ) => {
    if (!isMainFrame || errorCode === -3) return;
    options.logger.error('[RendererHealth] 主框架加载失败:', {
      errorCode,
      errorDescription,
      validatedURL,
    });
    if (!state.loading && !state.showingFallback) {
      void recover(`load-failed:${errorCode}:${errorDescription}`, false);
    }
  };

  const handlePreloadError = (_event: Electron.Event, preloadPath: string, error: Error) => {
    options.logger.error('[RendererHealth] preload 加载失败:', {
      preloadPath,
      error: error.message,
    });
  };

  const handleRenderProcessGone = (_event: Electron.Event, details: RenderProcessGoneDetails) => {
    if (details.reason === 'clean-exit') {
      options.logger.info('[RendererHealth] 渲染进程正常退出:', details);
      return;
    }
    options.logger.error('[RendererHealth] 渲染进程退出:', details);
    if (!state.loading && !state.showingFallback) {
      void recover(`render-process-gone:${details.reason}`, false);
    }
  };

  const handleUnresponsive = () => {
    options.logger.warn('[RendererHealth] 渲染页面无响应，等待确认');
    clearUnresponsiveTimer();
    state.unresponsiveTimer = setTimeout(() => {
      state.unresponsiveTimer = null;
      void recover('unresponsive', true);
    }, unresponsiveTimeoutMs);
  };

  const handleResponsive = () => {
    clearUnresponsiveTimer();
    options.logger.info('[RendererHealth] 渲染页面恢复响应');
  };

  const handleWillNavigate = (event: Electron.Event, url: string) => {
    if (!state.showingFallback || !url.startsWith(RECOVERY_RETRY_URL)) return;
    event.preventDefault();
    void retryFromFallback();
  };

  const handleDestroyed = () => {
    dispose();
  };

  webContents.on('did-finish-load', handleDidFinishLoad);
  webContents.on('did-fail-load', handleDidFailLoad);
  webContents.on('preload-error', handlePreloadError);
  webContents.on('render-process-gone', handleRenderProcessGone);
  webContents.on('unresponsive', handleUnresponsive);
  webContents.on('responsive', handleResponsive);
  webContents.on('will-navigate', handleWillNavigate);
  webContents.on('destroyed', handleDestroyed);

  const dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    clearUnresponsiveTimer();
    clearStabilityTimer();
    webContents.removeListener('did-finish-load', handleDidFinishLoad);
    webContents.removeListener('did-fail-load', handleDidFailLoad);
    webContents.removeListener('preload-error', handlePreloadError);
    webContents.removeListener('render-process-gone', handleRenderProcessGone);
    webContents.removeListener('unresponsive', handleUnresponsive);
    webContents.removeListener('responsive', handleResponsive);
    webContents.removeListener('will-navigate', handleWillNavigate);
    webContents.removeListener('destroyed', handleDestroyed);
  };

  return { load: loadRenderer, dispose };
}
