/**
 * Property-Based Tests for IOSButton Component
 * Feature: ios-ui-redesign
 *
 * Tests IOSButton component for iOS button standards
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { render, fireEvent } from '@testing-library/react';
import { IOSButton } from '../renderer/components/IOSButton';

describe('IOSButton Component', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    // Inject iOS design system CSS variables for button tests
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        --ios-blue: #007AFF;
        --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
        --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);
        --duration-fast: 200ms;
        --ease-ios: cubic-bezier(0.4, 0, 0.2, 1);
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
  });

  // Feature: ios-ui-redesign, Property 8: Button Press Scale Animation
  it('should apply scale animation on button press (active state)', () => {
    fc.assert(
      fc.property(fc.constantFrom('primary', 'secondary', 'tertiary'), variant => {
        const { container } = render(
          <IOSButton variant={variant as 'primary' | 'secondary' | 'tertiary'}>
            Test Button
          </IOSButton>
        );

        const button = container.querySelector('button');
        expect(button).not.toBeNull();

        if (button) {
          // Check if the button has the active:scale-[0.97] class
          const classList = button.className;
          expect(classList).toContain('active:scale-[0.97]');

          // Verify the scale value is between 0.95 and 0.98
          const scaleMatch = classList.match(/active:scale-\[0\.(\d+)\]/);
          if (scaleMatch) {
            const scaleValue = parseFloat(`0.${scaleMatch[1]}`);
            expect(scaleValue).toBeGreaterThanOrEqual(0.95);
            expect(scaleValue).toBeLessThanOrEqual(0.98);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: ios-ui-redesign, Property 19: Hover State Background Change
  it('should change background on hover state', () => {
    fc.assert(
      fc.property(fc.constantFrom('primary', 'secondary', 'tertiary'), variant => {
        const { container } = render(
          <IOSButton variant={variant as 'primary' | 'secondary' | 'tertiary'}>
            Test Button
          </IOSButton>
        );

        const button = container.querySelector('button');
        expect(button).not.toBeNull();

        if (button) {
          const classList = button.className;

          // All variants should have hover state defined
          const hasHoverState = classList.includes('hover:bg-');
          expect(hasHoverState).toBe(true);

          // Verify variant-specific hover states
          if (variant === 'primary') {
            // Primary should hover to darker blue (#0066CC)
            expect(classList).toContain('hover:bg-[#0066CC]');
          } else if (variant === 'secondary') {
            // Secondary should increase opacity on hover
            expect(classList).toMatch(/hover:bg-\[rgba\(0,122,255,0\.15\)\]/);
          } else if (variant === 'tertiary') {
            // Tertiary should show background on hover
            expect(classList).toMatch(/hover:bg-\[rgba\(0,122,255,0\.08\)\]/);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: ios-ui-redesign, Property 27: Button Click Handler Preservation
  it('should preserve onClick handler functionality', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('primary', 'secondary', 'tertiary'),
        fc.integer({ min: 0, max: 100 }),
        (variant, clickCount) => {
          let actualClickCount = 0;
          const handleClick = () => {
            actualClickCount++;
          };

          const { container } = render(
            <IOSButton
              variant={variant as 'primary' | 'secondary' | 'tertiary'}
              onClick={handleClick}
            >
              Test Button
            </IOSButton>
          );

          const button = container.querySelector('button');
          expect(button).not.toBeNull();

          if (button) {
            // Simulate multiple clicks
            for (let i = 0; i < clickCount; i++) {
              fireEvent.click(button);
            }

            // Verify the handler was called the correct number of times
            expect(actualClickCount).toBe(clickCount);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify button has iOS border radius
  it('should use iOS standard border radius', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('primary', 'secondary', 'tertiary'),
        fc.constantFrom('sm', 'md', 'lg'),
        (variant, size) => {
          const { container } = render(
            <IOSButton
              variant={variant as 'primary' | 'secondary' | 'tertiary'}
              size={size as 'sm' | 'md' | 'lg'}
            >
              Test Button
            </IOSButton>
          );

          const button = container.querySelector('button');
          expect(button).not.toBeNull();

          if (button) {
            const classList = button.className;

            // Verify it has a rounded class
            const hasRoundedClass = classList.match(/rounded-\[(\d+)px\]/);
            expect(hasRoundedClass).not.toBeNull();

            if (hasRoundedClass) {
              const radiusValue = parseInt(hasRoundedClass[1]);

              // Should be one of the iOS standard values (8-16px range for buttons)
              expect(radiusValue).toBeGreaterThanOrEqual(8);
              expect(radiusValue).toBeLessThanOrEqual(16);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify disabled state
  it('should handle disabled state correctly', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('primary', 'secondary', 'tertiary'),
        fc.boolean(),
        (variant, disabled) => {
          let clickCount = 0;
          const handleClick = () => {
            clickCount++;
          };

          const { container } = render(
            <IOSButton
              variant={variant as 'primary' | 'secondary' | 'tertiary'}
              disabled={disabled}
              onClick={handleClick}
            >
              Test Button
            </IOSButton>
          );

          const button = container.querySelector('button');
          expect(button).not.toBeNull();

          if (button) {
            // Verify disabled attribute
            expect(button.disabled).toBe(disabled);

            // Verify disabled styling
            if (disabled) {
              const classList = button.className;
              expect(classList).toContain('disabled:opacity-50');
              expect(classList).toContain('disabled:cursor-not-allowed');
            }

            // Try to click
            fireEvent.click(button);

            // If disabled, click should not trigger handler
            if (disabled) {
              expect(clickCount).toBe(0);
            } else {
              expect(clickCount).toBe(1);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify loading state
  it('should handle loading state correctly', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('primary', 'secondary', 'tertiary'),
        fc.boolean(),
        (variant, loading) => {
          const { container } = render(
            <IOSButton variant={variant as 'primary' | 'secondary' | 'tertiary'} loading={loading}>
              Test Button
            </IOSButton>
          );

          const button = container.querySelector('button');
          expect(button).not.toBeNull();

          if (button) {
            // When loading, button should be disabled
            if (loading) {
              expect(button.disabled).toBe(true);

              // Should contain a loading spinner
              const spinner = button.querySelector('.animate-spin');
              expect(spinner).not.toBeNull();
            } else {
              // When not loading, should not have spinner
              const spinner = button.querySelector('.animate-spin');
              expect(spinner).toBeNull();
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify transition timing
  it('should use iOS timing function for transitions', () => {
    fc.assert(
      fc.property(fc.constantFrom('primary', 'secondary', 'tertiary'), variant => {
        const { container } = render(
          <IOSButton variant={variant as 'primary' | 'secondary' | 'tertiary'}>
            Test Button
          </IOSButton>
        );

        const button = container.querySelector('button');
        expect(button).not.toBeNull();

        if (button) {
          const classList = button.className;

          // Should have transition class (either transition-all or specific transition properties)
          const hasTransition =
            classList.includes('transition-all') || classList.includes('transition-[');
          expect(hasTransition).toBe(true);

          // Should use iOS timing function
          expect(classList).toContain('[transition-timing-function:var(--ease-ios)]');

          // Should use fast duration
          expect(classList).toContain('duration-[var(--duration-fast)]');
        }
      }),
      { numRuns: 100 }
    );
  });
});
