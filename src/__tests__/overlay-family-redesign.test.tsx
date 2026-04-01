import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
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
    editedFiles: [{ path: 'claude-code/settings.json', content: '{\n  "model": "claude-3-5-sonnet"\n}' }],
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

describe('overlay family redesign', () => {
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

  it('keeps test and apply actions inside the CLI workbench drawer', () => {
    const onTestCompatibility = vi.fn();
    const onApplySelectedCli = vi.fn();

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
        onApplySelectedCli={onApplySelectedCli}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '测试兼容性' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用当前 CLI' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '应用当前 CLI' }));
    expect(onApplySelectedCli).toHaveBeenCalledWith('claudeCode', 'merge');

    fireEvent.click(screen.getByRole('button', { name: '测试兼容性' }));
    expect(onTestCompatibility).toHaveBeenCalledTimes(1);
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
    const electronAPI = (((window as any).electronAPI ??= {}) as Record<string, unknown>) as any;
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
    const electronAPI = (((window as any).electronAPI ??= {}) as Record<string, unknown>) as any;
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
});
