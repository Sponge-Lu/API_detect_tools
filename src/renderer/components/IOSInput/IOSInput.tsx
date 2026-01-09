/**
 * @file src/renderer/components/IOSInput/IOSInput.tsx
 * @description iOS 风格输入框组件
 *
 * 功能:
 * - iOS 原生风格样式（圆角、内阴影、背景色、微妙边框）
 * - 聚焦状态（边框高亮、box-shadow）
 * - 支持多种输入类型（text, password, url, number, email）
 * - 保持原有的 onChange 和验证逻辑
 * - 使用 8px 网格间距系统
 * - 无障碍性支持（焦点指示器、ARIA 属性、错误状态）
 * - 性能优化（GPU 加速、will-change、仅使用 transform/opacity 动画）
 *
 * @version 2.1.13
 * @updated 2025-01-09 - iOS 原生风格优化：更微妙的边框颜色
 */

import React, { forwardRef, useState, useId } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export interface IOSInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** 输入框尺寸 */
  size?: 'sm' | 'md' | 'lg';
  /** 是否显示错误状态 */
  error?: boolean;
  /** 错误信息 */
  errorMessage?: string;
  /** 标签文本 */
  label?: string;
  /** 是否显示密码切换按钮（仅 type="password" 时有效） */
  showPasswordToggle?: boolean;
  /** 左侧图标 */
  leftIcon?: React.ReactNode;
  /** 右侧图标 */
  rightIcon?: React.ReactNode;
  /** 容器类名 */
  containerClassName?: string;
  /** 帮助文本 */
  helpText?: string;
}

export const IOSInput = forwardRef<HTMLInputElement, IOSInputProps>(
  (
    {
      size = 'md',
      error = false,
      errorMessage,
      label,
      showPasswordToggle = false,
      leftIcon,
      rightIcon,
      containerClassName = '',
      className = '',
      type = 'text',
      disabled,
      required,
      id: providedId,
      helpText,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref
  ) => {
    const [showPassword, setShowPassword] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    // 生成唯一 ID
    const generatedId = useId();
    const inputId = providedId || generatedId;
    const errorId = `${inputId}-error`;
    const helpId = `${inputId}-help`;

    // 实际的输入类型（处理密码显示/隐藏）
    const actualType = type === 'password' && showPassword ? 'text' : type;

    // 构建 aria-describedby
    const describedByIds =
      [ariaDescribedBy, error && errorMessage ? errorId : null, helpText ? helpId : null]
        .filter(Boolean)
        .join(' ') || undefined;

    // 尺寸样式 - 使用 8px 网格系统 (4px 倍数)
    const sizeStyles = {
      sm: 'px-[var(--spacing-md)] py-[var(--spacing-sm)] text-sm rounded-[10px]', // 12px 8px
      md: 'px-[var(--spacing-lg)] py-[var(--spacing-md)] text-base rounded-[12px]', // 16px 12px
      lg: 'px-[var(--spacing-lg)] py-[var(--spacing-lg)] text-lg rounded-[14px]', // 16px 16px
    };

    // 基础输入框样式 - 添加 GPU 加速
    const baseInputStyles = `
      w-full
      bg-[var(--ios-bg-tertiary)]
      text-[var(--ios-text-primary)]
      placeholder-[var(--ios-text-tertiary)]
      border
      [will-change:box-shadow,border-color]
      [transform:translateZ(0)]
      transition-[box-shadow,border-color]
      duration-[var(--duration-fast)]
      [transition-timing-function:var(--ease-ios)]
      outline-none
      [box-shadow:inset_0_1px_2px_rgba(0,0,0,0.05)]
    `
      .replace(/\s+/g, ' ')
      .trim();

    // 边框样式（根据状态变化）- iOS 原生风格，更微妙
    const borderStyles = error
      ? 'border-[var(--ios-red)]'
      : isFocused
        ? 'border-[var(--ios-blue)]'
        : 'border-[var(--ios-separator)]';

    // 聚焦时的 box-shadow
    const focusStyles =
      isFocused && !error
        ? '[box-shadow:0_0_0_4px_rgba(0,122,255,0.1),inset_0_1px_2px_rgba(0,0,0,0.05)]'
        : error && isFocused
          ? '[box-shadow:0_0_0_4px_rgba(255,59,48,0.1),inset_0_1px_2px_rgba(0,0,0,0.05)]'
          : '';

    // 禁用状态
    const disabledStyles = disabled
      ? 'opacity-50 cursor-not-allowed bg-[var(--ios-bg-primary)]'
      : '';

    // 左侧图标的 padding 调整
    const leftPaddingStyles = leftIcon ? 'pl-10' : '';
    // 右侧图标或密码切换按钮的 padding 调整
    const rightPaddingStyles =
      rightIcon || (type === 'password' && showPasswordToggle) ? 'pr-10' : '';

    const combinedInputClassName = `
      ${baseInputStyles}
      ${sizeStyles[size]}
      ${borderStyles}
      ${focusStyles}
      ${disabledStyles}
      ${leftPaddingStyles}
      ${rightPaddingStyles}
      ${className}
    `
      .replace(/\s+/g, ' ')
      .trim();

    return (
      <div className={`relative ${containerClassName}`}>
        {/* 标签 */}
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-[var(--ios-text-primary)] mb-[var(--spacing-sm)]"
          >
            {label}
            {required && (
              <span className="text-[var(--ios-red)] ml-1" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}

        {/* 输入框容器 */}
        <div className="relative">
          {/* 左侧图标 */}
          {leftIcon && (
            <div
              className="absolute left-[var(--spacing-md)] top-1/2 -translate-y-1/2 text-[var(--ios-text-tertiary)]"
              aria-hidden="true"
            >
              {leftIcon}
            </div>
          )}

          {/* 输入框 */}
          <input
            ref={ref}
            id={inputId}
            type={actualType}
            disabled={disabled}
            required={required}
            aria-invalid={error}
            aria-required={required}
            aria-describedby={describedByIds}
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

          {/* 右侧图标或密码切换按钮 */}
          {type === 'password' && showPasswordToggle ? (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              title={showPassword ? '隐藏密码' : '显示密码'}
              aria-pressed={showPassword}
              className="absolute right-[var(--spacing-md)] top-1/2 -translate-y-1/2 text-[var(--ios-text-tertiary)] hover:text-[var(--ios-text-secondary)] transition-colors p-[var(--spacing-xs)] rounded-[var(--radius-sm)] focus-visible:outline-2 focus-visible:outline-[var(--ios-blue)] focus-visible:outline-offset-1"
              tabIndex={0}
            >
              {showPassword ? (
                <EyeOff className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
              ) : (
                <Eye className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
              )}
            </button>
          ) : rightIcon ? (
            <div
              className="absolute right-[var(--spacing-md)] top-1/2 -translate-y-1/2 text-[var(--ios-text-tertiary)]"
              aria-hidden="true"
            >
              {rightIcon}
            </div>
          ) : null}
        </div>

        {/* 帮助文本 */}
        {helpText && !error && (
          <p
            id={helpId}
            className="mt-[var(--spacing-sm)] text-sm text-[var(--ios-text-secondary)]"
          >
            {helpText}
          </p>
        )}

        {/* 错误信息 */}
        {error && errorMessage && (
          <p
            id={errorId}
            className="mt-[var(--spacing-sm)] text-sm text-[var(--ios-red)]"
            role="alert"
          >
            {errorMessage}
          </p>
        )}
      </div>
    );
  }
);

IOSInput.displayName = 'IOSInput';
