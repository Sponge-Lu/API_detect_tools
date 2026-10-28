import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  ApplicationStorage,
  initializeApplicationStorage,
  readStorageText,
} from '../../main/storage/application-storage';
import { AppDatabase } from '../../main/storage/database/app-database';
import { DocumentStore } from '../../main/storage/repositories/document-store';
import {
  prepareCliOperation,
  recoverCliOperations,
  commitCliOperation,
} from '../../main/storage/cli-operation-journal';

const root = path.resolve('.cache/architecture-refactor-tests/application');
mkdirSync(root, { recursive: true });
const directory = () => mkdtempSync(path.join(root, 'case-'));

test('shutdown rejects new work, drains admitted writes and flushes before close', async () => {
  const location = directory();
  const database = new AppDatabase(path.join(location, 'app.db'));
  const storage = new ApplicationStorage(location, database);
  let finish!: () => void;
  const pending = storage.withActivity(async () => {
    await new Promise<void>(resolve => {
      finish = resolve;
    });
    storage.write(
      path.join(location, 'theme-settings.json'),
      JSON.stringify({ themeMode: 'dark' })
    );
  });
  await new Promise(resolve => setImmediate(resolve));
  let flushed = false;
  storage.setHooks({
    flush: async () => {
      flushed = true;
    },
  });
  const closing = storage.close();
  await assert.rejects(
    storage.withActivity(async () => undefined),
    /maintenance/
  );
  assert.equal(flushed, false);
  finish();
  await pending;
  await closing;
  assert.equal(flushed, true);
  assert.throws(() => storage.assertWritable(), /closed/);
  await storage.close();
  const reopened = new AppDatabase(path.join(location, 'app.db'));
  try {
    assert.equal(new DocumentStore(reopened).read('theme-settings')?.themeMode, 'dark');
  } finally {
    reopened.close();
  }
});
const config = () => ({
  version: '3.0.6',
  settings: { timeout: 30 },
  siteGroups: [{ id: 'default', name: 'Default' }],
  sites: [{ id: 'site', name: 'Same name', group: 'default', enabled: true }],
  accounts: [
    {
      id: 'account',
      site_id: 'site',
      api_key: 'test-secret-token',
      local_api_keys: [{ id: 'key', key: 'local-secret' }],
    },
  ],
  routing: {
    rules: [
      {
        id: 'rule',
        priority: 1,
        enabled: true,
        allowedSiteIds: ['site'],
        allowedAccountIds: ['account'],
      },
    ],
    modelRegistry: {
      displayItems: [{ id: 'model', autoCollect: { excludedModels: ['excluded'] } }],
      overrides: [],
      entries: {},
    },
    clientRouting: {},
    globalModelRoutes: [
      {
        id: 'global-search',
        name: 'Search',
        requestModel: 'grok-wire',
        modelId: 'target',
        reasoningEffort: 'high',
        enabled: true,
      },
    ],
    sessionRouting: { instances: {}, overrides: {}, currentRouteBySlot: {} },
  },
});

test('relational documents round-trip secrets, child records and unrelated domains', () => {
  const db = new AppDatabase(path.join(directory(), 'app.db'));
  const store = new DocumentStore(db);
  try {
    const input = config();
    store.write('stable-config', input);
    store.write('custom-cli-configs', {
      version: 1,
      configs: [{ id: 'cli', apiKeys: [{ id: 'k', key: 'cli-secret' }] }],
    });
    store.write('config-file-profiles', {
      version: 4,
      profiles: [{ id: 'p', revision: 2, files: [{ id: 'f', template: 'embedded-secret' }] }],
    });
    assert.deepEqual(store.read('stable-config'), input);
    assert.equal(store.read('custom-cli-configs')?.configs[0].apiKeys[0].key, 'cli-secret');
    assert.equal(
      store.read('config-file-profiles')?.profiles[0].files[0].template,
      'embedded-secret'
    );
    for (const table of ['accounts', 'account_keys', 'custom_cli_keys', 'profile_files']) {
      assert.ok(
        !(
          db.connection.prepare(`SELECT payload FROM ${table}`).all() as Array<{ payload: string }>
        ).some(row => /test-secret|local-secret|cli-secret|embedded-secret/.test(row.payload))
      );
    }
    const before = store.read('stable-config');
    const invalid = config();
    invalid.accounts[0].site_id = 'missing';
    assert.throws(() => store.write('stable-config', invalid), /FOREIGN KEY/);
    assert.deepEqual(store.read('stable-config'), before);
    store.remove('custom-cli-configs');
    assert.equal(store.read('custom-cli-configs'), undefined);
    assert.deepEqual(store.read('stable-config'), before);
  } finally {
    db.close();
  }
});

test('first migration preserves exact input bytes and ignores stale JSON on restart', async () => {
  const location = directory();
  const filename = path.join(location, 'config.json');
  const raw = Buffer.from(JSON.stringify(config(), null, 3) + '\n');
  writeFileSync(filename, raw);
  const first = await initializeApplicationStorage(location, async docs => docs);
  const backups = path.join(location, 'storage/migration-backups');
  assert.deepEqual(
    readFileSync(path.join(backups, readdirSync(backups)[0], 'stable-config.json')),
    raw
  );
  const updated = config();
  updated.settings.timeout = 90;
  first.write(filename, JSON.stringify(updated));
  assert.deepEqual(readFileSync(filename), raw);
  await first.close();
  writeFileSync(filename, '{invalid stale JSON');
  const second = await initializeApplicationStorage(location, async () => {
    throw new Error('must not migrate twice');
  });
  try {
    assert.equal(JSON.parse(await readStorageText(filename)).settings.timeout, 90);
  } finally {
    await second.close();
  }
});

test('invalid migration leaves no completion marker or partial entities', async () => {
  const location = directory();
  writeFileSync(path.join(location, 'config.json'), JSON.stringify(config()));
  const database = new AppDatabase(path.join(location, 'app.db'));
  const storage = new ApplicationStorage(location, database);
  try {
    await assert.rejects(
      storage.initialize(async docs => {
        docs['stable-config']!.accounts[0].site_id = 'missing';
        return docs;
      }),
      /FOREIGN KEY/
    );
    assert.equal(storage.documents.has('stable-config'), false);
    assert.equal(database.connection.prepare('SELECT COUNT(*) FROM sites').pluck().get(), 0);
    assert.equal(
      database.connection.prepare("SELECT 1 FROM app_meta WHERE key = 'migration_complete'").get(),
      undefined
    );
  } finally {
    await storage.close();
  }
});

test('restore validates first, drains admitted work and discards old generation callbacks', async () => {
  const location = directory();
  const filename = path.join(location, 'config.json');
  writeFileSync(filename, JSON.stringify(config()));
  const storage = await initializeApplicationStorage(location, async docs => docs);
  let release!: () => void;
  let late!: Promise<unknown>;
  let finishLate!: () => void;
  let reloaded = 0;
  let changed = 0;
  storage.setHooks({
    reload: async () => {
      reloaded++;
    },
    changed: () => {
      changed++;
    },
  });
  try {
    const invalid = config();
    invalid.accounts[0].site_id = 'missing';
    await assert.rejects(storage.restore({ 'stable-config': invalid }), /FOREIGN KEY/);
    assert.equal(reloaded, 0);
    const before = storage.coordinator.version('app-config');
    const admitted = storage.withActivity(async () => {
      late = new Promise<void>(resolve => {
        finishLate = resolve;
      }).then(() => storage.write(filename, JSON.stringify(config())));
      await new Promise<void>(resolve => {
        release = resolve;
      });
      storage.write(filename, JSON.stringify(config()));
    });
    await new Promise(resolve => setImmediate(resolve));
    const updated = config();
    updated.settings.timeout = 120;
    const restoring = storage.restore({ 'stable-config': updated });
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(
      storage.withActivity(async () => undefined),
      /maintenance/
    );
    release();
    await admitted;
    await restoring;
    assert.equal(storage.documents.read('stable-config')?.settings.timeout, 120);
    assert.notEqual(storage.coordinator.version('app-config').generation, before.generation);
    assert.equal(reloaded, 1);
    assert.equal(changed, 1);
    finishLate();
    await assert.rejects(late, /old data generation/);
  } finally {
    await storage.close();
  }
});

test('client journal recovers across reopen and preserves third-party edits', async () => {
  const location = directory();
  writeFileSync(path.join(location, 'config.json'), JSON.stringify(config()));
  const file = path.join(location, 'client.json');
  const original = '\ufeff{"key":"original-secret"}\r\n';
  writeFileSync(file, original);
  let storage = await initializeApplicationStorage(location, async docs => docs);
  const first = await prepareCliOperation('p', [
    { path: file, content: original, nextContent: 'candidate-secret', exists: true },
  ]);
  writeFileSync(file, 'candidate-secret');
  await storage.close();
  storage = await initializeApplicationStorage(location, async docs => docs);
  try {
    assert.deepEqual(await recoverCliOperations(storage), []);
    assert.equal(readFileSync(file, 'utf8'), original);
    assert.equal(
      storage.database.connection
        .prepare('SELECT state FROM app_operations WHERE operation_id = ?')
        .pluck()
        .get(first),
      'rolled-back'
    );
    const second = await prepareCliOperation('p', [
      { path: file, content: original, nextContent: 'candidate-secret', exists: true },
    ]);
    writeFileSync(file, 'third-party-secret');
    assert.deepEqual(await recoverCliOperations(storage), [second]);
    assert.equal(readFileSync(file, 'utf8'), 'third-party-secret');
    await assert.rejects(prepareCliOperation('p', []), /unresolved/);
    const other = await prepareCliOperation('other', []);
    assert.throws(
      () =>
        commitCliOperation(other, () => {
          throw new Error('metadata failed');
        }),
      /metadata failed/
    );
    assert.equal(
      storage.database.connection
        .prepare('SELECT state FROM app_operations WHERE operation_id = ?')
        .pluck()
        .get(other),
      'prepared'
    );
    commitCliOperation(other);
    assert.equal(
      storage.database.connection
        .prepare('SELECT state FROM app_operations WHERE operation_id = ?')
        .pluck()
        .get(other),
      'committed'
    );
    const payloads = storage.database.connection
      .prepare('SELECT payload FROM app_operations')
      .all();
    assert.ok(!JSON.stringify(payloads).includes('original-secret'));
  } finally {
    await storage.close();
  }
});

test('logical snapshots do not wait for unrelated network activities', async () => {
  const location = directory();
  writeFileSync(path.join(location, 'config.json'), JSON.stringify(config()));
  const storage = await initializeApplicationStorage(location, async docs => docs);
  let finish!: () => void;
  const request = storage.withActivity(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      })
  );
  await new Promise(resolve => setImmediate(resolve));
  try {
    const snapshot = await storage.snapshotDocuments();
    assert.equal(snapshot['stable-config']?.sites[0].id, 'site');
    await storage.withActivity(async () => undefined);
  } finally {
    finish();
    await request;
    await storage.close();
  }
});

test('selected snapshots do not read or decrypt unrelated database documents', async () => {
  const location = directory();
  writeFileSync(path.join(location, 'config.json'), JSON.stringify(config()));
  const storage = await initializeApplicationStorage(location, async docs => docs);
  const read = storage.documents.read.bind(storage.documents);
  const reads: string[] = [];
  storage.documents.read = id => {
    reads.push(id);
    return read(id);
  };
  try {
    const snapshot = await storage.snapshotDocuments(['stable-config', 'custom-cli-configs']);
    assert.equal(snapshot['stable-config']?.sites[0].id, 'site');
    assert.deepEqual(reads, ['stable-config', 'custom-cli-configs']);
    reads.length = 0;
    await storage.snapshotDocuments();
    assert.ok(reads.includes('route-analytics-state'));
  } finally {
    await storage.close();
  }
});

test('restore failure on a later table preserves every earlier row and revision', async () => {
  const location = directory();
  writeFileSync(path.join(location, 'config.json'), JSON.stringify(config()));
  const storage = await initializeApplicationStorage(location, async docs => docs);
  const cli = { configs: [{ id: 'cli', name: 'Before', apiKeys: [] }], activeConfigId: null };
  storage.documents.write('custom-cli-configs', cli);
  const version = storage.coordinator.version('app-config');
  const before = storage.documents.read('stable-config');
  storage.database.connection.exec(
    "CREATE TRIGGER reject_restore BEFORE UPDATE ON custom_cli_configs BEGIN SELECT RAISE(ABORT, 'injected restore failure'); END"
  );
  const updated = config();
  updated.settings.timeout = 200;
  try {
    await assert.rejects(
      storage.restore({
        'stable-config': updated,
        'custom-cli-configs': { ...cli, configs: [{ ...cli.configs[0], name: 'After' }] },
      }),
      /injected restore failure/
    );
    assert.deepEqual(storage.documents.read('stable-config'), before);
    assert.deepEqual(storage.documents.read('custom-cli-configs'), cli);
    assert.deepEqual(storage.coordinator.version('app-config'), version);
  } finally {
    await storage.close();
  }
});

test('a committed restore that cannot rehydrate stays fenced until restart', async () => {
  const location = directory();
  writeFileSync(path.join(location, 'config.json'), JSON.stringify(config()));
  let storage = await initializeApplicationStorage(location, async docs => docs);
  storage.setHooks({
    reload: async () => {
      throw new Error('injected projection failure');
    },
  });
  const updated = config();
  updated.settings.timeout = 201;
  await assert.rejects(
    storage.restore({ 'stable-config': updated }),
    (error: unknown) => (error as { committed?: boolean }).committed === true
  );
  await assert.rejects(
    storage.withActivity(async () => undefined),
    /maintenance/
  );
  await storage.close();
  storage = await initializeApplicationStorage(location, async docs => docs);
  try {
    assert.equal(storage.documents.read('stable-config')?.settings.timeout, 201);
  } finally {
    await storage.close();
  }
});

test('process termination during restore yields an old or committed complete dataset', async () => {
  for (const mode of ['before-commit', 'after-commit']) {
    const location = directory();
    writeFileSync(path.join(location, 'config.json'), JSON.stringify(config()));
    const storage = await initializeApplicationStorage(location, async docs => docs);
    storage.documents.write('custom-cli-configs', { configs: [{ id: 'cli', name: 'Before' }] });
    await storage.close();
    const child = `
      const { initializeApplicationStorage } = require(${JSON.stringify(require.resolve('../../main/storage/application-storage'))});
      (async () => {
        const storage = await initializeApplicationStorage(process.argv[1], async docs => docs);
        const input = storage.documents.read('stable-config'); input.settings.timeout = 202;
        if (process.argv[2] === 'before-commit') {
          const write = storage.documents.write.bind(storage.documents);
          storage.documents.write = (id, value) => { write(id, value); if (id === 'custom-cli-configs') process.exit(23); };
        } else storage.setHooks({ reload: async () => process.exit(23) });
        await storage.restore({ 'stable-config': input, 'custom-cli-configs': { configs: [{ id: 'cli', name: 'After' }] } });
      })().catch(error => { console.error(error); process.exit(1); });`;
    const result = spawnSync(process.execPath, ['-e', child, location, mode], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      encoding: 'utf8',
    });
    assert.equal(result.status, 23, result.stderr);
    const reopened = await initializeApplicationStorage(location, async docs => docs);
    try {
      assert.equal(
        reopened.documents.read('stable-config')?.settings.timeout,
        mode === 'before-commit' ? 30 : 202
      );
      assert.equal(
        reopened.documents.read('custom-cli-configs')?.configs[0].name,
        mode === 'before-commit' ? 'Before' : 'After'
      );
    } finally {
      await reopened.close();
    }
  }
});

test('interrupted first migration restarts without partial rows or duplicate identities', async () => {
  for (const mode of ['during-import', 'after-marker']) {
    const location = directory();
    const original = JSON.stringify(config());
    writeFileSync(path.join(location, 'config.json'), original);
    writeFileSync(
      path.join(location, 'custom-cli-configs.json'),
      JSON.stringify({ configs: [{ id: 'cli' }] })
    );
    const child = `
      const app = require(${JSON.stringify(require.resolve('../../main/storage/application-storage'))});
      const { DocumentStore } = require(${JSON.stringify(require.resolve('../../main/storage/repositories/document-store'))});
      if (process.argv[2] === 'during-import') {
        const write = DocumentStore.prototype.write;
        DocumentStore.prototype.write = function(id, value) { write.call(this, id, value); if (id === 'custom-cli-configs') process.exit(23); };
      } else {
        const initialize = app.ApplicationStorage.prototype.initialize;
        app.ApplicationStorage.prototype.initialize = async function(prepare) { await initialize.call(this, prepare); process.exit(23); };
      }
      app.initializeApplicationStorage(process.argv[1], async docs => docs).catch(error => { console.error(error); process.exit(1); });`;
    const result = spawnSync(process.execPath, ['-e', child, location, mode], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      encoding: 'utf8',
    });
    assert.equal(result.status, 23, result.stderr);
    const reopened = await initializeApplicationStorage(location, async docs => docs);
    try {
      assert.equal(
        reopened.database.connection.prepare('SELECT COUNT(*) FROM sites').pluck().get(),
        1
      );
      assert.equal(reopened.documents.read('stable-config')?.accounts[0].id, 'account');
      assert.equal(reopened.documents.read('custom-cli-configs')?.configs[0].id, 'cli');
      assert.equal(readFileSync(path.join(location, 'config.json'), 'utf8'), original);
    } finally {
      await reopened.close();
    }
  }
});
