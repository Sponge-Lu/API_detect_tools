import { Browser } from 'puppeteer-core';

/** 单个浏览器槽位的状态 */
export interface BrowserSlot {
  browser: Browser | null;
  chromeProcess: any;
  debugPort: number;
  refCount: number;
  lock: Promise<void> | null;
  cleanupTimer: NodeJS.Timeout | null;
  isClosed: boolean;
  abortController: AbortController | null;
}

/** 创建空槽位 */
export function createEmptySlot(): BrowserSlot {
  return {
    browser: null,
    chromeProcess: null,
    debugPort: 0,
    refCount: 0,
    lock: null,
    cleanupTimer: null,
    isClosed: false,
    abortController: null,
  };
}
