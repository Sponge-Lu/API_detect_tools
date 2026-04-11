/**
 * @file src/renderer/components/ConfirmDialog.tsx
 * @description 确认对话框组件 - 使用统一弹窗原语实现
 *
 * 输入: ConfirmDialogProps (弹窗状态、类型、标题、消息、回调)
 * 输出: React 组件 (确认弹窗 UI)
 * 定位: 展示层 - 自定义确认弹窗组件，替代原生 confirm/alert
 *
 * @version 2.1.11
 * @updated 2026-04-02 - 对齐统一弹窗原语说明
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import React, { useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle, Info, AlertCircle } from 'lucide-react';
import { AppModal } from './AppModal/AppModal';
import { AppButton } from './AppButton/AppButton';

export type DialogType = 'confirm' | 'alert' | 'success' | 'warning' | 'error';

export interface ConfirmDialogProps {
  isOpen: boolean;
  type?: DialogType;
  title?: string;
  message: string;
  content?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  overlayZIndexClassName?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

const iconMap: Record<DialogType, React.ReactNode> = {
  confirm: <AlertCircle className="w-6 h-6 text-[var(--accent)]" />,
  alert: <Info className="w-6 h-6 text-[var(--accent)]" />,
  success: <CheckCircle className="w-6 h-6 text-[var(--success)]" />,
  warning: <AlertTriangle className="w-6 h-6 text-[var(--warning)]" />,
  error: <AlertTriangle className="w-6 h-6 text-[var(--danger)]" />,
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
  content,
  confirmText,
  cancelText = '取消',
  overlayZIndexClassName,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // 自动聚焦确认按钮
  useEffect(() => {
    if (isOpen && confirmBtnRef.current) {
      setTimeout(() => {
        confirmBtnRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Enter 键确认
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Enter') {
        onConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onConfirm]);

  const displayTitle = title || titleMap[type];
  const isAlertOnly = type === 'alert' || type === 'success' || type === 'error';
  const defaultConfirmText = isAlertOnly ? '确定' : '确认';

  // 根据类型确定确认按钮变体
  const confirmBtnVariant = type === 'error' || type === 'warning' ? 'danger' : 'primary';

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onCancel || onConfirm}
      title={displayTitle}
      titleIcon={iconMap[type]}
      size="sm"
      closeOnEsc={!!onCancel}
      closeOnOverlayClick={!!onCancel}
      showCloseButton={false}
      overlayZIndexClassName={overlayZIndexClassName}
      footer={
        <>
          {!isAlertOnly && onCancel && (
            <AppButton variant="tertiary" onClick={onCancel}>
              {cancelText}
            </AppButton>
          )}
          <AppButton ref={confirmBtnRef} variant={confirmBtnVariant} onClick={onConfirm}>
            {confirmText || defaultConfirmText}
          </AppButton>
        </>
      }
    >
      <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
        {message}
      </p>
      {content}
    </AppModal>
  );
}

// Hook: 用于管理弹窗状态
export interface DialogState {
  isOpen: boolean;
  type: DialogType;
  title?: string;
  message: string;
  content?: React.ReactNode;
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
