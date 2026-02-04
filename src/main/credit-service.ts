/**
 * 输入: ChromeManager (浏览器自动化), HttpClient (HTTP 请求), FileSystem (配置持久化)
 * 输出: CreditInfo, CreditConfig, 登录状态管理
 * 定位: 服务层 - 管理 Linux Do Credit 积分检测功能
 *       登录时一次性获取所有数据（积分、每日统计、交易记录）并缓存到本地
 *       支持从缓存加载数据，减少 API 请求
 *       refreshAllData 方法在单个浏览器页面中刷新所有数据，避免打开多个浏览器窗口
 *       充值功能使用浏览器模式，通过 localStorage 检测登录状态，
 *       并在 API 请求中添加 New-Api-User header 进行认证
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { app } from 'electron';
import { shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ChromeManager } from './chrome-manager';
import { httpGet, httpPost } from './utils/http-client';
import Logger from './utils/logger';
import { getAllUserIdHeaders } from '../shared/utils/headers';
import type {
  CreditInfo,
  CreditConfig,
  CreditResponse,
  CreditApiResponse,
  CreditStorageData,
  DailyStats,
  DailyStatItem,
  DailyStatsApiResponse,
  TransactionList,
  TransactionsApiResponse,
  CreditLoginResult,
  RechargeRequest,
  RechargeResponse,
  PayApiResponse,
} from '../shared/types/credit';
import {
  calculateTotalIncome,
  calculateTotalExpense,
  DEFAULT_CREDIT_CONFIG,
  fillCreditConfigDefaults,
} from '../shared/types/credit';

// API 端点
const CREDIT_API_URL = 'https://credit.linux.do/api/v1/oauth/user-info';
const DAILY_STATS_API_URL = 'https://credit.linux.do/api/v1/dashboard/stats/daily';
const TRANSACTIONS_API_URL = 'https://credit.linux.do/api/v1/order/transactions';

/**
 * Credit 服务类
 * 负责 Linux Do Credit 积分检测的核心逻辑
 */
export class CreditService {
  private chromeManager: ChromeManager;
  private storagePath: string;
  private cookies: string | null = null;
  private cachedInfo: CreditInfo | null = null;
  private cachedDailyStats: DailyStats | null = null;
  private cachedTransactions: TransactionList | null = null;
  private config: CreditConfig;

  constructor(chromeManager: ChromeManager) {
    this.chromeManager = chromeManager;
    this.storagePath = path.join(app.getPath('userData'), 'credit-settings.json');
    this.config = { ...DEFAULT_CREDIT_CONFIG };
  }

  /**
   * 初始化服务：加载配置和缓存数据
   */
  async initialize(): Promise<void> {
    try {
      await this.loadStorageData();
      Logger.info('✅ [CreditService] 服务初始化完成');
    } catch (error) {
      Logger.warn('⚠️ [CreditService] 初始化时加载数据失败，使用默认配置');
    }
  }

  /**
   * 刷新所有 LDC 数据（积分、每日统计、交易记录）
   * 在单个浏览器页面中完成所有数据获取，避免打开多个浏览器窗口
   */
  async refreshAllData(): Promise<
    CreditResponse<{
      creditInfo: CreditInfo | null;
      dailyStats: DailyStats | null;
      transactions: TransactionList | null;
    }>
  > {
    Logger.info('🔄 [CreditService] 开始刷新所有 LDC 数据...');

    if (!this.cookies) {
      return {
        success: false,
        error: '未登录，请先登录 Linux Do Credit',
      };
    }

    let page: any = null;
    let release: (() => void) | null = null;

    try {
      Logger.info('🌐 [CreditService] 使用浏览器环境刷新所有数据...');
      const pageResult = await this.chromeManager.createPage('https://credit.linux.do/home');
      page = pageResult.page;
      release = pageResult.release;

      let creditInfo: CreditInfo | null = null;
      let dailyStats: DailyStats | null = null;
      let transactions: TransactionList | null = null;

      // 【第一阶段】在 credit.linux.do 页面获取积分、每日统计和交易记录
      // 步骤1: 获取 credit.linux.do 用户信息（包含基准值和用户名）
      Logger.info('📡 [CreditService] 获取 credit.linux.do 用户信息...');

      const creditResult = await page.evaluate(async (apiUrl: string) => {
        try {
          const response = await fetch(apiUrl, {
            method: 'GET',
            credentials: 'include',
            headers: {
              Accept: 'application/json, text/plain, */*',
            },
          });

          if (!response.ok) {
            return {
              success: false,
              status: response.status,
              error: response.status === 401 ? '未登录' : '请求失败',
            };
          }

          const data = await response.json();
          return { success: true, data, status: response.status };
        } catch (e: any) {
          return { success: false, error: e.message, status: 0 };
        }
      }, CREDIT_API_URL);

      Logger.info(`📡 [CreditService] 浏览器 API 响应状态: ${creditResult.status}`);

      if (!creditResult.success) {
        if (creditResult.status === 401 || creditResult.status === 403) {
          this.cookies = null;
          await this.saveStorageData();
        }
        return {
          success: false,
          error: creditResult.error || '获取数据失败',
        };
      }

      const apiData = creditResult.data as CreditApiResponse;
      if (!apiData || !apiData.data) {
        return {
          success: false,
          error: '数据格式异常，请稍后重试',
        };
      }

      const userData = apiData.data;
      const communityBalance = parseFloat(userData.community_balance) || 0;
      const username = userData.username;

      Logger.info(`✅ [CreditService] 用户名: ${username}, 基准值: ${communityBalance}`);

      // 步骤2: 获取每日统计数据
      Logger.info('📡 [CreditService] 获取每日统计数据...');
      try {
        const dailyStatsResult = (await page.evaluate(async (url: string) => {
          try {
            const response = await fetch(url, {
              method: 'GET',
              credentials: 'include',
              headers: { Accept: 'application/json, text/plain, */*' },
            });
            if (!response.ok) return { success: false, status: response.status };
            const data = await response.json();
            return { success: true, data, status: response.status };
          } catch (e: any) {
            return { success: false, error: e.message, status: 0 };
          }
        }, `${DAILY_STATS_API_URL}?days=7`)) as {
          success: boolean;
          data?: DailyStatsApiResponse;
          status: number;
        };

        if (dailyStatsResult.success && dailyStatsResult.data?.data) {
          const items = dailyStatsResult.data.data;
          dailyStats = {
            items,
            totalIncome: calculateTotalIncome(items),
            totalExpense: calculateTotalExpense(items),
            lastUpdated: Date.now(),
          };
          Logger.info(`✅ [CreditService] 每日统计获取成功: ${items.length} 条记录`);
        } else {
          Logger.warn(`⚠️ [CreditService] 获取每日统计失败: status=${dailyStatsResult.status}`);
        }
      } catch (e: any) {
        Logger.warn(`⚠️ [CreditService] 获取每日统计失败: ${e.message}`);
      }

      // 步骤3: 获取交易记录
      Logger.info('📡 [CreditService] 获取交易记录...');
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        const transactionsResult = (await page.evaluate(
          async (url: string, body: { page: number; page_size: number }) => {
            try {
              const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: {
                  Accept: 'application/json, text/plain, */*',
                  'Content-Type': 'application/json',
                  Origin: 'https://credit.linux.do',
                  Referer: 'https://credit.linux.do/home',
                },
                body: JSON.stringify(body),
              });
              if (!response.ok) return { success: false, status: response.status };
              const data = await response.json();
              return { success: true, data, status: response.status };
            } catch (e: any) {
              return { success: false, error: e.message, status: 0 };
            }
          },
          TRANSACTIONS_API_URL,
          { page: 1, page_size: 10 }
        )) as { success: boolean; data?: TransactionsApiResponse; status: number };

        if (transactionsResult.success && transactionsResult.data?.data) {
          const txData = transactionsResult.data.data;
          transactions = {
            total: txData.total,
            page: txData.page,
            pageSize: txData.page_size,
            orders: txData.orders || [],
            lastUpdated: Date.now(),
          };
          Logger.info(`✅ [CreditService] 交易记录获取成功: ${transactions.total} 条`);
        } else {
          Logger.warn(`⚠️ [CreditService] 获取交易记录失败: status=${transactionsResult.status}`);
        }
      } catch (e: any) {
        Logger.warn(`⚠️ [CreditService] 获取交易记录失败: ${e.message}`);
      }

      // 注意：不再获取 linux.do 积分（gamificationScore），避免 429 限流问题
      // gamificationScore 和 difference 保留为 0，前端不再显示相关信息

      creditInfo = {
        id: userData.id,
        username: userData.username,
        nickname: userData.nickname,
        avatarUrl: userData.avatar_url,
        trustLevel: userData.trust_level,
        communityBalance,
        gamificationScore: 0, // 不再获取
        difference: 0, // 不再计算
        totalReceive: userData.total_receive,
        totalPayment: userData.total_payment,
        totalTransfer: userData.total_transfer,
        totalCommunity: userData.total_community,
        availableBalance: userData.available_balance,
        payScore: userData.pay_score,
        payLevel: userData.pay_level,
        isPayKey: userData.is_pay_key,
        remainQuota: userData.remain_quota,
        dailyLimit: userData.daily_limit,
        isAdmin: userData.is_admin,
        lastUpdated: Date.now(),
      };

      // 缓存所有数据
      this.cachedInfo = creditInfo;
      this.cachedDailyStats = dailyStats;
      this.cachedTransactions = transactions;
      await this.saveStorageData();

      Logger.info('✅ [CreditService] 所有 LDC 数据刷新成功');
      return {
        success: true,
        data: { creditInfo, dailyStats, transactions },
      };
    } catch (error: any) {
      Logger.error('❌ [CreditService] 刷新所有数据失败:', error.message);
      return {
        success: false,
        error: this.formatErrorMessage(error),
      };
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          // 忽略关闭错误
        }
      }
      if (release) {
        release();
      }
    }
  }

  /**
   * 获取积分数据
   * 调用两个 API 获取基准值和当前分，计算差值
   */
  async fetchCreditData(): Promise<CreditResponse<CreditInfo>> {
    Logger.info('🔄 [CreditService] 开始获取积分数据...');

    if (!this.cookies) {
      return {
        success: false,
        error: '未登录，请先登录 Linux Do Credit',
      };
    }

    // 创建浏览器页面，在整个获取过程中保持打开
    let page: any = null;
    let release: (() => void) | null = null;

    try {
      Logger.info('🌐 [CreditService] 使用浏览器环境获取 API 数据...');
      const pageResult = await this.chromeManager.createPage('https://credit.linux.do/home');
      page = pageResult.page;
      release = pageResult.release;

      // 步骤1: 获取 credit.linux.do 用户信息（包含基准值和用户名）
      Logger.info('📡 [CreditService] 获取 credit.linux.do 用户信息...');

      // 在浏览器中执行 fetch 请求
      const creditResult = await page.evaluate(async (apiUrl: string) => {
        try {
          const response = await fetch(apiUrl, {
            method: 'GET',
            credentials: 'include',
            headers: {
              Accept: 'application/json, text/plain, */*',
            },
          });

          if (!response.ok) {
            return {
              success: false,
              status: response.status,
              error: response.status === 401 ? '未登录' : '请求失败',
            };
          }

          const data = await response.json();
          return { success: true, data, status: response.status };
        } catch (e: any) {
          return { success: false, error: e.message, status: 0 };
        }
      }, CREDIT_API_URL);

      Logger.info(`📡 [CreditService] 浏览器 API 响应状态: ${creditResult.status}`);

      if (!creditResult.success) {
        if (creditResult.status === 401 || creditResult.status === 403) {
          this.cookies = null;
          await this.saveStorageData();
        }
        return {
          success: false,
          error: creditResult.error || '获取数据失败',
        };
      }

      const apiData = creditResult.data as CreditApiResponse;
      if (!apiData || !apiData.data) {
        return {
          success: false,
          error: '数据格式异常，请稍后重试',
        };
      }

      const userData = apiData.data;
      const communityBalance = parseFloat(userData.community_balance) || 0;
      const username = userData.username;

      Logger.info(`✅ [CreditService] 用户名: ${username}, 基准值: ${communityBalance}`);

      // 注意：不再获取 linux.do 积分（gamificationScore），避免 429 限流问题

      // 构建积分信息（包含完整的用户数据）
      const creditInfo: CreditInfo = {
        // 基础信息
        id: userData.id,
        username: userData.username,
        nickname: userData.nickname,
        avatarUrl: userData.avatar_url,
        trustLevel: userData.trust_level,
        // 积分信息
        communityBalance,
        gamificationScore: 0, // 不再获取
        difference: 0, // 不再计算
        // 收支信息
        totalReceive: userData.total_receive,
        totalPayment: userData.total_payment,
        totalTransfer: userData.total_transfer,
        totalCommunity: userData.total_community,
        availableBalance: userData.available_balance,
        // 支付信息
        payScore: userData.pay_score,
        payLevel: userData.pay_level,
        isPayKey: userData.is_pay_key,
        remainQuota: userData.remain_quota,
        dailyLimit: userData.daily_limit,
        // 状态信息
        isAdmin: userData.is_admin,
        lastUpdated: Date.now(),
      };

      // 缓存数据
      this.cachedInfo = creditInfo;
      await this.saveStorageData();

      Logger.info('✅ [CreditService] 积分数据获取成功');
      return {
        success: true,
        data: creditInfo,
      };
    } catch (error: any) {
      Logger.error('❌ [CreditService] 获取积分数据失败:', error.message);
      return {
        success: false,
        error: this.formatErrorMessage(error),
      };
    } finally {
      // 确保释放浏览器资源
      if (page) {
        try {
          await page.close();
        } catch {
          // 忽略关闭错误
        }
      }
      if (release) {
        release();
      }
    }
  }

  /**
   * 获取每日统计数据
   * 调用 /api/v1/dashboard/stats/daily API
   * @param days 获取天数，默认 7 天
   */
  async fetchDailyStats(days: number = 7): Promise<CreditResponse<DailyStats>> {
    Logger.info(`🔄 [CreditService] 开始获取每日统计数据 (${days} 天)...`);

    if (!this.cookies) {
      return {
        success: false,
        error: '未登录，请先登录 Linux Do Credit',
      };
    }

    let page: any = null;
    let release: (() => void) | null = null;

    try {
      Logger.info('🌐 [CreditService] 使用浏览器环境获取每日统计数据...');
      const pageResult = await this.chromeManager.createPage('https://credit.linux.do/home');
      page = pageResult.page;
      release = pageResult.release;

      // 在浏览器中执行 fetch 请求
      const apiUrl = `${DAILY_STATS_API_URL}?days=${days}`;
      const result = await page.evaluate(async (url: string) => {
        try {
          const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
              Accept: 'application/json, text/plain, */*',
            },
          });

          if (!response.ok) {
            return {
              success: false,
              status: response.status,
              error: response.status === 401 ? '未登录' : '请求失败',
            };
          }

          const data = await response.json();
          return { success: true, data, status: response.status };
        } catch (e: any) {
          return { success: false, error: e.message, status: 0 };
        }
      }, apiUrl);

      Logger.info(`📡 [CreditService] 每日统计 API 响应状态: ${result.status}`);

      if (!result.success) {
        if (result.status === 401 || result.status === 403) {
          this.cookies = null;
          await this.saveStorageData();
        }
        return {
          success: false,
          error: result.error || '获取每日统计数据失败',
        };
      }

      const apiData = result.data as DailyStatsApiResponse;
      if (!apiData || !Array.isArray(apiData.data)) {
        return {
          success: false,
          error: '数据格式异常，请稍后重试',
        };
      }

      const items: DailyStatItem[] = apiData.data;
      const totalIncome = calculateTotalIncome(items);
      const totalExpense = calculateTotalExpense(items);

      const dailyStats: DailyStats = {
        items,
        totalIncome,
        totalExpense,
        lastUpdated: Date.now(),
      };

      Logger.info(
        `✅ [CreditService] 每日统计数据获取成功: ${items.length} 条记录, 总收入: ${totalIncome}, 总支出: ${totalExpense}`
      );
      return {
        success: true,
        data: dailyStats,
      };
    } catch (error: any) {
      Logger.error('❌ [CreditService] 获取每日统计数据失败:', error.message);
      return {
        success: false,
        error: this.formatErrorMessage(error),
      };
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          // 忽略关闭错误
        }
      }
      if (release) {
        release();
      }
    }
  }

  /**
   * 获取交易记录
   * 调用 /api/v1/order/transactions API (POST)
   * @param page 页码，默认 1
   * @param pageSize 每页数量，默认 10
   */
  async fetchTransactions(
    pageNum: number = 1,
    pageSize: number = 10
  ): Promise<CreditResponse<TransactionList>> {
    Logger.info(`🔄 [CreditService] 开始获取交易记录 (页码: ${pageNum}, 每页: ${pageSize})...`);

    if (!this.cookies) {
      return {
        success: false,
        error: '未登录，请先登录 Linux Do Credit',
      };
    }

    let page: any = null;
    let release: (() => void) | null = null;

    try {
      Logger.info('🌐 [CreditService] 使用浏览器环境获取交易记录...');
      const pageResult = await this.chromeManager.createPage('https://credit.linux.do/home');
      page = pageResult.page;
      release = pageResult.release;

      // 在浏览器中执行 fetch 请求 (POST)
      const result = await page.evaluate(
        async (url: string, requestBody: { page: number; page_size: number }) => {
          try {
            const response = await fetch(url, {
              method: 'POST',
              credentials: 'include',
              headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
              return {
                success: false,
                status: response.status,
                error: response.status === 401 ? '未登录' : '请求失败',
              };
            }

            const data = await response.json();
            return { success: true, data, status: response.status };
          } catch (e: any) {
            return { success: false, error: e.message, status: 0 };
          }
        },
        TRANSACTIONS_API_URL,
        { page: pageNum, page_size: pageSize }
      );

      Logger.info(`📡 [CreditService] 交易记录 API 响应状态: ${result.status}`);

      if (!result.success) {
        if (result.status === 401 || result.status === 403) {
          this.cookies = null;
          await this.saveStorageData();
        }
        return {
          success: false,
          error: result.error || '获取交易记录失败',
        };
      }

      const apiData = result.data as TransactionsApiResponse;
      if (!apiData || !apiData.data) {
        return {
          success: false,
          error: '数据格式异常，请稍后重试',
        };
      }

      const transactionList: TransactionList = {
        total: apiData.data.total,
        page: apiData.data.page,
        pageSize: apiData.data.page_size,
        orders: apiData.data.orders || [],
        lastUpdated: Date.now(),
      };

      Logger.info(
        `✅ [CreditService] 交易记录获取成功: 共 ${transactionList.total} 条, 当前页 ${transactionList.orders.length} 条`
      );
      return {
        success: true,
        data: transactionList,
      };
    } catch (error: any) {
      Logger.error('❌ [CreditService] 获取交易记录失败:', error.message);
      return {
        success: false,
        error: this.formatErrorMessage(error),
      };
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          // 忽略关闭错误
        }
      }
      if (release) {
        release();
      }
    }
  }

  /**
   * 从 credit.linux.do API 获取用户信息（HTTP 客户端方式，备用）
   * 注意：由于 Cloudflare 保护，此方法可能无法正常工作
   * @deprecated 使用浏览器环境方式代替
   */
  private async fetchCreditApiDataViaHttp(): Promise<
    CreditResponse<{ username: string; communityBalance: number }>
  > {
    try {
      Logger.info(`🍪 [CreditService] 使用的 cookies: ${this.cookies?.substring(0, 100)}...`);

      const response = await httpGet<CreditApiResponse>(CREDIT_API_URL, {
        headers: {
          Cookie: this.cookies!,
          Accept: 'application/json, text/plain, */*',
          Referer: 'https://credit.linux.do/home',
          Origin: 'https://credit.linux.do',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
          'sec-ch-ua': '"Chromium";v="143", "Not A(Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
        },
        timeout: 15000,
      });

      Logger.info(`📡 [CreditService] API 响应状态: ${response.status}`);
      Logger.info(
        `📡 [CreditService] API 响应数据: ${JSON.stringify(response.data).substring(0, 200)}`
      );

      // 检查响应状态
      if (response.status === 401 || response.status === 403) {
        // 清除 cookies，强制用户重新登录以获取新的 cf_clearance
        this.cookies = null;
        await this.saveStorageData();
        Logger.warn(
          `⚠️ [CreditService] API 返回 ${response.status}，可能是 Cloudflare cf_clearance 过期`
        );
        return {
          success: false,
          error:
            response.status === 401
              ? '未登录，请先登录'
              : '登录已过期（Cloudflare 验证失效），请重新登录',
        };
      }

      // 解析响应数据
      const data = response.data;
      if (!data || !data.data) {
        return {
          success: false,
          error: '数据格式异常，请稍后重试',
        };
      }

      const userData = data.data;
      const communityBalance = parseFloat(userData.community_balance) || 0;

      return {
        success: true,
        data: {
          username: userData.username,
          communityBalance,
        },
      };
    } catch (error: any) {
      Logger.error(`❌ [CreditService] fetchCreditApiData 异常: ${error.message}`);
      if (error.response) {
        Logger.error(`❌ [CreditService] 响应状态: ${error.response.status}`);
        Logger.error(
          `❌ [CreditService] 响应数据: ${JSON.stringify(error.response.data || {}).substring(0, 200)}`
        );
      }
      return {
        success: false,
        error: this.formatErrorMessage(error),
      };
    }
  }

  /**
   * 启动浏览器登录
   * 登录成功后会自动获取所有数据（积分、每日统计、交易记录）
   */
  async launchLogin(): Promise<CreditResponse<CreditLoginResult | void>> {
    Logger.info('🚀 [CreditService] 启动浏览器登录...');

    try {
      const loginUrl = 'https://credit.linux.do';

      // 直接创建页面（会自动启动浏览器），避免打开两个页面
      Logger.info('⏳ [CreditService] 等待用户完成登录...');
      const { page, release } = await this.chromeManager.createPage(loginUrl);

      try {
        // 等待用户登录（最多等待 5 分钟）
        const maxWaitTime = 300000;
        const checkInterval = 2000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
          // 检查是否已登录（通过直接调用 API 验证，不依赖特定 cookie 名称）
          try {
            // 获取 credit.linux.do 域名的所有 cookies（包括 .linux.do 的跨域 cookies）
            const cookies = await page.cookies('https://credit.linux.do');
            Logger.info(`🍪 [CreditService] 获取到 ${cookies.length} 个 cookies`);

            // 打印所有 cookie 名称和域名用于调试
            const cookieDetails = cookies.map((c: any) => `${c.name}(${c.domain})`).join(', ');
            Logger.info(`🍪 [CreditService] Cookies: ${cookieDetails}`);

            // 查找 cf_clearance cookie (Cloudflare 验证通过的标志)
            const cfClearanceCookie = cookies.find((c: any) => c.name === 'cf_clearance');

            // 只要有 cf_clearance cookie，就尝试通过 API 验证登录状态
            // 不再依赖特定的 session cookie 名称，因为网站可能使用不同的 cookie 名称
            if (cfClearanceCookie) {
              Logger.info(
                `🍪 [CreditService] 找到 cf_clearance cookie, 尝试通过 API 验证登录状态...`
              );

              // 构建 cookie 字符串（包含所有 cookies）
              const cookieString = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');

              // 在浏览器上下文中调用 API 获取用户数据
              // 重要：由于 Cloudflare cf_clearance 绑定到浏览器指纹，必须在同一会话中完成
              Logger.info('📡 [CreditService] 在浏览器会话中获取用户数据...');
              const creditResult = (await page.evaluate(async (apiUrl: string) => {
                try {
                  const response = await fetch(apiUrl, {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                      Accept: 'application/json, text/plain, */*',
                    },
                  });

                  if (!response.ok) {
                    return {
                      success: false as const,
                      status: response.status,
                      error: response.status === 401 ? '未登录' : '请求失败',
                      data: null,
                    };
                  }

                  const data = await response.json();
                  return { success: true as const, data, status: response.status, error: null };
                } catch (e: any) {
                  return { success: false as const, error: e.message, status: 0, data: null };
                }
              }, CREDIT_API_URL)) as {
                success: boolean;
                data: CreditApiResponse | null;
                status: number;
                error: string | null;
              };

              if (creditResult.success && creditResult.data?.data) {
                // 登录成功，保存 cookies
                this.cookies = cookieString;
                Logger.info(
                  `🍪 [CreditService] 保存的 cookies: ${cookieString.substring(0, 100)}...`
                );
                await this.saveStorageData();
                Logger.info('✅ [CreditService] 登录成功');

                // 解析用户数据
                const userData = creditResult.data.data;
                const communityBalance = parseFloat(userData.community_balance) || 0;
                const username = userData.username;

                Logger.info(`✅ [CreditService] 用户名: ${username}, 基准值: ${communityBalance}`);

                // 【第一阶段】在 credit.linux.do 页面获取每日统计和交易记录
                // 必须在导航到 linux.do 之前完成，否则跨域无法访问 credit.linux.do API
                // 等待页面稳定，确保 Cloudflare 验证完全通过
                await new Promise(resolve => setTimeout(resolve, 1000));

                Logger.info('📡 [CreditService] 获取每日统计数据...');
                let dailyStats: DailyStats | null = null;
                let transactions: TransactionList | null = null;

                try {
                  // 获取每日统计
                  const dailyStatsResult = (await page.evaluate(async (url: string) => {
                    try {
                      const response = await fetch(url, {
                        method: 'GET',
                        credentials: 'include',
                        headers: { Accept: 'application/json, text/plain, */*' },
                      });
                      if (!response.ok) return { success: false, status: response.status };
                      const data = await response.json();
                      return { success: true, data, status: response.status };
                    } catch (e: any) {
                      return { success: false, error: e.message, status: 0 };
                    }
                  }, `${DAILY_STATS_API_URL}?days=7`)) as {
                    success: boolean;
                    data?: DailyStatsApiResponse;
                    status: number;
                  };

                  if (dailyStatsResult.success && dailyStatsResult.data?.data) {
                    const items = dailyStatsResult.data.data;
                    dailyStats = {
                      items,
                      totalIncome: calculateTotalIncome(items),
                      totalExpense: calculateTotalExpense(items),
                      lastUpdated: Date.now(),
                    };
                    Logger.info(`✅ [CreditService] 每日统计获取成功: ${items.length} 条记录`);
                  } else {
                    Logger.warn(
                      `⚠️ [CreditService] 获取每日统计失败: status=${dailyStatsResult.status}`
                    );
                  }
                } catch (e: any) {
                  Logger.warn(`⚠️ [CreditService] 获取每日统计失败: ${e.message}`);
                }

                try {
                  // 获取交易记录（等待一下确保 Cloudflare 验证完全通过）
                  await new Promise(resolve => setTimeout(resolve, 500));
                  Logger.info('📡 [CreditService] 获取交易记录...');
                  const transactionsResult = (await page.evaluate(
                    async (url: string, body: { page: number; page_size: number }) => {
                      try {
                        const response = await fetch(url, {
                          method: 'POST',
                          credentials: 'include',
                          headers: {
                            Accept: 'application/json, text/plain, */*',
                            'Content-Type': 'application/json',
                            Origin: 'https://credit.linux.do',
                            Referer: 'https://credit.linux.do/home',
                          },
                          body: JSON.stringify(body),
                        });
                        if (!response.ok) return { success: false, status: response.status };
                        const data = await response.json();
                        return { success: true, data, status: response.status };
                      } catch (e: any) {
                        return { success: false, error: e.message, status: 0 };
                      }
                    },
                    TRANSACTIONS_API_URL,
                    { page: 1, page_size: 10 }
                  )) as { success: boolean; data?: TransactionsApiResponse; status: number };

                  if (transactionsResult.success && transactionsResult.data?.data) {
                    const txData = transactionsResult.data.data;
                    transactions = {
                      total: txData.total,
                      page: txData.page,
                      pageSize: txData.page_size,
                      orders: txData.orders || [],
                      lastUpdated: Date.now(),
                    };
                    Logger.info(`✅ [CreditService] 交易记录获取成功: ${transactions.total} 条`);
                  } else {
                    Logger.warn(
                      `⚠️ [CreditService] 获取交易记录失败: status=${transactionsResult.status}`
                    );
                  }
                } catch (e: any) {
                  Logger.warn(`⚠️ [CreditService] 获取交易记录失败: ${e.message}`);
                }

                // 注意：不再导航到 linux.do 获取论坛积分，避免 Cloudflare 验证和 429 限流问题
                // gamificationScore 和 difference 已不再使用

                // 构建积分信息（包含完整的用户数据）
                const creditInfo: CreditInfo = {
                  // 基础信息
                  id: userData.id,
                  username: userData.username,
                  nickname: userData.nickname,
                  avatarUrl: userData.avatar_url,
                  trustLevel: userData.trust_level,
                  // 积分信息
                  communityBalance,
                  gamificationScore: 0, // 不再从 linux.do 获取
                  difference: 0, // 不再计算差值
                  // 收支信息
                  totalReceive: userData.total_receive,
                  totalPayment: userData.total_payment,
                  totalTransfer: userData.total_transfer,
                  totalCommunity: userData.total_community,
                  availableBalance: userData.available_balance,
                  // 支付信息
                  payScore: userData.pay_score,
                  payLevel: userData.pay_level,
                  isPayKey: userData.is_pay_key,
                  remainQuota: userData.remain_quota,
                  dailyLimit: userData.daily_limit,
                  // 状态信息
                  isAdmin: userData.is_admin,
                  lastUpdated: Date.now(),
                };

                // 缓存积分数据
                this.cachedInfo = creditInfo;

                // 缓存所有数据（每日统计和交易记录已在第一阶段获取）
                this.cachedDailyStats = dailyStats;
                this.cachedTransactions = transactions;
                await this.saveStorageData();

                Logger.info('✅ [CreditService] 登录成功，所有数据获取完成');

                // 返回完整的登录结果
                const loginResult: CreditLoginResult = {
                  creditInfo,
                  dailyStats,
                  transactions,
                };
                return { success: true, data: loginResult };
              } else {
                // API 验证失败，可能用户还未完成 OAuth 登录
                Logger.info(
                  `⏳ [CreditService] API 验证失败 (status: ${creditResult.status})，等待用户完成登录...`
                );
              }
            }
          } catch (e) {
            // 忽略检查错误，继续等待
          }

          await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        return {
          success: false,
          error: '登录超时，请重试',
        };
      } finally {
        try {
          await page.close();
        } catch {
          // 忽略关闭错误
        }
        release();
      }
    } catch (error: any) {
      Logger.error('❌ [CreditService] 登录失败:', error.message);
      return {
        success: false,
        error: this.formatErrorMessage(error),
      };
    }
  }

  /**
   * 获取登录状态
   * 如果有 cookies 和缓存数据，直接返回 true，不进行网络验证
   * 只有在实际获取数据失败时才会更新登录状态
   */
  async getLoginStatus(): Promise<boolean> {
    if (!this.cookies) {
      return false;
    }

    // 如果有 cookies，直接返回 true
    // 实际的登录状态会在 fetchCreditData 等方法中验证
    // 如果 cookies 过期，这些方法会自动清除 cookies 并返回错误
    return true;
  }

  /**
   * 登出
   */
  async logout(): Promise<void> {
    Logger.info('🚪 [CreditService] 执行登出...');
    this.cookies = null;
    this.cachedInfo = null;
    this.cachedDailyStats = null;
    this.cachedTransactions = null;
    await this.saveStorageData();
    Logger.info('✅ [CreditService] 登出完成');
  }

  /**
   * 保存配置
   */
  async saveConfig(config: Partial<CreditConfig>): Promise<void> {
    this.config = fillCreditConfigDefaults({ ...this.config, ...config });
    await this.saveStorageData();
    Logger.info('💾 [CreditService] 配置已保存');
  }

  /**
   * 加载配置
   */
  async loadConfig(): Promise<CreditConfig> {
    return { ...this.config };
  }

  /**
   * 获取缓存的积分数据
   */
  async getCachedCreditInfo(): Promise<CreditInfo | null> {
    return this.cachedInfo ? { ...this.cachedInfo } : null;
  }

  /**
   * 获取缓存的每日统计数据
   */
  async getCachedDailyStats(): Promise<DailyStats | null> {
    return this.cachedDailyStats ? { ...this.cachedDailyStats } : null;
  }

  /**
   * 获取缓存的交易记录
   */
  async getCachedTransactions(): Promise<TransactionList | null> {
    return this.cachedTransactions ? { ...this.cachedTransactions } : null;
  }

  /**
   * 发起充值
   * 使用浏览器模式调用站点 /api/user/pay 端点获取支付 URL，并在浏览器中打开
   * 注意：需要用户在浏览器中登录站点后才能发起支付
   * @param siteUrl 站点 URL
   * @param amount 充值金额（站点余额单位）
   * @param token 站点认证 token (system_token/access_token)，暂不使用
   * @param userId 用户 ID（用于 User-ID headers）
   * @param paymentType 支付方式类型（如 "epay"）
   */
  async initiateRecharge(
    siteUrl: string,
    amount: number,
    token: string,
    userId?: string,
    paymentType?: string
  ): Promise<RechargeResponse> {
    Logger.info(
      `💰 [CreditService] 发起充值: 站点=${siteUrl}, 金额=${amount}, userId=${userId || '未提供'}, paymentType=${paymentType || '未提供'}`
    );

    // 参数验证
    if (!siteUrl || !siteUrl.trim()) {
      return { success: false, error: '站点 URL 不能为空' };
    }
    if (!amount || amount <= 0) {
      return { success: false, error: '充值金额必须大于 0' };
    }

    const baseUrl = siteUrl.replace(/\/+$/, ''); // 移除末尾斜杠
    let page: any = null;
    let release: (() => void) | null = null;
    let browser: any = null;
    let keepPageOpen = false; // 标志：是否保持页面打开（用于支付页面）

    try {
      // 使用浏览器模式发起请求
      Logger.info('🌐 [CreditService] 使用浏览器模式发起充值请求...');

      // 导航到站点的充值页面（让用户登录）
      const topupPageUrl = `${baseUrl}/#/topup`;
      const pageResult = await this.chromeManager.createPage(topupPageUrl);
      page = pageResult.page;
      release = pageResult.release;
      browser = page.browser();

      // 等待用户登录（最多等待 10 分钟）
      Logger.info('⏳ [CreditService] 检查站点登录状态...');
      const maxWaitTime = 600000; // 10 分钟
      const checkInterval = 3000; // 每 3 秒检查一次
      const startTime = Date.now();
      let isLoggedIn = false;
      let hasPromptedLogin = false; // 是否已提示用户登录
      let detectedUserId: number | null = null;

      while (Date.now() - startTime < maxWaitTime) {
        try {
          // 获取所有页面，处理 OAuth 登录可能打开新页面的情况
          const pages = await browser.pages();

          // 找到站点相关的页面（URL 包含站点域名）
          const siteHost = new URL(baseUrl).host;
          let targetPage = null;

          for (const p of pages) {
            try {
              const pageUrl = p.url();
              if (pageUrl.includes(siteHost) && !p.isClosed()) {
                targetPage = p;
                break;
              }
            } catch {
              // 忽略获取 URL 失败的页面
            }
          }

          // 如果找到了站点页面，更新 page 引用
          if (targetPage && targetPage !== page) {
            Logger.info('🔄 [CreditService] 检测到页面切换，更新页面引用');
            page = targetPage;
          }

          // 检查页面是否已关闭
          if (!page || page.isClosed()) {
            // 尝试找到任何可用的站点页面
            const availablePages = await browser.pages();
            const sitePage = availablePages.find((p: any) => {
              try {
                return p.url().includes(siteHost) && !p.isClosed();
              } catch {
                return false;
              }
            });

            if (sitePage) {
              page = sitePage;
            } else {
              return { success: false, error: '浏览器页面已关闭，操作已取消' };
            }
          }

          // 通过读取 localStorage 检查登录状态（与站点刷新逻辑一致）
          const localStorageData = (await page.evaluate(() => {
            const storage = (globalThis as any).localStorage;
            let userId: number | null = null;
            let accessToken: string | null = null;

            // 从 user 对象获取
            const userStr = storage.getItem('user');
            if (userStr) {
              try {
                const user = JSON.parse(userStr);
                userId = user.id || user.user_id || user.userId || user.uid || null;
                accessToken = user.access_token || user.accessToken || user.token || null;
              } catch {
                // JSON 解析失败，忽略
              }
            }

            // 从 siteInfo 对象获取
            if (!userId) {
              const siteInfoStr = storage.getItem('siteInfo');
              if (siteInfoStr) {
                try {
                  const siteInfo = JSON.parse(siteInfoStr);
                  userId = siteInfo.id || siteInfo.user_id || siteInfo.userId || null;
                } catch {
                  // JSON 解析失败，忽略
                }
              }
            }

            // 从 userInfo 对象获取
            if (!userId) {
              const userInfoStr = storage.getItem('userInfo');
              if (userInfoStr) {
                try {
                  const userInfo = JSON.parse(userInfoStr);
                  userId = userInfo.id || userInfo.user_id || userInfo.userId || null;
                } catch {
                  // JSON 解析失败，忽略
                }
              }
            }

            // 从独立键获取
            if (!userId) {
              const userIdStr = storage.getItem('userId') || storage.getItem('user_id');
              if (userIdStr) {
                userId = parseInt(userIdStr, 10) || null;
              }
            }

            // 获取 accessToken
            if (!accessToken) {
              accessToken =
                storage.getItem('access_token') ||
                storage.getItem('accessToken') ||
                storage.getItem('token') ||
                null;
            }

            return { userId, accessToken };
          })) as { userId: number | null; accessToken: string | null };

          Logger.info(
            `🔍 [CreditService] localStorage 检查: userId=${localStorageData.userId}, hasToken=${!!localStorageData.accessToken}`
          );

          if (localStorageData.userId) {
            Logger.info(`✅ [CreditService] 用户已登录站点 (userId: ${localStorageData.userId})`);
            isLoggedIn = true;
            detectedUserId = localStorageData.userId;
            break;
          }

          // 如果未登录，提示用户
          if (!hasPromptedLogin) {
            Logger.info(`⚠️ [CreditService] 站点未登录，请在弹出的浏览器窗口中登录站点`);
            Logger.info(`💡 [CreditService] 提示：浏览器窗口已打开 ${topupPageUrl}，请完成登录`);
            hasPromptedLogin = true;
          }

          // 每 30 秒输出一次等待日志
          const elapsed = Date.now() - startTime;
          if (elapsed % 30000 < checkInterval) {
            Logger.info(
              `⏳ [CreditService] 等待用户在浏览器中登录... (${Math.floor(elapsed / 1000)}s / ${Math.floor(maxWaitTime / 1000)}s)`
            );
          }
        } catch (loopError: any) {
          Logger.warn(`⚠️ [CreditService] 检查登录状态时出错: ${loopError.message}`);
        }

        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }

      if (!isLoggedIn) {
        return { success: false, error: '等待登录超时（10分钟），请重试' };
      }

      // 使用检测到的 userId（如果前端没有传递）
      const effectiveUserId = userId || (detectedUserId ? String(detectedUserId) : undefined);

      // 步骤1：调用 /api/user/amount 激活支付会话
      const amountUrl = `${baseUrl}/api/user/amount`;
      Logger.info(
        `📡 [CreditService] 步骤1: 调用 /api/user/amount: ${amountUrl}, effectiveUserId=${effectiveUserId}`
      );

      try {
        const amountResult = await page.evaluate(
          async (url: string, body: { amount: number }, userIdHeader: string | undefined) => {
            try {
              const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/plain, */*',
              };
              // 添加 New-Api-User header（站点要求）
              if (userIdHeader) {
                headers['New-Api-User'] = userIdHeader;
              }
              const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers,
                body: JSON.stringify(body),
              });
              const data = await response.json();
              return { success: response.ok, status: response.status, data };
            } catch (e: any) {
              return { success: false, error: e.message };
            }
          },
          amountUrl,
          { amount },
          effectiveUserId
        );

        Logger.info(
          `📡 [CreditService] /api/user/amount 响应: ${JSON.stringify(amountResult).substring(0, 200)}`
        );
      } catch (amountError: any) {
        Logger.warn(
          `⚠️ [CreditService] /api/user/amount 调用失败: ${amountError.message}，继续尝试支付`
        );
      }

      // 步骤2：调用 /api/user/pay 发起支付
      const payUrl = `${baseUrl}/api/user/pay`;
      // New API 的 /api/user/pay 接口使用 payment_method 参数（不是 topup_method）
      // payment_method 的值应该是支付方式配置中的 type 字段（如 "epay", "alipay", "wxpay"）
      const requestBody = {
        amount,
        payment_method: paymentType || 'epay',
      };

      Logger.info(
        `📡 [CreditService] 步骤2: 调用 /api/user/pay: ${payUrl}, effectiveUserId=${effectiveUserId}`
      );
      Logger.info(`📡 [CreditService] 请求体: ${JSON.stringify(requestBody)}`);

      const payResult = (await page.evaluate(
        async (
          url: string,
          body: { amount: number; payment_method: string },
          userIdHeader: string | undefined
        ) => {
          try {
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
              Accept: 'application/json, text/plain, */*',
            };
            // 添加 New-Api-User header（站点要求）
            if (userIdHeader) {
              headers['New-Api-User'] = userIdHeader;
            }
            const response = await fetch(url, {
              method: 'POST',
              credentials: 'include',
              headers,
              body: JSON.stringify(body),
            });
            const data = await response.json();
            return { success: response.ok, status: response.status, data };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
        payUrl,
        requestBody,
        effectiveUserId
      )) as { success: boolean; status?: number; data?: any; error?: string };

      Logger.info(
        `📡 [CreditService] /api/user/pay 响应: ${JSON.stringify(payResult).substring(0, 300)}`
      );

      // 检查响应
      if (!payResult.success || payResult.data?.message === 'error') {
        const errorMsg =
          payResult.data?.data || payResult.data?.message || payResult.error || '充值请求失败';
        return { success: false, error: typeof errorMsg === 'string' ? errorMsg : '充值请求失败' };
      }

      const data = payResult.data;

      // 验证响应数据
      if (!data || !data.url || !data.data || typeof data.data === 'string') {
        return { success: false, error: '充值响应数据格式异常' };
      }

      // 获取支付数据
      const paymentData = data.data;
      const submitUrl = data.url; // https://credit.linux.do/epay/pay/submit.php

      Logger.info(`🔗 [CreditService] 支付网关: ${submitUrl}`);
      Logger.info(
        `📦 [CreditService] 支付参数: pid=${paymentData.pid}, money=${paymentData.money}, name=${paymentData.name}`
      );

      // 根据 Linux Do Credit API 文档，需要用 POST 表单提交到 /pay/submit.php
      // 提交后会自动重定向到 /paying?order_no=... 页面
      // 在浏览器中创建一个表单并提交
      const formSubmitResult = await page.evaluate(
        (url: string, formData: any) => {
          try {
            // 创建一个隐藏的表单
            const form = (globalThis as any).document.createElement('form');
            form.method = 'POST';
            form.action = url;
            form.style.display = 'none';

            // 添加所有表单字段
            const fields = [
              'pid',
              'type',
              'out_trade_no',
              'notify_url',
              'return_url',
              'name',
              'money',
              'device',
              'sign',
              'sign_type',
            ];
            for (const field of fields) {
              if (formData[field] !== undefined && formData[field] !== null) {
                const input = (globalThis as any).document.createElement('input');
                input.type = 'hidden';
                input.name = field;
                input.value = String(formData[field]);
                form.appendChild(input);
              }
            }

            // 添加到页面并提交
            (globalThis as any).document.body.appendChild(form);
            form.submit();

            return { success: true };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
        submitUrl,
        paymentData
      );

      if (!formSubmitResult.success) {
        Logger.error(`❌ [CreditService] 表单提交失败: ${formSubmitResult.error}`);
        return { success: false, error: '支付表单提交失败' };
      }

      Logger.info('✅ [CreditService] 已提交支付表单，等待重定向到支付页面...');

      // 等待页面导航到支付页面
      try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        const currentUrl = page.url();
        Logger.info(`🔗 [CreditService] 当前页面: ${currentUrl}`);

        // 检查是否成功跳转到支付页面
        if (currentUrl.includes('credit.linux.do/paying')) {
          Logger.info('✅ [CreditService] 已跳转到 Linux Do Credit 支付页面');
          // 标记保持页面打开，让用户在浏览器中完成支付
          keepPageOpen = true;
          return { success: true, paymentUrl: currentUrl };
        } else {
          Logger.warn(`⚠️ [CreditService] 未能跳转到支付页面，当前: ${currentUrl}`);
        }
      } catch (navError: any) {
        Logger.warn(`⚠️ [CreditService] 等待导航超时: ${navError.message}`);
      }

      return { success: true, paymentUrl: submitUrl };
    } catch (error: any) {
      Logger.error('❌ [CreditService] 充值失败:', error.message);
      return { success: false, error: this.formatErrorMessage(error) };
    } finally {
      // 释放浏览器资源（除非需要保持页面打开）
      if (keepPageOpen) {
        Logger.info('📌 [CreditService] 保持支付页面打开，等待用户完成支付');
        // 不关闭页面，也不释放引用计数，让浏览器保持打开
        // 用户完成支付后可以手动关闭浏览器
      } else {
        if (page) {
          try {
            await page.close();
          } catch {
            // 忽略关闭错误
          }
        }
        if (release) {
          release();
        }
      }
    }
  }

  /**
   * 保存存储数据到文件
   */
  private async saveStorageData(): Promise<void> {
    const data: CreditStorageData = {
      config: this.config,
      cachedInfo: this.cachedInfo,
      cachedDailyStats: this.cachedDailyStats,
      cachedTransactions: this.cachedTransactions,
      cookies: this.cookies,
    };

    try {
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      Logger.error('❌ [CreditService] 保存数据失败:', error);
      throw error;
    }
  }

  /**
   * 从文件加载存储数据
   */
  private async loadStorageData(): Promise<void> {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf-8');
        const data: CreditStorageData = JSON.parse(raw);

        if (data.config) {
          this.config = fillCreditConfigDefaults(data.config);
        }
        if (data.cachedInfo) {
          this.cachedInfo = data.cachedInfo;
        }
        if (data.cachedDailyStats) {
          this.cachedDailyStats = data.cachedDailyStats;
        }
        if (data.cachedTransactions) {
          this.cachedTransactions = data.cachedTransactions;
        }
        if (data.cookies) {
          this.cookies = data.cookies;
        }

        Logger.info('📖 [CreditService] 已加载存储数据');
      }
    } catch (error) {
      Logger.warn('⚠️ [CreditService] 加载存储数据失败:', error);
      // 使用默认值
      this.config = { ...DEFAULT_CREDIT_CONFIG };
      this.cachedInfo = null;
      this.cachedDailyStats = null;
      this.cachedTransactions = null;
      this.cookies = null;
    }
  }

  /**
   * 格式化错误消息
   */
  private formatErrorMessage(error: any): string {
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return '网络请求超时，请检查网络连接';
    }
    if (error.response?.status === 401) {
      return '未登录，请先登录 Linux Do Credit';
    }
    if (error.response?.status === 403) {
      return '登录已过期，请重新登录';
    }
    if (error.response?.status >= 500) {
      return '服务器暂时不可用，请稍后重试';
    }
    if (error.message?.includes('JSON')) {
      return '数据格式异常，请稍后重试';
    }
    return error.message || '未知错误';
  }

  /**
   * 获取存储路径（用于测试）
   */
  getStoragePath(): string {
    return this.storagePath;
  }
}

// 单例实例
let creditServiceInstance: CreditService | null = null;

/**
 * 获取 CreditService 实例
 */
export function getCreditService(): CreditService | null {
  return creditServiceInstance;
}

/**
 * 创建 CreditService 实例
 */
export function createCreditService(chromeManager: ChromeManager): CreditService {
  creditServiceInstance = new CreditService(chromeManager);
  return creditServiceInstance;
}
