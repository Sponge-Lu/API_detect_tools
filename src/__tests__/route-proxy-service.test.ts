import { describe, expect, it, vi } from 'vitest';

vi.mock('../main/utils/logger', () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: {},
}));

vi.mock('../main/route-rule-engine', () => ({
  detectCliTypeFromPath: vi.fn(),
  extractModelFromBody: vi.fn(),
  sortRules: vi.fn(),
  findMatchingRule: vi.fn(),
}));

vi.mock('../main/route-channel-resolver', () => ({
  resolveChannels: vi.fn(),
  resolveChannelCredentials: vi.fn(),
}));

vi.mock('../main/route-stats-service', () => ({
  sortChannelsByScore: vi.fn((channels: unknown[]) => channels),
  recordOutcome: vi.fn(),
  isRoutePathDisabled: vi.fn(() => false),
  recordRoutePathOutcome: vi.fn(),
}));

vi.mock('../main/route-health-service', () => ({
  startHealthCheckTimer: vi.fn(),
  stopHealthCheckTimer: vi.fn(),
}));

vi.mock('../main/route-analytics-service', () => ({
  recordRouteRequest: vi.fn(),
}));

vi.mock('../main/utils/http-client', () => ({
  httpRawRequest: vi.fn(),
}));

import {
  buildChannelAttemptPlan,
  buildGeminiUpstreamPath,
  buildUpstreamRequestUrl,
  buildUpstreamHeaders,
  classifyRouteStatusCode,
  extractRouteApiKey,
  resolveRouteRuntimeConfig,
} from '../main/route-proxy-service';

describe('route-proxy-service attempt planning', () => {
  it('treats upstream client errors as route path failures so fallback keys can be tried', () => {
    expect(classifyRouteStatusCode(200)).toBe('success');
    expect(classifyRouteStatusCode(400)).toBe('failure');
    expect(classifyRouteStatusCode(422)).toBe('failure');
    expect(classifyRouteStatusCode(502)).toBe('failure');
  });

  it('keeps one attempt per route path while preserving distinct api keys and sites', () => {
    const plan = buildChannelAttemptPlan(
      [
        {
          routeRuleId: 'rule-1',
          siteId: 'site-1',
          accountId: 'acc-1',
          apiKeyId: 'key-a',
          canonicalModel: 'claude-route',
          resolvedModel: 'raw-a',
        },
        {
          routeRuleId: 'rule-1',
          siteId: 'site-1',
          accountId: 'acc-1',
          apiKeyId: 'key-a',
          canonicalModel: 'claude-route',
          resolvedModel: 'raw-a',
        },
        {
          routeRuleId: 'rule-1',
          siteId: 'site-1',
          accountId: 'acc-1',
          apiKeyId: 'key-b',
          canonicalModel: 'claude-route',
          resolvedModel: 'raw-a',
        },
        {
          routeRuleId: 'rule-1',
          siteId: 'site-2',
          accountId: 'acc-2',
          apiKeyId: 'key-c',
          canonicalModel: 'claude-route',
          resolvedModel: 'raw-a',
        },
      ],
      1
    );

    expect(plan).toEqual([
      {
        routeRuleId: 'rule-1',
        siteId: 'site-1',
        accountId: 'acc-1',
        apiKeyId: 'key-a',
        canonicalModel: 'claude-route',
        resolvedModel: 'raw-a',
      },
      {
        routeRuleId: 'rule-1',
        siteId: 'site-1',
        accountId: 'acc-1',
        apiKeyId: 'key-b',
        canonicalModel: 'claude-route',
        resolvedModel: 'raw-a',
      },
      {
        routeRuleId: 'rule-1',
        siteId: 'site-2',
        accountId: 'acc-2',
        apiKeyId: 'key-c',
        canonicalModel: 'claude-route',
        resolvedModel: 'raw-a',
      },
    ]);
  });

  it('uses canonical model as part of the route path when resolvedModel is missing', () => {
    const plan = buildChannelAttemptPlan(
      [
        {
          routeRuleId: 'rule-1',
          siteId: 'site-1',
          accountId: 'acc-1',
          apiKeyId: 'key-a',
          canonicalModel: 'gpt-5-4',
        },
        {
          routeRuleId: 'rule-1',
          siteId: 'site-1',
          accountId: 'acc-1',
          apiKeyId: 'key-a',
          canonicalModel: 'gpt-5-4',
        },
        {
          routeRuleId: 'rule-1',
          siteId: 'site-2',
          accountId: 'acc-2',
          apiKeyId: 'key-b',
          canonicalModel: 'gpt-5-4',
        },
      ],
      1
    );

    expect(plan).toEqual([
      {
        routeRuleId: 'rule-1',
        siteId: 'site-1',
        accountId: 'acc-1',
        apiKeyId: 'key-a',
        canonicalModel: 'gpt-5-4',
      },
      {
        routeRuleId: 'rule-1',
        siteId: 'site-2',
        accountId: 'acc-2',
        apiKeyId: 'key-b',
        canonicalModel: 'gpt-5-4',
      },
    ]);
  });

  it('keeps configured attempts per route path before moving to the next path', () => {
    const duplicatePath = {
      routeRuleId: 'rule-1',
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-a',
      canonicalModel: 'claude-route',
      resolvedModel: 'raw-a',
    };
    const nextPath = {
      routeRuleId: 'rule-1',
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-b',
      canonicalModel: 'claude-route',
      resolvedModel: 'raw-a',
    };

    const plan = buildChannelAttemptPlan(
      [duplicatePath, duplicatePath, duplicatePath, nextPath],
      2
    );

    expect(plan).toEqual([duplicatePath, duplicatePath, nextPath]);
  });

  it('resolves per-model route runtime config from display items', () => {
    const routingConfig = {
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {},
        overrides: [],
        displayItems: [
          {
            id: 'manual:claude-route',
            vendor: 'claude' as const,
            canonicalName: 'claude-route',
            sourceKeys: ['site-1:acc-1:raw-a'],
            originalModelOrder: ['raw-a'],
            priorityConfig: { sitePriorities: {}, apiKeyPriorities: {} },
            runtimeConfig: {
              maxAttemptsPerRoutePath: 3,
              successRateWindowMinutes: 12,
              disableDurationMinutes: 45,
              minSuccessRate: 0.75,
            },
            mode: 'manual' as const,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        vendorPriorities: {},
      },
    };

    const config = resolveRouteRuntimeConfig(routingConfig, 'claude-route');

    expect(config).toEqual({
      maxAttemptsPerRoutePath: 3,
      successRateWindowMinutes: 12,
      disableDurationMinutes: 45,
      minSuccessRate: 0.75,
    });
    expect(resolveRouteRuntimeConfig(routingConfig, 'missing')).toEqual({
      maxAttemptsPerRoutePath: 1,
      successRateWindowMinutes: 5,
      disableDurationMinutes: 30,
      minSuccessRate: 0.8,
    });
  });
});

describe('route-proxy-service auth extraction', () => {
  it('reads Claude Code route auth from x-api-key header', () => {
    const token = extractRouteApiKey(
      {
        headers: {
          'x-api-key': 'sk-route-claude',
        },
        url: '/v1/messages',
      },
      'claudeCode'
    );

    expect(token).toBe('sk-route-claude');
  });

  it('falls back to bearer-token auth for Claude Code when x-api-key is absent', () => {
    const token = extractRouteApiKey(
      {
        headers: {
          authorization: 'Bearer sk-route-claude-bearer',
        },
        url: '/v1/messages',
      },
      'claudeCode'
    );

    expect(token).toBe('sk-route-claude-bearer');
  });

  it('reads Gemini route auth from x-goog-api-key header', () => {
    const token = extractRouteApiKey(
      {
        headers: {
          'x-goog-api-key': 'sk-route-123',
        },
        url: '/v1beta/models/gemini-3-1-pro:generateContent',
      },
      'geminiCli'
    );

    expect(token).toBe('sk-route-123');
  });

  it('falls back to Gemini route auth from query key when header is absent', () => {
    const token = extractRouteApiKey(
      {
        headers: {},
        url: '/v1beta/models/gemini-3-1-pro:streamGenerateContent?alt=sse&key=sk-route-456',
      },
      'geminiCli'
    );

    expect(token).toBe('sk-route-456');
  });

  it('keeps bearer-token auth for non-Gemini CLIs', () => {
    const token = extractRouteApiKey(
      {
        headers: {
          authorization: 'Bearer sk-route-789',
        },
        url: '/v1/responses',
      },
      'codex'
    );

    expect(token).toBe('sk-route-789');
  });
});

describe('route-proxy-service upstream auth headers', () => {
  it('forwards Claude Code upstream auth as x-api-key without leaking local route auth', () => {
    const headers = buildUpstreamHeaders(
      {
        'x-api-key': 'sk-route-key',
        authorization: 'Bearer sk-route-key',
        'content-type': 'application/json',
      },
      'duckcoding.ai',
      42,
      'sk-upstream-key',
      'claudeCode'
    );

    expect(headers['x-api-key']).toBe('sk-upstream-key');
    expect(headers.authorization).toBeUndefined();
    expect(headers.host).toBe('duckcoding.ai');
    expect(headers['content-length']).toBe('42');
    expect(headers['content-type']).toBe('application/json');
  });

  it('forwards Codex upstream auth as bearer token', () => {
    const headers = buildUpstreamHeaders(
      {
        authorization: 'Bearer sk-route-key',
        'content-type': 'application/json',
      },
      'duckcoding.ai',
      42,
      'sk-upstream-key',
      'codex'
    );

    expect(headers.authorization).toBe('Bearer sk-upstream-key');
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('forwards Gemini upstream auth as x-goog-api-key without leaking route query/header auth', () => {
    const headers = buildUpstreamHeaders(
      {
        'x-goog-api-key': 'sk-route-key',
        authorization: 'Bearer sk-route-key',
        'content-type': 'application/json',
      },
      'duckcoding.ai',
      42,
      'sk-upstream-key',
      'geminiCli'
    );

    expect(headers['x-goog-api-key']).toBe('sk-upstream-key');
    expect(headers.authorization).toBeUndefined();
    expect(headers['x-api-key']).toBeUndefined();
  });
});

describe('route-proxy-service Gemini upstream path rewriting', () => {
  it('rewrites the native Gemini path model and replaces the query api key', () => {
    const targetPath = buildGeminiUpstreamPath(
      '/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse&key=sk-route-key',
      'duckcoding',
      'sk-upstream-key'
    );

    expect(targetPath).toBe(
      '/v1beta/models/duckcoding:streamGenerateContent?alt=sse&key=sk-upstream-key'
    );
  });

  it('preserves the Gemini action suffix when rewriting generateContent paths', () => {
    const targetPath = buildGeminiUpstreamPath(
      '/v1beta/models/gemini-2.5-flash:generateContent',
      'duckcoding-preview',
      'sk-upstream-key'
    );

    expect(targetPath).toBe(
      '/v1beta/models/duckcoding-preview:generateContent?key=sk-upstream-key'
    );
  });
});

describe('route-proxy-service upstream request target', () => {
  it('keeps OpenAI-compatible route paths when building the upstream URL', () => {
    const target = buildUpstreamRequestUrl(
      'https://anyrouter.top/',
      '/v1/responses',
      'codex',
      undefined,
      'sk-upstream-key'
    );

    expect(target).toEqual({
      url: 'https://anyrouter.top/v1/responses',
      host: 'anyrouter.top',
    });
  });

  it('applies Gemini native path and query key rewriting before forwarding', () => {
    const target = buildUpstreamRequestUrl(
      'https://anyrouter.top/',
      '/v1beta/models/gemini-3.1-pro:generateContent?key=sk-route-key',
      'geminiCli',
      'gemini-3.1-pro-upstream',
      'sk-upstream-key'
    );

    expect(target).toEqual({
      url: 'https://anyrouter.top/v1beta/models/gemini-3.1-pro-upstream:generateContent?key=sk-upstream-key',
      host: 'anyrouter.top',
    });
  });
});
