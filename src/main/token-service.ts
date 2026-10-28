import type {
  CreateApiTokenPayload,
  TokenRequestContext,
  InitializeSiteAccountOptions,
  RefreshAccountBasicInfoOptions,
} from './auth/token-contracts';
import * as checkinOperations from './auth/checkin-operations';
import * as authenticationOperations from './auth/authentication-operations';
import * as apiKeysOperations from './auth/api-keys-operations';
import * as detectionOperations from './auth/detection-operations';
import { buildLoginExpiredErrorMessage } from './auth/api-key-policy';
export {
  isMaskedApiKeyValue,
  isAuthFailureText,
  isAuthFailureResponse,
  buildLoginExpiredErrorMessage,
  mergeApiKeysPreservingRawValue,
} from './auth/api-key-policy';
/**
 * 输入: ChromeManager (浏览器自动化), HttpClient (HTTP 请求), UnifiedConfigManager (配置管理)
 * 输出: SiteAccount, CachedDisplayData, RefreshAccountResult, Token 管理结果, 签到结果, CheckinStats, 认证失败判定
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

import { unifiedConfigManager } from './unified-config-manager';
import type {
  SiteAccount,
  RefreshAccountResult,
  AccountBasicInfoRefreshResult,
} from './types/token';
import type { CheckinStats } from '../shared/types/site';
import { getAllUserIdHeaders } from '../shared/utils/headers';
import Logger from './utils/logger';

import { getSiteTypeProfile, resolveSiteType } from './site-type-registry';

import type { SiteType } from '../shared/types/site';

export class TokenService {
  private checkinOperationsContextCache?: checkinOperations.TokenOperationContext;
  private get checkinOperationsContext(): checkinOperations.TokenOperationContext {
    return (this.checkinOperationsContextCache ??= {
      isBrowserChallengeResponse: (...args) => this.isBrowserChallengeResponse(...args),
      getCheckInEndpoints: (...args) => this.getCheckInEndpoints(...args),
      createRequestHeaders: (...args) => this.createRequestHeaders(...args),
      chromeManager: this.chromeManager,
      waitForCloudflareChallengeToPass: (...args) => this.waitForCloudflareChallengeToPass(...args),
      fetchCheckinStats: (...args) => this.fetchCheckinStats(...args),
      checkInWithBrowser: (...args) => this.checkInWithBrowser(...args),
    });
  }
  private authenticationOperationsContextCache?: authenticationOperations.TokenOperationContext;
  private get authenticationOperationsContext(): authenticationOperations.TokenOperationContext {
    return (this.authenticationOperationsContextCache ??= {
      chromeManager: this.chromeManager,
      fetchApiTokens: (...args) => this.fetchApiTokens(...args),
      waitForCloudflareChallengeToPass: (...args) => this.waitForCloudflareChallengeToPass(...args),
      createAccessToken: (...args) => this.createAccessToken(...args),
      requestAccessTokenInPage: (...args) => this.requestAccessTokenInPage(...args),
      validateSub2ApiBrowserToken: this.validateSub2ApiBrowserToken.bind(this),
      resolveSub2ApiUserId: this.resolveSub2ApiUserId.bind(this),
    });
  }
  private apiKeysOperationsContextCache?: apiKeysOperations.TokenOperationContext;
  private get apiKeysOperationsContext(): apiKeysOperations.TokenOperationContext {
    return (this.apiKeysOperationsContextCache ??= {
      fetchUserGroups: (...args) => this.fetchUserGroups(...args),
      resolveSiteTypeByUrl: (...args) => this.resolveSiteTypeByUrl(...args),
      getSiteTypeProfileByUrl: (...args) => this.getSiteTypeProfileByUrl(...args),
      createRequestHeaders: (...args) => this.createRequestHeaders(...args),
      isBrowserChallengeResponse: (...args) => this.isBrowserChallengeResponse(...args),
      buildSub2ApiTokenExpiredError: this.buildSub2ApiTokenExpiredError.bind(this),
      buildAuthFailureError: (...args) => this.buildAuthFailureError(...args),
      isLoginExpiredError: (...args) => this.isLoginExpiredError(...args),
      isCloudflareError: (...args) => this.isCloudflareError(...args),
      isNetworkConnectionError: (...args) => this.isNetworkConnectionError(...args),
      chromeManager: this.chromeManager,
      waitForCloudflareChallengeToPass: (...args) => this.waitForCloudflareChallengeToPass(...args),
      fetchSub2ApiApiKeyUsageStats: this.fetchSub2ApiApiKeyUsageStats.bind(this),
      resolveSub2ApiGroupName: this.resolveSub2ApiGroupName.bind(this),
      normalizeSub2ApiUsdValue: this.normalizeSub2ApiUsdValue.bind(this),
      enrichSub2ApiApiKeys: this.enrichSub2ApiApiKeys.bind(this),
      enrichMaskedApiKeys: (...args) => this.enrichMaskedApiKeys(...args),
      fetchApiTokensInBrowser: (...args) => this.fetchApiTokensInBrowser(...args),
      fetchRawApiKeyValuesBatch: (...args) => this.fetchRawApiKeyValuesBatch(...args),
      resolveUsableApiKeyValue: (...args) => this.resolveUsableApiKeyValue(...args),
      extractBatchRawApiKeyValues: (...args) => this.extractBatchRawApiKeyValues(...args),
      extractRawApiKeyValue: (...args) => this.extractRawApiKeyValue(...args),
      fetchRawApiKeyValue: (...args) => this.fetchRawApiKeyValue(...args),
      shouldFallbackToBrowserForRawApiKey: (...args) =>
        this.shouldFallbackToBrowserForRawApiKey(...args),
      deleteSub2ApiApiTokenInBrowser: this.deleteSub2ApiApiTokenInBrowser.bind(this),
      deleteSub2ApiApiToken: this.deleteSub2ApiApiToken.bind(this),
      deleteApiTokenInBrowser: (...args) => this.deleteApiTokenInBrowser(...args),
      normalizeTokenGroup: (...args) => this.normalizeTokenGroup(...args),
      getTokenIdentity: (...args) => this.getTokenIdentity(...args),
      isCreatedTokenMatch: (...args) => this.isCreatedTokenMatch(...args),
      extractCreatedRawApiKey: (...args) => this.extractCreatedRawApiKey(...args),
      fetchApiTokens: (...args) => this.fetchApiTokens(...args),
      buildSub2ApiCreatePayload: this.buildSub2ApiCreatePayload.bind(this),
      createSub2ApiApiTokenInBrowser: this.createSub2ApiApiTokenInBrowser.bind(this),
      mergeCreatedRawKeyIntoTokens: (...args) => this.mergeCreatedRawKeyIntoTokens(...args),
      createSub2ApiApiToken: this.createSub2ApiApiToken.bind(this),
      createApiTokenInBrowser: (...args) => this.createApiTokenInBrowser(...args),
      hasVerifiedCreatedToken: (...args) => this.hasVerifiedCreatedToken(...args),
    });
  }
  private detectionOperationsContextCache?: detectionOperations.TokenOperationContext;
  private get detectionOperationsContext(): detectionOperations.TokenOperationContext {
    return (this.detectionOperationsContextCache ??= {
      fetchApiTokens: (...args) => this.fetchApiTokens(...args),
      resolveSiteTypeByUrl: (...args) => this.resolveSiteTypeByUrl(...args),
      chromeManager: this.chromeManager,
      initializeSiteAccount: (...args) => this.initializeSiteAccount(...args),
      createRequestHeaders: (...args) => this.createRequestHeaders(...args),
      parseSub2ApiAccountData: this.parseSub2ApiAccountData.bind(this),
      getSiteTypeProfileByUrl: (...args) => this.getSiteTypeProfileByUrl(...args),
      buildAuthFailureError: (...args) => this.buildAuthFailureError(...args),
      parseSub2ApiGroups: this.parseSub2ApiGroups.bind(this),
      isLoginExpiredError: (...args) => this.isLoginExpiredError(...args),
      isCloudflareError: (...args) => this.isCloudflareError(...args),
      isBrowserChallengeResponse: (...args) => this.isBrowserChallengeResponse(...args),
      fetchAccountData: (...args) => this.fetchAccountData(...args),
      fetchUserGroups: (...args) => this.fetchUserGroups(...args),
      fetchModelPricing: (...args) => this.fetchModelPricing(...args),
      fetchUserGroupsInBrowser: (...args) => this.fetchUserGroupsInBrowser(...args),
      fetchModelPricingInBrowser: (...args) => this.fetchModelPricingInBrowser(...args),
    });
  }
  private chromeManager: ChromeManager;

  constructor(chromeManager: ChromeManager) {
    this.chromeManager = chromeManager;
  }

  private async requestAccessTokenInPage(
    page: any,
    baseUrl: string,
    userId: number
  ): Promise<string> {
    return authenticationOperations.requestAccessTokenInPage(
      this.authenticationOperationsContext,
      page,
      baseUrl,
      userId
    );
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
    return authenticationOperations.initializeSiteAccount(
      this.authenticationOperationsContext,
      baseUrl,
      waitForLogin,
      maxWaitTime,
      onStatus,
      options
    );
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
    return authenticationOperations.createAccessToken(
      this.authenticationOperationsContext,
      baseUrl,
      userId
    );
  }

  async recreateAccessTokenFromBrowser(
    baseUrl: string,
    userId: number,
    context?: Pick<TokenRequestContext, 'browserSlot' | 'challengeWaitMs'>
  ): Promise<string> {
    return authenticationOperations.recreateAccessTokenFromBrowser(
      this.authenticationOperationsContext,
      baseUrl,
      userId,
      context
    );
  }

  async recreateSub2ApiAccessTokenFromBrowser(
    baseUrl: string,
    userId: number,
    context?: Pick<TokenRequestContext, 'browserSlot' | 'challengeWaitMs'>
  ): Promise<string> {
    return authenticationOperations.recreateSub2ApiAccessTokenFromBrowser(
      this.authenticationOperationsContext,
      baseUrl,
      userId,
      context
    );
  }

  private resolveSub2ApiUserId(data: any): string | undefined {
    return authenticationOperations.resolveSub2ApiUserId(
      this.authenticationOperationsContext,
      data
    );
  }

  private async validateSub2ApiBrowserToken(
    page: any,
    baseUrl: string,
    userId: number,
    accessToken: string
  ): Promise<void> {
    return authenticationOperations.validateSub2ApiBrowserToken(
      this.authenticationOperationsContext,
      page,
      baseUrl,
      userId,
      accessToken
    );
  }

  /**
   * 刷新显示数据
   * 使用access_token调用API获取最新的余额、使用量等信息
   *
   * @param account 站点账号
   * @returns 刷新结果（包含缓存数据）
   */
  async refreshDisplayData(account: SiteAccount): Promise<RefreshAccountResult> {
    return detectionOperations.refreshDisplayData(this.detectionOperationsContext, account);
  }

  /**
   * 从浏览器登录态刷新账户基础信息
   * 复用智能添加站点的等待登录与 token 创建流程，只返回可写回现有账户的基础字段。
   */
  async refreshAccountBasicInfo(
    account: Pick<SiteAccount, 'site_url' | 'user_id' | 'access_token'> & { site_type?: SiteType },
    onStatus?: (status: string) => void,
    options?: RefreshAccountBasicInfoOptions
  ): Promise<AccountBasicInfoRefreshResult> {
    return detectionOperations.refreshAccountBasicInfo(
      this.detectionOperationsContext,
      account,
      onStatus,
      options
    );
  }

  /**
   * 验证令牌是否有效
   *
   * @param account 站点账号
   * @returns 是否有效
   */
  async validateToken(account: SiteAccount): Promise<boolean> {
    return detectionOperations.validateToken(this.detectionOperationsContext, account);
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
    return checkinOperations.checkSiteSupportsCheckIn(this.checkinOperationsContext, baseUrl, page);
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
    return checkinOperations.fetchCheckInStatus(
      this.checkinOperationsContext,
      baseUrl,
      userId,
      accessToken,
      page,
      explicitSiteType
    );
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
    explicitSiteType?: SiteType,
    browserSlot?: number
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
    return checkinOperations.checkIn(
      this.checkinOperationsContext,
      baseUrl,
      userId,
      accessToken,
      page,
      explicitSiteType,
      browserSlot
    );
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
    explicitSiteType?: SiteType,
    browserSlot?: number
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
    return checkinOperations.checkInWithBrowser(
      this.checkinOperationsContext,
      baseUrl,
      userId,
      accessToken,
      explicitSiteType,
      browserSlot
    );
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
    return checkinOperations.fetchCheckinStats(
      this.checkinOperationsContext,
      baseUrl,
      userId,
      accessToken,
      page
    );
  }

  /**
   * 获取账户数据（余额、今日使用量等）
   */
  private async fetchAccountData(
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
    return detectionOperations.fetchAccountData(
      this.detectionOperationsContext,
      baseUrl,
      userId,
      accessToken,
      explicitSiteType
    );
  }

  private resolveSub2ApiGroupName(
    apiKey: any,
    userGroups?: Record<string, { id?: number | string; desc: string; ratio: number }>
  ): string {
    return apiKeysOperations.resolveSub2ApiGroupName(
      this.apiKeysOperationsContext,
      apiKey,
      userGroups
    );
  }

  private normalizeSub2ApiUsdValue(value: unknown): number | undefined {
    return apiKeysOperations.normalizeSub2ApiUsdValue(this.apiKeysOperationsContext, value);
  }

  private async fetchSub2ApiApiKeyUsageStats(
    baseUrl: string,
    accessToken: string,
    apiKeyIds: Array<number | string>
  ): Promise<Record<string, { today_actual_cost?: number; total_actual_cost?: number }>> {
    return apiKeysOperations.fetchSub2ApiApiKeyUsageStats(
      this.apiKeysOperationsContext,
      baseUrl,
      accessToken,
      apiKeyIds
    );
  }

  private async enrichSub2ApiApiKeys(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokens: any[],
    siteType?: SiteType
  ): Promise<any[]> {
    return apiKeysOperations.enrichSub2ApiApiKeys(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      tokens,
      siteType
    );
  }

  private buildSub2ApiCreatePayload(
    tokenData: CreateApiTokenPayload,
    userGroups: Record<string, { id?: number | string; desc: string; ratio: number }>
  ): Record<string, unknown> {
    return apiKeysOperations.buildSub2ApiCreatePayload(
      this.apiKeysOperationsContext,
      tokenData,
      userGroups
    );
  }

  private buildSub2ApiTokenExpiredError(payload: any): Error {
    return new Error(buildLoginExpiredErrorMessage('sub2api API Key 接口', payload));
  }

  private buildAuthFailureError(payload: any, source: string): Error {
    return new Error(buildLoginExpiredErrorMessage(source, payload));
  }

  private isLoginExpiredError(error: any): boolean {
    return String(error?.message || '').includes('登录已过期或未登录');
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
    return apiKeysOperations.fetchApiTokens(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      context
    );
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
    return apiKeysOperations.fetchApiTokensInBrowser(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      page,
      explicitSiteType
    );
  }

  private async enrichMaskedApiKeys(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokens: any[],
    page?: any,
    context?: TokenRequestContext
  ): Promise<any[]> {
    return apiKeysOperations.enrichMaskedApiKeys(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      tokens,
      page,
      context
    );
  }

  private extractBatchRawApiKeyValues(payload: unknown): Map<string, string> {
    return apiKeysOperations.extractBatchRawApiKeyValues(this.apiKeysOperationsContext, payload);
  }

  private async fetchRawApiKeyValuesBatch(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenIds: string[],
    page?: any,
    explicitSiteType?: SiteType
  ): Promise<Map<string, string>> {
    return apiKeysOperations.fetchRawApiKeyValuesBatch(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      tokenIds,
      page,
      explicitSiteType
    );
  }

  private extractRawApiKeyValue(payload: unknown): string | null {
    return apiKeysOperations.extractRawApiKeyValue(this.apiKeysOperationsContext, payload);
  }

  private async fetchRawApiKeyValue(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenId: string,
    page?: any
  ): Promise<string | null> {
    return apiKeysOperations.fetchRawApiKeyValue(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      tokenId,
      page
    );
  }

  async resolveUsableApiKeyValue(
    baseUrl: string,
    userId: number,
    accessToken: string,
    apiKey: any,
    context?: TokenRequestContext & { page?: any }
  ): Promise<string | null> {
    return apiKeysOperations.resolveUsableApiKeyValue(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      apiKey,
      context
    );
  }

  private shouldFallbackToBrowserForRawApiKey(error: any, context?: TokenRequestContext): boolean {
    return apiKeysOperations.shouldFallbackToBrowserForRawApiKey(
      this.apiKeysOperationsContext,
      error,
      context
    );
  }

  private async deleteSub2ApiApiToken(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenIdentifier: { id?: string; key?: string },
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }> {
    return apiKeysOperations.deleteSub2ApiApiToken(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      tokenIdentifier,
      context
    );
  }

  private async deleteSub2ApiApiTokenInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenIdentifier: { id?: string; key?: string },
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }> {
    return apiKeysOperations.deleteSub2ApiApiTokenInBrowser(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      tokenIdentifier,
      context
    );
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
    return apiKeysOperations.deleteApiToken(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      tokenIdentifier,
      context
    );
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
    return apiKeysOperations.deleteApiTokenInBrowser(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      tokenIdentifier,
      context
    );
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
    return apiKeysOperations.normalizeTokenGroup(this.apiKeysOperationsContext, group);
  }

  private getTokenIdentity(token: any): string | null {
    return apiKeysOperations.getTokenIdentity(this.apiKeysOperationsContext, token);
  }

  private isCreatedTokenMatch(token: any, tokenData: CreateApiTokenPayload): boolean {
    return apiKeysOperations.isCreatedTokenMatch(this.apiKeysOperationsContext, token, tokenData);
  }

  private hasVerifiedCreatedToken(
    beforeTokens: any[],
    afterTokens: any[],
    tokenData: CreateApiTokenPayload
  ): boolean {
    return apiKeysOperations.hasVerifiedCreatedToken(
      this.apiKeysOperationsContext,
      beforeTokens,
      afterTokens,
      tokenData
    );
  }

  private extractCreatedRawApiKey(createResponseData: any): string | null {
    return apiKeysOperations.extractCreatedRawApiKey(
      this.apiKeysOperationsContext,
      createResponseData
    );
  }

  private mergeCreatedRawKeyIntoTokens(
    beforeTokens: any[],
    afterTokens: any[],
    tokenData: CreateApiTokenPayload,
    createResponseData: any
  ): any[] {
    return apiKeysOperations.mergeCreatedRawKeyIntoTokens(
      this.apiKeysOperationsContext,
      beforeTokens,
      afterTokens,
      tokenData,
      createResponseData
    );
  }

  private async createSub2ApiApiToken(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenData: CreateApiTokenPayload,
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }> {
    return apiKeysOperations.createSub2ApiApiToken(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      tokenData,
      context
    );
  }

  private async createSub2ApiApiTokenInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    tokenData: CreateApiTokenPayload,
    payload: Record<string, unknown>,
    context?: TokenRequestContext
  ): Promise<{ success: boolean; data?: any[] }> {
    return apiKeysOperations.createSub2ApiApiTokenInBrowser(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      tokenData,
      payload,
      context
    );
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
    return apiKeysOperations.createApiToken(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      tokenData,
      context
    );
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
    return apiKeysOperations.createApiTokenInBrowser(
      this.apiKeysOperationsContext,
      baseUrl,
      userId,
      accessToken,
      tokenData,
      context
    );
  }

  /**
   * 获取用户分组信息
   */
  async fetchUserGroups(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page?: any,
    explicitSiteType?: SiteType,
    options?: { proxyUrl?: string }
  ): Promise<Record<string, { id?: number | string; desc: string; ratio: number }>> {
    return detectionOperations.fetchUserGroups(
      this.detectionOperationsContext,
      baseUrl,
      userId,
      accessToken,
      page,
      explicitSiteType,
      options
    );
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
    return detectionOperations.fetchUserGroupsInBrowser(
      this.detectionOperationsContext,
      baseUrl,
      userId,
      accessToken,
      page,
      explicitSiteType
    );
  }

  /**
   * 获取模型定价信息
   */
  async fetchModelPricing(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page?: any,
    explicitSiteType?: SiteType,
    options?: { proxyUrl?: string }
  ): Promise<any> {
    return detectionOperations.fetchModelPricing(
      this.detectionOperationsContext,
      baseUrl,
      userId,
      accessToken,
      page,
      explicitSiteType,
      options
    );
  }

  /**
   * 在浏览器环境中获取模型定价
   */
  private async fetchModelPricingInBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page: any,
    explicitSiteType?: SiteType
  ): Promise<any> {
    return detectionOperations.fetchModelPricingInBrowser(
      this.detectionOperationsContext,
      baseUrl,
      userId,
      accessToken,
      page,
      explicitSiteType
    );
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

  private isNetworkConnectionError(error: any): boolean {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toUpperCase();
    const responseMessage = String(error?.response?.data?.message || '').toUpperCase();
    return (
      code === 'EPROTO' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNABORTED' ||
      message.includes('HANDSHAKE_FAILURE') ||
      message.includes('SSLV3_ALERT') ||
      message.includes('TLSV1_ALERT') ||
      message.includes('ETIMEDOUT') ||
      message.includes('ERR_CONNECTION_TIMED_OUT') ||
      (message.includes('TIMEOUT') &&
        (message.includes('EXCEEDED') || message.includes('AFTER'))) ||
      responseMessage.includes('HANDSHAKE_FAILURE') ||
      responseMessage.includes('SSLV3_ALERT') ||
      responseMessage.includes('TLSV1_ALERT')
    );
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
