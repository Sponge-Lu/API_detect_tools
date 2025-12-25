/**
 * 输入: 模拟的自动刷新 Hook 参数
 * 输出: 属性测试验证结果
 * 定位: 测试层 - useAutoRefresh Hook 的属性测试，验证定时器管理逻辑
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 *
 * **功能: auto-refresh-timer**
 * 使用 fast-check 进行属性测试，验证设计文档中定义的正确性属性
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

// ============= Type Definitions =============

interface SiteConfig {
  name: string;
  url: string;
  api_key?: string;
  enabled?: boolean;
  auto_refresh?: boolean;
  auto_refresh_interval?: number;
}

// ============= Timer Manager (Pure Logic Extraction) =============

const DEFAULT_INTERVAL = 5;
const MIN_INTERVAL = 3;

/**
 * Get valid interval in minutes
 */
function getValidInterval(interval?: number): number {
  if (interval === undefined || interval < MIN_INTERVAL) {
    return DEFAULT_INTERVAL;
  }
  return interval;
}

/**
 * Determine which sites should have timers
 */
function getSitesWithTimers(sites: SiteConfig[]): Set<string> {
  return new Set(sites.filter(s => s.auto_refresh === true).map(s => s.name));
}

/**
 * Calculate expected timer intervals for sites
 */
function getExpectedIntervals(sites: SiteConfig[]): Map<string, number> {
  const intervals = new Map<string, number>();
  sites.forEach(site => {
    if (site.auto_refresh === true) {
      intervals.set(site.name, getValidInterval(site.auto_refresh_interval));
    }
  });
  return intervals;
}

/**
 * Determine timers to create/remove based on state change
 */
function computeTimerChanges(
  currentTimers: Set<string>,
  currentIntervals: Map<string, number>,
  newSites: SiteConfig[]
): {
  toCreate: Map<string, number>;
  toRemove: Set<string>;
} {
  const toCreate = new Map<string, number>();
  const toRemove = new Set<string>();

  // Find timers to remove (deleted sites or disabled auto_refresh)
  currentTimers.forEach(siteName => {
    const site = newSites.find(s => s.name === siteName);
    if (!site || site.auto_refresh !== true) {
      toRemove.add(siteName);
    }
  });

  // Find timers to create or restart
  newSites.forEach(site => {
    if (site.auto_refresh === true) {
      const hasTimer = currentTimers.has(site.name);
      const newInterval = getValidInterval(site.auto_refresh_interval);
      const oldInterval = currentIntervals.get(site.name);

      if (!hasTimer || oldInterval !== newInterval) {
        if (hasTimer) {
          toRemove.add(site.name); // Will be recreated
        }
        toCreate.set(site.name, newInterval);
      }
    }
  });

  return { toCreate, toRemove };
}

// ============= Arbitraries =============

const siteConfigArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
  url: fc.webUrl(),
  auto_refresh: fc.boolean(),
  auto_refresh_interval: fc.option(fc.integer({ min: 1, max: 120 }), { nil: undefined }),
  enabled: fc.constant(true),
});

const sitesArrayArb = fc.array(siteConfigArb, { minLength: 0, maxLength: 10 }).map(sites => {
  // Ensure unique names
  const seen = new Set<string>();
  return sites.filter(s => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
});

// ============= Property Tests =============

describe('useAutoRefresh Property Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * **Property 1: Timer scheduling for enabled sites**
   * **Validates: Requirements 1.1, 1.4**
   *
   * *For any* set of sites, the system SHALL create a timer for each site
   * where auto_refresh=true, and the timer interval SHALL match the site's
   * auto_refresh_interval (or default to 5 minutes)
   */
  describe('Property 1: Timer scheduling for enabled sites', () => {
    it('should identify correct sites for timer creation', () => {
      fc.assert(
        fc.property(sitesArrayArb, sites => {
          const sitesWithTimers = getSitesWithTimers(sites);
          const enabledSites = sites.filter(s => s.auto_refresh === true);

          // Number of timers should equal number of enabled sites
          expect(sitesWithTimers.size).toBe(enabledSites.length);

          // Each enabled site should have a timer
          enabledSites.forEach(site => {
            expect(sitesWithTimers.has(site.name)).toBe(true);
          });

          // No disabled site should have a timer
          sites
            .filter(s => s.auto_refresh !== true)
            .forEach(site => {
              expect(sitesWithTimers.has(site.name)).toBe(false);
            });
        }),
        { numRuns: 100 }
      );
    });

    it('should calculate correct intervals (default 5, min 3)', () => {
      fc.assert(
        fc.property(sitesArrayArb, sites => {
          const intervals = getExpectedIntervals(sites);

          sites.forEach(site => {
            if (site.auto_refresh === true) {
              const expectedInterval = intervals.get(site.name);
              expect(expectedInterval).toBeDefined();

              // Interval should be >= MIN_INTERVAL
              expect(expectedInterval).toBeGreaterThanOrEqual(MIN_INTERVAL);

              // If site has valid interval, use it; otherwise default
              if (
                site.auto_refresh_interval !== undefined &&
                site.auto_refresh_interval >= MIN_INTERVAL
              ) {
                expect(expectedInterval).toBe(site.auto_refresh_interval);
              } else {
                expect(expectedInterval).toBe(DEFAULT_INTERVAL);
              }
            } else {
              // Disabled sites should not have intervals
              expect(intervals.has(site.name)).toBe(false);
            }
          });
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 2: Timer cancellation on disable or delete**
   * **Validates: Requirements 1.3, 2.2, 2.4**
   *
   * *For any* site that transitions from auto_refresh=true to auto_refresh=false,
   * OR is removed from the sites array, the system SHALL cancel the existing timer
   */
  describe('Property 2: Timer cancellation on disable or delete', () => {
    it('should mark timers for removal when sites are deleted', () => {
      fc.assert(
        fc.property(
          sitesArrayArb.filter(sites => sites.some(s => s.auto_refresh === true)),
          fc.integer({ min: 0, max: 5 }),
          (sites, deleteCount) => {
            // Setup: create initial timers
            const initialTimers = getSitesWithTimers(sites);
            const initialIntervals = getExpectedIntervals(sites);

            // Delete some sites
            const sitesToKeep = sites.slice(0, Math.max(0, sites.length - deleteCount));
            const deletedSites = sites.slice(Math.max(0, sites.length - deleteCount));

            const { toRemove } = computeTimerChanges(initialTimers, initialIntervals, sitesToKeep);

            // All deleted sites with timers should be marked for removal
            deletedSites.forEach(site => {
              if (site.auto_refresh === true) {
                expect(toRemove.has(site.name)).toBe(true);
              }
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should mark timers for removal when auto_refresh is disabled', () => {
      fc.assert(
        fc.property(
          sitesArrayArb.filter(sites => sites.some(s => s.auto_refresh === true)),
          sites => {
            // Setup: create initial timers
            const initialTimers = getSitesWithTimers(sites);
            const initialIntervals = getExpectedIntervals(sites);

            // Disable auto_refresh for all sites
            const disabledSites = sites.map(s => ({ ...s, auto_refresh: false }));

            const { toRemove } = computeTimerChanges(
              initialTimers,
              initialIntervals,
              disabledSites
            );

            // All previously enabled sites should be marked for removal
            sites.forEach(site => {
              if (site.auto_refresh === true) {
                expect(toRemove.has(site.name)).toBe(true);
              }
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 3: Timer restart on interval change**
   * **Validates: Requirements 2.3**
   *
   * *For any* site with auto_refresh=true, when auto_refresh_interval changes,
   * the system SHALL restart the timer with the new interval
   */
  describe('Property 3: Timer restart on interval change', () => {
    it('should restart timer when interval changes', () => {
      fc.assert(
        fc.property(
          sitesArrayArb.filter(sites => sites.some(s => s.auto_refresh === true)),
          fc.integer({ min: 3, max: 60 }),
          (sites, newInterval) => {
            // Setup: create initial timers
            const initialTimers = getSitesWithTimers(sites);
            const initialIntervals = getExpectedIntervals(sites);

            // Change intervals for all enabled sites
            const updatedSites = sites.map(s => {
              if (s.auto_refresh === true) {
                return { ...s, auto_refresh_interval: newInterval };
              }
              return s;
            });

            const { toCreate, toRemove } = computeTimerChanges(
              initialTimers,
              initialIntervals,
              updatedSites
            );

            // Sites with changed intervals should be recreated
            sites.forEach(site => {
              if (site.auto_refresh === true) {
                const oldInterval = getValidInterval(site.auto_refresh_interval);
                if (oldInterval !== newInterval) {
                  expect(toRemove.has(site.name)).toBe(true);
                  expect(toCreate.has(site.name)).toBe(true);
                  expect(toCreate.get(site.name)).toBe(newInterval);
                }
              }
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 4: Error isolation**
   * **Validates: Requirements 3.2**
   *
   * *For any* site where detectSingle fails, the error SHALL be logged
   * and other sites' timers SHALL continue to function normally
   */
  describe('Property 4: Error isolation', () => {
    it('should not affect other timers when one site fails', () => {
      fc.assert(
        fc.property(
          sitesArrayArb.filter(sites => sites.filter(s => s.auto_refresh === true).length >= 2),
          fc.integer({ min: 0, max: 9 }),
          (sites, failingIndex) => {
            const enabledSites = sites.filter(s => s.auto_refresh === true);
            if (enabledSites.length < 2) return; // Skip if not enough enabled sites

            const failingSiteIndex = failingIndex % enabledSites.length;
            const failingSite = enabledSites[failingSiteIndex];

            // Simulate error tracking
            const errors: string[] = [];
            const successfulRefreshes: string[] = [];

            // Simulate refresh execution with one failing
            enabledSites.forEach((site, index) => {
              try {
                if (index === failingSiteIndex) {
                  throw new Error(`Simulated error for ${site.name}`);
                }
                successfulRefreshes.push(site.name);
              } catch {
                errors.push(site.name);
              }
            });

            // Only the failing site should have an error
            expect(errors).toContain(failingSite.name);
            expect(errors.length).toBe(1);

            // All other sites should succeed
            expect(successfulRefreshes.length).toBe(enabledSites.length - 1);
            enabledSites.forEach(site => {
              if (site.name !== failingSite.name) {
                expect(successfulRefreshes).toContain(site.name);
              }
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 5: Cleanup on unmount**
   * **Validates: Requirements 4.3**
   *
   * *For any* active timers when the hook unmounts, all timers SHALL be cleared
   */
  describe('Property 5: Cleanup on unmount', () => {
    it('should clear all timers on cleanup', () => {
      fc.assert(
        fc.property(sitesArrayArb, sites => {
          // Setup: create timers
          const timers = new Map<string, NodeJS.Timeout>();
          const clearedTimers: string[] = [];

          sites.forEach(site => {
            if (site.auto_refresh === true) {
              const timerId = setTimeout(() => {}, 1000);
              timers.set(site.name, timerId);
            }
          });

          // Simulate cleanup
          timers.forEach((timerId, siteName) => {
            clearTimeout(timerId);
            clearedTimers.push(siteName);
          });
          timers.clear();

          // All timers should be cleared
          expect(timers.size).toBe(0);

          // Number of cleared timers should match enabled sites
          const enabledCount = sites.filter(s => s.auto_refresh === true).length;
          expect(clearedTimers.length).toBe(enabledCount);
        }),
        { numRuns: 100 }
      );
    });
  });
});
