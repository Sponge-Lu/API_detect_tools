import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { COLUMN_MAX_WIDTH, COLUMN_MIN_WIDTH } from '../../../shared/constants';
import {
  compareRouteHistoryEndpoints,
  getRouteHistoryEndpointLabel,
  normalizeRouteHistoryEndpoint,
  ROUTE_HISTORY_ENDPOINTS,
  type HistoryEndpointTrack,
} from '../../../shared/types/route-proxy';
import type { SiteType } from '../../../shared/types/site';
import { HISTORY_POLL_INTERVAL_MS } from '../Route/Usability/HistoryBucketBars';
import { useUIStore } from '../../store/uiStore';
import type { SortField, SortOrder } from '../../store/uiStore';

interface SiteListColumn {
  label: string;
  field?: SortField;
  centered?: boolean;
  historySelector?: boolean;
}

// 保留这些导出以兼容 SitesPage（虽然列表中不再使用站点类型筛选）
export const UNKNOWN_SITE_TYPE_FILTER = '__unknown__';
export type SiteTypeFilterValue = SiteType | typeof UNKNOWN_SITE_TYPE_FILTER;

export interface SiteTypeFilterOption {
  value: SiteTypeFilterValue;
  label: string;
  count?: number;
}

export interface SiteListHeaderProps {
  columnWidths: number[];
  onColumnWidthChange: (index: number, width: number) => void;
  sortField?: SortField | null;
  sortOrder?: SortOrder;
  onToggleSort?: (field: SortField) => void;
  onResetSort?: () => void;
  activeSiteTypeFilter?: SiteTypeFilterValue | null;
  siteTypeFilterOptions?: SiteTypeFilterOption[];
  onSiteTypeFilterChange?: (value: SiteTypeFilterValue | null) => void;
  actions?: React.ReactNode;
  className?: string;
}

const ALL_COLUMNS: SiteListColumn[] = [
  { label: '站点', field: 'name' },
  { label: '账户' },
  { label: '刷新时间' },
  { label: '余额', field: 'balance', centered: true },
  { label: '今日消费', field: 'todayUsage', centered: true },
  { label: '模型数', field: 'modelCount', centered: true },
  { label: 'LDC', field: 'ldcRatio', centered: true },
  { label: '请求端点', centered: true, historySelector: true },
];

function SortIndicator({ order }: { order: SortOrder }) {
  return order === 'desc' ? (
    <ArrowDown className="h-3 w-3" strokeWidth={2.2} />
  ) : (
    <ArrowUp className="h-3 w-3" strokeWidth={2.2} />
  );
}

function clampColumnWidth(width: number): number {
  return Math.max(COLUMN_MIN_WIDTH, Math.min(COLUMN_MAX_WIDTH, width));
}

function getEndpointOptions(data: unknown): string[] {
  const discoveredEndpoints = Array.isArray(data)
    ? data.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const track = item as Partial<HistoryEndpointTrack>;
        const rawEndpoint =
          typeof track.targetEndpoint === 'string' ? track.targetEndpoint.trim() : '';
        const endpoint = normalizeRouteHistoryEndpoint(rawEndpoint);
        return endpoint ? [endpoint] : [];
      })
    : [];

  return Array.from(
    new Set<string>([...ROUTE_HISTORY_ENDPOINTS, ...discoveredEndpoints])
  ).sort(compareRouteHistoryEndpoints);
}

function HistoryHeaderControls() {
  const selectedEndpoint = useUIStore(state => state.historyTargetEndpoint);
  const setSelectedEndpoint = useUIStore(state => state.setHistoryTargetEndpoint);
  const [endpoints, setEndpoints] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const loadEndpoints = async () => {
      const routeApi = window.electronAPI?.route;
      if (!routeApi?.getHistoryBuckets) return;

      try {
        const response = await routeApi.getHistoryBuckets({
          window: '48h',
          bucketSize: '2h',
        });
        if (!cancelled && response?.success) {
          setEndpoints(getEndpointOptions(response.data));
        }
      } catch {
        // History is a best-effort visualization; keep the last endpoint list on a poll failure.
      }
    };

    void loadEndpoints();
    pollTimer = setInterval(() => {
      if (!cancelled) void loadEndpoints();
    }, HISTORY_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  useEffect(() => {
    if (endpoints.length === 0) {
      if (selectedEndpoint !== null) setSelectedEndpoint(null);
      return;
    }
    if (selectedEndpoint && endpoints.includes(selectedEndpoint)) return;
    setSelectedEndpoint(endpoints[0]);
  }, [endpoints, selectedEndpoint, setSelectedEndpoint]);

  return (
    <div
      className="flex min-w-0 w-full items-center normal-case tracking-normal"
      onClick={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        role="group"
        aria-label="请求端点选择"
      >
        {endpoints.length > 0 ? (
          endpoints.map(endpoint => {
            const isSelected = selectedEndpoint === endpoint;
            const endpointLabel = getRouteHistoryEndpointLabel(endpoint);
            const endpointTitle =
              endpointLabel === endpoint ? endpoint : `${endpointLabel} · ${endpoint}`;
            return (
              <button
                key={endpoint}
                type="button"
                title={`切换请求端点: ${endpointTitle}`}
                aria-label={`选择端点 ${endpointLabel}`}
                aria-pressed={isSelected}
                data-testid="history-endpoint-option"
                onClick={event => {
                  event.stopPropagation();
                  setSelectedEndpoint(endpoint);
                }}
                className={`max-w-[10rem] shrink-0 truncate rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[10px] transition-colors ${
                  isSelected
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-tertiary)] hover:border-[var(--line-soft)] hover:text-[var(--text-primary)]'
                }`}
              >
                {endpointLabel}
              </button>
            );
          })
        ) : (
          <span className="truncate text-[10px] text-[var(--text-tertiary)]">目标端点</span>
        )}
      </div>
      <span className="sr-only">请求端点</span>
    </div>
  );
}

export function SiteListHeader({
  columnWidths,
  onColumnWidthChange,
  sortField = null,
  sortOrder = 'desc',
  onToggleSort,
  actions,
  className = '',
}: SiteListHeaderProps) {
  const resizingRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);
  const columns = ALL_COLUMNS.slice(0, columnWidths.length);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent, index: number) => {
      event.preventDefault();
      resizingRef.current = {
        index,
        startX: event.clientX,
        startWidth: columnWidths[index],
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!resizingRef.current) return;
        const { index: activeIndex, startX, startWidth } = resizingRef.current;
        const delta = moveEvent.clientX - startX;
        const nextWidth = clampColumnWidth(startWidth + delta);
        onColumnWidthChange(activeIndex, nextWidth);
      };

      const handleMouseUp = () => {
        resizingRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [columnWidths, onColumnWidthChange]
  );

  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      let nextWidth: number | null = null;
      const currentWidth = columnWidths[index];

      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        nextWidth = currentWidth - 10;
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        nextWidth = currentWidth + 10;
      } else if (event.key === 'Home') {
        nextWidth = COLUMN_MIN_WIDTH;
      } else if (event.key === 'End') {
        nextWidth = COLUMN_MAX_WIDTH;
      }

      if (nextWidth === null) return;

      event.preventDefault();
      event.stopPropagation();
      onColumnWidthChange(index, clampColumnWidth(nextWidth));
    },
    [columnWidths, onColumnWidthChange]
  );

  return (
    <div
      className={`sticky top-0 z-20 grid items-center gap-x-1 border-b border-[var(--line-soft)] bg-[var(--surface-1)]/95 px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)] backdrop-blur ${className}`.trim()}
      style={{
        gridTemplateColumns: `${columnWidths.map(width => `${width}px`).join(' ')}${actions ? ' 1fr' : ''}`,
      }}
    >
      {columns.map((column, index) => {
        const isActive = column.field !== undefined && sortField === column.field;
        const clickable = column.field !== undefined && onToggleSort !== undefined;
        const isHistoryColumn = column.historySelector === true;

        return (
          <div key={column.label} className="relative flex items-center">
            {clickable ? (
              <button
                type="button"
                onClick={() => onToggleSort?.(column.field!)}
                className={`flex w-full items-center gap-1 transition-colors hover:text-[var(--text-primary)] ${
                  column.centered ? 'justify-center' : ''
                } ${isActive ? 'text-[var(--accent)]' : ''}`.trim()}
                title={`按${column.label}排序`}
              >
                <span>{column.label}</span>
                {isActive ? <SortIndicator order={sortOrder} /> : null}
              </button>
            ) : isHistoryColumn ? (
              <HistoryHeaderControls />
            ) : (
              <span className={column.centered ? 'w-full text-center' : ''}>{column.label}</span>
            )}

            <div
              role="separator"
              aria-label={`调整${column.label}列宽`}
              aria-orientation="vertical"
              aria-valuemin={COLUMN_MIN_WIDTH}
              aria-valuemax={COLUMN_MAX_WIDTH}
              aria-valuenow={columnWidths[index]}
              title={`调整${column.label}列宽`}
              tabIndex={0}
              className="absolute bottom-0 right-0 top-0 w-1 cursor-col-resize transition-colors hover:bg-[var(--line-strong)] focus-visible:bg-[var(--accent)] focus-visible:outline-none"
              onMouseDown={moveEvent => handleMouseDown(moveEvent, index)}
              onKeyDown={keyEvent => handleResizeKeyDown(keyEvent, index)}
            />
          </div>
        );
      })}

      <div className="flex items-center justify-end gap-0.5">{actions}</div>
    </div>
  );
}
