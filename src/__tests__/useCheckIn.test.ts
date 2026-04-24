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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCheckIn } from '../renderer/hooks/useCheckIn';
import { BUILTIN_GROUP_IDS } from '../shared/types/site';

const mockUpsertResult = vi.fn();
const mockCheckinAndRefresh = vi.fn();

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
      openUrl: vi.fn(),
    };
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
});
