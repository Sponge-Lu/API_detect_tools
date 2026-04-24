import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectionResult, SiteConfig } from '../renderer/App';

const mockSetActiveTab = vi.fn();
const mockSetConfig = vi.fn();
const mockSetLoading = vi.fn();
const mockRemoveToast = vi.fn();

const mockConfig = {
  sites: [],
  settings: {
    timeout: 30,
    concurrent: false,
    show_disabled: true,
  },
} as const;

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

vi.mock('../renderer/utils/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../renderer/hooks', () => ({
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

vi.mock('../renderer/components/ConfirmDialog', () => ({
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

vi.mock('../renderer/components/Header', () => ({
  Header: ({ activeTab }: { activeTab: string }) => <div>Header:{activeTab}</div>,
}));

vi.mock('../renderer/components/Sidebar', () => ({
  VerticalSidebar: ({ activeTab }: { activeTab: string }) => <div>Sidebar:{activeTab}</div>,
}));

vi.mock('../renderer/components/dialogs', () => ({
  AuthErrorDialog: () => null,
  CloseBehaviorDialog: () => null,
  DownloadUpdatePanel: () => null,
}));

vi.mock('../renderer/components/Toast', () => ({
  ToastContainer: () => null,
}));

vi.mock('../renderer/components/AppButton/AppButton', () => ({
  AppButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

vi.mock('../renderer/pages/SitesPage', () => ({
  SitesPage: () => <div>Mock Sites Page</div>,
}));

vi.mock('../renderer/pages/CustomCliPage', () => ({
  CustomCliPage: () => <div>Mock CLI Page</div>,
}));

vi.mock('../renderer/pages/CreditPage', () => ({
  CreditPage: () => <div>Mock Credit Page</div>,
}));

vi.mock('../renderer/pages/LogsPage', () => ({
  LogsPage: () => <div>Mock Logs Page</div>,
}));

vi.mock('../renderer/pages/SettingsPage', () => ({
  SettingsPage: () => <div>Mock Settings Page</div>,
}));

vi.mock('../renderer/components/Route/Usability/CliUsabilityTab', () => ({
  CliUsabilityTab: () => <div>Mock Usability Tab</div>,
}));

vi.mock('../renderer/pages/RoutePage', () => ({
  RoutePage: () => <div>Mock Route Page</div>,
}));

vi.mock('../renderer/store/configStore', () => ({
  useConfigStore: () => ({
    config: mockConfig,
    setConfig: mockSetConfig,
    saving: false,
    loading: false,
    setLoading: mockSetLoading,
  }),
}));

vi.mock('../renderer/store/detectionStore', () => ({
  useDetectionStore: (selector?: (state: typeof detectionState) => unknown) =>
    selector ? selector(detectionState) : detectionState,
}));

vi.mock('../renderer/store/uiStore', () => ({
  useUIStore: () => uiState,
  isRouteTab: (id: string) => ['usability', 'route'].includes(id),
}));

vi.mock('../renderer/store/routeStore', () => ({
  useRouteStore: Object.assign(() => ({}), {
    getState: () => routeStore,
  }),
}));

vi.mock('../renderer/store/toastStore', () => ({
  useToastStore: () => ({
    toasts: [],
    eventHistory: [],
    removeToast: mockRemoveToast,
    clearEventHistory: vi.fn(),
  }),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../renderer/components/CliCompatibilityIcons', () => ({
  CliCompatibilityIcons: () => <div>Mock CLI Compatibility</div>,
}));

import App from '../renderer/App';
import { VerticalSidebar } from '../renderer/components/Sidebar/VerticalSidebar';
import { SiteCardHeader } from '../renderer/components/SiteCard/SiteCardHeader';

describe('LDC UI visibility', () => {
  beforeEach(() => {
    mockSetActiveTab.mockReset();
    mockSetConfig.mockReset();
    mockSetLoading.mockReset();
    mockRemoveToast.mockReset();
    (window as any).electronAPI.loadConfig = vi.fn().mockResolvedValue(mockConfig);
    (window as any).electronAPI.saveConfig = vi.fn().mockResolvedValue(undefined);
  });

  it('shows the LDC credit entry in the sidebar', () => {
    render(<VerticalSidebar activeTab="sites" onTabChange={vi.fn()} saving={false} />);

    expect(screen.getByText('LDC 积分')).toBeInTheDocument();
  });

  it('renders the credit page when the active tab is credit', async () => {
    render(<App />);

    expect(screen.getByText('Mock Credit Page')).toBeInTheDocument();
    expect(mockSetActiveTab).not.toHaveBeenCalledWith('sites');
  });

  it('renders the LDC ratio value in the site header row', () => {
    const site = {
      id: 'site-1',
      name: 'Example Site',
      url: 'https://example.com',
      enabled: true,
    } as SiteConfig;

    const siteResult = {
      status: '成功',
      balance: 10,
      todayUsage: 1,
      ldcPaymentSupported: true,
      ldcExchangeRate: '9.9',
      models: [],
    } as DetectionResult;

    render(
      <SiteCardHeader
        site={site}
        siteResult={siteResult}
        lastSyncDisplay="12:34"
        errorCode={null}
        timeoutSeconds={null}
        columnWidths={[120, 75, 75, 75, 50, 50, 50, 50, 50, 60, 80, 65, 160]}
        todayTotalTokens={0}
        todayPromptTokens={0}
        todayCompletionTokens={0}
        todayRequests={0}
        rpm={0}
        tpm={0}
        modelCount={0}
        accountId={undefined}
        accountName={undefined}
        onOpenSite={vi.fn()}
        cliCompatibility={null}
        cliConfig={null}
        isCliTesting={false}
        onOpenCliConfig={vi.fn()}
        onTestCliCompat={vi.fn()}
        onApply={vi.fn()}
      />
    );

    expect(screen.getByText('9.9')).toBeInTheDocument();
  });

  it('keeps the LDC and CLI column widths when widths are already filtered', () => {
    const site = {
      id: 'site-1',
      name: 'Example Site',
      url: 'https://example.com',
      enabled: true,
    } as SiteConfig;

    const { container } = render(
      <SiteCardHeader
        site={site}
        siteResult={undefined}
        lastSyncDisplay="12:34"
        errorCode={null}
        timeoutSeconds={null}
        columnWidths={[120, 75, 75, 75, 50, 50, 50, 50, 50, 60, 80, 65, 160]}
        todayTotalTokens={0}
        todayPromptTokens={0}
        todayCompletionTokens={0}
        todayRequests={0}
        rpm={0}
        tpm={0}
        modelCount={0}
        accountId={undefined}
        accountName={undefined}
        onOpenSite={vi.fn()}
        cliCompatibility={null}
        cliConfig={null}
        isCliTesting={false}
        onOpenCliConfig={vi.fn()}
        onTestCliCompat={vi.fn()}
        onApply={vi.fn()}
      />
    );

    const grid = container.firstElementChild as HTMLDivElement;
    expect(grid.style.gridTemplateColumns).toBe(
      '120px 75px 75px 75px 50px 50px 50px 50px 50px 60px 80px 65px 160px'
    );
  });
});
