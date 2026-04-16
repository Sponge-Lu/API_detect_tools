/**
 * 输入: Config (应用配置), SiteConfig (站点配置), Settings (应用设置)
 * 输出: ConfigState (配置状态), 配置操作方法
 * 定位: 状态管理层 - 使用 Zustand 管理应用配置和站点数据
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/store/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * 配置状态管理
 * 管理应用配置和站点账号数据
 *
 * 注意：分组操作由 useSiteGroups hook 负责，Store 只负责存储状态和站点操作
 */

import { create } from 'zustand';
import type { Config, SiteConfig, Settings } from '../App';
import { toast } from './toastStore';
import Logger from '../utils/logger';

interface ConfigState {
  // 配置数据
  config: Config | null;
  siteAccounts: Record<string, any>;

  // 加载状态
  loading: boolean;
  saving: boolean;

  // Actions
  setConfig: (config: Config | null) => void;
  setSiteAccounts: (accounts: Record<string, any>) => void;
  setLoading: (loading: boolean) => void;
  setSaving: (saving: boolean) => void;

  // 站点操作
  addSite: (site: SiteConfig) => Promise<void>;
  updateSite: (index: number, site: SiteConfig) => Promise<void>;
  deleteSite: (index: number) => Promise<void>;
  toggleSiteEnabled: (index: number) => Promise<void>;
  reorderSites: (fromIndex: number, toIndex: number) => Promise<void>;

  // 设置操作
  updateSettings: (settings: Partial<Settings>) => void;

  // 保存配置
  saveConfig: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>()((set, get) => ({
  // 初始状态
  config: null,
  siteAccounts: {},
  loading: true,
  saving: false,

  // 基础 setters
  setConfig: config => set({ config }),
  setSiteAccounts: accounts => set({ siteAccounts: accounts }),
  setLoading: loading => set({ loading }),
  setSaving: saving => set({ saving }),

  // 站点操作（自动持久化）
  addSite: async site => {
    const { config, saveConfig } = get();
    if (!config) return;
    set({
      config: {
        ...config,
        sites: [...config.sites, site],
      },
    });
    await saveConfig();
  },

  updateSite: async (index, site) => {
    const { config, saveConfig } = get();
    if (!config) return;
    const newSites = [...config.sites];
    // 保留现有站点的 cached_data 和 cli_config，只更新用户可编辑的字段
    const existingSite = newSites[index];
    newSites[index] = {
      ...existingSite, // 保留 cached_data、cli_config 等字段
      ...site, // 覆盖用户编辑的字段
    };
    set({
      config: {
        ...config,
        sites: newSites,
      },
    });
    await saveConfig();
  },

  deleteSite: async index => {
    const { config, saveConfig } = get();
    if (!config) return;
    const siteToDelete = config.sites[index];
    if (!siteToDelete) return;

    const nextConfig = {
      ...config,
      sites: config.sites.filter((_, i) => i !== index),
    };

    set({ config: nextConfig, saving: true });

    try {
      if (siteToDelete.id && window.electronAPI.sites?.delete) {
        const result = await window.electronAPI.sites.delete(siteToDelete.id);
        if (!result?.success) {
          throw new Error(result?.error || '删除站点失败');
        }
      } else {
        await saveConfig();
      }

      const refreshedConfig = await window.electronAPI.loadConfig();
      set({ config: refreshedConfig });
    } catch (error) {
      Logger.error('删除站点失败:', error);
      toast.error('删除站点失败');
      set({ config });
    } finally {
      set({ saving: false });
    }
  },

  toggleSiteEnabled: async index => {
    const { config, saveConfig } = get();
    if (!config) return;
    const newSites = [...config.sites];
    newSites[index] = {
      ...newSites[index],
      enabled: !newSites[index].enabled,
    };
    set({
      config: {
        ...config,
        sites: newSites,
      },
    });
    await saveConfig();
  },

  reorderSites: async (fromIndex, toIndex) => {
    const { config, saveConfig } = get();
    if (!config) return;
    const newSites = [...config.sites];
    const [movedSite] = newSites.splice(fromIndex, 1);
    newSites.splice(toIndex, 0, movedSite);
    set({
      config: {
        ...config,
        sites: newSites,
      },
    });
    await saveConfig();
  },

  // 设置操作
  updateSettings: settings => {
    const { config } = get();
    if (!config) return;
    set({
      config: {
        ...config,
        settings: {
          ...config.settings,
          ...settings,
        },
      },
    });
  },

  // 保存配置
  saveConfig: async () => {
    const { config } = get();
    if (!config) return;
    set({ saving: true });
    try {
      await window.electronAPI.saveConfig(config);
    } catch (error) {
      Logger.error('保存配置失败:', error);
      toast.error('保存配置失败');
    } finally {
      set({ saving: false });
    }
  },
}));
