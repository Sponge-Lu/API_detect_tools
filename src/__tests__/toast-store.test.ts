import { beforeEach, describe, expect, it } from 'vitest';
import { toast, useToastStore } from '../renderer/store/toastStore';

describe('toast store', () => {
  beforeEach(() => {
    useToastStore.setState({
      toasts: [],
      eventHistory: [],
    });
  });

  it('keeps only the latest three visible toasts while preserving toast history', () => {
    toast.info('第一条通知');
    toast.success('第二条通知');
    toast.warning('第三条通知');
    toast.error('第四条通知');

    const state = useToastStore.getState();

    expect(state.toasts.map(item => item.message)).toEqual([
      '第二条通知',
      '第三条通知',
      '第四条通知',
    ]);
    expect(state.eventHistory).toHaveLength(4);
    expect(state.eventHistory[0]).toMatchObject({
      kind: 'toast',
      level: 'error',
      message: '第四条通知',
    });
    expect(state.eventHistory[3]).toMatchObject({
      kind: 'toast',
      level: 'info',
      message: '第一条通知',
    });
  });

  it('stores explicit action events separately from toast notifications', () => {
    useToastStore.getState().logEvent({
      kind: 'action',
      level: 'success',
      source: 'route',
      message: '模型重定向已更新',
    });

    const state = useToastStore.getState();

    expect(state.toasts).toHaveLength(0);
    expect(state.eventHistory[0]).toMatchObject({
      kind: 'action',
      source: 'route',
      level: 'success',
      message: '模型重定向已更新',
    });
  });
});
