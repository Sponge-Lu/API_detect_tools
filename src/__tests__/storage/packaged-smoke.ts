import { app } from 'electron';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const root = process.env.STORAGE_SMOKE_ROOT;
if (!root || !path.isAbsolute(root)) throw new Error('An isolated STORAGE_SMOKE_ROOT is required');
mkdirSync(root, { recursive: true });
app.setPath('userData', root);
app.setPath('sessionData', path.join(root, 'session'));
app.setPath('crashDumps', path.join(root, 'crashes'));
app.disableHardwareAcceleration();

app
  .whenReady()
  .then(async () => {
    const db = new Database(path.join(root, 'app.db'));
    try {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = FULL');
      db.exec('CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, visits INTEGER NOT NULL)');
      db.prepare(
        'INSERT INTO records VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET visits = visits + 1'
      ).run('smoke');
      await db.backup(path.join(root, 'snapshot.db'));
      const backup = new Database(path.join(root, 'snapshot.db'), { readonly: true });
      let visits: number;
      try {
        assert.equal(backup.pragma('integrity_check', { simple: true }), 'ok');
        visits = backup
          .prepare('SELECT visits FROM records WHERE id = ?')
          .pluck()
          .get('smoke') as number;
      } finally {
        backup.close();
      }
      writeFileSync(
        path.join(root, 'result.json'),
        JSON.stringify({ versions: process.versions, visits, packaged: app.isPackaged }, null, 2),
        'utf8'
      );
    } finally {
      db.close();
    }
    app.exit(0);
  })
  .catch(error => {
    writeFileSync(path.join(root, 'error.txt'), String(error), 'utf8');
    app.exit(1);
  });
