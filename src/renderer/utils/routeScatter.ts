/**
 * 输入: RouteAnalyticsBucket[]，可选 channelNameLookup (siteId/accountId/apiKeyId → 名称)
 * 输出: 路由通道散点点位数组（首字响应 P95 / 成功率 / 请求量 / 健康分桶）+ Top-N 引线候选
 * 定位: 工具层 - 路由数据子页通道健康散点矩阵数据准备
 *
 * 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import type { RouteAnalyticsBucket } from '../../shared/types/route-proxy';
import {
  buildSortedHistogramBuckets,
  computePercentileFromBuckets,
  MIN_LATENCY_SAMPLE_COUNT,
} from './routeLatency';

export type ScatterTier = 'good' | 'warn' | 'bad';

export interface ScatterPoint {
  key: string;
  siteId: string;
  accountId: string;
  apiKeyId: string;
  siteName: string;
  accountName: string;
  apiKeyName: string;
  canonicalModels: string[];
  requests: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  ttfbMs: number | null;
  tier: ScatterTier;
}

export interface ChannelNameLookup {
  resolveSiteName: (siteId: string) => string;
  resolveAccountName: (accountId: string) => string;
  resolveApiKeyName: (apiKeyId: string) => string;
}

function classifyTier(successRate: number, hasFailure: boolean): ScatterTier {
  if (successRate < 0.8 || (hasFailure && successRate < 0.95)) {
    return successRate < 0.8 ? 'bad' : 'warn';
  }
  if (successRate < 0.95) return 'warn';
  return 'good';
}

function aggregateTtfb(histogram: Record<string, number>): number | null {
  const buckets = buildSortedHistogramBuckets(histogram);
  const totalCount = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (totalCount === 0) return null;
  if (totalCount < MIN_LATENCY_SAMPLE_COUNT) {
    // 样本不足时使用加权平均近似
    const weighted = buckets.reduce((acc, bucket) => acc + bucket.midpoint * bucket.count, 0);
    return weighted / totalCount;
  }
  return computePercentileFromBuckets(buckets, 0.95);
}

export function buildRouteScatterPoints(
  buckets: RouteAnalyticsBucket[],
  lookup?: ChannelNameLookup
): ScatterPoint[] {
  const grouped = new Map<
    string,
    {
      siteId: string;
      accountId: string;
      apiKeyId: string;
      models: Set<string>;
      requests: number;
      successCount: number;
      failureCount: number;
      ttfbHistogram: Record<string, number>;
    }
  >();

  for (const bucket of buckets) {
    const siteId = bucket.siteId || '';
    const accountId = bucket.accountId || '';
    const apiKeyId = bucket.apiKeyId || '';
    if (!siteId || !accountId) continue;
    const key = `${siteId}::${accountId}::${apiKeyId}`;
    const current = grouped.get(key) || {
      siteId,
      accountId,
      apiKeyId,
      models: new Set<string>(),
      requests: 0,
      successCount: 0,
      failureCount: 0,
      ttfbHistogram: {} as Record<string, number>,
    };
    if (bucket.canonicalModel) {
      current.models.add(bucket.canonicalModel);
    }
    current.requests += bucket.requestCount;
    current.successCount += bucket.successCount;
    current.failureCount += bucket.failureCount;
    for (const [label, count] of Object.entries(bucket.firstByteHistogram || {})) {
      current.ttfbHistogram[label] = (current.ttfbHistogram[label] || 0) + count;
    }
    grouped.set(key, current);
  }

  const resolveSite = lookup?.resolveSiteName ?? ((id: string) => id);
  const resolveAccount = lookup?.resolveAccountName ?? ((id: string) => id);
  const resolveKey = lookup?.resolveApiKeyName ?? ((id: string) => id || 'API Key');

  return Array.from(grouped.entries())
    .map(([key, entry]) => {
      const denominator = entry.successCount + entry.failureCount;
      const successRate = denominator > 0 ? entry.successCount / denominator : 1;
      const tier = classifyTier(successRate, entry.failureCount > 0);
      return {
        key,
        siteId: entry.siteId,
        accountId: entry.accountId,
        apiKeyId: entry.apiKeyId,
        siteName: resolveSite(entry.siteId),
        accountName: resolveAccount(entry.accountId),
        apiKeyName: resolveKey(entry.apiKeyId),
        canonicalModels: Array.from(entry.models),
        requests: entry.requests,
        successCount: entry.successCount,
        failureCount: entry.failureCount,
        successRate,
        ttfbMs: aggregateTtfb(entry.ttfbHistogram),
        tier,
      } satisfies ScatterPoint;
    })
    .filter(point => point.requests > 0 && point.ttfbMs !== null);
}

export interface LabelCandidate {
  key: string;
  text: string;
  x: number;
  y: number;
  estimatedWidth: number;
  estimatedHeight: number;
}

function estimateLabelWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += (char.codePointAt(0) || 0) <= 0xff ? 6 : 11;
  }
  return width + 8;
}

export function selectScatterLabels(
  candidates: LabelCandidate[],
  bounds: { width: number; height: number }
): LabelCandidate[] {
  const placed: LabelCandidate[] = [];
  for (const candidate of candidates) {
    const left = Math.max(0, candidate.x - candidate.estimatedWidth / 2);
    const right = Math.min(bounds.width, left + candidate.estimatedWidth);
    const top = Math.max(0, candidate.y - candidate.estimatedHeight - 4);
    const bottom = top + candidate.estimatedHeight;
    const overlapping = placed.some(other => {
      const otherLeft = Math.max(0, other.x - other.estimatedWidth / 2);
      const otherRight = Math.min(bounds.width, otherLeft + other.estimatedWidth);
      const otherTop = Math.max(0, other.y - other.estimatedHeight - 4);
      const otherBottom = otherTop + other.estimatedHeight;
      return left < otherRight && right > otherLeft && top < otherBottom && bottom > otherTop;
    });
    if (!overlapping) placed.push(candidate);
  }
  return placed;
}

export function buildScatterLabelCandidates(
  points: ScatterPoint[],
  options: {
    topN?: number;
    forcedKeys?: Set<string>;
  } = {}
): string[] {
  const topN = options.topN ?? 4;
  const forced = options.forcedKeys ?? new Set<string>();
  const sortedByRequests = [...points].sort((a, b) => b.requests - a.requests);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const key of forced) {
    if (sortedByRequests.some(point => point.key === key) && !seen.has(key)) {
      result.push(key);
      seen.add(key);
    }
  }
  for (const point of sortedByRequests) {
    if (result.length >= topN + forced.size) break;
    if (!seen.has(point.key)) {
      result.push(point.key);
      seen.add(point.key);
    }
  }
  return result;
}

export { estimateLabelWidth };
