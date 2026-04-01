import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CustomCliPage } from '../renderer/pages/CustomCliPage';

const mockLoadConfigs = vi.fn();
const mockAddConfig = vi.fn();
const mockDeleteConfig = vi.fn();

vi.mock('../renderer/store/customCliConfigStore', () => ({
  useCustomCliConfigStore: () => ({
    configs: [
      {
        id: 'cfg-1',
        name: 'Main Endpoint',
        baseUrl: 'https://example.com',
        apiKey: 'sk-test',
        models: ['claude-3-5-sonnet', 'gpt-4.1'],
        notes: 'alpha',
        cliSettings: {
          claudeCode: { enabled: true, model: 'claude-3-5-sonnet', testModels: [] },
          codex: { enabled: true, model: 'gpt-4.1', testModels: [] },
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
        notes: '',
        cliSettings: {
          claudeCode: { enabled: false, model: null, testModels: [] },
          codex: { enabled: false, model: null, testModels: [] },
          geminiCli: { enabled: true, model: 'gemini-2.5-pro', testModels: [] },
        },
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    loading: false,
    loadConfigs: mockLoadConfigs,
    addConfig: mockAddConfig,
    deleteConfig: mockDeleteConfig,
  }),
}));

vi.mock('../renderer/store/detectionStore', () => ({
  useDetectionStore: () => ({
    clearCliConfigDetection: vi.fn(),
    detectCliConfig: vi.fn(),
  }),
}));

vi.mock('../renderer/store/configStore', () => ({
  useConfigStore: () => ({
    config: { sites: [] },
  }),
}));

vi.mock('../renderer/components/dialogs/CustomCliConfigEditorDialog', () => ({
  CustomCliConfigEditorDialog: () => <div>Mock Custom CLI Editor</div>,
}));

describe('custom cli page redesign', () => {
  it('renders real CLI logos instead of text placeholders in the page-level affordances', () => {
    render(<CustomCliPage />);

    expect(screen.getAllByAltText('Claude Code').length).toBeGreaterThan(0);
    expect(screen.getAllByAltText('Codex').length).toBeGreaterThan(0);
    expect(screen.getAllByAltText('Gemini CLI').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^C$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^X$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^G$/)).not.toBeInTheDocument();
  });
});
