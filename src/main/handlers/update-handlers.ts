/**
 * 软件更新 IPC 处理器
 * 处理更新检查、版本获取、下载链接打开和设置管理
 */

import { ipcMain } from 'electron';
import { updateService } from '../update-service';
import Logger from '../utils/logger';

/**
 * 注册更新相关的 IPC 处理器
 */
export function registerUpdateHandlers(): void {
  // 检查更新 - 直接返回结果，与 App.tsx 类型定义一致
  ipcMain.handle('update:check', async () => {
    try {
      Logger.info('[UpdateHandlers] 收到检查更新请求');
      const result = await updateService.checkForUpdates();
      return result;
    } catch (error: any) {
      Logger.error('[UpdateHandlers] 检查更新失败:', error.message);
      throw error;
    }
  });

  // 获取当前版本 - 直接返回版本字符串
  ipcMain.handle('update:get-current-version', () => {
    try {
      return updateService.getCurrentVersion();
    } catch (error: any) {
      Logger.error('[UpdateHandlers] 获取版本失败:', error.message);
      throw error;
    }
  });

  // 打开下载链接
  ipcMain.handle('update:open-download', async (_event, url: string) => {
    try {
      Logger.info('[UpdateHandlers] 打开下载链接:', url);
      await updateService.openDownloadUrl(url);
    } catch (error: any) {
      Logger.error('[UpdateHandlers] 打开下载链接失败:', error.message);
      throw error;
    }
  });

  // 获取更新设置 - 直接返回设置对象
  ipcMain.handle('update:get-settings', async () => {
    try {
      return await updateService.getSettings();
    } catch (error: any) {
      Logger.error('[UpdateHandlers] 获取设置失败:', error.message);
      throw error;
    }
  });

  // 保存更新设置
  ipcMain.handle('update:save-settings', async (_event, settings: any) => {
    try {
      await updateService.saveSettings(settings);
    } catch (error: any) {
      Logger.error('[UpdateHandlers] 保存设置失败:', error.message);
      throw error;
    }
  });

  Logger.info('✅ [UpdateHandlers] 更新相关 IPC 处理器已注册');
}
