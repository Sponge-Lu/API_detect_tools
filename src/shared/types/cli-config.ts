/**
 * 输入: 无
 * 输出: CLI 配置相关类型定义 (CliConfig, CliConfigItem, ApiKeyInfo 等)
 * 定位: 类型层 - CLI 配置相关类型定义，供多个组件共享使用
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/shared/types/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/** 编辑后的配置文件 */
export interface EditedConfigFile {
  path: string;
  content: string;
}

/** 每个 CLI 保存的测试模型槽位数 */
export const CLI_TEST_MODEL_SLOT_COUNT = 3;

/** 单个 CLI 配置项 */
export interface CliConfigItem {
  apiKeyId: number | null;
  model: string | null; // CLI 使用模型
  testModel?: string | null; // 测试使用模型
  testModels?: string[] | null; // 测试使用模型（最多 3 个，兼容旧数据）
  enabled?: boolean; // 是否启用（控制图标显示和测试），可选以兼容旧数据
  editedFiles?: EditedConfigFile[] | null; // 用户编辑后的配置文件内容
  applyMode?: 'merge' | 'overwrite'; // 应用配置模式：合并或覆盖，默认合并
}

/** CLI 配置 */
export interface CliConfig {
  claudeCode?: CliConfigItem | null;
  codex?: CliConfigItem | null;
  geminiCli?: CliConfigItem | null;
}

/** 默认 CLI 配置 - 所有 CLI 默认启用 */
export const DEFAULT_CLI_CONFIG: Required<{
  [K in keyof CliConfig]: Required<Omit<CliConfigItem, 'editedFiles'>> & { editedFiles: null };
}> = {
  claudeCode: {
    apiKeyId: null,
    model: null,
    testModel: null,
    testModels: [],
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
  },
  codex: {
    apiKeyId: null,
    model: null,
    testModel: null,
    testModels: [],
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
  },
  geminiCli: {
    apiKeyId: null,
    model: null,
    testModel: null,
    testModels: [],
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
  },
};

/**
 * 规范化测试模型列表，兼容 legacy `testModel`
 */
export function normalizeCliTestModels(
  item?: Pick<CliConfigItem, 'testModel' | 'testModels'> | null,
  slotCount: number = CLI_TEST_MODEL_SLOT_COUNT
): string[] {
  const fromArray = Array.isArray(item?.testModels)
    ? item!.testModels.map(model => (typeof model === 'string' ? model.trim() : '')).filter(Boolean)
    : [];
  const normalized = fromArray.length > 0 ? fromArray : item?.testModel ? [item.testModel] : [];
  return normalized.slice(0, slotCount);
}

/**
 * 将编辑态的测试模型槽位压缩为持久化数组
 */
export function sanitizeCliTestModels(
  testModels: Array<string | null | undefined>,
  slotCount: number = CLI_TEST_MODEL_SLOT_COUNT
): string[] {
  return testModels
    .map(model => (typeof model === 'string' ? model.trim() : ''))
    .filter(Boolean)
    .slice(0, slotCount);
}

/** API Key 信息 */
export interface ApiKeyInfo {
  id?: number;
  token_id?: number;
  name?: string;
  key?: string;
  token?: string;
  group?: string;
  models?: string;
  status?: number;
}

/** 用户分组信息 */
export interface UserGroupInfo {
  desc: string;
  ratio: number;
}
