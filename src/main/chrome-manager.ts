import * as pageAuth from './browser-runtime/page-auth';
import type { LocalStorageData } from './browser-runtime/page-auth';
import * as browserPath from './browser-runtime/browser-path';
import { BrowserSlot, createEmptySlot } from './browser-runtime/browser-slot';

/**
 * 输入: Puppeteer (浏览器自动化), Electron app (应用路径), Logger (日志记录)
 * 输出: Browser 实例, Page 实例, LocalStorageData (含签到状态), 自动登录结果
 * 定位: 基础设施层 - 多槽位浏览器池管理，处理自动登录和数据提取
 *
 * 多槽位架构:
 * - slot 0 = 主浏览器 (api-detector-chrome)，所有站点的第 1 个账号共用
 * - slot N = 隔离浏览器 N (api-detector-chrome-isolated-N)，所有站点的第 N+1 个账号共用
 * - 每个槽位独立管理: browser, chromeProcess, debugPort, refCount, cleanupTimer
 * - 向后兼容属性代理: 旧代码通过 getter/setter 透明访问 slot 0
 * - loginBrowserState: 独立登录浏览器，不占用任何槽位，避免与检测任务冲突
 *
 * LocalStorageData 登录态字段支持:
 * - auth_user / auth_token 可作为登录凭据读取，但不能单独推断为 Sub2API
 * - 登录验证的 protected API 请求必须由主进程携带浏览器 Cookie 发起，避免 CSP/CORS
 *   阻断页面内 fetch 后让智能添加卡在“等待登录中”
 * - 新版 New API 通过 refresh Cookie 换取短期 Bearer，短期 Bearer 仅用于初始化长期 PAT
 * - 登录轮询每轮重新按目标域名选择页面，避免 OAuth 弹窗或新标签页导致读取错误页面
 * - 受 Bot/Cloudflare 保护的 API 通过 Cookie/UA 投影后的 Electron Session 请求，支持 GET/POST
 *
 * LocalStorageData 签到字段支持两种站点类型:
 * - Veloera: check_in_enabled, can_check_in
 * - New API: checkin_enabled, checkin.stats.checked_in_today (取反)
 *
 * cleanupSessionFiles 仅清理会话恢复相关文件（Preferences/Session/Sessions 等），不删除 Cookies；
 * 自动化 Profile 的登录态因此可以在多次启动之间保留
 *
 * 并发安全: cleanupOldPages 在 browserRefCount > 1 时跳过清理，
 * 避免关闭其他并发检测任务正在使用的页面
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import * as path from 'path';
import * as fs from 'fs';
import { net, session as electronSession, type CookiesSetDetails, type Session } from 'electron';
import Logger from './utils/logger';
import type { SiteType } from '../shared/types/site';
import { getSiteTypeProfile } from './site-type-registry';

import { browserProfileManager } from './browser-profile-manager';

/**
 * localStorage数据结构
 */

interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  expires?: number;
  httpOnly?: boolean;
  sameSite?: string;
}

export interface BrowserSessionTextResponse {
  status: number;
  statusText: string;
  text: string;
}

export interface BrowserSessionRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  allowNodeFallback?: boolean;
}

const LOGIN_API_REQUEST_TIMEOUT_MS = 10000;

export class ChromeManager {
  /**
   * 多槽位浏览器池
   * slot 0 = 应用内部主浏览器，slot 1 = 显式绑定的系统 Profile
   * slot >= 2 = 账户保存的隔离浏览器槽位
   */
  private slots = new Map<number, BrowserSlot>();

  /** 独立的登录浏览器状态（不占用任何槽位，避免与检测任务冲突） */
  private loginBrowserState: {
    browser: Browser | null;
    chromeProcess: any;
    debugPort: number;
    isClosed: boolean;
    abortController: AbortController | null;
    /** 登录/签到流程进行中：cleanup() 不得连带终止（用户可能正在窗口里登录或完成签到） */
    busy: boolean;
    userDataDir?: string;
  } | null = null;

  /** 按 origin 串行化登录验证请求，避免同一请求会话的 Cookie 同步互相覆盖 */
  private browserSessionRequestLocks = new Map<string, Promise<void>>();

  /** 获取或创建指定槽位 */
  private getSlot(index: number): BrowserSlot {
    let slot = this.slots.get(index);
    if (!slot) {
      slot = createEmptySlot();
      this.slots.set(index, slot);
    }
    return slot;
  }

  // ============= 向后兼容属性（代理到 slot 0） =============
  private get browser() {
    return this.getSlot(0).browser;
  }
  private set browser(v: Browser | null) {
    this.getSlot(0).browser = v;
  }
  private get chromeProcess() {
    return this.getSlot(0).chromeProcess;
  }
  private set chromeProcess(v: any) {
    this.getSlot(0).chromeProcess = v;
  }
  private get debugPort() {
    return this.getSlot(0).debugPort;
  }
  private set debugPort(v: number) {
    this.getSlot(0).debugPort = v;
  }
  private get browserRefCount() {
    return this.getSlot(0).refCount;
  }
  private set browserRefCount(v: number) {
    this.getSlot(0).refCount = v;
  }
  private get browserLock() {
    return this.getSlot(0).lock;
  }
  private set browserLock(v: Promise<void> | null) {
    this.getSlot(0).lock = v;
  }
  private get cleanupTimer() {
    return this.getSlot(0).cleanupTimer;
  }
  private set cleanupTimer(v: NodeJS.Timeout | null) {
    this.getSlot(0).cleanupTimer = v;
  }
  private get isBrowserClosed() {
    return this.getSlot(0).isClosed;
  }
  private set isBrowserClosed(v: boolean) {
    this.getSlot(0).isClosed = v;
  }
  private get abortController() {
    return this.getSlot(0).abortController;
  }
  private set abortController(v: AbortController | null) {
    this.getSlot(0).abortController = v;
  }

  /**
   * 获取浏览器引用（增加引用计数）
   * @returns 释放函数，调用后减少引用计数
   */
  private async acquireBrowser(): Promise<() => void> {
    this.browserRefCount++;
    Logger.info(`📊 [ChromeManager] 浏览器引用计数: ${this.browserRefCount}`);

    // 如果浏览器未启动，启动浏览器
    if (!this.browser) {
      // 等待锁完成（如果有）
      if (this.browserLock) {
        await this.browserLock;
      }

      // 如果等待后仍然没有浏览器，创建新的启动锁并启动
      if (!this.browser) {
        let resolveLock: () => void;
        this.browserLock = new Promise(resolve => {
          resolveLock = resolve;
        });

        try {
          // 使用一个虚拟URL启动浏览器，实际URL会在createPage中设置
          await this.launchBrowser('about:blank');
        } catch (launchError) {
          // 启动失败（端口未就绪/路径无效等）时回退引用计数，否则计数永不归零，自动清理失效
          if (this.browserRefCount > 0) {
            this.browserRefCount--;
          }
          throw launchError;
        } finally {
          this.browserLock = null;
          resolveLock!();
        }
      }
    }

    // 返回释放函数
    return () => {
      this.releaseBrowser();
    };
  }

  /**
   * 释放浏览器引用（减少引用计数）
   */
  private releaseBrowser(): void {
    if (this.browserRefCount > 0) {
      this.browserRefCount--;
      Logger.info(`📊 [ChromeManager] 浏览器引用计数: ${this.browserRefCount}`);

      // 如果引用计数为0，延迟关闭浏览器（以便后续检测复用）
      if (this.browserRefCount === 0) {
        // 清除之前的定时器
        if (this.cleanupTimer) {
          clearTimeout(this.cleanupTimer);
        }

        // 延迟5秒关闭，以便后续检测复用
        this.cleanupTimer = setTimeout(async () => {
          if (this.browserRefCount === 0) {
            Logger.info('⏰ [ChromeManager] 引用计数为0，延迟关闭浏览器');
            this.cleanup();
          }
        }, 5000);
      }
    }
  }

  /**
   * 创建一个新页面并导航到指定URL
   * 自动管理引用计数
   * @param url 目标URL
   * @param options 可选参数（slot: 浏览器槽位索引，0=主浏览器，N=隔离浏览器N）
   * @returns 包含页面和释放函数的对象
   */
  async createPage(
    url: string,
    options?: { slot?: number }
  ): Promise<{ page: Page; release: () => void }> {
    const slotIndex = options?.slot ?? 0;

    // 非零槽位走独立的浏览器管理路径
    if (slotIndex > 0) {
      try {
        return await this.createPageForSlot(url, slotIndex);
      } catch (error: any) {
        // 冷启动（杀软扫描/首次建 Profile）下首启超时较常见，端口/启动类失败清理后重试一次
        const message = String(error?.message || '');
        const retryable =
          message.includes('未就绪') ||
          message.includes('浏览器启动失败') ||
          message.includes('Session closed') ||
          message.includes('Connection closed') ||
          message.includes('Protocol error');
        if (!retryable) throw error;
        Logger.warn(
          `⚠️ [ChromeManager] slot-${slotIndex} 启动/连接异常，清理后重试一次: ${message}`
        );
        this.cleanupSlot(slotIndex);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return await this.createPageForSlot(url, slotIndex);
      }
    }

    // slot 0: 走原有逻辑（向后兼容）

    // 如果浏览器已关闭，则重置状态以允许重新启动
    // 说明：理论上浏览器关闭后不应再有有效引用，如果引用计数仍大于0，说明之前有引用泄漏
    // 为了保证后续检测可以继续工作，这里进行容错处理：强制将引用计数重置为0，并重新启动浏览器
    if (this.isBrowserClosed) {
      if (this.browserRefCount > 0) {
        Logger.warn(
          `⚠️ [ChromeManager] 检测到浏览器已关闭但引用计数仍为 ${this.browserRefCount}，强制重置为0以恢复后续操作`
        );
        this.browserRefCount = 0;
      }
      Logger.info('🔄 [ChromeManager] 浏览器已关闭，重置状态并准备重新启动...');
      this.isBrowserClosed = false;
      // 注意：浏览器已关闭时，this.browser 应该已经是 null（在 handleBrowserDisconnected 中设置）
      // 但为了安全，这里再次确认
      if (this.browser) {
        try {
          this.browser.removeAllListeners('disconnected');
          this.browser.disconnect();
        } catch (e) {
          // 忽略错误
        }
        this.browser = null;
      }
      // 创建新的 AbortController
      this.abortController = new AbortController();
    }

    // 获取浏览器引用并创建页面；启动阶段失败（端口未就绪/路径无效等）同样纳入下方重试
    let release: (() => void) | null = null;

    try {
      // 获取浏览器引用（增加引用计数）
      release = await this.acquireBrowser();

      // 检查浏览器连接状态
      if (this.browser) {
        try {
          // 尝试获取页面列表来验证连接是否有效
          await this.browser.pages();
        } catch (e) {
          Logger.warn('⚠️ [ChromeManager] 浏览器连接失效，需要重新启动');
          this.browser = null;
          // 连接失效时，需要重新获取引用
          const newRelease = await this.acquireBrowser();
          try {
            const page = await this.createPageInternal(url);
            return {
              page,
              release: () => {
                newRelease();
                release?.();
              },
            };
          } catch (pageError) {
            // 页面创建失败时归还新引用；旧引用交给外层 catch 统一释放
            newRelease();
            throw pageError;
          }
        }
      }

      if (!this.browser) {
        throw new Error('浏览器启动失败');
      }

      const page = await this.createPageInternal(url);

      return { page, release: release! };
    } catch (error: any) {
      // 如果创建失败，释放引用
      release?.();
      Logger.error('❌ [ChromeManager] createPage失败:', error.message);

      // 启动失败（端口未就绪等）与连接异常都清理后重试一次
      const message = String(error?.message || '');
      const retryable =
        message.includes('Target.createTarget timed out') ||
        message.includes('Session closed') ||
        message.includes('Connection closed') ||
        message.includes('Protocol error') ||
        message.includes('未就绪') ||
        message.includes('浏览器启动失败');

      if (retryable) {
        Logger.info('⚠️ [ChromeManager] 浏览器启动/连接异常，清理并重试...');

        // 只有在引用计数为0时才清理
        if (this.browserRefCount === 0) {
          await this.cleanup();
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 只重试一次，避免无限循环
        Logger.info('🔄 [ChromeManager] 重试创建页面...');
        const retryRelease = await this.acquireBrowser();
        try {
          const page = await this.createPageInternal(url);
          return { page, release: retryRelease };
        } catch (retryError) {
          retryRelease();
          throw retryError;
        }
      }
      throw error;
    }
  }

  /**
   * 内部方法：创建页面并导航到URL（不管理引用计数）
   */
  private async createPageInternal(url: string): Promise<Page> {
    if (!this.browser) {
      throw new Error('浏览器未启动');
    }

    // 清理旧页面：关闭所有 about:blank 和非目标域名的页面
    await this.cleanupOldPages(url);

    // 多 Tab 模式：每次检测创建独立的 Page，避免并发检测时多个站点抢同一个页面
    const page = await this.browser.newPage();
    (page as any).__slotIndex = 0;
    Logger.info('📄 [ChromeManager] 创建新页面');

    Logger.info(`🌐 [ChromeManager] 导航到: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    return page;
  }

  /**
   * 清理旧页面：关闭 about:blank、浏览器内部页面和同一域名的重复页面
   */
  private async cleanupOldPages(targetUrl: string): Promise<void> {
    if (!this.browser) return;

    // 并发检测时跳过清理，避免关闭其他任务正在使用的页面
    if (this.browserRefCount > 1) {
      Logger.info(
        `⏭️ [ChromeManager] 跳过旧页面清理：存在并发任务 (refCount: ${this.browserRefCount})`
      );
      return;
    }

    try {
      const pages = await this.browser.pages();
      let targetOrigin: string | null = null;

      // 解析目标URL的origin
      try {
        targetOrigin = new URL(targetUrl).origin;
      } catch {
        // 无效URL，跳过域名检查
      }

      for (const page of pages) {
        try {
          const pageUrl = page.url();
          // 关闭 about:blank 页面、浏览器内部页面
          const isBlankOrInternal =
            pageUrl === 'about:blank' ||
            pageUrl === '' ||
            pageUrl.startsWith('chrome://') ||
            pageUrl.startsWith('edge://') ||
            pageUrl.startsWith('chrome-extension://');

          // 检查是否是同一域名的页面（避免重复打开）
          let isSameOrigin = false;
          if (targetOrigin && pageUrl) {
            try {
              isSameOrigin = new URL(pageUrl).origin === targetOrigin;
            } catch {
              // 无效URL，跳过
            }
          }

          if (isBlankOrInternal || isSameOrigin) {
            await page.close();
            Logger.info(
              `🧹 [ChromeManager] 关闭旧页面: ${pageUrl || 'blank'}${isSameOrigin ? ' (同域名)' : ''}`
            );
          }
        } catch (e) {
          // 页面可能已关闭，忽略错误
        }
      }
    } catch (e) {
      // 静默失败
    }
  }

  /**
   * 启动浏览器（内部方法）
   * @param url 初始URL
   * @param options 启动选项（可自定义 userDataDir 和 profileDirectory）
   */
  private async launchBrowser(
    url: string,
    options?: { userDataDir?: string; profileDirectory?: string }
  ): Promise<void> {
    Logger.info('🚀 [ChromeManager] 启动浏览器...');

    // 1. 检查引用计数，如果 > 0，不应该清理（保持复用逻辑）
    if (this.browserRefCount > 0) {
      Logger.warn(
        `⚠️ [ChromeManager] 浏览器正在使用中（引用计数: ${this.browserRefCount}），跳过清理`
      );
      // 如果浏览器已存在且连接有效，直接返回（复用）
      if (this.browser) {
        try {
          await this.browser.pages();
          Logger.info('✅ [ChromeManager] 浏览器已存在且连接有效，复用');
          // 如果之前标记为关闭，现在重置状态（因为浏览器实际上还在运行）
          if (this.isBrowserClosed) {
            Logger.info('🔄 [ChromeManager] 浏览器实际仍在运行，重置关闭标志');
            this.isBrowserClosed = false;
            this.abortController = new AbortController();
          }
          return;
        } catch (e) {
          Logger.warn('⚠️ [ChromeManager] 浏览器连接失效，需要重新启动');
          this.browser = null;
          // 连接失效时，重置关闭标志以允许重新启动
          this.isBrowserClosed = false;
          this.abortController = new AbortController();
        }
      } else if (this.isBrowserClosed) {
        // 浏览器引用为null但标记为关闭，重置状态以允许重新启动
        Logger.info('🔄 [ChromeManager] 浏览器已关闭，重置状态以重新启动...');
        this.isBrowserClosed = false;
        this.abortController = new AbortController();
      }
    } else {
      // 引用计数为0时，清理资源（但不设置 isBrowserClosed，因为可能马上要重新启动）
      // 只清理资源，不设置关闭标志，以保持复用能力
      if (this.browser) {
        try {
          this.browser.removeAllListeners('disconnected');
          this.browser.disconnect();
        } catch (e) {
          // 忽略错误
        }
        this.browser = null;
      }
      if (this.cleanupTimer) {
        clearTimeout(this.cleanupTimer);
        this.cleanupTimer = null;
      }
      // 清理Chrome进程（如果存在）
      this.cleanupChromeProcess();
      // 重置关闭标志，以便后续操作可以重新启动浏览器
      if (this.isBrowserClosed) {
        Logger.info('🔄 [ChromeManager] 引用计数为0，重置关闭标志以允许后续复用');
        this.isBrowserClosed = false;
        this.abortController = new AbortController();
      }
    }

    const debugPort = await this.pickDebugPort();
    this.debugPort = debugPort;
    await this.waitForPortFree(debugPort);

    // 2. 准备启动参数
    const chromePath = this.getChromePath();
    if (!chromePath || !fs.existsSync(chromePath)) {
      throw new Error('未找到可用的浏览器。请在设置中指定浏览器路径，或安装 Chrome/Edge 后重试。');
    }
    const userDataDir = options?.userDataDir || this.getSlotUserDataDir(0);
    if (this.loginBrowserState?.userDataDir === userDataDir) {
      if (this.loginBrowserState.busy) throw new Error('该浏览器正在登录，请等待登录完成');
      const loginPort = this.loginBrowserState.debugPort;
      this.cleanupLoginBrowser();
      await this.waitForPortFree(loginPort);
    }

    // 2.5 清理会话恢复相关文件，防止打开历史页面
    this.cleanupSessionFiles(userDataDir);

    // 3. 启动Chrome进程 - 使用spawn而不是exec，并设置正确的编码
    const { spawn } = require('child_process');

    Logger.info(`📝 [ChromeManager] Chrome路径: ${chromePath}`);

    // 使用spawn避免命令解析问题，并设置编码
    const args = [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      ...(options?.profileDirectory ? [`--profile-directory=${options.profileDirectory}`] : []),
      '--no-first-run', // 跳过首次运行向导
      '--no-default-browser-check', // 跳过默认浏览器检查
      '--disable-session-crashed-bubble', // 禁用会话崩溃恢复提示
      '--hide-crash-restore-bubble', // 隐藏崩溃恢复气泡
      '--disable-features=SessionRestore,InfiniteSessionRestore', // 禁用会话恢复功能
      '--disable-restore-session-state', // 禁用恢复会话状态
      '--noerrdialogs', // 禁用错误对话框
      '--disable-infobars', // 禁用信息栏
      url,
    ];

    this.chromeProcess = spawn(chromePath, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'], // 忽略所有输出
    });

    this.chromeProcess.on('exit', (code: number | null, signal: string | null) => {
      Logger.warn(
        `?? [ChromeManager] Chrome process exited (code: ${code ?? 'null'}, signal: ${signal ?? 'null'})`
      );
    });

    this.chromeProcess.on('close', (code: number | null, signal: string | null) => {
      Logger.warn(
        `?? [ChromeManager] Chrome process closed (code: ${code ?? 'null'}, signal: ${signal ?? 'null'})`
      );
    });

    // 处理进程错误
    this.chromeProcess.on('error', (error: any) => {
      Logger.error('❌ [ChromeManager] Chrome进程错误:', error.message);
    });

    // 4. 等待调试端口就绪
    Logger.info(`⏳ [ChromeManager] 等待调试端口 ${this.debugPort} 就绪...`);
    await this.waitForPortReady(this.debugPort);

    // 5. 连接到Chrome
    Logger.info('🔌 [ChromeManager] 连接到Chrome...');
    this.browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${this.debugPort}`,
      protocolTimeout: 60000, // 60秒超时
    });

    // 重置关闭标志和创建新的 AbortController
    this.isBrowserClosed = false;
    this.abortController = new AbortController();

    // 监听浏览器断开事件
    this.browser.on('disconnected', () => {
      Logger.info('⚠️ [ChromeManager] 检测到浏览器已关闭');
      this.handleBrowserDisconnected();
    });

    Logger.info('✅ [ChromeManager] 浏览器启动成功');
  }

  /**
   * 等待端口释放
   */
  private async waitForPortFree(port: number, maxWait: number = 3000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      try {
        const isUsed = await this.isPortInUse(port);
        if (!isUsed) {
          Logger.info(`✅ [ChromeManager] 端口 ${port} 已释放`);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (e) {
        // 忽略检测错误
      }
    }

    Logger.warn(`⚠️ [ChromeManager] 端口 ${port} 可能仍被占用，继续尝试...`);
  }

  /**
   * 等待端口就绪
   */
  private async waitForPortReady(port: number, maxWait: number = 30000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      try {
        const isReady = await this.isPortInUse(port);
        if (isReady) {
          Logger.info(`✅ [ChromeManager] 端口 ${port} 已就绪`);
          await new Promise(resolve => setTimeout(resolve, 500)); // 额外等待稳定
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        // 继续等待
      }
    }

    throw new Error(`端口 ${port} 在 ${maxWait}ms 内未就绪`);
  }

  /**
   * Select a random available debug port to reduce repeated use of a fixed port.
   */
  private async pickDebugPort(): Promise<number> {
    const min = 20000;
    const max = 60000;

    for (let i = 0; i < 20; i++) {
      const port = Math.floor(Math.random() * (max - min + 1)) + min;
      try {
        const used = await this.isPortInUse(port);
        if (!used) {
          Logger.info(`?? [ChromeManager] ??????: ${port}`);
          return port;
        }
      } catch {
        // ignore and continue
      }
    }

    const fallback = this.debugPort || 9222;
    Logger.warn(`?? [ChromeManager] ???????????????: ${fallback}`);
    return fallback;
  }

  /**
   * 清理会话恢复相关文件，防止浏览器打开历史页面
   */
  private cleanupSessionFiles(userDataDir: string): void {
    try {
      const defaultDir = path.join(userDataDir, 'Default');

      // 需要清理的会话相关文件
      const sessionFiles = [
        'Current Session',
        'Current Tabs',
        'Last Session',
        'Last Tabs',
        'Preferences', // 包含会话恢复设置
      ];

      // 需要清理的会话相关目录
      const sessionDirs = ['Sessions', 'Session Storage'];

      // 清理文件
      for (const fileName of sessionFiles) {
        const filePath = path.join(defaultDir, fileName);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            Logger.info(`🧹 [ChromeManager] 已清理会话文件: ${fileName}`);
          } catch (e) {
            // 文件可能被锁定，忽略错误
          }
        }
      }

      // 清理目录
      for (const dirName of sessionDirs) {
        const dirPath = path.join(defaultDir, dirName);
        if (fs.existsSync(dirPath)) {
          try {
            fs.rmSync(dirPath, { recursive: true, force: true });
            Logger.info(`🧹 [ChromeManager] 已清理会话目录: ${dirName}`);
          } catch (e) {
            // 目录可能被锁定，忽略错误
          }
        }
      }

      Logger.info('✅ [ChromeManager] 会话文件清理完成');
    } catch (error: any) {
      Logger.warn('⚠️ [ChromeManager] 清理会话文件失败:', error.message);
      // 不影响后续流程
    }
  }

  /**
   * 检查端口是否被使用
   */
  private async isPortInUse(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const net = require('net');
      const tester = net
        .createServer()
        .once('error', () => resolve(true)) // 端口被占用
        .once('listening', () => {
          tester
            .once('close', () => resolve(false)) // 端口空闲
            .close();
        })
        .listen(port, '127.0.0.1');
    });
  }

  /**
   * 启动浏览器供用户登录
   * @param url 目标URL
   * @param options 启动选项（可自定义 userDataDir 和 profileDirectory）
   * @returns 启动结果
   */
  async launchForLogin(
    url: string,
    options?: { userDataDir?: string; profileDirectory?: string },
    behavior?: { preserveSession?: boolean }
  ): Promise<{ success: boolean; message: string }> {
    try {
      Logger.info('🚀 [ChromeManager] 启动独立登录浏览器...');

      // 清理上一次的登录浏览器
      this.cleanupLoginBrowser();

      const debugPort = await this.pickDebugPort();
      await this.waitForPortFree(debugPort);

      const chromePath = this.getChromePath();
      if (!chromePath || !fs.existsSync(chromePath)) {
        throw new Error('未找到可用的浏览器，无法打开登录窗口。请在设置中指定浏览器路径。');
      }
      const userDataDir = options?.userDataDir || this.getDefaultLoginProfilePath();
      if (userDataDir === this.getDefaultLoginProfilePath() && this.browser) {
        if (this.browserRefCount > 0) throw new Error('浏览器正在执行检测，请等待完成后再登录');
        this.browser.removeAllListeners('disconnected');
        await this.browser.close();
        this.browser = null;
        this.cleanupChromeProcess();
        await this.waitForPortFree(this.debugPort);
      }
      if (!behavior?.preserveSession) {
        this.cleanupSessionFiles(userDataDir);
      }

      const { spawn } = require('child_process');
      const args = [
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${userDataDir}`,
        ...(options?.profileDirectory ? [`--profile-directory=${options.profileDirectory}`] : []),
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--disable-features=SessionRestore,InfiniteSessionRestore',
        '--disable-restore-session-state',
        '--noerrdialogs',
        '--disable-infobars',
        url,
      ];

      const chromeProcess = spawn(chromePath, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      chromeProcess.on('error', (error: any) => {
        Logger.error('❌ [ChromeManager] 登录浏览器进程错误:', error.message);
      });

      await this.waitForPortReady(debugPort);

      const browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${debugPort}`,
        protocolTimeout: 60000,
      });

      // 等待初始页面就绪（CDP 注册有延迟）
      let pages = await browser.pages();
      for (let i = 0; i < 10 && pages.length === 0; i++) {
        await new Promise(r => setTimeout(r, 500));
        pages = await browser.pages();
      }
      if (pages.length === 0) {
        browser.disconnect();
        throw new Error('浏览器已启动但没有打开的页面');
      }

      this.loginBrowserState = {
        browser,
        chromeProcess,
        debugPort,
        isClosed: false,
        abortController: new AbortController(),
        busy: true,
        userDataDir,
      };

      browser.on('disconnected', () => {
        Logger.info('⚠️ [ChromeManager] 登录浏览器已关闭');
        if (this.loginBrowserState) {
          this.loginBrowserState.isClosed = true;
          this.loginBrowserState.busy = false;
          this.loginBrowserState.browser = null;
          if (this.loginBrowserState.abortController) {
            this.loginBrowserState.abortController.abort();
          }
        }
      });

      Logger.info('✅ [ChromeManager] 独立登录浏览器启动成功');
      return { success: true, message: '浏览器已启动，请在浏览器中完成登录' };
    } catch (error: any) {
      Logger.error('❌ [ChromeManager] 启动登录浏览器失败:', error.message);
      this.cleanupLoginBrowser();
      return { success: false, message: `启动失败: ${error.message}` };
    }
  }

  /**
   * 使用账户对应 Profile 打开站点，并在识别到登录状态后等待一段时间再自动关闭。
   */
  async openSiteWithProfileForCheckin(
    url: string,
    profileOptions?: { userDataDir?: string; profileDirectory?: string },
    checkinOptions?: { siteType?: SiteType; maxWaitTimeMs?: number; closeDelayMs?: number }
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const maxWaitTimeMs = checkinOptions?.maxWaitTimeMs ?? 120000;
    const closeDelayMs = checkinOptions?.closeDelayMs ?? 2000;

    try {
      const launchResult = await this.launchForLogin(url, profileOptions, {
        preserveSession: true,
      });
      if (!launchResult.success) {
        return {
          success: false,
          error: launchResult.message,
        };
      }

      await this.getLocalStorageData(url, true, maxWaitTimeMs, undefined, {
        loginMode: true,
        siteType: checkinOptions?.siteType,
      });

      if (closeDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, closeDelayMs));
      }

      return {
        success: true,
        message: '已识别到账户登录状态并完成签到浏览器流程',
      };
    } catch (error: any) {
      Logger.error(
        '❌ [ChromeManager] 使用账户 Profile 执行签到浏览器流程失败:',
        error?.message || error
      );
      return {
        success: false,
        error: error?.message || '打开站点失败',
      };
    } finally {
      this.cleanupLoginBrowser();
    }
  }

  /**
   * 清理独立的登录浏览器
   */
  cleanupLoginBrowser(): void {
    if (!this.loginBrowserState) return;
    const state = this.loginBrowserState;
    this.loginBrowserState = null;
    Logger.info('🧹 [ChromeManager] 清理登录浏览器');

    if (state.abortController) {
      state.abortController.abort();
    }
    if (state.browser) {
      try {
        state.browser.removeAllListeners('disconnected');
        state.browser.close().catch(() => {});
      } catch (_e) {
        /* ignore */
      }
    }
    if (state.chromeProcess) {
      this.killProcessTree(state.chromeProcess);
    }
  }

  /**
   * 清除登录浏览器中指定站点的认证数据（cookies + localStorage）
   * 仅影响目标域名，不影响同 Profile 下其他站点
   */
  async clearSiteDataForLogin(url: string): Promise<void> {
    if (!this.loginBrowserState?.browser) return;

    try {
      const pages = await this.loginBrowserState.browser.pages();
      if (pages.length === 0) return;
      const page = pages[0];

      // 1. 通过 CDP 删除目标域名的 cookies
      const { hostname } = new URL(url);
      const client = await page.createCDPSession();
      const { cookies } = await client.send('Network.getAllCookies');
      const siteCookies = cookies.filter(
        (c: any) => c.domain === hostname || c.domain === `.${hostname}`
      );
      if (siteCookies.length > 0) {
        for (const cookie of siteCookies) {
          await client.send('Network.deleteCookies', {
            name: cookie.name,
            domain: cookie.domain,
            path: cookie.path,
          });
        }
        Logger.info(`🧹 [ChromeManager] 已清理 ${siteCookies.length} 个站点 cookies`);
      }
      await client.detach();

      // 2. 清除页面 localStorage
      await page.evaluate(() => {
        try {
          (globalThis as any).localStorage.clear();
        } catch (_e) {
          /* ignore */
        }
      });
      Logger.info('🧹 [ChromeManager] 已清理站点 localStorage');

      // 3. 导航回站点（不用 reload，避免 chrome-error）
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      Logger.info('✅ [ChromeManager] 站点认证数据清理完成');
    } catch (error: any) {
      Logger.warn('⚠️ [ChromeManager] 清理站点数据失败:', error.message);
    }
  }

  /**
   * 在登录浏览器中创建 access token（通过浏览器上下文调用 /api/user/token）
   * 与 TokenService.createAccessToken 逻辑一致，但使用 loginBrowserState
   */
  async createAccessTokenForLogin(
    baseUrl: string,
    userId: number,
    sessionAccessToken?: string
  ): Promise<string | null> {
    if (!this.loginBrowserState?.browser) return null;

    const page = await this.resolveBestPageForUrl(this.loginBrowserState.browser, baseUrl);
    if (!page || page.isClosed()) return null;

    const cleanBaseUrl = baseUrl.replace(/\/$/, '');

    Logger.info('🔧 [ChromeManager] 通过登录浏览器创建 access token...');

    try {
      await this.ensurePageOnTargetSite(page, cleanBaseUrl, true);
      const effectiveBaseUrl = await this.resolveEffectiveBaseUrl(page, cleanBaseUrl, true);
      const apiUrl = `${effectiveBaseUrl}/api/user/token`;

      const token = await page.evaluate(
        async (url: string, uid: number, bearerToken?: string) => {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            Pragma: 'no-cache',
          };
          if (bearerToken) {
            headers.Authorization = `Bearer ${bearerToken}`;
          } else {
            headers['New-API-User'] = uid.toString();
            headers['Veloera-User'] = uid.toString();
            headers['voapi-user'] = uid.toString();
            headers['User-id'] = uid.toString();
          }

          const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers,
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
          }

          const data = JSON.parse(await response.text());
          if (!data.success || !data.data) {
            throw new Error(data.message || '创建令牌失败');
          }
          return data.data as string;
        },
        apiUrl,
        userId,
        sessionAccessToken
      );

      Logger.info('✅ [ChromeManager] access token 创建成功');
      return token;
    } catch (error: any) {
      Logger.warn('⚠️ [ChromeManager] 创建 access token 失败:', error.message);
      return null;
    }
  }

  private async resolveBestPageForUrl(browser: Browser, baseUrl: string): Promise<Page | null> {
    const pages = await browser.pages();
    const openPages = pages.filter(page => !page.isClosed());
    if (openPages.length === 0) {
      return null;
    }

    let targetHostname: string;
    try {
      targetHostname = new URL(baseUrl).hostname;
    } catch {
      return openPages[0];
    }

    const matchedPage = openPages.find(page => {
      try {
        return new URL(page.url()).hostname === targetHostname;
      } catch {
        return false;
      }
    });

    return matchedPage || openPages[0];
  }

  private async ensurePageOnTargetSite(
    page: Page,
    baseUrl: string,
    loginMode?: boolean
  ): Promise<void> {
    this.checkBrowserClosed(loginMode, page);
    if (page.isClosed()) {
      throw new Error('浏览器已关闭，操作已取消');
    }

    const targetHostname = new URL(baseUrl).hostname;
    const currentUrl = await page.url();

    try {
      if (new URL(currentUrl).hostname === targetHostname) {
        return;
      }
    } catch {
      // 当前页面可能仍是 about:blank 或三方 OAuth 跳转页，继续导航回目标站点。
    }

    Logger.info('🔄 [ChromeManager] 登录浏览器当前不在目标站点，导航回目标域名...');
    await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 10000 });
  }

  private isHttpUrl(value: string | null | undefined): value is string {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
  }

  private hasMeaningfulUserData(data?: LocalStorageData | null): boolean {
    if (!data) {
      return false;
    }

    return Boolean(
      data.userId ||
        data.username ||
        data.systemName ||
        data.accessToken ||
        data.siteTypeHint ||
        data.supportsCheckIn !== undefined ||
        data.canCheckIn !== undefined
    );
  }

  private mergeLocalAndApiData(
    localData: LocalStorageData,
    apiData: LocalStorageData,
    options?: { apiWins?: boolean }
  ): LocalStorageData {
    const apiWins = options?.apiWins !== false;
    const merged = apiWins ? { ...localData, ...apiData } : { ...apiData, ...localData };
    const localHasData = this.hasMeaningfulUserData(localData);
    const apiHasData = this.hasMeaningfulUserData(apiData);

    return {
      ...merged,
      dataSource: localHasData && apiHasData ? 'mixed' : apiHasData ? 'api' : 'localStorage',
    };
  }

  private isLikelyAuthError(error: unknown): boolean {
    const message = String((error as { message?: string } | null | undefined)?.message || '');
    return message.includes('401') || message.includes('403');
  }

  private isBrowserClosureError(error: unknown): boolean {
    const message = String((error as { message?: string } | null | undefined)?.message || '');
    return (
      message.includes('浏览器已关闭') ||
      message.includes('操作已被取消') ||
      message.includes('Target closed') ||
      message.includes('Session closed')
    );
  }

  private isTerminalModernAuthError(error: unknown): boolean {
    const message = String((error as { message?: string } | null | undefined)?.message || '');
    return /^新版登录会话刷新失败 \(HTTP (401|403|409)\)/.test(message);
  }

  private async resolveEffectiveBaseUrl(
    page: Page,
    baseUrl: string,
    loginMode?: boolean
  ): Promise<string> {
    const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

    try {
      const pageUrl = await this.resolveCurrentPageUrl(page, loginMode);
      if (!pageUrl) {
        return normalizedBaseUrl;
      }

      const original = new URL(normalizedBaseUrl);
      const current = new URL(pageUrl);

      if (!['http:', 'https:'].includes(current.protocol)) {
        return normalizedBaseUrl;
      }

      if (current.hostname !== original.hostname) {
        return normalizedBaseUrl;
      }

      original.protocol = current.protocol;
      original.host = current.host;
      const resolved = original.toString().replace(/\/$/, '');

      if (resolved !== normalizedBaseUrl) {
        Logger.info('🔄 [ChromeManager] 使用页面实际 origin 修正站点基址:', {
          originalBaseUrl: normalizedBaseUrl,
          resolvedBaseUrl: resolved,
          currentPageUrl: pageUrl,
        });
      }

      return resolved;
    } catch {
      return normalizedBaseUrl;
    }
  }

  private async resolveCurrentPageUrl(page: Page, loginMode?: boolean): Promise<string | null> {
    this.checkBrowserClosed(loginMode, page);
    if (page.isClosed()) {
      throw new Error('浏览器已关闭，操作已取消');
    }

    try {
      const currentUrl = await page.url();
      if (this.isHttpUrl(currentUrl)) {
        return currentUrl;
      }
    } catch {
      // ignore and fallback to location.href inside the page
    }

    try {
      const href = await page.evaluate(() => {
        try {
          const locationRef = (globalThis as any).location;
          if (typeof locationRef?.href === 'string' && locationRef.href.trim()) {
            return locationRef.href;
          }
          if (typeof locationRef?.origin === 'string' && locationRef.origin.trim()) {
            return locationRef.origin;
          }
        } catch {
          return null;
        }

        return null;
      });

      return this.isHttpUrl(href) ? href : null;
    } catch {
      return null;
    }
  }

  /**
   * 从浏览器localStorage获取核心数据
   * 统一策略：优先localStorage，必要时通过Cookie+API回退补全
   * @param url 站点URL
   * @param waitForLogin 是否等待用户登录（默认false）
   * @param maxWaitTime 最大等待时间（毫秒，默认60秒）
   * @param onStatus 状态回调函数（用于向前端发送实时状态）
   * @returns localStorage中的核心数据
   */
  async getLocalStorageData(
    url: string,
    waitForLogin: boolean = false,
    maxWaitTime: number = 60000,
    onStatus?: (status: string) => void,
    options?: { loginMode?: boolean; siteType?: SiteType }
  ): Promise<LocalStorageData> {
    const loginMode = options?.loginMode;
    const siteType = options?.siteType;

    // 选择正确的浏览器实例
    const activeBrowser = loginMode ? this.loginBrowserState?.browser : this.browser;

    this.checkBrowserClosed(loginMode);

    if (!activeBrowser) {
      throw new Error(loginMode ? '登录浏览器未启动' : '浏览器未启动');
    }

    let page = await this.resolveBestPageForUrl(activeBrowser, url);
    if (!page) {
      throw new Error('没有打开的页面');
    }

    // 等待页面稳定并读取 localStorage（处理重定向、Cloudflare 验证等）
    onStatus?.('等待页面加载...');
    let localData = await this.waitAndReadLocalStorage(page, url, onStatus, loginMode);
    localData = {
      ...localData,
      dataSource: localData.dataSource || 'localStorage',
    };

    // 判断是否需要等待登录：没有 userId，或者有 userId 但没有 accessToken（可能是残留数据）
    const needsLoginCheck = !localData.userId || (!localData.accessToken && waitForLogin);

    if (needsLoginCheck && waitForLogin) {
      Logger.info('⏳ [ChromeManager] 需要验证登录状态...');
      Logger.info(`   最长等待 ${maxWaitTime / 1000} 秒`);
      Logger.info('💡 [ChromeManager] 将同时检查localStorage和API接口');
      onStatus?.('正在验证登录状态...');

      // 先尝试一次API验证（用户可能已经登录）
      Logger.info('🔄 [ChromeManager] 尝试通过API验证登录状态...');
      try {
        this.checkBrowserClosed(loginMode);
        const apiData = await this.getUserDataFromApi(page, url, siteType, loginMode);
        if (apiData.userId) {
          Logger.info(`✅ [ChromeManager] 通过API检测到用户已登录！用户ID: ${apiData.userId}`);
          localData = this.mergeLocalAndApiData(localData, apiData);
        } else {
          // API也没有数据，进入等待循环
          onStatus?.('未检测到登录，请在浏览器中登录账号...');
          localData = await this.waitForUserLogin(
            activeBrowser,
            url,
            maxWaitTime,
            onStatus,
            loginMode,
            siteType
          );
        }
      } catch (apiError: any) {
        // 如果是浏览器关闭错误，直接抛出
        if (
          apiError.message.includes('浏览器已关闭') ||
          apiError.message.includes('操作已被取消')
        ) {
          throw apiError;
        }
        if (this.isTerminalModernAuthError(apiError)) {
          onStatus?.('新版登录会话无效，请重新登录后重试');
          throw apiError;
        }
        Logger.info(`ℹ️ [ChromeManager] API验证失败: ${apiError.message}，进入等待循环...`);
        // API失败（可能401/403），进入等待循环
        onStatus?.('登录状态无效，请在浏览器中登录账号...');
        localData = await this.waitForUserLogin(
          activeBrowser,
          url,
          maxWaitTime,
          onStatus,
          loginMode,
          siteType
        );
      }

      Logger.info('✅ [ChromeManager] 用户已登录，继续获取数据');
      Logger.info('📊 [ChromeManager] 登录后数据:');
      Logger.info('   - userId:', localData.userId);
      Logger.info('   - username:', localData.username || '未获取');
      Logger.info('   - accessToken:', localData.accessToken ? '已获取' : '未获取');
      Logger.info(
        '   - sessionAccessToken:',
        localData.sessionAccessToken ? '已获取（仅当前初始化使用）' : '未获取'
      );
    }

    page = (await this.resolveBestPageForUrl(activeBrowser, url)) || page;

    const hasFreshApiData = localData.dataSource === 'api' || localData.dataSource === 'mixed';

    // 第二步：检查是否需要API回退（没有 accessToken 说明需要验证登录状态）
    const needsApiFallback = (!localData.userId || !localData.accessToken) && !hasFreshApiData;

    if (needsApiFallback) {
      Logger.info('⚠️ [ChromeManager] 信息不完整，尝试通过API补全...');
      try {
        this.checkBrowserClosed(loginMode);
        const apiData = await this.getUserDataFromApi(page, url, siteType, loginMode);
        const merged = this.mergeLocalAndApiData(localData, apiData, { apiWins: false });
        Logger.info('✅ [ChromeManager] API补全完成');

        if (!merged.userId) {
          throw new Error('未找到用户ID，请确保已登录');
        }

        return merged;
      } catch (apiError: any) {
        // 如果是浏览器关闭错误，直接抛出
        if (
          apiError.message.includes('浏览器已关闭') ||
          apiError.message.includes('操作已被取消')
        ) {
          throw apiError;
        }
        if (this.isTerminalModernAuthError(apiError)) {
          throw apiError;
        }
        Logger.error('❌ [ChromeManager] API补全失败:', apiError.message);

        // 如果 API 返回 401 或其他认证错误，说明 session 过期，需要重新登录
        const isAuthError =
          apiError.message.includes('401') ||
          apiError.message.includes('403') ||
          apiError.message.includes('Execution context was destroyed');

        if (isAuthError && waitForLogin) {
          Logger.info('🔄 [ChromeManager] 检测到登录状态无效，等待用户重新登录...');
          onStatus?.('登录状态已过期，请在浏览器中重新登录...');
          localData = await this.waitForUserLogin(
            activeBrowser,
            url,
            maxWaitTime,
            onStatus,
            loginMode,
            siteType
          );
          return localData;
        }

        if (!localData.userId) {
          throw new Error('未找到用户ID，请确保已登录');
        }
      }
    }

    page = (await this.resolveBestPageForUrl(activeBrowser, url)) || page;
    const resolvedBaseUrl = await this.resolveEffectiveBaseUrl(page, url, loginMode);
    localData = { ...localData, resolvedBaseUrl };

    // 最后检查一次浏览器状态
    this.checkBrowserClosed(loginMode);

    return localData;
  }

  async readAuthDataFromPage(
    page: Page,
    url: string,
    options?: { siteType?: SiteType; loginMode?: boolean }
  ): Promise<LocalStorageData> {
    const loginMode = options?.loginMode;
    const siteType = options?.siteType;

    let localData = await this.waitAndReadLocalStorage(page, url, undefined, loginMode);
    localData = {
      ...localData,
      dataSource: localData.dataSource || 'localStorage',
    };

    const needsApiFallback = !localData.userId || !localData.accessToken;
    if (needsApiFallback) {
      try {
        Logger.info('🔄 [ChromeManager] localStorage 登录态不完整，尝试通过API补全...');
        const apiData = await this.getUserDataFromApi(page, url, siteType, loginMode);
        localData = this.mergeLocalAndApiData(localData, apiData, { apiWins: false });
      } catch (error: any) {
        Logger.warn(
          '⚠️ [ChromeManager] 页面登录态 API 补全失败，保留 localStorage 结果:',
          error.message
        );
      }
    }

    const resolvedBaseUrl = await this.resolveEffectiveBaseUrl(page, url, loginMode);
    return {
      ...localData,
      resolvedBaseUrl,
    };
  }

  /**
   * 处理浏览器断开连接
   */
  private handleBrowserDisconnected(): void {
    this.isBrowserClosed = true;

    // 取消所有正在进行的操作
    if (this.abortController) {
      this.abortController.abort();
      Logger.info('🛑 [ChromeManager] 已取消所有正在进行的操作');
    }

    // 重置浏览器引用
    this.browser = null;

    // 如果引用计数为0，清理进程
    if (this.browserRefCount === 0) {
      this.cleanupChromeProcess();
    }
  }

  /**
   * 检查浏览器是否已关闭
   * 非 loginMode 时优先按页面所属槽位检查（slot-N 页面不应被 slot-0 的关闭状态误杀）
   * @throws 如果浏览器已关闭，抛出错误
   */
  private checkBrowserClosed(loginMode?: boolean, page?: Page | { __slotIndex?: number }): void {
    if (loginMode) {
      if (!this.loginBrowserState || this.loginBrowserState.isClosed) {
        throw new Error('浏览器已关闭，操作已取消');
      }
      if (this.loginBrowserState.abortController?.signal.aborted) {
        throw new Error('操作已被取消（浏览器已关闭）');
      }
      return;
    }
    const slotIndex = (page as { __slotIndex?: number } | undefined)?.__slotIndex;
    if (typeof slotIndex === 'number' && slotIndex > 0) {
      const slot = this.slots.get(slotIndex);
      if (!slot || slot.isClosed) {
        throw new Error('浏览器已关闭，操作已取消');
      }
      if (slot.abortController?.signal.aborted) {
        throw new Error('操作已被取消（浏览器已关闭）');
      }
      return;
    }
    if (this.isBrowserClosed) {
      throw new Error('浏览器已关闭，操作已取消');
    }
    if (this.abortController?.signal.aborted) {
      throw new Error('操作已被取消（浏览器已关闭）');
    }
  }

  private isCookieVisibleToUrl(cookie: BrowserCookie, target: URL): boolean {
    const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
    const hostname = target.hostname.toLowerCase();
    const domain = cookieDomain.toLowerCase();
    const domainMatches = hostname === domain || hostname.endsWith(`.${domain}`);

    if (!domainMatches) {
      return false;
    }

    if (cookie.secure && target.protocol !== 'https:') {
      return false;
    }

    if (
      typeof cookie.expires === 'number' &&
      cookie.expires > 0 &&
      cookie.expires * 1000 < Date.now()
    ) {
      return false;
    }

    const cookiePath = cookie.path || '/';
    if (cookiePath === '/' || target.pathname === cookiePath) {
      return true;
    }
    return target.pathname.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`);
  }

  private async getCookiesForUrl(
    page: Page,
    requestUrl: string,
    loginMode?: boolean
  ): Promise<BrowserCookie[]> {
    const readOnce = async (): Promise<BrowserCookie[]> => {
      const target = new URL(requestUrl);
      const client = await page.createCDPSession();
      try {
        const { cookies } = await client.send('Network.getAllCookies');
        return (cookies as BrowserCookie[]).filter(cookie =>
          this.isCookieVisibleToUrl(cookie, target)
        );
      } finally {
        await client.detach().catch(() => undefined);
      }
    };

    try {
      if (loginMode) {
        this.checkBrowserClosed(true);
      }
      return await readOnce();
    } catch (error: any) {
      if (this.isBrowserClosureError(error)) {
        throw error;
      }
      // CDP 瞬时失败（页面导航中/高负载）重试一次，避免请求退化为无 Cookie 裸发导致 401 误判
      try {
        return await readOnce();
      } catch (retryError: any) {
        if (this.isBrowserClosureError(retryError)) {
          throw retryError;
        }
        Logger.warn(
          `⚠️ [ChromeManager] 读取浏览器 Cookie 两次失败，本次请求将不带 Cookie: ${retryError.message}`
        );
        return [];
      }
    }
  }

  private buildCookieHeader(cookies: BrowserCookie[]): string {
    return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  }

  private async withBrowserSessionRequestLock<T>(
    origin: string,
    task: () => Promise<T>
  ): Promise<T> {
    const previousLock = this.browserSessionRequestLocks.get(origin) || Promise.resolve();
    let releaseCurrentLock!: () => void;
    const currentLock = new Promise<void>(resolve => {
      releaseCurrentLock = resolve;
    });
    const storedLock = previousLock.catch(() => undefined).then(() => currentLock);
    this.browserSessionRequestLocks.set(origin, storedLock);

    await previousLock.catch(() => undefined);

    try {
      return await task();
    } finally {
      releaseCurrentLock();
      if (this.browserSessionRequestLocks.get(origin) === storedLock) {
        this.browserSessionRequestLocks.delete(origin);
      }
    }
  }

  private async prepareBrowserSessionForRequest(
    url: string,
    cookies: BrowserCookie[]
  ): Promise<Session | null> {
    if (typeof electronSession?.fromPartition !== 'function') {
      return null;
    }

    const target = new URL(url);
    const partition = `browser-api-${Buffer.from(target.origin).toString('base64url').slice(0, 120)}`;
    const requestSession = electronSession.fromPartition(partition);
    await requestSession.clearStorageData({
      origin: target.origin,
      storages: ['cookies'],
    });

    await Promise.all(
      cookies.map(cookie => {
        const details: CookiesSetDetails = {
          url: `${target.protocol}//${target.host}${cookie.path || '/'}`,
          name: cookie.name,
          value: cookie.value,
          path: cookie.path || '/',
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          expirationDate:
            typeof cookie.expires === 'number' && cookie.expires > 0 ? cookie.expires : undefined,
          sameSite: this.normalizeElectronCookieSameSite(cookie.sameSite),
        };

        if (cookie.domain.startsWith('.')) {
          details.domain = cookie.domain;
        }

        return requestSession.cookies.set(details).catch((error: any) => {
          Logger.warn('⚠️ [ChromeManager] 同步浏览器 Cookie 到主进程请求会话失败:', {
            name: cookie.name,
            domain: cookie.domain,
            error: error?.message || error,
          });
        });
      })
    );

    return requestSession;
  }

  private normalizeElectronCookieSameSite(
    sameSite: string | undefined
  ): CookiesSetDetails['sameSite'] | undefined {
    if (!sameSite) return undefined;
    const normalized = sameSite.toLowerCase();
    if (normalized === 'no_restriction' || normalized === 'none') return 'no_restriction';
    if (normalized === 'lax') return 'lax';
    if (normalized === 'strict') return 'strict';
    if (normalized === 'unspecified') return 'unspecified';
    return undefined;
  }

  async requestWithBrowserSession(
    page: Page,
    url: string,
    options: BrowserSessionRequestOptions = {},
    loginMode?: boolean
  ): Promise<BrowserSessionTextResponse> {
    if (loginMode) {
      this.checkBrowserClosed(true);
    }
    if (page.isClosed()) {
      throw new Error('浏览器已关闭，操作已取消');
    }

    const cookies = await this.getCookiesForUrl(page, url, loginMode);
    const userAgent = await page.evaluate(
      () => (globalThis as unknown as { navigator: { userAgent: string } }).navigator.userAgent
    );
    const headers: Record<string, string> = {
      ...options.headers,
      'User-Agent': userAgent,
    };
    const cookieHeader = this.buildCookieHeader(cookies);
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    return this.fetchTextWithBrowserSession(url, headers, cookies, options);
  }

  private async fetchTextWithBrowserSession(
    url: string,
    headers: Record<string, string>,
    cookies: BrowserCookie[],
    options: BrowserSessionRequestOptions = {}
  ): Promise<BrowserSessionTextResponse> {
    if (typeof net?.request === 'function') {
      try {
        const origin = new URL(url).origin;
        return await this.withBrowserSessionRequestLock(origin, async () => {
          const requestSession = await this.prepareBrowserSessionForRequest(url, cookies);
          if (!requestSession) {
            throw new Error('Electron session is unavailable for browser-session request');
          }
          try {
            return await this.fetchTextWithElectronNet(url, headers, requestSession, options);
          } finally {
            await requestSession
              .clearStorageData({ origin, storages: ['cookies'] })
              .catch((error: any) => {
                Logger.warn('⚠️ [ChromeManager] 清理主进程请求会话 Cookie 失败:', {
                  origin,
                  error: error?.message || error,
                });
              });
          }
        });
      } catch (error: any) {
        if (options.allowNodeFallback === false) {
          throw new Error(`Electron net 浏览器会话请求失败: ${error?.message || error}`);
        }
        Logger.warn('⚠️ [ChromeManager] Electron net 浏览器会话请求失败，回退到 Node fetch:', {
          url,
          error: error?.message || error,
        });
      }
    } else if (options.allowNodeFallback === false) {
      throw new Error('Electron net 浏览器会话请求不可用');
    }

    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body,
    });
    return {
      status: response.status,
      statusText: response.statusText,
      text: await response.text(),
    };
  }

  private fetchTextWithElectronNet(
    url: string,
    headers: Record<string, string>,
    requestSession: Session,
    options: BrowserSessionRequestOptions
  ): Promise<BrowserSessionTextResponse> {
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: options.method ?? 'GET',
        url,
        session: requestSession,
        credentials: 'include',
      });
      let settled = false;
      const timeoutMs = options.timeoutMs ?? LOGIN_API_REQUEST_TIMEOUT_MS;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        request.abort();
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      };

      for (const [key, value] of Object.entries(headers)) {
        if (['cookie', 'origin', 'referer'].includes(key.toLowerCase())) continue;
        request.setHeader(key, value);
      }

      request.on('response', response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve({
            status: response.statusCode,
            statusText: response.statusMessage || '',
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
        response.on('error', rejectOnce);
      });

      request.on('error', rejectOnce);
      if (options.body !== undefined) {
        request.write(options.body);
      }
      request.end();
    });
  }

  /**
   * 等待用户登录
   * 轮询检查localStorage中的userId，同时定期尝试API回退，直到检测到登录或超时
   * @param page 浏览器页面
   * @param baseUrl 站点URL（用于API回退）
   * @param maxWaitTime 最大等待时间（毫秒）
   * @param onStatus 状态回调函数
   * @returns 登录后的localStorage数据
   */
  private async waitForUserLogin(
    browser: Browser,
    baseUrl: string,
    maxWaitTime: number,
    onStatus?: (status: string) => void,
    loginMode?: boolean,
    siteType?: SiteType
  ): Promise<LocalStorageData> {
    const startTime = Date.now();
    const checkInterval = 2000; // 每2秒检查一次
    let checkCount = 0;
    const apiCheckInterval = 5; // 每5次检查（10秒）尝试一次API回退

    while (Date.now() - startTime < maxWaitTime) {
      // 检查浏览器是否已关闭
      this.checkBrowserClosed(loginMode);

      // 等待一段时间再检查（使用可中断的等待）
      await this.sleepWithAbort(checkInterval, loginMode);

      // 再次检查（可能在等待期间浏览器关闭了）
      this.checkBrowserClosed(loginMode);

      checkCount++;
      const elapsedTime = Math.floor((Date.now() - startTime) / 1000);
      Logger.info(
        `⏳ [ChromeManager] 等待登录中... (${elapsedTime}/${Math.floor(maxWaitTime / 1000)}秒)`
      );
      onStatus?.(`等待登录中... (${elapsedTime}s)`);

      const page = await this.resolveBestPageForUrl(browser, baseUrl);
      if (!page) {
        throw new Error('没有打开的页面');
      }

      // 检查localStorage
      try {
        const localData = await this.tryGetFromLocalStorage(page);

        // 如果有 userId 且有 accessToken，说明登录有效
        if (localData.userId && localData.accessToken) {
          Logger.info(`✅ [ChromeManager] 检测到用户登录！用户ID: ${localData.userId}`);
          return localData;
        }

        // 如果有 userId 但没有 accessToken，通过主进程携带浏览器 Cookie 验证登录状态。
        // 不依赖 Cookie 名称；页面内 fetch 可能被 CSP/CORS 阻断。
        if (localData.userId && !localData.accessToken) {
          Logger.info('🔄 [ChromeManager] 检测到userId但无accessToken，验证浏览器会话...');
          try {
            this.checkBrowserClosed(loginMode);
            const apiData = await this.getUserDataFromApi(page, baseUrl, siteType, loginMode);
            if (apiData.userId) {
              Logger.info(`✅ [ChromeManager] 登录状态有效！用户ID: ${apiData.userId}`);
              return this.mergeLocalAndApiData(localData, apiData);
            }
          } catch (apiError: any) {
            if (
              apiError.message.includes('浏览器已关闭') ||
              apiError.message.includes('操作已被取消')
            ) {
              throw apiError;
            }
            if (this.isTerminalModernAuthError(apiError)) {
              throw apiError;
            }
            if (this.isLikelyAuthError(apiError)) {
              Logger.info(
                'ℹ️ [ChromeManager] localStorage有残留数据但登录态已失效，继续等待登录...'
              );
            } else {
              Logger.info(
                `ℹ️ [ChromeManager] localStorage已读取到用户信息，但API验证失败: ${apiError.message}，继续等待登录...`
              );
            }
          }
        }

        // 定期尝试API回退（每10秒尝试一次）
        if (checkCount % apiCheckInterval === 0) {
          Logger.info('🔄 [ChromeManager] 尝试通过API检查登录状态...');
          try {
            this.checkBrowserClosed(loginMode);
            const apiData = await this.getUserDataFromApi(page, baseUrl, siteType, loginMode);
            if (apiData.userId) {
              Logger.info(`✅ [ChromeManager] 通过API检测到用户登录！用户ID: ${apiData.userId}`);
              return this.mergeLocalAndApiData(localData, apiData);
            }
          } catch (apiError: any) {
            // 如果是浏览器关闭错误，直接抛出
            if (
              apiError.message.includes('浏览器已关闭') ||
              apiError.message.includes('操作已被取消')
            ) {
              throw apiError;
            }
            if (this.isTerminalModernAuthError(apiError)) {
              throw apiError;
            }
            // API失败不影响继续等待
            Logger.info(`ℹ️ [ChromeManager] API检查失败: ${apiError.message}，继续等待...`);
          }
        }
      } catch (error: any) {
        // 如果是浏览器关闭错误，直接抛出
        if (error.message.includes('浏览器已关闭') || error.message.includes('操作已被取消')) {
          throw error;
        }
        if (this.isTerminalModernAuthError(error)) {
          throw error;
        }
        Logger.warn('⚠️ [ChromeManager] 检查登录状态时出错:', error.message);
        // 继续等待
      }
    }

    // 超时前，最后尝试一次API回退
    this.checkBrowserClosed(loginMode);

    Logger.info('⏰ [ChromeManager] 等待超时，最后尝试API回退...');
    try {
      const page = await this.resolveBestPageForUrl(browser, baseUrl);
      if (!page) {
        throw new Error('没有打开的页面');
      }
      const apiData = await this.getUserDataFromApi(page, baseUrl, siteType, loginMode);
      if (apiData.userId) {
        Logger.info(`✅ [ChromeManager] 通过API检测到用户登录！用户ID: ${apiData.userId}`);
        const localData = await this.tryGetFromLocalStorage(page);
        return this.mergeLocalAndApiData(localData, apiData);
      }
    } catch (apiError: any) {
      // 如果是浏览器关闭错误，直接抛出
      if (apiError.message.includes('浏览器已关闭') || apiError.message.includes('操作已被取消')) {
        throw apiError;
      }
      if (this.isTerminalModernAuthError(apiError)) {
        throw apiError;
      }
      Logger.info(`ℹ️ [ChromeManager] 最后API检查也失败: ${apiError.message}`);
    }

    // 最后检查一次浏览器状态
    this.checkBrowserClosed(loginMode);

    // 超时
    throw new Error(`等待登录超时（${maxWaitTime / 1000}秒），请确保已在浏览器中完成登录`);
  }

  /**
   * 等待页面稳定并读取 localStorage
   * 处理页面导航、重定向、Cloudflare 验证等情况
   * @param page 浏览器页面
   * @param url 目标站点URL
   * @param onStatus 状态回调
   * @returns localStorage 数据
   */
  private async waitAndReadLocalStorage(
    page: Page,
    url: string,
    onStatus?: (status: string) => void,
    loginMode?: boolean
  ): Promise<LocalStorageData> {
    const maxRetries = 10;
    const retryDelay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.checkBrowserClosed(loginMode, page);

      try {
        // 检查页面 URL，确保在目标域名上
        const currentUrl = (await this.resolveCurrentPageUrl(page, loginMode)) || 'unknown';
        Logger.info(`📍 [ChromeManager] 当前页面URL: ${currentUrl}`);

        // 检查是否是 Cloudflare 挑战页面
        const html = await page.content().catch(() => '');
        const isCloudflare =
          html.includes('cf-browser-verification') ||
          html.includes('Just a moment') ||
          html.includes('Checking your browser');

        if (isCloudflare) {
          Logger.info('🛡️ [ChromeManager] 检测到 Cloudflare 验证页面，等待验证通过...');
          onStatus?.('正在等待 Cloudflare 验证...');
          await this.sleepWithAbort(retryDelay, loginMode, page);
          continue;
        }

        // 等待页面网络空闲
        await page.waitForNetworkIdle({ timeout: 3000 }).catch(() => {});

        // 短暂等待让页面稳定
        await this.sleepWithAbort(500, loginMode, page);

        // 尝试读取 localStorage
        Logger.info('🔍 [ChromeManager] 尝试读取 localStorage...');
        const localData = await this.tryGetFromLocalStorage(page);

        Logger.info('📊 [ChromeManager] localStorage数据:');
        Logger.info('   - userId:', localData.userId || '缺失');
        Logger.info('   - username:', localData.username || '缺失');
        Logger.info('   - systemName:', localData.systemName || '缺失');
        Logger.info('   - accessToken:', localData.accessToken ? '已获取' : '缺失');
        Logger.info('   - siteTypeHint:', localData.siteTypeHint || '缺失');
        Logger.info('   - supportsCheckIn:', localData.supportsCheckIn ?? '未知');
        Logger.info('   - canCheckIn:', localData.canCheckIn ?? '未知');

        return localData;
      } catch (error: any) {
        // 如果是浏览器关闭错误，直接抛出
        if (error.message.includes('浏览器已关闭') || error.message.includes('操作已被取消')) {
          throw error;
        }

        // 页面导航错误，等待后重试
        if (
          error.message.includes('Execution context was destroyed') ||
          error.message.includes('navigation') ||
          error.message.includes('Target closed') ||
          error.message.includes('Session closed')
        ) {
          Logger.info(
            `⚠️ [ChromeManager] 页面正在导航中 (${attempt}/${maxRetries})，等待页面稳定...`
          );
          onStatus?.(`页面加载中... (${attempt}/${maxRetries})`);
          await this.sleepWithAbort(retryDelay, loginMode);
          continue;
        }

        // 其他错误，记录并重试
        Logger.warn(
          `⚠️ [ChromeManager] 读取 localStorage 失败 (${attempt}/${maxRetries}):`,
          error.message
        );
        if (attempt < maxRetries) {
          await this.sleepWithAbort(retryDelay, loginMode, page);
          continue;
        }
        throw error;
      }
    }

    // 所有重试都失败
    throw new Error('无法读取页面数据，页面可能仍在加载中');
  }

  /**
   * 可中断的睡眠函数
   * 非 loginMode 时优先使用页面所属槽位的 AbortController
   * @param ms 等待时间（毫秒）
   */
  private async sleepWithAbort(ms: number, loginMode?: boolean, page?: Page): Promise<void> {
    const slotIndex = (page as { __slotIndex?: number } | undefined)?.__slotIndex;
    const ac = loginMode
      ? this.loginBrowserState?.abortController
      : typeof slotIndex === 'number' && slotIndex > 0
        ? this.slots.get(slotIndex)?.abortController
        : this.abortController;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve();
      }, ms);

      if (ac) {
        ac.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeout);
            reject(new Error('操作已被取消（浏览器已关闭）'));
          },
          { once: true }
        );
      }
    });
  }

  /**
   * 从localStorage尝试获取所有可能的认证信息
   * 多路径策略：尝试所有可能的键名和对象路径
   * @param page 浏览器页面
   * @returns 从localStorage收集到的数据
   */
  private async tryGetFromLocalStorage(page: Page): Promise<LocalStorageData> {
    return pageAuth.tryGetFromLocalStorage(page);
  }

  /**
   * 通过Cookie调用API获取用户数据（回退机制）
   * 多路径策略：尝试多个API端点
   * @param page 浏览器页面
   * @param baseUrl 站点URL
   * @returns 用户数据
   */
  private async getUserDataFromApi(
    page: any,
    baseUrl: string,
    siteType?: SiteType,
    loginMode?: boolean
  ): Promise<LocalStorageData> {
    // 检查浏览器是否已关闭（按页面所属槽位检查）
    this.checkBrowserClosed(loginMode, page);

    // 检查页面是否已关闭
    if (page.isClosed()) {
      throw new Error('浏览器已关闭，操作已取消');
    }

    const cleanBaseUrl = await this.resolveEffectiveBaseUrl(page, baseUrl, loginMode);

    let lastError: any = null;

    if (loginMode && (siteType === undefined || siteType === 'newapi')) {
      try {
        const modernAuthData = await this.getModernAuthDataFromRefresh(
          page,
          cleanBaseUrl,
          loginMode
        );
        if (modernAuthData?.userId) {
          try {
            const systemName = await this.getSystemNameFromApi(page, cleanBaseUrl, loginMode);
            if (systemName) {
              modernAuthData.systemName = systemName;
            }
          } catch (error: any) {
            if (this.isBrowserClosureError(error)) {
              throw error;
            }
            Logger.warn('⚠️ [ChromeManager] 新版认证成功后获取system_name失败，继续');
          }
          return modernAuthData;
        }
      } catch (error: any) {
        if (this.isBrowserClosureError(error)) {
          throw error;
        }
        if (this.isTerminalModernAuthError(error)) {
          throw error;
        }
        Logger.info(`ℹ️ [ChromeManager] 新版认证 refresh 未就绪: ${error.message}`);
        lastError = error;
      }
    }

    const endpoints = getSiteTypeProfile(siteType).initializationUserEndpoints;

    for (const endpoint of endpoints) {
      // 在每次循环前检查浏览器状态
      this.checkBrowserClosed(loginMode);
      if (page.isClosed()) {
        throw new Error('浏览器已关闭，操作已取消');
      }

      const apiUrl = `${cleanBaseUrl}${endpoint}`;

      try {
        Logger.info(`📡 [ChromeManager] 尝试API: ${apiUrl}`);

        const result = await this.fetchUserDataWithBrowserSession(
          page,
          apiUrl,
          cleanBaseUrl,
          loginMode
        );

        Logger.info('📊 [ChromeManager] API返回数据:');
        Logger.info('   - userId:', result.userId);
        Logger.info('   - username:', result.username);
        Logger.info('   - accessToken:', result.accessToken ? '已获取' : '未找到');

        // 如果成功获取到userId，返回结果
        if (result.userId) {
          // 再次检查浏览器状态
          this.checkBrowserClosed(loginMode);
          if (page.isClosed()) {
            throw new Error('浏览器已关闭，操作已取消');
          }

          // 尝试获取system_name
          try {
            const systemName = await this.getSystemNameFromApi(page, cleanBaseUrl, loginMode);
            if (systemName) {
              result.systemName = systemName;
            }
          } catch (e: any) {
            // 如果是浏览器关闭错误，直接抛出
            if (e.message.includes('浏览器已关闭') || e.message.includes('操作已取消')) {
              throw e;
            }
            Logger.warn('⚠️ [ChromeManager] 获取system_name失败，继续');
          }

          return result;
        }
      } catch (error: any) {
        // 如果是浏览器关闭错误，直接抛出
        if (error.message.includes('浏览器已关闭') || error.message.includes('操作已取消')) {
          throw error;
        }
        Logger.warn(`⚠️ [ChromeManager] 端点 ${endpoint} 失败:`, error.message);
        lastError = error;
        continue;
      }
    }

    // 所有端点都失败
    if (lastError) {
      throw lastError;
    }

    throw new Error('无法从任何API端点获取用户数据');
  }

  private async getModernAuthDataFromRefresh(
    page: Page,
    baseUrl: string,
    loginMode?: boolean
  ): Promise<LocalStorageData | null> {
    this.checkBrowserClosed(loginMode);
    if (page.isClosed()) {
      throw new Error('浏览器已关闭，操作已取消');
    }

    const currentPageUrl = await this.resolveCurrentPageUrl(page, loginMode);
    if (!currentPageUrl) {
      return null;
    }

    const pageOrigin = new URL(currentPageUrl).origin;
    const targetOrigin = new URL(baseUrl).origin;
    if (pageOrigin !== targetOrigin) {
      return null;
    }

    const refreshUrl = `${baseUrl}/api/user/auth/refresh`;
    const refreshCookies = await this.getCookiesForUrl(page, refreshUrl, loginMode);
    const hasModernRefreshCookie = refreshCookies.some(
      cookie => cookie.httpOnly && (cookie.path || '/').startsWith('/api/user/auth')
    );
    if (!hasModernRefreshCookie) {
      return null;
    }

    const response = await page.evaluate(async (url: string) => {
      try {
        const result = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            Pragma: 'no-cache',
          },
        });
        return {
          status: result.status,
          statusText: result.statusText,
          text: await result.text(),
        };
      } catch (error: any) {
        throw new Error(error?.message || 'refresh request failed');
      }
    }, refreshUrl);

    if (response.status === 404 || response.status === 405) {
      return null;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `新版登录会话刷新失败 (HTTP ${response.status}): ${response.text.substring(0, 200)}`
      );
    }

    let payload: any;
    try {
      payload = response.text ? JSON.parse(response.text) : null;
    } catch {
      throw new Error('新版登录会话刷新响应不是有效 JSON');
    }

    const bundle = payload?.data;
    const sessionAccessToken = bundle?.access_token;
    if (payload?.success !== true || typeof sessionAccessToken !== 'string' || !bundle?.user) {
      throw new Error(payload?.message || '新版登录会话刷新响应缺少 AuthBundle');
    }

    const userData = this.parseUserDataResponse({ data: bundle.user });
    Logger.info('✅ [ChromeManager] 已通过新版 refresh 协议确认登录状态');
    return {
      ...userData,
      accessToken: null,
      sessionAccessToken,
      dataSource: 'api',
    };
  }

  private parseUserDataResponse(data: any): LocalStorageData {
    return pageAuth.parseUserDataResponse(data);
  }

  private async readUserIdHintFromPage(page: any): Promise<number | string | null> {
    return pageAuth.readUserIdHintFromPage(page);
  }

  private async fetchJsonWithBrowserSession(
    page: Page,
    url: string,
    userId: number | string | null,
    loginMode?: boolean
  ): Promise<any> {
    this.checkBrowserClosed(loginMode, page);
    if (page.isClosed()) {
      throw new Error('浏览器已关闭，操作已取消');
    }

    const requestOrigin = new URL(url).origin;
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      Origin: requestOrigin,
      Referer: `${requestOrigin}/`,
    };

    if (userId) {
      const normalizedUserId = String(userId);
      headers['New-API-User'] = normalizedUserId;
      headers['Veloera-User'] = normalizedUserId;
      headers['voapi-user'] = normalizedUserId;
      headers['User-id'] = normalizedUserId;
    }

    const response = await this.requestWithBrowserSession(page, url, { headers }, loginMode);
    const text = response.text;

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
    }

    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new Error('响应不是有效 JSON');
    }
  }

  private async fetchUserDataWithBrowserSession(
    page: Page,
    apiUrl: string,
    baseUrl: string,
    loginMode?: boolean
  ): Promise<LocalStorageData> {
    const userId = await this.readUserIdHintFromPage(page);

    try {
      const data = await this.fetchJsonWithBrowserSession(page, apiUrl, userId, loginMode);
      return this.parseUserDataResponse(data);
    } catch (firstError: any) {
      if (this.isBrowserClosureError(firstError)) {
        throw firstError;
      }

      if (!userId) {
        throw firstError;
      }

      Logger.info('ℹ️ [ChromeManager] 带页面 userId 提示的 API 请求失败，尝试无用户头重试:', {
        baseUrl,
        ignoredUserId: userId,
        error: firstError.message,
      });
      const retryData = await this.fetchJsonWithBrowserSession(page, apiUrl, null, loginMode);
      const parsedRetryData = this.parseUserDataResponse(retryData);
      Logger.info('✅ [ChromeManager] API 无用户头重试成功，忽略页面 userId 提示:', {
        baseUrl,
        ignoredUserId: userId,
      });
      return parsedRetryData;
    }
  }

  /**
   * 从/api/status接口获取系统名称
   * @param page 浏览器页面
   * @param baseUrl 站点URL
   * @returns 系统名称
   */
  private async getSystemNameFromApi(
    page: any,
    baseUrl: string,
    loginMode?: boolean
  ): Promise<string | null> {
    // 检查浏览器是否已关闭
    this.checkBrowserClosed(loginMode);

    // 检查页面是否已关闭
    if (page.isClosed()) {
      throw new Error('浏览器已关闭，操作已取消');
    }

    const statusUrl = `${baseUrl}/api/status`;

    try {
      Logger.info('🏷️ [ChromeManager] 获取系统名称:', statusUrl);

      const data = await this.fetchJsonWithBrowserSession(page, statusUrl, null, loginMode);

      // 多字段尝试
      const result =
        data?.data?.system_name ||
        data?.data?.systemName ||
        data?.data?.site_name ||
        data?.data?.name ||
        data?.system_name ||
        data?.systemName ||
        null;

      if (result) {
        Logger.info('✅ [ChromeManager] 系统名称:', result);
      }

      return result;
    } catch (error: any) {
      Logger.warn('⚠️ [ChromeManager] 获取系统名称失败:', error.message);
      return null;
    }
  }

  /**
   * 清理Chrome进程（内部方法）
   */
  private cleanupChromeProcess(): void {
    const chromeProc = this.chromeProcess;
    if (chromeProc) {
      const pid = chromeProc.pid;
      Logger.info(
        `?? [ChromeManager] Preparing to stop Chrome process${pid ? ' (PID: ' + pid + ')' : ''}`
      );
      this.killProcessTree(chromeProc);
      this.chromeProcess = null;
    }
  }

  /**
   * 终止浏览器进程树：Windows 下 kill() 不保证 GPU/网络服务等子进程退出，
   * 孤儿进程会继续持有 userDataDir 与单例锁，需 taskkill /F /T 兜底
   */
  private killProcessTree(proc: any): void {
    if (!proc) return;
    const pid = proc.pid;
    try {
      proc.kill('SIGTERM');
    } catch (_e) {
      /* ignore */
    }
    if (pid && process.platform === 'win32') {
      try {
        require('child_process').exec(`taskkill /F /T /PID ${pid}`, () => {});
      } catch (_e) {
        /* ignore */
      }
    }
  }
  // ============= 多槽位浏览器管理 =============

  /** 获取隔离槽位的 userDataDir（持久化到 userData，不再依赖可被系统清理的 %TEMP%） */
  private getSlotUserDataDir(slotIndex: number): string {
    return path.join(
      this.getBrowserProfilesRoot(),
      slotIndex === 0 ? 'login' : `slot-${slotIndex}`
    );
  }

  getDefaultLoginProfilePath(): string {
    return this.getSlotUserDataDir(0);
  }

  completeLogin(): void {
    if (this.loginBrowserState) this.loginBrowserState.busy = false;
  }

  /** 自动化 Profile 根目录（槽位与登录浏览器统一存放，跨平台语义一致） */
  private getBrowserProfilesRoot(): string {
    return browserProfileManager.getIsolatedRootDir();
  }

  /** 为指定槽位创建页面（独立浏览器实例） */
  private async createPageForSlot(
    url: string,
    slotIndex: number
  ): Promise<{ page: Page; release: () => void }> {
    const slot = this.getSlot(slotIndex);
    const tag = `[slot-${slotIndex}]`;

    // 如果浏览器已关闭，重置状态
    if (slot.isClosed) {
      if (slot.refCount > 0) {
        Logger.warn(`⚠️ ${tag} 浏览器已关闭但引用计数仍为 ${slot.refCount}，强制重置`);
        slot.refCount = 0;
      }
      slot.isClosed = false;
      if (slot.browser) {
        try {
          slot.browser.removeAllListeners('disconnected');
          slot.browser.disconnect();
        } catch (_e) {
          /* ignore */
        }
        slot.browser = null;
      }
      slot.abortController = new AbortController();
    }

    // 获取引用
    slot.refCount++;
    Logger.info(`📊 ${tag} 引用计数: ${slot.refCount}`);

    // 取消延迟关闭
    if (slot.cleanupTimer) {
      clearTimeout(slot.cleanupTimer);
      slot.cleanupTimer = null;
    }

    // 启动浏览器（如果未启动）
    if (!slot.browser) {
      if (slot.lock) await slot.lock;
      if (!slot.browser) {
        let resolveLock: () => void;
        slot.lock = new Promise(r => {
          resolveLock = r;
        });
        try {
          await this.launchBrowserForSlot(slotIndex, 'about:blank');
        } catch (launchError) {
          // 启动失败时回退引用计数，否则槽位计数永不归零，自动清理失效
          slot.refCount = Math.max(0, slot.refCount - 1);
          throw launchError;
        } finally {
          slot.lock = null;
          resolveLock!();
        }
      }
    }

    if (!slot.browser) {
      slot.refCount--;
      throw new Error(`${tag} 浏览器启动失败`);
    }

    try {
      const page = await slot.browser.newPage();
      (page as any).__slotIndex = slotIndex;
      Logger.info(`📄 ${tag} 创建新页面`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      const release = () => {
        this.releaseSlot(slotIndex);
      };
      return { page, release };
    } catch (error: any) {
      slot.refCount--;
      Logger.error(`❌ ${tag} createPage 失败: ${error.message}`);
      throw error;
    }
  }

  /** 释放槽位引用 */
  private releaseSlot(slotIndex: number): void {
    const slot = this.getSlot(slotIndex);
    const tag = `[slot-${slotIndex}]`;
    if (slot.refCount > 0) {
      slot.refCount--;
      Logger.info(`📊 ${tag} 引用计数: ${slot.refCount}`);
      if (slot.refCount === 0) {
        if (slot.cleanupTimer) clearTimeout(slot.cleanupTimer);
        slot.cleanupTimer = setTimeout(() => {
          if (slot.refCount === 0) {
            Logger.info(`⏰ ${tag} 引用为 0，关闭浏览器`);
            this.cleanupSlot(slotIndex);
          }
        }, 5000);
      }
    }
  }

  /** 启动指定槽位的浏览器 */
  private async launchBrowserForSlot(slotIndex: number, url: string): Promise<void> {
    const slot = this.getSlot(slotIndex);
    const tag = `[slot-${slotIndex}]`;
    const mainOptions =
      slotIndex === 1 ? await browserProfileManager.getMainProfileLaunchOptions() : null;
    if (mainOptions && (!mainOptions.success || !mainOptions.options)) {
      throw new Error(mainOptions.error || '主浏览器 Profile 不可用');
    }
    const userDataDir = mainOptions?.options?.userDataDir || this.getSlotUserDataDir(slotIndex);
    if (this.loginBrowserState?.userDataDir === userDataDir) {
      if (this.loginBrowserState.busy) throw new Error('该浏览器正在登录，请等待登录完成');
      const loginPort = this.loginBrowserState.debugPort;
      this.cleanupLoginBrowser();
      await this.waitForPortFree(loginPort);
    }

    // 清理旧实例
    if (slot.browser) {
      try {
        slot.browser.removeAllListeners('disconnected');
        slot.browser.disconnect();
      } catch (_e) {
        /* ignore */
      }
      slot.browser = null;
    }
    if (slot.chromeProcess) {
      this.killProcessTree(slot.chromeProcess);
      slot.chromeProcess = null;
    }

    const debugPort = await this.pickDebugPort();
    slot.debugPort = debugPort;
    await this.waitForPortFree(debugPort);

    const chromePath = this.getChromePath();
    if (!chromePath || !fs.existsSync(chromePath)) {
      throw new Error(`${tag} 未找到可用的浏览器，无法启动隔离浏览器实例`);
    }
    if (!mainOptions) this.cleanupSessionFiles(userDataDir);

    const { spawn } = require('child_process');
    const args = [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      ...(mainOptions?.options?.profileDirectory
        ? [`--profile-directory=${mainOptions.options.profileDirectory}`]
        : []),
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--disable-features=SessionRestore,InfiniteSessionRestore',
      '--disable-restore-session-state',
      '--noerrdialogs',
      '--disable-infobars',
      url,
    ];

    Logger.info(`🚀 ${tag} 启动浏览器 (port: ${debugPort}, profile: ${userDataDir})`);
    slot.chromeProcess = spawn(chromePath, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    slot.chromeProcess.on('error', (err: any) =>
      Logger.error(`❌ ${tag} Chrome 进程错误:`, err.message)
    );

    await this.waitForPortReady(debugPort);

    slot.browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${debugPort}`,
      protocolTimeout: 60000,
    });
    slot.isClosed = false;
    slot.abortController = new AbortController();

    slot.browser.on('disconnected', () => {
      Logger.info(`⚠️ ${tag} 浏览器已断开`);
      slot.isClosed = true;
      slot.browser = null;
      if (slot.abortController) {
        slot.abortController.abort();
        slot.abortController = null;
      }
    });

    Logger.info(`✅ ${tag} 浏览器启动成功`);
  }

  /** 清理指定槽位 */
  private cleanupSlot(slotIndex: number): void {
    const slot = this.getSlot(slotIndex);
    const tag = `[slot-${slotIndex}]`;

    if (slot.refCount > 0) {
      Logger.warn(`⚠️ ${tag} 浏览器正在使用中（引用: ${slot.refCount}），跳过清理`);
      return;
    }

    Logger.info(`🧹 ${tag} 清理浏览器资源`);
    slot.isClosed = true;
    if (slot.abortController) {
      slot.abortController.abort();
      slot.abortController = null;
    }
    if (slot.cleanupTimer) {
      clearTimeout(slot.cleanupTimer);
      slot.cleanupTimer = null;
    }

    if (slot.browser) {
      try {
        slot.browser.removeAllListeners('disconnected');
        slot.browser.close().catch(() => {});
      } catch (_e) {
        /* ignore */
      }
      slot.browser = null;
    }
    if (slot.chromeProcess) {
      this.killProcessTree(slot.chromeProcess);
      slot.chromeProcess = null;
    }
  }
  cleanup() {
    Logger.info('🧹 [ChromeManager] 开始清理所有浏览器槽位...');
    // 登录/签到浏览器使用中（用户正在窗口里登录或完成签到）时不得连带终止
    if (this.loginBrowserState?.busy) {
      Logger.info('⏭️ [ChromeManager] 登录/签到浏览器使用中，跳过清理');
    } else {
      this.cleanupLoginBrowser();
    }
    for (const [index] of this.slots) {
      this.cleanupSlot(index);
    }
    Logger.info('✅ [ChromeManager] 所有槽位清理完成');
  }

  forceCleanup() {
    Logger.info('🔧 [ChromeManager] 强制清理所有浏览器槽位');
    this.cleanupLoginBrowser();
    for (const [index, slot] of this.slots) {
      if (slot.refCount > 0) {
        Logger.warn(`⚠️ [slot-${index}] 强制重置引用计数 ${slot.refCount} → 0`);
        slot.refCount = 0;
      }
      this.cleanupSlot(index);
    }
  }

  /**
   * 使用指定 Profile 直接打开站点页面
   * 不接入自动化浏览器池，仅负责启动外部 Chromium 浏览器
   */
  async openSiteWithProfile(
    url: string,
    options?: { userDataDir?: string; profileDirectory?: string; closeAfterMs?: number }
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const chromePath = this.getChromePath();
      if (!chromePath || !fs.existsSync(chromePath)) {
        throw new Error(`浏览器可执行文件不存在: ${chromePath}`);
      }

      const { spawn } = require('child_process');
      const args = [
        ...(options?.userDataDir ? [`--user-data-dir=${options.userDataDir}`] : []),
        ...(options?.profileDirectory ? [`--profile-directory=${options.profileDirectory}`] : []),
        '--no-first-run',
        '--no-default-browser-check',
        url,
      ];
      const closeAfterMs = options?.closeAfterMs;

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(chromePath, args, {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });

        proc.once('error', (error: Error) => {
          reject(error);
        });

        proc.once('spawn', () => {
          proc.unref();
          if (!closeAfterMs || closeAfterMs <= 0) {
            resolve();
            return;
          }

          setTimeout(() => {
            try {
              proc.kill();
            } catch (_e) {
              /* ignore */
            }

            const pid = proc.pid;
            if (pid && process.platform === 'win32') {
              try {
                require('child_process').exec(`taskkill /F /T /PID ${pid}`, () => {});
              } catch (_e) {
                /* ignore */
              }
            }

            resolve();
          }, closeAfterMs);
        });
      });

      return {
        success: true,
        message: closeAfterMs ? '已完成站点签到浏览器流程' : '已使用账户对应浏览器打开站点',
      };
    } catch (error: any) {
      Logger.error('❌ [ChromeManager] 使用 Profile 打开站点失败:', error?.message || error);
      return {
        success: false,
        error: error?.message || '打开站点失败',
      };
    }
  }

  /**
   * 解析当前生效的浏览器路径（供运行检查等外部流程使用）
   */
  getResolvedBrowserPath(): string | null {
    return this.getChromePath();
  }

  /**
   * 获取Chrome可执行文件路径
   * 解析顺序：环境变量显式覆盖 → settings.browser_path → 打包内置 Chromium → 本机已装 Chromium 系浏览器
   * 全部缺失时返回 null（由调用方给出可读错误，不再返回可能不存在的硬编码路径）
   */
  private getChromePath(): string | null {
    return browserPath.getChromePath();
  }

  /**
   * 获取 Windows 下系统默认浏览器的可执行文件路径
   * 仅用于在 getChromePath 中作为优先候选（且仅当其为 Chromium 内核时才会被使用）
   */
  private getSystemDefaultBrowserPathWin(): string | null {
    return browserPath.getSystemDefaultBrowserPathWin();
  }
}
