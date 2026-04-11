import { useCallback, useRef } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { COLUMN_MAX_WIDTH, COLUMN_MIN_WIDTH } from '../../../shared/constants';
import type { SortField, SortOrder } from '../../store/uiStore';

interface SiteListColumn {
  label: string;
  field?: SortField;
  centered?: boolean;
}

export interface SiteListHeaderProps {
  columnWidths: number[];
  onColumnWidthChange: (index: number, width: number) => void;
  sortField?: SortField | null;
  sortOrder?: SortOrder;
  onToggleSort?: (field: SortField) => void;
  onResetSort?: () => void;
  actions?: React.ReactNode;
  className?: string;
}

const ALL_COLUMNS: SiteListColumn[] = [
  { label: '站点', field: 'name' },
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
