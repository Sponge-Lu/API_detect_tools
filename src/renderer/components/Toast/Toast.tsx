/**
 * 输入: ToastItem (消息类型、内容、持续时间), onClose 回调
 * 输出: React 组件 (Toast 通知 UI)
 * 定位: 展示层 - Toast 通知组件，显示成功/错误/警告/信息提示
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/Toast/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastProps {
  toast: ToastItem;
  onClose: (id: string) => void;
}

const icons: Record<ToastType, React.ReactNode> = {
  success: (
    <CheckCircle className="h-5 w-5 text-[var(--success)]" strokeWidth={2} aria-hidden="true" />
  ),
  error: <XCircle className="h-5 w-5 text-[var(--danger)]" strokeWidth={2} aria-hidden="true" />,
  warning: (
    <AlertTriangle className="h-5 w-5 text-[var(--warning)]" strokeWidth={2} aria-hidden="true" />
  ),
  info: <Info className="h-5 w-5 text-[var(--accent)]" strokeWidth={2} aria-hidden="true" />,
};

const bgColors: Record<ToastType, string> = {
  success: 'bg-[var(--success-soft)] border-[var(--success)]/25',
  error: 'bg-[var(--danger-soft)] border-[var(--danger)]/25',
  warning: 'bg-[var(--warning-soft)] border-[var(--warning)]/25',
  info: 'bg-[var(--accent-soft)] border-[var(--accent)]/25',
};

export function Toast({ toast, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(toast.id);
    }, toast.duration || 3000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onClose]);

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto animate-in slide-in-from-top-full flex items-start gap-3 rounded-[var(--radius-lg)] border px-4 py-3 shadow-[var(--shadow-lg)] duration-300 ${bgColors[toast.type]}`}
    >
      {icons[toast.type]}
      <span
        title={toast.message}
        className="line-clamp-2 flex-1 whitespace-pre-wrap break-all text-sm leading-5 text-[var(--text-primary)]"
      >
        {toast.message}
      </span>
      <button
        onClick={() => onClose(toast.id)}
        aria-label="关闭通知"
        title="关闭"
        className="rounded-[var(--radius-sm)] p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-1)]/55 hover:text-[var(--text-primary)]"
      >
        <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onClose: (id: string) => void;
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed left-1/2 top-4 z-[200] flex -translate-x-1/2 flex-col gap-2"
      style={{ width: 'min(28rem, calc(100vw - 2rem))' }}
    >
      {toasts.slice(-3).map(toast => (
        <Toast key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  );
}
