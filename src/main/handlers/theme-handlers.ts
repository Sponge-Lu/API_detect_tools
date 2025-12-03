import Logger from '../utils/logger';
/**
 * 主题相关 IPC 处理器
 */

import { ipcMain, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

function getThemeSettingsPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'theme-settings.json');
}

export function registerThemeHandlers() {
  // 保存主题设置
  ipcMain.handle('theme:save', async (_, themeMode: 'light' | 'dark' | 'system') => {
    try {
      const themePath = getThemeSettingsPath();
      await fs.writeFile(themePath, JSON.stringify({ themeMode }, null, 2), 'utf-8');
      return { success: true };
    } catch (error: any) {
      Logger.error('保存主题设置失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 加载主题设置
  ipcMain.handle('theme:load', async () => {
    try {
      const themePath = getThemeSettingsPath();
      const data = await fs.readFile(themePath, 'utf-8');
      const settings = JSON.parse(data);
      if (
        settings.themeMode === 'light' ||
        settings.themeMode === 'dark' ||
        settings.themeMode === 'system'
      ) {
        return { success: true, data: settings.themeMode };
      }
      return { success: true, data: 'system' };
    } catch {
      return { success: true, data: 'system' };
    }
  });
}
