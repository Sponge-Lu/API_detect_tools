import { Readable } from 'stream';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../main/utils/logger', () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
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
  extractModelFromPath: vi.fn(),
  sortRules: vi.fn(),
  findMatchingRule: vi.fn(),
}));

vi.mock('../main/route-channel-resolver', () => ({
  resolveChannels: vi.fn(),
  resolveChannelCredentials: vi.fn(),
  resolveChannelTarget: vi.fn(
    async (channel: { targetProtocol?: string; targetEndpoint?: string }) => ({
      targetProtocol: channel.targetProtocol ?? 'native',
      targetEndpoint: channel.targetEndpoint ?? '/mock-endpoint',
    })
  ),
}));

vi.mock('../main/route-stats-service', () => ({
  sortChannelsByScore: vi.fn((channels: unknown[]) => channels),
  recordOutcome: vi.fn(),
  isRoutePathDisabled: vi.fn(() => false),
  recordRoutePathOutcome: vi.fn(),
  isRouteEndpointUnsupported: vi.fn(() => false),
  recordRouteEndpointUnsupported: vi.fn(),
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
  httpRawStreamRequest: vi.fn(),
}));

import {
  applySuccessfulRoutePathAffinity,
  buildChannelAttemptPlan,
  buildGeminiUpstreamPath,
  buildUpstreamRequestUrl,
  buildUpstreamHeaders,
  classifyRouteStatusCode,
  estimateClaudeCountTokens,
  extractRouteApiKey,
  extractUsageFromBody,
  handleRequest,
  resolveRouteRuntimeConfig,
  summarizeUpstreamFailureBodyForLog,
} from '../main/route-proxy-service';
import { unifiedConfigManager } from '../main/unified-config-manager';
import {
  detectCliTypeFromPath,
  extractModelFromBody,
  extractModelFromPath,
  findMatchingRule,
  sortRules,
} from '../main/route-rule-engine';
import { resolveChannels, resolveChannelCredentials } from '../main/route-channel-resolver';
import {
  buildProbeLockRouteApiKey,
  clearRouteProbeLockTerminalFailure,
  getRouteProbeLockFirstUpstreamResult,
  subscribeRouteProbeLockTerminalFailure,
  MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS,
  type RouteProbeLockTerminalFailure,
} from '../main/route-probe-lock';
import { httpRawRequest, httpRawStreamRequest } from '../main/utils/http-client';
import {
  isRouteEndpointUnsupported,
  isRoutePathDisabled,
  recordRouteEndpointUnsupported,
  recordRoutePathOutcome,
} from '../main/route-stats-service';
import { recordRouteRequest } from '../main/route-analytics-service';
import {
  buildRouteApiKeyPriorityKey,
  buildRoutePathStateKey,
  ROUTE_SUCCESSFUL_PATH_AFFINITY_MS,
  type RoutePathState,
} from '../shared/types/route-proxy';

function createJsonRequest(
  url: string,
  headers: Record<string, string>,
  body: unknown
): Parameters<typeof handleRequest>[0] {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]) as Readable & {
    headers: Record<string, string>;
    method: string;
    url: string;
    socket: { remoteAddress: string };
  };

  request.headers = headers;
  request.method = 'POST';
  request.url = url;
  request.socket = { remoteAddress: '::1' };

  return request as unknown as Parameters<typeof handleRequest>[0];
}

function createMockResponse(): Parameters<typeof handleRequest>[1] & {
  body: string;
  end: ReturnType<typeof vi.fn>;
  headers: Record<string, unknown>;
  statusCode: number;
  write: ReturnType<typeof vi.fn>;
  writeHead: ReturnType<typeof vi.fn>;
} {
  const response = {
    body: '',
    destroyed: false,
    headers: {} as Record<string, unknown>,
    headersSent: false,
    statusCode: 0,
    writableEnded: false,
    writeHead: vi.fn((statusCode: number, headers?: Record<string, unknown>) => {
      response.statusCode = statusCode;
      response.headers = headers ?? {};
      response.headersSent = true;
      return response;
    }),
    write: vi.fn((chunk?: string | Buffer) => {
      if (chunk !== undefined) {
        response.body += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : chunk;
      }
      response.headersSent = true;
      return true;
    }),
    end: vi.fn((chunk?: string | Buffer) => {
      if (chunk !== undefined) {
        response.body += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : chunk;
      }
      response.headersSent = true;
      response.writableEnded = true;
      return response;
    }),
    off: vi.fn(),
    once: vi.fn(),
  };

  return response as unknown as Parameters<typeof handleRequest>[1] & {
    body: string;
    end: ReturnType<typeof vi.fn>;
    headers: Record<string, unknown>;
    statusCode: number;
    write: ReturnType<typeof vi.fn>;
    writeHead: ReturnType<typeof vi.fn>;
  };
}

function buildClaudeTextSse(text = 'ok'): Buffer {
  return Buffer.from(
    [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","model":"claude-opus-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(text)}}}`,
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
      '',
    ].join('\n'),
    'utf-8'
  );
}

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

  it('promotes the most recent successful route path and keeps circular fallback order', () => {
    const now = 1_700_000_000_000;
    const firstPath = {
      routeRuleId: 'rule-1',
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-a',
      targetProtocol: 'native' as const,
      canonicalModel: 'claude-route',
      resolvedModel: 'raw-a',
    };
    const secondPath = {
      ...firstPath,
      siteId: 'site-2',
      accountId: 'acc-2',
      apiKeyId: 'key-b',
    };
    const thirdPath = {
      ...firstPath,
      siteId: 'site-3',
      accountId: 'acc-3',
      apiKeyId: 'key-c',
    };
    const fourthPath = {
      ...firstPath,
      siteId: 'site-4',
      accountId: 'acc-4',
      apiKeyId: 'key-d',
    };
    const routePathStates: Record<string, RoutePathState> = {
      [buildRoutePathStateKey(secondPath)]: {
        ...secondPath,
        windowStartedAt: now,
        windowRequestCount: 1,
        windowSuccessCount: 1,
        successRate: 1,
        lastOutcome: 'success',
        lastSuccessAt: now - 120_000,
        updatedAt: now - 120_000,
      },
      [buildRoutePathStateKey(thirdPath)]: {
        ...thirdPath,
        windowStartedAt: now,
        windowRequestCount: 1,
        windowSuccessCount: 1,
        successRate: 1,
        lastOutcome: 'success',
        lastSuccessAt: now - 30_000,
        updatedAt: now - 30_000,
      },
    };

    const plan = applySuccessfulRoutePathAffinity(
      [firstPath, secondPath, thirdPath, fourthPath],
      routePathStates,
      now
    );

    expect(plan.map(channel => channel.siteId)).toEqual(['site-3', 'site-4', 'site-1', 'site-2']);
  });

  it('ignores stale, failed, and disabled route path affinity states', () => {
    const now = 1_700_000_000_000;
    const firstPath = {
      routeRuleId: 'rule-1',
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-a',
      targetProtocol: 'native' as const,
      canonicalModel: 'claude-route',
      resolvedModel: 'raw-a',
    };
    const stalePath = {
      ...firstPath,
      siteId: 'site-stale',
      accountId: 'acc-stale',
      apiKeyId: 'key-stale',
    };
    const failedPath = {
      ...firstPath,
      siteId: 'site-failed',
      accountId: 'acc-failed',
      apiKeyId: 'key-failed',
    };
    const disabledPath = {
      ...firstPath,
      siteId: 'site-disabled',
      accountId: 'acc-disabled',
      apiKeyId: 'key-disabled',
    };
    const routePathStates: Record<string, RoutePathState> = {
      [buildRoutePathStateKey(stalePath)]: {
        ...stalePath,
        windowStartedAt: now,
        windowRequestCount: 1,
        windowSuccessCount: 1,
        successRate: 1,
        lastOutcome: 'success',
        lastSuccessAt: now - ROUTE_SUCCESSFUL_PATH_AFFINITY_MS - 1,
        updatedAt: now - ROUTE_SUCCESSFUL_PATH_AFFINITY_MS - 1,
      },
      [buildRoutePathStateKey(failedPath)]: {
        ...failedPath,
        windowStartedAt: now,
        windowRequestCount: 2,
        windowSuccessCount: 1,
        successRate: 0.5,
        lastOutcome: 'failure',
        lastSuccessAt: now - 10_000,
        lastFailureAt: now - 1_000,
        updatedAt: now - 1_000,
      },
      [buildRoutePathStateKey(disabledPath)]: {
        ...disabledPath,
        windowStartedAt: now,
        windowRequestCount: 1,
        windowSuccessCount: 1,
        successRate: 1,
        disabledUntil: now + 60_000,
        lastOutcome: 'success',
        lastSuccessAt: now - 10_000,
        updatedAt: now - 10_000,
      },
    };

    const channels = [firstPath, stalePath, failedPath, disabledPath];
    expect(applySuccessfulRoutePathAffinity(channels, routePathStates, now)).toEqual(channels);
  });

  it('ignores a recently reset successful route path for affinity', () => {
    const now = 1_700_000_000_000;
    const firstPath = {
      routeRuleId: 'rule-1',
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-a',
      targetProtocol: 'native' as const,
      canonicalModel: 'claude-route',
      resolvedModel: 'raw-a',
    };
    const resetPath = {
      ...firstPath,
      siteId: 'site-2',
      accountId: 'acc-2',
      apiKeyId: 'key-b',
    };
    const routePathStates: Record<string, RoutePathState> = {
      [buildRoutePathStateKey(resetPath)]: {
        ...resetPath,
        windowStartedAt: now,
        windowRequestCount: 2,
        windowSuccessCount: 2,
        successRate: 1,
        lastOutcome: 'success',
        lastSuccessAt: now - 10_000,
        affinitySuppressedAt: now - 1_000,
        affinitySuppressedUntil: now + 60_000,
        updatedAt: now - 1_000,
      },
    };

    expect(applySuccessfulRoutePathAffinity([firstPath, resetPath], routePathStates, now)).toEqual([
      firstPath,
      resetPath,
    ]);
  });

  it('ignores successful route path affinity when the route channel was reset', () => {
    const now = 1_700_000_000_000;
    const firstPath = {
      routeRuleId: 'rule-1',
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-a',
      targetProtocol: 'native' as const,
      canonicalModel: 'claude-route',
      resolvedModel: 'raw-a',
    };
    const resetPath = {
      ...firstPath,
      siteId: 'site-2',
      accountId: 'acc-2',
      apiKeyId: 'key-b',
      resolvedModel: 'raw-b',
    };
    const channelSuppression = {
      ...resetPath,
      resolvedModel: undefined,
    };
    const routePathStates: Record<string, RoutePathState> = {
      [buildRoutePathStateKey(resetPath)]: {
        ...resetPath,
        windowStartedAt: now,
        windowRequestCount: 2,
        windowSuccessCount: 2,
        successRate: 1,
        lastOutcome: 'success',
        lastSuccessAt: now - 10_000,
        updatedAt: now - 1_000,
      },
      [buildRoutePathStateKey(channelSuppression)]: {
        ...channelSuppression,
        windowStartedAt: now,
        windowRequestCount: 0,
        windowSuccessCount: 0,
        successRate: 1,
        affinitySuppressedAt: now - 1_000,
        affinitySuppressedUntil: now + 60_000,
        updatedAt: now - 1_000,
      },
    };

    expect(applySuccessfulRoutePathAffinity([firstPath, resetPath], routePathStates, now)).toEqual([
      firstPath,
      resetPath,
    ]);
  });

  it('applies successful route path affinity after max attempts per route path bounding', () => {
    const now = 1_700_000_000_000;
    const firstPath = {
      routeRuleId: 'rule-1',
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-a',
      targetProtocol: 'native' as const,
      canonicalModel: 'claude-route',
      resolvedModel: 'raw-a',
    };
    const preferredPath = {
      ...firstPath,
      siteId: 'site-2',
      accountId: 'acc-2',
      apiKeyId: 'key-b',
    };
    const thirdPath = {
      ...firstPath,
      siteId: 'site-3',
      accountId: 'acc-3',
      apiKeyId: 'key-c',
    };
    const routePathStates: Record<string, RoutePathState> = {
      [buildRoutePathStateKey(preferredPath)]: {
        ...preferredPath,
        windowStartedAt: now,
        windowRequestCount: 1,
        windowSuccessCount: 1,
        successRate: 1,
        lastOutcome: 'success',
        lastSuccessAt: now - 10_000,
        updatedAt: now - 10_000,
      },
    };

    const oncePlan = applySuccessfulRoutePathAffinity(
      buildChannelAttemptPlan([firstPath, preferredPath, preferredPath, thirdPath], 1),
      routePathStates,
      now
    );
    expect(oncePlan.map(channel => channel.siteId)).toEqual(['site-2', 'site-3', 'site-1']);

    const twicePlan = applySuccessfulRoutePathAffinity(
      buildChannelAttemptPlan([firstPath, preferredPath, preferredPath, thirdPath], 2),
      routePathStates,
      now
    );
    expect(twicePlan.map(channel => channel.siteId)).toEqual([
      'site-2',
      'site-2',
      'site-3',
      'site-1',
    ]);
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
      maxAttemptsPerRoutePath: 3,
      successRateWindowMinutes: 60,
      disableDurationMinutes: 60,
      minSuccessRate: 0.3,
    });
  });
});

describe('route-proxy-service usage extraction', () => {
  it('summarizes upstream failure bodies for logs and truncates long payloads', () => {
    expect(summarizeUpstreamFailureBodyForLog(Buffer.from('  {"error":"bad_request"}  '))).toBe(
      'bad_request'
    );

    expect(
      summarizeUpstreamFailureBodyForLog(
        Buffer.from(
          JSON.stringify({
            error: {
              type: 'PRECONDITION_FAILED',
              message: 'Account s95d548b88-yxzyl72s3 is suspended for billing.',
            },
          })
        )
      )
    ).toBe('PRECONDITION_FAILED: Account s95d548b88-yxzyl72s3 is suspended for billing.');

    expect(
      summarizeUpstreamFailureBodyForLog(
        Buffer.from('{"error":"quota_exceeded","message":"upstream quota exhausted"}')
      )
    ).toBe('quota_exceeded: upstream quota exhausted');

    expect(
      summarizeUpstreamFailureBodyForLog(
        Buffer.from(
          '<html> <head><title>504 Gateway Time-out</title></head> <body bgcolor="white"> <center>nginx</center> </body></html>'
        )
      )
    ).toBe('504 Gateway Time-out');

    expect(summarizeUpstreamFailureBodyForLog(Buffer.alloc(0))).toBe('');

    const truncated = summarizeUpstreamFailureBodyForLog(Buffer.from('x'.repeat(20)), 8);
    expect(truncated).toBe('xxxxxxxx ...(truncated 12 chars)');
  });

  it('extracts Claude Messages usage with cache write and read tokens', () => {
    const usage = extractUsageFromBody(
      Buffer.from(
        JSON.stringify({
          type: 'message',
          usage: {
            input_tokens: 12,
            output_tokens: 4,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 200,
          },
        })
      )
    );

    expect(usage).toEqual({
      promptTokens: 12,
      completionTokens: 4,
      totalTokens: 316,
      cacheCreationTokens: 100,
      cacheReadTokens: 200,
      cachedTokens: undefined,
    });
  });

  it('extracts Claude cache creation split across PrismAI/Anthropic duration fields', () => {
    const usage = extractUsageFromBody(
      Buffer.from(
        JSON.stringify({
          type: 'message',
          usage: {
            input_tokens: 12,
            output_tokens: 4,
            cache_creation_input_tokens: 0,
            claude_cache_creation_5_m_tokens: 40,
            claude_cache_creation_1_h_tokens: 60,
            cache_read_input_tokens: 200,
          },
        })
      )
    );

    expect(usage).toEqual({
      promptTokens: 12,
      completionTokens: 4,
      totalTokens: 316,
      cacheCreationTokens: 100,
      cacheReadTokens: 200,
      cachedTokens: undefined,
    });
  });

  it('extracts Claude cache creation from nested cache_creation details', () => {
    const usage = extractUsageFromBody(
      Buffer.from(
        JSON.stringify({
          type: 'message',
          usage: {
            input_tokens: 12,
            output_tokens: 4,
            cache_creation: {
              ephemeral_5m_input_tokens: 40,
              ephemeral_1h_input_tokens: 60,
            },
          },
        })
      )
    );

    expect(usage).toEqual({
      promptTokens: 12,
      completionTokens: 4,
      totalTokens: 116,
      cacheCreationTokens: 100,
      cacheReadTokens: undefined,
      cachedTokens: undefined,
    });
  });

  it('extracts OpenAI Responses usage and cached input token details', () => {
    const usage = extractUsageFromBody(
      Buffer.from(
        JSON.stringify({
          object: 'response',
          usage: {
            input_tokens: 150,
            output_tokens: 50,
            total_tokens: 200,
            input_tokens_details: {
              cached_tokens: 64,
            },
          },
        })
      )
    );

    expect(usage).toMatchObject({
      promptTokens: 150,
      completionTokens: 50,
      totalTokens: 200,
      cacheReadTokens: 64,
      cachedTokens: 64,
    });
  });

  it('extracts Gemini usageMetadata from non-stream and SSE responses', () => {
    expect(
      extractUsageFromBody(
        Buffer.from(
          JSON.stringify({
            usageMetadata: {
              promptTokenCount: 17,
              candidatesTokenCount: 8,
              cachedContentTokenCount: 6,
              totalTokenCount: 31,
            },
          })
        )
      )
    ).toMatchObject({
      promptTokens: 17,
      completionTokens: 8,
      totalTokens: 31,
      cacheReadTokens: 6,
      cachedTokens: 6,
    });

    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"capture"}]}}],"usageMetadata":{"promptTokenCount":11,"candidatesTokenCount":5,"cachedContentTokenCount":3,"totalTokenCount":19}}',
      '',
    ].join('\n');

    expect(extractUsageFromBody(Buffer.from(sse))).toMatchObject({
      promptTokens: 11,
      completionTokens: 5,
      totalTokens: 19,
      cacheReadTokens: 3,
      cachedTokens: 3,
    });
  });

  it('merges Anthropic SSE message_start and message_delta usage chunks', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_creation_input_tokens":20,"cache_read_input_tokens":30}}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":7}}',
      '',
    ].join('\n');

    expect(extractUsageFromBody(Buffer.from(sse))).toEqual({
      promptTokens: 10,
      completionTokens: 7,
      totalTokens: 67,
      cacheCreationTokens: 20,
      cacheReadTokens: 30,
      cachedTokens: undefined,
    });
  });
});

describe('route-proxy-service Claude count_tokens fallback', () => {
  const rule = {
    id: 'rule-claude-count',
    cliType: 'claudeCode' as const,
    pattern: 'claude-opus-4-6',
    patternType: 'exact' as const,
  };
  const routing = {
    server: {
      unifiedApiKey: 'sk-route',
      requestTimeoutMs: 1000,
      upstreamProxyUrl: '',
    },
    rules: [rule],
    cliModelSelections: {
      claudeCode: null,
      codex: null,
      geminiCli: null,
    },
    modelRegistry: {
      version: 1,
      sources: [],
      entries: {
        'claude-opus-4-6': {
          canonicalName: 'claude-opus-4-6',
          aliases: ['claude-opus-4-6'],
          sources: [],
          vendor: 'claude' as const,
          hasOverride: false,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      overrides: [],
      displayItems: [],
      vendorPriorities: {},
    },
    routeEndpointCapabilities: {},
  };
  const countBody = {
    model: 'claude-opus-4-6',
    system: [{ type: 'text', text: 'Use concise answers.' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Read package.json' }] }],
    tools: [
      {
        name: 'Read',
        description: 'Read a file',
        input_schema: { type: 'object', properties: { file_path: { type: 'string' } } },
      },
    ],
  };

  function setupClaudeCountTokensRoute(channels: Array<Record<string, unknown>>) {
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn((siteId: string) => ({ id: siteId, name: siteId })),
      getAccountById: vi.fn((accountId: string) => ({ id: accountId, account_name: accountId })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('claudeCode');
    vi.mocked(extractModelFromBody).mockReturnValue('claude-opus-4-6');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue(channels as never);
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(isRouteEndpointUnsupported).mockReturnValue(false);
    vi.mocked(recordRouteEndpointUnsupported).mockImplementation(async (channel, endpoint) => ({
      siteId: channel.siteId,
      accountId: channel.accountId,
      apiKeyId: channel.apiKeyId,
      cliType: channel.cliType,
      targetProtocol: channel.targetProtocol,
      endpoint,
      status: 'unsupported',
      firstObservedAt: 1,
      lastObservedAt: 1,
      updatedAt: 1,
    }));
  }

  it('marks unsupported upstream count_tokens and returns a local estimate without trying later channels', async () => {
    vi.clearAllMocks();

    const firstChannel = {
      routeRuleId: rule.id,
      siteId: 'site-a',
      accountId: 'account-a',
      apiKeyId: 'key-a',
      cliType: 'claudeCode' as const,
      canonicalModel: 'claude-opus-4-6',
      resolvedModel: 'claude-opus-4-6',
    };
    const secondChannel = {
      ...firstChannel,
      siteId: 'site-b',
      accountId: 'account-b',
      apiKeyId: 'key-b',
    };
    setupClaudeCountTokensRoute([firstChannel, secondChannel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://site-a.example.com',
      apiKey: 'sk-upstream-a',
    });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"error":{"message":"Invalid URL (POST /v1/messages/count_tokens)"}}'),
    });

    const request = createJsonRequest(
      '/v1/messages/count_tokens',
      { 'x-api-key': 'sk-route', 'content-type': 'application/json' },
      countBody
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      input_tokens: estimateClaudeCountTokens(Buffer.from(JSON.stringify(countBody))).input_tokens,
    });
    expect(httpRawRequest).toHaveBeenCalledTimes(1);
    expect(resolveChannelCredentials).toHaveBeenCalledTimes(1);
    expect(recordRouteEndpointUnsupported).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'site-a',
        accountId: 'account-a',
        apiKeyId: 'key-a',
      }),
      'claude_messages_count_tokens',
      expect.objectContaining({ statusCode: 404, reason: 'upstream_unsupported' })
    );
    expect(recordRoutePathOutcome).not.toHaveBeenCalled();
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'neutral',
        statusCode: 200,
        error: 'count_tokens_local_estimate:upstream_404',
      })
    );
  });

  it('treats count_tokens not-enabled 403 as endpoint unsupported without route-path failure', async () => {
    vi.clearAllMocks();

    const channel = {
      routeRuleId: rule.id,
      siteId: 'site-forbidden',
      accountId: 'account-forbidden',
      apiKeyId: 'key-forbidden',
      cliType: 'claudeCode' as const,
      canonicalModel: 'claude-opus-4-6',
      resolvedModel: 'claude-opus-4-6',
    };
    setupClaudeCountTokensRoute([channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://forbidden.example.com',
      apiKey: 'sk-upstream-forbidden',
    });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 403,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"error":{"message":"count_tokens is not enabled for this channel"}}'),
    });

    const request = createJsonRequest(
      '/v1/messages/count_tokens',
      { 'x-api-key': 'sk-route', 'content-type': 'application/json' },
      countBody
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(recordRouteEndpointUnsupported).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'site-forbidden',
        accountId: 'account-forbidden',
        apiKeyId: 'key-forbidden',
      }),
      'claude_messages_count_tokens',
      expect.objectContaining({ statusCode: 403, reason: 'upstream_unsupported' })
    );
    expect(recordRoutePathOutcome).not.toHaveBeenCalled();
  });

  it('passes AnyRouter count_tokens through instead of forcing a local estimate', async () => {
    vi.clearAllMocks();

    const channel = {
      routeRuleId: rule.id,
      siteId: 'site-anyrouter',
      accountId: 'account-anyrouter',
      apiKeyId: 'key-anyrouter',
      cliType: 'claudeCode' as const,
      canonicalModel: 'claude-opus-4-6',
      resolvedModel: 'claude-opus-4-6',
    };
    setupClaudeCountTokensRoute([channel]);
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => ({ id: 'site-anyrouter', name: 'AnyRouter' })),
      getAccountById: vi.fn(() => ({
        id: 'account-anyrouter',
        account_name: 'anyrouter-account',
        anyRouterConfig: { userHash: 'a'.repeat(64) },
      })),
    });
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://anyrouter.top',
      apiKey: 'sk-anyrouter',
    });
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...channel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 1,
      successRate: 1,
      updatedAt: 1,
    });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"input_tokens":42}'),
    });

    const request = createJsonRequest(
      '/v1/messages/count_tokens',
      { 'x-api-key': 'sk-route', 'content-type': 'application/json' },
      countBody
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawRequest).toHaveBeenCalledWith(
      'https://anyrouter.top/v1/messages/count_tokens',
      expect.objectContaining({
        method: 'POST',
        preferElectronNet: true,
        headers: expect.objectContaining({
          'x-api-key': 'sk-anyrouter',
        }),
      })
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ input_tokens: 42 });
    expect(recordRouteEndpointUnsupported).not.toHaveBeenCalled();
  });

  it('uses a cached unsupported count_tokens marker without calling upstream again', async () => {
    vi.clearAllMocks();

    const channel = {
      routeRuleId: rule.id,
      siteId: 'site-cached',
      accountId: 'account-cached',
      apiKeyId: 'key-cached',
      cliType: 'claudeCode' as const,
      canonicalModel: 'claude-opus-4-6',
      resolvedModel: 'claude-opus-4-6',
    };
    setupClaudeCountTokensRoute([channel]);
    vi.mocked(isRouteEndpointUnsupported).mockReturnValue(true);

    const request = createJsonRequest(
      '/v1/messages/count_tokens',
      { 'x-api-key': 'sk-route', 'content-type': 'application/json' },
      countBody
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      input_tokens: estimateClaudeCountTokens(Buffer.from(JSON.stringify(countBody))).input_tokens,
    });
    expect(resolveChannelCredentials).not.toHaveBeenCalled();
    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(recordRouteEndpointUnsupported).not.toHaveBeenCalled();
    expect(recordRoutePathOutcome).not.toHaveBeenCalled();
  });

  it('marks non-Anthropic custom CLI targets as local-only for Claude count_tokens', async () => {
    vi.clearAllMocks();

    const channel = {
      routeRuleId: rule.id,
      siteId: 'custom-cli-site-demo',
      accountId: 'custom-cli-account-demo',
      apiKeyId: 'custom-cli-key-demo',
      cliType: 'claudeCode' as const,
      targetProtocol: 'openai-responses' as const,
      canonicalModel: 'claude-opus-4-6',
      resolvedModel: 'gpt-5.4',
    };
    setupClaudeCountTokensRoute([channel]);
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => undefined),
      getAccountById: vi.fn(() => undefined),
    });

    const request = createJsonRequest(
      '/v1/messages/count_tokens',
      { 'x-api-key': 'sk-route', 'content-type': 'application/json' },
      countBody
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(resolveChannelCredentials).not.toHaveBeenCalled();
    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(recordRouteEndpointUnsupported).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'custom-cli-site-demo',
        targetProtocol: 'openai-responses',
      }),
      'claude_messages_count_tokens',
      { reason: 'target_protocol_unsupported' }
    );
  });
});

describe('route-proxy-service CLI model fallback', () => {
  it('routes Gemini path-only default model requests through the selected CLI model rule', async () => {
    vi.clearAllMocks();

    const selectedRule = {
      id: 'rule-gemini-selected',
      cliType: 'geminiCli' as const,
      pattern: 'gemini-3.1-pro-preview',
      patternType: 'exact' as const,
    };
    const channel = {
      routeRuleId: selectedRule.id,
      siteId: 'site-nhh',
      accountId: 'account-default',
      apiKeyId: 'key-default',
      cliType: 'geminiCli' as const,
      canonicalModel: 'gemini-3.1-pro-preview',
      resolvedModel: 'gemini-3.1-pro-preview',
    };
    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
        blockGeminiCliInternalUtilityRequests: false,
      },
      rules: [selectedRule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: 'gemini-3.1-pro-preview',
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gemini-3.1-pro-preview': {
            canonicalName: 'gemini-3.1-pro-preview',
            aliases: ['gemini-3.1-pro-preview'],
            sources: [],
            vendor: 'gemini' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => ({ id: 'site-nhh', name: 'nhh' })),
      getAccountById: vi.fn(() => ({ id: 'account-default', account_name: '默认账户' })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('geminiCli');
    vi.mocked(extractModelFromBody).mockReturnValue(null);
    vi.mocked(extractModelFromPath).mockReturnValue('gemini-2.5-flash-lite');
    vi.mocked(sortRules).mockReturnValue([selectedRule as never]);
    vi.mocked(findMatchingRule).mockImplementation((_rules, _cliType, model) =>
      model === 'gemini-3.1-pro-preview' ? (selectedRule as never) : null
    );
    vi.mocked(resolveChannels).mockReturnValue([channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://nhh.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...channel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 1,
      successRate: 1,
      updatedAt: 1,
    });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"candidates":[]}'),
    });

    const request = createJsonRequest(
      '/v1beta/models/gemini-2.5-flash-lite:generateContent?key=sk-route',
      {
        'x-goog-api-key': 'sk-route',
        'content-type': 'application/json',
      },
      { contents: [] }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(vi.mocked(findMatchingRule).mock.calls.map(call => call[2])).toEqual([
      'gemini-3.1-pro-preview',
    ]);
    expect(resolveChannels).toHaveBeenCalledWith(selectedRule, 'gemini-3.1-pro-preview');
    expect(httpRawRequest).toHaveBeenCalledWith(
      'https://nhh.example.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=sk-upstream',
      expect.objectContaining({
        method: 'POST',
        preferElectronNet: true,
      })
    );
    expect(response.statusCode).toBe(200);
  });

  it('routes normal Codex requests through the app-selected CLI model instead of the external request model', async () => {
    vi.clearAllMocks();

    const selectedRule = {
      id: 'rule-codex-selected',
      cliType: 'codex' as const,
      pattern: 'gpt-5-selected',
      patternType: 'exact' as const,
    };
    const channel = {
      routeRuleId: selectedRule.id,
      siteId: 'site-codex',
      accountId: 'account-default',
      apiKeyId: 'key-default',
      cliType: 'codex' as const,
      canonicalModel: 'gpt-5-selected',
      resolvedModel: 'gpt-5-selected-upstream',
    };
    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
        blockGeminiCliInternalUtilityRequests: true,
      },
      rules: [selectedRule],
      cliModelSelections: {
        claudeCode: null,
        codex: 'gpt-5-selected',
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gpt-5-selected': {
            canonicalName: 'gpt-5-selected',
            aliases: ['gpt-5-selected'],
            sources: [],
            vendor: 'gpt' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
      routePathStates: {},
    };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => ({ id: 'site-codex', name: 'codex-site' })),
      getAccountById: vi.fn(() => ({ id: 'account-default', account_name: '默认账户' })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-4o-from-external-config');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([selectedRule as never]);
    vi.mocked(findMatchingRule).mockImplementation((_rules, _cliType, model) =>
      model === 'gpt-5-selected' ? (selectedRule as never) : null
    );
    vi.mocked(resolveChannels).mockReturnValue([channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://codex.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...channel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 1,
      successRate: 1,
      updatedAt: 1,
    });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"id":"resp_1"}'),
    });

    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4o-from-external-config', input: 'hello' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(vi.mocked(findMatchingRule).mock.calls.map(call => call[2])).toEqual([
      'gpt-5-selected',
    ]);
    expect(resolveChannels).toHaveBeenCalledWith(selectedRule, 'gpt-5-selected');
    expect(httpRawRequest).toHaveBeenCalledWith(
      'https://codex.example.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        preferElectronNet: true,
      })
    );
    const forwardedBody = vi.mocked(httpRawRequest).mock.calls[0]?.[1]?.body;
    expect(JSON.parse(Buffer.from(forwardedBody as Buffer).toString('utf-8'))).toMatchObject({
      model: 'gpt-5-selected-upstream',
      input: 'hello',
    });
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedModel: 'gpt-4o-from-external-config',
        canonicalModel: 'gpt-5-selected',
        resolvedModel: 'gpt-5-selected-upstream',
      })
    );
    expect(response.statusCode).toBe(200);
  });

  it('blocks unmatched Gemini internal utility model requests with non-retryable 400 by default', async () => {
    vi.clearAllMocks();

    const selectedRule = {
      id: 'rule-gemini-selected',
      cliType: 'geminiCli' as const,
      pattern: 'gemini-3.1-pro-preview',
      patternType: 'exact' as const,
    };
    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [selectedRule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: 'gemini-3.1-pro-preview',
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gemini-3.1-pro-preview': {
            canonicalName: 'gemini-3.1-pro-preview',
            aliases: ['gemini-3.1-pro-preview'],
            sources: [],
            vendor: 'gemini' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(),
      getAccountById: vi.fn(),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('geminiCli');
    vi.mocked(extractModelFromBody).mockReturnValue(null);
    vi.mocked(extractModelFromPath).mockReturnValue('gemini-2.5-flash-lite');
    vi.mocked(sortRules).mockReturnValue([selectedRule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(null);

    const request = createJsonRequest(
      '/v1beta/models/gemini-2.5-flash-lite:generateContent?key=sk-route',
      {
        'x-goog-api-key': 'sk-route',
        'content-type': 'application/json',
      },
      { contents: [] }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: expect.objectContaining({
        code: 400,
        status: 'FAILED_PRECONDITION',
        message: expect.stringContaining('gemini_cli_internal_utility_blocked'),
      }),
    });
    expect(resolveChannels).not.toHaveBeenCalled();
    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        cliType: 'geminiCli',
        requestedModel: 'gemini-2.5-flash-lite',
        statusCode: 400,
        error: 'gemini_cli_internal_utility_blocked',
      })
    );
  });
});

describe('route-proxy-service successful path affinity', () => {
  it('starts with the recent successful path then wraps around after later candidates fail', async () => {
    vi.clearAllMocks();

    const now = Date.now();
    const rule = {
      id: 'rule-codex-affinity',
      cliType: 'codex' as const,
      pattern: 'gpt-4.1-mini',
      patternType: 'exact' as const,
    };
    const channelA = {
      routeRuleId: rule.id,
      siteId: 'site-a',
      accountId: 'account-a',
      apiKeyId: 'key-a',
      cliType: 'codex' as const,
      targetProtocol: 'native' as const,
      canonicalModel: 'gpt-4.1-mini',
      resolvedModel: 'gpt-4.1-mini',
    };
    const channelB = {
      ...channelA,
      siteId: 'site-b',
      accountId: 'account-b',
      apiKeyId: 'key-b',
    };
    const channelC = {
      ...channelA,
      siteId: 'site-c',
      accountId: 'account-c',
      apiKeyId: 'key-c',
    };
    const channelD = {
      ...channelA,
      siteId: 'site-d',
      accountId: 'account-d',
      apiKeyId: 'key-d',
    };
    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [rule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gpt-4.1-mini': {
            canonicalName: 'gpt-4.1-mini',
            aliases: ['gpt-4.1-mini'],
            sources: [],
            vendor: 'gpt' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
      routePathStates: {
        [buildRoutePathStateKey(channelC)]: {
          ...channelC,
          windowStartedAt: now,
          windowRequestCount: 1,
          windowSuccessCount: 1,
          successRate: 1,
          lastOutcome: 'success' as const,
          lastSuccessAt: now - 10_000,
          updatedAt: now - 10_000,
        },
      },
    };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn((siteId: string) => ({ id: siteId, name: siteId })),
      getAccountById: vi.fn((accountId: string) => ({ id: accountId, account_name: accountId })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-4.1-mini');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channelA, channelB, channelC, channelD]);
    vi.mocked(resolveChannelCredentials).mockImplementation(
      async (_siteId, _accountId, apiKeyId) => ({
        baseUrl: `https://${apiKeyId}.example.com`,
        apiKey: `sk-${apiKeyId}`,
      })
    );
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockImplementation(async (channel, outcome) => ({
      ...channel,
      windowStartedAt: now,
      windowRequestCount: 1,
      windowSuccessCount: outcome === 'success' ? 1 : 0,
      successRate: outcome === 'success' ? 1 : 0,
      lastOutcome: outcome,
      updatedAt: now,
    }));
    vi.mocked(httpRawRequest)
      .mockResolvedValueOnce({
        status: 503,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{"error":"preferred failed"}'),
      })
      .mockResolvedValueOnce({
        status: 503,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{"error":"later failed"}'),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{"ok":true}'),
      });

    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', input: 'hi' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(vi.mocked(resolveChannelCredentials).mock.calls.map(call => call[2])).toEqual([
      'key-c',
      'key-d',
      'key-a',
    ]);
    expect(vi.mocked(httpRawRequest).mock.calls.map(call => call[0])).toEqual([
      'https://key-c.example.com/v1/responses',
      'https://key-d.example.com/v1/responses',
      'https://key-a.example.com/v1/responses',
    ]);
    expect(httpRawRequest).toHaveBeenCalledTimes(3);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-c' }),
      'failure',
      expect.objectContaining({ statusCode: 503, error: 'preferred failed' }),
      expect.any(Object)
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-c',
        outcome: 'failure',
        statusCode: 503,
        error: 'preferred failed',
      })
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-a',
        outcome: 'success',
        statusCode: 200,
      })
    );
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-a' }),
      'success',
      expect.objectContaining({ statusCode: 200 }),
      expect.any(Object)
    );
  });

  it('does not promote a recent first-hit path after its api key is disabled', async () => {
    vi.clearAllMocks();

    const now = Date.now();
    const rule = {
      id: 'rule-codex-affinity',
      cliType: 'codex' as const,
      pattern: 'gpt-4.1-mini',
      patternType: 'exact' as const,
    };
    const channelA = {
      routeRuleId: rule.id,
      siteId: 'site-a',
      accountId: 'account-a',
      apiKeyId: 'key-a',
      cliType: 'codex' as const,
      targetProtocol: 'native' as const,
      canonicalModel: 'gpt-4.1-mini',
      resolvedModel: 'gpt-4.1-mini',
    };
    const disabledFirstHitChannel = {
      ...channelA,
      siteId: 'site-c',
      accountId: 'account-c',
      apiKeyId: 'key-c',
    };
    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [rule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gpt-4.1-mini': {
            canonicalName: 'gpt-4.1-mini',
            aliases: ['gpt-4.1-mini'],
            sources: [],
            vendor: 'gpt' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [
          {
            id: 'manual:gpt-4.1-mini',
            vendor: 'gpt' as const,
            canonicalName: 'gpt-4.1-mini',
            sourceKeys: [],
            originalModelOrder: ['gpt-4.1-mini'],
            priorityConfig: {
              sitePriorities: {
                'site-a': 0,
                'site-c': 1,
              },
              apiKeyPriorities: {
                [buildRouteApiKeyPriorityKey('site-a', 'account-a', 'key-a')]: 0,
                [buildRouteApiKeyPriorityKey('site-c', 'account-c', 'key-c')]: 0,
              },
              disabledApiKeyPriorityKeys: [
                buildRouteApiKeyPriorityKey('site-c', 'account-c', 'key-c'),
              ],
            },
            mode: 'manual' as const,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        vendorPriorities: {},
      },
      routePathStates: {
        [buildRoutePathStateKey(disabledFirstHitChannel)]: {
          ...disabledFirstHitChannel,
          windowStartedAt: now,
          windowRequestCount: 1,
          windowSuccessCount: 1,
          successRate: 1,
          lastOutcome: 'success' as const,
          lastSuccessAt: now - 10_000,
          updatedAt: now - 10_000,
        },
      },
    };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn((siteId: string) => ({ id: siteId, name: siteId })),
      getAccountById: vi.fn((accountId: string) => ({ id: accountId, account_name: accountId })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-4.1-mini');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channelA, disabledFirstHitChannel]);
    vi.mocked(resolveChannelCredentials).mockImplementation(
      async (_siteId, _accountId, apiKeyId) => ({
        baseUrl: `https://${apiKeyId}.example.com`,
        apiKey: `sk-${apiKeyId}`,
      })
    );
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockImplementation(async (channel, outcome) => ({
      ...channel,
      windowStartedAt: now,
      windowRequestCount: 1,
      windowSuccessCount: outcome === 'success' ? 1 : 0,
      successRate: outcome === 'success' ? 1 : 0,
      lastOutcome: outcome,
      updatedAt: now,
    }));
    vi.mocked(httpRawRequest).mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"ok":true}'),
    });

    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', input: 'hi' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(vi.mocked(resolveChannelCredentials).mock.calls.map(call => call[2])).toEqual(['key-a']);
    expect(vi.mocked(httpRawRequest).mock.calls.map(call => call[0])).toEqual([
      'https://key-a.example.com/v1/responses',
    ]);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });
});

describe('route-proxy-service disabled path short-circuit', () => {
  it('stops forwarding when a failed attempt disables the remaining planned route paths', async () => {
    vi.clearAllMocks();

    const rule = {
      id: 'rule-gemini',
      cliType: 'geminiCli' as const,
    };
    const channel = {
      routeRuleId: 'rule-gemini',
      siteId: 'site-duck',
      accountId: 'account-duck',
      apiKeyId: 'key-duck',
      cliType: 'geminiCli' as const,
      canonicalModel: 'duckcoding',
      resolvedModel: 'duckcoding',
    };
    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [rule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          duckcoding: {
            canonicalName: 'duckcoding',
            aliases: ['duckcoding'],
            sources: [],
            vendor: 'gemini' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [
          {
            id: 'manual:duckcoding',
            vendor: 'gemini' as const,
            canonicalName: 'duckcoding',
            sourceKeys: [],
            originalModelOrder: ['duckcoding'],
            priorityConfig: { sitePriorities: {}, apiKeyPriorities: {} },
            runtimeConfig: {
              maxAttemptsPerRoutePath: 2,
              successRateWindowMinutes: 5,
              disableDurationMinutes: 30,
              minSuccessRate: 0.8,
            },
            mode: 'manual' as const,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        vendorPriorities: {},
      },
    };
    let disabled = false;

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => undefined),
      getAccountById: vi.fn(() => undefined),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('geminiCli');
    vi.mocked(extractModelFromBody).mockReturnValue('duckcoding');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channel, channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://duckcoding.ai',
      apiKey: 'sk-upstream',
    });
    vi.mocked(isRoutePathDisabled).mockImplementation(() => disabled);
    vi.mocked(recordRoutePathOutcome).mockImplementation(async () => {
      disabled = true;
      return {
        ...channel,
        windowStartedAt: 1,
        windowRequestCount: 1,
        windowSuccessCount: 0,
        successRate: 0,
        disabledUntil: Date.now() + 30 * 60 * 1000,
        disabledReason: 'success_rate_below_threshold',
        lastOutcome: 'failure',
        lastStatusCode: 503,
        updatedAt: 1,
      };
    });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 503,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"error":"upstream_503"}'),
    });

    const request = createJsonRequest(
      '/v1beta/models/duckcoding:generateContent?key=sk-route',
      {
        'x-goog-api-key': 'sk-route',
        'content-type': 'application/json',
      },
      { contents: [] }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawRequest).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error: {
        code: 400,
        status: 'FAILED_PRECONDITION',
        message: expect.stringContaining('temporarily disabled'),
      },
    });
  });

  const disabledResponseCases: Array<{
    cliType: 'claudeCode' | 'codex' | 'geminiCli';
    url: string;
    headers: Record<string, string>;
    body: unknown;
    expectedBody: object;
  }> = [
    {
      cliType: 'claudeCode' as const,
      url: '/v1/messages',
      headers: { 'x-api-key': 'sk-route', 'content-type': 'application/json' },
      body: { model: 'disabled-route', messages: [] },
      expectedBody: {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: expect.stringContaining('temporarily disabled'),
        },
      },
    },
    {
      cliType: 'codex' as const,
      url: '/v1/responses',
      headers: { authorization: 'Bearer sk-route', 'content-type': 'application/json' },
      body: { model: 'disabled-route', input: [] },
      expectedBody: {
        error: {
          code: 'all_route_paths_disabled',
          type: 'invalid_request_error',
          message: expect.stringContaining('temporarily disabled'),
        },
      },
    },
    {
      cliType: 'geminiCli' as const,
      url: '/v1beta/models/disabled-route:generateContent?key=sk-route',
      headers: { 'x-goog-api-key': 'sk-route', 'content-type': 'application/json' },
      body: { contents: [] },
      expectedBody: {
        error: {
          code: 400,
          status: 'FAILED_PRECONDITION',
          message: expect.stringContaining('temporarily disabled'),
        },
      },
    },
  ];

  disabledResponseCases.forEach(testCase => {
    it(`returns a non-retryable ${testCase.cliType} error when all planned paths are disabled`, async () => {
      vi.clearAllMocks();

      const rule = {
        id: `rule-${testCase.cliType}`,
        cliType: testCase.cliType,
      };
      const channel = {
        routeRuleId: rule.id,
        siteId: 'site-disabled',
        accountId: 'account-disabled',
        apiKeyId: 'key-disabled',
        cliType: testCase.cliType,
        canonicalModel: 'disabled-route',
        resolvedModel: 'disabled-route',
      };
      const routing = {
        server: {
          unifiedApiKey: 'sk-route',
          requestTimeoutMs: 1000,
          upstreamProxyUrl: '',
        },
        rules: [rule],
        cliModelSelections: {
          claudeCode: null,
          codex: null,
          geminiCli: null,
        },
        modelRegistry: {
          version: 1,
          sources: [],
          entries: {
            'disabled-route': {
              canonicalName: 'disabled-route',
              aliases: ['disabled-route'],
              sources: [],
              vendor: 'openai' as const,
              hasOverride: false,
              createdAt: 1,
              updatedAt: 1,
            },
          },
          overrides: [],
          displayItems: [],
          vendorPriorities: {},
        },
      };

      Object.assign(unifiedConfigManager, {
        getRoutingConfig: vi.fn(() => routing),
        getSiteById: vi.fn(() => undefined),
        getAccountById: vi.fn(() => undefined),
      });
      vi.mocked(detectCliTypeFromPath).mockReturnValue(testCase.cliType);
      vi.mocked(extractModelFromBody).mockReturnValue('disabled-route');
      vi.mocked(extractModelFromPath).mockReturnValue(null);
      vi.mocked(sortRules).mockReturnValue([rule as never]);
      vi.mocked(findMatchingRule).mockReturnValue(rule as never);
      vi.mocked(resolveChannels).mockReturnValue([channel]);
      vi.mocked(isRoutePathDisabled).mockReturnValue(true);

      const request = createJsonRequest(testCase.url, testCase.headers, testCase.body);
      const response = createMockResponse();

      await handleRequest(request, response);

      expect(httpRawRequest).not.toHaveBeenCalled();
      expect(resolveChannelCredentials).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject(testCase.expectedBody);
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

describe('route-proxy-service probe lock', () => {
  it('allows loopback probe-lock requests to bypass disabled route paths and analytics side effects', async () => {
    vi.clearAllMocks();

    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gpt-4.1-mini': {
            canonicalName: 'gpt-4.1-mini',
            aliases: ['gpt-4.1-mini'],
            sources: [],
            vendor: 'gpt' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => undefined),
      getAccountById: vi.fn(() => undefined),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-4.1-mini');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(isRoutePathDisabled).mockReturnValue(true);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        '{"id":"resp_1","output":[{"content":[{"type":"output_text","text":"2"}]}]}'
      ),
    });

    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-1',
      cliType: 'codex',
      canonicalModel: 'gpt-4.1-mini',
      rawModel: 'gpt-4.1-mini',
      targetProtocol: 'openai-responses',
    });
    clearRouteProbeLockTerminalFailure(routeApiKey);
    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: `Bearer ${routeApiKey}`,
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', input: [] }
    );
    const response = createMockResponse();

    try {
      await handleRequest(request, response);
    } finally {
      clearRouteProbeLockTerminalFailure(routeApiKey);
    }

    expect(response.statusCode).toBe(200);
    expect(resolveChannelCredentials).toHaveBeenCalledWith('site-1', 'acc-1', 'key-1');
    expect(recordRouteRequest).not.toHaveBeenCalled();
    expect(recordRoutePathOutcome).not.toHaveBeenCalled();
    expect(httpRawRequest).toHaveBeenCalledTimes(1);
  });

  it('allows concurrent probe-lock upstream attempts up to the cap before any terminal result settles', async () => {
    vi.clearAllMocks();

    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gpt-4.1-mini': {
            canonicalName: 'gpt-4.1-mini',
            aliases: ['gpt-4.1-mini'],
            sources: [],
            vendor: 'gpt' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => undefined),
      getAccountById: vi.fn(() => undefined),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-4.1-mini');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });

    const resolvers: Array<(value: Awaited<ReturnType<typeof httpRawRequest>>) => void> = [];
    vi.mocked(httpRawRequest).mockImplementation(
      () =>
        new Promise(resolve => {
          resolvers.push(resolve);
        })
    );

    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-1',
      cliType: 'codex',
      canonicalModel: 'gpt-4.1-mini',
      rawModel: 'gpt-4.1-mini',
      targetProtocol: 'openai-responses',
    });
    clearRouteProbeLockTerminalFailure(routeApiKey);

    const makeRequest = () =>
      createJsonRequest(
        '/v1/responses',
        {
          authorization: `Bearer ${routeApiKey}`,
          'content-type': 'application/json',
        },
        { model: 'gpt-4.1-mini', input: [] }
      );

    const inflightHandles: Array<Promise<void>> = [];
    const inflightResponses: ReturnType<typeof createMockResponse>[] = [];

    try {
      // 在任何终结结果产生前并发发起达到上限数量的上游请求，全部允许转发。
      for (let i = 0; i < MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS; i += 1) {
        const res = createMockResponse();
        inflightResponses.push(res);
        inflightHandles.push(handleRequest(makeRequest(), res));
        await vi.waitFor(() => expect(httpRawRequest).toHaveBeenCalledTimes(i + 1));
      }

      expect(httpRawRequest).toHaveBeenCalledTimes(MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS);

      // 第 5 个请求超过上限：被预算拦截，不再访问上游。
      const cappedResponse = createMockResponse();
      await handleRequest(makeRequest(), cappedResponse);
      expect(httpRawRequest).toHaveBeenCalledTimes(MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS);
      expect(cappedResponse.statusCode).toBe(400);
      expect(cappedResponse.body).toContain('probe_lock_upstream_attempt_exhausted');

      for (const resolve of resolvers) {
        resolve({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: Buffer.from(
            '{"id":"resp_1","output":[{"content":[{"type":"output_text","text":"2"}]}]}'
          ),
        });
      }
      await Promise.all(inflightHandles);

      expect(getRouteProbeLockFirstUpstreamResult(routeApiKey)).toMatchObject({
        routeApiKey,
        cliType: 'codex',
        statusCode: 200,
        success: true,
        responseSummary: expect.stringContaining('"text":"2"'),
      });
    } finally {
      clearRouteProbeLockTerminalFailure(routeApiKey);
    }

    for (const res of inflightResponses) {
      expect(res.statusCode).toBe(200);
    }
  });

  it('does not spend the probe-lock upstream attempt on Claude count_tokens requests', async () => {
    vi.clearAllMocks();

    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'claude-sonnet-4-6': {
            canonicalName: 'claude-sonnet-4-6',
            aliases: ['claude-sonnet-4-6'],
            sources: [],
            vendor: 'claude' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => undefined),
      getAccountById: vi.fn(() => undefined),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('claudeCode');
    vi.mocked(extractModelFromBody).mockReturnValue('claude-sonnet-4-6');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(httpRawStreamRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: Buffer.from('event: message_delta\ndata: {"delta":{"text":"2"}}\n\n'),
    });

    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-1',
      cliType: 'claudeCode',
      canonicalModel: 'claude-sonnet-4-6',
      rawModel: 'claude-sonnet-4-6',
    });
    clearRouteProbeLockTerminalFailure(routeApiKey);
    const countTokensRequest = createJsonRequest(
      '/v1/messages/count_tokens',
      {
        'x-api-key': routeApiKey,
        'content-type': 'application/json',
      },
      { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hello' }] }
    );
    const mainRequest = createJsonRequest(
      '/v1/messages?beta=true',
      {
        'x-api-key': routeApiKey,
        'content-type': 'application/json',
      },
      { model: 'claude-sonnet-4-6', stream: true, messages: [] }
    );
    const countTokensResponse = createMockResponse();
    const mainResponse = createMockResponse();

    try {
      await handleRequest(countTokensRequest, countTokensResponse);
      await handleRequest(mainRequest, mainResponse);
    } finally {
      clearRouteProbeLockTerminalFailure(routeApiKey);
    }

    expect(countTokensResponse.statusCode).toBe(200);
    expect(JSON.parse(countTokensResponse.body)).toEqual({
      input_tokens: expect.any(Number),
    });
    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(httpRawStreamRequest).toHaveBeenCalledTimes(1);
    expect(mainResponse.statusCode).toBe(200);
  });

  it('passes a transient probe-lock upstream failure through to the CLI without settling or terminal-failure', async () => {
    vi.clearAllMocks();

    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'claude-sonnet-4-6': {
            canonicalName: 'claude-sonnet-4-6',
            aliases: ['claude-sonnet-4-6'],
            sources: [],
            vendor: 'claude' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };
    const transientError = JSON.stringify({
      error: {
        type: 'bad_response_status_code',
        message: 'bad response status code 503 (request id: req-503)',
      },
      type: 'error',
    });

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => undefined),
      getAccountById: vi.fn(() => undefined),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('claudeCode');
    vi.mocked(extractModelFromBody).mockReturnValue('claude-sonnet-4-6');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(httpRawStreamRequest).mockResolvedValue({
      status: 503,
      headers: { 'content-type': 'text/event-stream' },
      body: Buffer.from(transientError),
      firstByteLatencyMs: 3,
    });

    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-1',
      cliType: 'claudeCode',
      canonicalModel: 'claude-sonnet-4-6',
      rawModel: 'claude-sonnet-4-6',
    });
    clearRouteProbeLockTerminalFailure(routeApiKey);
    const failures: unknown[] = [];
    const unsubscribe = subscribeRouteProbeLockTerminalFailure(routeApiKey, failure => {
      failures.push(failure);
    });
    const request = createJsonRequest(
      '/v1/messages?beta=true',
      {
        'x-api-key': routeApiKey,
        'content-type': 'application/json',
      },
      { model: 'claude-sonnet-4-6', stream: true, messages: [] }
    );
    const response = createMockResponse();
    const retryRequest = createJsonRequest(
      '/v1/messages?beta=true',
      {
        'x-api-key': routeApiKey,
        'content-type': 'application/json',
      },
      { model: 'claude-sonnet-4-6', stream: true, messages: [] }
    );
    const retryResponse = createMockResponse();

    let recordedAfterRequests: ReturnType<typeof getRouteProbeLockFirstUpstreamResult>;
    try {
      await handleRequest(request, response);
      await handleRequest(retryRequest, retryResponse);
      recordedAfterRequests = getRouteProbeLockFirstUpstreamResult(routeApiKey);
    } finally {
      unsubscribe();
      clearRouteProbeLockTerminalFailure(routeApiKey);
    }

    // 瞬时 503 未达上限：不发终结失败、不消耗预算，把原始上游响应透传给 CLI；后续请求可继续到达上游。
    expect(failures).toEqual([]);
    // 记录一个可被后续成功/终结失败覆盖的非终结结果（保留失败原因），避免单发不重试的 CLI 丢失原因。
    expect(recordedAfterRequests).toMatchObject({
      success: false,
      statusCode: 503,
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(transientError);
    expect(response.headers).toMatchObject({ 'content-type': 'text/event-stream' });
    expect(retryResponse.statusCode).toBe(503);
    expect(httpRawStreamRequest).toHaveBeenCalledTimes(2);
  });

  it('passes a non-native targetProtocol transient probe-lock failure through raw without transform escalation', async () => {
    vi.clearAllMocks();

    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'claude-sonnet-4-6': {
            canonicalName: 'claude-sonnet-4-6',
            aliases: ['claude-sonnet-4-6'],
            sources: [],
            vendor: 'claude' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };
    // chat-completions 风格的 503 错误体；若被 response 转换劫持会改变内容或抛错升级为终结失败。
    const transientError = JSON.stringify({
      error: { message: 'upstream busy', type: 'server_error', code: 503 },
    });

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => undefined),
      getAccountById: vi.fn(() => undefined),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('claudeCode');
    vi.mocked(extractModelFromBody).mockReturnValue('claude-sonnet-4-6');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 503,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(transientError),
    });

    // 非原生目标协议：claudeCode -> openai-chat-completions，强制走 cli-protocol-adapter。
    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-1',
      cliType: 'claudeCode',
      canonicalModel: 'claude-sonnet-4-6',
      rawModel: 'claude-sonnet-4-6',
      targetProtocol: 'openai-chat-completions',
    });
    clearRouteProbeLockTerminalFailure(routeApiKey);
    const failures: unknown[] = [];
    const unsubscribe = subscribeRouteProbeLockTerminalFailure(routeApiKey, failure => {
      failures.push(failure);
    });
    const buildRequest = () =>
      createJsonRequest(
        '/v1/messages',
        {
          'x-api-key': routeApiKey,
          'content-type': 'application/json',
        },
        { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hello' }] }
      );
    const response = createMockResponse();
    const retryResponse = createMockResponse();

    let recordedAfterRequests: ReturnType<typeof getRouteProbeLockFirstUpstreamResult>;
    try {
      await handleRequest(buildRequest(), response);
      await handleRequest(buildRequest(), retryResponse);
      recordedAfterRequests = getRouteProbeLockFirstUpstreamResult(routeApiKey);
    } finally {
      unsubscribe();
      clearRouteProbeLockTerminalFailure(routeApiKey);
    }

    // 瞬时失败直接透传原始上游响应，不被协议转换劫持成终结失败；预算保持开放。
    expect(failures).toEqual([]);
    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(transientError);
    expect(recordedAfterRequests).toMatchObject({ success: false, statusCode: 503 });
    expect(httpRawRequest).toHaveBeenCalledTimes(2);
  });

  it('records a non-terminal result for a transient network exception and lets a later success overwrite it', async () => {
    vi.clearAllMocks();

    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gpt-4.1-mini': {
            canonicalName: 'gpt-4.1-mini',
            aliases: ['gpt-4.1-mini'],
            sources: [],
            vendor: 'gpt' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => undefined),
      getAccountById: vi.fn(() => undefined),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-4.1-mini');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
    // 第一次上游抛网络异常(无 statusCode)，第二次返回成功。
    vi.mocked(httpRawRequest)
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(
          '{"id":"resp_1","output":[{"content":[{"type":"output_text","text":"2"}]}]}'
        ),
      });

    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-1',
      cliType: 'codex',
      canonicalModel: 'gpt-4.1-mini',
      rawModel: 'gpt-4.1-mini',
      targetProtocol: 'openai-responses',
    });
    clearRouteProbeLockTerminalFailure(routeApiKey);
    const failures: unknown[] = [];
    const unsubscribe = subscribeRouteProbeLockTerminalFailure(routeApiKey, failure => {
      failures.push(failure);
    });
    const buildRequest = () =>
      createJsonRequest(
        '/v1/responses',
        {
          authorization: `Bearer ${routeApiKey}`,
          'content-type': 'application/json',
        },
        { model: 'gpt-4.1-mini', input: [] }
      );
    const firstResponse = createMockResponse();
    const secondResponse = createMockResponse();

    let recordedAfterNetworkError: ReturnType<typeof getRouteProbeLockFirstUpstreamResult>;
    let recordedAfterSuccess: ReturnType<typeof getRouteProbeLockFirstUpstreamResult>;
    try {
      await handleRequest(buildRequest(), firstResponse);
      recordedAfterNetworkError = getRouteProbeLockFirstUpstreamResult(routeApiKey);
      await handleRequest(buildRequest(), secondResponse);
      recordedAfterSuccess = getRouteProbeLockFirstUpstreamResult(routeApiKey);
    } finally {
      unsubscribe();
      clearRouteProbeLockTerminalFailure(routeApiKey);
    }

    // 瞬时网络异常未达上限：记录可被覆盖的非终结结果(保留原因)、不发终结失败、预算保持开放。
    expect(failures).toEqual([]);
    expect(recordedAfterNetworkError).toMatchObject({
      success: false,
      statusCode: 502,
      error: 'ECONNRESET',
    });
    // 后续成功(终值)覆盖瞬时结果，是 wrapper supported=true 的依据。
    expect(recordedAfterSuccess).toMatchObject({ success: true, statusCode: 200 });
    expect(secondResponse.statusCode).toBe(200);
    expect(httpRawRequest).toHaveBeenCalledTimes(2);
  });

  it('treats a terminal probe-lock upstream failure (401) as an immediate terminal failure', async () => {
    vi.clearAllMocks();

    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'claude-sonnet-4-6': {
            canonicalName: 'claude-sonnet-4-6',
            aliases: ['claude-sonnet-4-6'],
            sources: [],
            vendor: 'claude' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };
    const terminalError = JSON.stringify({
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
      type: 'error',
    });

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => undefined),
      getAccountById: vi.fn(() => undefined),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('claudeCode');
    vi.mocked(extractModelFromBody).mockReturnValue('claude-sonnet-4-6');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(httpRawStreamRequest).mockResolvedValue({
      status: 401,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(terminalError),
      firstByteLatencyMs: 3,
    });

    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-1',
      cliType: 'claudeCode',
      canonicalModel: 'claude-sonnet-4-6',
      rawModel: 'claude-sonnet-4-6',
    });
    clearRouteProbeLockTerminalFailure(routeApiKey);
    const failures: unknown[] = [];
    const unsubscribe = subscribeRouteProbeLockTerminalFailure(routeApiKey, failure => {
      failures.push(failure);
    });
    const request = createJsonRequest(
      '/v1/messages?beta=true',
      {
        'x-api-key': routeApiKey,
        'content-type': 'application/json',
      },
      { model: 'claude-sonnet-4-6', stream: true, messages: [] }
    );
    const response = createMockResponse();
    const retryRequest = createJsonRequest(
      '/v1/messages?beta=true',
      {
        'x-api-key': routeApiKey,
        'content-type': 'application/json',
      },
      { model: 'claude-sonnet-4-6', stream: true, messages: [] }
    );
    const retryResponse = createMockResponse();

    try {
      await handleRequest(request, response);
      await handleRequest(retryRequest, retryResponse);
    } finally {
      unsubscribe();
      clearRouteProbeLockTerminalFailure(routeApiKey);
    }

    expect(failures).toEqual([
      expect.objectContaining({
        routeApiKey,
        cliType: 'claudeCode',
        statusCode: 401,
        terminalError,
      }),
    ]);
    expect(response.statusCode).toBe(401);
    // 终结失败已缓存：后续 probe-lock 请求重放缓存的终结状态/响应体，不再访问上游。
    expect(retryResponse.statusCode).toBe(401);
    expect(retryResponse.body).toBe(terminalError);
    expect(httpRawStreamRequest).toHaveBeenCalledTimes(1);
  });

  it('settles the probe-lock budget on the first success and blocks later upstream attempts', async () => {
    vi.clearAllMocks();

    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gpt-4.1-mini': {
            canonicalName: 'gpt-4.1-mini',
            aliases: ['gpt-4.1-mini'],
            sources: [],
            vendor: 'gpt' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => undefined),
      getAccountById: vi.fn(() => undefined),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-4.1-mini');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        '{"id":"resp_1","output":[{"content":[{"type":"output_text","text":"2"}]}]}'
      ),
    });

    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-1',
      cliType: 'codex',
      canonicalModel: 'gpt-4.1-mini',
      rawModel: 'gpt-4.1-mini',
      targetProtocol: 'openai-responses',
    });
    clearRouteProbeLockTerminalFailure(routeApiKey);
    const firstRequest = createJsonRequest(
      '/v1/responses',
      {
        authorization: `Bearer ${routeApiKey}`,
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', input: [] }
    );
    const secondRequest = createJsonRequest(
      '/v1/responses',
      {
        authorization: `Bearer ${routeApiKey}`,
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', input: [] }
    );
    const firstResponse = createMockResponse();
    const secondResponse = createMockResponse();

    try {
      await handleRequest(firstRequest, firstResponse);
      expect(firstResponse.statusCode).toBe(200);
      expect(getRouteProbeLockFirstUpstreamResult(routeApiKey)).toMatchObject({
        routeApiKey,
        cliType: 'codex',
        statusCode: 200,
        success: true,
      });

      await handleRequest(secondRequest, secondResponse);
    } finally {
      clearRouteProbeLockTerminalFailure(routeApiKey);
    }

    expect(secondResponse.statusCode).toBe(400);
    expect(secondResponse.body).toContain('probe_lock_upstream_attempt_exhausted');
    expect(httpRawRequest).toHaveBeenCalledTimes(1);
  });

  it('escalates repeated transient probe-lock failures to terminal at the attempt cap', async () => {
    vi.clearAllMocks();

    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gpt-4.1-mini': {
            canonicalName: 'gpt-4.1-mini',
            aliases: ['gpt-4.1-mini'],
            sources: [],
            vendor: 'gpt' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => undefined),
      getAccountById: vi.fn(() => undefined),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-4.1-mini');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 429,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"error":{"type":"rate_limit","message":"slow down"}}'),
    });

    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-1',
      cliType: 'codex',
      canonicalModel: 'gpt-4.1-mini',
      rawModel: 'gpt-4.1-mini',
      targetProtocol: 'openai-responses',
    });
    clearRouteProbeLockTerminalFailure(routeApiKey);
    const failures: RouteProbeLockTerminalFailure[] = [];
    const unsubscribe = subscribeRouteProbeLockTerminalFailure(routeApiKey, failure => {
      failures.push(failure);
    });

    try {
      // 连续 4 次瞬时 429：前 3 次透传不通知，第 4 次(上限)升级为终结失败。
      for (let i = 0; i < MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS; i += 1) {
        const request = createJsonRequest(
          '/v1/responses',
          {
            authorization: `Bearer ${routeApiKey}`,
            'content-type': 'application/json',
          },
          { model: 'gpt-4.1-mini', input: [] }
        );
        await handleRequest(request, createMockResponse());
      }
    } finally {
      unsubscribe();
      clearRouteProbeLockTerminalFailure(routeApiKey);
    }

    expect(httpRawRequest).toHaveBeenCalledTimes(MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS);
    expect(failures).toHaveLength(1);
    expect(failures[0].statusCode).toBe(429);
    expect(failures[0].terminalError).toContain('upstream temporarily unavailable');
    expect(failures[0].terminalError).toContain(
      `retried ${MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS} times`
    );
  });

  it('rejects non-loopback probe-lock requests', async () => {
    vi.clearAllMocks();

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({
        server: {
          unifiedApiKey: 'sk-route',
          requestTimeoutMs: 1000,
          upstreamProxyUrl: '',
        },
        rules: [],
        cliModelSelections: {
          claudeCode: null,
          codex: null,
          geminiCli: null,
        },
        modelRegistry: {
          version: 1,
          sources: [],
          entries: {},
          overrides: [],
          displayItems: [],
          vendorPriorities: {},
        },
      })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('claudeCode');

    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-1',
      cliType: 'claudeCode',
      canonicalModel: 'claude-sonnet-4',
      rawModel: 'claude-sonnet-4',
    });
    const request = createJsonRequest(
      '/v1/messages',
      {
        'x-api-key': routeApiKey,
        'content-type': 'application/json',
      },
      { model: 'claude-sonnet-4', messages: [] }
    );
    Object.defineProperty(request, 'socket', {
      value: { remoteAddress: '10.0.0.9' },
    });
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toMatchObject({
      error: 'probe_lock_forbidden',
    });
  });
});

describe('route-proxy-service SSE streaming passthrough', () => {
  it('forwards successful transparent SSE responses chunk-by-chunk', async () => {
    vi.clearAllMocks();

    const rule = {
      id: 'rule-codex-stream',
      cliType: 'codex' as const,
      pattern: 'gpt-4.1-mini',
      patternType: 'exact' as const,
    };
    const channel = {
      routeRuleId: rule.id,
      siteId: 'site-openai',
      accountId: 'account-openai',
      apiKeyId: 'key-openai',
      cliType: 'codex' as const,
      canonicalModel: 'gpt-4.1-mini',
      resolvedModel: 'gpt-4.1-mini',
    };
    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [rule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gpt-4.1-mini': {
            canonicalName: 'gpt-4.1-mini',
            aliases: ['gpt-4.1-mini'],
            sources: [],
            vendor: 'openai' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };
    const chunks = [
      Buffer.from('data: {"usage":{"prompt_tokens":5}}\n\n'),
      Buffer.from(
        'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"completion_tokens":7,"total_tokens":12}}}\n\n'
      ),
    ];
    const upstreamHeaders = {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'content-encoding': 'br',
      'content-length': '999',
      'transfer-encoding': 'chunked',
    };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => ({ id: 'site-openai', name: 'OpenAI-compatible' })),
      getAccountById: vi.fn(() => ({ id: 'account-openai', account_name: 'default' })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-4.1-mini');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...channel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 1,
      successRate: 1,
      updatedAt: 1,
    });
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      const accepted = config.onResponse?.({
        status: 200,
        statusText: 'OK',
        headers: upstreamHeaders,
      });
      expect(accepted).toBe(true);
      expect(response.writeHead).not.toHaveBeenCalled();

      for (const chunk of chunks) {
        await config.onChunk?.(chunk);
      }

      return {
        status: 200,
        headers: upstreamHeaders,
        body: Buffer.concat(chunks),
        firstByteLatencyMs: 3,
      };
    });

    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', stream: true, input: 'hi' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawStreamRequest).toHaveBeenCalledWith(
      'https://upstream.example.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        preferElectronNet: true,
        timeout: 1000,
        streamIdleTimeout: 600000,
      })
    );
    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(response.writeHead).toHaveBeenCalledWith(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    });
    expect(response.headers).not.toHaveProperty('content-length');
    expect(response.headers).not.toHaveProperty('content-encoding');
    expect(response.headers).not.toHaveProperty('transfer-encoding');
    expect(response.write).toHaveBeenCalledTimes(2);
    expect(response.writeHead.mock.invocationCallOrder[0]).toBeLessThan(
      response.write.mock.invocationCallOrder[0]
    );
    expect(response.body).toBe(Buffer.concat(chunks).toString('utf-8'));
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(response.writableEnded).toBe(true);
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        cliType: 'codex',
        outcome: 'success',
        statusCode: 200,
        firstByteLatencyMs: 3,
        promptTokens: 5,
        completionTokens: 7,
        totalTokens: 12,
      })
    );
  });

  it('accepts a large completed SSE chunk when the terminal marker is outside the retained scan tail', async () => {
    vi.clearAllMocks();

    const rule = {
      id: 'rule-codex-stream',
      cliType: 'codex' as const,
      pattern: 'gpt-4.1-mini',
      patternType: 'exact' as const,
    };
    const channel = {
      routeRuleId: rule.id,
      siteId: 'site-openai',
      accountId: 'account-openai',
      apiKeyId: 'key-openai',
      cliType: 'codex' as const,
      canonicalModel: 'gpt-4.1-mini',
      resolvedModel: 'gpt-4.1-mini',
    };
    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [rule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gpt-4.1-mini': {
            canonicalName: 'gpt-4.1-mini',
            aliases: ['gpt-4.1-mini'],
            sources: [],
            vendor: 'openai' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };
    const terminalEvent =
      'event: response.completed\ndata: {"type":"response.completed","response":{}}\n\n';
    const largeCompletedChunk = Buffer.from(`${terminalEvent}: ${'x'.repeat(9000)}\n\n`);
    const upstreamHeaders = { 'content-type': 'text/event-stream; charset=utf-8' };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => ({ id: 'site-openai', name: 'OpenAI-compatible' })),
      getAccountById: vi.fn(() => ({ id: 'account-openai', account_name: 'default' })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-4.1-mini');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...channel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 1,
      successRate: 1,
      updatedAt: 1,
    });
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      const accepted = config.onResponse?.({
        status: 200,
        statusText: 'OK',
        headers: upstreamHeaders,
      });
      expect(accepted).toBe(true);

      await config.onChunk?.(largeCompletedChunk);
      return {
        status: 200,
        headers: upstreamHeaders,
        body: largeCompletedChunk,
        firstByteLatencyMs: 3,
      };
    });

    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', stream: true, input: 'hi' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(largeCompletedChunk.toString('utf-8'));
    expect(response.body).not.toContain('event: error');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-openai' }),
      'success',
      expect.objectContaining({ statusCode: 200 }),
      expect.any(Object)
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-openai',
        outcome: 'success',
        statusCode: 200,
      })
    );
  });

  it('rejects malformed 2xx streaming chunks before downstream writes and falls back', async () => {
    vi.clearAllMocks();

    const rule = {
      id: 'rule-codex-stream',
      cliType: 'codex' as const,
      pattern: 'gpt-4.1-mini',
      patternType: 'exact' as const,
    };
    const firstChannel = {
      routeRuleId: rule.id,
      siteId: 'site-first',
      accountId: 'account-first',
      apiKeyId: 'key-first',
      cliType: 'codex' as const,
      canonicalModel: 'gpt-4.1-mini',
      resolvedModel: 'gpt-4.1-mini',
    };
    const secondChannel = {
      routeRuleId: rule.id,
      siteId: 'site-second',
      accountId: 'account-second',
      apiKeyId: 'key-second',
      cliType: 'codex' as const,
      canonicalModel: 'gpt-4.1-mini',
      resolvedModel: 'gpt-4.1-mini',
    };
    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [rule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gpt-4.1-mini': {
            canonicalName: 'gpt-4.1-mini',
            aliases: ['gpt-4.1-mini'],
            sources: [],
            vendor: 'openai' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };
    const malformedChunk = Buffer.from(
      '<!doctype html><html><body>Service Unavailable</body></html>'
    );
    const successChunk = Buffer.from(
      'event: response.completed\ndata: {"type":"response.completed","response":{}}\n\n'
    );
    let attempt = 0;

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => undefined),
      getAccountById: vi.fn(() => undefined),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-4.1-mini');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([firstChannel, secondChannel]);
    vi.mocked(resolveChannelCredentials).mockImplementation(
      async (_siteId, _accountId, apiKeyId) =>
        apiKeyId === 'key-first'
          ? { baseUrl: 'https://first.example.com', apiKey: 'sk-first' }
          : { baseUrl: 'https://second.example.com', apiKey: 'sk-second' }
    );
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...firstChannel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 1,
      successRate: 1,
      updatedAt: 1,
    });
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      attempt += 1;
      const headers = { 'content-type': 'text/event-stream' };
      const accepted = config.onResponse?.({ status: 200, statusText: 'OK', headers });
      expect(accepted).toBe(true);

      if (attempt === 1) {
        expect(response.writeHead).not.toHaveBeenCalled();
        await config.onChunk?.(malformedChunk);
        throw new Error('expected malformed streaming chunk to be rejected');
      }

      await config.onChunk?.(successChunk);
      return {
        status: 200,
        headers,
        body: successChunk,
        firstByteLatencyMs: 4,
      };
    });

    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', stream: true, input: 'hi' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(vi.mocked(httpRawStreamRequest).mock.calls.map(call => call[0])).toEqual([
      'https://first.example.com/v1/responses',
      'https://second.example.com/v1/responses',
    ]);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(successChunk.toString('utf-8'));
    expect(response.body).not.toContain('Service Unavailable');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-first' }),
      'failure',
      expect.objectContaining({ error: 'invalid_streaming_response:html_response' }),
      expect.any(Object)
    );
  });

  it('surfaces an error when a transparent stream ends before a terminal SSE event', async () => {
    vi.clearAllMocks();

    const rule = {
      id: 'rule-codex-stream',
      cliType: 'codex' as const,
      pattern: 'gpt-4.1-mini',
      patternType: 'exact' as const,
    };
    const channel = {
      routeRuleId: rule.id,
      siteId: 'site-openai',
      accountId: 'account-openai',
      apiKeyId: 'key-openai',
      cliType: 'codex' as const,
      canonicalModel: 'gpt-4.1-mini',
      resolvedModel: 'gpt-4.1-mini',
    };
    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [rule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gpt-4.1-mini': {
            canonicalName: 'gpt-4.1-mini',
            aliases: ['gpt-4.1-mini'],
            sources: [],
            vendor: 'openai' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };
    const incompleteChunk = Buffer.from(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial"}\n\n'
    );

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => ({ id: 'site-openai', name: 'OpenAI-compatible' })),
      getAccountById: vi.fn(() => ({ id: 'account-openai', account_name: 'default' })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-4.1-mini');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...channel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 0,
      successRate: 0,
      updatedAt: 1,
    });
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      const headers = { 'content-type': 'text/event-stream' };
      const accepted = config.onResponse?.({ status: 200, statusText: 'OK', headers });
      expect(accepted).toBe(true);
      await config.onChunk?.(incompleteChunk);
      return {
        status: 200,
        headers,
        body: incompleteChunk,
        firstByteLatencyMs: 4,
      };
    });

    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', stream: true, input: 'hi' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('response.output_text.delta');
    expect(response.body).toContain('event: error');
    expect(response.body).toContain('upstream stream ended before terminal SSE event');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-openai' }),
      'failure',
      expect.objectContaining({
        error: 'incomplete_streaming_response:missing_terminal_event',
      }),
      expect.any(Object)
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-openai',
        outcome: 'failure',
        error: 'incomplete_streaming_response:missing_terminal_event',
      })
    );
  });

  it('preserves Claude Code tools when streaming through AnyRouter', async () => {
    vi.clearAllMocks();

    const validHash = 'a'.repeat(64);
    const rule = {
      id: 'rule-claude-anyrouter',
      cliType: 'claudeCode' as const,
      pattern: 'claude-opus-4-6',
      patternType: 'exact' as const,
    };
    const channel = {
      routeRuleId: rule.id,
      siteId: 'site-anyrouter',
      accountId: 'account-anyrouter',
      apiKeyId: 'key-anyrouter',
      cliType: 'claudeCode' as const,
      canonicalModel: 'claude-opus-4-6',
      resolvedModel: 'claude-opus-4-6',
    };
    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [rule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'claude-opus-4-6': {
            canonicalName: 'claude-opus-4-6',
            aliases: ['claude-opus-4-6'],
            sources: [],
            vendor: 'claude' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };
    const successChunk = buildClaudeTextSse('ready');
    let upstreamBody: Record<string, unknown> | undefined;
    let upstreamHeaders: Record<string, string | string[] | undefined> | undefined;

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => ({ id: 'site-anyrouter', name: 'AnyRouter' })),
      getAccountById: vi.fn(() => ({
        id: 'account-anyrouter',
        account_name: 'anyrouter-account',
        anyRouterConfig: { userHash: validHash },
      })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('claudeCode');
    vi.mocked(extractModelFromBody).mockReturnValue('claude-opus-4-6');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://anyrouter.top',
      apiKey: 'sk-upstream',
    });
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...channel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 1,
      successRate: 1,
      updatedAt: 1,
    });
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      upstreamHeaders = config.headers;
      upstreamBody = JSON.parse(
        Buffer.isBuffer(config.body) ? config.body.toString('utf-8') : String(config.body)
      );
      const accepted = config.onResponse?.({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/event-stream' },
      });
      expect(accepted).toBe(true);
      await config.onChunk?.(successChunk);
      return {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: successChunk,
        firstByteLatencyMs: 5,
      };
    });

    const request = createJsonRequest(
      '/v1/messages',
      {
        'x-api-key': 'sk-route',
        'content-type': 'application/json',
        'anthropic-beta': 'existing-beta',
      },
      {
        model: 'claude-opus-4-6',
        stream: true,
        messages: [{ role: 'user', content: 'inspect files' }],
        system: [{ type: 'text', text: 'Original Claude Code system prompt' }],
        tools: [
          {
            name: 'Read',
            description: 'Read a file',
            input_schema: { type: 'object', properties: { file_path: { type: 'string' } } },
          },
        ],
        tool_choice: { type: 'auto' },
        stop_sequences: ['stop-here'],
        temperature: 0.2,
        metadata: { source: 'claude-code' },
      }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawStreamRequest).toHaveBeenCalledWith(
      'https://anyrouter.top/v1/messages?beta=true',
      expect.objectContaining({
        method: 'POST',
        preferElectronNet: true,
        timeout: 120000,
        streamIdleTimeout: 600000,
      })
    );
    expect(upstreamHeaders?.['x-api-key']).toBe('sk-upstream');
    expect(String(upstreamHeaders?.['anthropic-beta'])).toContain('existing-beta');
    expect(String(upstreamHeaders?.['anthropic-beta'])).toContain('context-1m-2025-08-07');
    expect(upstreamBody).toMatchObject({
      model: 'claude-opus-4-6',
      stream: true,
      messages: [{ role: 'user', content: 'inspect files' }],
      system: [{ type: 'text', text: 'Original Claude Code system prompt' }],
      tools: [
        {
          name: 'Read',
          description: 'Read a file',
          input_schema: { type: 'object', properties: { file_path: { type: 'string' } } },
        },
      ],
      tool_choice: { type: 'auto' },
      stop_sequences: ['stop-here'],
      temperature: 0.2,
      metadata: expect.objectContaining({
        source: 'claude-code',
        user_id: expect.stringMatching(/^user_[a-f0-9]{64}_account__session_/),
      }),
    });
    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(successChunk.toString('utf-8'));
  });

  it('surfaces an error when Claude Code transparent SSE leaks DSML tool markup', async () => {
    vi.clearAllMocks();

    const rule = {
      id: 'rule-claude-stream',
      cliType: 'claudeCode' as const,
      pattern: 'claude-opus-4-6',
      patternType: 'exact' as const,
    };
    const channel = {
      routeRuleId: rule.id,
      siteId: 'site-claude',
      accountId: 'account-claude',
      apiKeyId: 'key-claude',
      cliType: 'claudeCode' as const,
      canonicalModel: 'claude-opus-4-6',
      resolvedModel: 'claude-opus-4-6',
    };
    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [rule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'claude-opus-4-6': {
            canonicalName: 'claude-opus-4-6',
            aliases: ['claude-opus-4-6'],
            sources: [],
            vendor: 'claude' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };
    const leakedMarkupChunk = Buffer.from(
      [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_bad","type":"message","role":"assistant","model":"claude-opus-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"</ | DSML | parameter>\\n</ | DSML | invoke>\\n</ | DSML | tool_calls>"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        '',
      ].join('\n'),
      'utf-8'
    );
    const terminalChunk = Buffer.from(
      [
        'event: message_delta',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
        '',
      ].join('\n'),
      'utf-8'
    );

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => ({ id: 'site-claude', name: 'Claude-compatible' })),
      getAccountById: vi.fn(() => ({ id: 'account-claude', account_name: 'default' })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('claudeCode');
    vi.mocked(extractModelFromBody).mockReturnValue('claude-opus-4-6');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...channel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 0,
      successRate: 0,
      updatedAt: 1,
    });
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      const headers = { 'content-type': 'text/event-stream' };
      const accepted = config.onResponse?.({ status: 200, statusText: 'OK', headers });
      expect(accepted).toBe(true);
      await config.onChunk?.(leakedMarkupChunk);
      await config.onChunk?.(terminalChunk);
      return {
        status: 200,
        headers,
        body: Buffer.concat([leakedMarkupChunk, terminalChunk]),
        firstByteLatencyMs: 4,
      };
    });

    const request = createJsonRequest(
      '/v1/messages?beta=true',
      {
        'x-api-key': 'sk-route',
        'content-type': 'application/json',
      },
      { model: 'claude-opus-4-6', stream: true, messages: [{ role: 'user', content: 'edit' }] }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('</ | DSML | tool_calls>');
    expect(response.body).toContain('event: error');
    expect(response.body).toContain('non-Anthropic tool markup');
    expect(response.body).not.toContain('event: message_stop');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-claude' }),
      'failure',
      expect.objectContaining({
        error: 'malformed_streaming_response:foreign_dsml_tool_markup',
      }),
      expect.any(Object)
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-claude',
        outcome: 'failure',
        error: 'malformed_streaming_response:foreign_dsml_tool_markup',
      })
    );
  });

  it('surfaces an error when Claude Code transparent SSE ends after thinking only', async () => {
    vi.clearAllMocks();

    const rule = {
      id: 'rule-claude-thinking-only',
      cliType: 'claudeCode' as const,
      pattern: 'claude-opus-4-6',
      patternType: 'exact' as const,
    };
    const channel = {
      routeRuleId: rule.id,
      siteId: 'site-claude',
      accountId: 'account-claude',
      apiKeyId: 'key-claude',
      cliType: 'claudeCode' as const,
      canonicalModel: 'claude-opus-4-6',
      resolvedModel: 'claude-opus-4-6',
    };
    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [rule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'claude-opus-4-6': {
            canonicalName: 'claude-opus-4-6',
            aliases: ['claude-opus-4-6'],
            sources: [],
            vendor: 'claude' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };
    const thinkingChunk = Buffer.from(
      [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_think","type":"message","role":"assistant","model":"claude-opus-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"checking the task"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        '',
      ].join('\n'),
      'utf-8'
    );
    const terminalChunk = Buffer.from(
      [
        'event: message_delta',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
        '',
      ].join('\n'),
      'utf-8'
    );

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => ({ id: 'site-claude', name: 'Claude-compatible' })),
      getAccountById: vi.fn(() => ({ id: 'account-claude', account_name: 'default' })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('claudeCode');
    vi.mocked(extractModelFromBody).mockReturnValue('claude-opus-4-6');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...channel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 0,
      successRate: 0,
      updatedAt: 1,
    });
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      const headers = { 'content-type': 'text/event-stream' };
      const accepted = config.onResponse?.({ status: 200, statusText: 'OK', headers });
      expect(accepted).toBe(true);
      await config.onChunk?.(thinkingChunk);
      await config.onChunk?.(terminalChunk);
      return {
        status: 200,
        headers,
        body: Buffer.concat([thinkingChunk, terminalChunk]),
        firstByteLatencyMs: 4,
      };
    });

    const request = createJsonRequest(
      '/v1/messages?beta=true',
      {
        'x-api-key': 'sk-route',
        'content-type': 'application/json',
      },
      { model: 'claude-opus-4-6', stream: true, messages: [{ role: 'user', content: 'edit' }] }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('checking the task');
    expect(response.body).toContain('event: error');
    expect(response.body).toContain('without assistant text or tool_use content');
    expect(response.body).not.toContain('event: message_stop');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-claude' }),
      'failure',
      expect.objectContaining({
        error: 'malformed_streaming_response:thinking_only_message',
      }),
      expect.any(Object)
    );
  });

  it('buffers failed SSE responses so fallback attempts can stream without leaking failed chunks', async () => {
    vi.clearAllMocks();

    const rule = {
      id: 'rule-codex-stream',
      cliType: 'codex' as const,
      pattern: 'gpt-4.1-mini',
      patternType: 'exact' as const,
    };
    const firstChannel = {
      routeRuleId: rule.id,
      siteId: 'site-first',
      accountId: 'account-first',
      apiKeyId: 'key-first',
      cliType: 'codex' as const,
      canonicalModel: 'gpt-4.1-mini',
      resolvedModel: 'gpt-4.1-mini',
    };
    const secondChannel = {
      routeRuleId: rule.id,
      siteId: 'site-second',
      accountId: 'account-second',
      apiKeyId: 'key-second',
      cliType: 'codex' as const,
      canonicalModel: 'gpt-4.1-mini',
      resolvedModel: 'gpt-4.1-mini',
    };
    const routing = {
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [rule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'gpt-4.1-mini': {
            canonicalName: 'gpt-4.1-mini',
            aliases: ['gpt-4.1-mini'],
            sources: [],
            vendor: 'openai' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        overrides: [],
        displayItems: [],
        vendorPriorities: {},
      },
    };
    const failureChunk = Buffer.from('data: first-failure\n\n');
    const successChunk = Buffer.from(
      'event: response.completed\ndata: {"type":"response.completed","response":{}}\n\n'
    );
    let attempt = 0;

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => undefined),
      getAccountById: vi.fn(() => undefined),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-4.1-mini');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([firstChannel, secondChannel]);
    vi.mocked(resolveChannelCredentials).mockImplementation(
      async (_siteId, _accountId, apiKeyId) =>
        apiKeyId === 'key-first'
          ? { baseUrl: 'https://first.example.com', apiKey: 'sk-first' }
          : { baseUrl: 'https://second.example.com', apiKey: 'sk-second' }
    );
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...firstChannel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 1,
      successRate: 1,
      updatedAt: 1,
    });
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      attempt += 1;

      if (attempt === 1) {
        const headers = { 'content-type': 'text/event-stream' };
        const accepted = config.onResponse?.({
          status: 503,
          statusText: 'Service Unavailable',
          headers,
        });
        expect(accepted).toBe(false);
        await config.onChunk?.(failureChunk);
        return {
          status: 503,
          headers,
          body: failureChunk,
          firstByteLatencyMs: 2,
        };
      }

      const headers = { 'content-type': 'text/event-stream' };
      const accepted = config.onResponse?.({ status: 200, statusText: 'OK', headers });
      expect(accepted).toBe(true);
      await config.onChunk?.(successChunk);
      return {
        status: 200,
        headers,
        body: successChunk,
        firstByteLatencyMs: 4,
      };
    });

    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', stream: true, input: 'hi' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(vi.mocked(httpRawStreamRequest).mock.calls.map(call => call[0])).toEqual([
      'https://first.example.com/v1/responses',
      'https://second.example.com/v1/responses',
    ]);
    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.write).toHaveBeenCalledTimes(1);
    expect(response.body).toBe(successChunk.toString('utf-8'));
    expect(response.body).not.toContain('first-failure');
    expect(response.end).toHaveBeenCalledTimes(1);
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

  it('can target the AnyRouter Claude Messages beta path after protocol conversion', () => {
    const target = buildUpstreamRequestUrl(
      'https://anyrouter.top/',
      '/v1/messages?beta=true',
      'claudeCode',
      undefined,
      'sk-upstream-key'
    );

    expect(target).toEqual({
      url: 'https://anyrouter.top/v1/messages?beta=true',
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
