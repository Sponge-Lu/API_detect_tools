/**
 * 输入: SiteCardActionsProps (操作回调、加载状态、签到统计)
 * 输出: React 组件 (站点卡片操作按钮 UI)
 * 定位: 展示层 - 站点卡片操作按钮组件，仅承载主行高频动作
 *
 * 并发刷新: 使用 isDetecting (boolean) 替代 detectingSite (string) 控制按钮禁用和 spinner，
 * 支持多站点同时刷新
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/SiteCard/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { Calendar, CheckCircle, Fuel, Loader2, RefreshCw } from 'lucide-react';
import type { SiteCardActionsProps } from './types';

/**
 * 格式化签到金额 (内部单位 -> 美元)
 * @param quota 内部单位金额
 * @returns 格式化后的美元字符串
 */
function formatCheckinQuota(quota: number): string {
  const dollars = quota / 500000;
  if (dollars >= 0.01) {
    return `$${dollars.toFixed(2)}`;
  }
  if (dollars >= 0.001) {
    return `$${dollars.toFixed(3)}`;
  }
  return `$${dollars.toFixed(4)}`;
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

  if (checkinStats?.checkinCount !== undefined) {
    return `点击签到 | 本月 ${checkinStats.checkinCount} 次`;
  }
  return '点击签到';
}

export function SiteCardActions({
  site,
  cardKey,
  accessPointType = 'managed',
  accountId,
  siteResult,
  isDetecting,
  checkingIn,
  checkinStats,
  onDetect,
  onCheckIn,
  onOpenExtraLink,
}: SiteCardActionsProps) {
  if (accessPointType === 'custom-cli') {
    return <div className="ml-1 w-[48px] shrink-0" aria-hidden="true" />;
  }

  return (
    <div className="ml-1 flex shrink-0 items-center gap-0.5">
      {site.extra_links && (
        <button
          onClick={e => {
            e.stopPropagation();
            onOpenExtraLink(site.extra_links!);
          }}
          className="rounded-[var(--radius-sm)] p-[3px] text-[var(--warning)] transition-colors hover:bg-[var(--warning-soft)]"
          title={`打开加油站: ${site.extra_links}`}
          aria-label={`打开加油站: ${site.extra_links}`}
        >
          <Fuel className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      )}

      {(site.force_enable_checkin || siteResult?.has_checkin) && (
        <>
          {(() => {
            const isToday = siteResult?.lastRefresh
              ? new Date(siteResult.lastRefresh).toDateString() === new Date().toDateString()
              : false;
            const effectiveCanCheckIn = isToday
              ? siteResult?.can_check_in
              : siteResult?.can_check_in === false
                ? undefined
                : siteResult?.can_check_in;

            return (
              <>
                {(effectiveCanCheckIn === true ||
                  effectiveCanCheckIn === undefined ||
                  (site.force_enable_checkin && effectiveCanCheckIn !== false)) && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onCheckIn(site, accountId);
                    }}
                    disabled={checkingIn === cardKey}
                    className="rounded-[var(--radius-sm)] p-[3px] text-[var(--warning)] transition-colors hover:bg-[var(--warning-soft)] disabled:opacity-50"
                    title={getCheckinTooltip(effectiveCanCheckIn, checkinStats)}
                    aria-label={getCheckinTooltip(effectiveCanCheckIn, checkinStats)}
                  >
                    {checkingIn === cardKey ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                    ) : (
                      <Calendar className="w-3.5 h-3.5" strokeWidth={2} />
                    )}
                  </button>
                )}

                {effectiveCanCheckIn === false && (
                  <div
                    className="rounded-[var(--radius-sm)] p-[3px] text-[var(--text-tertiary)]"
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

      <button
        onClick={e => {
          e.stopPropagation();
          onDetect(site);
        }}
        disabled={isDetecting}
        className="rounded-[var(--radius-sm)] p-[3px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] disabled:opacity-50"
        title="刷新检测"
        aria-label="刷新检测"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isDetecting ? 'animate-spin' : ''}`} strokeWidth={2} />
      </button>
    </div>
  );
}
