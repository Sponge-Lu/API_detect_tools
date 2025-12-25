/**
 * 窗口关闭行为相关 IPC 处理器
 *
 * 输入: CloseBehaviorManager 实例
 * 输出: 注册到 ipcMain 的关闭行为相关 IPC 事件监听器
 * 定位: 集成层 - 处理窗口关闭行为相关的 IPC 通信
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/handlers/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { ipcMain } from 'electron';
import Logger from '../utils/logger';
import type { CloseBehaviorManager, CloseBehaviorSettings } from '../close-behavior-manager';

// IPC 通道定义
export const CLOSE_BEHAVIOR_CHANNELS = {
  GET_SETTINGS: 'close-behavior:get-settings',
  SAVE_SETTINGS: 'close-behavior:save-settings',
  SHOW_DIALOG: 'close-behavior:show-dialog',
  DIALOG_RESPONSE: 'close-behavior:dialog-response',
  MINIMIZE_TO_TRAY: 'close-behavior:minimize-to-tray',
  QUIT_APP: 'close-behavior:quit-app',
} as const;

export function registerCloseBehaviorHandlers(closeBehaviorManager: CloseBehaviorManager): void {
  // 获取当前设置
  ipcMain.handle(CLOSE_BEHAVIOR_CHANNELS.GET_SETTINGS, async () => {
    try {
      const settings = closeBehaviorManager.getSettings();
      return { success: true, data: settings };
    } catch (error: any) {
      Logger.error('❌ [CloseBehaviorHandlers] 获取设置失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 保存设置
  ipcMain.handle(
    CLOSE_BEHAVIOR_CHANNELS.SAVE_SETTINGS,
    async (_, settings: CloseBehaviorSettings) => {
      try {
        await closeBehaviorManager.saveSettings(settings);
        return { success: true };
      } catch (error: any) {
        Logger.error('❌ [CloseBehaviorHandlers] 保存设置失败:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // 处理对话框响应
  ipcMain.handle(
    CLOSE_BEHAVIOR_CHANNELS.DIALOG_RESPONSE,
    async (_, response: { action: 'quit' | 'minimize'; remember: boolean }) => {
      try {
        await closeBehaviorManager.handleDialogResponse(response);
        return { success: true };
      } catch (error: any) {
        Logger.error('❌ [CloseBehaviorHandlers] 处理对话框响应失败:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // 最小化到托盘
  ipcMain.handle(CLOSE_BEHAVIOR_CHANNELS.MINIMIZE_TO_TRAY, async () => {
    try {
      closeBehaviorManager.minimizeToTray();
      return { success: true };
    } catch (error: any) {
      Logger.error('❌ [CloseBehaviorHandlers] 最小化到托盘失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 退出应用
  ipcMain.handle(CLOSE_BEHAVIOR_CHANNELS.QUIT_APP, async () => {
    try {
      closeBehaviorManager.quitApp();
      return { success: true };
    } catch (error: any) {
      Logger.error('❌ [CloseBehaviorHandlers] 退出应用失败:', error);
      return { success: false, error: error.message };
    }
  });

  Logger.info('✅ [CloseBehaviorHandlers] 关闭行为 IPC 处理器已注册');
}
