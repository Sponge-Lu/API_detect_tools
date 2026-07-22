import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const {
  mockLoadConfig,
  mockSaveConfig,
  mockGetSites,
  mockGetAccountsBySiteId,
  mockGetAccountById,
  mockUpdateAccount,
  state,
} = vi.hoisted(() => {
  const state = {
    config: {
      settings: {} as { browser_profile?: { main_profile_path?: string } },
      accounts: [] as Array<{
        id: string;
        site_id: string;
        account_name?: string;
        auth_source: string;
        browser_profile_path?: string;
        created_at: number;
      }>,
    },
  };

  return {
    state,
    mockLoadConfig: vi.fn(async () => state.config),
    mockSaveConfig: vi.fn(async () => {
      // no-op; tests inspect state.config
    }),
    mockGetSites: vi.fn(() => []),
    mockGetAccountsBySiteId: vi.fn((siteId: string) =>
      state.config.accounts.filter(account => account.site_id === siteId)
    ),
    mockGetAccountById: vi.fn((accountId: string) =>
      state.config.accounts.find(account => account.id === accountId)
    ),
    mockUpdateAccount: vi.fn(async (accountId: string, updates: Record<string, unknown>) => {
      const account = state.config.accounts.find(candidate => candidate.id === accountId);
      if (!account) return false;
      Object.assign(account, updates);
      return true;
    }),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') {
        return state.config ? (globalThis as any).__browserProfileUserData : 'D:/unused';
      }
      return 'D:/unused';
    }),
  },
}));

vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: {
    loadConfig: mockLoadConfig,
    saveConfig: mockSaveConfig,
    getSites: mockGetSites,
    getAccountsBySiteId: mockGetAccountsBySiteId,
    getAccountById: mockGetAccountById,
    updateAccount: mockUpdateAccount,
    get config() {
      return state.config;
    },
  },
}));

vi.mock('../main/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('BrowserProfileManager', () => {
  let tempDir: string;
  let userDataDir: string;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'api-hub-browser-profile-'));
    userDataDir = path.join(tempDir, 'userData');
    await fsp.mkdir(userDataDir, { recursive: true });
    (globalThis as any).__browserProfileUserData = userDataDir;

    state.config = {
      settings: {},
      accounts: [],
    };
    mockLoadConfig.mockClear();
    mockSaveConfig.mockClear();
    mockGetAccountById.mockClear();
    mockUpdateAccount.mockClear();
    vi.resetModules();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
    delete (globalThis as any).__browserProfileUserData;
  });

  it('rewrites isolated profile paths to local slot dirs and preserves slot numbers', async () => {
    const { browserProfileManager } = await import('../main/browser-profile-manager');

    state.config.accounts = [
      {
        id: 'acc-main',
        site_id: 'site-a',
        auth_source: 'main_profile',
        browser_profile_path: 'C:/old-machine/Chrome/User Data',
        created_at: 1,
      },
      {
        id: 'acc-iso-2',
        site_id: 'site-a',
        auth_source: 'isolated_profile',
        browser_profile_path: 'D:/old-userData/browser-profiles/slot-2',
        created_at: 2,
      },
      {
        id: 'acc-iso-4',
        site_id: 'site-a',
        auth_source: 'isolated_profile',
        browser_profile_path: 'D:/old-userData/browser-profiles/slot-4',
        created_at: 3,
      },
      {
        id: 'acc-manual',
        site_id: 'site-a',
        auth_source: 'manual',
        created_at: 4,
      },
      {
        id: 'acc-invalid',
        site_id: 'site-b',
        auth_source: 'isolated_profile',
        browser_profile_path: 'not-a-slot-path',
        created_at: 5,
      },
    ];

    // Point isolated root via app.getPath userData
    const result = await browserProfileManager.reconcileIsolatedProfilesAfterRestore();

    expect(result.reboundAccounts).toBeGreaterThanOrEqual(3);
    // slot dirs are global under browser-profiles; site-b may reuse site-a's slot-2 dir
    expect(result.createdSlots).toBeGreaterThanOrEqual(2);

    const slot2 = path.join(userDataDir, 'browser-profiles', 'slot-2');
    const slot4 = path.join(userDataDir, 'browser-profiles', 'slot-4');

    expect(state.config.accounts.find(a => a.id === 'acc-iso-2')?.browser_profile_path).toBe(slot2);
    expect(state.config.accounts.find(a => a.id === 'acc-iso-4')?.browser_profile_path).toBe(slot4);
    expect(
      state.config.accounts.find(a => a.id === 'acc-main')?.browser_profile_path
    ).toBeUndefined();
    expect(
      state.config.accounts.find(a => a.id === 'acc-manual')?.browser_profile_path
    ).toBeUndefined();

    const invalidPath = state.config.accounts.find(
      a => a.id === 'acc-invalid'
    )?.browser_profile_path;
    expect(invalidPath).toMatch(/slot-\d+$/);
    expect(fs.existsSync(slot2)).toBe(true);
    expect(fs.existsSync(slot4)).toBe(true);
    expect(fs.existsSync(invalidPath!)).toBe(true);
    expect(mockSaveConfig).toHaveBeenCalled();

    // empty profile markers
    expect(fs.existsSync(path.join(slot2, 'First Run'))).toBe(true);
    expect(fs.existsSync(path.join(slot2, 'Default'))).toBe(true);
  });

  it('allocates a free slot when two accounts collide on the same old slot', async () => {
    const { browserProfileManager } = await import('../main/browser-profile-manager');

    state.config.accounts = [
      {
        id: 'a1',
        site_id: 'site-x',
        auth_source: 'isolated_profile',
        browser_profile_path: '/old/browser-profiles/slot-3',
        created_at: 1,
      },
      {
        id: 'a2',
        site_id: 'site-x',
        auth_source: 'isolated_profile',
        browser_profile_path: '/old/browser-profiles/slot-3',
        created_at: 2,
      },
    ];

    await browserProfileManager.reconcileIsolatedProfilesAfterRestore();

    const p1 = state.config.accounts.find(a => a.id === 'a1')?.browser_profile_path;
    const p2 = state.config.accounts.find(a => a.id === 'a2')?.browser_profile_path;
    expect(p1).toBe(path.join(userDataDir, 'browser-profiles', 'slot-3'));
    expect(p2).toBe(path.join(userDataDir, 'browser-profiles', 'slot-2'));
    expect(p1).not.toBe(p2);
    expect(fs.existsSync(p1!)).toBe(true);
    expect(fs.existsSync(p2!)).toBe(true);
  });

  it('binds a historical manual account to the main Profile without recreating it', async () => {
    const mainProfilePath = path.join(tempDir, 'Chrome', 'User Data');
    await fsp.mkdir(mainProfilePath, { recursive: true });
    state.config.settings.browser_profile = { main_profile_path: mainProfilePath };
    state.config.accounts = [
      {
        id: 'manual-account',
        site_id: 'site-a',
        account_name: '默认账户',
        auth_source: 'manual',
        browser_profile_path: 'C:/stale/slot-2',
        created_at: 1,
      },
      {
        id: 'other-site-main',
        site_id: 'site-b',
        account_name: '其他站点账户',
        auth_source: 'main_profile',
        created_at: 2,
      },
    ];

    const { browserProfileManager } = await import('../main/browser-profile-manager');
    const selection = await browserProfileManager.listAccountProfileOptions(
      'site-a',
      'manual-account'
    );

    expect(selection.selectedId).toBe('manual');
    expect(selection.options).toContainEqual({
      id: 'manual',
      label: '手动添加账户无绑定浏览器',
      authSource: 'manual',
    });
    expect(selection.options).toContainEqual(
      expect.objectContaining({
        id: 'main_profile',
        disabled: false,
      })
    );

    await browserProfileManager.bindAccountProfile('site-a', 'manual-account', 'main_profile');

    expect(mockUpdateAccount).toHaveBeenCalledWith('manual-account', {
      auth_source: 'main_profile',
      browser_profile_path: undefined,
    });
    expect(state.config.accounts[0].auth_source).toBe('main_profile');
    expect(state.config.accounts[0].browser_profile_path).toBeUndefined();
  });

  it('prevents two accounts on the same site from binding the same Profile', async () => {
    const mainProfilePath = path.join(tempDir, 'Chrome', 'User Data');
    const isolatedProfilePath = path.join(userDataDir, 'browser-profiles', 'slot-2');
    await fsp.mkdir(mainProfilePath, { recursive: true });
    await fsp.mkdir(isolatedProfilePath, { recursive: true });
    state.config.settings.browser_profile = { main_profile_path: mainProfilePath };
    state.config.accounts = [
      {
        id: 'manual-account',
        site_id: 'site-a',
        account_name: '待修复账户',
        auth_source: 'manual',
        created_at: 1,
      },
      {
        id: 'main-account',
        site_id: 'site-a',
        account_name: '主账户',
        auth_source: 'main_profile',
        created_at: 2,
      },
      {
        id: 'isolated-account',
        site_id: 'site-a',
        account_name: '隔离账户',
        auth_source: 'isolated_profile',
        browser_profile_path: isolatedProfilePath,
        created_at: 3,
      },
    ];

    const { browserProfileManager } = await import('../main/browser-profile-manager');
    const selection = await browserProfileManager.listAccountProfileOptions(
      'site-a',
      'manual-account'
    );

    expect(selection.options).toContainEqual(
      expect.objectContaining({
        id: 'main_profile',
        disabled: true,
        disabledReason: '已被账户「主账户」使用',
      })
    );
    expect(selection.options).toContainEqual(
      expect.objectContaining({
        id: 'isolated_profile:2',
        disabled: true,
        disabledReason: '已被账户「隔离账户」使用',
      })
    );

    await expect(
      browserProfileManager.bindAccountProfile('site-a', 'manual-account', 'main_profile')
    ).rejects.toThrow('已被账户「主账户」使用');
    expect(mockUpdateAccount).not.toHaveBeenCalled();
  });
});
