import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppModal } from '../renderer/components/AppModal/AppModal';
import { OverlayDrawer } from '../renderer/components/overlays/OverlayDrawer';
import { ManagedCliConfigEditorContent } from '../renderer/components/dialogs/ManagedCliConfigEditorContent';
import { DirectCliConfigEditorContent } from '../renderer/components/dialogs/DirectCliConfigEditorContent';
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

const originalWindowInnerHeight = window.innerHeight;

function setWindowInnerHeight(height: number) {
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: height,
  });
}

function StatefulWebDAVDialog() {
  const [isOpen, setIsOpen] = useState(true);

  return <WebDAVBackupDialog isOpen={isOpen} onClose={() => setIsOpen(false)} />;
}

describe('overlay family redesign', () => {
  afterEach(() => {
    vi.useRealTimers();
    setWindowInnerHeight(originalWindowInnerHeight);
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

    expect(screen.getAllByTestId('overlay-title')).toHaveLength(2);
    expect(screen.getAllByTestId('overlay-body')).toHaveLength(2);
    expect(screen.getAllByTestId('overlay-footer')).toHaveLength(2);
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

  it('keeps default modal overlays above drawers so drawer-launched dialogs remain operable', () => {
    render(
      <>
        <OverlayDrawer isOpen={true} onClose={vi.fn()} title="站点详情">
          <button type="button">打开弹窗</button>
        </OverlayDrawer>
        <AppModal isOpen={true} onClose={vi.fn()} title="确认操作">
          <div>确认内容</div>
        </AppModal>
      </>
    );

    const drawerDialog = screen.getByRole('dialog', { name: '站点详情' });
    const modalDialog = screen.getByRole('dialog', { name: '确认操作' });

    expect(drawerDialog.closest('[role="presentation"]')).toHaveClass('z-[190]');
    expect(modalDialog.closest('[role="presentation"]')).toHaveClass('z-[200]');
  });

  it('closes only for real overlay clicks, not for drag-release gestures that start inside the drawer', () => {
    const onClose = vi.fn();

    render(
      <OverlayDrawer isOpen={true} onClose={onClose} title="CLI 工作台">
        <button type="button">body</button>
      </OverlayDrawer>
    );

    const overlayRoot = document.body.querySelector('[role="presentation"]') as HTMLElement;
    const dialog = screen.getByRole('dialog', { name: 'CLI 工作台' });

    fireEvent.mouseDown(dialog);
    fireEvent.mouseUp(overlayRoot);
    fireEvent.click(overlayRoot);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(overlayRoot);
    fireEvent.mouseUp(overlayRoot);
    fireEvent.click(overlayRoot);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when clicking the drawer backdrop outside the panel', () => {
    const onClose = vi.fn();

    render(
      <OverlayDrawer isOpen={true} onClose={onClose} title="站点详情">
        <button type="button">面板内容</button>
      </OverlayDrawer>
    );

    const backdrop = document.body.querySelector('[data-perf-monitor="blur"]') as HTMLElement;

    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('routes managed CLI reset confirmation through showDialog without creating nested overlays', async () => {
    const showDialog = vi.fn().mockResolvedValue(true);

    render(
      <ManagedCliConfigEditorContent
        siteName="Claude Hub"
        siteUrl="https://example.com"
        apiKeys={[{ id: 1, name: 'Default Key', key: 'sk-test' }]}
        siteModels={['claude-3-5-sonnet']}
        currentConfig={editedCliConfig}
        showDialog={showDialog}
        onSave={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTitle('重置为默认配置'));

    await waitFor(() =>
      expect(showDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '确认重置',
          confirmText: '确认重置',
        })
      )
    );
    expect(document.body.querySelectorAll('[role="presentation"]')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('routes direct CLI reset confirmation through showDialog without creating nested overlays', async () => {
    const showDialog = vi.fn().mockResolvedValue(true);

    render(
      <DirectCliConfigEditorContent
        section="cli"
        config={editedCustomCliConfig}
        showDialog={showDialog}
      />
    );

    fireEvent.click(screen.getByTitle('重置为默认配置'));

    await waitFor(() =>
      expect(showDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '确认重置',
          confirmText: '确认重置',
        })
      )
    );
    expect(document.body.querySelectorAll('[role="presentation"]')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

    const webdavDialog = await screen.findByRole('dialog', { name: 'WebDAV 云端配置包' });
    expect(within(webdavDialog).getByRole('button', { name: '上传配置包' })).toBeInTheDocument();
    expect(await within(webdavDialog).findByText('backup-2026-04-01.json')).toBeInTheDocument();
    expect(screen.getAllByTestId('overlay-title')).toHaveLength(1);
    expect(screen.getAllByTestId('overlay-body')).toHaveLength(1);
    expect(screen.getAllByTestId('overlay-footer')).toHaveLength(1);

    fireEvent.click(within(webdavDialog).getByTitle('删除此配置包'));

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

    const webdavDialog = await screen.findByRole('dialog', { name: 'WebDAV 云端配置包' });
    fireEvent.click(within(webdavDialog).getByTitle('删除此配置包'));
    expect(await screen.findByRole('dialog', { name: '确认删除' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '确认删除' })).not.toBeInTheDocument();
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 260));
    });

    expect(screen.getByRole('dialog', { name: 'WebDAV 云端配置包' })).toBeInTheDocument();
    expect(screen.getAllByTestId('overlay-title')).toHaveLength(1);
  });
});
