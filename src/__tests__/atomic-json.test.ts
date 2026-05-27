import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

describe('atomic-json utilities', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.doUnmock('fs/promises');
    vi.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-hub-atomic-json-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.doUnmock('fs/promises');
    vi.resetModules();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes parseable JSON atomically and creates parent directories', async () => {
    const { writeJsonFileAtomically } = await import('../main/utils/atomic-json');
    const targetPath = path.join(tempDir, 'nested', 'config.json');

    await writeJsonFileAtomically(targetPath, { version: '1', sites: [{ id: 'site-1' }] });

    const parsed = JSON.parse(await fs.readFile(targetPath, 'utf-8'));
    const siblingFiles = await fs.readdir(path.dirname(targetPath));

    expect(parsed).toEqual({ version: '1', sites: [{ id: 'site-1' }] });
    expect(siblingFiles).toEqual(['config.json']);
  });

  it('reads JSON with a missing-file default and optional normalization', async () => {
    const { readJsonFile, writeJsonFileAtomically } = await import('../main/utils/atomic-json');
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

  it('retries transient rename failures and does not overwrite on persistent failures', async () => {
    const retryTargetPath = path.join(tempDir, 'route-probes-retry.json');
    const persistentTargetPath = path.join(tempDir, 'route-probes-persist.json');
    const actualFs = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    const renameError = Object.assign(new Error('target file is temporarily locked'), {
      code: 'EPERM',
    });
    let retryFailures = 0;
    const rename = vi.fn<typeof actualFs.rename>().mockImplementation((oldPath, newPath) => {
      if (String(newPath) === retryTargetPath && retryFailures === 0) {
        retryFailures += 1;
        return Promise.reject(renameError);
      }
      if (String(newPath) === persistentTargetPath) {
        return Promise.reject(renameError);
      }
      return actualFs.rename(oldPath, newPath);
    });

    vi.resetModules();
    vi.doMock('fs/promises', () => ({
      ...actualFs,
      rename,
    }));

    const { writeTextFileAtomically: writeWithMockedRename } = await import(
      '../main/utils/atomic-json'
    );

    await writeWithMockedRename(retryTargetPath, 'probe-state');

    await expect(fs.readFile(retryTargetPath, 'utf-8')).resolves.toBe('probe-state');
    expect(rename).toHaveBeenCalledTimes(2);

    await actualFs.writeFile(persistentTargetPath, 'old-state', 'utf-8');
    await expect(writeWithMockedRename(persistentTargetPath, 'new-state')).rejects.toThrow(
      'target file is temporarily locked'
    );

    await expect(fs.readFile(persistentTargetPath, 'utf-8')).resolves.toBe('old-state');
    const siblingFiles = await fs.readdir(path.dirname(persistentTargetPath));
    expect(siblingFiles.sort()).toEqual(['route-probes-persist.json', 'route-probes-retry.json']);
    expect(rename).toHaveBeenCalledTimes(8);
    vi.doUnmock('fs/promises');
  });

  it('serializes concurrent writes to the same target path', async () => {
    const { writeJsonFileAtomically } = await import('../main/utils/atomic-json');
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
    const { writeTextFileAtomically } = await import('../main/utils/atomic-json');
    const targetPath = path.join(tempDir, 'existing-directory');
    await fs.mkdir(targetPath);

    await expect(writeTextFileAtomically(targetPath, 'content')).rejects.toThrow();

    const files = await fs.readdir(tempDir);
    expect(files.filter(file => file.startsWith('existing-directory.'))).toEqual([]);
  });
});
