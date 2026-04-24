import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CliUsabilityTab } from '../renderer/components/Route/Usability/CliUsabilityTab';

const now = Date.now();
const { saveCliProbeConfigMock } = vi.hoisted(() => ({
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
        cliProbe: { config: { enabled: true, intervalMinutes: 60 } },
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
                      probeKey: 'site-1:acct-default:codex:gpt-4.1',
                      siteId: 'site-1',
                      accountId: 'acct-default',
                      cliType: 'codex',
                      canonicalModel: 'gpt-4.1',
                      rawModel: 'gpt-4.1',
                      success: true,
                      source: 'routeProbe',
                      testedAt: now - 2 * 60 * 60 * 1000,
                    },
                  ],
                },
                {
                  canonicalModel: 'gpt-4.1-mini',
                  success: false,
                  testedAt: now - 60 * 60 * 1000,
                  totalLatencyMs: 1800,
                  error: 'rate limited',
                  history: [
                    {
                      sampleId: 'sample-2',
                      probeKey: 'site-1:acct-default:codex:gpt-4.1-mini',
                      siteId: 'site-1',
                      accountId: 'acct-default',
                      cliType: 'codex',
                      canonicalModel: 'gpt-4.1-mini',
                      rawModel: 'gpt-4.1-mini',
                      success: false,
                      source: 'routeProbe',
                      error: 'rate limited',
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
      cliProbeTimeRange: '24h',
      cliProbeLoaded: true,
      cliProbeError: null,
      fetchCliProbeData: vi.fn(),
      runProbeNow: vi.fn(),
      saveCliProbeConfig: saveCliProbeConfigMock,
    }),
}));

describe('CliUsabilityTab', () => {
  it('renders inline settings, icon headers, availability rate, and disabled reminder text', async () => {
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
    render(<CliUsabilityTab />);

    const intervalInput = screen.getByLabelText('检测间隔（分钟）') as HTMLInputElement;
    expect(intervalInput).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存设置' })).toBeInTheDocument();
    expect(screen.queryByLabelText('打开检测设置')).not.toBeInTheDocument();

    expect(screen.getByAltText('Claude Code')).toBeInTheDocument();
    expect(screen.getByAltText('Codex')).toBeInTheDocument();
    expect(screen.getByAltText('Gemini CLI')).toBeInTheDocument();

    expect(screen.getByText('该站点未启用此 CLI')).toHaveClass('text-[var(--text-secondary)]');
    expect(
      screen.queryByText('请先在站点 CLI 配置中开启后再查看可用性结果')
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('最近24小时可用率')).toHaveLength(2);
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByTestId('cli-usability-grid-card')).not.toHaveAttribute(
      'data-perf-monitor',
      'blur'
    );
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

    const aggregatedTooltip = screen.getAllByTitle(/gpt-4\.1:[\s\S]*gpt-4\.1-mini:/)[0];
    expect(aggregatedTooltip).toBeInTheDocument();
    expect(screen.getByTitle(/模型：gpt-4\.1-mini/)).toBeInTheDocument();

    fireEvent.change(intervalInput, { target: { value: '' } });
    expect(intervalInput.value).toBe('');

    fireEvent.change(intervalInput, { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() =>
      expect(saveCliProbeConfigMock).toHaveBeenCalledWith({
        enabled: true,
        intervalMinutes: 120,
      })
    );
    rectSpy.mockRestore();
  });
});
