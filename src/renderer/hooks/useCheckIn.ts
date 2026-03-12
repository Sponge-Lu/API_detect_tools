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
import type { SiteConfig } from '../../shared/types/site';
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

export function useCheckIn({ showDialog, showAlert, setCheckingIn }: UseCheckInOptions) {
  const { upsertResult, results } = useDetectionStore();
  const { config } = useConfigStore();

  /**
   * 打开站点签到页面
   * @param site 站点配置
   * @param siteType 站点类型（veloera 或 newapi），用于确定签到页面路径
   */
  const openCheckinPage = async (site: SiteConfig, siteType?: 'veloera' | 'newapi') => {
    try {
      const baseUrl = site.url.replace(/\/$/, '');
      // 根据站点类型选择正确的签到页面路径
      // Veloera: /console
      // New API: /console/personal
      const checkinPath = siteType === 'newapi' ? '/console/personal' : '/console';
      const targetUrl = baseUrl + checkinPath;
      await window.electronAPI.openUrl(targetUrl);
    } catch (error) {
      Logger.error('打开浏览器失败:', error);
      showAlert('打开浏览器失败: ' + error, 'error');
    }
  };

  /**
   * 执行签到
   */
  const handleCheckIn = async (site: SiteConfig, accountId?: string) => {
    if (!site.system_token || !site.user_id) {
      const shouldOpenSite = await showDialog({
        type: 'warning',
        title: '签到失败',
        message:
          '缺少必要的认证信息\n\n是否打开网站手动签到？\n\n💡 手动签到后，请手动刷新站点数据',
        confirmText: '打开网站',
      });
      if (shouldOpenSite) {
        // 缺少认证信息时，默认使用 veloera 路径
        await openCheckinPage(site, 'veloera');
      }
      return;
    }

    setCheckingIn(site.name);

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
            // 使用后端返回的站点类型，默认 veloera
            await openCheckinPage(site, checkinResult.siteType || 'veloera');
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
          // 异常情况下，默认使用 veloera 路径
          await openCheckinPage(site, 'veloera');
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
      siteType?: 'veloera' | 'newapi';
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
      setCheckingIn(site.name);

      try {
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
            siteType: checkinResult.siteType || 'veloera',
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
          siteType: 'veloera',
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
              { className: 'text-sm text-[var(--ios-text-secondary)]' },
              `❌ ${r.name}`
            ),
            r.site &&
              React.createElement(
                'button',
                {
                  onClick: () => openCheckinPage(r.site!, r.siteType),
                  className:
                    'text-xs px-2 py-0.5 rounded-md text-[var(--ios-blue)] bg-[var(--ios-blue)]/10 hover:bg-[var(--ios-blue)]/20 transition-colors shrink-0 cursor-pointer',
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
