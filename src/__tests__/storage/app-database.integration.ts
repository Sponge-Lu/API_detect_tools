import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { AppDatabase } from '../../main/storage/database/app-database';
import { DATABASE_MIGRATIONS } from '../../main/storage/database/schema';
import { encodePayload, decodePayload } from '../../main/storage/database/payload-codec';
import { parseStateVersion } from '../../shared/types/app-storage-contract';
import {
  StorageCoordinator,
  StorageConflictError,
  StorageMaintenanceError,
} from '../../main/storage/database/storage-coordinator';

const root = path.resolve('.cache/architecture-refactor-tests/database');
mkdirSync(root, { recursive: true });
function filename(): string {
  return path.join(mkdtempSync(path.join(root, 'case-')), 'app.db');
}

test('schema keeps ownership, relationships, default account ownership and historical dimensions', () => {
  const file = filename();
  const app = new AppDatabase(file);
  const db = app.connection;
  try {
    db.prepare('INSERT INTO site_groups VALUES (?, ?, ?, ?)').run('default', 'Default', 0, '{}');
    db.prepare('INSERT INTO sites VALUES (?, ?, ?, ?, ?)').run('a', 'default', 1, 0, '{}');
    db.prepare('INSERT INTO sites VALUES (?, ?, ?, ?, ?)').run('b', 'default', 1, 1, '{}');
    db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run('account-a', 'a', 0, '{}');
    db.prepare('INSERT INTO site_defaults VALUES (?, ?)').run('a', 'account-a');
    assert.throws(
      () => db.prepare('INSERT INTO site_defaults VALUES (?, ?)').run('b', 'account-a'),
      /another site/
    );
    assert.throws(
      () => db.prepare('UPDATE accounts SET site_id = ? WHERE id = ?').run('b', 'account-a'),
      /another site/
    );
    assert.throws(
      () => db.prepare('DELETE FROM site_groups WHERE id = ?').run('default'),
      /FOREIGN KEY/
    );
    assert.throws(
      () =>
        db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run('orphan', 'missing', 0, '{}'),
      /FOREIGN KEY/
    );
    db.prepare('DELETE FROM sites WHERE id = ?').run('a');
    assert.equal(db.prepare('SELECT count(*) FROM accounts').pluck().get(), 0);
    assert.equal(db.prepare('SELECT count(*) FROM site_defaults').pluck().get(), 0);
    assert.equal(db.prepare('SELECT count(*) FROM sites').pluck().get(), 1);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    app.close();
  }
  const reopened = new AppDatabase(file);
  reopened.close();
});

test('rejects foreign databases and future versions without modifying their bytes', () => {
  const foreign = filename();
  const raw = new Database(foreign);
  raw.exec('CREATE TABLE unrelated(value TEXT)');
  raw.close();
  const original = readFileSync(foreign);
  assert.throws(() => new AppDatabase(foreign), /Unrecognized/);
  assert.deepEqual(readFileSync(foreign), original);
  const future = filename();
  const app = new AppDatabase(future);
  app.connection.pragma('user_version = 999');
  app.close();
  const futureBytes = readFileSync(future);
  assert.throws(() => new AppDatabase(future), /future database/);
  assert.deepEqual(readFileSync(future), futureBytes);
});

test('rejects edited migrations and rolls back schema/data/version on failed upgrades', async () => {
  const file = filename();
  new AppDatabase(file).close();
  assert.throws(
    () =>
      new AppDatabase(file, {
        migrations: DATABASE_MIGRATIONS.map((migration, index) =>
          index === 0 ? { ...migration, sql: 'SELECT 1' } : migration
        ),
      }),
    /migration has changed/
  );
  const migrations = [
    ...DATABASE_MIGRATIONS,
    {
      version: DATABASE_MIGRATIONS.length + 1,
      sql: 'CREATE TABLE upgrade_probe(value TEXT); INSERT INTO no_such_table VALUES (1);',
    },
  ];
  const backup = path.join(path.dirname(file), 'before-upgrade.db');
  await assert.rejects(
    AppDatabase.open(file, { migrations, upgradeSnapshot: backup }),
    /no_such_table/
  );
  const reopened = new AppDatabase(file);
  try {
    assert.equal(
      reopened.connection.pragma('user_version', { simple: true }),
      DATABASE_MIGRATIONS.length
    );
    assert.equal(
      reopened.connection
        .prepare("SELECT name FROM sqlite_master WHERE name = 'upgrade_probe'")
        .get(),
      undefined
    );
    const snapshot = new Database(backup, { readonly: true });
    try {
      assert.equal(snapshot.pragma('integrity_check', { simple: true }), 'ok');
    } finally {
      snapshot.close();
    }
  } finally {
    reopened.close();
  }
});

test('successful schema upgrades require a snapshot and apply exactly once', async () => {
  const file = filename();
  new AppDatabase(file).close();
  const migrations = [
    ...DATABASE_MIGRATIONS,
    {
      version: DATABASE_MIGRATIONS.length + 1,
      sql: 'CREATE TABLE upgrade_probe(value TEXT) STRICT;',
    },
  ];
  await assert.rejects(AppDatabase.open(file, { migrations }), /snapshot destination/);
  const app = await AppDatabase.open(file, {
    migrations,
    upgradeSnapshot: path.join(path.dirname(file), 'before.db'),
  });
  assert.equal(
    app.connection.pragma('user_version', { simple: true }),
    DATABASE_MIGRATIONS.length + 1
  );
  app.close();
  const reopened = await AppDatabase.open(file, { migrations });
  assert.equal(
    reopened.connection.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get(),
    DATABASE_MIGRATIONS.length + 1
  );
  reopened.close();
});

test('rejects async transactions before executing their body', () => {
  const app = new AppDatabase(filename());
  let invoked = false;
  try {
    assert.throws(
      () =>
        app.transaction(async () => {
          invoked = true;
        }),
      /synchronous/
    );
    assert.equal(invoked, false);
    assert.throws(
      () =>
        app.transaction(() => {
          app.connection.prepare('INSERT INTO app_meta VALUES (?, ?)').run('rolled-back', 'value');
          return Promise.resolve();
        }),
      /promise/
    );
    assert.equal(app.connection.prepare('SELECT COUNT(*) FROM app_meta').pluck().get(), 0);
  } finally {
    app.close();
  }
});

test('serializes competing stale commands and does not advance revisions on failure', async () => {
  const app = new AppDatabase(filename());
  const coordinator = new StorageCoordinator(app);
  try {
    const initial = coordinator.version('app-config');
    const insert = (key: string) => () =>
      app.connection.prepare('INSERT INTO app_meta VALUES (?, ?)').run(key, 'value');
    const first = coordinator.mutate('app-config', initial, insert('first'));
    const second = coordinator.mutate('app-config', initial, insert('second'));
    assert.equal((await first).version.revision, 1);
    await assert.rejects(second, StorageConflictError);
    const current = coordinator.version('app-config');
    await assert.rejects(
      coordinator.mutate('app-config', current, () => {
        insert('failed')();
        throw new Error('injected');
      }),
      /injected/
    );
    assert.deepEqual(coordinator.version('app-config'), current);
    assert.deepEqual(app.connection.prepare('SELECT key FROM app_meta').all(), [{ key: 'first' }]);
    assert.equal(coordinator.version('custom-cli-configs').revision, 0);
  } finally {
    await coordinator.close();
  }
});

test('maintenance drains admitted commands and invalidates old generations before reopening', async () => {
  const app = new AppDatabase(filename());
  const coordinator = new StorageCoordinator(app);
  try {
    const before = coordinator.version('app-config');
    const queued = coordinator.mutate('app-config', before, () => 'saved');
    await coordinator.maintain(async () => {
      assert.equal((await queued).data, 'saved');
      await assert.rejects(
        coordinator.mutate('app-config', before, () => 'blocked'),
        StorageMaintenanceError
      );
      coordinator.invalidateGeneration();
    });
    await assert.rejects(
      coordinator.mutate('app-config', { ...before, revision: 1 }, () => 'stale'),
      StorageConflictError
    );
    assert.equal(
      (await coordinator.mutate('app-config', coordinator.version('app-config'), () => 'fresh'))
        .data,
      'fresh'
    );
    await assert.rejects(
      coordinator.maintain(async () => {
        throw new Error('failed preflight');
      }),
      /failed preflight/
    );
    assert.equal(
      (
        await coordinator.mutate(
          'app-config',
          coordinator.version('app-config'),
          () => 'after-failure'
        )
      ).data,
      'after-failure'
    );
  } finally {
    await coordinator.close();
  }
});

test('SQLite recovers an interrupted writer and retains a committed writer across processes', () => {
  const file = filename();
  new AppDatabase(file).close();
  for (const commit of [false, true]) {
    const source = `const D = require('better-sqlite3'); const db = new D(${JSON.stringify(file)}); db.exec('BEGIN IMMEDIATE'); db.prepare('INSERT INTO app_meta VALUES (?, ?)').run('crash-record', 'value'); ${commit ? "db.exec('COMMIT');" : ''} process.exit(23);`;
    const child = spawnSync(process.execPath, ['-e', source], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(child.status, 23, child.stderr);
    const reopened = new AppDatabase(file);
    try {
      assert.equal(
        reopened.connection.prepare('SELECT COUNT(*) FROM app_meta').pluck().get(),
        commit ? 1 : 0
      );
    } finally {
      reopened.close();
    }
  }
});

test('cross-scope commands commit or roll back all affected revisions together', async () => {
  const app = new AppDatabase(filename());
  const coordinator = new StorageCoordinator(app);
  try {
    const scopes = ['app-config', 'config-file-profiles'] as const;
    const versions = scopes.map(scope => coordinator.version(scope));
    await assert.rejects(
      coordinator.mutateScopes(scopes, versions, () => {
        app.connection.prepare('INSERT INTO app_meta VALUES (?, ?)').run('partial', 'value');
        throw new Error('failed cross-scope mutation');
      }),
      /failed cross-scope/
    );
    assert.deepEqual(
      scopes.map(scope => coordinator.version(scope)),
      versions
    );
    assert.equal(app.connection.prepare('SELECT COUNT(*) FROM app_meta').pluck().get(), 0);
    const committed = await coordinator.mutateScopes(scopes, versions, () => 'both');
    assert.deepEqual(
      committed.versions.map(version => version.revision),
      [1, 1]
    );
    assert.equal(coordinator.version('custom-cli-configs').revision, 0);
    await assert.rejects(
      coordinator.mutateScopes(['app-config', 'app-config'], versions, () => null),
      /unique/
    );
  } finally {
    await coordinator.close();
  }
});

test('protects arbitrary extension/template contents before they reach database pages or WAL', async () => {
  const file = filename();
  const app = new AppDatabase(file);
  const secret = 'FAKE_DATABASE_SECRET_786da42f';
  const value = {
    password: secret,
    template: `token=${secret}`,
    enabled: false,
    amount: 0,
    unknown: { text: secret },
  };
  try {
    const encoded = encodePayload(value);
    assert.ok(encoded.startsWith('encrypted:v1:'));
    assert.notEqual(encoded, encodePayload(value));
    app.connection
      .prepare('INSERT INTO app_preferences VALUES (?, ?, ?)')
      .run('test', 'extension', encoded);
    const row = app.connection.prepare('SELECT payload FROM app_preferences').get() as {
      payload: string;
    };
    assert.deepEqual(decodePayload(row.payload), value);
    assert.throws(() => decodePayload(JSON.stringify(value)), /Unprotected/);
    assert.throws(() => encodePayload(undefined), /serializable/);
    assert.equal(readFileSync(file).includes(Buffer.from(secret)), false);
    assert.equal(readFileSync(file + '-wal').includes(Buffer.from(secret)), false);
    const backup = path.join(path.dirname(file), 'encrypted-snapshot.db');
    await app.snapshot(backup);
    assert.equal(readFileSync(backup).includes(Buffer.from(secret)), false);
    await assert.rejects(app.snapshot(backup), /already exists/);
    await assert.rejects(app.snapshot(file), /separate absolute/);
  } finally {
    app.close();
  }
  const reopened = new AppDatabase(file);
  try {
    const row = reopened.connection.prepare('SELECT payload FROM app_preferences').get() as {
      payload: string;
    };
    assert.deepEqual(decodePayload(row.payload), value);
  } finally {
    reopened.close();
  }
});

test('runtime version validation rejects malformed or extra writable fields', () => {
  const valid = { generation: 'test', scope: 'app-config', revision: 0 };
  assert.deepEqual(parseStateVersion(valid), valid);
  for (const invalid of [
    null,
    [],
    {},
    { ...valid, revision: -1 },
    { ...valid, revision: 0.5 },
    { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, generation: '' },
    { ...valid, scope: 'unknown' },
    { ...valid, stats: {} },
  ]) {
    assert.throws(() => parseStateVersion(invalid), /Invalid storage version/);
  }
});
