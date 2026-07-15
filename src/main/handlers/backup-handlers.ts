import Logger from '../utils/logger';
/**
 * 备份相关 IPC 处理器
 * - 自动轻量备份仍由 saveConfig 路径调用 backupFile（config-only）
 * - 手动备份 / 导出 / WebDAV 统一使用 portable 2 文件包
 */

import { ipcMain, shell } from 'electron';
import * as fs from 'fs';
import type { BackupManager } from '../backup-manager';
import { unifiedConfigManager } from '../unified-config-manager';
import {
  createPortableAppStorageBundleContent,
  extractStableConfigFromBackupContent,
  restoreAppStorageBackupContent,
} from '../app-storage-bundle';
import { browserProfileManager } from '../browser-profile-manager';

function generateExportFilename(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `config_${year}-${month}-${day}_${hours}-${minutes}-${seconds}.json`;
}

/**
 * 备份处理器
 */
export function registerBackupHandlers(backupManager: BackupManager) {
  // 列出备份
  ipcMain.handle('backup:list', async () => {
    return backupManager.listBackups();
  });

  // 获取备份目录
  ipcMain.handle('backup:get-dir', async () => {
    return backupManager.getBackupDir();
  });

  // 获取最新备份时间
  ipcMain.handle('backup:get-latest-time', async () => {
    return backupManager.getLatestBackupTime();
  });

  // 手动可迁移备份
  ipcMain.handle('backup:manual', async () => {
    await backupManager.backupAll();
    return { success: true };
  });

  // 导出 portable 配置包（config.json + custom-cli-configs.json）
  ipcMain.handle('backup:export-config-package', async () => {
    try {
      const content = await createPortableAppStorageBundleContent();
      // 与 WebDAV/手动备份一致：缺少 stable-config 时拒绝导出
      extractStableConfigFromBackupContent(content);
      return {
        success: true,
        data: {
          filename: generateExportFilename(),
          content,
          kind: 'storage-bundle',
          mode: 'portable-config',
        },
      };
    } catch (error: any) {
      Logger.error('❌ [IPC] 导出可迁移配置包失败:', error);
      return { success: false, error: error?.message || '导出配置包失败' };
    }
  });

  // 导入 portable/full-manifest/legacy 配置包，并重绑隔离 Profile
  ipcMain.handle('backup:import-config-package', async (_, content: string) => {
    try {
      if (typeof content !== 'string' || content.trim().length === 0) {
        return { success: false, error: '配置包内容为空' };
      }

      const targetPath = unifiedConfigManager.getConfigPath();
      if (fs.existsSync(targetPath)) {
        await backupManager.backupFile(targetPath, {
          force: true,
          reason: 'before-import-package',
        });
      }

      const restored = await restoreAppStorageBackupContent(content, targetPath);
      await unifiedConfigManager.loadConfig();
      const reconcile = await browserProfileManager.reconcileIsolatedProfilesAfterRestore();

      return {
        success: true,
        data: {
          kind: restored.kind,
          mode: restored.mode,
          restoredFiles: restored.restoredFiles,
          reconcile,
        },
      };
    } catch (error: any) {
      Logger.error('❌ [IPC] 导入配置包失败:', error);
      return { success: false, error: error?.message || '导入配置包失败' };
    }
  });

  // 从备份恢复配置
  ipcMain.handle('backup:restore-config', async (_, backupFileName: string) => {
    const targetPath = unifiedConfigManager.getConfigPath();
    const success = await backupManager.restoreFromBackup(backupFileName, targetPath);
    if (success) {
      // 重新加载配置（restoreFromBackup 内已 reconcile 隔离 profile）
      await unifiedConfigManager.loadConfig();
    }
    return { success };
  });

  // 打开备份目录
  ipcMain.handle('backup:open-dir', async () => {
    const backupDir = backupManager.getBackupDir();
    await shell.openPath(backupDir);
    return { success: true };
  });

  Logger.info('✅ [IPC] 备份处理器已注册');
}
