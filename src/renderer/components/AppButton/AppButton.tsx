import React, { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

export interface AppButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

/**
 * 按钮层级：实心（primary / danger）> 描边（secondary）> 幽灵（tertiary）> 淡底（success）
 * - primary 用 accent-solid（浅色主题为墨色、深色主题反转为浅色），保证页面有唯一视觉主角
 * - 按压反馈用背景加深而非缩放，避免列表内按钮抖动
 */
const variantStyles: Record<NonNullable<AppButtonProps['variant']>, string> = {
  primary:
    'border border-transparent bg-[var(--accent-solid)] text-[var(--text-on-accent)] shadow-[var(--shadow-sm)] hover:bg-[var(--accent-solid-hover)] active:bg-[color-mix(in_srgb,var(--accent-solid)_86%,black)]',
  secondary:
    'border border-[var(--line-soft)] bg-[var(--surface-3)] text-[var(--text-primary)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]',
  tertiary:
    'border border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)] active:bg-[var(--accent-soft)]',
  danger:
    'border border-transparent bg-[var(--danger)] text-[var(--text-on-accent)] shadow-[var(--shadow-sm)] hover:bg-[color-mix(in_srgb,var(--danger)_88%,black)] active:bg-[color-mix(in_srgb,var(--danger)_78%,black)]',
  success:
    'border border-transparent bg-[var(--success-soft)] text-[var(--success)] hover:bg-[color-mix(in_srgb,var(--success)_20%,transparent)] active:bg-[color-mix(in_srgb,var(--success)_26%,transparent)]',
};

const sizeStyles: Record<NonNullable<AppButtonProps['size']>, string> = {
  sm: 'min-h-8 gap-1.5 px-2.5 text-[12px]',
  md: 'min-h-9 gap-1.5 px-3 text-[13px]',
  lg: 'min-h-10 gap-2 px-4 text-[13px]',
};

const spinnerSize: Record<NonNullable<AppButtonProps['size']>, string> = {
  sm: 'h-3 w-3',
  md: 'h-3.5 w-3.5',
  lg: 'h-4 w-4',
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
    'inline-flex select-none items-center justify-center whitespace-nowrap rounded-[var(--radius-sm)] font-medium',
    'transition-colors duration-[var(--duration-hover)]',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
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
          <Loader2
            className={`${spinnerSize[size]} shrink-0 animate-spin`}
            strokeWidth={2}
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
