import { getApplicationStorage } from './storage/application-storage';
/**
 * 输入: FileSystem, ChromeManager, UnifiedConfigManager
 * 输出: 浏览器 Profile 管理（主 Profile 检测、隔离 Profile 创建、账户显式绑定、恢复后 slot 重绑）
 * 定位: 基础设施层 - 管理多账户登录所需的浏览器 Profile
 *
 * 主浏览器: 使用用户真实 Chrome User Data 目录（保留插件）
 * 隔离浏览器: 第 2/3/... 账号按槽位共享 Profile，首次创建时仅复制 Extensions 并清理登录态
 * 跨机恢复: 可迁移备份不含 profile 本体；恢复后按旧 slot-N 重建空目录并重写 browser_profile_path
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
import type {
  AccountBrowserProfileOptions,
  AccountCredential,
  BrowserProfileOption,
  BrowserProfileOptionId,
} from '../shared/types/site';

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
  private slotAllocationQueue: Promise<unknown> = Promise.resolve();
  /**
   * 检测用户主 Chrome Profile 路径（User Data 目录）
   * 优先使用配置中保存的路径，否则自动检测
   */
  async detectMainChromeProfile(): Promise<string | null> {
    // 1. 优先使用配置中的自定义路径
    const config = await unifiedConfigManager.getConfig();
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
   * 检查 Chrome 是否正在运行（默认按 chrome.exe，可传入已解析的浏览器 exe 路径按实际进程名查询）
   */
  async isChromeRunning(browserExePath?: string): Promise<boolean> {
    try {
      const { execSync } = require('child_process');
      const platform = process.platform;

      // 按传入的浏览器可执行文件名查询：Edge 的进程是 msedge.exe，只查 chrome.exe 会漏判
      const imageNames = browserExePath
        ? [path.basename(browserExePath).toLowerCase()]
        : platform === 'win32'
          ? ['chrome.exe']
          : platform === 'darwin'
            ? ['Google Chrome']
            : ['chrome', 'chromium'];

      if (platform === 'win32') {
        for (const name of imageNames) {
          const output = execSync(`tasklist /FI "IMAGENAME eq ${name}" /NH`, {
            encoding: 'utf8',
            timeout: 5000,
          });
          if (output.toLowerCase().includes(name)) {
            return true;
          }
        }
        return false;
      } else if (platform === 'darwin') {
        for (const name of imageNames) {
          try {
            const output = execSync(`pgrep -f "${name.replace(/"/g, '')}"`, {
              encoding: 'utf8',
              timeout: 5000,
            }).trim();
            if (output.length > 0) return true;
          } catch {
            // pgrep 无匹配时 exit code 非 0
          }
        }
        return false;
      } else {
        for (const name of imageNames) {
          try {
            const output = execSync(`pgrep -f "${name.replace(/"/g, '')}"`, {
              encoding: 'utf8',
              timeout: 5000,
            }).trim();
            if (output.length > 0) return true;
          } catch {
            // pgrep 无匹配时 exit code 非 0
          }
        }
        return false;
      }
    } catch {
      // 查询失败时按未运行处理
      return false;
    }
  }

  /**
   * 获取隔离 Profile 根目录（统一到 browser-runtime/profiles，与检测槽位共用命名空间）
   */
  getIsolatedRootDir(): string {
    const settings = unifiedConfigManager.exportConfigSync()?.settings;
    const customRoot = settings?.browser_profile?.isolated_root_dir;
    if (customRoot) {
      return customRoot;
    }
    return path.join(app.getPath('userData'), 'browser-runtime', 'profiles');
  }

  /** 旧版隔离 Profile 根目录（userData/browser-profiles），启动时一次性搬迁到新根目录 */
  private getLegacyIsolatedRootDir(): string {
    return path.join(app.getPath('userData'), ISOLATED_PROFILES_DIR);
  }

  /** 旧目录存在且新目录为空时整体搬迁，保留其中的登录态（Cookies） */
  private async migrateLegacyIsolatedRoot(): Promise<void> {
    const legacyRoot = this.getLegacyIsolatedRootDir();
    if (!fs.existsSync(legacyRoot)) {
      return;
    }
    const newRoot = this.getIsolatedRootDir();
    if (newRoot === legacyRoot) {
      return;
    }
    try {
      await fsp.mkdir(newRoot, { recursive: true });
      const entries = await fsp.readdir(legacyRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const from = path.join(legacyRoot, entry.name);
        const to = path.join(newRoot, entry.name);
        if (fs.existsSync(to)) continue;
        try {
          await fsp.rename(from, to);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
          await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false });
          await fsp.rm(from, { recursive: true });
        }
        Logger.info(`[BrowserProfile] 隔离 Profile 已迁移: ${from} → ${to}`);
      }
      if ((await fsp.readdir(legacyRoot)).length === 0) await fsp.rmdir(legacyRoot);
      Logger.info(`[BrowserProfile] 旧隔离 Profile 根目录已清理: ${legacyRoot}`);
    } catch (error: any) {
      Logger.warn(`[BrowserProfile] 隔离 Profile 迁移失败（沿用原目录）: ${error.message}`);
    }
  }

  /**
   * 为站点创建隔离 Profile（复制主 Profile 的 Extensions）
   * @returns 隔离 Profile 的 userDataDir 路径
   */
  async prepareIsolatedProfile(siteId: string, accountId: string): Promise<string> {
    await unifiedConfigManager.getConfig();

    const slotIndex = this.getNextSharedProfileSlot(siteId);
    return this.ensureIsolatedProfileSlot(slotIndex, accountId);
  }

  /**
   * 确保指定 slot 目录存在；不存在时初始化空隔离 Profile（复制插件、清理登录态）。
   */
  async ensureIsolatedProfileSlot(slotIndex: number, accountId?: string): Promise<string> {
    if (!Number.isInteger(slotIndex) || slotIndex < 2) {
      throw new Error(`无效的隔离 Profile 槽位: ${slotIndex}`);
    }

    // 旧版 userData/browser-profiles 一次性迁移到统一根目录
    await this.migrateLegacyIsolatedRoot();

    const profileDir = path.join(this.getIsolatedRootDir(), `${SHARED_PROFILE_PREFIX}${slotIndex}`);
    const alreadyExists = fs.existsSync(profileDir);

    if (!alreadyExists) {
      await this.initializeSharedProfile(profileDir);
      Logger.info(
        `[BrowserProfile] 已初始化共享隔离 Profile(slot=${slotIndex}${
          accountId ? `, account=${accountId}` : ''
        })`
      );
    } else {
      await fsp.mkdir(path.join(profileDir, 'Default'), { recursive: true });
      Logger.info(
        `[BrowserProfile] 复用共享隔离 Profile(slot=${slotIndex}${
          accountId ? `, account=${accountId}` : ''
        })`
      );
    }

    return profileDir;
  }

  /**
   * 从已保存的 Profile 路径中提取共享槽位编号（公开给恢复逻辑复用）。
   */
  extractSharedProfileSlot(profilePath?: string): number | null {
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

  private getAccountProfileOptionId(
    account: Pick<AccountCredential, 'auth_source' | 'browser_profile_path' | 'automation_slot'>
  ): BrowserProfileOptionId {
    if (account.auth_source === 'main_profile') {
      return account.automation_slot === 0 ? 'internal_profile' : 'main_profile';
    }

    if (account.auth_source === 'isolated_profile') {
      const slot = this.extractSharedProfileSlot(account.browser_profile_path);
      return slot === null ? 'current_isolated_profile' : `isolated_profile:${slot}`;
    }

    return 'manual';
  }

  private async listExistingIsolatedProfileSlots(): Promise<
    Array<{ slot: number; profilePath: string }>
  > {
    const rootDir = this.getIsolatedRootDir();

    try {
      const entries = await fsp.readdir(rootDir, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => {
          const match = entry.name.match(/^slot-(\d+)$/i);
          const slot = match ? Number.parseInt(match[1], 10) : Number.NaN;
          return {
            slot,
            profilePath: path.join(rootDir, entry.name),
          };
        })
        .filter(item => Number.isInteger(item.slot) && item.slot >= 2)
        .sort((a, b) => a.slot - b.slot);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async listAccountProfileOptions(
    siteId: string,
    accountId: string
  ): Promise<AccountBrowserProfileOptions> {
    await unifiedConfigManager.getConfig();
    const account = unifiedConfigManager.getAccountById(accountId);
    if (!account || account.site_id !== siteId) {
      throw new Error('未找到对应的站点账户');
    }

    const selectedId = this.getAccountProfileOptionId(account);
    const siteAccounts = unifiedConfigManager.getAccountsBySiteId(siteId);
    const claimedByOther = new Map<BrowserProfileOptionId, string>();
    for (const candidate of siteAccounts) {
      if (candidate.id === accountId) {
        continue;
      }
      const optionId = this.getAccountProfileOptionId(candidate);
      if (optionId !== 'manual' && optionId !== 'current_isolated_profile') {
        claimedByOther.set(optionId, candidate.account_name || candidate.id);
      }
    }

    const options: BrowserProfileOption[] = [
      {
        id: 'internal_profile',
        label: '应用内置浏览器',
        authSource: 'main_profile',
        disabled: claimedByOther.has('internal_profile'),
        disabledReason: claimedByOther.has('internal_profile')
          ? `已被账户「${claimedByOther.get('internal_profile')}」使用`
          : undefined,
      },
      {
        id: 'manual',
        label: '手动添加账户无绑定浏览器',
        authSource: 'manual',
      },
    ];

    const mainProfilePath = await this.detectMainChromeProfile();
    const mainClaimedBy = claimedByOther.get('main_profile');
    options.push({
      id: 'main_profile',
      label: '主浏览器 Profile',
      authSource: 'main_profile',
      disabled: !mainProfilePath || Boolean(mainClaimedBy),
      disabledReason: !mainProfilePath
        ? '未检测到主浏览器 Profile'
        : mainClaimedBy
          ? `已被账户「${mainClaimedBy}」使用`
          : undefined,
    });

    for (const item of await this.listExistingIsolatedProfileSlots()) {
      const id = `isolated_profile:${item.slot}` as BrowserProfileOptionId;
      const claimedBy = claimedByOther.get(id);
      options.push({
        id,
        label: `隔离浏览器 ${item.slot - 1}`,
        authSource: 'isolated_profile',
        browserProfilePath: item.profilePath,
        disabled: Boolean(claimedBy),
        disabledReason: claimedBy ? `已被账户「${claimedBy}」使用` : undefined,
      });
    }

    if (!options.some(option => option.id === selectedId)) {
      const profilePath = account.browser_profile_path;
      const slot = this.extractSharedProfileSlot(profilePath);
      options.push({
        id: selectedId,
        label: slot === null ? '当前隔离浏览器' : `隔离浏览器 ${slot - 1}`,
        authSource: 'isolated_profile',
        browserProfilePath: profilePath,
        disabled: !profilePath || !fs.existsSync(profilePath),
        disabledReason:
          !profilePath || !fs.existsSync(profilePath) ? '当前 Profile 路径不可用' : undefined,
      });
    }

    return { selectedId, options };
  }

  /**
   * 优先使用已绑定的 Profile 槽位；未绑定账户从槽位 2 开始分配。
   * 返回槽位号（账户不存在时返回 null）。
   */
  ensureAutomationSlot(siteId: string, accountId: string): Promise<number | null> {
    const task = this.slotAllocationQueue.then(() =>
      this.allocateAutomationSlot(siteId, accountId)
    );
    this.slotAllocationQueue = task.catch(() => undefined);
    return task;
  }

  private async allocateAutomationSlot(siteId: string, accountId: string): Promise<number | null> {
    await unifiedConfigManager.getConfig();
    const account = unifiedConfigManager.getAccountById(accountId);
    if (!account || account.site_id !== siteId) {
      return null;
    }
    const boundSlot =
      account.auth_source === 'isolated_profile'
        ? this.extractSharedProfileSlot(account.browser_profile_path)
        : null;
    if (boundSlot !== null) {
      if (account.automation_slot !== boundSlot) {
        if (!(await unifiedConfigManager.updateAccount(accountId, { automation_slot: boundSlot })))
          return null;
      }
      return boundSlot;
    }
    if (account.auth_source === 'main_profile' && account.automation_slot === undefined) {
      const slot = account.browser_profile_path ? 1 : 0;
      if (!(await unifiedConfigManager.updateAccount(accountId, { automation_slot: slot })))
        return null;
      return slot;
    }
    if (Number.isInteger(account.automation_slot) && account.automation_slot! >= 0) {
      return account.automation_slot!;
    }

    const siteAccounts = unifiedConfigManager.getAccountsBySiteId(siteId);
    const used = new Set<number>();
    for (const item of siteAccounts) {
      if (typeof item.automation_slot === 'number') {
        used.add(item.automation_slot);
        continue;
      }
      const fromPath = this.extractSharedProfileSlot(item.browser_profile_path);
      if (fromPath !== null) {
        used.add(fromPath);
      }
    }

    let slot = 2;
    while (used.has(slot)) {
      slot++;
    }

    if (!(await unifiedConfigManager.updateAccount(accountId, { automation_slot: slot })))
      return null;
    Logger.info(`[BrowserProfile] 已为账户分配自动化槽位: account=${accountId}, slot=${slot}`);
    return slot;
  }

  /**
   * 枚举主浏览器 Profile（从 Local State 的 profile.info_cache，按最近使用排序）。
   * 取代硬编码的 'Default'：登录过 Chrome 同步账号的机器上活跃 Profile 往往不是 Default。
   */
  async listMainBrowserProfiles(): Promise<
    Array<{ directory: string; label: string; lastActive?: number }>
  > {
    const mainProfile = await this.detectMainChromeProfile();
    if (!mainProfile) {
      return [];
    }
    try {
      const localState = JSON.parse(
        fs.readFileSync(path.join(mainProfile, 'Local State'), 'utf-8')
      );
      const infoCache = localState?.profile?.info_cache || {};
      const lastUsed = localState?.profile?.last_used;
      const list = Object.entries(infoCache).map(([directory, info]: [string, any]) => ({
        directory,
        label: info?.name || info?.user_name || directory,
        lastActive: typeof info?.active_time === 'number' ? info.active_time : undefined,
      }));
      list.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
      if (list.length === 0 && lastUsed) {
        list.push({ directory: lastUsed, label: lastUsed, lastActive: undefined });
      }
      return list;
    } catch (error: any) {
      Logger.warn('[BrowserProfile] 读取主浏览器 Profile 列表失败:', error?.message || error);
      return [];
    }
  }

  async bindAccountProfile(
    siteId: string,
    accountId: string,
    optionId: BrowserProfileOptionId
  ): Promise<BrowserProfileOption> {
    const selection = await this.listAccountProfileOptions(siteId, accountId);
    const option = selection.options.find(candidate => candidate.id === optionId);
    if (!option) {
      throw new Error('所选浏览器 Profile 不存在');
    }
    if (option.disabled) {
      throw new Error(option.disabledReason || '所选浏览器 Profile 当前不可用');
    }
    if (option.authSource === 'isolated_profile' && !option.browserProfilePath) {
      throw new Error('所选隔离浏览器缺少 Profile 路径');
    }

    const isolatedSlot = this.extractSharedProfileSlot(option.browserProfilePath);
    const updated = await unifiedConfigManager.updateAccount(accountId, {
      auth_source: option.authSource,
      browser_profile_path:
        option.authSource === 'isolated_profile' ? option.browserProfilePath : undefined,
      automation_slot:
        option.id === 'internal_profile'
          ? 0
          : option.authSource === 'main_profile'
            ? 1
            : option.authSource === 'isolated_profile' && isolatedSlot !== null
              ? isolatedSlot
              : undefined,
    });
    if (!updated) {
      throw new Error('浏览器 Profile 绑定保存失败');
    }

    return option;
  }

  /**
   * 备份恢复后重绑隔离账户的 browser_profile_path 到本机 slot 目录。
   * - isolated_profile: 尽量保留旧 slot-N；冲突/无效时按站点分配下一空闲 slot
   * - main_profile / manual: 不创建隔离目录；main 上无效的 browser_profile_path 清空
   * 返回被重写的账户数量。
   */
  async reconcileIsolatedProfilesAfterRestore(): Promise<{
    reboundAccounts: number;
    createdSlots: number;
  }> {
    if (!getApplicationStorage()) await unifiedConfigManager.loadConfig();
    return unifiedConfigManager.mutateConfig(async () => {
      const config = (unifiedConfigManager as any).config as {
        accounts?: Array<{
          id: string;
          site_id: string;
          auth_source?: string;
          browser_profile_path?: string;
          created_at?: number;
        }>;
      } | null;

      if (!config?.accounts?.length) {
        return { reboundAccounts: 0, createdSlots: 0 };
      }

      const rootDir = this.getIsolatedRootDir();
      await fsp.mkdir(rootDir, { recursive: true });

      let reboundAccounts = 0;
      let createdSlots = 0;
      let dirty = false;

      const accountsBySite = new Map<string, typeof config.accounts>();
      for (const account of config.accounts) {
        const list = accountsBySite.get(account.site_id) || [];
        list.push(account);
        accountsBySite.set(account.site_id, list);
      }

      for (const [, siteAccounts] of accountsBySite) {
        siteAccounts.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

        const claimedSlots = new Set<number>();
        const plannedSlots = new Map<string, number>();

        // 优先按旧路径 slot-N 认领（同站多账户保持原映射）
        for (const account of siteAccounts) {
          if (account.auth_source !== 'isolated_profile') {
            continue;
          }
          const preferred = this.extractSharedProfileSlot(account.browser_profile_path);
          if (preferred !== null && !claimedSlots.has(preferred)) {
            claimedSlots.add(preferred);
            plannedSlots.set(account.id, preferred);
          }
        }

        // 无有效旧 slot 或冲突的账户分配下一空闲 slot
        for (const account of siteAccounts) {
          if (account.auth_source === 'main_profile') {
            if (account.browser_profile_path) {
              const stillValid =
                fs.existsSync(account.browser_profile_path) &&
                this.extractSharedProfileSlot(account.browser_profile_path) === null;
              if (!stillValid) {
                account.browser_profile_path = undefined;
                dirty = true;
                reboundAccounts++;
              }
            }
            continue;
          }

          if (account.auth_source !== 'isolated_profile') {
            continue;
          }

          let slot = plannedSlots.get(account.id);
          if (slot === undefined) {
            slot = 2;
            while (claimedSlots.has(slot)) {
              slot++;
            }
            claimedSlots.add(slot);
            plannedSlots.set(account.id, slot);
          }

          const profileDirBefore = path.join(rootDir, `${SHARED_PROFILE_PREFIX}${slot}`);
          const existed = fs.existsSync(profileDirBefore);
          const profileDir = await this.ensureIsolatedProfileSlot(slot, account.id);
          if (!existed) {
            createdSlots++;
          }

          // 恢复后同步持久化槽位号，检测/签到链路不再按账户列表位置计算
          const mutableAccount = account as typeof account & { automation_slot?: number };
          if (mutableAccount.automation_slot !== slot) {
            mutableAccount.automation_slot = slot;
            dirty = true;
            reboundAccounts++;
          }

          if (account.browser_profile_path !== profileDir) {
            account.browser_profile_path = profileDir;
            dirty = true;
            reboundAccounts++;
          }
        }
      }

      if (dirty) {
        await unifiedConfigManager.saveConfig();
        Logger.info(
          `[BrowserProfile] 恢复后已重绑隔离 Profile: rebound=${reboundAccounts}, createdSlots=${createdSlots}`
        );
      }

      return { reboundAccounts, createdSlots };
    });
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
      if (Number.isInteger(account.automation_slot) && account.automation_slot! >= 2) {
        usedSlots.add(account.automation_slot!);
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

    // 使用最近活跃的 Profile 目录，而非硬编码 'Default'（登录过同步账号的机器活跃 Profile 常非 Default）
    const profiles = await this.listMainBrowserProfiles();
    const profileDirectory = profiles[0]?.directory || 'Default';

    return {
      success: true,
      options: {
        userDataDir: mainProfile,
        profileDirectory,
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
      await unifiedConfigManager.getConfig();
      const account = unifiedConfigManager.getAccountById(accountId);
      if (account && account.site_id !== siteId) throw new Error('账户不属于当前站点');
      const boundPath =
        account?.auth_source === 'isolated_profile' ? account.browser_profile_path : undefined;
      const boundSlot = this.extractSharedProfileSlot(boundPath);
      const profileDir =
        boundPath && fs.existsSync(boundPath)
          ? boundPath
          : boundSlot !== null
            ? await this.ensureIsolatedProfileSlot(boundSlot, accountId)
            : await this.prepareIsolatedProfile(siteId, accountId);
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
