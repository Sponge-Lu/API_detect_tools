/**
 * 路由 History 时间桶聚合服务
 * 输入: CLI 探测样本 + 路由统计桶
 * 输出: 2h 时间桶成功率聚合数据
 * 定位: 服务层 - History 列多数据源聚合
 */

import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';
import type {
  RouteCliType,
  RouteCliProbeSample,
  RouteAnalyticsBucket,
  HistoryBucket,
  RouteHistoryBucketsQuery,
} from '../shared/types/route-proxy';

const log = Logger.scope('RouteHistory');

const WINDOW_48H_MS = 48 * 60 * 60 * 1000;
const BUCKET_2H_MS = 2 * 60 * 60 * 1000;
const BUCKET_COUNT = 24;

function getBucketStartTime(timestamp: number): number {
  return Math.floor(timestamp / BUCKET_2H_MS) * BUCKET_2H_MS;
}

function getCliProbeHistory(params: {
  siteId?: string;
  accountId?: string;
  cliType: RouteCliType;
  windowMs: number;
}): RouteCliProbeSample[] {
  const routingConfig = unifiedConfigManager.getRoutingConfig();
  const now = Date.now();
  const cutoff = now - params.windowMs;

  const allSamples: RouteCliProbeSample[] = [];
  for (const samples of Object.values(routingConfig.cliProbe.history)) {
    allSamples.push(...samples);
  }

  return allSamples.filter(sample => {
    if (sample.testedAt < cutoff) return false;
    if (sample.cliType !== params.cliType) return false;
    if (params.siteId && sample.siteId !== params.siteId) return false;
    if (params.accountId && sample.accountId !== params.accountId) return false;
    return true;
  });
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
  probeSamples: RouteCliProbeSample[],
  routeBuckets: RouteAnalyticsBucket[],
  mode: 'combined' | 'probe-only' | 'route-only'
): Map<number, { probeSuccess: number; probeTotal: number; routeSuccess: number; routeTotal: number }> {
  const bucketMap = new Map<number, { probeSuccess: number; probeTotal: number; routeSuccess: number; routeTotal: number }>();

  if (mode === 'combined' || mode === 'probe-only') {
    for (const sample of probeSamples) {
      const bucketStart = getBucketStartTime(sample.testedAt);
      const existing = bucketMap.get(bucketStart) || { probeSuccess: 0, probeTotal: 0, routeSuccess: 0, routeTotal: 0 };
      existing.probeTotal += 1;
      if (sample.success) {
        existing.probeSuccess += 1;
      }
      bucketMap.set(bucketStart, existing);
    }
  }

  if (mode === 'combined' || mode === 'route-only') {
    for (const bucket of routeBuckets) {
      const hourBucketStart = bucket.bucketStart;
      const twohourBucketStart = getBucketStartTime(hourBucketStart);
      const existing = bucketMap.get(twohourBucketStart) || { probeSuccess: 0, probeTotal: 0, routeSuccess: 0, routeTotal: 0 };
      existing.routeTotal += bucket.successCount + bucket.failureCount;
      existing.routeSuccess += bucket.successCount;
      bucketMap.set(twohourBucketStart, existing);
    }
  }

  return bucketMap;
}

export function getHistoryBuckets(query: RouteHistoryBucketsQuery): HistoryBucket[] {
  const now = Date.now();
  const windowMs = WINDOW_48H_MS;

  const probeSamples = getCliProbeHistory({
    siteId: query.siteId,
    accountId: query.accountId,
    cliType: query.cliType,
    windowMs,
  });

  const routeBuckets = getRouteAnalyticsBuckets({
    siteId: query.siteId,
    accountId: query.accountId,
    cliType: query.cliType,
    windowMs,
  });

  const aggregated = aggregateToBuckets(probeSamples, routeBuckets, query.mode);

  const result: HistoryBucket[] = [];
  const oldestBucketStart = getBucketStartTime(now - windowMs);

  for (let i = 0; i < BUCKET_COUNT; i++) {
    const bucketStart = oldestBucketStart + i * BUCKET_2H_MS;
    const bucketEnd = bucketStart + BUCKET_2H_MS;

    const data = aggregated.get(bucketStart);
    let successRate: number | null = null;
    let probeCount = 0;
    let routeCount = 0;

    if (data) {
      probeCount = data.probeTotal;
      routeCount = data.routeTotal;

      const totalCount = data.probeTotal + data.routeTotal;
      if (totalCount > 0) {
        const totalSuccess = data.probeSuccess + data.routeSuccess;
        successRate = totalSuccess / totalCount;
      }
    }

    result.push({
      bucketStart,
      bucketEnd,
      successRate,
      probeCount,
      routeCount,
    });
  }

  return result;
}
