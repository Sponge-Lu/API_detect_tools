import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'D:/api-hub-test-user-data'),
  },
}));

describe('app storage bundle', () => {
  let tempDir: string;
  let userDataDir: string;
  let homeDir: string;
  let tempRoot: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-hub-storage-bundle-'));
    userDataDir = path.join(tempDir, 'userData');
    homeDir = path.join(tempDir, 'home');
    tempRoot = path.join(tempDir, 'tmp');
    await fs.mkdir(path.join(userDataDir, 'state'), { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.mkdir(tempRoot, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.clearAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reads only portable domains while retaining manifest domains in full backups', async () => {
    const storageModule = await import('../main/storage/application-storage');
    const { STORAGE_DOCUMENT_PATHS } = await import(
      '../main/storage/repositories/document-mapping'
    );
    const { createAppStorageBundle } = await import('../main/app-storage-bundle');
    const snapshot = vi.fn().mockResolvedValue({});
    vi.spyOn(storageModule, 'getApplicationStorage').mockReturnValue({
      root: userDataDir,
      documentId: (filename: string) =>
        Object.entries(STORAGE_DOCUMENT_PATHS).find(
          ([, relative]) => path.resolve(userDataDir, relative) === path.resolve(filename)
        )?.[0],
      snapshotDocuments: snapshot,
      database: { connection: { pragma: () => 1 } },
    } as unknown as ReturnType<typeof storageModule.getApplicationStorage>);
    const roots = { userData: userDataDir, home: homeDir, temp: tempRoot };
    await createAppStorageBundle({ mode: 'portable-config', roots });
    expect(snapshot).toHaveBeenLastCalledWith([
      'stable-config',
      'custom-cli-configs',
      'config-file-profiles',
    ]);
    await createAppStorageBundle({ mode: 'full-manifest', roots });
    expect(new Set(snapshot.mock.calls[1][0])).toEqual(
      new Set(
        Object.keys(STORAGE_DOCUMENT_PATHS).filter(id => id !== 'model-registry-source-state')
      )
    );
  });

  it('creates portable bundles with only stable-config and custom-cli-configs', async () => {
    const { createAppStorageBundle, createPortableAppStorageBundleContent } = await import(
      '../main/app-storage-bundle'
    );

    await fs.writeFile(
      path.join(userDataDir, 'config.json'),
      JSON.stringify({ version: '3.1', sites: [], accounts: [], siteGroups: [], settings: {} }),
      'utf-8'
    );
    await fs.writeFile(path.join(userDataDir, 'runtime-cache.json'), '{"version":"1"}', 'utf-8');
    await fs.writeFile(
      path.join(userDataDir, 'state', 'route-runtime.json'),
      '{"version":"1"}',
      'utf-8'
    );
    await fs.writeFile(
      path.join(userDataDir, 'theme-settings.json'),
      '{"themeMode":"dark"}',
      'utf-8'
    );
    await fs.writeFile(
      path.join(userDataDir, 'custom-cli-configs.json'),
      '{"apiKey":"encrypted:v1:a:b:c"}',
      'utf-8'
    );
    await fs.writeFile(
      path.join(userDataDir, 'credit-settings.json'),
      '{"cookie":"local-only"}',
      'utf-8'
    );
    await fs.mkdir(path.join(userDataDir, 'browser-profiles'), { recursive: true });

    const roots = {
      userData: userDataDir,
      home: homeDir,
      temp: tempRoot,
      localAppData: path.join(tempDir, 'localAppData'),
    };

    const portable = await createAppStorageBundle({ mode: 'portable-config', roots });
    const entryIds = portable.files.map(file => file.entryId);

    expect(portable.mode).toBe('portable-config');
    expect(entryIds).toEqual(['stable-config', 'custom-cli-configs']);
    expect(entryIds).not.toContain('runtime-detection-cache');
    expect(entryIds).not.toContain('theme-settings');
    expect(entryIds).not.toContain('credit-settings');
    expect(entryIds).not.toContain('persistent-browser-profiles');

    const content = await createPortableAppStorageBundleContent(roots);
    expect(content).toContain('"mode": "portable-config"');
    expect(content).toContain('custom-cli-configs');
    expect(content).not.toContain('runtime-detection-cache');
    expect(content).not.toContain('credit-settings');
  });

  it('omits route keys and proxy credentials only from secret-free portable bundles', async () => {
    const { createPortableAppStorageBundleContent, extractStableConfigFromBackupContent } =
      await import('../main/app-storage-bundle');
    const config = {
      version: '3.1',
      sites: [{ id: 'site-1', proxy_url: 'https://site-user:site-password@proxy.test:8443' }],
      accounts: [{ api_key: 'encrypted:v1:account-key' }],
      siteGroups: [],
      settings: {},
      routing: {
        server: {
          unifiedApiKey: 'sk-routing-secret',
          upstreamProxyUrl: 'socks5://route-user:route-password@proxy.test:1080',
        },
      },
    };
    const configPath = path.join(userDataDir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(config), 'utf8');
    const roots = { userData: userDataDir, home: homeDir, temp: tempRoot };

    const portable = extractStableConfigFromBackupContent(
      await createPortableAppStorageBundleContent(roots)
    ) as typeof config;
    expect(portable.routing.server.unifiedApiKey).toBe('');
    expect(portable.accounts[0].api_key).toBe('');
    expect(portable.sites[0].proxy_url).toBe('https://proxy.test:8443/');
    expect(portable.routing.server.upstreamProxyUrl).toBe('socks5://proxy.test:1080');
    expect(
      extractStableConfigFromBackupContent(await createPortableAppStorageBundleContent(roots, true))
    ).toEqual(config);
    expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toEqual(config);
  });

  it.each([
    ['proxy-user:proxy-password@proxy.test:8080', 'proxy.test:8080/'],
    ['  proxy-user:proxy-password@proxy.test:8080  ', 'proxy.test:8080/'],
    ['socks5://proxy-user:p%40ss@[::1]:1080', 'socks5://[::1]:1080'],
    ['http://proxy-user:proxy-password@', ''],
    ['http://proxy.test:8080', 'http://proxy.test:8080'],
  ])('sanitizes proxy authentication in %s', async (proxyUrl, sanitized) => {
    const { omitBackupSecrets } = await import('../main/app-storage-bundle');
    expect(omitBackupSecrets({ settings: { upstreamProxyUrl: proxyUrl } })).toEqual({
      settings: { upstreamProxyUrl: sanitized },
    });
  });

  it('bundles full-manifest files when explicitly requested and excludes protected browser state', async () => {
    const { createAppStorageBundle } = await import('../main/app-storage-bundle');

    await fs.writeFile(
      path.join(userDataDir, 'config.json'),
      JSON.stringify({ version: '3.1', sites: [], accounts: [], siteGroups: [], settings: {} }),
      'utf-8'
    );
    await fs.writeFile(path.join(userDataDir, 'runtime-cache.json'), '{"version":"1"}', 'utf-8');
    await fs.writeFile(
      path.join(userDataDir, 'state', 'route-runtime.json'),
      '{"version":"1"}',
      'utf-8'
    );
    await fs.mkdir(path.join(userDataDir, 'browser-profiles'), { recursive: true });
    await fs.writeFile(
      path.join(userDataDir, 'custom-cli-configs.json'),
      '{"apiKey":"sk"}',
      'utf-8'
    );

    const bundle = await createAppStorageBundle({
      mode: 'full-manifest',
      roots: {
        userData: userDataDir,
        home: homeDir,
        temp: tempRoot,
        localAppData: path.join(tempDir, 'localAppData'),
      },
    });
    const entryIds = bundle.files.map(file => file.entryId);

    expect(bundle.mode).toBe('full-manifest');
    expect(entryIds).toContain('stable-config');
    expect(entryIds).toContain('runtime-detection-cache');
    expect(entryIds).toContain('route-runtime-state');
    expect(entryIds).toContain('custom-cli-configs');
    expect(entryIds).not.toContain('model-registry-source-state');
    expect(entryIds).not.toContain('persistent-browser-profiles');
    expect(entryIds).not.toContain('credit-settings');

    const customCliFile = bundle.files.find(file => file.entryId === 'custom-cli-configs');
    const { decodePayload } = await import('../main/storage/database/payload-codec');
    expect(
      decodePayload<{ apiKey: string }>(JSON.parse(customCliFile!.content).payload).apiKey
    ).toBe('sk');
    expect(customCliFile?.content).not.toContain('"apiKey":"sk"');
  });

  it('preserves local custom-cli-configs when an older full-manifest bundle omits it', async () => {
    const { createAppStorageBundleContent, restoreAppStorageBackupContent } = await import(
      '../main/app-storage-bundle'
    );
    const roots = {
      userData: userDataDir,
      home: homeDir,
      temp: tempRoot,
      localAppData: path.join(tempDir, 'localAppData'),
    };

    await fs.writeFile(
      path.join(userDataDir, 'config.json'),
      JSON.stringify({ version: '3.1', sites: [], accounts: [], siteGroups: [], settings: {} }),
      'utf-8'
    );
    // Create a bundle without custom-cli by temporarily not writing the file.
    const content = await createAppStorageBundleContent({ mode: 'full-manifest', roots });
    expect(content).not.toContain('custom-cli-configs');

    await fs.writeFile(
      path.join(userDataDir, 'custom-cli-configs.json'),
      JSON.stringify({
        configs: [
          {
            id: 'keep-me',
            name: 'Keep',
            baseUrl: 'https://keep.test',
            apiKey: 'encrypted:v1:a:b:c',
          },
        ],
        activeConfigId: null,
      }),
      'utf-8'
    );

    await restoreAppStorageBackupContent(content, path.join(userDataDir, 'config.json'), roots);

    const kept = JSON.parse(
      await fs.readFile(path.join(userDataDir, 'custom-cli-configs.json'), 'utf-8')
    );
    expect(kept.configs[0].id).toBe('keep-me');
  });

  it('restores custom-cli-configs from portable bundles and preserves credit-settings/runtime', async () => {
    const { createPortableAppStorageBundleContent, restoreAppStorageBackupContent } = await import(
      '../main/app-storage-bundle'
    );
    const roots = {
      userData: userDataDir,
      home: homeDir,
      temp: tempRoot,
      localAppData: path.join(tempDir, 'localAppData'),
    };

    await fs.writeFile(
      path.join(userDataDir, 'config.json'),
      JSON.stringify({ version: '3.1', sites: [], accounts: [], siteGroups: [], settings: {} }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(userDataDir, 'custom-cli-configs.json'),
      JSON.stringify({
        configs: [
          {
            id: 'cfg-1',
            name: 'Direct',
            baseUrl: 'https://example.com',
            apiKey: 'encrypted:v1:iv:tag:cipher',
            models: [],
            cliSettings: {},
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        activeConfigId: null,
      }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(userDataDir, 'credit-settings.json'),
      JSON.stringify({ cookie: 'keep-local-credit' }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(userDataDir, 'runtime-cache.json'),
      '{"version":"local"}',
      'utf-8'
    );

    const content = await createPortableAppStorageBundleContent(roots, true);
    expect(content).toContain('custom-cli-configs');
    expect(content).not.toContain('encrypted:v1:iv:tag:cipher');
    expect(content).not.toContain('credit-settings');
    expect(content).not.toContain('runtime-detection-cache');

    await fs.writeFile(
      path.join(userDataDir, 'custom-cli-configs.json'),
      JSON.stringify({ configs: [], activeConfigId: null }),
      'utf-8'
    );

    await restoreAppStorageBackupContent(content, path.join(userDataDir, 'config.json'), roots);

    const restoredCustom = JSON.parse(
      await fs.readFile(path.join(userDataDir, 'custom-cli-configs.json'), 'utf-8')
    );
    expect(restoredCustom.configs).toHaveLength(1);
    expect(restoredCustom.configs[0].apiKey).toBe('encrypted:v1:iv:tag:cipher');

    const credit = JSON.parse(
      await fs.readFile(path.join(userDataDir, 'credit-settings.json'), 'utf-8')
    );
    expect(credit.cookie).toBe('keep-local-credit');
    await expect(fs.readFile(path.join(userDataDir, 'runtime-cache.json'), 'utf-8')).resolves.toBe(
      '{"version":"local"}'
    );
  });

  it('restores full-manifest bundles and removes stale managed runtime files that are absent from the bundle', async () => {
    const { createAppStorageBundleContent, restoreAppStorageBackupContent } = await import(
      '../main/app-storage-bundle'
    );
    const roots = {
      userData: userDataDir,
      home: homeDir,
      temp: tempRoot,
      localAppData: path.join(tempDir, 'localAppData'),
    };

    await fs.writeFile(
      path.join(userDataDir, 'config.json'),
      JSON.stringify({ version: '3.1', sites: [], accounts: [], siteGroups: [], settings: {} }),
      'utf-8'
    );
    await fs.writeFile(path.join(userDataDir, 'runtime-cache.json'), '{"version":"1"}', 'utf-8');
    const content = await createAppStorageBundleContent({ mode: 'full-manifest', roots });

    await fs.writeFile(
      path.join(userDataDir, 'config.json'),
      JSON.stringify({
        version: '3.1',
        sites: [{ id: 'stale', name: 'stale', url: 'https://stale.test', enabled: true }],
        accounts: [],
        siteGroups: [],
        settings: {},
      }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(userDataDir, 'state', 'route-analytics.json'),
      '{"version":"1","buckets":{"stale":{}}}',
      'utf-8'
    );
    await fs.writeFile(
      path.join(userDataDir, 'state', 'route-model-sources.json'),
      '{"version":"1","sources":[{"sourceKey":"stale"}]}',
      'utf-8'
    );
    await fs.mkdir(path.join(userDataDir, 'browser-profiles'), { recursive: true });
    await fs.writeFile(path.join(userDataDir, 'browser-profiles', 'keep.txt'), 'browser', 'utf-8');

    await restoreAppStorageBackupContent(content, path.join(userDataDir, 'config.json'), roots);

    const restoredConfig = JSON.parse(
      await fs.readFile(path.join(userDataDir, 'config.json'), 'utf-8')
    );
    await expect(
      fs.access(path.join(userDataDir, 'state', 'route-analytics.json'))
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(userDataDir, 'state', 'route-model-sources.json'))
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(userDataDir, 'browser-profiles', 'keep.txt'))
    ).resolves.toBeUndefined();
    expect(restoredConfig.sites).toEqual([]);
  });

  it('restores legacy config-only backups while preserving runtime/cache sidecars', async () => {
    const { restoreAppStorageBackupContent } = await import('../main/app-storage-bundle');
    const roots = {
      userData: userDataDir,
      home: homeDir,
      temp: tempRoot,
      localAppData: path.join(tempDir, 'localAppData'),
    };
    const legacyConfig = JSON.stringify({
      version: '3.1',
      sites: [],
      accounts: [],
      siteGroups: [],
      settings: {},
    });

    await fs.writeFile(path.join(userDataDir, 'runtime-cache.json'), '{"version":"1"}', 'utf-8');
    await fs.writeFile(
      path.join(userDataDir, 'state', 'route-runtime.json'),
      '{"version":"1","stats":{"stale":{}}}',
      'utf-8'
    );

    const result = await restoreAppStorageBackupContent(
      legacyConfig,
      path.join(userDataDir, 'config.json'),
      roots
    );

    expect(result.kind).toBe('legacy-config');
    await expect(fs.readFile(path.join(userDataDir, 'runtime-cache.json'), 'utf-8')).resolves.toBe(
      '{"version":"1"}'
    );
    await expect(
      fs.readFile(path.join(userDataDir, 'state', 'route-runtime.json'), 'utf-8')
    ).resolves.toBe('{"version":"1","stats":{"stale":{}}}');
    await expect(fs.access(path.join(userDataDir, 'config.json'))).resolves.toBeUndefined();
  });
});
