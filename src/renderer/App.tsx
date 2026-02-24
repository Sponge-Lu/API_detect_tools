/**
 * 输入: Hooks (useTheme, useUpdate, useDataLoader), Store (configStore, uiStore, toastStore), Pages (SitesPage, CustomCliPage, CreditPage, SettingsPage)
 * 输出: React 组件树, UI 状态管理, IPC 事件处理
 * 定位: 展示层 - 根组件，管理主布局、初始化和全局弹窗
 */

import Logger from './utils/logger';
import { useEffect, useRef, useState } from 'react';
import { XCircle, Loader2 } from 'lucide-react';
import { ConfirmDialog, initialDialogState } from './components/ConfirmDialog';
import { Header } from './components/Header';
import { AuthErrorDialog, CloseBehaviorDialog, DownloadUpdatePanel } from './components/dialogs';
import { ToastContainer } from './components/Toast';
import { IOSButton } from './components/IOSButton';
import { useTheme, useDataLoader, useUpdate, useSiteDetection } from './hooks';
// 从共享的types文件导入并重新导出类型
import type { SiteConfig, DetectionResult } from '../shared/types/site';
export type { SiteConfig, DetectionResult } from '../shared/types/site';

// 导入页面组件
import { SitesPage } from './pages/SitesPage';
import { CustomCliPage } from './pages/CustomCliPage';
import { CreditPage } from './pages/CreditPage';
import { SettingsPage } from './pages/SettingsPage';

// 导入 Zustand Store
import { useConfigStore } from './store/configStore';
import { useDetectionStore } from './store/detectionStore';
import { useUIStore, SortField } from './store/uiStore';
import { useToastStore, toast } from './store/toastStore';

declare global {
  interface Window {
    electronAPI: {
      loadConfig: () => Promise<Config>;
      saveConfig: (config: Config) => Promise<void>;
      launchChromeForLogin: (url: string) => Promise<{ success: boolean; message: string }>;
      closeBrowser: () => Promise<void>;
      getCookies: (url: string) => Promise<any[]>;
      fetchWithCookies: (
        url: string,
        options: any
      ) => Promise<{ ok: boolean; status: number; statusText: string; data: any }>;
      detectSite: (
        site: SiteConfig,
        timeout: number,
        quickRefresh?: boolean,
        cachedData?: DetectionResult,
        forceAcceptEmpty?: boolean
      ) => Promise<DetectionResult>;
      detectAllSites: (
        config: Config,
        quickRefresh?: boolean,
        cachedResults?: DetectionResult[]
      ) => Promise<DetectionResult[]>;
      openUrl: (url: string) => Promise<void>;
      getAllAccounts: () => Promise<any[]>;
      token?: any;
      storage?: any;
      theme?: {
        save: (themeMode: 'light' | 'dark' | 'system') => Promise<{ success: boolean }>;
        load: () => Promise<{ success: boolean; data?: 'light' | 'dark' | 'system' }>;
      };
      webdav?: {
        testConnection: (config: any) => Promise<{ success: boolean; error?: string }>;
        saveConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
        getConfig: () => Promise<{ success: boolean; data?: any; error?: string }>;
        listBackups: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        uploadBackup: () => Promise<{ success: boolean; data?: string; error?: string }>;
        restoreBackup: (filename: string) => Promise<{ success: boolean; error?: string }>;
        deleteBackup: (filename: string) => Promise<{ success: boolean; error?: string }>;
      };
      backup?: {
        list: () => Promise<any[]>;
      };
      update?: {
        check: () => Promise<{
          hasUpdate: boolean;
          hasPreReleaseUpdate: boolean;
          currentVersion: string;
          latestVersion: string;
          latestPreReleaseVersion?: string;
          releaseInfo?: {
            version: string;
            releaseDate: string;
            releaseNotes: string;
            downloadUrl: string;
            htmlUrl: string;
            isPreRelease: boolean;
          };
          preReleaseInfo?: {
            version: string;
            releaseDate: string;
            releaseNotes: string;
            downloadUrl: string;
            htmlUrl: string;
            isPreRelease: boolean;
          };
        }>;
        getCurrentVersion: () => Promise<string>;
        openDownload: (url: string) => Promise<void>;
        getSettings: () => Promise<{
          autoCheckEnabled: boolean;
          includePreRelease: boolean;
          lastCheckTime?: string;
        }>;
        saveSettings: (settings: {
          autoCheckEnabled: boolean;
          includePreRelease: boolean;
          lastCheckTime?: string;
        }) => Promise<void>;
        startDownload: (url: string) => Promise<string>;
        cancelDownload: () => Promise<void>;
        installUpdate: (filePath: string) => Promise<void>;
        onDownloadProgress: (
          callback: (progress: {
            percent: number;
            transferred: number;
            total: number;
            speed: number;
          }) => void
        ) => () => void;
      };
      cliCompat: {
        testWithConfig: (params: {
          siteUrl: string;
          configs: Array<{
            cliType: 'claudeCode' | 'codex' | 'geminiCli';
            apiKey: string;
            model: string;
          }>;
        }) => Promise<{
          success: boolean;
          data?: {
            claudeCode: boolean | null;
            codex: boolean | null;
            geminiCli: boolean | null;
          };
          error?: string;
        }>;
        saveResult: (siteUrl: string, result: any) => Promise<{ success: boolean; error?: string }>;
        saveConfig: (siteUrl: string, config: any) => Promise<{ success: boolean; error?: string }>;
      };
      configDetection: {
        detectCliConfig: (
          cliType: 'claudeCode' | 'codex' | 'geminiCli',
          sites: Array<{ id: string; name: string; url: string }>
        ) => Promise<any>;
        detectAllCliConfig: (
          sites: Array<{ id: string; name: string; url: string }>
        ) => Promise<import('../shared/types/config-detection').AllCliDetectionResult>;
        clearCache: (cliType?: 'claudeCode' | 'codex' | 'geminiCli') => Promise<void>;
        resetCliConfig: (cliType: 'claudeCode' | 'codex' | 'geminiCli') => Promise<{
          success: boolean;
          deletedPaths: string[];
          error?: string;
        }>;
      };
      closeBehavior?: {
        getSettings: () => Promise<{
          success: boolean;
          data?: { behavior: 'ask' | 'quit' | 'minimize' };
          error?: string;
        }>;
        saveSettings: (settings: {
          behavior: 'ask' | 'quit' | 'minimize';
        }) => Promise<{ success: boolean; error?: string }>;
        onShowDialog: (callback: () => void) => () => void;
        respondToDialog: (response: {
          action: 'quit' | 'minimize';
          remember: boolean;
        }) => Promise<{ success: boolean; error?: string }>;
        minimizeToTray: () => Promise<{ success: boolean; error?: string }>;
        quitApp: () => Promise<{ success: boolean; error?: string }>;
      };
      credit?: {
        fetch: () => Promise<{ success: boolean; data?: any; error?: string }>;
        login: () => Promise<{ success: boolean; message?: string; error?: string }>;
        logout: () => Promise<{ success: boolean; error?: string }>;
        getStatus: () => Promise<{ success: boolean; data?: boolean; error?: string }>;
        saveConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
        loadConfig: () => Promise<{ success: boolean; data?: any; error?: string }>;
        getCached: () => Promise<{ success: boolean; data?: any; error?: string }>;
      };
    };
  }
}

export interface Settings {
  timeout: number;
  concurrent: boolean;
  max_concurrent?: number;
  show_disabled: boolean;
  browser_path?: string;
  webdav?: {
    enabled: boolean;
    serverUrl: string;
    username: string;
    password: string;
    remotePath: string;
    maxBackups: number;
  };
  sort?: {
    field: string | null;
    order: 'asc' | 'desc';
  };
}

export interface SiteGroup {
  id: string;
  name: string;
}

export interface Config {
  sites: SiteConfig[];
  settings: Settings;
  siteGroups?: SiteGroup[];
}

function App() {
  // 初始化主题系统
  useTheme();

  // 软件更新检查
  const {
    updateInfo,
    settings: updateSettings,
    checkForUpdatesInBackground,
    currentVersion,
    downloadProgress,
    downloadPhase,
    downloadError,
    startDownload,
    cancelDownload,
    installUpdate,
  } = useUpdate();

  // Toast store
  const { toasts, removeToast } = useToastStore();

  // ========== 从 Store 读取状态 ==========
  const { config, setConfig, saving, loading, setLoading } = useConfigStore();

  const { setApiKeys, setUserGroups, setModelPricing, setCliCompatibility, detectCliConfig } =
    useDetectionStore();

  const {
    activeTab,
    setActiveTab,
    dialogState,
    setDialogState,
    authErrorSites,
    setAuthErrorSites,
    showAuthErrorDialog,
    setShowAuthErrorDialog,
    setProcessingAuthErrorSite,
    setEditingSite,
    setShowSiteEditor,
    setSortField,
    setSortOrder,
    showDownloadPanel,
    downloadPanelRelease,
    openDownloadPanel,
    closeDownloadPanel,
  } = useUIStore();

  // 窗口关闭行为对话框状态
  const [showCloseBehaviorDialog, setShowCloseBehaviorDialog] = useState(false);

  // 用于存储初始化状态的 ref
  const initRef = useRef(false);

  // 站点检测 hook - 仅用于获取 setResults 给 useDataLoader
  const { results, setResults } = useSiteDetection({
    onAuthError: sites => {
      setAuthErrorSites(sites);
      setShowAuthErrorDialog(true);
    },
    showDialog: options => {
      return new Promise(resolve => {
        setDialogState({
          isOpen: true,
          type: options.type || 'confirm',
          title: options.title,
          message: options.message,
          confirmText: options.confirmText,
          cancelText: options.cancelText,
          onConfirm: () => {
            setDialogState(initialDialogState);
            resolve(true);
          },
          onCancel: () => {
            setDialogState(initialDialogState);
            resolve(false);
          },
        });
      });
    },
  });

  // CLI 兼容性 - 仅获取 setCliConfig 给 useDataLoader
  const setCliConfig = useDetectionStore(state => state.setCliConfig);

  // 数据加载 hook
  const { loadCachedData } = useDataLoader({
    setResults,
    setApiKeys,
    setUserGroups,
    setModelPricing,
    setCliCompatibility,
    setCliConfig,
    detectCliConfig,
  });

  const loadCachedDataRef = useRef(loadCachedData);
  loadCachedDataRef.current = loadCachedData;

  // 启动时自动检查更新
  useEffect(() => {
    if (updateSettings.autoCheckEnabled) {
      const timer = setTimeout(() => {
        checkForUpdatesInBackground();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [updateSettings.autoCheckEnabled, checkForUpdatesInBackground]);

  // 应用初始化：加载配置和缓存数据
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const init = async () => {
      const cfg = await loadConfig();
      if (cfg) {
        await loadCachedDataRef.current?.(cfg);
      }
    };
    init();
  }, []);

  // 监听主进程的关闭行为对话框显示事件
  useEffect(() => {
    const unsubscribe = window.electronAPI?.closeBehavior?.onShowDialog(() => {
      setShowCloseBehaviorDialog(true);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  const loadConfig = async (): Promise<Config | null> => {
    try {
      setLoading(true);
      const cfg = await window.electronAPI.loadConfig();
      setConfig(cfg);
      if (cfg?.settings?.sort) {
        const { field, order } = cfg.settings.sort;
        if (field) {
          setSortField(field as SortField);
        }
        if (order) {
          setSortOrder(order);
        }
      }
      return cfg;
    } catch (error) {
      Logger.error('加载配置失败:', error);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (updateInfo?.releaseInfo) {
      openDownloadPanel(updateInfo.releaseInfo);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-light-bg dark:bg-dark-bg relative">
        <div className="light-bg-decoration dark:dark-bg-decoration"></div>
        <div className="text-center relative z-10">
          <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary-500" />
          <p className="text-light-text-secondary dark:text-dark-text-secondary">加载配置中...</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-screen bg-light-bg dark:bg-dark-bg relative">
        <div className="light-bg-decoration dark:dark-bg-decoration"></div>
        <div className="text-center relative z-10">
          <XCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
          <p className="text-light-text dark:text-dark-text mb-4">配置加载失败</p>
          <IOSButton variant="primary" onClick={loadConfig}>
            重试
          </IOSButton>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text relative overflow-x-auto overflow-y-hidden ios-responsive-container">
      {/* 装饰背景 */}
      <div className="light-bg-decoration dark:dark-bg-decoration"></div>

      {/* 主要内容 */}
      <div className="relative z-10 h-full flex flex-col min-w-[1024px]">
        <Header
          activeTab={activeTab}
          onTabChange={setActiveTab}
          saving={saving}
          hasUpdate={updateInfo?.hasUpdate}
          updateInfo={updateInfo}
          onDownloadUpdate={handleDownloadUpdate}
        />

        {/* 页面内容区域 */}
        {activeTab === 'sites' && <SitesPage />}
        {activeTab === 'cli' && <CustomCliPage />}
        {activeTab === 'credit' && <CreditPage />}
        {activeTab === 'settings' && <SettingsPage />}
      </div>

      {/* ===== 全局弹窗 ===== */}

      {/* 认证错误弹窗 */}
      {showAuthErrorDialog && authErrorSites.length > 0 && (
        <AuthErrorDialog
          sites={authErrorSites}
          configSites={config.sites}
          onClose={() => setShowAuthErrorDialog(false)}
          onEditSite={(siteIndex, siteName) => {
            setProcessingAuthErrorSite(siteName);
            setEditingSite(siteIndex);
            setShowSiteEditor(true);
            setShowAuthErrorDialog(false);
            setActiveTab('sites');
          }}
          onProcessAll={() => {
            const firstSite = authErrorSites[0];
            const siteIndex = config.sites.findIndex(s => s.name === firstSite.name);
            if (siteIndex !== -1) {
              setProcessingAuthErrorSite(firstSite.name);
              setEditingSite(siteIndex);
              setShowSiteEditor(true);
            }
            setShowAuthErrorDialog(false);
            setActiveTab('sites');
          }}
          onForceRefresh={async (siteIndex, siteName) => {
            const site = config.sites[siteIndex];
            if (!site) return;

            const remaining = authErrorSites.filter(s => s.name !== siteName);
            setAuthErrorSites(remaining);

            if (remaining.length === 0) {
              setShowAuthErrorDialog(false);
            }

            try {
              const timeout = config.settings?.timeout ?? 30;
              const result = await window.electronAPI.detectSite(
                site,
                timeout,
                false,
                undefined,
                true
              );

              const filtered = results.filter(r => r.name !== site.name);
              setResults([...filtered, result]);

              const existingResult = results.find(r => r.name === siteName);
              const hasChanges =
                !existingResult ||
                existingResult.status !== result.status ||
                existingResult.balance !== result.balance ||
                existingResult.todayUsage !== result.todayUsage ||
                existingResult.models.length !== result.models.length ||
                JSON.stringify(existingResult.apiKeys) !== JSON.stringify(result.apiKeys);

              const { setRefreshMessage } = useUIStore.getState();
              setRefreshMessage({
                site: siteName,
                message: hasChanges ? '✅ 数据已更新' : 'ℹ️ 数据无变化',
                type: hasChanges ? 'success' : 'info',
              });
              setTimeout(() => setRefreshMessage(null), 3000);
            } catch (error: any) {
              const { setRefreshMessage } = useUIStore.getState();
              setRefreshMessage({
                site: siteName,
                message: `❌ 刷新失败: ${error.message}`,
                type: 'info',
              });
              setTimeout(() => setRefreshMessage(null), 5000);
            }
          }}
          onOpenSite={async url => {
            try {
              await window.electronAPI.openUrl(url);
            } catch (error: any) {
              toast.error(`打开站点失败: ${error.message}`);
            }
          }}
        />
      )}

      {/* 自定义确认弹窗 */}
      <ConfirmDialog
        isOpen={dialogState.isOpen}
        type={dialogState.type}
        title={dialogState.title}
        message={dialogState.message}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        onConfirm={dialogState.onConfirm || (() => setDialogState(initialDialogState))}
        onCancel={dialogState.onCancel}
      />

      {/* 窗口关闭行为对话框 */}
      <CloseBehaviorDialog
        open={showCloseBehaviorDialog}
        onClose={() => setShowCloseBehaviorDialog(false)}
      />

      {/* 下载更新面板 */}
      {downloadPanelRelease && (
        <DownloadUpdatePanel
          isOpen={showDownloadPanel}
          onClose={closeDownloadPanel}
          currentVersion={currentVersion}
          releaseInfo={downloadPanelRelease}
          downloadPhase={downloadPhase}
          downloadProgress={downloadProgress}
          downloadError={downloadError}
          onStartDownload={() => {
            if (downloadPanelRelease.downloadUrl) {
              startDownload(downloadPanelRelease.downloadUrl);
            }
          }}
          onCancelDownload={cancelDownload}
          onInstall={installUpdate}
        />
      )}

      {/* Toast 通知 */}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}

export default App;
