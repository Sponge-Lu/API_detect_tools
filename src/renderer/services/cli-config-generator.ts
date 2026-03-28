/**
 * 输入: ConfigParams (站点 URL、API Key、模型), CodexTestDetail (Codex 测试结果), GeminiTestDetail (Gemini 测试结果)
 * 输出: GeneratedConfig (CLI 配置文件内容), ConfigParams, CodexConfigParams, GeminiConfigParams
 * 定位: 服务层 - CLI 配置生成器，根据站点信息和测试结果生成配置文件
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/services/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { pinyin } from 'pinyin-pro';

/**
 * CLI 配置生成器服务
 *
 * 根据站点信息和用户选择的 API Key、模型生成 CLI 配置文件内容
 * 支持 Claude Code、Codex、Gemini CLI 配置生成
 * Codex 配置固定使用 wire_api = "responses"（chat 模式已废弃）
 * Codex 配置支持中文站点名称自动转换为拼音（ASCII 兼容格式）
 * Gemini CLI 配置支持根据测试结果生成端点注释 (native/proxy)
 * 配置模板参考 docs/cli_config_template/
 */

/** 配置生成参数 */
export interface ConfigParams {
  siteUrl: string;
  siteName: string;
  apiKey: string;
  model: string;
}

/** Codex 配置生成参数（扩展） */
export interface CodexConfigParams extends ConfigParams {
  /** Codex 详细测试结果 */
  codexDetail?: {
    responses: boolean | null;
  };
}

/** Gemini CLI 配置生成参数（扩展） */
export interface GeminiConfigParams extends ConfigParams {
  /** Gemini CLI 详细测试结果，用于生成端点注释 */
  geminiDetail?: {
    native: boolean | null;
    proxy: boolean | null;
  };
}

/** 单个配置文件 */
export interface ConfigFile {
  path: string;
  content: string;
  language: 'json' | 'toml';
}

/** 生成的配置结果 */
export interface GeneratedConfig {
  files: ConfigFile[];
}

/**
 * 规范化 URL，移除尾部斜杠
 * @param url - 原始 URL
 * @returns 移除尾部斜杠后的 URL
 */
export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * 规范化 API Key，确保以 "sk-" 开头
 * @param apiKey - 原始 API Key
 * @returns 带 "sk-" 前缀的 API Key
 */
export function normalizeApiKey(apiKey: string): string {
  if (apiKey.startsWith('sk-')) {
    return apiKey;
  }
  return `sk-${apiKey}`;
}

/**
 * 生成 Claude Code 配置
 * 完全按照 docs/cli_config_template/cc_config_template.md 模板生成
 * @param params - 配置参数
 * @returns 生成的配置文件内容
 */
export function generateClaudeCodeConfig(params: ConfigParams): GeneratedConfig {
  const normalizedUrl = normalizeUrl(params.siteUrl);
  const normalizedApiKey = normalizeApiKey(params.apiKey);

  // 按照模板生成 settings.json（对齐 Claude Code 最新配置规范）
  const settingsJson = {
    model: params.model,
    language: 'zh-CN',
    env: {
      ANTHROPIC_AUTH_TOKEN: normalizedApiKey,
      ANTHROPIC_BASE_URL: normalizedUrl,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: params.model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: params.model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: params.model,
      CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      HTTP_PROXY: 'http://127.0.0.1:7890',
    },
  };

  // 按照模板生成 config.json
  const configJson = {
    primaryApiKey: 'any',
  };

  return {
    files: [
      {
        path: '~/.claude/settings.json',
        content: JSON.stringify(settingsJson, null, 2),
        language: 'json',
      },
      {
        path: '~/.claude/config.json',
        content: JSON.stringify(configJson, null, 2),
        language: 'json',
      },
    ],
  };
}

/**
 * 生成 Claude Code 配置模板（用于预览）
 * 完全照搬 docs/cli_config_template/cc_config_template.md 内容
 * @returns 配置模板内容
 */
export function generateClaudeCodeTemplate(): GeneratedConfig {
  // 完全照搬模板文件内容，包含注释（对齐 Claude Code 最新配置规范）
  const settingsContent = `{
  "model": "claude-opus-4-6",
  "language": "zh-CN",
  "env": {
    "ANTHROPIC_BASE_URL": "https://anyrouter.top",   # URL需要去对应的站点确认
    "ANTHROPIC_AUTH_TOKEN": "sk-xxxxxxxxxxxxxxxx",   # 中转站使用这个，默认使用
    #"ANTHROPIC_API_KEY": "sk-xxxxxxxxxxxxxxxxxx",   # 标准 Anthropic 形式接口使用这个
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-opus-4-6",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-6",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-opus-4-6",
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "true",
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
    "HTTPS_PROXY": "http://127.0.0.1:7890",
    "HTTP_PROXY": "http://127.0.0.1:7890"
  }
}`;

  const configContent = `## config.json (路径：~/.claude/config.json)
## 该文件仅配置一次即可，primaryApiKey填写任意字符即可
{
  "primaryApiKey": "any"
}`;

  return {
    files: [
      {
        path: '~/.claude/settings.json',
        content: settingsContent,
        language: 'json',
      },
      {
        path: '~/.claude/config.json',
        content: configContent,
        language: 'json',
      },
    ],
  };
}

/**
 * 返回 wire_api 值（固定为 "responses"，chat 模式已废弃）
 * @returns 固定返回 'responses'
 */
function selectWireApi(): string {
  return 'responses';
}

/**
 * 生成 wire_api 注释说明
 * @param codexDetail - Codex 详细测试结果
 * @returns 注释文本
 */
function generateWireApiComment(codexDetail?: { responses: boolean | null }): string {
  if (!codexDetail) {
    return '# wire_api: 固定使用 "responses" (Responses API)';
  }

  const responsesStatus =
    codexDetail.responses === true ? '✓' : codexDetail.responses === false ? '✗' : '?';

  return `# wire_api 测试结果: responses=${responsesStatus}`;
}

/**
 * 根据测试结果选择最佳端点格式
 * 优先级：proxy > native（proxy 兼容性更好，中转站常用）
 * @param geminiDetail - Gemini CLI 详细测试结果
 * @returns 推荐的端点格式
 */
export function selectEndpointFormat(geminiDetail?: {
  native: boolean | null;
  proxy: boolean | null;
}): 'proxy' | 'native' {
  if (!geminiDetail) {
    return 'proxy'; // 默认使用 proxy
  }

  const { native, proxy } = geminiDetail;

  // 优先使用 proxy（中转站兼容性更好）
  if (proxy === true) {
    return 'proxy';
  }

  // 如果 proxy 不支持但 native 支持，使用 native
  if (native === true) {
    return 'native';
  }

  // 都不支持或未测试，默认使用 proxy
  return 'proxy';
}

/**
 * 生成端点测试结果注释
 * native: Google 原生格式 (/v1beta/models/{model}:generateContent) - Gemini CLI 实际使用此格式
 * proxy: OpenAI 兼容格式 (/v1/chat/completions) - 仅供参考，Gemini CLI 不使用此格式
 * @param geminiDetail - Gemini CLI 详细测试结果
 * @returns 注释文本
 */
export function generateEndpointComment(geminiDetail?: {
  native: boolean | null;
  proxy: boolean | null;
}): string {
  if (!geminiDetail) {
    return `# 端点格式说明:
# - native: Google 原生格式 (/v1beta/models/{model}:generateContent) - Gemini CLI 使用此格式
# - proxy: OpenAI 兼容格式 (/v1/chat/completions) - 仅供参考`;
  }

  const nativeStatus =
    geminiDetail.native === true ? '✓' : geminiDetail.native === false ? '✗' : '?';
  const proxyStatus = geminiDetail.proxy === true ? '✓' : geminiDetail.proxy === false ? '✗' : '?';

  // 添加使用建议
  let advice = '';
  if (geminiDetail.native === true) {
    advice = '\n# ✓ 原生格式可用，Gemini CLI 应该可以正常工作';
  } else if (geminiDetail.native === false && geminiDetail.proxy === true) {
    advice = '\n# ⚠️ 仅兼容格式可用，Gemini CLI 可能无法正常工作（CLI 使用原生格式）';
  } else if (geminiDetail.native === false && geminiDetail.proxy === false) {
    advice = '\n# ✗ 两种格式均不可用，Gemini CLI 无法使用此站点';
  }

  return `# 端点测试结果: native=${nativeStatus}, proxy=${proxyStatus}
# - native: Google 原生格式 - Gemini CLI 实际使用此格式
# - proxy: OpenAI 兼容格式 - 仅供参考${advice}`;
}

/**
 * 生成 Codex 配置
 * 完全按照 docs/cli_config_template/codex_config_template.md 模板生成
 * @param params - 配置参数（支持 codexDetail 用于自动选择 wire_api）
 * @returns 生成的配置文件内容
 */
/**
 * 将站点名称转换为 ASCII 兼容的提供商名称
 * 中文字符会被转换为拼音，其他非英文字符会被移除
 * @param siteName - 原始站点名称（可能包含中文或其他语言）
 * @returns 仅包含英文字母、数字和下划线的提供商名称
 */
export function sanitizeProviderName(siteName: string): string {
  // 使用 pinyin-pro 将中文转换为拼音（无声调，连续输出）
  let name = pinyin(siteName, { toneType: 'none', type: 'array' }).join('');

  // 移除所有非英文字母和数字的字符（包括其他语言文字）
  name = name.replace(/[^a-zA-Z0-9]/g, '_');

  // 移除连续的下划线
  name = name.replace(/_+/g, '_');

  // 移除首尾下划线
  name = name.replace(/^_+|_+$/g, '');

  // 确保名称以字母开头（TOML 标识符要求）
  if (!/^[a-zA-Z]/.test(name)) {
    name = 'P_' + name;
  }

  // 首字母大写，使其更像提供商名称
  if (name.length > 0) {
    name = name.charAt(0).toUpperCase() + name.slice(1);
  }

  return name || 'Provider';
}

export function generateCodexConfig(params: CodexConfigParams): GeneratedConfig {
  const normalizedUrl = normalizeUrl(params.siteUrl);
  const normalizedApiKey = normalizeApiKey(params.apiKey);
  const providerName = sanitizeProviderName(params.siteName);

  // wire_api 固定为 responses（chat 模式已废弃）
  const wireApi = selectWireApi();
  const wireApiComment = generateWireApiComment(params.codexDetail);

  // 按照模板生成 config.toml，添加测试结果注释
  const configToml = `model_provider = "${providerName}"
model = "${params.model}"
model_reasoning_effort = "high"
disable_response_storage = true
network_access = "enabled"

[model_providers.${providerName}]
name = "${providerName.toLowerCase()}"
base_url = "${normalizedUrl}/v1"
${wireApiComment}
wire_api = "${wireApi}"
requires_openai_auth = true

web_search = "cached"`;

  // 按照模板生成 auth.json
  const authJson = {
    OPENAI_API_KEY: normalizedApiKey,
  };

  return {
    files: [
      {
        path: '~/.codex/config.toml',
        content: configToml,
        language: 'toml',
      },
      {
        path: '~/.codex/auth.json',
        content: JSON.stringify(authJson, null, 2),
        language: 'json',
      },
    ],
  };
}

/**
 * 生成 Codex 配置模板（用于预览）
 * 完全照搬 docs/cli_config_template/codex_config_template.md 内容
 * @returns 配置模板内容
 */
export function generateCodexTemplate(): GeneratedConfig {
  // 完全照搬模板文件内容，包含注释和 wire_api 说明
  const configTomlTemplate = `model_provider = "IkunCoding"
model = "gpt-5.1-codex-max"
model_reasoning_effort = "high"
disable_response_storage = true
network_access = "enabled"

[model_providers.IkunCoding]
name = "ikun"
base_url = "https://api.ikuncode.cc/v1"
# wire_api 固定使用 "responses" (Responses API，chat 模式已废弃)
wire_api = "responses"
requires_openai_auth = true

web_search = "cached"`;

  const authJsonTemplate = `{
  "OPENAI_API_KEY": "sk-xxxxxxxxxxxxxxx"
}`;

  return {
    files: [
      {
        path: '~/.codex/config.toml',
        content: configTomlTemplate,
        language: 'toml',
      },
      {
        path: '~/.codex/auth.json',
        content: authJsonTemplate,
        language: 'json',
      },
    ],
  };
}

/**
 * 生成 Gemini CLI 配置
 * 完全按照 docs/cli_config_template/gemini_cli_config_template.md 模板生成
 * @param params - 配置参数（支持 geminiDetail 用于生成端点注释）
 * @returns 生成的配置文件内容
 */
export function generateGeminiCliConfig(params: GeminiConfigParams): GeneratedConfig {
  const normalizedUrl = normalizeUrl(params.siteUrl);
  const normalizedApiKey = normalizeApiKey(params.apiKey);

  // 生成端点测试结果注释
  const endpointComment = generateEndpointComment(params.geminiDetail);

  // 按照模板生成 settings.json
  const settingsJson = {
    general: {
      previewFeatures: true,
    },
    ide: {
      hasSeenNudge: true,
    },
    maxRetries: 3,
    security: {
      auth: {
        selectedType: 'gemini-api-key',
      },
    },
    timeout: 30000,
  };

  // 按照模板生成 .env，添加测试结果注释
  const envContent = `${endpointComment}
GEMINI_API_KEY=${normalizedApiKey}
GEMINI_MODEL=${params.model}
GOOGLE_GEMINI_BASE_URL=${normalizedUrl}`;

  return {
    files: [
      {
        path: '~/.gemini/settings.json',
        content: JSON.stringify(settingsJson, null, 2),
        language: 'json',
      },
      {
        path: '~/.gemini/.env',
        content: envContent,
        language: 'toml', // 使用 toml 高亮 dotenv 文件
      },
    ],
  };
}

/**
 * 生成 Gemini CLI 配置模板（用于预览）
 * 完全照搬 docs/cli_config_template/gemini_cli_config_template.md 内容
 * @returns 配置模板内容
 */
export function generateGeminiCliTemplate(): GeneratedConfig {
  const settingsContent = `{
  "general": {
    "previewFeatures": true
  },
  "ide": {
    "hasSeenNudge": true
  },
  "maxRetries": 3,
  "security": {
    "auth": {
      "selectedType": "gemini-api-key"
    }
  },
  "timeout": 30000
}`;

  const envContent = `GEMINI_API_KEY=sk-xxxxxxxxxxxxxxxxx
GEMINI_MODEL=gemini-3-pro-high
GOOGLE_GEMINI_BASE_URL=https://x666.me`;

  return {
    files: [
      {
        path: '~/.gemini/settings.json',
        content: settingsContent,
        language: 'json',
      },
      {
        path: '~/.gemini/.env',
        content: envContent,
        language: 'toml',
      },
    ],
  };
}
