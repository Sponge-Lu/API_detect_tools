import axios from 'axios';
import type { SiteConfig } from './types/token';

interface DetectionResult {
  name: string;
  url: string;
  status: string;
  models: string[];
  balance?: number;
  todayUsage?: number; // 今日消费（美元）
  error?: string;
  has_checkin: boolean;  // 是否支持签到功能
  can_check_in?: boolean;  // 今日是否可签到（true=可签到, false=已签到）
  // 新增：缓存的扩展数据
  apiKeys?: any[];
  userGroups?: Record<string, { desc: string; ratio: number }>;
  modelPricing?: any;
}

// 日志条目接口
interface LogItem {
  quota?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

// 日志响应接口
interface LogResponse {
  success: boolean;
  data: {
    items: LogItem[];
    total: number;
  };
  message?: string;
}

export class ApiService {
  private tokenService: any;
  private tokenStorage: any;

  constructor(tokenService?: any, tokenStorage?: any) {
    this.tokenService = tokenService;
    this.tokenStorage = tokenStorage;
  }

  async detectSite(
    site: SiteConfig,
    timeout: number,
    quickRefresh: boolean = false,
    cachedData?: DetectionResult
  ): Promise<DetectionResult> {
    let sharedPage: any = null;
    let pageRelease: (() => void) | undefined = undefined;
    
    try {
      // 获取模型列表（可能会创建浏览器页面）
      const modelsResult = await this.getModels(site, timeout);
      const models = modelsResult.models;
      sharedPage = modelsResult.page;
      pageRelease = modelsResult.pageRelease;
      
      // 如果创建了浏览器页面，确保Cloudflare验证完成
      if (sharedPage) {
        console.log('🛡️ [ApiService] 检测到使用浏览器页面，确保Cloudflare验证完成...');
        await this.waitForCloudflareChallenge(sharedPage, 600000);
      }
      
      // 获取余额和今日消费，复用浏览器页面
      const balanceData = await this.getBalanceAndUsage(site, timeout, sharedPage);

      // 获取扩展数据，复用浏览器页面
      let apiKeys, userGroups, modelPricing;
      
      if (this.tokenService && site.system_token && site.user_id) {
        try {
          console.log('📦 [ApiService] 获取扩展数据...');
          
          // 并行获取所有扩展数据，传入共享的浏览器页面
          const [apiKeysResult, userGroupsResult, modelPricingResult] = await Promise.allSettled([
            this.tokenService.fetchApiTokens(site.url, parseInt(site.user_id), site.system_token, sharedPage),
            this.tokenService.fetchUserGroups(site.url, parseInt(site.user_id), site.system_token, sharedPage),
            this.tokenService.fetchModelPricing(site.url, parseInt(site.user_id), site.system_token, sharedPage)
          ]);

          if (apiKeysResult.status === 'fulfilled' && apiKeysResult.value) {
            apiKeys = apiKeysResult.value;
            console.log(`✅ [ApiService] 获取到 ${apiKeys?.length || 0} 个API Keys`);
          }
          
          if (userGroupsResult.status === 'fulfilled' && userGroupsResult.value) {
            userGroups = userGroupsResult.value;
            console.log(`✅ [ApiService] 获取到 ${Object.keys(userGroups || {}).length} 个用户分组`);
          }
          
          if (modelPricingResult.status === 'fulfilled' && modelPricingResult.value) {
            modelPricing = modelPricingResult.value;
            console.log(`✅ [ApiService] 获取到模型定价信息`);
          }
        } catch (error: any) {
          console.error('⚠️ [ApiService] 获取扩展数据失败:', error.message);
        }
      }

      console.log('📤 [ApiService] 准备返回结果:');
      console.log('   - name:', site.name);
      console.log('   - apiKeys:', apiKeys ? `${apiKeys.length}个` : '无');
      console.log('   - userGroups:', userGroups ? `${Object.keys(userGroups).length}个` : '无');
      console.log('   - modelPricing:', modelPricing ? '有' : '无');
      
      // 检测是否支持签到功能（智能两步检测）
      let hasCheckin = false;
      let canCheckIn: boolean | undefined = undefined;
      
      if (this.tokenService && site.system_token && site.user_id) {
        try {
          console.log('🔍 [ApiService] 开始签到功能检测...');
          
          // 步骤1：检查站点配置（/api/status 的 check_in_enabled）
          let siteConfigSupports = false;
          
          if (site.force_enable_checkin) {
            // 用户强制启用，跳过所有检查
            console.log('⚙️ [ApiService] 用户强制启用签到，跳过站点配置检查');
            siteConfigSupports = true;
          } else {
            // 检查站点配置（传入共享页面以绕过Cloudflare）
            siteConfigSupports = await this.tokenService.checkSiteSupportsCheckIn(site.url, sharedPage);
          }
          
          // 步骤2：获取签到状态（仅当站点配置支持或用户强制启用时）
          if (siteConfigSupports) {
            // 站点配置支持签到（或用户强制启用），获取签到状态
            const checkInStatus = await this.tokenService.fetchCheckInStatus(
              site.url,
              parseInt(site.user_id),
              site.system_token,
              sharedPage  // 传入共享页面以绕过Cloudflare
            );
            
            // 如果签到状态接口返回了有效数据
            if (checkInStatus !== undefined) {
              hasCheckin = true;
              canCheckIn = checkInStatus;
              console.log(`✅ [ApiService] 签到功能检测: 支持=${hasCheckin}, 可签到=${canCheckIn}`);
            } else {
              // 签到状态接口不可用
              console.log('⚠️ [ApiService] 站点配置支持签到，但签到状态接口不可用');
            }
          } else {
            // 站点配置不支持签到，且用户未强制启用
            console.log('ℹ️ [ApiService] 站点不支持签到功能 (check_in_enabled=false)');
            console.log('💡 [ApiService] 如需强制启用，请在站点配置中勾选"强制启用签到"');
          }
          
        } catch (error: any) {
          console.log('⚠️ [ApiService] 签到功能检测失败:', error.message);
        }
      }

      const result = {
        name: site.name,
        url: site.url,
        status: '成功',
        models,
        balance: balanceData?.balance,
        todayUsage: balanceData?.todayUsage,
        error: undefined,
        has_checkin: hasCheckin,
        can_check_in: canCheckIn,  // 添加签到状态
        apiKeys,
        userGroups,
        modelPricing
      };
      
      // 保存缓存数据到TokenStorage
      if (this.tokenStorage && site.system_token && site.user_id) {
        try {
          await this.saveCachedDisplayData(site.url, result);
        } catch (error: any) {
          console.error('⚠️ [ApiService] 保存缓存数据失败:', error.message);
        }
      }
      
      return result;
    } catch (error: any) {
      return {
        name: site.name,
        url: site.url,
        status: '失败',
        models: [],
        balance: undefined,
        todayUsage: undefined,
        error: error.message,
        has_checkin: false
      };
    } finally {
      // 释放浏览器引用（如果创建了页面）
      if (pageRelease) {
        try {
          console.log('🔒 [ApiService] 释放浏览器引用');
          pageRelease();
        } catch (error: any) {
          console.error('⚠️ [ApiService] 释放浏览器引用失败:', error.message);
        }
      }
      
      // 确保关闭浏览器页面
      if (sharedPage) {
        try {
          console.log('🔒 [ApiService] 关闭共享浏览器页面');
          await sharedPage.close();
        } catch (error: any) {
          console.error('⚠️ [ApiService] 关闭页面失败:', error.message);
        }
      }
    }
  }

  async detectAllSites(
    config: any,
    quickRefresh: boolean = false,
    cachedResults?: DetectionResult[]
  ): Promise<DetectionResult[]> {
    const enabledSites = config.sites.filter((s: SiteConfig) => s.enabled);
    const results: DetectionResult[] = [];

    // 创建缓存数据映射（按站点名称索引）
    const cachedMap = new Map<string, DetectionResult>();
    if (cachedResults) {
      cachedResults.forEach(result => cachedMap.set(result.name, result));
    }

    if (config.settings.concurrent) {
      const promises = enabledSites.map((site: SiteConfig) =>
        this.detectSite(site, config.settings.timeout, quickRefresh, cachedMap.get(site.name))
      );
      return await Promise.all(promises);
    } else {
      for (const site of enabledSites) {
        const cachedData = cachedMap.get(site.name);
        const result = await this.detectSite(site, config.settings.timeout, quickRefresh, cachedData);
        results.push(result);
      }
      return results;
    }
  }

  /**
   * 智能等待Cloudflare验证完成
   * @param page Puppeteer页面对象
   * @param maxWaitTime 最大等待时间（毫秒），默认10分钟
   */
  private async waitForCloudflareChallenge(page: any, maxWaitTime: number = 600000): Promise<void> {
    console.log('🛡️ [ApiService] 开始Cloudflare验证检测（最长等待10分钟）...');
    
    const startTime = Date.now();
    let lastLogTime = startTime;
    
    try {
      // 1. 等待body元素加载
      await page.waitForSelector('body', { timeout: 30000 });
      console.log('✅ [ApiService] 页面body已加载');
      
      // 2. 循环检测验证状态
      while (Date.now() - startTime < maxWaitTime) {
        try {
          // 检查页面是否已关闭（浏览器关闭会导致页面关闭）
          if (page.isClosed()) {
            throw new Error('浏览器已关闭，操作已取消');
          }
          
          // 2.1 检测是否仍在验证中
          const verificationStatus = await page.evaluate(() => {
            const doc = (globalThis as any).document;
            
            // 检测Cloudflare验证相关元素
            const cfChallenge = doc.querySelector('[class*="cf-challenge"]');
            const cfVerifying = doc.querySelector('[class*="cf-browser-verification"]');
            const cfLoading = doc.querySelector('[id*="challenge-stage"]');
            const cfSpinner = doc.querySelector('[class*="cf-spinner"]');
            
            // 检测标题
            const titleCheck = doc.title.includes('Just a moment') || 
                              doc.title.includes('Checking your browser') ||
                              doc.title.includes('Please wait');
            
            // 检测body class
            const bodyCheck = doc.body.className.includes('no-js') || 
                            doc.body.className.includes('cf-challenge');
            
            // 检测iframe（某些站点使用iframe进行验证）
            const iframeCheck = doc.querySelector('iframe[src*="challenges.cloudflare.com"]');
            
            const isVerifying = !!(cfChallenge || cfVerifying || cfLoading || cfSpinner || 
                                  titleCheck || bodyCheck || iframeCheck);
            
            return {
              isVerifying,
              title: doc.title,
              bodyClass: doc.body.className
            };
          });
          
          // 每30秒输出一次日志
          const elapsed = Date.now() - startTime;
          if (elapsed - (lastLogTime - startTime) >= 30000) {
            console.log(`⏳ [ApiService] Cloudflare验证中... (${Math.floor(elapsed / 1000)}s / ${Math.floor(maxWaitTime / 1000)}s)`);
            lastLogTime = Date.now();
          }
          
          if (!verificationStatus.isVerifying) {
            console.log('✅ [ApiService] Cloudflare验证已完成');
            console.log(`   - 页面标题: ${verificationStatus.title}`);
            
            // 验证完成后额外等待2秒确保页面稳定
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 等待网络空闲（最多3秒）
            try {
              await page.waitForNetworkIdle({ timeout: 3000 });
              console.log('✅ [ApiService] 网络已空闲');
            } catch (e) {
              console.log('⚠️ [ApiService] 网络未完全空闲，继续执行');
            }
            
            return;
          }
          
          // 仍在验证中，等待2秒后重新检测
          await new Promise(resolve => setTimeout(resolve, 2000));
          
        } catch (error: any) {
          // 如果是浏览器关闭错误，直接抛出
          if (error.message.includes('浏览器已关闭') || error.message.includes('操作已取消')) {
            console.log('⚠️ [ApiService] 检测到浏览器已关闭，停止Cloudflare验证等待');
            throw error;
          }
          
          // 检查页面是否已关闭
          if (page.isClosed()) {
            throw new Error('浏览器已关闭，操作已取消');
          }
          
          console.error('❌ [ApiService] 验证检测错误:', error.message);
          // 检测错误，等待3秒后继续
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      // 超时处理
      if (Date.now() - startTime >= maxWaitTime) {
        console.log('⚠️ [ApiService] Cloudflare验证超时（10分钟），继续执行');
      }
      
    } catch (error: any) {
      console.error('❌ [ApiService] Cloudflare等待失败:', error.message);
      // 失败也继续执行
    }
  }

  /**
   * 检测是否为Cloudflare保护
   */
  private isCloudflareProtection(error: any): boolean {
    if (error.response?.status === 403) {
      const data = error.response?.data || '';
      const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
      // 检测Cloudflare特征
      if (dataStr.includes('Just a moment') ||
          dataStr.includes('cf-mitigated') ||
          error.response?.headers?.['cf-mitigated'] === 'challenge') {
        return true;
      }
    }
    return false;
  }

  /**
   * 获取所有可能的User-ID请求头（兼容各种API站点）
   */
  private getAllUserIdHeaders(userId: string): Record<string, string> {
    return {
      'New-API-User': userId,
      'Veloera-User': userId,
      'User-id': userId,
      'voapi-user': userId,
      'X-User-Id': userId
    };
  }

  /**
   * 通用的带Cloudflare回退的HTTP GET请求
   * @param url 请求URL
   * @param headers 请求头
   * @param site 站点配置
   * @param timeout 超时时间（秒）
   * @param parseResponse 响应解析函数
   * @returns 解析后的数据
   */
  private async fetchWithBrowserFallback<T>(
    url: string,
    headers: Record<string, string>,
    site: SiteConfig,
    timeout: number,
    parseResponse: (data: any) => T,
    sharedPage?: any
  ): Promise<{ result: T; page?: any; pageRelease?: () => void }> {
    console.log('📡 [ApiService] 发起请求:', url);
    
    try {
      // 第一步：尝试axios直接请求
      const response = await axios.get(url, {
        timeout: timeout * 1000,
        headers
      });
      
      console.log('✅ [ApiService] axios请求成功');
      return { result: parseResponse(response.data), page: sharedPage };
      
    } catch (error: any) {
      console.error('❌ [ApiService] axios请求失败:', {
        message: error.message,
        status: error.response?.status
      });
      
      // 第二步：检测是否为Cloudflare保护
      if (this.isCloudflareProtection(error)) {
        console.log('🛡️ [ApiService] 检测到Cloudflare保护，切换到浏览器模式...');
        
        // 确保有必要的认证信息
        if (!this.tokenService || !site.system_token || !site.user_id) {
          console.error('❌ [ApiService] 缺少必要的认证信息，无法使用浏览器模式');
          throw error;
        }
        
        const chromeManager = (this.tokenService as any).chromeManager;
        if (!chromeManager) {
          console.error('❌ [ApiService] ChromeManager不可用');
          throw error;
        }
        
        try {
          // 如果有共享页面，直接使用；否则创建新页面
          let page = sharedPage;
          let pageRelease: (() => void) | null = null;
          let shouldClosePage = false;
          
          if (!page) {
            console.log('🌐 [ApiService] 创建新浏览器页面...');
            const pageResult = await chromeManager.createPage(site.url);
            page = pageResult.page;
            pageRelease = pageResult.release;
            shouldClosePage = false; // 不在这里关闭，由调用者决定
            
            // 调用智能Cloudflare验证等待
            await this.waitForCloudflareChallenge(page, 600000); // 10分钟 = 600秒
          } else {
            console.log('♻️ [ApiService] 复用共享浏览器页面');
          }
          
          try {
            console.log('📡 [ApiService] 在浏览器中调用API...');
            // 在浏览器环境中调用API
            const userIdHeaders = this.getAllUserIdHeaders(site.user_id!);
            const result = await page.evaluate(
              async (apiUrl: string, requestHeaders: Record<string, string>, additionalHeaders: Record<string, string>) => {
                // 构建完整的请求头（包含所有User-ID头）
                const fullHeaders: Record<string, string> = {
                  ...requestHeaders,
                  ...additionalHeaders
                };
                
                const response = await fetch(apiUrl, {
                  method: 'GET',
                  credentials: 'include',
                  headers: fullHeaders
                });
                
                if (!response.ok) {
                  throw new Error(`HTTP ${response.status}`);
                }
                
                return await response.json();
              },
              url,
              headers,
              userIdHeaders
            );
            
            console.log('✅ [ApiService] 浏览器模式请求成功');
            // 返回页面和释放函数（如果创建了新页面）
            return { 
              result: parseResponse(result), 
              page: shouldClosePage ? undefined : page,
              pageRelease: pageRelease || undefined
            };
            
          } catch (evalError) {
            // 如果是我们创建的页面且执行失败，释放引用并关闭页面
            if (pageRelease) {
              pageRelease();
            }
            if (shouldClosePage && page) {
              await page.close();
            }
            throw evalError;
          }
          
        } catch (browserError: any) {
          console.error('❌ [ApiService] 浏览器模式也失败:', browserError.message);
          throw browserError;
        }
      }
      
      // 如果不是Cloudflare保护，直接抛出原错误
      throw error;
    }
  }

  private async getModels(site: SiteConfig, timeout: number): Promise<{ models: string[]; page?: any; pageRelease?: () => void }> {
    const hasApiKey = !!site.api_key;
    const authToken = site.api_key || site.system_token;
    
    if (!authToken) {
      console.error('❌ [ApiService] 没有可用的认证令牌');
      throw new Error('缺少认证令牌');
    }
    
    // 使用api_key时用OpenAI兼容接口，使用system_token时尝试多个用户模型接口
    const endpoints = hasApiKey 
      ? ['/v1/models']
      : [
          '/api/user/models',           // New API, One API
          '/api/user/available_models', // One API
          '/api/available_model'        // Done Hub (返回对象格式)
        ];
    
    const headers: any = {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    };
    
    // 如果使用system_token，需要添加所有User-ID headers（兼容各种站点）
    if (!hasApiKey && site.user_id) {
      const userIdHeaders = this.getAllUserIdHeaders(site.user_id);
      Object.assign(headers, userIdHeaders);
    }
    
    // 尝试所有端点
    let lastError: any = null;
    let sharedPage: any = null;
    let sharedPageRelease: (() => void) | undefined = undefined;
    
    for (const endpoint of endpoints) {
      const url = `${site.url.replace(/\/$/, '')}${endpoint}`;
      
      try {
        console.log('📡 [ApiService] 尝试获取模型列表:', {
          url,
          authMethod: hasApiKey ? 'api_key' : 'system_token (access_token)',
          endpoint
        });
        
        const result = await this.fetchWithBrowserFallback(
          url,
          headers,
          site,
          timeout,
          (data: any) => {
            // 打印完整响应结构用于调试
            console.log('📦 [ApiService] 模型列表响应结构:', {
              hasSuccess: 'success' in data,
              hasData: 'data' in data,
              isDataArray: Array.isArray(data?.data),
              dataType: typeof data?.data,
              topLevelKeys: Object.keys(data || {}),
              dataKeys: data?.data ? Object.keys(data.data) : []
            });
            
            // Done Hub可能返回空的 { success: true, message: "..." } 没有data
            // 这种情况说明该站点没有可用模型或需要特殊权限
            if (!data || !('data' in data)) {
              console.warn('⚠️ [ApiService] 响应中没有data字段，可能需要特殊权限或该站点无模型');
              return [];
            }
            
            // 格式1: Done Hub嵌套data { success: true, data: { data: [...], total_count } }
            if (data?.data?.data && Array.isArray(data.data.data)) {
              const models = data.data.data.map((m: any) => m.id || m.name || m);
              console.log(`✅ [ApiService] 成功获取 ${models.length} 个模型 (data.data.data格式) ✅`);
              return models;
            }
            
            // 格式2: { success: true, data: [...] } 或 { data: [...] }
            if (data?.data && Array.isArray(data.data)) {
              const models = data.data.map((m: any) => m.id || m.name || m);
              console.log(`✅ [ApiService] 成功获取 ${models.length} 个模型 (data数组格式)`);
              return models;
            }
            
            // 格式3: { success: true, data: { models: [...] } }
            if (data?.data?.models && Array.isArray(data.data.models)) {
              const models = data.data.models.map((m: any) => m.id || m.name || m);
              console.log(`✅ [ApiService] 成功获取 ${models.length} 个模型 (data.models格式)`);
              return models;
            }
            
            // 格式4: 直接数组 [...]
            if (Array.isArray(data)) {
              const models = data.map((m: any) => m.id || m.name || m);
              console.log(`✅ [ApiService] 成功获取 ${models.length} 个模型 (直接数组格式)`);
              return models;
            }
            
            // 格式5: { models: [...] } 直接字段
            if (data?.models && Array.isArray(data.models)) {
              const models = data.models.map((m: any) => m.id || m.name || m);
              console.log(`✅ [ApiService] 成功获取 ${models.length} 个模型 (models字段)`);
              return models;
            }
            
            // 格式6: Done Hub /api/available_model 对象格式
            // { success: true, data: { "ModelName1": {...}, "ModelName2": {...} } }
            if (data?.success && data?.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
              // 检查是否为 Done Hub 格式（对象的值包含 price 或 groups 字段）
              const values = Object.values(data.data);
              if (values.length > 0) {
                const firstValue = values[0] as any;
                if (firstValue && (firstValue.price || firstValue.groups)) {
                  // 模型名称就是对象的 keys
                  const models = Object.keys(data.data);
                  console.log(`✅ [ApiService] 成功获取 ${models.length} 个模型 (Done Hub对象格式)`);
                  return models;
                }
              }
            }
            
            console.warn('⚠️ [ApiService] 未识别的响应格式，返回空数组');
            console.log('   完整响应:', JSON.stringify(data).substring(0, 200));
            return [];
          }
        );
        
        // 如果成功获取到模型，返回结果
        if (result.result && result.result.length > 0) {
          return { 
            models: result.result, 
            page: result.page,
            pageRelease: result.pageRelease
          };
        }
        
        // 如果返回空数组，尝试下一个端点
        console.log(`ℹ️ [ApiService] 端点 ${endpoint} 返回空模型列表，尝试下一个端点...`);
        
        // 保存page和pageRelease以便后续复用
        sharedPage = result.page;
        sharedPageRelease = result.pageRelease;
        
      } catch (error: any) {
        console.warn(`⚠️ [ApiService] 端点 ${endpoint} 失败:`, error.message);
        lastError = error;
        continue;
      }
    }
    
    // 所有端点都失败，抛出最后一个错误或返回空结果
    if (lastError) {
      console.error('❌ [ApiService] 所有模型接口都失败');
    }
    
    return { models: [], page: sharedPage, pageRelease: sharedPageRelease };
  }

  private async getBalanceAndUsage(site: SiteConfig, timeout: number, sharedPage?: any): Promise<{ balance?: number; todayUsage?: number } | undefined> {
    console.log('💰 [ApiService] 获取余额和今日消费...');
    
    const authToken = site.system_token || site.api_key;
    
    if (!authToken || !site.user_id) {
      console.warn('⚠️ [ApiService] 缺少认证信息');
      return undefined;
    }
    
    try {
      // 并行获取余额和今日消费，传入共享页面
      const [balance, todayUsage] = await Promise.all([
        this.fetchBalance(site, timeout, authToken, sharedPage),
        this.fetchTodayUsageFromLogs(site, timeout, sharedPage)
      ]);
      
      return { balance, todayUsage };
    } catch (error: any) {
      console.error('❌ [ApiService] 获取余额失败:', error.message);
      return undefined;
    }
  }

  /**
   * 获取账户余额（简化版）
   */
  private async fetchBalance(
    site: SiteConfig,
    timeout: number,
    authToken: string,
    sharedPage?: any
  ): Promise<number | undefined> {
    const endpoints = ['/api/user/self', '/api/user/dashboard'];
    
    for (const endpoint of endpoints) {
      try {
        const url = `${site.url.replace(/\/$/, '')}${endpoint}`;
        const headers: any = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'Pragma': 'no-cache'
        };
        
        // 添加所有User-ID头（兼容各种站点）
        const userIdHeaders = this.getAllUserIdHeaders(site.user_id!);
        Object.assign(headers, userIdHeaders);
        
        // 使用通用的带回退的请求方法，传入共享页面
        const result = await this.fetchWithBrowserFallback(
          url,
          headers,
          site,
          timeout,
          (data: any) => this.extractBalance(data),
          sharedPage
        );
        
        const balance = result.result;
        
        if (balance !== undefined) {
          return balance;
        }
      } catch (error: any) {
        console.log(`⚠️ [ApiService] 端点 ${endpoint} 获取余额失败，尝试下一个...`);
        continue;
      }
    }
    
    return undefined;
  }

  private extractBalance(data: any): number | undefined {
    // 检查是否为无限额度
    if (data?.data?.unlimited_quota === true) return -1;
    
    // 多路径尝试（按优先级排序，参考all-api-hub）
    const paths = [
      'data.quota',                    // 最常见 (New API, Veloera)
      'data.total_available',          // One Hub
      'data.user_info.quota',          // 嵌套格式
      'data.balance',                  // 某些站点
      'data.remain_quota',             // 剩余额度
      'data.total_balance',            // 总余额
      'data.available_quota',          // 可用额度
      'quota',                         // 直接字段
      'balance'                        // 直接字段
    ];

    for (const path of paths) {
      const value = this.getNestedValue(data, path);
      if (typeof value === 'number' && value !== null && value !== undefined) {
        // 根据数值大小判断是否需要转换
        // 如果>1000，认为是以内部单位存储（1 USD = 500000单位）
        const converted = value > 1000 ? value / 500000 : value;
        console.log(`✅ [ApiService] 从 ${path} 提取余额: ${converted} (原始值: ${value})`);
        return converted;
      }
    }
    
    console.warn('⚠️ [ApiService] 未找到余额字段');
    return undefined;
  }

  private extractTodayUsage(data: any): number | undefined {
    // 查找今日消费字段（多路径尝试）
    const paths = [
      'data.today_quota_consumption',          // New API
      'data.user_info.today_quota_consumption', // 嵌套格式
      'data.today_consumption',                // 某些站点
      'data.today_used',                       // 某些站点
      'today_quota_consumption',               // 直接字段
      'today_consumption',                     // 直接字段
      'today_used'                             // 直接字段
    ];

    for (const path of paths) {
      const value = this.getNestedValue(data, path);
      if (typeof value === 'number' && value !== null && value !== undefined) {
        // 根据数值大小判断是否需要转换
        const converted = value > 1000 ? value / 500000 : value;
        console.log(`✅ [ApiService] 从 ${path} 提取今日消费: ${converted} (原始值: ${value})`);
        return converted;
      }
    }
    
    console.warn('⚠️ [ApiService] 未找到今日消费字段，返回0');
    return 0; // 默认返回0而不是undefined
  }

  /**
   * 获取今日时间戳范围（UTC+8时区）
   */
  private getTodayTimestampRange(): { start: number; end: number } {
    const today = new Date();
    
    // 今日开始时间戳
    today.setHours(0, 0, 0, 0);
    const start = Math.floor(today.getTime() / 1000);
    
    // 今日结束时间戳
    today.setHours(23, 59, 59, 999);
    const end = Math.floor(today.getTime() / 1000);
    
    return { start, end };
  }

  /**
   * 聚合日志数据计算今日消费
   */
  private aggregateUsageData(items: LogItem[]): number {
    const totalQuota = items.reduce((acc, item) => acc + (item.quota || 0), 0);
    // 转换为美元（除以500000）
    return totalQuota / 500000;
  }

  /**
   * 获取今日消费数据（通过日志API）
   */
  private async fetchTodayUsageFromLogs(
    site: SiteConfig,
    timeout: number,
    sharedPage?: any
  ): Promise<number> {
    try {
      const authToken = site.system_token || site.api_key;
      if (!authToken || !site.user_id) {
        console.log('⚠️ [ApiService] 缺少认证信息，跳过今日消费查询');
        return 0;
      }

      const { start: startTimestamp, end: endTimestamp } = this.getTodayTimestampRange();
      
      let currentPage = 1;
      const maxPages = 100; // 最多查询10页
      const pageSize = 100; // 每页100条
      let totalConsumption = 0;

      console.log(`📊 [ApiService] 开始查询今日消费: ${new Date(startTimestamp * 1000).toLocaleString()} ~ ${new Date(endTimestamp * 1000).toLocaleString()}`);

      // 循环获取所有分页数据
      while (currentPage <= maxPages) {
        const params = new URLSearchParams({
          p: currentPage.toString(),
          page_size: pageSize.toString(),
          type: '0',
          token_name: '',
          model_name: '',
          start_timestamp: startTimestamp.toString(),
          end_timestamp: endTimestamp.toString(),
          group: ''
        });

        const logUrl = `${site.url.replace(/\/$/, '')}/api/log/self?${params.toString()}`;
        
        const headers: any = {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Pragma': 'no-cache'
        };
        
        // 添加所有User-ID头（兼容各种站点）
        const userIdHeaders = this.getAllUserIdHeaders(site.user_id!);
        Object.assign(headers, userIdHeaders);

        try {
          // 使用通用的带回退的请求方法，传入共享页面
          const result = await this.fetchWithBrowserFallback<LogResponse>(
            logUrl,
            headers,
            site,
            timeout,
            (data: any) => {
              if (!data.success || !data.data) {
                throw new Error('日志响应格式错误');
              }
              return data as LogResponse;
            },
            sharedPage
          );
          
          const logData = result.result;

          const items = logData.data.items || [];
          const currentPageItemCount = items.length;

          // 聚合当前页数据
          const pageConsumption = this.aggregateUsageData(items);
          totalConsumption += pageConsumption;

          console.log(`📄 [ApiService] 第${currentPage}页: ${currentPageItemCount}条记录, 消费: $${pageConsumption.toFixed(4)}`);

          // 检查是否还有更多数据
          const totalPages = Math.ceil((logData.data.total || 0) / pageSize);
          if (currentPage >= totalPages || currentPageItemCount === 0) {
            console.log(`✅ [ApiService] 日志查询完成，共${currentPage}页`);
            break;
          }

          currentPage++;
        } catch (error: any) {
          console.error(`❌ [ApiService] 日志查询异常(第${currentPage}页):`, error.message);
          break;
        }
      }

      if (currentPage > maxPages) {
        console.log(`⚠️ [ApiService] 达到最大分页限制(${maxPages}页)，停止查询`);
      }

      console.log(`💰 [ApiService] 今日总消费: $${totalConsumption.toFixed(4)}`);
      return totalConsumption;

    } catch (error: any) {
      console.error('❌ [ApiService] 获取今日消费失败:', error.message);
      return 0;
    }
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * 保存缓存显示数据到TokenStorage
   */
  private async saveCachedDisplayData(siteUrl: string, detectionResult: DetectionResult): Promise<void> {
    if (!this.tokenStorage) return;
    
    try {
      // 根据URL查找站点账号
      let account = await this.tokenStorage.getAccountByUrl(siteUrl);
      
      // 如果找不到account，创建一个新的
      if (!account) {
        console.log('⚠️ [ApiService] 未找到对应站点账号，创建新账号...');
        
        // 从config.json查找对应的SiteConfig
        const config = await this.getConfigBySiteUrl(siteUrl);
        if (!config) {
          console.log('❌ [ApiService] 未找到对应的SiteConfig，无法创建账号');
          return;
        }
        
        // 创建新的SiteAccount
        account = {
          id: this.tokenStorage.generateId(),
          site_name: config.name || detectionResult.name,
          site_url: siteUrl,
          site_type: 'newapi',  // 默认类型
          user_id: parseInt(config.user_id || '0'),
          username: config.user_id || 'unknown',
          access_token: config.system_token || '',
          created_at: Date.now(),
          updated_at: Date.now(),
          last_sync_time: 0,
          exchange_rate: 7.0
        };
        
        console.log('✅ [ApiService] 已创建新账号:', account.site_name);
      }
      
      // 构建缓存数据
      const cachedData = {
        quota: detectionResult.balance !== undefined ? detectionResult.balance : (account.cached_display_data?.quota || 0),
        today_quota_consumption: detectionResult.todayUsage !== undefined ? detectionResult.todayUsage : (account.cached_display_data?.today_quota_consumption || 0),
        today_prompt_tokens: account.cached_display_data?.today_prompt_tokens || 0,
        today_completion_tokens: account.cached_display_data?.today_completion_tokens || 0,
        today_requests_count: account.cached_display_data?.today_requests_count || 0,
        models: detectionResult.models || [],
        apiKeys: detectionResult.apiKeys,
        userGroups: detectionResult.userGroups,
        modelPricing: detectionResult.modelPricing,
        lastRefresh: Date.now(),
        can_check_in: detectionResult.can_check_in  // 保存签到状态
      };
      
      // 更新账号
      account.cached_display_data = cachedData;
      account.last_sync_time = Date.now();
      account.updated_at = Date.now();
      
      // 保存到存储
      await this.tokenStorage.saveAccount(account);
      console.log('✅ [ApiService] 缓存数据已保存到 token-storage.json');
      
    } catch (error: any) {
      console.error('❌ [ApiService] 保存缓存数据失败:', error.message);
      throw error;
    }
  }

  /**
   * 从config.json获取站点配置
   */
  private async getConfigBySiteUrl(siteUrl: string): Promise<any> {
    try {
      const fs = require('fs/promises');
      const path = require('path');
      const { app } = require('electron');
      
      const userDataPath = app.getPath('userData');
      const configPath = path.join(userDataPath, 'config.json');
      
      const data = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(data);
      
      // 通过URL匹配查找站点
      const targetOrigin = new URL(siteUrl).origin;
      const site = config.sites?.find((s: any) => {
        try {
          return new URL(s.url).origin === targetOrigin;
        } catch {
          return false;
        }
      });
      
      return site || null;
      
    } catch (error: any) {
      console.error('❌ [ApiService] 读取config.json失败:', error.message);
      return null;
    }
  }
}