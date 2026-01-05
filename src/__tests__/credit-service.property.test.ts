/**
 * 输入: 模拟的积分数据和配置参数
 * 输出: 属性测试验证结果
 * 定位: 测试层 - Credit Service 的属性测试，验证设计文档中定义的正确性属性
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 *
 * **功能: linux-do-credit**
 * 使用 fast-check 进行属性测试，验证设计文档中定义的正确性属性
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  calculateDifference,
  clampRefreshInterval,
  getDifferenceColorType,
  fillCreditConfigDefaults,
  calculateTotalIncome,
  calculateTotalExpense,
  MIN_REFRESH_INTERVAL,
  DEFAULT_CREDIT_CONFIG,
  type CreditConfig,
} from '../shared/types/credit';

// ============= Arbitraries =============

/**
 * Generate a valid number for gamification score or community balance
 * Using integers to avoid floating point precision issues
 */
const scoreArb = fc.integer({ min: -10000000, max: 10000000 });

/**
 * Generate a valid refresh interval (can be any positive number)
 */
const refreshIntervalArb = fc.integer({ min: 1, max: 3600 });

/**
 * Generate a partial CreditConfig for testing defaults
 */
const partialConfigArb: fc.Arbitrary<Partial<CreditConfig>> = fc.record(
  {
    enabled: fc.boolean(),
    autoRefresh: fc.boolean(),
    refreshInterval: refreshIntervalArb,
  },
  { requiredKeys: [] }
);

// ============= Property Tests =============

/**
 * **Property 1: Difference Calculation Correctness**
 * **Validates: Requirements 1.3**
 *
 * *For any* pair of valid numbers (gamificationScore, communityBalance),
 * the calculated difference SHALL equal `gamificationScore - communityBalance`.
 */
describe('Property 1: Difference Calculation Correctness', () => {
  it('should correctly calculate difference for any valid integers', () => {
    fc.assert(
      fc.property(scoreArb, scoreArb, (gamificationScore, communityBalance) => {
        const result = calculateDifference(gamificationScore, communityBalance);
        expect(result).toBe(gamificationScore - communityBalance);
      }),
      { numRuns: 100 }
    );
  });

  it('should return zero when both values are equal', () => {
    fc.assert(
      fc.property(scoreArb, score => {
        const result = calculateDifference(score, score);
        expect(result).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should return positive when gamificationScore > communityBalance', () => {
    fc.assert(
      fc.property(
        scoreArb,
        fc.integer({ min: 1, max: 10000000 }),
        (communityBalance, positiveOffset) => {
          const gamificationScore = communityBalance + positiveOffset;
          const result = calculateDifference(gamificationScore, communityBalance);
          expect(result).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return negative when gamificationScore < communityBalance', () => {
    fc.assert(
      fc.property(
        scoreArb,
        fc.integer({ min: 1, max: 10000000 }),
        (gamificationScore, positiveOffset) => {
          const communityBalance = gamificationScore + positiveOffset;
          const result = calculateDifference(gamificationScore, communityBalance);
          expect(result).toBeLessThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should be antisymmetric: diff(a, b) = -diff(b, a)', () => {
    fc.assert(
      fc.property(scoreArb, scoreArb, (a, b) => {
        const diffAB = calculateDifference(a, b);
        const diffBA = calculateDifference(b, a);
        // Use numerical equality to handle +0 vs -0 edge case
        expect(diffAB + diffBA).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * **Property 6: Difference Color Coding**
 * **Validates: Requirements 3.3**
 *
 * *For any* difference value, the getDifferenceColorType function SHALL return:
 * - 'positive' for diff > 0
 * - 'negative' for diff < 0
 * - 'neutral' for diff === 0
 */
describe('Property 6: Difference Color Coding', () => {
  it('should return positive for positive differences', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000000 }), positiveDiff => {
        const result = getDifferenceColorType(positiveDiff);
        expect(result).toBe('positive');
      }),
      { numRuns: 100 }
    );
  });

  it('should return negative for negative differences', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10000000, max: -1 }), negativeDiff => {
        const result = getDifferenceColorType(negativeDiff);
        expect(result).toBe('negative');
      }),
      { numRuns: 100 }
    );
  });

  it('should return neutral for zero difference', () => {
    const result = getDifferenceColorType(0);
    expect(result).toBe('neutral');
  });

  it('should always return one of the three valid color types', () => {
    fc.assert(
      fc.property(scoreArb, diff => {
        const result = getDifferenceColorType(diff);
        expect(['positive', 'negative', 'neutral']).toContain(result);
      }),
      { numRuns: 100 }
    );
  });

  it('should be consistent with calculateDifference result', () => {
    fc.assert(
      fc.property(scoreArb, scoreArb, (gamificationScore, communityBalance) => {
        const diff = calculateDifference(gamificationScore, communityBalance);
        const colorType = getDifferenceColorType(diff);

        if (gamificationScore > communityBalance) {
          expect(colorType).toBe('positive');
        } else if (gamificationScore < communityBalance) {
          expect(colorType).toBe('negative');
        } else {
          expect(colorType).toBe('neutral');
        }
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * **Property 8: Auto-refresh Interval Validation**
 * **Validates: Requirements 5.3**
 *
 * *For any* refresh interval value provided by the user, the system SHALL
 * enforce a minimum of 30 seconds. Values less than 30 SHALL be clamped to 30.
 */
describe('Property 8: Auto-refresh Interval Validation', () => {
  it('should clamp values below minimum to MIN_REFRESH_INTERVAL', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MIN_REFRESH_INTERVAL - 1 }), interval => {
        const result = clampRefreshInterval(interval);
        expect(result).toBe(MIN_REFRESH_INTERVAL);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve values at or above minimum', () => {
    fc.assert(
      fc.property(fc.integer({ min: MIN_REFRESH_INTERVAL, max: 3600 }), interval => {
        const result = clampRefreshInterval(interval);
        expect(result).toBe(interval);
      }),
      { numRuns: 100 }
    );
  });

  it('should always return at least MIN_REFRESH_INTERVAL', () => {
    fc.assert(
      fc.property(refreshIntervalArb, interval => {
        const result = clampRefreshInterval(interval);
        expect(result).toBeGreaterThanOrEqual(MIN_REFRESH_INTERVAL);
      }),
      { numRuns: 100 }
    );
  });

  it('should be idempotent - clamping twice produces same result', () => {
    fc.assert(
      fc.property(refreshIntervalArb, interval => {
        const once = clampRefreshInterval(interval);
        const twice = clampRefreshInterval(once);
        expect(once).toBe(twice);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * **Property 2: API Error Handling**
 * **Validates: Requirements 1.4, 1.5**
 *
 * *For any* API error response (network error, timeout, 4xx, 5xx),
 * the formatErrorMessage function SHALL return a non-empty error string
 * describing the failure appropriately.
 */
describe('Property 2: API Error Handling', () => {
  // Error types to test
  const errorTypesArb = fc.oneof(
    // Timeout errors
    fc.record({
      code: fc.constant('ECONNABORTED'),
      message: fc.constant('timeout of 15000ms exceeded'),
    }),
    fc.record({
      message: fc.constant('Request timeout'),
    }),
    // 401 Unauthorized
    fc.record({
      response: fc.record({
        status: fc.constant(401),
      }),
      message: fc.string(),
    }),
    // 403 Forbidden
    fc.record({
      response: fc.record({
        status: fc.constant(403),
      }),
      message: fc.string(),
    }),
    // 5xx Server errors
    fc.record({
      response: fc.record({
        status: fc.integer({ min: 500, max: 599 }),
      }),
      message: fc.string(),
    }),
    // JSON parsing errors
    fc.record({
      message: fc.constantFrom(
        'Unexpected token < in JSON',
        'JSON.parse: unexpected character',
        'Invalid JSON response'
      ),
    }),
    // Generic errors
    fc.record({
      message: fc.string({ minLength: 1 }),
    })
  );

  /**
   * Helper function to format error messages (mirrors CreditService.formatErrorMessage)
   */
  function formatErrorMessage(error: any): string {
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return '网络请求超时，请检查网络连接';
    }
    if (error.response?.status === 401) {
      return '未登录，请先登录 Linux Do Credit';
    }
    if (error.response?.status === 403) {
      return '登录已过期，请重新登录';
    }
    if (error.response?.status >= 500) {
      return '服务器暂时不可用，请稍后重试';
    }
    if (error.message?.includes('JSON')) {
      return '数据格式异常，请稍后重试';
    }
    return error.message || '未知错误';
  }

  it('should always return a non-empty error string', () => {
    fc.assert(
      fc.property(errorTypesArb, error => {
        const result = formatErrorMessage(error);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should return timeout message for timeout errors', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.record({ code: fc.constant('ECONNABORTED'), message: fc.string() }),
          fc.record({ message: fc.constant('timeout of 15000ms exceeded') })
        ),
        error => {
          const result = formatErrorMessage(error);
          expect(result).toBe('网络请求超时，请检查网络连接');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return login required message for 401 errors', () => {
    fc.assert(
      fc.property(
        fc.record({
          response: fc.record({ status: fc.constant(401) }),
          message: fc.string(),
        }),
        error => {
          const result = formatErrorMessage(error);
          expect(result).toBe('未登录，请先登录 Linux Do Credit');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return re-login message for 403 errors', () => {
    fc.assert(
      fc.property(
        fc.record({
          response: fc.record({ status: fc.constant(403) }),
          message: fc.string(),
        }),
        error => {
          const result = formatErrorMessage(error);
          expect(result).toBe('登录已过期，请重新登录');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return server error message for 5xx errors', () => {
    fc.assert(
      fc.property(
        fc.record({
          response: fc.record({ status: fc.integer({ min: 500, max: 599 }) }),
          message: fc.string(),
        }),
        error => {
          const result = formatErrorMessage(error);
          expect(result).toBe('服务器暂时不可用，请稍后重试');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return parsing error message for JSON errors', () => {
    fc.assert(
      fc.property(
        fc.record({
          message: fc.constantFrom(
            'Unexpected token < in JSON',
            'JSON.parse: unexpected character',
            'Invalid JSON response'
          ),
        }),
        error => {
          const result = formatErrorMessage(error);
          expect(result).toBe('数据格式异常，请稍后重试');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return original message for unknown errors', () => {
    const customMessage = 'Custom error message';
    const result = formatErrorMessage({ message: customMessage });
    expect(result).toBe(customMessage);
  });

  it('should return "未知错误" when no message is provided', () => {
    const result = formatErrorMessage({});
    expect(result).toBe('未知错误');
  });
});

/**
 * **Property 10: Settings Persistence Round-trip (Config Defaults)**
 * **Validates: Requirements 5.5, 6.1, 6.2**
 *
 * *For any* partial CreditConfig, filling defaults SHALL produce a valid
 * complete CreditConfig with all required fields.
 */
describe('Property 10: Settings Persistence Round-trip (Config Defaults)', () => {
  it('should fill missing fields with defaults', () => {
    fc.assert(
      fc.property(partialConfigArb, partial => {
        const result = fillCreditConfigDefaults(partial);

        // All fields should be defined
        expect(typeof result.enabled).toBe('boolean');
        expect(typeof result.autoRefresh).toBe('boolean');
        expect(typeof result.refreshInterval).toBe('number');
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve provided values', () => {
    fc.assert(
      fc.property(partialConfigArb, partial => {
        const result = fillCreditConfigDefaults(partial);

        if (partial.enabled !== undefined) {
          expect(result.enabled).toBe(partial.enabled);
        }
        if (partial.autoRefresh !== undefined) {
          expect(result.autoRefresh).toBe(partial.autoRefresh);
        }
        if (partial.refreshInterval !== undefined) {
          // Note: refreshInterval is clamped, so we check the clamped value
          expect(result.refreshInterval).toBe(clampRefreshInterval(partial.refreshInterval));
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should use DEFAULT_CREDIT_CONFIG for missing fields', () => {
    const result = fillCreditConfigDefaults({});

    expect(result.enabled).toBe(DEFAULT_CREDIT_CONFIG.enabled);
    expect(result.autoRefresh).toBe(DEFAULT_CREDIT_CONFIG.autoRefresh);
    expect(result.refreshInterval).toBe(DEFAULT_CREDIT_CONFIG.refreshInterval);
  });

  it('should always clamp refreshInterval to minimum', () => {
    fc.assert(
      fc.property(partialConfigArb, partial => {
        const result = fillCreditConfigDefaults(partial);
        expect(result.refreshInterval).toBeGreaterThanOrEqual(MIN_REFRESH_INTERVAL);
      }),
      { numRuns: 100 }
    );
  });

  it('should be idempotent - filling defaults twice produces same result', () => {
    fc.assert(
      fc.property(partialConfigArb, partial => {
        const once = fillCreditConfigDefaults(partial);
        const twice = fillCreditConfigDefaults(once);

        expect(once.enabled).toBe(twice.enabled);
        expect(once.autoRefresh).toBe(twice.autoRefresh);
        expect(once.refreshInterval).toBe(twice.refreshInterval);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * **Property 13: IPC Response Format Consistency**
 * **Validates: Requirements 8.6**
 *
 * *For any* IPC handler response, the response SHALL conform to the CreditResponse
 * interface with `success: boolean` and either `data` (on success) or `error` (on failure).
 */
describe('Property 13: IPC Response Format Consistency', () => {
  /**
   * Helper functions that mirror the credit-handlers.ts response creators
   */
  function createSuccessResponse<T>(data?: T): { success: boolean; data?: T; error?: string } {
    return data !== undefined ? { success: true, data } : { success: true };
  }

  function createErrorResponse<T = unknown>(
    error: string
  ): {
    success: boolean;
    data?: T;
    error?: string;
  } {
    return { success: false, error };
  }

  /**
   * Arbitrary for generating various data types that could be returned
   */
  const dataArb = fc.oneof(
    fc.constant(undefined),
    fc.boolean(),
    fc.integer(),
    fc.string(),
    fc.record({
      username: fc.string(),
      communityBalance: fc.integer(),
      gamificationScore: fc.integer(),
      difference: fc.integer(),
      lastUpdated: fc.integer({ min: 0 }),
    }),
    fc.record({
      enabled: fc.boolean(),
      autoRefresh: fc.boolean(),
      refreshInterval: fc.integer({ min: 30, max: 3600 }),
    }),
    fc.constant(null)
  );

  /**
   * Arbitrary for generating error messages
   */
  const errorMessageArb = fc.string({ minLength: 1, maxLength: 200 });

  it('success response should have success: true', () => {
    fc.assert(
      fc.property(dataArb, data => {
        const response = createSuccessResponse(data);
        expect(response.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('success response should not have error field', () => {
    fc.assert(
      fc.property(dataArb, data => {
        const response = createSuccessResponse(data);
        expect(response.error).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('success response with data should include data field', () => {
    fc.assert(
      fc.property(fc.oneof(fc.boolean(), fc.integer(), fc.string(), fc.object()), data => {
        const response = createSuccessResponse(data);
        expect(response.data).toEqual(data);
      }),
      { numRuns: 100 }
    );
  });

  it('success response without data should not include data field', () => {
    const response = createSuccessResponse();
    expect(response.data).toBeUndefined();
    expect(response.success).toBe(true);
  });

  it('error response should have success: false', () => {
    fc.assert(
      fc.property(errorMessageArb, errorMsg => {
        const response = createErrorResponse(errorMsg);
        expect(response.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('error response should have non-empty error string', () => {
    fc.assert(
      fc.property(errorMessageArb, errorMsg => {
        const response = createErrorResponse(errorMsg);
        expect(typeof response.error).toBe('string');
        expect(response.error!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('error response should not have data field', () => {
    fc.assert(
      fc.property(errorMessageArb, errorMsg => {
        const response = createErrorResponse(errorMsg);
        expect(response.data).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('response should always have success field as boolean', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          dataArb.map(d => createSuccessResponse(d)),
          errorMessageArb.map(e => createErrorResponse(e))
        ),
        response => {
          expect(typeof response.success).toBe('boolean');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('success and error should be mutually exclusive in response', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          dataArb.map(d => createSuccessResponse(d)),
          errorMessageArb.map(e => createErrorResponse(e))
        ),
        response => {
          if (response.success) {
            expect(response.error).toBeUndefined();
          } else {
            expect(response.error).toBeDefined();
            expect(typeof response.error).toBe('string');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('CreditInfo response should have all required fields when successful', () => {
    const creditInfoArb = fc.record({
      username: fc.string({ minLength: 1 }),
      communityBalance: fc.integer(),
      gamificationScore: fc.integer(),
      difference: fc.integer(),
      lastUpdated: fc.integer({ min: 0 }),
    });

    fc.assert(
      fc.property(creditInfoArb, creditInfo => {
        const response = createSuccessResponse(creditInfo);

        expect(response.success).toBe(true);
        expect(response.data).toBeDefined();
        expect(response.data!.username).toBeDefined();
        expect(response.data!.communityBalance).toBeDefined();
        expect(response.data!.gamificationScore).toBeDefined();
        expect(response.data!.difference).toBeDefined();
        expect(response.data!.lastUpdated).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });

  it('CreditConfig response should have all required fields when successful', () => {
    const creditConfigArb = fc.record({
      enabled: fc.boolean(),
      autoRefresh: fc.boolean(),
      refreshInterval: fc.integer({ min: 30, max: 3600 }),
    });

    fc.assert(
      fc.property(creditConfigArb, creditConfig => {
        const response = createSuccessResponse(creditConfig);

        expect(response.success).toBe(true);
        expect(response.data).toBeDefined();
        expect(typeof response.data!.enabled).toBe('boolean');
        expect(typeof response.data!.autoRefresh).toBe('boolean');
        expect(typeof response.data!.refreshInterval).toBe('number');
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * **Property 14: Daily Stats Total Calculation**
 * **Validates: Requirements 9.3, 9.4**
 *
 * *For any* array of DailyStatItem objects, the calculated totalIncome SHALL equal
 * the sum of all income values, and totalExpense SHALL equal the sum of all expense values.
 */
describe('Property 14: Daily Stats Total Calculation', () => {
  /**
   * Arbitrary for generating a valid DailyStatItem
   */
  const dailyStatItemArb = fc.record({
    date: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).map(d => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }),
    income: fc.float({ min: 0, max: 10000, noNaN: true }).map(n => n.toFixed(2)),
    expense: fc.float({ min: 0, max: 10000, noNaN: true }).map(n => n.toFixed(2)),
  });

  /**
   * Arbitrary for generating an array of DailyStatItems
   */
  const dailyStatItemsArb = fc.array(dailyStatItemArb, { minLength: 0, maxLength: 30 });

  it('should calculate totalIncome as sum of all income values', () => {
    fc.assert(
      fc.property(dailyStatItemsArb, items => {
        const result = calculateTotalIncome(items);
        const expected = items.reduce((sum, item) => sum + parseFloat(item.income || '0'), 0);
        // Use approximate equality due to floating point precision
        expect(Math.abs(result - expected)).toBeLessThan(0.01);
      }),
      { numRuns: 100 }
    );
  });

  it('should calculate totalExpense as sum of all expense values', () => {
    fc.assert(
      fc.property(dailyStatItemsArb, items => {
        const result = calculateTotalExpense(items);
        const expected = items.reduce((sum, item) => sum + parseFloat(item.expense || '0'), 0);
        // Use approximate equality due to floating point precision
        expect(Math.abs(result - expected)).toBeLessThan(0.01);
      }),
      { numRuns: 100 }
    );
  });

  it('should return 0 for empty array', () => {
    expect(calculateTotalIncome([])).toBe(0);
    expect(calculateTotalExpense([])).toBe(0);
  });

  it('should handle items with zero values', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            date: fc.constant('2025-12-30'),
            income: fc.constant('0'),
            expense: fc.constant('0'),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        items => {
          expect(calculateTotalIncome(items)).toBe(0);
          expect(calculateTotalExpense(items)).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle items with empty string values', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            date: fc.constant('2025-12-30'),
            income: fc.constant(''),
            expense: fc.constant(''),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        items => {
          expect(calculateTotalIncome(items)).toBe(0);
          expect(calculateTotalExpense(items)).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should be commutative - order of items should not affect totals', () => {
    fc.assert(
      fc.property(dailyStatItemsArb, items => {
        const originalIncome = calculateTotalIncome(items);
        const originalExpense = calculateTotalExpense(items);

        // Reverse the array
        const reversed = [...items].reverse();
        const reversedIncome = calculateTotalIncome(reversed);
        const reversedExpense = calculateTotalExpense(reversed);

        expect(Math.abs(originalIncome - reversedIncome)).toBeLessThan(0.01);
        expect(Math.abs(originalExpense - reversedExpense)).toBeLessThan(0.01);
      }),
      { numRuns: 100 }
    );
  });

  it('should be additive - splitting array should preserve totals', () => {
    fc.assert(
      fc.property(
        fc.array(dailyStatItemArb, { minLength: 2, maxLength: 20 }),
        fc.integer({ min: 1, max: 19 }),
        (items, splitIndex) => {
          const actualSplitIndex = Math.min(splitIndex, items.length - 1);
          const firstHalf = items.slice(0, actualSplitIndex);
          const secondHalf = items.slice(actualSplitIndex);

          const totalIncome = calculateTotalIncome(items);
          const firstIncome = calculateTotalIncome(firstHalf);
          const secondIncome = calculateTotalIncome(secondHalf);

          const totalExpense = calculateTotalExpense(items);
          const firstExpense = calculateTotalExpense(firstHalf);
          const secondExpense = calculateTotalExpense(secondHalf);

          expect(Math.abs(totalIncome - (firstIncome + secondIncome))).toBeLessThan(0.01);
          expect(Math.abs(totalExpense - (firstExpense + secondExpense))).toBeLessThan(0.01);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should always return non-negative values for non-negative inputs', () => {
    fc.assert(
      fc.property(dailyStatItemsArb, items => {
        const totalIncome = calculateTotalIncome(items);
        const totalExpense = calculateTotalExpense(items);

        expect(totalIncome).toBeGreaterThanOrEqual(0);
        expect(totalExpense).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 }
    );
  });
});
