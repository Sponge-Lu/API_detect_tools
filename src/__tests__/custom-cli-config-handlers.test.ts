import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadCustomCliConfigHandlersModule() {
  vi.resetModules();

  const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    registeredHandlers.set(channel, handler);
  });
  const loadCustomCliConfigStorage = vi.fn();
  const saveCustomCliConfigStorage = vi.fn(async () => undefined);
  const fetchCustomCliModelsFromEndpoint = vi.fn();
  const syncModelRegistrySources = vi.fn(async () => ({
    version: 1,
    sources: {},
    entries: {},
    overrides: [],
    displayItems: [],
    vendorPriorities: {},
    lastAggregatedAt: 1,
  }));
  const notifyAppDataChanged = vi.fn();

  vi.doMock('electron', () => ({
    ipcMain: {
      handle: ipcHandle,
    },
  }));
  vi.doMock('../main/utils/logger', () => ({
    default: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));
  vi.doMock('../main/custom-cli-config-service', () => ({
    fetchCustomCliModelsFromEndpoint,
    loadCustomCliConfigStorage,
    saveCustomCliConfigStorage,
  }));
  vi.doMock('../main/route-model-registry-service', () => ({
    syncModelRegistrySources,
  }));
  vi.doMock('../main/app-data-events', () => ({
    notifyAppDataChanged,
  }));

  return {
    ...(await import('../main/handlers/custom-cli-config-handlers')),
    registeredHandlers,
    saveCustomCliConfigStorage,
    syncModelRegistrySources,
    notifyAppDataChanged,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('custom CLI config handlers', () => {
  it('syncs route model registry sources after saving custom CLI configs', async () => {
    const {
      registerCustomCliConfigHandlers,
      registeredHandlers,
      saveCustomCliConfigStorage,
      syncModelRegistrySources,
      notifyAppDataChanged,
    } = await loadCustomCliConfigHandlersModule();

    registerCustomCliConfigHandlers();
    const saveHandler = registeredHandlers.get('custom-cli-config:save');
    expect(saveHandler).toBeDefined();

    const storage = { configs: [], activeConfigId: null };
    await expect(saveHandler?.({}, storage)).resolves.toEqual({ success: true });

    expect(saveCustomCliConfigStorage).toHaveBeenCalledWith(storage);
    expect(syncModelRegistrySources).toHaveBeenCalledWith(true);
    expect(notifyAppDataChanged).toHaveBeenCalledWith('route-overview');
    expect(saveCustomCliConfigStorage.mock.invocationCallOrder[0]).toBeLessThan(
      syncModelRegistrySources.mock.invocationCallOrder[0]
    );
    expect(syncModelRegistrySources.mock.invocationCallOrder[0]).toBeLessThan(
      notifyAppDataChanged.mock.invocationCallOrder[0]
    );
  });

  it('surfaces registry sync failures instead of leaving stale route model choices silently', async () => {
    const {
      registerCustomCliConfigHandlers,
      registeredHandlers,
      syncModelRegistrySources,
      notifyAppDataChanged,
    } = await loadCustomCliConfigHandlersModule();
    syncModelRegistrySources.mockRejectedValueOnce(new Error('sync failed'));

    registerCustomCliConfigHandlers();
    const saveHandler = registeredHandlers.get('custom-cli-config:save');

    await expect(saveHandler?.({}, { configs: [], activeConfigId: null })).rejects.toThrow(
      'sync failed'
    );
    expect(notifyAppDataChanged).not.toHaveBeenCalled();
  });
});
