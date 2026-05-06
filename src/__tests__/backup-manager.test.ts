import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'D:/api-hub-test-user-data'),
  },
}));

vi.mock('../main/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { BackupManager } from '../main/backup-manager';

describe('BackupManager', () => {
  let tempDir: string;
  let sourcePath: string;
  let backupDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-hub-backup-manager-'));
    sourcePath = path.join(tempDir, 'config.json');
    backupDir = path.join(tempDir, 'backups');
    await fs.writeFile(sourcePath, '{"version":"3.1","sites":[]}', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('skips automatic backups inside the throttle window', async () => {
    const manager = new BackupManager({
      backupDir,
      minAutoBackupIntervalMs: 60_000,
    });

    await expect(manager.backupFile(sourcePath)).resolves.toBe(true);
    await fs.writeFile(sourcePath, '{"version":"3.1","sites":[{"id":"site-1"}]}', 'utf-8');

    await expect(manager.backupFile(sourcePath)).resolves.toBe(false);

    expect(manager.listBackups()).toHaveLength(1);
  });

  it('dedupes unchanged content after the throttle window', async () => {
    const manager = new BackupManager({
      backupDir,
      minAutoBackupIntervalMs: 0,
    });

    await expect(manager.backupFile(sourcePath)).resolves.toBe(true);
    await expect(manager.backupFile(sourcePath)).resolves.toBe(false);

    expect(manager.listBackups()).toHaveLength(1);
  });

  it('allows forced safety-point backups and still applies retention', async () => {
    const manager = new BackupManager({
      backupDir,
      maxBackups: 2,
      minAutoBackupIntervalMs: 60_000,
    });

    await expect(manager.backupFile(sourcePath, { force: true, reason: 'manual' })).resolves.toBe(
      true
    );
    await expect(manager.backupFile(sourcePath, { force: true, reason: 'manual' })).resolves.toBe(
      true
    );
    await expect(manager.backupFile(sourcePath, { force: true, reason: 'manual' })).resolves.toBe(
      true
    );

    expect(manager.listBackups()).toHaveLength(2);
  });
});
