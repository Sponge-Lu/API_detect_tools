/**
 * 路由分析统计服务
 * 输入: 代理请求结果（outcome, latency, tokens）
 * 输出: 小时级聚合桶, 汇总指标, 分布查询
 * 定位: 服务层 - 请求/token/延迟统计分析
 */

import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';
import { notifyAppDataChanged } from './app-data-events';
import type {
  RouteCliType,
  RouteOutcome,
  RouteAnalyticsBucket,
  RouteAnalyticsConfig,
  RouteAnalyticsObjectStatsItem,
  RouteAnalyticsObjectStatsQuery,
  RouteModelSourceRef,
  RouteRequestLogItem,
  RouteRequestLogQuery,
} from '../shared/types/route-proxy';
import { buildBucketKey } from '../shared/types/route-proxy';
import type { ApiKeyInfo } from '../shared/types/site';
import { resolveApiKeyId } from './route-model-registry-service';

const log = Logger.scope('RouteAnalytics');
const MAX_ROUTE_REQUEST_LOGS = 1000;
const ROUTE_OVERVIEW_DEBOUNCE_MS = 1200;

/** 内存缓冲区，延迟写磁盘 */
const pendingBuckets = new Map<string, RouteAnalyticsBucket>();
const routeRequestLogs: RouteRequestLogItem[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let routeRequestLogSequence = 0;

function buildRouteRequestLogId(at: number): string {
  routeRequestLogSequence += 1;
  return `route-log-${at}-${routeRequestLogSequence}`;
}

function getApiKeyDisplayName(apiKey: Pick<ApiKeyInfo, 'name' | 'token_id' | 'id'>): string {
  const trimmedName = apiKey.name?.trim();
  if (trimmedName) {
    return trimmedName;
  }

  return '未命名 Key';
}

function normalizeCustomCliObjectName(source: RouteModelSourceRef): string {
  const trimmed = source.siteName?.trim();
  if (!trimmed) {
    return source.siteId || '自定义配置';
  }

  return trimmed.replace(/^自定义\s*CLI\s*\/\s*/, '').trim() || trimmed;
}

function resolveRouteRegistryIdentity(params: {
  siteId?: string;
  accountId?: string;
  apiKeyId?: string;
}): {
  siteName?: string;
  accountName?: string;
  userGroupKey?: string;
  apiKeyName?: string;
  sourceType?: RouteModelSourceRef['sourceType'];
} | null {
  const routingConfig = unifiedConfigManager.getRoutingConfig();
  const sources = routingConfig?.modelRegistry?.sources || [];

  for (const source of sources) {
    if (params.siteId && source.siteId !== params.siteId) {
      continue;
    }

    const matchedApiKey = source.availableApiKeys?.find(apiKey => {
      if (params.accountId && apiKey.accountId !== params.accountId) {
        return false;
      }
      return !params.apiKeyId || apiKey.apiKeyId === params.apiKeyId;
    });

    if (params.apiKeyId && !matchedApiKey) {
      continue;
    }

    if (params.accountId && source.accountId && source.accountId !== params.accountId) {
      continue;
    }

    if (source.sourceType === 'customCli') {
      return {
        siteName: normalizeCustomCliObjectName(source),
        accountName: '默认',
        userGroupKey: matchedApiKey?.group,
        apiKeyName: '默认',
        sourceType: source.sourceType,
      };
    }

    return {
      siteName: source.siteName,
      accountName: matchedApiKey?.accountName || source.accountName,
      userGroupKey: matchedApiKey?.group,
      apiKeyName: matchedApiKey?.apiKeyName,
      sourceType: source.sourceType,
    };
  }

  return null;
}

function resolveRouteObjectIdentity(params: {
  siteId?: string;
  accountId?: string;
  apiKeyId?: string;
}): {
  siteName?: string;
  accountName?: string;
  userGroupKey?: string;
  apiKeyName?: string;
  sourceType?: RouteModelSourceRef['sourceType'];
} {
  const unifiedConfig = unifiedConfigManager.exportConfigSync();
  const site = params.siteId
    ? unifiedConfig?.sites.find(item => item.id === params.siteId)
    : undefined;
  const account = params.accountId
    ? unifiedConfig?.accounts.find(item => item.id === params.accountId)
    : undefined;
  const registryIdentity = resolveRouteRegistryIdentity(params);
  const apiKeyInfo =
    params.apiKeyId && account
      ? (account.cached_data?.api_keys || []).find(
          apiKey => resolveApiKeyId(apiKey) === params.apiKeyId
        )
      : undefined;

  return {
    siteName: site?.name || registryIdentity?.siteName,
    accountName: account?.account_name || registryIdentity?.accountName,
    userGroupKey: apiKeyInfo?.group?.trim() || registryIdentity?.userGroupKey || undefined,
    apiKeyName: apiKeyInfo
      ? getApiKeyDisplayName(apiKeyInfo)
      : params.apiKeyId &&
          site?.api_key &&
          resolveApiKeyId({ key: site.api_key }) === params.apiKeyId
        ? '站点默认 Key'
        : registryIdentity?.apiKeyName,
    sourceType: registryIdentity?.sourceType,
  };
}

function buildRouteObjectStatsGroupKey(item: {
  rawId: string;
  sourceType?: RouteModelSourceRef['sourceType'];
  siteName: string;
  accountName: string;
  apiKeyName: string;
}): string {
  if (item.sourceType !== 'customCli') {
    return item.rawId;
  }

  return [item.siteName, item.accountName, item.apiKeyName].join('\u0000');
}

function appendRouteRequestLog(params: {
  requestId: string;
  attempt: number;
  cliType: RouteCliType;
  requestedModel?: string | null;
  canonicalModel?: string | null;
  routeRuleId?: string;
  siteId?: string;
  accountId?: string;
  apiKeyId?: string;
  resolvedModel?: string;
  outcome: RouteOutcome;
  statusCode?: number;
  latencyMs?: number;
  firstByteLatencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  error?: string;
  at: number;
}): void {
  const routingConfig = unifiedConfigManager.getRoutingConfig();
  const routeRule = params.routeRuleId
    ? routingConfig.rules.find(item => item.id === params.routeRuleId)
    : undefined;
  const identity = resolveRouteObjectIdentity({
    siteId: params.siteId,
    accountId: params.accountId,
    apiKeyId: params.apiKeyId,
  });

  const item: RouteRequestLogItem = {
    id: buildRouteRequestLogId(params.at),
    requestId: params.requestId,
    attempt: params.attempt,
    cliType: params.cliType,
    requestedModel: params.requestedModel,
    canonicalModel: params.canonicalModel,
    routeRuleId: params.routeRuleId,
    routeRuleName: routeRule?.name?.trim() || undefined,
    siteId: params.siteId,
    siteName: identity.siteName,
    accountId: params.accountId,
    accountName: identity.accountName,
    userGroupKey: identity.userGroupKey,
    apiKeyId: params.apiKeyId,
    apiKeyName: identity.apiKeyName,
    resolvedModel: params.resolvedModel,
    outcome: params.outcome,
    statusCode: params.statusCode,
    latencyMs: params.latencyMs,
    firstByteLatencyMs: params.firstByteLatencyMs,
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens,
    totalTokens: params.totalTokens,
    error: params.error,
    createdAt: params.at,
  };

  routeRequestLogs.unshift(item);
  if (routeRequestLogs.length > MAX_ROUTE_REQUEST_LOGS) {
    routeRequestLogs.length = MAX_ROUTE_REQUEST_LOGS;
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushPendingBuckets();
  }, 5000);
}

async function flushPendingBuckets(): Promise<void> {
  if (pendingBuckets.size === 0) return;
  // swap-and-flush：新请求写入新 map，避免竞态
  const toFlush = new Map(pendingBuckets);
  pendingBuckets.clear();
  try {
    await unifiedConfigManager.upsertRouteAnalyticsBuckets(Array.from(toFlush.values()));
    notifyAppDataChanged('route-overview', 120);
  } catch (err) {
    // 失败时将数据合并回 pending（增量不丢失）
    for (const [key, bucket] of toFlush) {
      if (!pendingBuckets.has(key)) {
        pendingBuckets.set(key, bucket);
      }
    }
    log.error('Flush analytics buckets failed:', err);
  }
}

function getBucketStart(at: number, bucketSizeMinutes: number): number {
  const ms = bucketSizeMinutes * 60 * 1000;
  return Math.floor(at / ms) * ms;
}

function classifyLatency(ms: number, buckets: number[]): string {
  for (let i = 0; i < buckets.length; i++) {
    if (ms <= buckets[i]) {
      return i === 0 ? `0-${buckets[i]}ms` : `${buckets[i - 1]}-${buckets[i]}ms`;
    }
  }
  return `>${buckets[buckets.length - 1]}ms`;
}

export function getAnalyticsConfig(): RouteAnalyticsConfig {
  return unifiedConfigManager.getRoutingConfig().analytics.config;
}

export async function saveAnalyticsConfig(
  updates: Partial<RouteAnalyticsConfig>
): Promise<RouteAnalyticsConfig> {
  return unifiedConfigManager.updateRouteAnalyticsConfig(updates);
}

/** 记录一次代理请求 */
export function recordRouteRequest(params: {
  requestId: string;
  attempt: number;
  cliType: RouteCliType;
  requestedModel?: string | null;
  canonicalModel: string | null;
  routeRuleId?: string;
  siteId?: string;
  accountId?: string;
  apiKeyId?: string;
  resolvedModel?: string;
  outcome: RouteOutcome;
  statusCode?: number;
  latencyMs?: number;
  firstByteLatencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  error?: string;
  at?: number;
}): void {
  const at = params.at ?? Date.now();
  appendRouteRequestLog({
    requestId: params.requestId,
    attempt: params.attempt,
    cliType: params.cliType,
    requestedModel: params.requestedModel,
    canonicalModel: params.canonicalModel,
    routeRuleId: params.routeRuleId,
    siteId: params.siteId,
    accountId: params.accountId,
    apiKeyId: params.apiKeyId,
    resolvedModel: params.resolvedModel,
    outcome: params.outcome,
    statusCode: params.statusCode,
    latencyMs: params.latencyMs,
    firstByteLatencyMs: params.firstByteLatencyMs,
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens,
    totalTokens: params.totalTokens,
    error: params.error,
    at,
  });
  notifyAppDataChanged('route-overview', ROUTE_OVERVIEW_DEBOUNCE_MS);

  const config = getAnalyticsConfig();
  if (!config.enabled) return;
  if (!params.routeRuleId || !params.siteId || !params.accountId) return;

  const bucketStart = getBucketStart(at, config.bucketSizeMinutes);
  const bucketKey = buildBucketKey(
    bucketStart,
    params.cliType,
    params.canonicalModel || undefined,
    params.siteId,
    params.accountId,
    params.apiKeyId
  );

  let bucket = pendingBuckets.get(bucketKey);
  if (!bucket) {
    // 尝试从持久化读取
    const routing = unifiedConfigManager.getRoutingConfig();
    const existing = routing.analytics.buckets[bucketKey];
    bucket = existing
      ? { ...existing }
      : {
          bucketKey,
          bucketStart,
          bucketSize: 'hour',
          cliType: params.cliType,
          routeRuleId: params.routeRuleId,
          canonicalModel: params.canonicalModel || undefined,
          siteId: params.siteId,
          accountId: params.accountId,
          apiKeyId: params.apiKeyId,
          requestCount: 0,
          successCount: 0,
          failureCount: 0,
          neutralCount: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          statusCodeHistogram: {},
          latencyHistogram: {},
          firstByteHistogram: {},
          updatedAt: at,
        };
  }

  bucket.requestCount++;
  if (params.outcome === 'success') bucket.successCount++;
  else if (params.outcome === 'failure') bucket.failureCount++;
  else bucket.neutralCount++;

  if (config.recordTokenUsage) {
    bucket.promptTokens += params.promptTokens || 0;
    bucket.completionTokens += params.completionTokens || 0;
    bucket.totalTokens += params.totalTokens || 0;
  }

  if (config.recordStatusCode && params.statusCode !== undefined) {
    const sc = String(params.statusCode);
    bucket.statusCodeHistogram[sc] = (bucket.statusCodeHistogram[sc] || 0) + 1;
  }

  if (config.recordLatencyHistogram && params.latencyMs !== undefined) {
    const label = classifyLatency(params.latencyMs, config.latencyHistogramBuckets);
    bucket.latencyHistogram[label] = (bucket.latencyHistogram[label] || 0) + 1;
  }

  if (config.recordLatencyHistogram && params.firstByteLatencyMs !== undefined) {
    const label = classifyLatency(params.firstByteLatencyMs, config.firstByteHistogramBuckets);
    bucket.firstByteHistogram[label] = (bucket.firstByteHistogram[label] || 0) + 1;
  }

  bucket.updatedAt = at;
  pendingBuckets.set(bucketKey, bucket);
  scheduleFlush();
}

/** 查询指定窗口的原始桶 */
export function getAnalyticsBuckets(params: {
  window: '24h' | '7d' | '30d';
  cliType?: RouteCliType;
  routeRuleId?: string;
  canonicalModel?: string;
  siteId?: string;
}): RouteAnalyticsBucket[] {
  const routing = unifiedConfigManager.getRoutingConfig();
  const cutoff = Date.now() - windowToMs(params.window);
  const mergedBuckets = new Map<string, RouteAnalyticsBucket>();

  for (const bucket of Object.values(routing.analytics.buckets)) {
    mergedBuckets.set(bucket.bucketKey, bucket);
  }

  for (const [bucketKey, bucket] of pendingBuckets.entries()) {
    mergedBuckets.set(bucketKey, bucket);
  }

  return [...mergedBuckets.values()].filter(b => {
    if (b.bucketStart < cutoff) return false;
    if (params.cliType && b.cliType !== params.cliType) return false;
    if (params.routeRuleId && b.routeRuleId !== params.routeRuleId) return false;
    if (params.canonicalModel && b.canonicalModel !== params.canonicalModel) return false;
    if (params.siteId && b.siteId !== params.siteId) return false;
    return true;
  });
}

/** 查询窗口期汇总 */
export function getAnalyticsSummary(params: {
  window: '24h' | '7d' | '30d';
  cliType?: RouteCliType;
  routeRuleId?: string;
  canonicalModel?: string;
  siteId?: string;
}): {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  neutralCount: number;
  successRate: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const buckets = getAnalyticsBuckets(params);
  const sum = {
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    neutralCount: 0,
    successRate: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  for (const b of buckets) {
    sum.totalRequests += b.requestCount;
    sum.successCount += b.successCount;
    sum.failureCount += b.failureCount;
    sum.neutralCount += b.neutralCount;
    sum.promptTokens += b.promptTokens;
    sum.completionTokens += b.completionTokens;
    sum.totalTokens += b.totalTokens;
  }
  const denominator = sum.successCount + sum.failureCount;
  sum.successRate =
    denominator > 0 ? Math.round((sum.successCount / denominator) * 10000) / 100 : 0;
  return sum;
}

/** 查询窗口期分布 */
export function getAnalyticsDistribution(params: {
  window: '24h' | '7d' | '30d';
  cliType?: RouteCliType;
  routeRuleId?: string;
  canonicalModel?: string;
  siteId?: string;
}): {
  buckets: RouteAnalyticsBucket[];
  statusCodeHistogram: Record<string, number>;
  latencyHistogram: Record<string, number>;
  firstByteHistogram: Record<string, number>;
} {
  const bucketList = getAnalyticsBuckets(params);
  const sc: Record<string, number> = {};
  const lat: Record<string, number> = {};
  const fb: Record<string, number> = {};

  for (const b of bucketList) {
    for (const [k, v] of Object.entries(b.statusCodeHistogram)) sc[k] = (sc[k] || 0) + v;
    for (const [k, v] of Object.entries(b.latencyHistogram)) lat[k] = (lat[k] || 0) + v;
    for (const [k, v] of Object.entries(b.firstByteHistogram)) fb[k] = (fb[k] || 0) + v;
  }

  return {
    buckets: bucketList,
    statusCodeHistogram: sc,
    latencyHistogram: lat,
    firstByteHistogram: fb,
  };
}

export function getRouteObjectStats(
  params: RouteAnalyticsObjectStatsQuery
): RouteAnalyticsObjectStatsItem[] {
  const buckets = getAnalyticsBuckets({ window: params.window });
  const grouped = new Map<string, RouteAnalyticsObjectStatsItem>();

  for (const bucket of buckets) {
    const id = `${bucket.siteId || '*'}:${bucket.accountId || '*'}:${bucket.apiKeyId || '*'}`;
    const identity = resolveRouteObjectIdentity({
      siteId: bucket.siteId,
      accountId: bucket.accountId,
      apiKeyId: bucket.apiKeyId,
    });
    const siteName = identity.siteName || bucket.siteId || '未知站点';
    const accountName = identity.accountName || bucket.accountId || '未知账户';
    const apiKeyName = identity.apiKeyName || '未标记 Key';
    const groupKey = buildRouteObjectStatsGroupKey({
      rawId: id,
      sourceType: identity.sourceType,
      siteName,
      accountName,
      apiKeyName,
    });
    const current =
      grouped.get(groupKey) ||
      ({
        id,
        siteId: bucket.siteId,
        siteName,
        accountId: bucket.accountId,
        accountName,
        apiKeyId: bucket.apiKeyId,
        apiKeyName,
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        neutralCount: 0,
        successRate: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      } satisfies RouteAnalyticsObjectStatsItem);

    current.requestCount += bucket.requestCount;
    current.successCount += bucket.successCount;
    current.failureCount += bucket.failureCount;
    current.neutralCount += bucket.neutralCount;
    current.promptTokens += bucket.promptTokens || 0;
    current.completionTokens += bucket.completionTokens || 0;
    current.totalTokens += bucket.totalTokens || 0;
    current.lastUsedAt = Math.max(current.lastUsedAt || 0, bucket.updatedAt);
    grouped.set(groupKey, current);
  }

  for (const item of grouped.values()) {
    const denominator = item.successCount + item.failureCount;
    item.successRate =
      denominator > 0 ? Math.round((item.successCount / denominator) * 10000) / 100 : 0;
  }

  const cutoff = Date.now() - windowToMs(params.window);
  for (const logItem of routeRequestLogs) {
    if (logItem.createdAt < cutoff || logItem.outcome !== 'failure') continue;

    const identity = resolveRouteObjectIdentity({
      siteId: logItem.siteId,
      accountId: logItem.accountId,
      apiKeyId: logItem.apiKeyId,
    });
    const siteName = identity.siteName || logItem.siteId || logItem.siteName || '未知站点';
    const accountName =
      identity.accountName || logItem.accountId || logItem.accountName || '未知账户';
    const apiKeyName =
      identity.apiKeyName || logItem.apiKeyId || logItem.apiKeyName || '未标记 Key';
    const rawId = `${logItem.siteId || '*'}:${logItem.accountId || '*'}:${logItem.apiKeyId || '*'}`;
    const current = grouped.get(
      buildRouteObjectStatsGroupKey({
        rawId,
        sourceType: identity.sourceType,
        siteName,
        accountName,
        apiKeyName,
      })
    );
    if (!current) continue;

    current.lastFailureAt = Math.max(current.lastFailureAt || 0, logItem.createdAt);
  }

  const sortBy = params.sortBy || 'requests';
  const sorted = Array.from(grouped.values()).sort((left, right) => {
    if (sortBy === 'tokens') {
      return (
        right.totalTokens - left.totalTokens ||
        right.requestCount - left.requestCount ||
        left.successRate - right.successRate
      );
    }

    if (sortBy === 'failureRisk') {
      return (
        right.failureCount - left.failureCount ||
        left.successRate - right.successRate ||
        right.requestCount - left.requestCount
      );
    }

    if (sortBy === 'successRate') {
      return (
        right.successRate - left.successRate ||
        right.requestCount - left.requestCount ||
        right.totalTokens - left.totalTokens
      );
    }

    return (
      right.requestCount - left.requestCount ||
      right.failureCount - left.failureCount ||
      left.successRate - right.successRate
    );
  });

  const limit = Math.max(1, Math.min(params.limit || 20, 100));
  return sorted.slice(0, limit);
}

export async function resetAnalytics(params?: {
  cliType?: RouteCliType;
  routeRuleId?: string;
}): Promise<void> {
  pendingBuckets.clear();
  await unifiedConfigManager.resetRouteAnalytics(params);
  notifyAppDataChanged('route-overview', 120);
}

export function getRouteRequestLogs(params?: RouteRequestLogQuery): RouteRequestLogItem[] {
  const filtered = routeRequestLogs.filter(item => {
    if (params?.cliType && item.cliType !== params.cliType) return false;
    if (params?.outcome && item.outcome !== params.outcome) return false;
    if (params?.routeRuleId && item.routeRuleId !== params.routeRuleId) return false;
    if (params?.siteId && item.siteId !== params.siteId) return false;
    return true;
  });

  if (!params?.limit || params.limit <= 0) {
    return filtered.map(item => ({ ...item }));
  }

  return filtered.slice(0, params.limit).map(item => ({ ...item }));
}

export function clearRouteRequestLogs(): void {
  routeRequestLogs.length = 0;
  notifyAppDataChanged('route-overview', 120);
}

export async function pruneAnalyticsBuckets(now?: number): Promise<number> {
  return unifiedConfigManager.pruneRouteAnalyticsBuckets(undefined, now);
}

function windowToMs(window: '24h' | '7d' | '30d'): number {
  switch (window) {
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
  }
}
