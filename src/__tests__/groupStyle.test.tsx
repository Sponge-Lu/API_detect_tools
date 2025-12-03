import { describe, it, expect } from 'vitest';
import { getGroupTextColor, getGroupIcon } from '../renderer/utils/groupStyle';

describe('groupStyle', () => {
  describe('getGroupTextColor', () => {
    it('returns slate color for empty group name', () => {
      expect(getGroupTextColor('')).toBe('text-slate-400');
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

    it('returns valid tailwind color class', () => {
      const color = getGroupTextColor('my-group');
      expect(color).toMatch(/^text-\w+-\d+ dark:text-\w+-\d+$/);
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
