import { BrowserWindow } from 'electron';

export type AppDataChangeDomain = 'site-config' | 'site-overview' | 'route-overview';

export interface AppDataChangePayload {
  domains: AppDataChangeDomain[];
  emittedAt: number;
}

const APP_DATA_CHANGED_CHANNEL = 'app-data:changed';

const pendingDomains = new Set<AppDataChangeDomain>();
let flushTimer: NodeJS.Timeout | null = null;
let nextFlushAt = 0;

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

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(APP_DATA_CHANGED_CHANNEL, payload);
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
