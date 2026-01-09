/**
 * @file src/renderer/components/IOSInput/IOSSearchInput.tsx
 * @description iOS 风格搜索输入框组件
 *
 * 功能:
 * - iOS 风格搜索框样式（圆角、背景色、搜索图标）
 * - 聚焦状态（背景色变化、box-shadow）
 * - 支持清除按钮
 * - 保持原有的 onChange 和搜索逻辑
 * - 使用 8px 网格间距系统
 *
 * @version 2.1.11
 * @updated 2025-01-09 - 应用 8px 网格间距系统
 */

import React, { forwardRef, useState } from 'react';
import { Search, X } from 'lucide-react';

export interface IOSSearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  /** 输入框尺寸 */
  size?: 'sm' | 'md' | 'lg';
  /** 是否显示清除按钮 */
  showClearButton?: boolean;
  /** 清除回调 */
  onClear?: () => void;
  /** 容器类名 */
  containerClassName?: string;
}

export const IOSSearchInput = forwardRef<HTMLInputElement, IOSSearchInputProps>(
  (
    {
      size = 'md',
      showClearButton = true,
      onClear,
      containerClassName = '',
      className = '',
      value,
      onChange,
      disabled,
      ...props
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = useState(false);

    // 判断是否有值（用于显示清除按钮）
    const hasValue = value !== undefined && value !== '';

    // 尺寸样式 - 使用 8px 网格系统 (4px 倍数)
    const sizeStyles = {
      sm: 'pl-[var(--spacing-8)] pr-[var(--spacing-8)] py-[var(--spacing-sm)] text-sm rounded-[10px]', // 32px 32px 8px
      md: 'pl-[var(--spacing-10)] pr-[var(--spacing-10)] py-[var(--spacing-md)] text-base rounded-[12px]', // 40px 40px 12px
      lg: 'pl-[44px] pr-[44px] py-[var(--spacing-lg)] text-lg rounded-[14px]', // 44px 44px 16px
    };

    // 图标尺寸
    const iconSizes = {
      sm: 'w-4 h-4',
      md: 'w-5 h-5',
      lg: 'w-6 h-6',
    };

    // 图标位置 - 使用 8px 网格系统 (4px 倍数)
    const iconPositions = {
      sm: 'left-[var(--spacing-sm)]', // 8px
      md: 'left-[var(--spacing-md)]', // 12px
      lg: 'left-[var(--spacing-lg)]', // 16px
    };

    const clearPositions = {
      sm: 'right-[var(--spacing-sm)]', // 8px
      md: 'right-[var(--spacing-md)]', // 12px
      lg: 'right-[var(--spacing-lg)]', // 16px
    };

    // 基础输入框样式
    const baseInputStyles = `
      w-full
      bg-[var(--ios-bg-tertiary)]
      text-[var(--ios-text-primary)]
      placeholder-[var(--ios-text-tertiary)]
      border-none
      transition-all
      duration-[var(--duration-fast)]
      [transition-timing-function:var(--ease-ios)]
      outline-none
    `
      .replace(/\s+/g, ' ')
      .trim();

    // 聚焦状态样式
    const focusStyles = isFocused
      ? 'bg-[var(--ios-bg-secondary)] [box-shadow:0_0_0_4px_rgba(0,122,255,0.1)]'
      : '';

    // 禁用状态
    const disabledStyles = disabled ? 'opacity-50 cursor-not-allowed' : '';

    const combinedInputClassName = `
      ${baseInputStyles}
      ${sizeStyles[size]}
      ${focusStyles}
      ${disabledStyles}
      ${className}
    `
      .replace(/\s+/g, ' ')
      .trim();

    // 处理清除
    const handleClear = () => {
      if (onClear) {
        onClear();
      } else if (onChange) {
        // 创建一个模拟的事件对象
        const syntheticEvent = {
          target: { value: '' },
          currentTarget: { value: '' },
        } as React.ChangeEvent<HTMLInputElement>;
        onChange(syntheticEvent);
      }
    };

    return (
      <div className={`relative ${containerClassName}`}>
        {/* 搜索图标 */}
        <div
          className={`absolute ${iconPositions[size]} top-1/2 -translate-y-1/2 text-[var(--ios-text-tertiary)] pointer-events-none`}
        >
          <Search className={iconSizes[size]} strokeWidth={2} aria-hidden="true" />
        </div>

        {/* 输入框 */}
        <input
          ref={ref}
          type="search"
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={combinedInputClassName}
          onFocus={e => {
            setIsFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={e => {
            setIsFocused(false);
            props.onBlur?.(e);
          }}
          {...props}
        />

        {/* 清除按钮 */}
        {showClearButton && hasValue && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="清除搜索内容"
            title="清除"
            className={`absolute ${clearPositions[size]} top-1/2 -translate-y-1/2 text-[var(--ios-text-tertiary)] hover:text-[var(--ios-text-secondary)] transition-colors p-[var(--spacing-xs)] rounded-full hover:bg-[var(--ios-separator)]`}
            tabIndex={-1}
          >
            <X className={iconSizes[size]} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }
);

IOSSearchInput.displayName = 'IOSSearchInput';
