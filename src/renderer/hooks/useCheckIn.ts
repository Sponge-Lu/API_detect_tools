/**
 * 输入: SiteConfig (站点配置), IPC 调用, 对话框和提示
 * 输出: 签到方法 (checkIn, checkInAll), 签到状态
 * 定位: 业务逻辑层 - 管理站点每日签到操作
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

export function useCheckIn({
  showDialog,
  showAlert,
  setCheckingIn,
  detectSingle,
}: UseCheckInOptions) {
  /**
   * 打开站点页面
   * @param site 站点配置
   * @param appendPath 是否添加 /app/me 路径（签到失败时使用）
   */
  const openCheckinPage = async (site: SiteConfig, appendPath = false) => {
    try {
      const baseUrl = site.url.replace(/\/$/, '');
      const targetUrl = appendPath ? baseUrl + '/app/me' : baseUrl;
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
        await openCheckinPage(site, true);
      }
      return;
    }

    setCheckingIn(site.name);

    try {
      const result = await (window.electronAPI as any).token.checkIn(
        site.url,
        parseInt(site.user_id),
        site.system_token
      );

      if (result.success) {
        showAlert(`签到成功！\n\n${result.message}`, 'success', '签到成功');
        if (detectSingle) await detectSingle(site, true);
      } else {
        if (result.needManualCheckIn) {
          const shouldOpenSite = await showDialog({
            type: 'warning',
            title: '自动签到失败',
            message: `${result.message}\n\n是否打开网站手动签到？\n\n💡 手动签到后，请手动刷新站点数据`,
            confirmText: '打开网站',
          });
          if (shouldOpenSite) {
            await openCheckinPage(site, true);
          }
        } else {
          showAlert(result.message, 'alert');
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
          await openCheckinPage(site, true);
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
