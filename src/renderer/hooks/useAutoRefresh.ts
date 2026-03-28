/**
 * 输入: SiteConfig[] (站点配置), AccountCredential[] (账户配置), 刷新间隔配置, 回调函数
 * 输出: 自动刷新控制方法 (startRefresh, stopRefresh, setInterval)
 * 定位: 业务逻辑层 - 管理站点自动刷新定时器和状态
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/hooks/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * useAutoRefresh Hook
 * 管理站点自动刷新定时器
 * Requirements: 4.1
 */

import { useEffect, useRef } from 'react';
import { AccountCredential, DetectionResult, SiteConfig } from '../../shared/types/site';

/**
 * Hook 配置选项
 */
export interface UseAutoRefreshOptions {
  /** 站点配置列表 */
  sites: SiteConfig[];
  /** 账户配置列表（用于多账户站点自动刷新） */
  accounts?: AccountCredential[];
  /** 单站点检测函数 */
  detectSingle: (
    site: SiteConfig,
    quickRefresh: boolean,
    config?: any,
    accountId?: string
  ) => Promise<DetectionResult | undefined>;
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
const DEFAULT_INTERVAL = 30;
/** 最小刷新间隔（分钟） */
const MIN_INTERVAL = 15;

/**
 * 获取有效的刷新间隔（分钟）
 */
function getValidInterval(interval?: number): number {
  if (interval === undefined || interval < MIN_INTERVAL) {
    return DEFAULT_INTERVAL;
  }
  return interval;
}

interface AutoRefreshTarget {
  key: string;
  siteKey: string;
  siteName: string;
  accountId?: string;
  accountName?: string;
  interval: number;
}

function getSiteKey(site: SiteConfig): string {
  return site.id || site.name;
}

function getResolvedAccountAutoRefresh(site: SiteConfig, account: AccountCredential): boolean {
  return account.auto_refresh ?? site.auto_refresh ?? false;
}

function getResolvedAccountInterval(site: SiteConfig, account: AccountCredential): number {
  return getValidInterval(account.auto_refresh_interval ?? site.auto_refresh_interval);
}

function buildRefreshTargets(
  sites: SiteConfig[],
  accounts: AccountCredential[]
): Map<string, AutoRefreshTarget> {
  const targets = new Map<string, AutoRefreshTarget>();

  sites.forEach(site => {
    const siteKey = getSiteKey(site);
    const siteAccounts =
      site.id !== undefined ? accounts.filter(account => account.site_id === site.id) : [];

    if (siteAccounts.length > 0) {
      siteAccounts.forEach(account => {
        if (!getResolvedAccountAutoRefresh(site, account)) {
          return;
        }
        targets.set(`${siteKey}::${account.id}`, {
          key: `${siteKey}::${account.id}`,
          siteKey,
          siteName: site.name,
          accountId: account.id,
          accountName: account.account_name,
          interval: getResolvedAccountInterval(site, account),
        });
      });
      return;
    }

    if (site.auto_refresh === true) {
      targets.set(siteKey, {
        key: siteKey,
        siteKey,
        siteName: site.name,
        interval: getValidInterval(site.auto_refresh_interval),
      });
    }
  });

  return targets;
}

/**
 * 自动刷新 Hook
 * 管理站点的自动刷新定时器生命周期
 */
export function useAutoRefresh(options: UseAutoRefreshOptions): UseAutoRefreshReturn {
  const { sites, accounts = [], detectSingle, enabled = true, onRefresh, onError } = options;

  // 存储定时器 Map<siteName, { timerId, interval }>
  const timersRef = useRef<
    Map<string, { timerId: ReturnType<typeof setInterval>; interval: number }>
  >(new Map());

  // 使用 ref 存储最新的回调函数，避免闭包问题
  const callbacksRef = useRef({ detectSingle, onRefresh, onError });
  callbacksRef.current = { detectSingle, onRefresh, onError };

  // 使用 ref 存储最新的 sites，供定时器回调使用
  const sitesRef = useRef(sites);
  sitesRef.current = sites;

  // 使用 ref 存储最新的 accounts，供定时器回调使用
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  // 主 effect：管理定时器生命周期
  useEffect(() => {
    const currentTimers = timersRef.current;

    // 如果全局禁用，清理所有定时器
    if (!enabled) {
      currentTimers.forEach(({ timerId }) => clearInterval(timerId));
      currentTimers.clear();
      return;
    }

    // 构建当前应该有定时器的目标（站点级或账号级）
    const enabledTargetsMap = buildRefreshTargets(sites, accounts);

    // 1. 清理不再需要的定时器（站点/账号被删除或禁用了自动刷新）
    const targetsToRemove: string[] = [];
    currentTimers.forEach((timerInfo, timerKey) => {
      if (!enabledTargetsMap.has(timerKey)) {
        clearInterval(timerInfo.timerId);
        targetsToRemove.push(timerKey);
      }
    });
    targetsToRemove.forEach(name => currentTimers.delete(name));

    // 2. 检查间隔变化，需要重启的定时器
    currentTimers.forEach((timerInfo, timerKey) => {
      const newConfig = enabledTargetsMap.get(timerKey);
      if (newConfig && timerInfo.interval !== newConfig.interval) {
        // 间隔变化，清除旧定时器
        clearInterval(timerInfo.timerId);
        currentTimers.delete(timerKey);
      }
    });

    // 3. 为需要的目标创建新定时器
    enabledTargetsMap.forEach((config, timerKey) => {
      if (!currentTimers.has(timerKey)) {
        const intervalMs = config.interval * 60 * 1000;

        const timerId = setInterval(async () => {
          // 从 ref 获取最新的站点/账号数据和回调
          const currentSite = sitesRef.current.find(site => getSiteKey(site) === config.siteKey);
          if (!currentSite) {
            return;
          }

          let resolvedAccount: AccountCredential | undefined;
          let resolvedInterval = getValidInterval(currentSite.auto_refresh_interval);
          let autoRefreshEnabled = currentSite.auto_refresh === true;

          if (config.accountId) {
            resolvedAccount = accountsRef.current.find(account => account.id === config.accountId);
            if (!resolvedAccount || resolvedAccount.site_id !== currentSite.id) {
              return;
            }
            autoRefreshEnabled = getResolvedAccountAutoRefresh(currentSite, resolvedAccount);
            resolvedInterval = getResolvedAccountInterval(currentSite, resolvedAccount);
          }

          if (!autoRefreshEnabled || resolvedInterval !== config.interval) {
            return;
          }

          const { detectSingle: detect, onRefresh: refresh, onError: error } = callbacksRef.current;
          const displayName = resolvedAccount
            ? `${currentSite.name} (${resolvedAccount.account_name})`
            : currentSite.name;

          try {
            const result = await detect(currentSite, true, undefined, resolvedAccount?.id);
            const failedResult = result?.status === '失败' ? result : undefined;

            if (failedResult) {
              throw new Error(failedResult.error || `${displayName} 自动刷新失败`);
            }

            if (result !== undefined) {
              refresh?.(displayName);
            }
          } catch (err) {
            console.error(`[useAutoRefresh] Error refreshing target ${displayName}:`, err);
            error?.(displayName, err instanceof Error ? err : new Error(String(err)));
          }
        }, intervalMs);

        currentTimers.set(timerKey, { timerId, interval: config.interval });
      }
    });

    // 注意：不在这里清理定时器，因为 sites 变化时我们只需要增量更新
    // 清理函数只在组件真正卸载时执行
  }, [sites, accounts, enabled]);

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
