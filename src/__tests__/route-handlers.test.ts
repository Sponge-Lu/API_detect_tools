import { beforeEach, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { registerRouteHandlers } from '../main/handlers/route-handlers';
import { useRouteStore } from '../renderer/store/routeStore';
import { DEFAULT_ROUTING_CONFIG } from '../shared/types/route-proxy';
import type { GlobalModelRoute, RoutingConfig } from '../shared/types/route-proxy';
import { startProxyServer, getProxyStatus } from '../main/route-proxy-service';

const state = vi.hoisted(() => ({ routing: null as RoutingConfig | null }));

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../main/storage/application-storage', () => ({ getApplicationStorage: () => null }));
vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: {
    getRoutingConfig: () => state.routing,
    updateRouteServerConfig: async (updates: Partial<RoutingConfig['server']>) => {
      Object.assign(state.routing!.server, updates);
    },
    upsertGlobalModelRoute: async (id: string | undefined, updates: Partial<GlobalModelRoute>) => {
      const route = { ...updates, id: id || 'global-search' } as GlobalModelRoute;
      state.routing!.globalModelRoutes = [route];
      return route;
    },
  },
}));
vi.mock('../main/utils/logger', () => ({ default: { scope: () => ({ info: vi.fn() }) } }));
vi.mock('../main/route-session-binding-service', () => ({
  routeSessionBindingService: { listActive: () => [] },
}));
vi.mock('../main/route-model-registry-service', () => ({
  getModelRegistry: () => state.routing!.modelRegistry,
}));
vi.mock('../main/route-proxy-service', () => ({
  startProxyServer: vi.fn(),
  getProxyStatus: vi.fn(() => ({ running: false })),
}));
vi.mock('../main/route-stats-service', () => ({}));
vi.mock('../main/route-analytics-service', () => ({}));
vi.mock('../main/endpoint-test-service', () => ({}));
vi.mock('../main/route-history-service', () => ({}));
vi.mock('../main/route-session-service', () => ({}));
vi.mock('../main/config-file-profile-service', () => ({}));
vi.mock('../main/route-state-affinity-service', () => ({}));
vi.mock('../main/app-data-events', () => ({}));

beforeEach(() => {
  vi.clearAllMocks();
  state.routing = structuredClone(DEFAULT_ROUTING_CONFIG);
  useRouteStore.setState({ config: structuredClone(DEFAULT_ROUTING_CONFIG) });
  registerRouteHandlers();
});

it.each([false, true])(
  'reconciles the listener after saving LAN mode only when running=%s',
  async running => {
    vi.mocked(getProxyStatus).mockReturnValue({ running, host: '127.0.0.1', port: 3210 });
    const registered = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([name]) => name === 'route:save-server-config');
    expect(registered).toBeDefined();
    const result = await registered![1]({} as Electron.IpcMainInvokeEvent, { host: '0.0.0.0' });
    expect(result).toMatchObject({ success: true });
    expect(state.routing!.server.host).toBe('0.0.0.0');
    expect(startProxyServer).toHaveBeenCalledTimes(running ? 1 : 0);
  }
);

it('keeps a created global model card visible through IPC polling and full config reloads', async () => {
  const listener = (channel: string) => {
    const registered = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel);
    if (!registered) throw new Error(`Missing IPC handler: ${channel}`);
    return registered[1];
  };
  const event = {} as Electron.IpcMainInvokeEvent;
  window.electronAPI.route!.upsertGlobalModelRoute = (id, updates) =>
    listener('route:upsert-global-model-route')(event, id, updates);
  window.electronAPI.route!.getConfig = () => listener('route:get-config')(event);
  const card = await useRouteStore.getState().saveGlobalModelRoute(undefined, {
    name: 'Grok Search',
    requestModel: 'grok-4.20-fast',
    modelId: 'search-target',
    reasoningEffort: 'high',
    enabled: true,
  });
  expect(useRouteStore.getState().config?.globalModelRoutes).toEqual([card]);
  expect(await window.electronAPI.route!.getConfig()).toMatchObject({
    success: true,
    data: { globalModelRoutes: [card] },
  });
  await useRouteStore.getState().refreshRuntimeState();
  expect(useRouteStore.getState().config?.globalModelRoutes).toEqual([card]);
  await useRouteStore.getState().fetchConfig();
  expect(useRouteStore.getState().config?.globalModelRoutes).toEqual([card]);
});
