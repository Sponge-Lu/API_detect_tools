import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomCliPage } from '../renderer/pages/CustomCliPage';
import { APP_PAGE_META } from '../renderer/components/AppShell/pageMeta';

const mockLoadConfigs = vi.fn();
const mockAddConfig = vi.fn();
const mockDeleteConfig = vi.fn();
const mockUpdateConfig = vi.fn();
const mockSaveConfigs = vi.fn();
const mockFetchModels = vi.fn();
const mockClearCliConfigDetection = vi.fn();
const mockDetectCliConfig = vi.fn();
const mockWriteConfig = vi.fn();
const mockClearCache = vi.fn();
const mockOpenUrl = vi.fn();

const configs = [
  {
    id: 'cfg-1',
    name: 'Main Endpoint',
    baseUrl: 'https://example.com',
    apiKey: 'sk-test',
    models: ['claude-3-5-sonnet', 'gpt-4.1'],
    notes: 'alpha',
    cliSettings: {
      claudeCode: { enabled: true, model: 'claude-3-5-sonnet', testModels: ['claude-3-5-sonnet'] },
      codex: { enabled: true, model: 'gpt-4.1', testModels: ['gpt-4.1'] },
      geminiCli: { enabled: false, model: null, testModels: [] },
    },
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'cfg-2',
    name: 'Backup Endpoint',
    baseUrl: 'https://backup.example.com',
    apiKey: 'sk-backup',
    models: ['gemini-2.5-pro'],
    notes: 'beta',
    cliSettings: {
      claudeCode: { enabled: false, model: null, testModels: [] },
      codex: { enabled: false, model: null, testModels: [] },
      geminiCli: { enabled: true, model: 'gemini-2.5-pro', testModels: ['gemini-2.5-pro'] },
    },
    createdAt: 2,
    updatedAt: 2,
  },
];

vi.mock('../renderer/store/customCliConfigStore', () => ({
  useCustomCliConfigStore: () => ({
    configs,
    loading: false,
    loadConfigs: mockLoadConfigs,
    addConfig: mockAddConfig,
    deleteConfig: mockDeleteConfig,
    updateConfig: mockUpdateConfig,
    saveConfigs: mockSaveConfigs,
    fetchModels: mockFetchModels,
    fetchingModels: {},
  }),
}));

vi.mock('../renderer/store/detectionStore', () => ({
  useDetectionStore: () => ({
    clearCliConfigDetection: mockClearCliConfigDetection,
    detectCliConfig: mockDetectCliConfig,
  }),
}));

vi.mock('../renderer/store/configStore', () => ({
  useConfigStore: () => ({
    config: { sites: [] },
  }),
}));

describe('custom cli page redesign', () => {
  beforeEach(() => {
    mockLoadConfigs.mockReset();
    mockAddConfig.mockReset();
    mockDeleteConfig.mockReset();
    mockUpdateConfig.mockReset();
    mockSaveConfigs.mockReset();
    mockFetchModels.mockReset();
    mockClearCliConfigDetection.mockReset();
    mockDetectCliConfig.mockReset();
    mockWriteConfig.mockReset();
    mockClearCache.mockReset();
    mockOpenUrl.mockReset();
    mockWriteConfig.mockResolvedValue({
      success: true,
      writtenPaths: ['C:/Users/test/.claude/settings.json'],
    });
    mockClearCache.mockResolvedValue({ success: true });
    mockOpenUrl.mockResolvedValue(undefined);
    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      openUrl: mockOpenUrl,
      cliCompat: {
        ...((window as any).electronAPI?.cliCompat ?? {}),
        writeConfig: mockWriteConfig,
      },
      configDetection: {
        ...((window as any).electronAPI?.configDetection ?? {}),
        clearCache: mockClearCache,
      },
    };
  });

  it('keeps the shared page header but replaces registry/workspace copy with config table + config editor sections', () => {
    render(<CustomCliPage />);

    expect(screen.getByRole('heading', { name: APP_PAGE_META.cli.title })).toBeInTheDocument();
    expect(screen.getByText(APP_PAGE_META.cli.description)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加配置' })).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: '配置表' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '配置编辑' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '配置注册表' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '工作区' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'CLI 映射' })).not.toBeInTheDocument();
  });

  it('renders the left table without model count and defaults to the first config in the editor', () => {
    render(<CustomCliPage />);

    const tableSection = screen.getByRole('heading', { name: '配置表' }).closest('section');
    expect(tableSection).not.toBeNull();
    const tableHeader = screen.getByText('CLI测试').parentElement as HTMLElement | null;

    const table = within(tableSection as HTMLElement);
    expect(table.getByText('名称')).toBeInTheDocument();
    expect(table.getByText('BaseURL')).toBeInTheDocument();
    expect(table.getByText('CLI测试')).toBeInTheDocument();
    expect(table.getByText('备注')).toBeInTheDocument();
    expect(table.queryByText('模型数')).not.toBeInTheDocument();
    expect(tableHeader?.className).toContain('grid-cols-[96px_minmax(0,1.2fr)_76px_minmax(0,1fr)]');

    expect(screen.getByDisplayValue('Main Endpoint')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument();

    const selectedRow = screen.getByRole('row', {
      name: /Main Endpoint https:\/\/example\.com/i,
    });
    expect(selectedRow.className).toContain('grid-cols-[96px_minmax(0,1.2fr)_76px_minmax(0,1fr)]');
    expect(selectedRow.className).toContain('shadow-[inset_4px_0_0_var(--accent)]');
    expect(selectedRow.className).toContain('bg-[var(--accent-soft-strong)]');
  });

  it('places the model label outside the rounded field, keeps fetch button after the rounded box, and aligns its height with API Key', () => {
    render(<CustomCliPage />);

    const nameInput = screen.getByDisplayValue('Main Endpoint');
    const baseUrlInput = screen.getByDisplayValue('https://example.com');
    const apiKeyInput = screen.getByDisplayValue('sk-test');
    const modelHeading = screen.getByText('模型');
    const modelSummary = screen.getByText('已拉取 2 个模型');
    const fetchButton = screen.getByRole('button', { name: '拉取' });
    const notesInput = screen.getByDisplayValue('alpha');

    expect(notesInput.tagName).toBe('INPUT');
    expect(
      apiKeyInput.compareDocumentPosition(modelHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      modelHeading.compareDocumentPosition(notesInput) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(modelHeading.parentElement?.className).toContain('block');
    expect(nameInput.className).toContain('h-9');
    expect(baseUrlInput.className).toContain('h-9');
    expect(apiKeyInput.className).toContain('h-9');

    const modelRow = modelHeading.nextElementSibling as HTMLElement | null;
    expect(modelRow).not.toBeNull();
    expect(modelRow?.className).toContain('flex');

    const modelContainer = modelSummary.parentElement as HTMLElement | null;
    expect(modelContainer).not.toBeNull();
    expect(modelContainer?.className).toContain('rounded-[var(--radius-md)]');
    expect(modelContainer?.className).toContain('bg-[var(--surface-1)]');
    expect(modelContainer?.className).toContain('h-9');
    expect(fetchButton.className).toContain('h-9');
  });

  it('hides the api key by default and allows toggling visibility', () => {
    render(<CustomCliPage />);

    const apiKeyInput = screen.getByLabelText('API Key') as HTMLInputElement;
    expect(apiKeyInput.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: '显示 API Key' }));
    expect(apiKeyInput.type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: '隐藏 API Key' }));
    expect(apiKeyInput.type).toBe('password');
  });

  it('fetches models only when clicking the pull button, not when clicking the fetched-model summary', () => {
    render(<CustomCliPage />);

    fireEvent.click(screen.getByText('已拉取 2 个模型'));
    expect(mockFetchModels).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '拉取' }));
    expect(mockFetchModels).toHaveBeenCalledWith('cfg-1');
  });

  it('tightens the config editor vertical spacing so the full form fits with less scrolling', () => {
    render(<CustomCliPage />);

    const editorSection = screen.getByRole('heading', { name: '配置编辑' }).closest('section');
    expect(editorSection).not.toBeNull();
    expect(editorSection?.className).not.toContain('rounded-[var(--radius-xl)]');

    const tableHeaderRow = screen.getByRole('heading', { name: '配置表' })
      .parentElement as HTMLElement | null;
    const editorHeaderRow = screen.getByRole('heading', { name: '配置编辑' })
      .parentElement as HTMLElement | null;
    expect(tableHeaderRow).not.toBeNull();
    expect(editorHeaderRow).not.toBeNull();
    expect(tableHeaderRow?.className).toContain('min-h-8');
    expect(editorHeaderRow?.className).toContain('min-h-8');

    const editorChildren = Array.from((editorSection as HTMLElement).children) as HTMLElement[];
    const headerWrapper = editorChildren[0];
    expect(headerWrapper.className).toContain('border-b');
    expect(headerWrapper.className).toContain('px-4');
    expect(headerWrapper.className).toContain('py-3');

    const editorBody = editorChildren[1];
    expect(editorBody.className).toContain('min-h-0');
    expect(editorBody.className).toContain('py-3');

    const editorContent = editorBody.firstElementChild as HTMLElement | null;
    expect(editorContent).not.toBeNull();
    expect(editorContent?.className).toContain('min-h-full');
    expect(editorContent?.className).toContain('flex');
    expect(editorContent?.className).toContain('gap-3');

    const formGrid = screen.getByText('配置名称').closest('div');
    expect(formGrid?.className).toContain('gap-y-3');

    const cliConfigCard = screen.getByRole('heading', { name: 'CLI 配置' }).closest('div');
    expect(cliConfigCard?.className).toContain('space-y-2');

    const cliTestCard = screen.getByRole('heading', { name: 'CLI 测试' }).closest('div');
    expect(cliTestCard?.className).toContain('flex');
    expect(cliTestCard?.className).toContain('flex-1');
    expect(cliTestCard?.className).toContain('gap-2');
  });

  it('keeps each cli test card compact so the whole editor needs less scrolling', () => {
    render(<CustomCliPage />);

    const cliTestHeading = screen.getByRole('heading', { name: 'CLI 测试' });
    const cliTestCard = cliTestHeading.closest('div');
    expect(cliTestCard).not.toBeNull();

    const claudeCard = screen.getByRole('heading', { name: 'Claude Code' }).closest('section');
    expect(claudeCard).not.toBeNull();
    expect(claudeCard?.className).toContain('px-1');
    expect(claudeCard?.className).not.toContain('rounded-[var(--radius-md)]');
    expect(claudeCard?.className).not.toContain('border');

    const claudeHeader = screen.getByRole('heading', { name: 'Claude Code' }).closest('section')
      ?.firstElementChild as HTMLElement | null;
    expect(claudeHeader?.className).toContain('mb-1.5');
    expect(claudeHeader?.className).toContain('justify-between');
    expect(
      within(claudeCard as HTMLElement).getByRole('button', { name: '测试' })
    ).toBeInTheDocument();
  });

  it('removes the outer shells from cli config and cli test blocks while keeping cli config rows compact and width-adaptive', () => {
    render(<CustomCliPage />);

    const cliConfigBlock = screen.getByRole('heading', { name: 'CLI 配置' })
      .parentElement as HTMLElement | null;
    expect(cliConfigBlock).not.toBeNull();
    expect(cliConfigBlock?.className).toContain('space-y-2');
    expect(cliConfigBlock?.className).not.toContain('rounded-[var(--radius-lg)]');
    expect(cliConfigBlock?.className).not.toContain('border');

    const cliConfigList = screen.getByRole('heading', { name: 'CLI 配置' })
      .nextElementSibling as HTMLElement | null;
    expect(cliConfigList).not.toBeNull();
    expect(cliConfigList?.className).toContain('space-y-1');

    const previewButton = screen.getAllByRole('button', { name: '预览' })[0];
    const applyButton = screen.getAllByRole('button', { name: '应用' })[0];
    const cliConfigRow = previewButton.parentElement as HTMLElement | null;
    expect(cliConfigRow).not.toBeNull();
    expect(cliConfigRow?.className).toContain(
      'grid-cols-[minmax(0,128px)_44px_minmax(0,1fr)_68px_68px]'
    );
    expect(cliConfigRow?.className).toContain('px-1');
    expect(cliConfigRow?.className).toContain('py-0.5');
    expect(cliConfigRow?.className).not.toContain('rounded-[var(--radius-md)]');
    expect(cliConfigRow?.className).not.toContain('border');
    expect(previewButton.className).toContain('w-[68px]');
    expect(previewButton.className).toContain('h-8');
    expect(applyButton.className).toContain('w-[68px]');
    expect(applyButton.className).toContain('h-8');

    const cliTestBlock = screen.getByRole('heading', { name: 'CLI 测试' })
      .parentElement as HTMLElement | null;
    expect(cliTestBlock).not.toBeNull();
    expect(cliTestBlock?.className).toContain('flex');
    expect(cliTestBlock?.className).toContain('flex-1');
    expect(cliTestBlock?.className).toContain('gap-2');
    expect(cliTestBlock?.className).not.toContain('rounded-[var(--radius-lg)]');
    expect(cliTestBlock?.className).not.toContain('border');
  });

  it('switches the editor when clicking another config row, even when clicking the base url cell', () => {
    render(<CustomCliPage />);

    fireEvent.click(screen.getByText('https://backup.example.com'));

    expect(screen.getByDisplayValue('Backup Endpoint')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://backup.example.com')).toBeInTheDocument();

    const selectedRow = screen.getByRole('row', {
      name: /Backup Endpoint https:\/\/backup\.example\.com/i,
    });
    expect(selectedRow.className).toContain('shadow-[inset_4px_0_0_var(--accent)]');
    expect(selectedRow.className).toContain('bg-[var(--accent-soft-strong)]');
  });

  it('shows per-cli preview buttons and does not keep the inline config preview block', () => {
    render(<CustomCliPage />);

    expect(screen.getAllByRole('button', { name: '预览' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: '应用' })).toHaveLength(3);
    expect(screen.queryByText('配置文件预览')).not.toBeInTheDocument();

    const previewButton = screen.getAllByRole('button', { name: '预览' })[0];
    expect(previewButton.className).toContain('w-[68px]');
    expect(previewButton.className).toContain('px-2');
  });

  it('keeps disabled cli rows visually dimmed and prevents preview/apply actions without extra closed text', () => {
    render(<CustomCliPage />);

    const previewButtons = screen.getAllByRole('button', { name: '预览' });
    const applyButtons = screen.getAllByRole('button', { name: '应用' });
    const geminiConfigRow = document.querySelector(
      '[data-cli-config-row="geminiCli"]'
    ) as HTMLElement | null;

    expect(geminiConfigRow).not.toBeNull();
    expect(geminiConfigRow?.className).toContain('opacity-60');
    expect(within(geminiConfigRow as HTMLElement).queryByText('已关闭')).not.toBeInTheDocument();
    expect(previewButtons[2]).toBeDisabled();
    expect(applyButtons[2]).toBeDisabled();
  });

  it('renders a three-column CLI test area with separators and one compact test button beside each cli title', () => {
    render(<CustomCliPage />);

    expect(screen.getByRole('heading', { name: 'CLI 测试' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '测试' })).toHaveLength(3);

    const cliTestGrid = screen.getByRole('heading', { name: 'CLI 测试' })
      .nextElementSibling as HTMLElement | null;
    expect(cliTestGrid).not.toBeNull();
    expect(cliTestGrid?.className).toContain('grid-cols-3');
    expect(cliTestGrid?.className).toContain('divide-x');
    expect(cliTestGrid?.className).toContain('items-start');

    const claudeCard = screen.getByRole('heading', { name: 'Claude Code' }).closest('section');
    expect(claudeCard).not.toBeNull();
    expect(
      within(claudeCard as HTMLElement).getByRole('button', { name: '测试' })
    ).toBeInTheDocument();

    const testModelSelect = screen.getByLabelText('Claude Code 测试模型 1');
    expect(testModelSelect.className).toContain('min-w-0');
    expect(testModelSelect.className).toContain('py-1.5');
    expect(testModelSelect.className).toContain('text-xs');
  });

  it('opens the per-cli preview modal and supports reset', () => {
    render(<CustomCliPage />);

    fireEvent.click(screen.getAllByRole('button', { name: '预览' })[0]);

    expect(screen.getByRole('dialog', { name: 'Claude Code 配置预览' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
  });

  it('normalizes legacy codex edited previews back to the default OpenAI provider', () => {
    const previousEditedFiles = configs[0].cliSettings.codex.editedFiles;
    configs[0].cliSettings.codex.editedFiles = [
      {
        path: '~/.codex/config.toml',
        content: `model_provider = "Legacy"
model = "gpt-4.1"

[model_providers.Legacy]
name = "openai"
base_url = "https://example.com/v1"
wire_api = "responses"
requires_openai_auth = true`,
      },
      {
        path: '~/.codex/auth.json',
        content: '{\n  "OPENAI_API_KEY": "sk-test"\n}',
      },
    ];

    render(<CustomCliPage />);
    fireEvent.click(screen.getAllByRole('button', { name: '预览' })[1]);

    expect(screen.getByRole('dialog', { name: 'Codex 配置预览' })).toBeInTheDocument();
    expect(screen.getByText(/model_provider = "OpenAI"/)).toBeInTheDocument();
    expect(screen.getByText(/\[model_providers\.OpenAI\]/)).toBeInTheDocument();
    expect(screen.queryByText(/model_provider = "Legacy"/)).not.toBeInTheDocument();

    configs[0].cliSettings.codex.editedFiles = previousEditedFiles;
  });

  it('renders urls in the left-side name and notes cells as hyperlinks', () => {
    const previousName = configs[0].name;
    const previousNotes = configs[0].notes;
    configs[0].name = 'Portal https://portal.example.com';
    configs[0].notes = '签到地址: https://sign.example.com/app';

    try {
      render(<CustomCliPage />);

      const portalLink = screen.getByRole('link', { name: 'https://portal.example.com' });
      const noteLink = screen.getByRole('link', { name: 'https://sign.example.com/app' });

      expect(portalLink).toHaveAttribute('href', 'https://portal.example.com');
      expect(noteLink).toHaveAttribute('href', 'https://sign.example.com/app');
    } finally {
      configs[0].name = previousName;
      configs[0].notes = previousNotes;
    }
  });

  it('renders the plain config name as a hyperlink to its base url and opens it via the electron bridge', () => {
    render(<CustomCliPage />);

    const nameLink = screen.getByRole('link', { name: 'Main Endpoint' });

    expect(nameLink).toHaveAttribute('href', 'https://example.com');

    fireEvent.click(nameLink);

    expect(mockOpenUrl).toHaveBeenCalledWith('https://example.com');
  });

  it('tests only the clicked cli with its own selected models', async () => {
    const runCliTests = vi.fn().mockResolvedValue({
      status: true,
      testedAt: Date.now(),
      slots: [
        {
          model: 'claude-3-5-sonnet',
          success: true,
          timestamp: Date.now(),
        },
        null,
        null,
      ],
    });

    render(<CustomCliPage runCliTests={runCliTests} />);

    const claudeCard = screen.getByRole('heading', { name: 'Claude Code' }).closest('section');
    fireEvent.click(within(claudeCard as HTMLElement).getByRole('button', { name: '测试' }));

    await waitFor(() => {
      expect(runCliTests).toHaveBeenCalledWith(configs[0], 'claudeCode', ['claude-3-5-sonnet']);
    });
  });

  it('opens merge and overwrite choices before applying the selected cli row locally', () => {
    render(<CustomCliPage />);

    fireEvent.click(screen.getAllByRole('button', { name: '应用' })[0]);

    expect(mockWriteConfig).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '合并' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '覆盖' })).toBeInTheDocument();
  });

  it('applies the selected cli row to local files with the chosen mode via the existing write-config bridge', async () => {
    render(<CustomCliPage />);

    fireEvent.click(screen.getAllByRole('button', { name: '应用' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '覆盖' }));

    await waitFor(() => {
      expect(mockWriteConfig).toHaveBeenCalledWith({
        cliType: 'claudeCode',
        files: expect.arrayContaining([
          expect.objectContaining({
            path: '~/.claude/settings.json',
          }),
        ]),
        applyMode: 'overwrite',
      });
    });

    expect(mockClearCache).toHaveBeenCalledWith('claudeCode');
    expect(mockClearCliConfigDetection).toHaveBeenCalled();
  });
});
