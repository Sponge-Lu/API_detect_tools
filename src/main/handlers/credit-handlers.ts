/**
 * 输入: CreditService (积分服务)
 * 输出: IPC 事件处理响应 (CreditResponse)
 * 定位: IPC 处理层 - 处理 Linux Do Credit 积分检测相关的 IPC 通信
 *       支持获取缓存的每日统计和交易记录数据
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/handlers/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { ipcMain } from 'electron';
import Logger from '../utils/logger';
import { getCreditService } from '../credit-service';
import {
  CREDIT_CHANNELS,
  type CreditConfig,
  type CreditResponse,
  type DailyStats,
  type TransactionList,
  type CreditLoginResult,
  type RechargeRequest,
  type RechargeResponse,
} from '../../shared/types/credit';

/**
 * 创建统一的成功响应
 */
function createSuccessResponse<T>(data?: T): CreditResponse<T> {
  return data !== undefined ? { success: true, data } : { success: true };
}

/**
 * 创建统一的错误响应
 */
function createErrorResponse<T = unknown>(error: string): CreditResponse<T> {
  return { success: false, error };
}

/**
 * 注册 Credit 相关 IPC 处理器
 */
export function registerCreditHandlers(): void {
  // 获取积分数据
  ipcMain.handle(CREDIT_CHANNELS.FETCH_CREDIT, async (): Promise<CreditResponse> => {
    try {
      Logger.info('📡 [CreditHandlers] 收到获取积分数据请求');
      const creditService = getCreditService();

      if (!creditService) {
        return createErrorResponse('CreditService 未初始化');
      }

      const result = await creditService.fetchCreditData();
      return result;
    } catch (error: any) {
      Logger.error('❌ [CreditHandlers] 获取积分数据失败:', error);
      return createErrorResponse(error.message || '获取积分数据失败');
    }
  });

  // 启动登录
  ipcMain.handle(CREDIT_CHANNELS.LOGIN, async (): Promise<CreditResponse<CreditLoginResult>> => {
    try {
      Logger.info('🔐 [CreditHandlers] 收到登录请求');
      const creditService = getCreditService();

      if (!creditService) {
        return createErrorResponse<CreditLoginResult>('CreditService 未初始化');
      }

      const result = await creditService.launchLogin();
      return result as CreditResponse<CreditLoginResult>;
    } catch (error: any) {
      Logger.error('❌ [CreditHandlers] 登录失败:', error);
      return createErrorResponse<CreditLoginResult>(error.message || '登录失败');
    }
  });

  // 登出
  ipcMain.handle(CREDIT_CHANNELS.LOGOUT, async (): Promise<CreditResponse> => {
    try {
      Logger.info('🚪 [CreditHandlers] 收到登出请求');
      const creditService = getCreditService();

      if (!creditService) {
        return createErrorResponse('CreditService 未初始化');
      }

      await creditService.logout();
      return createSuccessResponse();
    } catch (error: any) {
      Logger.error('❌ [CreditHandlers] 登出失败:', error);
      return createErrorResponse(error.message || '登出失败');
    }
  });

  // 获取登录状态
  ipcMain.handle(CREDIT_CHANNELS.GET_STATUS, async (): Promise<CreditResponse<boolean>> => {
    try {
      Logger.info('🔍 [CreditHandlers] 收到获取登录状态请求');
      const creditService = getCreditService();

      if (!creditService) {
        return createErrorResponse<boolean>('CreditService 未初始化');
      }

      const isLoggedIn = await creditService.getLoginStatus();
      return createSuccessResponse(isLoggedIn);
    } catch (error: any) {
      Logger.error('❌ [CreditHandlers] 获取登录状态失败:', error);
      return createErrorResponse<boolean>(error.message || '获取登录状态失败');
    }
  });

  // 保存配置
  ipcMain.handle(
    CREDIT_CHANNELS.SAVE_CONFIG,
    async (_, config: Partial<CreditConfig>): Promise<CreditResponse> => {
      try {
        Logger.info('💾 [CreditHandlers] 收到保存配置请求');
        const creditService = getCreditService();

        if (!creditService) {
          return createErrorResponse('CreditService 未初始化');
        }

        await creditService.saveConfig(config);
        return createSuccessResponse();
      } catch (error: any) {
        Logger.error('❌ [CreditHandlers] 保存配置失败:', error);
        return createErrorResponse(error.message || '保存配置失败');
      }
    }
  );

  // 加载配置
  ipcMain.handle(CREDIT_CHANNELS.LOAD_CONFIG, async (): Promise<CreditResponse<CreditConfig>> => {
    try {
      Logger.info('📖 [CreditHandlers] 收到加载配置请求');
      const creditService = getCreditService();

      if (!creditService) {
        return createErrorResponse<CreditConfig>('CreditService 未初始化');
      }

      const config = await creditService.loadConfig();
      return createSuccessResponse(config);
    } catch (error: any) {
      Logger.error('❌ [CreditHandlers] 加载配置失败:', error);
      return createErrorResponse<CreditConfig>(error.message || '加载配置失败');
    }
  });

  // 获取缓存数据
  ipcMain.handle(CREDIT_CHANNELS.GET_CACHED, async (): Promise<CreditResponse> => {
    try {
      Logger.info('📦 [CreditHandlers] 收到获取缓存数据请求');
      const creditService = getCreditService();

      if (!creditService) {
        return createErrorResponse('CreditService 未初始化');
      }

      const cachedInfo = await creditService.getCachedCreditInfo();
      return createSuccessResponse(cachedInfo);
    } catch (error: any) {
      Logger.error('❌ [CreditHandlers] 获取缓存数据失败:', error);
      return createErrorResponse(error.message || '获取缓存数据失败');
    }
  });

  // 获取每日统计数据
  ipcMain.handle(
    CREDIT_CHANNELS.FETCH_DAILY_STATS,
    async (_, days?: number): Promise<CreditResponse<DailyStats>> => {
      try {
        Logger.info(`📊 [CreditHandlers] 收到获取每日统计数据请求 (${days || 7} 天)`);
        const creditService = getCreditService();

        if (!creditService) {
          return createErrorResponse<DailyStats>('CreditService 未初始化');
        }

        const result = await creditService.fetchDailyStats(days);
        return result;
      } catch (error: any) {
        Logger.error('❌ [CreditHandlers] 获取每日统计数据失败:', error);
        return createErrorResponse<DailyStats>(error.message || '获取每日统计数据失败');
      }
    }
  );

  // 获取交易记录
  ipcMain.handle(
    CREDIT_CHANNELS.FETCH_TRANSACTIONS,
    async (_, page?: number, pageSize?: number): Promise<CreditResponse<TransactionList>> => {
      try {
        Logger.info(
          `📋 [CreditHandlers] 收到获取交易记录请求 (页码: ${page || 1}, 每页: ${pageSize || 10})`
        );
        const creditService = getCreditService();

        if (!creditService) {
          return createErrorResponse<TransactionList>('CreditService 未初始化');
        }

        const result = await creditService.fetchTransactions(page, pageSize);
        return result;
      } catch (error: any) {
        Logger.error('❌ [CreditHandlers] 获取交易记录失败:', error);
        return createErrorResponse<TransactionList>(error.message || '获取交易记录失败');
      }
    }
  );

  // 获取缓存的每日统计数据
  ipcMain.handle(
    CREDIT_CHANNELS.GET_CACHED_DAILY_STATS,
    async (): Promise<CreditResponse<DailyStats | null>> => {
      try {
        Logger.info('📦 [CreditHandlers] 收到获取缓存每日统计数据请求');
        const creditService = getCreditService();

        if (!creditService) {
          return createErrorResponse<DailyStats | null>('CreditService 未初始化');
        }

        const cachedStats = await creditService.getCachedDailyStats();
        return createSuccessResponse(cachedStats);
      } catch (error: any) {
        Logger.error('❌ [CreditHandlers] 获取缓存每日统计数据失败:', error);
        return createErrorResponse<DailyStats | null>(error.message || '获取缓存每日统计数据失败');
      }
    }
  );

  // 获取缓存的交易记录
  ipcMain.handle(
    CREDIT_CHANNELS.GET_CACHED_TRANSACTIONS,
    async (): Promise<CreditResponse<TransactionList | null>> => {
      try {
        Logger.info('📦 [CreditHandlers] 收到获取缓存交易记录请求');
        const creditService = getCreditService();

        if (!creditService) {
          return createErrorResponse<TransactionList | null>('CreditService 未初始化');
        }

        const cachedTransactions = await creditService.getCachedTransactions();
        return createSuccessResponse(cachedTransactions);
      } catch (error: any) {
        Logger.error('❌ [CreditHandlers] 获取缓存交易记录失败:', error);
        return createErrorResponse<TransactionList | null>(error.message || '获取缓存交易记录失败');
      }
    }
  );

  // 发起充值
  ipcMain.handle(
    CREDIT_CHANNELS.INITIATE_RECHARGE,
    async (_, request: RechargeRequest): Promise<CreditResponse<RechargeResponse>> => {
      try {
        Logger.info(
          `💰 [CreditHandlers] 收到充值请求: 站点=${request.siteUrl}, 金额=${request.amount}, userId=${request.userId || '未提供'}`
        );
        const creditService = getCreditService();

        if (!creditService) {
          return createErrorResponse<RechargeResponse>('CreditService 未初始化');
        }

        // 验证请求参数
        if (!request.siteUrl || !request.amount || !request.token) {
          return createErrorResponse<RechargeResponse>('缺少必要参数: siteUrl, amount, token');
        }

        const result = await creditService.initiateRecharge(
          request.siteUrl,
          request.amount,
          request.token,
          request.userId,
          request.paymentType
        );
        return createSuccessResponse(result);
      } catch (error: any) {
        Logger.error('❌ [CreditHandlers] 充值失败:', error);
        return createErrorResponse<RechargeResponse>(error.message || '充值失败');
      }
    }
  );

  Logger.info('✅ [CreditHandlers] Credit IPC 处理器已注册');
}
