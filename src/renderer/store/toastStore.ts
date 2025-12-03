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
  addToast: (type, message, duration = 3000) => {
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
