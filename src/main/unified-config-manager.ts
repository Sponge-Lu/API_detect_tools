/**
 * 输入: FileSystem (文件系统), Electron app (应用路径), BackupManager (备份管理)
 * 输出: UnifiedConfig (统一配置), 配置操作方法, 账户 CRUD
 * 定位: 数据层 - 管理统一配置作为单一数据源，支持多账户存储与切换
 *
 * 多账户: accounts[] 存储 AccountCredential，站点不再持久化当前活跃账户
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
import { randomBytes } from 'crypto';
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
import type {
  RoutingConfig,
  RouteRule,
  RouteChannelKey,
  RouteChannelStats,
  RouteChannelHealth,
  RouteOutcome,
  RouteCliType,
  RouteModelRegistryConfig,
  RouteModelMappingOverride,
  RouteCliProbeConfig,
  RouteCliProbeSample,
  RouteCliProbeLatest,
  RouteAnalyticsConfig,
  RouteAnalyticsBucket,
} from '../shared/types/route-proxy';
import {
  DEFAULT_ROUTING_CONFIG,
  DEFAULT_CLI_PROBE_CONFIG,
  DEFAULT_ANALYTICS_CONFIG,
  DEFAULT_MODEL_REGISTRY_CONFIG,
  buildStatsKey,
} from '../shared/types/route-proxy';

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
    let loadError: any = null;

    try {
      this.config = await this.readConfigFromPath(this.configPath);
      Logger.info(
        `✅ [UnifiedConfigManager] 加载配置成功，${this.config.sites.length} 个站点，${this.config.accounts.length} 个账户`
      );
      return this.config;
    } catch (error: any) {
      loadError = error;
      if (error.code !== 'ENOENT') {
        Logger.error('❌ [UnifiedConfigManager] 加载配置失败:', error.message);
      } else {
        Logger.warn(`⚠️ [UnifiedConfigManager] 配置文件不存在: ${this.configPath}`);
      }
    }

    const recoveredConfig = await this.tryRestoreFromBackup();
    if (recoveredConfig) {
      this.config = recoveredConfig;
      Logger.warn(
        `♻️ [UnifiedConfigManager] 已从备份恢复配置，${this.config.sites.length} 个站点，${this.config.accounts.length} 个账户`
      );
      return this.config;
    }

    if (loadError?.code !== 'ENOENT') {
      await this.preserveCorruptedConfig();
    }

    Logger.info('📝 [UnifiedConfigManager] 创建默认配置...');
    this.config = this.createDefaultConfig();
    await this.saveConfig();
    return this.config;
  }

  /**
   * 从指定路径读取并规范化配置
   */
  private async readConfigFromPath(configPath: string): Promise<UnifiedConfig> {
    const data = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(data);

    this.assertConfigShape(parsed, configPath);

    let config: UnifiedConfig = parsed;

    // v2 → v3 自动迁移
    if (config.version !== CONFIG_VERSION) {
      config = await this.migrateToV3(config);
    }

    return this.normalizeConfig(config);
  }

  /**
   * 校验配置文件根结构，避免将损坏文件静默规范化为空配置
   */
  private assertConfigShape(config: any, configPath: string): void {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error(`配置文件根对象无效: ${configPath}`);
    }

    if (!Array.isArray(config.sites)) {
      throw new Error(`配置文件缺少有效的 sites 数组: ${configPath}`);
    }
  }

  /**
   * 尝试从最近的有效备份恢复
   */
  private async tryRestoreFromBackup(): Promise<UnifiedConfig | null> {
    const backups = backupManager.listBackups();

    for (const backup of backups) {
      try {
        const recoveredConfig = await this.readConfigFromPath(backup.path);
        const restored = await backupManager.restoreFromBackup(backup.filename, this.configPath);

        if (!restored) {
          Logger.warn(
            `⚠️ [UnifiedConfigManager] 恢复备份失败，继续尝试更早备份: ${backup.filename}`
          );
          continue;
        }

        Logger.warn(`♻️ [UnifiedConfigManager] 使用备份恢复配置: ${backup.filename}`);
        return recoveredConfig;
      } catch (error: any) {
        Logger.warn(
          `⚠️ [UnifiedConfigManager] 跳过无效备份 ${backup.filename}: ${error?.message || error}`
        );
      }
    }

    return null;
  }

  /**
   * 保留损坏配置副本，避免空配置覆盖现场
   */
  private async preserveCorruptedConfig(): Promise<void> {
    try {
      await fs.access(this.configPath);
    } catch {
      return;
    }

    const ext = path.extname(this.configPath);
    const base = this.configPath.slice(0, this.configPath.length - ext.length);
    const corruptedPath = `${base}.corrupted.${Date.now()}${ext}`;

    try {
      await fs.rename(this.configPath, corruptedPath);
      Logger.warn(`🧯 [UnifiedConfigManager] 已保留损坏配置副本: ${corruptedPath}`);
    } catch (error: any) {
      Logger.warn(`⚠️ [UnifiedConfigManager] 保留损坏配置副本失败: ${error.message}`);
    }
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
    config.sites = config.sites.map(site => {
      const { active_account_id: _legacyActiveAccountId, ...rest } = site as UnifiedSite & {
        active_account_id?: string;
      };
      return {
        ...rest,
        id: rest.id || generateSiteId(),
        group: rest.group || 'default',
        enabled: rest.enabled !== false,
      };
    });

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

    // 迁移：site.cached_data / site.cli_config → account（首次加载一次性复制）
    const accountsBySite = new Map<string, AccountCredential[]>();
    config.accounts.forEach(account => {
      const list = accountsBySite.get(account.site_id) || [];
      list.push(account);
      accountsBySite.set(account.site_id, list);
    });
    config.sites.forEach(site => {
      if (!site.cached_data) return;
      const siteAccounts = accountsBySite.get(site.id) || [];
      if (siteAccounts.length === 0) return;
      const targetAccount = this.getPreferredAccountFromList(siteAccounts);
      if (targetAccount && !targetAccount.cached_data) {
        targetAccount.cached_data = { ...site.cached_data };
        targetAccount.updated_at = Date.now();
      }
    });
    config.sites.forEach(site => {
      if (!site.cli_config) return;
      const siteAccounts = accountsBySite.get(site.id) || [];
      if (siteAccounts.length === 0) return;
      const targetAccount = this.getPreferredAccountFromList(siteAccounts);
      if (targetAccount && !targetAccount.cli_config) {
        targetAccount.cli_config = { ...site.cli_config };
        targetAccount.updated_at = Date.now();
      }
    });

    // 规范化路由配置
    this.normalizeRoutingConfig(config);

    return config;
  }

  private getPreferredAccountFromList(
    accounts: AccountCredential[]
  ): AccountCredential | undefined {
    return accounts.find(account => account.account_name === '默认账户') || accounts[0];
  }

  /**
   * 规范化 routing 字段，补全缺失的默认值
   */
  private normalizeRoutingConfig(config: UnifiedConfig): void {
    if (!config.routing) {
      config.routing = { ...DEFAULT_ROUTING_CONFIG };
      return;
    }
    const r = config.routing;
    if (!r.server) r.server = { ...DEFAULT_ROUTING_CONFIG.server };
    if (!r.rules) r.rules = [];
    if (!r.stats) r.stats = {};
    if (!r.health) r.health = {};
    if (!r.cliModelSelections)
      r.cliModelSelections = { claudeCode: null, codex: null, geminiCli: null };
    if (!r.modelRegistry) r.modelRegistry = { ...DEFAULT_MODEL_REGISTRY_CONFIG };
    if (!r.cliProbe) {
      r.cliProbe = { config: { ...DEFAULT_CLI_PROBE_CONFIG }, latest: {}, history: {} };
    } else {
      if (!r.cliProbe.config) r.cliProbe.config = { ...DEFAULT_CLI_PROBE_CONFIG };
      if (!r.cliProbe.latest) r.cliProbe.latest = {};
      if (!r.cliProbe.history) r.cliProbe.history = {};
    }
    if (!r.analytics) {
      r.analytics = { config: { ...DEFAULT_ANALYTICS_CONFIG }, buckets: {} };
    } else {
      if (!r.analytics.config) r.analytics.config = { ...DEFAULT_ANALYTICS_CONFIG };
      if (!r.analytics.buckets) r.analytics.buckets = {};
    }
    // 补全 server 字段
    const s = r.server;
    if (!s.host) s.host = '127.0.0.1';
    if (!s.port) s.port = 3210;
    if (!s.unifiedApiKey) {
      s.unifiedApiKey = `sk-route-${randomBytes(16).toString('hex')}`;
    }
    if (!s.requestTimeoutMs) s.requestTimeoutMs = 300000;
    if (s.retryCount === undefined || s.retryCount === null) s.retryCount = 1;
    if (!s.healthCheckIntervalMinutes) s.healthCheckIntervalMinutes = 60;
    if (s.enabled === undefined) s.enabled = false;
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
      this.assertConfigShape(config, this.configPath);
      this.config = this.normalizeConfig(config);
    }
    if (!this.config) {
      throw new Error('No config to save');
    }

    this.config.last_updated = Date.now();
    await this.writeConfigAtomically(this.configPath, JSON.stringify(this.config, null, 2));
    Logger.info('💾 [UnifiedConfigManager] 配置已保存');

    // 自动备份
    try {
      await backupManager.backupFile(this.configPath);
    } catch (error) {
      Logger.error('⚠️ [UnifiedConfigManager] 自动备份失败:', error);
    }
  }

  /**
   * 原子写入配置文件，避免应用异常退出时产生半截 JSON
   */
  private async writeConfigAtomically(targetPath: string, content: string): Promise<void> {
    const dir = path.dirname(targetPath);
    const tempPath = path.join(
      dir,
      `${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
    );

    await fs.mkdir(dir, { recursive: true });

    try {
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, targetPath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // 忽略清理临时文件失败
      }
      throw error;
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
      const existingAccounts = accounts.filter(account => account.site_id === site.id);
      if (existingAccounts.length > 0) continue;

      // 仅当站点有认证信息时创建默认账户
      if (site.access_token && site.user_id) {
        accounts.push({
          id: generateAccountId(),
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
   * 添加账户
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

    await this.saveConfig();
    return newAccount;
  }

  /**
   * 更新账户
   */
  async updateAccount(
    accountId: string,
    updates: Partial<
      Pick<
        AccountCredential,
        | 'account_name'
        | 'status'
        | 'access_token'
        | 'user_id'
        | 'auto_refresh'
        | 'auto_refresh_interval'
        | 'cli_config'
      >
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

    await this.saveConfig();
    return true;
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
    this.assertConfigShape(data, 'imported config');
    this.config = this.normalizeConfig(data);
    await this.saveConfig();
  }

  // ============= 路由配置操作 =============

  /**
   * 获取路由配置
   */
  getRoutingConfig(): RoutingConfig {
    if (!this.config) throw new Error('Config not loaded');
    this.normalizeRoutingConfig(this.config);
    return this.config.routing!;
  }

  /**
   * 更新路由服务器配置
   */
  async updateRouteServerConfig(updates: Partial<RoutingConfig['server']>): Promise<void> {
    if (!this.config) throw new Error('Config not loaded');
    this.normalizeRoutingConfig(this.config);
    this.config.routing!.server = { ...this.config.routing!.server, ...updates };
    await this.saveConfig();
  }

  /**
   * 插入或更新路由规则
   */
  async upsertRouteRule(rule: RouteRule): Promise<RouteRule> {
    if (!this.config) throw new Error('Config not loaded');
    this.normalizeRoutingConfig(this.config);
    const rules = this.config.routing!.rules;
    const idx = rules.findIndex(r => r.id === rule.id);
    if (idx >= 0) {
      rules[idx] = { ...rule, updatedAt: Date.now() };
    } else {
      rules.push({ ...rule, createdAt: Date.now(), updatedAt: Date.now() });
    }
    await this.saveConfig();
    return idx >= 0 ? rules[idx] : rules[rules.length - 1];
  }

  /**
   * 删除路由规则
   */
  async deleteRouteRule(ruleId: string): Promise<boolean> {
    if (!this.config) throw new Error('Config not loaded');
    this.normalizeRoutingConfig(this.config);
    const before = this.config.routing!.rules.length;
    this.config.routing!.rules = this.config.routing!.rules.filter(r => r.id !== ruleId);
    if (this.config.routing!.rules.length < before) {
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * 记录通道成功率统计
   */
  async recordRouteStats(
    key: RouteChannelKey,
    outcome: RouteOutcome,
    meta?: { statusCode?: number; latencyMs?: number }
  ): Promise<void> {
    if (!this.config) throw new Error('Config not loaded');
    this.normalizeRoutingConfig(this.config);
    const statsKey = buildStatsKey(key);
    const existing: RouteChannelStats = this.config.routing!.stats[statsKey] || {
      ...key,
      successCount: 0,
      failureCount: 0,
      neutralCount: 0,
      consecutiveFailures: 0,
    };
    const now = Date.now();
    if (outcome === 'success') {
      existing.successCount++;
      existing.consecutiveFailures = 0;
      existing.lastSuccessAt = now;
    } else if (outcome === 'failure') {
      existing.failureCount++;
      existing.consecutiveFailures++;
      existing.lastFailureAt = now;
    } else {
      existing.neutralCount++;
    }
    existing.lastUsedAt = now;
    if (meta?.statusCode !== undefined) existing.lastStatusCode = meta.statusCode;
    if (meta?.latencyMs !== undefined) existing.lastLatencyMs = meta.latencyMs;
    this.config.routing!.stats[statsKey] = existing;
    await this.saveConfig();
  }

  /**
   * 更新通道健康状态
   */
  async updateRouteHealth(healthList: RouteChannelHealth[]): Promise<void> {
    if (!this.config) throw new Error('Config not loaded');
    this.normalizeRoutingConfig(this.config);
    for (const h of healthList) {
      this.config.routing!.health[buildStatsKey(h)] = h;
    }
    await this.saveConfig();
  }

  /**
   * 重置统计数据
   */
  async resetRouteStats(ruleId?: string): Promise<void> {
    if (!this.config) throw new Error('Config not loaded');
    this.normalizeRoutingConfig(this.config);
    if (ruleId) {
      for (const k of Object.keys(this.config.routing!.stats)) {
        if (k.startsWith(`${ruleId}:`)) {
          delete this.config.routing!.stats[k];
        }
      }
    } else {
      this.config.routing!.stats = {};
    }
    await this.saveConfig();
  }

  // ============= CLI 模型选择 =============

  async updateRouteCliModelSelections(
    selections: Partial<Record<RouteCliType, string | null>>
  ): Promise<Record<RouteCliType, string | null>> {
    if (!this.config) throw new Error('Config not loaded');
    this.normalizeRoutingConfig(this.config);
    this.config.routing!.cliModelSelections = {
      ...this.config.routing!.cliModelSelections,
      ...selections,
    };
    await this.saveConfig();
    return this.config.routing!.cliModelSelections;
  }

  // ============= 模型注册表 =============

  async updateRouteModelRegistry(registry: RouteModelRegistryConfig): Promise<void> {
    if (!this.config) throw new Error('Config not loaded');
    this.normalizeRoutingConfig(this.config);
    this.config.routing!.modelRegistry = registry;
    await this.saveConfig();
  }

  async upsertRouteModelMappingOverride(
    override: RouteModelMappingOverride
  ): Promise<RouteModelMappingOverride> {
    if (!this.config) throw new Error('Config not loaded');
    this.normalizeRoutingConfig(this.config);
    const overrides = this.config.routing!.modelRegistry.overrides;
    const idx = overrides.findIndex(o => o.id === override.id);
    if (idx >= 0) {
      overrides[idx] = { ...override, updatedAt: Date.now() };
    } else {
      overrides.push({ ...override, createdAt: Date.now(), updatedAt: Date.now() });
    }
    await this.saveConfig();
    return idx >= 0 ? overrides[idx] : overrides[overrides.length - 1];
  }

  async deleteRouteModelMappingOverride(overrideId: string): Promise<boolean> {
    if (!this.config) throw new Error('Config not loaded');
    this.normalizeRoutingConfig(this.config);
    const overrides = this.config.routing!.modelRegistry.overrides;
    const before = overrides.length;
    this.config.routing!.modelRegistry.overrides = overrides.filter(o => o.id !== overrideId);
    if (this.config.routing!.modelRegistry.overrides.length < before) {
      await this.saveConfig();
      return true;
    }
    return false;
  }

  // ============= CLI 探测 =============

  async updateRouteCliProbeConfig(
    updates: Partial<RouteCliProbeConfig>
  ): Promise<RouteCliProbeConfig> {
    if (!this.config) throw new Error('Config not loaded');
    this.normalizeRoutingConfig(this.config);
    this.config.routing!.cliProbe.config = {
      ...this.config.routing!.cliProbe.config,
      ...updates,
    };
    await this.saveConfig();
    return this.config.routing!.cliProbe.config;
  }

  async appendRouteCliProbeSamples(samples: RouteCliProbeSample[]): Promise<void> {
    if (!this.config || samples.length === 0) return;
    this.normalizeRoutingConfig(this.config);
    const history = this.config.routing!.cliProbe.history;
    for (const s of samples) {
      if (!history[s.probeKey]) history[s.probeKey] = [];
      history[s.probeKey].push(s);
    }
    await this.saveConfig();
  }

  async upsertRouteCliProbeLatest(latestList: RouteCliProbeLatest[]): Promise<void> {
    if (!this.config || latestList.length === 0) return;
    this.normalizeRoutingConfig(this.config);
    for (const l of latestList) {
      this.config.routing!.cliProbe.latest[l.probeKey] = l;
    }
    await this.saveConfig();
  }

  async pruneRouteCliProbeHistory(retentionDays?: number, now?: number): Promise<number> {
    if (!this.config) return 0;
    this.normalizeRoutingConfig(this.config);
    const days = retentionDays ?? this.config.routing!.cliProbe.config.retentionDays;
    const cutoff = (now ?? Date.now()) - days * 24 * 60 * 60 * 1000;
    const history = this.config.routing!.cliProbe.history;
    let pruned = 0;
    for (const key of Object.keys(history)) {
      const before = history[key].length;
      history[key] = history[key].filter(s => s.testedAt >= cutoff);
      pruned += before - history[key].length;
      if (history[key].length === 0) delete history[key];
    }
    if (pruned > 0) await this.saveConfig();
    return pruned;
  }

  // ============= 分析统计 =============

  async updateRouteAnalyticsConfig(
    updates: Partial<RouteAnalyticsConfig>
  ): Promise<RouteAnalyticsConfig> {
    if (!this.config) throw new Error('Config not loaded');
    this.normalizeRoutingConfig(this.config);
    this.config.routing!.analytics.config = {
      ...this.config.routing!.analytics.config,
      ...updates,
    };
    await this.saveConfig();
    return this.config.routing!.analytics.config;
  }

  async upsertRouteAnalyticsBuckets(buckets: RouteAnalyticsBucket[]): Promise<void> {
    if (!this.config || buckets.length === 0) return;
    this.normalizeRoutingConfig(this.config);
    for (const b of buckets) {
      this.config.routing!.analytics.buckets[b.bucketKey] = b;
    }
    await this.saveConfig();
  }

  async resetRouteAnalytics(params?: {
    cliType?: RouteCliType;
    routeRuleId?: string;
  }): Promise<void> {
    if (!this.config) throw new Error('Config not loaded');
    this.normalizeRoutingConfig(this.config);
    if (!params?.cliType && !params?.routeRuleId) {
      this.config.routing!.analytics.buckets = {};
    } else {
      const buckets = this.config.routing!.analytics.buckets;
      for (const key of Object.keys(buckets)) {
        const b = buckets[key];
        if (params?.cliType && b.cliType !== params.cliType) continue;
        if (params?.routeRuleId && b.routeRuleId !== params.routeRuleId) continue;
        delete buckets[key];
      }
    }
    await this.saveConfig();
  }

  async pruneRouteAnalyticsBuckets(retentionDays?: number, now?: number): Promise<number> {
    if (!this.config) return 0;
    this.normalizeRoutingConfig(this.config);
    const days = retentionDays ?? this.config.routing!.analytics.config.retentionDays;
    const cutoff = (now ?? Date.now()) - days * 24 * 60 * 60 * 1000;
    const buckets = this.config.routing!.analytics.buckets;
    let pruned = 0;
    for (const key of Object.keys(buckets)) {
      if (buckets[key].bucketStart < cutoff) {
        delete buckets[key];
        pruned++;
      }
    }
    if (pruned > 0) await this.saveConfig();
    return pruned;
  }

  /**
   * 同步获取当前内存中的完整配置（不触发 IO）
   */
  exportConfigSync() {
    return this.config;
  }
}

// 导出单例
export const unifiedConfigManager = new UnifiedConfigManager();
