import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GlobalCommandBar } from '../renderer/components/AppShell/GlobalCommandBar';
import { PageHeader } from '../renderer/components/AppShell/PageHeader';
import { APP_PAGE_META } from '../renderer/components/AppShell/pageMeta';
import { VerticalSidebar } from '../renderer/components/Sidebar/VerticalSidebar';

vi.mock('../renderer/components/CliConfigStatus', () => ({
  CliConfigStatusPanel: () => <div>Mock CLI Status</div>,
}));

describe('app shell redesign', () => {
  it('renders the global command bar as compact neutral chrome', () => {
    const { container } = render(<GlobalCommandBar saving={false} />);

    expect(screen.getByText('Mock CLI Status')).toBeInTheDocument();
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
    render(<VerticalSidebar activeTab="sites" onTabChange={vi.fn()} saving={false} />);

    expect(screen.getByRole('button', { name: '站点管理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自定义CLI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '模型重定向' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CLI 可用性' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '代理统计' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '路由' })).not.toBeInTheDocument();
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

    vi.doMock('../renderer/components/IOSButton', () => ({
      IOSButton: () => {
        throw new Error('legacy IOSButton import should not be used in app shell');
      },
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
      CliConfigStatusPanel: () => <div>Mock CLI Status</div>,
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

    render(<App />);

    expect(screen.getByText('Mock CLI Status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载新版本 v3.0.2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: APP_PAGE_META.sites.title })).toBeInTheDocument();
    expect(screen.getByText(APP_PAGE_META.sites.description)).toBeInTheDocument();
    expect(screen.getByText('Mock Sites Page')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockSetActiveTab).toHaveBeenCalledWith('sites');
    });
  });

  it('does not render a global page header for non-site tabs', async () => {
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

    vi.doMock('../renderer/components/IOSButton', () => ({
      IOSButton: () => {
        throw new Error('legacy IOSButton import should not be used in app shell');
      },
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
      CliConfigStatusPanel: () => <div>Mock CLI Status</div>,
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
          activeTab: 'cli',
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

    expect(screen.getByText('Mock CLI Page')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: APP_PAGE_META.cli.title })).not.toBeInTheDocument();
    expect(screen.queryByText(APP_PAGE_META.cli.description)).not.toBeInTheDocument();
  });

  it('keeps SettingsPanel on neutral surface tokens and neutral input primitives', () => {
    const settingsPanelSource = readFileSync(
      join(process.cwd(), 'src/renderer/components/SettingsPanel.tsx'),
      'utf8'
    );

    expect(settingsPanelSource).not.toContain('bg-white');
    expect(settingsPanelSource).not.toContain('dark:bg-dark-card');
    expect(settingsPanelSource).not.toContain('border-light-border');
    expect(settingsPanelSource).not.toContain('text-light-text');
    expect(settingsPanelSource).toContain("import { AppInput } from './IOSInput';");
    expect(settingsPanelSource).not.toContain('import { IOSInput } from \'./IOSInput\'');
  });
});
