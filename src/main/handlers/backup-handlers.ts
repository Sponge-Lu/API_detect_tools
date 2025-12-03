import Logger from '../utils/logger';
/**
 * 备份相关 IPC 处理器
 */

import { ipcMain, shell } from 'electron';
import type { BackupManager } from '../backup-manager';
import { unifiedConfigManager } from '../unified-config-manager';

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

  // 手动备份
  ipcMain.handle('backup:manual', async () => {
    await backupManager.backupAll();
    return { success: true };
  });

  // 从备份恢复配置
  ipcMain.handle('backup:restore-config', async (_, backupFileName: string) => {
    const targetPath = unifiedConfigManager.getConfigPath();
    const success = await backupManager.restoreFromBackup(backupFileName, targetPath);
    if (success) {
      // 重新加载配置
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
