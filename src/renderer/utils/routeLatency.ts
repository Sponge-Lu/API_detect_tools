/**
 * 路由延迟分位数计算工具
 * 输入: latencyHistogram (Record<string, number>)
 * 输出: { p90, p99, sampleCount }
 * 定位: 工具层 - 从 histogram 桶估算延迟分位数
 */

interface LatencyPercentiles {
  p90: number | null;
  p99: number | null;
  sampleCount: number;
}

interface HistogramBucket {
  lowerBound: number;
  upperBound: number;
  midpoint: number;
  count: number;
}

function parseLatencyBucket(label: string): { lowerBound: number; upperBound: number } | null {
  const rangeMatch = label.match(/^(\d+)-(\d+)ms$/);
  if (rangeMatch) {
    return {
      lowerBound: Number(rangeMatch[1]),
      upperBound: Number(rangeMatch[2]),
    };
  }

  const openEndMatch = label.match(/^>(\d+)ms$/);
  if (openEndMatch) {
    const lowerBound = Number(openEndMatch[1]);
    return {
      lowerBound,
      upperBound: lowerBound * 1.5,
    };
  }

  return null;
}

function buildSortedBuckets(histogram: Record<string, number>): HistogramBucket[] {
  const buckets: HistogramBucket[] = [];

  for (const [label, count] of Object.entries(histogram)) {
    if (count <= 0) continue;

    const parsed = parseLatencyBucket(label);
    if (!parsed) continue;

    buckets.push({
      lowerBound: parsed.lowerBound,
      upperBound: parsed.upperBound,
      midpoint: (parsed.lowerBound + parsed.upperBound) / 2,
      count,
    });
  }

  return buckets.sort((a, b) => a.lowerBound - b.lowerBound);
}

function computePercentile(buckets: HistogramBucket[], percentile: number): number | null {
  if (buckets.length === 0) return null;

  const totalCount = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (totalCount === 0) return null;

  const targetRank = Math.ceil(totalCount * percentile);
  let cumulativeCount = 0;

  for (const bucket of buckets) {
    cumulativeCount += bucket.count;
    if (cumulativeCount >= targetRank) {
      return bucket.midpoint;
    }
  }

  return buckets[buckets.length - 1].midpoint;
}

export function computeLatencyPercentiles(histogram: Record<string, number>): LatencyPercentiles {
  const buckets = buildSortedBuckets(histogram);
  const sampleCount = buckets.reduce((sum, bucket) => sum + bucket.count, 0);

  if (sampleCount < 20) {
    return { p90: null, p99: null, sampleCount };
  }

  return {
    p90: computePercentile(buckets, 0.9),
    p99: computePercentile(buckets, 0.99),
    sampleCount,
  };
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}
