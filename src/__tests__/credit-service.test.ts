/**
 * 输入: 模拟的 ChromeManager 页面和 LDC API 响应
 * 输出: CreditService 回归测试结果
 * 定位: 测试层 - 验证 LDC 登录态提示与登录流程的关键回归场景
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreditApiResponse } from '../shared/types/credit';

const mockUserDataPath = join(process.cwd(), '.tmp-vitest-credit');

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockUserDataPath),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('../main/utils/logger', () => ({
  Logger: {
    scope: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { CreditService } from '../main/credit-service';

function createCreditApiResponse(): CreditApiResponse {
  return {
    error_msg: '',
    data: {
      id: 1,
      username: 'tester',
      nickname: 'Tester',
      trust_level: 2,
      avatar_url: 'https://example.com/avatar.png',
      total_receive: '10',
      total_payment: '3',
      total_transfer: '0',
      total_community: '100',
      community_balance: '100',
      available_balance: '7',
      pay_score: 88,
      is_pay_key: true,
      is_admin: false,
      remain_quota: '5',
      pay_level: 2,
      daily_limit: 20,
    },
  };
}

describe('CreditService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rmSync(mockUserDataPath, { recursive: true, force: true });
    mkdirSync(mockUserDataPath, { recursive: true });
  });

  it('treats cached credit data as a valid login hint', async () => {
    const service = new CreditService({} as any);
    (service as any).cachedInfo = {
      id: 1,
      username: 'cached-user',
      nickname: 'Cached User',
      avatarUrl: 'https://example.com/avatar.png',
      trustLevel: 1,
      communityBalance: 10,
      gamificationScore: 0,
      difference: 0,
      totalReceive: '1',
      totalPayment: '0',
      totalTransfer: '0',
      totalCommunity: '10',
      availableBalance: '10',
      payScore: 1,
      payLevel: 1,
      isPayKey: false,
      remainQuota: '1',
      dailyLimit: 1,
      isAdmin: false,
      lastUpdated: Date.now(),
    };
    (service as any).cookies = null;

    await expect(service.getLoginStatus()).resolves.toBe(true);
  });

  it('accepts a valid browser session during login even when cf_clearance is absent', async () => {
    const page = {
      cookies: vi
        .fn()
        .mockResolvedValue([{ name: 'session', value: 'abc', domain: 'credit.linux.do' }]),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          error: null,
          data: createCreditApiResponse(),
        })
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: {
            error_msg: '',
            data: [{ date: '2026-04-24', income: '1', expense: '0' }],
          },
        })
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: {
            error_msg: '',
            data: {
              total: 0,
              page: 1,
              page_size: 10,
              orders: [],
            },
          },
        }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const release = vi.fn();
    const chromeManager = {
      createPage: vi.fn().mockResolvedValue({ page, release }),
    };
    const service = new CreditService(chromeManager as any);

    const result = await service.launchLogin();

    expect(result.success).toBe(true);
    expect(page.evaluate).toHaveBeenCalledTimes(3);
    expect((service as any).cookies).toContain('session=abc');
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rehydrates persisted cookies before fetching credit data', async () => {
    const page = {
      setCookie: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({
        success: true,
        status: 200,
        data: createCreditApiResponse(),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const release = vi.fn();
    const chromeManager = {
      createPage: vi.fn().mockResolvedValue({ page, release }),
    };
    const service = new CreditService(chromeManager as any);
    (service as any).cookies = 'session=abc; cf_clearance=def';

    const result = await service.fetchCreditData();

    expect(result.success).toBe(true);
    expect(page.setCookie).toHaveBeenCalledWith(
      { name: 'session', value: 'abc', url: 'https://credit.linux.do/home' },
      { name: 'cf_clearance', value: 'def', url: 'https://credit.linux.do/home' }
    );
    expect(page.goto).toHaveBeenCalledWith('https://credit.linux.do/home', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
  });
});
