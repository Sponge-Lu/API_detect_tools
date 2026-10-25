import type { AppDatabase } from '../database/app-database';
import { decodePayload, encodePayload } from '../database/payload-codec';
import {
  mapDocument,
  reconstructDocument,
  type JsonRecord,
  type Row,
  type StorageDocumentId,
  type TableRows,
} from './document-mapping';

const identifier = (name: string): string => {
  if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid internal storage identifier');
  return '"' + name + '"';
};

export class DocumentStore {
  constructor(readonly database: AppDatabase) {}

  has(id: StorageDocumentId): boolean {
    return Boolean(
      this.database.connection
        .prepare('SELECT 1 FROM document_metadata WHERE document_id = ?')
        .get(id)
    );
  }

  read(id: StorageDocumentId): JsonRecord | undefined {
    const meta = this.database.connection
      .prepare('SELECT payload FROM document_metadata WHERE document_id = ?')
      .get(id) as { payload: string } | undefined;
    if (!meta) return undefined;
    const metadata: JsonRecord = {};
    for (const row of this.readRows('app_preferences', { domain: id })) {
      assignLeaf(metadata, JSON.parse(row.key as string), decodePayload(row.payload as string));
    }
    return reconstructDocument(id, metadata, (table, filter = {}) => this.readRows(table, filter));
  }

  write(id: StorageDocumentId, value: unknown): void {
    const mapped = mapDocument(id, value);
    mapped.tables.push({
      table: 'app_preferences',
      keys: ['domain', 'key'],
      rows: flatten(mapped.metadata).map(([keys, field]) => ({
        domain: id,
        key: JSON.stringify(keys),
        payload: encodePayload(field),
      })),
    });
    this.database.transaction(() => {
      const grouped = new Map<string, TableRows>();
      for (const item of mapped.tables) {
        if (!grouped.has(item.table)) grouped.set(item.table, { ...item, rows: [] });
        grouped.get(item.table)!.rows.push(...item.rows);
      }
      for (const item of grouped.values()) this.upsertRows(item);
      for (const item of [...grouped.values()].reverse())
        this.removeAbsentRows(
          item,
          item.table === 'document_records'
            ? { document_id: id }
            : item.table === 'app_preferences'
              ? { domain: id }
              : {}
        );
      const existing = this.database.connection
        .prepare('SELECT payload FROM document_metadata WHERE document_id = ?')
        .get(id) as { payload: string } | undefined;
      if (!existing) {
        this.database.connection
          .prepare(
            'INSERT INTO document_metadata VALUES (?, ?) ON CONFLICT(document_id) DO UPDATE SET payload = excluded.payload'
          )
          .run(id, encodePayload({ format: 1 }));
      }
    });
  }

  upsertCollection(
    id: StorageDocumentId,
    location: string,
    entries: Record<string, unknown>
  ): void {
    const partial: JsonRecord = { version: '1' };
    let owner = partial;
    const keys = location.split('.');
    for (const key of keys.slice(0, -1)) owner = owner[key] = {};
    owner[keys[keys.length - 1]] = entries;
    const mapped = mapDocument(id, partial);
    this.database.transaction(() => {
      if (!this.has(id)) this.write(id, { ...partial, [location]: {} });
      for (const table of mapped.tables) this.upsertRows(table);
      this.database.connection
        .prepare(
          'INSERT INTO app_preferences VALUES (?, ?, ?) ON CONFLICT(domain,key) DO UPDATE SET payload=excluded.payload'
        )
        .run(id, JSON.stringify(['last_updated']), encodePayload(Date.now()));
    });
  }

  pruneAnalytics(now = Date.now()): void {
    this.database.transaction(() => {
      this.database.connection
        .prepare('DELETE FROM route_analytics_buckets WHERE updated_at < ?')
        .run(now - 30 * 86400000);
      this.database.connection
        .prepare(
          'DELETE FROM route_analytics_buckets WHERE bucket_key IN (SELECT bucket_key FROM route_analytics_buckets ORDER BY updated_at DESC, bucket_key LIMIT -1 OFFSET 50000)'
        )
        .run();
    });
  }

  analyticsBuckets(start: number, end: number): JsonRecord[] {
    return (
      this.database.connection
        .prepare(
          'SELECT payload FROM route_analytics_buckets WHERE bucket_start >= ? AND bucket_start < ? ORDER BY bucket_start'
        )
        .all(start, end) as Array<{ payload: string }>
    ).map(row => decodePayload<JsonRecord>(row.payload));
  }

  remove(id: StorageDocumentId): void {
    const old = this.read(id);
    if (!old) return;
    const mapped = mapDocument(id, old);
    this.database.transaction(() => {
      for (const item of [...mapped.tables].reverse()) {
        const filter = item.table === 'document_records' ? { document_id: id } : {};
        const keys = Object.keys(filter);
        this.database.connection
          .prepare(
            `DELETE FROM ${identifier(item.table)}${keys.length ? ' WHERE ' + keys.map(key => identifier(key) + ' = ?').join(' AND ') : ''}`
          )
          .run(...Object.values(filter));
      }
      this.database.connection
        .prepare('DELETE FROM document_metadata WHERE document_id = ?')
        .run(id);
      this.database.connection.prepare('DELETE FROM app_preferences WHERE domain = ?').run(id);
    });
  }

  readRows(table: string, filter: Row = {}): Row[] {
    const keys = Object.keys(filter);
    const columns = this.database.connection
      .prepare(`PRAGMA table_info(${identifier(table)})`)
      .all() as Array<{ name: string }>;
    const order = columns.some(column => column.name === 'sort_order')
      ? ' ORDER BY sort_order'
      : '';
    return this.database.connection
      .prepare(
        `SELECT * FROM ${identifier(table)}${keys.length ? ' WHERE ' + keys.map(key => identifier(key) + ' = ?').join(' AND ') : ''}${order}`
      )
      .all(...Object.values(filter)) as Row[];
  }

  private upsertRows(item: TableRows): void {
    for (const row of item.rows) {
      const existing = this.database.connection
        .prepare(
          `SELECT * FROM ${identifier(item.table)} WHERE ${item.keys.map(key => identifier(key) + ' = ?').join(' AND ')}`
        )
        .get(...item.keys.map(key => row[key])) as Row | undefined;
      const equal =
        existing &&
        Object.entries(row).every(([key, value]) =>
          key === 'payload'
            ? same(decodePayload(existing.payload as string), decodePayload(value as string))
            : existing[key] === value
        );
      if (equal) continue;
      const columns = Object.keys(row);
      const mutable = columns.filter(column => !item.keys.includes(column));
      this.database.connection
        .prepare(
          `INSERT INTO ${identifier(item.table)} (${columns.map(identifier).join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT (${item.keys.map(identifier).join(',')}) ${mutable.length ? 'DO UPDATE SET ' + mutable.map(column => identifier(column) + '=excluded.' + identifier(column)).join(',') : 'DO NOTHING'}`
        )
        .run(...Object.values(row));
    }
  }

  private removeAbsentRows(item: TableRows, filter: Row): void {
    const desired = new Set(item.rows.map(row => JSON.stringify(item.keys.map(key => row[key]))));
    for (const row of this.readRows(item.table, filter)) {
      if (!desired.has(JSON.stringify(item.keys.map(key => row[key])))) {
        this.database.connection
          .prepare(
            `DELETE FROM ${identifier(item.table)} WHERE ${item.keys.map(key => identifier(key) + ' = ?').join(' AND ')}`
          )
          .run(...item.keys.map(key => row[key]));
      }
    }
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function flatten(value: JsonRecord, prefix: string[] = []): Array<[string[], unknown]> {
  return Object.entries(value).flatMap(([key, field]) => {
    const keys = [...prefix, key];
    return field && typeof field === 'object' && !Array.isArray(field) && Object.keys(field).length
      ? flatten(field, keys)
      : [[keys, field]];
  });
}
function assignLeaf(root: JsonRecord, keys: string[], value: unknown): void {
  let parent = root;
  for (const key of keys.slice(0, -1)) {
    if (!Object.prototype.hasOwnProperty.call(parent, key))
      Object.defineProperty(parent, key, {
        value: {},
        enumerable: true,
        writable: true,
        configurable: true,
      });
    parent = parent[key];
  }
  Object.defineProperty(parent, keys[keys.length - 1], {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
