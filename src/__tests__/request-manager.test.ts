// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../main/utils/logger', () => ({ Logger: { scope: () => ({ debug: vi.fn() }) } }));
import { RequestManager } from '../main/utils/request-manager';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => vi.useRealTimers());
describe('request lifecycle', () => {
  it('deduplicates slow requests until settlement, including skipCache', async () => {
    vi.useFakeTimers();
    const manager = new RequestManager();
    const job = deferred<number>();
    const fetch = vi.fn(() => job.promise);
    const first = manager.request('key', fetch);
    await vi.advanceTimersByTimeAsync(3000);
    const second = manager.request('key', fetch, { skipCache: true });
    job.resolve(1);
    expect(await Promise.all([first, second])).toEqual([1, 1]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['invalidate', 'clear'] as const)('protects new requests after %s', async action => {
    const manager = new RequestManager();
    const old = deferred<number>();
    const current = deferred<number>();
    const first = manager.request('key', () => old.promise);
    manager[action]('key');
    const second = manager.request('key', () => current.promise);
    old.resolve(1);
    await first;
    const third = manager.request('key', () => Promise.resolve(99));
    current.resolve(2);
    expect(await Promise.all([second, third])).toEqual([2, 2]);
    expect(await manager.request('key', () => Promise.resolve(99))).toBe(2);
  });
  it('retries failures and expires at the TTL boundary', async () => {
    vi.useFakeTimers();
    const manager = new RequestManager();
    await expect(manager.request('key', () => Promise.reject(new Error('fail')))).rejects.toThrow(
      'fail'
    );
    await manager.request('key', () => Promise.resolve(1), { ttl: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(await manager.request('key', () => Promise.resolve(2))).toBe(2);
  });
  it('bounds the cache to 500 entries', async () => {
    const manager = new RequestManager();
    for (let index = 0; index <= 500; index++)
      await manager.request(String(index), () => Promise.resolve(index));
    expect(await manager.request('0', () => Promise.resolve(-1))).toBe(-1);
  });
});
