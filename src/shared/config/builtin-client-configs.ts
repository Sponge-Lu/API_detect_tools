import { buildVersionedApiUrl } from '../utils/apiConfig';
import {
  DEFAULT_CONFIG_FILE_AUTH_MODE,
  type ConfigFileAuthMode,
} from '../types/config-file-profile';
import {
  normalizeCodexFeatureFlagsToml,
  type BuiltinCliType,
  type CliTargetProtocol,
} from '../types/cli-config';

export interface BuiltinClientConfigValues {
  baseUrl: string;
  apiKey: string;
  model: string;
  siteName?: string;
}

export interface BuiltinClientConfigFile {
  path: string;
  content: string;
  format: 'json' | 'toml';
  containsSecrets?: boolean;
}

export const CODEX_PROVIDER_NAME = 'AnyAPI';
export const OPENCODE_PROVIDER_ID = 'anyapi';
export const OPENCODE_PROVIDER_NAME = 'AnyAPI';
export const OPENCODE_ROUTE_PROVIDER_IDS = {
  anthropic: 'api-detect-anthropic',
  responses: 'api-detect-responses',
  chat: 'api-detect-chat',
} as const;
export const GROK_BUILD_MANAGED_MODEL_IDS = {
  responses: 'api-detect-grok-responses',
  chat: 'api-detect-grok-chat',
  messages: 'api-detect-grok-messages',
} as const;

export type BuiltinClientConfigTemplateSet = Record<
  ConfigFileAuthMode,
  readonly BuiltinClientConfigFile[]
>;

/** Fixed examples shown in the configuration-file editor. These are not runtime builders. */
export const BUILTIN_CLIENT_CONFIG_TEMPLATES: Record<
  BuiltinCliType,
  BuiltinClientConfigTemplateSet
> = {
  claudeCode: {
    'third-party': [
      {
        path: '~/.claude/settings.json',
        content: `{
  "model": "{{MODEL}}",
  "language": "zh-CN",
  "env": {
    "ANTHROPIC_BASE_URL": "{{BASE_URL}}",
    "ANTHROPIC_AUTH_TOKEN": "{{API_KEY}}",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "{{MODEL}}",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "{{MODEL}}",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "{{MODEL}}",
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "true",
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}`,
        format: 'json',
        containsSecrets: true,
      },
      {
        path: '~/.claude/config.json',
        content: `{
  "primaryApiKey": "any"
}`,
        format: 'json',
      },
    ],
    official: [
      {
        path: '~/.claude/settings.json',
        content: `{
  "model": "opus[1m]",
  "language": "zh-CN",
  "env": {}
}`,
        format: 'json',
      },
    ],
  },
  codex: {
    'third-party': [
      {
        path: '~/.codex/config.toml',
        content: `model_provider = "AnyAPI"
model = "{{MODEL}}"
model_reasoning_effort = "xhigh"
# web_search 选项："disabled", "cached", "indexed", "live"；第三方中转建议 disabled
web_search = "disabled"

[model_providers.AnyAPI]
name = "AnyAPI"
base_url = "{{BASE_URL}}/v1"
experimental_bearer_token = "{{API_KEY}}"
# wire_api 固定使用 "responses" (Responses API，chat 模式已废弃)
wire_api = "responses"`,
        format: 'toml',
        containsSecrets: true,
      },
      {
        path: '~/.codex/auth.json',
        content: `{
  "OPENAI_API_KEY": "{{API_KEY}}"
}`,
        format: 'json',
        containsSecrets: true,
      },
    ],
    official: [
      {
        path: '~/.codex/config.toml',
        content: `# 官方账号登录：运行 codex login；本文件不包含第三方 provider
model_provider = "openai"
model = "gpt-6-sol"
model_reasoning_effort = "xhigh"
web_search = "cached"`,
        format: 'toml',
      },
    ],
  },
  openCode: {
    'third-party': [
      {
        path: '~/.config/opencode/opencode.json',
        content: `{
  "$schema": "https://opencode.ai/config.json",
  "model": "api-detect-responses/{{MODEL}}",
  "provider": {
    "api-detect-anthropic": {
      "npm": "@ai-sdk/anthropic",
      "name": "AnyAPI Anthropic",
      "options": { "baseURL": "{{BASE_URL}}/v1", "apiKey": "{{API_KEY}}" },
      "models": { "{{MODEL}}": { "name": "{{MODEL}}" } }
    },
    "api-detect-responses": {
      "npm": "@ai-sdk/openai",
      "name": "AnyAPI Responses",
      "options": { "baseURL": "{{BASE_URL}}/v1", "apiKey": "{{API_KEY}}" },
      "models": { "{{MODEL}}": { "name": "{{MODEL}}" } }
    },
    "api-detect-chat": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "AnyAPI Chat Completions",
      "options": { "baseURL": "{{BASE_URL}}/v1", "apiKey": "{{API_KEY}}" },
      "models": { "{{MODEL}}": { "name": "{{MODEL}}" } }
    }
  }
}`,
        format: 'json',
        containsSecrets: true,
      },
      {
        path: '~/.local/share/opencode/auth.json',
        content: `{
  "api-detect-anthropic": { "type": "api", "key": "{{API_KEY}}" },
  "api-detect-responses": { "type": "api", "key": "{{API_KEY}}" },
  "api-detect-chat": { "type": "api", "key": "{{API_KEY}}" }
}`,
        format: 'json',
        containsSecrets: true,
      },
    ],
    official: [
      {
        path: '~/.config/opencode/opencode.json',
        content: `{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
  "provider": {}
}`,
        format: 'json',
      },
    ],
  },
  grokBuild: {
    'third-party': [
      {
        path: '~/.grok/config.toml',
        content: `[models]
default = "api-detect-grok-responses"

[model.api-detect-grok-responses]
model = "{{MODEL}}"
base_url = "{{BASE_URL}}/v1"
name = "API Detect · Responses"
api_key = "{{API_KEY}}"
api_backend = "responses"
supports_backend_search = false
stream_tool_calls = false

[model.api-detect-grok-chat]
model = "{{MODEL}}"
base_url = "{{BASE_URL}}/v1"
name = "API Detect · Chat Completions"
api_key = "{{API_KEY}}"
api_backend = "chat_completions"
supports_backend_search = false
stream_tool_calls = false

[model.api-detect-grok-messages]
model = "{{MODEL}}"
base_url = "{{BASE_URL}}/v1"
name = "API Detect · Anthropic Messages"
api_backend = "messages"
extra_headers = { "x-api-key" = "{{API_KEY}}", "anthropic-version" = "2023-06-01" }`,
        format: 'toml',
        containsSecrets: true,
      },
    ],
    official: [
      {
        path: '~/.grok/config.toml',
        content: `# 官方账号登录：运行 grok login
[models]
default = "grok-4.6"`,
        format: 'toml',
      },
    ],
  },
};

export function getBuiltinClientConfigTemplates(
  clientType: BuiltinCliType,
  authMode: ConfigFileAuthMode = DEFAULT_CONFIG_FILE_AUTH_MODE
): BuiltinClientConfigFile[] {
  return BUILTIN_CLIENT_CONFIG_TEMPLATES[clientType][authMode].map(file => ({ ...file }));
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
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
  if (!beforeFamilyMatch) return null;
  return {
    family: beforeFamilyMatch[3] as 'sonnet' | 'opus',
    major: Number(beforeFamilyMatch[1]),
    minor: Number(beforeFamilyMatch[2] ?? '0'),
  };
}

export function resolveClaudeCodeDisplayModel(model: string): string {
  const parsed = parseClaudeVersionSegments(model);
  if (!parsed) return model;
  if (parsed.major > 4 || (parsed.major === 4 && parsed.minor >= 6)) {
    return parsed.family === 'sonnet' ? 'sonnet[1m]' : 'opus[1m]';
  }
  return model;
}

export function buildClaudeCodeConfigFiles(
  values: BuiltinClientConfigValues,
  _routeManaged = false
): BuiltinClientConfigFile[] {
  const env = {
    ANTHROPIC_AUTH_TOKEN: values.apiKey,
    ANTHROPIC_BASE_URL: normalizeUrl(values.baseUrl),
    ANTHROPIC_DEFAULT_HAIKU_MODEL: values.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: values.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: values.model,
    CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
  };
  return [
    {
      path: '~/.claude/settings.json',
      content: JSON.stringify(
        { model: resolveClaudeCodeDisplayModel(values.model), language: 'zh-CN', env },
        null,
        2
      ),
      format: 'json',
      containsSecrets: true,
    },
    {
      path: '~/.claude/config.json',
      content: JSON.stringify({ primaryApiKey: 'any' }, null, 2),
      format: 'json',
    },
  ];
}

export function buildCodexConfigFiles(
  values: BuiltinClientConfigValues,
  _routeManaged = false,
  wireApiComment = '# wire_api: 固定使用 "responses" (Responses API)'
): BuiltinClientConfigFile[] {
  const config = normalizeCodexFeatureFlagsToml(`model_provider = "${CODEX_PROVIDER_NAME}"
model = "${values.model}"
model_reasoning_effort = "xhigh"
web_search = "disabled"

[model_providers.${CODEX_PROVIDER_NAME}]
name = "${CODEX_PROVIDER_NAME}"
base_url = "${buildVersionedApiUrl(values.baseUrl)}"
experimental_bearer_token = "${escapeTomlString(values.apiKey)}"
${wireApiComment}
wire_api = "responses"`);
  return [
    { path: '~/.codex/config.toml', content: config, format: 'toml', containsSecrets: true },
    {
      path: '~/.codex/auth.json',
      content: JSON.stringify({ OPENAI_API_KEY: values.apiKey }, null, 2),
      format: 'json',
      containsSecrets: true,
    },
  ];
}

export function buildOpenCodeRouteConfigFiles(
  values: BuiltinClientConfigValues
): BuiltinClientConfigFile[] {
  const baseURL = buildVersionedApiUrl(values.baseUrl);
  const { anthropic, responses, chat } = OPENCODE_ROUTE_PROVIDER_IDS;
  const routeModel = { name: values.model };
  const config = {
    $schema: 'https://opencode.ai/config.json',
    model: `${responses}/${values.model}`,
    provider: {
      [anthropic]: {
        npm: '@ai-sdk/anthropic',
        name: `${OPENCODE_PROVIDER_NAME} Anthropic`,
        options: { baseURL, apiKey: values.apiKey },
        models: { [values.model]: routeModel },
      },
      [responses]: {
        npm: '@ai-sdk/openai',
        name: `${OPENCODE_PROVIDER_NAME} Responses`,
        options: { baseURL, apiKey: values.apiKey },
        models: { [values.model]: routeModel },
      },
      [chat]: {
        npm: '@ai-sdk/openai-compatible',
        name: `${OPENCODE_PROVIDER_NAME} Chat Completions`,
        options: { baseURL, apiKey: values.apiKey },
        models: { [values.model]: routeModel },
      },
    },
  };
  const auth = Object.fromEntries(
    Object.values(OPENCODE_ROUTE_PROVIDER_IDS).map(providerId => [
      providerId,
      { type: 'api', key: values.apiKey },
    ])
  );
  return [
    {
      path: '~/.config/opencode/opencode.json',
      content: JSON.stringify(config, null, 2),
      format: 'json',
      containsSecrets: true,
    },
    {
      path: '~/.local/share/opencode/auth.json',
      content: JSON.stringify(auth, null, 2),
      format: 'json',
      containsSecrets: true,
    },
  ];
}

function getGrokDefaultModelId(targetProtocol?: CliTargetProtocol): string {
  if (targetProtocol === 'anthropic-messages') return GROK_BUILD_MANAGED_MODEL_IDS.messages;
  if (targetProtocol === 'openai-chat-completions') return GROK_BUILD_MANAGED_MODEL_IDS.chat;
  return GROK_BUILD_MANAGED_MODEL_IDS.responses;
}

export function buildGrokBuildConfigFiles(
  values: BuiltinClientConfigValues,
  _routeManaged = false,
  targetProtocol?: CliTargetProtocol
): BuiltinClientConfigFile[] {
  const baseUrl = escapeTomlString(buildVersionedApiUrl(values.baseUrl));
  const apiKey = escapeTomlString(values.apiKey);
  const model = escapeTomlString(values.model);
  const siteName = escapeTomlString(values.siteName || 'API Detect');
  const messagesHeaders = `\nextra_headers = { "x-api-key" = "${apiKey}", "anthropic-version" = "2023-06-01" }`;
  const { responses, chat, messages } = GROK_BUILD_MANAGED_MODEL_IDS;
  const content = `[models]
default = "${getGrokDefaultModelId(targetProtocol)}"

[model.${responses}]
model = "${model}"
base_url = "${baseUrl}"
name = "${siteName} · Responses"
api_key = "${apiKey}"
api_backend = "responses"
supports_backend_search = false
stream_tool_calls = false

[model.${chat}]
model = "${model}"
base_url = "${baseUrl}"
name = "${siteName} · Chat Completions"
api_key = "${apiKey}"
api_backend = "chat_completions"
supports_backend_search = false
stream_tool_calls = false

[model.${messages}]
model = "${model}"
base_url = "${baseUrl}"
name = "${siteName} · Anthropic Messages"
api_backend = "messages"
supports_backend_search = false
stream_tool_calls = false${messagesHeaders}`;
  return [
    {
      path: '~/.grok/config.toml',
      content,
      format: 'toml',
      containsSecrets: true,
    },
  ];
}

export function buildBuiltinRouteConfigFiles(
  clientType: BuiltinCliType,
  values: BuiltinClientConfigValues
): BuiltinClientConfigFile[] {
  if (clientType === 'claudeCode') return buildClaudeCodeConfigFiles(values, true);
  if (clientType === 'codex') return buildCodexConfigFiles(values, true);
  if (clientType === 'openCode') return buildOpenCodeRouteConfigFiles(values);
  return buildGrokBuildConfigFiles(values, true, 'native');
}
