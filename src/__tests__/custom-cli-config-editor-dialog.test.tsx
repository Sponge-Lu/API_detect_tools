import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectCliConfigEditorContent } from '../renderer/components/dialogs/DirectCliConfigEditorContent';
import { useCustomCliConfigStore } from '../renderer/store/customCliConfigStore';
import type { CustomCliConfig } from '../shared/types/custom-cli-config';

type TestWithWrapperPayload = {
  siteUrl: string;
  configs: Array<{
    cliType: string;
    apiKey: string;
    model: string;
    baseUrl: string;
    targetProtocol?: string;
  }>;
};

type WriteConfigPayload = {
  cliType: string;
  files: Array<{ path: string; content: string }>;
  applyMode?: 'merge' | 'overwrite';
};

type MockElectronApi = {
  cliCompat: {
    testWithWrapper: ReturnType<
      typeof vi.fn<(payload: TestWithWrapperPayload) => Promise<unknown>>
    >;
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
  models: ['claude-3.7', 'gpt-4.1', 'gpt-4.1-mini', 'gemini-2.5'],
  notes: '',
  cliSettings: {
    claudeCode: {
      enabled: true,
      model: 'claude-3.7',
      testModels: ['claude-3.7'],
    },
    codex: {
      enabled: true,
      model: 'gpt-4.1',
      testModels: ['gpt-4.1'],
    },
    geminiCli: {
      enabled: true,
      model: 'gemini-2.5',
      testModels: ['gemini-2.5'],
    },
  },
  createdAt: 1,
  updatedAt: 1,
});

describe('DirectCliConfigEditorContent', () => {
  const originalState = useCustomCliConfigStore.getState();
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const getElectronAPI = () => window.electronAPI as unknown as MockElectronApi;

  const renderDialog = async () => {
    await act(async () => {
      render(<DirectCliConfigEditorContent config={createConfig()} />);
    });

    return screen.findByText('直连配置编辑');
  };

  const openCliSection = async (cliName: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${cliName}`) }));
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
        testWithWrapper: vi.fn().mockResolvedValue({
          success: true,
          data: {
            claudeCode: true,
            codex: true,
            geminiCli: true,
          },
        }),
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

  it('renders per-cli operation blocks with apply, test controls, and one preview path', async () => {
    await renderDialog();

    expect(screen.queryByRole('button', { name: '测试当前配置' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /^预览 / })).toHaveLength(0);
    expect(screen.queryByText('配置预览与编辑')).not.toBeInTheDocument();
    expect(screen.getByText('配置文件预览')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^应用 / })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^测试 / })).toHaveLength(1);
    expect(screen.queryByTestId('cli-test-columns')).not.toBeInTheDocument();
    expect(screen.getAllByText('测试模型')).toHaveLength(1);
    expect(screen.queryByText('测试模型（最多 3 个）')).not.toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('Gemini CLI')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claude Code 主模型' })).toBeInTheDocument();
    await openCliSection('Codex');
    expect(screen.getByRole('button', { name: 'Codex 主模型' })).toBeInTheDocument();
    await openCliSection('Gemini CLI');
    expect(screen.getByRole('button', { name: 'Gemini CLI 主模型' })).toBeInTheDocument();
  }, 15_000);

  it('runs tests only for the clicked cli column', async () => {
    const testWithWrapper = vi.fn().mockResolvedValue({
      success: true,
      data: { codex: true },
    });
    getElectronAPI().cliCompat.testWithWrapper = testWithWrapper;

    await renderDialog();
    await openCliSection('Codex');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '测试 Codex' }));
    });

    await waitFor(() => expect(testWithWrapper).toHaveBeenCalledTimes(1));
    expect(testWithWrapper).toHaveBeenNthCalledWith(1, {
      siteUrl: 'https://api.example.com',
      configs: [
        {
          cliType: 'codex',
          apiKey: 'test-key',
          model: 'gpt-4.1',
          baseUrl: 'https://api.example.com',
          targetProtocol: 'native',
        },
      ],
    });
  });

  it('persists group multiplier from the identity form', async () => {
    await renderDialog();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('分组倍率'), { target: { value: '2.5' } });
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
        groupMultiplier: 2.5,
      })
    );
  });

  it('saves blank group multiplier as default 1', async () => {
    await renderDialog();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('分组倍率'), { target: { value: '' } });
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
        groupMultiplier: 1,
      })
    );
  });

  it('passes the selected target protocol into direct custom cli tests and persistence', async () => {
    const testWithWrapper = vi.fn().mockResolvedValue({
      success: true,
      data: { codex: true },
    });
    getElectronAPI().cliCompat.testWithWrapper = testWithWrapper;

    await renderDialog();
    await openCliSection('Codex');
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Codex 选择上游端口'), {
        target: { value: 'openai-chat-completions' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '测试 Codex' }));
    });

    await waitFor(() => expect(testWithWrapper).toHaveBeenCalledTimes(1));
    expect(testWithWrapper).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        configs: [
          expect.objectContaining({
            cliType: 'codex',
            targetProtocol: 'openai-chat-completions',
          }),
        ],
      })
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
            targetProtocol: 'openai-chat-completions',
          }),
        }),
      })
    );
  });

  it('persists cli test outcomes back into the custom config store after a column run', async () => {
    const testWithWrapper = vi.fn().mockResolvedValue({
      success: true,
      data: { codex: true },
    });
    const updateConfig = useCustomCliConfigStore.getState().updateConfig as ReturnType<
      typeof vi.fn
    >;
    const saveConfigs = useCustomCliConfigStore.getState().saveConfigs as ReturnType<typeof vi.fn>;
    getElectronAPI().cliCompat.testWithWrapper = testWithWrapper;

    await renderDialog();
    await openCliSection('Codex');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '测试 Codex' }));
    });

    await waitFor(() =>
      expect(updateConfig).toHaveBeenCalledWith(
        'cfg-1',
        expect.objectContaining({
          cliSettings: expect.objectContaining({
            codex: expect.objectContaining({
              testState: expect.objectContaining({
                status: true,
                slots: [expect.objectContaining({ model: 'gpt-4.1', success: true }), null, null],
              }),
            }),
          }),
        })
      )
    );
    await waitFor(() => expect(saveConfigs).toHaveBeenCalledTimes(1));
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
                testModels: ['claude-3.7'],
              },
              codex: {
                ...currentConfig.cliSettings.codex,
                model: null,
                testModels: [],
                testState: null,
              },
              geminiCli: {
                ...currentConfig.cliSettings.geminiCli,
                model: null,
                testModels: [],
                testState: null,
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
            testModels: [],
          }),
          geminiCli: expect.objectContaining({
            model: null,
            testModels: [],
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
