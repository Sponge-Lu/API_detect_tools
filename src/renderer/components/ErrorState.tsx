/**
 * 输入: title, description, action (可选), className
 * 输出: React 组件 (统一错误状态)
 * 定位: 展示层 - 全 App 错误态原语，图标 + 主/副文案 + role="alert"
 */

import { AlertTriangle } from 'lucide-react';

export interface ErrorStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function ErrorState({
  title = '加载失败',
  description,
  action,
  className = '',
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-2 py-8 text-center ${className}`.trim()}
    >
      <AlertTriangle className="h-8 w-8 text-[var(--danger)]" aria-hidden="true" />
      <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
      {description ? (
        <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
