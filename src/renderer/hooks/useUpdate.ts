/**
 * 输入: IPC 调用 (update:check), ReleaseInfo (发布信息)
 * 输出: 更新检查方法, 更新状态, 发布信息
 * 定位: 业务逻辑层 - 管理应用更新检查和通知
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/hooks/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

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

export interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  speed: number; // bytes per second
}

export type DownloadPhase = 'idle' | 'downloading' | 'completed' | 'error';

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
  // 下载相关状态
  downloadProgress: DownloadProgress | null;
  downloadPhase: DownloadPhase;
  downloadedFilePath: string | null;
  downloadError: string | null;
  // 操作
  checkForUpdates: () => Promise<void>;
  checkForUpdatesInBackground: () => Promise<void>;
  openDownloadUrl: () => Promise<void>;
  updateSettings: (settings: Partial<UpdateSettings>) => Promise<void>;
  // 下载相关操作
  startDownload: (url: string) => Promise<void>;
  cancelDownload: () => Promise<void>;
  installUpdate: () => Promise<void>;
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

  // 下载相关状态
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloadPhase, setDownloadPhase] = useState<DownloadPhase>('idle');
  const [downloadedFilePath, setDownloadedFilePath] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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

  // 监听下载进度
  useEffect(() => {
    const removeListener = window.electronAPI?.update?.onDownloadProgress(progress => {
      setDownloadProgress(progress);
    });

    return () => {
      if (removeListener) {
        removeListener();
      }
    };
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

  // 开始下载更新
  const startDownload = useCallback(async (url: string) => {
    setDownloadPhase('downloading');
    setDownloadProgress(null);
    setDownloadError(null);
    setDownloadedFilePath(null);

    try {
      const filePath = await window.electronAPI?.update?.startDownload(url);
      if (filePath) {
        setDownloadedFilePath(filePath);
        setDownloadPhase('completed');
      }
    } catch (err: any) {
      const errorMessage = err?.message || '下载失败';
      setDownloadError(errorMessage);
      setDownloadPhase('error');
      console.error('[useUpdate] 下载失败:', err);
    }
  }, []);

  // 取消下载
  const cancelDownload = useCallback(async () => {
    try {
      await window.electronAPI?.update?.cancelDownload();
      setDownloadPhase('idle');
      setDownloadProgress(null);
      setDownloadError(null);
    } catch (err) {
      console.error('[useUpdate] 取消下载失败:', err);
    }
  }, []);

  // 安装更新
  const installUpdate = useCallback(async () => {
    if (!downloadedFilePath) {
      console.error('[useUpdate] 没有可安装的文件');
      return;
    }

    try {
      await window.electronAPI?.update?.installUpdate(downloadedFilePath);
    } catch (err) {
      console.error('[useUpdate] 安装失败:', err);
      setDownloadError('安装失败: ' + (err as any)?.message);
      setDownloadPhase('error');
    }
  }, [downloadedFilePath]);

  return {
    currentVersion,
    updateInfo,
    isChecking,
    error,
    settings,
    downloadProgress,
    downloadPhase,
    downloadedFilePath,
    downloadError,
    checkForUpdates,
    checkForUpdatesInBackground,
    openDownloadUrl,
    updateSettings,
    startDownload,
    cancelDownload,
    installUpdate,
  };
}
