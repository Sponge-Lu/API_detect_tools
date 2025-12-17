import Logger from '../utils/logger';
/**
 * 站点检测相关 IPC 处理器
 */

import { ipcMain, shell } from 'electron';
import type { ApiService } from '../api-service';
import type { ChromeManager } from '../chrome-manager';

export function registerDetectionHandlers(apiService: ApiService, chromeManager: ChromeManager) {
  // 启动浏览器供登录
  ipcMain.handle('launch-chrome-for-login', async (_, url: string) => {
    return await chromeManager.launchForLogin(url);
  });

  // 带 Cookies 的 fetch 请求
  ipcMain.handle('fetch-with-cookies', async (_, url: string, options: any) => {
    try {
      const axios = require('axios');
      const response = await axios({
        method: options.method || 'GET',
        url: url,
        headers: options.headers || {},
        timeout: 30000,
        validateStatus: () => true,
      });

      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText,
        data: response.data,
      };
    } catch (error: any) {
      Logger.error('fetch-with-cookies错误:', error);
      return {
        ok: false,
        status: 0,
        statusText: error.message,
        data: null,
      };
    }
  });

  // 检测单个站点
  ipcMain.handle(
    'detect-site',
    async (_, site, timeout, quickRefresh = false, cachedData = undefined) => {
      return await apiService.detectSite(site, timeout, quickRefresh, cachedData);
    }
  );

  // 检测所有站点
  ipcMain.handle(
    'detect-all-sites',
    async (_, config, quickRefresh = false, cachedResults = undefined) => {
      return await apiService.detectAllSites(config, quickRefresh, cachedResults);
    }
  );

  // 打开外部 URL
  ipcMain.handle('open-url', async (_, url: string) => {
    await shell.openExternal(url);
  });

  // 关闭浏览器（安全关闭，检查引用计数）
  ipcMain.handle('close-browser', async () => {
    try {
      // 使用 cleanup 检查引用计数，只有在没有其他检测进行时才关闭
      // 这样不会误关正在进行其他站点检测的浏览器
      chromeManager.cleanup();
    } catch (error: any) {
      Logger.error('❌ [IPC] 关闭浏览器失败:', error?.message || error);
    }
  });
}
