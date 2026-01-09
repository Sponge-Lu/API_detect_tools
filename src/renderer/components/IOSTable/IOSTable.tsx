/**
 * @file src/renderer/components/IOSTable/IOSTable.tsx
 * @description iOS 风格表格组件
 *
 * 功能:
 * - iOS 原生风格样式（分组、圆角、背景色、无边框）
 * - 增加行高和内边距（至少 44px 高度）
 * - iOS 风格的分隔线
 * - 悬停状态（背景色变化）
 * - 优化表头样式（字体大小、颜色、间距）
 * - 支持列表项交错淡入动画
 * - 响应式布局支持（最小宽度、溢出滚动）
 * - 无障碍性支持（ARIA 属性、键盘导航）
 * - 性能优化（GPU 加速、will-change、仅使用 transform/opacity 动画）
 *
 * @version 2.1.13
 * @updated 2025-01-09 - iOS 原生风格优化：移除表格边框，使用阴影代替
 */

import React, { useCallback } from 'react';

/* ========== IOSTable 主组件 ========== */

export interface IOSTableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 表格变体 */
  variant?: 'standard' | 'grouped' | 'inset';
  /** 是否启用毛玻璃效果 */
  blur?: boolean;
  /** 是否启用交错淡入动画 */
  staggerAnimation?: boolean;
  /** 最小宽度（响应式支持） */
  minWidth?: number | string;
  /** 表格标题（用于无障碍） */
  'aria-label'?: string;
  /** 子元素 */
  children: React.ReactNode;
}

export function IOSTable({
  variant = 'standard',
  blur = true,
  staggerAnimation = false,
  minWidth,
  'aria-label': ariaLabel,
  children,
  className = '',
  style,
  ...props
}: IOSTableProps) {
  // 基础样式 - 添加 GPU 加速
  const baseStyles = `
    relative
    rounded-[var(--radius-lg)]
    overflow-hidden
    [will-change:transform,opacity]
    [transform:translateZ(0)]
    transition-[transform,opacity]
    duration-[var(--duration-normal)]
    [transition-timing-function:var(--ease-ios)]
  `
    .replace(/\s+/g, ' ')
    .trim();

  // 变体样式 - iOS 原生风格，无边框，使用阴影
  const variantStyles = {
    standard: `
      bg-[var(--ios-bg-secondary)]
      shadow-[var(--shadow-sm)]
    `
      .replace(/\s+/g, ' ')
      .trim(),

    grouped: `
      bg-[var(--ios-bg-secondary)]
      shadow-[var(--shadow-sm)]
    `
      .replace(/\s+/g, ' ')
      .trim(),

    inset: `
      bg-transparent
    `
      .replace(/\s+/g, ' ')
      .trim(),
  };

  // 毛玻璃效果 - 添加 GPU 加速
  const blurStyles =
    blur && variant !== 'inset'
      ? `
    backdrop-blur-[12px]
    [-webkit-backdrop-filter:blur(12px)]
    bg-opacity-95
    dark:bg-opacity-95
    [will-change:backdrop-filter]
  `
          .replace(/\s+/g, ' ')
          .trim()
      : '';

  const combinedClassName = `
    ios-table
    ${baseStyles}
    ${variantStyles[variant]}
    ${blurStyles}
    ${staggerAnimation ? 'ios-table-stagger' : ''}
    ${className}
  `
    .replace(/\s+/g, ' ')
    .trim();

  // 响应式样式
  const tableStyle = {
    ...style,
    ...(minWidth !== undefined
      ? { minWidth: typeof minWidth === 'number' ? `${minWidth}px` : minWidth }
      : {}),
  };

  return (
    <div
      className={combinedClassName}
      role="table"
      aria-label={ariaLabel}
      style={tableStyle}
      {...props}
    >
      {children}
    </div>
  );
}

/* ========== IOSTableHeader 表头组件 ========== */

export interface IOSTableHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 是否固定在顶部 */
  sticky?: boolean;
  /** 子元素 */
  children: React.ReactNode;
}

export function IOSTableHeader({
  sticky = false,
  children,
  className = '',
  ...props
}: IOSTableHeaderProps) {
  const baseStyles = `
    px-[var(--spacing-lg)]
    py-[var(--spacing-md)]
    bg-[rgba(0,0,0,0.03)]
    dark:bg-[rgba(255,255,255,0.03)]
    border-b
    border-[var(--ios-separator)]
    text-[13px]
    font-semibold
    text-[var(--ios-text-secondary)]
    uppercase
    tracking-[0.5px]
    select-none
  `
    .replace(/\s+/g, ' ')
    .trim();

  const stickyStyles = sticky
    ? `
    sticky
    top-0
    z-10
    backdrop-blur-[12px]
  `
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  const combinedClassName = `
    ios-table-header
    ${baseStyles}
    ${stickyStyles}
    ${className}
  `
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <div className={combinedClassName} role="rowgroup" {...props}>
      {children}
    </div>
  );
}

/* ========== IOSTableRow 行组件 ========== */

export interface IOSTableRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 是否启用悬停效果 */
  hoverable?: boolean;
  /** 是否选中 */
  selected?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** 动画延迟索引（用于交错动画） */
  animationIndex?: number;
  /** 是否可聚焦（用于键盘导航） */
  focusable?: boolean;
  /** 子元素 */
  children: React.ReactNode;
}

export function IOSTableRow({
  hoverable = true,
  selected = false,
  disabled = false,
  animationIndex,
  focusable = false,
  children,
  className = '',
  onKeyDown,
  ...props
}: IOSTableRowProps) {
  // 键盘导航处理
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;

      // Enter 或 Space 键激活
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        // 触发点击事件
        (e.target as HTMLElement).click();
      }

      // 调用原有的 onKeyDown
      onKeyDown?.(e);
    },
    [disabled, onKeyDown]
  );

  // 基础样式 - 确保最小高度 44px，添加 GPU 加速
  const baseStyles = `
    min-h-[44px]
    px-[var(--spacing-lg)]
    py-[var(--spacing-md)]
    border-b
    border-[var(--ios-separator)]
    last:border-b-0
    [will-change:transform,opacity,background-color]
    [transform:translateZ(0)]
    transition-[transform,opacity,background-color]
    duration-[var(--duration-fast)]
    [transition-timing-function:var(--ease-ios)]
  `
    .replace(/\s+/g, ' ')
    .trim();

  // 悬停效果
  const hoverStyles =
    hoverable && !disabled
      ? `
    hover:bg-[rgba(0,0,0,0.02)]
    dark:hover:bg-[rgba(255,255,255,0.02)]
    cursor-pointer
  `
          .replace(/\s+/g, ' ')
          .trim()
      : '';

  // 选中状态
  const selectedStyles = selected
    ? `
    bg-[rgba(0,122,255,0.08)]
    dark:bg-[rgba(10,132,255,0.08)]
  `
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  // 禁用状态
  const disabledStyles = disabled
    ? `
    opacity-50
    cursor-not-allowed
  `
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  // 交错动画样式
  const animationStyles =
    animationIndex !== undefined
      ? `
    animate-[slideIn_var(--duration-normal)_var(--ease-ios)_both]
  `
          .replace(/\s+/g, ' ')
          .trim()
      : '';

  // 焦点样式
  const focusStyles = focusable
    ? `
    focus-visible:outline-2
    focus-visible:outline-[var(--ios-blue)]
    focus-visible:outline-offset-[-2px]
    focus-visible:bg-[rgba(0,122,255,0.05)]
    dark:focus-visible:bg-[rgba(10,132,255,0.08)]
  `
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  // 计算动画延迟
  const animationDelay =
    animationIndex !== undefined
      ? { animationDelay: `${Math.min(animationIndex * 50, 500)}ms` }
      : {};

  const combinedClassName = `
    ios-table-row
    ${baseStyles}
    ${hoverStyles}
    ${selectedStyles}
    ${disabledStyles}
    ${animationStyles}
    ${focusStyles}
    ${className}
  `
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <div
      className={combinedClassName}
      role="row"
      style={animationDelay}
      aria-disabled={disabled}
      aria-selected={selected}
      tabIndex={focusable && !disabled ? 0 : undefined}
      onKeyDown={focusable ? handleKeyDown : onKeyDown}
      {...props}
    >
      {children}
    </div>
  );
}

/* ========== IOSTableCell 单元格组件 ========== */

export interface IOSTableCellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 对齐方式 */
  align?: 'left' | 'center' | 'right';
  /** 是否为表头单元格 */
  header?: boolean;
  /** 宽度 */
  width?: number | string;
  /** 子元素 */
  children: React.ReactNode;
}

export function IOSTableCell({
  align = 'left',
  header = false,
  width,
  children,
  className = '',
  style,
  ...props
}: IOSTableCellProps) {
  // 对齐样式
  const alignStyles = {
    left: 'text-left justify-start',
    center: 'text-center justify-center',
    right: 'text-right justify-end',
  };

  // 表头样式
  const headerStyles = header
    ? `
    text-[13px]
    font-semibold
    text-[var(--ios-text-secondary)]
    uppercase
    tracking-[0.5px]
  `
        .replace(/\s+/g, ' ')
        .trim()
    : `
    text-[15px]
    text-[var(--ios-text-primary)]
  `
        .replace(/\s+/g, ' ')
        .trim();

  const combinedClassName = `
    ios-table-cell
    flex
    items-center
    ${alignStyles[align]}
    ${headerStyles}
    ${className}
  `
    .replace(/\s+/g, ' ')
    .trim();

  const cellStyle = {
    ...style,
    ...(width !== undefined ? { width: typeof width === 'number' ? `${width}px` : width } : {}),
  };

  return (
    <div
      className={combinedClassName}
      role={header ? 'columnheader' : 'cell'}
      style={cellStyle}
      {...props}
    >
      {children}
    </div>
  );
}

/* ========== IOSTableBody 表体组件 ========== */

export interface IOSTableBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 子元素 */
  children: React.ReactNode;
}

export function IOSTableBody({ children, className = '', ...props }: IOSTableBodyProps) {
  const combinedClassName = `
    ios-table-body
    ${className}
  `
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <div className={combinedClassName} role="rowgroup" {...props}>
      {children}
    </div>
  );
}

/* ========== IOSTableDivider 分隔线组件 ========== */

export interface IOSTableDividerProps {
  /** 是否缩进（左侧留出空间） */
  inset?: boolean;
  /** 自定义类名 */
  className?: string;
}

export function IOSTableDivider({ inset = false, className = '' }: IOSTableDividerProps) {
  const baseStyles = `
    h-px
    bg-[var(--ios-separator)]
  `
    .replace(/\s+/g, ' ')
    .trim();

  const insetStyles = inset ? 'ml-[var(--spacing-lg)]' : '';

  const combinedClassName = `
    ios-table-divider
    ${baseStyles}
    ${insetStyles}
    ${className}
  `
    .replace(/\s+/g, ' ')
    .trim();

  return <div className={combinedClassName} role="separator" aria-orientation="horizontal" />;
}

/* ========== IOSTableEmpty 空状态组件 ========== */

export interface IOSTableEmptyProps {
  /** 图标 */
  icon?: React.ReactNode;
  /** 标题 */
  title?: string;
  /** 描述 */
  description?: string;
  /** 操作按钮 */
  action?: React.ReactNode;
  /** 自定义类名 */
  className?: string;
}

export function IOSTableEmpty({
  icon,
  title = '暂无数据',
  description,
  action,
  className = '',
}: IOSTableEmptyProps) {
  const combinedClassName = `
    ios-table-empty
    flex
    flex-col
    items-center
    justify-center
    py-[var(--spacing-4xl)]
    px-[var(--spacing-lg)]
    text-center
    ${className}
  `
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <div className={combinedClassName} role="status" aria-live="polite">
      {icon && (
        <div className="mb-[var(--spacing-md)] text-[var(--ios-gray)]" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="text-[17px] font-semibold text-[var(--ios-text-primary)] mb-[var(--spacing-xs)]">
        {title}
      </h3>
      {description && (
        <p className="text-[15px] text-[var(--ios-text-secondary)] mb-[var(--spacing-lg)]">
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}
