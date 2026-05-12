import { useState, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CliUsabilityTab } from '../renderer/components/Route/Usability/CliUsabilityTab';

const now = Date.now();
const { fetchCliProbeDataMock, runProbeNowMock, saveCliProbeConfigMock } = vi.hoisted(() => ({
  fetchCliProbeDataMock: vi.fn(),
  runProbeNowMock: vi.fn(),
  saveCliProbeConfigMock: vi.fn(),
}));

vi.mock('zustand/shallow', () => ({
  useShallow: (selector: unknown) => selector,
}));

vi.mock('../renderer/store/toastStore', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../renderer/store/routeStore', () => ({
  useRouteStore: (
    selector: (store: {
      config: { cliProbe: { config: { enabled: boolean; intervalMinutes: number } } };
      loading: boolean;
      cliProbeView: Array<{
        siteId: string;
        siteName: string;
        accountId: string;
        accountName: string;
        isFallbackAccount: boolean;
        clis: Record<string, unknown>;
      }>;
      cliProbeTimeRange: string;
      cliProbeLoaded: boolean;
      cliProbeError: null;
      fetchCliProbeData: ReturnType<typeof vi.fn>;
      runProbeNow: ReturnType<typeof vi.fn>;
      saveCliProbeConfig: typeof saveCliProbeConfigMock;
    }) => unknown
  ) =>
    selector({
      config: {
        cliProbe: { config: { enabled: true, intervalMinutes: 240 } },
      },
      loading: false,
      cliProbeView: [
        {
          siteId: 'site-1',
          siteName: 'Demo Site',
          accountId: 'acct-default',
          accountName: '默认账户',
          isFallbackAccount: false,
          clis: {
            claudeCode: {
              cliType: 'claudeCode',
              enabled: false,
              accountId: 'acct-default',
              accountName: '默认账户',
              isFallbackAccount: false,
              models: [],
            },
            codex: {
              cliType: 'codex',
              enabled: true,
              accountId: 'acct-default',
              accountName: '默认账户',
              isFallbackAccount: false,
              models: [
                {
                  canonicalModel: 'gpt-4.1',
                  success: true,
                  testedAt: now - 2 * 60 * 60 * 1000,
                  totalLatencyMs: 1200,
                  codexDetail: { responses: true },
                  history: [
                    {
                      sampleId: 'sample-1',
                      probeRunId: 'run-codex-1',
                      probeKey: 'site-1:acct-default:codex:gpt-4.1',
                      siteId: 'site-1',
                      accountId: 'acct-default',
                      cliType: 'codex',
                      canonicalModel: 'gpt-4.1',
                      rawModel: 'gpt-4.1',
                      success: true,
                      source: 'siteManual',
                      testedAt: now - 2 * 60 * 60 * 1000,
                    },
                  ],
                },
                {
                  canonicalModel: 'gpt-4.1-mini',
                  success: false,
                  testedAt: now - 60 * 60 * 1000,
                  totalLatencyMs: 1800,
                  error: 'rate limited '.repeat(24),
                  history: [
                    {
                      sampleId: 'sample-2',
                      probeRunId: 'run-codex-1',
                      probeKey: 'site-1:acct-default:codex:gpt-4.1-mini',
                      siteId: 'site-1',
                      accountId: 'acct-default',
                      cliType: 'codex',
                      canonicalModel: 'gpt-4.1-mini',
                      rawModel: 'gpt-4.1-mini',
                      success: false,
                      source: 'routeProbe',
                      error: 'rate limited '.repeat(24),
                      testedAt: now - 60 * 60 * 1000,
                    },
                  ],
                },
              ],
            },
            geminiCli: {
              cliType: 'geminiCli',
              enabled: true,
              accountId: 'acct-default',
              accountName: '默认账户',
              isFallbackAccount: false,
              models: [
                {
                  canonicalModel: 'gemini-2.5-pro',
                  success: true,
                  testedAt: now - 3 * 60 * 60 * 1000,
                  totalLatencyMs: 1400,
                  geminiDetail: { native: true, proxy: false },
                  history: [
                    {
                      sampleId: 'sample-3',
                      probeRunId: 'run-gemini-1',
                      probeKey: 'site-1:acct-default:geminiCli:gemini-2.5-pro',
                      siteId: 'site-1',
                      accountId: 'acct-default',
                      cliType: 'geminiCli',
                      canonicalModel: 'gemini-2.5-pro',
                      rawModel: 'gemini-2.5-pro',
                      success: true,
                      source: 'routeProbe',
                      testedAt: now - 3 * 60 * 60 * 1000,
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      cliProbeTimeRange: '7d',
      cliProbeLoaded: true,
      cliProbeError: null,
      fetchCliProbeData: fetchCliProbeDataMock,
      runProbeNow: runProbeNowMock,
      saveCliProbeConfig: saveCliProbeConfigMock,
    }),
}));

function CliUsabilityHarness() {
  const [actions, setActions] = useState<ReactNode | null>(null);

  return (
    <>
      <div data-testid="page-header-actions">{actions}</div>
      <CliUsabilityTab setPageHeaderActions={setActions} />
    </>
  );
}

describe('CliUsabilityTab', () => {
  it('renders inline settings, icon headers, availability rate, and disabled reminder text', async () => {
    fetchCliProbeDataMock.mockReset().mockResolvedValue(undefined);
    runProbeNowMock.mockReset().mockResolvedValue(null);
    saveCliProbeConfigMock.mockReset().mockResolvedValue(undefined);
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function mockGetBoundingClientRect(this: HTMLElement) {
        if (this.getAttribute('data-testid') === 'cli-history-track') {
          return {
            x: 0,
            y: 0,
            width: 353,
            height: 24,
            top: 0,
            right: 353,
            bottom: 24,
            left: 0,
            toJSON: () => ({}),
          };
        }

        return originalGetBoundingClientRect.call(this);
      });
    render(<CliUsabilityHarness />);

    const headerActions = screen.getByTestId('page-header-actions');
    const intervalInput = (await screen.findByLabelText('检测间隔（小时）')) as HTMLInputElement;
    expect(intervalInput).toBeInTheDocument();
    expect(intervalInput).toHaveValue(4);
    expect(intervalInput).toHaveAttribute('min', '2');
    expect(within(headerActions).getByRole('button', { name: '关闭定时检测' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('打开检测设置')).not.toBeInTheDocument();

    expect(screen.getByAltText('Claude Code')).toBeInTheDocument();
    expect(screen.getByAltText('Codex')).toBeInTheDocument();
    expect(screen.getByAltText('Gemini CLI')).toBeInTheDocument();

    expect(screen.getByText('该站点未启用此 CLI')).toHaveClass('text-[var(--text-secondary)]');
    expect(
      screen.queryByText('请先在站点 CLI 配置中开启后再查看可用性结果')
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '24h' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '7d' })).not.toBeInTheDocument();
    expect(screen.getAllByText('最近7天可用率')).toHaveLength(2);
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    const gridCard = screen.getByTestId('cli-usability-grid-card');
    expect(gridCard).not.toHaveAttribute('data-perf-monitor', 'blur');
    expect(gridCard).toHaveClass('border-y', 'bg-[var(--surface-1)]', 'shadow-none');
    expect(gridCard.className).not.toContain('rounded-');
    expect(screen.getByTestId('cli-usability-row-site-1-acct-default').className).toContain(
      '[content-visibility:auto]'
    );
    expect(screen.getByText('账户: 默认账户')).toBeInTheDocument();
    expect(screen.queryByText('模型2')).not.toBeInTheDocument();
    expect(screen.queryByText('模型3')).not.toBeInTheDocument();
    expect(screen.queryByText('未配置')).not.toBeInTheDocument();
    expect(screen.getAllByText(/\d{2}\/\d{2}\s+\d{2}:\d{2}/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\bAM\b|\bPM\b/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId('cli-history-frame')[0].className).toContain('overflow-hidden');
    expect(screen.getAllByTestId('cli-history-frame')[0].className).toContain('rounded-[8px]');
    expect(screen.getAllByTestId('cli-history-frame')[0].className).toContain('p-[2px]');
    await waitFor(() =>
      expect(screen.getAllByTestId('cli-history-track')[0]).toHaveAttribute('data-bar-width', '10')
    );
    expect(screen.getAllByTestId('cli-history-track')[0]).toHaveAttribute('data-gap-px', '1.065');
    expect(screen.getAllByTestId('cli-history-track')[0].getAttribute('style')).toContain(
      'grid-template-columns: repeat(32, 10px);'
    );
    expect(screen.getAllByTestId('cli-history-track')[0].getAttribute('style')).toContain(
      'height: 24px;'
    );

    expect(screen.getAllByTestId('cli-history-track')[0].children).toHaveLength(32);
    const codexHistoryTitle = screen.getByTitle(
      /检测批次：run-codex-1[\s\S]*模型：gpt-4\.1[\s\S]*模型：gpt-4\.1-mini/
    );
    expect(codexHistoryTitle).toHaveAttribute('title', expect.not.stringContaining('来源：'));
    expect(codexHistoryTitle).toHaveClass('bg-[var(--warning)]');
    const codexHistoryTooltip = codexHistoryTitle.getAttribute('title') ?? '';
    expect(codexHistoryTooltip).toContain('rate limited '.repeat(22));
    expect(codexHistoryTooltip).not.toContain('rate limited '.repeat(23));
    expect(screen.getAllByTitle(/模型：gpt-4\.1-mini/).length).toBeGreaterThan(0);
    expect(screen.getAllByTitle(/模型：gemini-2\.5-pro/).length).toBeGreaterThan(0);
    expect(codexHistoryTitle).toHaveAttribute('title', expect.stringContaining('结果：兼容'));
    expect(codexHistoryTitle).toHaveAttribute('title', expect.stringContaining('结果：失败'));
    expect(screen.queryByTestId('cli-history-manual-marker-track')).not.toBeInTheDocument();

    fireEvent.change(intervalInput, { target: { value: '' } });
    expect(intervalInput.value).toBe('');

    fireEvent.change(intervalInput, { target: { value: '6' } });

    await waitFor(() =>
      expect(saveCliProbeConfigMock).toHaveBeenCalledWith({
        enabled: true,
        intervalMinutes: 360,
      })
    );
    rectSpy.mockRestore();
  });
});
