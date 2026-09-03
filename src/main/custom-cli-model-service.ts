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
  saveCustomCliConfigStorage,
} from './custom-cli-config-service';
import { normalizeCustomCliApiKeys } from '../shared/types/custom-cli-config';

const log = Logger.scope('CustomCliModelService');

const FETCH_TIMEOUT_MS = 10000; // 10 秒超时

function buildModelsUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (/\/v1\/models(?:[/?#]|$)/i.test(normalized)) {
    return normalized;
  }
  if (/\/v1$/i.test(normalized)) {
    return `${normalized}/models`;
  }
  return `${normalized}/v1/models`;
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

    const perKey: NonNullable<FetchModelsResult['perKey']> = [];
    const updatedKeys = apiKeys.map(key => ({ ...key }));
    for (const key of updatedKeys) {
      try {
        const response = await httpGet(url, {
          timeout: FETCH_TIMEOUT_MS,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.key}` },
        });
        if (response.status < 200 || response.status >= 300) {
          perKey.push({
            keyId: key.id,
            success: false,
            models: key.models,
            error: buildUpstreamErrorMessage(response.status, response.data),
          });
          continue;
        }
        const models = extractModelIds(response.data);
        if (models.length === 0) {
          perKey.push({
            keyId: key.id,
            success: false,
            models: key.models,
            error: '无法解析模型列表响应',
          });
          continue;
        }
        key.models = models;
        key.lastModelFetch = Date.now();
        perKey.push({ keyId: key.id, success: true, models });
      } catch (error: any) {
        perKey.push({
          keyId: key.id,
          success: false,
          models: key.models,
          error: error?.message || '未知错误',
        });
      }
    }
    const models = Array.from(new Set(updatedKeys.flatMap(key => key.models)));
    const success = perKey.some(item => item.success);
    const errors = perKey
      .filter(item => !item.success)
      .map(item => `${item.keyId}: ${item.error}`)
      .join('; ');
    const updatedConfigs = storage.configs.map(config =>
      config.id === configId
        ? {
            ...config,
            models,
            apiKeys: updatedKeys,
            apiKey: updatedKeys[0]?.key || config.apiKey,
            lastModelFetch: success ? Date.now() : config.lastModelFetch,
          }
        : config
    );

    await saveCustomCliConfigStorage({
      ...storage,
      configs: updatedConfigs,
    });

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

  for (const customCliConfig of storage.configs) {
    const result = await fetchModels(customCliConfig.id);
    results.push({
      configId: customCliConfig.id,
      ...result,
    });
  }

  return results;
}
