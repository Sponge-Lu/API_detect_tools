/**
 * 输入: Puppeteer (浏览器自动化), Electron app (应用路径), Logger (日志记录)
 * 输出: Browser 实例, Page 实例, LocalStorageData, 自动登录结果
 * 定位: 基础设施层 - 管理 Chrome 浏览器自动化，处理自动登录和数据提取
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { app } from 'electron';
import Logger from './utils/logger';

/**
 * localStorage数据结构
 */
interface LocalStorageData {
  userId: number | null;
  username: string | null;
  systemName: string | null;
  accessToken: string | null;
  supportsCheckIn?: boolean; // 站点是否支持签到
  canCheckIn?: boolean; // 当前是否可签到
}

export class ChromeManager {
  private browser: Browser | null = null;
  private chromeProcess: any = null;
  private debugPort = 0;
  private browserRefCount: number = 0; // 浏览器引用计数
  private browserLock: Promise<void> | null = null; // 浏览器启动锁，防止并发启动
  private cleanupTimer: NodeJS.Timeout | null = null; // 延迟关闭定时器
  private isBrowserClosed: boolean = false; // 浏览器是否已关闭标志
  private abortController: AbortController | null = null; // 用于取消正在进行的操作

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
        this.cleanupTimer = setTimeout(() => {
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
   * @returns 包含页面和释放函数的对象
   */
  async createPage(url: string): Promise<{ page: Page; release: () => void }> {
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

    // 获取浏览器引用（增加引用计数）
    const release = await this.acquireBrowser();

    try {
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
          // 替换释放函数
          const oldRelease = release;
          return {
            page: await this.createPageInternal(url),
            release: () => {
              newRelease();
              oldRelease();
            },
          };
        }
      }

      if (!this.browser) {
        throw new Error('浏览器启动失败');
      }

      const page = await this.createPageInternal(url);

      return { page, release };
    } catch (error: any) {
      // 如果创建失败，释放引用
      release();
      Logger.error('❌ [ChromeManager] createPage失败:', error.message);

      // 如果创建页面失败，清理并重试一次
      if (
        error.message.includes('Target.createTarget timed out') ||
        error.message.includes('Session closed') ||
        error.message.includes('Connection closed') ||
        error.message.includes('Protocol error')
      ) {
        Logger.info('⚠️ [ChromeManager] 浏览器连接异常，清理并重试...');

        // 只有在引用计数为0时才清理
        if (this.browserRefCount === 0) {
          this.cleanup();
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 只重试一次，避免无限循环
        if (!error.retried) {
          Logger.info('🔄 [ChromeManager] 重试创建页面...');
          const retryError = new Error(error.message) as any;
          retryError.retried = true;
          // 重新获取引用并重试
          const retryRelease = await this.acquireBrowser();
          try {
            const page = await this.createPageInternal(url);
            return { page, release: retryRelease };
          } catch (retryError) {
            retryRelease();
            throw retryError;
          }
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
   */
  private async launchBrowser(url: string): Promise<void> {
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
    const userDataDir = path.join(os.tmpdir(), 'api-detector-chrome');

    // 2.5 清理会话恢复相关文件，防止打开历史页面
    this.cleanupSessionFiles(userDataDir);

    // 3. 启动Chrome进程 - 使用spawn而不是exec，并设置正确的编码
    const { spawn } = require('child_process');

    Logger.info(`📝 [ChromeManager] Chrome路径: ${chromePath}`);

    // 使用spawn避免命令解析问题，并设置编码
    const args = [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
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
  private async waitForPortReady(port: number, maxWait: number = 5000): Promise<void> {
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
   * @returns 启动结果
   */
  async launchForLogin(url: string): Promise<{ success: boolean; message: string }> {
    try {
      Logger.info('🚀 [ChromeManager] 启动浏览器供用户登录...');

      // 使用统一的启动流程
      await this.launchBrowser(url);

      return { success: true, message: '浏览器已启动，请在浏览器中完成登录' };
    } catch (error: any) {
      Logger.error('❌ [ChromeManager] 启动浏览器失败:', error.message);
      return { success: false, message: `启动失败: ${error.message}` };
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
    onStatus?: (status: string) => void
  ): Promise<LocalStorageData> {
    // 检查浏览器是否已关闭
    this.checkBrowserClosed();

    if (!this.browser) {
      throw new Error('浏览器未启动');
    }

    const pages = await this.browser.pages();
    if (pages.length === 0) {
      throw new Error('没有打开的页面');
    }

    const page = pages[0];

    // 等待页面稳定并读取 localStorage（处理重定向、Cloudflare 验证等）
    onStatus?.('等待页面加载...');
    let localData = await this.waitAndReadLocalStorage(page, url, onStatus);

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
        this.checkBrowserClosed(); // 检查浏览器状态
        const apiData = await this.getUserDataFromApi(page, url);
        if (apiData.userId) {
          Logger.info(`✅ [ChromeManager] 通过API检测到用户已登录！用户ID: ${apiData.userId}`);
          // 合并数据，API数据优先
          localData = { ...localData, ...apiData };
        } else {
          // API也没有数据，进入等待循环
          onStatus?.('未检测到登录，请在浏览器中登录账号...');
          localData = await this.waitForUserLogin(page, url, maxWaitTime, onStatus);
        }
      } catch (apiError: any) {
        // 如果是浏览器关闭错误，直接抛出
        if (
          apiError.message.includes('浏览器已关闭') ||
          apiError.message.includes('操作已被取消')
        ) {
          throw apiError;
        }
        Logger.info(`ℹ️ [ChromeManager] API验证失败: ${apiError.message}，进入等待循环...`);
        // API失败（可能401/403），进入等待循环
        onStatus?.('登录状态无效，请在浏览器中登录账号...');
        localData = await this.waitForUserLogin(page, url, maxWaitTime, onStatus);
      }

      Logger.info('✅ [ChromeManager] 用户已登录，继续获取数据');
      Logger.info('📊 [ChromeManager] 登录后数据:');
      Logger.info('   - userId:', localData.userId);
      Logger.info('   - username:', localData.username || '未获取');
      Logger.info('   - accessToken:', localData.accessToken ? '已获取' : '未获取');
    }

    // 第二步：检查是否需要API回退（没有 accessToken 说明需要验证登录状态）
    const needsApiFallback = !localData.userId || !localData.accessToken;

    if (needsApiFallback) {
      Logger.info('⚠️ [ChromeManager] 信息不完整，尝试通过API补全...');
      try {
        this.checkBrowserClosed(); // 检查浏览器状态
        const apiData = await this.getUserDataFromApi(page, url);
        // 合并数据，localStorage优先
        const merged = { ...apiData, ...localData };
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
        Logger.error('❌ [ChromeManager] API补全失败:', apiError.message);

        // 如果 API 返回 401 或其他认证错误，说明 session 过期，需要重新登录
        const isAuthError =
          apiError.message.includes('401') ||
          apiError.message.includes('403') ||
          apiError.message.includes('Execution context was destroyed');

        if (isAuthError && waitForLogin) {
          Logger.info('🔄 [ChromeManager] 检测到登录状态无效，等待用户重新登录...');
          onStatus?.('登录状态已过期，请在浏览器中重新登录...');
          localData = await this.waitForUserLogin(page, url, maxWaitTime, onStatus);
          return localData;
        }

        if (!localData.userId) {
          throw new Error('未找到用户ID，请确保已登录');
        }
      }
    }

    // 最后检查一次浏览器状态
    this.checkBrowserClosed();

    return localData;
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
   * @throws 如果浏览器已关闭，抛出错误
   */
  private checkBrowserClosed(): void {
    if (this.isBrowserClosed) {
      throw new Error('浏览器已关闭，操作已取消');
    }

    // 检查 AbortController 信号
    if (this.abortController?.signal.aborted) {
      throw new Error('操作已被取消（浏览器已关闭）');
    }
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
    page: Page,
    baseUrl: string,
    maxWaitTime: number,
    onStatus?: (status: string) => void
  ): Promise<LocalStorageData> {
    const startTime = Date.now();
    const checkInterval = 2000; // 每2秒检查一次
    let checkCount = 0;
    const apiCheckInterval = 5; // 每5次检查（10秒）尝试一次API回退

    while (Date.now() - startTime < maxWaitTime) {
      // 检查浏览器是否已关闭
      this.checkBrowserClosed();

      // 等待一段时间再检查（使用可中断的等待）
      await this.sleepWithAbort(checkInterval);

      // 再次检查（可能在等待期间浏览器关闭了）
      this.checkBrowserClosed();

      checkCount++;
      const elapsedTime = Math.floor((Date.now() - startTime) / 1000);
      Logger.info(
        `⏳ [ChromeManager] 等待登录中... (${elapsedTime}/${Math.floor(maxWaitTime / 1000)}秒)`
      );
      onStatus?.(`等待登录中... (${elapsedTime}s)`);

      // 检查localStorage
      try {
        const localData = await this.tryGetFromLocalStorage(page);

        // 如果有 userId 且有 accessToken，说明登录有效
        if (localData.userId && localData.accessToken) {
          Logger.info(`✅ [ChromeManager] 检测到用户登录！用户ID: ${localData.userId}`);
          return localData;
        }

        // 如果有 userId 但没有 accessToken，需要通过 API 验证登录状态
        if (localData.userId && !localData.accessToken) {
          Logger.info('🔄 [ChromeManager] 检测到userId但无accessToken，验证登录状态...');
          try {
            this.checkBrowserClosed();
            const apiData = await this.getUserDataFromApi(page, baseUrl);
            if (apiData.userId) {
              Logger.info(`✅ [ChromeManager] 登录状态有效！用户ID: ${apiData.userId}`);
              return { ...localData, ...apiData };
            }
          } catch (apiError: any) {
            if (
              apiError.message.includes('浏览器已关闭') ||
              apiError.message.includes('操作已被取消')
            ) {
              throw apiError;
            }
            // API 返回 401 等错误，说明 session 过期，继续等待
            Logger.info(
              'ℹ️ [ChromeManager] localStorage有残留数据但session已过期，继续等待登录...'
            );
          }
        }

        // 定期尝试API回退（每10秒尝试一次）
        if (checkCount % apiCheckInterval === 0) {
          Logger.info('🔄 [ChromeManager] 尝试通过API检查登录状态...');
          try {
            this.checkBrowserClosed(); // 在API调用前检查
            const apiData = await this.getUserDataFromApi(page, baseUrl);
            if (apiData.userId) {
              Logger.info(`✅ [ChromeManager] 通过API检测到用户登录！用户ID: ${apiData.userId}`);
              // 合并数据，API数据优先（因为localStorage可能没有）
              return { ...localData, ...apiData };
            }
          } catch (apiError: any) {
            // 如果是浏览器关闭错误，直接抛出
            if (
              apiError.message.includes('浏览器已关闭') ||
              apiError.message.includes('操作已被取消')
            ) {
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
        Logger.warn('⚠️ [ChromeManager] 检查登录状态时出错:', error.message);
        // 继续等待
      }
    }

    // 超时前，最后尝试一次API回退
    this.checkBrowserClosed(); // 检查浏览器是否已关闭

    Logger.info('⏰ [ChromeManager] 等待超时，最后尝试API回退...');
    try {
      const apiData = await this.getUserDataFromApi(page, baseUrl);
      if (apiData.userId) {
        Logger.info(`✅ [ChromeManager] 通过API检测到用户登录！用户ID: ${apiData.userId}`);
        const localData = await this.tryGetFromLocalStorage(page);
        return { ...localData, ...apiData };
      }
    } catch (apiError: any) {
      // 如果是浏览器关闭错误，直接抛出
      if (apiError.message.includes('浏览器已关闭') || apiError.message.includes('操作已被取消')) {
        throw apiError;
      }
      Logger.info(`ℹ️ [ChromeManager] 最后API检查也失败: ${apiError.message}`);
    }

    // 最后检查一次浏览器状态
    this.checkBrowserClosed();

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
    onStatus?: (status: string) => void
  ): Promise<LocalStorageData> {
    const maxRetries = 10;
    const retryDelay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.checkBrowserClosed();

      try {
        // 检查页面 URL，确保在目标域名上
        const currentUrl = page.url();
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
          await this.sleepWithAbort(retryDelay);
          continue;
        }

        // 等待页面网络空闲
        await page.waitForNetworkIdle({ timeout: 3000 }).catch(() => {});

        // 短暂等待让页面稳定
        await this.sleepWithAbort(500);

        // 尝试读取 localStorage
        Logger.info('🔍 [ChromeManager] 尝试读取 localStorage...');
        const localData = await this.tryGetFromLocalStorage(page);

        Logger.info('📊 [ChromeManager] localStorage数据:');
        Logger.info('   - userId:', localData.userId || '缺失');
        Logger.info('   - username:', localData.username || '缺失');
        Logger.info('   - systemName:', localData.systemName || '缺失');
        Logger.info('   - accessToken:', localData.accessToken ? '已获取' : '缺失');
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
          await this.sleepWithAbort(retryDelay);
          continue;
        }

        // 其他错误，记录并重试
        Logger.warn(
          `⚠️ [ChromeManager] 读取 localStorage 失败 (${attempt}/${maxRetries}):`,
          error.message
        );
        if (attempt < maxRetries) {
          await this.sleepWithAbort(retryDelay);
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
   * @param ms 等待时间（毫秒）
   */
  private async sleepWithAbort(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve();
      }, ms);

      // 监听 AbortSignal
      if (this.abortController) {
        this.abortController.signal.addEventListener(
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
    return await page.evaluate(() => {
      const data: LocalStorageData = {
        userId: null,
        username: null,
        systemName: null,
        accessToken: null,
      };

      const logParseError = (key: string, error: unknown) => {
        console.debug(`[Browser Context] Failed to parse ${key} JSON`, error);
      };

      try {
        const storage = (globalThis as any).localStorage;

        // ===== User ID 多路径获取 =====
        // 路径1: 从user对象获取
        const userStr = storage.getItem('user');
        if (userStr) {
          try {
            const user = JSON.parse(userStr);
            data.userId = user.id || user.user_id || user.userId || user.uid || user.user_ID;
          } catch (error) {
            logParseError('user', error);
          }
        }

        // 路径2: 从siteInfo对象获取
        const siteInfoStr = storage.getItem('siteInfo');
        if (siteInfoStr) {
          try {
            const siteInfo = JSON.parse(siteInfoStr);
            data.userId =
              data.userId || siteInfo.id || siteInfo.user_id || siteInfo.userId || siteInfo.uid;
          } catch (error) {
            logParseError('siteInfo', error);
          }
        }

        // 路径3: 从userInfo对象获取
        const userInfoStr = storage.getItem('userInfo');
        if (userInfoStr) {
          try {
            const userInfo = JSON.parse(userInfoStr);
            data.userId = data.userId || userInfo.id || userInfo.user_id || userInfo.userId;
          } catch (error) {
            logParseError('userInfo', error);
          }
        }

        // 路径4: 从独立键获取
        if (!data.userId) {
          const idStr =
            storage.getItem('user_id') ||
            storage.getItem('userId') ||
            storage.getItem('uid') ||
            storage.getItem('id');
          if (idStr) {
            const parsed = parseInt(idStr);
            if (!isNaN(parsed)) data.userId = parsed;
          }
        }

        // ===== Username 多路径获取 =====
        // 从user对象
        if (userStr) {
          try {
            const user = JSON.parse(userStr);
            data.username =
              user.username ||
              user.name ||
              user.display_name ||
              user.displayName ||
              user.nickname ||
              user.login;
          } catch (error) {
            logParseError('user', error);
          }
        }

        // 从siteInfo对象
        if (siteInfoStr) {
          try {
            const siteInfo = JSON.parse(siteInfoStr);
            data.username =
              data.username ||
              siteInfo.username ||
              siteInfo.name ||
              siteInfo.display_name ||
              siteInfo.user_name;
          } catch (error) {
            logParseError('siteInfo', error);
          }
        }

        // 从userInfo对象
        if (userInfoStr) {
          try {
            const userInfo = JSON.parse(userInfoStr);
            data.username = data.username || userInfo.username || userInfo.name;
          } catch (error) {
            logParseError('userInfo', error);
          }
        }

        // 从独立键
        data.username =
          data.username ||
          storage.getItem('username') ||
          storage.getItem('user_name') ||
          storage.getItem('nickname');

        // ===== System Name 多路径获取 =====
        // 从siteInfo对象
        if (siteInfoStr) {
          try {
            const siteInfo = JSON.parse(siteInfoStr);
            data.systemName =
              siteInfo.system_name ||
              siteInfo.systemName ||
              siteInfo.site_name ||
              siteInfo.siteName ||
              siteInfo.name;
          } catch (error) {
            logParseError('siteInfo', error);
          }
        }

        // 从config对象
        const configStr = storage.getItem('config') || storage.getItem('siteConfig');
        if (configStr) {
          try {
            const config = JSON.parse(configStr);
            data.systemName =
              data.systemName ||
              config.system_name ||
              config.systemName ||
              config.site_name ||
              config.name;
          } catch (error) {
            logParseError('config', error);
          }
        }

        // 从独立键
        data.systemName =
          data.systemName ||
          storage.getItem('system_name') ||
          storage.getItem('systemName') ||
          storage.getItem('site_name') ||
          storage.getItem('siteName') ||
          storage.getItem('app_name');

        // ===== Access Token 多路径获取 =====
        // 从user对象
        if (userStr) {
          try {
            const user = JSON.parse(userStr);
            data.accessToken =
              user.access_token ||
              user.accessToken ||
              user.token ||
              user.auth_token ||
              user.authToken ||
              user.api_token;
          } catch (error) {
            logParseError('user', error);
          }
        }

        // 从siteInfo对象
        if (siteInfoStr) {
          try {
            const siteInfo = JSON.parse(siteInfoStr);
            data.accessToken =
              data.accessToken || siteInfo.access_token || siteInfo.accessToken || siteInfo.token;
          } catch (error) {
            logParseError('siteInfo', error);
          }
        }

        // 从auth对象
        const authStr = storage.getItem('auth') || storage.getItem('authentication');
        if (authStr) {
          try {
            const auth = JSON.parse(authStr);
            data.accessToken = data.accessToken || auth.access_token || auth.token;
          } catch (error) {
            logParseError('auth', error);
          }
        }

        // 从独立键
        data.accessToken =
          data.accessToken ||
          storage.getItem('access_token') ||
          storage.getItem('accessToken') ||
          storage.getItem('token') ||
          storage.getItem('auth_token') ||
          storage.getItem('authToken') ||
          storage.getItem('api_token') ||
          storage.getItem('apiToken') ||
          storage.getItem('bearer_token');

        // ===== 签到信息多路径获取 =====
        // 从siteInfo对象获取签到支持状态
        if (siteInfoStr) {
          try {
            const siteInfo = JSON.parse(siteInfoStr);
            // 站点是否支持签到（从 /api/status 的 check_in_enabled）
            if (typeof siteInfo.check_in_enabled === 'boolean') {
              data.supportsCheckIn = siteInfo.check_in_enabled;
            }
          } catch (error) {
            logParseError('siteInfo', error);
          }
        }

        // 从user对象获取当前签到状态
        if (userStr) {
          try {
            const user = JSON.parse(userStr);
            // 当前是否可签到（从 /api/user/check_in_status 的 can_check_in）
            if (typeof user.can_check_in === 'boolean') {
              data.canCheckIn = user.can_check_in;
            }
          } catch (error) {
            logParseError('user', error);
          }
        }

        // 从status对象获取
        const statusStr = storage.getItem('status') || storage.getItem('siteStatus');
        if (statusStr) {
          try {
            const status = JSON.parse(statusStr);
            data.supportsCheckIn = data.supportsCheckIn ?? status.check_in_enabled;
          } catch (error) {
            logParseError('status', error);
          }
        }

        // 从checkIn对象获取
        const checkInStr = storage.getItem('checkIn') || storage.getItem('check_in');
        if (checkInStr) {
          try {
            const checkIn = JSON.parse(checkInStr);
            data.canCheckIn = data.canCheckIn ?? checkIn.can_check_in;
            data.supportsCheckIn = data.supportsCheckIn ?? checkIn.enabled;
          } catch (error) {
            logParseError('checkIn', error);
          }
        }
      } catch (error) {
        console.error('[Browser Context] Failed to read localStorage:', error);
      }

      return data;
    });
  }

  /**
   * 通过Cookie调用API获取用户数据（回退机制）
   * 多路径策略：尝试多个API端点
   * @param page 浏览器页面
   * @param baseUrl 站点URL
   * @returns 用户数据
   */
  private async getUserDataFromApi(page: any, baseUrl: string): Promise<LocalStorageData> {
    // 检查浏览器是否已关闭
    this.checkBrowserClosed();

    // 检查页面是否已关闭
    if (page.isClosed()) {
      throw new Error('浏览器已关闭，操作已取消');
    }

    const cleanBaseUrl = baseUrl.replace(/\/$/, '');

    // 多个API端点尝试
    const endpoints = [
      '/api/user/self', // 最常见（所有站点）
      '/api/user/dashboard', // One Hub, Done Hub (包含更多信息)
      '/api/user', // 某些简化站点
    ];

    let lastError: any = null;

    for (const endpoint of endpoints) {
      // 在每次循环前检查浏览器状态
      this.checkBrowserClosed();
      if (page.isClosed()) {
        throw new Error('浏览器已关闭，操作已取消');
      }

      const apiUrl = `${cleanBaseUrl}${endpoint}`;

      try {
        Logger.info(`📡 [ChromeManager] 尝试API: ${apiUrl}`);

        const result = await page.evaluate(async (url: string) => {
          try {
            const s = (globalThis as any).localStorage;
            const parseJSON = (str: string | null) => {
              try {
                return str ? JSON.parse(str) : null;
              } catch {
                return null;
              }
            };
            const user = parseJSON(s.getItem('user')) || {};
            const siteInfo = parseJSON(s.getItem('siteInfo')) || {};
            const userInfo = parseJSON(s.getItem('userInfo')) || {};
            const uid =
              (user.id ??
                user.user_id ??
                user.userId ??
                user.uid ??
                user.user_ID ??
                siteInfo.id ??
                siteInfo.user_id ??
                siteInfo.userId ??
                siteInfo.uid ??
                userInfo.id ??
                userInfo.user_id ??
                userInfo.userId ??
                s.getItem('user_id') ??
                s.getItem('userId') ??
                s.getItem('uid') ??
                s.getItem('id')) ||
              null;

            const response = await fetch(url, {
              method: 'GET',
              credentials: 'include', // 携带Cookie
              headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
                Pragma: 'no-cache',
                ...(uid
                  ? {
                      'New-API-User': String(uid),
                      'Veloera-User': String(uid),
                      'voapi-user': String(uid),
                      'User-id': String(uid),
                    }
                  : {}),
              },
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            const data = (await response.json()) as any;

            // 兼容多种响应格式
            let userData: any = null;
            if (data.success && data.data) {
              userData = data.data;
            } else if (data.data) {
              userData = data.data;
            } else if (data.id || data.user_id) {
              userData = data;
            }

            if (!userData) {
              throw new Error('响应格式不正确');
            }

            return {
              // User ID 多字段尝试
              userId:
                userData.id ||
                userData.user_id ||
                userData.userId ||
                userData.uid ||
                userData.user_ID ||
                null,
              // Username 多字段尝试
              username:
                userData.username ||
                userData.name ||
                userData.display_name ||
                userData.displayName ||
                userData.nickname ||
                userData.login ||
                userData.user_name ||
                null,
              // Access Token 多字段尝试
              accessToken:
                userData.access_token ||
                userData.accessToken ||
                userData.token ||
                userData.auth_token ||
                userData.authToken ||
                userData.api_token ||
                userData.bearer_token ||
                null,
              // System Name - 暂不从此接口获取，后续单独获取
              systemName: null,
            };
          } catch (error: any) {
            throw new Error(error.message || '请求失败');
          }
        }, apiUrl);

        Logger.info('📊 [ChromeManager] API返回数据:');
        Logger.info('   - userId:', result.userId);
        Logger.info('   - username:', result.username);
        Logger.info('   - accessToken:', result.accessToken ? '已获取' : '未找到');

        // 如果成功获取到userId，返回结果
        if (result.userId) {
          // 再次检查浏览器状态
          this.checkBrowserClosed();
          if (page.isClosed()) {
            throw new Error('浏览器已关闭，操作已取消');
          }

          // 尝试获取system_name
          try {
            const systemName = await this.getSystemNameFromApi(page, cleanBaseUrl);
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

  /**
   * 从/api/status接口获取系统名称
   * @param page 浏览器页面
   * @param baseUrl 站点URL
   * @returns 系统名称
   */
  private async getSystemNameFromApi(page: any, baseUrl: string): Promise<string | null> {
    // 检查浏览器是否已关闭
    this.checkBrowserClosed();

    // 检查页面是否已关闭
    if (page.isClosed()) {
      throw new Error('浏览器已关闭，操作已取消');
    }

    const statusUrl = `${baseUrl}/api/status`;

    try {
      Logger.info('🏷️ [ChromeManager] 获取系统名称:', statusUrl);

      const result = await page.evaluate(async (url: string) => {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) return null;

        const data = (await response.json()) as any;

        // 多字段尝试
        return (
          data?.data?.system_name ||
          data?.data?.systemName ||
          data?.data?.site_name ||
          data?.data?.name ||
          data?.system_name ||
          data?.systemName ||
          null
        );
      }, statusUrl);

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
    if (this.chromeProcess) {
      const chromeProc = this.chromeProcess;
      try {
        const pid = chromeProc.pid;
        Logger.info(
          `?? [ChromeManager] Preparing to stop Chrome process${pid ? ' (PID: ' + pid + ')' : ''}`
        );
        try {
          chromeProc.kill('SIGTERM');
        } catch (e) {
          Logger.warn('?? [ChromeManager] Failed to send SIGTERM, will try SIGKILL');
        }
        setTimeout(() => {
          try {
            if (!chromeProc.killed) {
              chromeProc.kill('SIGKILL');
              Logger.info('? [ChromeManager] Sent SIGKILL to Chrome process');
            }
          } catch (err) {
            Logger.warn('?? [ChromeManager] Force kill Chrome failed:', err);
          }
        }, 500);
      } catch (e) {
        Logger.warn('?? [ChromeManager] Stop Chrome process failed:', e);
      }
      this.chromeProcess = null;
    }
  }
  /**
   * ???????????????????????????????????
   * ???????????????????????????????????????
   */
  private killBrowserByPort(): void {
    Logger.info(
      '?? [ChromeManager] Skip killing processes by port to avoid terminating external browsers'
    );
  }
  cleanup() {
    // 检查引用计数
    if (this.browserRefCount > 0) {
      Logger.warn(
        `⚠️ [ChromeManager] 浏览器正在使用中（引用计数: ${this.browserRefCount}），跳过清理`
      );
      return;
    }

    Logger.info('🧹 [ChromeManager] 开始清理浏览器资源...');

    // 标记浏览器已关闭
    this.isBrowserClosed = true;

    // 取消所有正在进行的操作
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // 清除延迟关闭定时器
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.browser) {
      try {
        // 移除事件监听器，避免重复触发
        this.browser.removeAllListeners('disconnected');
        // 尝试正常关闭浏览器（通过 DevTools Protocol）
        this.browser.close().catch(() => {});
        Logger.info('✅ [ChromeManager] 浏览器已关闭');
      } catch (e) {
        Logger.warn('⚠️ [ChromeManager] 关闭浏览器失败:', e);
      }
      this.browser = null;
    }

    // 清理Chrome进程（通过端口查找）

    Logger.info('✅ [ChromeManager] 资源清理完成');
  }

  /**
   * 强制清理浏览器资源（忽略引用计数）
   * 用于检测完成后确保浏览器被关闭
   */
  forceCleanup() {
    Logger.info(`🔧 [ChromeManager] 强制清理浏览器资源（当前引用计数: ${this.browserRefCount}）`);

    // 重置引用计数
    if (this.browserRefCount > 0) {
      Logger.warn(`⚠️ [ChromeManager] 强制重置引用计数从 ${this.browserRefCount} 到 0`);
      this.browserRefCount = 0;
    }

    // 调用正常清理逻辑
    this.cleanup();
  }

  /**
   * 获取Chrome可执行文件路径
   */
  private getChromePath(): string {
    const platform = process.platform;

    /**
     * 1. 优先读取环境变量中的自定义路径
     *    - CHROME_PATH / BROWSER_PATH
     */
    const envPath = process.env.CHROME_PATH || process.env.BROWSER_PATH;
    if (envPath && fs.existsSync(envPath)) {
      Logger.info(`🔍 [ChromeManager] 使用环境变量中的浏览器路径: ${envPath}`);
      return envPath;
    }

    /**
     * 2. 从配置文件中读取自定义浏览器路径（settings.browser_path）
     *    用于支持用户指定的便携版 Chrome / Edge / 其他 Chromium 浏览器
     */
    try {
      const userDataPath = app.getPath('userData');
      const configPath = path.join(userDataPath, 'config.json');
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(raw);
        const customPath: string | undefined =
          config?.settings?.browser_path ||
          config?.settings?.chrome_path ||
          config?.settings?.chromium_path;

        if (customPath && typeof customPath === 'string' && fs.existsSync(customPath)) {
          Logger.info(`🔍 [ChromeManager] 使用配置文件中的浏览器路径: ${customPath}`);
          return customPath;
        } else if (customPath) {
          Logger.warn(`⚠️ [ChromeManager] 配置文件中的浏览器路径不存在: ${customPath}`);
        }
      }
    } catch (e: any) {
      Logger.warn('⚠️ [ChromeManager] 读取配置文件中的浏览器路径失败:', e?.message || e);
    }

    /**
     * 3. 根据平台自动检测常见的 Chromium 内核浏览器
     *    - 优先尝试“系统默认浏览器”（仅在其为 Chromium 内核时）
     *    - Windows: Chrome / Edge / 便携版 Chrome
     *    - macOS: Chrome / Edge
     *    - Linux: 常见的 google-chrome / chromium 安装路径
     */
    if (platform === 'win32') {
      // 3.1 Windows: 优先尝试系统默认浏览器（如果是 Chromium 内核）
      const defaultBrowserPath = this.getSystemDefaultBrowserPathWin();
      if (defaultBrowserPath && fs.existsSync(defaultBrowserPath)) {
        const exeName = path.basename(defaultBrowserPath).toLowerCase();
        const chromiumLike = [
          'chrome.exe',
          'msedge.exe',
          'chromium.exe',
          'brave.exe',
          'vivaldi.exe',
          'opera.exe',
        ];
        if (chromiumLike.includes(exeName)) {
          Logger.info(
            `🔍 [ChromeManager] 使用系统默认浏览器 (Chromium 内核): ${defaultBrowserPath}`
          );
          return defaultBrowserPath;
        } else {
          Logger.warn(
            `⚠️ [ChromeManager] 系统默认浏览器不是 Chromium 内核 (${defaultBrowserPath})，跳过该路径`
          );
        }
      }

      // 3.2 回退到内置候选列表
      const candidates = new Set<string>();
      const username =
        process.env.USERNAME ||
        (process.env.USERPROFILE ? path.basename(process.env.USERPROFILE) : '');

      // ===== 系统安装的 Chrome =====
      candidates.add('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
      candidates.add('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
      if (username) {
        candidates.add(
          `C:\\Users\\${username}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`
        );
      }

      // ===== 系统安装的 Microsoft Edge =====
      candidates.add('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe');
      candidates.add('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
      if (username) {
        candidates.add(
          `C:\\Users\\${username}\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe`
        );
      }

      // ===== 当前应用目录附近的便携版 Chrome / Edge =====
      const execDir = path.dirname(process.execPath);
      const portableCandidates = [
        path.join(execDir, 'chrome.exe'),
        path.join(execDir, 'Chrome', 'chrome.exe'),
        path.join(execDir, 'Chrome', 'Application', 'chrome.exe'),
        path.join(execDir, 'Chromium', 'chrome.exe'),
        path.join(execDir, 'ChromePortable', 'App', 'Chrome-bin', 'chrome.exe'),
        path.join(execDir, 'msedge.exe'),
      ];
      portableCandidates.forEach(p => candidates.add(p));

      for (const browserPath of candidates) {
        if (fs.existsSync(browserPath)) {
          Logger.info(`🔍 [ChromeManager] 自动检测到浏览器路径: ${browserPath}`);
          return browserPath;
        }
      }

      // 如果都不存在，返回最常见的 Chrome 路径以保持兼容（后续启动失败会有更详细错误）
      const fallback = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
      Logger.warn('⚠️ [ChromeManager] 未能自动检测到浏览器，使用默认路径:', fallback);
      return fallback;
    } else if (platform === 'darwin') {
      // macOS: 优先 Chrome，其次 Edge
      const macCandidates = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ];

      for (const browserPath of macCandidates) {
        if (fs.existsSync(browserPath)) {
          Logger.info(`🔍 [ChromeManager] 自动检测到浏览器路径: ${browserPath}`);
          return browserPath;
        }
      }

      Logger.warn('⚠️ [ChromeManager] 未找到 Chrome/Edge，使用默认 Chrome 路径');
      return macCandidates[0];
    } else {
      // Linux: 常见的 chrome / chromium 安装路径
      const linuxCandidates = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
      ];

      for (const browserPath of linuxCandidates) {
        if (fs.existsSync(browserPath)) {
          Logger.info(`🔍 [ChromeManager] 自动检测到浏览器路径: ${browserPath}`);
          return browserPath;
        }
      }

      Logger.warn(
        '⚠️ [ChromeManager] 未找到常见的 Chromium 浏览器，使用默认路径 /usr/bin/google-chrome'
      );
      return '/usr/bin/google-chrome';
    }
  }

  /**
   * 获取 Windows 下系统默认浏览器的可执行文件路径
   * 仅用于在 getChromePath 中作为优先候选（且仅当其为 Chromium 内核时才会被使用）
   */
  private getSystemDefaultBrowserPathWin(): string | null {
    if (process.platform !== 'win32') {
      return null;
    }

    try {
      const { execSync } = require('child_process');
      /**
       * Windows 10+ 正确的默认浏览器查询方式：
       * 1. 读取 UserChoice 中的 ProgId：HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice
       * 2. 再根据 ProgId 读取：HKCR\<ProgId>\shell\open\command
       */
      try {
        const userChoiceOutput: string = execSync(
          'reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId',
          { encoding: 'utf8' }
        );

        const progIdMatch = userChoiceOutput.match(/ProgId\s+REG_SZ\s+(.+)\s*$/m);
        const progId = progIdMatch ? progIdMatch[1].trim() : null;

        if (progId) {
          const commandOutput: string = execSync(
            `reg query "HKEY_CLASSES_ROOT\\${progId}\\shell\\open\\command" /ve`,
            { encoding: 'utf8' }
          );

          const commandMatch = commandOutput.match(/REG_SZ\s+(.+)\s*$/m);
          if (commandMatch) {
            const command = commandMatch[1].trim();

            // 优先从双引号中提取 exe 路径
            if (command.startsWith('"')) {
              const endQuote = command.indexOf('"', 1);
              if (endQuote > 1) {
                const exePath = command.slice(1, endQuote);
                return exePath || null;
              }
            }

            // 回退：从字符串中截取到 .exe 结尾
            const lower = command.toLowerCase();
            const exeIndex = lower.indexOf('.exe');
            if (exeIndex !== -1) {
              const exePath = command.slice(0, exeIndex + 4);
              return exePath || null;
            }
          }
        }
      } catch (innerError: any) {
        Logger.warn(
          '⚠️ [ChromeManager] 通过 UserChoice 查询默认浏览器失败，尝试回退方案:',
          innerError?.message || innerError
        );
      }

      /**
       * 回退方案：旧方式，直接从 HKCR\HTTP\shell\open\command 读取
       * 在某些系统上仍然有效
       */
      try {
        const output: string = execSync(
          'reg query "HKEY_CLASSES_ROOT\\HTTP\\shell\\open\\command" /ve',
          { encoding: 'utf8' }
        );

        const match = output.match(/REG_SZ\s+(.+)\s*$/m);
        if (!match) {
          return null;
        }

        const command = match[1].trim();

        if (command.startsWith('"')) {
          const endQuote = command.indexOf('"', 1);
          if (endQuote > 1) {
            const exePath = command.slice(1, endQuote);
            return exePath || null;
          }
        }

        const lower = command.toLowerCase();
        const exeIndex = lower.indexOf('.exe');
        if (exeIndex !== -1) {
          const exePath = command.slice(0, exeIndex + 4);
          return exePath || null;
        }
      } catch (fallbackError: any) {
        Logger.warn(
          '⚠️ [ChromeManager] 通过 HTTP 关联查询默认浏览器失败:',
          fallbackError?.message || fallbackError
        );
      }

      return null;
    } catch (e: any) {
      Logger.warn('⚠️ [ChromeManager] 读取系统默认浏览器失败:', e?.message || e);
      return null;
    }
  }
}
