/**
 * 输入: 持久化后的 CLI 测试结果、renderer stores、Electron IPC
 * 输出: 站点页兼容性结果与路由 CLI 可用性视图的同步刷新
 * 定位: 服务层 - 统一处理手动 CLI 测试落盘后的跨视图回灌
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/services/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import type {
  ClaudeTestDetail,
  CodexTestDetail,
  GeminiTestDetail,
  UnifiedConfig,
} from '../../shared/types/site';
import type { CliCompatibilityResult } from '../store/detectionStore';
import { useDetectionStore } from '../store/detectionStore';
import { useRouteStore } from '../store/routeStore';
import { syncProjectedCliCompatibility } from './cli-compat-projection';

export interface PersistedCliCompatibilityTestSample {
  cliType: 'claudeCode' | 'codex' | 'geminiCli';
  model: string;
  success: boolean;
  testedAt?: number;
  statusCode?: number;
  error?: string;
  claudeDetail?: ClaudeTestDetail;
  codexDetail?: CodexTestDetail;
  geminiDetail?: GeminiTestDetail;
}

interface PersistCliCompatibilityResponse {
  success: boolean;
  error?: string;
  skipped?: boolean;
}

export async function refreshPersistedCliProbeState(): Promise<void> {
  const latestConfig = (await window.electronAPI.loadConfig?.()) as UnifiedConfig | undefined;
  if (latestConfig) {
    await syncProjectedCliCompatibility(
      latestConfig,
      useDetectionStore.getState().setCliCompatibility
    );
  }

  const routeState = useRouteStore.getState();
  await routeState.fetchConfig?.();
  await routeState.fetchCliProbeData?.('7d', true);
}

export async function persistCliCompatibilityResult(
  siteUrl: string,
  result: CliCompatibilityResult,
  options?: {
    accountId?: string;
    samples?: PersistedCliCompatibilityTestSample[];
  }
): Promise<PersistCliCompatibilityResponse> {
  const saveResult = window.electronAPI.cliCompat?.saveResult;
  if (!saveResult) {
    return { success: true, skipped: true };
  }

  const response = await saveResult(siteUrl, result, options?.accountId, options?.samples);
  if (!response?.success) {
    return {
      success: false,
      error: response?.error ?? '未知错误',
    };
  }

  await refreshPersistedCliProbeState();
  return { success: true };
}
