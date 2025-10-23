import { exec } from 'child_process';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import * as path from 'path';
import * as os from 'os';

/**
 * localStorage数据结构
 */
interface LocalStorageData {
  userId: number | null;
  username: string | null;
  systemName: string | null;
  accessToken: string | null;
}

export class ChromeManager {
  private browser: Browser | null = null;
  private chromeProcess: any = null;
  private debugPort = 9222;

  /**
   * 创建一个新页面并导航到指定URL
   * @param url 目标URL
   * @returns Page对象
   */
  async createPage(url: string): Promise<Page> {
    try {
      // 如果浏览器未启动，先启动
      if (!this.browser) {
        await this.launchBrowser(url);
      }

      if (!this.browser) {
        throw new Error('浏览器启动失败');
      }

      const pages = await this.browser.pages();
      let page: Page;

      if (pages.length > 0) {
        page = pages[0];
      } else {
        page = await this.browser.newPage();
      }

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      return page;
    } catch (error: any) {
      // 如果创建页面失败，清理并重试一次
      if (error.message.includes('Target.createTarget timed out') ||
          error.message.includes('Session closed') ||
          error.message.includes('Connection closed')) {
        console.log('⚠️ [ChromeManager] 浏览器连接异常，清理并重试...');
        this.cleanup();
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 只重试一次，避免无限循环
        if (!error.retried) {
          const retryError = new Error(error.message) as any;
          retryError.retried = true;
          await this.launchBrowser(url);
          return this.createPage(url);
        }
      }
      throw error;
    }
  }

  /**
   * 启动浏览器（内部方法）
   * @param url 初始URL
   */
  private async launchBrowser(url: string): Promise<void> {
    const chromePath = this.getChromePath();
    const userDataDir = path.join(os.tmpdir(), 'api-detector-chrome');

    const command = `"${chromePath}" --remote-debugging-port=${this.debugPort} --user-data-dir="${userDataDir}" "${url}"`;
    
    this.chromeProcess = exec(command);

    // 等待Chrome启动
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 连接到Chrome，增加超时时间
    this.browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${this.debugPort}`,
      protocolTimeout: 60000 // 60秒超时
    });
  }

  /**
   * 启动浏览器供用户登录
   * @param url 目标URL
   * @returns 启动结果
   */
  async launchForLogin(url: string): Promise<{ success: boolean; message: string }> {
    try {
      // 查找Chrome路径
      const chromePath = this.getChromePath();
      const userDataDir = path.join(os.tmpdir(), 'api-detector-chrome');

      // 启动Chrome调试实例
      const command = `"${chromePath}" --remote-debugging-port=${this.debugPort} --user-data-dir="${userDataDir}" "${url}"`;
      
      this.chromeProcess = exec(command);

      // 等待Chrome启动
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 连接到Chrome，增加超时时间
      this.browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${this.debugPort}`,
        protocolTimeout: 60000 // 60秒超时
      });

      return { success: true, message: '浏览器已启动，请在浏览器中完成登录' };
    } catch (error: any) {
      return { success: false, message: `启动失败: ${error.message}` };
    }
  }

  /**
   * 从浏览器localStorage获取核心数据
   * 统一策略：优先localStorage，必要时通过Cookie+API回退补全
   * @param url 站点URL
   * @returns localStorage中的核心数据
   */
  async getLocalStorageData(url: string): Promise<LocalStorageData> {
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
    const localData = await this.tryGetFromLocalStorage(page);
    
    console.log('📊 [ChromeManager] localStorage数据:');
    console.log('   - userId:', localData.userId || '缺失');
    console.log('   - username:', localData.username || '缺失');
    console.log('   - systemName:', localData.systemName || '缺失');
    console.log('   - accessToken:', localData.accessToken ? '已获取' : '缺失');
    
    // 第二步：检查是否需要API回退
    const needsApiFallback = !localData.userId || !localData.accessToken;
    
    if (needsApiFallback) {
      console.log('⚠️ [ChromeManager] 信息不完整，尝试通过API补全...');
      try {
        const apiData = await this.getUserDataFromApi(page, url);
        // 合并数据，localStorage优先
        const merged = { ...apiData, ...localData };
        console.log('✅ [ChromeManager] API补全完成');
        
        if (!merged.userId) {
          throw new Error('未找到用户ID，请确保已登录');
        }
        
        return merged;
      } catch (apiError: any) {
        console.error('❌ [ChromeManager] API补全失败:', apiError.message);
        if (!localData.userId) {
          throw new Error('未找到用户ID，请确保已登录');
        }
      }
    }
    
    return localData;
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
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    
    // 多个API端点尝试
    const endpoints = [
      '/api/user/self',              // 最常见（所有站点）
      '/api/user/dashboard',         // One Hub, Done Hub (包含更多信息)
      '/api/user'                    // 某些简化站点
    ];
    
    let lastError: any = null;
    
    for (const endpoint of endpoints) {
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
          // 尝试获取system_name
          try {
            const systemName = await this.getSystemNameFromApi(page, cleanBaseUrl);
            if (systemName) {
              result.systemName = systemName;
            }
          } catch (e) {
            console.warn('⚠️ [ChromeManager] 获取system_name失败，继续');
          }
          
          return result;
        }
        
      } catch (error: any) {
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
   * 清理资源
   */
  cleanup() {
    if (this.browser) {
      this.browser.disconnect();
      this.browser = null;
    }
    if (this.chromeProcess) {
      this.chromeProcess.kill();
      this.chromeProcess = null;
    }
  }

  /**
   * 获取Chrome可执行文件路径
   */
  private getChromePath(): string {
    const platform = process.platform;
    
    if (platform === 'win32') {
      return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    } else if (platform === 'darwin') {
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else {
      return '/usr/bin/google-chrome';
    }
  }
}