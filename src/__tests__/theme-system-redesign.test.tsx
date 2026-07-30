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

  it('keeps dark as a non-light branch', () => {
    localStorage.setItem('app-theme-mode', 'dark');
    render(<ThemeHarness />);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies modern and modern-dark theme modes with correct dark class', () => {
    localStorage.setItem('app-theme-mode', 'modern');
    const { unmount } = render(<ThemeHarness />);
    expect(document.documentElement.dataset.theme).toBe('modern');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    unmount();

    localStorage.setItem('app-theme-mode', 'modern-dark');
    render(<ThemeHarness />);
    expect(document.documentElement.dataset.theme).toBe('modern-dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('exposes independent platinum accents for modern themes', async () => {
    const { getThemePreset } = await import('../shared/theme/themePresets');
    const modern = getThemePreset('modern');
    const modernDark = getThemePreset('modern-dark');

    expect(modern.accentColor).toBe('#6B7280');
    expect(modernDark.accentColor).toBe('#E5E7EB');
    expect(modern.description).toBe('铂金白 · 简洁浅色');
    expect(modernDark.description).toBe('铂金白 · 简洁深色');
    expect(modern.appBackground).toBe('#FAFAFA');
    expect(modernDark.appBackground).toBe('#0A0A0A');
    expect(modern.accentColor).not.toBe('#5c6b78');
    expect(modernDark.accentColor).not.toBe('#8ea1ad');
    expect(modern.accentColor).not.toBe('#3D8B7A');
    expect(modernDark.accentColor).not.toBe('#5BB8A5');
  });
});
