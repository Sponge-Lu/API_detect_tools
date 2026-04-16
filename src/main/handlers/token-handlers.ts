import Logger from '../utils/logger';
/**
 * 输入: TokenService, ChromeManager, UnifiedConfigManager
 * 输出: IPC 事件处理 (token:*)
 * 定位: IPC 层 - 令牌管理接口，支持多账户凭证初始化
 */

import { ipcMain, BrowserWindow } from 'electron';
import type { TokenService } from '../token-service';
import { isMaskedApiKeyValue, mergeApiKeysPreservingRawValue } from '../token-service';
import type { ChromeManager } from '../chrome-manager';
import { unifiedConfigManager } from '../unified-config-manager';
import type { AccountAuthSource } from '../../shared/types/site';

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
  const persistApiKeysCache = async (
    siteUrl: string,
    apiKeys: any[] | undefined,
    accountId?: string
  ): Promise<void> => {
    if (!Array.isArray(apiKeys)) {
      return;
    }

    if (accountId) {
      await unifiedConfigManager.updateAccountCachedData(accountId, current => ({
        ...(current || {}),
        api_keys: mergeApiKeysPreservingRawValue(current?.api_keys, apiKeys),
        last_refresh: Date.now(),
      }));
      return;
    }

    const site = unifiedConfigManager.getSiteByUrl(siteUrl);
    if (!site) {
      return;
    }

    await unifiedConfigManager.updateSite(site.id, {
      cached_data: {
        ...(site.cached_data || {}),
        api_keys: mergeApiKeysPreservingRawValue(site.cached_data?.api_keys, apiKeys),
        last_refresh: Date.now(),
      },
    });
  };

  const persistResolvedApiKeyValue = async (
    siteUrl: string,
    apiKeyId: string,
    rawValue: string,
    accountId?: string
  ): Promise<void> => {
    const applyResolvedValue = (apiKeys: any[] | undefined) => {
      if (!Array.isArray(apiKeys)) {
        return apiKeys;
      }

      return apiKeys.map(item => {
        const itemId =
          item?.id !== undefined && item?.id !== null
            ? String(item.id)
            : item?.token_id !== undefined && item?.token_id !== null
              ? String(item.token_id)
              : null;
        if (itemId !== apiKeyId) {
          return item;
        }

        if ('token' in item && !('key' in item)) {
          return { ...item, token: rawValue };
        }

        return { ...item, key: rawValue };
      });
    };

    if (accountId) {
      await unifiedConfigManager.updateAccountCachedData(accountId, current => ({
        ...(current || {}),
        api_keys: applyResolvedValue(current?.api_keys),
        last_refresh: Date.now(),
      }));
      return;
    }

    const site = unifiedConfigManager.getSiteByUrl(siteUrl);
    if (!site) {
      return;
    }

    await unifiedConfigManager.updateSite(site.id, {
      cached_data: {
        ...(site.cached_data || {}),
        api_keys: applyResolvedValue(site.cached_data?.api_keys),
        last_refresh: Date.now(),
      },
    });
  };

  const resolveBrowserSlot = async (accountId?: string): Promise<number | undefined> => {
    if (!accountId) {
      return undefined;
    }

    await unifiedConfigManager.loadConfig();
    const account = unifiedConfigManager.getAccountById(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    const siteAccounts = unifiedConfigManager.getAccountsBySiteId(account.site_id);
    const slotIndex = siteAccounts.findIndex(item => item.id === accountId);
    return slotIndex >= 0 ? slotIndex : 0;
  };

  // 初始化站点账号
  ipcMain.handle('token:initialize-site', async (_, baseUrl: string) => {
    try {
      const mainWindow = getMainWindow();
      const siteAccount = await tokenService.initializeSiteAccount(
        baseUrl,
        true,
        600000,
        (status: string) => sendSiteInitStatus(mainWindow, status),
        { loginMode: true }
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
    async (_, baseUrl: string, userId: number, accessToken: string, accountId?: string) => {
      try {
        Logger.info('📡 [IPC] 收到获取API令牌列表请求');
        const browserSlot = await resolveBrowserSlot(accountId);
        const tokens = await tokenService.fetchApiTokens(baseUrl, userId, accessToken, {
          browserSlot,
        });
        await persistApiKeysCache(baseUrl, tokens, accountId);
        return { success: true, data: tokens };
      } catch (error: any) {
        Logger.error('❌ [IPC] 获取API令牌列表失败:', error);
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle(
    'token:resolve-api-key-value',
    async (_, siteUrl: string, apiKeyId: string | number, accountId?: string) => {
      try {
        const normalizedApiKeyId = String(apiKeyId);
        const site = unifiedConfigManager.getSiteByUrl(siteUrl);
        if (!site) {
          throw new Error(`Site not found: ${siteUrl}`);
        }

        const browserSlot = await resolveBrowserSlot(accountId);

        if (accountId) {
          const account = unifiedConfigManager.getAccountById(accountId);
          if (!account || account.site_id !== site.id) {
            throw new Error(`Account not found: ${accountId}`);
          }

          const apiKey = (account.cached_data?.api_keys || []).find(item => {
            const itemId =
              item?.id !== undefined && item?.id !== null
                ? String(item.id)
                : item?.token_id !== undefined && item?.token_id !== null
                  ? String(item.token_id)
                  : null;
            return itemId === normalizedApiKeyId;
          });
          if (!apiKey) {
            throw new Error(`API key not found: ${normalizedApiKeyId}`);
          }

          const rawValue = await tokenService.resolveUsableApiKeyValue(
            site.url,
            Number(account.user_id),
            account.access_token,
            apiKey,
            {
              browserSlot,
              allowBrowserFallback: true,
              challengeWaitMs: 10000,
            }
          );

          if (!rawValue || isMaskedApiKeyValue(rawValue)) {
            return { success: false, error: '无法解析 API Key 明文' };
          }

          await persistResolvedApiKeyValue(site.url, normalizedApiKeyId, rawValue, accountId);
          return { success: true, data: rawValue };
        }

        const apiKey = (site.cached_data?.api_keys || []).find(item => {
          const itemId =
            item?.id !== undefined && item?.id !== null
              ? String(item.id)
              : item?.token_id !== undefined && item?.token_id !== null
                ? String(item.token_id)
                : null;
          return itemId === normalizedApiKeyId;
        });
        if (!apiKey) {
          throw new Error(`API key not found: ${normalizedApiKeyId}`);
        }

        const siteAccessToken = site.access_token || (site as any).system_token;
        if (!site.user_id || !siteAccessToken) {
          return { success: false, error: '当前站点缺少 system token 或 user id' };
        }

        const rawValue = await tokenService.resolveUsableApiKeyValue(
          site.url,
          Number(site.user_id),
          siteAccessToken,
          apiKey,
          {
            browserSlot,
            allowBrowserFallback: true,
            challengeWaitMs: 10000,
          }
        );

        if (!rawValue || isMaskedApiKeyValue(rawValue)) {
          return { success: false, error: '无法解析 API Key 明文' };
        }

        await persistResolvedApiKeyValue(site.url, normalizedApiKeyId, rawValue);
        return { success: true, data: rawValue };
      } catch (error: any) {
        Logger.error('❌ [IPC] 解析 API Key 明文失败:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // 创建新的 API 令牌
  ipcMain.handle(
    'token:create-api-token',
    async (
      _,
      baseUrl: string,
      userId: number,
      accessToken: string,
      tokenData: any,
      accountId?: string
    ) => {
      try {
        Logger.info('🆕 [IPC] 收到创建 API 令牌请求');
        const browserSlot = await resolveBrowserSlot(accountId);
        const result = await tokenService.createApiToken(baseUrl, userId, accessToken, tokenData, {
          browserSlot,
        });
        await persistApiKeysCache(baseUrl, result.data, accountId);
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
    async (
      _,
      baseUrl: string,
      userId: number,
      accessToken: string,
      tokenIdentifier: any,
      accountId?: string
    ) => {
      try {
        Logger.info('🗑 [IPC] 收到删除 API 令牌请求');
        const browserSlot = await resolveBrowserSlot(accountId);
        const result = await tokenService.deleteApiToken(
          baseUrl,
          userId,
          accessToken,
          tokenIdentifier,
          { browserSlot }
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

  // 初始化并保存为 AccountCredential（多账户流程）
  ipcMain.handle(
    'token:initialize-account',
    async (
      _,
      params: {
        siteId: string;
        baseUrl: string;
        accountName?: string;
        authSource: AccountAuthSource;
        profilePath?: string;
      }
    ) => {
      try {
        const mainWindow = getMainWindow();
        const site = unifiedConfigManager.getSiteById(params.siteId);
        const siteAccount = await tokenService.initializeSiteAccount(
          params.baseUrl,
          true,
          600000,
          (status: string) => sendSiteInitStatus(mainWindow, status),
          { siteType: site?.site_type }
        );

        if (!siteAccount.user_id || !siteAccount.access_token) {
          return { success: false, error: '未能获取有效凭证' };
        }

        // 直接创建 AccountCredential 并保存
        const account = await unifiedConfigManager.addAccount({
          site_id: params.siteId,
          account_name: params.accountName || siteAccount.username || `账户${siteAccount.user_id}`,
          user_id: String(siteAccount.user_id),
          username: siteAccount.username || undefined,
          access_token: siteAccount.access_token,
          auth_source: params.authSource,
          status: 'active',
          browser_profile_path: params.profilePath,
          metadata: {
            supports_checkin: (siteAccount as any).supportsCheckIn,
          },
        });

        Logger.info(`✅ [TokenHandlers] 账户已创建并保存: ${account.id} (${account.account_name})`);
        return { success: true, data: account };
      } catch (error: any) {
        Logger.error('❌ [TokenHandlers] 初始化账户失败:', error);
        try {
          await chromeManager.forceCleanup();
        } catch {
          // ignore
        }
        return { success: false, error: error.message };
      }
    }
  );
}
