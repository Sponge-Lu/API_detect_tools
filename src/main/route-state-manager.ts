import * as path from 'path';
import { app } from 'electron';
import type {
  EndpointTestTargetState,
  RouteAnalyticsBucket,
  RouteChannelHealth,
  RouteChannelStats,
  RouteEndpointCapabilityState,
  RouteModelSourceRef,
  RoutePathState,
  RoutingConfig,
} from '../shared/types/route-proxy';
import { readJsonFile, writeJsonFileAtomically } from './utils/atomic-json';

const ROUTE_RUNTIME_STATE_VERSION = '1';
const ROUTE_ENDPOINT_TESTS_STATE_VERSION = '1';
const ROUTE_ANALYTICS_STATE_VERSION = '1';
const ROUTE_MODEL_SOURCES_STATE_VERSION = '1';
const MAX_ROUTE_RUNTIME_ITEMS = 5000;
const MAX_ROUTE_ANALYTICS_BUCKETS = 50000;
const MAX_ROUTE_MODEL_SOURCES = 20000;
const ROUTE_RUNTIME_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ROUTE_ANALYTICS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface RouteRuntimeStateFile {
  version: string;
  stats: Record<string, RouteChannelStats>;
  routePathStates: Record<string, RoutePathState>;
  routeEndpointCapabilities: Record<string, RouteEndpointCapabilityState>;
  health: Record<string, RouteChannelHealth>;
  last_updated: number;
}

export interface RouteEndpointTestsStateFile {
  version: string;
  targets: Record<string, EndpointTestTargetState>;
  last_updated: number;
}

export interface RouteAnalyticsStateFile {
  version: string;
  buckets: Record<string, RouteAnalyticsBucket>;
  last_updated: number;
}

export interface RouteModelSourcesStateFile {
  version: string;
  sources: RouteModelSourceRef[];
  last_updated: number;
}

export interface RouteStateSnapshot {
  runtime: RouteRuntimeStateFile;
  endpointTests: RouteEndpointTestsStateFile;
  analytics: RouteAnalyticsStateFile;
  modelSources: RouteModelSourcesStateFile;
}

function emptyRouteEndpointTestsState(): RouteEndpointTestsStateFile {
  return {
    version: ROUTE_ENDPOINT_TESTS_STATE_VERSION,
    targets: {},
    last_updated: 0,
  };
}

function emptyRouteRuntimeState(): RouteRuntimeStateFile {
  return {
    version: ROUTE_RUNTIME_STATE_VERSION,
    stats: {},
    routePathStates: {},
    routeEndpointCapabilities: {},
    health: {},
    last_updated: 0,
  };
}

function emptyRouteAnalyticsState(): RouteAnalyticsStateFile {
  return {
    version: ROUTE_ANALYTICS_STATE_VERSION,
    buckets: {},
    last_updated: 0,
  };
}

function emptyRouteModelSourcesState(): RouteModelSourcesStateFile {
  return {
    version: ROUTE_MODEL_SOURCES_STATE_VERSION,
    sources: [],
    last_updated: 0,
  };
}

function normalizeRouteRuntimeState(value: unknown): RouteRuntimeStateFile {
  const partial = (value || {}) as Partial<RouteRuntimeStateFile>;
  return {
    version: partial.version || ROUTE_RUNTIME_STATE_VERSION,
    stats: partial.stats || {},
    routePathStates: partial.routePathStates || {},
    routeEndpointCapabilities: partial.routeEndpointCapabilities || {},
    health: partial.health || {},
    last_updated: partial.last_updated || 0,
  };
}

function normalizeRouteEndpointTestsState(value: unknown): RouteEndpointTestsStateFile {
  const partial = (value || {}) as Partial<RouteEndpointTestsStateFile>;
  return {
    version: partial.version || ROUTE_ENDPOINT_TESTS_STATE_VERSION,
    targets: partial.targets || {},
    last_updated: partial.last_updated || 0,
  };
}

function normalizeRouteAnalyticsState(value: unknown): RouteAnalyticsStateFile {
  const partial = (value || {}) as Partial<RouteAnalyticsStateFile>;
  return {
    version: partial.version || ROUTE_ANALYTICS_STATE_VERSION,
    buckets: partial.buckets || {},
    last_updated: partial.last_updated || 0,
  };
}

function normalizeRouteModelSourcesState(value: unknown): RouteModelSourcesStateFile {
  const partial = (value || {}) as Partial<RouteModelSourcesStateFile>;
  return {
    version: partial.version || ROUTE_MODEL_SOURCES_STATE_VERSION,
    sources: Array.isArray(partial.sources) ? partial.sources : [],
    last_updated: partial.last_updated || 0,
  };
}

function keepNewestRecordEntries<T>(
  record: Record<string, T>,
  maxItems: number,
  getTimestamp: (value: T) => number,
  options: { now?: number; maxAgeMs?: number } = {}
): Record<string, T> {
  const cutoff =
    typeof options.maxAgeMs === 'number' ? (options.now ?? Date.now()) - options.maxAgeMs : null;
  const entries =
    cutoff === null
      ? Object.entries(record)
      : Object.entries(record).filter(([, value]) => getTimestamp(value) >= cutoff);
  if (entries.length <= maxItems) {
    return Object.fromEntries(entries);
  }

  return Object.fromEntries(
    entries.sort((left, right) => getTimestamp(right[1]) - getTimestamp(left[1])).slice(0, maxItems)
  );
}

export class RouteStateManager {
  private stateDir: string;

  constructor() {
    this.stateDir = path.join(app.getPath('userData'), 'state');
  }

  getRouteRuntimePath(): string {
    return path.join(this.stateDir, 'route-runtime.json');
  }

  getRouteEndpointTestsPath(): string {
    return path.join(this.stateDir, 'route-endpoint-tests.json');
  }

  getRouteAnalyticsPath(): string {
    return path.join(this.stateDir, 'route-analytics.json');
  }

  getRouteModelSourcesPath(): string {
    return path.join(this.stateDir, 'route-model-sources.json');
  }

  async loadSnapshot(): Promise<RouteStateSnapshot> {
    const [runtime, endpointTests, analytics, modelSources] = await Promise.all([
      readJsonFile(this.getRouteRuntimePath(), {
        defaultValue: emptyRouteRuntimeState(),
        normalize: normalizeRouteRuntimeState,
      }),
      readJsonFile(this.getRouteEndpointTestsPath(), {
        defaultValue: emptyRouteEndpointTestsState(),
        normalize: normalizeRouteEndpointTestsState,
      }),
      readJsonFile(this.getRouteAnalyticsPath(), {
        defaultValue: emptyRouteAnalyticsState(),
        normalize: normalizeRouteAnalyticsState,
      }),
      readJsonFile(this.getRouteModelSourcesPath(), {
        defaultValue: emptyRouteModelSourcesState(),
        normalize: normalizeRouteModelSourcesState,
      }),
    ]);

    return { runtime, endpointTests, analytics, modelSources };
  }

  applySnapshotToRouting(routing: RoutingConfig, snapshot: RouteStateSnapshot): void {
    routing.stats = { ...snapshot.runtime.stats, ...routing.stats };
    routing.routePathStates = {
      ...snapshot.runtime.routePathStates,
      ...routing.routePathStates,
    };
    routing.routeEndpointCapabilities = {
      ...snapshot.runtime.routeEndpointCapabilities,
      ...(routing.routeEndpointCapabilities || {}),
    };
    routing.health = { ...snapshot.runtime.health, ...routing.health };
    routing.endpointTests = { ...snapshot.endpointTests.targets, ...routing.endpointTests };
    routing.analytics.buckets = {
      ...snapshot.analytics.buckets,
      ...routing.analytics.buckets,
    };
    routing.modelRegistry.sources =
      routing.modelRegistry.sources.length > 0
        ? routing.modelRegistry.sources
        : [...snapshot.modelSources.sources];
  }

  async saveSnapshotFromRouting(routing: RoutingConfig): Promise<void> {
    await Promise.all([
      this.saveRuntimeState(routing),
      this.saveEndpointTestsState(routing),
      this.saveAnalyticsState(routing),
      this.saveModelSourcesState(routing),
    ]);
  }

  async saveEndpointTestsState(routing: RoutingConfig): Promise<void> {
    const now = Date.now();
    await writeJsonFileAtomically(this.getRouteEndpointTestsPath(), {
      version: ROUTE_ENDPOINT_TESTS_STATE_VERSION,
      targets: keepNewestRecordEntries(
        routing.endpointTests,
        MAX_ROUTE_RUNTIME_ITEMS,
        value => value.updatedAt || 0
      ),
      last_updated: now,
    } satisfies RouteEndpointTestsStateFile);
  }

  async saveRuntimeState(routing: RoutingConfig): Promise<void> {
    const now = Date.now();
    await writeJsonFileAtomically(this.getRouteRuntimePath(), {
      version: ROUTE_RUNTIME_STATE_VERSION,
      stats: keepNewestRecordEntries(
        routing.stats,
        MAX_ROUTE_RUNTIME_ITEMS,
        value => value.lastUsedAt || value.lastSuccessAt || value.lastFailureAt || 0,
        { now, maxAgeMs: ROUTE_RUNTIME_RETENTION_MS }
      ),
      routePathStates: keepNewestRecordEntries(
        routing.routePathStates,
        MAX_ROUTE_RUNTIME_ITEMS,
        value => value.updatedAt || value.lastUsedAt || 0,
        { now, maxAgeMs: ROUTE_RUNTIME_RETENTION_MS }
      ),
      routeEndpointCapabilities: keepNewestRecordEntries(
        routing.routeEndpointCapabilities || {},
        MAX_ROUTE_RUNTIME_ITEMS,
        value => value.updatedAt || value.lastObservedAt || 0,
        { now, maxAgeMs: ROUTE_RUNTIME_RETENTION_MS }
      ),
      health: keepNewestRecordEntries(
        routing.health,
        MAX_ROUTE_RUNTIME_ITEMS,
        value => value.testedAt || 0,
        { now, maxAgeMs: ROUTE_RUNTIME_RETENTION_MS }
      ),
      last_updated: now,
    } satisfies RouteRuntimeStateFile);
  }

  async saveAnalyticsState(routing: RoutingConfig): Promise<void> {
    const now = Date.now();
    await writeJsonFileAtomically(this.getRouteAnalyticsPath(), {
      version: ROUTE_ANALYTICS_STATE_VERSION,
      buckets: keepNewestRecordEntries(
        routing.analytics.buckets,
        MAX_ROUTE_ANALYTICS_BUCKETS,
        value => value.updatedAt || value.bucketStart || 0,
        { now, maxAgeMs: ROUTE_ANALYTICS_RETENTION_MS }
      ),
      last_updated: now,
    } satisfies RouteAnalyticsStateFile);
  }

  async saveModelSourcesState(routing: RoutingConfig): Promise<void> {
    const now = Date.now();
    await writeJsonFileAtomically(this.getRouteModelSourcesPath(), {
      version: ROUTE_MODEL_SOURCES_STATE_VERSION,
      sources: routing.modelRegistry.sources.slice(0, MAX_ROUTE_MODEL_SOURCES),
      last_updated: now,
    } satisfies RouteModelSourcesStateFile);
  }
}

export const routeStateManager = new RouteStateManager();
