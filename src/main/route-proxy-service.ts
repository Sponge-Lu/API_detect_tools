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
  RoutingConfig,
} from '../shared/types/route-proxy';
import {
  buildRouteApiKeyPriorityKey,
  buildRoutePathStateKey,
  normalizeRouteRuntimeConfig,
  ROUTE_SUCCESSFUL_PATH_AFFINITY_MS,
} from '../shared/types/route-proxy';
import { isAnyRouterSite } from '../shared/types/site';
import { isCliTargetProtocolNativeEquivalent } from '../shared/types/cli-config';
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
const GEMINI_CLI_INTERNAL_UTILITY_MODELS = new Set([
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
]);
const GEMINI_CLI_INTERNAL_UTILITY_BLOCKED_ERROR_CODE = 'gemini_cli_internal_utility_blocked';
const GEMINI_CLI_INTERNAL_UTILITY_BLOCKED_STATUS_CODE = 400;
const ALL_ROUTE_PATHS_DISABLED_ERROR_CODE = 'all_route_paths_disabled';
const ALL_ROUTE_PATHS_DISABLED_STATUS_CODE = 400;
const ALL_ROUTE_PATHS_DISABLED_MESSAGE =
  'all_route_paths_disabled: All route paths for this rule are temporarily disabled. Restore route paths in the route rule UI or wait for the suspension to expire.';
const PROBE_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_ERROR_CODE = 'probe_lock_upstream_attempt_exhausted';
const PROBE_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_STATUS_CODE = 400;
const ANYROUTER_REQUEST_TIMEOUT_MS = 120 * 1000;
const ACTIVE_STREAM_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const CLAUDE_COUNT_TOKENS_PATH = '/v1/messages/count_tokens';
const CLAUDE_MESSAGES_COUNT_TOKENS_ENDPOINT = 'claude_messages_count_tokens';
const LOCAL_COUNT_TOKENS_IMAGE_ESTIMATE = 2000;
const LOCAL_COUNT_TOKENS_DOCUMENT_ESTIMATE = 2000;
const LOCAL_COUNT_TOKENS_MESSAGE_OVERHEAD = 4;
const LOCAL_COUNT_TOKENS_CONSERVATIVE_MULTIPLIER = 1.15;
const INITIAL_STREAM_VALIDATION_MAX_BYTES = 4096;
const STREAM_TERMINAL_SCAN_MAX_CHARS = 8192;

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

function extractGeminiRouteToken(req: http.IncomingMessage): string {
  const apiKeyHeader = normalizeHeaderValue(req.headers['x-goog-api-key']);
  if (apiKeyHeader.trim()) {
    return apiKeyHeader.trim();
  }

  const url = req.url || '/';
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);
  const queryKey = params.get('key')?.trim();
  if (queryKey) {
    return queryKey;
  }

  return extractBearerToken(req);
}

function extractClaudeRouteToken(req: http.IncomingMessage): string {
  const apiKeyHeader = normalizeHeaderValue(req.headers['x-api-key']);
  if (apiKeyHeader.trim()) {
    return apiKeyHeader.trim();
  }

  return extractBearerToken(req);
}

export function extractRouteApiKey(
  req: Pick<http.IncomingMessage, 'headers' | 'url'>,
  cliType: RouteCliType
): string {
  if (cliType === 'geminiCli') {
    return extractGeminiRouteToken(req as http.IncomingMessage);
  }

  if (cliType === 'claudeCode') {
    return extractClaudeRouteToken(req as http.IncomingMessage);
  }

  return extractBearerToken(req as http.IncomingMessage);
}

export function buildChannelAttemptPlan<
  T extends {
    routeRuleId?: string;
    siteId?: string;
    accountId?: string;
    apiKeyId?: string;
    resolvedModel?: string;
    canonicalModel?: string;
  },
>(channels: T[], maxAttemptsPerRoutePath: number = 1): T[] {
  const normalizedMaxAttempts = Math.max(1, Math.floor(maxAttemptsPerRoutePath || 1));
  const attemptsByRoutePath = new Map<string, number>();

  return channels.filter(channel => {
    const pathKey = [
      channel.routeRuleId || '__rule__',
      channel.siteId || '__site__',
      channel.accountId || '__account__',
      channel.apiKeyId || '__api_key__',
      channel.canonicalModel?.trim() || '__empty_canonical_model__',
      channel.resolvedModel?.trim() || '__empty_resolved_model__',
    ].join('|');
    const attempts = attemptsByRoutePath.get(pathKey) ?? 0;
    if (attempts >= normalizedMaxAttempts) {
      return false;
    }

    attemptsByRoutePath.set(pathKey, attempts + 1);
    return true;
  });
}

type RoutePathAffinityCandidate = RouteChannelKey & {
  canonicalModel?: string;
  resolvedModel?: string;
  targetProtocol?: RoutePathState['targetProtocol'];
};

export function applySuccessfulRoutePathAffinity<T extends RoutePathAffinityCandidate>(
  channels: T[],
  routePathStates: Record<string, RoutePathState> | null | undefined,
  now: number = Date.now()
): T[] {
  if (channels.length <= 1 || !routePathStates) {
    return channels;
  }

  const affinityCutoff = now - ROUTE_SUCCESSFUL_PATH_AFFINITY_MS;
  let preferredIndex = -1;
  let preferredLastSuccessAt = 0;

  channels.forEach((channel, index) => {
    const state = routePathStates[buildRoutePathStateKey(channel)];
    const lastSuccessAt = state?.lastSuccessAt ?? 0;
    if (
      state?.lastOutcome !== 'success' ||
      lastSuccessAt <= affinityCutoff ||
      (state.affinitySuppressedUntil ?? 0) > now ||
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
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
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

export function buildGeminiUpstreamPath(
  requestUrl: string,
  upstreamModel: string | undefined,
  apiKey: string
): string {
  const parsed = new URL(requestUrl || '/', 'http://route-proxy.local');
  parsed.searchParams.set('key', apiKey);

  if (upstreamModel) {
    parsed.pathname = parsed.pathname.replace(
      /^\/v1beta\/models\/([^/:?]+)(:[^/?]+)?$/,
      (_match, _currentModel, action = '') =>
        `/v1beta/models/${encodeURIComponent(upstreamModel)}${action}`
    );
  }

  return `${parsed.pathname}${parsed.search}`;
}

function deleteAuthHeaders(headers: Record<string, string | string[] | undefined>): void {
  for (const key of Object.keys(headers)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === 'authorization' ||
      normalizedKey === 'x-api-key' ||
      normalizedKey === 'x-goog-api-key'
    ) {
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
  const record = asRecord(bodyJson);
  if (record?.stream === true) return true;

  const pathname = (requestUrl || '/').split('?')[0];
  return pathname.includes(':streamGenerateContent');
}

function isClaudeCountTokensRequest(pathname: string, cliType: RouteCliType): boolean {
  return cliType === 'claudeCode' && pathname === CLAUDE_COUNT_TOKENS_PATH;
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
  protocolAdapter: CliProtocolResponseAdapter
): boolean {
  return anyRouterAdapter.type === 'transparent' && protocolAdapter.type === 'transparent';
}

function buildStreamingResponseHeaders(
  headers: http.IncomingHttpHeaders
): http.OutgoingHttpHeaders {
  const outgoing: http.OutgoingHttpHeaders = {};
  const blocked = new Set([
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

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || blocked.has(key.toLowerCase())) continue;
    outgoing[key] = value;
  }

  return outgoing;
}

type InitialEventStreamValidation =
  | { status: 'accepted' }
  | { status: 'pending' }
  | { status: 'rejected'; reason: string };

type StreamingTerminalProtocol = 'anthropic' | 'openaiResponses' | 'none';
type CompletedStreamValidation = { ok: true } | { ok: false; reason: string; message: string };

interface ParsedSseBlock {
  event?: string;
  data: string;
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

function getStreamingTerminalProtocol(cliType: RouteCliType): StreamingTerminalProtocol {
  if (cliType === 'claudeCode') return 'anthropic';
  if (cliType === 'codex') return 'openaiResponses';
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

  return (
    /data:\s*\[DONE\]/.test(text) ||
    /event:\s*response\.completed/.test(text) ||
    /"type"\s*:\s*"response\.completed"/.test(text)
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

function buildStreamingErrorChunk(cliType: RouteCliType, message: string): Buffer {
  const payload =
    cliType === 'claudeCode'
      ? { type: 'error', error: { type: 'api_error', message } }
      : { type: 'error', error: { type: 'server_error', message } };

  return Buffer.from(`event: error\ndata: ${JSON.stringify(payload)}\n\n`, 'utf-8');
}

function buildIncompleteStreamingErrorChunk(cliType: RouteCliType): Buffer {
  return buildStreamingErrorChunk(cliType, 'upstream stream ended before terminal SSE event');
}

function buildMalformedStreamingErrorChunk(cliType: RouteCliType, message: string): Buffer {
  return buildStreamingErrorChunk(cliType, message);
}

function parseSseBlocks(text: string): ParsedSseBlock[] {
  const normalized = text.replace(/\r\n/g, '\n');
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

function parseSseJsonRecord(data: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(data));
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNumericIndex(value: unknown): number | undefined {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

function buildCompletedStreamFailure(reason: string, message: string): CompletedStreamValidation {
  return { ok: false, reason, message };
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

export function isTransientUpstreamStatus(statusCode?: number): boolean {
  return typeof statusCode === 'number' && TRANSIENT_UPSTREAM_STATUS_CODES.has(statusCode);
}

export function buildUpstreamHeaders(
  incomingHeaders: http.IncomingHttpHeaders,
  targetHost: string,
  bodyLength: number,
  apiKey: string,
  cliType: RouteCliType
): Record<string, string | string[] | undefined> {
  const forwardHeaders: Record<string, string | string[] | undefined> = {
    ...incomingHeaders,
    host: targetHost,
    'content-length': String(bodyLength),
  };

  deleteAuthHeaders(forwardHeaders);

  if (cliType === 'claudeCode') {
    forwardHeaders['x-api-key'] = apiKey;
  } else if (cliType === 'codex') {
    forwardHeaders.authorization = `Bearer ${apiKey}`;
  } else if (cliType === 'geminiCli') {
    forwardHeaders['x-goog-api-key'] = apiKey;
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
  const targetPath =
    cliType === 'geminiCli'
      ? buildGeminiUpstreamPath(requestUrl || '/', upstreamModel, apiKey)
      : requestUrl || '/';
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
  total += estimateJsonTokens(request.thinking);
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
    total += estimateJsonTokens(record.name);
    total += estimateJsonTokens(record.description);
    total += estimateJsonTokens(record.input_schema);
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

function isUnsupportedClaudeCountTokensResponse(result: {
  statusCode: number;
  body: Buffer;
}): boolean {
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

function writeAnthropicCountTokensEstimate(
  res: http.ServerResponse,
  estimate: ClaudeCountTokensEstimate
): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ input_tokens: estimate.input_tokens }));
}

interface ForwardToUpstreamOptions {
  upstreamProxyUrl?: string;
  additionalHeaders?: Record<string, string>;
  methodOverride?: string;
  requestUrlOverride?: string;
  upstreamCliType?: RouteCliType;
  streamResponse?: http.ServerResponse;
  streamResponseBody?: boolean;
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
}> {
  const startTime = Date.now();
  const upstreamCliType = options.upstreamCliType ?? cliType;
  const target = buildUpstreamRequestUrl(
    targetBaseUrl,
    options.requestUrlOverride ?? req.url,
    upstreamCliType,
    upstreamModel,
    apiKey
  );
  const forwardHeaders = buildUpstreamHeaders(
    req.headers,
    target.host,
    bodyBuffer.length,
    apiKey,
    upstreamCliType
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
  };

  let streamed = false;
  let streamingStatusCode: number | undefined;
  let streamingHeaders: http.OutgoingHttpHeaders | undefined;
  let streamingRejectedBeforeBody: string | undefined;
  let initialStreamingBuffer = Buffer.alloc(0);
  let pendingStreamingChunks: Buffer[] = [];
  const receivedStreamingChunks: Buffer[] = [];
  const streamingTerminalProtocol = getStreamingTerminalProtocol(cliType);
  let streamingTerminalScanText = '';
  let streamingTerminalSeen = streamingTerminalProtocol === 'none';
  const response =
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
            receivedStreamingChunks.push(chunk);

            if (streamingTerminalProtocol === 'anthropic' && !streamingTerminalSeen) {
              const terminalScan = appendStreamingTerminalScanText(
                streamingTerminalProtocol,
                streamingTerminalScanText,
                chunk
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
                      await writeResponseChunk(
                        options.streamResponse!,
                        buildMalformedStreamingErrorChunk(cliType, completedValidation.message)
                      );
                    }
                    throw new Error(`malformed_streaming_response:${completedValidation.reason}`);
                  }
                }
              }
            } else if (!streamingTerminalSeen) {
              const terminalScan = appendStreamingTerminalScanText(
                streamingTerminalProtocol,
                streamingTerminalScanText,
                chunk
              );
              streamingTerminalScanText = terminalScan.text;
              streamingTerminalSeen = terminalScan.terminalSeen;
            }

            if (!streamed) {
              pendingStreamingChunks.push(chunk);
              initialStreamingBuffer = Buffer.concat([
                initialStreamingBuffer,
                chunk.subarray(
                  0,
                  Math.max(
                    0,
                    INITIAL_STREAM_VALIDATION_MAX_BYTES + 1 - initialStreamingBuffer.length
                  )
                ),
              ]);
              const validation = validateInitialEventStreamChunk(initialStreamingBuffer);
              if (validation.status === 'rejected') {
                throw new Error(`invalid_streaming_response:${validation.reason}`);
              }
              if (validation.status === 'pending') {
                return;
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
            return writeResponseChunk(options.streamResponse!, chunk);
          },
          streamIdleTimeout: options.streamIdleTimeoutMs,
        })
      : await httpRawRequest(target.url, requestConfig);

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

  if (options.streamResponse && options.streamResponseBody && streamed && !streamingTerminalSeen) {
    await writeResponseChunk(options.streamResponse, buildIncompleteStreamingErrorChunk(cliType));
    throw new Error('incomplete_streaming_response:missing_terminal_event');
  }

  if (options.streamResponse && options.streamResponseBody && streamed) {
    const completedValidation = validateCompletedStreamingBody(
      streamingTerminalProtocol,
      response.body
    );
    if (!completedValidation.ok) {
      await writeResponseChunk(
        options.streamResponse,
        buildMalformedStreamingErrorChunk(cliType, completedValidation.message)
      );
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

  if (cliType === 'geminiCli') {
    return {
      error: {
        code: ALL_ROUTE_PATHS_DISABLED_STATUS_CODE,
        message: ALL_ROUTE_PATHS_DISABLED_MESSAGE,
        status: 'FAILED_PRECONDITION',
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

function shouldBlockGeminiCliInternalUtilityRequest(params: {
  routing: RoutingConfig;
  cliType: RouteCliType;
  rawModel: string | null;
  cliSelectedModel: string | null;
}): boolean {
  if (params.routing.server.blockGeminiCliInternalUtilityRequests === false) return false;
  if (params.cliType !== 'geminiCli') return false;
  if (!params.rawModel || !params.cliSelectedModel) return false;
  if (params.rawModel === params.cliSelectedModel) return false;

  return GEMINI_CLI_INTERNAL_UTILITY_MODELS.has(params.rawModel);
}

function buildGeminiCliInternalUtilityBlockedBody(rawModel: string | null): unknown {
  return {
    error: {
      code: GEMINI_CLI_INTERNAL_UTILITY_BLOCKED_STATUS_CODE,
      status: 'FAILED_PRECONDITION',
      message: `${GEMINI_CLI_INTERNAL_UTILITY_BLOCKED_ERROR_CODE}: blocked Gemini CLI internal utility model request${
        rawModel ? ` for ${rawModel}` : ''
      }. Add an explicit routing rule for this model or disable the route proxy guard to allow it.`,
    },
  };
}

function writeGeminiCliInternalUtilityBlockedResponse(
  res: http.ServerResponse,
  rawModel: string | null
): void {
  res.writeHead(GEMINI_CLI_INTERNAL_UTILITY_BLOCKED_STATUS_CODE, {
    'Content-Type': 'application/json',
    'X-Route-Proxy-Error': GEMINI_CLI_INTERNAL_UTILITY_BLOCKED_ERROR_CODE,
  });
  res.end(JSON.stringify(buildGeminiCliInternalUtilityBlockedBody(rawModel)));
}

export async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const routing = unifiedConfigManager.getRoutingConfig();

  // 识别 CLI 类型
  const pathname = (req.url || '/').split('?')[0];
  const cliType = detectCliTypeFromPath(pathname);
  if (!cliType) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'unsupported_route', message: `No route handler for ${pathname}` })
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
  const bodyBuffer = await readBody(req);
  let bodyJson: unknown = null;
  try {
    bodyJson = JSON.parse(bodyBuffer.toString('utf-8'));
  } catch {
    /* ignore */
  }
  const rawModel = extractModelFromBody(bodyJson) || extractModelFromPath(pathname, cliType);
  if (
    probeLock &&
    shouldBlockGeminiCliInternalUtilityRequest({
      routing,
      cliType,
      rawModel,
      cliSelectedModel: probeLock.rawModel,
    })
  ) {
    log.warn('Probe-lock Gemini internal utility request blocked before upstream forwarding', {
      cliType,
      siteId: probeLock.siteId,
      accountId: probeLock.accountId,
      apiKeyId: probeLock.apiKeyId,
      rawModel,
      lockedModel: probeLock.rawModel,
    });
    writeGeminiCliInternalUtilityBlockedResponse(res, rawModel);
    return;
  }

  // 解析 canonical model（代理层无 site 上下文，使用全局 alias 索引）
  let canonicalModel: string | null = null;
  if (rawModel) {
    // 在 registry 中查找任意来源包含此 rawModel 的 entry
    const registry = unifiedConfigManager.getRoutingConfig().modelRegistry;
    for (const entry of Object.values(registry.entries)) {
      if (entry.aliases.includes(rawModel) || entry.canonicalName === rawModel) {
        canonicalModel = entry.canonicalName;
        break;
      }
    }
    // 若 registry 无匹配，则 canonical = raw（透传原样）
    if (!canonicalModel) canonicalModel = rawModel;
  }
  // fallback: CLI 默认模型选择
  if (!canonicalModel) {
    canonicalModel = routing.cliModelSelections[cliType] || null;
  }

  let activeRouteRuleId: string | undefined;
  let sortedChannels: ResolvedChannel[] = [];
  let routeRuntimeConfig = resolveRouteRuntimeConfig(routing, canonicalModel);
  const bypassRoutePathState = Boolean(probeLock);

  if (probeLock) {
    canonicalModel = probeLock.canonicalModel;
    routeRuntimeConfig = resolveRouteRuntimeConfig(routing, canonicalModel);
    sortedChannels = [
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
    ];
  } else {
    // 规则匹配只看 canonical model；若当前请求尚未建立 canonical，则退化为 raw
    const sortedRules = sortRules(routing.rules);
    let matchModel = canonicalModel || rawModel;
    let rule = findMatchingRule(sortedRules, cliType, matchModel);
    const cliSelectedModel = routing.cliModelSelections[cliType]?.trim() || null;

    if (
      !rule &&
      shouldBlockGeminiCliInternalUtilityRequest({
        routing,
        cliType,
        rawModel,
        cliSelectedModel,
      })
    ) {
      recordRouteRequest({
        requestId,
        attempt: 0,
        cliType,
        requestedModel: rawModel,
        canonicalModel,
        outcome: 'failure',
        statusCode: GEMINI_CLI_INTERNAL_UTILITY_BLOCKED_STATUS_CODE,
        error: GEMINI_CLI_INTERNAL_UTILITY_BLOCKED_ERROR_CODE,
      });
      writeGeminiCliInternalUtilityBlockedResponse(res, rawModel);
      return;
    }

    // Gemini CLI can emit helper/default path models that differ from the app-selected model.
    if (
      !rule &&
      cliType === 'geminiCli' &&
      rawModel &&
      cliSelectedModel &&
      cliSelectedModel !== matchModel
    ) {
      const selectedModelRule = findMatchingRule(sortedRules, cliType, cliSelectedModel);
      if (selectedModelRule) {
        canonicalModel = cliSelectedModel;
        matchModel = cliSelectedModel;
        rule = selectedModelRule;
      }
    }

    if (!rule) {
      recordRouteRequest({
        requestId,
        attempt: 0,
        cliType,
        requestedModel: rawModel,
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
      recordRouteRequest({
        requestId,
        attempt: 0,
        cliType,
        requestedModel: rawModel,
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
    sortedChannels = applySuccessfulRoutePathAffinity(
      buildChannelAttemptPlan(
        sortChannelsByScore(enabledChannels),
        routeRuntimeConfig.maxAttemptsPerRoutePath
      ).filter(channel => !isRoutePathDisabled(channel)) as ResolvedChannel[],
      routing.routePathStates
    );
    if (sortedChannels.length === 0) {
      recordRouteRequest({
        requestId,
        attempt: 0,
        cliType,
        requestedModel: rawModel,
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
  const requestIsClaudeCountTokens = isClaudeCountTokensRequest(pathname, cliType);
  if (probeLock && requestIsClaudeCountTokens) {
    writeAnthropicCountTokensEstimate(res, estimateClaudeCountTokens(bodyBuffer));
    return;
  }

  let attempt = 0;
  for (let i = 0; i < sortedChannels.length; i++) {
    const ch = sortedChannels[i] as ResolvedChannel;
    if (!bypassRoutePathState && isRoutePathDisabled(ch)) {
      continue;
    }

    attempt += 1;
    const resolvedTarget = await resolveChannelTarget(ch);
    const activeChannel: ResolvedChannel = {
      ...ch,
      targetProtocol: resolvedTarget.targetProtocol,
      targetEndpoint: resolvedTarget.targetEndpoint,
    };
    const site = unifiedConfigManager.getSiteById(activeChannel.siteId);
    const account = unifiedConfigManager.getAccountById(activeChannel.accountId);

    if (requestIsClaudeCountTokens && !bypassRoutePathState) {
      const endpointUnsupported = isRouteEndpointUnsupported(
        activeChannel,
        CLAUDE_MESSAGES_COUNT_TOKENS_ENDPOINT
      );
      const targetProtocolUnsupported = !isCliTargetProtocolNativeEquivalent(
        cliType,
        activeChannel.targetProtocol ?? 'native'
      );

      if (endpointUnsupported || targetProtocolUnsupported) {
        const reason = endpointUnsupported ? 'cached_unsupported' : 'target_protocol_unsupported';
        if (!endpointUnsupported) {
          await recordRouteEndpointUnsupported(
            activeChannel,
            CLAUDE_MESSAGES_COUNT_TOKENS_ENDPOINT,
            { reason }
          );
        }
        recordRouteRequest({
          requestId,
          attempt,
          routeRuleId: activeRouteRuleId,
          cliType,
          targetProtocol: activeChannel.targetProtocol,
          targetEndpoint: activeChannel.targetEndpoint,
          requestedModel: rawModel,
          canonicalModel,
          siteId: activeChannel.siteId,
          accountId: activeChannel.accountId,
          apiKeyId: activeChannel.apiKeyId,
          resolvedModel: activeChannel.resolvedModel,
          outcome: 'neutral',
          statusCode: 200,
          error: `count_tokens_local_estimate:${reason}`,
        });
        writeAnthropicCountTokensEstimate(res, estimateClaudeCountTokens(bodyBuffer));
        return;
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
      recordRouteRequest({
        requestId,
        attempt,
        cliType,
        targetProtocol: activeChannel.targetProtocol,
        targetEndpoint: activeChannel.targetEndpoint,
        requestedModel: rawModel,
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
        await recordRoutePathOutcome(
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

    // 站点级特殊处理：AnyRouter 仅在原生协议透传时保留，其余显式 targetProtocol 走通用适配
    let additionalHeaders: Record<string, string> = {};
    let methodOverride: string | undefined;
    let requestUrlOverride: string | undefined;
    let upstreamCliType: RouteCliType = cliType;
    let responseAdapter: AnyRouterResponseAdapter = { type: 'transparent' };
    let protocolResponseAdapter: CliProtocolResponseAdapter = { type: 'transparent' };
    if (
      !requestIsClaudeCountTokens &&
      site &&
      account &&
      isAnyRouterSite(site.name) &&
      isCliTargetProtocolNativeEquivalent(cliType, activeChannel.targetProtocol ?? 'native')
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
    } else if (
      !isCliTargetProtocolNativeEquivalent(cliType, activeChannel.targetProtocol ?? 'native')
    ) {
      try {
        const rewritten = adaptRequestToTargetProtocol(
          finalBody,
          cliType,
          activeChannel.targetProtocol as Exclude<
            typeof activeChannel.targetProtocol,
            'native' | undefined
          >,
          req.url,
          activeChannel.resolvedModel
        );

        finalBody = rewritten.body;
        additionalHeaders = rewritten.headers;
        methodOverride = rewritten.upstreamMethod;
        requestUrlOverride = rewritten.upstreamPath;
        upstreamCliType = rewritten.upstreamCliType;
        protocolResponseAdapter = rewritten.responseAdapter;
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
        recordRouteRequest({
          requestId,
          attempt,
          routeRuleId: activeRouteRuleId,
          cliType,
          targetProtocol: activeChannel.targetProtocol,
          targetEndpoint: activeChannel.targetEndpoint,
          requestedModel: rawModel,
          canonicalModel,
          siteId: activeChannel.siteId,
          accountId: activeChannel.accountId,
          apiKeyId: activeChannel.apiKeyId,
          resolvedModel: activeChannel.resolvedModel,
          outcome: 'failure',
          error: `adapter_${stage}:${reason}`,
        });
        if (!bypassRoutePathState) {
          recordOutcome(activeChannel, 'failure', {});
          await recordRoutePathOutcome(
            activeChannel,
            'failure',
            { error: `adapter_${stage}:${reason}` },
            routeRuntimeConfig
          );
        }
        continue;
      }
    }

    const attemptStartedAt = Date.now();
    const streamResponseBody =
      requestWantsStreaming && canStreamResponseAdapters(responseAdapter, protocolResponseAdapter);

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

      const result = await forwardToUpstream(
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
          streamResponse: res,
          streamResponseBody,
          streamIdleTimeoutMs: upstreamTimeouts.streamIdleTimeoutMs,
        }
      );
      const outcome = classifyRouteStatusCode(result.statusCode);
      const upstreamFailureBodySnippet =
        outcome === 'failure' ? summarizeUpstreamFailureBodyForLog(result.body) : '';

      if (
        requestIsClaudeCountTokens &&
        !bypassRoutePathState &&
        isUnsupportedClaudeCountTokensResponse(result)
      ) {
        const bodySnippet = summarizeUpstreamFailureBodyForLog(result.body) || '<empty>';
        await recordRouteEndpointUnsupported(activeChannel, CLAUDE_MESSAGES_COUNT_TOKENS_ENDPOINT, {
          statusCode: result.statusCode,
          error: bodySnippet,
          reason: 'upstream_unsupported',
        });
        recordRouteRequest({
          requestId,
          attempt,
          routeRuleId: activeRouteRuleId,
          cliType,
          targetProtocol: activeChannel.targetProtocol,
          targetEndpoint: activeChannel.targetEndpoint,
          requestedModel: rawModel,
          canonicalModel,
          siteId: activeChannel.siteId,
          accountId: activeChannel.accountId,
          apiKeyId: activeChannel.apiKeyId,
          resolvedModel: activeChannel.resolvedModel,
          outcome: 'neutral',
          statusCode: 200,
          latencyMs: result.latencyMs,
          firstByteLatencyMs: result.firstByteLatencyMs,
          error: `count_tokens_local_estimate:upstream_${result.statusCode}`,
        });
        writeAnthropicCountTokensEstimate(res, estimateClaudeCountTokens(bodyBuffer));
        return;
      }

      if (!bypassRoutePathState) {
        // 记录实时选路统计
        recordOutcome(activeChannel, outcome, {
          statusCode: result.statusCode,
          latencyMs: result.latencyMs,
        });
        await recordRoutePathOutcome(
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
        recordRouteRequest({
          requestId,
          attempt,
          routeRuleId: activeRouteRuleId,
          cliType,
          targetProtocol: activeChannel.targetProtocol,
          targetEndpoint: activeChannel.targetEndpoint,
          requestedModel: rawModel,
          canonicalModel,
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
          ...(upstreamFailureBodySnippet ? { error: upstreamFailureBodySnippet } : {}),
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
              res.writeHead(result.statusCode, buildStreamingResponseHeaders(result.headers));
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

        if (hasEnabledRoutePath(sortedChannels.slice(i + 1)) && !bypassRoutePathState) {
          log.warn(`Channel failed (${result.statusCode}), trying next channel`);
          continue;
        }

        if (!bypassRoutePathState && areAllRoutePathsDisabled(sortedChannels)) {
          writeAllRoutePathsDisabledResponse(res, cliType);
          return;
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
      let transformed: { body: Buffer; headers: http.IncomingHttpHeaders };
      try {
        transformed = transformTargetProtocolResponse({
          body: anyRouterTransformed.body,
          headers: anyRouterTransformed.headers,
          statusCode: result.statusCode,
          adapter: protocolResponseAdapter,
        });
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
          await recordRoutePathOutcome(
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
      res.writeHead(result.statusCode, transformed.headers);
      res.end(transformed.body);
      return;
    } catch (err: unknown) {
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
        await recordRoutePathOutcome(
          activeChannel,
          'failure',
          {
            latencyMs: Date.now() - attemptStartedAt,
            error: errorMessage,
          },
          routeRuntimeConfig
        );
        recordRouteRequest({
          requestId,
          attempt,
          routeRuleId: activeRouteRuleId,
          cliType,
          targetProtocol: activeChannel.targetProtocol,
          targetEndpoint: activeChannel.targetEndpoint,
          requestedModel: rawModel,
          canonicalModel,
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
    }
  }

  if (!res.headersSent) {
    if (!bypassRoutePathState && areAllRoutePathsDisabled(sortedChannels)) {
      writeAllRoutePathsDisabledResponse(res, cliType);
    } else {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'all_channels_failed', message: 'All upstream channels failed' })
      );
    }
  }
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
