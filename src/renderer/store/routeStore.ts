/**
 * 路由代理 Zustand Store（扩展版）
 * 管理路由配置、模型注册表和统计分析
 */

import { create } from 'zustand';
import type {
  RoutingConfig,
  RouteRule,
  RouteProxyServerConfig,
  RouteModelRegistryConfig,
  RouteModelMappingOverride,
  RouteModelDisplayItem,
  RouteCliType,
  RoutePathStateResetParams,
} from '../../shared/types/route-proxy';
import { sessionEventLog } from '../services/sessionEventLog';

/** 路由页 Sub-Tab */
export type RouteSubTab = 'redirection' | 'usability' | 'proxystats';

interface RouteState {
  config: RoutingConfig | null;
  loading: boolean;
  serverRunning: boolean;
  activeSubTab: RouteSubTab;

  // Actions - 配置
  fetchConfig: () => Promise<void>;
  refreshRuntimeState: () => Promise<void>;
  fetchRuntimeStatus: () => Promise<void>;
  saveServerConfig: (updates: Partial<RouteProxyServerConfig>) => Promise<void>;
  setActiveSubTab: (tab: RouteSubTab) => void;

  // Actions - 规则
  upsertRule: (rule: RouteRule) => Promise<RouteRule | null>;
  deleteRule: (ruleId: string) => Promise<boolean>;
  resetStats: (ruleId?: string) => Promise<void>;
  resetPathStates: (params?: RoutePathStateResetParams) => Promise<number | null>;

  // Actions - 服务器
  startServer: () => Promise<boolean>;
  stopServer: () => Promise<boolean>;
  runHealthCheck: () => Promise<void>;
  regenerateApiKey: () => Promise<string | null>;

  // Actions - 模型注册表
  fetchModelRegistry: () => Promise<RouteModelRegistryConfig | null>;
  rebuildModelRegistry: (force?: boolean) => Promise<RouteModelRegistryConfig | null>;
  syncModelRegistrySources: (force?: boolean) => Promise<RouteModelRegistryConfig | null>;
  upsertMappingOverride: (
    override: RouteModelMappingOverride
  ) => Promise<RouteModelMappingOverride | null>;
  upsertDisplayItem: (
    displayItem: RouteModelDisplayItem
  ) => Promise<RouteModelRegistryConfig | null>;
  deleteDisplayItem: (displayItemId: string) => Promise<RouteModelRegistryConfig | null>;
  deleteMappingOverride: (overrideId: string) => Promise<boolean>;

  // Actions - CLI 模型选择
  saveCliModelSelections: (
    selections: Partial<Record<RouteCliType, string | null>>
  ) => Promise<void>;
  saveCliThinkingEffortSelections: (
    selections: Partial<RoutingConfig['cliThinkingEffortSelections']>
  ) => Promise<void>;

}

function mergeModelRegistryIntoRouteConfig(
  config: RoutingConfig | null,
  modelRegistry: RouteModelRegistryConfig
): RoutingConfig | null {
  return config ? { ...config, modelRegistry } : null;
}

export const useRouteStore = create<RouteState>((set, get) => ({
  config: null,
  loading: false,
  serverRunning: false,
  activeSubTab: (localStorage.getItem('route-sub-tab') as RouteSubTab) || 'redirection',
  fetchConfig: async () => {
    set({ loading: true });
    try {
      const res = await window.electronAPI.route?.getConfig();
      if (res?.success && res.data) {
        set({ config: res.data });
      }
    } finally {
      set({ loading: false });
    }
  },

  refreshRuntimeState: async () => {
    try {
      const res = await window.electronAPI.route?.getConfig();
      if (!res?.success || !res.data) {
        return;
      }

      set(state => {
        if (!state.config) {
          return { config: res.data };
        }

        return {
          config: {
            ...state.config,
            server: res.data.server,
            stats: res.data.stats,
            routePathStates: res.data.routePathStates,
            routeEndpointCapabilities: res.data.routeEndpointCapabilities,
            health: res.data.health,
            analytics: res.data.analytics,
          },
        };
      });
    } catch {
      /* keep the cached runtime view */
    }
  },

  fetchRuntimeStatus: async () => {
    try {
      const res = await window.electronAPI.route?.getRuntimeStatus();
      if (res?.success && res.data) {
        set({ serverRunning: res.data.running });
      }
    } catch {
      /* ignore */
    }
  },

  saveServerConfig: async updates => {
    const res = await window.electronAPI.route?.saveServerConfig(updates);
    if (res?.success) {
      await get().fetchConfig();
      sessionEventLog.success('route', '路由服务器配置已保存');
    } else {
      sessionEventLog.error('route', '路由服务器配置保存失败');
    }
  },

  setActiveSubTab: tab => {
    localStorage.setItem('route-sub-tab', tab);
    set({ activeSubTab: tab });
  },

  upsertRule: async rule => {
    const res = await window.electronAPI.route?.upsertRule(rule);
    if (res?.success && res.data) {
      await get().fetchConfig();
      sessionEventLog.success('route', `路由规则已保存：${rule.name || rule.id}`);
      return res.data;
    }
    sessionEventLog.error('route', `路由规则保存失败：${rule.name || rule.id}`);
    return null;
  },

  deleteRule: async ruleId => {
    const res = await window.electronAPI.route?.deleteRule(ruleId);
    if (res?.success) {
      await get().fetchConfig();
      sessionEventLog.success('route', `路由规则已删除：${ruleId}`);
      return true;
    }
    sessionEventLog.error('route', `路由规则删除失败：${ruleId}`);
    return false;
  },

  resetStats: async ruleId => {
    await window.electronAPI.route?.resetStats(ruleId);
    await get().fetchConfig();
    sessionEventLog.info('route', ruleId ? `已重置规则统计：${ruleId}` : '已重置全部路由统计');
  },

  resetPathStates: async params => {
    const res = await window.electronAPI.route?.resetPathStates(params);
    if (res?.success) {
      await get().fetchConfig();
      const cleared = res.data?.cleared ?? 0;
      sessionEventLog.info(
        'route',
        params?.canonicalModel
          ? `已恢复路由路径：${params.canonicalModel}（${cleared}）`
          : params?.routeRuleId
            ? `已恢复路由规则路径：${params.routeRuleId}（${cleared}）`
            : `已恢复全部路由路径（${cleared}）`
      );
      return cleared;
    }

    sessionEventLog.error('route', '路由路径恢复失败');
    return null;
  },

  startServer: async () => {
    const res = await window.electronAPI.route?.startServer();
    if (res?.success) {
      set({ serverRunning: true });
      sessionEventLog.success('route', '代理服务器已启动');
      return true;
    }
    sessionEventLog.error('route', '代理服务器启动失败');
    return false;
  },

  stopServer: async () => {
    const res = await window.electronAPI.route?.stopServer();
    if (res?.success) {
      set({ serverRunning: false });
      sessionEventLog.info('route', '代理服务器已停止');
      return true;
    }
    sessionEventLog.error('route', '代理服务器停止失败');
    return false;
  },

  runHealthCheck: async () => {
    await window.electronAPI.route?.runHealthCheck();
    await get().fetchConfig();
    sessionEventLog.info('route', '已执行路由健康检查');
  },

  regenerateApiKey: async () => {
    const res = await window.electronAPI.route?.regenerateApiKey();
    if (res?.success && res.data?.unifiedApiKey) {
      await get().fetchConfig();
      sessionEventLog.success('route', '路由 API Key 已重新生成');
      return res.data.unifiedApiKey;
    }
    sessionEventLog.error('route', '路由 API Key 重新生成失败');
    return null;
  },

  // 模型注册表
  fetchModelRegistry: async () => {
    const res = await window.electronAPI.route?.getModelRegistry();
    if (res?.success && res.data) {
      const needsFullConfig = !get().config;
      set(state => ({
        config: mergeModelRegistryIntoRouteConfig(state.config, res.data),
      }));
      if (needsFullConfig) {
        await get().fetchConfig();
      }
      return res.data;
    }
    return null;
  },

  rebuildModelRegistry: async force => {
    const res = await window.electronAPI.route?.rebuildModelRegistry({ force });
    if (res?.success && res.data) {
      const needsFullConfig = !get().config;
      set(state => ({
        config: mergeModelRegistryIntoRouteConfig(state.config, res.data),
      }));
      if (needsFullConfig) {
        await get().fetchConfig();
      }
      sessionEventLog.success('route', force ? '已强制重建模型重定向目录' : '已重建模型重定向目录');
      return res.data;
    }
    sessionEventLog.error('route', '模型重定向目录重建失败');
    return null;
  },

  syncModelRegistrySources: async force => {
    const res = await window.electronAPI.route?.syncModelRegistrySources({ force });
    if (res?.success && res.data) {
      const needsFullConfig = !get().config;
      set(state => ({
        config: mergeModelRegistryIntoRouteConfig(state.config, res.data),
      }));
      if (needsFullConfig) {
        await get().fetchConfig();
      }
      sessionEventLog.success('route', force ? '已强制同步模型来源' : '已同步模型来源');
      return res.data;
    }
    sessionEventLog.error('route', '模型来源同步失败');
    return null;
  },

  upsertMappingOverride: async override => {
    const res = await window.electronAPI.route?.upsertModelMappingOverride(override);
    if (res?.success) {
      await get().fetchModelRegistry();
      sessionEventLog.success('route', `模型重定向已保存：${override.sourceKey}`);
      return res.data;
    }
    sessionEventLog.error('route', `模型重定向保存失败：${override.sourceKey}`);
    return null;
  },

  upsertDisplayItem: async displayItem => {
    const res = await window.electronAPI.route?.upsertModelDisplayItem(displayItem);
    if (res?.success && res.data) {
      const needsFullConfig = !get().config;
      set(state => ({
        config: mergeModelRegistryIntoRouteConfig(state.config, res.data),
      }));
      if (needsFullConfig) {
        await get().fetchConfig();
      }
      sessionEventLog.success('route', `重定向显示项已保存：${displayItem.canonicalName}`);
      return res.data;
    }
    sessionEventLog.error('route', `重定向显示项保存失败：${displayItem.canonicalName}`);
    return null;
  },

  deleteDisplayItem: async displayItemId => {
    const res = await window.electronAPI.route?.deleteModelDisplayItem(displayItemId);
    if (res?.success && res.data) {
      const needsFullConfig = !get().config;
      set(state => ({
        config: mergeModelRegistryIntoRouteConfig(state.config, res.data),
      }));
      if (needsFullConfig) {
        await get().fetchConfig();
      }
      sessionEventLog.success('route', `重定向显示项已删除：${displayItemId}`);
      return res.data;
    }

    sessionEventLog.error('route', `重定向显示项删除失败：${displayItemId}`);
    return null;
  },

  deleteMappingOverride: async overrideId => {
    const res = await window.electronAPI.route?.deleteModelMappingOverride(overrideId);
    if (res?.success) {
      await get().fetchModelRegistry();
      sessionEventLog.success('route', `模型重定向已删除：${overrideId}`);
      return true;
    }
    sessionEventLog.error('route', `模型重定向删除失败：${overrideId}`);
    return false;
  },

  // CLI 模型选择
  saveCliModelSelections: async selections => {
    await window.electronAPI.route?.saveCliModelSelections(selections);
    await get().fetchConfig();
    sessionEventLog.success('route', 'CLI 默认模型已更新');
  },

  saveCliThinkingEffortSelections: async selections => {
    await window.electronAPI.route?.saveCliThinkingEffortSelections(selections);
    await get().fetchConfig();
    sessionEventLog.success('route', 'CLI 思考强度已更新');
  },

}));
