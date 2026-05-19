/**
 * routeScopeFilter 单元测试
 */

import { describe, it, expect } from 'vitest';
import type { RouteAnalyticsBucket } from '../shared/types/route-proxy';
import { buildCustomCliRouteSiteId } from '../shared/utils/customCliRouteId';
import {
  ROUTE_SCOPE_ALL,
  filterBucketsByScope,
  isSameRouteScope,
  resolveScopeSiteId,
} from '../renderer/utils/routeScopeFilter';

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

const customCliId = 'cfg-1';
const customSiteId = buildCustomCliRouteSiteId(customCliId);

const buckets: RouteAnalyticsBucket[] = [
  buildBucket({ bucketKey: 'a', siteId: 'site-1', requestCount: 10 }),
  buildBucket({ bucketKey: 'b', siteId: 'site-2', requestCount: 5 }),
  buildBucket({ bucketKey: 'c', siteId: customSiteId, requestCount: 3 }),
];

describe('filterBucketsByScope', () => {
  it('all scope 不过滤', () => {
    expect(filterBucketsByScope(buckets, ROUTE_SCOPE_ALL)).toHaveLength(3);
  });

  it('site scope 仅保留对应 siteId 的 bucket', () => {
    const result = filterBucketsByScope(buckets, { kind: 'site', siteId: 'site-1' });
    expect(result.map(b => b.bucketKey)).toEqual(['a']);
  });

  it('customCli scope 通过合成 siteId 字符串相等过滤', () => {
    const result = filterBucketsByScope(buckets, { kind: 'customCli', customCliId });
    expect(result.map(b => b.bucketKey)).toEqual(['c']);
  });

  it('未匹配的 site scope 返回空数组', () => {
    const result = filterBucketsByScope(buckets, { kind: 'site', siteId: 'no-such' });
    expect(result).toEqual([]);
  });
});

describe('resolveScopeSiteId', () => {
  it('all → null', () => {
    expect(resolveScopeSiteId(ROUTE_SCOPE_ALL)).toBeNull();
  });

  it('site scope → 原 siteId', () => {
    expect(resolveScopeSiteId({ kind: 'site', siteId: 'site-1' })).toBe('site-1');
  });

  it('customCli scope → 合成 siteId', () => {
    expect(resolveScopeSiteId({ kind: 'customCli', customCliId })).toBe(customSiteId);
  });
});

describe('isSameRouteScope', () => {
  it('all vs all → true', () => {
    expect(isSameRouteScope(ROUTE_SCOPE_ALL, ROUTE_SCOPE_ALL)).toBe(true);
  });

  it('site scope 同 id → true', () => {
    expect(isSameRouteScope({ kind: 'site', siteId: 'x' }, { kind: 'site', siteId: 'x' })).toBe(
      true
    );
  });

  it('site vs customCli → false', () => {
    expect(
      isSameRouteScope({ kind: 'site', siteId: 'x' }, { kind: 'customCli', customCliId: 'x' })
    ).toBe(false);
  });
});
