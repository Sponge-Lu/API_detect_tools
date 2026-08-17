import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteAnalyticsBucket } from '../shared/types/route-proxy';

const mocks = vi.hoisted(() => ({ buckets: {} as Record<string, RouteAnalyticsBucket> }));

vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: {
    getRoutingConfig: () => ({ analytics: { buckets: mocks.buckets } }),
  },
}));

import { getHistoryBuckets } from '../main/route-history-service';

function bucket(params: {
  key: string;
  endpoint?: string;
  protocol?: RouteAnalyticsBucket['targetProtocol'];
  success: number;
  failure: number;
}): RouteAnalyticsBucket {
  return {
    bucketKey: params.key,
    bucketStart: Date.now() - 60_000,
    bucketSize: 'hour',
    cliType: 'codex',
    targetProtocol: params.protocol,
    targetEndpoint: params.endpoint,
    siteId: 'site-1',
    accountId: 'account-1',
    requestCount: params.success + params.failure,
    successCount: params.success,
    failureCount: params.failure,
    neutralCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    statusCodeHistogram: {},
    latencyHistogram: {},
    firstByteHistogram: {},
    updatedAt: Date.now(),
  };
}

describe('route history endpoint tracks', () => {
  beforeEach(() => {
    mocks.buckets = {};
  });

  it('groups solely by normalized request endpoint without filtering by CLI or protocol', () => {
    mocks.buckets = {
      a: bucket({
        key: 'a',
        endpoint: '/v1/responses',
        protocol: 'openai-responses',
        success: 1,
        failure: 0,
      }),
      b: {
        ...bucket({
          key: 'b',
          endpoint: '/v1/responses',
          protocol: 'anthropic-messages',
          success: 0,
          failure: 1,
        }),
        cliType: 'grokBuild',
      },
    };
    const tracks = getHistoryBuckets({
      window: '48h',
      bucketSize: '2h',
      siteId: 'site-1',
      accountId: 'account-1',
    });
    expect(tracks.map(track => track.targetEndpoint)).toEqual(['/v1/responses']);
    expect(tracks.every(track => track.buckets.length === 24)).toBe(true);
  });

  it('normalizes endpoint variants and keeps the requested label order', () => {
    mocks.buckets = {
      chat: bucket({
        key: 'chat',
        endpoint: 'v1/chat/completion/?stream=true',
        protocol: 'openai-chat-completions',
        success: 1,
        failure: 0,
      }),
      responses: bucket({
        key: 'responses',
        endpoint: '/v1/responses/',
        protocol: 'openai-responses',
        success: 1,
        failure: 0,
      }),
      messages: bucket({
        key: 'messages',
        endpoint: 'https://example.com/v1/messages?beta=true',
        protocol: 'anthropic-messages',
        success: 1,
        failure: 0,
      }),
    };

    expect(
      getHistoryBuckets({ window: '48h', bucketSize: '2h' }).map(track => track.targetEndpoint)
    ).toEqual(['/v1/messages', '/v1/responses', '/v1/chat/completions']);
  });

  it('maps legacy records without an endpoint from their stored target protocol', () => {
    mocks.buckets = {
      legacy: bucket({
        key: 'legacy',
        protocol: 'native',
        success: 1,
        failure: 0,
      }),
    };
    expect(
      getHistoryBuckets({ window: '48h', bucketSize: '2h' }).map(track => track.targetEndpoint)
    ).toEqual(['/v1/responses']);
  });

  it('ignores legacy records when neither endpoint nor protocol can identify a track', () => {
    mocks.buckets = { legacy: bucket({ key: 'legacy', success: 1, failure: 0 }) };
    expect(getHistoryBuckets({ window: '48h', bucketSize: '2h' })).toEqual([]);
  });
});
