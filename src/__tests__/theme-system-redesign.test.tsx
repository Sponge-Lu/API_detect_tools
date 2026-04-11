import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useTheme } from '../renderer/hooks/useTheme';

function ThemeHarness() {
  useTheme();
  return null;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.classList.remove('dark');
});

describe('theme system redesign', () => {
  it.each(['light', 'system', 'light-a', 'light-c'])(
    'migrates legacy %s values to light-b',
    legacyTheme => {
      localStorage.setItem('app-theme-mode', legacyTheme);
      render(<ThemeHarness />);

      expect(document.documentElement.dataset.theme).toBe('light-b');
      expect(localStorage.getItem('app-theme-mode')).toBe('light-b');
    }
  );

  it('keeps dark as the only non-light fallback branch', () => {
    localStorage.setItem('app-theme-mode', 'dark');
    render(<ThemeHarness />);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
