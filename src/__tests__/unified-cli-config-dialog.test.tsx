import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedCliConfigDialog } from '../renderer/components/dialogs/UnifiedCliConfigDialog';
import type { CliConfig } from '../shared/types/cli-config';
import { useDetectionStore } from '../renderer/store/detectionStore';
import { useRouteStore } from '../renderer/store/routeStore';
import { toast } from '../renderer/store/toastStore';
import { DEFAULT_ROUTING_CONFIG, buildProbeKey } from '../shared/types/route-proxy';
import type { ModelPricingData, UnifiedConfig } from '../shared/types/site';

vi.mock('../renderer/store/toastStore', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const initialConfig: CliConfig = {
  claudeCode: {
    apiKeyId: 1,
    model: 'claude-3-5-sonnet',
    targetProtocol: 'native',
    testModel: 'claude-3-5-sonnet',
    testModels: ['claude-3-5-sonnet', '', ''],
    testResults: [],
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
  },
  codex: {
    apiKeyId: 1,
    model: 'gpt-4.1',
    targetProtocol: 'native',
    testModel: 'gpt-4.1',
    testModels: ['gpt-4.1', '', ''],
    testResults: [],
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
  },
  geminiCli: {
    apiKeyId: 1,
    model: 'gemini-2.5-pro',
    targetProtocol: 'native',
    testModel: 'gemini-2.5-pro',
    testModels: ['gemini-2.5-pro', '', ''],
    testResults: [],
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
  },
};

const mismatchConfig: CliConfig = {
  ...initialConfig,
  codex: {
    ...initialConfig.codex!,
    editedFiles: [
      {
        path: '~/.codex/config.toml',
        content: 'base_url = "https://duckcoding.com/v1"\nwire_api = "responses"',
      },
    ],
  },
};

const groupedModelPricing: ModelPricingData = {
  data: {
    'claude-3-5-sonnet': { enable_groups: ['alpha'] },
    'gpt-4.1': { enable_groups: ['beta'] },
    'gemini-2.5-pro': { enable_groups: ['alpha', 'beta'] },
  },
};

function StatefulDialog() {
  const [currentConfig, setCurrentConfig] = useState<CliConfig>(initialConfig);

  return (
    <UnifiedCliConfigDialog
      isOpen={true}
      siteName="Claude Hub"
      siteUrl="https://example.com"
      apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
      siteModels={['claude-3-5-sonnet', 'gpt-4.1', 'gemini-2.5-pro']}
      currentConfig={currentConfig}
      onPersistConfig={async nextConfig => {
        setCurrentConfig(nextConfig);
      }}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />
  );
}

function MismatchDialog() {
  return (
    <UnifiedCliConfigDialog
      isOpen={true}
      siteName="DuckCoding"
      siteUrl="https://www.duckcoding.ai"
      apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
      siteModels={['gpt-4.1']}
      currentConfig={mismatchConfig}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />
  );
}

describe('UnifiedCliConfigDialog', () => {
  beforeEach(() => {
    useDetectionStore.setState({
      cliCompatibility: {},
      cliConfigs: {},
      cliTestingSites: new Set<string>(),
    });
    useRouteStore.setState({
      cliProbeLoaded: false,
      cliProbeTimeRange: '7d',
      fetchCliProbeData: vi.fn().mockResolvedValue(undefined),
      fetchConfig: vi.fn().mockResolvedValue(undefined),
    });

    window.electronAPI = {
      ...window.electronAPI,
      loadConfig: vi.fn().mockResolvedValue({
        sites: [],
        accounts: [],
        routing: {
          cliProbe: {
            latest: {},
          },
        },
      }),
      cliCompat: {
        ...window.electronAPI?.cliCompat,
        testWithWrapper: vi.fn().mockResolvedValue({
          success: true,
          data: {
            codex: true,
          },
        }),
        saveResult: vi.fn().mockResolvedValue({ success: true }),
      },
    };
  });

  it('keeps the selected codex tab after test-result persistence updates currentConfig', async () => {
    render(<StatefulDialog />);

    const codexTab = screen.getByText('Codex');
    await act(async () => {
      fireEvent.click(codexTab.closest('button') as HTMLButtonElement);
    });

    expect(codexTab).toHaveClass('text-[var(--accent)]');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '测试已选模型' }));
    });

    await waitFor(() =>
      expect(window.electronAPI.cliCompat.testWithWrapper).toHaveBeenCalledWith({
        siteUrl: 'https://example.com',
        configs: [
          {
            cliType: 'codex',
            apiKey: 'sk-test',
            model: 'gpt-4.1',
            baseUrl: 'https://example.com',
            targetProtocol: 'native',
          },
        ],
      })
    );
    await waitFor(() => expect(screen.getByText('Codex')).toHaveClass('text-[var(--accent)]'));
    expect(screen.getByText('Claude Code')).not.toHaveClass('text-[var(--accent)]');
  });

  it('shows a warning when edited codex config points to a different domain than the current site', async () => {
    render(<MismatchDialog />);

    await act(async () => {
      fireEvent.click(screen.getByText('Codex').closest('button') as HTMLButtonElement);
    });

    expect(
      screen.getByText(
        /检测到当前预览配置中的域名（https:\/\/duckcoding\.com）与当前站点（https:\/\/www\.duckcoding\.ai）不一致/
      )
    ).toBeInTheDocument();
  });

  it('filters model options to the selected api key group unless list-all-models is enabled', async () => {
    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="Claude Hub"
        siteUrl="https://example.com"
        apiKeys={[
          { id: 1, name: 'Alpha Key', key: 'sk-alpha', group: 'alpha' },
          { id: 2, name: 'Beta Key', key: 'sk-beta', group: 'beta' },
        ]}
        siteModels={['claude-3-5-sonnet', 'gpt-4.1', 'gemini-2.5-pro']}
        siteModelPricing={groupedModelPricing}
        currentConfig={initialConfig}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'CLI 使用模型' }));
    });

    expect(screen.getAllByText('claude-3-5-sonnet').length).toBeGreaterThan(0);
    expect(screen.getAllByText('gemini-2.5-pro').length).toBeGreaterThan(0);
    expect(screen.queryByText('gpt-4.1')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: '列出全部模型' }));
    });

    expect(screen.getAllByText('gpt-4.1').length).toBeGreaterThan(0);
  });

  it('clears out-of-group model selections when list-all-models is disabled', async () => {
    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="Claude Hub"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Alpha Key', key: 'sk-alpha', group: 'alpha' }]}
        siteModels={['claude-3-5-sonnet', 'gpt-4.1']}
        siteModelPricing={groupedModelPricing}
        currentConfig={{
          ...initialConfig,
          claudeCode: {
            ...initialConfig.claudeCode!,
            apiKeyId: 1,
            model: 'gpt-4.1',
            testModel: 'gpt-4.1',
            testModels: ['gpt-4.1', '', ''],
          },
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'CLI 使用模型' })).toHaveTextContent(
        '请选择 CLI 模型'
      );
    });
    expect(screen.getByRole('button', { name: '测试模型 1' })).toHaveTextContent(
      '请选择测试模型 1'
    );
  });

  it('persists selected-model test samples into route CLI history and refreshes the cached view', async () => {
    const fetchCliProbeDataMock = vi.fn().mockResolvedValue(undefined);
    const fetchConfigMock = vi.fn().mockResolvedValue(undefined);
    useRouteStore.setState({
      cliProbeLoaded: true,
      cliProbeTimeRange: '7d',
      fetchCliProbeData: fetchCliProbeDataMock,
      fetchConfig: fetchConfigMock,
    });

    const testedAt = 1777000000000;
    const probeKey = buildProbeKey('site-1', 'acct-1', 'codex', 'gpt-4.1');
    window.electronAPI = {
      ...window.electronAPI,
      loadConfig: vi.fn().mockResolvedValue({
        sites: [{ id: 'site-1', name: 'Claude Hub' }],
        accounts: [{ id: 'acct-1', site_id: 'site-1', account_name: 'Primary' }],
        routing: {
          cliProbe: {
            latest: {
              [probeKey]: {
                probeKey,
                siteId: 'site-1',
                accountId: 'acct-1',
                cliType: 'codex',
                canonicalModel: 'gpt-4.1',
                rawModel: 'gpt-4.1',
                healthy: true,
                lastSample: {
                  sampleId: 'sample-1',
                  probeKey,
                  siteId: 'site-1',
                  accountId: 'acct-1',
                  cliType: 'codex',
                  canonicalModel: 'gpt-4.1',
                  rawModel: 'gpt-4.1',
                  success: true,
                  source: 'siteManual',
                  codexDetail: { responses: true },
                  testedAt,
                },
              },
            },
          },
        },
      } satisfies UnifiedConfig),
      cliCompat: {
        ...window.electronAPI?.cliCompat,
        testWithWrapper: vi.fn().mockResolvedValue({
          success: true,
          data: {
            codex: true,
            codexDetail: { responses: true },
          },
          samples: [
            {
              cliType: 'codex',
              model: 'gpt-4.1',
              success: true,
              testedAt,
              codexDetail: { responses: true },
            },
          ],
        }),
        saveResult: vi.fn().mockResolvedValue({ success: true }),
      },
    };

    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="Claude Hub"
        accountId="acct-1"
        accountName="Primary"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet', 'gpt-4.1']}
        currentConfig={initialConfig}
        onPersistConfig={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Codex').closest('button') as HTMLButtonElement);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '测试已选模型' }));
    });

    await waitFor(() =>
      expect(window.electronAPI.cliCompat.saveResult).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          codex: true,
          codexDetail: { responses: true },
          testedAt: expect.any(Number),
        }),
        'acct-1',
        [
          expect.objectContaining({
            cliType: 'codex',
            model: 'gpt-4.1',
            success: true,
            testedAt,
          }),
        ]
      )
    );

    await waitFor(() => expect(fetchConfigMock).toHaveBeenCalled());
    expect(fetchCliProbeDataMock).toHaveBeenCalledWith('7d', true);
    expect(useDetectionStore.getState().cliCompatibility['Claude Hub::acct-1']).toMatchObject({
      codex: true,
      codexDetail: { responses: true },
      sourceLabel: '来自站点管理测试 · Primary',
      testedAt,
    });
  });

  it('shows selected-model failure details in the warning toast and row status', async () => {
    window.electronAPI = {
      ...window.electronAPI,
      cliCompat: {
        ...window.electronAPI?.cliCompat,
        testWithWrapper: vi.fn().mockResolvedValue({
          success: true,
          data: {
            claudeCode: false,
            claudeError:
              'Claude Code 执行失败: CLI 未向本地路由代理发起请求，请检查 CLI 是否已登录、是否支持环境变量代理配置，以及本机是否能执行该 CLI。',
          },
          samples: [
            {
              cliType: 'claudeCode',
              model: 'claude-3-5-sonnet',
              success: false,
              testedAt: 1777000000000,
              error:
                'Claude Code 执行失败: CLI 未向本地路由代理发起请求，请检查 CLI 是否已登录、是否支持环境变量代理配置，以及本机是否能执行该 CLI。',
            },
          ],
        }),
        saveResult: vi.fn().mockResolvedValue({ success: true }),
      },
    };

    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="HuanAPI"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet']}
        currentConfig={initialConfig}
        onPersistConfig={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '测试已选模型' }));
    });

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining(
          'claude-3-5-sonnet: Claude Code 执行失败: CLI 未向本地路由代理发起请求'
        ),
        10000
      );
    });
    expect(screen.getByText(/CLI 未向本地路由代理发起请求/)).toBeInTheDocument();
  });

  it('shows newer route probe results in the matching selected-model slot', async () => {
    const probeKey = buildProbeKey('site-1', 'acct-1', 'codex', 'gpt-4.1');
    useRouteStore.setState({
      config: {
        ...DEFAULT_ROUTING_CONFIG,
        cliProbe: {
          ...DEFAULT_ROUTING_CONFIG.cliProbe,
          latest: {
            [probeKey]: {
              probeKey,
              siteId: 'site-1',
              accountId: 'acct-1',
              cliType: 'codex',
              canonicalModel: 'gpt-4.1',
              rawModel: 'gpt-4.1',
              healthy: false,
              lastSample: {
                sampleId: 'route-sample-1',
                probeKey,
                siteId: 'site-1',
                accountId: 'acct-1',
                cliType: 'codex',
                canonicalModel: 'gpt-4.1',
                rawModel: 'gpt-4.1',
                success: false,
                source: 'routeProbe',
                statusCode: 503,
                testedAt: 1777000000000,
              },
              lastFailureAt: 1777000000000,
            },
          },
        },
      },
    });

    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteId="site-1"
        siteName="Claude Hub"
        accountId="acct-1"
        accountName="Primary"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet', 'gpt-4.1']}
        currentConfig={{
          ...initialConfig,
          codex: {
            ...initialConfig.codex!,
            testResults: [{ model: 'gpt-4.1', success: true, timestamp: 1776000000000 }],
          },
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Codex').closest('button') as HTMLButtonElement);
    });

    await waitFor(() => {
      expect(screen.getByText('失败')).toBeInTheDocument();
    });
  });

  it('persists the selected target protocol and updates the displayed endpoint', async () => {
    const onSave = vi.fn();

    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="Claude Hub"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['gpt-4.1']}
        currentConfig={initialConfig}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Codex').closest('button') as HTMLButtonElement);
    });

    expect(screen.getByText('/v1/responses')).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('选择上游端口'), {
        target: { value: 'openai-chat-completions' },
      });
    });

    expect(screen.getByText('/v1/chat/completions')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        codex: expect.objectContaining({
          targetProtocol: 'openai-chat-completions',
        }),
      })
    );
  });
});
