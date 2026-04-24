/**
 * 输入: ChromeManager (浏览器自动化), HttpClient (HTTP 请求), UnifiedConfigManager (配置管理)
 * 输出: SiteAccount, CachedDisplayData, RefreshAccountResult, Token 管理结果, 签到结果, CheckinStats
 * 定位: 服务层 - 管理 Token 生命周期，处理所有站点的认证、Token 刷新和签到功能
 *
 * 签到功能支持两种站点类型:
 * - Veloera: check_in_enabled, /api/user/check_in_status, /api/user/check_in, reward
 * - New API: checkin_enabled, /api/user/checkin?month=YYYY-MM, /api/user/checkin, quota_awarded
 *
 * 签到统计功能 (New API):
 * - fetchCheckinStats: 获取当月签到统计 (今日签到金额, 当月签到次数)
 * - checkIn: 签到成功后自动获取签到统计
 * - checkInWithBrowser: 浏览器模式签到回退 (绕过 Cloudflare)
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * 令牌服务类 - 精简重构版
 * 核心职责：
 * 1. 初始化站点账号（先识别站点类型，再从浏览器获取数据）
 * 2. 刷新显示数据（使用access_token调用API）
 * 3. 验证令牌有效性
 */

import { ChromeManager } from './chrome-manager';
import { httpGet, httpPost, httpRequest } from './utils/http-client';
import { unifiedConfigManager } from './unified-config-manager';
import type {
  SiteAccount,
  CachedDisplayData,
  RefreshAccountResult,
  HealthCheckResult,
} from './types/token';
import type { CheckinStats } from '../shared/types/site';
import { getAllUserIdHeaders } from '../shared/utils/headers';
import Logger from './utils/logger';
import { runOnPageQueue } from './utils/page-exec-queue';
import { getSiteTypeProfile, resolveSiteType } from './site-type-registry';
import { detectSiteType } from './site-type-detector';
import type { SiteType } from '../shared/types/site';
import { QUOTA_CONVERSION_FACTOR } from '../shared/constants';

type CreateApiTokenPayload = {
  name: string;
  remain_quota: number;
  expired_time: number;
  unlimited_quota: boolean;
  model_limits_enabled: boolean;
  model_limits: string;
  allow_ips: string;
  group: string;
};

type TokenRequestContext = {
  browserSlot?: number;
  allowBrowserFallback?: boolean;
  challengeWaitMs?: number;
  siteType?: SiteType;
};

type InitializeSiteAccountOptions = {
  loginMode?: boolean;
  siteType?: SiteType;
};

function normalizeApiKeyValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

export function isMaskedApiKeyValue(value: unknown): boolean {
  const normalized = normalizeApiKeyValue(value);
  if (!normalized) {
    return false;
  }

  return normalized.includes('*') || normalized.includes('...') || normalized.includes('…');
}

function resolveApiKeyValue(apiKey: any): string | null {
  return normalizeApiKeyValue(apiKey?.key) || normalizeApiKeyValue(apiKey?.token);
}

function resolveApiKeyFetchId(apiKey: any): string | null {
  if (!apiKey || typeof apiKey !== 'object') {
    return null;
  }

  if (apiKey.id !== undefined && apiKey.id !== null) {
    return String(apiKey.id);
  }

  if (apiKey.token_id !== undefined && apiKey.token_id !== null) {
    return String(apiKey.token_id);
  }

  return null;
}

function withResolvedApiKeyValue(apiKey: any, rawValue: string): any {
  if ('token' in apiKey && !('key' in apiKey)) {
    return { ...apiKey, token: rawValue };
  }

  return { ...apiKey, key: rawValue };
}

function normalizeApiKeyGroup(group: unknown): string {
  if (typeof group !== 'string') {
    return 'default';
  }

  const normalized = group.trim();
  return normalized || 'default';
}

function resolveCachedApiKeyIdentity(apiKey: any): string | null {
  if (!apiKey || typeof apiKey !== 'object') {
    return null;
  }

  if (apiKey.id !== undefined && apiKey.id !== null) {
    return `id:${String(apiKey.id)}`;
  }

  if (apiKey.token_id !== undefined && apiKey.token_id !== null) {
    return `token_id:${String(apiKey.token_id)}`;
  }

  const name = normalizeApiKeyValue(apiKey.name ?? apiKey.token_name);
  if (name) {
    return `name:${name}|group:${normalizeApiKeyGroup(apiKey.group)}`;
  }

  const rawValue = resolveApiKeyValue(apiKey);
  if (rawValue && !isMaskedApiKeyValue(rawValue)) {
    return `key:${rawValue}`;
  }

  return null;
}

export function mergeApiKeysPreservingRawValue(
  existingApiKeys: any[] | undefined,
  incomingApiKeys: any[] | undefined
): any[] | undefined {
  if (!Array.isArray(incomingApiKeys)) {
    return incomingApiKeys;
  }

  if (!Array.isArray(existingApiKeys) || existingApiKeys.length === 0) {
    return incomingApiKeys;
  }

  const preservedRawByIdentity = new Map<string, string>();

  for (const existingApiKey of existingApiKeys) {
    const identity = resolveCachedApiKeyIdentity(existingApiKey);
    const rawValue = resolveApiKeyValue(existingApiKey);
    if (!identity || !rawValue || isMaskedApiKeyValue(rawValue)) {
      continue;
    }
    preservedRawByIdentity.set(identity, rawValue);
  }

  if (preservedRawByIdentity.size === 0) {
    return incomingApiKeys;
  }

  return incomingApiKeys.map(apiKey => {
    const identity = resolveCachedApiKeyIdentity(apiKey);
    if (!identity) {
      return apiKey;
    }

    const incomingValue = resolveApiKeyValue(apiKey);
    if (incomingValue && !isMaskedApiKeyValue(incomingValue)) {
      return apiKey;
    }

    const preservedRaw = preservedRawByIdentity.get(identity);
    if (!preservedRaw) {
      return apiKey;
    }

    if ('token' in apiKey && !('key' in apiKey)) {
      return { ...apiKey, token: preservedRaw };
    }

    return { ...apiKey, key: preservedRaw };
  });
}

export class TokenService {
  private chromeManager: ChromeManager;

  constructor(chromeManager: ChromeManager) {
    this.chromeManager = chromeManager;
  }

  private async requestAccessTokenInPage(
    page: any,
    baseUrl: string,
    userId: number
  ): Promise<string> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const apiUrl = `${cleanBaseUrl}/api/user/token`;

    const result = await runOnPageQueue(page, () =>
      page.evaluate(
        async (url: string, uid: number) => {
          const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'New-API-User': uid.toString(),
              'Veloera-User': uid.toString(),
              'voapi-user': uid.toString(),
              'User-id': uid.toString(),
              'Cache-Control': 'no-store',
              Pragma: 'no-cache',
            },
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(
              `HTTP ${response.status}: ${response.statusText} - ${text.substring(0, 200)}`
            );
          }

          const data = JSON.parse(await response.text());

          if (!data.success || !data.data) {
            throw new Error(data.message || '创建令牌失败');
          }

          return data.data as string;
        },
        apiUrl,
        userId
      )
    );

    Logger.info('✅ [TokenService] 令牌创建成功，长度:', result.length);
    return result;
  }

  /**
   * 初始化站点账号 - 一次性从浏览器获取所有必要数据
   * 这是添加新站点时的唯一入口
   *
   * @param baseUrl 站点URL
   * @param waitForLogin 是否等待用户登录（默认true，用于刷新场景）
   * @param maxWaitTime 最大等待时间（毫秒，默认60秒）
   * @param onStatus 状态回调函数（用于向前端发送实时状态）
   * @returns 完整的站点账号信息
   */
  async initializeSiteAccount(
    baseUrl: string,
    waitForLogin: boolean = true,
    maxWaitTime: number = 600000,
    onStatus?: (status: string) => void,
    options?: InitializeSiteAccountOptions
  ): Promise<SiteAccount> {
    Logger.info('🚀 [TokenService] ========== 开始初始化站点账号 ==========');
    Logger.info('📍 [TokenService] 站点URL:', baseUrl);
    Logger.info('⏳ [TokenService] 等待登录:', waitForLogin ? '是' : '否');

    try {
      const loginMode = options?.loginMode === true;
      onStatus?.('正在识别站点类型...');
      const siteTypeDetection =
        options?.siteType !== undefined
          ? { siteType: options.siteType, detectionMethod: 'fallback' as const }
          : await detectSiteType(baseUrl);
      let siteType = siteTypeDetection.siteType;
      let siteProfile = getSiteTypeProfile(siteType);
      Logger.info('🧭 [TokenService] 已识别站点类型:', siteType, siteTypeDetection);

      // 步骤1: 从localStorage获取核心数据（支持API回退）
      Logger.info('📖 [TokenService] 步骤1: 读取用户数据（localStorage优先，API回退）...');
      onStatus?.('正在检测登录状态...');
      const localData = await this.chromeManager.getLocalStorageData(
        baseUrl,
        waitForLogin,
        maxWaitTime,
        onStatus,
        { loginMode, siteType }
      );
      const resolvedBaseUrl = localData.resolvedBaseUrl || baseUrl;

      if (siteTypeDetection.detectionMethod === 'fallback' && localData.siteTypeHint) {
        siteType = localData.siteTypeHint;
        siteProfile = getSiteTypeProfile(siteType);
        Logger.info('🧭 [TokenService] 根据登录态线索修正站点类型:', {
          originalSiteType: siteTypeDetection.siteType,
          resolvedSiteType: siteType,
          siteTypeHint: localData.siteTypeHint,
        });
      }

      if (!localData.userId) {
        throw new Error('无法获取用户ID，请确保已登录并刷新页面');
      }

      onStatus?.('检测到已登录账号，正在获取信息...');

      Logger.info('✅ [TokenService] 已获取用户基础信息:');
      Logger.info('   - 用户ID:', localData.userId);
      Logger.info('   - 用户名:', localData.username || 'unknown');
      Logger.info('   - 系统名称:', localData.systemName || '未设置');
      Logger.info(
        '   - 数据来源:',
        localData.dataSource === 'mixed'
          ? 'localStorage + API回退'
          : localData.dataSource === 'api'
            ? 'API回退'
            : 'localStorage'
      );

      // 步骤2: 如果没有access_token，尝试创建
      let accessToken = localData.accessToken;

      if (!accessToken) {
        if (siteProfile.accessTokenMode !== 'create-if-missing') {
          throw new Error(
            `站点类型 ${siteType} 未在 localStorage 中返回有效访问令牌，请确认已完成登录。`
          );
        }

        Logger.info('⚠️ [TokenService] 未找到access_token，尝试创建...');
        Logger.info('🔧 [TokenService] 步骤2: 调用 /api/user/token 创建令牌');
        onStatus?.('正在创建访问令牌...');

        try {
          accessToken = loginMode
            ? await this.chromeManager.createAccessTokenForLogin(resolvedBaseUrl, localData.userId)
            : await this.createAccessToken(resolvedBaseUrl, localData.userId);
          if (!accessToken) {
            throw new Error('浏览器未返回有效访问令牌');
          }
          Logger.info('✅ [TokenService] 令牌创建成功');
        } catch (error: any) {
          // 如果创建失败，记录错误但继续（某些站点可能需要手动生成token）
          Logger.error('❌ [TokenService] 令牌创建失败:', error.message);
          throw new Error(`无法创建访问令牌: ${error.message}。请在网页中手动生成Token后重试。`);
        }
      } else {
        Logger.info('✅ [TokenService] 使用已有的access_token');
      }

      let apiKeys: any[] | undefined;
      let primaryApiKey = '';

      if (siteType === 'sub2api') {
        onStatus?.('正在获取 API Key...');
        try {
          apiKeys = await this.fetchApiTokens(resolvedBaseUrl, localData.userId, accessToken, {
            siteType,
          });
          primaryApiKey = normalizeApiKeyValue(resolveApiKeyValue(apiKeys?.[0])) || '';
          Logger.info('🔑 [TokenService] sub2api 初始化时预取 API Keys:', {
            count: apiKeys?.length || 0,
            hasPrimaryApiKey: !!primaryApiKey,
          });
        } catch (error: any) {
          Logger.warn(
            '⚠️ [TokenService] sub2api 初始化时获取 API Keys 失败:',
            error?.message || error
          );
        }
      }

      // 步骤3: 构建SiteAccount对象
      const now = Date.now();
      const siteName = localData.systemName || new URL(resolvedBaseUrl).hostname;
      const siteAccount: SiteAccount & {
        supportsCheckIn?: boolean;
        canCheckIn?: boolean;
        api_key?: string;
        api_keys?: any[];
      } = {
        id: `account_${now}_${Math.random().toString(36).substring(2, 11)}`,
        name: siteName,
        url: resolvedBaseUrl,
        site_name: siteName,
        site_url: resolvedBaseUrl,
        site_type: siteType,
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
          today_requests_count: 0,
        },

        // 保存签到支持状态（用于SiteEditor显示）
        supports_check_in: localData.supportsCheckIn,
        can_check_in: localData.canCheckIn,
      };

      if (primaryApiKey) {
        siteAccount.api_key = primaryApiKey;
      }
      if (apiKeys?.length) {
        siteAccount.api_keys = apiKeys;
      }

      Logger.info('🎉 [TokenService] ========== 站点初始化完成 ==========');
      Logger.info('📊 [TokenService] 账号信息:');
      Logger.info('   - ID:', siteAccount.id);
      Logger.info('   - 站点名:', siteAccount.site_name);
      Logger.info('   - 用户ID:', siteAccount.user_id);
      Logger.info('   - 用户名:', siteAccount.username);
      Logger.info('   - 支持签到:', siteAccount.supportsCheckIn ?? '未知');
      Logger.info('   - 可签到:', siteAccount.canCheckIn ?? '未知');
      Logger.info('   - API Key:', siteAccount.api_key ? '已获取' : '未获取');

      return siteAccount;
    } catch (error: any) {
      Logger.error('❌ [TokenService] 站点初始化失败:', error.message);
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

    Logger.info('🔧 [TokenService] 创建访问令牌...');
    Logger.info('📍 [TokenService] URL:', url);
    Logger.info('🆔 [TokenService] User ID:', userId);

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

    // 检查页面是否已关闭（浏览器关闭会导致页面关闭）
    if (page.isClosed()) {
      throw new Error('浏览器已关闭，操作已取消');
    }

    // 确保在正确的域名下
    const currentUrl = await page.url();
    try {
      const pageHostname = new URL(currentUrl).hostname;
      const targetHostname = new URL(baseUrl).hostname;
      if (pageHostname !== targetHostname) {
        Logger.info('🔄 [TokenService] 导航到目标站点...');
        await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 10000 });
      }
    } catch (err: any) {
      // 如果是浏览器关闭错误，直接抛出
      if (
        err.message.includes('浏览器已关闭') ||
        err.message.includes('操作已取消') ||
        page.isClosed()
      ) {
        throw new Error('浏览器已关闭，操作已取消');
      }
      Logger.warn('⚠️ [TokenService] 域名检查失败，继续尝试:', err);
    }

    // 再次检查页面是否已关闭
    if (page.isClosed()) {
      throw new Error('浏览器已关闭，操作已取消');
    }

    // 在浏览器上下文中调用API
    try {
      return await this.requestAccessTokenInPage(page, cleanBaseUrl, userId);
    } catch (error: any) {
      // 如果是浏览器关闭错误，直接抛出
      if (error.message.includes('浏览器已关闭') || error.message.includes('操作已取消')) {
        throw error;
      }

      // 检查页面是否已关闭
      if (page.isClosed()) {
        throw new Error('浏览器已关闭，操作已取消');
      }

      Logger.error('❌ [TokenService] 创建令牌失败:', error.message);

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

  async recreateAccessTokenFromBrowser(
    baseUrl: string,
    userId: number,
    context?: Pick<TokenRequestContext, 'browserSlot' | 'challengeWaitMs'>
  ): Promise<string> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    Logger.info('🔄 [TokenService] 尝试通过浏览器会话重新创建 access_token...', {
      browserSlot: context?.browserSlot ?? 0,
      userId,
    });

    const { page, release } = await this.chromeManager.createPage(cleanBaseUrl, {
      slot: context?.browserSlot,
    });

    try {
      await this.waitForCloudflareChallengeToPass(page, context?.challengeWaitMs ?? 10000);
      return await this.requestAccessTokenInPage(page, cleanBaseUrl, userId);
    } finally {
      try {
        await page.close();
      } catch {
        // ignore
      }
      release();
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
    Logger.info('🔄 [TokenService] 刷新显示数据...');
    Logger.info('📍 [TokenService] 站点:', account.site_name);
    Logger.info('🆔 [TokenService] 用户ID:', account.user_id);

    try {
      // 并行获取所有显示数据
      const [accountData, apiKeys, userGroups, modelPricing] = await Promise.allSettled([
        this.fetchAccountData(account.site_url, account.user_id, account.access_token),
        this.fetchApiTokens(account.site_url, account.user_id, account.access_token),
        this.fetchUserGroups(account.site_url, account.user_id, account.access_token),
        this.fetchModelPricing(account.site_url, account.user_id, account.access_token),
      ]);

      // 构建缓存数据
      const cachedData: CachedDisplayData = {
        quota: 0,
        today_quota_consumption: 0,
        today_prompt_tokens: 0,
        today_completion_tokens: 0,
        today_requests_count: 0,
        lastRefresh: Date.now(),
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
          Logger.info(`   - 从定价数据中提取 ${cachedData.models.length} 个模型`);
        }
      }

      Logger.info('✅ [TokenService] 数据刷新成功');
      Logger.info('   - 余额:', cachedData.quota);
      Logger.info('   - 今日消费:', cachedData.today_quota_consumption);
      Logger.info('   - API Keys:', cachedData.apiKeys?.length || 0);
      Logger.info('   - 模型数量:', cachedData.models?.length || 0);

      return {
        success: true,
        data: cachedData,
        healthStatus: {
          status: 'healthy',
          message: '数据刷新成功',
        },
      };
    } catch (error: any) {
      Logger.error('❌ [TokenService] 数据刷新失败:', error.message);

      return {
        success: false,
        healthStatus: {
          status: 'error',
          message: error.message,
        },
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
      Logger.error('❌ [TokenService] 令牌验证失败');
      return false;
    }
  }

  /**
   * 检查站点是否支持签到功能（通过 /api/status）
   * 支持两种站点类型：
   * - Veloera: check_in_enabled 字段
   * - New API: checkin_enabled 字段（无下划线）
   *
   * @param baseUrl 站点URL
   * @param page 可选的浏览器页面（用于绕过Cloudflare）
   * @returns 是否支持签到
   */
  async checkSiteSupportsCheckIn(baseUrl: string, page?: any): Promise<boolean> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const url = `${cleanBaseUrl}/api/status`;

    try {
      Logger.info('🔍 [TokenService] 检查站点配置:', url);

      // 优先使用浏览器模式（如果有共享页面）
      if (page) {
        Logger.info('♻️ [TokenService] 使用浏览器页面获取站点配置');
        try {
          const result = await runOnPageQueue(page, () =>
            page.evaluate(async (apiUrl: string) => {
              const response = await fetch(apiUrl, {
                method: 'GET',
                credentials: 'include',
              });
              return await response.json();
            }, url)
          );

          // 兼容两种站点类型：Veloera (check_in_enabled) 和 New API (checkin_enabled)
          const checkInEnabled =
            result?.data?.check_in_enabled === true || result?.data?.checkin_enabled === true;
          Logger.info(
            `${checkInEnabled ? '✅' : 'ℹ️'} [TokenService] 站点${checkInEnabled ? '支持' : '不支持'}签到功能 (check_in_enabled=${result?.data?.check_in_enabled}, checkin_enabled=${result?.data?.checkin_enabled})`
          );
          return checkInEnabled;
        } catch (browserError: any) {
          Logger.warn('⚠️ [TokenService] 浏览器模式获取站点配置失败:', browserError.message);
          // 浏览器模式失败，回退到axios
        }
      }

      // HTTP 请求（打包环境自动使用 Electron net 模块）
      const response = await httpGet(url, {
        timeout: 10000,
        validateStatus: (status: number) => status < 500,
      });

      const rawData = response.data;

      // 检查是否返回HTML/挑战页（Cloudflare 或其他站点防护）
      if (this.isBrowserChallengeResponse(rawData)) {
        Logger.info('🛡️ [TokenService] 检测到Cloudflare拦截，无法获取站点配置');
        return false;
      }

      const data = rawData && typeof rawData === 'object' ? rawData : null;

      // 调试：打印完整响应结构
      Logger.info('📦 [TokenService] /api/status 响应结构:', {
        hasSuccess: !!data && 'success' in data,
        successValue: data?.success,
        hasData: !!data && 'data' in data,
        dataType: typeof data?.data,
        checkInEnabledValue: data?.data?.check_in_enabled,
        checkinEnabledValue: data?.data?.checkin_enabled,
      });

      // 兼容两种站点类型：Veloera (check_in_enabled) 和 New API (checkin_enabled)
      const checkInEnabled =
        data?.data?.check_in_enabled === true || data?.data?.checkin_enabled === true;
      Logger.info(
        `${checkInEnabled ? '✅' : 'ℹ️'} [TokenService] 站点${checkInEnabled ? '支持' : '不支持'}签到功能 (check_in_enabled=${data?.data?.check_in_enabled}, checkin_enabled=${data?.data?.checkin_enabled})`
      );
      return checkInEnabled;
    } catch (error: any) {
      Logger.info('⚠️ [TokenService] 无法获取站点配置:', error.message);
      return false;
    }
  }

  /**
   * 获取签到状态
   * 支持两种站点类型：
   * - Veloera: GET /api/user/check_in_status -> { can_check_in: boolean }
   * - New API: GET /api/user/checkin?month=YYYY-MM -> { stats: { checked_in_today: boolean } }
   *
   * @param baseUrl 站点URL
   * @param userId 用户ID
   * @param accessToken 访问令牌
   * @param page 可选的浏览器页面
   * @returns 是否可签到（true=可签到, false=已签到, undefined=无法获取）
   */
  async fetchCheckInStatus(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page?: any,
    explicitSiteType?: SiteType
  ): Promise<boolean | undefined> {
    const endpoints = this.getCheckInEndpoints(baseUrl, 'status', explicitSiteType);

    if (endpoints.length === 0) {
      Logger.info('ℹ️ [TokenService] 当前站点类型未注册签到状态端点');
      return undefined;
    }

    for (const endpoint of endpoints) {
      try {
        Logger.info(`🔍 [TokenService] 获取签到状态 (${endpoint.type}):`, endpoint.url);

        // 优先使用浏览器模式（如果有共享页面）
        if (page) {
          Logger.info('♻️ [TokenService] 使用浏览器页面获取签到状态');
          try {
            const userIdHeaders = getAllUserIdHeaders(userId);
            const result = await runOnPageQueue(page, () =>
              page.evaluate(
                async (
                  apiUrl: string,
                  token: string,
                  additionalHeaders: Record<string, string>
                ) => {
                  const headers: Record<string, string> = {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    ...additionalHeaders,
                  };

                  const response = await fetch(apiUrl, {
                    method: 'GET',
                    credentials: 'include',
                    headers: headers,
                  });
                  return await response.json();
                },
                endpoint.url,
                accessToken,
                userIdHeaders
              )
            );

            // 解析浏览器返回的结果
            if (result?.success && result?.data) {
              // Veloera 格式: { can_check_in: boolean, checked_in_days: number }
              if (typeof result.data.can_check_in === 'boolean') {
                const canCheckIn = result.data.can_check_in;
                const checkedInDays = result.data.checked_in_days || 0;
                Logger.info(
                  `✅ [TokenService] 签到状态(浏览器模式, Veloera): ${canCheckIn ? '可签到' : '已签到'}, 连续签到${checkedInDays}天`
                );
                return canCheckIn;
              }

              // New API 格式: { enabled: boolean, stats: { checked_in_today: boolean } }
              if (result.data.stats && typeof result.data.stats.checked_in_today === 'boolean') {
                const checkedInToday = result.data.stats.checked_in_today;
                const canCheckIn = !checkedInToday; // 取反：checked_in_today=false 表示可签到
                const totalCheckins = result.data.stats.total_checkins || 0;
                Logger.info(
                  `✅ [TokenService] 签到状态(浏览器模式, New API): ${canCheckIn ? '可签到' : '已签到'}, 累计签到${totalCheckins}次`
                );
                return canCheckIn;
              }
            }

            Logger.warn('⚠️ [TokenService] 浏览器模式返回数据格式不符合预期，尝试下一个端点');
            continue;
          } catch (browserError: any) {
            Logger.warn('⚠️ [TokenService] 浏览器模式获取签到状态失败:', browserError.message);
            // 浏览器模式失败，回退到axios
          }
        }

        // HTTP 请求（打包环境自动使用 Electron net 模块）
        const response = await httpGet(endpoint.url, {
          headers: this.createRequestHeaders(userId, accessToken, baseUrl),
          timeout: 10000,
          validateStatus: (status: number) => status < 500,
        });

        // 检查是否返回HTML/挑战页（Cloudflare 或其他站点防护）
        if (this.isBrowserChallengeResponse(response.data)) {
          Logger.info('🛡️ [TokenService] 检测到Cloudflare拦截签到状态接口');
          continue;
        }

        if (response.data?.success && response.data?.data) {
          // Veloera 格式: { can_check_in: boolean, checked_in_days: number }
          if (typeof response.data.data.can_check_in === 'boolean') {
            const canCheckIn = response.data.data.can_check_in;
            const checkedInDays = response.data.data.checked_in_days || 0;
            Logger.info(
              `✅ [TokenService] 签到状态(Veloera): ${canCheckIn ? '可签到' : '已签到'}, 连续签到${checkedInDays}天`
            );
            return canCheckIn;
          }

          // New API 格式: { enabled: boolean, stats: { checked_in_today: boolean } }
          if (
            response.data.data.stats &&
            typeof response.data.data.stats.checked_in_today === 'boolean'
          ) {
            const checkedInToday = response.data.data.stats.checked_in_today;
            const canCheckIn = !checkedInToday; // 取反：checked_in_today=false 表示可签到
            const totalCheckins = response.data.data.stats.total_checkins || 0;
            Logger.info(
              `✅ [TokenService] 签到状态(New API): ${canCheckIn ? '可签到' : '已签到'}, 累计签到${totalCheckins}次`
            );
            return canCheckIn;
          }
        }

        Logger.warn(`⚠️ [TokenService] ${endpoint.type} 响应格式不符合预期，尝试下一个端点`);
      } catch (error: any) {
        const status = error.response?.status;
        Logger.info(`⚠️ [TokenService] ${endpoint.type} 端点失败:`, {
          status,
          message: error.message,
        });

        // 404 = 接口不存在，尝试下一个端点
        if (status === 404) {
          Logger.info(`ℹ️ [TokenService] ${endpoint.type} 接口不存在，尝试下一个端点`);
          continue;
        }
      }
    }

    Logger.info('ℹ️ [TokenService] 所有签到状态端点均不可用');
    return undefined;
  }

  /**
   * 执行签到操作
   * 支持两种站点类型：
   * - Veloera: POST /api/user/check_in -> { reward: number }
   * - New API: POST /api/user/checkin -> { quota_awarded: number }
   *
   * @param baseUrl 站点URL
   * @param userId 用户ID
   * @param accessToken 访问令牌
   * @returns 签到结果
   */
  async checkIn(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page?: any,
    explicitSiteType?: SiteType
  ): Promise<{
    success: boolean;
    message: string;
    needManualCheckIn?: boolean; // 是否需要手动签到
    reward?: number; // 签到奖励（内部单位）
    siteType?: 'veloera' | 'newapi'; // 站点类型（用于确定手动签到页面路径）
    checkinStats?: CheckinStats; // 签到统计数据 (New API)
    browserPage?: any; // 浏览器页面（用于后续余额刷新）
    pageRelease?: () => void; // 页面释放函数
  }> {
    Logger.info('📝 [TokenService] 执行签到操作...');
    Logger.info('📍 [TokenService] 站点:', baseUrl);
    Logger.info('🆔 [TokenService] 用户ID:', userId);

    const endpoints = this.getCheckInEndpoints(baseUrl, 'action', explicitSiteType);

    if (endpoints.length === 0) {
      return {
        success: false,
        message: '当前站点类型未注册签到端点',
        needManualCheckIn: false,
      };
    }

    let lastError: any = null;
    let lastEndpointType: 'veloera' | 'newapi' = 'veloera'; // 记录最后尝试的端点类型
    let cloudflareDetected = false; // 是否检测到 Cloudflare 拦截

    for (const endpoint of endpoints) {
      try {
        lastEndpointType = endpoint.type as 'veloera' | 'newapi';
        Logger.info(`🔍 [TokenService] 尝试签到端点 (${endpoint.type}): ${endpoint.url}`);

        const response = await httpPost(
          endpoint.url,
          {},
          {
            headers: this.createRequestHeaders(userId, accessToken, baseUrl),
            timeout: 15000,
            validateStatus: (status: number) => status < 500,
          }
        );

        // 检测 Cloudflare/挑战页拦截（响应是 HTML 而不是 JSON）
        if (this.isBrowserChallengeResponse(response.data)) {
          Logger.info(`🛡️ [TokenService] 检测到 Cloudflare 拦截签到接口 (${endpoint.type})`);
          cloudflareDetected = true;
          continue; // 尝试下一个端点
        }

        Logger.info(`📦 [TokenService] 签到响应 (${endpoint.type}):`, {
          success: response.data?.success,
          message: response.data?.message,
          hasReward: !!response.data?.data?.reward,
          hasQuotaAwarded: !!response.data?.data?.quota_awarded,
        });

        // 签到成功
        if (response.data?.success === true) {
          // Veloera 格式: { reward: number }
          const reward = response.data.data?.reward;
          // New API 格式: { quota_awarded: number }
          const quotaAwarded = response.data.data?.quota_awarded;

          let message = response.data.message || '签到成功！';
          const finalReward = reward || quotaAwarded;

          // 如果有奖励，添加到消息中
          if (finalReward && typeof finalReward === 'number') {
            const rewardInDollars = (finalReward / 500000).toFixed(4);
            message += `\n🎁 获得奖励: $${rewardInDollars}`;
          }

          Logger.info(`✅ [TokenService] 签到成功 (${endpoint.type}): ${message}`);

          // 如果是 New API 类型，获取签到统计数据
          let checkinStats: CheckinStats | undefined;
          if (endpoint.type === 'newapi') {
            try {
              checkinStats = await this.fetchCheckinStats(baseUrl, userId, accessToken, page);
              // 如果没有从 API 获取到今日签到金额，使用签到返回的 quota_awarded
              if (checkinStats && checkinStats.todayQuota === undefined && quotaAwarded) {
                checkinStats.todayQuota = quotaAwarded;
              }
            } catch (statsError: any) {
              Logger.warn('⚠️ [TokenService] 获取签到统计失败，但签到已成功:', statsError.message);
            }
          }

          return {
            success: true,
            message: message,
            reward: finalReward,
            siteType: endpoint.type as 'veloera' | 'newapi',
            checkinStats,
          };
        }

        // 签到失败的情况
        if (response.data?.success === false) {
          const errorMsg = response.data.message || '签到失败';
          Logger.info(`ℹ️ [TokenService] 签到失败 (${endpoint.type}): ${errorMsg}`);

          // 检查是否需要人机验证或手动签到
          const needManual =
            errorMsg.includes('验证') ||
            errorMsg.includes('人机') ||
            errorMsg.includes('captcha') ||
            errorMsg.includes('challenge') ||
            errorMsg.includes('已签到') ||
            errorMsg.toLowerCase().includes('turnstile');

          return {
            success: false,
            message: errorMsg,
            needManualCheckIn: needManual,
            siteType: endpoint.type as 'veloera' | 'newapi',
          };
        }

        // 未知响应格式，尝试下一个端点
        Logger.warn(`⚠️ [TokenService] ${endpoint.type} 未知的响应格式，尝试下一个端点`);
      } catch (error: any) {
        const status = error.response?.status;
        Logger.info(`⚠️ [TokenService] ${endpoint.type} 端点失败:`, {
          status,
          message: error.message,
        });

        lastError = error;

        // 404 = 接口不存在，尝试下一个端点
        if (status === 404) {
          Logger.info(`ℹ️ [TokenService] ${endpoint.type} 接口不存在，尝试下一个端点`);
          continue;
        }

        // 401 = 登录过期或未登录，403 = 权限不足（这些错误不需要尝试其他端点）
        if (status === 401) {
          return {
            success: false,
            message: '登录已过期或未登录，请重新登录站点获取凭证',
            needManualCheckIn: true,
            siteType: endpoint.type as 'veloera' | 'newapi',
          };
        }
        if (status === 403) {
          return {
            success: false,
            message: '权限不足，请检查账号状态是否正常',
            needManualCheckIn: true,
            siteType: endpoint.type as 'veloera' | 'newapi',
          };
        }

        // 其他错误，继续尝试下一个端点
        continue;
      }
    }

    // 所有端点都失败
    Logger.error('❌ [TokenService] 所有签到端点均失败');

    // 如果检测到 Cloudflare 拦截，尝试浏览器模式签到
    if (cloudflareDetected) {
      Logger.info('🛡️ [TokenService] 检测到 Cloudflare 拦截，尝试浏览器模式签到...');
      try {
        const browserResult = await this.checkInWithBrowser(
          baseUrl,
          userId,
          accessToken,
          explicitSiteType
        );
        if (browserResult.success) {
          return browserResult;
        }
        // 浏览器模式也失败，返回浏览器模式的错误信息
        return browserResult;
      } catch (browserError: any) {
        Logger.error('❌ [TokenService] 浏览器模式签到失败:', browserError.message);
        return {
          success: false,
          message: '站点开启了 Cloudflare 保护，浏览器模式签到也失败',
          needManualCheckIn: true,
          siteType: lastEndpointType,
        };
      }
    }

    if (lastError) {
      const errorMsg = lastError.response?.data?.message || lastError.message || '签到失败';
      return {
        success: false,
        message: `签到失败: ${errorMsg}`,
        needManualCheckIn: true,
        siteType: lastEndpointType,
      };
    }

    return {
      success: false,
      message: '该站点不支持签到功能（接口不存在）',
      needManualCheckIn: false,
    };
  }

  /**
   * 在浏览器环境中执行签到操作（用于绕过 Cloudflare 保护）
   * 签到成功时不关闭页面，返回页面引用供后续余额刷新使用
   *
   * @param baseUrl 站点URL
   * @param userId 用户ID
   * @param accessToken 访问令牌
   * @returns 签到结果（包含页面引用）
   */
  private async checkInWithBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    explicitSiteType?: SiteType
  ): Promise<{
    success: boolean;
    message: string;
    needManualCheckIn?: boolean;
    reward?: number;
    siteType?: 'veloera' | 'newapi';
    checkinStats?: CheckinStats;
    browserPage?: any; // 浏览器页面（签到成功时返回，供后续余额刷新使用）
    pageRelease?: () => void; // 页面释放函数
  }> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const endpoints = this.getCheckInEndpoints(baseUrl, 'action', explicitSiteType);

    if (endpoints.length === 0) {
      return {
        success: false,
        message: '当前站点类型未注册签到端点',
        needManualCheckIn: false,
      };
    }

    Logger.info('🧭 [TokenService] 浏览器模式签到...');
    Logger.info('📍 [TokenService] 站点:', cleanBaseUrl);

    // 通过 ChromeManager 创建页面
    const { page, release } = await this.chromeManager.createPage(cleanBaseUrl);

    // 用于跟踪是否需要在失败时关闭页面
    let shouldClosePage = true;

    try {
      // 确保页面前置，方便用户在 Cloudflare 页面中进行验证
      await page.bringToFront().catch(() => {});

      // 等待 Cloudflare 验证通过（如果存在）
      await this.waitForCloudflareChallengeToPass(page);
      const userIdHeaders = getAllUserIdHeaders(userId);

      let lastError: any = null;
      let lastEndpointType: 'veloera' | 'newapi' = 'veloera';

      for (const endpoint of endpoints) {
        lastEndpointType = endpoint.type as 'veloera' | 'newapi';
        Logger.info(`📡 [TokenService] 浏览器签到: ${endpoint.url}`);

        try {
          const result = await runOnPageQueue(page, () =>
            page.evaluate(
              async (apiUrl: string, token: string, additionalHeaders: Record<string, string>) => {
                try {
                  const response = await fetch(apiUrl, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${token}`,
                      ...additionalHeaders,
                      Pragma: 'no-cache',
                    },
                    body: JSON.stringify({}),
                  });

                  const status = response.status;
                  const text = await response.text();

                  try {
                    const data = JSON.parse(text);
                    return { ok: response.ok, status, isJson: true, data };
                  } catch {
                    return {
                      ok: response.ok,
                      status,
                      isJson: false,
                      textSnippet: text.slice(0, 200),
                    };
                  }
                } catch (err: any) {
                  return {
                    ok: false,
                    status: 0,
                    isJson: false,
                    error: err?.message || String(err),
                  };
                }
              },
              endpoint.url,
              accessToken,
              userIdHeaders
            )
          );

          Logger.info('📦 [TokenService] 浏览器签到结果:', result);

          // 检查是否返回 HTML（仍然被 Cloudflare 拦截）
          if (!result.isJson && this.isBrowserChallengeResponse(result.textSnippet)) {
            Logger.warn('⚠️ [TokenService] 浏览器模式仍被 Cloudflare 拦截，尝试下一个端点');
            continue;
          }

          // 签到成功
          if (result.isJson && result.data?.success === true) {
            const reward = result.data.data?.reward;
            const quotaAwarded = result.data.data?.quota_awarded;
            const finalReward = reward || quotaAwarded;

            let message = result.data.message || '签到成功！';
            if (finalReward && typeof finalReward === 'number') {
              const rewardInDollars = (finalReward / 500000).toFixed(4);
              message += `\n🎁 获得奖励: $${rewardInDollars}`;
            }

            Logger.info(`✅ [TokenService] 浏览器签到成功 (${endpoint.type}): ${message}`);

            // 如果是 New API 类型，获取签到统计数据
            let checkinStats: CheckinStats | undefined;
            if (endpoint.type === 'newapi') {
              try {
                checkinStats = await this.fetchCheckinStats(baseUrl, userId, accessToken, page);
                if (checkinStats && checkinStats.todayQuota === undefined && quotaAwarded) {
                  checkinStats.todayQuota = quotaAwarded;
                }
              } catch (statsError: any) {
                Logger.warn(
                  '⚠️ [TokenService] 获取签到统计失败，但签到已成功:',
                  statsError.message
                );
              }
            }

            // 签到成功，不关闭页面，返回页面引用供后续余额刷新使用
            shouldClosePage = false;

            return {
              success: true,
              message: message,
              reward: finalReward,
              siteType: endpoint.type as 'veloera' | 'newapi',
              checkinStats,
              browserPage: page,
              pageRelease: release,
            };
          }

          // 签到失败
          if (result.isJson && result.data?.success === false) {
            const errorMsg = result.data.message || '签到失败';
            Logger.info(`ℹ️ [TokenService] 浏览器签到失败 (${endpoint.type}): ${errorMsg}`);

            const needManual =
              errorMsg.includes('验证') ||
              errorMsg.includes('人机') ||
              errorMsg.includes('captcha') ||
              errorMsg.includes('challenge') ||
              errorMsg.includes('已签到') ||
              errorMsg.toLowerCase().includes('turnstile');

            return {
              success: false,
              message: errorMsg,
              needManualCheckIn: needManual,
              siteType: endpoint.type as 'veloera' | 'newapi',
            };
          }

          // HTTP 错误
          if (!result.ok || result.status >= 400) {
            const reason = result.isJson
              ? result.data?.message || `HTTP ${result.status}`
              : result.textSnippet || `HTTP ${result.status}`;
            Logger.warn(`⚠️ [TokenService] 浏览器签到 HTTP 错误 (${endpoint.type}):`, reason);
            lastError = new Error(reason);
            continue;
          }

          // 未知响应格式
          Logger.warn(`⚠️ [TokenService] 浏览器签到未知响应格式 (${endpoint.type})`);
          lastError = new Error('未知响应格式');
        } catch (error: any) {
          Logger.warn(`⚠️ [TokenService] 浏览器签到端点失败 (${endpoint.type}):`, error.message);
          lastError = error;
          continue;
        }
      }

      // 所有端点都失败
      if (lastError) {
        return {
          success: false,
          message: `浏览器模式签到失败: ${lastError.message}`,
          needManualCheckIn: true,
          siteType: lastEndpointType,
        };
      }

      return {
        success: false,
        message: '浏览器模式签到失败（接口不存在）',
        needManualCheckIn: true,
        siteType: lastEndpointType,
      };
    } finally {
      // 只有在失败时才关闭页面，成功时由调用者负责释放
      if (shouldClosePage) {
        try {
          await page.close();
        } catch {
          // 忽略关闭错误
        }
        release();
      }
    }
  }

  /**
   * 获取当月签到统计 (New API)
   * 调用 GET /api/user/checkin?month=YYYY-MM 获取签到统计数据
   *
   * @param baseUrl 站点URL
   * @param userId 用户ID
   * @param accessToken 访问令牌
   * @param page 可选的浏览器页面（用于绕过Cloudflare）
   * @returns 签到统计数据
   */
  async fetchCheckinStats(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page?: any
  ): Promise<CheckinStats | undefined> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM 格式
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD 格式
    const url = `${cleanBaseUrl}/api/user/checkin?month=${currentMonth}`;

    Logger.info('📊 [TokenService] 获取签到统计...');
    Logger.info('📍 [TokenService] URL:', url);

    try {
      // 优先使用浏览器模式（如果有共享页面）
      if (page) {
        Logger.info('♻️ [TokenService] 使用浏览器页面获取签到统计');
        try {
          const userIdHeaders = getAllUserIdHeaders(userId);
          const result = await runOnPageQueue(page, () =>
            page.evaluate(
              async (apiUrl: string, token: string, additionalHeaders: Record<string, string>) => {
                const headers: Record<string, string> = {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                  ...additionalHeaders,
                };

                const response = await fetch(apiUrl, {
                  method: 'GET',
                  credentials: 'include',
                  headers: headers,
                });
                return await response.json();
              },
              url,
              accessToken,
              userIdHeaders
            )
          );

          // 解析浏览器返回的结果
          if (result?.success && result?.data?.stats) {
            const stats = result.data.stats;
            let todayQuota: number | undefined;

            // 从 records 中查找今日签到金额
            if (stats.records && Array.isArray(stats.records)) {
              const todayRecord = stats.records.find(
                (r: { checkin_date: string; quota_awarded: number }) => r.checkin_date === today
              );
              if (todayRecord) {
                todayQuota = todayRecord.quota_awarded;
              }
            }

            const checkinStats: CheckinStats = {
              todayQuota,
              checkinCount: stats.checkin_count,
              totalCheckins: stats.total_checkins,
              siteType: 'newapi',
            };

            Logger.info('✅ [TokenService] 签到统计获取成功(浏览器模式):', {
              todayQuota,
              checkinCount: stats.checkin_count,
              totalCheckins: stats.total_checkins,
            });

            return checkinStats;
          }

          Logger.warn('⚠️ [TokenService] 浏览器模式返回数据格式不符合预期');
        } catch (browserError: any) {
          Logger.warn('⚠️ [TokenService] 浏览器模式获取签到统计失败:', browserError.message);
          // 浏览器模式失败，回退到axios
        }
      }

      // HTTP 请求（打包环境自动使用 Electron net 模块）
      const response = await httpGet(url, {
        headers: this.createRequestHeaders(userId, accessToken, baseUrl),
        timeout: 10000,
        validateStatus: (status: number) => status < 500,
      });

      // 检查是否返回HTML/挑战页（Cloudflare 或其他站点防护）
      if (this.isBrowserChallengeResponse(response.data)) {
        Logger.info('🛡️ [TokenService] 检测到Cloudflare拦截签到统计接口');
        return undefined;
      }

      if (response.data?.success && response.data?.data?.stats) {
        const stats = response.data.data.stats;
        let todayQuota: number | undefined;

        // 从 records 中查找今日签到金额
        if (stats.records && Array.isArray(stats.records)) {
          const todayRecord = stats.records.find(
            (r: { checkin_date: string; quota_awarded: number }) => r.checkin_date === today
          );
          if (todayRecord) {
            todayQuota = todayRecord.quota_awarded;
          }
        }

        const checkinStats: CheckinStats = {
          todayQuota,
          checkinCount: stats.checkin_count,
          totalCheckins: stats.total_checkins,
          siteType: 'newapi',
        };

        Logger.info('✅ [TokenService] 签到统计获取成功:', {
          todayQuota,
          checkinCount: stats.checkin_count,
          totalCheckins: stats.total_checkins,
        });

        return checkinStats;
      }

      Logger.warn('⚠️ [TokenService] 签到统计响应格式不符合预期');
      return undefined;
    } catch (error: any) {
      Logger.warn('⚠️ [TokenService] 获取签到统计失败:', error.message);
      return undefined;
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
    const siteType = this.resolveSiteTypeByUrl(baseUrl);

    if (siteType === 'sub2api') {
      const [meResponse, usageResponse] = await Promise.all([
        httpGet(`${cleanBaseUrl}/api/v1/auth/me`, {
          headers: this.createRequestHeaders(userId, accessToken, baseUrl),
          timeout: 10000,
        }),
        httpGet(`${cleanBaseUrl}/api/v1/usage/stats`, {
          headers: this.createRequestHeaders(userId, accessToken, baseUrl),
          timeout: 10000,
        }),
      ]);

      if (meResponse.data?.code !== 0 || !meResponse.data?.data) {
        throw new Error(meResponse.data?.message || '获取 sub2api 账户信息失败');
      }

      if (usageResponse.data?.code !== 0 || !usageResponse.data?.data) {
        throw new Error(usageResponse.data?.message || '获取 sub2api 使用量失败');
      }

      return this.parseSub2ApiAccountData(meResponse.data.data, usageResponse.data.data);
    }

    const url = `${cleanBaseUrl}/api/user/self`;

    const response = await httpGet(url, {
      headers: this.createRequestHeaders(userId, accessToken),
      timeout: 10000,
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
      can_check_in: data.can_check_in,
    };
  }

  private resolveSub2ApiGroupName(
    apiKey: any,
    userGroups?: Record<string, { id?: number | string; desc: string; ratio: number }>
  ): string {
    const directGroup = typeof apiKey?.group === 'string' ? apiKey.group.trim() : '';
    if (directGroup) {
      return directGroup;
    }

    const groupId = apiKey?.group_id ?? apiKey?.groupId ?? apiKey?.group?.id;
    if (groupId !== undefined && groupId !== null && userGroups) {
      const normalizedGroupId = String(groupId);
      for (const [groupName, groupInfo] of Object.entries(userGroups)) {
        if (groupInfo?.id !== undefined && groupInfo?.id !== null) {
          if (String(groupInfo.id) === normalizedGroupId) {
            return groupName;
          }
        }
      }
    }

    const groupNames = Object.keys(userGroups || {});
    if (groupNames.length === 1) {
      return groupNames[0];
    }

    return 'default';
  }

  private normalizeSub2ApiUsdValue(value: unknown): number | undefined {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) {
      return undefined;
    }
    return normalized;
  }

  private async fetchSub2ApiApiKeyUsageStats(
    baseUrl: string,
    accessToken: string,
    apiKeyIds: Array<number | string>
  ): Promise<Record<string, { today_actual_cost?: number; total_actual_cost?: number }>> {
    const normalizedIds = apiKeyIds
      .map(id => Number(id))
      .filter((id): id is number => Number.isFinite(id) && id > 0);

    if (normalizedIds.length === 0) {
      return {};
    }

    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const response = await httpPost(
      `${cleanBaseUrl}/api/v1/usage/dashboard/api-keys-usage`,
      {
        api_key_ids: normalizedIds,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Pragma: 'no-cache',
        },
        timeout: 10000,
      }
    );

    if (response.data?.code !== 0 || !response.data?.data?.stats) {
      throw new Error(response.data?.message || '获取 sub2api API Key 用量失败');
    }

    return response.data.data.stats;
  }

  private async enrichSub2ApiApiKeys(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokens: any[],
    siteType?: SiteType
  ): Promise<any[]> {
    const normalizedTokens = Array.isArray(tokens) ? tokens.map(token => ({ ...token })) : [];
    if (normalizedTokens.length === 0) {
      return [];
    }

    let userGroups: Record<string, { id?: number | string; desc: string; ratio: number }> = {};
    try {
      userGroups = await this.fetchUserGroups(baseUrl, userId, accessToken, undefined, siteType);
    } catch (error: any) {
      Logger.warn(
        '⚠️ [TokenService] sub2api API Key 分组映射失败，继续使用原始列表:',
        error.message
      );
    }

    let usageStats: Record<string, { today_actual_cost?: number; total_actual_cost?: number }> = {};
    try {
      usageStats = await this.fetchSub2ApiApiKeyUsageStats(
        baseUrl,
        accessToken,
        normalizedTokens
          .map(token => token?.id ?? token?.token_id)
          .filter((id): id is number | string => id !== undefined && id !== null)
      );
    } catch (error: any) {
      Logger.warn(
        '⚠️ [TokenService] sub2api API Key 用量获取失败，继续使用基础列表:',
        error.message
      );
    }

    return normalizedTokens.map(token => {
      const resolvedGroup = this.resolveSub2ApiGroupName(token, userGroups);
      const quota = this.normalizeSub2ApiUsdValue(token?.quota);
      const quotaUsed = this.normalizeSub2ApiUsdValue(token?.quota_used);
      const usage = usageStats[String(token?.id ?? token?.token_id ?? '')];
      const totalActualCost = this.normalizeSub2ApiUsdValue(usage?.total_actual_cost);
      const todayActualCost = this.normalizeSub2ApiUsdValue(usage?.today_actual_cost);
      const effectiveUsedCost = totalActualCost ?? quotaUsed;
      const remainQuotaUsd =
        quota && effectiveUsedCost !== undefined
          ? Math.max(0, quota - effectiveUsedCost)
          : undefined;
      const expiresAt = typeof token?.expires_at === 'string' ? token.expires_at : null;
      const expiredTime =
        typeof token?.expired_time === 'number'
          ? token.expired_time
          : expiresAt
            ? Math.floor(Date.parse(expiresAt) / 1000)
            : -1;

      return {
        ...token,
        group_id: token?.group_id ?? token?.group?.id ?? null,
        group: resolvedGroup,
        quota,
        quota_used: quotaUsed,
        remain_quota:
          remainQuotaUsd !== undefined
            ? Math.floor(remainQuotaUsd * QUOTA_CONVERSION_FACTOR)
            : token?.remain_quota,
        used_quota:
          effectiveUsedCost !== undefined
            ? Math.floor(effectiveUsedCost * QUOTA_CONVERSION_FACTOR)
            : token?.used_quota,
        today_actual_cost: todayActualCost,
        total_actual_cost: totalActualCost,
        unlimited_quota: quota === 0 || Boolean(token?.unlimited_quota),
        expires_at: expiresAt,
        expired_time: Number.isFinite(expiredTime) ? expiredTime : -1,
      };
    });
  }

  private buildSub2ApiCreatePayload(
    tokenData: CreateApiTokenPayload,
    userGroups: Record<string, { id?: number | string; desc: string; ratio: number }>
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      name: tokenData.name,
    };

    const groupName = typeof tokenData.group === 'string' ? tokenData.group.trim() : '';
    if (groupName) {
      const groupInfo = userGroups[groupName];
      if (groupInfo?.id !== undefined && groupInfo?.id !== null) {
        const normalizedGroupId = Number(groupInfo.id);
        payload.group_id = Number.isFinite(normalizedGroupId) ? normalizedGroupId : groupInfo.id;
      }
    }

    if (!tokenData.unlimited_quota && tokenData.remain_quota > 0) {
      payload.quota = tokenData.remain_quota / QUOTA_CONVERSION_FACTOR;
    }

    if (tokenData.expired_time > 0) {
      const expiresInMs = tokenData.expired_time * 1000 - Date.now();
      if (expiresInMs > 0) {
        payload.expires_in_days = Math.max(1, Math.ceil(expiresInMs / (24 * 60 * 60 * 1000)));
      }
    }

    return payload;
  }

  private isSub2ApiTokenExpiredResponse(payload: any): boolean {
    const code = typeof payload?.code === 'string' ? payload.code.toUpperCase() : '';
    const message = String(payload?.message || '').toLowerCase();

    return code === 'TOKEN_EXPIRED' || message.includes('token has expired');
  }

  private buildSub2ApiTokenExpiredError(payload: any): Error {
    const message = String(payload?.message || 'Token has expired');
    return new Error(
      `登录已过期或未登录，请点击"重新获取"登录站点 (sub2api API Key 接口返回: ${message})`
    );
  }

  /**
   * 获取API令牌列表
   */
  async fetchApiTokens(
    baseUrl: string,
    userId: number,
    accessToken: string,
    context?: TokenRequestContext
  ): Promise<any[]> {
    Logger.info('🔑 [TokenService] 获取API Keys...', { browserSlot: context?.browserSlot ?? 0 });

    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const siteType = this.resolveSiteTypeByUrl(baseUrl, context?.siteType);
    const profile = this.getSiteTypeProfileByUrl(baseUrl, context?.siteType);
    const urls = profile.apiTokenListEndpoints.map(endpoint => `${cleanBaseUrl}${endpoint}`);

    let lastError: any = null;
    let lastStatus: number | undefined = undefined;
    let needBrowserFallback = false;
    let sub2ApiTokenExpiredError: Error | undefined;

    for (const url of urls) {
      try {
        const response = await httpGet(url, {
          headers: this.createRequestHeaders(userId, accessToken, baseUrl, context?.siteType),
          timeout: 10000,
        });

        const rawData = response.data;
        const data = rawData && typeof rawData === 'object' ? rawData : null;

        if (this.isBrowserChallengeResponse(rawData)) {
          Logger.warn(`🛡️ [TokenService] URL ${url} 返回挑战页，改用浏览器模式获取 API Keys`);
          lastStatus = response.status;
          lastError = new Error('Browser challenge response');
          needBrowserFallback = true;
          break;
        }

        // 打印完整响应结构用于调试
        Logger.info('📦 [TokenService] API Keys响应结构:', {
          hasSuccess: !!data && 'success' in data,
          successValue: data?.success,
          codeValue: data?.code,
          messageValue: data?.message,
          hasData: !!data && 'data' in data,
          isDataArray: Array.isArray(data?.data),
          dataType: typeof data?.data,
          hasItems: !!data?.data?.items,
          topLevelKeys: Object.keys(data || {}),
          dataKeys: data?.data && typeof data.data === 'object' ? Object.keys(data.data) : [],
        });

        let tokens: any[] = [];

        if (siteType === 'sub2api' && this.isSub2ApiTokenExpiredResponse(data)) {
          sub2ApiTokenExpiredError = this.buildSub2ApiTokenExpiredError(data);
        }

        if (siteType === 'sub2api' && data?.code === 0) {
          if (Array.isArray(data?.data?.items)) {
            tokens = data.data.items;
            Logger.info('   响应格式: sub2api 分页 items');
          } else if (Array.isArray(data?.data)) {
            tokens = data.data;
            Logger.info('   响应格式: sub2api 数组');
          }
        }
        // 格式1: 直接数组
        else if (Array.isArray(rawData)) {
          tokens = rawData;
          Logger.info('   响应格式: 直接数组');
        }
        // 格式2: Done Hub嵌套data { success: true, data: { data: [...], page, size, total_count } }
        else if (data?.data?.data && Array.isArray(data.data.data)) {
          tokens = data.data.data;
          Logger.info('   响应格式: Done Hub嵌套data (data.data.data数组) ✅');
        }
        // 格式3: Done Hub分页items { data: { items: [...], total: N } }
        else if (data?.data?.items && Array.isArray(data.data.items)) {
          tokens = data.data.items;
          Logger.info('   响应格式: Done Hub分页items (data.items)');
        }
        // 格式4: New API简单包装 { data: [...] }
        else if (data?.data && Array.isArray(data.data)) {
          tokens = data.data;
          Logger.info('   响应格式: New API简单包装 (data数组)');
        }
        // 格式5: 嵌套list { success: true, data: { list: [...] } }
        else if (data?.data?.list && Array.isArray(data.data.list)) {
          tokens = data.data.list;
          Logger.info('   响应格式: 嵌套list (data.list)');
        }
        // 格式6: tokens字段 { data: { tokens: [...] } }
        else if (data?.data?.tokens && Array.isArray(data.data.tokens)) {
          tokens = data.data.tokens;
          Logger.info('   响应格式: tokens字段 (data.tokens)');
        }
        // 格式7: { data: { data: null/[] } } - 空数据
        else if (data?.data && typeof data.data === 'object') {
          Logger.info('   响应格式: 对象格式（可能为空）');
          tokens = [];
        }

        Logger.info(`📊 [TokenService] URL ${url} axios获取到 ${tokens.length} 个tokens`);

        if (siteType !== 'sub2api') {
          // 标准化处理：将空的 group 字段设置为 "default"
          tokens = tokens.map(token => {
            if (!token.group || token.group.trim() === '') {
              token.group = 'default';
            }
            return token;
          });
        }

        if (siteType === 'sub2api' && sub2ApiTokenExpiredError) {
          continue;
        }

        // 如果获取到数据或已是最后一个URL，返回结果
        if (tokens.length > 0 || url === urls[urls.length - 1]) {
          if (siteType === 'sub2api') {
            return await this.enrichSub2ApiApiKeys(
              baseUrl,
              userId,
              accessToken,
              tokens,
              context?.siteType
            );
          }
          return await this.enrichMaskedApiKeys(baseUrl, userId, accessToken, tokens, undefined, {
            browserSlot: context?.browserSlot,
            allowBrowserFallback: true,
            challengeWaitMs: 10000,
          });
        }
      } catch (error: any) {
        lastError = error;
        lastStatus = error.response?.status;

        Logger.info(`⚠️ [TokenService] URL ${url} axios失败:`, {
          status: lastStatus,
          message: error.message,
        });

        continue;
      }
    }

    if (sub2ApiTokenExpiredError) {
      throw sub2ApiTokenExpiredError;
    }

    // 如果 axios 全部失败且错误看起来像 Cloudflare/403 场景，则自动回退到浏览器模式
    if (
      needBrowserFallback ||
      (lastError && (lastStatus === 403 || this.isCloudflareError(lastError)))
    ) {
      Logger.info(
        '🛡️ [TokenService] axios 获取 API Keys 失败且疑似挑战页/Cloudflare，尝试使用浏览器模式重新获取...'
      );
      try {
        // 通过 ChromeManager 创建页面（自动管理引用计数与生命周期）
        const { page: browserPage, release } = await this.chromeManager.createPage(cleanBaseUrl, {
          slot: context?.browserSlot,
        });
        try {
          // 等待 Cloudflare 验证通过（如果存在）
          await this.waitForCloudflareChallengeToPass(browserPage);
          const tokens = await this.fetchApiTokensInBrowser(
            baseUrl,
            userId,
            accessToken,
            browserPage,
            context?.siteType
          );
          return siteType === 'sub2api'
            ? await this.enrichSub2ApiApiKeys(
                baseUrl,
                userId,
                accessToken,
                tokens,
                context?.siteType
              )
            : tokens;
        } finally {
          try {
            await browserPage.close();
          } catch {
            // 忽略关闭错误
          }
          release();
        }
      } catch (browserError: any) {
        Logger.error(
          '❌ [TokenService] 浏览器模式获取 API Keys 最终失败:',
          browserError.message || browserError
        );
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
    page: any,
    explicitSiteType?: SiteType
  ): Promise<any[]> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const siteType = this.resolveSiteTypeByUrl(baseUrl, explicitSiteType);
    const urls = this.getSiteTypeProfileByUrl(baseUrl, explicitSiteType).apiTokenListEndpoints.map(
      endpoint => `${cleanBaseUrl}${endpoint}`
    );

    const userIdHeaders = this.getSiteTypeProfileByUrl(baseUrl, explicitSiteType)
      .includeUserIdHeaders
      ? getAllUserIdHeaders(userId)
      : {};
    Logger.info(`🔑 [TokenService] 尝试${urls.length}个API Keys URL...`);

    for (const url of urls) {
      try {
        Logger.info(`📡 [TokenService] 浏览器获取: ${url}`);
        const result = await runOnPageQueue(page, () =>
          page.evaluate(
            async (apiUrl: string, token: string, additionalHeaders: Record<string, string>) => {
              const response = await fetch(apiUrl, {
                method: 'GET',
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                  ...additionalHeaders,
                  Pragma: 'no-cache',
                },
              });

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }

              return await response.json();
            },
            url,
            accessToken,
            userIdHeaders
          )
        );

        Logger.info(`📦 [TokenService] API Keys响应结构:`, {
          isArray: Array.isArray(result),
          codeValue: result?.code,
          messageValue: result?.message,
          hasData: !!result?.data,
          dataIsArray: Array.isArray(result?.data),
          hasItems: !!result?.data?.items,
          keys: Object.keys(result || {}),
        });

        let tokens: any[] = [];

        if (siteType === 'sub2api' && this.isSub2ApiTokenExpiredResponse(result)) {
          throw this.buildSub2ApiTokenExpiredError(result);
        }

        if (siteType === 'sub2api' && result?.code === 0) {
          if (Array.isArray(result?.data?.items)) {
            tokens = result.data.items;
            Logger.info('   响应格式: sub2api 分页 items');
          } else if (Array.isArray(result?.data)) {
            tokens = result.data;
            Logger.info('   响应格式: sub2api 数组');
          }
        }
        // 格式1: 直接数组
        else if (Array.isArray(result)) {
          tokens = result;
          Logger.info('   响应格式: 直接数组');
        }
        // 格式2: Done Hub嵌套data { success: true, data: { data: [...], page, size } }
        else if (result?.data?.data && Array.isArray(result.data.data)) {
          tokens = result.data.data;
          Logger.info('   响应格式: Done Hub嵌套data (data.data数组) ✅');
        }
        // 格式3: Done Hub分页items { data: { items: [...], total: N } }
        else if (result?.data?.items && Array.isArray(result.data.items)) {
          tokens = result.data.items;
          Logger.info('   响应格式: Done Hub分页items (data.items)');
        }
        // 格式4: New API简单包装 { data: [...] }
        else if (result?.data && Array.isArray(result.data)) {
          tokens = result.data;
          Logger.info('   响应格式: New API简单包装 (data数组)');
        }
        // 格式5: 嵌套list { success: true, data: { list: [...] } }
        else if (result?.data?.list && Array.isArray(result.data.list)) {
          tokens = result.data.list;
          Logger.info('   响应格式: 嵌套list (data.list)');
        }
        // 格式6: tokens字段 { data: { tokens: [...] } }
        else if (result?.data?.tokens && Array.isArray(result.data.tokens)) {
          tokens = result.data.tokens;
          Logger.info('   响应格式: tokens字段 (data.tokens)');
        }

        Logger.info(`✅ [TokenService] URL ${url} 获取到 ${tokens.length} 个tokens`);

        if (siteType !== 'sub2api') {
          // 标准化处理：将空的 group 字段设置为 "default"
          tokens = tokens.map(token => {
            if (!token.group || token.group.trim() === '') {
              token.group = 'default';
            }
            return token;
          });
        }

        // 如果获取到数据或已是最后一个URL，返回结果
        if (tokens.length > 0 || url === urls[urls.length - 1]) {
          if (siteType === 'sub2api') {
            return tokens;
          }
          return await this.enrichMaskedApiKeys(baseUrl, userId, accessToken, tokens, page, {
            allowBrowserFallback: false,
          });
        }
      } catch (error: any) {
        Logger.error(`❌ [TokenService] URL ${url} 失败:`, error.message);
        continue;
      }
    }

    Logger.warn('⚠️ [TokenService] 所有URL都失败，返回空数组');
    return [];
  }

  private async enrichMaskedApiKeys(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokens: any[],
    page?: any,
    context?: TokenRequestContext
  ): Promise<any[]> {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return tokens;
    }

    const maskedEntries = tokens
      .map((token, index) => ({
        index,
        token,
        tokenId: resolveApiKeyFetchId(token),
        rawValue: resolveApiKeyValue(token),
      }))
      .filter(entry => entry.tokenId && entry.rawValue && isMaskedApiKeyValue(entry.rawValue));

    if (maskedEntries.length === 0) {
      return tokens;
    }

    Logger.info(
      `🔍 [TokenService] 检测到 ${maskedEntries.length} 个脱敏 API Key，尝试按 ID 获取明文`
    );

    const resolvedValues = new Map<number, string>();

    await Promise.all(
      maskedEntries.map(async entry => {
        try {
          const resolvedValue = await this.resolveUsableApiKeyValue(
            baseUrl,
            userId,
            accessToken,
            entry.token,
            {
              ...context,
              page,
            }
          );

          if (!resolvedValue || isMaskedApiKeyValue(resolvedValue)) {
            return;
          }

          resolvedValues.set(entry.index, resolvedValue);
        } catch (error: any) {
          Logger.warn(
            `⚠️ [TokenService] API Key ${entry.tokenId} 明文获取失败，保留列表中的脱敏值:`,
            error?.message || error
          );
        }
      })
    );

    if (resolvedValues.size === 0) {
      return tokens;
    }

    return tokens.map((token, index) => {
      const resolvedValue = resolvedValues.get(index);
      if (!resolvedValue) {
        return token;
      }

      return withResolvedApiKeyValue(token, resolvedValue);
    });
  }

  private extractRawApiKeyValue(payload: unknown): string | null {
    const directValue = normalizeApiKeyValue(payload);
    if (directValue && !isMaskedApiKeyValue(directValue)) {
      return directValue;
    }

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const record = payload as Record<string, any>;
    const nestedData = record.data;
    const nestedNestedData =
      nestedData && typeof nestedData === 'object'
        ? (nestedData as Record<string, any>).data
        : undefined;

    const candidates = [
      record.key,
      record.token,
      nestedData,
      nestedData?.key,
      nestedData?.token,
      nestedNestedData,
      nestedNestedData?.key,
      nestedNestedData?.token,
    ];

    for (const candidate of candidates) {
      const normalized = normalizeApiKeyValue(candidate);
      if (normalized && !isMaskedApiKeyValue(normalized)) {
        return normalized;
      }
    }

    return null;
  }

  private async fetchRawApiKeyValue(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenId: string,
    page?: any
  ): Promise<string | null> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const url = `${cleanBaseUrl}/api/token/${encodeURIComponent(tokenId)}/key`;
    const methods: Array<'POST' | 'GET'> = ['POST', 'GET'];
    const preferRawApiKeyError = (
      current: (Error & { status?: number }) | null,
      next: Error & { status?: number }
    ) => {
      if (!current) {
        return next;
      }

      const currentStatus = current.status;
      const currentMessage = current.message || '';
      if (
        currentStatus === 401 ||
        currentStatus === 403 ||
        currentStatus === 0 ||
        currentMessage.includes('Browser challenge response')
      ) {
        return current;
      }

      return next;
    };

    if (page) {
      const userIdHeaders = getAllUserIdHeaders(userId);
      let lastError: (Error & { status?: number }) | null = null;

      for (const method of methods) {
        const result = await runOnPageQueue(page, () =>
          page.evaluate(
            async (
              apiUrl: string,
              token: string,
              requestMethod: 'POST' | 'GET',
              additionalHeaders: Record<string, string>
            ) => {
              try {
                const headers: Record<string, string> = {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                  ...additionalHeaders,
                  Pragma: 'no-cache',
                };

                const requestInit: RequestInit = {
                  method: requestMethod,
                  credentials: 'include',
                  headers,
                };

                if (requestMethod === 'POST') {
                  requestInit.body = JSON.stringify({});
                }

                const response = await fetch(apiUrl, requestInit);

                const status = response.status;
                const text = await response.text();

                try {
                  return { ok: response.ok, status, isJson: true, data: JSON.parse(text) };
                } catch {
                  return {
                    ok: response.ok,
                    status,
                    isJson: false,
                    textSnippet: text.slice(0, 500),
                  };
                }
              } catch (err: any) {
                return {
                  ok: false,
                  status: 0,
                  isJson: false,
                  error: err?.message || String(err),
                };
              }
            },
            url,
            accessToken,
            method,
            userIdHeaders
          )
        );

        if (!result.ok || result.status < 200 || result.status >= 300) {
          const reason = result.isJson
            ? result.data?.message || `HTTP ${result.status}`
            : result.error || result.textSnippet || `HTTP ${result.status}`;
          const error = new Error(reason) as Error & { status?: number };
          error.status = result.status;
          lastError = preferRawApiKeyError(lastError, error);
          continue;
        }

        if (!result.isJson && this.isBrowserChallengeResponse(result.textSnippet)) {
          lastError = preferRawApiKeyError(
            lastError,
            new Error('Browser challenge response') as Error & { status?: number }
          );
          continue;
        }

        const extracted = this.extractRawApiKeyValue(
          result.isJson ? result.data : result.textSnippet
        );
        if (extracted) {
          return extracted;
        }
      }

      if (lastError) {
        throw lastError;
      }

      throw new Error('Failed to resolve raw API key');
    }

    let lastError: (Error & { status?: number }) | null = null;

    for (const method of methods) {
      try {
        const response =
          method === 'POST'
            ? await httpPost(
                url,
                {},
                {
                  headers: this.createRequestHeaders(userId, accessToken, baseUrl),
                  timeout: 10000,
                  validateStatus: (status: number) => status < 500,
                }
              )
            : await httpGet(url, {
                headers: this.createRequestHeaders(userId, accessToken, baseUrl),
                timeout: 10000,
                validateStatus: (status: number) => status < 500,
              });

        if (this.isBrowserChallengeResponse(response.data)) {
          lastError = new Error('Browser challenge response');
          continue;
        }

        if (response.status < 200 || response.status >= 300) {
          const error = new Error(response.data?.message || `HTTP ${response.status}`) as Error & {
            status?: number;
          };
          error.status = response.status;
          lastError = preferRawApiKeyError(lastError, error);
          continue;
        }

        const extracted = this.extractRawApiKeyValue(response.data);
        if (extracted) {
          return extracted;
        }
      } catch (error: any) {
        lastError = preferRawApiKeyError(lastError, error);
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error('Failed to resolve raw API key');
  }

  async resolveUsableApiKeyValue(
    baseUrl: string,
    userId: number,
    accessToken: string,
    apiKey: any,
    context?: TokenRequestContext & { page?: any }
  ): Promise<string | null> {
    const currentValue = resolveApiKeyValue(apiKey);
    if (currentValue && !isMaskedApiKeyValue(currentValue)) {
      return currentValue;
    }

    const tokenId = resolveApiKeyFetchId(apiKey);
    if (!tokenId) {
      return null;
    }

    if (context?.page) {
      try {
        const resolvedValue = await this.fetchRawApiKeyValue(
          baseUrl,
          userId,
          accessToken,
          tokenId,
          context.page
        );
        return resolvedValue && !isMaskedApiKeyValue(resolvedValue) ? resolvedValue : null;
      } catch (error: any) {
        Logger.warn(
          `⚠️ [TokenService] 通过页面解析 API Key ${tokenId} 失败:`,
          error?.message || error
        );
        return null;
      }
    }

    try {
      const resolvedValue = await this.fetchRawApiKeyValue(baseUrl, userId, accessToken, tokenId);
      return resolvedValue && !isMaskedApiKeyValue(resolvedValue) ? resolvedValue : null;
    } catch (error: any) {
      if (!this.shouldFallbackToBrowserForRawApiKey(error, context)) {
        Logger.warn(`⚠️ [TokenService] 解析 API Key ${tokenId} 失败:`, error?.message || error);
        return null;
      }
    }

    try {
      const cleanBaseUrl = baseUrl.replace(/\/$/, '');
      const { page, release } = await this.chromeManager.createPage(cleanBaseUrl, {
        slot: context?.browserSlot,
      });

      try {
        await page.bringToFront().catch(() => {});
        await this.waitForCloudflareChallengeToPass(page, context?.challengeWaitMs ?? 10000);
        const resolvedValue = await this.fetchRawApiKeyValue(
          baseUrl,
          userId,
          accessToken,
          tokenId,
          page
        );
        return resolvedValue && !isMaskedApiKeyValue(resolvedValue) ? resolvedValue : null;
      } finally {
        try {
          await page.close();
        } catch {
          // ignore close errors
        }
        release();
      }
    } catch (error: any) {
      Logger.warn(
        `⚠️ [TokenService] 浏览器回退解析 API Key ${tokenId} 失败:`,
        error?.message || error
      );
      return null;
    }
  }

  private shouldFallbackToBrowserForRawApiKey(error: any, context?: TokenRequestContext): boolean {
    if (context?.allowBrowserFallback === false) {
      return false;
    }

    const status = error?.status ?? error?.response?.status;
    if (status === 401 || status === 403 || status === 0) {
      return true;
    }

    return (
      this.isCloudflareError(error) ||
      String(error?.message || '').includes('Browser challenge response')
    );
  }

  private async deleteSub2ApiApiToken(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenIdentifier: { id?: string; key?: string },
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    if (!tokenIdentifier.id) {
      throw new Error('sub2api 删除 API Key 需要 id');
    }
    const tokenId = tokenIdentifier.id;

    const url = `${cleanBaseUrl}/api/v1/keys/${encodeURIComponent(tokenIdentifier.id)}`;
    try {
      const response = await httpRequest({
        method: 'DELETE',
        url,
        headers: this.createRequestHeaders(userId, accessToken, baseUrl),
        timeout: 15000,
        validateStatus: (status: number) => status < 500,
      });

      if (this.isBrowserChallengeResponse(response.data)) {
        Logger.warn('🛡️ [TokenService] sub2api 删除令牌遇到挑战页响应，准备回退到浏览器模式');
        return await this.deleteSub2ApiApiTokenInBrowser(
          baseUrl,
          userId,
          accessToken,
          tokenIdentifier,
          context
        );
      }

      if (response.status < 200 || response.status >= 300) {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }

      if (typeof response.data?.code === 'number' && response.data.code !== 0) {
        throw new Error(response.data?.message || '删除 sub2api API Key 失败');
      }

      return { success: true };
    } catch (error: any) {
      if (this.isCloudflareError(error) || this.isBrowserChallengeResponse(error?.response?.data)) {
        return await this.deleteSub2ApiApiTokenInBrowser(
          baseUrl,
          userId,
          accessToken,
          tokenIdentifier,
          context
        );
      }
      throw error;
    }
  }

  private async deleteSub2ApiApiTokenInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenIdentifier: { id?: string; key?: string },
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    if (!tokenIdentifier.id) {
      throw new Error('sub2api 删除 API Key 需要 id');
    }
    const tokenId = tokenIdentifier.id;

    const { page, release } = await this.chromeManager.createPage(cleanBaseUrl, {
      slot: context?.browserSlot,
    });

    try {
      await page.bringToFront().catch(() => {});
      await this.waitForCloudflareChallengeToPass(page);

      const additionalHeaders = this.getSiteTypeProfileByUrl(baseUrl).includeUserIdHeaders
        ? getAllUserIdHeaders(userId)
        : {};
      const result = await runOnPageQueue(page, () =>
        page.evaluate(
          async (apiUrl: string, token: string, requestHeaders: Record<string, string>) => {
            try {
              const response = await fetch(apiUrl, {
                method: 'DELETE',
                credentials: 'include',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                  ...requestHeaders,
                  Pragma: 'no-cache',
                },
              });

              const status = response.status;
              const text = await response.text();
              try {
                return { ok: response.ok, status, isJson: true, data: JSON.parse(text) };
              } catch {
                return { ok: response.ok, status, isJson: false, textSnippet: text.slice(0, 200) };
              }
            } catch (err: any) {
              return { ok: false, status: 0, isJson: false, error: err?.message || String(err) };
            }
          },
          `${cleanBaseUrl}/api/v1/keys/${encodeURIComponent(tokenId)}`,
          accessToken,
          additionalHeaders
        )
      );

      if (!result.ok || result.status < 200 || result.status >= 300) {
        throw new Error(
          result.isJson ? result.data?.message || `HTTP ${result.status}` : result.textSnippet
        );
      }

      if (result.isJson && typeof result.data?.code === 'number' && result.data.code !== 0) {
        throw new Error(result.data?.message || '删除 sub2api API Key 失败(浏览器)');
      }

      return { success: true };
    } finally {
      release();
    }
  }

  /**
   * 删除 API 令牌
   *
   * 优先使用 axios 直接调用后端接口；
   * 如果遇到 Cloudflare / HTML 响应，则回退到浏览器模式，在已打开的站点页面中发送删除请求。
   *
   * @param baseUrl    站点基础 URL
   * @param userId     用户 ID（用于 User-Id 相关请求头）
   * @param accessToken 系统访问令牌（access_token）
   * @param tokenIdentifier 令牌标识（兼容 id / key 两种形式）
   */
  async deleteApiToken(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenIdentifier: { id?: number | string; key?: string },
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const id = tokenIdentifier.id != null ? String(tokenIdentifier.id) : undefined;
    const key = tokenIdentifier.key != null ? String(tokenIdentifier.key) : undefined;

    if (!id && !key) {
      throw new Error('缺少令牌标识，无法删除 API Key');
    }

    if (this.resolveSiteTypeByUrl(baseUrl) === 'sub2api') {
      return await this.deleteSub2ApiApiToken(baseUrl, userId, accessToken, { id, key }, context);
    }

    Logger.info('🗑 [TokenService] 删除 API 令牌...', {
      baseUrl: cleanBaseUrl,
      id,
      hasKey: !!key,
    });

    // ===== 1. axios 模式（优先尝试）=====
    type AxiosDeleteCandidate = {
      method: 'DELETE' | 'POST';
      url: string;
      body?: any;
      description: string;
    };

    const axiosCandidates: AxiosDeleteCandidate[] = [];

    // 优先使用 id 作为主键（New API / Done Hub 等大多数实现）
    if (id) {
      axiosCandidates.push(
        {
          method: 'DELETE',
          url: `${cleanBaseUrl}/api/token/${encodeURIComponent(id)}`,
          description: 'DELETE /api/token/{id}',
        },
        {
          method: 'DELETE',
          url: `${cleanBaseUrl}/api/token/?id=${encodeURIComponent(id)}`,
          description: 'DELETE /api/token/?id={id}',
        },
        {
          method: 'POST',
          url: `${cleanBaseUrl}/api/token/${encodeURIComponent(id)}/delete`,
          body: { id },
          description: 'POST /api/token/{id}/delete',
        },
        {
          method: 'POST',
          url: `${cleanBaseUrl}/api/token/delete`,
          body: { id },
          description: 'POST /api/token/delete (body.id)',
        }
      );
    }

    // 兼容部分站点使用 key 作为删除依据
    if (key) {
      axiosCandidates.push(
        {
          method: 'DELETE',
          url: `${cleanBaseUrl}/api/token/${encodeURIComponent(key)}`,
          description: 'DELETE /api/token/{key}',
        },
        {
          method: 'DELETE',
          url: `${cleanBaseUrl}/api/token/?key=${encodeURIComponent(key)}`,
          description: 'DELETE /api/token/?key={key}',
        },
        {
          method: 'POST',
          url: `${cleanBaseUrl}/api/token/delete`,
          body: { key },
          description: 'POST /api/token/delete (body.key)',
        }
      );
    }

    let needBrowserFallback = false;
    let lastError: any = null;

    for (const candidate of axiosCandidates) {
      try {
        Logger.info(
          `📡 [TokenService] 尝试删除令牌 (axios): ${candidate.description} -> ${candidate.url}`
        );
        const response = await httpRequest({
          method: candidate.method,
          url: candidate.url,
          data: candidate.body,
          headers: this.createRequestHeaders(userId, accessToken, baseUrl),
          timeout: 15000,
          validateStatus: (status: number) => status < 500,
        });

        const rawData = response.data;

        // 如果返回的是 HTML/挑战页，很可能被站点防护拦截，后续使用浏览器模式重试
        if (this.isBrowserChallengeResponse(rawData)) {
          Logger.warn('🛡️ [TokenService] 删除令牌遇到挑战页响应，准备回退到浏览器模式');
          needBrowserFallback = true;
          break;
        }

        const data = rawData && typeof rawData === 'object' ? rawData : {};

        Logger.info('📦 [TokenService] 删除令牌响应:', {
          status: response.status,
          hasSuccess: 'success' in data,
          success: (data as any).success,
          message: (data as any).message,
        });

        // HTTP 2xx 视为成功（除非明确 success === false）
        if (response.status >= 200 && response.status < 300) {
          if (typeof (data as any).success === 'boolean' && !(data as any).success) {
            // 明确业务失败，记录错误信息并尝试下一个候选
            Logger.warn(
              '⚠️ [TokenService] 删除令牌业务失败，尝试下一个候选:',
              (data as any).message
            );
            lastError = new Error((data as any).message || '删除令牌失败');
            continue;
          }
          Logger.info('✅ [TokenService] axios 删除令牌成功');
          // axios 模式删除成功，不额外获取列表，前端后续用 axios 刷新 API Key 列表
          return { success: true };
        }

        // 某些站点可能用 4xx 表示“该 URL 不支持删除”，继续尝试下一个候选
        Logger.warn('⚠️ [TokenService] 删除令牌 HTTP 非 2xx，尝试下一个候选:', {
          status: response.status,
          url: candidate.url,
        });
        lastError = new Error((data as any).message || `HTTP ${response.status}`);
      } catch (error: any) {
        lastError = error;
        // 如果检测到 Cloudflare 相关错误，直接回退到浏览器模式
        if (this.isCloudflareError(error)) {
          Logger.warn('🛡️ [TokenService] 检测到 Cloudflare 保护，准备回退到浏览器模式删除令牌');
          needBrowserFallback = true;
          break;
        }

        Logger.warn('⚠️ [TokenService] axios 删除令牌失败，尝试下一个候选:', {
          message: error.message,
        });
        continue;
      }
    }

    // 如果 axios 没有成功且没有明显的 Cloudflare 错误，直接抛出最后一个错误
    if (!needBrowserFallback) {
      if (lastError) {
        Logger.error(
          '❌ [TokenService] 所有 axios 删除方式均失败:',
          lastError.message || lastError
        );
        throw lastError;
      }
      Logger.error('❌ [TokenService] 无可用的删除方式，axios 删除失败');
      throw new Error('删除 API Key 失败，后端未提供兼容的删除端点');
    }

    // ===== 2. 浏览器模式（Cloudflare 场景 / axios 不可用时）=====
    return await this.deleteApiTokenInBrowser(baseUrl, userId, accessToken, { id, key }, context);
  }

  /**
   * 在浏览器环境中删除 API 令牌
   *
   * 说明：
   * - 通过 Puppeteer 连接到已登录站点页面；
   * - 等待 Cloudflare 验证通过后，在页面上下文中使用 fetch 调用删除接口；
   * - 操作完成后关闭当前标签页，并通过引用计数让浏览器按需延迟退出。
   */
  private async deleteApiTokenInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenIdentifier: { id?: string; key?: string },
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const id = tokenIdentifier.id;
    const key = tokenIdentifier.key;

    if (!id && !key) {
      throw new Error('缺少令牌标识，无法在浏览器中删除 API Key');
    }

    Logger.info('🧭 [TokenService] 浏览器模式删除 API 令牌...', {
      baseUrl: cleanBaseUrl,
      id,
      hasKey: !!key,
    });

    const { page, release } = await this.chromeManager.createPage(cleanBaseUrl, {
      slot: context?.browserSlot,
    });

    try {
      // 确保页面前置，方便用户在 Cloudflare 页面中进行验证
      await page.bringToFront().catch(() => {});

      // 等待 Cloudflare 验证通过（如果存在）
      await this.waitForCloudflareChallengeToPass(page);

      const userIdHeaders = getAllUserIdHeaders(Number(userId));

      type BrowserDeleteCandidate = {
        method: 'DELETE' | 'POST';
        url: string;
        body?: any;
        description: string;
      };

      const browserCandidates: BrowserDeleteCandidate[] = [];

      if (id) {
        browserCandidates.push(
          {
            method: 'DELETE',
            url: `${cleanBaseUrl}/api/token/${encodeURIComponent(id)}`,
            description: 'DELETE /api/token/{id}',
          },
          {
            method: 'DELETE',
            url: `${cleanBaseUrl}/api/token/?id=${encodeURIComponent(id)}`,
            description: 'DELETE /api/token/?id={id}',
          },
          {
            method: 'POST',
            url: `${cleanBaseUrl}/api/token/${encodeURIComponent(id)}/delete`,
            body: { id },
            description: 'POST /api/token/{id}/delete',
          },
          {
            method: 'POST',
            url: `${cleanBaseUrl}/api/token/delete`,
            body: { id },
            description: 'POST /api/token/delete (body.id)',
          }
        );
      }

      if (key) {
        browserCandidates.push(
          {
            method: 'DELETE',
            url: `${cleanBaseUrl}/api/token/${encodeURIComponent(key)}`,
            description: 'DELETE /api/token/{key}',
          },
          {
            method: 'DELETE',
            url: `${cleanBaseUrl}/api/token/?key=${encodeURIComponent(key)}`,
            description: 'DELETE /api/token/?key={key}',
          },
          {
            method: 'POST',
            url: `${cleanBaseUrl}/api/token/delete`,
            body: { key },
            description: 'POST /api/token/delete (body.key)',
          }
        );
      }

      let lastError: any = null;

      for (const candidate of browserCandidates) {
        Logger.info(
          `📡 [TokenService] 浏览器删除令牌: ${candidate.description} -> ${candidate.url}`
        );

        const result = await runOnPageQueue(page, () =>
          page.evaluate(
            async (
              apiUrl: string,
              token: string,
              method: string,
              payload: any,
              additionalHeaders: Record<string, string>
            ) => {
              try {
                const headers: Record<string, string> = {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                  ...additionalHeaders,
                  Pragma: 'no-cache',
                };

                const init: RequestInit = {
                  method,
                  credentials: 'include',
                  headers,
                };

                if (method === 'POST' && payload) {
                  init.body = JSON.stringify(payload);
                }

                const response = await fetch(apiUrl, init);
                const status = response.status;
                const text = await response.text();

                try {
                  const data = JSON.parse(text);
                  return { ok: response.ok, status, isJson: true, data };
                } catch {
                  return {
                    ok: response.ok,
                    status,
                    isJson: false,
                    textSnippet: text.slice(0, 200),
                  };
                }
              } catch (err: any) {
                return { ok: false, status: 0, isJson: false, error: err?.message || String(err) };
              }
            },
            candidate.url,
            accessToken,
            candidate.method,
            candidate.body || null,
            userIdHeaders
          )
        );

        Logger.info('📦 [TokenService] 浏览器删除令牌结果:', result);

        if (!result.ok || result.status < 200 || result.status >= 300) {
          const reason = result.isJson
            ? result.data?.message || `HTTP ${result.status}`
            : result.textSnippet || `HTTP ${result.status}`;

          Logger.warn('⚠️ [TokenService] 浏览器删除令牌失败，尝试下一个候选:', reason);
          lastError = new Error(reason);
          continue;
        }

        if (result.isJson && typeof result.data?.success === 'boolean' && !result.data.success) {
          const reason = result.data.message || '删除令牌失败(浏览器)';
          Logger.warn('⚠️ [TokenService] 浏览器删除令牌业务失败，尝试下一个候选:', reason);
          lastError = new Error(reason);
          continue;
        }

        Logger.info('✅ [TokenService] 浏览器模式删除令牌成功');

        // 删除成功后，直接在同一浏览器页面中获取最新 API Key 列表
        const tokens = await this.fetchApiTokensInBrowser(baseUrl, userId, accessToken, page);
        Logger.info(
          `✅ [TokenService] 浏览器模式删除令牌后已获取最新 API Keys，数量: ${tokens.length}`
        );

        return { success: true, data: tokens };
      }

      if (lastError) {
        Logger.error(
          '❌ [TokenService] 浏览器模式删除令牌全部候选失败:',
          lastError.message || lastError
        );
        throw lastError;
      }

      throw new Error('删除 API Key 失败（浏览器模式未找到可用端点）');
    } finally {
      // 关闭当前标签页，并释放浏览器引用计数
      try {
        await page.close();
      } catch (e) {
        // 忽略关闭错误
      }
      release();
    }
  }

  /**
   * 等待 Cloudflare 验证通过
   *
   * 策略：
   * - 轮询页面 HTML 内容，如果包含典型 Cloudflare 文本（如 "Just a moment" / "cf-browser-verification"）则认为仍在验证中；
   * - 最长等待 maxWaitMs 毫秒，期间用户可以在浏览器窗口中完成验证；
   * - 超时后不直接失败，而是给出警告日志后继续后续操作（由实际接口响应来最终决定是否成功）。
   *
   * @param page Puppeteer 页面对象
   * @param maxWaitMs 最大等待时间（默认 120 秒）
   */
  private async waitForCloudflareChallengeToPass(
    page: any,
    maxWaitMs: number = 600000
  ): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      if (page.isClosed && page.isClosed()) {
        throw new Error('浏览器已关闭，操作已取消');
      }

      try {
        const html: string = await page.content();
        const hasChallenge =
          html.includes('cf-browser-verification') ||
          html.includes('Just a moment') ||
          html.includes('Checking your browser before accessing') ||
          html.includes('Cloudflare');

        if (!hasChallenge) {
          Logger.info('✅ [TokenService] 未检测到 Cloudflare 挑战页面，继续执行后续操作');
          return;
        }

        Logger.info('🛡️ [TokenService] 检测到 Cloudflare 挑战页面，等待用户完成验证...');
      } catch (error: any) {
        Logger.warn(
          '⚠️ [TokenService] 检查 Cloudflare 状态失败，稍后重试:',
          error.message || error
        );
      }

      // 间隔 2 秒再次检查
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    Logger.warn(
      '⚠️ [TokenService] 等待 Cloudflare 验证超时，继续尝试调用接口，成功与否由后续响应决定'
    );
  }

  private normalizeTokenGroup(group: unknown): string {
    return normalizeApiKeyGroup(group);
  }

  private getTokenIdentity(token: any): string | null {
    const candidates = [token?.id, token?.token_id, token?.key, token?.token];

    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null) {
        continue;
      }

      const value = String(candidate).trim();
      if (value) {
        return value;
      }
    }

    return null;
  }

  private isCreatedTokenMatch(token: any, tokenData: CreateApiTokenPayload): boolean {
    if (!token || typeof token !== 'object') {
      return false;
    }

    const tokenName = String(token.name ?? token.token_name ?? '').trim();
    if (tokenName !== tokenData.name) {
      return false;
    }

    if (this.normalizeTokenGroup(token.group) !== this.normalizeTokenGroup(tokenData.group)) {
      return false;
    }

    if (Boolean(token.unlimited_quota) !== tokenData.unlimited_quota) {
      return false;
    }

    const remainQuota = Number(
      token.remain_quota ?? token.remainQuota ?? token.quota ?? token.quota_remain
    );
    if (
      !tokenData.unlimited_quota &&
      Number.isFinite(remainQuota) &&
      remainQuota !== tokenData.remain_quota
    ) {
      return false;
    }

    const expiredTime = Number(token.expired_time ?? token.expire_time ?? token.expiredTime);
    if (
      tokenData.expired_time > 0 &&
      Number.isFinite(expiredTime) &&
      expiredTime !== tokenData.expired_time
    ) {
      return false;
    }

    return true;
  }

  private hasVerifiedCreatedToken(
    beforeTokens: any[],
    afterTokens: any[],
    tokenData: CreateApiTokenPayload
  ): boolean {
    const beforeIds = new Set(
      beforeTokens
        .map(token => this.getTokenIdentity(token))
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    );

    return afterTokens.some(token => {
      if (!this.isCreatedTokenMatch(token, tokenData)) {
        return false;
      }

      const identity = this.getTokenIdentity(token);
      if (identity) {
        return !beforeIds.has(identity);
      }

      return afterTokens.length > beforeTokens.length;
    });
  }

  private extractCreatedRawApiKey(createResponseData: any): string | null {
    const containers = [
      createResponseData,
      createResponseData?.data,
      createResponseData?.data?.data,
    ];

    for (const container of containers) {
      if (typeof container === 'string') {
        const normalized = normalizeApiKeyValue(container);
        if (normalized && !isMaskedApiKeyValue(normalized)) {
          return normalized;
        }
        continue;
      }

      if (!container || typeof container !== 'object') {
        continue;
      }

      for (const field of ['key', 'token', 'value']) {
        const normalized = normalizeApiKeyValue((container as any)[field]);
        if (normalized && !isMaskedApiKeyValue(normalized)) {
          return normalized;
        }
      }
    }

    return null;
  }

  private mergeCreatedRawKeyIntoTokens(
    beforeTokens: any[],
    afterTokens: any[],
    tokenData: CreateApiTokenPayload,
    createResponseData: any
  ): any[] {
    const rawKey = this.extractCreatedRawApiKey(createResponseData);
    if (!rawKey || afterTokens.length === 0) {
      return afterTokens;
    }

    const beforeIds = new Set(
      beforeTokens
        .map(token => this.getTokenIdentity(token))
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    );

    const createdToken =
      afterTokens.find(token => {
        if (!this.isCreatedTokenMatch(token, tokenData)) {
          return false;
        }

        const identity = this.getTokenIdentity(token);
        return identity ? !beforeIds.has(identity) : afterTokens.length > beforeTokens.length;
      }) || afterTokens.find(token => this.isCreatedTokenMatch(token, tokenData));

    if (!createdToken) {
      return afterTokens;
    }

    return (
      mergeApiKeysPreservingRawValue(
        [
          {
            id: createdToken.id,
            token_id: createdToken.token_id,
            name: createdToken.name ?? tokenData.name,
            group: createdToken.group ?? tokenData.group,
            key: rawKey,
          },
        ],
        afterTokens
      ) || afterTokens
    );
  }

  private async createSub2ApiApiToken(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenData: CreateApiTokenPayload,
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const url = `${cleanBaseUrl}/api/v1/keys`;
    const beforeTokens = await this.fetchApiTokens(baseUrl, userId, accessToken, context);
    const userGroups = await this.fetchUserGroups(baseUrl, userId, accessToken);
    const payload = this.buildSub2ApiCreatePayload(tokenData, userGroups);

    try {
      const response = await httpPost(url, payload, {
        headers: this.createRequestHeaders(userId, accessToken, baseUrl),
        timeout: 15000,
        validateStatus: (status: number) => status < 500,
      });

      if (this.isBrowserChallengeResponse(response.data)) {
        Logger.warn('🛡️ [TokenService] sub2api 创建令牌遇到挑战页响应，切换到浏览器模式重试...');
        return await this.createSub2ApiApiTokenInBrowser(
          baseUrl,
          userId,
          accessToken,
          tokenData,
          payload,
          context
        );
      }

      if (response.status < 200 || response.status >= 300) {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }

      if (response.data?.code !== 0 || !response.data?.data) {
        throw new Error(response.data?.message || '创建 sub2api API Key 失败');
      }

      const tokens = this.mergeCreatedRawKeyIntoTokens(
        beforeTokens,
        await this.fetchApiTokens(baseUrl, userId, accessToken, context),
        tokenData,
        response.data
      );
      return { success: true, data: tokens };
    } catch (error: any) {
      const html = error?.response?.data;
      if (this.isBrowserChallengeResponse(html) || this.isCloudflareError(error)) {
        Logger.warn('🛡️ [TokenService] sub2api 创建令牌遇到挑战页响应，切换到浏览器模式重试...');
        return await this.createSub2ApiApiTokenInBrowser(
          baseUrl,
          userId,
          accessToken,
          tokenData,
          payload,
          context
        );
      }
      throw error;
    }
  }

  private async createSub2ApiApiTokenInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenData: CreateApiTokenPayload,
    payload: Record<string, unknown>,
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const url = `${cleanBaseUrl}/api/v1/keys`;
    const { page, release } = await this.chromeManager.createPage(cleanBaseUrl, {
      slot: context?.browserSlot,
    });

    try {
      await page.bringToFront().catch(() => {});
      await this.waitForCloudflareChallengeToPass(page);

      const beforeTokens = await this.fetchApiTokensInBrowser(baseUrl, userId, accessToken, page);
      const additionalHeaders = this.getSiteTypeProfileByUrl(baseUrl).includeUserIdHeaders
        ? getAllUserIdHeaders(userId)
        : {};

      const result = await runOnPageQueue(page, () =>
        page.evaluate(
          async (
            apiUrl: string,
            token: string,
            requestPayload: any,
            requestHeaders: Record<string, string>
          ) => {
            try {
              const response = await fetch(apiUrl, {
                method: 'POST',
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                  ...requestHeaders,
                  Pragma: 'no-cache',
                },
                body: JSON.stringify(requestPayload),
              });

              const status = response.status;
              const text = await response.text();
              try {
                return { ok: response.ok, status, isJson: true, data: JSON.parse(text) };
              } catch {
                return { ok: response.ok, status, isJson: false, textSnippet: text.slice(0, 200) };
              }
            } catch (err: any) {
              return { ok: false, status: 0, isJson: false, error: err?.message || String(err) };
            }
          },
          url,
          accessToken,
          payload,
          additionalHeaders
        )
      );

      if (!result.ok || result.status < 200 || result.status >= 300) {
        throw new Error(
          result.isJson ? result.data?.message || `HTTP ${result.status}` : result.textSnippet
        );
      }

      if (result.isJson && result.data?.code !== 0) {
        throw new Error(result.data?.message || '创建 sub2api API Key 失败(浏览器)');
      }

      const tokens = this.mergeCreatedRawKeyIntoTokens(
        beforeTokens,
        await this.fetchApiTokens(baseUrl, userId, accessToken, context),
        tokenData,
        result.data
      );
      return { success: true, data: tokens };
    } finally {
      release();
    }
  }

  /**
   * 创建新的 API 令牌
   *
   * 说明：
   * - 兼容 New API / Done Hub / Veloera 等多种站点实现
   * - 只使用通用字段，其他高级配置交由服务端使用默认值
   *
   * @param baseUrl    站点基础 URL
   * @param userId     用户 ID（用于 User-Id 相关请求头）
   * @param accessToken 系统访问令牌（access_token）
   * @param tokenData  创建令牌所需的核心字段（名称、额度、过期时间、分组等）
   */
  async createApiToken(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenData: CreateApiTokenPayload,
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }> {
    if (this.resolveSiteTypeByUrl(baseUrl) === 'sub2api') {
      return await this.createSub2ApiApiToken(baseUrl, userId, accessToken, tokenData, context);
    }

    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const url = `${cleanBaseUrl}/api/token/`;

    Logger.info('🆕 [TokenService] 创建 API 令牌...', {
      url,
      name: tokenData.name,
      group: tokenData.group,
      unlimited_quota: tokenData.unlimited_quota,
      remain_quota: tokenData.remain_quota,
      expired_time: tokenData.expired_time,
    });

    try {
      const beforeTokens = await this.fetchApiTokens(baseUrl, userId, accessToken, context);
      const response = await httpPost(url, tokenData, {
        headers: this.createRequestHeaders(userId, accessToken, baseUrl),
        timeout: 15000,
        validateStatus: (status: number) => status < 500,
      });

      const status = response.status;
      const rawData = response.data;

      // 如果返回的是 HTML/挑战页，直接切换到浏览器模式
      if (this.isBrowserChallengeResponse(rawData)) {
        Logger.warn('🛡️ [TokenService] 创建令牌遇到挑战页响应，切换到浏览器模式重试...');
        return await this.createApiTokenInBrowser(baseUrl, userId, accessToken, tokenData, context);
      }

      const data = rawData && typeof rawData === 'object' ? rawData : {};

      Logger.info('📦 [TokenService] 创建令牌响应:', {
        status,
        hasSuccess: typeof data === 'object' && data !== null && 'success' in data,
        success: (data as any)?.success,
        message: (data as any)?.message,
      });

      // HTTP 非 2xx 直接视为失败
      if (status < 200 || status >= 300) {
        const message = (data as any)?.message || `HTTP ${status}`;
        throw new Error(`创建令牌失败: ${message}`);
      }

      // 存在 success 字段且为 false，则视为业务失败
      if (typeof (data as any)?.success === 'boolean' && !(data as any).success) {
        throw new Error((data as any).message || '创建令牌失败');
      }

      const tokens = this.mergeCreatedRawKeyIntoTokens(
        beforeTokens,
        await this.fetchApiTokens(baseUrl, userId, accessToken, context),
        tokenData,
        rawData
      );
      const verified = this.hasVerifiedCreatedToken(beforeTokens, tokens, tokenData);

      Logger.info('🔍 [TokenService] 创建令牌后核验结果:', {
        beforeCount: beforeTokens.length,
        afterCount: tokens.length,
        verified,
        name: tokenData.name,
        group: tokenData.group,
      });

      if (!verified) {
        throw new Error('创建请求已返回成功，但未在当前账户下查询到新 API Key');
      }

      return { success: true, data: tokens };
    } catch (error: any) {
      // 如果是挑战页/Cloudflare 错误，同样尝试浏览器模式
      const html = error?.response?.data;
      if (this.isBrowserChallengeResponse(html) || this.isCloudflareError(error)) {
        Logger.warn('🛡️ [TokenService] axios 创建令牌遇到挑战页响应，切换到浏览器模式重试...');
        return await this.createApiTokenInBrowser(baseUrl, userId, accessToken, tokenData, context);
      }

      Logger.error('❌ [TokenService] 创建 API 令牌失败:', error.message || error);
      throw error;
    }
  }

  /**
   * 在浏览器环境中创建 API 令牌（用于绕过 Cloudflare 等前端防护）
   * 说明：
   * - 通过 Puppeteer 连接到已登录站点页面，在页面上下文中使用 fetch 调用 /api/token/
   * - 复用与检测逻辑共享的 Chrome 实例和用户数据目录，因此只要用户在该浏览器中完成过登录，通常即可通过 Cloudflare 检查
   */
  private async createApiTokenInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenData: CreateApiTokenPayload,
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const url = `${cleanBaseUrl}/api/token/`;

    Logger.info('🧭 [TokenService] 浏览器模式创建 API 令牌...', {
      url,
      name: tokenData.name,
      group: tokenData.group,
    });

    // 通过 ChromeManager 创建页面（自动管理引用计数与生命周期）
    const { page, release } = await this.chromeManager.createPage(cleanBaseUrl, {
      slot: context?.browserSlot,
    });

    try {
      // 确保页面前置，方便用户在 Cloudflare 页面中进行验证
      await page.bringToFront().catch(() => {});

      // 等待 Cloudflare 验证通过（如果存在）
      await this.waitForCloudflareChallengeToPass(page);

      const userIdHeaders = getAllUserIdHeaders(userId);
      const beforeTokens = await this.fetchApiTokensInBrowser(baseUrl, userId, accessToken, page);

      const result = await runOnPageQueue(page, () =>
        page.evaluate(
          async (
            apiUrl: string,
            token: string,
            payload: any,
            additionalHeaders: Record<string, string>
          ) => {
            try {
              const response = await fetch(apiUrl, {
                method: 'POST',
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                  ...additionalHeaders,
                  Pragma: 'no-cache',
                },
                body: JSON.stringify(payload),
              });

              const status = response.status;
              const text = await response.text();

              // 尝试解析 JSON，如果失败则返回文本片段，方便诊断
              try {
                const data = JSON.parse(text);
                return { status, ok: response.ok, isJson: true, data };
              } catch {
                return { status, ok: response.ok, isJson: false, textSnippet: text.slice(0, 200) };
              }
            } catch (err: any) {
              return { status: 0, ok: false, isJson: false, error: err?.message || String(err) };
            }
          },
          url,
          accessToken,
          tokenData,
          userIdHeaders
        )
      );

      Logger.info('📦 [TokenService] 浏览器模式创建令牌结果:', result);

      if (!result.ok || result.status < 200 || result.status >= 300) {
        const reason = result.isJson
          ? result.data?.message || `HTTP ${result.status}`
          : result.textSnippet || `HTTP ${result.status}`;
        throw new Error(`创建令牌失败(浏览器): ${reason}`);
      }

      if (result.isJson && typeof result.data?.success === 'boolean' && !result.data.success) {
        throw new Error(result.data.message || '创建令牌失败(浏览器)');
      }

      // 创建成功后，直接在同一浏览器页面中获取最新 API Key 列表
      const tokens = this.mergeCreatedRawKeyIntoTokens(
        beforeTokens,
        await this.fetchApiTokensInBrowser(baseUrl, userId, accessToken, page),
        tokenData,
        result.data
      );
      Logger.info(
        `✅ [TokenService] 浏览器模式创建令牌后已获取最新 API Keys，数量: ${tokens.length}`
      );

      return { success: true, data: tokens };
    } finally {
      // 释放浏览器引用
      release();
    }
  }

  /**
   * 获取用户分组信息
   */
  async fetchUserGroups(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page?: any,
    explicitSiteType?: SiteType
  ): Promise<Record<string, { id?: number | string; desc: string; ratio: number }>> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const siteType = this.resolveSiteTypeByUrl(baseUrl, explicitSiteType);
    const urls = this.getSiteTypeProfileByUrl(baseUrl, explicitSiteType).userGroupEndpoints.map(
      endpoint => `${cleanBaseUrl}${endpoint}`
    );

    // 如果提供了page，使用浏览器环境
    if (page) {
      return await this.fetchUserGroupsInBrowser(
        baseUrl,
        userId,
        accessToken,
        page,
        explicitSiteType
      );
    }

    for (const url of urls) {
      try {
        Logger.info(`📡 [TokenService] 尝试获取用户分组: ${url}`);
        const response = await httpGet(url, {
          headers: this.createRequestHeaders(userId, accessToken, baseUrl, explicitSiteType),
          timeout: 10000,
        });

        if (siteType === 'sub2api' && response.data?.code === 0) {
          Logger.info('✅ [TokenService] 用户分组获取成功 (sub2api格式)');
          return this.parseSub2ApiGroups(response.data);
        }

        // New API 格式: { success: true, data: { "default": {...}, "vip": {...} } }
        if (
          response.data?.success &&
          response.data?.data &&
          typeof response.data.data === 'object'
        ) {
          Logger.info('✅ [TokenService] 用户分组获取成功 (New API格式)');

          // 检查是否为Done Hub格式（有name和ratio字段）
          const firstValue = Object.values(response.data.data)[0] as any;
          if (firstValue && ('name' in firstValue || 'ratio' in firstValue)) {
            // Done Hub 格式: { data: { default: { id, symbol, name, ratio, enable, ... } }, success: true }
            Logger.info('   格式类型: Done Hub');
            Logger.info('   原始分组数据:', response.data.data);
            const groups: Record<string, { id?: number | string; desc: string; ratio: number }> =
              {};
            for (const [key, value] of Object.entries(response.data.data)) {
              const group = value as any;
              // 只添加启用的分组
              if (group.enable !== false) {
                // undefined 或 true 都算启用
                groups[key] = {
                  id: group.id,
                  desc: group.name || group.desc || key,
                  ratio: group.ratio || 1,
                };
              }
            }
            Logger.info('   转换后分组:', groups);
            return groups;
          } else {
            // New API 格式: { data: { "default": { desc: "...", ratio: 1 } } }
            Logger.info('   格式类型: New API');
            return response.data.data;
          }
        }

        // One API 格式: { success: true, data: ["default", "vip"] } - 只有分组名列表
        if (response.data?.success && Array.isArray(response.data.data)) {
          Logger.info('✅ [TokenService] 用户分组获取成功 (One API格式 - 数组)');
          const groups: Record<string, { id?: number | string; desc: string; ratio: number }> = {};
          response.data.data.forEach((groupName: string) => {
            groups[groupName] = {
              desc: groupName,
              ratio: 1,
            };
          });
          return groups;
        }

        // 直接返回对象格式（无success字段）
        if (response.data && typeof response.data === 'object' && !response.data.success) {
          Logger.info('✅ [TokenService] 用户分组获取成功 (直接对象格式)');
          return response.data;
        }
      } catch (error: any) {
        Logger.warn(`⚠️ [TokenService] URL ${url} 失败:`, error.message);
        continue;
      }
    }

    // 所有URL都失败，尝试浏览器模式
    if (this.isCloudflareError(urls[0]) && page) {
      Logger.info('🛡️ [TokenService] 检测到Cloudflare，使用共享浏览器页面获取用户分组...');
      try {
        return await this.fetchUserGroupsInBrowser(
          baseUrl,
          userId,
          accessToken,
          page,
          explicitSiteType
        );
      } catch (browserError: any) {
        Logger.error('❌ [TokenService] 浏览器模式也失败:', browserError.message);
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
    page: any,
    explicitSiteType?: SiteType
  ): Promise<Record<string, { id?: number | string; desc: string; ratio: number }>> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const siteType = this.resolveSiteTypeByUrl(baseUrl, explicitSiteType);
    const urls = this.getSiteTypeProfileByUrl(baseUrl, explicitSiteType).userGroupEndpoints.map(
      endpoint => `${cleanBaseUrl}${endpoint}`
    );

    const userIdHeaders = this.getSiteTypeProfileByUrl(baseUrl, explicitSiteType)
      .includeUserIdHeaders
      ? getAllUserIdHeaders(userId)
      : {};

    for (const url of urls) {
      try {
        Logger.info(`📡 [TokenService] 浏览器获取用户分组: ${url}`);
        const result = await runOnPageQueue(page, () =>
          page.evaluate(
            async (apiUrl: string, token: string, additionalHeaders: Record<string, string>) => {
              const response = await fetch(apiUrl, {
                method: 'GET',
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                  ...additionalHeaders,
                },
              });

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }

              return await response.json();
            },
            url,
            accessToken,
            userIdHeaders
          )
        );

        if (siteType === 'sub2api' && result?.code === 0) {
          Logger.info('✅ [TokenService] 浏览器获取成功 (sub2api格式)');
          return this.parseSub2ApiGroups(result);
        }

        // New API 格式: { success: true, data: { "default": {...}, "vip": {...} } }
        if (result?.success && result?.data && typeof result.data === 'object') {
          Logger.info('✅ [TokenService] 浏览器获取成功 (New API格式)');

          // 检查是否为Done Hub格式（有name和ratio字段）
          const firstValue = Object.values(result.data)[0] as any;
          if (firstValue && ('name' in firstValue || 'ratio' in firstValue)) {
            // Done Hub 格式
            Logger.info('   格式类型: Done Hub');
            const groups: Record<string, { id?: number | string; desc: string; ratio: number }> =
              {};
            for (const [key, value] of Object.entries(result.data)) {
              const group = value as any;
              // 只添加启用的分组
              if (group.enable !== false) {
                // undefined 或 true 都算启用
                groups[key] = {
                  id: group.id,
                  desc: group.name || group.desc || key,
                  ratio: group.ratio || 1,
                };
              }
            }
            return groups;
          } else {
            // New API 格式
            Logger.info('   格式类型: New API');
            return result.data;
          }
        }

        // One API 格式: { success: true, data: ["default", "vip"] } - 只有分组名列表
        if (result?.success && Array.isArray(result.data)) {
          Logger.info('✅ [TokenService] 浏览器获取成功 (One API格式 - 数组)');
          const groups: Record<string, { id?: number | string; desc: string; ratio: number }> = {};
          result.data.forEach((groupName: string) => {
            groups[groupName] = {
              desc: groupName,
              ratio: 1,
            };
          });
          return groups;
        }

        // 直接对象格式
        if (result && typeof result === 'object' && !result.success) {
          Logger.info('✅ [TokenService] 浏览器获取成功 (直接对象格式)');
          return result;
        }
      } catch (error: any) {
        Logger.warn(`⚠️ [TokenService] 浏览器URL ${url} 失败:`, error.message);
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
    const profile = this.getSiteTypeProfileByUrl(baseUrl);
    const siteType = this.resolveSiteTypeByUrl(baseUrl);
    const urls = profile.modelPricingEndpoints.map(endpoint => `${cleanBaseUrl}${endpoint}`);

    if (!profile.supportsModelPricing || urls.length === 0) {
      Logger.info(`ℹ️ [TokenService] 站点类型 ${siteType} 未提供模型定价接口，返回空定价`);
      return { data: {} };
    }

    // 如果提供了page，使用浏览器环境
    if (page) {
      return await this.fetchModelPricingInBrowser(baseUrl, userId, accessToken, page);
    }

    for (const url of urls) {
      try {
        Logger.info(`📡 [TokenService] 尝试获取模型定价: ${url}`);
        const response = await httpGet(url, {
          headers: this.createRequestHeaders(userId, accessToken, baseUrl),
          timeout: 10000,
        });

        const rawData = response.data;
        const data = rawData && typeof rawData === 'object' ? rawData : null;

        if (this.isBrowserChallengeResponse(rawData)) {
          Logger.info(`🛡️ [TokenService] 模型定价接口返回挑战页，跳过当前 URL: ${url}`);
          continue;
        }

        Logger.info(`📦 [TokenService] 模型定价响应结构:`, {
          url,
          hasSuccess: !!data && 'success' in data,
          successValue: data?.success,
          hasData: !!data && 'data' in data,
          dataType: typeof data?.data,
          isDataArray: Array.isArray(data?.data),
          dataLength: Array.isArray(data?.data) ? data.data.length : 'N/A',
          firstKey: data?.data && typeof data.data === 'object' ? Object.keys(data.data)[0] : 'N/A',
        });

        // 检查响应数据是否存在
        if (data) {
          // New API /api/pricing 格式: { success: true, data: [...数组] }
          if (data?.success && data?.data && Array.isArray(data.data)) {
            Logger.info('✅ [TokenService] 模型定价获取成功 (New API数组格式)');
            // 将数组转换为以model_name为key的对象
            const pricing: any = { data: {} };
            data.data.forEach((model: any) => {
              const modelName = model.model_name || model.model;
              if (modelName) {
                // 保留原始字段，不在后端计算价格
                pricing.data[modelName] = {
                  quota_type: model.quota_type || 0,
                  model_ratio: model.model_ratio || 1,
                  model_price: model.model_price || 0,
                  completion_ratio: model.completion_ratio || 1,
                  enable_groups: model.enable_groups || [],
                  model_description: model.model_description || '',
                };
              }
            });
            return pricing;
          }

          // Done Hub /api/available_model 格式: { success: true, data: { "GLM-4.5": { price: {...}, groups: [...] } } }
          if (
            data?.success &&
            data?.data &&
            typeof data.data === 'object' &&
            !Array.isArray(data.data)
          ) {
            const firstValue = Object.values(data.data)[0] as any;

            // 判断是否为Done Hub/One Hub格式（有price对象）
            if (firstValue && firstValue.price) {
              Logger.info('✅ [TokenService] 模型定价获取成功 (Done Hub/One Hub对象格式)');
              Logger.info('📝 [TokenService] 示例模型数据:', {
                firstModelName: Object.keys(data.data)[0],
                firstModelData: firstValue,
              });

              // 转换 Done Hub/One Hub 格式到标准格式
              const pricing: any = { data: {} };
              let sampleConverted: any = null;

              for (const [modelName, modelInfo] of Object.entries(data.data)) {
                const info = modelInfo as any;
                if (info.price) {
                  // quota_type: 'times' = 1 (按次), 'tokens' = 0 (按量)
                  const quotaType = info.price.type === 'times' ? 1 : 0;

                  // 保留原始字段，价格直接来自API
                  const converted = {
                    quota_type: quotaType,
                    type: info.price.type, // 保留原始type字段
                    model_ratio: 1, // Done Hub/One Hub 不使用 model_ratio
                    completion_ratio:
                      info.price.output && info.price.input
                        ? info.price.output / info.price.input
                        : 1,
                    enable_groups: info.groups || [], // Done Hub/One Hub 使用 groups 字段
                    // Done Hub/One Hub 总是把价格放到 model_price 对象中（不管按量还是按次）
                    model_price: {
                      input: info.price.input,
                      output: info.price.output,
                    },
                  };

                  pricing.data[modelName] = converted;

                  // 保存第一个转换结果用于调试
                  if (!sampleConverted) {
                    sampleConverted = { modelName, converted };
                  }
                }
              }

              Logger.info('📝 [TokenService] 转换后示例:', sampleConverted);
              Logger.info(`📊 [TokenService] 共转换 ${Object.keys(pricing.data).length} 个模型`);
              return pricing;
            }
          }

          Logger.info('⚠️ [TokenService] 未识别的定价格式，返回空定价');
          return { data: {} };
        }
      } catch (error: any) {
        Logger.warn(`⚠️ [TokenService] URL ${url} 失败:`, {
          status: error.response?.status,
          message: error.message,
        });
        continue;
      }
    }

    // 所有URL都失败，尝试浏览器模式
    if (!page) {
      Logger.info('🛡️ [TokenService] axios获取失败，尝试浏览器模式获取模型定价...');
      try {
        const pageResult = await this.chromeManager.createPage(baseUrl);
        const browserPage = pageResult.page;
        const pageRelease = pageResult.release;
        try {
          await browserPage.waitForSelector('body', { timeout: 10000 });
          await new Promise(resolve => setTimeout(resolve, 2000));
          return await this.fetchModelPricingInBrowser(baseUrl, userId, accessToken, browserPage);
        } finally {
          // 释放浏览器引用
          pageRelease();
          // 关闭页面
          await browserPage.close();
        }
      } catch (browserError: any) {
        Logger.error('❌ [TokenService] 浏览器模式也失败:', browserError.message);
      }
    }

    Logger.warn(
      '⚠️ [TokenService] 所有方式都无法获取模型定价，返回空定价（该站点可能不支持定价查询）'
    );
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
    const profile = this.getSiteTypeProfileByUrl(baseUrl);
    const urls = profile.modelPricingEndpoints.map(endpoint => `${cleanBaseUrl}${endpoint}`);

    if (!profile.supportsModelPricing || urls.length === 0) {
      return { data: {} };
    }

    const userIdHeaders = getAllUserIdHeaders(userId);

    for (const url of urls) {
      try {
        Logger.info(`📡 [TokenService] 浏览器获取模型定价: ${url}`);
        const result = await runOnPageQueue(page, () =>
          page.evaluate(
            async (apiUrl: string, token: string, additionalHeaders: Record<string, string>) => {
              const response = await fetch(apiUrl, {
                method: 'GET',
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                  ...additionalHeaders,
                },
              });

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }

              return await response.json();
            },
            url,
            accessToken,
            userIdHeaders
          )
        );

        // 检查响应数据
        if (result) {
          // Done Hub /api/available_model 格式
          if (result?.success && result?.data && typeof result.data === 'object') {
            const firstValue = Object.values(result.data)[0] as any;

            // 判断是否为Done Hub/One Hub格式（有price对象）
            if (firstValue && firstValue.price) {
              Logger.info('✅ [TokenService] 浏览器获取成功 (Done Hub/One Hub格式)');
              const pricing: any = { data: {} };
              for (const [modelName, modelInfo] of Object.entries(result.data)) {
                const info = modelInfo as any;
                if (info.price) {
                  // quota_type: 'times' = 1 (按次), 'tokens' = 0 (按量)
                  const quotaType = info.price.type === 'times' ? 1 : 0;

                  // 保留原始字段，价格直接来自API
                  pricing.data[modelName] = {
                    quota_type: quotaType,
                    type: info.price.type, // 保留原始type字段
                    model_ratio: 1, // Done Hub/One Hub 不使用 model_ratio
                    completion_ratio:
                      info.price.output && info.price.input
                        ? info.price.output / info.price.input
                        : 1,
                    enable_groups: info.groups || [], // Done Hub/One Hub 使用 groups 字段
                    // Done Hub/One Hub 总是把价格放到 model_price 对象中（不管按量还是按次）
                    model_price: {
                      input: info.price.input,
                      output: info.price.output,
                    },
                  };
                }
              }
              return pricing;
            } else if (result?.success && result?.data && Array.isArray(result.data)) {
              // New API /api/pricing 数组格式
              Logger.info('✅ [TokenService] 浏览器获取成功 (New API数组格式)');
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
                    model_description: model.model_description || '',
                  };
                }
              });
              return pricing;
              // 其他格式，直接返回
              Logger.info('✅ [TokenService] 浏览器获取成功 (通用格式)');
            } else {
              return result;
            }
          }

          // 直接返回result（可能直接是pricing对象）
          Logger.info('✅ [TokenService] 浏览器获取成功 (通用格式)');
          return result;
        }
      } catch (error: any) {
        Logger.warn(`⚠️ [TokenService] 浏览器URL ${url} 失败:`, error.message);
        continue;
      }
    }

    return { data: {} };
  }

  /**
   * 检测是否为Cloudflare保护错误
   */
  private isBrowserChallengeResponse(data: unknown): boolean {
    if (typeof data !== 'string') {
      return false;
    }

    const normalized = data.toLowerCase();
    return (
      normalized.includes('<!doctype html') ||
      normalized.includes('<html') ||
      normalized.includes('<script') ||
      normalized.includes('just a moment') ||
      normalized.includes('cf-mitigated') ||
      normalized.includes('cf-browser-verification') ||
      normalized.includes('document.cookie') ||
      normalized.includes('acw_sc__v2') ||
      normalized.includes('var arg1=')
    );
  }

  private isCloudflareError(error: any): boolean {
    if (
      this.isBrowserChallengeResponse(error?.response?.data) ||
      this.isBrowserChallengeResponse(error?.message)
    ) {
      return true;
    }

    if (error.response?.status === 403) {
      const data = error.response?.data || '';
      const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
      if (
        dataStr.includes('Just a moment') ||
        dataStr.includes('cf-mitigated') ||
        error.response?.headers?.['cf-mitigated'] === 'challenge'
      ) {
        return true;
      }
    }
    return false;
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

  private resolveSiteTypeByUrl(baseUrl: string, explicitSiteType?: SiteType) {
    return explicitSiteType ?? resolveSiteType(unifiedConfigManager.getSiteByUrl(baseUrl));
  }

  private getCheckInEndpoints(
    baseUrl: string,
    mode: 'status' | 'action',
    explicitSiteType?: SiteType
  ): Array<{ url: string; type: 'veloera' | 'newapi' }> {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const currentMonth = new Date().toISOString().slice(0, 7);
    const resolvedSiteType = this.resolveSiteTypeByUrl(baseUrl, explicitSiteType);
    const veloeraEndpoint =
      mode === 'status'
        ? { url: `${cleanBaseUrl}/api/user/check_in_status`, type: 'veloera' as const }
        : { url: `${cleanBaseUrl}/api/user/check_in`, type: 'veloera' as const };
    const newApiEndpoint =
      mode === 'status'
        ? {
            url: `${cleanBaseUrl}/api/user/checkin?month=${currentMonth}`,
            type: 'newapi' as const,
          }
        : { url: `${cleanBaseUrl}/api/user/checkin`, type: 'newapi' as const };

    switch (resolvedSiteType) {
      case 'veloera':
        return [veloeraEndpoint];
      case 'sub2api':
        return [];
      case 'newapi':
      case 'oneapi':
      case 'onehub':
      case 'donehub':
      case 'voapi':
      case 'superapi':
        return [newApiEndpoint];
      default:
        return [newApiEndpoint, veloeraEndpoint];
    }
  }

  private getSiteTypeProfileByUrl(baseUrl: string, explicitSiteType?: SiteType) {
    return getSiteTypeProfile(this.resolveSiteTypeByUrl(baseUrl, explicitSiteType));
  }

  private extractNumberByPaths(
    data: Record<string, any> | undefined,
    paths: string[],
    defaultValue = 0
  ): number {
    for (const path of paths) {
      const value = path.split('.').reduce<any>((current, key) => current?.[key], data);
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }

    return defaultValue;
  }

  private parseSub2ApiAccountData(meData?: Record<string, any>, usageData?: Record<string, any>) {
    return {
      quota: this.extractNumberByPaths(meData, [
        'balance',
        'quota',
        'remaining_balance',
        'credit_balance',
      ]),
      today_quota_consumption: this.extractNumberByPaths(usageData, [
        'today_actual_cost',
        'today_cost',
        'today_total_cost',
        'today_usage',
      ]),
      today_prompt_tokens: this.extractNumberByPaths(usageData, [
        'today_prompt_tokens',
        'prompt_tokens',
      ]),
      today_completion_tokens: this.extractNumberByPaths(usageData, [
        'today_completion_tokens',
        'completion_tokens',
      ]),
      today_requests_count: this.extractNumberByPaths(usageData, ['today_requests', 'requests']),
      can_check_in: false,
    };
  }

  private parseSub2ApiGroups(
    payload: any
  ): Record<string, { id?: number | string; desc: string; ratio: number }> {
    const data = payload?.data;

    if (Array.isArray(data)) {
      const groups: Record<string, { id?: number | string; desc: string; ratio: number }> = {};
      for (const group of data) {
        const key = String(group?.name || group?.id || group?.code || '').trim();
        if (!key) {
          continue;
        }
        groups[key] = {
          id: group?.id,
          desc: group?.display_name || group?.description || group?.desc || group?.name || key,
          ratio:
            typeof group?.ratio === 'number'
              ? group.ratio
              : typeof group?.rate_multiplier === 'number'
                ? group.rate_multiplier
                : typeof group?.multiplier === 'number'
                  ? group.multiplier
                  : 1,
        };
      }
      return groups;
    }

    if (data && typeof data === 'object') {
      return data;
    }

    return {};
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
    siteUrl?: string,
    explicitSiteType?: SiteType
  ): Record<string, string> {
    // 基础请求头（所有站点通用）
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      Pragma: 'no-cache',
    };

    if (!siteUrl || this.getSiteTypeProfileByUrl(siteUrl, explicitSiteType).includeUserIdHeaders) {
      const userIdHeaders = getAllUserIdHeaders(userId);
      Object.assign(headers, userIdHeaders);
    }

    return headers;
  }
}
