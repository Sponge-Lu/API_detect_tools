import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../main/utils/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn() },
}));
import {
  ROUTE_SESSION_ACTIVITY_MAX_RECORDS,
  ROUTE_SESSION_ACTIVITY_TTL_MS,
  RouteSessionActivityService,
} from '../main/route-session-activity-service';
import type { RouteSessionRoutingConfig } from '../shared/types/route-proxy';

const temporaryDirectories: string[] = [];

async function createStoragePath(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'route-session-activity-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'state.json');
}

async function readState(storagePath: string): Promise<{
  instances: Record<string, { profileId: string; lastRequestAt: number }>;
}> {
  return JSON.parse(await fs.readFile(storagePath, 'utf8'));
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe('RouteSessionActivityService', () => {
  it('coalesces repeated touches into one latest record', async () => {
    const storagePath = await createStoragePath();
    const service = new RouteSessionActivityService({
      storagePath,
      flushDelayMs: 60_000,
      now: () => 1_000,
    });

    service.touch({ id: 'instance-1', profileId: 'profile-1', lastRequestAt: 100 });
    service.touch({ id: 'instance-1', profileId: 'profile-1', lastRequestAt: 300 });
    service.touch({ id: 'instance-1', profileId: 'profile-1', lastRequestAt: 200 });
    await service.flush();

    const state = await readState(storagePath);
    expect(Object.keys(state.instances)).toEqual(['instance-1']);
    expect(state.instances['instance-1']).toMatchObject({
      profileId: 'profile-1',
      lastRequestAt: 300,
    });
  });

  it('hydrates a newer persisted timestamp after restart without changing route identity', async () => {
    const storagePath = await createStoragePath();
    const writer = new RouteSessionActivityService({
      storagePath,
      flushDelayMs: 60_000,
      now: () => 1_000,
    });
    writer.touch({ id: 'instance-1', profileId: 'profile-1', lastRequestAt: 500 });
    await writer.flush();

    const config: RouteSessionRoutingConfig = {
      instances: {
        'instance-1': {
          id: 'instance-1',
          profileId: 'profile-1',
          display: {},
          modelId: 'model-1',
          reasoningEffort: 'medium',
          routingState: 'active',
          presenceState: 'unknown',
          lastRequestAt: 100,
        },
      },
      currentRouteBySlot: {},
      candidates: {},
      overrides: {},
      extractionRules: [],
    };
    const reader = new RouteSessionActivityService({ storagePath, now: () => 1_000 });

    await reader.hydrate(config);

    expect(config.instances['instance-1'].lastRequestAt).toBe(500);
    expect(config.instances['instance-1'].profileId).toBe('profile-1');
    expect(config.instances['instance-1'].modelId).toBe('model-1');
  });

  it('ignores activity for legacy instances without a profile scope', async () => {
    const storagePath = await createStoragePath();
    const config = {
      instances: {
        legacy: {
          id: 'legacy',
          display: {},
          modelId: 'model-1',
          reasoningEffort: 'medium',
          routingState: 'active',
          presenceState: 'unknown',
          lastRequestAt: 100,
        },
      },
      currentRouteBySlot: {},
      candidates: {},
      overrides: {},
      extractionRules: [],
    } as RouteSessionRoutingConfig;
    const service = new RouteSessionActivityService({ storagePath, now: () => 1_000 });

    await expect(service.hydrate(config)).resolves.toBeUndefined();
    expect(config.instances.legacy.lastRequestAt).toBe(100);
  });

  it('treats malformed activity state as empty without failing config hydration', async () => {
    const storagePath = await createStoragePath();
    await fs.writeFile(storagePath, '{not-json', 'utf8');
    const config: RouteSessionRoutingConfig = {
      instances: {},
      currentRouteBySlot: {},
      candidates: {},
      overrides: {},
      extractionRules: [],
    };
    const service = new RouteSessionActivityService({ storagePath, now: () => 1_000 });

    await expect(service.hydrate(config)).resolves.toBeUndefined();
  });

  it('expires stale records and caps retained activity', async () => {
    const storagePath = await createStoragePath();
    const now = ROUTE_SESSION_ACTIVITY_TTL_MS + 10_000;
    const service = new RouteSessionActivityService({
      storagePath,
      flushDelayMs: 60_000,
      now: () => now,
    });
    service.touch({ id: 'stale', profileId: 'profile-1', lastRequestAt: 1 });
    for (let index = 0; index < ROUTE_SESSION_ACTIVITY_MAX_RECORDS + 2; index += 1) {
      service.touch({
        id: `instance-${index}`,
        profileId: 'profile-1',
        lastRequestAt: now - index,
      });
    }

    await service.flush();

    const state = await readState(storagePath);
    expect(Object.keys(state.instances)).toHaveLength(ROUTE_SESSION_ACTIVITY_MAX_RECORDS);
    expect(state.instances.stale).toBeUndefined();
    expect(state.instances['instance-0']).toBeDefined();
    expect(state.instances[`instance-${ROUTE_SESSION_ACTIVITY_MAX_RECORDS + 1}`]).toBeUndefined();
  });
});
