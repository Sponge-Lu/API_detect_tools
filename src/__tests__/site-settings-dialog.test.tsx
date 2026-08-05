import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SiteSettingsDialog } from '../renderer/components/dialogs/SiteSettingsDialog';

const siteRefreshSettings = {
  timeout: 30,
  concurrent: false,
  max_concurrent: 1,
  show_disabled: true,
  browser_path: '',
};

describe('SiteSettingsDialog', () => {
  it('only exposes site refresh settings', () => {
    render(
      <SiteSettingsDialog
        isOpen
        siteRefreshSettings={siteRefreshSettings}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByLabelText('请求超时（秒）')).toHaveValue(30);
    expect(screen.queryByText('CLI 探测')).not.toBeInTheDocument();
  });

  it('submits only the changed settings category', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <SiteSettingsDialog
        isOpen
        siteRefreshSettings={siteRefreshSettings}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText('请求超时（秒）'), {
      target: { value: '45' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        siteRefreshSettings: {
          ...siteRefreshSettings,
          timeout: 45,
        },
      })
    );
    expect(onSave.mock.calls[0][0]).toEqual({
      siteRefreshSettings: { ...siteRefreshSettings, timeout: 45 },
    });
  });

  it('discards draft changes when cancelled', () => {
    const onClose = vi.fn();
    const onSave = vi.fn();

    render(
      <SiteSettingsDialog
        isOpen
        siteRefreshSettings={siteRefreshSettings}
        onClose={onClose}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText('请求超时（秒）'), {
      target: { value: '45' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});
