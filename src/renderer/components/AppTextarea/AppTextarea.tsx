import React, { forwardRef, useId, useState } from 'react';

export interface AppTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  error?: boolean;
  errorMessage?: string;
  label?: string;
  helpText?: string;
  containerClassName?: string;
}

const sizeStyles: Record<NonNullable<AppTextareaProps['size']>, string> = {
  sm: 'px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[12px]',
  md: 'px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[13px]',
  lg: 'px-[var(--spacing-lg)] py-[var(--spacing-md)] text-[13px]',
};

export const AppTextarea = forwardRef<HTMLTextAreaElement, AppTextareaProps>(function AppTextarea(
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
    'aria-describedby': ariaDescribedBy,
    ...props
  },
  ref
) {
  const [isFocused, setIsFocused] = useState(false);
  const generatedId = useId();
  const textareaId = providedId || generatedId;
  const errorId = `${textareaId}-error`;
  const helpId = `${textareaId}-help`;

  const describedByIds =
    [ariaDescribedBy, error && errorMessage ? errorId : null, helpText ? helpId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  const baseStyles = `
      w-full
      resize-y
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

  const combinedClassName = `
      ${baseStyles}
      ${sizeStyles[size]}
      ${borderStyles}
      ${focusStyles}
      ${disabledStyles}
      ${className}
    `
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <div className={`relative ${containerClassName}`}>
      {label && (
        <label
          htmlFor={textareaId}
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

      <textarea
        ref={ref}
        id={textareaId}
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
      />

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
