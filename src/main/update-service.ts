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
import * as fsSync from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { app, shell } from 'electron';
import { spawn } from 'child_process';
import axios from 'axios';

export interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  speed: number; // bytes per second
}

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
  private currentRequest: http.ClientRequest | null = null;
  private downloadCancelled = false;

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

    if (!release.assets || release.assets.length === 0) {
      return downloadUrl;
    }

    const platform = process.platform;
    let targetAsset;

    // 根据平台筛选对应的安装包
    if (platform === 'win32') {
      // Windows: 查找 Setup.exe
      targetAsset = release.assets.find(
        (asset: any) => asset.name.endsWith('.exe') && asset.name.includes('Setup')
      );
    } else if (platform === 'darwin') {
      // macOS: 优先查找 dmg，其次 zip (不包含 blockmap)
      targetAsset = release.assets.find(
        (asset: any) => asset.name.endsWith('.dmg') && !asset.name.includes('blockmap')
      );
      if (!targetAsset) {
        targetAsset = release.assets.find(
          (asset: any) => asset.name.endsWith('.zip') && !asset.name.includes('blockmap')
        );
      }
    } else if (platform === 'linux') {
      // Linux: 优先查找 AppImage，其次 deb
      targetAsset = release.assets.find((asset: any) => asset.name.endsWith('.AppImage'));
      if (!targetAsset) {
        targetAsset = release.assets.find((asset: any) => asset.name.endsWith('.deb'));
      }
    }

    if (targetAsset) {
      downloadUrl = targetAsset.browser_download_url;
      Logger.info(`[UpdateService] 已找到适配 ${platform} 的安装包: ${targetAsset.name}`);
    } else {
      Logger.warn(`[UpdateService] 未找到适配 ${platform} 的安装包，回退到发布页链接`);
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
   * 下载更新文件
   * 支持 GitHub 302 重定向，流式写入，进度回调
   */
  async downloadUpdate(
    url: string,
    onProgress: (progress: DownloadProgress) => void
  ): Promise<string> {
    this.downloadCancelled = false;

    // 从 URL 提取文件名
    const urlObj = new URL(url);
    const fileName = path.basename(urlObj.pathname) || 'update-installer';
    const tempDir = app.getPath('temp');
    const filePath = path.join(tempDir, fileName);

    Logger.info(`[UpdateService] 开始下载: ${url}`);
    Logger.info(`[UpdateService] 保存到: ${filePath}`);

    // 如果已有同名文件，先删除
    try {
      await fs.unlink(filePath);
    } catch {
      // 文件不存在，忽略
    }

    return new Promise<string>((resolve, reject) => {
      const doRequest = (requestUrl: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          reject(new Error('重定向次数过多'));
          return;
        }

        const parsedUrl = new URL(requestUrl);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;

        const req = protocol.get(
          requestUrl,
          {
            headers: {
              'User-Agent': 'API-Hub-Management-Tools',
            },
          },
          response => {
            // 处理重定向
            if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode)) {
              const redirectUrl = response.headers.location;
              if (!redirectUrl) {
                reject(new Error('重定向缺少 Location 头'));
                return;
              }
              Logger.info(`[UpdateService] 重定向到: ${redirectUrl}`);
              response.resume(); // 消耗响应体
              doRequest(redirectUrl, redirectCount + 1);
              return;
            }

            if (response.statusCode !== 200) {
              reject(new Error(`下载失败，HTTP 状态码: ${response.statusCode}`));
              return;
            }

            const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
            let downloadedBytes = 0;
            let lastTime = Date.now();
            let lastBytes = 0;

            const fileStream = fsSync.createWriteStream(filePath);

            response.on('data', (chunk: Buffer) => {
              if (this.downloadCancelled) {
                response.destroy();
                fileStream.close();
                fs.unlink(filePath).catch(() => {});
                reject(new Error('下载已取消'));
                return;
              }

              downloadedBytes += chunk.length;

              // 计算速度（每 500ms 更新一次）
              const now = Date.now();
              const timeDiff = (now - lastTime) / 1000;
              let speed = 0;
              if (timeDiff >= 0.5) {
                speed = (downloadedBytes - lastBytes) / timeDiff;
                lastTime = now;
                lastBytes = downloadedBytes;
              }

              const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;

              onProgress({
                percent: Math.round(percent * 10) / 10,
                transferred: downloadedBytes,
                total: totalBytes,
                speed,
              });
            });

            response.on('error', err => {
              fileStream.close();
              fs.unlink(filePath).catch(() => {});
              reject(new Error(`下载出错: ${err.message}`));
            });

            response.pipe(fileStream);

            fileStream.on('finish', () => {
              fileStream.close();
              if (!this.downloadCancelled) {
                Logger.info(`[UpdateService] 下载完成: ${filePath}`);
                resolve(filePath);
              }
            });

            fileStream.on('error', err => {
              fs.unlink(filePath).catch(() => {});
              reject(new Error(`写入文件出错: ${err.message}`));
            });
          }
        );

        req.on('error', err => {
          if (this.downloadCancelled) {
            reject(new Error('下载已取消'));
          } else {
            reject(new Error(`网络请求出错: ${err.message}`));
          }
        });

        this.currentRequest = req;
      };

      doRequest(url);
    });
  }

  /**
   * 取消当前下载
   */
  cancelDownload(): void {
    this.downloadCancelled = true;
    if (this.currentRequest) {
      this.currentRequest.destroy();
      this.currentRequest = null;
      Logger.info('[UpdateService] 下载已取消');
    }
  }

  /**
   * 安装更新：启动安装程序并退出应用
   */
  async installUpdate(filePath: string): Promise<void> {
    Logger.info(`[UpdateService] 启动安装: ${filePath}`);

    const platform = process.platform;

    try {
      if (platform === 'win32') {
        // Windows: 启动 NSIS 安装程序（静默模式）
        const child = spawn(filePath, ['/S'], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      } else if (platform === 'darwin') {
        // macOS: 打开 .dmg 文件
        await shell.openPath(filePath);
      } else {
        // Linux: 设置可执行权限并打开 AppImage
        try {
          await fs.chmod(filePath, 0o755);
        } catch {
          // 忽略权限设置错误
        }
        await shell.openPath(filePath);
      }

      // 延迟退出，确保安装程序已启动
      setTimeout(() => {
        app.quit();
      }, 1000);
    } catch (error: any) {
      Logger.error('[UpdateService] 启动安装程序失败:', error.message);
      throw new Error(`启动安装程序失败: ${error.message}`);
    }
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
