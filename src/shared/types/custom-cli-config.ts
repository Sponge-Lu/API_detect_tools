/**
 * 输入: 无
 * 输出: 自定义 CLI 配置相关类型定义 (CustomCliConfig, CustomCliSettings)
 * 定位: 类型层 - 自定义 CLI 配置相关类型定义，供多个组件共享使用
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/shared/types/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import {
  CLI_TEST_MODEL_SLOT_COUNT,
  normalizeCliTargetProtocol,
  sanitizeCliTestResults,
  type CliModelTestResult,
  type CliTargetProtocol,
} from './cli-config';
import type { ClaudeTestDetail, CodexTestDetail, GeminiTestDetail, ModelPricingData } from './site';

export const CUSTOM_CLI_GROUP_MULTIPLIER_DEFAULT = 1;
export const CUSTOM_CLI_GROUP_MULTIPLIER_MIN = 0.001;

export function normalizeCustomCliGroupMultiplier(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return CUSTOM_CLI_GROUP_MULTIPLIER_DEFAULT;
  }
  return Math.max(CUSTOM_CLI_GROUP_MULTIPLIER_MIN, value);
}

export interface CustomCliTestState {
  status: boolean | null;
  testedAt: number | null;
  claudeDetail?: ClaudeTestDetail;
  codexDetail?: CodexTestDetail;
  geminiDetail?: GeminiTestDetail;
  slots: Array<CliModelTestResult | null>;
}

export function createEmptyCustomCliTestState(): CustomCliTestState {
  return {
    status: null,
    testedAt: null,
    claudeDetail: undefined,
    codexDetail: undefined,
    geminiDetail: undefined,
    slots: Array.from({ length: CLI_TEST_MODEL_SLOT_COUNT }, () => null),
  };
}

export function normalizeCustomCliTestState(state?: CustomCliTestState | null): CustomCliTestState {
  const slots = sanitizeCliTestResults(state?.slots ?? [], CLI_TEST_MODEL_SLOT_COUNT);
  const validRows = slots.filter(Boolean) as CliModelTestResult[];
  const derivedStatus =
    validRows.length === 0 ? null : validRows.every(result => result.success === true);
  const derivedTestedAt =
    validRows.length > 0 ? Math.max(...validRows.map(result => result.timestamp)) : null;

  return {
    status: typeof state?.status === 'boolean' ? state.status : derivedStatus,
    testedAt: typeof state?.testedAt === 'number' ? state.testedAt : derivedTestedAt,
    claudeDetail: state?.claudeDetail,
    codexDetail: state?.codexDetail,
    geminiDetail: state?.geminiDetail,
    slots,
  };
}

/** 单个 CLI 的自定义配置 */
export interface CustomCliSettings {
  enabled: boolean;
  model: string | null;
  /** 用于测试的模型（优先级高于 model，但最多保留 3 个） */
  testModels?: string[];
  /** 上游目标协议 */
  targetProtocol?: CliTargetProtocol;
  /** 用户编辑后的配置文件内容（null 表示未编辑，使用自动生成的配置） */
  editedFiles?: { path: string; content: string }[] | null;
  /** 最近一次 CLI 测试结果 */
  testState?: CustomCliTestState | null;
}

/** 自定义 CLI 配置 */
export interface CustomCliConfig {
  /** 唯一标识 */
  id: string;
  /** 配置名称 */
  name: string;
  /** Base URL (如 https://api.example.com) */
  baseUrl: string;
  /** API Key */
  apiKey: string;
  /** 直连配置分组倍率，用于估算实际费用 */
  groupMultiplier?: number;
  /** 拉取到的可用模型列表 */
  models: string[];
  /** 用户手动输入的模型列表，用于拉取端点不可用或模型未出现在端点响应中的配置 */
  manualModels?: string[];
  /** 按当前直连配置隔离的模型价格，key 为模型名 */
  modelPricing?: ModelPricingData;
  /** 最后拉取模型时间戳 */
  lastModelFetch?: number;
  /** 用户备注 */
  notes?: string;
  /** 各 CLI 工具的配置 */
  cliSettings: {
    claudeCode: CustomCliSettings;
    codex: CustomCliSettings;
    geminiCli: CustomCliSettings;
  };
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/** 自定义 CLI 配置的默认设置 */
export const DEFAULT_CUSTOM_CLI_SETTINGS: CustomCliSettings = {
  enabled: true,
  model: null,
  testModels: [],
  testState: null,
};

export function normalizeCustomCliSettings(setting?: CustomCliSettings | null): CustomCliSettings {
  return {
    ...DEFAULT_CUSTOM_CLI_SETTINGS,
    ...(setting || {}),
    targetProtocol: setting?.targetProtocol
      ? normalizeCliTargetProtocol(setting.targetProtocol)
      : undefined,
    testState: setting?.testState ? normalizeCustomCliTestState(setting.testState) : null,
  };
}

/** 创建新自定义配置的默认值 */
export function createDefaultCustomCliConfig(partial?: Partial<CustomCliConfig>): CustomCliConfig {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: '',
    baseUrl: '',
    apiKey: '',
    models: [],
    manualModels: [],
    modelPricing: { data: {} },
    lastModelFetch: undefined,
    notes: '',
    cliSettings: {
      claudeCode: normalizeCustomCliSettings(),
      codex: normalizeCustomCliSettings(),
      geminiCli: normalizeCustomCliSettings(),
    },
    createdAt: now,
    updatedAt: now,
    ...partial,
    groupMultiplier: normalizeCustomCliGroupMultiplier(partial?.groupMultiplier),
  };
}
