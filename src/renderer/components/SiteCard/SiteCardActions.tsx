/**
 * 输入: SiteCardActionsProps (操作回调、加载状态、展开状态、签到统计)
 * 输出: React 组件 (站点卡片操作按钮 UI)
 * 定位: 展示层 - 站点卡片操作按钮组件，包含复制、刷新、编辑、删除等操作
 *
 * 并发刷新: 使用 isDetecting (boolean) 替代 detectingSite (string) 控制按钮禁用和 spinner，
 * 支持多站点同时刷新
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/SiteCard/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import {
  ChevronDown,
  RefreshCw,
  CheckCircle,
  Edit,
  Trash2,
  Calendar,
  Loader2,
  Fuel,
  Timer,
  TimerOff,
  Plus,
} from 'lucide-react';
import type { SiteCardActionsProps } from './types';

/**
 * 格式化签到金额 (内部单位 -> 美元)
 * @param quota 内部单位金额
 * @returns 格式化后的美元字符串
 */
function formatCheckinQuota(quota: number): string {
  const dollars = quota / 500000;
  // 根据金额大小选择合适的小数位数
  if (dollars >= 0.01) {
    return `$${dollars.toFixed(2)}`;
  } else if (dollars >= 0.001) {
    return `$${dollars.toFixed(3)}`;
  } else {
    return `$${dollars.toFixed(4)}`;
  }
}

/**
 * 生成签到图标的 tooltip 文本
 * @param canCheckIn 是否可签到
 * @param checkinStats 签到统计数据
 * @returns tooltip 文本
 */
function getCheckinTooltip(
  canCheckIn: boolean | undefined,
  checkinStats?: {
    todayQuota?: number;
    checkinCount?: number;
    totalCheckins?: number;
    siteType?: 'veloera' | 'newapi';
  }
): string {
  // 已签到状态
  if (canCheckIn === false) {
    if (checkinStats?.todayQuota !== undefined && checkinStats.todayQuota > 0) {
      const quotaStr = formatCheckinQuota(checkinStats.todayQuota);
      if (checkinStats.checkinCount !== undefined) {
        return `今日已签到 +${quotaStr} | 本月 ${checkinStats.checkinCount} 次`;
      }
      return `今日已签到 +${quotaStr}`;
    }
    if (checkinStats?.checkinCount !== undefined) {
      return `今日已签到 | 本月 ${checkinStats.checkinCount} 次`;
    }
    return '今日已签到';
  }

  // 可签到状态
  if (checkinStats?.checkinCount !== undefined) {
    return `点击签到 | 本月 ${checkinStats.checkinCount} 次`;
  }
  return '点击签到';
}

export function SiteCardActions({
  site,
  index,
  siteResult,
  isExpanded,
  isDetecting,
  checkingIn,
  autoRefreshEnabled,
  editAccount,
  checkinStats,
  onExpand,
  onDetect,
  onEdit,
  onDelete,
  onCheckIn,
  onOpenExtraLink,
  onToggleAutoRefresh,
  onAddAccount,
}: SiteCardActionsProps) {
  return (
    <div className="flex items-center gap-1 ml-2 flex-shrink-0">
      {/* 加油站按钮 - 放在签到图标前面 */}
      {site.extra_links && (
        <button
          onClick={e => {
            e.stopPropagation();
            onOpenExtraLink(site.extra_links!);
          }}
          className="p-1 hover:bg-purple-500/15 text-purple-700 dark:text-purple-300 rounded transition-all"
          title={`打开加油站: ${site.extra_links}`}
          aria-label={`打开加油站: ${site.extra_links}`}
        >
          <Fuel className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      )}

      {/* 签到按钮 - 放在加油站图标后面 */}
      {(site.force_enable_checkin || siteResult?.has_checkin) && (
        <>
          {/* 判断缓存是否是今天的数据 */}
          {(() => {
            const isToday = siteResult?.lastRefresh
              ? new Date(siteResult.lastRefresh).toDateString() === new Date().toDateString()
              : false;
            // 如果缓存不是今天的，忽略 can_check_in=false 状态
            const effectiveCanCheckIn = isToday
              ? siteResult?.can_check_in
              : siteResult?.can_check_in === false
                ? undefined
                : siteResult?.can_check_in;

            return (
              <>
                {/* 可签到 */}
                {(effectiveCanCheckIn === true ||
                  effectiveCanCheckIn === undefined ||
                  (site.force_enable_checkin && effectiveCanCheckIn !== false)) && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onCheckIn(site);
                    }}
                    disabled={checkingIn === site.name}
                    className="p-1 hover:bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 rounded transition-all disabled:opacity-50"
                    title={getCheckinTooltip(effectiveCanCheckIn, checkinStats)}
                    aria-label={getCheckinTooltip(effectiveCanCheckIn, checkinStats)}
                  >
                    {checkingIn === site.name ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                    ) : (
                      <Calendar className="w-3.5 h-3.5" strokeWidth={2} />
                    )}
                  </button>
                )}

                {/* 已签到 - 仅当缓存是今天且明确为false时显示 */}
                {effectiveCanCheckIn === false && (
                  <div
                    className="p-1 text-gray-400 rounded"
                    title={getCheckinTooltip(false, checkinStats)}
                    aria-label={getCheckinTooltip(false, checkinStats)}
                  >
                    <CheckCircle className="w-3.5 h-3.5" strokeWidth={2} />
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}

      {/* 展开/收起 */}
      <button
        onClick={() => onExpand(site.name)}
        className="p-1 rounded-md text-light-text-secondary dark:text-dark-text-secondary hover:bg-light-border/50 dark:hover:bg-dark-border/50 transition-all"
        title={isExpanded ? '收起详情' : '展开详情'}
        aria-label={isExpanded ? '收起详情' : '展开详情'}
        aria-expanded={isExpanded}
      >
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>

      {/* 刷新检测 */}
      <button
        onClick={() => onDetect(site)}
        disabled={isDetecting}
        className="p-1 rounded-md text-light-text-secondary dark:text-dark-text-secondary hover:bg-primary-500/15 hover:text-primary-500 transition-all disabled:opacity-50"
        title="刷新检测"
        aria-label="刷新检测"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isDetecting ? 'animate-spin' : ''}`} strokeWidth={2} />
      </button>

      {/* 自动刷新开关 */}
      <button
        onClick={() => onToggleAutoRefresh?.()}
        className={`p-1 rounded-md transition-all ${autoRefreshEnabled ? 'bg-green-500/15 text-green-500 hover:bg-green-500/25' : 'text-light-text-secondary dark:text-dark-text-secondary hover:bg-light-border/50 dark:hover:bg-dark-border/50'}`}
        title={autoRefreshEnabled ? '关闭自动刷新' : '开启自动刷新'}
        aria-label={autoRefreshEnabled ? '关闭自动刷新' : '开启自动刷新'}
        aria-pressed={autoRefreshEnabled}
      >
        {autoRefreshEnabled ? (
          <Timer className="w-3.5 h-3.5" strokeWidth={2} />
        ) : (
          <TimerOff className="w-3.5 h-3.5" strokeWidth={2} />
        )}
      </button>

      {/* 编辑 */}
      <button
        onClick={() => onEdit(index, editAccount)}
        className="p-1 rounded-md text-light-text-secondary dark:text-dark-text-secondary hover:bg-light-border/50 dark:hover:bg-dark-border/50 transition-all"
        title="编辑站点"
        aria-label="编辑站点"
      >
        <Edit className="w-3.5 h-3.5" strokeWidth={2} />
      </button>

      {/* 删除 */}
      <button
        onClick={() => onDelete(index)}
        className="p-1 rounded-md text-light-text-secondary dark:text-dark-text-secondary hover:bg-red-500/15 hover:text-red-500 transition-all"
        title="删除站点"
        aria-label="删除站点"
      >
        <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
      </button>

      {/* 添加账户 - 仅默认账户卡片显示 */}
      {onAddAccount && (
        <button
          onClick={e => {
            e.stopPropagation();
            onAddAccount();
          }}
          className="p-1 rounded-md text-[var(--ios-blue)] hover:bg-[var(--ios-blue)]/15 transition-all"
          title="添加账户"
          aria-label="添加账户"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
