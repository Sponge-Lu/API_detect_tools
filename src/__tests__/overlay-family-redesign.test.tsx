import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppModal } from '../renderer/components/AppModal/AppModal';
import { OverlayDrawer } from '../renderer/components/overlays/OverlayDrawer';
import { UnifiedCliConfigDialog } from '../renderer/components/dialogs/UnifiedCliConfigDialog';
import { CustomCliConfigEditorDialog } from '../renderer/components/dialogs/CustomCliConfigEditorDialog';
import { WebDAVBackupDialog } from '../renderer/components/dialogs/WebDAVBackupDialog';
import type { CliConfig } from '../shared/types/cli-config';
import type { CustomCliConfig } from '../shared/types/custom-cli-config';

const editedCliConfig: CliConfig = {
  claudeCode: {
    apiKeyId: 1,
    model: 'claude-3-5-sonnet',
    testModel: 'claude-3-5-sonnet',
    testModels: ['claude-3-5-sonnet'],
    enabled: true,
    editedFiles: [
      { path: 'claude-code/settings.json', content: '{\n  "model": "claude-3-5-sonnet"\n}' },
    ],
    applyMode: 'merge',
  },
  codex: {
    apiKeyId: null,
    model: null,
    testModel: null,
    testModels: [],
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
  },
  geminiCli: {
    apiKeyId: null,
    model: null,
    testModel: null,
    testModels: [],
    enabled: true,
    editedFiles: null,
    applyMode: 'merge',
  },
};

const editedCustomCliConfig: CustomCliConfig = {
  id: 'custom-cli-1',
  name: 'Custom Endpoint',
  baseUrl: 'https://example.com',
  apiKey: 'sk-custom',
  models: ['claude-3-5-sonnet'],
  notes: '',
  cliSettings: {
    claudeCode: {
      enabled: true,
      model: 'claude-3-5-sonnet',
      testModels: ['claude-3-5-sonnet'],
      editedFiles: [
        {
          path: 'claude-code/settings.json',
          content: '{\n  "model": "claude-3-5-sonnet"\n}',
        },
      ],
    },
    codex: {
      enabled: true,
      model: null,
      testModels: [],
      editedFiles: null,
    },
    geminiCli: {
      enabled: true,
      model: null,
      testModels: [],
      editedFiles: null,
    },
  },
  createdAt: 1,
  updatedAt: 1,
};

function StatefulWebDAVDialog() {
  const [isOpen, setIsOpen] = useState(true);

  return <WebDAVBackupDialog isOpen={isOpen} onClose={() => setIsOpen(false)} />;
}

function StatefulUnifiedCliDialog() {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <UnifiedCliConfigDialog
      isOpen={isOpen}
      siteName="Claude Hub"
      siteUrl="https://example.com"
      apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
      siteModels={['claude-3-5-sonnet']}
      currentConfig={editedCliConfig}
      onClose={() => setIsOpen(false)}
      onSave={vi.fn()}
    />
  );
}

describe('overlay family redesign', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares the same chrome markers across modal and drawer', () => {
    render(
      <>
        <AppModal isOpen={true} onClose={vi.fn()} title="编辑站点" footer={<button>保存</button>}>
          <div>body</div>
        </AppModal>
        <OverlayDrawer
          isOpen={true}
          onClose={vi.fn()}
          title="CLI 工作台"
          footer={<button>应用</button>}
        >
          <div>body</div>
        </OverlayDrawer>
      </>
    );

    expect(screen.getAllByTestId('overlay-title').length).toBe(2);
    expect(screen.getAllByTestId('overlay-body').length).toBe(2);
    expect(screen.getAllByTestId('overlay-footer').length).toBe(2);
    expect(screen.getByRole('dialog', { name: '编辑站点' })).toHaveClass(
      'border-[var(--line-soft)]',
      'bg-[var(--surface-1)]'
    );
  });

  it('keeps drawer scroll ownership inside the content instead of forcing a second scroll body', () => {
    render(
      <OverlayDrawer isOpen={true} onClose={vi.fn()} title="CLI 工作台">
        <div className="overflow-y-auto">body</div>
      </OverlayDrawer>
    );

    expect(screen.getByTestId('overlay-body').className).not.toContain('overflow-y-auto');
  });

  it('opens reset confirmation as another overlay family member from the CLI drawer', () => {
    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="Claude Hub"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet']}
        currentConfig={editedCliConfig}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '重置' }));

    const overlayRoots = Array.from(document.body.querySelectorAll('[role="presentation"]'));

    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(overlayRoots).toHaveLength(2);
    expect(overlayRoots.some(node => node.className.includes('z-[220]'))).toBe(true);
    expect(screen.getAllByTestId('overlay-title')).toHaveLength(2);
    expect(screen.getAllByTestId('overlay-body')).toHaveLength(2);
    expect(screen.getAllByTestId('overlay-footer')).toHaveLength(2);
  });

  it('centers the CLI config dialog and removes the task-domain header card', () => {
    const onTestCompatibility = vi.fn();

    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="Claude Hub"
        accountName="Primary"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet']}
        currentConfig={editedCliConfig}
        compatibility={{
          claudeCode: true,
          codex: null,
          geminiCli: null,
          testedAt: Date.now(),
        }}
        isTestingCompatibility={false}
        onTestCompatibility={onTestCompatibility}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    const overlayRoot = document.body.querySelector('[role="presentation"]') as HTMLElement;

    expect(overlayRoot.className).toContain('justify-center');
    expect(overlayRoot.className).toContain('items-center');
    expect(screen.queryByText('当前任务域')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '测试兼容性' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '应用当前 CLI' })).not.toBeInTheDocument();
    expect(onTestCompatibility).not.toHaveBeenCalled();
  });

  it('keeps the CLI dialog scroller height-constrained so content can scroll vertically', () => {
    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="Claude Hub"
        accountName="Primary"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet']}
        currentConfig={editedCliConfig}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    const scroller = screen.getByTestId('overlay-body').firstElementChild as HTMLDivElement;
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('max-h-[calc(100vh-5rem)]');
    expect(dialog.className).toContain('overflow-hidden');
    expect(scroller.className).toContain('overflow-y-auto');
    expect(scroller.className).toContain('h-full');
    expect(scroller.className).toContain('min-h-0');
  });

  it('tests only the selected model rows and renders plain 成功/失败 text on the same row', async () => {
    const testWithConfig = vi.fn().mockResolvedValueOnce({
      success: true,
      data: { claudeCode: true },
    });

    const electronAPI = ((window as any).electronAPI ??= {}) as Record<string, unknown> as any;
    electronAPI.cliCompat = {
      ...electronAPI.cliCompat,
      testWithConfig,
    };

    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="Claude Hub"
        accountName="Primary"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet', 'claude-3-7-sonnet']}
        currentConfig={{
          claudeCode: {
            apiKeyId: 1,
            model: 'claude-3-5-sonnet',
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          codex: {
            apiKeyId: null,
            model: null,
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          geminiCli: {
            apiKeyId: null,
            model: null,
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: '测试兼容性' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '测试模型 1' }));
    fireEvent.click(await screen.findByText('claude-3-7-sonnet'));

    fireEvent.click(screen.getByRole('button', { name: '测试已选模型' }));

    await waitFor(() => expect(testWithConfig).toHaveBeenCalledTimes(1));
    expect(testWithConfig).toHaveBeenCalledWith({
      siteUrl: 'https://example.com',
      configs: [
        {
          cliType: 'claudeCode',
          apiKey: 'sk-test',
          model: 'claude-3-7-sonnet',
          baseUrl: 'https://example.com',
        },
      ],
    });

    const successText = await screen.findByText('成功');
    expect(successText).toBeInTheDocument();
    expect((successText as HTMLElement).className).not.toContain('rounded-full');
    expect(screen.queryByText('失败')).not.toBeInTheDocument();
    expect(screen.queryByText('刚刚测试')).not.toBeInTheDocument();
  });

  it('persists selected-model test results through a config callback so they can be restored later', async () => {
    const testWithConfig = vi.fn().mockResolvedValueOnce({
      success: true,
      data: { claudeCode: true },
    });
    const onPersistConfig = vi.fn();

    const electronAPI = ((window as any).electronAPI ??= {}) as Record<string, unknown> as any;
    electronAPI.cliCompat = {
      ...electronAPI.cliCompat,
      testWithConfig,
    };

    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="Claude Hub"
        accountName="Primary"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet', 'claude-3-7-sonnet']}
        currentConfig={{
          claudeCode: {
            apiKeyId: 1,
            model: 'claude-3-5-sonnet',
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          codex: {
            apiKeyId: null,
            model: null,
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          geminiCli: {
            apiKeyId: null,
            model: null,
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
        }}
        onPersistConfig={onPersistConfig}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '测试模型 1' }));
    fireEvent.click(await screen.findByText('claude-3-7-sonnet'));
    fireEvent.click(screen.getByRole('button', { name: '测试已选模型' }));

    await waitFor(() => expect(onPersistConfig).toHaveBeenCalledTimes(1));
    expect(onPersistConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        claudeCode: expect.objectContaining({
          testModels: ['claude-3-7-sonnet'],
          testResults: [
            expect.objectContaining({
              model: 'claude-3-7-sonnet',
              success: true,
            }),
            null,
            null,
          ],
        }),
      })
    );
  });

  it('restores persisted per-model test results when reopening the dialog', () => {
    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="Claude Hub"
        accountName="Primary"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet']}
        currentConfig={{
          claudeCode: {
            apiKeyId: 1,
            model: 'claude-3-5-sonnet',
            testModel: 'claude-3-5-sonnet',
            testModels: ['claude-3-5-sonnet'],
            testResults: [
              {
                model: 'claude-3-5-sonnet',
                success: true,
                timestamp: Date.now(),
              },
              null,
              null,
            ],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          codex: {
            apiKeyId: null,
            model: null,
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          geminiCli: {
            apiKeyId: null,
            model: null,
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByText('成功')).toBeInTheDocument();
  });

  it('moves CLI switches into each CLI type row and removes the extra labels', () => {
    const { container } = render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="Claude Hub"
        accountName="Primary"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet']}
        currentConfig={editedCliConfig}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.queryByText('CLI 开关')).not.toBeInTheDocument();
    expect(screen.queryByText('选择 CLI 类型进行配置')).not.toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(3);
    expect(document.body.querySelector('.grid.grid-cols-3')).not.toBeNull();
  });

  it('uses a darker selected-state fill so the active CLI row is obvious at a glance', () => {
    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="Claude Hub"
        accountName="Primary"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet']}
        currentConfig={editedCliConfig}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    const selectedCliRow = screen.getByText('Claude Code').closest('button')
      ?.parentElement as HTMLElement;
    expect(selectedCliRow.className).toContain('bg-[var(--accent-soft-strong)]');
    expect(selectedCliRow.className).toContain('ring-1');
  });

  it('uses matching header rows for test models and CLI model so both columns stay top-aligned', () => {
    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="Claude Hub"
        accountName="Primary"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet']}
        currentConfig={editedCliConfig}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    const testHeaderRow = screen.getByText('测试使用模型').parentElement as HTMLDivElement;
    const cliHeaderRow = screen.getByText('CLI 使用模型').parentElement as HTMLDivElement;

    expect(testHeaderRow.className).toContain('mb-2');
    expect(testHeaderRow.className).toContain('flex');
    expect(testHeaderRow.className).toContain('items-center');
    expect(testHeaderRow.className).toContain('justify-between');
    expect(cliHeaderRow.className).toContain('mb-2');
    expect(cliHeaderRow.className).toContain('flex');
    expect(cliHeaderRow.className).toContain('items-center');
    expect(cliHeaderRow.className).toContain('justify-between');
  });

  it('offers searchable model pickers without filtering by CLI prefix', async () => {
    render(
      <UnifiedCliConfigDialog
        isOpen={true}
        siteName="Claude Hub"
        accountName="Primary"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet', 'gpt-4.1', 'gemini-2.5-pro']}
        currentConfig={{
          claudeCode: {
            apiKeyId: 1,
            model: 'claude-3-5-sonnet',
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          codex: {
            apiKeyId: null,
            model: null,
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
          geminiCli: {
            apiKeyId: null,
            model: null,
            testModel: null,
            testModels: [],
            enabled: true,
            editedFiles: null,
            applyMode: 'merge',
          },
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '测试模型 1' }));
    expect(await screen.findByPlaceholderText('搜索模型...')).toBeInTheDocument();
    expect(await screen.findByText('gpt-4.1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'CLI 使用模型' }));
    expect(await screen.findAllByPlaceholderText('搜索模型...')).toHaveLength(2);
    expect((await screen.findAllByText('gemini-2.5-pro')).length).toBeGreaterThan(0);
  });

  it('opens reset confirmation as another overlay family member from the custom CLI drawer', async () => {
    await act(async () => {
      render(
        <CustomCliConfigEditorDialog
          isOpen={true}
          config={editedCustomCliConfig}
          onClose={vi.fn()}
        />
      );

      await new Promise(resolve => setTimeout(resolve, 0));
    });

    fireEvent.click(await screen.findByRole('button', { name: '重置' }));

    const overlayRoots = Array.from(document.body.querySelectorAll('[role="presentation"]'));

    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(overlayRoots).toHaveLength(2);
    expect(overlayRoots.some(node => node.className.includes('z-[220]'))).toBe(true);
    expect(screen.getAllByTestId('overlay-title')).toHaveLength(2);
    expect(screen.getAllByTestId('overlay-body')).toHaveLength(2);
    expect(screen.getAllByTestId('overlay-footer')).toHaveLength(2);
  });

  it('keeps WebDAV backup management and destructive confirmation inside the shared modal family', async () => {
    const electronAPI = ((window as any).electronAPI ??= {}) as Record<string, unknown> as any;
    electronAPI.webdav = {
      ...electronAPI.webdav,
      listBackups: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            filename: 'backup-2026-04-01.json',
            lastModified: '2026-04-01T00:00:00.000Z',
            size: 2048,
          },
        ],
      }),
      uploadBackup: vi.fn(),
      restoreBackup: vi.fn(),
      deleteBackup: vi.fn(),
    };

    render(<WebDAVBackupDialog isOpen={true} onClose={vi.fn()} />);

    const webdavDialog = await screen.findByRole('dialog', { name: 'WebDAV 云端备份' });
    expect(within(webdavDialog).getByRole('button', { name: '上传备份' })).toBeInTheDocument();
    expect(await within(webdavDialog).findByText('backup-2026-04-01.json')).toBeInTheDocument();
    expect(screen.getAllByTestId('overlay-title')).toHaveLength(1);
    expect(screen.getAllByTestId('overlay-body')).toHaveLength(1);
    expect(screen.getAllByTestId('overlay-footer')).toHaveLength(1);

    fireEvent.click(within(webdavDialog).getByTitle('删除此备份'));

    const confirmDialog = await screen.findByRole('dialog', { name: '确认删除' });
    expect(within(confirmDialog).getByText('此操作无法撤销。')).toBeInTheDocument();
    expect(document.body.querySelectorAll('[role="presentation"]')).toHaveLength(2);
    expect(screen.getAllByTestId('overlay-title')).toHaveLength(2);
    expect(screen.getAllByTestId('overlay-body')).toHaveLength(2);
    expect(screen.getAllByTestId('overlay-footer')).toHaveLength(2);
  });

  it('lets Escape close only the nested confirm while keeping the parent WebDAV dialog open', async () => {
    const electronAPI = ((window as any).electronAPI ??= {}) as Record<string, unknown> as any;
    electronAPI.webdav = {
      ...electronAPI.webdav,
      listBackups: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            filename: 'backup-2026-04-01.json',
            lastModified: '2026-04-01T00:00:00.000Z',
            size: 2048,
          },
        ],
      }),
      uploadBackup: vi.fn(),
      restoreBackup: vi.fn(),
      deleteBackup: vi.fn(),
    };

    render(<StatefulWebDAVDialog />);

    const webdavDialog = await screen.findByRole('dialog', { name: 'WebDAV 云端备份' });
    fireEvent.click(within(webdavDialog).getByTitle('删除此备份'));
    expect(await screen.findByRole('dialog', { name: '确认删除' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '确认删除' })).not.toBeInTheDocument();
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 260));
    });

    expect(screen.getByRole('dialog', { name: 'WebDAV 云端备份' })).toBeInTheDocument();
    expect(screen.getAllByTestId('overlay-title')).toHaveLength(1);
  });

  it('lets Escape close only the nested confirm while keeping the parent drawer open', async () => {
    render(<StatefulUnifiedCliDialog />);

    fireEvent.click(await screen.findByRole('button', { name: '重置' }));
    expect(await screen.findByRole('dialog', { name: '确认重置' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '确认重置' })).not.toBeInTheDocument();
    });

    const drawerDialog = screen.getByRole('dialog', { name: 'CLI 配置 - Claude Hub' });
    expect(drawerDialog).toHaveClass('opacity-100');
    expect(screen.getAllByTestId('overlay-title')).toHaveLength(1);
  });

  it('keeps drawer ownership until the child confirm fully unmounts during a rapid double Escape', async () => {
    render(<StatefulUnifiedCliDialog />);

    fireEvent.click(await screen.findByRole('button', { name: '重置' }));
    const drawerDialog = screen.getByRole('dialog', { name: 'CLI 配置 - Claude Hub' });
    expect(await screen.findByRole('dialog', { name: '确认重置' })).toBeInTheDocument();

    vi.useFakeTimers();

    fireEvent.keyDown(window, { key: 'Escape' });

    const closingConfirm = screen.getByRole('dialog', { name: '确认重置' });
    expect(closingConfirm).toHaveClass('scale-95', 'opacity-0');
    expect(drawerDialog).toHaveClass('opacity-100');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByRole('dialog', { name: '确认重置' })).toBeInTheDocument();
    expect(drawerDialog).toHaveClass('opacity-100');

    await act(async () => {
      vi.advanceTimersByTime(219);
    });

    expect(screen.getByRole('dialog', { name: '确认重置' })).toBeInTheDocument();
    expect(drawerDialog).toHaveClass('opacity-100');

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(screen.queryByRole('dialog', { name: '确认重置' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'CLI 配置 - Claude Hub' })).toHaveClass(
      'opacity-100'
    );
  });
});
