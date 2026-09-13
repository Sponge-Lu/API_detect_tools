import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exportConfigSync: vi.fn(),
  getAccountById: vi.fn(),
  getAccountsBySiteId: vi.fn(),
  updateAccountCachedData: vi.fn(),
  loadCustomCliConfigStorage: vi.fn(),
  resolveUsableApiKeyValue: vi.fn(),
}));

vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: {
    exportConfigSync: mocks.exportConfigSync,
    getAccountById: mocks.getAccountById,
    getAccountsBySiteId: mocks.getAccountsBySiteId,
    updateAccountCachedData: mocks.updateAccountCachedData,
  },
}));

vi.mock('../main/custom-cli-config-service', () => ({
  loadCustomCliConfigStorage: mocks.loadCustomCliConfigStorage,
}));

import {
  configureUpstreamApiKeyResolver,
  resolveUpstreamCredentials,
} from '../main/upstream-credential-resolver';

describe('upstream-credential-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureUpstreamApiKeyResolver({
      resolveUsableApiKeyValue: mocks.resolveUsableApiKeyValue,
    });
  });

  it('resolves a direct target by configuration and key identity', async () => {
    mocks.loadCustomCliConfigStorage.mockResolvedValue({
      configs: [
        {
          id: 'direct-1',
          baseUrl: ' https://direct.example/v1 ',
          apiKey: 'legacy-secret',
          routeAuthScheme: 'bearer',
          apiKeys: [
            { id: 'key-a', key: 'secret-a' },
            { id: 'key-b', key: ' secret-b ' },
          ],
        },
      ],
    });

    await expect(
      resolveUpstreamCredentials({ kind: 'direct', configId: 'direct-1', apiKeyId: 'key-b' })
    ).resolves.toEqual({
      baseUrl: 'https://direct.example/v1',
      apiKey: 'secret-b',
      authScheme: 'bearer',
    });
  });

  it('rejects a managed account that does not belong to the selected site', async () => {
    mocks.exportConfigSync.mockReturnValue({
      sites: [{ id: 'site-a', url: 'https://site-a.example' }],
      accounts: [{ id: 'account-b', site_id: 'site-b', cached_data: { api_keys: [] } }],
    });

    await expect(
      resolveUpstreamCredentials({
        kind: 'managed',
        siteId: 'site-a',
        accountId: 'account-b',
        apiKeyId: 'key-1',
      })
    ).resolves.toBeNull();
  });

  it('resolves and persists a masked managed key without route runtime state', async () => {
    const site = { id: 'site-a', url: 'https://site-a.example' };
    const account = {
      id: 'account-a',
      site_id: 'site-a',
      user_id: '7',
      access_token: 'access-token',
      routeAuthScheme: 'x-api-key',
      cached_data: { api_keys: [{ id: 'key-1', key: 'sk-***' }] },
    };
    mocks.exportConfigSync.mockReturnValue({ sites: [site], accounts: [account] });
    mocks.getAccountById.mockReturnValue(account);
    mocks.getAccountsBySiteId.mockReturnValue([{ id: 'account-0' }, account]);
    mocks.resolveUsableApiKeyValue.mockResolvedValue('resolved-secret');
    mocks.updateAccountCachedData.mockImplementation(
      async (_accountId: string, update: (current: unknown) => unknown) => {
        update(account.cached_data);
      }
    );

    await expect(
      resolveUpstreamCredentials({
        kind: 'managed',
        siteId: 'site-a',
        accountId: 'account-a',
        apiKeyId: 'key-1',
      })
    ).resolves.toEqual({
      baseUrl: 'https://site-a.example',
      apiKey: 'resolved-secret',
      authScheme: 'x-api-key',
    });

    expect(mocks.resolveUsableApiKeyValue).toHaveBeenCalledWith(
      'https://site-a.example',
      7,
      'access-token',
      expect.objectContaining({ id: 'key-1' }),
      expect.objectContaining({ browserSlot: 1, allowBrowserFallback: true })
    );
    expect(mocks.updateAccountCachedData).toHaveBeenCalledWith('account-a', expect.any(Function));
  });
});
