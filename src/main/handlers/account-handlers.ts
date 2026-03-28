/**

 * 输入: UnifiedConfigManager (配置管理)

 * 输出: IPC 事件处理 (accounts:list, accounts:delete, accounts:update, accounts:add)

 * 定位: IPC 层 - 多账户管理接口

 */

import { ipcMain } from 'electron';

import { unifiedConfigManager } from '../unified-config-manager';

import Logger from '../utils/logger';

export function registerAccountHandlers(): void {
  // 获取站点的所有账户

  ipcMain.handle('accounts:list', async (_, siteId: string) => {
    try {
      return { success: true, data: unifiedConfigManager.getAccountsBySiteId(siteId) };
    } catch (error: any) {
      Logger.error('❌ [AccountHandlers] 获取账户列表失败:', error.message);

      return { success: false, error: error.message };
    }
  });

  // 更新账户信息

  ipcMain.handle(
    'accounts:update',

    async (
      _,
      accountId: string,
      updates: {
        account_name?: string;
        status?: string;
        access_token?: string;
        user_id?: string;
        auto_refresh?: boolean;
        auto_refresh_interval?: number;
        cli_config?: any;
      }
    ) => {
      try {
        const result = await unifiedConfigManager.updateAccount(accountId, updates as any);

        return { success: result };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }
  );

  // 添加账户（从前端传入已获取的凭证数据）

  ipcMain.handle(
    'accounts:add',

    async (
      _,

      data: {
        site_id: string;

        account_name: string;

        user_id: string;

        username?: string;

        access_token: string;

        auth_source: string;

        browser_profile_path?: string;
      }
    ) => {
      try {
        const account = await unifiedConfigManager.addAccount({
          site_id: data.site_id,

          account_name: data.account_name,

          user_id: data.user_id,

          username: data.username,

          access_token: data.access_token,

          auth_source: data.auth_source as any,

          status: 'active',

          browser_profile_path: data.browser_profile_path,
        });

        Logger.info(`✅ [AccountHandlers] 添加账户: ${account.id} (${account.account_name})`);

        return { success: true, data: account };
      } catch (error: any) {
        Logger.error('❌ [AccountHandlers] 添加账户失败:', error.message);

        return { success: false, error: error.message };
      }
    }
  );

  // 删除账户

  ipcMain.handle('accounts:delete', async (_, accountId: string) => {
    try {
      const result = await unifiedConfigManager.deleteAccount(accountId);

      if (result) {
        Logger.info(`✅ [AccountHandlers] 删除账户: ${accountId}`);
      }

      return { success: result };
    } catch (error: any) {
      Logger.error('❌ [AccountHandlers] 删除账户失败:', error.message);

      return { success: false, error: error.message };
    }
  });
}
