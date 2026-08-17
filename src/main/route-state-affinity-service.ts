import * as path from 'path';
import { app } from 'electron';
import type { CliTargetProtocol } from '../shared/types/cli-config';
import type { RouteStateAffinitySummary } from '../shared/types/route-proxy';
import { readJsonFile, writeJsonFileAtomically } from './utils/atomic-json';

const STATE_AFFINITY_VERSION = '2';
export const ROUTE_STATE_AFFINITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ROUTE_STATE_AFFINITY_MAX_RECORDS = 5_000;

export type RouteStateResourceType = 'response' | 'conversation' | 'conversation-item';

export interface RouteStateChannelIdentity {
  profileId: string;
  siteId: string;
  accountId: string;
  apiKeyId: string;
  routeRuleId: string;
  targetProtocol: CliTargetProtocol;
  targetEndpoint: string;
}

export interface RouteStateAffinityRecord extends RouteStateChannelIdentity {
  resourceId: string;
  resourceType: RouteStateResourceType;
  parentResourceId?: string;
  createdAt: number;
  expiresAt?: number;
}

interface RouteStateAffinityFile {
  version: string;
  resources: Record<string, RouteStateAffinityRecord>;
  lastUpdated: number;
}

function emptyState(): RouteStateAffinityFile {
  return { version: STATE_AFFINITY_VERSION, resources: {}, lastUpdated: 0 };
}

function normalizeState(value: unknown): RouteStateAffinityFile {
  const partial = (value || {}) as Partial<RouteStateAffinityFile>;
  const resources = Object.fromEntries(
    Object.entries(partial.resources || {}).filter(
      ([resourceId, record]) =>
        resourceId &&
        record?.resourceId === resourceId &&
        record.profileId &&
        record.siteId &&
        record.accountId &&
        record.apiKeyId &&
        record.targetProtocol === 'openai-responses'
    )
  );
  return {
    version: STATE_AFFINITY_VERSION,
    resources,
    lastUpdated: Number(partial.lastUpdated) || 0,
  };
}

function compactResources(
  resources: Record<string, RouteStateAffinityRecord>,
  now: number
): Record<string, RouteStateAffinityRecord> {
  return Object.fromEntries(
    Object.values(resources)
      .filter(record => !record.expiresAt || record.expiresAt > now)
      .map(record => ({
        ...record,
        expiresAt: record.expiresAt ?? now + ROUTE_STATE_AFFINITY_TTL_MS,
      }))
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, ROUTE_STATE_AFFINITY_MAX_RECORDS)
      .map(record => [record.resourceId, record])
  );
}

export class RouteStateAffinityService {
  private state: RouteStateAffinityFile | null = null;
  private loadPromise: Promise<RouteStateAffinityFile> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  getStoragePath(): string {
    return path.join(app.getPath('userData'), 'state', 'route-state-affinity.json');
  }

  async load(): Promise<RouteStateAffinityFile> {
    if (this.state) return this.state;
    if (!this.loadPromise) {
      this.loadPromise = readJsonFile(this.getStoragePath(), {
        defaultValue: emptyState(),
        normalize: normalizeState,
      }).then(state => {
        const normalized = {
          ...state,
          resources: compactResources(state.resources, Date.now()),
        };
        this.state = normalized;
        return normalized;
      });
    }
    return this.loadPromise;
  }

  private enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation);
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  async get(
    resourceId: string,
    profileId: string,
    now = Date.now()
  ): Promise<RouteStateAffinityRecord | null> {
    const state = await this.load();
    const record = state.resources[resourceId];
    if (!record || record.profileId !== profileId) return null;
    if (record.expiresAt && record.expiresAt <= now) {
      await this.remove(resourceId);
      return null;
    }
    return record;
  }

  async bind(record: RouteStateAffinityRecord): Promise<void> {
    if (record.targetProtocol !== 'openai-responses') {
      throw new Error('State affinity requires an OpenAI Responses channel');
    }
    await this.enqueueMutation(async () => {
      const state = await this.load();
      const now = Date.now();
      const resources = compactResources(
        {
          ...state.resources,
          [record.resourceId]: {
            ...record,
            expiresAt: record.expiresAt ?? now + ROUTE_STATE_AFFINITY_TTL_MS,
          },
        },
        now
      );
      const next = { ...state, resources, lastUpdated: now };
      await writeJsonFileAtomically(this.getStoragePath(), next);
      this.state = next;
    });
  }

  async remove(resourceId: string): Promise<void> {
    await this.enqueueMutation(async () => {
      const state = await this.load();
      if (!state.resources[resourceId]) return;
      const resources = Object.fromEntries(
        Object.entries(state.resources).filter(
          ([id, record]) => id !== resourceId && record.parentResourceId !== resourceId
        )
      );
      const next = { ...state, resources, lastUpdated: Date.now() };
      await writeJsonFileAtomically(this.getStoragePath(), next);
      this.state = next;
    });
  }

  private async removeMatching(
    predicate: (record: RouteStateAffinityRecord) => boolean
  ): Promise<number> {
    return this.enqueueMutation(async () => {
      const state = await this.load();
      const removed = Object.values(state.resources).filter(predicate).length;
      if (removed === 0) return 0;
      const resources = Object.fromEntries(
        Object.entries(state.resources).filter(([, record]) => !predicate(record))
      );
      const next = { ...state, resources, lastUpdated: Date.now() };
      await writeJsonFileAtomically(this.getStoragePath(), next);
      this.state = next;
      return removed;
    });
  }

  async removeByProfile(profileId: string): Promise<number> {
    return this.removeMatching(record => record.profileId === profileId);
  }

  async summarizeProfile(profileId: string): Promise<RouteStateAffinitySummary> {
    const records = Object.values((await this.load()).resources).filter(
      record => record.profileId === profileId
    );
    return {
      profileId,
      total: records.length,
      responses: records.filter(record => record.resourceType === 'response').length,
      conversations: records.filter(record => record.resourceType === 'conversation').length,
      conversationItems: records.filter(record => record.resourceType === 'conversation-item')
        .length,
    };
  }

  async removeBySite(siteId: string): Promise<number> {
    return this.removeBySites([siteId]);
  }

  async removeBySites(siteIds: string[]): Promise<number> {
    const ids = new Set(siteIds.filter(Boolean));
    if (ids.size === 0) return 0;
    return this.removeMatching(record => ids.has(record.siteId));
  }

  async removeByAccount(accountId: string): Promise<number> {
    return this.removeMatching(record => record.accountId === accountId);
  }

  async removeByApiKey(apiKeyId: string): Promise<number> {
    return this.removeMatching(record => record.apiKeyId === apiKeyId);
  }
}

export const routeStateAffinityService = new RouteStateAffinityService();
