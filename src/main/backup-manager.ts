/**
 * 备份管理器
 * 自动备份配置文件和令牌存储到用户主目录
 * 备份目录: ~/.api-hub-management-tools/
 * 卸载应用时不会清除此目录
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import * as os from 'os';

export class BackupManager {
  private backupDir: string;
  private maxBackups: number = 10; // 保留最近10个备份

  constructor() {
    // 备份目录在用户主目录下，卸载时不会被清除
    this.backupDir = path.join(os.homedir(), '.api-hub-management-tools');
    this.ensureBackupDir();
  }

  /**
   * 确保备份目录存在
   */
  private ensureBackupDir(): void {
    try {
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
        console.log(`📁 [BackupManager] 创建备份目录: ${this.backupDir}`);
      }
    } catch (error) {
      console.error('❌ [BackupManager] 创建备份目录失败:', error);
    }
  }

  /**
   * 获取备份目录路径
   */
  getBackupDir(): string {
    return this.backupDir;
  }

  /**
   * 生成备份文件名
   */
  private generateBackupFileName(originalName: string): string {
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .slice(0, 19);
    const baseName = path.basename(originalName, '.json');
    return `${baseName}_${timestamp}.json`;
  }

  /**
   * 备份单个文件
   */
  async backupFile(sourcePath: string): Promise<boolean> {
    try {
      if (!fs.existsSync(sourcePath)) {
        console.log(`⚠️ [BackupManager] 源文件不存在，跳过备份: ${sourcePath}`);
        return false;
      }

      const fileName = path.basename(sourcePath);
      const backupFileName = this.generateBackupFileName(fileName);
      const backupPath = path.join(this.backupDir, backupFileName);

      // 复制文件
      fs.copyFileSync(sourcePath, backupPath);
      console.log(`💾 [BackupManager] 已备份: ${fileName} -> ${backupFileName}`);

      // 清理旧备份
      await this.cleanupOldBackups(fileName);

      return true;
    } catch (error) {
      console.error('❌ [BackupManager] 备份文件失败:', error);
      return false;
    }
  }

  /**
   * 备份所有配置文件
   */
  async backupAll(): Promise<void> {
    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, 'config.json');
    const tokenStoragePath = path.join(userDataPath, 'token-storage.json');

    console.log('🔄 [BackupManager] 开始自动备份...');

    await this.backupFile(configPath);
    await this.backupFile(tokenStoragePath);

    console.log('✅ [BackupManager] 自动备份完成');
  }

  /**
   * 清理旧备份，保留最近的N个
   */
  private async cleanupOldBackups(originalFileName: string): Promise<void> {
    try {
      const baseName = path.basename(originalFileName, '.json');
      const files = fs.readdirSync(this.backupDir);
      
      // 筛选出同类型的备份文件
      const backupFiles = files
        .filter(f => f.startsWith(baseName + '_') && f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: path.join(this.backupDir, f),
          time: fs.statSync(path.join(this.backupDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time); // 按时间降序排列

      // 删除超过限制的旧备份
      if (backupFiles.length > this.maxBackups) {
        const toDelete = backupFiles.slice(this.maxBackups);
        for (const file of toDelete) {
          fs.unlinkSync(file.path);
          console.log(`🗑️ [BackupManager] 删除旧备份: ${file.name}`);
        }
      }
    } catch (error) {
      console.error('❌ [BackupManager] 清理旧备份失败:', error);
    }
  }

  /**
   * 获取所有备份文件列表
   */
  listBackups(): { config: string[]; tokenStorage: string[] } {
    try {
      const files = fs.readdirSync(this.backupDir);
      
      const configBackups = files
        .filter(f => f.startsWith('config_') && f.endsWith('.json'))
        .sort()
        .reverse();
      
      const tokenStorageBackups = files
        .filter(f => f.startsWith('token-storage_') && f.endsWith('.json'))
        .sort()
        .reverse();

      return { config: configBackups, tokenStorage: tokenStorageBackups };
    } catch (error) {
      console.error('❌ [BackupManager] 列出备份失败:', error);
      return { config: [], tokenStorage: [] };
    }
  }

  /**
   * 从备份恢复文件
   */
  async restoreFromBackup(backupFileName: string, targetPath: string): Promise<boolean> {
    try {
      const backupPath = path.join(this.backupDir, backupFileName);
      
      if (!fs.existsSync(backupPath)) {
        console.error(`❌ [BackupManager] 备份文件不存在: ${backupFileName}`);
        return false;
      }

      // 先备份当前文件
      if (fs.existsSync(targetPath)) {
        const currentBackupName = this.generateBackupFileName(path.basename(targetPath)).replace('.json', '_before_restore.json');
        fs.copyFileSync(targetPath, path.join(this.backupDir, currentBackupName));
        console.log(`💾 [BackupManager] 恢复前已备份当前文件: ${currentBackupName}`);
      }

      // 恢复备份
      fs.copyFileSync(backupPath, targetPath);
      console.log(`✅ [BackupManager] 已从备份恢复: ${backupFileName}`);

      return true;
    } catch (error) {
      console.error('❌ [BackupManager] 恢复备份失败:', error);
      return false;
    }
  }

  /**
   * 获取最新备份的时间
   */
  getLatestBackupTime(): { config: Date | null; tokenStorage: Date | null } {
    try {
      const backups = this.listBackups();
      
      const getFileTime = (fileName: string): Date | null => {
        if (!fileName) return null;
        const filePath = path.join(this.backupDir, fileName);
        if (fs.existsSync(filePath)) {
          return fs.statSync(filePath).mtime;
        }
        return null;
      };

      return {
        config: getFileTime(backups.config[0]),
        tokenStorage: getFileTime(backups.tokenStorage[0])
      };
    } catch (error) {
      return { config: null, tokenStorage: null };
    }
  }
}

// 导出单例实例
export const backupManager = new BackupManager();

