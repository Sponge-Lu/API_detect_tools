import type { SiteTypeProfile } from '../site-type-registry';
import {
  normalizeApiKeyValue,
  isMaskedApiKeyValue,
  resolveApiKeyValue,
  isAuthFailureText,
  isAuthFailureResponse,
  resolveApiKeyFetchId,
  withResolvedApiKeyValue,
  normalizeApiKeyGroup,
  mergeApiKeysPreservingRawValue,
} from './api-key-policy';
import { ChromeManager } from '../chrome-manager';
import { httpGet, httpPost, httpRequest } from '../utils/http-client';

import { getAllUserIdHeaders } from '../../shared/utils/headers';
import Logger from '../utils/logger';
import { runOnPageQueue } from '../utils/page-exec-queue';

import type { SiteType } from '../../shared/types/site';
import { QUOTA_CONVERSION_FACTOR } from '../../shared/constants';
import type { CreateApiTokenPayload, TokenRequestContext } from './token-contracts';

export interface TokenOperationContext {
  fetchUserGroups(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page?: any,
    explicitSiteType?: SiteType,
    options?: { proxyUrl?: string }
  ): Promise<Record<string, { id?: number | string; desc: string; ratio: number }>>;
  resolveSiteTypeByUrl(
    baseUrl: string,
    explicitSiteType?: SiteType
  ): 'oneapi' | 'newapi' | 'veloera' | 'onehub' | 'donehub' | 'voapi' | 'superapi' | 'sub2api';
  getSiteTypeProfileByUrl(baseUrl: string, explicitSiteType?: SiteType): SiteTypeProfile;
  createRequestHeaders(
    userId: number,
    accessToken: string,
    siteUrl?: string,
    explicitSiteType?: SiteType
  ): Record<string, string>;
  isBrowserChallengeResponse(data: unknown): boolean;
  buildSub2ApiTokenExpiredError(payload: any): Error;
  buildAuthFailureError(payload: any, source: string): Error;
  isLoginExpiredError(error: any): boolean;
  isCloudflareError(error: any): boolean;
  isNetworkConnectionError(error: any): boolean;
  chromeManager: ChromeManager;
  waitForCloudflareChallengeToPass(page: any, maxWaitMs?: number): Promise<void>;
  fetchSub2ApiApiKeyUsageStats(
    baseUrl: string,
    accessToken: string,
    apiKeyIds: Array<number | string>
  ): Promise<Record<string, { today_actual_cost?: number; total_actual_cost?: number }>>;
  resolveSub2ApiGroupName(
    apiKey: any,
    userGroups?: Record<string, { id?: number | string; desc: string; ratio: number }>
  ): string;
  normalizeSub2ApiUsdValue(value: unknown): number | undefined;
  enrichSub2ApiApiKeys(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokens: any[],
    siteType?: SiteType
  ): Promise<any[]>;
  enrichMaskedApiKeys(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokens: any[],
    page?: any,
    context?: TokenRequestContext
  ): Promise<any[]>;
  fetchApiTokensInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page: any,
    explicitSiteType?: SiteType
  ): Promise<any[]>;
  fetchRawApiKeyValuesBatch(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenIds: string[],
    page?: any,
    explicitSiteType?: SiteType
  ): Promise<Map<string, string>>;
  resolveUsableApiKeyValue(
    baseUrl: string,
    userId: number,
    accessToken: string,
    apiKey: any,
    context?: TokenRequestContext & { page?: any }
  ): Promise<string | null>;
  extractBatchRawApiKeyValues(payload: unknown): Map<string, string>;
  extractRawApiKeyValue(payload: unknown): string | null;
  fetchRawApiKeyValue(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenId: string,
    page?: any
  ): Promise<string | null>;
  shouldFallbackToBrowserForRawApiKey(error: any, context?: TokenRequestContext): boolean;
  deleteSub2ApiApiTokenInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenIdentifier: { id?: string; key?: string },
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }>;
  deleteSub2ApiApiToken(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenIdentifier: { id?: string; key?: string },
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }>;
  deleteApiTokenInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenIdentifier: { id?: string; key?: string },
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }>;
  normalizeTokenGroup(group: unknown): string;
  getTokenIdentity(token: any): string | null;
  isCreatedTokenMatch(token: any, tokenData: CreateApiTokenPayload): boolean;
  extractCreatedRawApiKey(createResponseData: any): string | null;
  fetchApiTokens(
    baseUrl: string,
    userId: number,
    accessToken: string,
    context?: TokenRequestContext
  ): Promise<any[]>;
  buildSub2ApiCreatePayload(
    tokenData: CreateApiTokenPayload,
    userGroups: Record<string, { id?: number | string; desc: string; ratio: number }>
  ): Record<string, unknown>;
  createSub2ApiApiTokenInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenData: CreateApiTokenPayload,
    payload: Record<string, unknown>,
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }>;
  mergeCreatedRawKeyIntoTokens(
    beforeTokens: any[],
    afterTokens: any[],
    tokenData: CreateApiTokenPayload,
    createResponseData: any
  ): any[];
  createSub2ApiApiToken(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenData: CreateApiTokenPayload,
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }>;
  createApiTokenInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenData: CreateApiTokenPayload,
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }>;
  hasVerifiedCreatedToken(
    beforeTokens: any[],
    afterTokens: any[],
    tokenData: CreateApiTokenPayload
  ): boolean;
}
export function resolveSub2ApiGroupName(
  dependencies: TokenOperationContext,
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

export function normalizeSub2ApiUsdValue(
  dependencies: TokenOperationContext,
  value: unknown
): number | undefined {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return undefined;
  }
  return normalized;
}

export async function fetchSub2ApiApiKeyUsageStats(
  dependencies: TokenOperationContext,
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

export async function enrichSub2ApiApiKeys(
  dependencies: TokenOperationContext,
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
    userGroups = await dependencies.fetchUserGroups(
      baseUrl,
      userId,
      accessToken,
      undefined,
      siteType
    );
  } catch (error: any) {
    Logger.warn('⚠️ [TokenService] sub2api API Key 分组映射失败，继续使用原始列表:', error.message);
  }

  let usageStats: Record<string, { today_actual_cost?: number; total_actual_cost?: number }> = {};
  try {
    usageStats = await dependencies.fetchSub2ApiApiKeyUsageStats(
      baseUrl,
      accessToken,
      normalizedTokens
        .map(token => token?.id ?? token?.token_id)
        .filter((id): id is number | string => id !== undefined && id !== null)
    );
  } catch (error: any) {
    Logger.warn('⚠️ [TokenService] sub2api API Key 用量获取失败，继续使用基础列表:', error.message);
  }

  return normalizedTokens.map(token => {
    const resolvedGroup = dependencies.resolveSub2ApiGroupName(token, userGroups);
    const quota = dependencies.normalizeSub2ApiUsdValue(token?.quota);
    const quotaUsed = dependencies.normalizeSub2ApiUsdValue(token?.quota_used);
    const usage = usageStats[String(token?.id ?? token?.token_id ?? '')];
    const totalActualCost = dependencies.normalizeSub2ApiUsdValue(usage?.total_actual_cost);
    const todayActualCost = dependencies.normalizeSub2ApiUsdValue(usage?.today_actual_cost);
    const effectiveUsedCost = totalActualCost ?? quotaUsed;
    const remainQuotaUsd =
      quota && effectiveUsedCost !== undefined ? Math.max(0, quota - effectiveUsedCost) : undefined;
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

export function buildSub2ApiCreatePayload(
  dependencies: TokenOperationContext,
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

export async function fetchApiTokens(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  context?: TokenRequestContext
): Promise<any[]> {
  Logger.info('🔑 [TokenService] 获取API Keys...', { browserSlot: context?.browserSlot ?? 0 });

  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const siteType = dependencies.resolveSiteTypeByUrl(baseUrl, context?.siteType);
  const profile = dependencies.getSiteTypeProfileByUrl(baseUrl, context?.siteType);
  const urls = profile.apiTokenListEndpoints.map(endpoint => `${cleanBaseUrl}${endpoint}`);

  let lastError: any = null;
  let lastStatus: number | undefined = undefined;
  let needBrowserFallback = false;
  let sub2ApiTokenExpiredError: Error | undefined;

  for (const url of urls) {
    try {
      const response = await httpGet(url, {
        headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl, context?.siteType),
        timeout: 10000,
        proxyUrl: context?.proxyUrl,
      });

      const rawData = response.data;
      const data = rawData && typeof rawData === 'object' ? rawData : null;

      if (dependencies.isBrowserChallengeResponse(rawData)) {
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

      if (isAuthFailureResponse(data, response.status)) {
        if (siteType === 'sub2api') {
          sub2ApiTokenExpiredError = dependencies.buildSub2ApiTokenExpiredError(data);
          continue;
        }

        throw dependencies.buildAuthFailureError(data, 'API Key 接口');
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
          return await dependencies.enrichSub2ApiApiKeys(
            baseUrl,
            userId,
            accessToken,
            tokens,
            context?.siteType
          );
        }
        return await dependencies.enrichMaskedApiKeys(
          baseUrl,
          userId,
          accessToken,
          tokens,
          undefined,
          {
            browserSlot: context?.browserSlot,
            allowBrowserFallback: true,
            challengeWaitMs: 10000,
          }
        );
      }
    } catch (error: any) {
      lastError = error;
      lastStatus = error.response?.status;

      if (dependencies.isLoginExpiredError(error)) {
        throw error;
      }

      const errorPayload = error.response?.data || { message: error.message };
      if (
        !dependencies.isCloudflareError(error) &&
        (isAuthFailureResponse(errorPayload, lastStatus) || isAuthFailureText(error.message))
      ) {
        if (siteType === 'sub2api') {
          sub2ApiTokenExpiredError = dependencies.buildSub2ApiTokenExpiredError(errorPayload);
          continue;
        }

        throw dependencies.buildAuthFailureError(errorPayload, 'API Key 接口');
      }

      if (dependencies.isNetworkConnectionError(error)) {
        needBrowserFallback = true;
        break;
      }

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
    (lastError &&
      (lastStatus === 403 ||
        dependencies.isCloudflareError(lastError) ||
        dependencies.isNetworkConnectionError(lastError)))
  ) {
    Logger.info('🛡️ [TokenService] axios 获取 API Keys 失败，尝试使用浏览器模式重新获取...');
    try {
      // 通过 ChromeManager 创建页面（自动管理引用计数与生命周期）
      const { page: browserPage, release } = await dependencies.chromeManager.createPage(
        cleanBaseUrl,
        {
          slot: context?.browserSlot,
        }
      );
      try {
        // 等待 Cloudflare 验证通过（如果存在）
        await dependencies.waitForCloudflareChallengeToPass(browserPage);
        const tokens = await dependencies.fetchApiTokensInBrowser(
          baseUrl,
          userId,
          accessToken,
          browserPage,
          context?.siteType
        );
        return siteType === 'sub2api'
          ? await dependencies.enrichSub2ApiApiKeys(
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

export async function fetchApiTokensInBrowser(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  page: any,
  explicitSiteType?: SiteType
): Promise<any[]> {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const siteType = dependencies.resolveSiteTypeByUrl(baseUrl, explicitSiteType);
  const urls = dependencies
    .getSiteTypeProfileByUrl(baseUrl, explicitSiteType)
    .apiTokenListEndpoints.map(endpoint => `${cleanBaseUrl}${endpoint}`);

  const userIdHeaders = dependencies.getSiteTypeProfileByUrl(baseUrl, explicitSiteType)
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

      if (isAuthFailureResponse(result)) {
        throw siteType === 'sub2api'
          ? dependencies.buildSub2ApiTokenExpiredError(result)
          : dependencies.buildAuthFailureError(result, 'API Key 接口');
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
        return await dependencies.enrichMaskedApiKeys(baseUrl, userId, accessToken, tokens, page, {
          allowBrowserFallback: false,
        });
      }
    } catch (error: any) {
      if (dependencies.isLoginExpiredError(error)) {
        throw error;
      }

      if (isAuthFailureText(error.message)) {
        throw dependencies.buildAuthFailureError({ message: error.message }, 'API Key 接口');
      }

      Logger.error(`❌ [TokenService] URL ${url} 失败:`, error.message);
      continue;
    }
  }

  Logger.warn('⚠️ [TokenService] 所有URL都失败，返回空数组');
  return [];
}

export async function enrichMaskedApiKeys(
  dependencies: TokenOperationContext,
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
  const siteType = dependencies.resolveSiteTypeByUrl(baseUrl, context?.siteType);

  if (siteType === 'newapi') {
    try {
      const batchValues = await dependencies.fetchRawApiKeyValuesBatch(
        baseUrl,
        userId,
        accessToken,
        maskedEntries.map(entry => entry.tokenId as string),
        page,
        context?.siteType
      );

      for (const entry of maskedEntries) {
        const resolvedValue = batchValues.get(entry.tokenId as string);
        if (resolvedValue && !isMaskedApiKeyValue(resolvedValue)) {
          resolvedValues.set(entry.index, resolvedValue);
        }
      }

      if (batchValues.size > 0) {
        Logger.info(
          `✅ [TokenService] NewAPI 批量明文 API Key 获取成功: ${batchValues.size}/${maskedEntries.length}`
        );
      }
    } catch (error: any) {
      Logger.warn(
        '⚠️ [TokenService] NewAPI 批量明文 API Key 获取失败，回退到单个接口:',
        error?.message || error
      );
    }
  }

  await Promise.all(
    maskedEntries.map(async entry => {
      if (resolvedValues.has(entry.index)) {
        return;
      }

      try {
        const resolvedValue = await dependencies.resolveUsableApiKeyValue(
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

export function extractBatchRawApiKeyValues(
  dependencies: TokenOperationContext,
  payload: unknown
): Map<string, string> {
  const result = new Map<string, string>();

  if (!payload || typeof payload !== 'object') {
    return result;
  }

  const record = payload as Record<string, any>;
  const data = record.data && typeof record.data === 'object' ? record.data : record;
  const keys = data.keys && typeof data.keys === 'object' ? data.keys : data;

  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
    return result;
  }

  for (const [tokenId, rawValue] of Object.entries(keys)) {
    const normalized = normalizeApiKeyValue(rawValue);
    if (normalized && !isMaskedApiKeyValue(normalized)) {
      result.set(String(tokenId), normalized);
    }
  }

  return result;
}

export async function fetchRawApiKeyValuesBatch(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  tokenIds: string[],
  page?: any,
  explicitSiteType?: SiteType
): Promise<Map<string, string>> {
  const numericIds = Array.from(
    new Set(
      tokenIds
        .map(tokenId => Number(tokenId))
        .filter(tokenId => Number.isInteger(tokenId) && tokenId > 0)
    )
  );

  if (numericIds.length === 0) {
    return new Map();
  }

  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const url = `${cleanBaseUrl}/api/token/batch/keys`;
  const resolvedValues = new Map<string, string>();

  for (let offset = 0; offset < numericIds.length; offset += 100) {
    const ids = numericIds.slice(offset, offset + 100);

    if (page) {
      const userIdHeaders = dependencies.getSiteTypeProfileByUrl(baseUrl, explicitSiteType)
        .includeUserIdHeaders
        ? getAllUserIdHeaders(userId)
        : {};
      const result = await runOnPageQueue(page, () =>
        page.evaluate(
          async (
            apiUrl: string,
            token: string,
            requestIds: number[],
            additionalHeaders: Record<string, string>
          ) => {
            const response = await fetch(apiUrl, {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                ...additionalHeaders,
                Pragma: 'no-cache',
              },
              body: JSON.stringify({ ids: requestIds }),
            });

            const status = response.status;
            const text = await response.text();
            try {
              return { ok: response.ok, status, isJson: true, data: JSON.parse(text) };
            } catch {
              return { ok: response.ok, status, isJson: false, textSnippet: text.slice(0, 500) };
            }
          },
          url,
          accessToken,
          ids,
          userIdHeaders
        )
      );

      if (!result.ok || result.status < 200 || result.status >= 300 || !result.isJson) {
        const reason = result.isJson
          ? result.data?.message || `HTTP ${result.status}`
          : result.textSnippet || `HTTP ${result.status}`;
        throw new Error(reason);
      }

      for (const [tokenId, rawValue] of dependencies.extractBatchRawApiKeyValues(result.data)) {
        resolvedValues.set(tokenId, rawValue);
      }
      continue;
    }

    const response = await httpPost(
      url,
      { ids },
      {
        headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl, explicitSiteType),
        timeout: 10000,
        validateStatus: (status: number) => status < 500,
      }
    );

    if (dependencies.isBrowserChallengeResponse(response.data)) {
      throw new Error('Browser challenge response');
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.data?.message || `HTTP ${response.status}`);
    }

    for (const [tokenId, rawValue] of dependencies.extractBatchRawApiKeyValues(response.data)) {
      resolvedValues.set(tokenId, rawValue);
    }
  }

  return resolvedValues;
}

export function extractRawApiKeyValue(
  dependencies: TokenOperationContext,
  payload: unknown
): string | null {
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

export async function fetchRawApiKeyValue(
  dependencies: TokenOperationContext,
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

      if (!result.isJson && dependencies.isBrowserChallengeResponse(result.textSnippet)) {
        lastError = preferRawApiKeyError(
          lastError,
          new Error('Browser challenge response') as Error & { status?: number }
        );
        continue;
      }

      const extracted = dependencies.extractRawApiKeyValue(
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
                headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl),
                timeout: 10000,
                validateStatus: (status: number) => status < 500,
              }
            )
          : await httpGet(url, {
              headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl),
              timeout: 10000,
              validateStatus: (status: number) => status < 500,
            });

      if (dependencies.isBrowserChallengeResponse(response.data)) {
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

      const extracted = dependencies.extractRawApiKeyValue(response.data);
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

export async function resolveUsableApiKeyValue(
  dependencies: TokenOperationContext,
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
      const resolvedValue = await dependencies.fetchRawApiKeyValue(
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
    const resolvedValue = await dependencies.fetchRawApiKeyValue(
      baseUrl,
      userId,
      accessToken,
      tokenId
    );
    return resolvedValue && !isMaskedApiKeyValue(resolvedValue) ? resolvedValue : null;
  } catch (error: any) {
    if (!dependencies.shouldFallbackToBrowserForRawApiKey(error, context)) {
      Logger.warn(`⚠️ [TokenService] 解析 API Key ${tokenId} 失败:`, error?.message || error);
      return null;
    }
  }

  try {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const { page, release } = await dependencies.chromeManager.createPage(cleanBaseUrl, {
      slot: context?.browserSlot,
    });

    try {
      await page.bringToFront().catch(() => {});
      await dependencies.waitForCloudflareChallengeToPass(page, context?.challengeWaitMs ?? 10000);
      const resolvedValue = await dependencies.fetchRawApiKeyValue(
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

export function shouldFallbackToBrowserForRawApiKey(
  dependencies: TokenOperationContext,
  error: any,
  context?: TokenRequestContext
): boolean {
  if (context?.allowBrowserFallback === false) {
    return false;
  }

  const status = error?.status ?? error?.response?.status;
  if (status === 401 || status === 403 || status === 0) {
    return true;
  }

  return (
    dependencies.isCloudflareError(error) ||
    String(error?.message || '').includes('Browser challenge response')
  );
}

export async function deleteSub2ApiApiToken(
  dependencies: TokenOperationContext,
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
      headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl),
      timeout: 15000,
      validateStatus: (status: number) => status < 500,
    });

    if (dependencies.isBrowserChallengeResponse(response.data)) {
      Logger.warn('🛡️ [TokenService] sub2api 删除令牌遇到挑战页响应，准备回退到浏览器模式');
      return await dependencies.deleteSub2ApiApiTokenInBrowser(
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
    if (
      dependencies.isCloudflareError(error) ||
      dependencies.isBrowserChallengeResponse(error?.response?.data)
    ) {
      return await dependencies.deleteSub2ApiApiTokenInBrowser(
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

export async function deleteSub2ApiApiTokenInBrowser(
  dependencies: TokenOperationContext,
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

  const { page, release } = await dependencies.chromeManager.createPage(cleanBaseUrl, {
    slot: context?.browserSlot,
  });

  try {
    await page.bringToFront().catch(() => {});
    await dependencies.waitForCloudflareChallengeToPass(page);

    const additionalHeaders = dependencies.getSiteTypeProfileByUrl(baseUrl).includeUserIdHeaders
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

export async function deleteApiToken(
  dependencies: TokenOperationContext,
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

  if (dependencies.resolveSiteTypeByUrl(baseUrl) === 'sub2api') {
    return await dependencies.deleteSub2ApiApiToken(
      baseUrl,
      userId,
      accessToken,
      { id, key },
      context
    );
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
        headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl),
        timeout: 15000,
        validateStatus: (status: number) => status < 500,
      });

      const rawData = response.data;

      // 如果返回的是 HTML/挑战页，很可能被站点防护拦截，后续使用浏览器模式重试
      if (dependencies.isBrowserChallengeResponse(rawData)) {
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
          Logger.warn('⚠️ [TokenService] 删除令牌业务失败，尝试下一个候选:', (data as any).message);
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
      if (dependencies.isCloudflareError(error)) {
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
      Logger.error('❌ [TokenService] 所有 axios 删除方式均失败:', lastError.message || lastError);
      throw lastError;
    }
    Logger.error('❌ [TokenService] 无可用的删除方式，axios 删除失败');
    throw new Error('删除 API Key 失败，后端未提供兼容的删除端点');
  }

  // ===== 2. 浏览器模式（Cloudflare 场景 / axios 不可用时）=====
  return await dependencies.deleteApiTokenInBrowser(
    baseUrl,
    userId,
    accessToken,
    { id, key },
    context
  );
}

export async function deleteApiTokenInBrowser(
  dependencies: TokenOperationContext,
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

  const { page, release } = await dependencies.chromeManager.createPage(cleanBaseUrl, {
    slot: context?.browserSlot,
  });

  try {
    // 确保页面前置，方便用户在 Cloudflare 页面中进行验证
    await page.bringToFront().catch(() => {});

    // 等待 Cloudflare 验证通过（如果存在）
    await dependencies.waitForCloudflareChallengeToPass(page);

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
      Logger.info(`📡 [TokenService] 浏览器删除令牌: ${candidate.description} -> ${candidate.url}`);

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
      const tokens = await dependencies.fetchApiTokensInBrowser(baseUrl, userId, accessToken, page);
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

export function normalizeTokenGroup(dependencies: TokenOperationContext, group: unknown): string {
  return normalizeApiKeyGroup(group);
}

export function getTokenIdentity(dependencies: TokenOperationContext, token: any): string | null {
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

export function isCreatedTokenMatch(
  dependencies: TokenOperationContext,
  token: any,
  tokenData: CreateApiTokenPayload
): boolean {
  if (!token || typeof token !== 'object') {
    return false;
  }

  const tokenName = String(token.name ?? token.token_name ?? '').trim();
  if (tokenName !== tokenData.name) {
    return false;
  }

  if (
    dependencies.normalizeTokenGroup(token.group) !==
    dependencies.normalizeTokenGroup(tokenData.group)
  ) {
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

export function hasVerifiedCreatedToken(
  dependencies: TokenOperationContext,
  beforeTokens: any[],
  afterTokens: any[],
  tokenData: CreateApiTokenPayload
): boolean {
  const beforeIds = new Set(
    beforeTokens
      .map(token => dependencies.getTokenIdentity(token))
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  );

  return afterTokens.some(token => {
    if (!dependencies.isCreatedTokenMatch(token, tokenData)) {
      return false;
    }

    const identity = dependencies.getTokenIdentity(token);
    if (identity) {
      return !beforeIds.has(identity);
    }

    return afterTokens.length > beforeTokens.length;
  });
}

export function extractCreatedRawApiKey(
  dependencies: TokenOperationContext,
  createResponseData: any
): string | null {
  const containers = [createResponseData, createResponseData?.data, createResponseData?.data?.data];

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

export function mergeCreatedRawKeyIntoTokens(
  dependencies: TokenOperationContext,
  beforeTokens: any[],
  afterTokens: any[],
  tokenData: CreateApiTokenPayload,
  createResponseData: any
): any[] {
  const rawKey = dependencies.extractCreatedRawApiKey(createResponseData);
  if (!rawKey || afterTokens.length === 0) {
    return afterTokens;
  }

  const beforeIds = new Set(
    beforeTokens
      .map(token => dependencies.getTokenIdentity(token))
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  );

  const createdToken =
    afterTokens.find(token => {
      if (!dependencies.isCreatedTokenMatch(token, tokenData)) {
        return false;
      }

      const identity = dependencies.getTokenIdentity(token);
      return identity ? !beforeIds.has(identity) : afterTokens.length > beforeTokens.length;
    }) || afterTokens.find(token => dependencies.isCreatedTokenMatch(token, tokenData));

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

export async function createSub2ApiApiToken(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  tokenData: CreateApiTokenPayload,
  context?: TokenRequestContext
): Promise<{ success: boolean; data?: any[] }> {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const url = `${cleanBaseUrl}/api/v1/keys`;
  const beforeTokens = await dependencies.fetchApiTokens(baseUrl, userId, accessToken, context);
  const userGroups = await dependencies.fetchUserGroups(baseUrl, userId, accessToken);
  const payload = dependencies.buildSub2ApiCreatePayload(tokenData, userGroups);

  try {
    const response = await httpPost(url, payload, {
      headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl),
      timeout: 15000,
      validateStatus: (status: number) => status < 500,
    });

    if (dependencies.isBrowserChallengeResponse(response.data)) {
      Logger.warn('🛡️ [TokenService] sub2api 创建令牌遇到挑战页响应，切换到浏览器模式重试...');
      return await dependencies.createSub2ApiApiTokenInBrowser(
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

    const tokens = dependencies.mergeCreatedRawKeyIntoTokens(
      beforeTokens,
      await dependencies.fetchApiTokens(baseUrl, userId, accessToken, context),
      tokenData,
      response.data
    );
    return { success: true, data: tokens };
  } catch (error: any) {
    const html = error?.response?.data;
    if (dependencies.isBrowserChallengeResponse(html) || dependencies.isCloudflareError(error)) {
      Logger.warn('🛡️ [TokenService] sub2api 创建令牌遇到挑战页响应，切换到浏览器模式重试...');
      return await dependencies.createSub2ApiApiTokenInBrowser(
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

export async function createSub2ApiApiTokenInBrowser(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  tokenData: CreateApiTokenPayload,
  payload: Record<string, unknown>,
  context?: TokenRequestContext
): Promise<{ success: boolean; data?: any[] }> {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const url = `${cleanBaseUrl}/api/v1/keys`;
  const { page, release } = await dependencies.chromeManager.createPage(cleanBaseUrl, {
    slot: context?.browserSlot,
  });

  try {
    await page.bringToFront().catch(() => {});
    await dependencies.waitForCloudflareChallengeToPass(page);

    const beforeTokens = await dependencies.fetchApiTokensInBrowser(
      baseUrl,
      userId,
      accessToken,
      page
    );
    const additionalHeaders = dependencies.getSiteTypeProfileByUrl(baseUrl).includeUserIdHeaders
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

    const tokens = dependencies.mergeCreatedRawKeyIntoTokens(
      beforeTokens,
      await dependencies.fetchApiTokens(baseUrl, userId, accessToken, context),
      tokenData,
      result.data
    );
    return { success: true, data: tokens };
  } finally {
    release();
  }
}

export async function createApiToken(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  tokenData: CreateApiTokenPayload,
  context?: TokenRequestContext
): Promise<{ success: boolean; data?: any[] }> {
  if (dependencies.resolveSiteTypeByUrl(baseUrl) === 'sub2api') {
    return await dependencies.createSub2ApiApiToken(
      baseUrl,
      userId,
      accessToken,
      tokenData,
      context
    );
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
    const beforeTokens = await dependencies.fetchApiTokens(baseUrl, userId, accessToken, context);
    const response = await httpPost(url, tokenData, {
      headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl),
      timeout: 15000,
      validateStatus: (status: number) => status < 500,
    });

    const status = response.status;
    const rawData = response.data;

    // 如果返回的是 HTML/挑战页，直接切换到浏览器模式
    if (dependencies.isBrowserChallengeResponse(rawData)) {
      Logger.warn('🛡️ [TokenService] 创建令牌遇到挑战页响应，切换到浏览器模式重试...');
      return await dependencies.createApiTokenInBrowser(
        baseUrl,
        userId,
        accessToken,
        tokenData,
        context
      );
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

    const tokens = dependencies.mergeCreatedRawKeyIntoTokens(
      beforeTokens,
      await dependencies.fetchApiTokens(baseUrl, userId, accessToken, context),
      tokenData,
      rawData
    );
    const verified = dependencies.hasVerifiedCreatedToken(beforeTokens, tokens, tokenData);

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
    if (dependencies.isBrowserChallengeResponse(html) || dependencies.isCloudflareError(error)) {
      Logger.warn('🛡️ [TokenService] axios 创建令牌遇到挑战页响应，切换到浏览器模式重试...');
      return await dependencies.createApiTokenInBrowser(
        baseUrl,
        userId,
        accessToken,
        tokenData,
        context
      );
    }

    Logger.error('❌ [TokenService] 创建 API 令牌失败:', error.message || error);
    throw error;
  }
}

export async function createApiTokenInBrowser(
  dependencies: TokenOperationContext,
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
  const { page, release } = await dependencies.chromeManager.createPage(cleanBaseUrl, {
    slot: context?.browserSlot,
  });

  try {
    // 确保页面前置，方便用户在 Cloudflare 页面中进行验证
    await page.bringToFront().catch(() => {});

    // 等待 Cloudflare 验证通过（如果存在）
    await dependencies.waitForCloudflareChallengeToPass(page);

    const userIdHeaders = getAllUserIdHeaders(userId);
    const beforeTokens = await dependencies.fetchApiTokensInBrowser(
      baseUrl,
      userId,
      accessToken,
      page
    );

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
    const tokens = dependencies.mergeCreatedRawKeyIntoTokens(
      beforeTokens,
      await dependencies.fetchApiTokensInBrowser(baseUrl, userId, accessToken, page),
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
