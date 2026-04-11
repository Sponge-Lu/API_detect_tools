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
      return 'bg-[var(--success-soft)] text-[var(--success)]';
    case 'error':
      return 'bg-[var(--danger-soft)] text-[var(--danger)]';
    case 'warning':
      return 'bg-[var(--warning-soft)] text-[var(--warning)]';
    default:
      return 'bg-[var(--surface-2)] text-[var(--text-secondary)]';
  }
}

/**
 * 打开 credit.linux.do 网站（使用系统默认浏览器）
 */
async function openCreditSite() {
  try {
    await window.electronAPI.openUrl('https://credit.linux.do');
  } catch (error) {
    // 降级到 window.open
    window.open('https://credit.linux.do', '_blank');
  }
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
      className={`h-fit rounded-[var(--radius-xl)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-sm)] ${className}`}
    >
      {/* 区域1：标题栏 - 活动 N + 刷新按钮 */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {transactions ? formatTransactionCount(transactions.total) : '活动'}
        </span>
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

      {/* 区域2：内容区 - 交易列表 */}
      <div>
        {isLoading && !transactions ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--text-secondary)]" />
          </div>
        ) : transactions && transactions.orders.length > 0 ? (
          <div className="space-y-1.5">
            {transactions.orders.slice(0, 5).map(order => (
              <div
                key={order.id}
                className="flex items-center justify-between rounded-[var(--radius-lg)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs"
              >
                <span className="mr-2 flex-1 truncate text-[var(--text-primary)]">
                  {order.order_name || order.app_name || '未命名订单'}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-medium text-[var(--text-secondary)]">
                    {formatTransactionAmount(order.amount)}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${getStatusBadgeClass(order.status)}`}
                  >
                    {getTransactionStatusText(order.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center py-6 text-sm text-[var(--text-secondary)]">
            暂无交易记录
          </div>
        )}
      </div>

      {/* 区域3：更新时间 + 查看全部 */}
      <div className="mt-3 flex items-center justify-between border-t border-[var(--line-soft)] pt-2.5 text-[10px]">
        <div className="flex items-center gap-1 text-[var(--text-secondary)]">
          <Clock className="w-3 h-3" />
          <span>更新时间: {formatLastUpdated(transactions?.lastUpdated || 0)}</span>
        </div>
        <button
          onClick={() => openCreditSite()}
          className="font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-strong)]"
        >
          查看全部
        </button>
      </div>
    </div>
  );
}
