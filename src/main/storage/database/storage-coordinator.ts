import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './app-database';
import {
  parseStateVersion,
  type StableScope,
  type StateVersion,
} from '../../../shared/types/app-storage-contract';
export type { StableScope, StateVersion } from '../../../shared/types/app-storage-contract';

export class StorageConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly currentVersion: StateVersion) {
    super('Stored data changed; reload before saving');
  }
}

export class StorageMaintenanceError extends Error {
  readonly code = 'RESTORE_IN_PROGRESS';
  constructor() {
    super('Application storage is in maintenance');
  }
}

export class StorageCoordinator {
  private generation = randomUUID();
  private pending: Promise<void> = Promise.resolve();
  private maintenance = false;
  private closed = false;

  constructor(private readonly database: AppDatabase) {}

  version(scope: StableScope): StateVersion {
    const row = this.database.connection
      .prepare('SELECT revision FROM scope_revisions WHERE scope = ?')
      .get(scope) as { revision: number } | undefined;
    if (!row) throw new Error('Unknown stable storage scope');
    return { generation: this.generation, scope, revision: row.revision };
  }

  mutate<T>(
    scope: StableScope,
    expected: StateVersion,
    operation: () => T
  ): Promise<{ data: T; version: StateVersion }> {
    return this.mutateScopes([scope], [expected], operation).then(result => ({
      data: result.data,
      version: result.versions[0],
    }));
  }

  mutateScopes<T>(
    scopes: readonly StableScope[],
    expected: readonly StateVersion[],
    operation: () => T
  ): Promise<{ data: T; versions: StateVersion[] }> {
    if (this.maintenance) return Promise.reject(new StorageMaintenanceError());
    if (this.closed) return Promise.reject(new Error('Application storage is closed'));
    const admittedScopes = [...scopes];
    let admittedVersions: StateVersion[];
    try {
      admittedVersions = expected.map(parseStateVersion);
    } catch (error) {
      return Promise.reject(error);
    }
    if (
      admittedScopes.length === 0 ||
      new Set(admittedScopes).size !== admittedScopes.length ||
      admittedVersions.length !== admittedScopes.length
    ) {
      return Promise.reject(new Error('Mutation scopes must be nonempty, unique and versioned'));
    }
    const result = this.pending.then(() => {
      return this.database.transaction(() => {
        for (const [index, scope] of admittedScopes.entries()) {
          const current = this.version(scope);
          const version = admittedVersions[index];
          if (
            version.generation !== current.generation ||
            version.scope !== current.scope ||
            version.revision !== current.revision
          )
            throw new StorageConflictError(current);
        }
        if (operation.constructor.name === 'AsyncFunction')
          throw new Error('Storage mutations must be synchronous');
        const data = operation();
        if (data && typeof (data as { then?: unknown }).then === 'function') {
          throw new Error('Storage mutations cannot return a promise');
        }
        for (const scope of admittedScopes) {
          this.database.connection
            .prepare('UPDATE scope_revisions SET revision = revision + 1 WHERE scope = ?')
            .run(scope);
        }
        return { data, versions: admittedScopes.map(scope => this.version(scope)) };
      });
    });
    this.pending = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async maintain<T>(operation: () => Promise<T>, timeoutMs = 30000): Promise<T> {
    if (this.maintenance) throw new StorageMaintenanceError();
    if (this.closed) throw new Error('Application storage is closed');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new Error('Maintenance timeout must be positive');
    this.maintenance = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.pending,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Storage maintenance drain timed out')),
            timeoutMs
          );
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      return await operation();
    } finally {
      if (timeout) clearTimeout(timeout);
      this.maintenance = false;
    }
  }

  invalidateGeneration(): void {
    if (!this.maintenance) throw new Error('Generation changes require maintenance');
    this.generation = randomUUID();
  }

  async close(): Promise<void> {
    if (this.maintenance) throw new StorageMaintenanceError();
    this.closed = true;
    await this.pending;
    this.database.close();
  }
}
