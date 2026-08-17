import {
  compareRouteHistoryEndpoints,
  normalizeRouteHistoryEndpoint,
  type HistoryBucket,
  type HistoryEndpointTrack,
  type RouteAnalyticsBucket,
  type RouteHistoryBucketsQuery,
} from '../shared/types/route-proxy';
import { getCliTargetEndpoint } from '../shared/types/cli-config';
import { unifiedConfigManager } from './unified-config-manager';

const WINDOW_48H_MS = 48 * 60 * 60 * 1000;
const BUCKET_2H_MS = 2 * 60 * 60 * 1000;
const BUCKET_COUNT = 24;

function getBucketStartTime(timestamp: number): number {
  return Math.floor(timestamp / BUCKET_2H_MS) * BUCKET_2H_MS;
}

function endpointIdentity(bucket: RouteAnalyticsBucket): string | null {
  const observedEndpoint = normalizeRouteHistoryEndpoint(bucket.targetEndpoint);
  if (observedEndpoint) return observedEndpoint;
  if (!bucket.targetProtocol) return null;
  return normalizeRouteHistoryEndpoint(
    getCliTargetEndpoint(bucket.cliType, bucket.targetProtocol, bucket.canonicalModel)
  );
}

function getRouteAnalyticsBuckets(params: {
  siteId?: string;
  accountId?: string;
  windowMs: number;
}): RouteAnalyticsBucket[] {
  const routingConfig = unifiedConfigManager.getRoutingConfig();
  const cutoff = Date.now() - params.windowMs;
  return Object.values(routingConfig.analytics.buckets).filter(bucket => {
    if (bucket.bucketStart < cutoff) return false;
    if (params.siteId && bucket.siteId !== params.siteId) return false;
    if (params.accountId && bucket.accountId !== params.accountId) return false;
    return true;
  });
}

function buildTrack(routeBuckets: RouteAnalyticsBucket[], now: number): HistoryBucket[] {
  const aggregated = new Map<number, { success: number; total: number }>();
  for (const bucket of routeBuckets) {
    const bucketStart = getBucketStartTime(bucket.bucketStart);
    const existing = aggregated.get(bucketStart) || { success: 0, total: 0 };
    existing.total += bucket.successCount + bucket.failureCount;
    existing.success += bucket.successCount;
    aggregated.set(bucketStart, existing);
  }
  const oldestBucketStart = getBucketStartTime(now - WINDOW_48H_MS);
  return Array.from({ length: BUCKET_COUNT }, (_, index) => {
    const bucketStart = oldestBucketStart + index * BUCKET_2H_MS;
    const data = aggregated.get(bucketStart);
    return {
      bucketStart,
      bucketEnd: bucketStart + BUCKET_2H_MS,
      successRate: data?.total ? data.success / data.total : null,
      routeCount: data?.total || 0,
    };
  });
}

export function getHistoryBuckets(query: RouteHistoryBucketsQuery): HistoryEndpointTrack[] {
  const now = Date.now();
  const groups = new Map<string, RouteAnalyticsBucket[]>();
  for (const bucket of getRouteAnalyticsBuckets({
    siteId: query.siteId,
    accountId: query.accountId,
    windowMs: WINDOW_48H_MS,
  })) {
    const identity = endpointIdentity(bucket);
    if (!identity) continue;
    const group = groups.get(identity) || [];
    group.push(bucket);
    groups.set(identity, group);
  }
  return Array.from(groups, ([targetEndpoint, buckets]) => ({
    targetEndpoint,
    buckets: buildTrack(buckets, now),
  })).sort((left, right) =>
    compareRouteHistoryEndpoints(left.targetEndpoint, right.targetEndpoint)
  );
}
