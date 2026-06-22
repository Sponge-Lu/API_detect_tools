/**
 * @file src/renderer/components/dialogs/PanelSection.tsx
 * @description 面板通用折叠分区原语
 *
 * 输入: 标题、展开状态（受控/非受控）、副标题、右侧操作槽位、子内容
 * 输出: 单一折叠卡片区块（接入点详情面板与 CLI 编辑器共享）
 * 定位: 展示层 - 窄面板内折叠分区原语，统一中性 token 风格
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';

export interface PanelSectionProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** 默认展开。受控模式由 `expanded` + `onExpandedChange` 控制 */
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** 折叠功能开关。`false` 表示不可折叠（始终展开、隐藏箭头） */
  collapsible?: boolean;
  /** 标题右侧操作槽（仅在 header 中渲染，不随折叠状态变化） */
  actions?: ReactNode;
  /** 头部附加 className */
  headerClassName?: string;
  /** 主体附加 className */
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
}

export function PanelSection({
  title,
  subtitle,
  defaultExpanded = true,
  expanded: expandedProp,
  onExpandedChange,
  collapsible = true,
  actions,
  headerClassName,
  bodyClassName,
  className,
  children,
}: PanelSectionProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isControlled = expandedProp !== undefined;
  const expanded = isControlled ? expandedProp : internalExpanded;

  const handleToggle = () => {
    if (!collapsible) return;
    const next = !expanded;
    if (!isControlled) {
      setInternalExpanded(next);
    }
    onExpandedChange?.(next);
  };

  const headerInteractive = collapsible;

  return (
    <section
      className={`rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] ${
        className ?? ''
      }`}
    >
      <header
        className={`flex items-center justify-between gap-2 px-4 py-3 ${
          headerInteractive ? 'cursor-pointer select-none hover:bg-[var(--surface-3)]' : ''
        } ${headerClassName ?? ''}`}
        onClick={collapsible ? handleToggle : undefined}
        role={collapsible ? 'button' : undefined}
        aria-expanded={collapsible ? expanded : undefined}
        tabIndex={collapsible ? 0 : undefined}
        onKeyDown={
          collapsible
            ? event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleToggle();
                }
              }
            : undefined
        }
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {collapsible ? (
            <ChevronDown
              className={`h-4 w-4 flex-shrink-0 text-[var(--text-secondary)] transition-transform ${
                expanded ? 'rotate-0' : '-rotate-90'
              }`}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</div>
            {subtitle ? (
              <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{subtitle}</div>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div
            className="flex flex-shrink-0 items-center gap-1.5"
            onClick={event => event.stopPropagation()}
          >
            {actions}
          </div>
        ) : null}
      </header>
      {expanded ? (
        <div className={`space-y-3 px-4 pb-4 pt-1 ${bodyClassName ?? ''}`}>{children}</div>
      ) : null}
    </section>
  );
}
