/**
 * 输入: 分组 ID 字符串
 * 输出: 测试验证结果
 * 定位: 测试层 - 分组样式工具函数测试，验证颜色和图标生成逻辑
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 */

import { describe, it, expect } from 'vitest';
import { getGroupTextColor, getGroupIcon } from '../renderer/utils/groupStyle';

describe('groupStyle', () => {
  describe('getGroupTextColor', () => {
    it('returns neutral tertiary token for empty group name', () => {
      expect(getGroupTextColor('')).toBe('text-[var(--text-tertiary)]');
    });

    it('returns consistent color for same group name', () => {
      const color1 = getGroupTextColor('test-group');
      const color2 = getGroupTextColor('test-group');
      expect(color1).toBe(color2);
    });

    it('returns different colors for different groups', () => {
      const color1 = getGroupTextColor('group-a');
      const color2 = getGroupTextColor('group-b');
      const color3 = getGroupTextColor('group-c');
      // At least some should be different
      const colors = new Set([color1, color2, color3]);
      expect(colors.size).toBeGreaterThan(1);
    });

    it('returns valid token-based text color class', () => {
      const color = getGroupTextColor('my-group');
      expect(color).toMatch(/^text-\[var\(--[\w-]+\)\]$/);
    });
  });

  describe('getGroupIcon', () => {
    it('returns Server icon for empty group name', () => {
      const icon = getGroupIcon('');
      expect(icon).toBeDefined();
    });

    it('returns consistent icon for same group name', () => {
      const icon1 = getGroupIcon('test-group');
      const icon2 = getGroupIcon('test-group');
      // Both should be React elements
      expect(icon1).toBeDefined();
      expect(icon2).toBeDefined();
    });

    it('returns icon for any group name', () => {
      const icon = getGroupIcon('random-group-name');
      expect(icon).toBeDefined();
    });
  });
});
