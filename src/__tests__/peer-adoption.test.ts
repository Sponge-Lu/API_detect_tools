import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

const state = vi.hoisted(() => ({ userData: '', spawn: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => state.userData }, net: {}, shell: {} }));
vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, default: { ...actual, spawn: state.spawn }, spawn: state.spawn };
});
vi.mock('../main/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import { rectifyRejectedRequest } from '../main/request-rectifier';
import {
  backupConfigFile,
  listConfigFileBackups,
  migrateLegacyConfigBackups,
  readConfigFileBackup,
} from '../main/config-file-backups';
import { omitBackupSecrets } from '../main/app-storage-bundle';
import {
  classifyUpstreamFailure,
  failureClassToOutcome,
  resolveRoutePathDisabledReason,
} from '../main/route-upstream-failure';
import { parseModelMetadata } from '../main/model-metadata-service';
import { UpdateService } from '../main/update-service';

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-adoption-'));
  directories.push(value);
  state.userData = value;
  return value;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const value of directories.splice(0)) await fs.rm(value, { recursive: true, force: true });
});

describe('peer adoption safety boundaries', () => {
  it('repairs signed thinking while preserving tool arguments and the original payload', () => {
    const payload = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'history', signature: 'foreign' },
            { type: 'tool_use', input: { signature: 'user-value', encrypted_content: 'keep' } },
          ],
        },
      ],
    };
    const body = Buffer.from(JSON.stringify(payload));
    const fixed = rectifyRejectedRequest(
      body,
      400,
      Buffer.from('Invalid signature in thinking block')
    );
    expect(fixed?.kind).toBe('signature');
    expect(JSON.parse(fixed!.body.toString()).messages[0].content).toEqual([
      { type: 'text', text: 'history' },
      payload.messages[0].content[1],
    ]);
    expect(JSON.parse(body.toString())).toEqual(payload);
    expect(rectifyRejectedRequest(body, 500, Buffer.from('Invalid signature'))).toBeUndefined();
    expect(rectifyRejectedRequest(body, 400, Buffer.from('Invalid model'))).toBeUndefined();
    expect(
      rectifyRejectedRequest(fixed!.body, 400, Buffer.from('Invalid signature'))
    ).toBeUndefined();
  });

  it('downgrades rejected thinking settings and removes only opaque protocol blocks', () => {
    expect(
      JSON.parse(
        rectifyRejectedRequest(
          Buffer.from('{"thinking":{"budget_tokens":10},"max_tokens":5}'),
          400,
          Buffer.from('thinking budget must be less than max_tokens')
        )!.body.toString()
      )
    ).toEqual({ max_tokens: 5 });
    const input = [
      { type: 'reasoning', encrypted_content: 'opaque' },
      { type: 'message', content: [{ type: 'input_text', text: 'keep' }] },
    ];
    const repaired = rectifyRejectedRequest(
      Buffer.from(JSON.stringify({ input })),
      400,
      Buffer.from('encrypted_content rejected')
    );
    expect(JSON.parse(repaired!.body.toString())).toEqual({ input: [input[1]] });
  });

  it('retains the original and ten recent snapshots away from CLI directories', async () => {
    const root = await directory();
    const target = path.join(root, 'cli', 'settings.json');
    await fs.mkdir(path.dirname(target));
    for (let index = 0; index < 15; index++) await backupConfigFile(target, String(index));
    const [key] = await fs.readdir(path.join(root, 'backups', 'cli-config'));
    const backup = path.join(root, 'backups', 'cli-config', key);
    expect(await fs.readFile(path.join(backup, 'original'), 'utf8')).toMatch(
      /^api-hub-cli-backup:v1\n/
    );
    const original = (await listConfigFileBackups(target)).find(
      entry => entry.kind === 'original'
    )!;
    expect(await readConfigFileBackup(target, original.id, original.sha256)).toBe('0');
    expect((await fs.readdir(backup)).filter(name => name.endsWith('.bak'))).toHaveLength(10);
    expect(await fs.readdir(path.dirname(target))).toEqual([]);
    await fs.writeFile(`${target}.bak.123`, 'legacy', 'utf8');
    await fs.writeFile(`${target}.bak.custom`, 'unrelated', 'utf8');
    expect(await migrateLegacyConfigBackups([target])).toBe(1);
    expect(await fs.readdir(path.dirname(target))).toEqual(['settings.json.bak.custom']);
  });

  it('archives all legacy history numerically and verifies selected backup bytes', async () => {
    const root = await directory();
    const target = path.join(root, 'settings.json');
    for (const timestamp of [9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]) {
      await fs.writeFile(`${target}.bak.${timestamp}`, String(timestamp), 'utf8');
    }
    expect(await migrateLegacyConfigBackups([target])).toBe(12);
    expect(await migrateLegacyConfigBackups([target])).toBe(0);
    await Promise.all(
      Array.from({ length: 15 }, (_, index) => backupConfigFile(target, String(index)))
    );
    const entries = await listConfigFileBackups(target);
    expect(entries.filter(entry => entry.kind === 'legacy')).toHaveLength(12);
    expect(entries.filter(entry => entry.kind === 'snapshot')).toHaveLength(10);
    const original = entries.find(entry => entry.kind === 'original')!;
    expect(await readConfigFileBackup(target, original.id, original.sha256)).toBe('9');
    const archived = entries.find(entry => entry.kind === 'legacy')!;
    const [key] = await fs.readdir(path.join(root, 'backups', 'cli-config'));
    await fs.writeFile(
      path.join(root, 'backups', 'cli-config', key, archived.id),
      'changed',
      'utf8'
    );
    await expect(readConfigFileBackup(target, archived.id, archived.sha256)).rejects.toThrow(
      '已变化'
    );
    await expect(readConfigFileBackup(target, '../original', original.sha256)).rejects.toThrow(
      '标识'
    );
  }, 15000);

  it('keeps unreadable legacy bytes at the source rather than deleting them', async () => {
    const root = await directory();
    const target = path.join(root, 'settings.json');
    const bytes = Buffer.from([0xff, 0xfe, 0x80]);
    await fs.writeFile(`${target}.bak.1`, bytes);
    await expect(migrateLegacyConfigBackups([target])).rejects.toThrow('UTF-8');
    expect(await fs.readFile(`${target}.bak.1`)).toEqual(bytes);
  });

  it('recovers corrupt metadata caches, honors TTL and keeps data when offline', async () => {
    const root = await directory();
    await fs.writeFile(path.join(root, 'model-metadata.json'), '{broken', 'utf8');
    vi.resetModules();
    const metadata = await import('../main/model-metadata-service');
    const axiosClient = (await import('axios')).default;
    const get = vi.spyOn(axiosClient, 'get').mockResolvedValue({
      data: { lab: { models: { model: { limit: { context: 1234 } } } } },
    });
    await metadata.refreshModelMetadata();
    expect(metadata.getModelMetadata('model')?.context).toBe(1234);
    await metadata.refreshModelMetadata();
    expect(get).toHaveBeenCalledTimes(1);
    await metadata.refreshModelMetadata(true);
    expect(get).toHaveBeenCalledTimes(2);
    await Promise.all([
      metadata.refreshModelMetadata(true),
      metadata.refreshModelMetadata(true),
      metadata.refreshModelMetadata(true),
    ]);
    expect(get).toHaveBeenCalledTimes(3);
    get.mockRejectedValueOnce(new Error('offline'));
    await expect(metadata.refreshModelMetadata(true)).rejects.toThrow('offline');
    expect(metadata.getModelMetadata('model')?.context).toBe(1234);
  });

  it('removes nested plaintext and encrypted credentials from portable data', () => {
    const original = {
      accounts: [
        {
          access_token: 'encrypted:v1:secret',
          local_api_keys: [{ key: 'sk-secret', name: 'primary' }],
        },
      ],
      settings: { webdav: { password: 'secret' } },
    };
    expect(JSON.stringify(omitBackupSecrets(original))).not.toContain('secret');
    expect(original.accounts[0].access_token).toBe('encrypted:v1:secret');
  });

  it('classifies overflow separately without disabling healthy routes or confusing quota', () => {
    const failure = classifyUpstreamFailure({
      statusCode: 400,
      body: Buffer.from('{"error":{"message":"Input token exceed the limit"}}'),
    });
    expect(failure.failureClass).toBe('overflow');
    expect(failureClassToOutcome(failure.failureClass)).toBe('neutral');
    expect(resolveRoutePathDisabledReason(failure)).toBeUndefined();
    expect(
      classifyUpstreamFailure({ statusCode: 413, body: Buffer.from('invalid image') }).failureClass
    ).toBe('request_fatal');
    expect(
      classifyUpstreamFailure({
        statusCode: 400,
        body: Buffer.from('insufficient quota; context length exceeded'),
      }).failureClass
    ).toBe('quota_exhausted');
  });

  it('validates model limits and retains explicit effort and cache prices', () => {
    const models = parseModelMetadata({
      lab: {
        models: {
          model: {
            limit: { context: 200000, output: -1 },
            reasoning: true,
            modalities: { input: ['text', 'image', 0] },
            reasoning_options: [{ type: 'effort', values: ['high', 'max'] }],
            cost: { input: 1, cache_read: 0.1 },
          },
        },
      },
    });
    expect(models.model).toMatchObject({
      context: 200000,
      outputLimit: undefined,
      inputModalities: ['text', 'image'],
      reasoningEfforts: ['high', 'max'],
      cost: { cacheRead: 0.1 },
    });
  });

  it('rejects unknown downloads and altered installers before launching a process', async () => {
    const root = await directory();
    const service = new UpdateService();
    await expect(service.downloadUpdate('https://example.com/app.exe', vi.fn())).rejects.toThrow(
      'SHA-256'
    );
    const installer = path.join(root, 'app.exe');
    await fs.writeFile(installer, 'tampered', 'utf8');
    const internal = service as unknown as { verifiedInstallers: Map<string, string> };
    internal.verifiedInstallers.set(
      installer,
      createHash('sha256').update('expected').digest('hex')
    );
    await expect(service.installUpdate(installer)).rejects.toThrow('未验证');
    expect(state.spawn).not.toHaveBeenCalled();
  });
});
