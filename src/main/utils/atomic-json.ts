import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface AtomicTextWriteOptions {
  encoding?: BufferEncoding;
  mode?: number;
}

export interface AtomicJsonWriteOptions extends AtomicTextWriteOptions {
  space?: string | number;
  trailingNewline?: boolean;
}

export interface ReadJsonOptions<T> {
  defaultValue?: T;
  normalize?: (value: unknown) => T;
}

const TRANSIENT_RENAME_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM']);
const RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400];
const pendingWritesByTarget = new Map<string, Promise<void>>();

function buildTempPath(targetPath: string): string {
  const tempName = [
    path.basename(targetPath),
    process.pid,
    Date.now(),
    randomBytes(6).toString('hex'),
    'tmp',
  ].join('.');
  return path.join(path.dirname(targetPath), tempName);
}

function hasDefaultValue<T>(options: ReadJsonOptions<T>): options is ReadJsonOptions<T> & {
  defaultValue: T;
} {
  return Object.prototype.hasOwnProperty.call(options, 'defaultValue');
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isTransientRenameError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    TRANSIENT_RENAME_ERROR_CODES.has(String(error.code))
  );
}

async function targetIsDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await fs.stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function renameWithRetries(tempPath: string, targetPath: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await fs.rename(tempPath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      const retryDelay = RENAME_RETRY_DELAYS_MS[attempt];
      if (!isTransientRenameError(error) || (await targetIsDirectory(targetPath))) {
        throw error;
      }
      if (retryDelay === undefined) {
        break;
      }
      await delay(retryDelay);
    }
  }

  throw lastError;
}

async function runWriteForTarget(targetPath: string, write: () => Promise<void>): Promise<void> {
  const key = path.resolve(targetPath);
  const previous = pendingWritesByTarget.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(write);
  const tracked = current
    .catch(() => undefined)
    .then(() => {
      if (pendingWritesByTarget.get(key) === tracked) {
        pendingWritesByTarget.delete(key);
      }
    });

  pendingWritesByTarget.set(key, tracked);
  return current;
}

export async function writeTextFileAtomically(
  targetPath: string,
  content: string,
  options: AtomicTextWriteOptions = {}
): Promise<void> {
  await runWriteForTarget(targetPath, async () => {
    const dir = path.dirname(targetPath);
    const tempPath = buildTempPath(targetPath);

    await fs.mkdir(dir, { recursive: true });

    try {
      await fs.writeFile(tempPath, content, {
        encoding: options.encoding ?? 'utf-8',
        mode: options.mode,
      });
      await renameWithRetries(tempPath, targetPath);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw error;
    }
  });
}

export async function writeJsonFileAtomically<T>(
  targetPath: string,
  value: T,
  options: AtomicJsonWriteOptions = {}
): Promise<void> {
  const serialized = JSON.stringify(value, null, options.space ?? 2);

  if (serialized === undefined) {
    throw new Error(`Cannot serialize undefined JSON value for ${targetPath}`);
  }

  await writeTextFileAtomically(
    targetPath,
    options.trailingNewline ? `${serialized}\n` : serialized,
    options
  );
}

export async function readJsonFile<T>(
  targetPath: string,
  options: ReadJsonOptions<T> = {}
): Promise<T> {
  try {
    const raw = await fs.readFile(targetPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return options.normalize ? options.normalize(parsed) : (parsed as T);
  } catch (error) {
    if (isMissingFileError(error) && hasDefaultValue(options)) {
      return options.defaultValue;
    }
    throw error;
  }
}
