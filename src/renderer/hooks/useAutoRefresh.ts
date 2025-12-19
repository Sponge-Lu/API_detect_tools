/**
 * useAutoRefresh Hook
 * 管理站点自动刷新定时器
 * Requirements: 4.1
 */

import { useEffect, useRef } from 'react';
import { SiteConfig } from '../../shared/types/site';

/**
 * Hook 配置选项
 */
export interface UseAutoRefreshOptions {
  /** 站点配置列表 */
  sites: SiteConfig[];
  /** 单站点检测函数 */
  detectSingle: (site: SiteConfig, quickRefresh: boolean) => Promise<unknown>;
  /** 全局开关，默认 true */
  enabled?: boolean;
  /** 刷新完成回调（用于显示通知） */
  onRefresh?: (siteName: string) => void;
  /** 错误回调 */
  onError?: (siteName: string, error: Error) => void;
}

/**
 * Hook 返回值
 */
export interface UseAutoRefreshReturn {
  /** 当前活跃的定时器数量（用于测试和调试） */
  activeTimerCount: number;
}

/** 默认刷新间隔（分钟） */
const DEFAULT_INTERVAL = 5;
/** 最小刷新间隔（分钟） */
const MIN_INTERVAL = 3;

/**
 * 获取有效的刷新间隔（分钟）
 */
function getValidInterval(interval?: number): number {
  if (interval === undefined || interval < MIN_INTERVAL) {
    return DEFAULT_INTERVAL;
  }
  return interval;
}

/**
 * 自动刷新 Hook
 * 管理站点的自动刷新定时器生命周期
 */
export function useAutoRefresh(options: UseAutoRefreshOptions): UseAutoRefreshReturn {
  const { sites, detectSingle, enabled = true, onRefresh, onError } = options;

  // 存储定时器 Map<siteName, { timerId, interval }>
  const timersRef = useRef<Map<string, { timerId: NodeJS.Timeout; interval: number }>>(new Map());

  // 使用 ref 存储最新的回调函数，避免闭包问题
  const callbacksRef = useRef({ detectSingle, onRefresh, onError });
  callbacksRef.current = { detectSingle, onRefresh, onError };

  // 使用 ref 存储最新的 sites，供定时器回调使用
  const sitesRef = useRef(sites);
  sitesRef.current = sites;

  // 主 effect：管理定时器生命周期
  useEffect(() => {
    const currentTimers = timersRef.current;

    // 如果全局禁用，清理所有定时器
    if (!enabled) {
      currentTimers.forEach(({ timerId }) => clearInterval(timerId));
      currentTimers.clear();
      return;
    }

    // 构建当前应该有定时器的站点配置
    const enabledSitesMap = new Map<string, { interval: number }>();
    sites.forEach(site => {
      if (site.auto_refresh === true) {
        enabledSitesMap.set(site.name, {
          interval: getValidInterval(site.auto_refresh_interval),
        });
      }
    });

    // 1. 清理不再需要的定时器（站点被删除或禁用了自动刷新）
    const sitesToRemove: string[] = [];
    currentTimers.forEach((timerInfo, siteName) => {
      if (!enabledSitesMap.has(siteName)) {
        clearInterval(timerInfo.timerId);
        sitesToRemove.push(siteName);
      }
    });
    sitesToRemove.forEach(name => currentTimers.delete(name));

    // 2. 检查间隔变化，需要重启的定时器
    currentTimers.forEach((timerInfo, siteName) => {
      const newConfig = enabledSitesMap.get(siteName);
      if (newConfig && timerInfo.interval !== newConfig.interval) {
        // 间隔变化，清除旧定时器
        clearInterval(timerInfo.timerId);
        currentTimers.delete(siteName);
      }
    });

    // 3. 为需要的站点创建新定时器
    enabledSitesMap.forEach((config, siteName) => {
      if (!currentTimers.has(siteName)) {
        const intervalMs = config.interval * 60 * 1000;

        const timerId = setInterval(async () => {
          // 从 ref 获取最新的 site 数据和回调
          const currentSite = sitesRef.current.find(s => s.name === siteName);
          if (!currentSite || currentSite.auto_refresh !== true) {
            return; // 站点已被删除或禁用
          }

          const { detectSingle: detect, onRefresh: refresh, onError: error } = callbacksRef.current;

          try {
            await detect(currentSite, true);
            refresh?.(siteName);
          } catch (err) {
            console.error(`[useAutoRefresh] Error refreshing site ${siteName}:`, err);
            error?.(siteName, err instanceof Error ? err : new Error(String(err)));
          }
        }, intervalMs);

        currentTimers.set(siteName, { timerId, interval: config.interval });
      }
    });

    // 注意：不在这里清理定时器，因为 sites 变化时我们只需要增量更新
    // 清理函数只在组件真正卸载时执行
  }, [sites, enabled]);

  // 组件卸载时清理所有定时器
  useEffect(() => {
    return () => {
      timersRef.current.forEach(({ timerId }) => clearInterval(timerId));
      timersRef.current.clear();
    };
  }, []);

  return {
    activeTimerCount: timersRef.current.size,
  };
}
