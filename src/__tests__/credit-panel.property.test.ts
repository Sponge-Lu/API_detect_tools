/**
 * 输入: 差值数值、日期字符串、交易状态、交易金额
 * 输出: 属性测试验证结果
 * 定位: 测试层 - CreditPanel 组件的属性测试，验证差值颜色编码、日期格式化、交易状态徽章、交易金额格式化功能
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 *
 * **功能: linux-do-credit**
 * **Property 6: Difference Color Coding** - Validates: Requirements 3.3
 * **Property 15: Daily Stats Date Format** - Validates: Requirements 9.9
 * **Property 16: Transaction Status Badge Mapping** - Validates: Requirements 10.5
 * **Property 17: Transaction Amount Display Format** - Validates: Requirements 10.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { getDifferenceColorClass } from '../renderer/components/CreditPanel';
import {
  getDifferenceColorType,
  formatDateToMMDD,
  getTransactionStatusText,
  getTransactionStatusColor,
  formatTransactionAmount,
} from '../shared/types/credit';

// ============= Arbitraries =============

/**
 * Generate a valid difference value
 */
const differenceArb = fc.integer({ min: -10000000, max: 10000000 });

/**
 * Generate a positive difference value
 */
const positiveDiffArb = fc.integer({ min: 1, max: 10000000 });

/**
 * Generate a negative difference value
 */
const negativeDiffArb = fc.integer({ min: -10000000, max: -1 });

// ============= Property Tests =============

/**
 * **Property 6: Difference Color Coding**
 * **Validates: Requirements 3.3**
 *
 * *For any* difference value, the CreditPanel SHALL apply the correct CSS class:
 * - 'positive' (green) for diff > 0
 * - 'negative' (red) for diff < 0
 * - 'neutral' (gray) for diff === 0
 */
describe('Property 6: Difference Color Coding (CreditPanel)', () => {
  it('should return green color class for positive differences', () => {
    fc.assert(
      fc.property(positiveDiffArb, positiveDiff => {
        const result = getDifferenceColorClass(positiveDiff);
        expect(result).toContain('green');
        expect(result).not.toContain('red');
        expect(result).not.toContain('gray');
      }),
      { numRuns: 100 }
    );
  });

  it('should return red color class for negative differences', () => {
    fc.assert(
      fc.property(negativeDiffArb, negativeDiff => {
        const result = getDifferenceColorClass(negativeDiff);
        expect(result).toContain('red');
        expect(result).not.toContain('green');
        expect(result).not.toContain('gray');
      }),
      { numRuns: 100 }
    );
  });

  it('should return gray color class for zero difference', () => {
    const result = getDifferenceColorClass(0);
    expect(result).toContain('gray');
    expect(result).not.toContain('green');
    expect(result).not.toContain('red');
  });

  it('should always return a non-empty string', () => {
    fc.assert(
      fc.property(differenceArb, diff => {
        const result = getDifferenceColorClass(diff);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should be consistent with getDifferenceColorType', () => {
    fc.assert(
      fc.property(differenceArb, diff => {
        const colorType = getDifferenceColorType(diff);
        const colorClass = getDifferenceColorClass(diff);

        switch (colorType) {
          case 'positive':
            expect(colorClass).toContain('green');
            break;
          case 'negative':
            expect(colorClass).toContain('red');
            break;
          case 'neutral':
            expect(colorClass).toContain('gray');
            break;
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should include both light and dark mode classes', () => {
    fc.assert(
      fc.property(differenceArb, diff => {
        const result = getDifferenceColorClass(diff);
        // Should have both light mode (text-*-600) and dark mode (dark:text-*-400) classes
        expect(result).toMatch(/text-\w+-\d+/);
        expect(result).toMatch(/dark:text-\w+-\d+/);
      }),
      { numRuns: 100 }
    );
  });

  it('should return deterministic results for same input', () => {
    fc.assert(
      fc.property(differenceArb, diff => {
        const result1 = getDifferenceColorClass(diff);
        const result2 = getDifferenceColorClass(diff);
        expect(result1).toBe(result2);
      }),
      { numRuns: 100 }
    );
  });
});

// ============= Date Format Arbitraries =============

/**
 * Generate a valid date string in YYYY-MM-DD format
 */
const dateStringArb = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }), // year
    fc.integer({ min: 1, max: 12 }), // month
    fc.integer({ min: 1, max: 28 }) // day (use 28 to avoid invalid dates)
  )
  .map(([year, month, day]) => {
    const monthStr = month.toString().padStart(2, '0');
    const dayStr = day.toString().padStart(2, '0');
    return `${year}-${monthStr}-${dayStr}`;
  });

// ============= Property 15: Daily Stats Date Format =============

/**
 * **Property 15: Daily Stats Date Format**
 * **Validates: Requirements 9.9**
 *
 * *For any* DailyStatItem, the displayed date SHALL be formatted as "MM/DD"
 * (e.g., "12/30" for "2025-12-30").
 */
describe('Property 15: Daily Stats Date Format', () => {
  it('should format date as MM/DD for any valid YYYY-MM-DD input', () => {
    fc.assert(
      fc.property(dateStringArb, dateStr => {
        const result = formatDateToMMDD(dateStr);
        // Result should be in MM/DD format
        expect(result).toMatch(/^\d{2}\/\d{2}$/);
      }),
      { numRuns: 100 }
    );
  });

  it('should extract correct month and day from date string', () => {
    fc.assert(
      fc.property(dateStringArb, dateStr => {
        const result = formatDateToMMDD(dateStr);
        const [year, month, day] = dateStr.split('-');
        const [resultMonth, resultDay] = result.split('/');

        expect(resultMonth).toBe(month);
        expect(resultDay).toBe(day);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve leading zeros in month and day', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2020, max: 2030 }),
        fc.integer({ min: 1, max: 9 }), // single digit month
        fc.integer({ min: 1, max: 9 }), // single digit day
        (year, month, day) => {
          const monthStr = month.toString().padStart(2, '0');
          const dayStr = day.toString().padStart(2, '0');
          const dateStr = `${year}-${monthStr}-${dayStr}`;

          const result = formatDateToMMDD(dateStr);

          // Should preserve leading zeros
          expect(result).toBe(`${monthStr}/${dayStr}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return original string for invalid date format', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.match(/^\d{4}-\d{2}-\d{2}$/)),
        invalidDate => {
          const result = formatDateToMMDD(invalidDate);
          // For invalid format, should return original string
          expect(result).toBe(invalidDate);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return deterministic results for same input', () => {
    fc.assert(
      fc.property(dateStringArb, dateStr => {
        const result1 = formatDateToMMDD(dateStr);
        const result2 = formatDateToMMDD(dateStr);
        expect(result1).toBe(result2);
      }),
      { numRuns: 100 }
    );
  });
});

// ============= Transaction Status Arbitraries =============

/**
 * Generate a valid transaction status
 */
const transactionStatusArb = fc.constantFrom('success', 'failed', 'pending') as fc.Arbitrary<
  'success' | 'failed' | 'pending'
>;

// ============= Property 16: Transaction Status Badge Mapping =============

/**
 * **Property 16: Transaction Status Badge Mapping**
 * **Validates: Requirements 10.5**
 *
 * *For any* transaction status value, the displayed badge SHALL show:
 * - "成功" (green) for "success"
 * - "失败" (red) for "failed"
 * - "待处理" (yellow) for "pending"
 */
describe('Property 16: Transaction Status Badge Mapping', () => {
  it('should return correct text for each status', () => {
    fc.assert(
      fc.property(transactionStatusArb, status => {
        const text = getTransactionStatusText(status);

        switch (status) {
          case 'success':
            expect(text).toBe('成功');
            break;
          case 'failed':
            expect(text).toBe('失败');
            break;
          case 'pending':
            expect(text).toBe('待处理');
            break;
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should return correct color type for each status', () => {
    fc.assert(
      fc.property(transactionStatusArb, status => {
        const colorType = getTransactionStatusColor(status);

        switch (status) {
          case 'success':
            expect(colorType).toBe('success');
            break;
          case 'failed':
            expect(colorType).toBe('error');
            break;
          case 'pending':
            expect(colorType).toBe('warning');
            break;
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should return deterministic results for same input', () => {
    fc.assert(
      fc.property(transactionStatusArb, status => {
        const text1 = getTransactionStatusText(status);
        const text2 = getTransactionStatusText(status);
        const color1 = getTransactionStatusColor(status);
        const color2 = getTransactionStatusColor(status);

        expect(text1).toBe(text2);
        expect(color1).toBe(color2);
      }),
      { numRuns: 100 }
    );
  });

  it('should always return non-empty text', () => {
    fc.assert(
      fc.property(transactionStatusArb, status => {
        const text = getTransactionStatusText(status);
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});

// ============= Transaction Amount Arbitraries =============

/**
 * Generate a valid transaction amount string
 */
const transactionAmountArb = fc.oneof(
  // Integer amounts
  fc.integer({ min: 0, max: 10000 }).map(n => n.toString()),
  // Decimal amounts
  fc
    .tuple(fc.integer({ min: 0, max: 10000 }), fc.integer({ min: 0, max: 99 }))
    .map(([whole, decimal]) => `${whole}.${decimal.toString().padStart(2, '0')}`),
  // Single decimal amounts
  fc
    .tuple(fc.integer({ min: 0, max: 10000 }), fc.integer({ min: 0, max: 9 }))
    .map(([whole, decimal]) => `${whole}.${decimal}`)
);

// ============= Property 17: Transaction Amount Display Format =============

/**
 * **Property 17: Transaction Amount Display Format**
 * **Validates: Requirements 10.4**
 *
 * *For any* transaction amount, the displayed value SHALL be prefixed with "LDC "
 * (e.g., "LDC 0.1" for amount "0.1").
 */
describe('Property 17: Transaction Amount Display Format', () => {
  it('should prefix amount with "LDC " for any valid amount', () => {
    fc.assert(
      fc.property(transactionAmountArb, amount => {
        const result = formatTransactionAmount(amount);
        expect(result).toBe(`LDC ${amount}`);
      }),
      { numRuns: 100 }
    );
  });

  it('should always start with "LDC "', () => {
    fc.assert(
      fc.property(transactionAmountArb, amount => {
        const result = formatTransactionAmount(amount);
        expect(result.startsWith('LDC ')).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve the original amount value after prefix', () => {
    fc.assert(
      fc.property(transactionAmountArb, amount => {
        const result = formatTransactionAmount(amount);
        const extractedAmount = result.replace('LDC ', '');
        expect(extractedAmount).toBe(amount);
      }),
      { numRuns: 100 }
    );
  });

  it('should return deterministic results for same input', () => {
    fc.assert(
      fc.property(transactionAmountArb, amount => {
        const result1 = formatTransactionAmount(amount);
        const result2 = formatTransactionAmount(amount);
        expect(result1).toBe(result2);
      }),
      { numRuns: 100 }
    );
  });

  it('should always return non-empty string', () => {
    fc.assert(
      fc.property(transactionAmountArb, amount => {
        const result = formatTransactionAmount(amount);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});
