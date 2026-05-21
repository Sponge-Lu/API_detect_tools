import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteAnalyticsBucket } from '../shared/types/route-proxy';

const mocks = vi.hoisted(() => ({
  routingConfig: {
    rules: [
      {
        id: 'rule-1',
        name: 'Gemini 规则',
      },
    ],
    analytics: {
      config: {
        enabled: true,
        retentionDays: 30,
        bucketSizeMinutes: 60,
        recordTokenUsage: true,
        recordStatusCode: true,
        recordLatencyHistogram: true,
        latencyHistogramBuckets: [1000, 3000, 5000],
        firstByteHistogramBuckets: [200, 1000, 3000],
      },
      buckets: {},
    },
    modelRegistry: {
      sources: [],
    },
  },
  exportedConfig: {
    sites: [
      {
        id: 'site-1',
        name: 'Elysiver',
        api_key: 'site-default-key',
      },
    ],
    accounts: [
      {
        id: 'account-1',
        account_name: '默认账户',
        cached_data: {
          api_keys: [
            {
              id: 'key-1',
              name: '主 Key',
              group: 'default',
            },
          ],
        },
      },
    ],
  },
  notifyAppDataChanged: vi.fn(),
  broadcastRendererEvent: vi.fn(),
}));

vi.mock('../main/utils/logger', () => ({
  default: {
    scope: () => ({
      error: vi.fn(),
    }),
  },
}));

vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: {
    exportConfigSync: () => mocks.exportedConfig,
    getRoutingConfig: () => mocks.routingConfig,
    upsertRouteAnalyticsBuckets: vi.fn(),
    resetRouteAnalytics: vi.fn(),
    pruneRouteAnalyticsBuckets: vi.fn(),
  },
}));

vi.mock('../main/app-data-events', () => ({
  broadcastRendererEvent: mocks.broadcastRendererEvent,
  notifyAppDataChanged: mocks.notifyAppDataChanged,
}));

vi.mock('../main/route-model-registry-service', () => ({
  resolveApiKeyId: (apiKey: { id?: string | number; token_id?: string | number }) =>
    String(apiKey.id ?? apiKey.token_id ?? 'unknown'),
}));

import {
  clearRouteRequestLogs,
  getAnalyticsSummary,
  getRouteObjectStats,
  getRouteRequestLogs,
  recordRouteRequest,
} from '../main/route-analytics-service';
import { buildBucketKey } from '../shared/types/route-proxy';

function resetRoutingBuckets(buckets: Record<string, RouteAnalyticsBucket> = {}) {
  mocks.routingConfig.analytics.buckets = buckets;
  mocks.routingConfig.analytics.config.enabled = true;
  mocks.routingConfig.analytics.config.recordTokenUsage = true;
  mocks.routingConfig.modelRegistry.sources = [];
}

describe('route-analytics-service token statistics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRouteRequestLogs();
    resetRoutingBuckets();
    mocks.routingConfig.modelRegistry.sources = [];
  });

  it('stores token usage on route request logs', () => {
    mocks.routingConfig.analytics.config.enabled = false;

    recordRouteRequest({
      requestId: 'req-1',
      attempt: 1,
      cliType: 'geminiCli',
      requestedModel: 'gemini-3.1-pro',
      canonicalModel: 'gemini-3.1-pro',
      routeRuleId: 'rule-1',
      siteId: 'site-1',
      accountId: 'account-1',
      apiKeyId: 'key-1',
      resolvedModel: 'duckcoding',
      outcome: 'success',
      statusCode: 200,
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      cacheCreationTokens: 20,
      cacheReadTokens: 80,
      cachedTokens: 80,
      at: 1_776_000_000_000,
    });

    expect(getRouteRequestLogs()).toMatchObject([
      {
        requestId: 'req-1',
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        cacheCreationTokens: 20,
        cacheReadTokens: 80,
        cachedTokens: 80,
        apiKeyName: '主 Key',
      },
    ]);
    expect(mocks.broadcastRendererEvent).toHaveBeenCalledWith(
      'route:request-log-appended',
      expect.objectContaining({
        requestId: 'req-1',
        apiKeyName: '主 Key',
      })
    );
  });

  it('rejects unsupported 30d route analytics windows at runtime', () => {
    expect(() => getAnalyticsSummary({ window: '30d' as never })).toThrow(
      'Unsupported route analytics window: 30d'
    );
  });

  it('aggregates token usage by site account and api key', () => {
    const bucketStart = Date.now() - 60_000;
    const firstKey = buildBucketKey(
      bucketStart,
      'geminiCli',
      'gemini-3.1-pro',
      'site-1',
      'account-1',
      'key-1'
    );
    const secondKey = buildBucketKey(
      bucketStart,
      'codex',
      'gpt-5.5',
      'site-1',
      'account-1',
      'key-1'
    );

    resetRoutingBuckets({
      [firstKey]: {
        bucketKey: firstKey,
        bucketStart,
        bucketSize: 'hour',
        cliType: 'geminiCli',
        routeRuleId: 'rule-1',
        canonicalModel: 'gemini-3.1-pro',
        siteId: 'site-1',
        accountId: 'account-1',
        apiKeyId: 'key-1',
        requestCount: 2,
        successCount: 2,
        failureCount: 0,
        neutralCount: 0,
        promptTokens: 200,
        completionTokens: 80,
        totalTokens: 280,
        cacheCreationTokens: 30,
        cacheReadTokens: 90,
        cachedTokens: 90,
        statusCodeHistogram: { '200': 2 },
        latencyHistogram: {},
        firstByteHistogram: {},
        updatedAt: bucketStart,
      },
      [secondKey]: {
        bucketKey: secondKey,
        bucketStart,
        bucketSize: 'hour',
        cliType: 'codex',
        routeRuleId: 'rule-1',
        canonicalModel: 'gpt-5.5',
        siteId: 'site-1',
        accountId: 'account-1',
        apiKeyId: 'key-1',
        requestCount: 1,
        successCount: 0,
        failureCount: 1,
        neutralCount: 0,
        promptTokens: 50,
        completionTokens: 20,
        totalTokens: 70,
        cacheCreationTokens: 0,
        cacheReadTokens: 10,
        cachedTokens: 10,
        statusCodeHistogram: { '500': 1 },
        latencyHistogram: {},
        firstByteHistogram: {},
        updatedAt: bucketStart + 1,
      },
    });

    expect(getRouteObjectStats({ window: '24h', sortBy: 'tokens' })).toEqual([
      {
        id: 'site-1:account-1:key-1',
        siteId: 'site-1',
        siteName: 'Elysiver',
        accountId: 'account-1',
        accountName: '默认账户',
        apiKeyId: 'key-1',
        apiKeyName: '主 Key',
        requestCount: 3,
        successCount: 2,
        failureCount: 1,
        neutralCount: 0,
        successRate: 66.67,
        promptTokens: 250,
        completionTokens: 100,
        totalTokens: 350,
        cacheCreationTokens: 30,
        cacheReadTokens: 100,
        cachedTokens: 100,
        lastUsedAt: bucketStart + 1,
      },
    ]);
  });

  it('sorts route object stats by success rate when requested', () => {
    const bucketStart = Date.now() - 60_000;
    const lowerRateKey = buildBucketKey(
      bucketStart,
      'geminiCli',
      'gemini-3.1-pro',
      'site-1',
      'account-1',
      'key-1'
    );
    const higherRateKey = buildBucketKey(
      bucketStart,
      'codex',
      'gpt-5.5',
      'site-1',
      'account-1',
      'key-2'
    );

    resetRoutingBuckets({
      [lowerRateKey]: {
        bucketKey: lowerRateKey,
        bucketStart,
        bucketSize: 'hour',
        cliType: 'geminiCli',
        routeRuleId: 'rule-1',
        canonicalModel: 'gemini-3.1-pro',
        siteId: 'site-1',
        accountId: 'account-1',
        apiKeyId: 'key-1',
        requestCount: 4,
        successCount: 2,
        failureCount: 2,
        neutralCount: 0,
        promptTokens: 1000,
        completionTokens: 400,
        totalTokens: 1400,
        statusCodeHistogram: { '200': 2, '500': 2 },
        latencyHistogram: {},
        firstByteHistogram: {},
        updatedAt: bucketStart,
      },
      [higherRateKey]: {
        bucketKey: higherRateKey,
        bucketStart,
        bucketSize: 'hour',
        cliType: 'codex',
        routeRuleId: 'rule-1',
        canonicalModel: 'gpt-5.5',
        siteId: 'site-1',
        accountId: 'account-1',
        apiKeyId: 'key-2',
        requestCount: 2,
        successCount: 2,
        failureCount: 0,
        neutralCount: 0,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        statusCodeHistogram: { '200': 2 },
        latencyHistogram: {},
        firstByteHistogram: {},
        updatedAt: bucketStart + 1,
      },
    });

    expect(
      getRouteObjectStats({ window: '24h', sortBy: 'successRate' }).map(item => item.apiKeyId)
    ).toEqual(['key-2', 'key-1']);
  });

  it('does not expose api key id when api key name is missing', () => {
    mocks.exportedConfig.accounts[0].cached_data.api_keys.push({
      id: 'key-without-name',
      name: '   ',
      group: 'default',
    });

    try {
      const bucketStart = Date.now() - 60_000;
      const bucketKey = buildBucketKey(
        bucketStart,
        'codex',
        'gpt-5.5',
        'site-1',
        'account-1',
        'key-without-name'
      );

      resetRoutingBuckets({
        [bucketKey]: {
          bucketKey,
          bucketStart,
          bucketSize: 'hour',
          cliType: 'codex',
          canonicalModel: 'gpt-5.5',
          siteId: 'site-1',
          accountId: 'account-1',
          apiKeyId: 'key-without-name',
          requestCount: 1,
          successCount: 1,
          failureCount: 0,
          neutralCount: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          statusCodeHistogram: { '200': 1 },
          latencyHistogram: {},
          firstByteHistogram: {},
          updatedAt: bucketStart,
        },
      });

      expect(getRouteObjectStats({ window: '24h', sortBy: 'requests' })[0]).toMatchObject({
        apiKeyId: 'key-without-name',
        apiKeyName: '未命名 Key',
      });
    } finally {
      mocks.exportedConfig.accounts[0].cached_data.api_keys =
        mocks.exportedConfig.accounts[0].cached_data.api_keys.filter(
          apiKey => apiKey.id !== 'key-without-name'
        );
    }
  });

  it('uses custom cli config name with default account and key labels', () => {
    const bucketStart = Date.now() - 60_000;
    const siteId = 'custom-cli-site-workbench';
    const accountId = 'custom-cli-account-workbench';
    const apiKeyId = 'custom-cli-key-workbench';
    const bucketKey = buildBucketKey(bucketStart, 'codex', 'gpt-5.5', siteId, accountId, apiKeyId);

    resetRoutingBuckets({
      [bucketKey]: {
        bucketKey,
        bucketStart,
        bucketSize: 'hour',
        cliType: 'codex',
        canonicalModel: 'gpt-5.5',
        siteId,
        accountId,
        apiKeyId,
        requestCount: 2,
        successCount: 2,
        failureCount: 0,
        neutralCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        statusCodeHistogram: { '200': 2 },
        latencyHistogram: {},
        firstByteHistogram: {},
        updatedAt: bucketStart,
      },
    });
    mocks.routingConfig.modelRegistry.sources = [
      {
        sourceKey: 'custom-cli-source',
        siteId,
        siteName: '自定义 CLI / Workbench 配置',
        accountId,
        accountName: '自定义 CLI',
        sourceType: 'customCli',
        originalModel: 'gpt-5.5',
        vendor: 'openai',
        availableApiKeys: [
          {
            apiKeyId,
            apiKeyName: 'Workbench 配置 Key',
            accountId,
            accountName: '自定义 CLI',
            group: 'custom-cli',
          },
        ],
        firstSeenAt: bucketStart,
        lastSeenAt: bucketStart,
      },
    ];

    expect(getRouteObjectStats({ window: '24h', sortBy: 'requests' })[0]).toMatchObject({
      siteName: 'Workbench 配置',
      accountName: '默认',
      apiKeyName: '默认',
    });
  });

  it('merges duplicate custom cli route objects by display identity', () => {
    const bucketStart = Date.now() - 60_000;
    const firstSiteId = 'custom-cli-site-workbench-a';
    const firstAccountId = 'custom-cli-account-workbench-a';
    const firstApiKeyId = 'custom-cli-key-workbench-a';
    const secondSiteId = 'custom-cli-site-workbench-b';
    const secondAccountId = 'custom-cli-account-workbench-b';
    const secondApiKeyId = 'custom-cli-key-workbench-b';
    const firstBucketKey = buildBucketKey(
      bucketStart,
      'codex',
      'gpt-5.5',
      firstSiteId,
      firstAccountId,
      firstApiKeyId
    );
    const secondBucketKey = buildBucketKey(
      bucketStart,
      'geminiCli',
      'gemini-3.1-pro',
      secondSiteId,
      secondAccountId,
      secondApiKeyId
    );

    resetRoutingBuckets({
      [firstBucketKey]: {
        bucketKey: firstBucketKey,
        bucketStart,
        bucketSize: 'hour',
        cliType: 'codex',
        canonicalModel: 'gpt-5.5',
        siteId: firstSiteId,
        accountId: firstAccountId,
        apiKeyId: firstApiKeyId,
        requestCount: 2,
        successCount: 2,
        failureCount: 0,
        neutralCount: 0,
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
        statusCodeHistogram: { '200': 2 },
        latencyHistogram: {},
        firstByteHistogram: {},
        updatedAt: bucketStart,
      },
      [secondBucketKey]: {
        bucketKey: secondBucketKey,
        bucketStart,
        bucketSize: 'hour',
        cliType: 'geminiCli',
        canonicalModel: 'gemini-3.1-pro',
        siteId: secondSiteId,
        accountId: secondAccountId,
        apiKeyId: secondApiKeyId,
        requestCount: 1,
        successCount: 0,
        failureCount: 1,
        neutralCount: 0,
        promptTokens: 7,
        completionTokens: 3,
        totalTokens: 10,
        statusCodeHistogram: { '503': 1 },
        latencyHistogram: {},
        firstByteHistogram: {},
        updatedAt: bucketStart + 1,
      },
    });
    mocks.routingConfig.modelRegistry.sources = [
      {
        sourceKey: 'custom-cli-source-a',
        siteId: firstSiteId,
        siteName: '自定义 CLI / Workbench 配置',
        accountId: firstAccountId,
        accountName: '自定义 CLI',
        sourceType: 'customCli',
        originalModel: 'gpt-5.5',
        vendor: 'openai',
        availableApiKeys: [
          {
            apiKeyId: firstApiKeyId,
            apiKeyName: 'Workbench 配置 Key',
            accountId: firstAccountId,
            accountName: '自定义 CLI',
            group: 'custom-cli',
          },
        ],
        firstSeenAt: bucketStart,
        lastSeenAt: bucketStart,
      },
      {
        sourceKey: 'custom-cli-source-b',
        siteId: secondSiteId,
        siteName: '自定义 CLI / Workbench 配置',
        accountId: secondAccountId,
        accountName: '自定义 CLI',
        sourceType: 'customCli',
        originalModel: 'gemini-3.1-pro',
        vendor: 'google',
        availableApiKeys: [
          {
            apiKeyId: secondApiKeyId,
            apiKeyName: 'Workbench 配置 Key',
            accountId: secondAccountId,
            accountName: '自定义 CLI',
            group: 'custom-cli',
          },
        ],
        firstSeenAt: bucketStart,
        lastSeenAt: bucketStart + 1,
      },
    ];

    expect(getRouteObjectStats({ window: '24h', sortBy: 'successRate' })).toMatchObject([
      {
        siteName: 'Workbench 配置',
        accountName: '默认',
        apiKeyName: '默认',
        requestCount: 3,
        successCount: 2,
        failureCount: 1,
        successRate: 66.67,
        totalTokens: 40,
        lastUsedAt: bucketStart + 1,
      },
    ]);
  });
});
