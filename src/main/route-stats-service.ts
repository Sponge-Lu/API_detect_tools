/**
 * 路由成功率统计服务
 * 内存级批量 flush（3-5秒），拉普拉斯平滑评分
 */

import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';
import type { RouteChannelKey, RouteChannelStats, RouteOutcome } from '../shared/types/route-proxy';
import { buildStatsKey } from '../shared/types/route-proxy';

const log = Logger.scope('RouteStatsService');

/** 等待 flush 的内存缓冲区 */
const pendingUpdates = new Map<string, RouteChannelStats>();
let flushTimer: NodeJS.Timeout | null = null;

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
  key: RouteChannelKey,
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
export function sortChannelsByScore(channels: RouteChannelKey[]): RouteChannelKey[] {
  const routing = unifiedConfigManager.getRoutingConfig();
  return [...channels].sort((a, b) => {
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
