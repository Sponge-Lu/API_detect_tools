import { BrowserWindow } from 'electron';
import logger from './utils/logger';

export type AppDataChangeDomain = 'site-config' | 'site-overview' | 'route-overview';

export interface AppDataChangePayload {
  domains: AppDataChangeDomain[];
  emittedAt: number;
}

const APP_DATA_CHANGED_CHANNEL = 'app-data:changed';

const pendingDomains = new Set<AppDataChangeDomain>();
let flushTimer: NodeJS.Timeout | null = null;
let nextFlushAt = 0;

function isDisposedRendererSendError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Render frame was disposed before WebFrameMain could be accessed');
}

function flushPendingChanges() {
  flushTimer = null;
  nextFlushAt = 0;

  if (pendingDomains.size === 0) {
    return;
  }

  const payload: AppDataChangePayload = {
    domains: [...pendingDomains],
    emittedAt: Date.now(),
  };
  pendingDomains.clear();

  broadcastRendererEvent(APP_DATA_CHANGED_CHANNEL, payload);
}

export function broadcastRendererEvent(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        continue;
      }

      window.webContents.mainFrame.send(channel, payload);
    } catch (error) {
      if (!isDisposedRendererSendError(error)) {
        logger.warn('Failed to broadcast renderer event', channel, error);
      }
    }
  }
}

export function notifyAppDataChanged(
  domains: AppDataChangeDomain | AppDataChangeDomain[],
  debounceMs: number = 0
): void {
  const nextDomains = Array.isArray(domains) ? domains : [domains];
  nextDomains.forEach(domain => pendingDomains.add(domain));

  const now = Date.now();
  const requestedFlushAt = now + Math.max(0, debounceMs);

  if (!flushTimer) {
    nextFlushAt = requestedFlushAt;
    flushTimer = setTimeout(flushPendingChanges, Math.max(0, debounceMs));
    return;
  }

  if (requestedFlushAt < nextFlushAt) {
    clearTimeout(flushTimer);
    nextFlushAt = requestedFlushAt;
    flushTimer = setTimeout(flushPendingChanges, Math.max(0, requestedFlushAt - now));
  }
}

export const APP_DATA_CHANGED_EVENT = APP_DATA_CHANGED_CHANNEL;
