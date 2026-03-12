/**
 * 输入: BrowserProfileManager, ChromeManager, UnifiedConfigManager
 * 输出: IPC 事件处理 (browser-profile:*)
 * 定位: IPC 层 - 浏览器 Profile 管理和多账户登录接口
 */

import { ipcMain } from 'electron';
import { browserProfileManager } from '../browser-profile-manager';
import { unifiedConfigManager } from '../unified-config-manager';
import type { ChromeManager } from '../chrome-manager';
import type { BrowserWindow } from 'electron';
import Logger from '../utils/logger';

export function registerBrowserProfileHandlers(
  chromeManager: ChromeManager,
  getMainWindow: () => BrowserWindow | null
): void {
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

      // 使用主 Profile 启动浏览器
      const launchResult = await chromeManager.launchForLogin(siteUrl, result.options);
      if (!launchResult.success) {
        return { success: false, error: launchResult.message };
      }

      // 等待用户登录并获取 localStorage 数据
      const mainWindow = getMainWindow();
      const onStatus = mainWindow
        ? (status: string) => mainWindow.webContents.send('site-init-status', status)
        : undefined;

      const data = await chromeManager.getLocalStorageData(siteUrl, true, 120000, onStatus);
      if (!data.userId || !data.accessToken) {
        return { success: false, error: '未能获取登录凭证' };
      }

      return {
        success: true,
        data: {
          userId: data.userId,
          username: data.username,
          accessToken: data.accessToken,
          authSource: 'main_profile' as const,
        },
      };
    } catch (error: any) {
      Logger.error('[BrowserProfileHandlers] 主浏览器登录失败:', error.message);
      return { success: false, error: error.message };
    }
  });

  // 使用隔离浏览器 Profile 登录（追加账号）
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

        // 使用隔离 Profile 启动浏览器
        const launchResult = await chromeManager.launchForLogin(siteUrl, result.options);
        if (!launchResult.success) {
          return { success: false, error: launchResult.message };
        }

        // 等待用户登录并获取 localStorage 数据
        const mainWindow = getMainWindow();
        const onStatus = mainWindow
          ? (status: string) => mainWindow.webContents.send('site-init-status', status)
          : undefined;

        const data = await chromeManager.getLocalStorageData(siteUrl, true, 120000, onStatus);
        if (!data.userId || !data.accessToken) {
          return { success: false, error: '未能获取登录凭证' };
        }

        return {
          success: true,
          data: {
            userId: data.userId,
            username: data.username,
            accessToken: data.accessToken,
            authSource: 'isolated_profile' as const,
            profilePath: result.options!.userDataDir,
          },
        };
      } catch (error: any) {
        Logger.error('[BrowserProfileHandlers] 隔离浏览器登录失败:', error.message);
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
}
