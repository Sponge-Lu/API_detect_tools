/**
 * 令牌服务类 - 精简重构版
 * 核心职责：
 * 1. 初始化站点账号（一次性从浏览器获取数据）
 * 2. 刷新显示数据（使用access_token调用API）
 * 3. 验证令牌有效性
 */

import axios from 'axios';
import { ChromeManager } from './chrome-manager';
import type {
  SiteAccount,
  CachedDisplayData,
  RefreshAccountResult,
  HealthCheckResult
} from './types/token';

export class TokenService {
  private chromeManager: ChromeManager;

  constructor(chromeManager: ChromeManager) {
    this.chromeManager = chromeManager;
  }

  /**
   * 初始化站点账号 - 一次性从浏览器获取所有必要数据
   * 这是添加新站点时的唯一入口
   * 
   * @param baseUrl 站点URL
   * @returns 完整的站点账号信息
   */
  async initializeSiteAccount(baseUrl: string): Promise<SiteAccount> {
    console.log('🚀 [TokenService] ========== 开始初始化站点账号 ==========');
    console.log('📍 [TokenService] 站点URL:', baseUrl);
    
    try {
      // 步骤1: 从localStorage获取核心数据（支持API回退）
      console.log('📖 [TokenService] 步骤1: 读取用户数据（localStorage优先，API回退）...');
      const localData = await this.chromeManager.getLocalStorageData(baseUrl);
      
      if (!localData.userId) {
        throw new Error('无法获取用户ID，请确保已登录并刷新页面');
      }
      
      console.log('✅ [TokenService] 已获取用户基础信息:');
      console.log('   - 用户ID:', localData.userId);
      console.log('   - 用户名:', localData.username || 'unknown');
      console.log('   - 系统名称:', localData.systemName || '未设置');
      console.log('   - 数据来源:', localData.systemName ? 'localStorage' : 'API回退');
      
      // 步骤2: 如果没有access_token，尝试创建
      let accessToken = localData.accessToken;
      
      if (!accessToken) {
        console.log('⚠️ [TokenService] 未找到access_token，尝试创建...');
        console.log('🔧 [TokenService] 步骤2: 调用 /api/user/token 创建令牌');
        
        try {
          accessToken = await this.createAccessToken(baseUrl, localData.userId);
          console.log('✅ [TokenService] 令牌创建成功');
        } catch (error: any) {
          // 如果创建失败，记录错误但继续（某些站点可能需要手动生成token）
          console.error('❌ [TokenService] 令牌创建失败:', error.message);
          throw new Error(`无法创建访问令牌: ${error.message}。请在网页中手动生成Token后重试。`);
        }
      } else {
        console.log('✅ [TokenService] 使用已有的access_token');
      }
      
      // 步骤3: 构建SiteAccount对象
      const now = Date.now();
      const siteAccount: SiteAccount & { 
        supportsCheckIn?: boolean;
        canCheckIn?: boolean;
      } = {
        id: `account_${now}_${Math.random().toString(36).substring(2, 11)}`,
        site_name: localData.systemName || new URL(baseUrl).hostname,
        site_url: baseUrl,
        site_type: 'newapi', // 默认类型，后续可通过检测API响应判断
        user_id: localData.userId,
        username: localData.username || 'unknown',
        access_token: accessToken,
        created_at: now,
        updated_at: now,
        last_sync_time: 0,
        exchange_rate: 7.0, // 默认汇率
        
        // 签到信息（从localStorage读取）
        supportsCheckIn: localData.supportsCheckIn,
        canCheckIn: localData.canCheckIn,
        
        // 兼容旧字段结构
        account_info: {
          id: localData.userId,
          access_token: accessToken,
          username: localData.username || 'unknown',
          quota: 0,
          today_prompt_tokens: 0,
          today_completion_tokens: 0,
          today_quota_consumption: 0,
          today_requests_count: 0
        },
        
        // 保存签到支持状态（用于SiteEditor显示）
        supports_check_in: localData.supportsCheckIn,
        can_check_in: localData.canCheckIn
      };
      
      console.log('🎉 [TokenService] ========== 站点初始化完成 ==========');
      console.log('📊 [TokenService] 账号信息:');
      console.log('   - ID:', siteAccount.id);
      console.log('   - 站点名:', siteAccount.site_name);
      console.log('   - 用户ID:', siteAccount.user_id);
      console.log('   - 用户名:', siteAccount.username);
      console.log('   - 支持签到:', siteAccount.supportsCheckIn ?? '未知');
      console.log('   - 可签到:', siteAccount.canCheckIn ?? '未知');
      
      return siteAccount;
      
    } catch (error: any) {
      console.error('❌ [TokenService] 站点初始化失败:', error.message);
      throw error;
    }
  }

  /**
   * 创建访问令牌
   * 内部方法：通过Cookie认证调用 /api/user/token
   * 
   * @param baseUrl 站点URL
   * @param userId 用户ID
   * @returns 访问令牌
   */
  private async createAccessToken(baseUrl: string, userId: number): Promise<string> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const url = `${cleanBaseUrl}/api/user/token`;
    
    console.log('🔧 [TokenService] 创建访问令牌...');
    console.log('📍 [TokenService] URL:', url);
    console.log('🆔 [TokenService] User ID:', userId);
    
    // 使用浏览器环境调用API（携带Cookie）
    const browser = (this.chromeManager as any).browser;
    if (!browser) {
      throw new Error('浏览器未启动');
    }

    const pages = await browser.pages();
    if (pages.length === 0) {
      throw new Error('没有打开的页面');
    }

    const page = pages[0];
    
    // 确保在正确的域名下
    const currentUrl = await page.url();
    try {
      const pageHostname = new URL(currentUrl).hostname;
      const targetHostname = new URL(baseUrl).hostname;
      if (pageHostname !== targetHostname) {
        console.log('🔄 [TokenService] 导航到目标站点...');
        await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 10000 });
      }
    } catch (err) {
      console.warn('⚠️ [TokenService] 域名检查失败，继续尝试:', err);
    }

    // 在浏览器上下文中调用API
    try {
      const result = await page.evaluate(async (apiUrl: string, uid: number) => {
        const response = await fetch(apiUrl, {
          method: 'GET',
          credentials: 'include', // 携带Cookie
          headers: {
            'Content-Type': 'application/json',
            'New-API-User': uid.toString(),
            'Veloera-User': uid.toString(),
            'voapi-user': uid.toString(),
            'User-id': uid.toString(),
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache'
          }
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`HTTP ${response.status}: ${response.statusText} - ${text.substring(0, 200)}`);
        }

        const responseText = await response.text();
        const data = JSON.parse(responseText);
        
        if (!data.success || !data.data) {
          throw new Error(data.message || '创建令牌失败');
        }

        return data.data as string;
      }, url, userId);

      console.log('✅ [TokenService] 令牌创建成功，长度:', result.length);
      return result;
      
    } catch (error: any) {
      console.error('❌ [TokenService] 创建令牌失败:', error.message);
      
      // 提供友好的错误提示
      if (error.message.includes('401')) {
        throw new Error('Cookie认证失败，登录可能已过期');
      } else if (error.message.includes('403')) {
        throw new Error('权限不足，无法创建访问令牌');
      } else if (error.message.includes('404')) {
        throw new Error('该站点不支持自动创建访问令牌');
      } else if (error.message.includes('<!doctype') || error.message.includes('not valid JSON')) {
        throw new Error('该站点需要手动生成Token');
      } else {
        throw error;
      }
    }
  }

  /**
   * 刷新显示数据
   * 使用access_token调用API获取最新的余额、使用量等信息
   * 
   * @param account 站点账号
   * @returns 刷新结果（包含缓存数据）
   */
  async refreshDisplayData(account: SiteAccount): Promise<RefreshAccountResult> {
    console.log('🔄 [TokenService] 刷新显示数据...');
    console.log('📍 [TokenService] 站点:', account.site_name);
    console.log('🆔 [TokenService] 用户ID:', account.user_id);
    
    try {
      // 并行获取所有显示数据
      const [accountData, apiKeys, userGroups, modelPricing] = await Promise.allSettled([
        this.fetchAccountData(account.site_url, account.user_id, account.access_token),
        this.fetchApiTokens(account.site_url, account.user_id, account.access_token),
        this.fetchUserGroups(account.site_url, account.user_id, account.access_token),
        this.fetchModelPricing(account.site_url, account.user_id, account.access_token)
      ]);

      // 构建缓存数据
      const cachedData: CachedDisplayData = {
        quota: 0,
        today_quota_consumption: 0,
        today_prompt_tokens: 0,
        today_completion_tokens: 0,
        today_requests_count: 0,
        lastRefresh: Date.now()
      };

      // 处理账户数据
      if (accountData.status === 'fulfilled' && accountData.value) {
        cachedData.quota = accountData.value.quota || 0;
        cachedData.today_quota_consumption = accountData.value.today_quota_consumption || 0;
        cachedData.today_prompt_tokens = accountData.value.today_prompt_tokens || 0;
        cachedData.today_completion_tokens = accountData.value.today_completion_tokens || 0;
        cachedData.today_requests_count = accountData.value.today_requests_count || 0;
        cachedData.can_check_in = accountData.value.can_check_in;
      }

      // 处理API密钥列表
      if (apiKeys.status === 'fulfilled' && apiKeys.value) {
        cachedData.apiKeys = apiKeys.value;
      }

      // 处理用户分组
      if (userGroups.status === 'fulfilled' && userGroups.value) {
        cachedData.userGroups = userGroups.value;
      }

      // 处理模型定价
      if (modelPricing.status === 'fulfilled' && modelPricing.value) {
        cachedData.modelPricing = modelPricing.value;
        
        // 从模型定价中提取可用模型列表
        if (modelPricing.value?.data && typeof modelPricing.value.data === 'object') {
          cachedData.models = Object.keys(modelPricing.value.data);
          console.log(`   - 从定价数据中提取 ${cachedData.models.length} 个模型`);
        }
      }

      console.log('✅ [TokenService] 数据刷新成功');
      console.log('   - 余额:', cachedData.quota);
      console.log('   - 今日消费:', cachedData.today_quota_consumption);
      console.log('   - API Keys:', cachedData.apiKeys?.length || 0);
      console.log('   - 模型数量:', cachedData.models?.length || 0);

      return {
        success: true,
        data: cachedData,
        healthStatus: {
          status: 'healthy',
          message: '数据刷新成功'
        }
      };

    } catch (error: any) {
      console.error('❌ [TokenService] 数据刷新失败:', error.message);
      
      return {
        success: false,
        healthStatus: {
          status: 'error',
          message: error.message
        }
      };
    }
  }

  /**
   * 验证令牌是否有效
   * 
   * @param account 站点账号
   * @returns 是否有效
   */
  async validateToken(account: SiteAccount): Promise<boolean> {
    try {
      // 尝试调用API验证令牌
      await this.fetchAccountData(account.site_url, account.user_id, account.access_token);
      return true;
    } catch (error: any) {
      console.error('❌ [TokenService] 令牌验证失败');
      return false;
    }
  }

  /**
   * 检查站点是否支持签到功能（通过 /api/status）
   * 这是最准确的方式，因为check_in_enabled由站点管理员配置
   * 支持浏览器模式以绕过 Cloudflare
   * 
   * @param baseUrl 站点URL
   * @param page 可选的浏览器页面（用于绕过Cloudflare）
   * @returns 是否支持签到
   */
  async checkSiteSupportsCheckIn(baseUrl: string, page?: any): Promise<boolean> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const url = `${cleanBaseUrl}/api/status`;
    
    try {
      console.log('🔍 [TokenService] 检查站点配置:', url);
      
      // 优先使用浏览器模式（如果有共享页面）
      if (page) {
        console.log('♻️ [TokenService] 使用浏览器页面获取站点配置');
        try {
          const result = await page.evaluate(async (apiUrl: string) => {
            const response = await fetch(apiUrl, {
              method: 'GET',
              credentials: 'include'
            });
            return await response.json();
          }, url);
          
          const checkInEnabled = result?.data?.check_in_enabled === true;
          console.log(`${checkInEnabled ? '✅' : 'ℹ️'} [TokenService] 站点${checkInEnabled ? '支持' : '不支持'}签到功能 (check_in_enabled=${checkInEnabled})`);
          return checkInEnabled;
        } catch (browserError: any) {
          console.warn('⚠️ [TokenService] 浏览器模式获取站点配置失败:', browserError.message);
          // 浏览器模式失败，回退到axios
        }
      }
      
      // axios 模式
      const response = await axios.get(url, {
        timeout: 10000,
        validateStatus: (status) => status < 500
      });
      
      // 检查是否返回HTML（Cloudflare拦截）
      if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE')) {
        console.log('🛡️ [TokenService] 检测到Cloudflare拦截，无法获取站点配置');
        return false;
      }
      
      // 调试：打印完整响应结构
      console.log('📦 [TokenService] /api/status 响应结构:', {
        hasSuccess: 'success' in response.data,
        successValue: response.data?.success,
        hasData: 'data' in response.data,
        dataType: typeof response.data?.data,
        checkInEnabledValue: response.data?.data?.check_in_enabled,
        checkInEnabledType: typeof response.data?.data?.check_in_enabled
      });
      
      // 标准响应：{ success: true, data: { check_in_enabled: boolean, ... } }
      const checkInEnabled = response.data?.data?.check_in_enabled === true;
      console.log(`${checkInEnabled ? '✅' : 'ℹ️'} [TokenService] 站点${checkInEnabled ? '支持' : '不支持'}签到功能 (check_in_enabled=${checkInEnabled})`);
      return checkInEnabled;
      
    } catch (error: any) {
      console.log('⚠️ [TokenService] 无法获取站点配置:', error.message);
      return false;
    }
  }

  /**
   * 获取签到状态
   * 根据API文档：GET /api/user/check_in_status
   * 注意：调用此方法前应先用 checkSiteSupportsCheckIn 确认站点支持签到
   * 
   * @param baseUrl 站点URL
   * @param userId 用户ID
   * @param accessToken 访问令牌
   * @param page 可选的浏览器页面
   * @returns 签到状态信息
   */
  async fetchCheckInStatus(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page?: any
  ): Promise<boolean | undefined> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const url = `${cleanBaseUrl}/api/user/check_in_status`;
    
    try {
      console.log('🔍 [TokenService] 获取签到状态:', url);
      
      // 优先使用浏览器模式（如果有共享页面）
      if (page) {
        console.log('♻️ [TokenService] 使用浏览器页面获取签到状态');
        try {
          const userIdHeaders = this.getAllUserIdHeaders(userId);
          const result = await page.evaluate(
            async (apiUrl: string, token: string, additionalHeaders: Record<string, string>) => {
              const headers: Record<string, string> = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                ...additionalHeaders
              };
              
              const response = await fetch(apiUrl, {
                method: 'GET',
                credentials: 'include',
                headers: headers
              });
              return await response.json();
            },
            url,
            accessToken,
            userIdHeaders
          );
          
          // 解析浏览器返回的结果
          if (result?.success && result?.data) {
            const canCheckIn = result.data.can_check_in;
            const checkedInDays = result.data.checked_in_days || 0;
            
            if (typeof canCheckIn === 'boolean') {
              console.log(`✅ [TokenService] 签到状态(浏览器模式): ${canCheckIn ? '可签到' : '已签到'}, 连续签到${checkedInDays}天`);
              return canCheckIn;
            }
          }
          
          console.warn('⚠️ [TokenService] 浏览器模式返回数据格式不符合预期');
          return undefined;
          
        } catch (browserError: any) {
          console.warn('⚠️ [TokenService] 浏览器模式获取签到状态失败:', browserError.message);
          // 浏览器模式失败，回退到axios
        }
      }
      
      // axios 模式
      const response = await axios.get(url, {
        headers: this.createRequestHeaders(userId, accessToken, baseUrl),
        timeout: 10000,
        validateStatus: (status) => status < 500  // 接受所有非5xx响应
      });
      
      // 检查是否返回HTML（Cloudflare拦截）
      if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE')) {
        console.log('🛡️ [TokenService] 检测到Cloudflare拦截签到状态接口');
        return undefined;
      }
      
      // 标准响应格式：{ success: true, data: { can_check_in: boolean, checked_in_days: number, ... } }
      if (response.data?.success && response.data?.data) {
        const canCheckIn = response.data.data.can_check_in;
        const checkedInDays = response.data.data.checked_in_days || 0;
        
        if (typeof canCheckIn === 'boolean') {
          console.log(`✅ [TokenService] 签到状态: ${canCheckIn ? '可签到' : '已签到'}, 连续签到${checkedInDays}天`);
          return canCheckIn;
        } else {
          console.warn('⚠️ [TokenService] can_check_in 不是布尔值:', canCheckIn);
        }
      } else {
        console.warn('⚠️ [TokenService] 响应格式不符合预期');
      }
      
      return undefined;
    } catch (error: any) {
      const status = error.response?.status;
      console.error('❌ [TokenService] 获取签到状态失败:', {
        status,
        message: error.message
      });
      
      // 404 = 接口不存在，说明该站点不支持签到功能
      if (status === 404) {
        console.log('ℹ️ [TokenService] 该站点不支持签到功能（接口不存在）');
        return undefined;
      }
      return undefined;
    }
  }

  /**
   * 执行签到操作
   * 根据API文档：POST /api/user/check_in
   * 
   * @param baseUrl 站点URL
   * @param userId 用户ID
   * @param accessToken 访问令牌
   * @returns 签到结果
   */
  async checkIn(
    baseUrl: string,
    userId: number,
    accessToken: string
  ): Promise<{ 
    success: boolean; 
    message: string;
    needManualCheckIn?: boolean;  // 是否需要手动签到
    reward?: number;  // 签到奖励（内部单位）
  }> {
    console.log('📝 [TokenService] 执行签到操作...');
    console.log('📍 [TokenService] 站点:', baseUrl);
    console.log('🆔 [TokenService] 用户ID:', userId);
    
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    
    // 标准端点（根据API文档）
    const url = `${cleanBaseUrl}/api/user/check_in`;
    
    try {
      console.log(`🔍 [TokenService] 签到端点: ${url}`);
      
      const response = await axios.post(
        url,
        {},  // POST请求体为空（根据文档）
        {
          headers: this.createRequestHeaders(userId, accessToken, baseUrl),
          timeout: 15000,  // 增加超时时间
          validateStatus: (status) => status < 500  // 接受所有非5xx响应
        }
      );
      
      console.log('📦 [TokenService] 签到响应:', {
        success: response.data?.success,
        message: response.data?.message,
        hasReward: !!response.data?.data?.reward
      });
      
      // 标准响应格式：{ success: true, message: "签到成功", data: { reward: 5000 } }
      if (response.data?.success === true) {
        const reward = response.data.data?.reward;
        let message = response.data.message || '签到成功！';
        
        // 如果有奖励，添加到消息中
        if (reward && typeof reward === 'number') {
          const rewardInDollars = (reward / 500000).toFixed(4);
          message += `\n🎁 获得奖励: $${rewardInDollars}`;
        }
        
        console.log(`✅ [TokenService] 签到成功: ${message}`);
        return {
          success: true,
          message: message,
          reward: reward
        };
      } 
      
      // 签到失败的情况
      if (response.data?.success === false) {
        const errorMsg = response.data.message || '签到失败';
        console.log(`ℹ️ [TokenService] 签到失败: ${errorMsg}`);
        
        // 检查是否需要人机验证或手动签到
        const needManual = errorMsg.includes('验证') || 
                          errorMsg.includes('人机') || 
                          errorMsg.includes('captcha') ||
                          errorMsg.includes('challenge') ||
                          errorMsg.includes('已签到');
        
        return {
          success: false,
          message: errorMsg,
          needManualCheckIn: needManual
        };
      }
      
      // 未知响应格式
      console.warn('⚠️ [TokenService] 未知的响应格式');
      return {
        success: false,
        message: '签到响应格式异常，请尝试手动签到',
        needManualCheckIn: true
      };
      
    } catch (error: any) {
      const status = error.response?.status;
      console.error(`❌ [TokenService] 签到请求失败:`, {
        status,
        message: error.message,
        data: error.response?.data
      });
      
      // 404 = 接口不存在
      if (status === 404) {
        return {
          success: false,
          message: '该站点不支持签到功能（接口不存在）',
          needManualCheckIn: false
        };
      }
      
      // 401/403 = 认证失败
      if (status === 401 || status === 403) {
        return {
          success: false,
          message: '认证失败，请检查 access_token 是否有效',
          needManualCheckIn: true
        };
      }
      
      // 其他错误
      const errorMsg = error.response?.data?.message || error.message || '签到失败';
      return {
        success: false,
        message: `签到失败: ${errorMsg}`,
        needManualCheckIn: true
      };
    }
  }

  /**
   * 获取账户数据（余额、今日使用量等）
   */
  private async fetchAccountData(
    baseUrl: string,
    userId: number,
    accessToken: string
  ): Promise<{
    quota: number;
    today_quota_consumption: number;
    today_prompt_tokens: number;
    today_completion_tokens: number;
    today_requests_count: number;
    can_check_in?: boolean;
  }> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const url = `${cleanBaseUrl}/api/user/self`;
    
    const response = await axios.get(url, {
      headers: this.createRequestHeaders(userId, accessToken),
      timeout: 10000
    });

    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.message || '获取账户数据失败');
    }

    const data = response.data.data;
    return {
      quota: data.quota || 0,
      today_quota_consumption: data.today_quota_consumption || 0,
      today_prompt_tokens: data.today_prompt_tokens || 0,
      today_completion_tokens: data.today_completion_tokens || 0,
      today_requests_count: data.today_requests_count || 0,
      can_check_in: data.can_check_in
    };
  }

  /**
   * 获取API令牌列表
   */
  async fetchApiTokens(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page?: any
  ): Promise<any[]> {
    console.log('🔑 [TokenService] 获取API Keys...', { hasPage: !!page });
    
    // 如果提供了page，优先使用浏览器环境
    if (page) {
      console.log('♻️ [TokenService] 使用共享浏览器页面获取API Keys');
      return await this.fetchApiTokensInBrowser(baseUrl, userId, accessToken, page);
    }
    
    // 否则使用axios
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const urls = [
      // Done Hub格式（page参数 + keyword + order）
      `${cleanBaseUrl}/api/token/?page=1&size=100&keyword=&order=-id`,
      // New API格式（p参数，页码从1开始）
      `${cleanBaseUrl}/api/token/?p=1&size=100`,
      // One Hub格式（p参数，页码从0开始）
      `${cleanBaseUrl}/api/token/?p=0&size=100`,
      // 简化格式（无分页参数）
      `${cleanBaseUrl}/api/token/`
    ];

    for (const url of urls) {
      try {
        const response = await axios.get(url, {
          headers: this.createRequestHeaders(userId, accessToken, baseUrl),
          timeout: 10000
        });

        // 打印完整响应结构用于调试
        console.log('📦 [TokenService] API Keys响应结构:', {
          hasSuccess: 'success' in response.data,
          successValue: response.data?.success,
          hasData: 'data' in response.data,
          isDataArray: Array.isArray(response.data?.data),
          dataType: typeof response.data?.data,
          hasItems: !!response.data?.data?.items,
          topLevelKeys: Object.keys(response.data || {}),
          dataKeys: response.data?.data ? Object.keys(response.data.data) : []
        });

        let tokens: any[] = [];
        
        // 格式1: 直接数组
        if (Array.isArray(response.data)) {
          tokens = response.data;
          console.log('   响应格式: 直接数组');
        } 
        // 格式2: Done Hub嵌套data { success: true, data: { data: [...], page, size, total_count } }
        else if (response.data?.data?.data && Array.isArray(response.data.data.data)) {
          tokens = response.data.data.data;
          console.log('   响应格式: Done Hub嵌套data (data.data.data数组) ✅');
        }
        // 格式3: Done Hub分页items { data: { items: [...], total: N } }
        else if (response.data?.data?.items && Array.isArray(response.data.data.items)) {
          tokens = response.data.data.items;
          console.log('   响应格式: Done Hub分页items (data.items)');
        } 
        // 格式4: New API简单包装 { data: [...] }
        else if (response.data?.data && Array.isArray(response.data.data)) {
          tokens = response.data.data;
          console.log('   响应格式: New API简单包装 (data数组)');
        }
        // 格式5: 嵌套list { success: true, data: { list: [...] } }
        else if (response.data?.data?.list && Array.isArray(response.data.data.list)) {
          tokens = response.data.data.list;
          console.log('   响应格式: 嵌套list (data.list)');
        }
        // 格式6: tokens字段 { data: { tokens: [...] } }
        else if (response.data?.data?.tokens && Array.isArray(response.data.data.tokens)) {
          tokens = response.data.data.tokens;
          console.log('   响应格式: tokens字段 (data.tokens)');
        }
        // 格式7: { data: { data: null/[] } } - 空数据
        else if (response.data?.data && typeof response.data.data === 'object') {
          console.log('   响应格式: 对象格式（可能为空）');
          tokens = [];
        }

        console.log(`📊 [TokenService] URL ${url} axios获取到 ${tokens.length} 个tokens`);

        // 标准化处理：将空的 group 字段设置为 "default"
        tokens = tokens.map(token => {
          if (!token.group || token.group.trim() === '') {
            token.group = 'default';
          }
          return token;
        });

        // 如果获取到数据或已是最后一个URL，返回结果
        if (tokens.length > 0 || url === urls[urls.length - 1]) {
          return tokens;
        }
      } catch (error: any) {
        console.log(`⚠️ [TokenService] URL ${url} axios失败:`, {
          status: error.response?.status,
          message: error.message
        });
        
        // 如果是403错误且有共享页面，直接使用浏览器模式
        if (error.response?.status === 403 && page) {
          console.log('🛡️ [TokenService] 检测到403错误，使用共享浏览器页面获取API Keys...');
          try {
            return await this.fetchApiTokensInBrowser(baseUrl, userId, accessToken, page);
          } catch (browserError: any) {
            console.error('❌ [TokenService] 浏览器模式获取API Keys失败:', browserError.message);
          }
        }
        continue;
      }
    }

    return [];
  }

  /**
   * 在浏览器环境中获取API令牌
   */
  private async fetchApiTokensInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page: any
  ): Promise<any[]> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const urls = [
      // Done Hub格式（page参数 + keyword + order）
      `${cleanBaseUrl}/api/token/?page=1&size=100&keyword=&order=-id`,
      // New API格式（p参数，页码从1开始）
      `${cleanBaseUrl}/api/token/?p=1&size=100`,
      // One Hub格式（p参数，页码从0开始）
      `${cleanBaseUrl}/api/token/?p=0&size=100`,
      // 简化格式（无分页参数）
      `${cleanBaseUrl}/api/token/`
    ];

    const userIdHeaders = this.getAllUserIdHeaders(userId);
    console.log(`🔑 [TokenService] 尝试${urls.length}个API Keys URL...`);

    for (const url of urls) {
      try {
        console.log(`📡 [TokenService] 浏览器获取: ${url}`);
        const result = await page.evaluate(
          async (apiUrl: string, token: string, additionalHeaders: Record<string, string>) => {
            const response = await fetch(apiUrl, {
              method: 'GET',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...additionalHeaders,
                'Pragma': 'no-cache'
              }
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
          },
          url,
          accessToken,
          userIdHeaders
        );

        console.log(`📦 [TokenService] API Keys响应结构:`, {
          isArray: Array.isArray(result),
          hasData: !!result?.data,
          dataIsArray: Array.isArray(result?.data),
          hasItems: !!result?.data?.items,
          keys: Object.keys(result || {})
        });

        let tokens: any[] = [];
        
        // 格式1: 直接数组
        if (Array.isArray(result)) {
          tokens = result;
          console.log('   响应格式: 直接数组');
        } 
        // 格式2: Done Hub嵌套data { success: true, data: { data: [...], page, size } }
        else if (result?.data?.data && Array.isArray(result.data.data)) {
          tokens = result.data.data;
          console.log('   响应格式: Done Hub嵌套data (data.data数组) ✅');
        }
        // 格式3: Done Hub分页items { data: { items: [...], total: N } }
        else if (result?.data?.items && Array.isArray(result.data.items)) {
          tokens = result.data.items;
          console.log('   响应格式: Done Hub分页items (data.items)');
        } 
        // 格式4: New API简单包装 { data: [...] }
        else if (result?.data && Array.isArray(result.data)) {
          tokens = result.data;
          console.log('   响应格式: New API简单包装 (data数组)');
        }
        // 格式5: 嵌套list { success: true, data: { list: [...] } }
        else if (result?.data?.list && Array.isArray(result.data.list)) {
          tokens = result.data.list;
          console.log('   响应格式: 嵌套list (data.list)');
        }
        // 格式6: tokens字段 { data: { tokens: [...] } }
        else if (result?.data?.tokens && Array.isArray(result.data.tokens)) {
          tokens = result.data.tokens;
          console.log('   响应格式: tokens字段 (data.tokens)');
        }

        console.log(`✅ [TokenService] URL ${url} 获取到 ${tokens.length} 个tokens`);
        
        // 标准化处理：将空的 group 字段设置为 "default"
        tokens = tokens.map(token => {
          if (!token.group || token.group.trim() === '') {
            token.group = 'default';
          }
          return token;
        });
        
        // 如果获取到数据或已是最后一个URL，返回结果
        if (tokens.length > 0 || url === urls[urls.length - 1]) {
          return tokens;
        }
      } catch (error: any) {
        console.error(`❌ [TokenService] URL ${url} 失败:`, error.message);
        continue;
      }
    }

    console.warn('⚠️ [TokenService] 所有URL都失败，返回空数组');
    return [];
  }

  /**
   * 获取用户分组信息
   */
  async fetchUserGroups(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page?: any
  ): Promise<Record<string, { desc: string; ratio: number }>> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const urls = [
      `${cleanBaseUrl}/api/user/self/groups`,  // New API, Veloera, Super-API
      `${cleanBaseUrl}/api/user_group_map`,    // One Hub, Done Hub
      `${cleanBaseUrl}/api/group`              // One API (回退)
    ];

    // 如果提供了page，使用浏览器环境
    if (page) {
      return await this.fetchUserGroupsInBrowser(baseUrl, userId, accessToken, page);
    }

    for (const url of urls) {
      try {
        console.log(`📡 [TokenService] 尝试获取用户分组: ${url}`);
        const response = await axios.get(url, {
          headers: this.createRequestHeaders(userId, accessToken, baseUrl),
          timeout: 10000
        });

        // New API 格式: { success: true, data: { "default": {...}, "vip": {...} } }
        if (response.data?.success && response.data?.data && typeof response.data.data === 'object') {
          console.log('✅ [TokenService] 用户分组获取成功 (New API格式)');
          
          // 检查是否为Done Hub格式（有name和ratio字段）
          const firstValue = Object.values(response.data.data)[0] as any;
          if (firstValue && ('name' in firstValue || 'ratio' in firstValue)) {
            // Done Hub 格式: { data: { default: { id, symbol, name, ratio, enable, ... } }, success: true }
            console.log('   格式类型: Done Hub');
            console.log('   原始分组数据:', response.data.data);
            const groups: Record<string, { desc: string; ratio: number }> = {};
            for (const [key, value] of Object.entries(response.data.data)) {
              const group = value as any;
              // 只添加启用的分组
              if (group.enable !== false) {  // undefined 或 true 都算启用
                groups[key] = {
                  desc: group.name || group.desc || key,
                  ratio: group.ratio || 1
                };
              }
            }
            console.log('   转换后分组:', groups);
            return groups;
          } else {
            // New API 格式: { data: { "default": { desc: "...", ratio: 1 } } }
            console.log('   格式类型: New API');
            return response.data.data;
          }
        }
        
        // One API 格式: { success: true, data: ["default", "vip"] } - 只有分组名列表
        if (response.data?.success && Array.isArray(response.data.data)) {
          console.log('✅ [TokenService] 用户分组获取成功 (One API格式 - 数组)');
          const groups: Record<string, { desc: string; ratio: number }> = {};
          response.data.data.forEach((groupName: string) => {
            groups[groupName] = {
              desc: groupName,
              ratio: 1
            };
          });
          return groups;
        }
        
        // 直接返回对象格式（无success字段）
        if (response.data && typeof response.data === 'object' && !response.data.success) {
          console.log('✅ [TokenService] 用户分组获取成功 (直接对象格式)');
          return response.data;
        }
      } catch (error: any) {
        console.warn(`⚠️ [TokenService] URL ${url} 失败:`, error.message);
        continue;
      }
    }

    // 所有URL都失败，尝试浏览器模式
    if (this.isCloudflareError(urls[0]) && page) {
      console.log('🛡️ [TokenService] 检测到Cloudflare，使用共享浏览器页面获取用户分组...');
      try {
        return await this.fetchUserGroupsInBrowser(baseUrl, userId, accessToken, page);
      } catch (browserError: any) {
        console.error('❌ [TokenService] 浏览器模式也失败:', browserError.message);
      }
    }

    return {};
  }

  /**
   * 在浏览器环境中获取用户分组
   */
  private async fetchUserGroupsInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page: any
  ): Promise<Record<string, { desc: string; ratio: number }>> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const urls = [
      `${cleanBaseUrl}/api/user/self/groups`,  // New API, Veloera, Super-API
      `${cleanBaseUrl}/api/user_group_map`,    // One Hub, Done Hub
      `${cleanBaseUrl}/api/group`              // One API (回退)
    ];
    
    const userIdHeaders = this.getAllUserIdHeaders(userId);
    
    for (const url of urls) {
      try {
        console.log(`📡 [TokenService] 浏览器获取用户分组: ${url}`);
        const result = await page.evaluate(
          async (apiUrl: string, token: string, additionalHeaders: Record<string, string>) => {
            const response = await fetch(apiUrl, {
              method: 'GET',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...additionalHeaders
              }
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
          },
          url,
          accessToken,
          userIdHeaders
        );

        // New API 格式: { success: true, data: { "default": {...}, "vip": {...} } }
        if (result?.success && result?.data && typeof result.data === 'object') {
          console.log('✅ [TokenService] 浏览器获取成功 (New API格式)');
          
          // 检查是否为Done Hub格式（有name和ratio字段）
          const firstValue = Object.values(result.data)[0] as any;
          if (firstValue && ('name' in firstValue || 'ratio' in firstValue)) {
            // Done Hub 格式
            console.log('   格式类型: Done Hub');
            const groups: Record<string, { desc: string; ratio: number }> = {};
            for (const [key, value] of Object.entries(result.data)) {
              const group = value as any;
              // 只添加启用的分组
              if (group.enable !== false) {  // undefined 或 true 都算启用
                groups[key] = {
                  desc: group.name || group.desc || key,
                  ratio: group.ratio || 1
                };
              }
            }
            return groups;
          } else {
            // New API 格式
            console.log('   格式类型: New API');
            return result.data;
          }
        }
        
        // One API 格式: { success: true, data: ["default", "vip"] } - 只有分组名列表
        if (result?.success && Array.isArray(result.data)) {
          console.log('✅ [TokenService] 浏览器获取成功 (One API格式 - 数组)');
          const groups: Record<string, { desc: string; ratio: number }> = {};
          result.data.forEach((groupName: string) => {
            groups[groupName] = {
              desc: groupName,
              ratio: 1
            };
          });
          return groups;
        }
        
        // 直接对象格式
        if (result && typeof result === 'object' && !result.success) {
          console.log('✅ [TokenService] 浏览器获取成功 (直接对象格式)');
          return result;
        }
      } catch (error: any) {
        console.warn(`⚠️ [TokenService] 浏览器URL ${url} 失败:`, error.message);
        continue;
      }
    }

    return {};
  }

  /**
   * 获取模型定价信息
   */
  async fetchModelPricing(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page?: any
  ): Promise<any> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const urls = [
      `${cleanBaseUrl}/api/pricing`,          // New API
      `${cleanBaseUrl}/api/available_model`   // Done Hub, One Hub
    ];

    // 如果提供了page，使用浏览器环境
    if (page) {
      return await this.fetchModelPricingInBrowser(baseUrl, userId, accessToken, page);
    }

    for (const url of urls) {
      try {
        console.log(`📡 [TokenService] 尝试获取模型定价: ${url}`);
        const response = await axios.get(url, {
          headers: this.createRequestHeaders(userId, accessToken, baseUrl),
          timeout: 10000
        });

        console.log(`📦 [TokenService] 模型定价响应结构:`, {
          url,
          hasSuccess: 'success' in response.data,
          successValue: response.data?.success,
          hasData: 'data' in response.data,
          dataType: typeof response.data?.data,
          isDataArray: Array.isArray(response.data?.data),
          dataLength: Array.isArray(response.data?.data) ? response.data.data.length : 'N/A',
          firstKey: response.data?.data && typeof response.data.data === 'object' ? Object.keys(response.data.data)[0] : 'N/A'
        });

        // 检查响应数据是否存在
        if (response.data) {
          // New API /api/pricing 格式: { success: true, data: [...数组] }
          if (response.data?.success && response.data?.data && Array.isArray(response.data.data)) {
            console.log('✅ [TokenService] 模型定价获取成功 (New API数组格式)');
            // 将数组转换为以model_name为key的对象
            const pricing: any = { data: {} };
            response.data.data.forEach((model: any) => {
              const modelName = model.model_name || model.model;
              if (modelName) {
                // 保留原始字段，不在后端计算价格
                pricing.data[modelName] = {
                  quota_type: model.quota_type || 0,
                  model_ratio: model.model_ratio || 1,
                  model_price: model.model_price || 0,
                  completion_ratio: model.completion_ratio || 1,
                  enable_groups: model.enable_groups || [],
                  model_description: model.model_description || ''
                };
              }
            });
            return pricing;
          }
          
          // Done Hub /api/available_model 格式: { success: true, data: { "GLM-4.5": { price: {...}, groups: [...] } } }
          if (response.data?.success && response.data?.data && typeof response.data.data === 'object' && !Array.isArray(response.data.data)) {
            const firstValue = Object.values(response.data.data)[0] as any;
            
            // 判断是否为Done Hub/One Hub格式（有price对象）
            if (firstValue && firstValue.price) {
              console.log('✅ [TokenService] 模型定价获取成功 (Done Hub/One Hub对象格式)');
              console.log('📝 [TokenService] 示例模型数据:', {
                firstModelName: Object.keys(response.data.data)[0],
                firstModelData: firstValue
              });
              
              // 转换 Done Hub/One Hub 格式到标准格式
              const pricing: any = { data: {} };
              let sampleConverted: any = null;
              
              for (const [modelName, modelInfo] of Object.entries(response.data.data)) {
                const info = modelInfo as any;
                if (info.price) {
                  // quota_type: 'times' = 1 (按次), 'tokens' = 0 (按量)
                  const quotaType = info.price.type === 'times' ? 1 : 0;
                  
                  // 保留原始字段，价格直接来自API
                  const converted = {
                    quota_type: quotaType,
                    type: info.price.type,  // 保留原始type字段
                    model_ratio: 1,  // Done Hub/One Hub 不使用 model_ratio
                    completion_ratio: info.price.output && info.price.input ? info.price.output / info.price.input : 1,
                    enable_groups: info.groups || [],  // Done Hub/One Hub 使用 groups 字段
                    // Done Hub/One Hub 总是把价格放到 model_price 对象中（不管按量还是按次）
                    model_price: {
                      input: info.price.input,
                      output: info.price.output
                    }
                  };
                  
                  pricing.data[modelName] = converted;
                  
                  // 保存第一个转换结果用于调试
                  if (!sampleConverted) {
                    sampleConverted = { modelName, converted };
                  }
                }
              }
              
              console.log('📝 [TokenService] 转换后示例:', sampleConverted);
              console.log(`📊 [TokenService] 共转换 ${Object.keys(pricing.data).length} 个模型`);
              return pricing;
            }
          }
          
          console.log('⚠️ [TokenService] 未识别的定价格式，返回空定价');
          return { data: {} };
        }
      } catch (error: any) {
        console.warn(`⚠️ [TokenService] URL ${url} 失败:`, {
          status: error.response?.status,
          message: error.message
        });
        continue;
      }
    }

    // 所有URL都失败，尝试浏览器模式
    if (!page) {
      console.log('🛡️ [TokenService] axios获取失败，尝试浏览器模式获取模型定价...');
      try {
        const browserPage = await this.chromeManager.createPage(baseUrl);
        try {
          await browserPage.waitForSelector('body', { timeout: 10000 });
          await new Promise(resolve => setTimeout(resolve, 2000));
          return await this.fetchModelPricingInBrowser(baseUrl, userId, accessToken, browserPage);
        } finally {
          await browserPage.close();
        }
      } catch (browserError: any) {
        console.error('❌ [TokenService] 浏览器模式也失败:', browserError.message);
      }
    }

    console.warn('⚠️ [TokenService] 所有方式都无法获取模型定价，返回空定价（该站点可能不支持定价查询）');
    return { data: {} };
  }

  /**
   * 在浏览器环境中获取模型定价
   */
  private async fetchModelPricingInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page: any
  ): Promise<any> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const urls = [
      `${cleanBaseUrl}/api/pricing`,          // New API
      `${cleanBaseUrl}/api/available_model`   // Done Hub
    ];
    
    const userIdHeaders = this.getAllUserIdHeaders(userId);
    
    for (const url of urls) {
      try {
        console.log(`📡 [TokenService] 浏览器获取模型定价: ${url}`);
        const result = await page.evaluate(
          async (apiUrl: string, token: string, additionalHeaders: Record<string, string>) => {
            const response = await fetch(apiUrl, {
              method: 'GET',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...additionalHeaders
              }
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
          },
          url,
          accessToken,
          userIdHeaders
        );

        // 检查响应数据
        if (result) {
          // Done Hub /api/available_model 格式
          if (result?.success && result?.data && typeof result.data === 'object') {
            const firstValue = Object.values(result.data)[0] as any;
            
            // 判断是否为Done Hub/One Hub格式（有price对象）
            if (firstValue && firstValue.price) {
              console.log('✅ [TokenService] 浏览器获取成功 (Done Hub/One Hub格式)');
              const pricing: any = { data: {} };
              for (const [modelName, modelInfo] of Object.entries(result.data)) {
                const info = modelInfo as any;
                if (info.price) {
                  // quota_type: 'times' = 1 (按次), 'tokens' = 0 (按量)
                  const quotaType = info.price.type === 'times' ? 1 : 0;
                  
                  // 保留原始字段，价格直接来自API
                  pricing.data[modelName] = {
                    quota_type: quotaType,
                    type: info.price.type,  // 保留原始type字段
                    model_ratio: 1,  // Done Hub/One Hub 不使用 model_ratio
                    completion_ratio: info.price.output && info.price.input ? info.price.output / info.price.input : 1,
                    enable_groups: info.groups || [],  // Done Hub/One Hub 使用 groups 字段
                    // Done Hub/One Hub 总是把价格放到 model_price 对象中（不管按量还是按次）
                    model_price: {
                      input: info.price.input,
                      output: info.price.output
                    }
                  };
                }
              }
              return pricing;
            } else if (result?.success && result?.data && Array.isArray(result.data)) {
              // New API /api/pricing 数组格式
              console.log('✅ [TokenService] 浏览器获取成功 (New API数组格式)');
              const pricing: any = { data: {} };
              result.data.forEach((model: any) => {
                const modelName = model.model_name || model.model;
                if (modelName) {
                  // 保留原始字段，不在后端计算价格
                  pricing.data[modelName] = {
                    quota_type: model.quota_type || 0,
                    model_ratio: model.model_ratio || 1,
                    model_price: model.model_price || 0,
                    completion_ratio: model.completion_ratio || 1,
                    enable_groups: model.enable_groups || [],
                    model_description: model.model_description || ''
                  };
                }
              });
              return pricing;
           // 其他格式，直接返回
              console.log('✅ [TokenService] 浏览器获取成功 (通用格式)');
                    } else {
         return result;
            }
          }
          
          // 直接返回result（可能直接是pricing对象）
          console.log('✅ [TokenService] 浏览器获取成功 (通用格式)');
          return result;
        }
      } catch (error: any) {
        console.warn(`⚠️ [TokenService] 浏览器URL ${url} 失败:`, error.message);
        continue;
      }
    }

    return { data: {} };
  }

  /**
   * 检测是否为Cloudflare保护错误
   */
  private isCloudflareError(error: any): boolean {
    if (error.response?.status === 403) {
      const data = error.response?.data || '';
      const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
      if (dataStr.includes('Just a moment') ||
          dataStr.includes('cf-mitigated') ||
          error.response?.headers?.['cf-mitigated'] === 'challenge') {
        return true;
      }
    }
    return false;
  }

  /**
   * 获取所有可能的User-ID请求头
   * 策略：同时发送所有常见的User-ID头，让服务器自己选择识别的头
   */
  private getAllUserIdHeaders(userId: number): Record<string, string> {
    return {
      'New-API-User': userId.toString(),
      'Veloera-User': userId.toString(),
      'User-id': userId.toString(),
      'voapi-user': userId.toString(),
      'X-User-Id': userId.toString()
    };
  }

  /**
   * 根据站点URL动态选择合适的User-ID请求头名称
   */
  private getUserIdHeaderName(siteUrl: string): string {
    const hostname = siteUrl.toLowerCase();
    if (hostname.includes('veloera') || hostname.includes('velo')) {
      return 'Veloera-User';
    } else if (hostname.includes('onehub') || hostname.includes('hub')) {
      return 'User-id';
    } else {
      return 'New-API-User';
    }
  }

  /**
   * 创建请求头
   * 兼容多种站点类型
   *
   * 策略：同时发送所有常见的User-ID头，让服务器自己选择识别的头
   */
  private createRequestHeaders(
    userId: number,
    accessToken: string,
    siteUrl?: string
  ): Record<string, string> {
    // 基础请求头（所有站点通用）
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'Pragma': 'no-cache'
    };

    // 添加所有可能的User-ID头，让服务器选择识别的
    const userIdHeaders = this.getAllUserIdHeaders(userId);
    Object.assign(headers, userIdHeaders);

    return headers;
  }
}