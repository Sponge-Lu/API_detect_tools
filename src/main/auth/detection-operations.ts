import type { SiteTypeProfile } from '../site-type-registry';
import { isAuthFailureText, isAuthFailureResponse } from './api-key-policy';
import { ChromeManager } from '../chrome-manager';
import { httpGet } from '../utils/http-client';

import type {
  SiteAccount,
  CachedDisplayData,
  RefreshAccountResult,
  AccountBasicInfoRefreshResult,
} from '../types/token';

import { getAllUserIdHeaders } from '../../shared/utils/headers';
import Logger from '../utils/logger';
import { runOnPageQueue } from '../utils/page-exec-queue';

import type { SiteType } from '../../shared/types/site';

import type {
  TokenRequestContext,
  InitializeSiteAccountOptions,
  RefreshAccountBasicInfoOptions,
} from './token-contracts';

export interface TokenOperationContext {
  fetchApiTokens(
    baseUrl: string,
    userId: number,
    accessToken: string,
    context?: TokenRequestContext
  ): Promise<any[]>;
  resolveSiteTypeByUrl(
    baseUrl: string,
    explicitSiteType?: SiteType
  ): 'oneapi' | 'newapi' | 'veloera' | 'onehub' | 'donehub' | 'voapi' | 'superapi' | 'sub2api';
  chromeManager: ChromeManager;
  initializeSiteAccount(
    baseUrl: string,
    waitForLogin?: boolean,
    maxWaitTime?: number,
    onStatus?: (status: string) => void,
    options?: InitializeSiteAccountOptions
  ): Promise<SiteAccount>;
  createRequestHeaders(
    userId: number,
    accessToken: string,
    siteUrl?: string,
    explicitSiteType?: SiteType
  ): Record<string, string>;
  parseSub2ApiAccountData(
    meData?: Record<string, any>,
    usageData?: Record<string, any>
  ): {
    quota: number;
    today_quota_consumption: number;
    today_prompt_tokens: number;
    today_completion_tokens: number;
    today_requests_count: number;
    can_check_in: boolean;
  };
  getSiteTypeProfileByUrl(baseUrl: string, explicitSiteType?: SiteType): SiteTypeProfile;
  buildAuthFailureError(payload: any, source: string): Error;
  parseSub2ApiGroups(
    payload: any
  ): Record<string, { id?: number | string; desc: string; ratio: number }>;
  isLoginExpiredError(error: any): boolean;
  isCloudflareError(error: any): boolean;
  isBrowserChallengeResponse(data: unknown): boolean;
  fetchAccountData(
    baseUrl: string,
    userId: number,
    accessToken: string,
    explicitSiteType?: SiteType
  ): Promise<{
    quota: number;
    today_quota_consumption: number;
    today_prompt_tokens: number;
    today_completion_tokens: number;
    today_requests_count: number;
    can_check_in?: boolean;
  }>;
  fetchUserGroups(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page?: any,
    explicitSiteType?: SiteType,
    options?: { proxyUrl?: string }
  ): Promise<Record<string, { id?: number | string; desc: string; ratio: number }>>;
  fetchModelPricing(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page?: any,
    explicitSiteType?: SiteType,
    options?: { proxyUrl?: string }
  ): Promise<any>;
  fetchUserGroupsInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page: any,
    explicitSiteType?: SiteType
  ): Promise<Record<string, { id?: number | string; desc: string; ratio: number }>>;
  fetchModelPricingInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page: any,
    explicitSiteType?: SiteType
  ): Promise<any>;
}
export async function refreshDisplayData(
  dependencies: TokenOperationContext,
  account: SiteAccount
): Promise<RefreshAccountResult> {
  Logger.info('🔄 [TokenService] 刷新显示数据...');
  Logger.info('📍 [TokenService] 站点:', account.site_name);
  Logger.info('🆔 [TokenService] 用户ID:', account.user_id);

  try {
    // 并行获取所有显示数据
    const [accountData, apiKeys, userGroups, modelPricing] = await Promise.allSettled([
      dependencies.fetchAccountData(
        account.site_url,
        account.user_id,
        account.access_token,
        account.site_type
      ),
      dependencies.fetchApiTokens(account.site_url, account.user_id, account.access_token, {
        siteType: account.site_type,
      }),
      dependencies.fetchUserGroups(
        account.site_url,
        account.user_id,
        account.access_token,
        undefined,
        account.site_type
      ),
      dependencies.fetchModelPricing(
        account.site_url,
        account.user_id,
        account.access_token,
        undefined,
        account.site_type
      ),
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

export async function refreshAccountBasicInfo(
  dependencies: TokenOperationContext,
  account: Pick<SiteAccount, 'site_url' | 'user_id' | 'access_token'> & { site_type?: SiteType },
  onStatus?: (status: string) => void,
  options?: RefreshAccountBasicInfoOptions
): Promise<AccountBasicInfoRefreshResult> {
  const siteType = account.site_type || dependencies.resolveSiteTypeByUrl(account.site_url);
  Logger.info('🔄 [TokenService] 从浏览器刷新账户基础信息...', {
    siteUrl: account.site_url,
    siteType,
  });

  try {
    if (options?.profileOptions) {
      onStatus?.('正在启动账户浏览器 Profile...');
      const launchResult = await dependencies.chromeManager.launchForLogin(
        account.site_url,
        options.profileOptions,
        { preserveSession: true }
      );
      if (!launchResult.success) {
        return {
          success: false,
          healthStatus: {
            status: 'error',
            message: launchResult.message || '无法访问浏览器',
          },
        };
      }
    }

    const siteAccount = await dependencies.initializeSiteAccount(
      account.site_url,
      true,
      600000,
      onStatus,
      { loginMode: true, siteType }
    );
    const tokenRefreshed = siteAccount.access_token !== account.access_token;

    return {
      success: true,
      data: {
        user_id: String(siteAccount.user_id),
        username: siteAccount.username || undefined,
        access_token: siteAccount.access_token,
        site_url: siteAccount.site_url || siteAccount.url || account.site_url,
        site_type: siteAccount.site_type || siteType,
        tokenRefreshed,
      },
      healthStatus: {
        status: 'healthy',
        message: tokenRefreshed
          ? '账户基础信息已刷新，access token 已重新创建'
          : '账户基础信息已刷新',
      },
    };
  } catch (error: any) {
    Logger.error('❌ [TokenService] 刷新账户基础信息失败:', error.message);
    return {
      success: false,
      healthStatus: {
        status: 'error',
        message: error.message,
      },
    };
  } finally {
    if (options?.profileOptions) {
      dependencies.chromeManager.cleanupLoginBrowser();
    }
  }
}

export async function validateToken(
  dependencies: TokenOperationContext,
  account: SiteAccount
): Promise<boolean> {
  try {
    // 尝试调用API验证令牌
    await dependencies.fetchAccountData(
      account.site_url,
      account.user_id,
      account.access_token,
      account.site_type
    );
    return true;
  } catch (error: any) {
    Logger.error('❌ [TokenService] 令牌验证失败');
    return false;
  }
}

export async function fetchAccountData(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  explicitSiteType?: SiteType
): Promise<{
  quota: number;
  today_quota_consumption: number;
  today_prompt_tokens: number;
  today_completion_tokens: number;
  today_requests_count: number;
  can_check_in?: boolean;
}> {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const siteType = dependencies.resolveSiteTypeByUrl(baseUrl, explicitSiteType);

  if (siteType === 'sub2api') {
    const [meResponse, usageResponse] = await Promise.all([
      httpGet(`${cleanBaseUrl}/api/v1/auth/me`, {
        headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl, explicitSiteType),
        timeout: 10000,
      }),
      httpGet(`${cleanBaseUrl}/api/v1/usage/stats`, {
        headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl, explicitSiteType),
        timeout: 10000,
      }),
    ]);

    if (meResponse.data?.code !== 0 || !meResponse.data?.data) {
      throw new Error(meResponse.data?.message || '获取 sub2api 账户信息失败');
    }

    if (usageResponse.data?.code !== 0 || !usageResponse.data?.data) {
      throw new Error(usageResponse.data?.message || '获取 sub2api 使用量失败');
    }

    return dependencies.parseSub2ApiAccountData(meResponse.data.data, usageResponse.data.data);
  }

  const url = `${cleanBaseUrl}/api/user/self`;

  const response = await httpGet(url, {
    headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl, explicitSiteType),
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

export async function fetchUserGroups(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  page?: any,
  explicitSiteType?: SiteType,
  options?: { proxyUrl?: string }
): Promise<Record<string, { id?: number | string; desc: string; ratio: number }>> {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const siteType = dependencies.resolveSiteTypeByUrl(baseUrl, explicitSiteType);
  const urls = dependencies
    .getSiteTypeProfileByUrl(baseUrl, explicitSiteType)
    .userGroupEndpoints.map(endpoint => `${cleanBaseUrl}${endpoint}`);

  // 如果提供了page，使用浏览器环境
  if (page) {
    return await dependencies.fetchUserGroupsInBrowser(
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
        headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl, explicitSiteType),
        timeout: 10000,
        proxyUrl: options?.proxyUrl,
      });

      if (isAuthFailureResponse(response.data, response.status)) {
        throw dependencies.buildAuthFailureError(response.data, '用户分组接口');
      }

      if (siteType === 'sub2api' && response.data?.code === 0) {
        Logger.info('✅ [TokenService] 用户分组获取成功 (sub2api格式)');
        return dependencies.parseSub2ApiGroups(response.data);
      }

      // New API 格式: { success: true, data: { "default": {...}, "vip": {...} } }
      if (response.data?.success && response.data?.data && typeof response.data.data === 'object') {
        Logger.info('✅ [TokenService] 用户分组获取成功 (New API格式)');

        // 检查是否为Done Hub格式（有name和ratio字段）
        const firstValue = Object.values(response.data.data)[0] as any;
        if (firstValue && ('name' in firstValue || 'ratio' in firstValue)) {
          // Done Hub 格式: { data: { default: { id, symbol, name, ratio, enable, ... } }, success: true }
          Logger.info('   格式类型: Done Hub');
          Logger.info('   原始分组数据:', response.data.data);
          const groups: Record<string, { id?: number | string; desc: string; ratio: number }> = {};
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
      if (
        response.data &&
        typeof response.data === 'object' &&
        !Array.isArray(response.data) &&
        !('success' in response.data)
      ) {
        Logger.info('✅ [TokenService] 用户分组获取成功 (直接对象格式)');
        return response.data;
      }
    } catch (error: any) {
      if (dependencies.isLoginExpiredError(error)) {
        throw error;
      }

      const errorPayload = error.response?.data || { message: error.message };
      if (
        !dependencies.isCloudflareError(error) &&
        (isAuthFailureResponse(errorPayload, error.response?.status) ||
          isAuthFailureText(error.message))
      ) {
        throw dependencies.buildAuthFailureError(errorPayload, '用户分组接口');
      }

      Logger.warn(`⚠️ [TokenService] URL ${url} 失败:`, error.message);
      continue;
    }
  }

  // 所有URL都失败，尝试浏览器模式
  if (dependencies.isCloudflareError(urls[0]) && page) {
    Logger.info('🛡️ [TokenService] 检测到Cloudflare，使用共享浏览器页面获取用户分组...');
    try {
      return await dependencies.fetchUserGroupsInBrowser(
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

export async function fetchUserGroupsInBrowser(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  page: any,
  explicitSiteType?: SiteType
): Promise<Record<string, { id?: number | string; desc: string; ratio: number }>> {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const siteType = dependencies.resolveSiteTypeByUrl(baseUrl, explicitSiteType);
  const urls = dependencies
    .getSiteTypeProfileByUrl(baseUrl, explicitSiteType)
    .userGroupEndpoints.map(endpoint => `${cleanBaseUrl}${endpoint}`);

  const userIdHeaders = dependencies.getSiteTypeProfileByUrl(baseUrl, explicitSiteType)
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

      if (isAuthFailureResponse(result)) {
        throw dependencies.buildAuthFailureError(result, '用户分组接口');
      }

      if (siteType === 'sub2api' && result?.code === 0) {
        Logger.info('✅ [TokenService] 浏览器获取成功 (sub2api格式)');
        return dependencies.parseSub2ApiGroups(result);
      }

      // New API 格式: { success: true, data: { "default": {...}, "vip": {...} } }
      if (result?.success && result?.data && typeof result.data === 'object') {
        Logger.info('✅ [TokenService] 浏览器获取成功 (New API格式)');

        // 检查是否为Done Hub格式（有name和ratio字段）
        const firstValue = Object.values(result.data)[0] as any;
        if (firstValue && ('name' in firstValue || 'ratio' in firstValue)) {
          // Done Hub 格式
          Logger.info('   格式类型: Done Hub');
          const groups: Record<string, { id?: number | string; desc: string; ratio: number }> = {};
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
      if (
        result &&
        typeof result === 'object' &&
        !Array.isArray(result) &&
        !('success' in result)
      ) {
        Logger.info('✅ [TokenService] 浏览器获取成功 (直接对象格式)');
        return result;
      }
    } catch (error: any) {
      if (dependencies.isLoginExpiredError(error)) {
        throw error;
      }

      if (isAuthFailureText(error.message)) {
        throw dependencies.buildAuthFailureError({ message: error.message }, '用户分组接口');
      }

      Logger.warn(`⚠️ [TokenService] 浏览器URL ${url} 失败:`, error.message);
      continue;
    }
  }

  return {};
}

export async function fetchModelPricing(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  page?: any,
  explicitSiteType?: SiteType,
  options?: { proxyUrl?: string }
): Promise<any> {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const profile = dependencies.getSiteTypeProfileByUrl(baseUrl, explicitSiteType);
  const siteType = dependencies.resolveSiteTypeByUrl(baseUrl, explicitSiteType);
  const urls = profile.modelPricingEndpoints.map(endpoint => `${cleanBaseUrl}${endpoint}`);

  if (!profile.supportsModelPricing || urls.length === 0) {
    Logger.info(`ℹ️ [TokenService] 站点类型 ${siteType} 未提供模型定价接口，返回空定价`);
    return { data: {} };
  }

  // 如果提供了page，使用浏览器环境
  if (page) {
    return await dependencies.fetchModelPricingInBrowser(
      baseUrl,
      userId,
      accessToken,
      page,
      explicitSiteType
    );
  }

  for (const url of urls) {
    try {
      Logger.info(`📡 [TokenService] 尝试获取模型定价: ${url}`);
      const response = await httpGet(url, {
        headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl, explicitSiteType),
        timeout: 10000,
        proxyUrl: options?.proxyUrl,
      });

      const rawData = response.data;
      const data = rawData && typeof rawData === 'object' ? rawData : null;

      if (dependencies.isBrowserChallengeResponse(rawData)) {
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
      const pageResult = await dependencies.chromeManager.createPage(baseUrl);
      const browserPage = pageResult.page;
      const pageRelease = pageResult.release;
      try {
        await browserPage.waitForSelector('body', { timeout: 10000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        return await dependencies.fetchModelPricingInBrowser(
          baseUrl,
          userId,
          accessToken,
          browserPage,
          explicitSiteType
        );
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

export async function fetchModelPricingInBrowser(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  page: any,
  explicitSiteType?: SiteType
): Promise<any> {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const profile = dependencies.getSiteTypeProfileByUrl(baseUrl, explicitSiteType);
  const urls = profile.modelPricingEndpoints.map(endpoint => `${cleanBaseUrl}${endpoint}`);

  if (!profile.supportsModelPricing || urls.length === 0) {
    return { data: {} };
  }

  const userIdHeaders = profile.includeUserIdHeaders ? getAllUserIdHeaders(userId) : {};

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
