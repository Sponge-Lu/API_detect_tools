/**
 * 输入: TransactionList (交易记录列表), onRefresh (刷新回调)
 * 输出: React 组件 (交易记录卡片 UI)
 * 定位: 展示层 - 显示交易记录列表（参考官方 UI 设计）
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/CreditPanel/FOLDER_INDEX.md
 * - src/renderer/components/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { RefreshCw, Loader2, Clock } from 'lucide-react';
import type { TransactionList, TransactionStatus } from '../../../shared/types/credit';
import {
  formatTransactionAmount,
  formatTransactionCount,
  getTransactionStatusText,
  getTransactionStatusColor,
} from '../../../shared/types/credit';

export interface TransactionListCardProps {
  /** 交易记录列表 */
  transactions: TransactionList | null;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 刷新回调 */
  onRefresh: () => void;
  /** 自定义类名 */
  className?: string;
}

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
 * 获取状态徽章的样式类名
 * Requirements: 10.5, 16.4
 */
function getStatusBadgeClass(status: TransactionStatus): string {
  const colorType = getTransactionStatusColor(status);
  switch (colorType) {
    case 'success':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'error':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    case 'warning':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400';
  }
}

/**
 * 打开 credit.linux.do 网站
 */
function openCreditSite() {
  window.open('https://credit.linux.do', '_blank');
}

/**
 * 交易记录卡片组件
 * 显示交易记录列表（参考官方 UI 设计）
 * 三区域布局：标题栏（活动N+刷新按钮）/ 内容区（交易列表）/ 更新时间+查看全部
 *
 * Requirements: 10.2-10.11, 16.4
 */
export function TransactionListCard({
  transactions,
  isLoading,
  onRefresh,
  className = '',
}: TransactionListCardProps) {
  return (
    <div
      className={`bg-white dark:bg-dark-card rounded-lg border border-light-border dark:border-dark-border p-2 h-fit ${className}`}
    >
      {/* 区域1：标题栏 - 活动 N + 刷新按钮 (Requirements: 10.2, 16.4) */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-light-text dark:text-dark-text">
          {transactions ? formatTransactionCount(transactions.total) : '活动'}
        </span>
        {/* 刷新按钮 (Requirements: 10.9) */}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-all disabled:cursor-not-allowed"
          title="刷新"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-light-text-secondary dark:text-dark-text-secondary ${isLoading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {/* 区域2：内容区 - 交易列表 */}
      <div>
        {isLoading && !transactions ? (
          // 加载状态 (Requirements: 10.10)
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-light-text-secondary dark:text-dark-text-secondary" />
          </div>
        ) : transactions && transactions.orders.length > 0 ? (
          <div className="space-y-1">
            {transactions.orders.slice(0, 5).map(order => (
              <div
                key={order.id}
                className="flex items-center justify-between text-xs py-1 px-1.5 bg-slate-50 dark:bg-slate-800 rounded"
              >
                {/* 订单名称 (Requirements: 10.3) */}
                <span className="text-light-text dark:text-dark-text truncate flex-1 mr-2">
                  {order.order_name || order.app_name || '未命名订单'}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* 金额 (Requirements: 10.4) */}
                  <span className="text-light-text-secondary dark:text-dark-text-secondary font-medium">
                    {formatTransactionAmount(order.amount)}
                  </span>
                  {/* 状态徽章 (Requirements: 10.5) */}
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getStatusBadgeClass(order.status)}`}
                  >
                    {getTransactionStatusText(order.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          // 空状态 (Requirements: 10.7)
          <div className="flex items-center justify-center h-full text-sm text-light-text-secondary dark:text-dark-text-secondary">
            暂无交易记录
          </div>
        )}
      </div>

      {/* 区域3：更新时间 + 查看全部 (Requirements: 10.6, 10.8) */}
      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-700 text-[10px]">
        <div className="flex items-center gap-1 text-light-text-secondary dark:text-dark-text-secondary">
          <Clock className="w-3 h-3" />
          <span>更新时间: {formatLastUpdated(transactions?.lastUpdated || 0)}</span>
        </div>
        {/* 查看全部链接 - 蓝色文字，无图标 (Requirements: 10.6) */}
        <button
          onClick={openCreditSite}
          className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
        >
          查看全部
        </button>
      </div>
    </div>
  );
}
