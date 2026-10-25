import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { handleStorageIpc } from '../main/storage/ipc-handler';
import { unifiedConfigManager } from '../main/unified-config-manager';

const mocks = vi.hoisted(() => ({
  version: { generation: 'test', scope: 'app-config', revision: 1 },
  mutate: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../main/storage/application-storage', () => ({
  getApplicationStorage: () => ({
    coordinator: { version: () => mocks.version },
    withActivity: (run: () => Promise<unknown>) => run(),
  }),
}));
vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: { mutateConfig: mocks.mutate },
}));

describe('post-commit route lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['route:start-server', 'route:stop-server', 'route:save-server-config'])(
    'runs the lifecycle callback only after %s commits',
    async channel => {
      const order: string[] = [];
      vi.mocked(unifiedConfigManager.mutateConfig).mockImplementation(async operation => {
        const result = await operation();
        order.push('commit');
        return result;
      });
      handleStorageIpc(
        channel,
        async () => {
          order.push('update');
          return { success: true };
        },
        async () => {
          order.push('lifecycle');
        }
      );
      const handler = vi.mocked(ipcMain.handle).mock.calls[0][1];
      await handler({} as Electron.IpcMainInvokeEvent, { storageVersion: mocks.version });
      expect(order).toEqual(['update', 'commit', 'lifecycle']);
    }
  );

  it('never changes the listener when persistence fails after the command succeeds', async () => {
    mocks.mutate.mockImplementation(async operation => {
      await operation();
      throw new Error('SQL commit failed');
    });
    const lifecycle = vi.fn();
    handleStorageIpc('route:start-server', async () => ({ success: true }), lifecycle);
    const handler = vi.mocked(ipcMain.handle).mock.calls[0][1];
    await expect(
      handler({} as Electron.IpcMainInvokeEvent, { storageVersion: mocks.version })
    ).rejects.toThrow('SQL commit failed');
    expect(lifecycle).not.toHaveBeenCalled();
  });

  it('rejects a stale version before executing the command or lifecycle', async () => {
    mocks.mutate.mockImplementation(async operation => operation());
    const command = vi.fn();
    const lifecycle = vi.fn();
    handleStorageIpc('route:start-server', command, lifecycle);
    const handler = vi.mocked(ipcMain.handle).mock.calls[0][1];
    await expect(
      handler({} as Electron.IpcMainInvokeEvent, {
        storageVersion: { ...mocks.version, revision: 0 },
      })
    ).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
    expect(lifecycle).not.toHaveBeenCalled();
  });

  it('does not run lifecycle work when the command reports failure', async () => {
    mocks.mutate.mockImplementation(async operation => operation());
    const lifecycle = vi.fn();
    handleStorageIpc(
      'route:start-server',
      async () => ({ success: false, error: 'Invalid config' }),
      lifecycle
    );
    const handler = vi.mocked(ipcMain.handle).mock.calls[0][1];
    await expect(
      handler({} as Electron.IpcMainInvokeEvent, { storageVersion: mocks.version })
    ).rejects.toThrow('Invalid config');
    expect(lifecycle).not.toHaveBeenCalled();
  });

  it('reports lifecycle failures after successful persistence', async () => {
    mocks.mutate.mockImplementation(async operation => operation());
    handleStorageIpc(
      'route:start-server',
      async () => ({ success: true }),
      async () => {
        throw new Error('Port occupied');
      }
    );
    const handler = vi.mocked(ipcMain.handle).mock.calls[0][1];
    await expect(
      handler({} as Electron.IpcMainInvokeEvent, { storageVersion: mocks.version })
    ).rejects.toThrow('Port occupied');
  });
});
