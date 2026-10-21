/**
 * 上游失败分类
 * 输入: 上游响应状态码/响应头/响应体，或传输层异常
 * 输出: 失败类别、归一化摘要、Retry-After 延迟、留存优先级
 * 定位: 工具层 - 纯函数，无 I/O；供路由代理决定健康度记账、重试节奏与聚合响应
 */

import type * as http from 'http';
import type {
  RouteOutcome,
  RoutePathDisabledReason,
  RouteUpstreamFailureClass,
} from '../shared/types/route-proxy';

/** 瞬时(可重试)上游状态：网关抖动/限流/超时，不应被当作 CLI 终结失败。 */
const TRANSIENT_UPSTREAM_STATUS_CODES = new Set([
  408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 529, 530,
]);

/** 请求侧致命：调用方载荷被拒，换通道也会复现，不应计入通道健康度。 */
const REQUEST_FATAL_STATUS_CODES = new Set([400, 413, 422]);

/** 通道侧致命：该凭证/模型在此通道不可用。 */
const CHANNEL_FATAL_STATUS_CODES = new Set([401, 402, 403, 404, 405, 410]);

export const QUOTA_EXHAUSTED_ROUTE_LOG_MESSAGE = '余额不足，已跳过当前通道';

const UPSTREAM_QUOTA_EXHAUSTION_PATTERNS = [
  /\binsufficient(?:[_\s-]+account)?[_\s-]+balance\b/i,
  /\binsufficient[_\s-]+quota\b/i,
  /\bbilling[_\s-]+error\b/i,
  /\bupstream[_\s-]+quota[_\s-]+exhausted\b/i,
  /\buser[_\s-]+quota[_\s-]+is[_\s-]+not[_\s-]+enough\b/i,
  /(?:用户)?(?:余额|额度)不足/u,
  /预扣费(?:额度)?失败/u,
];

/** Retry-After 上限，避免上游给出的超长冷却阻塞路由决策。 */
export const ROUTE_RETRY_AFTER_MAX_MS = 60_000;

export interface RouteUpstreamFailure {
  failureClass: RouteUpstreamFailureClass;
  statusCode?: number;
  /** 结构化单行摘要，是写入请求日志的唯一文本。 */
  summary: string;
  /** 上游原始响应体，聚合响应透传时使用。 */
  rawBody?: Buffer;
  headers?: http.IncomingHttpHeaders;
  retryAfterMs?: number;
}

export function classifyRouteStatusCode(statusCode: number): RouteOutcome {
  if (statusCode >= 200 && statusCode < 400) return 'success';
  return 'failure';
}

export function isTransientUpstreamStatus(statusCode?: number): boolean {
  return typeof statusCode === 'number' && TRANSIENT_UPSTREAM_STATUS_CODES.has(statusCode);
}

export function isUpstreamQuotaExhaustionResponse(statusCode: number, body: Buffer): boolean {
  if (classifyRouteStatusCode(statusCode) !== 'failure') {
    return false;
  }

  const summary = summarizeUpstreamFailureBodyForLog(body, 4000);
  return UPSTREAM_QUOTA_EXHAUSTION_PATTERNS.some(pattern => pattern.test(summary));
}

export function buildQuotaExhaustedRouteLogError(upstreamFailureSummary: string): string {
  return upstreamFailureSummary
    ? `${QUOTA_EXHAUSTED_ROUTE_LOG_MESSAGE}；上游错误：${upstreamFailureSummary}`
    : QUOTA_EXHAUSTED_ROUTE_LOG_MESSAGE;
}

/**
 * 分类顺序不可调换：配额标记出现在 403/429 上，必须先于请求侧/通道侧判定，
 * 与 route-runtime.md 的配额优先级契约一致。
 */
export function classifyUpstreamFailure(input: {
  statusCode?: number;
  headers?: http.IncomingHttpHeaders;
  body?: Buffer;
  error?: unknown;
  now?: number;
}): RouteUpstreamFailure {
  const now = input.now ?? Date.now();
  const retryAfterMs = parseRetryAfterMs(input.headers, now);

  if (input.error !== undefined) {
    return {
      failureClass: 'transient',
      summary: normalizeLogLine(
        input.error instanceof Error ? input.error.message : String(input.error)
      ),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
  }

  const statusCode = input.statusCode;
  const body = input.body ?? Buffer.alloc(0);
  const base = {
    statusCode,
    summary: summarizeUpstreamFailureBodyForLog(body),
    rawBody: body,
    ...(input.headers ? { headers: input.headers } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };

  if (typeof statusCode === 'number' && isUpstreamQuotaExhaustionResponse(statusCode, body)) {
    return { ...base, failureClass: 'quota_exhausted' };
  }
  if (typeof statusCode === 'number' && [400, 413, 422].includes(statusCode) &&
      /context[_ ](?:length|window)|maximum context|input token.{0,30}(?:exceed|limit)|prompt.{0,20}(?:too long|too large)|request_too_large|too many tokens/i.test(base.summary)) {
    return { ...base, failureClass: 'overflow' };
  }
  if (typeof statusCode === 'number' && REQUEST_FATAL_STATUS_CODES.has(statusCode)) {
    return { ...base, failureClass: 'request_fatal' };
  }
  if (typeof statusCode === 'number' && CHANNEL_FATAL_STATUS_CODES.has(statusCode)) {
    return { ...base, failureClass: 'channel_fatal' };
  }
  if (isTransientUpstreamStatus(statusCode)) {
    return { ...base, failureClass: 'transient' };
  }

  return { ...base, failureClass: 'unknown' };
}

/**
 * 仅 request_fatal 记 neutral：调用方载荷缺陷会在每个通道复现，
 * 计入成功率窗口会误禁用健康通道。故障转移行为不受此影响。
 */
export function failureClassToOutcome(failureClass: RouteUpstreamFailureClass): RouteOutcome {
  return failureClass === 'request_fatal' || failureClass === 'overflow' ? 'neutral' : 'failure';
}

/** 凭证被拒：该 key 在此通道不可用 */
const CREDENTIAL_REJECTED_STATUS = new Set([401, 402, 403]);
/** 模型不可用：该模型在此通道不存在或不被支持 */
const MODEL_UNAVAILABLE_STATUS = new Set([404, 405, 410]);

/**
 * 上游确证的不可用原因，用于首次即禁用该路径（而非等成功率窗口推断）。
 * 返回 undefined 表示无确证证据，沿用既有统计禁用。
 * request_fatal 恒返回 undefined —— 载荷缺陷不是通道的错，永不禁用通道。
 */
export function resolveRoutePathDisabledReason(
  failure: RouteUpstreamFailure
): RoutePathDisabledReason | undefined {
  if (failure.failureClass === 'quota_exhausted') {
    return 'upstream_quota_exhausted';
  }
  if (failure.failureClass !== 'channel_fatal' || failure.statusCode === undefined) {
    return undefined;
  }
  if (CREDENTIAL_REJECTED_STATUS.has(failure.statusCode)) {
    return 'upstream_credential_rejected';
  }
  if (MODEL_UNAVAILABLE_STATUS.has(failure.statusCode)) {
    return 'upstream_model_unavailable';
  }

  return undefined;
}

/** quota_exhausted 恒为 0，确保其响应体永远无法进入聚合透传分支。 */
const FAILURE_RETENTION_RANK: Record<RouteUpstreamFailureClass, number> = {
  overflow: 5,
  request_fatal: 4,
  channel_fatal: 3,
  transient: 2,
  unknown: 1,
  quota_exhausted: 0,
};

/** 同级保留更早的一次：首个候选优先级最高，其错误最具代表性。 */
export function retainUpstreamFailure(
  current: RouteUpstreamFailure | undefined,
  next: RouteUpstreamFailure
): RouteUpstreamFailure | undefined {
  if (FAILURE_RETENTION_RANK[next.failureClass] <= 0) {
    return current;
  }
  if (!current) {
    return next;
  }

  return FAILURE_RETENTION_RANK[next.failureClass] > FAILURE_RETENTION_RANK[current.failureClass]
    ? next
    : current;
}

export function parseRetryAfterMs(
  headers: http.IncomingHttpHeaders | undefined,
  now: number = Date.now()
): number | undefined {
  const raw = headers?.['retry-after'];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? Math.min(seconds * 1000, ROUTE_RETRY_AFTER_MAX_MS) : undefined;
  }

  const deadline = Date.parse(value);
  if (!Number.isFinite(deadline)) {
    return undefined;
  }

  const remaining = deadline - now;
  return remaining > 0 ? Math.min(remaining, ROUTE_RETRY_AFTER_MAX_MS) : undefined;
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

export function summarizeUpstreamFailureBodyRaw(body: Buffer, maxChars: number = 1200): string {
  return truncateUpstreamFailureSummary(readUpstreamFailureBodyText(body), maxChars);
}

function readUpstreamFailureBodyText(body: Buffer): string {
  if (!body.length) {
    return '';
  }

  const text = body.toString('utf-8').replace(/\0/g, '').trim();
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
