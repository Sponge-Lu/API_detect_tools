import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GlobalCommandBar } from '../renderer/components/AppShell/GlobalCommandBar';
import { PageHeader } from '../renderer/components/AppShell/PageHeader';
import { APP_PAGE_META } from '../renderer/components/AppShell/pageMeta';
import { VerticalSidebar } from '../renderer/components/Sidebar/VerticalSidebar';
import { useUIStore } from '../renderer/store/uiStore';

vi.mock('../renderer/components/CliConfigStatus', () => ({
  CliConfigStatusPanel: ({ layout, showRefresh, showEdit, showReset }: any) => (
    <div data-testid={`cli-status-${layout ?? 'inline'}`}>
      <div>Mock CLI Claude</div>
      <div>Mock CLI Codex</div>
      <div>Mock CLI Gemini</div>
      {showRefresh ? <button type="button">刷新</button> : null}
      {showEdit ? <button type="button">编辑</button> : null}
      {showReset ? <button type="button">重置</button> : null}
    </div>
  ),
}));

describe('app shell redesign', () => {
  it('does not render the global command bar when there is no active top-level status', () => {
    const { container } = render(<GlobalCommandBar saving={false} />);

    expect(screen.queryByTestId('cli-status-inline')).not.toBeInTheDocument();
    expect(container.firstElementChild).toBeNull();
  });

  it('renders the global command bar as compact neutral chrome while saving', () => {
    const { container } = render(<GlobalCommandBar saving={true} />);

    expect(container.firstElementChild).toHaveClass(
      'h-[42px]',
      'border-[var(--line-soft)]',
      'bg-[var(--surface-1)]/90',
      'backdrop-blur-sm'
    );
  });

  it('renders the site page header as a compact row with shared theme typography tokens', () => {
    const { container, queryByText } = render(
      <PageHeader title="站点管理" description="集中维护站点配置、账号、检测结果与日常操作。" />
    );

    expect(container.firstElementChild).toHaveClass(
      'border-[var(--line-soft)]',
      'bg-[var(--surface-1)]/90'
    );
    expect(screen.getByRole('heading', { name: '站点管理' })).toHaveClass(
      'text-[var(--text-primary)]'
    );
    expect(screen.getByText('集中维护站点配置、账号、检测结果与日常操作。')).toHaveClass(
      'text-[var(--text-secondary)]'
    );
    expect(container.querySelector('[data-testid="page-header-row"]')).toHaveClass('min-h-[40px]');
    expect(queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('renders flattened top-level sidebar destinations without a route parent entry', () => {
    useUIStore.setState({ sidebarDisplayMode: 'expanded' } as Partial<
      ReturnType<typeof useUIStore.getState>
    >);
    render(<VerticalSidebar activeTab="sites" onTabChange={vi.fn()} saving={false} />);

    expect(screen.getByRole('button', { name: '站点管理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自定义CLI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '模型重定向' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CLI 可用性' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '代理统计' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '路由' })).not.toBeInTheDocument();
  });

  it('supports manual sidebar mode switching and keeps version/update info in the bottom section', () => {
    useUIStore.setState({ sidebarDisplayMode: 'expanded' } as Partial<
      ReturnType<typeof useUIStore.getState>
    >);

    render(
      <VerticalSidebar
        activeTab="sites"
        onTabChange={vi.fn()}
        saving={false}
        currentVersion="3.0.1"
        updateInfo={{
          hasUpdate: true,
          latestVersion: '3.0.2',
          releaseInfo: {
            version: '3.0.2',
            releaseDate: '2026-04-01',
            releaseNotes: 'notes',
            downloadUrl: 'https://example.com/download',
            htmlUrl: 'https://example.com/release',
            isPreRelease: false,
          },
        }}
      />
    );

    const sidebar = screen.getByTestId('vertical-sidebar');
    const footer = screen.getByTestId('sidebar-footer');

    expect(sidebar).toHaveClass('w-[140px]');
    expect(screen.getByText('API Hub')).toBeInTheDocument();
    expect(within(footer).getByTestId('sidebar-cli-block')).toHaveClass(
      'max-h-[220px]',
      'opacity-100'
    );
    expect(within(footer).getByTestId('cli-status-stacked')).toBeInTheDocument();
    expect(within(footer).getByText('版本 v3.0.1')).toBeInTheDocument();
    expect(within(footer).getByRole('button', { name: '更新 v3.0.2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '切换侧栏显示模式' }));

    expect(sidebar).toHaveClass('w-[68px]');
    expect(screen.queryByText('API Hub')).not.toBeInTheDocument();
    expect(within(footer).getByTestId('sidebar-cli-block')).toHaveClass('max-h-0', 'opacity-0');
    expect(within(footer).getByRole('button', { name: '打开本地 CLI 配置' })).toBeInTheDocument();
    expect(within(footer).getByTestId('sidebar-footer-separator')).toHaveClass(
      'border-t',
      'border-[var(--line-soft)]'
    );
    expect(screen.getByRole('button', { name: '站点管理' })).toBeInTheDocument();
    expect(screen.getByText('站点管理')).toHaveClass('max-w-0', 'opacity-0');
    expect(within(footer).getByRole('button', { name: '更新 v3.0.2' })).toBeInTheDocument();
    expect(useUIStore.getState().sidebarDisplayMode).toBe('icon-only');
    expect(localStorage.getItem('api-hub-ui-storage')).toContain('icon-only');
  });

  it('binds page header metadata and global command bar to the normalized visible tab', async () => {
    vi.resetModules();

    const mockSetActiveTab = vi.fn();
    const mockSetConfig = vi.fn();
    const mockSetLoading = vi.fn();
    const mockRemoveToast = vi.fn();

    const mockConfig = {
      sites: [],
      accounts: [],
      settings: {
        timeout: 30,
        concurrent: false,
        show_disabled: true,
      },
    };

    const detectionState = {
      setApiKeys: vi.fn(),
      setUserGroups: vi.fn(),
      setModelPricing: vi.fn(),
      setCliCompatibility: vi.fn(),
      detectCliConfig: vi.fn(),
      cliConfigDetection: null,
      setCliConfig: vi.fn(),
    };

    const uiState = {
      activeTab: 'credit',
      setActiveTab: mockSetActiveTab,
      dialogState: {
        isOpen: false,
        type: 'confirm',
        title: '',
        message: '',
        content: null,
        confirmText: '确定',
        cancelText: '取消',
        onConfirm: undefined,
        onCancel: undefined,
      },
      setDialogState: vi.fn(),
      authErrorSites: [],
      setAuthErrorSites: vi.fn(),
      showAuthErrorDialog: false,
      setShowAuthErrorDialog: vi.fn(),
      setProcessingAuthErrorSite: vi.fn(),
      setEditingSite: vi.fn(),
      setShowSiteEditor: vi.fn(),
      setSortField: vi.fn(),
      setSortOrder: vi.fn(),
      showDownloadPanel: false,
      downloadPanelRelease: null,
      openDownloadPanel: vi.fn(),
      closeDownloadPanel: vi.fn(),
    };

    const routeStore = {
      fetchConfig: vi.fn(),
      fetchRuntimeStatus: vi.fn(),
    };

    vi.doMock('../renderer/utils/logger', () => ({
      default: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
      },
    }));

    vi.doMock('../renderer/hooks', () => ({
      useTheme: vi.fn(),
      useDataLoader: () => ({
        loadCachedData: vi.fn().mockResolvedValue(undefined),
      }),
      useUpdate: () => ({
        updateInfo: {
          hasUpdate: true,
          latestVersion: '3.0.2',
          releaseInfo: {
            version: '3.0.2',
            releaseDate: '2026-04-01',
            releaseNotes: 'notes',
            downloadUrl: 'https://example.com/download',
            htmlUrl: 'https://example.com/release',
            isPreRelease: false,
          },
        },
        settings: { autoCheckEnabled: false },
        checkForUpdatesInBackground: vi.fn(),
        currentVersion: '3.0.1',
        downloadProgress: null,
        downloadPhase: 'idle',
        downloadError: null,
        startDownload: vi.fn(),
        cancelDownload: vi.fn(),
        installUpdate: vi.fn(),
      }),
      useSiteDetection: () => ({
        results: [],
        setResults: vi.fn(),
        detectSingle: vi.fn(),
      }),
      useAutoRefresh: vi.fn(),
    }));

    vi.doMock('../renderer/components/ConfirmDialog', () => ({
      ConfirmDialog: () => null,
      initialDialogState: {
        isOpen: false,
        type: 'confirm',
        title: '',
        message: '',
        content: null,
        confirmText: '确定',
        cancelText: '取消',
        onConfirm: undefined,
        onCancel: undefined,
      },
    }));

    vi.doMock('../renderer/components/dialogs', () => ({
      AuthErrorDialog: () => null,
      CloseBehaviorDialog: () => null,
      DownloadUpdatePanel: () => null,
    }));

    vi.doMock('../renderer/components/Toast', () => ({
      ToastContainer: () => null,
    }));

    vi.doMock('../renderer/components/AppButton/AppButton', () => ({
      AppButton: ({
        children,
        ...props
      }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
        <button {...props}>{children}</button>
      ),
    }));

    vi.doMock('../renderer/components/CliConfigStatus', () => ({
      CliConfigStatusPanel: ({ layout, showRefresh, showEdit, showReset }: any) => (
        <div data-testid={`cli-status-${layout ?? 'inline'}`}>
          <div>Mock CLI Claude</div>
          <div>Mock CLI Codex</div>
          <div>Mock CLI Gemini</div>
          {showRefresh ? <button type="button">刷新</button> : null}
          {showEdit ? <button type="button">编辑</button> : null}
          {showReset ? <button type="button">重置</button> : null}
        </div>
      ),
    }));

    vi.doMock('../renderer/pages/SitesPage', () => ({
      SitesPage: () => <div>Mock Sites Page</div>,
    }));

    vi.doMock('../renderer/pages/CustomCliPage', () => ({
      CustomCliPage: () => <div>Mock CLI Page</div>,
    }));

    vi.doMock('../renderer/pages/SettingsPage', () => ({
      SettingsPage: () => <div>Mock Settings Page</div>,
    }));

    vi.doMock('../renderer/components/Route/Redirection/ModelRedirectionTab', () => ({
      ModelRedirectionTab: () => <div>Mock Redirection Tab</div>,
    }));

    vi.doMock('../renderer/components/Route/Usability/CliUsabilityTab', () => ({
      CliUsabilityTab: () => <div>Mock Usability Tab</div>,
    }));

    vi.doMock('../renderer/components/Route/ProxyStats/ProxyStatsTab', () => ({
      ProxyStatsTab: () => <div>Mock Proxy Stats Tab</div>,
    }));

    vi.doMock('../renderer/store/configStore', () => ({
      useConfigStore: () => ({
        config: mockConfig,
        setConfig: mockSetConfig,
        saving: false,
        loading: false,
        setLoading: mockSetLoading,
      }),
    }));

    vi.doMock('../renderer/store/detectionStore', () => ({
      useDetectionStore: (selector?: (state: typeof detectionState) => unknown) =>
        selector ? selector(detectionState) : detectionState,
    }));

    vi.doMock('../renderer/store/uiStore', async () => {
      const actual = await vi.importActual('../renderer/store/uiStore');
      return {
        ...actual,
        useUIStore: () => uiState,
      };
    });

    vi.doMock('../renderer/store/routeStore', () => ({
      useRouteStore: Object.assign(() => ({}), {
        getState: () => routeStore,
      }),
    }));

    vi.doMock('../renderer/store/toastStore', () => ({
      useToastStore: () => ({
        toasts: [],
        removeToast: mockRemoveToast,
      }),
      toast: {
        success: vi.fn(),
        error: vi.fn(),
      },
    }));

    if (window.electronAPI) {
      window.electronAPI.loadConfig = vi.fn().mockResolvedValue(mockConfig);
      window.electronAPI.saveConfig = vi.fn().mockResolvedValue(undefined);
    }

    const { default: App } = await import('../renderer/App');

    const { container } = render(<App />);

    expect(screen.queryByTestId('cli-status-inline')).not.toBeInTheDocument();
    expect(screen.getByTestId('cli-status-stacked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更新 v3.0.2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: APP_PAGE_META.sites.title })).toBeInTheDocument();
    expect(screen.getByText(APP_PAGE_META.sites.description)).toBeInTheDocument();
    expect(screen.getByText('Mock Sites Page')).toBeInTheDocument();
    expect(container.querySelector('.app-responsive-container')).not.toBeNull();
    expect(container.querySelector('.ios-responsive-container')).toBeNull();

    await waitFor(() => {
      expect(mockSetActiveTab).toHaveBeenCalledWith('sites');
    });
  });

  it('surfaces add and restore actions in the shared sites page header', async () => {
    vi.resetModules();

    const mockSetConfig = vi.fn();
    const mockSetLoading = vi.fn();
    const mockRemoveToast = vi.fn();

    const mockConfig = {
      sites: [],
      accounts: [],
      settings: {
        timeout: 30,
        concurrent: false,
        show_disabled: true,
      },
    };

    const detectionState = {
      setApiKeys: vi.fn(),
      setUserGroups: vi.fn(),
      setModelPricing: vi.fn(),
      setCliCompatibility: vi.fn(),
      detectCliConfig: vi.fn(),
      cliConfigDetection: null,
      setCliConfig: vi.fn(),
    };

    const uiState = {
      activeTab: 'sites',
      setActiveTab: vi.fn(),
      dialogState: {
        isOpen: false,
        type: 'confirm',
        title: '',
        message: '',
        content: null,
        confirmText: '确定',
        cancelText: '取消',
        onConfirm: undefined,
        onCancel: undefined,
      },
      setDialogState: vi.fn(),
      authErrorSites: [],
      setAuthErrorSites: vi.fn(),
      showAuthErrorDialog: false,
      setShowAuthErrorDialog: vi.fn(),
      setProcessingAuthErrorSite: vi.fn(),
      setEditingSite: vi.fn(),
      setShowSiteEditor: vi.fn(),
      setSortField: vi.fn(),
      setSortOrder: vi.fn(),
      showDownloadPanel: false,
      downloadPanelRelease: null,
      openDownloadPanel: vi.fn(),
      closeDownloadPanel: vi.fn(),
    };

    const routeStore = {
      fetchConfig: vi.fn(),
      fetchRuntimeStatus: vi.fn(),
    };

    vi.doMock('../renderer/utils/logger', () => ({
      default: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
      },
    }));

    vi.doMock('../renderer/hooks', () => ({
      useTheme: vi.fn(),
      useDataLoader: () => ({
        loadCachedData: vi.fn().mockResolvedValue(undefined),
      }),
      useUpdate: () => ({
        updateInfo: null,
        settings: { autoCheckEnabled: false },
        checkForUpdatesInBackground: vi.fn(),
        currentVersion: '3.0.1',
        downloadProgress: null,
        downloadPhase: 'idle',
        downloadError: null,
        startDownload: vi.fn(),
        cancelDownload: vi.fn(),
        installUpdate: vi.fn(),
      }),
      useSiteDetection: () => ({
        results: [],
        setResults: vi.fn(),
        detectSingle: vi.fn(),
      }),
      useAutoRefresh: vi.fn(),
    }));

    vi.doMock('../renderer/components/ConfirmDialog', () => ({
      ConfirmDialog: () => null,
      initialDialogState: {
        isOpen: false,
        type: 'confirm',
        title: '',
        message: '',
        content: null,
        confirmText: '确定',
        cancelText: '取消',
        onConfirm: undefined,
        onCancel: undefined,
      },
    }));

    vi.doMock('../renderer/components/dialogs', () => ({
      AuthErrorDialog: () => null,
      CloseBehaviorDialog: () => null,
      DownloadUpdatePanel: () => null,
    }));

    vi.doMock('../renderer/components/Toast', () => ({
      ToastContainer: () => null,
    }));

    vi.doMock('../renderer/components/AppButton/AppButton', () => ({
      AppButton: ({
        children,
        ...props
      }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
        <button {...props}>{children}</button>
      ),
    }));

    vi.doMock('../renderer/components/CliConfigStatus', () => ({
      CliConfigStatusPanel: ({ layout, showRefresh, showEdit, showReset }: any) => (
        <div data-testid={`cli-status-${layout ?? 'inline'}`}>
          <div>Mock CLI Claude</div>
          <div>Mock CLI Codex</div>
          <div>Mock CLI Gemini</div>
          {showRefresh ? <button type="button">刷新</button> : null}
          {showEdit ? <button type="button">编辑</button> : null}
          {showReset ? <button type="button">重置</button> : null}
        </div>
      ),
    }));

    vi.doMock('../renderer/pages/SitesPage', () => {
      const React = require('react');
      return {
        SitesPage: ({
          setPageHeaderActions,
        }: {
          setPageHeaderActions?: (actions: React.ReactNode | null) => void;
        }) => {
          React.useEffect(() => {
            setPageHeaderActions?.(
              <>
                <button type="button">添加站点</button>
                <button type="button">恢复站点</button>
              </>
            );

            return () => setPageHeaderActions?.(null);
          }, [setPageHeaderActions]);

          return <div>Mock Sites Page</div>;
        },
      };
    });

    vi.doMock('../renderer/pages/CustomCliPage', () => ({
      CustomCliPage: () => <div>Mock CLI Page</div>,
    }));

    vi.doMock('../renderer/pages/SettingsPage', () => ({
      SettingsPage: () => <div>Mock Settings Page</div>,
    }));

    vi.doMock('../renderer/components/Route/Redirection/ModelRedirectionTab', () => ({
      ModelRedirectionTab: () => <div>Mock Redirection Tab</div>,
    }));

    vi.doMock('../renderer/components/Route/Usability/CliUsabilityTab', () => ({
      CliUsabilityTab: () => <div>Mock Usability Tab</div>,
    }));

    vi.doMock('../renderer/components/Route/ProxyStats/ProxyStatsTab', () => ({
      ProxyStatsTab: () => <div>Mock Proxy Stats Tab</div>,
    }));

    vi.doMock('../renderer/store/configStore', () => ({
      useConfigStore: () => ({
        config: mockConfig,
        setConfig: mockSetConfig,
        saving: false,
        loading: false,
        setLoading: mockSetLoading,
      }),
    }));

    vi.doMock('../renderer/store/detectionStore', () => ({
      useDetectionStore: (selector?: (state: typeof detectionState) => unknown) =>
        selector ? selector(detectionState) : detectionState,
    }));

    vi.doMock('../renderer/store/uiStore', async () => {
      const actual = await vi.importActual('../renderer/store/uiStore');
      return {
        ...actual,
        useUIStore: () => uiState,
      };
    });

    vi.doMock('../renderer/store/routeStore', () => ({
      useRouteStore: Object.assign(() => ({}), {
        getState: () => routeStore,
      }),
    }));

    vi.doMock('../renderer/store/toastStore', () => ({
      useToastStore: () => ({
        toasts: [],
        removeToast: mockRemoveToast,
      }),
      toast: {
        success: vi.fn(),
        error: vi.fn(),
      },
    }));

    if (window.electronAPI) {
      window.electronAPI.loadConfig = vi.fn().mockResolvedValue(mockConfig);
      window.electronAPI.saveConfig = vi.fn().mockResolvedValue(undefined);
    }

    const { default: App } = await import('../renderer/App');

    render(<App />);

    expect(await screen.findByRole('button', { name: '添加站点' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复站点' })).toBeInTheDocument();
  });

  it('renders the shared page header for route tabs', async () => {
    vi.resetModules();

    const mockSetConfig = vi.fn();
    const mockSetLoading = vi.fn();

    const mockConfig = {
      sites: [],
      accounts: [],
      settings: {
        timeout: 30,
        concurrent: false,
        show_disabled: true,
      },
    };

    const detectionState = {
      setApiKeys: vi.fn(),
      setUserGroups: vi.fn(),
      setModelPricing: vi.fn(),
      setCliCompatibility: vi.fn(),
      detectCliConfig: vi.fn(),
      cliConfigDetection: null,
      setCliConfig: vi.fn(),
    };

    vi.doMock('../renderer/utils/logger', () => ({
      default: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
      },
    }));

    vi.doMock('../renderer/hooks', () => ({
      useTheme: vi.fn(),
      useDataLoader: () => ({
        loadCachedData: vi.fn().mockResolvedValue(undefined),
      }),
      useUpdate: () => ({
        updateInfo: null,
        settings: { autoCheckEnabled: false },
        checkForUpdatesInBackground: vi.fn(),
        currentVersion: '3.0.1',
        downloadProgress: null,
        downloadPhase: 'idle',
        downloadError: null,
        startDownload: vi.fn(),
        cancelDownload: vi.fn(),
        installUpdate: vi.fn(),
      }),
      useSiteDetection: () => ({
        results: [],
        setResults: vi.fn(),
        detectSingle: vi.fn(),
      }),
      useAutoRefresh: vi.fn(),
    }));

    vi.doMock('../renderer/components/ConfirmDialog', () => ({
      ConfirmDialog: () => null,
      initialDialogState: {
        isOpen: false,
        type: 'confirm',
        title: '',
        message: '',
        content: null,
        confirmText: '确定',
        cancelText: '取消',
        onConfirm: undefined,
        onCancel: undefined,
      },
    }));

    vi.doMock('../renderer/components/dialogs', () => ({
      AuthErrorDialog: () => null,
      CloseBehaviorDialog: () => null,
      DownloadUpdatePanel: () => null,
    }));

    vi.doMock('../renderer/components/Toast', () => ({
      ToastContainer: () => null,
    }));

    vi.doMock('../renderer/components/AppButton/AppButton', () => ({
      AppButton: ({
        children,
        ...props
      }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
        <button {...props}>{children}</button>
      ),
    }));

    vi.doMock('../renderer/components/CliConfigStatus', () => ({
      CliConfigStatusPanel: ({ layout, showRefresh, showEdit, showReset }: any) => (
        <div data-testid={`cli-status-${layout ?? 'inline'}`}>
          <div>Mock CLI Claude</div>
          <div>Mock CLI Codex</div>
          <div>Mock CLI Gemini</div>
          {showRefresh ? <button type="button">刷新</button> : null}
          {showEdit ? <button type="button">编辑</button> : null}
          {showReset ? <button type="button">重置</button> : null}
        </div>
      ),
    }));

    vi.doMock('../renderer/pages/SitesPage', () => ({
      SitesPage: () => <div>Mock Sites Page</div>,
    }));

    vi.doMock('../renderer/pages/CustomCliPage', () => ({
      CustomCliPage: () => <div>Mock CLI Page</div>,
    }));

    vi.doMock('../renderer/pages/SettingsPage', () => ({
      SettingsPage: () => <div>Mock Settings Page</div>,
    }));

    vi.doMock('../renderer/components/Route/Redirection/ModelRedirectionTab', () => ({
      ModelRedirectionTab: () => <div>Mock Redirection Tab</div>,
    }));

    vi.doMock('../renderer/components/Route/Usability/CliUsabilityTab', () => ({
      CliUsabilityTab: () => <div>Mock Usability Tab</div>,
    }));

    vi.doMock('../renderer/components/Route/ProxyStats/ProxyStatsTab', () => ({
      ProxyStatsTab: () => <div>Mock Proxy Stats Tab</div>,
    }));

    vi.doMock('../renderer/store/configStore', () => ({
      useConfigStore: () => ({
        config: mockConfig,
        setConfig: mockSetConfig,
        saving: false,
        loading: false,
        setLoading: mockSetLoading,
      }),
    }));

    vi.doMock('../renderer/store/detectionStore', () => ({
      useDetectionStore: (selector?: (state: typeof detectionState) => unknown) =>
        selector ? selector(detectionState) : detectionState,
    }));

    vi.doMock('../renderer/store/uiStore', async () => {
      const actual = await vi.importActual('../renderer/store/uiStore');
      return {
        ...actual,
        useUIStore: () => ({
          activeTab: 'redirection',
          setActiveTab: vi.fn(),
          dialogState: {
            isOpen: false,
            type: 'confirm',
            title: '',
            message: '',
            content: null,
            confirmText: '确定',
            cancelText: '取消',
            onConfirm: undefined,
            onCancel: undefined,
          },
          setDialogState: vi.fn(),
          authErrorSites: [],
          setAuthErrorSites: vi.fn(),
          showAuthErrorDialog: false,
          setShowAuthErrorDialog: vi.fn(),
          setProcessingAuthErrorSite: vi.fn(),
          setEditingSite: vi.fn(),
          setShowSiteEditor: vi.fn(),
          setSortField: vi.fn(),
          setSortOrder: vi.fn(),
          showDownloadPanel: false,
          downloadPanelRelease: null,
          openDownloadPanel: vi.fn(),
          closeDownloadPanel: vi.fn(),
        }),
      };
    });

    vi.doMock('../renderer/store/routeStore', () => ({
      useRouteStore: Object.assign(() => ({}), {
        getState: () => ({
          fetchConfig: vi.fn(),
          fetchRuntimeStatus: vi.fn(),
        }),
      }),
    }));

    vi.doMock('../renderer/store/toastStore', () => ({
      useToastStore: () => ({
        toasts: [],
        removeToast: vi.fn(),
      }),
      toast: {
        success: vi.fn(),
        error: vi.fn(),
      },
    }));

    if (window.electronAPI) {
      window.electronAPI.loadConfig = vi.fn().mockResolvedValue(mockConfig);
      window.electronAPI.saveConfig = vi.fn().mockResolvedValue(undefined);
    }

    const { default: App } = await import('../renderer/App');

    render(<App />);

    expect(screen.getByText('Mock Redirection Tab')).toBeInTheDocument();
    expect(screen.queryByText('保存中...')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: APP_PAGE_META.redirection.title })
    ).toBeInTheDocument();
    expect(screen.getByText(APP_PAGE_META.redirection.description)).toBeInTheDocument();
  });

  it('renders SettingsPanel detection and sync inputs through the neutral AppInput primitives', async () => {
    vi.resetModules();

    vi.doMock('../renderer/hooks/useTheme', () => ({
      useTheme: () => ({
        themeMode: 'light-b',
        changeThemeMode: vi.fn(),
      }),
    }));

    vi.doMock('../renderer/hooks/useUpdate', () => ({
      useUpdate: () => ({
        currentVersion: '3.0.1',
        updateInfo: null,
        isChecking: false,
        error: null,
        settings: { autoCheckEnabled: false },
        checkForUpdates: vi.fn(),
        updateSettings: vi.fn(),
      }),
    }));

    vi.doMock('../renderer/store/toastStore', () => ({
      toast: {
        success: vi.fn(),
        error: vi.fn(),
      },
    }));

    vi.doMock('../renderer/store/uiStore', () => ({
      useUIStore: () => ({
        openDownloadPanel: vi.fn(),
      }),
    }));

    vi.doMock('../renderer/components/dialogs', () => ({
      WebDAVBackupDialog: () => null,
    }));

    const electronAPI = ((window as any).electronAPI ??= {}) as Record<string, unknown> as any;
    electronAPI.webdav = {
      ...electronAPI.webdav,
      getConfig: vi.fn().mockResolvedValue({
        success: true,
        data: {
          enabled: true,
          serverUrl: 'https://dav.example.com',
          username: 'user@example.com',
          password: 'secret',
          remotePath: '/api-hub-backups',
          maxBackups: 10,
        },
      }),
    };
    electronAPI.closeBehavior = {
      ...electronAPI.closeBehavior,
      getSettings: vi.fn().mockResolvedValue({
        success: true,
        data: { behavior: 'ask' },
      }),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };

    const { SettingsPanel } = await import('../renderer/components/SettingsPanel');

    render(
      <SettingsPanel
        settings={
          {
            timeout: 30,
            concurrent: false,
            show_disabled: true,
            browser_path: '',
          } as any
        }
        onSave={vi.fn()}
        onCancel={vi.fn()}
        config={
          {
            sites: [],
            siteGroups: [],
            settings: {
              timeout: 30,
              concurrent: false,
              show_disabled: true,
              browser_path: '',
            },
          } as any
        }
        asPage={true}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '检测设置' }));

    const timeoutInput = screen.getByLabelText('请求超时时间 (秒)');
    expect(timeoutInput).toHaveClass(
      'bg-[var(--surface-2)]',
      'border-[var(--line-soft)]',
      'text-[var(--text-primary)]'
    );

    fireEvent.click(screen.getByRole('button', { name: '云端备份' }));

    const serverInput = await screen.findByLabelText('服务器地址');
    expect(serverInput).toHaveClass(
      'bg-[var(--surface-2)]',
      'border-[var(--line-soft)]',
      'text-[var(--text-primary)]'
    );
    expect(screen.getByRole('button', { name: '显示密码' })).toBeInTheDocument();
  });
});
