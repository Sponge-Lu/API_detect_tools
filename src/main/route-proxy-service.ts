/**
 * 路由代理服务器
 * 输入: CLI 请求 (HTTP), RoutingConfig, ModelRegistry
 * 输出: 透明转发到上游站点（含 model 重写 + metrics 采集）
 * 定位: 服务层 - 监听本地端口，canonical→raw 模型重写，Electron net raw 上游转发，透传+统计
 */

import * as http from 'http';
import { URL } from 'url';
import Logger from './utils/logger';
import { httpRawRequest } from './utils/http-client';
import { unifiedConfigManager } from './unified-config-manager';
import {
  detectCliTypeFromPath,
  extractModelFromBody,
  extractModelFromPath,
  sortRules,
  findMatchingRule,
} from './route-rule-engine';
import { resolveChannels, resolveChannelCredentials } from './route-channel-resolver';
import type { ResolvedChannel } from './route-channel-resolver';
import {
  sortChannelsByScore,
  recordOutcome,
  isRoutePathDisabled,
  recordRoutePathOutcome,
} from './route-stats-service';
import { startHealthCheckTimer, stopHealthCheckTimer } from './route-health-service';
import { recordRouteRequest } from './route-analytics-service';
import type {
  RouteCliType,
  RouteOutcome,
  RouteRuntimeConfig,
  RoutingConfig,
} from '../shared/types/route-proxy';
import { normalizeRouteRuntimeConfig } from '../shared/types/route-proxy';

const log = Logger.scope('RouteProxyService');

let proxyServer: http.Server | null = null;
let isRunning = false;
let requestSequence = 0;

function nextRequestId(cliType: RouteCliType): string {
  requestSequence += 1;
  return `${cliType}-${Date.now()}-${requestSequence}`;
}

export function classifyRouteStatusCode(statusCode: number): RouteOutcome {
  if (statusCode >= 200 && statusCode < 400) return 'success';
  return 'failure';
}

export function resolveRouteRuntimeConfig(
  routing: Pick<RoutingConfig, 'modelRegistry'> | null | undefined,
  canonicalModel: string | null | undefined
): RouteRuntimeConfig {
  const displayItem = routing?.modelRegistry?.displayItems?.find(
    item => item.canonicalName === canonicalModel
  );

  return normalizeRouteRuntimeConfig(displayItem?.runtimeConfig);
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

function extractUsageFromBody(
  body: Buffer
): { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined {
  try {
    const bodyStr = body.toString('utf-8');
    const parsed = JSON.parse(bodyStr);
    if (parsed?.usage) {
      return {
        promptTokens: parsed.usage.prompt_tokens ?? parsed.usage.input_tokens,
        completionTokens: parsed.usage.completion_tokens ?? parsed.usage.output_tokens,
        totalTokens: parsed.usage.total_tokens,
      };
    }
  } catch {
    // 流式响应，尝试最后一段
    try {
      const bodyStr = body.toString('utf-8');
      const usageMatch = bodyStr.match(/"usage"\s*:\s*\{[^}]+\}/);
      if (usageMatch) {
        const u = JSON.parse(`{${usageMatch[0]}}`).usage;
        return {
          promptTokens: u.prompt_tokens ?? u.input_tokens,
          completionTokens: u.completion_tokens ?? u.output_tokens,
          totalTokens: u.total_tokens,
        };
      }
    } catch {
      /* ignore */
    }
  }

  return undefined;
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
  upstreamProxyUrl?: string
): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  latencyMs: number;
  firstByteLatencyMs?: number;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}> {
  const startTime = Date.now();
  const target = buildUpstreamRequestUrl(targetBaseUrl, req.url, cliType, upstreamModel, apiKey);
  const forwardHeaders = buildUpstreamHeaders(
    req.headers,
    target.host,
    bodyBuffer.length,
    apiKey,
    cliType
  );

  const response = await httpRawRequest(target.url, {
    method: req.method || 'GET',
    headers: compactHeaders(forwardHeaders),
    body: bodyBuffer,
    timeout: timeoutMs,
    proxyUrl: upstreamProxyUrl,
    preferElectronNet: true,
  });

  return {
    statusCode: response.status || 500,
    headers: response.headers,
    body: response.body,
    latencyMs: Date.now() - startTime,
    firstByteLatencyMs: response.firstByteLatencyMs,
    usage: extractUsageFromBody(response.body),
  };
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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
  if (token !== routing.server.unifiedApiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_api_key', message: 'Invalid route API key' }));
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

  // 规则匹配只看 canonical model；若当前请求尚未建立 canonical，则退化为 raw
  const sortedRules = sortRules(routing.rules);
  const matchModel = canonicalModel || rawModel;
  const rule = findMatchingRule(sortedRules, cliType, matchModel);
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
  const routeRuntimeConfig = resolveRouteRuntimeConfig(routing, canonicalModel);
  const sortedChannels = buildChannelAttemptPlan(
    sortChannelsByScore(channels),
    routeRuntimeConfig.maxAttemptsPerRoutePath
  ).filter(channel => !isRoutePathDisabled(channel));
  if (sortedChannels.length === 0) {
    recordRouteRequest({
      requestId,
      attempt: 0,
      cliType,
      requestedModel: rawModel,
      canonicalModel,
      routeRuleId: rule.id,
      outcome: 'failure',
      statusCode: 503,
      error: 'all_route_paths_disabled',
    });
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'all_route_paths_disabled',
        message: 'All route paths for this rule are temporarily disabled',
      })
    );
    return;
  }
  const timeoutMs = routing.server.requestTimeoutMs;

  for (let i = 0; i < sortedChannels.length; i++) {
    const ch = sortedChannels[i] as ResolvedChannel;
    const attempt = i + 1;
    const creds = await resolveChannelCredentials(ch.siteId, ch.accountId, ch.apiKeyId);
    if (!creds) {
      recordRouteRequest({
        requestId,
        attempt,
        cliType,
        requestedModel: rawModel,
        canonicalModel,
        routeRuleId: rule.id,
        siteId: ch.siteId,
        accountId: ch.accountId,
        apiKeyId: ch.apiKeyId,
        resolvedModel: ch.resolvedModel,
        outcome: 'failure',
        error: 'credentials_unavailable',
      });
      await recordRoutePathOutcome(
        ch,
        'failure',
        { error: 'credentials_unavailable' },
        routeRuntimeConfig
      );
      continue;
    }

    // 重写请求体中的 model 字段
    const finalBody = ch.resolvedModel
      ? rewriteRequestModel(bodyBuffer, ch.resolvedModel)
      : bodyBuffer;
    const attemptStartedAt = Date.now();

    try {
      const result = await forwardToUpstream(
        req,
        creds.baseUrl,
        creds.apiKey,
        finalBody,
        cliType,
        timeoutMs,
        ch.resolvedModel,
        routing.server.upstreamProxyUrl
      );
      const outcome = classifyRouteStatusCode(result.statusCode);

      // 记录实时选路统计
      recordOutcome(ch, outcome, { statusCode: result.statusCode, latencyMs: result.latencyMs });
      await recordRoutePathOutcome(
        ch,
        outcome,
        {
          statusCode: result.statusCode,
          latencyMs: result.latencyMs,
        },
        routeRuntimeConfig
      );

      // 记录分析统计
      recordRouteRequest({
        requestId,
        attempt,
        routeRuleId: rule.id,
        cliType,
        requestedModel: rawModel,
        canonicalModel,
        siteId: ch.siteId,
        accountId: ch.accountId,
        apiKeyId: ch.apiKeyId,
        resolvedModel: ch.resolvedModel,
        outcome,
        statusCode: result.statusCode,
        latencyMs: result.latencyMs,
        firstByteLatencyMs: result.firstByteLatencyMs,
        promptTokens: result.usage?.promptTokens,
        completionTokens: result.usage?.completionTokens,
        totalTokens: result.usage?.totalTokens,
      });

      // 失败且还有重试机会：不写 res，尝试下一个通道
      if (outcome === 'failure' && i < sortedChannels.length - 1) {
        log.warn(`Channel failed (${result.statusCode}), trying next channel`);
        continue;
      }

      // 成功/neutral/最后一次失败：写 res
      res.writeHead(result.statusCode, result.headers);
      res.end(result.body);
      return;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'unknown_error';
      recordOutcome(ch, 'failure', {});
      await recordRoutePathOutcome(
        ch,
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
        routeRuleId: rule.id,
        cliType,
        requestedModel: rawModel,
        canonicalModel,
        siteId: ch.siteId,
        accountId: ch.accountId,
        apiKeyId: ch.apiKeyId,
        resolvedModel: ch.resolvedModel,
        outcome: 'failure',
        latencyMs: Date.now() - attemptStartedAt,
        error: errorMessage,
      });
      log.warn(`Channel error: ${errorMessage}, trying next`);
      if (res.headersSent) return;
    }
  }

  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'all_channels_failed', message: 'All upstream channels failed' })
    );
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
    proxyServer!.on('error', reject);
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

export async function initializeRouteProxy(): Promise<void> {
  const routing = unifiedConfigManager.getRoutingConfig();
  if (!routing.server.enabled) {
    log.info('Route proxy server is disabled, skipping start');
    return;
  }
  await startProxyServer();
}
