import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CliCompatibilityIcons } from '../renderer/components/CliCompatibilityIcons/CliCompatibilityIcons';
import { SiteListHeader } from '../renderer/components/SiteListHeader';
import { SiteCard, SiteCardActions, SiteCardCliEntry } from '../renderer/components/SiteCard';
import { SiteCardHeader } from '../renderer/components/SiteCard/SiteCardHeader';
import type { SiteConfig } from '../renderer/App';

const SortBar = SiteListHeader as any;

const baseSite: SiteConfig = {
  id: 'site-1',
  name: 'Claude Hub',
  url: 'https://example.com',
  enabled: true,
  group: 'default',
  apiKey: 'sk-test',
  auth_type: 'bearer',
  notes: '',
  extra_links: 'https://fuel.example.com',
  force_enable_checkin: true,
};

describe('sites page redesign', () => {
  it('renders a fixed sort bar with three primary sort buttons and a more-sort entry', () => {
    const { container } = render(
      <SortBar
        columnWidths={[120, 75, 75, 75]}
        onColumnWidthChange={vi.fn()}
        sortField="balance"
        sortOrder="desc"
        onToggleSort={vi.fn()}
        onResetSort={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '余额' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '今日消费' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '总 Token' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多排序' })).toBeInTheDocument();
    expect(screen.getByText('当前排序')).toBeInTheDocument();
    expect(container.firstElementChild).not.toHaveClass('min-w-[1180px]');
    expect(screen.getByText('当前排序').parentElement).toContainElement(
      screen.getByRole('button', { name: '更多排序' })
    );
    expect(screen.getByText('当前排序').parentElement).toContainElement(
      screen.getByRole('button', { name: '清除排序' })
    );
  });

  it('reveals secondary sort options from the more-sort menu', () => {
    const onToggleSort = vi.fn();

    render(
      <SortBar
        columnWidths={[120, 75, 75, 75]}
        onColumnWidthChange={vi.fn()}
        sortField={null}
        sortOrder="desc"
        onToggleSort={onToggleSort}
        onResetSort={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '更多排序' }));
    expect(screen.getByRole('button', { name: '请求' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RPM' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'TPM' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更新时间' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '模型数' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '名称' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'RPM' }));

    expect(onToggleSort).toHaveBeenCalledWith('rpm');
  });

  it('keeps high-frequency actions visible and moves low-frequency actions into a more menu', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onAddAccount = vi.fn();

    render(
      <SiteCardActions
        site={baseSite}
        index={0}
        siteResult={{
          status: '成功',
          can_check_in: true,
          has_checkin: true,
        } as any}
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
    expect(screen.queryByLabelText('删除站点')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('添加账户')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑站点' }));
    expect(screen.queryByRole('button', { name: '编辑站点' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '删除站点' }));
    expect(screen.queryByRole('button', { name: '删除站点' })).not.toBeInTheDocument();

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
    expect(screen.getByRole('button', { name: '删除站点' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加账户' })).toBeInTheDocument();
  });

  it('keeps a dedicated CLI workbench entry visible on the main row', () => {
    const onOpenCliWorkbench = vi.fn();

    render(
      <SiteCardCliEntry
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
        compatibility={{
          claudeCode: true,
          codex: null,
          geminiCli: null,
          testedAt: Date.now(),
        }}
        isCliTesting={false}
        onOpen={onOpenCliWorkbench}
      />
    );

    expect(screen.getByRole('button', { name: 'CLI 工作台' })).toBeInTheDocument();
    expect(screen.getByText('1/2 已通过')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'CLI 工作台' }));
    expect(onOpenCliWorkbench).toHaveBeenCalledTimes(1);
  });

  it('keeps the site identity column compact enough for the default window width', () => {
    const { container } = render(
      <SiteCardHeader
        site={baseSite}
        siteResult={undefined}
        lastSyncDisplay="12:34"
        errorCode={null}
        timeoutSeconds={null}
        columnWidths={[120, 75, 75, 75, 50, 50, 50, 50, 50, 60, 80, 160]}
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
      />
    );

    const grid = container.firstElementChild as HTMLDivElement;
    expect(grid.style.gridTemplateColumns).toBe(
      '196px 168px 120px 88px 96px'
    );
    expect(screen.getByText('Primary Account')).toBeInTheDocument();
    expect(screen.getByText('同步 12:34')).toBeInTheDocument();
    expect(screen.queryByText('default')).not.toBeInTheDocument();
    expect(screen.queryByText('unavailable')).not.toBeInTheDocument();
    expect(screen.getByTestId('site-token-inline')).toHaveTextContent('4.2K · 6 请求');
    expect(screen.getByText('模型')).toBeInTheDocument();
    expect(screen.queryByText('能力摘要')).not.toBeInTheDocument();
    expect(screen.getByAltText('Claude Code')).toBeInTheDocument();
    expect(screen.getByAltText('Codex')).toBeInTheDocument();
    expect(screen.getByAltText('Gemini CLI')).toBeInTheDocument();
    expect(screen.queryByTitle('配置 CLI')).not.toBeInTheDocument();
  });

  it('keeps primary site controls visible together inside a standard shell width', () => {
    render(
      <div className="w-[1024px]">
        <SortBar
          columnWidths={[120, 75, 75, 75]}
          onColumnWidthChange={vi.fn()}
          sortField="balance"
          sortOrder="desc"
          onToggleSort={vi.fn()}
          onResetSort={vi.fn()}
        />
        <SiteCard
          site={baseSite}
          index={0}
          siteResult={{ status: '成功', todayRequests: 2, todayTotalTokens: 3000, models: [] } as any}
          siteAccount={undefined}
          isExpanded={false}
          columnWidths={[120, 75, 75, 75]}
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

    expect(screen.getByRole('button', { name: '更多排序' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CLI 工作台' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多操作' })).toBeInTheDocument();
    expect(screen.getByText('Primary Account')).toBeInTheDocument();
  });

  it('renders the CLI compatibility surface through visible icons and action controls', () => {
    const onConfig = vi.fn();
    const onTest = vi.fn();
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
        onConfig={onConfig}
        onTest={onTest}
        onApply={onApply}
      />
    );

    expect(screen.getByAltText('Claude Code')).toBeInTheDocument();
    expect(screen.getByAltText('Codex')).toBeInTheDocument();
    expect(screen.getByAltText('Gemini CLI')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('配置 CLI'));
    fireEvent.click(screen.getByTitle('测试 CLI 兼容性'));
    fireEvent.click(screen.getByTitle('应用 CLI 配置到本地文件'));

    expect(onConfig).toHaveBeenCalledTimes(1);
    expect(onTest).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('places the CLI workbench slot to the left of the normal site actions', () => {
    const { getByTestId } = render(
      <SiteCard
        site={baseSite}
        index={0}
        siteResult={{ status: '成功', todayRequests: 2, todayTotalTokens: 3000, models: [] } as any}
        siteAccount={undefined}
        isExpanded={false}
        columnWidths={[120, 75, 75, 75]}
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
    const childTestIds = Array.from(mainRow.children).map(child => child.getAttribute('data-testid'));
    expect(childTestIds).toEqual(['site-card-header-slot', 'site-card-cli-slot', 'site-card-actions-slot']);
  });
});
