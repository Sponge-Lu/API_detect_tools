import Logger from '../utils/logger';
/**
 * 令牌管理相关 IPC 处理器
 */

import { ipcMain, BrowserWindow } from 'electron';
import type { TokenService } from '../token-service';
import type { ChromeManager } from '../chrome-manager';

// 发送站点初始化状态到渲染进程
function sendSiteInitStatus(mainWindow: BrowserWindow | null, status: string) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('site-init-status', status);
  }
}

export function registerTokenHandlers(
  tokenService: TokenService,
  chromeManager: ChromeManager,
  getMainWindow: () => BrowserWindow | null
) {
  // 初始化站点账号
  ipcMain.handle('token:initialize-site', async (_, baseUrl: string) => {
    try {
      const mainWindow = getMainWindow();
      const siteAccount = await tokenService.initializeSiteAccount(
        baseUrl,
        true,
        600000,
        (status: string) => sendSiteInitStatus(mainWindow, status)
      );
      // 站点初始化完成后，关闭浏览器窗口
      Logger.info('🧹 [TokenHandlers] 站点初始化完成，关闭浏览器...');
      chromeManager.forceCleanup();
      return { success: true, data: siteAccount };
    } catch (error: any) {
      Logger.error('初始化站点失败:', error);
      // 即使失败也要尝试关闭浏览器
      try {
        chromeManager.forceCleanup();
      } catch (cleanupError) {
        Logger.warn('⚠️ [TokenHandlers] 关闭浏览器失败:', cleanupError);
      }
      return { success: false, error: error.message };
    }
  });

  // 刷新显示数据
  ipcMain.handle('token:refresh-display-data', async (_, account: any) => {
    try {
      const result = await tokenService.refreshDisplayData(account);
      return { success: result.success, data: result.data, healthStatus: result.healthStatus };
    } catch (error: any) {
      Logger.error('刷新显示数据失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 验证令牌有效性
  ipcMain.handle('token:validate', async (_, account: any) => {
    try {
      const isValid = await tokenService.validateToken(account);
      return { success: true, data: { isValid } };
    } catch (error: any) {
      Logger.error('验证令牌失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取 API 令牌列表
  ipcMain.handle(
    'token:fetch-api-tokens',
    async (_, baseUrl: string, userId: number, accessToken: string) => {
      try {
        Logger.info('📡 [IPC] 收到获取API令牌列表请求');
        const tokens = await tokenService.fetchApiTokens(baseUrl, userId, accessToken);
        return { success: true, data: tokens };
      } catch (error: any) {
        Logger.error('❌ [IPC] 获取API令牌列表失败:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // 创建新的 API 令牌
  ipcMain.handle(
    'token:create-api-token',
    async (_, baseUrl: string, userId: number, accessToken: string, tokenData: any) => {
      try {
        Logger.info('🆕 [IPC] 收到创建 API 令牌请求');
        const result = await tokenService.createApiToken(baseUrl, userId, accessToken, tokenData);
        return { success: result.success, data: result.data };
      } catch (error: any) {
        Logger.error('❌ [IPC] 创建 API 令牌失败:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // 删除 API 令牌
  ipcMain.handle(
    'token:delete-api-token',
    async (_, baseUrl: string, userId: number, accessToken: string, tokenIdentifier: any) => {
      try {
        Logger.info('🗑 [IPC] 收到删除 API 令牌请求');
        const result = await tokenService.deleteApiToken(
          baseUrl,
          userId,
          accessToken,
          tokenIdentifier
        );
        return { success: result.success, data: result.data };
      } catch (error: any) {
        Logger.error('❌ [IPC] 删除 API 令牌失败:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // 获取用户分组信息
  ipcMain.handle(
    'token:fetch-user-groups',
    async (_, baseUrl: string, userId: number, accessToken: string) => {
      try {
        Logger.info('📊 [IPC] 收到获取用户分组请求');
        const result = await tokenService.fetchUserGroups(baseUrl, userId, accessToken);
        return { success: true, data: result };
      } catch (error: any) {
        Logger.error('❌ [IPC] 获取用户分组失败:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // 获取模型定价信息
  ipcMain.handle(
    'token:fetch-model-pricing',
    async (_, baseUrl: string, userId: number, accessToken: string) => {
      try {
        Logger.info('💰 [IPC] 收到获取模型定价请求');
        const result = await tokenService.fetchModelPricing(baseUrl, userId, accessToken);
        return { success: true, data: result };
      } catch (error: any) {
        Logger.error('❌ [IPC] 获取模型定价失败:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // 执行签到
  ipcMain.handle(
    'token:check-in',
    async (_, baseUrl: string, userId: number, accessToken: string) => {
      try {
        Logger.info('📝 [IPC] 收到签到请求');
        const result = await tokenService.checkIn(baseUrl, userId, accessToken);
        return result;
      } catch (error: any) {
        Logger.error('❌ [IPC] 签到失败:', error);
        return { success: false, message: error.message };
      }
    }
  );
}
