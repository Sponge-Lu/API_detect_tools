import React, { forwardRef, useState } from 'react';
import { Search, X } from 'lucide-react';

export interface AppSearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  size?: 'sm' | 'md' | 'lg';
  showClearButton?: boolean;
  onClear?: () => void;
  containerClassName?: string;
}

export const AppSearchInput = forwardRef<HTMLInputElement, AppSearchInputProps>(
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
    const hasValue = value !== undefined && value !== '';

    /* 高度与 AppInput / AppButton 对齐，工具栏并排时不出现高低差 */
    const sizeStyles = {
      sm: 'h-8 pl-8 pr-8 text-[12px]',
      md: 'h-9 pl-9 pr-9 text-[13px]',
      lg: 'h-10 pl-10 pr-10 text-[13px]',
    };

    const iconSizes = {
      sm: 'h-3.5 w-3.5',
      md: 'h-4 w-4',
      lg: 'h-4 w-4',
    };

    const iconPositions = {
      sm: 'left-2.5',
      md: 'left-[var(--spacing-md)]',
      lg: 'left-[var(--spacing-md)]',
    };

    const clearPositions = {
      sm: 'right-1',
      md: 'right-1.5',
      lg: 'right-1.5',
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

    const borderStyles = isFocused
      ? 'border-[var(--accent)] [box-shadow:0_0_0_3px_var(--focus-ring)]'
      : 'border-[var(--line-strong)] hover:border-[color-mix(in_srgb,var(--text-tertiary)_55%,transparent)]';

    const disabledStyles = disabled
      ? 'opacity-60 cursor-not-allowed bg-[var(--surface-2)] text-[var(--text-tertiary)]'
      : '';

    const combinedInputClassName = `
      ${baseInputStyles}
      ${sizeStyles[size]}
      ${borderStyles}
      ${disabledStyles}
      ${className}
    `
      .replace(/\s+/g, ' ')
      .trim();

    const handleClear = () => {
      if (onClear) {
        onClear();
      } else if (onChange) {
        const syntheticEvent = {
          target: { value: '' },
          currentTarget: { value: '' },
        } as React.ChangeEvent<HTMLInputElement>;
        onChange(syntheticEvent);
      }
    };

    return (
      <div className={`relative ${containerClassName}`}>
        <div
          className={`pointer-events-none absolute ${iconPositions[size]} top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]`}
        >
          <Search className={iconSizes[size]} strokeWidth={1.75} aria-hidden="true" />
        </div>

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

        {showClearButton && hasValue && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="清除搜索内容"
            title="清除"
            className={`absolute ${clearPositions[size]} top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-colors duration-[var(--duration-hover)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-secondary)]`}
            tabIndex={-1}
          >
            <X className={iconSizes[size]} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }
);

AppSearchInput.displayName = 'AppSearchInput';
