/**
 * 输入: DailyStats (每日统计数据), onRefresh (刷新回调)
 * 输出: React 组件 (收入统计卡片 UI)
 * 定位: 展示层 - 显示每日收入统计水平条形图（参考官方 UI 设计）
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/CreditPanel/FOLDER_INDEX.md
 * - src/renderer/components/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { RefreshCw, Loader2, Clock } from 'lucide-react';
import type { DailyStats } from '../../../shared/types/credit';
import { formatDateToMMDD, formatDailyIncome } from '../../../shared/types/credit';

export interface IncomeStatsCardProps {
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
 * 收入统计卡片组件
 * 显示每日收入水平条形图和总收入金额（参考官方 UI 设计）
 * 三区域布局：标题栏（名称+总额+刷新）/ 内容区（条形图）/ 更新时间
 * 条形图布局：日期和数值在条形上方（日期靠左，数值靠右），条形在下方
 *
 * Requirements: 9.3, 9.5, 9.7, 9.9, 9.10, 9.11, 16.4, 16.7, 16.8, 16.9
 */
export function IncomeStatsCard({
  dailyStats,
  isLoading,
  onRefresh,
  className = '',
}: IncomeStatsCardProps) {
  // 按日期从新到旧排序，只取最近5天
  const sortedItems = dailyStats?.items
    ? [...dailyStats.items].reverse().slice(0, MAX_DISPLAY_DAYS)
    : [];

  // 计算最大收入值用于条形图比例（只计算显示的数据）
  const maxIncome =
    sortedItems.reduce((max, item) => {
      const income = parseFloat(item.income || '0');
      return Math.max(max, income);
    }, 0) || 1;

  return (
    <div
      className={`h-fit rounded-[var(--radius-xl)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-sm)] ${className}`}
    >
      {/* 区域1：标题栏 - 收入统计 + LDC总额 + 刷新按钮 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-primary)]">收入统计</span>
          {dailyStats && (
            <span className="text-sm font-bold text-[var(--accent)]">
              LDC {dailyStats.totalIncome.toFixed(2)}
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="rounded-[var(--radius-sm)] p-1.5 transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed"
          title="刷新"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 text-[var(--text-secondary)] ${isLoading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {/* 区域2：内容区 - 水平条形图 */}
      <div>
        {isLoading && !dailyStats ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--text-secondary)]" />
          </div>
        ) : dailyStats && sortedItems.length > 0 ? (
          <div className="space-y-2">
            {sortedItems.map((item, index) => {
              const income = parseFloat(item.income || '0');
              const widthPercent = maxIncome > 0 ? (income / maxIncome) * 100 : 0;
              const hasValue = income > 0;
              return (
                <div key={index} className="space-y-1">
                  {/* 日期和数值在条形上方 */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-secondary)]">
                      {formatDateToMMDD(item.date)}
                    </span>
                    <span
                      className={`font-medium ${hasValue ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                    >
                      {formatDailyIncome(item.income)}
                    </span>
                  </div>
                  {/* 水平条形 */}
                  <div className="h-2.5 overflow-hidden rounded-full bg-[var(--accent-soft)]">
                    {hasValue ? (
                      <div
                        className="h-full rounded-full bg-[var(--accent)] transition-all"
                        style={{ width: `${Math.max(widthPercent, 3)}%` }}
                      />
                    ) : (
                      <div className="h-full w-1 rounded-full bg-[var(--line-soft)]" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center py-6 text-sm text-[var(--text-secondary)]">
            暂无数据
          </div>
        )}
      </div>

      {/* 区域3：更新时间 */}
      <div className="mt-3 flex items-center gap-1 border-t border-[var(--line-soft)] pt-2.5 text-[10px] text-[var(--text-secondary)]">
        <Clock className="h-3 w-3" />
        <span>更新时间: {formatLastUpdated(dailyStats?.lastUpdated || 0)}</span>
      </div>
    </div>
  );
}
