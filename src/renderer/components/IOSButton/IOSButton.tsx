/**
 * @file src/renderer/components/IOSButton/IOSButton.tsx
 * @description iOS 风格按钮组件
 *
 * 功能:
 * - 支持 Primary/Secondary/Tertiary 三种变体
 * - iOS 风格样式（圆角、填充、阴影）
 * - 悬停状态（背景色变化）
 * - 按下状态（缩放动画）
 * - 保持原有的 onClick 处理逻辑
 * - 使用 8px 网格间距系统
 * - 无障碍性支持（焦点指示器、键盘导航、ARIA 属性）
 * - 性能优化（GPU 加速、will-change、仅使用 transform/opacity 动画）
 * - 支持 ref 转发
 *
 * @version 2.1.11
 * @updated 2025-01-09 - 添加 forwardRef 支持
 */

import React, { forwardRef } from 'react';

export interface IOSButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 按钮变体 */
  variant?: 'primary' | 'secondary' | 'tertiary';
  /** 按钮尺寸 */
  size?: 'sm' | 'md' | 'lg';
  /** 子元素 */
  children: React.ReactNode;
  /** 是否显示加载状态 */
  loading?: boolean;
  /** 无障碍标签（当按钮只有图标时必需） */
  'aria-label'?: string;
}

export const IOSButton = forwardRef<HTMLButtonElement, IOSButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      children,
      loading = false,
      className = '',
      disabled,
      'aria-label': ariaLabel,
      ...props
    },
    ref
  ) => {
    // 基础样式 - 添加 GPU 加速
    const baseStyles = `
      inline-flex items-center justify-center gap-[var(--spacing-sm)]
      font-semibold
      border-none
      [will-change:transform,opacity]
      [backface-visibility:hidden]
      [transform:translateZ(0)]
      disabled:opacity-50 disabled:cursor-not-allowed
      active:scale-[0.97]
      focus-visible:outline-2 focus-visible:outline-[var(--ios-blue)] focus-visible:outline-offset-2
    `
      .replace(/\s+/g, ' ')
      .trim();

    // 尺寸样式 - 使用 8px 网格系统 (4px 倍数)
    const sizeStyles = {
      sm: 'px-[var(--spacing-md)] py-[var(--spacing-sm)] text-sm rounded-[10px]', // 12px 8px
      md: 'px-[var(--spacing-xl)] py-[var(--spacing-md)] text-base rounded-[12px]', // 20px 12px
      lg: 'px-[var(--spacing-2xl)] py-[var(--spacing-lg)] text-lg rounded-[14px]', // 24px 16px
    };

    // 变体样式
    const variantStyles = {
      primary: `
        bg-[var(--ios-blue)] text-white
        shadow-[var(--shadow-sm)]
        hover:bg-[#0066CC]
        hover:shadow-[var(--shadow-md)]
        active:shadow-[var(--shadow-sm)]
      `
        .replace(/\s+/g, ' ')
        .trim(),

      secondary: `
        bg-[rgba(0,122,255,0.1)] text-[var(--ios-blue)]
        hover:bg-[rgba(0,122,255,0.15)]
      `
        .replace(/\s+/g, ' ')
        .trim(),

      tertiary: `
        bg-transparent text-[var(--ios-blue)]
        hover:bg-[rgba(0,122,255,0.08)]
      `
        .replace(/\s+/g, ' ')
        .trim(),
    };

    // 高性能动画样式 - 只过渡 transform 和 opacity
    const animationStyles = `
      transition-[transform,opacity,background-color,box-shadow]
      duration-[var(--duration-fast)]
      [transition-timing-function:var(--ease-ios)]
    `
      .replace(/\s+/g, ' ')
      .trim();

    const combinedClassName = `
      ${baseStyles}
      ${sizeStyles[size]}
      ${variantStyles[variant]}
      ${animationStyles}
      ${className}
    `
      .replace(/\s+/g, ' ')
      .trim();

    return (
      <button
        ref={ref}
        className={combinedClassName}
        disabled={disabled || loading}
        aria-label={ariaLabel}
        aria-disabled={disabled || loading}
        aria-busy={loading}
        data-perf-monitor="animation"
        {...props}
      >
        {loading ? (
          <>
            <span
              className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
              aria-hidden="true"
            />
            <span className="ios-sr-only">加载中</span>
            {children}
          </>
        ) : (
          children
        )}
      </button>
    );
  }
);

IOSButton.displayName = 'IOSButton';
