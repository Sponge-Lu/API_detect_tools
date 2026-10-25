import React, { forwardRef, useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export interface AppInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  error?: boolean;
  errorMessage?: string;
  label?: string;
  showPasswordToggle?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerClassName?: string;
  helpText?: string;
}

export const AppInput = forwardRef<HTMLInputElement, AppInputProps>(function AppInput(
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
) {
  const [showPassword, setShowPassword] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const generatedId = useId();
  const inputId = providedId || generatedId;
  const errorId = `${inputId}-error`;
  const helpId = `${inputId}-help`;
  const actualType = type === 'password' && showPassword ? 'text' : type;

  const describedByIds =
    [ariaDescribedBy, error && errorMessage ? errorId : null, helpText ? helpId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  /* 三档高度与 AppButton 对齐（32 / 36 / 40），表单内并排时基线一致 */
  const sizeStyles = {
    sm: 'h-8 px-[var(--spacing-md)] text-[12px]',
    md: 'h-9 px-[var(--spacing-md)] text-[13px]',
    lg: 'h-10 px-[var(--spacing-lg)] text-[13px]',
  };

  const baseInputStyles = `
      w-full
      rounded-[var(--radius-sm)]
      bg-[var(--field-bg)]
      text-[var(--text-primary)]
      placeholder-[var(--text-tertiary)]
      border
      transition-[box-shadow,border-color]
      duration-[var(--duration-hover)]
      outline-none
    `
    .replace(/\s+/g, ' ')
    .trim();

  const borderStyles = error
    ? 'border-[var(--danger)]'
    : isFocused
      ? 'border-[var(--accent)]'
      : 'border-[var(--line-strong)] hover:border-[color-mix(in_srgb,var(--text-tertiary)_55%,transparent)]';

  const focusStyles = error
    ? '[box-shadow:0_0_0_3px_var(--danger-soft)]'
    : isFocused
      ? '[box-shadow:0_0_0_3px_var(--focus-ring)]'
      : '';

  const disabledStyles = disabled
    ? 'opacity-60 cursor-not-allowed bg-[var(--surface-2)] text-[var(--text-tertiary)]'
    : '';
  const leftPaddingStyles = leftIcon ? 'pl-9' : '';
  const rightPaddingStyles = rightIcon || (type === 'password' && showPasswordToggle) ? 'pr-9' : '';

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
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-[12px] font-medium text-[var(--text-secondary)]"
        >
          {label}
          {required && (
            <span className="ml-1 text-[var(--danger)]" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      <div className="relative">
        {leftIcon && (
          <div
            className="pointer-events-none absolute left-[var(--spacing-md)] top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
            aria-hidden="true"
          >
            {leftIcon}
          </div>
        )}

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

        {type === 'password' && showPasswordToggle ? (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
            title={showPassword ? '隐藏密码' : '显示密码'}
            aria-pressed={showPassword}
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-colors duration-[var(--duration-hover)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
            tabIndex={0}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
        ) : rightIcon ? (
          <div
            className="pointer-events-none absolute right-[var(--spacing-md)] top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
            aria-hidden="true"
          >
            {rightIcon}
          </div>
        ) : null}
      </div>

      {helpText && !error && (
        <p id={helpId} className="mt-1.5 text-[12px] leading-4 text-[var(--text-secondary)]">
          {helpText}
        </p>
      )}

      {error && errorMessage && (
        <p id={errorId} className="mt-1.5 text-[12px] leading-4 text-[var(--danger)]" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
});
