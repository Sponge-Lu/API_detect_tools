import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('removes remaining legacy ios tokens and utilities from route runtime surfaces', () => {
    const routeFiles = [
      'src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx',
      'src/renderer/components/Route/Usability/CliUsabilityTab.tsx',
      'src/renderer/components/Route/ProxyStats/ProxyStatsTab.tsx',
    ];

    routeFiles.forEach(relativePath => {
      const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
      expect(source).not.toContain('--ios-');
      expect(source).not.toContain('ios-icon-button');
      expect(source).not.toContain('ios-icon ios-icon');
    });

    const usabilitySource = readFileSync(
      join(process.cwd(), 'src/renderer/components/Route/Usability/CliUsabilityTab.tsx'),
      'utf8'
    );

    expect(usabilitySource).toMatch(/from ['"].*AppModal\/AppModal['"]/);
    expect(usabilitySource).not.toMatch(/from ['"].*IOSModal['"]/);
  });
});
