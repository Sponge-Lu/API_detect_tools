import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { AppDatabase } from '../../main/storage/database/app-database';
import { SitesRepository } from '../../main/storage/repositories/sites-repository';
import type { AccountCredential } from '../../shared/types/site';

const root = path.resolve('.cache/architecture-refactor-tests/sites-repository');
mkdirSync(root, { recursive: true });
test('round-trips same-name sites, stable IDs, ordered accounts and encrypted local keys', () => {
  const db = new AppDatabase(path.join(mkdtempSync(path.join(root, 'case-')), 'app.db'));
  const repository = new SitesRepository(db);
  try {
    repository.insertGroup({ id: 'default', name: 'Default' }, 0);
    repository.insertSite(
      { id: 'first', name: 'Same', url: 'https://a.invalid', group: 'default', enabled: false },
      1
    );
    repository.insertSite(
      { id: 'second', name: 'Same', url: 'https://b.invalid', group: 'default', enabled: true },
      0
    );
    assert.deepEqual(
      repository.sites().map(site => site.id),
      ['second', 'first']
    );
    const account: AccountCredential = {
      id: 'account',
      site_id: 'first',
      account_name: 'Account',
      user_id: '1',
      access_token: 'FAKE_ACCESS_TOKEN_41dfe5',
      api_key: 'FAKE_API_KEY_53ab8b',
      auth_source: 'manual',
      created_at: 1,
      updated_at: 2,
      local_api_keys: [
        {
          id: 'local-key',
          name: 'Local',
          key: 'FAKE_LOCAL_KEY_a932ef',
          group: '',
          groupMultiplier: 1,
          models: [],
          source: 'local',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    repository.insertAccount(account, 0);
    assert.deepEqual(repository.account('account'), account);
    assert.equal(repository.accounts('second').length, 0);
    assert.equal(repository.accounts('first').length, 1);
    const raw = db.connection.prepare('SELECT payload FROM accounts').pluck().get() as string;
    assert.ok(raw.startsWith('encrypted:v1:'));
    assert.equal(raw.includes(account.access_token), false);
    const site = repository.site('first')!;
    assert.equal(repository.updateSite({ ...site, name: 'Changed' }), true);
    assert.equal(repository.site('first')!.enabled, false);
    assert.equal(repository.site('second')!.name, 'Same');
    assert.throws(
      () => repository.insertSite({ ...site, id: 'cache', cached_data: {} }, 3),
      /runtime repository/
    );
  } finally {
    db.close();
  }
});

test('deletion is atomic and does not broaden an exhausted rule or remove unrelated entities', () => {
  const db = new AppDatabase(path.join(mkdtempSync(path.join(root, 'delete-')), 'app.db'));
  const repository = new SitesRepository(db);
  try {
    repository.insertGroup({ id: 'default', name: 'Default' }, 0);
    for (const id of ['first', 'second'])
      repository.insertSite(
        { id, name: 'Same', url: `https://${id}.invalid`, group: 'default', enabled: true },
        0
      );
    db.connection
      .prepare('INSERT INTO route_rules VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('limited', 1, 0, 1, 1, 0, 'protected-payload');
    db.connection
      .prepare('INSERT INTO route_rules VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('unrestricted', 1, 1, 1, 0, 0, 'protected-payload');
    db.connection
      .prepare('INSERT INTO rule_sites(rule_id, site_id) VALUES (?, ?)')
      .run('limited', 'first');
    assert.throws(
      () =>
        db.transaction(() => {
          repository.deleteSite('first');
          throw new Error('rollback');
        }),
      /rollback/
    );
    assert.ok(repository.site('first'));
    assert.equal(
      db.connection.prepare('SELECT enabled FROM route_rules WHERE id = ?').pluck().get('limited'),
      1
    );
    assert.equal(repository.deleteSite('first'), true);
    assert.equal(repository.site('first'), undefined);
    assert.ok(repository.site('second'));
    assert.equal(
      db.connection.prepare('SELECT enabled FROM route_rules WHERE id = ?').pluck().get('limited'),
      0
    );
    assert.equal(
      db.connection
        .prepare('SELECT enabled FROM route_rules WHERE id = ?')
        .pluck()
        .get('unrestricted'),
      1
    );
    assert.equal(repository.deleteSite('missing'), false);
  } finally {
    db.close();
  }
});
