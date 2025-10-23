/**
 * 令牌存储服务
 * 负责账号信息和令牌的持久化存储
 * 使用JSON文件存储（后续可升级为electron-store加密存储）
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { SiteAccount, StorageConfig } from './types/token';

export class TokenStorage {
  private storagePath: string;
  private config: StorageConfig = {
    accounts: [],
    last_updated: Date.now()
  };

  constructor() {
    // 使用应用数据目录
    const userDataPath = app.getPath('userData');
    this.storagePath = path.join(userDataPath, 'token-storage.json');
    this.loadFromDisk();
  }

  /**
   * 从磁盘加载配置
   */
  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf-8');
        this.config = JSON.parse(data);
        console.log(`✅ 加载了 ${this.config.accounts.length} 个账号信息`);
      } else {
        console.log('📝 首次运行，创建新的存储文件');
        this.saveToDisk();
      }
    } catch (error) {
      console.error('❌ 加载存储文件失败:', error);
      // 如果加载失败，使用空配置
      this.config = {
        accounts: [],
        last_updated: Date.now()
      };
    }
  }

  /**
   * 保存配置到磁盘
   */
  private saveToDisk(): void {
    try {
      this.config.last_updated = Date.now();
      const data = JSON.stringify(this.config, null, 2);
      fs.writeFileSync(this.storagePath, data, 'utf-8');
      console.log('💾 存储文件已保存');
    } catch (error) {
      console.error('❌ 保存存储文件失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有账号
   */
  async getAllAccounts(): Promise<SiteAccount[]> {
    return this.config.accounts;
  }

  /**
   * 根据ID获取账号
   */
  async getAccountById(id: string): Promise<SiteAccount | null> {
    const account = this.config.accounts.find(acc => acc.id === id);
    return account || null;
  }

  /**
   * 根据URL查找账号
   */
  async getAccountByUrl(url: string): Promise<SiteAccount | null> {
    try {
      const targetOrigin = new URL(url).origin;
      const account = this.config.accounts.find(acc => {
        try {
          return new URL(acc.site_url).origin === targetOrigin;
        } catch {
          return false;
        }
      });
      return account || null;
    } catch {
      return null;
    }
  }

  /**
   * 保存账号
   */
  async saveAccount(account: SiteAccount): Promise<void> {
    const index = this.config.accounts.findIndex(acc => acc.id === account.id);
    
    if (index >= 0) {
      // 更新现有账号
      this.config.accounts[index] = {
        ...account,
        updated_at: Date.now()
      };
    } else {
      // 添加新账号
      this.config.accounts.push({
        ...account,
        created_at: Date.now(),
        updated_at: Date.now()
      });
    }
    
    this.saveToDisk();
  }

  /**
   * 删除账号
   */
  async deleteAccount(id: string): Promise<boolean> {
    const initialLength = this.config.accounts.length;
    this.config.accounts = this.config.accounts.filter(acc => acc.id !== id);
    
    if (this.config.accounts.length < initialLength) {
      this.saveToDisk();
      return true;
    }
    
    return false;
  }

  /**
   * 更新账号的访问令牌
   */
  async updateAccountToken(
    id: string,
    accessToken: string
  ): Promise<boolean> {
    const account = await this.getAccountById(id);
    
    if (!account) {
      return false;
    }
    
    if (account.account_info) {
      account.account_info.access_token = accessToken;
    }
    account.updated_at = Date.now();
    
    await this.saveAccount(account);
    return true;
  }

  /**
   * 更新账号的同步时间
   */
  async updateSyncTime(id: string): Promise<boolean> {
    const account = await this.getAccountById(id);
    
    if (!account) {
      return false;
    }
    
    account.last_sync_time = Date.now();
    account.updated_at = Date.now();
    
    await this.saveAccount(account);
    return true;
  }

  /**
   * 清空所有数据
   */
  async clearAll(): Promise<void> {
    this.config = {
      accounts: [],
      last_updated: Date.now()
    };
    this.saveToDisk();
  }

  /**
   * 导出数据
   */
  async exportData(): Promise<StorageConfig> {
    return { ...this.config };
  }

  /**
   * 导入数据
   */
  async importData(data: StorageConfig): Promise<void> {
    this.config = {
      ...data,
      last_updated: Date.now()
    };
    this.saveToDisk();
  }

  /**
   * 生成唯一ID
   */
  generateId(): string {
    return `account_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}