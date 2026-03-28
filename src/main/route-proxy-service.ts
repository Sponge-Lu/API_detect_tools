/**
 * 路由代理服务器
 * 输入: CLI 请求 (HTTP), RoutingConfig, ModelRegistry
 * 输出: 透明转发到上游站点（含 model 重写 + metrics 采集）
 * 定位: 服务层 - 监听本地端口，canonical→raw 模型重写，透传+统计
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';
import {
  detectCliTypeFromPath,
  extractModelFromBody,
  sortRules,
  findMatchingRule,
} from './route-rule-engine';
import { resolveChannels, resolveChannelCredentials } from './route-channel-resolver';
import type { ResolvedChannel } from './route-channel-resolver';
import { sortChannelsByScore, recordOutcome } from './route-stats-service';
import { startHealthCheckTimer, stopHealthCheckTimer } from './route-health-service';
import { resolveCanonicalName } from './route-model-registry-service';
import { recordRouteRequest } from './route-analytics-service';
import type { RouteCliType } from '../shared/types/route-proxy';

const log = Logger.scope('RouteProxyService');

let proxyServer: http.Server | null = null;
let isRunning = false;

function classifyStatusCode(statusCode: number): 'success' | 'failure' | 'neutral' {
  if (statusCode >= 200 && statusCode < 400) return 'success';
  if ([400, 404, 409, 422].includes(statusCode)) return 'neutral';
  return 'failure';
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

/** 转发请求到上游（不直接写 res，返回结果由调用者决定是否透传） */
function forwardToUpstream(
  req: http.IncomingMessage,
  targetBaseUrl: string,
  apiKey: string,
  bodyBuffer: Buffer,
  cliType: RouteCliType,
  timeoutMs: number
): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  latencyMs: number;
  firstByteLatencyMs?: number;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const target = new URL(targetBaseUrl);
    const isHttps = target.protocol === 'https:';

    const forwardHeaders: Record<string, string | string[] | undefined> = {
      ...req.headers,
      host: target.host,
      'content-length': String(bodyBuffer.length),
    };

    if (cliType === 'claudeCode') {
      forwardHeaders['x-api-key'] = apiKey;
      forwardHeaders['authorization'] = `Bearer ${apiKey}`;
    } else if (cliType === 'codex') {
      forwardHeaders['authorization'] = `Bearer ${apiKey}`;
    } else if (cliType === 'geminiCli') {
      delete forwardHeaders['authorization'];
    }

    let targetPath = req.url || '/';
    if (cliType === 'geminiCli') {
      const sep = targetPath.includes('?') ? '&' : '?';
      targetPath = `${targetPath}${sep}key=${apiKey}`;
    }

    const options: http.RequestOptions = {
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: targetPath,
      method: req.method,
      headers: forwardHeaders,
      timeout: timeoutMs,
    };

    let firstByteLatencyMs: number | undefined;
    const chunks: Buffer[] = [];

    const transport = isHttps ? https : http;
    const proxyReq = transport.request(options, proxyRes => {
      const statusCode = proxyRes.statusCode || 500;

      proxyRes.on('data', (chunk: Buffer) => {
        if (firstByteLatencyMs === undefined) {
          firstByteLatencyMs = Date.now() - startTime;
        }
        chunks.push(chunk);
      });

      proxyRes.on('end', () => {
        const latencyMs = Date.now() - startTime;
        const body = Buffer.concat(chunks);

        // 尝试提取 usage
        let usage:
          | { promptTokens?: number; completionTokens?: number; totalTokens?: number }
          | undefined;
        try {
          const bodyStr = body.toString('utf-8');
          const parsed = JSON.parse(bodyStr);
          if (parsed?.usage) {
            usage = {
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
              usage = {
                promptTokens: u.prompt_tokens ?? u.input_tokens,
                completionTokens: u.completion_tokens ?? u.output_tokens,
                totalTokens: u.total_tokens,
              };
            }
          } catch {
            /* ignore */
          }
        }

        resolve({
          statusCode,
          headers: proxyRes.headers,
          body,
          latencyMs,
          firstByteLatencyMs,
          usage,
        });
      });

      proxyRes.on('error', reject);
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('upstream timeout'));
    });
    proxyReq.on('error', reject);

    proxyReq.write(bodyBuffer);
    proxyReq.end();
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const routing = unifiedConfigManager.getRoutingConfig();

  // 鉴权
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (token !== routing.server.unifiedApiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_api_key', message: 'Invalid route API key' }));
    return;
  }

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

  // 读取请求体
  const bodyBuffer = await readBody(req);
  let bodyJson: unknown = null;
  try {
    bodyJson = JSON.parse(bodyBuffer.toString('utf-8'));
  } catch {
    /* ignore */
  }
  const rawModel = extractModelFromBody(bodyJson);

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

  // 规则匹配（用 canonical 或 raw model 匹配）
  const sortedRules = sortRules(routing.rules);
  const matchModel = canonicalModel || rawModel;
  const rule = findMatchingRule(sortedRules, cliType, matchModel);
  if (!rule) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'no_matching_rule',
        message: `No routing rule matched for ${cliType} / ${matchModel}`,
      })
    );
    return;
  }

  // 解析候选通道（带 canonical model 过滤）
  const channels = resolveChannels(rule, canonicalModel);
  if (channels.length === 0) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'no_channels', message: 'No available channels for this rule' })
    );
    return;
  }
  const sortedChannels = sortChannelsByScore(channels);

  const maxRetries = routing.server.retryCount + 1;
  const timeoutMs = routing.server.requestTimeoutMs;

  for (let i = 0; i < Math.min(maxRetries, sortedChannels.length); i++) {
    const ch = sortedChannels[i] as ResolvedChannel;
    const creds = await resolveChannelCredentials(ch.siteId, ch.accountId, ch.apiKeyId);
    if (!creds) continue;

    // 重写请求体中的 model 字段
    const finalBody = ch.resolvedModel
      ? rewriteRequestModel(bodyBuffer, ch.resolvedModel)
      : bodyBuffer;

    try {
      const result = await forwardToUpstream(
        req,
        creds.baseUrl,
        creds.apiKey,
        finalBody,
        cliType,
        timeoutMs
      );
      const outcome = classifyStatusCode(result.statusCode);

      // 记录实时选路统计
      recordOutcome(ch, outcome, { statusCode: result.statusCode, latencyMs: result.latencyMs });

      // 记录分析统计
      recordRouteRequest({
        routeRuleId: rule.id,
        cliType,
        canonicalModel,
        siteId: ch.siteId,
        accountId: ch.accountId,
        outcome,
        statusCode: result.statusCode,
        latencyMs: result.latencyMs,
        firstByteLatencyMs: result.firstByteLatencyMs,
        promptTokens: result.usage?.promptTokens,
        completionTokens: result.usage?.completionTokens,
        totalTokens: result.usage?.totalTokens,
      });

      // 失败且还有重试机会：不写 res，尝试下一个通道
      if (outcome === 'failure' && i < Math.min(maxRetries, sortedChannels.length) - 1) {
        log.warn(`Channel failed (${result.statusCode}), trying next channel`);
        continue;
      }

      // 成功/neutral/最后一次失败：写 res
      res.writeHead(result.statusCode, result.headers);
      res.end(result.body);
      return;
    } catch (err: any) {
      recordOutcome(ch, 'failure', {});
      log.warn(`Channel error: ${err.message}, trying next`);
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
