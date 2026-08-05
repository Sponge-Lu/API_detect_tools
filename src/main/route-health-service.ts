/**
 * 路由健康投影服务
 * 输入: routing.stats (真实路由请求统计)
 * 输出: RouteChannelHealth 投影缓存
 * 定位: 服务层 - 从真实路由结果投影轻量健康态，供选路评分读取
 */

import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';
import type { RouteChannelHealth } from '../shared/types/route-proxy';
import { buildStatsKey } from '../shared/types/route-proxy';

const log = Logger.scope('RouteHealthService');

let healthTimer: NodeJS.Timeout | null = null;

/** 获取健康态投影缓存 */
export function getRouteHealthSnapshot(): Record<string, RouteChannelHealth> {
  return unifiedConfigManager.getRoutingConfig().health;
}

/** 查询单个通道健康态 */
export function getChannelHealth(params: {
  routeRuleId: string;
  siteId: string;
  accountId: string;
  apiKeyId: string;
}): RouteChannelHealth | null {
  const key = buildStatsKey(params);
  return unifiedConfigManager.getRoutingConfig().health[key] || null;
}

/**
 * 基于真实路由请求统计重建健康态投影。
 */
export async function refreshRouteHealthProjection(): Promise<Record<string, RouteChannelHealth>> {
  const routing = unifiedConfigManager.getRoutingConfig();
  const healthResults = Object.values(routing.stats)
    .filter(stats => Boolean(stats.cliType && stats.lastUsedAt))
    .map<RouteChannelHealth>(stats => ({
      routeRuleId: stats.routeRuleId,
      siteId: stats.siteId,
      accountId: stats.accountId,
      apiKeyId: stats.apiKeyId,
      cliType: stats.cliType!,
      targetProtocol: stats.targetProtocol,
      healthy:
        Boolean(stats.lastSuccessAt) &&
        (!stats.lastFailureAt || stats.lastSuccessAt! >= stats.lastFailureAt),
      canonicalModel: stats.lastCanonicalModel,
      rawModel: stats.lastResolvedModel,
      firstByteLatencyMs: stats.lastFirstByteLatencyMs,
      totalLatencyMs: stats.lastLatencyMs,
      testedAt: stats.lastUsedAt,
      error:
        stats.lastFailureAt && (!stats.lastSuccessAt || stats.lastFailureAt > stats.lastSuccessAt)
          ? stats.lastStatusCode
            ? `HTTP ${stats.lastStatusCode}`
            : '最近一次路由请求失败'
          : undefined,
    }));

  routing.health = {};
  await unifiedConfigManager.updateRouteHealth(healthResults);

  log.info(`Health projection refreshed: ${healthResults.length} channels`);
  return unifiedConfigManager.getRoutingConfig().health;
}

/** 重新计算健康投影，不发送测试请求。 */
export async function runHealthCheck(): Promise<void> {
  await refreshRouteHealthProjection();
}

export function startHealthCheckTimer(): void {
  stopHealthCheckTimer();
  const routing = unifiedConfigManager.getRoutingConfig();
  const intervalMs = (routing.server.healthCheckIntervalMinutes || 60) * 60 * 1000;
  healthTimer = setInterval(async () => {
    try {
      await refreshRouteHealthProjection();
    } catch (err) {
      log.error('Scheduled health projection failed:', err);
    }
  }, intervalMs);
  log.info(
    `Health projection timer started, interval: ${routing.server.healthCheckIntervalMinutes}min`
  );
}

export function stopHealthCheckTimer(): void {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}
