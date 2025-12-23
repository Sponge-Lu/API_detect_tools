/**
 * CLI 配置生成器服务
 *
 * 根据站点信息和用户选择的 API Key、模型生成 CLI 配置文件内容
 * 支持 Claude Code 和 Codex 配置生成
 * 配置模板参考 docs/cli_config_template/
 */

/** 配置生成参数 */
export interface ConfigParams {
  siteUrl: string;
  siteName: string;
  apiKey: string;
  model: string;
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

  // 按照模板生成 settings.json
  const settingsJson = {
    env: {
      ANTHROPIC_AUTH_TOKEN: normalizedApiKey,
      ANTHROPIC_BASE_URL: normalizedUrl,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: params.model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: params.model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: params.model,
      ANTHROPIC_MODEL: params.model,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      HTTP_PROXY: 'http://127.0.0.1:7890',
    },
    includeCoAuthoredBy: false,
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
  // 完全照搬模板文件内容，包含注释
  const settingsContent = `{
  "env": {
    "ANTHROPIC_BASE_URL": "https://anyrouter.top",   # URL需要去对应的站点确认
    "ANTHROPIC_AUTH_TOKEN": "sk-xxxxxxxxxxxxxxxx",   # 中转站使用这个，默认使用
    #"ANTHROPIC_API_KEY": "sk-xxxxxxxxxxxxxxxxxx",   # 标准 Anthropic 形式接口使用这个
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-opus-4-5-20251101",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-5-20251101",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-opus-4-5-20251101",
    "ANTHROPIC_MODEL": "claude-opus-4-5-20251101",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "true",
    "HTTPS_PROXY": "http://127.0.0.1:7890",
    "HTTP_PROXY": "http://127.0.0.1:7890"
  },
  "includeCoAuthoredBy": false
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
 * 生成 Codex 配置
 * 完全按照 docs/cli_config_template/codex_config_template.md 模板生成
 * @param params - 配置参数
 * @returns 生成的配置文件内容
 */
export function generateCodexConfig(params: ConfigParams): GeneratedConfig {
  const normalizedUrl = normalizeUrl(params.siteUrl);
  const normalizedApiKey = normalizeApiKey(params.apiKey);
  const providerName = params.siteName.replace(/\s+/g, '_');

  // 按照模板生成 config.toml
  const configToml = `model_provider = "${providerName}"
model = "${params.model}"
model_reasoning_effort = "high"
disable_response_storage = true
network_access = "enabled"

[model_providers.${providerName}]
name = "${providerName.toLowerCase()}"
base_url = "${normalizedUrl}/v1"
wire_api = "responses"
requires_openai_auth = true

[features]
web_search_request = true`;

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
  // 完全照搬模板文件内容，包含注释
  const configTomlTemplate = `model_provider = "IkunCoding"               //去提供商获取正确名字
model = "gpt-5.1-codex-max"
model_reasoning_effort = "high"
disable_response_storage = true
network_access = "enabled"

[model_providers.IkunCoding]                //去提供商获取正确名字
name = "ikun"                               //去提供商获取正确名字
base_url = "https://api.ikuncode.cc/v1"
wire_api = "responses"
requires_openai_auth = true

[features]
web_search_request = true`;

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
 * @param params - 配置参数
 * @returns 生成的配置文件内容
 */
export function generateGeminiCliConfig(params: ConfigParams): GeneratedConfig {
  const normalizedUrl = normalizeUrl(params.siteUrl);
  const normalizedApiKey = normalizeApiKey(params.apiKey);

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

  // 按照模板生成 .env
  const envContent = `GEMINI_API_KEY=${normalizedApiKey}
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
