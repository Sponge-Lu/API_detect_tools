import { useState, type ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataOverviewPage } from '../renderer/pages/DataOverviewPage';

const now = Date.now();
const todayLabel = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(
  new Date(now)
);

const mockConfig = {
  sites: [
    {
      id: 'site-1',
      name: 'Claude Site',
      url: 'https://claude.example.com',
      enabled: true,
      cached_data: {
        balance: 15.5,
        today_usage: 2.4,
        today_prompt_tokens: 1200,
        today_completion_tokens: 600,
        today_requests: 18,
        last_refresh: now,
        models: ['claude-opus-4-6'],
        has_checkin: true,
        can_check_in: false,
        checkin_stats: {
          today_quota: 500000,
          checkin_count: 12,
          total_checkins: 40,
          site_type: 'newapi',
        },
      },
    },
    {
      id: 'site-2',
      name: 'Codex Site',
      url: 'https://codex.example.com',
      enabled: true,
      cached_data: {
        balance: 8.2,
        today_usage: 5.8,
        today_prompt_tokens: 2400,
        today_completion_tokens: 800,
        today_requests: 26,
        last_refresh: now,
        models: ['gpt-5.4'],
        has_checkin: true,
        can_check_in: true,
        checkin_stats: {
          today_quota: 0,
          checkin_count: 7,
          total_checkins: 19,
          site_type: 'newapi',
        },
      },
    },
    {
      id: 'site-hidden',
      name: 'Hidden Site',
      url: 'https://hidden.example.com',
      group: 'unavailable',
      enabled: true,
      cached_data: {
        balance: 99.9,
        today_usage: 9.9,
        today_prompt_tokens: 999,
        today_completion_tokens: 999,
        today_requests: 99,
        last_refresh: now,
        has_checkin: true,
        can_check_in: true,
      },
    },
  ],
  accounts: [],
  settings: {
    timeout: 30,
    concurrent: false,
    show_disabled: true,
  },
};

const mockRouteConfig = {
  rules: [
    {
      id: 'rule-1',
      name: 'Claude 默认规则',
      enabled: true,
      priority: 90,
      cliType: 'claudeCode',
      patternType: 'wildcard',
      pattern: 'claude-*',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
};

const mockUIState: {
  activeTab: string;
  overviewSubtab: 'site' | 'route';
  setOverviewSubtab: ReturnType<typeof vi.fn>;
} = {
  activeTab: 'overview',
  overviewSubtab: 'site',
  setOverviewSubtab: vi.fn(),
};

vi.mock('../renderer/store/configStore', () => ({
  useConfigStore: (selector: (state: { config: typeof mockConfig }) => unknown) =>
    selector({ config: mockConfig }),
}));

vi.mock('../renderer/store/routeStore', () => ({
  useRouteStore: (
    selector: (state: { config: typeof mockRouteConfig; loading: boolean }) => unknown
  ) => selector({ config: mockRouteConfig, loading: false }),
}));

vi.mock('../renderer/store/uiStore', () => ({
  useUIStore: (selector: (state: typeof mockUIState) => unknown) => selector(mockUIState),
}));

describe('DataOverviewPage', () => {
  let appDataChangedListener:
    | ((payload: {
        domains: Array<'site-config' | 'site-overview' | 'route-overview'>;
        emittedAt: number;
      }) => void)
    | null = null;

  beforeEach(() => {
    appDataChangedListener = null;
    mockUIState.activeTab = 'overview';
    mockUIState.overviewSubtab = 'site';
    mockUIState.setOverviewSubtab.mockReset();
    window.electronAPI.route = {
      ...(window.electronAPI.route || {}),
      getAnalyticsSummary: vi.fn().mockResolvedValue({
        success: true,
        data: {
          totalRequests: 44,
          successCount: 39,
          failureCount: 5,
          neutralCount: 0,
          successRate: 88.6,
          promptTokens: 3600,
          completionTokens: 1400,
          totalTokens: 5000,
        },
      }),
      getAnalyticsDistribution: vi.fn().mockResolvedValue({
        success: true,
        data: {
          buckets: [
            {
              bucketKey: '1',
              bucketStart: now - 6 * 60 * 60 * 1000,
              bucketSize: 'hour',
              cliType: 'claudeCode',
              routeRuleId: 'rule-1',
              canonicalModel: 'claude-opus-4-6',
              siteId: 'site-1',
              accountId: 'acct-1',
              requestCount: 12,
              successCount: 11,
              failureCount: 1,
              neutralCount: 0,
              promptTokens: 1200,
              completionTokens: 600,
              totalTokens: 1800,
              statusCodeHistogram: { '200': 11, '502': 1 },
              latencyHistogram: { '0-1000ms': 8, '3000-5000ms': 4 },
              firstByteHistogram: { '0-200ms': 7 },
              updatedAt: now,
            },
            {
              bucketKey: '2',
              bucketStart: now - 3 * 60 * 60 * 1000,
              bucketSize: 'hour',
              cliType: 'codex',
              routeRuleId: undefined,
              canonicalModel: 'gpt-5.4',
              siteId: 'site-2',
              accountId: 'acct-2',
              requestCount: 20,
              successCount: 18,
              failureCount: 2,
              neutralCount: 0,
              promptTokens: 2200,
              completionTokens: 800,
              totalTokens: 3000,
              statusCodeHistogram: { '200': 18, '429': 2 },
              latencyHistogram: { '0-1000ms': 10, '>5000ms': 10 },
              firstByteHistogram: { '0-200ms': 9 },
              updatedAt: now,
            },
            {
              bucketKey: '3',
              bucketStart: now - 2 * 60 * 60 * 1000,
              bucketSize: 'hour',
              cliType: 'codex',
              routeRuleId: 'rule-2',
              canonicalModel: 'gpt-5.4-mini',
              siteId: 'site-2',
              accountId: 'acct-2',
              apiKeyId: 'key-beta',
              requestCount: 8,
              successCount: 7,
              failureCount: 1,
              neutralCount: 0,
              promptTokens: 800,
              completionTokens: 300,
              totalTokens: 1100,
              statusCodeHistogram: { '200': 7, '500': 1 },
              latencyHistogram: { '0-1000ms': 6, '>5000ms': 2 },
              firstByteHistogram: { '0-200ms': 5 },
              updatedAt: now,
            },
            {
              bucketKey: '4',
              bucketStart: now - 90 * 60 * 1000,
              bucketSize: 'hour',
              cliType: 'claudeCode',
              routeRuleId: 'rule-3',
              canonicalModel: 'claude-sonnet-4-6',
              siteId: 'site-1',
              accountId: 'acct-1',
              apiKeyId: 'key-alpha',
              requestCount: 6,
              successCount: 5,
              failureCount: 1,
              neutralCount: 0,
              promptTokens: 600,
              completionTokens: 240,
              totalTokens: 840,
              statusCodeHistogram: { '200': 5, '502': 1 },
              latencyHistogram: { '0-1000ms': 4, '3000-5000ms': 2 },
              firstByteHistogram: { '0-200ms': 4 },
              updatedAt: now,
            },
            {
              bucketKey: '5',
              bucketStart: now - 45 * 60 * 1000,
              bucketSize: 'hour',
              cliType: 'geminiCli',
              routeRuleId: 'rule-4',
              canonicalModel: 'gemini-2.5-pro',
              siteId: 'site-2',
              accountId: 'acct-2',
              apiKeyId: 'key-gamma',
              requestCount: 4,
              successCount: 3,
              failureCount: 1,
              neutralCount: 0,
              promptTokens: 400,
              completionTokens: 120,
              totalTokens: 520,
              statusCodeHistogram: { '200': 3, '503': 1 },
              latencyHistogram: { '0-1000ms': 3, '>5000ms': 1 },
              firstByteHistogram: { '0-200ms': 3 },
              updatedAt: now,
            },
          ],
          statusCodeHistogram: { '200': 29, '429': 2, '502': 1 },
          latencyHistogram: { '0-1000ms': 18, '3000-5000ms': 4, '>5000ms': 10 },
          firstByteHistogram: { '0-200ms': 16 },
        },
      }),
      getObjectStats: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            id: 'site-1:acct-1:key-alpha',
            siteId: 'site-1',
            siteName: 'Claude Site',
            accountId: 'acct-1',
            accountName: '主账户',
            apiKeyId: 'key-alpha',
            apiKeyName: 'Key-Alpha',
            requestCount: 12,
            successCount: 11,
            failureCount: 1,
            neutralCount: 0,
            successRate: 91.67,
            promptTokens: 1200,
            completionTokens: 600,
            totalTokens: 1800,
            lastUsedAt: now,
          },
        ],
      }),
      getRequestLogs: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            id: 'log-1',
            requestId: 'req-1',
            attempt: 1,
            cliType: 'claudeCode',
            outcome: 'failure',
            createdAt: now,
            routeRuleId: 'rule-1',
            routeRuleName: 'claudeCode / Claude 默认规则',
            siteName: 'Claude Site',
            accountName: '主账户',
            apiKeyName: 'Key-Alpha',
            statusCode: 502,
            error: 'upstream_failed',
          },
          {
            id: 'log-2',
            requestId: 'req-2',
            attempt: 1,
            cliType: 'claudeCode',
            outcome: 'success',
            createdAt: now - 1000,
            routeRuleId: 'rule-1',
            routeRuleName: 'Claude 默认规则',
            siteName: 'Claude Site',
            accountName: '主账户',
            apiKeyName: 'Key-Alpha',
            statusCode: 200,
          },
          {
            id: 'log-3',
            requestId: 'req-3',
            attempt: 1,
            cliType: 'codex',
            outcome: 'success',
            createdAt: now - 2000,
            routeRuleId: 'rule-1',
            routeRuleName: 'Claude 默认规则',
            siteName: 'Codex Site',
            accountName: '备账户',
            apiKeyName: 'Key-Beta',
            statusCode: 200,
          },
        ],
      }),
    } as NonNullable<typeof window.electronAPI.route>;

    window.electronAPI.overview = {
      getSiteDailySnapshots: vi.fn().mockResolvedValue({
        success: true,
        data: {
          'site-1': [
            {
              siteId: 'site-1',
              snapshotDate: '2026-04-24',
              capturedAt: now - 24 * 60 * 60 * 1000,
              balance: 16.1,
              todayUsage: 1.8,
              todayRequests: 14,
              todayPromptTokens: 900,
              todayCompletionTokens: 500,
              totalTokens: 1400,
            },
            {
              siteId: 'site-1',
              snapshotDate: '2026-04-25',
              capturedAt: now,
              balance: 15.5,
              todayUsage: 2.4,
              todayRequests: 18,
              todayPromptTokens: 1200,
              todayCompletionTokens: 600,
              totalTokens: 1800,
            },
          ],
          'site-2': [
            {
              siteId: 'site-2',
              snapshotDate: '2026-04-25',
              capturedAt: now,
              balance: 8.2,
              todayUsage: 5.8,
              todayRequests: 26,
              todayPromptTokens: 2400,
              todayCompletionTokens: 800,
              totalTokens: 3200,
            },
          ],
        },
      }),
    } as NonNullable<typeof window.electronAPI.overview>;

    window.electronAPI.appData = {
      onChanged: vi.fn(callback => {
        appDataChangedListener = callback;
        return () => {
          appDataChangedListener = null;
        };
      }),
    };
  });

  it('renders site and route overview panels from shared overview subtab state', async () => {
    const { rerender } = render(<DataOverviewPage />);

    expect(screen.queryByRole('button', { name: '站点数据' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '路由数据' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刷新' })).not.toBeInTheDocument();
    expect(screen.getByText('每日签到概览')).toBeInTheDocument();
    expect(screen.getByText('站点资源概览')).toBeInTheDocument();
    expect(screen.getByText('站点历史趋势')).toBeInTheDocument();
    expect(screen.queryByText('运营趋势')).not.toBeInTheDocument();
    expect(screen.queryByText('最近异常')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(window.electronAPI.route?.getAnalyticsSummary).toHaveBeenCalled();
      expect(window.electronAPI.route?.getObjectStats).toHaveBeenCalled();
    });

    expect(screen.getByText('可用站点数')).toBeInTheDocument();
    expect(screen.getByText('展示站点 2 个 / 模型 2 个')).toBeInTheDocument();
    expect(screen.getByText('今日签到收益')).toBeInTheDocument();
    expect(screen.getByText('今日请求 44 · 今日 Tokens 5.0K')).toBeInTheDocument();
    expect(screen.getByText('已签 1 个 / 待签 1 个')).toBeInTheDocument();
    expect(screen.getAllByText(/已签到/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('待签 1/1').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$1\.00/).length).toBeGreaterThan(0);
    expect(screen.queryByText('可签到站点')).not.toBeInTheDocument();
    expect(screen.getAllByText('Codex Site').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Claude Site').length).toBeGreaterThan(0);
    expect(screen.queryByText('站点 / 账户')).not.toBeInTheDocument();
    expect(screen.queryByText('本月 / 累计')).not.toBeInTheDocument();
    expect(screen.getAllByText('1 个账户 / 1 个模型').length).toBeGreaterThan(0);
    expect(screen.getByText('请求 26 / Tokens 3.2K')).toBeInTheDocument();
    expect(screen.queryByText('Hidden Site')).not.toBeInTheDocument();
    expect(screen.getByText('近 7 日请求量 (Reqs)')).toBeInTheDocument();
    expect(screen.getAllByText(`最近记录 ${todayLabel}`).length).toBeGreaterThan(0);
    const usageTrendCard = screen.getByLabelText('近 7 日消费趋势 趋势卡片');
    expect(usageTrendCard).toHaveClass('min-h-[208px]');
    expect(
      Array.from(usageTrendCard.querySelectorAll('rect')).some(rect =>
        rect.getAttribute('class')?.includes('text-[var(--accent)]')
      )
    ).toBe(true);
    const checkinScrollRegion = screen.getByLabelText('每日签到概览滚动区域');
    expect(checkinScrollRegion).toBeInTheDocument();
    expect(checkinScrollRegion).toHaveTextContent('Claude Site');
    expect(checkinScrollRegion).toHaveTextContent('Codex Site');
    expect(checkinScrollRegion).toHaveTextContent('站点级');
    expect(checkinScrollRegion).toHaveTextContent(/本月 12\s*\/\s*累计 40/);
    expect(screen.getByRole('combobox', { name: '选择站点历史' })).toHaveDisplayValue(
      '全部站点（聚合）'
    );
    expect(
      screen.queryByText('默认显示站点聚合趋势，也可切换到单站点查看。')
    ).not.toBeInTheDocument();

    mockUIState.overviewSubtab = 'route';
    rerender(<DataOverviewPage />);

    expect(screen.getByLabelText('路由数据驾驶舱')).toBeInTheDocument();
    expect(screen.getByText('运营趋势')).toBeInTheDocument();
    expect(screen.getByText('活跃对象')).toBeInTheDocument();
    expect(screen.getByText('异常摘要')).toBeInTheDocument();
    expect(screen.getByText('最近异常')).toBeInTheDocument();
    expect(screen.getByText('按站点 / 账户 / API Key 聚合')).toBeInTheDocument();
    expect(screen.queryByText('峰值请求')).not.toBeInTheDocument();
    expect(screen.queryByText('最低成功率')).not.toBeInTheDocument();
    expect(screen.queryByText('Token 峰值')).not.toBeInTheDocument();
    expect(screen.queryByText('慢请求占比')).not.toBeInTheDocument();
    expect(screen.getByLabelText('最近异常请求滚动区域')).toBeInTheDocument();
    expect(screen.getByLabelText('路由规则洞察滚动区域')).toBeInTheDocument();
    expect(window.electronAPI.route?.getObjectStats).toHaveBeenCalledWith({
      window: '7d',
      limit: 8,
      sortBy: 'successRate',
    });
    expect(screen.queryByText(/Top\s+\d+/)).not.toBeInTheDocument();
    const primaryRuleItem = screen.getByLabelText('主要失败规则：Claude Code / claude-opus-4-6');
    expect(primaryRuleItem).toHaveTextContent(/总请求\s*12\s*失败\s*1\s*站点\s*1\s*来源\s*1/);
    expect(primaryRuleItem.querySelector('[style="width: 100%;"]')).toBeInTheDocument();
    expect(screen.getByText('Gemini CLI / gemini-2.5-pro')).toBeInTheDocument();
    expect(screen.getByText('Claude Site / 主账户 / Key-Alpha')).toBeInTheDocument();
    const activeObjectItem = screen.getByLabelText('活跃对象：Claude Site / 主账户 / Key-Alpha');
    expect(activeObjectItem).not.toHaveClass('rounded-[var(--radius-lg)]');
    expect(activeObjectItem).toHaveTextContent(/总请求\s*12\s*失败\s*1/);
    expect(activeObjectItem.querySelector('[style="width: 91.67%;"]')).toBeInTheDocument();
    expect(screen.getByText('Tokens 1.8K')).toBeInTheDocument();
    expect(screen.getByText('upstream_failed')).toBeInTheDocument();
    const recentFailureRegion = screen.getByLabelText('最近异常请求滚动区域');
    expect(within(recentFailureRegion).queryByText('claudeCode')).not.toBeInTheDocument();
    expect(
      screen.getByText('路由对象：Claude 默认规则 / Claude Site / 主账户 / Key-Alpha')
    ).toBeInTheDocument();
    expect(screen.queryByText('每日签到概览')).not.toBeInTheDocument();
  });

  it('provides header actions from shared overview subtab state', async () => {
    function HeaderActionHost() {
      const [actions, setActions] = useState<ReactNode | null>(null);

      return (
        <>
          <DataOverviewPage setPageHeaderActions={setActions} />
          <div data-testid="header-actions">{actions}</div>
        </>
      );
    }

    const { rerender } = render(<HeaderActionHost />);

    await waitFor(() => {
      expect(window.electronAPI.route?.getAnalyticsSummary).toHaveBeenCalled();
    });

    const headerActions = screen.getByTestId('header-actions');
    expect(within(headerActions).getByRole('button', { name: '刷新' })).toBeInTheDocument();
    expect(within(headerActions).queryByRole('button', { name: '24h' })).not.toBeInTheDocument();

    mockUIState.overviewSubtab = 'route';
    rerender(<HeaderActionHost />);

    await waitFor(() => {
      expect(within(headerActions).getByRole('button', { name: '24h' })).toBeInTheDocument();
    });
    expect(within(headerActions).getByRole('button', { name: '7d' })).toBeInTheDocument();
    expect(within(headerActions).getByRole('button', { name: '30d' })).toBeInTheDocument();
  });

  it('reloads overview data automatically after route overview change events', async () => {
    render(<DataOverviewPage />);

    await waitFor(() => {
      expect(window.electronAPI.route?.getAnalyticsSummary).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      appDataChangedListener?.({
        domains: ['route-overview'],
        emittedAt: Date.now(),
      });
    });

    await waitFor(() => {
      expect(window.electronAPI.route?.getAnalyticsSummary).toHaveBeenCalledTimes(2);
      expect(window.electronAPI.route?.getObjectStats).toHaveBeenCalledTimes(2);
      expect(window.electronAPI.overview?.getSiteDailySnapshots).toHaveBeenCalledTimes(2);
    });
  });

  it('uses live today request totals when snapshots lag behind current site metrics', async () => {
    window.electronAPI.overview = {
      ...window.electronAPI.overview,
      getSiteDailySnapshots: vi.fn().mockResolvedValue({
        success: true,
        data: {
          'site-1': [
            {
              siteId: 'site-1',
              snapshotDate: '2026-04-24',
              capturedAt: now - 24 * 60 * 60 * 1000,
              balance: 16.1,
              todayUsage: 1.8,
              todayRequests: 12,
              todayPromptTokens: 900,
              todayCompletionTokens: 500,
              totalTokens: 1400,
            },
          ],
          'site-2': [
            {
              siteId: 'site-2',
              snapshotDate: '2026-04-24',
              capturedAt: now - 24 * 60 * 60 * 1000,
              balance: 8.2,
              todayUsage: 5.8,
              todayRequests: 18,
              todayPromptTokens: 2200,
              todayCompletionTokens: 800,
              totalTokens: 3000,
            },
          ],
        },
      }),
    } as NonNullable<typeof window.electronAPI.overview>;

    render(<DataOverviewPage />);

    const requestTrendCard = await screen.findByLabelText('近 7 日请求量 (Reqs) 趋势卡片');

    await waitFor(() => {
      expect(within(requestTrendCard).getByText('44')).toBeInTheDocument();
      expect(within(requestTrendCard).getByText(`最近记录 ${todayLabel}`)).toBeInTheDocument();
    });
  });

  it('truncates long site names in checkin rows to seven chinese-character widths', async () => {
    const originalSiteName = mockConfig.sites[0].name;
    mockConfig.sites[0].name = '一二三四五六七八九站点';

    try {
      render(<DataOverviewPage />);

      await waitFor(() => {
        expect(window.electronAPI.route?.getAnalyticsSummary).toHaveBeenCalled();
      });

      const checkinScrollRegion = screen.getByLabelText('每日签到概览滚动区域');
      expect(within(checkinScrollRegion).getByText('一二三四五六七…')).toBeInTheDocument();
      expect(
        within(checkinScrollRegion).queryByText('一二三四五六七八九站点')
      ).not.toBeInTheDocument();
    } finally {
      mockConfig.sites[0].name = originalSiteName;
    }
  });
});
