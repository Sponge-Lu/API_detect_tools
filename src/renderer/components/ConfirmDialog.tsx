/**
 * 输入: ConfirmDialogProps (弹窗状态、类型、标题、消息、回调)
 * 输出: React 组件 (确认弹窗 UI)
 * 定位: 展示层 - 自定义确认弹窗组件，替代原生 confirm/alert
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import React, { useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle, Info, X, AlertCircle } from 'lucide-react';

export type DialogType = 'confirm' | 'alert' | 'success' | 'warning' | 'error';

export interface ConfirmDialogProps {
  isOpen: boolean;
  type?: DialogType;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

const iconMap: Record<DialogType, React.ReactNode> = {
  confirm: <AlertCircle className="w-6 h-6 text-primary-500" />,
  alert: <Info className="w-6 h-6 text-blue-500" />,
  success: <CheckCircle className="w-6 h-6 text-green-500" />,
  warning: <AlertTriangle className="w-6 h-6 text-yellow-500" />,
  error: <AlertTriangle className="w-6 h-6 text-red-500" />,
};

const titleMap: Record<DialogType, string> = {
  confirm: '确认操作',
  alert: '提示',
  success: '成功',
  warning: '警告',
  error: '错误',
};

export function ConfirmDialog({
  isOpen,
  type = 'confirm',
  title,
  message,
  confirmText,
  cancelText = '取消',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // 自动聚焦确认按钮
  useEffect(() => {
    if (isOpen && confirmBtnRef.current) {
      confirmBtnRef.current.focus();
    }
  }, [isOpen]);

  // ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape' && onCancel) {
        onCancel();
      } else if (e.key === 'Enter') {
        onConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;

  const displayTitle = title || titleMap[type];
  const isAlertOnly = type === 'alert' || type === 'success' || type === 'error';
  const defaultConfirmText = isAlertOnly ? '确定' : '确认';

  // 根据类型确定确认按钮样式
  const confirmBtnClass =
    type === 'error' || type === 'warning'
      ? 'bg-red-500 hover:bg-red-600 focus:ring-red-500'
      : 'bg-primary-500 hover:bg-primary-600 focus:ring-primary-500';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />

      {/* 弹窗内容 */}
      <div
        ref={dialogRef}
        className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        {/* 标题栏 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          {iconMap[type]}
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex-1">
            {displayTitle}
          </h3>
          {onCancel && (
            <button
              onClick={onCancel}
              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* 消息内容 */}
        <div className="px-5 py-4">
          <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
            {message}
          </p>
        </div>

        {/* 按钮区域 */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
          {!isAlertOnly && onCancel && (
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-800 transition-all"
            >
              {cancelText}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-800 transition-all ${confirmBtnClass}`}
          >
            {confirmText || defaultConfirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// Hook: 用于管理弹窗状态
export interface DialogState {
  isOpen: boolean;
  type: DialogType;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export const initialDialogState: DialogState = {
  isOpen: false,
  type: 'confirm',
  message: '',
};
