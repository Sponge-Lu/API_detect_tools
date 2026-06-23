/**
 * 输入: CustomCliConfig (自定义CLI配置类型)
 * 输出: CustomCliConfigState (状态), 配置操作方法
 * 定位: 状态管理层 - 使用 Zustand 管理自定义CLI配置，并以已拉取模型列表约束本地选择状态
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/store/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { create } from 'zustand';
import type {
  CustomCliConfig,
  CustomCliSettings,
  CustomCliTestState,
} from '../../shared/types/custom-cli-config';
import type { ModelPriceInfo, ModelPricingData } from '../../shared/types/site';
import {
  createDefaultCustomCliConfig,
  normalizeCustomCliGroupMultiplier,
  normalizeCustomCliSettings,
  normalizeCustomCliTestState,
} from '../../shared/types/custom-cli-config';
import { toast } from './toastStore';
import { sessionEventLog } from '../services/sessionEventLog';
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

type CustomCliConfigBridge = {
  load?: () => Promise<{ configs?: CustomCliConfig[]; activeConfigId?: string | null } | null>;
  save?: (data: { configs: CustomCliConfig[]; activeConfigId: string | null }) => Promise<unknown>;
  fetchModels?: (baseUrl: string, apiKey: string) => Promise<string[]>;
};

type ElectronApiWithCustomCliConfig = Window['electronAPI'] & {
  customCliConfig?: CustomCliConfigBridge;
};

function getCustomCliConfigBridge(): CustomCliConfigBridge | undefined {
  return (window.electronAPI as ElectronApiWithCustomCliConfig | undefined)?.customCliConfig;
}

function normalizeModelNames(models: unknown[] | undefined): string[] {
  if (!Array.isArray(models)) {
    return [];
  }

  return Array.from(
    new Set(
      models
        .map(model => (typeof model === 'string' ? model.trim() : ''))
        .filter(model => model.length > 0)
    )
  );
}

function normalizeManualModels(
  manualModels: unknown[] | undefined,
  fetchedModels: string[]
): string[] {
  const fetchedModelSet = new Set(fetchedModels);
  return normalizeModelNames(manualModels).filter(model => !fetchedModelSet.has(model));
}

function toFinitePricingNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeModelPriceInfo(value: unknown): ModelPriceInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const raw = value as ModelPriceInfo;
  const normalized: ModelPriceInfo = {};
  const input = toFinitePricingNumber(raw.input);
  const output = toFinitePricingNumber(raw.output);
  const quotaType = toFinitePricingNumber(raw.quota_type);
  const groupRatio = toFinitePricingNumber(raw.group_ratio);
  const modelRatio = toFinitePricingNumber(raw.model_ratio);
  const completionRatio = toFinitePricingNumber(raw.completion_ratio);

  if (input !== undefined) normalized.input = input;
  if (output !== undefined) normalized.output = output;
  if (quotaType !== undefined) normalized.quota_type = quotaType;
  if (groupRatio !== undefined) normalized.group_ratio = groupRatio;
  if (modelRatio !== undefined) normalized.model_ratio = modelRatio;
  if (completionRatio !== undefined) normalized.completion_ratio = completionRatio;
  if (typeof raw.type === 'string') normalized.type = raw.type;
  if (typeof raw.model_description === 'string') normalized.model_description = raw.model_description;
  if (Array.isArray(raw.enable_groups)) {
    normalized.enable_groups = raw.enable_groups.filter(
      (group): group is string => typeof group === 'string' && group.trim().length > 0
    );
  }

  if (typeof raw.model_price === 'number' && Number.isFinite(raw.model_price)) {
    normalized.model_price = raw.model_price;
  } else if (raw.model_price && typeof raw.model_price === 'object' && !Array.isArray(raw.model_price)) {
    const modelPriceInput = toFinitePricingNumber(raw.model_price.input);
    const modelPriceOutput = toFinitePricingNumber(raw.model_price.output);
    if (modelPriceInput !== undefined || modelPriceOutput !== undefined) {
      normalized.model_price = {
        ...(modelPriceInput !== undefined ? { input: modelPriceInput } : {}),
        ...(modelPriceOutput !== undefined ? { output: modelPriceOutput } : {}),
      };
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeModelPricingData(pricingData: ModelPricingData | undefined): ModelPricingData {
  const rawData = pricingData?.data;
  if (!rawData || typeof rawData !== 'object') {
    return { data: {} };
  }

  const data: Record<string, ModelPriceInfo> = {};
  for (const [model, priceInfo] of Object.entries(rawData)) {
    const modelName = model.trim();
    const normalizedPrice = normalizeModelPriceInfo(priceInfo);
    if (modelName && normalizedPrice) {
      data[modelName] = normalizedPrice;
    }
  }

  return { data };
}

function filterCustomCliTestState(
  testState: CustomCliTestState | null | undefined,
  availableModels: Set<string>
): CustomCliTestState | null {
  if (!testState) {
    return null;
  }

  const normalized = normalizeCustomCliTestState(testState);
  const slots = normalized.slots.map(slot => {
    if (!slot) {
      return null;
    }

    const model = slot.model.trim();
    return availableModels.has(model) ? { ...slot, model } : null;
  });
  const validSlots = slots.filter((slot): slot is NonNullable<(typeof slots)[number]> =>
    Boolean(slot)
  );
  const removedAnySlot = normalized.slots.some((slot, index) => Boolean(slot) && !slots[index]);

  if (validSlots.length === 0) {
    return null;
  }

  return {
    ...normalized,
    status: validSlots.every(slot => slot.success),
    testedAt: Math.max(...validSlots.map(slot => slot.timestamp)),
    claudeDetail: removedAnySlot ? undefined : normalized.claudeDetail,
    codexDetail: removedAnySlot ? undefined : normalized.codexDetail,
    geminiDetail: removedAnySlot ? undefined : normalized.geminiDetail,
    slots,
  };
}

function filterCustomCliSettingModels(
  setting: CustomCliSettings,
  availableModels: Set<string>
): CustomCliSettings {
  const selectedModel = setting.model?.trim() ?? '';
  const model = selectedModel && availableModels.has(selectedModel) ? selectedModel : null;
  const testModels = Array.from(
    new Set(
      (setting.testModels ?? [])
        .map(testModel => testModel.trim())
        .filter(testModel => availableModels.has(testModel))
    )
  ).slice(0, 3);

  return {
    ...setting,
    model,
    testModels,
    editedFiles: model ? setting.editedFiles : null,
    testState: filterCustomCliTestState(setting.testState, availableModels),
  };
}

function filterCustomCliConfigModels(
  config: CustomCliConfig,
  models: string[],
  fetchedAt: number
): Pick<CustomCliConfig, 'models' | 'manualModels' | 'groupMultiplier' | 'modelPricing' | 'lastModelFetch' | 'cliSettings'> {
  const normalizedModels = normalizeModelNames(models);
  const manualModels = normalizeManualModels(config.manualModels, normalizedModels);
  const availableModels = new Set([...normalizedModels, ...manualModels]);

  return {
    models: normalizedModels,
    manualModels,
    groupMultiplier: normalizeCustomCliGroupMultiplier(config.groupMultiplier),
    modelPricing: normalizeModelPricingData(config.modelPricing),
    lastModelFetch: fetchedAt,
    cliSettings: {
      claudeCode: filterCustomCliSettingModels(config.cliSettings.claudeCode, availableModels),
      codex: filterCustomCliSettingModels(config.cliSettings.codex, availableModels),
      geminiCli: filterCustomCliSettingModels(config.cliSettings.geminiCli, availableModels),
    },
  };
}

function normalizeCustomCliConfigModelBoundary(config: CustomCliConfig): CustomCliConfig {
  const normalizedModels = normalizeModelNames(config.models);
  const manualModels = normalizeManualModels(config.manualModels, normalizedModels);
  const hasModelBoundary =
    normalizedModels.length > 0 ||
    manualModels.length > 0 ||
    typeof config.lastModelFetch === 'number';
  const cliSettings = {
    claudeCode: normalizeCustomCliSettings(config.cliSettings?.claudeCode),
    codex: normalizeCustomCliSettings(config.cliSettings?.codex),
    geminiCli: normalizeCustomCliSettings(config.cliSettings?.geminiCli),
  };

  if (!hasModelBoundary) {
    return {
      ...config,
      models: normalizedModels,
      manualModels,
      groupMultiplier: normalizeCustomCliGroupMultiplier(config.groupMultiplier),
      modelPricing: normalizeModelPricingData(config.modelPricing),
      cliSettings,
    };
  }

  const availableModels = new Set([...normalizedModels, ...manualModels]);
  return {
    ...config,
    models: normalizedModels,
    manualModels,
    groupMultiplier: normalizeCustomCliGroupMultiplier(config.groupMultiplier),
    modelPricing: normalizeModelPricingData(config.modelPricing),
    cliSettings: {
      claudeCode: filterCustomCliSettingModels(cliSettings.claudeCode, availableModels),
      codex: filterCustomCliSettingModels(cliSettings.codex, availableModels),
      geminiCli: filterCustomCliSettingModels(cliSettings.geminiCli, availableModels),
    },
  };
}

function normalizeCustomCliConfigs(configs: CustomCliConfig[]): CustomCliConfig[] {
  return configs.map(config => normalizeCustomCliConfigModelBoundary(config));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : String(error);
}

export const useCustomCliConfigStore = create<CustomCliConfigState>()((set, get) => ({
  // 初始状态
  configs: [],
  activeConfigId: null,
  loading: false,
  saving: false,
  fetchingModels: {},

  // 基础 setters
  setConfigs: configs => set({ configs: normalizeCustomCliConfigs(configs) }),
  setActiveConfigId: id => set({ activeConfigId: id }),

  // 从持久化加载配置
  loadConfigs: async () => {
    set({ loading: true });
    try {
      const customCliConfig = getCustomCliConfigBridge();
      if (customCliConfig?.load) {
        const data = await customCliConfig.load();
        if (data) {
          set({
            configs: normalizeCustomCliConfigs(data.configs || []),
            activeConfigId: data.activeConfigId || null,
          });
          Logger.info('✅ [CustomCliConfigStore] 加载配置成功:', data.configs?.length || 0, '个');
        }
      }
    } catch (error) {
      Logger.error('❌ [CustomCliConfigStore] 加载配置失败:', getErrorMessage(error));
    } finally {
      set({ loading: false });
    }
  },

  // 保存配置到持久化
  saveConfigs: async () => {
    const { configs, activeConfigId } = get();
    const normalizedConfigs = normalizeCustomCliConfigs(configs);
    set({ saving: true, configs: normalizedConfigs });
    try {
      const customCliConfig = getCustomCliConfigBridge();
      if (customCliConfig?.save) {
        await customCliConfig.save({ configs: normalizedConfigs, activeConfigId });
        Logger.info('✅ [CustomCliConfigStore] 保存配置成功');
        sessionEventLog.success('custom-cli', '自定义 CLI 配置已保存');
      }
    } catch (error) {
      Logger.error('❌ [CustomCliConfigStore] 保存配置失败:', getErrorMessage(error));
      toast.error('保存自定义CLI配置失败');
      sessionEventLog.error('custom-cli', '自定义 CLI 配置保存失败');
    } finally {
      set({ saving: false });
    }
  },

  // 添加新配置
  addConfig: (partial?: Partial<CustomCliConfig>) => {
    const newConfig = normalizeCustomCliConfigModelBoundary(createDefaultCustomCliConfig(partial));
    set(state => ({
      configs: [...state.configs, newConfig],
    }));
    return newConfig;
  },

  // 更新配置
  updateConfig: (id: string, updates: Partial<CustomCliConfig>) => {
    set(state => ({
      configs: state.configs.map(c =>
        c.id === id
          ? normalizeCustomCliConfigModelBoundary({ ...c, ...updates, updatedAt: Date.now() })
          : c
      ),
    }));
  },

  // 删除配置
  deleteConfig: async (id: string) => {
    const { activeConfigId, saveConfigs, configs } = get();
    const deletedConfig = configs.find(config => config.id === id);
    set(state => ({
      configs: state.configs.filter(c => c.id !== id),
      // 如果删除的是活跃配置，清除活跃状态
      activeConfigId: activeConfigId === id ? null : activeConfigId,
    }));
    await saveConfigs();
    toast.success('已删除自定义配置');
    sessionEventLog.success(
      'custom-cli',
      `已删除自定义配置：${deletedConfig?.name || '未命名配置'}`
    );
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
    sessionEventLog.success('custom-cli', `已应用自定义 CLI 配置：${config.name}`);
  },

  // 取消应用配置
  clearActiveConfig: async () => {
    const { saveConfigs } = get();
    set({ activeConfigId: null });
    await saveConfigs();
    toast.success('已取消应用自定义配置');
    sessionEventLog.info('custom-cli', '已取消应用自定义 CLI 配置');
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
      const customCliConfig = getCustomCliConfigBridge();
      if (customCliConfig?.fetchModels) {
        const models = await customCliConfig.fetchModels(config.baseUrl, config.apiKey);

        // 更新配置中的模型列表，并清理旧 Base URL / API Key 遗留的模型选择。
        updateConfig(configId, filterCustomCliConfigModels(config, models, Date.now()));
        await saveConfigs();

        toast.success(`成功获取 ${models.length} 个模型`);
        sessionEventLog.success(
          'custom-cli',
          `${config.name || '未命名配置'} 已拉取 ${models.length} 个模型`
        );
        return models;
      }
      return [];
    } catch (error) {
      const message = getErrorMessage(error);
      Logger.error('❌ [CustomCliConfigStore] 拉取模型失败:', message);
      toast.error(`拉取模型失败: ${message}`);
      sessionEventLog.error(
        'custom-cli',
        `${config.name || '未命名配置'} 拉取模型失败：${message}`
      );
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
