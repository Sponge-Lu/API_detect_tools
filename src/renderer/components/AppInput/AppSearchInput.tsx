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

    const sizeStyles = {
      sm: 'pl-[var(--spacing-8)] pr-[var(--spacing-8)] py-[var(--spacing-sm)] text-sm rounded-[10px]',
      md: 'pl-[var(--spacing-10)] pr-[var(--spacing-10)] py-[var(--spacing-md)] text-base rounded-[12px]',
      lg: 'pl-[44px] pr-[44px] py-[var(--spacing-lg)] text-lg rounded-[14px]',
    };

    const iconSizes = {
      sm: 'w-4 h-4',
      md: 'w-5 h-5',
      lg: 'w-6 h-6',
    };

    const iconPositions = {
      sm: 'left-[var(--spacing-sm)]',
      md: 'left-[var(--spacing-md)]',
      lg: 'left-[var(--spacing-lg)]',
    };

    const clearPositions = {
      sm: 'right-[var(--spacing-sm)]',
      md: 'right-[var(--spacing-md)]',
      lg: 'right-[var(--spacing-lg)]',
    };

    const baseInputStyles = `
      w-full
      bg-[var(--surface-2)]
      text-[var(--text-primary)]
      placeholder-[var(--text-tertiary)]
      border-none
      transition-all
      duration-[var(--duration-fast)]
      [transition-timing-function:var(--ease-standard)]
      outline-none
    `
      .replace(/\s+/g, ' ')
      .trim();

    const focusStyles = isFocused
      ? 'bg-[var(--surface-1)] [box-shadow:0_0_0_4px_var(--focus-ring)]'
      : '';

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
          className={`absolute ${iconPositions[size]} top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none`}
        >
          <Search className={iconSizes[size]} strokeWidth={2} aria-hidden="true" />
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
            className={`absolute ${clearPositions[size]} top-1/2 -translate-y-1/2 rounded-full p-[var(--spacing-xs)] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-secondary)]`}
            tabIndex={-1}
          >
            <X className={iconSizes[size]} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }
);

AppSearchInput.displayName = 'AppSearchInput';
