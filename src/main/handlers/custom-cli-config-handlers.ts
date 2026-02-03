/**
 * 输入: 自定义 CLI 配置数据
 * 输出: IPC 事件处理响应 (配置操作结果)
 * 定位: IPC 处理层 - 处理自定义 CLI 配置的持久化和模型拉取
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/handlers/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { ipcMain, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import Logger from '../utils/logger';
import type { CustomCliConfig } from '../../shared/types/custom-cli-config';

/** 存储数据结构 */
interface CustomCliConfigStorage {
  configs: CustomCliConfig[];
  activeConfigId: string | null;
}

/** IPC 通道名 */
const CHANNELS = {
  LOAD: 'custom-cli-config:load',
  SAVE: 'custom-cli-config:save',
  FETCH_MODELS: 'custom-cli-config:fetch-models',
} as const;

/** 获取配置文件路径 */
function getConfigFilePath(): string {
  return path.join(app.getPath('userData'), 'custom-cli-configs.json');
}

/** 默认空存储 */
const DEFAULT_STORAGE: CustomCliConfigStorage = {
  configs: [],
  activeConfigId: null,
};

/**
 * 读取配置文件
 */
async function loadConfigFile(): Promise<CustomCliConfigStorage> {
  const filePath = getConfigFilePath();
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return {
      configs: data.configs || [],
      activeConfigId: data.activeConfigId || null,
    };
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      Logger.info('📄 [CustomCliConfigHandlers] 配置文件不存在，使用默认配置');
      return DEFAULT_STORAGE;
    }
    Logger.error('❌ [CustomCliConfigHandlers] 读取配置文件失败:', error);
    return DEFAULT_STORAGE;
  }
}

/**
 * 保存配置文件
 */
async function saveConfigFile(data: CustomCliConfigStorage): Promise<void> {
  const filePath = getConfigFilePath();
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    Logger.info('✅ [CustomCliConfigHandlers] 配置文件已保存');
  } catch (error: any) {
    Logger.error('❌ [CustomCliConfigHandlers] 保存配置文件失败:', error);
    throw error;
  }
}

/**
 * 从 OpenAI 兼容的 /v1/models 端点拉取模型列表
 */
async function fetchModelsFromEndpoint(baseUrl: string, apiKey: string): Promise<string[]> {
  // 构造模型列表端点
  const url = new URL('/v1/models', baseUrl).toString();

  Logger.info(`📡 [CustomCliConfigHandlers] 拉取模型列表: ${url}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000), // 30秒超时
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`请求失败 (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = (await response.json()) as any;

  // OpenAI 格式: { data: [{ id: "model-name", ... }] }
  if (data.data && Array.isArray(data.data)) {
    const models = data.data.map((m: any) => m.id || m.name).filter(Boolean);
    Logger.info(`✅ [CustomCliConfigHandlers] 成功获取 ${models.length} 个模型`);
    return models;
  }

  // 如果是直接的数组格式
  if (Array.isArray(data)) {
    const models = data
      .map((m: any) => (typeof m === 'string' ? m : m.id || m.name))
      .filter(Boolean);
    Logger.info(`✅ [CustomCliConfigHandlers] 成功获取 ${models.length} 个模型`);
    return models;
  }

  throw new Error('无法解析模型列表响应');
}

/**
 * 注册自定义 CLI 配置 IPC 处理器
 */
export function registerCustomCliConfigHandlers(): void {
  // 加载配置
  ipcMain.handle(CHANNELS.LOAD, async () => {
    try {
      Logger.info('📖 [CustomCliConfigHandlers] 收到加载配置请求');
      const data = await loadConfigFile();
      return data;
    } catch (error: any) {
      Logger.error('❌ [CustomCliConfigHandlers] 加载配置失败:', error);
      throw error;
    }
  });

  // 保存配置
  ipcMain.handle(CHANNELS.SAVE, async (_, data: CustomCliConfigStorage) => {
    try {
      Logger.info('💾 [CustomCliConfigHandlers] 收到保存配置请求');
      await saveConfigFile(data);
      return { success: true };
    } catch (error: any) {
      Logger.error('❌ [CustomCliConfigHandlers] 保存配置失败:', error);
      throw error;
    }
  });

  // 拉取模型
  ipcMain.handle(CHANNELS.FETCH_MODELS, async (_, baseUrl: string, apiKey: string) => {
    try {
      Logger.info('📡 [CustomCliConfigHandlers] 收到拉取模型请求');
      const models = await fetchModelsFromEndpoint(baseUrl, apiKey);
      return models;
    } catch (error: any) {
      Logger.error('❌ [CustomCliConfigHandlers] 拉取模型失败:', error);
      throw error;
    }
  });

  Logger.info('✅ [CustomCliConfigHandlers] 自定义 CLI 配置 IPC 处理器已注册');
}
