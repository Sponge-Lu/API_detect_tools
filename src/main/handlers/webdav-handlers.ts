import { handleStorageIpc } from '../storage/ipc-handler';
/**
 * WebDAV 备份相关 IPC 处理器
 */

import Logger from '../utils/logger';
import { webdavManager } from '../webdav-manager';
import { unifiedConfigManager } from '../unified-config-manager';
import type { WebDAVConfig } from '../../shared/types/site';

/**
 * 注册 WebDAV 相关 IPC 处理器
 */
export function registerWebDAVHandlers() {
  // 测试 WebDAV 连接
  handleStorageIpc('webdav:test-connection', async (_, config: WebDAVConfig) => {
    return webdavManager.testConnection(config);
  });

  // 上传备份到 WebDAV
  handleStorageIpc('webdav:upload-backup', async () => {
    const config = await unifiedConfigManager.getConfig();
    const webdavConfig = config.settings?.webdav;

    if (!webdavConfig?.enabled) {
      return { success: false, error: 'WebDAV 未配置或未启用' };
    }

    return webdavManager.uploadBackup(webdavConfig);
  });

  // 列出 WebDAV 备份
  handleStorageIpc('webdav:list-backups', async () => {
    const config = await unifiedConfigManager.getConfig();
    const webdavConfig = config.settings?.webdav;

    if (!webdavConfig?.enabled) {
      return { success: false, error: 'WebDAV 未配置或未启用' };
    }

    return webdavManager.listBackups(webdavConfig);
  });

  // 删除 WebDAV 备份
  handleStorageIpc('webdav:delete-backup', async (_, filename: string) => {
    const config = await unifiedConfigManager.getConfig();
    const webdavConfig = config.settings?.webdav;

    if (!webdavConfig?.enabled) {
      return { success: false, error: 'WebDAV 未配置或未启用' };
    }

    return webdavManager.deleteBackup(webdavConfig, filename);
  });

  // 恢复 WebDAV 备份
  handleStorageIpc('webdav:restore-backup', async (_, filename: string) => {
    const config = await unifiedConfigManager.getConfig();
    const webdavConfig = config.settings?.webdav;

    if (!webdavConfig?.enabled) {
      return { success: false, error: 'WebDAV 未配置或未启用' };
    }

    return webdavManager.restoreBackup(webdavConfig, filename);
  });

  // 保存 WebDAV 配置
  handleStorageIpc('webdav:save-config', async (_, webdavConfig: WebDAVConfig) => {
    try {
      Logger.info('💾 [WebDAV] 保存配置:', JSON.stringify({ ...webdavConfig, password: '***' }));
      await unifiedConfigManager.mutateConfig(async () => {
        const config = await unifiedConfigManager.getConfig();
        config.settings = {
          ...config.settings,
          webdav: webdavConfig,
        };
        await unifiedConfigManager.saveConfig(config);
      });
      Logger.info('✅ [WebDAV] 配置保存成功');
      return { success: true };
    } catch (error: any) {
      Logger.error('❌ [WebDAV] 保存配置失败:', error.message);
      return { success: false, error: error.message || '保存配置失败' };
    }
  });

  // 获取 WebDAV 配置
  handleStorageIpc('webdav:get-config', async () => {
    try {
      const config = await unifiedConfigManager.getConfig();
      const webdavConfig = config.settings?.webdav || null;
      Logger.info(
        '📖 [WebDAV] 加载配置:',
        webdavConfig ? JSON.stringify({ ...webdavConfig, password: '***' }) : 'null'
      );
      return { success: true, data: webdavConfig };
    } catch (error: any) {
      Logger.error('❌ [WebDAV] 获取配置失败:', error.message);
      return { success: false, error: error.message || '获取配置失败' };
    }
  });

  Logger.info('✅ [IPC] WebDAV 处理器已注册');
}
