import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ userData: '', loggerWarn: vi.fn() }));

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
}));

vi.mock('../main/utils/logger', () => ({
  default: { error: vi.fn(), warn: mocks.loggerWarn },
}));

import {
  ROUTE_STATE_AFFINITY_MAX_RECORDS,
  ROUTE_STATE_AFFINITY_TTL_MS,
  RouteStateAffinityService,
  type RouteStateAffinityRecord,
} from '../main/route-state-affinity-service';

const directories: string[] = [];

function record(overrides: Partial<RouteStateAffinityRecord> = {}): RouteStateAffinityRecord {
  return {
    resourceId: 'resp_1',
    resourceType: 'response',
    profileId: 'profile-1',
    siteId: 'site-1',
    accountId: 'account-1',
    apiKeyId: 'key-1',
    routeRuleId: 'rule-1',
    targetProtocol: 'openai-responses',
    targetEndpoint: '/v1/responses',
    createdAt: 1,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true })));
});

describe('route state affinity service', () => {
  it('persists stable channel identifiers without API key plaintext', async () => {
    mocks.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'route-affinity-'));
    directories.push(mocks.userData);
    const service = new RouteStateAffinityService();
    await service.bind(record());

    expect(await service.get('resp_1', 'profile-1')).toMatchObject({ apiKeyId: 'key-1' });
    const stored = await fs.readFile(service.getStoragePath(), 'utf-8');
    expect(stored).not.toContain('sk-');
  });

  it('recovers malformed storage and keeps get, bind, and remove usable', async () => {
    mocks.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'route-affinity-'));
    directories.push(mocks.userData);
    const storagePath = path.join(mocks.userData, 'state', 'route-state-affinity.json');
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    await fs.writeFile(storagePath, '{not-json', 'utf-8');
    mocks.loggerWarn.mockClear();
    const service = new RouteStateAffinityService();

    await expect(service.get('missing', 'profile-1')).resolves.toBeNull();
    await service.bind(record({ resourceId: 'recovered' }));
    await expect(service.get('recovered', 'profile-1')).resolves.toMatchObject({
      resourceId: 'recovered',
    });
    await service.remove('recovered');
    await expect(service.get('recovered', 'profile-1')).resolves.toBeNull();

    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent binds without losing records and assigns a default TTL', async () => {
    mocks.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'route-affinity-'));
    directories.push(mocks.userData);
    const service = new RouteStateAffinityService();
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        service.bind(record({ resourceId: `resp_${index}`, createdAt: index + 1 }))
      )
    );

    const stored = JSON.parse(await fs.readFile(service.getStoragePath(), 'utf-8'));
    expect(Object.keys(stored.resources)).toHaveLength(40);
    expect(stored.resources.resp_0.expiresAt).toBeGreaterThan(Date.now());
    expect(stored.resources.resp_0.expiresAt).toBeLessThanOrEqual(
      Date.now() + ROUTE_STATE_AFFINITY_TTL_MS
    );
  });

  it('compacts persisted affinity records to the configured maximum', async () => {
    mocks.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'route-affinity-'));
    directories.push(mocks.userData);
    const storagePath = path.join(mocks.userData, 'state', 'route-state-affinity.json');
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    const resources = Object.fromEntries(
      Array.from({ length: ROUTE_STATE_AFFINITY_MAX_RECORDS + 10 }, (_, index) => {
        const value = record({ resourceId: `resp_${index}`, createdAt: index + 1 });
        return [value.resourceId, value];
      })
    );
    await fs.writeFile(
      storagePath,
      JSON.stringify({ version: '1', resources, lastUpdated: 0 }),
      'utf-8'
    );

    const service = new RouteStateAffinityService();
    expect(Object.keys((await service.load()).resources)).toHaveLength(
      ROUTE_STATE_AFFINITY_MAX_RECORDS
    );
    expect(await service.get('resp_0', 'profile-1')).toBeNull();
    expect(
      await service.get(`resp_${ROUTE_STATE_AFFINITY_MAX_RECORDS + 9}`, 'profile-1')
    ).not.toBeNull();
  });

  it('does not reveal resources across profiles and removes expired responses', async () => {
    mocks.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'route-affinity-'));
    directories.push(mocks.userData);
    const service = new RouteStateAffinityService();
    await service.bind(record({ expiresAt: 10 }));

    expect(await service.get('resp_1', 'profile-2', 5)).toBeNull();
    expect(await service.get('resp_1', 'profile-1', 10)).toBeNull();
  });

  it('removes conversation children when the parent is deleted', async () => {
    mocks.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'route-affinity-'));
    directories.push(mocks.userData);
    const service = new RouteStateAffinityService();
    await service.bind(record({ resourceId: 'conv_1', resourceType: 'conversation' }));
    await service.bind(
      record({
        resourceId: 'item_1',
        resourceType: 'conversation-item',
        parentResourceId: 'conv_1',
      })
    );
    await service.remove('conv_1');

    expect(await service.get('conv_1', 'profile-1')).toBeNull();
    expect(await service.get('item_1', 'profile-1')).toBeNull();
  });

  it('cleans records by stable profile and channel entity identifiers', async () => {
    mocks.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'route-affinity-'));
    directories.push(mocks.userData);
    const service = new RouteStateAffinityService();
    await service.bind(record({ resourceId: 'site-resource' }));
    await service.bind(
      record({
        resourceId: 'account-resource',
        profileId: 'profile-2',
        siteId: 'site-2',
      })
    );
    await service.bind(
      record({
        resourceId: 'key-resource',
        profileId: 'profile-3',
        siteId: 'site-3',
        accountId: 'account-3',
      })
    );

    expect(await service.removeBySite('site-1')).toBe(1);
    expect(await service.removeByAccount('account-1')).toBe(1);
    expect(await service.removeByApiKey('key-1')).toBe(1);
    expect(await service.removeByProfile('missing-profile')).toBe(0);
    expect(await service.get('site-resource', 'profile-1')).toBeNull();
    expect(await service.get('account-resource', 'profile-2')).toBeNull();
    expect(await service.get('key-resource', 'profile-3')).toBeNull();
  });

  it('summarizes one profile without exposing resource identifiers', async () => {
    mocks.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'route-affinity-'));
    directories.push(mocks.userData);
    const service = new RouteStateAffinityService();
    await service.bind(record({ resourceId: 'response-1' }));
    await service.bind(record({ resourceId: 'conversation-1', resourceType: 'conversation' }));
    await service.bind(record({ resourceId: 'item-1', resourceType: 'conversation-item' }));
    await service.bind(record({ resourceId: 'other', profileId: 'profile-2' }));

    expect(await service.summarizeProfile('profile-1')).toEqual({
      profileId: 'profile-1',
      total: 3,
      responses: 1,
      conversations: 1,
      conversationItems: 1,
    });
  });
});
