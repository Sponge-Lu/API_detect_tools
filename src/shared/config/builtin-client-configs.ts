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

/** Fixed examples shown in the configuration-file editor. These are not runtime builders. */
export const BUILTIN_CLIENT_CONFIG_TEMPLATES: Record<
  BuiltinCliType,
  readonly BuiltinClientConfigFile[]
> = {
  claudeCode: [
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
  codex: [
    {
      path: '~/.codex/config.toml',
      content: `model_provider = "AnyAPI"
model = "{{MODEL}}"
model_reasoning_effort = "xhigh"
disable_response_storage = true
network_access = "enabled"

[model_providers.AnyAPI]
name = "AnyAPI"
base_url = "{{BASE_URL}}/v1"
env_key = "OPENAI_API_KEY"
# wire_api 固定使用 "responses" (Responses API，chat 模式已废弃)
wire_api = "responses"

# web_search 选项："cached", "live", "disabled"
web_search = "cached"`,
      format: 'toml',
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
  openCode: [
    {
      path: '~/.config/opencode/opencode.json',
      content: `{
  "$schema": "https://opencode.ai/config.json",
  "model": "api-detect-responses/{{MODEL}}",
  "provider": {
    "api-detect-anthropic": {
      "npm": "@ai-sdk/anthropic",
      "name": "AnyAPI Anthropic",
      "options": { "baseURL": "{{BASE_URL}}/v1" },
      "models": { "{{MODEL}}": { "name": "{{MODEL}}" } }
    },
    "api-detect-responses": {
      "npm": "@ai-sdk/openai",
      "name": "AnyAPI Responses",
      "options": { "baseURL": "{{BASE_URL}}/v1" },
      "models": { "{{MODEL}}": { "name": "{{MODEL}}" } }
    },
    "api-detect-chat": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "AnyAPI Chat Completions",
      "options": { "baseURL": "{{BASE_URL}}/v1" },
      "models": { "{{MODEL}}": { "name": "{{MODEL}}" } }
    }
  }
}`,
      format: 'json',
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
  grokBuild: [
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
extra_headers = { "x-api-key" = "{{API_KEY}}" }`,
      format: 'toml',
      containsSecrets: true,
    },
  ],
};

export function getBuiltinClientConfigTemplates(
  clientType: BuiltinCliType
): BuiltinClientConfigFile[] {
  return BUILTIN_CLIENT_CONFIG_TEMPLATES[clientType].map(file => ({ ...file }));
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
disable_response_storage = true
network_access = "enabled"

[model_providers.${CODEX_PROVIDER_NAME}]
name = "${CODEX_PROVIDER_NAME}"
base_url = "${normalizeUrl(values.baseUrl)}/v1"
env_key = "OPENAI_API_KEY"
${wireApiComment}
wire_api = "responses"

web_search = "cached"`);
  return [
    { path: '~/.codex/config.toml', content: config, format: 'toml' },
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
  const baseURL = `${normalizeUrl(values.baseUrl)}/v1`;
  const { anthropic, responses, chat } = OPENCODE_ROUTE_PROVIDER_IDS;
  const routeModel = { name: values.model };
  const config = {
    $schema: 'https://opencode.ai/config.json',
    model: `${responses}/${values.model}`,
    provider: {
      [anthropic]: {
        npm: '@ai-sdk/anthropic',
        name: `${OPENCODE_PROVIDER_NAME} Anthropic`,
        options: { baseURL },
        models: { [values.model]: routeModel },
      },
      [responses]: {
        npm: '@ai-sdk/openai',
        name: `${OPENCODE_PROVIDER_NAME} Responses`,
        options: { baseURL },
        models: { [values.model]: routeModel },
      },
      [chat]: {
        npm: '@ai-sdk/openai-compatible',
        name: `${OPENCODE_PROVIDER_NAME} Chat Completions`,
        options: { baseURL },
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
  const baseUrl = escapeTomlString(`${normalizeUrl(values.baseUrl)}/v1`);
  const apiKey = escapeTomlString(values.apiKey);
  const model = escapeTomlString(values.model);
  const siteName = escapeTomlString(values.siteName || 'API Detect');
  const messagesHeaders = `\nextra_headers = { "x-api-key" = "${apiKey}" }`;
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
