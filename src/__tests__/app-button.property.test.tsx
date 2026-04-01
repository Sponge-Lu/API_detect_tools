/**
 * Property-Based Tests for AppButton
 * Feature: product-design-system
 *
 * Tests the neutral button primitive contract used by the current product design system.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { render, fireEvent } from '@testing-library/react';
import { AppButton, type AppButtonProps } from '../renderer/components/AppButton/AppButton';

const variants: NonNullable<AppButtonProps['variant']>[] = [
  'primary',
  'secondary',
  'tertiary',
  'danger',
];

const sizes: NonNullable<AppButtonProps['size']>[] = ['sm', 'md', 'lg'];

describe('AppButton primitive contract', () => {
  it('applies the expected token-driven classes for each variant', () => {
    fc.assert(
      fc.property(fc.constantFrom(...variants), variant => {
        const { container, unmount } = render(<AppButton variant={variant}>Test Button</AppButton>);
        const button = container.querySelector('button');

        expect(button).not.toBeNull();

        if (button) {
          const classList = button.className;

          expect(classList).toContain('rounded-[var(--radius-md)]');
          expect(classList).toContain('transition-colors');
          expect(classList).toContain('disabled:opacity-50');
          expect(classList).toContain('disabled:cursor-not-allowed');

          if (variant === 'primary') {
            expect(classList).toContain('bg-[var(--accent-soft)]');
            expect(classList).toContain('text-[var(--accent-strong)]');
            expect(classList).toContain('hover:bg-[var(--accent-soft-strong)]');
          } else if (variant === 'secondary') {
            expect(classList).toContain('border-[var(--line-soft)]');
            expect(classList).toContain('bg-[var(--surface-3)]');
            expect(classList).toContain('text-[var(--text-secondary)]');
            expect(classList).toContain('hover:bg-[var(--surface-2)]');
          } else if (variant === 'tertiary') {
            expect(classList).toContain('border-transparent');
            expect(classList).toContain('bg-transparent');
            expect(classList).toContain('text-[var(--text-secondary)]');
            expect(classList).toContain('hover:bg-[var(--surface-2)]');
          } else {
            expect(classList).toContain('bg-[var(--danger-soft)]');
            expect(classList).toContain('text-[var(--danger)]');
            expect(classList).toContain(
              'hover:bg-[color-mix(in_srgb,var(--danger)_20%,transparent)]'
            );
          }
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('applies the correct size classes', () => {
    fc.assert(
      fc.property(fc.constantFrom(...sizes), size => {
        const { container, unmount } = render(<AppButton size={size}>Sized Button</AppButton>);
        const button = container.querySelector('button');

        expect(button).not.toBeNull();

        if (button) {
          const classList = button.className;
          const sizeClassMap: Record<NonNullable<AppButtonProps['size']>, string[]> = {
            sm: ['min-h-8', 'px-3', 'text-xs'],
            md: ['min-h-9', 'px-3.5', 'text-sm'],
            lg: ['min-h-10', 'px-4', 'text-sm'],
          };

          sizeClassMap[size].forEach(expectedClass => {
            expect(classList).toContain(expectedClass);
          });
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('preserves onClick handler behavior for enabled buttons', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...variants),
        fc.constantFrom(...sizes),
        fc.integer({ min: 0, max: 50 }),
        (variant, size, clickCount) => {
          let actualClickCount = 0;
          const handleClick = () => {
            actualClickCount++;
          };

          const { container, unmount } = render(
            <AppButton variant={variant} size={size} onClick={handleClick}>
              Click Me
            </AppButton>
          );

          const button = container.querySelector('button');
          expect(button).not.toBeNull();

          if (button) {
            for (let i = 0; i < clickCount; i++) {
              fireEvent.click(button);
            }

            expect(actualClickCount).toBe(clickCount);
          }

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('blocks click handlers when disabled', () => {
    fc.assert(
      fc.property(fc.constantFrom(...variants), variant => {
        let clickCount = 0;
        const { container, unmount } = render(
          <AppButton variant={variant} disabled={true} onClick={() => clickCount++}>
            Disabled Button
          </AppButton>
        );

        const button = container.querySelector('button') as HTMLButtonElement | null;
        expect(button).not.toBeNull();

        if (button) {
          expect(button.disabled).toBe(true);
          fireEvent.click(button);
          expect(clickCount).toBe(0);
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('marks loading buttons as busy and disabled while showing a spinner', () => {
    fc.assert(
      fc.property(fc.constantFrom(...variants), fc.boolean(), (variant, loading) => {
        const { container, unmount } = render(
          <AppButton variant={variant} loading={loading}>
            Save
          </AppButton>
        );

        const button = container.querySelector('button') as HTMLButtonElement | null;
        expect(button).not.toBeNull();

        if (button) {
          const spinner = button.querySelector('.animate-spin');

          if (loading) {
            expect(button.disabled).toBe(true);
            expect(button.getAttribute('aria-busy')).toBe('true');
            expect(spinner).not.toBeNull();
          } else {
            expect(button.getAttribute('aria-busy')).toBe('false');
            expect(spinner).toBeNull();
          }
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });
});
