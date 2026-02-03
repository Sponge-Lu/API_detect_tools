/**
 * 输入: CustomCliConfig (自定义CLI配置类型)
 * 输出: CustomCliConfigState (状态), 配置操作方法
 * 定位: 状态管理层 - 使用 Zustand 管理自定义CLI配置
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/store/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { create } from 'zustand';
import type { CustomCliConfig } from '../../shared/types/custom-cli-config';
import { createDefaultCustomCliConfig } from '../../shared/types/custom-cli-config';
import { toast } from './toastStore';
import Logger from '../utils/logger';

interface CustomCliConfigState {
  /** 所有自定义配置 */
  configs: CustomCliConfig[];
  /** 当前应用的配置ID */
  activeConfigId: string | null;
  /** 加载状态 */
  loading: boolean;
  /** 保存状态 */
  saving: boolean;
  /** 模型拉取状态 (configId -> loading) */
  fetchingModels: Record<string, boolean>;

  // Actions
  /** 设置配置列表 */
  setConfigs: (configs: CustomCliConfig[]) => void;
  /** 设置活跃配置ID */
  setActiveConfigId: (id: string | null) => void;
  /** 从持久化加载配置 */
  loadConfigs: () => Promise<void>;
  /** 保存配置到持久化 */
  saveConfigs: () => Promise<void>;
  /** 添加新配置 */
  addConfig: (config?: Partial<CustomCliConfig>) => CustomCliConfig;
  /** 更新配置 */
  updateConfig: (id: string, updates: Partial<CustomCliConfig>) => void;
  /** 删除配置 */
  deleteConfig: (id: string) => Promise<void>;
  /** 应用配置 */
  applyConfig: (id: string) => Promise<void>;
  /** 取消应用配置 */
  clearActiveConfig: () => Promise<void>;
  /** 拉取模型列表 */
  fetchModels: (configId: string) => Promise<string[]>;
  /** 获取活跃配置 */
  getActiveConfig: () => CustomCliConfig | null;
}

export const useCustomCliConfigStore = create<CustomCliConfigState>()((set, get) => ({
  // 初始状态
  configs: [],
  activeConfigId: null,
  loading: false,
  saving: false,
  fetchingModels: {},

  // 基础 setters
  setConfigs: configs => set({ configs }),
  setActiveConfigId: id => set({ activeConfigId: id }),

  // 从持久化加载配置
  loadConfigs: async () => {
    set({ loading: true });
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.customCliConfig?.load) {
        const data = await electronAPI.customCliConfig.load();
        if (data) {
          set({
            configs: data.configs || [],
            activeConfigId: data.activeConfigId || null,
          });
          Logger.info('✅ [CustomCliConfigStore] 加载配置成功:', data.configs?.length || 0, '个');
        }
      }
    } catch (error: any) {
      Logger.error('❌ [CustomCliConfigStore] 加载配置失败:', error.message);
    } finally {
      set({ loading: false });
    }
  },

  // 保存配置到持久化
  saveConfigs: async () => {
    const { configs, activeConfigId } = get();
    set({ saving: true });
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.customCliConfig?.save) {
        await electronAPI.customCliConfig.save({ configs, activeConfigId });
        Logger.info('✅ [CustomCliConfigStore] 保存配置成功');
      }
    } catch (error: any) {
      Logger.error('❌ [CustomCliConfigStore] 保存配置失败:', error.message);
      toast.error('保存自定义CLI配置失败');
    } finally {
      set({ saving: false });
    }
  },

  // 添加新配置
  addConfig: (partial?: Partial<CustomCliConfig>) => {
    const newConfig = createDefaultCustomCliConfig(partial);
    set(state => ({
      configs: [...state.configs, newConfig],
    }));
    return newConfig;
  },

  // 更新配置
  updateConfig: (id: string, updates: Partial<CustomCliConfig>) => {
    set(state => ({
      configs: state.configs.map(c =>
        c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c
      ),
    }));
  },

  // 删除配置
  deleteConfig: async (id: string) => {
    const { activeConfigId, saveConfigs } = get();
    set(state => ({
      configs: state.configs.filter(c => c.id !== id),
      // 如果删除的是活跃配置，清除活跃状态
      activeConfigId: activeConfigId === id ? null : activeConfigId,
    }));
    await saveConfigs();
    toast.success('已删除自定义配置');
  },

  // 应用配置
  applyConfig: async (id: string) => {
    const { configs, saveConfigs } = get();
    const config = configs.find(c => c.id === id);
    if (!config) {
      toast.error('配置不存在');
      return;
    }
    set({ activeConfigId: id });
    await saveConfigs();
    toast.success(`已应用配置: ${config.name}`);
  },

  // 取消应用配置
  clearActiveConfig: async () => {
    const { saveConfigs } = get();
    set({ activeConfigId: null });
    await saveConfigs();
    toast.success('已取消应用自定义配置');
  },

  // 拉取模型列表
  fetchModels: async (configId: string) => {
    const { configs, updateConfig, saveConfigs, fetchingModels } = get();
    const config = configs.find(c => c.id === configId);
    if (!config) {
      toast.error('配置不存在');
      return [];
    }

    if (!config.baseUrl || !config.apiKey) {
      toast.error('请先填写 Base URL 和 API Key');
      return [];
    }

    // 设置加载状态
    set({ fetchingModels: { ...fetchingModels, [configId]: true } });

    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.customCliConfig?.fetchModels) {
        const models = await electronAPI.customCliConfig.fetchModels(config.baseUrl, config.apiKey);

        // 更新配置中的模型列表
        updateConfig(configId, {
          models,
          lastModelFetch: Date.now(),
        });
        await saveConfigs();

        toast.success(`成功获取 ${models.length} 个模型`);
        return models;
      }
      return [];
    } catch (error: any) {
      Logger.error('❌ [CustomCliConfigStore] 拉取模型失败:', error.message);
      toast.error(`拉取模型失败: ${error.message}`);
      return [];
    } finally {
      set(state => ({
        fetchingModels: { ...state.fetchingModels, [configId]: false },
      }));
    }
  },

  // 获取活跃配置
  getActiveConfig: () => {
    const { configs, activeConfigId } = get();
    if (!activeConfigId) return null;
    return configs.find(c => c.id === activeConfigId) || null;
  },
}));
