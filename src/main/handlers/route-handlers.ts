/**
 * 路由代理 IPC handlers
 * 输入: IPC 调用 (route:* 命名空间)
 * 输出: IPC 响应 { success, data?, error? }
 * 定位: 通信层 - 路由规则/模型注册表/端点测试/统计分析/服务器控制
 */

import { ipcMain } from 'electron';
import { randomBytes } from 'crypto';
import Logger from '../utils/logger';
import { unifiedConfigManager } from '../unified-config-manager';
import { startProxyServer, stopProxyServer, getProxyStatus } from '../route-proxy-service';
import * as modelRegistry from '../route-model-registry-service';
import * as analytics from '../route-analytics-service';
import {
  getEndpointTestState,
  runEndpointTest,
  saveEndpointTestSelection,
} from '../endpoint-test-service';
import { runHealthCheck } from '../route-health-service';
import { getHistoryBuckets } from '../route-history-service';
import {
  archiveRouteInstance,
  cancelArmedRouteInstance,
  clearRouteSessionActivities,
  closeRouteInstance,
  createArmedRouteInstance,
  listRouteInstances,
  listRouteSessionActivities,
  listRouteSessionCandidates,
  mergeRouteSessionRecords,
  normalizeRouteInstanceCollections,
  rollbackRouteSessionRule,
  updateRouteInstance,
  type RouteSessionListScope,
} from '../route-session-service';
import type {
  RouteAnalyticsObjectStatsQuery,
  RouteAnalyticsWindowQuery,
  RoutePathStateResetParams,
  RouteRule,
  RouteRequestLogQuery,
  RouteHistoryBucketsQuery,
  EndpointTestSelectionInput,
  EndpointTestTarget,
  RouteSessionOverride,
  RouteSessionExtractionRule,
  RouteInstanceUpdate,
} from '../../shared/types/route-proxy';
import { scanSavedSessionRecordsWithDiagnostics } from '../config-file-profile-service';
import { routeStateAffinityService } from '../route-state-affinity-service';

const log = Logger.scope('RouteHandlers');

const ok = <T>(data?: T) => ({ success: true, data });
const err = (msg: string) => ({ success: false, error: msg });

export function registerRouteHandlers() {
  // ============= 配置与服务器 =============

  ipcMain.handle('route:get-config', async () => {
    try {
      const routing = unifiedConfigManager.getRoutingConfig();
      // 返回轻量配置（不含完整 history/buckets）
      return ok({
        server: routing.server,
        rules: routing.rules,
        cliModelSelections: routing.cliModelSelections,
        cliThinkingEffortSelections: routing.cliThinkingEffortSelections,
        sessionRouting: routing.sessionRouting,
        stats: routing.stats,
        routePathStates: routing.routePathStates,
        health: routing.health,
        modelRegistry: routing.modelRegistry,
        analytics: {
          config: routing.analytics.config,
        },
      });
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:save-server-config', async (_, updates) => {
    try {
      await unifiedConfigManager.updateRouteServerConfig(updates);
      return ok();
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:get-runtime-status', async () => {
    try {
      return ok(getProxyStatus());
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:start-server', async () => {
    try {
      await startProxyServer();
      return ok();
    } catch (e: any) {
      log.error('start server failed:', e);
      return err(e.message);
    }
  });

  ipcMain.handle('route:stop-server', async () => {
    try {
      await stopProxyServer();
      return ok();
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:regenerate-api-key', async () => {
    try {
      const newKey = `sk-route-${randomBytes(16).toString('hex')}`;
      await unifiedConfigManager.updateRouteServerConfig({ unifiedApiKey: newKey });
      return ok({ unifiedApiKey: newKey });
    } catch (e: any) {
      return err(e.message);
    }
  });

  // ============= 路由规则 =============

  ipcMain.handle('route:list-rules', async () => {
    try {
      return ok(unifiedConfigManager.getRoutingConfig().rules);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:upsert-rule', async (_, rule: RouteRule) => {
    try {
      const saved = await unifiedConfigManager.upsertRouteRule(rule);
      return ok(saved);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:delete-rule', async (_, ruleId: string) => {
    try {
      const deleted = await unifiedConfigManager.deleteRouteRule(ruleId);
      return ok({ deleted });
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:list-stats', async () => {
    try {
      return ok(unifiedConfigManager.getRoutingConfig().stats);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:reset-stats', async (_, ruleId?: string) => {
    try {
      await unifiedConfigManager.resetRouteStats(ruleId);
      return ok();
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:reset-path-states', async (_, params?: RoutePathStateResetParams) => {
    try {
      const cleared = await unifiedConfigManager.resetRoutePathStates(params);
      return ok({ cleared });
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:get-health', async () => {
    try {
      return ok(unifiedConfigManager.getRoutingConfig().health);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:run-health-check', async () => {
    try {
      await runHealthCheck();
      return ok();
    } catch (e: any) {
      return err(e.message);
    }
  });

  // ============= CLI 模型选择 =============

  ipcMain.handle('route:save-cli-model-selections', async (_, params) => {
    try {
      const result = await unifiedConfigManager.updateRouteCliModelSelections(params.selections);
      return ok(result);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:save-cli-thinking-effort-selections', async (_, params) => {
    try {
      const result = await unifiedConfigManager.updateRouteCliThinkingEffortSelections(
        params.selections
      );
      return ok(result);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:list-sessions', async (_, scope?: RouteSessionListScope) => {
    try {
      const validScopes: RouteSessionListScope[] = ['active', 'recent', 'history', 'all'];
      const normalizedScope = validScopes.includes(scope as RouteSessionListScope)
        ? (scope as RouteSessionListScope)
        : 'active';
      await unifiedConfigManager.pruneExpiredRouteSessionOverrides();
      const sessionRouting = unifiedConfigManager.getRoutingConfig().sessionRouting;
      if (sessionRouting) {
        try {
          const scan = await scanSavedSessionRecordsWithDiagnostics();
          mergeRouteSessionRecords(
            scan.records,
            sessionRouting,
            Date.now(),
            new Set(
              scan.diagnostics
                .filter(diagnostic => diagnostic.status !== 'error')
                .map(diagnostic => diagnostic.connectorId)
            )
          );
        } catch {
          log.warn('Session record connector scan failed');
        }
      }
      return ok(
        sessionRouting
          ? listRouteSessionActivities(sessionRouting, Date.now(), normalizedScope)
          : []
      );
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:list-route-instances', async () => {
    try {
      const config = unifiedConfigManager.getRoutingConfig().sessionRouting;
      if (!config) return ok([]);
      if (normalizeRouteInstanceCollections(config)) await unifiedConfigManager.saveConfig();
      return ok(listRouteInstances(config));
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle(
    'route:create-armed-route-instance',
    async (_, input: { modelId: string; reasoningEffort: string }) => {
      try {
        const config = unifiedConfigManager.getRoutingConfig().sessionRouting;
        if (!config) throw new Error('会话路由配置不可用');
        const instance = createArmedRouteInstance(config, input.modelId, input.reasoningEffort);
        await unifiedConfigManager.saveConfig();
        return ok(instance);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  ipcMain.handle(
    'route:update-route-instance',
    async (_, instanceId: string, updates: RouteInstanceUpdate) => {
      try {
        const config = unifiedConfigManager.getRoutingConfig().sessionRouting;
        if (!config) throw new Error('会话路由配置不可用');
        const instance = updateRouteInstance(config, instanceId, updates);
        await unifiedConfigManager.saveConfig();
        return ok(instance);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  ipcMain.handle('route:close-route-instance', async (_, instanceId: string) => {
    try {
      const config = unifiedConfigManager.getRoutingConfig().sessionRouting;
      if (!config) throw new Error('会话路由配置不可用');
      const instance = closeRouteInstance(config, instanceId);
      await unifiedConfigManager.saveConfig();
      return ok(instance);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:cancel-armed-route-instance', async (_, instanceId: string) => {
    try {
      const config = unifiedConfigManager.getRoutingConfig().sessionRouting;
      if (!config) throw new Error('会话路由配置不可用');
      const instance = cancelArmedRouteInstance(config, instanceId);
      await unifiedConfigManager.saveConfig();
      return ok(instance);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:archive-route-instance', async (_, instanceId: string) => {
    try {
      const config = unifiedConfigManager.getRoutingConfig().sessionRouting;
      if (!config) throw new Error('会话路由配置不可用');
      const archived = archiveRouteInstance(config, instanceId);
      if (archived) await unifiedConfigManager.saveConfig();
      return ok({ archived });
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:upsert-session-override', async (_, override: RouteSessionOverride) => {
    try {
      return ok(await unifiedConfigManager.upsertRouteSessionOverride(override));
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:delete-session-override', async (_, key: string) => {
    try {
      return ok({ deleted: await unifiedConfigManager.deleteRouteSessionOverride(key) });
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:preview-profile-state-clear', async (_, profileId: string) => {
    try {
      if (!profileId) throw new Error('配置卡片 ID 不能为空');
      return ok(await routeStateAffinityService.summarizeProfile(profileId));
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:clear-profile-state', async (_, profileId: string) => {
    try {
      if (!profileId) throw new Error('配置卡片 ID 不能为空');
      return ok({ removed: await routeStateAffinityService.removeByProfile(profileId) });
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:clear-session-activity', async (_, key?: string) => {
    clearRouteSessionActivities(key);
    return ok();
  });

  ipcMain.handle('route:list-session-rules', async () => {
    try {
      return ok(unifiedConfigManager.getRoutingConfig().sessionRouting?.extractionRules || []);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:upsert-session-rule', async (_, rule: RouteSessionExtractionRule) => {
    try {
      return ok(await unifiedConfigManager.upsertRouteSessionRule(rule));
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:delete-session-rule', async (_, ruleId: string) => {
    try {
      return ok({ deleted: await unifiedConfigManager.deleteRouteSessionRule(ruleId) });
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:rollback-session-rule', async (_, ruleId: string, version: number) => {
    try {
      const rule = unifiedConfigManager
        .getRoutingConfig()
        .sessionRouting?.extractionRules.find(item => item.id === ruleId);
      if (!rule) throw new Error('会话规则不存在');
      return ok(
        await unifiedConfigManager.upsertRouteSessionRule(rollbackRouteSessionRule(rule, version))
      );
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:list-session-candidates', async () => ok(listRouteSessionCandidates()));

  ipcMain.handle('route:update-session-settings', async (_, settings) => {
    try {
      await unifiedConfigManager.updateRouteSessionSettings(settings);
      return ok();
    } catch (e: any) {
      return err(e.message);
    }
  });

  // ============= 模型注册表 =============

  ipcMain.handle('route:get-model-registry', async () => {
    try {
      return ok(modelRegistry.getModelRegistry());
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:rebuild-model-registry', async (_, params?: { force?: boolean }) => {
    try {
      const result = await modelRegistry.rebuildModelRegistry(params?.force);
      return ok(result);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:sync-model-registry-sources', async (_, params?: { force?: boolean }) => {
    try {
      const result = await modelRegistry.syncModelRegistrySources(params?.force);
      return ok(result);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:upsert-model-mapping-override', async (_, override) => {
    try {
      const result = await modelRegistry.upsertModelMappingOverride(override);
      return ok(result);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:upsert-model-display-item', async (_, displayItem) => {
    try {
      const result = await modelRegistry.upsertModelDisplayItem(displayItem);
      return ok(result);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle(
    'route:delete-model-display-item',
    async (_, params: { displayItemId: string }) => {
      try {
        const result = await modelRegistry.deleteModelDisplayItem(params.displayItemId);
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  ipcMain.handle('route:delete-model-mapping-override', async (_, params) => {
    try {
      const deleted = await modelRegistry.deleteModelMappingOverride(params.overrideId);
      return ok({ deleted });
    } catch (e: any) {
      return err(e.message);
    }
  });

  // ============= 端点测试 =============

  ipcMain.handle('endpoint-test:get-state', async (_, target: EndpointTestTarget) => {
    try {
      return ok(await getEndpointTestState(target));
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('endpoint-test:save-selection', async (_, input: EndpointTestSelectionInput) => {
    try {
      return ok(await saveEndpointTestSelection(input));
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('endpoint-test:run', async (_, input: EndpointTestSelectionInput) => {
    try {
      return ok(await runEndpointTest(input));
    } catch (e: any) {
      return err(e.message);
    }
  });

  // ============= 统计分析 =============

  ipcMain.handle('route:get-analytics-summary', async (_, params: RouteAnalyticsWindowQuery) => {
    try {
      return ok(analytics.getAnalyticsSummary(params));
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle(
    'route:get-analytics-distribution',
    async (_, params: RouteAnalyticsWindowQuery) => {
      try {
        return ok(analytics.getAnalyticsDistribution(params));
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  ipcMain.handle('route:get-analytics-overview', async (_, params: RouteAnalyticsWindowQuery) => {
    try {
      return ok(analytics.getAnalyticsOverview(params));
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:get-object-stats', async (_, params: RouteAnalyticsObjectStatsQuery) => {
    try {
      return ok(analytics.getRouteObjectStats(params));
    } catch (e: unknown) {
      return err(e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle('route:reset-analytics', async (_, params?) => {
    try {
      await analytics.resetAnalytics(params);
      return ok();
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:get-request-logs', async (_, params?: RouteRequestLogQuery) => {
    try {
      return ok(analytics.getRouteRequestLogs(params));
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:clear-request-logs', async () => {
    try {
      analytics.clearRouteRequestLogs();
      return ok();
    } catch (e: any) {
      return err(e.message);
    }
  });

  // ============= History 时间桶聚合 =============

  ipcMain.handle('route:getHistoryBuckets', async (_, query: RouteHistoryBucketsQuery) => {
    try {
      const buckets = getHistoryBuckets(query);
      return ok(buckets);
    } catch (e: any) {
      return err(e.message);
    }
  });

  // ============= 站点日志查询 =============

  ipcMain.handle(
    'route:fetch-latest-log',
    async (_, params: { siteId: string; model?: string }) => {
      try {
        const config = unifiedConfigManager.exportConfigSync();
        if (!config) return err('Config not loaded');

        const site = config.sites.find(s => s.id === params.siteId);
        if (!site) return err('Site not found');

        const siteAccounts = config.accounts.filter(a => a.site_id === site.id);
        const account =
          siteAccounts.find(a => a.account_name === '默认账户') || siteAccounts[0] || null;
        const authToken = account?.access_token || site.access_token;
        const userId = account?.user_id || site.user_id;
        if (!authToken) return err('No auth token');

        const { getAllUserIdHeaders } = await import('../../shared/utils/headers');
        const { httpGet } = await import('../utils/http-client');

        const baseUrl = site.url.replace(/\/$/, '');
        const queryParams = new URLSearchParams({ p: '0', size: '1' });
        if (params.model) queryParams.set('model_name', params.model);
        const url = `${baseUrl}/api/log/self?${queryParams}`;

        const headers: Record<string, string> = {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        };
        if (userId) Object.assign(headers, getAllUserIdHeaders(userId));

        const response = await httpGet(url, { timeout: 10000, headers });
        const data = response.data;

        // 归一化日志数据
        const raw = data?.data;
        let logItem: any = null;
        if (Array.isArray(raw)) logItem = raw[0];
        else if (Array.isArray(raw?.data)) logItem = raw.data[0];
        else if (Array.isArray(raw?.items)) logItem = raw.items[0];

        if (!logItem) return ok(null);

        return ok({
          model: logItem.model_name || logItem.model,
          createdAt: logItem.created_at ? logItem.created_at * 1000 : logItem.created_time,
          promptTokens: logItem.prompt_tokens,
          completionTokens: logItem.completion_tokens,
          quota: logItem.quota,
          duration: logItem.duration || logItem.use_time,
        });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  log.info('Route handlers registered');
}
