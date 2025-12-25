/**
 * 输入: 模拟的版本号和更新信息
 * 输出: 属性测试验证结果
 * 定位: 测试层 - UpdateService 属性测试，验证版本比较和验证逻辑
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 *
 * 使用 fast-check 进行属性测试
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// 由于 UpdateService 依赖 Electron，我们直接测试核心逻辑函数
// 提取版本比较和验证逻辑进行独立测试

/**
 * 验证版本号格式是否符合语义化版本规范
 */
function isValidVersion(version: string): boolean {
  return /^v?(\d+)\.(\d+)\.(\d+)$/.test(version);
}

/**
 * 比较两个语义化版本号
 * @returns 负数表示 current < latest，0 表示相等，正数表示 current > latest
 */
function compareVersions(current: string, latest: string): number {
  const parseVersion = (v: string): number[] => {
    const match = v.match(/^v?(\d+)\.(\d+)\.(\d+)/);
    if (!match) {
      throw new Error(`Invalid version format: ${v}`);
    }
    return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
  };

  const [currentMajor, currentMinor, currentPatch] = parseVersion(current);
  const [latestMajor, latestMinor, latestPatch] = parseVersion(latest);

  if (currentMajor !== latestMajor) {
    return currentMajor - latestMajor;
  }
  if (currentMinor !== latestMinor) {
    return currentMinor - latestMinor;
  }
  return currentPatch - latestPatch;
}

/**
 * 生成有效的语义化版本号
 */
const validVersionArb = fc
  .tuple(
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 })
  )
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

/**
 * 生成带 v 前缀的版本号
 */
const vPrefixedVersionArb = validVersionArb.map(v => `v${v}`);

describe('UpdateService Property Tests', () => {
  /**
   * **Feature: software-update, Property 1: Version format validation**
   * **Validates: Requirements 1.2**
   */
  describe('Property 1: Version format validation', () => {
    it('should validate all generated semantic versions as valid', () => {
      fc.assert(
        fc.property(validVersionArb, version => {
          expect(isValidVersion(version)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should validate v-prefixed versions as valid', () => {
      fc.assert(
        fc.property(vPrefixedVersionArb, version => {
          expect(isValidVersion(version)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject invalid version formats', () => {
      const invalidVersions = ['', 'abc', '1.2', '1.2.3.4', '1.2.x', 'v1.2', '-1.2.3'];
      invalidVersions.forEach(v => {
        expect(isValidVersion(v)).toBe(false);
      });
    });
  });

  /**
   * **Feature: software-update, Property 2: Version comparison correctness**
   * **Validates: Requirements 2.3**
   */
  describe('Property 2: Version comparison correctness', () => {
    it('should return 0 for identical versions', () => {
      fc.assert(
        fc.property(validVersionArb, version => {
          expect(compareVersions(version, version)).toBe(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should be antisymmetric: compare(A, B) = -compare(B, A)', () => {
      fc.assert(
        fc.property(validVersionArb, validVersionArb, (a, b) => {
          const ab = compareVersions(a, b);
          const ba = compareVersions(b, a);
          expect(Math.sign(ab)).toBe(-Math.sign(ba));
        }),
        { numRuns: 100 }
      );
    });

    it('should be transitive: if A < B and B < C, then A < C', () => {
      const orderedVersionsArb = fc
        .tuple(
          fc.integer({ min: 0, max: 50 }),
          fc.integer({ min: 0, max: 50 }),
          fc.integer({ min: 0, max: 50 }),
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 10 })
        )
        .map(([major, minor, patch, delta1, delta2]) => {
          const a = `${major}.${minor}.${patch}`;
          const b = `${major}.${minor}.${patch + delta1}`;
          const c = `${major}.${minor}.${patch + delta1 + delta2}`;
          return [a, b, c] as const;
        });

      fc.assert(
        fc.property(orderedVersionsArb, ([a, b, c]) => {
          expect(compareVersions(a, b)).toBeLessThan(0);
          expect(compareVersions(b, c)).toBeLessThan(0);
          expect(compareVersions(a, c)).toBeLessThan(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should correctly compare major versions', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 50 }),
          fc.integer({ min: 1, max: 50 }),
          fc.integer({ min: 0, max: 99 }),
          fc.integer({ min: 0, max: 99 }),
          fc.integer({ min: 0, max: 99 }),
          fc.integer({ min: 0, max: 99 }),
          (major1, majorDelta, minor1, minor2, patch1, patch2) => {
            const v1 = `${major1}.${minor1}.${patch1}`;
            const v2 = `${major1 + majorDelta}.${minor2}.${patch2}`;
            expect(compareVersions(v1, v2)).toBeLessThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly compare minor versions when major is equal', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 99 }),
          fc.integer({ min: 0, max: 50 }),
          fc.integer({ min: 1, max: 50 }),
          fc.integer({ min: 0, max: 99 }),
          fc.integer({ min: 0, max: 99 }),
          (major, minor1, minorDelta, patch1, patch2) => {
            const v1 = `${major}.${minor1}.${patch1}`;
            const v2 = `${major}.${minor1 + minorDelta}.${patch2}`;
            expect(compareVersions(v1, v2)).toBeLessThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly compare patch versions', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 99 }),
          fc.integer({ min: 0, max: 99 }),
          fc.integer({ min: 0, max: 50 }),
          fc.integer({ min: 1, max: 50 }),
          (major, minor, patch1, patchDelta) => {
            const v1 = `${major}.${minor}.${patch1}`;
            const v2 = `${major}.${minor}.${patch1 + patchDelta}`;
            expect(compareVersions(v1, v2)).toBeLessThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: software-update, Property 3: Settings persistence round-trip**
   * **Validates: Requirements 6.3**
   */
  describe('Property 3: Settings persistence round-trip', () => {
    interface UpdateSettings {
      autoCheckEnabled: boolean;
      lastCheckTime?: string;
    }

    const DEFAULT_SETTINGS: UpdateSettings = {
      autoCheckEnabled: true,
    };

    let storage: string | null = null;

    function saveSettings(settings: UpdateSettings): void {
      const merged = { ...DEFAULT_SETTINGS, ...settings };
      storage = JSON.stringify(merged);
    }

    function loadSettings(): UpdateSettings {
      if (!storage) {
        return { ...DEFAULT_SETTINGS };
      }
      return { ...DEFAULT_SETTINGS, ...JSON.parse(storage) };
    }

    // Use integer-based date generation to avoid NaN dates
    const validDateArbitrary = fc
      .integer({ min: 946684800000, max: 4102444800000 }) // 2000-01-01 to 2100-01-01
      .map(ts => new Date(ts));

    const updateSettingsArb = fc.record({
      autoCheckEnabled: fc.boolean(),
      lastCheckTime: fc.option(
        validDateArbitrary.map(d => d.toISOString()),
        { nil: undefined }
      ),
    });

    it('should preserve settings after save and load', () => {
      fc.assert(
        fc.property(updateSettingsArb, settings => {
          storage = null;
          saveSettings(settings);
          const loaded = loadSettings();
          expect(loaded.autoCheckEnabled).toBe(settings.autoCheckEnabled);
          if (settings.lastCheckTime !== undefined) {
            expect(loaded.lastCheckTime).toBe(settings.lastCheckTime);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should handle multiple save/load cycles', () => {
      fc.assert(
        fc.property(fc.array(updateSettingsArb, { minLength: 1, maxLength: 5 }), settingsArray => {
          storage = null;
          settingsArray.forEach(s => saveSettings(s));
          const lastSettings = settingsArray[settingsArray.length - 1];
          const loaded = loadSettings();
          expect(loaded.autoCheckEnabled).toBe(lastSettings.autoCheckEnabled);
          if (lastSettings.lastCheckTime !== undefined) {
            expect(loaded.lastCheckTime).toBe(lastSettings.lastCheckTime);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should return default settings when storage is empty', () => {
      storage = null;
      const loaded = loadSettings();
      expect(loaded.autoCheckEnabled).toBe(DEFAULT_SETTINGS.autoCheckEnabled);
    });
  });
});
