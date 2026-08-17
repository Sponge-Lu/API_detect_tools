import { useState, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataOverviewPage } from '../renderer/pages/DataOverviewPage';
import type { Config } from '../renderer/App';
import type { RouteAnalyticsBucket } from '../shared/types/route-proxy';
import { buildSiteOverviewMetrics } from '../renderer/utils/siteOverview';
import { computeLatencyPercentiles } from '../renderer/utils/routeLatency';

const now = Date.now();

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
        api_keys: [{ id: 'key-alpha', name: 'Key-Alpha' }],
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
        api_keys: [
          { id: 'key-beta', name: 'Key-Beta' },
          { id: 'key-gamma', name: 'Key-Gamma' },
        ],
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
      id: 'site-negative',
      name: 'Debt Site',
      url: 'https://debt.example.com',
      enabled: true,
      cached_data: {
        balance: -5,
        today_usage: 0,
        today_prompt_tokens: 0,
        today_completion_tokens: 0,
        today_requests: 0,
        last_refresh: now,
        models: [],
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

const mockSetConfig = vi.fn();

vi.mock('../renderer/store/configStore', () => ({
  useConfigStore: (
    selector: (state: { config: typeof mockConfig; setConfig: typeof mockSetConfig }) => unknown
  ) => selector({ config: mockConfig, setConfig: mockSetConfig }),
}));

vi.mock('../renderer/store/customCliConfigStore', () => ({
  useCustomCliConfigStore: (selector: (state: { configs: never[] }) => unknown) =>
    selector({ configs: [] }),
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
  type AppDataChangedListener = (payload: {
    domains: Array<'site-config' | 'site-overview' | 'route-overview'>;
    emittedAt: number;
  }) => void;
  let appDataChangedListeners: AppDataChangedListener[] = [];

  beforeEach(() => {
    appDataChangedListeners = [];
    mockSetConfig.mockReset();
    mockUIState.activeTab = 'overview';
    mockUIState.overviewSubtab = 'site';
    mockUIState.setOverviewSubtab.mockReset();
    const routeSummaryData = {
      totalRequests: 44,
      successCount: 39,
      failureCount: 5,
      neutralCount: 0,
      successRate: 88.6,
      promptTokens: 3600,
      completionTokens: 1400,
      totalTokens: 5000,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cachedTokens: 0,
    };
    const routeDistributionData = {
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
          cliType: 'codex',
          routeRuleId: 'rule-4',
          canonicalModel: 'gpt-4.1-mini',
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
    };
    window.electronAPI.route = {
      ...(window.electronAPI.route || {}),
      getAnalyticsSummary: vi.fn().mockResolvedValue({
        success: true,
        data: routeSummaryData,
      }),
      getAnalyticsDistribution: vi.fn().mockResolvedValue({
        success: true,
        data: routeDistributionData,
      }),
      getAnalyticsOverview: vi.fn().mockResolvedValue({
        success: true,
        data: {
          summary: routeSummaryData,
          distribution: routeDistributionData,
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
        data: [],
      }),
      getConfig: vi.fn().mockResolvedValue({
        success: true,
        data: {
          routePathStates: {
            'rule-1:site-1:account-1:key-alpha': {
              routeRuleId: 'rule-1',
              siteId: 'site-1',
              accountId: 'account-1',
              apiKeyId: 'key-alpha',
              cliType: 'claudeCode',
              canonicalModel: 'claude-opus-4-6',
              windowStartedAt: now - 60_000,
              windowRequestCount: 12,
              windowSuccessCount: 11,
              successRate: 0.9167,
              lastOutcome: 'failure',
              updatedAt: now,
            },
            'rule-1:site-2:account-2:key-beta': {
              routeRuleId: 'rule-1',
              siteId: 'site-2',
              accountId: 'account-2',
              apiKeyId: 'key-beta',
              cliType: 'codex',
              canonicalModel: 'gpt-4.1-mini',
              windowStartedAt: now - 60_000,
              windowRequestCount: 6,
              windowSuccessCount: 6,
              successRate: 1,
              lastOutcome: 'success',
              updatedAt: now,
            },
          },
        },
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

    window.electronAPI.loadConfig = vi.fn().mockResolvedValue(mockConfig as Config);
    window.electronAPI.detectSite = vi.fn();

    window.electronAPI.appData = {
      onChanged: vi.fn(callback => {
        appDataChangedListeners.push(callback);
        return () => {
          appDataChangedListeners = appDataChangedListeners.filter(
            listener => listener !== callback
          );
        };
      }),
    };
  });

  it('filters negative account balances when building site overview metrics', () => {
    const metrics = buildSiteOverviewMetrics({
      sites: [
        {
          id: 'site-accounted',
          name: 'Accounted Site',
          url: 'https://accounted.example.com',
          api_key: '',
          enabled: true,
        },
      ],
      accounts: [
        {
          id: 'account-positive',
          site_id: 'site-accounted',
          account_name: '正余额账户',
          user_id: 'user-1',
          access_token: 'token-1',
          auth_source: 'manual',
          status: 'active',
          cached_data: { balance: 12 },
          created_at: now,
          updated_at: now,
        },
        {
          id: 'account-negative',
          site_id: 'site-accounted',
          account_name: '负余额账户',
          user_id: 'user-2',
          access_token: 'token-2',
          auth_source: 'manual',
          status: 'active',
          cached_data: { balance: -7 },
          created_at: now,
          updated_at: now,
        },
      ],
      settings: {
        timeout: 30,
        concurrent: false,
        show_disabled: true,
      },
    } satisfies Config);

    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.balance).toBe(12);
  });

  it('renders the classic dashboard overview layout', async () => {
    render(<DataOverviewPage />);

    expect(screen.queryByRole('button', { name: '站点数据' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '路由数据' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刷新' })).not.toBeInTheDocument();

    const dashboard = screen.getByLabelText('数据总览驾驶舱');
    expect(dashboard).toHaveAttribute('data-route-layout', 'classic-dashboard');
    expect(document.querySelector('[data-overview-active-view="merged"]')).toHaveClass(
      'flex',
      'min-h-0',
      'flex-col',
      'overflow-hidden'
    );
    expect(screen.getByText('运行趋势')).toBeInTheDocument();
    expect(screen.getByText('模型分布')).toBeInTheDocument();
    expect(screen.getByText('通道分布')).toBeInTheDocument();
    expect(screen.getByText('7d 请求热力')).toBeInTheDocument();
    expect(screen.getByText('站点汇总')).toBeInTheDocument();
    expect(screen.queryByText('模型热力分布')).not.toBeInTheDocument();
    expect(screen.queryByText('通道健康散点矩阵')).not.toBeInTheDocument();
    expect(screen.queryByText('站点历史趋势')).not.toBeInTheDocument();
    expect(screen.queryByText('模型 → 通道流向')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(window.electronAPI.overview?.getSiteDailySnapshots).toHaveBeenCalled();
      expect(window.electronAPI.route?.getAnalyticsOverview).toHaveBeenCalled();
    });
    expect(window.electronAPI.route?.getAnalyticsSummary).not.toHaveBeenCalled();
    expect(window.electronAPI.route?.getAnalyticsDistribution).not.toHaveBeenCalled();

    expect(screen.getByText('路由请求量')).toBeInTheDocument();
    expect(screen.getByText('路由成功率')).toBeInTheDocument();
    expect(screen.getByText('P90 延迟')).toBeInTheDocument();
    expect(screen.getByText('首字 P95')).toBeInTheDocument();
    expect(screen.getByText('Token 消耗')).toBeInTheDocument();
    expect(screen.getByText('活跃模型数')).toBeInTheDocument();
    expect(screen.getByText('站点数')).toBeInTheDocument();
    expect(screen.getByText('总余额')).toBeInTheDocument();
    expect(screen.getByText('今日消费')).toBeInTheDocument();
    expect(screen.getByText('签到')).toBeInTheDocument();
    expect(screen.getByText('$23.70')).toBeInTheDocument();
    expect(screen.getByText('已签 1 / 待签 1')).toBeInTheDocument();
    expect(screen.getByText(/输入 3\.6K\s*\/\s*输出 1\.4K/)).toBeInTheDocument();

    const checkinScrollRegion = screen.getByLabelText('每日签到概览滚动区域');
    expect(checkinScrollRegion).toBeInTheDocument();
    expect(checkinScrollRegion).toHaveTextContent('Claude Site');
    expect(checkinScrollRegion).toHaveTextContent('Codex Site');
    expect(checkinScrollRegion).toHaveClass(
      'app-scrollbar-none',
      'min-h-0',
      'flex-1',
      'overflow-y-auto'
    );
    expect(checkinScrollRegion.parentElement?.parentElement).toHaveClass('overflow-hidden');
    expect(checkinScrollRegion.parentElement?.parentElement).not.toHaveClass('overflow-y-auto');
    expect(checkinScrollRegion.className).not.toContain('pr-4');
    expect(checkinScrollRegion.className).not.toContain('[scrollbar-gutter:stable]');

    expect(document.querySelector('[data-overview-metric-grid="classic"]')).toHaveClass(
      'grid-cols-6'
    );
    expect(document.querySelector('[data-testid="overview-model-donut"]')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="overview-channel-bars"]')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="overview-history-heat"]')).toBeInTheDocument();
    const heatGrid = document.querySelector('[data-testid="overview-heat-grid"]');
    expect(heatGrid).toBeInTheDocument();
    // 完整网格为 列数×12（14 列=168 / 15 列=180）；其中显示格 (visible) 恒为 168
    const heatChildren = Array.from(heatGrid?.children ?? []);
    const visibleHeatCells = heatChildren.filter(
      node => (node as HTMLElement).style.background !== 'transparent'
    );
    expect(visibleHeatCells).toHaveLength(168);
    expect(document.querySelector('[data-testid="overview-site-summary"]')).toBeInTheDocument();
    expect(screen.queryByText('通道健康矩阵')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-scatter-success-label="true"]')).toHaveLength(0);

    const trendCard = screen.getByLabelText('运行趋势图');
    expect(trendCard).toHaveClass('min-h-0', 'col-span-2');
    expect(trendCard).not.toHaveClass('flex-1');
    // 趋势行与底行同为三等分网格：趋势占 2 列、通道分布占 1 列，保证通道分布与底行卡片等宽
    expect(trendCard.parentElement).toHaveClass('grid', 'grid-cols-3', 'overflow-hidden');
    expect(trendCard.parentElement?.parentElement).toHaveClass(
      'grid',
      'grid-rows-[minmax(0,1.0625fr)_minmax(0,0.9375fr)]',
      'overflow-hidden'
    );
    expect(document.querySelector('[data-testid="overview-endpoint-donut"]')).toBeInTheDocument();
    expect(screen.getByTestId('overview-channel-bars').parentElement).toBe(trendCard.parentElement);
    expect(screen.getByTestId('overview-model-donut').parentElement).toHaveClass(
      'grid-cols-3',
      'overflow-hidden'
    );
    expect(screen.getByTestId('overview-endpoint-donut').parentElement).toBe(
      screen.getByTestId('overview-model-donut').parentElement
    );

    expect(document.querySelector('[data-route-content-scroll="true"]')).toHaveClass('pb-2.5');
    expect(document.querySelector('[data-trend-chart-frame="true"]')).toHaveClass(
      '-mx-2',
      'px-2.5'
    );

    const trendPointCount = Number(
      screen.getByLabelText('运行趋势图').getAttribute('data-trend-point-count')
    );
    expect(document.querySelectorAll('[data-trend-axis-label="true"]')).toHaveLength(
      trendPointCount
    );
    for (const seriesName of ['requests', 'success-rate']) {
      expect(document.querySelector(`[data-trend-series="${seriesName}"]`)).toBeInTheDocument();
    }
    expect(document.querySelector('[data-trend-series="ttfb-p95"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-trend-legend="ttfb-p95"]')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('选择运行趋势范围')).not.toBeInTheDocument();
    expect(document.querySelector('[data-trend-scope-select="true"]')).not.toBeInTheDocument();
  });

  it('provides merged header actions', async () => {
    function HeaderActionHost() {
      const [actions, setActions] = useState<ReactNode | null>(null);

      return (
        <>
          <DataOverviewPage setPageHeaderActions={setActions} />
          <div data-testid="header-actions">{actions}</div>
        </>
      );
    }

    render(<HeaderActionHost />);

    await waitFor(() => {
      expect(window.electronAPI.overview?.getSiteDailySnapshots).toHaveBeenCalled();
      expect(window.electronAPI.route?.getAnalyticsOverview).toHaveBeenCalled();
    });

    const headerActions = screen.getByTestId('header-actions');
    expect(within(headerActions).getByRole('button', { name: '刷新' })).toBeInTheDocument();
    expect(within(headerActions).queryByRole('button', { name: '24h' })).not.toBeInTheDocument();
    expect(within(headerActions).queryByRole('button', { name: '7d' })).not.toBeInTheDocument();
    expect(within(headerActions).queryByRole('button', { name: '30d' })).not.toBeInTheDocument();
  });

  it('reloads persisted site config on mount, site changes, and manual refresh without detection', async () => {
    function HeaderActionHost() {
      const [actions, setActions] = useState<ReactNode | null>(null);
      return (
        <>
          <DataOverviewPage setPageHeaderActions={setActions} />
          <div data-testid="header-actions">{actions}</div>
        </>
      );
    }

    render(<HeaderActionHost />);

    await waitFor(() => {
      expect(window.electronAPI.loadConfig).toHaveBeenCalledTimes(1);
      expect(mockSetConfig).toHaveBeenCalledWith(mockConfig);
    });

    await act(async () => {
      for (const listener of appDataChangedListeners) {
        listener({ domains: ['site-overview'], emittedAt: Date.now() });
      }
    });

    await waitFor(() => {
      expect(window.electronAPI.loadConfig).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(
      within(screen.getByTestId('header-actions')).getByRole('button', { name: '刷新' })
    );

    await waitFor(() => {
      expect(window.electronAPI.loadConfig).toHaveBeenCalledTimes(3);
      expect(window.electronAPI.overview?.getSiteDailySnapshots).toHaveBeenCalledTimes(3);
    });
    expect(window.electronAPI.detectSite).not.toHaveBeenCalled();
  });

  it('keeps route trend x-axis labels in chronological order across month boundaries', async () => {
    mockUIState.overviewSubtab = 'route';

    const addDays = (timestamp: number, days: number) => {
      const date = new Date(timestamp);
      date.setDate(date.getDate() + days);
      return date.getTime();
    };
    const formatDayLabel = (timestamp: number) =>
      new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(
        new Date(timestamp)
      );
    const buildBucket = (
      bucketKey: string,
      bucketStart: number,
      requestCount: number
    ): RouteAnalyticsBucket => ({
      bucketKey,
      bucketStart,
      bucketSize: 'hour',
      cliType: 'claudeCode',
      canonicalModel: 'claude-opus-4-6',
      siteId: 'site-1',
      accountId: 'acct-1',
      requestCount,
      successCount: requestCount,
      failureCount: 0,
      neutralCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      statusCodeHistogram: { '200': requestCount },
      latencyHistogram: { '0-1000ms': requestCount },
      firstByteHistogram: { '0-200ms': requestCount },
      updatedAt: bucketStart,
    });

    const newestDay = new Date(2030, 5, 1).getTime();
    const oldestDay = addDays(newestDay, -7);
    const expectedLabels = Array.from({ length: 8 }, (_, index) =>
      formatDayLabel(addDays(oldestDay, index))
    );

    window.electronAPI.route = {
      ...window.electronAPI.route,
      getAnalyticsDistribution: vi.fn().mockResolvedValue({
        success: true,
        data: {
          buckets: [
            buildBucket('newest-day', newestDay, 2),
            buildBucket('oldest-boundary-day', oldestDay, 1),
          ],
          statusCodeHistogram: { '200': 3 },
          latencyHistogram: { '0-1000ms': 3 },
          firstByteHistogram: { '0-200ms': 3 },
        },
      }),
      getAnalyticsOverview: undefined,
    } as NonNullable<typeof window.electronAPI.route>;

    render(<DataOverviewPage />);

    const trendCard = await screen.findByLabelText('运行趋势图');

    await waitFor(() => {
      const axisLabels = Array.from(
        document.querySelectorAll('[data-trend-axis-label="true"]')
      ).map(label => label.textContent);

      expect(axisLabels).toEqual(expectedLabels);
    });
    expect(trendCard).toHaveAttribute('data-trend-point-count', '8');
  });

  it('renders success-rate and request-count y axes with aligned gridlines', async () => {
    render(<DataOverviewPage />);

    const trendCard = await screen.findByLabelText('运行趋势图');
    await waitFor(() => {
      expect(window.electronAPI.route?.getAnalyticsOverview).toHaveBeenCalled();
    });

    // 左侧为请求量轴、右侧为成功率轴
    expect(
      Array.from(trendCard.querySelectorAll('[data-trend-y-axis]')).map(axis =>
        axis.getAttribute('data-trend-y-axis')
      )
    ).toEqual(['requests', 'success-rate']);

    const successRateTicks = Array.from(
      trendCard.querySelectorAll(
        '[data-trend-y-axis="success-rate"] [data-trend-y-axis-tick="true"]'
      )
    ).map(tick => tick.textContent);
    expect(successRateTicks).toEqual(['100%', '50%', '0%']);

    // 默认 7d 窗口将 5 个测试桶合并到同一天：12+20+8+6+4=50 次请求
    const requestTicks = Array.from(
      trendCard.querySelectorAll('[data-trend-y-axis="requests"] [data-trend-y-axis-tick="true"]')
    ).map(tick => tick.textContent);
    expect(requestTicks).toEqual(['50', '25', '0']);

    expect(trendCard.querySelectorAll('[data-trend-guide="true"]')).toHaveLength(3);

    // 纵轴与绘图区保留间距，顶部参考线距卡片上边沿的留白与横轴标签距下边沿的留白对称
    const plotRow = trendCard.querySelector('[data-trend-y-axis="requests"]')?.parentElement;
    expect(plotRow).toHaveClass('gap-3', 'pt-1');

    // 横纵轴刻度使用更醒目的字号与颜色
    expect(trendCard.querySelector('[data-trend-y-axis="requests"]')).toHaveClass(
      'text-[10px]',
      'text-[var(--text-secondary)]'
    );
    expect(plotRow?.nextElementSibling).toHaveClass('text-[10px]', 'text-[var(--text-secondary)]');

    // 柱体几何被钳制在绘图区 viewBox（宽 160）内，不向纵轴方向溢出
    const barRects = Array.from(trendCard.querySelectorAll('rect[data-trend-bar-point-index]'));
    expect(barRects.length).toBeGreaterThan(0);
    for (const rect of barRects) {
      const x = Number.parseFloat(rect.getAttribute('x') ?? '');
      const width = Number.parseFloat(rect.getAttribute('width') ?? '');
      expect(x).toBeGreaterThanOrEqual(-0.001);
      expect(x + width).toBeLessThanOrEqual(160.001);
    }
  });

  it('renders model donut and channel bars instead of heatmap filters', async () => {
    render(<DataOverviewPage />);

    await waitFor(() => {
      expect(window.electronAPI.route?.getAnalyticsOverview).toHaveBeenCalled();
    });
    expect(document.querySelector('[data-testid="overview-model-donut"]')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="overview-channel-bars"]')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '模型：claude-opus-4-6' })).not.toBeInTheDocument();
    expect(
      document.querySelector('svg[aria-label="模型→通道 Sankey 流图 SVG"]')
    ).not.toBeInTheDocument();
  });

  it('counts every active route model while limiting the donut to eight items', async () => {
    const buckets = Array.from(
      { length: 10 },
      (_, index): RouteAnalyticsBucket => ({
        bucketKey: `model-${index}`,
        bucketStart: now,
        bucketSize: 'hour',
        cliType: 'codex',
        canonicalModel: `model-${index}`,
        siteId: 'site-1',
        accountId: 'acct-1',
        requestCount: 10 - index,
        successCount: 10 - index,
        failureCount: 0,
        neutralCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        statusCodeHistogram: {},
        latencyHistogram: {},
        firstByteHistogram: { '0-200ms': 10 - index },
        updatedAt: now,
      })
    );
    window.electronAPI.route = {
      ...window.electronAPI.route,
      getAnalyticsOverview: vi.fn().mockResolvedValue({
        success: true,
        data: {
          summary: {
            totalRequests: 55,
            successCount: 55,
            failureCount: 0,
            neutralCount: 0,
            successRate: 100,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            cachedTokens: 0,
          },
          distribution: {
            buckets,
            statusCodeHistogram: {},
            latencyHistogram: {},
            firstByteHistogram: { '0-200ms': 55 },
          },
        },
      }),
    } as NonNullable<typeof window.electronAPI.route>;

    render(<DataOverviewPage />);

    const activeModelLabel = await screen.findByText('活跃模型数');
    expect(activeModelLabel.parentElement?.parentElement).toHaveTextContent('10');
    expect(screen.getByTestId('overview-model-donut').querySelectorAll('svg circle')).toHaveLength(
      9
    );
  });

  it('keeps channels without first-byte samples in channel distribution', async () => {
    const bucket: RouteAnalyticsBucket = {
      bucketKey: 'no-ttfb',
      bucketStart: now,
      bucketSize: 'hour',
      cliType: 'codex',
      canonicalModel: 'gpt-no-ttfb',
      siteId: 'site-1',
      accountId: 'acct-no-ttfb',
      requestCount: 3,
      successCount: 0,
      failureCount: 0,
      neutralCount: 3,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      statusCodeHistogram: {},
      latencyHistogram: {},
      firstByteHistogram: {},
      updatedAt: now,
    };
    window.electronAPI.route = {
      ...window.electronAPI.route,
      getAnalyticsOverview: vi.fn().mockResolvedValue({
        success: true,
        data: {
          summary: {
            totalRequests: 3,
            successCount: 0,
            failureCount: 0,
            neutralCount: 3,
            successRate: 0,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            cachedTokens: 0,
          },
          distribution: {
            buckets: [bucket],
            statusCodeHistogram: {},
            latencyHistogram: {},
            firstByteHistogram: {},
          },
        },
      }),
    } as NonNullable<typeof window.electronAPI.route>;

    render(<DataOverviewPage />);

    const channelCard = await screen.findByTestId('overview-channel-bars');
    expect(within(channelCard).getByTitle('Claude Site / acct-no-ttfb')).toBeInTheDocument();
    expect(within(channelCard).getByText('3 · 0%')).toBeInTheDocument();
  });

  it('uses per-period P90 latency values for the P90 sparkline', async () => {
    const histograms = [{ '0-1000ms': 20 }, { '0-1000ms': 2, '1000-3000ms': 18 }];
    const buckets = histograms.map(
      (latencyHistogram, index): RouteAnalyticsBucket => ({
        bucketKey: `latency-${index}`,
        bucketStart: now - (1 - index) * 24 * 60 * 60 * 1000,
        bucketSize: 'hour',
        cliType: 'codex',
        canonicalModel: 'latency-model',
        siteId: 'site-1',
        accountId: 'acct-1',
        requestCount: 20,
        successCount: 20,
        failureCount: 0,
        neutralCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        statusCodeHistogram: {},
        latencyHistogram,
        firstByteHistogram: {},
        updatedAt: now,
      })
    );
    window.electronAPI.route = {
      ...window.electronAPI.route,
      getAnalyticsOverview: vi.fn().mockResolvedValue({
        success: true,
        data: {
          summary: {
            totalRequests: 40,
            successCount: 40,
            failureCount: 0,
            neutralCount: 0,
            successRate: 100,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            cachedTokens: 0,
          },
          distribution: {
            buckets,
            statusCodeHistogram: {},
            latencyHistogram: { '0-1000ms': 22, '1000-3000ms': 18 },
            firstByteHistogram: {},
          },
        },
      }),
    } as NonNullable<typeof window.electronAPI.route>;

    render(<DataOverviewPage />);

    const p90Card = await screen.findByLabelText('P90 延迟 KPI');
    const values = p90Card.getAttribute('data-sparkline-values')?.split(',') || [];
    const expected = histograms.map(histogram => String(computeLatencyPercentiles(histogram).p90));
    expect(values.slice(-2)).toEqual(expected);
  });

  it('reloads route overview data automatically after route overview change events', async () => {
    mockUIState.overviewSubtab = 'route';
    render(<DataOverviewPage />);

    await waitFor(() => {
      expect(window.electronAPI.route?.getAnalyticsOverview).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      for (const listener of appDataChangedListeners) {
        listener({ domains: ['route-overview'], emittedAt: Date.now() });
      }
    });

    await waitFor(() => {
      expect(window.electronAPI.route?.getAnalyticsOverview).toHaveBeenCalledTimes(2);
    });
    expect(window.electronAPI.route?.getAnalyticsSummary).not.toHaveBeenCalled();
    expect(window.electronAPI.route?.getAnalyticsDistribution).not.toHaveBeenCalled();
    expect(window.electronAPI.route?.getObjectStats).not.toHaveBeenCalled();
    expect(window.electronAPI.overview?.getSiteDailySnapshots).toHaveBeenCalledTimes(1);
  });

  it('falls back to separate route analytics calls when the overview bridge is unavailable', async () => {
    mockUIState.overviewSubtab = 'route';
    window.electronAPI.route = {
      ...window.electronAPI.route,
      getAnalyticsOverview: undefined,
    } as NonNullable<typeof window.electronAPI.route>;

    render(<DataOverviewPage />);

    await waitFor(() => {
      expect(window.electronAPI.route?.getAnalyticsSummary).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.route?.getAnalyticsDistribution).toHaveBeenCalledTimes(1);
    });
  });

  it('uses live today request totals in merged site KPIs', async () => {
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
        },
      }),
    } as NonNullable<typeof window.electronAPI.overview>;

    render(<DataOverviewPage />);

    await waitFor(() => {
      expect(window.electronAPI.overview?.getSiteDailySnapshots).toHaveBeenCalled();
    });
    const todayUsageValue = screen.getByTitle('请求 44 · Tokens 5.0K');
    expect(todayUsageValue).toHaveTextContent('$8.20');
    expect(screen.getByText('今日消费')).toBeInTheDocument();
  });

  it('renders route trend markers as fixed-size circles', async () => {
    window.electronAPI.route = {
      ...window.electronAPI.route,
      getAnalyticsDistribution: vi.fn().mockResolvedValue({
        success: true,
        data: {
          buckets: [
            {
              bucketKey: 'route-day-1',
              bucketStart: now - 2 * 24 * 60 * 60 * 1000,
              bucketSize: 'day',
              cliType: 'claudeCode',
              routeRuleId: 'rule-1',
              canonicalModel: 'claude-opus-4-6',
              siteId: 'site-1',
              accountId: 'acct-1',
              requestCount: 10,
              successCount: 8,
              failureCount: 2,
              neutralCount: 0,
              promptTokens: 1000,
              completionTokens: 500,
              totalTokens: 1500,
              statusCodeHistogram: { '200': 8, '502': 2 },
              latencyHistogram: { '0-1000ms': 10 },
              firstByteHistogram: { '0-200ms': 10 },
              updatedAt: now - 2 * 24 * 60 * 60 * 1000,
            },
            {
              bucketKey: 'route-day-2',
              bucketStart: now - 24 * 60 * 60 * 1000,
              bucketSize: 'day',
              cliType: 'codex',
              routeRuleId: 'rule-2',
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
              latencyHistogram: { '0-1000ms': 20 },
              firstByteHistogram: { '0-200ms': 20 },
              updatedAt: now - 24 * 60 * 60 * 1000,
            },
          ],
          statusCodeHistogram: { '200': 26, '429': 2, '502': 2 },
          latencyHistogram: { '0-1000ms': 30 },
          firstByteHistogram: { '0-200ms': 30 },
        },
      }),
      getAnalyticsOverview: undefined,
    } as NonNullable<typeof window.electronAPI.route>;

    render(<DataOverviewPage />);

    const trendCard = await screen.findByLabelText('运行趋势图');
    await waitFor(() => {
      expect(window.electronAPI.route?.getAnalyticsDistribution).toHaveBeenCalled();
    });

    const routeMarkers = Array.from(
      trendCard.querySelectorAll('span[aria-hidden="true"][class*="h-[5.5px]"]')
    ) as HTMLElement[];
    const routeMarkerLefts = routeMarkers.map(marker => Number.parseFloat(marker.style.left));

    expect(routeMarkers.length).toBeGreaterThan(1);
    expect(trendCard.querySelector('circle')).not.toBeInTheDocument();
    expect(routeMarkers.every(marker => marker.className.includes('h-[5.5px]'))).toBe(true);
    expect(Math.min(...routeMarkerLefts)).toBeGreaterThan(0);
    expect(Math.max(...routeMarkerLefts)).toBeLessThan(100);

    const routeStrokePaths = Array.from(trendCard.querySelectorAll('path[stroke="currentColor"]'));
    expect(routeStrokePaths.length).toBeGreaterThan(0);
    expect(
      routeStrokePaths.every(path => path.getAttribute('vector-effect') === 'non-scaling-stroke')
    ).toBe(true);
  });

  it('truncates long site names in checkin rows to seven chinese-character widths', async () => {
    const originalSiteName = mockConfig.sites[0].name;
    mockConfig.sites[0].name = '一二三四五六七八九站点';

    try {
      render(<DataOverviewPage />);

      await waitFor(() => {
        expect(window.electronAPI.overview?.getSiteDailySnapshots).toHaveBeenCalled();
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
