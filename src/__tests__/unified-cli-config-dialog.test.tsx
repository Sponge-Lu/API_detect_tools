import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagedCliConfigEditorContent } from '../renderer/components/dialogs/ManagedCliConfigEditorContent';
import type { CliConfig } from '../shared/types/cli-config';
import { useDetectionStore } from '../renderer/store/detectionStore';
import { useConfigStore } from '../renderer/store/configStore';
import { useRouteStore } from '../renderer/store/routeStore';
import { toast } from '../renderer/store/toastStore';
import { DEFAULT_ROUTING_CONFIG, buildProbeKey } from '../shared/types/route-proxy';
import type { ModelPricingData, UnifiedConfig } from '../shared/types/site';
import { createDefaultAllDetectionResult } from '../shared/types/config-detection';

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
  openCode: {
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
  grokBuild: {
    apiKeyId: 1,
    model: 'gpt-4.1',
    targetProtocol: 'native',
    testModel: null,
    testModels: [],
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
    'gpt-4.1-mini': { enable_groups: ['alpha'] },
    'gpt-4.1': { enable_groups: ['beta'] },
  },
};

function StatefulDialog() {
  const [currentConfig, setCurrentConfig] = useState<CliConfig>(initialConfig);

  return (
    <ManagedCliConfigEditorContent
      siteName="Claude Hub"
      siteUrl="https://example.com"
      apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
      siteModels={['claude-3-5-sonnet', 'gpt-4.1']}
      currentConfig={currentConfig}
      onPersistConfig={async nextConfig => {
        setCurrentConfig(nextConfig);
      }}
      onSave={vi.fn()}
    />
  );
}

function MismatchDialog() {
  return (
    <ManagedCliConfigEditorContent
      siteName="DuckCoding"
      siteUrl="https://www.duckcoding.ai"
      apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
      siteModels={['gpt-4.1']}
      currentConfig={mismatchConfig}
      onSave={vi.fn()}
    />
  );
}

function getCliSectionHeader(label: string): HTMLElement {
  const header =
    screen
      .getAllByText(label)
      .map(node => node.closest('[role="button"]'))
      .find((node): node is HTMLElement => node instanceof HTMLElement) ?? null;

  if (!header) {
    throw new Error(`CLI section header not found: ${label}`);
  }

  return header;
}

function getOpenModelMenu(): HTMLElement {
  const searchInput = screen.getByPlaceholderText('搜索模型...');
  const menu = searchInput.closest('.absolute');
  if (!(menu instanceof HTMLElement)) {
    throw new Error('Open model menu not found');
  }
  return menu;
}

describe('ManagedCliConfigEditorContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDetectionStore.setState({
      cliCompatibility: {},
      cliConfigs: {},
      cliTestingSites: new Set<string>(),
    });
    useConfigStore.setState({
      config: {
        sites: [
          {
            id: 'site-1',
            name: 'Claude Hub',
            url: 'https://example.com',
            api_key: '',
            enabled: true,
          },
        ],
        settings: {
          timeout: 30,
          concurrent: false,
          show_disabled: false,
        },
      },
      loading: false,
      saving: false,
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
        writeConfig: vi.fn().mockResolvedValue({
          success: true,
          writtenPaths: ['~/.grok/config.toml'],
        }),
        saveResult: vi.fn().mockResolvedValue({ success: true }),
      },
      configDetection: {
        ...window.electronAPI?.configDetection,
        clearCache: vi.fn().mockResolvedValue(undefined),
        detectAllCliConfig: vi.fn().mockResolvedValue(createDefaultAllDetectionResult()),
      },
    };
  });

  it('keeps the selected codex tab after test-result persistence updates currentConfig', async () => {
    render(<StatefulDialog />);

    await act(async () => {
      fireEvent.click(getCliSectionHeader('Codex'));
    });

    expect(getCliSectionHeader('Codex')).toHaveAttribute('aria-expanded', 'true');

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
    await waitFor(() =>
      expect(getCliSectionHeader('Codex')).toHaveAttribute('aria-expanded', 'true')
    );
    expect(getCliSectionHeader('Claude Code')).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows a warning when edited codex config points to a different domain than the current site', async () => {
    render(<MismatchDialog />);

    await act(async () => {
      fireEvent.click(getCliSectionHeader('Codex'));
    });

    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent('https://duckcoding.com');
    expect(warning).toHaveTextContent('https://www.duckcoding.ai');
  });

  it('filters model options to the selected api key group unless list-all-models is enabled', async () => {
    render(
      <ManagedCliConfigEditorContent
        siteName="Claude Hub"
        siteUrl="https://example.com"
        apiKeys={[
          { id: 1, name: 'Alpha Key', key: 'sk-alpha', group: 'alpha' },
          { id: 2, name: 'Beta Key', key: 'sk-beta', group: 'beta' },
        ]}
        siteModels={['claude-3-5-sonnet', 'gpt-4.1', 'gpt-4.1-mini']}
        siteModelPricing={groupedModelPricing}
        currentConfig={initialConfig}
        onSave={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(getCliSectionHeader('Claude Code'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'CLI 使用模型' }));
    });

    expect(screen.getAllByText('claude-3-5-sonnet').length).toBeGreaterThan(0);
    expect(screen.getAllByText('gpt-4.1-mini').length).toBeGreaterThan(0);
    expect(within(getOpenModelMenu()).queryByText('gpt-4.1')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: '列出全部模型' }));
    });

    expect(within(getOpenModelMenu()).getByText('gpt-4.1')).toBeInTheDocument();
  });

  it('clears out-of-group model selections when list-all-models is disabled', async () => {
    render(
      <ManagedCliConfigEditorContent
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
            testModels: ['gpt-4.1'],
          },
        }}
        onSave={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(getCliSectionHeader('Claude Code'));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'CLI 使用模型' })).toHaveTextContent(
        '请选择 CLI 模型'
      );
    });
    expect(screen.getByRole('button', { name: '测试模型' })).toHaveTextContent('请选择测试模型');
    expect(screen.queryByRole('button', { name: '测试模型 2' })).not.toBeInTheDocument();
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
      <ManagedCliConfigEditorContent
        siteName="Claude Hub"
        accountId="acct-1"
        accountName="Primary"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet', 'gpt-4.1']}
        currentConfig={initialConfig}
        onPersistConfig={vi.fn().mockResolvedValue(undefined)}
        onSave={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(getCliSectionHeader('Codex'));
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

  it('shows selected-model failure details in the row status with a warning toast summary', async () => {
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
      <ManagedCliConfigEditorContent
        siteName="HuanAPI"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet']}
        currentConfig={initialConfig}
        onPersistConfig={vi.fn().mockResolvedValue(undefined)}
        onSave={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(getCliSectionHeader('Claude Code'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '测试已选模型' }));
    });

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith('Claude Code 有 1 个测试模型未通过', 10000);
    });
    expect(screen.getByText('失败')).toBeInTheDocument();
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
      <ManagedCliConfigEditorContent
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
        onSave={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(getCliSectionHeader('Codex'));
    });

    await waitFor(() => {
      expect(screen.getByText('失败')).toBeInTheDocument();
    });
  });

  it('persists the selected target protocol and updates the displayed endpoint', async () => {
    const onSave = vi.fn();

    render(
      <ManagedCliConfigEditorContent
        siteName="Claude Hub"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['gpt-4.1']}
        currentConfig={initialConfig}
        onSave={onSave}
      />
    );

    await act(async () => {
      fireEvent.click(getCliSectionHeader('Codex'));
    });

    const targetProtocolSelect = screen.getByLabelText('选择上游端口');
    expect(targetProtocolSelect).toHaveDisplayValue('原生协议 · /v1/responses');

    await act(async () => {
      fireEvent.change(targetProtocolSelect, {
        target: { value: 'openai-chat-completions' },
      });
    });

    expect(targetProtocolSelect).toHaveDisplayValue(
      'OpenAI Chat Completions · /v1/chat/completions'
    );

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

  it('supports managed Grok Build configuration without exposing model probes', async () => {
    render(
      <ManagedCliConfigEditorContent
        siteName="Claude Hub"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['gpt-4.1']}
        currentConfig={initialConfig}
        onSave={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(getCliSectionHeader('Grok Build'));
    });

    expect(screen.getByLabelText('选择上游端口')).toHaveDisplayValue(
      '原生协议 · 跟随 Grok Build 当前模型入口'
    );
    expect(screen.getByRole('button', { name: '暂不支持探测' })).toBeDisabled();
    expect(window.electronAPI.cliCompat.testWithWrapper).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '应用 Grok Build' }));
    });

    await waitFor(() =>
      expect(window.electronAPI.cliCompat.writeConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          cliType: 'grokBuild',
          applyMode: 'merge',
          files: [expect.objectContaining({ path: '~/.grok/config.toml' })],
        })
      )
    );

    const clearCache = vi.mocked(window.electronAPI.configDetection.clearCache);
    const detectAllCliConfig = vi.mocked(window.electronAPI.configDetection.detectAllCliConfig);
    await waitFor(() =>
      expect(detectAllCliConfig).toHaveBeenCalledWith([
        {
          id: 'Claude Hub',
          name: 'Claude Hub',
          url: 'https://example.com',
        },
      ])
    );
    expect(clearCache).toHaveBeenCalledOnce();
    expect(clearCache.mock.invocationCallOrder[0]).toBeLessThan(
      detectAllCliConfig.mock.invocationCallOrder[0]
    );
  });

  it('keeps managed OpenCode configuration without exposing model probes', async () => {
    render(
      <ManagedCliConfigEditorContent
        siteName="Claude Hub"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['gpt-4.1']}
        currentConfig={initialConfig}
        onSave={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(getCliSectionHeader('OpenCode'));
    });

    expect(screen.getByLabelText('选择上游端口')).toHaveDisplayValue('原生协议 · /v1/responses');
    expect(screen.getByRole('button', { name: '暂不支持探测' })).toBeDisabled();
    expect(window.electronAPI.cliCompat.testWithWrapper).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '应用 OpenCode' })).toBeEnabled();
  });

  it('refreshes Grok detection even when clearing the backend cache fails', async () => {
    const clearCache = vi.mocked(window.electronAPI.configDetection.clearCache);
    const detectAllCliConfig = vi.mocked(window.electronAPI.configDetection.detectAllCliConfig);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    clearCache.mockRejectedValueOnce(new Error('cache unavailable'));

    render(
      <ManagedCliConfigEditorContent
        siteName="Claude Hub"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['gpt-4.1']}
        currentConfig={initialConfig}
        onSave={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(getCliSectionHeader('Grok Build'));
      fireEvent.click(screen.getByRole('button', { name: '应用 Grok Build' }));
    });

    await waitFor(() => expect(detectAllCliConfig).toHaveBeenCalledOnce());
    expect(toast.success).toHaveBeenCalledWith('Grok Build 配置已写入本地');
    expect(toast.error).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('清除 CLI 配置缓存失败:', expect.any(Error));
    consoleError.mockRestore();
  });
});
