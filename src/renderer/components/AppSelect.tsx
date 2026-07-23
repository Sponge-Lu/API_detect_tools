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
  sm: 'px-[var(--spacing-md)] py-[var(--spacing-sm)] text-sm rounded-[10px]',
  md: 'px-[var(--spacing-lg)] py-[var(--spacing-md)] text-base rounded-[12px]',
  lg: 'px-[var(--spacing-lg)] py-[var(--spacing-lg)] text-lg rounded-[14px]',
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
      : 'border-[var(--line-soft)]';

  const focusStyles =
    isFocused && !error
      ? '[box-shadow:0_0_0_4px_var(--focus-ring),inset_0_1px_2px_rgba(0,0,0,0.05)]'
      : error && isFocused
        ? '[box-shadow:0_0_0_4px_var(--danger-soft),inset_0_1px_2px_rgba(0,0,0,0.05)]'
        : '';

  const combinedClassName = `
      w-full appearance-none
      bg-[var(--surface-2)]
      text-[var(--text-primary)]
      border
      outline-none
      transition-[box-shadow,border-color]
      duration-[var(--duration-fast)]
      pr-10
      ${sizeStyles[size]}
      ${borderStyles}
      ${focusStyles}
      ${disabled ? 'opacity-50 cursor-not-allowed bg-[var(--surface-1)]' : ''}
      ${className}
    `
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <div className={`relative ${containerClassName}`}>
      {label && (
        <label
          htmlFor={selectId}
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
          className="pointer-events-none absolute right-[var(--spacing-md)] top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]"
        />
      </div>

      {error && errorMessage && (
        <p
          id={errorId}
          role="alert"
          className="mt-[var(--spacing-xs)] text-sm text-[var(--danger)]"
        >
          {errorMessage}
        </p>
      )}
      {!error && helpText && (
        <p id={helpId} className="mt-[var(--spacing-xs)] text-sm text-[var(--text-tertiary)]">
          {helpText}
        </p>
      )}
    </div>
  );
});
