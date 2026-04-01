import React, { forwardRef } from 'react';

export interface AppButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const variantStyles: Record<NonNullable<AppButtonProps['variant']>, string> = {
  primary:
    'border border-transparent bg-[var(--accent-soft)] text-[var(--accent-strong)] hover:bg-[var(--accent-soft-strong)]',
  secondary:
    'border border-[var(--line-soft)] bg-[var(--surface-3)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]',
  tertiary: 'border border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-2)]',
  danger:
    'border border-transparent bg-[var(--danger-soft)] text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_20%,transparent)]',
};

const sizeStyles: Record<NonNullable<AppButtonProps['size']>, string> = {
  sm: 'min-h-8 px-3 text-xs',
  md: 'min-h-9 px-3.5 text-sm',
  lg: 'min-h-10 px-4 text-sm',
};

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(function AppButton(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    className = '',
    children,
    disabled,
    ...props
  },
  ref
) {
  const combinedClassName = [
    'inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium transition-colors',
    'focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2',
    'disabled:cursor-not-allowed disabled:opacity-50',
    variantStyles[variant],
    sizeStyles[size],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      className={combinedClassName}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading ? (
        <>
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
          {children}
        </>
      ) : (
        children
      )}
    </button>
  );
});
