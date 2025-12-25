/**
 * 输入: 模拟的 WebDAV URL 和备份信息
 * 输出: 属性测试验证结果
 * 定位: 测试层 - WebDAV 管理器属性测试，验证 URL 验证和备份信息处理逻辑
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { WebDAVBackupInfo } from '../shared/types/site';

// Pure functions extracted for testing (avoid Electron dependencies)
// These mirror the implementations in webdav-manager.ts

/**
 * 验证 URL 格式是否有效
 */
function validateWebDAVUrl(url: string): { valid: boolean; error?: string } {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL 不能为空' };
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    return { valid: false, error: 'URL 不能为空' };
  }

  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    return { valid: false, error: 'URL 必须以 http:// 或 https:// 开头' };
  }

  try {
    const parsed = new URL(trimmedUrl);
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return { valid: false, error: 'URL 缺少有效的主机名' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'URL 格式无效' };
  }
}

/**
 * 生成备份文件名
 */
function generateBackupFilename(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `config_${year}-${month}-${day}_${hours}-${minutes}-${seconds}.json`;
}

/**
 * 对备份列表按日期降序排序
 */
function sortBackupsByDate(backups: WebDAVBackupInfo[]): WebDAVBackupInfo[] {
  return [...backups].sort((a, b) => {
    const timeA = a.lastModified instanceof Date ? a.lastModified.getTime() : 0;
    const timeB = b.lastModified instanceof Date ? b.lastModified.getTime() : 0;
    return timeB - timeA;
  });
}

describe('WebDAV Manager Property Tests', () => {
  /**
   * **Feature: webdav-backup, Property 1: URL Validation Rejects Invalid Formats**
   * **Validates: Requirements 1.4**
   *
   * For any string that does not conform to a valid HTTP/HTTPS URL format
   * (missing protocol, invalid characters, malformed structure),
   * the URL validation function SHALL reject it and return an error.
   */
  describe('Property 1: URL Validation Rejects Invalid Formats', () => {
    it('should accept valid HTTP/HTTPS URLs', () => {
      fc.assert(
        fc.property(fc.webUrl(), (url: string) => {
          const result = validateWebDAVUrl(url);
          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    it('should reject URLs without http/https protocol', () => {
      // Generate strings that don't start with http:// or https://
      const nonHttpProtocols = fc.oneof(
        fc.constant('ftp://example.com'),
        fc.constant('file:///path'),
        fc.constant('ws://example.com'),
        fc.constant('example.com'),
        fc.constant('www.example.com'),
        fc
          .string()
          .filter(s => !s.startsWith('http://') && !s.startsWith('https://') && s.length > 0)
      );

      fc.assert(
        fc.property(nonHttpProtocols, (url: string) => {
          const result = validateWebDAVUrl(url);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        }),
        { numRuns: 100 }
      );
    });

    it('should reject empty or whitespace-only URLs', () => {
      const emptyOrWhitespace = fc.oneof(
        fc.constant(''),
        fc.constant('   '),
        fc.constant('\t'),
        fc.constant('\n'),
        fc.constant('  \t  '),
        fc.constant('\n\t\n')
      );

      fc.assert(
        fc.property(emptyOrWhitespace, (url: string) => {
          const result = validateWebDAVUrl(url);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Feature: webdav-backup, Property 2: Backup Filename Format Consistency**
   * **Validates: Requirements 2.2**
   *
   * For any Date object, the generated backup filename SHALL match the pattern
   * `config_YYYY-MM-DD_HH-mm-ss.json` where the date components correspond to the input date.
   */
  describe('Property 2: Backup Filename Format Consistency', () => {
    it('should generate filenames matching the expected pattern', () => {
      // Use integer-based date generation to avoid NaN dates
      const validDateArbitrary = fc
        .integer({ min: 946684800000, max: 4102444800000 }) // 2000-01-01 to 2100-01-01
        .map(ts => new Date(ts));

      fc.assert(
        fc.property(validDateArbitrary, (date: Date) => {
          const filename = generateBackupFilename(date);

          // Check pattern: config_YYYY-MM-DD_HH-mm-ss.json
          const pattern = /^config_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/;
          expect(filename).toMatch(pattern);

          // Extract and verify date components
          const match = filename.match(
            /^config_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.json$/
          );
          expect(match).not.toBeNull();

          if (match) {
            const [, year, month, day, hours, minutes, seconds] = match;
            expect(parseInt(year)).toBe(date.getFullYear());
            expect(parseInt(month)).toBe(date.getMonth() + 1);
            expect(parseInt(day)).toBe(date.getDate());
            expect(parseInt(hours)).toBe(date.getHours());
            expect(parseInt(minutes)).toBe(date.getMinutes());
            expect(parseInt(seconds)).toBe(date.getSeconds());
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: webdav-backup, Property 3: Backup List Sorting Order**
   * **Validates: Requirements 3.2**
   *
   * For any list of WebDAV backup files with different timestamps,
   * the sorted result SHALL have backups ordered by date in descending order (newest first).
   */
  describe('Property 3: Backup List Sorting Order', () => {
    it('should sort backups by date in descending order', () => {
      // Generate valid dates only (no NaN dates)
      const validDateArbitrary = fc
        .integer({ min: 946684800000, max: 4102444800000 })
        .map(ts => new Date(ts));

      const backupInfoArbitrary = fc.record({
        filename: fc.string({ minLength: 1 }),
        path: fc.string({ minLength: 1 }),
        lastModified: validDateArbitrary,
        size: fc.nat(),
      });

      fc.assert(
        fc.property(
          fc.array(backupInfoArbitrary, { minLength: 0, maxLength: 50 }),
          (backups: WebDAVBackupInfo[]) => {
            const sorted = sortBackupsByDate(backups);

            // Verify length is preserved
            expect(sorted.length).toBe(backups.length);

            // Verify descending order
            for (let i = 1; i < sorted.length; i++) {
              const prevTime = sorted[i - 1].lastModified.getTime();
              const currTime = sorted[i].lastModified.getTime();
              expect(prevTime).toBeGreaterThanOrEqual(currTime);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: webdav-backup, Property 4: Backup List Contains Required Fields**
   * **Validates: Requirements 3.1**
   *
   * For any backup file returned from the WebDAV server,
   * the backup info object SHALL contain filename, lastModified date, and size fields.
   */
  describe('Property 4: Backup List Contains Required Fields', () => {
    it('should preserve all required fields after sorting', () => {
      // Generate valid dates only (no NaN dates)
      const validDateArbitrary = fc
        .integer({ min: 946684800000, max: 4102444800000 })
        .map(ts => new Date(ts));

      const backupInfoArbitrary = fc.record({
        filename: fc.string({ minLength: 1 }),
        path: fc.string({ minLength: 1 }),
        lastModified: validDateArbitrary,
        size: fc.nat(),
      });

      fc.assert(
        fc.property(
          fc.array(backupInfoArbitrary, { minLength: 1, maxLength: 20 }),
          (backups: WebDAVBackupInfo[]) => {
            const sorted = sortBackupsByDate(backups);

            // Verify all required fields are present in each item
            for (const backup of sorted) {
              expect(backup).toHaveProperty('filename');
              expect(backup).toHaveProperty('path');
              expect(backup).toHaveProperty('lastModified');
              expect(backup).toHaveProperty('size');

              expect(typeof backup.filename).toBe('string');
              expect(typeof backup.path).toBe('string');
              expect(backup.lastModified).toBeInstanceOf(Date);
              expect(typeof backup.size).toBe('number');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

/**
 * Helper function to simulate cleanup logic (mirrors cleanupOldBackups behavior)
 * This is a pure function for testing purposes
 */
function simulateCleanup(
  backups: WebDAVBackupInfo[],
  maxBackups: number
): { remaining: WebDAVBackupInfo[]; deleted: WebDAVBackupInfo[] } {
  const sorted = sortBackupsByDate(backups);

  if (sorted.length <= maxBackups) {
    return { remaining: sorted, deleted: [] };
  }

  const remaining = sorted.slice(0, maxBackups);
  const deleted = sorted.slice(maxBackups);

  return { remaining, deleted };
}

describe('WebDAV Cleanup Property Tests', () => {
  /**
   * **Feature: webdav-backup, Property 8: Cleanup Maintains Backup Limit**
   * **Validates: Requirements 5.1, 5.2**
   *
   * For any backup upload operation where the total backup count exceeds the configured maximum,
   * after cleanup the remaining backup count SHALL equal the configured maximum,
   * and the deleted backups SHALL be the oldest ones.
   */
  describe('Property 8: Cleanup Maintains Backup Limit', () => {
    it('should maintain backup count at or below maxBackups after cleanup', () => {
      const validDateArbitrary = fc
        .integer({ min: 946684800000, max: 4102444800000 })
        .map(ts => new Date(ts));

      const backupInfoArbitrary = fc.record({
        filename: fc.string({ minLength: 1 }),
        path: fc.string({ minLength: 1 }),
        lastModified: validDateArbitrary,
        size: fc.nat(),
      });

      fc.assert(
        fc.property(
          fc.array(backupInfoArbitrary, { minLength: 0, maxLength: 30 }),
          fc.integer({ min: 1, max: 20 }),
          (backups: WebDAVBackupInfo[], maxBackups: number) => {
            const { remaining, deleted } = simulateCleanup(backups, maxBackups);

            // After cleanup, remaining count should be at most maxBackups
            expect(remaining.length).toBeLessThanOrEqual(maxBackups);

            // Total should equal original
            expect(remaining.length + deleted.length).toBe(backups.length);

            // If we had more than maxBackups, we should have exactly maxBackups remaining
            if (backups.length > maxBackups) {
              expect(remaining.length).toBe(maxBackups);
            } else {
              expect(remaining.length).toBe(backups.length);
              expect(deleted.length).toBe(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should delete the oldest backups when exceeding limit', () => {
      const validDateArbitrary = fc
        .integer({ min: 946684800000, max: 4102444800000 })
        .map(ts => new Date(ts));

      const backupInfoArbitrary = fc.record({
        filename: fc.string({ minLength: 1 }),
        path: fc.string({ minLength: 1 }),
        lastModified: validDateArbitrary,
        size: fc.nat(),
      });

      fc.assert(
        fc.property(
          fc.array(backupInfoArbitrary, { minLength: 2, maxLength: 30 }),
          fc.integer({ min: 1, max: 15 }),
          (backups: WebDAVBackupInfo[], maxBackups: number) => {
            const { remaining, deleted } = simulateCleanup(backups, maxBackups);

            if (deleted.length > 0 && remaining.length > 0) {
              // All deleted backups should be older than all remaining backups
              const oldestRemaining = Math.min(...remaining.map(b => b.lastModified.getTime()));
              const newestDeleted = Math.max(...deleted.map(b => b.lastModified.getTime()));

              expect(oldestRemaining).toBeGreaterThanOrEqual(newestDeleted);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
