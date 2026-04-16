/**
 * 输入: BrowserProfileManager, ChromeManager, UnifiedConfigManager
 * 输出: IPC 事件处理 (browser-profile:*)
 * 定位: IPC 层 - 浏览器 Profile 管理和多账户登录接口
 */

import { ipcMain, shell } from 'electron';
import { browserProfileManager } from '../browser-profile-manager';
import { unifiedConfigManager } from '../unified-config-manager';
import type { ChromeManager } from '../chrome-manager';
import type { BrowserWindow } from 'electron';
import Logger from '../utils/logger';
import { detectSiteType } from '../site-type-detector';
import { getSiteTypeProfile } from '../site-type-registry';

export function registerBrowserProfileHandlers(
  chromeManager: ChromeManager,
  getMainWindow: () => BrowserWindow | null
): void {
  const openExternalSite = async (siteUrl: string) => {
    await shell.openExternal(siteUrl);
    return {
      success: true,
      message: '已使用默认浏览器打开站点',
    };
  };

  // 检测主 Chrome Profile 路径
  ipcMain.handle('browser-profile:detect', async () => {
    try {
      const profilePath = await browserProfileManager.detectMainChromeProfile();
      return { success: true, data: profilePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 检查 Chrome 是否正在运行
  ipcMain.handle('browser-profile:is-chrome-running', async () => {
    try {
      const running = await browserProfileManager.isChromeRunning();
      return { success: true, data: running };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 使用主浏览器 Profile 登录（第一个账号）
  ipcMain.handle('browser-profile:login-main', async (_, siteUrl: string) => {
    try {
      const result = await browserProfileManager.getMainProfileLaunchOptions();
      if (!result.success) {
        return { success: false, error: result.error };
      }

      // 使用主 Profile 启动独立登录浏览器
      const launchResult = await chromeManager.launchForLogin(siteUrl, result.options);
      if (!launchResult.success) {
        return { success: false, error: launchResult.message };
      }

      // 等待用户登录并获取 localStorage 数据（使用登录浏览器）
      const mainWindow = getMainWindow();
      const onStatus = mainWindow
        ? (status: string) => mainWindow.webContents.send('site-init-status', status)
        : undefined;

      try {
        const siteType = (await detectSiteType(siteUrl)).siteType;
        const data = await chromeManager.getLocalStorageData(siteUrl, true, 120000, onStatus, {
          loginMode: true,
          siteType,
        });
        if (!data.userId) {
          return { success: false, error: '未能获取用户ID，请确保已登录' };
        }

        // accessToken 缺失时尝试创建
        let accessToken = data.accessToken;
        if (!accessToken && getSiteTypeProfile(siteType).accessTokenMode === 'create-if-missing') {
          Logger.info('[BrowserProfileHandlers] accessToken 缺失，尝试创建...');
          onStatus?.('正在创建访问令牌...');
          accessToken = await chromeManager.createAccessTokenForLogin(siteUrl, data.userId);
        }

        if (!accessToken) {
          return {
            success: false,
            error: '无法获取访问令牌，请在站点中手动生成 Token 后重试',
          };
        }

        return {
          success: true,
          data: {
            userId: data.userId,
            username: data.username,
            accessToken,
            authSource: 'main_profile' as const,
          },
        };
      } finally {
        chromeManager.cleanupLoginBrowser();
      }
    } catch (error: any) {
      Logger.error('[BrowserProfileHandlers] 主浏览器登录失败:', error.message);
      chromeManager.cleanupLoginBrowser();
      return { success: false, error: error.message };
    }
  });

  // 使用隔离浏览器 Profile 登录（追加账号）
  // 完整流程：清理站点残留 → 等待用户登录 → 获取 userId → 创建 accessToken
  ipcMain.handle(
    'browser-profile:login-isolated',
    async (_, siteId: string, siteUrl: string, accountId: string) => {
      try {
        const result = await browserProfileManager.getIsolatedProfileLaunchOptions(
          siteId,
          accountId
        );
        if (!result.success) {
          return { success: false, error: result.error };
        }

        // 使用隔离 Profile 启动独立登录浏览器
        const launchResult = await chromeManager.launchForLogin(siteUrl, result.options);
        if (!launchResult.success) {
          return { success: false, error: launchResult.message };
        }

        // 清理目标站点的残留登录态（仅该域名，不影响同 Profile 下其他站点）
        await chromeManager.clearSiteDataForLogin(siteUrl);

        // 等待用户登录并获取 localStorage 数据（使用登录浏览器）
        const mainWindow = getMainWindow();
        const onStatus = mainWindow
          ? (status: string) => mainWindow.webContents.send('site-init-status', status)
          : undefined;

        try {
          const siteType = (await detectSiteType(siteUrl)).siteType;
          const data = await chromeManager.getLocalStorageData(siteUrl, true, 120000, onStatus, {
            loginMode: true,
            siteType,
          });
          if (!data.userId) {
            return { success: false, error: '未能获取用户ID，请确保已登录' };
          }

          // accessToken 缺失时尝试创建（与第一账号流程一致）
          let accessToken = data.accessToken;
          if (
            !accessToken &&
            getSiteTypeProfile(siteType).accessTokenMode === 'create-if-missing'
          ) {
            Logger.info('[BrowserProfileHandlers] accessToken 缺失，尝试创建...');
            onStatus?.('正在创建访问令牌...');
            accessToken = await chromeManager.createAccessTokenForLogin(siteUrl, data.userId);
          }

          if (!accessToken) {
            return {
              success: false,
              error: '无法获取访问令牌，请在站点中手动生成 Token 后重试',
            };
          }

          return {
            success: true,
            data: {
              userId: data.userId,
              username: data.username,
              accessToken,
              authSource: 'isolated_profile' as const,
              profilePath: result.options!.userDataDir,
            },
          };
        } finally {
          chromeManager.cleanupLoginBrowser();
        }
      } catch (error: any) {
        Logger.error('[BrowserProfileHandlers] 隔离浏览器登录失败:', error.message);
        chromeManager.cleanupLoginBrowser();
        return { success: false, error: error.message };
      }
    }
  );

  // 删除隔离 Profile
  ipcMain.handle('browser-profile:delete-profile', async (_, siteId: string, accountId: string) => {
    try {
      await browserProfileManager.deleteIsolatedProfile(siteId, accountId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 使用账户对应浏览器打开站点
  ipcMain.handle(
    'browser-profile:open-site',
    async (_, siteId: string | undefined, siteUrl: string, accountId?: string) => {
      try {
        if (!siteId || !accountId) {
          return await openExternalSite(siteUrl);
        }

        await unifiedConfigManager.loadConfig();
        const account = unifiedConfigManager.getAccountById(accountId);

        if (!account || account.site_id !== siteId) {
          return await openExternalSite(siteUrl);
        }

        if (account.auth_source === 'isolated_profile') {
          const profileOptions = account.browser_profile_path
            ? { success: true, options: { userDataDir: account.browser_profile_path } }
            : await browserProfileManager.getIsolatedProfileLaunchOptions(siteId, accountId);

          if (!profileOptions.success || !profileOptions.options?.userDataDir) {
            return {
              success: false,
              error: profileOptions.error || '未找到隔离浏览器 Profile',
            };
          }

          return await chromeManager.openSiteWithProfile(siteUrl, {
            userDataDir: profileOptions.options.userDataDir,
          });
        }

        if (account.auth_source === 'main_profile') {
          const mainProfilePath = await browserProfileManager.detectMainChromeProfile();
          if (!mainProfilePath) {
            return {
              success: false,
              error: '未检测到主浏览器 Profile',
            };
          }

          return await chromeManager.openSiteWithProfile(siteUrl, {
            userDataDir: mainProfilePath,
            profileDirectory: 'Default',
          });
        }

        return await openExternalSite(siteUrl);
      } catch (error: any) {
        Logger.error('[BrowserProfileHandlers] 使用账户浏览器打开站点失败:', error.message);
        return { success: false, error: error.message };
      }
    }
  );
}
