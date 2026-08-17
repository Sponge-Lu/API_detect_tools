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
  sm: 'px-[var(--spacing-md)] py-[var(--spacing-sm)] text-sm rounded-[10px]',
  md: 'px-[var(--spacing-lg)] py-[var(--spacing-md)] text-base rounded-[12px]',
  lg: 'px-[var(--spacing-lg)] py-[var(--spacing-lg)] text-lg rounded-[14px]',
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
