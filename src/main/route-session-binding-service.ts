/**
 * 会话-通道绑定持久化
 * 输入: RouteInstance 绑定记录、profile/instance 清理请求
 * 输出: state/route-session-bindings.json 侧车（TTL + 上限 + 防抖原子写）
 * 定位: 服务层 - 让并发会话各自粘在不同上游通道；高频写不落 config.json
 */

import * as path from 'path';
import { app } from 'electron';
import type { RouteSessionChannelBinding } from '../shared/types/route-proxy';
import Logger from './utils/logger';
import { readJsonFile, writeJsonFileAtomically } from './utils/atomic-json';

const ROUTE_SESSION_BINDING_VERSION = '1';
export const ROUTE_SESSION_BINDING_TTL_MS = 12 * 60 * 60 * 1000;
export const ROUTE_SESSION_BINDING_MAX_RECORDS = 5_000;
const ROUTE_SESSION_BINDING_FLUSH_DELAY_MS = 250;

interface RouteSessionBindingFile {
  version: string;
  bindings: Record<string, RouteSessionChannelBinding>;
  lastUpdated: number;
}

interface RouteSessionBindingServiceOptions {
  storagePath?: string;
  flushDelayMs?: number;
  now?: () => number;
}

function emptyState(): RouteSessionBindingFile {
  return { version: ROUTE_SESSION_BINDING_VERSION, bindings: {}, lastUpdated: 0 };
}

function isUsableBinding(value: unknown): value is RouteSessionChannelBinding {
  const binding = value as Partial<RouteSessionChannelBinding> | null;
  return Boolean(
    binding &&
      typeof binding.instanceId === 'string' &&
      binding.instanceId.length > 0 &&
      typeof binding.siteId === 'string' &&
      binding.siteId.length > 0 &&
      typeof binding.accountId === 'string' &&
      typeof binding.apiKeyId === 'string' &&
      Number.isFinite(binding.boundAt) &&
      Number.isFinite(binding.lastUsedAt)
  );
}

function normalizeState(value: unknown): RouteSessionBindingFile {
  const partial = (value || {}) as Partial<RouteSessionBindingFile>;
  const bindings = Object.fromEntries(
    Object.entries(partial.bindings || {}).filter(
      ([instanceId, binding]) =>
        instanceId && isUsableBinding(binding) && binding.instanceId === instanceId
    )
  );

  return {
    version: ROUTE_SESSION_BINDING_VERSION,
    bindings,
    lastUpdated: Number(partial.lastUpdated) || 0,
  };
}

function compactBindings(
  bindings: Record<string, RouteSessionChannelBinding>,
  now: number
): Record<string, RouteSessionChannelBinding> {
  return Object.fromEntries(
    Object.values(bindings)
      .filter(binding => now - binding.lastUsedAt <= ROUTE_SESSION_BINDING_TTL_MS)
      .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
      .slice(0, ROUTE_SESSION_BINDING_MAX_RECORDS)
      .map(binding => [binding.instanceId, binding])
  );
}

export class RouteSessionBindingService {
  private state: RouteSessionBindingFile | null = null;
  private loadPromise: Promise<RouteSessionBindingFile> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, RouteSessionChannelBinding>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly storagePath?: string;
  private readonly flushDelayMs: number;
  private readonly now: () => number;

  constructor(options: RouteSessionBindingServiceOptions = {}) {
    this.storagePath = options.storagePath;
    this.flushDelayMs = options.flushDelayMs ?? ROUTE_SESSION_BINDING_FLUSH_DELAY_MS;
    this.now = options.now ?? Date.now;
  }

  getStoragePath(): string {
    return (
      this.storagePath ?? path.join(app.getPath('userData'), 'state', 'route-session-bindings.json')
    );
  }

  async load(): Promise<RouteSessionBindingFile> {
    if (this.state) return this.state;
    if (!this.loadPromise) {
      this.loadPromise = readJsonFile(this.getStoragePath(), {
        defaultValue: emptyState(),
        normalize: normalizeState,
      })
        .catch(error => {
          Logger.warn('[RouteSessionBinding] Ignoring unreadable binding state:', error);
          return emptyState();
        })
        .then(state => {
          const normalized = {
            ...state,
            bindings: compactBindings(state.bindings, this.now()),
          };
          this.state = normalized;
          return normalized;
        });
    }
    return this.loadPromise;
  }

  /** 同步读取：选路在热路径上，不能等待磁盘 */
  get(instanceId: string): RouteSessionChannelBinding | undefined {
    const pending = this.pending.get(instanceId);
    if (pending) return pending;
    return this.state?.bindings[instanceId];
  }

  /** 当前仍在 TTL 内的绑定，供新会话分散规则计算通道占用 */
  listActive(now: number = this.now()): RouteSessionChannelBinding[] {
    const merged = new Map<string, RouteSessionChannelBinding>();
    for (const binding of Object.values(this.state?.bindings ?? {})) {
      merged.set(binding.instanceId, binding);
    }
    for (const binding of this.pending.values()) {
      merged.set(binding.instanceId, binding);
    }

    return [...merged.values()].filter(
      binding => now - binding.lastUsedAt <= ROUTE_SESSION_BINDING_TTL_MS
    );
  }

  bind(binding: RouteSessionChannelBinding): void {
    if (!isUsableBinding(binding)) return;
    this.pending.set(binding.instanceId, binding);
    this.scheduleFlush();
  }

  async removeByInstance(instanceId: string): Promise<boolean> {
    this.pending.delete(instanceId);
    return this.enqueueMutation(async () => {
      const state = await this.load();
      if (!state.bindings[instanceId]) return false;
      const bindings = { ...state.bindings };
      delete bindings[instanceId];
      const next = { ...state, bindings, lastUpdated: this.now() };
      await writeJsonFileAtomically(this.getStoragePath(), next);
      this.state = next;
      return true;
    });
  }

  async removeByProfile(profileId: string): Promise<number> {
    for (const [instanceId, binding] of this.pending) {
      if (binding.profileId === profileId) this.pending.delete(instanceId);
    }
    return this.enqueueMutation(async () => {
      const state = await this.load();
      const removed = Object.values(state.bindings).filter(
        binding => binding.profileId === profileId
      ).length;
      if (!removed) return 0;
      const bindings = Object.fromEntries(
        Object.entries(state.bindings).filter(([, binding]) => binding.profileId !== profileId)
      );
      const next = { ...state, bindings, lastUpdated: this.now() };
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
        Logger.error('[RouteSessionBinding] Failed to persist bindings:', error);
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
      const merged = { ...state.bindings };
      for (const binding of pending) {
        const existing = merged[binding.instanceId];
        if (!existing || binding.lastUsedAt >= existing.lastUsedAt) {
          merged[binding.instanceId] = binding;
        }
      }
      const now = this.now();
      const next = {
        version: ROUTE_SESSION_BINDING_VERSION,
        bindings: compactBindings(merged, now),
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

export const routeSessionBindingService = new RouteSessionBindingService();
