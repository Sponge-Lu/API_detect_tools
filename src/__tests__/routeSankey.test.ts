/**
 * routeSankey 单元测试
 */

import { describe, it, expect } from 'vitest';
import type { RouteAnalyticsBucket } from '../shared/types/route-proxy';
import {
  buildRouteSankeyGraph,
  SANKEY_OTHER_CHANNEL_KEY,
  SANKEY_OTHER_MODEL_KEY,
} from '../renderer/utils/routeSankey';

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

describe('buildRouteSankeyGraph', () => {
  it('未识别模型归到 "未识别模型" 标签且参与排名', () => {
    const graph = buildRouteSankeyGraph([
      buildBucket({ siteId: 's', accountId: 'a', requestCount: 5, successCount: 5 }),
    ]);
    expect(graph.models[0].label).toBe('未识别模型');
    expect(graph.channels[0].siteId).toBe('s');
    expect(graph.links).toHaveLength(1);
  });

  it('topModels/topChannels 截断时把剩余聚合到「其他」', () => {
    const buckets: RouteAnalyticsBucket[] = [];
    for (let i = 0; i < 5; i += 1) {
      buckets.push(
        buildBucket({
          siteId: `s${i}`,
          accountId: 'a',
          canonicalModel: `m${i}`,
          requestCount: 10 - i,
          successCount: 10 - i,
        })
      );
    }
    const graph = buildRouteSankeyGraph(buckets, { topModels: 2, topChannels: 2 });
    expect(graph.models.find(m => m.isOther)).toBeTruthy();
    expect(graph.channels.find(c => c.isOther)).toBeTruthy();
    expect(graph.models.find(m => m.key === SANKEY_OTHER_MODEL_KEY)?.requests).toBeGreaterThan(0);
    expect(graph.channels.find(c => c.key === SANKEY_OTHER_CHANNEL_KEY)?.requests).toBeGreaterThan(
      0
    );
  });

  it('Link 成功率按聚合后的 success/(success+failure) 计算', () => {
    const graph = buildRouteSankeyGraph([
      buildBucket({
        siteId: 's',
        accountId: 'a',
        apiKeyId: 'k',
        canonicalModel: 'm',
        requestCount: 10,
        successCount: 8,
        failureCount: 2,
      }),
      buildBucket({
        siteId: 's',
        accountId: 'a',
        apiKeyId: 'k',
        canonicalModel: 'm',
        requestCount: 10,
        successCount: 6,
        failureCount: 4,
      }),
    ]);
    const link = graph.links[0];
    expect(link.requests).toBe(20);
    expect(link.successCount).toBe(14);
    expect(link.failureCount).toBe(6);
    expect(link.successRate).toBeCloseTo(14 / 20, 3);
  });

  it('同站点同账户的不同 API key 保持为独立通道', () => {
    const graph = buildRouteSankeyGraph([
      buildBucket({
        siteId: 's',
        accountId: 'a',
        apiKeyId: 'k1',
        canonicalModel: 'm',
        requestCount: 7,
        successCount: 7,
      }),
      buildBucket({
        siteId: 's',
        accountId: 'a',
        apiKeyId: 'k2',
        canonicalModel: 'm',
        requestCount: 5,
        successCount: 4,
        failureCount: 1,
      }),
    ]);

    expect(graph.channels.map(channel => channel.key).sort()).toEqual(['s::a::k1', 's::a::k2']);
    expect(graph.channels.map(channel => channel.apiKeyId).sort()).toEqual(['k1', 'k2']);
    expect(graph.links).toHaveLength(2);
  });

  it('lookup 用于生成通道 label', () => {
    const graph = buildRouteSankeyGraph(
      [
        buildBucket({
          siteId: 's1',
          accountId: 'a1',
          apiKeyId: 'k1',
          canonicalModel: 'm',
          requestCount: 5,
          successCount: 5,
        }),
      ],
      {
        lookup: {
          resolveSiteName: id => (id === 's1' ? '站点 A' : id),
          resolveAccountName: id => (id === 'a1' ? '账户 X' : id),
          resolveApiKeyName: id => (id === 'k1' ? '主 Key' : id),
        },
      }
    );
    expect(graph.channels[0].label).toBe('站点 A / 账户 X / 主 Key');
  });
});
