/**
 * Property-Based Tests for Theme Token Contract
 * Feature: product-design-system
 *
 * Verifies the four-theme preset system, neutral token contract, and the neutral button
 * primitive's dependence on shared theme tokens.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { render } from '@testing-library/react';
import { AppButton, type AppButtonProps } from '../renderer/components/AppButton/AppButton';
import {
  DEFAULT_LIGHT_THEME,
  THEME_PRESETS,
  getThemePreset,
  normalizeThemeMode,
  type ThemeMode,
} from '../shared/theme/themePresets';

const themeModes = THEME_PRESETS.map(preset => preset.id) as ThemeMode[];
const themeModeCases = [
  ...themeModes,
  'light',
  'system',
  '',
  'unexpected-theme',
  null,
  undefined,
] as const;

const buttonVariants: NonNullable<AppButtonProps['variant']>[] = [
  'primary',
  'secondary',
  'tertiary',
  'danger',
];

const normalizeCssValue = (value: string): string => value.trim().replace(/\s+/g, '').toUpperCase();

describe('theme preset normalization', () => {
  it('normalizes legacy and invalid theme values to a supported mode', () => {
    fc.assert(
      fc.property(fc.constantFrom(...themeModeCases), input => {
        const normalized = normalizeThemeMode(input);

        expect(themeModes).toContain(normalized);

        if (input === 'dark') {
          expect(normalized).toBe('dark');
        } else if (typeof input === 'string' && themeModes.includes(input as ThemeMode)) {
          expect(normalized).toBe(input as ThemeMode);
        } else {
          expect(normalized).toBe(DEFAULT_LIGHT_THEME);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('returns the matching preset for every supported theme mode', () => {
    fc.assert(
      fc.property(fc.constantFrom(...themeModes), mode => {
        const preset = getThemePreset(mode);
        const expectedPreset = THEME_PRESETS.find(candidate => candidate.id === mode);

        expect(expectedPreset).toBeDefined();
        expect(preset).toEqual(expectedPreset);
      }),
      { numRuns: 100 }
    );
  });
});

describe('neutral theme token contract', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    const lightA = getThemePreset('light-a');
    const lightB = getThemePreset('light-b');
    const lightC = getThemePreset('light-c');
    const dark = getThemePreset('dark');

    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        --app-bg: ${lightA.appBackground};
        --surface-1: ${lightA.panelBackground};
        --surface-3: ${lightA.panelRaised};
        --accent: ${lightA.accentColor};
        --accent-soft: ${lightA.softAccent};
        --line-soft: rgba(87, 80, 70, 0.12);
        --text-primary: #2c2a27;
        --text-secondary: #6a635c;
        --text-tertiary: #948d84;
        --danger: #8a5d5a;
        --danger-soft: rgba(138, 93, 90, 0.14);
        --radius-sm: 8px;
        --radius-md: 12px;
        --radius-lg: 16px;
        --radius-xl: 20px;
        --spacing-xs: 4px;
        --spacing-sm: 8px;
        --spacing-md: 12px;
        --spacing-lg: 16px;
        --spacing-xl: 20px;
        --spacing-2xl: 24px;
        --spacing-3xl: 32px;
        --spacing-4xl: 40px;
        --blur-sm: blur(8px);
        --blur-md: blur(12px);
        --blur-lg: blur(20px);
        --blur-xl: blur(40px);
        --shadow-sm: 0 1px 2px rgba(33, 31, 27, 0.04);
        --shadow-md: 0 2px 8px rgba(33, 31, 27, 0.06), 0 1px 2px rgba(33, 31, 27, 0.04);
        --shadow-xl: 0 16px 32px rgba(33, 31, 27, 0.1), 0 4px 12px rgba(33, 31, 27, 0.06);
        --duration-fast: 200ms;
        --duration-normal: 300ms;
        --duration-slow: 400ms;
        --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
      }

      html[data-theme='light-b'] {
        --app-bg: ${lightB.appBackground};
        --surface-1: ${lightB.panelBackground};
        --surface-3: ${lightB.panelRaised};
        --accent: ${lightB.accentColor};
        --accent-soft: ${lightB.softAccent};
      }

      html[data-theme='light-c'] {
        --app-bg: ${lightC.appBackground};
        --surface-1: ${lightC.panelBackground};
        --surface-3: ${lightC.panelRaised};
        --accent: ${lightC.accentColor};
        --accent-soft: ${lightC.softAccent};
      }

      html[data-theme='dark'] {
        --app-bg: ${dark.appBackground};
        --surface-1: ${dark.panelBackground};
        --surface-3: ${dark.panelRaised};
        --accent: ${dark.accentColor};
        --accent-soft: ${dark.softAccent};
      }
    `;

    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
    delete document.documentElement.dataset.theme;
  });

  it('surfaces the correct app, surface, and accent tokens for every theme preset', () => {
    fc.assert(
      fc.property(fc.constantFrom(...themeModes), mode => {
        if (mode === 'light-a') {
          delete document.documentElement.dataset.theme;
        } else {
          document.documentElement.dataset.theme = mode;
        }

        const preset = getThemePreset(mode);
        const styles = getComputedStyle(document.documentElement);

        expect(normalizeCssValue(styles.getPropertyValue('--app-bg'))).toBe(
          normalizeCssValue(preset.appBackground)
        );
        expect(normalizeCssValue(styles.getPropertyValue('--surface-1'))).toBe(
          normalizeCssValue(preset.panelBackground)
        );
        expect(normalizeCssValue(styles.getPropertyValue('--surface-3'))).toBe(
          normalizeCssValue(preset.panelRaised)
        );
        expect(normalizeCssValue(styles.getPropertyValue('--accent'))).toBe(
          normalizeCssValue(preset.accentColor)
        );
        expect(normalizeCssValue(styles.getPropertyValue('--accent-soft'))).toBe(
          normalizeCssValue(preset.softAccent)
        );
      }),
      { numRuns: 100 }
    );
  });

  it('keeps spacing and radius tokens on the shared scale', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          '--spacing-xs',
          '--spacing-sm',
          '--spacing-md',
          '--spacing-lg',
          '--spacing-xl',
          '--spacing-2xl',
          '--spacing-3xl',
          '--spacing-4xl',
          '--radius-sm',
          '--radius-md',
          '--radius-lg',
          '--radius-xl'
        ),
        tokenName => {
          const numericValue = parseInt(
            getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim(),
            10
          );

          expect(Number.isNaN(numericValue)).toBe(false);
          expect(numericValue % 4).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('keeps motion tokens within the supported contract bounds', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('--duration-fast', '--duration-normal', '--duration-slow'),
        tokenName => {
          const numericValue = parseInt(
            getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim(),
            10
          );

          expect(numericValue).toBeGreaterThanOrEqual(200);
          expect(numericValue).toBeLessThanOrEqual(400);
        }
      ),
      { numRuns: 100 }
    );

    expect(
      getComputedStyle(document.documentElement).getPropertyValue('--ease-standard').trim()
    ).toMatch(/cubic-bezier\(/);
  });
});

describe('AppButton theme integration contract', () => {
  it('uses neutral theme token classes across all supported button variants', () => {
    fc.assert(
      fc.property(fc.constantFrom(...buttonVariants), variant => {
        const { container, unmount } = render(<AppButton variant={variant}>Theme Button</AppButton>);
        const button = container.querySelector('button');

        expect(button).not.toBeNull();

        if (button) {
          const classList = button.className;

          if (variant === 'primary') {
            expect(classList).toContain('bg-[var(--accent-soft)]');
            expect(classList).toContain('text-[var(--accent-strong)]');
          } else if (variant === 'secondary') {
            expect(classList).toContain('border-[var(--line-soft)]');
            expect(classList).toContain('bg-[var(--surface-3)]');
          } else if (variant === 'tertiary') {
            expect(classList).toContain('bg-transparent');
            expect(classList).toContain('text-[var(--text-secondary)]');
          } else {
            expect(classList).toContain('bg-[var(--danger-soft)]');
            expect(classList).toContain('text-[var(--danger)]');
          }
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });
});
