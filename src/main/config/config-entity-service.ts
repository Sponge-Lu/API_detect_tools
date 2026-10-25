import Logger from '../utils/logger';
import { getApplicationStorage } from '../storage/application-storage';

import { notifyAppDataChanged } from '../app-data-events';
import { runtimeCacheManager } from '../runtime-cache-manager';

import { routeStateAffinityService } from '../route-state-affinity-service';

import type {
  UnifiedConfig,
  UnifiedSite,
  SiteGroup,
  Settings,
  SiteConfig,
  AccountCredential,
  DetectionCacheData,
} from '../../shared/types/site';
import {
  generateSiteId,
  generateAccountId,
  splitDetectionCacheData,
} from '../../shared/types/site';
import type { RouteCliType } from '../../shared/types/route-proxy';

import {
  normalizeCliUpstreamProtocolsWithDefault,
  type CliTargetProtocol,
} from '../../shared/types/cli-config';

import { DEFAULT_SETTINGS, DEFAULT_GROUP } from './defaults';
import { migrateLegacyRouteTargetProtocol } from './legacy-route-protocol';

export interface ConfigEntityContext {
  current(): UnifiedConfig | null;
  load(): Promise<UnifiedConfig>;
  save(): Promise<void>;
  mutate<T>(operation: () => Promise<T>): Promise<T>;
  notify(debounceMs?: number): void;
  afterCommit(operation: () => Promise<unknown>): Promise<void>;
}
export class ConfigEntityService {
  constructor(private readonly context: ConfigEntityContext) {}
  private get config(): UnifiedConfig | null {
    return this.context.current();
  }
  private loadConfig(): Promise<UnifiedConfig> {
    return this.context.load();
  }
  private saveConfig(): Promise<void> {
    return this.context.save();
  }
  private mutateConfig<T>(operation: () => Promise<T>): Promise<T> {
    return this.context.mutate(operation);
  }
  private notifySiteConfigChanged(debounceMs?: number): void {
    this.context.notify(debounceMs);
  }
  private afterStableCommit(operation: () => Promise<unknown>): Promise<void> {
    return this.context.afterCommit(operation);
  }
  getSites(): UnifiedSite[] {
    return this.config?.sites || [];
  }

  getSiteById(id: string): UnifiedSite | null {
    return this.config?.sites.find(s => s.id === id) || null;
  }

  getSiteByUrl(url: string): UnifiedSite | null {
    try {
      const target = new URL(url);
      const targetPath = target.pathname.replace(/\/+$/, '');
      return (
        this.config?.sites.find(s => {
          try {
            const candidate = new URL(s.url);
            return (
              candidate.origin === target.origin &&
              candidate.pathname.replace(/\/+$/, '') === targetPath
            );
          } catch {
            return false;
          }
        }) || null
      );
    } catch {
      return null;
    }
  }

  async addSite(site: Omit<UnifiedSite, 'id'> & { id?: string }): Promise<UnifiedSite> {
    return this.mutateConfig(async () => {
      if (!this.config) await this.loadConfig();

      const newSite: UnifiedSite = {
        ...site,
        id: site.id || generateSiteId(),
        site_type: site.site_type,
        group: site.group || 'default',
        enabled: site.enabled !== false,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      this.config!.sites.push(newSite);
      try {
        await this.saveConfig();
      } catch (error) {
        this.config!.sites = this.config!.sites.filter(item => item !== newSite);
        throw error;
      }
      this.notifySiteConfigChanged();
      return newSite;
    });
  }

  async updateSite(id: string, updates: Partial<UnifiedSite>): Promise<boolean> {
    return this.mutateConfig(async () => {
      if (!this.config) return false;

      const index = this.config.sites.findIndex(s => s.id === id);
      if (index === -1) return false;

      const previous = this.config.sites[index];
      const next = {
        ...this.config.sites[index],
        ...updates,
        id, // 确保 ID 不变
        updated_at: Date.now(),
      };
      this.config.sites[index] = next;
      try {
        await this.saveConfig();
      } catch (error) {
        const currentIndex = this.config.sites.indexOf(next);
        if (currentIndex !== -1) this.config.sites[currentIndex] = previous;
        throw error;
      }
      this.notifySiteConfigChanged();
      return true;
    });
  }

  async deleteSite(id: string): Promise<boolean> {
    return this.mutateConfig(async () => {
      if (!this.config) return false;

      const previousSites = this.config.sites;
      const previousAccounts = this.config.accounts;
      const initialLength = previousSites.length;
      this.config.sites = this.config.sites.filter(s => s.id !== id);

      if (this.config.sites.length < initialLength) {
        // 删除关联的所有账户
        this.config.accounts = this.config.accounts.filter(a => a.site_id !== id);
        const nextSites = this.config.sites;
        const nextAccounts = this.config.accounts;
        try {
          await this.saveConfig();
        } catch (error) {
          if (this.config.sites === nextSites) this.config.sites = previousSites;
          if (this.config.accounts === nextAccounts) this.config.accounts = previousAccounts;
          throw error;
        }
        try {
          await this.afterStableCommit(() => routeStateAffinityService.removeBySite(id));
        } catch (error) {
          Logger.warn('Site removed; affinity cleanup failed:', error);
        }
        this.notifySiteConfigChanged();
        return true;
      }
      return false;
    });
  }

  async updateSiteToken(id: string, accessToken: string): Promise<boolean> {
    return this.updateSite(id, { access_token: accessToken });
  }

  private urlMatches(url1: string, url2: string): boolean {
    try {
      const first = new URL(url1);
      const second = new URL(url2);
      return (
        first.origin === second.origin &&
        first.pathname.replace(/\/+$/, '') === second.pathname.replace(/\/+$/, '')
      );
    } catch {
      return false;
    }
  }

  getAccountById(accountId: string): AccountCredential | undefined {
    return this.config?.accounts.find(a => a.id === accountId);
  }

  getAccountsBySiteId(siteId: string): AccountCredential[] {
    return this.config?.accounts.filter(a => a.site_id === siteId) || [];
  }

  async addAccount(
    account: Omit<AccountCredential, 'id' | 'created_at' | 'updated_at'> & { id?: string }
  ): Promise<AccountCredential> {
    return this.mutateConfig(async () => {
      if (!this.config) await this.loadConfig();

      const now = Date.now();
      const site = this.config!.sites.find(s => s.id === account.site_id);
      if (!site) throw new Error(`Site not found: ${account.site_id}`);
      let addedLegacyAccount: AccountCredential | undefined;
      const accountInput = { ...account } as typeof account & { status?: unknown };
      delete accountInput.status;
      migrateLegacyRouteTargetProtocol(
        accountInput,
        accountInput.cli_config as Partial<
          Record<RouteCliType, { targetProtocol?: CliTargetProtocol | null } | null>
        >
      );
      accountInput.routeTargetProtocolNeedsConfirmation = Boolean(
        accountInput.routeTargetProtocolNeedsConfirmation
      );
      accountInput.supportedProtocols = normalizeCliUpstreamProtocolsWithDefault(
        accountInput.supportedProtocols
      );
      if (
        accountInput.routeAuthScheme !== 'bearer' &&
        accountInput.routeAuthScheme !== 'x-api-key'
      ) {
        delete accountInput.routeAuthScheme;
      }

      // 站点有 legacy 凭证但无账户记录 → 先补建默认账户，防止原凭证被覆盖丢失
      if (site) {
        const existingAccounts = this.config!.accounts.filter(
          a => a.site_id === accountInput.site_id
        );
        if (existingAccounts.length === 0 && (site.access_token || site.user_id)) {
          const defaultAccount: AccountCredential = {
            id: generateAccountId(),
            site_id: accountInput.site_id,
            account_name: '默认账户',
            user_id: site.user_id || '',
            access_token: site.access_token || '',
            api_key: site.api_key,
            auth_source: 'manual',
            routeTargetProtocol: 'native',
            routeTargetProtocolNeedsConfirmation: false,
            supportedProtocols: normalizeCliUpstreamProtocolsWithDefault(undefined),
            cached_data: site.cached_data ? { ...site.cached_data } : undefined,
            created_at: now,
            updated_at: now,
          };
          this.config!.accounts.push(defaultAccount);
          addedLegacyAccount = defaultAccount;
          Logger.info(
            `🔄 [UnifiedConfigManager] 自动补建默认账户: ${defaultAccount.id} (site=${accountInput.site_id})`
          );
        }
      }

      const siteAccounts = this.config!.accounts.filter(
        existing => existing.site_id === accountInput.site_id
      );
      const reusablePlaceholderId =
        siteAccounts.length === 1 &&
        !siteAccounts[0].user_id &&
        !siteAccounts[0].access_token &&
        !siteAccounts[0].api_key &&
        (accountInput.user_id || accountInput.access_token)
          ? siteAccounts[0].id
          : undefined;

      // 同一站点 + 同一用户只保留一个账户记录；首次补充凭证时复用唯一的空凭证账户。
      const duplicateIndex = this.config!.accounts.findIndex(
        existing =>
          existing.id === reusablePlaceholderId ||
          (Boolean(accountInput.user_id) &&
            existing.site_id === accountInput.site_id &&
            existing.user_id === accountInput.user_id)
      );
      if (duplicateIndex >= 0) {
        const mergedAccount: AccountCredential = {
          ...this.config!.accounts[duplicateIndex],
          ...accountInput,
          id: this.config!.accounts[duplicateIndex].id,
          created_at: this.config!.accounts[duplicateIndex].created_at,
          updated_at: now,
        };
        const previous = this.config!.accounts[duplicateIndex];
        this.config!.accounts[duplicateIndex] = mergedAccount;
        try {
          await this.saveConfig();
        } catch (error) {
          const currentIndex = this.config!.accounts.indexOf(mergedAccount);
          if (currentIndex !== -1) this.config!.accounts[currentIndex] = previous;
          if (addedLegacyAccount)
            this.config!.accounts = this.config!.accounts.filter(
              item => item !== addedLegacyAccount
            );
          throw error;
        }
        this.notifySiteConfigChanged();
        Logger.info(
          `🔁 [UnifiedConfigManager] 复用已有账户记录: ${mergedAccount.id} (site=${accountInput.site_id}, user=${accountInput.user_id})`
        );
        return mergedAccount;
      }

      const newAccount: AccountCredential = {
        ...accountInput,
        id: accountInput.id || generateAccountId(),
        created_at: now,
        updated_at: now,
      };

      this.config!.accounts.push(newAccount);

      try {
        await this.saveConfig();
      } catch (error) {
        this.config!.accounts = this.config!.accounts.filter(
          item => item !== newAccount && item !== addedLegacyAccount
        );
        throw error;
      }
      this.notifySiteConfigChanged();
      return newAccount;
    });
  }

  async updateAccount(
    accountId: string,
    updates: Partial<
      Pick<
        AccountCredential,
        | 'account_name'
        | 'username'
        | 'access_token'
        | 'api_key'
        | 'user_id'
        | 'auto_refresh'
        | 'auto_refresh_interval'
        | 'routeTargetProtocol'
        | 'routeTargetProtocolNeedsConfirmation'
        | 'routeAuthScheme'
        | 'supportedProtocols'
        | 'cli_config'
        | 'anyRouterConfig'
        | 'auth_source'
        | 'browser_profile_path'
        | 'automation_slot'
        | 'local_api_keys'
      >
    >
  ): Promise<boolean> {
    return this.mutateConfig(async () => {
      if (!this.config) return false;

      const index = this.config.accounts.findIndex(a => a.id === accountId);
      if (index === -1) return false;
      const normalizedUpdates = { ...updates } as typeof updates & { status?: unknown };
      delete normalizedUpdates.status;

      const previous = this.config.accounts[index];
      const next = {
        ...this.config.accounts[index],
        ...normalizedUpdates,
        updated_at: Date.now(),
      };
      this.config.accounts[index] = next;
      try {
        await this.saveConfig();
      } catch (error) {
        const currentIndex = this.config.accounts.indexOf(next);
        if (currentIndex !== -1) this.config.accounts[currentIndex] = previous;
        throw error;
      }
      this.notifySiteConfigChanged();
      return true;
    });
  }

  async updateAccountCachedData(
    accountId: string,
    updater: (current?: DetectionCacheData) => DetectionCacheData
  ): Promise<boolean> {
    if (getApplicationStorage()) {
      getApplicationStorage()!.assertWritable();
      if (!this.config) await this.loadConfig();
      const account = this.config?.accounts.find(item => item.id === accountId);
      if (!account) return false;
      const next = updater(structuredClone(account.cached_data));
      const { shared, runtime } = splitDetectionCacheData(next);
      if (shared)
        await runtimeCacheManager.updateSiteShared(account.site_id, current => ({
          ...current,
          ...shared,
        }));
      if (runtime) await runtimeCacheManager.updateAccountRuntime(accountId, () => runtime);
      getApplicationStorage()!.assertWritable();
      const current = this.config?.accounts.find(item => item.id === accountId);
      if (current) current.cached_data = next;
      notifyAppDataChanged('site-overview', 120);
      return true;
    }
    return this.mutateConfig(async () => {
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
      this.notifySiteConfigChanged();
      return true;
    });
  }

  async deleteAccount(accountId: string): Promise<boolean> {
    return this.mutateConfig(async () => {
      if (!this.config) return false;

      const account = this.config.accounts.find(a => a.id === accountId);
      if (!account) return false;

      const previousSites = this.config.sites;
      const previousAccounts = this.config.accounts;
      this.config.accounts = this.config.accounts.filter(a => a.id !== accountId);

      const remainingAccounts = this.config.accounts.filter(a => a.site_id === account.site_id);
      if (remainingAccounts.length === 0) {
        this.config.sites = this.config.sites.filter(site => site.id !== account.site_id);
      }

      const nextSites = this.config.sites;
      const nextAccounts = this.config.accounts;
      try {
        await this.saveConfig();
      } catch (error) {
        if (this.config.sites === nextSites) this.config.sites = previousSites;
        if (this.config.accounts === nextAccounts) this.config.accounts = previousAccounts;
        throw error;
      }
      try {
        await this.afterStableCommit(() => routeStateAffinityService.removeByAccount(accountId));
      } catch (error) {
        Logger.warn('Account removed; affinity cleanup failed:', error);
      }
      this.notifySiteConfigChanged();
      return true;
    });
  }

  getLegacyConfig(): {
    sites: (SiteConfig & {
      cached_data?: UnifiedSite['cached_data'];
      cli_config?: UnifiedSite['cli_config'];
    })[];
    accounts: AccountCredential[];
    settings: Settings;
    siteGroups: SiteGroup[];
  } {
    if (!this.config) {
      return { sites: [], accounts: [], settings: DEFAULT_SETTINGS, siteGroups: [DEFAULT_GROUP] };
    }

    // 转换为旧格式，保留 cached_data 和 cli_config
    // v3.0.6: api_key/access_token/user_id 已移至账户级，这里返回空字符串以兼容旧接口
    const sites = this.config.sites.map(site => ({
      id: site.id, // 站点 ID（多账户操作需要）
      name: site.name,
      url: site.url,
      site_type: site.site_type,
      api_key: '', // v3.0.6: 已迁移到账户级
      system_token: undefined, // v3.0.6: 已迁移到账户级
      user_id: undefined, // v3.0.6: 已迁移到账户级
      enabled: site.enabled,
      group: site.group,
      has_checkin: site.has_checkin,
      force_enable_checkin: site.force_enable_checkin,
      extra_links: site.extra_links,
      proxy_url: site.proxy_url,
      auto_refresh: site.auto_refresh, // 站点独立的自动刷新开关
      auto_refresh_interval: site.auto_refresh_interval, // 自动刷新间隔
      cached_data: undefined, // v3.0.6: 运行时缓存不再保存在配置中
    }));

    return {
      sites,
      accounts: this.config.accounts.map(a => ({ ...a })),
      settings: this.config.settings,
      siteGroups: this.config.siteGroups,
    };
  }

  async saveLegacyConfig(legacyConfig: {
    sites: SiteConfig[];
    settings: Settings;
    siteGroups?: SiteGroup[];
  }): Promise<void> {
    return this.mutateConfig(async () => {
      if (!this.config) await this.loadConfig();

      // 更新设置和分组，保留现有的 webdav 和 browser_profile 配置（如果前端没有传递）
      const previous = {
        settings: this.config!.settings,
        siteGroups: this.config!.siteGroups,
        sites: this.config!.sites,
        accounts: this.config!.accounts,
      };
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
            site_type: oldSite.site_type ?? existing.site_type,
            api_key: oldSite.api_key,
            access_token: oldSite.system_token || existing.access_token,
            user_id: oldSite.user_id || existing.user_id,
            enabled: oldSite.enabled,
            group: oldSite.group || existing.group,
            has_checkin: oldSite.has_checkin,
            force_enable_checkin: oldSite.force_enable_checkin,
            extra_links: oldSite.extra_links,
            proxy_url: oldSite.proxy_url,
            auto_refresh: oldSite.auto_refresh,
            auto_refresh_interval: oldSite.auto_refresh_interval,
            cached_data: (oldSite as any).cached_data || existing.cached_data,
            updated_at: Date.now(),
          };

          return updated;
        } else {
          // 新站点
          return {
            id: oldSite.id || generateSiteId(),
            name: oldSite.name,
            url: oldSite.url,
            site_type: oldSite.site_type,
            api_key: oldSite.api_key,
            access_token: oldSite.system_token,
            user_id: oldSite.user_id,
            enabled: oldSite.enabled,
            group: oldSite.group || 'default',
            has_checkin: oldSite.has_checkin,
            force_enable_checkin: oldSite.force_enable_checkin,
            extra_links: oldSite.extra_links,
            proxy_url: oldSite.proxy_url,
            auto_refresh: oldSite.auto_refresh,
            auto_refresh_interval: oldSite.auto_refresh_interval,
            cached_data: (oldSite as any).cached_data,
            created_at: Date.now(),
            updated_at: Date.now(),
          };
        }
      });

      const activeSiteIds = new Set(newSites.map(site => site.id));
      this.config!.accounts = this.config!.accounts.filter(account =>
        activeSiteIds.has(account.site_id)
      );

      this.config!.sites = newSites;
      const next = {
        settings: this.config!.settings,
        siteGroups: this.config!.siteGroups,
        sites: this.config!.sites,
        accounts: this.config!.accounts,
      };
      try {
        await this.saveConfig();
      } catch (error) {
        if (this.config!.settings === next.settings) this.config!.settings = previous.settings;
        if (this.config!.siteGroups === next.siteGroups)
          this.config!.siteGroups = previous.siteGroups;
        if (this.config!.sites === next.sites) this.config!.sites = previous.sites;
        if (this.config!.accounts === next.accounts) this.config!.accounts = previous.accounts;
        throw error;
      }
      this.notifySiteConfigChanged();
    });
  }
}
