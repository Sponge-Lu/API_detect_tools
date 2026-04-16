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
    columnWidths: [120, 80, 75, 75, 75],
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
    onDeleteToken: vi.fn(),
    ...overrides,
  };
}

describe('sites page redesign', () => {
  it('keeps the header action spacer at 48px for icon alignment', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/pages/SitesPage.tsx'), 'utf8');

    expect(source).toContain('<div className="w-[48px]" aria-hidden="true" />');
  });

  it('renders only the visible folded-row columns inside the sticky header', () => {
    expect(DEFAULT_COLUMN_WIDTHS).toEqual([142, 100, 100, 82, 92, 92, 64, 180]);

    const { container } = render(
      <SiteListHeader
        columnWidths={[142, 100, 100, 82, 92, 92, 64, 180]}
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
    expect(screen.getByText('CLI可用性')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '请求统计' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更新时间' })).not.toBeInTheDocument();
    expect(screen.queryByText('LDC比例')).not.toBeInTheDocument();
  });

  it('renders token and request statistics as stacked two-line cells', () => {
    render(
      <SiteCardHeader
        site={baseSite}
        siteResult={undefined}
        lastSyncDisplay="12:34"
        errorCode={null}
        timeoutSeconds={null}
        columnWidths={[142, 100, 100, 82, 92, 92, 64, 180]}
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
    expect(screen.getByText('输入 3.0K / 输出 1.2K')).toBeInTheDocument();
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
        columnWidths={[142, 100, 100, 82, 92, 92, 64, 180]}
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
        columnWidths={[142, 100, 100, 82, 92, 92, 64, 180]}
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
    expect(screen.queryByText('输入 0 / 输出 0')).not.toBeInTheDocument();
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
        columnWidths={[142, 100, 100, 82, 92, 92, 64, 180]}
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
        columnWidths={[142, 100, 100, 82, 92, 92, 64, 180]}
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
        columnWidths={[142, 100, 100, 82, 92, 92, 64, 180]}
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
        onDeleteToken={vi.fn()}
      />
    );

    expect(screen.getByText('$-0.00')).toBeInTheDocument();
    expect(screen.queryByText('输入 0 / 输出 0')).not.toBeInTheDocument();
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
        columnWidths={[142, 100, 100, 82, 92, 92, 64, 180]}
        onColumnWidthChange={vi.fn()}
        sortField={null}
        sortOrder="desc"
        onToggleSort={onToggleSort}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '余额' }));
    fireEvent.click(screen.getByRole('button', { name: 'Token统计' }));
    expect(screen.queryByRole('button', { name: '更新时间' })).not.toBeInTheDocument();

    expect(onToggleSort).toHaveBeenCalledWith('balance');
    expect(onToggleSort).toHaveBeenCalledWith('totalTokens');
    expect(onToggleSort).toHaveBeenCalledTimes(2);
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
        columnWidths={[142, 100, 100, 82, 92, 92, 64, 180]}
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
    expect(grid.style.gridTemplateColumns).toBe('142px 100px 100px 82px 92px 92px 64px 180px');
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
          columnWidths={[142, 100, 100, 82, 92, 92, 64, 180]}
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
          columnWidths={[120, 80, 75, 75, 75]}
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

  it('keeps CLI icons inline in the header instead of a dedicated workbench slot', () => {
    const { getByTestId } = render(
      <SiteCard
        site={baseSite}
        index={0}
        siteResult={{ status: '成功', todayRequests: 2, todayTotalTokens: 3000, models: [] } as any}
        siteAccount={undefined}
        isExpanded={false}
        columnWidths={[120, 80, 75, 75, 75]}
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
        onDeleteToken={vi.fn()}
      />
    );

    const mainRow = getByTestId('site-card-main-row');
    expect(within(mainRow).getByRole('button', { name: 'CLI配置' })).toBeInTheDocument();
    expect(within(mainRow).queryByText('CLI 工作台')).not.toBeInTheDocument();
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
