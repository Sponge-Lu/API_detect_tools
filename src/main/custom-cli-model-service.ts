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
import type { CustomCliConfig } from '../shared/types/custom-cli-config';

const log = Logger.scope('CustomCliModelService');

const FETCH_TIMEOUT_MS = 10000; // 10 秒超时

export interface FetchModelsResult {
  success: boolean;
  models: string[];
  error?: string;
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

    // 解析响应
    if (!response.data || typeof response.data !== 'object') {
      return {
        success: false,
        models: [],
        error: '响应格式错误：不是有效的 JSON 对象',
      };
    }

    const data = response.data as { data?: Array<{ id?: string }> };
    if (!Array.isArray(data.data)) {
      return {
        success: false,
        models: [],
        error: '响应格式错误：缺少 data 数组',
      };
    }

    // 提取模型 ID
    const models = data.data
      .map(item => item.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

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
