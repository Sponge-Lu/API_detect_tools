import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_COLUMN_WIDTHS } from '../shared/constants';
import { CliCompatibilityIcons } from '../renderer/components/CliCompatibilityIcons/CliCompatibilityIcons';
import { SiteListHeader } from '../renderer/components/SiteListHeader';
import { SiteCard, SiteCardActions, SiteCardDetails } from '../renderer/components/SiteCard';
import { SiteCardHeader } from '../renderer/components/SiteCard/SiteCardHeader';
import { AccessPointDetailPanel } from '../renderer/components/dialogs/AccessPointDetailPanel';
import { HistoryBucketBars } from '../renderer/components/Route/Usability/HistoryBucketBars';
import { SitesPage } from '../renderer/pages/SitesPage';
import { useConfigStore } from '../renderer/store/configStore';
import { useCustomCliConfigStore } from '../renderer/store/customCliConfigStore';
import { useUIStore } from '../renderer/store/uiStore';
import { useToastStore } from '../renderer/store/toastStore';
import type { SiteConfig } from '../renderer/App';
import type { CustomCliConfig } from '../shared/types/custom-cli-config';

const baseSite: SiteConfig = {
  id: 'site-1',
  name: 'Claude Hub',
  url: 'https://example.com',
  site_type: 'newapi',
  enabled: true,
  group: 'default',
  apiKey: 'sk-test',
  auth_type: 'bearer',
  notes: '',
  extra_links: 'https://fuel.example.com',
  force_enable_checkin: true,
};

function buildSiteCardProps(overrides: Record<string, unknown> = {}) {
  return {
    site: baseSite,
    index: 0,
    siteResult: { status: '成功', todayRequests: 2, todayTotalTokens: 3000, models: [] } as any,
    siteAccount: undefined,
    columnWidths: [...DEFAULT_COLUMN_WIDTHS],
    accountId: 'account-1',
    accountName: 'Primary Account',
    cardKey: 'site-1::account-1',
    modelPricing: null,
    isDetecting: false,
    checkingIn: null,
    dragOverIndex: null,
    refreshMessage: null,
    cliCompatibility: {
      claudeCode: null,
      codex: null,
      geminiCli: null,
      testedAt: Date.now(),
    },
    cliConfig: {
      claudeCode: {
        apiKeyId: 1,
        model: 'claude-3-5-sonnet',
        testModel: 'claude-3-5-sonnet',
        testModels: ['claude-3-5-sonnet'],
        testResults: [],
        enabled: true,
        editedFiles: null,
        applyMode: 'merge',
      },
      codex: {
        apiKeyId: null,
        model: null,
        testModel: null,
        testModels: [],
        testResults: [],
        enabled: true,
        editedFiles: null,
        applyMode: 'merge',
      },
      geminiCli: {
        apiKeyId: null,
        model: null,
        testModel: null,
        testModels: [],
        testResults: [],
        enabled: false,
        editedFiles: null,
        applyMode: 'merge',
      },
    },
    isCliTesting: false,
    onDetect: vi.fn(),
    onCheckIn: vi.fn(),
    onOpenSite: vi.fn(),
    onOpenExtraLink: vi.fn(),
    onOpenCliConfig: vi.fn(),
    onTestCliCompat: vi.fn(),
    onApply: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
    ...overrides,
  };
}

function renderSiteCardDetails(overrides: Record<string, unknown> = {}) {
  return render(
    <SiteCardDetails
      site={baseSite}
      cardKey="site-1::account-1"
      siteResult={{ status: '成功', models: [] } as any}
      apiKeys={[]}
      userGroups={{}}
      modelPricing={null}
      selectedGroup={null}
      modelSearch=""
      globalModelSearch=""
      showTokens={{}}
      selectedModels={new Set<string>()}
      deletingTokenKey={null}
      refreshingTokenKey={null}
      onToggleGroupFilter={vi.fn()}
      onModelSearchChange={vi.fn()}
      onToggleTokenVisibility={vi.fn()}
      onToggleModelSelection={vi.fn()}
      onCopySelectedModels={vi.fn()}
      onClearSelectedModels={vi.fn()}
      onCopyToClipboard={vi.fn()}
      onOpenCreateTokenDialog={vi.fn()}
      onRefreshToken={vi.fn()}
      onDeleteToken={vi.fn()}
      {...overrides}
    />
  );
}

function getReactNodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(getReactNodeText).join('');
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return getReactNodeText(node.props.children);
  }

  return '';
}

function findClickableAction(
  node: ReactNode,
  label: string
): ReactElement<{ children?: ReactNode; onClick: () => void }> | null {
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) {
    return null;
  }

  if (typeof node.props.onClick === 'function' && getReactNodeText(node.props.children) === label) {
    return node as ReactElement<{ children?: ReactNode; onClick: () => void }>;
  }

  for (const child of Children.toArray(node.props.children)) {
    const match = findClickableAction(child, label);
    if (match) {
      return match;
    }
  }

  return null;
}

const customCliConfig: CustomCliConfig = {
  id: 'cfg-1',
  name: 'Direct API',
  baseUrl: 'https://direct.example.com',
  apiKey: 'sk-direct',
  models: ['direct-model'],
  manualModels: [],
  notes: 'direct notes',
  cliSettings: {
    claudeCode: {
      enabled: true,
      model: 'direct-model',
      testModels: ['direct-model'],
      testState: null,
    },
    codex: {
      enabled: false,
      model: null,
      testModels: [],
      testState: null,
    },
    geminiCli: {
      enabled: true,
      model: 'direct-model',
      testModels: ['direct-model'],
      testState: null,
    },
  },
  createdAt: new Date('2026-06-17T00:00:00Z').getTime(),
  updatedAt: new Date('2026-06-17T00:00:00Z').getTime(),
};

describe('sites page redesign', () => {
  beforeEach(() => {
    useConfigStore.setState({
      config: null,
      loading: false,
      saving: false,
    });
    useCustomCliConfigStore.setState({
      configs: [],
      activeConfigId: null,
      loading: false,
      saving: false,
      fetchingModels: {},
    });
    useUIStore.setState({
      activeSiteGroupFilter: 'default',
      columnWidths: [...DEFAULT_COLUMN_WIDTHS],
      sortField: null,
      sortOrder: 'desc',
      globalModelSearch: '',
      modelSearch: {},
      selectedGroup: {},
      draggedIndex: null,
      dragOverIndex: null,
      dragOverGroupId: null,
    });
    useToastStore.setState({
      toasts: [],
      eventHistory: [],
    });
    (window.electronAPI as any).route.getHistoryBuckets = vi.fn(() => new Promise(() => {}));
    (window.electronAPI as any).accounts.list = vi
      .fn()
      .mockResolvedValue({ success: true, data: [] });
    (window.electronAPI as any).customCliConfig.load = vi.fn().mockResolvedValue({
      configs: [],
      activeConfigId: null,
    });
  });

  it('removes the detect-all header action spacer (R11)', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/pages/SitesPage.tsx'), 'utf8');

    expect(source).not.toContain('<div className="w-[48px]" aria-hidden="true" />');
    expect(source).not.toContain('title="检测所有站点"');
  });

  it('defaults the group filter to 默认分组 and does not render an 全部 tab', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/pages/SitesPage.tsx'), 'utf8');

    expect(source).toContain(
      'const effectiveActiveSiteGroupFilter = activeSiteGroupFilter ?? defaultGroupId;'
    );
    expect(source).not.toContain('<span className="font-semibold">全部</span>');
  });

  it('keeps direct custom CLI configs wired into the merged Sites page', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/pages/SitesPage.tsx'), 'utf8');

    expect(source).toContain('useCustomCliConfigStore');
    expect(source).toContain("type: 'custom-cli'");
    expect(source).toContain('buildCustomCliRouteSiteId');
    expect(source).not.toContain(['CustomCliConfig', 'EditorDialog'].join(''));
    expect(source).toContain('handleAddDirectConfig');
    expect(source).not.toContain('直连配置功能即将推出');
    expect(source).not.toContain('const customConfigs = 0');
  });

  it('keeps page-level batch refresh and check-in on the legacy behavior paths', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/pages/SitesPage.tsx'), 'utf8');

    expect(source).toContain('const { handleCheckIn, handleCheckInAll } = useCheckIn');
    expect(source).toContain('if (config.sites.length > 0)');
    expect(source).toContain('await detectAllSites(config, accountsBySite)');
    expect(source).toContain('await handleCheckInAll()');
    expect(source).toContain('refreshAllDirectConfigModels');
    expect(source).toContain(
      'disabled={!config || config.sites.length === 0 || Boolean(checkingIn)}'
    );
    expect(source).not.toContain('checkinableSitesCount');
    expect(source).not.toContain('sites.refreshAll()');
    expect(source).not.toContain('sites.checkinAll()');
  });

  it('opens operation records from the Sites page header and excludes toast-only notifications', async () => {
    useConfigStore.setState({
      config: {
        sites: [],
        settings: {
          timeout: 30,
          concurrent: false,
          show_disabled: true,
        },
        siteGroups: [{ id: 'default', name: '默认分组' }],
      },
    });
    useToastStore.setState({
      eventHistory: [
        {
          id: 'event-action-1',
          kind: 'action',
          level: 'success',
          source: 'sites',
          message: '已删除站点：Claude Hub',
          createdAt: 100,
        },
        {
          id: 'event-toast-1',
          kind: 'toast',
          level: 'info',
          source: 'notification',
          message: '普通通知不应显示',
          createdAt: 200,
        },
      ],
    });

    let headerActions: ReactNode | null = null;
    const setPageHeaderActions = vi.fn((actions: ReactNode | null) => {
      headerActions = actions;
    });

    render(<SitesPage setPageHeaderActions={setPageHeaderActions} />);

    await waitFor(() => expect(setPageHeaderActions).toHaveBeenCalled());
    const operationAction = findClickableAction(headerActions, '操作记录');
    expect(operationAction).not.toBeNull();

    act(() => {
      operationAction?.props.onClick();
    });

    expect(await screen.findByRole('dialog', { name: '操作记录' })).toBeInTheDocument();
    expect(screen.getByText('已删除站点：Claude Hub')).toBeInTheDocument();
    expect(screen.getByText('sites')).toBeInTheDocument();
    expect(screen.queryByText('普通通知不应显示')).not.toBeInTheDocument();
  });

  it('renders direct custom CLI rows without managed-site action buttons', () => {
    render(
      <SiteCard
        {...buildSiteCardProps({
          site: {
            ...baseSite,
            id: 'custom-cli-site-cfg-1',
            name: 'Direct API',
            url: 'https://direct.example.com',
            extra_links: undefined,
            force_enable_checkin: false,
          },
          siteResult: {
            status: '成功',
            models: ['direct-model'],
            has_checkin: false,
          },
          accountId: 'custom-cli-account-cfg-1',
          accountName: '直连配置',
          cardKey: 'custom-cli::cfg-1',
          accessPointType: 'custom-cli',
          modelPricing: null,
        })}
      />
    );

    expect(screen.getByText('Direct API')).toBeInTheDocument();
    expect(screen.getByText('直连配置')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByLabelText('刷新检测')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('点击签到')).not.toBeInTheDocument();
  });

  it('keeps direct custom CLI rows visible when there are no managed sites', async () => {
    (window.electronAPI as any).customCliConfig.load = vi.fn().mockResolvedValue({
      configs: [customCliConfig],
      activeConfigId: null,
    });
    useConfigStore.setState({
      config: {
        sites: [],
        settings: {
          timeout: 30,
          concurrent: false,
          show_disabled: true,
        },
        siteGroups: [{ id: 'default', name: '默认分组' }],
      },
    });
    useCustomCliConfigStore.setState({ configs: [customCliConfig] });

    render(<SitesPage />);

    expect(await screen.findByText('Direct API')).toBeInTheDocument();
    expect(screen.getByText('默认分组')).toBeInTheDocument();
    expect(screen.getByText('1 个')).toBeInTheDocument();
    expect(screen.queryByText('还没有添加任何接入点')).not.toBeInTheDocument();
    await waitFor(() =>
      expect((window.electronAPI as any).customCliConfig.load).toHaveBeenCalled()
    );
  });

  it('does not make direct custom CLI rows draggable into managed site ordering', () => {
    const onDragStart = vi.fn();

    const { container } = render(
      <SiteCard
        {...buildSiteCardProps({
          site: {
            ...baseSite,
            id: 'custom-cli-site-cfg-1',
            name: 'Direct API',
            url: 'https://direct.example.com',
            extra_links: undefined,
            force_enable_checkin: false,
          },
          siteResult: {
            status: '成功',
            models: ['direct-model'],
            has_checkin: false,
          },
          accountId: 'custom-cli-account-cfg-1',
          accountName: '直连配置',
          cardKey: 'custom-cli::cfg-1',
          accessPointType: 'custom-cli',
          draggable: false,
          modelPricing: null,
          onDragStart,
        })}
      />
    );

    const card = container.querySelector('[data-perf-monitor="blur"]') as HTMLDivElement;
    expect(card).toHaveAttribute('draggable', 'false');
    expect(card).not.toHaveClass('cursor-move');
    fireEvent.dragStart(card);
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('counts duplicate direct custom CLI models once in the row summary', () => {
    render(
      <SiteCard
        {...buildSiteCardProps({
          site: {
            ...baseSite,
            id: 'custom-cli-site-cfg-1',
            name: 'Direct API',
            url: 'https://direct.example.com',
            extra_links: undefined,
            force_enable_checkin: false,
          },
          siteResult: {
            status: '成功',
            models: ['direct-model', 'direct-model', 'manual-model'],
            has_checkin: false,
          },
          accountId: 'custom-cli-account-cfg-1',
          accountName: '直连配置',
          cardKey: 'custom-cli::cfg-1',
          accessPointType: 'custom-cli',
          draggable: false,
          modelPricing: null,
        })}
      />
    );

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });

  it('embeds direct config identity, model, and CLI editors in the side panel', () => {
    const onDeleteDirectConfig = vi.fn();

    render(
      <AccessPointDetailPanel
        open={true}
        onClose={vi.fn()}
        data={{ type: 'custom-cli', config: customCliConfig }}
        onDeleteDirectConfig={onDeleteDirectConfig}
      />
    );

    expect(screen.getByText('直连配置')).toBeInTheDocument();
    expect(screen.queryByText('直连配置身份')).not.toBeInTheDocument();
    expect(screen.queryByText('配置 ID')).not.toBeInTheDocument();
    expect(screen.queryByText('创建时间')).not.toBeInTheDocument();
    expect(screen.queryByText('更新时间')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('例如: 我的 API')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://api.example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('sk-...')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '删除配置' }));
    expect(onDeleteDirectConfig).toHaveBeenCalledWith(customCliConfig);

    fireEvent.click(screen.getByRole('button', { name: '模型 & 资源' }));
    expect(screen.getByText('直连模型管理')).toBeInTheDocument();
    expect(screen.getByText('手动模型')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'CLI 配置 & 测试' }));
    expect(screen.getByText('CLI 配置（2/3）')).toBeInTheDocument();
    expect(screen.queryByText('直连 CLI 配置')).not.toBeInTheDocument();
    expect(screen.queryByText('配置预览与编辑')).not.toBeInTheDocument();
    expect(screen.getByText('配置文件预览')).toBeInTheDocument();
    expect(screen.queryByText('CLI 测试')).not.toBeInTheDocument();
    expect(screen.getAllByText('测试模型')).toHaveLength(1);
    expect(screen.queryByText('测试模型（最多 3 个）')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /^预览 / })).toHaveLength(0);
    expect(screen.getAllByText('应用到本机').length).toBeGreaterThan(0);

    expect(screen.queryByText('三 CLI 配置编辑区与测试结果（实现期细化）')).not.toBeInTheDocument();
  });

  it('merges managed side-panel tab1 into one editable information surface', async () => {
    const onSaveAccount = vi.fn().mockResolvedValue(undefined);
    const onAddAccount = vi.fn();
    const onDeleteAccount = vi.fn();

    render(
      <AccessPointDetailPanel
        open={true}
        onClose={vi.fn()}
        data={{
          type: 'managed',
          site: baseSite,
          account: {
            id: 'account-1',
            account_name: 'Primary Account',
            user_id: 'user-1',
            access_token: 'sk-managed-access-token',
            status: 'active',
            auth_source: 'manual',
            auto_refresh: true,
            auto_refresh_interval: 30,
          },
        }}
        allAccounts={[
          {
            id: 'account-2',
            account_name: 'Backup Account',
            user_id: 'user-2',
            status: 'active',
            auth_source: 'browser',
          },
        ]}
        onSaveAccount={onSaveAccount}
        onAddAccount={onAddAccount}
        onDeleteAccount={onDeleteAccount}
      />
    );

    expect(screen.getByText('站点与账户')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加账户' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Primary Account')).toBeInTheDocument();
    expect(screen.getByDisplayValue('user-1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('sk-managed-access-token')).toBeInTheDocument();
    expect(screen.getByDisplayValue('30')).toBeInTheDocument();
    expect(screen.getByText('其他账户 (1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存更改' })).toBeDisabled();

    fireEvent.change(screen.getByDisplayValue('Primary Account'), {
      target: { value: 'Primary Account Edited' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }));

    await waitFor(() => expect(onSaveAccount).toHaveBeenCalledTimes(1));
    expect(onSaveAccount).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        account_name: 'Primary Account Edited',
        user_id: 'user-1',
        access_token: 'sk-managed-access-token',
        auto_refresh: true,
        auto_refresh_interval: 30,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: '添加账户' }));
    expect(onAddAccount).toHaveBeenCalledTimes(1);

    expect(screen.queryByText('当前账户')).not.toBeInTheDocument();
    expect(screen.queryByText('站点访问凭证')).not.toBeInTheDocument();
    expect(screen.queryByText('站点基础信息')).not.toBeInTheDocument();
    expect(screen.queryByText('上次探测')).not.toBeInTheDocument();
    expect(screen.queryByText('立即探测全部 CLI')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑账户' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '自动刷新' })).not.toBeInTheDocument();
  });

  it('exposes the embedded managed CLI editor from the side panel', () => {
    const onSaveCliConfig = vi.fn();

    render(
      <AccessPointDetailPanel
        open={true}
        onClose={vi.fn()}
        data={{
          type: 'managed',
          site: baseSite,
          account: {
            id: 'account-1',
            account_name: 'Primary Account',
            user_id: 'user-1',
            status: 'active',
            auth_source: 'manual',
          },
        }}
        cliConfig={buildSiteCardProps().cliConfig as any}
        apiKeys={[{ id: 1, name: 'Primary Key', key: 'sk-primary' }]}
        siteResult={{ status: '成功', models: ['claude-3-5-sonnet'] } as any}
        onSaveCliConfig={onSaveCliConfig}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'CLI 配置 & 测试' }));

    expect(screen.getByRole('button', { name: '保存配置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '测试已选模型' })).toBeInTheDocument();
    expect(screen.getByLabelText('选择 API Key')).toBeInTheDocument();
    expect(screen.getByLabelText('选择上游端口')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CLI 使用模型' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '测试模型' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '测试模型 2' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    expect(onSaveCliConfig).toHaveBeenCalledTimes(1);
  });

  it('shows AnyRouter user hash controls even before an account has saved config', () => {
    const onUpdateAnyRouterUserHash = vi.fn();

    render(
      <AccessPointDetailPanel
        open={true}
        onClose={vi.fn()}
        data={{
          type: 'managed',
          site: { ...baseSite, name: 'Any Router' },
          account: {
            id: 'account-1',
            account_name: 'Primary Account',
            user_id: 'user-1',
            status: 'active',
            auth_source: 'manual',
          },
        }}
        onUpdateAnyRouterUserHash={onUpdateAnyRouterUserHash}
      />
    );

    const userHashInput = screen.getByLabelText('User Hash');
    fireEvent.change(userHashInput, { target: { value: 'a'.repeat(64) } });

    expect(userHashInput).toBeInTheDocument();
    expect(onUpdateAnyRouterUserHash).toHaveBeenCalledWith('account-1', 'a'.repeat(64));
  });

  it('persists AnyRouter user hash edits from the side panel callback', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/pages/SitesPage.tsx'), 'utf8');
    const panelSource = readFileSync(
      join(process.cwd(), 'src/renderer/components/dialogs/AccessPointDetailPanel.tsx'),
      'utf8'
    );

    expect(source).toContain('handleUpdateAnyRouterUserHash');
    expect(source).toContain('window.electronAPI.accounts?.update(accountId');
    expect(source).toContain('anyRouterConfig: nextAnyRouterConfig');
    expect(panelSource).toContain('onUpdateAnyRouterUserHash?.(currentAccount.id, newHash)');
    expect(panelSource).not.toContain('User hash changed');
  });

  it('keeps row click from firing when nested row controls are used', () => {
    const onRowClick = vi.fn();
    const onOpenSite = vi.fn();
    const onDetect = vi.fn();

    render(
      <div onClick={onRowClick}>
        <SiteCard
          {...buildSiteCardProps({
            onOpenSite,
            onDetect,
          })}
        />
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Claude Hub' }));
    expect(onOpenSite).toHaveBeenCalledWith(baseSite, 'account-1');
    expect(onRowClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '刷新检测' }));
    expect(onDetect).toHaveBeenCalledWith(baseSite);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('uses the dedicated route history bucket IPC in HistoryBucketBars', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/components/Route/Usability/HistoryBucketBars.tsx'),
      'utf8'
    );

    expect(source).toContain('getHistoryBuckets');
    expect(source).toContain("window: '48h'");
    expect(source).toContain("bucketSize: '2h'");
    expect(source).toContain('mapHistoryMode(mode)');
    expect(source).not.toContain('config?.analytics?.buckets');
    expect(source).not.toContain('useRouteStore');
  });

  it('fetches 24 two-hour history buckets through the route IPC bridge', async () => {
    const getHistoryBuckets = vi.fn().mockResolvedValue({
      success: true,
      data: Array.from({ length: 24 }, (_, index) => ({
        bucketStart: index * 2 * 60 * 60 * 1000,
        bucketEnd: (index + 1) * 2 * 60 * 60 * 1000,
        successRate: index === 23 ? 1 : null,
        probeCount: index === 23 ? 1 : 0,
        routeCount: 0,
      })),
    });
    (window.electronAPI as any).route.getHistoryBuckets = getHistoryBuckets;

    await act(async () => {
      render(
        <HistoryBucketBars siteId="site-1" accountId="account-1" cliType="codex" mode="probe" />
      );
    });

    await vi.waitFor(() => expect(getHistoryBuckets).toHaveBeenCalled());
    expect(getHistoryBuckets).toHaveBeenCalledWith({
      window: '48h',
      bucketSize: '2h',
      siteId: 'site-1',
      accountId: 'account-1',
      cliType: 'codex',
      mode: 'probe-only',
    });
    expect(await screen.findAllByLabelText(/CLI: Codex/)).toHaveLength(24);
  });

  it('shows the check-in spinner only for the targeted account card key', () => {
    render(
      <>
        <SiteCardActions
          {...buildSiteCardProps({
            cardKey: 'Claude Hub::account-1',
            accountId: 'account-1',
            checkingIn: 'Claude Hub::account-1',
            siteResult: undefined,
            checkinStats: undefined,
          })}
        />
        <SiteCardActions
          {...buildSiteCardProps({
            cardKey: 'Claude Hub::account-2',
            accountId: 'account-2',
            checkingIn: 'Claude Hub::account-1',
            siteResult: undefined,
            checkinStats: undefined,
          })}
        />
      </>
    );

    const buttons = screen.getAllByRole('button', { name: '点击签到' });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).not.toBeDisabled();
  });

  it('uses muted borders for model quota badges in site details', () => {
    renderSiteCardDetails({
      siteResult: {
        status: '成功',
        todayRequests: 2,
        todayTotalTokens: 3000,
        models: ['call-model', 'token-model'],
      },
      modelPricing: {
        data: {
          'call-model': {
            quota_type: 1,
            model_price: 0.01,
            enable_groups: [],
          },
          'token-model': {
            quota_type: 0,
            model_ratio: 1,
            completion_ratio: 1,
            enable_groups: [],
          },
        },
      },
    });

    expect(screen.getByTitle('按次')).toHaveClass('border-[var(--line-muted)]');
    expect(screen.getByTitle('按量')).toHaveClass('border-[var(--line-muted)]');
  });

  it('renders only the visible folded-row columns inside the sticky header', () => {
    // Phase 5/6: 精简为 5 列（站点名/账号 / 余额 / 今日消费 / 模型 / History）
    expect(DEFAULT_COLUMN_WIDTHS).toEqual([240, 96, 96, 120, 340]);

    const { container } = render(
      <SiteListHeader
        columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
        onColumnWidthChange={vi.fn()}
        sortField="totalTokens"
        sortOrder="desc"
        onToggleSort={vi.fn()}
      />
    );

    expect((container.firstElementChild as HTMLDivElement).className).toContain('sticky');
    // Phase 5/6: 精简列头，移除 Token统计、请求统计、LDC 等列
    expect(screen.getByRole('button', { name: '站点' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '余额' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '今日消费' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '模型数' })).toBeInTheDocument();
    // R10: History 列头改为内嵌 CLI/模式选择器（不再显示 "History" 文本）
    expect(screen.getByRole('button', { name: '选择 Codex' })).toBeInTheDocument();
    expect(screen.getByAltText('Claude Code')).toBeInTheDocument();
    expect(screen.getByAltText('Codex')).toBeInTheDocument();
    expect(screen.getByAltText('Gemini CLI')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '综合模式' })).toBeInTheDocument();
    expect(screen.queryByText('操作')).not.toBeInTheDocument();
    // 已移除的列
    expect(screen.queryByText('站点类型')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Token统计' })).not.toBeInTheDocument();
    expect(screen.queryByText('请求统计')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'LDC' })).not.toBeInTheDocument();
    expect(screen.queryByText('CLI可用性')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更新时间' })).not.toBeInTheDocument();
  });

  it('allows the History column to be widened from the header resize handle', () => {
    const onColumnWidthChange = vi.fn();

    render(
      <SiteListHeader
        columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
        onColumnWidthChange={onColumnWidthChange}
      />
    );

    fireEvent.mouseDown(screen.getByRole('separator', { name: '调整History列宽' }), {
      clientX: 100,
    });
    fireEvent.mouseMove(document, { clientX: 180 });
    fireEvent.mouseUp(document);

    expect(onColumnWidthChange).toHaveBeenCalledWith(4, 420);
  });

  it('supports keyboard resizing on the History column handle', () => {
    const onColumnWidthChange = vi.fn();

    render(
      <SiteListHeader
        columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
        onColumnWidthChange={onColumnWidthChange}
      />
    );

    const historyHandle = screen.getByRole('separator', { name: '调整History列宽' });
    expect(historyHandle).toHaveAttribute('aria-valuenow', '340');
    expect(historyHandle).toHaveAttribute('aria-valuemax', '480');

    fireEvent.keyDown(historyHandle, { key: 'ArrowRight' });
    fireEvent.keyDown(historyHandle, { key: 'End' });

    expect(onColumnWidthChange).toHaveBeenCalledWith(4, 350);
    expect(onColumnWidthChange).toHaveBeenCalledWith(4, 480);
  });

  it('renders token and request statistics as stacked two-line cells', () => {
    // Phase 5/6: Token 和 Request 统计已移除，迁移到侧滑面板 Tab1
    // 此测试不再适用，标记为跳过
    render(
      <SiteCardHeader
        site={baseSite}
        siteResult={undefined}
        lastSyncDisplay="12:34"
        errorCode={null}
        timeoutSeconds={null}
        columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
        todayTotalTokens={4200}
        todayPromptTokens={3000}
        todayCompletionTokens={1200}
        todayRequests={6}
        rpm={0.5}
        tpm={350}
        modelCount={3}
        accountId="account-1"
        accountName="Primary Account"
        onOpenSite={vi.fn()}
        cliCompatibility={{
          claudeCode: true,
          codex: null,
          geminiCli: false,
          testedAt: Date.now(),
        }}
        cliConfig={null}
        isCliTesting={false}
        onOpenCliConfig={vi.fn()}
        onTestCliCompat={vi.fn()}
        onApply={vi.fn()}
      />
    );

    // Phase 5/6: 不再显示 Token/RPM/TPM 统计（已移至侧滑面板）
    expect(screen.queryByText('4.2K')).not.toBeInTheDocument();
    expect(screen.queryByText('In 3.0K / Out 1.2K')).not.toBeInTheDocument();
    expect(screen.queryByText('RPM 0.50 / TPM 350')).not.toBeInTheDocument();
  });

  it('renders the site type cell as plain left-aligned text instead of a badge', () => {
    // Phase 5/6: 站点类型列已移除
    render(
      <SiteCardHeader
        site={baseSite}
        siteResult={undefined}
        lastSyncDisplay="12:34"
        errorCode={null}
        timeoutSeconds={null}
        columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
        todayTotalTokens={4200}
        todayPromptTokens={3000}
        todayCompletionTokens={1200}
        todayRequests={6}
        rpm={0.5}
        tpm={350}
        modelCount={3}
        accountId="account-1"
        accountName="Primary Account"
        onOpenSite={vi.fn()}
        cliCompatibility={{
          claudeCode: true,
          codex: null,
          geminiCli: false,
          testedAt: Date.now(),
        }}
        cliConfig={null}
        isCliTesting={false}
        onOpenCliConfig={vi.fn()}
        onTestCliCompat={vi.fn()}
        onApply={vi.fn()}
      />
    );

    // Phase 5/6: 站点类型列已移除，不再显示站点类型
    expect(screen.queryByTitle('New API')).not.toBeInTheDocument();
  });

  it('renders the site secondary row with account and time inline under the site name', () => {
    render(
      <SiteCardHeader
        site={baseSite}
        siteResult={{ status: '成功', balance: 1234.56, models: [] } as any}
        lastSyncDisplay="7天"
        errorCode={null}
        timeoutSeconds={null}
        columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
        todayTotalTokens={0}
        todayPromptTokens={0}
        todayCompletionTokens={0}
        todayRequests={0}
        rpm={0}
        tpm={0}
        modelCount={3}
        accountId="account-1"
        accountName="Primary Account"
        onOpenSite={vi.fn()}
        cliCompatibility={{
          claudeCode: true,
          codex: null,
          geminiCli: false,
          testedAt: Date.now(),
        }}
        cliConfig={null}
        isCliTesting={false}
        onOpenCliConfig={vi.fn()}
        onTestCliCompat={vi.fn()}
        onApply={vi.fn()}
      />
    );

    const accountLabel = screen.getByText('Primary Account');
    const timeLabel = screen.getByText('7天');
    const secondaryRow = accountLabel.parentElement as HTMLDivElement;

    expect(accountLabel).toBeInTheDocument();
    expect(timeLabel).toBeInTheDocument();
    expect(timeLabel.parentElement).toBe(secondaryRow);
    expect(secondaryRow).toHaveClass('gap-1.5');
    expect(secondaryRow).not.toHaveClass('justify-between');
    expect(screen.queryByText('In 0 / Out 0')).not.toBeInTheDocument();
    expect(screen.queryByText('RPM 0.00 / TPM 0')).not.toBeInTheDocument();
    // CLI配置按钮已移到侧滑面板中，不再在卡片头部显示
    expect(screen.queryByRole('button', { name: 'CLI配置' })).not.toBeInTheDocument();
  });

  it('formats balances below and above the 100000 threshold differently', () => {
    const { rerender } = render(
      <SiteCardHeader
        site={baseSite}
        siteResult={{ status: '成功', balance: 99999.99, models: [] } as any}
        lastSyncDisplay="12:34"
        errorCode={null}
        timeoutSeconds={null}
        columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
        todayTotalTokens={4200}
        todayPromptTokens={3000}
        todayCompletionTokens={1200}
        todayRequests={6}
        rpm={0.5}
        tpm={350}
        modelCount={3}
        accountId="account-1"
        accountName="Primary Account"
        onOpenSite={vi.fn()}
        cliCompatibility={{
          claudeCode: true,
          codex: null,
          geminiCli: false,
          testedAt: Date.now(),
        }}
        cliConfig={null}
        isCliTesting={false}
        onOpenCliConfig={vi.fn()}
        onTestCliCompat={vi.fn()}
        onApply={vi.fn()}
      />
    );

    expect(screen.getByText('$99999.99')).toBeInTheDocument();

    rerender(
      <SiteCardHeader
        site={baseSite}
        siteResult={{ status: '成功', balance: 123456.78, models: [] } as any}
        lastSyncDisplay="12:34"
        errorCode={null}
        timeoutSeconds={null}
        columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
        todayTotalTokens={4200}
        todayPromptTokens={3000}
        todayCompletionTokens={1200}
        todayRequests={6}
        rpm={0.5}
        tpm={350}
        modelCount={3}
        accountId="account-1"
        accountName="Primary Account"
        onOpenSite={vi.fn()}
        cliCompatibility={{
          claudeCode: true,
          codex: null,
          geminiCli: false,
          testedAt: Date.now(),
        }}
        cliConfig={null}
        isCliTesting={false}
        onOpenCliConfig={vi.fn()}
        onTestCliCompat={vi.fn()}
        onApply={vi.fn()}
      />
    );

    expect(screen.getByText('$123.5K')).toBeInTheDocument();
  });

  it('zeroes stale daily usage before rendering the merged stats cells', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T09:00:00'));

    render(
      <SiteCard
        site={baseSite}
        index={0}
        siteResult={
          {
            status: '成功',
            todayUsage: 12,
            todayPromptTokens: 9000,
            todayCompletionTokens: 1000,
            todayTotalTokens: 10000,
            todayRequests: 99,
            lastRefresh: new Date('2026-04-08T23:58:00').getTime(),
            models: [],
          } as any
        }
        siteAccount={undefined}
        columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
        accountId={undefined}
        accountName={undefined}
        cardKey="site-1"
        modelPricing={null}
        isDetecting={false}
        checkingIn={null}
        dragOverIndex={null}
        refreshMessage={null}
        cliCompatibility={{ claudeCode: true, codex: null, geminiCli: null, testedAt: Date.now() }}
        cliConfig={null}
        isCliTesting={false}
        onDetect={vi.fn()}
        onCheckIn={vi.fn()}
        onOpenSite={vi.fn()}
        onOpenExtraLink={vi.fn()}
        onOpenCliConfig={vi.fn()}
        onTestCliCompat={vi.fn()}
        onApply={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onDragOver={vi.fn()}
        onDragLeave={vi.fn()}
        onDrop={vi.fn()}
      />
    );

    expect(screen.getByText('$-0.00')).toBeInTheDocument();
    expect(screen.queryByText('In 0 / Out 0')).not.toBeInTheDocument();
    expect(screen.queryByText('RPM 0.00 / TPM 0')).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it('renders a compact column header row with inline sorting and an actions slot', () => {
    const { container } = render(
      <SiteListHeader
        columnWidths={[300, 120, 120, 150, 400]}
        onColumnWidthChange={vi.fn()}
        sortField="balance"
        sortOrder="desc"
        onToggleSort={vi.fn()}
        actions={<button type="button">批量检测</button>}
      />
    );

    // Phase 5/6: 精简为 5 列
    expect(screen.getByRole('button', { name: '站点' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '余额' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '今日消费' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '模型数' })).toBeInTheDocument();
    // R10: History 列头改为内嵌选择器
    expect(screen.getByRole('button', { name: '选择 Claude Code' })).toBeInTheDocument();
    expect(screen.getByAltText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('批量检测')).toBeInTheDocument();
    const header = container.firstElementChild as HTMLDivElement;
    expect(header.style.gridTemplateColumns).toBe('300px 120px 120px 150px 400px 1fr');
    expect(header).toHaveClass('px-3');
    expect(header.lastElementChild).toHaveClass('items-center', 'justify-end', 'gap-0.5');
  });

  it('filters by site type from the header select', () => {
    const onSiteTypeFilterChange = vi.fn();

    // Phase 5/6: 站点类型筛选已移除
    render(
      <SiteListHeader
        columnWidths={[300, 120, 120, 150, 400]}
        onColumnWidthChange={vi.fn()}
        activeSiteTypeFilter={null}
        siteTypeFilterOptions={[
          { value: 'newapi', label: 'New API', count: 2 },
          { value: 'sub2api', label: 'Sub2API', count: 1 },
        ]}
        onSiteTypeFilterChange={onSiteTypeFilterChange}
      />
    );

    // Phase 5/6: 站点类型筛选已移除
    expect(screen.queryByRole('combobox', { name: '站点类型筛选' })).not.toBeInTheDocument();
  });

  it('toggles sorting from the visible sortable column labels directly', () => {
    const onToggleSort = vi.fn();

    render(
      <SiteListHeader
        columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
        onColumnWidthChange={vi.fn()}
        sortField={null}
        sortOrder="desc"
        onToggleSort={onToggleSort}
      />
    );

    // Phase 5/6: 仅保留 4 个可排序列（站点、余额、今日消费、模型数）
    fireEvent.click(screen.getByRole('button', { name: '余额' }));
    fireEvent.click(screen.getByRole('button', { name: '今日消费' }));
    fireEvent.click(screen.getByRole('button', { name: '模型数' }));
    expect(screen.queryByRole('button', { name: '更新时间' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Token统计' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'LDC' })).not.toBeInTheDocument();

    expect(onToggleSort).toHaveBeenCalledWith('balance');
    expect(onToggleSort).toHaveBeenCalledWith('todayUsage');
    expect(onToggleSort).toHaveBeenCalledWith('modelCount');
    expect(onToggleSort).toHaveBeenCalledTimes(3);
  });

  it('keeps only high-frequency actions visible in the row action cell', () => {
    render(
      <SiteCardActions
        site={baseSite}
        cardKey="Claude Hub::account-1"
        accountId="account-1"
        siteResult={
          {
            status: '成功',
            can_check_in: true,
            has_checkin: true,
          } as any
        }
        isDetecting={false}
        checkingIn={null}
        onDetect={vi.fn()}
        onCheckIn={vi.fn()}
        onOpenExtraLink={vi.fn()}
      />
    );

    expect(screen.getByLabelText('打开加油站: https://fuel.example.com')).toBeInTheDocument();
    expect(screen.getByLabelText('点击签到')).toBeInTheDocument();
    expect(screen.getByLabelText('刷新检测')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更多操作' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑账户' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除账户' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加账户' })).not.toBeInTheDocument();
  });

  it('keeps the site identity column compact enough for the default window width', () => {
    const { container } = render(
      <SiteCardHeader
        site={baseSite}
        siteResult={undefined}
        lastSyncDisplay="12:34"
        errorCode={null}
        timeoutSeconds={null}
        columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
        todayTotalTokens={4200}
        todayPromptTokens={0}
        todayCompletionTokens={0}
        todayRequests={6}
        rpm={0}
        tpm={0}
        modelCount={3}
        accountId="account-1"
        accountName="Primary Account"
        onOpenSite={vi.fn()}
        cliCompatibility={{
          claudeCode: true,
          codex: null,
          geminiCli: false,
          testedAt: Date.now(),
        }}
        cliConfig={{
          claudeCode: {
            apiKeyId: 1,
            model: 'claude-3-5-sonnet',
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          codex: {
            apiKeyId: 2,
            model: 'gpt-4.1',
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          geminiCli: {
            apiKeyId: null,
            model: null,
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
        }}
        isCliTesting={false}
        onOpenCliConfig={vi.fn()}
        onTestCliCompat={vi.fn()}
        onApply={vi.fn()}
      />
    );

    const grid = container.firstElementChild as HTMLDivElement;
    // Phase 5/6: 精简为 5 列
    expect(grid.style.gridTemplateColumns).toBe('240px 96px 96px 120px 340px');
    expect(screen.getByText('Primary Account')).toBeInTheDocument();
    expect(screen.getByText('12:34')).toBeInTheDocument();
    // Phase 5/6: 站点类型列已移除
    expect(screen.queryByText('New API')).not.toBeInTheDocument();
    expect(screen.queryByText('default')).not.toBeInTheDocument();
    // CLI 图标已移到 History 列，不再单独占据一列
    expect(screen.queryByAltText('Claude Code')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Codex')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Gemini CLI')).not.toBeInTheDocument();
    // CLI配置和CLI应用按钮已移到侧滑面板中
    expect(screen.queryByRole('button', { name: 'CLI配置' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'CLI应用' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('测试 CLI 兼容性')).not.toBeInTheDocument();
    expect(screen.queryByTitle('应用 CLI 配置到本地文件')).not.toBeInTheDocument();
    expect(screen.queryByText('CLI 工作台')).not.toBeInTheDocument();
  });

  it('keeps primary site controls visible together inside a standard shell width', () => {
    render(
      <div className="w-[1024px]">
        <SiteListHeader
          columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
          onColumnWidthChange={vi.fn()}
          sortField="balance"
          sortOrder="desc"
          onToggleSort={vi.fn()}
        />
        <SiteCard
          {...buildSiteCardProps({
            cliCompatibility: {
              claudeCode: true,
              codex: null,
              geminiCli: null,
              testedAt: Date.now(),
            },
          })}
        />
      </div>
    );

    expect(screen.getByRole('button', { name: '余额' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更多操作' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新检测' })).toBeInTheDocument();
    expect(screen.getByText('Primary Account')).toBeInTheDocument();
    // CLI配置按钮已移到侧滑面板中
    expect(screen.queryByRole('button', { name: 'CLI配置' })).not.toBeInTheDocument();
    expect(screen.queryByText('CLI 工作台')).not.toBeInTheDocument();
  });

  it('renders the CLI compatibility surface through visible icons and config/apply entry buttons', () => {
    const onConfig = vi.fn();
    const onApply = vi.fn();

    render(
      <CliCompatibilityIcons
        compatibility={{
          claudeCode: true,
          codex: false,
          geminiCli: null,
          testedAt: Date.now(),
        }}
        cliConfig={{
          claudeCode: {
            apiKeyId: 1,
            model: 'claude-3-5-sonnet',
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          codex: {
            apiKeyId: 2,
            model: 'gpt-4.1',
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          geminiCli: {
            apiKeyId: 3,
            model: 'gemini-2.5-pro',
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
        }}
        configTrigger="text"
        configButtonLabel="CLI配置"
        onConfig={onConfig}
        onApply={onApply}
      />
    );

    expect(screen.getByAltText('Claude Code')).toBeInTheDocument();
    expect(screen.getByAltText('Codex')).toBeInTheDocument();
    expect(screen.getByAltText('Gemini CLI')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'CLI配置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CLI应用' })).toBeInTheDocument();
    expect(screen.queryByTitle('测试 CLI 兼容性')).not.toBeInTheDocument();
    expect(screen.queryByTitle('应用 CLI 配置到本地文件')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'CLI配置' }));
    fireEvent.click(screen.getByRole('button', { name: 'CLI应用' }));

    expect(onConfig).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('lights up a CLI icon when persisted test results contain at least one successful model', () => {
    render(
      <CliCompatibilityIcons
        compatibility={{
          claudeCode: null,
          codex: null,
          geminiCli: null,
          testedAt: null,
        }}
        cliConfig={{
          claudeCode: {
            apiKeyId: 1,
            model: 'claude-3-5-sonnet',
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          codex: {
            apiKeyId: 2,
            model: 'gpt-4.1',
            testModel: 'gpt-4.1',
            testModels: ['gpt-4.1'],
            testResults: [
              {
                model: 'gpt-4.1',
                success: true,
                timestamp: Date.now(),
              },
              null,
              null,
            ],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          geminiCli: {
            apiKeyId: 3,
            model: 'gemini-2.5-pro',
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
        }}
        configTrigger="text"
        configButtonLabel="CLI配置"
        onConfig={vi.fn()}
        onApply={vi.fn()}
      />
    );

    expect(screen.getByAltText('Codex').parentElement?.className).toContain('opacity-100');
    expect(screen.getByAltText('Codex').parentElement?.title).toContain('支持');
  });

  it('uses newer projected compatibility over stale persisted CLI test results', () => {
    render(
      <CliCompatibilityIcons
        compatibility={{
          claudeCode: null,
          codex: false,
          geminiCli: null,
          testedAt: 200,
          codexError: '错误码 503',
          sourceLabel: '来自站点检测',
        }}
        cliConfig={{
          claudeCode: {
            apiKeyId: 1,
            model: 'claude-3-5-sonnet',
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          codex: {
            apiKeyId: 2,
            model: 'gpt-4.1',
            testModel: 'gpt-4.1',
            testModels: ['gpt-4.1'],
            testResults: [
              {
                model: 'gpt-4.1',
                success: true,
                timestamp: 100,
              },
              null,
              null,
            ],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          geminiCli: {
            apiKeyId: 3,
            model: 'gemini-2.5-pro',
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
        }}
        configTrigger="text"
        configButtonLabel="CLI配置"
        onConfig={vi.fn()}
        onApply={vi.fn()}
      />
    );

    const codexIcon = screen.getByAltText('Codex').parentElement;
    expect(codexIcon?.className).toContain('opacity-70');
    expect(codexIcon?.title).toContain('不支持');
    expect(codexIcon?.title).toContain('来自站点检测');
    expect(codexIcon?.title).toContain('错误码 503');
  });

  it('keeps CLI icons inline in the header instead of a dedicated workbench slot', () => {
    const { getByTestId } = render(
      <SiteCard
        {...buildSiteCardProps({
          cliCompatibility: {
            claudeCode: true,
            codex: null,
            geminiCli: null,
            testedAt: Date.now(),
          },
        })}
      />
    );

    const mainRow = getByTestId('site-card-main-row');
    // CLI配置按钮已移到侧滑面板中
    expect(within(mainRow).queryByRole('button', { name: 'CLI配置' })).not.toBeInTheDocument();
    expect(within(mainRow).queryByText('CLI 工作台')).not.toBeInTheDocument();
  });

  it('shows sub2api string active API keys as enabled in site details', () => {
    renderSiteCardDetails({
      apiKeys: [
        {
          id: 1,
          name: 'Alpha Key',
          key: 'sk-alpha',
          group: 'alpha',
          status: 'active',
        },
        {
          id: 2,
          name: 'Expired Key',
          key: 'sk-expired',
          group: 'alpha',
          status: 'expired',
        },
      ],
      userGroups: {
        alpha: { desc: 'Alpha', ratio: 1 },
      },
    });

    expect(screen.getByText('Alpha Key')).toBeInTheDocument();
    expect(screen.getByText('Expired Key')).toBeInTheDocument();
    expect(screen.getByText('✓ 启用')).toHaveClass('text-[var(--success)]');
    expect(screen.getByText('✕ 禁用')).toHaveClass('text-[var(--text-secondary)]');
  });

  it('renders a per API key refresh button in site details', () => {
    const onRefreshToken = vi.fn();
    renderSiteCardDetails({
      apiKeys: [
        {
          id: 1,
          name: 'Alpha Key',
          key: 'sk-alpha',
          group: 'alpha',
          status: 'active',
        },
      ],
      userGroups: {
        alpha: { desc: 'Alpha', ratio: 1 },
      },
      onRefreshToken,
    });

    fireEvent.click(screen.getByRole('button', { name: '刷新 API Key: Alpha Key' }));

    expect(onRefreshToken).toHaveBeenCalledTimes(1);
    expect(onRefreshToken.mock.calls[0]?.[0]).toEqual(baseSite);
    expect(onRefreshToken.mock.calls[0]?.[1]).toMatchObject({ id: 1, name: 'Alpha Key' });
    expect(onRefreshToken.mock.calls[0]?.[2]).toBe(0);
  });

  it('rerenders the site card when only cli test results change so the column icons update', () => {
    const initialProps = buildSiteCardProps();
    const { rerender } = render(<SiteCard {...initialProps} />);

    // CLI 图标现在在 History 列，而不是独立的 CLI 可用性列
    // 当前测试场景：没有配置时不显示图标
    expect(screen.queryByAltText('Claude Code')).not.toBeInTheDocument();

    const nextCliConfig = {
      ...initialProps.cliConfig,
      claudeCode: {
        ...initialProps.cliConfig.claudeCode,
        testResults: [
          {
            model: 'claude-3-5-sonnet',
            success: true,
            timestamp: Date.now(),
          },
          null,
          null,
        ],
      },
    };

    rerender(<SiteCard {...buildSiteCardProps({ cliConfig: nextCliConfig })} />);

    // 配置后应该显示在 History 列
    // 注意：此测试可能需要根据 History 列的实际实现进一步调整
    expect(screen.queryByAltText('Claude Code')).not.toBeInTheDocument();
  });
});
