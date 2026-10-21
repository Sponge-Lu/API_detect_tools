import {
  ENDPOINT_TEST_PROTOCOLS,
  type EndpointTestApiKeyOption,
  type EndpointTestProtocol,
  type EndpointTestResult,
  type EndpointTestSelectionInput,
  type EndpointTestSelectionState,
  type EndpointTestStateView,
  type EndpointTestTarget,
  type EndpointTestTargetState,
} from '../shared/types/endpoint-test';
import {
  BUILTIN_GROUP_IDS,
  isAnyRouterSite,
  isApiKeyActive,
  type ApiKeyInfo,
} from '../shared/types/site';
import {
  buildCustomCliRouteApiKeyId,
  loadCustomCliConfigStorage,
} from './custom-cli-config-service';
import { normalizeCustomCliApiKeys } from '../shared/types/custom-cli-config';
import { resolveApiKeyId } from './api-key-identity';
import { endpointTestStateService } from './endpoint-test-state-service';
import { unifiedConfigManager } from './unified-config-manager';
import {
  isMaskedApiKeyValue,
  resolveUpstreamCredentials,
  type UpstreamCredentialTarget,
} from './upstream-credential-resolver';
import { httpRawRequest } from './utils/http-client';

const MAX_SUMMARY_LENGTH = 1000;
const MAX_ERROR_LENGTH = 200;
const DEFAULT_TIMEOUT_MS = 60000;
const ANYROUTER_TIMEOUT_MS = 120000;
const TEST_PROMPT = '1.2和1.19哪个更大？';
const API_KEY_PLACEHOLDER = '{{API_KEY}}';
const MODEL_PLACEHOLDER = '{{MODEL}}';
const BASE_URL_PLACEHOLDER = '{{BASE_URL}}';
const MAX_CURL_LENGTH = 65536;
const MAX_CURL_HEADERS = 100;
const MAX_CURL_BODY_LENGTH = 262144;

const ENDPOINTS: Record<EndpointTestProtocol, string> = {
  'anthropic-messages': '/v1/messages',
  'openai-responses': '/v1/responses',
  'openai-chat-completions': '/v1/chat/completions',
};

interface ResolvedEndpointTestTarget {
  target: EndpointTestTarget;
  targetKey: string;
  baseUrl: string;
  authScheme?: EndpointAuthScheme;
  apiKeys: Array<EndpointTestApiKeyOption & { credentialTarget: UpstreamCredentialTarget }>;
  models: string[];
  timeoutMs: number;
}

interface ParsedCurlRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

function maskApiKeyForDisplay(value: unknown): string {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  if (isMaskedApiKeyValue(normalized)) return normalized;
  if (normalized.length <= 4) return '****';

  const visibleLength = Math.ceil(normalized.length / 2);
  const prefixLength = Math.ceil(visibleLength / 2);
  const suffixLength = visibleLength - prefixLength;
  const maskedLength = Math.max(4, normalized.length - visibleLength);

  return `${normalized.slice(0, prefixLength)}${'*'.repeat(maskedLength)}${normalized.slice(
    -suffixLength
  )}`;
}

function summarize(value: string): string {
  return value.trim().slice(0, MAX_SUMMARY_LENGTH);
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === 'object') {
    const nestedMessage = normalizeText((error as Record<string, unknown>).message);
    if (nestedMessage) return nestedMessage;
  }
  return normalizeText(record.message) || normalizeText(error);
}

function summarizeFailure(responseText: string, statusCode: number, payload: unknown): string {
  const structuredMessage = extractErrorMessage(payload);
  const plainText = payload || /^\s*</.test(responseText) ? '' : responseText;
  const detail = compactText((structuredMessage || plainText).split(/\r?\n/)[0]);
  return compactText(detail ? `HTTP ${statusCode}：${detail}` : `HTTP ${statusCode}`).slice(
    0,
    MAX_ERROR_LENGTH
  );
}

function summarizeRequestError(error: unknown): string {
  if (error && typeof error === 'object' && (error as { name?: unknown }).name === 'TimeoutError') {
    return '请求超时';
  }
  const message = error instanceof Error ? compactText(error.message) : '';
  if (/timed?\s*out|timeout/i.test(message)) return '请求超时';
  if (/fetch failed|network|econn|enotfound|socket/i.test(message)) return '网络请求失败';
  return (message || '测试请求失败').slice(0, MAX_ERROR_LENGTH);
}

function collectManagedModels(
  models: string[],
  modelPricing?: { data?: Record<string, { enable_groups?: string[] }> }
): string[] {
  return uniqueStrings([...models, ...Object.keys(modelPricing?.data || {})]);
}

function getModelsForApiKey(
  models: string[],
  modelPricing: { data?: Record<string, { enable_groups?: string[] }> } | undefined,
  apiKey: ApiKeyInfo
): string[] {
  const group = normalizeText(apiKey.group);
  if (!group || !modelPricing?.data) return models;
  return models.filter(model => modelPricing.data?.[model]?.enable_groups?.includes(group));
}

function buildTargetKey(target: EndpointTestTarget): string {
  return target.kind === 'managed'
    ? `managed:${target.siteId}:${target.accountId}`
    : `direct:${target.configId}`;
}

function createSelectionState(
  stored: EndpointTestSelectionState | undefined,
  apiKeys: EndpointTestApiKeyOption[],
  models: string[],
  protocol: EndpointTestProtocol,
  baseUrl: string,
  authScheme: EndpointAuthScheme | undefined
): EndpointTestSelectionState {
  const storedApiKeyId = stored?.apiKeyId;
  return {
    // 存量 apiKeyId 必须仍存在于当前 key 列表，否则回退首项，避免悬空值让下拉无法选中
    apiKeyId:
      (storedApiKeyId && apiKeys.some(apiKey => apiKey.id === storedApiKeyId)
        ? storedApiKeyId
        : apiKeys[0]?.id) || null,
    model: stored?.model || models[0] || null,
    curl: normalizeText(stored?.curl)
      ? stored!.curl
      : buildDefaultCurl(
          protocol,
          baseUrl,
          resolveEndpointAuthScheme(protocol, authScheme),
          MODEL_PLACEHOLDER
        ),
    ...(stored?.latest ? { latest: stored.latest } : {}),
  };
}

function extractMessagesText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .map(item =>
      item && typeof item === 'object' && (item as { type?: unknown }).type === 'text'
        ? normalizeText((item as { text?: unknown }).text)
        : ''
    )
    .filter(Boolean)
    .join('\n');
}

function extractResponsesText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const response = payload as { output_text?: unknown; output?: unknown };
  const topLevel = normalizeText(response.output_text);
  if (topLevel) return topLevel;
  if (!Array.isArray(response.output)) return '';

  return response.output
    .flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const content = (item as { content?: unknown }).content;
      return Array.isArray(content) ? content : [];
    })
    .map(item => {
      if (!item || typeof item !== 'object') return '';
      const block = item as { type?: unknown; text?: unknown };
      return block.type === 'output_text' ? normalizeText(block.text) : '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractChatCompletionsText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return '';
  return choices
    .map(choice => {
      if (!choice || typeof choice !== 'object') return '';
      const message = (choice as { message?: unknown }).message;
      return message && typeof message === 'object'
        ? normalizeText((message as { content?: unknown }).content)
        : '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractGeneratedText(protocol: EndpointTestProtocol, payload: unknown): string {
  if (protocol === 'anthropic-messages') return extractMessagesText(payload);
  if (protocol === 'openai-responses') return extractResponsesText(payload);
  return extractChatCompletionsText(payload);
}

function buildRequestBody(protocol: EndpointTestProtocol, model: string): Record<string, unknown> {
  if (protocol === 'anthropic-messages') {
    return {
      model,
      max_tokens: 1024,
      stream: false,
      messages: [{ role: 'user', content: TEST_PROMPT }],
    };
  }
  if (protocol === 'openai-responses') {
    return { model, input: TEST_PROMPT, max_output_tokens: 32, stream: false, store: false };
  }
  return {
    model,
    max_tokens: 32,
    stream: false,
    messages: [{ role: 'user', content: TEST_PROMPT }],
  };
}

type EndpointAuthScheme = 'bearer' | 'x-api-key';

function resolveEndpointAuthScheme(
  protocol: EndpointTestProtocol,
  configuredScheme: EndpointAuthScheme | undefined
): EndpointAuthScheme {
  if (configuredScheme) return configuredScheme;
  return protocol === 'anthropic-messages' ? 'x-api-key' : 'bearer';
}

function buildHeaders(
  protocol: EndpointTestProtocol,
  apiKey: string,
  authScheme: EndpointAuthScheme
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authScheme === 'x-api-key') {
    headers['x-api-key'] = apiKey;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (protocol === 'anthropic-messages') {
    headers['anthropic-version'] = '2023-06-01';
  }
  return headers;
}

function joinEndpointUrl(baseUrl: string, endpoint: string): string {
  const parsed = new URL(baseUrl);
  const baseSegments = parsed.pathname.split('/').filter(Boolean);
  const endpointSegments = endpoint.split('/').filter(Boolean);
  let overlap = 0;
  const maxOverlap = Math.min(baseSegments.length, endpointSegments.length);
  for (let size = 1; size <= maxOverlap; size += 1) {
    const baseSuffix = baseSegments.slice(-size);
    const endpointPrefix = endpointSegments.slice(0, size);
    if (baseSuffix.every((segment, index) => segment === endpointPrefix[index])) {
      overlap = size;
    }
  }
  parsed.pathname = `/${[...baseSegments, ...endpointSegments.slice(overlap)].join('/')}`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function serializeCurl(request: ParsedCurlRequest): string {
  const lines = [`curl --request ${request.method} ${shellQuote(request.url)}`];
  for (const [name, value] of Object.entries(request.headers)) {
    lines.push(`  --header ${shellQuote(`${name}: ${value}`)}`);
  }
  if (request.body) {
    lines.push(`  --data-raw ${shellQuote(request.body)}`);
  }
  return lines.join(' \\\n');
}

function normalizeBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  parsed.search = '';
  parsed.hash = '';
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return pathname ? `${parsed.origin}${pathname}` : parsed.origin;
}

function replaceUrlWithBasePlaceholder(requestUrl: string, baseUrl: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (requestUrl.startsWith(normalizedBaseUrl)) {
    return `${BASE_URL_PLACEHOLDER}${requestUrl.slice(normalizedBaseUrl.length)}`;
  }

  const request = new URL(requestUrl);
  const base = new URL(normalizedBaseUrl);
  if (request.origin !== base.origin) throw new Error('cURL 请求 URL 必须使用当前上游地址');
  const parentSegments = base.pathname
    .split('/')
    .filter(Boolean)
    .map(() => '..');
  return `${BASE_URL_PLACEHOLDER}/${[...parentSegments, request.pathname.replace(/^\/+/, '')]
    .filter(Boolean)
    .join('/')}${request.search}${request.hash}`;
}

function buildDefaultCurl(
  protocol: EndpointTestProtocol,
  baseUrl: string,
  authScheme: EndpointAuthScheme,
  model = MODEL_PLACEHOLDER
): string {
  const concreteUrl = joinEndpointUrl(baseUrl, ENDPOINTS[protocol]);
  return serializeCurl({
    url: replaceUrlWithBasePlaceholder(concreteUrl, baseUrl),
    method: 'POST',
    headers: buildHeaders(protocol, API_KEY_PLACEHOLDER, authScheme),
    body: JSON.stringify(buildRequestBody(protocol, model), null, 2),
  });
}

function expandCurlBaseUrl(value: string, baseUrl: string): string {
  return value.split(BASE_URL_PLACEHOLDER).join(normalizeBaseUrl(baseUrl));
}

function tokenizeCurl(value: string): string[] {
  if (!value.trim()) throw new Error('请输入 cURL 代码');
  if (value.length > MAX_CURL_LENGTH) throw new Error('cURL 代码过长');

  const tokens: string[] = [];
  let token = '';
  let quote: 'single' | 'double' | null = null;
  let tokenStarted = false;

  const pushToken = () => {
    if (tokenStarted) tokens.push(token);
    token = '';
    tokenStarted = false;
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === 'single') {
      if (character === "'") quote = null;
      else token += character;
      tokenStarted = true;
      continue;
    }
    if (quote === 'double') {
      if (character === '"') {
        quote = null;
      } else if (character === '\\') {
        const next = value[index + 1];
        if (next === '\n') index += 1;
        else if (next === '\r' && value[index + 2] === '\n') index += 2;
        else if (next !== undefined) {
          token += next;
          index += 1;
        } else {
          token += character;
        }
      } else {
        token += character;
      }
      tokenStarted = true;
      continue;
    }
    if (character === "'") {
      quote = 'single';
      tokenStarted = true;
    } else if (character === '"') {
      quote = 'double';
      tokenStarted = true;
    } else if (character === '\\') {
      const next = value[index + 1];
      if (next === '\n') index += 1;
      else if (next === '\r' && value[index + 2] === '\n') index += 2;
      else if (next !== undefined) {
        token += next;
        tokenStarted = true;
        index += 1;
      } else {
        token += character;
        tokenStarted = true;
      }
    } else if (/\s/.test(character)) {
      pushToken();
    } else {
      token += character;
      tokenStarted = true;
    }
  }
  if (quote) throw new Error('cURL 引号未闭合');
  pushToken();
  return tokens;
}

function parseHeader(value: string): [string, string] {
  const separator = value.indexOf(':');
  if (separator <= 0) throw new Error(`cURL 请求头格式无效：${value}`);
  const name = value.slice(0, separator).trim();
  const headerValue = value.slice(separator + 1).trim();
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
    throw new Error(`cURL 请求头名无效：${name}`);
  }
  return [name, headerValue];
}

function parseCurl(value: string): ParsedCurlRequest {
  const tokens = tokenizeCurl(value);
  if (tokens[0]?.toLowerCase() !== 'curl') throw new Error('cURL 代码必须以 curl 开头');

  let url = '';
  let method = '';
  let body = '';
  const headers: Record<string, string> = {};
  const takeValue = (index: number, option: string): [string, number] => {
    const next = tokens[index + 1];
    if (next === undefined) throw new Error(`cURL 参数 ${option} 缺少值`);
    return [next, index + 1];
  };

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      ['--location', '-L', '--silent', '-s', '--show-error', '-S', '--compressed'].includes(token)
    ) {
      continue;
    }
    if (token === '--request' || token === '-X') {
      [method, index] = takeValue(index, token);
      continue;
    }
    if (token.startsWith('--request=')) {
      method = token.slice('--request='.length);
      continue;
    }
    if (token === '--url') {
      [url, index] = takeValue(index, token);
      continue;
    }
    if (token.startsWith('--url=')) {
      url = token.slice('--url='.length);
      continue;
    }
    if (token === '--header' || token === '-H') {
      let header: string;
      [header, index] = takeValue(index, token);
      const [name, headerValue] = parseHeader(header);
      headers[name] = headerValue;
      continue;
    }
    if (token.startsWith('--header=')) {
      const [name, headerValue] = parseHeader(token.slice('--header='.length));
      headers[name] = headerValue;
      continue;
    }
    if (token.startsWith('-H') && token.length > 2) {
      const [name, headerValue] = parseHeader(token.slice(2));
      headers[name] = headerValue;
      continue;
    }
    if (['--data', '--data-raw', '--data-binary', '--data-ascii', '-d'].includes(token)) {
      [body, index] = takeValue(index, token);
      continue;
    }
    const dataOption = ['--data=', '--data-raw=', '--data-binary=', '--data-ascii='].find(prefix =>
      token.startsWith(prefix)
    );
    if (dataOption) {
      body = token.slice(dataOption.length);
      continue;
    }
    if (token.startsWith('-d') && token.length > 2) {
      body = token.slice(2);
      continue;
    }
    if (token.startsWith('-')) throw new Error(`不支持的 cURL 参数：${token}`);
    if (url) throw new Error('cURL 只能包含一个请求 URL');
    url = token;
  }

  if (!url) throw new Error('cURL 缺少请求 URL');
  if (Object.keys(headers).length > MAX_CURL_HEADERS) throw new Error('cURL 请求头过多');
  if (body.length > MAX_CURL_BODY_LENGTH) throw new Error('cURL 请求体过大');
  const normalizedMethod = (method || (body ? 'POST' : 'GET')).trim().toUpperCase();
  if (!/^[A-Z]+$/.test(normalizedMethod)) throw new Error('cURL 请求方法无效');
  return { url, method: normalizedMethod, headers, body };
}

function setHeader(headers: Record<string, string>, name: string, value?: string): void {
  for (const existing of Object.keys(headers)) {
    if (existing.toLowerCase() === name.toLowerCase()) delete headers[existing];
  }
  if (value !== undefined) headers[name] = value;
}

function buildRequestFromCurl(
  curl: string,
  protocol: EndpointTestProtocol,
  baseUrl: string,
  apiKey: string,
  authScheme: EndpointAuthScheme,
  model: string
): ParsedCurlRequest {
  const request = parseCurl(expandCurlBaseUrl(curl, baseUrl));
  let requestUrl: URL;
  let configuredUrl: URL;
  try {
    requestUrl = new URL(request.url);
    configuredUrl = new URL(baseUrl);
  } catch {
    throw new Error('cURL 请求 URL 无效');
  }
  if (
    !['http:', 'https:'].includes(requestUrl.protocol) ||
    requestUrl.origin !== configuredUrl.origin
  ) {
    throw new Error('cURL 请求 URL 必须使用当前上游地址');
  }
  const configuredPath = configuredUrl.pathname.replace(/\/+$/, '') || '/';
  const requestPath = requestUrl.pathname.replace(/\/+$/, '') || '/';
  if (
    configuredPath !== '/' &&
    requestPath !== configuredPath &&
    !requestPath.startsWith(`${configuredPath}/`)
  ) {
    throw new Error('cURL 请求 URL 必须位于当前上游 Base URL 下');
  }
  if (!request.body) throw new Error('cURL 缺少 JSON 请求体');

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(request.body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    const replacePlaceholders = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return value.split(API_KEY_PLACEHOLDER).join(apiKey).split(MODEL_PLACEHOLDER).join(model);
      }
      if (Array.isArray(value)) return value.map(replacePlaceholders);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, item]) => [
            key,
            replacePlaceholders(item),
          ])
        );
      }
      return value;
    };
    body = replacePlaceholders(parsed) as Record<string, unknown>;
  } catch {
    throw new Error('cURL 请求体必须是 JSON 对象');
  }
  body.model = model;
  if (protocol === 'anthropic-messages') body.max_tokens = 1024;
  if (protocol === 'openai-responses') body.store = false;

  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [
      name,
      value.split(API_KEY_PLACEHOLDER).join(apiKey).split(MODEL_PLACEHOLDER).join(model),
    ])
  );
  setHeader(headers, 'Authorization');
  setHeader(headers, 'x-api-key');
  if (authScheme === 'x-api-key') setHeader(headers, 'x-api-key', apiKey);
  else setHeader(headers, 'Authorization', `Bearer ${apiKey}`);
  setHeader(headers, 'Content-Type', 'application/json');
  if (protocol === 'anthropic-messages') {
    const hasAnthropicVersion = Object.keys(headers).some(
      name => name.toLowerCase() === 'anthropic-version'
    );
    if (!hasAnthropicVersion) setHeader(headers, 'anthropic-version', '2023-06-01');
  }
  for (const forbidden of ['host', 'content-length', 'connection', 'proxy-authorization']) {
    setHeader(headers, forbidden);
  }

  return { ...request, url: requestUrl.toString(), headers, body: JSON.stringify(body) };
}

function canonicalizeCurl(
  curl: string,
  protocol: EndpointTestProtocol,
  baseUrl: string,
  authScheme: EndpointAuthScheme
): string {
  const request = buildRequestFromCurl(
    curl,
    protocol,
    baseUrl,
    API_KEY_PLACEHOLDER,
    authScheme,
    MODEL_PLACEHOLDER
  );
  request.body = JSON.stringify(JSON.parse(request.body), null, 2);
  request.url = replaceUrlWithBasePlaceholder(request.url, baseUrl);
  return serializeCurl(request);
}

async function resolveTarget(target: EndpointTestTarget): Promise<ResolvedEndpointTestTarget> {
  if (target.kind === 'direct') {
    const storage = await loadCustomCliConfigStorage();
    const config = storage.configs.find(item => item.id === target.configId);
    if (!config) throw new Error('直连配置不存在');

    const baseUrl = normalizeText(config.baseUrl);
    if (!baseUrl) throw new Error('请先配置 Base URL');

    const apiKeys = normalizeCustomCliApiKeys(config.apiKeys, {
      legacyApiKey: config.apiKey,
      // legacyName 会让单 Key 继承配置名，测试页下拉里与配置名重复，故留空走「默认」标签
      legacyName: undefined,
      legacyGroupMultiplier: config.groupMultiplier,
    })
      .map(apiKey => ({ apiKey, value: normalizeText(apiKey.key) }))
      .filter(item => item.value && !isMaskedApiKeyValue(item.value));
    if (apiKeys.length === 0) throw new Error('请先配置可用的 API Key');

    const displayName = normalizeText(config.name) || baseUrl;
    const hasExplicitApiKeys = !(apiKeys.length === 1 && apiKeys[0].apiKey.id === 'key_legacy');
    const targetApiKeys = apiKeys.map(({ apiKey, value }, index) => ({
      id: buildCustomCliRouteApiKeyId(config.id, hasExplicitApiKeys ? apiKey.id : undefined),
      label: hasExplicitApiKeys
        ? apiKey.name
          ? `${displayName} / ${apiKey.name}`
          : `${displayName} Key #${index + 1}`
        : '默认 API Key',
      models: uniqueStrings([
        ...apiKey.models,
        ...(apiKey.models.length > 0
          ? config.manualModels || []
          : [...(config.models || []), ...(config.manualModels || [])]),
      ]),
      ...(maskApiKeyForDisplay(value) ? { maskedApiKey: maskApiKeyForDisplay(value) } : {}),
      credentialTarget: {
        kind: 'direct' as const,
        configId: config.id,
        apiKeyId: apiKey.id,
      },
    }));
    const configModels = uniqueStrings([...(config.models || []), ...(config.manualModels || [])]);
    return {
      target,
      targetKey: buildTargetKey(target),
      baseUrl,
      ...(config.routeAuthScheme ? { authScheme: config.routeAuthScheme } : {}),
      apiKeys: targetApiKeys,
      models: uniqueStrings([...targetApiKeys.flatMap(apiKey => apiKey.models), ...configModels]),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    };
  }

  const config = unifiedConfigManager.exportConfigSync();
  if (!config) throw new Error('配置尚未加载');
  const site = config.sites.find(item => item.id === target.siteId);
  if (!site) throw new Error('站点不存在');
  if (site.group === BUILTIN_GROUP_IDS.UNAVAILABLE) throw new Error('不可用分组中的站点不能测试');
  const account = config.accounts.find(item => item.id === target.accountId);
  if (!account || account.site_id !== site.id) throw new Error('账户不属于当前站点');

  const modelPricing = account.cached_data?.model_pricing || site.cached_data?.model_pricing;
  const models = collectManagedModels(
    account.cached_data?.models || site.cached_data?.models || [],
    modelPricing
  );
  const apiKeys = (account.cached_data?.api_keys || []).filter(isApiKeyActive).map(info => {
    const storedValue = normalizeText(info.key || info.token);
    return {
      id: resolveApiKeyId(info),
      label: normalizeText(info.name) || `API Key ${resolveApiKeyId(info)}`,
      ...(maskApiKeyForDisplay(storedValue)
        ? { maskedApiKey: maskApiKeyForDisplay(storedValue) }
        : {}),
      ...(normalizeText(info.group) ? { group: normalizeText(info.group) } : {}),
      models: getModelsForApiKey(models, modelPricing, info),
      credentialTarget: {
        kind: 'managed' as const,
        siteId: site.id,
        accountId: account.id,
        apiKeyId: resolveApiKeyId(info),
      },
    };
  });
  for (const info of account.local_api_keys || []) {
    if (
      !isApiKeyActive({ enabled: info.status }) ||
      !info.key.trim() ||
      isMaskedApiKeyValue(info.key)
    )
      continue;
    if (apiKeys.some(key => key.id === info.id)) continue;
    apiKeys.push({
      id: info.id,
      label: info.name || '本地 API Key',
      maskedApiKey: maskApiKeyForDisplay(info.key),
      ...(info.group ? { group: info.group } : {}),
      models: uniqueStrings(info.models),
      credentialTarget: {
        kind: 'managed',
        siteId: site.id,
        accountId: account.id,
        apiKeyId: info.id,
      },
    });
  }
  const legacyKey = account.api_key || site.api_key;
  if (legacyKey?.trim() && !isMaskedApiKeyValue(legacyKey)) {
    const id = resolveApiKeyId({ key: legacyKey });
    if (!apiKeys.some(key => key.id === id))
      apiKeys.push({
        id,
        label: '手动 API Key',
        maskedApiKey: maskApiKeyForDisplay(legacyKey),
        models,
        credentialTarget: { kind: 'managed', siteId: site.id, accountId: account.id, apiKeyId: id },
      });
  }

  return {
    target,
    targetKey: buildTargetKey(target),
    baseUrl: site.url,
    ...(account.routeAuthScheme ? { authScheme: account.routeAuthScheme } : {}),
    apiKeys,
    models: uniqueStrings([...models, ...apiKeys.flatMap(key => key.models)]),
    timeoutMs: isAnyRouterSite(site.name)
      ? ANYROUTER_TIMEOUT_MS
      : config.routing?.server.requestTimeoutMs || DEFAULT_TIMEOUT_MS,
  };
}

async function getEndpointTests(): Promise<Record<string, EndpointTestTargetState>> {
  await endpointTestStateService.ensureLoaded();
  return endpointTestStateService.getTargets();
}

async function persistSelection(
  target: ResolvedEndpointTestTarget,
  input: EndpointTestSelectionInput,
  latest?: EndpointTestResult
): Promise<EndpointTestSelectionState> {
  const endpointTests = await getEndpointTests();
  const currentTarget = endpointTests[target.targetKey];
  const persistedCurl =
    input.curl ??
    (normalizeText(currentTarget?.protocols[input.protocol]?.curl)
      ? currentTarget!.protocols[input.protocol]!.curl
      : undefined) ??
    buildDefaultCurl(
      input.protocol,
      target.baseUrl,
      resolveEndpointAuthScheme(input.protocol, target.authScheme),
      MODEL_PLACEHOLDER
    );
  const nextSelection: EndpointTestSelectionState = {
    apiKeyId: input.apiKeyId,
    model: input.model,
    curl: persistedCurl,
    ...(latest
      ? { latest }
      : currentTarget?.protocols[input.protocol]?.latest
        ? { latest: currentTarget.protocols[input.protocol]!.latest }
        : {}),
  };
  endpointTests[target.targetKey] = {
    targetKey: target.targetKey,
    protocols: {
      ...(currentTarget?.protocols || {}),
      [input.protocol]: nextSelection,
    },
    updatedAt: Date.now(),
  };
  await endpointTestStateService.saveTargets(endpointTests);
  return nextSelection;
}

function assertSelection(
  target: ResolvedEndpointTestTarget,
  input: EndpointTestSelectionInput
): void {
  if (!ENDPOINT_TEST_PROTOCOLS.includes(input.protocol)) throw new Error('不支持的测试端点');
  if (!normalizeText(input.model)) throw new Error('请选择模型');
  if (!target.apiKeys.some(apiKey => apiKey.id === input.apiKeyId)) {
    throw new Error('请选择当前接入点的有效 API Key');
  }
}

export async function getEndpointTestState(
  targetInput: EndpointTestTarget
): Promise<EndpointTestStateView> {
  const target = await resolveTarget(targetInput);
  const stored = (await getEndpointTests())[target.targetKey];
  const protocols = Object.fromEntries(
    ENDPOINT_TEST_PROTOCOLS.map(protocol => [
      protocol,
      createSelectionState(
        stored?.protocols[protocol],
        target.apiKeys,
        target.models,
        protocol,
        target.baseUrl,
        target.authScheme
      ),
    ])
  ) as Record<EndpointTestProtocol, EndpointTestSelectionState>;

  return {
    target: target.target,
    targetKey: target.targetKey,
    baseUrl: target.baseUrl,
    apiKeys: target.apiKeys.map(({ id, label, maskedApiKey, group, models }) => ({
      id,
      label,
      ...(maskedApiKey ? { maskedApiKey } : {}),
      ...(group ? { group } : {}),
      models,
    })),
    models: target.models,
    protocols,
  };
}

export async function saveEndpointTestSelection(
  input: EndpointTestSelectionInput
): Promise<EndpointTestSelectionState> {
  const target = await resolveTarget(input.target);
  assertSelection(target, input);
  const nextInput = { ...input, model: input.model.trim() };
  if (input.curl !== undefined) {
    nextInput.curl = canonicalizeCurl(
      input.curl,
      input.protocol,
      target.baseUrl,
      resolveEndpointAuthScheme(input.protocol, target.authScheme)
    );
  }
  return persistSelection(target, nextInput);
}

export async function runEndpointTest(
  input: EndpointTestSelectionInput
): Promise<EndpointTestResult> {
  const target = await resolveTarget(input.target);
  assertSelection(target, input);
  const selectedKey = target.apiKeys.find(apiKey => apiKey.id === input.apiKeyId)!;

  const endpoint = ENDPOINTS[input.protocol];
  const startedAt = Date.now();
  let statusCode: number | undefined;
  let result: EndpointTestResult;

  try {
    const credentials = await resolveUpstreamCredentials(selectedKey.credentialTarget);
    const apiKey = normalizeText(credentials?.apiKey);
    if (!credentials || !apiKey || isMaskedApiKeyValue(apiKey)) {
      throw new Error('无法解析所选 API Key');
    }
    const authScheme = resolveEndpointAuthScheme(input.protocol, credentials.authScheme);
    const stored = (await getEndpointTests())[target.targetKey];
    const savedCurl =
      (normalizeText(stored?.protocols[input.protocol]?.curl)
        ? stored!.protocols[input.protocol]!.curl
        : undefined) || buildDefaultCurl(input.protocol, credentials.baseUrl, authScheme);
    const executionCurl = canonicalizeCurl(
      input.curl || savedCurl,
      input.protocol,
      credentials.baseUrl,
      authScheme
    );
    const request = buildRequestFromCurl(
      executionCurl,
      input.protocol,
      credentials.baseUrl,
      apiKey,
      authScheme,
      input.model.trim()
    );
    const routing = unifiedConfigManager.getRoutingConfig();
    const response = await httpRawRequest(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      timeout: target.timeoutMs,
      proxyUrl: routing.server?.upstreamProxyUrl,
      preferElectronNet: true,
    });
    statusCode = response.status;
    const responseText = response.body.toString('utf8');
    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = null;
    }
    const generatedText = extractGeneratedText(input.protocol, payload);
    const error =
      response.status < 200 || response.status >= 300
        ? summarizeFailure(responseText, response.status, payload)
        : !payload
          ? '响应不是有效 JSON'
          : !generatedText
            ? '响应中没有生成文本'
            : undefined;
    result = {
      success: !error,
      endpoint,
      apiKeyId: selectedKey.id,
      apiKeyLabel: selectedKey.label,
      model: input.model.trim(),
      testedAt: Date.now(),
      latencyMs: Date.now() - startedAt,
      statusCode,
      ...(generatedText ? { summary: summarize(generatedText) } : {}),
      ...(error ? { error } : {}),
    };
  } catch (error: unknown) {
    result = {
      success: false,
      endpoint,
      apiKeyId: selectedKey.id,
      apiKeyLabel: selectedKey.label,
      model: input.model.trim(),
      testedAt: Date.now(),
      latencyMs: Date.now() - startedAt,
      ...(statusCode !== undefined ? { statusCode } : {}),
      error: summarizeRequestError(error),
    };
  }

  await persistSelection(
    target,
    {
      ...input,
      model: input.model.trim(),
      curl: undefined,
    },
    result
  );
  return result;
}
