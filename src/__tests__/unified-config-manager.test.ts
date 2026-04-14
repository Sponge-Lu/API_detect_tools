/**
 * 输入: 临时 config.json、备份文件、Electron userData 模拟路径
 * 输出: UnifiedConfigManager 回归测试结果
 * 定位: 测试层 - 验证配置损坏恢复、legacy 默认账户修复与原子保存逻辑
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - src/__tests__/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

interface BackupEntry {
  filename: string;
  path: string;
  timestamp: Date;
  size: number;
}

const createSampleConfig = () => ({
  version: '3.0',
  sites: [
    {
      id: 'site-1',
      name: 'Recovered Site',
      url: 'https://example.com',
      enabled: true,
      group: 'default',
      created_at: 1,
      updated_at: 1,
    },
  ],
  accounts: [],
  siteGroups: [
    { id: 'default', name: '默认分组' },
    { id: 'unavailable', name: '不可用' },
  ],
  settings: {
    timeout: 30,
    concurrent: true,
    max_concurrent: 3,
    show_disabled: false,
    browser_path: '',
  },
  last_updated: 1,
});

describe('UnifiedConfigManager', () => {
  let userDataDir: string;
  let backups: BackupEntry[];
  let backupFiles: Map<string, string>;
  let backupManagerMock: {
    listBackups: ReturnType<typeof vi.fn>;
    restoreFromBackup: ReturnType<typeof vi.fn>;
    backupFile: ReturnType<typeof vi.fn>;
  };

  const loadManager = async () => {
    vi.resetModules();

    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => userDataDir),
      },
    }));

    vi.doMock('../main/utils/logger', () => ({
      default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }));

    vi.doMock('../main/backup-manager', () => ({
      backupManager: backupManagerMock,
    }));

    const mod = await import('../main/unified-config-manager');
    return new mod.UnifiedConfigManager();
  };

  beforeEach(async () => {
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-hub-config-'));
    backups = [];
    backupFiles = new Map<string, string>();

    backupManagerMock = {
      listBackups: vi.fn(() => backups),
      restoreFromBackup: vi.fn(async (filename: string, targetPath: string) => {
        const sourcePath = backupFiles.get(filename);
        if (!sourcePath) {
          return false;
        }

        await fs.copyFile(sourcePath, targetPath);
        return true;
      }),
      backupFile: vi.fn(async () => true),
    };
  });

  afterEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  it('restores the latest valid backup when config.json contains malformed JSON', async () => {
    const configPath = path.join(userDataDir, 'config.json');
    await fs.writeFile(configPath, '{"version":"3.0","sites":[', 'utf-8');

    const backupPath = path.join(userDataDir, 'config_backup.json');
    const backupFileName = 'config_2026-03-16_10-00-00.json';
    await fs.writeFile(backupPath, JSON.stringify(createSampleConfig(), null, 2), 'utf-8');

    backups = [
      {
        filename: backupFileName,
        path: backupPath,
        timestamp: new Date('2026-03-16T10:00:00Z'),
        size: 0,
      },
    ];
    backupFiles.set(backupFileName, backupPath);

    const manager = await loadManager();
    const config = await manager.loadConfig();

    expect(config.sites).toHaveLength(1);
    expect(config.sites[0].name).toBe('Recovered Site');
    expect(backupManagerMock.restoreFromBackup).toHaveBeenCalledWith(backupFileName, configPath);

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(restored.sites[0].name).toBe('Recovered Site');
  });

  it('restores the latest valid backup when config.json has an invalid structure', async () => {
    const configPath = path.join(userDataDir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify({ version: '3.0' }), 'utf-8');

    const backupPath = path.join(userDataDir, 'config_backup_structured.json');
    const backupFileName = 'config_2026-03-16_11-00-00.json';
    await fs.writeFile(backupPath, JSON.stringify(createSampleConfig(), null, 2), 'utf-8');

    backups = [
      {
        filename: backupFileName,
        path: backupPath,
        timestamp: new Date('2026-03-16T11:00:00Z'),
        size: 0,
      },
    ];
    backupFiles.set(backupFileName, backupPath);

    const manager = await loadManager();
    const config = await manager.loadConfig();

    expect(config.sites).toHaveLength(1);
    expect(config.sites[0].url).toBe('https://example.com');
    expect(backupManagerMock.restoreFromBackup).toHaveBeenCalledWith(backupFileName, configPath);
  });

  it('writes config through a temp file and cleans it up after save', async () => {
    const manager = await loadManager();
    const configPath = path.join(userDataDir, 'config.json');

    await manager.saveConfig(createSampleConfig() as any);

    const files = await fs.readdir(userDataDir);
    expect(files).toContain('config.json');
    expect(files.some(name => name.endsWith('.tmp'))).toBe(false);
    expect(backupManagerMock.backupFile).toHaveBeenCalledWith(configPath);

    const persisted = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(persisted.sites[0].name).toBe('Recovered Site');
  });

  it('drops legacy active_account_id from persisted config during normalize + save', async () => {
    const configPath = path.join(userDataDir, 'config.json');
    const rawConfig = createSampleConfig();
    rawConfig.sites[0] = {
      ...rawConfig.sites[0],
      active_account_id: 'acct_legacy_default',
    } as any;
    await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2), 'utf-8');

    const manager = await loadManager();
    const loadedConfig = await manager.loadConfig();

    expect((loadedConfig.sites[0] as any).active_account_id).toBeUndefined();

    await manager.saveConfig(loadedConfig as any);
    const persisted = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(persisted.sites[0].active_account_id).toBeUndefined();
  });

  it('repairs v3 configs that still have legacy site-level auth without accounts', async () => {
    const configPath = path.join(userDataDir, 'config.json');
    const rawConfig = createSampleConfig();
    rawConfig.sites[0] = {
      ...rawConfig.sites[0],
      access_token: 'legacy-token',
      user_id: 'legacy-user',
      cached_data: {
        balance: 12.34,
      },
    } as any;
    await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2), 'utf-8');

    const manager = await loadManager();
    const loadedConfig = await manager.loadConfig();

    expect(loadedConfig.accounts).toHaveLength(1);
    expect(loadedConfig.accounts[0]).toMatchObject({
      site_id: 'site-1',
      account_name: '默认账户',
      user_id: 'legacy-user',
      access_token: 'legacy-token',
      status: 'active',
    });
    expect(loadedConfig.accounts[0].cached_data).toMatchObject({
      balance: 12.34,
    });

    const persisted = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(persisted.accounts).toHaveLength(1);
    expect(persisted.accounts[0].account_name).toBe('默认账户');
    expect(backupManagerMock.backupFile).toHaveBeenCalledWith(configPath);

    const reloadedManager = await loadManager();
    const reloadedConfig = await reloadedManager.loadConfig();
    expect(reloadedConfig.accounts).toHaveLength(1);
  });

  it('reuses existing account when adding the same site_id + user_id again', async () => {
    const manager = await loadManager();
    await manager.saveConfig(createSampleConfig() as any);
    await manager.loadConfig();

    const first = await manager.addAccount({
      site_id: 'site-1',
      account_name: '默认账户',
      user_id: '6110',
      access_token: 'token-old',
      auth_source: 'manual',
      status: 'active',
    } as any);

    const second = await manager.addAccount({
      site_id: 'site-1',
      account_name: '焕昭君',
      user_id: '6110',
      access_token: 'token-new',
      auth_source: 'manual',
      status: 'active',
    } as any);

    expect(second.id).toBe(first.id);

    const persisted = JSON.parse(await fs.readFile(path.join(userDataDir, 'config.json'), 'utf-8'));
    expect(persisted.accounts).toHaveLength(1);
    expect(persisted.accounts[0].account_name).toBe('焕昭君');
    expect(persisted.accounts[0].access_token).toBe('token-new');
  });
});
