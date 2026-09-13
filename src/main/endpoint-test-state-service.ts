/**
 * 端点测试状态服务
 * 输入: 每个接入目标的端点选择与最新结果
 * 输出: 独立的 endpoint-test sidecar 状态
 * 定位: 端点测试持久化层，不读写路由运行态、统计或分析
 */

import * as path from 'path';
import { app } from 'electron';
import type { EndpointTestTargetState } from '../shared/types/endpoint-test';
import Logger from './utils/logger';
import { readJsonFile, writeJsonFileAtomically } from './utils/atomic-json';

const STATE_VERSION = '1';
const MAX_TARGETS = 5000;

interface EndpointTestStateFile {
  version: string;
  targets: Record<string, EndpointTestTargetState>;
  last_updated: number;
}

function emptyState(): EndpointTestStateFile {
  return { version: STATE_VERSION, targets: {}, last_updated: 0 };
}

function normalizeState(value: unknown): EndpointTestStateFile {
  const partial = (value || {}) as Partial<EndpointTestStateFile>;
  return {
    version: partial.version || STATE_VERSION,
    targets: partial.targets || {},
    last_updated: partial.last_updated || 0,
  };
}

function keepNewestTargets(
  targets: Record<string, EndpointTestTargetState>
): Record<string, EndpointTestTargetState> {
  const entries = Object.entries(targets);
  if (entries.length <= MAX_TARGETS) {
    return { ...targets };
  }
  return Object.fromEntries(
    entries.sort((left, right) => right[1].updatedAt - left[1].updatedAt).slice(0, MAX_TARGETS)
  );
}

export class EndpointTestStateService {
  private readonly statePath: string;
  private targets: Record<string, EndpointTestTargetState> = {};
  private loaded = false;

  constructor() {
    this.statePath = path.join(app.getPath('userData'), 'state', 'route-endpoint-tests.json');
  }

  async loadTargets(
    fallback: Record<string, EndpointTestTargetState> = {}
  ): Promise<Record<string, EndpointTestTargetState>> {
    let state = emptyState();
    try {
      state = await readJsonFile(this.statePath, {
        defaultValue: state,
        normalize: normalizeState,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.warn(`端点测试状态读取失败，改用空状态: ${message}`);
    }
    this.targets = { ...state.targets, ...fallback };
    this.loaded = true;
    return this.getTargets();
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.loadTargets();
    }
  }

  getTargets(): Record<string, EndpointTestTargetState> {
    return { ...this.targets };
  }

  async saveTargets(targets: Record<string, EndpointTestTargetState>): Promise<void> {
    const nextTargets = keepNewestTargets(targets);
    const now = Date.now();
    await writeJsonFileAtomically(this.statePath, {
      version: STATE_VERSION,
      targets: nextTargets,
      last_updated: now,
    } satisfies EndpointTestStateFile);
    this.targets = nextTargets;
    this.loaded = true;
  }
}

export const endpointTestStateService = new EndpointTestStateService();
