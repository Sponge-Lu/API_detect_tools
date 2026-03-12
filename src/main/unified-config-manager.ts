/**
 * 输入: FileSystem (文件系统), Electron app (应用路径), BackupManager (备份管理)
 * 输出: UnifiedConfig (统一配置), 配置操作方法, 账户 CRUD
 * 定位: 数据层 - 管理统一配置作为单一数据源，支持多账户存储与切换
 *
 * 多账户: accounts[] 存储 AccountCredential，site.active_account_id 指向当前活跃账户
 * 迁移: v2 → v3 自动迁移，为已有站点创建默认账户
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * 统一配置管理器
 * 合并 ConfigManager 和 TokenStorage 为单一数据源
 */

import Logger from './utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { backupManager } from './backup-manager';
import type {
  UnifiedConfig,
  UnifiedSite,
  SiteGroup,
  Settings,
  SiteConfig,
  AccountCredential,
  DetectionCacheData,
} from '../shared/types/site';
import { generateSiteId, generateAccountId } from '../shared/types/site';

const CONFIG_VERSION = '3.0';

const DEFAULT_SETTINGS: Settings = {
  timeout: 30,
  concurrent: true,
  max_concurrent: 3,
  show_disabled: false,
  browser_path: '',
};

const DEFAULT_GROUP: SiteGroup = { id: 'default', name: '默认分组' };
const UNAVAILABLE_GROUP: SiteGroup = { id: 'unavailable', name: '不可用' };

export class UnifiedConfigManager {
  private configPath: string;
  private config: UnifiedConfig | null = null;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, 'config.json');
    Logger.info(`📁 [UnifiedConfigManager] 配置文件路径: ${this.configPath}`);
  }

  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * 加载配置
   */
  async loadConfig(): Promise<UnifiedConfig> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      let config: UnifiedConfig = JSON.parse(data);

      // v2 → v3 自动迁移
      if (config.version !== CONFIG_VERSION) {
        config = await this.migrateToV3(config);
      }

      this.config = this.normalizeConfig(config);
      Logger.info(
        `✅ [UnifiedConfigManager] 加载配置成功，${this.config.sites.length} 个站点，${this.config.accounts.length} 个账户`
      );
      return this.config;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        Logger.error('❌ [UnifiedConfigManager] 加载配置失败:', error.message);
      }
    }

    // 配置不存在，创建默认配置
    Logger.info('📝 [UnifiedConfigManager] 创建默认配置...');
    this.config = this.createDefaultConfig();
    await this.saveConfig();
    return this.config;
  }

  /**
   * 规范化配置（补全缺失字段）
   */
  private normalizeConfig(config: UnifiedConfig): UnifiedConfig {
    // 确保 sites 是数组
    if (!Array.isArray(config.sites)) {
      config.sites = [];
    }

    // 确保每个站点有 ID
    config.sites = config.sites.map(site => ({
      ...site,
      id: site.id || generateSiteId(),
      group: site.group || 'default',
      enabled: site.enabled !== false,
    }));

    // 确保 accounts 数组存在
    if (!Array.isArray(config.accounts)) {
      config.accounts = [];
    }

    // 确保有分组
    if (!Array.isArray(config.siteGroups) || config.siteGroups.length === 0) {
      config.siteGroups = [DEFAULT_GROUP, UNAVAILABLE_GROUP];
    } else {
      if (!config.siteGroups.some(g => g.id === 'default')) {
        config.siteGroups.unshift(DEFAULT_GROUP);
      }
      if (!config.siteGroups.some(g => g.id === 'unavailable')) {
        config.siteGroups.push(UNAVAILABLE_GROUP);
      }
    }

    // 确保设置完整并规范范围
    config.settings = { ...DEFAULT_SETTINGS, ...config.settings };
    const maxConcurrent = config.settings.max_concurrent ?? DEFAULT_SETTINGS.max_concurrent!;
    config.settings.max_concurrent = Math.min(5, Math.max(1, maxConcurrent));

    const timeoutSeconds = config.settings.timeout ?? DEFAULT_SETTINGS.timeout!;
    config.settings.timeout = Math.max(5, timeoutSeconds);

    // 迁移：site.cached_data → account.cached_data（首次加载一次性复制）
    const accountById = new Map<string, AccountCredential>();
    const accountsBySite = new Map<string, AccountCredential[]>();
    config.accounts.forEach(account => {
      accountById.set(account.id, account);
      const list = accountsBySite.get(account.site_id) || [];
      list.push(account);
      accountsBySite.set(account.site_id, list);
    });
    config.sites.forEach(site => {
      if (!site.cached_data) return;
      const siteAccounts = accountsBySite.get(site.id) || [];
      if (siteAccounts.length === 0) return;
      const targetAccount =
        (site.active_account_id && accountById.get(site.active_account_id)) ||
        (siteAccounts.length === 1 ? siteAccounts[0] : undefined);
      if (targetAccount && !targetAccount.cached_data) {
        targetAccount.cached_data = { ...site.cached_data };
        targetAccount.updated_at = Date.now();
      }
    });

    return config;
  }

  /**
   * 创建默认配置
   */
  private createDefaultConfig(): UnifiedConfig {
    return {
      version: CONFIG_VERSION,
      sites: [],
      accounts: [],
      siteGroups: [DEFAULT_GROUP, UNAVAILABLE_GROUP],
      settings: DEFAULT_SETTINGS,
      last_updated: Date.now(),
    };
  }

  /**
   * 保存配置
   */
  async saveConfig(config?: UnifiedConfig): Promise<void> {
    if (config) {
      this.config = config;
    }
    if (!this.config) {
      throw new Error('No config to save');
    }

    this.config.last_updated = Date.now();
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    Logger.info('💾 [UnifiedConfigManager] 配置已保存');

    // 自动备份
    try {
      await backupManager.backupFile(this.configPath);
    } catch (error) {
      Logger.error('⚠️ [UnifiedConfigManager] 自动备份失败:', error);
    }
  }

  // ============= 配置迁移 =============

  /**
   * v2 → v3 迁移：为现有站点创建默认账户
   */
  private async migrateToV3(config: any): Promise<UnifiedConfig> {
    Logger.info('🔄 [UnifiedConfigManager] 开始 v2 → v3 迁移...');

    // 备份旧配置
    const backupPath = this.configPath.replace('.json', `.v2.backup.${Date.now()}.json`);
    try {
      await fs.writeFile(backupPath, JSON.stringify(config, null, 2), 'utf-8');
      Logger.info(`📦 [UnifiedConfigManager] 旧配置已备份: ${backupPath}`);
    } catch (e: any) {
      Logger.warn(`⚠️ [UnifiedConfigManager] 备份失败: ${e.message}`);
    }

    // 初始化 accounts 数组
    const accounts: AccountCredential[] = config.accounts || [];
    const sites: UnifiedSite[] = config.sites || [];

    for (const site of sites) {
      // 确保 site.id 存在（legacy 配置可能没有）
      if (!site.id) site.id = generateSiteId();
      // 跳过已有 active_account_id 的站点（幂等）
      if (site.active_account_id) continue;

      // 仅当站点有认证信息时创建默认账户
      if (site.access_token && site.user_id) {
        const accountId = generateAccountId();
        accounts.push({
          id: accountId,
          site_id: site.id,
          account_name: '默认账户',
          user_id: site.user_id,
          access_token: site.access_token,
          auth_source: 'manual',
          status: 'active',
          cached_data: site.cached_data ? { ...site.cached_data } : undefined,
          created_at: Date.now(),
          updated_at: Date.now(),
        });
        site.active_account_id = accountId;
      }
    }

    config.version = CONFIG_VERSION;
    config.accounts = accounts;
    config.sites = sites;

    Logger.info(`✅ [UnifiedConfigManager] v3 迁移完成，创建了 ${accounts.length} 个默认账户`);
    return config as UnifiedConfig;
  }

  // ============= 站点操作 =============

  /**
   * 获取所有站点
   */
  getSites(): UnifiedSite[] {
    return this.config?.sites || [];
  }

  /**
   * 根据 ID 获取站点
   */
  getSiteById(id: string): UnifiedSite | null {
    return this.config?.sites.find(s => s.id === id) || null;
  }

  /**
   * 根据 URL 获取站点
   */
  getSiteByUrl(url: string): UnifiedSite | null {
    try {
      const targetOrigin = new URL(url).origin;
      return (
        this.config?.sites.find(s => {
          try {
            return new URL(s.url).origin === targetOrigin;
          } catch {
            return false;
          }
        }) || null
      );
    } catch {
      return null;
    }
  }

  /**
   * 添加站点
   */
  async addSite(site: Omit<UnifiedSite, 'id'> & { id?: string }): Promise<UnifiedSite> {
    if (!this.config) await this.loadConfig();

    const newSite: UnifiedSite = {
      ...site,
      id: site.id || generateSiteId(),
      group: site.group || 'default',
      enabled: site.enabled !== false,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    this.config!.sites.push(newSite);
    await this.saveConfig();
    return newSite;
  }

  /**
   * 更新站点
   */
  async updateSite(id: string, updates: Partial<UnifiedSite>): Promise<boolean> {
    if (!this.config) return false;

    const index = this.config.sites.findIndex(s => s.id === id);
    if (index === -1) return false;

    this.config.sites[index] = {
      ...this.config.sites[index],
      ...updates,
      id, // 确保 ID 不变
      updated_at: Date.now(),
    };

    await this.saveConfig();
    return true;
  }

  /**
   * 删除站点（同时删除关联的所有账户）
   */
  async deleteSite(id: string): Promise<boolean> {
    if (!this.config) return false;

    const initialLength = this.config.sites.length;
    this.config.sites = this.config.sites.filter(s => s.id !== id);

    if (this.config.sites.length < initialLength) {
      // 删除关联的所有账户
      this.config.accounts = this.config.accounts.filter(a => a.site_id !== id);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * 更新站点令牌
   */
  async updateSiteToken(id: string, accessToken: string): Promise<boolean> {
    return this.updateSite(id, { access_token: accessToken });
  }

  /**
   * URL 匹配（比较 origin）
   */
  private urlMatches(url1: string, url2: string): boolean {
    try {
      return new URL(url1).origin === new URL(url2).origin;
    } catch {
      return false;
    }
  }

  // ============= 账户操作 =============

  /**
   * 根据 ID 获取单个账户
   */
  getAccountById(accountId: string): AccountCredential | undefined {
    return this.config?.accounts.find(a => a.id === accountId);
  }

  /**
   * 获取站点的所有账户
   */
  getAccountsBySiteId(siteId: string): AccountCredential[] {
    return this.config?.accounts.filter(a => a.site_id === siteId) || [];
  }

  /**
   * 获取站点的活跃账户
   */
  getActiveAccount(siteId: string): AccountCredential | null {
    const site = this.getSiteById(siteId);
    if (!site?.active_account_id) return null;
    return this.config?.accounts.find(a => a.id === site.active_account_id) || null;
  }

  /**
   * 添加账户并设为活跃（同步更新站点 legacy 字段）
   */
  async addAccount(
    account: Omit<AccountCredential, 'id' | 'created_at' | 'updated_at'> & { id?: string }
  ): Promise<AccountCredential> {
    if (!this.config) await this.loadConfig();

    const now = Date.now();
    const site = this.config!.sites.find(s => s.id === account.site_id);

    // 站点有 legacy 凭证但无账户记录 → 先补建默认账户，防止原凭证被覆盖丢失
    if (site) {
      const existingAccounts = this.config!.accounts.filter(a => a.site_id === account.site_id);
      if (existingAccounts.length === 0 && (site.access_token || site.user_id)) {
        const defaultAccount: AccountCredential = {
          id: generateAccountId(),
          site_id: account.site_id,
          account_name: '默认账户',
          user_id: site.user_id || '',
          access_token: site.access_token || '',
          auth_source: 'manual',
          status: site.access_token ? 'active' : 'expired',
          cached_data: site.cached_data ? { ...site.cached_data } : undefined,
          created_at: now,
          updated_at: now,
        };
        this.config!.accounts.push(defaultAccount);
        site.active_account_id = defaultAccount.id;
        Logger.info(
          `🔄 [UnifiedConfigManager] 自动补建默认账户: ${defaultAccount.id} (site=${account.site_id})`
        );
      }
    }

    const newAccount: AccountCredential = {
      ...account,
      id: account.id || generateAccountId(),
      created_at: now,
      updated_at: now,
    };

    this.config!.accounts.push(newAccount);

    // 新增账户后切换为活跃账户，确保后续刷新使用最新登录凭证
    if (site) {
      this.syncActiveAccount(site, newAccount);
    }

    await this.saveConfig();
    return newAccount;
  }

  /**
   * 更新账户
   */
  async updateAccount(
    accountId: string,
    updates: Partial<
      Pick<AccountCredential, 'account_name' | 'status' | 'access_token' | 'user_id'>
    >
  ): Promise<boolean> {
    if (!this.config) return false;

    const index = this.config.accounts.findIndex(a => a.id === accountId);
    if (index === -1) return false;

    this.config.accounts[index] = {
      ...this.config.accounts[index],
      ...updates,
      updated_at: Date.now(),
    };

    // 如果更新的是活跃账户的 token/user_id，同步到站点 legacy 字段
    const account = this.config.accounts[index];
    const site = this.config.sites.find(s => s.active_account_id === accountId);
    if (site && (updates.access_token || updates.user_id)) {
      this.syncActiveAccount(site, account);
    }

    await this.saveConfig();
    return true;
  }

  /**
   * 更新账户级检测缓存
   */
  async updateAccountCachedData(
    accountId: string,
    updater: (current?: DetectionCacheData) => DetectionCacheData
  ): Promise<boolean> {
    if (!this.config) await this.loadConfig();
    if (!this.config) return false;

    const index = this.config.accounts.findIndex(a => a.id === accountId);
    if (index === -1) return false;

    const current = this.config.accounts[index].cached_data;
    this.config.accounts[index] = {
      ...this.config.accounts[index],
      cached_data: updater(current),
      updated_at: Date.now(),
    };

    await this.saveConfig();
    return true;
  }

  /**
   * 删除账户
   */
  async deleteAccount(accountId: string): Promise<boolean> {
    if (!this.config) return false;

    const account = this.config.accounts.find(a => a.id === accountId);
    if (!account) return false;

    this.config.accounts = this.config.accounts.filter(a => a.id !== accountId);

    // 如果删除的是活跃账户，切换到同站点的另一个账户
    const site = this.config.sites.find(s => s.active_account_id === accountId);
    if (site) {
      const remaining = this.config.accounts.filter(a => a.site_id === site.id);
      if (remaining.length > 0) {
        this.syncActiveAccount(site, remaining[0]);
      } else {
        site.active_account_id = undefined;
        site.access_token = undefined;
        site.user_id = undefined;
      }
    }

    await this.saveConfig();
    return true;
  }

  /**
   * 切换站点的活跃账户
   */
  async setActiveAccount(siteId: string, accountId: string): Promise<boolean> {
    if (!this.config) return false;

    const site = this.config.sites.find(s => s.id === siteId);
    const account = this.config.accounts.find(a => a.id === accountId && a.site_id === siteId);
    if (!site || !account) return false;

    this.syncActiveAccount(site, account);
    await this.saveConfig();
    return true;
  }

  /**
   * 同步活跃账户到站点 legacy 字段
   */
  private syncActiveAccount(site: UnifiedSite, account: AccountCredential): void {
    site.active_account_id = account.id;
    site.access_token = account.access_token;
    site.user_id = account.user_id;
  }

  // ============= 兼容层（供前端使用） =============

  /**
   * 获取兼容旧格式的配置（供前端使用）
   * 包含 cached_data 和 cli_config 以支持缓存数据显示和 CLI 配置
   */
  getLegacyConfig(): {
    sites: (SiteConfig & {
      cached_data?: UnifiedSite['cached_data'];
      cli_config?: UnifiedSite['cli_config'];
      cli_compatibility?: any;
    })[];
    accounts: AccountCredential[];
    settings: Settings;
    siteGroups: SiteGroup[];
  } {
    if (!this.config) {
      return { sites: [], accounts: [], settings: DEFAULT_SETTINGS, siteGroups: [DEFAULT_GROUP] };
    }

    // 转换为旧格式，保留 cached_data 和 cli_config
    const sites = this.config.sites.map(site => ({
      id: site.id, // 站点 ID（多账户操作需要）
      name: site.name,
      url: site.url,
      api_key: site.api_key || '',
      system_token: site.access_token,
      user_id: site.user_id,
      enabled: site.enabled,
      group: site.group,
      has_checkin: site.has_checkin,
      force_enable_checkin: site.force_enable_checkin,
      extra_links: site.extra_links,
      auto_refresh: site.auto_refresh, // 站点独立的自动刷新开关
      auto_refresh_interval: site.auto_refresh_interval, // 自动刷新间隔
      cached_data: site.cached_data, // 保留缓存数据
      cli_config: site.cli_config, // 保留 CLI 配置
      cli_compatibility: (site as any).cli_compatibility, // 兼容旧版本数据结构（站点根级别）
    }));

    return {
      sites,
      accounts: this.config.accounts.map(a => ({ ...a })),
      settings: this.config.settings,
      siteGroups: this.config.siteGroups,
    };
  }

  /**
   * 从旧格式保存（兼容前端）
   */
  async saveLegacyConfig(legacyConfig: {
    sites: SiteConfig[];
    settings: Settings;
    siteGroups?: SiteGroup[];
  }): Promise<void> {
    if (!this.config) await this.loadConfig();

    // 更新设置和分组，保留现有的 webdav 和 browser_profile 配置（如果前端没有传递）
    const existingWebdav = this.config!.settings?.webdav;
    const existingBrowserProfile = this.config!.settings?.browser_profile;
    this.config!.settings = {
      ...legacyConfig.settings,
      webdav: legacyConfig.settings.webdav || existingWebdav,
      browser_profile: (legacyConfig.settings as any).browser_profile || existingBrowserProfile,
    };
    if (legacyConfig.siteGroups) {
      this.config!.siteGroups = legacyConfig.siteGroups;
    }

    // 合并站点更新（保留 ID 和认证信息）
    const newSites: UnifiedSite[] = legacyConfig.sites.map(oldSite => {
      // 查找现有站点：优先按 ID 匹配（保护账户 site_id 引用），其次按 URL
      const existing =
        (oldSite.id ? this.config!.sites.find(s => s.id === oldSite.id) : undefined) ||
        this.config!.sites.find(s => this.urlMatches(s.url, oldSite.url));

      if (existing) {
        // 更新现有站点，保留 ID 和未在旧格式中的字段
        const updated: UnifiedSite = {
          ...existing,
          name: oldSite.name,
          url: oldSite.url,
          api_key: oldSite.api_key,
          access_token: oldSite.system_token || existing.access_token,
          user_id: oldSite.user_id || existing.user_id,
          enabled: oldSite.enabled,
          group: oldSite.group || existing.group,
          has_checkin: oldSite.has_checkin,
          force_enable_checkin: oldSite.force_enable_checkin,
          extra_links: oldSite.extra_links,
          auto_refresh: oldSite.auto_refresh,
          auto_refresh_interval: oldSite.auto_refresh_interval,
          updated_at: Date.now(),
        };

        // 同步 legacy token 变更到活跃账户
        if (updated.active_account_id && (oldSite.system_token || oldSite.user_id)) {
          const acctIdx = this.config!.accounts.findIndex(a => a.id === updated.active_account_id);
          if (acctIdx !== -1) {
            if (oldSite.system_token) {
              this.config!.accounts[acctIdx].access_token = oldSite.system_token;
            }
            if (oldSite.user_id) {
              this.config!.accounts[acctIdx].user_id = oldSite.user_id;
            }
            this.config!.accounts[acctIdx].updated_at = Date.now();
          }
        }

        return updated;
      } else {
        // 新站点
        return {
          id: oldSite.id || generateSiteId(),
          name: oldSite.name,
          url: oldSite.url,
          api_key: oldSite.api_key,
          access_token: oldSite.system_token,
          user_id: oldSite.user_id,
          enabled: oldSite.enabled,
          group: oldSite.group || 'default',
          has_checkin: oldSite.has_checkin,
          force_enable_checkin: oldSite.force_enable_checkin,
          extra_links: oldSite.extra_links,
          auto_refresh: oldSite.auto_refresh,
          auto_refresh_interval: oldSite.auto_refresh_interval,
          created_at: Date.now(),
          updated_at: Date.now(),
        };
      }
    });

    this.config!.sites = newSites;
    await this.saveConfig();
  }

  // ============= 导入导出 =============

  /**
   * 导出完整配置
   */
  async exportConfig(): Promise<UnifiedConfig> {
    if (!this.config) await this.loadConfig();
    return { ...this.config! };
  }

  /**
   * 导入配置
   */
  async importConfig(data: UnifiedConfig | any): Promise<void> {
    // 支持导入旧格式
    if (data.sites && !data.version) {
      // 旧格式，转换
      await this.saveLegacyConfig(data);
      return;
    }

    // 新格式
    this.config = this.normalizeConfig(data);
    await this.saveConfig();
  }
}

// 导出单例
export const unifiedConfigManager = new UnifiedConfigManager();
