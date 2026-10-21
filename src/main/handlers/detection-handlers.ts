/**
 * 输入: ApiService, ChromeManager, ConfigDetectionService, TokenService, UnifiedConfigManager
 * 输出: 注册到 ipcMain 的站点检测和 CLI 配置检测 IPC 事件监听器
 * 定位: 处理器层 - 站点检测和 CLI 配置检测相关 IPC 处理
 *
 * 多账户支持:
 * - detect-site: accountId → 凭证替换 + 已保存的浏览器 Profile 槽位
 * - checkin-and-refresh: accountId → 凭证替换 + 账户级缓存写入
 * - refresh-balance-only: accountId → 账户级缓存写入
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
import { unifiedConfigManager } from '../unified-config-manager';
import { browserProfileManager } from '../browser-profile-manager';
import { configDetectionService } from '../config-detection-service';
import { isSameLocalDay } from '../../shared/utils/date';
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

function shouldRetryWithRefreshedToken(error?: string): boolean {
  if (!error) return false;

  return (
    error.includes('登录已过期') ||
    error.includes('登录可能已过期') ||
    /HTTP 401/i.test(error) ||
    /HTTP 403/i.test(error)
  );
}

// 批量刷新/签到的 in-flight 互斥：防止连点或与手动操作重叠互相清理浏览器
let refreshAllInFlight = false;
let checkinAllInFlight = false;

/**
 * 解析账户的浏览器自动化槽位。
 * 优先使用账户上持久化的 automation_slot（创建时分配，删账户/排序不漂移）；
 * 旧数据缺失时按绑定 Profile 分配并持久化。
 */
async function resolveAccountBrowserSlot(siteId: string, accountId: string): Promise<number> {
  const slot = await browserProfileManager.ensureAutomationSlot(siteId, accountId);
  if (typeof slot === 'number') {
    return slot;
  }

  throw new Error(`Account not found: ${accountId}`);
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

  // 检测单个站点（支持指定账户凭证）
  ipcMain.handle(
    'detect-site',
    async (
      _,
      site,
      timeout,
      quickRefresh = false,
      cachedData = undefined,
      forceAcceptEmpty = false,
      accountId?: string
    ) => {
      // 如果指定了 accountId，用该账户的凭证覆盖站点配置
      let resolvedSite = site;
      let detectionContext: { accountId: string; browserSlot?: number } | undefined;
      if (accountId) {
        await unifiedConfigManager.getConfig();
        const account = unifiedConfigManager.getAccountById(accountId);
        if (!account) {
          throw new Error(`Account not found: ${accountId}`);
        }
        const canonicalSite = unifiedConfigManager.getSiteById(account.site_id);
        if (!canonicalSite) {
          throw new Error(`Site not found for account ${accountId}`);
        }
        if (site?.id && account.site_id !== site.id) {
          throw new Error(`Account ${accountId} does not belong to site ${site.id}`);
        }
        resolvedSite = {
          ...site,
          ...canonicalSite,
          system_token: account.access_token,
          user_id: account.user_id,
          api_key: account.api_key || '',
        };
        // 浏览器槽位：优先账户持久化的 automation_slot，避免账户增删/排序导致串号
        const slot = await resolveAccountBrowserSlot(account.site_id, accountId);
        detectionContext = {
          accountId: account.id,
          browserSlot: slot,
        };
        const firstResult = await apiService.detectSite(
          resolvedSite,
          timeout,
          quickRefresh,
          cachedData,
          forceAcceptEmpty,
          detectionContext
        );

        if (
          firstResult.status === '失败' &&
          tokenService &&
          shouldRetryWithRefreshedToken(firstResult.error)
        ) {
          Logger.info(
            `🔄 [DetectionHandlers] 检测失败且疑似 token 失效，尝试为账户 ${accountId} 自动补发 access_token`
          );
          try {
            const refreshContext = {
              browserSlot: detectionContext.browserSlot,
              challengeWaitMs: 10000,
            };
            const accountUserId = parseInt(account.user_id, 10);
            const refreshedToken =
              canonicalSite.site_type === 'sub2api'
                ? await tokenService.recreateSub2ApiAccessTokenFromBrowser(
                    canonicalSite.url,
                    accountUserId,
                    refreshContext
                  )
                : await tokenService.recreateAccessTokenFromBrowser(
                    canonicalSite.url,
                    accountUserId,
                    refreshContext
                  );

            await unifiedConfigManager.updateAccount(account.id, {
              access_token: refreshedToken,
            });

            resolvedSite = {
              ...resolvedSite,
              system_token: refreshedToken,
              user_id: account.user_id,
            };

            Logger.info(
              `✅ [DetectionHandlers] access_token 已刷新，重试站点检测: ${canonicalSite.name}`
            );
            return await apiService.detectSite(
              resolvedSite,
              timeout,
              quickRefresh,
              cachedData,
              forceAcceptEmpty,
              detectionContext
            );
          } catch (refreshError: any) {
            Logger.warn(
              `⚠️ [DetectionHandlers] 自动刷新 access_token 失败，保留原错误: ${refreshError.message}`
            );
          }
        }

        return firstResult;
      }
      return await apiService.detectSite(
        resolvedSite,
        timeout,
        quickRefresh,
        cachedData,
        forceAcceptEmpty,
        detectionContext
      );
    }
  );

  // 轻量级余额刷新（签到后使用，支持账户级缓存）
  ipcMain.handle(
    'refresh-balance-only',
    async (_, site, timeout, checkinStats = undefined, accountId?: string) => {
      return await apiService.refreshBalanceOnly(site, timeout, checkinStats, undefined, accountId);
    }
  );

  // 签到并刷新余额（原子操作，复用浏览器页面）
  ipcMain.handle('checkin-and-refresh', async (_, site, timeout, accountId?: string) => {
    if (!tokenService) {
      return { success: false, error: 'TokenService 未初始化' };
    }

    // 如果指定了 accountId，用该账户的凭证覆盖站点配置
    let browserSlot: number | undefined;
    if (accountId) {
      const account = unifiedConfigManager.getAccountById(accountId);
      if (!account) {
        return {
          checkinResult: {
            success: false,
            message: `未找到指定账户: ${accountId}`,
            needManualCheckIn: true,
          },
          balanceResult: null,
        };
      }
      if (!account.access_token || !account.user_id) {
        return {
          checkinResult: {
            success: false,
            message: '当前账户缺少 access token 或用户 ID，请重新获取站点信息',
            needManualCheckIn: true,
          },
          balanceResult: null,
        };
      }
      site = { ...site, system_token: account.access_token, user_id: account.user_id };
      browserSlot = await resolveAccountBrowserSlot(account.site_id, accountId);
    }

    try {
      Logger.info('📝 [IPC] 收到签到并刷新请求');

      // 执行签到（browserSlot 用于 Cloudflare 拦截时的浏览器回退，避免多账户共用 slot-0 会话）
      const checkinResult = await tokenService.checkIn(
        site.url,
        parseInt(site.user_id),
        site.system_token,
        undefined,
        site.site_type,
        browserSlot
      );

      // 如果签到失败，直接返回
      if (!checkinResult.success) {
        return {
          checkinResult,
          balanceResult: null,
        };
      }

      // 签到成功，使用浏览器页面刷新余额（如果有）；跳过 HTTP 缓存避免回显签到前旧余额
      let balanceResult;
      try {
        balanceResult = await apiService.refreshBalanceOnly(
          site,
          timeout,
          checkinResult.checkinStats,
          checkinResult.browserPage,
          accountId,
          { skipHttpCache: true }
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

  ipcMain.handle('close-login-browser', async () => {
    try {
      chromeManager.cleanupLoginBrowser();
    } catch (error: any) {
      Logger.error('❌ [IPC] 关闭登录浏览器失败:', error?.message || error);
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

  // CLI 配置编辑：读取指定 CLI 的所有配置文件内容
  ipcMain.handle('detection:read-cli-config-files', async (_, cliType: CliType) => {
    try {
      const home = os.homedir();
      const pathEntries = CLI_CONFIG_PATHS[cliType];
      const files: {
        key: string;
        relativePath: string;
        absolutePath: string;
        content: string | null;
        exists: boolean;
      }[] = [];

      for (const [key, relativePath] of Object.entries(pathEntries)) {
        const absolutePath = path.join(home, relativePath as string);
        let content: string | null = null;
        let exists = false;
        try {
          content = await fs.readFile(absolutePath, 'utf-8');
          exists = true;
        } catch {
          // 文件不存在
        }
        files.push({ key, relativePath: `~/${relativePath}`, absolutePath, content, exists });
      }

      return { success: true, files };
    } catch (error: any) {
      return { success: false, error: error?.message, files: [] };
    }
  });

  // CLI 配置编辑：保存单个配置文件
  ipcMain.handle(
    'detection:save-cli-config-file',
    async (_, absolutePath: string, content: string) => {
      try {
        const dir = path.dirname(absolutePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(absolutePath, content, 'utf-8');
        Logger.info(`[IPC] 配置文件已保存: ${absolutePath}`);
        return { success: true };
      } catch (error: any) {
        Logger.error(`[IPC] 保存配置文件失败: ${absolutePath}`, error?.message);
        return { success: false, error: error?.message };
      }
    }
  );

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

  // 批量刷新所有托管站点账号 + 直连配置模型
  ipcMain.handle('site:refreshAll', async () => {
    if (!tokenService) {
      return {
        success: false,
        error: 'TokenService 未初始化',
        sites: [],
        customConfigs: [],
      };
    }
    if (refreshAllInFlight) {
      return {
        success: false,
        error: '批量刷新正在进行中，请等待完成',
        sites: [],
        customConfigs: [],
      };
    }
    refreshAllInFlight = true;

    try {
      Logger.info('[IPC] 批量刷新所有托管站点账号 + 直连配置模型');
      const config = await unifiedConfigManager.exportConfig();
      const siteResults: Array<{
        siteId: string;
        accountId: string;
        success: boolean;
        error?: string;
      }> = [];
      const customConfigResults: Array<{
        configId: string;
        success: boolean;
        models: string[];
        error?: string;
      }> = [];

      // 刷新托管站点账号
      for (const site of config.sites) {
        const accounts = config.accounts.filter(acc => acc.site_id === site.id);
        for (const account of accounts) {
          if (!account.access_token || !account.user_id) {
            siteResults.push({
              siteId: site.id,
              accountId: account.id,
              success: false,
              error: '账号缺少 access token 或用户 ID',
            });
            continue;
          }

          try {
            const browserSlot = await resolveAccountBrowserSlot(site.id, account.id);

            const refreshedToken =
              site.site_type === 'sub2api'
                ? await tokenService.recreateSub2ApiAccessTokenFromBrowser(
                    site.url,
                    parseInt(account.user_id),
                    { browserSlot, challengeWaitMs: 10000 }
                  )
                : await tokenService.recreateAccessTokenFromBrowser(
                    site.url,
                    parseInt(account.user_id),
                    { browserSlot, challengeWaitMs: 10000 }
                  );

            await unifiedConfigManager.updateAccount(account.id, {
              access_token: refreshedToken,
            });

            siteResults.push({ siteId: site.id, accountId: account.id, success: true });
            Logger.info(`✅ 刷新成功: ${site.name} / ${account.account_name}`);
          } catch (error: any) {
            siteResults.push({
              siteId: site.id,
              accountId: account.id,
              success: false,
              error: error.message,
            });
            Logger.warn(`⚠️ 刷新失败: ${site.name} / ${account.account_name} - ${error.message}`);
          }
        }
      }

      // 刷新直连配置模型
      const { fetchAllModels } = await import('../custom-cli-model-service');
      const customResults = await fetchAllModels();
      customConfigResults.push(...customResults);

      return { success: true, sites: siteResults, customConfigs: customConfigResults };
    } catch (error: any) {
      Logger.error('❌ [IPC] 批量刷新失败:', error);
      return { success: false, error: error.message, sites: [], customConfigs: [] };
    } finally {
      refreshAllInFlight = false;
    }
  });

  // 批量签到所有托管站点账号
  ipcMain.handle('site:checkinAll', async () => {
    if (!tokenService) {
      return { success: false, error: 'TokenService 未初始化', results: [] };
    }
    if (checkinAllInFlight) {
      return { success: false, error: '批量签到正在进行中，请等待完成', results: [] };
    }
    checkinAllInFlight = true;

    try {
      Logger.info('[IPC] 批量签到所有托管站点账号');
      const config = await unifiedConfigManager.exportConfig();
      const checkinSites = config.sites.filter(site => site.has_checkin);
      const results: Array<{
        siteId: string;
        accountId: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const site of checkinSites) {
        const accounts = config.accounts.filter(acc => acc.site_id === site.id);
        for (const account of accounts) {
          // 今日已签的账户跳过，避免对站点重复 POST 得到"已签到"错误
          const cached = account.cached_data;
          if (cached?.can_check_in === false && isSameLocalDay(cached.last_refresh)) {
            results.push({ siteId: site.id, accountId: account.id, success: true });
            continue;
          }
          if (!account.access_token || !account.user_id) {
            results.push({
              siteId: site.id,
              accountId: account.id,
              success: false,
              error: '账号缺少 access token 或用户 ID',
            });
            continue;
          }

          try {
            const browserSlot = await resolveAccountBrowserSlot(site.id, account.id);
            const checkinResult = await tokenService.checkIn(
              site.url,
              parseInt(account.user_id),
              account.access_token,
              undefined,
              site.site_type,
              browserSlot
            );

            if (checkinResult.pageRelease) {
              checkinResult.pageRelease();
            }

            if (checkinResult.success) {
              results.push({ siteId: site.id, accountId: account.id, success: true });
              Logger.info(`✅ 签到成功: ${site.name} / ${account.account_name}`);
            } else {
              results.push({
                siteId: site.id,
                accountId: account.id,
                success: false,
                error: checkinResult.message || '签到失败',
              });
              Logger.warn(
                `⚠️ 签到失败: ${site.name} / ${account.account_name} - ${checkinResult.message}`
              );
            }
          } catch (error: any) {
            results.push({
              siteId: site.id,
              accountId: account.id,
              success: false,
              error: error.message,
            });
            Logger.warn(`⚠️ 签到失败: ${site.name} / ${account.account_name} - ${error.message}`);
          }
        }
      }

      return { success: true, results };
    } catch (error: any) {
      Logger.error('❌ [IPC] 批量签到失败:', error);
      return { success: false, error: error.message, results: [] };
    } finally {
      checkinAllInFlight = false;
    }
  });
}
