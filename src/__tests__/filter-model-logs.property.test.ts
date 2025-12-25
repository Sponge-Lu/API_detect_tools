/**
 * 输入: 模拟的日志过滤参数
 * 输出: 属性测试验证结果
 * 定位: 测试层 - 日志过滤功能的属性测试，验证模型日志过滤和聚合逻辑
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 *
 * **功能: filter-model-logs**
 * 使用 fast-check 进行属性测试，验证设计文档中定义的正确性属性
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  isModelLog,
  aggregateUsageData,
  filterAndAggregateUsageData,
  type LogItem,
} from '../shared/utils/log-filter';

/**
 * **Feature: filter-model-logs, Property 1: Filter validity - only model logs pass through**
 * **Validates: Requirements 1.1, 1.2, 3.1, 3.2, 3.3, 3.4**
 *
 * *For any* set of log entries, after filtering with `isModelLog`,
 * all remaining entries SHALL have a valid (non-empty, non-whitespace) model_name field.
 */
describe('Filter Model Logs Property Tests', () => {
  describe('Property 1: Filter validity - only model logs pass through', () => {
    // Generator for valid model names (non-empty, non-whitespace)
    const validModelNameArb = fc
      .string({ minLength: 1, maxLength: 50 })
      .filter(s => s.trim().length > 0);

    // Generator for invalid model names (empty, whitespace-only, null, undefined)
    const invalidModelNameArb = fc.oneof(
      fc.constant(undefined as string | undefined),
      fc.constant(''),
      // Whitespace-only strings
      fc
        .array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 10 })
        .map(arr => arr.join(''))
    );

    // Generator for LogItem with valid model_name
    const validLogItemArb: fc.Arbitrary<LogItem> = fc.record({
      quota: fc.option(fc.integer({ min: 0, max: 1000000 }), { nil: undefined }),
      prompt_tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
      completion_tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
      model_name: validModelNameArb,
    });

    // Generator for LogItem with invalid model_name
    const invalidLogItemArb: fc.Arbitrary<LogItem> = fc.record({
      quota: fc.option(fc.integer({ min: 0, max: 1000000 }), { nil: undefined }),
      prompt_tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
      completion_tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
      model_name: invalidModelNameArb,
    });

    // Generator for mixed log items array
    const mixedLogItemsArb: fc.Arbitrary<LogItem[]> = fc.array(
      fc.oneof(validLogItemArb, invalidLogItemArb),
      { minLength: 0, maxLength: 50 }
    );

    it('should return true only for entries with valid non-empty model_name', () => {
      fc.assert(
        fc.property(validLogItemArb, (item: LogItem) => {
          expect(isModelLog(item)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should return false for entries with invalid model_name (null, undefined, empty, whitespace)', () => {
      fc.assert(
        fc.property(invalidLogItemArb, (item: LogItem) => {
          expect(isModelLog(item)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('should filter array such that all remaining entries have valid model_name', () => {
      fc.assert(
        fc.property(mixedLogItemsArb, (items: LogItem[]) => {
          const filtered = items.filter(isModelLog);

          // All filtered items should have valid model_name
          for (const item of filtered) {
            expect(item.model_name).toBeDefined();
            expect(typeof item.model_name).toBe('string');
            expect(item.model_name!.trim()).not.toBe('');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should handle edge case: model_name with only whitespace characters', () => {
      fc.assert(
        fc.property(
          fc
            .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f'), { minLength: 1, maxLength: 20 })
            .map(arr => arr.join('')),
          (whitespaceStr: string) => {
            const item: LogItem = { model_name: whitespaceStr };
            expect(isModelLog(item)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle edge case: model_name with mixed content (valid)', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc
              .array(fc.constantFrom(' ', '\t'), { minLength: 0, maxLength: 5 })
              .map(arr => arr.join('')),
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
            fc
              .array(fc.constantFrom(' ', '\t'), { minLength: 0, maxLength: 5 })
              .map(arr => arr.join(''))
          ),
          ([prefix, content, suffix]) => {
            const item: LogItem = { model_name: prefix + content + suffix };
            expect(isModelLog(item)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: filter-model-logs, Property 2: Aggregation correctness - statistics match filtered logs**
   * **Validates: Requirements 1.3, 1.4**
   *
   * *For any* set of log entries containing both model and non-model logs,
   * the aggregated statistics (quota, prompt_tokens, completion_tokens, request count)
   * SHALL equal the sum of only those entries that pass the `isModelLog` filter.
   */
  describe('Property 2: Aggregation correctness - statistics match filtered logs', () => {
    // Generator for valid model names (non-empty, non-whitespace)
    const validModelNameArb = fc
      .string({ minLength: 1, maxLength: 50 })
      .filter(s => s.trim().length > 0);

    // Generator for invalid model names (empty, whitespace-only, null, undefined)
    const invalidModelNameArb = fc.oneof(
      fc.constant(undefined as string | undefined),
      fc.constant(''),
      fc
        .array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 10 })
        .map(arr => arr.join(''))
    );

    // Generator for LogItem with valid model_name
    const validLogItemArb: fc.Arbitrary<LogItem> = fc.record({
      quota: fc.option(fc.integer({ min: 0, max: 1000000 }), { nil: undefined }),
      prompt_tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
      completion_tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
      model_name: validModelNameArb,
    });

    // Generator for LogItem with invalid model_name
    const invalidLogItemArb: fc.Arbitrary<LogItem> = fc.record({
      quota: fc.option(fc.integer({ min: 0, max: 1000000 }), { nil: undefined }),
      prompt_tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
      completion_tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
      model_name: invalidModelNameArb,
    });

    // Generator for mixed log items array
    const mixedLogItemsArb: fc.Arbitrary<LogItem[]> = fc.array(
      fc.oneof(validLogItemArb, invalidLogItemArb),
      { minLength: 0, maxLength: 50 }
    );

    it('should aggregate statistics only from model logs', () => {
      fc.assert(
        fc.property(mixedLogItemsArb, (items: LogItem[]) => {
          // Filter to get only model logs
          const modelLogs = items.filter(isModelLog);

          // Calculate expected values manually
          let expectedQuota = 0;
          let expectedPromptTokens = 0;
          let expectedCompletionTokens = 0;
          for (const item of modelLogs) {
            expectedQuota += item.quota || 0;
            expectedPromptTokens += item.prompt_tokens || 0;
            expectedCompletionTokens += item.completion_tokens || 0;
          }
          const expectedRequestCount = modelLogs.length;

          // Use filterAndAggregateUsageData to get actual values
          const actual = filterAndAggregateUsageData(items);

          // Verify all statistics match
          expect(actual.quota).toBe(expectedQuota);
          expect(actual.promptTokens).toBe(expectedPromptTokens);
          expect(actual.completionTokens).toBe(expectedCompletionTokens);
          expect(actual.requestCount).toBe(expectedRequestCount);
        }),
        { numRuns: 100 }
      );
    });

    it('should exclude non-model logs from aggregation', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.array(validLogItemArb, { minLength: 1, maxLength: 20 }),
            fc.array(invalidLogItemArb, { minLength: 1, maxLength: 20 })
          ),
          ([validItems, invalidItems]) => {
            // Mix valid and invalid items
            const allItems = [...validItems, ...invalidItems];

            // Calculate expected values from valid items only
            let expectedQuota = 0;
            let expectedPromptTokens = 0;
            let expectedCompletionTokens = 0;
            for (const item of validItems) {
              expectedQuota += item.quota || 0;
              expectedPromptTokens += item.prompt_tokens || 0;
              expectedCompletionTokens += item.completion_tokens || 0;
            }

            // Use filterAndAggregateUsageData
            const actual = filterAndAggregateUsageData(allItems);

            // Verify statistics match valid items only
            expect(actual.quota).toBe(expectedQuota);
            expect(actual.promptTokens).toBe(expectedPromptTokens);
            expect(actual.completionTokens).toBe(expectedCompletionTokens);
            expect(actual.requestCount).toBe(validItems.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return zero statistics for empty array', () => {
      const result = filterAndAggregateUsageData([]);
      expect(result.quota).toBe(0);
      expect(result.promptTokens).toBe(0);
      expect(result.completionTokens).toBe(0);
      expect(result.requestCount).toBe(0);
    });

    it('should return zero statistics when all logs are non-model logs', () => {
      fc.assert(
        fc.property(
          fc.array(invalidLogItemArb, { minLength: 1, maxLength: 20 }),
          (invalidItems: LogItem[]) => {
            const result = filterAndAggregateUsageData(invalidItems);
            expect(result.quota).toBe(0);
            expect(result.promptTokens).toBe(0);
            expect(result.completionTokens).toBe(0);
            expect(result.requestCount).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: filter-model-logs, Property 3: Data integrity - filtered entries are unchanged**
   * **Validates: Requirements 2.3**
   *
   * *For any* log entry that passes the `isModelLog` filter,
   * its quota, prompt_tokens, and completion_tokens values SHALL remain unchanged from the original entry.
   */
  describe('Property 3: Data integrity - filtered entries are unchanged', () => {
    // Generator for valid model names (non-empty, non-whitespace)
    const validModelNameArb = fc
      .string({ minLength: 1, maxLength: 50 })
      .filter(s => s.trim().length > 0);

    // Generator for LogItem with valid model_name and specific values
    const validLogItemArb: fc.Arbitrary<LogItem> = fc.record({
      quota: fc.option(fc.integer({ min: 0, max: 1000000 }), { nil: undefined }),
      prompt_tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
      completion_tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
      model_name: validModelNameArb,
    });

    it('should preserve original values when filtering', () => {
      fc.assert(
        fc.property(
          fc.array(validLogItemArb, { minLength: 1, maxLength: 50 }),
          (items: LogItem[]) => {
            // Create deep copies of original items
            const originalItems = items.map(item => ({ ...item }));

            // Filter items
            const filtered = items.filter(isModelLog);

            // Verify each filtered item matches its original
            for (let i = 0; i < filtered.length; i++) {
              const filteredItem = filtered[i];
              const originalItem = originalItems.find(
                orig =>
                  orig.model_name === filteredItem.model_name &&
                  orig.quota === filteredItem.quota &&
                  orig.prompt_tokens === filteredItem.prompt_tokens &&
                  orig.completion_tokens === filteredItem.completion_tokens
              );
              expect(originalItem).toBeDefined();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not modify original array during filtering', () => {
      fc.assert(
        fc.property(
          fc.array(validLogItemArb, { minLength: 1, maxLength: 50 }),
          (items: LogItem[]) => {
            // Create deep copies of original items
            const originalItems = items.map(item => ({ ...item }));
            const originalLength = items.length;

            // Perform filtering
            items.filter(isModelLog);

            // Verify original array is unchanged
            expect(items.length).toBe(originalLength);
            for (let i = 0; i < items.length; i++) {
              expect(items[i].quota).toBe(originalItems[i].quota);
              expect(items[i].prompt_tokens).toBe(originalItems[i].prompt_tokens);
              expect(items[i].completion_tokens).toBe(originalItems[i].completion_tokens);
              expect(items[i].model_name).toBe(originalItems[i].model_name);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve exact numeric values in aggregation', () => {
      fc.assert(
        fc.property(
          fc.array(validLogItemArb, { minLength: 1, maxLength: 50 }),
          (items: LogItem[]) => {
            // Calculate expected sum manually
            let expectedQuota = 0;
            let expectedPromptTokens = 0;
            let expectedCompletionTokens = 0;
            for (const item of items) {
              expectedQuota += item.quota || 0;
              expectedPromptTokens += item.prompt_tokens || 0;
              expectedCompletionTokens += item.completion_tokens || 0;
            }

            // Use aggregateUsageData directly (all items are valid model logs)
            const result = aggregateUsageData(items);

            // Verify exact values
            expect(result.quota).toBe(expectedQuota);
            expect(result.promptTokens).toBe(expectedPromptTokens);
            expect(result.completionTokens).toBe(expectedCompletionTokens);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
