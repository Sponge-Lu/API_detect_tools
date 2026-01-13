/**
 * 输入: SiteConfig (站点配置), IPC 调用, 对话框和提示
 * 输出: 签到方法 (checkIn, checkInAll), 签到状态
 * 定位: 业务逻辑层 - 管理站点每日签到操作
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

import Logger from '../utils/logger';
import type { SiteConfig } from '../../shared/types/site';
import { useDetectionStore } from '../store/detectionStore';
import { useConfigStore } from '../store/configStore';

interface UseCheckInOptions {
  showDialog: (options: any) => Promise<boolean>;
  showAlert: (
    message: string,
    type: 'success' | 'error' | 'alert' | 'warning',
    title?: string
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
  const handleCheckIn = async (site: SiteConfig) => {
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
        timeout
      );

      if (checkinResult.success) {
        showAlert(`签到成功！\n\n${checkinResult.message}`, 'success', '签到成功');

        // 更新前端检测结果
        if (balanceResult?.success) {
          const existingResult = results.find(r => r.name === site.name);
          if (existingResult) {
            upsertResult({
              ...existingResult,
              balance: balanceResult.balance,
              can_check_in: false, // 签到成功后设为已签到
              checkinStats: balanceResult.checkinStats || checkinResult.checkinStats,
              lastRefresh: Date.now(), // 更新刷新时间，确保 isToday 判断正确
            });
          }
          Logger.info(`✅ [useCheckIn] 余额刷新成功: ${balanceResult.balance}`);
        } else {
          // 余额刷新失败，但签到成功，仍然更新签到状态
          const existingResult = results.find(r => r.name === site.name);
          if (existingResult) {
            upsertResult({
              ...existingResult,
              can_check_in: false,
              checkinStats: checkinResult.checkinStats,
              lastRefresh: Date.now(), // 更新刷新时间，确保 isToday 判断正确
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
    // 收集每个站点的签到结果详情
    const siteResults: { name: string; success: boolean; quota?: number; message?: string }[] = [];

    if (!config?.sites) {
      showAlert('没有配置任何站点', 'warning');
      return summary;
    }

    // 筛选出所有可以签到的站点
    const checkablesSites = config.sites.filter(site => {
      // 必须有认证信息
      if (!site.system_token || !site.user_id) return false;

      // 必须支持签到
      const siteResult = results.find(r => r.name === site.name);
      if (!siteResult?.has_checkin && !site.force_enable_checkin) return false;

      // 检查缓存是否是今天的数据
      const isToday = siteResult?.lastRefresh
        ? new Date(siteResult.lastRefresh).toDateString() === new Date().toDateString()
        : false;

      // 如果是今天的缓存且已签到，则跳过
      if (isToday && siteResult?.can_check_in === false) return false;

      return true;
    });

    if (checkablesSites.length === 0) {
      showAlert('没有可签到的站点', 'warning');
      return summary;
    }

    Logger.info(`🚀 [useCheckIn] 开始一键签到，共 ${checkablesSites.length} 个站点`);

    // 顺序签到每个站点
    for (const site of checkablesSites) {
      setCheckingIn(site.name);

      try {
        const timeout = config?.settings?.timeout ?? 30;
        const { checkinResult, balanceResult } = await (
          window.electronAPI as any
        ).checkinAndRefresh(site, timeout);

        if (checkinResult.success) {
          summary.success++;
          // 获取签到金额 (从 checkinStats 中提取)
          const todayQuota =
            balanceResult?.checkinStats?.todayQuota || checkinResult.checkinStats?.todayQuota;
          siteResults.push({ name: site.name, success: true, quota: todayQuota });
          Logger.info(`✅ [useCheckIn] ${site.name} 签到成功, quota=${todayQuota}`);

          // 更新前端检测结果
          const existingResult = results.find(r => r.name === site.name);
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
          siteResults.push({ name: site.name, success: false, message: checkinResult.message });
          Logger.warn(`❌ [useCheckIn] ${site.name} 签到失败: ${checkinResult.message}`);
        }
      } catch (error: any) {
        summary.failed++;
        const errorMessage = error?.message || String(error);
        siteResults.push({ name: site.name, success: false, message: errorMessage });
        Logger.error(`❌ [useCheckIn] ${site.name} 签到异常:`, error);

        // 如果浏览器已关闭，中断批量签到
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

    const failedDetails = siteResults
      .filter(r => !r.success)
      .map(r => `❌ ${r.name}`)
      .join('\n');

    let message = '签到完成！\n\n';
    if (successDetails) message += successDetails + '\n';
    if (failedDetails) message += '\n' + failedDetails;

    showAlert(message, summary.failed > 0 ? 'warning' : 'success', '一键签到');

    Logger.info(`🏁 [useCheckIn] 一键签到完成: 成功=${summary.success}, 失败=${summary.failed}`);
    return summary;
  };

  return {
    handleCheckIn,
    handleCheckInAll,
    openCheckinPage,
  };
}
