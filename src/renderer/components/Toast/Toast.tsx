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
  success: <CheckCircle className="w-5 h-5 text-green-500" strokeWidth={2} aria-hidden="true" />,
  error: <XCircle className="w-5 h-5 text-red-500" strokeWidth={2} aria-hidden="true" />,
  warning: <AlertTriangle className="w-5 h-5 text-yellow-500" strokeWidth={2} aria-hidden="true" />,
  info: <Info className="w-5 h-5 text-blue-500" strokeWidth={2} aria-hidden="true" />,
};

const bgColors: Record<ToastType, string> = {
  success: 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800',
  error: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800',
  warning: 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800',
  info: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800',
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
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg ${bgColors[toast.type]} animate-in slide-in-from-top-full duration-300`}
    >
      {icons[toast.type]}
      <span className="text-sm text-slate-700 dark:text-slate-200 flex-1">{toast.message}</span>
      <button
        onClick={() => onClose(toast.id)}
        aria-label="关闭通知"
        title="关闭"
        className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
      >
        <X className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
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
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 max-w-sm">
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  );
}
