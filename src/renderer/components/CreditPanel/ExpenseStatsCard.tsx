/**
 * 输入: DailyStats (每日统计数据), onRefresh (刷新回调)
 * 输出: React 组件 (支出统计卡片 UI)
 * 定位: 展示层 - 显示每日支出统计水平条形图（参考官方 UI 设计）
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/CreditPanel/FOLDER_INDEX.md
 * - src/renderer/components/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { RefreshCw, Loader2, Clock } from 'lucide-react';
import type { DailyStats } from '../../../shared/types/credit';
import { formatDateToMMDD, formatDailyExpense } from '../../../shared/types/credit';

export interface ExpenseStatsCardProps {
  /** 每日统计数据 */
  dailyStats: DailyStats | null;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 刷新回调 */
  onRefresh: () => void;
  /** 自定义类名 */
  className?: string;
}

/** 显示的最大天数 */
const MAX_DISPLAY_DAYS = 5;

/**
 * 格式化时间戳为可读字符串
 */
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

/**
 * 支出统计卡片组件
 * 显示每日支出水平条形图和总支出金额（参考官方 UI 设计）
 * 三区域布局：标题栏（名称+总额+刷新）/ 内容区（条形图）/ 更新时间
 * 条形图布局：日期和数值在条形上方（日期靠左，数值靠右），条形在下方
 *
 * Requirements: 9.4, 9.6, 9.8, 9.9, 9.10, 9.11, 16.4, 16.7, 16.8, 16.10
 */
export function ExpenseStatsCard({
  dailyStats,
  isLoading,
  onRefresh,
  className = '',
}: ExpenseStatsCardProps) {
  // 按日期从新到旧排序，只取最近5天
  const sortedItems = dailyStats?.items
    ? [...dailyStats.items].reverse().slice(0, MAX_DISPLAY_DAYS)
    : [];

  // 计算最大支出值用于条形图比例（只计算显示的数据）
  const maxExpense =
    sortedItems.reduce((max, item) => {
      const expense = parseFloat(item.expense || '0');
      return Math.max(max, expense);
    }, 0) || 1;

  return (
    <div
      className={`bg-white dark:bg-dark-card rounded-xl border border-light-border dark:border-dark-border p-4 h-fit shadow-sm ${className}`}
    >
      {/* 区域1：标题栏 - 支出统计 + LDC总额 + 刷新按钮 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-light-text dark:text-dark-text">支出统计</span>
          {dailyStats && (
            <span className="text-sm font-bold text-red-600 dark:text-red-400">
              LDC {dailyStats.totalExpense.toFixed(2)}
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1.5 hover:bg-light-bg dark:hover:bg-dark-bg rounded-md transition-all disabled:cursor-not-allowed"
          title="刷新"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-light-text-secondary dark:text-dark-text-secondary ${isLoading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {/* 区域2：内容区 - 水平条形图 */}
      <div>
        {isLoading && !dailyStats ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-light-text-secondary dark:text-dark-text-secondary" />
          </div>
        ) : dailyStats && sortedItems.length > 0 ? (
          <div className="space-y-2">
            {sortedItems.map((item, index) => {
              const expense = parseFloat(item.expense || '0');
              const widthPercent = maxExpense > 0 ? (expense / maxExpense) * 100 : 0;
              const hasValue = expense > 0;
              return (
                <div key={index} className="space-y-1">
                  {/* 日期和数值在条形上方 */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-light-text-secondary dark:text-dark-text-secondary">
                      {formatDateToMMDD(item.date)}
                    </span>
                    <span
                      className={`font-medium ${hasValue ? 'text-red-600 dark:text-red-400' : 'text-light-text-secondary dark:text-dark-text-secondary'}`}
                    >
                      {formatDailyExpense(item.expense)}
                    </span>
                  </div>
                  {/* 水平条形 */}
                  <div className="h-2.5 bg-red-50 dark:bg-red-900/20 rounded-full overflow-hidden">
                    {hasValue ? (
                      <div
                        className="h-full bg-red-500 dark:bg-red-400 rounded-full transition-all"
                        style={{ width: `${Math.max(widthPercent, 3)}%` }}
                      />
                    ) : (
                      <div className="h-full w-1 bg-light-border dark:bg-dark-border rounded-full" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center py-6 text-sm text-light-text-secondary dark:text-dark-text-secondary">
            暂无数据
          </div>
        )}
      </div>

      {/* 区域3：更新时间 */}
      <div className="flex items-center gap-1 mt-3 pt-2.5 border-t border-light-border dark:border-dark-border text-[10px] text-light-text-secondary dark:text-dark-text-secondary">
        <Clock className="w-3 h-3" />
        <span>更新时间: {formatLastUpdated(dailyStats?.lastUpdated || 0)}</span>
      </div>
    </div>
  );
}
