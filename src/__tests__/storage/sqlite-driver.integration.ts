import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import Database from 'better-sqlite3';

const fixtureRoot = path.resolve('.cache/architecture-refactor-tests/sqlite-driver');
mkdirSync(fixtureRoot, { recursive: true });

test('Electron SQLite driver preserves transactions, constraints and a live backup', async () => {
  const root = mkdtempSync(path.join(fixtureRoot, 'transaction-'));
  const filename = path.join(root, 'app.db');
  const db = new Database(filename, { timeout: 20 });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('synchronous', { simple: true }), 2);
    db.exec(
      'CREATE TABLE sites(id TEXT PRIMARY KEY); CREATE TABLE accounts(id TEXT PRIMARY KEY, site_id TEXT REFERENCES sites(id));'
    );
    db.prepare('INSERT INTO sites VALUES (?)').run('site-1');
    assert.throws(
      () => db.prepare('INSERT INTO accounts VALUES (?, ?)').run('orphan', 'missing'),
      /FOREIGN KEY/
    );
    assert.throws(
      db.transaction(() => {
        db.prepare('INSERT INTO sites VALUES (?)').run('site-2');
        db.prepare('INSERT INTO accounts VALUES (?, ?)').run('account-2', 'site-2');
        throw new Error('injected failure');
      }),
      /injected failure/
    );
    assert.equal(db.prepare('SELECT COUNT(*) FROM sites').pluck().get(), 1);
    assert.equal(db.prepare('SELECT COUNT(*) FROM accounts').pluck().get(), 0);

    const other = new Database(filename, { timeout: 20 });
    try {
      db.exec('BEGIN IMMEDIATE');
      assert.throws(
        () => other.prepare('INSERT INTO sites VALUES (?)').run('blocked'),
        (error: unknown) => (error as { code?: string }).code === 'SQLITE_BUSY'
      );
      db.exec('ROLLBACK');
      other.prepare('INSERT INTO sites VALUES (?)').run('site-3');
    } finally {
      other.close();
    }
    await db.backup(path.join(root, 'snapshot.db'));
    const snapshot = new Database(path.join(root, 'snapshot.db'), { readonly: true });
    try {
      assert.equal(snapshot.pragma('integrity_check', { simple: true }), 'ok');
      assert.equal(snapshot.prepare('SELECT COUNT(*) FROM sites').pluck().get(), 2);
    } finally {
      snapshot.close();
    }
  } finally {
    db.close();
  }
  const reopened = new Database(filename, { fileMustExist: true });
  try {
    assert.equal(reopened.prepare('SELECT COUNT(*) FROM sites').pluck().get(), 2);
  } finally {
    reopened.close();
  }
  writeFileSync(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        versions: process.versions,
        checks: ['foreign-key', 'rollback', 'busy', 'backup', 'reopen'],
      },
      null,
      2
    ),
    'utf8'
  );
});

test('records equivalent durable JSON and SQLite workloads without production data', async () => {
  const root = mkdtempSync(path.join(fixtureRoot, 'benchmark-'));
  const report: unknown[] = [];
  for (const count of [1000, 10000, 50000]) {
    const db = new Database(path.join(root, `${count}.db`));
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.exec(
      'CREATE TABLE buckets(bucket_key TEXT PRIMARY KEY, bucket_start INTEGER NOT NULL, site_id TEXT NOT NULL, success_count INTEGER NOT NULL, failure_count INTEGER NOT NULL); CREATE INDEX buckets_time ON buckets(bucket_start);'
    );
    const now = Date.now();
    const rows = Array.from({ length: count }, (_, i) => ({
      key: `bucket-${i}`,
      time: now - (i % 48) * 3600000,
      site: `site-${i % 20}`,
      success: 5,
      failure: 1,
    }));
    const insert = db.prepare(
      'INSERT INTO buckets VALUES (@key, @time, @site, @success, @failure)'
    );
    db.transaction(() => rows.forEach(row => insert.run(row)))();
    const filename = path.join(root, `${count}.json`);
    writeFileSync(filename, JSON.stringify(rows), 'utf8');
    const jsonSamples: number[] = [];
    const sqliteSamples: number[] = [];
    for (let i = 0; i < 5; i++) {
      let started = performance.now();
      const parsed = JSON.parse(readFileSync(filename, 'utf8')) as typeof rows;
      parsed[0].success++;
      // Use the application's atomic/fsync writer to keep durability comparable.
      const { writeTextFileAtomically } = await import('../../main/utils/atomic-json');
      await writeTextFileAtomically(filename, JSON.stringify(parsed));
      jsonSamples.push(performance.now() - started);
      started = performance.now();
      db.prepare('UPDATE buckets SET success_count = success_count + 1 WHERE bucket_key = ?').run(
        'bucket-0'
      );
      sqliteSamples.push(performance.now() - started);
    }
    const started = performance.now();
    const total = db
      .prepare(
        'SELECT SUM(success_count) AS success, SUM(failure_count) AS failure FROM buckets WHERE bucket_start >= ?'
      )
      .get(now - 48 * 3600000);
    const queryMs = performance.now() - started;
    assert.deepEqual(total, { success: count * 5 + 5, failure: count });
    const backupStart = performance.now();
    await db.backup(path.join(root, `${count}-backup.db`));
    report.push({
      count,
      jsonSamples,
      sqliteSamples,
      queryMs,
      backupMs: performance.now() - backupStart,
    });
    db.close();
  }
  writeFileSync(
    path.join(root, 'benchmark.json'),
    JSON.stringify({ versions: process.versions, report }, null, 2),
    'utf8'
  );
});
