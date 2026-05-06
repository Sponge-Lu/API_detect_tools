import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    error: partial.error,
  };
}

describe('LogsPage', () => {
  const routeApi = window.electronAPI.route!;

  beforeEach(() => {
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
    const rows = screen.getAllByTestId('route-request-log-row');
    expect(rows[0]).toHaveClass('px-4', 'py-2.5', '[contain-intrinsic-size:104px]');
    expect(rows[0]).not.toHaveClass('py-4');
    expect(screen.getByText('HTTP 502')).toBeInTheDocument();
    expect(screen.getByText('站点 A')).toBeInTheDocument();
    expect(screen.getByText('Key Alpha')).toBeInTheDocument();
    expect(screen.getAllByText('Codex 主路由').length).toBeGreaterThan(0);
    const failureInfo = within(rows[0]).getByTestId('route-request-failure-info');
    expect(failureInfo).toHaveTextContent('失败信息no_matching_rule');
    expect(failureInfo).toHaveClass('overflow-hidden', 'whitespace-nowrap');
    expect(within(rows[1]).queryByTestId('route-request-failure-info')).not.toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('请求原始模型gpt-5.4');
    expect(rows[0]).toHaveTextContent('站点优先级2');
    expect(rows[0]).toHaveTextContent('总Token150');
    expect(rows[0]).toHaveTextContent('输入Token100');
    expect(rows[0]).toHaveTextContent('输出Token50');
    expect(rows[0]).toHaveTextContent('预计金额≈0.4');
    expect(rows[0]).toHaveTextContent('仅供参考，未计缓存价格');
    expect(rows[1]).toHaveTextContent('站点优先级1');
    expect(rows[1]).toHaveTextContent('请求原始模型gpt-5.4-mini');
    expect(rows[1]).toHaveTextContent('预计金额≈0.0027');
    expect(rows[2]).toHaveTextContent('站点DuckCoding');
    expect(rows[2]).toHaveTextContent('账户无');
    expect(rows[2]).toHaveTextContent('分组无');
    expect(rows[2]).toHaveTextContent('API Key默认');
    expect(rows[2]).toHaveTextContent('预计金额无');
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
});
