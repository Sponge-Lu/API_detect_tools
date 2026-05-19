import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'migrate-config-v224-to-v301.cjs');

function runMigration(configPath: string, extraArgs: string[] = []) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      [scriptPath, '--path', configPath, ...extraArgs],
      { cwd: repoRoot },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

describe('migrate-config-v224-to-v301 script', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-hub-migrate-script-'));
    configPath = path.join(tempDir, 'config.json');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('splits cached_data and route runtime payloads out of config.json', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          version: '2.1.24',
          sites: [
            {
              id: 'site-1',
              name: 'Legacy Site',
              url: 'https://example.test',
              site_type: 'newapi',
              enabled: true,
              group: 'default',
              access_token: 'site-token',
              user_id: 'user-1',
              cached_data: {
                models: ['gpt-4o-mini'],
                balance: 12.5,
                has_checkin: true,
                last_refresh: 1000,
              },
              cli_config: {
                codex: {
                  apiKeyId: 1,
                  model: 'gpt-4o-mini',
                },
              },
            },
          ],
          accounts: [],
          siteGroups: [{ id: 'default', name: '默认分组' }],
          settings: { timeout: 30, concurrent: true, show_disabled: false },
          routing: {
            server: { host: '127.0.0.1', port: 3210 },
            rules: [{ id: 'rule-1', enabled: true }],
            stats: {
              'rule-1:site-1:acct-1:key-1': {
                routeRuleId: 'rule-1',
                siteId: 'site-1',
                accountId: 'acct-1',
                apiKeyId: 'key-1',
                successCount: 1,
                failureCount: 0,
                neutralCount: 0,
                consecutiveFailures: 0,
                lastUsedAt: 2000,
              },
            },
            routePathStates: {},
            health: {},
            modelRegistry: {
              entries: [],
              displayItems: [],
              sources: [{ sourceKey: 'source-1', originalModel: 'gpt-4o-mini' }],
              vendorPriorities: {},
              overrides: [],
              lastAggregatedAt: 2000,
            },
            cliProbe: {
              config: { enabled: true },
              latest: { probe1: { probeKey: 'probe1', lastSample: { testedAt: 2000 } } },
              history: { probe1: [{ probeKey: 'probe1', testedAt: 2000 }] },
            },
            analytics: {
              config: { enabled: true },
              buckets: { bucket1: { bucketKey: 'bucket1', bucketStart: 2000, updatedAt: 2000 } },
            },
          },
          last_updated: 1,
        },
        null,
        2
      ),
      'utf-8'
    );

    await runMigration(configPath);

    const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    const runtimeCache = JSON.parse(
      await fs.readFile(path.join(tempDir, 'runtime-cache.json'), 'utf-8')
    );
    const routeRuntime = JSON.parse(
      await fs.readFile(path.join(tempDir, 'state', 'route-runtime.json'), 'utf-8')
    );
    const routeProbes = JSON.parse(
      await fs.readFile(path.join(tempDir, 'state', 'route-probes.json'), 'utf-8')
    );
    const routeAnalytics = JSON.parse(
      await fs.readFile(path.join(tempDir, 'state', 'route-analytics.json'), 'utf-8')
    );
    const routeModelSources = JSON.parse(
      await fs.readFile(path.join(tempDir, 'state', 'route-model-sources.json'), 'utf-8')
    );

    expect(config.version).toBe('3.1');
    expect(config.sites[0].cached_data).toBeUndefined();
    expect(config.sites[0].cli_config.codex.targetProtocol).toBeUndefined();
    expect(config.accounts).toHaveLength(1);
    expect(config.accounts[0].cached_data).toBeUndefined();
    expect(config.accounts[0].cli_config.codex.targetProtocol).toBeUndefined();
    expect(config.routing.stats).toEqual({});
    expect(config.routing.cliProbe.latest).toEqual({});
    expect(config.routing.analytics.buckets).toEqual({});
    expect(config.routing.modelRegistry.sources).toEqual([]);
    expect(config.routing.modelRegistry.lastAggregatedAt).toBeUndefined();
    expect(runtimeCache.site_shared_by_site_id['site-1']).toMatchObject({
      models: ['gpt-4o-mini'],
      last_refresh: 1000,
    });
    expect(runtimeCache.account_runtime_by_account_id[config.accounts[0].id]).toMatchObject({
      balance: 12.5,
      has_checkin: true,
    });
    expect(routeRuntime.stats['rule-1:site-1:acct-1:key-1'].successCount).toBe(1);
    expect(routeProbes.latest.probe1.probeKey).toBe('probe1');
    expect(routeProbes.history.probe1).toHaveLength(1);
    expect(routeAnalytics.buckets.bucket1.bucketKey).toBe('bucket1');
    expect(routeModelSources.sources).toEqual([expect.objectContaining({ sourceKey: 'source-1' })]);
  });

  it('preserves existing split state when rerun against an already clean config', async () => {
    await fs.mkdir(path.join(tempDir, 'state'), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          version: '3.1',
          sites: [],
          accounts: [],
          siteGroups: [],
          settings: { timeout: 30, concurrent: true, show_disabled: false },
          routing: {
            stats: {},
            routePathStates: {},
            health: {},
            modelRegistry: {
              entries: [],
              displayItems: [],
              sources: [],
              vendorPriorities: {},
              overrides: [],
            },
            cliProbe: { config: {}, latest: {}, history: {} },
            analytics: { config: {}, buckets: {} },
          },
          last_updated: 1,
        },
        null,
        2
      ),
      'utf-8'
    );
    await fs.writeFile(
      path.join(tempDir, 'state', 'route-runtime.json'),
      JSON.stringify({
        version: '1',
        stats: { existing: { lastUsedAt: 1, successCount: 2 } },
        routePathStates: {},
        health: {},
        last_updated: 1,
      }),
      'utf-8'
    );

    await runMigration(configPath);

    const routeRuntime = JSON.parse(
      await fs.readFile(path.join(tempDir, 'state', 'route-runtime.json'), 'utf-8')
    );

    expect(routeRuntime.stats.existing.successCount).toBe(2);
  });
});
