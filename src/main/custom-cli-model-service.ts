/**
 * 自定义 CLI 配置模型获取服务
 * 输入: CustomCliConfig (直连配置)
 * 输出: { success, models, error } (模型列表)
 * 定位: 服务层 - 通过直连配置的 baseUrl 获取模型列表
 */

import Logger from './utils/logger';
import { httpGet } from './utils/http-client';
import {
  loadCustomCliConfigStorage,
  saveCustomCliConfigStorage,
} from './custom-cli-config-service';

const log = Logger.scope('CustomCliModelService');

const FETCH_TIMEOUT_MS = 10000; // 10 秒超时

export interface FetchModelsResult {
  success: boolean;
  models: string[];
  error?: string;
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

    log.info(`Fetching models for config ${configId} from ${customCliConfig.baseUrl}`);

    // 构造请求 URL
    const baseUrl = customCliConfig.baseUrl.replace(/\/$/, '');
    const url = `${baseUrl}/v1/models`;

    // 构造请求 headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // 如果有 apiKey，添加 Authorization header
    if (customCliConfig.apiKey) {
      headers['Authorization'] = `Bearer ${customCliConfig.apiKey}`;
    }

    // 发起请求
    const response = await httpGet(url, {
      timeout: FETCH_TIMEOUT_MS,
      headers,
    });

    // 上游返回 HTTP 错误时按状态码分类，不进入解析流程
    if (response.status < 200 || response.status >= 300) {
      return {
        success: false,
        models: [],
        error: buildUpstreamErrorMessage(response.status, response.data),
      };
    }

    // 2xx 但响应非 JSON 对象（如 HTML 错误页）
    const data = response.data;
    if (!data || typeof data !== 'object') {
      const bodyPreview = typeof data === 'string' ? data.slice(0, 200) : String(data ?? '');
      return {
        success: false,
        models: [],
        error: `响应非 JSON 对象 (HTTP ${response.status}): ${bodyPreview}`,
      };
    }

    // 三形态兼容解析（与历史通道等价）：{ data: [...] } / [...] / 文档兜底
    const models = extractModelIds(data);
    if (models.length === 0) {
      return {
        success: false,
        models: [],
        error: `无法解析模型列表响应 (HTTP ${response.status}): ${JSON.stringify(data).slice(0, 200)}`,
      };
    }

    log.info(`Fetched ${models.length} models for config ${configId}`);

    // 更新配置
    const updatedConfigs = storage.configs.map(config =>
      config.id === configId
        ? {
            ...config,
            models,
            lastModelFetch: Date.now(),
          }
        : config
    );

    await saveCustomCliConfigStorage({
      ...storage,
      configs: updatedConfigs,
    });

    return { success: true, models };
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
