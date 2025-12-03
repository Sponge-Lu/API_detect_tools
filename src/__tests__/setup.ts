import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Electron API for renderer tests
if (typeof window !== 'undefined') {
  (window as any).electronAPI = {
    loadConfig: vi.fn(),
    saveConfig: vi.fn(),
    launchChromeForLogin: vi.fn(),
    closeBrowser: vi.fn(),
    getCookies: vi.fn(),
    fetchWithCookies: vi.fn(),
    detectSite: vi.fn(),
    detectAllSites: vi.fn(),
    openUrl: vi.fn(),
    getAllAccounts: vi.fn(),
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
  };
}
