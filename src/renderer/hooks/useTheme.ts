/**
 * 主题管理 Hook
 * 支持：白天模式、夜晚模式、跟随系统
 */

import { useState, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'app-theme-mode';

export function useTheme() {
  // 从 localStorage 读取主题设置，默认跟随系统
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return (stored as ThemeMode) || 'system';
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

  // 切换主题模式
  const changeThemeMode = (mode: ThemeMode) => {
    setThemeMode(mode);
    localStorage.setItem(THEME_STORAGE_KEY, mode);
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

