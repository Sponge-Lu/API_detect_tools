import * as path from 'path';
import { app } from 'electron';
import type { RouteInstance, RouteSessionRoutingConfig } from '../shared/types/route-proxy';
import Logger from './utils/logger';
import { readJsonFile, writeJsonFileAtomically } from './utils/atomic-json';

const ROUTE_SESSION_ACTIVITY_VERSION = '1';
export const ROUTE_SESSION_ACTIVITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ROUTE_SESSION_ACTIVITY_MAX_RECORDS = 5_000;
const ROUTE_SESSION_ACTIVITY_FLUSH_DELAY_MS = 250;

export interface RouteSessionActivityRecord {
  instanceId: string;
  profileId: string;
  lastRequestAt: number;
}

interface RouteSessionActivityFile {
  version: string;
  instances: Record<string, RouteSessionActivityRecord>;
  lastUpdated: number;
}

interface RouteSessionActivityServiceOptions {
  storagePath?: string;
  flushDelayMs?: number;
  now?: () => number;
}

function emptyState(): RouteSessionActivityFile {
  return { version: ROUTE_SESSION_ACTIVITY_VERSION, instances: {}, lastUpdated: 0 };
}

function normalizeState(value: unknown): RouteSessionActivityFile {
  const partial = (value || {}) as Partial<RouteSessionActivityFile>;
  const instances = Object.fromEntries(
    Object.entries(partial.instances || {}).filter(
      ([instanceId, activity]) =>
        instanceId &&
        activity?.instanceId === instanceId &&
        typeof activity.profileId === 'string' &&
        activity.profileId.length > 0 &&
        Number.isFinite(activity.lastRequestAt) &&
        activity.lastRequestAt > 0
    )
  );
  return {
    version: ROUTE_SESSION_ACTIVITY_VERSION,
    instances,
    lastUpdated: Number(partial.lastUpdated) || 0,
  };
}

function compactActivities(
  instances: Record<string, RouteSessionActivityRecord>,
  now: number
): Record<string, RouteSessionActivityRecord> {
  return Object.fromEntries(
    Object.values(instances)
      .filter(activity => now - activity.lastRequestAt <= ROUTE_SESSION_ACTIVITY_TTL_MS)
      .sort((left, right) => right.lastRequestAt - left.lastRequestAt)
      .slice(0, ROUTE_SESSION_ACTIVITY_MAX_RECORDS)
      .map(activity => [activity.instanceId, activity])
  );
}

export class RouteSessionActivityService {
  private state: RouteSessionActivityFile | null = null;
  private loadPromise: Promise<RouteSessionActivityFile> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, RouteSessionActivityRecord>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly storagePath?: string;
  private readonly flushDelayMs: number;
  private readonly now: () => number;

  constructor(options: RouteSessionActivityServiceOptions = {}) {
    this.storagePath = options.storagePath;
    this.flushDelayMs = options.flushDelayMs ?? ROUTE_SESSION_ACTIVITY_FLUSH_DELAY_MS;
    this.now = options.now ?? Date.now;
  }

  getStoragePath(): string {
    return (
      this.storagePath ?? path.join(app.getPath('userData'), 'state', 'route-session-activity.json')
    );
  }

  async load(): Promise<RouteSessionActivityFile> {
    if (this.state) return this.state;
    if (!this.loadPromise) {
      this.loadPromise = readJsonFile(this.getStoragePath(), {
        defaultValue: emptyState(),
        normalize: normalizeState,
      })
        .catch(error => {
          Logger.warn('[RouteSessionActivity] Ignoring unreadable activity state:', error);
          return emptyState();
        })
        .then(state => {
          const normalized = {
            ...state,
            instances: compactActivities(state.instances, this.now()),
          };
          this.state = normalized;
          return normalized;
        });
    }
    return this.loadPromise;
  }

  async hydrate(config: RouteSessionRoutingConfig | undefined): Promise<void> {
    if (!config?.instances) return;
    const state = await this.load();
    for (const instance of Object.values(config.instances)) {
      const activity = state.instances[instance.id];
      if (
        activity &&
        instance.profileId &&
        activity.profileId === instance.profileId &&
        activity.lastRequestAt > (instance.lastRequestAt ?? 0)
      ) {
        instance.lastRequestAt = activity.lastRequestAt;
      }
    }
  }

  touch(instance: Pick<RouteInstance, 'id' | 'profileId' | 'lastRequestAt'>): void {
    if (!instance.profileId || !instance.lastRequestAt) return;
    const current = this.pending.get(instance.id);
    if (!current || instance.lastRequestAt > current.lastRequestAt) {
      this.pending.set(instance.id, {
        instanceId: instance.id,
        profileId: instance.profileId,
        lastRequestAt: instance.lastRequestAt,
      });
    }
    this.scheduleFlush();
  }

  async removeByProfile(profileId: string): Promise<number> {
    for (const [instanceId, activity] of this.pending) {
      if (activity.profileId === profileId) this.pending.delete(instanceId);
    }
    return this.enqueueMutation(async () => {
      const state = await this.load();
      const removed = Object.values(state.instances).filter(
        activity => activity.profileId === profileId
      ).length;
      if (!removed) return 0;
      const instances = Object.fromEntries(
        Object.entries(state.instances).filter(([, activity]) => activity.profileId !== profileId)
      );
      const next = { ...state, instances, lastUpdated: this.now() };
      await writeJsonFileAtomically(this.getStoragePath(), next);
      this.state = next;
      return removed;
    });
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    while (this.pending.size > 0) {
      await this.flushPending();
    }
    await this.mutationQueue;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushPending().catch(error => {
        Logger.error('[RouteSessionActivity] Failed to persist activity:', error);
      });
    }, this.flushDelayMs);
    this.flushTimer.unref?.();
  }

  private async flushPending(): Promise<void> {
    if (!this.pending.size) return;
    const pending = [...this.pending.values()];
    this.pending.clear();
    await this.enqueueMutation(async () => {
      const state = await this.load();
      const merged = { ...state.instances };
      for (const activity of pending) {
        const existing = merged[activity.instanceId];
        if (!existing || activity.lastRequestAt > existing.lastRequestAt) {
          merged[activity.instanceId] = activity;
        }
      }
      const now = this.now();
      const next = {
        version: ROUTE_SESSION_ACTIVITY_VERSION,
        instances: compactActivities(merged, now),
        lastUpdated: now,
      };
      await writeJsonFileAtomically(this.getStoragePath(), next);
      this.state = next;
    });
    if (this.pending.size) this.scheduleFlush();
  }

  private enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation);
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }
}

export const routeSessionActivityService = new RouteSessionActivityService();
