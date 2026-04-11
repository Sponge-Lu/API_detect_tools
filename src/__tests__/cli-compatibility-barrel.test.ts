import { describe, expect, it } from 'vitest';
import { getIconStyleClass, isCliEnabled } from '../renderer/components/CliCompatibilityIcons';

describe('CliCompatibilityIcons barrel exports', () => {
  it('re-exports the compatibility icon style helper', () => {
    expect(getIconStyleClass({ enabled: true, configured: true, status: true })).toBe(
      'opacity-100'
    );
  });

  it('continues to re-export isCliEnabled', () => {
    expect(typeof isCliEnabled).toBe('function');
  });
});
