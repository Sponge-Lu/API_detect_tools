import type { Browser, Page } from 'puppeteer-core';

export function onceRelease(release: () => void): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
  };
}

export async function createNavigatedPage(
  browser: Browser,
  url: string,
  slotIndex: number
): Promise<Page> {
  const page = await browser.newPage();
  (page as Page & { __slotIndex: number }).__slotIndex = slotIndex;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}
