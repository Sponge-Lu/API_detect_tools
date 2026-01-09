/**
 * @file src/renderer/components/IOSCard/IOSCard.tsx
 * @description iOS 风格卡片组件
 *
 * 功能:
 * - iOS 原生风格样式（圆角、毛玻璃背景、阴影，无边框）
 * - 悬停状态（阴影增强）
 * - 支持展开/收起动画
 * - 支持拖拽功能（拖拽时显示蓝色边框）
 * - 无障碍性支持（焦点指示器、ARIA 属性、键盘导航）
 * - 性能优化（GPU 加速、will-change、仅使用 transform/opacity 动画）
 *
 * @version 2.1.13
 * @updated 2025-01-09 - iOS 原生风格优化：移除卡片边框，使用阴影代替
 */

import React, { useRef, useEffect, useState, useId } from 'react';

export interface IOSCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 卡片变体 */
  variant?: 'standard' | 'elevated' | 'grouped';
  /** 是否启用毛玻璃效果 */
  blur?: boolean;
  /** 是否启用悬停效果 */
  hoverable?: boolean;
  /** 是否展开（用于展开/收起动画） */
  expanded?: boolean;
  /** 展开内容 */
  expandContent?: React.ReactNode;
  /** 是否可拖拽 */
  draggable?: boolean;
  /** 是否处于拖拽悬停状态 */
  isDragOver?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否可聚焦（用于键盘导航） */
  focusable?: boolean;
  /** 卡片标题（用于无障碍） */
  'aria-label'?: string;
  /** 子元素 */
  children: React.ReactNode;
}

export function IOSCard({
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
}: IOSCardProps) {
  const expandRef = useRef<HTMLDivElement>(null);
  const [expandHeight, setExpandHeight] = useState<number>(0);
  const expandId = useId();

  // 计算展开内容的高度
  useEffect(() => {
    if (expandRef.current) {
      setExpandHeight(expandRef.current.scrollHeight);
    }
  }, [expandContent, expanded]);

  // 基础样式 - 使用 GPU 加速
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

  // 高性能过渡 - 只使用 transform 和 opacity
  const transitionStyles = `
    transition-[transform,opacity,box-shadow]
    duration-[var(--duration-normal)]
    [transition-timing-function:var(--ease-ios)]
  `
    .replace(/\s+/g, ' ')
    .trim();

  // 变体样式 - iOS 原生风格，使用透明边框占位（防止拖拽时布局跳动）
  const variantStyles = {
    standard: `
      bg-[var(--ios-bg-secondary)]
      border-2 border-transparent
      shadow-[var(--shadow-md)]
    `
      .replace(/\s+/g, ' ')
      .trim(),

    elevated: `
      bg-[var(--ios-bg-secondary)]
      border-2 border-transparent
      shadow-[var(--shadow-lg)]
    `
      .replace(/\s+/g, ' ')
      .trim(),

    grouped: `
      bg-[var(--ios-bg-secondary)]
      border-2 border-transparent
      shadow-[var(--shadow-sm)]
    `
      .replace(/\s+/g, ' ')
      .trim(),
  };

  // 毛玻璃效果 - 添加 GPU 加速
  const blurStyles = blur
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

  // 悬停效果 - 只使用 transform
  const hoverStyles =
    hoverable && !disabled
      ? `
    hover:shadow-[var(--shadow-lg)]
    hover:-translate-y-0.5
  `
          .replace(/\s+/g, ' ')
          .trim()
      : '';

  // 拖拽悬停状态 - 只改变边框颜色，不改变边框宽度（避免布局跳动）
  const dragOverStyles = isDragOver
    ? `
    border-[var(--ios-blue)]
    scale-[1.02]
    shadow-[var(--shadow-xl)]
    [will-change:transform,border-color]
  `
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  // 禁用状态 - 使用 opacity
  const disabledStyles = disabled
    ? `
    opacity-60
    cursor-not-allowed
  `
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  // 拖拽样式
  const draggableStyles = draggable ? 'cursor-move' : '';

  // 焦点样式
  const focusStyles = focusable
    ? `
    focus-visible:outline-2
    focus-visible:outline-[var(--ios-blue)]
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
      {/* 主内容 */}
      {children}

      {/* 展开/收起内容 - 使用 GPU 加速的动画 */}
      {expandContent && (
        <div
          id={expandId}
          ref={expandRef}
          className={`
            overflow-hidden
            transition-[max-height,opacity]
            duration-[var(--duration-normal)]
            [transition-timing-function:var(--ease-ios)]
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

/**
 * iOS 风格卡片分隔线组件
 */
export function IOSCardDivider({ className = '' }: { className?: string }) {
  return (
    <div
      className={`
        h-px
        bg-[var(--ios-separator)]
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

/**
 * iOS 风格卡片头部组件
 */
export interface IOSCardHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function IOSCardHeader({ children, className = '' }: IOSCardHeaderProps) {
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

/**
 * iOS 风格卡片内容组件
 */
export interface IOSCardContentProps {
  children: React.ReactNode;
  className?: string;
}

export function IOSCardContent({ children, className = '' }: IOSCardContentProps) {
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

/**
 * iOS 风格卡片底部组件
 */
export interface IOSCardFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function IOSCardFooter({ children, className = '' }: IOSCardFooterProps) {
  return (
    <div
      className={`
        px-[var(--spacing-lg)]
        py-[var(--spacing-md)]
        border-t
        border-[var(--ios-separator)]
        ${className}
      `
        .replace(/\s+/g, ' ')
        .trim()}
    >
      {children}
    </div>
  );
}
