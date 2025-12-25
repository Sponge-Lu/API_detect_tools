/**
 * 输入: ToastItem (消息项), ToastType (消息类型)
 * 输出: ToastStore (消息状态), 消息操作方法 (addToast, removeToast)
 * 定位: 状态管理层 - 管理 Toast 通知队列和生命周期
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/store/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { create } from 'zustand';
import type { ToastItem, ToastType } from '../components/Toast';

interface ToastStore {
  toasts: ToastItem[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

let toastId = 0;

export const useToastStore = create<ToastStore>(set => ({
  toasts: [],
  addToast: (type, message, duration = 5000) => {
    const id = `toast-${++toastId}`;
    set(state => ({
      toasts: [...state.toasts, { id, type, message, duration }],
    }));
  },
  removeToast: id => {
    set(state => ({
      toasts: state.toasts.filter(t => t.id !== id),
    }));
  },
}));

// 便捷方法
export const toast = {
  success: (message: string, duration?: number) =>
    useToastStore.getState().addToast('success', message, duration),
  error: (message: string, duration?: number) =>
    useToastStore.getState().addToast('error', message, duration),
  warning: (message: string, duration?: number) =>
    useToastStore.getState().addToast('warning', message, duration),
  info: (message: string, duration?: number) =>
    useToastStore.getState().addToast('info', message, duration),
};
