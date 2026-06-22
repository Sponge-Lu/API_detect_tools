import { useCallback, useRef } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { COLUMN_MAX_WIDTH, COLUMN_MIN_WIDTH } from '../../../shared/constants';
import type { SiteType } from '../../../shared/types/site';
import type { RouteCliType } from '../../../shared/types/route-proxy';
import { useUIStore } from '../../store/uiStore';
import type { HistoryMode } from '../Route/Usability/HistoryBucketBars';
import type { SortField, SortOrder } from '../../store/uiStore';
import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../assets/cli-icons/gemini.svg';

interface SiteListColumn {
  label: string;
  field?: SortField;
  centered?: boolean;
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
  { label: '余额', field: 'balance' },
  { label: '今日消费', field: 'todayUsage' },
  { label: '模型数', field: 'modelCount', centered: true },
  { label: 'LDC', field: 'ldcRatio', centered: true },
  { label: 'History', centered: true },
];

function SortIndicator({ order }: { order: SortOrder }) {
  return order === 'desc' ? (
    <ArrowDown className="h-3 w-3" strokeWidth={2.2} />
  ) : (
    <ArrowUp className="h-3 w-3" strokeWidth={2.2} />
  );
}

interface CliTypeButton {
  type: RouteCliType;
  label: string;
  title: string;
  aria: string;
  icon: string;
  iconClassName: string;
}

const CLI_TYPES: CliTypeButton[] = [
  {
    type: 'claudeCode',
    label: 'Claude Code',
    title: 'Claude Code',
    aria: '选择 Claude Code',
    icon: ClaudeCodeIcon,
    iconClassName: 'h-[18px] w-[18px]',
  },
  {
    type: 'codex',
    label: 'Codex',
    title: 'Codex',
    aria: '选择 Codex',
    icon: CodexIcon,
    iconClassName: 'h-5 w-5',
  },
  {
    type: 'geminiCli',
    label: 'Gemini CLI',
    title: 'Gemini CLI',
    aria: '选择 Gemini CLI',
    icon: GeminiIcon,
    iconClassName: 'h-5 w-5',
  },
];

const MODES: { mode: HistoryMode; label: string; title: string; aria: string }[] = [
  { mode: 'combined', label: '综合', title: '综合模式（探测 + 路由）', aria: '综合模式' },
  { mode: 'probe', label: '探测', title: '仅探测模式', aria: '仅探测' },
  { mode: 'route', label: '路由', title: '仅路由模式', aria: '仅路由' },
];

function clampColumnWidth(width: number): number {
  return Math.max(COLUMN_MIN_WIDTH, Math.min(COLUMN_MAX_WIDTH, width));
}

function HistoryHeaderControls() {
  const cliType = useUIStore(state => state.historyCliType);
  const mode = useUIStore(state => state.historyMode);
  const setCliType = useUIStore(state => state.setHistoryCliType);
  const setMode = useUIStore(state => state.setHistoryMode);

  return (
    <div
      className="flex w-full items-center justify-between gap-2 normal-case tracking-normal"
      onClick={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
    >
      <div className="flex items-center gap-1">
        {CLI_TYPES.map(({ type, label, title, aria, icon, iconClassName }) => (
          <button
            key={type}
            type="button"
            title={title}
            aria-label={aria}
            onClick={event => {
              event.stopPropagation();
              setCliType(type);
            }}
            className={`flex h-6 w-6 items-center justify-center transition-opacity ${
              cliType === type ? 'opacity-100' : 'opacity-45 grayscale hover:opacity-80'
            }`}
          >
            <img src={icon} alt={label} className={`${iconClassName} shrink-0`} />
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        {MODES.map(({ mode: value, label, title, aria }) => (
          <button
            key={value}
            type="button"
            title={title}
            aria-label={aria}
            onClick={event => {
              event.stopPropagation();
              setMode(value);
            }}
            className={`h-6 rounded-[var(--radius-md)] border px-2 text-[11px] font-medium transition-colors ${
              mode === value
                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                : 'border-[var(--line-soft)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
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
        gridTemplateColumns: `${columnWidths.map(width => `${width}px`).join(' ')} 1fr`,
      }}
    >
      {columns.map((column, index) => {
        const isActive = column.field !== undefined && sortField === column.field;
        const clickable = column.field !== undefined && onToggleSort !== undefined;
        const isHistoryColumn = column.label === 'History';

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
              <div className="w-full">
                <HistoryHeaderControls />
              </div>
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
