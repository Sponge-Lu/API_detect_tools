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
import { AppButton } from '../components/AppButton/AppButton';
import { AppSwitch } from '../components/AppSwitch';
import { DataTableEmpty } from '../components/DataTable/primitives';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { DailyStatsCard } from '../components/CreditPanel/DailyStatsCard';
import { TransactionListCard } from '../components/CreditPanel/TransactionListCard';
import { RechargeSection } from '../components/CreditPanel/RechargeSection';
import { formatLastUpdated } from '../components/CreditPanel/formatLastUpdated';

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
  if (level >= 4) return 'text-[var(--warning)]';
  if (level >= 3) return 'text-[var(--accent)]';
  if (level >= 2) return 'text-[var(--success)]';
  return 'text-[var(--text-secondary)]';
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

  const handleAutoRefreshToggle = async (next: boolean) => {
    await updateConfig({ autoRefresh: next });
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
    return <LoadingState />;
  }

  // 未登录状态
  if (!isLoggedIn) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="space-y-4 text-center">
          <Coins className="mx-auto h-16 w-16 text-[var(--accent)] opacity-70" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Linux Do Credit</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            登录后查看积分信息、收支统计和交易记录
          </p>
          <AppButton onClick={handleLogin} disabled={isLoading} variant="primary" size="md">
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            登录 Linux Do
          </AppButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* 用户信息头部 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="font-semibold text-[var(--text-primary)]">
                {creditInfo?.nickname || 'Linux Do Credit'}
              </span>
              {creditInfo?.username && (
                <span className="text-xs text-[var(--text-secondary)]">@{creditInfo.username}</span>
              )}
            </div>
            {creditInfo && (
              <span
                className={`rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs ${getTrustLevelColorClass(creditInfo.trustLevel)}`}
              >
                <Shield className="w-3 h-3 inline mr-0.5" />
                {getTrustLevelText(creditInfo.trustLevel)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {creditInfo && (
              <div className="mr-2 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <Clock className="w-3.5 h-3.5" />
                <span>{formatLastUpdated(creditInfo.lastUpdated)}</span>
              </div>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              aria-label="刷新积分"
              className="rounded-[var(--radius-md)] p-2 transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed"
              title="刷新"
            >
              <RefreshCw
                aria-hidden="true"
                className={`w-4 h-4 text-[var(--text-secondary)] ${isRefreshing ? 'animate-spin' : ''}`}
              />
            </button>
            <button
              onClick={handleLogout}
              aria-label="登出"
              className="rounded-[var(--radius-md)] p-2 transition-colors hover:bg-[var(--surface-2)]"
              title="登出"
            >
              <LogOut aria-hidden="true" className="w-4 h-4 text-[var(--text-secondary)]" />
            </button>
          </div>
        </div>

        {creditInfo ? (
          <>
            {/* 关键指标卡片 - 主余额突出 + 3列次要指标 */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
              <div className="lg:col-span-1 rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-3)] p-5 shadow-[var(--shadow-md)]">
                <div className="mb-3 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <Wallet className="w-4 h-4" />
                  <span>可用积分</span>
                </div>
                <div className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
                  {creditInfo.availableBalance}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-[var(--line-soft)] pt-3 text-xs text-[var(--text-secondary)]">
                  <span>Lv.{creditInfo.payLevel}</span>
                  <span>评分 {creditInfo.payScore}</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 lg:col-span-3">
                <div className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-sm)]">
                  <div className="mb-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <ArrowDownCircle className="w-4 h-4 text-[var(--accent)]" />
                    <span>总收入</span>
                  </div>
                  <div className="text-2xl font-bold text-[var(--accent)]">
                    {creditInfo.totalReceive}
                  </div>
                </div>
                <div className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-sm)]">
                  <div className="mb-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <ArrowUpCircle className="w-4 h-4 text-[var(--danger)]" />
                    <span>总支出</span>
                  </div>
                  <div className="text-2xl font-bold text-[var(--danger)]">
                    {creditInfo.totalPayment}
                  </div>
                </div>
                <div className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-sm)]">
                  <div className="mb-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <Shield className="w-4 h-4 text-[var(--warning)]" />
                    <span>剩余配额</span>
                  </div>
                  <div className="text-2xl font-bold text-[var(--text-primary)]">
                    {creditInfo.remainQuota}
                    <span className="ml-2 text-sm font-medium text-[var(--text-secondary)]">
                      / {creditInfo.dailyLimit}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <DailyStatsCard
                    variant="income"
                    dailyStats={dailyStats}
                    isLoading={isLoadingStats}
                    onRefresh={() => fetchDailyStats()}
                  />
                  <DailyStatsCard
                    variant="expense"
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

              <div className="lg:col-span-1">
                <TransactionListCard
                  transactions={transactions}
                  isLoading={isLoadingTransactions}
                  onRefresh={() => fetchTransactions()}
                />
              </div>
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-4 py-3 shadow-[var(--shadow-sm)]">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-4 text-[var(--text-secondary)]">
                  <span>
                    基准值:{' '}
                    <strong className="text-[var(--text-primary)]">
                      {creditInfo.communityBalance.toLocaleString()}
                    </strong>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <AppSwitch
                    size="sm"
                    checked={config.autoRefresh}
                    onCheckedChange={handleAutoRefreshToggle}
                    label="自动刷新"
                  />
                  {config.autoRefresh && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        aria-label="自动刷新间隔（分钟）"
                        min={MIN_REFRESH_INTERVAL}
                        value={intervalInput}
                        onChange={e => handleIntervalChange(e.target.value)}
                        onBlur={handleIntervalBlur}
                        className="w-14 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-2 py-1 text-right text-xs text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)] focus:shadow-[0_0_0_4px_var(--focus-ring)]"
                      />
                      <span className="text-[var(--text-secondary)]">分钟</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <DataTableEmpty description="暂无数据，点击刷新获取" title="暂无积分数据" />
        )}

        {error && <ErrorState className="py-4" title="操作失败" description={error} />}
      </div>
    </div>
  );
}
