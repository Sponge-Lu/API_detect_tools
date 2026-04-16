/**
 * 输入: SiteCardActionsProps (操作回调、加载状态、展开状态、签到统计)
 * 输出: React 组件 (站点卡片操作按钮 UI)
 * 定位: 展示层 - 站点卡片操作按钮组件，承载主行高频动作与低频动作菜单
 *
 * 并发刷新: 使用 isDetecting (boolean) 替代 detectingSite (string) 控制按钮禁用和 spinner，
 * 支持多站点同时刷新
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/SiteCard/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Calendar,
  CheckCircle,
  ChevronDown,
  Ellipsis,
  Fuel,
  Loader2,
  Pencil,
  RefreshCw,
  Timer,
  TimerOff,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type { SiteCardActionsProps } from './types';

const MENU_MIN_WIDTH = 180;
const MENU_FALLBACK_HEIGHT = 196;
const MENU_GAP = 8;
const VIEWPORT_MARGIN = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getMenuDimensions(menuEl: HTMLDivElement | null) {
  return {
    width: Math.max(menuEl?.offsetWidth || 0, MENU_MIN_WIDTH),
    height: Math.max(menuEl?.offsetHeight || 0, MENU_FALLBACK_HEIGHT),
  };
}

function getBoundedLeft(preferredLeft: number, width: number) {
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
  return clamp(preferredLeft, VIEWPORT_MARGIN, maxLeft);
}

function getBoundedTop(preferredTop: number, height: number) {
  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
  return clamp(preferredTop, VIEWPORT_MARGIN, maxTop);
}

function getButtonMenuPosition(rect: DOMRect, menuEl: HTMLDivElement | null) {
  const { width, height } = getMenuDimensions(menuEl);
  const left = getBoundedLeft(rect.right - width, width);
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
  const spaceAbove = rect.top - VIEWPORT_MARGIN;
  const preferredTop =
    spaceBelow >= height || spaceBelow >= spaceAbove
      ? rect.bottom + MENU_GAP
      : rect.top - height - MENU_GAP;

  return {
    top: getBoundedTop(preferredTop, height),
    left,
  };
}

function getCursorMenuPosition(clientX: number, clientY: number, menuEl: HTMLDivElement | null) {
  const { width, height } = getMenuDimensions(menuEl);
  return {
    left: getBoundedLeft(clientX, width),
    top: getBoundedTop(clientY, height),
  };
}

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
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<'button' | 'cursor'>('button');
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const cursorAnchorRef = useRef({ x: 0, y: 0 });

  const lowFrequencyActions = useMemo(
    () => [
      {
        key: 'edit',
        label: editAccount ? '编辑账户' : '编辑站点',
        destructive: false,
        onClick: () => onEdit(index, editAccount),
      },
      {
        key: 'delete-account',
        label: '删除账户',
        destructive: true,
        onClick: () => onDelete(index),
      },
      ...(onAddAccount
        ? [
            {
              key: 'add-account',
              label: '添加账户',
              destructive: false,
              onClick: onAddAccount,
            },
          ]
        : []),
    ],
    [editAccount, index, onAddAccount, onDelete, onEdit]
  );

  useEffect(() => {
    if (!isMoreMenuOpen) return;

    const updateMenuPosition = () => {
      if (menuAnchor === 'button') {
        const rect = moreButtonRef.current?.getBoundingClientRect();
        if (!rect) return;
        setMenuPosition(getButtonMenuPosition(rect, moreMenuRef.current));
        return;
      }

      setMenuPosition(
        getCursorMenuPosition(
          cursorAnchorRef.current.x,
          cursorAnchorRef.current.y,
          moreMenuRef.current
        )
      );
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(event.target as Node) &&
        moreButtonRef.current &&
        !moreButtonRef.current.contains(event.target as Node)
      ) {
        setIsMoreMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMoreMenuOpen(false);
      }
    };

    const rafId = window.requestAnimationFrame(updateMenuPosition);
    window.addEventListener('resize', updateMenuPosition);
    if (menuAnchor === 'button') {
      window.addEventListener('scroll', updateMenuPosition, true);
    }
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updateMenuPosition);
      if (menuAnchor === 'button') {
        window.removeEventListener('scroll', updateMenuPosition, true);
      }
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isMoreMenuOpen, menuAnchor]);

  const openButtonMenu = () => {
    const rect = moreButtonRef.current?.getBoundingClientRect();
    if (!rect) return;

    setMenuAnchor('button');
    setMenuPosition(getButtonMenuPosition(rect, moreMenuRef.current));
    setIsMoreMenuOpen(true);
  };

  const openCursorMenu = (clientX: number, clientY: number) => {
    setMenuAnchor('cursor');
    cursorAnchorRef.current = { x: clientX, y: clientY };
    setMenuPosition(getCursorMenuPosition(clientX, clientY, moreMenuRef.current));
    setIsMoreMenuOpen(true);
  };

  return (
    <div
      className="ml-1 flex shrink-0 items-center gap-0.5"
      onContextMenu={event => {
        event.preventDefault();
        event.stopPropagation();
        openCursorMenu(event.clientX, event.clientY);
      }}
    >
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
                      onCheckIn(site);
                    }}
                    disabled={checkingIn === site.name}
                    className="rounded-[var(--radius-sm)] p-[3px] text-[var(--warning)] transition-colors hover:bg-[var(--warning-soft)] disabled:opacity-50"
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
        onClick={() => onExpand(site.name)}
        className="rounded-[var(--radius-sm)] p-[3px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
        title={isExpanded ? '收起详情' : '展开详情'}
        aria-label={isExpanded ? '收起详情' : '展开详情'}
        aria-expanded={isExpanded}
      >
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>

      <button
        onClick={() => onDetect(site)}
        disabled={isDetecting}
        className="rounded-[var(--radius-sm)] p-[3px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] disabled:opacity-50"
        title="刷新检测"
        aria-label="刷新检测"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isDetecting ? 'animate-spin' : ''}`} strokeWidth={2} />
      </button>

      <button
        onClick={() => onToggleAutoRefresh?.()}
        className={`rounded-[var(--radius-sm)] p-[3px] transition-colors ${
          autoRefreshEnabled
            ? 'bg-[var(--success-soft)] text-[var(--success)] hover:opacity-90'
            : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]'
        }`}
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

      <button
        ref={moreButtonRef}
        type="button"
        onClick={event => {
          event.stopPropagation();
          if (isMoreMenuOpen && menuAnchor === 'button') {
            setIsMoreMenuOpen(false);
            return;
          }
          openButtonMenu();
        }}
        className={`rounded-[var(--radius-sm)] p-[3px] transition-colors ${
          isMoreMenuOpen
            ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]'
        }`}
        title="更多操作"
        aria-label="更多操作"
        aria-expanded={isMoreMenuOpen}
      >
        <Ellipsis className="w-3.5 h-3.5" strokeWidth={2} />
      </button>

      {isMoreMenuOpen &&
        createPortal(
          <div
            ref={moreMenuRef}
            className="fixed z-[80] min-w-[180px] rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-1)]/98 p-1.5 shadow-[var(--shadow-lg)] backdrop-blur-[14px]"
            style={{ top: menuPosition.top, left: menuPosition.left }}
            role="menu"
          >
            {lowFrequencyActions.map(action => (
              <button
                key={action.key}
                type="button"
                onClick={event => {
                  event.stopPropagation();
                  action.onClick();
                  setIsMoreMenuOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition-colors ${
                  action.destructive
                    ? 'text-[var(--danger)] hover:bg-[var(--danger-soft)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]'
                }`}
              >
                {action.key === 'edit' && <Pencil className="w-3.5 h-3.5" strokeWidth={2} />}
                {action.key === 'delete-account' && (
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                )}
                {action.key === 'add-account' && (
                  <UserPlus className="w-3.5 h-3.5" strokeWidth={2} />
                )}
                <span>{action.label}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
