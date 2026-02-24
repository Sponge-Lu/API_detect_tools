/**
 * 输入: TokenService (获取 Token), HttpClient (HTTP 请求), RequestManager (请求管理), UnifiedConfigManager (配置管理), LDC_PAYMENT_NAMES (支付名称常量)
 * 输出: DetectionResult (含 LDC 支付信息, 签到统计, 检测状态持久化), BalanceInfo, StatusInfo, API 响应数据
 * 定位: 服务层 - 处理所有外部站点的 API 请求，管理请求生命周期和错误处理，检测 LDC 支付支持，获取签到统计，持久化检测状态
 *
 * 并发安全: fetchWithBrowserFallback 在 sharedPage 被并发任务关闭时
 * 自动检测 Target closed 等异常并重试创建新页面
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import type { SiteConfig } from './types/token';
import { httpGet, httpPost } from './utils/http-client';
import { requestManager, RequestManager } from './utils/request-manager';
import { getAllUserIdHeaders } from '../shared/utils/headers';
import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';
import { runOnPageQueue } from './utils/page-exec-queue';
import {
  isModelLog,
  aggregateUsageData as sharedAggregateUsageData,
  type LogItem,
} from '../shared/utils/log-filter';
import type {
  TopupInfoApiResponse,
  AmountApiResponse,
  PayMethod,
  LdcPaymentInfo,
  CheckinStats,
} from '../shared/types/site';
import { LDC_PAYMENT_NAMES } from '../shared/constants';

interface DetectionResult {
  name: string;
  url: string;
  status: string;
  models: string[];
  balance?: number;
  todayUsage?: number; // 今日消费（美元）
  todayPromptTokens?: number; // 今日输入 Token
  todayCompletionTokens?: number; // 今日输出 Token
  todayTotalTokens?: number; // 今日总 Token
  todayRequests?: number; // 今日请求次数
  error?: string;
  has_checkin: boolean; // 是否支持签到功能
  can_check_in?: boolean; // 今日是否可签到（true=可签到, false=已签到）
  // 新增：缓存的扩展数据
  apiKeys?: any[];
  userGroups?: Record<string, { desc: string; ratio: number }>;
  modelPricing?: any;
  lastRefresh?: number; // 最后刷新时间
  // LDC 支付信息
  ldcPaymentSupported?: boolean; // 是否支持 LDC 支付
  ldcExchangeRate?: string; // 兑换比例（LDC:站点余额）
  ldcPaymentType?: string; // 支付方式类型，如 "epay"
  // 签到统计数据 (New API 类型站点)
  checkinStats?: CheckinStats;
}

// 今日使用统计
interface TodayUsageStats {
  todayUsage: number;
  todayPromptTokens: number;
  todayCompletionTokens: number;
  todayTotalTokens: number;
  todayRequests: number;
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

  constructor(tokenService?: any, _tokenStorage?: any) {
    this.tokenService = tokenService;
    // tokenStorage 参数已废弃，使用 unifiedConfigManager 替代
  }

  async detectSite(
    site: SiteConfig,
    timeout: number,
    quickRefresh: boolean = false,
    cachedData?: DetectionResult,
    forceAcceptEmpty: boolean = false
  ): Promise<DetectionResult> {
    let sharedPage: any = null;
    let pageRelease: (() => void) | undefined = undefined;
    let balancePageRelease: (() => void) | undefined = undefined;

    try {
      // 获取模型列表（可能会创建浏览器页面）
      const modelsResult = await this.getModels(site, timeout, forceAcceptEmpty);
      const models = modelsResult.models;
      sharedPage = modelsResult.page;
      pageRelease = modelsResult.pageRelease;

      // 如果创建了浏览器页面，确保Cloudflare验证完成
      if (sharedPage) {
        Logger.info('🛡️ [ApiService] 检测到使用浏览器页面，确保Cloudflare验证完成...');
        await this.waitForCloudflareChallenge(sharedPage, 600000);
      }

      // 获取余额和今日消费，复用浏览器页面
      const balanceData = await this.getBalanceAndUsage(site, timeout, sharedPage);

      // 如果 getBalanceAndUsage 创建了新的浏览器页面，需要在最后释放
      balancePageRelease = balanceData?.pageRelease;

      // 获取扩展数据，复用浏览器页面
      let apiKeys, userGroups, modelPricing;

      if (this.tokenService && site.system_token && site.user_id) {
        try {
          Logger.info('📦 [ApiService] 获取扩展数据...');

          // 并行获取所有扩展数据，传入共享的浏览器页面
          const [apiKeysResult, userGroupsResult, modelPricingResult] = await Promise.allSettled([
            this.tokenService.fetchApiTokens(
              site.url,
              parseInt(site.user_id),
              site.system_token,
              sharedPage
            ),
            this.tokenService.fetchUserGroups(
              site.url,
              parseInt(site.user_id),
              site.system_token,
              sharedPage
            ),
            this.tokenService.fetchModelPricing(
              site.url,
              parseInt(site.user_id),
              site.system_token,
              sharedPage
            ),
          ]);

          if (apiKeysResult.status === 'fulfilled' && apiKeysResult.value) {
            apiKeys = apiKeysResult.value;
            Logger.info(`✅ [ApiService] 获取到 ${apiKeys?.length || 0} 个API Keys`);
          }

          if (userGroupsResult.status === 'fulfilled' && userGroupsResult.value) {
            userGroups = userGroupsResult.value;
            Logger.info(
              `✅ [ApiService] 获取到 ${Object.keys(userGroups || {}).length} 个用户分组`
            );
          }

          if (modelPricingResult.status === 'fulfilled' && modelPricingResult.value) {
            modelPricing = modelPricingResult.value;
            Logger.info(`✅ [ApiService] 获取到模型定价信息`);
          }
        } catch (error: any) {
          Logger.error('⚠️ [ApiService] 获取扩展数据失败:', error.message);
        }
      }

      Logger.info('📤 [ApiService] 准备返回结果:');
      Logger.info('   - name:', site.name);
      Logger.info('   - apiKeys:', apiKeys ? `${apiKeys.length}个` : '无');
      Logger.info('   - userGroups:', userGroups ? `${Object.keys(userGroups).length}个` : '无');
      Logger.info('   - modelPricing:', modelPricing ? '有' : '无');

      // 检测是否支持签到功能（智能两步检测）
      let hasCheckin = false;
      let canCheckIn: boolean | undefined = undefined;

      if (this.tokenService && site.system_token && site.user_id) {
        try {
          Logger.info('🔍 [ApiService] 开始签到功能检测...');

          // 步骤1：检查站点配置（/api/status 的 check_in_enabled）
          let siteConfigSupports = false;

          if (site.force_enable_checkin) {
            // 用户强制启用，跳过所有检查
            Logger.info('⚙️ [ApiService] 用户强制启用签到，跳过站点配置检查');
            siteConfigSupports = true;
          } else {
            // 检查站点配置（传入共享页面以绕过Cloudflare）
            siteConfigSupports = await this.tokenService.checkSiteSupportsCheckIn(
              site.url,
              sharedPage
            );
          }

          // 步骤2：获取签到状态（仅当站点配置支持或用户强制启用时）
          if (siteConfigSupports) {
            // 站点配置支持签到（或用户强制启用），获取签到状态
            const checkInStatus = await this.tokenService.fetchCheckInStatus(
              site.url,
              parseInt(site.user_id),
              site.system_token,
              sharedPage // 传入共享页面以绕过Cloudflare
            );

            // 如果签到状态接口返回了有效数据
            if (checkInStatus !== undefined) {
              hasCheckin = true;
              canCheckIn = checkInStatus;
              Logger.info(`✅ [ApiService] 签到功能检测: 支持=${hasCheckin}, 可签到=${canCheckIn}`);
            } else {
              // 签到状态接口不可用
              Logger.info('⚠️ [ApiService] 站点配置支持签到，但签到状态接口不可用');
            }
          } else {
            // 站点配置不支持签到，且用户未强制启用
            Logger.info('ℹ️ [ApiService] 站点不支持签到功能 (check_in_enabled=false)');
            Logger.info('💡 [ApiService] 如需强制启用，请在站点配置中勾选"强制启用签到"');
          }
        } catch (error: any) {
          Logger.info('⚠️ [ApiService] 签到功能检测失败:', error.message);
        }
      }

      // 获取签到统计数据（仅 New API 且已签到的站点）
      let checkinStats: CheckinStats | undefined = undefined;

      if (
        this.tokenService &&
        site.system_token &&
        site.user_id &&
        hasCheckin &&
        canCheckIn === false
      ) {
        try {
          Logger.info('📊 [ApiService] 获取签到统计数据...');
          checkinStats = await this.tokenService.fetchCheckinStats(
            site.url,
            parseInt(site.user_id),
            site.system_token,
            sharedPage
          );
          if (checkinStats) {
            Logger.info(
              `✅ [ApiService] 签到统计获取成功: 今日=${checkinStats.todayQuota}, 本月=${checkinStats.checkinCount}次`
            );
          }
        } catch (error: any) {
          Logger.info('⚠️ [ApiService] 获取签到统计失败:', error.message);
        }
      }

      // 检测是否支持 LDC 支付
      let ldcPaymentSupported = false;
      let ldcExchangeRate: string | undefined = undefined;
      let ldcPaymentType: string | undefined = undefined;

      try {
        Logger.info('💰 [ApiService] 开始 LDC 支付检测...');
        const ldcPaymentInfo = await this.detectLdcPayment(site, timeout, sharedPage);
        ldcPaymentSupported = ldcPaymentInfo.ldcPaymentSupported;
        ldcExchangeRate = ldcPaymentInfo.ldcExchangeRate;
        ldcPaymentType = ldcPaymentInfo.ldcPaymentType;
        Logger.info(
          `✅ [ApiService] LDC 支付检测完成: 支持=${ldcPaymentSupported}, 比例=${ldcExchangeRate || '未知'}, 类型=${ldcPaymentType || '未知'}`
        );
      } catch (error: any) {
        Logger.info('⚠️ [ApiService] LDC 支付检测失败:', error.message);
        // 检测失败不影响整体检测流程
      }

      const result = {
        name: site.name,
        url: site.url,
        status: '成功',
        models,
        balance: balanceData?.balance,
        todayUsage: balanceData?.todayUsage,
        todayPromptTokens: balanceData?.todayPromptTokens,
        todayCompletionTokens: balanceData?.todayCompletionTokens,
        todayTotalTokens: balanceData?.todayTotalTokens,
        todayRequests: balanceData?.todayRequests,
        error: undefined,
        has_checkin: hasCheckin,
        can_check_in: canCheckIn, // 添加签到状态
        apiKeys,
        userGroups,
        modelPricing,
        lastRefresh: Date.now(), // 添加最后刷新时间
        ldcPaymentSupported, // LDC 支付支持状态
        ldcExchangeRate, // LDC 兑换比例
        ldcPaymentType, // LDC 支付方式类型
        checkinStats, // 签到统计数据 (New API)
      };

      // 保存缓存数据到统一配置（成功时）
      if (site.system_token && site.user_id) {
        try {
          await this.saveCachedDisplayData(site.url, result);
        } catch (error: any) {
          Logger.error('⚠️ [ApiService] 保存缓存数据失败:', error.message);
        }
      }

      return result;
    } catch (error: any) {
      const failedResult: DetectionResult = {
        name: site.name,
        url: site.url,
        status: '失败',
        models: [],
        balance: undefined,
        todayUsage: undefined,
        error: error.message,
        has_checkin: false,
      };

      // 失败时也记录检测状态与错误信息，但不覆盖已有的缓存展示数据
      if (site.system_token && site.user_id) {
        try {
          await this.saveLastDetectionStatus(site.url, failedResult.status, failedResult.error);
        } catch (e: any) {
          Logger.error('⚠️ [ApiService] 保存失败检测状态失败:', e.message);
        }
      }

      return failedResult;
    } finally {
      // 释放浏览器引用（如果创建了页面）
      if (pageRelease) {
        try {
          Logger.info('🔒 [ApiService] 释放浏览器引用 (getModels)');
          pageRelease?.();
        } catch (error: any) {
          Logger.error('⚠️ [ApiService] 释放浏览器引用失败:', error.message);
        }
      }

      // 释放 getBalanceAndUsage 可能创建的浏览器引用
      if (balancePageRelease) {
        try {
          Logger.info('🔒 [ApiService] 释放浏览器引用 (getBalanceAndUsage)');
          balancePageRelease();
        } catch (error: any) {
          Logger.error('⚠️ [ApiService] 释放浏览器引用失败:', error.message);
        }
      }

      // ❗ 不再在这里主动关闭共享页面，交由 ChromeManager 统一管理生命周期
      // 原因：并发检测时多个站点可能复用同一个 Page，过早关闭会影响其他正在进行的检测任务
      // 如果需要彻底关闭浏览器，将由 ChromeManager 的引用计数与 cleanup 定时器负责清理
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
      // ��������������ͻ�����������������ĳ�����룬Ĭ��3��
      const maxConcurrent = Math.max(1, config.settings.max_concurrent || 3);
      let cursor = 0;

      const worker = async () => {
        while (true) {
          const index = cursor++;
          if (index >= enabledSites.length) break;
          const site = enabledSites[index];
          const cachedData = cachedMap.get(site.name);
          results[index] = await this.detectSite(
            site,
            config.settings.timeout,
            quickRefresh,
            cachedData
          );
        }
      };

      const workerCount = Math.min(maxConcurrent, enabledSites.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      return results;
    }

    // 顺序执行
    for (const site of enabledSites) {
      const cachedData = cachedMap.get(site.name);
      const result = await this.detectSite(site, config.settings.timeout, quickRefresh, cachedData);
      results.push(result);
    }
    return results;
  }

  /**
   * 轻量级余额刷新（签到后使用）
   * 只获取余额和签到统计，不获取模型列表、API Keys 等
   *
   * @param site 站点配置
   * @param timeout 超时时间
   * @param checkinStats 签到统计数据（签到成功后传入）
   * @param browserPage 可选的浏览器页面（用于绕过Cloudflare）
   * @returns 更新后的余额和签到状态
   */
  async refreshBalanceOnly(
    site: SiteConfig,
    timeout: number,
    checkinStats?: CheckinStats,
    browserPage?: any
  ): Promise<{
    success: boolean;
    balance?: number;
    canCheckIn?: boolean;
    checkinStats?: CheckinStats;
    error?: string;
  }> {
    Logger.info('💰 [ApiService] 轻量级余额刷新...');
    Logger.info('📍 [ApiService] 站点:', site.name);
    if (browserPage) {
      Logger.info('♻️ [ApiService] 使用浏览器页面刷新余额');
    }

    const authToken = site.system_token || site.api_key;

    if (!authToken || !site.user_id) {
      Logger.warn('⚠️ [ApiService] 缺少认证信息');
      return { success: false, error: '缺少认证信息' };
    }

    try {
      // 只获取余额（传入浏览器页面以绕过Cloudflare）
      const balanceResult = await this.fetchBalance(site, timeout, authToken, browserPage);
      const balance = balanceResult?.balance;

      Logger.info(`✅ [ApiService] 余额刷新成功: ${balance}`);

      // 更新缓存数据
      try {
        const existingSite = unifiedConfigManager.getSiteByUrl(site.url);
        if (existingSite) {
          const existingCachedData =
            existingSite.cached_data || ({} as NonNullable<typeof existingSite.cached_data>);

          // 构建更新的缓存数据
          const updatedCachedData = {
            ...existingCachedData,
            balance: balance,
            can_check_in: false, // 签到成功后设为已签到
            last_refresh: Date.now(),
            // 更新签到统计数据
            checkin_stats: checkinStats
              ? {
                  today_quota: checkinStats.todayQuota,
                  checkin_count: checkinStats.checkinCount,
                  total_checkins: checkinStats.totalCheckins,
                  site_type: checkinStats.siteType,
                }
              : existingCachedData.checkin_stats,
          };

          await unifiedConfigManager.updateSite(existingSite.id, {
            cached_data: updatedCachedData,
          });

          Logger.info('✅ [ApiService] 缓存数据已更新');
        }
      } catch (cacheError: any) {
        Logger.warn('⚠️ [ApiService] 更新缓存数据失败:', cacheError.message);
      }

      return {
        success: true,
        balance,
        canCheckIn: false, // 签到成功后设为已签到
        checkinStats,
      };
    } catch (error: any) {
      Logger.error('❌ [ApiService] 余额刷新失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 智能等待Cloudflare验证完成
   * @param page Puppeteer页面对象
   * @param maxWaitTime 最大等待时间（毫秒），默认10分钟
   */
  private async waitForCloudflareChallenge(page: any, maxWaitTime: number = 600000): Promise<void> {
    Logger.info('🛡️ [ApiService] 开始Cloudflare验证检测（最长等待10分钟）...');

    const startTime = Date.now();
    let lastLogTime = startTime;

    try {
      // 1. 等待body元素加载
      await page.waitForSelector('body', { timeout: 30000 });
      Logger.info('✅ [ApiService] 页面body已加载');

      // 2. 循环检测验证状态
      while (Date.now() - startTime < maxWaitTime) {
        try {
          // 检查页面是否已关闭（浏览器关闭会导致页面关闭）
          if (page.isClosed()) {
            throw new Error('浏览器已关闭，操作已取消');
          }

          // 2.1 检测是否仍在验证中
          const verificationStatus = await runOnPageQueue(page, () =>
            page.evaluate(() => {
              const doc = (globalThis as any).document;

              // 检测Cloudflare验证相关元素
              const cfChallenge = doc.querySelector('[class*="cf-challenge"]');
              const cfVerifying = doc.querySelector('[class*="cf-browser-verification"]');
              const cfLoading = doc.querySelector('[id*="challenge-stage"]');
              const cfSpinner = doc.querySelector('[class*="cf-spinner"]');

              // 检测标题
              const titleCheck =
                doc.title.includes('Just a moment') ||
                doc.title.includes('Checking your browser') ||
                doc.title.includes('Please wait');

              // 检测body class
              const bodyCheck =
                doc.body.className.includes('no-js') || doc.body.className.includes('cf-challenge');

              // 检测iframe（某些站点使用iframe进行验证）
              const iframeCheck = doc.querySelector('iframe[src*="challenges.cloudflare.com"]');

              const isVerifying = !!(
                cfChallenge ||
                cfVerifying ||
                cfLoading ||
                cfSpinner ||
                titleCheck ||
                bodyCheck ||
                iframeCheck
              );

              return {
                isVerifying,
                title: doc.title,
                bodyClass: doc.body.className,
              };
            })
          );

          // 每30秒输出一次日志
          const elapsed = Date.now() - startTime;
          if (elapsed - (lastLogTime - startTime) >= 30000) {
            Logger.info(
              `⏳ [ApiService] Cloudflare验证中... (${Math.floor(elapsed / 1000)}s / ${Math.floor(maxWaitTime / 1000)}s)`
            );
            lastLogTime = Date.now();
          }

          if (!verificationStatus.isVerifying) {
            Logger.info('✅ [ApiService] Cloudflare验证已完成');
            Logger.info(`   - 页面标题: ${verificationStatus.title}`);

            // 验证完成后额外等待2秒确保页面稳定
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 等待网络空闲（最多3秒）
            try {
              await page.waitForNetworkIdle({ timeout: 3000 });
              Logger.info('✅ [ApiService] 网络已空闲');
            } catch (e) {
              Logger.info('⚠️ [ApiService] 网络未完全空闲，继续执行');
            }

            return;
          }

          // 仍在验证中，等待2秒后重新检测
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error: any) {
          // 如果是浏览器关闭错误，直接抛出
          if (error.message.includes('浏览器已关闭') || error.message.includes('操作已取消')) {
            Logger.info('⚠️ [ApiService] 检测到浏览器已关闭，停止Cloudflare验证等待');
            throw error;
          }

          // 检查页面是否已关闭
          if (page.isClosed()) {
            throw new Error('浏览器已关闭，操作已取消');
          }

          Logger.error('❌ [ApiService] 验证检测错误:', error.message);
          // 检测错误，等待3秒后继续
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      // 超时处理
      if (Date.now() - startTime >= maxWaitTime) {
        Logger.info('⚠️ [ApiService] Cloudflare验证超时（10分钟），继续执行');
      }
    } catch (error: any) {
      Logger.error('❌ [ApiService] Cloudflare等待失败:', error.message);
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
   * 检测响应数据是否为 Bot Detection 页面（返回200但内容是HTML）
   */
  private isBotDetectionPage(data: any): boolean {
    if (typeof data === 'string') {
      const lowerData = data.toLowerCase();
      // 检测常见的 Bot Detection 特征
      return (
        lowerData.includes('<!doctype html') ||
        lowerData.includes('<html') ||
        lowerData.includes('bot detection') ||
        lowerData.includes('bunkerweb') ||
        lowerData.includes('please wait while we check') ||
        lowerData.includes('checking your browser') ||
        lowerData.includes('just a moment')
      );
    }
    return false;
  }

  /**
   * 判断HTTP状态码是否为致命错误
   * 对于这些错误码，继续重试其它端点通常没有意义，可以直接结束当前站点检测
   *
   * 说明：
   * - 401/403/5xx 基本可以确认是权限/服务异常，继续尝试其它端点成功概率极低
   * - 404 在部分站点可能表示"当前端点不存在，但其它备用端点可用"，为兼容性考虑不视为致命
   */
  private isFatalHttpStatus(status?: number): boolean {
    if (!status) return false;
    const fatalStatuses = [400, 401, 403, 500, 502, 503, 504, 522];
    return fatalStatuses.includes(status);
  }

  /**
   * 判断是否为认证/授权错误（401/403）
   */
  private isAuthError(error: any): boolean {
    const status = error?.response?.status;
    return status === 401 || status === 403;
  }

  /**
   * 判断是否为证书错误（如证书过期/不受信任）
   */
  private isCertError(error: any): boolean {
    const code = error?.code;
    const msg = (error?.message || '').toLowerCase();
    return (
      code === 'CERT_HAS_EXPIRED' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      msg.includes('certificate has expired') ||
      msg.includes('certificate expired') ||
      msg.includes('unable to verify the first certificate')
    );
  }

  /**
   * 为认证错误添加友好提示
   *
   * 错误码语义：
   * - 401 Unauthorized: 未认证或认证失效（登录过期、access_token 失效）
   * - 403 Forbidden: 已认证但权限不足（账号被禁用、无权访问该资源）
   */
  private formatAuthError(error: any, originalMessage: string): string {
    const status = error?.response?.status;
    if (status === 401) {
      // 401 通常表示认证失效，可能是登录过期或 access_token 失效
      // 引导用户重新登录站点，这会同时更新 Cookie 和 access_token
      return `${originalMessage} (登录已过期或未登录，请点击"重新获取"登录站点)`;
    } else if (status === 403) {
      // 403 表示权限不足，可能是账号状态异常
      return `${originalMessage} (权限不足，请检查账号状态是否正常)`;
    }
    return originalMessage;
  }

  /**
   * 判断是否为超时错误
   */
  private isTimeoutError(error: any): boolean {
    if (!error) return false;
    if (error.code === 'ECONNABORTED') return true;
    const msg = String(error.message || '').toLowerCase();
    return msg.includes('timeout') && msg.includes('exceeded');
  }

  /**
   * 仅保存最近一次检测状态和错误信息（不更新展示数据）
   */
  private async saveLastDetectionStatus(
    siteUrl: string,
    status: string,
    error?: string
  ): Promise<void> {
    try {
      const site = unifiedConfigManager.getSiteByUrl(siteUrl);
      if (!site) return;

      // 获取现有的缓存数据，保留其他字段
      const existingCachedData = site.cached_data || ({} as NonNullable<typeof site.cached_data>);

      await unifiedConfigManager.updateSite(site.id, {
        cached_data: {
          ...existingCachedData,
          status,
          error,
          last_refresh: Date.now(),
        },
      });
      Logger.info('✅ [ApiService] 最近一次检测状态已保存:', { siteUrl, status });
    } catch (e: any) {
      Logger.error('❌ [ApiService] 保存最近检测状态失败:', e.message);
    }
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
    sharedPage?: any,
    cacheOptions?: { ttl?: number; skipCache?: boolean },
    requestOptions?: { method?: 'GET' | 'POST'; data?: any }
  ): Promise<{ result: T; page?: any; pageRelease?: () => void }> {
    Logger.info('📡 [ApiService] 发起请求:', url);

    // 生成缓存 key（基于 URL 和用户 ID）
    const cacheKey = RequestManager.key(url, site.user_id || 'anonymous');

    const method = requestOptions?.method ?? 'GET';

    const fetchInBrowser = async (): Promise<{
      result: T;
      page?: any;
      pageRelease?: () => void;
    }> => {
      // 如果有共享页面，优先复用；否则创建新页面
      let page = sharedPage;
      let pageRelease: (() => void) | null = null;
      let shouldClosePage = false;

      const isClosed =
        page && typeof page.isClosed === 'function' ? Boolean(page.isClosed()) : false;
      if (isClosed) page = null;

      if (!page) {
        if (!this.tokenService) {
          throw new Error('TokenService 未初始化，无法创建浏览器页面');
        }

        const chromeManager = (this.tokenService as any).chromeManager;
        if (!chromeManager) {
          throw new Error('ChromeManager不可用');
        }

        Logger.info('🌐 [ApiService] 创建新浏览器页面...');
        const pageResult = await chromeManager.createPage(site.url);
        page = pageResult.page;
        pageRelease = pageResult.release;
        shouldClosePage = false; // 不在这里关闭，由调用者决定

        await this.waitForCloudflareChallenge(page, 600000); // 10分钟
      } else {
        Logger.info('♻️ [ApiService] 复用共享浏览器页面');
      }

      try {
        Logger.info('📡 [ApiService] 在浏览器中调用API...');
        const userIdHeaders = site.user_id ? getAllUserIdHeaders(site.user_id) : {};

        const result = await runOnPageQueue(page, () =>
          page.evaluate(
            async (
              apiUrl: string,
              requestHeaders: Record<string, string>,
              additionalHeaders: Record<string, string>,
              httpMethod: 'GET' | 'POST',
              body: any
            ) => {
              // 构建完整的请求头（包含 User-ID 头和 Authorization）
              const fullHeaders: Record<string, string> = {
                ...requestHeaders,
                ...additionalHeaders,
              };

              const init: RequestInit = {
                method: httpMethod,
                credentials: 'include',
                headers: fullHeaders,
              };

              if (httpMethod === 'POST') {
                init.body = JSON.stringify(body ?? {});
              }

              const response = await fetch(apiUrl, init);

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }

              return await response.json();
            },
            url,
            headers,
            userIdHeaders,
            method,
            requestOptions?.data ?? null
          )
        );

        Logger.info('✅ [ApiService] 浏览器模式请求成功');
        return {
          result: parseResponse(result),
          page: shouldClosePage ? undefined : page,
          pageRelease: pageRelease || undefined,
        };
      } catch (evalError) {
        pageRelease?.();
        if (shouldClosePage && page) await page.close();
        throw evalError;
      }
    };

    // 如果本次站点刷新一开始就已进入浏览器模式（已有 sharedPage），后续端点直接走浏览器模式，
    // 避免每个端点都先 axios 再 browser 的额外延迟与噪音日志。
    if (sharedPage) {
      try {
        return await fetchInBrowser();
      } catch (error: any) {
        const msg = String(error?.message || '');
        const isPageClosed =
          msg.includes('Target closed') ||
          msg.includes('Session closed') ||
          msg.includes('Execution context was destroyed') ||
          msg.includes('Cannot find context');
        if (isPageClosed) {
          Logger.warn('⚠️ [ApiService] 共享页面已失效，置空后重试');
          sharedPage = undefined;
          return await fetchInBrowser();
        }
        throw error;
      }
    }

    try {
      const response =
        method === 'GET'
          ? // 使用 requestManager 包装请求，实现去重和缓存
            // httpGet 在打包环境自动使用 Electron net 模块（Chromium 网络栈）
            await requestManager.request(
              cacheKey,
              () => httpGet(url, { timeout: timeout * 1000, headers }),
              { ttl: cacheOptions?.ttl ?? 30000, skipCache: cacheOptions?.skipCache }
            )
          : // POST 一般不做缓存与去重，避免副作用；若遇到站点风控/需要 Cookie，再走浏览器回退
            await httpPost(url, requestOptions?.data ?? {}, { timeout: timeout * 1000, headers });

      // httpPost 在打包环境会返回状态码而不是抛异常；这里将常见鉴权/风控错误统一转成异常，
      // 以便触发浏览器回退（携带 Cookie / 站点会话）。
      if (method === 'POST' && (response.status === 401 || response.status === 403)) {
        throw {
          message: `HTTP ${response.status}`,
          response: { status: response.status, data: response.data },
        };
      }

      // 检测是否返回了 Bot Detection 页面（200 状态码但内容是 HTML）
      if (this.isBotDetectionPage(response.data)) {
        Logger.info('🛡️ [ApiService] 检测到 Bot Detection 页面，需要浏览器验证...');
        throw {
          isBotDetection: true,
          message: 'Bot Detection page detected',
          response: { status: 200, data: response.data },
        };
      }

      Logger.info('✅ [ApiService] axios请求成功');
      return { result: parseResponse(response.data), page: sharedPage };
    } catch (error: any) {
      Logger.error('❌ [ApiService] axios请求失败:', {
        message: error.message,
        status: error.response?.status,
      });

      // 第二步：检测是否为Cloudflare保护或Bot Detection
      const status = error.response?.status;
      const needBrowserFallback =
        this.isCloudflareProtection(error) ||
        error.isBotDetection === true ||
        (method === 'POST' && (status === 401 || status === 403));
      if (needBrowserFallback) {
        Logger.info('🛡️ [ApiService] 检测到Bot/Cloudflare保护，切换到浏览器模式...');

        // 已经判定需要浏览器模式：直接使用浏览器请求（优先复用 sharedPage）。
        // 注：后续旧的 fallback 分支保留作为兜底，但正常情况下不会执行到。
        try {
          return await fetchInBrowser();
        } catch (browserError: any) {
          Logger.error('❌ [ApiService] 浏览器模式也失败:', browserError.message);
          throw browserError;
        }

        // 确保有必要的认证信息
        if (!this.tokenService || !site.system_token || !site.user_id) {
          Logger.error('❌ [ApiService] 缺少必要的认证信息，无法使用浏览器模式');
          throw error;
        }

        const chromeManager = (this.tokenService as any).chromeManager;
        if (!chromeManager) {
          Logger.error('❌ [ApiService] ChromeManager不可用');
          throw error;
        }

        try {
          // 如果有共享页面，直接使用；否则创建新页面
          let page = sharedPage;
          let pageRelease: (() => void) | null = null;
          let shouldClosePage = false;

          if (!page) {
            Logger.info('🌐 [ApiService] 创建新浏览器页面...');
            const pageResult = await chromeManager.createPage(site.url);
            page = pageResult.page;
            pageRelease = pageResult.release;
            shouldClosePage = false; // 不在这里关闭，由调用者决定

            // 调用智能Cloudflare验证等待
            await this.waitForCloudflareChallenge(page, 600000); // 10分钟 = 600秒
          } else {
            Logger.info('♻️ [ApiService] 复用共享浏览器页面');
          }

          try {
            Logger.info('📡 [ApiService] 在浏览器中调用API...');
            // 在浏览器环境中调用API
            const userIdHeaders = getAllUserIdHeaders(site.user_id!);
            const result = await runOnPageQueue(page, () =>
              page.evaluate(
                async (
                  apiUrl: string,
                  requestHeaders: Record<string, string>,
                  additionalHeaders: Record<string, string>
                ) => {
                  // 构建完整的请求头（包含所有User-ID头和Authorization）
                  const fullHeaders: Record<string, string> = {
                    ...requestHeaders,
                    ...additionalHeaders,
                  };

                  const response = await fetch(apiUrl, {
                    method: 'GET',
                    credentials: 'include',
                    headers: fullHeaders,
                  });

                  if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                  }

                  return await response.json();
                },
                url,
                headers,
                userIdHeaders
              )
            );

            Logger.info('✅ [ApiService] 浏览器模式请求成功');
            // 返回页面和释放函数（如果创建了新页面）
            return {
              result: parseResponse(result),
              page: shouldClosePage ? undefined : page,
              pageRelease: pageRelease || undefined,
            };
          } catch (evalError) {
            // 如果是我们创建的页面且执行失败，释放引用并关闭页面
            pageRelease?.();
            if (shouldClosePage && page) {
              await page.close();
            }
            throw evalError;
          }
        } catch (browserError: any) {
          Logger.error('❌ [ApiService] 浏览器模式也失败:', browserError.message);
          throw browserError;
        }
      }

      // 如果不是Cloudflare保护，直接抛出原错误
      throw error;
    }
  }

  private async getModels(
    site: SiteConfig,
    timeout: number,
    forceAcceptEmpty: boolean = false
  ): Promise<{ models: string[]; page?: any; pageRelease?: () => void }> {
    const hasApiKey = !!site.api_key;
    const authToken = site.api_key || site.system_token;

    if (!authToken) {
      Logger.error('❌ [ApiService] 没有可用的认证令牌');
      throw new Error('缺少认证令牌');
    }

    // 使用api_key时用OpenAI兼容接口，使用system_token时尝试多个用户模型接口
    const endpoints = hasApiKey
      ? ['/v1/models']
      : [
          '/api/user/models', // New API, One API
          '/api/user/available_models', // One API
          '/api/available_model', // Done Hub (返回对象格式)
        ];

    const headers: any = {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    };

    // 如果使用system_token，需要添加所有User-ID headers（兼容各种站点）
    if (!hasApiKey && site.user_id) {
      const userIdHeaders = getAllUserIdHeaders(site.user_id);
      Object.assign(headers, userIdHeaders);
    }

    // 尝试所有端点
    let lastError: any = null;
    let sharedPage: any = null;
    let sharedPageRelease: (() => void) | undefined = undefined;
    let hasEmptyResponse = false; // 跟踪是否有端点返回空数组（session可能过期）

    for (const endpoint of endpoints) {
      const url = `${site.url.replace(/\/$/, '')}${endpoint}`;

      try {
        Logger.info('📡 [ApiService] 尝试获取模型列表:', {
          url,
          authMethod: hasApiKey ? 'api_key' : 'system_token (access_token)',
          endpoint,
        });

        const result = await this.fetchWithBrowserFallback(
          url,
          headers,
          site,
          timeout,
          (data: any) => {
            // 打印完整响应结构用于调试
            Logger.info('📦 [ApiService] 模型列表响应结构:', {
              hasSuccess: 'success' in data,
              hasData: 'data' in data,
              isDataArray: Array.isArray(data?.data),
              dataType: typeof data?.data,
              topLevelKeys: Object.keys(data || {}),
              dataKeys: data?.data ? Object.keys(data.data) : [],
            });

            // 某些站点可能返回 { success: true, message: "..." } 没有data字段
            // 这不一定是认证问题，可能只是该端点不适用于此站点类型
            // 返回空数组，继续尝试其他端点
            if (!data || !('data' in data)) {
              Logger.info('ℹ️ [ApiService] 响应中没有data字段，尝试下一个端点');
              return [];
            }

            // 格式1: Done Hub嵌套data { success: true, data: { data: [...], total_count } }
            if (data?.data?.data && Array.isArray(data.data.data)) {
              const models = data.data.data.map((m: any) => m.id || m.name || m);
              Logger.info(
                `✅ [ApiService] 成功获取 ${models.length} 个模型 (data.data.data格式) ✅`
              );
              return models;
            }

            // 格式2: { success: true, data: [...] } 或 { data: [...] }
            if (data?.data && Array.isArray(data.data)) {
              const models = data.data.map((m: any) => m.id || m.name || m);
              Logger.info(`✅ [ApiService] 成功获取 ${models.length} 个模型 (data数组格式)`);
              return models;
            }

            // 格式3: { success: true, data: { models: [...] } }
            if (data?.data?.models && Array.isArray(data.data.models)) {
              const models = data.data.models.map((m: any) => m.id || m.name || m);
              Logger.info(`✅ [ApiService] 成功获取 ${models.length} 个模型 (data.models格式)`);
              return models;
            }

            // 格式4: 直接数组 [...]
            if (Array.isArray(data)) {
              const models = data.map((m: any) => m.id || m.name || m);
              Logger.info(`✅ [ApiService] 成功获取 ${models.length} 个模型 (直接数组格式)`);
              return models;
            }

            // 格式5: { models: [...] } 直接字段
            if (data?.models && Array.isArray(data.models)) {
              const models = data.models.map((m: any) => m.id || m.name || m);
              Logger.info(`✅ [ApiService] 成功获取 ${models.length} 个模型 (models字段)`);
              return models;
            }

            // 格式6: Done Hub /api/available_model 对象格式
            // { success: true, data: { "ModelName1": {...}, "ModelName2": {...} } }
            if (
              data?.success &&
              data?.data &&
              typeof data.data === 'object' &&
              !Array.isArray(data.data)
            ) {
              // 检查是否为 Done Hub 格式（对象的值包含 price 或 groups 字段）
              const values = Object.values(data.data);
              if (values.length > 0) {
                const firstValue = values[0] as any;
                if (firstValue && (firstValue.price || firstValue.groups)) {
                  // 模型名称就是对象的 keys
                  const models = Object.keys(data.data);
                  Logger.info(
                    `✅ [ApiService] 成功获取 ${models.length} 个模型 (Done Hub对象格式)`
                  );
                  return models;
                }
              }
            }

            Logger.warn('⚠️ [ApiService] 未识别的响应格式，返回空数组');
            Logger.info('   完整响应:', JSON.stringify(data).substring(0, 200));
            return [];
          }
        );

        // 如果成功获取到模型，返回结果
        if (result.result && result.result.length > 0) {
          return {
            models: result.result,
            page: result.page,
            pageRelease: result.pageRelease,
          };
        }

        // 如果返回空数组，标记并继续尝试下一个端点（不存在站点没有模型的情况，空数组可能是session过期）
        hasEmptyResponse = true;
        Logger.info(`ℹ️ [ApiService] 端点 ${endpoint} 返回空模型列表，尝试下一个端点...`);

        // 保存 page 和 pageRelease 以便后续复用
        // 注意：只在有新的 pageRelease 时覆盖，避免丢失首次创建页面时的释放函数，防止引用计数泄漏
        if (result.page) {
          sharedPage = result.page;
        }
        if (result.pageRelease) {
          sharedPageRelease = result.pageRelease;
        }
      } catch (error: any) {
        Logger.warn(`⚠️ [ApiService] 端点 ${endpoint} 失败:`, error.message);
        lastError = error;
        // 继续尝试下一个端点，不提前终止
        continue;
      }
    }

    // 所有端点都尝试完毕，综合判断结果
    // 优先处理空响应（不存在站点没有模型的情况，空数组意味着session过期）
    // 但如果 forceAcceptEmpty 为 true，则接受空数据（用户确认站点确实没有模型）
    if (hasEmptyResponse && !forceAcceptEmpty) {
      Logger.error('❌ [ApiService] 模型接口返回空数组，可能是session过期');
      // 该分支会直接 throw，detectSite 无法拿到 pageRelease；需要在这里释放浏览器引用，避免批量检测泄漏
      if (sharedPageRelease) {
        try {
          if (
            sharedPage &&
            typeof sharedPage.isClosed === 'function' &&
            typeof sharedPage.close === 'function' &&
            !sharedPage.isClosed()
          ) {
            await sharedPage.close();
          }
        } catch {
          // ignore
        }

        try {
          sharedPageRelease();
        } catch (e: any) {
          Logger.warn('[ApiService] getModels empty-response release failed:', e?.message);
        }
      }

      throw new Error('模型接口返回空数据 (登录可能已过期，请点击"重新获取"登录站点)');
    }

    // 强制接受空数据模式：返回空数组作为成功结果
    if (hasEmptyResponse && forceAcceptEmpty) {
      Logger.info('ℹ️ [ApiService] 强制接受空数据模式：模型列表为空');
      return { models: [], page: sharedPage, pageRelease: sharedPageRelease };
    }

    // 所有端点都抛出错误
    if (lastError) {
      Logger.error('❌ [ApiService] 所有模型接口都失败');
      let baseMessage = `模型接口请求失败: ${lastError.message || lastError}`;
      if (this.isCertError(lastError)) {
        baseMessage += ' (证书错误，站点 HTTPS 证书可能已过期或不受信任)';
      } else {
        baseMessage = this.formatAuthError(lastError, baseMessage);
      }
      // 该分支会直接 throw，detectSite 无法拿到 pageRelease；需要在这里释放浏览器引用，避免批量检测泄漏
      if (sharedPageRelease) {
        try {
          if (
            sharedPage &&
            typeof sharedPage.isClosed === 'function' &&
            typeof sharedPage.close === 'function' &&
            !sharedPage.isClosed()
          ) {
            await sharedPage.close();
          }
        } catch {
          // ignore
        }

        try {
          sharedPageRelease();
        } catch (e: any) {
          Logger.warn('[ApiService] getModels error-path release failed:', e?.message);
        }
      }

      throw new Error(baseMessage);
    }

    return { models: [], page: sharedPage, pageRelease: sharedPageRelease };
  }

  private async getBalanceAndUsage(
    site: SiteConfig,
    timeout: number,
    sharedPage?: any
  ): Promise<
    | {
        balance?: number;
        todayUsage?: number;
        todayPromptTokens?: number;
        todayCompletionTokens?: number;
        todayTotalTokens?: number;
        todayRequests?: number;
        pageRelease?: () => void;
      }
    | undefined
  > {
    Logger.info('💰 [ApiService] 获取余额和今日消费...');

    const authToken = site.system_token || site.api_key;

    if (!authToken || !site.user_id) {
      Logger.warn('⚠️ [ApiService] 缺少认证信息');
      return undefined;
    }

    try {
      // 并行获取余额和今日消费，传入共享页面
      const [balanceResult, usageStats] = await Promise.all([
        this.fetchBalance(site, timeout, authToken, sharedPage),
        this.fetchTodayUsageFromLogs(site, timeout, sharedPage),
      ]);

      return {
        balance: balanceResult?.balance,
        todayUsage: usageStats.todayUsage,
        todayPromptTokens: usageStats.todayPromptTokens,
        todayCompletionTokens: usageStats.todayCompletionTokens,
        todayTotalTokens: usageStats.todayTotalTokens,
        todayRequests: usageStats.todayRequests,
        pageRelease: balanceResult?.pageRelease,
      };
    } catch (error: any) {
      Logger.error('❌ [ApiService] 获取余额或今日消费失败:', error.message);
      // 将错误抛给上层，由 detectSite 结束当前站点检测并在卡片显示错误信息
      throw new Error(`余额/消费接口请求失败: ${error.message}`);
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
  ): Promise<{ balance?: number; pageRelease?: () => void } | undefined> {
    const endpoints = ['/api/user/self', '/api/user/dashboard'];
    let lastError: any = null;
    let pageRelease: (() => void) | undefined = undefined;

    for (const endpoint of endpoints) {
      try {
        const url = `${site.url.replace(/\/$/, '')}${endpoint}`;
        const headers: any = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          Pragma: 'no-cache',
        };

        // 添加所有User-ID头（兼容各种站点）
        const userIdHeaders = getAllUserIdHeaders(site.user_id!);
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

        // 保存 pageRelease（如果有）
        if (result.pageRelease) {
          pageRelease = result.pageRelease;
        }

        const balance = result.result;

        if (balance !== undefined) {
          return { balance, pageRelease };
        }
      } catch (error: any) {
        Logger.info(`⚠️ [ApiService] 端点 ${endpoint} 获取余额失败，尝试下一个...`);
        lastError = error;
        // 继续尝试下一个端点，不提前终止
        continue;
      }
    }

    // 所有端点都失败，抛出错误结束当前站点检测
    if (lastError) {
      Logger.error('❌ [ApiService] 所有余额接口都失败');
      let baseMessage = `余额接口请求失败: ${lastError.message || lastError}`;
      if (this.isCertError(lastError)) {
        baseMessage += ' (证书错误，站点 HTTPS 证书可能已过期或不受信任)';
      } else {
        baseMessage = this.formatAuthError(lastError, baseMessage);
      }
      throw new Error(baseMessage);
    }

    return { balance: undefined, pageRelease };
  }

  private extractBalance(data: any): number | undefined {
    // 检查是否为无限额度
    if (data?.data?.unlimited_quota === true) return -1;

    // 多路径尝试（按优先级排序，参考all-api-hub）
    const paths = [
      'data.quota', // 最常见 (New API, Veloera)
      'data.total_available', // One Hub
      'data.user_info.quota', // 嵌套格式
      'data.balance', // 某些站点
      'data.remain_quota', // 剩余额度
      'data.total_balance', // 总余额
      'data.available_quota', // 可用额度
      'quota', // 直接字段
      'balance', // 直接字段
    ];

    for (const path of paths) {
      const value = this.getNestedValue(data, path);
      if (typeof value === 'number' && value !== null && value !== undefined) {
        // 根据数值大小判断是否需要转换
        // 如果>1000，认为是以内部单位存储（1 USD = 500000单位）
        const converted = value > 1000 ? value / 500000 : value;
        Logger.info(`✅ [ApiService] 从 ${path} 提取余额: ${converted} (原始值: ${value})`);
        return converted;
      }
    }

    Logger.warn('⚠️ [ApiService] 未找到余额字段');
    return undefined;
  }

  private extractTodayUsage(data: any): number | undefined {
    // 查找今日消费字段（多路径尝试）
    const paths = [
      'data.today_quota_consumption', // New API
      'data.user_info.today_quota_consumption', // 嵌套格式
      'data.today_consumption', // 某些站点
      'data.today_used', // 某些站点
      'today_quota_consumption', // 直接字段
      'today_consumption', // 直接字段
      'today_used', // 直接字段
    ];

    for (const path of paths) {
      const value = this.getNestedValue(data, path);
      if (typeof value === 'number' && value !== null && value !== undefined) {
        // 根据数值大小判断是否需要转换
        const converted = value > 1000 ? value / 500000 : value;
        Logger.info(`✅ [ApiService] 从 ${path} 提取今日消费: ${converted} (原始值: ${value})`);
        return converted;
      }
    }

    Logger.warn('⚠️ [ApiService] 未找到今日消费字段，返回0');
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
   * 聚合日志数据计算今日消费和 Token 统计
   * 使用共享的聚合函数以保持一致性
   */
  private aggregateUsageData(items: LogItem[]): {
    quota: number;
    promptTokens: number;
    completionTokens: number;
  } {
    const stats = sharedAggregateUsageData(items);
    return {
      quota: stats.quota,
      promptTokens: stats.promptTokens,
      completionTokens: stats.completionTokens,
    };
  }

  /**
   * 获取今日消费数据（通过日志API）
   */
  /**
   * 通过日志API计算今日消费（更健壮的解析与容错）
   * - 兼容多种响应结构：data.items、data.data、data.list、顶层数组等
   * - 发生格式不符、404/403/5xx或超时时不再抛出错误，返回已累计或0
   */
  private async fetchTodayUsageFromLogs(
    site: SiteConfig,
    timeout: number,
    sharedPage?: any
  ): Promise<TodayUsageStats> {
    const emptyStats: TodayUsageStats = {
      todayUsage: 0,
      todayPromptTokens: 0,
      todayCompletionTokens: 0,
      todayTotalTokens: 0,
      todayRequests: 0,
    };

    try {
      const authToken = site.system_token || site.api_key;
      if (!authToken || !site.user_id) {
        Logger.info('⚠️ [ApiService] 缺少认证信息，跳过今日消费查询');
        return emptyStats;
      }

      const { start: startTimestamp, end: endTimestamp } = this.getTodayTimestampRange();

      let currentPage = 1;
      const maxPages = 100;
      const pageSize = 100; // 每页100条
      let totalQuota = 0;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let totalRequests = 0;

      Logger.info(
        `📊 [ApiService] 开始查询今日消费: ${new Date(startTimestamp * 1000).toLocaleString()} ~ ${new Date(endTimestamp * 1000).toLocaleString()}`
      );

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
          group: '',
        });

        const logUrl = `${site.url.replace(/\/$/, '')}/api/log/self?${params.toString()}`;

        const headers: any = {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          Pragma: 'no-cache',
        };

        // 添加所有User-ID头（兼容各种站点）
        const userIdHeaders = getAllUserIdHeaders(site.user_id!);
        Object.assign(headers, userIdHeaders);

        try {
          const result = await this.fetchWithBrowserFallback<LogResponse | any>(
            logUrl,
            headers,
            site,
            timeout,
            (data: any) => {
              const normalize = (resp: any): { items: LogItem[]; total: number } => {
                if (!resp) return { items: [], total: 0 };
                const d = resp.data ?? resp;
                let items: any = [];
                if (Array.isArray(d)) items = d;
                else if (Array.isArray(d?.items)) items = d.items;
                else if (Array.isArray(d?.data)) items = d.data;
                else if (Array.isArray(d?.list)) items = d.list;
                else if (Array.isArray(resp?.items)) items = resp.items;
                const total = (d?.total ?? d?.total_count ?? resp?.total ?? 0) as number;
                return {
                  items,
                  total:
                    typeof total === 'number' ? total : Array.isArray(items) ? items.length : 0,
                };
              };
              const { items, total } = normalize(data);
              return { success: true, data: { items, total } } as LogResponse;
            },
            sharedPage
          );

          const logData = result.result as LogResponse;
          const items = logData.data.items || [];

          // 过滤非模型日志，只保留有效的模型调用日志
          const modelLogs = items.filter(isModelLog);
          const modelLogCount = modelLogs.length;

          const pageStats = this.aggregateUsageData(modelLogs);
          totalQuota += pageStats.quota;
          totalPromptTokens += pageStats.promptTokens;
          totalCompletionTokens += pageStats.completionTokens;
          totalRequests += modelLogCount;

          const pageConsumption = pageStats.quota / 500000;
          Logger.info(
            `📄 [ApiService] 第${currentPage}页: ${items.length}条记录, 模型日志: ${modelLogCount}条, 消费: $${pageConsumption.toFixed(4)}`
          );

          const totalPages = Math.ceil((logData.data.total || 0) / pageSize);
          if (currentPage >= totalPages || items.length === 0) {
            Logger.info(`✅ [ApiService] 日志查询完成，共${currentPage}页`);
            break;
          }

          currentPage++;
        } catch (error: any) {
          const status = error?.response?.status;
          // 如果是第一页就遇到401/403认证错误，抛出带提示的错误
          if (currentPage === 1 && this.isAuthError(error)) {
            const baseMessage = `日志接口请求失败: ${error.message || error}`;
            throw new Error(this.formatAuthError(error, baseMessage));
          }
          if (this.isFatalHttpStatus(status) || this.isTimeoutError(error)) {
            Logger.warn(
              `⚠️ [ApiService] 日志接口不可用或超时(HTTP ${status || 'N/A'})，返回已累计数据`
            );
            break;
          }
          Logger.error(`❌ [ApiService] 日志查询异常(第${currentPage}页):`, error.message);
          break;
        }
      }

      if (currentPage > maxPages) {
        Logger.info(`⚠️ [ApiService] 达到最大分页限制(${maxPages}页)，停止查询`);
      }

      const todayUsage = totalQuota / 500000;
      const todayTotalTokens = totalPromptTokens + totalCompletionTokens;

      Logger.info(
        `💰 [ApiService] 今日统计: 消费=$${todayUsage.toFixed(4)}, 请求=${totalRequests}, Token=${todayTotalTokens}`
      );

      return {
        todayUsage,
        todayPromptTokens: totalPromptTokens,
        todayCompletionTokens: totalCompletionTokens,
        todayTotalTokens,
        todayRequests: totalRequests,
      };
    } catch (error: any) {
      Logger.warn('⚠️ [ApiService] 今日消费查询失败，返回0:', error.message);
      return emptyStats;
    }
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * 检测站点是否支持 LDC 支付
   * @param site 站点配置
   * @param timeout 超时时间（秒）
   * @param sharedPage 共享的浏览器页面
   * @returns LDC 支付信息
   */
  private async detectLdcPayment(
    site: SiteConfig,
    timeout: number,
    sharedPage?: any
  ): Promise<LdcPaymentInfo> {
    const result: LdcPaymentInfo = {
      ldcPaymentSupported: false,
      ldcExchangeRate: undefined,
      ldcPaymentType: undefined,
    };

    try {
      // 步骤1：调用 /api/user/topup/info 检查支付方式
      const topupInfoUrl = `${site.url.replace(/\/$/, '')}/api/user/topup/info`;
      const authToken = site.system_token || site.api_key;

      if (!authToken) {
        Logger.info('⚠️ [ApiService] 缺少认证令牌，跳过 LDC 支付检测');
        return result;
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      };

      // 添加 User-ID headers
      if (site.user_id) {
        const userIdHeaders = getAllUserIdHeaders(site.user_id);
        Object.assign(headers, userIdHeaders);
      }

      try {
        const topupInfoResult = await this.fetchWithBrowserFallback<TopupInfoApiResponse>(
          topupInfoUrl,
          headers,
          site,
          timeout,
          (data: any) => data as TopupInfoApiResponse,
          sharedPage,
          { ttl: 60000 } // 缓存1分钟
        );

        const topupInfo = topupInfoResult.result;

        // 检查 pay_methods 数组中是否有 LDC 支付方式（支持多种名称）
        const payMethods = topupInfo?.data?.pay_methods || [];
        Logger.info(
          `📋 [ApiService] 站点支付方式列表: ${JSON.stringify(payMethods.map((m: PayMethod) => ({ name: m.name, type: m.type })))}`
        );

        const ldcPayMethod = payMethods.find((method: PayMethod) =>
          LDC_PAYMENT_NAMES.some(name => method.name?.toLowerCase() === name.toLowerCase())
        );

        if (ldcPayMethod) {
          result.ldcPaymentSupported = true;
          result.ldcPaymentType = ldcPayMethod.type; // 保存支付方式类型
          Logger.info(`✅ [ApiService] 站点支持 LDC 支付, 类型: ${ldcPayMethod.type}`);

          // 步骤2：调用 /api/user/amount 获取兑换比例（需要 POST 方法，传递 amount 参数）
          try {
            const amountUrl = `${site.url.replace(/\/$/, '')}/api/user/amount`;
            Logger.info('📡 [ApiService] 发起 POST 请求获取兑换比例:', amountUrl);

            // API 需要传递 amount 参数，传递 1 来获取 1 单位的兑换比例
            const amountResult = await this.fetchWithBrowserFallback<AmountApiResponse>(
              amountUrl,
              headers,
              site,
              timeout,
              (data: any) => data as AmountApiResponse,
              sharedPage,
              { ttl: 60000, skipCache: true },
              { method: 'POST', data: { amount: 1 } }
            );

            const amountData = amountResult.result;
            Logger.info('📦 [ApiService] /api/user/amount 原始响应:', JSON.stringify(amountData));
            // 检查响应是否成功（success 不为 false 且 message 不是 error）
            if (amountData?.data && amountData.message !== 'error') {
              result.ldcExchangeRate = amountData.data;
              Logger.info(`✅ [ApiService] LDC 兑换比例: ${result.ldcExchangeRate}`);
            } else {
              Logger.warn(
                '⚠️ [ApiService] 获取兑换比例失败:',
                amountData?.data || amountData?.message
              );
            }
          } catch (amountError: any) {
            Logger.warn('⚠️ [ApiService] 获取 LDC 兑换比例失败:', amountError.message);
            // 兑换比例获取失败不影响支付支持状态
          }
        } else {
          Logger.info('ℹ️ [ApiService] 站点不支持 LDC 支付');
        }
      } catch (topupError: any) {
        Logger.info('⚠️ [ApiService] 获取充值信息失败:', topupError.message);
        // topup/info 接口失败，设置为不支持
      }
    } catch (error: any) {
      Logger.error('❌ [ApiService] LDC 支付检测异常:', error.message);
    }

    return result;
  }

  /**
   * 保存缓存显示数据到统一配置
   */
  private async saveCachedDisplayData(
    siteUrl: string,
    detectionResult: DetectionResult
  ): Promise<void> {
    try {
      const site = unifiedConfigManager.getSiteByUrl(siteUrl);
      if (!site) {
        Logger.info('⚠️ [ApiService] 未找到对应站点，跳过缓存保存');
        return;
      }

      // 获取现有的缓存数据，保留 cli_compatibility 等字段
      const existingCachedData = site.cached_data || ({} as NonNullable<typeof site.cached_data>);

      // 构建缓存数据，保留现有的 cli_compatibility
      const cachedData = {
        ...existingCachedData, // 保留现有字段（如 cli_compatibility）
        models: detectionResult.models || [],
        balance: detectionResult.balance,
        today_usage: detectionResult.todayUsage,
        today_prompt_tokens: detectionResult.todayPromptTokens,
        today_completion_tokens: detectionResult.todayCompletionTokens,
        today_requests: detectionResult.todayRequests,
        api_keys: detectionResult.apiKeys,
        user_groups: detectionResult.userGroups,
        model_pricing: detectionResult.modelPricing,
        last_refresh: Date.now(),
        can_check_in: detectionResult.can_check_in,
        // LDC 支付信息
        ldc_payment_supported: detectionResult.ldcPaymentSupported,
        ldc_exchange_rate: detectionResult.ldcExchangeRate,
        ldc_payment_type: detectionResult.ldcPaymentType,
        // 签到统计数据 (New API)
        checkin_stats: detectionResult.checkinStats
          ? {
              today_quota: detectionResult.checkinStats.todayQuota,
              checkin_count: detectionResult.checkinStats.checkinCount,
              total_checkins: detectionResult.checkinStats.totalCheckins,
              site_type: detectionResult.checkinStats.siteType,
            }
          : existingCachedData.checkin_stats, // 保留现有数据
        // 检测状态持久化
        status: detectionResult.status,
        error: detectionResult.error,
      };

      // 更新站点缓存
      await unifiedConfigManager.updateSite(site.id, {
        cached_data: cachedData,
        has_checkin: detectionResult.has_checkin,
        last_sync_time: Date.now(),
      });

      Logger.info('✅ [ApiService] 缓存数据已保存到 config.json');
    } catch (error: any) {
      Logger.error('❌ [ApiService] 保存缓存数据失败:', error.message);
    }
  }
}
