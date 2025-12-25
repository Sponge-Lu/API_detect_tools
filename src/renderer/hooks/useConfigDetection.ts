/**
 * 输入: detectionStore (CLI 配置检测状态), configStore (应用配置)
 * 输出: useConfigDetection hook (CLI 配置检测功能)
 * 定位: Hook 层 - 提供 CLI 配置检测的获取和刷新逻辑
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/hooks/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useDetectionStore } from '../store/detectionStore';
import { useConfigStore } from '../store/configStore';
import type { AllCliDetectionResult, SiteInfo } from '../../shared/types/config-detection';

/**
 * useConfigDetection Hook 返回值
 */
export interface UseConfigDetectionResult {
  /** CLI 配置检测结果 */
  detection: AllCliDetectionResult | null;
  /** 是否正在检测 */
  isLoading: boolean;
  /** 刷新检测结果（清除缓存后重新检测） */
  refresh: () => Promise<void>;
  /** 执行检测（不清除缓存） */
  detect: () => Promise<void>;
}

/**
 * CLI 配置检测 Hook
 *
 * 提供 CLI 配置检测结果的获取和刷新功能。
 * 自动从 configStore 中获取站点列表用于匹配。
 *
 * @example
 * ```tsx
 * const { detection, isLoading, refresh } = useConfigDetection();
 *
 * if (isLoading) return <Spinner />;
 *
 * return (
 *   <div>
 *     <p>Claude Code: {detection?.claudeCode.sourceType}</p>
 *     <button onClick={refresh}>刷新</button>
 *   </div>
 * );
 * ```
 */
export function useConfigDetection(): UseConfigDetectionResult {
  const { cliConfigDetection, isDetectingCliConfig, detectCliConfig, clearCliConfigDetection } =
    useDetectionStore();

  const { config } = useConfigStore();

  // 从应用配置中提取站点信息用于匹配
  const sites: SiteInfo[] = useMemo(() => {
    if (!config?.sites) {
      return [];
    }
    return config.sites
      .filter(s => s.url)
      .map(s => ({
        id: s.name, // 使用站点名称作为 ID
        name: s.name,
        url: s.url,
      }));
  }, [config?.sites]);

  // 执行检测（不清除缓存）
  // 即使没有站点也执行检测，只是无法匹配到 managed 站点
  const detect = useCallback(async () => {
    await detectCliConfig(sites);
  }, [detectCliConfig, sites]);

  // 刷新检测结果（清除缓存后重新检测）
  const refresh = useCallback(async () => {
    // 先清除后端缓存
    try {
      await window.electronAPI.configDetection.clearCache();
    } catch (error) {
      console.error('清除 CLI 配置缓存失败:', error);
    }
    // 清除前端状态并重新检测
    clearCliConfigDetection();
    await detectCliConfig(sites);
  }, [clearCliConfigDetection, detectCliConfig, sites]);

  // 当配置加载完成且没有检测结果时，自动执行检测
  useEffect(() => {
    if (config && !cliConfigDetection && !isDetectingCliConfig) {
      detect();
    }
  }, [config, cliConfigDetection, isDetectingCliConfig, detect]);

  return {
    detection: cliConfigDetection,
    isLoading: isDetectingCliConfig,
    refresh,
    detect,
  };
}
