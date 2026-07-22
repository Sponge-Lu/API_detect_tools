import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SiteSettingsDialog } from '../renderer/components/dialogs/CliProbeSettingsDialog';
import { DEFAULT_CLI_PROBE_CONFIG } from '../shared/types/route-proxy';

const siteRefreshSettings = {
  timeout: 30,
  concurrent: false,
  max_concurrent: 1,
  show_disabled: true,
  browser_path: '',
};

describe('SiteSettingsDialog', () => {
  it('uses the same single-column form flow for CLI probe settings as site refresh settings', () => {
    render(
      <SiteSettingsDialog
        isOpen
        cliProbeConfig={DEFAULT_CLI_PROBE_CONFIG}
        siteRefreshSettings={siteRefreshSettings}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    const cliProbePanel = screen.getByRole('tabpanel', { name: 'CLI 探测' });
    expect(cliProbePanel).toHaveClass('space-y-4');
    expect(cliProbePanel.querySelector(':scope > .grid')).toBeNull();
  });

  it('submits only the changed settings category', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <SiteSettingsDialog
        isOpen
        cliProbeConfig={DEFAULT_CLI_PROBE_CONFIG}
        siteRefreshSettings={siteRefreshSettings}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: '站点刷新' }));
    fireEvent.change(screen.getByLabelText('请求超时时间 (秒)'), {
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
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('cliProbeConfig');
  });

  it('discards draft changes when cancelled', () => {
    const onClose = vi.fn();
    const onSave = vi.fn();

    render(
      <SiteSettingsDialog
        isOpen
        cliProbeConfig={DEFAULT_CLI_PROBE_CONFIG}
        siteRefreshSettings={siteRefreshSettings}
        onClose={onClose}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText('探测间隔（分钟）'), {
      target: { value: '180' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});
