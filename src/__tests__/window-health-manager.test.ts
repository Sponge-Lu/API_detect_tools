import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import {
  buildRendererRecoveryPage,
  createRendererHealthMonitor,
  type RendererHealthLogger,
} from '../main/window-health-manager';

class FakeWebContents extends EventEmitter {
  loadURL = vi.fn().mockResolvedValue(undefined);
  forcefullyCrashRenderer = vi.fn();
  isDestroyed = vi.fn().mockReturnValue(false);
}

function createLogger(): RendererHealthLogger {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  };
}

function emit(webContents: FakeWebContents, event: string, ...args: unknown[]) {
  webContents.emit(event, ...args);
}

describe('createRendererHealthMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('recovers once after a renderer crash and then shows a fallback page', async () => {
    const webContents = new FakeWebContents();
    const logger = createLogger();
    const loadRenderer = vi.fn().mockResolvedValue(undefined);
    const monitor = createRendererHealthMonitor(webContents as unknown as WebContents, {
      loadRenderer,
      logger,
      stabilityWindowMs: 100,
    });

    await monitor.load();
    emit(webContents, 'did-finish-load');
    emit(webContents, 'render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    await vi.runOnlyPendingTimersAsync();
    expect(loadRenderer).toHaveBeenCalledTimes(2);

    emit(webContents, 'did-finish-load');
    emit(webContents, 'render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    await vi.runOnlyPendingTimersAsync();
    expect(loadRenderer).toHaveBeenCalledTimes(2);
    expect(webContents.loadURL).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(String(webContents.loadURL.mock.calls[0][0]))).toContain(
      '页面暂时无法加载'
    );

    monitor.dispose();
  });

  it('resets the recovery budget after a stable renderer period', async () => {
    const webContents = new FakeWebContents();
    const loadRenderer = vi.fn().mockResolvedValue(undefined);
    const monitor = createRendererHealthMonitor(webContents as unknown as WebContents, {
      loadRenderer,
      logger: createLogger(),
      stabilityWindowMs: 100,
    });

    await monitor.load();
    emit(webContents, 'render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    await vi.runOnlyPendingTimersAsync();
    expect(loadRenderer).toHaveBeenCalledTimes(2);

    emit(webContents, 'did-finish-load');
    await vi.advanceTimersByTimeAsync(100);
    emit(webContents, 'render-process-gone', {}, { reason: 'oom', exitCode: 137 });
    await vi.runOnlyPendingTimersAsync();
    expect(loadRenderer).toHaveBeenCalledTimes(3);
    expect(webContents.loadURL).not.toHaveBeenCalled();
    monitor.dispose();
  });

  it('forcefully terminates an unresponsive renderer before recovery', async () => {
    const webContents = new FakeWebContents();
    const loadRenderer = vi.fn().mockResolvedValue(undefined);
    const monitor = createRendererHealthMonitor(webContents as unknown as WebContents, {
      loadRenderer,
      logger: createLogger(),
      unresponsiveTimeoutMs: 100,
    });

    await monitor.load();
    webContents.forcefullyCrashRenderer.mockImplementation(() => {
      emit(webContents, 'render-process-gone', {}, { reason: 'killed', exitCode: 1 });
    });
    emit(webContents, 'unresponsive');
    await vi.advanceTimersByTimeAsync(100);
    await vi.runOnlyPendingTimersAsync();
    expect(webContents.forcefullyCrashRenderer).toHaveBeenCalledTimes(1);
    expect(loadRenderer).toHaveBeenCalledTimes(2);
    expect(webContents.loadURL).not.toHaveBeenCalled();
    monitor.dispose();
  });

  it('ignores expected navigation cancellation and subframe load failures', async () => {
    const webContents = new FakeWebContents();
    const loadRenderer = vi.fn().mockResolvedValue(undefined);
    const monitor = createRendererHealthMonitor(webContents as unknown as WebContents, {
      loadRenderer,
      logger: createLogger(),
    });

    await monitor.load();
    emit(webContents, 'did-fail-load', {}, -3, 'ERR_ABORTED', 'http://localhost', true);
    emit(webContents, 'did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://frame', false);
    await vi.runOnlyPendingTimersAsync();
    expect(loadRenderer).toHaveBeenCalledTimes(1);

    emit(webContents, 'did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://app', true);
    await vi.runOnlyPendingTimersAsync();
    expect(loadRenderer).toHaveBeenCalledTimes(2);
    monitor.dispose();
  });

  it('routes the fallback retry action back to the application loader', async () => {
    const webContents = new FakeWebContents();
    const loadRenderer = vi.fn().mockRejectedValueOnce(new Error('initial failure'));
    const monitor = createRendererHealthMonitor(webContents as unknown as WebContents, {
      loadRenderer,
      logger: createLogger(),
    });

    await monitor.load();
    const event = { preventDefault: vi.fn() };
    emit(webContents, 'will-navigate', event, 'apihub-recovery://retry');
    await vi.runOnlyPendingTimersAsync();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(loadRenderer).toHaveBeenCalledTimes(2);
    monitor.dispose();
  });
});

describe('buildRendererRecoveryPage', () => {
  it('escapes diagnostic text and includes an accessible retry action', () => {
    const page = buildRendererRecoveryPage('<script>alert(1)</script>');
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('apihub-recovery://retry');
    expect(page).toContain('role="alert"');
  });
});
