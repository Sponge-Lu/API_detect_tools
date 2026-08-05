/**
 * 路由 History 时间桶聚合服务
 * 输入: 路由统计桶
 * 输出: 2h 时间桶成功率聚合数据
 * 定位: 服务层 - History 列路由请求聚合
 */

import { unifiedConfigManager } from './unified-config-manager';
import type {
  RouteCliType,
  RouteAnalyticsBucket,
  HistoryBucket,
  RouteHistoryBucketsQuery,
} from '../shared/types/route-proxy';

const WINDOW_48H_MS = 48 * 60 * 60 * 1000;
const BUCKET_2H_MS = 2 * 60 * 60 * 1000;
const BUCKET_COUNT = 24;

function getBucketStartTime(timestamp: number): number {
  return Math.floor(timestamp / BUCKET_2H_MS) * BUCKET_2H_MS;
}

function getRouteAnalyticsBuckets(params: {
  siteId?: string;
  accountId?: string;
  cliType: RouteCliType;
  windowMs: number;
}): RouteAnalyticsBucket[] {
  const routingConfig = unifiedConfigManager.getRoutingConfig();
  const now = Date.now();
  const cutoff = now - params.windowMs;

  const allBuckets = Object.values(routingConfig.analytics.buckets);

  return allBuckets.filter(bucket => {
    if (bucket.bucketStart < cutoff) return false;
    if (bucket.cliType !== params.cliType) return false;
    if (params.siteId && bucket.siteId !== params.siteId) return false;
    if (params.accountId && bucket.accountId !== params.accountId) return false;
    return true;
  });
}

function aggregateToBuckets(
  routeBuckets: RouteAnalyticsBucket[]
): Map<number, { success: number; total: number }> {
  const bucketMap = new Map<number, { success: number; total: number }>();

  for (const bucket of routeBuckets) {
    const bucketStart = getBucketStartTime(bucket.bucketStart);
    const existing = bucketMap.get(bucketStart) || { success: 0, total: 0 };
    existing.total += bucket.successCount + bucket.failureCount;
    existing.success += bucket.successCount;
    bucketMap.set(bucketStart, existing);
  }

  return bucketMap;
}

export function getHistoryBuckets(query: RouteHistoryBucketsQuery): HistoryBucket[] {
  const now = Date.now();
  const windowMs = WINDOW_48H_MS;

  const routeBuckets = getRouteAnalyticsBuckets({
    siteId: query.siteId,
    accountId: query.accountId,
    cliType: query.cliType,
    windowMs,
  });

  const aggregated = aggregateToBuckets(routeBuckets);

  const result: HistoryBucket[] = [];
  const oldestBucketStart = getBucketStartTime(now - windowMs);

  for (let i = 0; i < BUCKET_COUNT; i++) {
    const bucketStart = oldestBucketStart + i * BUCKET_2H_MS;
    const bucketEnd = bucketStart + BUCKET_2H_MS;

    const data = aggregated.get(bucketStart);
    let successRate: number | null = null;
    let routeCount = 0;

    if (data) {
      routeCount = data.total;
      if (data.total > 0) {
        successRate = data.success / data.total;
      }
    }

    result.push({
      bucketStart,
      bucketEnd,
      successRate,
      routeCount,
    });
  }

  return result;
}
