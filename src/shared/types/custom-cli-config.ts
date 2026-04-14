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
  sanitizeCliTestResults,
  type CliModelTestResult,
} from './cli-config';
import type { CodexTestDetail, GeminiTestDetail } from './site';

export interface CustomCliTestState {
  status: boolean | null;
  testedAt: number | null;
  codexDetail?: CodexTestDetail;
  geminiDetail?: GeminiTestDetail;
  slots: Array<CliModelTestResult | null>;
}

export function createEmptyCustomCliTestState(): CustomCliTestState {
  return {
    status: null,
    testedAt: null,
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
  /** 拉取到的可用模型列表 */
  models: string[];
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

/** 创建新自定义配置的默认值 */
export function createDefaultCustomCliConfig(partial?: Partial<CustomCliConfig>): CustomCliConfig {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: '',
    baseUrl: '',
    apiKey: '',
    models: [],
    lastModelFetch: undefined,
    notes: '',
    cliSettings: {
      claudeCode: { ...DEFAULT_CUSTOM_CLI_SETTINGS },
      codex: { ...DEFAULT_CUSTOM_CLI_SETTINGS },
      geminiCli: { ...DEFAULT_CUSTOM_CLI_SETTINGS },
    },
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}
