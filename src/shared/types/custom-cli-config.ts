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

/** 单个 CLI 的自定义配置 */
export interface CustomCliSettings {
  enabled: boolean;
  model: string | null;
  /** 用户编辑后的配置文件内容（null 表示未编辑，使用自动生成的配置） */
  editedFiles?: { path: string; content: string }[] | null;
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
