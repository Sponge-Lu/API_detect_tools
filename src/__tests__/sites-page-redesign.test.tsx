import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_COLUMN_WIDTHS } from '../shared/constants';
import { CliCompatibilityIcons } from '../renderer/components/CliCompatibilityIcons/CliCompatibilityIcons';
import { SiteListHeader } from '../renderer/components/SiteListHeader';
import { SiteCard, SiteCardActions } from '../renderer/components/SiteCard';
import { SiteCardHeader } from '../renderer/components/SiteCard/SiteCardHeader';
import type { SiteConfig } from '../renderer/App';

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
    isExpanded: false,
    columnWidths: [...DEFAULT_COLUMN_WIDTHS],
    accountId: 'account-1',
    accountName: 'Primary Account',
    accountAccessToken: undefined,
    accountUserId: undefined,
    cardKey: 'site-1::account-1',
    apiKeys: [],
    userGroups: {},
    modelPricing: null,
    isDetecting: false,
    checkingIn: null,
    dragOverIndex: null,
    refreshMessage: null,
    selectedGroup: null,
    modelSearch: '',
    globalModelSearch: '',
    showTokens: {},
    selectedModels: new Set<string>(),
    deletingTokenKey: null,
    refreshingTokenKey: null,
    autoRefreshEnabled: false,
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
    onExpand: vi.fn(),
    onDetect: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onCheckIn: vi.fn(),
    onOpenSite: vi.fn(),
    onOpenExtraLink: vi.fn(),
    onCopyToClipboard: vi.fn(),
    onToggleAutoRefresh: vi.fn(),
    onOpenCliConfig: vi.fn(),
    onTestCliCompat: vi.fn(),
    onApply: vi.fn(),
    onAddAccount: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
    onToggleGroupFilter: vi.fn(),
    onModelSearchChange: vi.fn(),
    onToggleTokenVisibility: vi.fn(),
    onToggleModelSelection: vi.fn(),
    onCopySelectedModels: vi.fn(),
    onClearSelectedModels: vi.fn(),
    onOpenCreateTokenDialog: vi.fn(),
    onRefreshToken: vi.fn(),
    onDeleteToken: vi.fn(),
    ...overrides,
  };
}

describe('sites page redesign', () => {
  it('keeps the header action spacer at 48px for icon alignment', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/pages/SitesPage.tsx'), 'utf8');

    expect(source).toContain('<div className="w-[48px]" aria-hidden="true" />');
  });

  it('defaults the group filter to 默认分组 and does not render an 全部 tab', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/pages/SitesPage.tsx'), 'utf8');

    expect(source).toContain(
      'const effectiveActiveSiteGroupFilter = activeSiteGroupFilter ?? defaultGroupId;'
    );
    expect(source).not.toContain('<span className="font-semibold">全部</span>');
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
    render(
      <SiteCard
        {...buildSiteCardProps({
          isExpanded: true,
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
        })}
      />
    );

    expect(screen.getByTitle('按次')).toHaveClass('border-[var(--line-muted)]');
    expect(screen.getByTitle('按量')).toHaveClass('border-[var(--line-muted)]');
  });

  it('renders only the visible folded-row columns inside the sticky header', () => {
    expect(DEFAULT_COLUMN_WIDTHS).toEqual([142, 86, 88, 78, 110, 92, 56, 72, 180]);

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
    expect(screen.getByRole('button', { name: '站点' })).toBeInTheDocument();
    expect(screen.getByText('站点类型')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '余额' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '今日消费' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Token统计' })).toBeInTheDocument();
    expect(screen.getByText('请求统计')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '模型数' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'LDC' })).toBeInTheDocument();
    expect(screen.getByText('CLI可用性')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '请求统计' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更新时间' })).not.toBeInTheDocument();
  });

  it('renders token and request statistics as stacked two-line cells', () => {
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

    expect(screen.getByText('4.2K')).toBeInTheDocument();
    expect(screen.getByText('In 3.0K / Out 1.2K')).toBeInTheDocument();
    expect(screen.getByText('RPM 0.50 / TPM 350')).toBeInTheDocument();
    expect(screen.getByText('New API')).toBeInTheDocument();
  });

  it('renders the site type cell as plain left-aligned text instead of a badge', () => {
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

    const siteTypeText = screen.getByTitle('New API');
    const siteTypeCell = siteTypeText.parentElement as HTMLDivElement;

    expect(siteTypeText).toHaveClass('w-full', 'text-left');
    expect(siteTypeText).not.toHaveClass('rounded-full');
    expect(siteTypeCell).toHaveClass('justify-start');
    expect(siteTypeCell).not.toHaveClass('justify-center');
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
    expect(screen.getByRole('button', { name: 'CLI配置' })).toBeInTheDocument();
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
        isExpanded={false}
        columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
        accountId={undefined}
        accountName={undefined}
        accountAccessToken={undefined}
        accountUserId={undefined}
        cardKey="site-1"
        apiKeys={[]}
        userGroups={{}}
        modelPricing={null}
        isDetecting={false}
        checkingIn={null}
        dragOverIndex={null}
        refreshMessage={null}
        selectedGroup={null}
        modelSearch=""
        globalModelSearch=""
        showTokens={{}}
        selectedModels={new Set<string>()}
        deletingTokenKey={null}
        refreshingTokenKey={null}
        autoRefreshEnabled={false}
        cliCompatibility={{ claudeCode: true, codex: null, geminiCli: null, testedAt: Date.now() }}
        cliConfig={null}
        isCliTesting={false}
        onExpand={vi.fn()}
        onDetect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onCheckIn={vi.fn()}
        onOpenSite={vi.fn()}
        onOpenExtraLink={vi.fn()}
        onCopyToClipboard={vi.fn()}
        onToggleAutoRefresh={vi.fn()}
        onOpenCliConfig={vi.fn()}
        onTestCliCompat={vi.fn()}
        onApply={vi.fn()}
        onAddAccount={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onDragOver={vi.fn()}
        onDragLeave={vi.fn()}
        onDrop={vi.fn()}
        onToggleGroupFilter={vi.fn()}
        onModelSearchChange={vi.fn()}
        onToggleTokenVisibility={vi.fn()}
        onToggleModelSelection={vi.fn()}
        onCopySelectedModels={vi.fn()}
        onClearSelectedModels={vi.fn()}
        onOpenCreateTokenDialog={vi.fn()}
        onRefreshToken={vi.fn()}
        onDeleteToken={vi.fn()}
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
        columnWidths={[120, 80, 75, 75, 75]}
        onColumnWidthChange={vi.fn()}
        sortField="balance"
        sortOrder="desc"
        onToggleSort={vi.fn()}
        actions={<button type="button">批量检测</button>}
      />
    );

    expect(screen.getByRole('button', { name: '站点' })).toBeInTheDocument();
    expect(screen.getByText('站点类型')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '余额' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '今日消费' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Token统计' })).toBeInTheDocument();
    expect(screen.getByText('批量检测')).toBeInTheDocument();
    const header = container.firstElementChild as HTMLDivElement;
    expect(header.style.gridTemplateColumns).toBe('120px 80px 75px 75px 75px 1fr');
    expect(header).toHaveClass('px-3');
    expect(header.lastElementChild).toHaveClass('items-center', 'justify-end', 'gap-0.5');
  });

  it('filters by site type from the header select', () => {
    const onSiteTypeFilterChange = vi.fn();

    render(
      <SiteListHeader
        columnWidths={[120, 80, 75, 75, 75]}
        onColumnWidthChange={vi.fn()}
        activeSiteTypeFilter={null}
        siteTypeFilterOptions={[
          { value: 'newapi', label: 'New API', count: 2 },
          { value: 'sub2api', label: 'Sub2API', count: 1 },
        ]}
        onSiteTypeFilterChange={onSiteTypeFilterChange}
      />
    );

    fireEvent.change(screen.getByRole('combobox', { name: '站点类型筛选' }), {
      target: { value: 'sub2api' },
    });

    expect(onSiteTypeFilterChange).toHaveBeenCalledWith('sub2api');
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

    fireEvent.click(screen.getByRole('button', { name: '余额' }));
    fireEvent.click(screen.getByRole('button', { name: 'Token统计' }));
    fireEvent.click(screen.getByRole('button', { name: 'LDC' }));
    expect(screen.queryByRole('button', { name: '更新时间' })).not.toBeInTheDocument();

    expect(onToggleSort).toHaveBeenCalledWith('balance');
    expect(onToggleSort).toHaveBeenCalledWith('totalTokens');
    expect(onToggleSort).toHaveBeenCalledWith('ldcRatio');
    expect(onToggleSort).toHaveBeenCalledTimes(3);
  });

  it('keeps high-frequency actions visible and moves low-frequency actions into a more menu', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onAddAccount = vi.fn();

    render(
      <SiteCardActions
        site={baseSite}
        index={0}
        siteResult={
          {
            status: '成功',
            can_check_in: true,
            has_checkin: true,
          } as any
        }
        isExpanded={false}
        isDetecting={false}
        checkingIn={null}
        autoRefreshEnabled={false}
        editAccount={null}
        onExpand={vi.fn()}
        onDetect={vi.fn()}
        onEdit={onEdit}
        onDelete={onDelete}
        onCheckIn={vi.fn()}
        onOpenExtraLink={vi.fn()}
        onToggleAutoRefresh={vi.fn()}
        onAddAccount={onAddAccount}
      />
    );

    expect(screen.getByLabelText('打开加油站: https://fuel.example.com')).toBeInTheDocument();
    expect(screen.getByLabelText('点击签到')).toBeInTheDocument();
    expect(screen.getByLabelText('展开详情')).toBeInTheDocument();
    expect(screen.getByLabelText('刷新检测')).toBeInTheDocument();
    expect(screen.getByLabelText('开启自动刷新')).toBeInTheDocument();

    expect(screen.queryByLabelText('编辑站点')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('删除账户')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('添加账户')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑站点' }));
    expect(screen.queryByRole('button', { name: '编辑站点' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '删除账户' }));
    expect(screen.queryByRole('button', { name: '删除账户' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '添加账户' }));
    expect(screen.queryByRole('button', { name: '添加账户' })).not.toBeInTheDocument();

    expect(onEdit).toHaveBeenCalledWith(0, null);
    expect(onDelete).toHaveBeenCalledWith(0);
    expect(onAddAccount).toHaveBeenCalled();
  });

  it('preserves AnyRouter account config when opening account edit from the site card', () => {
    const onEdit = vi.fn();
    const userHash = 'a'.repeat(64);

    render(
      <SiteCard
        {...buildSiteCardProps({
          site: {
            ...baseSite,
            id: 'site-anyrouter',
            name: 'Any Router',
            url: 'https://anyrouter.top',
          },
          accountId: 'account-anyrouter',
          accountName: 'AnyRouter Account',
          accountAccessToken: 'sk-anyrouter',
          accountUserId: 'user-anyrouter',
          accountAnyRouterConfig: { userHash },
          onEdit,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑账户' }));

    expect(onEdit).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        id: 'account-anyrouter',
        anyRouterConfig: { userHash },
      })
    );
  });

  it('opens the same low-frequency actions from row context menu parity', () => {
    render(
      <SiteCardActions
        site={baseSite}
        index={0}
        siteResult={{ status: '成功' } as any}
        isExpanded={false}
        isDetecting={false}
        checkingIn={null}
        autoRefreshEnabled={false}
        editAccount={null}
        onExpand={vi.fn()}
        onDetect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onCheckIn={vi.fn()}
        onOpenExtraLink={vi.fn()}
        onToggleAutoRefresh={vi.fn()}
        onAddAccount={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: '更多操作' }));

    expect(screen.getByRole('button', { name: '编辑站点' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除账户' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加账户' })).toBeInTheDocument();
  });

  it('uses a single delete-account action for account cards', () => {
    const onDelete = vi.fn();

    render(
      <SiteCardActions
        site={baseSite}
        index={0}
        siteResult={{ status: '成功' } as any}
        isExpanded={false}
        isDetecting={false}
        checkingIn={null}
        autoRefreshEnabled={false}
        editAccount={{
          id: 'account-1',
          account_name: 'Primary Account',
          access_token: 'token',
          user_id: 'user-1',
        }}
        onExpand={vi.fn()}
        onDetect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={onDelete}
        onCheckIn={vi.fn()}
        onOpenExtraLink={vi.fn()}
        onToggleAutoRefresh={vi.fn()}
        onAddAccount={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));

    expect(screen.getByRole('button', { name: '编辑账户' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除账户' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除站点' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '删除账户' }));
    expect(onDelete).toHaveBeenCalledWith(0);
  });

  it('opens the more menu upward when the trigger is near the viewport bottom', () => {
    const originalInnerHeight = window.innerHeight;
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 820 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });

    render(
      <SiteCardActions
        site={baseSite}
        index={0}
        siteResult={{ status: '成功' } as any}
        isExpanded={false}
        isDetecting={false}
        checkingIn={null}
        autoRefreshEnabled={false}
        editAccount={null}
        onExpand={vi.fn()}
        onDetect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onCheckIn={vi.fn()}
        onOpenExtraLink={vi.fn()}
        onToggleAutoRefresh={vi.fn()}
        onAddAccount={vi.fn()}
      />
    );

    const moreButton = screen.getByRole('button', { name: '更多操作' });
    vi.spyOn(moreButton, 'getBoundingClientRect').mockReturnValue({
      x: 320,
      y: 780,
      width: 24,
      height: 24,
      top: 780,
      right: 344,
      bottom: 804,
      left: 320,
      toJSON: () => ({}),
    });

    fireEvent.click(moreButton);

    const menu = screen.getByRole('menu');
    expect(Number.parseFloat((menu as HTMLDivElement).style.top)).toBeLessThan(780);

    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
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
    expect(grid.style.gridTemplateColumns).toBe('142px 86px 88px 78px 110px 92px 56px 72px 180px');
    expect(grid.lastElementChild).toHaveClass('justify-center');
    expect(screen.getByText('Primary Account')).toBeInTheDocument();
    expect(screen.getByText('12:34')).toBeInTheDocument();
    expect(screen.getByText('New API')).toBeInTheDocument();
    expect(screen.queryByText('default')).not.toBeInTheDocument();
    expect(screen.getByAltText('Claude Code')).toBeInTheDocument();
    expect(screen.getByAltText('Codex')).toBeInTheDocument();
    expect(screen.getByAltText('Gemini CLI')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CLI配置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CLI应用' })).toBeInTheDocument();
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
          site={baseSite}
          index={0}
          siteResult={
            { status: '成功', todayRequests: 2, todayTotalTokens: 3000, models: [] } as any
          }
          siteAccount={undefined}
          isExpanded={false}
          columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
          accountId="account-1"
          accountName="Primary Account"
          accountAccessToken={undefined}
          accountUserId={undefined}
          cardKey="site-1::account-1"
          apiKeys={[]}
          userGroups={{}}
          modelPricing={null}
          isDetecting={false}
          checkingIn={null}
          dragOverIndex={null}
          refreshMessage={null}
          selectedGroup={null}
          modelSearch=""
          globalModelSearch=""
          showTokens={{}}
          selectedModels={new Set<string>()}
          deletingTokenKey={null}
          refreshingTokenKey={null}
          autoRefreshEnabled={false}
          cliCompatibility={{
            claudeCode: true,
            codex: null,
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
              apiKeyId: null,
              model: null,
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
              enabled: false,
              editedFiles: null,
              applyMode: 'merge',
            },
          }}
          isCliTesting={false}
          onExpand={vi.fn()}
          onDetect={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onCheckIn={vi.fn()}
          onOpenSite={vi.fn()}
          onOpenExtraLink={vi.fn()}
          onCopyToClipboard={vi.fn()}
          onToggleAutoRefresh={vi.fn()}
          onOpenCliConfig={vi.fn()}
          onTestCliCompat={vi.fn()}
          onApply={vi.fn()}
          onAddAccount={vi.fn()}
          onDragStart={vi.fn()}
          onDragEnd={vi.fn()}
          onDragOver={vi.fn()}
          onDragLeave={vi.fn()}
          onDrop={vi.fn()}
          onToggleGroupFilter={vi.fn()}
          onModelSearchChange={vi.fn()}
          onToggleTokenVisibility={vi.fn()}
          onToggleModelSelection={vi.fn()}
          onCopySelectedModels={vi.fn()}
          onClearSelectedModels={vi.fn()}
          onOpenCreateTokenDialog={vi.fn()}
          onRefreshToken={vi.fn()}
          onDeleteToken={vi.fn()}
        />
      </div>
    );

    expect(screen.getByRole('button', { name: '余额' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多操作' })).toBeInTheDocument();
    expect(screen.getByText('Primary Account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CLI配置' })).toBeInTheDocument();
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
        site={baseSite}
        index={0}
        siteResult={{ status: '成功', todayRequests: 2, todayTotalTokens: 3000, models: [] } as any}
        siteAccount={undefined}
        isExpanded={false}
        columnWidths={[...DEFAULT_COLUMN_WIDTHS]}
        accountId="account-1"
        accountName="Primary Account"
        accountAccessToken={undefined}
        accountUserId={undefined}
        cardKey="site-1::account-1"
        apiKeys={[]}
        userGroups={{}}
        modelPricing={null}
        isDetecting={false}
        checkingIn={null}
        dragOverIndex={null}
        refreshMessage={null}
        selectedGroup={null}
        modelSearch=""
        globalModelSearch=""
        showTokens={{}}
        selectedModels={new Set<string>()}
        deletingTokenKey={null}
        refreshingTokenKey={null}
        autoRefreshEnabled={false}
        cliCompatibility={{
          claudeCode: true,
          codex: null,
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
            apiKeyId: null,
            model: null,
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
            enabled: false,
            editedFiles: null,
            applyMode: 'merge',
          },
        }}
        isCliTesting={false}
        onExpand={vi.fn()}
        onDetect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onCheckIn={vi.fn()}
        onOpenSite={vi.fn()}
        onOpenExtraLink={vi.fn()}
        onCopyToClipboard={vi.fn()}
        onToggleAutoRefresh={vi.fn()}
        onOpenCliConfig={vi.fn()}
        onTestCliCompat={vi.fn()}
        onApply={vi.fn()}
        onAddAccount={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onDragOver={vi.fn()}
        onDragLeave={vi.fn()}
        onDrop={vi.fn()}
        onToggleGroupFilter={vi.fn()}
        onModelSearchChange={vi.fn()}
        onToggleTokenVisibility={vi.fn()}
        onToggleModelSelection={vi.fn()}
        onCopySelectedModels={vi.fn()}
        onClearSelectedModels={vi.fn()}
        onOpenCreateTokenDialog={vi.fn()}
        onRefreshToken={vi.fn()}
        onDeleteToken={vi.fn()}
      />
    );

    const mainRow = getByTestId('site-card-main-row');
    expect(within(mainRow).getByRole('button', { name: 'CLI配置' })).toBeInTheDocument();
    expect(within(mainRow).queryByText('CLI 工作台')).not.toBeInTheDocument();
  });

  it('shows sub2api string active API keys as enabled in site details', () => {
    render(
      <SiteCard
        {...buildSiteCardProps({
          isExpanded: true,
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
        })}
      />
    );

    expect(screen.getByText('Alpha Key')).toBeInTheDocument();
    expect(screen.getByText('Expired Key')).toBeInTheDocument();
    expect(screen.getByText('✓ 启用')).toHaveClass('text-[var(--success)]');
    expect(screen.getByText('✕ 禁用')).toHaveClass('text-[var(--text-secondary)]');
  });

  it('renders a per API key refresh button in site details', () => {
    const onRefreshToken = vi.fn();
    render(
      <SiteCard
        {...buildSiteCardProps({
          isExpanded: true,
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
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '刷新 API Key: Alpha Key' }));

    expect(onRefreshToken).toHaveBeenCalledTimes(1);
    expect(onRefreshToken.mock.calls[0]?.[0]).toEqual(baseSite);
    expect(onRefreshToken.mock.calls[0]?.[1]).toMatchObject({ id: 1, name: 'Alpha Key' });
    expect(onRefreshToken.mock.calls[0]?.[2]).toBe(0);
  });

  it('rerenders the site card when only cli test results change so the column icons update', () => {
    const initialProps = buildSiteCardProps();
    const { rerender } = render(<SiteCard {...initialProps} />);

    const claudeIcon = screen.getByAltText('Claude Code').parentElement as HTMLDivElement;
    expect(claudeIcon.title).toContain('已配置，待测试');
    expect(claudeIcon.className).toContain('opacity-50');

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

    const updatedClaudeIcon = screen.getByAltText('Claude Code').parentElement as HTMLDivElement;
    expect(updatedClaudeIcon.title).toContain('支持');
    expect(updatedClaudeIcon.className).toContain('opacity-100');
  });
});
