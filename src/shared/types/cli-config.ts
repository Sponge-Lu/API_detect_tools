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

/** 单个测试模型的持久化结果 */
export interface CliModelTestResult {
  model: string;
  success: boolean;
  message?: string;
  timestamp: number;
}

/** 单个 CLI 配置项 */
export interface CliConfigItem {
  apiKeyId: number | null;
  model: string | null; // CLI 使用模型
  testModel?: string | null; // 测试使用模型
  testModels?: string[] | null; // 测试使用模型（最多 3 个，兼容旧数据）
  testResults?: Array<CliModelTestResult | null> | null; // 测试结果（按槽位持久化）
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
    testResults: [],
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
  },
  codex: {
    apiKeyId: null,
    model: null,
    testModel: null,
    testModels: [],
    testResults: [],
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
  },
  geminiCli: {
    apiKeyId: null,
    model: null,
    testModel: null,
    testModels: [],
    testResults: [],
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

/**
 * 规范化测试结果槽位，只保留与当前测试模型槽位匹配的结果
 */
export function normalizeCliTestResults(
  item?: Pick<CliConfigItem, 'testModel' | 'testModels' | 'testResults'> | null,
  slotCount: number = CLI_TEST_MODEL_SLOT_COUNT
): Array<CliModelTestResult | null> {
  const selectedModels = Array.from({ length: slotCount }, (_, index) => {
    return normalizeCliTestModels(item, slotCount)[index] || '';
  });
  const rawResults = Array.isArray(item?.testResults) ? item!.testResults : [];

  return Array.from({ length: slotCount }, (_, index) => {
    const selectedModel = selectedModels[index];
    const rawResult = rawResults[index];
    if (!selectedModel || !rawResult || typeof rawResult !== 'object') return null;

    const model = typeof rawResult.model === 'string' ? rawResult.model.trim() : '';
    if (!model || model !== selectedModel) return null;

    const success = typeof rawResult.success === 'boolean' ? rawResult.success : null;
    const timestamp =
      typeof rawResult.timestamp === 'number' && Number.isFinite(rawResult.timestamp)
        ? rawResult.timestamp
        : null;
    if (success === null || timestamp === null) return null;

    const message =
      typeof rawResult.message === 'string' && rawResult.message.trim()
        ? rawResult.message.trim()
        : undefined;

    return {
      model,
      success,
      timestamp,
      ...(message ? { message } : {}),
    };
  });
}

/**
 * 将编辑态的测试结果槽位转为持久化数组
 */
export function sanitizeCliTestResults(
  testResults: Array<CliModelTestResult | null | undefined>,
  slotCount: number = CLI_TEST_MODEL_SLOT_COUNT
): Array<CliModelTestResult | null> {
  return Array.from({ length: slotCount }, (_, index) => {
    const rawResult = testResults[index];
    if (!rawResult) return null;

    const model = typeof rawResult.model === 'string' ? rawResult.model.trim() : '';
    const success = typeof rawResult.success === 'boolean' ? rawResult.success : null;
    const timestamp =
      typeof rawResult.timestamp === 'number' && Number.isFinite(rawResult.timestamp)
        ? rawResult.timestamp
        : null;
    if (!model || success === null || timestamp === null) return null;

    const message =
      typeof rawResult.message === 'string' && rawResult.message.trim()
        ? rawResult.message.trim()
        : undefined;

    return {
      model,
      success,
      timestamp,
      ...(message ? { message } : {}),
    };
  });
}

/**
 * 从持久化测试结果推导 CLI 状态
 */
export function getCliTestResultStatus(
  item?: Pick<CliConfigItem, 'testModel' | 'testModels' | 'testResults'> | null,
  slotCount: number = CLI_TEST_MODEL_SLOT_COUNT
): boolean | null {
  const results = normalizeCliTestResults(item, slotCount).filter(Boolean) as CliModelTestResult[];
  if (results.length === 0) return null;
  return results.some(result => result.success);
}

/**
 * 获取持久化测试结果中的最新测试时间
 */
export function getCliTestResultTestedAt(
  item?: Pick<CliConfigItem, 'testModel' | 'testModels' | 'testResults'> | null,
  slotCount: number = CLI_TEST_MODEL_SLOT_COUNT
): number | null {
  const results = normalizeCliTestResults(item, slotCount).filter(Boolean) as CliModelTestResult[];
  if (results.length === 0) return null;
  return Math.max(...results.map(result => result.timestamp));
}

/**
 * 迁移 Codex TOML 中已弃用的 collab 特性标志
 */
export function normalizeCodexFeatureFlagsToml(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inFeaturesSection = false;
  let sawFeaturesSection = false;
  let sawMultiAgent = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    const sectionMatch = trimmedLine.match(/^\[([^\]]+)\]$/);

    if (sectionMatch) {
      if (inFeaturesSection && !sawMultiAgent) {
        result.push('multi_agent = true');
      }
      inFeaturesSection = sectionMatch[1] === 'features';
      if (inFeaturesSection) {
        sawFeaturesSection = true;
        sawMultiAgent = false;
      }
      result.push(line);
      continue;
    }

    if (inFeaturesSection) {
      const collabMatch = line.match(/^(\s*)collab(\s*=.*)$/);
      if (collabMatch) {
        result.push(`${collabMatch[1]}multi_agent${collabMatch[2]}`);
        sawMultiAgent = true;
        continue;
      }

      if (/^\s*multi_agent\s*=/.test(line)) {
        sawMultiAgent = true;
      }
    }

    result.push(line);
  }

  if (inFeaturesSection && !sawMultiAgent) {
    result.push('multi_agent = true');
  }

  if (!sawFeaturesSection) {
    const trimmedResult = result.join('\n').trimEnd();
    return `${trimmedResult}\n\n[features]\nmulti_agent = true`;
  }

  return result.join('\n');
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
