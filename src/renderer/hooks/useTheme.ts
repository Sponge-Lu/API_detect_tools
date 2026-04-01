/**
 * 输入: localStorage (主题设置), 系统主题偏好
 * 输出: 主题模式, 切换方法, 深色模式标志
 * 定位: 业务逻辑层 - 管理应用主题和系统偏好检测
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/hooks/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * 主题管理 Hook
 * 支持：3 套浅色主题 + 1 套统一暗色主题
 * 主题设置会同步保存到主进程存储，确保下次启动时窗口背景色正确
 */

import { useEffect, useState } from 'react';
import {
  normalizeThemeMode,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from '../../shared/theme/themePresets';

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'dark');
}

function persistThemeMode(mode: ThemeMode) {
  localStorage.setItem(THEME_STORAGE_KEY, mode);
  window.electronAPI?.theme?.save?.(mode)?.catch?.(() => {
    // 静默处理保存失败
  });
}

export function useTheme() {
  // 从 localStorage 读取主题设置，并兼容旧值迁移
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return normalizeThemeMode(localStorage.getItem(THEME_STORAGE_KEY));
  });

  // 切换主题模式（同时保存到 localStorage 和主进程存储）
  const changeThemeMode = (mode: ThemeMode) => {
    setThemeMode(mode);
    persistThemeMode(mode);
  };

  // 应用主题并在挂载时完成旧值迁移
  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    applyTheme(themeMode);

    if (storedTheme !== themeMode) {
      persistThemeMode(themeMode);
    }
  }, [themeMode]);

  return {
    themeMode,
    appliedTheme: themeMode,
    changeThemeMode,
  };
}
