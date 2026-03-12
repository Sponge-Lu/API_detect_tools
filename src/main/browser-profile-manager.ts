/**
 * 输入: FileSystem, ChromeManager, UnifiedConfigManager
 * 输出: 浏览器 Profile 管理（主 Profile 检测、隔离 Profile 创建、Extensions 复制）
 * 定位: 基础设施层 - 管理多账户登录所需的浏览器 Profile
 *
 * 主浏览器: 使用用户真实 Chrome User Data 目录（保留插件）
 * 隔离浏览器: 第 2/3/... 账号按槽位共享 Profile，首次创建时仅复制 Extensions 并清理登录态
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';

const ISOLATED_PROFILES_DIR = 'browser-profiles';
const SHARED_PROFILE_PREFIX = 'slot-';
const AUTH_STATE_PATHS = [
  'Local State',
  path.join('Default', 'Preferences'),
  path.join('Default', 'Secure Preferences'),
  path.join('Default', 'Cookies'),
  path.join('Default', 'Cookies-journal'),
  path.join('Default', 'Login Data'),
  path.join('Default', 'Login Data-journal'),
  path.join('Default', 'Web Data'),
  path.join('Default', 'Web Data-journal'),
  path.join('Default', 'History'),
  path.join('Default', 'History-journal'),
  path.join('Default', 'Current Session'),
  path.join('Default', 'Current Tabs'),
  path.join('Default', 'Last Session'),
  path.join('Default', 'Last Tabs'),
  path.join('Default', 'Sessions'),
  path.join('Default', 'Session Storage'),
  path.join('Default', 'Local Storage'),
  path.join('Default', 'IndexedDB'),
  path.join('Default', 'Service Worker'),
  path.join('Default', 'SharedStorage'),
  path.join('Default', 'Storage'),
  path.join('Default', 'File System'),
  path.join('Default', 'Network'),
  path.join('Default', 'Extension Cookies'),
  path.join('Default', 'Extension Rules'),
  path.join('Default', 'Extension State'),
  path.join('Default', 'Local Extension Settings'),
  path.join('Default', 'Managed Extension Settings'),
  path.join('Default', 'Sync Extension Settings'),
];

export class BrowserProfileManager {
  /**
   * 检测用户主 Chrome Profile 路径（User Data 目录）
   * 优先使用配置中保存的路径，否则自动检测
   */
  async detectMainChromeProfile(): Promise<string | null> {
    // 1. 优先使用配置中的自定义路径
    const config = await unifiedConfigManager.loadConfig();
    const customPath = config.settings.browser_profile?.main_profile_path;
    if (customPath && fs.existsSync(customPath)) {
      Logger.info(`[BrowserProfile] 使用配置中的主 Profile 路径: ${customPath}`);
      return customPath;
    }

    // 2. 自动检测
    const detected = this.getDefaultChromeUserDataDir();
    if (detected) {
      Logger.info(`[BrowserProfile] 自动检测到主 Profile 路径: ${detected}`);
    } else {
      Logger.warn('[BrowserProfile] 未检测到 Chrome User Data 目录');
    }
    return detected;
  }

  /**
   * 获取系统默认 Chrome User Data 目录
   */
  private getDefaultChromeUserDataDir(): string | null {
    const platform = process.platform;
    const candidates: string[] = [];

    if (platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA;
      if (localAppData) {
        candidates.push(path.join(localAppData, 'Google', 'Chrome', 'User Data'));
        candidates.push(path.join(localAppData, 'Microsoft', 'Edge', 'User Data'));
      }
    } else if (platform === 'darwin') {
      const home = process.env.HOME;
      if (home) {
        candidates.push(path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'));
        candidates.push(path.join(home, 'Library', 'Application Support', 'Microsoft Edge'));
      }
    } else {
      // Linux
      const home = process.env.HOME;
      if (home) {
        candidates.push(path.join(home, '.config', 'google-chrome'));
        candidates.push(path.join(home, '.config', 'chromium'));
        candidates.push(path.join(home, '.config', 'microsoft-edge'));
      }
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * 检查 Chrome 是否正在运行
   */
  async isChromeRunning(): Promise<boolean> {
    try {
      const { execSync } = require('child_process');
      const platform = process.platform;

      if (platform === 'win32') {
        const output = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', {
          encoding: 'utf8',
          timeout: 5000,
        });
        return output.toLowerCase().includes('chrome.exe');
      } else if (platform === 'darwin') {
        const output = execSync('pgrep -x "Google Chrome"', {
          encoding: 'utf8',
          timeout: 5000,
        }).trim();
        return output.length > 0;
      } else {
        const output = execSync('pgrep -x chrome || pgrep -x chromium', {
          encoding: 'utf8',
          timeout: 5000,
        }).trim();
        return output.length > 0;
      }
    } catch {
      // pgrep 无匹配时 exit code 非 0
      return false;
    }
  }

  /**
   * 获取隔离 Profile 根目录
   */
  getIsolatedRootDir(): string {
    const config = unifiedConfigManager.getSites(); // 触发 config 加载的副作用已在上层完成
    const settings = (unifiedConfigManager as any).config?.settings;
    const customRoot = settings?.browser_profile?.isolated_root_dir;
    if (customRoot && fs.existsSync(customRoot)) {
      return customRoot;
    }
    return path.join(app.getPath('userData'), ISOLATED_PROFILES_DIR);
  }

  /**
   * 为站点创建隔离 Profile（复制主 Profile 的 Extensions）
   * @returns 隔离 Profile 的 userDataDir 路径
   */
  async prepareIsolatedProfile(siteId: string, accountId: string): Promise<string> {
    await unifiedConfigManager.loadConfig();

    const slotIndex = this.getNextSharedProfileSlot(siteId);
    const profileDir = path.join(this.getIsolatedRootDir(), `${SHARED_PROFILE_PREFIX}${slotIndex}`);
    const alreadyExists = fs.existsSync(profileDir);

    if (!alreadyExists) {
      await this.initializeSharedProfile(profileDir);
      Logger.info(
        `[BrowserProfile] 已初始化共享隔离 Profile(slot=${slotIndex}, account=${accountId})`
      );
    } else {
      await fsp.mkdir(path.join(profileDir, 'Default'), { recursive: true });
      Logger.info(`[BrowserProfile] 复用共享隔离 Profile(slot=${slotIndex}, account=${accountId})`);
    }

    return profileDir;
  }

  /**
   * 从主 Chrome Profile 复制 Extensions 到目标目录
   */
  private async copyExtensions(targetUserDataDir: string): Promise<void> {
    const mainProfile = await this.detectMainChromeProfile();
    if (!mainProfile) {
      Logger.warn('[BrowserProfile] 无法检测主 Profile，跳过 Extensions 复制');
      return;
    }

    // Chrome Extensions 位于 User Data/Default/Extensions
    const sourceExtDir = path.join(mainProfile, 'Default', 'Extensions');
    const targetExtDir = path.join(targetUserDataDir, 'Default', 'Extensions');

    if (!fs.existsSync(sourceExtDir)) {
      Logger.warn(`[BrowserProfile] 主 Profile Extensions 目录不存在: ${sourceExtDir}`);
      return;
    }

    try {
      // 确保 Default 目录存在
      await fsp.mkdir(path.join(targetUserDataDir, 'Default'), { recursive: true });

      // 递归复制 Extensions 目录
      await this.copyDir(sourceExtDir, targetExtDir);
      Logger.info(`[BrowserProfile] Extensions 复制完成: ${sourceExtDir} → ${targetExtDir}`);
    } catch (error: any) {
      Logger.error(`[BrowserProfile] Extensions 复制失败: ${error.message}`);
    }
  }

  /**
   * 递归复制目录
   */
  private async copyDir(src: string, dest: string): Promise<void> {
    await fsp.mkdir(dest, { recursive: true });
    const entries = await fsp.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        await fsp.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * 根据站点现有账户计算下一个共享 Profile 槽位
   */
  private getNextSharedProfileSlot(siteId: string): number {
    const siteAccounts = unifiedConfigManager
      .getAccountsBySiteId(siteId)
      .slice()
      .sort((a, b) => a.created_at - b.created_at);

    const usedSlots = new Set<number>();
    let inferredSlot = 2;

    for (const account of siteAccounts) {
      const parsedSlot = this.extractSharedProfileSlot(account.browser_profile_path);
      if (parsedSlot !== null) {
        usedSlots.add(parsedSlot);
        continue;
      }

      if (account.auth_source === 'isolated_profile') {
        while (usedSlots.has(inferredSlot)) {
          inferredSlot++;
        }
        usedSlots.add(inferredSlot);
        inferredSlot++;
      }
    }

    let nextSlot = 2;
    while (usedSlots.has(nextSlot)) {
      nextSlot++;
    }
    return nextSlot;
  }

  /**
   * 从已保存的 Profile 路径中提取共享槽位编号
   */
  private extractSharedProfileSlot(profilePath?: string): number | null {
    if (!profilePath) {
      return null;
    }

    const normalizedPath = profilePath.replace(/\\/g, '/');
    const match = normalizedPath.match(/(?:^|\/)slot-(\d+)$/);
    if (!match) {
      return null;
    }

    const slot = Number.parseInt(match[1], 10);
    return Number.isInteger(slot) && slot >= 2 ? slot : null;
  }

  /**
   * 首次初始化共享 Profile，只复制插件，不继承主浏览器登录态
   */
  private async initializeSharedProfile(profileDir: string): Promise<void> {
    await this.resetIsolatedProfile(profileDir);
    await this.writeFirstRunMarker(profileDir);
    await this.copyExtensions(profileDir);
    await this.clearAuthState(profileDir);
  }

  /**
   * 重建隔离 Profile 根目录，避免遗留任何旧会话
   */
  private async resetIsolatedProfile(profileDir: string): Promise<void> {
    if (fs.existsSync(profileDir)) {
      await fsp.rm(profileDir, { recursive: true, force: true });
    }
    await fsp.mkdir(path.join(profileDir, 'Default'), { recursive: true });
  }

  /**
   * 写入 Chrome First Run 标记，避免首次启动时导入默认浏览器数据
   */
  private async writeFirstRunMarker(profileDir: string): Promise<void> {
    await fsp.writeFile(path.join(profileDir, 'First Run'), '', 'utf-8');
  }

  /**
   * 显式清理认证和会话相关数据，确保隔离 Profile 只保留插件文件
   */
  private async clearAuthState(profileDir: string): Promise<void> {
    for (const relativePath of AUTH_STATE_PATHS) {
      await this.removeIfExists(path.join(profileDir, relativePath));
    }
  }

  /**
   * 如果路径存在则删除，兼容文件和目录
   */
  private async removeIfExists(targetPath: string): Promise<void> {
    if (!fs.existsSync(targetPath)) {
      return;
    }

    const stat = await fsp.lstat(targetPath);
    if (stat.isDirectory()) {
      await fsp.rm(targetPath, { recursive: true, force: true });
      return;
    }

    await fsp.unlink(targetPath);
  }

  /**
   * 删除隔离 Profile 目录
   */
  async deleteIsolatedProfile(siteId: string, accountId: string): Promise<void> {
    await unifiedConfigManager.loadConfig();
    const allAccounts = (unifiedConfigManager as any).config?.accounts || [];
    const account = allAccounts.find((item: { id: string; site_id: string }) => {
      return item.id === accountId && item.site_id === siteId;
    });
    const profileDir = account?.browser_profile_path;

    if (!profileDir) {
      return;
    }

    const isSharedByOtherAccounts = allAccounts.some(
      (item: { id: string; browser_profile_path?: string }) => {
        return item.id !== accountId && item.browser_profile_path === profileDir;
      }
    );

    if (isSharedByOtherAccounts) {
      Logger.info(`[BrowserProfile] 共享 Profile 仍被其他账户使用，跳过删除: ${profileDir}`);
      return;
    }

    if (fs.existsSync(profileDir)) {
      await fsp.rm(profileDir, { recursive: true, force: true });
      Logger.info(`[BrowserProfile] 隔离 Profile 已删除: ${profileDir}`);
    }
  }

  /**
   * 获取主浏览器登录所需的 launch options
   * 如果 Chrome 正在运行，返回 error 提示需要关闭
   */
  async getMainProfileLaunchOptions(): Promise<{
    success: boolean;
    options?: { userDataDir: string; profileDirectory: string };
    error?: string;
  }> {
    // 检查 Chrome 是否运行中
    const running = await this.isChromeRunning();
    if (running) {
      return {
        success: false,
        error: 'CHROME_RUNNING',
      };
    }

    // 检测主 Profile 路径
    const mainProfile = await this.detectMainChromeProfile();
    if (!mainProfile) {
      return {
        success: false,
        error: 'PROFILE_NOT_FOUND',
      };
    }

    return {
      success: true,
      options: {
        userDataDir: mainProfile,
        profileDirectory: 'Default',
      },
    };
  }

  /**
   * 获取隔离浏览器登录所需的 launch options
   */
  async getIsolatedProfileLaunchOptions(
    siteId: string,
    accountId: string
  ): Promise<{
    success: boolean;
    options?: { userDataDir: string };
    error?: string;
  }> {
    try {
      const profileDir = await this.prepareIsolatedProfile(siteId, accountId);
      return {
        success: true,
        options: { userDataDir: profileDir },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

// 导出单例
export const browserProfileManager = new BrowserProfileManager();
