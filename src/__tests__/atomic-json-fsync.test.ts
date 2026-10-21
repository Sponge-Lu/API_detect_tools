/**
 * fsync 行为单独成文件：vitest 对同一路径的 doMock→doUnmock 循环存在注册失效问题，
 * 与 atomic-json.test.ts 的 rename 重试 mock 混在一个文件里会互相污染。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileHandle } from 'fs/promises';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

describe('atomic-json fsync durability', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.doUnmock('fs/promises');
    vi.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-hub-atomic-fsync-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.doUnmock('fs/promises');
    vi.resetModules();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('fsyncs the temp file before rename by default', async () => {
    const actualFs = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    const syncedPaths: string[] = [];
    const open = vi.fn<typeof actualFs.open>().mockImplementation((async (...args: unknown[]) => {
      const handle = await (
        actualFs.open as unknown as (...openArgs: unknown[]) => Promise<FileHandle>
      )(...args);
      const originalSync = handle.sync.bind(handle);
      (handle as { sync: () => Promise<void> }).sync = async () => {
        syncedPaths.push(String(args[0]));
        await originalSync();
      };
      return handle;
    }) as unknown as typeof actualFs.open);

    vi.resetModules();
    vi.doMock('fs/promises', () => ({
      ...actualFs,
      open,
    }));

    const { writeTextFileAtomically } = await import('../main/utils/atomic-json');
    const targetPath = path.join(tempDir, 'synced.json');
    await writeTextFileAtomically(targetPath, 'durable-content');

    expect(syncedPaths).toHaveLength(1);
    // fsync 落在临时文件上，且 rename 后目标文件内容完整
    expect(syncedPaths[0]).not.toBe(targetPath);
    expect(syncedPaths[0]).toContain('.tmp');
    await expect(fs.readFile(targetPath, 'utf-8')).resolves.toBe('durable-content');
    vi.doUnmock('fs/promises');
  });

  it('skips fsync when the sync option is disabled', async () => {
    const actualFs = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    const open = vi.fn<typeof actualFs.open>();

    vi.resetModules();
    vi.doMock('fs/promises', () => ({
      ...actualFs,
      open,
    }));

    const { writeTextFileAtomically } = await import('../main/utils/atomic-json');
    const targetPath = path.join(tempDir, 'no-sync.json');
    await writeTextFileAtomically(targetPath, 'fast-content', { sync: false });

    expect(open).not.toHaveBeenCalled();
    await expect(fs.readFile(targetPath, 'utf-8')).resolves.toBe('fast-content');
    vi.doUnmock('fs/promises');
  });
});
