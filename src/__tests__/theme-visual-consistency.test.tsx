import fs from 'node:fs';
import path from 'node:path';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalCommandBar } from '../renderer/components/AppShell/GlobalCommandBar';
import { ModelRedirectionTab } from '../renderer/components/Route/Redirection/ModelRedirectionTab';
import { CliUsabilityTab } from '../renderer/components/Route/Usability/CliUsabilityTab';
import { ProxyStatsTab } from '../renderer/components/Route/ProxyStats/ProxyStatsTab';

vi.mock('zustand/shallow', () => ({
  useShallow: (selector: unknown) => selector,
}));

vi.mock('../renderer/components/CliConfigStatus', () => ({
  CliConfigStatusPanel: () => <div>Mock CLI Status</div>,
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

describe('theme visual consistency', () => {
  it('defines shared semantic surface and state tokens in index.css', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../renderer/index.css'),
      'utf8'
    );

    expect(css).toContain('--ios-surface-muted');
    expect(css).toContain('--ios-surface-soft');
    expect(css).toContain('--ios-accent-soft');
    expect(css).toContain('--ios-accent-soft-strong');
    expect(css).toContain('--ios-success-soft');
    expect(css).toContain('--ios-warning-soft');
    expect(css).toContain('--ios-danger-soft');
    expect(css).toContain('--ios-icon-muted');
  });

  it('keeps the global command bar on theme tokens instead of hardcoded gray and blue utilities', () => {
    const { container } = render(
      <GlobalCommandBar
        saving
        updateInfo={{
          hasUpdate: true,
          latestVersion: '3.1.0',
          releaseInfo: {
            version: '3.1.0',
            releaseDate: '2026-04-01',
            releaseNotes: 'notes',
            mandatory: false,
            downloadUrl: 'https://example.com/download',
          },
        }}
      />
    );

    expect(container.firstChild).toHaveClass(
      'bg-[var(--surface-1)]/90',
      'border-b',
      'border-[var(--line-soft)]'
    );
    expect(container.innerHTML).not.toContain('--ios-');
    expect(container.innerHTML).not.toContain('bg-blue-50');
    expect(container.innerHTML).not.toContain('border-gray-200');
  });

  it('keeps route tabs on semantic tokens instead of raw gray and blue palette utilities', async () => {
    const { container } = render(
      <>
        <ModelRedirectionTab />
        <CliUsabilityTab />
        <ProxyStatsTab />
      </>
    );

    await waitFor(() => {
      expect(mockGetAnalyticsSummary).toHaveBeenCalled();
    });

    expect(container.innerHTML).not.toContain('bg-blue-50');
    expect(container.innerHTML).not.toContain('border-gray-200');
    expect(container.innerHTML).not.toContain('text-gray-500');
    expect(container.innerHTML).not.toContain('bg-green-50');
  });
});
