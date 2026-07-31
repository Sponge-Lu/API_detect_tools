/**
 * 路由代理服务器
 * 输入: CLI 请求 (HTTP), RoutingConfig, ModelRegistry
 * 输出: 透明转发到上游站点（含 model 重写 + metrics 采集）
 * 定位: 服务层 - 监听本地端口，canonical→raw 模型重写，Electron net raw 上游转发，透传+统计
 */

import * as http from 'http';
import { URL } from 'url';
import Logger from './utils/logger';
import { httpRawRequest, httpRawStreamRequest } from './utils/http-client';
import { unifiedConfigManager } from './unified-config-manager';
import {
  detectCliTypeFromPath,
  extractModelFromBody,
  extractModelFromPath,
  sortRules,
  findMatchingRule,
} from './route-rule-engine';
import {
  resolveChannels,
  resolveChannelCredentials,
  resolveChannelTarget,
} from './route-channel-resolver';
import type { ResolvedChannel } from './route-channel-resolver';
import {
  sortChannelsByScore,
  recordOutcome,
  isRoutePathDisabled,
  recordRoutePathOutcome,
  isRouteEndpointUnsupported,
  recordRouteEndpointUnsupported,
} from './route-stats-service';
import { startHealthCheckTimer, stopHealthCheckTimer } from './route-health-service';
import { recordRouteRequest } from './route-analytics-service';
import type {
  RouteChannelKey,
  RouteCliType,
  RouteModelRegistryConfig,
  RouteOutcome,
  RoutePathState,
  RouteRuntimeConfig,
  RouteThinkingEffort,
  RoutingConfig,
} from '../shared/types/route-proxy';
import {
  buildRouteApiKeyPriorityKey,
  buildRoutePathStateKey,
  normalizeRouteThinkingEffort,
  normalizeRouteRuntimeConfig,
  ROUTE_CLI_MARKER_HEADER,
  ROUTE_CLI_MARKER_VALUES,
  ROUTE_SUCCESSFUL_PATH_AFFINITY_MS,
} from '../shared/types/route-proxy';
import { isAnyRouterSite } from '../shared/types/site';
import {
  getCliTargetEndpoint,
  normalizeCliTargetProtocol,
  type CliTargetProtocol,
} from '../shared/types/cli-config';
import {
  rewriteForAnyRouter,
  transformAnyRouterResponse,
  type AnyRouterResponseAdapter,
} from './anyrouter-request-rewriter';
import {
  adaptRequestToTargetProtocol,
  transformTargetProtocolResponse,
  CliProtocolAdapterError,
  type CliProtocolResponseAdapter,
} from './cli-protocol-adapter';
import {
  buildRouteProxyBaseUrl,
  beginRouteProbeLockUpstreamAttempt,
  settleRouteProbeLockUpstreamAttempt,
  MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS,
  getRouteProbeLockTerminalFailure,
  isLoopbackAddress,
  notifyRouteProbeLockRequest,
  notifyRouteProbeLockTerminalFailure,
  parseProbeLockRouteApiKey,
  recordRouteProbeLockFirstUpstreamResult,
  type RouteProbeLockTerminalFailure,
  type RouteProbeLock,
} from './route-probe-lock';

const log = Logger.scope('RouteProxyService');

let proxyServer: http.Server | null = null;
let isRunning = false;
let requestSequence = 0;
const ALL_ROUTE_PATHS_DISABLED_ERROR_CODE = 'all_route_paths_disabled';
const ALL_ROUTE_PATHS_DISABLED_STATUS_CODE = 400;
const ALL_ROUTE_PATHS_DISABLED_MESSAGE =
  'all_route_paths_disabled: All route paths for this rule are temporarily disabled. Restore route paths in the route rule UI or wait for the suspension to expire.';
const EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE = 'empty_response_zero_usage';
const UPSTREAM_TEMPORARILY_UNAVAILABLE_ERROR_CODE = 'upstream_temporarily_unavailable';
const UPSTREAM_TEMPORARILY_UNAVAILABLE_STATUS_CODE = 503;
const UPSTREAM_TEMPORARILY_UNAVAILABLE_MESSAGE =
  'No upstream route is currently available. Please retry.';
const QUOTA_EXHAUSTED_ROUTE_LOG_MESSAGE = '余额不足，已跳过当前通道';
const UPSTREAM_QUOTA_EXHAUSTION_PATTERNS = [
  /\binsufficient(?:[_\s-]+account)?[_\s-]+balance\b/i,
  /\binsufficient[_\s-]+quota\b/i,
  /\bbilling[_\s-]+error\b/i,
  /\bupstream[_\s-]+quota[_\s-]+exhausted\b/i,
  /\buser[_\s-]+quota[_\s-]+is[_\s-]+not[_\s-]+enough\b/i,
  /(?:用户)?(?:余额|额度)不足/u,
  /预扣费(?:额度)?失败/u,
];
const ZERO_USAGE_UPSTREAM_RETRY_ATTEMPTS = 1;
const EMPTY_STREAM_UPSTREAM_RETRY_ATTEMPTS = 1;
const EMPTY_STREAMING_RESPONSE_ERROR = 'invalid_streaming_response:empty_streaming_response';
const PROBE_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_ERROR_CODE = 'probe_lock_upstream_attempt_exhausted';
const PROBE_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_STATUS_CODE = 400;
const ANYROUTER_REQUEST_TIMEOUT_MS = 120 * 1000;
const ACTIVE_STREAM_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const CLAUDE_COUNT_TOKENS_PATH = '/v1/messages/count_tokens';
const RESPONSES_INPUT_TOKENS_PATH = '/v1/responses/input_tokens';
const CLAUDE_MESSAGES_COUNT_TOKENS_ENDPOINT = 'claude_messages_count_tokens';
const RESPONSES_INPUT_TOKENS_ENDPOINT = 'openai_responses_input_tokens';
const LOCAL_TOKEN_ESTIMATE_HEADER = 'x-api-detect-token-estimate';
const OPENAI_STATEFUL_ROUTE_PREFIXES = [
  '/v1/batches',
  '/v1/files',
  '/v1/uploads',
  '/v1/vector_stores',
  '/v1/conversations',
  '/v1/containers',
] as const;
const LOCAL_COUNT_TOKENS_IMAGE_ESTIMATE = 2000;
const LOCAL_COUNT_TOKENS_DOCUMENT_ESTIMATE = 2000;
const LOCAL_COUNT_TOKENS_MESSAGE_OVERHEAD = 4;
const LOCAL_COUNT_TOKENS_CONSERVATIVE_MULTIPLIER = 1.15;
const INITIAL_STREAM_VALIDATION_MAX_BYTES = 4096;
const STREAM_TERMINAL_SCAN_MAX_CHARS = 8192;
const NATIVE_OPENAI_RESPONSES_SSE_MAX_PRECOMMIT_BYTES = 1024 * 1024;
const NATIVE_ANTHROPIC_SSE_MAX_FRAME_BYTES = 1024 * 1024;
const NATIVE_ANTHROPIC_SSE_MAX_PRECOMMIT_BYTES = 1024 * 1024;
const ROUTE_CLIENT_CANCELLED_ERROR_CODE = 'route_client_cancelled';

type ConcreteCliTargetProtocol = Exclude<CliTargetProtocol, 'native'>;
type RouteOperationCapability =
  | 'generation-convertible'
  | 'stateless-native-only'
  | 'stateful-unsupported'
  | 'unsupported';

export interface RouteEndpointOperation {
  protocol: ConcreteCliTargetProtocol;
  operation: string;
  capability: RouteOperationCapability;
}

class RouteClientCancelledError extends Error {
  constructor(message = 'Route client cancelled request') {
    super(message);
    this.name = 'RouteClientCancelledError';
  }
}

function isRouteClientCancelledError(error: unknown): boolean {
  return (
    error instanceof RouteClientCancelledError ||
    (error instanceof Error && error.name === 'RouteClientCancelledError')
  );
}

function createRouteClientCancelledError(): RouteClientCancelledError {
  return new RouteClientCancelledError(ROUTE_CLIENT_CANCELLED_ERROR_CODE);
}

/**
 * Client disconnect after a finished successful upstream attempt should still
 * appear in session request logs / path affinity. Incomplete or failed late
 * results stay silent so cancellation does not poison path health.
 */
function shouldRecordCancelledUpstreamSuccess(result: {
  statusCode: number;
  streamed?: boolean;
  usage?: RouteUsageStats;
}): boolean {
  if (classifyRouteStatusCode(result.statusCode) !== 'success') {
    return false;
  }
  if (!result.streamed && isAllZeroRouteUsage(result.usage)) {
    return false;
  }
  return true;
}

async function recordCancelledUpstreamSuccess(params: {
  requestId: string;
  requestSelectionStartedAt: number;
  attempt: number;
  activeChannel: ResolvedChannel;
  activeRouteRuleId?: string;
  cliType: RouteCliType;
  rawModel: string | null;
  reasoningEffort?: string;
  canonicalModel: string | null;
  result: {
    statusCode: number;
    latencyMs: number;
    firstByteLatencyMs?: number;
    usage?: RouteUsageStats;
  };
  routeRuntimeConfig: RouteRuntimeConfig;
}): Promise<void> {
  const { activeChannel, result } = params;
  recordOutcome(activeChannel, 'success', {
    statusCode: result.statusCode,
    latencyMs: result.latencyMs,
  });
  await recordRoutePathOutcome(
    activeChannel,
    'success',
    {
      statusCode: result.statusCode,
      latencyMs: result.latencyMs,
      requestSelectionStartedAt: params.requestSelectionStartedAt,
    },
    params.routeRuntimeConfig
  );
  recordRouteRequest({
    requestId: params.requestId,
    requestSelectionStartedAt: params.requestSelectionStartedAt,
    attempt: params.attempt,
    routeRuleId: params.activeRouteRuleId,
    cliType: params.cliType,
    targetProtocol: activeChannel.targetProtocol,
    targetEndpoint: activeChannel.targetEndpoint,
    requestedModel: params.rawModel,
    reasoningEffort: params.reasoningEffort,
    canonicalModel: params.canonicalModel,
    siteId: activeChannel.siteId,
    accountId: activeChannel.accountId,
    apiKeyId: activeChannel.apiKeyId,
    resolvedModel: activeChannel.resolvedModel,
    outcome: 'success',
    statusCode: result.statusCode,
    latencyMs: result.latencyMs,
    firstByteLatencyMs: result.firstByteLatencyMs,
    promptTokens: result.usage?.promptTokens,
    completionTokens: result.usage?.completionTokens,
    totalTokens: result.usage?.totalTokens,
    cacheCreationTokens: result.usage?.cacheCreationTokens,
    cacheReadTokens: result.usage?.cacheReadTokens,
    cachedTokens: result.usage?.cachedTokens,
  });
}

function nextRequestId(cliType: RouteCliType): string {
  requestSequence += 1;
  return `${cliType}-${Date.now()}-${requestSequence}`;
}

export function classifyRouteStatusCode(statusCode: number): RouteOutcome {
  if (statusCode >= 200 && statusCode < 400) return 'success';
  return 'failure';
}

function getEffectiveRouteDisplayItem(
  registry: Pick<RouteModelRegistryConfig, 'displayItems'> | null | undefined,
  canonicalModel: string | null | undefined
): RouteModelRegistryConfig['displayItems'][number] | null {
  if (!canonicalModel) {
    return null;
  }

  return (
    (registry?.displayItems ?? [])
      .filter(item => item.canonicalName === canonicalModel)
      .slice()
      .sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) {
          return right.updatedAt - left.updatedAt;
        }

        return right.createdAt - left.createdAt;
      })[0] ?? null
  );
}

export function resolveRouteRuntimeConfig(
  routing: Pick<RoutingConfig, 'modelRegistry'> | null | undefined,
  canonicalModel: string | null | undefined
): RouteRuntimeConfig {
  const displayItem = getEffectiveRouteDisplayItem(routing?.modelRegistry, canonicalModel);

  return normalizeRouteRuntimeConfig(displayItem?.runtimeConfig);
}

function isChannelDisabledByPriorityConfig(
  channel: Pick<RouteChannelKey, 'siteId' | 'accountId' | 'apiKeyId'>,
  registry: Pick<RouteModelRegistryConfig, 'displayItems'> | null | undefined,
  canonicalModel: string | null | undefined
): boolean {
  const priorityConfig = getEffectiveRouteDisplayItem(registry, canonicalModel)?.priorityConfig;
  if (!priorityConfig) {
    return false;
  }

  if ((priorityConfig.disabledSiteIds ?? []).includes(channel.siteId)) {
    return true;
  }

  return (priorityConfig.disabledApiKeyPriorityKeys ?? []).includes(
    buildRouteApiKeyPriorityKey(channel.siteId, channel.accountId, channel.apiKeyId)
  );
}

function filterChannelsByPriorityConfig(
  channels: ResolvedChannel[],
  routing: Pick<RoutingConfig, 'modelRegistry'>,
  canonicalModel: string | null | undefined
): ResolvedChannel[] {
  return channels.filter(
    channel => !isChannelDisabledByPriorityConfig(channel, routing.modelRegistry, canonicalModel)
  );
}

async function resolveChannelTargets(channels: ResolvedChannel[]): Promise<ResolvedChannel[]> {
  return Promise.all(
    channels.map(async channel => {
      const resolvedTarget = await resolveChannelTarget(channel);
      return {
        ...channel,
        targetProtocol: resolvedTarget.targetProtocol,
        targetEndpoint: resolvedTarget.targetEndpoint,
      };
    })
  );
}

function normalizeHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] || '';
  }

  return value || '';
}

function extractBearerToken(req: http.IncomingMessage): string {
  const authHeader = normalizeHeaderValue(req.headers['authorization']);
  return authHeader.replace(/^Bearer\s+/i, '').trim();
}

function extractClaudeRouteToken(req: http.IncomingMessage): string {
  const apiKeyHeader = normalizeHeaderValue(req.headers['x-api-key']);
  if (apiKeyHeader.trim()) {
    return apiKeyHeader.trim();
  }

  return extractBearerToken(req);
}

function resolveCanonicalModelFromRegistry(
  routing: Pick<RoutingConfig, 'modelRegistry'>,
  rawModel: string | null
): string | null {
  if (!rawModel) {
    return null;
  }

  for (const entry of Object.values(routing.modelRegistry.entries)) {
    if (entry.aliases.includes(rawModel) || entry.canonicalName === rawModel) {
      return entry.canonicalName;
    }
  }

  return rawModel;
}

export function extractRouteApiKey(
  req: Pick<http.IncomingMessage, 'headers' | 'url'>,
  cliType: RouteCliType
): string {
  if (cliType === 'grokBuild' || inferSourceProtocol(req.url) === 'anthropic-messages') {
    return extractClaudeRouteToken(req as http.IncomingMessage);
  }

  return extractBearerToken(req as http.IncomingMessage);
}

function isLikelyOpenCodeRequest(req: Pick<http.IncomingMessage, 'headers'>): boolean {
  const userAgent = normalizeHeaderValue(req.headers['user-agent']).toLowerCase();
  const originator = normalizeHeaderValue(req.headers['originator']).toLowerCase();
  return userAgent.includes('opencode') || originator.includes('opencode');
}

function isLikelyGrokBuildRequest(req: Pick<http.IncomingMessage, 'headers'>): boolean {
  const clientIdentifier = normalizeHeaderValue(
    req.headers['x-grok-client-identifier']
  ).toLowerCase();
  const userAgent = normalizeHeaderValue(req.headers['user-agent']).toLowerCase();
  return clientIdentifier === 'grok-shell' || userAgent.includes('grok-shell/');
}

export function detectMarkedRouteCliType(
  headers: Pick<http.IncomingHttpHeaders, string>
): RouteCliType | null {
  const marker = normalizeHeaderValue(headers[ROUTE_CLI_MARKER_HEADER]).trim().toLowerCase();
  if (!marker) {
    return null;
  }

  for (const [cliType, value] of Object.entries(ROUTE_CLI_MARKER_VALUES) as [
    RouteCliType,
    string,
  ][]) {
    if (value.toLowerCase() === marker) {
      return cliType;
    }
  }

  return null;
}

function getRequestPathname(requestUrl: string | undefined): string {
  return (requestUrl || '/').split('?')[0] || '/';
}

function inferSourceProtocol(requestUrl: string | undefined): ConcreteCliTargetProtocol | null {
  const pathname = getRequestPathname(requestUrl);
  if (pathname === '/v1/messages' || pathname.startsWith('/v1/messages/')) {
    return 'anthropic-messages';
  }
  if (pathname === '/v1/responses' || pathname.startsWith('/v1/responses/')) {
    return 'openai-responses';
  }
  if (pathname === '/v1/chat/completions' || pathname.startsWith('/v1/chat/completions/')) {
    return 'openai-chat-completions';
  }
  return null;
}

export function classifyRouteEndpointOperation(
  method: string | undefined,
  requestUrl: string | undefined
): RouteEndpointOperation | null {
  const pathname = getRequestPathname(requestUrl);
  if (
    OPENAI_STATEFUL_ROUTE_PREFIXES.some(
      prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  ) {
    return {
      protocol: 'openai-responses',
      operation: 'resource.lifecycle',
      capability: 'stateful-unsupported',
    };
  }

  const protocol = inferSourceProtocol(pathname);
  if (!protocol) {
    return null;
  }

  const normalizedMethod = (method || 'GET').toUpperCase();
  const matches = (expectedMethod: string, expectedPath: string | RegExp): boolean =>
    normalizedMethod === expectedMethod &&
    (typeof expectedPath === 'string' ? pathname === expectedPath : expectedPath.test(pathname));

  if (
    matches('POST', '/v1/messages') ||
    matches('POST', '/v1/responses') ||
    matches('POST', '/v1/chat/completions')
  ) {
    return { protocol, operation: 'generation.create', capability: 'generation-convertible' };
  }

  if (matches('POST', CLAUDE_COUNT_TOKENS_PATH) || matches('POST', RESPONSES_INPUT_TOKENS_PATH)) {
    return { protocol, operation: 'input_tokens.count', capability: 'stateless-native-only' };
  }

  const statefulOperation =
    matches('POST', '/v1/messages/batches') ||
    matches('GET', '/v1/messages/batches') ||
    matches('GET', /^\/v1\/messages\/batches\/[^/]+$/) ||
    matches('DELETE', /^\/v1\/messages\/batches\/[^/]+$/) ||
    matches('POST', /^\/v1\/messages\/batches\/[^/]+\/cancel$/) ||
    matches('GET', /^\/v1\/messages\/batches\/[^/]+\/results$/) ||
    matches('GET', /^\/v1\/responses\/[^/]+$/) ||
    matches('DELETE', /^\/v1\/responses\/[^/]+$/) ||
    matches('POST', /^\/v1\/responses\/[^/]+\/cancel$/) ||
    matches('GET', /^\/v1\/responses\/[^/]+\/input_items$/) ||
    matches('GET', '/v1/chat/completions') ||
    matches('GET', /^\/v1\/chat\/completions\/[^/]+$/) ||
    matches('POST', /^\/v1\/chat\/completions\/[^/]+$/) ||
    matches('DELETE', /^\/v1\/chat\/completions\/[^/]+$/) ||
    matches('GET', /^\/v1\/chat\/completions\/[^/]+\/messages$/);
  if (statefulOperation) {
    return { protocol, operation: 'resource.lifecycle', capability: 'stateful-unsupported' };
  }

  if (matches('POST', '/v1/responses/compact')) {
    return { protocol, operation: 'responses.compact', capability: 'unsupported' };
  }

  return { protocol, operation: 'unknown', capability: 'unsupported' };
}

function findProviderOwnedStateReference(body: unknown): string | null {
  const record = asRecord(body);
  if (!record) {
    return null;
  }

  for (const field of ['previous_response_id', 'conversation', 'container'] as const) {
    if (record[field] !== undefined && record[field] !== null && record[field] !== '') {
      return field;
    }
  }
  if (record.store === true) {
    return 'store';
  }
  if (record.background === true) {
    return 'background';
  }
  if (asRecord(record.prompt)?.id) {
    return 'prompt.id';
  }

  const visit = (value: unknown, path: string): string | null => {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const found = visit(value[index], `${path}[${index}]`);
        if (found) return found;
      }
      return null;
    }

    const item = asRecord(value);
    if (!item) {
      return null;
    }

    const type = typeof item.type === 'string' ? item.type.toLowerCase() : '';
    if (['input_file', 'file', 'file_search'].includes(type)) {
      return `${path}.type`;
    }
    const isTopLevelTool = /^tools\[\d+\]$/.test(path);
    for (const field of ['file_id', 'file_ids', 'vector_store_ids', 'container_id'] as const) {
      if (item[field] !== undefined && (type || isTopLevelTool)) {
        return `${path}.${field}`;
      }
    }
    for (const [key, nested] of Object.entries(item)) {
      if (key === 'parameters' || key === 'input_schema') {
        continue;
      }
      const found = visit(nested, `${path}.${key}`);
      if (found) return found;
    }
    return null;
  };

  for (const field of ['input', 'messages', 'system', 'tools'] as const) {
    const found = visit(record[field], field);
    if (found) return found;
  }
  return null;
}

function getUpstreamCliTypeForProtocol(protocol: ConcreteCliTargetProtocol): RouteCliType {
  return protocol === 'anthropic-messages' ? 'claudeCode' : 'codex';
}

function isRouteCliCompatibleWithProtocol(
  cliType: RouteCliType,
  protocol: ConcreteCliTargetProtocol
): boolean {
  if (cliType === 'openCode' || cliType === 'grokBuild') {
    return true;
  }
  if (cliType === 'claudeCode') {
    return protocol === 'anthropic-messages';
  }
  return protocol === 'openai-responses';
}

function resolveChannelUpstreamProtocol(
  channelProtocol: CliTargetProtocol | undefined,
  sourceProtocol: ConcreteCliTargetProtocol
): ConcreteCliTargetProtocol {
  const normalized = normalizeCliTargetProtocol(channelProtocol);
  return normalized === 'native' ? sourceProtocol : normalized;
}

function resolveEffectiveRouteChannel(
  channel: ResolvedChannel,
  cliType: RouteCliType,
  sourceProtocol: ConcreteCliTargetProtocol,
  nativePassthroughChannels: WeakSet<ResolvedChannel>
): ResolvedChannel {
  const nativePassthrough = normalizeCliTargetProtocol(channel.targetProtocol) === 'native';
  let resolvedChannel: ResolvedChannel;
  if (cliType !== 'openCode' && cliType !== 'grokBuild') {
    resolvedChannel = channel;
  } else {
    const upstreamProtocol = resolveChannelUpstreamProtocol(channel.targetProtocol, sourceProtocol);
    resolvedChannel = {
      ...channel,
      targetProtocol: upstreamProtocol,
      targetEndpoint: getCliTargetEndpoint(cliType, upstreamProtocol, channel.resolvedModel),
    };
  }

  if (nativePassthrough) {
    nativePassthroughChannels.add(resolvedChannel);
  }
  return resolvedChannel;
}

export function buildChannelAttemptPlan<
  T extends {
    routeRuleId?: string;
    siteId?: string;
    accountId?: string;
    apiKeyId?: string;
    targetProtocol?: RoutePathState['targetProtocol'];
    resolvedModel?: string;
    canonicalModel?: string;
  },
>(channels: T[], maxAttemptsPerRoutePath: number = 1): T[] {
  const normalizedMaxAttempts = Math.max(1, Math.floor(maxAttemptsPerRoutePath || 1));
  const attemptsByRoutePath = new Map<string, number>();

  return channels.filter(channel => {
    const pathKey = buildChannelAttemptPathKey(channel);
    const attempts = attemptsByRoutePath.get(pathKey) ?? 0;
    if (attempts >= normalizedMaxAttempts) {
      return false;
    }

    attemptsByRoutePath.set(pathKey, attempts + 1);
    return true;
  });
}

function buildChannelAttemptPathKey(channel: {
  routeRuleId?: string;
  siteId?: string;
  accountId?: string;
  apiKeyId?: string;
  targetProtocol?: RoutePathState['targetProtocol'];
  resolvedModel?: string;
  canonicalModel?: string;
}): string {
  return [
    channel.routeRuleId || '__rule__',
    channel.siteId || '__site__',
    channel.accountId || '__account__',
    channel.apiKeyId || '__api_key__',
    normalizeCliTargetProtocol(channel.targetProtocol),
    channel.canonicalModel?.trim() || '__empty_canonical_model__',
    channel.resolvedModel?.trim() || '__empty_resolved_model__',
  ].join('|');
}

type RoutePathAffinityCandidate = RouteChannelKey & {
  canonicalModel?: string;
  resolvedModel?: string;
  targetProtocol?: RoutePathState['targetProtocol'];
};

function getRoutePathAffinitySuppressionUntil(
  channel: RoutePathAffinityCandidate,
  routePathStates: Record<string, RoutePathState>
): number {
  const sameRuleChannelState =
    routePathStates[buildRoutePathStateKey({ ...channel, resolvedModel: undefined })];
  const anyRuleChannelState =
    routePathStates[
      buildRoutePathStateKey({
        ...channel,
        routeRuleId: undefined,
        resolvedModel: undefined,
      })
    ];

  return Math.max(
    sameRuleChannelState?.affinitySuppressedUntil ?? 0,
    anyRuleChannelState?.affinitySuppressedUntil ?? 0
  );
}

export function applySuccessfulRoutePathAffinity<T extends RoutePathAffinityCandidate>(
  channels: T[],
  routePathStates: Record<string, RoutePathState> | null | undefined,
  now: number = Date.now(),
  affinityInvalidatedAt?: number
): T[] {
  if (channels.length <= 1 || !routePathStates) {
    return channels;
  }

  const affinityCutoff = now - ROUTE_SUCCESSFUL_PATH_AFFINITY_MS;
  let preferredIndex = -1;
  let preferredLastSuccessAt = 0;

  channels.forEach((channel, index) => {
    const state = routePathStates[buildRoutePathStateKey(channel)];
    const affinitySuppressedUntil = Math.max(
      state?.affinitySuppressedUntil ?? 0,
      getRoutePathAffinitySuppressionUntil(channel, routePathStates)
    );
    const lastSuccessAt = state?.lastSuccessAt ?? 0;
    const lastSuccessRequestStartedAt = state?.lastSuccessRequestStartedAt;
    if (
      state?.lastOutcome !== 'success' ||
      lastSuccessAt <= affinityCutoff ||
      (affinityInvalidatedAt !== undefined &&
        (lastSuccessRequestStartedAt === undefined ||
          lastSuccessRequestStartedAt <= affinityInvalidatedAt)) ||
      affinitySuppressedUntil > now ||
      (state.disabledUntil ?? 0) > now
    ) {
      return;
    }

    if (lastSuccessAt > preferredLastSuccessAt) {
      preferredIndex = index;
      preferredLastSuccessAt = lastSuccessAt;
    }
  });

  if (preferredIndex <= 0) {
    return channels;
  }

  return [
    channels[preferredIndex],
    ...channels.slice(preferredIndex + 1),
    ...channels.slice(0, preferredIndex),
  ];
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('aborted', onAborted);
      req.off('close', onClose);
      req.off('error', onError);
    };
    const resolveOnce = (body: Buffer) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(body);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    const onEnd = () => resolveOnce(Buffer.concat(chunks));
    const onAborted = () => rejectOnce(createRouteClientCancelledError());
    const onClose = () => {
      if (!req.complete) {
        rejectOnce(createRouteClientCancelledError());
      }
    };
    const onError = (error: Error) => rejectOnce(error);

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('aborted', onAborted);
    req.on('close', onClose);
    req.on('error', onError);
  });
}

export function applyRouteThinkingEffortOverride(
  bodyBuffer: Buffer,
  effort: RouteThinkingEffort | null | undefined,
  protocol: ConcreteCliTargetProtocol
): Buffer {
  if (!effort) {
    return bodyBuffer;
  }

  try {
    const body = JSON.parse(bodyBuffer.toString('utf-8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return bodyBuffer;
    }

    const record = body as Record<string, unknown>;

    if (protocol === 'anthropic-messages') {
      const existingOutputConfig =
        record.output_config &&
        typeof record.output_config === 'object' &&
        !Array.isArray(record.output_config)
          ? { ...(record.output_config as Record<string, unknown>) }
          : {};
      existingOutputConfig.effort = effort;
      record.output_config = existingOutputConfig;

      const existingThinking =
        record.thinking && typeof record.thinking === 'object' && !Array.isArray(record.thinking)
          ? { ...(record.thinking as Record<string, unknown>) }
          : null;
      if (!existingThinking || Object.keys(existingThinking).length === 0) {
        record.thinking = { type: 'adaptive' };
      } else {
        record.thinking = existingThinking;
      }
    } else if (protocol === 'openai-responses') {
      const existingReasoning =
        record.reasoning && typeof record.reasoning === 'object' && !Array.isArray(record.reasoning)
          ? { ...(record.reasoning as Record<string, unknown>) }
          : {};
      existingReasoning.effort = effort;
      record.reasoning = existingReasoning;
      delete record.reasoning_effort;
      delete record.reasoningEffort;
    } else {
      record.reasoning_effort = effort;
      delete record.reasoningEffort;
      delete record.reasoning;
    }

    return Buffer.from(JSON.stringify(record), 'utf-8');
  } catch {
    return bodyBuffer;
  }
}

/** 重写请求体中的 model 字段 */
function rewriteRequestModel(bodyBuffer: Buffer, upstreamModel: string): Buffer {
  try {
    const bodyStr = bodyBuffer.toString('utf-8');
    const body = JSON.parse(bodyStr);
    if (body && typeof body === 'object' && typeof body.model === 'string') {
      body.model = upstreamModel;
      return Buffer.from(JSON.stringify(body), 'utf-8');
    }
  } catch {
    // 非 JSON 或无 model 字段，原样返回
  }
  return bodyBuffer;
}

function deleteAuthHeaders(headers: Record<string, string | string[] | undefined>): void {
  for (const key of Object.keys(headers)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'authorization' || normalizedKey === 'x-api-key') {
      delete headers[key];
    }
  }
}

function compactHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string | string[]] => {
      const value = entry[1];
      return typeof value === 'string' || Array.isArray(value);
    })
  );
}

function isEventStreamResponse(headers: http.IncomingHttpHeaders): boolean {
  return normalizeHeaderValue(headers['content-type']).toLowerCase().includes('text/event-stream');
}

function isStreamingRequest(bodyJson: unknown, requestUrl: string | undefined): boolean {
  void requestUrl;
  const record = asRecord(bodyJson);
  if (record?.stream === true) return true;

  return false;
}

function resolveUpstreamTimeouts(params: {
  siteName?: string;
  baseTimeoutMs: number;
  streamingRequest: boolean;
}): { timeoutMs: number; streamIdleTimeoutMs?: number } {
  const siteTimeoutMs =
    params.siteName && isAnyRouterSite(params.siteName)
      ? ANYROUTER_REQUEST_TIMEOUT_MS
      : params.baseTimeoutMs;

  if (!params.streamingRequest) {
    return { timeoutMs: siteTimeoutMs };
  }

  return {
    timeoutMs: siteTimeoutMs,
    streamIdleTimeoutMs: Math.max(siteTimeoutMs, ACTIVE_STREAM_IDLE_TIMEOUT_MS),
  };
}

function canStreamResponseAdapters(
  anyRouterAdapter: AnyRouterResponseAdapter,
  protocolAdapters: CliProtocolResponseAdapter[]
): boolean {
  return (
    anyRouterAdapter.type === 'transparent' &&
    protocolAdapters.every(adapter => adapter.type === 'transparent')
  );
}

const ROUTE_PROXY_BLOCKED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function buildRouteProxyResponseHeaders(
  headers: http.IncomingHttpHeaders
): http.OutgoingHttpHeaders {
  const outgoing: http.OutgoingHttpHeaders = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || ROUTE_PROXY_BLOCKED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    outgoing[key] = value;
  }

  return outgoing;
}

function buildStreamingResponseHeaders(
  headers: http.IncomingHttpHeaders
): http.OutgoingHttpHeaders {
  return buildRouteProxyResponseHeaders(headers);
}

function buildBufferedResponseHeaders(
  headers: http.IncomingHttpHeaders,
  body: Buffer
): http.OutgoingHttpHeaders {
  return {
    ...buildRouteProxyResponseHeaders(headers),
    'content-length': String(body.length),
  };
}

type InitialEventStreamValidation =
  | { status: 'accepted' }
  | { status: 'pending' }
  | { status: 'rejected'; reason: string };

type StreamingTerminalProtocol = 'anthropic' | 'openaiChat' | 'openaiResponses' | 'none';
type CompletedStreamValidation = { ok: true } | { ok: false; reason: string; message: string };

interface ParsedSseBlock {
  event?: string;
  data: string;
}

interface StreamingSseObservationState {
  buffer: Buffer;
  errorSeen: boolean;
  nextSequenceNumber: number;
  terminalSeen: boolean;
}

interface AnthropicSseCompatibilityNormalizerState {
  buffer: string;
  openBlocks: Map<number, { type: string }>;
  completedToolBlocks: number;
}

class NativeAnthropicSseGuardError extends Error {
  constructor(
    readonly reason: string,
    readonly protocolMessage: string
  ) {
    super(`malformed_streaming_response:${reason}`);
    this.name = 'NativeAnthropicSseGuardError';
  }
}

interface NativeAnthropicSseGuardState {
  buffer: Buffer;
  openBlocks: Set<number>;
  pendingFrames: Buffer[];
  pendingBytes: number;
  released: boolean;
  sawMessageStart: boolean;
}

function validateInitialEventStreamChunk(buffer: Buffer): InitialEventStreamValidation {
  if (!buffer.length) {
    return { status: 'pending' };
  }

  const text = buffer.toString('utf-8');
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  if (!trimmed) {
    return buffer.length >= INITIAL_STREAM_VALIDATION_MAX_BYTES
      ? { status: 'rejected', reason: 'empty_initial_stream' }
      : { status: 'pending' };
  }

  const firstBytes = trimmed.slice(0, 256).toLowerCase();
  if (firstBytes.startsWith('<!doctype') || firstBytes.startsWith('<html') || trimmed[0] === '<') {
    return { status: 'rejected', reason: 'html_response' };
  }
  if (trimmed[0] === '{' || trimmed[0] === '[') {
    return { status: 'rejected', reason: 'json_response' };
  }

  const hasCompleteLine = /\r?\n/.test(trimmed);
  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  if (/^(?::|event\s*:|data\s*:|id\s*:|retry\s*:)/.test(firstLine.trimStart())) {
    return { status: 'accepted' };
  }

  if (hasCompleteLine) {
    return { status: 'rejected', reason: 'non_sse_response' };
  }

  return buffer.length >= INITIAL_STREAM_VALIDATION_MAX_BYTES
    ? { status: 'rejected', reason: 'non_sse_response' }
    : { status: 'pending' };
}

function getStreamingTerminalProtocol(
  cliType: RouteCliType,
  requestUrl?: string
): StreamingTerminalProtocol {
  if (cliType === 'claudeCode') return 'anthropic';
  if (cliType === 'codex') return 'openaiResponses';
  if (cliType === 'openCode' || cliType === 'grokBuild') {
    const sourceProtocol = inferSourceProtocol(requestUrl);
    if (sourceProtocol === 'anthropic-messages') return 'anthropic';
    if (sourceProtocol === 'openai-responses') return 'openaiResponses';
    return 'openaiChat';
  }
  return 'none';
}

function appendStreamingTerminalScanText(
  protocol: StreamingTerminalProtocol,
  current: string,
  chunk: Buffer
): { text: string; terminalSeen: boolean } {
  const next = `${current}${chunk.toString('utf-8')}`;
  return {
    text:
      next.length > STREAM_TERMINAL_SCAN_MAX_CHARS
        ? next.slice(-STREAM_TERMINAL_SCAN_MAX_CHARS)
        : next,
    terminalSeen: hasStreamingTerminalMarker(protocol, next),
  };
}

function hasStreamingTerminalMarker(protocol: StreamingTerminalProtocol, text: string): boolean {
  if (protocol === 'none') return true;

  if (protocol === 'anthropic') {
    return /event:\s*message_stop/.test(text) || /"type"\s*:\s*"message_stop"/.test(text);
  }

  if (protocol === 'openaiChat') {
    return /data:\s*\[DONE\]/.test(text);
  }

  return (
    /data:\s*\[DONE\]/.test(text) ||
    /event:\s*response\.completed/.test(text) ||
    /event:\s*response\.(?:failed|incomplete)/.test(text) ||
    /"type"\s*:\s*"response\.(?:completed|failed|incomplete)"/.test(text)
  );
}

function hasAnthropicMessageStop(body: Buffer): boolean {
  for (const block of parseSseBlocks(body.toString('utf-8'))) {
    const payload = parseSseJsonRecord(block.data);
    if (readString(payload?.type) === 'message_stop') {
      return true;
    }
  }

  return false;
}

function buildStreamingErrorChunk(
  protocol: StreamingTerminalProtocol,
  message: string,
  sequenceNumber = 0
): Buffer {
  if (protocol === 'anthropic') {
    return Buffer.from(
      `event: error\ndata: ${JSON.stringify({
        type: 'error',
        error: { type: 'api_error', message },
      })}\n\n`,
      'utf-8'
    );
  }

  if (protocol === 'openaiResponses') {
    return Buffer.from(
      `event: error\ndata: ${JSON.stringify({
        type: 'error',
        code: 'upstream_stream_error',
        message,
        param: null,
        sequence_number: sequenceNumber,
      })}\n\n`,
      'utf-8'
    );
  }

  return Buffer.from(
    `data: ${JSON.stringify({
      error: {
        message,
        type: 'server_error',
        code: 'upstream_stream_error',
        param: null,
      },
    })}\n\n`,
    'utf-8'
  );
}

function parseSseBlocks(text: string): ParsedSseBlock[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const blocks: ParsedSseBlock[] = [];

  for (const block of normalized.split(/\n\n+/)) {
    const lines = block.split('\n');
    const dataLines: string[] = [];
    let event: string | undefined;

    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }

    if (dataLines.length > 0) {
      blocks.push({ event, data: dataLines.join('\n').trim() });
    }
  }

  return blocks;
}

function createStreamingSseObservationState(
  protocol: StreamingTerminalProtocol
): StreamingSseObservationState {
  return {
    buffer: Buffer.alloc(0),
    errorSeen: false,
    nextSequenceNumber: 0,
    terminalSeen: protocol === 'none',
  };
}

function observeStreamingSseBlock(
  state: StreamingSseObservationState,
  protocol: StreamingTerminalProtocol,
  block: ParsedSseBlock
): void {
  if (block.data === '[DONE]') {
    state.terminalSeen = true;
    return;
  }

  const payload = parseSseJsonRecord(block.data);
  const eventType = readString(payload?.type) || block.event || '';
  const sequenceNumber = payload?.sequence_number;
  if (
    typeof sequenceNumber === 'number' &&
    Number.isSafeInteger(sequenceNumber) &&
    sequenceNumber >= state.nextSequenceNumber
  ) {
    state.nextSequenceNumber = sequenceNumber + 1;
  }

  if (eventType === 'error' || asRecord(payload?.error)) {
    state.errorSeen = true;
    state.terminalSeen = true;
    return;
  }

  if (protocol === 'anthropic') {
    state.terminalSeen = state.terminalSeen || eventType === 'message_stop';
    return;
  }

  if (protocol === 'openaiResponses') {
    state.terminalSeen =
      state.terminalSeen ||
      eventType === 'response.completed' ||
      eventType === 'response.failed' ||
      eventType === 'response.incomplete';
  }
}

function observeStreamingSseChunk(
  state: StreamingSseObservationState,
  protocol: StreamingTerminalProtocol,
  chunk: Buffer,
  flush = false
): void {
  if (chunk.length) {
    state.buffer = state.buffer.length ? Buffer.concat([state.buffer, chunk]) : chunk;
  }

  for (;;) {
    const frameEnd = findSseFrameEnd(state.buffer);
    if (frameEnd < 0) break;
    const frame = state.buffer.subarray(0, frameEnd);
    state.buffer = state.buffer.subarray(frameEnd);
    for (const block of parseSseBlocks(frame.toString('utf-8'))) {
      observeStreamingSseBlock(state, protocol, block);
    }
  }

  if (flush && state.buffer.length) {
    for (const block of parseSseBlocks(state.buffer.toString('utf-8'))) {
      observeStreamingSseBlock(state, protocol, block);
    }
    state.buffer = Buffer.alloc(0);
  }
}

function createAnthropicSseCompatibilityNormalizer(): AnthropicSseCompatibilityNormalizerState {
  return {
    buffer: '',
    openBlocks: new Map(),
    completedToolBlocks: 0,
  };
}

function splitCompleteSseBlocks(text: string): { blocks: string[]; rest: string } {
  const blocks: string[] = [];
  let cursor = 0;
  const separatorPattern = /\n\n+/g;
  let match: RegExpExecArray | null;

  while ((match = separatorPattern.exec(text))) {
    const end = match.index + match[0].length;
    blocks.push(text.slice(cursor, end));
    cursor = end;
  }

  return { blocks, rest: text.slice(cursor) };
}

function serializeSseBlock(event: string | undefined, data: string): string {
  return `${event ? `event: ${event}\n` : ''}data: ${data}\n\n`;
}

function normalizeAnthropicSseCompatibilityBlock(
  state: AnthropicSseCompatibilityNormalizerState,
  rawBlock: string
): string {
  const blocks = parseSseBlocks(rawBlock);
  if (blocks.length !== 1 || !blocks[0].data || blocks[0].data === '[DONE]') {
    return rawBlock;
  }

  const block = blocks[0];
  const payload = parseSseJsonRecord(block.data);
  if (!payload) {
    return rawBlock;
  }

  const payloadType = readString(payload.type);
  const eventType = payloadType || block.event || '';

  if (eventType === 'content_block_start') {
    const index = readNumericIndex(payload.index);
    const contentBlock = asRecord(payload.content_block);
    const blockType = readString(contentBlock?.type);
    if (index !== undefined && blockType && !state.openBlocks.has(index)) {
      state.openBlocks.set(index, { type: blockType });
    }
    return rawBlock;
  }

  if (eventType === 'content_block_stop') {
    const index = readNumericIndex(payload.index);
    const blockState = index === undefined ? undefined : state.openBlocks.get(index);
    if (blockState?.type === 'tool_use') {
      state.completedToolBlocks += 1;
    }
    if (index !== undefined) {
      state.openBlocks.delete(index);
    }
    return rawBlock;
  }

  if (eventType !== 'message_delta' || state.completedToolBlocks === 0) {
    return rawBlock;
  }

  const delta = asRecord(payload.delta);
  if (readString(delta?.stop_reason) !== 'end_turn') {
    return rawBlock;
  }

  return serializeSseBlock(
    block.event,
    JSON.stringify({
      ...payload,
      delta: {
        ...delta,
        stop_reason: 'tool_use',
      },
    })
  );
}

function normalizeAnthropicSseCompatibilityChunk(
  state: AnthropicSseCompatibilityNormalizerState,
  chunk: Buffer
): Buffer {
  const normalized = `${state.buffer}${chunk.toString('utf-8')}`.replace(/\r\n/g, '\n');
  const { blocks, rest } = splitCompleteSseBlocks(normalized);
  state.buffer = rest;
  return Buffer.from(
    blocks.map(block => normalizeAnthropicSseCompatibilityBlock(state, block)).join(''),
    'utf-8'
  );
}

function flushAnthropicSseCompatibilityNormalizer(
  state: AnthropicSseCompatibilityNormalizerState
): Buffer {
  if (!state.buffer.trim()) {
    state.buffer = '';
    return Buffer.alloc(0);
  }

  const tail = state.buffer.endsWith('\n\n') ? state.buffer : `${state.buffer}\n\n`;
  state.buffer = '';
  return Buffer.from(normalizeAnthropicSseCompatibilityBlock(state, tail), 'utf-8');
}

function parseSseJsonRecord(data: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(data));
  } catch {
    return undefined;
  }
}

function createNativeAnthropicSseGuard(): NativeAnthropicSseGuardState {
  return {
    buffer: Buffer.alloc(0),
    openBlocks: new Set(),
    pendingFrames: [],
    pendingBytes: 0,
    released: false,
    sawMessageStart: false,
  };
}

function findSseFrameEnd(buffer: Buffer): number {
  let previousWasLineEnding = false;

  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (byte !== 0x0a && byte !== 0x0d) {
      previousWasLineEnding = false;
      continue;
    }

    const lineEndingLength = byte === 0x0d && buffer[index + 1] === 0x0a ? 2 : 1;
    if (previousWasLineEnding) {
      return index + lineEndingLength;
    }

    previousWasLineEnding = true;
    index += lineEndingLength - 1;
  }

  return -1;
}

function buildNativeAnthropicSseGuardFailure(
  reason: string,
  message: string
): CompletedStreamValidation {
  return buildCompletedStreamFailure(reason, message);
}

function validateNativeAnthropicSseFrame(
  state: NativeAnthropicSseGuardState,
  frame: Buffer
): CompletedStreamValidation & { releasesPending?: boolean } {
  const blocks = parseSseBlocks(frame.toString('utf-8'));
  if (blocks.length === 0 || !blocks[0].data || blocks[0].data === '[DONE]') {
    return { ok: true };
  }

  const block = blocks[0];
  const payload = parseSseJsonRecord(block.data);
  const eventType = readString(payload?.type) || block.event || '';
  if (!payload) {
    if (
      block.event &&
      !block.event.startsWith('content_block_') &&
      !block.event.startsWith('message_') &&
      block.event !== 'error'
    ) {
      return { ok: true };
    }
    return buildNativeAnthropicSseGuardFailure(
      'malformed_sse_json',
      'upstream emitted malformed Anthropic SSE JSON'
    );
  }

  if (eventType === 'message_start') {
    state.sawMessageStart = true;
    return { ok: true };
  }

  if (eventType === 'content_block_start') {
    const index = readNumericIndex(payload.index);
    const contentBlock = asRecord(payload.content_block);
    if (
      !state.sawMessageStart ||
      index === undefined ||
      !readString(contentBlock?.type) ||
      state.openBlocks.has(index)
    ) {
      return buildNativeAnthropicSseGuardFailure(
        'invalid_content_block_start',
        'upstream emitted invalid Anthropic content block start'
      );
    }

    state.openBlocks.add(index);
    return { ok: true, releasesPending: true };
  }

  if (eventType === 'content_block_delta') {
    const index = readNumericIndex(payload.index);
    if (index === undefined || !state.openBlocks.has(index) || !asRecord(payload.delta)) {
      return buildNativeAnthropicSseGuardFailure(
        'unexpected_content_block_delta',
        'upstream emitted Anthropic content delta without an open block'
      );
    }
    return { ok: true };
  }

  if (eventType === 'content_block_stop') {
    const index = readNumericIndex(payload.index);
    if (index === undefined || !state.openBlocks.delete(index)) {
      return buildNativeAnthropicSseGuardFailure(
        'unexpected_content_block_stop',
        'upstream emitted Anthropic content block stop without an open block'
      );
    }
    return { ok: true };
  }

  if (eventType === 'message_stop') {
    if (state.openBlocks.size > 0) {
      return buildNativeAnthropicSseGuardFailure(
        'unclosed_content_block',
        'upstream ended Claude Code stream with an unclosed content block'
      );
    }
    return { ok: true, releasesPending: true };
  }

  if (eventType === 'error') {
    return { ok: true, releasesPending: true };
  }

  return { ok: true };
}

function* processNativeAnthropicSseFrames(
  state: NativeAnthropicSseGuardState,
  frames: Buffer[]
): Generator<Buffer> {
  for (const frame of frames) {
    if (frame.length > NATIVE_ANTHROPIC_SSE_MAX_FRAME_BYTES) {
      throw new NativeAnthropicSseGuardError(
        'sse_frame_too_large',
        'upstream emitted an Anthropic SSE frame above the safety limit'
      );
    }

    const validation = validateNativeAnthropicSseFrame(state, frame);
    if (!validation.ok) {
      throw new NativeAnthropicSseGuardError(validation.reason, validation.message);
    }

    if (state.released) {
      yield frame;
      continue;
    }

    state.pendingFrames.push(frame);
    state.pendingBytes += frame.length;
    if (state.pendingBytes > NATIVE_ANTHROPIC_SSE_MAX_PRECOMMIT_BYTES) {
      throw new NativeAnthropicSseGuardError(
        'precommit_buffer_too_large',
        'upstream did not emit a valid Anthropic content block before the safety limit'
      );
    }

    if (validation.releasesPending) {
      state.released = true;
      const pendingFrames = state.pendingFrames;
      state.pendingFrames = [];
      state.pendingBytes = 0;
      yield* pendingFrames;
    }
  }
}

function* processNativeAnthropicSseGuardChunk(
  state: NativeAnthropicSseGuardState,
  chunk: Buffer
): Generator<Buffer> {
  state.buffer = state.buffer.length ? Buffer.concat([state.buffer, chunk]) : chunk;
  const frames: Buffer[] = [];

  for (;;) {
    const frameEnd = findSseFrameEnd(state.buffer);
    if (frameEnd < 0) break;
    frames.push(state.buffer.subarray(0, frameEnd));
    state.buffer = state.buffer.subarray(frameEnd);
  }

  if (state.buffer.length > NATIVE_ANTHROPIC_SSE_MAX_FRAME_BYTES) {
    throw new NativeAnthropicSseGuardError(
      'sse_frame_too_large',
      'upstream emitted an Anthropic SSE frame above the safety limit'
    );
  }

  yield* processNativeAnthropicSseFrames(state, frames);
}

function* flushNativeAnthropicSseGuard(state: NativeAnthropicSseGuardState): Generator<Buffer> {
  const frames = state.buffer.length ? [state.buffer] : [];
  state.buffer = Buffer.alloc(0);
  yield* processNativeAnthropicSseFrames(state, frames);

  if (state.openBlocks.size > 0) {
    throw new NativeAnthropicSseGuardError(
      'unclosed_content_block',
      'upstream ended Claude Code stream with an unclosed content block'
    );
  }

  if (!state.released) {
    state.released = true;
    const pendingFrames = state.pendingFrames;
    state.pendingFrames = [];
    state.pendingBytes = 0;
    yield* pendingFrames;
  }
}

function readStreamingValidationMessage(error: unknown): string {
  return error instanceof NativeAnthropicSseGuardError
    ? error.protocolMessage
    : 'upstream emitted an invalid streaming response';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNumericIndex(value: unknown): number | undefined {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

function findUpstreamStreamingFailureCode(body: Buffer): string | undefined {
  for (const block of parseSseBlocks(body.toString('utf-8'))) {
    const payload = parseSseJsonRecord(block.data);
    if (!payload) continue;

    const payloadType = readString(payload.type) || block.event || '';
    const response = asRecord(payload.response);
    const error = asRecord(payload.error) || asRecord(response?.error);
    const isFailureEvent =
      block.event === 'error' || payloadType === 'error' || payloadType === 'response.failed';
    if (!isFailureEvent && !error) continue;

    return readString(error?.type) || readString(error?.code) || payloadType || 'unknown_error';
  }

  return undefined;
}

function isRetryableEmptyStreamingResponse(error: unknown): boolean {
  return error instanceof Error && error.message === EMPTY_STREAMING_RESPONSE_ERROR;
}

function buildCompletedStreamFailure(reason: string, message: string): CompletedStreamValidation {
  return { ok: false, reason, message };
}

function hasOpenAiResponsesOutputItem(item: unknown): boolean {
  const record = asRecord(item);
  if (!record) {
    return false;
  }

  const itemType = readString(record.type);
  if (itemType && itemType !== 'message') {
    return true;
  }

  if (readString(record.output_text).trim() || readString(record.text).trim()) {
    return true;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  return content.some(part => {
    const partRecord = asRecord(part);
    return Boolean(
      partRecord &&
        (readString(partRecord.text).trim() || readString(partRecord.output_text).trim())
    );
  });
}

function hasOnlyZeroUsageTokens(usage: Record<string, unknown> | undefined): boolean {
  if (!usage) {
    return false;
  }

  const tokenValues = [
    usage.input_tokens,
    usage.inputTokens,
    usage.prompt_tokens,
    usage.promptTokens,
    usage.output_tokens,
    usage.outputTokens,
    usage.completion_tokens,
    usage.completionTokens,
    usage.total_tokens,
    usage.totalTokens,
  ]
    .map(toFiniteTokenNumber)
    .filter((value): value is number => value !== undefined);

  return tokenValues.length > 0 && tokenValues.every(value => value === 0);
}

interface OpenAiResponsesStreamInspection {
  sawFinished: boolean;
  sawDone: boolean;
  sawFailure: boolean;
  textLength: number;
  outputItems: number;
  explicitZeroUsage: boolean;
  malformedJson: boolean;
}

function inspectOpenAiResponsesStream(body: Buffer): OpenAiResponsesStreamInspection {
  let sawFinished = false;
  let sawDone = false;
  let sawFailure = false;
  let textLength = 0;
  let outputItems = 0;
  let explicitZeroUsage = false;
  let malformedJson = false;

  for (const block of parseSseBlocks(body.toString('utf-8'))) {
    if (!block.data) {
      continue;
    }

    if (block.data === '[DONE]') {
      sawDone = true;
      continue;
    }

    const payload = parseSseJsonRecord(block.data);
    if (!payload) {
      malformedJson = true;
      continue;
    }

    const payloadType = readString(payload.type) || block.event || '';
    if (payloadType === 'response.failed') {
      sawFailure = true;
      continue;
    }
    if (
      payloadType === 'response.output_text.delta' ||
      payloadType === 'response.output_text.done'
    ) {
      textLength +=
        readString(payload.delta).trim().length + readString(payload.text).trim().length;
      continue;
    }

    if (
      payloadType === 'response.function_call_arguments.delta' ||
      payloadType === 'response.function_call_arguments.done'
    ) {
      if (readString(payload.delta).trim() || readString(payload.arguments).trim()) {
        outputItems += 1;
      }
      continue;
    }

    if (
      payloadType === 'response.output_item.added' ||
      payloadType === 'response.output_item.done'
    ) {
      if (hasOpenAiResponsesOutputItem(payload.item)) {
        outputItems += 1;
      }
      continue;
    }

    if (payloadType === 'response.completed' || payloadType === 'response.incomplete') {
      sawFinished = true;
      const response = asRecord(payload.response);
      textLength += readString(response?.output_text).trim().length;
      const output = Array.isArray(response?.output) ? response.output : [];
      outputItems += output.filter(hasOpenAiResponsesOutputItem).length;

      const usage = asRecord(response?.usage) || asRecord(payload.usage);
      if (hasOnlyZeroUsageTokens(usage)) {
        explicitZeroUsage = true;
      }
    }
  }

  return {
    sawFinished,
    sawDone,
    sawFailure,
    textLength,
    outputItems,
    explicitZeroUsage,
    malformedJson,
  };
}

function hasOpenAiResponsesStreamOutput(inspection: OpenAiResponsesStreamInspection): boolean {
  return inspection.textLength > 0 || inspection.outputItems > 0;
}

function validateCompletedOpenAiResponsesStream(body: Buffer): CompletedStreamValidation {
  const inspection = inspectOpenAiResponsesStream(body);

  if (inspection.malformedJson) {
    return buildCompletedStreamFailure(
      'malformed_sse_json',
      'upstream emitted malformed OpenAI Responses SSE JSON'
    );
  }

  if (!inspection.sawFinished && !inspection.sawDone) {
    return buildCompletedStreamFailure(
      'missing_response_terminal',
      'upstream ended Codex stream without response.completed, response.incomplete, or [DONE]'
    );
  }

  if (!hasOpenAiResponsesStreamOutput(inspection)) {
    if (inspection.explicitZeroUsage) {
      return buildCompletedStreamFailure(
        'empty_response_zero_usage',
        'upstream ended Codex stream without output and with all-zero usage'
      );
    }

    return buildCompletedStreamFailure(
      'empty_response',
      'upstream ended Codex stream without assistant text, function_call, or tool output content'
    );
  }

  return { ok: true };
}

function validateCompletedOpenAiChatStream(body: Buffer): CompletedStreamValidation {
  let sawDone = false;
  let textLength = 0;
  let toolItems = 0;
  let explicitZeroUsage = false;

  for (const block of parseSseBlocks(body.toString('utf-8'))) {
    if (!block.data) {
      continue;
    }

    if (block.data === '[DONE]') {
      sawDone = true;
      continue;
    }

    const payload = parseSseJsonRecord(block.data);
    if (!payload) {
      return buildCompletedStreamFailure(
        'malformed_sse_json',
        'upstream emitted malformed OpenAI Chat Completions SSE JSON'
      );
    }

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const rawChoice of choices) {
      const choice = asRecord(rawChoice);
      const delta = asRecord(choice?.delta);
      const message = asRecord(choice?.message);
      textLength += readString(delta?.content).length + readString(message?.content).length;
      const deltaToolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
      const messageToolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
      toolItems += deltaToolCalls.length + messageToolCalls.length;
    }

    if (hasOnlyZeroUsageTokens(asRecord(payload.usage))) {
      explicitZeroUsage = true;
    }
  }

  if (!sawDone) {
    return buildCompletedStreamFailure(
      'missing_chat_done',
      'upstream ended OpenAI Chat Completions stream without [DONE]'
    );
  }

  if (textLength === 0 && toolItems === 0) {
    if (explicitZeroUsage) {
      return buildCompletedStreamFailure(
        'empty_response_zero_usage',
        'upstream ended OpenAI Chat Completions stream without output and with all-zero usage'
      );
    }

    return buildCompletedStreamFailure(
      'empty_response',
      'upstream ended OpenAI Chat Completions stream without assistant text or tool call content'
    );
  }

  return { ok: true };
}

function isForeignOpenAiLikeAnthropicPayload(
  payload: Record<string, unknown>,
  eventType: string
): boolean {
  if (eventType.startsWith('response.') || eventType.startsWith('chat.completion')) {
    return true;
  }

  if (Array.isArray(payload.choices) || Array.isArray(payload.tool_calls)) {
    return true;
  }

  const objectType = readString(payload.object);
  return objectType.startsWith('chat.completion') || objectType.startsWith('response.');
}

function hasDsmlToolMarkup(text: string): boolean {
  return /<\/?\s*\|\s*DSML\s*\|\s*(?:parameter|invoke|tool_calls)\s*>/i.test(text);
}

function validateCompletedAnthropicStream(body: Buffer): CompletedStreamValidation {
  const raw = body.toString('utf-8');
  if (hasDsmlToolMarkup(raw)) {
    return buildCompletedStreamFailure(
      'foreign_dsml_tool_markup',
      'upstream emitted non-Anthropic tool markup in Claude Code stream'
    );
  }

  const openBlocks = new Map<
    number,
    { type: string; inputJson: string; textLength: number; thinkingLength: number }
  >();
  let sawMessageStart = false;
  let sawMessageStop = false;
  let stopReason = '';
  let completedTextLength = 0;
  let completedToolBlocks = 0;
  let completedThinkingBlocks = 0;

  for (const block of parseSseBlocks(raw)) {
    if (!block.data || block.data === '[DONE]') {
      continue;
    }

    const payload = parseSseJsonRecord(block.data);
    if (!payload) {
      return buildCompletedStreamFailure(
        'malformed_sse_json',
        'upstream emitted malformed Anthropic SSE JSON'
      );
    }

    const payloadType = readString(payload.type);
    const eventType = payloadType || block.event || '';

    if (isForeignOpenAiLikeAnthropicPayload(payload, eventType)) {
      return buildCompletedStreamFailure(
        'foreign_openai_event',
        'upstream emitted OpenAI-style events in Claude Code stream'
      );
    }

    if (eventType === 'message_start') {
      sawMessageStart = true;
      continue;
    }

    if (eventType === 'content_block_start') {
      const index = readNumericIndex(payload.index);
      const contentBlock = asRecord(payload.content_block);
      const blockType = readString(contentBlock?.type);
      if (index === undefined || !blockType || openBlocks.has(index)) {
        return buildCompletedStreamFailure(
          'invalid_content_block_start',
          'upstream emitted invalid Anthropic content block start'
        );
      }

      openBlocks.set(index, {
        type: blockType,
        inputJson: '',
        textLength: readString(contentBlock?.text).length,
        thinkingLength: readString(contentBlock?.thinking).length,
      });
      continue;
    }

    if (eventType === 'content_block_delta') {
      const index = readNumericIndex(payload.index);
      const state = index === undefined ? undefined : openBlocks.get(index);
      const delta = asRecord(payload.delta);
      if (!state || !delta) {
        return buildCompletedStreamFailure(
          'unexpected_content_block_delta',
          'upstream emitted Anthropic content delta without an open block'
        );
      }

      const deltaType = readString(delta.type);
      if (state.type === 'text') {
        state.textLength += readString(delta.text).length;
      } else if (state.type === 'tool_use' && deltaType === 'input_json_delta') {
        state.inputJson += readString(delta.partial_json);
      } else if (state.type === 'thinking') {
        state.thinkingLength += readString(delta.thinking).length;
      }
      continue;
    }

    if (eventType === 'content_block_stop') {
      const index = readNumericIndex(payload.index);
      if (index === undefined) {
        return buildCompletedStreamFailure(
          'unexpected_content_block_stop',
          'upstream emitted Anthropic content block stop without an open block'
        );
      }

      const state = openBlocks.get(index);
      if (!state) {
        return buildCompletedStreamFailure(
          'unexpected_content_block_stop',
          'upstream emitted Anthropic content block stop without an open block'
        );
      }

      if (state.type === 'tool_use') {
        const inputJson = state.inputJson.trim();
        if (inputJson) {
          try {
            if (!asRecord(JSON.parse(inputJson))) {
              return buildCompletedStreamFailure(
                'malformed_tool_input_json',
                'upstream emitted a Claude tool_use with non-object input JSON'
              );
            }
          } catch {
            return buildCompletedStreamFailure(
              'malformed_tool_input_json',
              'upstream emitted an incomplete Claude tool_use input JSON stream'
            );
          }
        }
        completedToolBlocks += 1;
      } else if (state.type === 'thinking') {
        completedThinkingBlocks += 1;
      } else {
        completedTextLength += state.textLength;
      }

      openBlocks.delete(index);
      continue;
    }

    if (eventType === 'message_delta') {
      const delta = asRecord(payload.delta);
      const nextStopReason = readString(delta?.stop_reason);
      if (nextStopReason) {
        stopReason = nextStopReason;
      }
      continue;
    }

    if (eventType === 'message_stop') {
      sawMessageStop = true;
    }
  }

  if (!sawMessageStart) {
    return buildCompletedStreamFailure(
      'missing_message_start',
      'upstream ended Claude Code stream without message_start'
    );
  }

  if (!sawMessageStop) {
    return buildCompletedStreamFailure(
      'missing_message_stop',
      'upstream ended Claude Code stream without message_stop'
    );
  }

  if (openBlocks.size > 0) {
    return buildCompletedStreamFailure(
      'unclosed_content_block',
      'upstream ended Claude Code stream with an unclosed content block'
    );
  }

  if (stopReason === 'tool_use' && completedToolBlocks === 0) {
    return buildCompletedStreamFailure(
      'tool_use_stop_without_tool_block',
      'upstream ended Claude Code stream with tool_use stop_reason but no tool_use block'
    );
  }

  if (completedToolBlocks > 0 && stopReason && stopReason !== 'tool_use') {
    return buildCompletedStreamFailure(
      'tool_block_without_tool_use_stop',
      'upstream emitted Claude tool_use blocks without tool_use stop_reason'
    );
  }

  if (completedTextLength === 0 && completedToolBlocks === 0) {
    const reason = completedThinkingBlocks > 0 ? 'thinking_only_message' : 'empty_message';
    return buildCompletedStreamFailure(
      reason,
      'upstream ended Claude Code stream without assistant text or tool_use content'
    );
  }

  return { ok: true };
}

function validateCompletedStreamingBody(
  protocol: StreamingTerminalProtocol,
  body: Buffer
): CompletedStreamValidation {
  if (protocol === 'anthropic') {
    return validateCompletedAnthropicStream(body);
  }

  if (protocol === 'openaiChat') {
    return validateCompletedOpenAiChatStream(body);
  }

  if (protocol === 'openaiResponses') {
    return validateCompletedOpenAiResponsesStream(body);
  }

  return { ok: true };
}

function writeResponseChunk(res: http.ServerResponse, chunk: Buffer): Promise<void> {
  if (res.destroyed || res.writableEnded) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off('drain', onDrain);
      res.off('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    res.once('error', onError);

    try {
      if (res.write(chunk)) {
        cleanup();
        resolve();
        return;
      }
      res.once('drain', onDrain);
    } catch (error: unknown) {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function summarizeUpstreamFailureBodyForLog(body: Buffer, maxChars: number = 1200): string {
  const text = readUpstreamFailureBodyText(body);
  if (!text) {
    return '';
  }

  const summary =
    summarizeJsonFailureText(text) || summarizeHtmlFailureText(text) || normalizeLogLine(text);

  return truncateUpstreamFailureSummary(summary, maxChars);
}

export function isUpstreamQuotaExhaustionResponse(statusCode: number, body: Buffer): boolean {
  if (classifyRouteStatusCode(statusCode) !== 'failure') {
    return false;
  }

  const summary = summarizeUpstreamFailureBodyForLog(body, 4000);
  return UPSTREAM_QUOTA_EXHAUSTION_PATTERNS.some(pattern => pattern.test(summary));
}

function buildQuotaExhaustedRouteLogError(upstreamFailureSummary: string): string {
  return upstreamFailureSummary
    ? `${QUOTA_EXHAUSTED_ROUTE_LOG_MESSAGE}；上游错误：${upstreamFailureSummary}`
    : QUOTA_EXHAUSTED_ROUTE_LOG_MESSAGE;
}

function summarizeUpstreamFailureBodyRaw(body: Buffer, maxChars: number = 1200): string {
  return truncateUpstreamFailureSummary(readUpstreamFailureBodyText(body), maxChars);
}

function readUpstreamFailureBodyText(body: Buffer): string {
  if (!body.length) {
    return '';
  }

  const text = body.toString('utf-8').split('\u0000').join('').trim();
  if (!text) {
    return '';
  }

  return text;
}

function truncateUpstreamFailureSummary(value: string, maxChars: number): string {
  if (!value || value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)} ...(truncated ${value.length - maxChars} chars)`;
}

function summarizeJsonFailureText(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return '';
  }

  return summarizeJsonFailureValue(parsed);
}

function summarizeJsonFailureValue(value: unknown): string {
  if (typeof value === 'string') {
    return normalizeLogLine(value);
  }

  const record = asRecord(value);
  if (!record) {
    return '';
  }

  const error = record.error;
  const nestedError = asRecord(error);
  const source = nestedError || record;
  const stringError = typeof error === 'string' && error.trim() ? error.trim() : '';
  const message = firstStringValue(source, ['message', 'detail', 'reason', 'description']);
  const type =
    firstStringValue(source, ['type', 'code', 'error_code', 'errorCode']) ||
    (nestedError ? '' : stringError);
  const param = firstStringValue(source, ['param', 'parameter']);

  if (message) {
    const normalizedMessage = summarizeNestedJsonMessage(message);
    const lowerType = type.toLowerCase();
    const lowerMessage = normalizedMessage.toLowerCase();
    const prefix =
      type && lowerMessage !== lowerType && !lowerMessage.startsWith(`${lowerType}:`)
        ? `${type}: `
        : '';
    const suffix = param ? ` (${param})` : '';
    return normalizeLogLine(`${prefix}${normalizedMessage}${suffix}`);
  }

  if (stringError) {
    const topLevelMessage = firstStringValue(record, ['message', 'detail', 'reason']);
    const suffix = topLevelMessage ? `: ${summarizeNestedJsonMessage(topLevelMessage)}` : '';
    return normalizeLogLine(`${stringError}${suffix}`);
  }

  if (type) {
    return normalizeLogLine(type);
  }

  return '';
}

function summarizeNestedJsonMessage(message: string): string {
  const normalized = normalizeLogLine(message);
  if (!normalized.startsWith('{') && !normalized.startsWith('[')) {
    return normalized;
  }

  return summarizeJsonFailureText(normalized) || normalized;
}

function firstStringValue(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function summarizeHtmlFailureText(text: string): string {
  if (!/<[a-z][\s\S]*>/i.test(text)) {
    return '';
  }

  const title = decodeBasicHtmlEntities(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const body = decodeBasicHtmlEntities(
    text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );

  return normalizeLogLine(title || body);
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function normalizeLogLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function summarizeProbeLockUpstreamBody(body: Buffer): string | undefined {
  return summarizeUpstreamFailureBodyRaw(body, 2000) || undefined;
}

function buildRouteProxyErrorText(error: string, message: string): string {
  return JSON.stringify({ error, message });
}

function recordProbeLockFirstUpstreamResult(params: {
  routeApiKey: string;
  cliType: RouteCliType;
  lock: RouteProbeLock;
  success: boolean;
  statusCode?: number;
  body?: Buffer;
  error?: string;
  terminal?: boolean;
}): void {
  recordRouteProbeLockFirstUpstreamResult(
    {
      routeApiKey: params.routeApiKey,
      cliType: params.cliType,
      success: params.success,
      finishedAt: Date.now(),
      lock: params.lock,
      ...(params.statusCode !== undefined ? { statusCode: params.statusCode } : {}),
      ...(params.body ? { responseSummary: summarizeProbeLockUpstreamBody(params.body) } : {}),
      ...(params.error ? { error: params.error } : {}),
    },
    { terminal: params.terminal ?? true }
  );
}

function notifyProbeLockTerminalFailure(params: {
  routeApiKey: string;
  cliType: RouteCliType;
  terminalError: string;
  statusCode?: number;
  lock?: RouteProbeLock | null;
}): void {
  notifyRouteProbeLockTerminalFailure({
    routeApiKey: params.routeApiKey,
    cliType: params.cliType,
    terminalError: params.terminalError,
    ...(params.statusCode !== undefined ? { statusCode: params.statusCode } : {}),
    ...(params.lock ? { lock: params.lock } : {}),
  });
}

function writeProbeLockTerminalFailureResponse(
  res: http.ServerResponse,
  failure: RouteProbeLockTerminalFailure
): void {
  const body =
    failure.terminalError.trim() ||
    buildRouteProxyErrorText('all_channels_failed', 'CLI probe aborted');
  const contentType =
    body.startsWith('{') || body.startsWith('[')
      ? 'application/json; charset=utf-8'
      : 'text/plain; charset=utf-8';
  res.writeHead(failure.statusCode ?? 502, { 'Content-Type': contentType });
  res.end(body);
}

function buildProbeLockUpstreamAttemptExhaustedErrorText(): string {
  return buildRouteProxyErrorText(
    PROBE_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_ERROR_CODE,
    'CLI probe-lock upstream attempt budget exhausted'
  );
}

// 瞬时(可重试)上游状态：网关抖动/限流/超时，不应被当作 CLI 终结失败。
const TRANSIENT_UPSTREAM_STATUS_CODES = new Set([
  408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 529, 530,
]);

type UpstreamAuthScheme = 'native' | 'bearer';
const SENSENOVA_UPSTREAM_HOST = 'token.sensenova.cn';

function resolveUpstreamAuthScheme(targetBaseUrl: string): UpstreamAuthScheme {
  return new URL(targetBaseUrl).hostname.toLowerCase() === SENSENOVA_UPSTREAM_HOST
    ? 'bearer'
    : 'native';
}

export function isTransientUpstreamStatus(statusCode?: number): boolean {
  return typeof statusCode === 'number' && TRANSIENT_UPSTREAM_STATUS_CODES.has(statusCode);
}

export function buildUpstreamHeaders(
  incomingHeaders: http.IncomingHttpHeaders,
  targetHost: string,
  bodyLength: number,
  apiKey: string,
  cliType: RouteCliType,
  authScheme: UpstreamAuthScheme = 'native'
): Record<string, string | string[] | undefined> {
  const forwardHeaders: Record<string, string | string[] | undefined> = {
    ...incomingHeaders,
    host: targetHost,
    'content-length': String(bodyLength),
  };

  deleteAuthHeaders(forwardHeaders);
  for (const headerName of Object.keys(forwardHeaders)) {
    const normalizedHeaderName = headerName.toLowerCase();
    if (
      normalizedHeaderName === ROUTE_CLI_MARKER_HEADER ||
      normalizedHeaderName.startsWith('x-grok-')
    ) {
      delete forwardHeaders[headerName];
    }
  }

  if (authScheme === 'bearer') {
    forwardHeaders.authorization = `Bearer ${apiKey}`;
  } else if (cliType === 'claudeCode') {
    forwardHeaders['x-api-key'] = apiKey;
  } else if (cliType === 'codex' || cliType === 'openCode') {
    forwardHeaders.authorization = `Bearer ${apiKey}`;
  }

  return forwardHeaders;
}

export function buildUpstreamRequestUrl(
  targetBaseUrl: string,
  requestUrl: string | undefined,
  cliType: RouteCliType,
  upstreamModel: string | undefined,
  apiKey: string
): { url: string; host: string } {
  const target = new URL(targetBaseUrl);
  void cliType;
  void upstreamModel;
  void apiKey;
  const targetPath = requestUrl || '/';
  const upstreamUrl = new URL(targetPath, `${target.protocol}//${target.host}`);

  return {
    url: upstreamUrl.toString(),
    host: target.host,
  };
}

export interface RouteUsageStats {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cachedTokens?: number;
}

const USAGE_SOURCE_KEYS = [
  'prompt_tokens',
  'promptTokens',
  'input_tokens',
  'inputTokens',
  'promptTokenCount',
  'inputTokenCount',
  'completion_tokens',
  'completionTokens',
  'output_tokens',
  'outputTokens',
  'candidatesTokenCount',
  'responseTokenCount',
  'total_tokens',
  'totalTokens',
  'totalTokenCount',
  'cache_creation_input_tokens',
  'cacheCreationInputTokens',
  'cache_creation',
  'cacheCreation',
  'claude_cache_creation_5_m_tokens',
  'claude_cache_creation_1_h_tokens',
  'cache_read_input_tokens',
  'cacheReadInputTokens',
  'cached_tokens',
  'cachedTokens',
  'cachedContentTokenCount',
] as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

export function extractRouteReasoningEffort(bodyJson: unknown): string | undefined {
  const body = asRecord(bodyJson);
  if (!body) return undefined;

  const outputConfig = asRecord(body.output_config);
  const reasoning = asRecord(body.reasoning);
  const explicitEffortCandidates = [
    outputConfig?.effort,
    reasoning?.effort,
    body.reasoning_effort,
    body.reasoningEffort,
  ];

  for (const candidate of explicitEffortCandidates) {
    const effort = readString(candidate).trim();
    if (effort) return effort;
  }

  const thinking = asRecord(body.thinking);
  const thinkingType = readString(thinking?.type).trim().toLowerCase();
  const thinkingEnabled = thinkingType === 'enabled' || thinkingType === 'adaptive';
  if (!thinkingEnabled) return undefined;

  const budgetTokens = toFiniteTokenNumber(thinking?.budget_tokens ?? thinking?.budgetTokens);
  return budgetTokens !== undefined && budgetTokens > 0 ? `${budgetTokens} tokens` : '开启';
}

export interface ClaudeCountTokensEstimate {
  input_tokens: number;
  estimated: true;
  method: 'local';
}

function estimateTextTokens(text: string): number {
  let total = 0;
  let asciiRunLength = 0;

  const flushAsciiRun = () => {
    if (asciiRunLength > 0) {
      total += Math.ceil(asciiRunLength / 4);
      asciiRunLength = 0;
    }
  };

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f && /[A-Za-z0-9_]/.test(char)) {
      asciiRunLength += 1;
      continue;
    }

    flushAsciiRun();
    if (/\s/.test(char)) {
      total += 0.25;
    } else if (code >= 0x2e80) {
      total += 1;
    } else {
      total += 0.5;
    }
  }

  flushAsciiRun();
  return Math.ceil(total);
}

function estimateJsonTokens(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }

  if (typeof value === 'string') {
    return estimateTextTokens(value);
  }

  try {
    return estimateTextTokens(JSON.stringify(value));
  } catch {
    return estimateTextTokens(String(value));
  }
}

function estimateClaudeContentTokens(content: unknown): number {
  if (typeof content === 'string') {
    return estimateTextTokens(content);
  }

  if (Array.isArray(content)) {
    return content.reduce((total, block) => {
      const record = asRecord(block);
      if (!record) {
        return total + estimateJsonTokens(block);
      }

      const type = typeof record.type === 'string' ? record.type : '';
      if (type === 'text') {
        return total + estimateJsonTokens(record.text);
      }
      if (type === 'image') {
        return total + LOCAL_COUNT_TOKENS_IMAGE_ESTIMATE + estimateJsonTokens(record.source);
      }
      if (type === 'document') {
        return total + LOCAL_COUNT_TOKENS_DOCUMENT_ESTIMATE + estimateJsonTokens(record.source);
      }
      if (type === 'tool_use') {
        return total + estimateJsonTokens(record.name) + estimateJsonTokens(record.input);
      }
      if (type === 'tool_result') {
        return total + estimateClaudeContentTokens(record.content);
      }
      if (type === 'thinking') {
        return total + estimateJsonTokens(record.thinking);
      }

      return total + estimateJsonTokens(record);
    }, 0);
  }

  return estimateJsonTokens(content);
}

export function estimateClaudeCountTokens(body: Buffer): ClaudeCountTokensEstimate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf-8'));
  } catch {
    return {
      input_tokens: Math.max(1, estimateTextTokens(body.toString('utf-8'))),
      estimated: true,
      method: 'local',
    };
  }

  const request = asRecord(parsed);
  if (!request) {
    return {
      input_tokens: Math.max(1, estimateJsonTokens(parsed)),
      estimated: true,
      method: 'local',
    };
  }

  let total = 0;
  total += estimateClaudeContentTokens(request.system);
  total += estimateClaudeContentTokens(request.input);
  total += estimateClaudeContentTokens(request.instructions);
  total += estimateJsonTokens(request.thinking);
  total += estimateJsonTokens(request.reasoning);
  total += estimateJsonTokens(request.text);
  total += estimateJsonTokens(request.tool_choice);
  total += estimateJsonTokens(request.output_config);

  const messages = Array.isArray(request.messages) ? request.messages : [];
  for (const message of messages) {
    const record = asRecord(message);
    total += LOCAL_COUNT_TOKENS_MESSAGE_OVERHEAD;
    total += estimateJsonTokens(record?.role);
    total += estimateClaudeContentTokens(record?.content ?? message);
  }

  const tools = Array.isArray(request.tools) ? request.tools : [];
  for (const tool of tools) {
    const record = asRecord(tool);
    if (!record) {
      total += estimateJsonTokens(tool);
      continue;
    }
    total += estimateJsonTokens(record.type);
    const fn = asRecord(record.function);
    if (fn) {
      total += estimateJsonTokens(fn);
    } else {
      total += estimateJsonTokens(record.name);
      total += estimateJsonTokens(record.description);
      total += estimateJsonTokens(record.input_schema);
      total += estimateJsonTokens(record.parameters);
    }
  }

  return {
    input_tokens: Math.max(1, Math.ceil(total * LOCAL_COUNT_TOKENS_CONSERVATIVE_MULTIPLIER)),
    estimated: true,
    method: 'local',
  };
}

function toFiniteTokenNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function firstTokenNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = toFiniteTokenNumber(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function sumTokenNumbers(...values: unknown[]): number | undefined {
  let total = 0;
  let found = false;
  for (const value of values) {
    const parsed = toFiniteTokenNumber(value);
    if (parsed !== undefined) {
      total += parsed;
      found = true;
    }
  }

  return found ? total : undefined;
}

function hasUsageSourceKeys(record: Record<string, unknown>): boolean {
  return USAGE_SOURCE_KEYS.some(key => key in record);
}

function sumTokenObjectValues(value: unknown): number | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  let total = 0;
  let found = false;
  for (const [key, rawValue] of Object.entries(record)) {
    if (!key.endsWith('_input_tokens') && !key.endsWith('InputTokens')) {
      continue;
    }

    const numeric = toFiniteTokenNumber(rawValue);
    if (numeric !== undefined) {
      total += numeric;
      found = true;
    }
  }

  return found ? total : undefined;
}

function hasRouteUsageValues(usage: RouteUsageStats | undefined): usage is RouteUsageStats {
  if (!usage) {
    return false;
  }

  return (
    usage.promptTokens !== undefined ||
    usage.completionTokens !== undefined ||
    usage.totalTokens !== undefined ||
    usage.cacheCreationTokens !== undefined ||
    usage.cacheReadTokens !== undefined ||
    usage.cachedTokens !== undefined
  );
}

function isAllZeroRouteUsage(usage: RouteUsageStats | undefined): usage is RouteUsageStats {
  if (!hasRouteUsageValues(usage)) {
    return false;
  }

  return [
    usage.promptTokens,
    usage.completionTokens,
    usage.totalTokens,
    usage.cacheCreationTokens,
    usage.cacheReadTokens,
    usage.cachedTokens,
  ].every(value => value === undefined || value === 0);
}

function mergeRouteUsage(
  current: RouteUsageStats | undefined,
  next: RouteUsageStats | undefined
): RouteUsageStats | undefined {
  if (!hasRouteUsageValues(next)) {
    return current;
  }

  const merged: RouteUsageStats = { ...(current || {}) };
  for (const key of [
    'promptTokens',
    'completionTokens',
    'totalTokens',
    'cacheCreationTokens',
    'cacheReadTokens',
    'cachedTokens',
  ] as const) {
    if (next[key] !== undefined) {
      merged[key] = next[key];
    }
  }

  return merged;
}

function finalizeRouteUsage(usage: RouteUsageStats | undefined): RouteUsageStats | undefined {
  if (!hasRouteUsageValues(usage)) {
    return undefined;
  }

  if (usage.totalTokens !== undefined) {
    return usage;
  }

  const hasAnyTokenValue =
    usage.promptTokens !== undefined ||
    usage.completionTokens !== undefined ||
    usage.cacheCreationTokens !== undefined ||
    usage.cacheReadTokens !== undefined;
  if (!hasAnyTokenValue) {
    return usage;
  }

  const cacheReadAddsToAnthropicInput =
    usage.cacheReadTokens !== undefined && usage.cachedTokens === undefined;
  return {
    ...usage,
    totalTokens:
      (usage.promptTokens || 0) +
      (usage.completionTokens || 0) +
      (usage.cacheCreationTokens || 0) +
      (cacheReadAddsToAnthropicInput ? usage.cacheReadTokens || 0 : 0),
  };
}

function normalizeUsageSource(source: Record<string, unknown>): RouteUsageStats | undefined {
  if (!hasUsageSourceKeys(source)) {
    return undefined;
  }

  const promptDetails =
    asRecord(source.prompt_tokens_details) ||
    asRecord(source.promptTokensDetails) ||
    asRecord(source.input_tokens_details) ||
    asRecord(source.inputTokensDetails) ||
    asRecord(source.input_token_details) ||
    asRecord(source.inputTokenDetails);
  const declaredCacheCreationTokens = firstTokenNumber(
    source.cache_creation_input_tokens,
    source.cacheCreationInputTokens
  );
  const cacheCreationBreakdownTokens = firstTokenNumber(
    sumTokenNumbers(
      source.claude_cache_creation_5_m_tokens,
      source.claude_cache_creation_1_h_tokens
    ),
    sumTokenObjectValues(source.cache_creation),
    sumTokenObjectValues(source.cacheCreation)
  );
  const cacheCreationTokens =
    declaredCacheCreationTokens !== undefined && declaredCacheCreationTokens > 0
      ? declaredCacheCreationTokens
      : firstTokenNumber(cacheCreationBreakdownTokens, declaredCacheCreationTokens);
  const cachedTokens = firstTokenNumber(
    source.cached_tokens,
    source.cachedTokens,
    source.cachedContentTokenCount,
    source.cached_content_token_count,
    promptDetails?.cached_tokens,
    promptDetails?.cachedTokens
  );
  const anthropicCacheReadTokens = firstTokenNumber(
    source.cache_read_input_tokens,
    source.cacheReadInputTokens
  );

  return {
    promptTokens: firstTokenNumber(
      source.prompt_tokens,
      source.promptTokens,
      source.input_tokens,
      source.inputTokens,
      source.promptTokenCount,
      source.inputTokenCount
    ),
    completionTokens: firstTokenNumber(
      source.completion_tokens,
      source.completionTokens,
      source.output_tokens,
      source.outputTokens,
      source.candidatesTokenCount,
      source.responseTokenCount
    ),
    totalTokens: firstTokenNumber(source.total_tokens, source.totalTokens, source.totalTokenCount),
    cacheCreationTokens,
    cacheReadTokens: firstTokenNumber(anthropicCacheReadTokens, cachedTokens),
    cachedTokens,
  };
}

function extractUsageFromParsed(value: unknown, depth = 0): RouteUsageStats | undefined {
  if (depth > 3) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.reduce<RouteUsageStats | undefined>(
      (current, item) => mergeRouteUsage(current, extractUsageFromParsed(item, depth + 1)),
      undefined
    );
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  let usage = mergeRouteUsage(
    undefined,
    normalizeUsageSource(asRecord(record.usage) || asRecord(record.usageMetadata) || record)
  );

  for (const key of ['message', 'response', 'delta', 'data', 'event'] as const) {
    usage = mergeRouteUsage(usage, extractUsageFromParsed(record[key], depth + 1));
  }

  return usage;
}

function extractUsageFromSseBody(bodyStr: string): RouteUsageStats | undefined {
  let usage: RouteUsageStats | undefined;

  for (const line of bodyStr.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) {
      continue;
    }

    const payload = trimmed.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') {
      continue;
    }

    try {
      usage = mergeRouteUsage(usage, extractUsageFromParsed(JSON.parse(payload)));
    } catch {
      /* ignore malformed stream chunk */
    }
  }

  return finalizeRouteUsage(usage);
}

export function extractUsageFromBody(body: Buffer): RouteUsageStats | undefined {
  const bodyStr = body.toString('utf-8');

  try {
    return finalizeRouteUsage(extractUsageFromParsed(JSON.parse(bodyStr)));
  } catch {
    return extractUsageFromSseBody(bodyStr);
  }
}

function isUnsupportedTokenCountResponse(result: { statusCode: number; body: Buffer }): boolean {
  if ([404, 405, 501].includes(result.statusCode)) {
    return true;
  }

  if (result.statusCode !== 403) {
    return false;
  }

  const body = summarizeUpstreamFailureBodyForLog(result.body, 800).toLowerCase();
  return (
    body.includes('count_tokens') ||
    body.includes('count tokens') ||
    body.includes('not enabled') ||
    body.includes('not supported') ||
    body.includes('unsupported') ||
    body.includes('not implemented') ||
    body.includes('invalid url')
  );
}

function writeInputTokensEstimate(
  res: http.ServerResponse,
  estimate: ClaudeCountTokensEstimate
): void {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    [LOCAL_TOKEN_ESTIMATE_HEADER]: 'local-approximate',
  });
  res.end(JSON.stringify({ input_tokens: estimate.input_tokens }));
}

interface ForwardToUpstreamOptions {
  upstreamProxyUrl?: string;
  additionalHeaders?: Record<string, string>;
  methodOverride?: string;
  requestUrlOverride?: string;
  upstreamCliType?: RouteCliType;
  signal?: AbortSignal;
  streamResponse?: http.ServerResponse;
  streamResponseBody?: boolean;
  nativeResponsePassthrough?: boolean;
  streamIdleTimeoutMs?: number;
}

/** 转发请求到上游（不直接写 res，返回结果由调用者决定是否透传） */
async function forwardToUpstream(
  req: http.IncomingMessage,
  targetBaseUrl: string,
  apiKey: string,
  bodyBuffer: Buffer,
  cliType: RouteCliType,
  timeoutMs: number,
  upstreamModel?: string,
  options: ForwardToUpstreamOptions = {}
): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  latencyMs: number;
  firstByteLatencyMs?: number;
  usage?: RouteUsageStats;
  streamed?: boolean;
  semanticError?: typeof EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE;
}> {
  const startTime = Date.now();
  const upstreamCliType = options.upstreamCliType ?? cliType;
  const requestUrl = options.requestUrlOverride ?? req.url;
  const target = buildUpstreamRequestUrl(
    targetBaseUrl,
    requestUrl,
    upstreamCliType,
    upstreamModel,
    apiKey
  );
  const forwardHeaders = buildUpstreamHeaders(
    req.headers,
    target.host,
    bodyBuffer.length,
    apiKey,
    upstreamCliType,
    resolveUpstreamAuthScheme(targetBaseUrl)
  );

  // 合并额外的请求头（如 AnyRouter 改写添加的 anthropic-beta）
  if (options.additionalHeaders) {
    Object.assign(forwardHeaders, options.additionalHeaders);
  }

  const requestConfig = {
    method: options.methodOverride ?? req.method ?? 'GET',
    headers: compactHeaders(forwardHeaders),
    body: bodyBuffer,
    timeout: timeoutMs,
    proxyUrl: options.upstreamProxyUrl,
    preferElectronNet: true,
    signal: options.signal,
  };

  let streamed = false;
  let streamingStatusCode: number | undefined;
  let streamingHeaders: http.OutgoingHttpHeaders | undefined;
  let streamingRejectedBeforeBody: string | undefined;
  let initialStreamingBuffer = Buffer.alloc(0);
  let pendingStreamingChunks: Buffer[] = [];
  const receivedStreamingChunks: Buffer[] = [];
  const streamingTerminalProtocol = getStreamingTerminalProtocol(cliType, requestUrl);
  const anthropicStreamNormalizer =
    !options.nativeResponsePassthrough && streamingTerminalProtocol === 'anthropic'
      ? createAnthropicSseCompatibilityNormalizer()
      : null;
  const nativeAnthropicStreamGuard =
    options.nativeResponsePassthrough && streamingTerminalProtocol === 'anthropic'
      ? createNativeAnthropicSseGuard()
      : null;
  const streamingObservation = createStreamingSseObservationState(streamingTerminalProtocol);
  let streamingTerminalScanText = '';
  let streamingTerminalSeen = streamingTerminalProtocol === 'none';
  let streamingCompletionValidated = false;
  let streamingSemanticError: typeof EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE | undefined;
  const inspectNativeOpenAiResponsesBeforeCommit =
    options.nativeResponsePassthrough && streamingTerminalProtocol === 'openaiResponses';

  const writeStreamingError = async (message: string): Promise<void> => {
    if (
      !streamed ||
      streamingObservation.errorSeen ||
      options.streamResponse?.writableEnded ||
      options.streamResponse?.destroyed
    ) {
      return;
    }

    streamingObservation.errorSeen = true;
    streamingObservation.terminalSeen = true;
    streamingTerminalSeen = true;
    await writeResponseChunk(
      options.streamResponse!,
      buildStreamingErrorChunk(
        streamingTerminalProtocol,
        message,
        streamingObservation.nextSequenceNumber
      )
    );
  };

  const processStreamingOutgoingChunk = async (outgoingChunk: Buffer): Promise<void> => {
    if (!streamingStatusCode || !streamingHeaders || !outgoingChunk.length) return;
    observeStreamingSseChunk(streamingObservation, streamingTerminalProtocol, outgoingChunk);
    streamingTerminalSeen = streamingTerminalSeen || streamingObservation.terminalSeen;
    if (
      !options.nativeResponsePassthrough ||
      (inspectNativeOpenAiResponsesBeforeCommit && !streamed)
    ) {
      receivedStreamingChunks.push(outgoingChunk);
    }

    let nativeOpenAiInspection: OpenAiResponsesStreamInspection | undefined;
    let nativeOpenAiTerminalParsed = false;
    let nativeOpenAiPrecommitBytes = 0;
    if (inspectNativeOpenAiResponsesBeforeCommit && !streamed) {
      const terminalScan = appendStreamingTerminalScanText(
        streamingTerminalProtocol,
        streamingTerminalScanText,
        outgoingChunk
      );
      streamingTerminalScanText = terminalScan.text;
      streamingTerminalSeen = streamingTerminalSeen || terminalScan.terminalSeen;
      const receivedStreamingBody = Buffer.concat(receivedStreamingChunks);
      nativeOpenAiPrecommitBytes = receivedStreamingBody.length;
      nativeOpenAiInspection = inspectOpenAiResponsesStream(receivedStreamingBody);
      nativeOpenAiTerminalParsed =
        nativeOpenAiInspection.sawFinished ||
        nativeOpenAiInspection.sawDone ||
        nativeOpenAiInspection.sawFailure;
      if (
        nativeOpenAiTerminalParsed &&
        !nativeOpenAiInspection.sawFailure &&
        nativeOpenAiInspection.explicitZeroUsage &&
        !hasOpenAiResponsesStreamOutput(nativeOpenAiInspection)
      ) {
        streamingSemanticError = EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE;
      }
    }

    if (
      !options.nativeResponsePassthrough &&
      streamingTerminalProtocol === 'anthropic' &&
      !streamingTerminalSeen
    ) {
      const terminalScan = appendStreamingTerminalScanText(
        streamingTerminalProtocol,
        streamingTerminalScanText,
        outgoingChunk
      );
      streamingTerminalScanText = terminalScan.text;
      if (terminalScan.terminalSeen) {
        const receivedBody = Buffer.concat(receivedStreamingChunks);
        if (hasAnthropicMessageStop(receivedBody)) {
          streamingTerminalSeen = true;
          const completedValidation = validateCompletedStreamingBody(
            streamingTerminalProtocol,
            receivedBody
          );
          if (!completedValidation.ok) {
            if (streamed) {
              await writeStreamingError(completedValidation.message);
            }
            throw new Error(`malformed_streaming_response:${completedValidation.reason}`);
          }
          streamingCompletionValidated = true;
        }
      }
    } else if (
      !options.nativeResponsePassthrough &&
      streamingTerminalProtocol !== 'none' &&
      !streamingCompletionValidated
    ) {
      const terminalScan = appendStreamingTerminalScanText(
        streamingTerminalProtocol,
        streamingTerminalScanText,
        outgoingChunk
      );
      streamingTerminalScanText = terminalScan.text;
      streamingTerminalSeen = streamingTerminalSeen || terminalScan.terminalSeen;
      if (streamingTerminalSeen) {
        const completedValidation = validateCompletedStreamingBody(
          streamingTerminalProtocol,
          Buffer.concat(receivedStreamingChunks)
        );
        if (completedValidation.ok) {
          streamingTerminalSeen = true;
          streamingCompletionValidated = true;
        }
      }
    }

    if (!streamed) {
      pendingStreamingChunks.push(outgoingChunk);
      initialStreamingBuffer = Buffer.concat([
        initialStreamingBuffer,
        outgoingChunk.subarray(
          0,
          Math.max(0, INITIAL_STREAM_VALIDATION_MAX_BYTES + 1 - initialStreamingBuffer.length)
        ),
      ]);
      const validation = validateInitialEventStreamChunk(initialStreamingBuffer);
      if (validation.status === 'rejected') {
        throw new Error(`invalid_streaming_response:${validation.reason}`);
      }
      if (validation.status === 'pending') {
        return;
      }

      if (inspectNativeOpenAiResponsesBeforeCommit) {
        if (streamingSemanticError) {
          return;
        }
        const hasOutput = nativeOpenAiInspection
          ? hasOpenAiResponsesStreamOutput(nativeOpenAiInspection)
          : false;
        if (
          !hasOutput &&
          !nativeOpenAiTerminalParsed &&
          nativeOpenAiPrecommitBytes <= NATIVE_OPENAI_RESPONSES_SSE_MAX_PRECOMMIT_BYTES
        ) {
          return;
        }
      }

      streamed = true;
      options.streamResponse!.writeHead(streamingStatusCode, streamingHeaders);
      const chunksToWrite = pendingStreamingChunks;
      pendingStreamingChunks = [];
      for (const pendingChunk of chunksToWrite) {
        await writeResponseChunk(options.streamResponse!, pendingChunk);
      }
      return;
    }

    await writeResponseChunk(options.streamResponse!, outgoingChunk);
  };

  let response: Awaited<ReturnType<typeof httpRawRequest>>;
  try {
    response =
      options.streamResponse && options.streamResponseBody
        ? await httpRawStreamRequest(target.url, {
            ...requestConfig,
            onResponse: upstreamResponse => {
              const statusCode = upstreamResponse.status || 500;
              if (classifyRouteStatusCode(statusCode) !== 'success') return false;
              if (!isEventStreamResponse(upstreamResponse.headers)) {
                streamingRejectedBeforeBody = 'unexpected_content_type';
                return false;
              }

              streamingStatusCode = statusCode;
              streamingHeaders = buildStreamingResponseHeaders(upstreamResponse.headers);
              return true;
            },
            onChunk: async chunk => {
              if (!streamingStatusCode || !streamingHeaders) return;
              try {
                const outgoingChunks = nativeAnthropicStreamGuard
                  ? processNativeAnthropicSseGuardChunk(nativeAnthropicStreamGuard, chunk)
                  : [
                      anthropicStreamNormalizer
                        ? normalizeAnthropicSseCompatibilityChunk(anthropicStreamNormalizer, chunk)
                        : chunk,
                    ];
                for (const outgoingChunk of outgoingChunks) {
                  await processStreamingOutgoingChunk(outgoingChunk);
                }
              } catch (error: unknown) {
                if (streamed && error instanceof NativeAnthropicSseGuardError) {
                  await writeStreamingError(readStreamingValidationMessage(error));
                }
                throw error;
              }
            },
            streamIdleTimeout: options.streamIdleTimeoutMs,
            shouldResolveOnAbort: () =>
              !options.nativeResponsePassthrough && streamed && streamingCompletionValidated,
          })
        : await httpRawRequest(target.url, requestConfig);
  } catch (error: unknown) {
    observeStreamingSseChunk(
      streamingObservation,
      streamingTerminalProtocol,
      Buffer.alloc(0),
      true
    );
    streamingTerminalSeen = streamingTerminalSeen || streamingObservation.terminalSeen;
    if (
      streamed &&
      !options.signal?.aborted &&
      !streamingObservation.errorSeen &&
      !streamingObservation.terminalSeen
    ) {
      await writeStreamingError('upstream stream terminated unexpectedly');
    }
    throw error;
  }

  if (options.streamResponse && options.streamResponseBody && anthropicStreamNormalizer) {
    await processStreamingOutgoingChunk(
      flushAnthropicSseCompatibilityNormalizer(anthropicStreamNormalizer)
    );
  }

  if (options.streamResponse && options.streamResponseBody && nativeAnthropicStreamGuard) {
    try {
      for (const outgoingChunk of flushNativeAnthropicSseGuard(nativeAnthropicStreamGuard)) {
        await processStreamingOutgoingChunk(outgoingChunk);
      }
    } catch (error: unknown) {
      if (streamed && error instanceof NativeAnthropicSseGuardError) {
        await writeStreamingError(readStreamingValidationMessage(error));
      }
      throw error;
    }
  }

  if (
    options.streamResponse &&
    options.streamResponseBody &&
    classifyRouteStatusCode(response.status || 500) === 'success' &&
    !streamed
  ) {
    if (streamingRejectedBeforeBody) {
      throw new Error(`invalid_streaming_response:${streamingRejectedBeforeBody}`);
    }

    const validation = validateInitialEventStreamChunk(response.body);
    if (validation.status !== 'accepted') {
      const reason =
        validation.status === 'rejected'
          ? validation.reason
          : response.body.length
            ? 'malformed_sse_response'
            : 'empty_streaming_response';
      throw new Error(`invalid_streaming_response:${reason}`);
    }
  }

  const completedStreamingBody = options.nativeResponsePassthrough
    ? response.body
    : Buffer.concat(receivedStreamingChunks);
  observeStreamingSseChunk(streamingObservation, streamingTerminalProtocol, Buffer.alloc(0), true);
  streamingTerminalSeen = streamingTerminalSeen || streamingObservation.terminalSeen;
  const upstreamStreamingFailureCode = findUpstreamStreamingFailureCode(completedStreamingBody);

  if (
    options.streamResponse &&
    options.streamResponseBody &&
    streamed &&
    upstreamStreamingFailureCode
  ) {
    throw new Error(`upstream_streaming_error:${upstreamStreamingFailureCode}`);
  }

  if (
    options.streamResponse &&
    options.streamResponseBody &&
    streamed &&
    streamingTerminalProtocol !== 'none' &&
    !streamingTerminalSeen &&
    !streamingObservation.errorSeen
  ) {
    await writeStreamingError('upstream stream ended before terminal SSE event');
    throw new Error('incomplete_streaming_response:missing_terminal_event');
  }

  if (
    options.streamResponse &&
    options.streamResponseBody &&
    !options.nativeResponsePassthrough &&
    streamed
  ) {
    const completedValidation = validateCompletedStreamingBody(
      streamingTerminalProtocol,
      completedStreamingBody
    );
    if (!completedValidation.ok) {
      await writeStreamingError(completedValidation.message);
      throw new Error(`malformed_streaming_response:${completedValidation.reason}`);
    }
  }

  return {
    statusCode: response.status || 500,
    headers: response.headers,
    body: response.body,
    latencyMs: Date.now() - startTime,
    firstByteLatencyMs: response.firstByteLatencyMs,
    usage: extractUsageFromBody(response.body),
    streamed,
    semanticError: streamingSemanticError,
  };
}

function hasEnabledRoutePath(channels: ResolvedChannel[]): boolean {
  return channels.some(channel => !isRoutePathDisabled(channel));
}

function areAllRoutePathsDisabled(channels: ResolvedChannel[]): boolean {
  return channels.length > 0 && channels.every(channel => isRoutePathDisabled(channel));
}

function buildAllRoutePathsDisabledErrorBody(cliType: RouteCliType): unknown {
  if (cliType === 'claudeCode') {
    return {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: ALL_ROUTE_PATHS_DISABLED_MESSAGE,
      },
    };
  }

  return {
    error: {
      message: ALL_ROUTE_PATHS_DISABLED_MESSAGE,
      type: 'invalid_request_error',
      param: null,
      code: ALL_ROUTE_PATHS_DISABLED_ERROR_CODE,
    },
  };
}

function writeAllRoutePathsDisabledResponse(res: http.ServerResponse, cliType: RouteCliType): void {
  res.writeHead(ALL_ROUTE_PATHS_DISABLED_STATUS_CODE, {
    'Content-Type': 'application/json',
    'X-Route-Proxy-Error': ALL_ROUTE_PATHS_DISABLED_ERROR_CODE,
  });
  res.end(JSON.stringify(buildAllRoutePathsDisabledErrorBody(cliType)));
}

function buildUpstreamTemporarilyUnavailableErrorBody(cliType: RouteCliType): unknown {
  if (cliType === 'claudeCode') {
    return {
      type: 'error',
      error: {
        type: 'overloaded_error',
        message: UPSTREAM_TEMPORARILY_UNAVAILABLE_MESSAGE,
      },
    };
  }

  return {
    error: {
      message: UPSTREAM_TEMPORARILY_UNAVAILABLE_MESSAGE,
      type: 'server_error',
      param: null,
      code: UPSTREAM_TEMPORARILY_UNAVAILABLE_ERROR_CODE,
    },
  };
}

function writeUpstreamTemporarilyUnavailableResponse(
  res: http.ServerResponse,
  cliType: RouteCliType
): void {
  res.writeHead(UPSTREAM_TEMPORARILY_UNAVAILABLE_STATUS_CODE, {
    'Content-Type': 'application/json',
    'X-Route-Proxy-Error': UPSTREAM_TEMPORARILY_UNAVAILABLE_ERROR_CODE,
  });
  res.end(JSON.stringify(buildUpstreamTemporarilyUnavailableErrorBody(cliType)));
}

export async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const requestSelectionStartedAt = Date.now();
  const recordRequestForSelection = (params: Parameters<typeof recordRouteRequest>[0]): void => {
    recordRouteRequest({ ...params, requestSelectionStartedAt });
  };
  const recordPathOutcomeForSelection = (
    key: Parameters<typeof recordRoutePathOutcome>[0],
    outcome: Parameters<typeof recordRoutePathOutcome>[1],
    meta: Parameters<typeof recordRoutePathOutcome>[2],
    nowOrRuntimeConfig?: Parameters<typeof recordRoutePathOutcome>[3],
    runtimeConfig?: Parameters<typeof recordRoutePathOutcome>[4]
  ): ReturnType<typeof recordRoutePathOutcome> => {
    const nextMeta = { ...(meta ?? {}), requestSelectionStartedAt };
    if (nowOrRuntimeConfig === undefined) {
      return recordRoutePathOutcome(key, outcome, nextMeta);
    }
    return runtimeConfig === undefined
      ? recordRoutePathOutcome(key, outcome, nextMeta, nowOrRuntimeConfig)
      : recordRoutePathOutcome(key, outcome, nextMeta, nowOrRuntimeConfig, runtimeConfig);
  };
  const routeAbortController = new AbortController();
  let requestBodyRead = false;
  let routeHandlingDone = false;
  let cleanupRouteCancellationListeners = () => {};
  const finishRouteHandling = () => {
    routeHandlingDone = true;
    cleanupRouteCancellationListeners();
  };
  const cancelRouteRequest = () => {
    if (routeHandlingDone || !requestBodyRead || routeAbortController.signal.aborted) {
      return;
    }
    routeAbortController.abort(createRouteClientCancelledError());
  };
  const handleResponseClose = () => {
    if (res.writableEnded) {
      finishRouteHandling();
      return;
    }
    cancelRouteRequest();
  };
  cleanupRouteCancellationListeners = () => {
    res.off('close', handleResponseClose);
    res.off('finish', finishRouteHandling);
    req.off('aborted', cancelRouteRequest);
  };
  res.once('close', handleResponseClose);
  res.once('finish', finishRouteHandling);
  req.on('aborted', cancelRouteRequest);

  const routing = unifiedConfigManager.getRoutingConfig();

  const pathname = getRequestPathname(req.url);
  const endpointOperation = classifyRouteEndpointOperation(req.method, req.url);
  if (!endpointOperation) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'unsupported_route', message: `No route handler for ${pathname}` })
    );
    return;
  }

  const markedCliType = detectMarkedRouteCliType(req.headers);
  let cliType =
    markedCliType ??
    detectCliTypeFromPath(pathname) ??
    getUpstreamCliTypeForProtocol(endpointOperation.protocol);
  if (!markedCliType && isLikelyGrokBuildRequest(req)) {
    cliType = 'grokBuild';
  } else if (!markedCliType && cliType !== 'openCode' && cliType && isLikelyOpenCodeRequest(req)) {
    cliType = 'openCode';
  }
  if (!cliType) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'unsupported_route', message: `No route handler for ${pathname}` })
    );
    return;
  }
  if (
    markedCliType &&
    !isRouteCliCompatibleWithProtocol(markedCliType, endpointOperation.protocol)
  ) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'cli_marker_path_mismatch',
        message: `${markedCliType} does not support ${pathname}`,
      })
    );
    return;
  }

  // 鉴权
  const token = extractRouteApiKey(req, cliType);
  const probeLock = parseProbeLockRouteApiKey(token, routing.server.unifiedApiKey);
  if (probeLock) {
    notifyRouteProbeLockRequest(token);
  }
  if (token !== routing.server.unifiedApiKey && !probeLock) {
    notifyProbeLockTerminalFailure({
      routeApiKey: token,
      cliType,
      statusCode: 401,
      terminalError: buildRouteProxyErrorText('invalid_api_key', 'Invalid route API key'),
    });
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_api_key', message: 'Invalid route API key' }));
    return;
  }
  if (probeLock && !isLoopbackAddress(req.socket.remoteAddress)) {
    notifyProbeLockTerminalFailure({
      routeApiKey: token,
      cliType,
      statusCode: 403,
      terminalError: buildRouteProxyErrorText(
        'probe_lock_forbidden',
        'Probe-lock requests are only allowed from loopback clients'
      ),
      lock: probeLock,
    });
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'probe_lock_forbidden',
        message: 'Probe-lock requests are only allowed from loopback clients',
      })
    );
    return;
  }
  if (probeLock && probeLock.cliType !== cliType) {
    notifyProbeLockTerminalFailure({
      routeApiKey: token,
      cliType,
      statusCode: 400,
      terminalError: buildRouteProxyErrorText(
        'probe_lock_cli_mismatch',
        `Probe-lock CLI type ${probeLock.cliType} does not match route ${cliType}`
      ),
      lock: probeLock,
    });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'probe_lock_cli_mismatch',
        message: `Probe-lock CLI type ${probeLock.cliType} does not match route ${cliType}`,
      })
    );
    return;
  }
  if (
    endpointOperation.capability === 'stateful-unsupported' ||
    endpointOperation.capability === 'unsupported'
  ) {
    const error =
      endpointOperation.capability === 'stateful-unsupported'
        ? 'stateful_route_operation_unsupported'
        : 'unsupported_route_operation';
    res.writeHead(501, {
      'Content-Type': 'application/json',
      'X-Route-Proxy-Error': error,
    });
    res.end(
      JSON.stringify({
        error,
        message: `${req.method || 'GET'} ${pathname} is not supported by the local route`,
      })
    );
    return;
  }
  const sourceProtocol = endpointOperation.protocol;
  const nativePassthroughChannels = new WeakSet<ResolvedChannel>();
  const previousTerminalFailure = probeLock ? getRouteProbeLockTerminalFailure(token) : undefined;
  if (previousTerminalFailure) {
    log.warn('Probe-lock request blocked after terminal upstream failure', {
      cliType,
      statusCode: previousTerminalFailure.statusCode,
      siteId: probeLock?.siteId,
      accountId: probeLock?.accountId,
      apiKeyId: probeLock?.apiKeyId,
      rawModel: probeLock?.rawModel,
    });
    writeProbeLockTerminalFailureResponse(res, previousTerminalFailure);
    return;
  }
  const requestId = nextRequestId(cliType);

  // 读取请求体
  let bodyBuffer: Buffer;
  try {
    bodyBuffer = await readBody(req);
    requestBodyRead = true;
  } catch (err: unknown) {
    if (isRouteClientCancelledError(err)) {
      finishRouteHandling();
      return;
    }
    throw err;
  }
  let bodyJson: unknown = null;
  try {
    bodyJson = JSON.parse(bodyBuffer.toString('utf-8'));
  } catch {
    /* ignore */
  }
  const stateReference = findProviderOwnedStateReference(bodyJson);
  if (stateReference) {
    recordRequestForSelection({
      requestId,
      attempt: 0,
      cliType,
      requestedModel: extractModelFromBody(bodyJson),
      canonicalModel: null,
      outcome: 'failure',
      statusCode: 501,
      error: `stateful_request_unsupported:${stateReference}`,
    });
    res.writeHead(501, {
      'Content-Type': 'application/json',
      'X-Route-Proxy-Error': 'stateful_request_unsupported',
    });
    res.end(
      JSON.stringify({
        error: 'stateful_request_unsupported',
        message: `Provider-owned state reference is not supported: ${stateReference}`,
      })
    );
    return;
  }
  const rawModel = extractModelFromBody(bodyJson) || extractModelFromPath(pathname, cliType);
  const selectedThinkingEffort = normalizeRouteThinkingEffort(
    routing.cliThinkingEffortSelections?.[cliType]
  );
  let reasoningEffort = extractRouteReasoningEffort(bodyJson);

  // 解析 canonical model（代理层无 site 上下文，使用全局 alias 索引）。
  // 普通本地路由请求以应用中对应 CLI 选择的模型作为路由意图；外部 CLI 配置/请求模型仅保留为诊断 requestedModel。
  const rawCanonicalModel = resolveCanonicalModelFromRegistry(routing, rawModel);
  const cliSelectedModel = routing.cliModelSelections[cliType]?.trim() || null;
  let canonicalModel: string | null = cliSelectedModel || rawCanonicalModel;

  let activeRouteRuleId: string | undefined;
  let sortedChannels: ResolvedChannel[] = [];
  let routeRuntimeConfig = resolveRouteRuntimeConfig(routing, canonicalModel);
  const bypassRoutePathState = Boolean(probeLock);

  if (probeLock) {
    canonicalModel = probeLock.canonicalModel;
    routeRuntimeConfig = resolveRouteRuntimeConfig(routing, canonicalModel);
    sortedChannels = (
      await resolveChannelTargets([
        {
          routeRuleId: '__probe_lock__',
          siteId: probeLock.siteId,
          accountId: probeLock.accountId,
          apiKeyId: probeLock.apiKeyId,
          cliType,
          canonicalModel: probeLock.canonicalModel,
          resolvedModel: probeLock.rawModel,
          targetProtocol: probeLock.targetProtocol,
        },
      ])
    ).map(channel =>
      resolveEffectiveRouteChannel(channel, cliType, sourceProtocol, nativePassthroughChannels)
    );
  } else {
    // 规则匹配只看 canonical model；若当前请求尚未建立 canonical，则退化为 raw。
    // canonicalModel 已优先采用应用内 CLI 选择模型，因此本地路由不再依赖外部 CLI 配置模型。
    const sortedRules = sortRules(routing.rules);
    const matchModel = canonicalModel || rawModel;
    const rule = findMatchingRule(sortedRules, cliType, matchModel);

    if (!rule) {
      recordRequestForSelection({
        requestId,
        attempt: 0,
        cliType,
        requestedModel: rawModel,
        reasoningEffort,
        canonicalModel,
        outcome: 'failure',
        statusCode: 502,
        error: 'no_matching_rule',
      });
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'no_matching_rule',
          message: `No routing rule matched for ${cliType} / ${matchModel || '(empty model)'}`,
        })
      );
      return;
    }

    activeRouteRuleId = rule.id;

    // 解析候选通道（带 canonical model 过滤）
    const channels = resolveChannels(rule, canonicalModel);
    if (channels.length === 0) {
      recordRequestForSelection({
        requestId,
        attempt: 0,
        cliType,
        requestedModel: rawModel,
        reasoningEffort,
        canonicalModel,
        routeRuleId: rule.id,
        outcome: 'failure',
        statusCode: 503,
        error: 'no_channels',
      });
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'no_channels', message: 'No available channels for this rule' })
      );
      return;
    }
    routeRuntimeConfig = resolveRouteRuntimeConfig(routing, canonicalModel);
    const enabledChannels = filterChannelsByPriorityConfig(channels, routing, canonicalModel);
    const resolvedChannels = await resolveChannelTargets(enabledChannels);
    const attemptPlan = buildChannelAttemptPlan(
      sortChannelsByScore(resolvedChannels),
      routeRuntimeConfig.maxAttemptsPerRoutePath
    ).map(channel =>
      resolveEffectiveRouteChannel(channel, cliType, sourceProtocol, nativePassthroughChannels)
    );
    sortedChannels = applySuccessfulRoutePathAffinity(
      attemptPlan.filter(channel => !isRoutePathDisabled(channel)) as ResolvedChannel[],
      routing.routePathStates,
      Date.now(),
      getEffectiveRouteDisplayItem(routing.modelRegistry, canonicalModel)?.priorityConfig
        ?.affinityInvalidatedAt
    );
    if (sortedChannels.length === 0) {
      recordRequestForSelection({
        requestId,
        attempt: 0,
        cliType,
        requestedModel: rawModel,
        reasoningEffort,
        canonicalModel,
        routeRuleId: rule.id,
        outcome: 'failure',
        statusCode: ALL_ROUTE_PATHS_DISABLED_STATUS_CODE,
        error: ALL_ROUTE_PATHS_DISABLED_ERROR_CODE,
      });
      writeAllRoutePathsDisabledResponse(res, cliType);
      return;
    }
  }
  const timeoutMs = routing.server.requestTimeoutMs;
  const requestWantsStreaming = isStreamingRequest(bodyJson, req.url);
  const requestIsTokenCount = endpointOperation.capability === 'stateless-native-only';
  const tokenCountEndpoint =
    sourceProtocol === 'anthropic-messages'
      ? CLAUDE_MESSAGES_COUNT_TOKENS_ENDPOINT
      : RESPONSES_INPUT_TOKENS_ENDPOINT;
  if (probeLock && requestIsTokenCount) {
    writeInputTokensEstimate(res, estimateClaudeCountTokens(bodyBuffer));
    return;
  }
  if (requestIsTokenCount) {
    sortedChannels = sortedChannels.filter(
      channel =>
        resolveChannelUpstreamProtocol(channel.targetProtocol, sourceProtocol) === sourceProtocol
    );
    if (sortedChannels.length === 0) {
      const estimate = estimateClaudeCountTokens(bodyBuffer);
      recordRequestForSelection({
        requestId,
        attempt: 0,
        routeRuleId: activeRouteRuleId,
        cliType,
        requestedModel: rawModel,
        reasoningEffort,
        canonicalModel,
        requestKind: 'token-count',
        tokenUsageSource: 'local-estimate',
        estimatedInputTokens: estimate.input_tokens,
        outcome: 'neutral',
        statusCode: 200,
        error: 'count_tokens_local_estimate:no_native_protocol_channel',
      });
      writeInputTokensEstimate(res, estimate);
      return;
    }
  }

  let attempt = 0;
  let attemptedUpstream = false;
  let tokenCountFallbackReason: string | undefined;
  const adapterIncompatibilityReasons: string[] = [];
  const attemptsByRoutePath = new Map<string, number>();
  const quotaExhaustedRoutePaths = new Set<string>();
  let quotaExhaustionEncountered = false;
  for (let i = 0; i < sortedChannels.length; i++) {
    const ch = sortedChannels[i];
    if (!bypassRoutePathState && isRoutePathDisabled(ch)) {
      continue;
    }

    const routePathKey = buildChannelAttemptPathKey(ch);
    if (quotaExhaustedRoutePaths.has(routePathKey)) {
      continue;
    }
    const routePathAttempts = attemptsByRoutePath.get(routePathKey) ?? 0;
    if (routePathAttempts >= routeRuntimeConfig.maxAttemptsPerRoutePath) {
      continue;
    }
    attemptsByRoutePath.set(routePathKey, routePathAttempts + 1);

    attempt += 1;
    const activeChannel: ResolvedChannel = {
      ...ch,
    };
    const upstreamProtocol = resolveChannelUpstreamProtocol(
      activeChannel.targetProtocol,
      sourceProtocol
    );
    const site = unifiedConfigManager.getSiteById(activeChannel.siteId);
    const account = unifiedConfigManager.getAccountById(activeChannel.accountId);

    if (requestIsTokenCount && !bypassRoutePathState) {
      const endpointUnsupported = isRouteEndpointUnsupported(activeChannel, tokenCountEndpoint);
      if (endpointUnsupported) {
        tokenCountFallbackReason ??= 'cached_unsupported';
        continue;
      }
    }

    const probeLockCredentials =
      probeLock?.upstreamBaseUrl && probeLock?.upstreamApiKey
        ? {
            baseUrl: probeLock.upstreamBaseUrl,
            apiKey: probeLock.upstreamApiKey,
          }
        : null;
    const creds =
      probeLockCredentials ||
      (await resolveChannelCredentials(ch.siteId, ch.accountId, ch.apiKeyId));
    if (!creds) {
      if (probeLock) {
        notifyProbeLockTerminalFailure({
          routeApiKey: token,
          cliType,
          terminalError: buildRouteProxyErrorText(
            'credentials_unavailable',
            'Route credentials are unavailable for this probe-lock request'
          ),
          lock: probeLock,
        });
      }
      recordRequestForSelection({
        requestId,
        attempt,
        cliType,
        targetProtocol: activeChannel.targetProtocol,
        targetEndpoint: activeChannel.targetEndpoint,
        requestedModel: rawModel,
        reasoningEffort,
        canonicalModel,
        routeRuleId: activeRouteRuleId,
        siteId: activeChannel.siteId,
        accountId: activeChannel.accountId,
        apiKeyId: activeChannel.apiKeyId,
        resolvedModel: activeChannel.resolvedModel,
        outcome: 'failure',
        error: 'credentials_unavailable',
      });
      if (!bypassRoutePathState) {
        await recordPathOutcomeForSelection(
          activeChannel,
          'failure',
          { error: 'credentials_unavailable' },
          routeRuntimeConfig
        );
      }
      continue;
    }

    // Keep the initial upstream wait bounded; only active SSE streams get a longer idle window.
    const upstreamTimeouts = resolveUpstreamTimeouts({
      siteName: site?.name,
      baseTimeoutMs: timeoutMs,
      streamingRequest: requestWantsStreaming,
    });

    // 重写请求体中的 model 字段
    let finalBody = activeChannel.resolvedModel
      ? rewriteRequestModel(bodyBuffer, activeChannel.resolvedModel)
      : bodyBuffer;

    // 站点级特殊处理：AnyRouter 仅在同协议透传时保留，其余显式 targetProtocol 走通用适配
    let additionalHeaders: Record<string, string> = {};
    let methodOverride: string | undefined;
    let requestUrlOverride: string | undefined;
    let upstreamCliType: RouteCliType = getUpstreamCliTypeForProtocol(upstreamProtocol);
    let responseAdapter: AnyRouterResponseAdapter = { type: 'transparent' };
    const protocolResponseAdapters: CliProtocolResponseAdapter[] = [];
    const applyProtocolRewrite = (
      targetProtocol: ConcreteCliTargetProtocol,
      sourceProtocol?: ConcreteCliTargetProtocol
    ) => {
      const rewritten = adaptRequestToTargetProtocol(
        finalBody,
        cliType,
        targetProtocol,
        requestUrlOverride ?? req.url,
        activeChannel.resolvedModel,
        sourceProtocol
      );

      finalBody = rewritten.body;
      additionalHeaders = { ...additionalHeaders, ...rewritten.headers };
      methodOverride = rewritten.upstreamMethod;
      requestUrlOverride = rewritten.upstreamPath;
      upstreamCliType = rewritten.upstreamCliType;
      protocolResponseAdapters.push(rewritten.responseAdapter);
    };

    if (
      cliType !== 'openCode' &&
      cliType !== 'grokBuild' &&
      !requestIsTokenCount &&
      site &&
      account &&
      isAnyRouterSite(site.name) &&
      sourceProtocol === upstreamProtocol
    ) {
      const userHash = account.anyRouterConfig?.userHash;

      if (!userHash && cliType === 'claudeCode') {
        log.warn(`[AnyRouter] Account ${account.account_name} missing userHash configuration`);
      }

      const rewritten = rewriteForAnyRouter(
        finalBody,
        userHash,
        req.headers,
        cliType,
        req.url,
        activeChannel.resolvedModel
      );

      finalBody = rewritten.body;
      additionalHeaders = rewritten.headers;
      requestUrlOverride = rewritten.upstreamPath;
      upstreamCliType = rewritten.upstreamCliType;
      responseAdapter = rewritten.responseAdapter;
    } else {
      try {
        if (!requestIsTokenCount && sourceProtocol !== upstreamProtocol) {
          applyProtocolRewrite(upstreamProtocol, sourceProtocol);
        }
      } catch (err: unknown) {
        const isAdapterError = err instanceof CliProtocolAdapterError;
        const stage = isAdapterError ? err.stage : 'request-adapt';
        const reason = isAdapterError
          ? err.reason
          : err instanceof Error
            ? err.message
            : 'unknown_error';
        if (probeLock) {
          notifyProbeLockTerminalFailure({
            routeApiKey: token,
            cliType,
            statusCode: 502,
            terminalError: buildRouteProxyErrorText(`adapter_${stage}`, reason),
            lock: probeLock,
          });
        }
        log.warn('Protocol adapter request-adapt failed', {
          stage,
          cliType,
          sourceEndpoint: pathname,
          targetProtocol: activeChannel.targetProtocol,
          targetEndpoint: activeChannel.targetEndpoint,
          siteId: activeChannel.siteId,
          accountId: activeChannel.accountId,
          apiKeyId: activeChannel.apiKeyId,
          resolvedModel: activeChannel.resolvedModel,
          reason,
        });
        recordRequestForSelection({
          requestId,
          attempt,
          routeRuleId: activeRouteRuleId,
          cliType,
          targetProtocol: activeChannel.targetProtocol,
          targetEndpoint: activeChannel.targetEndpoint,
          requestedModel: rawModel,
          reasoningEffort,
          canonicalModel,
          requestKind: 'inference',
          siteId: activeChannel.siteId,
          accountId: activeChannel.accountId,
          apiKeyId: activeChannel.apiKeyId,
          resolvedModel: activeChannel.resolvedModel,
          outcome: 'neutral',
          error: `adapter_${stage}:${reason}`,
        });
        adapterIncompatibilityReasons.push(reason);

        continue;
      }
    }

    finalBody = applyRouteThinkingEffortOverride(
      finalBody,
      selectedThinkingEffort,
      upstreamProtocol
    );
    try {
      reasoningEffort =
        extractRouteReasoningEffort(JSON.parse(finalBody.toString('utf-8'))) ?? reasoningEffort;
    } catch {
      /* keep previous reasoningEffort */
    }

    const attemptStartedAt = Date.now();
    const streamResponseBody =
      requestWantsStreaming && canStreamResponseAdapters(responseAdapter, protocolResponseAdapters);
    const nativeResponsePassthrough =
      nativePassthroughChannels.has(ch) && !(site && isAnyRouterSite(site.name));
    attemptedUpstream = true;

    // probe-lock 上游预算：按"终结结果"计，瞬时错误在上限内不消耗预算。
    let probeLockIsFinalAttempt = false;

    try {
      if (probeLock) {
        const attempt = beginRouteProbeLockUpstreamAttempt(token);
        if (!attempt.allowed) {
          const terminalError = buildProbeLockUpstreamAttemptExhaustedErrorText();
          log.warn('Probe-lock upstream request blocked after per-model attempt budget exhausted', {
            cliType,
            siteId: probeLock.siteId,
            accountId: probeLock.accountId,
            apiKeyId: probeLock.apiKeyId,
            rawModel: probeLock.rawModel,
          });
          res.writeHead(PROBE_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_STATUS_CODE, {
            'Content-Type': 'application/json',
            'X-Route-Proxy-Error': PROBE_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_ERROR_CODE,
          });
          res.end(terminalError);
          return;
        }
        probeLockIsFinalAttempt = attempt.isFinalAttempt;
      }

      const forwardActiveChannel = () =>
        forwardToUpstream(
          req,
          creds.baseUrl,
          creds.apiKey,
          finalBody,
          cliType,
          upstreamTimeouts.timeoutMs,
          activeChannel.resolvedModel,
          {
            upstreamProxyUrl: routing.server.upstreamProxyUrl,
            additionalHeaders,
            methodOverride,
            requestUrlOverride,
            upstreamCliType,
            signal: routeAbortController.signal,
            streamResponse: res,
            streamResponseBody,
            nativeResponsePassthrough,
            streamIdleTimeoutMs: upstreamTimeouts.streamIdleTimeoutMs,
          }
        );

      const forwardActiveChannelWithEmptyStreamRetry = async () => {
        for (let retry = 0; ; retry += 1) {
          try {
            return await forwardActiveChannel();
          } catch (error: unknown) {
            if (
              probeLock ||
              retry >= EMPTY_STREAM_UPSTREAM_RETRY_ATTEMPTS ||
              res.headersSent ||
              routeAbortController.signal.aborted ||
              !isRetryableEmptyStreamingResponse(error)
            ) {
              throw error;
            }

            log.warn('Upstream channel returned an empty SSE body; retrying same channel', {
              retryAttempt: retry + 1,
              maxRetries: EMPTY_STREAM_UPSTREAM_RETRY_ATTEMPTS,
              siteId: activeChannel.siteId,
              accountId: activeChannel.accountId,
              apiKeyId: activeChannel.apiKeyId,
              resolvedModel: activeChannel.resolvedModel,
            });
          }
        }
      };

      let result = await forwardActiveChannelWithEmptyStreamRetry();
      if (routeAbortController.signal.aborted) {
        if (!bypassRoutePathState && shouldRecordCancelledUpstreamSuccess(result)) {
          await recordCancelledUpstreamSuccess({
            requestId,
            requestSelectionStartedAt,
            attempt,
            activeChannel,
            activeRouteRuleId,
            cliType,
            rawModel,
            reasoningEffort,
            canonicalModel,
            result,
            routeRuntimeConfig,
          });
        }
        finishRouteHandling();
        return;
      }
      let outcome = classifyRouteStatusCode(result.statusCode);
      for (
        let zeroUsageRetry = 0;
        zeroUsageRetry < ZERO_USAGE_UPSTREAM_RETRY_ATTEMPTS &&
        outcome === 'success' &&
        !requestIsTokenCount &&
        !result.semanticError &&
        !result.streamed &&
        isAllZeroRouteUsage(result.usage);
        zeroUsageRetry += 1
      ) {
        log.warn('Upstream channel returned HTTP 200 with all-zero usage; retrying same channel', {
          retryAttempt: zeroUsageRetry + 1,
          maxRetries: ZERO_USAGE_UPSTREAM_RETRY_ATTEMPTS,
          siteId: activeChannel.siteId,
          accountId: activeChannel.accountId,
          apiKeyId: activeChannel.apiKeyId,
          resolvedModel: activeChannel.resolvedModel,
        });
        result = await forwardActiveChannel();
        if (routeAbortController.signal.aborted) {
          if (!bypassRoutePathState && shouldRecordCancelledUpstreamSuccess(result)) {
            await recordCancelledUpstreamSuccess({
              requestId,
              requestSelectionStartedAt,
              attempt,
              activeChannel,
              activeRouteRuleId,
              cliType,
              rawModel,
              reasoningEffort,
              canonicalModel,
              result,
              routeRuntimeConfig,
            });
          }
          finishRouteHandling();
          return;
        }
        outcome = classifyRouteStatusCode(result.statusCode);
      }
      const upstreamFailureBodySnippet =
        outcome === 'failure' ? summarizeUpstreamFailureBodyForLog(result.body) : '';
      const quotaExhausted =
        outcome === 'failure' &&
        !bypassRoutePathState &&
        isUpstreamQuotaExhaustionResponse(result.statusCode, result.body);
      const routeRequestLogError = quotaExhausted
        ? buildQuotaExhaustedRouteLogError(upstreamFailureBodySnippet)
        : upstreamFailureBodySnippet;

      if (requestIsTokenCount && !bypassRoutePathState && isUnsupportedTokenCountResponse(result)) {
        const bodySnippet = summarizeUpstreamFailureBodyForLog(result.body) || '<empty>';
        await recordRouteEndpointUnsupported(activeChannel, tokenCountEndpoint, {
          statusCode: result.statusCode,
          error: bodySnippet,
          reason: 'upstream_unsupported',
        });
        recordRequestForSelection({
          requestId,
          attempt,
          routeRuleId: activeRouteRuleId,
          cliType,
          targetProtocol: activeChannel.targetProtocol,
          targetEndpoint: activeChannel.targetEndpoint,
          requestedModel: rawModel,
          reasoningEffort,
          canonicalModel,
          requestKind: 'token-count',
          siteId: activeChannel.siteId,
          accountId: activeChannel.accountId,
          apiKeyId: activeChannel.apiKeyId,
          resolvedModel: activeChannel.resolvedModel,
          outcome: 'neutral',
          statusCode: result.statusCode,
          latencyMs: result.latencyMs,
          firstByteLatencyMs: result.firstByteLatencyMs,
          error: `count_tokens_upstream_unsupported:${result.statusCode}`,
        });
        tokenCountFallbackReason = `upstream_${result.statusCode}`;
        continue;
      }

      const emptyResponseZeroUsage =
        result.semanticError === EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE ||
        (!requestIsTokenCount && !result.streamed && isAllZeroRouteUsage(result.usage));
      if (outcome === 'success' && emptyResponseZeroUsage) {
        const terminalError = buildRouteProxyErrorText(
          EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE,
          'upstream returned HTTP 200 with all-zero usage'
        );

        if (probeLock) {
          settleRouteProbeLockUpstreamAttempt(token);
          recordProbeLockFirstUpstreamResult({
            routeApiKey: token,
            cliType,
            lock: probeLock,
            statusCode: result.statusCode,
            success: false,
            body: result.body,
            error: terminalError,
          });
          const terminalFailure = {
            routeApiKey: token,
            cliType,
            statusCode: 502,
            terminalError,
            lock: probeLock,
          };
          notifyProbeLockTerminalFailure(terminalFailure);
          writeProbeLockTerminalFailureResponse(res, terminalFailure);
          return;
        }

        if (!bypassRoutePathState) {
          recordOutcome(activeChannel, 'failure', {
            statusCode: result.statusCode,
            latencyMs: result.latencyMs,
          });
          await recordPathOutcomeForSelection(
            activeChannel,
            'failure',
            {
              statusCode: result.statusCode,
              latencyMs: result.latencyMs,
              error: EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE,
            },
            routeRuntimeConfig
          );
          recordRequestForSelection({
            requestId,
            attempt,
            routeRuleId: activeRouteRuleId,
            cliType,
            targetProtocol: activeChannel.targetProtocol,
            targetEndpoint: activeChannel.targetEndpoint,
            requestedModel: rawModel,
            reasoningEffort,
            canonicalModel,
            requestKind: 'inference',
            tokenUsageSource: 'upstream',
            siteId: activeChannel.siteId,
            accountId: activeChannel.accountId,
            apiKeyId: activeChannel.apiKeyId,
            resolvedModel: activeChannel.resolvedModel,
            outcome: 'failure',
            statusCode: result.statusCode,
            latencyMs: result.latencyMs,
            firstByteLatencyMs: result.firstByteLatencyMs,
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
            totalTokens: result.usage?.totalTokens,
            cacheCreationTokens: result.usage?.cacheCreationTokens,
            cacheReadTokens: result.usage?.cacheReadTokens,
            cachedTokens: result.usage?.cachedTokens,
            error: EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE,
          });
        }
        log.warn('Upstream channel returned HTTP 200 with all-zero usage; trying next channel', {
          siteId: activeChannel.siteId,
          accountId: activeChannel.accountId,
          apiKeyId: activeChannel.apiKeyId,
          resolvedModel: activeChannel.resolvedModel,
        });

        continue;
      }

      if (!bypassRoutePathState) {
        // 记录实时选路统计
        recordOutcome(activeChannel, outcome, {
          statusCode: result.statusCode,
          latencyMs: result.latencyMs,
        });
        await recordPathOutcomeForSelection(
          activeChannel,
          outcome,
          {
            statusCode: result.statusCode,
            latencyMs: result.latencyMs,
            ...(upstreamFailureBodySnippet ? { error: upstreamFailureBodySnippet } : {}),
          },
          routeRuntimeConfig
        );

        // 记录分析统计
        recordRequestForSelection({
          requestId,
          attempt,
          routeRuleId: activeRouteRuleId,
          cliType,
          targetProtocol: activeChannel.targetProtocol,
          targetEndpoint: activeChannel.targetEndpoint,
          requestedModel: rawModel,
          reasoningEffort,
          canonicalModel,
          requestKind: requestIsTokenCount ? 'token-count' : 'inference',
          tokenUsageSource: hasRouteUsageValues(result.usage) ? 'upstream' : undefined,
          siteId: activeChannel.siteId,
          accountId: activeChannel.accountId,
          apiKeyId: activeChannel.apiKeyId,
          resolvedModel: activeChannel.resolvedModel,
          outcome,
          statusCode: result.statusCode,
          latencyMs: result.latencyMs,
          firstByteLatencyMs: result.firstByteLatencyMs,
          promptTokens: result.usage?.promptTokens,
          completionTokens: result.usage?.completionTokens,
          totalTokens: result.usage?.totalTokens,
          cacheCreationTokens: result.usage?.cacheCreationTokens,
          cacheReadTokens: result.usage?.cacheReadTokens,
          cachedTokens: result.usage?.cachedTokens,
          ...(routeRequestLogError ? { error: routeRequestLogError } : {}),
        });
      }

      // 失败且还有重试机会：不写 res，尝试下一个通道
      if (outcome === 'failure') {
        const bodySnippet = upstreamFailureBodySnippet || '<empty>';
        const rawBodySnippet = summarizeUpstreamFailureBodyRaw(result.body) || '<empty>';
        const terminalError =
          rawBodySnippet === '<empty>'
            ? buildRouteProxyErrorText(
                'bad_response_status_code',
                `bad response status code ${result.statusCode}`
              )
            : rawBodySnippet;
        log.warn('Upstream channel returned failure response', {
          statusCode: result.statusCode,
          siteId: activeChannel.siteId,
          accountId: activeChannel.accountId,
          apiKeyId: activeChannel.apiKeyId,
          resolvedModel: activeChannel.resolvedModel,
          contentType: normalizeHeaderValue(result.headers['content-type']) || 'unknown',
          bodySnippet,
        });

        if (probeLock) {
          const transient = isTransientUpstreamStatus(result.statusCode);
          if (transient && !probeLockIsFinalAttempt) {
            // 瞬时上游错误且未达尝试上限：不消耗预算、不通知终结失败。
            // 记录一个可被后续成功/终结失败覆盖的非终结结果（保留失败原因），
            // 并把原始上游响应直接透传回 CLI（剥离 hop-by-hop/content-length/transfer-encoding），
            // 不走 AnyRouter/协议转换，避免转换异常把瞬时错误劫持成终结失败。
            log.debug('Probe-lock transient upstream failure passed through without settling', {
              statusCode: result.statusCode,
              cliType,
              siteId: probeLock.siteId,
              accountId: probeLock.accountId,
              apiKeyId: probeLock.apiKeyId,
              rawModel: probeLock.rawModel,
            });
            recordProbeLockFirstUpstreamResult({
              routeApiKey: token,
              cliType,
              lock: probeLock,
              statusCode: result.statusCode,
              success: false,
              body: result.body,
              error: terminalError,
              terminal: false,
            });
            if (!res.headersSent) {
              res.writeHead(
                result.statusCode,
                buildBufferedResponseHeaders(result.headers, result.body)
              );
            }
            if (!res.writableEnded) {
              res.end(result.body);
            }
            return;
          }

          const finalError =
            transient && probeLockIsFinalAttempt
              ? buildRouteProxyErrorText(
                  'upstream_temporarily_unavailable',
                  `upstream temporarily unavailable, retried ${MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS} times (last status ${result.statusCode})`
                )
              : terminalError;
          settleRouteProbeLockUpstreamAttempt(token);
          recordProbeLockFirstUpstreamResult({
            routeApiKey: token,
            cliType,
            lock: probeLock,
            statusCode: result.statusCode,
            success: false,
            body: result.body,
            error: finalError,
          });
          notifyProbeLockTerminalFailure({
            routeApiKey: token,
            cliType,
            statusCode: result.statusCode,
            terminalError: finalError,
            lock: probeLock,
          });
        }

        if (quotaExhausted) {
          quotaExhaustionEncountered = true;
          quotaExhaustedRoutePaths.add(routePathKey);
          log.warn(
            'Upstream route quota is exhausted; skipping remaining attempts for route path',
            {
              statusCode: result.statusCode,
              siteId: activeChannel.siteId,
              accountId: activeChannel.accountId,
              apiKeyId: activeChannel.apiKeyId,
              resolvedModel: activeChannel.resolvedModel,
            }
          );
          continue;
        }

        if (hasEnabledRoutePath(sortedChannels.slice(i + 1)) && !bypassRoutePathState) {
          log.warn(`Channel failed (${result.statusCode}), trying next channel`);
          continue;
        }
      }

      if (result.streamed) {
        if (probeLock) {
          settleRouteProbeLockUpstreamAttempt(token);
          recordProbeLockFirstUpstreamResult({
            routeApiKey: token,
            cliType,
            lock: probeLock,
            statusCode: result.statusCode,
            // forwardToUpstream 只在成功 SSE 时置 streamed，故此处恒为成功。
            success: true,
            body: result.body,
          });
        }
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }

      const anyRouterTransformed = transformAnyRouterResponse({
        body: result.body,
        headers: result.headers,
        statusCode: result.statusCode,
        adapter: responseAdapter,
      });
      let transformed: { body: Buffer; headers: http.IncomingHttpHeaders } = {
        body: anyRouterTransformed.body,
        headers: anyRouterTransformed.headers,
      };
      try {
        for (const adapter of [...protocolResponseAdapters].reverse()) {
          transformed = transformTargetProtocolResponse({
            body: transformed.body,
            headers: transformed.headers,
            statusCode: result.statusCode,
            adapter,
          });
        }
      } catch (err: unknown) {
        const isAdapterError = err instanceof CliProtocolAdapterError;
        const reason = isAdapterError
          ? err.reason
          : err instanceof Error
            ? err.message
            : 'unknown_error';
        if (probeLock) {
          const terminalError = buildRouteProxyErrorText('adapter_response-adapt', reason);
          settleRouteProbeLockUpstreamAttempt(token);
          recordProbeLockFirstUpstreamResult({
            routeApiKey: token,
            cliType,
            lock: probeLock,
            statusCode: 502,
            success: false,
            body: result.body,
            error: terminalError,
          });
          notifyProbeLockTerminalFailure({
            routeApiKey: token,
            cliType,
            statusCode: 502,
            terminalError,
            lock: probeLock,
          });
        }
        log.warn('Protocol adapter response-adapt failed', {
          stage: 'response-adapt',
          cliType,
          sourceEndpoint: pathname,
          targetProtocol: activeChannel.targetProtocol,
          targetEndpoint: activeChannel.targetEndpoint,
          siteId: activeChannel.siteId,
          accountId: activeChannel.accountId,
          apiKeyId: activeChannel.apiKeyId,
          resolvedModel: activeChannel.resolvedModel,
          reason,
        });
        if (!bypassRoutePathState) {
          await recordPathOutcomeForSelection(
            activeChannel,
            'failure',
            { error: `adapter_response-adapt:${reason}` },
            routeRuntimeConfig
          );
        }
        // 响应字节尚未写入，可继续尝试下一通道
        continue;
      }

      // 成功/neutral/最后一次失败：写 res
      if (probeLock && outcome === 'success') {
        settleRouteProbeLockUpstreamAttempt(token);
        recordProbeLockFirstUpstreamResult({
          routeApiKey: token,
          cliType,
          lock: probeLock,
          statusCode: result.statusCode,
          success: true,
          body: transformed.body,
        });
      }
      res.writeHead(
        result.statusCode,
        buildBufferedResponseHeaders(transformed.headers, transformed.body)
      );
      res.end(transformed.body);
      return;
    } catch (err: unknown) {
      if (isRouteClientCancelledError(err) || routeAbortController.signal.aborted) {
        finishRouteHandling();
        return;
      }
      const errorMessage = err instanceof Error ? err.message : 'unknown_error';
      if (probeLock) {
        // 网络异常无 statusCode，按瞬时错误处理：未达上限则不 settle/不通知，
        // 透传错误给 CLI,让后续请求继续尝试上游。
        if (probeLockIsFinalAttempt) {
          const finalError = buildRouteProxyErrorText(
            'upstream_temporarily_unavailable',
            `upstream temporarily unavailable, retried ${MAX_PROBE_LOCK_UPSTREAM_ATTEMPTS} times (${errorMessage})`
          );
          settleRouteProbeLockUpstreamAttempt(token);
          recordProbeLockFirstUpstreamResult({
            routeApiKey: token,
            cliType,
            lock: probeLock,
            statusCode: 502,
            success: false,
            error: finalError,
          });
          notifyProbeLockTerminalFailure({
            routeApiKey: token,
            cliType,
            statusCode: 502,
            terminalError: finalError,
            lock: probeLock,
          });
        } else {
          // 瞬时网络异常且未达上限：不消耗预算、不通知终结失败，但记录一个可被
          // 后续成功/终结失败覆盖的非终结结果，避免单发不重试的 CLI 丢失失败原因。
          log.debug('Probe-lock transient network failure passed through without settling', {
            cliType,
            siteId: probeLock.siteId,
            accountId: probeLock.accountId,
            apiKeyId: probeLock.apiKeyId,
            rawModel: probeLock.rawModel,
            error: errorMessage,
          });
          recordProbeLockFirstUpstreamResult({
            routeApiKey: token,
            cliType,
            lock: probeLock,
            statusCode: 502,
            success: false,
            error: errorMessage,
            terminal: false,
          });
        }
      }
      if (!bypassRoutePathState) {
        recordOutcome(activeChannel, 'failure', {});
        await recordPathOutcomeForSelection(
          activeChannel,
          'failure',
          {
            latencyMs: Date.now() - attemptStartedAt,
            error: errorMessage,
          },
          routeRuntimeConfig
        );
        recordRequestForSelection({
          requestId,
          attempt,
          routeRuleId: activeRouteRuleId,
          cliType,
          targetProtocol: activeChannel.targetProtocol,
          targetEndpoint: activeChannel.targetEndpoint,
          requestedModel: rawModel,
          reasoningEffort,
          canonicalModel,
          requestKind: requestIsTokenCount ? 'token-count' : 'inference',
          siteId: activeChannel.siteId,
          accountId: activeChannel.accountId,
          apiKeyId: activeChannel.apiKeyId,
          resolvedModel: activeChannel.resolvedModel,
          outcome: 'failure',
          latencyMs: Date.now() - attemptStartedAt,
          error: errorMessage,
        });
      }
      log.warn('Upstream channel forwarding failed', {
        stage: 'upstream',
        cliType,
        sourceEndpoint: pathname,
        targetProtocol: activeChannel.targetProtocol,
        targetEndpoint: activeChannel.targetEndpoint,
        siteId: activeChannel.siteId,
        accountId: activeChannel.accountId,
        apiKeyId: activeChannel.apiKeyId,
        resolvedModel: activeChannel.resolvedModel,
        error: errorMessage,
      });
      if (res.headersSent) {
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }
      if (
        err instanceof NativeAnthropicSseGuardError &&
        nativeResponsePassthrough &&
        !probeLock &&
        !routeAbortController.signal.aborted &&
        !isRoutePathDisabled(activeChannel) &&
        (attemptsByRoutePath.get(routePathKey) ?? 0) < routeRuntimeConfig.maxAttemptsPerRoutePath
      ) {
        log.warn('Native Anthropic stream failed before commit; retrying same route path', {
          retryAttempt: (attemptsByRoutePath.get(routePathKey) ?? 0) + 1,
          maxAttempts: routeRuntimeConfig.maxAttemptsPerRoutePath,
          siteId: activeChannel.siteId,
          accountId: activeChannel.accountId,
          apiKeyId: activeChannel.apiKeyId,
          resolvedModel: activeChannel.resolvedModel,
          error: errorMessage,
        });
        i -= 1;
      }
    }
  }

  if (!res.headersSent) {
    if (requestIsTokenCount) {
      const estimate = estimateClaudeCountTokens(bodyBuffer);
      recordRequestForSelection({
        requestId,
        attempt: attempt + 1,
        routeRuleId: activeRouteRuleId,
        cliType,
        requestedModel: rawModel,
        reasoningEffort,
        canonicalModel,
        requestKind: 'token-count',
        tokenUsageSource: 'local-estimate',
        estimatedInputTokens: estimate.input_tokens,
        outcome: 'neutral',
        statusCode: 200,
        error: `count_tokens_local_estimate:${tokenCountFallbackReason || 'native_channels_unavailable'}`,
      });
      writeInputTokensEstimate(res, estimate);
    } else if (!attemptedUpstream && adapterIncompatibilityReasons.length > 0) {
      res.writeHead(400, {
        'Content-Type': 'application/json',
        'X-Route-Proxy-Error': 'no_compatible_route_channel',
      });
      res.end(
        JSON.stringify({
          error: 'no_compatible_route_channel',
          message: 'No route channel can preserve the request across protocols',
          reasons: Array.from(new Set(adapterIncompatibilityReasons)),
        })
      );
    } else if (quotaExhaustionEncountered) {
      writeUpstreamTemporarilyUnavailableResponse(res, cliType);
    } else if (!bypassRoutePathState && areAllRoutePathsDisabled(sortedChannels)) {
      writeAllRoutePathsDisabledResponse(res, cliType);
    } else {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'all_channels_failed', message: 'All upstream channels failed' })
      );
    }
  }
  finishRouteHandling();
}

export async function startProxyServer(): Promise<void> {
  if (isRunning) {
    log.warn('Proxy server already running');
    return;
  }

  const routing = unifiedConfigManager.getRoutingConfig();
  const { port, host } = routing.server;

  proxyServer = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
      log.error('Unhandled proxy error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_error', message: err.message }));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    proxyServer!.listen(port, host, () => {
      isRunning = true;
      log.info(`Route proxy server started on ${host}:${port}`);
      resolve();
    });
    proxyServer!.on('error', err => {
      reject(formatRouteProxyStartError(err, host, port));
    });
  });

  startHealthCheckTimer();
}

export async function stopProxyServer(): Promise<void> {
  stopHealthCheckTimer();
  if (!proxyServer) return;

  await new Promise<void>(resolve => {
    proxyServer!.close(() => {
      isRunning = false;
      proxyServer = null;
      log.info('Route proxy server stopped');
      resolve();
    });
  });
}

export function getProxyStatus(): { running: boolean; port: number; host: string } {
  const routing = unifiedConfigManager.getRoutingConfig();
  return {
    running: isRunning,
    port: routing.server.port,
    host: routing.server.host,
  };
}

function formatRouteProxyStartError(error: unknown, host: string, port: number): Error {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
  ) {
    return new Error(
      `Route proxy port conflict: ${host}:${port} is already in use. Stop the process using this port or change the route proxy port.`
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

export async function ensureRouteProxyReady(options?: {
  autoEnable?: boolean;
}): Promise<{ baseUrl: string; unifiedApiKey: string }> {
  const autoEnable = options?.autoEnable !== false;
  let routing = unifiedConfigManager.getRoutingConfig();

  if (!routing.server.enabled && autoEnable) {
    await unifiedConfigManager.updateRouteServerConfig({ enabled: true });
    routing = unifiedConfigManager.getRoutingConfig();
  }

  if (!routing.server.enabled) {
    throw new Error('Route proxy is disabled');
  }

  await startProxyServer();
  routing = unifiedConfigManager.getRoutingConfig();
  return {
    baseUrl: buildRouteProxyBaseUrl(routing.server),
    unifiedApiKey: routing.server.unifiedApiKey,
  };
}

export async function initializeRouteProxy(): Promise<void> {
  const routing = unifiedConfigManager.getRoutingConfig();
  if (!routing.server.enabled) {
    log.info('Route proxy server is disabled, skipping start');
    return;
  }
  await startProxyServer();
}
