import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagedCliConfigEditorContent } from '../renderer/components/dialogs/ManagedCliConfigEditorContent';
import type { CliConfig } from '../shared/types/cli-config';
import { useDetectionStore } from '../renderer/store/detectionStore';
import { useConfigStore } from '../renderer/store/configStore';
import { toast } from '../renderer/store/toastStore';
import type { ModelPricingData } from '../shared/types/site';
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
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
  },
  codex: {
    apiKeyId: 1,
    model: 'gpt-4.1',
    targetProtocol: 'native',
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
  },
  openCode: {
    apiKeyId: 1,
    model: 'gpt-4.1',
    targetProtocol: 'native',
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
  },
  grokBuild: {
    apiKeyId: 1,
    model: 'gpt-4.1',
    targetProtocol: 'native',
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
  return screen.getByRole('button', { name: `${label} 配置文件预览` });
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
      cliConfigs: {},
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
    window.electronAPI = {
      ...window.electronAPI,
      loadConfig: vi.fn().mockResolvedValue({
        sites: [],
        accounts: [],
      }),
      cliCompat: {
        ...window.electronAPI?.cliCompat,
        writeConfig: vi.fn().mockResolvedValue({
          success: true,
          writtenPaths: ['~/.grok/config.toml'],
        }),
      },
      configDetection: {
        ...window.electronAPI?.configDetection,
        clearCache: vi.fn().mockResolvedValue(undefined),
        detectAllCliConfig: vi.fn().mockResolvedValue(createDefaultAllDetectionResult()),
      },
    };
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

    expect(screen.queryByText('连接配置')).not.toBeInTheDocument();
    const cliTitle = screen.getByText('Claude Code').parentElement;
    expect(cliTitle).toHaveClass('items-center');
    expect(cliTitle).toHaveTextContent('Claude Codeclaude-3-5-sonnet');
    expect(screen.getByRole('button', { name: '应用 Claude Code' })).toHaveClass(
      '!min-h-7',
      '!px-2.5'
    );
    expect(screen.getByRole('switch', { name: '启用 Claude Code' })).toHaveClass('h-4', 'w-8');
    const targetProtocolSelect = screen.getByLabelText('Claude Code 选择上游端口');
    expect(targetProtocolSelect).toHaveClass('h-8', 'py-0', 'text-xs');
    expect(targetProtocolSelect.parentElement?.parentElement?.firstElementChild).toBe(
      targetProtocolSelect.parentElement
    );

    await act(async () => {
      fireEvent.click(getCliSectionHeader('Claude Code'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Claude Code CLI 使用模型' }));
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
          },
        }}
        onSave={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(getCliSectionHeader('Claude Code'));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Claude Code CLI 使用模型' })).toHaveTextContent(
        '请选择 CLI 模型'
      );
    });
    expect(screen.queryByRole('button', { name: '测试模型' })).not.toBeInTheDocument();
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

    const targetProtocolSelect = screen.getByLabelText('Codex 选择上游端口');
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

  it('supports managed Grok Build configuration without test controls', async () => {
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

    expect(screen.getByLabelText('Grok Build 选择上游端口')).toHaveDisplayValue(
      '原生协议 · 跟随 Grok Build 当前模型入口'
    );
    expect(screen.queryByRole('button', { name: '暂不支持探测' })).not.toBeInTheDocument();

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

  it('keeps managed OpenCode configuration without test controls', async () => {
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

    expect(screen.getByLabelText('OpenCode 选择上游端口')).toHaveDisplayValue(
      '原生协议 · /v1/responses'
    );
    expect(screen.queryByRole('button', { name: '暂不支持探测' })).not.toBeInTheDocument();
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
