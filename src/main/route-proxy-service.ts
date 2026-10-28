import { getApplicationStorage } from './storage/application-storage';
/**
 * 路由代理服务器
 * 输入: CLI 请求 (HTTP), RoutingConfig, ModelRegistry
 * 输出: 透明转发到上游站点（含 model 重写 + metrics 采集）
 * 定位: 服务层 - 串行启停本地监听，canonical→raw 模型重写，上游转发与统计
 */

import * as http from 'http';
import { createHash } from 'crypto';
import { URL } from 'url';
import Logger from './utils/logger';
import { rectifyRejectedRequest } from './request-rectifier';
import { getModelMetadata } from './model-metadata-service';

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
  beginRoutePathAttempt,
  sortChannelsByScore,
  recordOutcome,
  getRoutePathDisabledUntil,
  isRoutePathDisabled,
  recordRoutePathOutcome,
  isRouteEndpointUnsupported,
  recordRouteEndpointUnsupported,
} from './route-stats-service';

import type {
  RouteChannelKey,
  RouteCliType,
  RouteInstance,
  RouteModelRegistryConfig,
  RoutePathState,
  RouteRuntimeConfig,
  RouteSessionChannelBinding,
  RouteSessionRoutingConfig,
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

import { routeSessionActivityService } from './route-session-activity-service';
import { routeSessionBindingService } from './route-session-binding-service';
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
  hasObservedRouteInstanceEvidence,
  resolveRouteInstanceForRequest,
  type RouteInstanceResolution,
} from './route-session-service';
import { findConfigFileProfileByRouteApiKey } from './config-file-profile-service';
import type { ConfigFileProfile } from '../shared/types/config-file-profile';
import {
  routeStateAffinityService,
  type RouteStateAffinityRecord,
} from './route-state-affinity-service';
import {
  buildQuotaExhaustedRouteLogError,
  classifyRouteStatusCode,
  classifyUpstreamFailure,
  failureClassToOutcome,
  isTransientUpstreamStatus,
  isUpstreamQuotaExhaustionResponse,
  resolveRoutePathDisabledReason,
  retainUpstreamFailure,
  summarizeUpstreamFailureBodyForLog,
  summarizeUpstreamFailureBodyRaw,
  type RouteUpstreamFailure,
} from './route-upstream-failure';
import {
  asRecord,
  getRequestPathname,
  inferSourceProtocol,
  normalizeHeaderValue,
  type ConcreteCliTargetProtocol,
} from './route-proxy-shared';
import {
  extractRouteReasoningEffort,
  hasRouteUsageValues,
  isAllZeroRouteUsage,
  type RouteUsageStats,
} from './route-usage';
import {
  EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE,
  NATIVE_STREAM_MISSING_TERMINAL_ERROR,
  NativeAnthropicSseGuardError,
  buildBufferedResponseHeaders,
  canStreamResponseAdapters,
  forwardToUpstream,
  getIncrementalProtocolResponseAdapter,
  isRetryableEmptyStreamingResponse,
  isStreamingRequest,
  parseSseBlocks,
  parseSseJsonRecord,
  resolveUpstreamTimeouts,
} from './route-upstream-forwarder';
import {
  RouteRequestContext,
  createRouteClientCancelledError,
  isRouteClientCancelledError,
  markRouteTerminalError,
  nextRequestId,
} from './route-request-context';

export { buildUpstreamHeaders, buildUpstreamRequestUrl } from './route-upstream-forwarder';
export { extractRouteReasoningEffort, extractUsageFromBody } from './route-usage';

export {
  classifyRouteStatusCode,
  isTransientUpstreamStatus,
  isUpstreamQuotaExhaustionResponse,
  summarizeUpstreamFailureBodyForLog,
};

const log = Logger.scope('RouteProxyService');

const JSON_RESPONSE_HEADERS: http.OutgoingHttpHeaders = { 'Content-Type': 'application/json' };

function writeRouteProxyErrorHead(
  res: http.ServerResponse,
  statusCode: number,
  error: string,
  headers: http.OutgoingHttpHeaders = JSON_RESPONSE_HEADERS
): void {
  markRouteTerminalError(res, error);
  res.writeHead(statusCode, { 'X-Route-Proxy-Error': error, ...headers });
}

let proxyServer: http.Server | null = null;
let isRunning = false;
let proxyLifecycle: Promise<void> = Promise.resolve();
const ALL_ROUTE_PATHS_DISABLED_ERROR_CODE = 'all_route_paths_disabled';
/**
 * 全部路径挂起回 503 而非 400：Claude Code/Codex 视 4xx 为不可重试并终止本轮对话，
 * 而挂起是暂时的；Retry-After 取最早解禁时间，让 CLI 自行退避重试。
 */
const ALL_ROUTE_PATHS_DISABLED_STATUS_CODE = 503;
const ALL_ROUTE_PATHS_DISABLED_RETRY_AFTER_MAX_SECONDS = 30;
const ALL_ROUTE_PATHS_DISABLED_MESSAGE =
  'all_route_paths_disabled: All route paths for this rule are temporarily disabled. Restore route paths in the route rule UI or wait for the suspension to expire.';
const UPSTREAM_TEMPORARILY_UNAVAILABLE_ERROR_CODE = 'upstream_temporarily_unavailable';
const UPSTREAM_TEMPORARILY_UNAVAILABLE_STATUS_CODE = 503;
const UPSTREAM_TEMPORARILY_UNAVAILABLE_MESSAGE =
  'No upstream route is currently available. Please retry.';
const ALL_CHANNELS_FAILED_ERROR_CODE = 'all_channels_failed';
const ALL_CHANNELS_FAILED_MESSAGE = 'All upstream channels failed';
const ZERO_USAGE_UPSTREAM_RETRY_ATTEMPTS = 1;
const EMPTY_STREAM_UPSTREAM_RETRY_ATTEMPTS = 1;
/** 同通道立即重试的固定退避；此处无上游响应头可读，故不解析 Retry-After。 */
const ROUTE_SAME_CHANNEL_RETRY_BACKOFF_MS = 200;
/** Retry-After 超过该阈值则跳过该次计划尝试，绝不为等待阻塞 CLI。 */
const ROUTE_SAME_PATH_RETRY_MAX_DELAY_MS = 2000;
/**
 * 全局尝试预算：单个请求跨所有候选通道的实际尝试上限。
 * 通道数 × maxAttemptsPerRoutePath 的无约束组合会让 CLI 等到自行超时
 * （线上日志出现过单请求 13 次尝试、92 秒后被客户端取消）。
 */
const ROUTE_GLOBAL_MAX_ATTEMPTS = 6;
/**
 * 请求级重试决策预算：请求开始超过该时长后不再发起新的故障转移尝试。
 * 只约束"是否开始下一次尝试"，不限制已在上游执行的请求。
 */
const ROUTE_RETRY_DECISION_BUDGET_MS = 120 * 1000;
/**
 * request_fatal（400/413/422）负缓存：通道拒绝了某种请求形状后，
 * TTL 内后续同形状请求直接跳过该通道，避免每个请求都先撞一次坏通道
 * （request_fatal 记 neutral、不影响成功率窗口，因此没有其他机制能记住它）。
 * 若全部候选都被负缓存命中则忽略缓存照常尝试，保底全 request_fatal 时的透传语义。
 */
const ROUTE_REQUEST_FATAL_NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const ROUTE_REQUEST_FATAL_NEGATIVE_CACHE_MAX_ENTRIES = 500;

/**
 * request_fatal 负缓存：key 为 routePathKey + 请求形状指纹。
 * 指纹只取请求的结构性特征（顶层字段、tools 形状、内容块类型、思考/工具开关），
 * 不含消息文本与请求体长度——CLI 会话逐轮增长，取内容会永远打不中缓存。
 */
const requestFatalNegativeCache = new Map<string, number>();

function collectRequestShapeTypes(value: unknown, out: Set<string>, depth: number): void {
  if (out.size >= 64 || depth > 3) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRequestShapeTypes(item, out, depth + 1);
      if (out.size >= 64) return;
    }
    return;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.type === 'string' && record.type) {
      out.add(record.type);
    }
    for (const key of ['content', 'input', 'blocks']) {
      if (record[key] !== undefined) {
        collectRequestShapeTypes(record[key], out, depth + 1);
      }
    }
  }
}

export function buildRequestFatalFingerprint(bodyJson: unknown, bodyByteLength?: number): string {
  if (!bodyJson || typeof bodyJson !== 'object' || Array.isArray(bodyJson)) {
    return '';
  }
  const record = bodyJson as Record<string, unknown>;
  const blockTypes = new Set<string>();
  collectRequestShapeTypes(record.messages, blockTypes, 0);
  collectRequestShapeTypes(record.input, blockTypes, 0);
  collectRequestShapeTypes(record.system, blockTypes, 0);
  const tools = Array.isArray(record.tools) ? record.tools.slice(0, 32) : [];
  const toolShapes = tools
    .map(tool => {
      if (!tool || typeof tool !== 'object') return '?';
      const toolRecord = tool as Record<string, unknown>;
      return `${String(toolRecord.type ?? '')}:${String(toolRecord.name ?? '')}`;
    })
    .sort()
    .join(';');
  const flags: string[] = [];
  if (record.thinking && typeof record.thinking === 'object') {
    flags.push(`thinking:${String((record.thinking as Record<string, unknown>).type ?? '')}`);
  }
  if (record.reasoning && typeof record.reasoning === 'object') {
    flags.push(`reasoning:${String((record.reasoning as Record<string, unknown>).effort ?? '')}`);
  }
  if (record.tool_choice !== undefined) {
    flags.push(
      `tool_choice:${
        typeof record.tool_choice === 'string'
          ? record.tool_choice
          : String((record.tool_choice as Record<string, unknown>)?.type ?? '')
      }`
    );
  }

  return [
    Object.keys(record).sort().join(','),
    `tools=${toolShapes}`,
    `blocks=${Array.from(blockTypes).sort().join(',')}`,
    ...flags,
    // 粗粒度体积桶（2 的幂）："上下文超长"类 400 与请求大小相关，
    // 会话逐轮增长或新会话变小都应视为不同的缓存键。
    bodyByteLength && bodyByteLength > 0 ? `len=${Math.floor(Math.log2(bodyByteLength))}` : '',
  ]
    .filter(Boolean)
    .join('|');
}

function pruneRequestFatalNegativeCache(now: number): void {
  for (const [key, expiresAt] of requestFatalNegativeCache) {
    if (expiresAt <= now) {
      requestFatalNegativeCache.delete(key);
    }
  }
  while (requestFatalNegativeCache.size > ROUTE_REQUEST_FATAL_NEGATIVE_CACHE_MAX_ENTRIES) {
    const oldestKey = requestFatalNegativeCache.keys().next().value;
    if (oldestKey === undefined) break;
    requestFatalNegativeCache.delete(oldestKey);
  }
}

function readRequestFatalNegativeCache(
  routePathKey: string,
  fingerprint: string,
  now: number
): boolean {
  if (!fingerprint) return false;
  const expiresAt = requestFatalNegativeCache.get(`${routePathKey}::${fingerprint}`);
  return expiresAt !== undefined && expiresAt > now;
}

function writeRequestFatalNegativeCache(
  routePathKey: string,
  fingerprint: string,
  now: number
): void {
  if (!fingerprint) return;
  requestFatalNegativeCache.set(
    `${routePathKey}::${fingerprint}`,
    now + ROUTE_REQUEST_FATAL_NEGATIVE_CACHE_TTL_MS
  );
  pruneRequestFatalNegativeCache(now);
}

/** 清空 request_fatal 负缓存（测试隔离用）。 */
export function clearRequestFatalNegativeCache(): void {
  requestFatalNegativeCache.clear();
}
const TARGET_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_ERROR_CODE = 'target_lock_upstream_attempt_exhausted';
const TARGET_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_STATUS_CODE = 400;
const CLAUDE_COUNT_TOKENS_PATH = '/v1/messages/count_tokens';
const CLAUDE_MESSAGES_COUNT_TOKENS_ENDPOINT = 'claude_messages_count_tokens';
const OPENAI_STATEFUL_ROUTE_PREFIXES = [
  '/v1/batches',
  '/v1/files',
  '/v1/uploads',
  '/v1/vector_stores',
  '/v1/containers',
] as const;
const ROUTE_PROXY_STOPPED_ERROR_CODE = 'route_proxy_stopped';
const ROUTE_PROXY_STOPPED_STATUS_CODE = 503;

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

/** 可取消延时：客户端断开时立即走既有取消路径，不拖慢拆除。 */
function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  if (signal.aborted) {
    return Promise.reject(createRouteClientCancelledError());
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(createRouteClientCancelledError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
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
  const resolved: Array<ResolvedChannel | null> = await Promise.all(
    channels.map(async (channel): Promise<ResolvedChannel | null> => {
      const resolvedTarget = await resolveChannelTarget(channel);
      if (!resolvedTarget) {
        return null;
      }
      return {
        ...channel,
        targetProtocol: resolvedTarget.targetProtocol,
        targetEndpoint: resolvedTarget.targetEndpoint,
      };
    })
  );
  return resolved.filter((channel): channel is ResolvedChannel => channel !== null);
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

function fingerprintRouteIdentity(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function normalizeRouteDiagnosticCategory(
  value: string | undefined,
  allowed: readonly string[]
): string | undefined {
  return value ? (allowed.includes(value) ? value : 'other') : undefined;
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

function getRouteDiagnosticPath(pathname: string): string {
  const routePath = [
    CLAUDE_COUNT_TOKENS_PATH,
    '/v1/responses/compact',
    '/v1/responses/input_tokens',
    '/v1/messages/batches',
    '/v1/chat/completions',
    '/v1/responses',
    '/v1/messages',
    '/v1/models',
    ...OPENAI_STATEFUL_ROUTE_PREFIXES,
  ].find(path => pathname === path || pathname.startsWith(`${path}/`));
  return routePath
    ? pathname === routePath
      ? routePath
      : `${routePath}/:resource`
    : pathname === '/'
      ? '/'
      : 'other';
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
  writeRouteProxyErrorHead(res, statusCode, error);
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

function buildSessionChannelKey(channel: {
  siteId?: string;
  accountId?: string;
  apiKeyId?: string;
}): string {
  return [
    channel.siteId || '__site__',
    channel.accountId || '__account__',
    channel.apiKeyId || '__api_key__',
  ].join('|');
}

/**
 * 会话绑定重排：在全局 affinity 之后应用，因此排在更前面，
 * 实现「会话绑定 → 全局 affinity → 配置优先级」的顺序。
 * 绑定是建议性的：不在候选中、被禁用、被抑制，或早于优先级失效边界时一律忽略。
 * 与全局 affinity 一致——只重排，不新增尝试，不绕过 maxAttemptsPerRoutePath。
 */
export function applySessionChannelAffinity<T extends RoutePathAffinityCandidate>(
  channels: T[],
  binding: Pick<RouteSessionChannelBinding, 'siteId' | 'accountId' | 'apiKeyId' | 'boundAt'> | null,
  routePathStates: Record<string, RoutePathState> | null | undefined,
  now: number = Date.now(),
  affinityInvalidatedAt?: number
): T[] {
  if (!binding || channels.length <= 1) {
    return channels;
  }
  // 优先级保存 / 重置优先命中会推进该边界，从而顺带失效会话绑定。
  if (affinityInvalidatedAt !== undefined && binding.boundAt <= affinityInvalidatedAt) {
    return channels;
  }

  const boundKey = buildSessionChannelKey(binding);
  const index = channels.findIndex(channel => buildSessionChannelKey(channel) === boundKey);
  if (index <= 0) {
    return channels;
  }

  const candidate = channels[index];
  if (isRoutePathDisabled(candidate)) {
    return channels;
  }
  const state = routePathStates?.[buildRoutePathStateKey(candidate)];
  const suppressedUntil = Math.max(
    state?.affinitySuppressedUntil ?? 0,
    routePathStates ? getRoutePathAffinitySuppressionUntil(candidate, routePathStates) : 0
  );
  if (suppressedUntil > now || (state?.disabledUntil ?? 0) > now) {
    return channels;
  }

  return [candidate, ...channels.slice(index + 1), ...channels.slice(0, index)];
}

/**
 * 新会话分散：只在用户配置顺序内部打破并列，返回第一个未被其他活跃会话占用的候选。
 * 全部被占用时返回 0，因此绝不会把低优先级通道提到空闲的高优先级通道之前。
 */
export function pickDistributedChannelIndex<
  T extends { siteId?: string; accountId?: string; apiKeyId?: string },
>(channels: T[], occupiedChannelKeys: Set<string>): number {
  if (channels.length <= 1 || occupiedChannelKeys.size === 0) {
    return 0;
  }

  const index = channels.findIndex(
    channel => !occupiedChannelKeys.has(buildSessionChannelKey(channel))
  );
  return index > 0 ? index : 0;
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
  writeRouteProxyErrorHead(res, failure.statusCode ?? 502, 'target_lock_terminal_failure', {
    'Content-Type': contentType,
  });
  res.end(body);
}

function buildTargetLockUpstreamAttemptExhaustedErrorText(): string {
  return buildRouteProxyErrorText(
    TARGET_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_ERROR_CODE,
    'Endpoint-test target lock upstream attempt budget exhausted'
  );
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
  writeRouteProxyErrorHead(res, 501, 'token_count_unsupported');
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

function writeRouteProxyJsonError(
  res: http.ServerResponse,
  statusCode: number,
  error: string,
  message: string
): void {
  writeRouteProxyErrorHead(res, statusCode, error);
  res.end(JSON.stringify({ error, message }));
}

function areAllRoutePathsDisabled(channels: ResolvedChannel[]): boolean {
  return channels.length > 0 && channels.every(channel => isRoutePathDisabled(channel));
}

function buildAllRoutePathsDisabledErrorBody(cliType: RouteCliType): unknown {
  if (cliType === 'claudeCode') {
    return {
      type: 'error',
      error: {
        type: 'overloaded_error',
        message: ALL_ROUTE_PATHS_DISABLED_MESSAGE,
      },
    };
  }

  return {
    error: {
      message: ALL_ROUTE_PATHS_DISABLED_MESSAGE,
      type: 'server_error',
      param: null,
      code: ALL_ROUTE_PATHS_DISABLED_ERROR_CODE,
    },
  };
}

function resolveRoutePathsRetryAfterSeconds(channels: ResolvedChannel[]): number | undefined {
  const now = Date.now();
  const earliest = channels
    .map(channel => getRoutePathDisabledUntil(channel, now))
    .filter((until): until is number => until !== undefined)
    .reduce<number | undefined>(
      (min, until) => (min === undefined ? until : Math.min(min, until)),
      undefined
    );
  if (earliest === undefined) return undefined;
  return Math.min(
    Math.max(1, Math.ceil((earliest - now) / 1000)),
    ALL_ROUTE_PATHS_DISABLED_RETRY_AFTER_MAX_SECONDS
  );
}

function writeAllRoutePathsDisabledResponse(
  res: http.ServerResponse,
  cliType: RouteCliType,
  channels: ResolvedChannel[]
): void {
  const retryAfterSeconds = resolveRoutePathsRetryAfterSeconds(channels);
  writeRouteProxyErrorHead(
    res,
    ALL_ROUTE_PATHS_DISABLED_STATUS_CODE,
    ALL_ROUTE_PATHS_DISABLED_ERROR_CODE,
    {
      ...JSON_RESPONSE_HEADERS,
      ...(retryAfterSeconds !== undefined ? { 'Retry-After': String(retryAfterSeconds) } : {}),
    }
  );
  res.end(JSON.stringify(buildAllRoutePathsDisabledErrorBody(cliType)));
}

function buildUpstreamTemporarilyUnavailableErrorBody(
  cliType: RouteCliType,
  message: string = UPSTREAM_TEMPORARILY_UNAVAILABLE_MESSAGE
): unknown {
  if (cliType === 'claudeCode') {
    return {
      type: 'error',
      error: {
        type: 'overloaded_error',
        message,
      },
    };
  }

  return {
    error: {
      message,
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
  writeRouteProxyErrorHead(
    res,
    UPSTREAM_TEMPORARILY_UNAVAILABLE_STATUS_CODE,
    UPSTREAM_TEMPORARILY_UNAVAILABLE_ERROR_CODE
  );
  res.end(JSON.stringify(buildUpstreamTemporarilyUnavailableErrorBody(cliType)));
}

function buildRetainedFailureErrorBody(summary: string): unknown {
  return {
    error: ALL_CHANNELS_FAILED_ERROR_CODE,
    message: summary ? `${ALL_CHANNELS_FAILED_MESSAGE}: ${summary}` : ALL_CHANNELS_FAILED_MESSAGE,
  };
}

/**
 * 请求侧致命且所有尝试过的候选一致如此：重试不可能成功，且 request_fatal 记 neutral
 * 永远不会累积到通道禁用，故必须把上游 4xx 透传出去让客户端停止，避免无限重试。
 * 诊断信息只走响应头；配额类失败永不进入此分支。
 */
function writeRequestFatalPassthroughResponse(
  res: http.ServerResponse,
  failure: RouteUpstreamFailure,
  attempts: number
): void {
  const upstreamBody = failure.rawBody?.length ? failure.rawBody : undefined;
  const body =
    upstreamBody ?? Buffer.from(JSON.stringify(buildRetainedFailureErrorBody(failure.summary)));

  writeRouteProxyErrorHead(res, failure.statusCode ?? 400, 'request_fatal_passthrough', {
    ...buildBufferedResponseHeaders(upstreamBody ? (failure.headers ?? {}) : {}, body),
    ...(upstreamBody ? {} : JSON_RESPONSE_HEADERS),
    'X-Route-Proxy-Attempts': String(attempts),
    'X-Route-Proxy-Failure-Class': failure.failureClass,
  });
  res.end(body);
}

/**
 * 其余所有上游失败都被路由吸收为可重试的 503：单个上游错误不得终止客户端对话。
 * 真实成因保留在 message、路由日志与诊断响应头中，不透传上游状态码与响应体。
 * 通道健康度会随失败累积，最终由 all_route_paths_disabled(503 + Retry-After) 让客户端退避。
 */
function writeAbsorbedUpstreamFailureResponse(
  res: http.ServerResponse,
  cliType: RouteCliType,
  failure: RouteUpstreamFailure,
  attempts: number
): void {
  const message = failure.summary
    ? `${UPSTREAM_TEMPORARILY_UNAVAILABLE_MESSAGE} (${failure.summary})`
    : UPSTREAM_TEMPORARILY_UNAVAILABLE_MESSAGE;

  writeRouteProxyErrorHead(
    res,
    UPSTREAM_TEMPORARILY_UNAVAILABLE_STATUS_CODE,
    UPSTREAM_TEMPORARILY_UNAVAILABLE_ERROR_CODE,
    {
      ...JSON_RESPONSE_HEADERS,
      'X-Route-Proxy-Attempts': String(attempts),
      'X-Route-Proxy-Failure-Class': failure.failureClass,
      ...(failure.statusCode !== undefined
        ? { 'X-Route-Proxy-Upstream-Status': String(failure.statusCode) }
        : {}),
    }
  );
  res.end(JSON.stringify(buildUpstreamTemporarilyUnavailableErrorBody(cliType, message)));
}

interface PreparedUpstreamRequest {
  finalBody: Buffer;
  additionalHeaders: Record<string, string>;
  methodOverride?: string;
  requestUrlOverride?: string;
  upstreamCliType: RouteCliType;
  responseAdapter: AnyRouterResponseAdapter;
  protocolResponseAdapters: CliProtocolResponseAdapter[];
  /** 覆写后请求体里实际生效的思考强度 */
  reasoningEffort?: string;
}

interface UpstreamRequestAdaptFailure {
  stage: string;
  reason: string;
}

/**
 * 单次尝试的请求改写：model 重写 → AnyRouter 站点改写或跨协议适配 → 思考强度覆写。
 * 适配失败返回 { stage, reason }，由调用方决定记账与是否换通道。
 */
function prepareUpstreamRequest(input: {
  req: http.IncomingMessage;
  bodyBuffer: Buffer;
  channel: ResolvedChannel;
  site: ReturnType<typeof unifiedConfigManager.getSiteById>;
  account: ReturnType<typeof unifiedConfigManager.getAccountById>;
  sourceProtocol: ConcreteCliTargetProtocol;
  upstreamProtocol: ConcreteCliTargetProtocol;
  sourceAdapterCliType: RouteCliType;
  requestIsTokenCount: boolean;
  selectedThinkingEffort: RouteThinkingEffort;
}): PreparedUpstreamRequest | UpstreamRequestAdaptFailure {
  const { req, channel, site, account, sourceProtocol, upstreamProtocol, sourceAdapterCliType } =
    input;
  const prepared: PreparedUpstreamRequest = {
    finalBody: channel.resolvedModel
      ? rewriteRequestModel(input.bodyBuffer, channel.resolvedModel)
      : input.bodyBuffer,
    additionalHeaders: {},
    upstreamCliType: getAdapterCliTypeForProtocol(upstreamProtocol),
    responseAdapter: { type: 'transparent' },
    protocolResponseAdapters: [],
  };

  // 站点级特殊处理：AnyRouter 仅在同协议透传时保留，其余显式 targetProtocol 走通用适配
  if (
    !input.requestIsTokenCount &&
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
      prepared.finalBody,
      userHash,
      req.headers,
      sourceAdapterCliType,
      req.url,
      channel.resolvedModel
    );
    prepared.finalBody = rewritten.body;
    prepared.additionalHeaders = rewritten.headers;
    prepared.requestUrlOverride = rewritten.upstreamPath;
    prepared.upstreamCliType = rewritten.upstreamCliType;
    prepared.responseAdapter = rewritten.responseAdapter;
  } else if (!input.requestIsTokenCount && sourceProtocol !== upstreamProtocol) {
    try {
      const rewritten = adaptRequestToTargetProtocol(
        prepared.finalBody,
        sourceAdapterCliType,
        upstreamProtocol,
        req.url,
        channel.resolvedModel,
        sourceProtocol
      );
      prepared.finalBody = rewritten.body;
      prepared.additionalHeaders = { ...rewritten.headers };
      prepared.methodOverride = rewritten.upstreamMethod;
      prepared.requestUrlOverride = rewritten.upstreamPath;
      prepared.upstreamCliType = rewritten.upstreamCliType;
      prepared.protocolResponseAdapters.push(rewritten.responseAdapter);
    } catch (err: unknown) {
      const isAdapterError = err instanceof CliProtocolAdapterError;
      return {
        stage: isAdapterError ? err.stage : 'request-adapt',
        reason: isAdapterError ? err.reason : err instanceof Error ? err.message : 'unknown_error',
      };
    }
  }

  prepared.finalBody = applyRouteThinkingEffortOverride(
    prepared.finalBody,
    input.selectedThinkingEffort,
    upstreamProtocol
  );
  try {
    prepared.reasoningEffort = extractRouteReasoningEffort(
      JSON.parse(prepared.finalBody.toString('utf-8'))
    );
  } catch {
    /* 非 JSON 请求体：保留调用方原有的 reasoningEffort */
  }
  return prepared;
}

interface RuleRoutePlanInput {
  ctx: RouteRequestContext;
  res: http.ServerResponse;
  routing: RoutingConfig;
  cliType: RouteCliType;
  sourceProtocol: ConcreteCliTargetProtocol;
  canonicalModel: string | null;
  rawModel: string | null;
  reasoningEffort: RouteThinkingEffort;
  routeInstance: RouteInstance | null;
  hasRouteProfile: boolean;
  sessionRouting: RouteSessionRoutingConfig;
  nativePassthroughChannels: WeakSet<ResolvedChannel>;
}

interface RuleRoutePlan {
  routeRuleId: string;
  routeRuntimeConfig: RouteRuntimeConfig;
  channels: ResolvedChannel[];
}

/**
 * 规则选路：匹配规则 → 解析候选 → 优先级/亲和排序。
 * 没有可用候选时直接写终结响应并返回 null，调用方应立即 return。
 */
async function planRuleRouteCandidates(input: RuleRoutePlanInput): Promise<RuleRoutePlan | null> {
  const {
    ctx,
    res,
    routing,
    cliType,
    sourceProtocol,
    canonicalModel,
    rawModel,
    reasoningEffort,
    routeInstance,
    sessionRouting,
    nativePassthroughChannels,
  } = input;
  const { requestId } = ctx;
  const recordPlanningFailure = (statusCode: number, error: string, routeRuleId?: string): void => {
    ctx.recordRequest({
      requestId,
      attempt: 0,
      cliType,
      requestedModel: rawModel,
      reasoningEffort,
      canonicalModel,
      ...(routeRuleId ? { routeRuleId } : {}),
      outcome: 'failure',
      statusCode,
      error,
    });
  };

  // 规则匹配只看 canonical model；若当前请求尚未建立 canonical，则退化为 raw。
  // RouteInstance model is authoritative; otherwise the wire model seeds the route.
  let sortedRules = sortRules(routing.rules);
  const matchModel = canonicalModel || rawModel;
  let rule = findMatchingProtocolRule(sortedRules, sourceProtocol, matchModel);

  if (!rule && (routeInstance || input.hasRouteProfile) && matchModel) {
    await unifiedConfigManager.ensureRouteRuleForProtocolModelSelection(sourceProtocol, matchModel);
    if (ctx.stopIfClientCancelled()) {
      return null;
    }
    sortedRules = sortRules(routing.rules);
    rule = findMatchingProtocolRule(sortedRules, sourceProtocol, matchModel);
  }

  if (!rule) {
    recordPlanningFailure(502, 'no_matching_rule');
    writeRouteProxyJsonError(
      res,
      502,
      'no_matching_rule',
      `No routing rule matched for ${sourceProtocol} / ${matchModel || '(empty model)'}`
    );
    return null;
  }

  Object.assign(ctx.logContext, { routeRuleId: rule.id });

  // 解析候选通道（带 canonical model 过滤）
  const channels = resolveChannels(rule, canonicalModel);
  if (channels.length === 0) {
    recordPlanningFailure(503, 'no_channels', rule.id);
    writeRouteProxyJsonError(res, 503, 'no_channels', 'No available channels for this rule');
    return null;
  }
  const routeRuntimeConfig = resolveRouteRuntimeConfig(routing, canonicalModel);
  const enabledChannels = filterChannelsByPriorityConfig(channels, routing, canonicalModel);
  const resolvedChannels = await resolveChannelTargets(enabledChannels);
  if (resolvedChannels.length === 0) {
    recordPlanningFailure(503, 'no_compatible_upstream_protocol', rule.id);
    writeRouteProxyJsonError(
      res,
      503,
      'no_compatible_upstream_protocol',
      `No upstream supports ${sourceProtocol} or provides an unambiguous conversion target`
    );
    return null;
  }
  if (ctx.stopIfClientCancelled()) {
    return null;
  }
  const attemptPlan = buildChannelAttemptPlan(
    sortChannelsByScore(resolvedChannels),
    routeRuntimeConfig.maxAttemptsPerRoutePath
  ).map(channel =>
    resolveEffectiveRouteChannel(channel, sourceProtocol, nativePassthroughChannels)
  );
  const affinityInvalidatedAt = getEffectiveRouteDisplayItem(routing.modelRegistry, canonicalModel)
    ?.priorityConfig?.affinityInvalidatedAt;
  let sortedChannels = applySuccessfulRoutePathAffinity(
    attemptPlan.filter(channel => !isRoutePathDisabled(channel)) as ResolvedChannel[],
    routing.routePathStates,
    Date.now(),
    affinityInvalidatedAt
  );
  // 会话绑定排在全局 affinity 之后应用，因而位次更靠前；未绑定的新会话则在
  // 用户配置顺序内部避开其他活跃会话已占用的通道。
  if (routeInstance) {
    const existingBinding = routeSessionBindingService.get(routeInstance.id);
    if (existingBinding) {
      sortedChannels = applySessionChannelAffinity(
        sortedChannels,
        existingBinding,
        routing.routePathStates,
        Date.now(),
        affinityInvalidatedAt
      );
    } else {
      // 占用只统计仍然活跃的会话：已关闭/陈旧的绑定不得把新会话推离其首选通道。
      const liveInstanceIds = new Set(
        Object.values(sessionRouting.instances || {})
          .filter(
            instance =>
              instance.routingState === 'active' &&
              (!instance.profileId ||
                routing.clientRouting?.[instance.profileId]?.mode !== 'client')
          )
          .map(instance => instance.id)
      );
      const occupied = new Set(
        routeSessionBindingService
          .listActive()
          .filter(
            binding =>
              binding.instanceId !== routeInstance.id && liveInstanceIds.has(binding.instanceId)
          )
          .map(binding => `${binding.siteId}|${binding.accountId}|${binding.apiKeyId}`)
      );
      const index = pickDistributedChannelIndex(sortedChannels, occupied);
      if (index > 0) {
        sortedChannels = [
          sortedChannels[index],
          ...sortedChannels.slice(index + 1),
          ...sortedChannels.slice(0, index),
        ];
      }
    }
  }
  if (sortedChannels.length === 0) {
    recordPlanningFailure(
      ALL_ROUTE_PATHS_DISABLED_STATUS_CODE,
      ALL_ROUTE_PATHS_DISABLED_ERROR_CODE,
      rule.id
    );
    writeAllRoutePathsDisabledResponse(res, cliType, attemptPlan);
    return null;
  }
  return { routeRuleId: rule.id, routeRuntimeConfig, channels: sortedChannels };
}

export async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const pathname = getRequestPathname(req.url);
  const initialCliType =
    detectMarkedRouteCliType(req.headers) ?? detectCliTypeFromPath(pathname) ?? 'codex';
  const requestId = nextRequestId(initialCliType);
  const ctx = new RouteRequestContext(req, res, initialCliType, {
    requestId,
    method: normalizeRouteDiagnosticCategory((req.method || 'GET').toUpperCase(), [
      'GET',
      'HEAD',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
      'CONNECT',
      'TRACE',
    ]),
    path: getRouteDiagnosticPath(pathname),
    sourceProtocol: inferSourceProtocol(pathname),
  });

  const routing = unifiedConfigManager.getRoutingConfig();
  if ((req.method || 'GET').toUpperCase() === 'HEAD' && pathname === '/') {
    ctx.recordRequest({
      ...ctx.logContext,
      outcome: 'neutral',
      statusCode: 204,
    });
    res.writeHead(204);
    res.end();
    return;
  }
  const endpointOperation = classifyRouteEndpointOperation(req.method, req.url);
  if (!endpointOperation) {
    ctx.recordRequest({
      ...ctx.logContext,
      outcome: 'failure',
      statusCode: 404,
      error: 'unsupported_route',
    });
    writeRouteProxyJsonError(res, 404, 'unsupported_route', `No route handler for ${pathname}`);
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
    ctx.recordRequest({
      ...ctx.logContext,
      outcome: 'failure',
      statusCode: 404,
      error: 'unsupported_route',
    });
    writeRouteProxyJsonError(res, 404, 'unsupported_route', `No route handler for ${pathname}`);
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
    ctx.recordRequest({
      ...ctx.logContext,
      outcome: 'failure',
      statusCode: 401,
      error: 'ambiguous_credentials',
    });
    writeRouteProxyJsonError(
      res,
      401,
      'ambiguous_credentials',
      'Credentials resolve to multiple route identities'
    );
    return;
  }

  Object.assign(ctx.logContext, {
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
    ctx.recordRequest({
      ...ctx.logContext,
      outcome: 'failure',
      statusCode: 401,
      error: 'invalid_api_key',
    });
    writeRouteProxyJsonError(res, 401, 'invalid_api_key', 'Invalid route API key');
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
    writeRouteProxyJsonError(
      res,
      403,
      'target_lock_forbidden',
      'Target-lock requests are only allowed from loopback clients'
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
    ctx.recordRequest({
      ...ctx.logContext,
      outcome: 'failure',
      statusCode: 501,
      error,
    });
    writeRouteProxyJsonError(
      res,
      501,
      error,
      `${req.method || 'GET'} ${pathname} is not supported by the local route`
    );
    return;
  }
  if (endpointOperation.capability === 'model-discovery') {
    const discovery = buildRouteModelDiscoveryResponse(routing, req);
    ctx.recordRequest({
      ...ctx.logContext,
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
  if (ctx.stopIfClientCancelled()) {
    return;
  }

  // 读取请求体
  let bodyBuffer: Buffer;
  try {
    bodyBuffer = await readBody(req);
    ctx.requestBodyRead = true;
  } catch (err: unknown) {
    if (isRouteClientCancelledError(err)) {
      ctx.cancel();
      ctx.finish();
      return;
    }
    throw err;
  }
  if (ctx.stopIfClientCancelled()) {
    return;
  }
  let bodyJson: unknown = null;
  try {
    bodyJson = JSON.parse(bodyBuffer.toString('utf-8'));
  } catch {
    /* ignore */
  }
  const clientRouting = routeProfile ? { ...routing.clientRouting?.[routeProfile.id] } : undefined;
  const routingMode = clientRouting?.mode === 'client' ? 'client' : 'session';
  const sessionRouting =
    routing.sessionRouting ??
    (routing.sessionRouting = structuredClone(DEFAULT_ROUTE_SESSION_ROUTING_CONFIG));
  const observedRouteInstanceKey = extractObservedRouteInstanceKey(
    req,
    bodyJson,
    sessionRouting.extractionRules,
    sourceProtocol
  );
  const hasRejectedRouteInstanceEvidence =
    !observedRouteInstanceKey && hasObservedRouteInstanceEvidence(req, bodyJson);
  ctx.agentId = observedRouteInstanceKey?.agentId;
  ctx.agentName =
    observedRouteInstanceKey?.observedAgentName ||
    observedRouteInstanceKey?.agentId ||
    routeProfile?.name;
  const responsesStateRequest = classifyResponsesStateRequest(endpointOperation, bodyJson);
  if (responsesStateRequest && !routeProfile) {
    if (!targetLock) {
      ctx.recordRequest({
        ...ctx.logContext,
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
      ctx.recordRequest({
        ...ctx.logContext,
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
      ctx.recordRequest({
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
    writeRouteProxyJsonError(
      res,
      501,
      'stateful_request_unsupported',
      `Provider-owned state reference is not supported: ${stateReference}`
    );
    return;
  }
  const rawModel = extractModelFromBody(bodyJson) || extractModelFromPath(pathname, cliType);
  const globalModelRoute =
    routeProfile && !targetLock && !stateAffinityRecord
      ? routing.globalModelRoutes?.find(route => route.enabled && route.requestModel === rawModel)
      : undefined;
  // A client credential identifies the profile, never the conversation.
  if (
    routeProfile &&
    !globalModelRoute &&
    routingMode === 'session' &&
    !observedRouteInstanceKey &&
    endpointOperation.capability === 'generation-convertible' &&
    !stateAffinityRecord
  ) {
    const error = 'session_identity_required';
    ctx.recordRequest({
      ...ctx.logContext,
      requestedModel: rawModel,
      outcome: 'failure',
      statusCode: 409,
      error,
    });
    writeRouteProxyJsonError(
      res,
      409,
      error,
      '会话级路由缺少有效会话 ID。请让客户端随请求发送稳定的会话标识，' +
        '或在该客户端分组中切换到客户端级路由。'
    );
    return;
  }
  if (
    !globalModelRoute &&
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
  Object.assign(ctx.logContext, {
    requestedModel: rawModel,
    reasoningEffort: requestedReasoningEffort,
  });
  const routeInstanceResolution: RouteInstanceResolution = globalModelRoute
    ? { instance: null, changed: false, resolutionPath: 'global-model' }
    : routingMode === 'client'
      ? { instance: null, changed: false, resolutionPath: 'client' }
      : await unifiedConfigManager.mutateConfig(async () => {
          const result = resolveRouteInstanceForRequest({
            config: unifiedConfigManager.getRoutingConfig().sessionRouting ?? sessionRouting,
            profileId:
              routeProfile?.id ||
              `__target_lock__:${targetLock?.siteId}:${targetLock?.accountId}:${targetLock?.apiKeyId}`,
            observedKey: observedRouteInstanceKey,
            requestedModel: requestedCanonicalModel,
            requestedReasoningEffort: requestedReasoningEffort || null,
            defaultModel: '',
            defaultReasoningEffort: 'medium',
            requestAt: ctx.startedAt,
          });
          if (result.changed) await unifiedConfigManager.saveConfig();
          return result;
        });
  const identitySource = observedRouteInstanceKey?.lineage?.source
    ? observedRouteInstanceKey.lineage.source
    : observedRouteInstanceKey?.agentId.startsWith('profile:')
      ? 'profile'
      : observedRouteInstanceKey?.agentId.startsWith('session:')
        ? 'generic'
        : observedRouteInstanceKey
          ? 'explicit'
          : 'none';
  const requestKind = normalizeRouteDiagnosticCategory(
    observedRouteInstanceKey?.lineage?.requestKind,
    ['turn', 'prewarm', 'compaction', 'memory']
  );
  const threadSource = normalizeRouteDiagnosticCategory(
    observedRouteInstanceKey?.lineage?.threadSource,
    ['user', 'system', 'subagent', 'guardian_review', 'memory_consolidation']
  );
  log.debug('RouteInstance identity binding', {
    requestId,
    method: req.method,
    path: getRouteDiagnosticPath(pathname),
    sourceProtocol,
    identitySource,
    hasCurrentIdentity: Boolean(observedRouteInstanceKey?.sessionId),
    hasRootIdentity: Boolean(observedRouteInstanceKey?.lineage?.rootSessionId),
    hasParentIdentity: Boolean(observedRouteInstanceKey?.lineage?.parentSessionId),
    ...(requestKind ? { requestKind } : {}),
    ...(threadSource ? { threadSource } : {}),
    isCodexUtility: Boolean(routeInstanceResolution.utilityRequest),
    sessionIdHash: fingerprintRouteIdentity(observedRouteInstanceKey?.sessionId),
    rootSessionIdHash: fingerprintRouteIdentity(observedRouteInstanceKey?.lineage?.rootSessionId),
    parentThreadIdHash: fingerprintRouteIdentity(
      observedRouteInstanceKey?.lineage?.parentSessionId
    ),
    forkedFromThreadIdHash: fingerprintRouteIdentity(
      observedRouteInstanceKey?.lineage?.forkedFromThreadId
    ),
    resolutionPath: routeInstanceResolution.resolutionPath,
    createdReason: routeInstanceResolution.createdReason,
    memberAppended: routeInstanceResolution.memberAppended,
    rejectedEvidence: hasRejectedRouteInstanceEvidence,
    rejectionReason: hasRejectedRouteInstanceEvidence
      ? 'invalid_or_incomplete_identity'
      : observedRouteInstanceKey
        ? undefined
        : 'no_identity_evidence',
    bindingState: globalModelRoute
      ? 'global-model'
      : routeInstanceResolution.instance
        ? 'bound'
        : routeInstanceResolution.utilityRequest
          ? 'utility'
          : hasRejectedRouteInstanceEvidence
            ? 'rejected'
            : 'unidentified',
    profileIdHash: fingerprintRouteIdentity(routeProfile?.id),
    instanceIdHash: fingerprintRouteIdentity(routeInstanceResolution.instance?.id),
  });
  ctx.instanceLogId = routeInstanceResolution.instance?.id;
  if (
    !routeInstanceResolution.instance &&
    !(routingMode === 'client' && clientRouting?.modelId) &&
    !rawModel &&
    !stateAffinityRecord &&
    !targetLock
  ) {
    ctx.recordRequest({
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
    writeRouteProxyJsonError(
      res,
      400,
      'model_required',
      'A model is required when no RouteInstance is bound'
    );
    return;
  }
  if (routeInstanceResolution.changed) {
    if (ctx.stopIfClientCancelled()) {
      return;
    }
  }
  if (routeInstanceResolution.instance) {
    routeSessionActivityService.touch(routeInstanceResolution.instance);
    ctx.agentId = routeInstanceResolution.instance.routeKey?.agentId;
    ctx.agentName =
      routeInstanceResolution.instance.display.customAgentName ||
      routeInstanceResolution.instance.display.observedAgentName ||
      ctx.agentId ||
      routeProfile?.name;
  }
  const selectedThinkingEffort =
    normalizeRouteThinkingEffort(globalModelRoute?.reasoningEffort) ??
    (routingMode === 'client'
      ? normalizeRouteThinkingEffort(clientRouting?.reasoningEffort)
      : null) ??
    normalizeRouteThinkingEffort(routeInstanceResolution.instance?.reasoningEffort) ??
    requestedReasoningEffort ??
    'medium';
  let reasoningEffort = selectedThinkingEffort;

  // 解析 canonical model（代理层无 site 上下文，使用全局 alias 索引）。
  let canonicalModel: string | null =
    globalModelRoute?.modelId ||
    (routingMode === 'client'
      ? resolveCanonicalModelFromRegistry(routing, clientRouting?.modelId || null)
      : null) ||
    routeInstanceResolution.instance?.modelId.trim() ||
    requestedCanonicalModel;
  Object.assign(ctx.logContext, {
    requestedModel: rawModel,
    reasoningEffort,
    canonicalModel,
    routingMode,
    profileId: routeProfile?.id,
    globalModelRouteId: globalModelRoute?.id,
    modelSelectionSource: targetLock
      ? 'target-lock'
      : globalModelRoute
        ? 'global-model'
        : routingMode === 'client' && clientRouting?.modelId
          ? 'client'
          : routeInstanceResolution.instance
            ? 'session'
            : 'request',
  });

  let activeRouteRuleId: string | undefined;
  let sortedChannels: ResolvedChannel[] = [];
  let routeRuntimeConfig = resolveRouteRuntimeConfig(routing, canonicalModel);
  const bypassRoutePathState = Boolean(targetLock || stateAffinityRecord);

  if (targetLock) {
    canonicalModel = targetLock.canonicalModel;
    Object.assign(ctx.logContext, {
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
    if (ctx.stopIfClientCancelled()) {
      return;
    }
  } else if (stateAffinityRecord) {
    activeRouteRuleId = stateAffinityRecord.routeRuleId;
    Object.assign(ctx.logContext, { routeRuleId: activeRouteRuleId });
    sortedChannels = [
      buildAffinityChannel(stateAffinityRecord, sourceProtocol, canonicalModel, rawModel),
    ];
  } else {
    const plan = await planRuleRouteCandidates({
      ctx,
      res,
      routing,
      cliType,
      sourceProtocol,
      canonicalModel,
      rawModel,
      reasoningEffort,
      routeInstance: routeInstanceResolution.instance,
      hasRouteProfile: Boolean(routeProfile),
      sessionRouting,
      nativePassthroughChannels,
    });
    if (!plan) {
      return;
    }
    activeRouteRuleId = plan.routeRuleId;
    routeRuntimeConfig = plan.routeRuntimeConfig;
    sortedChannels = plan.channels;
  }
  if (responsesStateRequest?.createsResource) {
    sortedChannels = sortedChannels.filter(
      channel =>
        resolveChannelUpstreamProtocol(channel.targetProtocol, sourceProtocol) ===
        'openai-responses'
    );
    if (sortedChannels.length === 0) {
      if (!targetLock) {
        ctx.recordRequest({
          ...ctx.logContext,
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
      ctx.recordRequest({
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
  let rectifierRetried = false;
  let tokenCountFallbackReason: string | undefined;
  const adapterIncompatibilityReasons: string[] = [];
  const attemptsByRoutePath = new Map<string, number>();
  const quotaExhaustedRoutePaths = new Set<string>();
  const routePathRetryAfterUntil = new Map<string, number>();
  let retainedFailure: RouteUpstreamFailure | undefined;
  // 只有当所有实际尝试过的候选都判为 request_fatal 时，才认定请求本身不可重试。
  let sawNonRequestFatalFailure = false;
  let quotaExhaustionEncountered = false;
  const requestFatalFingerprint = buildRequestFatalFingerprint(bodyJson, bodyBuffer.length);
  const requestFatalCacheApplies =
    Boolean(requestFatalFingerprint) && !bypassRoutePathState && !targetLock;
  // 全部候选都被负缓存命中时忽略缓存照常尝试：保底"所有通道一致 request_fatal"
  // 时的透传语义（writeRequestFatalPassthroughResponse 需要 seenRequestFatal）。
  const allPathsRequestFatalCached =
    requestFatalCacheApplies &&
    sortedChannels.every(ch =>
      readRequestFatalNegativeCache(
        buildChannelAttemptPathKey(ch),
        requestFatalFingerprint,
        Date.now()
      )
    );
  for (let i = 0; i < sortedChannels.length; i++) {
    if (ctx.stopIfClientCancelled()) {
      return;
    }
    // 全局尝试预算：跨所有候选通道的尝试总数上限。
    if (attempt >= ROUTE_GLOBAL_MAX_ATTEMPTS) {
      break;
    }
    // 请求级重试决策预算：已耗时过久就不再开新的故障转移尝试（首次尝试不受限）。
    if (attempt >= 1 && Date.now() - ctx.startedAt >= ROUTE_RETRY_DECISION_BUDGET_MS) {
      break;
    }
    const ch = sortedChannels[i];
    if (!bypassRoutePathState && isRoutePathDisabled(ch)) {
      continue;
    }

    const routePathKey = buildChannelAttemptPathKey(ch);
    if (quotaExhaustedRoutePaths.has(routePathKey)) {
      continue;
    }
    if (
      requestFatalCacheApplies &&
      !allPathsRequestFatalCached &&
      readRequestFatalNegativeCache(routePathKey, requestFatalFingerprint, Date.now())
    ) {
      continue;
    }
    const routePathAttempts = attemptsByRoutePath.get(routePathKey) ?? 0;
    if (routePathAttempts >= routeRuntimeConfig.maxAttemptsPerRoutePath) {
      continue;
    }
    // 上游给过 Retry-After：短冷却就等，长冷却直接跳过这次计划尝试。
    const retryAfterRemaining = (routePathRetryAfterUntil.get(routePathKey) ?? 0) - Date.now();
    if (retryAfterRemaining > 0) {
      if (retryAfterRemaining > ROUTE_SAME_PATH_RETRY_MAX_DELAY_MS) {
        continue;
      }
      try {
        await delayWithAbort(retryAfterRemaining, ctx.signal);
      } catch {
        ctx.stopIfClientCancelled();
        return;
      }
      if (ctx.stopIfClientCancelled()) {
        return;
      }
    }
    attemptsByRoutePath.set(routePathKey, routePathAttempts + 1);

    attempt += 1;
    const activeChannel: ResolvedChannel = {
      ...ch,
    };
    Object.assign(ctx.logContext, {
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
    if (ctx.stopIfClientCancelled()) {
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
      ctx.recordRequest({
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
        await ctx.recordPathOutcome(
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

    const prepared = prepareUpstreamRequest({
      req,
      bodyBuffer,
      channel: activeChannel,
      site,
      account,
      sourceProtocol,
      upstreamProtocol,
      sourceAdapterCliType,
      requestIsTokenCount,
      selectedThinkingEffort,
    });
    if ('stage' in prepared) {
      const { stage, reason } = prepared;
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
      ctx.recordRequest({
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
    const {
      finalBody,
      additionalHeaders,
      methodOverride,
      requestUrlOverride,
      upstreamCliType,
      responseAdapter,
      protocolResponseAdapters,
    } = prepared;
    reasoningEffort = prepared.reasoningEffort ?? reasoningEffort;
    Object.assign(ctx.logContext, { reasoningEffort });

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
    // 半开路径只放行一个探测；名额在规划到此处之间可能已被并发请求占走。
    if (!bypassRoutePathState && !beginRoutePathAttempt(activeChannel)) {
      continue;
    }
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
              agentId: ctx.agentId,
              agentName: ctx.agentName,
              siteId: targetLock.siteId,
              accountId: targetLock.accountId,
              apiKeyId: targetLock.apiKeyId,
              rawModel: targetLock.rawModel,
            }
          );
          writeRouteProxyErrorHead(
            res,
            TARGET_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_STATUS_CODE,
            TARGET_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_ERROR_CODE
          );
          res.end(terminalError);
          return;
        }
        targetLockIsFinalAttempt = attempt.isFinalAttempt;
      }

      let activeBody = finalBody;
      const forwardActiveChannel = () =>
        forwardToUpstream(
          req,
          creds.baseUrl,
          creds.apiKey,
          activeBody,
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
            signal: ctx.signal,
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
            onUpstreamAttempt: () => {
              ctx.upstreamAttemptCount += 1;
            },
            onStreamCompletionDelivered: () => {
              ctx.streamCompletionDelivered = true;
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
              ctx.signal.aborted ||
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
            await delayWithAbort(ROUTE_SAME_CHANNEL_RETRY_BACKOFF_MS, ctx.signal);
          }
        }
      };

      let result = await forwardActiveChannelWithEmptyStreamRetry();
      if (
        !rectifierRetried &&
        !res.headersSent &&
        !ctx.signal.aborted &&
        !targetLock &&
        !responsesStateRequest &&
        attempt < ROUTE_GLOBAL_MAX_ATTEMPTS
      ) {
        const repair = rectifyRejectedRequest(activeBody, result.statusCode, result.body);
        if (repair) {
          rectifierRetried = true;
          ctx.recordRequest({
            ...ctx.logContext,
            outcome: 'neutral',
            statusCode: result.statusCode,
            error: `request_rectified:${repair.kind}`,
          });
          attempt += 1;
          Object.assign(ctx.logContext, { attempt });
          log.info('Retrying repaired upstream request', { requestId, attempt, kind: repair.kind });
          activeBody = repair.body;
          result = await forwardActiveChannel();
        }
      }
      if (ctx.signal.aborted || ctx.clientCancelled) {
        ctx.clientCancelled = true;
        ctx.recordClientCancellation();
        if (!bypassRoutePathState && shouldRecordCancelledUpstreamPathSuccess(result)) {
          await recordCancelledUpstreamPathSuccess({
            requestSelectionStartedAt: ctx.startedAt,
            activeChannel,
            result,
            routeRuntimeConfig,
          });
        }
        ctx.finish();
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
        await delayWithAbort(ROUTE_SAME_CHANNEL_RETRY_BACKOFF_MS, ctx.signal);
        result = await forwardActiveChannel();
        if (ctx.signal.aborted || ctx.clientCancelled) {
          ctx.clientCancelled = true;
          ctx.recordClientCancellation();
          if (!bypassRoutePathState && shouldRecordCancelledUpstreamPathSuccess(result)) {
            await recordCancelledUpstreamPathSuccess({
              requestSelectionStartedAt: ctx.startedAt,
              activeChannel,
              result,
              routeRuntimeConfig,
            });
          }
          ctx.finish();
          return;
        }
        outcome = classifyRouteStatusCode(result.statusCode);
      }
      const upstreamFailure =
        outcome === 'failure'
          ? classifyUpstreamFailure({
              statusCode: result.statusCode,
              headers: result.headers,
              body: result.body,
            })
          : undefined;
      const upstreamFailureBodySnippet = upstreamFailure?.summary ?? '';
      const quotaExhausted =
        !bypassRoutePathState && upstreamFailure?.failureClass === 'quota_exhausted';
      // 已提交的原生 Anthropic 流被上游截断：HTTP 仍是 2xx，只能靠这个标志纠正记账。
      const nativeStreamTruncated = Boolean(result.missingTerminalEvent);
      const routeRequestLogError = nativeStreamTruncated
        ? NATIVE_STREAM_MISSING_TERMINAL_ERROR
        : quotaExhausted
          ? buildQuotaExhaustedRouteLogError(upstreamFailureBodySnippet)
          : upstreamFailureBodySnippet;
      // 请求侧致命错误在每个候选通道都会复现；计入成功率窗口会误禁用健康通道。
      // 仅改记账，故障转移行为对所有类别保持不变。
      // 截断只覆写记账：改写 outcome 会触发换通道，而字节已经发出去了。
      const accountingOutcome = nativeStreamTruncated
        ? 'failure'
        : upstreamFailure
          ? failureClassToOutcome(upstreamFailure.failureClass)
          : outcome;
      // 上游确证不可用（凭证被拒 / 模型不存在 / 配额耗尽）：首次即禁用该路径，
      // 不再每次请求都先撞一次坏通道。request_fatal 恒为 undefined，永不禁用。
      const confirmedUnavailable = upstreamFailure
        ? resolveRoutePathDisabledReason(upstreamFailure)
        : undefined;
      if (upstreamFailure) {
        retainedFailure = retainUpstreamFailure(retainedFailure, upstreamFailure);
        if (upstreamFailure.failureClass === 'overflow' && !targetLock && !responsesStateRequest) {
          const capacity = (channel: ResolvedChannel) =>
            getModelMetadata(channel.resolvedModel)?.context ?? 0;
          const remaining = sortedChannels.slice(i + 1);
          remaining.sort((left, right) => capacity(right) - capacity(left));
          sortedChannels.splice(i + 1, remaining.length, ...remaining);
        }
        if (upstreamFailure.failureClass !== 'request_fatal') {
          sawNonRequestFatalFailure = true;
        }
        if (upstreamFailure.retryAfterMs !== undefined) {
          routePathRetryAfterUntil.set(routePathKey, Date.now() + upstreamFailure.retryAfterMs);
        }
        if (upstreamFailure.failureClass === 'request_fatal') {
          writeRequestFatalNegativeCache(routePathKey, requestFatalFingerprint, Date.now());
        }
      }

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
        if (ctx.stopIfClientCancelled()) {
          return;
        }
        ctx.recordRequest({
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
          await ctx.recordPathOutcome(
            activeChannel,
            'failure',
            {
              statusCode: result.statusCode,
              latencyMs: result.latencyMs,
              error: EMPTY_RESPONSE_ZERO_USAGE_ERROR_CODE,
            },
            routeRuntimeConfig
          );
          if (ctx.stopIfClientCancelled()) {
            return;
          }
          ctx.recordRequest({
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
        sawNonRequestFatalFailure = true;

        continue;
      }

      if (!bypassRoutePathState) {
        // 记录实时选路统计
        recordOutcome(activeChannel, accountingOutcome, {
          statusCode: result.statusCode,
          latencyMs: result.latencyMs,
        });
        await ctx.recordPathOutcome(
          activeChannel,
          accountingOutcome,
          {
            statusCode: result.statusCode,
            latencyMs: result.latencyMs,
            ...(nativeStreamTruncated
              ? { error: NATIVE_STREAM_MISSING_TERMINAL_ERROR }
              : upstreamFailureBodySnippet
                ? { error: upstreamFailureBodySnippet }
                : {}),
            ...(confirmedUnavailable ? { confirmedUnavailable } : {}),
          },
          routeRuntimeConfig
        );
        // 成功才绑定/改绑；失败绝不动绑定，避免把会话钉在正在恶化的通道上。
        if (accountingOutcome === 'success' && routeInstanceResolution.instance) {
          routeSessionBindingService.bind({
            instanceId: routeInstanceResolution.instance.id,
            profileId: routeInstanceResolution.instance.profileId || routeProfile?.id || '',
            siteId: activeChannel.siteId,
            accountId: activeChannel.accountId,
            apiKeyId: activeChannel.apiKeyId,
            ...(activeChannel.targetProtocol
              ? { targetProtocol: activeChannel.targetProtocol }
              : {}),
            canonicalModel: canonicalModel || '',
            boundAt: ctx.startedAt,
            lastUsedAt: Date.now(),
          });
        }
        if (ctx.stopIfClientCancelled()) {
          return;
        }

        // 记录分析统计
        ctx.recordRequest({
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
          // 不能改用 accountingOutcome：request_fatal 在日志里要显示为 failure 而非 neutral。
          outcome: nativeStreamTruncated ? 'failure' : outcome,
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

        // 普通路由吸收上游失败：永不把上游状态码交给客户端，由终端分支统一裁决。
        // target-lock / state-affinity 保留既有的原样透传契约。
        if (!bypassRoutePathState) {
          log.warn(`Channel failed (${result.statusCode}); absorbing and trying next channel`);
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
          await ctx.recordPathOutcome(
            activeChannel,
            'failure',
            { error: `adapter_response-adapt:${reason}` },
            routeRuntimeConfig
          );
          if (ctx.stopIfClientCancelled()) {
            return;
          }
        }
        ctx.recordRequest({
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
        sawNonRequestFatalFailure = true;
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
      if (isRouteClientCancelledError(err) || ctx.signal.aborted || ctx.clientCancelled) {
        ctx.clientCancelled = true;
        ctx.recordClientCancellation();
        ctx.finish();
        return;
      }
      const errorMessage = err instanceof Error ? err.message : 'unknown_error';
      retainedFailure = retainUpstreamFailure(
        retainedFailure,
        classifyUpstreamFailure({ error: err })
      );
      sawNonRequestFatalFailure = true;
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
        await ctx.recordPathOutcome(
          activeChannel,
          'failure',
          {
            latencyMs: Date.now() - attemptStartedAt,
            error: errorMessage,
          },
          routeRuntimeConfig
        );
        if (ctx.stopIfClientCancelled()) {
          return;
        }
        ctx.recordRequest({
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
        !ctx.signal.aborted &&
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
      ctx.recordRequest({
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
      writeRouteProxyErrorHead(res, 400, 'no_compatible_route_channel');
      res.end(
        JSON.stringify({
          error: 'no_compatible_route_channel',
          message: 'No route channel can preserve the request across protocols',
          reasons: Array.from(new Set(adapterIncompatibilityReasons)),
        })
      );
    } else if (retainedFailure?.failureClass === 'overflow') {
      writeRouteProxyErrorHead(res, 413, 'context_length_exceeded', {
        ...JSON_RESPONSE_HEADERS,
        'X-Route-Proxy-Failure-Class': 'overflow',
        'X-Route-Proxy-Attempts': String(attempt),
      });
      res.end(
        JSON.stringify(
          sourceProtocol === 'anthropic-messages'
            ? {
                type: 'error',
                error: {
                  type: 'request_too_large',
                  message:
                    'Conversation exceeds the context window; compact the conversation and retry.',
                },
              }
            : {
                error: {
                  type: 'invalid_request_error',
                  code: 'context_length_exceeded',
                  param: 'input',
                  message:
                    'Conversation exceeds the context window; compact the conversation and retry.',
                },
              }
        )
      );
    } else if (quotaExhaustionEncountered) {
      writeUpstreamTemporarilyUnavailableResponse(res, cliType);
    } else if (retainedFailure?.failureClass === 'request_fatal' && !sawNonRequestFatalFailure) {
      // 所有尝试过的候选一致判定请求本身不可用：重试无意义，透传让客户端停止。
      writeRequestFatalPassthroughResponse(res, retainedFailure, attempt);
    } else if (!bypassRoutePathState && areAllRoutePathsDisabled(sortedChannels)) {
      writeAllRoutePathsDisabledResponse(res, cliType, sortedChannels);
    } else if (retainedFailure) {
      // 其余上游失败被吸收为可重试 503，不终止客户端对话。
      writeAbsorbedUpstreamFailureResponse(res, cliType, retainedFailure, attempt);
    } else {
      writeRouteProxyJsonError(
        res,
        502,
        ALL_CHANNELS_FAILED_ERROR_CODE,
        ALL_CHANNELS_FAILED_MESSAGE
      );
    }
  }
  ctx.finish();
}

function enqueueProxyLifecycle(operation: () => Promise<void>): Promise<void> {
  const result = proxyLifecycle.then(operation);
  proxyLifecycle = result.catch(() => {});
  return result;
}

export function startProxyServer(): Promise<void> {
  return enqueueProxyLifecycle(startProxyListener);
}

async function startProxyListener(): Promise<void> {
  if (isRunning) {
    log.warn('Proxy server already running');
    return;
  }

  const routing = unifiedConfigManager.getRoutingConfig();
  const { port, host } = routing.server;

  const server = http.createServer((req, res) => {
    // 运行态闸门：停止后若仍有请求抵达（例如残留连接），一律拒绝而非继续转发上游
    if (
      !isRunning ||
      proxyServer !== server ||
      !unifiedConfigManager.getRoutingConfig().server.enabled
    ) {
      res.writeHead(ROUTE_PROXY_STOPPED_STATUS_CODE, {
        'Content-Type': 'application/json',
        Connection: 'close',
        'X-Route-Proxy-Error': ROUTE_PROXY_STOPPED_ERROR_CODE,
      });
      res.end(
        JSON.stringify({
          error: ROUTE_PROXY_STOPPED_ERROR_CODE,
          message: 'Local route proxy is stopped; no request is forwarded upstream.',
        })
      );
      return;
    }
    const storage = getApplicationStorage();
    const request = () => handleRequest(req, res);
    (storage ? storage.withActivity(request) : request()).catch(err => {
      log.error('Unhandled proxy error:', err);
      if (!res.headersSent) {
        writeRouteProxyJsonError(
          res,
          err.code === 'RESTORE_IN_PROGRESS' ? 503 : 500,
          err.code === 'RESTORE_IN_PROGRESS' ? 'storage_maintenance' : 'internal_error',
          err.message
        );
      }
    });
  });

  server.on('error', error => log.error('Proxy server error:', error));
  proxyServer = server;
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(formatRouteProxyStartError(error, host, port));
      server.once('error', onError);
      server.listen(port, host, () => {
        server.off('error', onError);
        isRunning = true;
        log.info(`Route proxy server started on ${host}:${port}`);
        resolve();
      });
    });
  } catch (error) {
    proxyServer = null;
    isRunning = false;
    server.close();
    throw error;
  }
}

export function stopProxyServer(): Promise<void> {
  return enqueueProxyLifecycle(stopProxyListener);
}

async function stopProxyListener(): Promise<void> {
  if (!proxyServer) return;

  const server = proxyServer;
  // 先落闸再关闭：close() 只是停止接受新连接，CLI 持有的 keep-alive 连接
  // 仍会把后续请求送进来。必须同时切断存量连接，否则「已停止」只是 UI 假象。
  isRunning = false;
  proxyServer = null;

  await new Promise<void>(resolve => {
    server.close(() => {
      log.info('Route proxy server stopped');
      resolve();
    });
    server.closeAllConnections?.();
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
  // 关闭状态必须是稳定的：只有明确传入 true 的交互流程才能启用代理。
  const autoEnable = options?.autoEnable === true;
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
  // 选路在热路径上同步读绑定，必须先把侧车载入内存。
  await routeSessionBindingService.load();
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
