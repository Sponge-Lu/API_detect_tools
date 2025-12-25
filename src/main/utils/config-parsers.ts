/**
 * 输入: CLI 配置文件路径
 * 输出: 解析后的配置对象或 null
 * 定位: 工具层 - CLI 配置文件解析器
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseTomlFile } from './toml-parser';
import { parseEnvFile } from './env-parser';
import { CLI_CONFIG_PATHS } from '../../shared/types/config-detection';

// 简单的日志函数，避免在测试环境中依赖 electron
const log = {
  debug: (msg: string) => {
    if (process.env.NODE_ENV !== 'test') {
      console.debug(msg);
    }
  },
  error: (msg: string, error?: unknown) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error(msg, error);
    }
  },
};

// ============= Claude Code 配置类型 =============

/** Claude Code settings.json 配置结构 */
export interface ClaudeCodeConfig {
  env?: {
    ANTHROPIC_BASE_URL?: string;
    ANTHROPIC_AUTH_TOKEN?: string;
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_MODEL?: string;
  };
}

// ============= Codex 配置类型 =============

/** Codex config.toml 配置结构 */
export interface CodexConfig {
  model_provider?: string;
  model?: string;
  forced_login_method?: 'chatgpt' | 'api';
  model_providers?: {
    [key: string]: {
      name?: string;
      base_url?: string;
      wire_api?: string;
    };
  };
}

/** Codex auth.json 认证配置 */
export interface CodexAuthConfig {
  OPENAI_API_KEY?: string;
  /** OAuth tokens (ChatGPT 登录后的凭证) */
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
}

// ============= Gemini CLI 配置类型 =============

/** Gemini CLI settings.json 配置结构 */
export interface GeminiCliConfig {
  security?: {
    auth?: {
      selectedType?: string; // 'gemini-api-key' | 'google-login' | 'vertex-ai'
    };
  };
}

/** Gemini CLI .env 环境变量 */
export interface GeminiEnvConfig {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GOOGLE_GEMINI_BASE_URL?: string;
}

// ============= 解析函数 =============

/**
 * 获取配置文件的完整路径
 * @param relativePath 相对于用户主目录的路径
 */
function getConfigPath(relativePath: string): string {
  return path.join(os.homedir(), relativePath);
}

/**
 * 安全地解析 JSON 文件
 * @param filePath JSON 文件路径
 */
function parseJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      log.debug(`JSON file not found: ${filePath}`);
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    log.error(`Failed to parse JSON file: ${filePath}`, error);
    return null;
  }
}

/**
 * 解析 Claude Code 配置
 * @returns 解析后的配置对象，如果文件不存在或解析失败则返回 null
 */
export function parseClaudeCodeConfig(): ClaudeCodeConfig | null {
  const configPath = getConfigPath(CLI_CONFIG_PATHS.claudeCode.settings);
  return parseJsonFile<ClaudeCodeConfig>(configPath);
}

/**
 * 解析 Codex 配置 (config.toml)
 * @returns 解析后的配置对象，如果文件不存在或解析失败则返回 null
 */
export function parseCodexConfig(): CodexConfig | null {
  const configPath = getConfigPath(CLI_CONFIG_PATHS.codex.config);
  return parseTomlFile<CodexConfig>(configPath);
}

/**
 * 解析 Codex 认证配置 (auth.json)
 * @returns 解析后的配置对象，如果文件不存在或解析失败则返回 null
 */
export function parseCodexAuthConfig(): CodexAuthConfig | null {
  const configPath = getConfigPath(CLI_CONFIG_PATHS.codex.auth);
  return parseJsonFile<CodexAuthConfig>(configPath);
}

/**
 * 解析 Gemini CLI 配置 (settings.json)
 * @returns 解析后的配置对象，如果文件不存在或解析失败则返回 null
 */
export function parseGeminiCliConfig(): GeminiCliConfig | null {
  const configPath = getConfigPath(CLI_CONFIG_PATHS.geminiCli.settings);
  return parseJsonFile<GeminiCliConfig>(configPath);
}

/**
 * 解析 Gemini CLI 环境变量 (.env)
 * @returns 解析后的配置对象，如果文件不存在或解析失败则返回 null
 */
export function parseGeminiEnvConfig(): GeminiEnvConfig | null {
  const configPath = getConfigPath(CLI_CONFIG_PATHS.geminiCli.env);
  return parseEnvFile<GeminiEnvConfig>(configPath);
}

// ============= 提取函数 =============

/**
 * 从 Claude Code 配置中提取 URL 和 API Key
 */
export function extractClaudeCodeInfo(config: ClaudeCodeConfig | null): {
  baseUrl?: string;
  hasApiKey: boolean;
} {
  if (!config?.env) {
    return { hasApiKey: false };
  }

  const baseUrl = config.env.ANTHROPIC_BASE_URL;
  const hasApiKey = !!(config.env.ANTHROPIC_AUTH_TOKEN || config.env.ANTHROPIC_API_KEY);

  return { baseUrl, hasApiKey };
}

/**
 * 从 Codex 配置中提取 URL 和 API Key
 */
export function extractCodexInfo(
  config: CodexConfig | null,
  authConfig: CodexAuthConfig | null
): {
  baseUrl?: string;
  hasApiKey: boolean;
} {
  let baseUrl: string | undefined;

  // 从 model_providers 中提取 base_url
  if (config?.model_provider && config?.model_providers) {
    const provider = config.model_providers[config.model_provider];
    if (provider?.base_url) {
      baseUrl = provider.base_url;
    }
  }

  const hasApiKey = !!authConfig?.OPENAI_API_KEY;

  return { baseUrl, hasApiKey };
}

/**
 * 从 Gemini CLI 配置中提取 URL、API Key 和认证类型
 * @deprecated 使用 getEffectiveGeminiConfig() 代替，它会正确处理配置优先级
 */
export function extractGeminiCliInfo(
  config: GeminiCliConfig | null,
  envConfig: GeminiEnvConfig | null
): {
  baseUrl?: string;
  hasApiKey: boolean;
  isSubscription: boolean;
} {
  const baseUrl = envConfig?.GOOGLE_GEMINI_BASE_URL;
  const hasApiKey = !!envConfig?.GEMINI_API_KEY;
  const isSubscription = config?.security?.auth?.selectedType === 'google-login';

  return { baseUrl, hasApiKey, isSubscription };
}

// ============= 有效配置获取函数 =============

import { AuthType } from '../../shared/types/config-detection';

/** Claude Code 有效配置结果 */
export interface EffectiveClaudeCodeConfig {
  /** 检测到的 base URL */
  baseUrl?: string;
  /** 是否配置了 API Key */
  hasApiKey: boolean;
  /** 认证类型 */
  authType: AuthType;
}

/**
 * 获取 Claude Code 真正生效的配置
 *
 * 优先级规则:
 * 1. 环境变量 ANTHROPIC_BASE_URL
 * 2. settings.json env.ANTHROPIC_BASE_URL
 * 3. 默认官方 API (无 base_url 时)
 *
 * API Key 检测:
 * - 环境变量 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN
 * - settings.json env.ANTHROPIC_API_KEY 或 env.ANTHROPIC_AUTH_TOKEN
 *
 * @param config 可选的 settings.json 配置（用于测试注入）
 * @param processEnv 可选的环境变量（用于测试注入）
 * @returns 有效配置结果
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */
export function getEffectiveClaudeCodeConfig(
  config?: ClaudeCodeConfig | null,
  processEnv?: Record<string, string | undefined>
): EffectiveClaudeCodeConfig {
  // 使用注入的配置或读取实际配置
  const settingsConfig = config !== undefined ? config : parseClaudeCodeConfig();
  const env = processEnv !== undefined ? processEnv : process.env;

  // 1. 检查环境变量（优先级最高）
  // Requirements 3.1: 环境变量优先于 settings.json
  const envBaseUrl = env.ANTHROPIC_BASE_URL;
  const envApiKey = env.ANTHROPIC_API_KEY;
  const envAuthToken = env.ANTHROPIC_AUTH_TOKEN;

  // 2. 从 settings.json 读取配置
  const configBaseUrl = settingsConfig?.env?.ANTHROPIC_BASE_URL;
  const configApiKey = settingsConfig?.env?.ANTHROPIC_API_KEY;
  const configAuthToken = settingsConfig?.env?.ANTHROPIC_AUTH_TOKEN;

  // 3. 合并配置（环境变量优先）
  // Requirements 3.1, 3.2: 环境变量覆盖 settings.json
  const baseUrl = envBaseUrl || configBaseUrl;

  // 4. 检测 API Key
  // Requirements 3.3, 3.4: 检测环境变量和配置文件中的 API Key
  const hasApiKey = !!(envApiKey || envAuthToken || configApiKey || configAuthToken);

  // 5. 确定认证类型
  // Requirements 3.4, 3.5: 有 API Key 时为 api-key，否则为 unknown
  let authType: AuthType = 'unknown';
  if (hasApiKey) {
    authType = 'api-key';
  }

  return {
    baseUrl,
    hasApiKey,
    authType,
  };
}

/** Gemini CLI 有效配置结果 */
export interface EffectiveGeminiConfig {
  /** 检测到的 base URL */
  baseUrl?: string;
  /** 是否配置了 API Key */
  hasApiKey: boolean;
  /** 认证类型 */
  authType: AuthType;
  /** 是否为订阅账号（Google 登录或 Vertex AI） */
  isSubscription: boolean;
}

/**
 * 获取 Gemini CLI 真正生效的配置
 *
 * 优先级规则:
 * 1. settings.json 中的 security.auth.selectedType
 *    - google-login → subscription
 *    - vertex-ai → subscription
 *    - gemini-api-key → 继续检测 base_url
 * 2. 环境变量 GOOGLE_GEMINI_BASE_URL / GEMINI_API_KEY
 * 3. .env 文件 GOOGLE_GEMINI_BASE_URL / GEMINI_API_KEY
 * 4. 默认官方 API (无 base_url 时)
 *
 * @param config 可选的 settings.json 配置（用于测试注入）
 * @param envConfig 可选的 .env 配置（用于测试注入）
 * @param processEnv 可选的环境变量（用于测试注入）
 * @returns 有效配置结果
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */
// ============= Codex 有效配置获取函数 =============

/** Codex 有效配置结果 */
export interface EffectiveCodexConfig {
  /** 检测到的 base URL */
  baseUrl?: string;
  /** 是否配置了 API Key */
  hasApiKey: boolean;
  /** 认证类型 */
  authType: AuthType;
  /** 是否有 ChatGPT OAuth 凭证 */
  hasChatGptOAuth: boolean;
}

/**
 * 检查 Codex OAuth 状态
 *
 * 通过检查 ~/.codex/auth.json 中的 tokens 字段来判断用户是否已通过 ChatGPT OAuth 登录。
 * Codex 在用户登录后会在 auth.json 中存储 OAuth tokens。
 *
 * @param authConfig 可选的 auth.json 配置（用于测试注入）
 * @returns 是否存在 OAuth 凭证
 *
 * Requirements: 2.1
 */
export function checkCodexOAuthStatus(authConfig?: CodexAuthConfig | null): boolean {
  // 如果提供了配置，直接检查 tokens 字段
  if (authConfig !== undefined) {
    return !!(authConfig?.tokens?.access_token || authConfig?.tokens?.refresh_token);
  }

  // 否则读取实际配置
  const config = parseCodexAuthConfig();
  return !!(config?.tokens?.access_token || config?.tokens?.refresh_token);
}

/**
 * 获取 Codex 真正生效的配置
 *
 * 优先级规则（根据官方文档）:
 * 1. ChatGPT OAuth 凭证存在 且 forced_login_method 不是 'api' → official (OAuth 优先)
 * 2. config.toml model_provider.base_url (当 forced_login_method = 'api' 或无 OAuth 时)
 * 3. 环境变量 OPENAI_API_KEY + 默认官方 API
 * 4. auth.json OPENAI_API_KEY + 默认官方 API
 *
 * 关键点：当用户通过 ChatGPT OAuth 登录时，OAuth 登录会覆盖 base_url 配置，
 * 除非用户明确设置了 forced_login_method = 'api'
 *
 * @param config 可选的 config.toml 配置（用于测试注入）
 * @param authConfig 可选的 auth.json 配置（用于测试注入）
 * @param processEnv 可选的环境变量（用于测试注入）
 * @param oauthStatus 可选的 OAuth 状态（用于测试注入）
 * @returns 有效配置结果
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */
export function getEffectiveCodexConfig(
  config?: CodexConfig | null,
  authConfig?: CodexAuthConfig | null,
  processEnv?: Record<string, string | undefined>,
  oauthStatus?: boolean
): EffectiveCodexConfig {
  // 使用注入的配置或读取实际配置
  const tomlConfig = config !== undefined ? config : parseCodexConfig();
  const jsonAuthConfig = authConfig !== undefined ? authConfig : parseCodexAuthConfig();
  const env = processEnv !== undefined ? processEnv : process.env;

  // 检查 OAuth 状态：如果提供了 oauthStatus 参数，使用它；否则从 authConfig 检测
  const hasChatGptOAuth =
    oauthStatus !== undefined ? oauthStatus : checkCodexOAuthStatus(jsonAuthConfig);

  // 1. 检查环境变量中的 API Key
  const envApiKey = env.OPENAI_API_KEY;

  // 2. 提取 base_url（从 model_provider 配置）
  let baseUrl: string | undefined;
  let hasCustomProvider = false;

  if (tomlConfig?.model_provider && tomlConfig?.model_providers) {
    const provider = tomlConfig.model_providers[tomlConfig.model_provider];
    if (provider?.base_url) {
      baseUrl = provider.base_url;
      hasCustomProvider = true;
    }
  }

  // 3. 检测 API Key
  const hasApiKey = !!(envApiKey || jsonAuthConfig?.OPENAI_API_KEY);

  // 4. 检查 forced_login_method 配置
  const forcedLoginMethod = tomlConfig?.forced_login_method;
  const isApiForced = forcedLoginMethod === 'api';

  // 5. 确定认证类型和配置来源
  // Requirements 2.1: 如果有 OAuth 且未强制使用 API，OAuth 优先（覆盖 base_url 配置）
  if (hasChatGptOAuth && !isApiForced) {
    return {
      hasApiKey: false,
      authType: 'chatgpt-oauth',
      hasChatGptOAuth: true,
    };
  }

  // Requirements 2.2, 2.3: 如果强制使用 API 或无 OAuth，且有自定义 provider 配置，使用其 base_url
  if (hasCustomProvider && baseUrl) {
    return {
      baseUrl,
      hasApiKey,
      authType: hasApiKey ? 'api-key' : 'unknown',
      hasChatGptOAuth,
    };
  }

  // Requirements 2.3, 2.4: 有 API Key，使用官方 API
  if (hasApiKey) {
    return {
      hasApiKey: true,
      authType: 'api-key',
      hasChatGptOAuth,
    };
  }

  // Requirements 2.4: 无法确定配置
  return {
    hasApiKey: false,
    authType: 'unknown',
    hasChatGptOAuth,
  };
}

// ============= Gemini CLI 有效配置获取函数 =============

export function getEffectiveGeminiConfig(
  config?: GeminiCliConfig | null,
  envConfig?: GeminiEnvConfig | null,
  processEnv?: Record<string, string | undefined>
): EffectiveGeminiConfig {
  // 使用注入的配置或读取实际配置
  const settingsConfig = config !== undefined ? config : parseGeminiCliConfig();
  const dotEnvConfig = envConfig !== undefined ? envConfig : parseGeminiEnvConfig();
  const env = processEnv !== undefined ? processEnv : process.env;

  // 1. 首先检查 settings.json 中的认证类型
  const selectedType = settingsConfig?.security?.auth?.selectedType;

  // 2. 如果是 google-login 或 vertex-ai，直接返回订阅类型
  // Requirements 1.1, 1.2: 订阅认证优先，忽略 base_url 配置
  if (selectedType === 'google-login') {
    return {
      hasApiKey: false,
      authType: 'google-login',
      isSubscription: true,
    };
  }

  if (selectedType === 'vertex-ai') {
    return {
      hasApiKey: false,
      authType: 'vertex-ai',
      isSubscription: true,
    };
  }

  // 3. 检查环境变量（优先于 .env 文件）
  // Requirements 1.3, 1.5: 环境变量优先级高于配置文件
  const envApiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const envBaseUrl = env.GOOGLE_GEMINI_BASE_URL;

  // 4. 合并配置（环境变量优先）
  const baseUrl = envBaseUrl || dotEnvConfig?.GOOGLE_GEMINI_BASE_URL;
  const hasApiKey = !!(envApiKey || dotEnvConfig?.GEMINI_API_KEY);

  // 5. 确定认证类型
  // Requirements 1.4: 无 base_url 但有 API Key 时，使用官方 API
  let authType: AuthType = 'unknown';
  if (hasApiKey) {
    authType = 'gemini-api-key';
  }

  return {
    baseUrl,
    hasApiKey,
    authType,
    isSubscription: false,
  };
}
