import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../main/utils/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn() },
}));
import {
  ROUTE_SESSION_BINDING_MAX_RECORDS,
  ROUTE_SESSION_BINDING_TTL_MS,
  RouteSessionBindingService,
} from '../main/route-session-binding-service';
import type { RouteSessionChannelBinding } from '../shared/types/route-proxy';

const temporaryDirectories: string[] = [];

async function createStoragePath(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'route-session-binding-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'state.json');
}

function binding(
  instanceId: string,
  overrides: Partial<RouteSessionChannelBinding> = {}
): RouteSessionChannelBinding {
  return {
    instanceId,
    profileId: 'profile-1',
    siteId: 'site-1',
    accountId: 'acc-1',
    apiKeyId: 'key-1',
    canonicalModel: 'claude-opus-4-6',
    boundAt: 1_000,
    lastUsedAt: 1_000,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe('RouteSessionBindingService', () => {
  it('persists a binding and reads it back after a reload', async () => {
    const storagePath = await createStoragePath();
    const service = new RouteSessionBindingService({ storagePath, now: () => 1_000 });

    await service.load();
    service.bind(binding('instance-a', { siteId: 'site-b', apiKeyId: 'key-b' }));
    await service.flush();

    const reloaded = new RouteSessionBindingService({ storagePath, now: () => 2_000 });
    await reloaded.load();

    expect(reloaded.get('instance-a')).toMatchObject({ siteId: 'site-b', apiKeyId: 'key-b' });
  });

  it('serves a pending binding before it reaches disk, since routing cannot await IO', async () => {
    const storagePath = await createStoragePath();
    const service = new RouteSessionBindingService({
      storagePath,
      flushDelayMs: 60_000,
      now: () => 1_000,
    });

    await service.load();
    service.bind(binding('instance-a'));

    expect(service.get('instance-a')).toMatchObject({ instanceId: 'instance-a' });
  });

  it('keeps only the newest record per instance', async () => {
    const storagePath = await createStoragePath();
    const service = new RouteSessionBindingService({
      storagePath,
      flushDelayMs: 60_000,
      now: () => 5_000,
    });

    await service.load();
    service.bind(binding('instance-a', { siteId: 'site-old', lastUsedAt: 1_000 }));
    service.bind(binding('instance-a', { siteId: 'site-new', lastUsedAt: 2_000 }));
    await service.flush();

    const persisted = JSON.parse(await fs.readFile(storagePath, 'utf8'));
    expect(Object.keys(persisted.bindings)).toEqual(['instance-a']);
    expect(persisted.bindings['instance-a'].siteId).toBe('site-new');
  });

  it('drops bindings past the TTL on load and excludes them from listActive', async () => {
    const storagePath = await createStoragePath();
    const service = new RouteSessionBindingService({ storagePath, now: () => 1_000 });
    await service.load();
    service.bind(binding('fresh', { lastUsedAt: 1_000 }));
    service.bind(binding('stale', { lastUsedAt: 1_000 }));
    await service.flush();

    const later = 1_000 + ROUTE_SESSION_BINDING_TTL_MS + 1;
    const reloaded = new RouteSessionBindingService({ storagePath, now: () => later });
    await reloaded.load();

    expect(reloaded.get('fresh')).toBeUndefined();
    expect(reloaded.listActive(later)).toEqual([]);
  });

  it('caps the record count at the configured maximum, keeping the most recent', async () => {
    const storagePath = await createStoragePath();
    const service = new RouteSessionBindingService({
      storagePath,
      flushDelayMs: 60_000,
      now: () => 10_000,
    });
    await service.load();
    for (let index = 0; index < ROUTE_SESSION_BINDING_MAX_RECORDS + 5; index += 1) {
      service.bind(binding(`instance-${index}`, { lastUsedAt: 1_000 + index }));
    }
    await service.flush();

    const persisted = JSON.parse(await fs.readFile(storagePath, 'utf8'));
    expect(Object.keys(persisted.bindings)).toHaveLength(ROUTE_SESSION_BINDING_MAX_RECORDS);
    expect(persisted.bindings['instance-0']).toBeUndefined();
    expect(persisted.bindings[`instance-${ROUTE_SESSION_BINDING_MAX_RECORDS + 4}`]).toBeDefined();
  });

  it('removes a single instance binding', async () => {
    const storagePath = await createStoragePath();
    const service = new RouteSessionBindingService({ storagePath, now: () => 1_000 });
    await service.load();
    service.bind(binding('instance-a'));
    service.bind(binding('instance-b'));
    await service.flush();

    await expect(service.removeByInstance('instance-a')).resolves.toBe(true);
    expect(service.get('instance-a')).toBeUndefined();
    expect(service.get('instance-b')).toBeDefined();
  });

  it('removes every binding owned by a profile', async () => {
    const storagePath = await createStoragePath();
    const service = new RouteSessionBindingService({ storagePath, now: () => 1_000 });
    await service.load();
    service.bind(binding('instance-a', { profileId: 'profile-1' }));
    service.bind(binding('instance-b', { profileId: 'profile-1' }));
    service.bind(binding('instance-c', { profileId: 'profile-2' }));
    await service.flush();

    await expect(service.removeByProfile('profile-1')).resolves.toBe(2);
    expect(service.get('instance-a')).toBeUndefined();
    expect(service.get('instance-c')).toBeDefined();
  });

  it('degrades to empty state when the sidecar is malformed instead of throwing', async () => {
    const storagePath = await createStoragePath();
    await fs.writeFile(storagePath, '{ not json', 'utf8');
    const service = new RouteSessionBindingService({ storagePath, now: () => 1_000 });

    await expect(service.load()).resolves.toMatchObject({ bindings: {} });
  });

  it('discards records that lack a usable channel identity', async () => {
    const storagePath = await createStoragePath();
    await fs.writeFile(
      storagePath,
      JSON.stringify({
        version: '1',
        bindings: {
          good: binding('good'),
          bad: { instanceId: 'bad', profileId: 'p' },
          mismatched: binding('other'),
        },
        lastUpdated: 1_000,
      }),
      'utf8'
    );
    const service = new RouteSessionBindingService({ storagePath, now: () => 1_000 });
    await service.load();

    expect(service.get('good')).toBeDefined();
    expect(service.get('bad')).toBeUndefined();
    expect(service.get('mismatched')).toBeUndefined();
  });
});
