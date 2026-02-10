/**
 * Linux Do Credit 独立页面
 * 基于 CreditPanelCompact 的展开内容改造为全页面布局
 */

import { useState, useEffect } from 'react';
import {
  Coins,
  RefreshCw,
  LogIn,
  LogOut,
  Loader2,
  Clock,
  Shield,
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
} from 'lucide-react';
// Coins still used in the not-logged-in state
import { useCredit } from '../hooks/useCredit';
import { useLdcSites } from '../hooks/useLdcSites';
import { toast } from '../store/toastStore';
import { MIN_REFRESH_INTERVAL } from '../../shared/types/credit';
import { IncomeStatsCard } from '../components/CreditPanel/IncomeStatsCard';
import { ExpenseStatsCard } from '../components/CreditPanel/ExpenseStatsCard';
import { TransactionListCard } from '../components/CreditPanel/TransactionListCard';
import { RechargeSection } from '../components/CreditPanel/RechargeSection';

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

export function CreditPage() {
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
    fetchDailyStats,
    fetchTransactions,
    refreshAll,
    login,
    logout,
    updateConfig,
    initiateRecharge,
  } = useCredit();

  const ldcSites = useLdcSites();

  const [intervalInput, setIntervalInput] = useState(String(config.refreshInterval));

  useEffect(() => {
    setIntervalInput(String(config.refreshInterval));
  }, [config.refreshInterval]);

  const handleRefresh = async () => {
    try {
      await refreshAll();
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

  // 加载中状态
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  // 未登录状态
  if (!isLoggedIn) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Coins className="w-16 h-16 mx-auto text-primary-300 dark:text-primary-700" />
          <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-300">
            Linux Do Credit
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            登录后查看积分信息、收支统计和交易记录
          </p>
          <button
            onClick={handleLogin}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 text-white rounded-lg transition-colors disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            登录 Linux Do
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-3">
      <div className="max-w-6xl mx-auto space-y-4">
        {/* 用户信息头部 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="font-semibold text-light-text dark:text-dark-text">
                {creditInfo?.nickname || 'Linux Do Credit'}
              </span>
              {creditInfo?.username && (
                <span className="text-xs text-light-text-secondary dark:text-dark-text-secondary">
                  @{creditInfo.username}
                </span>
              )}
            </div>
            {creditInfo && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full bg-light-bg dark:bg-dark-bg ${getTrustLevelColorClass(creditInfo.trustLevel)}`}
              >
                <Shield className="w-3 h-3 inline mr-0.5" />
                {getTrustLevelText(creditInfo.trustLevel)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {creditInfo && (
              <div className="flex items-center gap-1.5 text-xs text-light-text-secondary dark:text-dark-text-secondary mr-2">
                <Clock className="w-3.5 h-3.5" />
                <span>{formatLastUpdated(creditInfo.lastUpdated)}</span>
              </div>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-2 rounded-lg hover:bg-light-bg dark:hover:bg-dark-bg transition-colors disabled:cursor-not-allowed"
              title="刷新"
            >
              <RefreshCw
                className={`w-4 h-4 text-light-text-secondary dark:text-dark-text-secondary ${isRefreshing ? 'animate-spin' : ''}`}
              />
            </button>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-light-bg dark:hover:bg-dark-bg transition-colors"
              title="登出"
            >
              <LogOut className="w-4 h-4 text-light-text-secondary dark:text-dark-text-secondary" />
            </button>
          </div>
        </div>

        {creditInfo ? (
          <>
            {/* 关键指标卡片 - 主余额突出 + 3列次要指标 */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              {/* 可用积分 - Hero Card with gradient */}
              <div className="lg:col-span-1 bg-gradient-to-br from-primary-500 to-emerald-600 dark:from-primary-600 dark:to-emerald-700 rounded-xl p-5 shadow-md text-white">
                <div className="flex items-center gap-2 text-xs text-white/80 mb-3">
                  <Wallet className="w-4 h-4" />
                  <span>可用积分</span>
                </div>
                <div className="text-3xl font-bold tracking-tight">
                  {creditInfo.availableBalance}
                </div>
                <div className="mt-3 pt-3 border-t border-white/20 flex items-center justify-between text-xs text-white/70">
                  <span>Lv.{creditInfo.payLevel}</span>
                  <span>评分 {creditInfo.payScore}</span>
                </div>
              </div>
              {/* 次要指标 - 3列 */}
              <div className="lg:col-span-3 grid grid-cols-3 gap-4">
                {/* 总收入 */}
                <div className="bg-white dark:bg-dark-card rounded-xl border border-light-border dark:border-dark-border p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-xs text-light-text-secondary dark:text-dark-text-secondary mb-2">
                    <ArrowDownCircle className="w-4 h-4 text-primary-500" />
                    <span>总收入</span>
                  </div>
                  <div className="text-2xl font-bold text-primary-600 dark:text-primary-400">
                    {creditInfo.totalReceive}
                  </div>
                </div>
                {/* 总支出 */}
                <div className="bg-white dark:bg-dark-card rounded-xl border border-light-border dark:border-dark-border p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-xs text-light-text-secondary dark:text-dark-text-secondary mb-2">
                    <ArrowUpCircle className="w-4 h-4 text-red-500" />
                    <span>总支出</span>
                  </div>
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {creditInfo.totalPayment}
                  </div>
                </div>
                {/* 配额信息 */}
                <div className="bg-white dark:bg-dark-card rounded-xl border border-light-border dark:border-dark-border p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-xs text-light-text-secondary dark:text-dark-text-secondary mb-2">
                    <Shield className="w-4 h-4 text-amber-500" />
                    <span>剩余配额</span>
                  </div>
                  <div className="text-2xl font-bold text-light-text dark:text-dark-text">
                    {creditInfo.remainQuota}
                    <span className="text-sm font-medium text-light-text-secondary dark:text-dark-text-secondary ml-2">
                      / {creditInfo.dailyLimit}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 统计 + 交易列表区域 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* 左侧 2/3：收支统计 */}
              <div className="lg:col-span-2 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <IncomeStatsCard
                    dailyStats={dailyStats}
                    isLoading={isLoadingStats}
                    onRefresh={() => fetchDailyStats()}
                  />
                  <ExpenseStatsCard
                    dailyStats={dailyStats}
                    isLoading={isLoadingStats}
                    onRefresh={() => fetchDailyStats()}
                  />
                </div>

                {/* 充值区域 */}
                <RechargeSection
                  ldcSites={ldcSites}
                  availableBalance={parseFloat(creditInfo.availableBalance) || 0}
                  isRecharging={isRecharging}
                  onRecharge={initiateRecharge}
                />
              </div>

              {/* 右侧 1/3：交易记录 */}
              <div className="lg:col-span-1">
                <TransactionListCard
                  transactions={transactions}
                  isLoading={isLoadingTransactions}
                  onRefresh={() => fetchTransactions()}
                />
              </div>
            </div>

            {/* 底部：基准值 + 自动刷新控制 */}
            <div className="bg-white dark:bg-dark-card rounded-xl border border-light-border dark:border-dark-border px-4 py-3 shadow-sm">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-4 text-light-text-secondary dark:text-dark-text-secondary">
                  <span>
                    基准值:{' '}
                    <strong className="text-light-text dark:text-dark-text">
                      {creditInfo.communityBalance.toLocaleString()}
                    </strong>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-light-text-secondary dark:text-dark-text-secondary">
                    自动刷新
                  </span>
                  <button
                    onClick={handleAutoRefreshToggle}
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      config.autoRefresh ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                        config.autoRefresh ? 'translate-x-4' : ''
                      }`}
                    />
                  </button>
                  {config.autoRefresh && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={MIN_REFRESH_INTERVAL}
                        value={intervalInput}
                        onChange={e => handleIntervalChange(e.target.value)}
                        onBlur={handleIntervalBlur}
                        className="w-14 px-2 py-1 text-xs text-right bg-light-bg dark:bg-dark-bg border border-light-border dark:border-dark-border rounded-md focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30 outline-none text-light-text dark:text-dark-text"
                      />
                      <span className="text-light-text-secondary dark:text-dark-text-secondary">
                        分钟
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">
            暂无数据，点击刷新获取
          </div>
        )}

        {error && <p className="text-sm text-red-500 dark:text-red-400 mt-2">{error}</p>}
      </div>
    </div>
  );
}
