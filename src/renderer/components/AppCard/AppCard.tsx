import React, { useEffect, useId, useRef, useState } from 'react';

export interface AppCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'standard' | 'elevated' | 'grouped';
  blur?: boolean;
  hoverable?: boolean;
  expanded?: boolean;
  expandContent?: React.ReactNode;
  draggable?: boolean;
  isDragOver?: boolean;
  disabled?: boolean;
  focusable?: boolean;
  'aria-label'?: string;
  children: React.ReactNode;
}

export function AppCard({
  variant = 'standard',
  blur = true,
  hoverable = true,
  expanded = false,
  expandContent,
  draggable = false,
  isDragOver = false,
  disabled = false,
  focusable = false,
  'aria-label': ariaLabel,
  children,
  className = '',
  ...props
}: AppCardProps) {
  const expandRef = useRef<HTMLDivElement>(null);
  const [expandHeight, setExpandHeight] = useState<number>(0);
  const expandId = useId();

  useEffect(() => {
    if (expandRef.current) {
      setExpandHeight(expandRef.current.scrollHeight);
    }
  }, [expandContent, expanded]);

  const baseStyles = `
    relative
    rounded-[var(--radius-lg)]
    overflow-hidden
    [will-change:transform,opacity]
    [backface-visibility:hidden]
    [transform:translateZ(0)]
  `
    .replace(/\s+/g, ' ')
    .trim();

  const transitionStyles = `
    transition-[transform,opacity,box-shadow]
    duration-[var(--duration-normal)]
    [transition-timing-function:var(--ease-standard)]
  `
    .replace(/\s+/g, ' ')
    .trim();

  const variantStyles = {
    standard: `
      bg-[var(--surface-1)]
      border-2 border-transparent
      shadow-[var(--shadow-md)]
    `
      .replace(/\s+/g, ' ')
      .trim(),
    elevated: `
      bg-[var(--surface-1)]
      border-2 border-transparent
      shadow-[var(--shadow-lg)]
    `
      .replace(/\s+/g, ' ')
      .trim(),
    grouped: `
      bg-[var(--surface-1)]
      border-2 border-transparent
      shadow-[var(--shadow-sm)]
    `
      .replace(/\s+/g, ' ')
      .trim(),
  };

  const blurStyles = blur
    ? `
    backdrop-blur-[12px]
    [-webkit-backdrop-filter:blur(12px)]
    bg-opacity-95
    [will-change:backdrop-filter]
  `
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  const hoverStyles =
    hoverable && !disabled
      ? `
    hover:shadow-[var(--shadow-lg)]
    hover:-translate-y-0.5
  `
          .replace(/\s+/g, ' ')
          .trim()
      : '';

  const dragOverStyles = isDragOver
    ? `
    border-[var(--accent)]
    scale-[1.02]
    shadow-[var(--shadow-xl)]
    [will-change:transform,border-color]
  `
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  const disabledStyles = disabled
    ? `
    opacity-60
    cursor-not-allowed
  `
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  const draggableStyles = draggable ? 'cursor-move' : '';

  const focusStyles = focusable
    ? `
    focus-visible:outline-2
    focus-visible:outline-[var(--accent)]
    focus-visible:outline-offset-2
  `
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  const combinedClassName = `
    ${baseStyles}
    ${transitionStyles}
    ${variantStyles[variant]}
    ${blurStyles}
    ${hoverStyles}
    ${dragOverStyles}
    ${disabledStyles}
    ${draggableStyles}
    ${focusStyles}
    ${className}
  `
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <div
      className={combinedClassName}
      draggable={draggable}
      tabIndex={focusable && !disabled ? 0 : undefined}
      role={focusable ? 'article' : undefined}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      aria-expanded={expandContent ? expanded : undefined}
      aria-controls={expandContent ? expandId : undefined}
      data-perf-monitor={blur ? 'blur' : undefined}
      {...props}
    >
      {children}

      {expandContent && (
        <div
          id={expandId}
          ref={expandRef}
          className={`
            overflow-hidden
            transition-[max-height,opacity]
            duration-[var(--duration-normal)]
            [transition-timing-function:var(--ease-standard)]
            [will-change:max-height,opacity]
          `
            .replace(/\s+/g, ' ')
            .trim()}
          style={{
            maxHeight: expanded ? `${expandHeight}px` : '0px',
            opacity: expanded ? 1 : 0,
          }}
          aria-hidden={!expanded}
        >
          {expandContent}
        </div>
      )}
    </div>
  );
}

export function AppCardDivider({ className = '' }: { className?: string }) {
  return (
    <div
      className={`
        h-px
        bg-[var(--line-soft)]
        mx-[var(--spacing-lg)]
        ${className}
      `
        .replace(/\s+/g, ' ')
        .trim()}
      role="separator"
      aria-orientation="horizontal"
    />
  );
}

export interface AppCardHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function AppCardHeader({ children, className = '' }: AppCardHeaderProps) {
  return (
    <div
      className={`
        px-[var(--spacing-lg)]
        py-[var(--spacing-md)]
        ${className}
      `
        .replace(/\s+/g, ' ')
        .trim()}
    >
      {children}
    </div>
  );
}

export interface AppCardContentProps {
  children: React.ReactNode;
  className?: string;
}

export function AppCardContent({ children, className = '' }: AppCardContentProps) {
  return (
    <div
      className={`
        px-[var(--spacing-lg)]
        py-[var(--spacing-md)]
        ${className}
      `
        .replace(/\s+/g, ' ')
        .trim()}
    >
      {children}
    </div>
  );
}

export interface AppCardFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function AppCardFooter({ children, className = '' }: AppCardFooterProps) {
  return (
    <div
      className={`
        px-[var(--spacing-lg)]
        py-[var(--spacing-md)]
        border-t
        border-[var(--line-soft)]
        ${className}
      `
        .replace(/\s+/g, ' ')
        .trim()}
    >
      {children}
    </div>
  );
}
