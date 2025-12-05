/**
 * 软件更新管理 Hook
 * 提供更新检查、下载链接打开、设置管理等功能
 */

import { useState, useEffect, useCallback } from 'react';

export interface ReleaseInfo {
  version: string;
  releaseDate: string;
  releaseNotes: string;
  downloadUrl: string;
  htmlUrl: string;
  isPreRelease: boolean;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  hasPreReleaseUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  latestPreReleaseVersion?: string;
  releaseInfo?: ReleaseInfo;
  preReleaseInfo?: ReleaseInfo;
}

export interface UpdateSettings {
  autoCheckEnabled: boolean;
  includePreRelease: boolean;
  lastCheckTime?: string;
}

export interface UseUpdateReturn {
  // 状态
  currentVersion: string;
  updateInfo: UpdateCheckResult | null;
  isChecking: boolean;
  error: string | null;
  settings: UpdateSettings;
  // 操作
  checkForUpdates: () => Promise<void>;
  checkForUpdatesInBackground: () => Promise<void>;
  openDownloadUrl: () => Promise<void>;
  updateSettings: (settings: Partial<UpdateSettings>) => Promise<void>;
}

const DEFAULT_SETTINGS: UpdateSettings = {
  autoCheckEnabled: true,
  includePreRelease: false,
};

export function useUpdate(): UseUpdateReturn {
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<UpdateSettings>(DEFAULT_SETTINGS);

  // 初始化：获取当前版本和设置
  useEffect(() => {
    const init = async () => {
      try {
        const version = await window.electronAPI?.update?.getCurrentVersion();
        if (version) {
          setCurrentVersion(version);
        }

        const loadedSettings = await window.electronAPI?.update?.getSettings();
        if (loadedSettings) {
          setSettings({ ...DEFAULT_SETTINGS, ...loadedSettings });
        }
      } catch (err) {
        // 静默处理初始化错误
        console.error('[useUpdate] 初始化失败:', err);
      }
    };

    init();
  }, []);

  // 检查更新
  const checkForUpdates = useCallback(async () => {
    setIsChecking(true);
    setError(null);

    try {
      const result = await window.electronAPI?.update?.check();
      if (result) {
        setUpdateInfo(result);
      }
    } catch (err: any) {
      const errorMessage = err?.message || '检查更新失败';
      setError(errorMessage);
      console.error('[useUpdate] 检查更新失败:', err);
    } finally {
      setIsChecking(false);
    }
  }, []);

  // 后台静默检查更新（不显示加载状态和错误）
  const checkForUpdatesInBackground = useCallback(async () => {
    try {
      const result = await window.electronAPI?.update?.check();
      if (result) {
        setUpdateInfo(result);
      }
    } catch (err) {
      // 后台检查失败时静默处理，不设置错误状态
      console.error('[useUpdate] 后台检查更新失败:', err);
    }
  }, []);

  // 打开下载链接
  const openDownloadUrl = useCallback(async () => {
    if (!updateInfo?.releaseInfo?.downloadUrl) {
      return;
    }

    try {
      await window.electronAPI?.update?.openDownload(updateInfo.releaseInfo.downloadUrl);
    } catch (err) {
      console.error('[useUpdate] 打开下载链接失败:', err);
    }
  }, [updateInfo]);

  // 更新设置
  const updateSettings = useCallback(
    async (newSettings: Partial<UpdateSettings>) => {
      const merged = { ...settings, ...newSettings };
      setSettings(merged);

      try {
        await window.electronAPI?.update?.saveSettings(merged);
      } catch (err) {
        console.error('[useUpdate] 保存设置失败:', err);
      }
    },
    [settings]
  );

  return {
    currentVersion,
    updateInfo,
    isChecking,
    error,
    settings,
    checkForUpdates,
    checkForUpdatesInBackground,
    openDownloadUrl,
    updateSettings,
  };
}
