import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const { mockLoadConfig, mockSaveConfig, mockGetSites, mockGetAccountsBySiteId, state } = vi.hoisted(
  () => {
    const state = {
      config: {
        settings: {},
        accounts: [] as Array<{
          id: string;
          site_id: string;
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
    };
  }
);

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

describe('BrowserProfileManager.reconcileIsolatedProfilesAfterRestore', () => {
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
});
