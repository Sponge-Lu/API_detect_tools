import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalApiKeyRecord } from '../shared/types/site';

const mocks = vi.hoisted(() => ({
  account: { id: 'account-1', site_id: 'site-1', local_api_keys: [] as LocalApiKeyRecord[] },
  updateAccount: vi.fn(),
  httpGet: vi.fn(),
}));
vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: {
    getConfig: async () => ({}),
    getAccountById: () => ({ ...mocks.account }),
    updateAccount: mocks.updateAccount,
    exportConfigSync: () => ({ sites: [{ id: 'site-1', url: 'https://example.com/v1' }] }),
  },
}));
vi.mock('../main/utils/http-client', () => ({ httpGet: mocks.httpGet }));
import {
  addLocalApiKey,
  deleteLocalApiKey,
  refreshLocalApiKeys,
  updateLocalApiKey,
} from '../main/local-api-key-service';

describe('local API key persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.account.local_api_keys = [];
    mocks.updateAccount.mockImplementation(async (_id, updates) => {
      await Promise.resolve();
      Object.assign(mocks.account, updates);
      return true;
    });
  });
  const input = (name: string) => ({
    name,
    key: `${name}-secret`,
    group: 'default',
    groupMultiplier: 1,
  });

  it('preserves simultaneous additions and recovers after a failed save', async () => {
    mocks.updateAccount.mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(addLocalApiKey('account-1', input('failed'))).rejects.toThrow('Disk unavailable');
    await Promise.all(['first', 'second'].map(name => addLocalApiKey('account-1', input(name))));
    expect(mocks.account.local_api_keys.map(key => key.name)).toEqual(['first', 'second']);
  });
  it('does not restore deleted keys when a model request completes', async () => {
    await addLocalApiKey('account-1', input('first'));
    const id = mocks.account.local_api_keys[0].id;
    let finish!: (value: unknown) => void;
    mocks.httpGet.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const refresh = refreshLocalApiKeys('account-1', 'https://example.com/v1');
    await vi.waitFor(() => expect(mocks.httpGet).toHaveBeenCalled());
    expect(mocks.httpGet.mock.calls[0]).toEqual([
      'https://example.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer first-secret' }),
      }),
    ]);
    await deleteLocalApiKey('account-1', id);
    await addLocalApiKey('account-1', input('second'));
    finish({ status: 200, data: { data: [{ id: 'gpt-test' }] } });
    await refresh;
    expect(mocks.account.local_api_keys.map(key => key.name)).toEqual(['second']);
    expect(mocks.account.local_api_keys[0].models).toEqual([]);
  });
  it('clears models when the user replaces a key', async () => {
    await addLocalApiKey('account-1', input('first'));
    const record = mocks.account.local_api_keys[0];
    record.models = ['old-model'];
    record.modelsFetchedAt = 1;
    await updateLocalApiKey('account-1', record.id, input('replacement'));
    expect(mocks.account.local_api_keys[0]).toMatchObject({
      key: 'replacement-secret',
      models: [],
      source: 'local',
    });
    expect(mocks.account.local_api_keys[0].modelsFetchedAt).toBeUndefined();
  });
  it('returns the current key list when a failed model request finishes after a deletion', async () => {
    await addLocalApiKey('account-1', input('first'));
    const id = mocks.account.local_api_keys[0].id;
    let finish!: (value: unknown) => void;
    mocks.httpGet.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const refresh = refreshLocalApiKeys('account-1', 'https://example.com/v1');
    await vi.waitFor(() => expect(mocks.httpGet).toHaveBeenCalled());
    await deleteLocalApiKey('account-1', id);
    finish({ status: 401, data: {} });
    expect(await refresh).toMatchObject({
      keys: [],
      models: [],
      results: [{ keyId: id, success: false }],
    });
  });
});
