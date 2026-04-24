/**
 * 输入: ToastItem (消息项), ToastType (消息类型)
 * 输出: ToastStore (消息状态), 消息/事件操作方法
 * 定位: 状态管理层 - 管理 Toast 通知队列、会话事件历史和生命周期
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/store/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { create } from 'zustand';
import type { ToastItem, ToastType } from '../components/Toast';

const MAX_VISIBLE_TOASTS = 3;
const MAX_EVENT_HISTORY = 200;

export type AppEventKind = 'toast' | 'action';

export interface AppEventItem {
  id: string;
  kind: AppEventKind;
  level: ToastType;
  source: string;
  message: string;
  createdAt: number;
}

export interface AppEventPayload {
  kind?: AppEventKind;
  level: ToastType;
  source: string;
  message: string;
}

interface ToastStore {
  toasts: ToastItem[];
  eventHistory: AppEventItem[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
  logEvent: (event: AppEventPayload) => string;
  clearEventHistory: () => void;
}

let toastId = 0;
let eventId = 0;

function createEvent(event: AppEventPayload): AppEventItem {
  return {
    id: `event-${++eventId}`,
    kind: event.kind ?? 'action',
    level: event.level,
    source: event.source,
    message: event.message,
    createdAt: Date.now(),
  };
}

export const useToastStore = create<ToastStore>(set => ({
  toasts: [],
  eventHistory: [],
  addToast: (type, message, duration = 5000) => {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) return;

    const id = `toast-${++toastId}`;
    const event = createEvent({
      kind: 'toast',
      level: type,
      source: 'notification',
      message: normalizedMessage,
    });

    set(state => ({
      toasts: [...state.toasts, { id, type, message: normalizedMessage, duration }].slice(
        -MAX_VISIBLE_TOASTS
      ),
      eventHistory: [event, ...state.eventHistory].slice(0, MAX_EVENT_HISTORY),
    }));
  },
  removeToast: id => {
    set(state => ({
      toasts: state.toasts.filter(t => t.id !== id),
    }));
  },
  clearToasts: () => set({ toasts: [] }),
  logEvent: event => {
    const normalizedMessage = event.message.trim();
    if (!normalizedMessage) return '';

    const nextEvent = createEvent({
      ...event,
      message: normalizedMessage,
    });

    set(state => ({
      eventHistory: [nextEvent, ...state.eventHistory].slice(0, MAX_EVENT_HISTORY),
    }));

    return nextEvent.id;
  },
  clearEventHistory: () => set({ eventHistory: [] }),
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
