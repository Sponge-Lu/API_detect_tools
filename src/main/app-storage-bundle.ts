import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import {
  APP_STORAGE_MANIFEST_VERSION,
  APP_STORAGE_ENTRIES,
  type AppStorageBackupMode,
  type AppStorageEntry,
  type AppStorageRoots,
  resolveAppStorageEntryPath,
} from './app-storage-manifest';
import { writeTextFileAtomically } from './utils/atomic-json';

export const APP_STORAGE_BUNDLE_FORMAT = 'api-hub-storage-bundle';
export const APP_STORAGE_BUNDLE_VERSION = 1;

export type AppStorageBundleMode = 'full-manifest' | 'portable-config';
export type AppStorageBundleFileEncoding = 'utf8' | 'base64';

export interface AppStorageBundleFile {
  entryId: string;
  relativePath: string;
  encoding: AppStorageBundleFileEncoding;
  content: string;
  size: number;
  sha256: string;
  modifiedAt?: number;
}

export interface AppStorageBundle {
  format: typeof APP_STORAGE_BUNDLE_FORMAT;
  version: number;
  manifestVersion: number;
  mode: AppStorageBundleMode;
  createdAt: number;
  files: AppStorageBundleFile[];
}

export interface RestoreStorageBackupResult {
  kind: 'storage-bundle' | 'legacy-config';
  mode?: AppStorageBundleMode;
  restoredFiles: string[];
}

export interface CreateAppStorageBundleOptions {
  mode?: AppStorageBundleMode;
  roots?: AppStorageRoots;
}

function getLocalAppDataPath(): string | undefined {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  }

  return undefined;
}

export function getCurrentAppStorageRoots(): AppStorageRoots {
  return {
    userData: app.getPath('userData'),
    home: os.homedir(),
    temp: os.tmpdir(),
    localAppData: getLocalAppDataPath(),
  };
}

function getEntriesForBackupMode(mode: AppStorageBackupMode): AppStorageEntry[] {
  return APP_STORAGE_ENTRIES.filter(
    entry => entry.backup.defaultIncluded && entry.backup.modes.includes(mode)
  );
}

function getFullManifestEntries(): AppStorageEntry[] {
  return getEntriesForBackupMode('full-manifest');
}

function getPortableConfigEntries(): AppStorageEntry[] {
  return getEntriesForBackupMode('portable-config');
}

function getEntriesForBundleMode(mode: AppStorageBundleMode): AppStorageEntry[] {
  return mode === 'portable-config' ? getPortableConfigEntries() : getFullManifestEntries();
}

/**
 * 恢复前允许清理的 managed 文件。
 * - full-manifest：清理默认 full-manifest 文件 + runtime sidecars（custom-cli 缺失时保留本机文件）
 * - portable-config：只恢复 config + custom-cli，不得 wipe 本机 runtime/settings
 */
function getRestoreWipeEntries(mode: AppStorageBundleMode): AppStorageEntry[] {
  if (mode === 'portable-config') {
    return getPortableConfigEntries().filter(entry => entry.id !== 'custom-cli-configs');
  }

  return uniqueEntries([
    ...getFullManifestEntries().filter(entry => entry.id !== 'custom-cli-configs'),
    ...getRuntimeRestoreEntries(),
  ]);
}

function getRuntimeRestoreEntries(): AppStorageEntry[] {
  return APP_STORAGE_ENTRIES.filter(entry =>
    ['runtime-cache', 'runtime-state', 'statistics'].includes(entry.kind)
  );
}

function uniqueEntries(entries: AppStorageEntry[]): AppStorageEntry[] {
  return Array.from(new Map(entries.map(entry => [entry.id, entry])).values());
}

function buildRelativePath(entry: AppStorageEntry): string {
  return entry.pathSegments.join('/');
}

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isDirectoryError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EISDIR';
}

function assertConfigShape(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('备份中的 config.json 根对象无效');
  }

  if (!Array.isArray((value as { sites?: unknown }).sites)) {
    throw new Error('备份中的 config.json 缺少有效的 sites 数组');
  }
}

function decodeBundleFile(file: AppStorageBundleFile): Buffer {
  if (file.encoding === 'base64') {
    return Buffer.from(file.content, 'base64');
  }

  if (file.encoding === 'utf8') {
    return Buffer.from(file.content, 'utf-8');
  }

  throw new Error(`不支持的备份文件编码: ${String(file.encoding)}`);
}

function assertBundleFileHash(file: AppStorageBundleFile, buffer: Buffer): void {
  const actualHash = hashBuffer(buffer);
  if (actualHash !== file.sha256) {
    throw new Error(`备份文件校验失败: ${file.relativePath}`);
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isAppStorageBundle(value: unknown): value is AppStorageBundle {
  return (
    isObjectRecord(value) &&
    value.format === APP_STORAGE_BUNDLE_FORMAT &&
    value.version === APP_STORAGE_BUNDLE_VERSION &&
    value.manifestVersion === APP_STORAGE_MANIFEST_VERSION &&
    (value.mode === 'full-manifest' || value.mode === 'portable-config') &&
    Array.isArray(value.files)
  );
}

async function collectBundleFiles(
  mode: AppStorageBundleMode,
  roots: AppStorageRoots
): Promise<AppStorageBundleFile[]> {
  const files: AppStorageBundleFile[] = [];

  for (const entry of getEntriesForBundleMode(mode)) {
    const absolutePath = resolveAppStorageEntryPath(entry, roots);
    if (!absolutePath) {
      continue;
    }

    let buffer: Buffer;
    let stat;
    try {
      [buffer, stat] = await Promise.all([fs.readFile(absolutePath), fs.stat(absolutePath)]);
    } catch (error) {
      if (isMissingFile(error) || isDirectoryError(error)) {
        continue;
      }
      throw error;
    }

    files.push({
      entryId: entry.id,
      relativePath: buildRelativePath(entry),
      encoding: 'utf8',
      content: buffer.toString('utf-8'),
      size: buffer.byteLength,
      sha256: hashBuffer(buffer),
      modifiedAt: stat.mtimeMs,
    });
  }

  return files;
}

export async function createAppStorageBundle(
  rootsOrOptions: AppStorageRoots | CreateAppStorageBundleOptions = {}
): Promise<AppStorageBundle> {
  const options: CreateAppStorageBundleOptions =
    'userData' in rootsOrOptions
      ? { roots: rootsOrOptions, mode: 'full-manifest' }
      : rootsOrOptions;
  const mode = options.mode ?? 'full-manifest';
  const roots = options.roots ?? getCurrentAppStorageRoots();
  const files = await collectBundleFiles(mode, roots);

  return {
    format: APP_STORAGE_BUNDLE_FORMAT,
    version: APP_STORAGE_BUNDLE_VERSION,
    manifestVersion: APP_STORAGE_MANIFEST_VERSION,
    mode,
    createdAt: Date.now(),
    files,
  };
}

export function serializeAppStorageBundle(bundle: AppStorageBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export async function createAppStorageBundleContent(
  rootsOrOptions: AppStorageRoots | CreateAppStorageBundleOptions = {}
): Promise<string> {
  return serializeAppStorageBundle(await createAppStorageBundle(rootsOrOptions));
}

/** 创建可迁移 2 文件包：config.json + custom-cli-configs.json */
export async function createPortableAppStorageBundleContent(
  roots: AppStorageRoots = getCurrentAppStorageRoots()
): Promise<string> {
  return createAppStorageBundleContent({ mode: 'portable-config', roots });
}

export function extractStableConfigFromBackupContent(content: string): unknown {
  const parsed = JSON.parse(content);

  if (!isAppStorageBundle(parsed)) {
    assertConfigShape(parsed);
    return parsed;
  }

  const configFile = parsed.files.find(file => file.entryId === 'stable-config');
  if (!configFile) {
    throw new Error('备份包缺少 stable-config');
  }

  const buffer = decodeBundleFile(configFile);
  assertBundleFileHash(configFile, buffer);
  const config = JSON.parse(buffer.toString('utf-8'));
  assertConfigShape(config);
  return config;
}

async function removeEntries(entries: AppStorageEntry[], roots: AppStorageRoots): Promise<void> {
  await Promise.all(
    entries.map(async entry => {
      const absolutePath = resolveAppStorageEntryPath(entry, roots);
      if (!absolutePath) {
        return;
      }
      await fs.rm(absolutePath, { force: true, recursive: false }).catch(error => {
        if (!isMissingFile(error)) {
          throw error;
        }
      });
    })
  );
}

async function restoreBundle(
  bundle: AppStorageBundle,
  roots: AppStorageRoots
): Promise<RestoreStorageBackupResult> {
  // 允许恢复的文件集合：
  // - full-manifest：full-manifest 默认条目
  // - portable-config：portable 2 文件 + 兼容旧 full-manifest 中可能出现的条目（但 wipe 策略按 mode）
  const allowedEntries = new Map(
    uniqueEntries([...getFullManifestEntries(), ...getPortableConfigEntries()]).map(entry => [
      entry.id,
      entry,
    ])
  );
  const restoredFiles: string[] = [];
  const seenEntryIds = new Set<string>();
  const decodedFiles: Array<{
    entry: AppStorageEntry;
    file: AppStorageBundleFile;
    buffer: Buffer;
  }> = [];

  const stableConfig = bundle.files.find(file => file.entryId === 'stable-config');
  if (!stableConfig) {
    throw new Error('备份包缺少 stable-config');
  }

  extractStableConfigFromBackupContent(JSON.stringify(bundle));

  for (const file of bundle.files) {
    const entry = allowedEntries.get(file.entryId);
    if (!entry) {
      throw new Error(`备份包包含不允许恢复的文件: ${file.relativePath}`);
    }
    if (seenEntryIds.has(file.entryId)) {
      throw new Error(`备份包包含重复文件: ${file.relativePath}`);
    }
    seenEntryIds.add(file.entryId);

    const buffer = decodeBundleFile(file);
    assertBundleFileHash(file, buffer);
    decodedFiles.push({ entry, file, buffer });
  }

  await removeEntries(getRestoreWipeEntries(bundle.mode), roots);

  for (const { entry, buffer } of decodedFiles) {
    const absolutePath = resolveAppStorageEntryPath(entry, roots);
    if (!absolutePath) {
      continue;
    }

    await writeTextFileAtomically(absolutePath, buffer.toString('utf-8'));
    restoredFiles.push(absolutePath);
  }

  return { kind: 'storage-bundle', mode: bundle.mode, restoredFiles };
}

async function restoreLegacyConfig(
  content: string,
  targetConfigPath: string
): Promise<RestoreStorageBackupResult> {
  const parsed = JSON.parse(content);
  assertConfigShape(parsed);
  await writeTextFileAtomically(targetConfigPath, `${JSON.stringify(parsed, null, 2)}\n`);
  return { kind: 'legacy-config', restoredFiles: [targetConfigPath] };
}

export async function restoreAppStorageBackupContent(
  content: string,
  targetConfigPath: string,
  roots: AppStorageRoots = getCurrentAppStorageRoots()
): Promise<RestoreStorageBackupResult> {
  const parsed = JSON.parse(content);

  if (isAppStorageBundle(parsed)) {
    return restoreBundle(parsed, roots);
  }

  return restoreLegacyConfig(content, targetConfigPath);
}
