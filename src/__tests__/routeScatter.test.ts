/**
 * routeScatter 单元测试
 */

import { describe, it, expect } from 'vitest';
import type { RouteAnalyticsBucket } from '../shared/types/route-proxy';
import {
  buildRouteScatterPoints,
  buildScatterLabelCandidates,
  estimateLabelWidth,
  selectScatterLabels,
} from '../renderer/utils/routeScatter';

function buildBucket(overrides: Partial<RouteAnalyticsBucket>): RouteAnalyticsBucket {
  return {
    bucketKey: 'k',
    bucketStart: 0,
    bucketSize: 'hour',
    cliType: 'claudeCode',
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
    updatedAt: 0,
    ...overrides,
  };
}

describe('buildRouteScatterPoints', () => {
  it('按 (siteId, accountId, apiKeyId) 聚合并丢弃无 site/account 桶', () => {
    const buckets: RouteAnalyticsBucket[] = [
      buildBucket({
        siteId: 's1',
        accountId: 'a1',
        apiKeyId: 'k1',
        canonicalModel: 'm1',
        requestCount: 10,
        successCount: 9,
        failureCount: 1,
        firstByteHistogram: { '200-500ms': 30 },
      }),
      buildBucket({
        siteId: '',
        accountId: 'a1',
        requestCount: 5,
        successCount: 5,
        firstByteHistogram: { '0-200ms': 5 },
      }),
    ];
    const points = buildRouteScatterPoints(buckets);
    expect(points).toHaveLength(1);
    expect(points[0].requests).toBe(10);
    expect(points[0].successRate).toBeCloseTo(0.9, 3);
    expect(points[0].ttfbMs).not.toBeNull();
  });

  it('样本充足时使用 P95 桶中点；样本不足时使用加权平均', () => {
    const lots = buildRouteScatterPoints([
      buildBucket({
        siteId: 's',
        accountId: 'a',
        apiKeyId: 'k',
        requestCount: 100,
        successCount: 100,
        firstByteHistogram: { '0-200ms': 80, '200-500ms': 20 },
      }),
    ]);
    expect(lots[0].ttfbMs).toBeGreaterThan(0);

    const few = buildRouteScatterPoints([
      buildBucket({
        siteId: 's',
        accountId: 'a',
        apiKeyId: 'k',
        requestCount: 4,
        successCount: 4,
        firstByteHistogram: { '0-200ms': 4 },
      }),
    ]);
    expect(few[0].ttfbMs).toBeGreaterThan(0);
    expect(few[0].ttfbMs).toBeLessThan(200);
  });

  it('成功率分桶：>=95 → good，80-95 → warn，<80 → bad', () => {
    const points = buildRouteScatterPoints([
      buildBucket({
        siteId: 's-good',
        accountId: 'a',
        requestCount: 100,
        successCount: 96,
        failureCount: 4,
        firstByteHistogram: { '0-200ms': 100 },
      }),
      buildBucket({
        siteId: 's-warn',
        accountId: 'a',
        requestCount: 100,
        successCount: 90,
        failureCount: 10,
        firstByteHistogram: { '0-200ms': 100 },
      }),
      buildBucket({
        siteId: 's-bad',
        accountId: 'a',
        requestCount: 100,
        successCount: 60,
        failureCount: 40,
        firstByteHistogram: { '0-200ms': 100 },
      }),
    ]);
    const byId = new Map(points.map(p => [p.siteId, p]));
    expect(byId.get('s-good')?.tier).toBe('good');
    expect(byId.get('s-warn')?.tier).toBe('warn');
    expect(byId.get('s-bad')?.tier).toBe('bad');
  });
});

describe('buildScatterLabelCandidates', () => {
  const points = buildRouteScatterPoints([
    buildBucket({
      siteId: 's1',
      accountId: 'a',
      requestCount: 100,
      successCount: 100,
      firstByteHistogram: { '0-200ms': 100 },
    }),
    buildBucket({
      siteId: 's2',
      accountId: 'a',
      requestCount: 50,
      successCount: 50,
      firstByteHistogram: { '0-200ms': 50 },
    }),
    buildBucket({
      siteId: 's3',
      accountId: 'a',
      requestCount: 10,
      successCount: 10,
      firstByteHistogram: { '0-200ms': 10 },
    }),
    buildBucket({
      siteId: 's4',
      accountId: 'a',
      requestCount: 5,
      successCount: 5,
      firstByteHistogram: { '0-200ms': 5 },
    }),
    buildBucket({
      siteId: 's5',
      accountId: 'a',
      requestCount: 3,
      successCount: 3,
      firstByteHistogram: { '0-200ms': 3 },
    }),
  ]);

  it('默认仅返回请求量前 N 个 key', () => {
    const keys = buildScatterLabelCandidates(points, { topN: 3 });
    expect(keys).toHaveLength(3);
    expect(keys[0]).toContain('s1');
    expect(keys[2]).toContain('s3');
  });

  it('forcedKeys 始终在返回列表中', () => {
    const forced = new Set([points[4].key]); // s5 (最小请求)
    const keys = buildScatterLabelCandidates(points, { topN: 2, forcedKeys: forced });
    expect(keys).toContain(points[4].key);
    expect(keys.slice(1)).toContain(points[0].key);
  });
});

describe('selectScatterLabels (greedy non-overlapping)', () => {
  it('重叠的候选会被丢弃', () => {
    const placed = selectScatterLabels(
      [
        { key: 'a', text: 'A', x: 50, y: 50, estimatedWidth: 80, estimatedHeight: 14 },
        { key: 'b', text: 'B', x: 60, y: 55, estimatedWidth: 80, estimatedHeight: 14 },
        { key: 'c', text: 'C', x: 200, y: 100, estimatedWidth: 80, estimatedHeight: 14 },
      ],
      { width: 400, height: 200 }
    );
    expect(placed.map(p => p.key)).toEqual(['a', 'c']);
  });
});

describe('estimateLabelWidth', () => {
  it('ASCII 字符更窄，中文字符更宽', () => {
    expect(estimateLabelWidth('abc')).toBeLessThan(estimateLabelWidth('一二三'));
  });
});
