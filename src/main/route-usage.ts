/**
 * 路由用量与思考强度解析
 * 输入: 上游响应体 / SSE 文本 / 请求体 JSON
 * 输出: RouteUsageStats、reasoning effort
 * 定位: 工具层 - 纯函数
 */

import { asRecord, readString } from './route-proxy-shared';

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

export function hasRouteUsageValues(usage: RouteUsageStats | undefined): usage is RouteUsageStats {
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

export function isAllZeroRouteUsage(usage: RouteUsageStats | undefined): usage is RouteUsageStats {
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

export function finalizeRouteUsage(
  usage: RouteUsageStats | undefined
): RouteUsageStats | undefined {
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

export function extractUsageFromParsed(value: unknown, depth = 0): RouteUsageStats | undefined {
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
