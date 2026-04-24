/**
 * 路由代理 Zustand Store（扩展版）
 * 管理路由配置、模型注册表、CLI 探测、统计分析
 */

import { create } from 'zustand';
import type {
  RoutingConfig,
  RouteRule,
  RouteProxyServerConfig,
  RouteModelRegistryConfig,
  RouteModelMappingOverride,
  RouteModelDisplayItem,
  RouteModelVendor,
  RouteVendorPriorityConfig,
  RouteCliProbeConfig,
  RouteCliProbeLatest,
  RouteCliProbeSample,
  RouteCliProbeSiteView,
  RouteCliType,
} from '../../shared/types/route-proxy';
import type { UnifiedConfig } from '../../shared/types/site';
import { useDetectionStore } from './detectionStore';
import { syncProjectedCliCompatibility } from '../services/cli-compat-projection';
import { sessionEventLog } from '../services/sessionEventLog';

/** 路由页 Sub-Tab */
export type RouteSubTab = 'redirection' | 'usability' | 'proxystats';

type CliProbeTimeRange = '24h' | '7d';

interface RouteState {
  config: RoutingConfig | null;
  loading: boolean;
  serverRunning: boolean;
  activeSubTab: RouteSubTab;

  // CLI 探测数据缓存
  cliProbeHistory: RouteCliProbeSample[];
  cliProbeLatest: RouteCliProbeLatest[];
  cliProbeView: RouteCliProbeSiteView[];
  cliProbeTimeRange: CliProbeTimeRange;
  cliProbeLoaded: boolean;
  cliProbeRequestId: number;
  cliProbeError: string | null;

  // Actions - 配置
  fetchConfig: () => Promise<void>;
  fetchRuntimeStatus: () => Promise<void>;
  saveServerConfig: (updates: Partial<RouteProxyServerConfig>) => Promise<void>;
  setActiveSubTab: (tab: RouteSubTab) => void;

  // Actions - 规则
  upsertRule: (rule: RouteRule) => Promise<RouteRule | null>;
  deleteRule: (ruleId: string) => Promise<boolean>;
  resetStats: (ruleId?: string) => Promise<void>;

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
  saveVendorPriorityConfig: (
    vendor: RouteModelVendor,
    priorityConfig: RouteVendorPriorityConfig
  ) => Promise<RouteModelRegistryConfig | null>;
  deleteMappingOverride: (overrideId: string) => Promise<boolean>;

  // Actions - CLI 模型选择
  saveCliModelSelections: (
    selections: Partial<Record<RouteCliType, string | null>>
  ) => Promise<void>;

  // Actions - CLI 探测
  saveCliProbeConfig: (updates: Partial<RouteCliProbeConfig>) => Promise<void>;
  runProbeNow: (params?: any) => Promise<any>;
  fetchProbeLatest: (params?: any) => Promise<RouteCliProbeLatest[]>;
  fetchCliProbeData: (timeRange: CliProbeTimeRange, force?: boolean) => Promise<void>;
}

export const useRouteStore = create<RouteState>((set, get) => ({
  config: null,
  loading: false,
  serverRunning: false,
  activeSubTab: (localStorage.getItem('route-sub-tab') as RouteSubTab) || 'redirection',
  cliProbeHistory: [],
  cliProbeLatest: [],
  cliProbeView: [],
  cliProbeTimeRange: '24h',
  cliProbeLoaded: false,
  cliProbeRequestId: 0,
  cliProbeError: null,

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
      set(state => ({
        config: state.config ? { ...state.config, modelRegistry: res.data } : null,
      }));
      return res.data;
    }
    return null;
  },

  rebuildModelRegistry: async force => {
    const res = await window.electronAPI.route?.rebuildModelRegistry({ force });
    if (res?.success && res.data) {
      set(state => ({
        config: state.config ? { ...state.config, modelRegistry: res.data } : null,
      }));
      sessionEventLog.success('route', force ? '已强制重建模型重定向目录' : '已重建模型重定向目录');
      return res.data;
    }
    sessionEventLog.error('route', '模型重定向目录重建失败');
    return null;
  },

  syncModelRegistrySources: async force => {
    const res = await window.electronAPI.route?.syncModelRegistrySources({ force });
    if (res?.success && res.data) {
      set(state => ({
        config: state.config ? { ...state.config, modelRegistry: res.data } : null,
      }));
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
      set(state => ({
        config: state.config ? { ...state.config, modelRegistry: res.data } : null,
      }));
      sessionEventLog.success('route', `重定向显示项已保存：${displayItem.canonicalName}`);
      return res.data;
    }
    sessionEventLog.error('route', `重定向显示项保存失败：${displayItem.canonicalName}`);
    return null;
  },

  deleteDisplayItem: async displayItemId => {
    const res = await window.electronAPI.route?.deleteModelDisplayItem(displayItemId);
    if (res?.success && res.data) {
      set(state => ({
        config: state.config ? { ...state.config, modelRegistry: res.data } : null,
      }));
      sessionEventLog.success('route', `重定向显示项已删除：${displayItemId}`);
      return res.data;
    }

    sessionEventLog.error('route', `重定向显示项删除失败：${displayItemId}`);
    return null;
  },

  saveVendorPriorityConfig: async (vendor, priorityConfig) => {
    const res = await window.electronAPI.route?.saveVendorPriorityConfig(vendor, priorityConfig);
    if (res?.success && res.data) {
      set(state => ({
        config: state.config ? { ...state.config, modelRegistry: res.data } : null,
      }));
      sessionEventLog.success('route', `厂商优先级已更新：${vendor}`);
      return res.data;
    }

    sessionEventLog.error('route', `厂商优先级更新失败：${vendor}`);
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

  // CLI 探测
  saveCliProbeConfig: async updates => {
    await window.electronAPI.route?.saveCliProbeConfig(updates);
    await get().fetchConfig();
    sessionEventLog.success('route', 'CLI 可用性检测设置已保存');
  },

  runProbeNow: async params => {
    const res = await window.electronAPI.route?.runCliProbeNow(params);
    if (res?.success) {
      const fullConfig = (await window.electronAPI.loadConfig()) as UnifiedConfig;
      await syncProjectedCliCompatibility(
        fullConfig,
        useDetectionStore.getState().setCliCompatibility
      );
      await get().fetchConfig();
      sessionEventLog.info('route', '已执行一次 CLI 可用性即时探测');
      return res.data;
    }
    sessionEventLog.error('route', 'CLI 可用性即时探测失败');
    return null;
  },

  fetchProbeLatest: async params => {
    const res = await window.electronAPI.route?.getCliProbeLatest(params);
    return res?.success ? res.data : [];
  },

  fetchCliProbeData: async (timeRange, force) => {
    const state = get();
    if (!force && state.cliProbeLoaded && state.cliProbeTimeRange === timeRange) return;

    const requestId = state.cliProbeRequestId + 1;
    set({
      loading: true,
      cliProbeTimeRange: timeRange,
      cliProbeRequestId: requestId,
      cliProbeError: null,
    });

    try {
      const viewRes = await window.electronAPI.route?.getCliProbeView({ window: timeRange });

      // 竞态保护：只提交最新请求的结果
      if (get().cliProbeRequestId !== requestId) return;

      if (!viewRes?.success) {
        set({
          cliProbeError: '探测数据加载失败',
          cliProbeLoaded: false,
        });
        return;
      }

      set({
        cliProbeHistory: [],
        cliProbeLatest: [],
        cliProbeView: viewRes.data || [],
        cliProbeLoaded: true,
        cliProbeError: null,
      });
    } finally {
      set({ loading: false });
    }
  },
}));
