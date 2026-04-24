import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LogsPage } from '../renderer/pages/LogsPage';
import { useToastStore, type AppEventItem } from '../renderer/store/toastStore';

function buildEvent(
  partial: Partial<AppEventItem> & Pick<AppEventItem, 'id' | 'message'>
): AppEventItem {
  return {
    id: partial.id,
    kind: partial.kind ?? 'toast',
    level: partial.level ?? 'info',
    source: partial.source ?? 'notification',
    message: partial.message,
    createdAt: partial.createdAt ?? Date.now(),
  };
}

describe('LogsPage', () => {
  beforeEach(() => {
    useToastStore.setState({
      toasts: [],
      eventHistory: [],
    });
  });

  it('filters session events by notification and action kinds and clears history', () => {
    useToastStore.setState({
      eventHistory: [
        buildEvent({
          id: 'event-1',
          kind: 'toast',
          level: 'error',
          source: 'notification',
          message: '通知：模型重定向目录已重建',
          createdAt: 1,
        }),
        buildEvent({
          id: 'event-2',
          kind: 'action',
          level: 'success',
          source: 'route',
          message: '操作：模型重定向已更新',
          createdAt: 2,
        }),
      ],
    });

    render(<LogsPage />);

    expect(screen.getByText('通知：模型重定向目录已重建')).toBeInTheDocument();
    expect(screen.getByText('操作：模型重定向已更新')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '通知' }));
    expect(screen.getByText('通知：模型重定向目录已重建')).toBeInTheDocument();
    expect(screen.queryByText('操作：模型重定向已更新')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '操作' }));
    expect(screen.queryByText('通知：模型重定向目录已重建')).not.toBeInTheDocument();
    expect(screen.getByText('操作：模型重定向已更新')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清空会话记录' }));
    expect(useToastStore.getState().eventHistory).toHaveLength(0);
    expect(screen.getByText('暂无会话记录')).toBeInTheDocument();
  });
});
