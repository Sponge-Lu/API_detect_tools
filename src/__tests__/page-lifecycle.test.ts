// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { Browser } from 'puppeteer-core';
import { createNavigatedPage, onceRelease } from '../main/browser-runtime/page-lifecycle';

describe('browser page lifecycle', () => {
  it('releases each reference once', () => {
    const release = vi.fn();
    const once = onceRelease(release);
    once();
    once();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('closes a page after failed navigation and preserves the navigation error', async () => {
    const page = {
      goto: vi.fn().mockRejectedValue(new Error('navigation')),
      close: vi.fn().mockRejectedValue(new Error('close')),
    };
    const browser = { newPage: vi.fn().mockResolvedValue(page) } as unknown as Browser;
    await expect(createNavigatedPage(browser, 'https://example.test', 2)).rejects.toThrow(
      'navigation'
    );
    expect(page.close).toHaveBeenCalledTimes(1);
  });
  it('propagates newPage failure', async () => {
    const browser = {
      newPage: vi.fn().mockRejectedValue(new Error('newPage')),
    } as unknown as Browser;
    await expect(createNavigatedPage(browser, 'https://example.test', 0)).rejects.toThrow(
      'newPage'
    );
  });
});
