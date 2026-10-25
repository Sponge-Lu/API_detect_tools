import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as fs from 'node:fs';
import path from 'node:path';
import { decryptField } from '../config-field-crypto';
import { AppDatabase } from './database/app-database';
import { StorageCoordinator, StorageConflictError } from './database/storage-coordinator';
import type { StateVersion, StableScope } from '../../shared/types/app-storage-contract';
import { DocumentStore } from './repositories/document-store';
import {
  STORAGE_DOCUMENT_PATHS,
  type StorageDocumentId,
  type JsonRecord,
} from './repositories/document-mapping';

export type StorageDocuments = Partial<Record<StorageDocumentId, JsonRecord>>;
type StorageHooks = {
  flush?: () => Promise<void>;
  reload?: () => Promise<void>;
  changed?: () => void;
  committed?: () => void;
};
let active: ApplicationStorage | undefined;

export class ApplicationStorage {
  readonly documents: DocumentStore;
  readonly coordinator: StorageCoordinator;
  private hooks: StorageHooks = {};
  private restoring = false;
  private unready = false;
  private closed = false;
  private readonly operations = new Set<Promise<unknown>>();
  private readonly activity = new AsyncLocalStorage<{ generation: string; open: boolean }>();
  private readonly privileged = new AsyncLocalStorage<{ open: boolean }>();
  private prepareDocuments?: (documents: StorageDocuments) => Promise<StorageDocuments>;

  constructor(
    readonly root: string,
    readonly database: AppDatabase
  ) {
    this.documents = new DocumentStore(database);
    this.coordinator = new StorageCoordinator(database);
  }

  documentId(filename: string): StorageDocumentId | undefined {
    const target = path.resolve(filename);
    return (Object.keys(STORAGE_DOCUMENT_PATHS) as StorageDocumentId[]).find(id => {
      const candidate = path.resolve(this.root, STORAGE_DOCUMENT_PATHS[id]);
      return process.platform === 'win32'
        ? candidate.toLowerCase() === target.toLowerCase()
        : candidate === target;
    });
  }

  setHooks(hooks: StorageHooks): void {
    this.hooks = hooks;
  }

  async commitDocument(
    id: StorageDocumentId,
    scope: StableScope,
    version: StateVersion,
    value: unknown,
    related: StorageDocuments = {},
    advance = true
  ): Promise<void> {
    this.assertWritable();
    const write = () => {
      if (advance) this.documents.write(id, value);
      for (const [documentId, document] of Object.entries(related))
        this.documents.write(documentId as StorageDocumentId, document);
    };
    if (!advance) {
      this.database.transaction(() => {
        const current = this.coordinator.version(scope);
        if (JSON.stringify(current) !== JSON.stringify(version))
          throw new StorageConflictError(current);
        write();
      });
      return;
    }
    if (this.privileged.getStore()?.open) {
      this.database.transaction(() => {
        write();
        this.database.connection
          .prepare('UPDATE scope_revisions SET revision = revision + 1 WHERE scope = ?')
          .run(scope);
      });
      this.hooks.committed?.();
      return;
    }
    await this.coordinator.mutate(scope, version, write);
    this.hooks.committed?.();
  }

  async withActivity<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activity.getStore()?.open) return operation();
    if (this.restoring || this.unready || this.closed)
      throw Object.assign(new Error('Application data is in maintenance'), {
        code: 'RESTORE_IN_PROGRESS',
      });
    const token = { generation: this.coordinator.version('app-config').generation, open: true };
    const pending = this.activity.run(token, () => Promise.resolve().then(operation));
    this.operations.add(pending);
    try {
      return await pending;
    } finally {
      token.open = false;
      this.operations.delete(pending);
    }
  }

  private async maintenance<T>(operation: () => Promise<T>): Promise<T> {
    if (this.restoring || this.unready)
      throw Object.assign(new Error('Application data is in maintenance'), {
        code: 'RESTORE_IN_PROGRESS',
      });
    this.restoring = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const permit = { open: true };
    try {
      await Promise.race([
        Promise.allSettled([...this.operations]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Application operations did not drain within 30 seconds')),
            30000
          );
        }),
      ]);
      if (timer) clearTimeout(timer);
      return await this.privileged.run(permit, async () => {
        await this.hooks.flush?.();
        return this.coordinator.maintain(operation);
      });
    } finally {
      if (timer) clearTimeout(timer);
      permit.open = false;
      this.restoring = false;
    }
  }

  async initialize(
    prepare: (documents: StorageDocuments) => Promise<StorageDocuments>
  ): Promise<void> {
    this.prepareDocuments = prepare;
    const initialized = this.database.connection
      .prepare("SELECT value FROM app_meta WHERE key = 'migration_complete'")
      .get();
    if (initialized) {
      if (!this.documents.has('stable-config'))
        throw new Error('Initialized database is missing stable configuration');
      return;
    }
    const captured = new Map<StorageDocumentId, Buffer>();
    const input: StorageDocuments = {};
    for (const id of Object.keys(STORAGE_DOCUMENT_PATHS) as StorageDocumentId[]) {
      try {
        const bytes = fs.readFileSync(path.join(this.root, STORAGE_DOCUMENT_PATHS[id]));
        captured.set(id, bytes);
        input[id] = decodeLegacyFields(JSON.parse(bytes.toString('utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (captured.size && !captured.has('stable-config'))
      throw new Error('Legacy storage is missing config.json; restore a valid backup first');
    validateDocumentVersions(input);
    const prepared = await prepare(structuredClone(input));
    if (!prepared['stable-config'])
      throw new Error('Migration did not produce stable configuration');
    const backup = path.join(this.root, 'storage/migration-backups', randomUUID());
    fs.mkdirSync(backup, { recursive: true });
    const manifest: Array<{ id: string; sha256: string; exists: boolean }> = [];
    for (const id of Object.keys(STORAGE_DOCUMENT_PATHS) as StorageDocumentId[]) {
      const bytes = captured.get(id);
      manifest.push({
        id,
        exists: Boolean(bytes),
        sha256: bytes ? createHash('sha256').update(bytes).digest('hex') : '',
      });
      if (bytes) durableWrite(path.join(backup, id + '.json'), bytes);
      let current: Buffer | undefined;
      try {
        current = fs.readFileSync(path.join(this.root, STORAGE_DOCUMENT_PATHS[id]));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (bytes ? !current?.equals(bytes) : Boolean(current))
        throw new Error('Legacy data changed while preparing migration');
    }
    durableWrite(
      path.join(backup, 'manifest.json'),
      Buffer.from(JSON.stringify(manifest, null, 2))
    );
    this.database.transaction(() => {
      if (
        this.database.connection
          .prepare("SELECT 1 FROM app_meta WHERE key = 'migration_complete'")
          .get()
      )
        throw new Error('Migration was already completed by another writer');
      for (const [id, value] of Object.entries(prepared))
        this.documents.write(id as StorageDocumentId, value);
      this.database.connection
        .prepare('INSERT INTO app_meta VALUES (?, ?)')
        .run(
          'migration_complete',
          JSON.stringify({ completedAt: Date.now(), backup, sources: manifest })
        );
    });
  }

  read(filename: string): string | undefined {
    const id = this.documentId(filename);
    if (!id) return undefined;
    const value = this.documents.read(id);
    if (!value)
      throw Object.assign(new Error('Storage document does not exist: ' + id), { code: 'ENOENT' });
    return JSON.stringify(value);
  }

  write(filename: string, text: string): boolean {
    const id = this.documentId(filename);
    if (!id) return false;
    this.assertWritable();
    const scope =
      id === 'stable-config'
        ? 'app-config'
        : id === 'custom-cli-configs' || id === 'config-file-profiles'
          ? id
          : undefined;
    this.database.transaction(() => {
      this.documents.write(id, decodeLegacyFields(JSON.parse(text)));
      if (scope)
        this.database.connection
          .prepare('UPDATE scope_revisions SET revision = revision + 1 WHERE scope = ?')
          .run(scope);
    });
    if (scope) this.hooks.committed?.();
    return true;
  }

  assertWritable(): void {
    if (this.closed) throw new Error('Application storage is closed');
    const admitted = this.activity.getStore();
    if (!this.privileged.getStore()?.open) {
      if (this.unready || (this.restoring && !admitted?.open))
        throw Object.assign(new Error('Application data is being restored'), {
          code: 'RESTORE_IN_PROGRESS',
        });
      if (admitted && admitted.generation !== this.coordinator.version('app-config').generation)
        throw Object.assign(new Error('Discarded result from an old data generation'), {
          code: 'CONFLICT',
        });
    }
  }

  async snapshotDocuments(
    ids: readonly StorageDocumentId[] = Object.keys(STORAGE_DOCUMENT_PATHS) as StorageDocumentId[]
  ): Promise<StorageDocuments> {
    return this.withActivity(async () => {
      await this.hooks.flush?.();
      this.assertWritable();
      const result: StorageDocuments = {};
      this.database.transaction(() => {
        for (const id of ids) {
          const document = this.documents.read(id);
          if (document) result[id] = document;
        }
      });
      return result;
    });
  }

  async restore(input: StorageDocuments, reset: StorageDocumentId[] = []): Promise<void> {
    validateDocumentVersions(input);
    if (!input['stable-config']) throw new Error('Backup is missing stable configuration');
    const prepared = this.prepareDocuments
      ? await this.prepareDocuments(decodeLegacyFields(structuredClone(input)))
      : input;
    input = Object.fromEntries(
      Object.keys(input).map(id => [id, prepared[id as StorageDocumentId]])
    ) as StorageDocuments;
    // Validate relationships in an isolated candidate database before entering maintenance.
    const candidate = new AppDatabase(
      path.join(this.root, 'storage/restore-candidates', randomUUID() + '.db')
    );
    try {
      const store = new DocumentStore(candidate);
      for (const [id, value] of Object.entries(input))
        store.write(id as StorageDocumentId, decodeLegacyFields(value));
    } finally {
      candidate.close();
    }
    await this.maintenance(async () => {
      await this.database.snapshot(
        path.join(this.root, 'storage/restore-backups', randomUUID() + '.db')
      );
      if (input['config-file-profiles']) {
        const revisions = new Map(
          (this.documents.read('config-file-profiles')?.profiles ?? []).map(
            (profile: JsonRecord) => [profile.id, profile.revision ?? 0]
          )
        );
        for (const profile of input['config-file-profiles'].profiles ?? [])
          profile.revision =
            Math.max(profile.revision ?? 0, Number(revisions.get(profile.id) ?? 0)) + 1;
      }
      this.database.transaction(() => {
        if (
          this.database.connection
            .prepare(
              "SELECT 1 FROM app_operations WHERE state IN ('prepared','recovery-required') LIMIT 1"
            )
            .get()
        )
          throw new Error('An unresolved external file operation must be recovered first');
        for (const id of reset) if (!input[id]) this.documents.remove(id);
        for (const [id, value] of Object.entries(input))
          this.documents.write(id as StorageDocumentId, decodeLegacyFields(value));
        this.database.connection
          .prepare('UPDATE scope_revisions SET revision = revision + 1')
          .run();
        this.database.connection
          .prepare(
            'INSERT INTO app_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
          )
          .run(
            'last_restore',
            JSON.stringify({ operationId: randomUUID(), committedAt: Date.now() })
          );
      });
      this.coordinator.invalidateGeneration();
      // Hydration may persist normalized data; the maintenance gate still blocks public mutations.
      try {
        await this.hooks.reload?.();
      } catch (error) {
        this.unready = true;
        throw Object.assign(new Error('Restore committed, but state reload failed'), {
          code: 'RECOVERY_REQUIRED',
          committed: true,
          cause: error,
        });
      }
      this.hooks.changed?.();
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.restoring) throw new Error('Application data is in maintenance');
    this.restoring = true;
    const permit = { open: true };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...this.operations]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Storage shutdown drain timed out')), 30000);
        }),
      ]);
      if (timer) clearTimeout(timer);
      await this.privileged.run(permit, () => this.hooks.flush?.());
      await this.coordinator.close();
      this.closed = true;
      if (active === this) active = undefined;
    } finally {
      if (timer) clearTimeout(timer);
      permit.open = false;
      this.restoring = false;
    }
  }
}

export function getApplicationStorage(): ApplicationStorage | undefined {
  return active;
}
export async function initializeApplicationStorage(
  root: string,
  prepare: (documents: StorageDocuments) => Promise<StorageDocuments>
): Promise<ApplicationStorage> {
  if (active) throw new Error('Application storage was already initialized');
  const database = await AppDatabase.open(path.join(root, 'storage/app.db'), {
    upgradeSnapshot: path.join(root, 'storage/schema-backups', randomUUID() + '.db'),
  });
  const storage = new ApplicationStorage(root, database);
  try {
    await storage.initialize(prepare);
    active = storage;
    return storage;
  } catch (error) {
    database.close();
    throw error;
  }
}

export async function readStorageText(filename: string): Promise<string> {
  const stored = active?.read(filename);
  return stored ?? fs.promises.readFile(filename, 'utf8');
}
export function readStorageTextSync(filename: string): string {
  return active?.read(filename) ?? fs.readFileSync(filename, 'utf8');
}
export function decodeLegacyFields<T>(value: T): T {
  function visit(input: unknown, key = ''): unknown {
    if (
      typeof input === 'string' &&
      input.startsWith('encrypted:') &&
      /^(api_?key|access_?token|system_?token|token|password|key|unifiedApiKey)$/i.test(key)
    )
      return decryptField(input);
    if (Array.isArray(input)) return input.map(item => visit(item, key));
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input).map(([name, item]) => [name, visit(item, name)])
      );
    return input;
  }
  return visit(value) as T;
}
function durableWrite(filename: string, bytes: Buffer): void {
  const fd = fs.openSync(filename, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function validateDocumentVersions(documents: StorageDocuments): void {
  for (const [id, value] of Object.entries(documents)) {
    const version = value.version;
    if (id === 'stable-config') {
      if (
        version !== undefined &&
        (typeof version !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(version))
      )
        throw new Error('Unsupported configuration version');
      if (version && compareVersions(String(version), '3.0.6') > 0)
        throw new Error('Unsupported future configuration version');
    } else if (
      version !== undefined &&
      id !== 'theme-settings' &&
      id !== 'close-behavior-settings' &&
      id !== 'update-settings'
    ) {
      const max = id === 'config-file-profiles' ? 4 : id === 'route-state-affinity' ? 2 : 1;
      if (!/^\d+$/.test(String(version)) || Number(version) > max)
        throw new Error('Unsupported future storage version: ' + id);
    }
  }
}
export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}
