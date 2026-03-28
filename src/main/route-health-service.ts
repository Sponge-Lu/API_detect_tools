/**
 * 路由健康投影服务
 * 输入: cliProbe.latest (最新探测快照)
 * 输出: RouteChannelHealth 投影缓存
 * 定位: 服务层 - 从 probe latest 投影轻量健康态，供选路评分读取
 */

import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';
import { resolveChannels } from './route-channel-resolver';
import { getCliProbeLatest } from './route-cli-probe-service';
import type { RouteChannelHealth } from '../shared/types/route-proxy';
import { buildStatsKey, buildProbeKey } from '../shared/types/route-proxy';

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
 * 基于 cliProbe.latest 重建健康态投影
 */
export async function refreshRouteHealthProjection(): Promise<Record<string, RouteChannelHealth>> {
  const routing = unifiedConfigManager.getRoutingConfig();
  const latestList = getCliProbeLatest();
  const healthResults: RouteChannelHealth[] = [];

  // 直接从 probe latest 投影，无需遍历规则（probe latest 已覆盖所有探测维度）
  for (const probe of latestList) {
    // 为每条匹配此 cliType 的启用规则生成通道级投影
    for (const rule of routing.rules) {
      if (!rule.enabled || rule.cliType !== probe.cliType) continue;
      const channels = resolveChannels(rule, probe.canonicalModel);
      for (const ch of channels) {
        if (ch.siteId !== probe.siteId || ch.accountId !== probe.accountId) continue;
        healthResults.push({
          ...ch,
          cliType: probe.cliType,
          healthy: probe.healthy,
          canonicalModel: probe.canonicalModel,
          rawModel: probe.rawModel,
          endpointPingMs: probe.lastSample.endpointPingMs,
          firstByteLatencyMs: probe.lastSample.firstByteLatencyMs,
          totalLatencyMs: probe.lastSample.totalLatencyMs,
          testedAt: probe.lastSample.testedAt,
          error: probe.lastSample.error,
        });
      }
    }
  }

  if (healthResults.length > 0) {
    await unifiedConfigManager.updateRouteHealth(healthResults);
  }

  log.info(`Health projection refreshed: ${healthResults.length} channels`);
  return unifiedConfigManager.getRoutingConfig().health;
}

/** 执行健康检测（兼容旧接口，实际委托 refreshProjection） */
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
