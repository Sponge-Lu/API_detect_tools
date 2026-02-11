/**
 * 输入: ApiService, ChromeManager, ConfigDetectionService, TokenService
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
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { ApiService } from '../api-service';
import type { ChromeManager } from '../chrome-manager';
import type { TokenService } from '../token-service';
import { configDetectionService } from '../config-detection-service';
import { CLI_CONFIG_PATHS } from '../../shared/types/config-detection';
import type { SiteInfo, CliType } from '../../shared/types/config-detection';

/**
 * 获取指定 CLI 类型的所有配置文件绝对路径
 */
function getCliConfigFilePaths(cliType: CliType): string[] {
  const home = os.homedir();
  const paths = CLI_CONFIG_PATHS[cliType];
  return Object.values(paths).map((relativePath: string) => path.join(home, relativePath));
}

export function registerDetectionHandlers(
  apiService: ApiService,
  chromeManager: ChromeManager,
  tokenService?: TokenService
) {
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

  // 轻量级余额刷新（签到后使用）
  ipcMain.handle('refresh-balance-only', async (_, site, timeout, checkinStats = undefined) => {
    return await apiService.refreshBalanceOnly(site, timeout, checkinStats);
  });

  // 签到并刷新余额（原子操作，复用浏览器页面）
  ipcMain.handle('checkin-and-refresh', async (_, site, timeout) => {
    if (!tokenService) {
      return { success: false, error: 'TokenService 未初始化' };
    }

    try {
      Logger.info('📝 [IPC] 收到签到并刷新请求');

      // 执行签到
      const checkinResult = await tokenService.checkIn(
        site.url,
        parseInt(site.user_id),
        site.system_token
      );

      // 如果签到失败，直接返回
      if (!checkinResult.success) {
        return {
          checkinResult,
          balanceResult: null,
        };
      }

      // 签到成功，使用浏览器页面刷新余额（如果有）
      let balanceResult;
      try {
        balanceResult = await apiService.refreshBalanceOnly(
          site,
          timeout,
          checkinResult.checkinStats,
          checkinResult.browserPage // 传入浏览器页面
        );
      } catch (balanceError: any) {
        Logger.warn('⚠️ [IPC] 余额刷新失败:', balanceError.message);
        balanceResult = { success: false, error: balanceError.message };
      }

      // 释放浏览器页面引用
      if (checkinResult.pageRelease) {
        Logger.info('🔒 [IPC] 释放签到使用的浏览器页面引用');
        checkinResult.pageRelease();
      }

      // 清理返回结果中的页面引用（不能通过 IPC 传递）
      const cleanCheckinResult = { ...checkinResult };
      delete cleanCheckinResult.browserPage;
      delete cleanCheckinResult.pageRelease;

      return {
        checkinResult: cleanCheckinResult,
        balanceResult,
      };
    } catch (error: any) {
      Logger.error('❌ [IPC] 签到并刷新失败:', error);
      return {
        checkinResult: { success: false, message: error.message },
        balanceResult: null,
      };
    }
  });

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

  // CLI 配置重置：删除指定 CLI 的本地配置文件
  ipcMain.handle('detection:reset-cli-config', async (_, cliType: CliType) => {
    try {
      Logger.info(`[IPC] 重置 ${cliType} 配置 - 删除本地配置文件`);

      const filePaths = getCliConfigFilePaths(cliType);
      const deletedPaths: string[] = [];

      for (const filePath of filePaths) {
        try {
          await fs.access(filePath);
          await fs.unlink(filePath);
          deletedPaths.push(filePath);
          Logger.info(`[IPC] 已删除: ${filePath}`);
        } catch (err: any) {
          if (err.code === 'ENOENT') {
            Logger.info(`[IPC] 文件不存在，跳过: ${filePath}`);
          } else {
            Logger.error(`[IPC] 删除文件失败: ${filePath}`, err?.message || err);
            throw new Error(`删除 ${filePath} 失败: ${err.message}`);
          }
        }
      }

      // 清除该 CLI 的检测缓存
      configDetectionService.clearCacheFor(cliType);

      return { success: true, deletedPaths };
    } catch (error: any) {
      Logger.error(`❌ [IPC] 重置 ${cliType} 配置失败:`, error?.message || error);
      return { success: false, error: error?.message || 'Unknown error', deletedPaths: [] };
    }
  });
}
