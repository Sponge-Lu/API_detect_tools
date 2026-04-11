/**
 * 输入: useCredit Hook (积分状态、操作方法)
 * 输出: React 组件 (紧凑版 Linux Do Credit 积分面板 UI)
 * 定位: 展示层 - 在表头区域显示 Linux Do Credit 积分信息，支持展开详情
 *       刷新按钮会同时刷新积分、每日统计、交易记录
 */

import { useState, useRef, useEffect } from 'react';
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
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useCredit } from '../../hooks/useCredit';
import { toast } from '../../store/toastStore';
import { MIN_REFRESH_INTERVAL } from '../../../shared/types/credit';
import { IncomeStatsCard } from './IncomeStatsCard';
import { ExpenseStatsCard } from './ExpenseStatsCard';
import { TransactionListCard } from './TransactionListCard';
import { RechargeSection, type LdcSiteInfo } from './RechargeSection';

export interface CreditPanelCompactProps {
  className?: string;
  /** 支持 LDC 支付的站点列表 (从外部传入) */
  ldcSites?: LdcSiteInfo[];
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
  if (level >= 4) return 'text-[var(--accent-strong)]';
  if (level >= 3) return 'text-[var(--accent)]';
  if (level >= 2) return 'text-[var(--success)]';
  return 'text-[var(--text-secondary)]';
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
    fetchDailyStats,
    fetchTransactions,
    refreshAll,
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
      // 使用 refreshAll 在单个浏览器页面中刷新所有 LDC 数据
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
        <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
        <span className="text-xs text-[var(--text-secondary)]">加载中...</span>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Coins className="w-4 h-4 text-[var(--accent)]" />
        <span className="text-xs text-[var(--text-secondary)]">Linux Do Credit</span>
        <button
          onClick={handleLogin}
          disabled={isLoading}
          className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--accent)] px-2 py-1 text-xs text-white transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
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
          <Coins className="w-4 h-4 text-[var(--accent)]" />
          <span className="text-xs font-medium text-[var(--text-primary)]">
            {creditInfo?.nickname || creditInfo?.username || 'Credit'}
          </span>
        </div>
        {creditInfo && (
          <div className="flex items-center gap-2 text-xs">
            {/* 显示可用积分 */}
            <span className="text-[var(--text-secondary)]">可用积分:</span>
            <span className="font-medium text-[var(--accent)]">{creditInfo.availableBalance}</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={`rounded-[var(--radius-sm)] p-1 transition-colors hover:bg-[var(--surface-2)] ${isExpanded ? 'bg-[var(--surface-2)]' : ''}`}
            title={isExpanded ? '收起详情' : '展开详情'}
          >
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            )}
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="rounded-[var(--radius-sm)] p-1 transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50"
            title="刷新积分"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-[var(--text-secondary)] hover:text-[var(--accent)] ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="fixed top-16 right-4 z-[9999] w-[800px] max-w-[calc(100vw-2rem)] rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-xl)]">
          <div className="mb-3 flex items-center justify-between border-b border-[var(--line-soft)] pb-2">
            <div className="flex items-center gap-2">
              <Coins className="w-5 h-5 text-[var(--accent)]" />
              <div className="flex flex-col">
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {creditInfo?.nickname || 'Linux Do Credit'}
                </span>
                {creditInfo?.username && (
                  <span className="text-xs text-[var(--text-secondary)]">
                    @{creditInfo.username}
                  </span>
                )}
              </div>
              {creditInfo && (
                <span
                  className={`rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-xs ${getTrustLevelColorClass(creditInfo.trustLevel)}`}
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
                className="rounded-[var(--radius-sm)] p-1.5 transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed"
                title="刷新"
              >
                <RefreshCw
                  className={`h-4 w-4 text-[var(--text-secondary)] ${isRefreshing ? 'animate-spin' : ''}`}
                />
              </button>
              <button
                onClick={handleLogout}
                className="rounded-[var(--radius-sm)] p-1.5 transition-colors hover:bg-[var(--surface-2)]"
                title="登出"
              >
                <LogOut className="h-4 w-4 text-[var(--text-secondary)]" />
              </button>
            </div>
          </div>

          {creditInfo ? (
            <div className="space-y-3">
              {/* Linux Do Credit 积分信息区 */}
              <div className="rounded-[var(--radius-lg)] bg-[var(--surface-2)] p-3">
                <div className="mb-2 text-xs font-medium text-[var(--text-secondary)]">
                  Linux Do Credit 积分
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1">
                    <ArrowDownCircle className="h-3.5 w-3.5 text-[var(--success)]" />
                    <span className="text-[var(--text-secondary)]">收入:</span>
                    <span className="font-semibold text-[var(--success)]">
                      {creditInfo.totalReceive}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowUpCircle className="h-3.5 w-3.5 text-[var(--danger)]" />
                    <span className="text-[var(--text-secondary)]">支出:</span>
                    <span className="font-semibold text-[var(--danger)]">
                      {creditInfo.totalPayment}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Wallet className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span className="text-[var(--text-secondary)]">可用:</span>
                    <span className="font-semibold text-[var(--accent)]">
                      {creditInfo.availableBalance}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Coins className="h-3.5 w-3.5 text-[var(--warning)]" />
                    <span className="text-[var(--text-secondary)]">基准值:</span>
                    <span className="font-semibold text-[var(--text-primary)]">
                      {creditInfo.communityBalance.toLocaleString()}
                    </span>
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
              <div className="flex items-center justify-between rounded-[var(--radius-lg)] bg-[var(--surface-2)] p-3 text-sm">
                <div className="flex items-center gap-1">
                  <span className="text-[var(--text-secondary)]">支付评分</span>
                  <span className="ml-1 font-semibold text-[var(--text-primary)]">
                    {creditInfo.payScore}
                  </span>
                </div>
                <div className="h-4 w-px bg-[var(--line-soft)]" />
                <div className="flex items-center gap-1">
                  <span className="text-[var(--text-secondary)]">支付等级</span>
                  <span className="ml-1 font-semibold text-[var(--text-primary)]">
                    Lv.{creditInfo.payLevel}
                  </span>
                </div>
                <div className="h-4 w-px bg-[var(--line-soft)]" />
                <div className="flex items-center gap-1">
                  <span className="text-[var(--text-secondary)]">剩余配额</span>
                  <span className="ml-1 font-semibold text-[var(--text-primary)]">
                    {creditInfo.remainQuota}
                  </span>
                </div>
                <div className="h-4 w-px bg-[var(--line-soft)]" />
                <div className="flex items-center gap-1">
                  <span className="text-[var(--text-secondary)]">每日限额</span>
                  <span className="ml-1 font-semibold text-[var(--text-primary)]">
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
              <div className="flex items-center justify-between border-t border-[var(--line-soft)] pt-2 text-xs">
                <div className="flex items-center gap-1 text-[var(--text-secondary)]">
                  <Clock className="w-3 h-3" />
                  <span>更新于 {formatLastUpdated(creditInfo.lastUpdated)}</span>
                </div>
                {/* 自动刷新设置 */}
                <div className="flex items-center gap-2">
                  <span className="text-[var(--text-secondary)]">自动刷新</span>
                  <button
                    onClick={handleAutoRefreshToggle}
                    className={`relative w-8 h-4 rounded-full transition-colors ${
                      config.autoRefresh ? 'bg-[var(--accent)]' : 'bg-[var(--line-strong)]'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-[var(--surface-3)] transition-transform ${
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
                        className="w-12 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-1 py-0.5 text-right text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                      />
                      <span className="text-[var(--text-secondary)]">分钟</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-4 text-center text-sm text-[var(--text-secondary)]">
              暂无数据，点击刷新获取
            </div>
          )}

          {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
        </div>
      )}
    </div>
  );
}
