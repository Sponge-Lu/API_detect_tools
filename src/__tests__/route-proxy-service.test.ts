import { EventEmitter } from 'events';
import { Readable } from 'stream';
import type { GlobalModelRoute } from '../shared/types/route-proxy';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// request_fatal 负缓存是模块级状态，必须每个用例前清空，否则
// 前面用例的 400 会把后面用例的候选通道整批跳过。
beforeEach(() => {
  clearRequestFatalNegativeCache();
  vi.mocked(findConfigFileProfileByRouteApiKey).mockReset();
  vi.mocked(findConfigFileProfileByRouteApiKey).mockImplementation(async apiKey =>
    apiKey === 'wrong-key' ? null : ({ id: 'profile-test', name: 'Test Client' } as never)
  );
});

const { routeDiagnosticLog } = vi.hoisted(() => ({ routeDiagnosticLog: vi.fn() }));

vi.mock('../main/utils/logger', () => ({
  default: {
    // 顶层方法也要 mock：侧车服务直接用 Logger.error，缺了会让 catch 处理器自身抛出
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    // 失败终结的 'Route request completed' 走 warn，与 debug 一同捕获才能断言诊断。
    scope: (name: string) => ({
      debug: name === 'RouteProxyService' ? routeDiagnosticLog : vi.fn(),
      info: vi.fn(),
      warn: name === 'RouteProxyService' ? routeDiagnosticLog : vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: {
    mutateConfig: async <T>(operation: () => Promise<T>) => operation(),
    saveConfig: vi.fn(async () => undefined),
  },
}));

vi.mock('../main/config-file-profile-service', () => ({
  findConfigFileProfileByRouteApiKey: vi.fn(async (apiKey: string) =>
    apiKey === 'wrong-key' ? null : { id: 'profile-test', name: 'Test Client' }
  ),
}));

vi.mock('../main/route-state-affinity-service', () => ({
  routeStateAffinityService: {
    get: vi.fn(async () => null),
    bind: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  },
}));

vi.mock('../main/route-session-activity-service', () => ({
  routeSessionActivityService: {
    touch: vi.fn(),
    hydrate: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
    removeByProfile: vi.fn(async () => 0),
  },
}));

vi.mock('../main/route-rule-engine', () => ({
  detectCliTypeFromPath: vi.fn(),
  extractModelFromBody: vi.fn(),
  extractModelFromPath: vi.fn(),
  sortRules: vi.fn(),
  findMatchingProtocolRule: vi.fn(),
}));

vi.mock('../main/route-channel-resolver', () => ({
  resolveChannels: vi.fn(),
  resolveChannelCredentials: vi.fn(),
  resolveChannelTarget: vi.fn(
    async (channel: { targetProtocol?: string; targetEndpoint?: string }) => ({
      targetProtocol: channel.targetProtocol ?? 'native',
      targetEndpoint:
        channel.targetEndpoint ??
        (channel.targetProtocol === 'anthropic-messages'
          ? '/v1/messages'
          : channel.targetProtocol === 'openai-responses'
            ? '/v1/responses'
            : channel.targetProtocol === 'openai-chat-completions'
              ? '/v1/chat/completions'
              : '/mock-endpoint'),
    })
  ),
}));

vi.mock('../main/route-stats-service', () => {
  const isRoutePathDisabled = vi.fn(() => false);
  return {
    sortChannelsByScore: vi.fn((channels: unknown[]) => channels),
    recordOutcome: vi.fn(),
    isRoutePathDisabled,
    beginRoutePathAttempt: vi.fn((key: unknown) => !isRoutePathDisabled(key as never)),
    getRoutePathDisabledUntil: vi.fn(() => undefined),
    recordRoutePathOutcome: vi.fn(),
    isRouteEndpointUnsupported: vi.fn(() => false),
    recordRouteEndpointUnsupported: vi.fn(),
  };
});

vi.mock('../main/route-analytics-service', () => ({
  recordRouteRequest: vi.fn(),
}));

vi.mock('../main/utils/http-client', () => ({
  httpRawRequest: vi.fn(),
  httpRawStreamRequest: vi.fn(),
}));

import {
  applySessionChannelAffinity,
  applySuccessfulRoutePathAffinity,
  buildRequestFatalFingerprint,
  clearRequestFatalNegativeCache,
  pickDistributedChannelIndex,
  buildChannelAttemptPlan,
  buildUpstreamRequestUrl,
  buildUpstreamHeaders,
  classifyRouteEndpointOperation,
  classifyRouteStatusCode,
  detectMarkedRouteCliType,
  extractRouteApiKey,
  extractRouteCredentialCandidates,
  extractRouteReasoningEffort,
  applyRouteThinkingEffortOverride,
  extractUsageFromBody,
  findProviderOwnedStateReference,
  handleRequest,
  isUpstreamQuotaExhaustionResponse,
  resolveRouteRuntimeConfig,
  resolveRouteProfileCredential,
  summarizeUpstreamFailureBodyForLog,
} from '../main/route-proxy-service';
import { unifiedConfigManager } from '../main/unified-config-manager';
import { findConfigFileProfileByRouteApiKey } from '../main/config-file-profile-service';
import { routeStateAffinityService } from '../main/route-state-affinity-service';
import { routeSessionBindingService } from '../main/route-session-binding-service';
import { STREAMING_VALIDATION_MAX_SSE_FRAME_BYTES } from '../main/streaming-protocol-validator';
import {
  detectCliTypeFromPath,
  extractModelFromBody,
  extractModelFromPath,
  findMatchingProtocolRule as findMatchingRule,
  sortRules,
} from '../main/route-rule-engine';
import {
  resolveChannels,
  resolveChannelCredentials,
  resolveChannelTarget,
} from '../main/route-channel-resolver';
import {
  buildTargetLockRouteApiKey as buildProbeLockRouteApiKey,
  clearRouteTargetLockState as clearRouteProbeLockTerminalFailure,
  getRouteTargetLockFirstUpstreamResult as getRouteProbeLockFirstUpstreamResult,
  subscribeRouteTargetLockTerminalFailure as subscribeRouteProbeLockTerminalFailure,
  MAX_TARGET_LOCK_UPSTREAM_ATTEMPTS as MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS,
  type RouteTargetLockTerminalFailure as RouteProbeLockTerminalFailure,
} from '../main/route-target-lock';
import { httpRawRequest, httpRawStreamRequest } from '../main/utils/http-client';
import {
  getRoutePathDisabledUntil,
  isRouteEndpointUnsupported,
  isRoutePathDisabled,
  recordRouteEndpointUnsupported,
  recordRoutePathOutcome,
} from '../main/route-stats-service';
import { recordRouteRequest } from '../main/route-analytics-service';
import * as modelMetadataService from '../main/model-metadata-service';
import {
  buildRouteApiKeyPriorityKey,
  buildRoutePathStateKey,
  DEFAULT_ROUTING_CONFIG,
  DEFAULT_ROUTE_RUNTIME_CONFIG,
  DEFAULT_ROUTE_SESSION_ROUTING_CONFIG,
  ROUTE_SUCCESSFUL_PATH_AFFINITY_MS,
  type RoutePathState,
  type RouteClientRoutingConfig,
  type RouteInstance,
} from '../shared/types/route-proxy';

function createJsonRequest(
  url: string,
  headers: Record<string, string>,
  body: unknown
): Parameters<typeof handleRequest>[0] {
  const requestBody =
    url.split('?')[0] === '/v1/responses' &&
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    !('store' in body) &&
    !('previous_response_id' in body) &&
    !('conversation' in body)
      ? { ...body, store: false }
      : body;
  const request = Readable.from([Buffer.from(JSON.stringify(requestBody))]) as Readable & {
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
  body: unknown,
  options: { deferBody?: boolean } = {}
): Parameters<typeof handleRequest>[0] & EventEmitter {
  const requestBody =
    url.split('?')[0] === '/v1/responses' &&
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    !('store' in body) &&
    !('previous_response_id' in body) &&
    !('conversation' in body)
      ? { ...body, store: false }
      : body;
  const request = new Readable({
    read() {
      if (options.deferBody) {
        return;
      }
      this.push(Buffer.from(JSON.stringify(requestBody)));
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
  listenerCount: EventEmitter['listenerCount'];
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
    listenerCount: events.listenerCount.bind(events),
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
    listenerCount: EventEmitter['listenerCount'];
    off: EventEmitter['off'];
    once: EventEmitter['once'];
    statusCode: number;
    write: ReturnType<typeof vi.fn>;
    writeHead: ReturnType<typeof vi.fn>;
  };
}

function getRouteDiagnostics(message: string): Record<string, unknown>[] {
  return routeDiagnosticLog.mock.calls
    .filter(([label]) => label === message)
    .map(([, details]) => details as Record<string, unknown>);
}

function expectSingleRequestDiagnostics(expected: {
  statusCode: number | null;
  attemptCount: number;
  termination: 'completed' | 'client_cancelled';
  path?: string;
}): void {
  const incoming = getRouteDiagnostics('Route request received');
  const completed = getRouteDiagnostics('Route request completed');
  expect(incoming).toHaveLength(1);
  expect(completed).toEqual([
    expect.objectContaining({
      ...expected,
      requestId: incoming[0].requestId,
      durationMs: expect.any(Number),
    }),
  ]);
  expect(completed[0].durationMs).toBeGreaterThanOrEqual(0);
  for (const [entry] of vi.mocked(recordRouteRequest).mock.calls) {
    expect(entry.requestId).toBe(incoming[0].requestId);
  }
}

describe('route-proxy-service endpoint classification', () => {
  it('collects Bearer and x-api-key credentials without client or endpoint precedence', () => {
    expect(
      extractRouteCredentialCandidates({
        headers: { authorization: 'Bearer profile-a', 'x-api-key': 'profile-b' },
      })
    ).toEqual([
      { value: 'profile-a', sources: ['authorization'] },
      { value: 'profile-b', sources: ['x-api-key'] },
    ]);
    expect(
      extractRouteCredentialCandidates({
        headers: { authorization: 'Bearer profile-a', 'x-api-key': 'profile-a' },
      })
    ).toEqual([{ value: 'profile-a', sources: ['authorization', 'x-api-key'] }]);
  });

  it('resolves one active Profile while tolerating an unknown companion credential', async () => {
    const profile = { id: 'profile-a', name: 'Profile A' } as never;
    const lookup = vi.fn(async (apiKey: string) => (apiKey === 'active-key' ? profile : null));

    const resolution = await resolveRouteProfileCredential(
      {
        headers: { authorization: 'Bearer stale-key', 'x-api-key': 'active-key' },
      },
      lookup
    );

    expect(resolution).toMatchObject({
      status: 'resolved',
      profile,
      unknownCandidates: [{ value: 'stale-key', sources: ['authorization'] }],
    });
  });

  it('rejects credentials that resolve to different active Profiles', async () => {
    const lookup = vi.fn(
      async (apiKey: string) =>
        ({
          'key-a': { id: 'profile-a', name: 'Profile A' },
          'key-b': { id: 'profile-b', name: 'Profile B' },
        })[apiKey] as never
    );

    const resolution = await resolveRouteProfileCredential(
      { headers: { authorization: 'Bearer key-a', 'x-api-key': 'key-b' } },
      lookup
    );

    expect(resolution).toMatchObject({
      status: 'ambiguous_credentials',
      profiles: [{ id: 'profile-a' }, { id: 'profile-b' }],
    });
  });

  it.each([
    ['POST', '/v1/messages', 'generation-convertible'],
    ['POST', '/v1/responses', 'generation-convertible'],
    ['POST', '/v1/chat/completions', 'generation-convertible'],
    ['POST', '/v1/messages/count_tokens', 'stateless-native-only'],
    ['POST', '/v1/messages/batches', 'stateful-unsupported'],
    ['GET', '/v1/messages/batches/batch_1/results', 'stateful-unsupported'],
    ['DELETE', '/v1/messages/batches/batch_1', 'stateful-unsupported'],
    ['GET', '/v1/responses/resp_1', 'stateful-native'],
    ['DELETE', '/v1/responses/resp_1', 'stateful-native'],
    ['POST', '/v1/responses/resp_1/cancel', 'stateful-native'],
    ['GET', '/v1/responses/resp_1/input_items', 'stateful-native'],
    ['POST', '/v1/conversations', 'stateful-unsupported'],
    ['GET', '/v1/conversations/conv_1', 'stateful-unsupported'],
    ['POST', '/v1/conversations/conv_1', 'stateful-unsupported'],
    ['DELETE', '/v1/conversations/conv_1', 'stateful-unsupported'],
    ['POST', '/v1/conversations/conv_1/items', 'stateful-unsupported'],
    ['GET', '/v1/conversations/conv_1/items', 'stateful-unsupported'],
    ['GET', '/v1/conversations/conv_1/items/item_1', 'stateful-unsupported'],
    ['DELETE', '/v1/conversations/conv_1/items/item_1', 'stateful-unsupported'],
    ['POST', '/v1/responses/compact', 'unsupported'],
    ['GET', '/v1/chat/completions', 'stateful-unsupported'],
    ['POST', '/v1/chat/completions/chat_1', 'stateful-unsupported'],
    ['GET', '/v1/chat/completions/chat_1/messages', 'stateful-unsupported'],
    ['POST', '/v1/batches', 'stateful-unsupported'],
    ['GET', '/v1/files/file_1', 'stateful-unsupported'],
    ['POST', '/v1/uploads/upload_1/complete', 'stateful-unsupported'],
    ['GET', '/v1/vector_stores/vs_1', 'stateful-unsupported'],
    ['DELETE', '/v1/containers/container_1', 'stateful-unsupported'],
    ['POST', '/v1/responses/unknown/subpath', 'unsupported'],
  ] as const)('classifies %s %s as %s', (method, path, capability) => {
    expect(classifyRouteEndpointOperation(method, path)?.capability).toBe(capability);
  });

  it('does not expose the deferred Responses input_tokens endpoint', () => {
    expect(classifyRouteEndpointOperation('POST', '/v1/responses/input_tokens')?.capability).toBe(
      'unsupported'
    );
  });

  it('records unsupported endpoints before returning', async () => {
    vi.clearAllMocks();
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({ server: { unifiedApiKey: 'sk-route' } })),
    });
    const request = createJsonRequest('/unsupported', {}, {});
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(404);
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', statusCode: 404, error: 'unsupported_route' })
    );
    expectSingleRequestDiagnostics({
      statusCode: 404,
      attemptCount: 0,
      termination: 'completed',
      path: 'other',
    });
    response.emit('close');
    expect(getRouteDiagnostics('Route request completed')).toHaveLength(1);
    expect(response.listenerCount('finish')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
    expect(request.listenerCount('aborted')).toBe(0);
  });

  it('uses only known managed CLI marker values', () => {
    expect(detectMarkedRouteCliType({ 'x-api-detect-cli': 'openCode' })).toBe('openCode');
    expect(detectMarkedRouteCliType({ 'x-api-detect-cli': 'CODEX' })).toBe('codex');
    expect(detectMarkedRouteCliType({ 'x-api-detect-cli': 'grokBuild' })).toBe('grokBuild');
    expect(detectMarkedRouteCliType({ 'x-api-detect-cli': 'unknown-client' })).toBeNull();
  });

  it('rejects the legacy global key before stateful endpoint channel selection', async () => {
    vi.clearAllMocks();
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({ server: { unifiedApiKey: 'sk-route' } })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValueOnce(null);
    const request = createJsonRequest(
      '/v1/responses/private-resource-sentinel?api_key=private-query-sentinel',
      {
        authorization: 'Bearer sk-route',
        'x-api-detect-cli': 'openCode',
      },
      null
    ) as Parameters<typeof handleRequest>[0] & { method: string };
    request.method = 'GET';
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error).toBe('invalid_api_key');
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', statusCode: 401, error: 'invalid_api_key' })
    );
    expect(resolveChannels).not.toHaveBeenCalled();
    expect(httpRawRequest).not.toHaveBeenCalled();
    expectSingleRequestDiagnostics({
      statusCode: 401,
      attemptCount: 0,
      termination: 'completed',
      path: '/v1/responses/:resource',
    });
    const diagnostics = JSON.stringify(routeDiagnosticLog.mock.calls);
    expect(diagnostics).not.toContain('private-resource-sentinel');
    expect(diagnostics).not.toContain('private-query-sentinel');
    expect(diagnostics).not.toContain('sk-route');
  });

  it('rejects the legacy global key before previous_response_id channel selection', async () => {
    vi.clearAllMocks();
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({ server: { unifiedApiKey: 'sk-route' } })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValueOnce(null);
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

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error).toBe('invalid_api_key');
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', statusCode: 401, error: 'invalid_api_key' })
    );
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

  it('ignores a Codex marker on the Chat Completions path', async () => {
    vi.clearAllMocks();
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-5');
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({
        clientRouting: { 'profile-test': { mode: 'client' } },
        server: { unifiedApiKey: 'sk-route' },
        cliModelSelections: { claudeCode: null, codex: null, openCode: null, grokBuild: null },
        cliThinkingEffortSelections: {
          claudeCode: null,
          codex: null,
          openCode: null,
          grokBuild: null,
        },
        modelRegistry: { entries: {} },
        rules: [],
      })),
      saveConfig: vi.fn(async () => undefined),
      ensureRouteRuleForProtocolModelSelection: vi.fn(async () => null),
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

    expect(response.statusCode).not.toBe(400);
    expect(JSON.parse(response.body).error).not.toBe('cli_marker_path_mismatch');
    expect(findMatchingRule.mock.calls[0]?.[1]).toBe('openai-chat-completions');
  });

  it('handles root HEAD probes without authentication', async () => {
    vi.clearAllMocks();
    const request = createJsonRequest('/', {}, null) as Parameters<typeof handleRequest>[0] & {
      method: string;
    };
    request.method = 'HEAD';
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(204);
    expect(resolveChannels).not.toHaveBeenCalled();
  });

  it('serves the local model registry without an upstream request', async () => {
    vi.clearAllMocks();
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({
        clientRouting: { 'profile-test': { mode: 'client' } },
        server: { unifiedApiKey: 'sk-route' },
        modelRegistry: {
          entries: {
            'gpt-5': { canonicalName: 'gpt-5', aliases: ['gpt-5-mini'] },
          },
        },
      })),
    });
    const request = createJsonRequest(
      '/v1/models?limit=1',
      {
        authorization: 'Bearer sk-route',
      },
      null
    ) as Parameters<typeof handleRequest>[0] & { method: string };
    request.method = 'GET';
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data).toHaveLength(1);
    expect(resolveChannels).not.toHaveBeenCalled();
  });

  it('lists only canonical models in the discovery response', async () => {
    vi.clearAllMocks();
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({
        clientRouting: { 'profile-test': { mode: 'client' } },
        server: { unifiedApiKey: 'sk-route' },
        modelRegistry: {
          entries: {
            'gpt-5': { canonicalName: 'gpt-5', aliases: ['gpt-5-mini'] },
            'deepseek-chat': { canonicalName: 'deepseek-chat', aliases: ['deepseek-chat'] },
          },
        },
      })),
    });
    const request = createJsonRequest(
      '/v1/models',
      {
        authorization: 'Bearer sk-route',
      },
      null
    ) as Parameters<typeof handleRequest>[0] & { method: string };
    request.method = 'GET';
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    const ids = JSON.parse(response.body).data.map((item: { id: string }) => item.id);
    expect(ids).toEqual(['gpt-5', 'deepseek-chat']);
    expect(ids).not.toContain('gpt-5-mini');
  });

  it('still serves detail lookups by legacy alias names', async () => {
    vi.clearAllMocks();
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({
        clientRouting: { 'profile-test': { mode: 'client' } },
        server: { unifiedApiKey: 'sk-route' },
        modelRegistry: {
          entries: {
            'gpt-5': { canonicalName: 'gpt-5', aliases: ['gpt-5-mini'] },
          },
        },
      })),
    });
    const request = createJsonRequest(
      '/v1/models/gpt-5-mini',
      {
        authorization: 'Bearer sk-route',
      },
      null
    ) as Parameters<typeof handleRequest>[0] & { method: string };
    request.method = 'GET';
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data).toEqual([
      { id: 'gpt-5-mini', object: 'model', created: 0, owned_by: 'api-detect-tools' },
    ]);
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
    expect(recordRouteRequest).toHaveBeenCalledTimes(1);
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        statusCode: 501,
        error: 'stateful_route_operation_unsupported',
      })
    );
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

function buildResponsesTextSse(text = 'ok'): Buffer {
  return Buffer.from(
    [
      'event: response.output_text.delta',
      `data: {"type":"response.output_text.delta","delta":${JSON.stringify(text)}}`,
      '',
      'event: response.completed',
      `data: {"type":"response.completed","response":{"output_text":${JSON.stringify(text)},"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}`,
      '',
      '',
    ].join('\n'),
    'utf-8'
  );
}

function buildChatTextSse(text = 'ok'): Buffer {
  return Buffer.from(
    [
      `data: {"id":"chatcmpl_test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":${JSON.stringify(text)}},"finish_reason":null}]}`,
      '',
      'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
      '',
    ].join('\n'),
    'utf-8'
  );
}

describe('route-proxy-service Responses state affinity', () => {
  const profile = { id: 'profile-a', name: 'Codex A' };
  const rule = {
    id: 'rule-responses',
    sourceProtocol: 'openai-responses' as const,
    cliType: 'codex' as const,
    pattern: 'gpt-5',
    patternType: 'exact' as const,
  };
  const channel = {
    routeRuleId: rule.id,
    siteId: 'site-a',
    accountId: 'account-a',
    apiKeyId: 'key-a',
    cliType: 'codex' as const,
    targetProtocol: 'openai-responses' as const,
    targetEndpoint: '/v1/responses',
    canonicalModel: 'gpt-5',
    resolvedModel: 'gpt-5-upstream',
  };

  afterAll(() => {
    vi.mocked(findConfigFileProfileByRouteApiKey).mockImplementation(async apiKey =>
      apiKey === 'wrong-key' ? null : ({ id: 'profile-test', name: 'Test Client' } as never)
    );
    vi.mocked(routeStateAffinityService.get).mockResolvedValue(null);
    vi.mocked(routeStateAffinityService.bind).mockResolvedValue(undefined);
    vi.mocked(routeStateAffinityService.remove).mockResolvedValue(undefined);
    vi.mocked(resolveChannelTarget).mockImplementation(async currentChannel => ({
      targetProtocol: currentChannel.targetProtocol ?? 'native',
      targetEndpoint:
        currentChannel.targetEndpoint ??
        (currentChannel.targetProtocol === 'anthropic-messages'
          ? '/v1/messages'
          : currentChannel.targetProtocol === 'openai-responses'
            ? '/v1/responses'
            : currentChannel.targetProtocol === 'openai-chat-completions'
              ? '/v1/chat/completions'
              : '/mock-endpoint'),
    }));
  });

  function setupStatefulRoute(): void {
    vi.clearAllMocks();
    const routing = {
      clientRouting: { [profile.id]: { mode: 'client' as const } },
      server: { unifiedApiKey: 'sk-route', requestTimeoutMs: 1000, upstreamProxyUrl: '' },
      rules: [rule],
      cliModelSelections: {
        claudeCode: null,
        codex: 'gpt-5',
        openCode: null,
        grokBuild: null,
      },
      cliThinkingEffortSelections: {
        claudeCode: null,
        codex: null,
        openCode: null,
        grokBuild: null,
      },
      modelRegistry: { version: 1, sources: [], entries: {}, overrides: [], displayItems: [] },
      routePathStates: {},
      routeEndpointCapabilities: {},
    };
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      saveConfig: vi.fn(async () => undefined),
      getSiteById: vi.fn(() => ({ id: channel.siteId, name: 'Site A' })),
      getAccountById: vi.fn(() => ({ id: channel.accountId, account_name: 'Account A' })),
    });
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue(profile as never);
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-5');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channel]);
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://stateful.example.com',
      apiKey: 'sk-upstream',
    });
    vi.mocked(resolveChannelTarget).mockResolvedValue({
      targetProtocol: 'openai-responses',
      targetEndpoint: '/v1/responses',
    });
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
  }

  it('rejects Conversations API endpoints before route selection', async () => {
    setupStatefulRoute();
    const response = createMockResponse();

    await handleRequest(
      createJsonRequest(
        '/v1/conversations',
        { authorization: 'Bearer sk-profile', 'content-type': 'application/json' },
        { metadata: { client: 'test' } }
      ),
      response
    );

    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.body).error).toBe('stateful_route_operation_unsupported');
    expect(resolveChannels).not.toHaveBeenCalled();
    expect(httpRawRequest).not.toHaveBeenCalled();
  });

  it.each(['conv_existing', null, ''])(
    'rejects a Responses conversation field before route selection (%#)',
    async conversation => {
      setupStatefulRoute();
      const response = createMockResponse();

      await handleRequest(
        createJsonRequest(
          '/v1/responses',
          { authorization: 'Bearer sk-profile', 'content-type': 'application/json' },
          { model: 'gpt-5', conversation, input: 'hello' }
        ),
        response
      );

      // 非 conversation 分支没有可用上游，失败被路由吸收为可重试 503。
      expect(response.statusCode).toBe(conversation ? 501 : 503);
      expect(JSON.parse(response.body).error).toEqual(
        conversation
          ? 'stateful_request_unsupported'
          : expect.objectContaining({ code: 'upstream_temporarily_unavailable' })
      );
      if (conversation) {
        expect(resolveChannels).not.toHaveBeenCalled();
        expect(httpRawRequest).not.toHaveBeenCalled();
        expect(recordRouteRequest).toHaveBeenCalledTimes(1);
        expect(recordRouteRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            outcome: 'failure',
            statusCode: 501,
            error: 'stateful_request_unsupported:conversation',
          })
        );
      } else {
        expect(resolveChannels).toHaveBeenCalled();
      }
    }
  );

  it('auto-creates a protocol model rule for a profile-authenticated client without a session identity', async () => {
    setupStatefulRoute();
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
      ...profile,
      credentialOnly: true,
    } as never);
    const ensureRouteRuleForProtocolModelSelection = vi.fn(async () => rule);
    Object.assign(unifiedConfigManager, { ensureRouteRuleForProtocolModelSelection });
    vi.mocked(findMatchingRule)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(rule as never);
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        JSON.stringify({
          id: 'resp_profile_client',
          object: 'response',
          output: [],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 1 },
        })
      ),
    });

    const response = createMockResponse();
    await handleRequest(
      createJsonRequest(
        '/v1/responses',
        { authorization: 'Bearer sk-profile', 'content-type': 'application/json' },
        { model: 'gpt-5', input: 'hello', store: true }
      ),
      response
    );

    expect(response.statusCode).toBe(200);
    expect(ensureRouteRuleForProtocolModelSelection).toHaveBeenCalledWith(
      'openai-responses',
      'gpt-5'
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ agentName: 'Codex A' })
    );
  });

  it('treats null and empty conversation references as absent', () => {
    expect(findProviderOwnedStateReference({ conversation: null })).toBeNull();
    expect(findProviderOwnedStateReference({ conversation: '' })).toBeNull();
    expect(findProviderOwnedStateReference({ conversation: '  ' })).toBeNull();
    expect(findProviderOwnedStateReference({ conversation: 'conv_1' })).toBe('conversation');
  });

  it('binds a created response before exposing its id downstream', async () => {
    setupStatefulRoute();
    const responseBody = Buffer.from(
      JSON.stringify({
        id: 'resp_created',
        object: 'response',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      })
    );
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: responseBody,
    });
    const response = createMockResponse();
    vi.mocked(routeStateAffinityService.bind).mockImplementation(async () => {
      expect(response.writeHead).not.toHaveBeenCalled();
    });

    await handleRequest(
      createJsonRequest(
        '/v1/responses',
        { authorization: 'Bearer sk-profile', 'content-type': 'application/json' },
        { model: 'gpt-5', input: 'hello', store: true }
      ),
      response
    );

    expect(routeStateAffinityService.bind).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'resp_created',
        profileId: profile.id,
        siteId: channel.siteId,
        accountId: channel.accountId,
        apiKeyId: channel.apiKeyId,
        routeRuleId: rule.id,
        targetProtocol: 'openai-responses',
      })
    );
    expect(response.statusCode).toBe(200);
  });

  it('binds a streamed response before committing its first SSE bytes', async () => {
    setupStatefulRoute();
    const chunks = [
      Buffer.from(
        'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_streamed","status":"in_progress"}}\n\n'
      ),
      Buffer.from(
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n'
      ),
      Buffer.from(
        'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_streamed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n'
      ),
    ];
    const streamBody = Buffer.concat(chunks);
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      expect(
        config.onResponse?.({
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/event-stream' },
        })
      ).toBe(true);
      for (const chunk of chunks) {
        await config.onChunk?.(chunk);
      }
      return {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: streamBody,
      };
    });
    const response = createMockResponse();
    vi.mocked(routeStateAffinityService.bind).mockImplementation(async () => {
      expect(response.writeHead).not.toHaveBeenCalled();
      expect(response.write).not.toHaveBeenCalled();
    });

    await handleRequest(
      createJsonRequest(
        '/v1/responses',
        { authorization: 'Bearer sk-profile', 'content-type': 'application/json' },
        { model: 'gpt-5', input: 'hello', stream: true, store: true }
      ),
      response
    );

    expect(routeStateAffinityService.bind).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'resp_streamed', profileId: profile.id })
    );
    expect(response.body).toBe(streamBody.toString('utf-8'));
  });

  it.each(['session', 'client'] as const)(
    'routes a previous_response_id only through its recorded channel in %s mode',
    async mode => {
      setupStatefulRoute();
      unifiedConfigManager.getRoutingConfig().clientRouting = {
        [profile.id]: { mode, modelId: 'different-model', reasoningEffort: 'high', pinned: false },
      };
      vi.mocked(routeStateAffinityService.get).mockResolvedValue({
        resourceId: 'resp_existing',
        resourceType: 'response',
        profileId: profile.id,
        siteId: channel.siteId,
        accountId: channel.accountId,
        apiKeyId: channel.apiKeyId,
        routeRuleId: rule.id,
        targetProtocol: 'openai-responses',
        targetEndpoint: '/v1/responses',
        createdAt: 1,
      });
      vi.mocked(httpRawRequest).mockResolvedValue({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(
          '{"id":"resp_next","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}'
        ),
      });

      const response = createMockResponse();
      await handleRequest(
        createJsonRequest(
          '/v1/responses',
          { authorization: 'Bearer sk-profile', 'content-type': 'application/json' },
          { model: 'gpt-5', input: 'continue', previous_response_id: 'resp_existing' }
        ),
        response
      );

      expect(routeStateAffinityService.get).toHaveBeenCalledWith('resp_existing', profile.id);
      expect(resolveChannels).not.toHaveBeenCalled();
      expect(resolveChannelCredentials).toHaveBeenCalledTimes(1);
      expect(resolveChannelCredentials).toHaveBeenCalledWith('site-a', 'account-a', 'key-a');
      expect(routeStateAffinityService.bind).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: 'resp_next', profileId: profile.id })
      );
    }
  );

  it('removes an affinity record only after a successful delete', async () => {
    setupStatefulRoute();
    vi.mocked(routeStateAffinityService.get).mockResolvedValue({
      resourceId: 'resp_existing',
      resourceType: 'response',
      profileId: profile.id,
      siteId: channel.siteId,
      accountId: channel.accountId,
      apiKeyId: channel.apiKeyId,
      routeRuleId: rule.id,
      targetProtocol: 'openai-responses',
      targetEndpoint: '/v1/responses',
      createdAt: 1,
    });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"id":"resp_existing","deleted":true,"object":"response.deleted"}'),
    });
    const request = createJsonRequest(
      '/v1/responses/resp_existing',
      { authorization: 'Bearer sk-profile' },
      null
    ) as Parameters<typeof handleRequest>[0] & { method: string };
    request.method = 'DELETE';

    await handleRequest(request, createMockResponse());

    expect(routeStateAffinityService.remove).toHaveBeenCalledWith('resp_existing');
  });

  it('does not reveal or route an affinity record unavailable to the profile', async () => {
    setupStatefulRoute();
    vi.mocked(routeStateAffinityService.get).mockResolvedValue(null);
    const request = createJsonRequest(
      '/v1/responses/resp_other',
      { authorization: 'Bearer sk-profile' },
      null
    ) as Parameters<typeof handleRequest>[0] & { method: string };
    request.method = 'GET';
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe('state_affinity_not_found');
    expect(resolveChannels).not.toHaveBeenCalled();
    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(recordRouteRequest).toHaveBeenCalledTimes(1);
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        statusCode: 409,
        error: 'state_affinity_not_found',
      })
    );
  });

  it('logs unsupported cross-protocol state creation exactly once', async () => {
    setupStatefulRoute();
    const incompatibleChannel = {
      ...channel,
      targetProtocol: 'openai-chat-completions' as const,
      targetEndpoint: '/v1/chat/completions',
    };
    vi.mocked(resolveChannels).mockReturnValue([incompatibleChannel]);
    vi.mocked(resolveChannelTarget).mockResolvedValue({
      targetProtocol: 'openai-chat-completions',
      targetEndpoint: '/v1/chat/completions',
    });
    const response = createMockResponse();

    await handleRequest(
      createJsonRequest(
        '/v1/responses',
        { authorization: 'Bearer sk-profile', 'content-type': 'application/json' },
        { model: 'gpt-5', input: 'hello', store: true }
      ),
      response
    );

    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.body).error.code).toBe('stateful_cross_protocol_unsupported');
    expect(httpRawStreamRequest).not.toHaveBeenCalled();
    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(recordRouteRequest).toHaveBeenCalledTimes(1);
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        statusCode: 501,
        error: 'stateful_cross_protocol_unsupported',
      })
    );
  });

  it('keeps target-lock stateful profile rejections out of route analytics', async () => {
    setupStatefulRoute();
    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: channel.siteId,
      accountId: channel.accountId,
      apiKeyId: channel.apiKeyId,
      cliType: 'codex',
      canonicalModel: 'gpt-5',
      rawModel: 'gpt-5',
      targetProtocol: 'openai-responses',
    });
    const response = createMockResponse();

    try {
      await handleRequest(
        createJsonRequest(
          '/v1/responses',
          { authorization: `Bearer ${routeApiKey}`, 'content-type': 'application/json' },
          { model: 'gpt-5', input: 'hello', store: true }
        ),
        response
      );
    } finally {
      clearRouteProbeLockTerminalFailure(routeApiKey);
    }

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe('stateful_profile_key_required');
    expect(recordRouteRequest).not.toHaveBeenCalled();
    expect(httpRawStreamRequest).not.toHaveBeenCalled();
    expect(httpRawRequest).not.toHaveBeenCalled();
  });

  it('keeps target-lock provider-owned state rejections out of route analytics', async () => {
    setupStatefulRoute();
    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: channel.siteId,
      accountId: channel.accountId,
      apiKeyId: channel.apiKeyId,
      cliType: 'codex',
      canonicalModel: 'gpt-5',
      rawModel: 'gpt-5',
      targetProtocol: 'openai-responses',
    });
    const response = createMockResponse();

    try {
      await handleRequest(
        createJsonRequest(
          '/v1/responses',
          { authorization: `Bearer ${routeApiKey}`, 'content-type': 'application/json' },
          {
            model: 'gpt-5',
            input: 'hello',
            conversation: 'conv_existing',
            store: false,
          }
        ),
        response
      );
    } finally {
      clearRouteProbeLockTerminalFailure(routeApiKey);
    }

    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.body).error).toBe('stateful_request_unsupported');
    expect(recordRouteRequest).not.toHaveBeenCalled();
    expect(resolveChannels).not.toHaveBeenCalled();
    expect(httpRawStreamRequest).not.toHaveBeenCalled();
    expect(httpRawRequest).not.toHaveBeenCalled();
  });
});

describe('route-proxy-service session channel affinity', () => {
  const channel = (siteId: string, apiKeyId: string) => ({
    routeRuleId: 'rule-1',
    siteId,
    accountId: 'acc-1',
    apiKeyId,
    canonicalModel: 'claude-opus-4-6',
    resolvedModel: 'claude-opus-4.6-20260201',
    targetProtocol: 'anthropic-messages' as const,
  });
  const channels = [
    channel('site-a', 'key-a'),
    channel('site-b', 'key-b'),
    channel('site-c', 'key-c'),
  ];
  const bound = (siteId: string, apiKeyId: string, boundAt = 1_000) => ({
    siteId,
    accountId: 'acc-1',
    apiKeyId,
    boundAt,
  });

  beforeEach(() => {
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
  });

  it('promotes the bound channel and preserves circular fallback order', () => {
    const ordered = applySessionChannelAffinity(channels, bound('site-b', 'key-b'), {}, 2_000);

    expect(ordered.map(entry => entry.siteId)).toEqual(['site-b', 'site-c', 'site-a']);
  });

  it('leaves the order untouched when the bound channel is already first', () => {
    const ordered = applySessionChannelAffinity(channels, bound('site-a', 'key-a'), {}, 2_000);
    expect(ordered).toBe(channels);
  });

  it('ignores a binding whose channel is not among the candidates', () => {
    const ordered = applySessionChannelAffinity(channels, bound('site-z', 'key-z'), {}, 2_000);
    expect(ordered).toBe(channels);
  });

  it('ignores a binding whose route path is disabled', () => {
    vi.mocked(isRoutePathDisabled).mockImplementation(
      key => (key as { siteId?: string }).siteId === 'site-b'
    );

    const ordered = applySessionChannelAffinity(channels, bound('site-b', 'key-b'), {}, 2_000);
    expect(ordered).toBe(channels);
  });

  it('ignores a binding whose route path is affinity-suppressed by a priority-hit reset', () => {
    const states = {
      [buildRoutePathStateKey(channels[1]!)]: {
        ...channels[1]!,
        windowStartedAt: 0,
        windowRequestCount: 0,
        windowSuccessCount: 0,
        successRate: 1,
        affinitySuppressedUntil: 9_000,
        updatedAt: 0,
      },
    };

    const ordered = applySessionChannelAffinity(channels, bound('site-b', 'key-b'), states, 2_000);
    expect(ordered).toBe(channels);
  });

  it('ignores a binding established before the affinity invalidation boundary', () => {
    const stale = applySessionChannelAffinity(
      channels,
      bound('site-b', 'key-b', 1_000),
      {},
      2_000,
      1_000
    );
    expect(stale).toBe(channels);

    const fresh = applySessionChannelAffinity(
      channels,
      bound('site-b', 'key-b', 1_500),
      {},
      2_000,
      1_000
    );
    expect(fresh.map(entry => entry.siteId)).toEqual(['site-b', 'site-c', 'site-a']);
  });

  it('does nothing without a binding', () => {
    expect(applySessionChannelAffinity(channels, null, {}, 2_000)).toBe(channels);
  });
});

describe('route-proxy-service new session distribution', () => {
  const channel = (siteId: string) => ({ siteId, accountId: 'acc-1', apiKeyId: `key-${siteId}` });
  const channels = [channel('site-a'), channel('site-b'), channel('site-c')];
  const keyOf = (siteId: string) => `${siteId}|acc-1|key-${siteId}`;

  it('keeps the configured priority order when nothing is occupied', () => {
    expect(pickDistributedChannelIndex(channels, new Set())).toBe(0);
  });

  it('skips a channel already held by another live session', () => {
    expect(pickDistributedChannelIndex(channels, new Set([keyOf('site-a')]))).toBe(1);
  });

  it('never jumps over a free higher-priority channel', () => {
    // site-b 被占用，但 site-a 空闲：必须仍然选 site-a，不能因分散而降级用户优先级
    expect(pickDistributedChannelIndex(channels, new Set([keyOf('site-b')]))).toBe(0);
  });

  it('falls back to the priority order when every channel is occupied', () => {
    const occupied = new Set([keyOf('site-a'), keyOf('site-b'), keyOf('site-c')]);
    expect(pickDistributedChannelIndex(channels, occupied)).toBe(0);
  });
});

describe('route-proxy-service session channel binding end to end', () => {
  const rule = {
    id: 'rule-codex-session-bind',
    cliType: 'codex' as const,
    pattern: 'gpt-4.1-mini',
    patternType: 'exact' as const,
  };
  const channelA = {
    routeRuleId: rule.id,
    siteId: 'site-a',
    accountId: 'acc-a',
    apiKeyId: 'key-a',
    cliType: 'codex' as const,
    targetProtocol: 'native' as const,
    canonicalModel: 'gpt-4.1-mini',
    resolvedModel: 'gpt-4.1-mini',
  };
  const channelB = {
    ...channelA,
    siteId: 'site-b',
    accountId: 'acc-b',
    apiKeyId: 'key-b',
  };
  const bindingOn = (siteId: string, accountId: string, apiKeyId: string) => ({
    instanceId: 'any',
    profileId: '',
    siteId,
    accountId,
    apiKeyId,
    canonicalModel: 'gpt-4.1-mini',
    boundAt: 1,
    lastUsedAt: Date.now(),
  });

  function setupSessionRoute(instances: Record<string, unknown> = {}) {
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
      id: 'profile-test',
      name: 'Test Client',
    } as never);
    const routing = {
      clientRouting: {} as Record<string, RouteClientRoutingConfig>,
      globalModelRoutes: [] as GlobalModelRoute[],
      server: { unifiedApiKey: 'sk-route', requestTimeoutMs: 1000, upstreamProxyUrl: '' },
      rules: [rule],
      cliModelSelections: { claudeCode: null, codex: null },
      sessionRouting: {
        instances,
        currentRouteBySlot: {},
        extractionRules: structuredClone(DEFAULT_ROUTE_SESSION_ROUTING_CONFIG.extractionRules),
        overrides: {},
        activeWindowMinutes: 30,
        recentWindowHours: 24,
        historyRetentionDays: 30,
        overrideRetentionDays: 90,
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
      saveConfig: vi.fn(async () => undefined),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('gpt-4.1-mini');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule as never]);
    vi.mocked(findMatchingRule).mockReturnValue(rule as never);
    vi.mocked(resolveChannels).mockReturnValue([channelA, channelB]);
    vi.mocked(resolveChannelCredentials).mockImplementation(
      async (_siteId, _accountId, apiKeyId) => ({
        baseUrl: `https://${apiKeyId}.example.com`,
        apiKey: `sk-${apiKeyId}`,
      })
    );
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
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({ ok: true, usage: { total_tokens: 5 } })),
    });
    return routing;
  }

  const liveInstance = (id: string) => ({
    id,
    display: {},
    modelId: 'gpt-4.1-mini',
    reasoningEffort: 'medium',
    routingState: 'active',
    presenceState: 'unknown',
    routeKey: { agentId: 'codex', runtimeSlotId: id, sessionId: id },
  });

  const sessionRequest = (sessionId: string) =>
    createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
        'x-codex-window-id': `${sessionId}:1`,
      },
      { model: 'gpt-4.1-mini', input: 'hi', client_metadata: { session_id: sessionId } }
    );

  const firstUsedApiKey = () => vi.mocked(resolveChannelCredentials).mock.calls[0]?.[2];

  const dshRequest = (sessionId: string | undefined, apiKey = 'sk-route') =>
    createJsonRequest(
      '/v1/messages',
      {
        authorization: `Bearer ${apiKey}`,
        'user-agent':
          'deepseek-harness/0.2.1-rc.2 (+https://github.com/deepseek-ai/deepseek-harness)',
        'anthropic-version': '2023-06-01',
        'x-deepseek-harness-user-id': 'same-user',
        ...(sessionId === undefined ? {} : { 'x-deepseek-harness-session-id': sessionId }),
      },
      { model: 'gpt-4.1-mini', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] }
    );

  const sessionClients: Array<{
    name: string;
    headers: (id: string) => Record<string, string>;
    body?: (id: string) => Record<string, unknown>;
  }> = [
    { name: 'DSH', headers: id => ({ 'x-deepseek-harness-session-id': id }) },
    { name: 'Codex', headers: id => ({ 'session-id': id }) },
    { name: 'Claude Code', headers: id => ({ 'x-claude-code-session-id': id }) },
    {
      name: 'Claude metadata',
      headers: () => ({ 'user-agent': 'claude-cli/2.0' }),
      body: id => ({ metadata: { user_id: JSON.stringify({ session_id: id }) } }),
    },
    {
      name: 'OpenCode',
      headers: id => ({ 'user-agent': 'OpenCode/2.0', 'x-session-affinity': id }),
    },
    { name: 'Grok Build', headers: id => ({ 'x-grok-conv-id': id }) },
    {
      name: 'Pi',
      headers: id => ({ 'user-agent': 'pi-coding-agent/1.0', 'x-session-id': id }),
    },
    { name: 'Generic', headers: () => ({}), body: id => ({ session_id: id }) },
  ];

  it.each(sessionClients)(
    'isolates sessions and profiles and claims the armed card for $name',
    async client => {
      vi.clearAllMocks();
      const waiting = {
        id: 'waiting',
        display: {},
        modelId: 'waiting-model',
        reasoningEffort: 'high',
        routingState: 'armed',
        presenceState: 'unknown',
      };
      const routing = setupSessionRoute({ waiting });
      vi.mocked(findConfigFileProfileByRouteApiKey).mockImplementation(
        async key =>
          ({
            id: key === 'other-key' ? 'profile-other' : 'profile-test',
            name: client.name,
          }) as never
      );
      const request = (id: string, key = 'sk-route') =>
        createJsonRequest(
          '/v1/messages',
          { authorization: `Bearer ${key}`, ...client.headers(id) },
          { model: 'gpt-4.1-mini', max_tokens: 64, messages: [], ...client.body?.(id) }
        );
      await handleRequest(request('session-a'), createMockResponse());
      expect(routing.sessionRouting.instances.waiting).toMatchObject({
        profileId: 'profile-test',
        routingState: 'active',
        modelId: 'waiting-model',
        reasoningEffort: 'high',
        routeKey: { sessionId: 'session-a' },
      });
      await handleRequest(request('session-b'), createMockResponse());
      await handleRequest(request('session-a', 'other-key'), createMockResponse());
      await handleRequest(request('session-a'), createMockResponse());
      expect(Object.values(routing.sessionRouting.instances)).toHaveLength(3);
      expect(findMatchingRule).toHaveBeenLastCalledWith(
        expect.any(Array),
        'anthropic-messages',
        'waiting-model'
      );
    }
  );

  it.each(['DSH', 'Codex', 'Claude Code', 'OpenCode', 'Grok Build', 'Pi', 'Generic'])(
    'rejects a missing session ID for %s without claiming or changing cards',
    async name => {
      vi.clearAllMocks();
      const routing = setupSessionRoute({
        waiting: { ...liveInstance('waiting'), routingState: 'armed', routeKey: undefined },
      });
      vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
        id: 'profile-test',
        name,
      } as never);
      const before = structuredClone(routing.sessionRouting);
      const response = createMockResponse();
      await handleRequest(
        createJsonRequest('/v1/messages', { authorization: 'Bearer sk-route' }, { messages: [] }),
        response
      );
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body)).toMatchObject({ error: 'session_identity_required' });
      expect(httpRawRequest).not.toHaveBeenCalled();
      expect(routing.sessionRouting).toEqual(before);
    }
  );

  it('separates native DSH sessions and reuses each card without taking settings from the old client fallback', async () => {
    vi.clearAllMocks();
    const legacy = {
      ...liveInstance('legacy'),
      profileId: 'profile-test',
      pinned: true,
      modelId: 'old-client-model',
      routeKey: {
        agentId: 'profile:profile-test',
        runtimeSlotId: 'profile:profile-test',
        sessionId: 'profile:profile-test',
      },
    };
    const routing = setupSessionRoute({ legacy });
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
      id: 'profile-test',
      name: 'DSH',
    } as never);
    await handleRequest(dshRequest('dsh-first'), createMockResponse());
    const first = (Object.values(routing.sessionRouting.instances) as RouteInstance[]).find(
      instance => instance.routeKey?.sessionId === 'dsh-first'
    )!;
    expect(first).toBeDefined();
    first.modelId = 'first-session-model';
    first.reasoningEffort = 'low';
    first.pinned = true;
    await handleRequest(dshRequest('dsh-second'), createMockResponse());
    expect(findMatchingRule).toHaveBeenLastCalledWith(
      expect.any(Array),
      'anthropic-messages',
      'gpt-4.1-mini'
    );
    await handleRequest(dshRequest('dsh-first'), createMockResponse());
    expect(findMatchingRule).toHaveBeenLastCalledWith(
      expect.any(Array),
      'anthropic-messages',
      'first-session-model'
    );
    const cards = Object.values(routing.sessionRouting.instances) as RouteInstance[];
    expect(cards).toHaveLength(3);
    expect(
      cards
        .filter(card => card.routeKey?.agentId === 'deepseekHarness')
        .map(card => card.routeKey?.sessionId)
        .sort()
    ).toEqual(['dsh-first', 'dsh-second']);
    expect(routing.sessionRouting.instances.legacy).toEqual(legacy);
    expect(first).toMatchObject({ reasoningEffort: 'low', pinned: true });
  });

  it('keeps DSH native identities isolated across profiles', async () => {
    vi.clearAllMocks();
    const routing = setupSessionRoute();
    vi.mocked(findConfigFileProfileByRouteApiKey).mockImplementation(
      async key =>
        ({ id: key === 'other-key' ? 'other-profile' : 'profile-test', name: 'DSH' }) as never
    );
    await handleRequest(dshRequest('same-session'), createMockResponse());
    await handleRequest(dshRequest('same-session', 'other-key'), createMockResponse());
    expect(
      (Object.values(routing.sessionRouting.instances) as RouteInstance[])
        .map(instance => instance.profileId)
        .sort()
    ).toEqual(['other-profile', 'profile-test']);
  });

  it('keeps DSH client mode shared and does not create session cards', async () => {
    vi.clearAllMocks();
    const routing = setupSessionRoute();
    routing.clientRouting['profile-test'] = {
      mode: 'client',
      modelId: 'client-model',
      reasoningEffort: 'high',
      pinned: true,
    };
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
      id: 'profile-test',
      name: 'DSH',
    } as never);
    await handleRequest(dshRequest(undefined), createMockResponse());
    await handleRequest(dshRequest('second'), createMockResponse());
    expect(routing.sessionRouting.instances).toEqual({});
    expect(findMatchingRule).toHaveBeenLastCalledWith(
      expect.any(Array),
      'anthropic-messages',
      'client-model'
    );
  });

  it('does not collapse malformed DSH identities into a profile fallback or consume an armed card', async () => {
    vi.clearAllMocks();
    const armed = {
      id: 'waiting',
      display: {},
      modelId: 'waiting-model',
      reasoningEffort: 'high',
      routingState: 'armed',
      presenceState: 'unknown',
    };
    const routing = setupSessionRoute({ waiting: armed });
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
      id: 'profile-test',
      name: 'DSH',
    } as never);
    await handleRequest(dshRequest(''), createMockResponse());
    expect(routing.sessionRouting.instances).toEqual({ waiting: armed });
  });

  it('rejects the DSH custom Anthropic path without session identity instead of reusing DSH#1', async () => {
    vi.clearAllMocks();
    const legacy = {
      ...liveInstance('legacy'),
      profileId: 'profile-test',
      pinned: true,
      modelId: 'old-client-model',
      routeKey: {
        agentId: 'profile:profile-test',
        runtimeSlotId: 'profile:profile-test',
        sessionId: 'profile:profile-test',
      },
    };
    const waiting = {
      id: 'waiting',
      display: {},
      modelId: 'waiting-model',
      reasoningEffort: 'high',
      routingState: 'armed',
      presenceState: 'unknown',
    };
    const routing = setupSessionRoute({ legacy, waiting });
    const before = structuredClone(routing.sessionRouting);
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
      id: 'profile-test',
      name: 'DSH',
    } as never);
    const response = createMockResponse();
    await handleRequest(dshRequest(undefined), response);
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toMatchObject({ error: 'session_identity_required' });
    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(unifiedConfigManager.saveConfig).not.toHaveBeenCalled();
    expect(routing.sessionRouting).toEqual(before);

    await handleRequest(dshRequest('native-session'), createMockResponse());
    expect(routing.sessionRouting.instances.waiting).toMatchObject({
      id: 'waiting',
      modelId: 'waiting-model',
      reasoningEffort: 'high',
      routeKey: { agentId: 'deepseekHarness', sessionId: 'native-session' },
    });
    expect(findMatchingRule).toHaveBeenLastCalledWith(
      expect.any(Array),
      'anthropic-messages',
      'waiting-model'
    );
    expect(routing.sessionRouting.instances.legacy).toEqual(legacy);
  });

  it.each(['session', 'client'] as const)(
    'routes fixed MCP models across clients in %s mode without touching session cards',
    async mode => {
      vi.clearAllMocks();
      const waiting = {
        id: 'waiting',
        display: {},
        modelId: 'waiting-model',
        reasoningEffort: 'low',
        routingState: 'armed',
        presenceState: 'unknown',
      };
      const routing = setupSessionRoute({ waiting, existing: liveInstance('existing') });
      routing.globalModelRoutes = [
        {
          id: 'grok-search',
          name: 'Grok Search',
          requestModel: 'grok-wire',
          modelId: 'grok-target',
          reasoningEffort: 'xhigh',
          enabled: true,
        },
      ];
      const before = structuredClone(routing.sessionRouting);
      vi.mocked(extractModelFromBody).mockReturnValue('grok-wire');
      vi.mocked(resolveChannels).mockReturnValue([
        { ...channelA, canonicalModel: 'grok-target', resolvedModel: 'grok-upstream' },
      ]);
      const getBinding = vi.spyOn(routeSessionBindingService, 'get');
      const bind = vi.spyOn(routeSessionBindingService, 'bind');
      for (const profileId of ['codex-client', 'claude-client', 'opencode-client']) {
        routing.clientRouting[profileId] = {
          mode,
          modelId: 'normal-model',
          reasoningEffort: 'low',
          pinned: false,
        };
        vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
          id: profileId,
          name: profileId,
        } as never);
        for (const identity of [{}, { 'session-id': 'existing' }]) {
          const response = createMockResponse();
          await handleRequest(
            createJsonRequest(
              '/v1/chat/completions',
              {
                authorization: `Bearer ${profileId}`,
                ...identity,
              },
              { model: 'grok-wire', messages: [{ role: 'user', content: 'search' }] }
            ),
            response
          );
          expect(response.statusCode).toBe(200);
          expect(recordRouteRequest).toHaveBeenLastCalledWith(
            expect.objectContaining({
              profileId,
              modelSelectionSource: 'global-model',
              globalModelRouteId: 'grok-search',
              canonicalModel: 'grok-target',
              reasoningEffort: 'xhigh',
              routeInstanceId: undefined,
            })
          );
        }
      }
      expect(findMatchingRule).toHaveBeenLastCalledWith(
        expect.any(Array),
        'openai-chat-completions',
        'grok-target'
      );
      const sent = JSON.parse(
        Buffer.from(vi.mocked(httpRawRequest).mock.calls[0][1].body as Buffer).toString('utf8')
      );
      expect(sent).toMatchObject({ model: 'grok-upstream', reasoning_effort: 'xhigh' });
      expect(routing.sessionRouting).toEqual(before);
      expect(getBinding).not.toHaveBeenCalled();
      expect(bind).not.toHaveBeenCalled();
      expect(unifiedConfigManager.saveConfig).not.toHaveBeenCalled();
    }
  );

  it.each(['disabled', 'different-model', 'invalid-key'])(
    'does not bypass normal validation for a fixed route with %s',
    async condition => {
      vi.clearAllMocks();
      const routing = setupSessionRoute();
      routing.globalModelRoutes = [
        {
          id: 'grok-search',
          name: 'Grok Search',
          requestModel: condition === 'different-model' ? 'other-model' : 'gpt-4.1-mini',
          modelId: 'grok-target',
          reasoningEffort: 'high',
          enabled: condition !== 'disabled',
        },
      ];
      if (condition === 'invalid-key')
        vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue(null);
      const response = createMockResponse();
      await handleRequest(
        createJsonRequest(
          '/v1/chat/completions',
          { authorization: 'Bearer key' },
          { model: 'gpt-4.1-mini', messages: [] }
        ),
        response
      );
      expect(response.statusCode).toBe(condition === 'invalid-key' ? 401 : 409);
      expect(httpRawRequest).not.toHaveBeenCalled();
      expect(routing.sessionRouting.instances).toEqual({});
    }
  );

  it('uses one client target for multiple sessions without consuming an armed card or session bindings', async () => {
    vi.clearAllMocks();
    const armed = {
      id: 'waiting',
      display: {},
      modelId: 'armed-model',
      reasoningEffort: 'low',
      routingState: 'armed',
      presenceState: 'unknown',
    };
    const routing = setupSessionRoute({ waiting: armed });
    routing.clientRouting['profile-test'] = {
      mode: 'client',
      modelId: 'client-model',
      reasoningEffort: 'high',
      pinned: true,
    };
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
      id: 'profile-test',
      name: 'Test Client',
    } as never);
    const getBinding = vi
      .spyOn(routeSessionBindingService, 'get')
      .mockReturnValue(bindingOn('site-b', 'acc-b', 'key-b'));
    const bind = vi.spyOn(routeSessionBindingService, 'bind').mockImplementation(() => undefined);
    await handleRequest(sessionRequest('one'), createMockResponse());
    await handleRequest(sessionRequest('two'), createMockResponse());
    expect(findMatchingRule).toHaveBeenLastCalledWith(
      expect.any(Array),
      'openai-responses',
      'client-model'
    );
    expect(firstUsedApiKey()).toBe('key-a');
    expect(routing.sessionRouting.instances).toEqual({ waiting: armed });
    expect(getBinding).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    const body = JSON.parse(
      Buffer.from(vi.mocked(httpRawRequest).mock.calls[0][1].body as Buffer).toString('utf-8')
    );
    expect(body.reasoning.effort).toBe('high');
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        routingMode: 'client',
        profileId: 'profile-test',
        modelSelectionSource: 'client',
      })
    );
  });

  it('accepts a client target without a session ID or a model in the request', async () => {
    vi.clearAllMocks();
    const routing = setupSessionRoute();
    routing.clientRouting['profile-test'] = {
      mode: 'client',
      modelId: 'client-model',
      reasoningEffort: null,
      pinned: false,
    };
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
      id: 'profile-test',
      name: 'Test Client',
    } as never);
    vi.mocked(extractModelFromBody).mockReturnValue(null);
    const response = createMockResponse();
    await handleRequest(
      createJsonRequest('/v1/responses', { authorization: 'Bearer sk-route' }, { input: 'hi' }),
      response
    );
    expect(findMatchingRule).toHaveBeenCalledWith(
      expect.any(Array),
      'openai-responses',
      'client-model'
    );
    expect(httpRawRequest).toHaveBeenCalled();
    expect(routing.sessionRouting.instances).toEqual({});
  });

  it('follows request model and effort when client overrides are empty', async () => {
    vi.clearAllMocks();
    const routing = setupSessionRoute();
    routing.clientRouting['profile-test'] = {
      mode: 'client',
      modelId: null,
      reasoningEffort: null,
      pinned: false,
    };
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
      id: 'profile-test',
      name: 'Test Client',
    } as never);
    await handleRequest(
      createJsonRequest(
        '/v1/responses',
        { authorization: 'Bearer sk-route' },
        { model: 'gpt-4.1-mini', reasoning: { effort: 'low' }, input: 'hi' }
      ),
      createMockResponse()
    );
    expect(findMatchingRule).toHaveBeenCalledWith(
      expect.any(Array),
      'openai-responses',
      'gpt-4.1-mini'
    );
    const body = JSON.parse(
      Buffer.from(vi.mocked(httpRawRequest).mock.calls[0][1].body as Buffer).toString('utf-8')
    );
    expect(body.reasoning.effort).toBe('low');
    expect(routing.sessionRouting.instances).toEqual({});
  });

  it('restores an existing session target after switching back and isolates another profile', async () => {
    vi.clearAllMocks();
    const existing = {
      ...liveInstance('resume'),
      profileId: 'profile-test',
      modelId: 'session-model',
    };
    const routing = setupSessionRoute({ resume: existing });
    routing.clientRouting['profile-test'] = {
      mode: 'client',
      modelId: 'client-model',
      reasoningEffort: 'high',
      pinned: false,
    };
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
      id: 'profile-test',
      name: 'Test Client',
    } as never);
    await handleRequest(sessionRequest('resume'), createMockResponse());
    expect(findMatchingRule).toHaveBeenLastCalledWith(
      expect.any(Array),
      'openai-responses',
      'client-model'
    );
    expect(routing.sessionRouting.instances.resume).toEqual(existing);
    routing.clientRouting['profile-test'].mode = 'session';
    await handleRequest(sessionRequest('resume'), createMockResponse());
    expect(findMatchingRule).toHaveBeenLastCalledWith(
      expect.any(Array),
      'openai-responses',
      'session-model'
    );
    routing.clientRouting['profile-test'].mode = 'client';
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
      id: 'profile-other',
      name: 'Other',
    } as never);
    await handleRequest(sessionRequest('other-session'), createMockResponse());
    expect(findMatchingRule).toHaveBeenLastCalledWith(
      expect.any(Array),
      'openai-responses',
      'gpt-4.1-mini'
    );
  });

  it('keeps in-flight retries on the captured client settings after switching mode', async () => {
    vi.clearAllMocks();
    const routing = setupSessionRoute();
    routing.clientRouting['profile-test'] = {
      mode: 'client',
      modelId: 'client-model',
      reasoningEffort: 'high',
      pinned: false,
    };
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
      id: 'profile-test',
      name: 'Test Client',
    } as never);
    vi.mocked(httpRawRequest).mockImplementationOnce(async () => {
      routing.clientRouting['profile-test'] = {
        mode: 'session',
        modelId: 'new-model',
        reasoningEffort: 'low',
        pinned: false,
      };
      return {
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{"error":"temporary_failure"}'),
      };
    });
    await handleRequest(sessionRequest('in-flight'), createMockResponse());
    expect(vi.mocked(httpRawRequest).mock.calls.length).toBeGreaterThan(1);
    for (const [, options] of vi.mocked(httpRawRequest).mock.calls) {
      expect(
        JSON.parse(Buffer.from(options.body as Buffer).toString('utf-8')).reasoning.effort
      ).toBe('high');
    }
    expect(routing.sessionRouting.instances).toEqual({});
    expect(findMatchingRule).toHaveBeenLastCalledWith(
      expect.any(Array),
      'openai-responses',
      'client-model'
    );
  });

  it('ignores channel occupancy held by a client currently using client mode', async () => {
    vi.clearAllMocks();
    const routing = setupSessionRoute({
      other: { ...liveInstance('other'), profileId: 'client-other' },
    });
    routing.clientRouting['client-other'] = {
      mode: 'client',
      modelId: null,
      reasoningEffort: null,
      pinned: false,
    };
    vi.mocked(findConfigFileProfileByRouteApiKey).mockResolvedValue({
      id: 'profile-test',
      name: 'Test Client',
    } as never);
    vi.spyOn(routeSessionBindingService, 'get').mockReturnValue(undefined);
    vi.spyOn(routeSessionBindingService, 'listActive').mockReturnValue([
      { ...bindingOn('site-a', 'acc-a', 'key-a'), instanceId: 'other' },
    ]);
    await handleRequest(sessionRequest('fresh'), createMockResponse());
    expect(firstUsedApiKey()).toBe('key-a');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('follows an existing session binding instead of the configured first channel', async () => {
    vi.clearAllMocks();
    setupSessionRoute();
    vi.spyOn(routeSessionBindingService, 'get').mockReturnValue(
      bindingOn('site-b', 'acc-b', 'key-b')
    );

    await handleRequest(sessionRequest('session-1'), createMockResponse());

    expect(firstUsedApiKey()).toBe('key-b');
  });

  it('abandons a binding whose channel is disabled and falls back to normal ordering', async () => {
    vi.clearAllMocks();
    setupSessionRoute();
    vi.mocked(isRoutePathDisabled).mockImplementation(
      key => (key as { apiKeyId?: string }).apiKeyId === 'key-b'
    );
    vi.spyOn(routeSessionBindingService, 'get').mockReturnValue(
      bindingOn('site-b', 'acc-b', 'key-b')
    );

    await handleRequest(sessionRequest('session-2'), createMockResponse());

    expect(firstUsedApiKey()).toBe('key-a');
  });

  it('steers a fresh session away from a channel held by another live session', async () => {
    vi.clearAllMocks();
    setupSessionRoute({ 'other-instance': liveInstance('other-instance') });
    vi.spyOn(routeSessionBindingService, 'get').mockReturnValue(undefined);
    vi.spyOn(routeSessionBindingService, 'listActive').mockReturnValue([
      { ...bindingOn('site-a', 'acc-a', 'key-a'), instanceId: 'other-instance' },
    ]);

    await handleRequest(sessionRequest('session-3'), createMockResponse());

    expect(firstUsedApiKey()).toBe('key-b');
  });

  it('ignores occupancy from a session that is no longer active', async () => {
    vi.clearAllMocks();
    setupSessionRoute({
      'closed-instance': { ...liveInstance('closed-instance'), routingState: 'closed' },
    });
    vi.spyOn(routeSessionBindingService, 'get').mockReturnValue(undefined);
    vi.spyOn(routeSessionBindingService, 'listActive').mockReturnValue([
      { ...bindingOn('site-a', 'acc-a', 'key-a'), instanceId: 'closed-instance' },
    ]);

    await handleRequest(sessionRequest('session-4'), createMockResponse());

    expect(firstUsedApiKey()).toBe('key-a');
  });

  it('binds only after a successful attempt', async () => {
    vi.clearAllMocks();
    setupSessionRoute();
    const bind = vi.spyOn(routeSessionBindingService, 'bind').mockImplementation(() => undefined);
    vi.spyOn(routeSessionBindingService, 'get').mockReturnValue(undefined);
    vi.spyOn(routeSessionBindingService, 'listActive').mockReturnValue([]);
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 500,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({ error: { message: 'boom' } })),
    });

    await handleRequest(sessionRequest('session-5'), createMockResponse());

    expect(bind).not.toHaveBeenCalled();
  });
});

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

describe('route-proxy-service Claude count_tokens fallback', () => {
  const rule = {
    id: 'rule-claude-count',
    cliType: 'claudeCode' as const,
    pattern: 'claude-opus-4-6',
    patternType: 'exact' as const,
  };
  const routing = {
    clientRouting: { 'profile-test': { mode: 'client' as const } },
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

    expect(response.statusCode).toBe(501);
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
        outcome: 'neutral',
        statusCode: 501,
        error: 'token_count_unsupported:upstream_403',
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

    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.body)).toMatchObject({
      error: { type: 'not_supported_error' },
      reason: 'cached_unsupported',
    });
    expect(resolveChannelCredentials).not.toHaveBeenCalled();
    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(recordRouteEndpointUnsupported).not.toHaveBeenCalled();
    expect(recordRoutePathOutcome).not.toHaveBeenCalled();
    expect(recordRouteRequest).toHaveBeenCalledTimes(1);
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestKind: 'token-count',
        outcome: 'neutral',
        statusCode: 501,
        error: 'token_count_unsupported:cached_unsupported',
      })
    );
    expectSingleRequestDiagnostics({ statusCode: 501, attemptCount: 0, termination: 'completed' });
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

    expect(response.statusCode).toBe(501);
    expect(resolveChannelCredentials).not.toHaveBeenCalled();
    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(recordRouteEndpointUnsupported).not.toHaveBeenCalled();
    expect(response.headers['X-Route-Proxy-Error']).toBe('token_count_unsupported');
  });
});

describe('route-proxy-service Responses input_tokens scope', () => {
  it('does not expose the deferred Responses input_tokens endpoint', async () => {
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
        clientRouting: { 'profile-test': { mode: 'client' } },
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

    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(recordRouteEndpointUnsupported).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.body).error).toBe('unsupported_route_operation');
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
    targetProtocol: 'openai-responses' as const,
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
    clientRouting: { 'profile-test': { mode: 'client' as const } },
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

  function expectClientCancellationLog(statusCode: number | null = null): void {
    expect(recordRouteRequest).toHaveBeenCalledTimes(1);
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        cliType: 'codex',
        routeRuleId: rule.id,
        siteId: firstChannel.siteId,
        accountId: firstChannel.accountId,
        apiKeyId: firstChannel.apiKeyId,
        outcome: 'neutral',
        statusCode: 499,
        error: 'route_client_cancelled',
      })
    );
    expectSingleRequestDiagnostics({
      statusCode,
      attemptCount: 1,
      termination: 'client_cancelled',
    });
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
    expectClientCancellationLog();
    expect(response.end).not.toHaveBeenCalled();
    response.emit('close');
    response.emit('finish');
    expect(getRouteDiagnostics('Route request completed')).toHaveLength(1);
    expect(response.listenerCount('finish')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
    expect(request.listenerCount('aborted')).toBe(0);
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
    expectClientCancellationLog();
    expect(response.end).not.toHaveBeenCalled();
  });

  it('counts no upstream attempts when cancelled during credential resolution', async () => {
    setupCodexCancellationRoute();
    let finishCredentials: (value: null) => void = () => {};
    vi.mocked(resolveChannelCredentials).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishCredentials = resolve;
        })
    );
    const request = createControllableJsonRequest(
      '/v1/responses',
      { authorization: 'Bearer sk-route', 'content-type': 'application/json' },
      { model: 'gpt-4.1-mini', input: 'hi' }
    );
    const response = createMockResponse();
    const pending = handleRequest(request, response);
    await vi.waitFor(() => expect(resolveChannelCredentials).toHaveBeenCalledTimes(1));

    response.emit('close');
    finishCredentials(null);
    await pending;

    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(recordRoutePathOutcome).not.toHaveBeenCalled();
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, statusCode: 499, error: 'route_client_cancelled' })
    );
    expectSingleRequestDiagnostics({
      statusCode: null,
      attemptCount: 0,
      termination: 'client_cancelled',
    });
  });

  it('keeps path success for a completed late upstream result without duplicating the log', async () => {
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
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        '{"output": [{"type":"message","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":2,"output_tokens":1,"total_tokens":3}}'
      ),
    });
    await pending;

    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining(firstChannel),
      'success',
      expect.objectContaining({ statusCode: 200 }),
      expect.objectContaining({ maxAttemptsPerRoutePath: expect.any(Number) })
    );
    expectClientCancellationLog();
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

    const partialStream = Buffer.from(
      [
        'event: response.output_text.delta',
        'data: {"type":"response.output_text.delta","delta":"hi"}',
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
          void Promise.resolve(config.onChunk?.(partialStream)).catch(reject);
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
    expectClientCancellationLog(200);
  });

  it('records success when the client closes after receiving a successful stream terminal', async () => {
    setupCodexCancellationRoute();
    const completedStream = Buffer.from(
      [
        'event: response.output_text.delta',
        'data: {"type":"response.output_text.delta","delta":"hi"}',
        '',
        'event: response.completed',
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7}}}',
        '',
        '',
      ].join('\n')
    );
    const upstreamHeaders = { 'content-type': 'text/event-stream' };
    const request = createControllableJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', stream: true, input: 'hi' }
    );
    const response = createMockResponse();

    vi.mocked(httpRawStreamRequest).mockImplementation(
      (_url, config = {}) =>
        new Promise((resolve, reject) => {
          expect(
            config.onResponse?.({
              status: 200,
              statusText: 'OK',
              headers: upstreamHeaders,
            })
          ).toBe(true);
          void Promise.resolve(config.onChunk?.(completedStream))
            .then(() => {
              expect(config.shouldResolveOnAbort?.()).toBe(false);
              response.emit('close');
              expect(config.signal?.aborted).toBe(false);
              resolve({
                status: 200,
                headers: upstreamHeaders,
                body: completedStream,
                firstByteLatencyMs: 1,
              });
            })
            .catch(reject);
        })
    );

    await handleRequest(request, response);

    expect(recordRouteRequest).toHaveBeenCalledTimes(1);
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        outcome: 'success',
        statusCode: 200,
      })
    );
    expect(recordRouteRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ error: 'route_client_cancelled' })
    );
    expectSingleRequestDiagnostics({ statusCode: 200, attemptCount: 1, termination: 'completed' });
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
    expectClientCancellationLog();
  });

  it('records cancellation when the downstream closes before the request body finishes', async () => {
    setupCodexCancellationRoute();

    const request = createControllableJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
      },
      { model: 'gpt-4.1-mini', input: 'hi' },
      { deferBody: true }
    );
    const response = createMockResponse();
    const pending = handleRequest(request, response);

    response.emit('close');
    request.push(Buffer.from(JSON.stringify({ model: 'gpt-4.1-mini', input: 'hi' })));
    request.push(null);
    await pending;

    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(recordRoutePathOutcome).not.toHaveBeenCalled();
    expect(recordRouteRequest).toHaveBeenCalledTimes(1);
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 0,
        cliType: 'codex',
        outcome: 'neutral',
        statusCode: 499,
        error: 'route_client_cancelled',
      })
    );
    expect(response.end).not.toHaveBeenCalled();
    expectSingleRequestDiagnostics({
      statusCode: null,
      attemptCount: 0,
      termination: 'client_cancelled',
    });
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
      targetProtocol: 'openai-responses' as const,
      targetEndpoint: '/v1/responses',
      canonicalModel: 'duckcoding-route',
      resolvedModel: 'duckcoding',
      sitePriority: 0,
      apiKeyPriority: 0,
    };
    const routing = {
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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

  it('forwards SenseNova Claude-compatible upstream auth as x-api-key', async () => {
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
    expect(headers?.['x-api-key']).toBe('sk-sensenova-upstream');
    expect(headers?.authorization).toBeUndefined();
    expect(response.statusCode).toBe(200);
  });
});

describe('route-proxy-service CLI model fallback', () => {
  it('routes normal Codex requests through the explicit request model instead of the legacy CLI selection', async () => {
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
          'gpt-4o-from-external-config': {
            canonicalName: 'gpt-4o-from-external-config',
            aliases: ['gpt-4o-from-external-config'],
            sources: [],
            vendor: 'gpt' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
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
      model === 'gpt-4o-from-external-config' ? (selectedRule as never) : null
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

    expect(vi.mocked(findMatchingRule).mock.calls.map(call => call[2])).toEqual([
      'gpt-4o-from-external-config',
    ]);
    expect(resolveChannels).toHaveBeenCalledWith(selectedRule, 'gpt-4o-from-external-config');
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
        canonicalModel: 'gpt-4o-from-external-config',
        resolvedModel: 'gpt-5-selected-upstream',
      })
    );
    expect(response.statusCode).toBe(200);
  });

  it('binds an ARMED RouteInstance from native Codex metadata before route selection', async () => {
    vi.clearAllMocks();

    const selectedRule = {
      id: 'rule-session-model',
      cliType: 'codex' as const,
      pattern: 'session-model',
      patternType: 'exact' as const,
    };
    const channels = ['primary', 'fallback'].map((name, index) => ({
      routeRuleId: selectedRule.id,
      siteId: `site-${name}`,
      accountId: `account-${name}`,
      apiKeyId: `key-${name}`,
      cliType: 'codex' as const,
      canonicalModel: 'session-model',
      resolvedModel: `session-upstream-${index + 1}`,
    }));
    const routing = {
      clientRouting: {},
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [selectedRule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        openCode: null,
        grokBuild: null,
      },
      cliThinkingEffortSelections: {
        claudeCode: null,
        codex: null,
        openCode: null,
        grokBuild: null,
      },
      sessionRouting: {
        instances: {
          'route-window-1': {
            id: 'route-window-1',
            display: {},
            modelId: 'session-model',
            reasoningEffort: 'vendor-ultra-2',
            routingState: 'armed' as const,
            presenceState: 'unknown' as const,
          },
        },
        currentRouteBySlot: {},
        extractionRules: [],
        overrides: {},
        activeWindowMinutes: 30,
        recentWindowHours: 24,
        historyRetentionDays: 30,
        overrideRetentionDays: 90,
      },
      modelRegistry: {
        version: 1,
        sources: [],
        entries: {
          'request-model': {
            canonicalName: 'request-model',
            aliases: ['request-model'],
            sources: [],
            vendor: 'gpt' as const,
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
          'session-model': {
            canonicalName: 'session-model',
            aliases: ['session-model'],
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
      saveConfig: vi.fn(),
      getSiteById: vi.fn((siteId: string) => ({ id: siteId, name: siteId })),
      getAccountById: vi.fn((accountId: string) => ({ id: accountId, account_name: accountId })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockReturnValue('request-model');
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([selectedRule as never]);
    vi.mocked(findMatchingRule).mockImplementation((_rules, _cliType, model) =>
      model === 'session-model' || model === 'request-model' ? (selectedRule as never) : null
    );
    vi.mocked(resolveChannels).mockReturnValue(channels);
    vi.mocked(resolveChannelCredentials).mockImplementation(async channel => ({
      baseUrl: `https://${channel.siteId}.example.com`,
      apiKey: `sk-${channel.apiKeyId}`,
    }));
    vi.mocked(isRoutePathDisabled).mockReturnValue(false);
    vi.mocked(recordRoutePathOutcome).mockImplementation(async channel => ({
      ...channel,
      windowStartedAt: 1,
      windowRequestCount: 1,
      windowSuccessCount: 1,
      successRate: 1,
      updatedAt: 1,
    }));
    vi.mocked(httpRawRequest)
      .mockResolvedValueOnce({
        status: 503,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{"error":{"message":"temporary failure"}}'),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(
          '{"id":"resp_1","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}'
        ),
      });

    const request = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
        'x-codex-window-id': 'session-1:5',
      },
      {
        model: 'request-model',
        input: 'hello',
        reasoning: { effort: 'low' },
        client_metadata: { session_id: 'session-1' },
      }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(findMatchingRule).toHaveBeenCalledWith(
      expect.any(Array),
      'openai-responses',
      'session-model'
    );
    expect(resolveChannels).toHaveBeenCalledWith(selectedRule, 'session-model');
    expect(httpRawRequest).toHaveBeenCalledTimes(2);
    expect(routing.sessionRouting.instances['route-window-1']).toEqual(
      expect.objectContaining({
        routeKey: { agentId: 'codex', runtimeSlotId: 'session-1', sessionId: 'session-1' },
        display: {
          observedAgentName: 'Codex',
          observedRuntimeSlotLabel: 'Codex 会话',
        },
        routingState: 'active',
        createdAt: expect.any(Number),
        lastRequestAt: expect.any(Number),
      })
    );
    expect(routing.sessionRouting.currentRouteBySlot).toEqual({
      '["profile-test","codex","session-1"]': 'route-window-1',
    });
    expect(vi.mocked(unifiedConfigManager.saveConfig)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(unifiedConfigManager.saveConfig).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(httpRawRequest).mock.invocationCallOrder[0]
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'codex',
        agentName: 'Codex',
        canonicalModel: 'session-model',
        reasoningEffort: 'vendor-ultra-2',
      })
    );
    expect(
      vi
        .mocked(httpRawRequest)
        .mock.calls.every(call => call[1].headers?.['x-codex-window-id'] === 'session-1:5')
    ).toBe(true);
    expect(
      vi
        .mocked(httpRawRequest)
        .mock.calls.map(call => JSON.parse(Buffer.from(call[1].body as Buffer).toString('utf-8')))
    ).toEqual([
      expect.objectContaining({
        model: 'session-upstream-1',
        reasoning: expect.objectContaining({ effort: 'vendor-ultra-2' }),
      }),
      expect.objectContaining({
        model: 'session-upstream-2',
        reasoning: expect.objectContaining({ effort: 'vendor-ultra-2' }),
      }),
    ]);
    expect(response.statusCode).toBe(200);

    vi.mocked(httpRawRequest).mockReset();
    const requestIdOnly = createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer sk-route',
        'content-type': 'application/json',
        'x-request-id': 'window-1',
      },
      { model: 'request-model', input: 'hello', reasoning: { effort: 'low' } }
    );
    const requestIdOnlyResponse = createMockResponse();

    await handleRequest(requestIdOnly, requestIdOnlyResponse);

    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(requestIdOnlyResponse.statusCode).toBe(409);
    expect(JSON.parse(requestIdOnlyResponse.body)).toMatchObject({
      error: 'session_identity_required',
    });
  });
});

describe('route-proxy-service Codex utility request diagnostics', () => {
  function setupCodexUtilityRoute() {
    vi.clearAllMocks();
    const sessionRouting = structuredClone(DEFAULT_ROUTE_SESSION_ROUTING_CONFIG);
    const routing = { ...structuredClone(DEFAULT_ROUTING_CONFIG), sessionRouting };
    const rule = {
      id: 'rule-codex-utility',
      cliType: 'codex' as const,
      pattern: '*',
      patternType: 'wildcard' as const,
    };
    routing.rules = [rule];
    routing.server.unifiedApiKey = 'private-route-key-sentinel';
    for (const model of ['root-model', 'helper-model', 'armed-model']) {
      routing.modelRegistry.entries[model] = {
        canonicalName: model,
        aliases: [model],
        sources: [],
        vendor: 'gpt',
        hasOverride: false,
        createdAt: 1,
        updatedAt: 1,
      };
      routing.modelRegistry.displayItems.push({
        id: `display-${model}`,
        canonicalName: model,
        mode: 'manual',
        sourceKeys: [],
        originalModelOrder: [],
        runtimeConfig: { ...DEFAULT_ROUTE_RUNTIME_CONFIG, maxAttemptsPerRoutePath: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
    }
    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => routing),
      saveConfig: vi.fn(async () => undefined),
      getSiteById: vi.fn((id: string) => ({ id, name: id })),
      getAccountById: vi.fn((id: string) => ({ id, account_name: id })),
    });
    vi.mocked(detectCliTypeFromPath).mockReturnValue('codex');
    vi.mocked(extractModelFromBody).mockImplementation(body =>
      body && typeof body === 'object' && 'model' in body && typeof body.model === 'string'
        ? body.model
        : null
    );
    vi.mocked(extractModelFromPath).mockReturnValue(null);
    vi.mocked(sortRules).mockReturnValue([rule]);
    vi.mocked(findMatchingRule).mockReturnValue(rule);
    vi.mocked(resolveChannels).mockImplementation((_rule, canonicalModel) =>
      ['primary', 'fallback'].map(name => ({
        routeRuleId: rule.id,
        siteId: `site-${name}`,
        accountId: `account-${name}`,
        apiKeyId: `key-${name}`,
        cliType: 'codex' as const,
        targetProtocol: 'openai-responses' as const,
        canonicalModel: canonicalModel!,
        resolvedModel: canonicalModel!,
      }))
    );
    vi.mocked(resolveChannelCredentials).mockResolvedValue({
      baseUrl: 'https://codex.example.com',
      apiKey: 'private-upstream-key-sentinel',
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
    vi.mocked(httpRawRequest)
      .mockReset()
      .mockResolvedValue({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(
          '{"output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":2,"output_tokens":1,"total_tokens":3}}'
        ),
      });
    return routing;
  }

  function codexRequest(
    threadId: string,
    {
      threadSource = 'system',
      requestKind = 'turn',
      model = 'helper-model',
      effort = 'low',
      headerProjection = false,
      subagentKind,
      rootSessionId,
    }: {
      threadSource?: string;
      requestKind?: string;
      model?: string;
      effort?: string;
      headerProjection?: boolean;
      subagentKind?: string;
      rootSessionId?: string;
    } = {}
  ) {
    const sessionId = rootSessionId ?? threadId;
    const metadata = JSON.stringify({
      session_id: sessionId,
      thread_id: threadId,
      request_kind: requestKind,
      thread_source: threadSource,
      ...(subagentKind ? { subagent_kind: subagentKind } : {}),
    });
    return createJsonRequest(
      '/v1/responses',
      {
        authorization: 'Bearer private-route-key-sentinel',
        'content-type': 'application/json',
        'session-id': sessionId,
        'thread-id': threadId,
        'x-codex-window-id': `${threadId}:0`,
        ...(headerProjection ? { 'x-codex-turn-metadata': metadata } : {}),
      },
      {
        model,
        input: 'private-prompt-sentinel',
        reasoning: { effort },
        client_metadata: {
          'x-codex-window-id': `${threadId}:0`,
          'x-codex-turn-metadata': metadata,
        },
      }
    );
  }

  it('forwards repeated system helpers without changing the root card or their requested model and effort', async () => {
    const routing = setupCodexUtilityRoute();
    await handleRequest(
      codexRequest('private-root-session', {
        threadSource: 'user',
        model: 'root-model',
        effort: 'high',
      }),
      createMockResponse()
    );
    const rootState = structuredClone(routing.sessionRouting);
    expect(Object.values(rootState.instances!)).toHaveLength(1);
    const saveCount = vi.mocked(unifiedConfigManager.saveConfig).mock.calls.length;

    for (let index = 0; index < 3; index++) {
      const response = createMockResponse();
      await handleRequest(
        codexRequest(`private-helper-session-${index}`, { headerProjection: index === 1 }),
        response
      );
      expect(response.statusCode).toBe(200);
      expect(response.listenerCount('finish')).toBe(0);
      expect(response.listenerCount('close')).toBe(0);
    }

    expect(routing.sessionRouting).toEqual(rootState);
    expect(unifiedConfigManager.saveConfig).toHaveBeenCalledTimes(saveCount);
    expect(httpRawRequest).toHaveBeenCalledTimes(4);
    const forwarded = vi
      .mocked(httpRawRequest)
      .mock.calls.map(([, config]) =>
        JSON.parse(Buffer.from(config.body as Buffer).toString('utf-8'))
      );
    expect(forwarded).toEqual([
      expect.objectContaining({ model: 'root-model', reasoning: { effort: 'high' } }),
      ...Array.from({ length: 3 }, () =>
        expect.objectContaining({ model: 'helper-model', reasoning: { effort: 'low' } })
      ),
    ]);
    const bindings = getRouteDiagnostics('RouteInstance identity binding');
    const incoming = getRouteDiagnostics('Route request received');
    const completed = getRouteDiagnostics('Route request completed');
    expect(bindings).toHaveLength(4);
    expect(incoming).toHaveLength(4);
    expect(completed).toHaveLength(4);
    expect(new Set(incoming.map(entry => entry.requestId)).size).toBe(4);
    bindings.forEach((binding, index) => {
      expect(binding).toMatchObject({
        requestId: incoming[index].requestId,
        requestKind: 'turn',
        threadSource: index === 0 ? 'user' : 'system',
        resolutionPath: index === 0 ? 'created' : 'utility',
        isCodexUtility: index !== 0,
        sessionIdHash: expect.stringMatching(/^[a-f0-9]{8}$/),
      });
      expect(binding).not.toHaveProperty('attempt');
      expect(binding).not.toHaveProperty('fallback');
      expect(completed[index]).toMatchObject({
        requestId: incoming[index].requestId,
        statusCode: 200,
        attemptCount: 1,
        termination: 'completed',
      });
      if (index > 0) {
        expect(binding).toMatchObject({ bindingState: 'utility', memberAppended: false });
        expect(binding.createdReason).toBeUndefined();
        expect(binding.instanceIdHash).toBeUndefined();
        expect(vi.mocked(recordRouteRequest).mock.calls[index][0].routeInstanceId).toBeUndefined();
      }
    });
    const diagnostics = JSON.stringify(routeDiagnosticLog.mock.calls);
    for (const value of [
      'private-root-session',
      'private-helper-session',
      'private-prompt-sentinel',
      'private-route-key-sentinel',
      'private-upstream-key-sentinel',
    ]) {
      expect(diagnostics).not.toContain(value);
    }
  });

  it('logs a bound exact-session reuse diagnostic when a user thread changes inside one conversation', async () => {
    const routing = setupCodexUtilityRoute();
    await handleRequest(
      codexRequest('private-root-session', { threadSource: 'user', model: 'root-model' }),
      createMockResponse()
    );
    const rootCard = Object.values(routing.sessionRouting.instances!)[0];
    const saveCount = vi.mocked(unifiedConfigManager.saveConfig).mock.calls.length;

    await handleRequest(
      codexRequest('private-next-thread', {
        threadSource: 'user',
        model: 'root-model',
        rootSessionId: 'private-root-session',
      }),
      createMockResponse()
    );

    expect(Object.values(routing.sessionRouting.instances!)).toHaveLength(1);
    expect(rootCard).toMatchObject({
      routingState: 'active',
      memberSessionIds: ['private-next-thread'],
    });
    expect(vi.mocked(unifiedConfigManager.saveConfig).mock.calls.length).toBe(saveCount + 1);
    const incoming = getRouteDiagnostics('Route request received');
    const bindings = getRouteDiagnostics('RouteInstance identity binding');
    const completed = getRouteDiagnostics('Route request completed');
    expect(incoming).toHaveLength(2);
    expect(bindings).toHaveLength(2);
    expect(completed).toHaveLength(2);
    expect(bindings[1]).toMatchObject({
      requestId: incoming[1].requestId,
      identitySource: 'codex',
      resolutionPath: 'exact',
      bindingState: 'bound',
      memberAppended: true,
      instanceIdHash: expect.stringMatching(/^[a-f0-9]{8}$/),
    });
    expect(bindings[1].createdReason).toBeUndefined();
    expect(completed[1]).toMatchObject({
      requestId: incoming[1].requestId,
      statusCode: 200,
      attemptCount: 1,
      termination: 'completed',
    });
    const diagnostics = JSON.stringify(routeDiagnosticLog.mock.calls);
    expect(diagnostics).not.toContain('private-root-session');
    expect(diagnostics).not.toContain('private-next-thread');
  });

  it('leaves ARMED untouched for helpers and binds it on the next user turn', async () => {
    const routing = setupCodexUtilityRoute();
    routing.sessionRouting.instances!['waiting-route'] = {
      id: 'waiting-route',
      display: {},
      modelId: 'armed-model',
      reasoningEffort: 'high',
      routingState: 'armed',
      presenceState: 'unknown',
    };
    const armedState = structuredClone(routing.sessionRouting);
    await handleRequest(codexRequest('private-helper-first'), createMockResponse());

    expect(routing.sessionRouting).toEqual(armedState);
    expect(unifiedConfigManager.saveConfig).not.toHaveBeenCalled();
    expectSingleRequestDiagnostics({ statusCode: 200, attemptCount: 1, termination: 'completed' });

    await handleRequest(
      codexRequest('private-user-next', { threadSource: 'user', model: 'root-model' }),
      createMockResponse()
    );
    expect(Object.values(routing.sessionRouting.instances!)).toHaveLength(1);
    expect(routing.sessionRouting.instances!['waiting-route']).toMatchObject({
      routingState: 'active',
      routeKey: { sessionId: 'private-user-next' },
    });
    const binding = getRouteDiagnostics('RouteInstance identity binding')[1];
    expect(binding).toMatchObject({ resolutionPath: 'armed', isCodexUtility: false });
    expect(binding.createdReason).toBeUndefined();
  });

  it('keeps user threads with the same request kind independent and redacts unknown metadata', async () => {
    const routing = setupCodexUtilityRoute();
    for (const threadId of ['private-user-a', 'private-user-b']) {
      await handleRequest(
        codexRequest(threadId, { threadSource: 'user', model: 'root-model' }),
        createMockResponse()
      );
    }
    expect(Object.values(routing.sessionRouting.instances!)).toHaveLength(2);
    await handleRequest(
      codexRequest('private-unknown-source', {
        threadSource: 'private-thread-source-sentinel',
        requestKind: 'private-request-kind-sentinel',
      }),
      createMockResponse()
    );
    expect(Object.values(routing.sessionRouting.instances!)).toHaveLength(3);
    expect(getRouteDiagnostics('RouteInstance identity binding')[2]).toMatchObject({
      threadSource: 'other',
      requestKind: 'other',
      resolutionPath: 'created',
      isCodexUtility: false,
    });
    const diagnostics = JSON.stringify(routeDiagnosticLog.mock.calls);
    expect(diagnostics).not.toContain('private-thread-source-sentinel');
    expect(diagnostics).not.toContain('private-request-kind-sentinel');
    expect(diagnostics).not.toContain('private-unknown-source');
  });

  it('rejects incomplete system subagent identity without creating a profile fallback card', async () => {
    const routing = setupCodexUtilityRoute();
    const sessionState = structuredClone(routing.sessionRouting);
    const response = createMockResponse();
    await handleRequest(
      codexRequest('private-system-subagent', { subagentKind: 'review' }),
      response
    );

    expect(response.statusCode).toBe(409);
    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(routing.sessionRouting).toEqual(sessionState);
    expect(unifiedConfigManager.saveConfig).not.toHaveBeenCalled();
    expect(JSON.parse(response.body)).toMatchObject({ error: 'session_identity_required' });
    expectSingleRequestDiagnostics({ statusCode: 409, attemptCount: 0, termination: 'completed' });
  });

  it('correlates each failed helper request with its own bounded fallback attempts without creating cards', async () => {
    const routing = setupCodexUtilityRoute();
    await handleRequest(
      codexRequest('private-root-session', { threadSource: 'user', model: 'root-model' }),
      createMockResponse()
    );
    const rootState = structuredClone(routing.sessionRouting);
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 503,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"error":{"message":"upstream unavailable"}}'),
    });
    for (const threadId of ['private-failed-helper', 'private-new-helper']) {
      const response = createMockResponse();
      await handleRequest(codexRequest(threadId), response);
      expect(response.statusCode).toBe(503);
      response.emit('close');
    }

    expect(routing.sessionRouting).toEqual(rootState);
    expect(httpRawRequest).toHaveBeenCalledTimes(5);
    const incoming = getRouteDiagnostics('Route request received');
    const completed = getRouteDiagnostics('Route request completed');
    const bindings = getRouteDiagnostics('RouteInstance identity binding');
    expect(incoming).toHaveLength(3);
    expect(completed).toHaveLength(3);
    expect(bindings).toHaveLength(3);
    expect(new Set(incoming.map(entry => entry.requestId)).size).toBe(3);
    incoming.slice(1).forEach((entry, index) => {
      expect(completed[index + 1]).toMatchObject({
        requestId: entry.requestId,
        statusCode: 503,
        attemptCount: 2,
        termination: 'completed',
      });
      expect(bindings[index + 1]).toMatchObject({
        requestId: entry.requestId,
        resolutionPath: 'utility',
      });
      const attempts = vi
        .mocked(recordRouteRequest)
        .mock.calls.map(([attempt]) => attempt)
        .filter(attempt => attempt.requestId === entry.requestId);
      expect(attempts.map(attempt => attempt.attempt)).toEqual([1, 2]);
      expect(attempts.map(attempt => attempt.siteId)).toEqual(['site-primary', 'site-fallback']);
      expect(completed[index + 1]).not.toHaveProperty('parentRequestId');
      expect(completed[index + 1]).not.toHaveProperty('retryRequestId');
    });
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
        clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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

  it('marks an incomplete OpenCode native stream as failed after resolving its endpoint', async () => {
    vi.clearAllMocks();
    setupOpenCodeRoute({
      detectedCliType: 'codex',
      channelTargetProtocol: 'native',
    });
    const partialChunk = Buffer.from(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial","sequence_number":2}\n\n'
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
    expect(response.body).toContain(partialChunk.toString('utf-8'));
    expect(response.body).toContain('event: error');
    expect(response.body).toContain('"sequence_number":3');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ targetProtocol: 'openai-responses' }),
      'failure',
      expect.objectContaining({ error: 'incomplete_streaming_response:missing_terminal_event' }),
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
        store: false,
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
        reasoning_effort: 'high',
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
  const buildCompletedAnthropicToolPrefix = (): Buffer =>
    Buffer.from(
      [
        'event: message_start',
        'data: {"type":"message_start","message":{"content":[]}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read","input":{}}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        '',
      ].join('\n'),
      'utf8'
    );

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

  it.each(Object.keys(protocolCases) as Array<keyof typeof protocolCases>)(
    'routes an unregistered non-streaming client through %s by pathname',
    async sourceProtocol => {
      vi.clearAllMocks();
      const source = protocolCases[sourceProtocol];
      setupOpenCodeRoute({
        detectedCliType: source.detectedCliType,
        channelTargetProtocol: 'native',
      });
      vi.mocked(httpRawRequest).mockResolvedValue({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify(source.responseBody)),
      });
      const request = createJsonRequest(
        source.path,
        {
          ...source.routeHeaders,
          'content-type': 'application/json',
          'user-agent': 'UnregisteredEditor/1.0',
        },
        source.requestBody
      );
      const response = createMockResponse();

      await handleRequest(request, response);

      expect(response.statusCode).toBe(200);
      expect(httpRawRequest).toHaveBeenCalledWith(
        `https://opencode-upstream.example.com${source.path}`,
        expect.objectContaining({ method: 'POST', preferElectronNet: true })
      );
      expect(vi.mocked(httpRawRequest).mock.calls[0]?.[1]?.headers).not.toHaveProperty(
        'x-api-detect-cli'
      );
    }
  );

  it.each([
    ['anthropic-messages', buildClaudeTextSse('unregistered')],
    ['openai-responses', buildResponsesTextSse('unregistered')],
    ['openai-chat-completions', buildChatTextSse('unregistered')],
  ] as const)(
    'routes an unregistered streaming client through %s by pathname',
    async (sourceProtocol, streamBody) => {
      vi.clearAllMocks();
      const source = protocolCases[sourceProtocol];
      setupOpenCodeRoute({
        detectedCliType: source.detectedCliType,
        channelTargetProtocol: 'native',
      });
      const upstreamHeaders = { 'content-type': 'text/event-stream' };
      vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, requestConfig = {}) => {
        expect(
          requestConfig.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })
        ).toBe(true);
        await requestConfig.onChunk?.(streamBody);
        return { status: 200, headers: upstreamHeaders, body: streamBody };
      });
      const request = createJsonRequest(
        source.path,
        {
          ...source.routeHeaders,
          'content-type': 'application/json',
          'user-agent': 'UnregisteredCli/1.0',
        },
        { ...source.requestBody, stream: true }
      );
      const response = createMockResponse();

      await handleRequest(request, response);

      expect(response.statusCode).toBe(200);
      expect(httpRawStreamRequest).toHaveBeenCalledWith(
        `https://opencode-upstream.example.com${source.path}`,
        expect.objectContaining({ method: 'POST', preferElectronNet: true })
      );
      expect(response.body).toContain('unregistered');
      expect(vi.mocked(httpRawStreamRequest).mock.calls[0]?.[1]?.headers).not.toHaveProperty(
        'x-api-detect-cli'
      );
    }
  );

  it.each(protocolMatrix)(
    'streams OpenCode $sourceProtocol <- $targetProtocol before upstream completion',
    async ({ sourceProtocol, targetProtocol }) => {
      vi.clearAllMocks();
      const source = protocolCases[sourceProtocol];
      const target = protocolCases[targetProtocol];
      const targetStream =
        targetProtocol === 'anthropic-messages'
          ? buildClaudeTextSse('incremental-cross-protocol')
          : targetProtocol === 'openai-responses'
            ? buildResponsesTextSse('incremental-cross-protocol')
            : buildChatTextSse('incremental-cross-protocol');
      setupOpenCodeRoute({
        detectedCliType: source.detectedCliType,
        channelTargetProtocol: targetProtocol,
      });
      const upstreamHeaders = { 'content-type': 'text/event-stream' };
      const response = createMockResponse();
      vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, requestConfig = {}) => {
        if (sourceProtocol !== targetProtocol) {
          expect(requestConfig.retainStreamedBody).toBe(false);
        }
        expect(
          requestConfig.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })
        ).toBe(true);
        await requestConfig.onChunk?.(targetStream);
        expect(response.body).toContain('incremental-cross-protocol');
        return { status: 200, headers: upstreamHeaders, body: targetStream };
      });
      const request = createJsonRequest(
        source.path,
        {
          ...source.routeHeaders,
          'content-type': 'application/json',
          'x-api-detect-cli': 'openCode',
        },
        { ...source.requestBody, stream: true }
      );

      await handleRequest(request, response);

      expect(response.statusCode).toBe(200);
      expect(httpRawStreamRequest).toHaveBeenCalledWith(
        `https://opencode-upstream.example.com${target.path}`,
        expect.objectContaining({ method: 'POST', preferElectronNet: true })
      );
      if (sourceProtocol === 'anthropic-messages') {
        expect(response.body).toContain('event: message_stop');
      } else if (sourceProtocol === 'openai-responses') {
        expect(response.body).toContain('event: response.completed');
      } else {
        expect(response.body).toContain('data: [DONE]');
      }
    }
  );

  it('prefers a larger remaining context window after overflow without changing the first candidate', async () => {
    vi.clearAllMocks();
    const source = protocolCases['openai-responses'];
    const { channel } = setupOpenCodeRoute({
      detectedCliType: source.detectedCliType,
      channelTargetProtocol: 'openai-responses',
    });
    vi.mocked(resolveChannels).mockReturnValue([
      { ...channel, apiKeyId: 'small-key', resolvedModel: 'small' },
      { ...channel, apiKeyId: 'medium-key', resolvedModel: 'medium' },
      { ...channel, apiKeyId: 'large-key', resolvedModel: 'large' },
    ]);
    const capacities: Record<string, number> = { small: 100, medium: 300, large: 900 };
    const metadata = vi
      .spyOn(modelMetadataService, 'getModelMetadata')
      .mockImplementation(model => ({
        context: capacities[model || ''],
      }));
    try {
      vi.mocked(httpRawRequest)
        .mockResolvedValueOnce({
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: Buffer.from('{"error":{"message":"context length exceeded"}}'),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: Buffer.from(JSON.stringify(source.responseBody)),
        });
      const response = createMockResponse();
      await handleRequest(
        createJsonRequest(
          source.path,
          {
            ...source.routeHeaders,
            'content-type': 'application/json',
            'x-api-detect-cli': 'openCode',
          },
          source.requestBody
        ),
        response
      );
      expect(response.statusCode).toBe(200);
      expect(httpRawRequest).toHaveBeenCalledTimes(2);
      const models = vi
        .mocked(httpRawRequest)
        .mock.calls.map(
          ([, config]) => JSON.parse(Buffer.from(config?.body as Buffer).toString('utf8')).model
        );
      expect(models).toEqual(['small', 'large']);
    } finally {
      metadata.mockRestore();
    }
  });

  it.each(protocolMatrix.flatMap(pair => [false, true].map(stream => ({ ...pair, stream }))))(
    'normalizes overflow for $sourceProtocol <- $targetProtocol (stream=$stream) without poisoning routes',
    async ({ sourceProtocol, targetProtocol, stream }) => {
      vi.clearAllMocks();
      const source = protocolCases[sourceProtocol];
      setupOpenCodeRoute({
        detectedCliType: source.detectedCliType,
        channelTargetProtocol: targetProtocol,
      });
      const body = Buffer.from(
        JSON.stringify({
          error: {
            type: 'invalid_request_error',
            code: 'context_length_exceeded',
            message: 'context length exceeded',
          },
        })
      );
      const headers = { 'content-type': 'application/json' };
      vi.mocked(httpRawRequest).mockResolvedValue({ status: 400, headers, body });
      vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
        expect(config.onResponse?.({ status: 400, statusText: 'Bad Request', headers })).toBe(
          false
        );
        return { status: 400, headers, body };
      });
      const request = () =>
        createJsonRequest(
          source.path,
          {
            ...source.routeHeaders,
            'content-type': 'application/json',
            'x-api-detect-cli': 'openCode',
          },
          { ...source.requestBody, stream }
        );
      for (let index = 0; index < 2; index++) {
        const response = createMockResponse();
        await handleRequest(request(), response);
        expect(response.statusCode).toBe(413);
        const payload = JSON.parse(response.body);
        if (sourceProtocol === 'anthropic-messages') {
          expect(payload).toMatchObject({ type: 'error', error: { type: 'request_too_large' } });
        } else {
          expect(payload).toMatchObject({
            error: {
              type: 'invalid_request_error',
              code: 'context_length_exceeded',
              param: 'input',
            },
          });
        }
        expect(response.headers['X-Route-Proxy-Failure-Class']).toBe('overflow');
        expect(response.headers['X-Route-Proxy-Attempts']).toBe('1');
      }
      expect(stream ? httpRawStreamRequest : httpRawRequest).toHaveBeenCalledTimes(2);
      expect(recordRoutePathOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ apiKeyId: 'key-opencode' }),
        'neutral',
        expect.objectContaining({ statusCode: 400 }),
        expect.any(Object)
      );
      const forwarded = (stream ? vi.mocked(httpRawStreamRequest) : vi.mocked(httpRawRequest)).mock
        .calls[0][1];
      const forwardedBody = JSON.parse(Buffer.from(forwarded?.body as Buffer).toString('utf8'));
      expect(JSON.stringify(forwardedBody)).toContain('hello');
    }
  );

  it('absorbs a rejected cross-protocol streaming HTTP failure into a retryable response', async () => {
    vi.clearAllMocks();
    const source = protocolCases['anthropic-messages'];
    setupOpenCodeRoute({
      detectedCliType: source.detectedCliType,
      channelTargetProtocol: 'openai-responses',
    });
    const failureBody = Buffer.from(
      JSON.stringify({ error: { type: 'server_error', message: 'upstream busy' } }),
      'utf8'
    );
    const upstreamHeaders = { 'content-type': 'application/json' };
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, requestConfig = {}) => {
      expect(requestConfig.retainStreamedBody).toBe(false);
      expect(
        requestConfig.onResponse?.({
          status: 503,
          statusText: 'Service Unavailable',
          headers: upstreamHeaders,
        })
      ).toBe(false);
      return { status: 503, headers: upstreamHeaders, body: failureBody };
    });
    const request = createJsonRequest(
      source.path,
      { ...source.routeHeaders, 'content-type': 'application/json' },
      { ...source.requestBody, stream: true }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toBe(failureBody.toString('utf8'));
    expect(JSON.parse(response.body).error.message).toContain('upstream busy');
    expect(response.headers['X-Route-Proxy-Upstream-Status']).toBe('503');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-opencode' }),
      'failure',
      expect.objectContaining({ statusCode: 503 }),
      expect.any(Object)
    );
  });

  it('retries a zero-byte cross-protocol SSE response before transformer EOF validation', async () => {
    vi.clearAllMocks();
    const source = protocolCases['anthropic-messages'];
    setupOpenCodeRoute({
      detectedCliType: source.detectedCliType,
      channelTargetProtocol: 'openai-responses',
    });
    const upstreamHeaders = { 'content-type': 'text/event-stream' };
    const completedStream = buildResponsesTextSse('converted-after-empty');
    vi.mocked(httpRawStreamRequest)
      .mockImplementationOnce(async (_url, requestConfig = {}) => {
        expect(
          requestConfig.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })
        ).toBe(true);
        return { status: 200, headers: upstreamHeaders, body: Buffer.alloc(0) };
      })
      .mockImplementationOnce(async (_url, requestConfig = {}) => {
        expect(
          requestConfig.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })
        ).toBe(true);
        await requestConfig.onChunk?.(completedStream);
        return { status: 200, headers: upstreamHeaders, body: Buffer.alloc(0) };
      });
    const request = createJsonRequest(
      source.path,
      { ...source.routeHeaders, 'content-type': 'application/json' },
      { ...source.requestBody, stream: true }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawStreamRequest).toHaveBeenCalledTimes(2);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('converted-after-empty');
    expect(response.body).toContain('event: message_stop');
    expect(recordRoutePathOutcome).not.toHaveBeenCalledWith(
      expect.anything(),
      'failure',
      expect.objectContaining({ error: 'protocol_sse_transform:missing_terminal_event' }),
      expect.anything()
    );
  });

  it('records a transformed upstream error without appending a second error frame', async () => {
    vi.clearAllMocks();
    const source = protocolCases['anthropic-messages'];
    setupOpenCodeRoute({
      detectedCliType: source.detectedCliType,
      channelTargetProtocol: 'openai-responses',
    });
    const upstreamHeaders = { 'content-type': 'text/event-stream' };
    const failedStream = Buffer.from(
      [
        'event: response.failed',
        'data: {"type":"response.failed","response":{"error":{"type":"server_error","message":"capacity unavailable"}}}',
        '',
        '',
      ].join('\n'),
      'utf8'
    );
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, requestConfig = {}) => {
      expect(
        requestConfig.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })
      ).toBe(true);
      await requestConfig.onChunk?.(failedStream);
      return { status: 200, headers: upstreamHeaders, body: Buffer.alloc(0) };
    });
    const request = createJsonRequest(
      source.path,
      { ...source.routeHeaders, 'content-type': 'application/json' },
      { ...source.requestBody, stream: true }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.match(/event: error/g)).toHaveLength(1);
    expect(response.body).toContain('capacity unavailable');
    expect(response.body).not.toContain('message_stop');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-opencode' }),
      'failure',
      expect.objectContaining({ error: 'upstream_streaming_error:api_error' }),
      expect.any(Object)
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        error: 'upstream_streaming_error:api_error',
      })
    );
  });

  it('preserves Anthropic CRLF bytes when a UTF-8 code point is split across chunks', async () => {
    vi.clearAllMocks();
    const source = protocolCases['anthropic-messages'];
    setupOpenCodeRoute({
      detectedCliType: source.detectedCliType,
      channelTargetProtocol: 'anthropic-messages',
    });
    Object.assign(unifiedConfigManager, {
      getSiteById: vi.fn(() => ({ id: 'site-opencode', name: 'AnyRouter' })),
    });
    const streamBody = Buffer.from(
      buildClaudeTextSse('跨块字符').toString('utf8').replace(/\n/g, '\r\n'),
      'utf8'
    );
    const splitOffset = streamBody.indexOf(Buffer.from('跨', 'utf8')) + 1;
    expect(splitOffset).toBeGreaterThan(0);
    const upstreamHeaders = { 'content-type': 'text/event-stream' };
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, requestConfig = {}) => {
      expect(
        requestConfig.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })
      ).toBe(true);
      await requestConfig.onChunk?.(streamBody.subarray(0, splitOffset));
      await requestConfig.onChunk?.(streamBody.subarray(splitOffset));
      return { status: 200, headers: upstreamHeaders, body: Buffer.alloc(0) };
    });
    const request = createJsonRequest(
      source.path,
      { ...source.routeHeaders, 'content-type': 'application/json' },
      { ...source.requestBody, stream: true }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(streamBody.toString('utf8'));
    expect(response.body).not.toContain('\ufffd');
  });

  it('keeps an Anthropic EOF tail incomplete instead of synthesizing a frame delimiter', async () => {
    vi.clearAllMocks();
    const source = protocolCases['anthropic-messages'];
    setupOpenCodeRoute({
      detectedCliType: source.detectedCliType,
      channelTargetProtocol: 'anthropic-messages',
    });
    Object.assign(unifiedConfigManager, {
      getSiteById: vi.fn(() => ({ id: 'site-opencode', name: 'AnyRouter' })),
    });
    const incompleteTail = Buffer.from(
      'event: message_start\r\ndata: {"type":"message_start","message":{"content":[]}}',
      'utf8'
    );
    const upstreamHeaders = { 'content-type': 'text/event-stream' };
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, requestConfig = {}) => {
      expect(
        requestConfig.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })
      ).toBe(true);
      await requestConfig.onChunk?.(incompleteTail);
      return { status: 200, headers: upstreamHeaders, body: Buffer.alloc(0) };
    });
    const request = createJsonRequest(
      source.path,
      { ...source.routeHeaders, 'content-type': 'application/json' },
      { ...source.requestBody, stream: true }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawStreamRequest).toHaveBeenCalledTimes(1);
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-opencode' }),
      'failure',
      expect.objectContaining({ error: 'malformed_streaming_response:incomplete_sse_frame' }),
      expect.any(Object)
    );
  });

  it('does not let Anthropic compatibility normalization mask invalid UTF-8', async () => {
    vi.clearAllMocks();
    const source = protocolCases['anthropic-messages'];
    setupOpenCodeRoute({
      detectedCliType: source.detectedCliType,
      channelTargetProtocol: 'anthropic-messages',
    });
    Object.assign(unifiedConfigManager, {
      getSiteById: vi.fn(() => ({ id: 'site-opencode', name: 'AnyRouter' })),
    });
    const validPrefix = buildCompletedAnthropicToolPrefix();
    const invalidTerminal = Buffer.concat([
      Buffer.from(
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"vendor":"',
        'utf8'
      ),
      Buffer.from([0xff]),
      Buffer.from('"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n', 'utf8'),
    ]);
    const upstreamHeaders = { 'content-type': 'text/event-stream' };
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, requestConfig = {}) => {
      expect(
        requestConfig.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })
      ).toBe(true);
      await requestConfig.onChunk?.(Buffer.concat([validPrefix, invalidTerminal]));
      return { status: 200, headers: upstreamHeaders, body: Buffer.alloc(0) };
    });
    const request = createJsonRequest(
      source.path,
      { ...source.routeHeaders, 'content-type': 'application/json' },
      { ...source.requestBody, stream: true }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.write).not.toHaveBeenCalled();
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-opencode' }),
      'failure',
      expect.objectContaining({ error: 'malformed_streaming_response:invalid_utf8' }),
      expect.any(Object)
    );
  });

  it('enforces the raw frame limit before Anthropic compatibility normalization', async () => {
    vi.clearAllMocks();
    const source = protocolCases['anthropic-messages'];
    setupOpenCodeRoute({
      detectedCliType: source.detectedCliType,
      channelTargetProtocol: 'anthropic-messages',
    });
    Object.assign(unifiedConfigManager, {
      getSiteById: vi.fn(() => ({ id: 'site-opencode', name: 'AnyRouter' })),
    });
    const framePrefix = Buffer.from('event: message_delta\ndata: {"type":"message_delta",', 'utf8');
    const frameSuffix = Buffer.from(
      '"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
      'utf8'
    );
    const paddingBytes =
      STREAMING_VALIDATION_MAX_SSE_FRAME_BYTES + 1 - framePrefix.length - frameSuffix.length;
    const oversizedTerminal = Buffer.concat([
      framePrefix,
      Buffer.alloc(paddingBytes, 0x20),
      frameSuffix,
      Buffer.from('\n\n', 'utf8'),
    ]);
    expect(oversizedTerminal.length - 2).toBe(STREAMING_VALIDATION_MAX_SSE_FRAME_BYTES + 1);
    const upstreamHeaders = { 'content-type': 'text/event-stream' };
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, requestConfig = {}) => {
      expect(
        requestConfig.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })
      ).toBe(true);
      await requestConfig.onChunk?.(
        Buffer.concat([buildCompletedAnthropicToolPrefix(), oversizedTerminal])
      );
      return { status: 200, headers: upstreamHeaders, body: Buffer.alloc(0) };
    });
    const request = createJsonRequest(
      source.path,
      { ...source.routeHeaders, 'content-type': 'application/json' },
      { ...source.requestBody, stream: true }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(response.write).not.toHaveBeenCalled();
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-opencode' }),
      'failure',
      expect.objectContaining({ error: 'malformed_streaming_response:sse_frame_too_large' }),
      expect.any(Object)
    );
  });

  it('forwards CR-only SSE through strict same-protocol validation', async () => {
    vi.clearAllMocks();
    const source = protocolCases['openai-responses'];
    setupOpenCodeRoute({
      detectedCliType: source.detectedCliType,
      channelTargetProtocol: 'openai-responses',
    });
    Object.assign(unifiedConfigManager, {
      getSiteById: vi.fn(() => ({ id: 'site-opencode', name: 'AnyRouter' })),
      getAccountById: vi.fn(() => ({
        id: 'account-opencode',
        account_name: 'OpenCode Account',
        anyRouterConfig: { userHash: 'a'.repeat(64) },
      })),
    });
    const streamBody = Buffer.from(
      buildResponsesTextSse('cr-only-stream').toString('utf8').replace(/\n/g, '\r'),
      'utf8'
    );
    const firstFrameEnd = streamBody.indexOf('\r\r') + 2;
    const upstreamHeaders = { 'content-type': 'text/event-stream' };
    const response = createMockResponse();
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, requestConfig = {}) => {
      expect(requestConfig.retainStreamedBody).toBe(false);
      expect(
        requestConfig.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })
      ).toBe(true);
      await requestConfig.onChunk?.(streamBody.subarray(0, firstFrameEnd));
      expect(response.body).toContain('cr-only-stream');
      await requestConfig.onChunk?.(streamBody.subarray(firstFrameEnd));
      return { status: 200, headers: upstreamHeaders, body: Buffer.alloc(0) };
    });
    const request = createJsonRequest(
      source.path,
      {
        ...source.routeHeaders,
        'content-type': 'application/json',
        'x-api-detect-cli': 'openCode',
      },
      { ...source.requestBody, stream: true }
    );

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(streamBody.toString('utf8'));
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success', statusCode: 200 })
    );
  });

  it('converts a fragmented 128K-token-class Responses frame without retaining the raw body', async () => {
    vi.clearAllMocks();
    const source = protocolCases['openai-chat-completions'];
    setupOpenCodeRoute({
      detectedCliType: source.detectedCliType,
      channelTargetProtocol: 'openai-responses',
    });
    const output = ' token'.repeat(128 * 1024);
    const streamBody = Buffer.from(
      [
        `event: response.output_text.delta\ndata: ${JSON.stringify({
          type: 'response.output_text.delta',
          delta: output,
        })}\n\n`,
        `event: response.completed\ndata: ${JSON.stringify({
          type: 'response.completed',
          response: {
            usage: { input_tokens: 1, output_tokens: 128 * 1024, total_tokens: 128 * 1024 + 1 },
          },
        })}\n\n`,
      ].join(''),
      'utf8'
    );
    const upstreamHeaders = { 'content-type': 'text/event-stream' };
    const response = createMockResponse();
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, requestConfig = {}) => {
      expect(requestConfig.retainStreamedBody).toBe(false);
      expect(
        requestConfig.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })
      ).toBe(true);
      for (let offset = 0; offset < streamBody.length; offset += 1024) {
        await requestConfig.onChunk?.(streamBody.subarray(offset, offset + 1024));
      }
      expect(requestConfig.shouldResolveOnAbort?.()).toBe(true);
      return { status: 200, headers: upstreamHeaders, body: Buffer.alloc(0) };
    });
    const request = createJsonRequest(
      source.path,
      {
        ...source.routeHeaders,
        'content-type': 'application/json',
        'x-api-detect-cli': 'openCode',
      },
      { ...source.requestBody, stream: true }
    );

    await handleRequest(request, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(output);
    expect(response.body).toContain('data: [DONE]');
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success', completionTokens: 128 * 1024 })
    );
  });

  it.each([
    {
      sourceProtocol: 'anthropic-messages' as const,
      authScheme: 'bearer' as const,
      marker: 'grokBuild',
      expectedHeader: 'authorization',
      forbiddenHeader: 'x-api-key',
      expectedValue: 'Bearer sk-upstream',
    },
    {
      sourceProtocol: 'openai-responses' as const,
      authScheme: 'x-api-key' as const,
      marker: 'openCode',
      expectedHeader: 'x-api-key',
      forbiddenHeader: 'authorization',
      expectedValue: 'sk-upstream',
    },
  ])(
    'uses channel $authScheme auth for $sourceProtocol regardless of client marker',
    async ({
      sourceProtocol,
      authScheme,
      marker,
      expectedHeader,
      forbiddenHeader,
      expectedValue,
    }) => {
      vi.clearAllMocks();
      const source = protocolCases[sourceProtocol];
      setupOpenCodeRoute({
        detectedCliType: source.detectedCliType,
        channelTargetProtocol: 'native',
      });
      vi.mocked(resolveChannelCredentials).mockResolvedValue({
        baseUrl: 'https://opencode-upstream.example.com',
        apiKey: 'sk-upstream',
        authScheme,
      });
      vi.mocked(httpRawRequest).mockResolvedValue({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify(source.responseBody)),
      });
      const request = createJsonRequest(
        source.path,
        {
          ...source.routeHeaders,
          'content-type': 'application/json',
          'x-api-detect-cli': marker,
        },
        source.requestBody
      );

      await handleRequest(request, createMockResponse());

      const headers = vi.mocked(httpRawRequest).mock.calls[0]?.[1]?.headers;
      expect(headers).toMatchObject({ [expectedHeader]: expectedValue });
      expect(headers).not.toHaveProperty(forbiddenHeader);
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
        include: ['reasoning.encrypted_content'],
      }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(resolveChannels).toHaveBeenCalledWith(rule, 'wire-opencode');
    expect(httpRawRequest).toHaveBeenCalledTimes(1);
    expect(httpRawRequest).toHaveBeenCalledWith(
      'https://opencode-upstream.example.com/v1/responses',
      expect.anything()
    );
    expect(JSON.parse(response.body)).toMatchObject({ object: 'response' });
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'neutral',
        error: 'adapter_request-adapt:unsupported_field:request.include',
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
        include: ['reasoning.encrypted_content'],
      }
    );
    const response = createMockResponse();

    await handleRequest(request, response);

    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error: 'no_compatible_route_channel',
      reasons: ['unsupported_field:request.include'],
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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

  it('absorbs an unrelated 403 into a retryable response instead of terminating the client', async () => {
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

    expect(response.statusCode).toBe(503);
    expect(response.headers['X-Route-Proxy-Failure-Class']).toBe('channel_fatal');
    expect(response.headers['X-Route-Proxy-Upstream-Status']).toBe('403');
    expect(JSON.parse(response.body).error.message).toContain('API key is forbidden');
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: 'key-quota',
        outcome: 'failure',
        error: 'permission_error: API key is forbidden',
      })
    );
  });
});

describe('route-proxy-service upstream failure classification', () => {
  const rule = {
    id: 'rule-codex-failure-class',
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
    resolvedModel: 'model-a',
  };
  const channelB = {
    ...channelA,
    siteId: 'site-b',
    accountId: 'account-b',
    apiKeyId: 'key-b',
    resolvedModel: 'model-b',
  };

  function setupFailureClassRoute(
    channels: Array<typeof channelA>,
    maxAttemptsPerRoutePath = 1
  ): void {
    const now = Date.now();
    const routing = {
      clientRouting: { 'profile-test': { mode: 'client' as const } },
      server: { unifiedApiKey: 'sk-route', requestTimeoutMs: 1000, upstreamProxyUrl: '' },
      rules: [rule],
      cliModelSelections: { claudeCode: null, codex: null },
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
            id: 'display-failure-class',
            canonicalName: 'gpt-4.1-mini',
            mode: 'manual' as const,
            sourceKeys: [],
            originalModelOrder: [],
            runtimeConfig: {
              maxAttemptsPerRoutePath,
              successRateWindowMinutes: 5,
              disableDurationMinutes: 30,
              minSuccessRate: 0.8,
            },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
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
      windowRequestCount: outcome === 'neutral' ? 0 : 1,
      windowSuccessCount: outcome === 'success' ? 1 : 0,
      successRate: outcome === 'success' ? 1 : 0,
      lastOutcome: outcome,
      updatedAt: now,
    }));
  }

  const createRequest = () =>
    createJsonRequest(
      '/v1/responses',
      { authorization: 'Bearer sk-route', 'content-type': 'application/json' },
      { model: 'gpt-4.1-mini', input: 'hi' }
    );

  const jsonBody = (payload: unknown) => Buffer.from(JSON.stringify(payload));

  const pathOutcomeFor = (apiKeyId: string) =>
    vi
      .mocked(recordRoutePathOutcome)
      .mock.calls.filter(([channel]) => (channel as { apiKeyId: string }).apiKeyId === apiKeyId)
      .map(call => call[1]);

  it('records a request-side rejection as neutral while still trying the next channel', async () => {
    vi.clearAllMocks();
    setupFailureClassRoute([channelA, channelB]);
    vi.mocked(httpRawRequest)
      .mockResolvedValueOnce({
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: jsonBody({ error: { message: 'context length exceeded' } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: jsonBody({ ok: true }),
      });
    const response = createMockResponse();

    await handleRequest(createRequest(), response);

    expect(httpRawRequest).toHaveBeenCalledTimes(2);
    expect(response.statusCode).toBe(200);
    expect(pathOutcomeFor('key-a')).toEqual(['neutral']);
    const failureLog = vi
      .mocked(recordRouteRequest)
      .mock.calls.find(([params]) => params.apiKeyId === 'key-a')?.[0];
    expect(failureLog).toEqual(expect.objectContaining({ outcome: 'failure', statusCode: 400 }));
  });

  it.each([
    [401, 'invalid api key'],
    [404, 'model not found'],
    [429, 'too many requests'],
    [500, 'internal error'],
  ])('keeps upstream %s counted as a route path failure', async (status, message) => {
    vi.clearAllMocks();
    setupFailureClassRoute([channelA, channelB]);
    vi.mocked(httpRawRequest)
      .mockResolvedValueOnce({
        status,
        headers: { 'content-type': 'application/json' },
        body: jsonBody({ error: { message } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: jsonBody({ ok: true }),
      });

    await handleRequest(createRequest(), createMockResponse());

    expect(pathOutcomeFor('key-a')).toEqual(['failure']);
  });

  it('leaves every route path health-neutral when all candidates reject the same payload', async () => {
    vi.clearAllMocks();
    setupFailureClassRoute([channelA, channelB]);
    const rejection = jsonBody({ error: { message: 'unsupported tool schema' } });
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 422,
      headers: { 'content-type': 'application/json' },
      body: rejection,
    });
    const response = createMockResponse();

    await handleRequest(createRequest(), response);

    expect(pathOutcomeFor('key-a')).toEqual(['neutral']);
    expect(pathOutcomeFor('key-b')).toEqual(['neutral']);
    // 全体候选一致判为 request_fatal：重试不可能成功，且 neutral 永不累积到禁用，
    // 因此必须透传 4xx 让客户端停止，而不是吸收成可重试 503。
    expect(response.statusCode).toBe(422);
    expect(response.body).toBe(rejection.toString('utf8'));
    expect(response.headers['X-Route-Proxy-Failure-Class']).toBe('request_fatal');
    expect(response.headers['X-Route-Proxy-Attempts']).toBe('2');
  });

  it('absorbs a transport failure into a retryable response carrying the real cause', async () => {
    vi.clearAllMocks();
    setupFailureClassRoute([channelA]);
    vi.mocked(httpRawRequest).mockRejectedValueOnce(new Error('ETIMEDOUT connecting to upstream'));
    const response = createMockResponse();

    await handleRequest(createRequest(), response);

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).error).toEqual(
      expect.objectContaining({ code: 'upstream_temporarily_unavailable' })
    );
    expect(JSON.parse(response.body).error.message).toContain('ETIMEDOUT connecting to upstream');
    expect(response.headers['X-Route-Proxy-Attempts']).toBe('1');
    expect(response.headers['X-Route-Proxy-Failure-Class']).toBe('transient');
  });

  it('does not let a single request-side rejection terminate the client when another channel failed differently', async () => {
    vi.clearAllMocks();
    setupFailureClassRoute([channelA, channelB]);
    vi.mocked(httpRawRequest)
      .mockResolvedValueOnce({
        status: 503,
        headers: { 'content-type': 'application/json' },
        body: jsonBody({ error: { message: 'gateway busy' } }),
      })
      .mockResolvedValueOnce({
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: jsonBody({ error: { message: 'image input is not supported' } }),
      });
    const response = createMockResponse();

    await handleRequest(createRequest(), response);

    // 只有当所有尝试过的候选一致判为 request_fatal 时才终止；此处存在 transient，必须可重试。
    expect(response.statusCode).toBe(503);
    expect(response.headers['X-Route-Proxy-Failure-Class']).toBe('request_fatal');
  });

  it('never lets a quota-exhausted body reach the passthrough branch', async () => {
    vi.clearAllMocks();
    setupFailureClassRoute([channelA, channelB]);
    vi.mocked(httpRawRequest)
      .mockResolvedValueOnce({
        status: 403,
        headers: { 'content-type': 'application/json' },
        body: jsonBody({ error: { message: 'INSUFFICIENT_BALANCE: 余额不足' } }),
      })
      .mockRejectedValueOnce(new Error('ECONNRESET'));
    const response = createMockResponse();

    await handleRequest(createRequest(), response);

    expect(response.statusCode).toBe(503);
    expect(response.headers['X-Route-Proxy-Error']).toBe('upstream_temporarily_unavailable');
    expect(response.headers['X-Route-Proxy-Attempts']).toBeUndefined();
    expect(response.headers['X-Route-Proxy-Failure-Class']).toBeUndefined();
    expect(response.body).not.toMatch(/403|INSUFFICIENT|余额|ECONNRESET/i);
  });

  const pathOutcomeMetaFor = (apiKeyId: string) =>
    vi
      .mocked(recordRoutePathOutcome)
      .mock.calls.filter(([channel]) => (channel as { apiKeyId: string }).apiKeyId === apiKeyId)
      .map(call => call[2]);

  it.each([
    [401, 'upstream_credential_rejected'],
    [402, 'upstream_credential_rejected'],
    [403, 'upstream_credential_rejected'],
    [404, 'upstream_model_unavailable'],
    [405, 'upstream_model_unavailable'],
    [410, 'upstream_model_unavailable'],
  ])('confirms upstream %s as an immediate route path disable', async (status, reason) => {
    vi.clearAllMocks();
    setupFailureClassRoute([channelA, channelB]);
    vi.mocked(httpRawRequest)
      .mockResolvedValueOnce({
        status,
        headers: { 'content-type': 'application/json' },
        body: jsonBody({ error: { message: 'rejected' } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: jsonBody({ ok: true }),
      });

    await handleRequest(createRequest(), createMockResponse());

    expect(pathOutcomeMetaFor('key-a')).toEqual([
      expect.objectContaining({ confirmedUnavailable: reason }),
    ]);
  });

  it('persists quota exhaustion as a confirmed disable instead of only skipping in-request', async () => {
    vi.clearAllMocks();
    setupFailureClassRoute([channelA, channelB]);
    vi.mocked(httpRawRequest)
      .mockResolvedValueOnce({
        status: 403,
        headers: { 'content-type': 'application/json' },
        body: jsonBody({ error: { message: 'INSUFFICIENT_BALANCE: 余额不足' } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: jsonBody({ ok: true }),
      });

    await handleRequest(createRequest(), createMockResponse());

    expect(pathOutcomeMetaFor('key-a')).toEqual([
      expect.objectContaining({ confirmedUnavailable: 'upstream_quota_exhausted' }),
    ]);
  });

  it.each([
    [400, 'request-side rejection'],
    [422, 'request-side rejection'],
    [500, 'transient failure'],
    [429, 'transient failure'],
  ])('never confirms a disable for upstream %s (%s)', async status => {
    vi.clearAllMocks();
    setupFailureClassRoute([channelA, channelB]);
    vi.mocked(httpRawRequest).mockResolvedValue({
      status,
      headers: { 'content-type': 'application/json' },
      body: jsonBody({ error: { message: 'boom' } }),
    });

    await handleRequest(createRequest(), createMockResponse());

    for (const meta of pathOutcomeMetaFor('key-a')) {
      expect(meta).not.toHaveProperty('confirmedUnavailable');
    }
  });

  it('stops the client only once every route path is disabled', async () => {
    vi.clearAllMocks();
    setupFailureClassRoute([channelA, channelB]);
    vi.mocked(httpRawRequest).mockResolvedValue({
      status: 500,
      headers: { 'content-type': 'application/json' },
      body: jsonBody({ error: { message: 'internal error' } }),
    });
    // 两个通道在本次请求内先后被健康度规则挂起。
    const disabled = new Set<string>();
    vi.mocked(recordRoutePathOutcome).mockImplementation(async (channel, outcome) => {
      disabled.add((channel as { apiKeyId: string }).apiKeyId);
      return {
        ...channel,
        windowStartedAt: Date.now(),
        windowRequestCount: 1,
        windowSuccessCount: 0,
        successRate: 0,
        lastOutcome: outcome,
        disabledUntil: Date.now() + 60_000,
        updatedAt: Date.now(),
      } as never;
    });
    vi.mocked(isRoutePathDisabled).mockImplementation(
      channel => disabled.has((channel as { apiKeyId: string }).apiKeyId) && disabled.size >= 2
    );
    vi.mocked(getRoutePathDisabledUntil).mockImplementation(() => Date.now() + 12_000);
    const response = createMockResponse();

    await handleRequest(createRequest(), response);

    expect(response.statusCode).toBe(503);
    expect(response.headers['X-Route-Proxy-Error']).toBe('all_route_paths_disabled');
    expect(Number(response.headers['Retry-After'])).toBeGreaterThanOrEqual(11);
    expect(Number(response.headers['Retry-After'])).toBeLessThanOrEqual(12);
    // 终结原因进入主日志诊断行，attemptCount 保留真实上游尝试数
    expect(getRouteDiagnostics('Route request completed').at(-1)).toMatchObject({
      statusCode: 503,
      error: 'all_route_paths_disabled',
    });
  });

  it('honors a short Retry-After before replanning the same route path', async () => {
    vi.clearAllMocks();
    setupFailureClassRoute([channelA, { ...channelA }], 2);
    vi.mocked(httpRawRequest)
      .mockResolvedValueOnce({
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': new Date(Date.now() + 150).toISOString(),
        },
        body: jsonBody({ error: { message: 'slow down' } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: jsonBody({ ok: true }),
      });
    const startedAt = Date.now();
    const response = createMockResponse();

    await handleRequest(createRequest(), response);

    expect(httpRawRequest).toHaveBeenCalledTimes(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
    expect(response.statusCode).toBe(200);
  });

  it('skips a replanned attempt when Retry-After exceeds the wait ceiling', async () => {
    vi.clearAllMocks();
    setupFailureClassRoute([channelA, { ...channelA }], 2);
    vi.mocked(httpRawRequest).mockResolvedValueOnce({
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '30' },
      body: jsonBody({ error: { message: 'slow down' } }),
    });
    const response = createMockResponse();

    await handleRequest(createRequest(), response);

    expect(httpRawRequest).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(503);
    expect(response.headers['X-Route-Proxy-Upstream-Status']).toBe('429');
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
      targetProtocol: 'openai-responses' as const,
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
    expectSingleRequestDiagnostics({ statusCode: 200, attemptCount: 2, termination: 'completed' });
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
          type: 'overloaded_error',
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
          type: 'server_error',
          message: expect.stringContaining('temporarily disabled'),
        },
      },
    },
  ];

  disabledResponseCases.forEach(testCase => {
    it(`returns a retryable ${testCase.cliType} error when all planned paths are disabled`, async () => {
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
        clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      expect(response.statusCode).toBe(503);
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
    'does not give Grok Build a client-specific credential precedence on %s',
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

      expect(token).toBe('ignored-bearer');
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

describe('route-proxy-service target lock', () => {
  it('allows loopback target-lock requests to bypass disabled route paths and analytics side effects', async () => {
    vi.clearAllMocks();

    const routing = {
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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

  it('allows concurrent target-lock upstream attempts up to the cap before any terminal result settles', async () => {
    vi.clearAllMocks();

    const routing = {
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      expect(cappedResponse.body).toContain('target_lock_upstream_attempt_exhausted');

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

  it('does not spend the target-lock upstream attempt on Claude count_tokens requests', async () => {
    vi.clearAllMocks();

    const routing = {
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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

    expect(countTokensResponse.statusCode).toBe(501);
    expect(JSON.parse(countTokensResponse.body)).toMatchObject({
      error: { type: 'not_supported_error' },
      reason: 'target_lock_has_no_exact_tokenizer',
    });
    expect(httpRawRequest).not.toHaveBeenCalled();
    expect(httpRawStreamRequest).toHaveBeenCalledTimes(1);
    expect(mainResponse.statusCode).toBe(200);
  });

  it('passes a transient target-lock upstream failure through without settling or terminal-failure', async () => {
    vi.clearAllMocks();

    const routing = {
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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

  it('passes a non-native targetProtocol transient target-lock failure through raw without transform escalation', async () => {
    vi.clearAllMocks();

    const routing = {
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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

  it('treats a terminal target-lock upstream failure (401) as an immediate terminal failure', async () => {
    vi.clearAllMocks();

    const routing = {
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
    // 终结失败已缓存：后续 target-lock 请求重放缓存的终结状态/响应体，不再访问上游。
    expect(retryResponse.statusCode).toBe(401);
    expect(retryResponse.body).toBe(terminalError);
    expect(httpRawStreamRequest).toHaveBeenCalledTimes(1);
  });

  it('settles the target-lock budget on the first success and blocks later upstream attempts', async () => {
    vi.clearAllMocks();

    const routing = {
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
    expect(secondResponse.body).toContain('target_lock_upstream_attempt_exhausted');
    expect(httpRawRequest).toHaveBeenCalledTimes(1);
  });

  it('escalates repeated transient target-lock failures to terminal at the attempt cap', async () => {
    vi.clearAllMocks();

    const routing = {
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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

  it('rejects non-loopback target-lock requests', async () => {
    vi.clearAllMocks();

    Object.assign(unifiedConfigManager, {
      getRoutingConfig: vi.fn(() => ({
        clientRouting: { 'profile-test': { mode: 'client' } },
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
      error: 'target_lock_forbidden',
    });
  });
});

describe('route-proxy-service SSE streaming passthrough', () => {
  function setupStreamingRoute(
    cliType: 'claudeCode' | 'codex' | 'openCode' | 'grokBuild',
    model: string
  ) {
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
      targetProtocol: 'native' as const,
    };
    const routing = {
      clientRouting: { 'profile-test': { mode: 'client' as const } },
      server: {
        unifiedApiKey: 'sk-route',
        requestTimeoutMs: 1000,
        upstreamProxyUrl: '',
      },
      rules: [rule],
      cliModelSelections: {
        claudeCode: null,
        codex: null,
        openCode: null,
        grokBuild: null,
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
    expectSingleRequestDiagnostics({ statusCode: 200, attemptCount: 2, termination: 'completed' });
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

  it.each([
    { cliType: 'claudeCode', path: '/v1/messages', protocol: 'anthropic' },
    { cliType: 'codex', path: '/v1/responses', protocol: 'openaiResponses' },
    { cliType: 'openCode', path: '/v1/messages', protocol: 'anthropic' },
    { cliType: 'openCode', path: '/v1/responses', protocol: 'openaiResponses' },
    { cliType: 'openCode', path: '/v1/chat/completions', protocol: 'openaiChat' },
    { cliType: 'grokBuild', path: '/v1/messages', protocol: 'anthropic' },
    { cliType: 'grokBuild', path: '/v1/responses', protocol: 'openaiResponses' },
    { cliType: 'grokBuild', path: '/v1/chat/completions', protocol: 'openaiChat' },
  ] as const)(
    'emits a $protocol error when $cliType transport fails after stream commit',
    async ({ cliType, path, protocol }) => {
      vi.clearAllMocks();
      const model = protocol === 'anthropic' ? 'claude-opus-4-6' : 'gpt-5.6-sol';
      const channel = setupStreamingRoute(cliType, model);
      const partialChunk =
        protocol === 'anthropic'
          ? Buffer.from(
              [
                'event: message_start',
                'data: {"type":"message_start","message":{"id":"msg_partial","type":"message","role":"assistant","model":"claude-opus-4-6","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
                '',
                'event: content_block_start',
                'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
                '',
                'event: content_block_delta',
                // 超过原生 Anthropic 的提交字节阈值，确保这一路真的跨过提交窗口，
                // 否则命中的是提交前分支（丢弃缓冲换通道），验证不到提交后错误处理。
                `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial${'x'.repeat(64 * 1024)}"}}`,
                '',
                '',
              ].join('\n'),
              'utf-8'
            )
          : protocol === 'openaiResponses'
            ? Buffer.from(
                'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial","sequence_number":7}\n\n'
              )
            : Buffer.from(
                'data: {"id":"chatcmpl_partial","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n'
              );
      const upstreamHeaders = { 'content-type': 'text/event-stream' };

      vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
        expect(
          config.onResponse?.({ status: 200, statusText: 'OK', headers: upstreamHeaders })
        ).toBe(true);
        await config.onChunk?.(partialChunk);
        throw new Error('net::ERR_INCOMPLETE_CHUNKED_ENCODING');
      });

      const request = createJsonRequest(
        path,
        {
          authorization: 'Bearer sk-route',
          'x-api-key': 'sk-route',
          'content-type': 'application/json',
        },
        {
          model,
          stream: true,
          input: 'hi',
          messages: [{ role: 'user', content: 'hi' }],
        }
      );
      const response = createMockResponse();

      await handleRequest(request, response);

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('partial');
      expect(response.body).not.toContain('[DONE]');
      const errorDataLine = response.body
        .split(/\r?\n/)
        .find(line => line.startsWith('data: ') && line.includes('upstream_stream_error'));

      if (protocol === 'anthropic') {
        expect(response.body.match(/event: error/g)).toHaveLength(1);
        const anthropicErrorLine = response.body
          .split(/\r?\n/)
          .find(line => line.startsWith('data: ') && line.includes('"type":"api_error"'));
        expect(JSON.parse(anthropicErrorLine!.slice('data: '.length))).toMatchObject({
          type: 'error',
          error: { type: 'api_error' },
        });
      } else if (protocol === 'openaiResponses') {
        expect(response.body.match(/event: error/g)).toHaveLength(1);
        expect(JSON.parse(errorDataLine!.slice('data: '.length))).toMatchObject({
          type: 'error',
          code: 'upstream_stream_error',
          param: null,
          sequence_number: 8,
        });
      } else {
        expect(response.body).not.toContain('event: error');
        expect(response.body.match(/"code":"upstream_stream_error"/g)).toHaveLength(1);
        expect(JSON.parse(errorDataLine!.slice('data: '.length))).toMatchObject({
          error: {
            type: 'server_error',
            code: 'upstream_stream_error',
            param: null,
          },
        });
      }

      expect(httpRawStreamRequest).toHaveBeenCalledTimes(1);
      expect(recordRoutePathOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ apiKeyId: channel.apiKeyId }),
        'failure',
        expect.objectContaining({ error: 'net::ERR_INCOMPLETE_CHUNKED_ENCODING' }),
        expect.any(Object)
      );
      expect(recordRouteRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          cliType,
          apiKeyId: channel.apiKeyId,
          outcome: 'failure',
        })
      );
    }
  );

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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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

  it('emits a Responses error when a native stream ends without a terminal event', async () => {
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial","sequence_number":4}\n\n'
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
    expect(response.body).toContain('"code":"upstream_stream_error"');
    expect(response.body).toContain('"sequence_number":5');
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-openai' }),
      'failure',
      expect.objectContaining({ error: 'incomplete_streaming_response:missing_terminal_event' }),
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      output_config: { effort: 'low', format: 'text' },
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
        // message_start 撑过原生 Anthropic 提交字节阈值，使畸形帧落在提交后分支；
        // 不用额外的 delta 帧填充，避免与「畸形帧后不得转发内容」的断言互相干扰。
        'event: message_start',
        `data: {"type":"message_start","message":{"id":"msg_bad${'x'.repeat(64 * 1024)}","type":"message","role":"assistant","model":"claude-opus-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}`,
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
    expect(response.body.match(/event: error/g)).toHaveLength(1);
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

  const NATIVE_CLAUDE_MESSAGE_START = [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"msg_win","type":"message","role":"assistant","model":"claude-opus-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
    '',
  ];
  const NATIVE_CLAUDE_OPEN_BLOCK = [
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    '',
  ];
  const NATIVE_CLAUDE_TERMINAL = [
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
    '',
  ];

  function buildNativeClaudeRequest(): ReturnType<typeof createJsonRequest> {
    return createJsonRequest(
      '/v1/messages?beta=true',
      { 'x-api-key': 'sk-route', 'content-type': 'application/json' },
      { model: 'claude-opus-4-6', stream: true, messages: [{ role: 'user', content: 'hi' }] }
    );
  }

  it('discards the buffered native Claude stream and fails over when it truncates before commit', async () => {
    vi.clearAllMocks();
    const channel = setupStreamingRoute('claudeCode', 'claude-opus-4-6');
    vi.mocked(resolveChannels).mockReturnValue([
      channel,
      { ...channel, siteId: 'site-backup', apiKeyId: 'key-backup' },
    ]);

    const truncated = Buffer.from(
      [...NATIVE_CLAUDE_MESSAGE_START, ...NATIVE_CLAUDE_OPEN_BLOCK, ''].join('\n'),
      'utf-8'
    );
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      expect(
        config.onResponse?.({
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/event-stream' },
        })
      ).toBe(true);
      await config.onChunk?.(truncated);
      return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: truncated };
    });

    const response = createMockResponse();
    await handleRequest(buildNativeClaudeRequest(), response);

    // 提交前截断：客户端不该收到任何上游字节，路由必须换下一个候选。
    expect(response.body).not.toContain('event: message_start');
    expect(response.body).not.toContain('event: content_block_start');
    expect(vi.mocked(httpRawStreamRequest).mock.calls.length).toBeGreaterThan(1);
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.anything(),
      'failure',
      expect.objectContaining({
        error: expect.stringContaining('incomplete_streaming_response:missing_terminal_event'),
      }),
      expect.any(Object)
    );
  });

  it('commits a stalled native Claude stream once the delay window elapses', async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      setupStreamingRoute('claudeCode', 'claude-opus-4-6');

      const opening = Buffer.from(
        [...NATIVE_CLAUDE_MESSAGE_START, ...NATIVE_CLAUDE_OPEN_BLOCK, ''].join('\n'),
        'utf-8'
      );
      const terminal = Buffer.from(NATIVE_CLAUDE_TERMINAL.join('\n'), 'utf-8');
      const response = createMockResponse();
      let bodyBeforeDeadline = '';
      let bodyAfterDeadline = '';

      vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
        expect(
          config.onResponse?.({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/event-stream' },
          })
        ).toBe(true);
        await config.onChunk?.(opening);
        // 远不到 64KB，也没有终止事件：只有定时器能推动提交。
        bodyBeforeDeadline = response.body;
        await vi.advanceTimersByTimeAsync(3_050);
        bodyAfterDeadline = response.body;
        await config.onChunk?.(terminal);
        return {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: Buffer.concat([opening, terminal]),
        };
      });

      await handleRequest(buildNativeClaudeRequest(), response);

      expect(bodyBeforeDeadline).toBe('');
      expect(bodyAfterDeadline).toContain('event: message_start');
      expect(bodyAfterDeadline).toContain('event: content_block_stop');
      // 定时器提交后继续到达的字节必须顺序追加，不重复也不交错。
      expect(response.body).toBe(opening.toString('utf-8') + terminal.toString('utf-8'));
      expect(response.body).not.toContain('event: error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits a complete native Claude stream inside the window and records success', async () => {
    vi.clearAllMocks();
    setupStreamingRoute('claudeCode', 'claude-opus-4-6');

    const complete = Buffer.from(
      [...NATIVE_CLAUDE_MESSAGE_START, ...NATIVE_CLAUDE_OPEN_BLOCK, ...NATIVE_CLAUDE_TERMINAL].join(
        '\n'
      ),
      'utf-8'
    );
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      expect(
        config.onResponse?.({
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/event-stream' },
        })
      ).toBe(true);
      await config.onChunk?.(complete);
      return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: complete };
    });

    const response = createMockResponse();
    await handleRequest(buildNativeClaudeRequest(), response);

    // 窗口没到期也要提交：终止事件本身就是提交信号。
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(complete.toString('utf-8'));
    expect(response.body).not.toContain('event: error');
    expect(vi.mocked(httpRawStreamRequest)).toHaveBeenCalledTimes(1);
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.anything(),
      'success',
      expect.anything(),
      expect.any(Object)
    );
  });

  it('appends a retryable error when a committed native Claude stream loses its terminal event', async () => {
    vi.clearAllMocks();
    setupStreamingRoute('claudeCode', 'claude-opus-4-6');

    // 撑过提交阈值，让截断落在提交后分支。
    const committedThenTruncated = Buffer.from(
      [
        'event: message_start',
        `data: {"type":"message_start","message":{"id":"msg_big${'x'.repeat(64 * 1024)}","type":"message","role":"assistant","model":"claude-opus-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}`,
        '',
        ...NATIVE_CLAUDE_OPEN_BLOCK,
        '',
      ].join('\n'),
      'utf-8'
    );
    vi.mocked(httpRawStreamRequest).mockImplementation(async (_url, config = {}) => {
      expect(
        config.onResponse?.({
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/event-stream' },
        })
      ).toBe(true);
      await config.onChunk?.(committedThenTruncated);
      return {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: committedThenTruncated,
      };
    });

    const response = createMockResponse();
    await handleRequest(buildNativeClaudeRequest(), response);

    expect(response.statusCode).toBe(200);
    // 上游字节原样保留，错误事件只追加在流尾。
    expect(response.body.startsWith(committedThenTruncated.toString('utf-8'))).toBe(true);
    expect(response.body.match(/event: error/g)).toHaveLength(1);
    const errorLine = response.body
      .split(/\r?\n/)
      .find(line => line.startsWith('data: ') && line.includes('"type":"error"'));
    expect(JSON.parse(errorLine!.slice('data: '.length))).toMatchObject({
      type: 'error',
      error: { type: 'overloaded_error' },
    });
    // 提交后禁止切换上游。
    expect(vi.mocked(httpRawStreamRequest)).toHaveBeenCalledTimes(1);
    expect(recordRoutePathOutcome).toHaveBeenCalledWith(
      expect.anything(),
      'failure',
      expect.objectContaining({
        error: 'incomplete_streaming_response:missing_terminal_event',
      }),
      expect.any(Object)
    );
    expect(recordRouteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        error: 'incomplete_streaming_response:missing_terminal_event',
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
      clientRouting: { 'profile-test': { mode: 'client' as const } },
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
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('forwards Codex upstream auth as bearer token', () => {
    const headers = buildUpstreamHeaders(
      {
        authorization: 'Bearer sk-route-key',
        'content-type': 'application/json',
        'x-codex-window-id': 'window-1',
      },
      'duckcoding.ai',
      42,
      'sk-upstream-key',
      'codex'
    );

    expect(headers.authorization).toBe('Bearer sk-upstream-key');
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers['x-codex-window-id']).toBe('window-1');
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

  it('uses protocol-derived Anthropic x-api-key auth on SenseNova hosts without an override', () => {
    const headers = buildUpstreamHeaders(
      {
        authorization: 'Bearer sk-route-key',
        'content-type': 'application/json',
      },
      'token.sensenova.cn',
      42,
      'sk-upstream-key',
      'claudeCode'
    );

    expect(headers['x-api-key']).toBe('sk-upstream-key');
    expect(headers.authorization).toBeUndefined();
  });

  it('removes Anthropic protocol headers when forwarding to an OpenAI upstream', () => {
    const headers = buildUpstreamHeaders(
      {
        authorization: 'Bearer sk-route-key',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
      },
      'relay.example.com',
      42,
      'sk-upstream-key',
      'codex'
    );

    expect(headers.authorization).toBe('Bearer sk-upstream-key');
    expect(headers['anthropic-version']).toBeUndefined();
    expect(headers['anthropic-beta']).toBeUndefined();
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

  it('does not forward internal route identity and display headers upstream', () => {
    const headers = buildUpstreamHeaders(
      {
        authorization: 'Bearer sk-route-key',
        'x-api-detect-agent-id': 'codex-agent',
        'x-api-detect-runtime-slot-id': 'terminal-1',
        'x-api-detect-session-id': 'session-1',
        'x-api-detect-agent-name': 'Codex',
        'x-api-detect-runtime-slot-label': 'Terminal 1',
      },
      'relay.example.com',
      42,
      'sk-upstream-key',
      'codex'
    );

    expect(headers.authorization).toBe('Bearer sk-upstream-key');
    expect(Object.keys(headers).some(name => name.toLowerCase().startsWith('x-api-detect-'))).toBe(
      false
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

  it.each([
    [
      'ModelScope-style version prefix',
      'https://api-inference.modelscope.cn/v1',
      '/v1/chat/completions',
      'https://api-inference.modelscope.cn/v1/chat/completions',
    ],
    [
      'nested OpenAI compatibility prefix',
      'https://provider.example.com/api/openai',
      '/v1/responses',
      'https://provider.example.com/api/openai/v1/responses',
    ],
    [
      'DashScope-style compatibility prefix',
      'https://dashscope.example.com/compatible-mode/v1',
      '/v1/chat/completions?beta=true',
      'https://dashscope.example.com/compatible-mode/v1/chat/completions?beta=true',
    ],
  ])('preserves %s in upstream Base URLs', (_name, baseUrl, requestUrl, expected) => {
    expect(
      buildUpstreamRequestUrl(baseUrl, requestUrl, 'openCode', undefined, 'sk-upstream-key').url
    ).toBe(expected);
  });
});

describe('route-proxy-service request-fatal fingerprint', () => {
  it('keeps the same fingerprint when only message text grows across turns', () => {
    const tools = [
      { type: 'function', name: 'Read' },
      { type: 'function', name: 'Edit' },
    ];
    const base = {
      model: 'claude-opus-4-6',
      stream: true,
      max_tokens: 1024,
      tools,
      system: [{ type: 'text', text: 'You are a helpful assistant.' }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'turn 1' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read' }] },
      ],
    };
    const nextTurn = {
      ...base,
      max_tokens: 2048,
      messages: [
        ...base.messages,
        { role: 'user', content: [{ type: 'text', text: 'turn 2 with much longer body' }] },
      ],
    };
    // 体积桶按 2 的幂取整：同桶内的自然增长不应改变指纹
    const baseLength = JSON.stringify(base).length;
    const nextLength = JSON.stringify(nextTurn).length;
    expect(Math.floor(Math.log2(nextLength))).toBe(Math.floor(Math.log2(baseLength)));

    expect(buildRequestFatalFingerprint(nextTurn, nextLength)).toBe(
      buildRequestFatalFingerprint(base, baseLength)
    );
  });

  it('changes the fingerprint when the size bucket crosses a power of two', () => {
    const base = { model: 'claude-opus-4-6', messages: [{ role: 'user', content: 'hi' }] };

    expect(buildRequestFatalFingerprint(base, 100_000)).toBe(
      buildRequestFatalFingerprint(base, 131_000)
    );
    expect(buildRequestFatalFingerprint(base, 100_000)).not.toBe(
      buildRequestFatalFingerprint(base, 150_000)
    );
  });

  it('changes the fingerprint when structural features change', () => {
    const base = {
      model: 'claude-opus-4-6',
      tools: [{ type: 'function', name: 'Read' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    };

    expect(buildRequestFatalFingerprint({ ...base, thinking: { type: 'enabled' } })).not.toBe(
      buildRequestFatalFingerprint(base)
    );
    expect(
      buildRequestFatalFingerprint({
        ...base,
        messages: [{ role: 'user', content: [{ type: 'image', source: {} }] }],
      })
    ).not.toBe(buildRequestFatalFingerprint(base));
    expect(
      buildRequestFatalFingerprint({ ...base, tools: [{ type: 'function', name: 'Bash' }] })
    ).not.toBe(buildRequestFatalFingerprint(base));
  });

  it('returns an empty fingerprint for non-JSON-object bodies', () => {
    expect(buildRequestFatalFingerprint(null)).toBe('');
    expect(buildRequestFatalFingerprint('raw text')).toBe('');
    expect(buildRequestFatalFingerprint(undefined)).toBe('');
  });
});
