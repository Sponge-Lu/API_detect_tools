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
import type { AccountCredential } from '../../shared/types/site';
import type { DetectionCacheData } from '../../shared/types/site';

export function registerBrowserProfileHandlers(
  chromeManager: ChromeManager,
  getMainWindow: () => BrowserWindow | null
): void {
  const resolveAccount = async (
    siteId: string | undefined,
    accountId?: string
  ): Promise<AccountCredential | null> => {
    if (!siteId || !accountId) {
      return null;
    }

    await unifiedConfigManager.loadConfig();
    const account = unifiedConfigManager.getAccountById(accountId);
    if (!account || account.site_id !== siteId) {
      return null;
    }

    return account;
  };

  const resolveAccountProfileLaunchOptions = async (
    siteId: string | undefined,
    accountId?: string
  ): Promise<
    | {
        success: true;
        options?: { userDataDir?: string; profileDirectory?: string };
        requiresExternalFallback: boolean;
      }
    | {
        success: false;
        error: string;
      }
  > => {
    if (!siteId || !accountId) {
      return {
        success: true,
        requiresExternalFallback: true,
      };
    }

    const account = await resolveAccount(siteId, accountId);
    if (!account) {
      return {
        success: true,
        requiresExternalFallback: true,
      };
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

      return {
        success: true,
        options: {
          userDataDir: profileOptions.options.userDataDir,
        },
        requiresExternalFallback: false,
      };
    }

    if (account.auth_source === 'main_profile') {
      const mainProfilePath = await browserProfileManager.detectMainChromeProfile();
      if (!mainProfilePath) {
        return {
          success: false,
          error: '未检测到主浏览器 Profile',
        };
      }

      return {
        success: true,
        options: {
          userDataDir: mainProfilePath,
          profileDirectory: 'Default',
        },
        requiresExternalFallback: false,
      };
    }

    return {
      success: true,
      requiresExternalFallback: true,
    };
  };

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
        const profileTarget = await resolveAccountProfileLaunchOptions(siteId, accountId);
        if (!profileTarget.success) {
          return {
            success: false,
            error: profileTarget.error,
          };
        }

        if (profileTarget.requiresExternalFallback) {
          return await openExternalSite(siteUrl);
        }

        return await chromeManager.openSiteWithProfile(siteUrl, profileTarget.options);
      } catch (error: any) {
        Logger.error('[BrowserProfileHandlers] 使用账户浏览器打开站点失败:', error.message);
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle(
    'browser-profile:open-site-for-checkin',
    async (_, siteId: string | undefined, siteUrl: string, accountId?: string) => {
      try {
        const account = await resolveAccount(siteId, accountId);
        if (!account) {
          return {
            success: false,
            error: '该站点签到需要账户浏览器登录态，请先选择正确的账户',
          };
        }

        const profileTarget = await resolveAccountProfileLaunchOptions(siteId, accountId);
        if (!profileTarget.success) {
          return {
            success: false,
            error: profileTarget.error,
          };
        }

        if (profileTarget.requiresExternalFallback) {
          if (account.auth_source === 'manual' && account.account_name === '默认账户') {
            return {
              ...(await openExternalSite(siteUrl)),
              message: '已使用默认浏览器打开站点并记为签到完成',
            };
          }

          return {
            success: false,
            error: '该站点签到需要账户浏览器登录态，请先为账户绑定浏览器 Profile',
          };
        }

        await unifiedConfigManager.loadConfig();
        const siteType =
          (siteId ? unifiedConfigManager.getSiteById(siteId)?.site_type : undefined) ||
          (await detectSiteType(siteUrl)).siteType;

        return await chromeManager.openSiteWithProfileForCheckin(siteUrl, profileTarget.options, {
          siteType,
          maxWaitTimeMs: 120000,
          closeDelayMs: 2000,
        });
      } catch (error: any) {
        Logger.error('[BrowserProfileHandlers] 账户浏览器签到失败:', error.message);
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle(
    'browser-profile:persist-checkin-completion',
    async (
      _,
      siteId: string | undefined,
      accountId: string | undefined,
      cachedData: Pick<
        DetectionCacheData,
        'last_refresh' | 'has_checkin' | 'can_check_in' | 'checkin_stats'
      >
    ) => {
      try {
        await unifiedConfigManager.loadConfig();

        if (accountId) {
          const account = siteId ? await resolveAccount(siteId, accountId) : null;
          if (!account) {
            return { success: false, error: '未找到对应的签到账户' };
          }

          const updated = await unifiedConfigManager.updateAccountCachedData(
            accountId,
            current => ({
              ...current,
              ...cachedData,
            })
          );
          return updated ? { success: true } : { success: false, error: '账户签到状态保存失败' };
        }

        if (!siteId) {
          return { success: false, error: '缺少站点信息，无法保存签到状态' };
        }

        const site = unifiedConfigManager.getSiteById(siteId);
        if (!site) {
          return { success: false, error: '未找到对应站点，无法保存签到状态' };
        }

        const updated = await unifiedConfigManager.updateSite(siteId, {
          cached_data: {
            ...(site.cached_data || {}),
            ...cachedData,
          },
        });
        return updated ? { success: true } : { success: false, error: '站点签到状态保存失败' };
      } catch (error: any) {
        Logger.error('[BrowserProfileHandlers] 持久化签到状态失败:', error.message);
        return { success: false, error: error.message };
      }
    }
  );
}
