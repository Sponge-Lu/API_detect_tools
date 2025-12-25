/**
 * 输入: 模拟的自动刷新配置参数
 * 输出: 属性测试验证结果
 * 定位: 测试层 - 自动刷新配置的属性测试，验证配置验证和持久化逻辑
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 *
 * **功能: auto-refresh-in-editor**
 * 使用 fast-check 进行属性测试，验证设计文档中定义的正确性属性
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Type definitions matching the application's SiteConfig
 */
interface SiteConfig {
  name: string;
  url: string;
  api_key?: string;
  system_token?: string;
  user_id?: string;
  enabled?: boolean;
  auto_refresh?: boolean;
  auto_refresh_interval?: number;
  group?: string;
  extra_links?: string;
  force_enable_checkin?: boolean;
  has_checkin?: boolean;
}

/**
 * Simulates the SiteEditor's handleSave logic for auto-refresh configuration
 * This is the core logic we're testing for Property 1
 */
function buildSiteConfigOnSave(
  autoRefresh: boolean,
  autoRefreshInterval: number,
  baseSite: Partial<SiteConfig> = {}
): SiteConfig {
  return {
    name: baseSite.name || 'Test Site',
    url: baseSite.url || 'https://example.com',
    api_key: baseSite.api_key || '',
    system_token: baseSite.system_token || 'token',
    user_id: baseSite.user_id || '123',
    enabled: true,
    auto_refresh: autoRefresh,
    // Interval is always persisted (min 3) to preserve user preference for next enable
    auto_refresh_interval: Math.max(3, autoRefreshInterval),
    group: baseSite.group || 'default',
  };
}

/**
 * Simulates the toggle auto-refresh logic from App.tsx
 * This is the core logic we're testing for Property 2
 */
function toggleAutoRefresh(site: SiteConfig): SiteConfig {
  // Get current interval or use default 5 minutes
  const interval = site.auto_refresh_interval || 5;
  if (site.auto_refresh) {
    // Disable auto-refresh, but preserve interval
    return {
      ...site,
      auto_refresh: false,
      auto_refresh_interval: interval,
    };
  } else {
    // Enable auto-refresh: use existing interval or default to 5
    return {
      ...site,
      auto_refresh: true,
      auto_refresh_interval: interval,
    };
  }
}

describe('Auto-Refresh Configuration Property Tests', () => {
  /**
   * **Property 1: Auto-refresh configuration persistence**
   * **Validates: Requirements 1.3, 1.4**
   *
   * *For any* site configuration saved with auto-refresh enabled,
   * the persisted configuration SHALL contain auto_refresh=true
   * AND a valid auto_refresh_interval >= 3
   */
  describe('Property 1: Auto-refresh configuration persistence', () => {
    it('should persist auto_refresh=true with interval >= 3 when enabled', () => {
      fc.assert(
        fc.property(
          // Generate random interval values (including edge cases)
          fc.integer({ min: -100, max: 1000 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 100 }),
          (interval, siteName, siteUrl) => {
            const result = buildSiteConfigOnSave(true, interval, {
              name: siteName,
              url: `https://${siteUrl}.com`,
            });

            // When auto_refresh is true, interval must be >= 3
            expect(result.auto_refresh).toBe(true);
            expect(result.auto_refresh_interval).toBeGreaterThanOrEqual(3);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should persist auto_refresh_interval even when auto_refresh is disabled', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (interval, siteName) => {
            const result = buildSiteConfigOnSave(false, interval, { name: siteName });

            // When auto_refresh is false, interval should still be persisted (>= 3)
            // This allows restoring the user's preference when re-enabling
            expect(result.auto_refresh).toBe(false);
            expect(result.auto_refresh_interval).toBeGreaterThanOrEqual(3);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 2: Toggle behavior consistency**
   * **Validates: Requirements 2.1, 2.2**
   *
   * *For any* site, clicking the auto-refresh toggle SHALL invert
   * the auto_refresh state, and when enabling, SHALL use the
   * existing interval or default to 5 minutes
   */
  describe('Property 2: Toggle behavior consistency', () => {
    // Arbitrary for generating valid SiteConfig
    const siteConfigArb = fc.record({
      name: fc.string({ minLength: 1, maxLength: 50 }),
      url: fc.string({ minLength: 1, maxLength: 100 }).map(s => `https://${s}.com`),
      auto_refresh: fc.boolean(),
      auto_refresh_interval: fc.option(fc.integer({ min: 3, max: 60 }), { nil: undefined }),
      enabled: fc.constant(true),
      system_token: fc.string({ minLength: 1, maxLength: 100 }),
      user_id: fc.string({ minLength: 1, maxLength: 20 }),
    });

    it('should invert auto_refresh state on toggle', () => {
      fc.assert(
        fc.property(siteConfigArb, site => {
          const originalState = site.auto_refresh;
          const result = toggleAutoRefresh(site);

          // State should be inverted
          expect(result.auto_refresh).toBe(!originalState);
        }),
        { numRuns: 100 }
      );
    });

    it('should use existing interval or default to 5 when enabling', () => {
      fc.assert(
        fc.property(
          siteConfigArb.filter(s => !s.auto_refresh), // Only test sites with auto_refresh=false
          site => {
            const result = toggleAutoRefresh(site);

            expect(result.auto_refresh).toBe(true);

            if (site.auto_refresh_interval !== undefined) {
              // Should use existing interval
              expect(result.auto_refresh_interval).toBe(site.auto_refresh_interval);
            } else {
              // Should default to 5
              expect(result.auto_refresh_interval).toBe(5);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve other site properties on toggle', () => {
      fc.assert(
        fc.property(siteConfigArb, site => {
          const result = toggleAutoRefresh(site);

          // All other properties should remain unchanged
          expect(result.name).toBe(site.name);
          expect(result.url).toBe(site.url);
          expect(result.enabled).toBe(site.enabled);
          expect(result.system_token).toBe(site.system_token);
          expect(result.user_id).toBe(site.user_id);
        }),
        { numRuns: 100 }
      );
    });
  });
});
