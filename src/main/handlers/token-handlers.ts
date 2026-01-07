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
      // 站点初始化完成后，不立即关闭浏览器
      // 让浏览器保持打开状态，以便后续的 API 调用（如获取模型列表）可以复用同一个浏览器会话
      // 浏览器会在引用计数为0后延迟60秒自动关闭
      Logger.info('✅ [TokenHandlers] 站点初始化完成，浏览器保持打开以便后续 API 调用复用');
      return { success: true, data: siteAccount };
    } catch (error: any) {
      Logger.error('初始化站点失败:', error);
      // 失败时尝试关闭浏览器
      try {
        await chromeManager.forceCleanup();
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

        // 如果签到成功且有浏览器页面，在返回前释放页面
        // 注意：页面会在 ChromeManager 的延迟清理机制中自动关闭
        if (result.success && result.pageRelease) {
          Logger.info('🔒 [IPC] 释放签到使用的浏览器页面引用');
          result.pageRelease();
          // 清理返回结果中的页面引用（不能通过 IPC 传递）
          delete result.browserPage;
          delete result.pageRelease;
        }

        return result;
      } catch (error: any) {
        Logger.error('❌ [IPC] 签到失败:', error);
        return { success: false, message: error.message };
      }
    }
  );
}
