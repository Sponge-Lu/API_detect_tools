/**
 * 输入: Axios (HTTP 请求), Electron app (应用信息), GitHub API
 * 输出: UpdateInfo (更新信息), 更新检查结果
 * 定位: 服务层 - 从 GitHub Releases 检查应用更新
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * 软件更新服务
 * 负责检查 GitHub Releases 获取最新版本信息
 */

import Logger from './utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app, shell } from 'electron';
import axios from 'axios';

// GitHub 仓库信息
const GITHUB_OWNER = 'Sponge-Lu';
const GITHUB_REPO = 'API_detect_tools';
// 使用 releases 列表 API 以支持 pre-release 版本检测
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

export interface ReleaseInfo {
  version: string;
  releaseDate: string;
  releaseNotes: string;
  downloadUrl: string;
  htmlUrl: string;
  isPreRelease: boolean;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  hasPreReleaseUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  latestPreReleaseVersion?: string;
  releaseInfo?: ReleaseInfo;
  preReleaseInfo?: ReleaseInfo;
}

export interface UpdateSettings {
  autoCheckEnabled: boolean;
  includePreRelease: boolean;
  lastCheckTime?: string;
}

const DEFAULT_SETTINGS: UpdateSettings = {
  autoCheckEnabled: true,
  includePreRelease: false,
};

export class UpdateService {
  private settingsPath: string;
  private settings: UpdateSettings | null = null;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.settingsPath = path.join(userDataPath, 'update-settings.json');
    Logger.info(`📁 [UpdateService] 设置文件路径: ${this.settingsPath}`);
  }

  /**
   * 获取当前应用版本
   */
  getCurrentVersion(): string {
    return app.getVersion();
  }

  /**
   * 比较两个语义化版本号
   * @returns 负数表示 current < latest，0 表示相等，正数表示 current > latest
   */
  compareVersions(current: string, latest: string): number {
    const parseVersion = (v: string): number[] => {
      const match = v.match(/^v?(\d+)\.(\d+)\.(\d+)/);
      if (!match) {
        throw new Error(`Invalid version format: ${v}`);
      }
      return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
    };

    const [currentMajor, currentMinor, currentPatch] = parseVersion(current);
    const [latestMajor, latestMinor, latestPatch] = parseVersion(latest);

    if (currentMajor !== latestMajor) {
      return currentMajor - latestMajor;
    }
    if (currentMinor !== latestMinor) {
      return currentMinor - latestMinor;
    }
    return currentPatch - latestPatch;
  }

  /**
   * 验证版本号格式是否符合语义化版本规范
   */
  isValidVersion(version: string): boolean {
    return /^v?(\d+)\.(\d+)\.(\d+)$/.test(version);
  }

  /**
   * 从 release 对象提取下载链接
   */
  private getDownloadUrl(release: any): string {
    let downloadUrl = release.html_url;
    if (release.assets && release.assets.length > 0) {
      const windowsAsset = release.assets.find(
        (asset: any) => asset.name.endsWith('.exe') && asset.name.includes('Setup')
      );
      if (windowsAsset) {
        downloadUrl = windowsAsset.browser_download_url;
      }
    }
    return downloadUrl;
  }

  /**
   * 从 release 对象构建 ReleaseInfo
   */
  private buildReleaseInfo(release: any): ReleaseInfo {
    const version = (release.tag_name as string).replace(/^v/, '');
    return {
      version,
      releaseDate: release.published_at,
      releaseNotes: release.body || '暂无更新说明',
      downloadUrl: this.getDownloadUrl(release),
      htmlUrl: release.html_url,
      isPreRelease: release.prerelease as boolean,
    };
  }

  /**
   * 检查更新
   */
  async checkForUpdates(): Promise<UpdateCheckResult> {
    const currentVersion = this.getCurrentVersion();
    const settings = await this.getSettings();
    Logger.info(`[UpdateService] 检查更新，当前版本: ${currentVersion}`);

    try {
      const response = await axios.get(GITHUB_API_URL, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'API-Hub-Management-Tools',
        },
        timeout: 10000,
      });

      const releases: any[] = response.data;

      // 找到最新的正式版本
      const latestStableRelease = releases.find(r => !r.prerelease && !r.draft);
      // 找到最新的预发布版本
      const latestPreRelease = releases.find(r => r.prerelease && !r.draft);

      // 更新最后检查时间
      await this.saveSettings({
        ...settings,
        lastCheckTime: new Date().toISOString(),
      });

      const result: UpdateCheckResult = {
        hasUpdate: false,
        hasPreReleaseUpdate: false,
        currentVersion,
        latestVersion: currentVersion,
      };

      // 处理正式版本
      if (latestStableRelease) {
        const stableVersion = (latestStableRelease.tag_name as string).replace(/^v/, '');
        result.latestVersion = stableVersion;
        result.hasUpdate = this.compareVersions(currentVersion, stableVersion) < 0;

        if (result.hasUpdate) {
          result.releaseInfo = this.buildReleaseInfo(latestStableRelease);
        }

        Logger.info(`[UpdateService] 最新正式版本: ${stableVersion}, 有更新: ${result.hasUpdate}`);
      }

      // 处理预发布版本
      if (latestPreRelease) {
        const preReleaseVersion = (latestPreRelease.tag_name as string).replace(/^v/, '');
        result.latestPreReleaseVersion = preReleaseVersion;
        result.hasPreReleaseUpdate = this.compareVersions(currentVersion, preReleaseVersion) < 0;

        if (result.hasPreReleaseUpdate) {
          result.preReleaseInfo = this.buildReleaseInfo(latestPreRelease);
        }

        Logger.info(
          `[UpdateService] 最新预发布版本: ${preReleaseVersion}, 有更新: ${result.hasPreReleaseUpdate}`
        );
      }

      return result;
    } catch (error: any) {
      Logger.error('[UpdateService] 检查更新失败:', error.message);

      if (error.response?.status === 403) {
        throw new Error('GitHub API 请求限制，请稍后重试');
      }
      if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
        throw new Error('网络连接失败，请检查网络后重试');
      }
      throw new Error(`检查更新失败: ${error.message}`);
    }
  }

  /**
   * 在系统默认浏览器中打开下载链接
   */
  async openDownloadUrl(url: string): Promise<void> {
    Logger.info(`[UpdateService] 打开下载链接: ${url}`);
    await shell.openExternal(url);
  }

  /**
   * 获取更新设置
   */
  async getSettings(): Promise<UpdateSettings> {
    if (this.settings) {
      return this.settings;
    }

    try {
      const data = await fs.readFile(this.settingsPath, 'utf-8');
      const loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
      this.settings = loaded;
      return loaded;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        Logger.warn('[UpdateService] 读取设置失败，使用默认设置:', error.message);
      }
      const defaultSettings = { ...DEFAULT_SETTINGS };
      this.settings = defaultSettings;
      return defaultSettings;
    }
  }

  /**
   * 保存更新设置
   */
  async saveSettings(settings: UpdateSettings): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    await fs.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
    Logger.info('[UpdateService] 设置已保存');
  }
}

// 导出单例
export const updateService = new UpdateService();
