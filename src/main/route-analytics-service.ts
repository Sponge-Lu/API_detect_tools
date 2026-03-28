/**
 * 路由分析统计服务
 * 输入: 代理请求结果（outcome, latency, tokens）
 * 输出: 小时级聚合桶, 汇总指标, 分布查询
 * 定位: 服务层 - 请求/token/延迟统计分析
 */

import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';
import type {
  RouteCliType,
  RouteOutcome,
  RouteAnalyticsBucket,
  RouteAnalyticsConfig,
} from '../shared/types/route-proxy';
import { buildBucketKey } from '../shared/types/route-proxy';

const log = Logger.scope('RouteAnalytics');

/** 内存缓冲区，延迟写磁盘 */
const pendingBuckets = new Map<string, RouteAnalyticsBucket>();
let flushTimer: NodeJS.Timeout | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushPendingBuckets();
  }, 5000);
}

async function flushPendingBuckets(): Promise<void> {
  if (pendingBuckets.size === 0) return;
  // swap-and-flush：新请求写入新 map，避免竞态
  const toFlush = new Map(pendingBuckets);
  pendingBuckets.clear();
  try {
    await unifiedConfigManager.upsertRouteAnalyticsBuckets(Array.from(toFlush.values()));
  } catch (err) {
    // 失败时将数据合并回 pending（增量不丢失）
    for (const [key, bucket] of toFlush) {
      if (!pendingBuckets.has(key)) {
        pendingBuckets.set(key, bucket);
      }
    }
    log.error('Flush analytics buckets failed:', err);
  }
}

function getBucketStart(at: number, bucketSizeMinutes: number): number {
  const ms = bucketSizeMinutes * 60 * 1000;
  return Math.floor(at / ms) * ms;
}

function classifyLatency(ms: number, buckets: number[]): string {
  for (let i = 0; i < buckets.length; i++) {
    if (ms <= buckets[i]) {
      return i === 0 ? `0-${buckets[i]}ms` : `${buckets[i - 1]}-${buckets[i]}ms`;
    }
  }
  return `>${buckets[buckets.length - 1]}ms`;
}

export function getAnalyticsConfig(): RouteAnalyticsConfig {
  return unifiedConfigManager.getRoutingConfig().analytics.config;
}

export async function saveAnalyticsConfig(
  updates: Partial<RouteAnalyticsConfig>
): Promise<RouteAnalyticsConfig> {
  return unifiedConfigManager.updateRouteAnalyticsConfig(updates);
}

/** 记录一次代理请求 */
export function recordRouteRequest(params: {
  routeRuleId: string;
  cliType: RouteCliType;
  canonicalModel: string | null;
  siteId: string;
  accountId: string;
  outcome: RouteOutcome;
  statusCode?: number;
  latencyMs?: number;
  firstByteLatencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  at?: number;
}): void {
  const config = getAnalyticsConfig();
  if (!config.enabled) return;

  const at = params.at ?? Date.now();
  const bucketStart = getBucketStart(at, config.bucketSizeMinutes);
  const bucketKey = buildBucketKey(
    bucketStart,
    params.cliType,
    params.canonicalModel || undefined,
    params.siteId,
    params.accountId
  );

  let bucket = pendingBuckets.get(bucketKey);
  if (!bucket) {
    // 尝试从持久化读取
    const routing = unifiedConfigManager.getRoutingConfig();
    const existing = routing.analytics.buckets[bucketKey];
    bucket = existing
      ? { ...existing }
      : {
          bucketKey,
          bucketStart,
          bucketSize: 'hour',
          cliType: params.cliType,
          routeRuleId: params.routeRuleId,
          canonicalModel: params.canonicalModel || undefined,
          siteId: params.siteId,
          accountId: params.accountId,
          requestCount: 0,
          successCount: 0,
          failureCount: 0,
          neutralCount: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          statusCodeHistogram: {},
          latencyHistogram: {},
          firstByteHistogram: {},
          updatedAt: at,
        };
  }

  bucket.requestCount++;
  if (params.outcome === 'success') bucket.successCount++;
  else if (params.outcome === 'failure') bucket.failureCount++;
  else bucket.neutralCount++;

  if (config.recordTokenUsage) {
    bucket.promptTokens += params.promptTokens || 0;
    bucket.completionTokens += params.completionTokens || 0;
    bucket.totalTokens += params.totalTokens || 0;
  }

  if (config.recordStatusCode && params.statusCode !== undefined) {
    const sc = String(params.statusCode);
    bucket.statusCodeHistogram[sc] = (bucket.statusCodeHistogram[sc] || 0) + 1;
  }

  if (config.recordLatencyHistogram && params.latencyMs !== undefined) {
    const label = classifyLatency(params.latencyMs, config.latencyHistogramBuckets);
    bucket.latencyHistogram[label] = (bucket.latencyHistogram[label] || 0) + 1;
  }

  if (config.recordLatencyHistogram && params.firstByteLatencyMs !== undefined) {
    const label = classifyLatency(params.firstByteLatencyMs, config.firstByteHistogramBuckets);
    bucket.firstByteHistogram[label] = (bucket.firstByteHistogram[label] || 0) + 1;
  }

  bucket.updatedAt = at;
  pendingBuckets.set(bucketKey, bucket);
  scheduleFlush();
}

/** 查询指定窗口的原始桶 */
export function getAnalyticsBuckets(params: {
  window: '24h' | '7d' | '30d';
  cliType?: RouteCliType;
  routeRuleId?: string;
  canonicalModel?: string;
  siteId?: string;
}): RouteAnalyticsBucket[] {
  const routing = unifiedConfigManager.getRoutingConfig();
  const cutoff = Date.now() - windowToMs(params.window);
  return Object.values(routing.analytics.buckets).filter(b => {
    if (b.bucketStart < cutoff) return false;
    if (params.cliType && b.cliType !== params.cliType) return false;
    if (params.routeRuleId && b.routeRuleId !== params.routeRuleId) return false;
    if (params.canonicalModel && b.canonicalModel !== params.canonicalModel) return false;
    if (params.siteId && b.siteId !== params.siteId) return false;
    return true;
  });
}

/** 查询窗口期汇总 */
export function getAnalyticsSummary(params: {
  window: '24h' | '7d' | '30d';
  cliType?: RouteCliType;
  routeRuleId?: string;
  canonicalModel?: string;
  siteId?: string;
}): {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  neutralCount: number;
  successRate: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const buckets = getAnalyticsBuckets(params);
  const sum = {
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    neutralCount: 0,
    successRate: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  for (const b of buckets) {
    sum.totalRequests += b.requestCount;
    sum.successCount += b.successCount;
    sum.failureCount += b.failureCount;
    sum.neutralCount += b.neutralCount;
    sum.promptTokens += b.promptTokens;
    sum.completionTokens += b.completionTokens;
    sum.totalTokens += b.totalTokens;
  }
  const denominator = sum.successCount + sum.failureCount;
  sum.successRate =
    denominator > 0 ? Math.round((sum.successCount / denominator) * 10000) / 100 : 0;
  return sum;
}

/** 查询窗口期分布 */
export function getAnalyticsDistribution(params: {
  window: '24h' | '7d' | '30d';
  cliType?: RouteCliType;
  routeRuleId?: string;
  canonicalModel?: string;
  siteId?: string;
}): {
  buckets: RouteAnalyticsBucket[];
  statusCodeHistogram: Record<string, number>;
  latencyHistogram: Record<string, number>;
  firstByteHistogram: Record<string, number>;
} {
  const bucketList = getAnalyticsBuckets(params);
  const sc: Record<string, number> = {};
  const lat: Record<string, number> = {};
  const fb: Record<string, number> = {};

  for (const b of bucketList) {
    for (const [k, v] of Object.entries(b.statusCodeHistogram)) sc[k] = (sc[k] || 0) + v;
    for (const [k, v] of Object.entries(b.latencyHistogram)) lat[k] = (lat[k] || 0) + v;
    for (const [k, v] of Object.entries(b.firstByteHistogram)) fb[k] = (fb[k] || 0) + v;
  }

  return {
    buckets: bucketList,
    statusCodeHistogram: sc,
    latencyHistogram: lat,
    firstByteHistogram: fb,
  };
}

export async function resetAnalytics(params?: {
  cliType?: RouteCliType;
  routeRuleId?: string;
}): Promise<void> {
  pendingBuckets.clear();
  await unifiedConfigManager.resetRouteAnalytics(params);
}

export async function pruneAnalyticsBuckets(now?: number): Promise<number> {
  return unifiedConfigManager.pruneRouteAnalyticsBuckets(undefined, now);
}

function windowToMs(window: '24h' | '7d' | '30d'): number {
  switch (window) {
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
  }
}
