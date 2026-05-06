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
      BrowserWindow: {
        getAllWindows: vi.fn(() => []),
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
      auth_source: 'manual',
      status: 'active',
    });
    expect(loadedConfig.accounts[0].cached_data).toMatchObject({
      balance: 12.34,
    });

    const persisted = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(persisted.accounts).toHaveLength(1);
    expect(persisted.accounts[0].account_name).toBe('默认账户');
    expect(persisted.accounts[0].auth_source).toBe('manual');
    expect(persisted.accounts[0].cached_data).toBeUndefined();

    const persistedRuntimeCache = JSON.parse(
      await fs.readFile(path.join(userDataDir, 'runtime-cache.json'), 'utf-8')
    );
    expect(
      persistedRuntimeCache.account_runtime_by_account_id[loadedConfig.accounts[0].id]
    ).toMatchObject({
      balance: 12.34,
    });
    expect(backupManagerMock.backupFile).toHaveBeenCalledWith(configPath);

    const reloadedManager = await loadManager();
    const reloadedConfig = await reloadedManager.loadConfig();
    expect(reloadedConfig.accounts).toHaveLength(1);
  });

  it('persists cached_data into runtime-cache.json while keeping config.json stable', async () => {
    const manager = await loadManager();
    const config = createSampleConfig() as any;
    config.sites[0].cached_data = {
      balance: 23.45,
      models: ['gpt-4o-mini'],
      last_refresh: 1234567890,
    };

    await manager.saveConfig(config);

    const persisted = JSON.parse(await fs.readFile(path.join(userDataDir, 'config.json'), 'utf-8'));
    expect(persisted.sites[0].cached_data).toBeUndefined();

    const persistedRuntimeCache = JSON.parse(
      await fs.readFile(path.join(userDataDir, 'runtime-cache.json'), 'utf-8')
    );
    expect(persistedRuntimeCache.site_shared_by_site_id['site-1']).toMatchObject({
      models: ['gpt-4o-mini'],
      last_refresh: 1234567890,
    });
    expect(persistedRuntimeCache.site_runtime_by_site_id['site-1']).toMatchObject({
      balance: 23.45,
      last_refresh: 1234567890,
    });

    const reloadedManager = await loadManager();
    const reloadedConfig = await reloadedManager.loadConfig();
    expect(reloadedConfig.sites[0].cached_data).toMatchObject({
      balance: 23.45,
      models: ['gpt-4o-mini'],
      last_refresh: 1234567890,
    });
  });

  it('writes route runtime updates to state files without triggering config backup', async () => {
    const manager = await loadManager();
    await manager.saveConfig(createSampleConfig() as any);
    await manager.loadConfig();
    backupManagerMock.backupFile.mockClear();

    const routeKey = {
      routeRuleId: 'rule-1',
      siteId: 'site-1',
      accountId: 'account-1',
      apiKeyId: 'key-1',
    };
    const now = Date.now();
    const probeKey = buildProbeKey('site-1', 'account-1', 'codex', 'gpt-5');
    const probeSample = {
      sampleId: 'sample-1',
      probeKey,
      siteId: 'site-1',
      accountId: 'account-1',
      cliType: 'codex',
      canonicalModel: 'gpt-5',
      rawModel: 'gpt-5',
      success: true,
      source: 'routeProbe',
      testedAt: now,
    } as any;
    const analyticsBucket = {
      bucketKey: 'bucket-1',
      bucketStart: now,
      bucketSize: 'hour',
      cliType: 'codex',
      routeRuleId: 'rule-1',
      canonicalModel: 'gpt-5',
      siteId: 'site-1',
      accountId: 'account-1',
      apiKeyId: 'key-1',
      requestCount: 1,
      successCount: 1,
      failureCount: 0,
      neutralCount: 0,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      statusCodeHistogram: { '200': 1 },
      latencyHistogram: {},
      firstByteHistogram: {},
      updatedAt: now,
    } as any;

    await manager.recordRouteStats(routeKey, 'success', { statusCode: 200, latencyMs: 123 });
    await manager.updateRouteHealth([
      {
        ...routeKey,
        cliType: 'codex',
        healthy: true,
        canonicalModel: 'gpt-5',
        rawModel: 'gpt-5',
        testedAt: now,
      } as any,
    ]);
    await manager.upsertRoutePathState({
      ...routeKey,
      cliType: 'codex',
      canonicalModel: 'gpt-5',
      resolvedModel: 'gpt-5',
      windowStartedAt: now,
      windowRequestCount: 1,
      windowSuccessCount: 1,
      successRate: 1,
      lastOutcome: 'success',
      updatedAt: now,
    } as any);
    await manager.appendRouteCliProbeSamples([probeSample]);
    await manager.upsertRouteCliProbeLatest([
      {
        probeKey,
        siteId: 'site-1',
        accountId: 'account-1',
        cliType: 'codex',
        canonicalModel: 'gpt-5',
        rawModel: 'gpt-5',
        healthy: true,
        lastSample: probeSample,
        lastSuccessAt: now,
      } as any,
    ]);
    await manager.upsertRouteAnalyticsBuckets([analyticsBucket]);

    expect(backupManagerMock.backupFile).not.toHaveBeenCalled();

    const persistedConfig = JSON.parse(
      await fs.readFile(path.join(userDataDir, 'config.json'), 'utf-8')
    );
    expect(persistedConfig.routing.stats).toEqual({});
    expect(persistedConfig.routing.routePathStates).toEqual({});
    expect(persistedConfig.routing.health).toEqual({});
    expect(persistedConfig.routing.cliProbe.latest).toEqual({});
    expect(persistedConfig.routing.cliProbe.history).toEqual({});
    expect(persistedConfig.routing.analytics.buckets).toEqual({});

    const runtimeState = JSON.parse(
      await fs.readFile(path.join(userDataDir, 'state', 'route-runtime.json'), 'utf-8')
    );
    expect(runtimeState.stats['rule-1:site-1:account-1:key-1']).toMatchObject({
      successCount: 1,
      lastStatusCode: 200,
    });
    expect(Object.values(runtimeState.routePathStates)[0]).toMatchObject({
      routeRuleId: 'rule-1',
      successRate: 1,
    });

    const probesState = JSON.parse(
      await fs.readFile(path.join(userDataDir, 'state', 'route-probes.json'), 'utf-8')
    );
    expect(probesState.latest[probeKey].healthy).toBe(true);
    expect(probesState.history[probeKey]).toHaveLength(1);

    const analyticsState = JSON.parse(
      await fs.readFile(path.join(userDataDir, 'state', 'route-analytics.json'), 'utf-8')
    );
    expect(analyticsState.buckets['bucket-1']).toMatchObject({
      requestCount: 1,
      totalTokens: 30,
    });
  });

  it('hydrates route state files into the compatibility routing view', async () => {
    const configPath = path.join(userDataDir, 'config.json');
    const rawConfig = createSampleConfig();
    rawConfig.version = '3.1';
    await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2), 'utf-8');

    const stateDir = path.join(userDataDir, 'state');
    await fs.mkdir(stateDir, { recursive: true });
    const probeKey = buildProbeKey('site-1', 'account-1', 'codex', 'gpt-5');
    await fs.writeFile(
      path.join(stateDir, 'route-runtime.json'),
      JSON.stringify(
        {
          version: '1',
          stats: {
            'rule-1:site-1:account-1:key-1': {
              routeRuleId: 'rule-1',
              siteId: 'site-1',
              accountId: 'account-1',
              apiKeyId: 'key-1',
              successCount: 1,
              failureCount: 0,
              neutralCount: 0,
              consecutiveFailures: 0,
              lastUsedAt: 1,
            },
          },
          routePathStates: {},
          health: {},
          last_updated: 1,
        },
        null,
        2
      ),
      'utf-8'
    );
    await fs.writeFile(
      path.join(stateDir, 'route-probes.json'),
      JSON.stringify(
        {
          version: '1',
          latest: {
            [probeKey]: {
              probeKey,
              siteId: 'site-1',
              accountId: 'account-1',
              cliType: 'codex',
              canonicalModel: 'gpt-5',
              rawModel: 'gpt-5',
              healthy: true,
              lastSample: {
                sampleId: 'sample-1',
                probeKey,
                siteId: 'site-1',
                accountId: 'account-1',
                cliType: 'codex',
                canonicalModel: 'gpt-5',
                rawModel: 'gpt-5',
                success: true,
                source: 'routeProbe',
                testedAt: 1,
              },
            },
          },
          history: {},
          last_updated: 1,
        },
        null,
        2
      ),
      'utf-8'
    );
    await fs.writeFile(
      path.join(stateDir, 'route-analytics.json'),
      JSON.stringify(
        {
          version: '1',
          buckets: {
            'bucket-1': {
              bucketKey: 'bucket-1',
              bucketStart: 1,
              bucketSize: 'hour',
              cliType: 'codex',
              requestCount: 1,
              successCount: 1,
              failureCount: 0,
              neutralCount: 0,
              promptTokens: 10,
              completionTokens: 20,
              totalTokens: 30,
              statusCodeHistogram: {},
              latencyHistogram: {},
              firstByteHistogram: {},
              updatedAt: 1,
            },
          },
          last_updated: 1,
        },
        null,
        2
      ),
      'utf-8'
    );
    await fs.writeFile(
      path.join(stateDir, 'route-model-sources.json'),
      JSON.stringify(
        {
          version: '1',
          sources: [
            {
              sourceKey: 'site-1:account-1:gpt-5',
              siteId: 'site-1',
              siteName: 'Recovered Site',
              accountId: 'account-1',
              accountName: '默认账户',
              sourceType: 'account',
              originalModel: 'gpt-5',
              vendor: 'gpt',
              firstSeenAt: 1,
              lastSeenAt: 1,
            },
          ],
          last_updated: 1,
        },
        null,
        2
      ),
      'utf-8'
    );

    const manager = await loadManager();
    await manager.loadConfig();
    const routing = manager.getRoutingConfig();

    expect(routing.stats['rule-1:site-1:account-1:key-1']).toMatchObject({
      successCount: 1,
    });
    expect(routing.cliProbe.latest[probeKey].healthy).toBe(true);
    expect(routing.analytics.buckets['bucket-1']).toMatchObject({
      totalTokens: 30,
    });
    expect(routing.modelRegistry.sources).toEqual([
      expect.objectContaining({
        sourceKey: 'site-1:account-1:gpt-5',
        originalModel: 'gpt-5',
      }),
    ]);
  });

  it('preserves persisted site daily snapshots when saveConfig rewrites runtime cache', async () => {
    const manager = await loadManager();
    await manager.saveConfig(createSampleConfig() as any);

    const { runtimeCacheManager } = await import('../main/runtime-cache-manager');
    await runtimeCacheManager.updateSiteDailySnapshots('site-1', () => [
      {
        siteId: 'site-1',
        snapshotDate: '2026-04-25',
        capturedAt: Date.UTC(2026, 3, 25),
        balance: 88.8,
        todayUsage: 6.4,
        todayRequests: 42,
        todayPromptTokens: 1200,
        todayCompletionTokens: 3400,
        totalTokens: 4600,
      },
    ]);

    const nextConfig = createSampleConfig() as any;
    nextConfig.sites[0].name = 'Updated Site';
    await manager.saveConfig(nextConfig);

    const persistedRuntimeCache = JSON.parse(
      await fs.readFile(path.join(userDataDir, 'runtime-cache.json'), 'utf-8')
    );

    expect(persistedRuntimeCache.site_daily_snapshots_by_site_id['site-1']).toEqual([
      {
        siteId: 'site-1',
        snapshotDate: '2026-04-25',
        capturedAt: Date.UTC(2026, 3, 25),
        balance: 88.8,
        todayUsage: 6.4,
        todayRequests: 42,
        todayPromptTokens: 1200,
        todayCompletionTokens: 3400,
        totalTokens: 4600,
      },
    ]);
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

  it('creates an automatic exact route rule when saving a CLI model selection without a match', async () => {
    const manager = await loadManager();
    await manager.saveConfig(createSampleConfig() as any);
    await manager.loadConfig();

    await manager.updateRouteModelRegistry({
      version: 1,
      sources: [],
      overrides: [],
      displayItems: [],
      vendorPriorities: {},
      entries: {
        'claude-opus-4-6': {
          canonicalName: 'claude-opus-4-6',
          vendor: 'claude',
          aliases: ['claude-opus-4.6'],
          sources: [],
          hasOverride: false,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });

    const selections = await manager.updateRouteCliModelSelections({
      claudeCode: 'claude-opus-4.6',
    });

    expect(selections.claudeCode).toBe('claude-opus-4-6');
    expect(manager.getRoutingConfig().rules).toEqual([
      expect.objectContaining({
        id: 'auto-cli-model-claudeCode-claude-opus-4-6',
        name: 'Claude Code / claude-opus-4-6',
        enabled: true,
        priority: 0,
        cliType: 'claudeCode',
        patternType: 'exact',
        pattern: 'claude-opus-4-6',
      }),
    ]);
  });

  it('does not duplicate or overwrite an existing matching manual route rule', async () => {
    const manager = await loadManager();
    await manager.saveConfig(createSampleConfig() as any);
    await manager.loadConfig();

    await manager.updateRouteModelRegistry({
      version: 1,
      sources: [],
      overrides: [],
      displayItems: [],
      vendorPriorities: {},
      entries: {
        'claude-opus-4-6': {
          canonicalName: 'claude-opus-4-6',
          vendor: 'claude',
          aliases: ['claude-opus-4.6'],
          sources: [],
          hasOverride: false,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    await manager.upsertRouteRule({
      id: 'manual-opus-rule',
      name: 'Manual Opus Rule',
      enabled: true,
      priority: 100,
      cliType: 'claudeCode',
      patternType: 'exact',
      pattern: 'claude-opus-4-6',
      createdAt: 1,
      updatedAt: 1,
    });

    await manager.updateRouteCliModelSelections({
      claudeCode: 'claude-opus-4.6',
    });

    expect(manager.getRoutingConfig().rules).toEqual([
      expect.objectContaining({
        id: 'manual-opus-rule',
        name: 'Manual Opus Rule',
        priority: 100,
      }),
    ]);
  });

  it('persists display item priority config under routing.modelRegistry.displayItems', async () => {
    const manager = await loadManager();
    await manager.saveConfig(createSampleConfig() as any);
    await manager.loadConfig();

    const displayItem = await manager.upsertRouteModelDisplayItem({
      id: 'manual-claude-opus',
      vendor: 'claude' as any,
      canonicalName: 'claude-opus-4-6',
      sourceKeys: ['site-1:acct-default:claude-opus-4.6-20260201'],
      originalModelOrder: ['claude-opus-4.6-20260201'],
      priorityConfig: {
        sitePriorities: {
          'site-1': 2,
        },
        apiKeyPriorities: {
          'site-1:acct-default:key-1': 1,
        },
      },
      runtimeConfig: {
        maxAttemptsPerRoutePath: 2,
        successRateWindowMinutes: 12,
        disableDurationMinutes: 45,
        minSuccessRate: 0.75,
      },
      mode: 'manual',
      createdAt: 1,
      updatedAt: 1,
    });

    expect(displayItem.priorityConfig).toEqual({
      sitePriorities: {
        'site-1': 2,
      },
      apiKeyPriorities: {
        'site-1:acct-default:key-1': 1,
      },
    });
    expect(displayItem.runtimeConfig).toEqual({
      maxAttemptsPerRoutePath: 2,
      successRateWindowMinutes: 12,
      disableDurationMinutes: 45,
      minSuccessRate: 0.75,
    });

    const persisted = JSON.parse(await fs.readFile(path.join(userDataDir, 'config.json'), 'utf-8'));
    const persistedDisplayItem = persisted.routing.modelRegistry.displayItems.find(
      (item: { canonicalName: string }) => item.canonicalName === 'claude-opus-4-6'
    );

    expect(persistedDisplayItem.priorityConfig).toEqual({
      sitePriorities: {
        'site-1': 2,
      },
      apiKeyPriorities: {
        'site-1:acct-default:key-1': 1,
      },
    });
    expect(persistedDisplayItem.runtimeConfig).toEqual({
      maxAttemptsPerRoutePath: 2,
      successRateWindowMinutes: 12,
      disableDurationMinutes: 45,
      minSuccessRate: 0.75,
    });
  });

  it('rejects duplicate canonical names across different display items', async () => {
    const manager = await loadManager();
    await manager.saveConfig(createSampleConfig() as any);
    await manager.loadConfig();

    await manager.upsertRouteModelDisplayItem({
      id: 'manual-claude-opus',
      vendor: 'claude' as any,
      canonicalName: 'claude-opus-4-6',
      sourceKeys: ['site-1:acct-default:claude-opus-4.6-20260201'],
      originalModelOrder: ['claude-opus-4.6-20260201'],
      priorityConfig: {
        sitePriorities: {},
        apiKeyPriorities: {},
      },
      mode: 'manual',
      createdAt: 1,
      updatedAt: 1,
    });

    await expect(
      manager.upsertRouteModelDisplayItem({
        id: 'manual-claude-opus-2',
        vendor: 'claude' as any,
        canonicalName: 'claude-opus-4-6',
        sourceKeys: ['site-1:acct-default:claude-sonnet-4.6-20260201'],
        originalModelOrder: ['claude-sonnet-4.6-20260201'],
        priorityConfig: {
          sitePriorities: {},
          apiKeyPriorities: {},
        },
        mode: 'manual',
        createdAt: 2,
        updatedAt: 2,
      })
    ).rejects.toThrow('Model display item already exists for claude-opus-4-6');
  });

  it('drops legacy seeded display items that are not the default example during load', async () => {
    const configPath = path.join(userDataDir, 'config.json');
    const rawConfig = createSampleConfig();
    rawConfig.version = '3.1';
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
        claudeCode: null,
        codex: null,
        geminiCli: null,
      },
      stats: {},
      health: {},
      modelRegistry: {
        version: 1,
        sources: [],
        overrides: [],
        entries: {},
        displayItems: [
          {
            id: 'seeded:claude-opus-4-6',
            vendor: 'claude',
            canonicalName: 'claude-opus-4-6',
            sourceKeys: ['site-1:acct-default:claude-opus-4.6-20260201'],
            originalModelOrder: ['claude-opus-4.6-20260201'],
            priorityConfig: {
              sitePriorities: {},
              apiKeyPriorities: {},
            },
            mode: 'seeded',
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'seeded:gpt-5',
            vendor: 'gpt',
            canonicalName: 'gpt-5',
            sourceKeys: ['site-1:acct-default:gpt-5-latest'],
            originalModelOrder: ['gpt-5-latest'],
            priorityConfig: {
              sitePriorities: {},
              apiKeyPriorities: {},
            },
            mode: 'seeded',
            createdAt: 2,
            updatedAt: 2,
          },
          {
            id: 'manual:gpt-5.4',
            vendor: 'gpt',
            canonicalName: 'gpt-5.4',
            sourceKeys: ['site-1:acct-default:gpt-5.4-latest'],
            originalModelOrder: ['gpt-5.4-latest'],
            priorityConfig: {
              sitePriorities: {},
              apiKeyPriorities: {},
            },
            mode: 'manual',
            createdAt: 3,
            updatedAt: 3,
          },
        ],
        vendorPriorities: {},
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

    expect(
      manager.getRoutingConfig().modelRegistry.displayItems.map(item => item.canonicalName)
    ).toEqual(['claude-opus-4-6', 'gpt-5.4']);
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
