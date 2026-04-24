/**
 * 路由代理 IPC handlers
 * 输入: IPC 调用 (route:* 命名空间)
 * 输出: IPC 响应 { success, data?, error? }
 * 定位: 通信层 - 路由规则/模型注册表/CLI 探测/统计分析/服务器控制
 */

import { ipcMain } from 'electron';
import { randomBytes } from 'crypto';
import Logger from '../utils/logger';
import { unifiedConfigManager } from '../unified-config-manager';
import { startProxyServer, stopProxyServer, getProxyStatus } from '../route-proxy-service';
import * as modelRegistry from '../route-model-registry-service';
import * as cliProbe from '../route-cli-probe-service';
import * as analytics from '../route-analytics-service';
import { runHealthCheck } from '../route-health-service';
import type {
  RouteRule,
  RouteVendorPriorityConfig,
  RouteModelVendor,
} from '../../shared/types/route-proxy';

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
        stats: routing.stats,
        health: routing.health,
        modelRegistry: routing.modelRegistry,
        cliProbe: {
          config: routing.cliProbe.config,
          latest: routing.cliProbe.latest,
        },
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

  ipcMain.handle(
    'route:save-vendor-priority-config',
    async (_, params: { vendor: RouteModelVendor; priorityConfig: RouteVendorPriorityConfig }) => {
      try {
        const result = await modelRegistry.updateVendorPriorityConfig(
          params.vendor,
          params.priorityConfig
        );
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

  // ============= CLI 探测 =============

  ipcMain.handle('route:save-cli-probe-config', async (_, updates) => {
    try {
      const result = await cliProbe.saveCliProbeConfig(updates);
      return ok(result);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:run-cli-probe-now', async (_, params?) => {
    try {
      const result = await cliProbe.runCliProbeNow(params);
      return ok(result);
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:get-cli-probe-latest', async (_, params?) => {
    try {
      return ok(cliProbe.getCliProbeLatest(params));
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:get-cli-probe-history', async (_, params) => {
    try {
      return ok(cliProbe.getCliProbeHistory(params));
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:get-cli-probe-view', async (_, params) => {
    try {
      return ok(cliProbe.getCliProbeView(params));
    } catch (e: any) {
      return err(e.message);
    }
  });

  // ============= 统计分析 =============

  ipcMain.handle('route:get-analytics-summary', async (_, params) => {
    try {
      return ok(analytics.getAnalyticsSummary(params));
    } catch (e: any) {
      return err(e.message);
    }
  });

  ipcMain.handle('route:get-analytics-distribution', async (_, params) => {
    try {
      return ok(analytics.getAnalyticsDistribution(params));
    } catch (e: any) {
      return err(e.message);
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

  // ============= 站点日志查询 =============

  ipcMain.handle(
    'route:fetch-latest-log',
    async (_, params: { siteId: string; model?: string }) => {
      try {
        const config = unifiedConfigManager.exportConfigSync();
        if (!config) return err('Config not loaded');

        const site = config.sites.find(s => s.id === params.siteId);
        if (!site) return err('Site not found');

        const siteAccounts = config.accounts.filter(
          a => a.site_id === site.id && (!a.status || a.status === 'active')
        );
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
