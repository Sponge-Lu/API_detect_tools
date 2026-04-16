import { useCallback, useRef } from 'react';
import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react';
import { COLUMN_MAX_WIDTH, COLUMN_MIN_WIDTH } from '../../../shared/constants';
import type { SiteType } from '../../../shared/types/site';
import type { SortField, SortOrder } from '../../store/uiStore';

interface SiteListColumn {
  label: string;
  field?: SortField;
  centered?: boolean;
}

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
  { label: '站点类型', centered: true },
  { label: '余额', field: 'balance' },
  { label: '今日消费', field: 'todayUsage' },
  { label: 'Token统计', field: 'totalTokens', centered: true },
  { label: '请求统计', centered: true },
  { label: '模型数', field: 'modelCount', centered: true },
  { label: 'CLI可用性', centered: true },
];

function SortIndicator({ order }: { order: SortOrder }) {
  return order === 'desc' ? (
    <ArrowDown className="h-3 w-3" strokeWidth={2.2} />
  ) : (
    <ArrowUp className="h-3 w-3" strokeWidth={2.2} />
  );
}

export function SiteListHeader({
  columnWidths,
  onColumnWidthChange,
  sortField = null,
  sortOrder = 'desc',
  onToggleSort,
  activeSiteTypeFilter = null,
  siteTypeFilterOptions = [],
  onSiteTypeFilterChange,
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
        const nextWidth = Math.max(
          COLUMN_MIN_WIDTH,
          Math.min(COLUMN_MAX_WIDTH, startWidth + delta)
        );
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

  return (
    <div
      className={`sticky top-0 z-20 grid items-center gap-x-1 border-b border-[var(--line-soft)] bg-[var(--surface-1)]/95 px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)] backdrop-blur ${className}`.trim()}
      style={{
        gridTemplateColumns: `${columnWidths.map(width => `${width}px`).join(' ')} 1fr`,
      }}
    >
      {columns.map((column, index) => {
        const isActive = column.field !== undefined && sortField === column.field;
        const clickable = column.field !== undefined && onToggleSort !== undefined;
        const isSiteTypeFilterColumn =
          column.label === '站点类型' && onSiteTypeFilterChange !== undefined;
        const activeSiteTypeOption =
          activeSiteTypeFilter === null
            ? null
            : (siteTypeFilterOptions.find(option => option.value === activeSiteTypeFilter) ?? null);

        return (
          <div key={column.label} className="relative flex items-center">
            {isSiteTypeFilterColumn ? (
              <div
                className={`group relative flex w-full items-center justify-start px-1 ${
                  activeSiteTypeOption ? 'text-[var(--accent)]' : ''
                }`.trim()}
                title={
                  activeSiteTypeOption
                    ? `按站点类型筛选：${activeSiteTypeOption.label}`
                    : '按站点类型筛选'
                }
              >
                <div className="pointer-events-none flex items-center justify-center gap-1 transition-colors group-hover:text-[var(--text-primary)] group-focus-within:text-[var(--text-primary)]">
                  <span className="truncate">站点类型</span>
                  <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2.2} />
                </div>
                <select
                  aria-label="站点类型筛选"
                  value={activeSiteTypeFilter ?? ''}
                  onChange={event =>
                    onSiteTypeFilterChange(
                      event.target.value ? (event.target.value as SiteTypeFilterValue) : null
                    )
                  }
                  className="absolute inset-0 h-full w-full cursor-pointer appearance-none border-0 bg-transparent opacity-0 outline-none"
                  title="按站点类型筛选"
                >
                  <option value="">站点类型</option>
                  {siteTypeFilterOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.count !== undefined
                        ? `${option.label} (${option.count})`
                        : option.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : clickable ? (
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
            ) : (
              <span className={column.centered ? 'w-full text-center' : ''}>{column.label}</span>
            )}

            {index < columns.length - 1 && (
              <div
                className="absolute bottom-0 right-0 top-0 w-1 cursor-col-resize transition-colors hover:bg-[var(--line-strong)]"
                onMouseDown={moveEvent => handleMouseDown(moveEvent, index)}
              />
            )}
          </div>
        );
      })}

      <div className="flex items-center justify-end gap-0.5">{actions ?? <span>操作</span>}</div>
    </div>
  );
}
