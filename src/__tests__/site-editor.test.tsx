import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteEditor } from '../renderer/components/SiteEditor';
import type { SiteConfig } from '../shared/types/site';

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('SiteEditor', () => {
  it('persists the selected site type in the save payload', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    const site: SiteConfig = {
      id: 'site-1',
      name: 'Test Site',
      url: 'https://example.com',
      site_type: 'newapi',
      api_key: 'sk-test',
      system_token: 'token-123',
      user_id: '42',
      enabled: true,
      group: 'default',
      force_enable_checkin: false,
    };

    render(
      <SiteEditor
        site={site}
        editingAccount={null}
        onSave={onSave}
        onCancel={vi.fn()}
        groups={[{ id: 'default', name: '默认分组' }]}
        defaultGroupId="default"
      />
    );

    const siteTypeRow = screen.getByText('站点类型').parentElement;
    expect(siteTypeRow).not.toBeNull();

    expect(within(siteTypeRow as HTMLElement).getByText('New API')).toBeInTheDocument();
    fireEvent.click(within(siteTypeRow as HTMLElement).getByRole('button', { name: '修改类型' }));

    const siteTypeSelect = within(siteTypeRow as HTMLElement).getByRole('combobox');
    fireEvent.change(siteTypeSelect, { target: { value: 'sub2api' } });

    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Site',
        url: 'https://example.com',
        site_type: 'sub2api',
        api_key: 'sk-test',
        system_token: 'token-123',
        user_id: '42',
        group: 'default',
      }),
      {
        systemToken: 'token-123',
        userId: '42',
      }
    );
  });

  it('智能添加成功后应自动回填识别出的站点类型', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const electronAPI = window.electronAPI as any;
    electronAPI.launchChromeForLogin.mockResolvedValue({ success: true });
    electronAPI.token.initializeSite.mockResolvedValue({
      success: true,
      data: {
        user_id: 9,
        site_name: 'AC_公益站',
        access_token: 'jwt-token',
        api_key: 'sk-sub2api-raw-12345678',
        supportsCheckIn: false,
        site_type: 'sub2api',
      },
    });

    render(
      <SiteEditor
        editingAccount={null}
        onSave={onSave}
        onCancel={vi.fn()}
        groups={[{ id: 'default', name: '默认分组' }]}
        defaultGroupId="default"
      />
    );

    fireEvent.change(screen.getByPlaceholderText('https://api.example.com'), {
      target: { value: 'https://example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '获取信息' }));
    });
    expect(electronAPI.token.initializeSite).toHaveBeenCalledWith('https://example.com');

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(1000);
    });

    const siteTypeRow = screen.getByText('站点类型').parentElement;
    expect(siteTypeRow).not.toBeNull();
    expect(within(siteTypeRow as HTMLElement).getByText('Sub2API')).toBeInTheDocument();
    expect(within(siteTypeRow as HTMLElement).queryByRole('combobox')).toBeNull();

    fireEvent.click(within(siteTypeRow as HTMLElement).getByRole('button', { name: '修改类型' }));

    const siteTypeSelect = within(siteTypeRow as HTMLElement).getByRole('combobox');
    expect(siteTypeSelect).toHaveValue('sub2api');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存站点' }));
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'AC_公益站',
        site_type: 'sub2api',
        api_key: 'sk-sub2api-raw-12345678',
        system_token: 'jwt-token',
        user_id: '9',
      }),
      {
        systemToken: 'jwt-token',
        userId: '9',
      }
    );
  });

  it('编辑账户时应回传账户名称用于持久化', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    const site: SiteConfig = {
      id: 'site-1',
      name: 'Test Site',
      url: 'https://example.com',
      site_type: 'newapi',
      api_key: 'sk-test',
      system_token: 'token-123',
      user_id: '42',
      enabled: true,
      group: 'default',
      force_enable_checkin: false,
    };

    render(
      <SiteEditor
        site={site}
        editingAccount={{
          id: 'acct-1',
          account_name: '主账户',
          user_id: '42',
          access_token: 'token-123',
        }}
        onSave={onSave}
        onCancel={vi.fn()}
        groups={[{ id: 'default', name: '默认分组' }]}
        defaultGroupId="default"
      />
    );

    const accountNameInput = screen.getByDisplayValue('主账户');
    fireEvent.change(accountNameInput, { target: { value: '备用账户' } });

    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Site',
      }),
      {
        systemToken: 'token-123',
        userId: '42',
        accountName: '备用账户',
      }
    );
  });
});
