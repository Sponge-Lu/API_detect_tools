import Logger from './utils/logger';
/**
 * 备份管理器
 * 自动备份配置文件到用户主目录
 * 备份目录: ~/.api-hub-management-tools/
 * 卸载应用时不会清除此目录
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import * as os from 'os';

export interface BackupInfo {
  filename: string;
  path: string;
  timestamp: Date;
  size: number;
}

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
        Logger.info(`📁 [BackupManager] 创建备份目录: ${this.backupDir}`);
      }
    } catch (error) {
      Logger.error('❌ [BackupManager] 创建备份目录失败:', error);
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
    const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const baseName = path.basename(originalName, '.json');
    return `${baseName}_${timestamp}.json`;
  }

  /**
   * 备份单个文件
   */
  async backupFile(sourcePath: string): Promise<boolean> {
    try {
      if (!fs.existsSync(sourcePath)) {
        Logger.info(`⚠️ [BackupManager] 源文件不存在，跳过备份: ${sourcePath}`);
        return false;
      }

      const fileName = path.basename(sourcePath);
      const backupFileName = this.generateBackupFileName(fileName);
      const backupPath = path.join(this.backupDir, backupFileName);

      // 复制文件
      fs.copyFileSync(sourcePath, backupPath);
      Logger.info(`💾 [BackupManager] 已备份: ${fileName} -> ${backupFileName}`);

      // 清理旧备份
      await this.cleanupOldBackups(fileName);

      return true;
    } catch (error) {
      Logger.error('❌ [BackupManager] 备份文件失败:', error);
      return false;
    }
  }

  /**
   * 备份所有配置文件（只备份 config.json）
   */
  async backupAll(): Promise<void> {
    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, 'config.json');

    Logger.info('🔄 [BackupManager] 开始自动备份...');

    await this.backupFile(configPath);

    Logger.info('✅ [BackupManager] 自动备份完成');
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
          time: fs.statSync(path.join(this.backupDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time); // 按时间降序排列

      // 删除超过限制的旧备份
      if (backupFiles.length > this.maxBackups) {
        const toDelete = backupFiles.slice(this.maxBackups);
        for (const file of toDelete) {
          fs.unlinkSync(file.path);
          Logger.info(`🗑️ [BackupManager] 删除旧备份: ${file.name}`);
        }
      }
    } catch (error) {
      Logger.error('❌ [BackupManager] 清理旧备份失败:', error);
    }
  }

  /**
   * 获取所有备份文件列表
   */
  listBackups(): BackupInfo[] {
    try {
      const files = fs.readdirSync(this.backupDir);

      // config.json 备份
      const configBackups: BackupInfo[] = files
        .filter(f => f.startsWith('config_') && f.endsWith('.json'))
        .map(f => {
          const filePath = path.join(this.backupDir, f);
          const stat = fs.statSync(filePath);
          return {
            filename: f,
            path: filePath,
            timestamp: stat.mtime,
            size: stat.size,
          };
        })
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      return configBackups;
    } catch (error) {
      Logger.error('❌ [BackupManager] 列出备份失败:', error);
      return [];
    }
  }

  /**
   * 从备份恢复文件
   */
  async restoreFromBackup(backupFileName: string, targetPath: string): Promise<boolean> {
    try {
      const backupPath = path.join(this.backupDir, backupFileName);

      if (!fs.existsSync(backupPath)) {
        Logger.error(`❌ [BackupManager] 备份文件不存在: ${backupFileName}`);
        return false;
      }

      // 先备份当前文件
      if (fs.existsSync(targetPath)) {
        const currentBackupName = this.generateBackupFileName(path.basename(targetPath)).replace(
          '.json',
          '_before_restore.json'
        );
        fs.copyFileSync(targetPath, path.join(this.backupDir, currentBackupName));
        Logger.info(`💾 [BackupManager] 恢复前已备份当前文件: ${currentBackupName}`);
      }

      // 恢复备份
      fs.copyFileSync(backupPath, targetPath);
      Logger.info(`✅ [BackupManager] 已从备份恢复: ${backupFileName}`);

      return true;
    } catch (error) {
      Logger.error('❌ [BackupManager] 恢复备份失败:', error);
      return false;
    }
  }

  /**
   * 获取最新备份的时间
   */
  getLatestBackupTime(): Date | null {
    try {
      const backups = this.listBackups();
      return backups[0]?.timestamp || null;
    } catch (error) {
      return null;
    }
  }
}

// 导出单例实例
export const backupManager = new BackupManager();
