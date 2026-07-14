/**
 * 输入: ConfigParams (站点 URL、API Key、模型), CodexTestDetail (Codex 测试结果)
 * 输出: GeneratedConfig (CLI 配置文件内容), ConfigParams, CodexConfigParams
 * 定位: 服务层 - CLI 配置生成器，根据站点信息和测试结果生成配置文件
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/services/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { pinyin } from 'pinyin-pro';
import {
  normalizeCliTargetProtocol,
  normalizeCodexFeatureFlagsToml,
  type CliTargetProtocol,
} from '../../shared/types/cli-config';

/**
 * CLI 配置生成器服务
 *
 * 根据站点信息和用户选择的 API Key、模型生成 CLI 配置文件内容
 * 支持 Claude Code、Codex 配置生成
 * Codex 配置固定使用 wire_api = "responses"（chat 模式已废弃）
 * Codex 配置支持中文站点名称自动转换为拼音（ASCII 兼容格式）
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

export interface OpenCodeConfigParams extends ConfigParams {
  targetProtocol?: CliTargetProtocol;
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

export const CODEX_PROVIDER_NAME = 'AnyAPI';
export const OPENCODE_PROVIDER_ID = 'anyapi';
export const OPENCODE_PROVIDER_NAME = 'AnyAPI';

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

function parseClaudeVersionSegments(
  model: string
): { family: 'sonnet' | 'opus'; major: number; minor: number } | null {
  const normalized = model.trim().toLowerCase();
  const afterFamilyMatch = normalized.match(/(?:^|[-_])(sonnet|opus)(?:[-_]?)(\d+)(?:[.-](\d+))?/i);
  if (afterFamilyMatch) {
    return {
      family: afterFamilyMatch[1] as 'sonnet' | 'opus',
      major: Number(afterFamilyMatch[2]),
      minor: Number(afterFamilyMatch[3] ?? '0'),
    };
  }

  const beforeFamilyMatch = normalized.match(
    /(?:^|[-_])(\d+)(?:[.-](\d+))?[-_](sonnet|opus)(?:[-_]|$)/i
  );
  if (!beforeFamilyMatch) {
    return null;
  }

  return {
    family: beforeFamilyMatch[3] as 'sonnet' | 'opus',
    major: Number(beforeFamilyMatch[1]),
    minor: Number(beforeFamilyMatch[2] ?? '0'),
  };
}

export function resolveClaudeCodeDisplayModel(model: string): string {
  const parsed = parseClaudeVersionSegments(model);
  if (!parsed) {
    return model;
  }

  if (parsed.major > 4 || (parsed.major === 4 && parsed.minor >= 6)) {
    return parsed.family === 'sonnet' ? 'sonnet[1m]' : 'opus[1m]';
  }

  return model;
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
  const displayModel = resolveClaudeCodeDisplayModel(params.model);

  // 按照模板生成 settings.json（对齐 Claude Code 最新配置规范）
  const settingsJson = {
    model: displayModel,
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
  "model": "opus[1m]",
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
  const providerName = CODEX_PROVIDER_NAME;

  // wire_api 固定为 responses（chat 模式已废弃）
  const wireApi = selectWireApi();
  const wireApiComment = generateWireApiComment(params.codexDetail);

  // 按照模板生成 config.toml，添加测试结果注释
  // 注意：移除 requires_openai_auth = true，因为它会强制使用 OpenAI 官方认证流程，
  // 导致无法使用第三方 API。第三方 API 通过 OPENAI_API_KEY 环境变量认证即可。
  const configToml = normalizeCodexFeatureFlagsToml(`model_provider = "${providerName}"
model = "${params.model}"
model_reasoning_effort = "xhigh"
disable_response_storage = true
network_access = "enabled"

[model_providers.${providerName}]
name = "${providerName}"
base_url = "${normalizedUrl}/v1"
${wireApiComment}
wire_api = "${wireApi}"

web_search = "cached"`);

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
  // 注意：移除 requires_openai_auth = true，因为它会强制使用 OpenAI 官方认证流程，
  // 导致无法使用第三方 API。第三方 API 通过 OPENAI_API_KEY 环境变量认证即可。
  const configTomlTemplate =
    normalizeCodexFeatureFlagsToml(`model_provider = "${CODEX_PROVIDER_NAME}"
model = "gpt-5.1-codex-max"
model_reasoning_effort = "xhigh"
disable_response_storage = true
network_access = "enabled"

[model_providers.${CODEX_PROVIDER_NAME}]
name = "${CODEX_PROVIDER_NAME}"
base_url = "https://api.ikuncode.cc/v1"
# wire_api 固定使用 "responses" (Responses API，chat 模式已废弃)
wire_api = "responses"

web_search = "cached"`);

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

function resolveOpenCodeMode(
  targetProtocol?: CliTargetProtocol
): Exclude<CliTargetProtocol, 'native'> {
  const normalized = normalizeCliTargetProtocol(targetProtocol);
  return normalized === 'native' ? 'openai-chat-completions' : normalized;
}

function buildOpenCodeProviderConfig(params: OpenCodeConfigParams): {
  providerId: string;
  modelId: string;
  config: Record<string, unknown>;
} {
  const mode = resolveOpenCodeMode(params.targetProtocol);
  const baseURL = `${normalizeUrl(params.siteUrl)}/v1`;

  if (mode === 'anthropic-messages') {
    return {
      providerId: 'anthropic',
      modelId: `anthropic/${params.model}`,
      config: {
        provider: {
          anthropic: {
            options: { baseURL },
            models: {
              [params.model]: { name: params.model },
            },
          },
        },
      },
    };
  }

  if (mode === 'openai-responses') {
    return {
      providerId: 'openai',
      modelId: `openai/${params.model}`,
      config: {
        provider: {
          openai: {
            options: { baseURL },
            models: {
              [params.model]: { name: params.model },
            },
          },
        },
      },
    };
  }

  return {
    providerId: OPENCODE_PROVIDER_ID,
    modelId: `${OPENCODE_PROVIDER_ID}/${params.model}`,
    config: {
      provider: {
        [OPENCODE_PROVIDER_ID]: {
          npm: '@ai-sdk/openai-compatible',
          name: OPENCODE_PROVIDER_NAME,
          options: { baseURL },
          models: {
            [params.model]: { name: params.model },
          },
        },
      },
    },
  };
}

export function generateOpenCodeConfig(params: OpenCodeConfigParams): GeneratedConfig {
  const normalizedApiKey = normalizeApiKey(params.apiKey);
  const { providerId, modelId, config } = buildOpenCodeProviderConfig(params);
  const opencodeJson = {
    $schema: 'https://opencode.ai/config.json',
    model: modelId,
    ...config,
  };
  const authJson = {
    [providerId]: {
      type: 'api',
      key: normalizedApiKey,
    },
  };

  return {
    files: [
      {
        path: '~/.config/opencode/opencode.json',
        content: JSON.stringify(opencodeJson, null, 2),
        language: 'json',
      },
      {
        path: '~/.local/share/opencode/auth.json',
        content: JSON.stringify(authJson, null, 2),
        language: 'json',
      },
    ],
  };
}

export function generateOpenCodeTemplate(): GeneratedConfig {
  return generateOpenCodeConfig({
    siteUrl: 'https://api.example.com',
    siteName: 'AnyAPI',
    apiKey: 'sk-xxxxxxxxxxxxxxx',
    model: 'gpt-5.1',
    targetProtocol: 'openai-chat-completions',
  });
}
