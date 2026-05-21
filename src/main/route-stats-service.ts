/**
 * 路由成功率统计服务
 * 内存级批量 flush（3-5秒），拉普拉斯平滑评分
 */

import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';
import type {
  RouteChannelKey,
  RouteChannelStats,
  RouteEndpointCapabilityName,
  RouteEndpointCapabilityState,
  RouteOutcome,
  RoutePathState,
  RouteRuntimeConfig,
} from '../shared/types/route-proxy';
import {
  DEFAULT_ROUTE_RUNTIME_CONFIG,
  buildRouteEndpointCapabilityKey,
  buildRoutePathStateKey,
  buildStatsKey,
  normalizeRouteRuntimeConfig,
} from '../shared/types/route-proxy';

const log = Logger.scope('RouteStatsService');

export const ROUTE_PATH_HEALTH_WINDOW_MS =
  DEFAULT_ROUTE_RUNTIME_CONFIG.successRateWindowMinutes * 60 * 1000;
export const ROUTE_PATH_DISABLE_MS =
  DEFAULT_ROUTE_RUNTIME_CONFIG.disableDurationMinutes * 60 * 1000;
export const ROUTE_PATH_MIN_SUCCESS_RATE = DEFAULT_ROUTE_RUNTIME_CONFIG.minSuccessRate;
export const ROUTE_PATH_MIN_DISABLE_SAMPLES = 2;

/** 等待 flush 的内存缓冲区 */
const pendingUpdates = new Map<string, RouteChannelStats>();
let flushTimer: NodeJS.Timeout | null = null;

type RouteChannelRuntimeKey = RouteChannelKey & {
  targetProtocol?: RouteChannelStats['targetProtocol'];
};

type RoutePathRuntimeKey = RouteChannelRuntimeKey & {
  cliType?: RoutePathState['cliType'];
  canonicalModel?: string;
  resolvedModel?: string;
};

type RouteEndpointCapabilityRuntimeKey = RouteChannelRuntimeKey & {
  cliType: RouteEndpointCapabilityState['cliType'];
};

/** 触发延迟 flush（3秒后写磁盘） */
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushToStorage();
  }, 3000);
}

/** 将缓冲区写入 unified-config-manager */
export async function flushToStorage(): Promise<void> {
  if (pendingUpdates.size === 0) return;
  const updates = new Map(pendingUpdates);
  pendingUpdates.clear();
  for (const [, stats] of updates) {
    try {
      await unifiedConfigManager.recordRouteStats(
        {
          routeRuleId: stats.routeRuleId,
          siteId: stats.siteId,
          accountId: stats.accountId,
          apiKeyId: stats.apiKeyId,
          targetProtocol: stats.targetProtocol,
        },
        'neutral', // 实际值已在内存中预计算，直接覆写
        { statusCode: stats.lastStatusCode, latencyMs: stats.lastLatencyMs }
      );
    } catch (err) {
      log.error('flush stats failed', err);
    }
  }
}

/**
 * 记录一次请求结果（内存立即更新，延迟写磁盘）
 */
export function recordOutcome(
  key: RouteChannelRuntimeKey,
  outcome: RouteOutcome,
  meta?: { statusCode?: number; latencyMs?: number }
): void {
  const k = buildStatsKey(key);
  const now = Date.now();

  // 先从内存缓冲或磁盘读取
  const stats: RouteChannelStats =
    pendingUpdates.get(k) ||
    (() => {
      const routing = unifiedConfigManager.getRoutingConfig();
      return (
        routing.stats[k] || {
          ...key,
          successCount: 0,
          failureCount: 0,
          neutralCount: 0,
          consecutiveFailures: 0,
        }
      );
    })();

  if (outcome === 'success') {
    stats.successCount++;
    stats.consecutiveFailures = 0;
    stats.lastSuccessAt = now;
  } else if (outcome === 'failure') {
    stats.failureCount++;
    stats.consecutiveFailures++;
    stats.lastFailureAt = now;
  } else {
    stats.neutralCount++;
  }
  stats.lastUsedAt = now;
  if (meta?.statusCode !== undefined) stats.lastStatusCode = meta.statusCode;
  if (meta?.latencyMs !== undefined) stats.lastLatencyMs = meta.latencyMs;

  pendingUpdates.set(k, stats);
  scheduleFlush();
}

export function isRoutePathDisabled(key: RoutePathRuntimeKey, now: number = Date.now()): boolean {
  const routing = unifiedConfigManager.getRoutingConfig();
  const state = routing.routePathStates[buildRoutePathStateKey(key)];
  return Boolean(state?.disabledUntil && state.disabledUntil > now);
}

export function isRouteEndpointUnsupported(
  key: RouteEndpointCapabilityRuntimeKey,
  endpoint: RouteEndpointCapabilityName
): boolean {
  const routing = unifiedConfigManager.getRoutingConfig();
  const capabilityKey = buildRouteEndpointCapabilityKey({ ...key, endpoint });
  return routing.routeEndpointCapabilities?.[capabilityKey]?.status === 'unsupported';
}

export async function recordRouteEndpointUnsupported(
  key: RouteEndpointCapabilityRuntimeKey,
  endpoint: RouteEndpointCapabilityName,
  meta: { statusCode?: number; error?: string; reason?: string } = {},
  now: number = Date.now()
): Promise<RouteEndpointCapabilityState> {
  const routing = unifiedConfigManager.getRoutingConfig();
  const capabilityKey = buildRouteEndpointCapabilityKey({ ...key, endpoint });
  const existing = routing.routeEndpointCapabilities?.[capabilityKey];
  const nextState: RouteEndpointCapabilityState = {
    siteId: key.siteId,
    accountId: key.accountId,
    apiKeyId: key.apiKeyId,
    cliType: key.cliType,
    targetProtocol: key.targetProtocol,
    endpoint,
    status: 'unsupported',
    reason: meta.reason ?? existing?.reason,
    statusCode: meta.statusCode ?? existing?.statusCode,
    lastError: meta.error ?? existing?.lastError,
    firstObservedAt: existing?.firstObservedAt ?? now,
    lastObservedAt: now,
    updatedAt: now,
  };

  await unifiedConfigManager.upsertRouteEndpointCapabilityState(nextState);
  return nextState;
}

export async function recordRoutePathOutcome(
  key: RoutePathRuntimeKey,
  outcome: RouteOutcome,
  meta?: { statusCode?: number; latencyMs?: number; error?: string },
  nowOrRuntimeConfig: number | Partial<RouteRuntimeConfig> = Date.now(),
  runtimeConfig?: Partial<RouteRuntimeConfig>
): Promise<RoutePathState> {
  const routing = unifiedConfigManager.getRoutingConfig();
  const stateKey = buildRoutePathStateKey(key);
  const existing = routing.routePathStates[stateKey];
  const now = typeof nowOrRuntimeConfig === 'number' ? nowOrRuntimeConfig : Date.now();
  const effectiveRuntimeConfig = normalizeRouteRuntimeConfig(
    typeof nowOrRuntimeConfig === 'number' ? runtimeConfig : nowOrRuntimeConfig
  );
  const healthWindowMs = effectiveRuntimeConfig.successRateWindowMinutes * 60 * 1000;
  const shouldResetWindow =
    !existing?.windowStartedAt || now - existing.windowStartedAt >= healthWindowMs;

  const windowStartedAt = shouldResetWindow ? now : existing.windowStartedAt;
  let windowRequestCount = shouldResetWindow ? 0 : existing.windowRequestCount || 0;
  let windowSuccessCount = shouldResetWindow ? 0 : existing.windowSuccessCount || 0;

  if (outcome === 'success' || outcome === 'failure') {
    windowRequestCount += 1;
    if (outcome === 'success') {
      windowSuccessCount += 1;
    }
  }

  const successRate =
    windowRequestCount > 0 ? windowSuccessCount / windowRequestCount : (existing?.successRate ?? 1);
  const stillDisabledUntil =
    existing?.disabledUntil && existing.disabledUntil > now ? existing.disabledUntil : undefined;
  const shouldDisable =
    outcome === 'failure' &&
    windowRequestCount >= ROUTE_PATH_MIN_DISABLE_SAMPLES &&
    windowRequestCount > 0 &&
    successRate < effectiveRuntimeConfig.minSuccessRate;

  const nextState: RoutePathState = {
    routeRuleId: key.routeRuleId,
    siteId: key.siteId,
    accountId: key.accountId,
    apiKeyId: key.apiKeyId,
    cliType: key.cliType,
    targetProtocol: key.targetProtocol,
    canonicalModel: key.canonicalModel,
    resolvedModel: key.resolvedModel,
    windowStartedAt,
    windowRequestCount,
    windowSuccessCount,
    successRate,
    disabledUntil: shouldDisable
      ? now + effectiveRuntimeConfig.disableDurationMinutes * 60 * 1000
      : stillDisabledUntil,
    disabledReason: shouldDisable
      ? 'success_rate_below_threshold'
      : stillDisabledUntil
        ? existing?.disabledReason
        : undefined,
    lastOutcome: outcome,
    lastStatusCode: meta?.statusCode,
    lastLatencyMs: meta?.latencyMs,
    lastError: meta?.error,
    lastUsedAt: now,
    lastSuccessAt: outcome === 'success' ? now : existing?.lastSuccessAt,
    lastFailureAt: outcome === 'failure' ? now : existing?.lastFailureAt,
    updatedAt: now,
  };

  await unifiedConfigManager.upsertRoutePathState(nextState);
  return nextState;
}

/**
 * 拉普拉斯平滑评分
 * smoothed = (success+1) / (success+failure+2)
 * 惩罚：连续失败，加分：最近成功，减分：高延迟
 */
export function computeScore(stats: RouteChannelStats): number {
  const s = stats.successCount;
  const f = stats.failureCount;
  const smoothed = (s + 1) / (s + f + 2);
  const consecutivePenalty = Math.min(stats.consecutiveFailures, 3) * 0.15;
  const recentSuccessBonus = stats.lastSuccessAt ? 0.05 : 0;
  const latencyPenalty = stats.lastLatencyMs && stats.lastLatencyMs > 8000 ? 0.05 : 0;
  return smoothed - consecutivePenalty + recentSuccessBonus - latencyPenalty;
}

/**
 * 对候选通道按评分排序
 */
export function sortChannelsByScore<T extends RouteChannelKey>(channels: T[]): T[] {
  const routing = unifiedConfigManager.getRoutingConfig();
  return [...channels].sort((a, b) => {
    const aPriority = (a as T & { sitePriority?: number }).sitePriority ?? Number.MAX_SAFE_INTEGER;
    const bPriority = (b as T & { sitePriority?: number }).sitePriority ?? Number.MAX_SAFE_INTEGER;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    const aSiteId = a.siteId || '';
    const bSiteId = b.siteId || '';
    if (aSiteId !== bSiteId) {
      return aSiteId.localeCompare(bSiteId);
    }

    const aApiKeyPriority =
      (a as T & { apiKeyPriority?: number }).apiKeyPriority ?? Number.MAX_SAFE_INTEGER;
    const bApiKeyPriority =
      (b as T & { apiKeyPriority?: number }).apiKeyPriority ?? Number.MAX_SAFE_INTEGER;
    if (aApiKeyPriority !== bApiKeyPriority) {
      return aApiKeyPriority - bApiKeyPriority;
    }

    const aApiKeyOrder = (a as T & { apiKeyOrder?: number }).apiKeyOrder ?? Number.MAX_SAFE_INTEGER;
    const bApiKeyOrder = (b as T & { apiKeyOrder?: number }).apiKeyOrder ?? Number.MAX_SAFE_INTEGER;
    if (aApiKeyOrder !== bApiKeyOrder) {
      return aApiKeyOrder - bApiKeyOrder;
    }

    const aOriginalModelIndex =
      (a as T & { originalModelIndex?: number }).originalModelIndex ?? Number.MAX_SAFE_INTEGER;
    const bOriginalModelIndex =
      (b as T & { originalModelIndex?: number }).originalModelIndex ?? Number.MAX_SAFE_INTEGER;
    if (aOriginalModelIndex !== bOriginalModelIndex) {
      return aOriginalModelIndex - bOriginalModelIndex;
    }

    const aKey = buildStatsKey(a);
    const bKey = buildStatsKey(b);

    const aStats: RouteChannelStats = routing.stats[aKey] || {
      ...a,
      successCount: 0,
      failureCount: 0,
      neutralCount: 0,
      consecutiveFailures: 0,
    };
    const bStats: RouteChannelStats = routing.stats[bKey] || {
      ...b,
      successCount: 0,
      failureCount: 0,
      neutralCount: 0,
      consecutiveFailures: 0,
    };

    const scoreDiff = computeScore(bStats) - computeScore(aStats);
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff > 0 ? 1 : -1;

    // 次级排序：最近成功时间 DESC
    const lastSuccessDiff = (bStats.lastSuccessAt || 0) - (aStats.lastSuccessAt || 0);
    if (lastSuccessDiff !== 0) return lastSuccessDiff;

    // 延迟 ASC
    const latDiff = (aStats.lastLatencyMs || 0) - (bStats.lastLatencyMs || 0);
    if (latDiff !== 0) return latDiff;

    // 字典序稳定排序
    return aKey.localeCompare(bKey);
  });
}
