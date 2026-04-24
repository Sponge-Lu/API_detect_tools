import type { ToastType } from '../components/Toast';
import { useToastStore } from '../store/toastStore';

type ToastStoreState = {
  logEvent?: (event: {
    kind?: 'toast' | 'action';
    level: ToastType;
    source: string;
    message: string;
  }) => string;
};

function getToastStoreState(): ToastStoreState | null {
  const store = useToastStore as typeof useToastStore & {
    getState?: () => ToastStoreState;
  };

  return store.getState?.() ?? null;
}

function log(level: ToastType, source: string, message: string) {
  getToastStoreState()?.logEvent?.({
    kind: 'action',
    level,
    source,
    message,
  });
}

export const sessionEventLog = {
  success: (source: string, message: string) => log('success', source, message),
  error: (source: string, message: string) => log('error', source, message),
  warning: (source: string, message: string) => log('warning', source, message),
  info: (source: string, message: string) => log('info', source, message),
};
