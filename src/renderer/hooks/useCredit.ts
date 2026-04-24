/**
 * 输入: IPC 调用 (credit:*), CreditInfo, CreditConfig
 * 输出: 积分状态管理, 自动刷新控制, 登录/登出操作
 * 定位: 业务逻辑层 - 管理 Linux Do Credit 积分检测功能
 *       登录时一次性获取所有数据（积分、每日统计、交易记录）并缓存
 *       初始化时从缓存加载数据，无需 lazy-loading
 *       refreshAll 方法在单个浏览器页面中刷新所有数据，避免打开多个浏览器窗口
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/hooks/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  CreditInfo,
  CreditConfig,
  CreditResponse,
  DailyStats,
  TransactionList,
  CreditLoginResult,
  RechargeRequest,
  RechargeResponse,
} from '../../shared/types/credit';
import { DEFAULT_CREDIT_CONFIG, clampRefreshInterval } from '../../shared/types/credit';
import { toast } from '../store/toastStore';

/**
 * useCredit Hook 返回值接口
 */
export interface UseCreditReturn {
  // 状态
  isLoggedIn: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  creditInfo: CreditInfo | null;
  config: CreditConfig;
  dailyStats: DailyStats | null;
  transactions: TransactionList | null;
  isLoadingStats: boolean;
  isLoadingTransactions: boolean;
  isRecharging: boolean;

  // 操作
  fetchCredit: () => Promise<void>;
  fetchDailyStats: (days?: number) => Promise<void>;
  fetchTransactions: (page?: number, pageSize?: number) => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  updateConfig: (config: Partial<CreditConfig>) => Promise<void>;
  refreshAll: () => Promise<void>;
  initiateRecharge: (
    siteUrl: string,
    amount: number,
    token: string,
    userId?: string,
    paymentType?: string
  ) => Promise<RechargeResponse>;
}

/**
 * Credit API 接口类型
 */
interface CreditAPI {
  fetch: () => Promise<CreditResponse<CreditInfo>>;
  fetchDailyStats: (days?: number) => Promise<CreditResponse<DailyStats>>;
  fetchTransactions: (page?: number, pageSize?: number) => Promise<CreditResponse<TransactionList>>;
  refreshAll: () => Promise<
    CreditResponse<{
      creditInfo: CreditInfo | null;
      dailyStats: DailyStats | null;
      transactions: TransactionList | null;
    }>
  >;
  login: () => Promise<CreditResponse<CreditLoginResult | void>>;
  logout: () => Promise<CreditResponse<void>>;
  getStatus: () => Promise<CreditResponse<boolean>>;
  saveConfig: (config: Partial<CreditConfig>) => Promise<CreditResponse<void>>;
  loadConfig: () => Promise<CreditResponse<CreditConfig>>;
  getCached: () => Promise<CreditResponse<CreditInfo | null>>;
  getCachedDailyStats: () => Promise<CreditResponse<DailyStats | null>>;
  getCachedTransactions: () => Promise<CreditResponse<TransactionList | null>>;
  initiateRecharge: (request: RechargeRequest) => Promise<CreditResponse<RechargeResponse>>;
}

/**
 * 获取 Credit API
 */
function getCreditAPI(): CreditAPI | undefined {
  return (window as any).electronAPI?.credit;
}

/**
 * Linux Do Credit 积分检测 Hook
 * 提供积分数据获取、登录管理、自动刷新等功能
 *
 * Requirements: 4.2, 5.1, 5.2, 5.4
 */
export function useCredit(): UseCreditReturn {
  // 状态
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [creditInfo, setCreditInfo] = useState<CreditInfo | null>(null);
  const [config, setConfig] = useState<CreditConfig>(DEFAULT_CREDIT_CONFIG);
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [transactions, setTransactions] = useState<TransactionList | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState<boolean>(false);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState<boolean>(false);
  const [isRecharging, setIsRecharging] = useState<boolean>(false);

  // 自动刷新定时器引用
  const autoRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  // 页面可见性状态
  const isVisibleRef = useRef<boolean>(true);
  // 是否已初始化
  const isInitializedRef = useRef<boolean>(false);

  /**
   * 清除自动刷新定时器
   */
  const clearAutoRefreshTimer = useCallback(() => {
    if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }
  }, []);

  /**
   * 获取积分数据
   */
  const fetchCredit = useCallback(async () => {
    const creditAPI = getCreditAPI();
    if (!creditAPI) {
      setError('IPC 接口未初始化');
      return;
    }

    setIsRefreshing(true);
    setError(null);

    try {
      const response = await creditAPI.fetch();

      if (response.success && response.data) {
        setCreditInfo(response.data);
        setIsLoggedIn(true);
      } else {
        setError(response.error || '获取积分数据失败');
        // 如果是认证错误，更新登录状态
        if (
          response.error?.includes('未登录') ||
          response.error?.includes('过期') ||
          response.error?.includes('重新登录')
        ) {
          setIsLoggedIn(false);
        }
      }
    } catch (err: any) {
      const errorMessage = err?.message || '获取积分数据失败';
      setError(errorMessage);
      console.error('[useCredit] 获取积分数据失败:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  /**
   * 获取每日统计数据
   * Requirements: 9.1-9.10
   */
  const fetchDailyStats = useCallback(async (days: number = 7) => {
    const creditAPI = getCreditAPI();
    if (!creditAPI) {
      setError('IPC 接口未初始化');
      return;
    }

    setIsLoadingStats(true);

    try {
      const response = await creditAPI.fetchDailyStats(days);

      if (response.success && response.data) {
        setDailyStats(response.data);
      } else {
        console.error('[useCredit] 获取每日统计数据失败:', response.error);
        // 不设置全局 error，避免影响主面板显示
      }
    } catch (err: any) {
      console.error('[useCredit] 获取每日统计数据失败:', err);
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  /**
   * 获取交易记录
   * Requirements: 10.1-10.10
   */
  const fetchTransactions = useCallback(async (page: number = 1, pageSize: number = 10) => {
    const creditAPI = getCreditAPI();
    if (!creditAPI) {
      setError('IPC 接口未初始化');
      return;
    }

    setIsLoadingTransactions(true);

    try {
      const response = await creditAPI.fetchTransactions(page, pageSize);

      if (response.success && response.data) {
        setTransactions(response.data);
      } else {
        console.error('[useCredit] 获取交易记录失败:', response.error);
        // 不设置全局 error，避免影响主面板显示
      }
    } catch (err: any) {
      console.error('[useCredit] 获取交易记录失败:', err);
    } finally {
      setIsLoadingTransactions(false);
    }
  }, []);

  /**
   * 启动登录
   * 登录成功后后端会直接返回所有数据（积分、每日统计、交易记录）
   */
  const login = useCallback(async () => {
    const creditAPI = getCreditAPI();
    if (!creditAPI) {
      const message = 'IPC 接口未初始化';
      setError(message);
      throw new Error(message);
    }

    setIsLoading(true);
    setError(null);

    // 提示用户在浏览器中完成登录
    toast.info('请在弹出的浏览器窗口中完成 Linux Do 登录', 10000);

    try {
      const response = await creditAPI.login();

      if (response.success) {
        setIsLoggedIn(true);
        // 登录响应中包含完整数据
        if (response.data && 'creditInfo' in response.data) {
          const loginResult = response.data as CreditLoginResult;
          setCreditInfo(loginResult.creditInfo);
          if (loginResult.dailyStats) {
            setDailyStats(loginResult.dailyStats);
          }
          if (loginResult.transactions) {
            setTransactions(loginResult.transactions);
          }
        } else if (response.data && 'username' in response.data) {
          // 兼容旧版本：只返回 CreditInfo
          setCreditInfo(response.data as CreditInfo);
          // 使用 refreshAll 在单个浏览器页面中获取统计和交易数据
          const refreshResponse = await creditAPI.refreshAll();
          if (refreshResponse.success && refreshResponse.data) {
            if (refreshResponse.data.dailyStats) {
              setDailyStats(refreshResponse.data.dailyStats);
            }
            if (refreshResponse.data.transactions) {
              setTransactions(refreshResponse.data.transactions);
            }
          }
        } else {
          // 兼容更旧版本：登录成功后使用 refreshAll 获取所有数据
          const refreshResponse = await creditAPI.refreshAll();
          if (refreshResponse.success && refreshResponse.data) {
            if (refreshResponse.data.creditInfo) {
              setCreditInfo(refreshResponse.data.creditInfo);
            }
            if (refreshResponse.data.dailyStats) {
              setDailyStats(refreshResponse.data.dailyStats);
            }
            if (refreshResponse.data.transactions) {
              setTransactions(refreshResponse.data.transactions);
            }
          }
        }
      } else {
        const message = response.error || '登录失败';
        setError(message);
        throw new Error(message);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '登录失败';
      setError(errorMessage);
      console.error('[useCredit] 登录失败:', err);
      throw err instanceof Error ? err : new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * 登出
   */
  const logout = useCallback(async () => {
    const creditAPI = getCreditAPI();
    if (!creditAPI) {
      const message = 'IPC 接口未初始化';
      setError(message);
      throw new Error(message);
    }

    try {
      const response = await creditAPI.logout();

      if (response.success) {
        setIsLoggedIn(false);
        setCreditInfo(null);
        setDailyStats(null);
        setTransactions(null);
        clearAutoRefreshTimer();
      } else {
        const message = response.error || '登出失败';
        setError(message);
        throw new Error(message);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '登出失败';
      setError(errorMessage);
      console.error('[useCredit] 登出失败:', err);
      throw err instanceof Error ? err : new Error(errorMessage);
    }
  }, [clearAutoRefreshTimer]);

  /**
   * 更新配置
   */
  const updateConfig = useCallback(
    async (newConfig: Partial<CreditConfig>) => {
      const creditAPI = getCreditAPI();
      if (!creditAPI) {
        setError('IPC 接口未初始化');
        return;
      }

      // 合并配置，确保刷新间隔不小于最小值
      const mergedConfig: CreditConfig = {
        ...config,
        ...newConfig,
        refreshInterval: clampRefreshInterval(newConfig.refreshInterval ?? config.refreshInterval),
      };

      setConfig(mergedConfig);

      try {
        await creditAPI.saveConfig(mergedConfig);
      } catch (err: any) {
        console.error('[useCredit] 保存配置失败:', err);
      }
    },
    [config]
  );

  /**
   * 刷新所有 LDC 数据（积分、每日统计、交易记录）
   * 在单个浏览器页面中完成所有数据获取，避免打开多个浏览器窗口
   */
  const refreshAll = useCallback(async () => {
    const creditAPI = getCreditAPI();
    if (!creditAPI) {
      const message = 'IPC 接口未初始化';
      setError(message);
      throw new Error(message);
    }

    setIsRefreshing(true);
    setError(null);

    try {
      const response = await creditAPI.refreshAll();

      if (response.success && response.data) {
        if (response.data.creditInfo) {
          setCreditInfo(response.data.creditInfo);
        }
        if (response.data.dailyStats) {
          setDailyStats(response.data.dailyStats);
        }
        if (response.data.transactions) {
          setTransactions(response.data.transactions);
        }
        setIsLoggedIn(true);
      } else {
        const message = response.error || '刷新数据失败';
        setError(message);
        // 如果是认证错误，更新登录状态
        if (
          response.error?.includes('未登录') ||
          response.error?.includes('过期') ||
          response.error?.includes('重新登录')
        ) {
          setIsLoggedIn(false);
        }
        throw new Error(message);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '刷新数据失败';
      setError(errorMessage);
      console.error('[useCredit] 刷新所有数据失败:', err);
      throw err instanceof Error ? err : new Error(errorMessage);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  /**
   * 发起充值
   * 调用站点 API 获取支付 URL 并在浏览器中打开
   * Requirements: 18.6, 18.12
   */
  const initiateRecharge = useCallback(
    async (
      siteUrl: string,
      amount: number,
      token: string,
      userId?: string,
      paymentType?: string
    ): Promise<RechargeResponse> => {
      const creditAPI = getCreditAPI();
      if (!creditAPI) {
        return { success: false, error: 'IPC 接口未初始化' };
      }

      setIsRecharging(true);

      try {
        const response = await creditAPI.initiateRecharge({
          siteUrl,
          amount,
          token,
          userId,
          paymentType,
        });

        if (response.success && response.data) {
          return response.data;
        } else {
          return { success: false, error: response.error || '充值失败' };
        }
      } catch (err: any) {
        const errorMessage = err?.message || '充值失败';
        console.error('[useCredit] 充值失败:', err);
        return { success: false, error: errorMessage };
      } finally {
        setIsRecharging(false);
      }
    },
    []
  );

  /**
   * 启动自动刷新定时器
   */
  const startAutoRefreshTimer = useCallback(() => {
    clearAutoRefreshTimer();

    if (!config.autoRefresh || !isLoggedIn || !isVisibleRef.current) {
      return;
    }

    const intervalMs = clampRefreshInterval(config.refreshInterval) * 60 * 1000; // 分钟转毫秒

    autoRefreshTimerRef.current = setInterval(() => {
      // 仅在页面可见且已登录时刷新
      if (isVisibleRef.current && isLoggedIn) {
        fetchCredit();
      }
    }, intervalMs);
  }, [config.autoRefresh, config.refreshInterval, isLoggedIn, fetchCredit, clearAutoRefreshTimer]);

  /**
   * 初始化：加载配置、缓存数据和登录状态
   */
  useEffect(() => {
    const initialize = async () => {
      const creditAPI = getCreditAPI();
      if (!creditAPI || isInitializedRef.current) {
        setIsLoading(false);
        return;
      }

      isInitializedRef.current = true;

      try {
        let hasCachedData = false;

        // 加载配置
        const configResponse = await creditAPI.loadConfig();
        if (configResponse.success && configResponse.data) {
          setConfig(configResponse.data);
        }

        // 加载缓存的积分数据
        const cachedResponse = await creditAPI.getCached();
        if (cachedResponse.success && cachedResponse.data) {
          setCreditInfo(cachedResponse.data);
          hasCachedData = true;
        }

        // 加载缓存的每日统计数据
        const cachedStatsResponse = await creditAPI.getCachedDailyStats();
        if (cachedStatsResponse.success && cachedStatsResponse.data) {
          setDailyStats(cachedStatsResponse.data);
          hasCachedData = true;
        }

        // 加载缓存的交易记录
        const cachedTransactionsResponse = await creditAPI.getCachedTransactions();
        if (cachedTransactionsResponse.success && cachedTransactionsResponse.data) {
          setTransactions(cachedTransactionsResponse.data);
          hasCachedData = true;
        }

        if (hasCachedData) {
          setIsLoggedIn(true);
        }

        // 检查登录状态
        const statusResponse = await creditAPI.getStatus();
        if (statusResponse.success && statusResponse.data !== undefined) {
          setIsLoggedIn(statusResponse.data);
        }
      } catch (err) {
        console.error('[useCredit] 初始化失败:', err);
      } finally {
        setIsLoading(false);
      }
    };

    initialize();
  }, []);

  /**
   * 监听配置变化，管理自动刷新定时器
   */
  useEffect(() => {
    startAutoRefreshTimer();

    return () => {
      clearAutoRefreshTimer();
    };
  }, [startAutoRefreshTimer, clearAutoRefreshTimer]);

  /**
   * 监听页面可见性变化
   * Property 9: Auto-refresh Pauses When Hidden
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === 'visible';
      isVisibleRef.current = isVisible;

      if (isVisible) {
        // 页面变为可见，恢复自动刷新
        startAutoRefreshTimer();
      } else {
        // 页面隐藏，暂停自动刷新
        clearAutoRefreshTimer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startAutoRefreshTimer, clearAutoRefreshTimer]);

  return {
    isLoggedIn,
    isLoading,
    isRefreshing,
    error,
    creditInfo,
    config,
    dailyStats,
    transactions,
    isLoadingStats,
    isLoadingTransactions,
    isRecharging,
    fetchCredit,
    fetchDailyStats,
    fetchTransactions,
    refreshAll,
    login,
    logout,
    updateConfig,
    initiateRecharge,
  };
}
