import type { AccountCredential, SiteGroup, UnifiedSite } from '../../../shared/types/site';
import type { AppDatabase } from '../database/app-database';
import { encodePayload, decodePayload } from '../database/payload-codec';

interface SiteRow {
  id: string;
  group_id: string;
  enabled: number;
  payload: string;
}
interface AccountRow {
  id: string;
  site_id: string;
  payload: string;
}

export class SitesRepository {
  constructor(private readonly database: AppDatabase) {}

  insertGroup(group: SiteGroup, order: number): void {
    const { id, name, ...extension } = group;
    this.database.connection
      .prepare('INSERT INTO site_groups VALUES (?, ?, ?, ?)')
      .run(id, name, order, encodePayload(extension));
  }

  groups(): SiteGroup[] {
    const rows = this.database.connection
      .prepare('SELECT id, name, payload FROM site_groups ORDER BY sort_order, id')
      .all() as Array<{ id: string; name: string; payload: string }>;
    return rows.map(row => ({ ...decodePayload<object>(row.payload), id: row.id, name: row.name }));
  }

  insertSite(site: UnifiedSite, order: number): void {
    if (site.cached_data !== undefined)
      throw new Error('Detection cache must use its runtime repository');
    const { id, group, enabled, ...extension } = site;
    this.database.connection
      .prepare('INSERT INTO sites VALUES (?, ?, ?, ?, ?)')
      .run(id, group, Number(enabled), order, encodePayload(extension));
  }

  updateSite(site: UnifiedSite): boolean {
    if (site.cached_data !== undefined)
      throw new Error('Detection cache must use its runtime repository');
    const { id, group, enabled, ...extension } = site;
    return (
      this.database.connection
        .prepare('UPDATE sites SET group_id = ?, enabled = ?, payload = ? WHERE id = ?')
        .run(group, Number(enabled), encodePayload(extension), id).changes > 0
    );
  }

  site(id: string): UnifiedSite | undefined {
    const row = this.database.connection
      .prepare('SELECT id, group_id, enabled, payload FROM sites WHERE id = ?')
      .get(id) as SiteRow | undefined;
    return row ? decodeSite(row) : undefined;
  }

  sites(): UnifiedSite[] {
    return (
      this.database.connection
        .prepare('SELECT id, group_id, enabled, payload FROM sites ORDER BY sort_order, id')
        .all() as SiteRow[]
    ).map(decodeSite);
  }

  insertAccount(account: AccountCredential, order: number): void {
    if (account.cached_data !== undefined)
      throw new Error('Detection cache must use its runtime repository');
    const { id, site_id, local_api_keys, ...extension } = account;
    this.database.transaction(() => {
      this.database.connection.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(
        id,
        site_id,
        order,
        encodePayload({
          ...extension,
          ...(local_api_keys === undefined ? {} : { local_api_keys: [] }),
        })
      );
      const insert = this.database.connection.prepare(
        'INSERT INTO account_keys VALUES (?, ?, ?, ?, ?)'
      );
      for (const [index, key] of (local_api_keys ?? []).entries()) {
        const { id: keyId, ...payload } = key;
        insert.run(id, 'local', keyId, index, encodePayload(payload));
      }
    });
  }

  account(id: string): AccountCredential | undefined {
    const row = this.database.connection
      .prepare('SELECT id, site_id, payload FROM accounts WHERE id = ?')
      .get(id) as AccountRow | undefined;
    if (!row) return undefined;
    const extension = decodePayload<Omit<AccountCredential, 'id' | 'site_id'>>(row.payload);
    const account = { ...extension, id: row.id, site_id: row.site_id };
    if (Object.prototype.hasOwnProperty.call(extension, 'local_api_keys')) {
      const keys = this.database.connection
        .prepare(
          "SELECT key_id, payload FROM account_keys WHERE account_id = ? AND source = 'local' ORDER BY sort_order, key_id"
        )
        .all(id) as Array<{ key_id: string; payload: string }>;
      account.local_api_keys = keys.map(key => ({
        ...decodePayload<Omit<NonNullable<AccountCredential['local_api_keys']>[number], 'id'>>(
          key.payload
        ),
        id: key.key_id,
      }));
    }
    return account;
  }

  accounts(siteId?: string): AccountCredential[] {
    const query =
      siteId === undefined
        ? this.database.connection.prepare('SELECT id FROM accounts ORDER BY sort_order, id').all()
        : this.database.connection
            .prepare('SELECT id FROM accounts WHERE site_id = ? ORDER BY sort_order, id')
            .all(siteId);
    return (query as Array<{ id: string }>).map(row => this.account(row.id)!);
  }

  deleteSite(id: string): boolean {
    return this.database.transaction(() => {
      const db = this.database.connection;
      const affectedSites = db
        .prepare('SELECT rule_id FROM rule_sites WHERE site_id = ?')
        .all(id) as Array<{ rule_id: string }>;
      const affectedAccounts = db
        .prepare(
          'SELECT DISTINCT rule_id FROM rule_accounts WHERE account_id IN (SELECT id FROM accounts WHERE site_id = ?)'
        )
        .all(id) as Array<{ rule_id: string }>;
      const removed = db.prepare('DELETE FROM sites WHERE id = ?').run(id).changes > 0;
      // An exhausted allow-list must not silently turn into an unrestricted rule.
      const disableSites = db.prepare(
        'UPDATE route_rules SET enabled = 0 WHERE id = ? AND NOT EXISTS (SELECT 1 FROM rule_sites WHERE rule_id = ?)'
      );
      const disableAccounts = db.prepare(
        'UPDATE route_rules SET enabled = 0 WHERE id = ? AND NOT EXISTS (SELECT 1 FROM rule_accounts WHERE rule_id = ?)'
      );
      affectedSites.forEach(row => disableSites.run(row.rule_id, row.rule_id));
      affectedAccounts.forEach(row => disableAccounts.run(row.rule_id, row.rule_id));
      return removed;
    });
  }
}

function decodeSite(row: SiteRow): UnifiedSite {
  return {
    ...decodePayload<Omit<UnifiedSite, 'id' | 'group' | 'enabled'>>(row.payload),
    id: row.id,
    group: row.group_id,
    enabled: row.enabled === 1,
  };
}
