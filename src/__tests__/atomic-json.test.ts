import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  readJsonFile,
  writeJsonFileAtomically,
  writeTextFileAtomically,
} from '../main/utils/atomic-json';

describe('atomic-json utilities', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-hub-atomic-json-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.doUnmock('fs/promises');
    vi.resetModules();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes parseable JSON atomically and creates parent directories', async () => {
    const targetPath = path.join(tempDir, 'nested', 'config.json');

    await writeJsonFileAtomically(targetPath, { version: '1', sites: [{ id: 'site-1' }] });

    const parsed = JSON.parse(await fs.readFile(targetPath, 'utf-8'));
    const siblingFiles = await fs.readdir(path.dirname(targetPath));

    expect(parsed).toEqual({ version: '1', sites: [{ id: 'site-1' }] });
    expect(siblingFiles).toEqual(['config.json']);
  });

  it('reads JSON with a missing-file default and optional normalization', async () => {
    const targetPath = path.join(tempDir, 'state.json');

    await expect(readJsonFile(targetPath, { defaultValue: { count: 0 } })).resolves.toEqual({
      count: 0,
    });

    await writeJsonFileAtomically(targetPath, { count: '2' });

    await expect(
      readJsonFile(targetPath, {
        normalize: value => ({ count: Number((value as { count?: unknown }).count ?? 0) }),
      })
    ).resolves.toEqual({ count: 2 });
  });

  it('retries transient rename failures before surfacing a save error', async () => {
    const targetPath = path.join(tempDir, 'route-probes.json');
    const actualFs = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    const renameError = Object.assign(new Error('target file is temporarily locked'), {
      code: 'EPERM',
    });
    const rename = vi
      .fn<typeof actualFs.rename>()
      .mockRejectedValueOnce(renameError)
      .mockImplementation((oldPath, newPath) => actualFs.rename(oldPath, newPath));

    vi.resetModules();
    vi.doMock('fs/promises', () => ({
      ...actualFs,
      rename,
    }));

    const { writeTextFileAtomically: writeWithMockedRename } = await import(
      '../main/utils/atomic-json'
    );

    await writeWithMockedRename(targetPath, 'probe-state');

    await expect(fs.readFile(targetPath, 'utf-8')).resolves.toBe('probe-state');
    expect(rename).toHaveBeenCalledTimes(2);
    vi.doUnmock('fs/promises');
  });

  it('serializes concurrent writes to the same target path', async () => {
    const targetPath = path.join(tempDir, 'state', 'route-probes.json');

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        writeJsonFileAtomically(targetPath, { version: 1, index })
      )
    );

    const parsed = JSON.parse(await fs.readFile(targetPath, 'utf-8'));
    const siblingFiles = await fs.readdir(path.dirname(targetPath));

    expect(parsed).toMatchObject({ version: 1 });
    expect(typeof parsed.index).toBe('number');
    expect(siblingFiles).toEqual(['route-probes.json']);
  });

  it('removes temporary files when the final replace fails', async () => {
    const targetPath = path.join(tempDir, 'existing-directory');
    await fs.mkdir(targetPath);

    await expect(writeTextFileAtomically(targetPath, 'content')).rejects.toThrow();

    const files = await fs.readdir(tempDir);
    expect(files.filter(file => file.startsWith('existing-directory.'))).toEqual([]);
  });
});
