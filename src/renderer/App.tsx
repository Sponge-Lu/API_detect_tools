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
import { VerticalSidebar } from './components/Sidebar';
import { AuthErrorDialog, CloseBehaviorDialog, DownloadUpdatePanel } from './components/dialogs';
import { ToastContainer } from './components/Toast';
import { IOSButton } from './components/IOSButton';
import { useTheme, useDataLoader, useUpdate, useSiteDetection, useAutoRefresh } from './hooks';
// 从共享的types文件导入并重新导出类型
import type { SiteConfig, DetectionResult, AccountCredential } from '../shared/types/site';
export type { SiteConfig, DetectionResult } from '../shared/types/site';

// 导入页面组件
import { SitesPage } from './pages/SitesPage';
import { CustomCliPage } from './pages/CustomCliPage';
import { CreditPage } from './pages/CreditPage';
import { SettingsPage } from './pages/SettingsPage';
import { ModelRedirectionTab } from './components/Route/Redirection/ModelRedirectionTab';
import { CliUsabilityTab } from './components/Route/Usability/CliUsabilityTab';
import { ProxyStatsTab } from './components/Route/ProxyStats/ProxyStatsTab';
import { LDC_UI_VISIBILITY } from '../shared/constants';

// 导入 Zustand Store
import { useConfigStore } from './store/configStore';
import { useDetectionStore } from './store/detectionStore';
import { useUIStore, SortField } from './store/uiStore';
import { useRouteStore } from './store/routeStore';
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
        forceAcceptEmpty?: boolean,
        accountId?: string
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
            baseUrl?: string;
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
        saveResult: (
          siteUrl: string,
          result: any,
          accountId?: string
        ) => Promise<{ success: boolean; error?: string }>;
        saveConfig: (
          siteUrl: string,
          config: any,
          accountId?: string
        ) => Promise<{ success: boolean; error?: string }>;
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
        readCliConfigFiles: (cliType: 'claudeCode' | 'codex' | 'geminiCli') => Promise<{
          success: boolean;
          files: Array<{
            key: string;
            relativePath: string;
            absolutePath: string;
            content: string | null;
            exists: boolean;
          }>;
          error?: string;
        }>;
        saveCliConfigFile: (
          absolutePath: string,
          content: string
        ) => Promise<{
          success: boolean;
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
      accounts?: {
        list: (siteId: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        add: (data: {
          site_id: string;
          account_name: string;
          user_id: string;
          username?: string;
          access_token: string;
          auth_source: string;
          browser_profile_path?: string;
        }) => Promise<{ success: boolean; data?: any; error?: string }>;
        update: (
          accountId: string,
          updates: {
            account_name?: string;
            status?: string;
            access_token?: string;
            user_id?: string;
            auto_refresh?: boolean;
            auto_refresh_interval?: number;
          }
        ) => Promise<{ success: boolean; error?: string }>;
        delete: (accountId: string) => Promise<{ success: boolean; error?: string }>;
      };
      browserProfile?: {
        detect: () => Promise<{ success: boolean; data?: string | null; error?: string }>;
        isChromeRunning: () => Promise<{ success: boolean; data?: boolean; error?: string }>;
        loginMain: (siteUrl: string) => Promise<{
          success: boolean;
          data?: {
            userId: number;
            username: string;
            accessToken: string;
            authSource: 'main_profile';
          };
          error?: string;
        }>;
        loginIsolated: (
          siteId: string,
          siteUrl: string,
          accountId: string
        ) => Promise<{
          success: boolean;
          data?: {
            userId: number;
            username: string;
            accessToken: string;
            authSource: 'isolated_profile';
            profilePath: string;
          };
          error?: string;
        }>;
        openSite: (
          siteId: string | undefined,
          siteUrl: string,
          accountId?: string
        ) => Promise<{ success: boolean; message?: string; error?: string }>;
        deleteProfile: (
          siteId: string,
          accountId: string
        ) => Promise<{ success: boolean; error?: string }>;
      };
      route?: {
        getConfig: () => Promise<{ success: boolean; data?: any; error?: string }>;
        saveServerConfig: (updates: any) => Promise<{ success: boolean; error?: string }>;
        listRules: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        upsertRule: (rule: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        deleteRule: (ruleId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        listStats: () => Promise<{ success: boolean; data?: any; error?: string }>;
        resetStats: (ruleId?: string) => Promise<{ success: boolean; error?: string }>;
        getHealth: () => Promise<{ success: boolean; data?: any; error?: string }>;
        runHealthCheck: () => Promise<{ success: boolean; error?: string }>;
        getRuntimeStatus: () => Promise<{ success: boolean; data?: any; error?: string }>;
        startServer: () => Promise<{ success: boolean; error?: string }>;
        stopServer: () => Promise<{ success: boolean; error?: string }>;
        regenerateApiKey: () => Promise<{ success: boolean; data?: any; error?: string }>;
        getModelRegistry: () => Promise<{ success: boolean; data?: any; error?: string }>;
        rebuildModelRegistry: (params?: {
          force?: boolean;
        }) => Promise<{ success: boolean; data?: any; error?: string }>;
        upsertModelMappingOverride: (
          override: any
        ) => Promise<{ success: boolean; data?: any; error?: string }>;
        deleteModelMappingOverride: (
          overrideId: string
        ) => Promise<{ success: boolean; data?: any; error?: string }>;
        saveCliModelSelections: (selections: any) => Promise<{ success: boolean; error?: string }>;
        saveCliProbeConfig: (updates: any) => Promise<{ success: boolean; error?: string }>;
        runCliProbeNow: (params?: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        getCliProbeLatest: (
          params?: any
        ) => Promise<{ success: boolean; data?: any; error?: string }>;
        getCliProbeHistory: (
          params: any
        ) => Promise<{ success: boolean; data?: any; error?: string }>;
        getCliProbeView: (params: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        getAnalyticsSummary: (
          params: any
        ) => Promise<{ success: boolean; data?: any; error?: string }>;
        getAnalyticsDistribution: (
          params: any
        ) => Promise<{ success: boolean; data?: any; error?: string }>;
        resetAnalytics: (params?: any) => Promise<{ success: boolean; error?: string }>;
        fetchLatestLog: (params: {
          siteId: string;
          model?: string;
        }) => Promise<{ success: boolean; data?: any; error?: string }>;
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
  accounts?: AccountCredential[];
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

  const {
    setApiKeys,
    setUserGroups,
    setModelPricing,
    setCliCompatibility,
    detectCliConfig,
    cliConfigDetection,
  } = useDetectionStore();

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

  const visibleActiveTab =
    !LDC_UI_VISIBILITY.showCreditTab && activeTab === 'credit' ? 'sites' : activeTab;

  // 窗口关闭行为对话框状态
  const [showCloseBehaviorDialog, setShowCloseBehaviorDialog] = useState(false);

  // 用于存储初始化状态的 ref
  const initRef = useRef(false);

  // 站点检测 hook
  const { results, setResults, detectSingle } = useSiteDetection({
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

  // 自动刷新（全局级，不随 Tab 切换卸载）
  useAutoRefresh({
    sites: config?.sites || [],
    accounts: config?.accounts || [],
    detectSingle,
    enabled: true,
    onRefresh: (siteName: string) => {
      toast.success(`${siteName} 自动刷新完成`);
    },
    onError: (siteName: string, error: Error) => {
      Logger.error(`[AutoRefresh] ${siteName} 刷新失败:`, error);
    },
  });

  // 跟踪上一次 CLI 检测的 managed 站点名
  const prevManagedSitesRef = useRef<Set<string>>(new Set());

  // CLI 检测变化时，同步自动刷新状态
  useEffect(() => {
    if (!cliConfigDetection) return;

    const currentConfig = useConfigStore.getState().config;
    if (!currentConfig) return;

    const managedSiteNames = new Set<string>();
    Object.values(cliConfigDetection).forEach(result => {
      if (result.sourceType === 'managed' && result.siteName) {
        managedSiteNames.add(result.siteName);
      }
    });

    const prevManaged = prevManagedSitesRef.current;

    let hasChanges = false;
    const newSites = currentConfig.sites.map(site => {
      const isManaged = managedSiteNames.has(site.name);
      const wasManaged = prevManaged.has(site.name);

      if (isManaged && !site.auto_refresh) {
        // 新 managed 或之前被关闭的 managed 站点 → 开启
        hasChanges = true;
        return {
          ...site,
          auto_refresh: true,
          auto_refresh_interval: site.auto_refresh_interval ?? 30,
        };
      }
      if (!isManaged && wasManaged && site.auto_refresh) {
        // 不再 managed 的站点 → 关闭
        hasChanges = true;
        return { ...site, auto_refresh: false };
      }
      return site;
    });

    prevManagedSitesRef.current = managedSiteNames;

    if (hasChanges) {
      const newConfig = { ...currentConfig, sites: newSites };
      setConfig(newConfig);
      window.electronAPI.saveConfig(newConfig).catch(err => {
        Logger.error('保存自动刷新配置失败:', err);
      });
    }
  }, [cliConfigDetection]);

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

  // 路由 store 初始化
  useEffect(() => {
    useRouteStore.getState().fetchConfig();
    useRouteStore.getState().fetchRuntimeStatus();
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

  useEffect(() => {
    if (activeTab !== visibleActiveTab) {
      setActiveTab(visibleActiveTab);
    }
  }, [activeTab, visibleActiveTab, setActiveTab]);

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
      <div className="relative z-10 h-full flex min-w-[1024px]">
        <VerticalSidebar
          activeTab={visibleActiveTab}
          onTabChange={setActiveTab}
          saving={saving}
          updateInfo={updateInfo}
          onDownloadUpdate={handleDownloadUpdate}
        />

        {/* 页面内容区域 - CSS 显隐保活 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 顶栏（拖拽区 + 状态） */}
          <Header
            activeTab={visibleActiveTab}
            onTabChange={setActiveTab}
            saving={saving}
            hasUpdate={updateInfo?.hasUpdate}
            updateInfo={updateInfo}
            onDownloadUpdate={handleDownloadUpdate}
          />

          <div
            className={
              visibleActiveTab === 'sites' ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'
            }
          >
            <SitesPage />
          </div>
          <div
            className={
              visibleActiveTab === 'cli' ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'
            }
          >
            <CustomCliPage />
          </div>
          <div
            className={
              visibleActiveTab === 'redirection' ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'
            }
          >
            <ModelRedirectionTab />
          </div>
          <div
            className={
              visibleActiveTab === 'usability' ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'
            }
          >
            <CliUsabilityTab />
          </div>
          <div
            className={
              visibleActiveTab === 'proxystats' ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'
            }
          >
            <ProxyStatsTab />
          </div>
          {LDC_UI_VISIBILITY.showCreditTab && visibleActiveTab === 'credit' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <CreditPage />
            </div>
          )}
          <div
            className={
              visibleActiveTab === 'settings' ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'
            }
          >
            <SettingsPage />
          </div>
        </div>
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
        content={dialogState.content}
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
