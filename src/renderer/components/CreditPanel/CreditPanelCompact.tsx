/**
 * 输入: useCredit Hook (积分状态、操作方法)
 * 输出: React 组件 (紧凑版 Linux Do Credit 积分面板 UI)
 * 定位: 展示层 - 在表头区域显示 Linux Do Credit 积分信息，支持展开详情
 */

import { useState, useRef, useEffect } from 'react';
import {
  Coins,
  RefreshCw,
  LogIn,
  LogOut,
  Loader2,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Shield,
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useCredit } from '../../hooks/useCredit';
import { toast } from '../../store/toastStore';
import { getDifferenceColorType, MIN_REFRESH_INTERVAL } from '../../../shared/types/credit';
import { IncomeStatsCard } from './IncomeStatsCard';
import { ExpenseStatsCard } from './ExpenseStatsCard';
import { TransactionListCard } from './TransactionListCard';
import { RechargeSection, type LdcSiteInfo } from './RechargeSection';

export interface CreditPanelCompactProps {
  className?: string;
  /** 支持 LDC 支付的站点列表 (从外部传入) */
  ldcSites?: LdcSiteInfo[];
}

function getDifferenceColorClass(difference: number): string {
  const colorType = getDifferenceColorType(difference);
  switch (colorType) {
    case 'positive':
      return 'text-green-600 dark:text-green-400';
    case 'negative':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-gray-500 dark:text-gray-400';
  }
}

export { getDifferenceColorClass };

function getDifferenceIcon(difference: number) {
  const colorType = getDifferenceColorType(difference);
  const iconClass = 'w-3 h-3';
  switch (colorType) {
    case 'positive':
      return <TrendingUp className={`${iconClass} text-green-600 dark:text-green-400`} />;
    case 'negative':
      return <TrendingDown className={`${iconClass} text-red-600 dark:text-red-400`} />;
    default:
      return <Minus className={`${iconClass} text-gray-500 dark:text-gray-400`} />;
  }
}

function formatLastUpdated(timestamp: number): string {
  if (!timestamp) return '从未更新';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTrustLevelText(level: number): string {
  const levels: Record<number, string> = {
    0: '新用户',
    1: '基本用户',
    2: '成员',
    3: '活跃用户',
    4: '领导者',
  };
  return levels[level] || `等级 ${level}`;
}

function getTrustLevelColorClass(level: number): string {
  if (level >= 4) return 'text-purple-600 dark:text-purple-400';
  if (level >= 3) return 'text-blue-600 dark:text-blue-400';
  if (level >= 2) return 'text-green-600 dark:text-green-400';
  return 'text-gray-600 dark:text-gray-400';
}

export function CreditPanelCompact({ className = '', ldcSites = [] }: CreditPanelCompactProps) {
  const {
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
    login,
    logout,
    updateConfig,
    initiateRecharge,
  } = useCredit();

  const [isExpanded, setIsExpanded] = useState(false);
  const [intervalInput, setIntervalInput] = useState(String(config.refreshInterval));
  const panelRef = useRef<HTMLDivElement>(null);

  // 同步 config.refreshInterval 到本地输入状态
  useEffect(() => {
    setIntervalInput(String(config.refreshInterval));
  }, [config.refreshInterval]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };
    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExpanded]);

  const handleRefresh = async () => {
    try {
      await fetchCredit();
      toast.success('积分数据已刷新');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '刷新失败';
      toast.error(message);
    }
  };

  const handleLogin = async () => {
    try {
      await login();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '登录失败';
      toast.error(message);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('已登出');
      setIsExpanded(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '登出失败';
      toast.error(message);
    }
  };

  const handleAutoRefreshToggle = async () => {
    await updateConfig({ autoRefresh: !config.autoRefresh });
  };

  const handleIntervalChange = (value: string) => {
    setIntervalInput(value);
  };

  const handleIntervalBlur = async () => {
    const interval = parseInt(intervalInput, 10);
    if (!isNaN(interval)) {
      await updateConfig({ refreshInterval: interval });
      setIntervalInput(String(Math.max(MIN_REFRESH_INTERVAL, interval)));
    } else {
      setIntervalInput(String(config.refreshInterval));
    }
  };

  const handleRefreshDailyStats = () => {
    fetchDailyStats();
  };

  const handleRefreshTransactions = () => {
    fetchTransactions();
  };

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
        <span className="text-xs text-slate-500">加载中...</span>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Coins className="w-4 h-4 text-primary-500" />
        <span className="text-xs text-slate-500">Linux Do Credit</span>
        <button
          onClick={handleLogin}
          disabled={isLoading}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 text-white rounded transition-colors disabled:cursor-not-allowed"
        >
          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogIn className="w-3 h-3" />}
          登录
        </button>
      </div>
    );
  }

  return (
    <div ref={panelRef} className={`relative ${className}`}>
      {/* 紧凑视图：只显示今日积分变化 (Requirements: 16.1) */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Coins className="w-4 h-4 text-primary-500" />
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            {creditInfo?.nickname || creditInfo?.username || 'Credit'}
          </span>
        </div>
        {creditInfo && (
          <div className="flex items-center gap-2 text-xs">
            {/* 只显示今日积分变化 */}
            <span className="text-slate-500 dark:text-slate-400">今日积分变化:</span>
            <div
              className={`flex items-center gap-0.5 font-medium ${getDifferenceColorClass(creditInfo.difference)}`}
            >
              {getDifferenceIcon(creditInfo.difference)}
              <span>
                {creditInfo.difference > 0 ? '+' : ''}
                {creditInfo.difference.toLocaleString()}
              </span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors ${isExpanded ? 'bg-slate-200 dark:bg-slate-600' : ''}`}
            title={isExpanded ? '收起详情' : '展开详情'}
          >
            {isExpanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            )}
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
            title="刷新积分"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-slate-500 hover:text-blue-500 ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="fixed top-16 right-4 z-[9999] w-[800px] max-w-[calc(100vw-2rem)] p-4 bg-white dark:bg-slate-800 rounded-lg shadow-2xl border border-slate-200 dark:border-slate-600">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200 dark:border-slate-600">
            <div className="flex items-center gap-2">
              <Coins className="w-5 h-5 text-primary-500" />
              <div className="flex flex-col">
                <span className="font-medium text-slate-800 dark:text-slate-200 text-sm">
                  {creditInfo?.nickname || 'Linux Do Credit'}
                </span>
                {creditInfo?.username && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    @{creditInfo.username}
                  </span>
                )}
              </div>
              {creditInfo && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 ${getTrustLevelColorClass(creditInfo.trustLevel)}`}
                >
                  <Shield className="w-3 h-3 inline mr-0.5" />
                  {getTrustLevelText(creditInfo.trustLevel)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:cursor-not-allowed"
                title="刷新"
              >
                <RefreshCw
                  className={`w-4 h-4 text-slate-500 dark:text-slate-400 ${isRefreshing ? 'animate-spin' : ''}`}
                />
              </button>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                title="登出"
              >
                <LogOut className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
          </div>

          {creditInfo ? (
            <div className="space-y-3">
              {/* 积分信息区：两组分类显示在同一行 (Requirements: 16.2, 16.3) */}
              <div className="grid grid-cols-2 gap-4 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                {/* Linux Do 社区积分 */}
                <div className="space-y-1">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                    Linux Do 社区积分
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-500 dark:text-slate-400">基准值:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {creditInfo.communityBalance.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-500 dark:text-slate-400">当前分:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {creditInfo.gamificationScore.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-500 dark:text-slate-400">今日积分变化:</span>
                      <span
                        className={`font-semibold flex items-center gap-0.5 ${getDifferenceColorClass(creditInfo.difference)}`}
                      >
                        {getDifferenceIcon(creditInfo.difference)}
                        {creditInfo.difference > 0 ? '+' : ''}
                        {creditInfo.difference.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
                {/* Linux Do Credit 积分 */}
                <div className="space-y-1 border-l border-slate-200 dark:border-slate-600 pl-4">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                    Linux Do Credit 积分
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1">
                      <ArrowDownCircle className="w-3.5 h-3.5 text-green-500" />
                      <span className="text-slate-500 dark:text-slate-400">收入:</span>
                      <span className="font-semibold text-green-600 dark:text-green-400">
                        {creditInfo.totalReceive}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ArrowUpCircle className="w-3.5 h-3.5 text-red-500" />
                      <span className="text-slate-500 dark:text-slate-400">支出:</span>
                      <span className="font-semibold text-red-600 dark:text-red-400">
                        {creditInfo.totalPayment}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Wallet className="w-3.5 h-3.5 text-primary-500" />
                      <span className="text-slate-500 dark:text-slate-400">可用:</span>
                      <span className="font-semibold text-primary-600 dark:text-primary-400">
                        {creditInfo.availableBalance}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 统计卡片区：三栏布局 */}
              <div className="grid grid-cols-3 gap-3">
                <TransactionListCard
                  transactions={transactions}
                  isLoading={isLoadingTransactions}
                  onRefresh={handleRefreshTransactions}
                />
                <IncomeStatsCard
                  dailyStats={dailyStats}
                  isLoading={isLoadingStats}
                  onRefresh={handleRefreshDailyStats}
                />
                <ExpenseStatsCard
                  dailyStats={dailyStats}
                  isLoading={isLoadingStats}
                  onRefresh={handleRefreshDailyStats}
                />
              </div>

              {/* 支付信息区：带分隔符的单行 (Requirements: 16.5) */}
              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg text-sm">
                <div className="flex items-center gap-1">
                  <span className="text-slate-500 dark:text-slate-400">支付评分</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 ml-1">
                    {creditInfo.payScore}
                  </span>
                </div>
                <div className="w-px h-4 bg-slate-300 dark:bg-slate-500" />
                <div className="flex items-center gap-1">
                  <span className="text-slate-500 dark:text-slate-400">支付等级</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 ml-1">
                    Lv.{creditInfo.payLevel}
                  </span>
                </div>
                <div className="w-px h-4 bg-slate-300 dark:bg-slate-500" />
                <div className="flex items-center gap-1">
                  <span className="text-slate-500 dark:text-slate-400">剩余配额</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 ml-1">
                    {creditInfo.remainQuota}
                  </span>
                </div>
                <div className="w-px h-4 bg-slate-300 dark:bg-slate-500" />
                <div className="flex items-center gap-1">
                  <span className="text-slate-500 dark:text-slate-400">每日限额</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 ml-1">
                    {creditInfo.dailyLimit}
                  </span>
                </div>
              </div>

              {/* LDC 充值区域 (Requirements: 18.1-18.15) */}
              <RechargeSection
                ldcSites={ldcSites}
                availableBalance={parseFloat(creditInfo.availableBalance) || 0}
                isRecharging={isRecharging}
                onRecharge={initiateRecharge}
              />

              {/* 底部：更新时间和自动刷新设置 */}
              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200 dark:border-slate-600">
                <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                  <Clock className="w-3 h-3" />
                  <span>更新于 {formatLastUpdated(creditInfo.lastUpdated)}</span>
                </div>
                {/* 自动刷新设置 */}
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 dark:text-slate-400">自动刷新</span>
                  <button
                    onClick={handleAutoRefreshToggle}
                    className={`relative w-8 h-4 rounded-full transition-colors ${
                      config.autoRefresh ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                        config.autoRefresh ? 'translate-x-4' : ''
                      }`}
                    />
                  </button>
                  {config.autoRefresh && (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={MIN_REFRESH_INTERVAL}
                        value={intervalInput}
                        onChange={e => handleIntervalChange(e.target.value)}
                        onBlur={handleIntervalBlur}
                        className="w-12 px-1 py-0.5 text-xs text-right bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded focus:border-primary-500 outline-none text-slate-700 dark:text-slate-300"
                      />
                      <span className="text-slate-500 dark:text-slate-400">分钟</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-4 text-sm text-slate-500 dark:text-slate-400">
              暂无数据，点击刷新获取
            </div>
          )}

          {error && <p className="text-xs text-red-500 dark:text-red-400 mt-2">{error}</p>}
        </div>
      )}
    </div>
  );
}
