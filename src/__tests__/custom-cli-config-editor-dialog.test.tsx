import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomCliConfigEditorDialog } from '../renderer/components/dialogs/CustomCliConfigEditorDialog';
import { useCustomCliConfigStore } from '../renderer/store/customCliConfigStore';
import type { CustomCliConfig } from '../shared/types/custom-cli-config';

type MockModalProps = {
  isOpen: boolean;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

type TestWithWrapperPayload = {
  siteUrl: string;
  configs: Array<{
    cliType: string;
    apiKey: string;
    model: string;
    baseUrl: string;
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

vi.mock('../renderer/components/IOSModal', () => ({
  IOSModal: ({ isOpen, title, children, footer }: MockModalProps) =>
    isOpen ? (
      <div role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
        {title ? <h2>{title}</h2> : null}
        <div>{children}</div>
        {footer ? <div>{footer}</div> : null}
      </div>
    ) : null,
}));

const createConfig = (): CustomCliConfig => ({
  id: 'cfg-1',
  name: '测试配置',
  baseUrl: 'https://api.example.com',
  apiKey: 'test-key',
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
      testModels: ['gpt-4.1', 'gpt-4.1-mini'],
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

describe('CustomCliConfigEditorDialog', () => {
  const originalState = useCustomCliConfigStore.getState();
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const getElectronAPI = () => window.electronAPI as unknown as MockElectronApi;

  const renderDialog = async () => {
    await act(async () => {
      render(
        <CustomCliConfigEditorDialog isOpen={true} config={createConfig()} onClose={vi.fn()} />
      );
    });

    return screen.findByRole('dialog', { name: /编辑: 测试配置/ });
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

  it('renders per-cli preview and apply buttons plus per-column test buttons', async () => {
    await renderDialog();

    expect(screen.queryByRole('button', { name: '测试当前配置' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^预览 / })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /^应用 / })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /^测试 / })).toHaveLength(3);

    const cliTestColumns = screen.getByTestId('cli-test-columns');
    expect(cliTestColumns).toBeInTheDocument();
    expect(cliTestColumns.className).toContain('md:divide-x');
    expect(cliTestColumns).toHaveTextContent('Claude Code');
    expect(cliTestColumns).toHaveTextContent('Codex');
    expect(cliTestColumns).toHaveTextContent('Gemini CLI');
  });

  it('runs tests only for the clicked cli column', async () => {
    const testWithWrapper = vi.fn().mockResolvedValue({
      success: true,
      data: { codex: true },
    });
    getElectronAPI().cliCompat.testWithWrapper = testWithWrapper;

    await renderDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '测试 Codex' }));
    });

    await waitFor(() => expect(testWithWrapper).toHaveBeenCalledTimes(2));
    expect(testWithWrapper).toHaveBeenNthCalledWith(1, {
      siteUrl: 'https://api.example.com',
      configs: [
        {
          cliType: 'codex',
          apiKey: 'test-key',
          model: 'gpt-4.1',
          baseUrl: 'https://api.example.com',
        },
      ],
    });
    expect(testWithWrapper).toHaveBeenNthCalledWith(2, {
      siteUrl: 'https://api.example.com',
      configs: [
        {
          cliType: 'codex',
          apiKey: 'test-key',
          model: 'gpt-4.1-mini',
          baseUrl: 'https://api.example.com',
        },
      ],
    });
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
                slots: [
                  expect.objectContaining({ model: 'gpt-4.1', success: true }),
                  expect.objectContaining({ model: 'gpt-4.1-mini', success: true }),
                  null,
                ],
              }),
            }),
          }),
        })
      )
    );
    await waitFor(() => expect(saveConfigs).toHaveBeenCalledTimes(1));
  });

  it('applies the clicked cli configuration to local files', async () => {
    const writeConfig = vi.fn().mockResolvedValue({
      success: true,
      writtenPaths: ['~/.codex/config.toml', '~/.codex/auth.json'],
    });
    getElectronAPI().cliCompat.writeConfig = writeConfig;

    await renderDialog();
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
});
