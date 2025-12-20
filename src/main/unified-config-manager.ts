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
} from '../shared/types/site';
import { generateSiteId } from '../shared/types/site';

const CONFIG_VERSION = '2.0';

const DEFAULT_SETTINGS: Settings = {
  timeout: 30,
  concurrent: true,
  max_concurrent: 3,
  show_disabled: false,
  browser_path: '',
};

const DEFAULT_GROUP: SiteGroup = { id: 'default', name: '默认分组' };

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
      this.config = JSON.parse(data);
      this.config = this.normalizeConfig(this.config!);
      Logger.info(`✅ [UnifiedConfigManager] 加载配置成功，${this.config.sites.length} 个站点`);
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

    // 确保有分组
    if (!Array.isArray(config.siteGroups) || config.siteGroups.length === 0) {
      config.siteGroups = [DEFAULT_GROUP];
    } else if (!config.siteGroups.some(g => g.id === 'default')) {
      config.siteGroups.unshift(DEFAULT_GROUP);
    }

    // 确保设置完整并规范范围
    config.settings = { ...DEFAULT_SETTINGS, ...config.settings };
    const maxConcurrent = config.settings.max_concurrent ?? DEFAULT_SETTINGS.max_concurrent!;
    config.settings.max_concurrent = Math.min(5, Math.max(1, maxConcurrent));

    const timeoutSeconds = config.settings.timeout ?? DEFAULT_SETTINGS.timeout!;
    config.settings.timeout = Math.max(5, timeoutSeconds);

    return config;
  }

  /**
   * 创建默认配置
   */
  private createDefaultConfig(): UnifiedConfig {
    return {
      version: CONFIG_VERSION,
      sites: [],
      siteGroups: [DEFAULT_GROUP],
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
   * 删除站点
   */
  async deleteSite(id: string): Promise<boolean> {
    if (!this.config) return false;

    const initialLength = this.config.sites.length;
    this.config.sites = this.config.sites.filter(s => s.id !== id);

    if (this.config.sites.length < initialLength) {
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

  // ============= 兼容层（供前端使用） =============

  /**
   * 获取兼容旧格式的配置（供前端使用）
   * 包含 cached_data 和 cli_config 以支持缓存数据显示和 CLI 配置
   */
  getLegacyConfig(): {
    sites: (SiteConfig & {
      cached_data?: UnifiedSite['cached_data'];
      cli_config?: UnifiedSite['cli_config'];
      cli_compatibility?: any; // 兼容旧版本数据结构
    })[];
    settings: Settings;
    siteGroups: SiteGroup[];
  } {
    if (!this.config) {
      return { sites: [], settings: DEFAULT_SETTINGS, siteGroups: [DEFAULT_GROUP] };
    }

    // 转换为旧格式，保留 cached_data 和 cli_config
    const sites = this.config.sites.map(site => ({
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

    // 更新设置和分组，保留现有的 webdav 配置（如果前端没有传递）
    const existingWebdav = this.config!.settings?.webdav;
    this.config!.settings = {
      ...legacyConfig.settings,
      // 如果前端传递了 webdav 配置则使用，否则保留现有配置
      webdav: legacyConfig.settings.webdav || existingWebdav,
    };
    if (legacyConfig.siteGroups) {
      this.config!.siteGroups = legacyConfig.siteGroups;
    }

    // 合并站点更新（保留 ID 和认证信息）
    const newSites: UnifiedSite[] = legacyConfig.sites.map(oldSite => {
      // 查找现有站点（按 URL 匹配）
      const existing = this.config!.sites.find(s => this.urlMatches(s.url, oldSite.url));

      if (existing) {
        // 更新现有站点，保留 ID 和未在旧格式中的字段
        return {
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
      } else {
        // 新站点
        return {
          id: generateSiteId(),
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
