import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelRedirectionTab } from '../renderer/components/Route/Redirection/ModelRedirectionTab';
import { CliUsabilityTab } from '../renderer/components/Route/Usability/CliUsabilityTab';
import { ProxyStatsTab } from '../renderer/components/Route/ProxyStats/ProxyStatsTab';

vi.mock('zustand/shallow', () => ({
  useShallow: (selector: unknown) => selector,
}));

vi.mock('../renderer/store/routeStore', () => ({
  useRouteStore: (selector: any) =>
    selector({
      config: {
        modelRegistry: {
          entries: {
            'claude-3-5-sonnet': {
              vendor: 'claude',
              canonicalName: 'claude-3-5-sonnet',
              aliases: ['claude-sonnet'],
              sources: [],
              hasOverride: false,
            },
          },
        },
        cliProbe: { config: { enabled: true, intervalMinutes: 60 } },
        cliModelSelections: { claudeCode: 'claude-3-5-sonnet', codex: null, geminiCli: null },
        server: { host: '127.0.0.1', port: 3000, unifiedApiKey: 'route-key' },
      },
      loading: false,
      cliProbeView: [],
      cliProbeTimeRange: '24h',
      cliProbeLoaded: true,
      cliProbeError: null,
      serverRunning: true,
      rebuildModelRegistry: vi.fn(),
      fetchCliProbeData: vi.fn(),
      runProbeNow: vi.fn(),
      saveCliProbeConfig: vi.fn(),
      saveCliModelSelections: vi.fn(),
      saveServerConfig: vi.fn(),
      regenerateApiKey: vi.fn(),
      startServer: vi.fn(),
      stopServer: vi.fn(),
  }),
}));

const mockGetAnalyticsSummary = vi.fn();

beforeEach(() => {
  (window as any).electronAPI.route = {
    getAnalyticsSummary: mockGetAnalyticsSummary.mockResolvedValue({
      success: true,
      data: {
        totalRequests: 12,
        successRate: 100,
        promptTokens: 2048,
        completionTokens: 1024,
      },
    }),
  };
});

describe('route workbench redesign', () => {
  it('keeps route tabs free of the extra workbench header wrapper', async () => {
    render(
      <>
        <ModelRedirectionTab />
        <CliUsabilityTab />
        <ProxyStatsTab />
      </>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('route-workbench-header')).not.toBeInTheDocument();
    });
    expect(screen.getByText('厂商目录')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开检测设置' })).toBeInTheDocument();
    await screen.findByText('总请求');
  });

  it('opens route probe settings as a shared dialog from the page-local action cluster', async () => {
    render(<CliUsabilityTab />);

    fireEvent.click(screen.getByRole('button', { name: '打开检测设置' }));

    expect(await screen.findByRole('dialog', { name: '检测设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
    expect(screen.queryByTestId('route-workbench-header')).not.toBeInTheDocument();
  });

  it('keeps each route tab on its page-local content skeleton without a sticky workbench shell', async () => {
    const { rerender } = render(<ModelRedirectionTab />);

    expect(screen.getByText('厂商目录')).toBeInTheDocument();
    expect(screen.getByText('claude-3-5-sonnet')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet')).toBeInTheDocument();
    expect(screen.queryByText('工作台视图')).not.toBeInTheDocument();

    rerender(<CliUsabilityTab />);

    expect(screen.getByRole('button', { name: '打开检测设置' })).toBeInTheDocument();
    expect(screen.getByText('暂无探测数据，请先启用 CLI 探测或点击「立即探测」')).toBeInTheDocument();
    expect(screen.queryByText('工作台视图')).not.toBeInTheDocument();

    rerender(<ProxyStatsTab />);

    await screen.findByText('总请求');
    expect(screen.getByText('代理服务器')).toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
    expect(screen.queryByText('工作台视图')).not.toBeInTheDocument();
  });
});
