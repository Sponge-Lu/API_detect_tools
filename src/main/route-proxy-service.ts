/**
 * 路由代理服务器
 * 输入: CLI 请求 (HTTP), RoutingConfig, ModelRegistry
 * 输出: 透明转发到上游站点（含 model 重写 + metrics 采集）
 * 定位: 服务层 - 监听本地端口，canonical→raw 模型重写，Electron net raw 上游转发，透传+统计
 */

import * as http from 'http';
import { createHash } from 'crypto';
import { URL } from 'url';
import Logger from './utils/logger';
import { httpRawRequest, httpRawStreamRequest } from './utils/http-client';
import { unifiedConfigManager } from './unified-config-manager';
import {
  detectCliTypeFromPath,
  extractModelFromBody,
  extractModelFromPath,
  sortRules,
  findMatchingProtocolRule,
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
  DEFAULT_ROUTE_SESSION_ROUTING_CONFIG,
} from '../shared/types/route-proxy';
import { isAnyRouterSite } from '../shared/types/site';
import { normalizeCliTargetProtocol, type CliTargetProtocol } from '../shared/types/cli-config';
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
  IncrementalProtocolSseTransformer,
  type StreamingProtocol,
} from './protocol-sse-transformer';
import {
  createIncrementalStreamingValidator,
  STREAMING_VALIDATION_MAX_SSE_FRAME_BYTES,
  StreamingProtocolValidationError,
  type CompletedStreamValidation,
  type StreamingValidationProtocol,
} from './streaming-protocol-validator';
import { routeSessionActivityService } from './route-session-activity-service';
import {
  buildRouteProxyBaseUrl,
  beginRouteTargetLockUpstreamAttempt,
  settleRouteTargetLockUpstreamAttempt,
  MAX_TARGET_LOCK_UPSTREAM_ATTEMPTS,
  getRouteTargetLockTerminalFailure,
  isLoopbackAddress,
  notifyRouteTargetLockRequest,
  notifyRouteTargetLockTerminalFailure,
  parseTargetLockRouteApiKey,
  recordRouteTargetLockFirstUpstreamResult,
  type RouteTargetLockTerminalFailure,
  type RouteTargetLock,
} from './route-target-lock';
import {
  extractObservedRouteInstanceKey,
  resolveRouteInstanceForRequest,
} from './route-session-service';
import { findConfigFileProfileByRouteApiKey } from './config-file-profile-service';
import type { ConfigFileProfile } from '../shared/types/config-file-profile';
import {
  routeStateAffinityService,
  type RouteStateAffinityRecord,
} from './route-state-affinity-service';

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
const TARGET_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_ERROR_CODE = 'target_lock_upstream_attempt_exhausted';
const TARGET_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_STATUS_CODE = 400;
const ANYROUTER_REQUEST_TIMEOUT_MS = 120 * 1000;
const ACTIVE_STREAM_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const CLAUDE_COUNT_TOKENS_PATH = '/v1/messages/count_tokens';
const CLAUDE_MESSAGES_COUNT_TOKENS_ENDPOINT = 'claude_messages_count_tokens';
const OPENAI_STATEFUL_ROUTE_PREFIXES = [
  '/v1/batches',
  '/v1/files',
  '/v1/uploads',
  '/v1/vector_stores',
  '/v1/containers',
] as const;
const INITIAL_STREAM_VALIDATION_MAX_BYTES = 4096;
const NATIVE_OPENAI_RESPONSES_SSE_MAX_PRECOMMIT_BYTES = 1024 * 1024;
const NATIVE_ANTHROPIC_SSE_MAX_FRAME_BYTES = 1024 * 1024;
const NATIVE_ANTHROPIC_SSE_MAX_PRECOMMIT_BYTES = 1024 * 1024;
const ROUTE_CLIENT_CANCELLED_ERROR_CODE = 'route_client_cancelled';
const ROUTE_CLIENT_CANCELLED_STATUS_CODE = 499;

type ConcreteCliTargetProtocol = Exclude<CliTargetProtocol, 'native'>;
type RouteOperationCapability =
  | 'generation-convertible'
  | 'stateless-native-only'
  | 'model-discovery'
  | 'stateful-native'
  | 'stateful-unsupported'
  | 'unsupported';

export interface RouteEndpointOperation {
  protocol: ConcreteCliTargetProtocol;
  operation: string;
  capability: RouteOperationCapability;
  resourceId?: string;
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

function shouldRecordCancelledUpstreamPathSuccess(result: {
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

/** Preserve a completed upstream success in path health without hiding the client cancellation. */
async function recordCancelledUpstreamPathSuccess(params: {
  requestSelectionStartedAt: number;
  activeChannel: ResolvedChannel;
  result: {
    statusCode: number;
    latencyMs: number;
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

function extractBearerToken(req: Pick<http.IncomingMessage, 'headers'>): string {
  const authHeader = normalizeHeaderValue(req.headers['authorization']);
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match?.[1]?.trim() || '';
}

export interface RouteCredentialCandidate {
  value: string;
  sources: ('authorization' | 'x-api-key')[];
}

export type RouteProfileCredentialResolution =
  | {
      status: 'resolved';
      profile: ConfigFileProfile;
      candidates: RouteCredentialCandidate[];
      unknownCandidates: RouteCredentialCandidate[];
    }
  | {
      status: 'invalid_api_key' | 'ambiguous_credentials';
      candidates: RouteCredentialCandidate[];
      profiles: ConfigFileProfile[];
    };

export function extractRouteCredentialCandidates(
  req: Pick<http.IncomingMessage, 'headers'>
): RouteCredentialCandidate[] {
  const byValue = new Map<string, RouteCredentialCandidate>();
  const append = (value: string, source: RouteCredentialCandidate['sources'][number]) => {
    const normalized = value.trim();
    if (!normalized) return;
    const existing = byValue.get(normalized);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    byValue.set(normalized, { value: normalized, sources: [source] });
  };

  append(extractBearerToken(req), 'authorization');
  append(normalizeHeaderValue(req.headers['x-api-key']), 'x-api-key');
  return [...byValue.values()];
}

export async function resolveRouteProfileCredential(
  req: Pick<http.IncomingMessage, 'headers'>,
  lookup: (apiKey: string) => Promise<ConfigFileProfile | null> = findConfigFileProfileByRouteApiKey
): Promise<RouteProfileCredentialResolution> {
  return resolveRouteProfileCredentialCandidates(extractRouteCredentialCandidates(req), lookup);
}

async function resolveRouteProfileCredentialCandidates(
  candidates: RouteCredentialCandidate[],
  lookup: (apiKey: string) => Promise<ConfigFileProfile | null>
): Promise<RouteProfileCredentialResolution> {
  const matches = await Promise.all(
    candidates.map(async candidate => ({ candidate, profile: await lookup(candidate.value) }))
  );
  const profiles = [
    ...new Map(
      matches
        .filter(
          (match): match is { candidate: RouteCredentialCandidate; profile: ConfigFileProfile } =>
            Boolean(match.profile)
        )
        .map(match => [match.profile.id, match.profile])
    ).values(),
  ];

  if (profiles.length === 0) return { status: 'invalid_api_key', candidates, profiles };
  if (profiles.length > 1) return { status: 'ambiguous_credentials', candidates, profiles };
  return {
    status: 'resolved',
    profile: profiles[0],
    candidates,
    unknownCandidates: matches.filter(match => !match.profile).map(match => match.candidate),
  };
}

function fingerprintRouteCredential(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
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
  _cliType: RouteCliType
): string {
  return extractRouteCredentialCandidates(req)[0]?.value || '';
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

function buildRouteModelDiscoveryResponse(
  routing: Pick<RoutingConfig, 'modelRegistry'>,
  req: Pick<http.IncomingMessage, 'headers' | 'url'>
): { statusCode: number; body: unknown } {
  const pathname = getRequestPathname(req.url);
  const requestedId = pathname.startsWith('/v1/models/')
    ? decodeURIComponent(pathname.slice('/v1/models/'.length))
    : null;
  // 发现列表只暴露重定向模型（entries 的 canonicalName，天然唯一且与模型映射页顺序一致）；
  // 原始模型名（aliases）仅用于单模型查询的兼容校验，避免已缓存旧列表的客户端查询原始名时 404。
  const ids = Object.keys(routing.modelRegistry.entries)
    .map(value => value.trim())
    .filter(Boolean);
  const knownIds = new Set(
    Object.values(routing.modelRegistry.entries)
      .flatMap(entry => [entry.canonicalName, ...entry.aliases])
      .map(value => value.trim())
      .filter(Boolean)
  );
  if (requestedId && !knownIds.has(requestedId)) {
    return { statusCode: 404, body: { error: { type: 'not_found', message: 'Model not found' } } };
  }
  const limitValue = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('limit');
  const limit =
    limitValue && /^\d+$/.test(limitValue) ? Math.max(0, Number(limitValue)) : ids.length;
  const selectedIds = requestedId ? [requestedId] : ids.slice(0, limit);
  const data = selectedIds.map(modelId => ({
    id: modelId,
    object: 'model',
    created: 0,
    owned_by: 'api-detect-tools',
  }));
  const anthropic = Boolean(req.headers['anthropic-version'] || req.headers['anthropic-beta']);
  return {
    statusCode: 200,
    body: anthropic
      ? {
          data: data.map(item => ({
            id: item.id,
            type: 'model',
            display_name: item.id,
            created_at: new Date(0).toISOString(),
          })),
        }
      : { object: 'list', data },
  };
}

function inferSourceProtocol(requestUrl: string | undefined): ConcreteCliTargetProtocol | null {
  const pathname = getRequestPathname(requestUrl);
  if (pathname === '/v1/messages' || pathname.startsWith('/v1/messages/')) {
    return 'anthropic-messages';
  }
  if (
    pathname === '/v1/responses' ||
    pathname.startsWith('/v1/responses/') ||
    pathname === '/v1/conversations' ||
    pathname.startsWith('/v1/conversations/')
  ) {
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
  const normalizedMethod = (method || 'GET').toUpperCase();
  if (
    normalizedMethod === 'GET' &&
    (pathname === '/v1/models' || /^\/v1\/models\/[^/]+$/.test(pathname))
  ) {
    return {
      protocol: 'openai-chat-completions',
      operation: 'models.list',
      capability: 'model-discovery',
    };
  }
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

  if (matches('POST', CLAUDE_COUNT_TOKENS_PATH)) {
    return { protocol, operation: 'input_tokens.count', capability: 'stateless-native-only' };
  }

  const responseResourceMatch = pathname.match(/^\/v1\/responses\/([^/]+)$/);
  if (responseResourceMatch && ['GET', 'DELETE'].includes(normalizedMethod)) {
    return {
      protocol: 'openai-responses',
      operation: normalizedMethod === 'DELETE' ? 'response.delete' : 'response.retrieve',
      capability: 'stateful-native',
      resourceId: decodeURIComponent(responseResourceMatch[1]),
    };
  }
  const responseActionMatch = pathname.match(/^\/v1\/responses\/([^/]+)\/(cancel|input_items)$/);
  if (
    responseActionMatch &&
    ((normalizedMethod === 'POST' && responseActionMatch[2] === 'cancel') ||
      (normalizedMethod === 'GET' && responseActionMatch[2] === 'input_items'))
  ) {
    return {
      protocol: 'openai-responses',
      operation:
        responseActionMatch[2] === 'cancel' ? 'response.cancel' : 'response.input_items.list',
      capability: 'stateful-native',
      resourceId: decodeURIComponent(responseActionMatch[1]),
    };
  }

  const statefulOperation =
    pathname === '/v1/conversations' ||
    pathname.startsWith('/v1/conversations/') ||
    matches('POST', '/v1/messages/batches') ||
    matches('GET', '/v1/messages/batches') ||
    matches('GET', /^\/v1\/messages\/batches\/[^/]+$/) ||
    matches('DELETE', /^\/v1\/messages\/batches\/[^/]+$/) ||
    matches('POST', /^\/v1\/messages\/batches\/[^/]+\/cancel$/) ||
    matches('GET', /^\/v1\/messages\/batches\/[^/]+\/results$/) ||
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

export function findProviderOwnedStateReference(body: unknown): string | null {
  const record = asRecord(body);
  if (!record) {
    return null;
  }

  const conversation = record.conversation;
  if (
    conversation !== undefined &&
    conversation !== null &&
    (typeof conversation !== 'string' || conversation.trim().length > 0)
  ) {
    return 'conversation';
  }
  if (record.container !== undefined && record.container !== null && record.container !== '') {
    return 'container';
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

interface ResponsesStateRequest {
  resourceId?: string;
  createsResource: boolean;
  resourceType: 'response';
  removesResource?: boolean;
}

function classifyResponsesStateRequest(
  endpointOperation: RouteEndpointOperation,
  body: unknown
): ResponsesStateRequest | null {
  if (endpointOperation.protocol !== 'openai-responses') {
    return null;
  }
  if (endpointOperation.capability === 'stateful-native' && endpointOperation.resourceId) {
    return {
      resourceId: endpointOperation.resourceId,
      createsResource: false,
      resourceType: 'response',
      removesResource: endpointOperation.operation === 'response.delete',
    };
  }
  if (endpointOperation.operation !== 'generation.create') {
    return null;
  }

  const record = asRecord(body);
  const previousResponseId =
    typeof record?.previous_response_id === 'string' ? record.previous_response_id.trim() : '';
  const resourceId = previousResponseId || undefined;
  const createsResource = record?.store !== false;
  return resourceId || createsResource
    ? { resourceId, createsResource, resourceType: 'response' }
    : null;
}

function writeStateAffinityError(
  res: http.ServerResponse,
  statusCode: number,
  error: string,
  message: string
): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'X-Route-Proxy-Error': error,
  });
  res.end(
    JSON.stringify({
      error: {
        message,
        type: 'invalid_request_error',
        param: null,
        code: error,
      },
    })
  );
}

function buildAffinityChannel(
  record: RouteStateAffinityRecord,
  sourceProtocol: ConcreteCliTargetProtocol,
  canonicalModel: string | null,
  resolvedModel: string | null
): ResolvedChannel {
  return {
    routeRuleId: record.routeRuleId,
    siteId: record.siteId,
    accountId: record.accountId,
    apiKeyId: record.apiKeyId,
    sourceProtocol,
    canonicalModel: canonicalModel || undefined,
    resolvedModel: resolvedModel || undefined,
    targetProtocol: record.targetProtocol,
    targetEndpoint: record.targetEndpoint,
  };
}

function extractResponseResourceId(body: Buffer): string | null {
  try {
    const id = asRecord(JSON.parse(body.toString('utf-8')))?.id;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

function extractResponseResourceIdFromSse(body: Buffer): string | null {
  for (const block of parseSseBlocks(body.toString('utf-8'))) {
    if (!block.data || block.data === '[DONE]') continue;
    const event = parseSseJsonRecord(block.data);
    const response = asRecord(event?.response);
    const id = response?.id ?? event?.id;
    if (typeof id === 'string' && id.trim()) {
      return id.trim();
    }
  }
  return null;
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
  sourceProtocol: ConcreteCliTargetProtocol,
  nativePassthroughChannels: WeakSet<ResolvedChannel>
): ResolvedChannel {
  const upstreamProtocol = resolveChannelUpstreamProtocol(channel.targetProtocol, sourceProtocol);
  const resolvedChannel =
    upstreamProtocol === channel.targetProtocol
      ? channel
      : { ...channel, targetProtocol: upstreamProtocol };
  if (upstreamProtocol === sourceProtocol) {
    nativePassthroughChannels.add(resolvedChannel);
  }
  return resolvedChannel;
}

function getAdapterCliTypeForProtocol(protocol: ConcreteCliTargetProtocol): RouteCliType {
  return protocol === 'anthropic-messages' ? 'claudeCode' : 'codex';
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
  if (anyRouterAdapter.type !== 'transparent') return false;
  if (protocolAdapters.every(adapter => adapter.type === 'transparent')) return true;
  return getIncrementalProtocolResponseAdapter(protocolAdapters) !== null;
}

type SourceProtocolResponseAdapter = Extract<CliProtocolResponseAdapter, { type: 'source' }>;

function getIncrementalProtocolResponseAdapter(
  protocolAdapters: CliProtocolResponseAdapter[]
): SourceProtocolResponseAdapter | null {
  if (protocolAdapters.length !== 1) return null;
  const adapter = protocolAdapters[0];
  return adapter.type === 'source' &&
    adapter.stream &&
    adapter.sourceProtocol !== undefined &&
    adapter.sourceProtocol !== adapter.targetProtocol
    ? adapter
    : null;
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

type StreamingTerminalProtocol = StreamingValidationProtocol | 'none';

function getStreamingTerminalProtocolForWireProtocol(
  protocol: StreamingProtocol
): StreamingTerminalProtocol {
  if (protocol === 'anthropic-messages') return 'anthropic';
  if (protocol === 'openai-responses') return 'openaiResponses';
  return 'openaiChat';
}
interface ParsedSseBlock {
  event?: string;
  data: string;
}

interface StreamingSseObservationState {
  buffer: Buffer;
  errorSeen: boolean;
  failureCode?: string;
  nextSequenceNumber: number;
  terminalSeen: boolean;
}

interface AnthropicSseCompatibilityNormalizerState {
  decodeBlock: (block: Buffer) => string;
  frameBuffer: IncrementalSseFrameBuffer;
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

function getStreamingTerminalProtocol(requestUrl?: string): StreamingTerminalProtocol {
  const sourceProtocol = inferSourceProtocol(requestUrl);
  if (sourceProtocol === 'anthropic-messages') return 'anthropic';
  if (sourceProtocol === 'openai-responses') return 'openaiResponses';
  if (sourceProtocol === 'openai-chat-completions') return 'openaiChat';
  return 'none';
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

function hasNativeResponsesOutputBeforeFrameBoundary(chunk: Buffer): boolean {
  for (const block of parseSseBlocks(chunk.toString('utf-8'))) {
    const payload = parseSseJsonRecord(block.data);
    const eventType = readString(payload?.type) || block.event || '';
    if (eventType === 'response.output_text.delta' || eventType === 'response.output_text.done') {
      if (readString(payload?.delta).trim() || readString(payload?.text).trim()) return true;
    }
    if (
      eventType === 'response.function_call_arguments.delta' ||
      eventType === 'response.function_call_arguments.done'
    ) {
      if (readString(payload?.delta).trim() || readString(payload?.arguments).trim()) return true;
    }
  }
  return false;
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
    const response = asRecord(payload?.response);
    const error = asRecord(payload?.error) || asRecord(response?.error);
    state.failureCode =
      readString(error?.type) || readString(error?.code) || eventType || 'unknown_error';
    state.terminalSeen = true;
    return;
  }

  if (protocol === 'anthropic') {
    state.terminalSeen = state.terminalSeen || eventType === 'message_stop';
    return;
  }

  if (protocol === 'openaiResponses') {
    if (eventType === 'response.failed') {
      state.errorSeen = true;
      const response = asRecord(payload?.response);
      const error = asRecord(payload?.error) || asRecord(response?.error);
      state.failureCode =
        readString(error?.type) || readString(error?.code) || eventType || 'unknown_error';
    }
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
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return {
    decodeBlock: block => decoder.decode(block),
    frameBuffer: new IncrementalSseFrameBuffer(STREAMING_VALIDATION_MAX_SSE_FRAME_BYTES),
    openBlocks: new Map(),
    completedToolBlocks: 0,
  };
}

function serializeSseBlock(event: string | undefined, data: string): string {
  return `${event ? `event: ${event}\n` : ''}data: ${data}\n\n`;
}

function normalizeAnthropicSseCompatibilityBlock(
  state: AnthropicSseCompatibilityNormalizerState,
  rawBlock: Buffer
): Buffer {
  let decodedBlock: string;
  try {
    decodedBlock = state.decodeBlock(rawBlock);
  } catch {
    return rawBlock;
  }
  const blocks = parseSseBlocks(decodedBlock);
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

  return Buffer.from(
    serializeSseBlock(
      block.event,
      JSON.stringify({
        ...payload,
        delta: {
          ...delta,
          stop_reason: 'tool_use',
        },
      })
    ),
    'utf-8'
  );
}

function normalizeAnthropicSseCompatibilityChunk(
  state: AnthropicSseCompatibilityNormalizerState,
  chunk: Buffer
): Buffer[] {
  return [...state.frameBuffer.push(chunk)].map(block =>
    normalizeAnthropicSseCompatibilityBlock(state, block)
  );
}

function flushAnthropicSseCompatibilityNormalizer(
  state: AnthropicSseCompatibilityNormalizerState
): Buffer {
  return state.frameBuffer.hasTail ? state.frameBuffer.takeTail() : Buffer.alloc(0);
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

interface SseFrameBoundary {
  end: number;
  separatorStart: number;
}

function findValidatedSseFrameBoundary(buffer: Buffer, startIndex = 0): SseFrameBoundary | null {
  for (let index = Math.max(0, startIndex); index < buffer.length; index += 1) {
    const firstEndingBytes =
      buffer[index] === 0x0a
        ? 1
        : buffer[index] === 0x0d && buffer[index + 1] === 0x0a
          ? 2
          : buffer[index] === 0x0d
            ? 1
            : 0;
    if (!firstEndingBytes) continue;

    const nextIndex = index + firstEndingBytes;
    const secondEndingBytes =
      buffer[nextIndex] === 0x0a
        ? 1
        : buffer[nextIndex] === 0x0d && buffer[nextIndex + 1] === 0x0a
          ? 2
          : buffer[nextIndex] === 0x0d
            ? 1
            : 0;
    if (secondEndingBytes) {
      return { end: nextIndex + secondEndingBytes, separatorStart: index };
    }
    index += firstEndingBytes - 1;
  }
  return null;
}

class IncrementalSseFrameBuffer {
  private static readonly MAX_DELIMITER_BYTES = 4;
  private buffer = Buffer.alloc(0);
  private length = 0;
  private scanOffset = 0;

  constructor(private readonly maxFrameBytes: number) {}

  *push(chunk: Buffer): Generator<Buffer> {
    let chunkOffset = 0;

    while (chunkOffset < chunk.length) {
      this.ensureWritableCapacity();
      const copyBytes = Math.min(this.buffer.length - this.length, chunk.length - chunkOffset);
      chunk.copy(this.buffer, this.length, chunkOffset, chunkOffset + copyBytes);
      this.length += copyBytes;
      chunkOffset += copyBytes;

      yield* this.drainFrames();

      if (this.length >= this.maxBufferedBytes) {
        throw this.buildFrameTooLargeError();
      }
    }
  }

  takeTail(): Buffer {
    const tail = Buffer.from(this.buffer.subarray(0, this.length));
    this.length = 0;
    this.scanOffset = 0;
    return tail;
  }

  get hasTail(): boolean {
    return this.length > 0;
  }

  private get maxBufferedBytes(): number {
    return this.maxFrameBytes + IncrementalSseFrameBuffer.MAX_DELIMITER_BYTES;
  }

  private *drainFrames(): Generator<Buffer> {
    const frames: Buffer[] = [];
    let frameStart = 0;
    let searchOffset = this.scanOffset;

    for (;;) {
      const boundary = findValidatedSseFrameBoundary(
        this.buffer.subarray(0, this.length),
        searchOffset
      );
      if (!boundary) break;
      if (boundary.separatorStart - frameStart > this.maxFrameBytes) {
        throw this.buildFrameTooLargeError();
      }
      frames.push(Buffer.from(this.buffer.subarray(frameStart, boundary.end)));
      frameStart = boundary.end;
      searchOffset = boundary.end;
    }

    if (frameStart > 0) {
      this.buffer.copyWithin(0, frameStart, this.length);
      this.length -= frameStart;
    }
    this.scanOffset = Math.max(0, this.length - 3);
    yield* frames;
  }

  private ensureWritableCapacity(): void {
    if (this.length < this.buffer.length) return;
    if (this.length >= this.maxBufferedBytes) throw this.buildFrameTooLargeError();

    const nextCapacity = Math.min(
      this.maxBufferedBytes,
      Math.max(4096, this.buffer.length * 2, this.length + 1)
    );
    const nextBuffer = Buffer.allocUnsafe(nextCapacity);
    this.buffer.copy(nextBuffer, 0, 0, this.length);
    this.buffer = nextBuffer;
  }

  private buildFrameTooLargeError(): StreamingProtocolValidationError {
    return new StreamingProtocolValidationError(
      'sse_frame_too_large',
      'upstream emitted an SSE frame above the safety limit'
    );
  }
}

function buildNativeAnthropicSseGuardFailure(
  reason: string,
  message: string
): CompletedStreamValidation {
  return { ok: false, reason, message };
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
  return error instanceof NativeAnthropicSseGuardError ||
    error instanceof StreamingProtocolValidationError
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

function isRetryableEmptyStreamingResponse(error: unknown): boolean {
  return error instanceof Error && error.message === EMPTY_STREAMING_RESPONSE_ERROR;
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

function summarizeTargetLockUpstreamBody(body: Buffer): string | undefined {
  return summarizeUpstreamFailureBodyRaw(body, 2000) || undefined;
}

function buildRouteProxyErrorText(error: string, message: string): string {
  return JSON.stringify({ error, message });
}

function recordTargetLockFirstUpstreamResult(params: {
  routeApiKey: string;
  cliType: RouteCliType;
  lock: RouteTargetLock;
  success: boolean;
  statusCode?: number;
  body?: Buffer;
  error?: string;
  terminal?: boolean;
}): void {
  recordRouteTargetLockFirstUpstreamResult(
    {
      routeApiKey: params.routeApiKey,
      cliType: params.cliType,
      success: params.success,
      finishedAt: Date.now(),
      lock: params.lock,
      ...(params.statusCode !== undefined ? { statusCode: params.statusCode } : {}),
      ...(params.body ? { responseSummary: summarizeTargetLockUpstreamBody(params.body) } : {}),
      ...(params.error ? { error: params.error } : {}),
    },
    { terminal: params.terminal ?? true }
  );
}

function notifyTargetLockTerminalFailure(params: {
  routeApiKey: string;
  cliType: RouteCliType;
  terminalError: string;
  statusCode?: number;
  lock?: RouteTargetLock | null;
}): void {
  notifyRouteTargetLockTerminalFailure({
    routeApiKey: params.routeApiKey,
    cliType: params.cliType,
    terminalError: params.terminalError,
    ...(params.statusCode !== undefined ? { statusCode: params.statusCode } : {}),
    ...(params.lock ? { lock: params.lock } : {}),
  });
}

function writeTargetLockTerminalFailureResponse(
  res: http.ServerResponse,
  failure: RouteTargetLockTerminalFailure
): void {
  const body =
    failure.terminalError.trim() ||
    buildRouteProxyErrorText('all_channels_failed', 'Target-locked request aborted');
  const contentType =
    body.startsWith('{') || body.startsWith('[')
      ? 'application/json; charset=utf-8'
      : 'text/plain; charset=utf-8';
  res.writeHead(failure.statusCode ?? 502, { 'Content-Type': contentType });
  res.end(body);
}

function buildTargetLockUpstreamAttemptExhaustedErrorText(): string {
  return buildRouteProxyErrorText(
    TARGET_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_ERROR_CODE,
    'Endpoint-test target lock upstream attempt budget exhausted'
  );
}

// 瞬时(可重试)上游状态：网关抖动/限流/超时，不应被当作 CLI 终结失败。
const TRANSIENT_UPSTREAM_STATUS_CODES = new Set([
  408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 529, 530,
]);

type UpstreamAuthScheme = 'native' | 'bearer' | 'x-api-key';
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
  void cliType;
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
      normalizedHeaderName.startsWith('x-api-detect-') ||
      normalizedHeaderName.startsWith('x-grok-')
    ) {
      delete forwardHeaders[headerName];
    }
  }

  if (authScheme === 'bearer') {
    forwardHeaders.authorization = `Bearer ${apiKey}`;
  } else if (authScheme === 'x-api-key' || (authScheme === 'native' && cliType === 'claudeCode')) {
    forwardHeaders['x-api-key'] = apiKey;
  } else {
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
  const requestTarget = new URL(requestUrl || '/', 'http://127.0.0.1');
  const baseSegments = target.pathname.split('/').filter(Boolean);
  const requestSegments = requestTarget.pathname.split('/').filter(Boolean);
  let overlap = Math.min(baseSegments.length, requestSegments.length);
  while (
    overlap > 0 &&
    !baseSegments
      .slice(baseSegments.length - overlap)
      .every((segment, index) => segment === requestSegments[index])
  ) {
    overlap -= 1;
  }
  target.pathname = `/${[...baseSegments, ...requestSegments.slice(overlap)].join('/')}`;
  for (const [name, value] of requestTarget.searchParams) target.searchParams.set(name, value);
  target.hash = '';

  return {
    url: target.toString(),
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

function writeTokenCountUnsupported(res: http.ServerResponse, reason: string): void {
  res.writeHead(501, {
    'Content-Type': 'application/json',
    'X-Route-Proxy-Error': 'token_count_unsupported',
  });
  res.end(
    JSON.stringify({
      type: 'error',
      error: {
        type: 'not_supported_error',
        message: 'Exact token counting is unavailable for the selected route',
      },
      reason,
    })
  );
}

interface ForwardToUpstreamOptions {
  upstreamProxyUrl?: string;
  additionalHeaders?: Record<string, string>;
  methodOverride?: string;
  requestUrlOverride?: string;
  upstreamCliType?: RouteCliType;
  upstreamAuthScheme?: 'bearer' | 'x-api-key';
  signal?: AbortSignal;
  streamResponse?: http.ServerResponse;
  streamResponseBody?: boolean;
  streamResponseAdapter?: SourceProtocolResponseAdapter;
  nativeResponsePassthrough?: boolean;
  streamIdleTimeoutMs?: number;
  beforeStreamCommit?: (bufferedBody: Buffer) => Promise<void>;
  onStreamCompletionDelivered?: () => void;
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
    options.upstreamAuthScheme === 'x-api-key'
      ? 'x-api-key'
      : options.upstreamAuthScheme === 'bearer'
        ? 'bearer'
        : resolveUpstreamAuthScheme(targetBaseUrl) === 'bearer'
          ? 'bearer'
          : upstreamCliType === 'claudeCode'
            ? 'x-api-key'
            : 'bearer'
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
  let receivedUpstreamStreamingChunk = false;
  const initialStreamingBuffer = Buffer.alloc(INITIAL_STREAM_VALIDATION_MAX_BYTES + 1);
  let initialStreamingBytes = 0;
  let pendingStreamingChunks: Buffer[] = [];
  let pendingStreamingBytes = 0;
  const streamingResponsePreview = Buffer.alloc(INITIAL_STREAM_VALIDATION_MAX_BYTES);
  let streamingResponsePreviewBytes = 0;
  const incrementalValidationBuffer = new IncrementalSseFrameBuffer(
    STREAMING_VALIDATION_MAX_SSE_FRAME_BYTES
  );
  let initialStreamAccepted = false;
  const incrementalProtocolTransformer = options.streamResponseAdapter?.sourceProtocol
    ? new IncrementalProtocolSseTransformer({
        sourceProtocol: options.streamResponseAdapter.sourceProtocol,
        targetProtocol: options.streamResponseAdapter.targetProtocol,
        model: options.streamResponseAdapter.model,
      })
    : null;
  const streamingTerminalProtocol = incrementalProtocolTransformer
    ? getStreamingTerminalProtocolForWireProtocol(options.streamResponseAdapter!.sourceProtocol!)
    : getStreamingTerminalProtocol(requestUrl);
  const anthropicStreamNormalizer =
    !options.nativeResponsePassthrough && streamingTerminalProtocol === 'anthropic'
      ? createAnthropicSseCompatibilityNormalizer()
      : null;
  const nativeAnthropicStreamGuard =
    options.nativeResponsePassthrough && streamingTerminalProtocol === 'anthropic'
      ? createNativeAnthropicSseGuard()
      : null;
  const incrementalStreamingValidator =
    streamingTerminalProtocol !== 'none' &&
    (!options.nativeResponsePassthrough || streamingTerminalProtocol === 'openaiResponses')
      ? createIncrementalStreamingValidator(streamingTerminalProtocol, {
          strict: !options.nativeResponsePassthrough,
          extractUsage: extractUsageFromParsed,
        })
      : null;
  const strictIncrementalValidation = Boolean(
    incrementalStreamingValidator && !options.nativeResponsePassthrough
  );
  const streamingObservation = createStreamingSseObservationState(streamingTerminalProtocol);
  let streamingErrorWritten = false;
  let streamingCompletionNotified = false;
  let streamingSemanticError: typeof EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE | undefined;
  const inspectNativeOpenAiResponsesBeforeCommit =
    options.nativeResponsePassthrough && streamingTerminalProtocol === 'openaiResponses';
  const isStreamingErrorSeen = (): boolean =>
    streamingErrorWritten ||
    (incrementalStreamingValidator
      ? incrementalStreamingValidator.getState().errorSeen
      : streamingObservation.errorSeen);
  const isStreamingTerminalSeen = (): boolean =>
    incrementalStreamingValidator
      ? incrementalStreamingValidator.getState().terminalSeen
      : streamingObservation.terminalSeen;
  const getStreamingFailureCode = (): string | undefined =>
    incrementalStreamingValidator
      ? incrementalStreamingValidator.getState().failureCode
      : streamingObservation.failureCode;
  const getStreamingNextSequenceNumber = (): number =>
    incrementalStreamingValidator
      ? incrementalStreamingValidator.getState().nextSequenceNumber
      : streamingObservation.nextSequenceNumber;
  const isStreamingCompletionValidated = (): boolean => {
    const state = incrementalStreamingValidator?.getState();
    return Boolean(
      state?.terminalSeen && !state.errorSeen && state.completedValidation?.ok === true
    );
  };

  const writeStreamingError = async (message: string): Promise<void> => {
    if (
      !streamed ||
      isStreamingErrorSeen() ||
      options.streamResponse?.writableEnded ||
      options.streamResponse?.destroyed
    ) {
      return;
    }

    streamingErrorWritten = true;
    await writeResponseChunk(
      options.streamResponse!,
      buildStreamingErrorChunk(streamingTerminalProtocol, message, getStreamingNextSequenceNumber())
    );
  };

  const notifyStreamCompletionIfDelivered = (): void => {
    if (streamingCompletionNotified || streamingSemanticError) return;
    const state = incrementalStreamingValidator?.getState();
    const completionDelivered = options.nativeResponsePassthrough
      ? (state?.terminalSeen ?? streamingObservation.terminalSeen) &&
        !(state?.errorSeen ?? streamingObservation.errorSeen)
      : isStreamingCompletionValidated();
    if (!completionDelivered) return;
    streamingCompletionNotified = true;
    options.onStreamCompletionDelivered?.();
  };

  const appendStreamingPreview = (chunk: Buffer): void => {
    const previewBytesRemaining =
      INITIAL_STREAM_VALIDATION_MAX_BYTES - streamingResponsePreviewBytes;
    if (previewBytesRemaining > 0) {
      const previewBytes = Math.min(previewBytesRemaining, chunk.length);
      chunk.copy(streamingResponsePreview, streamingResponsePreviewBytes, 0, previewBytes);
      streamingResponsePreviewBytes += previewBytes;
    }
  };

  const commitPendingStreamingChunks = async (): Promise<void> => {
    if (
      streamed ||
      streamingSemanticError ||
      !initialStreamAccepted ||
      !streamingStatusCode ||
      !streamingHeaders ||
      pendingStreamingChunks.length === 0
    ) {
      return;
    }

    if (options.beforeStreamCommit) {
      const bufferedBody =
        pendingStreamingChunks.length === 1
          ? pendingStreamingChunks[0]
          : Buffer.concat(pendingStreamingChunks, pendingStreamingBytes);
      await options.beforeStreamCommit(bufferedBody);
    }
    streamed = true;
    options.streamResponse!.writeHead(streamingStatusCode, streamingHeaders);
    const chunksToWrite = pendingStreamingChunks;
    pendingStreamingChunks = [];
    pendingStreamingBytes = 0;
    for (const pendingChunk of chunksToWrite) {
      await writeResponseChunk(options.streamResponse!, pendingChunk);
    }
    notifyStreamCompletionIfDelivered();
  };

  const queueOrWriteStreamingChunk = async (
    outgoingChunk: Buffer,
    deferCommit: boolean
  ): Promise<void> => {
    if (!streamingStatusCode || !streamingHeaders || !outgoingChunk.length) return;
    if (streamingSemanticError) return;
    appendStreamingPreview(outgoingChunk);

    if (streamed) {
      await writeResponseChunk(options.streamResponse!, outgoingChunk);
      notifyStreamCompletionIfDelivered();
      return;
    }

    pendingStreamingChunks.push(outgoingChunk);
    pendingStreamingBytes += outgoingChunk.length;
    const initialBytesRemaining = initialStreamingBuffer.length - initialStreamingBytes;
    if (initialBytesRemaining > 0) {
      const initialBytes = Math.min(initialBytesRemaining, outgoingChunk.length);
      outgoingChunk.copy(initialStreamingBuffer, initialStreamingBytes, 0, initialBytes);
      initialStreamingBytes += initialBytes;
    }
    const initialStreamingView = initialStreamingBuffer.subarray(0, initialStreamingBytes);
    const initialValidation = validateInitialEventStreamChunk(initialStreamingView);
    if (initialValidation.status === 'rejected') {
      throw new Error(`invalid_streaming_response:${initialValidation.reason}`);
    }
    if (initialValidation.status === 'pending') return;
    initialStreamAccepted = true;

    if (inspectNativeOpenAiResponsesBeforeCommit) {
      const state = incrementalStreamingValidator!.getState();
      const outputSeen =
        state.outputSeen || hasNativeResponsesOutputBeforeFrameBoundary(initialStreamingView);
      if (state.terminalSeen && !state.errorSeen && state.explicitZeroUsage && !outputSeen) {
        streamingSemanticError = EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE;
        pendingStreamingChunks = [];
        pendingStreamingBytes = 0;
        return;
      }
      if (
        !outputSeen &&
        !state.terminalSeen &&
        pendingStreamingBytes < NATIVE_OPENAI_RESPONSES_SSE_MAX_PRECOMMIT_BYTES
      ) {
        return;
      }
    }

    if (deferCommit && pendingStreamingBytes < NATIVE_OPENAI_RESPONSES_SSE_MAX_PRECOMMIT_BYTES) {
      return;
    }
    await commitPendingStreamingChunks();
  };

  const validateOutgoingFrame = async (frame: Buffer): Promise<void> => {
    try {
      incrementalStreamingValidator!.push(frame);
      const completedValidation = incrementalStreamingValidator!.getState().completedValidation;
      if (completedValidation && !completedValidation.ok) {
        throw new StreamingProtocolValidationError(
          completedValidation.reason,
          completedValidation.message
        );
      }
    } catch (error: unknown) {
      if (streamed && error instanceof StreamingProtocolValidationError) {
        await writeStreamingError(readStreamingValidationMessage(error));
      }
      throw error;
    }
  };

  const processStreamingOutgoingChunks = async (
    outgoingChunks: Iterable<Buffer>
  ): Promise<void> => {
    for (const outgoingChunk of outgoingChunks) {
      if (!streamingStatusCode || !streamingHeaders || !outgoingChunk.length) continue;

      if (strictIncrementalValidation) {
        try {
          for (const frame of incrementalValidationBuffer.push(outgoingChunk)) {
            await validateOutgoingFrame(frame);
            await queueOrWriteStreamingChunk(frame, true);
          }
        } catch (error: unknown) {
          if (streamed && error instanceof StreamingProtocolValidationError) {
            await writeStreamingError(readStreamingValidationMessage(error));
          }
          throw error;
        }
        if (
          !streamed &&
          initialStreamAccepted &&
          pendingStreamingBytes >= NATIVE_OPENAI_RESPONSES_SSE_MAX_PRECOMMIT_BYTES
        ) {
          await commitPendingStreamingChunks();
        }
        continue;
      }

      if (incrementalStreamingValidator) {
        incrementalStreamingValidator.push(outgoingChunk);
      } else {
        observeStreamingSseChunk(streamingObservation, streamingTerminalProtocol, outgoingChunk);
      }
      await queueOrWriteStreamingChunk(outgoingChunk, false);
    }

    if (strictIncrementalValidation) {
      await commitPendingStreamingChunks();
    }
  };

  let response: Awaited<ReturnType<typeof httpRawRequest>>;
  try {
    response =
      options.streamResponse && options.streamResponseBody
        ? await httpRawStreamRequest(target.url, {
            ...requestConfig,
            ...(!options.nativeResponsePassthrough ? { retainStreamedBody: false } : {}),
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
              if (!streamingStatusCode || !streamingHeaders || !chunk.length) return;
              receivedUpstreamStreamingChunk = true;
              try {
                const outgoingChunks = incrementalProtocolTransformer
                  ? incrementalProtocolTransformer.transform(chunk)
                  : nativeAnthropicStreamGuard
                    ? processNativeAnthropicSseGuardChunk(nativeAnthropicStreamGuard, chunk)
                    : anthropicStreamNormalizer
                      ? normalizeAnthropicSseCompatibilityChunk(anthropicStreamNormalizer, chunk)
                      : [chunk];
                await processStreamingOutgoingChunks(outgoingChunks);
              } catch (error: unknown) {
                if (streamed && error instanceof NativeAnthropicSseGuardError) {
                  await writeStreamingError(readStreamingValidationMessage(error));
                }
                throw error;
              }
            },
            streamIdleTimeout: options.streamIdleTimeoutMs,
            shouldResolveOnAbort: () =>
              !options.nativeResponsePassthrough && streamed && isStreamingCompletionValidated(),
          })
        : await httpRawRequest(target.url, requestConfig);
  } catch (error: unknown) {
    if (!incrementalStreamingValidator) {
      observeStreamingSseChunk(
        streamingObservation,
        streamingTerminalProtocol,
        Buffer.alloc(0),
        true
      );
    }
    const upstreamFailureCode = getStreamingFailureCode();
    if (upstreamFailureCode) {
      throw new Error(`upstream_streaming_error:${upstreamFailureCode}`);
    }
    if (
      streamed &&
      !options.signal?.aborted &&
      !isStreamingErrorSeen() &&
      !isStreamingTerminalSeen()
    ) {
      await writeStreamingError('upstream stream terminated unexpectedly');
    }
    throw error;
  }

  if (
    options.streamResponse &&
    options.streamResponseBody &&
    streamingStatusCode !== undefined &&
    !receivedUpstreamStreamingChunk
  ) {
    throw new Error(EMPTY_STREAMING_RESPONSE_ERROR);
  }

  if (
    options.streamResponse &&
    options.streamResponseBody &&
    streamingStatusCode !== undefined &&
    anthropicStreamNormalizer
  ) {
    await processStreamingOutgoingChunks([
      flushAnthropicSseCompatibilityNormalizer(anthropicStreamNormalizer),
    ]);
  }

  if (
    options.streamResponse &&
    options.streamResponseBody &&
    streamingStatusCode !== undefined &&
    nativeAnthropicStreamGuard
  ) {
    try {
      await processStreamingOutgoingChunks(
        flushNativeAnthropicSseGuard(nativeAnthropicStreamGuard)
      );
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
    streamingStatusCode !== undefined &&
    incrementalProtocolTransformer
  ) {
    try {
      await processStreamingOutgoingChunks(incrementalProtocolTransformer.finish());
    } catch (error: unknown) {
      const upstreamFailureCode = getStreamingFailureCode();
      if (upstreamFailureCode) {
        throw new Error(`upstream_streaming_error:${upstreamFailureCode}`);
      }
      if (
        streamed &&
        !options.signal?.aborted &&
        !isStreamingErrorSeen() &&
        !isStreamingTerminalSeen()
      ) {
        await writeStreamingError(readStreamingValidationMessage(error));
      }
      throw error;
    }
  }

  if (strictIncrementalValidation && incrementalValidationBuffer.hasTail) {
    const tail = incrementalValidationBuffer.takeTail();
    try {
      incrementalStreamingValidator!.push(tail);
    } catch (error: unknown) {
      if (streamed && error instanceof StreamingProtocolValidationError) {
        await writeStreamingError(readStreamingValidationMessage(error));
      }
      throw error;
    }
  }

  const completedStreamingValidation =
    streamingStatusCode !== undefined ? incrementalStreamingValidator?.finish() : undefined;
  if (streamingStatusCode !== undefined && !incrementalStreamingValidator) {
    observeStreamingSseChunk(
      streamingObservation,
      streamingTerminalProtocol,
      Buffer.alloc(0),
      true
    );
  }

  const upstreamStreamingFailureCode = getStreamingFailureCode();

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
    streamingStatusCode !== undefined &&
    completedStreamingValidation &&
    !completedStreamingValidation.ok &&
    !(options.nativeResponsePassthrough && streamingSemanticError && !streamed)
  ) {
    const missingTerminal = [
      'missing_message_stop',
      'missing_response_terminal',
      'missing_chat_done',
    ].includes(completedStreamingValidation.reason);
    const preservesNativeZeroUsageReason =
      options.nativeResponsePassthrough &&
      streamingTerminalProtocol === 'openaiResponses' &&
      completedStreamingValidation.reason === 'empty_response_zero_usage';
    const error = missingTerminal
      ? 'incomplete_streaming_response:missing_terminal_event'
      : preservesNativeZeroUsageReason
        ? 'empty_response_zero_usage'
        : `malformed_streaming_response:${completedStreamingValidation.reason}`;
    await writeStreamingError(
      missingTerminal
        ? 'upstream stream ended before terminal SSE event'
        : completedStreamingValidation.message
    );
    throw new Error(error);
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

  const streamedUsage =
    streamed && incrementalStreamingValidator && !options.nativeResponsePassthrough
      ? finalizeRouteUsage(incrementalStreamingValidator.getUsage())
      : undefined;
  const responseBody =
    streamed && incrementalStreamingValidator && !options.nativeResponsePassthrough
      ? streamingResponsePreview.subarray(0, streamingResponsePreviewBytes)
      : response.body;

  return {
    statusCode: response.status || 500,
    headers: response.headers,
    body: responseBody,
    latencyMs: Date.now() - startTime,
    firstByteLatencyMs: response.firstByteLatencyMs,
    usage: streamedUsage ?? extractUsageFromBody(response.body),
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
  let routeAgentId: string | undefined;
  let routeAgentName: string | undefined;
  type RouteCancellationLogContext = Omit<
    Parameters<typeof recordRouteRequest>[0],
    | 'requestSelectionStartedAt'
    | 'agentId'
    | 'agentName'
    | 'outcome'
    | 'statusCode'
    | 'error'
    | 'at'
  >;
  let routeCancellationLogContext: RouteCancellationLogContext | undefined;
  let routeClientCancellationLogged = false;
  const recordedRouteRequestAttempts = new Set<number>();
  const recordRequestForSelection = (params: Parameters<typeof recordRouteRequest>[0]): void => {
    if (routeClientCancellationLogged) {
      return;
    }
    recordRouteRequest({
      ...params,
      requestSelectionStartedAt,
      agentId: routeAgentId,
      agentName: routeAgentName,
    });
    recordedRouteRequestAttempts.add(params.attempt);
  };
  const recordRouteClientCancellation = (): void => {
    if (
      routeClientCancellationLogged ||
      !routeCancellationLogContext ||
      recordedRouteRequestAttempts.has(routeCancellationLogContext.attempt)
    ) {
      return;
    }

    routeClientCancellationLogged = true;
    recordedRouteRequestAttempts.add(routeCancellationLogContext.attempt);
    recordRouteRequest({
      ...routeCancellationLogContext,
      requestSelectionStartedAt,
      agentId: routeAgentId,
      agentName: routeAgentName,
      outcome: 'neutral',
      statusCode: ROUTE_CLIENT_CANCELLED_STATUS_CODE,
      error: ROUTE_CLIENT_CANCELLED_ERROR_CODE,
    });
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
  let routeClientCancelled = false;
  let routeStreamCompletionDelivered = false;
  let cleanupRouteCancellationListeners = () => {};
  const finishRouteHandling = () => {
    routeHandlingDone = true;
    cleanupRouteCancellationListeners();
  };
  const cancelRouteRequest = () => {
    if (routeHandlingDone || routeClientCancelled) {
      return;
    }
    routeClientCancelled = true;
    recordRouteClientCancellation();
    if (requestBodyRead && !routeAbortController.signal.aborted) {
      routeAbortController.abort(createRouteClientCancelledError());
    }
  };
  const stopRouteHandlingIfClientCancelled = (): boolean => {
    if (!routeClientCancelled && !routeAbortController.signal.aborted) {
      return false;
    }
    routeClientCancelled = true;
    recordRouteClientCancellation();
    if (requestBodyRead && !routeAbortController.signal.aborted) {
      routeAbortController.abort(createRouteClientCancelledError());
    }
    finishRouteHandling();
    return true;
  };
  const handleResponseClose = () => {
    if (res.writableEnded || routeStreamCompletionDelivered) {
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
  const initialCliType =
    detectMarkedRouteCliType(req.headers) ?? detectCliTypeFromPath(pathname) ?? 'codex';
  const requestId = nextRequestId(initialCliType);
  routeCancellationLogContext = {
    requestId,
    attempt: 0,
    cliType: initialCliType,
    canonicalModel: null,
    requestKind: 'inference',
  };
  if ((req.method || 'GET').toUpperCase() === 'HEAD' && pathname === '/') {
    recordRequestForSelection({
      ...routeCancellationLogContext,
      outcome: 'neutral',
      statusCode: 204,
    });
    res.writeHead(204);
    res.end();
    return;
  }
  const endpointOperation = classifyRouteEndpointOperation(req.method, req.url);
  if (!endpointOperation) {
    recordRequestForSelection({
      ...routeCancellationLogContext,
      outcome: 'failure',
      statusCode: 404,
      error: 'unsupported_route',
    });
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
    getAdapterCliTypeForProtocol(endpointOperation.protocol);
  if (!markedCliType && isLikelyGrokBuildRequest(req)) {
    cliType = 'grokBuild';
  } else if (!markedCliType && cliType !== 'openCode' && cliType && isLikelyOpenCodeRequest(req)) {
    cliType = 'openCode';
  }
  if (!cliType) {
    recordRequestForSelection({
      ...routeCancellationLogContext,
      outcome: 'failure',
      statusCode: 404,
      error: 'unsupported_route',
    });
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'unsupported_route', message: `No route handler for ${pathname}` })
    );
    return;
  }
  // Client markers are compatibility metadata only; pathname still determines the inbound protocol.
  const credentialCandidates = extractRouteCredentialCandidates(req);
  const targetLockCandidates = credentialCandidates
    .map(candidate => ({
      candidate,
      lock: parseTargetLockRouteApiKey(candidate.value, routing.server.unifiedApiKey),
    }))
    .filter((entry): entry is { candidate: RouteCredentialCandidate; lock: RouteTargetLock } =>
      Boolean(entry.lock)
    );
  const targetLockValues = new Set(targetLockCandidates.map(entry => entry.candidate.value));
  const credentialResolution = await resolveRouteProfileCredentialCandidates(
    credentialCandidates.filter(candidate => !targetLockValues.has(candidate.value)),
    findConfigFileProfileByRouteApiKey
  );
  const hasCredentialConflict =
    credentialResolution.status === 'ambiguous_credentials' ||
    targetLockCandidates.length > 1 ||
    (credentialResolution.status === 'resolved' && targetLockCandidates.length > 0);
  if (hasCredentialConflict) {
    recordRequestForSelection({
      ...routeCancellationLogContext,
      outcome: 'failure',
      statusCode: 401,
      error: 'ambiguous_credentials',
    });
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'ambiguous_credentials',
        message: 'Credentials resolve to multiple route identities',
      })
    );
    return;
  }

  Object.assign(routeCancellationLogContext, {
    cliType,
    requestKind:
      endpointOperation.capability === 'stateless-native-only' ? 'token-count' : 'inference',
  });
  const targetLock = targetLockCandidates[0]?.lock || null;
  const token =
    targetLockCandidates[0]?.candidate.value || credentialResolution.candidates[0]?.value || '';
  const routeProfile =
    credentialResolution.status === 'resolved' ? credentialResolution.profile : null;
  if (
    credentialResolution.status === 'resolved' &&
    credentialResolution.unknownCandidates.length > 0
  ) {
    log.warn('Ignored unknown companion route credentials', {
      profileId: credentialResolution.profile.id,
      candidateCount: credentialResolution.candidates.length,
      unknown: credentialResolution.unknownCandidates.map(candidate => ({
        sources: candidate.sources,
        fingerprint: fingerprintRouteCredential(candidate.value),
      })),
    });
  }
  if (targetLock) {
    notifyRouteTargetLockRequest(token);
  }
  if (!targetLock && !routeProfile) {
    notifyTargetLockTerminalFailure({
      routeApiKey: token,
      cliType,
      statusCode: 401,
      terminalError: buildRouteProxyErrorText('invalid_api_key', 'Invalid route API key'),
    });
    recordRequestForSelection({
      ...routeCancellationLogContext,
      outcome: 'failure',
      statusCode: 401,
      error: 'invalid_api_key',
    });
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_api_key', message: 'Invalid route API key' }));
    return;
  }
  if (targetLock && !isLoopbackAddress(req.socket.remoteAddress)) {
    notifyTargetLockTerminalFailure({
      routeApiKey: token,
      cliType,
      statusCode: 403,
      terminalError: buildRouteProxyErrorText(
        'target_lock_forbidden',
        'Target-lock requests are only allowed from loopback clients'
      ),
      lock: targetLock,
    });
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'target_lock_forbidden',
        message: 'Target-lock requests are only allowed from loopback clients',
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
    recordRequestForSelection({
      ...routeCancellationLogContext,
      outcome: 'failure',
      statusCode: 501,
      error,
    });
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
  if (endpointOperation.capability === 'model-discovery') {
    const discovery = buildRouteModelDiscoveryResponse(routing, req);
    recordRequestForSelection({
      ...routeCancellationLogContext,
      outcome: discovery.statusCode >= 400 ? 'failure' : 'success',
      statusCode: discovery.statusCode,
      ...(discovery.statusCode >= 400 ? { error: 'model_discovery_failed' } : {}),
    });
    res.writeHead(discovery.statusCode, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(discovery.body));
    return;
  }
  const sourceProtocol = endpointOperation.protocol;
  const sourceAdapterCliType = getAdapterCliTypeForProtocol(sourceProtocol);
  const nativePassthroughChannels = new WeakSet<ResolvedChannel>();
  const previousTerminalFailure = targetLock ? getRouteTargetLockTerminalFailure(token) : undefined;
  if (previousTerminalFailure) {
    log.warn('Target-lock request blocked after terminal upstream failure', {
      cliType,
      statusCode: previousTerminalFailure.statusCode,
      siteId: targetLock?.siteId,
      accountId: targetLock?.accountId,
      apiKeyId: targetLock?.apiKeyId,
      rawModel: targetLock?.rawModel,
    });
    writeTargetLockTerminalFailureResponse(res, previousTerminalFailure);
    return;
  }
  if (stopRouteHandlingIfClientCancelled()) {
    return;
  }

  // 读取请求体
  let bodyBuffer: Buffer;
  try {
    bodyBuffer = await readBody(req);
    requestBodyRead = true;
  } catch (err: unknown) {
    if (isRouteClientCancelledError(err)) {
      cancelRouteRequest();
      finishRouteHandling();
      return;
    }
    throw err;
  }
  if (stopRouteHandlingIfClientCancelled()) {
    return;
  }
  let bodyJson: unknown = null;
  try {
    bodyJson = JSON.parse(bodyBuffer.toString('utf-8'));
  } catch {
    /* ignore */
  }
  const sessionRouting =
    routing.sessionRouting ??
    (routing.sessionRouting = structuredClone(DEFAULT_ROUTE_SESSION_ROUTING_CONFIG));
  let observedRouteInstanceKey = extractObservedRouteInstanceKey(
    req,
    bodyJson,
    sessionRouting.extractionRules,
    sourceProtocol
  );
  if (!observedRouteInstanceKey && routeProfile) {
    const profileSessionKey = `profile:${routeProfile.id}`;
    observedRouteInstanceKey = {
      agentId: profileSessionKey,
      runtimeSlotId: profileSessionKey,
      sessionId: profileSessionKey,
      observedAgentName: routeProfile.name,
      observedRuntimeSlotLabel: '客户端级路由',
    };
  }
  routeAgentId = observedRouteInstanceKey?.agentId;
  routeAgentName =
    observedRouteInstanceKey?.observedAgentName ||
    observedRouteInstanceKey?.agentId ||
    routeProfile?.name;
  const responsesStateRequest = classifyResponsesStateRequest(endpointOperation, bodyJson);
  if (responsesStateRequest && !routeProfile) {
    if (!targetLock) {
      recordRequestForSelection({
        ...routeCancellationLogContext,
        requestedModel: extractModelFromBody(bodyJson),
        outcome: 'failure',
        statusCode: 400,
        error: 'stateful_profile_key_required',
      });
    }
    writeStateAffinityError(
      res,
      400,
      'stateful_profile_key_required',
      'Stateful Responses requests require a dedicated configuration profile API key'
    );
    return;
  }
  let stateAffinityRecord: RouteStateAffinityRecord | null = null;
  if (responsesStateRequest?.resourceId && routeProfile) {
    stateAffinityRecord = await routeStateAffinityService.get(
      responsesStateRequest.resourceId,
      routeProfile.id
    );
    if (!stateAffinityRecord) {
      recordRequestForSelection({
        ...routeCancellationLogContext,
        requestedModel: extractModelFromBody(bodyJson),
        outcome: 'failure',
        statusCode: 409,
        error: 'state_affinity_not_found',
      });
      writeStateAffinityError(
        res,
        409,
        'state_affinity_not_found',
        'The referenced resource is not available for this configuration profile'
      );
      return;
    }
  }
  const stateReference = findProviderOwnedStateReference(bodyJson);
  if (stateReference) {
    if (!targetLock) {
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
    }
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
  if (
    !observedRouteInstanceKey &&
    Object.values(sessionRouting.instances || {}).some(
      instance => instance.routingState === 'armed'
    )
  ) {
    log.debug('Armed RouteInstance remains unbound because runtime identity is incomplete', {
      cliType,
    });
  }
  const requestedReasoningEffort = extractRouteReasoningEffort(bodyJson);
  const requestedCanonicalModel = resolveCanonicalModelFromRegistry(routing, rawModel);
  Object.assign(routeCancellationLogContext, {
    requestedModel: rawModel,
    reasoningEffort: requestedReasoningEffort,
  });
  const routeInstanceResolution = resolveRouteInstanceForRequest({
    config: sessionRouting,
    profileId:
      routeProfile?.id ||
      `__target_lock__:${targetLock?.siteId}:${targetLock?.accountId}:${targetLock?.apiKeyId}`,
    observedKey: observedRouteInstanceKey,
    requestedModel: requestedCanonicalModel,
    requestedReasoningEffort: requestedReasoningEffort || null,
    defaultModel: '',
    defaultReasoningEffort: 'medium',
    requestAt: requestSelectionStartedAt,
  });
  if (!routeInstanceResolution.instance && !rawModel && !stateAffinityRecord && !targetLock) {
    recordRequestForSelection({
      requestId,
      attempt: 0,
      cliType,
      requestedModel: null,
      reasoningEffort: requestedReasoningEffort,
      canonicalModel: null,
      outcome: 'failure',
      statusCode: 400,
      error: 'model_required',
    });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'model_required',
        message: 'A model is required when no RouteInstance is bound',
      })
    );
    return;
  }
  if (routeInstanceResolution.changed) {
    await unifiedConfigManager.saveConfig();
    if (stopRouteHandlingIfClientCancelled()) {
      return;
    }
  }
  if (routeInstanceResolution.instance) {
    routeSessionActivityService.touch(routeInstanceResolution.instance);
    routeAgentId = routeInstanceResolution.instance.routeKey?.agentId;
    routeAgentName =
      routeInstanceResolution.instance.display.customAgentName ||
      routeInstanceResolution.instance.display.observedAgentName ||
      routeAgentId ||
      routeProfile?.name;
  }
  const selectedThinkingEffort =
    normalizeRouteThinkingEffort(routeInstanceResolution.instance?.reasoningEffort) ??
    requestedReasoningEffort ??
    'medium';
  let reasoningEffort = selectedThinkingEffort;

  // 解析 canonical model（代理层无 site 上下文，使用全局 alias 索引）。
  let canonicalModel: string | null =
    routeInstanceResolution.instance?.modelId.trim() || requestedCanonicalModel;
  Object.assign(routeCancellationLogContext, {
    requestedModel: rawModel,
    reasoningEffort,
    canonicalModel,
  });

  let activeRouteRuleId: string | undefined;
  let sortedChannels: ResolvedChannel[] = [];
  let routeRuntimeConfig = resolveRouteRuntimeConfig(routing, canonicalModel);
  const bypassRoutePathState = Boolean(targetLock || stateAffinityRecord);

  if (targetLock) {
    canonicalModel = targetLock.canonicalModel;
    Object.assign(routeCancellationLogContext, {
      routeRuleId: '__target_lock__',
      canonicalModel,
    });
    routeRuntimeConfig = resolveRouteRuntimeConfig(routing, canonicalModel);
    sortedChannels = (
      await resolveChannelTargets([
        {
          routeRuleId: '__target_lock__',
          siteId: targetLock.siteId,
          accountId: targetLock.accountId,
          apiKeyId: targetLock.apiKeyId,
          sourceProtocol,
          canonicalModel: targetLock.canonicalModel,
          resolvedModel: targetLock.rawModel,
          targetProtocol: targetLock.targetProtocol,
        },
      ])
    ).map(channel =>
      resolveEffectiveRouteChannel(channel, sourceProtocol, nativePassthroughChannels)
    );
    if (stopRouteHandlingIfClientCancelled()) {
      return;
    }
  } else if (stateAffinityRecord) {
    activeRouteRuleId = stateAffinityRecord.routeRuleId;
    Object.assign(routeCancellationLogContext, { routeRuleId: activeRouteRuleId });
    sortedChannels = [
      buildAffinityChannel(stateAffinityRecord, sourceProtocol, canonicalModel, rawModel),
    ];
  } else {
    // 规则匹配只看 canonical model；若当前请求尚未建立 canonical，则退化为 raw。
    // RouteInstance model is authoritative; otherwise the wire model seeds the route.
    let sortedRules = sortRules(routing.rules);
    const matchModel = canonicalModel || rawModel;
    let rule = findMatchingProtocolRule(sortedRules, sourceProtocol, matchModel);

    if (!rule && (routeInstanceResolution.instance || routeProfile) && matchModel) {
      await unifiedConfigManager.ensureRouteRuleForProtocolModelSelection(
        sourceProtocol,
        matchModel
      );
      if (stopRouteHandlingIfClientCancelled()) {
        return;
      }
      sortedRules = sortRules(routing.rules);
      rule = findMatchingProtocolRule(sortedRules, sourceProtocol, matchModel);
    }

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
          message: `No routing rule matched for ${sourceProtocol} / ${matchModel || '(empty model)'}`,
        })
      );
      return;
    }

    activeRouteRuleId = rule.id;
    Object.assign(routeCancellationLogContext, { routeRuleId: rule.id });

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
    if (stopRouteHandlingIfClientCancelled()) {
      return;
    }
    const attemptPlan = buildChannelAttemptPlan(
      sortChannelsByScore(resolvedChannels),
      routeRuntimeConfig.maxAttemptsPerRoutePath
    ).map(channel =>
      resolveEffectiveRouteChannel(channel, sourceProtocol, nativePassthroughChannels)
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
  if (responsesStateRequest?.createsResource) {
    sortedChannels = sortedChannels.filter(
      channel =>
        resolveChannelUpstreamProtocol(channel.targetProtocol, sourceProtocol) ===
        'openai-responses'
    );
    if (sortedChannels.length === 0) {
      if (!targetLock) {
        recordRequestForSelection({
          ...routeCancellationLogContext,
          outcome: 'failure',
          statusCode: 501,
          error: 'stateful_cross_protocol_unsupported',
        });
      }
      writeStateAffinityError(
        res,
        501,
        'stateful_cross_protocol_unsupported',
        'Stateful Responses requests require a native OpenAI Responses channel'
      );
      return;
    }
    sortedChannels = sortedChannels.slice(0, 1);
  }
  const timeoutMs = routing.server.requestTimeoutMs;
  const requestWantsStreaming = isStreamingRequest(bodyJson, req.url);
  const requestIsTokenCount = endpointOperation.capability === 'stateless-native-only';
  const tokenCountEndpoint = CLAUDE_MESSAGES_COUNT_TOKENS_ENDPOINT;
  if (targetLock && requestIsTokenCount) {
    writeTokenCountUnsupported(res, 'target_lock_has_no_exact_tokenizer');
    return;
  }
  if (requestIsTokenCount) {
    sortedChannels = sortedChannels.filter(
      channel =>
        resolveChannelUpstreamProtocol(channel.targetProtocol, sourceProtocol) === sourceProtocol
    );
    if (sortedChannels.length === 0) {
      recordRequestForSelection({
        requestId,
        attempt: 0,
        routeRuleId: activeRouteRuleId,
        cliType,
        requestedModel: rawModel,
        reasoningEffort,
        canonicalModel,
        requestKind: 'token-count',
        outcome: 'neutral',
        statusCode: 501,
        error: 'token_count_unsupported:no_native_protocol_channel',
      });
      writeTokenCountUnsupported(res, 'no_native_protocol_channel');
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
    if (stopRouteHandlingIfClientCancelled()) {
      return;
    }
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
    Object.assign(routeCancellationLogContext, {
      requestId,
      attempt,
      cliType,
      targetProtocol: activeChannel.targetProtocol,
      targetEndpoint: activeChannel.targetEndpoint,
      requestedModel: rawModel,
      reasoningEffort,
      canonicalModel,
      routeRuleId: activeRouteRuleId ?? activeChannel.routeRuleId,
      siteId: activeChannel.siteId,
      accountId: activeChannel.accountId,
      apiKeyId: activeChannel.apiKeyId,
      resolvedModel: activeChannel.resolvedModel,
      requestKind: requestIsTokenCount ? 'token-count' : 'inference',
    });
    const upstreamProtocol = resolveChannelUpstreamProtocol(
      activeChannel.targetProtocol,
      sourceProtocol
    );
    const site = unifiedConfigManager.getSiteById(activeChannel.siteId);
    const account = unifiedConfigManager.getAccountById(activeChannel.accountId);

    if (requestIsTokenCount && !bypassRoutePathState) {
      const endpointUnsupported = isRouteEndpointUnsupported(
        { ...activeChannel, cliType: getAdapterCliTypeForProtocol(upstreamProtocol) },
        tokenCountEndpoint
      );
      if (endpointUnsupported) {
        tokenCountFallbackReason ??= 'cached_unsupported';
        continue;
      }
    }

    const targetLockCredentials =
      targetLock?.upstreamBaseUrl && targetLock?.upstreamApiKey
        ? {
            baseUrl: targetLock.upstreamBaseUrl,
            apiKey: targetLock.upstreamApiKey,
          }
        : null;
    const creds =
      targetLockCredentials ||
      (await resolveChannelCredentials(ch.siteId, ch.accountId, ch.apiKeyId));
    if (stopRouteHandlingIfClientCancelled()) {
      return;
    }
    if (!creds) {
      if (targetLock) {
        notifyTargetLockTerminalFailure({
          routeApiKey: token,
          cliType,
          terminalError: buildRouteProxyErrorText(
            'credentials_unavailable',
            'Route credentials are unavailable for this target-lock request'
          ),
          lock: targetLock,
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
    let upstreamCliType: RouteCliType = getAdapterCliTypeForProtocol(upstreamProtocol);
    let responseAdapter: AnyRouterResponseAdapter = { type: 'transparent' };
    const protocolResponseAdapters: CliProtocolResponseAdapter[] = [];
    const applyProtocolRewrite = (
      targetProtocol: ConcreteCliTargetProtocol,
      sourceProtocol?: ConcreteCliTargetProtocol
    ) => {
      const rewritten = adaptRequestToTargetProtocol(
        finalBody,
        sourceAdapterCliType,
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
      !requestIsTokenCount &&
      site &&
      account &&
      isAnyRouterSite(site.name) &&
      sourceProtocol === upstreamProtocol
    ) {
      const userHash = account.anyRouterConfig?.userHash;

      if (!userHash && sourceAdapterCliType === 'claudeCode') {
        log.warn(`[AnyRouter] Account ${account.account_name} missing userHash configuration`);
      }

      const rewritten = rewriteForAnyRouter(
        finalBody,
        userHash,
        req.headers,
        sourceAdapterCliType,
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
        if (targetLock) {
          notifyTargetLockTerminalFailure({
            routeApiKey: token,
            cliType,
            statusCode: 502,
            terminalError: buildRouteProxyErrorText(`adapter_${stage}`, reason),
            lock: targetLock,
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
    Object.assign(routeCancellationLogContext, { reasoningEffort });

    const attemptStartedAt = Date.now();
    const streamResponseBody =
      requestWantsStreaming && canStreamResponseAdapters(responseAdapter, protocolResponseAdapters);
    const streamResponseAdapter = getIncrementalProtocolResponseAdapter(protocolResponseAdapters);
    const nativeResponsePassthrough =
      nativePassthroughChannels.has(ch) && !(site && isAnyRouterSite(site.name));
    let streamedResourceAffinityBound = false;
    const bindResourceAffinity = async (resourceId: string): Promise<void> => {
      if (!routeProfile || streamedResourceAffinityBound) return;
      await routeStateAffinityService.bind({
        resourceId,
        resourceType: responsesStateRequest?.resourceType || 'response',
        profileId: routeProfile.id,
        siteId: activeChannel.siteId,
        accountId: activeChannel.accountId,
        apiKeyId: activeChannel.apiKeyId,
        routeRuleId: activeRouteRuleId ?? activeChannel.routeRuleId,
        targetProtocol: 'openai-responses',
        targetEndpoint: activeChannel.targetEndpoint || pathname,
        createdAt: Date.now(),
      });
      streamedResourceAffinityBound = true;
    };
    attemptedUpstream = true;

    // target-lock 上游预算：按"终结结果"计，瞬时错误在上限内不消耗预算。
    let targetLockIsFinalAttempt = false;

    try {
      if (targetLock) {
        const attempt = beginRouteTargetLockUpstreamAttempt(token);
        if (!attempt.allowed) {
          const terminalError = buildTargetLockUpstreamAttemptExhaustedErrorText();
          log.warn(
            'Target-lock upstream request blocked after per-model attempt budget exhausted',
            {
              cliType,
              agentId: routeAgentId,
              agentName: routeAgentName,
              siteId: targetLock.siteId,
              accountId: targetLock.accountId,
              apiKeyId: targetLock.apiKeyId,
              rawModel: targetLock.rawModel,
            }
          );
          res.writeHead(TARGET_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_STATUS_CODE, {
            'Content-Type': 'application/json',
            'X-Route-Proxy-Error': TARGET_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_ERROR_CODE,
          });
          res.end(terminalError);
          return;
        }
        targetLockIsFinalAttempt = attempt.isFinalAttempt;
      }

      const forwardActiveChannel = () =>
        forwardToUpstream(
          req,
          creds.baseUrl,
          creds.apiKey,
          finalBody,
          sourceAdapterCliType,
          upstreamTimeouts.timeoutMs,
          activeChannel.resolvedModel,
          {
            upstreamProxyUrl: routing.server.upstreamProxyUrl,
            upstreamAuthScheme:
              'authScheme' in creds
                ? (creds as { authScheme?: 'bearer' | 'x-api-key' }).authScheme
                : undefined,
            additionalHeaders,
            methodOverride,
            requestUrlOverride,
            upstreamCliType,
            signal: routeAbortController.signal,
            streamResponse: res,
            streamResponseBody,
            streamResponseAdapter: streamResponseAdapter ?? undefined,
            nativeResponsePassthrough,
            streamIdleTimeoutMs: upstreamTimeouts.streamIdleTimeoutMs,
            beforeStreamCommit:
              responsesStateRequest?.createsResource && streamResponseBody
                ? async bufferedBody => {
                    const resourceId = extractResponseResourceIdFromSse(bufferedBody);
                    if (!resourceId) {
                      throw new Error('state_affinity_response_id_missing');
                    }
                    await bindResourceAffinity(resourceId);
                  }
                : undefined,
            onStreamCompletionDelivered: () => {
              routeStreamCompletionDelivered = true;
            },
          }
        );

      const forwardActiveChannelWithEmptyStreamRetry = async () => {
        for (let retry = 0; ; retry += 1) {
          try {
            return await forwardActiveChannel();
          } catch (error: unknown) {
            if (
              targetLock ||
              Boolean(responsesStateRequest) ||
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
      if (routeAbortController.signal.aborted || routeClientCancelled) {
        routeClientCancelled = true;
        recordRouteClientCancellation();
        if (!bypassRoutePathState && shouldRecordCancelledUpstreamPathSuccess(result)) {
          await recordCancelledUpstreamPathSuccess({
            requestSelectionStartedAt,
            activeChannel,
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
        !responsesStateRequest &&
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
        if (routeAbortController.signal.aborted || routeClientCancelled) {
          routeClientCancelled = true;
          recordRouteClientCancellation();
          if (!bypassRoutePathState && shouldRecordCancelledUpstreamPathSuccess(result)) {
            await recordCancelledUpstreamPathSuccess({
              requestSelectionStartedAt,
              activeChannel,
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
        await recordRouteEndpointUnsupported(
          { ...activeChannel, cliType: getAdapterCliTypeForProtocol(upstreamProtocol) },
          tokenCountEndpoint,
          {
            statusCode: result.statusCode,
            error: bodySnippet,
            reason: 'upstream_unsupported',
          }
        );
        if (stopRouteHandlingIfClientCancelled()) {
          return;
        }
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

        if (targetLock) {
          settleRouteTargetLockUpstreamAttempt(token);
          recordTargetLockFirstUpstreamResult({
            routeApiKey: token,
            cliType,
            lock: targetLock,
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
            lock: targetLock,
          };
          notifyTargetLockTerminalFailure(terminalFailure);
          writeTargetLockTerminalFailureResponse(res, terminalFailure);
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
          if (stopRouteHandlingIfClientCancelled()) {
            return;
          }
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
        if (stopRouteHandlingIfClientCancelled()) {
          return;
        }

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

        if (targetLock) {
          const transient = isTransientUpstreamStatus(result.statusCode);
          if (transient && !targetLockIsFinalAttempt) {
            // 瞬时上游错误且未达尝试上限：不消耗预算、不通知终结失败。
            // 记录一个可被后续成功/终结失败覆盖的非终结结果（保留失败原因），
            // 并把原始上游响应直接透传回 CLI（剥离 hop-by-hop/content-length/transfer-encoding），
            // 不走 AnyRouter/协议转换，避免转换异常把瞬时错误劫持成终结失败。
            log.debug('Target-lock transient upstream failure passed through without settling', {
              statusCode: result.statusCode,
              cliType,
              siteId: targetLock.siteId,
              accountId: targetLock.accountId,
              apiKeyId: targetLock.apiKeyId,
              rawModel: targetLock.rawModel,
            });
            recordTargetLockFirstUpstreamResult({
              routeApiKey: token,
              cliType,
              lock: targetLock,
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
            transient && targetLockIsFinalAttempt
              ? buildRouteProxyErrorText(
                  'upstream_temporarily_unavailable',
                  `upstream temporarily unavailable, retried ${MAX_TARGET_LOCK_UPSTREAM_ATTEMPTS} times (last status ${result.statusCode})`
                )
              : terminalError;
          settleRouteTargetLockUpstreamAttempt(token);
          recordTargetLockFirstUpstreamResult({
            routeApiKey: token,
            cliType,
            lock: targetLock,
            statusCode: result.statusCode,
            success: false,
            body: result.body,
            error: finalError,
          });
          notifyTargetLockTerminalFailure({
            routeApiKey: token,
            cliType,
            statusCode: result.statusCode,
            terminalError: finalError,
            lock: targetLock,
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
        if (targetLock) {
          settleRouteTargetLockUpstreamAttempt(token);
          recordTargetLockFirstUpstreamResult({
            routeApiKey: token,
            cliType,
            lock: targetLock,
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
        if (targetLock) {
          const terminalError = buildRouteProxyErrorText('adapter_response-adapt', reason);
          settleRouteTargetLockUpstreamAttempt(token);
          recordTargetLockFirstUpstreamResult({
            routeApiKey: token,
            cliType,
            lock: targetLock,
            statusCode: 502,
            success: false,
            body: result.body,
            error: terminalError,
          });
          notifyTargetLockTerminalFailure({
            routeApiKey: token,
            cliType,
            statusCode: 502,
            terminalError,
            lock: targetLock,
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
          if (stopRouteHandlingIfClientCancelled()) {
            return;
          }
        }
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
          error: `adapter_response-adapt:${reason}`,
        });
        // 响应字节尚未写入，可继续尝试下一通道
        continue;
      }

      // 成功/neutral/最后一次失败：写 res
      if (targetLock && outcome === 'success') {
        settleRouteTargetLockUpstreamAttempt(token);
        recordTargetLockFirstUpstreamResult({
          routeApiKey: token,
          cliType,
          lock: targetLock,
          statusCode: result.statusCode,
          success: true,
          body: transformed.body,
        });
      }
      if (outcome === 'success' && responsesStateRequest && routeProfile) {
        if (responsesStateRequest.createsResource) {
          const resourceId = extractResponseResourceId(transformed.body);
          if (!resourceId) {
            throw new Error('state_affinity_response_id_missing');
          }
          await bindResourceAffinity(resourceId);
        }
        if (responsesStateRequest.removesResource && responsesStateRequest.resourceId) {
          await routeStateAffinityService.remove(responsesStateRequest.resourceId);
        }
      }
      res.writeHead(
        result.statusCode,
        buildBufferedResponseHeaders(transformed.headers, transformed.body)
      );
      res.end(transformed.body);
      return;
    } catch (err: unknown) {
      if (
        isRouteClientCancelledError(err) ||
        routeAbortController.signal.aborted ||
        routeClientCancelled
      ) {
        routeClientCancelled = true;
        recordRouteClientCancellation();
        finishRouteHandling();
        return;
      }
      const errorMessage = err instanceof Error ? err.message : 'unknown_error';
      if (targetLock) {
        // 网络异常无 statusCode，按瞬时错误处理：未达上限则不 settle/不通知，
        // 透传错误给 CLI,让后续请求继续尝试上游。
        if (targetLockIsFinalAttempt) {
          const finalError = buildRouteProxyErrorText(
            'upstream_temporarily_unavailable',
            `upstream temporarily unavailable, retried ${MAX_TARGET_LOCK_UPSTREAM_ATTEMPTS} times (${errorMessage})`
          );
          settleRouteTargetLockUpstreamAttempt(token);
          recordTargetLockFirstUpstreamResult({
            routeApiKey: token,
            cliType,
            lock: targetLock,
            statusCode: 502,
            success: false,
            error: finalError,
          });
          notifyTargetLockTerminalFailure({
            routeApiKey: token,
            cliType,
            statusCode: 502,
            terminalError: finalError,
            lock: targetLock,
          });
        } else {
          // 瞬时网络异常且未达上限：不消耗预算、不通知终结失败，但记录一个可被
          // 后续成功/终结失败覆盖的非终结结果，避免单发不重试的 CLI 丢失失败原因。
          log.debug('Target-lock transient network failure passed through without settling', {
            cliType,
            siteId: targetLock.siteId,
            accountId: targetLock.accountId,
            apiKeyId: targetLock.apiKeyId,
            rawModel: targetLock.rawModel,
            error: errorMessage,
          });
          recordTargetLockFirstUpstreamResult({
            routeApiKey: token,
            cliType,
            lock: targetLock,
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
        if (stopRouteHandlingIfClientCancelled()) {
          return;
        }
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
        !targetLock &&
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
      recordRequestForSelection({
        requestId,
        attempt: attempt + 1,
        routeRuleId: activeRouteRuleId,
        cliType,
        requestedModel: rawModel,
        reasoningEffort,
        canonicalModel,
        requestKind: 'token-count',
        outcome: 'neutral',
        statusCode: 501,
        error: `token_count_unsupported:${tokenCountFallbackReason || 'native_channels_unavailable'}`,
      });
      writeTokenCountUnsupported(res, tokenCountFallbackReason || 'native_channels_unavailable');
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
