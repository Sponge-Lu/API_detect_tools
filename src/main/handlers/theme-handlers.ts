import { handleStorageIpc } from '../storage/ipc-handler';
import Logger from '../utils/logger';
/**
 * 主题相关 IPC 处理器
 */

import { app } from 'electron';
import { readStorageText } from '../storage/application-storage';
import { writeTextFileAtomically } from '../utils/atomic-json';
import * as path from 'path';
import { normalizeThemeMode, type ThemeMode } from '../../shared/theme/themePresets';

function getThemeSettingsPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'theme-settings.json');
}

export function registerThemeHandlers() {
  // 保存主题设置
  handleStorageIpc('theme:save', async (_, themeMode: ThemeMode) => {
    try {
      const themePath = getThemeSettingsPath();
      const normalizedThemeMode = normalizeThemeMode(themeMode);
      await writeTextFileAtomically(
        themePath,
        JSON.stringify({ themeMode: normalizedThemeMode }, null, 2)
      );
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      Logger.error('保存主题设置失败:', error);
      return { success: false, error: message };
    }
  });

  // 加载主题设置
  handleStorageIpc('theme:load', async () => {
    try {
      const themePath = getThemeSettingsPath();
      const data = await readStorageText(themePath);
      const settings = JSON.parse(data);
      return { success: true, data: normalizeThemeMode(settings.themeMode) };
    } catch {
      return { success: true, data: normalizeThemeMode(null) };
    }
  });
}
