import { useManagedAutoRefresh } from './hooks/useManagedAutoRefresh';

import { useApplicationData } from './hooks/useApplicationData';

export type { Config, Settings, SiteGroup } from '../shared/types/renderer-config';
/**
 * 输入: Hooks (useTheme, useUpdate, useDataLoader), Store (configStore, uiStore, toastStore), Pages (SitesPage, SettingsPage)
 * 输出: React 组件树, UI 状态管理, IPC 事件处理
 * 定位: 展示层 - 根组件，管理主布局、初始化和全局弹窗
 */

import { useEffect, useMemo, useState, lazy, Suspense, type ReactNode } from 'react';
import { XCircle, Loader2 } from 'lucide-react';
import { ConfirmDialog, initialDialogState } from './components/ConfirmDialog';
import { PageHeader } from './components/AppShell/PageHeader';
import { APP_PAGE_META } from './components/AppShell/pageMeta';
import { VerticalSidebar } from './components/Sidebar';
import { AuthErrorDialog, CloseBehaviorDialog, DownloadUpdatePanel } from './components/dialogs';
import { ToastContainer } from './components/Toast';
import { AppButton } from './components/AppButton/AppButton';
import { Skeleton } from './components/Skeleton';
import { useTheme, useDataLoader, useUpdate, useSiteDetection } from './hooks';
// 从共享的types文件导入并重新导出类型

export type { SiteConfig, DetectionResult } from '../shared/types/site';

// 导入页面组件（懒加载）
const SitesPage = lazy(() => import('./pages/SitesPage').then(m => ({ default: m.SitesPage })));
const DataOverviewPage = lazy(() =>
  import('./pages/DataOverviewPage').then(m => ({ default: m.DataOverviewPage }))
);
const LogsPage = lazy(() => import('./pages/LogsPage').then(m => ({ default: m.LogsPage })));
const RoutePage = lazy(() => import('./pages/RoutePage').then(m => ({ default: m.RoutePage })));
const RouteSettingsPage = lazy(() =>
  import('./pages/RouteSettingsPage').then(m => ({ default: m.RouteSettingsPage }))
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage }))
);

// 导入 Zustand Store
import { useConfigStore } from './store/configStore';
import { useDetectionStore } from './store/detectionStore';
import { useUIStore } from './store/uiStore';
import type { VisibleTabId } from './store/uiStore';
import { useRouteStore } from './store/routeStore';
import { useToastStore, toast } from './store/toastStore';

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
  const { config, saving, loading } = useConfigStore();

  const { setApiKeys, setUserGroups, setModelPricing, detectCliConfig } = useDetectionStore();

  const {
    activeTab,
    overviewSubtab,
    setActiveTab,
    setOverviewSubtab,
    dialogState,
    setDialogState,
    authErrorSites,
    addAuthErrorSite,
    setAuthErrorSites,
    showAuthErrorDialog,
    setShowAuthErrorDialog,
    setProcessingAuthErrorSite,
    setEditingSite,
    setShowSiteEditor,
    showDownloadPanel,
    downloadPanelRelease,
    openDownloadPanel,
    closeDownloadPanel,
  } = useUIStore();

  const rawActiveTab = activeTab as string;
  // 兼容旧版本持久化的标签页 id（redirection/proxystats → route, model-mapping → config-files, credit → sites）
  const visibleActiveTab: VisibleTabId =
    rawActiveTab === 'redirection' || rawActiveTab === 'proxystats'
      ? 'route'
      : rawActiveTab === 'model-mapping'
        ? 'config-files'
        : rawActiveTab === 'credit'
          ? 'sites'
          : (rawActiveTab as VisibleTabId);

  // 窗口关闭行为对话框状态
  const [showCloseBehaviorDialog, setShowCloseBehaviorDialog] = useState(false);
  const [overviewPageHeaderActions, setOverviewPageHeaderActions] = useState<ReactNode | null>(
    null
  );
  const [sitesPageHeaderActions, setSitesPageHeaderActions] = useState<ReactNode | null>(null);
  const [routeSettingsPageHeaderActions, setRouteSettingsPageHeaderActions] =
    useState<ReactNode | null>(null);
  const [logsPageHeaderActions, setLogsPageHeaderActions] = useState<ReactNode | null>(null);

  // 用于存储初始化状态的 ref

  // 站点检测 hook
  const { results, setResults, detectSingle } = useSiteDetection({
    onAuthError: sites => {
      for (const site of sites) {
        addAuthErrorSite(site);
      }
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
    setCliConfig,
    detectCliConfig,
  });

  useManagedAutoRefresh(detectSingle);

  // 启动时自动检查更新
  useEffect(() => {
    if (updateSettings.autoCheckEnabled) {
      const timer = setTimeout(() => {
        checkForUpdatesInBackground();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [updateSettings.autoCheckEnabled, checkForUpdatesInBackground]);

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

  const { loadConfig } = useApplicationData(loadCachedData);

  const handleDownloadUpdate = async () => {
    if (updateInfo?.releaseInfo) {
      openDownloadPanel(updateInfo.releaseInfo);
    }
  };

  const activeOverviewSubtab = overviewSubtab ?? 'site';
  const pageMeta = useMemo(() => APP_PAGE_META[visibleActiveTab], [visibleActiveTab]);

  if (loading) {
    return (
      <div className="relative flex h-screen items-center justify-center bg-[var(--app-bg)]">
        <div className="light-bg-decoration dark:dark-bg-decoration"></div>
        <div className="relative z-10 text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-[var(--accent)]" />
          <p className="text-[var(--text-secondary)]">加载配置中...</p>
        </div>
      </div>
    );
  }

  const pageHeaderActions =
    visibleActiveTab === 'overview'
      ? overviewPageHeaderActions
      : visibleActiveTab === 'sites'
        ? sitesPageHeaderActions
        : visibleActiveTab === 'config-files'
          ? routeSettingsPageHeaderActions
          : visibleActiveTab === 'logs'
            ? logsPageHeaderActions
            : null;

  if (!config) {
    return (
      <div className="relative flex h-screen items-center justify-center bg-[var(--app-bg)]">
        <div className="light-bg-decoration dark:dark-bg-decoration"></div>
        <div className="relative z-10 text-center">
          <XCircle className="mx-auto mb-4 h-16 w-16 text-[var(--danger)]" />
          <p className="mb-4 text-[var(--text-primary)]">配置加载失败</p>
          <AppButton
            variant="primary"
            onClick={() => {
              void loadConfig();
            }}
          >
            重试
          </AppButton>
        </div>
      </div>
    );
  }

  return (
    <div className="app-responsive-container relative flex h-screen flex-col overflow-x-auto overflow-y-hidden bg-[var(--app-bg)] text-[var(--text-primary)]">
      {/* 装饰背景 */}
      <div className="light-bg-decoration dark:dark-bg-decoration"></div>

      {/* 主要内容 */}
      <div className="relative z-10 h-full flex min-w-[1024px]">
        <VerticalSidebar
          activeTab={visibleActiveTab}
          overviewSubtab={activeOverviewSubtab}
          onTabChange={setActiveTab}
          onOverviewSubtabChange={setOverviewSubtab}
          saving={saving}
          currentVersion={currentVersion}
          updateInfo={updateInfo}
          onDownloadUpdate={handleDownloadUpdate}
        />

        {/* 页面内容区域 - CSS 显隐保活 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <PageHeader
            title={pageMeta.title}
            description={pageMeta.description}
            actions={pageHeaderActions}
            saving={saving}
          />

          <Suspense
            fallback={
              /* 首屏用骨架而非大转圈：与列表加载态保持同一套语言 */
              <div className="flex flex-1 flex-col gap-2 overflow-hidden bg-[var(--app-bg)] px-5 py-4">
                <Skeleton className="h-7 w-40" />
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-12 w-full" />
                ))}
              </div>
            }
          >
            <div
              className={
                visibleActiveTab === 'overview' ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'
              }
            >
              <DataOverviewPage setPageHeaderActions={setOverviewPageHeaderActions} />
            </div>
            <div
              className={
                visibleActiveTab === 'sites' ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'
              }
            >
              <SitesPage setPageHeaderActions={setSitesPageHeaderActions} />
            </div>
            <div
              className={
                visibleActiveTab === 'route' ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'
              }
            >
              <RoutePage />
            </div>
            <div
              className={
                visibleActiveTab === 'config-files'
                  ? 'flex-1 flex flex-col overflow-hidden'
                  : 'hidden'
              }
            >
              <RouteSettingsPage setPageHeaderActions={setRouteSettingsPageHeaderActions} />
            </div>
            <div
              className={
                visibleActiveTab === 'logs' ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'
              }
            >
              <LogsPage setPageHeaderActions={setLogsPageHeaderActions} />
            </div>

            <div
              className={
                visibleActiveTab === 'settings' ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'
              }
            >
              <SettingsPage />
            </div>
          </Suspense>
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
          onForceRefresh={async (siteIndex, siteName, accountId) => {
            const site = config.sites[siteIndex];
            if (!site) return;

            const remaining = authErrorSites.filter(s => {
              if (s.name !== siteName) return true;
              if (!accountId) return false;
              return s.accountId !== accountId;
            });
            setAuthErrorSites(remaining);

            if (remaining.length === 0) {
              setShowAuthErrorDialog(false);
            }

            try {
              const timeout = config.settings?.timeout ?? 30;
              // 透传 accountId：主进程使用该账户凭证检测（并支持 token 失效自动补发重试）
              const result = await window.electronAPI.detectSite(
                site,
                timeout,
                false,
                undefined,
                true,
                accountId
              );

              const normalized = accountId ? { ...result, accountId } : result;
              const filtered = results.filter(r =>
                accountId
                  ? !(r.name === site.name && r.accountId === accountId)
                  : r.name !== site.name
              );
              setResults([...filtered, normalized]);

              const existingResult = results.find(
                r => r.name === siteName && (accountId ? r.accountId === accountId : true)
              );
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
