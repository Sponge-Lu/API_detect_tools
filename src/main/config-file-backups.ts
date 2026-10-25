import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { writeTextFileAtomically } from './utils/atomic-json';
import type { ConfigFileBackup } from '../shared/types/config-file-profile';
import { encodePayload, decodePayload } from './storage/database/payload-codec';

export const CONFIG_BACKUP_RETENTION = 10;
const snapshots = /^\d+-[0-9a-f-]{36}\.bak$/;
const importedSnapshots = /^\d+-[0-9a-f]{64}\.legacy\.bak$/;
const pending = new Map<string, Promise<void>>();
const digest = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
const protectedPrefix = 'api-hub-cli-backup:v1\n';
const protectBackup = (content: string) => protectedPrefix + encodePayload(content);
function readBackup(buffer: Buffer): string {
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer)) throw new Error('备份不是有效的 UTF-8 文本');
  if (!text.startsWith(protectedPrefix)) return text;
  const content = decodePayload<unknown>(text.slice(protectedPrefix.length));
  if (typeof content !== 'string') throw new Error('Invalid client backup content');
  return content;
}

export function getConfigFileBackupDirectory(): string {
  return path.join(app.getPath('userData'), 'backups', 'cli-config');
}

function backupDirectory(filePath: string): string {
  return path.join(getConfigFileBackupDirectory(), digest(path.resolve(filePath)));
}

async function assertBackupDirectorySafe(filePath: string): Promise<void> {
  const root = app.getPath('userData');
  for (
    let current = backupDirectory(filePath);
    current !== path.dirname(root);
    current = path.dirname(current)
  ) {
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('备份目录必须是普通目录');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (current === root) break;
  }
}

async function assertBackupSource(filePath: string, required: boolean): Promise<void> {
  const directory = backupDirectory(filePath);
  const filename = path.join(directory, 'source.json');
  try {
    if (!(await fs.lstat(filename)).isFile()) throw new Error('备份来源记录必须是普通文件');
    const source = JSON.parse(await fs.readFile(filename, 'utf8'));
    const resolved = path.resolve(filePath);
    if (
      source.path !== resolved ||
      path.basename(directory) !== digest(resolved) ||
      (source.pathHash !== undefined && source.pathHash !== digest(resolved))
    )
      throw new Error('备份来源与配置文件不匹配');
  } catch (error) {
    if (required || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function withBackupLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const key = backupDirectory(filePath);
  const current = (pending.get(key) ?? Promise.resolve()).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined
  );
  pending.set(key, settled);
  void settled.then(() => {
    if (pending.get(key) === settled) pending.delete(key);
  });
  return current;
}

async function prepareDirectory(filePath: string, original: string): Promise<string> {
  const directory = backupDirectory(filePath);
  await assertBackupDirectorySafe(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await assertBackupSource(filePath, false);
  try {
    if (!(await fs.lstat(path.join(directory, 'original'))).isFile())
      throw new Error('原始备份必须是普通文件');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeTextFileAtomically(path.join(directory, 'original'), protectBackup(original), {
      mode: 0o600,
    });
  }
  await writeTextFileAtomically(
    path.join(directory, 'source.json'),
    JSON.stringify({ path: path.resolve(filePath), pathHash: digest(path.resolve(filePath)) }),
    { mode: 0o600 }
  );
  return directory;
}

export async function backupConfigFile(filePath: string, content: string): Promise<void> {
  return withBackupLock(filePath, async () => {
    const directory = await prepareDirectory(filePath, content);
    await writeTextFileAtomically(
      path.join(directory, `${Date.now()}-${randomUUID()}.bak`),
      protectBackup(content),
      { mode: 0o600 }
    );
    const names = (await fs.readdir(directory))
      .filter(name => snapshots.test(name))
      .sort()
      .reverse();
    for (const name of names.slice(CONFIG_BACKUP_RETENTION))
      await fs.unlink(path.join(directory, name));
  });
}

export async function listConfigFileBackups(filePath: string): Promise<ConfigFileBackup[]> {
  return withBackupLock(filePath, async () => {
    await assertBackupDirectorySafe(filePath);
    const directory = backupDirectory(filePath);
    let names: string[];
    try {
      names = await fs.readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    await assertBackupSource(filePath, true);
    const entries: ConfigFileBackup[] = [];
    for (const id of names.filter(
      name => name === 'original' || snapshots.test(name) || importedSnapshots.test(name)
    )) {
      const filename = path.join(directory, id);
      const stat = await fs.lstat(filename);
      if (!stat.isFile()) throw new Error('备份必须是普通文件');
      const content = await fs.readFile(filename);
      entries.push({
        id,
        kind: id === 'original' ? 'original' : importedSnapshots.test(id) ? 'legacy' : 'snapshot',
        createdAt: id === 'original' ? stat.mtimeMs : Number(id.split('-')[0]),
        size: content.length,
        sha256: digest(content),
      });
    }
    return entries.sort(
      (left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id)
    );
  });
}

export async function readConfigFileBackup(
  filePath: string,
  backupId: string,
  expectedHash: string
): Promise<string> {
  return withBackupLock(filePath, async () => {
    if (backupId !== 'original' && !snapshots.test(backupId) && !importedSnapshots.test(backupId))
      throw new Error('备份标识无效');
    await assertBackupDirectorySafe(filePath);
    await assertBackupSource(filePath, true);
    const filename = path.join(backupDirectory(filePath), backupId);
    if (!(await fs.lstat(filename)).isFile()) throw new Error('备份必须是普通文件');
    const content = await fs.readFile(filename);
    if (digest(content) !== expectedHash) throw new Error('备份内容已变化，请重新加载备份列表');
    return readBackup(content);
  });
}

export async function migrateLegacyConfigBackups(filePaths: string[]): Promise<number> {
  let migrated = 0;
  for (const filePath of new Set(filePaths.map(value => path.resolve(value)))) {
    migrated += await withBackupLock(filePath, async () => {
      let names: string[];
      try {
        names = await fs.readdir(path.dirname(filePath));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
        throw error;
      }
      const prefix = `${path.basename(filePath)}.bak.`;
      const legacy = names
        .filter(name => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)))
        .sort(
          (left, right) => Number(left.slice(prefix.length)) - Number(right.slice(prefix.length))
        );
      let count = 0;
      for (const name of legacy) {
        const source = path.join(path.dirname(filePath), name);
        if (!(await fs.lstat(source)).isFile()) continue;
        const content = await fs.readFile(source);
        const text = content.toString('utf8');
        if (!Buffer.from(text, 'utf8').equals(content))
          throw new Error(`旧备份不是有效的 UTF-8 文本，已保留原文件: ${source}`);
        const directory = await prepareDirectory(filePath, text);
        const id = `${name.slice(prefix.length)}-${digest(content)}.legacy.bak`;
        const destination = path.join(directory, id);
        await writeTextFileAtomically(destination, protectBackup(text), { mode: 0o600 });
        if (!Buffer.from(readBackup(await fs.readFile(destination)), 'utf8').equals(content))
          throw new Error(`旧备份归档校验失败，已保留原文件: ${source}`);
        // Imported history is kept outside automatic snapshot rotation.
        if (!(await fs.lstat(source)).isFile() || !(await fs.readFile(source)).equals(content))
          throw new Error(`旧备份在迁移期间发生变化，已保留原文件: ${source}`);
        await fs.unlink(source);
        count += 1;
      }
      return count;
    });
  }
  return migrated;
}
