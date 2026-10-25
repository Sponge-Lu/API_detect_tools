/**
 * 输入: ToastItem (消息类型、内容、持续时间), onClose 回调
 * 输出: React 组件 (Toast 通知 UI)
 * 定位: 展示层 - Toast 通知组件，显示成功/错误/警告/信息提示
 *
 * 交互细节：
 * - 停靠在右下角，不再遮挡页头的操作区
 * - 鼠标悬停暂停计时，移开后继续走完剩余时长
 * - 描边使用同色系淡边（color-mix），而不是回退到 currentColor
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/Toast/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useEffect, useRef, useState } from 'react';
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
    <CheckCircle
      className="mt-px h-4 w-4 shrink-0 text-[var(--success)]"
      strokeWidth={1.75}
      aria-hidden="true"
    />
  ),
  error: (
    <XCircle
      className="mt-px h-4 w-4 shrink-0 text-[var(--danger)]"
      strokeWidth={1.75}
      aria-hidden="true"
    />
  ),
  warning: (
    <AlertTriangle
      className="mt-px h-4 w-4 shrink-0 text-[var(--warning)]"
      strokeWidth={1.75}
      aria-hidden="true"
    />
  ),
  info: (
    <Info
      className="mt-px h-4 w-4 shrink-0 text-[var(--accent)]"
      strokeWidth={1.75}
      aria-hidden="true"
    />
  ),
};

const toneStyles: Record<ToastType, string> = {
  success:
    'border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,var(--surface-1))]',
  error:
    'border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,var(--surface-1))]',
  warning:
    'border-[color-mix(in_srgb,var(--warning)_32%,transparent)] bg-[color-mix(in_srgb,var(--warning)_9%,var(--surface-1))]',
  info: 'border-[color-mix(in_srgb,var(--accent)_28%,transparent)] bg-[var(--surface-1)]',
};

export function Toast({ toast, onClose }: ToastProps) {
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(toast.duration ?? 3000);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (paused) {
      return;
    }

    startedAtRef.current = Date.now();
    const timer = window.setTimeout(() => onClose(toast.id), Math.max(remainingRef.current, 0));

    return () => {
      window.clearTimeout(timer);
      remainingRef.current -= Date.now() - startedAtRef.current;
    };
  }, [paused, toast.id, onClose]);

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`app-toast-in-corner pointer-events-auto flex w-full items-start gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5 shadow-[var(--shadow-lg)] ${toneStyles[toast.type]}`}
    >
      {icons[toast.type]}
      <span
        title={toast.message}
        className="line-clamp-2 flex-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-[var(--text-primary)]"
      >
        {toast.message}
      </span>
      <button
        onClick={() => onClose(toast.id)}
        aria-label="关闭通知"
        title="关闭"
        className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-colors duration-[var(--duration-hover)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
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
      className="pointer-events-none fixed bottom-5 right-5 z-[var(--z-toast)] flex flex-col gap-2"
      style={{ width: 'min(22rem, calc(100vw - 2.5rem))' }}
    >
      {toasts.slice(-3).map(toast => (
        <Toast key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  );
}
