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
  RouteCliProbeConfig,
  RouteCliProbeLatest,
  RouteCliProbeSample,
  RouteCliProbeSiteView,
  RouteCliType,
} from '../../shared/types/route-proxy';

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
  upsertMappingOverride: (override: any) => Promise<any>;
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
    if (res?.success) await get().fetchConfig();
  },

  setActiveSubTab: tab => {
    localStorage.setItem('route-sub-tab', tab);
    set({ activeSubTab: tab });
  },

  upsertRule: async rule => {
    const res = await window.electronAPI.route?.upsertRule(rule);
    if (res?.success && res.data) {
      await get().fetchConfig();
      return res.data;
    }
    return null;
  },

  deleteRule: async ruleId => {
    const res = await window.electronAPI.route?.deleteRule(ruleId);
    if (res?.success) {
      await get().fetchConfig();
      return true;
    }
    return false;
  },

  resetStats: async ruleId => {
    await window.electronAPI.route?.resetStats(ruleId);
    await get().fetchConfig();
  },

  startServer: async () => {
    const res = await window.electronAPI.route?.startServer();
    if (res?.success) {
      set({ serverRunning: true });
      return true;
    }
    return false;
  },

  stopServer: async () => {
    const res = await window.electronAPI.route?.stopServer();
    if (res?.success) {
      set({ serverRunning: false });
      return true;
    }
    return false;
  },

  runHealthCheck: async () => {
    await window.electronAPI.route?.runHealthCheck();
    await get().fetchConfig();
  },

  regenerateApiKey: async () => {
    const res = await window.electronAPI.route?.regenerateApiKey();
    if (res?.success && res.data?.unifiedApiKey) {
      await get().fetchConfig();
      return res.data.unifiedApiKey;
    }
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
      return res.data;
    }
    return null;
  },

  upsertMappingOverride: async override => {
    const res = await window.electronAPI.route?.upsertModelMappingOverride(override);
    if (res?.success) {
      await get().fetchModelRegistry();
      return res.data;
    }
    return null;
  },

  deleteMappingOverride: async overrideId => {
    const res = await window.electronAPI.route?.deleteModelMappingOverride(overrideId);
    if (res?.success) {
      await get().fetchModelRegistry();
      return true;
    }
    return false;
  },

  // CLI 模型选择
  saveCliModelSelections: async selections => {
    await window.electronAPI.route?.saveCliModelSelections(selections);
    await get().fetchConfig();
  },

  // CLI 探测
  saveCliProbeConfig: async updates => {
    await window.electronAPI.route?.saveCliProbeConfig(updates);
    await get().fetchConfig();
  },

  runProbeNow: async params => {
    const res = await window.electronAPI.route?.runCliProbeNow(params);
    if (res?.success) {
      await get().fetchConfig();
      return res.data;
    }
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
