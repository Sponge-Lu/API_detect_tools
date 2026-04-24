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
import { buildProbeKey } from '../shared/types/route-proxy';

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

  const loadManager = async (options?: {
    detectSiteTypeResult?: { siteType: string; detectionMethod: string };
  }) => {
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

    vi.doMock('../main/site-type-detector', () => ({
      detectSiteType: vi.fn(
        async () =>
          options?.detectSiteTypeResult || { siteType: 'newapi', detectionMethod: 'fallback' }
      ),
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
    expect(persisted.accounts[0].cached_data).toMatchObject({
      balance: 12.34,
    });
    expect(backupManagerMock.backupFile).toHaveBeenCalledWith(configPath);

    const reloadedManager = await loadManager();
    const reloadedConfig = await reloadedManager.loadConfig();
    expect(reloadedConfig.accounts).toHaveLength(1);
  });

  it('persists cached_data directly into config.json when saving', async () => {
    const manager = await loadManager();
    const config = createSampleConfig() as any;
    config.sites[0].cached_data = {
      balance: 23.45,
      models: ['gpt-4o-mini'],
      last_refresh: 1234567890,
    };

    await manager.saveConfig(config);

    const persisted = JSON.parse(await fs.readFile(path.join(userDataDir, 'config.json'), 'utf-8'));
    expect(persisted.sites[0].cached_data).toMatchObject({
      balance: 23.45,
      models: ['gpt-4o-mini'],
      last_refresh: 1234567890,
    });
  });

  it('hydrates missing legacy site_type during v2 -> v3 migration when detection succeeds', async () => {
    const configPath = path.join(userDataDir, 'config.json');
    const rawConfig = createSampleConfig();
    delete rawConfig.sites[0].site_type;
    await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2), 'utf-8');

    const manager = await loadManager({
      detectSiteTypeResult: { siteType: 'sub2api', detectionMethod: 'html-marker' },
    });
    const loadedConfig = await manager.loadConfig();

    expect(loadedConfig.sites[0].site_type).toBe('sub2api');
    const persisted = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(persisted.sites[0].site_type).toBe('sub2api');
  });

  it('drops orphan accounts when legacy save removes a site', async () => {
    const configPath = path.join(userDataDir, 'config.json');
    const rawConfig = createSampleConfig();
    rawConfig.accounts = [
      {
        id: 'account-1',
        site_id: 'site-1',
        account_name: '默认账户',
        user_id: 'user-1',
        access_token: 'token-1',
        auth_source: 'manual',
        status: 'active',
        created_at: 1,
        updated_at: 1,
      },
    ] as any;
    await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2), 'utf-8');

    const manager = await loadManager();
    await manager.loadConfig();
    await manager.saveLegacyConfig({
      sites: [],
      settings: rawConfig.settings as any,
      siteGroups: rawConfig.siteGroups as any,
    });

    const persisted = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(persisted.sites).toHaveLength(0);
    expect(persisted.accounts).toHaveLength(0);
  });

  it('keeps legacy sites without site_type unresolved when migration detection only falls back', async () => {
    const configPath = path.join(userDataDir, 'config.json');
    const rawConfig = createSampleConfig();
    delete rawConfig.sites[0].site_type;
    await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2), 'utf-8');

    const manager = await loadManager({
      detectSiteTypeResult: { siteType: 'newapi', detectionMethod: 'fallback' },
    });
    const loadedConfig = await manager.loadConfig();

    expect(loadedConfig.sites[0].site_type).toBeUndefined();

    await manager.saveConfig(loadedConfig as any);
    const persisted = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(persisted.sites[0].site_type).toBeUndefined();
  });

  it('does not auto-detect missing site_type on normal load when config is already current version', async () => {
    const configPath = path.join(userDataDir, 'config.json');
    const rawConfig = createSampleConfig();
    rawConfig.version = '3.1';
    delete rawConfig.sites[0].site_type;
    await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2), 'utf-8');

    const manager = await loadManager({
      detectSiteTypeResult: { siteType: 'sub2api', detectionMethod: 'html-marker' },
    });
    const loadedConfig = await manager.loadConfig();

    expect(loadedConfig.sites[0].site_type).toBeUndefined();

    const persisted = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(persisted.sites[0].site_type).toBeUndefined();
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

  it('removes the site config when deleting the last account of a site', async () => {
    const manager = await loadManager();
    await manager.saveConfig(createSampleConfig() as any);
    await manager.loadConfig();

    const account = await manager.addAccount({
      site_id: 'site-1',
      account_name: '默认账户',
      user_id: '6110',
      access_token: 'token-only',
      auth_source: 'manual',
      status: 'active',
    } as any);

    const deleted = await manager.deleteAccount(account.id);
    expect(deleted).toBe(true);

    const persisted = JSON.parse(await fs.readFile(path.join(userDataDir, 'config.json'), 'utf-8'));
    expect(persisted.sites).toHaveLength(0);
    expect(persisted.accounts).toHaveLength(0);
  });

  it('keeps the site config when deleting one account but other accounts remain', async () => {
    const manager = await loadManager();
    await manager.saveConfig(createSampleConfig() as any);
    await manager.loadConfig();

    const first = await manager.addAccount({
      site_id: 'site-1',
      account_name: '账户1',
      user_id: '6110',
      access_token: 'token-1',
      auth_source: 'manual',
      status: 'active',
    } as any);

    const second = await manager.addAccount({
      site_id: 'site-1',
      account_name: '账户2',
      user_id: '6220',
      access_token: 'token-2',
      auth_source: 'manual',
      status: 'active',
    } as any);

    const deleted = await manager.deleteAccount(first.id);
    expect(deleted).toBe(true);

    const persisted = JSON.parse(await fs.readFile(path.join(userDataDir, 'config.json'), 'utf-8'));
    expect(persisted.sites).toHaveLength(1);
    expect(persisted.accounts).toHaveLength(1);
    expect(persisted.accounts[0].id).toBe(second.id);
  });

  it('normalizes legacy cli model selections to canonical names when routing config is loaded', async () => {
    const configPath = path.join(userDataDir, 'config.json');
    const rawConfig = createSampleConfig();
    rawConfig.routing = {
      server: {
        enabled: false,
        host: '127.0.0.1',
        port: 3210,
        unifiedApiKey: 'sk-route-test',
        requestTimeoutMs: 300000,
        retryCount: 1,
        healthCheckIntervalMinutes: 60,
      },
      rules: [],
      cliModelSelections: {
        claudeCode: 'claude-sonnet-4.6-20260201',
        codex: 'o3-latest',
        geminiCli: null,
      },
      stats: {},
      health: {},
      modelRegistry: {
        version: 1,
        sources: [],
        overrides: [],
        entries: {
          'claude-sonnet-4-6': {
            canonicalName: 'claude-sonnet-4-6',
            vendor: 'claude',
            aliases: ['claude-sonnet-4.6-20260201'],
            sources: [],
            hasOverride: true,
            createdAt: 1,
            updatedAt: 1,
          },
          o3: {
            canonicalName: 'o3',
            vendor: 'gpt',
            aliases: ['o3-latest'],
            sources: [],
            hasOverride: false,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      cliProbe: {
        config: {
          enabled: false,
          intervalMinutes: 60,
          modelsPerCli: 3,
          requestTimeoutMs: 30000,
          maxConcurrency: 3,
          retentionDays: 30,
          runOnStartup: false,
        },
        latest: {},
        history: {},
      },
      analytics: {
        config: {
          enabled: true,
          retentionDays: 30,
          bucketSizeMinutes: 60,
          recordTokenUsage: true,
          recordStatusCode: true,
          recordLatencyHistogram: true,
          latencyHistogramBuckets: [1000, 3000],
          firstByteHistogramBuckets: [200, 500],
        },
        buckets: {},
      },
    } as any;
    await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2), 'utf-8');

    const manager = await loadManager();
    await manager.loadConfig();

    expect(manager.getRoutingConfig().cliModelSelections).toEqual({
      claudeCode: 'claude-sonnet-4-6',
      codex: 'o3',
      geminiCli: null,
    });
  });

  it('persists vendor priority config under routing.modelRegistry', async () => {
    const manager = await loadManager();
    await manager.saveConfig(createSampleConfig() as any);
    await manager.loadConfig();

    const registry = await manager.updateRouteVendorPriorityConfig('claude' as any, {
      sitePriorities: {
        'site-1': 2,
      },
      apiKeyPriorities: {
        'site-1:acc-1:key-1': 1,
      },
    });

    expect(registry.vendorPriorities.claude).toEqual({
      sitePriorities: {
        'site-1': 2,
      },
      apiKeyPriorities: {
        'site-1:acc-1:key-1': 1,
      },
    });

    const persisted = JSON.parse(await fs.readFile(path.join(userDataDir, 'config.json'), 'utf-8'));
    expect(persisted.routing.modelRegistry.vendorPriorities.claude).toEqual({
      sitePriorities: {
        'site-1': 2,
      },
      apiKeyPriorities: {
        'site-1:acc-1:key-1': 1,
      },
    });
  });

  it('migrates legacy cli_compatibility into cliProbe.latest without fabricating history', async () => {
    const configPath = path.join(userDataDir, 'config.json');
    const rawConfig = createSampleConfig();
    rawConfig.version = '3.1';
    rawConfig.accounts = [
      {
        id: 'acct-default',
        site_id: 'site-1',
        account_name: '默认账户',
        user_id: 'user-1',
        access_token: 'token-1',
        auth_source: 'manual',
        status: 'active',
        cached_data: {
          cli_compatibility: {
            codex: true,
            codexDetail: { responses: true },
            geminiCli: false,
            geminiDetail: { native: false, proxy: false },
            testedAt: 1234567890,
          },
        },
        created_at: 1,
        updated_at: 1,
      },
    ] as any;
    await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2), 'utf-8');

    const manager = await loadManager();
    await manager.loadConfig();

    const routing = manager.getRoutingConfig();
    const codexKey = buildProbeKey('site-1', 'acct-default', 'codex', '__legacy__compat__');
    const geminiKey = buildProbeKey('site-1', 'acct-default', 'geminiCli', '__legacy__compat__');

    expect(routing.cliProbe.latest[codexKey]).toBeDefined();
    expect(routing.cliProbe.latest[codexKey].lastSample.source).toBe('legacyCache');
    expect(routing.cliProbe.latest[codexKey].lastSample.codexDetail).toEqual({ responses: true });
    expect(routing.cliProbe.latest[geminiKey].lastSample.geminiDetail).toEqual({
      native: false,
      proxy: false,
    });
    expect(routing.cliProbe.history).toEqual({});

    const persisted = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(persisted.accounts[0].cached_data?.cli_compatibility).toBeUndefined();
  });
});
