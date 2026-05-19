/**
 * 输入: firstByteHistogram (Record<string, number>) - 路由 bucket 的首字响应直方图
 * 输出: 首字响应 P50/P95/P99 分位数 + ms 格式化
 * 定位: 工具层 - 复用 routeLatency 的桶解析与百分位算法计算首字时间分位数
 *
 * 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import {
  MIN_LATENCY_SAMPLE_COUNT,
  buildSortedHistogramBuckets,
  computePercentileFromBuckets,
} from './routeLatency';

export interface FirstBytePercentiles {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  sampleCount: number;
}

export function computeFirstBytePercentiles(
  histogram: Record<string, number>
): FirstBytePercentiles {
  const buckets = buildSortedHistogramBuckets(histogram);
  const sampleCount = buckets.reduce((sum, bucket) => sum + bucket.count, 0);

  if (sampleCount < MIN_LATENCY_SAMPLE_COUNT) {
    return { p50: null, p95: null, p99: null, sampleCount };
  }

  return {
    p50: computePercentileFromBuckets(buckets, 0.5),
    p95: computePercentileFromBuckets(buckets, 0.95),
    p99: computePercentileFromBuckets(buckets, 0.99),
    sampleCount,
  };
}

export function formatTtfb(ms: number | null): string {
  if (ms === null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}
