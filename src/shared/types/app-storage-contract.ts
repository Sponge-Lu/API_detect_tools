export const STABLE_STORAGE_SCOPES = [
  'app-config',
  'custom-cli-configs',
  'config-file-profiles',
] as const;
export type StableScope = (typeof STABLE_STORAGE_SCOPES)[number];

export interface StateVersion {
  readonly generation: string;
  readonly scope: StableScope;
  readonly revision: number;
}

export type StorageErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PERSISTENCE_ERROR'
  | 'RESTORE_IN_PROGRESS'
  | 'UNSUPPORTED_VERSION'
  | 'LEGACY_WRITE_DISABLED'
  | 'INVALID_BACKUP'
  | 'RECOVERY_REQUIRED'
  | 'DECRYPTION_ERROR'
  | 'DATABASE_BUSY'
  | 'MIGRATION_FAILED';

export type StorageCommandResult<T> =
  | { success: true; data: T; version: StateVersion; warnings?: string[] }
  | {
      success: false;
      error: {
        code: StorageErrorCode;
        message: string;
        currentVersion?: StateVersion;
        committed?: boolean;
      };
    };

export interface VersionedStorageSnapshot<T> {
  data: T;
  version: StateVersion;
}

export function parseStateVersion(value: unknown): StateVersion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid storage version');
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 3 ||
    typeof input.generation !== 'string' ||
    input.generation.length === 0 ||
    !STABLE_STORAGE_SCOPES.includes(input.scope as StableScope) ||
    typeof input.revision !== 'number' ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0
  ) {
    throw new Error('Invalid storage version');
  }
  return {
    generation: input.generation,
    scope: input.scope as StableScope,
    revision: input.revision,
  };
}
