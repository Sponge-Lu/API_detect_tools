/**
 * 输入: UnifiedConfigManager (配置管理), FileSystem (文件系统), Electron app (应用路径)
 * 输出: BackupInfo (备份信息), 备份文件
 * 定位: 基础设施层 - 管理本地备份和恢复操作
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import Logger from './utils/logger';
/**
 * 备份管理器
 * 自动备份配置文件到用户主目录
 * 备份目录: ~/.api-hub-management-tools/
 * 卸载应用时不会清除此目录
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import {
  createAppStorageBundleContent,
  extractStableConfigFromBackupContent,
  restoreAppStorageBackupContent,
} from './app-storage-bundle';

export interface BackupInfo {
  filename: string;
  path: string;
  timestamp: Date;
  size: number;
  kind?: 'legacy-config' | 'storage-bundle';
}

export interface BackupFileOptions {
  force?: boolean;
  dedupe?: boolean;
  minIntervalMs?: number;
  reason?: string;
}

export interface BackupManagerOptions {
  backupDir?: string;
  maxBackups?: number;
  minAutoBackupIntervalMs?: number;
}

export class BackupManager {
  private backupDir: string;
  private maxBackups: number; // 保留最近N个备份
  private minAutoBackupIntervalMs: number;

  constructor(options: BackupManagerOptions = {}) {
    // 备份目录在用户主目录下，卸载时不会被清除
    this.backupDir = options.backupDir || path.join(os.homedir(), '.api-hub-management-tools');
    this.maxBackups = options.maxBackups ?? 10;
    this.minAutoBackupIntervalMs = options.minAutoBackupIntervalMs ?? 10 * 60 * 1000;
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
    const timestamp = now.toISOString().replace('T', '_').replace('Z', '').replace(/[:.]/g, '-');
    const uniqueSuffix = process.hrtime.bigint().toString(36);
    const baseName = path.basename(originalName, '.json');
    return `${baseName}_${timestamp}_${uniqueSuffix}.json`;
  }

  private hashBuffer(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private findLatestBackup(originalFileName: string): BackupInfo | null {
    const baseName = path.basename(originalFileName, '.json');
    const backups = this.listBackupsForBaseName(baseName);
    return backups[0] || null;
  }

  private listBackupsForBaseName(baseName: string): BackupInfo[] {
    const files = fs.readdirSync(this.backupDir);
    return files
      .filter(f => f.startsWith(baseName + '_') && f.endsWith('.json'))
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
  }

  private detectBackupKind(filePath: string): BackupInfo['kind'] {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed?.format === 'api-hub-storage-bundle' ? 'storage-bundle' : 'legacy-config';
    } catch {
      return 'legacy-config';
    }
  }

  private shouldSkipBackup(
    sourceBuffer: Buffer,
    latestBackup: BackupInfo | null,
    options: BackupFileOptions
  ): boolean {
    if (options.force || !latestBackup) {
      return false;
    }

    const now = Date.now();
    const minIntervalMs = options.minIntervalMs ?? this.minAutoBackupIntervalMs;
    if (minIntervalMs > 0 && now - latestBackup.timestamp.getTime() < minIntervalMs) {
      Logger.info(
        `⏭️ [BackupManager] 跳过自动备份，距离上次备份不足 ${Math.ceil(
          minIntervalMs / 1000
        )} 秒: ${latestBackup.filename}`
      );
      return true;
    }

    if (options.dedupe !== false && fs.existsSync(latestBackup.path)) {
      const latestBuffer = fs.readFileSync(latestBackup.path);
      if (this.hashBuffer(sourceBuffer) === this.hashBuffer(latestBuffer)) {
        Logger.info(`⏭️ [BackupManager] 跳过自动备份，内容未变化: ${latestBackup.filename}`);
        return true;
      }
    }

    return false;
  }

  /**
   * 备份单个文件
   */
  async backupFile(sourcePath: string, options: BackupFileOptions = {}): Promise<boolean> {
    try {
      if (!fs.existsSync(sourcePath)) {
        Logger.info(`⚠️ [BackupManager] 源文件不存在，跳过备份: ${sourcePath}`);
        return false;
      }

      const fileName = path.basename(sourcePath);
      const sourceBuffer = fs.readFileSync(sourcePath);
      const latestBackup = this.findLatestBackup(fileName);
      if (this.shouldSkipBackup(sourceBuffer, latestBackup, options)) {
        return false;
      }

      const backupFileName = this.generateBackupFileName(fileName);
      const backupPath = path.join(this.backupDir, backupFileName);

      // 复制文件
      fs.writeFileSync(backupPath, sourceBuffer);
      Logger.info(
        `💾 [BackupManager] 已备份: ${fileName} -> ${backupFileName}${
          options.reason ? ` (${options.reason})` : ''
        }`
      );

      // 清理旧备份
      await this.cleanupOldBackups(fileName);

      return true;
    } catch (error) {
      Logger.error('❌ [BackupManager] 备份文件失败:', error);
      return false;
    }
  }

  /**
   * 创建 manifest 全量备份包。
   * 备份包只包含 app-storage-manifest 中默认纳入 full-manifest 的文件。
   */
  async backupManifestBundle(options: BackupFileOptions = {}): Promise<boolean> {
    try {
      const content = await createAppStorageBundleContent();
      extractStableConfigFromBackupContent(content);
      const sourceBuffer = Buffer.from(content, 'utf-8');
      const latestBackup = this.findLatestBackup('config.json');
      if (this.shouldSkipBackup(sourceBuffer, latestBackup, options)) {
        return false;
      }

      const backupFileName = this.generateBackupFileName('config.json');
      const backupPath = path.join(this.backupDir, backupFileName);
      fs.writeFileSync(backupPath, sourceBuffer);
      Logger.info(
        `💾 [BackupManager] 已创建配置包备份: ${backupFileName}${
          options.reason ? ` (${options.reason})` : ''
        }`
      );

      await this.cleanupOldBackups('config.json');
      return true;
    } catch (error) {
      Logger.error('❌ [BackupManager] 创建配置包备份失败:', error);
      return false;
    }
  }

  /**
   * 备份所有默认纳入的 manifest 文件。
   */
  async backupAll(): Promise<void> {
    Logger.info('🔄 [BackupManager] 开始手动备份...');

    await this.backupManifestBundle({ force: true, reason: 'manual' });

    Logger.info('✅ [BackupManager] 手动备份完成');
  }

  /**
   * 清理旧备份，保留最近的N个
   */
  private async cleanupOldBackups(originalFileName: string): Promise<void> {
    try {
      const baseName = path.basename(originalFileName, '.json');
      const backupFiles = this.listBackupsForBaseName(baseName).map(info => ({
        name: info.filename,
        path: info.path,
        time: info.timestamp.getTime(),
      }));

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
      return this.listBackupsForBaseName('config').map(backup => ({
        ...backup,
        kind: this.detectBackupKind(backup.path),
      }));
    } catch (error) {
      Logger.error('❌ [BackupManager] 列出备份失败:', error);
      return [];
    }
  }

  /**
   * 从本地备份中读取并校验稳定 config.json。
   * 支持 legacy config-only 备份和新的 manifest 配置包。
   */
  readConfigFromBackup(backupPath: string): unknown {
    const content = fs.readFileSync(backupPath, 'utf-8');
    return extractStableConfigFromBackupContent(content);
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

      const content = fs.readFileSync(backupPath, 'utf-8');
      const restored = await restoreAppStorageBackupContent(content, targetPath);
      Logger.info(
        `✅ [BackupManager] 已从备份恢复: ${backupFileName} (${restored.kind}, ${restored.restoredFiles.length} 个文件)`
      );

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
