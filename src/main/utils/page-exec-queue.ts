/**
 * A tiny per-page async queue to prevent concurrent `page.evaluate` calls on the same Puppeteer Page.
 *
 * Some pages/sites (and some Puppeteer versions) can become unstable when multiple `evaluate` calls
 * run concurrently (e.g., "Execution context was destroyed", "Target closed").
 *
 * We key by the Page object and serialize tasks in FIFO order.
 */

const chains = new WeakMap<object, Promise<void>>();

export async function runOnPageQueue(page: object, fn: () => Promise<any>): Promise<any> {
  const prev = chains.get(page) ?? Promise.resolve();

  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });

  // Ensure the chain continues even if a previous task rejects.
  chains.set(
    page,
    prev.then(
      () => current,
      () => current
    )
  );

  // Wait for all previous tasks to finish.
  await prev.catch(() => undefined);

  try {
    return await fn();
  } finally {
    release();
  }
}
