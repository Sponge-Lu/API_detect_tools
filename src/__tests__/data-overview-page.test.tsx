import { useState, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataOverviewPage } from '../renderer/pages/DataOverviewPage';
import type { Config } from '../renderer/App';
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

  it('renders site and route overview panels from shared overview subtab state', async () => {
    const { rerender } = render(<DataOverviewPage />);

    expect(screen.queryByRole('button', { name: '站点数据' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '路由数据' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刷新' })).not.toBeInTheDocument();
    expect(screen.getByText('每日签到概览')).toBeInTheDocument();
    expect(screen.getByText('站点资源概览')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '每日签到概览' })).toHaveClass('xl:h-[248px]');
    expect(screen.getByRole('region', { name: '站点资源概览' })).toHaveClass('xl:h-[248px]');
    expect(screen.getByText('站点历史趋势')).toBeInTheDocument();
    expect(screen.getByTestId('overview-view-site')).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByTestId('overview-view-site')).toHaveClass('visible', 'opacity-100');
    expect(screen.getByTestId('overview-view-route')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('overview-view-route')).toHaveClass(
      'invisible',
      'opacity-0',
      'pointer-events-none'
    );
    expect(
      within(screen.getByTestId('overview-view-route')).getByText('运行趋势')
    ).toBeInTheDocument();
    expect(screen.queryByText('最近异常')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(window.electronAPI.overview?.getSiteDailySnapshots).toHaveBeenCalled();
      expect(window.electronAPI.route?.getAnalyticsSummary).toHaveBeenCalled();
    });
    expect(window.electronAPI.route?.getAnalyticsDistribution).toHaveBeenCalled();

    expect(screen.getByText('可用站点数')).toBeInTheDocument();
    expect(screen.getByText('展示站点 3 个 / 模型 2 个')).toBeInTheDocument();
    const totalBalanceMetric = screen.getByText('站点总余额').parentElement;
    if (!totalBalanceMetric) {
      throw new Error('Missing site total balance metric');
    }
    expect(totalBalanceMetric).toHaveTextContent('$23.70');
    expect(totalBalanceMetric).not.toHaveTextContent('$18.70');
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
    expect(
      within(screen.getByTestId('overview-view-site')).queryByText('Hidden Site')
    ).not.toBeInTheDocument();
    expect(screen.getByText('近 7 日请求量 (Reqs)')).toBeInTheDocument();
    expect(screen.getAllByText(`最近记录 ${todayLabel}`).length).toBeGreaterThan(0);
    const usageTrendCard = screen.getByLabelText('近 7 日消费趋势 趋势卡片');
    expect(usageTrendCard).toHaveClass('min-h-[208px]');
    expect(usageTrendCard).toHaveClass('border-[var(--line-muted)]');
    expect(usageTrendCard.className).not.toContain('border-white');
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

    mockUIState.overviewSubtab = 'route';
    rerender(<DataOverviewPage />);

    expect(screen.getByTestId('overview-view-site')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('overview-view-site')).toHaveClass(
      'invisible',
      'opacity-0',
      'pointer-events-none'
    );
    expect(screen.getByTestId('overview-view-route')).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByTestId('overview-view-route')).toHaveClass('visible', 'opacity-100');
    expect(screen.getByLabelText('路由数据驾驶舱')).toBeInTheDocument();
    await waitFor(() => {
      expect(window.electronAPI.route?.getAnalyticsSummary).toHaveBeenCalled();
    });
    expect(window.electronAPI.route?.getAnalyticsDistribution).toHaveBeenCalled();
    expect(window.electronAPI.route?.getConfig).toHaveBeenCalled();
    expect(window.electronAPI.route?.getObjectStats).not.toHaveBeenCalled();

    const routeDashboard = screen.getByLabelText('路由数据驾驶舱');
    expect(routeDashboard).toHaveAttribute('data-route-content-size');
    expect(screen.getByText('首字响应 / 会话时间')).toBeInTheDocument();
    const responseKpi = screen.getByLabelText('首字响应 / 会话时间 KPI');
    expect(within(responseKpi).queryByText(/P95|P99/)).not.toBeInTheDocument();
    expect(
      Array.from(responseKpi.querySelectorAll('*')).some(element =>
        element.className.toString().includes('text-[var(--accent)]')
      )
    ).toBe(true);
    expect(screen.queryByText('延迟分位数')).not.toBeInTheDocument();
    expect(screen.queryByText('活跃对象')).not.toBeInTheDocument();
    expect(screen.queryByText('通道健康矩阵')).not.toBeInTheDocument();
    expect(screen.getByText('模型热力分布')).toBeInTheDocument();
    expect(screen.getByText('通道健康散点矩阵')).toBeInTheDocument();
    expect(screen.getByText('模型 → 通道流向')).toBeInTheDocument();
    expect(screen.getByText('成功率前五通道')).toBeInTheDocument();
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
    const scatterYAxis = document.querySelector(
      'svg[aria-label="通道健康散点矩阵 SVG"] line[x1="8"]'
    );
    expect(scatterYAxis).toBeInTheDocument();
    const successLabelTitle = document.querySelector('[data-scatter-success-label-title="true"]');
    const firstSuccessLabel = document.querySelector(
      '[data-scatter-success-label="true"] text[font-weight="600"]'
    );
    expect(
      Number(firstSuccessLabel?.getAttribute('y')) - Number(successLabelTitle?.getAttribute('y'))
    ).toBeGreaterThanOrEqual(18);
    expect(successLabelTitle).toHaveAttribute('font-size', '10.5');
    expect(firstSuccessLabel).toHaveAttribute('font-size', '10.5');
    const scatterSvg = screen.getByLabelText('通道健康散点矩阵 SVG');
    const scatterMaxAxisLabel = within(scatterSvg).getByText('60s+');
    const scatterSuccessAxisLabel = within(scatterSvg).getByText('100%');
    expect(scatterMaxAxisLabel).toHaveAttribute('font-size', '11');
    expect(scatterSuccessAxisLabel).toHaveAttribute('font-size', '11');
    expect(screen.getByText('60s+')).toBeInTheDocument();
    expect(screen.queryByText('120s+')).not.toBeInTheDocument();
    expect(document.querySelector('[data-route-second-row="true"]')).toHaveClass(
      'xl:grid-cols-[minmax(0,1.34fr)_minmax(360px,0.96fr)]'
    );
    expect(document.querySelector('[data-route-third-row-card="scatter"]')).toHaveClass(
      'h-[250px]'
    );
    expect(document.querySelector('[data-route-third-row-card="sankey"]')).toHaveClass('h-[250px]');
    expect(document.querySelector('[data-route-third-row="true"]')).toHaveClass(
      'xl:grid-cols-[minmax(0,1.10fr)_minmax(0,0.90fr)]'
    );
    expect(screen.getByLabelText('运行趋势图')).toHaveClass('min-h-[244px]');
    expect(document.querySelector('[data-route-heatmap-card="true"]')).toHaveClass('min-h-[244px]');
    [
      screen.getByLabelText('路由请求量 KPI'),
      screen.getByLabelText('路由成功率 KPI'),
      screen.getByLabelText('Token 消耗 KPI'),
      screen.getByLabelText('首字响应 / 会话时间 KPI'),
      screen.getByLabelText('运行趋势图'),
      document.querySelector('[data-route-heatmap-card="true"]'),
      document.querySelector('[data-route-third-row-card="scatter"]'),
      document.querySelector('[data-route-third-row-card="sankey"]'),
    ].forEach(card => {
      expect(card).toHaveClass(
        'bg-[var(--surface-1)]',
        'border-2',
        'border-transparent',
        'shadow-[var(--shadow-md)]'
      );
      expect(card).not.toHaveClass('bg-[var(--surface-3)]');
    });
    const treemap = screen.getByLabelText('模型热力分布 treemap');
    expect(treemap).toHaveClass('min-h-[176px]');
    expect(treemap).toHaveAttribute('data-treemap-layout-size');
    const treemapNodes = Array.from(
      treemap.querySelectorAll('[data-treemap-node="true"]')
    ) as HTMLElement[];
    const rightEdge = Math.max(
      ...treemapNodes.map(
        node => Number.parseFloat(node.style.left) + Number.parseFloat(node.style.width)
      )
    );
    const bottomEdge = Math.max(
      ...treemapNodes.map(
        node => Number.parseFloat(node.style.top) + Number.parseFloat(node.style.height)
      )
    );
    expect(rightEdge).toBeCloseTo(100, 4);
    expect(bottomEdge).toBeCloseTo(100, 4);
    expect(document.querySelector('[data-trend-chart-frame="true"]')).toHaveClass('-mx-2', 'px-5');
    expect(document.querySelector('[data-route-content-scroll="true"]')).toHaveClass('pb-2');
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
    const ttfbSeries = document.querySelector('[data-trend-series="ttfb-p95"]');
    expect(
      ttfbSeries?.querySelector('path[stroke="currentColor"]')?.getAttribute('stroke-dasharray')
    ).toBe('4 3');
    expect(ttfbSeries).toHaveAttribute('data-trend-point-markers', 'true');
    expect(
      document
        .querySelector('[data-trend-legend="ttfb-p95"] [data-trend-legend-line]')
        ?.getAttribute('data-trend-legend-line')
    ).toBe('dashed');
    const requestSeries = document.querySelector('[data-trend-series="requests"]');
    const requestBars = Array.from(
      requestSeries?.querySelectorAll('[data-trend-bar-center-left]') || []
    );
    const requestBarCenterLefts = requestBars.map(bar =>
      Number.parseFloat(bar.getAttribute('data-trend-bar-center-left') || '')
    );
    const requestBarIndexes = requestBars.map(bar =>
      Number(bar.getAttribute('data-trend-bar-point-index'))
    );
    expect(requestBarIndexes.length).toBeGreaterThan(0);
    expect(requestBarIndexes[0]).toBeGreaterThan(0);
    expect(requestBarCenterLefts).toEqual(
      requestBarIndexes.map(index => Number(trendAxisLefts[index].toFixed(2)))
    );
    const successPath = successRateSeries?.querySelector('path[stroke="currentColor"]');
    expect(successPath?.getAttribute('d')).toBe('');
    for (const marker of failureMarkers) {
      const pointIndex = Number(marker.getAttribute('data-trend-point-index'));
      expect(Number.parseFloat(marker.style.left)).toBe(trendAxisLefts[pointIndex]);
    }
    expect(failureMarkers.every(marker => marker.querySelectorAll('span').length === 1)).toBe(true);
    const sankeySvg = document.querySelector('svg[aria-label="模型→通道 Sankey 流图 SVG"]');
    expect(sankeySvg?.getAttribute('viewBox')).toBe('0 0 532 248');
    const sankeyModelNode = sankeySvg?.querySelector('g[aria-label^="Sankey 模型节点："]');
    expect(sankeyModelNode).not.toHaveAttribute('style');
    expect(sankeyModelNode?.querySelector('rect')).toHaveAttribute('x', '92');
    expect(sankeyModelNode?.querySelector('text')).toHaveAttribute('font-size', '11');
    expect(sankeySvg?.querySelector('g[aria-label^="Sankey 通道节点："] rect')).toHaveAttribute(
      'x',
      '368'
    );
    expect(screen.queryByText('快又稳')).not.toBeInTheDocument();
    expect(screen.getByText(/输入 3\.6K\s*\/\s*输出 1\.4K\s*\/\s*缓存 0/)).toBeInTheDocument();
    const trendScopeSelect = screen.getByLabelText('选择运行趋势范围');
    expect(trendScopeSelect).toHaveDisplayValue('全部聚合');
    expect(trendScopeSelect).toHaveClass('-mt-1.5', 'h-6', 'text-[11px]');
    expect(screen.getByTestId('overview-view-site')).toHaveAttribute('aria-hidden', 'true');
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
      expect(window.electronAPI.overview?.getSiteDailySnapshots).toHaveBeenCalled();
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
      expect(window.electronAPI.route?.getAnalyticsDistribution).toHaveBeenCalled();
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
    expect(window.electronAPI.route?.getAnalyticsDistribution).toHaveBeenLastCalledWith({
      window: '24h',
    });
  });

  it('links heatmap model selection to Sankey one way and clears it from card chrome', async () => {
    mockUIState.overviewSubtab = 'route';
    render(<DataOverviewPage />);

    const modelButton = await screen.findByRole('button', { name: '模型：claude-opus-4-6' });
    expect(modelButton).toHaveAttribute('aria-pressed', 'false');
    const sankeyModelNode = document.querySelector(
      'g[aria-label="Sankey 模型节点：claude-opus-4-6"]'
    );
    expect(sankeyModelNode).toBeInTheDocument();
    fireEvent.click(sankeyModelNode!);
    expect(modelButton).toHaveAttribute('aria-pressed', 'false');
    expect(
      document.querySelector('svg[aria-label="模型→通道 Sankey 流图 SVG"]')
    ).not.toHaveAttribute('data-sankey-selected-model');
    expect(
      Array.from(document.querySelectorAll('[data-sankey-link="true"]')).every(
        link => link.getAttribute('stroke-opacity') === '0.6'
      )
    ).toBe(true);

    fireEvent.click(modelButton);
    expect(modelButton).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('svg[aria-label="模型→通道 Sankey 流图 SVG"]')).toHaveAttribute(
      'data-sankey-selected-model',
      'claude-opus-4-6'
    );
    const selectedSankeyLinks = Array.from(
      document.querySelectorAll('[data-sankey-link-selected="true"]')
    );
    const dimmedSankeyLinks = Array.from(
      document.querySelectorAll('[data-sankey-link-selected="false"]')
    );
    expect(selectedSankeyLinks.length).toBeGreaterThan(0);
    expect(dimmedSankeyLinks.length).toBeGreaterThan(0);
    expect(
      selectedSankeyLinks.every(
        link =>
          link.getAttribute('data-sankey-link-model') === 'claude-opus-4-6' &&
          link.getAttribute('stroke-opacity') === '0.72'
      )
    ).toBe(true);
    expect(dimmedSankeyLinks.every(link => link.getAttribute('stroke-opacity') === '0.15')).toBe(
      true
    );
    expect(
      document.querySelector('g[aria-label="Sankey 模型节点：claude-opus-4-6"]')
    ).toHaveAttribute('data-sankey-model-selected', 'true');

    fireEvent.click(modelButton);
    expect(modelButton).toHaveAttribute('aria-pressed', 'false');
    expect(
      document.querySelector('svg[aria-label="模型→通道 Sankey 流图 SVG"]')
    ).not.toHaveAttribute('data-sankey-selected-model');
    expect(
      Array.from(document.querySelectorAll('[data-sankey-link="true"]')).every(
        link =>
          !link.hasAttribute('data-sankey-link-selected') &&
          link.getAttribute('stroke-opacity') === '0.6'
      )
    ).toBe(true);

    fireEvent.click(modelButton);
    expect(modelButton).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByText('模型热力分布'));
    expect(modelButton).toHaveAttribute('aria-pressed', 'false');
    expect(
      document.querySelector('svg[aria-label="模型→通道 Sankey 流图 SVG"]')
    ).not.toHaveAttribute('data-sankey-selected-model');
  });

  it('reloads route overview data automatically after route overview change events', async () => {
    mockUIState.overviewSubtab = 'route';
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
      expect(window.electronAPI.route?.getAnalyticsDistribution).toHaveBeenCalledTimes(2);
    });
    expect(window.electronAPI.route?.getObjectStats).not.toHaveBeenCalled();
    expect(window.electronAPI.overview?.getSiteDailySnapshots).toHaveBeenCalledTimes(1);
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

  it('renders trend markers as fixed-size circles and keeps token matrix dots visible', async () => {
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
    } as NonNullable<typeof window.electronAPI.route>;

    const { rerender } = render(<DataOverviewPage />);

    const requestTrendCard = await screen.findByLabelText('近 7 日请求量 (Reqs) 趋势卡片');

    await waitFor(() => {
      expect(within(requestTrendCard).getByText('44')).toBeInTheDocument();
    });
    expect(within(requestTrendCard).getByText('44')).toHaveClass('text-[18px]');
    expect(
      Array.from(requestTrendCard.querySelectorAll('div')).some(div =>
        div.className.includes('h-[74px]')
      )
    ).toBe(true);

    const requestMarkers = Array.from(
      requestTrendCard.querySelectorAll('span[aria-hidden="true"]')
    ) as HTMLElement[];
    const requestMarkerLefts = requestMarkers.map(marker => Number.parseFloat(marker.style.left));

    expect(requestMarkers).toHaveLength(7);
    expect(requestTrendCard.querySelector('circle')).not.toBeInTheDocument();
    expect(requestMarkers.every(marker => marker.className.includes('rounded-full'))).toBe(true);
    expect(requestMarkers.some(marker => marker.className.includes('h-[5.5px]'))).toBe(true);
    expect(Math.min(...requestMarkerLefts)).toBeGreaterThan(0);
    expect(Math.max(...requestMarkerLefts)).toBeLessThan(100);

    const tokenTrendCard = screen.getByLabelText('近 7 日 Tokens 趋势卡片');
    const tokenDots = Array.from(tokenTrendCard.querySelectorAll('span')).filter(
      dot =>
        dot.className.includes('h-1.5') &&
        dot.className.includes('w-1.5') &&
        dot.className.includes('rounded-full')
    );

    expect(tokenDots).toHaveLength(42);
    expect(tokenDots.some(dot => dot.className.includes('bg-[var(--warning)]'))).toBe(true);
    expect(
      Array.from(tokenTrendCard.querySelectorAll('div')).some(div =>
        div.className.includes('h-[78px]')
      )
    ).toBe(true);

    mockUIState.overviewSubtab = 'route';
    rerender(<DataOverviewPage />);

    expect(await screen.findByText('运行趋势')).toBeInTheDocument();

    const trendCard = screen.getByLabelText('运行趋势图');
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
