/**
 * 输入: ApiService, ChromeManager, ConfigDetectionService
 * 输出: 注册到 ipcMain 的站点检测和 CLI 配置检测 IPC 事件监听器
 * 定位: 处理器层 - 站点检测和 CLI 配置检测相关 IPC 处理
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/handlers/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import Logger from '../utils/logger';
import { ipcMain, shell } from 'electron';
import type { ApiService } from '../api-service';
import type { ChromeManager } from '../chrome-manager';
import { configDetectionService } from '../config-detection-service';
import type { SiteInfo, CliType } from '../../shared/types/config-detection';

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
    async (
      _,
      site,
      timeout,
      quickRefresh = false,
      cachedData = undefined,
      forceAcceptEmpty = false
    ) => {
      return await apiService.detectSite(site, timeout, quickRefresh, cachedData, forceAcceptEmpty);
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

  // CLI 配置检测：检测单个 CLI 配置
  ipcMain.handle('detection:detect-cli-config', async (_, cliType: CliType, sites: SiteInfo[]) => {
    try {
      Logger.info(`[IPC] 检测 ${cliType} 配置`);
      switch (cliType) {
        case 'claudeCode':
          return await configDetectionService.detectClaudeCode(sites);
        case 'codex':
          return await configDetectionService.detectCodex(sites);
        case 'geminiCli':
          return await configDetectionService.detectGeminiCli(sites);
        default:
          throw new Error(`Unknown CLI type: ${cliType}`);
      }
    } catch (error: any) {
      Logger.error(`❌ [IPC] 检测 ${cliType} 配置失败:`, error?.message || error);
      return {
        sourceType: 'unknown',
        hasApiKey: false,
        error: error?.message || 'Unknown error',
        detectedAt: Date.now(),
      };
    }
  });

  // CLI 配置检测：检测所有 CLI 配置
  ipcMain.handle('detection:detect-all-cli-config', async (_, sites: SiteInfo[]) => {
    try {
      Logger.info('[IPC] 检测所有 CLI 配置');
      return await configDetectionService.detectAll(sites);
    } catch (error: any) {
      Logger.error('❌ [IPC] 检测所有 CLI 配置失败:', error?.message || error);
      return {
        claudeCode: {
          sourceType: 'unknown',
          hasApiKey: false,
          error: error?.message || 'Unknown error',
          detectedAt: Date.now(),
        },
        codex: {
          sourceType: 'unknown',
          hasApiKey: false,
          error: error?.message || 'Unknown error',
          detectedAt: Date.now(),
        },
        geminiCli: {
          sourceType: 'unknown',
          hasApiKey: false,
          error: error?.message || 'Unknown error',
          detectedAt: Date.now(),
        },
      };
    }
  });

  // CLI 配置检测：清除缓存
  ipcMain.handle('detection:clear-cli-config-cache', async (_, cliType?: CliType) => {
    try {
      if (cliType) {
        Logger.info(`[IPC] 清除 ${cliType} 配置缓存`);
        configDetectionService.clearCacheFor(cliType);
      } else {
        Logger.info('[IPC] 清除所有 CLI 配置缓存');
        configDetectionService.clearCache();
      }
      return { success: true };
    } catch (error: any) {
      Logger.error('❌ [IPC] 清除 CLI 配置缓存失败:', error?.message || error);
      return { success: false, error: error?.message || 'Unknown error' };
    }
  });
}
