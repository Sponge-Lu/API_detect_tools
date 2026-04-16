import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedCliConfigDialog } from '../renderer/components/dialogs/UnifiedCliConfigDialog';
import type { CliConfig } from '../shared/types/cli-config';

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
    testModel: 'gemini-2.5-pro',
    testModels: ['gemini-2.5-pro', '', ''],
    testResults: [],
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
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

describe('UnifiedCliConfigDialog', () => {
  beforeEach(() => {
    window.electronAPI = {
      ...window.electronAPI,
      cliCompat: {
        ...window.electronAPI?.cliCompat,
        testWithWrapper: vi.fn().mockResolvedValue({
          success: true,
          data: {
            codex: true,
          },
        }),
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
          },
        ],
      })
    );
    await waitFor(() => expect(screen.getByText('Codex')).toHaveClass('text-[var(--accent)]'));
    expect(screen.getByText('Claude Code')).not.toHaveClass('text-[var(--accent)]');
  });
});
