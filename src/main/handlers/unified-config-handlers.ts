/**
 * 统一配置 IPC 处理器
 * 合并原 config-handlers 和 storage-handlers
 */

import Logger from '../utils/logger';
import { ipcMain } from 'electron';
import { unifiedConfigManager } from '../unified-config-manager';
import type { UnifiedSite } from '../../shared/types/site';

export function registerUnifiedConfigHandlers() {
  // ============= 配置操作 =============

  // 加载配置（兼容旧格式）
  ipcMain.handle('load-config', async () => {
    await unifiedConfigManager.loadConfig();
    return unifiedConfigManager.getLegacyConfig();
  });

  // 保存配置（兼容旧格式）
  ipcMain.handle('save-config', async (_, config) => {
    await unifiedConfigManager.saveLegacyConfig(config);
  });

  // ============= 站点操作（新 API） =============

  // 获取所有站点
  ipcMain.handle('sites:get-all', async () => {
    return unifiedConfigManager.getSites();
  });

  // 根据 ID 获取站点
  ipcMain.handle('sites:get-by-id', async (_, id: string) => {
    const site = unifiedConfigManager.getSiteById(id);
    return { success: !!site, data: site };
  });

  // 根据 URL 获取站点
  ipcMain.handle('sites:get-by-url', async (_, url: string) => {
    const site = unifiedConfigManager.getSiteByUrl(url);
    return { success: !!site, data: site };
  });

  // 添加站点
  ipcMain.handle('sites:add', async (_, site: Omit<UnifiedSite, 'id'>) => {
    try {
      const newSite = await unifiedConfigManager.addSite(site);
      return { success: true, data: newSite };
    } catch (error: any) {
      Logger.error('添加站点失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 更新站点
  ipcMain.handle('sites:update', async (_, id: string, updates: Partial<UnifiedSite>) => {
    try {
      const result = await unifiedConfigManager.updateSite(id, updates);
      return { success: result };
    } catch (error: any) {
      Logger.error('更新站点失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 删除站点
  ipcMain.handle('sites:delete', async (_, id: string) => {
    try {
      const result = await unifiedConfigManager.deleteSite(id);
      return { success: result };
    } catch (error: any) {
      Logger.error('删除站点失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 更新站点令牌
  ipcMain.handle('sites:update-token', async (_, id: string, accessToken: string) => {
    try {
      const result = await unifiedConfigManager.updateSiteToken(id, accessToken);
      return { success: result };
    } catch (error: any) {
      Logger.error('更新令牌失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ============= 兼容旧 storage API =============

  // 获取所有账号（兼容）- 返回站点列表
  ipcMain.handle('get-all-accounts', async () => {
    const sites = unifiedConfigManager.getSites();
    // 转换为旧格式的账号结构
    return sites.map(site => ({
      id: site.id,
      site_name: site.name,
      site_url: site.url,
      name: site.name,
      url: site.url,
      user_id: site.user_id ? parseInt(site.user_id) : undefined,
      access_token: site.access_token,
      can_check_in: site.has_checkin,
      supports_check_in: site.force_enable_checkin,
      created_at: site.created_at,
      updated_at: site.updated_at,
      last_sync_time: site.last_sync_time,
    }));
  });

  // 保存账号（兼容）
  ipcMain.handle('storage:save-account', async (_, account: any) => {
    try {
      // 查找现有站点
      let site = account.id ? unifiedConfigManager.getSiteById(account.id) : null;
      if (!site && account.site_url) {
        site = unifiedConfigManager.getSiteByUrl(account.site_url);
      }

      if (site) {
        // 更新现有站点
        await unifiedConfigManager.updateSite(site.id, {
          access_token: account.access_token || account.account_info?.access_token,
          user_id: account.user_id?.toString(),
          has_checkin: account.can_check_in || account.supports_check_in,
          last_sync_time: Date.now(),
        });
        return { success: true, data: { id: site.id } };
      } else {
        // 创建新站点
        const newSite = await unifiedConfigManager.addSite({
          name: account.site_name || account.name || '新站点',
          url: account.site_url || account.url,
          enabled: true,
          group: 'default',
          access_token: account.access_token,
          user_id: account.user_id?.toString(),
          has_checkin: account.can_check_in,
        });
        return { success: true, data: { id: newSite.id } };
      }
    } catch (error: any) {
      Logger.error('保存账号失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 删除账号（兼容）
  ipcMain.handle('storage:delete-account', async (_, id: string) => {
    try {
      const result = await unifiedConfigManager.deleteSite(id);
      return { success: result };
    } catch (error: any) {
      Logger.error('删除账号失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 更新令牌（兼容）
  ipcMain.handle('storage:update-token', async (_, id: string, accessToken: string) => {
    try {
      const result = await unifiedConfigManager.updateSiteToken(id, accessToken);
      return { success: result };
    } catch (error: any) {
      Logger.error('更新令牌失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 根据 ID 获取账号（兼容）
  ipcMain.handle('storage:get-account', async (_, id: string) => {
    const site = unifiedConfigManager.getSiteById(id);
    if (!site) {
      return { success: false, error: '账号不存在' };
    }
    return {
      success: true,
      data: {
        id: site.id,
        site_name: site.name,
        site_url: site.url,
        user_id: site.user_id ? parseInt(site.user_id) : undefined,
        access_token: site.access_token,
      },
    };
  });

  // 导出数据（兼容）
  ipcMain.handle('storage:export', async () => {
    try {
      const config = await unifiedConfigManager.exportConfig();
      return { success: true, data: config };
    } catch (error: any) {
      Logger.error('导出数据失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 导入数据（兼容）
  ipcMain.handle('storage:import', async (_, data: any) => {
    try {
      await unifiedConfigManager.importConfig(data);
      return { success: true };
    } catch (error: any) {
      Logger.error('导入数据失败:', error);
      return { success: false, error: error.message };
    }
  });

  Logger.info('✅ [IPC] 统一配置处理器已注册');
}
