/**
 * 输入: WebDAV client (WebDAV 通信), BackupManager (本地备份), UnifiedConfigManager (配置管理)
 * 输出: WebDAVResult (操作结果), WebDAVBackupInfo (备份信息)
 * 定位: 基础设施层 - 通过 WebDAV 协议管理云端备份和同步
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * WebDAV 备份管理器
 * 负责与 WebDAV 服务器通信，实现配置文件的云端备份和恢复
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Logger from './utils/logger';
import { backupManager } from './backup-manager';
import { unifiedConfigManager } from './unified-config-manager';
import {
  createAppStorageBundleContent,
  extractStableConfigFromBackupContent,
  restoreAppStorageBackupContent,
} from './app-storage-bundle';
import type { WebDAVConfig, WebDAVBackupInfo, WebDAVResult } from '../shared/types/site';
import { DEFAULT_WEBDAV_CONFIG } from '../shared/types/site';

// 动态导入 webdav 模块（ESM 模块）
// 使用 Function 构造器来避免 TypeScript 将 import() 转换为 require()
let webdavModule: any = null;

async function getWebDAVModule(): Promise<typeof import('webdav')> {
  if (!webdavModule) {
    // 使用 eval 来避免 TypeScript 编译器将 import() 转换为 require()
    // 这是处理 ESM-only 包在 CommonJS 环境中的标准做法
    webdavModule = await new Function('return import("webdav")')();
  }
  return webdavModule;
}

// 类型定义
type WebDAVClient = Awaited<ReturnType<(typeof import('webdav'))['createClient']>>;
type FileStat = import('webdav').FileStat;

/**
 * 验证 URL 格式是否有效
 * @param url 待验证的 URL 字符串
 * @returns 验证结果，包含是否有效和错误信息
 */
export function validateWebDAVUrl(url: string): { valid: boolean; error?: string } {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL 不能为空' };
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    return { valid: false, error: 'URL 不能为空' };
  }

  // 检查协议
  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    return { valid: false, error: 'URL 必须以 http:// 或 https:// 开头' };
  }

  try {
    const parsed = new URL(trimmedUrl);
    // 检查是否有有效的主机名
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return { valid: false, error: 'URL 缺少有效的主机名' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'URL 格式无效' };
  }
}

/**
 * 生成备份文件名
 * 格式: config_YYYY-MM-DD_HH-mm-ss.json
 * @param date 日期对象，默认为当前时间
 * @returns 格式化的备份文件名
 */
export function generateBackupFilename(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `config_${year}-${month}-${day}_${hours}-${minutes}-${seconds}.json`;
}

/**
 * 对备份列表按日期降序排序（最新的在前）
 * @param backups 备份信息数组
 * @returns 排序后的备份数组
 */
export function sortBackupsByDate(backups: WebDAVBackupInfo[]): WebDAVBackupInfo[] {
  return [...backups].sort((a, b) => {
    const timeA = a.lastModified instanceof Date ? a.lastModified.getTime() : 0;
    const timeB = b.lastModified instanceof Date ? b.lastModified.getTime() : 0;
    return timeB - timeA; // 降序排列
  });
}

export class WebDAVManager {
  private defaultConfig: WebDAVConfig;

  constructor(config?: Partial<WebDAVConfig>) {
    this.defaultConfig = {
      ...DEFAULT_WEBDAV_CONFIG,
      ...config,
    };
  }

  /**
   * 创建 WebDAV 客户端
   */
  private async createWebDAVClient(config: WebDAVConfig): Promise<WebDAVClient> {
    const { createClient } = await getWebDAVModule();
    return createClient(config.serverUrl, {
      username: config.username,
      password: config.password,
    });
  }

  /**
   * 确保远程目录存在
   */
  private async ensureRemoteDirectory(client: WebDAVClient, remotePath: string): Promise<void> {
    try {
      const exists = await client.exists(remotePath);
      if (!exists) {
        await client.createDirectory(remotePath, { recursive: true });
        Logger.info(`📁 [WebDAVManager] 创建远程目录: ${remotePath}`);
      }
    } catch (error) {
      Logger.warn(`⚠️ [WebDAVManager] 检查/创建远程目录失败: ${error}`);
      // 不抛出错误，让后续操作尝试
    }
  }

  /**
   * 测试 WebDAV 连接
   */
  async testConnection(config: WebDAVConfig): Promise<WebDAVResult> {
    // 验证 URL 格式
    const urlValidation = validateWebDAVUrl(config.serverUrl);
    if (!urlValidation.valid) {
      return { success: false, error: urlValidation.error };
    }

    try {
      const client = await this.createWebDAVClient(config);
      // 尝试获取根目录信息来验证连接
      await client.getDirectoryContents('/');
      Logger.info('✅ [WebDAVManager] WebDAV 连接测试成功');
      return { success: true };
    } catch (error: any) {
      const errorMessage = this.parseWebDAVError(error);
      Logger.error(`❌ [WebDAVManager] WebDAV 连接测试失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 上传备份到 WebDAV 服务器
   */
  async uploadBackup(config: WebDAVConfig, _localPath?: string): Promise<WebDAVResult<string>> {
    // 验证 URL 格式
    const urlValidation = validateWebDAVUrl(config.serverUrl);
    if (!urlValidation.valid) {
      return { success: false, error: urlValidation.error };
    }

    try {
      const content = await createAppStorageBundleContent();

      // 验证 JSON 格式和 stable config 内容
      try {
        extractStableConfigFromBackupContent(content);
      } catch {
        return { success: false, error: '配置包不是有效的 JSON 格式' };
      }

      const client = await this.createWebDAVClient(config);

      // 确保远程目录存在
      await this.ensureRemoteDirectory(client, config.remotePath);

      // 生成带时间戳的文件名
      const filename = generateBackupFilename();
      const remotePath = path.posix.join(config.remotePath, filename);

      // 上传文件
      await client.putFileContents(remotePath, content, { overwrite: true });
      Logger.info(`✅ [WebDAVManager] 配置包上传成功: ${filename}`);

      // 清理旧备份
      await this.cleanupOldBackups(config);

      return { success: true, data: filename };
    } catch (error: any) {
      const errorMessage = this.parseWebDAVError(error);
      Logger.error(`❌ [WebDAVManager] 备份上传失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 列出 WebDAV 服务器上的备份文件
   */
  async listBackups(config: WebDAVConfig): Promise<WebDAVResult<WebDAVBackupInfo[]>> {
    // 验证 URL 格式
    const urlValidation = validateWebDAVUrl(config.serverUrl);
    if (!urlValidation.valid) {
      return { success: false, error: urlValidation.error };
    }

    try {
      const client = await this.createWebDAVClient(config);

      // 检查目录是否存在
      const exists = await client.exists(config.remotePath);
      if (!exists) {
        return { success: true, data: [] };
      }

      // 获取目录内容
      const contents = (await client.getDirectoryContents(config.remotePath)) as FileStat[];

      // 过滤出配置备份文件并转换格式
      const backups: WebDAVBackupInfo[] = contents
        .filter(
          item =>
            item.type === 'file' &&
            item.basename.startsWith('config_') &&
            item.basename.endsWith('.json')
        )
        .map(item => ({
          filename: item.basename,
          path: item.filename,
          lastModified: new Date(item.lastmod),
          size: item.size,
        }));

      // 按日期降序排序
      const sortedBackups = sortBackupsByDate(backups);

      Logger.info(`📋 [WebDAVManager] 获取备份列表成功，共 ${sortedBackups.length} 个备份`);
      return { success: true, data: sortedBackups };
    } catch (error: any) {
      const errorMessage = this.parseWebDAVError(error);
      Logger.error(`❌ [WebDAVManager] 获取备份列表失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 从 WebDAV 服务器下载备份文件
   */
  async downloadBackup(
    config: WebDAVConfig,
    filename: string,
    localPath: string
  ): Promise<WebDAVResult> {
    // 验证 URL 格式
    const urlValidation = validateWebDAVUrl(config.serverUrl);
    if (!urlValidation.valid) {
      return { success: false, error: urlValidation.error };
    }

    try {
      const client = await this.createWebDAVClient(config);
      const remotePath = path.posix.join(config.remotePath, filename);

      // 下载文件内容
      const content = (await client.getFileContents(remotePath, { format: 'text' })) as string;

      // 验证 JSON 格式，兼容 legacy config-only 和 manifest 配置包
      try {
        extractStableConfigFromBackupContent(content);
      } catch {
        return { success: false, error: '下载的备份文件不是有效的 JSON 格式' };
      }

      // 确保本地目录存在
      const localDir = path.dirname(localPath);
      await fs.mkdir(localDir, { recursive: true });

      // 写入本地文件
      await fs.writeFile(localPath, content, 'utf-8');
      Logger.info(`✅ [WebDAVManager] 备份下载成功: ${filename}`);

      return { success: true };
    } catch (error: any) {
      const errorMessage = this.parseWebDAVError(error);
      Logger.error(`❌ [WebDAVManager] 备份下载失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 从 WebDAV 服务器删除备份文件
   */
  async deleteBackup(config: WebDAVConfig, filename: string): Promise<WebDAVResult> {
    // 验证 URL 格式
    const urlValidation = validateWebDAVUrl(config.serverUrl);
    if (!urlValidation.valid) {
      return { success: false, error: urlValidation.error };
    }

    try {
      const client = await this.createWebDAVClient(config);
      const remotePath = path.posix.join(config.remotePath, filename);

      await client.deleteFile(remotePath);
      Logger.info(`🗑️ [WebDAVManager] 备份删除成功: ${filename}`);

      return { success: true };
    } catch (error: any) {
      const errorMessage = this.parseWebDAVError(error);
      Logger.error(`❌ [WebDAVManager] 备份删除失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 清理旧备份，保留最近的 maxBackups 个
   */
  async cleanupOldBackups(config: WebDAVConfig): Promise<WebDAVResult<string[]>> {
    try {
      const listResult = await this.listBackups(config);
      if (!listResult.success || !listResult.data) {
        return { success: false, error: listResult.error || '获取备份列表失败' };
      }

      const backups = listResult.data;
      const maxBackups = config.maxBackups || DEFAULT_WEBDAV_CONFIG.maxBackups;

      if (backups.length <= maxBackups) {
        return { success: true, data: [] };
      }

      // 删除超出限制的旧备份（列表已按日期降序排列）
      const toDelete = backups.slice(maxBackups);
      const deletedFiles: string[] = [];

      for (const backup of toDelete) {
        const deleteResult = await this.deleteBackup(config, backup.filename);
        if (deleteResult.success) {
          deletedFiles.push(backup.filename);
          Logger.info(`🗑️ [WebDAVManager] 清理旧备份: ${backup.filename}`);
        }
      }

      Logger.info(`✅ [WebDAVManager] 清理完成，删除了 ${deletedFiles.length} 个旧备份`);
      return { success: true, data: deletedFiles };
    } catch (error: any) {
      const errorMessage = this.parseWebDAVError(error);
      Logger.error(`❌ [WebDAVManager] 清理旧备份失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 从 WebDAV 备份恢复配置
   * 1. 创建本地备份
   * 2. 下载远程备份到临时文件
   * 3. 验证 JSON 格式
   * 4. 原子性替换配置文件
   * 5. 重新加载配置
   */
  async restoreBackup(config: WebDAVConfig, filename: string): Promise<WebDAVResult> {
    const configPath = unifiedConfigManager.getConfigPath();
    const tempPath = path.join(os.tmpdir(), `webdav_restore_${Date.now()}.json`);

    try {
      // 1. 创建本地备份（恢复前）
      Logger.info('💾 [WebDAVManager] 恢复前创建本地备份...');
      await backupManager.backupFile(configPath, { force: true, reason: 'before-webdav-restore' });

      // 2. 下载远程备份到临时文件
      const downloadResult = await this.downloadBackup(config, filename, tempPath);
      if (!downloadResult.success) {
        return downloadResult;
      }

      // 3. 读取并验证下载的内容
      const content = await fs.readFile(tempPath, 'utf-8');
      try {
        extractStableConfigFromBackupContent(content);
      } catch {
        // 清理临时文件
        await fs.unlink(tempPath).catch(() => {});
        return { success: false, error: '备份文件格式无效' };
      }

      // 4. 恢复 manifest 配置包或 legacy config-only 备份
      await restoreAppStorageBackupContent(content, configPath);

      // 5. 清理临时文件
      await fs.unlink(tempPath).catch(() => {});

      // 6. 重新加载配置
      await unifiedConfigManager.loadConfig();

      Logger.info(`✅ [WebDAVManager] 配置恢复成功: ${filename}`);
      return { success: true };
    } catch (error: any) {
      // 清理临时文件
      await fs.unlink(tempPath).catch(() => {});

      const errorMessage = error.message || '恢复失败';
      Logger.error(`❌ [WebDAVManager] 配置恢复失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 解析 WebDAV 错误信息
   */
  private parseWebDAVError(error: any): string {
    if (error.response) {
      const status = error.response.status;
      switch (status) {
        case 401:
          return '认证失败，请检查用户名和密码';
        case 403:
          return '访问被拒绝，请检查权限设置';
        case 404:
          return '路径不存在';
        case 405:
          return '服务器不支持此操作';
        case 409:
          return '目录冲突';
        case 507:
          return '服务器存储空间不足';
        default:
          return `服务器错误 (${status})`;
      }
    }

    if (error.code === 'ECONNREFUSED') {
      return '无法连接到服务器，请检查服务器地址';
    }
    if (error.code === 'ENOTFOUND') {
      return '服务器地址无法解析，请检查 URL';
    }
    if (error.code === 'ETIMEDOUT') {
      return '连接超时，请检查网络';
    }

    return error.message || '未知错误';
  }
}

// 导出单例实例
export const webdavManager = new WebDAVManager();
