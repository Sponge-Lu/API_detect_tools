/**
 * 输入: 原生 select 属性 + label/errorMessage/helpText/size
 * 输出: React 组件 (统一原生下拉)
 * 定位: 展示层 - token 化的 <select> 封装，与 AppInput 同 surface/focus 语言
 */

import { forwardRef, useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface AppSelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  error?: boolean;
  errorMessage?: string;
  label?: string;
  helpText?: string;
  containerClassName?: string;
}

const sizeStyles: Record<NonNullable<AppSelectProps['size']>, string> = {
  sm: 'h-8 pl-[var(--spacing-md)] text-[12px]',
  md: 'h-9 pl-[var(--spacing-md)] text-[13px]',
  lg: 'h-10 pl-[var(--spacing-lg)] text-[13px]',
};

export const AppSelect = forwardRef<HTMLSelectElement, AppSelectProps>(function AppSelect(
  {
    size = 'md',
    error = false,
    errorMessage,
    label,
    helpText,
    containerClassName = '',
    className = '',
    disabled,
    required,
    id: providedId,
    children,
    'aria-describedby': ariaDescribedBy,
    ...props
  },
  ref
) {
  const [isFocused, setIsFocused] = useState(false);
  const generatedId = useId();
  const selectId = providedId || generatedId;
  const errorId = `${selectId}-error`;
  const helpId = `${selectId}-help`;

  const describedByIds =
    [ariaDescribedBy, error && errorMessage ? errorId : null, helpText ? helpId : null]
      .filter(Boolean)
      .join(' ') || undefined;

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

  const combinedClassName = `
      w-full appearance-none
      rounded-[var(--radius-sm)]
      bg-[var(--field-bg)]
      text-[var(--text-primary)]
      border
      outline-none
      transition-[box-shadow,border-color]
      duration-[var(--duration-hover)]
      pr-9
      ${sizeStyles[size]}
      ${borderStyles}
      ${focusStyles}
      ${disabled ? 'opacity-60 cursor-not-allowed bg-[var(--surface-2)] text-[var(--text-tertiary)]' : ''}
      ${className}
    `
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <div className={`relative ${containerClassName}`}>
      {label && (
        <label
          htmlFor={selectId}
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
        <select
          ref={ref}
          id={selectId}
          disabled={disabled}
          required={required}
          aria-invalid={error}
          aria-required={required}
          aria-describedby={describedByIds}
          className={combinedClassName}
          onFocus={e => {
            setIsFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={e => {
            setIsFocused(false);
            props.onBlur?.(e);
          }}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          strokeWidth={1.75}
          className="pointer-events-none absolute right-[var(--spacing-md)] top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]"
        />
      </div>

      {error && errorMessage && (
        <p id={errorId} role="alert" className="mt-1.5 text-[12px] leading-4 text-[var(--danger)]">
          {errorMessage}
        </p>
      )}
      {!error && helpText && (
        <p id={helpId} className="mt-1.5 text-[12px] leading-4 text-[var(--text-secondary)]">
          {helpText}
        </p>
      )}
    </div>
  );
});
