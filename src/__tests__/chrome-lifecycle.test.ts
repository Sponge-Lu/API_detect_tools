// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'puppeteer-core';
import type { BrowserSlot } from '../main/browser-runtime/browser-slot';
vi.mock('electron', () => ({ app: { getPath: () => process.cwd() }, net: {}, session: {} }));
vi.mock('../main/browser-profile-manager', () => ({ browserProfileManager: {} }));
vi.mock('../main/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import { ChromeManager } from '../main/chrome-manager';

type SlotManager = {
  getSlot(index: number): BrowserSlot;
  createPageForSlot(url: string, index: number): Promise<{ release: () => void }>;
  launchBrowserForSlot(index: number, url: string): Promise<void>;
};
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe('browser slot ownership', () => {
  it('preserves other references across failed navigation and duplicate release', async () => {
    vi.useFakeTimers();
    const manager = new ChromeManager() as unknown as SlotManager;
    const close = vi.fn().mockResolvedValue(undefined);
    const newPage = vi.fn().mockResolvedValue({ goto: vi.fn().mockResolvedValue(null), close });
    const slot = manager.getSlot(2);
    slot.browser = { newPage } as unknown as Browser;
    const first = await manager.createPageForSlot('https://example.test', 2);
    const second = await manager.createPageForSlot('https://example.test', 2);
    newPage.mockResolvedValueOnce({
      goto: vi.fn().mockRejectedValue(new Error('navigation')),
      close,
    });
    await expect(manager.createPageForSlot('https://example.test', 2)).rejects.toThrow(
      'navigation'
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(slot.refCount).toBe(2);
    first.release();
    first.release();
    expect(slot.refCount).toBe(1);
    expect(slot.cleanupTimer).toBeNull();
    second.release();
    expect(slot.refCount).toBe(0);
    expect(slot.cleanupTimer).not.toBeNull();
  });
  it('rolls back failed concurrent launches and newPage failures', async () => {
    vi.useFakeTimers();
    const manager = new ChromeManager() as unknown as SlotManager;
    vi.spyOn(manager, 'launchBrowserForSlot').mockRejectedValue(new Error('launch'));
    const results = await Promise.allSettled([
      manager.createPageForSlot('about:blank', 2),
      manager.createPageForSlot('about:blank', 2),
    ]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    const slot = manager.getSlot(2);
    expect(slot.refCount).toBe(0);
    slot.browser = {
      newPage: vi.fn().mockRejectedValue(new Error('newPage')),
    } as unknown as Browser;
    await expect(manager.createPageForSlot('about:blank', 2)).rejects.toThrow('newPage');
    expect(slot.refCount).toBe(0);
  });
});
