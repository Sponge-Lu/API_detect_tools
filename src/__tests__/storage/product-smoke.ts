import { app, BrowserWindow, session } from 'electron';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import type { ApplicationStorage } from '../../main/storage/application-storage';
import { runProductRouteSmoke } from './product-route-smoke';

const root = process.env.STORAGE_SMOKE_ROOT;
if (!root || !path.isAbsolute(root)) throw new Error('Isolated storage root is required');
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', root);
app.setPath('sessionData', path.join(root, 'session'));
app.setPath('crashDumps', path.join(root, 'crashes'));
app.setPath('home', process.env.USERPROFILE!);
app.disableHardwareAcceleration();
const phase = Number(process.env.STORAGE_SMOKE_PHASE ?? 1);
const configPath = path.join(root, 'config.json');
if (phase === 1) {
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        version: '2.1.24',
        sites: ['one', 'two'].map(id => ({
          id,
          name: 'Same name',
          url: `https://${id}.invalid`,
          enabled: true,
          group: 'default',
          api_key: 'smoke-secret-' + id,
        })),
        siteGroups: [{ id: 'default', name: 'Default' }],
        settings: {
          timeout: 30,
          concurrent: true,
          max_concurrent: 3,
          show_disabled: false,
          browser_path: '',
        },
      },
      null,
      2
    ),
    'utf8'
  );
}
const inputBytes = fs.existsSync(configPath) ? fs.readFileSync(configPath) : undefined;
const moduleAt = (name: string) => require(path.join(app.getAppPath(), 'dist/main', name));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => {
  fs.writeFileSync(path.join(root, 'error.txt'), 'Product smoke timed out', 'utf8');
  app.exit(2);
}, 90000);

void app
  .whenReady()
  .then(async () => {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, callback) =>
        callback({ cancel: !['127.0.0.1', 'localhost'].includes(new URL(details.url).hostname) })
    );
    moduleAt('main.js');
    const { getApplicationStorage } = moduleAt('storage/application-storage.js');
    let window: BrowserWindow | undefined;
    let storage: ApplicationStorage | undefined;
    for (let attempt = 0; attempt < 400; attempt++) {
      storage = getApplicationStorage();
      window = BrowserWindow.getAllWindows()[0];
      if (storage && window && !window.webContents.isLoading()) {
        const ready = await window.webContents
          .executeJavaScript('Boolean(window.electronAPI)')
          .catch(() => false);
        if (ready) break;
      }
      await wait(100);
    }
    assert.ok(window && storage);
    const evaluate = <T>(script: string): Promise<T> =>
      window!.webContents.executeJavaScript(script);
    // Wait until the real main entry has registered the preload's IPC endpoints.
    let loaded: any;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        loaded = await evaluate('window.electronAPI.loadConfig()');
        break;
      } catch {
        await wait(100);
      }
    }
    assert.equal(loaded.sites.length, phase === 1 ? 2 : phase === 2 ? 3 : 0);
    assert.equal(loaded.storageVersion.scope, 'app-config');
    const { unifiedConfigManager: manager } = moduleAt('unified-config-manager.js');
    if (phase === 1) {
      assert.equal(manager.getAccountsBySiteId('one').length, 1);
      const outcome = await evaluate<any>(`(async () => {
      const old = await window.electronAPI.loadConfig();
      await window.electronAPI.sites.add({ id: 'new', name: 'Later', url: 'https://later.invalid', enabled: true, group: 'default' });
      old.sites[0].name = 'Stale';
      let conflict = false; try { await window.electronAPI.saveConfig(old); } catch (error) { conflict = /reload before saving/i.test(error.message); }
      const current = await window.electronAPI.loadConfig();
      current.sites.find(site => site.id === 'one').name = 'Restored target';
      await window.electronAPI.saveConfig(current);
      return { conflict, sites: (await window.electronAPI.loadConfig()).sites };
    })()`);
      assert.equal(outcome.conflict, true);
      assert.equal(outcome.sites.find((site: any) => site.id === 'two').name, 'Same name');
      const canonical = await evaluate<boolean>(`(async () => {
        const draft = await window.electronAPI.loadConfig();
        draft.sites.push({ name: 'Temporary draft', url: 'https://draft.invalid', group: 'default', enabled: true });
        const saved = await window.electronAPI.saveConfig(draft);
        const created = saved.sites.find(site => site.name === 'Temporary draft');
        if (!created?.id || !saved.storageVersion) return false;
        created.name = 'Edited canonical draft';
        await window.electronAPI.saveConfig(saved);
        await window.electronAPI.sites.delete(created.id);
        return true;
      })()`);
      assert.equal(canonical, true);
      const route = await evaluate<any>(`(async () => {
      const before = await window.electronAPI.route.getConfig();
      const port = before.data.server.port + 1;
      const saved = await window.electronAPI.route.saveServerConfig({ port });
      let conflict = false;
      try { await window.electronAPI.route.saveServerConfig({ port: port + 1, storageVersion: before.storageVersion }); }
      catch (error) { conflict = /reload before saving/i.test(error.message); }
      return { saved, conflict, port: (await window.electronAPI.route.getConfig()).data.server.port, expectedPort: port };
    })()`);
      assert.equal(route.saved.success, true);
      assert.equal(route.conflict, true);
      assert.equal(route.port, route.expectedPort);
      storage.database.connection.exec(
        "CREATE TRIGGER smoke_failure BEFORE UPDATE ON sites WHEN NEW.id = 'two' BEGIN SELECT RAISE(ABORT, 'injected smoke failure'); END"
      );
      const failed = await evaluate<boolean>(
        `(async () => { const draft = await window.electronAPI.loadConfig(); draft.sites.find(site => site.id === 'one').name = 'Must roll back'; draft.sites.find(site => site.id === 'two').name = 'Fails'; try { await window.electronAPI.saveConfig(draft); return false; } catch { return true; } })()`
      );
      assert.equal(failed, true);
      assert.equal(manager.getSiteById('one').name, 'Restored target');
      storage.database.connection.exec('DROP TRIGGER smoke_failure');
      const version = storage.coordinator.version('app-config');
      const account = manager.getAccountsBySiteId('one')[0];
      await manager.updateAccountCachedData(account.id, () => ({
        balance: 42,
        last_refresh: Date.now(),
        local_api_keys: [
          { id: 'cached-key', key: 'cached-smoke-secret', name: 'Test', models: [] },
        ],
      }));
      assert.deepEqual(storage.coordinator.version('app-config'), version);
      const registry = structuredClone(manager.getRoutingConfig().modelRegistry);
      const source = {
        sourceKey: 'smoke-source',
        siteId: 'one',
        siteName: 'Same name',
        accountId: account.id,
        sourceType: 'account',
        originalModel: 'smoke-model',
        vendor: 'other',
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      registry.sources = [source];
      registry.entries = {
        'smoke-model': {
          canonicalName: 'smoke-model',
          vendor: 'other',
          aliases: [],
          sources: [source],
          hasOverride: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
      await manager.updateRouteModelRegistry(registry);
      assert.deepEqual(storage.coordinator.version('app-config'), version);
      assert.equal(storage.documents.read('model-registry-source-state')?.sources.length, 1);
      const direct = await evaluate<any>(`(async () => {
      const before = await window.electronAPI.customCliConfig.load();
      const config = { id: 'direct-smoke', name: 'Direct smoke', baseUrl: 'https://direct.invalid', apiKey: 'direct-smoke-secret', models: [], cliSettings: {}, createdAt: 1, updatedAt: 1, gasStationUrl: 'https://fuel.invalid', notes: 'Preserved' };
      const saved = await window.electronAPI.customCliConfig.save({ ...before, configs: [config] });
      const after = await window.electronAPI.customCliConfig.load();
      return { saved, after };
    })()`);
      assert.equal(direct.saved.success, true);
      assert.equal(direct.after.configs[0].gasStationUrl, 'https://fuel.invalid');
      assert.equal(direct.after.configs[0].notes, 'Preserved');
      const bundles = moduleAt('app-storage-bundle.js');
      const content = await bundles.createAppStorageBundleContent({
        mode: 'full-manifest',
        includeSecrets: true,
      });
      assert.ok(!content.includes('smoke-secret'));
      const stripped = await bundles.createAppStorageBundleContent({
        mode: 'full-manifest',
        includeSecrets: false,
      });
      assert.ok(!stripped.includes('cached-smoke-secret'));
      await manager.updateSite('one', { name: 'After backup' });
      await bundles.restoreAppStorageBackupContent(content, configPath);
      assert.equal(manager.getSiteById('one').name, 'Restored target');
      assert.equal(manager.getAccountById(account.id).cached_data.balance, 42);
      await runProductRouteSmoke(root, manager, moduleAt);
      const cli = moduleAt('storage/cli-operation-journal.js');
      const cliPath = path.join(root, 'client-fixture.json');
      fs.writeFileSync(cliPath, 'original-client', 'utf8');
      await cli.prepareCliOperation('smoke-profile', [
        {
          path: cliPath,
          content: 'original-client',
          nextContent: 'interrupted-client',
          exists: true,
        },
      ]);
      fs.writeFileSync(cliPath, 'interrupted-client', 'utf8');
    } else if (phase === 2) {
      assert.equal(manager.getSiteById('one').name, 'Restored target');
      assert.equal(
        fs.readFileSync(path.join(root, 'client-fixture.json'), 'utf8'),
        'original-client'
      );
    }
    if (inputBytes) assert.deepEqual(fs.readFileSync(configPath), inputBytes);
    else assert.equal(fs.existsSync(configPath), false);
    assert.equal(storage.database.connection.pragma('integrity_check', { simple: true }), 'ok');
    fs.writeFileSync(
      path.join(root, `product-result-${phase}.json`),
      JSON.stringify({
        phase,
        packaged: app.isPackaged,
        versions: process.versions,
        sites: manager.getSites().length,
      }),
      'utf8'
    );
    clearTimeout(deadline);
    await storage.close();
    app.exit(0);
  })
  .catch(error => {
    fs.writeFileSync(path.join(root, 'error.txt'), error.stack ?? String(error), 'utf8');
    app.exit(1);
  });
