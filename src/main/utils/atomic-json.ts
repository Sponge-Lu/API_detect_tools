import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface AtomicTextWriteOptions {
  encoding?: BufferEncoding;
  mode?: number;
  /** rename 前对临时文件执行 fsync，避免断电/崩溃后 rename 已提交而数据块未落盘（默认开启）。 */
  sync?: boolean;
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

async function syncFileData(tempPath: string): Promise<void> {
  const handle = await fs.open(tempPath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
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
      if (options.sync !== false) {
        await syncFileData(tempPath);
      }
      await renameWithRetries(tempPath, targetPath);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw error;
    }
  });
}

/**
 * 清理残留的临时文件。正常写入流程中临时文件只会存活数毫秒（且按目标路径串行），
 * 超过 maxAgeMs 仍未消失的 .tmp 只能是进程崩溃/断电留下的孤儿。
 */
export async function cleanupStaleTempFiles(
  dirPath: string,
  maxAgeMs: number = 60 * 60 * 1000
): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    return 0;
  }

  const now = Date.now();
  let removed = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.tmp')) {
      continue;
    }
    const tempPath = path.join(dirPath, entry);
    try {
      const stat = await fs.stat(tempPath);
      if (now - stat.mtimeMs < maxAgeMs) {
        continue;
      }
      await fs.unlink(tempPath);
      removed += 1;
    } catch {
      // 单个文件不可触碰不阻塞其余清理
    }
  }
  return removed;
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
