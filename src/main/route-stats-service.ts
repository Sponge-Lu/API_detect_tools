/**
 * 路由路径熔断与通道统计服务
 * 路径级三态熔断（阶梯打开 → 半开单探测 → 闭合）、站点级熔断、通道统计内存批量 flush
 */

import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';
import type {
  RouteChannelKey,
  RouteChannelStats,
  RouteEndpointCapabilityName,
  RouteEndpointCapabilityState,
  RouteOutcome,
  RoutePathDisabledReason,
  RoutePathState,
  RouteRuntimeConfig,
  RoutingConfig,
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
/**
 * 路径熔断阶梯时长（分钟），上限为规则配置的 disableDurationMinutes。
 * 首次很短，避免瞬时故障长时间误伤健康通道；同一原因连续跳闸才逐级升到常规时��。
 * 到期后进入半开：放行一个真实请求探测，成功即闭合，失败则按下一级重新打开。
 */
export const ROUTE_PATH_DISABLE_LADDER_MINUTES = [2, 10, 30];
/** 半开探测占位 TTL：探测请求未记账（如客户端取消）时自动释放名额。 */
const ROUTE_PATH_HALF_OPEN_PROBE_TTL_MS = 120_000;
/** 半开探测进行中，其他请求得到的 Retry-After 提示。 */
const ROUTE_PATH_HALF_OPEN_RETRY_HINT_MS = 5_000;
/** 站点级熔断：同站点连续传输异常 / 同站点同模型连续 404 类，整站（或该模型）短时跳过。 */
const ROUTE_SITE_BREAKER_MIN_FAILURES = 2;
const ROUTE_SITE_BREAKER_LADDER_MS = [60_000, 120_000, 300_000];
const TRANSPORT_FAILURE_PATTERN =
  /^(net::|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|Request timeout|Stream idle timeout)/i;

/** 半开探测占位：stateKey → 占位时间（进程内） */
const halfOpenProbeClaimedAt = new Map<string, number>();

interface SiteBreaker {
  consecutiveFailures: number;
  streak: number;
  openUntil?: number;
}
/** 站点级熔断器（进程内）：scope → 状态 */
const siteBreakers = new Map<string, SiteBreaker>();

/** 等待 flush 的内存缓冲区 */
const pendingUpdates = new Map<string, RouteChannelStats>();
/** 路径状态已直接写入内存 routing，仅待落盘 */
let routePathStatesDirty = false;
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

function getAffinityInvalidationBoundary(
  routing: Pick<RoutingConfig, 'modelRegistry'>,
  canonicalModel: string | undefined
): number | undefined {
  if (!canonicalModel) {
    return undefined;
  }

  const boundary = routing.modelRegistry?.displayItems.find(
    item => item.canonicalName === canonicalModel
  )?.priorityConfig?.affinityInvalidatedAt;
  return typeof boundary === 'number' && Number.isFinite(boundary) ? boundary : undefined;
}

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
  const pathStatesDirty = routePathStatesDirty;
  routePathStatesDirty = false;
  if (pendingUpdates.size === 0) {
    if (pathStatesDirty) {
      await unifiedConfigManager.persistRouteRuntimeState().catch(err => {
        log.error('flush route path states failed', err);
      });
    }
    return;
  }
  const updates = Array.from(pendingUpdates.values());
  pendingUpdates.clear();
  // 缓冲对象是内存中已聚合的最终计数，整对象覆写；
  // 禁止回退到逐条增量记账（会丢掉首个窗口的计数并虚增 neutralCount）。
  // 该写入同时落盘 routePathStates。
  try {
    await unifiedConfigManager.upsertRouteChannelStatsBatch(updates);
  } catch (err) {
    log.error('flush stats failed', err);
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

function ladderMs(ladder: readonly number[], streak: number): number {
  return ladder[Math.min(Math.max(streak, 1), ladder.length) - 1];
}

/** 打开态到期但尚未有成功确认：半开，只放行一个探测请求。 */
function isRoutePathHalfOpen(state: RoutePathState | undefined, now: number): boolean {
  return Boolean(state?.disabledReason) && !(state!.disabledUntil && state!.disabledUntil > now);
}

function siteScopeKey(siteId: string): string {
  return `site|${siteId}`;
}

function siteModelScopeKey(key: RoutePathRuntimeKey): string {
  return `model|${key.siteId}|${key.resolvedModel || key.canonicalModel || '*'}`;
}

function resolveSiteBreakerScope(
  key: RoutePathRuntimeKey,
  outcome: RouteOutcome,
  meta?: { statusCode?: number; error?: string; confirmedUnavailable?: RoutePathDisabledReason }
): string | undefined {
  if (outcome !== 'failure') return undefined;
  if (meta?.confirmedUnavailable === 'upstream_model_unavailable') return siteModelScopeKey(key);
  if (meta?.statusCode === undefined && meta?.error && TRANSPORT_FAILURE_PATTERN.test(meta.error)) {
    return siteScopeKey(key.siteId);
  }
  return undefined;
}

function getSiteBreakerOpenUntil(key: RoutePathRuntimeKey, now: number): number | undefined {
  let openUntil: number | undefined;
  for (const scope of [siteScopeKey(key.siteId), siteModelScopeKey(key)]) {
    const breaker = siteBreakers.get(scope);
    if (breaker?.openUntil && breaker.openUntil > now) {
      openUntil = Math.max(openUntil ?? 0, breaker.openUntil);
    }
  }
  return openUntil;
}

function recordSiteBreakerOutcome(
  key: RoutePathRuntimeKey,
  outcome: RouteOutcome,
  meta: { statusCode?: number; error?: string; confirmedUnavailable?: RoutePathDisabledReason },
  now: number
): void {
  if (outcome === 'success') {
    siteBreakers.delete(siteScopeKey(key.siteId));
    siteBreakers.delete(siteModelScopeKey(key));
    return;
  }
  const scope = resolveSiteBreakerScope(key, outcome, meta);
  if (!scope) return;
  const breaker = siteBreakers.get(scope) ?? { consecutiveFailures: 0, streak: 0 };
  breaker.consecutiveFailures += 1;
  if (breaker.consecutiveFailures >= ROUTE_SITE_BREAKER_MIN_FAILURES) {
    breaker.consecutiveFailures = 0;
    breaker.streak += 1;
    breaker.openUntil = now + ladderMs(ROUTE_SITE_BREAKER_LADDER_MS, breaker.streak);
    log.warn('Site-level breaker opened', {
      scope,
      streak: breaker.streak,
      openUntil: breaker.openUntil,
    });
  }
  siteBreakers.set(scope, breaker);
}

/** 清除站点级熔断（随路径状态重置一起调用）。 */
export function resetRouteSiteBreakers(siteId?: string): void {
  if (!siteId) {
    siteBreakers.clear();
    return;
  }
  for (const scope of siteBreakers.keys()) {
    if (scope === siteScopeKey(siteId) || scope.startsWith(`model|${siteId}|`)) {
      siteBreakers.delete(scope);
    }
  }
}

/**
 * 路径当前不可尝试时返回预计可重试时刻：打开态取到期时间，半开且探测在途取短提示，
 * 站点级熔断取其到期时间；三者取最晚。
 */
export function getRoutePathDisabledUntil(
  key: RoutePathRuntimeKey,
  now: number = Date.now()
): number | undefined {
  const routing = unifiedConfigManager.getRoutingConfig();
  const stateKey = buildRoutePathStateKey(key);
  const state = routing.routePathStates[stateKey];
  let until = getSiteBreakerOpenUntil(key, now);
  if (state?.disabledUntil && state.disabledUntil > now) {
    until = Math.max(until ?? 0, state.disabledUntil);
  } else if (isRoutePathHalfOpen(state, now)) {
    const claimedAt = halfOpenProbeClaimedAt.get(stateKey);
    if (claimedAt !== undefined && now - claimedAt < ROUTE_PATH_HALF_OPEN_PROBE_TTL_MS) {
      until = Math.max(until ?? 0, now + ROUTE_PATH_HALF_OPEN_RETRY_HINT_MS);
    }
  }
  return until;
}

export function isRoutePathDisabled(key: RoutePathRuntimeKey, now: number = Date.now()): boolean {
  return getRoutePathDisabledUntil(key, now) !== undefined;
}

/**
 * 在真正发起上游尝试前调用：不可尝试返回 false；半开则占住唯一探测名额。
 * 名额由 recordRoutePathOutcome 释放，或超过 TTL 自动失效。
 */
export function beginRoutePathAttempt(key: RoutePathRuntimeKey, now: number = Date.now()): boolean {
  if (getRoutePathDisabledUntil(key, now) !== undefined) return false;
  const routing = unifiedConfigManager.getRoutingConfig();
  const stateKey = buildRoutePathStateKey(key);
  if (isRoutePathHalfOpen(routing.routePathStates[stateKey], now)) {
    halfOpenProbeClaimedAt.set(stateKey, now);
  }
  return true;
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

/**
 * 路径状态直接写内存并延迟落盘：该函数处在请求热路径上，
 * 不能让每次上游结果都等待一次全量 fsync。
 */
export function recordRoutePathOutcome(
  key: RoutePathRuntimeKey,
  outcome: RouteOutcome,
  meta?: {
    statusCode?: number;
    latencyMs?: number;
    error?: string;
    requestSelectionStartedAt?: number;
    /** 上游确证的不可用原因：首次即禁用，不等成功率窗口推断 */
    confirmedUnavailable?: RoutePathDisabledReason;
  },
  nowOrRuntimeConfig: number | Partial<RouteRuntimeConfig> = Date.now(),
  runtimeConfig?: Partial<RouteRuntimeConfig>
): RoutePathState {
  const routing = unifiedConfigManager.getRoutingConfig();
  const stateKey = buildRoutePathStateKey(key);
  const existing = routing.routePathStates[stateKey];
  const now = typeof nowOrRuntimeConfig === 'number' ? nowOrRuntimeConfig : Date.now();
  const effectiveRuntimeConfig = normalizeRouteRuntimeConfig(
    typeof nowOrRuntimeConfig === 'number' ? runtimeConfig : nowOrRuntimeConfig
  );
  const halfOpen = isRoutePathHalfOpen(existing, now);
  halfOpenProbeClaimedAt.delete(stateKey);
  recordSiteBreakerOutcome(key, outcome, meta ?? {}, now);

  const healthWindowMs = effectiveRuntimeConfig.successRateWindowMinutes * 60 * 1000;
  // 半开探测成功即闭合并重开窗口：旧窗口里的失败样本不应把刚恢复的路径再次拖回打开态。
  const shouldResetWindow =
    (halfOpen && outcome === 'success') ||
    !existing?.windowStartedAt ||
    now - existing.windowStartedAt >= healthWindowMs;

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
  const affinitySuppressedUntil =
    existing?.affinitySuppressedUntil && existing.affinitySuppressedUntil > now
      ? existing.affinitySuppressedUntil
      : undefined;
  const affinitySuppressedAt = affinitySuppressedUntil ? existing?.affinitySuppressedAt : undefined;
  const affinityInvalidatedAt = getAffinityInvalidationBoundary(routing, key.canonicalModel);
  const requestSelectionStartedAt = meta?.requestSelectionStartedAt;
  const preservePostInvalidationSuccess =
    outcome === 'success' &&
    affinityInvalidatedAt !== undefined &&
    (requestSelectionStartedAt === undefined ||
      requestSelectionStartedAt <= affinityInvalidatedAt) &&
    existing?.lastSuccessRequestStartedAt !== undefined &&
    existing.lastSuccessRequestStartedAt > affinityInvalidatedAt;
  const shouldDisable =
    outcome === 'failure' &&
    windowRequestCount >= ROUTE_PATH_MIN_DISABLE_SAMPLES &&
    windowRequestCount > 0 &&
    successRate < effectiveRuntimeConfig.minSuccessRate;

  // 跳闸原因优先级：上游确证 > 半开探测失败（沿用原因）> 成功率推断。
  // 成功即闭合；neutral 不改变熔断状态。
  const tripReason: RoutePathDisabledReason | undefined =
    meta?.confirmedUnavailable ??
    (outcome === 'failure'
      ? halfOpen
        ? existing!.disabledReason
        : shouldDisable
          ? 'success_rate_below_threshold'
          : undefined
      : undefined);
  const disableStreak = tripReason
    ? tripReason === existing?.disabledReason
      ? (existing?.disableStreak ?? 0) + 1
      : 1
    : outcome === 'success'
      ? undefined
      : existing?.disableStreak;
  const nextDisabledUntil = tripReason
    ? now +
      Math.min(
        ladderMs(ROUTE_PATH_DISABLE_LADDER_MINUTES, disableStreak!),
        effectiveRuntimeConfig.disableDurationMinutes
      ) *
        60 *
        1000
    : outcome === 'success'
      ? undefined
      : stillDisabledUntil;
  const nextDisabledReason =
    tripReason ?? (outcome === 'success' ? undefined : existing?.disabledReason);

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
    disabledUntil: nextDisabledUntil,
    disabledReason: nextDisabledReason,
    disableStreak,
    lastOutcome: preservePostInvalidationSuccess ? existing?.lastOutcome : outcome,
    lastStatusCode: meta?.statusCode,
    lastLatencyMs: meta?.latencyMs,
    lastError: meta?.error,
    lastUsedAt: now,
    lastSuccessAt:
      outcome === 'success' && !preservePostInvalidationSuccess ? now : existing?.lastSuccessAt,
    lastSuccessRequestStartedAt:
      outcome === 'success' && !preservePostInvalidationSuccess
        ? requestSelectionStartedAt
        : existing?.lastSuccessRequestStartedAt,
    lastFailureAt: outcome === 'failure' ? now : existing?.lastFailureAt,
    affinitySuppressedUntil,
    affinitySuppressedAt,
    updatedAt: now,
  };

  routing.routePathStates[stateKey] = nextState;
  routePathStatesDirty = true;
  scheduleFlush();
  return nextState;
}

/**
 * 候选通道排序：完全由用户配置的站点/Key 优先级与原始顺序决定，
 * 健康度不参与排序（不健康路径由熔断器直接剔除，而不是靠评分下沉）。
 */
export function sortChannelsByScore<T extends RouteChannelKey>(channels: T[]): T[] {
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

    // 字典序稳定排序
    return buildStatsKey(a).localeCompare(buildStatsKey(b));
  });
}
