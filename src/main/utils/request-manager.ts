/**
 * 输入: 请求键 (requestKey), 请求函数, 缓存配置
 * 输出: 请求结果 (去重和缓存后)
 * 定位: 工具层 - 请求管理器，实现请求去重和结果缓存
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { Logger } from './logger';

const log = Logger.scope('RequestManager');

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface PendingRequest<T> {
  promise: Promise<T>;
}

class RequestManager {
  private cache = new Map<string, CacheEntry<unknown>>();
  private pending = new Map<string, PendingRequest<unknown>>();

  // 默认缓存时间 30 秒
  private defaultTTL = 30 * 1000;
  private readonly maxCacheEntries = 500;

  /**
   * 执行请求，自动去重和缓存
   */
  async request<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: { ttl?: number; skipCache?: boolean }
  ): Promise<T> {
    const ttl = options?.ttl ?? this.defaultTTL;
    const skipCache = options?.skipCache ?? false;

    // 检查缓存
    if (!skipCache) {
      const cached = this.getFromCache<T>(key);
      if (cached !== undefined) {
        log.debug(`Cache hit: ${key}`);
        return cached;
      }
    }

    // 检查是否有相同请求正在进行
    const pending = this.pending.get(key) as PendingRequest<T> | undefined;
    if (pending) {
      log.debug(`Deduped request: ${key}`);
      return pending.promise;
    }

    // 发起新请求
    log.debug(`New request: ${key}`);
    const promise = Promise.resolve().then(fetcher);
    const entry = { promise };
    this.pending.set(key, entry);

    try {
      const result = await promise;
      // 缓存结果
      if (this.pending.get(key) === entry) this.setCache(key, result, ttl);
      return result;
    } finally {
      if (this.pending.get(key) === entry) this.pending.delete(key);
    }
  }

  /**
   * 从缓存获取
   */
  private getFromCache<T>(key: string): T | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp >= entry.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.data;
  }

  /**
   * 设置缓存
   */
  private setCache<T>(key: string, data: T, ttl: number): void {
    const now = Date.now();
    for (const [cachedKey, entry] of this.cache) {
      if (now - entry.timestamp >= entry.ttl) this.cache.delete(cachedKey);
    }
    if (ttl <= 0) return;
    this.cache.delete(key);
    this.cache.set(key, { data, timestamp: Date.now(), ttl });
    while (this.cache.size > this.maxCacheEntries) {
      this.cache.delete(this.cache.keys().next().value!);
    }
  }

  /**
   * 清除指定缓存
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    this.pending.delete(key);
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.cache.clear();
    this.pending.clear();
  }

  /**
   * 生成缓存 key
   */
  static key(...parts: (string | number)[]): string {
    return parts.join(':');
  }
}

export { RequestManager };
export const requestManager = new RequestManager();
export default requestManager;
