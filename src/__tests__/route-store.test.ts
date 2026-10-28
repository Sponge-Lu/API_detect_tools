import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRouteStore } from '../renderer/store/routeStore';
import { DEFAULT_ROUTING_CONFIG } from '../shared/types/route-proxy';

beforeEach(() => {
  useRouteStore.setState({
    config: structuredClone(DEFAULT_ROUTING_CONFIG),
    serverRunning: true,
    loading: false,
  });
  window.electronAPI.route.startServer = vi.fn().mockResolvedValue({ success: true });
  window.electronAPI.route.stopServer = vi.fn().mockResolvedValue({ success: true });
  window.electronAPI.route.getRuntimeStatus = vi.fn().mockResolvedValue({
    success: true,
    data: { running: false },
  });
});

describe('route server controls', () => {
  it('keeps global model routes in the store and retains them after a failed deletion', async () => {
    const saved = {
      id: 'global-1',
      name: 'Search',
      requestModel: 'wire',
      modelId: 'target',
      reasoningEffort: 'high',
      enabled: true,
    };
    window.electronAPI.route.upsertGlobalModelRoute = vi
      .fn()
      .mockResolvedValue({ success: true, data: saved });
    await useRouteStore.getState().saveGlobalModelRoute(undefined, saved);
    expect(useRouteStore.getState().config?.globalModelRoutes).toEqual([saved]);
    window.electronAPI.route.deleteGlobalModelRoute = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'Disk unavailable' });
    await expect(useRouteStore.getState().deleteGlobalModelRoute(saved.id)).rejects.toThrow(
      'Disk unavailable'
    );
    expect(useRouteStore.getState().config?.globalModelRoutes).toEqual([saved]);
    window.electronAPI.route.deleteGlobalModelRoute = vi
      .fn()
      .mockResolvedValue({ success: true, data: true });
    await useRouteStore.getState().deleteGlobalModelRoute(saved.id);
    expect(useRouteStore.getState().config?.globalModelRoutes).toEqual([]);
  });

  it('does not replace a saved global model card with a stale runtime refresh', async () => {
    const oldConfig = structuredClone(DEFAULT_ROUTING_CONFIG);
    let resolveRefresh!: (value: unknown) => void;
    window.electronAPI.route.getConfig = vi.fn().mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRefresh = resolve;
        })
    );
    const refresh = useRouteStore.getState().refreshRuntimeState();
    const saved = {
      id: 'global-1',
      name: 'Search',
      requestModel: 'wire',
      modelId: 'target',
      reasoningEffort: 'high',
      enabled: true,
    };
    window.electronAPI.route.upsertGlobalModelRoute = vi
      .fn()
      .mockResolvedValue({ success: true, data: saved });
    await useRouteStore.getState().saveGlobalModelRoute(undefined, saved);
    resolveRefresh({ success: true, data: oldConfig });
    await refresh;
    expect(useRouteStore.getState().config?.globalModelRoutes).toEqual([saved]);

    window.electronAPI.route.getConfig = vi
      .fn()
      .mockResolvedValue({ success: true, data: oldConfig });
    await useRouteStore.getState().refreshRuntimeState();
    expect(useRouteStore.getState().config?.globalModelRoutes).toEqual([]);
  });

  it('keeps client routing settings in the shared store across view remounts', async () => {
    const saved = {
      mode: 'client' as const,
      modelId: 'client-model',
      reasoningEffort: 'high',
      pinned: true,
    };
    window.electronAPI.route.updateClientRouting = vi
      .fn()
      .mockResolvedValue({ success: true, data: saved });
    await useRouteStore.getState().saveClientRouting('client-a', saved);
    expect(useRouteStore.getState().config?.clientRouting?.['client-a']).toEqual(saved);
    window.electronAPI.route.updateClientRouting = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'Disk unavailable' });
    await expect(
      useRouteStore.getState().saveClientRouting('client-a', { mode: 'session' })
    ).rejects.toThrow('Disk unavailable');
    expect(useRouteStore.getState().config?.clientRouting?.['client-a']).toEqual(saved);
  });

  it('updates persisted enablement in the cached config after stopping and starting', async () => {
    await expect(useRouteStore.getState().stopServer()).resolves.toBe(true);
    expect(useRouteStore.getState().serverRunning).toBe(false);
    expect(useRouteStore.getState().config?.server.enabled).toBe(false);

    await expect(useRouteStore.getState().startServer()).resolves.toBe(true);
    expect(useRouteStore.getState().serverRunning).toBe(true);
    expect(useRouteStore.getState().config?.server.enabled).toBe(true);
  });

  it('ignores a stale runtime response that arrives after stopping', async () => {
    let resolveStatus!: (value: unknown) => void;
    window.electronAPI.route.getRuntimeStatus = vi.fn().mockImplementation(
      () =>
        new Promise(resolve => {
          resolveStatus = resolve;
        })
    );
    const polling = useRouteStore.getState().fetchRuntimeStatus();
    await useRouteStore.getState().stopServer();
    resolveStatus({ success: true, data: { running: true } });
    await polling;

    expect(useRouteStore.getState().serverRunning).toBe(false);
  });

  it('refreshes actual runtime state after a stop partially fails', async () => {
    window.electronAPI.route.stopServer = vi.fn().mockResolvedValue({
      success: false,
      error: 'Config persistence failed',
    });

    await expect(useRouteStore.getState().stopServer()).resolves.toBe(false);
    expect(window.electronAPI.route.getRuntimeStatus).toHaveBeenCalledOnce();
    expect(useRouteStore.getState().serverRunning).toBe(false);
  });
});
