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
        authSource: 'main_profile',
      }
    );
  });

  it('智能添加成功后应自动回填识别出的站点类型', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const electronAPI = window.electronAPI;
    electronAPI.launchChromeForLogin.mockResolvedValue({ success: true });
    electronAPI.token.initializeSite.mockResolvedValue({
      success: true,
      data: {
        user_id: 9,
        site_name: 'AC_公益站',
        site_url: 'https://example.com',
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
        url: 'https://example.com',
        site_type: 'sub2api',
        api_key: 'sk-sub2api-raw-12345678',
        system_token: 'jwt-token',
        user_id: '9',
      }),
      {
        systemToken: 'jwt-token',
        userId: '9',
        authSource: 'main_profile',
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
        authSource: 'main_profile',
        accountName: '备用账户',
      }
    );
  });

  it('手动添加应将认证来源保存为 manual', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <SiteEditor
        initialMode="manual"
        onSave={onSave}
        onCancel={vi.fn()}
        groups={[{ id: 'default', name: '默认分组' }]}
        defaultGroupId="default"
      />
    );

    fireEvent.change(screen.getByPlaceholderText('输入站点名称'), {
      target: { value: 'Manual Hub' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://api.example.com'), {
      target: { value: 'https://manual.example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('输入用户ID'), {
      target: { value: 'manual-user' },
    });
    fireEvent.change(screen.getByPlaceholderText('请手动填入 Access Token'), {
      target: { value: 'manual-token' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存站点' }));
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Manual Hub',
        url: 'https://manual.example.com',
      }),
      expect.objectContaining({
        systemToken: 'manual-token',
        userId: 'manual-user',
        authSource: 'manual',
      })
    );
  });

  it('智能添加已有站点时应使用隔离 Profile 保存账户', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    const electronAPI = window.electronAPI;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const existingSite: SiteConfig = {
      id: 'site-existing',
      name: 'Existing Hub',
      url: 'https://existing.example.com',
      site_type: 'newapi',
      api_key: 'sk-existing',
      enabled: true,
      group: 'default',
    };

    electronAPI.loadConfig.mockResolvedValueOnce({ sites: [existingSite], accounts: [] });
    electronAPI.browserProfile.loginIsolated = vi.fn().mockResolvedValueOnce({
      success: true,
      data: {
        userId: 8,
        username: 'isolated-user',
        accessToken: 'isolated-token',
        authSource: 'isolated_profile',
        profilePath: 'C:/profiles/slot-2',
      },
    });
    electronAPI.accounts.add = vi.fn().mockResolvedValueOnce({
      success: true,
      data: { id: 'account-2' },
    });

    render(
      <SiteEditor
        onSave={onSave}
        onCancel={onCancel}
        groups={[{ id: 'default', name: '默认分组' }]}
        defaultGroupId="default"
      />
    );

    fireEvent.change(screen.getByPlaceholderText('https://api.example.com'), {
      target: { value: existingSite.url },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '获取信息' }));
    });
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(1000);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存站点' }));
    });

    expect(electronAPI.browserProfile.loginIsolated).toHaveBeenCalledWith(
      existingSite.id,
      existingSite.url,
      expect.any(String)
    );
    expect(electronAPI.accounts.add).toHaveBeenCalledWith(
      expect.objectContaining({
        site_id: existingSite.id,
        user_id: '8',
        access_token: 'isolated-token',
        auth_source: 'isolated_profile',
        browser_profile_path: 'C:/profiles/slot-2',
      })
    );
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it('编辑 AnyRouter 账户时默认部分明文显示 User Hash，并允许显隐切换', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const userHash = 'b'.repeat(64);

    const site: SiteConfig = {
      id: 'site-anyrouter',
      name: 'Any Router',
      url: 'https://anyrouter.top',
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
          id: 'acct-anyrouter',
          account_name: 'AnyRouter 账户',
          user_id: '42',
          access_token: 'token-123',
          anyRouterConfig: { userHash },
        }}
        onSave={onSave}
        onCancel={vi.fn()}
        groups={[{ id: 'default', name: '默认分组' }]}
        defaultGroupId="default"
      />
    );

    const hashInput = screen.getByLabelText('User Hash') as HTMLInputElement;
    expect(hashInput).toHaveValue(`${'b'.repeat(8)}********${'b'.repeat(8)}`);
    expect(hashInput.type).toBe('text');
    expect(hashInput).toHaveAttribute('readonly');
    expect(screen.queryByText(userHash)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '显示完整 User Hash' }));
    expect(hashInput).toHaveValue(userHash);
    expect(hashInput).not.toHaveAttribute('readonly');

    fireEvent.click(screen.getByRole('button', { name: '部分显示 User Hash' }));
    expect(hashInput).toHaveValue(`${'b'.repeat(8)}********${'b'.repeat(8)}`);
  });
});
