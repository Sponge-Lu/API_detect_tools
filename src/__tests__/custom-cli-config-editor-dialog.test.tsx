import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectCliConfigEditorContent } from '../renderer/components/dialogs/DirectCliConfigEditorContent';
import { useCustomCliConfigStore } from '../renderer/store/customCliConfigStore';
import type { CustomCliConfig } from '../shared/types/custom-cli-config';

type WriteConfigPayload = {
  cliType: string;
  files: Array<{ path: string; content: string }>;
  applyMode?: 'merge' | 'overwrite';
};

type MockElectronApi = {
  cliCompat: {
    writeConfig: ReturnType<typeof vi.fn<(payload: WriteConfigPayload) => Promise<unknown>>>;
  };
  configDetection: {
    clearCache: ReturnType<typeof vi.fn<() => Promise<void>>>;
  };
};

vi.mock('../renderer/store/toastStore', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const createConfig = (): CustomCliConfig => ({
  id: 'cfg-1',
  name: '测试配置',
  baseUrl: 'https://api.example.com',
  apiKey: 'test-key',
  groupMultiplier: 1,
  models: ['claude-3.7', 'gpt-4.1', 'gpt-4.1-mini', 'grok-4.1'],
  notes: '',
  cliSettings: {
    claudeCode: {
      enabled: true,
      model: 'claude-3.7',
    },
    codex: {
      enabled: true,
      model: 'gpt-4.1',
    },
    openCode: {
      enabled: true,
      model: 'gpt-4.1',
    },
    grokBuild: {
      enabled: true,
      model: 'grok-4.1',
      targetProtocol: 'native',
    },
  },
  createdAt: 1,
  updatedAt: 1,
});

describe('DirectCliConfigEditorContent', () => {
  const originalState = useCustomCliConfigStore.getState();
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const getElectronAPI = () => window.electronAPI as unknown as MockElectronApi;

  const renderDialog = async (config: CustomCliConfig = createConfig()) => {
    await act(async () => {
      render(<DirectCliConfigEditorContent config={config} />);
    });

    return screen.findByText('直连配置编辑');
  };

  const openCliSection = async (cliName: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `${cliName} 配置文件预览` }));
    });
  };

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    useCustomCliConfigStore.setState({
      configs: [createConfig()],
      activeConfigId: null,
      loading: false,
      saving: false,
      fetchingModels: {},
      updateConfig: vi.fn((id: string, updates: Partial<CustomCliConfig>) => {
        const nextConfigs = useCustomCliConfigStore
          .getState()
          .configs.map(config =>
            config.id === id ? { ...config, ...updates, updatedAt: Date.now() } : config
          );
        useCustomCliConfigStore.setState({ configs: nextConfigs });
      }),
      saveConfigs: vi.fn().mockResolvedValue(undefined),
      fetchModels: vi.fn().mockResolvedValue(['claude-3.7']),
    });

    window.electronAPI = {
      ...window.electronAPI,
      cliCompat: {
        writeConfig: vi.fn().mockResolvedValue({
          success: true,
          writtenPaths: ['~/.codex/config.toml', '~/.codex/auth.json'],
        }),
      },
      configDetection: {
        clearCache: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  afterEach(() => {
    useCustomCliConfigStore.setState({
      ...originalState,
      configs: [],
      activeConfigId: null,
      loading: false,
      saving: false,
      fetchingModels: {},
      updateConfig: originalState.updateConfig,
      saveConfigs: originalState.saveConfigs,
      fetchModels: originalState.fetchModels,
    });
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('renders per-cli operation blocks with apply controls and one preview path', async () => {
    await renderDialog();

    expect(screen.queryByRole('button', { name: '测试当前配置' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /^预览 / })).toHaveLength(0);
    expect(screen.queryByText('配置预览与编辑')).not.toBeInTheDocument();
    expect(screen.getAllByText('配置文件预览')).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /^应用 / })).toHaveLength(4);
    expect(screen.queryAllByRole('button', { name: /^测试 / })).toHaveLength(0);
    expect(screen.queryByTestId('cli-test-columns')).not.toBeInTheDocument();
    expect(screen.queryAllByText('测试模型')).toHaveLength(0);
    expect(screen.queryByText('测试模型（最多 3 个）')).not.toBeInTheDocument();
    expect(screen.queryByText('连接配置')).not.toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('OpenCode')).toBeInTheDocument();
    expect(screen.getByText('Grok Build')).toBeInTheDocument();
    const cliTitle = screen.getByText('Claude Code').parentElement;
    expect(cliTitle).toHaveClass('items-center');
    expect(cliTitle).toHaveTextContent('Claude Codeclaude-3.7');
    expect(screen.getByRole('button', { name: '应用 Claude Code' })).toHaveClass(
      '!min-h-7',
      '!px-2.5'
    );
    expect(screen.getAllByRole('switch', { name: '启用该 CLI' })[0]).toHaveClass('h-4', 'w-8');
    const targetProtocolSelect = screen.getByLabelText('Claude Code 选择上游端口');
    expect(targetProtocolSelect).toHaveClass('h-8', 'py-0', 'text-xs');
    expect(targetProtocolSelect.parentElement?.parentElement?.firstElementChild).toBe(
      targetProtocolSelect.parentElement
    );
    expect(screen.getByRole('button', { name: 'Claude Code 主模型' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Codex 主模型' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OpenCode 主模型' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grok Build 主模型' })).toBeInTheDocument();
    await openCliSection('Codex');
    expect(screen.getByRole('button', { name: 'Codex 主模型' })).toBeInTheDocument();
  }, 15_000);

  it('filters available models from the model search input', async () => {
    await renderDialog();

    expect(screen.getByTestId('direct-tab2-content')).toHaveClass(
      'border-t',
      'bg-[var(--surface-2)]/92',
      'px-[var(--spacing-md)]',
      'py-[var(--spacing-sm)]'
    );
    expect(screen.getByTestId('direct-api-key-row')).toHaveClass(
      'bg-[var(--surface-1)]',
      'px-2',
      'py-1'
    );
    expect(screen.getByRole('button', { name: '添加 claude-3.7 价格' })).toBeInTheDocument();

    const modelSearchInput = screen.getByRole('searchbox', { name: '搜索可用模型' });
    expect(modelSearchInput).toHaveAttribute('placeholder', '搜索模型');
    expect(screen.getByTitle('claude-3.7')).toBeInTheDocument();

    expect(
      screen.getByTitle('claude-3.7').closest('[data-testid="direct-model-item"]')
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(modelSearchInput, { target: { value: '4.1-mini' } });
    });

    expect(screen.getByTitle('gpt-4.1-mini')).toBeInTheDocument();
    expect(screen.queryByTitle('claude-3.7')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.change(modelSearchInput, { target: { value: 'missing-model' } });
    });

    expect(screen.getByText('没有匹配的模型')).toBeInTheDocument();
    expect(screen.queryByTitle('gpt-4.1-mini')).not.toBeInTheDocument();
  });

  it('normalizes API key groups and shows model ownership below the model name', async () => {
    const config = createConfig();
    config.apiKeys = [
      {
        id: 'key-a',
        name: 'A',
        key: 'sk-a',
        group: '1 默认',
        groupMultiplier: 1,
        models: ['claude-3.7'],
      },
    ];
    config.apiKey = 'sk-a';
    useCustomCliConfigStore.setState({ configs: [config] });

    await renderDialog(config);
    const groupInput = screen.getByRole('combobox', { name: 'API Key 1 分组' });
    expect(groupInput).toHaveValue('① 默认');
    const modelItem = screen.getByTitle('claude-3.7').closest('[data-testid="direct-model-item"]');
    expect(modelItem).toHaveTextContent('① 默认');
    expect(modelItem?.firstElementChild?.firstElementChild?.children[1]).toHaveTextContent(
      '① 默认'
    );

    fireEvent.change(groupInput, { target: { value: '2 高级' } });
    fireEvent.blur(groupInput);
    expect(groupInput).toHaveValue('② 高级');
    expect(modelItem).toHaveTextContent('② 高级');
  });

  it('offers existing key groups as suggestions while keeping free-text entry', async () => {
    const config = createConfig();
    config.apiKeys = [
      { id: 'key-a', name: 'A', key: 'sk-a', group: '① 默认', groupMultiplier: 1, models: [] },
      { id: 'key-b', name: 'B', key: 'sk-b', group: '2 高级', groupMultiplier: 1, models: [] },
    ];
    config.apiKey = 'sk-a';
    useCustomCliConfigStore.setState({ configs: [config] });

    await renderDialog(config);

    const firstGroupInput = screen.getByRole('combobox', { name: 'API Key 1 分组' });
    expect(firstGroupInput).toHaveAttribute('list', 'direct-key-group-options-cfg-1');

    const datalist = document.getElementById('direct-key-group-options-cfg-1');
    expect(datalist).not.toBeNull();
    const suggestedGroups = Array.from(datalist!.querySelectorAll('option')).map(
      option => option.value
    );
    expect(suggestedGroups).toEqual(['① 默认', '② 高级']);

    fireEvent.change(firstGroupInput, { target: { value: '3 专属' } });
    fireEvent.blur(firstGroupInput);
    expect(firstGroupInput).toHaveValue('③ 专属');
  });

  it('saves the gas station URL with direct config identity fields', async () => {
    await renderDialog();

    fireEvent.change(screen.getByRole('textbox', { name: '加油站链接' }), {
      target: { value: 'https://fuel.example.com/topup' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(useCustomCliConfigStore.getState().updateConfig).toHaveBeenCalledWith(
        'cfg-1',
        expect.objectContaining({ gasStationUrl: 'https://fuel.example.com/topup' })
      );
    });
  });

  it('saves the optional model URL with direct config identity fields', async () => {
    await renderDialog();

    fireEvent.change(screen.getByRole('textbox', { name: '模型 URL' }), {
      target: { value: 'https://models.example.com/v1/models' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(useCustomCliConfigStore.getState().updateConfig).toHaveBeenCalledWith(
        'cfg-1',
        expect.objectContaining({ modelUrl: 'https://models.example.com/v1/models' })
      );
    });
  });

  it('saves the selected upstream authentication scheme with direct config identity fields', async () => {
    await renderDialog();

    const authSelect = screen.getByRole('combobox', { name: '上游鉴权方式' });
    fireEvent.change(authSelect, { target: { value: 'x-api-key' } });
    expect(authSelect).toHaveValue('x-api-key');

    await waitFor(() =>
      expect(screen.getByTestId('direct-cli-save-button')).toHaveAttribute('data-dirty', 'true')
    );
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(useCustomCliConfigStore.getState().updateConfig).toHaveBeenCalledWith(
        'cfg-1',
        expect.objectContaining({ routeAuthScheme: 'x-api-key' })
      );
    });
  });

  it('saves the route target protocol with direct config identity fields', async () => {
    await renderDialog();

    const protocolSelect = screen.getByRole('combobox', { name: '路由上游协议' });
    fireEvent.change(protocolSelect, { target: { value: 'openai-responses' } });
    expect(protocolSelect).toHaveValue('openai-responses');

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(useCustomCliConfigStore.getState().updateConfig).toHaveBeenCalledWith(
        'cfg-1',
        expect.objectContaining({
          routeTargetProtocol: 'openai-responses',
          routeTargetProtocolNeedsConfirmation: false,
        })
      );
    });
  });

  it('saves the declared upstream protocols with direct config identity fields', async () => {
    await renderDialog();

    fireEvent.click(screen.getByRole('checkbox', { name: 'OpenAI Chat Completions' }));

    await waitFor(() =>
      expect(screen.getByTestId('direct-cli-save-button')).toHaveAttribute('data-dirty', 'true')
    );

    fireEvent.click(screen.getByTestId('direct-cli-save-button'));

    await waitFor(() => {
      expect(useCustomCliConfigStore.getState().updateConfig).toHaveBeenCalledWith(
        'cfg-1',
        expect.objectContaining({
          supportedProtocols: ['anthropic-messages', 'openai-responses'],
        })
      );
    });
  });

  it('marks the save action dirty when the model URL changes', async () => {
    await renderDialog();

    const saveButton = screen.getByTestId('direct-cli-save-button');
    expect(saveButton).toHaveAttribute('data-dirty', 'false');
    fireEvent.change(screen.getByRole('textbox', { name: '模型 URL' }), {
      target: { value: 'https://models.example.com' },
    });

    await waitFor(() => expect(saveButton).toHaveAttribute('data-dirty', 'true'));
  });

  it('places the model URL and gas station URL in the same identity grid row', async () => {
    await renderDialog();

    const gasStationInput = screen.getByRole('textbox', { name: '加油站链接' });
    const modelUrlInput = screen.getByRole('textbox', { name: '模型 URL' });
    const gasStationGrid = gasStationInput.parentElement?.parentElement;
    expect(gasStationGrid).toBe(modelUrlInput.parentElement?.parentElement);
    expect(gasStationGrid).toHaveClass('md:grid-cols-2');
  });

  it('marks the save button dirty/red after editing identity fields', async () => {
    await renderDialog();

    const saveButton = screen.getByTestId('direct-cli-save-button');
    expect(saveButton).toHaveAttribute('data-dirty', 'false');
    expect(saveButton.className).not.toContain('bg-[var(--danger-soft)]');

    fireEvent.change(screen.getByRole('textbox', { name: '加油站链接' }), {
      target: { value: 'https://fuel.example.com/topup' },
    });

    await waitFor(() => {
      expect(saveButton).toHaveAttribute('data-dirty', 'true');
    });
    expect(saveButton.className).toContain('bg-[var(--danger-soft)]');
  });

  it('toggles and copies the API Key from the identity form', { timeout: 20000 }, async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await renderDialog();

    const apiKeyInput = screen.getByLabelText('API Key 1');
    expect(apiKeyInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: '显示 API Key' }));
    expect(apiKeyInput).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: '隐藏 API Key' }));
    expect(apiKeyInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: '复制 API Key' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('test-key'));
    const copiedButton = screen.getByRole('button', { name: 'API Key 已复制' });
    expect(copiedButton).toBeInTheDocument();

    fireEvent.change(apiKeyInput, { target: { value: '' } });
    expect(copiedButton).toBeDisabled();
  });

  it('keeps manually added models out of the available model list', async () => {
    const config = {
      ...createConfig(),
      manualModels: ['manual-only-model'],
    };

    useCustomCliConfigStore.setState({
      configs: [config],
    });

    await renderDialog(config);

    expect(screen.queryByTitle('manual-only-model')).not.toBeInTheDocument();
    expect(screen.getByText('manual-only-model')).toBeInTheDocument();
  });

  it('persists group multiplier from the identity form', async () => {
    await renderDialog();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('API Key 1 倍率'), { target: { value: '2.5' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    });

    const updateConfig = useCustomCliConfigStore.getState().updateConfig as ReturnType<
      typeof vi.fn
    >;
    expect(updateConfig).toHaveBeenLastCalledWith(
      'cfg-1',
      expect.objectContaining({
        apiKeys: expect.arrayContaining([expect.objectContaining({ groupMultiplier: 2.5 })]),
      })
    );
  });

  it('persists config name edits from the identity form', async () => {
    await renderDialog();

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('例如: 我的 API'), {
        target: { value: '测试配置重命名' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    });

    const updateConfig = useCustomCliConfigStore.getState().updateConfig as ReturnType<
      typeof vi.fn
    >;
    expect(updateConfig).toHaveBeenLastCalledWith(
      'cfg-1',
      expect.objectContaining({
        name: '测试配置重命名',
      })
    );
  });

  it('keeps the current config name when the identity name edit is blank', async () => {
    await renderDialog();

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('例如: 我的 API'), {
        target: { value: '   ' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    });

    const updateConfig = useCustomCliConfigStore.getState().updateConfig as ReturnType<
      typeof vi.fn
    >;
    expect(updateConfig).toHaveBeenLastCalledWith(
      'cfg-1',
      expect.objectContaining({
        name: '测试配置',
      })
    );
  });

  it('saves blank group multiplier as default 1', async () => {
    await renderDialog();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('API Key 1 倍率'), { target: { value: '' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    });

    const updateConfig = useCustomCliConfigStore.getState().updateConfig as ReturnType<
      typeof vi.fn
    >;
    expect(updateConfig).toHaveBeenLastCalledWith(
      'cfg-1',
      expect.objectContaining({
        apiKeys: expect.arrayContaining([expect.objectContaining({ groupMultiplier: 1 })]),
      })
    );
  });

  it('persists the selected target protocol for direct custom cli configuration', async () => {
    await renderDialog();
    await openCliSection('Codex');
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Codex 选择上游端口'), {
        target: { value: 'openai-chat-completions' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    });

    const updateConfig = useCustomCliConfigStore.getState().updateConfig as ReturnType<
      typeof vi.fn
    >;
    expect(updateConfig).toHaveBeenLastCalledWith(
      'cfg-1',
      expect.objectContaining({
        cliSettings: expect.objectContaining({
          codex: expect.objectContaining({
            targetProtocol: 'openai-chat-completions',
          }),
        }),
      })
    );
  });

  it('syncs local model selections after fetching a narrowed model list', async () => {
    const fetchModels = vi.fn(async (configId: string) => {
      const currentConfig = useCustomCliConfigStore
        .getState()
        .configs.find(config => config.id === configId)!;
      useCustomCliConfigStore.setState({
        configs: [
          {
            ...currentConfig,
            models: ['claude-3.7'],
            cliSettings: {
              claudeCode: {
                ...currentConfig.cliSettings.claudeCode,
                model: 'claude-3.7',
              },
              codex: {
                ...currentConfig.cliSettings.codex,
                model: null,
              },
            },
          },
        ],
      });
      return ['claude-3.7'];
    });
    useCustomCliConfigStore.setState({ fetchModels });

    await renderDialog();
    await openCliSection('Codex');
    expect(screen.getByRole('button', { name: 'Codex 主模型' })).toHaveTextContent('gpt-4.1');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '拉取' }));
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Codex 主模型' })).toHaveTextContent('选择模型')
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    });

    const updateConfig = useCustomCliConfigStore.getState().updateConfig as ReturnType<
      typeof vi.fn
    >;
    expect(updateConfig).toHaveBeenLastCalledWith(
      'cfg-1',
      expect.objectContaining({
        cliSettings: expect.objectContaining({
          codex: expect.objectContaining({
            model: null,
          }),
        }),
      })
    );
  });

  it('applies the clicked cli configuration to local files', async () => {
    const writeConfig = vi.fn().mockResolvedValue({
      success: true,
      writtenPaths: ['~/.codex/config.toml', '~/.codex/auth.json'],
    });
    getElectronAPI().cliCompat.writeConfig = writeConfig;

    await renderDialog();
    await openCliSection('Codex');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '应用 Codex' }));
    });

    await waitFor(() =>
      expect(writeConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          cliType: 'codex',
          applyMode: 'merge',
          files: expect.arrayContaining([
            expect.objectContaining({ path: '~/.codex/config.toml' }),
            expect.objectContaining({ path: '~/.codex/auth.json' }),
          ]),
        })
      )
    );
  });

  it('shows Grok Build native endpoint behavior without test controls', async () => {
    const writeConfig = vi.fn().mockResolvedValue({
      success: true,
      writtenPaths: ['~/.grok/config.toml'],
    });
    getElectronAPI().cliCompat.writeConfig = writeConfig;

    await renderDialog();
    await openCliSection('Grok Build');

    expect(screen.getByRole('button', { name: 'Grok Build 主模型' })).toHaveTextContent('grok-4.1');
    expect(screen.getByLabelText('Grok Build 选择上游端口')).toHaveDisplayValue(
      '原生协议 · 跟随 Grok Build 当前模型入口'
    );
    expect(screen.queryByRole('button', { name: '测试 Grok Build' })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '应用 Grok Build' }));
    });

    await waitFor(() =>
      expect(writeConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          cliType: 'grokBuild',
          applyMode: 'merge',
          files: [expect.objectContaining({ path: '~/.grok/config.toml' })],
        })
      )
    );
  });

  it('keeps OpenCode direct configuration without test controls', async () => {
    await renderDialog();
    await openCliSection('OpenCode');

    expect(screen.getByRole('button', { name: 'OpenCode 主模型' })).toHaveTextContent('gpt-4.1');
    expect(screen.getByLabelText('OpenCode 选择上游端口')).toBeEnabled();
    expect(screen.queryByRole('button', { name: '测试 OpenCode' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用 OpenCode' })).toBeEnabled();
  });

  it('persists manually typed models for direct custom cli configs', async () => {
    await renderDialog();
    await openCliSection('Codex');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Codex 主模型' }));
    });

    const searchInput = screen.getByPlaceholderText('搜索模型...');
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'custom-codex-model' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/使用手动模型/));
    });

    expect(screen.getByRole('button', { name: 'Codex 主模型' })).toHaveTextContent(
      'custom-codex-model'
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    });

    const updateConfig = useCustomCliConfigStore.getState().updateConfig as ReturnType<
      typeof vi.fn
    >;
    expect(updateConfig).toHaveBeenLastCalledWith(
      'cfg-1',
      expect.objectContaining({
        manualModels: ['custom-codex-model'],
        cliSettings: expect.objectContaining({
          codex: expect.objectContaining({
            model: 'custom-codex-model',
          }),
        }),
      })
    );
  });
});
