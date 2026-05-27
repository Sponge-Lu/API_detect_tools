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
    vi.resetModules();
    vi.clearAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('bundles only default full-manifest files and excludes protected browser state', async () => {
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
      userData: userDataDir,
      home: homeDir,
      temp: tempRoot,
      localAppData: path.join(tempDir, 'localAppData'),
    });
    const entryIds = bundle.files.map(file => file.entryId);

    expect(entryIds).toContain('stable-config');
    expect(entryIds).toContain('runtime-detection-cache');
    expect(entryIds).toContain('route-runtime-state');
    expect(entryIds).not.toContain('model-registry-source-state');
    expect(entryIds).not.toContain('persistent-browser-profiles');
    expect(entryIds).not.toContain('custom-cli-configs');
  });

  it('restores bundles and removes stale managed runtime files that are absent from the bundle', async () => {
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
    const content = await createAppStorageBundleContent(roots);

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
