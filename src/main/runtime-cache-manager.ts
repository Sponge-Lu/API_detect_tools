import Logger from './utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import type {
  AccountRuntimeDetectionData,
  RuntimeCacheFile,
  SiteRuntimeDetectionData,
  SiteSharedDetectionData,
} from '../shared/types/site';
import { DEFAULT_RUNTIME_CACHE_FILE } from '../shared/types/site';

function cloneDefaultRuntimeCache(): RuntimeCacheFile {
  return {
    ...DEFAULT_RUNTIME_CACHE_FILE,
    site_shared_by_site_id: {},
    site_runtime_by_site_id: {},
    account_runtime_by_account_id: {},
    last_updated: 0,
  };
}

export class RuntimeCacheManager {
  private cachePath: string;
  private cache: RuntimeCacheFile | null = null;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.cachePath = path.join(userDataPath, 'runtime-cache.json');
  }

  getCachePath(): string {
    return this.cachePath;
  }

  async loadCache(): Promise<RuntimeCacheFile> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const raw = await fs.readFile(this.cachePath, 'utf-8');
      this.cache = this.normalizeCache(JSON.parse(raw));
      return this.cache;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        Logger.warn(`⚠️ [RuntimeCacheManager] 读取运行期缓存失败，改用空缓存: ${error.message}`);
      }
      this.cache = cloneDefaultRuntimeCache();
      return this.cache;
    }
  }

  exportCacheSync(): RuntimeCacheFile | null {
    return this.cache;
  }

  setCache(cache?: RuntimeCacheFile): RuntimeCacheFile {
    this.cache = this.normalizeCache(cache);
    return this.cache;
  }

  async saveCache(cache?: RuntimeCacheFile): Promise<void> {
    if (cache) {
      this.cache = this.normalizeCache(cache);
    }
    if (!this.cache) {
      this.cache = cloneDefaultRuntimeCache();
    }

    this.cache.last_updated = Date.now();
    await this.writeAtomically(this.cachePath, JSON.stringify(this.cache, null, 2));
  }

  getSiteShared(siteId: string): SiteSharedDetectionData | undefined {
    return this.cache?.site_shared_by_site_id?.[siteId];
  }

  getSiteRuntime(siteId: string): SiteRuntimeDetectionData | undefined {
    return this.cache?.site_runtime_by_site_id?.[siteId];
  }

  getAccountRuntime(accountId: string): AccountRuntimeDetectionData | undefined {
    return this.cache?.account_runtime_by_account_id?.[accountId];
  }

  async updateSiteShared(
    siteId: string,
    updater: (current?: SiteSharedDetectionData) => SiteSharedDetectionData | undefined
  ): Promise<void> {
    const cache = await this.loadCache();
    const next = updater(cache.site_shared_by_site_id[siteId]);
    if (next) {
      cache.site_shared_by_site_id[siteId] = next;
    } else {
      delete cache.site_shared_by_site_id[siteId];
    }
    await this.saveCache(cache);
  }

  async updateSiteRuntime(
    siteId: string,
    updater: (current?: SiteRuntimeDetectionData) => SiteRuntimeDetectionData | undefined
  ): Promise<void> {
    const cache = await this.loadCache();
    const next = updater(cache.site_runtime_by_site_id[siteId]);
    if (next) {
      cache.site_runtime_by_site_id[siteId] = next;
    } else {
      delete cache.site_runtime_by_site_id[siteId];
    }
    await this.saveCache(cache);
  }

  async updateAccountRuntime(
    accountId: string,
    updater: (current?: AccountRuntimeDetectionData) => AccountRuntimeDetectionData | undefined
  ): Promise<void> {
    const cache = await this.loadCache();
    const next = updater(cache.account_runtime_by_account_id[accountId]);
    if (next) {
      cache.account_runtime_by_account_id[accountId] = next;
    } else {
      delete cache.account_runtime_by_account_id[accountId];
    }
    await this.saveCache(cache);
  }

  async deleteSite(siteId: string): Promise<void> {
    const cache = await this.loadCache();
    delete cache.site_shared_by_site_id[siteId];
    delete cache.site_runtime_by_site_id[siteId];
    await this.saveCache(cache);
  }

  async deleteAccount(accountId: string): Promise<void> {
    const cache = await this.loadCache();
    delete cache.account_runtime_by_account_id[accountId];
    await this.saveCache(cache);
  }

  private normalizeCache(cache: Partial<RuntimeCacheFile> | undefined | null): RuntimeCacheFile {
    return {
      version: cache?.version || DEFAULT_RUNTIME_CACHE_FILE.version,
      site_shared_by_site_id: cache?.site_shared_by_site_id || {},
      site_runtime_by_site_id: cache?.site_runtime_by_site_id || {},
      account_runtime_by_account_id: cache?.account_runtime_by_account_id || {},
      last_updated: cache?.last_updated || 0,
    };
  }

  private async writeAtomically(targetPath: string, content: string): Promise<void> {
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
        // ignore cleanup failure
      }
      throw error;
    }
  }
}

export const runtimeCacheManager = new RuntimeCacheManager();
