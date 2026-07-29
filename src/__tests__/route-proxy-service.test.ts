import { EventEmitter } from 'events';
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
  buildUpstreamRequestUrl,
  buildUpstreamHeaders,
  classifyRouteEndpointOperation,
  classifyRouteStatusCode,
  detectMarkedRouteCliType,
  estimateClaudeCountTokens,
  extractRouteApiKey,
  extractRouteReasoningEffort,
  applyRouteThinkingEffortOverride,
  extractUsageFromBody,
  handleRequest,
  isUpstreamQuotaExhaustionResponse,
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
import {
  resolveChannels,
  resolveChannelCredentials,
  resolveChannelTarget,
} from '../main/route-channel-resolver';
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

function createControllableJsonRequest(
  url: string,
  headers: Record<string, string>,
  body: unknown
): Parameters<typeof handleRequest>[0] & EventEmitter {
  const request = new Readable({
    read() {
      this.push(Buffer.from(JSON.stringify(body)));
      this.push(null);
    },
  }) as Readable &
    EventEmitter & {
      complete: boolean;
      headers: Record<string, string>;
      method: string;
      url: string;
      socket: { remoteAddress: string };
    };

  request.complete = true;
  request.headers = headers;
  request.method = 'POST';
  request.url = url;
  request.socket = { remoteAddress: '::1' };

  return request as unknown as Parameters<typeof handleRequest>[0] & EventEmitter;
}

function createMockResponse(): Parameters<typeof handleRequest>[1] & {
  body: string;
  end: ReturnType<typeof vi.fn>;
  emit: EventEmitter['emit'];
  headers: Record<string, unknown>;
  off: EventEmitter['off'];
  once: EventEmitter['once'];
  statusCode: number;
  write: ReturnType<typeof vi.fn>;
  writeHead: ReturnType<typeof vi.fn>;
} {
  const events = new EventEmitter();
  const response = {
    body: '',
    destroyed: false,
    emit: events.emit.bind(events),
    headers: {} as Record<string, unknown>,
    headersSent: false,
    off: events.off.bind(events),
    once: events.once.bind(events),
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
      events.emit('finish');
      return response;
    }),
  };

  return response as unknown as Parameters<typeof handleRequest>[1] & {
    body: string;
    end: ReturnType<typeof vi.fn>;
    emit: EventEmitter['emit'];
    headers: Record<string, unknown>;
    off: EventEmitter['off'];
    once: EventEmitter['once'];
    statusCode: number;
    write: ReturnType<typeof vi.fn>;
    writeHead: ReturnType<typeof vi.fn>;
  };
}

describe('route-proxy-service endpoint classification', () => {
  it.each([
    ['POST', '/v1/messages', 'generation-convertible'],
    ['POST', '/v1/responses', 'generation-convertible'],
    ['POST', '/v1/chat/completions', 'generation-convertible'],
    ['POST', '/v1/messages/count_tokens', 'stateless-native-only'],
    ['POST', '/v1/responses/input_tokens', 'stateless-native-only'],
    ['POST', '/v1/messages/batches', 'stateful-unsupported'],
    ['GET', '/v1/messages/batches/batch_1/results', 'stateful-unsupported'],
    ['DELETE', '/v1/messages/batches/batch_1', 'stateful-unsupported'],
    ['GET', '/v1/responses/resp_1', 'stateful-unsupported'],
    ['POST', '/v1/responses/resp_1/cancel', 'stateful-unsupported'],
    ['GET', '/v1/responses/resp_1/input_items', 'stateful-unsupported'],
    ['POST', '/v1/responses/compact', 'unsupported'],
    ['GET', '/v1/chat/completions', 'stateful-unsupported'],
    ['POST', '/v1/chat/completions/chat_1', 'stateful-unsupported'],
    ['GET', '/v1/chat/completions/chat_1/messages', 'stateful-unsupported'],
    ['POST', '/v1/batches', 'stateful-unsupported'],
    ['GET', '/v1/files/file_1', 'stateful-unsupported'],
    ['POST', '/v1/uploads/upload_1/complete', 'stateful-unsupported'],
    ['GET', '/v1/vector_stores/vs_1', 'stateful-unsupported'],
    ['GET', '/v1/conversations/conv_1', 'stateful-unsupported'],
    ['DELETE', '/v1/containers/container_1', 'stateful-unsupported'],
    ['POST', '/v1/responses/unknown/subpath', 'unsupported'],
  ] as const)('classifies %s %s as %s', (method, path, capability) => {
    expect(classifyRouteEndpointOperation(method, path)?.capability).toBe(capability);
  });

  it('uses only known managed CLI marker values', () => {
    expect(detectMarkedRouteCliType({ 'x-api-detect-cli': 'openCode' })).toBe('openCode');
    expect(detectMarkedRouteCliType({ 'x-api-detect-cli': 'CODEX' })).toBe('codex');
    expect(detectMarkedRouteCliType({ 'x-api-detect-cli': 'grokBuild' })).toBe('grokBuild');
    expect(detectMarkedRouteCliType({ 'x-api-detect-cli': 'unknown-client' })).toBeNull();
  });

  it('rejects stateful endpoint operations before channel selection', async () => {
    vi.clearAllMocks();
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({ server: { unifiedApiKey: 'sk-route' } })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    const request = createJsonRequest(
      '/v1/responses/resp_1',
      {
        authorization: 'Bearer sk-route',
        'x-api-detect-cli': 'openCode',
      },
      null
    ) as Parameters<typeof handleRequest>[0] & { method: string };
    request.method = 'GET';
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.body).error).toBe('stateful_route_operation_unsupported');
    expect(resolveChannels).not.toHaveBeenCalled();
    expect(httpRawRequest).not.toHaveBeenCalled();
  });

  it('rejects previous_response_id before channel selection', async () => {
    vi.clearAllMocks();
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({ server: { unifiedApiKey: 'sk-route' } })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'x-api-detect-cli': 'openCode',
      },
      { model: 'gpt-5', input: 'continue', previous_response_id: 'resp_1' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.body).error).toBe('stateful_request_unsupported');
    expect(resolveChannels).not.toHaveBeenCalled();
  });

  it('does not let a managed marker bypass route authentication', async () => {
    vi.clearAllMocks();
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({ server: { unifiedApiKey: 'sk-route' } })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer wrong-key',
        'x-api-detect-cli': 'openCode',
      },
      { model: 'gpt-5', input: 'hello' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(401);
    expect(resolveChannels).not.toHaveBeenCalled();
  });

  it('rejects a Codex marker on the Chat Completions path', async () => {
    vi.clearAllMocks();
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({ server: { unifiedApiKey: 'sk-route' } })),
    });
    const request = createJsonRequest(
      '/v1/chat/completions',
      {
        authorization: 'Bearer sk-route',
        'x-api-detect-cli': 'codex',
      },
      { model: 'gpt-5', messages: [{ role: 'user', content: 'hello' }] }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('cli_marker_path_mismatch');
    expect(resolveChannels).not.toHaveBeenCalled();
  });

  it('rejects top-level OpenAI resource operations as stateful before channel selection', async () => {
    vi.clearAllMocks();
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({ server: { unifiedApiKey: 'sk-route' } })),
    });
    const request = createJsonRequest(
      '/v1/files/file_1',
      {
        authorization: 'Bearer sk-route',
        'x-api-detect-cli': 'openCode',
      },
      null
    ) as Parameters<typeof handleRequest>[0] & { method: string };
    request.method = 'GET';
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.body).error).toBe('stateful_route_operation_unsupported');
    expect(resolveChannels).not.toHaveBeenCalled();
  });
});

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

  it.each([
    [403, 'INSUFFICIENT_BALANCE: Insufficient account balance'],
    [403, 'billing_error: request rejected'],
    [403, 'new_api_error: 用户额度不足, 剩余额度: 0'],
    [403, 'new_api_error: 预扣费额度失败'],
    [500, 'upstream_quota_exhausted: no credits remain'],
  ])('recognizes explicit upstream quota exhaustion (%s)', (statusCode, message) => {
    expect(
      isUpstreamQuotaExhaustionResponse(
        statusCode,
        Buffer.from(JSON.stringify({ error: { message } }))
      )
    ).toBe(true);
  });

  it.each([
    [403, 'permission_error: API key is forbidden'],
    [403, 'rate_limit_error: Codex rolling spend limit exceeded'],
    [429, 'rate_limit_error: too many requests'],
    [200, 'INSUFFICIENT_BALANCE: Insufficient account balance'],
  ])(
    'does not classify unrelated upstream responses as quota exhaustion (%s)',
    (statusCode, message) => {
      expect(
        isUpstreamQuotaExhaustionResponse(
          statusCode,
          Buffer.from(JSON.stringify({ error: { message } }))
        )
      ).toBe(false);
    }
  );

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

  it('does not promote a success from a request selected before priority invalidation', () => {
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
    const oldSuccessfulPath = {
      ...firstPath,
      siteId: 'site-2',
      accountId: 'acc-2',
      apiKeyId: 'key-b',
    };
    const routePathStates: Record<string, RoutePathState> = {
      [buildRoutePathStateKey(oldSuccessfulPath)]: {
        ...oldSuccessfulPath,
        windowStartedAt: now,
        windowRequestCount: 1,
        windowSuccessCount: 1,
        successRate: 1,
        lastOutcome: 'success',
        lastSuccessAt: now - 1_000,
        lastSuccessRequestStartedAt: now - 10_000,
        updatedAt: now - 1_000,
      },
    };

    expect(
      applySuccessfulRoutePathAffinity(
        [firstPath, oldSuccessfulPath],
        routePathStates,
        now,
        now - 5_000
      )
    ).toEqual([firstPath, oldSuccessfulPath]);
  });

  it('promotes a success from a request selected after priority invalidation', () => {
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
    const newSuccessfulPath = {
      ...firstPath,
      siteId: 'site-2',
      accountId: 'acc-2',
      apiKeyId: 'key-b',
    };
    const routePathStates: Record<string, RoutePathState> = {
      [buildRoutePathStateKey(newSuccessfulPath)]: {
        ...newSuccessfulPath,
        windowStartedAt: now,
        windowRequestCount: 1,
        windowSuccessCount: 1,
        successRate: 1,
        lastOutcome: 'success',
        lastSuccessAt: now - 1_000,
        lastSuccessRequestStartedAt: now - 2_000,
        updatedAt: now - 1_000,
      },
    };

    expect(
      applySuccessfulRoutePathAffinity(
        [firstPath, newSuccessfulPath],
        routePathStates,
        now,
        now - 5_000
      )
    ).toEqual([newSuccessfulPath, firstPath]);
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

  it('ignores successful route path affinity when the route channel was reset across route rules', () => {
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
      routeRuleId: 'rule-2',
      siteId: 'site-2',
      accountId: 'acc-2',
      apiKeyId: 'key-b',
      resolvedModel: 'raw-b',
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
      [buildRoutePathStateKey({
        ...resetPath,
        routeRuleId: undefined,
        resolvedModel: undefined,
      })]: {
        ...resetPath,
        routeRuleId: undefined,
        resolvedModel: undefined,
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

describe('route-proxy-service reasoning effort extraction', () => {
  it.each([
    [{ output_config: { effort: 'max' } }, 'max'],
    [{ reasoning: { effort: 'xhigh' } }, 'xhigh'],
    [{ reasoning_effort: 'medium' }, 'medium'],
    [{ reasoningEffort: 'future-effort' }, 'future-effort'],
    [{ thinking: { type: 'enabled', budget_tokens: 2048 } }, '2048 tokens'],
    [{ thinking: { type: 'enabled', budgetTokens: '4096' } }, '4096 tokens'],
    [{ thinking: { type: 'adaptive' } }, '开启'],
    [{ thinking: { type: 'disabled' } }, undefined],
    [{}, undefined],
  ])('extracts the actual request reasoning value from %j', (body, expected) => {
    expect(extractRouteReasoningEffort(body)).toBe(expected);
  });

  it('prefers an explicit effort over a manual thinking budget', () => {
    expect(
      extractRouteReasoningEffort({
        output_config: { effort: 'low' },
        thinking: { type: 'enabled', budget_tokens: 8192 },
      })
    ).toBe('low');
  });
});

describe('route-proxy-service thinking effort override', () => {
  it('overrides Claude output_config.effort and fills adaptive thinking when missing', () => {
    const next = applyRouteThinkingEffortOverride(
      Buffer.from(JSON.stringify({ model: 'claude-opus-4-6', stream: true })),
      'high',
      'anthropic-messages'
    );
    expect(JSON.parse(next.toString('utf-8'))).toEqual({
      model: 'claude-opus-4-6',
      stream: true,
      output_config: { effort: 'high' },
      thinking: { type: 'adaptive' },
    });
  });

  it('preserves existing Claude thinking type while replacing effort', () => {
    const next = applyRouteThinkingEffortOverride(
      Buffer.from(
        JSON.stringify({
          thinking: { type: 'enabled', budget_tokens: 2048 },
          output_config: { effort: 'max', format: 'text' },
        })
      ),
      'low',
      'anthropic-messages'
    );
    expect(JSON.parse(next.toString('utf-8'))).toEqual({
      thinking: { type: 'enabled', budget_tokens: 2048 },
      output_config: { effort: 'low', format: 'text' },
    });
  });

  it('overrides Codex reasoning.effort', () => {
    const next = applyRouteThinkingEffortOverride(
      Buffer.from(JSON.stringify({ model: 'gpt-5.1-codex-max', reasoning: { summary: 'auto' } })),
      'xhigh',
      'openai-responses'
    );
    expect(JSON.parse(next.toString('utf-8'))).toEqual({
      model: 'gpt-5.1-codex-max',
      reasoning: { summary: 'auto', effort: 'xhigh' },
    });
  });

  it('returns original body when effort is unset', () => {
    const original = Buffer.from(JSON.stringify({ reasoning: { effort: 'medium' } }));
    const next = applyRouteThinkingEffortOverride(original, null, 'openai-responses');
    expect(next).toBe(original);
  });

  it('accepts custom freeform effort tokens', () => {
    const next = applyRouteThinkingEffortOverride(
      Buffer.from(JSON.stringify({ reasoning: { effort: 'medium' } })),
      'ultra',
      'openai-responses'
    );
    expect(JSON.parse(next.toString('utf-8'))).toEqual({
      reasoning: { effort: 'ultra' },
    });
  });

  it('uses the top-level reasoning_effort field for Chat Completions', () => {
    const next = applyRouteThinkingEffortOverride(
      Buffer.from(
        JSON.stringify({
          reasoning_effort: 'low',
          reasoningEffort: 'medium',
          reasoning: { effort: 'high', summary: 'auto' },
        })
      ),
      'xhigh',
      'openai-chat-completions'
    );

    expect(JSON.parse(next.toString('utf-8'))).toEqual({
      reasoning_effort: 'xhigh',
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

describe('route-proxy-service local token estimation', () => {
  it('includes OpenAI Responses function parameters', () => {
    const baseRequest = {
      model: 'gpt-5',
      input: 'hello',
      tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }],
    };
    const requestWithSchema = {
      ...baseRequest,
      tools: [
        {
          type: 'function',
          name: 'lookup',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'x'.repeat(400) },
            },
          },
        },
      ],
    };

    const base = estimateClaudeCountTokens(Buffer.from(JSON.stringify(baseRequest))).input_tokens;
    const withSchema = estimateClaudeCountTokens(
      Buffer.from(JSON.stringify(requestWithSchema))
    ).input_tokens;

    expect(withSchema).toBeGreaterThan(base + 80);
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

  it('tries a later same-protocol channel before falling back from count_tokens', async () => {
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
    vi.mocked(resolveChannelCredentials)
      .mockResolvedValueOnce({
        baseUrl: 'https://site-a.example.com',
        apiKey: 'sk-upstream-a',
      })
      .mockResolvedValueOnce({
        baseUrl: 'https://site-b.example.com',
        apiKey: 'sk-upstream-b',
      });
    vi.mocked(httpRawRequest)
      .mockResolvedValueOnce({
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{"error":{"message":"Invalid URL (POST /v1/messages/count_tokens)"}}'),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{"input_tokens":37}'),
      });

    const request = createJsonRequest(
      '/v1/messages/count_tokens',
      { 'x-api-key': 'sk-route', 'content-type': 'application/json' },
      countBody
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ input_tokens: 37 });
    expect(httpRawRequest).toHaveBeenCalledTimes(2);
    expect(resolveChannelCredentials).toHaveBeenCalledTimes(2);
    expect(recordRouteEndpointUnsupported).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'site-a',
        accountId: 'account-a',
        apiKeyId: 'key-a',
      }),
      'claude_messages_count_tokens',
      expect.objectContaining({ statusCode: 404, reason: 'upstream_unsupported' })
    );
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 'site-b' }),
      'success',
      expect.objectContaining({ requestSelectionStartedAt: expect.any(Number) }),
      expect.anything()
    );
    const successfulPathCall = vi
      .mocked(recordRoutePathOutcome)
      .mock.calls.find(([, outcome]) => outcome === 'success');
    const requestSelectionStartedAt = successfulPathCall?.[2]?.requestSelectionStartedAt;
    expect(requestSelectionStartedAt).toEqual(expect.any(Number));
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSelectionStartedAt,
        requestKind: 'token-count',
        outcome: 'neutral',
        statusCode: 404,
        error: 'count_tokens_upstream_unsupported:404',
      })
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestKind: 'token-count',
        tokenUsageSource: 'upstream',
        promptTokens: 37,
        totalTokens: 37,
        outcome: 'success',
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
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestKind: 'token-count',
        outcome: 'neutral',
        statusCode: 403,
        error: 'count_tokens_upstream_unsupported:403',
      })
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestKind: 'token-count',
        tokenUsageSource: 'local-estimate',
        estimatedInputTokens: expect.any(Number),
        outcome: 'neutral',
        statusCode: 200,
        error: 'count_tokens_local_estimate:upstream_403',
      })
    );
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
    expect(recordRouteRequest).toHaveBeenCalledTimes(1);
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestKind: 'token-count',
        tokenUsageSource: 'local-estimate',
        estimatedInputTokens: expect.any(Number),
        outcome: 'neutral',
        statusCode: 200,
        error: 'count_tokens_local_estimate:cached_unsupported',
      })
    );
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
    expect(recordRouteEndpointUnsupported).not.toHaveBeenCalled();
    expect(response.headers['x-api-detect-token-estimate']).toBe('local-approximate');
  });
});

describe('route-proxy-service Responses input_tokens fallback', () => {
  it('forwards only to a Responses channel and marks the local fallback as approximate', async () => {
    vi.clearAllMocks();
    const rule = {
      id: 'rule-opencode-input-tokens',
      cliType: 'openCode' as const,
      pattern: 'gpt-5',
      patternType: 'exact' as const,
    };
    const channel = {
      routeRuleId: rule.id,
      siteId: 'site-responses',
      accountId: 'account-responses',
      apiKeyId: 'key-responses',
      cliType: 'openCode' as const,
      targetProtocol: 'native' as const,
      canonicalModel: 'gpt-5',
      resolvedModel: 'gpt-5-upstream',
    };
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({
        server: {
          unifiedApiKey: 'sk-route',
          requestTimeoutMs: 1000,
          upstreamProxyUrl: '',
        },
        rules: [rule],
        cliModelSelections: { claudeCode: null, codex: null, openCode: 'gpt-5' },
        cliThinkingEffortSelections: { claudeCode: null, codex: null, openCode: null },
        modelRegistry: {
          version: 1,
          sources: [],
          entries: {},
          overrides: [],
          displayItems: [],
          vendorPriorities: {},
        },
        routePathStates: {},
        routeEndpointCapabilities: {},
      })),
      getSiteById: vi.fn(() => ({ id: 'site-responses', name: 'Responses Site' })),
      getAccountById: vi.fn(() => ({ id: 'account-responses', account_name: 'Responses' })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-5');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://responses.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(isRouteEndpointUnsupported).mockReturnValue(false);
    vi.mocked(recordRouteEndpointUnsupported).mockImplementation(async (key, endpoint) => ({
      ...key,
      endpoint,
      status: 'unsupported',
      firstObservedAt: 1,
      lastObservedAt: 1,
      updatedAt: 1,
    }));
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"error":{"message":"input_tokens is not supported"}}'),
    });
    const body = {
      model: 'gpt-5',
      instructions: 'Be concise',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
    };
    const request = createJsonRequest(
      '/v1/responses/input_tokens',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
        'x-api-detect-cli': 'openCode',
      },
      body
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawRequest).toHaveBeenCalledWith(
      'https://responses.example.com/v1/responses/input_tokens',
      expect.objectContaining({ method: 'POST' })
    );
    expect(recordRouteEndpointUnsupported).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 'site-responses' }),
      'openai_responses_input_tokens',
      expect.objectContaining({ reason: 'upstream_unsupported' })
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-api-detect-token-estimate']).toBe('local-approximate');
    expect(JSON.parse(response.body).input_tokens).toBeGreaterThan(1);
    expect(recordRoutePathOutcome).not.toHaveBeenCalled();
  });
});

describe('route-proxy-service client cancellation', () => {
  const rule = {
    id: 'rule-codex-cancel',
    cliType: 'codex' as const,
    pattern: 'gpt-4.1-mini',
    patternType: 'exact' as const,
  };
  const firstChannel = {
    routeRuleId: rule.id,
    siteId: 'site-a',
    accountId: 'account-a',
    apiKeyId: 'key-a',
    cliType: 'codex' as const,
    targetProtocol: 'native' as const,
    canonicalModel: 'gpt-4.1-mini',
    resolvedModel: 'gpt-4.1-mini',
  };
  const secondChannel = {
    ...firstChannel,
    siteId: 'site-b',
    accountId: 'account-b',
    apiKeyId: 'key-b',
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
    routePathStates: {},
  };

  function setupCodexCancellationRoute() {
    vi.clearAllMocks();
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
    vi.mocked(resolveChannels).mockReturnValue([firstChannel, secondChannel]);
    vi.mocked(resolveChannelCredentials).mockImplementation(
      async (_siteId, _accountId, apiKeyId) => ({
        baseUrl: `https://${apiKeyId}.example.com`,
        apiKey: `sk-${apiKeyId}`,
      })
    );
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
  }

  it('aborts the active upstream request and does not try fallback channels after client close', async () => {
    setupCodexCancellationRoute();

    let upstreamSignal: AbortSignal | undefined;
    vi.mocked(httpRawRequest).mockImplementation(
      async (_url, config = {}) =>
        await new Promise((resolve, reject) => {
          upstreamSignal = config.signal;
          upstreamSignal?.addEventListener(
            'abort',
            () => reject(upstreamSignal?.reason ?? new Error('aborted')),
            { once: true }
          );
          setTimeout(() => {
            resolve({
              status: 200,
              headers: { 'content-type': 'application/json' },
              body: Buffer.from('{"ok":true}'),
            });
          }, 1000);
        })
    );

    const request = createControllableJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', input: 'hi' }
    );
    const response = createMockResponse();

    const pending = handleRequest(request, response);
    await vi.waitFor(() => expect(httpRawRequest).toHaveBeenCalledTimes(1));

    response.emit('close');
    await pending;

    expect(upstreamSignal?.aborted).toBe(true);
    expect(httpRawRequest).toHaveBeenCalledTimes(1);
    expect(resolveChannelCredentials).toHaveBeenCalledTimes(1);
    expect(recordRoutePathOutcome).not.toHaveBeenCalled();
    expect(recordRouteRequest).not.toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();
  });

  it('ignores an upstream result that resolves after client cancellation', async () => {
    setupCodexCancellationRoute();

    let resolveUpstream: (value: Awaited<ReturnType<typeof httpRawRequest>>) => void = () => {};
    vi.mocked(httpRawRequest).mockImplementation(
      async () =>
        await new Promise(resolve => {
          resolveUpstream = resolve;
        })
    );

    const request = createControllableJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', input: 'hi' }
    );
    const response = createMockResponse();

    const pending = handleRequest(request, response);
    await vi.waitFor(() => expect(httpRawRequest).toHaveBeenCalledTimes(1));

    response.emit('close');
    resolveUpstream({
      status: 503,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"error":"late failure"}'),
    });
    await pending;

    expect(httpRawRequest).toHaveBeenCalledTimes(1);
    expect(recordRoutePathOutcome).not.toHaveBeenCalled();
    expect(recordRouteRequest).not.toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();
  });

  it('aborts a committed native stream without recording or retrying after client cancel', async () => {
    setupCodexCancellationRoute();
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...firstChannel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 1,
      successRate: 1,
      updatedAt: 1,
    });

    const completedStream = Buffer.from(
      [
        'event: response.output_text.delta',
        'data: {"type":"response.output_text.delta","delta":"hi"}',
        '',
        'event: response.completed',
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7}}}',
        '',
      ].join('\n')
    );
    const upstreamHeaders = { 'content-type': 'text/event-stream' };

    vi.mocked(httpRawStreamRequest).mockImplementation(
      (_url, config = {}) =>
        new Promise((_resolve, reject) => {
          const accepted = config.onResponse?.({
            status: 200,
            statusText: 'OK',
            headers: upstreamHeaders,
          });
          expect(accepted).toBe(true);
          config.signal?.addEventListener(
            'abort',
            () => {
              expect(config.shouldResolveOnAbort?.()).toBe(false);
              reject(config.signal?.reason ?? new Error('Request aborted'));
            },
            { once: true }
          );
          void Promise.resolve(config.onChunk?.(completedStream)).catch(reject);
        })
    );

    const request = createControllableJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', stream: true, input: 'hi' }
    );
    const response = createMockResponse();

    const pending = handleRequest(request, response);
    await vi.waitFor(() => expect(httpRawStreamRequest).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(response.write).toHaveBeenCalled());

    response.emit('close');
    await pending;

    expect(httpRawStreamRequest).toHaveBeenCalledTimes(1);
    expect(resolveChannelCredentials).toHaveBeenCalledTimes(1);
    expect(recordRoutePathOutcome).not.toHaveBeenCalled();
    expect(recordRouteRequest).not.toHaveBeenCalled();
  });

  it('still ignores late non-success upstream results after client cancel', async () => {
    setupCodexCancellationRoute();

    vi.mocked(httpRawStreamRequest).mockImplementation(
      (_url, config = {}) =>
        new Promise((_resolve, reject) => {
          config.onResponse?.({
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'content-type': 'application/json' },
          });
          config.signal?.addEventListener(
            'abort',
            () => {
              expect(config.shouldResolveOnAbort?.()).toBe(false);
              reject(config.signal?.reason ?? new Error('route_client_cancelled'));
            },
            { once: true }
          );
        })
    );

    const request = createControllableJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', stream: true, input: 'hi' }
    );
    const response = createMockResponse();

    const pending = handleRequest(request, response);
    await vi.waitFor(() => expect(httpRawStreamRequest).toHaveBeenCalledTimes(1));

    response.emit('close');
    await pending;

    expect(recordRoutePathOutcome).not.toHaveBeenCalled();
    expect(recordRouteRequest).not.toHaveBeenCalled();
  });
});

describe('route-proxy-service custom CLI forwarding', () => {
  it('forwards a selected custom CLI channel to its direct base URL', async () => {
    vi.clearAllMocks();

    const rule = {
      id: 'rule-custom-cli',
      cliType: 'codex' as const,
      pattern: 'duckcoding-route',
      patternType: 'exact' as const,
      allowedSiteIds: ['site-managed'],
      allowedAccountIds: ['account-managed'],
      allowedApiKeyGroups: ['team-a'],
    };
    const customChannel = {
      routeRuleId: rule.id,
      siteId: 'custom-cli-site-duckcoding',
      accountId: 'custom-cli-account-duckcoding',
      apiKeyId: 'custom-cli-key-duckcoding',
      cliType: 'codex' as const,
      targetProtocol: 'native' as const,
      targetEndpoint: '/v1/responses',
      canonicalModel: 'duckcoding-route',
      resolvedModel: 'duckcoding',
      sitePriority: 0,
      apiKeyPriority: 0,
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
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'duckcoding-route': {
            canonicalName: 'duckcoding-route',
            aliases: ['duckcoding'],
            sources: [],
            vendor: 'unknown' as const,
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
      getSiteById: vi.fn(() => null),
      getAccountById: vi.fn(() => null),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('duckcoding-route');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([customChannel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://duck.example.com',
      apiKey: 'sk-duck',
    });
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockImplementation(async (channel, outcome) => ({
      ...channel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: outcome === 'success' ? 1 : 0,
      successRate: outcome === 'success' ? 1 : 0,
      lastOutcome: outcome,
      updatedAt: 1,
    }));
    vi.mocked(httpRawRequest).mockResolvedValueOnce({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'br',
        'content-length': '999',
        'transfer-encoding': 'chunked',
      },
      body: Buffer.from('{"output_text":"ok","usage":{"input_tokens":1,"output_tokens":1}}'),
    });

    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'duckcoding-route', input: 'hi' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(resolveChannelCredentials).toHaveBeenCalledWith(
      'custom-cli-site-duckcoding',
      'custom-cli-account-duckcoding',
      'custom-cli-key-duckcoding'
    );
    expect(httpRawRequest).toHaveBeenCalledWith(
      'https://duck.example.com/v1/responses',
      expect.objectContaining({
        preferElectronNet: true,
        body: expect.any(Buffer),
      })
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"output_text":"ok"');
    expect(response.headers).toMatchObject({
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(response.body)),
    });
    expect(response.headers).not.toHaveProperty('content-encoding');
    expect(response.headers).not.toHaveProperty('transfer-encoding');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'custom-cli-site-duckcoding',
        accountId: 'custom-cli-account-duckcoding',
        apiKeyId: 'custom-cli-key-duckcoding',
        canonicalModel: 'duckcoding-route',
        resolvedModel: 'duckcoding',
      }),
      'success',
      expect.objectContaining({ statusCode: 200 }),
      expect.any(Object)
    );
  });

  it('forwards SenseNova Claude-compatible upstream auth as bearer token', async () => {
    vi.clearAllMocks();

    const rule = {
      id: 'rule-sensenova-claude',
      cliType: 'claudeCode' as const,
      pattern: 'sensenova-6.7-flash-lite',
      patternType: 'exact' as const,
    };
    const channel = {
      routeRuleId: rule.id,
      siteId: 'site-sensenova',
      accountId: 'account-sensenova',
      apiKeyId: 'key-sensenova',
      cliType: 'claudeCode' as const,
      targetProtocol: 'native' as const,
      targetEndpoint: '/v1/messages',
      canonicalModel: 'sensenova-6.7-flash-lite',
      resolvedModel: 'sensenova-6.7-flash-lite',
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
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'sensenova-6.7-flash-lite': {
            canonicalName: 'sensenova-6.7-flash-lite',
            aliases: ['sensenova-6.7-flash-lite'],
            sources: [],
            vendor: 'unknown' as const,
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
      getSiteById: vi.fn(() => ({ id: 'site-sensenova', name: 'SenseNova' })),
      getAccountById: vi.fn(() => ({ id: 'account-sensenova', account_name: 'SenseNova' })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('claudeCode');
    vi.mocked(extractModelFromBody).mockReturnValue('sensenova-6.7-flash-lite');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://token.sensenova.cn',
      apiKey: 'sk-sensenova-upstream',
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
    vi.mocked(httpRawRequest).mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          model: 'sensenova-6.7-flash-lite',
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        })
      ),
    });

    const request = createJsonRequest(
      '/v1/messages',
      {
        'x-api-key': 'sk-route',
        'content-type': 'application/json',
      },
      {
        model: 'sensenova-6.7-flash-lite',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello!' }],
      }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawRequest).toHaveBeenCalledWith(
      'https://token.sensenova.cn/v1/messages',
      expect.objectContaining({
        method: 'POST',
        preferElectronNet: true,
      })
    );
    const headers = vi.mocked(httpRawRequest).mock.calls[0]?.[1]?.headers;
    expect(headers?.authorization).toBe('Bearer sk-sensenova-upstream');
    expect(headers?.['x-api-key']).toBeUndefined();
    expect(response.statusCode).toBe(200);
  });
});

describe('route-proxy-service CLI model fallback', () => {
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
      },
      rules: [selectedRule],
      cliModelSelections: {
        claudeCode: null,
        codex: 'gpt-5-selected',
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
      {
        model: 'gpt-4o-from-external-config',
        input: 'hello',
        reasoning: { effort: 'xhigh' },
      }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(vi.mocked(findMatchingRule).mock.calls.map(call => call[2])).toEqual(['gpt-5-selected']);
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
        reasoningEffort: 'xhigh',
        canonicalModel: 'gpt-5-selected',
        resolvedModel: 'gpt-5-selected-upstream',
      })
    );
    expect(response.statusCode).toBe(200);
  });
});

describe('route-proxy-service OpenCode native endpoint routing', () => {
  function buildOpenCodeRouting() {
    const rule = {
      id: 'rule-opencode',
      cliType: 'openCode' as const,
      pattern: 'opencode-selected',
      patternType: 'exact' as const,
    };
    return {
      rule,
      routing: {
        server: {
          unifiedApiKey: 'sk-route',
          requestTimeoutMs: 1000,
          upstreamProxyUrl: '',
        },
        rules: [rule],
        cliModelSelections: {
          claudeCode: null,
          codex: null,
          openCode: 'opencode-selected',
          grokBuild: null,
        },
        cliThinkingEffortSelections: {
          claudeCode: null,
          codex: null,
          openCode: 'high',
          grokBuild: null,
        },
        modelRegistry: {
          version: 1,
          sources: [],
          entries: {
            'opencode-selected': {
              canonicalName: 'opencode-selected',
              aliases: ['opencode-selected'],
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
        routeEndpointCapabilities: {},
      },
    };
  }

  function setupOpenCodeRoute(params: {
    detectedCliType: 'claudeCode' | 'codex' | 'openCode';
    channelTargetProtocol?:
      | 'native'
      | 'anthropic-messages'
      | 'openai-chat-completions'
      | 'openai-responses';
  }) {
    const { rule, routing } = buildOpenCodeRouting();
    const channel = {
      routeRuleId: rule.id,
      siteId: 'site-opencode',
      accountId: 'account-opencode',
      apiKeyId: 'key-opencode',
      cliType: 'openCode' as const,
      targetProtocol: params.channelTargetProtocol ?? 'native',
      canonicalModel: 'opencode-selected',
      resolvedModel: 'opencode-upstream',
    };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => ({ id: 'site-opencode', name: 'OpenCode Site' })),
      getAccountById: vi.fn(() => ({
        id: 'account-opencode',
        account_name: 'OpenCode Account',
      })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue(params.detectedCliType);
    vi.mocked(extractModelFromBody).mockReturnValue('wire-opencode');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://opencode-upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...channel,
      targetProtocol: params.channelTargetProtocol,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 1,
      successRate: 1,
      updatedAt: 1,
    });

    return { rule, channel };
  }

  function setupGrokBuildRoute() {
    const base = buildOpenCodeRouting();
    const rule = {
      ...base.rule,
      id: 'rule-grok-build',
      cliType: 'grokBuild' as const,
    };
    const routing = {
      ...base.routing,
      rules: [rule],
      cliModelSelections: {
        ...base.routing.cliModelSelections,
        openCode: null,
        grokBuild: 'opencode-selected',
      },
      cliThinkingEffortSelections: {
        ...base.routing.cliThinkingEffortSelections,
        openCode: null,
        grokBuild: null,
      },
    };
    const channel = {
      routeRuleId: rule.id,
      siteId: 'site-grok-build',
      accountId: 'account-grok-build',
      apiKeyId: 'key-grok-build',
      cliType: 'grokBuild' as const,
      targetProtocol: 'native' as const,
      canonicalModel: 'opencode-selected',
      resolvedModel: 'grok-upstream',
    };

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => ({ id: 'site-grok-build', name: 'Grok Build Site' })),
      getAccountById: vi.fn(() => ({
        id: 'account-grok-build',
        account_name: 'Grok Build Account',
      })),
    });
    vi.mocked(extractModelFromBody).mockReturnValue('wire-grok');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://grok-upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...channel,
      targetProtocol: 'openai-responses',
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 1,
      successRate: 1,
      updatedAt: 1,
    });
  }

  it.each([
    {
      name: 'marker Messages',
      detectedCliType: 'claudeCode' as const,
      path: '/v1/messages',
      headers: { 'x-api-key': 'sk-route', 'x-api-detect-cli': 'grokBuild' },
      requestBody: {
        model: 'wire-grok',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
      },
      responseBody: {
        id: 'msg_grok',
        type: 'message',
        role: 'assistant',
        model: 'grok-upstream',
        content: [{ type: 'text', text: 'hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      targetProtocol: 'anthropic-messages',
    },
    {
      name: 'native identifier Responses',
      detectedCliType: 'codex' as const,
      path: '/v1/responses',
      headers: { 'x-api-key': 'sk-route', 'x-grok-client-identifier': 'grok-shell' },
      requestBody: { model: 'wire-grok', input: 'hello' },
      responseBody: {
        id: 'resp_grok',
        object: 'response',
        status: 'completed',
        model: 'grok-upstream',
        output: [
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
      targetProtocol: 'openai-responses',
    },
    {
      name: 'user-agent Chat Completions',
      detectedCliType: 'openCode' as const,
      path: '/v1/chat/completions',
      headers: { authorization: 'Bearer sk-route', 'user-agent': 'grok-shell/0.1.0' },
      requestBody: { model: 'wire-grok', messages: [{ role: 'user', content: 'hello' }] },
      responseBody: {
        id: 'chatcmpl_grok',
        object: 'chat.completion',
        model: 'grok-upstream',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
      targetProtocol: 'openai-chat-completions',
    },
  ])('keeps Grok Build native routing transparent for $name', async testCase => {
    vi.clearAllMocks();
    setupGrokBuildRoute();
    vi.mocked(detectCliTypeFromPath).mockReturnValue(testCase.detectedCliType);
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify(testCase.responseBody), 'utf-8'),
    });
    const request = createJsonRequest(
      testCase.path,
      { ...testCase.headers, 'content-type': 'application/json' },
      testCase.requestBody
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawRequest).toHaveBeenCalledWith(
      `https://grok-upstream.example.com${testCase.path}`,
      expect.objectContaining({ method: 'POST', preferElectronNet: true })
    );
    expect(response.statusCode).toBe(200);
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        cliType: 'grokBuild',
        targetProtocol: testCase.targetProtocol,
      })
    );
  });

  it('converts OpenCode Anthropic Messages directly to an explicit Chat Completions channel', async () => {
    vi.clearAllMocks();
    setupOpenCodeRoute({
      detectedCliType: 'claudeCode',
      channelTargetProtocol: 'openai-chat-completions',
    });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        JSON.stringify({
          id: 'chatcmpl-upstream',
          object: 'chat.completion',
          model: 'opencode-upstream',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'normalized hello' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
        'utf-8'
      ),
    });

    const request = createJsonRequest(
      '/v1/messages',
      {
        'x-api-key': 'sk-route',
        'content-type': 'application/json',
        'x-api-detect-cli': 'openCode',
      },
      {
        model: 'wire-opencode',
        stream: false,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
        max_tokens: 128,
        tools: [
          {
            name: 'lookup',
            input_schema: {
              type: 'object',
              properties: { file_id: { type: 'string' } },
            },
          },
        ],
      }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawRequest).toHaveBeenCalledWith(
      'https://opencode-upstream.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        preferElectronNet: true,
        headers: expect.objectContaining({
          authorization: 'Bearer sk-upstream',
        }),
      })
    );
    const forwardedBody = JSON.parse(
      Buffer.from(vi.mocked(httpRawRequest).mock.calls[0]?.[1]?.body as Buffer).toString('utf-8')
    );
    expect(forwardedBody).toMatchObject({
      model: 'opencode-upstream',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 128,
    });
    const downstreamBody = JSON.parse(response.body);
    expect(downstreamBody).toMatchObject({
      type: 'message',
      role: 'assistant',
      model: 'opencode-upstream',
      content: [{ type: 'text', text: 'normalized hello' }],
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        cliType: 'openCode',
        targetProtocol: 'openai-chat-completions',
        targetEndpoint: '/v1/chat/completions',
        outcome: 'success',
      })
    );
    const forwardedHeaders = vi.mocked(httpRawRequest).mock.calls[0]?.[1]?.headers;
    expect(forwardedHeaders).not.toHaveProperty('x-api-detect-cli');
  });

  it('keeps OpenCode Chat Completions transparent when the channel uses the same protocol', async () => {
    vi.clearAllMocks();
    setupOpenCodeRoute({
      detectedCliType: 'openCode',
      channelTargetProtocol: 'openai-chat-completions',
    });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        JSON.stringify({
          id: 'chatcmpl-upstream-transparent-would-leak',
          object: 'chat.completion',
          model: 'opencode-upstream',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'round trip hello' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
        'utf-8'
      ),
    });

    const request = createJsonRequest(
      '/v1/chat/completions',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
        'x-api-detect-cli': 'openCode',
      },
      {
        model: 'wire-opencode',
        stream: false,
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
      }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawRequest).toHaveBeenCalledWith(
      'https://opencode-upstream.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        preferElectronNet: true,
      })
    );
    const downstreamBody = JSON.parse(response.body);
    expect(downstreamBody).toMatchObject({
      object: 'chat.completion',
      model: 'opencode-upstream',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'round trip hello' },
          finish_reason: 'stop',
        },
      ],
    });
    expect(downstreamBody.id).toBe('chatcmpl-upstream-transparent-would-leak');
  });

  it('recognizes the managed OpenCode marker on the native Responses endpoint', async () => {
    vi.clearAllMocks();
    setupOpenCodeRoute({
      detectedCliType: 'codex',
      channelTargetProtocol: 'native',
    });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        JSON.stringify({
          id: 'resp_native',
          object: 'response',
          status: 'completed',
          model: 'opencode-upstream',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'native hello' }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        })
      ),
    });

    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
        'x-api-detect-cli': 'openCode',
      },
      { model: 'wire-opencode', stream: false, input: 'hello' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawRequest).toHaveBeenCalledWith(
      'https://opencode-upstream.example.com/v1/responses',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer sk-upstream' }),
      })
    );
    expect(JSON.parse(response.body).id).toBe('resp_native');
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ cliType: 'openCode', targetProtocol: 'openai-responses' })
    );
  });

  it('preserves OpenCode native stream passthrough after resolving its concrete endpoint', async () => {
    vi.clearAllMocks();
    setupOpenCodeRoute({
      detectedCliType: 'codex',
      channelTargetProtocol: 'native',
    });
    const partialChunk = Buffer.from(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial"}\n\n'
    );
    const upstreamHeaders = { 'content-type': 'text/event-stream' };
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      expect(config.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })).toBe(
        true
      );
      await config.onChunk?.(partialChunk);
      return { status: 200, headers: upstreamHeaders, body: partialChunk };
    });

    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
        'x-api-detect-cli': 'openCode',
      },
      { model: 'wire-opencode', stream: true, input: 'hello' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawStreamRequest).toHaveBeenCalledWith(
      'https://opencode-upstream.example.com/v1/responses',
      expect.objectContaining({ method: 'POST', preferElectronNet: true })
    );
    expect(response.body).toBe(partialChunk.toString('utf-8'));
    expect(response.body).not.toContain('event: error');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ targetProtocol: 'openai-responses' }),
      'success',
      expect.objectContaining({ statusCode: 200 }),
      expect.any(Object)
    );
  });

  const protocolCases = {
    'anthropic-messages': {
      path: '/v1/messages',
      detectedCliType: 'claudeCode' as const,
      routeHeaders: { 'x-api-key': 'sk-route' },
      requestBody: {
        model: 'wire-opencode',
        stream: false,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
        max_tokens: 64,
        output_config: { effort: 'high' },
      },
      responseBody: {
        id: 'msg_target',
        type: 'message',
        role: 'assistant',
        model: 'opencode-upstream',
        content: [{ type: 'text', text: 'matrix hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 2 },
      },
      downstreamShape: { type: 'message' },
    },
    'openai-responses': {
      path: '/v1/responses',
      detectedCliType: 'codex' as const,
      routeHeaders: { authorization: 'Bearer sk-route' },
      requestBody: {
        model: 'wire-opencode',
        stream: false,
        input: 'hello',
        reasoning: { effort: 'high' },
      },
      responseBody: {
        id: 'resp_target',
        object: 'response',
        status: 'completed',
        model: 'opencode-upstream',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'matrix hello' }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      },
      downstreamShape: { object: 'response' },
    },
    'openai-chat-completions': {
      path: '/v1/chat/completions',
      detectedCliType: 'openCode' as const,
      routeHeaders: { authorization: 'Bearer sk-route' },
      requestBody: {
        model: 'wire-opencode',
        stream: false,
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
        reasoning: { effort: 'high' },
      },
      responseBody: {
        id: 'chatcmpl_target',
        object: 'chat.completion',
        model: 'opencode-upstream',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'matrix hello' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      },
      downstreamShape: { object: 'chat.completion' },
    },
  } as const;
  const protocolMatrix = Object.keys(protocolCases).flatMap(sourceProtocol =>
    Object.keys(protocolCases).map(targetProtocol => ({ sourceProtocol, targetProtocol }))
  ) as Array<{
    sourceProtocol: keyof typeof protocolCases;
    targetProtocol: keyof typeof protocolCases;
  }>;

  it.each(protocolMatrix)(
    'routes OpenCode $sourceProtocol -> $targetProtocol with at most one conversion',
    async ({ sourceProtocol, targetProtocol }) => {
      vi.clearAllMocks();
      const source = protocolCases[sourceProtocol];
      const target = protocolCases[targetProtocol];
      setupOpenCodeRoute({
        detectedCliType: source.detectedCliType,
        channelTargetProtocol: sourceProtocol === targetProtocol ? 'native' : targetProtocol,
      });
      vi.mocked(httpRawRequest).mockResolvedValue({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify(target.responseBody)),
      });

      const request = createJsonRequest(
        source.path,
        {
          ...source.routeHeaders,
          'content-type': 'application/json',
          'x-api-detect-cli': 'openCode',
        },
        source.requestBody
      );
      const response = createMockResponse();

      await handleRequest(request, response);

      expect(httpRawRequest).toHaveBeenCalledWith(
        `https://opencode-upstream.example.com${target.path}`,
        expect.objectContaining({ method: 'POST', preferElectronNet: true })
      );
      const forwarded = vi.mocked(httpRawRequest).mock.calls[0]?.[1];
      const forwardedBody = JSON.parse(Buffer.from(forwarded?.body as Buffer).toString('utf-8'));
      expect(forwardedBody.model).toBe('opencode-upstream');
      expect(forwarded?.headers).not.toHaveProperty('x-api-detect-cli');
      if (targetProtocol === 'anthropic-messages') {
        expect(forwardedBody.output_config).toMatchObject({ effort: 'high' });
      } else if (targetProtocol === 'openai-chat-completions') {
        expect(forwardedBody.reasoning_effort).toBe('high');
        expect(forwardedBody.reasoning?.effort).toBeUndefined();
      } else {
        expect(forwardedBody.reasoning).toMatchObject({ effort: 'high' });
      }
      expect(JSON.parse(response.body)).toMatchObject(source.downstreamShape);
      expect(recordRouteRequest).toHaveBeenCalledWith(
        expect.objectContaining({ cliType: 'openCode', targetProtocol })
      );
    }
  );

  it('skips a lossy cross-protocol candidate and continues with a compatible channel', async () => {
    vi.clearAllMocks();
    const { rule, channel } = setupOpenCodeRoute({
      detectedCliType: 'codex',
      channelTargetProtocol: 'openai-chat-completions',
    });
    const compatibleChannel = {
      ...channel,
      siteId: 'site-opencode-native',
      accountId: 'account-opencode-native',
      apiKeyId: 'key-opencode-native',
      targetProtocol: 'native' as const,
    };
    vi.mocked(resolveChannels).mockReturnValue([channel, compatibleChannel]);
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify(protocolCases['openai-responses'].responseBody)),
    });

    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
        'x-api-detect-cli': 'openCode',
      },
      {
        model: 'wire-opencode',
        input: 'hello',
        metadata: { trace: 'must-not-be-dropped' },
      }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(resolveChannels).toHaveBeenCalledWith(rule, 'opencode-selected');
    expect(httpRawRequest).toHaveBeenCalledTimes(1);
    expect(httpRawRequest).toHaveBeenCalledWith(
      'https://opencode-upstream.example.com/v1/responses',
      expect.anything()
    );
    expect(JSON.parse(response.body)).toMatchObject({ object: 'response' });
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'neutral',
        error: 'adapter_request-adapt:unsupported_field:request.metadata',
      })
    );
  });

  it('returns an explicit compatibility error without upstream traffic when all candidates are lossy', async () => {
    vi.clearAllMocks();
    setupOpenCodeRoute({
      detectedCliType: 'codex',
      channelTargetProtocol: 'openai-chat-completions',
    });
    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
        'x-api-detect-cli': 'openCode',
      },
      {
        model: 'wire-opencode',
        input: 'hello',
        metadata: { trace: 'must-not-be-dropped' },
      }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error: 'no_compatible_route_channel',
      reasons: ['unsupported_field:request.metadata'],
    });
  });
});

describe('route-proxy-service quota exhaustion failover', () => {
  const rule = {
    id: 'rule-codex-quota-failover',
    cliType: 'codex' as const,
    pattern: 'gpt-4.1-mini',
    patternType: 'exact' as const,
  };
  const quotaChannel = {
    routeRuleId: rule.id,
    siteId: 'site-quota',
    accountId: 'account-quota',
    apiKeyId: 'key-quota',
    cliType: 'codex' as const,
    targetProtocol: 'native' as const,
    canonicalModel: 'gpt-4.1-mini',
    resolvedModel: 'quota-model',
  };
  const fallbackChannel = {
    ...quotaChannel,
    siteId: 'site-good',
    accountId: 'account-good',
    apiKeyId: 'key-good',
    resolvedModel: 'good-model',
  };

  function setupQuotaFailoverRoute(channels: Array<typeof quotaChannel>): void {
    const now = Date.now();
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
      routePathStates: {},
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
    vi.mocked(resolveChannels).mockReturnValue(channels);
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
  }

  function createQuotaTestRequest() {
    return createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', input: 'hi' }
    );
  }

  it('skips remaining attempts for an exhausted route path and continues to the next path', async () => {
    vi.clearAllMocks();
    setupQuotaFailoverRoute([quotaChannel, { ...quotaChannel }, fallbackChannel]);
    vi.mocked(httpRawRequest)
      .mockResolvedValueOnce({
        status: 403,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({
            error: {
              type: 'billing_error',
              message: 'INSUFFICIENT_BALANCE: Insufficient account balance',
            },
          })
        ),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({ ok: true })),
      });
    const response = createMockResponse();

    await handleRequest(createQuotaTestRequest(), response);

    expect(vi.mocked(resolveChannelCredentials).mock.calls.map(call => call[2])).toEqual([
      'key-quota',
      'key-good',
    ]);
    expect(httpRawRequest).toHaveBeenCalledTimes(2);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-quota' }),
      'failure',
      expect.objectContaining({
        statusCode: 403,
        error: expect.stringContaining('INSUFFICIENT_BALANCE'),
      }),
      expect.any(Object)
    );
    const quotaFailureLog = vi
      .mocked(recordRouteRequest)
      .mock.calls.find(([params]) => params.apiKeyId === 'key-quota')?.[0];
    expect(quotaFailureLog).toEqual(
      expect.objectContaining({
        outcome: 'failure',
        statusCode: 403,
        error: expect.stringContaining('余额不足，已跳过当前通道'),
      })
    );
    expect(quotaFailureLog?.error).toContain('INSUFFICIENT_BALANCE');
  });

  it('returns only a generic retryable error when quota-exhausted paths are exhausted', async () => {
    vi.clearAllMocks();
    setupQuotaFailoverRoute([quotaChannel]);
    vi.mocked(httpRawRequest).mockResolvedValueOnce({
      status: 403,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        JSON.stringify({
          error: {
            type: 'new_api_error',
            message: '用户额度不足, 剩余额度: 0; 预扣费额度失败',
          },
        })
      ),
    });
    const response = createMockResponse();

    await handleRequest(createQuotaTestRequest(), response);

    expect(response.statusCode).toBe(503);
    expect(response.headers['X-Route-Proxy-Error']).toBe('upstream_temporarily_unavailable');
    expect(JSON.parse(response.body)).toEqual({
      error: {
        message: 'No upstream route is currently available. Please retry.',
        type: 'server_error',
        param: null,
        code: 'upstream_temporarily_unavailable',
      },
    });
    expect(response.body).not.toMatch(/403|billing|quota|余额|额度|预扣费/i);
  });

  it('keeps unrelated 403 responses on the existing terminal path', async () => {
    vi.clearAllMocks();
    setupQuotaFailoverRoute([quotaChannel]);
    vi.mocked(httpRawRequest).mockResolvedValueOnce({
      status: 403,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        JSON.stringify({
          error: { type: 'permission_error', message: 'API key is forbidden' },
        })
      ),
    });
    const response = createMockResponse();

    await handleRequest(createQuotaTestRequest(), response);

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      error: { type: 'permission_error', message: 'API key is forbidden' },
    });
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-quota',
        outcome: 'failure',
        error: 'permission_error: API key is forbidden',
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

  it('matches successful affinity after targetProtocol is resolved for route candidates', async () => {
    vi.clearAllMocks();

    const now = Date.now();
    const rule = {
      id: 'rule-codex-affinity-late-target',
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
      canonicalModel: 'gpt-4.1-mini',
      resolvedModel: 'gpt-4.1-mini',
    };
    const channelB = {
      ...channelA,
      siteId: 'site-b',
      accountId: 'account-b',
      apiKeyId: 'key-b',
    };
    const preferredPath = {
      ...channelB,
      targetProtocol: 'openai-responses' as const,
      targetEndpoint: '/v1/responses',
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
      routePathStates: {
        [buildRoutePathStateKey(preferredPath)]: {
          ...preferredPath,
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
    vi.mocked(resolveChannels).mockReturnValue([channelA, channelB]);
    vi.mocked(resolveChannelTarget)
      .mockImplementationOnce(async () => ({
        targetProtocol: 'openai-responses',
        targetEndpoint: '/v1/responses',
      }))
      .mockImplementationOnce(async () => ({
        targetProtocol: 'openai-responses',
        targetEndpoint: '/v1/responses',
      }));
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

    expect(vi.mocked(resolveChannelCredentials).mock.calls.map(call => call[2])).toEqual(['key-b']);
    expect(vi.mocked(httpRawRequest).mock.calls.map(call => call[0])).toEqual([
      'https://key-b.example.com/v1/responses',
    ]);
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-b', targetProtocol: 'openai-responses' }),
      'success',
      expect.objectContaining({ statusCode: 200 }),
      expect.any(Object)
    );
  });

  it('retries a non-streaming HTTP 200 all-zero usage channel before trying the next route candidate', async () => {
    vi.clearAllMocks();

    const now = Date.now();
    const rule = {
      id: 'rule-codex-zero-usage',
      cliType: 'codex' as const,
      pattern: 'gpt-4.1-mini',
      patternType: 'exact' as const,
    };
    const zeroUsageChannel = {
      routeRuleId: rule.id,
      siteId: 'site-a',
      accountId: 'account-a',
      apiKeyId: 'key-a',
      cliType: 'codex' as const,
      targetProtocol: 'native' as const,
      canonicalModel: 'gpt-4.1-mini',
      resolvedModel: 'zero-model',
    };
    const fallbackChannel = {
      ...zeroUsageChannel,
      resolvedModel: 'good-model',
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
      routePathStates: {},
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
    vi.mocked(resolveChannels).mockReturnValue([zeroUsageChannel, fallbackChannel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
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
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({
            id: 'resp_zero',
            output: [{ content: [{ type: 'output_text', text: 'bad' }] }],
            usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          })
        ),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({
            id: 'resp_zero_retry',
            output: [{ content: [{ type: 'output_text', text: 'still bad' }] }],
            usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          })
        ),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({
            id: 'resp_good',
            output: [{ content: [{ type: 'output_text', text: 'ok' }] }],
            usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
          })
        ),
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

    expect(httpRawRequest).toHaveBeenCalledTimes(3);
    const upstreamBodies = vi
      .mocked(httpRawRequest)
      .mock.calls.map(([, config]) =>
        JSON.parse(
          Buffer.isBuffer(config.body) ? config.body.toString('utf-8') : String(config.body)
        )
      );
    expect(upstreamBodies.map(body => body.model)).toEqual([
      'zero-model',
      'zero-model',
      'good-model',
    ]);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ id: 'resp_good' });
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedModel: 'zero-model' }),
      'failure',
      expect.objectContaining({
        statusCode: 200,
        error: 'empty_response_zero_usage',
      }),
      expect.any(Object)
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedModel: 'zero-model',
        outcome: 'failure',
        statusCode: 200,
        totalTokens: 0,
        error: 'empty_response_zero_usage',
      })
    );
    expect(
      vi
        .mocked(recordRoutePathOutcome)
        .mock.calls.filter(
          ([channel, outcome, meta]) =>
            channel.resolvedModel === 'zero-model' &&
            outcome === 'failure' &&
            meta?.error === 'empty_response_zero_usage'
        )
    ).toHaveLength(1);
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedModel: 'good-model' }),
      'success',
      expect.objectContaining({ statusCode: 200 }),
      expect.any(Object)
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedModel: 'good-model',
        outcome: 'success',
        statusCode: 200,
        totalTokens: 7,
      })
    );
  });

  it('keeps the same route candidate when a zero-usage retry succeeds', async () => {
    vi.clearAllMocks();

    const now = Date.now();
    const rule = {
      id: 'rule-codex-zero-usage-retry-success',
      cliType: 'codex' as const,
      pattern: 'gpt-4.1-mini',
      patternType: 'exact' as const,
    };
    const zeroUsageChannel = {
      routeRuleId: rule.id,
      siteId: 'site-a',
      accountId: 'account-a',
      apiKeyId: 'key-a',
      cliType: 'codex' as const,
      targetProtocol: 'native' as const,
      canonicalModel: 'gpt-4.1-mini',
      resolvedModel: 'zero-model',
    };
    const fallbackChannel = {
      ...zeroUsageChannel,
      resolvedModel: 'good-model',
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
      routePathStates: {},
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
    vi.mocked(resolveChannels).mockReturnValue([zeroUsageChannel, fallbackChannel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
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
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({
            id: 'resp_zero',
            output: [{ content: [{ type: 'output_text', text: 'bad' }] }],
            usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          })
        ),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({
            id: 'resp_retry_good',
            output: [{ content: [{ type: 'output_text', text: 'ok' }] }],
            usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
          })
        ),
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

    expect(resolveChannelCredentials).toHaveBeenCalledTimes(1);
    expect(httpRawRequest).toHaveBeenCalledTimes(2);
    const upstreamBodies = vi
      .mocked(httpRawRequest)
      .mock.calls.map(([, config]) =>
        JSON.parse(
          Buffer.isBuffer(config.body) ? config.body.toString('utf-8') : String(config.body)
        )
      );
    expect(upstreamBodies.map(body => body.model)).toEqual(['zero-model', 'zero-model']);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ id: 'resp_retry_good' });
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedModel: 'zero-model' }),
      'success',
      expect.objectContaining({ statusCode: 200 }),
      expect.any(Object)
    );
    const routePathCalls = vi.mocked(recordRoutePathOutcome).mock.calls;
    expect(routePathCalls.some(([channel]) => channel.resolvedModel === 'good-model')).toBe(false);
    expect(
      routePathCalls.some(
        ([channel, outcome, meta]) =>
          channel.resolvedModel === 'zero-model' &&
          outcome === 'failure' &&
          meta?.error === 'empty_response_zero_usage'
      )
    ).toBe(false);
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedModel: 'zero-model',
        outcome: 'success',
        statusCode: 200,
        totalTokens: 7,
      })
    );
    expect(
      vi
        .mocked(recordRouteRequest)
        .mock.calls.some(([entry]) => entry.resolvedModel === 'good-model')
    ).toBe(false);
  });

  it('does not return a non-streaming HTTP 200 all-zero usage body when no fallback remains', async () => {
    vi.clearAllMocks();

    const now = Date.now();
    const rule = {
      id: 'rule-codex-zero-usage-terminal',
      cliType: 'codex' as const,
      pattern: 'gpt-4.1-mini',
      patternType: 'exact' as const,
    };
    const zeroUsageChannel = {
      routeRuleId: rule.id,
      siteId: 'site-a',
      accountId: 'account-a',
      apiKeyId: 'key-a',
      cliType: 'codex' as const,
      targetProtocol: 'native' as const,
      canonicalModel: 'gpt-4.1-mini',
      resolvedModel: 'zero-model',
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
      routePathStates: {},
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
    vi.mocked(resolveChannels).mockReturnValue([zeroUsageChannel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
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
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({
            id: 'resp_zero',
            output: [{ content: [{ type: 'output_text', text: 'bad' }] }],
            usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          })
        ),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({
            id: 'resp_zero_retry',
            output: [{ content: [{ type: 'output_text', text: 'still bad' }] }],
            usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          })
        ),
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

    expect(httpRawRequest).toHaveBeenCalledTimes(2);
    const upstreamBodies = vi
      .mocked(httpRawRequest)
      .mock.calls.map(([, config]) =>
        JSON.parse(
          Buffer.isBuffer(config.body) ? config.body.toString('utf-8') : String(config.body)
        )
      );
    expect(upstreamBodies.map(body => body.model)).toEqual(['zero-model', 'zero-model']);
    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.body)).toEqual({
      error: 'all_channels_failed',
      message: 'All upstream channels failed',
    });
    expect(response.body).not.toContain('resp_zero');
    expect(response.body).not.toContain('resp_zero_retry');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedModel: 'zero-model' }),
      'failure',
      expect.objectContaining({
        statusCode: 200,
        error: 'empty_response_zero_usage',
      }),
      expect.any(Object)
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedModel: 'zero-model',
        outcome: 'failure',
        statusCode: 200,
        totalTokens: 0,
        error: 'empty_response_zero_usage',
      })
    );
    expect(
      vi
        .mocked(recordRoutePathOutcome)
        .mock.calls.filter(
          ([channel, outcome, meta]) =>
            channel.resolvedModel === 'zero-model' &&
            outcome === 'failure' &&
            meta?.error === 'empty_response_zero_usage'
        )
    ).toHaveLength(1);
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
  const disabledResponseCases: Array<{
    cliType: 'claudeCode' | 'codex';
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

  it('keeps bearer-token auth for supported CLIs', () => {
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

  it.each(['/v1/messages', '/v1/responses', '/v1/chat/completions'])(
    'accepts Grok Build x-api-key auth on %s',
    url => {
      const token = extractRouteApiKey(
        {
          headers: {
            'x-api-key': 'sk-route-grok',
            authorization: 'Bearer ignored-bearer',
          },
          url,
        },
        'grokBuild'
      );

      expect(token).toBe('sk-route-grok');
    }
  );

  it('falls back to bearer auth for Grok Build when x-api-key is absent', () => {
    const token = extractRouteApiKey(
      {
        headers: { authorization: 'Bearer sk-route-grok-bearer' },
        url: '/v1/chat/completions',
      },
      'grokBuild'
    );

    expect(token).toBe('sk-route-grok-bearer');
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
  function setupStreamingRoute(cliType: 'claudeCode' | 'codex', model: string) {
    const rule = {
      id: `rule-${cliType}-stream`,
      cliType,
      pattern: model,
      patternType: 'exact' as const,
    };
    const channel = {
      routeRuleId: rule.id,
      siteId: 'site-upstream',
      accountId: 'account-upstream',
      apiKeyId: 'key-upstream',
      cliType,
      canonicalModel: model,
      resolvedModel: model,
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
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          [model]: {
            canonicalName: model,
            aliases: [model],
            sources: [],
            vendor: cliType === 'claudeCode' ? ('anthropic' as const) : ('openai' as const),
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
      getSiteById: vi.fn(() => ({ id: 'site-upstream', name: 'Upstream' })),
      getAccountById: vi.fn(() => ({ id: 'account-upstream', account_name: 'default' })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue(cliType);
    vi.mocked(extractModelFromBody).mockReturnValue(model);
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

    return channel;
  }

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
    const customToolCall = {
      id: 'ctc_1',
      type: 'custom_tool_call',
      call_id: 'call_1',
      name: 'shell',
      input: '{}',
    };
    const chunks = [
      Buffer.from('data: {"usage":{"prompt_tokens":5}}\n\n'),
      Buffer.from(
        `event: response.output_item.added\ndata: ${JSON.stringify({
          type: 'response.output_item.added',
          output_index: 0,
          item: customToolCall,
        })}\n\n`
      ),
      Buffer.from(
        `event: response.completed\ndata: ${JSON.stringify({
          type: 'response.completed',
          response: {
            output: [customToolCall],
            usage: { completion_tokens: 7, total_tokens: 12 },
          },
        })}\n\n`
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
    expect(response.write).toHaveBeenCalledTimes(3);
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

  it('retries an empty SSE response once on the same channel before recording failure', async () => {
    vi.clearAllMocks();
    const model = 'grok-4.5';
    const channel = setupStreamingRoute('claudeCode', model);
    const completedStream = buildClaudeTextSse();
    const upstreamHeaders = { 'content-type': 'text/event-stream' };

    vi.mocked(httpRawStreamRequest)
      .mockImplementationOnce(async (_url, config = {}) => {
        expect(
          config.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })
        ).toBe(true);
        return { status: 200, headers: upstreamHeaders, body: Buffer.alloc(0) };
      })
      .mockImplementationOnce(async (_url, config = {}) => {
        expect(
          config.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })
        ).toBe(true);
        await config.onChunk?.(completedStream);
        return { status: 200, headers: upstreamHeaders, body: completedStream };
      });

    const request = createJsonRequest(
      '/v1/messages',
      { 'x-api-key': 'sk-route', 'content-type': 'application/json' },
      { model, stream: true, messages: [{ role: 'user', content: 'hi' }] }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawStreamRequest).toHaveBeenCalledTimes(2);
    expect(response.body).toBe(completedStream.toString('utf-8'));
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: channel.apiKeyId }),
      'success',
      expect.objectContaining({ statusCode: 200 }),
      expect.any(Object)
    );
    expect(recordRoutePathOutcome).not.toHaveBeenCalledWith(
      expect.anything(),
      'failure',
      expect.anything(),
      expect.anything()
    );
  });

  it('forwards native upstream SSE error events and records the explicit failure', async () => {
    vi.clearAllMocks();
    const model = 'grok-4.5';
    const channel = setupStreamingRoute('claudeCode', model);
    const errorChunk = Buffer.from(
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n'
    );
    const upstreamHeaders = { 'content-type': 'text/event-stream' };

    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      expect(config.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })).toBe(
        true
      );
      await config.onChunk?.(errorChunk);
      return { status: 200, headers: upstreamHeaders, body: errorChunk };
    });

    const request = createJsonRequest(
      '/v1/messages',
      { 'x-api-key': 'sk-route', 'content-type': 'application/json' },
      { model, stream: true, messages: [{ role: 'user', content: 'hi' }] }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.body).toBe(errorChunk.toString('utf-8'));
    expect(response.body).not.toContain('upstream stream ended before terminal SSE event');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: channel.apiKeyId }),
      'failure',
      expect.objectContaining({ error: 'upstream_streaming_error:overloaded_error' }),
      expect.any(Object)
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: channel.apiKeyId,
        outcome: 'failure',
        error: 'upstream_streaming_error:overloaded_error',
      })
    );
  });

  it('forwards native response.failed events and records the explicit failure', async () => {
    vi.clearAllMocks();
    const model = 'gpt-5.6-sol';
    const channel = setupStreamingRoute('codex', model);
    const failedChunk = Buffer.from(
      'event: response.failed\ndata: {"type":"response.failed","response":{"error":{"type":"server_error","code":"upstream_failed","message":"Failed"}}}\n\n'
    );
    const upstreamHeaders = { 'content-type': 'text/event-stream' };

    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      expect(config.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })).toBe(
        true
      );
      await config.onChunk?.(failedChunk);
      return { status: 200, headers: upstreamHeaders, body: failedChunk };
    });

    const request = createJsonRequest(
      '/v1/responses',
      { authorization: 'Bearer sk-route', 'content-type': 'application/json' },
      { model, stream: true, input: 'hi' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.body).toBe(failedChunk.toString('utf-8'));
    expect(response.body).not.toContain('upstream stream ended before terminal SSE event');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: channel.apiKeyId }),
      'failure',
      expect.objectContaining({ error: 'upstream_streaming_error:server_error' }),
      expect.any(Object)
    );
  });

  it('accepts response.incomplete as a terminal Responses event when output is present', async () => {
    vi.clearAllMocks();
    const model = 'gpt-5.6-sol';
    const channel = setupStreamingRoute('codex', model);
    const incompleteChunk = Buffer.from(
      'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"output":[{"type":"local_shell_call","id":"lsc_1","call_id":"call_1","action":{"type":"exec","command":["pwd"]},"status":"completed"}],"usage":{"input_tokens":10,"output_tokens":4,"total_tokens":14}}}\n\n'
    );
    const upstreamHeaders = { 'content-type': 'text/event-stream' };

    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      expect(config.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })).toBe(
        true
      );
      await config.onChunk?.(incompleteChunk);
      return { status: 200, headers: upstreamHeaders, body: incompleteChunk };
    });

    const request = createJsonRequest(
      '/v1/responses',
      { authorization: 'Bearer sk-route', 'content-type': 'application/json' },
      { model, stream: true, input: 'hi' }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.body).toBe(incompleteChunk.toString('utf-8'));
    expect(response.body).not.toContain('event: error');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: channel.apiKeyId }),
      'success',
      expect.objectContaining({ statusCode: 200 }),
      expect.any(Object)
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
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
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
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
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

  it('forwards native streams that end without a terminal event unchanged', async () => {
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
    expect(response.body).toBe(incompleteChunk.toString('utf-8'));
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
      })
    );
  });

  it('falls back before commit when a native completed stream has zero usage and no output', async () => {
    vi.clearAllMocks();

    const rule = {
      id: 'rule-codex-empty-completed',
      cliType: 'codex' as const,
      pattern: 'gpt-4.1-mini',
      patternType: 'exact' as const,
    };
    const emptyChannel = {
      routeRuleId: rule.id,
      siteId: 'site-openai',
      accountId: 'account-openai',
      apiKeyId: 'key-openai-empty',
      cliType: 'codex' as const,
      canonicalModel: 'gpt-4.1-mini',
      resolvedModel: 'gpt-4.1-mini',
    };
    const fallbackChannel = {
      ...emptyChannel,
      siteId: 'site-openai-fallback',
      accountId: 'account-openai-fallback',
      apiKeyId: 'key-openai-fallback',
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
    const emptyCompletedChunk = Buffer.from(
      'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}}\n\n'
    );
    const fallbackTextChunk = Buffer.from(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"fallback"}\n\n'
    );
    const fallbackCompletedChunk = Buffer.from(
      'event: response.completed\ndata: {"type":"response.completed","response":{"output_text":"fallback"}}\n\n'
    );
    const fallbackBody = Buffer.concat([fallbackTextChunk, fallbackCompletedChunk]);

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
    vi.mocked(resolveChannels).mockReturnValue([emptyChannel, fallbackChannel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://upstream.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockResolvedValue({
      ...emptyChannel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 0,
      successRate: 0,
      updatedAt: 1,
    });
    let upstreamCall = 0;
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      upstreamCall += 1;
      const headers = { 'content-type': 'text/event-stream' };
      const accepted = config.onResponse?.({ status: 200, statusText: 'OK', headers });
      expect(accepted).toBe(true);
      if (upstreamCall === 1) {
        await config.onChunk?.(emptyCompletedChunk);
        return {
          status: 200,
          headers,
          body: emptyCompletedChunk,
          firstByteLatencyMs: 4,
        };
      }

      await config.onChunk?.(fallbackTextChunk);
      await config.onChunk?.(fallbackCompletedChunk);
      return {
        status: 200,
        headers,
        body: fallbackBody,
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
    expect(response.body).toContain('fallback');
    expect(response.body).toBe(fallbackBody.toString('utf-8'));
    expect(response.body).not.toContain('event: error');
    expect(httpRawStreamRequest).toHaveBeenCalledTimes(2);
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-openai-empty' }),
      'failure',
      expect.objectContaining({ statusCode: 200, error: 'empty_response_zero_usage' }),
      expect.any(Object)
    );
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-openai-fallback' }),
      'success',
      expect.objectContaining({ statusCode: 200 }),
      expect.any(Object)
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-openai-empty',
        outcome: 'failure',
        error: 'empty_response_zero_usage',
      })
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-openai-fallback',
        outcome: 'success',
      })
    );
    expect(recordRouteRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-openai-empty',
        outcome: 'success',
      })
    );
  });

  it('forwards native completed streams with output but zero usage unchanged', async () => {
    vi.clearAllMocks();

    const rule = {
      id: 'rule-codex-output-zero-usage',
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
    const textChunk = Buffer.from(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hello"}\n\n'
    );
    const completedChunk = Buffer.from(
      'event: response.completed\ndata: {"type":"response.completed","response":{"output_text":"hello","usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}}\n\n'
    );
    const fullBody = Buffer.concat([textChunk, completedChunk]);

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
      await config.onChunk?.(textChunk);
      await config.onChunk?.(completedChunk);
      return {
        status: 200,
        headers,
        body: fullBody,
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
    expect(response.body).toContain('hello');
    expect(response.body).toBe(fullBody.toString('utf-8'));
    expect(response.body).not.toContain('event: error');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-openai' }),
      'success',
      expect.objectContaining({ statusCode: 200 }),
      expect.any(Object)
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

  it('forwards standard native Claude SSE bytes without normalizing stop reasons', async () => {
    vi.clearAllMocks();

    const rule = {
      id: 'rule-claude-tool-stop',
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
      },
      cliThinkingEffortSelections: {
        claudeCode: 'high',
        codex: null,
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
    const toolUseChunk = Buffer.from(
      [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_tool","type":"message","role":"assistant","model":"claude-opus-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read","input":{}}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"file_path\\":\\"README.md\\"}"}}',
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

    let upstreamBody: Record<string, unknown> | undefined;
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn(() => ({ id: 'site-claude', name: 'Claude-compatible' })),
      getAccountById: vi.fn(() => ({ id: 'account-claude', account_name: 'default' })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('claudeCode');
    vi.mocked(extractModelFromBody).mockReturnValue('claude-client-model');
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
      upstreamBody = JSON.parse(Buffer.from(config.body as Buffer).toString('utf-8'));
      const headers = { 'content-type': 'text/event-stream' };
      const accepted = config.onResponse?.({ status: 200, statusText: 'OK', headers });
      expect(accepted).toBe(true);
      await config.onChunk?.(toolUseChunk);
      await config.onChunk?.(terminalChunk);
      return {
        status: 200,
        headers,
        body: Buffer.concat([toolUseChunk, terminalChunk]),
        firstByteLatencyMs: 4,
      };
    });

    const request = createJsonRequest(
      '/v1/messages?beta=true',
      {
        'x-api-key': 'sk-route',
        'content-type': 'application/json',
      },
      {
        model: 'claude-client-model',
        stream: true,
        messages: [{ role: 'user', content: 'read' }],
        system: [{ type: 'text', text: 'Keep this system prompt' }],
        tools: [
          {
            name: 'Read',
            description: 'Read a file',
            input_schema: { type: 'object', properties: { file_path: { type: 'string' } } },
          },
        ],
        metadata: { source: 'claude-code', trace_id: 'trace-1' },
        thinking: { type: 'enabled', budget_tokens: 2048 },
        output_config: { effort: 'low', format: 'text' },
      }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(upstreamBody).toEqual({
      model: 'claude-opus-4-6',
      stream: true,
      messages: [{ role: 'user', content: 'read' }],
      system: [{ type: 'text', text: 'Keep this system prompt' }],
      tools: [
        {
          name: 'Read',
          description: 'Read a file',
          input_schema: { type: 'object', properties: { file_path: { type: 'string' } } },
        },
      ],
      metadata: { source: 'claude-code', trace_id: 'trace-1' },
      thinking: { type: 'enabled', budget_tokens: 2048 },
      output_config: { effort: 'high', format: 'text' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(Buffer.concat([toolUseChunk, terminalChunk]).toString('utf-8'));
    expect(response.body).toContain('"stop_reason":"end_turn"');
    expect(response.body).not.toContain('event: error');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-claude' }),
      'success',
      expect.objectContaining({ statusCode: 200 }),
      expect.any(Object)
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-claude',
        outcome: 'success',
      })
    );
  });

  it('blocks a malformed native Claude frame after commit and records the attempt as failed', async () => {
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
    const malformedChunk = Buffer.from(
      [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_bad","type":"message","role":"assistant","model":"claude-opus-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
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
      await config.onChunk?.(malformedChunk);
      await config.onChunk?.(terminalChunk);
      return {
        status: 200,
        headers,
        body: Buffer.concat([malformedChunk, terminalChunk]),
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
    expect(response.body).toContain('event: message_start');
    expect(response.body).toContain('event: content_block_start');
    expect(response.body.match(/event: content_block_start/g)).toHaveLength(1);
    expect(response.body).not.toContain('event: content_block_delta');
    expect(response.body).not.toContain('event: message_stop');
    expect(response.body).toContain('event: error');
    expect(response.body).toContain('invalid Anthropic content block start');
    expect(httpRawStreamRequest).toHaveBeenCalledTimes(1);
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-claude' }),
      'failure',
      expect.objectContaining({ error: expect.stringContaining('invalid_content_block_start') }),
      expect.any(Object)
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-claude',
        outcome: 'failure',
        error: expect.stringContaining('invalid_content_block_start'),
      })
    );
  });

  it('retries native Claude pre-commit guard failures within the configured path limit', async () => {
    vi.clearAllMocks();

    const rule = {
      id: 'rule-claude-precommit-fallback',
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
        displayItems: [
          {
            id: 'manual:claude-opus-4-6',
            vendor: 'claude' as const,
            canonicalName: 'claude-opus-4-6',
            sourceKeys: ['site-claude:account-claude:claude-opus-4-6'],
            originalModelOrder: ['claude-opus-4-6'],
            priorityConfig: { sitePriorities: {}, apiKeyPriorities: {} },
            runtimeConfig: {
              maxAttemptsPerRoutePath: 3,
              successRateWindowMinutes: 60,
              disableDurationMinutes: 60,
              minSuccessRate: 0.3,
            },
            mode: 'manual' as const,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        vendorPriorities: {},
      },
    };
    const malformedChunk = Buffer.from(
      [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_bad","type":"message","role":"assistant","model":"claude-opus-4-6","content":[]}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"must-not-leak"}}',
        '',
        '',
      ].join('\n'),
      'utf-8'
    );
    const oversizedFrame = Buffer.from(
      `event: vendor_notice\ndata: ${'x'.repeat(1024 * 1024)}\n\n`,
      'utf-8'
    );
    const successChunk = buildClaudeTextSse('fallback-ok');
    let upstreamAttempt = 0;

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      getSiteById: vi.fn((siteId: string) => ({ id: siteId, name: 'Claude-compatible' })),
      getAccountById: vi.fn((accountId: string) => ({ id: accountId, account_name: 'default' })),
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
      upstreamAttempt += 1;
      const headers = { 'content-type': 'text/event-stream' };
      expect(config.onResponse?.({ status: 200, statusText: 'OK', headers })).toBe(true);
      const chunk =
        upstreamAttempt === 1
          ? malformedChunk
          : upstreamAttempt === 2
            ? oversizedFrame
            : successChunk;
      await config.onChunk?.(chunk);
      return { status: 200, headers, body: chunk, firstByteLatencyMs: 3 };
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

    expect(upstreamAttempt).toBe(3);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(successChunk.toString('utf-8'));
    expect(response.body).not.toContain('must-not-leak');
    expect(response.body).not.toContain('vendor_notice');
    expect(response.body).not.toContain('event: error');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-claude' }),
      'failure',
      expect.objectContaining({
        error: 'malformed_streaming_response:unexpected_content_block_delta',
      }),
      expect.any(Object)
    );
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-claude' }),
      'success',
      expect.objectContaining({ statusCode: 200 }),
      expect.any(Object)
    );
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-claude' }),
      'failure',
      expect.objectContaining({ error: 'malformed_streaming_response:sse_frame_too_large' }),
      expect.any(Object)
    );
  });

  it('preserves native Claude CRLF frames across split UTF-8 chunks and unknown events', async () => {
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
        ': keepalive',
        '',
        'event: ping',
        'data: {"type":"ping"}',
        '',
        'event: vendor_notice',
        'data: opaque-vendor-payload',
        '',
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_think","type":"message","role":"assistant","model":"claude-opus-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"检查任务"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        '',
      ].join('\r\n'),
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
      ].join('\r\n'),
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
      const utf8Split = thinkingChunk.indexOf(Buffer.from('检查', 'utf-8')) + 1;
      await config.onChunk?.(thinkingChunk.subarray(0, utf8Split));
      await config.onChunk?.(thinkingChunk.subarray(utf8Split));
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
    expect(response.body).toBe(Buffer.concat([thinkingChunk, terminalChunk]).toString('utf-8'));
    expect(response.body).not.toContain('event: error');
    expect(response.body).toContain('event: message_stop');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-claude' }),
      'success',
      expect.objectContaining({ statusCode: 200 }),
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
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
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

  it('uses bearer auth override without forwarding x-api-key', () => {
    const headers = buildUpstreamHeaders(
      {
        'x-api-key': 'sk-route-key',
        authorization: 'Bearer sk-route-key',
        'content-type': 'application/json',
      },
      'token.sensenova.cn',
      42,
      'sk-upstream-key',
      'claudeCode',
      'bearer'
    );

    expect(headers.authorization).toBe('Bearer sk-upstream-key');
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('does not forward Grok Build identity and conversation headers upstream', () => {
    const headers = buildUpstreamHeaders(
      {
        authorization: 'Bearer sk-route-key',
        'x-grok-client-identifier': 'grok-shell',
        'x-grok-conv-id': 'conversation-1',
        'x-grok-session-id': 'session-1',
        'x-grok-user-id': 'user-1',
      },
      'relay.example.com',
      42,
      'sk-upstream-key',
      'grokBuild',
      'bearer'
    );

    expect(headers.authorization).toBe('Bearer sk-upstream-key');
    expect(Object.keys(headers).some(name => name.toLowerCase().startsWith('x-grok-'))).toBe(false);
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
});
