/**
 * 自定义 CLI 配置服务
 * 输入: Electron userData/custom-cli-configs.json, OpenAI 兼容模型端点
 * 输出: 自定义 CLI 配置存储、模型列表、路由虚拟通道标识
 * 定位: 主进程服务层 - 复用自定义 CLI 配置持久化与路由通道标识生成
 *
 * 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import Logger from './utils/logger';
import type { CustomCliConfig } from '../shared/types/custom-cli-config';
import {
  CUSTOM_CLI_ROUTE_GROUP,
  buildCustomCliRouteAccountId,
  buildCustomCliRouteApiKeyId,
  buildCustomCliRouteSiteId,
  isCustomCliRouteChannel,
  parseCustomCliRouteConfigId,
} from '../shared/utils/customCliRouteId';

export interface CustomCliConfigStorage {
  configs: CustomCliConfig[];
  activeConfigId: string | null;
}

export const DEFAULT_CUSTOM_CLI_CONFIG_STORAGE: CustomCliConfigStorage = {
  configs: [],
  activeConfigId: null,
};

export {
  CUSTOM_CLI_ROUTE_GROUP,
  buildCustomCliRouteAccountId,
  buildCustomCliRouteApiKeyId,
  buildCustomCliRouteSiteId,
  isCustomCliRouteChannel,
  parseCustomCliRouteConfigId,
};

export function getCustomCliConfigFilePath(): string {
  return path.join(app.getPath('userData'), 'custom-cli-configs.json');
}

export async function loadCustomCliConfigStorage(): Promise<CustomCliConfigStorage> {
  const filePath = getCustomCliConfigFilePath();
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return {
      configs: Array.isArray(data.configs) ? data.configs : [],
      activeConfigId: typeof data.activeConfigId === 'string' ? data.activeConfigId : null,
    };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      Logger.info('[CustomCliConfigService] 配置文件不存在，使用默认配置');
      return DEFAULT_CUSTOM_CLI_CONFIG_STORAGE;
    }
    Logger.error('[CustomCliConfigService] 读取配置文件失败:', error);
    return DEFAULT_CUSTOM_CLI_CONFIG_STORAGE;
  }
}

export async function saveCustomCliConfigStorage(data: CustomCliConfigStorage): Promise<void> {
  const filePath = getCustomCliConfigFilePath();
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    Logger.info('[CustomCliConfigService] 配置文件已保存');
  } catch (error: unknown) {
    Logger.error('[CustomCliConfigService] 保存配置文件失败:', error);
    throw error;
  }
}

export async function fetchCustomCliModelsFromEndpoint(
  baseUrl: string,
  apiKey: string
): Promise<string[]> {
  const url = new URL('/v1/models', baseUrl).toString();

  Logger.info(`[CustomCliConfigService] 拉取模型列表: ${url}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`请求失败 (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = (await response.json()) as unknown;

  if (data && typeof data === 'object' && 'data' in data && Array.isArray(data.data)) {
    const models = data.data
      .map(model => {
        if (model && typeof model === 'object') {
          const item = model as { id?: unknown; name?: unknown };
          return typeof item.id === 'string'
            ? item.id
            : typeof item.name === 'string'
              ? item.name
              : null;
        }
        return null;
      })
      .filter((model): model is string => !!model);
    Logger.info(`[CustomCliConfigService] 成功获取 ${models.length} 个模型`);
    return models;
  }

  if (Array.isArray(data)) {
    const models = data
      .map(model => {
        if (typeof model === 'string') {
          return model;
        }
        if (model && typeof model === 'object') {
          const item = model as { id?: unknown; name?: unknown };
          return typeof item.id === 'string'
            ? item.id
            : typeof item.name === 'string'
              ? item.name
              : null;
        }
        return null;
      })
      .filter((model): model is string => !!model);
    Logger.info(`[CustomCliConfigService] 成功获取 ${models.length} 个模型`);
    return models;
  }

  throw new Error('无法解析模型列表响应');
}
