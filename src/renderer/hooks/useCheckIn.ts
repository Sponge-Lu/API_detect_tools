/**
 * 输入: SiteConfig (站点配置), IPC 调用, 对话框和提示, DetectionResult (检测结果)
 * 输出: 签到方法 (checkIn, checkInAll), 签到状态
 * 定位: 业务逻辑层 - 管理站点每日签到操作
 *
 * 多账户支持:
 * - handleCheckIn: 接受 accountId，传递到 checkinAndRefresh IPC
 * - handleCheckInAll: 遍历所有 DetectionResult（含 accountId），逐账户签到
 * - 签到结果按 (name, accountId) 精确匹配更新
 *
 * 签到失败时根据站点类型打开对应的手动签到页面:
 * - Veloera: /console
 * - New API: /console/personal
 *
 * 签到成功后使用原子操作（checkinAndRefresh）复用浏览器页面刷新余额
 * 签到成功后更新 lastRefresh 时间戳，确保 SiteCardActions 的 isToday 判断正确
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/hooks/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * 签到逻辑 Hook
 * 从 App.tsx 抽离的签到相关功能
 */

import React from 'react';
import Logger from '../utils/logger';
import {
  BUILTIN_GROUP_IDS,
  type DetectionCacheData,
  type DetectionResult,
  type SiteConfig,
  type SiteType,
} from '../../shared/types/site';
import { useDetectionStore } from '../store/detectionStore';
import { useConfigStore } from '../store/configStore';

interface UseCheckInOptions {
  showDialog: (options: any) => Promise<boolean>;
  showAlert: (
    message: string,
    type: 'success' | 'error' | 'alert' | 'warning',
    title?: string,
    content?: React.ReactNode
  ) => void;
  setCheckingIn: (siteName: string | null) => void;
  detectSingle?: (site: SiteConfig, quickRefresh: boolean) => Promise<void>;
}

const ANY_ROUTER_SITE_NAME = 'any router';
const ANY_ROUTER_CHECKIN_QUOTA = 25 * 500000;

export function useCheckIn({ showDialog, showAlert, setCheckingIn }: UseCheckInOptions) {
  const { upsertResult, results } = useDetectionStore();
  const { config } = useConfigStore();

  const getCheckInKey = (site: SiteConfig, accountId?: string) =>
    accountId ? `${site.name}::${accountId}` : site.name;

  const isAnyRouterSite = (site: SiteConfig) =>
    site.name.trim().toLowerCase() === ANY_ROUTER_SITE_NAME;

  const buildManualCheckinCompletedResult = (site: SiteConfig, accountId?: string) => {
    const existingResult = results.find(r => r.name === site.name && r.accountId === accountId);

    return {
      ...(existingResult || {
        name: site.name,
        url: site.url,
        status: '成功',
        models: [],
        has_checkin: site.has_checkin ?? true,
        accountId,
      }),
      has_checkin: existingResult?.has_checkin ?? site.has_checkin ?? true,
      can_check_in: false,
      lastRefresh: Date.now(),
    };
  };

  const buildCheckinCompletionCache = (
    result: DetectionResult
  ): Pick<
    DetectionCacheData,
    'last_refresh' | 'has_checkin' | 'can_check_in' | 'checkin_stats'
  > => {
    const cachedData: Pick<
      DetectionCacheData,
      'last_refresh' | 'has_checkin' | 'can_check_in' | 'checkin_stats'
    > = {
      last_refresh: result.lastRefresh,
      has_checkin: result.has_checkin ?? true,
      can_check_in: false,
    };

    if (result.checkinStats) {
      cachedData.checkin_stats = {
        today_quota: result.checkinStats.todayQuota,
        checkin_count: result.checkinStats.checkinCount,
        total_checkins: result.checkinStats.totalCheckins,
        site_type: result.checkinStats.siteType,
      };
    }

    return cachedData;
  };

  const persistCheckinCompletion = async (
    site: SiteConfig,
    accountId: string | undefined,
    result: DetectionResult
  ) => {
    if (!window.electronAPI.browserProfile?.persistCheckinCompletion) {
      return true;
    }

    if (!site.id) {
      Logger.warn('⚠️ [useCheckIn] 缺少站点 ID，无法持久化手动签到状态:', site.name);
      return false;
    }

    const persistResult = await window.electronAPI.browserProfile.persistCheckinCompletion(
      site.id,
      accountId,
      buildCheckinCompletionCache(result)
    );

    return persistResult?.success === true;
  };

  const markManualCheckinCompleted = async (site: SiteConfig, accountId?: string) => {
    const nextResult = buildManualCheckinCompletedResult(site, accountId);
    upsertResult(nextResult);

    const persisted = await persistCheckinCompletion(site, accountId, nextResult);
    if (!persisted) {
      Logger.warn('⚠️ [useCheckIn] 手动签到状态已更新到界面，但本地缓存保存失败:', {
        siteId: site.id,
        accountId,
      });
    }
  };

  const resolveManualCheckinSiteType = (siteType?: SiteType): 'veloera' | 'newapi' => {
    switch (siteType) {
      case 'newapi':
      case 'oneapi':
      case 'onehub':
      case 'donehub':
      case 'voapi':
      case 'superapi':
        return 'newapi';
      default:
        return 'veloera';
    }
  };

  const buildAnyRouterCompletedResult = (site: SiteConfig, accountId?: string) => {
    const existingResult = results.find(r => r.name === site.name && r.accountId === accountId);
    if (!existingResult) return null;

    return {
      ...existingResult,
      can_check_in: false,
      checkinStats: {
        ...existingResult.checkinStats,
        todayQuota: ANY_ROUTER_CHECKIN_QUOTA,
        siteType: resolveManualCheckinSiteType(site.site_type),
      },
      lastRefresh: Date.now(),
    };
  };

  const markAnyRouterCheckinCompleted = (site: SiteConfig, accountId?: string) => {
    const nextResult = buildAnyRouterCompletedResult(site, accountId);
    if (!nextResult) return null;
    upsertResult(nextResult);
    return nextResult;
  };

  const performAnyRouterCheckIn = async (
    site: SiteConfig,
    accountId?: string
  ): Promise<{ success: boolean; message: string; quota?: number }> => {
    if (!accountId) {
      return {
        success: false,
        message: 'Any Router 签到需要账户浏览器登录态，请先为该站点绑定账户。',
      };
    }

    if (!window.electronAPI.browserProfile?.openSiteForCheckin) {
      return {
        success: false,
        message: '当前版本缺少 Any Router 浏览器签到能力。',
      };
    }

    const result = await window.electronAPI.browserProfile.openSiteForCheckin(
      site.id,
      site.url.replace(/\/$/, ''),
      accountId
    );

    if (!result?.success) {
      return {
        success: false,
        message: result?.error || 'Any Router 账户浏览器签到失败',
      };
    }

    const nextResult = markAnyRouterCheckinCompleted(site, accountId);
    if (nextResult && window.electronAPI.browserProfile?.persistCheckinCompletion) {
      const persistResult = await window.electronAPI.browserProfile.persistCheckinCompletion(
        site.id,
        accountId,
        {
          last_refresh: nextResult.lastRefresh,
          has_checkin: nextResult.has_checkin ?? true,
          can_check_in: false,
          checkin_stats: {
            today_quota: nextResult.checkinStats?.todayQuota,
            checkin_count: nextResult.checkinStats?.checkinCount,
            total_checkins: nextResult.checkinStats?.totalCheckins,
            site_type: nextResult.checkinStats?.siteType,
          },
        }
      );

      if (!persistResult?.success) {
        return {
          success: true,
          message: `${result.message || '已完成签到'}，但本地签到状态保存失败，重启后可能需要重新刷新`,
          quota: ANY_ROUTER_CHECKIN_QUOTA,
        };
      }
    }

    return {
      success: true,
      message: result.message || '已识别到账户登录状态，等待 2 秒后自动关闭。',
      quota: ANY_ROUTER_CHECKIN_QUOTA,
    };
  };

  /**
   * 打开站点签到页面
   * @param site 站点配置
   * @param siteType 站点类型（veloera 或 newapi），用于确定签到页面路径
   */
  const openCheckinPage = async (site: SiteConfig, siteType?: SiteType): Promise<boolean> => {
    try {
      const baseUrl = site.url.replace(/\/$/, '');
      const manualSiteType = resolveManualCheckinSiteType(siteType);
      // 根据站点类型选择正确的签到页面路径
      // Veloera: /console
      // New API: /console/personal
      const checkinPath = manualSiteType === 'newapi' ? '/console/personal' : '/console';
      const targetUrl = baseUrl + checkinPath;
      await window.electronAPI.openUrl(targetUrl);
      return true;
    } catch (error) {
      Logger.error('打开浏览器失败:', error);
      showAlert('打开浏览器失败: ' + error, 'error');
      return false;
    }
  };

  /**
   * 执行签到
   */
  const handleCheckIn = async (site: SiteConfig, accountId?: string) => {
    const checkInKey = getCheckInKey(site, accountId);

    if (isAnyRouterSite(site)) {
      setCheckingIn(checkInKey);
      try {
        const anyRouterResult = await performAnyRouterCheckIn(site, accountId);
        if (anyRouterResult.success) {
          showAlert(
            `签到成功！\n\n${anyRouterResult.message}\n🎁 获得奖励: $25.00`,
            'success',
            '签到成功'
          );
        } else {
          showAlert(anyRouterResult.message, 'warning');
        }
      } finally {
        setCheckingIn(null);
      }
      return;
    }

    if (!accountId && (!site.system_token || !site.user_id)) {
      const shouldOpenSite = await showDialog({
        type: 'warning',
        title: '签到失败',
        message:
          '缺少必要的认证信息\n\n是否打开网站手动签到？\n\n💡 手动签到后，请手动刷新站点数据',
        confirmText: '打开网站',
      });
      if (shouldOpenSite) {
        const opened = await openCheckinPage(site, site.site_type);
        if (opened) {
          await markManualCheckinCompleted(site, accountId);
        }
      }
      return;
    }

    setCheckingIn(checkInKey);

    try {
      const timeout = config?.settings?.timeout ?? 30;

      // 使用原子操作：签到并刷新余额（复用浏览器页面）
      const { checkinResult, balanceResult } = await (window.electronAPI as any).checkinAndRefresh(
        site,
        timeout,
        accountId
      );

      if (checkinResult.success) {
        showAlert(`签到成功！\n\n${checkinResult.message}`, 'success', '签到成功');

        // 更新前端检测结果
        if (balanceResult?.success) {
          const existingResult = results.find(
            r => r.name === site.name && r.accountId === accountId
          );
          if (existingResult) {
            upsertResult({
              ...existingResult,
              balance: balanceResult.balance,
              can_check_in: false,
              checkinStats: balanceResult.checkinStats || checkinResult.checkinStats,
              lastRefresh: Date.now(),
            });
          }
          Logger.info(`✅ [useCheckIn] 余额刷新成功: ${balanceResult.balance}`);
        } else {
          const existingResult = results.find(
            r => r.name === site.name && r.accountId === accountId
          );
          if (existingResult) {
            upsertResult({
              ...existingResult,
              can_check_in: false,
              checkinStats: checkinResult.checkinStats,
              lastRefresh: Date.now(),
            });
          }
          Logger.warn(`⚠️ [useCheckIn] 余额刷新失败: ${balanceResult?.error || '未知错误'}`);
        }
      } else {
        if (checkinResult.needManualCheckIn) {
          const shouldOpenSite = await showDialog({
            type: 'warning',
            title: '自动签到失败',
            message: `${checkinResult.message}\n\n是否打开网站手动签到？\n\n💡 手动签到后，请手动刷新站点数据`,
            confirmText: '打开网站',
          });
          if (shouldOpenSite) {
            const opened = await openCheckinPage(site, checkinResult.siteType || site.site_type);
            if (opened) {
              await markManualCheckinCompleted(site, accountId);
            }
          }
        } else {
          showAlert(checkinResult.message, 'alert');
        }
      }
    } catch (error: any) {
      Logger.error('签到失败:', error);
      const errorMessage = error?.message || String(error);
      if (
        errorMessage.includes('浏览器已关闭') ||
        errorMessage.includes('操作已取消') ||
        errorMessage.includes('操作已被取消')
      ) {
        showAlert('浏览器已关闭，操作已取消。\n\n请重新打开浏览器后重试签到。', 'warning');
      } else {
        const shouldOpenSite = await showDialog({
          type: 'error',
          title: '签到请求失败',
          message: `${errorMessage}\n\n是否打开网站手动签到？\n\n💡 手动签到后，请手动刷新站点数据`,
          confirmText: '打开网站',
        });
        if (shouldOpenSite) {
          const opened = await openCheckinPage(site, site.site_type);
          if (opened) {
            await markManualCheckinCompleted(site, accountId);
          }
        }
      }
    } finally {
      setCheckingIn(null);
    }
  };

  /**
   * 一键签到：批量签到所有可签到的站点
   * @returns 签到结果摘要
   */
  const handleCheckInAll = async (): Promise<{
    success: number;
    failed: number;
    skipped: number;
  }> => {
    const summary = { success: 0, failed: 0, skipped: 0 };
    const siteResults: {
      name: string;
      success: boolean;
      quota?: number;
      message?: string;
      site?: SiteConfig;
      siteType?: SiteType;
      accountId?: string;
    }[] = [];

    if (!config?.sites) {
      showAlert('没有配置任何站点', 'warning');
      return summary;
    }

    // 构建 site lookup
    const siteMap = new Map(config.sites.map(s => [s.name, s]));

    // 收集所有可签到的 (site, accountId) 对
    type CheckTarget = { site: SiteConfig; accountId?: string; displayName: string };
    const targets: CheckTarget[] = [];

    for (const r of results) {
      const site = siteMap.get(r.name);
      if (!site) continue;
      if (!site.enabled) continue;
      if ((site.group || BUILTIN_GROUP_IDS.DEFAULT) === BUILTIN_GROUP_IDS.UNAVAILABLE) continue;

      // 必须有认证信息（站点级或账户级）
      if (!site.system_token && !site.user_id && !r.accountId) continue;

      // 必须支持签到
      if (!r.has_checkin && !site.force_enable_checkin) continue;

      // 如果今天已签到，跳过
      const isToday = r.lastRefresh
        ? new Date(r.lastRefresh).toDateString() === new Date().toDateString()
        : false;
      if (isToday && r.can_check_in === false) continue;

      targets.push({
        site,
        accountId: r.accountId,
        displayName: r.accountId ? `${r.name}(${r.accountId.slice(0, 6)})` : r.name,
      });
    }

    if (targets.length === 0) {
      showAlert('没有可签到的站点', 'warning');
      return summary;
    }

    Logger.info(`🚀 [useCheckIn] 开始一键签到，共 ${targets.length} 个目标`);

    for (const { site, accountId, displayName } of targets) {
      setCheckingIn(getCheckInKey(site, accountId));

      try {
        if (isAnyRouterSite(site)) {
          const anyRouterResult = await performAnyRouterCheckIn(site, accountId);
          if (anyRouterResult.success) {
            summary.success++;
            siteResults.push({
              name: displayName,
              success: true,
              quota: anyRouterResult.quota,
            });
          } else {
            summary.failed++;
            siteResults.push({
              name: displayName,
              success: false,
              message: anyRouterResult.message,
            });
          }
          continue;
        }

        const timeout = config?.settings?.timeout ?? 30;
        const { checkinResult, balanceResult } = await (
          window.electronAPI as any
        ).checkinAndRefresh(site, timeout, accountId);

        if (checkinResult.success) {
          summary.success++;
          const todayQuota =
            balanceResult?.checkinStats?.todayQuota || checkinResult.checkinStats?.todayQuota;
          siteResults.push({ name: displayName, success: true, quota: todayQuota });

          const existingResult = results.find(
            r => r.name === site.name && r.accountId === accountId
          );
          if (existingResult) {
            upsertResult({
              ...existingResult,
              balance: balanceResult?.balance ?? existingResult.balance,
              can_check_in: false,
              checkinStats: balanceResult?.checkinStats || checkinResult.checkinStats,
              lastRefresh: Date.now(),
            });
          }
        } else {
          summary.failed++;
          siteResults.push({
            name: displayName,
            success: false,
            message: checkinResult.message,
            site,
            siteType: checkinResult.siteType || site.site_type,
            accountId,
          });
        }
      } catch (error: any) {
        summary.failed++;
        const errorMessage = error?.message || String(error);
        siteResults.push({
          name: displayName,
          success: false,
          message: errorMessage,
          site,
          siteType: site.site_type,
          accountId,
        });

        if (
          errorMessage.includes('浏览器已关闭') ||
          errorMessage.includes('操作已取消') ||
          errorMessage.includes('操作已被取消')
        ) {
          showAlert('浏览器已关闭，批量签到已中断', 'warning');
          setCheckingIn(null);
          return summary;
        }
      }
    }

    setCheckingIn(null);

    // 构建签到结果详情消息
    const formatQuota = (quota?: number): string => {
      if (quota === undefined || quota === 0) return '';
      const dollars = quota / 500000;
      if (dollars >= 0.01) return `+$${dollars.toFixed(2)}`;
      if (dollars >= 0.001) return `+$${dollars.toFixed(3)}`;
      return `+$${dollars.toFixed(4)}`;
    };

    const successDetails = siteResults
      .filter(r => r.success)
      .map(r => `✅ ${r.name} ${formatQuota(r.quota)}`)
      .join('\n');

    const failedItems = siteResults.filter(r => !r.success);

    let message = '签到完成！\n\n';
    if (successDetails) message += successDetails;
    if (failedItems.length > 0 && successDetails) message += '\n';

    // 失败站点：构建含"手动签到"按钮的交互内容
    let failedContent: React.ReactNode = undefined;
    if (failedItems.length > 0) {
      failedContent = React.createElement(
        'div',
        { className: 'flex flex-col gap-1.5 mt-1' },
        failedItems.map((r, i) =>
          React.createElement(
            'div',
            { key: i, className: 'flex items-center justify-between gap-2' },
            React.createElement(
              'span',
              { className: 'text-sm text-[var(--text-secondary)]' },
              `❌ ${r.name}`
            ),
            r.site &&
              React.createElement(
                'button',
                {
                  onClick: async () => {
                    const opened = await openCheckinPage(r.site!, r.siteType);
                    if (opened) {
                      await markManualCheckinCompleted(r.site!, r.accountId);
                    }
                  },
                  className:
                    'shrink-0 cursor-pointer rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-xs text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-soft-strong)]',
                },
                '手动签到 →'
              )
          )
        )
      );
    }

    showAlert(message, summary.failed > 0 ? 'warning' : 'success', '一键签到', failedContent);

    Logger.info(`🏁 [useCheckIn] 一键签到完成: 成功=${summary.success}, 失败=${summary.failed}`);
    return summary;
  };

  return {
    handleCheckIn,
    handleCheckInAll,
    openCheckinPage,
  };
}
