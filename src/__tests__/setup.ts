import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Electron API for renderer tests
if (typeof window !== 'undefined') {
  vi.stubGlobal('alert', vi.fn());
  if (typeof (globalThis as any).ResizeObserver === 'undefined') {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  (window as any).electronAPI = {
    loadConfig: vi.fn(),
    saveConfig: vi.fn(),
    launchChromeForLogin: vi.fn(),
    closeBrowser: vi.fn(),
    closeLoginBrowser: vi.fn(),
    appData: {
      onChanged: vi.fn(() => vi.fn()),
    },
    getCookies: vi.fn(),
    fetchWithCookies: vi.fn(),
    detectSite: vi.fn(),
    detectAllSites: vi.fn(),
    openUrl: vi.fn(),
    getAllAccounts: vi.fn(),
    browserProfile: {
      openSite: vi.fn(),
      openSiteForCheckin: vi.fn(),
    },
    token: {
      initializeSite: vi.fn(),
      refreshDisplayData: vi.fn(),
      refreshAccountBasicInfo: vi.fn(),
      validate: vi.fn(),
      fetchApiTokens: vi.fn(),
      createApiToken: vi.fn(),
      deleteApiToken: vi.fn(),
      fetchUserGroups: vi.fn(),
      fetchModelPricing: vi.fn(),
      checkIn: vi.fn(),
    },
    storage: {
      getAllAccounts: vi.fn(),
      getAccount: vi.fn(),
      saveAccount: vi.fn(),
      deleteAccount: vi.fn(),
      updateToken: vi.fn(),
      export: vi.fn(),
      import: vi.fn(),
    },
    theme: {
      save: vi.fn(),
      load: vi.fn(),
    },
    route: {
      getConfig: vi.fn(),
      getAnalyticsSummary: vi.fn(),
      getAnalyticsDistribution: vi.fn(),
      getAnalyticsOverview: vi.fn(),
      getObjectStats: vi.fn(),
      getRequestLogs: vi.fn(),
      clearRequestLogs: vi.fn(),
      getHistoryBuckets: vi.fn(),
      onRequestLogAppended: vi.fn(),
      upsertModelDisplayItem: vi.fn(),
      resetPathStates: vi.fn(),
      saveCliProbeConfig: vi.fn(),
      runCliProbeNow: vi.fn(),
      getCliProbeLatest: vi.fn(),
      getCliProbeView: vi.fn(),
    },
    customCliConfig: {
      load: vi.fn(),
      save: vi.fn(),
      fetchModels: vi.fn(),
    },
    configFileProfiles: {
      load: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockImplementation(async ({ profile }) => profile),
      delete: vi.fn().mockResolvedValue(undefined),
      getTargetCatalog: vi.fn().mockResolvedValue([
        {
          value: 'local-route',
          kind: 'local-route',
          label: '本地路由',
          available: true,
          apiKeys: [],
          models: [],
          allModels: [],
        },
      ]),
      restoreBuiltin: vi.fn().mockImplementation(async ({ profileId }) => ({ id: profileId })),
      readFiles: vi.fn().mockResolvedValue([]),
      preview: vi.fn().mockResolvedValue({ files: [] }),
      previewDirectEdit: vi.fn().mockResolvedValue({ files: [] }),
      previewRouteKeyRotation: vi.fn(),
      resolveValues: vi.fn().mockImplementation(async ({ profile }) => ({
        baseUrl: profile.target.kind === 'local-route' ? 'http://127.0.0.1:3000/v1' : '',
        apiKey: profile.localRouteCredential?.apiKey || '',
        model: profile.target.model || '',
      })),
      commit: vi.fn().mockResolvedValue({ backups: [] }),
      validateSessionRecord: vi.fn().mockResolvedValue({ records: [], diagnostics: [] }),
    },
    accounts: {
      list: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    overview: {
      getSiteDailySnapshots: vi.fn(),
    },
  };
}
