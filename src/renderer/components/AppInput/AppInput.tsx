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

  const sizeStyles = {
    sm: 'px-[var(--spacing-md)] py-[var(--spacing-sm)] text-sm rounded-[10px]',
    md: 'px-[var(--spacing-lg)] py-[var(--spacing-md)] text-base rounded-[12px]',
    lg: 'px-[var(--spacing-lg)] py-[var(--spacing-lg)] text-lg rounded-[14px]',
  };

  const baseInputStyles = `
      w-full
      bg-[var(--surface-2)]
      text-[var(--text-primary)]
      placeholder-[var(--text-tertiary)]
      border
      [will-change:box-shadow,border-color]
      [transform:translateZ(0)]
      transition-[box-shadow,border-color]
      duration-[var(--duration-fast)]
      [transition-timing-function:var(--ease-standard)]
      outline-none
      [box-shadow:inset_0_1px_2px_rgba(0,0,0,0.05)]
    `
    .replace(/\s+/g, ' ')
    .trim();

  const borderStyles = error
    ? 'border-[var(--danger)]'
    : isFocused
      ? 'border-[var(--accent)]'
      : 'border-[var(--line-soft)]';

  const focusStyles =
    isFocused && !error
      ? '[box-shadow:0_0_0_4px_var(--focus-ring),inset_0_1px_2px_rgba(0,0,0,0.05)]'
      : error && isFocused
        ? '[box-shadow:0_0_0_4px_var(--danger-soft),inset_0_1px_2px_rgba(0,0,0,0.05)]'
        : '';

  const disabledStyles = disabled ? 'opacity-50 cursor-not-allowed bg-[var(--surface-1)]' : '';
  const leftPaddingStyles = leftIcon ? 'pl-10' : '';
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
      {label && (
        <label
          htmlFor={inputId}
          className="mb-[var(--spacing-sm)] block text-sm font-medium text-[var(--text-primary)]"
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
            className="absolute left-[var(--spacing-md)] top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
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
            className="absolute right-[var(--spacing-md)] top-1/2 -translate-y-1/2 rounded-[var(--radius-sm)] p-[var(--spacing-xs)] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1"
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
            className="absolute right-[var(--spacing-md)] top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
            aria-hidden="true"
          >
            {rightIcon}
          </div>
        ) : null}
      </div>

      {helpText && !error && (
        <p id={helpId} className="mt-[var(--spacing-sm)] text-sm text-[var(--text-secondary)]">
          {helpText}
        </p>
      )}

      {error && errorMessage && (
        <p
          id={errorId}
          className="mt-[var(--spacing-sm)] text-sm text-[var(--danger)]"
          role="alert"
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
});
