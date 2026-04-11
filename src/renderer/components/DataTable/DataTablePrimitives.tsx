import React, { useCallback } from 'react';

export interface DataTableProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'standard' | 'grouped' | 'inset';
  blur?: boolean;
  staggerAnimation?: boolean;
  minWidth?: number | string;
  'aria-label'?: string;
  children: React.ReactNode;
}

export function DataTable({
  variant = 'standard',
  blur = true,
  staggerAnimation = false,
  minWidth,
  'aria-label': ariaLabel,
  children,
  className = '',
  style,
  ...props
}: DataTableProps) {
  const baseStyles = `
    relative
    rounded-[var(--radius-lg)]
    overflow-hidden
    [will-change:transform,opacity]
    [transform:translateZ(0)]
    transition-[transform,opacity]
    duration-[var(--duration-normal)]
    [transition-timing-function:var(--ease-standard)]
  `
    .replace(/\s+/g, ' ')
    .trim();

  const variantStyles = {
    standard: `
      bg-[var(--surface-1)]
      shadow-[var(--shadow-sm)]
    `
      .replace(/\s+/g, ' ')
      .trim(),
    grouped: `
      bg-[var(--surface-1)]
      shadow-[var(--shadow-sm)]
    `
      .replace(/\s+/g, ' ')
      .trim(),
    inset: `bg-transparent`.replace(/\s+/g, ' ').trim(),
  };

  const blurStyles =
    blur && variant !== 'inset'
      ? `
    backdrop-blur-[12px]
    [-webkit-backdrop-filter:blur(12px)]
    bg-opacity-95
    [will-change:backdrop-filter]
  `
          .replace(/\s+/g, ' ')
          .trim()
      : '';

  const combinedClassName = `
    data-table
    ${baseStyles}
    ${variantStyles[variant]}
    ${blurStyles}
    ${staggerAnimation ? 'data-table-stagger' : ''}
    ${className}
  `
    .replace(/\s+/g, ' ')
    .trim();

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

export interface DataTableHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  sticky?: boolean;
  children: React.ReactNode;
}

export function DataTableHeader({
  sticky = false,
  children,
  className = '',
  ...props
}: DataTableHeaderProps) {
  const baseStyles = `
    px-[var(--spacing-lg)]
    py-[var(--spacing-md)]
    bg-[var(--surface-2)]/80
    border-b
    border-[var(--line-soft)]
    text-[13px]
    font-semibold
    text-[var(--text-secondary)]
    uppercase
    tracking-[0.08em]
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
    data-table-header
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

export interface DataTableRowProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  selected?: boolean;
  disabled?: boolean;
  animationIndex?: number;
  focusable?: boolean;
  children: React.ReactNode;
}

export function DataTableRow({
  hoverable = true,
  selected = false,
  disabled = false,
  animationIndex,
  focusable = false,
  children,
  className = '',
  onKeyDown,
  ...props
}: DataTableRowProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        (e.target as HTMLElement).click();
      }
      onKeyDown?.(e);
    },
    [disabled, onKeyDown]
  );

  const baseStyles = `
    min-h-[44px]
    px-[var(--spacing-lg)]
    py-[var(--spacing-md)]
    border-b
    border-[var(--line-soft)]
    last:border-b-0
    [will-change:transform,opacity,background-color]
    [transform:translateZ(0)]
    transition-[transform,opacity,background-color]
    duration-[var(--duration-fast)]
    [transition-timing-function:var(--ease-standard)]
  `
    .replace(/\s+/g, ' ')
    .trim();

  const hoverStyles =
    hoverable && !disabled
      ? `
    hover:bg-[var(--surface-2)]
    cursor-pointer
  `
          .replace(/\s+/g, ' ')
          .trim()
      : '';

  const selectedStyles = selected ? `bg-[var(--accent-soft)]`.replace(/\s+/g, ' ').trim() : '';
  const disabledStyles = disabled
    ? `opacity-50 cursor-not-allowed`.replace(/\s+/g, ' ').trim()
    : '';
  const animationStyles =
    animationIndex !== undefined
      ? `animate-[slideIn_var(--duration-normal)_var(--ease-standard)_both]`
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  const focusStyles = focusable
    ? `
    focus-visible:outline-2
    focus-visible:outline-[var(--accent)]
    focus-visible:outline-offset-[-2px]
    focus-visible:bg-[var(--accent-soft)]
  `
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  const animationDelay =
    animationIndex !== undefined
      ? { animationDelay: `${Math.min(animationIndex * 50, 500)}ms` }
      : {};

  const combinedClassName = `
    data-table-row
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

export interface DataTableCellProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: 'left' | 'center' | 'right';
  header?: boolean;
  width?: number | string;
  children: React.ReactNode;
}

export function DataTableCell({
  align = 'left',
  header = false,
  width,
  children,
  className = '',
  style,
  ...props
}: DataTableCellProps) {
  const alignStyles = {
    left: 'text-left justify-start',
    center: 'text-center justify-center',
    right: 'text-right justify-end',
  };

  const headerStyles = header
    ? `
    text-[13px]
    font-semibold
    text-[var(--text-secondary)]
    uppercase
    tracking-[0.08em]
  `
        .replace(/\s+/g, ' ')
        .trim()
    : `
    text-[15px]
    text-[var(--text-primary)]
  `
        .replace(/\s+/g, ' ')
        .trim();

  const combinedClassName = `
    data-table-cell
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

export interface DataTableBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function DataTableBody({ children, className = '', ...props }: DataTableBodyProps) {
  const combinedClassName = `
    data-table-body
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

export interface DataTableDividerProps {
  inset?: boolean;
  className?: string;
}

export function DataTableDivider({ inset = false, className = '' }: DataTableDividerProps) {
  const baseStyles = `h-px bg-[var(--line-soft)]`.replace(/\s+/g, ' ').trim();
  const insetStyles = inset ? 'ml-[var(--spacing-lg)]' : '';
  const combinedClassName = `
    data-table-divider
    ${baseStyles}
    ${insetStyles}
    ${className}
  `
    .replace(/\s+/g, ' ')
    .trim();

  return <div className={combinedClassName} role="separator" aria-orientation="horizontal" />;
}

export interface DataTableEmptyProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function DataTableEmpty({
  icon,
  title = '暂无数据',
  description,
  action,
  className = '',
}: DataTableEmptyProps) {
  const combinedClassName = `
    data-table-empty
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
        <div className="mb-[var(--spacing-md)] text-[var(--text-secondary)]" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="text-[17px] font-semibold text-[var(--text-primary)] mb-[var(--spacing-xs)]">
        {title}
      </h3>
      {description && (
        <p className="text-[15px] text-[var(--text-secondary)] mb-[var(--spacing-lg)]">
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}
