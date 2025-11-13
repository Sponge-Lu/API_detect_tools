import { exec } from 'child_process';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * localStorage数据结构
 */
interface LocalStorageData {
  userId: number | null;
  username: string | null;
  systemName: string | null;
  accessToken: string | null;
  supportsCheckIn?: boolean;  // 站点是否支持签到
  canCheckIn?: boolean;       // 当前是否可签到
}

export class ChromeManager {
  private browser: Browser | null = null;
  private chromeProcess: any = null;
  private debugPort = 9222;
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
    console.log(`📊 [ChromeManager] 浏览器引用计数: ${this.browserRefCount}`);
    
    // 如果浏览器未启动，启动浏览器
    if (!this.browser) {
      // 等待锁完成（如果有）
      if (this.browserLock) {
        await this.browserLock;
      }
      
      // 如果等待后仍然没有浏览器，创建新的启动锁并启动
      if (!this.browser) {
        let resolveLock: () => void;
        this.browserLock = new Promise((resolve) => {
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
      console.log(`📊 [ChromeManager] 浏览器引用计数: ${this.browserRefCount}`);
      
      // 如果引用计数为0，延迟关闭浏览器（以便后续检测复用）
      if (this.browserRefCount === 0) {
        // 清除之前的定时器
        if (this.cleanupTimer) {
          clearTimeout(this.cleanupTimer);
        }
        
        // 延迟5秒关闭，以便后续检测复用
        this.cleanupTimer = setTimeout(() => {
          if (this.browserRefCount === 0) {
            console.log('⏰ [ChromeManager] 引用计数为0，延迟关闭浏览器');
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
    // 如果浏览器已关闭且引用计数为0，重置状态以允许重新启动
    // 注意：如果引用计数不为0，说明还有其他操作在使用，不应该重置状态
    if (this.isBrowserClosed && this.browserRefCount === 0) {
      console.log('🔄 [ChromeManager] 检测到浏览器已关闭且无其他操作，重置状态并重新启动...');
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
    } else if (this.isBrowserClosed && this.browserRefCount > 0) {
      // 浏览器已关闭但还有引用，说明有其他操作在使用，抛出错误
      throw new Error('浏览器已关闭，操作已取消');
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
          console.warn('⚠️ [ChromeManager] 浏览器连接失效，需要重新启动');
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
            }
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
      console.error('❌ [ChromeManager] createPage失败:', error.message);
      
      // 如果创建页面失败，清理并重试一次
      if (error.message.includes('Target.createTarget timed out') ||
          error.message.includes('Session closed') ||
          error.message.includes('Connection closed') ||
          error.message.includes('Protocol error')) {
        console.log('⚠️ [ChromeManager] 浏览器连接异常，清理并重试...');
        
        // 只有在引用计数为0时才清理
        if (this.browserRefCount === 0) {
          this.cleanup();
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 只重试一次，避免无限循环
        if (!error.retried) {
          console.log('🔄 [ChromeManager] 重试创建页面...');
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

    const pages = await this.browser.pages();
    let page: Page;

    if (pages.length > 0) {
      page = pages[0];
      console.log('📄 [ChromeManager] 使用已有页面');
    } else {
      page = await this.browser.newPage();
      console.log('📄 [ChromeManager] 创建新页面');
    }

    console.log(`🌐 [ChromeManager] 导航到: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    return page;
  }

  /**
   * 启动浏览器（内部方法）
   * @param url 初始URL
   */
  private async launchBrowser(url: string): Promise<void> {
    console.log('🚀 [ChromeManager] 启动浏览器...');
    
    // 1. 检查引用计数，如果 > 0，不应该清理（保持复用逻辑）
    if (this.browserRefCount > 0) {
      console.warn(`⚠️ [ChromeManager] 浏览器正在使用中（引用计数: ${this.browserRefCount}），跳过清理`);
      // 如果浏览器已存在且连接有效，直接返回（复用）
      if (this.browser) {
        try {
          await this.browser.pages();
          console.log('✅ [ChromeManager] 浏览器已存在且连接有效，复用');
          // 如果之前标记为关闭，现在重置状态（因为浏览器实际上还在运行）
          if (this.isBrowserClosed) {
            console.log('🔄 [ChromeManager] 浏览器实际仍在运行，重置关闭标志');
            this.isBrowserClosed = false;
            this.abortController = new AbortController();
          }
          return;
        } catch (e) {
          console.warn('⚠️ [ChromeManager] 浏览器连接失效，需要重新启动');
          this.browser = null;
          // 连接失效时，重置关闭标志以允许重新启动
          this.isBrowserClosed = false;
          this.abortController = new AbortController();
        }
      } else if (this.isBrowserClosed) {
        // 浏览器引用为null但标记为关闭，重置状态以允许重新启动
        console.log('🔄 [ChromeManager] 浏览器已关闭，重置状态以重新启动...');
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
        console.log('🔄 [ChromeManager] 引用计数为0，重置关闭标志以允许后续复用');
        this.isBrowserClosed = false;
        this.abortController = new AbortController();
      }
    }
    
    await this.waitForPortFree(this.debugPort);
    
    // 2. 准备启动参数
    const chromePath = this.getChromePath();
    const userDataDir = path.join(os.tmpdir(), 'api-detector-chrome');

    // 3. 启动Chrome进程 - 使用spawn而不是exec，并设置正确的编码
    const { spawn } = require('child_process');
    
    console.log(`📝 [ChromeManager] Chrome路径: ${chromePath}`);
    
    // 使用spawn避免命令解析问题，并设置编码
    const args = [
      `--remote-debugging-port=${this.debugPort}`,
      `--user-data-dir=${userDataDir}`,
      url
    ];
    
    this.chromeProcess = spawn(chromePath, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'], // 忽略所有输出
      detached: true,
      windowsHide: true
    });
    
    // 处理进程错误
    this.chromeProcess.on('error', (error: any) => {
      console.error('❌ [ChromeManager] Chrome进程错误:', error.message);
    });

    // 4. 等待调试端口就绪
    console.log(`⏳ [ChromeManager] 等待调试端口 ${this.debugPort} 就绪...`);
    await this.waitForPortReady(this.debugPort);

    // 5. 连接到Chrome
    console.log('🔌 [ChromeManager] 连接到Chrome...');
    this.browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${this.debugPort}`,
      protocolTimeout: 60000 // 60秒超时
    });
    
    // 重置关闭标志和创建新的 AbortController
    this.isBrowserClosed = false;
    this.abortController = new AbortController();
    
    // 监听浏览器断开事件
    this.browser.on('disconnected', () => {
      console.log('⚠️ [ChromeManager] 检测到浏览器已关闭');
      this.handleBrowserDisconnected();
    });
    
    console.log('✅ [ChromeManager] 浏览器启动成功');
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
          console.log(`✅ [ChromeManager] 端口 ${port} 已释放`);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (e) {
        // 忽略检测错误
      }
    }
    
    console.warn(`⚠️ [ChromeManager] 端口 ${port} 可能仍被占用，继续尝试...`);
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
          console.log(`✅ [ChromeManager] 端口 ${port} 已就绪`);
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
   * 检查端口是否被使用
   */
  private async isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('net');
      const tester = net.createServer()
        .once('error', () => resolve(true))  // 端口被占用
        .once('listening', () => {
          tester.once('close', () => resolve(false))  // 端口空闲
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
      console.log('🚀 [ChromeManager] 启动浏览器供用户登录...');
      
      // 使用统一的启动流程
      await this.launchBrowser(url);

      return { success: true, message: '浏览器已启动，请在浏览器中完成登录' };
    } catch (error: any) {
      console.error('❌ [ChromeManager] 启动浏览器失败:', error.message);
      return { success: false, message: `启动失败: ${error.message}` };
    }
  }

  /**
   * 从浏览器localStorage获取核心数据
   * 统一策略：优先localStorage，必要时通过Cookie+API回退补全
   * @param url 站点URL
   * @param waitForLogin 是否等待用户登录（默认false）
   * @param maxWaitTime 最大等待时间（毫秒，默认60秒）
   * @returns localStorage中的核心数据
   */
  async getLocalStorageData(
    url: string, 
    waitForLogin: boolean = false,
    maxWaitTime: number = 60000
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
    
    await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {
      console.log('⚠️ [ChromeManager] 页面加载超时，继续获取数据');
    });
    
    console.log('🔍 [ChromeManager] 开始读取localStorage...');
    
    // 第一步：从localStorage获取所有可能的信息
    let localData = await this.tryGetFromLocalStorage(page);
    
    console.log('📊 [ChromeManager] localStorage数据:');
    console.log('   - userId:', localData.userId || '缺失');
    console.log('   - username:', localData.username || '缺失');
    console.log('   - systemName:', localData.systemName || '缺失');
    console.log('   - accessToken:', localData.accessToken ? '已获取' : '缺失');
    console.log('   - supportsCheckIn:', localData.supportsCheckIn ?? '未知');
    console.log('   - canCheckIn:', localData.canCheckIn ?? '未知');
    
    // 如果没有userId且需要等待登录，则轮询检查
    if (!localData.userId && waitForLogin) {
      console.log('⏳ [ChromeManager] 未检测到登录状态，等待用户登录...');
      console.log(`   最长等待 ${maxWaitTime / 1000} 秒`);
      console.log('💡 [ChromeManager] 将同时检查localStorage和API接口');
      
      // 在进入等待循环前，先尝试一次API回退（用户可能已经登录，只是localStorage没有数据）
      console.log('🔄 [ChromeManager] 先尝试通过API检查是否已登录...');
      try {
        this.checkBrowserClosed(); // 检查浏览器状态
        const apiData = await this.getUserDataFromApi(page, url);
        if (apiData.userId) {
          console.log(`✅ [ChromeManager] 通过API检测到用户已登录！用户ID: ${apiData.userId}`);
          // 合并数据，API数据优先
          localData = { ...localData, ...apiData };
        } else {
          // API也没有数据，进入等待循环
          localData = await this.waitForUserLogin(page, url, maxWaitTime);
        }
      } catch (apiError: any) {
        // 如果是浏览器关闭错误，直接抛出
        if (apiError.message.includes('浏览器已关闭') || apiError.message.includes('操作已被取消')) {
          throw apiError;
        }
        console.log(`ℹ️ [ChromeManager] 初始API检查失败: ${apiError.message}，进入等待循环...`);
        // API失败，进入等待循环
        localData = await this.waitForUserLogin(page, url, maxWaitTime);
      }
      
      console.log('✅ [ChromeManager] 用户已登录，继续获取数据');
      console.log('📊 [ChromeManager] 登录后数据:');
      console.log('   - userId:', localData.userId);
      console.log('   - username:', localData.username || '未获取');
      console.log('   - accessToken:', localData.accessToken ? '已获取' : '未获取');
    }
    
    // 第二步：检查是否需要API回退
    const needsApiFallback = !localData.userId || !localData.accessToken;
    
    if (needsApiFallback) {
      console.log('⚠️ [ChromeManager] 信息不完整，尝试通过API补全...');
      try {
        this.checkBrowserClosed(); // 检查浏览器状态
        const apiData = await this.getUserDataFromApi(page, url);
        // 合并数据，localStorage优先
        const merged = { ...apiData, ...localData };
        console.log('✅ [ChromeManager] API补全完成');
        
        if (!merged.userId) {
          throw new Error('未找到用户ID，请确保已登录');
        }
        
        return merged;
      } catch (apiError: any) {
        // 如果是浏览器关闭错误，直接抛出
        if (apiError.message.includes('浏览器已关闭') || apiError.message.includes('操作已被取消')) {
          throw apiError;
        }
        console.error('❌ [ChromeManager] API补全失败:', apiError.message);
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
      console.log('🛑 [ChromeManager] 已取消所有正在进行的操作');
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
   * @returns 登录后的localStorage数据
   */
  private async waitForUserLogin(page: Page, baseUrl: string, maxWaitTime: number): Promise<LocalStorageData> {
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
      console.log(`⏳ [ChromeManager] 等待登录中... (${elapsedTime}/${Math.floor(maxWaitTime / 1000)}秒)`);
      
      // 检查localStorage
      try {
        const localData = await this.tryGetFromLocalStorage(page);
        
        if (localData.userId) {
          console.log(`✅ [ChromeManager] 检测到用户登录！用户ID: ${localData.userId}`);
          return localData;
        }
        
        // 定期尝试API回退（每10秒尝试一次）
        if (checkCount % apiCheckInterval === 0) {
          console.log('🔄 [ChromeManager] 尝试通过API检查登录状态...');
          try {
            this.checkBrowserClosed(); // 在API调用前检查
            const apiData = await this.getUserDataFromApi(page, baseUrl);
            if (apiData.userId) {
              console.log(`✅ [ChromeManager] 通过API检测到用户登录！用户ID: ${apiData.userId}`);
              // 合并数据，API数据优先（因为localStorage可能没有）
              return { ...localData, ...apiData };
            }
          } catch (apiError: any) {
            // 如果是浏览器关闭错误，直接抛出
            if (apiError.message.includes('浏览器已关闭') || apiError.message.includes('操作已被取消')) {
              throw apiError;
            }
            // API失败不影响继续等待
            console.log(`ℹ️ [ChromeManager] API检查失败: ${apiError.message}，继续等待...`);
          }
        }
      } catch (error: any) {
        // 如果是浏览器关闭错误，直接抛出
        if (error.message.includes('浏览器已关闭') || error.message.includes('操作已被取消')) {
          throw error;
        }
        console.warn('⚠️ [ChromeManager] 检查登录状态时出错:', error.message);
        // 继续等待
      }
    }
    
    // 超时前，最后尝试一次API回退
    this.checkBrowserClosed(); // 检查浏览器是否已关闭
    
    console.log('⏰ [ChromeManager] 等待超时，最后尝试API回退...');
    try {
      const apiData = await this.getUserDataFromApi(page, baseUrl);
      if (apiData.userId) {
        console.log(`✅ [ChromeManager] 通过API检测到用户登录！用户ID: ${apiData.userId}`);
        const localData = await this.tryGetFromLocalStorage(page);
        return { ...localData, ...apiData };
      }
    } catch (apiError: any) {
      // 如果是浏览器关闭错误，直接抛出
      if (apiError.message.includes('浏览器已关闭') || apiError.message.includes('操作已被取消')) {
        throw apiError;
      }
      console.log(`ℹ️ [ChromeManager] 最后API检查也失败: ${apiError.message}`);
    }
    
    // 最后检查一次浏览器状态
    this.checkBrowserClosed();
    
    // 超时
    throw new Error(`等待登录超时（${maxWaitTime / 1000}秒），请确保已在浏览器中完成登录`);
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
        this.abortController.signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('操作已被取消（浏览器已关闭）'));
        }, { once: true });
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
        accessToken: null
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
          } catch (e) {}
        }
        
        // 路径2: 从siteInfo对象获取
        const siteInfoStr = storage.getItem('siteInfo');
        if (siteInfoStr) {
          try {
            const siteInfo = JSON.parse(siteInfoStr);
            data.userId = data.userId || siteInfo.id || siteInfo.user_id || siteInfo.userId || siteInfo.uid;
          } catch (e) {}
        }
        
        // 路径3: 从userInfo对象获取
        const userInfoStr = storage.getItem('userInfo');
        if (userInfoStr) {
          try {
            const userInfo = JSON.parse(userInfoStr);
            data.userId = data.userId || userInfo.id || userInfo.user_id || userInfo.userId;
          } catch (e) {}
        }
        
        // 路径4: 从独立键获取
        if (!data.userId) {
          const idStr = storage.getItem('user_id') || storage.getItem('userId') || 
                       storage.getItem('uid') || storage.getItem('id');
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
            data.username = user.username || user.name || user.display_name || 
                          user.displayName || user.nickname || user.login;
          } catch (e) {}
        }
        
        // 从siteInfo对象
        if (siteInfoStr) {
          try {
            const siteInfo = JSON.parse(siteInfoStr);
            data.username = data.username || siteInfo.username || siteInfo.name || 
                          siteInfo.display_name || siteInfo.user_name;
          } catch (e) {}
        }
        
        // 从userInfo对象
        if (userInfoStr) {
          try {
            const userInfo = JSON.parse(userInfoStr);
            data.username = data.username || userInfo.username || userInfo.name;
          } catch (e) {}
        }
        
        // 从独立键
        data.username = data.username || storage.getItem('username') || 
                       storage.getItem('user_name') || storage.getItem('nickname');
        
        // ===== System Name 多路径获取 =====
        // 从siteInfo对象
        if (siteInfoStr) {
          try {
            const siteInfo = JSON.parse(siteInfoStr);
            data.systemName = siteInfo.system_name || siteInfo.systemName || 
                            siteInfo.site_name || siteInfo.siteName || siteInfo.name;
          } catch (e) {}
        }
        
        // 从config对象
        const configStr = storage.getItem('config') || storage.getItem('siteConfig');
        if (configStr) {
          try {
            const config = JSON.parse(configStr);
            data.systemName = data.systemName || config.system_name || config.systemName || 
                            config.site_name || config.name;
          } catch (e) {}
        }
        
        // 从独立键
        data.systemName = data.systemName || storage.getItem('system_name') || 
                        storage.getItem('systemName') || storage.getItem('site_name') || 
                        storage.getItem('siteName') || storage.getItem('app_name');
        
        // ===== Access Token 多路径获取 =====
        // 从user对象
        if (userStr) {
          try {
            const user = JSON.parse(userStr);
            data.accessToken = user.access_token || user.accessToken || user.token || 
                             user.auth_token || user.authToken || user.api_token;
          } catch (e) {}
        }
        
        // 从siteInfo对象
        if (siteInfoStr) {
          try {
            const siteInfo = JSON.parse(siteInfoStr);
            data.accessToken = data.accessToken || siteInfo.access_token || 
                             siteInfo.accessToken || siteInfo.token;
          } catch (e) {}
        }
        
        // 从auth对象
        const authStr = storage.getItem('auth') || storage.getItem('authentication');
        if (authStr) {
          try {
            const auth = JSON.parse(authStr);
            data.accessToken = data.accessToken || auth.access_token || auth.token;
          } catch (e) {}
        }
        
        // 从独立键
        data.accessToken = data.accessToken ||
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
          } catch (e) {}
        }
        
        // 从user对象获取当前签到状态
        if (userStr) {
          try {
            const user = JSON.parse(userStr);
            // 当前是否可签到（从 /api/user/check_in_status 的 can_check_in）
            if (typeof user.can_check_in === 'boolean') {
              data.canCheckIn = user.can_check_in;
            }
          } catch (e) {}
        }
        
        // 从status对象获取
        const statusStr = storage.getItem('status') || storage.getItem('siteStatus');
        if (statusStr) {
          try {
            const status = JSON.parse(statusStr);
            data.supportsCheckIn = data.supportsCheckIn ?? status.check_in_enabled;
          } catch (e) {}
        }
        
        // 从checkIn对象获取
        const checkInStr = storage.getItem('checkIn') || storage.getItem('check_in');
        if (checkInStr) {
          try {
            const checkIn = JSON.parse(checkInStr);
            data.canCheckIn = data.canCheckIn ?? checkIn.can_check_in;
            data.supportsCheckIn = data.supportsCheckIn ?? checkIn.enabled;
          } catch (e) {}
        }
        
      } catch (e) {
        console.error('[Browser Context] 读取localStorage失败:', e);
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
      '/api/user/self',              // 最常见（所有站点）
      '/api/user/dashboard',         // One Hub, Done Hub (包含更多信息)
      '/api/user'                    // 某些简化站点
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
        console.log(`📡 [ChromeManager] 尝试API: ${apiUrl}`);
        
        const result = await page.evaluate(async (url: string) => {
          try {
            const response = await fetch(url, {
              method: 'GET',
              credentials: 'include', // 携带Cookie
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
                'Pragma': 'no-cache'
              }
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json() as any;
            
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
              userId: userData.id || userData.user_id || userData.userId || 
                     userData.uid || userData.user_ID || null,
              // Username 多字段尝试
              username: userData.username || userData.name || userData.display_name || 
                       userData.displayName || userData.nickname || userData.login || 
                       userData.user_name || null,
              // Access Token 多字段尝试
              accessToken: userData.access_token || userData.accessToken || userData.token || 
                         userData.auth_token || userData.authToken || userData.api_token || 
                         userData.bearer_token || null,
              // System Name - 暂不从此接口获取，后续单独获取
              systemName: null
            };
          } catch (error: any) {
            throw new Error(error.message || '请求失败');
          }
        }, apiUrl);

        console.log('📊 [ChromeManager] API返回数据:');
        console.log('   - userId:', result.userId);
        console.log('   - username:', result.username);
        console.log('   - accessToken:', result.accessToken ? '已获取' : '未找到');
        
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
            console.warn('⚠️ [ChromeManager] 获取system_name失败，继续');
          }
          
          return result;
        }
        
      } catch (error: any) {
        // 如果是浏览器关闭错误，直接抛出
        if (error.message.includes('浏览器已关闭') || error.message.includes('操作已取消')) {
          throw error;
        }
        console.warn(`⚠️ [ChromeManager] 端点 ${endpoint} 失败:`, error.message);
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
      console.log('🏷️ [ChromeManager] 获取系统名称:', statusUrl);
      
      const result = await page.evaluate(async (url: string) => {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) return null;
        
        const data = await response.json() as any;
        
        // 多字段尝试
        return data?.data?.system_name || data?.data?.systemName || 
               data?.data?.site_name || data?.data?.name || 
               data?.system_name || data?.systemName || null;
      }, statusUrl);
      
      if (result) {
        console.log('✅ [ChromeManager] 系统名称:', result);
      }
      
      return result;
      
    } catch (error: any) {
      console.warn('⚠️ [ChromeManager] 获取系统名称失败:', error.message);
      return null;
    }
  }

  /**
   * 旧方法兼容：getCookies
   * 为了保持向后兼容，保留此方法但内部调用新方法
   * @deprecated 请使用 getLocalStorageData()
   */
  async getCookies(url: string): Promise<any[]> {
    console.warn('⚠️ [ChromeManager] getCookies() 已废弃，请使用 getLocalStorageData()');
    
    const data = await this.getLocalStorageData(url);
    
    // 将数据转换为旧的Cookie格式（为了兼容性）
    const hostname = new URL(url).hostname;
    const cookies: any[] = [];
    
    if (data.userId !== null) {
      cookies.push({
        name: '__user_id',
        value: String(data.userId),
        domain: hostname,
        path: '/',
        httpOnly: false,
        secure: false
      });
    }
    
    if (data.username) {
      cookies.push({
        name: '__user_name',
        value: data.username,
        domain: hostname,
        path: '/',
        httpOnly: false,
        secure: false
      });
    }
    
    if (data.accessToken) {
      cookies.push({
        name: '__user_access_token',
        value: data.accessToken,
        domain: hostname,
        path: '/',
        httpOnly: false,
        secure: false
      });
    }
    
    return cookies;
  }

  /**
   * 清理Chrome进程（内部方法）
   */
  private cleanupChromeProcess(): void {
    if (this.chromeProcess) {
      try {
        // Windows: 强制终止进程树
        if (process.platform === 'win32') {
          const pid = this.chromeProcess.pid;
          if (pid) {
            console.log(`🔪 [ChromeManager] 强制终止Chrome进程 (PID: ${pid})`);
            exec(`taskkill /F /T /PID ${pid}`, (error) => {
              if (error) {
                console.warn('⚠️ [ChromeManager] taskkill失败:', error.message);
              } else {
                console.log('✅ [ChromeManager] Chrome进程已终止');
              }
            });
          }
        } else {
          // Linux/Mac: 使用 SIGKILL
          this.chromeProcess.kill('SIGKILL');
          console.log('✅ [ChromeManager] Chrome进程已发送SIGKILL');
        }
      } catch (e) {
        console.warn('⚠️ [ChromeManager] 终止Chrome进程失败:', e);
      }
      this.chromeProcess = null;
    }
  }

  /**
   * 清理资源
   * 只有在引用计数为0时才会真正清理
   */
  cleanup() {
    // 检查引用计数
    if (this.browserRefCount > 0) {
      console.warn(`⚠️ [ChromeManager] 浏览器正在使用中（引用计数: ${this.browserRefCount}），跳过清理`);
      return;
    }
    
    console.log('🧹 [ChromeManager] 开始清理浏览器资源...');
    
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
        this.browser.disconnect();
        console.log('✅ [ChromeManager] 浏览器连接已断开');
      } catch (e) {
        console.warn('⚠️ [ChromeManager] 断开浏览器连接失败:', e);
      }
      this.browser = null;
    }
    
    // 清理Chrome进程
    this.cleanupChromeProcess();
    
    console.log('✅ [ChromeManager] 资源清理完成');
  }

  /**
   * 获取Chrome可执行文件路径
   */
  private getChromePath(): string {
    const platform = process.platform;
    
    if (platform === 'win32') {
      // 尝试多个可能的Chrome安装位置
      const possiblePaths = [
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
      ];
      
      // 检查文件是否存在
      for (const chromePath of possiblePaths) {
        if (fs.existsSync(chromePath)) {
          return chromePath;
        }
      }
      
      // 如果都不存在，返回最常见的位置
      console.warn('⚠️ [ChromeManager] 未找到Chrome，使用默认路径');
      return possiblePaths[0];
    } else if (platform === 'darwin') {
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else {
      return '/usr/bin/google-chrome';
    }
  }
}