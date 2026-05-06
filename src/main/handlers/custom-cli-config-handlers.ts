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

import { ipcMain } from 'electron';
import Logger from '../utils/logger';
import {
  fetchCustomCliModelsFromEndpoint,
  loadCustomCliConfigStorage,
  saveCustomCliConfigStorage,
  type CustomCliConfigStorage,
} from '../custom-cli-config-service';

/** IPC 通道名 */
const CHANNELS = {
  LOAD: 'custom-cli-config:load',
  SAVE: 'custom-cli-config:save',
  FETCH_MODELS: 'custom-cli-config:fetch-models',
} as const;

/**
 * 注册自定义 CLI 配置 IPC 处理器
 */
export function registerCustomCliConfigHandlers(): void {
  // 加载配置
  ipcMain.handle(CHANNELS.LOAD, async () => {
    try {
      Logger.info('📖 [CustomCliConfigHandlers] 收到加载配置请求');
      const data = await loadCustomCliConfigStorage();
      return data;
    } catch (error: unknown) {
      Logger.error('❌ [CustomCliConfigHandlers] 加载配置失败:', error);
      throw error;
    }
  });

  // 保存配置
  ipcMain.handle(CHANNELS.SAVE, async (_, data: CustomCliConfigStorage) => {
    try {
      Logger.info('💾 [CustomCliConfigHandlers] 收到保存配置请求');
      await saveCustomCliConfigStorage(data);
      return { success: true };
    } catch (error: unknown) {
      Logger.error('❌ [CustomCliConfigHandlers] 保存配置失败:', error);
      throw error;
    }
  });

  // 拉取模型
  ipcMain.handle(CHANNELS.FETCH_MODELS, async (_, baseUrl: string, apiKey: string) => {
    try {
      Logger.info('📡 [CustomCliConfigHandlers] 收到拉取模型请求');
      const models = await fetchCustomCliModelsFromEndpoint(baseUrl, apiKey);
      return models;
    } catch (error: unknown) {
      Logger.error('❌ [CustomCliConfigHandlers] 拉取模型失败:', error);
      throw error;
    }
  });

  Logger.info('✅ [CustomCliConfigHandlers] 自定义 CLI 配置 IPC 处理器已注册');
}
