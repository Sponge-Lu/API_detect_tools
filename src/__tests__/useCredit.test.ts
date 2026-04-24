/**
 * 输入: 模拟的 LDC IPC 响应
 * 输出: useCredit Hook 回归测试结果
 * 定位: 测试层 - 验证 LDC 缓存恢复、登录态回退与刷新错误传播
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreditInfo } from '../shared/types/credit';
import { DEFAULT_CREDIT_CONFIG } from '../shared/types/credit';
import { useCredit } from '../renderer/hooks/useCredit';

function createCreditInfo(overrides: Partial<CreditInfo> = {}): CreditInfo {
  return {
    id: 1,
    username: 'tester',
    nickname: 'Tester',
    avatarUrl: 'https://example.com/avatar.png',
    trustLevel: 2,
    communityBalance: 100,
    gamificationScore: 0,
    difference: 0,
    totalReceive: '10',
    totalPayment: '3',
    totalTransfer: '0',
    totalCommunity: '100',
    availableBalance: '7',
    payScore: 88,
    payLevel: 2,
    isPayKey: true,
    remainQuota: '5',
    dailyLimit: 20,
    isAdmin: false,
    lastUpdated: Date.now(),
    ...overrides,
  };
}

function createCreditApi(overrides: Record<string, unknown> = {}) {
  return {
    fetch: vi.fn().mockResolvedValue({ success: true, data: createCreditInfo() }),
    fetchDailyStats: vi.fn().mockResolvedValue({ success: true }),
    fetchTransactions: vi.fn().mockResolvedValue({ success: true }),
    refreshAll: vi.fn().mockResolvedValue({
      success: true,
      data: {
        creditInfo: createCreditInfo(),
        dailyStats: null,
        transactions: null,
      },
    }),
    login: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue({ success: true }),
    getStatus: vi.fn().mockResolvedValue({ success: true, data: false }),
    saveConfig: vi.fn().mockResolvedValue({ success: true }),
    loadConfig: vi.fn().mockResolvedValue({ success: true, data: DEFAULT_CREDIT_CONFIG }),
    getCached: vi.fn().mockResolvedValue({ success: true, data: null }),
    getCachedDailyStats: vi.fn().mockResolvedValue({ success: true, data: null }),
    getCachedTransactions: vi.fn().mockResolvedValue({ success: true, data: null }),
    initiateRecharge: vi.fn().mockResolvedValue({
      success: true,
      data: { success: true, paymentUrl: 'https://example.com/pay' },
    }),
    ...overrides,
  };
}

describe('useCredit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores cached credit data when status probing fails', async () => {
    const cachedInfo = createCreditInfo({ nickname: 'Cached User' });
    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      credit: createCreditApi({
        getCached: vi.fn().mockResolvedValue({ success: true, data: cachedInfo }),
        getStatus: vi.fn().mockResolvedValue({ success: false, error: 'status unavailable' }),
      }),
    };

    const { result } = renderHook(() => useCredit());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.creditInfo).toEqual(cachedInfo);
    expect(result.current.isLoggedIn).toBe(true);
  });

  it('throws refresh errors so the UI can surface failed refreshes', async () => {
    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      credit: createCreditApi({
        getStatus: vi.fn().mockResolvedValue({ success: true, data: true }),
        refreshAll: vi.fn().mockResolvedValue({
          success: false,
          error: '未登录，请先登录 Linux Do Credit',
        }),
      }),
    };

    const { result } = renderHook(() => useCredit());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await expect(result.current.refreshAll()).rejects.toThrow('未登录，请先登录 Linux Do Credit');
    });

    expect(result.current.error).toBe('未登录，请先登录 Linux Do Credit');
    expect(result.current.isLoggedIn).toBe(false);
  });
});
