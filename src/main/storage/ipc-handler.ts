import { ipcMain } from 'electron';
import { getApplicationStorage } from './application-storage';
import { parseStateVersion } from '../../shared/types/app-storage-contract';
import { ROUTE_STABLE_COMMAND_CHANNELS } from '../../shared/types/route-command-channels';
import { StorageConflictError } from './database/storage-coordinator';

const maintenanceChannels = new Set([
  'backup:manual',
  'backup:export-config-package',
  'backup:import-config-package',
  'backup:restore-config',
  'webdav:upload-backup',
  'webdav:restore-backup',
  'storage:export',
  'storage:import',
]);

export function handleStorageIpc(
  channel: string,
  listener: Parameters<typeof ipcMain.handle>[1],
  afterCommit?: Parameters<typeof ipcMain.handle>[1]
): void {
  ipcMain.handle(channel, (event, ...args) => {
    const storage = getApplicationStorage();
    const run = async () => {
      let result: unknown;
      if (storage && ROUTE_STABLE_COMMAND_CHANNELS.includes(channel)) {
        const { unifiedConfigManager } = await import('../unified-config-manager');
        const envelope = args.pop() as { storageVersion?: unknown } | undefined;
        if (!envelope?.storageVersion)
          throw Object.assign(new Error('Versioned route commands are required'), {
            code: 'LEGACY_WRITE_DISABLED',
          });
        const expected = parseStateVersion(envelope.storageVersion);
        result = await unifiedConfigManager.mutateConfig(async () => {
          const current = storage.coordinator.version('app-config');
          if (JSON.stringify(expected) !== JSON.stringify(current))
            throw new StorageConflictError(current);
          const response = await listener(event, ...args);
          if (response && typeof response === 'object' && response.success === false)
            throw new Error(String(response.error ?? 'Route command failed'));
          return response;
        });
      } else result = await listener(event, ...args);
      if (
        afterCommit &&
        !(result && typeof result === 'object' && 'success' in result && result.success === false)
      )
        await afterCommit(event, ...args);
      return storage && channel.startsWith('route:') && result && typeof result === 'object'
        ? { ...result, storageVersion: storage.coordinator.version('app-config') }
        : result;
    };
    return storage && !maintenanceChannels.has(channel) ? storage.withActivity(run) : run();
  });
}
