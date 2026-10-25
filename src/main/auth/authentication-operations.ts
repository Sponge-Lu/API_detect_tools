import {
  normalizeApiKeyValue,
  resolveApiKeyValue,
  asObjectPayload,
  isAuthFailureResponse,
  buildLoginExpiredErrorMessage,
} from './api-key-policy';
import { ChromeManager } from '../chrome-manager';

import type { SiteAccount } from '../types/token';

import Logger from '../utils/logger';
import { runOnPageQueue } from '../utils/page-exec-queue';
import { getSiteTypeProfile } from '../site-type-registry';
import { detectSiteType } from '../site-type-detector';

import type { TokenRequestContext, InitializeSiteAccountOptions } from './token-contracts';

export interface TokenOperationContext {
  chromeManager: ChromeManager;
  fetchApiTokens(
    baseUrl: string,
    userId: number,
    accessToken: string,
    context?: TokenRequestContext
  ): Promise<any[]>;
  waitForCloudflareChallengeToPass(page: any, maxWaitMs?: number): Promise<void>;
  createAccessToken(baseUrl: string, userId: number): Promise<string>;
  requestAccessTokenInPage(page: any, baseUrl: string, userId: number): Promise<string>;
  validateSub2ApiBrowserToken(
    page: any,
    baseUrl: string,
    userId: number,
    accessToken: string
  ): Promise<void>;
  resolveSub2ApiUserId(data: any): string | undefined;
}
export async function requestAccessTokenInPage(
  dependencies: TokenOperationContext,
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

export async function initializeSiteAccount(
  dependencies: TokenOperationContext,
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
    const localData = await dependencies.chromeManager.getLocalStorageData(
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
          ? localData.sessionAccessToken
            ? await dependencies.chromeManager.createAccessTokenForLogin(
                resolvedBaseUrl,
                localData.userId,
                localData.sessionAccessToken
              )
            : await dependencies.chromeManager.createAccessTokenForLogin(
                resolvedBaseUrl,
                localData.userId
              )
          : await dependencies.createAccessToken(resolvedBaseUrl, localData.userId);
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
        apiKeys = await dependencies.fetchApiTokens(
          resolvedBaseUrl,
          localData.userId,
          accessToken,
          {
            siteType,
          }
        );
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

export async function createAccessToken(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number
): Promise<string> {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const url = `${cleanBaseUrl}/api/user/token`;

  Logger.info('🔧 [TokenService] 创建访问令牌...');
  Logger.info('📍 [TokenService] URL:', url);
  Logger.info('🆔 [TokenService] User ID:', userId);

  // 使用浏览器环境调用API（携带Cookie）
  const browser = (dependencies.chromeManager as any).browser;
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
    return await dependencies.requestAccessTokenInPage(page, cleanBaseUrl, userId);
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

export async function recreateAccessTokenFromBrowser(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  context?: Pick<TokenRequestContext, 'browserSlot' | 'challengeWaitMs'>
): Promise<string> {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  Logger.info('🔄 [TokenService] 尝试通过浏览器会话重新创建 access_token...', {
    browserSlot: context?.browserSlot ?? 0,
    userId,
  });

  const { page, release } = await dependencies.chromeManager.createPage(cleanBaseUrl, {
    slot: context?.browserSlot,
  });

  try {
    await dependencies.waitForCloudflareChallengeToPass(page, context?.challengeWaitMs ?? 10000);
    return await dependencies.requestAccessTokenInPage(page, cleanBaseUrl, userId);
  } finally {
    try {
      await page.close();
    } catch {
      // ignore
    }
    release();
  }
}

export async function recreateSub2ApiAccessTokenFromBrowser(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  context?: Pick<TokenRequestContext, 'browserSlot' | 'challengeWaitMs'>
): Promise<string> {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  Logger.info('🔄 [TokenService] 尝试通过浏览器会话重新读取 sub2api JWT...', {
    browserSlot: context?.browserSlot ?? 0,
    userId,
  });

  const { page, release } = await dependencies.chromeManager.createPage(cleanBaseUrl, {
    slot: context?.browserSlot,
  });

  try {
    await dependencies.waitForCloudflareChallengeToPass(page, context?.challengeWaitMs ?? 10000);
    const localData = await dependencies.chromeManager.readAuthDataFromPage(page, cleanBaseUrl, {
      siteType: 'sub2api',
    });
    const accessToken = normalizeApiKeyValue(localData.accessToken);
    if (!accessToken) {
      throw new Error('sub2api 浏览器登录态中未找到 JWT 凭证，请重新登录站点');
    }

    if (localData.userId !== null && String(localData.userId) !== String(userId)) {
      throw new Error(`sub2api 浏览器登录态用户不匹配，期望 ${userId}，实际 ${localData.userId}`);
    }

    await dependencies.validateSub2ApiBrowserToken(page, cleanBaseUrl, userId, accessToken);
    Logger.info('✅ [TokenService] sub2api JWT 已从浏览器登录态重新读取并验证');
    return accessToken;
  } finally {
    try {
      await page.close();
    } catch {
      // ignore
    }
    release();
  }
}

export function resolveSub2ApiUserId(
  dependencies: TokenOperationContext,
  data: any
): string | undefined {
  const raw = data?.id ?? data?.user_id ?? data?.userId ?? data?.uid ?? data?.user_ID;
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  return String(raw);
}

export async function validateSub2ApiBrowserToken(
  dependencies: TokenOperationContext,
  page: any,
  baseUrl: string,
  userId: number,
  accessToken: string
): Promise<void> {
  const apiUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/auth/me`;
  const response = await runOnPageQueue(page, () =>
    page.evaluate(
      async (url: string, token: string) => {
        const result = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-store',
            Pragma: 'no-cache',
          },
        });
        const text = await result.text();
        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
        return {
          ok: result.ok,
          status: result.status,
          data,
          text: text.substring(0, 200),
        };
      },
      apiUrl,
      accessToken
    )
  );

  if (!response.ok || isAuthFailureResponse(response.data, response.status)) {
    throw new Error(
      buildLoginExpiredErrorMessage(
        'sub2api 浏览器登录态',
        response.data || { message: response.text || `HTTP ${response.status}` }
      )
    );
  }

  const payload = asObjectPayload(response.data);
  const payloadData = payload?.data;
  const isSub2ApiSuccess = payload?.code === 0 && payloadData;
  if (!isSub2ApiSuccess) {
    const message =
      typeof payload?.message === 'string' && payload.message
        ? payload.message
        : 'sub2api 浏览器登录态校验失败';
    throw new Error(message);
  }

  const returnedUserId = dependencies.resolveSub2ApiUserId(payloadData);
  if (returnedUserId && returnedUserId !== String(userId)) {
    throw new Error(`sub2api 浏览器登录态用户不匹配，期望 ${userId}，实际 ${returnedUserId}`);
  }
}
