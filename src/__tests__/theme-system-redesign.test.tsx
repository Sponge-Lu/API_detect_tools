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
  it.each(['light', 'system'])('migrates legacy %s values to light-a', legacyTheme => {
    localStorage.setItem('app-theme-mode', legacyTheme);
    render(<ThemeHarness />);

    expect(document.documentElement.dataset.theme).toBe('light-a');
    expect(localStorage.getItem('app-theme-mode')).toBe('light-a');
  });
});
