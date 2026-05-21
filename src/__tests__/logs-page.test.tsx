import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteRequestLogItem } from '../shared/types/route-proxy';
import type { Config } from '../renderer/App';
import { LogsPage } from '../renderer/pages/LogsPage';
import { useConfigStore } from '../renderer/store/configStore';
import { useToastStore, type AppEventItem } from '../renderer/store/toastStore';

function buildEvent(
  partial: Partial<AppEventItem> & Pick<AppEventItem, 'id' | 'message'>
): AppEventItem {
  return {
    id: partial.id,
    kind: partial.kind ?? 'toast',
    level: partial.level ?? 'info',
    source: partial.source ?? 'notification',
    message: partial.message,
    createdAt: partial.createdAt ?? Date.now(),
  };
}

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
    useToastStore.setState({
      toasts: [],
      eventHistory: [],
    });
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
                sourceKeys: ['source-site-a-gpt'],
                priorityConfig: {
                  sitePriorities: { 'site-1': 2 },
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

  it('filters session events by notification and action kinds and clears history', () => {
    useToastStore.setState({
      eventHistory: [
        buildEvent({
          id: 'event-1',
          kind: 'toast',
          level: 'error',
          source: 'notification',
          message: '通知：模型重定向目录已重建',
          createdAt: 1,
        }),
        buildEvent({
          id: 'event-2',
          kind: 'action',
          level: 'success',
          source: 'route',
          message: '操作：模型重定向已更新',
          createdAt: 2,
        }),
      ],
    });

    render(<LogsPage />);

    expect(screen.getByText('总记录').parentElement).toHaveTextContent('总记录2');
    const notificationStat = screen
      .getAllByText('通知')
      .find(element => element.parentElement?.textContent === '通知1');
    expect(notificationStat?.parentElement).toHaveTextContent('通知1');
    expect(screen.getByText('关键操作').parentElement).toHaveTextContent('关键操作1');
    expect(screen.queryByRole('button', { name: '会话事件' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '路由日志' })).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        '这里会保留本次启动后的通知与关键操作记录。Toast 只显示摘要，完整内容在此页查看。'
      )
    ).not.toBeInTheDocument();
    expect(screen.getByText('通知：模型重定向目录已重建')).toBeInTheDocument();
    expect(screen.getByText('操作：模型重定向已更新')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '通知' }));
    expect(screen.getByText('通知：模型重定向目录已重建')).toBeInTheDocument();
    expect(screen.queryByText('操作：模型重定向已更新')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '操作' }));
    expect(screen.queryByText('通知：模型重定向目录已重建')).not.toBeInTheDocument();
    expect(screen.getByText('操作：模型重定向已更新')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清空会话记录' }));
    expect(useToastStore.getState().eventHistory).toHaveLength(0);
    expect(screen.getByText('暂无会话记录')).toBeInTheDocument();
    expect(screen.queryByText(/当前筛选条件下还没有通知或关键操作/)).not.toBeInTheDocument();
  });

  it('renders route request details from the route log subpage and clears logs', async () => {
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

    render(<LogsPage activeView="route" />);

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

    expect(await screen.findByText('请求 codex-1')).toBeInTheDocument();
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
    const rows = screen.getAllByTestId('route-request-log-row');
    expect(rows[0]).toHaveClass('px-4', 'py-2.5', '[contain-intrinsic-size:96px]');
    expect(rows[0]).not.toHaveClass('py-4');
    expect(screen.getByText('HTTP 502')).toBeInTheDocument();
    const metaLine = within(rows[0]).getByTestId('route-request-meta-line');
    expect(metaLine).toHaveClass('md:grid-cols-[minmax(0,1fr)_auto]');
    expect(within(rows[0]).getByText('Codex')).toHaveClass(
      'border-[#93afa4]',
      'bg-[#93afa4]',
      'text-white'
    );
    expect(within(rows[0]).getByText('请求 codex-1')).toHaveAttribute(
      'title',
      'Codex 请求 通配匹配 gpt-* 时生效；范围：全部站点'
    );
    expect(metaLine).toHaveTextContent(/尝试 #1失败信息no_matching_ruleHTTP 502/);
    const targetLine = within(rows[0]).getByTestId('route-request-target-line');
    expect(targetLine).toHaveTextContent('重定向模型gpt-5.4');
    expect(targetLine).toHaveTextContent('请求原始模型gpt-5.4');
    expect(targetLine).toHaveTextContent('站点站点 A优先级 2');
    expect(targetLine).toHaveTextContent('账户主账户');
    expect(targetLine).toHaveTextContent('分组vip');
    expect(targetLine).toHaveTextContent('API KeyKey Alpha');
    const sitePriorityPill = within(targetLine).getByTestId('route-request-site-priority');
    expect(sitePriorityPill).toHaveTextContent('优先级 2');
    expect(sitePriorityPill).toHaveClass('bg-[var(--accent-soft-strong)]');
    expect(within(sitePriorityPill).getByText('2')).toHaveClass('text-[var(--text-primary)]');
    const redirectArrow = within(targetLine).getByLabelText('指向重定向模型');
    expect(redirectArrow).toHaveTextContent('←');
    expect(redirectArrow).toHaveClass('h-4', 'text-[var(--text-tertiary)]');
    expect(within(targetLine).queryByText('<-')).not.toBeInTheDocument();
    expect(within(rows[0]).getByText('Key Alpha')).toBeInTheDocument();
    expect(within(rows[0]).getByText('尝试 #1')).toHaveClass('h-5', 'py-0');
    const failureInfo = within(rows[0]).getByTestId('route-request-failure-info');
    expect(failureInfo).toHaveTextContent('失败信息no_matching_rule');
    expect(failureInfo).toHaveClass('h-5', 'py-0', 'rounded-full', 'md:max-w-[32rem]');
    expect(within(rows[1]).queryByTestId('route-request-failure-info')).not.toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('请求原始模型gpt-5.4');
    expect(rows[0]).toHaveTextContent('站点站点 A优先级 2');
    expect(rows[0]).toHaveTextContent('总Token150');
    expect(rows[0]).toHaveTextContent('输入Token100');
    expect(rows[0]).toHaveTextContent('输出Token50');
    expect(rows[0]).toHaveTextContent('缓存创建20');
    expect(rows[0]).toHaveTextContent('缓存命中40');
    expect(targetLine.firstElementChild).toHaveClass('py-0', 'text-[11px]', 'leading-4');
    expect(within(rows[0]).getByTestId('route-request-token-line').firstElementChild).toHaveClass(
      'py-0',
      'text-[11px]',
      'leading-4'
    );
    expect(rows[0]).toHaveTextContent('预计金额≈4.58e-7');
    const formulaButton = within(rows[0]).getByRole('button', { name: '预计金额计算公式' });
    fireEvent.mouseEnter(formulaButton);
    const formulaTooltip = await screen.findByRole('tooltip');
    expect(formulaTooltip).toHaveTextContent(
      '仅供参考，不是实际花费金额；模型价格按每 1M token 计，缓存创建按输入价 1.25 倍、缓存命中按输入价 1/10 计入。'
    );
    await waitFor(() => {
      expect(Number.parseFloat(formulaTooltip.style.left)).toBeGreaterThanOrEqual(8);
      expect(Number.parseFloat(formulaTooltip.style.top)).toBeGreaterThanOrEqual(8);
      expect(Number.parseFloat(formulaTooltip.style.maxWidth)).toBeLessThanOrEqual(
        window.innerWidth - 16
      );
    });
    expect(
      within(rows[0]).queryByText('缓存创建=输入价 1.25 倍，缓存命中=输入价 1/10')
    ).not.toBeInTheDocument();
    fireEvent.mouseLeave(formulaButton);
    expect(rows[1]).toHaveTextContent('站点站点 B优先级 1');
    expect(rows[1]).toHaveTextContent('请求原始模型gpt-5.4-mini');
    expect(rows[1]).toHaveTextContent('预计金额≈2.70e-9');
    expect(rows[2]).toHaveTextContent('站点DuckCoding优先级 0');
    expect(rows[2]).toHaveTextContent('账户无');
    expect(rows[2]).toHaveTextContent('分组无');
    expect(rows[2]).toHaveTextContent('API Key默认');
    expect(rows[2]).toHaveTextContent('预计金额无');
    expect(rows[3]).toHaveTextContent('请求 codex-cache');
    expect(rows[3]).toHaveTextContent('缓存命中40');
    expect(rows[3]).toHaveTextContent('预计金额≈1.28e-7');
    expect(screen.queryByText(/^规则说明：/)).not.toBeInTheDocument();
    expect(screen.getByText(/用时1\.23s\/首字456ms/)).toBeInTheDocument();
    expect(screen.getByText(/用时789ms\/首字120ms/)).toBeInTheDocument();
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

    render(<LogsPage activeView="route" />);

    expect(await screen.findByText('请求 initial')).toBeInTheDocument();
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
    expect(await screen.findByText('请求 live')).toBeInTheDocument();
    const rows = screen.getAllByTestId('route-request-log-row');
    expect(rows[0]).toHaveTextContent('请求 live');
    expect(rows[1]).toHaveTextContent('请求 initial');
  });

  it('keeps pushed route logs visible while switching into the route log subpage', async () => {
    let resolveSnapshot!: (value: { success: true; data: RouteRequestLogItem[] }) => void;
    const snapshotPromise = new Promise<{ success: true; data: RouteRequestLogItem[] }>(resolve => {
      resolveSnapshot = resolve;
    });
    vi.mocked(routeApi.getRequestLogs).mockReturnValueOnce(snapshotPromise);

    const { rerender } = render(<LogsPage activeView="session" />);

    await act(async () => {
      routeRequestLogListener?.(
        buildRouteLog({
          id: 'route-hidden-live',
          requestId: 'hidden-live',
          cliType: 'codex',
          attempt: 1,
          outcome: 'success',
          createdAt: 300,
        })
      );
      await Promise.resolve();
    });

    rerender(<LogsPage activeView="route" />);

    await waitFor(() => {
      expect(routeApi.getRequestLogs).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('正在加载路由日志...')).not.toBeInTheDocument();
    expect(screen.getByText('请求 hidden-live')).toBeInTheDocument();

    await act(async () => {
      resolveSnapshot({ success: true, data: [] });
      await snapshotPromise;
    });
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

    render(<LogsPage activeView="route" />);

    await waitFor(() => {
      expect(routeApi.getRequestLogs).toHaveBeenCalledWith({ limit: 200 });
    });

    const rows = screen.getAllByTestId('route-request-log-row');
    expect(rows[0]).toHaveTextContent('总Token无');
    expect(rows[0]).toHaveTextContent('预计金额≈0.5');
    const perCallFormulaButton = within(rows[0]).getByRole('button', {
      name: '预计金额计算公式',
    });
    fireEvent.mouseEnter(perCallFormulaButton);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      '仅供参考，不是实际花费金额；按单次调用价格估算。'
    );
    fireEvent.mouseLeave(perCallFormulaButton);
    expect(rows[1]).toHaveTextContent('预计金额无');
    expect(
      within(rows[1]).queryByRole('button', { name: '预计金额计算公式' })
    ).not.toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('预计金额≈1');
    expect(within(rows[2]).getByRole('button', { name: '预计金额计算公式' })).toBeInTheDocument();
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

    render(<LogsPage activeView="route" />);

    expect(await screen.findByText('请求 codex-filter')).toBeInTheDocument();
    expect(screen.getAllByTestId('route-request-log-row')).toHaveLength(3);
    const rows = screen.getAllByTestId('route-request-log-row');
    expect(within(rows[1]).getByText('Claude Code')).toHaveClass(
      'border-[#d4a093]',
      'bg-[#d4a093]',
      'text-white'
    );
    expect(within(rows[2]).getByText('Gemini CLI')).toHaveClass(
      'border-[#8aa9c7]',
      'bg-[#8aa9c7]',
      'text-white'
    );
    expect(screen.getByText('总尝试').parentElement).toHaveTextContent('总尝试3');

    fireEvent.click(screen.getByRole('button', { name: 'Claude Code' }));

    expect(screen.getByRole('button', { name: 'Claude Code' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getAllByTestId('route-request-log-row')).toHaveLength(1);
    expect(screen.getByText('请求 claude-filter')).toBeInTheDocument();
    expect(screen.queryByText('请求 codex-filter')).not.toBeInTheDocument();
    expect(screen.queryByText('请求 gemini-filter')).not.toBeInTheDocument();
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
    expect(screen.getByText('请求 gemini-filter')).toBeInTheDocument();
    expect(screen.queryByText('请求 claude-filter')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '全部' }));

    expect(screen.getAllByTestId('route-request-log-row')).toHaveLength(3);
    expect(screen.getByText('3 条')).toBeInTheDocument();
  });
});
