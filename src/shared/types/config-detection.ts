/**
 * 输入: 无 (纯类型定义)
 * 输出: CLI 配置检测相关类型定义
 * 定位: 类型层 - CLI 配置检测功能的共享类型定义
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/shared/types/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * CLI 配置来源类型
 * - managed: 使用应用管理的站点
 * - official: 使用官方 API
 * - subscription: 使用订阅账号（如 Google 登录）
 * - other: 使用其他中转站
 * - unknown: 未配置或无法确定
 */
export type ConfigSourceType = 'managed' | 'official' | 'subscription' | 'other' | 'unknown';

/**
 * 认证类型
 * - google-login: Gemini CLI Google 登录
 * - vertex-ai: Gemini CLI Vertex AI
 * - gemini-api-key: Gemini CLI API Key
 * - chatgpt-oauth: Codex ChatGPT OAuth
 * - api-key: 通用 API Key 认证
 * - unknown: 未知
 */
export type AuthType =
  | 'google-login'
  | 'vertex-ai'
  | 'gemini-api-key'
  | 'chatgpt-oauth'
  | 'api-key'
  | 'unknown';

/**
 * 单个 CLI 的检测结果
 */
export interface CliDetectionResult {
  /** 配置来源类型 */
  sourceType: ConfigSourceType;
  /** 当 sourceType 为 'managed' 时，显示站点名称 */
  siteName?: string;
  /** 当 sourceType 为 'managed' 时，站点 ID */
  siteId?: string;
  /** 检测到的 base URL */
  baseUrl?: string;
  /** 是否配置了 API Key */
  hasApiKey: boolean;
  /** 认证类型 */
  authType?: AuthType;
  /** 错误信息 */
  error?: string;
  /** 检测时间戳 */
  detectedAt: number;
}

/**
 * 所有 CLI 的检测结果
 */
export interface AllCliDetectionResult {
  claudeCode: CliDetectionResult;
  codex: CliDetectionResult;
  geminiCli: CliDetectionResult;
}

/**
 * 站点信息（用于匹配）
 */
export interface SiteInfo {
  id: string;
  name: string;
  url: string;
}

/**
 * CLI 类型
 */
export type CliType = 'claudeCode' | 'codex' | 'geminiCli';

/**
 * 官方 API URL 配置
 */
export const OFFICIAL_API_URLS: Record<CliType, string[]> = {
  claudeCode: ['https://api.anthropic.com', 'api.anthropic.com'],
  codex: ['https://api.openai.com', 'api.openai.com'],
  geminiCli: ['https://generativelanguage.googleapis.com', 'generativelanguage.googleapis.com'],
};

/**
 * CLI 配置文件路径（相对于用户主目录）
 */
export const CLI_CONFIG_PATHS = {
  claudeCode: {
    settings: '.claude/settings.json',
  },
  codex: {
    config: '.codex/config.toml',
    auth: '.codex/auth.json',
  },
  geminiCli: {
    settings: '.gemini/settings.json',
    env: '.gemini/.env',
  },
} as const;

/**
 * 创建默认的检测结果
 */
export function createDefaultDetectionResult(): CliDetectionResult {
  return {
    sourceType: 'unknown',
    hasApiKey: false,
    detectedAt: Date.now(),
  };
}

/**
 * 创建默认的所有 CLI 检测结果
 */
export function createDefaultAllDetectionResult(): AllCliDetectionResult {
  return {
    claudeCode: createDefaultDetectionResult(),
    codex: createDefaultDetectionResult(),
    geminiCli: createDefaultDetectionResult(),
  };
}
