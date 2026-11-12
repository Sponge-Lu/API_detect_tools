/**
 * 自定义 CLI 配置模型获取服务
 * 输入: CustomCliConfig (直连配置)
 * 输出: { success, models, error } (模型列表)
 * 定位: 服务层 - 通过直连配置的 modelUrl（为空时回退 baseUrl）获取模型列表
 */

import Logger from './utils/logger';
import { httpGet } from './utils/http-client';
import {
  loadCustomCliConfigStorage,
  updateCustomCliConfigStorage,
} from './custom-cli-config-service';
import { normalizeCustomCliApiKeys } from '../shared/types/custom-cli-config';
import {
  buildApiKeyHeaders,
  buildVersionedApiUrl,
  resolveApiKeyForUse,
} from '../shared/utils/apiConfig';

const log = Logger.scope('CustomCliModelService');

const FETCH_TIMEOUT_MS = 10000; // 10 秒超时

let activeRequests = 0;
const activeByOrigin = new Map<string, number>();
const modelRequestQueue: Array<{ origin: string; start: () => void }> = [];

function drainModelRequests(): void {
  while (activeRequests < 4) {
    const index = modelRequestQueue.findIndex(job => (activeByOrigin.get(job.origin) ?? 0) < 2);
    if (index < 0) return;
    const [job] = modelRequestQueue.splice(index, 1);
    activeRequests++;
    activeByOrigin.set(job.origin, (activeByOrigin.get(job.origin) ?? 0) + 1);
    job.start();
  }
}

function scheduleModelRequest<T>(url: string, request: () => Promise<T>): Promise<T> {
  const origin = new URL(url).origin;
  return new Promise<T>((resolve, reject) => {
    modelRequestQueue.push({
      origin,
      start: () => {
        void Promise.resolve()
          .then(request)
          .then(resolve, reject)
          .finally(() => {
            activeRequests--;
            const remaining = (activeByOrigin.get(origin) ?? 1) - 1;
            if (remaining) activeByOrigin.set(origin, remaining);
            else activeByOrigin.delete(origin);
            drainModelRequests();
          });
      },
    });
    drainModelRequests();
  });
}

function buildModelsUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (/\/v1\/models(?:[/?#]|$)/i.test(normalized)) {
    return normalized;
  }
  return buildVersionedApiUrl(normalized, 'models');
}

export interface FetchModelsResult {
  success: boolean;
  models: string[];
  error?: string;
  perKey?: Array<{ keyId: string; success: boolean; models: string[]; error?: string }>;
}

/**
 * 从 /v1/models 响应体提取模型 ID 列表。
 * 兼容三种形态：{ data: [{id}, ...] }（OpenAI 标准）、[...]（纯数组）、
 * 以及对象兜底（字段叫 id 或 name）。返回空数组表示无法解析。
 */
function extractModelIds(payload: unknown): string[] {
  const candidates: unknown[] = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === 'object' &&
        'data' in payload &&
        Array.isArray((payload as { data: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];

  if (candidates.length === 0) {
    return [];
  }

  return candidates
    .map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const obj = item as { id?: unknown; name?: unknown };
        return typeof obj.id === 'string' ? obj.id : typeof obj.name === 'string' ? obj.name : null;
      }
      return null;
    })
    .filter((id): id is string => !!id && id.length > 0);
}

/**
 * 上游返回 HTTP 错误时构造分类文案，避免误报为解析失败。
 * 兼容 {error:{message}} / {message} / {detail} 错误体形态。
 */
function buildUpstreamErrorMessage(status: number, payload: unknown): string {
  let detail = '无响应内容';
  if (payload && typeof payload === 'object') {
    const obj = payload as { error?: { message?: unknown }; message?: unknown; detail?: unknown };
    const text = obj.error?.message ?? obj.message ?? obj.detail;
    detail = typeof text === 'string' && text ? text : JSON.stringify(payload).slice(0, 200);
  } else if (typeof payload === 'string' && payload) {
    detail = payload.slice(0, 200);
  }

  const reason =
    status === 401 || status === 403
      ? 'API Key 无效或无权限'
      : status >= 500
        ? '上游服务器错误'
        : '上游拒绝请求';
  return `${reason} (HTTP ${status}): ${detail}`;
}

/**
 * 获取直连配置的模型列表
 * @param configId 直连配置 ID
 * @returns 模型列表及状态
 */
export async function fetchModels(configId: string): Promise<FetchModelsResult> {
  try {
    // 读取配置
    const storage = await loadCustomCliConfigStorage();
    const customCliConfig = storage.configs.find(c => c.id === configId);

    if (!customCliConfig) {
      return { success: false, models: [], error: `未找到配置 ID: ${configId}` };
    }

    if (!customCliConfig.baseUrl) {
      return { success: false, models: [], error: 'baseUrl 为空' };
    }

    const modelSourceUrl = customCliConfig.modelUrl?.trim() || customCliConfig.baseUrl;
    const url = buildModelsUrl(modelSourceUrl);
    log.info(`Fetching models for config ${configId} from ${url}`);
    const apiKeys = normalizeCustomCliApiKeys(customCliConfig.apiKeys, {
      legacyApiKey: customCliConfig.apiKey,
      legacyName: customCliConfig.name,
      legacyGroupMultiplier: customCliConfig.groupMultiplier,
    });
    if (apiKeys.length === 0)
      return { success: false, models: [], error: '未配置 API Key', perKey: [] };

    const perKey: NonNullable<FetchModelsResult['perKey']> = new Array(apiKeys.length);
    const updatedKeys = apiKeys.map(key => ({ ...key }));
    await Promise.all(
      updatedKeys.map(async (key, index) => {
        const requestStartedAt = Date.now();
        try {
          const apiKey = resolveApiKeyForUse(key.key);
          if (!apiKey) throw new Error('API Key 为空或被掩码隐藏');
          const response = await scheduleModelRequest(url, () =>
            httpGet(url, {
              timeout: FETCH_TIMEOUT_MS,
              headers: {
                'Content-Type': 'application/json',
                ...buildApiKeyHeaders(apiKey, customCliConfig.routeAuthScheme),
              },
            })
          );
          if (response.status < 200 || response.status >= 300) {
            perKey[index] = {
              keyId: key.id,
              success: false,
              models: key.models,
              error: buildUpstreamErrorMessage(response.status, response.data),
            };
            return;
          }
          const models = extractModelIds(response.data);
          if (models.length === 0) {
            perKey[index] = {
              keyId: key.id,
              success: false,
              models: key.models,
              error: '无法解析模型列表响应',
            };
            return;
          }
          key.models = models;
          key.lastModelFetch = requestStartedAt;
          perKey[index] = { keyId: key.id, success: true, models };
        } catch (error: any) {
          perKey[index] = {
            keyId: key.id,
            success: false,
            models: key.models,
            error: error?.message || '未知错误',
          };
        }
      })
    );
    let models = Array.from(new Set(updatedKeys.flatMap(key => key.models)));
    const success = perKey.some(item => item.success);
    const errors = perKey
      .filter(item => !item.success)
      .map(item => `${item.keyId}: ${item.error}`)
      .join('; ');
    let applied = false;
    await updateCustomCliConfigStorage(current => {
      const latest = current.configs.find(config => config.id === configId);
      if (
        !latest ||
        latest.baseUrl !== customCliConfig.baseUrl ||
        latest.modelUrl !== customCliConfig.modelUrl ||
        latest.routeAuthScheme !== customCliConfig.routeAuthScheme
      )
        return null;
      const latestKeys = normalizeCustomCliApiKeys(latest.apiKeys, { legacyApiKey: latest.apiKey });
      const mergedKeys = latestKeys.map(key => {
        const fetched = updatedKeys.find(item => item.id === key.id && item.key === key.key);
        if (!fetched || !perKey.some(item => item.keyId === key.id && item.success)) return key;
        if ((key.lastModelFetch || 0) > (fetched.lastModelFetch || 0)) return key;
        applied = true;
        return { ...key, models: fetched.models, lastModelFetch: fetched.lastModelFetch };
      });
      if (!applied) return null;
      models = Array.from(new Set(mergedKeys.flatMap(key => key.models)));
      return {
        ...current,
        configs: current.configs.map(config =>
          config.id === configId
            ? {
                ...config,
                models,
                apiKeys: mergedKeys,
                lastModelFetch: Date.now(),
              }
            : config
        ),
      };
    });
    if (success && !applied) {
      return { success: false, models: [], error: '配置已变更，请重新拉取模型', perKey };
    }

    return {
      success,
      models,
      perKey,
      error: success ? errors || undefined : errors || '所有 API Key 拉取失败',
    };
  } catch (error: any) {
    log.error(`Failed to fetch models for config ${configId}:`, error);
    return {
      success: false,
      models: [],
      error: error.message || '未知错误',
    };
  }
}

/**
 * 批量获取所有直连配置的模型列表
 * @returns 每个配置的获取结果
 */
export async function fetchAllModels(): Promise<
  Array<{ configId: string; success: boolean; models: string[]; error?: string }>
> {
  const storage = await loadCustomCliConfigStorage();
  const results: Array<{
    configId: string;
    success: boolean;
    models: string[];
    error?: string;
  }> = [];

  await Promise.all(
    storage.configs.map(async (customCliConfig, index) => {
      const result = await fetchModels(customCliConfig.id);
      results[index] = {
        configId: customCliConfig.id,
        ...result,
      };
    })
  );

  return results;
}
