/**
 * 站点卡片操作按钮组件
 */

import {
  ChevronDown,
  Copy,
  RefreshCw,
  CheckCircle,
  Edit,
  Trash2,
  Calendar,
  Loader2,
  Fuel,
  Timer,
  TimerOff,
} from 'lucide-react';
import type { SiteCardActionsProps } from './types';

export function SiteCardActions({
  site,
  index,
  siteResult,
  isExpanded,
  detectingSite,
  checkingIn,
  autoRefreshEnabled,
  onExpand,
  onDetect,
  onEdit,
  onDelete,
  onCheckIn,
  onOpenExtraLink,
  onCopyToClipboard,
  onToggleAutoRefresh,
}: SiteCardActionsProps) {
  return (
    <div className="flex items-center gap-1 ml-2 flex-shrink-0">
      {/* 签到按钮 */}
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
                    className="p-1 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-700 dark:text-yellow-300 rounded transition-all disabled:opacity-50"
                    title="点击签到"
                  >
                    {checkingIn === site.name ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Calendar className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}

                {/* 已签到 - 仅当缓存是今天且明确为false时显示 */}
                {effectiveCanCheckIn === false && (
                  <div className="p-1 bg-gray-500/20 text-gray-400 rounded" title="今日已签到">
                    <CheckCircle className="w-3.5 h-3.5" />
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}

      {/* 加油站按钮 */}
      {site.extra_links && (
        <button
          onClick={e => {
            e.stopPropagation();
            onOpenExtraLink(site.extra_links!);
          }}
          className="p-1 bg-purple-500/20 hover:bg-purple-500/30 text-purple-700 dark:text-purple-300 rounded transition-all"
          title={`打开加油站: ${site.extra_links}`}
        >
          <Fuel className="w-3.5 h-3.5 animate-pulse" />
        </button>
      )}

      {/* 展开/收起 */}
      <button
        onClick={() => onExpand(site.name)}
        className="p-1 hover:bg-white/10 rounded transition-all"
        title={isExpanded ? '收起详情' : '展开详情'}
      >
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* 复制 URL */}
      <button
        onClick={() => onCopyToClipboard(site.url, 'URL')}
        className="p-1 hover:bg-white/10 rounded transition-all"
        title="复制URL"
      >
        <Copy className="w-3.5 h-3.5 text-gray-400" />
      </button>

      {/* 刷新检测 */}
      <button
        onClick={() => onDetect(site)}
        disabled={detectingSite === site.name}
        className="p-1 hover:bg-primary-500/20 rounded transition-all disabled:opacity-50"
        title="刷新检测"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${detectingSite === site.name ? 'animate-spin' : ''}`} />
      </button>

      {/* 自动刷新开关 */}
      <button
        onClick={() => onToggleAutoRefresh?.()}
        className={`p-1 rounded transition-all ${autoRefreshEnabled ? 'bg-green-500/20 hover:bg-green-500/30' : 'hover:bg-white/10'}`}
        title={autoRefreshEnabled ? '关闭自动刷新' : '开启自动刷新'}
      >
        {autoRefreshEnabled ? (
          <Timer className="w-3.5 h-3.5 text-green-500" />
        ) : (
          <TimerOff className="w-3.5 h-3.5 text-gray-400" />
        )}
      </button>

      {/* 编辑 */}
      <button
        onClick={() => onEdit(index)}
        className="p-1 hover:bg-white/10 rounded transition-all"
        title="编辑站点"
      >
        <Edit className="w-3.5 h-3.5" />
      </button>

      {/* 删除 */}
      <button
        onClick={() => onDelete(index)}
        className="p-1 hover:bg-red-500/20 rounded transition-all"
        title="删除站点"
      >
        <Trash2 className="w-3.5 h-3.5 text-red-500" />
      </button>
    </div>
  );
}
