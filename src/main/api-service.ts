import axios from 'axios';
import type { SiteConfig } from './types/token';
import { requestManager, RequestManager } from './utils/request-manager';
import { getAllUserIdHeaders } from '../shared/utils/headers';
import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';

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
}

// 今日使用统计
interface TodayUsageStats {
  todayUsage: number;
  todayPromptTokens: number;
  todayCompletionTokens: number;
  todayTotalTokens: number;
  todayRequests: number;
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

  constructor(tokenService?: any, _tokenStorage?: any) {
    this.tokenService = tokenService;
    // tokenStorage 参数已废弃，使用 unifiedConfigManager 替代
  }

  async detectSite(
    site: SiteConfig,
    timeout: number,
    quickRefresh: boolean = false,
    cachedData?: DetectionResult
  ): Promise<DetectionResult> {
    let sharedPage: any = null;
    let pageRelease: (() => void) | undefined = undefined;
    let balancePageRelease: (() => void) | undefined = undefined;

    try {
      // 获取模型列表（可能会创建浏览器页面）
      const modelsResult = await this.getModels(site, timeout);
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
          pageRelease();
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

    // �ر����: ˳��ִ��
    for (const site of enabledSites) {
      const cachedData = cachedMap.get(site.name);
      const result = await this.detectSite(site, config.settings.timeout, quickRefresh, cachedData);
      results.push(result);
    }
    return results;
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
          const verificationStatus = await page.evaluate(() => {
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
          });

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
   */
  private formatAuthError(error: any, originalMessage: string): string {
    const status = error?.response?.status;
    if (status === 401) {
      return `${originalMessage} (认证失败，请重新获取 access_token)`;
    } else if (status === 403) {
      return `${originalMessage} (权限不足，请重新获取 access_token)`;
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
      await unifiedConfigManager.updateSite(site.id, {
        // 可以在 UnifiedSite 中添加这些字段，暂时跳过
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
    cacheOptions?: { ttl?: number; skipCache?: boolean }
  ): Promise<{ result: T; page?: any; pageRelease?: () => void }> {
    Logger.info('📡 [ApiService] 发起请求:', url);

    // 生成缓存 key（基于 URL 和用户 ID）
    const cacheKey = RequestManager.key(url, site.user_id || 'anonymous');

    try {
      // 使用 requestManager 包装请求，实现去重和缓存
      const response = await requestManager.request(
        cacheKey,
        () => axios.get(url, { timeout: timeout * 1000, headers }),
        { ttl: cacheOptions?.ttl ?? 30000, skipCache: cacheOptions?.skipCache }
      );

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
      const needBrowserFallback =
        this.isCloudflareProtection(error) || error.isBotDetection === true;
      if (needBrowserFallback) {
        Logger.info('🛡️ [ApiService] 检测到Bot/Cloudflare保护，切换到浏览器模式...');

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
            const result = await page.evaluate(
              async (
                apiUrl: string,
                requestHeaders: Record<string, string>,
                additionalHeaders: Record<string, string>
              ) => {
                // 构建完整的请求头（包含所有User-ID头）
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
            if (pageRelease) {
              pageRelease();
            }
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
    timeout: number
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
    // 跟踪是否有端点返回"成功但无数据"的情况（可能是权限问题）
    let hasEmptySuccessResponse = false;

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

            // Done Hub可能返回空的 { success: true, message: "..." } 没有data
            // 这种情况说明该站点没有可用模型或需要特殊权限
            if (!data || !('data' in data)) {
              Logger.warn('⚠️ [ApiService] 响应中没有data字段，可能需要特殊权限或该站点无模型');
              // 标记检测到空成功响应
              hasEmptySuccessResponse = true;
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

        // 如果返回空数组，尝试下一个端点
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

        // 对于致命状态码（如 400/403/5xx 等）或超时错误，继续尝试其它端点通常没有意义，直接终止
        const status = error?.response?.status;
        if (
          this.isFatalHttpStatus(status) ||
          this.isTimeoutError(error) ||
          this.isCertError(error)
        ) {
          if (this.isFatalHttpStatus(status)) {
            Logger.warn(`⛔ [ApiService] 检测到致命HTTP状态码 ${status}，停止尝试其它模型端点`);
          } else if (this.isCertError(error)) {
            Logger.warn('⛔ [ApiService] 检测到证书错误（可能证书过期），停止尝试其它模型端点');
          } else {
            Logger.warn('⛔ [ApiService] 检测到超时错误，停止尝试其它模型端点');
          }
          break;
        }

        continue;
      }
    }

    // 所有端点都失败，直接结束当前站点检测
    if (lastError) {
      Logger.error('❌ [ApiService] 所有模型接口都失败');
      let baseMessage = `模型接口请求失败: ${lastError.message || lastError}`;
      if (this.isCertError(lastError)) {
        baseMessage += ' (证书错误，站点 HTTPS 证书可能已过期或不受信任)';
      } else if (hasEmptySuccessResponse) {
        baseMessage += ' (部分接口返回成功但无数据，请检查 access_token 权限或重新获取)';
      } else {
        baseMessage = this.formatAuthError(lastError, baseMessage);
      }
      throw new Error(baseMessage);
    }

    // 没有错误但也没有模型
    if (hasEmptySuccessResponse) {
      // 接口返回成功但没有数据，可能是权限问题
      throw new Error('模型接口返回成功但无数据，请检查 access_token 权限或重新获取');
    }

    // 返回空结果（认为该站点暂无模型，不算致命错误）
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

        // 对于致命状态码或超时错误，直接终止余额查询，避免无意义的重试
        const status = error?.response?.status;
        if (
          this.isFatalHttpStatus(status) ||
          this.isTimeoutError(error) ||
          this.isCertError(error)
        ) {
          if (this.isFatalHttpStatus(status)) {
            Logger.warn(`⛔ [ApiService] 检测到致命HTTP状态码 ${status}，停止尝试其它余额端点`);
          } else if (this.isCertError(error)) {
            Logger.warn('⛔ [ApiService] 检测到证书错误（可能证书过期），停止尝试其它余额端点');
          } else {
            Logger.warn('⛔ [ApiService] 检测到超时错误，停止尝试其它余额端点');
          }
          break;
        }

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
   */
  private aggregateUsageData(items: LogItem[]): {
    quota: number;
    promptTokens: number;
    completionTokens: number;
  } {
    let totalQuota = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    for (const item of items) {
      totalQuota += item.quota || 0;
      promptTokens += item.prompt_tokens || 0;
      completionTokens += item.completion_tokens || 0;
    }

    return { quota: totalQuota, promptTokens, completionTokens };
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
          const currentPageItemCount = items.length;

          const pageStats = this.aggregateUsageData(items);
          totalQuota += pageStats.quota;
          totalPromptTokens += pageStats.promptTokens;
          totalCompletionTokens += pageStats.completionTokens;
          totalRequests += currentPageItemCount;

          const pageConsumption = pageStats.quota / 500000;
          Logger.info(
            `📄 [ApiService] 第${currentPage}页: ${currentPageItemCount}条记录, 消费: $${pageConsumption.toFixed(4)}`
          );

          const totalPages = Math.ceil((logData.data.total || 0) / pageSize);
          if (currentPage >= totalPages || currentPageItemCount === 0) {
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

      // 构建缓存数据
      const cachedData = {
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
