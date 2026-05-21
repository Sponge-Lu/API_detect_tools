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
      getObjectStats: vi.fn(),
      getRequestLogs: vi.fn(),
      clearRequestLogs: vi.fn(),
      onRequestLogAppended: vi.fn(),
      resetPathStates: vi.fn(),
    },
    overview: {
      getSiteDailySnapshots: vi.fn(),
    },
  };
}
