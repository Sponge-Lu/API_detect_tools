/**
 * 输入: useCheckIn 依赖的站点配置、检测结果和 Electron IPC mock
 * 输出: 批量签到过滤逻辑的回归测试结果
 * 定位: 测试层 - 验证一键签到不会调度不可用分组站点
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useCheckIn } from '../renderer/hooks/useCheckIn';
import { BUILTIN_GROUP_IDS } from '../shared/types/site';

const mockUpsertResult = vi.fn();
const mockCheckinAndRefresh = vi.fn();
const mockOpenUrl = vi.fn();
const mockOpenSiteForCheckin = vi.fn();
const mockPersistCheckinCompletion = vi.fn();

let mockResults: any[] = [];
let mockConfig: any = null;

vi.mock('../renderer/store/detectionStore', () => ({
  useDetectionStore: () => ({
    results: mockResults,
    upsertResult: mockUpsertResult,
  }),
}));

vi.mock('../renderer/store/configStore', () => ({
  useConfigStore: () => ({
    config: mockConfig,
  }),
}));

describe('useCheckIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockResults = [
      {
        name: 'Available Site',
        status: '成功',
        has_checkin: true,
        can_check_in: true,
      },
      {
        name: 'Unavailable Site',
        status: '成功',
        has_checkin: true,
        can_check_in: true,
      },
    ];

    mockConfig = {
      settings: {
        timeout: 30,
      },
      sites: [
        {
          id: 'site-available',
          name: 'Available Site',
          url: 'https://available.example.com',
          enabled: true,
          group: BUILTIN_GROUP_IDS.DEFAULT,
          api_key: '',
          system_token: 'token-a',
          user_id: '1',
          site_type: 'newapi',
        },
        {
          id: 'site-unavailable',
          name: 'Unavailable Site',
          url: 'https://unavailable.example.com',
          enabled: true,
          group: BUILTIN_GROUP_IDS.UNAVAILABLE,
          api_key: '',
          system_token: 'token-b',
          user_id: '2',
          site_type: 'newapi',
        },
      ],
    };

    mockCheckinAndRefresh.mockResolvedValue({
      checkinResult: {
        success: true,
        message: 'ok',
      },
      balanceResult: {
        success: true,
        balance: 12.3,
      },
    });

    (window as any).electronAPI = {
      checkinAndRefresh: mockCheckinAndRefresh,
      openUrl: mockOpenUrl,
      browserProfile: {
        openSiteForCheckin: mockOpenSiteForCheckin,
        persistCheckinCompletion: mockPersistCheckinCompletion,
      },
    };

    mockPersistCheckinCompletion.mockResolvedValue({
      success: true,
    });
  });

  it('批量签到应跳过不可用分组站点', async () => {
    const showAlert = vi.fn();
    const showDialog = vi.fn(async () => false);
    const setCheckingIn = vi.fn();

    const { result } = renderHook(() =>
      useCheckIn({
        showAlert,
        showDialog,
        setCheckingIn,
      })
    );

    let summary: { success: number; failed: number; skipped: number } | undefined;
    await act(async () => {
      summary = await result.current.handleCheckInAll();
    });

    expect(summary).toEqual({ success: 1, failed: 0, skipped: 0 });
    expect(mockCheckinAndRefresh).toHaveBeenCalledTimes(1);
    expect(mockCheckinAndRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Available Site' }),
      30,
      undefined
    );
  });

  it('点击自动签到失败弹窗的打开网站后应标记站点为今日已签到', async () => {
    const showAlert = vi.fn();
    const showDialog = vi.fn(async () => true);
    const setCheckingIn = vi.fn();

    mockCheckinAndRefresh.mockResolvedValue({
      checkinResult: {
        success: false,
        needManualCheckIn: true,
        message: '需要手动签到',
        siteType: 'newapi',
      },
      balanceResult: null,
    });

    const { result } = renderHook(() =>
      useCheckIn({
        showAlert,
        showDialog,
        setCheckingIn,
      })
    );

    await act(async () => {
      await result.current.handleCheckIn(mockConfig.sites[0]);
    });

    expect(mockOpenUrl).toHaveBeenCalledWith('https://available.example.com/console/personal');
    expect(mockUpsertResult).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Available Site',
        can_check_in: false,
        lastRefresh: expect.any(Number),
      })
    );
    expect(mockPersistCheckinCompletion).toHaveBeenCalledWith(
      'site-available',
      undefined,
      expect.objectContaining({
        has_checkin: true,
        can_check_in: false,
        last_refresh: expect.any(Number),
      })
    );
  });

  it('账户级签到不应因站点级 token 为空而提前进入手动签到', async () => {
    const showAlert = vi.fn();
    const showDialog = vi.fn(async () => false);
    const setCheckingIn = vi.fn();
    const accountId = 'acct-available';
    const siteWithoutLegacyToken = {
      ...mockConfig.sites[0],
      system_token: '',
      user_id: '',
    };

    mockResults = [
      {
        name: 'Available Site',
        status: '成功',
        has_checkin: true,
        can_check_in: true,
        accountId,
      },
    ];

    const { result } = renderHook(() =>
      useCheckIn({
        showAlert,
        showDialog,
        setCheckingIn,
      })
    );

    await act(async () => {
      await result.current.handleCheckIn(siteWithoutLegacyToken, accountId);
    });

    expect(showDialog).not.toHaveBeenCalled();
    expect(mockCheckinAndRefresh).toHaveBeenCalledWith(siteWithoutLegacyToken, 30, accountId);
    expect(showAlert).toHaveBeenCalledWith(expect.stringContaining('ok'), 'success', '签到成功');
  });

  it('Any Router 应使用账户浏览器签到并记录固定奖励 25 美元', async () => {
    const showAlert = vi.fn();
    const showDialog = vi.fn(async () => false);
    const setCheckingIn = vi.fn();

    mockResults = [
      {
        name: 'Any Router',
        status: '成功',
        has_checkin: true,
        can_check_in: true,
        accountId: 'acct-anyrouter',
        checkinStats: {
          checkinCount: 3,
        },
      },
    ];

    mockConfig = {
      settings: {
        timeout: 30,
      },
      sites: [
        {
          id: 'site-anyrouter',
          name: 'Any Router',
          url: 'https://anyrouter.top/',
          enabled: true,
          group: BUILTIN_GROUP_IDS.DEFAULT,
          api_key: '',
          site_type: 'newapi',
        },
      ],
    };

    mockOpenSiteForCheckin.mockResolvedValue({
      success: true,
    });

    const { result } = renderHook(() =>
      useCheckIn({
        showAlert,
        showDialog,
        setCheckingIn,
      })
    );

    await act(async () => {
      await result.current.handleCheckIn(mockConfig.sites[0], 'acct-anyrouter');
    });

    expect(mockCheckinAndRefresh).not.toHaveBeenCalled();
    expect(mockOpenSiteForCheckin).toHaveBeenCalledWith(
      'site-anyrouter',
      'https://anyrouter.top',
      'acct-anyrouter'
    );
    expect(mockPersistCheckinCompletion).toHaveBeenCalledWith(
      'site-anyrouter',
      'acct-anyrouter',
      expect.objectContaining({
        has_checkin: true,
        can_check_in: false,
        last_refresh: expect.any(Number),
        checkin_stats: expect.objectContaining({
          today_quota: 12500000,
          checkin_count: 3,
          site_type: 'newapi',
        }),
      })
    );
    expect(mockUpsertResult).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Any Router',
        can_check_in: false,
        checkinStats: expect.objectContaining({
          todayQuota: 12500000,
          checkinCount: 3,
          siteType: 'newapi',
        }),
        lastRefresh: expect.any(Number),
      })
    );
    expect(showAlert).toHaveBeenCalledWith(
      expect.stringContaining('获得奖励: $25.00'),
      'success',
      '签到成功'
    );
  });

  it('点击批量签到失败列表的手动签到按钮后应标记对应站点为今日已签到', async () => {
    const showAlert = vi.fn();
    const showDialog = vi.fn(async () => false);
    const setCheckingIn = vi.fn();

    mockCheckinAndRefresh.mockResolvedValue({
      checkinResult: {
        success: false,
        message: '需要手动签到',
        siteType: 'newapi',
      },
      balanceResult: null,
    });

    const { result } = renderHook(() =>
      useCheckIn({
        showAlert,
        showDialog,
        setCheckingIn,
      })
    );

    await act(async () => {
      await result.current.handleCheckInAll();
    });

    const failedContent = showAlert.mock.calls[0]?.[3];
    render(React.createElement(React.Fragment, null, failedContent));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '手动签到 →' }));
    });

    await waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledWith('https://available.example.com/console/personal');
    });
    expect(mockUpsertResult).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Available Site',
        can_check_in: false,
        lastRefresh: expect.any(Number),
      })
    );
    expect(mockPersistCheckinCompletion).toHaveBeenCalledWith(
      'site-available',
      undefined,
      expect.objectContaining({
        has_checkin: true,
        can_check_in: false,
        last_refresh: expect.any(Number),
      })
    );
  });
});
