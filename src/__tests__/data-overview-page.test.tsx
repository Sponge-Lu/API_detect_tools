import { useState, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataOverviewPage } from '../renderer/pages/DataOverviewPage';
import type { Config } from '../renderer/App';
import type { RouteAnalyticsBucket } from '../shared/types/route-proxy';
import { buildSiteOverviewMetrics } from '../renderer/utils/siteOverview';

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

vi.mock('../renderer/store/configStore', () => ({
  useConfigStore: (selector: (state: { config: typeof mockConfig }) => unknown) =>
    selector({ config: mockConfig }),
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
              cliType: 'geminiCli',
              canonicalModel: 'gemini-2.5-pro',
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

    window.electronAPI.appData = {
      onChanged: vi.fn(callback => {
        appDataChangedListener = callback;
        return () => {
          appDataChangedListener = null;
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

  it('renders the merged site and route overview dashboard', async () => {
    render(<DataOverviewPage />);

    expect(screen.queryByRole('button', { name: '站点数据' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '路由数据' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刷新' })).not.toBeInTheDocument();

    const dashboard = screen.getByLabelText('数据总览驾驶舱');
    expect(dashboard).toHaveAttribute('data-route-layout', 'merged-compact');
    expect(screen.getByText('每日签到概览')).toBeInTheDocument();
    expect(screen.getByText('运行趋势')).toBeInTheDocument();
    expect(screen.getByText('模型热力分布')).toBeInTheDocument();
    expect(screen.getByText('通道健康散点矩阵')).toBeInTheDocument();
    expect(screen.queryByText('站点资源概览')).not.toBeInTheDocument();
    expect(screen.queryByText('站点历史趋势')).not.toBeInTheDocument();
    expect(screen.queryByText('模型 → 通道流向')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(window.electronAPI.overview?.getSiteDailySnapshots).toHaveBeenCalled();
      expect(window.electronAPI.route?.getAnalyticsOverview).toHaveBeenCalled();
    });
    expect(window.electronAPI.route?.getAnalyticsSummary).not.toHaveBeenCalled();
    expect(window.electronAPI.route?.getAnalyticsDistribution).not.toHaveBeenCalled();

    expect(screen.getByText('可用站点数')).toBeInTheDocument();
    expect(screen.getByText('展示 3 / 模型 2')).toBeInTheDocument();
    const totalBalanceMetric = screen.getByText('站点总余额').parentElement;
    if (!totalBalanceMetric) {
      throw new Error('Missing site total balance metric');
    }
    expect(totalBalanceMetric).toHaveTextContent('$23.70');
    expect(totalBalanceMetric).not.toHaveTextContent('$18.70');
    expect(screen.getByText('今日签到收益')).toBeInTheDocument();
    expect(screen.getByText('请求 44 · Tokens 5.0K')).toBeInTheDocument();
    expect(screen.getByText('已签 1 / 待签 1')).toBeInTheDocument();
    expect(screen.getAllByText(/已签到/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('待签 1/1').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$1\.00/).length).toBeGreaterThan(0);
    expect(screen.queryByText('可签到站点')).not.toBeInTheDocument();
    const checkinScrollRegion = screen.getByLabelText('每日签到概览滚动区域');
    expect(checkinScrollRegion).toBeInTheDocument();
    expect(checkinScrollRegion).toHaveTextContent('Claude Site');
    expect(checkinScrollRegion).toHaveTextContent('Codex Site');
    expect(checkinScrollRegion).toHaveTextContent('站点级');
    expect(checkinScrollRegion).toHaveTextContent(/本月 12\s*\/\s*累计 40/);

    expect(screen.getByText('首字响应 / 会话时间')).toBeInTheDocument();
    const responseKpi = screen.getByLabelText('首字响应 / 会话时间 KPI');
    expect(within(responseKpi).queryByText(/P95|P99/)).not.toBeInTheDocument();
    expect(screen.queryByText('延迟分位数')).not.toBeInTheDocument();
    expect(screen.queryByText('活跃对象')).not.toBeInTheDocument();
    expect(screen.queryByText('通道健康矩阵')).not.toBeInTheDocument();
    expect(screen.getAllByText('Codex Site / acct-2 / Key-Beta').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-scatter-success-label="true"]')).toHaveLength(5);
    expect(document.querySelectorAll('[data-scatter-inline-label="true"]')).toHaveLength(0);

    const scatterGridLines = Array.from(
      document.querySelectorAll('[data-scatter-grid-line="true"]')
    );
    expect(scatterGridLines.length).toBeGreaterThan(0);
    expect(scatterGridLines.some(line => line.getAttribute('x1') === line.getAttribute('x2'))).toBe(
      true
    );
    expect(scatterGridLines.some(line => line.getAttribute('y1') === line.getAttribute('y2'))).toBe(
      true
    );
    expect(scatterGridLines.every(line => line.getAttribute('opacity') === '0.85')).toBe(true);
    expect(screen.getByText('60s+')).toBeInTheDocument();
    expect(screen.queryByText('120s+')).not.toBeInTheDocument();

    expect(document.querySelector('[data-overview-metric-grid="merged"]')).toHaveClass(
      'xl:grid-cols-8'
    );
    expect(screen.getByRole('region', { name: '每日签到概览' })).toHaveClass('h-[260px]');
    expect(screen.getByLabelText('运行趋势图')).toHaveClass('h-[260px]');
    expect(document.querySelector('[data-route-heatmap-card="true"]')).toHaveClass('h-[260px]');
    expect(document.querySelector('[data-route-third-row-card="scatter"]')).toHaveClass('h-[260px]');
    expect(document.querySelector('[data-route-content-scroll="true"]')).toHaveClass('pb-3');
    expect(document.querySelector('[data-trend-chart-frame="true"]')).toHaveClass('-mx-2', 'px-5');

    const trendPointCount = Number(
      screen.getByLabelText('运行趋势图').getAttribute('data-trend-point-count')
    );
    expect(document.querySelectorAll('[data-trend-axis-label="true"]')).toHaveLength(
      trendPointCount
    );
    const failureMarkers = Array.from(
      document.querySelectorAll('[data-trend-failure-marker="true"]')
    ) as HTMLElement[];
    expect(failureMarkers.length).toBeGreaterThan(0);
    const trendAxisLabels = Array.from(
      document.querySelectorAll('[data-trend-axis-label="true"]')
    ) as HTMLElement[];
    const trendAxisLefts = trendAxisLabels.map(label => Number.parseFloat(label.style.left));
    for (const seriesName of ['requests', 'success-rate', 'ttfb-p95']) {
      const series = document.querySelector(`[data-trend-series="${seriesName}"]`);
      expect(series).toBeInTheDocument();
      const seriesLefts = (series?.getAttribute('data-trend-point-lefts') || '')
        .split(',')
        .filter(Boolean)
        .map(value => Number.parseFloat(value));
      expect(seriesLefts).toEqual(trendAxisLefts.map(value => Number(value.toFixed(2))));
    }
    const successRateSeries = document.querySelector('[data-trend-series="success-rate"]');
    expect(successRateSeries?.querySelector('path[fill="currentColor"]')).not.toBeInTheDocument();
    expect(
      successRateSeries
        ?.querySelector('path[stroke="currentColor"]')
        ?.getAttribute('stroke-dasharray')
    ).toBeNull();
    expect(
      document
        .querySelector('[data-trend-legend="success-rate"] [data-trend-legend-line]')
        ?.getAttribute('data-trend-legend-line')
    ).toBe('solid');
    expect(
      document
        .querySelector('[data-trend-legend="ttfb-p95"] [data-trend-legend-line]')
        ?.getAttribute('data-trend-legend-line')
    ).toBe('dashed');
    const requestSeries = document.querySelector('[data-trend-series="requests"]');
    const requestBars = Array.from(
      requestSeries?.querySelectorAll('[data-trend-bar-center-left]') || []
    );
    const requestBarIndexes = requestBars.map(bar =>
      Number(bar.getAttribute('data-trend-bar-point-index'))
    );
    expect(requestBarIndexes.length).toBeGreaterThan(0);
    expect(screen.queryByText('快又稳')).not.toBeInTheDocument();
    expect(screen.getByText(/输入 3\.6K\s*\/\s*输出 1\.4K/)).toBeInTheDocument();
    const trendScopeSelect = screen.getByLabelText('选择运行趋势范围');
    expect(trendScopeSelect).toHaveDisplayValue('全部聚合');
    expect(trendScopeSelect).toHaveClass('-mt-1.5', 'h-6', 'text-[11px]');
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
    expect(within(headerActions).getByRole('button', { name: '24h' })).toBeInTheDocument();
    expect(within(headerActions).getByRole('button', { name: '7d' })).toBeInTheDocument();
    expect(within(headerActions).getByRole('button', { name: '刷新' })).toBeInTheDocument();
    expect(within(headerActions).queryByRole('button', { name: '30d' })).not.toBeInTheDocument();
  });

  it('fills route trend x-axis labels for partial 24h and 7d windows', async () => {
    mockUIState.overviewSubtab = 'route';

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

    const trendCard = await screen.findByLabelText('运行趋势图');
    await waitFor(() => {
      expect(window.electronAPI.route?.getAnalyticsOverview).toHaveBeenCalled();
    });

    expect(trendCard).toHaveAttribute('data-trend-point-count', '7');
    expect(document.querySelectorAll('[data-trend-axis-label="true"]')).toHaveLength(7);
    const sevenDayRequestBars = Array.from(
      document.querySelectorAll('[data-trend-series="requests"] [data-trend-bar-point-index]')
    );
    expect(
      sevenDayRequestBars.map(bar => Number(bar.getAttribute('data-trend-bar-point-index')))
    ).toEqual([6]);

    fireEvent.click(
      within(screen.getByTestId('header-actions')).getByRole('button', { name: '24h' })
    );

    await waitFor(() => {
      expect(trendCard).toHaveAttribute('data-trend-point-count', '24');
    });
    expect(document.querySelectorAll('[data-trend-axis-label="true"]')).toHaveLength(24);
    const twentyFourHourRequestBars = Array.from(
      document.querySelectorAll('[data-trend-series="requests"] [data-trend-bar-point-index]')
    );
    const twentyFourHourRequestBarIndexes = twentyFourHourRequestBars.map(bar =>
      Number(bar.getAttribute('data-trend-bar-point-index'))
    );
    expect(twentyFourHourRequestBarIndexes.length).toBeGreaterThan(0);
    const firstTwentyFourHourBarIndex = Math.min(...twentyFourHourRequestBarIndexes);
    expect(firstTwentyFourHourBarIndex).toBeGreaterThan(0);
    const axisLefts = Array.from(document.querySelectorAll('[data-trend-axis-label="true"]')).map(
      label => Number.parseFloat((label as HTMLElement).style.left)
    );
    const expectedLineStartX = Number(
      ((axisLefts[firstTwentyFourHourBarIndex] / 100) * 160).toFixed(2)
    );
    const successPath = document.querySelector(
      '[data-trend-series="success-rate"] path[stroke="currentColor"]'
    );
    expect(successPath?.getAttribute('d')?.startsWith(`M ${expectedLineStartX.toFixed(2)} `)).toBe(
      true
    );
    expect(window.electronAPI.route?.getAnalyticsOverview).toHaveBeenLastCalledWith({
      window: '24h',
    });
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

  it('selects and clears heatmap model filters within the merged dashboard', async () => {
    render(<DataOverviewPage />);

    const modelButton = await screen.findByRole('button', { name: '模型：claude-opus-4-6' });
    expect(modelButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(modelButton);
    expect(modelButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByText('模型热力分布'));
    expect(modelButton).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('svg[aria-label="模型→通道 Sankey 流图 SVG"]')).not.toBeInTheDocument();
  });

  it('reloads route overview data automatically after route overview change events', async () => {
    mockUIState.overviewSubtab = 'route';
    render(<DataOverviewPage />);

    await waitFor(() => {
      expect(window.electronAPI.route?.getAnalyticsOverview).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      appDataChangedListener?.({
        domains: ['route-overview'],
        emittedAt: Date.now(),
      });
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
    expect(screen.getByText('请求 44 · Tokens 5.0K')).toBeInTheDocument();
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
