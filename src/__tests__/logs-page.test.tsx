import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ANALYTICS_CONFIG,
  DEFAULT_CLI_PROBE_CONFIG,
  DEFAULT_ROUTE_PROXY_SERVER_CONFIG,
  type RouteDisplayItemPriorityConfig,
  type RouteModelRegistryConfig,
  type RouteRequestLogItem,
  type RouteRule,
  type RoutingConfig,
} from '../shared/types/route-proxy';
import type { Config } from '../renderer/App';
import { LogsPage } from '../renderer/pages/LogsPage';
import { useConfigStore } from '../renderer/store/configStore';
import { useRouteStore } from '../renderer/store/routeStore';

const ROUTE_LOG_RESPONSIVE_GRID_TEMPLATE =
  'minmax(2rem,2fr) minmax(7rem,7fr) minmax(calc(14rem + 2ch),16fr) minmax(20rem,20fr) minmax(4.5rem,4.5fr) minmax(6rem,6fr) minmax(3rem,3fr) minmax(6rem,6fr)';
const ROUTE_LOG_TOKEN_GRID_TEMPLATE =
  'minmax(0,calc(20% - 1ch)) minmax(0,20%) minmax(0,calc(20% - 2ch)) minmax(0,calc(20% + 1ch)) minmax(0,20%)';

function buildRouteLog(
  partial: Partial<RouteRequestLogItem> &
    Pick<RouteRequestLogItem, 'id' | 'requestId' | 'cliType' | 'attempt' | 'outcome' | 'createdAt'>
): RouteRequestLogItem {
  return {
    id: partial.id,
    requestId: partial.requestId,
    attempt: partial.attempt,
    cliType: partial.cliType,
    outcome: partial.outcome,
    createdAt: partial.createdAt,
    requestedModel: partial.requestedModel ?? 'gpt-5.4',
    canonicalModel: partial.canonicalModel ?? 'gpt-5.4',
    routeRuleId: partial.routeRuleId ?? 'rule-codex',
    routeRuleName: partial.routeRuleName ?? 'Codex 主路由',
    siteId: partial.siteId ?? 'site-1',
    siteName: partial.siteName ?? '站点 A',
    accountId: partial.accountId ?? 'acct-1',
    accountName: partial.accountName ?? '主账户',
    userGroupKey: partial.userGroupKey ?? 'vip',
    apiKeyId: partial.apiKeyId ?? 'key-1',
    apiKeyName: partial.apiKeyName ?? 'Key Alpha',
    resolvedModel: partial.resolvedModel ?? 'gpt-5.4-2025-02-15',
    statusCode: partial.statusCode,
    latencyMs: partial.latencyMs,
    firstByteLatencyMs: partial.firstByteLatencyMs,
    promptTokens: partial.promptTokens,
    completionTokens: partial.completionTokens,
    totalTokens: partial.totalTokens,
    cacheCreationTokens: partial.cacheCreationTokens,
    cacheReadTokens: partial.cacheReadTokens,
    cachedTokens: partial.cachedTokens,
    error: partial.error,
  };
}

function findRouteLogRowByRequestId(requestId: string): HTMLElement | undefined {
  return screen
    .getAllByTestId('route-request-log-row')
    .find(row => row.getAttribute('data-route-request-id') === requestId);
}

function getRouteLogRowByRequestId(requestId: string): HTMLElement {
  const row = findRouteLogRowByRequestId(requestId);
  expect(row).toBeDefined();
  return row!;
}

function buildRouteConfigForLogs(params: {
  rules: RouteRule[];
  modelRegistry: RouteModelRegistryConfig;
}): RoutingConfig {
  return {
    server: { ...DEFAULT_ROUTE_PROXY_SERVER_CONFIG },
    rules: params.rules,
    cliModelSelections: {
      claudeCode: null,
      codex: null,
      geminiCli: null,
    },
    stats: {},
    routePathStates: {},
    routeEndpointCapabilities: {},
    health: {},
    modelRegistry: params.modelRegistry,
    cliProbe: {
      config: { ...DEFAULT_CLI_PROBE_CONFIG },
      latest: {},
      history: {},
    },
    analytics: {
      config: { ...DEFAULT_ANALYTICS_CONFIG },
      buckets: {},
    },
  };
}

function buildPriorityRegistry(sitePriorities: Record<string, number>): RouteModelRegistryConfig {
  return {
    version: 1,
    sources: [
      {
        sourceKey: 'source-site-b-gpt',
        siteId: 'site-2',
        siteName: '站点 B',
        accountId: 'acct-2',
        accountName: '备用账户',
        sourceType: 'account',
        originalModel: 'gpt-5.4-2025-02-15',
        vendor: 'gpt',
        apiKeyGroups: ['beta'],
        userGroupKeys: ['beta'],
        availableUserGroups: ['beta'],
        availableApiKeys: [
          {
            apiKeyId: 'key-2',
            apiKeyName: 'Key Beta',
            accountId: 'acct-2',
            accountName: '备用账户',
            group: 'beta',
          },
        ],
        firstSeenAt: 1,
        lastSeenAt: 1,
      },
      {
        sourceKey: 'source-site-a-gpt',
        siteId: 'site-1',
        siteName: '站点 A',
        accountId: 'acct-1',
        accountName: '主账户',
        sourceType: 'account',
        originalModel: 'gpt-5.4-2025-02-15',
        vendor: 'gpt',
        apiKeyGroups: ['vip'],
        userGroupKeys: ['vip'],
        availableUserGroups: ['vip'],
        availableApiKeys: [
          {
            apiKeyId: 'key-1',
            apiKeyName: 'Key Alpha',
            accountId: 'acct-1',
            accountName: '主账户',
            group: 'vip',
          },
        ],
        firstSeenAt: 1,
        lastSeenAt: 1,
      },
    ],
    entries: {},
    overrides: [],
    displayItems: [
      {
        id: 'display-gpt-5.4',
        vendor: 'gpt',
        canonicalName: 'gpt-5.4',
        sourceKeys: ['source-site-b-gpt', 'source-site-a-gpt'],
        priorityConfig: {
          sitePriorities,
          apiKeyPriorities: {},
        },
        mode: 'manual',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    vendorPriorities: {},
  };
}

describe('LogsPage', () => {
  const routeApi = window.electronAPI.route!;
  let routeRequestLogListener: ((item: RouteRequestLogItem) => void) | null = null;

  beforeEach(() => {
    routeRequestLogListener = null;
    routeApi.onRequestLogAppended = vi.fn(callback => {
      routeRequestLogListener = callback;
      return vi.fn(() => {
        routeRequestLogListener = null;
      });
    });
    useRouteStore.setState({ config: null });
    useConfigStore.setState({
      config: {
        sites: [
          {
            id: 'site-1',
            name: '站点 A',
            url: 'https://site-a.example.com',
            enabled: true,
          },
          {
            id: 'site-2',
            name: '站点 B',
            url: 'https://site-b.example.com',
            enabled: true,
          },
        ],
        accounts: [
          {
            id: 'acct-1',
            site_id: 'site-1',
            account_name: '主账户',
            user_id: '1',
            access_token: 'token-a',
            auth_source: 'manual',
            status: 'active',
            cached_data: {
              user_groups: {
                vip: { desc: 'VIP', ratio: 2 },
              },
              model_pricing: {
                data: {
                  'gpt-5.4-2025-02-15': {
                    model_price: { input: 0.001, output: 0.002 },
                  },
                  'per-call-direct': {
                    quota_type: 1,
                    model_price: 0.25,
                  },
                  'per-call-object': {
                    type: 'times',
                    model_price: { input: 500, output: 1000 },
                  },
                },
              },
            },
            created_at: 1,
            updated_at: 1,
          },
          {
            id: 'acct-2',
            site_id: 'site-2',
            account_name: '备用账户',
            user_id: '2',
            access_token: 'token-b',
            auth_source: 'manual',
            status: 'active',
            cached_data: {
              user_groups: {
                beta: { desc: 'Beta', ratio: 1.5 },
              },
              model_pricing: {
                data: {
                  'gpt-5.4-mini-2025-04-14': {
                    model_price: { input: 0.0001, output: 0.0002 },
                  },
                },
              },
            },
            created_at: 2,
            updated_at: 2,
          },
        ],
        settings: {
          timeout: 30,
          concurrent: false,
          show_disabled: true,
        },
      } as Config,
    });
    vi.mocked(routeApi.getRequestLogs).mockReset().mockResolvedValue({ success: true, data: [] });
    vi.mocked(routeApi.clearRequestLogs).mockReset().mockResolvedValue({ success: true });
    vi.mocked(routeApi.upsertModelDisplayItem).mockReset();
    vi.mocked(routeApi.getConfig)
      .mockReset()
      .mockResolvedValue({
        success: true,
        data: {
          rules: [
            {
              id: 'rule-codex',
              name: 'Codex 主路由',
              enabled: true,
              priority: 90,
              cliType: 'codex',
              patternType: 'wildcard',
              pattern: 'gpt-*',
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          modelRegistry: {
            version: 1,
            sources: [
              {
                sourceKey: 'source-site-a-gpt',
                siteId: 'site-1',
                siteName: '站点 A',
                accountId: 'acct-1',
                accountName: '主账户',
                sourceType: 'account',
                originalModel: 'gpt-5.4-2025-02-15',
                vendor: 'gpt',
                apiKeyGroups: ['vip'],
                userGroupKeys: ['vip'],
                availableUserGroups: ['vip'],
                availableApiKeys: [
                  {
                    apiKeyId: 'key-1',
                    apiKeyName: 'Key Alpha',
                    accountId: 'acct-1',
                    accountName: '主账户',
                    group: 'vip',
                  },
                ],
                firstSeenAt: 1,
                lastSeenAt: 1,
              },
              {
                sourceKey: 'source-site-b-gpt-mini',
                siteId: 'site-2',
                siteName: '站点 B',
                accountId: 'acct-2',
                accountName: '备用账户',
                sourceType: 'account',
                originalModel: 'gpt-5.4-mini-2025-04-14',
                vendor: 'gpt',
                apiKeyGroups: ['beta'],
                userGroupKeys: ['beta'],
                availableUserGroups: ['beta'],
                availableApiKeys: [
                  {
                    apiKeyId: 'key-2',
                    apiKeyName: 'Key Beta',
                    accountId: 'acct-2',
                    accountName: '备用账户',
                    group: 'beta',
                  },
                ],
                firstSeenAt: 2,
                lastSeenAt: 2,
              },
              {
                sourceKey: 'source-custom-duck',
                siteId: 'custom-cli-site-duckcoding',
                siteName: '自定义 CLI / DuckCoding',
                accountId: 'custom-cli-account-duckcoding',
                accountName: '自定义 CLI',
                sourceType: 'customCli',
                originalModel: 'duckcoding',
                vendor: 'unknown',
                apiKeyGroups: ['custom-cli'],
                userGroupKeys: ['custom-cli'],
                availableUserGroups: ['custom-cli'],
                availableApiKeys: [
                  {
                    apiKeyId: 'custom-cli-key-duckcoding',
                    apiKeyName: 'DuckCoding Key',
                    accountId: 'custom-cli-account-duckcoding',
                    accountName: '自定义 CLI',
                    group: 'custom-cli',
                  },
                ],
                firstSeenAt: 3,
                lastSeenAt: 3,
              },
            ],
            entries: {},
            overrides: [],
            displayItems: [
              {
                id: 'display-gpt-5.4',
                vendor: 'gpt',
                canonicalName: 'gpt-5.4',
                sourceKeys: ['source-site-b-gpt-mini', 'source-site-a-gpt'],
                priorityConfig: {
                  sitePriorities: { 'site-2': 1, 'site-1': 2 },
                  apiKeyPriorities: {},
                },
                mode: 'manual',
                createdAt: 1,
                updatedAt: 1,
              },
              {
                id: 'display-gpt-5.4-mini',
                vendor: 'gpt',
                canonicalName: 'gpt-5.4-mini',
                sourceKeys: ['source-site-b-gpt-mini'],
                priorityConfig: {
                  sitePriorities: { 'site-2': 1 },
                  apiKeyPriorities: {},
                },
                mode: 'manual',
                createdAt: 2,
                updatedAt: 2,
              },
              {
                id: 'display-duckcoding',
                vendor: 'unknown',
                canonicalName: 'duckcoding',
                sourceKeys: ['source-custom-duck'],
                priorityConfig: {
                  sitePriorities: { 'custom-cli-site-duckcoding': 0 },
                  apiKeyPriorities: {},
                },
                mode: 'manual',
                createdAt: 3,
                updatedAt: 3,
              },
            ],
            vendorPriorities: {},
          },
        },
      });
  });

  it('renders route request details from the logs page and clears logs', async () => {
    vi.mocked(routeApi.getRequestLogs).mockResolvedValue({
      success: true,
      data: [
        buildRouteLog({
          id: 'route-log-1',
          requestId: 'codex-1',
          cliType: 'codex',
          attempt: 1,
          outcome: 'failure',
          createdAt: 100,
          statusCode: 502,
          latencyMs: 1234,
          firstByteLatencyMs: 456,
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cacheCreationTokens: 20,
          cacheReadTokens: 40,
          error: 'no_matching_rule',
        }),
        buildRouteLog({
          id: 'route-log-2',
          requestId: 'codex-2',
          cliType: 'codex',
          attempt: 2,
          outcome: 'success',
          createdAt: 200,
          requestedModel: 'gpt-5.4-mini',
          canonicalModel: 'gpt-5.4-mini',
          resolvedModel: 'gpt-5.4-mini-2025-04-14',
          siteId: 'site-2',
          siteName: '站点 B',
          accountId: 'acct-2',
          accountName: '备用账户',
          apiKeyId: 'key-2',
          apiKeyName: 'Key Beta',
          userGroupKey: 'beta',
          statusCode: 200,
          latencyMs: 789,
          firstByteLatencyMs: 120,
          promptTokens: 12,
          completionTokens: 3,
          totalTokens: 15,
        }),
        buildRouteLog({
          id: 'route-log-3',
          requestId: 'custom-1',
          cliType: 'codex',
          attempt: 1,
          outcome: 'success',
          createdAt: 300,
          requestedModel: 'duckcoding',
          canonicalModel: 'duckcoding',
          resolvedModel: 'duckcoding',
          siteId: 'custom-cli-site-duckcoding',
          siteName: '自定义 CLI / DuckCoding',
          accountId: 'custom-cli-account-duckcoding',
          accountName: '自定义 CLI',
          userGroupKey: 'custom-cli',
          apiKeyId: 'custom-cli-key-duckcoding',
          apiKeyName: 'DuckCoding Key',
          statusCode: 200,
          latencyMs: 456,
          firstByteLatencyMs: 80,
          promptTokens: 9,
          completionTokens: 1,
          totalTokens: 10,
        }),
        buildRouteLog({
          id: 'route-log-4',
          requestId: 'codex-cache',
          cliType: 'codex',
          attempt: 1,
          outcome: 'success',
          createdAt: 400,
          promptTokens: 100,
          completionTokens: 0,
          totalTokens: 100,
          cacheReadTokens: 40,
          cachedTokens: 40,
        }),
      ],
    });

    render(<LogsPage />);

    await waitFor(() => {
      expect(routeApi.getRequestLogs).toHaveBeenCalledWith({ limit: 200 });
    });
    expect(routeApi.getConfig).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '会话事件' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '路由日志' })).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        '这里展示当前运行会话内的每次路由尝试，包含 CLI、模型、站点、账户、用户分组、API Key、状态码、耗时与时间。'
      )
    ).not.toBeInTheDocument();

    await waitFor(() => expect(getRouteLogRowByRequestId('codex-1')).toBeInTheDocument());
    expect(screen.getByTestId('logs-page-surface')).not.toHaveClass(
      'rounded-[var(--radius-lg)]',
      'shadow-[var(--shadow-md)]'
    );
    const header = screen.getByTestId('route-request-log-header');
    expect(header).toHaveTextContent(
      'CLI原始模型路由目标Token（总/输入/输出/缓存写/缓存读）预计金额用时/首字状态时间'
    );
    expect(header.parentElement).toHaveClass('w-full');
    expect(header.parentElement).toHaveStyle({ minWidth: 'calc(62.5rem + 2ch)' });
    expect(header.style.gridTemplateColumns).toBe(ROUTE_LOG_RESPONSIVE_GRID_TEMPLATE);
    expect(screen.queryByRole('button', { name: '刷新' })).not.toBeInTheDocument();
    expect(screen.getByText('总尝试').parentElement).toHaveTextContent('总尝试4');
    const successStat = screen
      .getAllByText('成功')
      .find(element => element.parentElement?.textContent === '成功3');
    expect(successStat?.parentElement).toHaveTextContent('成功3');
    const failureStat = screen
      .getAllByText('失败')
      .find(element => element.parentElement?.textContent === '失败1');
    expect(failureStat?.parentElement).toHaveTextContent('失败1');
    expect(screen.queryByText('中性')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId('route-request-log-row')).toHaveLength(4));
    const rows = screen.getAllByTestId('route-request-log-row');
    expect(rows[0]).toHaveClass('px-4', 'py-2', '[contain-intrinsic-size:64px]');
    expect(rows[0]).not.toHaveClass('py-4');
    expect(screen.queryByText('HTTP 502')).not.toBeInTheDocument();
    const tableLine = within(rows[0]).getByTestId('route-request-table-line');
    expect(tableLine.style.gridTemplateColumns).toBe(ROUTE_LOG_RESPONSIVE_GRID_TEMPLATE);
    expect(tableLine).toHaveClass('gap-x-2');
    expect(within(rows[0]).getByTestId('route-request-cli-icon')).toHaveAttribute(
      'aria-label',
      'Codex'
    );
    expect(within(rows[0]).getByTestId('route-request-cli-icon').className).not.toMatch(
      /bg-|border/
    );
    expect(within(rows[0]).getByTestId('route-request-cli-icon')).toHaveClass('justify-start');
    expect(within(rows[0]).queryByTestId('route-request-id-attempt')).not.toBeInTheDocument();
    expect(rows[0]).toHaveAttribute('data-route-request-id', 'codex-1');
    const modelPath = within(rows[0]).getByTestId('route-request-model-path');
    expect(modelPath).toHaveTextContent('gpt-5.4');
    expect(modelPath).toHaveAttribute('title', 'gpt-5.4-2025-02-15 → gpt-5.4');
    expect(modelPath).toHaveClass('truncate', 'min-w-0');
    const sitePath = within(rows[0]).getByTestId('route-request-site-path');
    expect(sitePath).toHaveTextContent('站点 A / 主账户 / vip / Key Alpha');
    const sitePathText = within(sitePath).getByText('站点 A / 主账户 / vip / Key Alpha');
    expect(sitePathText).not.toHaveAttribute('title');
    expect(sitePathText).toHaveClass('truncate', 'min-w-0');
    expect(within(rows[0]).queryByTestId('route-request-site-priority')).not.toBeInTheDocument();
    const failureInfo = within(rows[0]).getByTestId('route-request-failure-info');
    expect(failureInfo).toHaveTextContent('no_matching_rule');
    expect(failureInfo.style.gridTemplateColumns).toBe(ROUTE_LOG_RESPONSIVE_GRID_TEMPLATE);
    expect(failureInfo).toHaveClass('gap-x-2');
    expect(within(rows[1]).queryByTestId('route-request-failure-info')).not.toBeInTheDocument();
    const tokenSummary = within(rows[0]).getByTestId('route-request-token-summary');
    expect(tokenSummary).toHaveTextContent('T 150IN 100OUT 50C.R 40C.W 20');
    expect(tokenSummary).toHaveClass('whitespace-nowrap', 'tabular-nums');
    expect(tokenSummary).not.toHaveAttribute('title');
    expect(tokenSummary).not.toHaveClass('grid-cols-5');
    expect(tokenSummary.style.gridTemplateColumns).toBe(ROUTE_LOG_TOKEN_GRID_TEMPLATE);
    expect(within(tokenSummary).getByText('T')).toHaveClass(
      'font-mono',
      'text-[9.5px]',
      'italic',
      'text-[var(--text-tertiary)]'
    );
    expect(within(tokenSummary).getByText('IN')).toHaveClass(
      'font-mono',
      'text-[9.5px]',
      'italic',
      'text-[var(--text-tertiary)]'
    );
    expect(within(tokenSummary).getByText('C.W')).toHaveClass(
      'font-mono',
      'text-[9.5px]',
      'italic'
    );
    expect(
      within(tokenSummary).getAllByText(/^(T|IN|OUT|C\.R|C\.W)$/)[0].parentElement
    ).toHaveClass('inline-flex');
    expect(
      within(tokenSummary).getAllByText(/^(T|IN|OUT|C\.R|C\.W)$/)[0].parentElement
    ).not.toHaveClass('gap-px');
    const costCell = within(rows[0]).getByTestId('route-request-cost');
    expect(costCell).toHaveTextContent('4.58e-7');
    expect(costCell).toHaveClass('whitespace-nowrap');
    expect(within(costCell).getByText('4.58e-7')).not.toHaveClass('font-semibold');
    expect(costCell).not.toHaveClass('rounded-[var(--radius-md)]');
    expect(costCell.className).not.toMatch(/bg-\[/);
    expect(within(rows[0]).getByTestId('route-request-status-code')).toHaveTextContent('502');
    expect(within(rows[0]).getByTestId('route-request-status-code')).not.toHaveAttribute('title');
    expect(
      within(costCell).queryByRole('button', { name: '预计金额计算公式' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(
      within(sitePath).queryByRole('button', { name: '路由目标字段说明' })
    ).not.toBeInTheDocument();
    expect(within(rows[1]).getByTestId('route-request-site-path')).toHaveTextContent(
      '站点 B / 备用账户 / beta / Key Beta'
    );
    expect(within(rows[1]).getByTestId('route-request-model-path')).toHaveTextContent(
      'gpt-5.4-mini'
    );
    expect(rows[1]).toHaveAttribute('data-route-request-id', 'codex-2');
    expect(within(rows[1]).getByTestId('route-request-cost')).toHaveTextContent('2.7e-9');
    expect(within(rows[1]).getByTestId('route-request-token-summary')).toHaveTextContent(
      'T 15IN 12OUT 3C.R 0C.W 0'
    );
    const customCliSitePath = within(rows[2]).getByTestId('route-request-site-path');
    expect(customCliSitePath).toHaveTextContent(/^直连配置 \/ DuckCoding$/);
    expect(customCliSitePath).not.toHaveAttribute('title');
    expect(within(rows[2]).getByTestId('route-request-cost')).toHaveTextContent('0');
    expect(
      within(customCliSitePath).queryByRole('button', { name: '路由目标字段说明' })
    ).not.toBeInTheDocument();
    expect(rows[3]).toHaveAttribute('data-route-request-id', 'codex-cache');
    expect(within(rows[3]).getByTestId('route-request-token-summary')).toHaveTextContent(
      'T 100IN 100OUT 0C.R 40C.W 0'
    );
    expect(within(rows[3]).getByTestId('route-request-cost')).toHaveTextContent('1.28e-7');
    expect(screen.queryByText(/^规则说明：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/规则优先级/)).not.toBeInTheDocument();
    expect(screen.getByText(/1\.23s\/456ms/)).toBeInTheDocument();
    expect(screen.getByText(/789ms\/120ms/)).toBeInTheDocument();
    expect(
      screen.queryByText(
        '口径：总耗时=代理发出上游请求到响应结束；首字节=代理发出上游请求到收到首个响应数据块。'
      )
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清空路由日志' }));

    await waitFor(() => {
      expect(routeApi.clearRequestLogs).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('暂无路由日志')).toBeInTheDocument();
    expect(screen.queryByText(/当前运行会话中还没有路由请求/)).not.toBeInTheDocument();
  });

  it('uses the matched display item site priority even when the priority is zero', async () => {
    vi.mocked(routeApi.getRequestLogs).mockResolvedValue({
      success: true,
      data: [
        buildRouteLog({
          id: 'route-priority-zero',
          requestId: 'priority-zero',
          cliType: 'codex',
          attempt: 1,
          outcome: 'success',
          createdAt: 100,
          siteId: 'site-1',
          siteName: '站点 A',
          accountId: 'acct-1',
          accountName: '主账户',
          apiKeyId: 'key-1',
          apiKeyName: 'Key Alpha',
          requestedModel: 'gpt-5.4',
          canonicalModel: 'gpt-5.4',
          resolvedModel: 'gpt-5.4-2025-02-15',
        }),
      ],
    });

    const stringZeroPriority = {
      sitePriorities: { 'site-1': '0' },
      apiKeyPriorities: { 'key-1': 99 },
    } as unknown as RouteDisplayItemPriorityConfig;
    const modelRegistry: RouteModelRegistryConfig = {
      version: 1,
      sources: [
        {
          sourceKey: 'source-site-b-gpt',
          siteId: 'site-2',
          siteName: '站点 B',
          accountId: 'acct-2',
          accountName: '备用账户',
          sourceType: 'account',
          originalModel: 'gpt-5.4-2025-02-15',
          vendor: 'gpt',
          apiKeyGroups: ['beta'],
          userGroupKeys: ['beta'],
          availableUserGroups: ['beta'],
          availableApiKeys: [
            {
              apiKeyId: 'key-2',
              apiKeyName: 'Key Beta',
              accountId: 'acct-2',
              accountName: '备用账户',
              group: 'beta',
            },
          ],
          firstSeenAt: 1,
          lastSeenAt: 1,
        },
        {
          sourceKey: 'source-site-a-gpt',
          siteId: 'site-1',
          siteName: '站点 A',
          accountId: 'acct-1',
          accountName: '主账户',
          sourceType: 'account',
          originalModel: 'gpt-5.4-2025-02-15',
          vendor: 'gpt',
          apiKeyGroups: ['vip'],
          userGroupKeys: ['vip'],
          availableUserGroups: ['vip'],
          availableApiKeys: [
            {
              apiKeyId: 'key-1',
              apiKeyName: 'Key Alpha',
              accountId: 'acct-1',
              accountName: '主账户',
              group: 'vip',
            },
          ],
          firstSeenAt: 1,
          lastSeenAt: 1,
        },
      ],
      entries: {},
      overrides: [],
      displayItems: [
        {
          id: 'display-priority-zero',
          vendor: 'gpt',
          canonicalName: 'gpt-5.4',
          sourceKeys: ['source-site-b-gpt', 'source-site-a-gpt'],
          priorityConfig: stringZeroPriority,
          mode: 'manual',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      vendorPriorities: {},
    };

    vi.mocked(routeApi.getConfig).mockResolvedValueOnce({
      success: true,
      data: {
        rules: [
          {
            id: 'rule-codex',
            name: 'Codex 主路由',
            enabled: true,
            priority: 90,
            cliType: 'codex',
            patternType: 'wildcard',
            pattern: 'gpt-*',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        modelRegistry,
      },
    });

    render(<LogsPage />);

    await waitFor(() => expect(getRouteLogRowByRequestId('priority-zero')).toBeInTheDocument());
    const row = getRouteLogRowByRequestId('priority-zero');
    expect(within(row).getByTestId('route-request-site-path')).toHaveTextContent(
      '站点 A / 主账户 / vip / Key Alpha'
    );
    expect(within(row).queryByTestId('route-request-site-priority')).not.toBeInTheDocument();
  });

  it('truncates long route path site names without adding hover text', async () => {
    vi.mocked(routeApi.getRequestLogs).mockResolvedValue({
      success: true,
      data: [
        buildRouteLog({
          id: 'route-long-site-name',
          requestId: 'long-site-name',
          cliType: 'codex',
          attempt: 1,
          outcome: 'success',
          createdAt: 100,
          siteId: 'site-long',
          siteName: '超级超级超级超级站点',
          accountId: 'acct-long',
          accountName: '长名称账户',
          apiKeyId: 'key-long',
          apiKeyName: 'Key Long',
          userGroupKey: 'vip',
          requestedModel: 'unregistered-model',
          canonicalModel: 'unregistered-model',
          resolvedModel: 'unregistered-model',
        }),
      ],
    });

    render(<LogsPage />);

    await waitFor(() => expect(getRouteLogRowByRequestId('long-site-name')).toBeInTheDocument());
    const sitePath = within(getRouteLogRowByRequestId('long-site-name')).getByTestId(
      'route-request-site-path'
    );
    expect(sitePath).toHaveTextContent('超级超级… / 长名称账户 / vip / Key Long');
    expect(sitePath).not.toHaveAttribute('title');
  });

  it('recomputes existing route log priorities from the latest route config', async () => {
    vi.mocked(routeApi.getRequestLogs).mockResolvedValue({
      success: true,
      data: [
        buildRouteLog({
          id: 'route-latest-priority',
          requestId: 'latest-priority',
          cliType: 'codex',
          attempt: 1,
          outcome: 'success',
          createdAt: 100,
          siteId: 'site-1',
          siteName: '站点 A',
          accountId: 'acct-1',
          accountName: '主账户',
          apiKeyId: 'key-1',
          apiKeyName: 'Key Alpha',
          requestedModel: 'gpt-5.4',
          canonicalModel: 'gpt-5.4',
          resolvedModel: 'gpt-5.4-2025-02-15',
        }),
      ],
    });
    const rule: RouteRule = {
      id: 'rule-codex',
      name: 'Codex 主路由',
      enabled: true,
      priority: 90,
      cliType: 'codex',
      patternType: 'wildcard',
      pattern: 'gpt-*',
      createdAt: 1,
      updatedAt: 1,
    };

    render(<LogsPage />);

    await waitFor(() => expect(getRouteLogRowByRequestId('latest-priority')).toBeInTheDocument());
    const routePathCell = within(getRouteLogRowByRequestId('latest-priority')).getByTestId(
      'route-request-site-path'
    );
    expect(routePathCell).toHaveTextContent('站点 A / 主账户 / vip / Key Alpha');

    await act(async () => {
      useRouteStore.setState({
        config: buildRouteConfigForLogs({
          rules: [rule],
          modelRegistry: buildPriorityRegistry({ 'site-1': 0, 'site-2': 1 }),
        }),
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(routePathCell).toHaveTextContent('站点 A / 主账户 / vip / Key Alpha');
    });
    expect(screen.queryByTestId('route-request-site-priority')).not.toBeInTheDocument();
  });

  it('refreshes route config after a display item save when the route store config is missing', async () => {
    const rule: RouteRule = {
      id: 'rule-codex',
      name: 'Codex 主路由',
      enabled: true,
      priority: 90,
      cliType: 'codex',
      patternType: 'wildcard',
      pattern: 'gpt-*',
      createdAt: 1,
      updatedAt: 1,
    };
    const staleRegistry = buildPriorityRegistry({ 'site-1': 1, 'site-2': 0 });
    const savedRegistry = buildPriorityRegistry({ 'site-1': 0, 'site-2': 1 });

    vi.mocked(routeApi.getRequestLogs).mockResolvedValue({
      success: true,
      data: [
        buildRouteLog({
          id: 'route-save-refresh',
          requestId: 'save-refresh',
          cliType: 'codex',
          attempt: 1,
          outcome: 'success',
          createdAt: 100,
          siteId: 'site-1',
          siteName: '站点 A',
          accountId: 'acct-1',
          accountName: '主账户',
          apiKeyId: 'key-1',
          apiKeyName: 'Key Alpha',
          requestedModel: 'gpt-5.4',
          canonicalModel: 'gpt-5.4',
          resolvedModel: 'gpt-5.4-2025-02-15',
        }),
      ],
    });
    vi.mocked(routeApi.getConfig)
      .mockResolvedValueOnce({
        success: true,
        data: buildRouteConfigForLogs({ rules: [rule], modelRegistry: staleRegistry }),
      })
      .mockResolvedValueOnce({
        success: true,
        data: buildRouteConfigForLogs({ rules: [rule], modelRegistry: savedRegistry }),
      });
    vi.mocked(routeApi.upsertModelDisplayItem).mockResolvedValue({
      success: true,
      data: savedRegistry,
    });

    render(<LogsPage />);

    await waitFor(() => expect(getRouteLogRowByRequestId('save-refresh')).toBeInTheDocument());
    expect(
      within(getRouteLogRowByRequestId('save-refresh')).getByTestId('route-request-site-path')
    ).toHaveTextContent('站点 A / 主账户 / vip / Key Alpha');

    await act(async () => {
      useRouteStore.setState({ config: null });
      await useRouteStore.getState().upsertDisplayItem(savedRegistry.displayItems[0]);
    });

    await waitFor(() => {
      expect(routeApi.getConfig).toHaveBeenCalledTimes(2);
    });
    expect(routeApi.upsertModelDisplayItem).toHaveBeenCalledWith(savedRegistry.displayItems[0]);
  });

  it('appends pushed route logs without reloading the snapshot', async () => {
    vi.mocked(routeApi.getRequestLogs).mockResolvedValue({
      success: true,
      data: [
        buildRouteLog({
          id: 'route-initial',
          requestId: 'initial',
          cliType: 'claudeCode',
          attempt: 1,
          outcome: 'success',
          createdAt: 100,
        }),
      ],
    });

    render(<LogsPage />);

    await waitFor(() => expect(getRouteLogRowByRequestId('initial')).toBeInTheDocument());
    expect(
      within(getRouteLogRowByRequestId('initial')).queryByTestId('route-request-id-attempt')
    ).not.toBeInTheDocument();
    expect(routeApi.getRequestLogs).toHaveBeenCalledTimes(1);

    await act(async () => {
      routeRequestLogListener?.(
        buildRouteLog({
          id: 'route-live',
          requestId: 'live',
          cliType: 'claudeCode',
          attempt: 1,
          outcome: 'success',
          createdAt: 200,
        })
      );
      await Promise.resolve();
    });

    expect(routeApi.getRequestLogs).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('正在加载路由日志...')).not.toBeInTheDocument();
    await waitFor(() => expect(getRouteLogRowByRequestId('live')).toBeInTheDocument());
    const rows = screen.getAllByTestId('route-request-log-row');
    expect(rows[0]).toHaveAttribute('data-route-request-id', 'live');
    expect(rows[1]).toHaveAttribute('data-route-request-id', 'initial');
  });

  it('subscribes to pushed route logs while the logs page is mounted', async () => {
    const { unmount } = render(<LogsPage />);

    await waitFor(() => {
      expect(routeApi.getRequestLogs).toHaveBeenCalledWith({ limit: 200 });
    });
    expect(routeApi.onRequestLogAppended).toHaveBeenCalledTimes(1);
    expect(routeRequestLogListener).not.toBeNull();

    unmount();

    expect(routeRequestLogListener).toBeNull();
  });

  it('keeps route logs visible after a delayed initial snapshot resolves', async () => {
    let resolveSnapshot!: (value: { success: true; data: RouteRequestLogItem[] }) => void;
    const snapshotPromise = new Promise<{ success: true; data: RouteRequestLogItem[] }>(resolve => {
      resolveSnapshot = resolve;
    });
    vi.mocked(routeApi.getRequestLogs).mockReturnValueOnce(snapshotPromise);

    render(<LogsPage />);

    await waitFor(() => {
      expect(routeApi.getRequestLogs).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('正在加载路由日志...')).not.toBeInTheDocument();

    await act(async () => {
      resolveSnapshot({
        success: true,
        data: [
          buildRouteLog({
            id: 'route-hidden-live',
            requestId: 'hidden-live',
            cliType: 'codex',
            attempt: 1,
            outcome: 'success',
            createdAt: 300,
          }),
        ],
      });
      await snapshotPromise;
    });

    expect(getRouteLogRowByRequestId('hidden-live')).toBeInTheDocument();
  });

  it('estimates per-call route costs without usage and skips failed attempts', async () => {
    vi.mocked(routeApi.getRequestLogs).mockResolvedValue({
      success: true,
      data: [
        buildRouteLog({
          id: 'route-per-call-success',
          requestId: 'per-call-success',
          cliType: 'codex',
          attempt: 1,
          outcome: 'success',
          createdAt: 100,
          requestedModel: 'per-call-direct',
          canonicalModel: 'per-call-direct',
          resolvedModel: 'per-call-direct',
          statusCode: 200,
        }),
        buildRouteLog({
          id: 'route-per-call-failure',
          requestId: 'per-call-failure',
          cliType: 'codex',
          attempt: 1,
          outcome: 'failure',
          createdAt: 200,
          requestedModel: 'per-call-direct',
          canonicalModel: 'per-call-direct',
          resolvedModel: 'per-call-direct',
          statusCode: 500,
          error: 'upstream_failed',
        }),
        buildRouteLog({
          id: 'route-per-call-object',
          requestId: 'per-call-object',
          cliType: 'codex',
          attempt: 1,
          outcome: 'success',
          createdAt: 300,
          requestedModel: 'per-call-object',
          canonicalModel: 'per-call-object',
          resolvedModel: 'per-call-object',
          statusCode: 200,
        }),
      ],
    });

    render(<LogsPage />);

    await waitFor(() => {
      expect(routeApi.getRequestLogs).toHaveBeenCalledWith({ limit: 200 });
    });

    await waitFor(() => expect(screen.getAllByTestId('route-request-log-row')).toHaveLength(3));
    const rows = screen.getAllByTestId('route-request-log-row');
    expect(within(rows[0]).getByTestId('route-request-token-summary')).toHaveTextContent(
      'T 0IN 0OUT 0C.R 0C.W 0'
    );
    expect(within(rows[0]).getByTestId('route-request-cost')).toHaveTextContent('0.5');
    expect(
      within(rows[0]).queryByRole('button', {
        name: '预计金额计算公式',
      })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(within(rows[1]).getByTestId('route-request-cost')).toHaveTextContent('0');
    expect(
      within(rows[1]).queryByRole('button', { name: '预计金额计算公式' })
    ).not.toBeInTheDocument();
    expect(within(rows[2]).getByTestId('route-request-cost')).toHaveTextContent('1');
    expect(
      within(rows[2]).queryByRole('button', { name: '预计金额计算公式' })
    ).not.toBeInTheDocument();
  });

  it('filters route request logs by CLI and updates summary counts', async () => {
    vi.mocked(routeApi.getRequestLogs).mockResolvedValue({
      success: true,
      data: [
        buildRouteLog({
          id: 'route-filter-codex',
          requestId: 'codex-filter',
          cliType: 'codex',
          attempt: 1,
          outcome: 'success',
          createdAt: 100,
        }),
        buildRouteLog({
          id: 'route-filter-claude',
          requestId: 'claude-filter',
          cliType: 'claudeCode',
          attempt: 1,
          outcome: 'failure',
          createdAt: 200,
          error: 'claude_failed',
        }),
        buildRouteLog({
          id: 'route-filter-gemini',
          requestId: 'gemini-filter',
          cliType: 'geminiCli',
          attempt: 1,
          outcome: 'success',
          createdAt: 300,
        }),
      ],
    });

    render(<LogsPage />);

    await waitFor(() => expect(screen.getAllByTestId('route-request-log-row')).toHaveLength(3));
    expect(screen.getAllByTestId('route-request-log-row')).toHaveLength(3);
    const rows = screen.getAllByTestId('route-request-log-row');
    expect(within(rows[1]).getByTestId('route-request-cli-icon')).toHaveAttribute(
      'aria-label',
      'Claude Code'
    );
    expect(within(rows[1]).getByTestId('route-request-cli-icon').className).not.toMatch(
      /bg-|border/
    );
    expect(within(rows[2]).getByTestId('route-request-cli-icon')).toHaveAttribute(
      'aria-label',
      'Gemini CLI'
    );
    expect(within(rows[2]).getByTestId('route-request-cli-icon').className).not.toMatch(
      /bg-|border/
    );
    expect(screen.getByText('总尝试').parentElement).toHaveTextContent('总尝试3');

    fireEvent.click(screen.getByRole('button', { name: 'Claude Code' }));

    expect(screen.getByRole('button', { name: 'Claude Code' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getAllByTestId('route-request-log-row')).toHaveLength(1);
    expect(getRouteLogRowByRequestId('claude-filter')).toBeInTheDocument();
    expect(findRouteLogRowByRequestId('codex-filter')).toBeUndefined();
    expect(findRouteLogRowByRequestId('gemini-filter')).toBeUndefined();
    expect(screen.getByText('总尝试').parentElement).toHaveTextContent('总尝试1');
    const successStat = screen
      .getAllByText('成功')
      .find(element => element.parentElement?.textContent === '成功0');
    expect(successStat?.parentElement).toHaveTextContent('成功0');
    const failureStat = screen
      .getAllByText('失败')
      .find(element => element.parentElement?.textContent === '失败1');
    expect(failureStat?.parentElement).toHaveTextContent('失败1');
    expect(screen.getByText('1 条')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Gemini CLI' }));

    expect(screen.getAllByTestId('route-request-log-row')).toHaveLength(1);
    expect(getRouteLogRowByRequestId('gemini-filter')).toBeInTheDocument();
    expect(findRouteLogRowByRequestId('claude-filter')).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: '全部' }));

    expect(screen.getAllByTestId('route-request-log-row')).toHaveLength(3);
    expect(screen.getByText('3 条')).toBeInTheDocument();
  });

  it('shows upstream failure details without repeating the status code', async () => {
    vi.mocked(routeApi.getRequestLogs).mockResolvedValue({
      success: true,
      data: [
        buildRouteLog({
          id: 'route-code-only-failure',
          requestId: 'code-only-failure',
          cliType: 'codex',
          attempt: 1,
          outcome: 'failure',
          createdAt: 200,
          statusCode: 500,
          error: 'HTTP 500',
        }),
        buildRouteLog({
          id: 'route-upstream-failure',
          requestId: 'upstream-failure',
          cliType: 'codex',
          attempt: 1,
          outcome: 'failure',
          createdAt: 100,
          statusCode: 503,
          error: 'quota_exceeded: upstream quota exhausted',
        }),
      ],
    });

    render(<LogsPage />);

    await waitFor(() => {
      expect(routeApi.getRequestLogs).toHaveBeenCalledWith({ limit: 200 });
    });

    await waitFor(() => expect(getRouteLogRowByRequestId('upstream-failure')).toBeInTheDocument());
    const codeOnlyRow = findRouteLogRowByRequestId('code-only-failure');
    const upstreamRow = findRouteLogRowByRequestId('upstream-failure');

    expect(codeOnlyRow).toBeDefined();
    expect(upstreamRow).toBeDefined();
    if (!codeOnlyRow || !upstreamRow) {
      return;
    }

    expect(within(codeOnlyRow).getByTestId('route-request-status-code')).toHaveTextContent('500');
    expect(within(codeOnlyRow).queryByText('HTTP 500')).not.toBeInTheDocument();
    expect(within(codeOnlyRow).queryByTestId('route-request-failure-info')).not.toBeInTheDocument();

    const failureInfo = within(upstreamRow).getByTestId('route-request-failure-info');
    expect(within(upstreamRow).getByTestId('route-request-status-code')).toHaveTextContent('503');
    expect(within(upstreamRow).queryByText('HTTP 503')).not.toBeInTheDocument();
    expect(failureInfo).toHaveTextContent('quota_exceeded: upstream quota exhausted');
    expect(failureInfo.style.gridTemplateColumns).toBe(ROUTE_LOG_RESPONSIVE_GRID_TEMPLATE);
    expect(failureInfo).toHaveClass('gap-x-2');
    expect(failureInfo).not.toHaveAttribute('title');
    expect(failureInfo).not.toHaveTextContent('503');
  });
});
