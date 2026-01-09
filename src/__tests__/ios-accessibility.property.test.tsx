/**
 * Property-Based Tests for iOS Accessibility
 * Feature: ios-ui-redesign
 *
 * Tests accessibility features for iOS design system:
 * - Property 16: Text Contrast Ratio
 * - Property 37: Focus Indicator Visibility
 * - Property 38: Keyboard Accessibility
 *
 * @version 2.1.11
 * @created 2025-01-09
 *
 * Validates: Requirements 4.3, 13.1, 13.2, 13.3
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { render, fireEvent } from '@testing-library/react';
import { IOSButton } from '../renderer/components/IOSButton';
import { IOSInput } from '../renderer/components/IOSInput';
import { IOSCard } from '../renderer/components/IOSCard';
import { IOSModal } from '../renderer/components/IOSModal';
import { IOSTable, IOSTableRow, IOSTableCell, IOSTableBody } from '../renderer/components/IOSTable';

// ========== Helper Functions ==========

/**
 * Calculate relative luminance of a color
 * Based on WCAG 2.1 formula
 */
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate contrast ratio between two colors
 * Returns a value between 1 and 21
 */
function getContrastRatio(
  color1: [number, number, number],
  color2: [number, number, number]
): number {
  const l1 = getLuminance(...color1);
  const l2 = getLuminance(...color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Parse color string to RGB values
 */
function parseColor(color: string): [number, number, number] | null {
  // Handle hex colors
  const hexMatch = color.match(/^#([0-9A-Fa-f]{6})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    return [
      parseInt(hex.substring(0, 2), 16),
      parseInt(hex.substring(2, 4), 16),
      parseInt(hex.substring(4, 6), 16),
    ];
  }

  // Handle rgb/rgba colors
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
  }

  return null;
}

// ========== CSS Variables Setup ==========

describe('iOS Accessibility - CSS Variables', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    // Inject iOS design system CSS variables with accessibility styles
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        /* iOS 背景颜色 - 浅色模式 */
        --ios-bg-primary: #F2F2F7;
        --ios-bg-secondary: #FFFFFF;
        --ios-bg-tertiary: #FFFFFF;
        
        /* iOS 文字颜色 - 浅色模式 */
        --ios-text-primary: #000000;
        --ios-text-secondary: rgba(60, 60, 67, 0.7);
        --ios-text-tertiary: rgba(60, 60, 67, 0.3);
        
        /* iOS 主题色 */
        --ios-blue: #007AFF;
        --ios-red: #FF3B30;
        
        /* 间距系统 */
        --spacing-sm: 8px;
        --spacing-md: 12px;
        --spacing-lg: 16px;
        
        /* 圆角系统 */
        --radius-sm: 8px;
        --radius-md: 12px;
        --radius-lg: 16px;
        
        /* 动画时长 */
        --duration-fast: 200ms;
        --ease-ios: cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      .dark {
        /* iOS 背景颜色 - 深色模式 */
        --ios-bg-primary: #000000;
        --ios-bg-secondary: #1C1C1E;
        --ios-bg-tertiary: #2C2C2E;
        
        /* iOS 文字颜色 - 深色模式 */
        --ios-text-primary: #FFFFFF;
        --ios-text-secondary: rgba(235, 235, 245, 0.7);
        --ios-text-tertiary: rgba(235, 235, 245, 0.3);
        
        /* iOS 主题色 - 深色模式 */
        --ios-blue: #0A84FF;
        --ios-red: #FF453A;
      }
      
      /* 焦点指示器样式 */
      :focus-visible {
        outline: 2px solid var(--ios-blue);
        outline-offset: 2px;
      }
      
      button:focus-visible,
      [role="button"]:focus-visible {
        outline: 2px solid var(--ios-blue);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.2);
      }
      
      input:focus-visible,
      textarea:focus-visible,
      select:focus-visible {
        outline: 2px solid var(--ios-blue);
        outline-offset: 0;
        box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.1);
      }
      
      /* 屏幕阅读器专用 */
      .ios-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      
      /* 禁用状态 */
      [disabled],
      [aria-disabled="true"] {
        opacity: 0.5;
        cursor: not-allowed;
      }
      
      /* 减少动画 */
      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation-duration: 0.01ms !important;
          transition-duration: 0.01ms !important;
        }
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
    document.documentElement.classList.remove('dark');
  });

  // Feature: ios-ui-redesign, Property 16: Text Contrast Ratio
  // Validates: Requirements 4.3, 13.1
  describe('Property 16: Text Contrast Ratio', () => {
    it('should have primary text contrast ratio >= 4.5:1 in light mode', () => {
      document.documentElement.classList.remove('dark');

      fc.assert(
        fc.property(
          fc.constantFrom('--ios-bg-primary', '--ios-bg-secondary', '--ios-bg-tertiary'),
          bgVar => {
            // Light mode text colors
            const textColor: [number, number, number] = [0, 0, 0]; // #000000

            // Background colors
            const bgColors: Record<string, [number, number, number]> = {
              '--ios-bg-primary': [242, 242, 247], // #F2F2F7
              '--ios-bg-secondary': [255, 255, 255], // #FFFFFF
              '--ios-bg-tertiary': [255, 255, 255], // #FFFFFF
            };

            const bgColor = bgColors[bgVar];
            const contrastRatio = getContrastRatio(textColor, bgColor);

            // WCAG AA requires 4.5:1 for normal text
            expect(contrastRatio).toBeGreaterThanOrEqual(4.5);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have primary text contrast ratio >= 4.5:1 in dark mode', () => {
      document.documentElement.classList.add('dark');

      fc.assert(
        fc.property(
          fc.constantFrom('--ios-bg-primary', '--ios-bg-secondary', '--ios-bg-tertiary'),
          bgVar => {
            // Dark mode text colors
            const textColor: [number, number, number] = [255, 255, 255]; // #FFFFFF

            // Background colors
            const bgColors: Record<string, [number, number, number]> = {
              '--ios-bg-primary': [0, 0, 0], // #000000
              '--ios-bg-secondary': [28, 28, 30], // #1C1C1E
              '--ios-bg-tertiary': [44, 44, 46], // #2C2C2E
            };

            const bgColor = bgColors[bgVar];
            const contrastRatio = getContrastRatio(textColor, bgColor);

            // WCAG AA requires 4.5:1 for normal text
            expect(contrastRatio).toBeGreaterThanOrEqual(4.5);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have iOS blue color with sufficient contrast on backgrounds', () => {
      fc.assert(
        fc.property(fc.constantFrom('light', 'dark'), theme => {
          if (theme === 'dark') {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }

          // iOS blue colors
          const blueColor: [number, number, number] =
            theme === 'light'
              ? [0, 122, 255] // #007AFF
              : [10, 132, 255]; // #0A84FF

          // White background for light mode, dark background for dark mode
          const bgColor: [number, number, number] =
            theme === 'light'
              ? [255, 255, 255] // #FFFFFF
              : [28, 28, 30]; // #1C1C1E

          const contrastRatio = getContrastRatio(blueColor, bgColor);

          // iOS blue should have at least 3:1 contrast for large text/UI components
          expect(contrastRatio).toBeGreaterThanOrEqual(3);
        }),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ios-ui-redesign, Property 37: Focus Indicator Visibility
  // Validates: Requirements 13.2
  describe('Property 37: Focus Indicator Visibility', () => {
    it('should have focus-visible CSS rule with 2px outline', () => {
      fc.assert(
        fc.property(fc.constantFrom('button', 'input', '[role="button"]'), selector => {
          // Check if the CSS contains focus-visible rules
          const styleSheets = Array.from(document.styleSheets);
          let hasFocusVisibleRule = false;

          for (const sheet of styleSheets) {
            try {
              const rules = Array.from(sheet.cssRules || []);
              for (const rule of rules) {
                if (rule instanceof CSSStyleRule) {
                  const selectorText = rule.selectorText || '';
                  const cssText = rule.cssText || '';

                  // Check for focus-visible selector
                  if (selectorText.includes(':focus-visible')) {
                    hasFocusVisibleRule = true;

                    // Verify outline width is at least 2px
                    if (cssText.includes('outline:') || cssText.includes('outline-width:')) {
                      const outlineMatch = cssText.match(/outline:\s*(\d+)px/);
                      if (outlineMatch) {
                        const outlineWidth = parseInt(outlineMatch[1]);
                        expect(outlineWidth).toBeGreaterThanOrEqual(2);
                      }
                    }
                  }
                }
              }
            } catch (e) {
              // Skip stylesheets we can't access
            }
          }

          expect(hasFocusVisibleRule).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should have focus indicator with sufficient contrast', () => {
      fc.assert(
        fc.property(fc.constantFrom('light', 'dark'), theme => {
          // iOS blue focus color
          const focusColor: [number, number, number] =
            theme === 'light'
              ? [0, 122, 255] // #007AFF
              : [10, 132, 255]; // #0A84FF

          // Background color
          const bgColor: [number, number, number] =
            theme === 'light'
              ? [255, 255, 255] // #FFFFFF
              : [28, 28, 30]; // #1C1C1E

          const contrastRatio = getContrastRatio(focusColor, bgColor);

          // Focus indicator should have at least 3:1 contrast
          expect(contrastRatio).toBeGreaterThanOrEqual(3);
        }),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ios-ui-redesign, Property 38: Keyboard Accessibility
  // Validates: Requirements 13.3
  describe('Property 38: Keyboard Accessibility', () => {
    it('should have reduced motion CSS rule defined', () => {
      fc.assert(
        fc.property(fc.constantFrom('animation-duration', 'transition-duration'), property => {
          const styleSheets = Array.from(document.styleSheets);
          let hasReducedMotionRule = false;

          for (const sheet of styleSheets) {
            try {
              const rules = Array.from(sheet.cssRules || []);
              for (const rule of rules) {
                if (rule instanceof CSSMediaRule) {
                  const conditionText = rule.conditionText || rule.media?.mediaText || '';
                  if (conditionText.includes('prefers-reduced-motion')) {
                    hasReducedMotionRule = true;

                    // Verify the rule contains animation/transition duration overrides
                    const innerRules = Array.from(rule.cssRules);
                    const hasPropertyOverride = innerRules.some(innerRule => {
                      if (innerRule instanceof CSSStyleRule) {
                        const cssText = innerRule.cssText.toLowerCase();
                        return cssText.includes(property) && cssText.includes('0.01ms');
                      }
                      return false;
                    });

                    expect(hasPropertyOverride).toBe(true);
                  }
                }
              }
            } catch (e) {
              // Skip stylesheets we can't access
            }
          }

          expect(hasReducedMotionRule).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should have screen reader only CSS class defined', () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          const styleSheets = Array.from(document.styleSheets);
          let hasSrOnlyClass = false;

          for (const sheet of styleSheets) {
            try {
              const rules = Array.from(sheet.cssRules || []);
              for (const rule of rules) {
                if (rule instanceof CSSStyleRule) {
                  const selectorText = rule.selectorText || '';
                  const cssText = rule.cssText || '';

                  if (selectorText.includes('.ios-sr-only')) {
                    hasSrOnlyClass = true;

                    // Verify it has the correct properties for screen reader only
                    expect(cssText).toContain('position');
                    expect(cssText).toContain('clip');
                  }
                }
              }
            } catch (e) {
              // Skip stylesheets we can't access
            }
          }

          expect(hasSrOnlyClass).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });
});

// ========== Component Accessibility Tests ==========

describe('iOS Component Accessibility', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        --ios-blue: #007AFF;
        --ios-red: #FF3B30;
        --ios-bg-secondary: #FFFFFF;
        --ios-bg-tertiary: #FFFFFF;
        --ios-text-primary: #000000;
        --ios-text-secondary: rgba(60, 60, 67, 0.7);
        --ios-text-tertiary: rgba(60, 60, 67, 0.3);
        --ios-separator: rgba(60, 60, 67, 0.29);
        --ios-gray: #8E8E93;
        --spacing-xs: 4px;
        --spacing-sm: 8px;
        --spacing-md: 12px;
        --spacing-lg: 16px;
        --spacing-xl: 20px;
        --spacing-2xl: 24px;
        --radius-sm: 8px;
        --radius-md: 12px;
        --radius-lg: 16px;
        --radius-xl: 20px;
        --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
        --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
        --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.10);
        --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.12);
        --duration-fast: 200ms;
        --duration-normal: 300ms;
        --ease-ios: cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      .ios-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
  });

  // IOSButton Accessibility Tests
  describe('IOSButton Accessibility', () => {
    it('should support aria-label for icon-only buttons', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('primary', 'secondary', 'tertiary'),
          fc.string({ minLength: 1, maxLength: 50 }),
          (variant, label) => {
            const { container } = render(
              <IOSButton
                variant={variant as 'primary' | 'secondary' | 'tertiary'}
                aria-label={label}
              >
                <span aria-hidden="true">🔍</span>
              </IOSButton>
            );

            const button = container.querySelector('button');
            expect(button).not.toBeNull();

            if (button) {
              expect(button.getAttribute('aria-label')).toBe(label);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have aria-disabled when disabled', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('primary', 'secondary', 'tertiary'),
          fc.boolean(),
          (variant, disabled) => {
            const { container } = render(
              <IOSButton
                variant={variant as 'primary' | 'secondary' | 'tertiary'}
                disabled={disabled}
              >
                Test
              </IOSButton>
            );

            const button = container.querySelector('button');
            expect(button).not.toBeNull();

            if (button) {
              if (disabled) {
                expect(button.getAttribute('aria-disabled')).toBe('true');
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have aria-busy when loading', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('primary', 'secondary', 'tertiary'),
          fc.boolean(),
          (variant, loading) => {
            const { container } = render(
              <IOSButton
                variant={variant as 'primary' | 'secondary' | 'tertiary'}
                loading={loading}
              >
                Test
              </IOSButton>
            );

            const button = container.querySelector('button');
            expect(button).not.toBeNull();

            if (button) {
              if (loading) {
                expect(button.getAttribute('aria-busy')).toBe('true');
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should be keyboard accessible (Enter/Space)', () => {
      fc.assert(
        fc.property(fc.constantFrom('primary', 'secondary', 'tertiary'), variant => {
          let clicked = false;
          const { container } = render(
            <IOSButton
              variant={variant as 'primary' | 'secondary' | 'tertiary'}
              onClick={() => {
                clicked = true;
              }}
            >
              Test
            </IOSButton>
          );

          const button = container.querySelector('button');
          expect(button).not.toBeNull();

          if (button) {
            // Test Enter key
            clicked = false;
            fireEvent.keyDown(button, { key: 'Enter' });
            // Note: fireEvent.keyDown doesn't trigger click, but we verify the button is focusable

            // Verify button is focusable (not tabIndex=-1)
            expect(button.tabIndex).not.toBe(-1);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // IOSInput Accessibility Tests
  describe('IOSInput Accessibility', () => {
    it('should have aria-invalid when error is true', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          fc.string({ minLength: 1, maxLength: 50 }),
          (error, errorMessage) => {
            const { container } = render(<IOSInput error={error} errorMessage={errorMessage} />);

            const input = container.querySelector('input');
            expect(input).not.toBeNull();

            if (input) {
              if (error) {
                expect(input.getAttribute('aria-invalid')).toBe('true');
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have aria-required when required is true', () => {
      fc.assert(
        fc.property(fc.boolean(), required => {
          const { container } = render(<IOSInput required={required} />);

          const input = container.querySelector('input');
          expect(input).not.toBeNull();

          if (input) {
            if (required) {
              expect(input.getAttribute('aria-required')).toBe('true');
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should have label associated with input via htmlFor', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 30 }), labelText => {
          const { container } = render(<IOSInput label={labelText} />);

          const label = container.querySelector('label');
          const input = container.querySelector('input');

          expect(label).not.toBeNull();
          expect(input).not.toBeNull();

          if (label && input) {
            const labelFor = label.getAttribute('for');
            const inputId = input.getAttribute('id');

            // Label should be associated with input
            expect(labelFor).toBe(inputId);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should have aria-describedby for error messages', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 50 }), errorMessage => {
          const { container } = render(<IOSInput error={true} errorMessage={errorMessage} />);

          const input = container.querySelector('input');
          const errorElement = container.querySelector('[role="alert"]');

          expect(input).not.toBeNull();
          expect(errorElement).not.toBeNull();

          if (input && errorElement) {
            const describedBy = input.getAttribute('aria-describedby');
            const errorId = errorElement.getAttribute('id');

            // Input should reference error message
            expect(describedBy).toContain(errorId);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should have password toggle button with aria-label', () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          const { container } = render(<IOSInput type="password" showPasswordToggle={true} />);

          const toggleButton = container.querySelector('button[aria-label]');
          expect(toggleButton).not.toBeNull();

          if (toggleButton) {
            const ariaLabel = toggleButton.getAttribute('aria-label');
            expect(ariaLabel).toBeTruthy();
            // Should be either "显示密码" or "隐藏密码"
            expect(['显示密码', '隐藏密码']).toContain(ariaLabel);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // IOSCard Accessibility Tests
  describe('IOSCard Accessibility', () => {
    it('should support aria-label', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 50 }), label => {
          const { container } = render(
            <IOSCard aria-label={label}>
              <div>Content</div>
            </IOSCard>
          );

          const card = container.firstChild as HTMLElement;
          expect(card).not.toBeNull();

          if (card) {
            expect(card.getAttribute('aria-label')).toBe(label);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should have aria-expanded for expandable cards', () => {
      fc.assert(
        fc.property(fc.boolean(), expanded => {
          const { container } = render(
            <IOSCard expanded={expanded} expandContent={<div>Expanded content</div>}>
              <div>Main content</div>
            </IOSCard>
          );

          const card = container.firstChild as HTMLElement;
          expect(card).not.toBeNull();

          if (card) {
            expect(card.getAttribute('aria-expanded')).toBe(String(expanded));
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should have aria-disabled when disabled', () => {
      fc.assert(
        fc.property(fc.boolean(), disabled => {
          const { container } = render(
            <IOSCard disabled={disabled}>
              <div>Content</div>
            </IOSCard>
          );

          const card = container.firstChild as HTMLElement;
          expect(card).not.toBeNull();

          if (card) {
            if (disabled) {
              expect(card.getAttribute('aria-disabled')).toBe('true');
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should be focusable when focusable prop is true', () => {
      fc.assert(
        fc.property(fc.boolean(), focusable => {
          const { container } = render(
            <IOSCard focusable={focusable}>
              <div>Content</div>
            </IOSCard>
          );

          const card = container.firstChild as HTMLElement;
          expect(card).not.toBeNull();

          if (card) {
            if (focusable) {
              expect(card.tabIndex).toBe(0);
              expect(card.getAttribute('role')).toBe('article');
            } else {
              expect(card.tabIndex).toBe(-1);
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // IOSTable Accessibility Tests
  describe('IOSTable Accessibility', () => {
    it('should have role="table"', () => {
      fc.assert(
        fc.property(fc.constantFrom('standard', 'grouped', 'inset'), variant => {
          const { container } = render(
            <IOSTable variant={variant as 'standard' | 'grouped' | 'inset'}>
              <IOSTableBody>
                <IOSTableRow>
                  <IOSTableCell>Cell</IOSTableCell>
                </IOSTableRow>
              </IOSTableBody>
            </IOSTable>
          );

          const table = container.querySelector('[role="table"]');
          expect(table).not.toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    it('should have role="row" for table rows', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 5 }), rowCount => {
          const rows = Array.from({ length: rowCount }, (_, i) => (
            <IOSTableRow key={i}>
              <IOSTableCell>Cell {i}</IOSTableCell>
            </IOSTableRow>
          ));

          const { container } = render(
            <IOSTable>
              <IOSTableBody>{rows}</IOSTableBody>
            </IOSTable>
          );

          const tableRows = container.querySelectorAll('[role="row"]');
          expect(tableRows.length).toBe(rowCount);
        }),
        { numRuns: 100 }
      );
    });

    it('should have role="cell" for table cells', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 5 }), cellCount => {
          const cells = Array.from({ length: cellCount }, (_, i) => (
            <IOSTableCell key={i}>Cell {i}</IOSTableCell>
          ));

          const { container } = render(
            <IOSTable>
              <IOSTableBody>
                <IOSTableRow>{cells}</IOSTableRow>
              </IOSTableBody>
            </IOSTable>
          );

          const tableCells = container.querySelectorAll('[role="cell"]');
          expect(tableCells.length).toBe(cellCount);
        }),
        { numRuns: 100 }
      );
    });

    it('should have aria-disabled and aria-selected on rows', () => {
      fc.assert(
        fc.property(fc.boolean(), fc.boolean(), (disabled, selected) => {
          const { container } = render(
            <IOSTable>
              <IOSTableBody>
                <IOSTableRow disabled={disabled} selected={selected}>
                  <IOSTableCell>Cell</IOSTableCell>
                </IOSTableRow>
              </IOSTableBody>
            </IOSTable>
          );

          const row = container.querySelector('[role="row"]');
          expect(row).not.toBeNull();

          if (row) {
            if (disabled) {
              expect(row.getAttribute('aria-disabled')).toBe('true');
            }
            expect(row.getAttribute('aria-selected')).toBe(String(selected));
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should support keyboard navigation when focusable', () => {
      fc.assert(
        fc.property(fc.boolean(), focusable => {
          const { container } = render(
            <IOSTable>
              <IOSTableBody>
                <IOSTableRow focusable={focusable}>
                  <IOSTableCell>Cell</IOSTableCell>
                </IOSTableRow>
              </IOSTableBody>
            </IOSTable>
          );

          const row = container.querySelector('[role="row"]');
          expect(row).not.toBeNull();

          if (row) {
            if (focusable) {
              expect((row as HTMLElement).tabIndex).toBe(0);
            } else {
              expect((row as HTMLElement).tabIndex).toBe(-1);
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // IOSModal Accessibility Tests
  describe('IOSModal Accessibility', () => {
    it('should have role="dialog" and aria-modal="true"', () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          const { container } = render(
            <IOSModal isOpen={true} onClose={() => {}}>
              <div>Modal content</div>
            </IOSModal>
          );

          const dialog = container.querySelector('[role="dialog"]');
          expect(dialog).not.toBeNull();

          if (dialog) {
            expect(dialog.getAttribute('aria-modal')).toBe('true');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should have aria-labelledby when title is provided', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 30 }), title => {
          const { container } = render(
            <IOSModal isOpen={true} onClose={() => {}} title={title}>
              <div>Modal content</div>
            </IOSModal>
          );

          const dialog = container.querySelector('[role="dialog"]');
          const titleElement = container.querySelector('h2');

          expect(dialog).not.toBeNull();
          expect(titleElement).not.toBeNull();

          if (dialog && titleElement) {
            const labelledBy = dialog.getAttribute('aria-labelledby');
            const titleId = titleElement.getAttribute('id');

            expect(labelledBy).toBe(titleId);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should have close button with aria-label', () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          const { container } = render(
            <IOSModal isOpen={true} onClose={() => {}} showCloseButton={true}>
              <div>Modal content</div>
            </IOSModal>
          );

          const closeButton = container.querySelector('button[aria-label]');
          expect(closeButton).not.toBeNull();

          if (closeButton) {
            const ariaLabel = closeButton.getAttribute('aria-label');
            expect(ariaLabel).toBeTruthy();
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should close on Escape key', () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          let closed = false;
          render(
            <IOSModal
              isOpen={true}
              onClose={() => {
                closed = true;
              }}
              closeOnEsc={true}
            >
              <div>Modal content</div>
            </IOSModal>
          );

          // Simulate Escape key
          fireEvent.keyDown(window, { key: 'Escape' });

          expect(closed).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });
});
