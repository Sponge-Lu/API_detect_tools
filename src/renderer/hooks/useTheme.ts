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
 * 支持：白天模式、夜晚模式、跟随系统
 * 主题设置会同步保存到主进程存储，确保下次启动时窗口背景色正确
 */

import { useState, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'app-theme-mode';

export function useTheme() {
  // 从 localStorage 读取主题设置，默认跟随系统
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    const isValid = stored === 'light' || stored === 'dark' || stored === 'system';
    return isValid ? (stored as ThemeMode) : 'system';
  });

  // 获取系统主题偏好
  const getSystemTheme = (): 'light' | 'dark' => {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  };

  // 计算实际应用的主题
  const getAppliedTheme = (): 'light' | 'dark' => {
    if (themeMode === 'system') {
      return getSystemTheme();
    }
    return themeMode;
  };

  // 应用主题到 DOM
  const applyTheme = (theme: 'light' | 'dark') => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  };

  // 切换主题模式（同时保存到 localStorage 和主进程存储）
  const changeThemeMode = (mode: ThemeMode) => {
    setThemeMode(mode);
    localStorage.setItem(THEME_STORAGE_KEY, mode);
    // 同步保存到主进程存储，确保下次启动时窗口背景色正确
    window.electronAPI?.theme?.save(mode).catch(() => {
      // 静默处理保存失败
    });
  };

  // 监听主题模式变化
  useEffect(() => {
    const appliedTheme = getAppliedTheme();
    applyTheme(appliedTheme);
  }, [themeMode]);

  // 监听系统主题变化（仅在 system 模式下生效）
  useEffect(() => {
    if (themeMode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const newTheme = getSystemTheme();
      applyTheme(newTheme);
    };

    // 使用新的 API（如果支持）
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      // 降级到旧的 API
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [themeMode]);

  return {
    themeMode,
    appliedTheme: getAppliedTheme(),
    changeThemeMode,
  };
}
