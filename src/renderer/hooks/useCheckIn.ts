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

  return {
    handleCheckIn,
    openCheckinPage,
  };
}
