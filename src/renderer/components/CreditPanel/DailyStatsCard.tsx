/**
 * 输入: DailyStats (每日统计数据), onRefresh (刷新回调), variant (收入/支出)
 * 输出: React 组件 (每日收支统计卡片 UI)
 * 定位: 展示层 - 合并 Income/Expense 的统一每日收支统计水平条形图
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/CreditPanel/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { RefreshCw, Loader2, Clock } from 'lucide-react';
import type { DailyStats } from '../../../shared/types/credit';
import {
  formatDateToMMDD,
  formatDailyIncome,
  formatDailyExpense,
} from '../../../shared/types/credit';
import { formatLastUpdated } from './formatLastUpdated';

export interface DailyStatsCardProps {
  /** 每日统计数据 */
  dailyStats: DailyStats | null;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 刷新回调 */
  onRefresh: () => void;
  /** 收入(accent) / 支出(danger) 变体 */
  variant: 'income' | 'expense';
  /** 自定义类名 */
  className?: string;
}

/** 显示的最大天数 */
const MAX_DISPLAY_DAYS = 5;

const VARIANT_STYLES = {
  income: {
    title: '收入统计',
    barTrack: 'bg-[var(--accent-soft)]',
    barFill: 'bg-[var(--accent)]',
    value: 'text-[var(--accent)]',
  },
  expense: {
    title: '支出统计',
    barTrack: 'bg-[var(--danger-soft)]',
    barFill: 'bg-[var(--danger)]',
    value: 'text-[var(--danger)]',
  },
} as const;

export function DailyStatsCard({
  dailyStats,
  isLoading,
  onRefresh,
  variant,
  className = '',
}: DailyStatsCardProps) {
  const styles = VARIANT_STYLES[variant];
  const isIncome = variant === 'income';

  // 按日期从新到旧排序，只取最近5天
  const sortedItems = dailyStats?.items
    ? [...dailyStats.items].reverse().slice(0, MAX_DISPLAY_DAYS)
    : [];

  // 计算最大值用于条形图比例（只计算显示的数据）
  const rawValues = sortedItems.map(item =>
    parseFloat((isIncome ? item.income : item.expense) || '0')
  );
  const maxValue = rawValues.reduce((max, value) => Math.max(max, value), 0) || 1;
  const totalValue = isIncome ? dailyStats?.totalIncome : dailyStats?.totalExpense;

  return (
    <div
      className={`h-fit rounded-[var(--radius-xl)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-sm)] ${className}`}
    >
      {/* 区域1：标题栏 - 统计标题 + LDC总额 + 刷新按钮 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-primary)]">{styles.title}</span>
          {dailyStats && totalValue !== undefined && (
            <span className={`text-sm font-bold ${styles.value}`}>LDC {totalValue.toFixed(2)}</span>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="rounded-[var(--radius-sm)] p-1.5 transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed"
          title="刷新"
          aria-label={`刷新${styles.title}`}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 text-[var(--text-secondary)] ${isLoading ? 'animate-spin' : ''}`}
            aria-hidden="true"
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
              const value = rawValues[index];
              const widthPercent = maxValue > 0 ? (value / maxValue) * 100 : 0;
              const hasValue = value > 0;
              return (
                <div key={index} className="space-y-1">
                  {/* 日期和数值在条形上方 */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-secondary)]">
                      {formatDateToMMDD(item.date)}
                    </span>
                    <span
                      className={`font-medium ${hasValue ? styles.value : 'text-[var(--text-secondary)]'}`}
                    >
                      {isIncome ? formatDailyIncome(item.income) : formatDailyExpense(item.expense)}
                    </span>
                  </div>
                  {/* 水平条形 */}
                  <div className={`h-2.5 overflow-hidden rounded-full ${styles.barTrack}`}>
                    {hasValue ? (
                      <div
                        className={`h-full rounded-full ${styles.barFill} transition-all`}
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
        <Clock className="h-3 w-3" aria-hidden="true" />
        <span>更新时间: {formatLastUpdated(dailyStats?.lastUpdated || 0)}</span>
      </div>
    </div>
  );
}
