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
} from '../shared/types/route-proxy';
import {
  BUILTIN_GROUP_IDS,
  isAnyRouterSite,
  isApiKeyActive,
  type ApiKeyInfo,
} from '../shared/types/site';
import {
  buildCustomCliRouteAccountId,
  buildCustomCliRouteApiKeyId,
  buildCustomCliRouteSiteId,
  loadCustomCliConfigStorage,
} from './custom-cli-config-service';
import { isRouteMaskedApiKeyValue, resolveAccountApiKeyValue } from './route-channel-resolver';
import { resolveApiKeyId } from './route-model-registry-service';
import { ensureRouteProxyReady } from './route-proxy-service';
import { routeStateManager } from './route-state-manager';
import { buildTargetLockRouteApiKey } from './route-target-lock';
import { unifiedConfigManager } from './unified-config-manager';

const MAX_SUMMARY_LENGTH = 1000;
const MAX_ERROR_LENGTH = 200;
const DEFAULT_TIMEOUT_MS = 60000;
const ANYROUTER_TIMEOUT_MS = 120000;
const TEST_PROMPT = '1.2和1.19哪个更大？';

const ENDPOINTS: Record<EndpointTestProtocol, string> = {
  'anthropic-messages': '/v1/messages',
  'openai-responses': '/v1/responses',
  'openai-chat-completions': '/v1/chat/completions',
};

interface ResolvedEndpointTestTarget {
  target: EndpointTestTarget;
  targetKey: string;
  siteId: string;
  accountId: string;
  apiKeys: Array<EndpointTestApiKeyOption & { info?: ApiKeyInfo; value?: string }>;
  models: string[];
  timeoutMs: number;
  upstreamBaseUrl?: string;
  upstreamApiKey?: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
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
  models: string[]
): EndpointTestSelectionState {
  return {
    apiKeyId: stored?.apiKeyId || apiKeys[0]?.id || null,
    model: stored?.model || models[0] || null,
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
      max_tokens: 32,
      stream: false,
      messages: [{ role: 'user', content: TEST_PROMPT }],
    };
  }
  if (protocol === 'openai-responses') {
    return { model, input: TEST_PROMPT, max_output_tokens: 32, stream: false };
  }
  return {
    model,
    max_tokens: 32,
    stream: false,
    messages: [{ role: 'user', content: TEST_PROMPT }],
  };
}

function buildHeaders(protocol: EndpointTestProtocol, routeApiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (protocol === 'anthropic-messages') {
    headers['x-api-key'] = routeApiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers.Authorization = `Bearer ${routeApiKey}`;
  }
  return headers;
}

async function resolveTarget(target: EndpointTestTarget): Promise<ResolvedEndpointTestTarget> {
  if (target.kind === 'direct') {
    const storage = await loadCustomCliConfigStorage();
    const config = storage.configs.find(item => item.id === target.configId);
    if (!config) throw new Error('直连配置不存在');

    const baseUrl = normalizeText(config.baseUrl);
    const apiKey = normalizeText(config.apiKey);
    if (!baseUrl) throw new Error('请先配置 Base URL');
    if (!apiKey || isRouteMaskedApiKeyValue(apiKey)) throw new Error('请先配置可用的 API Key');

    const apiKeyId = buildCustomCliRouteApiKeyId(config.id);
    const models = uniqueStrings([...(config.models || []), ...(config.manualModels || [])]);
    return {
      target,
      targetKey: buildTargetKey(target),
      siteId: buildCustomCliRouteSiteId(config.id),
      accountId: buildCustomCliRouteAccountId(config.id),
      apiKeys: [{ id: apiKeyId, label: '默认 API Key', models, value: apiKey }],
      models,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      upstreamBaseUrl: baseUrl,
      upstreamApiKey: apiKey,
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
  const apiKeys = (account.cached_data?.api_keys || []).filter(isApiKeyActive).map(info => ({
    id: resolveApiKeyId(info),
    label: normalizeText(info.name) || `API Key ${resolveApiKeyId(info)}`,
    ...(normalizeText(info.group) ? { group: normalizeText(info.group) } : {}),
    models: getModelsForApiKey(models, modelPricing, info),
    info,
  }));

  return {
    target,
    targetKey: buildTargetKey(target),
    siteId: site.id,
    accountId: account.id,
    apiKeys,
    models,
    timeoutMs: isAnyRouterSite(site.name)
      ? ANYROUTER_TIMEOUT_MS
      : config.routing?.server.requestTimeoutMs || DEFAULT_TIMEOUT_MS,
  };
}

function getRoutingEndpointTests(): Record<string, EndpointTestTargetState> {
  return unifiedConfigManager.getRoutingConfig().endpointTests;
}

async function persistSelection(
  target: ResolvedEndpointTestTarget,
  input: EndpointTestSelectionInput,
  latest?: EndpointTestResult
): Promise<EndpointTestSelectionState> {
  const routing = unifiedConfigManager.getRoutingConfig();
  const currentTarget = routing.endpointTests[target.targetKey];
  const nextSelection: EndpointTestSelectionState = {
    apiKeyId: input.apiKeyId,
    model: input.model,
    ...(latest
      ? { latest }
      : currentTarget?.protocols[input.protocol]?.latest
        ? { latest: currentTarget.protocols[input.protocol]!.latest }
        : {}),
  };
  routing.endpointTests[target.targetKey] = {
    targetKey: target.targetKey,
    protocols: {
      ...(currentTarget?.protocols || {}),
      [input.protocol]: nextSelection,
    },
    updatedAt: Date.now(),
  };
  await routeStateManager.saveEndpointTestsState(routing);
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
  const stored = getRoutingEndpointTests()[target.targetKey];
  const protocols = Object.fromEntries(
    ENDPOINT_TEST_PROTOCOLS.map(protocol => [
      protocol,
      createSelectionState(stored?.protocols[protocol], target.apiKeys, target.models),
    ])
  ) as Record<EndpointTestProtocol, EndpointTestSelectionState>;

  return {
    target: target.target,
    targetKey: target.targetKey,
    apiKeys: target.apiKeys.map(({ id, label, group, models }) => ({
      id,
      label,
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
  return persistSelection(target, { ...input, model: input.model.trim() });
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
    if (input.target.kind === 'managed') {
      const managedTarget = input.target;
      const config = unifiedConfigManager.exportConfigSync();
      const site = config?.sites.find(item => item.id === managedTarget.siteId);
      const account = config?.accounts.find(item => item.id === managedTarget.accountId);
      if (!site || !account || !selectedKey.info) throw new Error('测试目标已失效');
      const resolvedKey = await resolveAccountApiKeyValue(site, account, selectedKey.info);
      if (!resolvedKey || isRouteMaskedApiKeyValue(resolvedKey)) {
        throw new Error('无法解析所选 API Key');
      }
    }

    const routeRuntime = await ensureRouteProxyReady({ autoEnable: true });
    const routeApiKey = buildTargetLockRouteApiKey(routeRuntime.unifiedApiKey, {
      siteId: target.siteId,
      accountId: target.accountId,
      apiKeyId: input.apiKeyId,
      canonicalModel: input.model.trim(),
      rawModel: input.model.trim(),
      targetProtocol: input.protocol,
      upstreamBaseUrl: target.upstreamBaseUrl,
      upstreamApiKey: target.upstreamApiKey,
    });
    const response = await fetch(`${routeRuntime.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: buildHeaders(input.protocol, routeApiKey),
      body: JSON.stringify(buildRequestBody(input.protocol, input.model.trim())),
      signal: AbortSignal.timeout(target.timeoutMs),
    });
    statusCode = response.status;
    const responseText = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = null;
    }
    const generatedText = extractGeneratedText(input.protocol, payload);
    const error = !response.ok
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

  await persistSelection(target, input, result);
  return result;
}
