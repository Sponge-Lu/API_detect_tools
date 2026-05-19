/**
 * AnyRouter 请求改写器
 * 输入: 原始请求体、user hash、原始请求头
 * 输出: 改写后的请求体、补充的请求头、URL 后缀
 * 定位: 服务层 - 为 AnyRouter 站点按 CLI 协议处理请求
 *
 * 改写内容:
 * 1. 清理 [undefined] 字段
 * 2. Claude Code: 保留原始请求字段和工具语义，生成 metadata.user_id，缺省补齐
 *    system/thinking/output_config，并添加 1m context beta 支持
 * 3. Codex: 保持 Responses API 原生协议透传，并过滤 AnyRouter 不支持的工具类型
 * 4. Gemini CLI: 保持 Gemini Native 原生协议透传
 *
 * 参考: D:\2_Github_Repository\any转cherry\anyrouter_proxy.py
 */

import { randomUUID } from 'crypto';
import Logger from './utils/logger';
import type { RouteCliType } from '../shared/types/route-proxy';

const log = Logger.scope('AnyRouterRewriter');
type JsonRecord = Record<string, any>;

interface UsageShape {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/**
 * AnyRouter 缺省 system 块
 * 来源: 2026-04-11 抓包验证可用
 */
const ANYROUTER_FIXED_SYSTEM = [
  {
    type: 'text',
    text: "You are Claude Code, Anthropic's official CLI for Claude.",
    cache_control: { type: 'ephemeral' },
  },
];

/**
 * 必需的 anthropic-beta 值
 * 用于启用 1m context 支持
 */
const REQUIRED_ANTHROPIC_BETAS = ['context-1m-2025-08-07'];

/**
 * 递归清理对象中的 [undefined] 值
 */
function stripUndefined(value: any): any {
  if (typeof value !== 'object' || value === null) {
    return value === '[undefined]' ? undefined : value;
  }

  if (Array.isArray(value)) {
    return value.map(stripUndefined).filter(v => v !== undefined);
  }

  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(value)) {
    const cleaned = stripUndefined(val);
    if (cleaned !== undefined) {
      result[key] = cleaned;
    }
  }
  return result;
}

/**
 * 生成 metadata.user_id
 * @param userHash 账户的固定哈希值（64位十六进制）
 */
function generateMetadataUserId(userHash: string): string {
  const sessionUuid = randomUUID();
  return `user_${userHash}_account__session_${sessionUuid}`;
}

/**
 * 合并 anthropic-beta 头
 */
function getHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = match?.[1];
  if (Array.isArray(value)) {
    return value.join(',');
  }
  return value;
}

function mergeAnthropicBeta(existing: string | undefined, required: string[]): string {
  const tokens = new Set<string>();

  if (existing) {
    existing.split(',').forEach(t => {
      const trimmed = t.trim();
      if (trimmed) tokens.add(trimmed);
    });
  }

  required.forEach(t => tokens.add(t));

  return Array.from(tokens).join(',');
}

/**
 * 验证 user hash 格式
 */
export function isValidUserHash(hash: string | undefined): hash is string {
  if (!hash) return false;
  return /^[a-f0-9]{64}$/i.test(hash);
}

export interface AnyRouterRewriteResult {
  body: Buffer;
  headers: Record<string, string>;
  upstreamPath: string;
  upstreamCliType: RouteCliType;
  responseAdapter: AnyRouterResponseAdapter;
  urlSuffix: string;
}

export type AnyRouterResponseAdapter =
  | { type: 'transparent' }
  | { type: 'codexResponses'; model: string; stream: boolean }
  | { type: 'geminiGenerateContent'; model: string; stream: boolean };

export interface AnyRouterResponseTransformResult {
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

function normalizeObject(value: any): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return {};
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') {
          return part;
        }

        const record = normalizeObject(part);
        return normalizeText(record.text ?? record.input_text ?? record.output_text);
      })
      .filter(Boolean)
      .join('\n');
  }

  const record = normalizeObject(content);
  return normalizeText(record.text ?? record.input_text ?? record.output_text);
}

function buildClaudeAnyRouterBody(cleaned: JsonRecord, userHash: string | undefined): JsonRecord {
  const existingMetadata = normalizeObject(cleaned.metadata);
  const existingThinking = normalizeObject(cleaned.thinking);
  const existingOutputConfig = normalizeObject(cleaned.output_config);

  return {
    ...cleaned,
    system: cleaned.system ?? ANYROUTER_FIXED_SYSTEM,
    metadata: {
      ...existingMetadata,
      user_id: generateMetadataUserId(userHash || ''),
    },
    max_tokens: cleaned.max_tokens || 32000,
    stream: cleaned.stream !== false,
    thinking: Object.keys(existingThinking).length > 0 ? existingThinking : { type: 'adaptive' },
    output_config:
      Object.keys(existingOutputConfig).length > 0 ? existingOutputConfig : { effort: 'max' },
  };
}

function getDefaultUpstreamPath(cliType: RouteCliType): string {
  if (cliType === 'codex') {
    return '/v1/responses';
  }

  if (cliType === 'geminiCli') {
    return '/v1beta/';
  }

  return '/v1/messages';
}

function buildTransparentRewriteResult(
  body: Buffer,
  requestUrl: string | undefined,
  cliType: RouteCliType
): AnyRouterRewriteResult {
  return {
    body,
    headers: {},
    upstreamPath: requestUrl || getDefaultUpstreamPath(cliType),
    upstreamCliType: cliType,
    responseAdapter: { type: 'transparent' },
    urlSuffix: '',
  };
}

function getToolLabel(tool: JsonRecord): string {
  return normalizeText(tool.name ?? tool.server_label ?? tool.type) || '<anonymous>';
}

function sanitizeCodexToolsForAnyRouter(cleaned: JsonRecord): JsonRecord {
  if (!Array.isArray(cleaned.tools)) {
    return cleaned;
  }

  const removed: string[] = [];
  const kept = cleaned.tools.filter(tool => {
    const record = normalizeObject(tool);
    const isSupportedTool = record.type === 'function' || record.type === 'custom';
    if (!isSupportedTool) {
      removed.push(getToolLabel(record));
      return false;
    }

    return true;
  });

  if (removed.length === 0) {
    return cleaned;
  }

  const next = { ...cleaned };
  if (kept.length > 0) {
    next.tools = kept;
  } else {
    delete next.tools;
    delete next.tool_choice;
    delete next.parallel_tool_calls;
  }

  log.warn('[AnyRouter] Dropped Codex tools unsupported by AnyRouter', {
    count: removed.length,
    tools: removed.slice(0, 8),
    truncated: Math.max(0, removed.length - 8),
  });

  return next;
}

/**
 * 为 AnyRouter 改写请求
 * @param bodyBuffer 原始请求体
 * @param userHash 账户的固定哈希值
 * @param originalHeaders 原始请求头
 */
export function rewriteForAnyRouter(
  bodyBuffer: Buffer,
  userHash: string | undefined,
  originalHeaders: Record<string, string | string[] | undefined>,
  cliType: RouteCliType = 'claudeCode',
  requestUrl?: string,
  upstreamModel?: string
): AnyRouterRewriteResult {
  // Claude Code 1M 通道缺少 userHash 时通常会被 AnyRouter 拒绝。
  if (cliType === 'claudeCode' && !isValidUserHash(userHash)) {
    log.error('[AnyRouter] Invalid or missing userHash, request will likely fail');
    log.error('[AnyRouter] Please configure userHash in account settings');
  }

  let body: any;
  try {
    body = JSON.parse(bodyBuffer.toString('utf-8'));
  } catch {
    log.warn('[AnyRouter] Failed to parse request body as JSON, skipping rewrite');
    return buildTransparentRewriteResult(bodyBuffer, requestUrl, cliType);
  }

  // 清理 [undefined]
  const cleaned = normalizeObject(stripUndefined(body));
  if (cliType !== 'geminiCli' && !cleaned.model && upstreamModel) {
    cleaned.model = upstreamModel;
  }

  if (cliType === 'codex') {
    const codexBody = sanitizeCodexToolsForAnyRouter(cleaned);

    log.debug('[AnyRouter] Codex native request forwarded:', {
      originalModel: body.model,
      rewrittenModel: codexBody.model,
      cliType,
    });

    return buildTransparentRewriteResult(
      Buffer.from(JSON.stringify(codexBody), 'utf-8'),
      requestUrl,
      cliType
    );
  }

  if (cliType === 'geminiCli') {
    log.debug('[AnyRouter] Gemini native request forwarded:', {
      cliType,
      requestUrl,
      hasUserHash: isValidUserHash(userHash),
    });

    return buildTransparentRewriteResult(
      Buffer.from(JSON.stringify(cleaned), 'utf-8'),
      requestUrl,
      cliType
    );
  }

  const rewritten = buildClaudeAnyRouterBody(cleaned, userHash);
  const responseAdapter: AnyRouterResponseAdapter = { type: 'transparent' };

  log.debug('[AnyRouter] Request rewritten:', {
    originalModel: body.model,
    rewrittenModel: rewritten.model,
    cliType,
    hasUserHash: isValidUserHash(userHash),
    userIdPrefix: rewritten.metadata.user_id.substring(0, 20) + '...',
  });

  // 构造新的请求头
  const headers: Record<string, string> = {
    'anthropic-beta': mergeAnthropicBeta(
      getHeaderValue(originalHeaders, 'anthropic-beta'),
      REQUIRED_ANTHROPIC_BETAS
    ),
  };

  return {
    body: Buffer.from(JSON.stringify(rewritten), 'utf-8'),
    headers,
    upstreamPath: '/v1/messages?beta=true',
    upstreamCliType: 'claudeCode',
    responseAdapter,
    urlSuffix: '?beta=true',
  };
}

function parseJsonBody(body: Buffer): JsonRecord | null {
  try {
    return normalizeObject(JSON.parse(body.toString('utf-8')));
  } catch {
    return null;
  }
}

function parseSseJsonPayloads(body: Buffer): JsonRecord[] {
  const payloads: JsonRecord[] = [];
  const text = body.toString('utf-8').replace(/\r\n/g, '\n');
  for (const block of text.split(/\n\n+/)) {
    const data = block
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice('data:'.length).trimStart())
      .join('\n')
      .trim();

    if (!data || data === '[DONE]') {
      continue;
    }

    try {
      payloads.push(normalizeObject(JSON.parse(data)));
    } catch {
      /* ignore malformed SSE payloads */
    }
  }
  return payloads;
}

function extractAnthropicTextFromJson(payload: JsonRecord): string {
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content
    .map(part => extractTextFromContent(part))
    .filter(Boolean)
    .join('');
}

function normalizeUsage(usage: JsonRecord | undefined): UsageShape {
  if (!usage) {
    return {};
  }

  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = Number(usage.total_tokens);

  return {
    ...(Number.isFinite(inputTokens) ? { inputTokens } : {}),
    ...(Number.isFinite(outputTokens) ? { outputTokens } : {}),
    ...(Number.isFinite(totalTokens) ? { totalTokens } : {}),
  };
}

function mergeUsage(left: UsageShape, right: UsageShape): UsageShape {
  return {
    inputTokens: right.inputTokens ?? left.inputTokens,
    outputTokens: right.outputTokens ?? left.outputTokens,
    totalTokens: right.totalTokens ?? left.totalTokens,
  };
}

function extractAnthropicPayload(body: Buffer): {
  text: string;
  deltas: string[];
  usage: UsageShape;
} {
  const json = parseJsonBody(body);
  if (json) {
    return {
      text: extractAnthropicTextFromJson(json),
      deltas: [],
      usage: normalizeUsage(normalizeObject(json.usage)),
    };
  }

  const deltas: string[] = [];
  let usage: UsageShape = {};
  for (const payload of parseSseJsonPayloads(body)) {
    if (payload.type === 'content_block_delta') {
      const delta = normalizeObject(payload.delta);
      const text = normalizeText(delta.text);
      if (text) {
        deltas.push(text);
      }
    }

    if (payload.type === 'message_start') {
      usage = mergeUsage(
        usage,
        normalizeUsage(normalizeObject(normalizeObject(payload.message).usage))
      );
    }

    if (payload.type === 'message_delta') {
      usage = mergeUsage(usage, normalizeUsage(normalizeObject(payload.usage)));
    }
  }

  return {
    text: deltas.join(''),
    deltas,
    usage,
  };
}

function deleteHeader(headers: Record<string, string | string[] | undefined>, name: string): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      delete headers[key];
    }
  }
}

function replaceResponseBody(
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
  contentType: string
): AnyRouterResponseTransformResult {
  const nextHeaders: Record<string, string | string[] | undefined> = { ...headers };
  deleteHeader(nextHeaders, 'content-length');
  deleteHeader(nextHeaders, 'transfer-encoding');
  deleteHeader(nextHeaders, 'content-encoding');
  nextHeaders['content-type'] = contentType;
  nextHeaders['content-length'] = String(body.length);

  return { body, headers: nextHeaders };
}

function buildCodexUsage(usage: UsageShape): JsonRecord {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: usage.totalTokens ?? inputTokens + outputTokens,
  };
}

function buildCodexResponseObject(
  adapter: Extract<AnyRouterResponseAdapter, { type: 'codexResponses' }>,
  text: string,
  usage: UsageShape
): JsonRecord {
  const responseId = `resp_${randomUUID().replace(/-/g, '')}`;
  const messageId = `msg_${randomUUID().replace(/-/g, '')}`;
  const outputText = {
    type: 'output_text',
    text,
    annotations: [],
  };
  const outputItem = {
    id: messageId,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [outputText],
  };

  return {
    id: responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: adapter.model,
    output: [outputItem],
    output_text: text,
    usage: buildCodexUsage(usage),
  };
}

function sseEvent(event: string | null, data: unknown): string {
  const prefix = event ? `event: ${event}\n` : '';
  return `${prefix}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
}

function buildCodexSseBody(
  adapter: Extract<AnyRouterResponseAdapter, { type: 'codexResponses' }>,
  text: string,
  deltas: string[],
  usage: UsageShape
): Buffer {
  const response = buildCodexResponseObject(adapter, text, usage);
  const responseId = normalizeText(response.id);
  const outputItem = response.output[0];
  const messageId = normalizeText(outputItem.id);
  const actualDeltas = deltas.length > 0 ? deltas : text ? [text] : [];
  const chunks = [
    sseEvent('response.created', { response: { ...response, status: 'in_progress', output: [] } }),
    sseEvent('response.in_progress', {
      response: { ...response, status: 'in_progress', output: [] },
    }),
    sseEvent('response.output_item.added', {
      response_id: responseId,
      output_index: 0,
      item: { ...outputItem, status: 'in_progress', content: [] },
    }),
    sseEvent('response.content_part.added', {
      response_id: responseId,
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    }),
    ...actualDeltas.map(delta =>
      sseEvent('response.output_text.delta', {
        response_id: responseId,
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        delta,
      })
    ),
    sseEvent('response.output_text.done', {
      response_id: responseId,
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      text,
    }),
    sseEvent('response.content_part.done', {
      response_id: responseId,
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      part: outputItem.content[0],
    }),
    sseEvent('response.output_item.done', {
      response_id: responseId,
      output_index: 0,
      item: outputItem,
    }),
    sseEvent('response.completed', { response }),
    sseEvent(null, '[DONE]'),
  ];

  return Buffer.from(chunks.join(''), 'utf-8');
}

function buildGeminiUsage(usage: UsageShape): JsonRecord | undefined {
  if (
    usage.inputTokens === undefined &&
    usage.outputTokens === undefined &&
    usage.totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    ...(usage.inputTokens !== undefined ? { promptTokenCount: usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { candidatesTokenCount: usage.outputTokens } : {}),
    ...(usage.totalTokens !== undefined
      ? { totalTokenCount: usage.totalTokens }
      : usage.inputTokens !== undefined && usage.outputTokens !== undefined
        ? { totalTokenCount: usage.inputTokens + usage.outputTokens }
        : {}),
  };
}

function buildGeminiJson(text: string, usage: UsageShape): JsonRecord {
  const usageMetadata = buildGeminiUsage(usage);
  return {
    candidates: [
      {
        content: {
          parts: [{ text }],
          role: 'model',
        },
        finishReason: 'STOP',
        index: 0,
      },
    ],
    ...(usageMetadata ? { usageMetadata } : {}),
  };
}

function buildGeminiSseBody(text: string, deltas: string[], usage: UsageShape): Buffer {
  const actualDeltas = deltas.length > 0 ? deltas : text ? [text] : [];
  const chunks = actualDeltas.map(delta =>
    sseEvent(null, {
      candidates: [
        {
          content: { parts: [{ text: delta }], role: 'model' },
          index: 0,
        },
      ],
    })
  );
  chunks.push(sseEvent(null, buildGeminiJson('', usage)));
  return Buffer.from(chunks.join(''), 'utf-8');
}

export function transformAnyRouterResponse(params: {
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
  statusCode: number;
  adapter: AnyRouterResponseAdapter;
}): AnyRouterResponseTransformResult {
  if (
    params.adapter.type === 'transparent' ||
    params.statusCode < 200 ||
    params.statusCode >= 300
  ) {
    return { body: params.body, headers: params.headers };
  }

  const anthropicPayload = extractAnthropicPayload(params.body);

  if (params.adapter.type === 'codexResponses') {
    const body = params.adapter.stream
      ? buildCodexSseBody(
          params.adapter,
          anthropicPayload.text,
          anthropicPayload.deltas,
          anthropicPayload.usage
        )
      : Buffer.from(
          JSON.stringify(
            buildCodexResponseObject(params.adapter, anthropicPayload.text, anthropicPayload.usage)
          ),
          'utf-8'
        );
    return replaceResponseBody(
      params.headers,
      body,
      params.adapter.stream ? 'text/event-stream; charset=utf-8' : 'application/json'
    );
  }

  const body = params.adapter.stream
    ? buildGeminiSseBody(anthropicPayload.text, anthropicPayload.deltas, anthropicPayload.usage)
    : Buffer.from(
        JSON.stringify(buildGeminiJson(anthropicPayload.text, anthropicPayload.usage)),
        'utf-8'
      );

  return replaceResponseBody(
    params.headers,
    body,
    params.adapter.stream ? 'text/event-stream; charset=utf-8' : 'application/json'
  );
}
