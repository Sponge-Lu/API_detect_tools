/**
 * 输入: message (可选文案), size (sm/md/lg), className
 * 输出: React 组件 (统一加载状态)
 * 定位: 展示层 - 全 App 加载态原语，替代各页面散落的 Loader2/纯文字加载
 */

import { Loader2 } from 'lucide-react';

export interface LoadingStateProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeStyles: Record<NonNullable<LoadingStateProps['size']>, { icon: string; text: string }> = {
  sm: { icon: 'h-4 w-4', text: 'text-xs' },
  md: { icon: 'h-6 w-6', text: 'text-sm' },
  lg: { icon: 'h-8 w-8', text: 'text-base' },
};

export function LoadingState({
  message = '加载中...',
  size = 'md',
  className = '',
}: LoadingStateProps) {
  const { icon, text } = sizeStyles[size];
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-2 py-8 text-center ${className}`.trim()}
    >
      <Loader2 className={`${icon} animate-spin text-[var(--accent)]`} aria-hidden="true" />
      {message ? <span className={`${text} text-[var(--text-secondary)]`}>{message}</span> : null}
    </div>
  );
}
