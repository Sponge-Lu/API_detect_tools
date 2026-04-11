import Logger from '../utils/logger';
/**
 * 主题相关 IPC 处理器
 */

import { ipcMain, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { normalizeThemeMode, type ThemeMode } from '../../shared/theme/themePresets';

function getThemeSettingsPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'theme-settings.json');
}

export function registerThemeHandlers() {
  // 保存主题设置
  ipcMain.handle('theme:save', async (_, themeMode: ThemeMode) => {
    try {
      const themePath = getThemeSettingsPath();
      const normalizedThemeMode = normalizeThemeMode(themeMode);
      await fs.writeFile(themePath, JSON.stringify({ themeMode: normalizedThemeMode }, null, 2), 'utf-8');
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      Logger.error('保存主题设置失败:', error);
      return { success: false, error: message };
    }
  });

  // 加载主题设置
  ipcMain.handle('theme:load', async () => {
    try {
      const themePath = getThemeSettingsPath();
      const data = await fs.readFile(themePath, 'utf-8');
      const settings = JSON.parse(data);
      return { success: true, data: normalizeThemeMode(settings.themeMode) };
    } catch {
      return { success: true, data: normalizeThemeMode(null) };
    }
  });
}
