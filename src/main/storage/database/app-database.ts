import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATABASE_MIGRATIONS, type DatabaseMigration } from './schema';

const APPLICATION_ID = 0x41504842;

export class AppDatabase {
  readonly connection: Database.Database;

  static async open(
    filename: string,
    options: {
      timeout?: number;
      migrations?: readonly DatabaseMigration[];
      upgradeSnapshot?: string;
    } = {}
  ): Promise<AppDatabase> {
    if (!path.isAbsolute(filename)) throw new Error('Database path must be absolute');
    const migrations = options.migrations ?? DATABASE_MIGRATIONS;
    validateMigrations(migrations);
    if (!existsSync(filename)) return new AppDatabase(filename, options);
    const probe = new Database(filename, { readonly: true, fileMustExist: true });
    let version: number;
    try {
      version = probe.pragma('user_version', { simple: true }) as number;
    } finally {
      probe.close();
    }
    if (version === 0 || version >= migrations.length) return new AppDatabase(filename, options);
    const db = new AppDatabase(filename, { ...options, migrations: migrations.slice(0, version) });
    try {
      if (!options.upgradeSnapshot)
        throw new Error('Database upgrade requires a snapshot destination');
      await db.snapshot(options.upgradeSnapshot);
      db.transaction(() => {
        if (db.connection.pragma('user_version', { simple: true }) !== version) {
          throw new Error('Database changed during schema upgrade');
        }
        db.applyMigrations(migrations, version);
      });
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  constructor(
    readonly filename: string,
    options: { timeout?: number; migrations?: readonly DatabaseMigration[] } = {}
  ) {
    if (!path.isAbsolute(filename)) throw new Error('Database path must be absolute');
    const existed = existsSync(filename);
    mkdirSync(path.dirname(filename), { recursive: true });
    const db = new Database(filename, { timeout: options.timeout ?? 1000 });
    this.connection = db;
    try {
      // Check ownership/version before changing any persistent connection settings.
      const applicationId = db.pragma('application_id', { simple: true });
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all();
      if (
        (applicationId !== 0 && applicationId !== APPLICATION_ID) ||
        (applicationId === 0 && tables.length > 0)
      ) {
        throw new Error('Unrecognized application database');
      }
      const migrations = options.migrations ?? DATABASE_MIGRATIONS;
      validateMigrations(migrations);
      const currentVersion = db.pragma('user_version', { simple: true }) as number;
      if (currentVersion > migrations.length)
        throw new Error('Unsupported future database version');
      if (applicationId === APPLICATION_ID)
        this.verifyAppliedMigrations(migrations, currentVersion);
      else if (currentVersion !== 0) throw new Error('Unrecognized database schema version');
      if (existed && applicationId === APPLICATION_ID && currentVersion < migrations.length) {
        // Existing databases must be upgraded through open() after a verified backup.
        throw new Error('Database upgrade requires a verified snapshot');
      }
      db.pragma('foreign_keys = ON');
      if (db.pragma('foreign_keys', { simple: true }) !== 1)
        throw new Error('Foreign keys are unavailable');
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = FULL');
      if (
        db.pragma('journal_mode', { simple: true }) !== 'wal' ||
        db.pragma('synchronous', { simple: true }) !== 2
      ) {
        throw new Error('Required database durability settings are unavailable');
      }
      if (applicationId === 0) {
        this.transaction(() => {
          db.exec(
            'CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT'
          );
          this.applyMigrations(migrations, 0);
          db.pragma('application_id = ' + APPLICATION_ID);
        });
      }
    } catch (error) {
      db.close();
      throw error;
    }
  }

  transaction<T>(operation: () => T): T {
    if (operation.constructor.name === 'AsyncFunction')
      throw new Error('Database transactions must be synchronous');
    return this.connection
      .transaction(() => {
        const result = operation();
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          throw new Error('Database transactions cannot return a promise');
        }
        return result;
      })
      .immediate();
  }

  async snapshot(destination: string): Promise<void> {
    if (
      !path.isAbsolute(destination) ||
      path.resolve(destination) === path.resolve(this.filename)
    ) {
      throw new Error('Snapshot must have a separate absolute destination');
    }
    if (existsSync(destination)) throw new Error('Snapshot destination already exists');
    mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = destination + '.pending-' + randomUUID();
    await this.connection.backup(temporary);
    const snapshot = new Database(temporary, { readonly: true, fileMustExist: true });
    try {
      if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok') {
        throw new Error('Snapshot integrity verification failed');
      }
    } finally {
      snapshot.close();
    }
    if (existsSync(destination)) throw new Error('Snapshot destination already exists');
    renameSync(temporary, destination);
  }

  close(): void {
    if (this.connection.open) this.connection.close();
  }

  private verifyAppliedMigrations(migrations: readonly DatabaseMigration[], version: number): void {
    const applied = this.connection
      .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number; checksum: string }>;
    if (applied.length !== version) throw new Error('Database migration history is inconsistent');
    for (const [index, row] of applied.entries()) {
      if (row.version !== index + 1 || row.checksum !== checksum(migrations[index].sql)) {
        throw new Error('Applied database migration has changed');
      }
    }
  }

  private applyMigrations(migrations: readonly DatabaseMigration[], from: number): void {
    for (const migration of migrations.slice(from)) {
      this.connection.exec(migration.sql);
      this.connection
        .prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)')
        .run(migration.version, checksum(migration.sql), Date.now());
      this.connection.pragma('user_version = ' + migration.version);
    }
  }
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

function validateMigrations(migrations: readonly DatabaseMigration[]): void {
  if (
    migrations.length === 0 ||
    migrations.some((migration, index) => migration.version !== index + 1)
  ) {
    throw new Error('Database migrations must be consecutive and start at version 1');
  }
}
