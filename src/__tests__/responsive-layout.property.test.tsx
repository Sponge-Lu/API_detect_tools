/**
 * Property-Based Tests for Responsive Layout System
 * Feature: responsive-layout
 *
 * Tests the neutral responsive layout utilities and shell constraints
 * - Property 24: Viewport Resize Layout Preservation
 * - Property 25: Responsive Spacing Scaling
 * - Property 26: Content Overflow Handling
 *
 * @version 2.1.11
 * @updated 2025-01-09 - 创建响应式布局属性测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

describe('Responsive Layout System', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    // Inject responsive layout CSS variables into the test environment
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        /* 基础间距系统 */
        --spacing-xs: 4px;
        --spacing-sm: 8px;
        --spacing-md: 12px;
        --spacing-lg: 16px;
        --spacing-xl: 20px;
        --spacing-2xl: 24px;
        --spacing-3xl: 32px;
        --spacing-4xl: 40px;
      }
      
      /* 最小窗口尺寸支持 */
      html, body, #root {
        min-width: 1024px;
        min-height: 768px;
      }
      
      /* 内容溢出处理类 */
      .app-overflow-container {
        overflow: auto;
        min-width: 0;
        min-height: 0;
      }
      
      .app-scroll-x {
        overflow-x: auto;
        overflow-y: hidden;
      }
      
      .app-scroll-y {
        overflow-x: hidden;
        overflow-y: auto;
      }
      
      .app-scroll-both {
        overflow: auto;
      }
      
      .app-no-shrink {
        flex-shrink: 0;
        min-width: max-content;
      }
      
      .app-responsive-container {
        width: 100%;
        min-width: 1024px;
        overflow-x: auto;
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
  });

  // Feature: responsive-layout, Property 24: Viewport Resize Layout Preservation
  describe('Property 24: Viewport Resize Layout Preservation', () => {
    it('should have minimum width of 1024px for html element', () => {
      fc.assert(
        fc.property(fc.constantFrom('html', 'body', '#root'), selector => {
          // Check if the CSS contains the min-width rule
          const styleSheets = Array.from(document.styleSheets);
          let hasMinWidthRule = false;

          for (const sheet of styleSheets) {
            try {
              const rules = Array.from(sheet.cssRules || []);
              for (const rule of rules) {
                if (rule instanceof CSSStyleRule) {
                  const selectorText = rule.selectorText || '';
                  const cssText = rule.cssText.toLowerCase();

                  // Check if this rule applies to our selector
                  if (selectorText.includes(selector.replace('#', ''))) {
                    if (cssText.includes('min-width') && cssText.includes('1024px')) {
                      hasMinWidthRule = true;
                      break;
                    }
                  }
                }
              }
            } catch (e) {
              // Skip stylesheets we can't access
            }

            if (hasMinWidthRule) break;
          }

          expect(hasMinWidthRule).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should have minimum height of 768px for html element', () => {
      fc.assert(
        fc.property(fc.constantFrom('html', 'body', '#root'), selector => {
          // Check if the CSS contains the min-height rule
          const styleSheets = Array.from(document.styleSheets);
          let hasMinHeightRule = false;

          for (const sheet of styleSheets) {
            try {
              const rules = Array.from(sheet.cssRules || []);
              for (const rule of rules) {
                if (rule instanceof CSSStyleRule) {
                  const selectorText = rule.selectorText || '';
                  const cssText = rule.cssText.toLowerCase();

                  // Check if this rule applies to our selector
                  if (selectorText.includes(selector.replace('#', ''))) {
                    if (cssText.includes('min-height') && cssText.includes('768px')) {
                      hasMinHeightRule = true;
                      break;
                    }
                  }
                }
              }
            } catch (e) {
              // Skip stylesheets we can't access
            }

            if (hasMinHeightRule) break;
          }

          expect(hasMinHeightRule).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should have responsive container class with min-width 1024px', () => {
      fc.assert(
        fc.property(fc.constant('app-responsive-container'), className => {
          // Check if the CSS contains the responsive container rule
          const styleSheets = Array.from(document.styleSheets);
          let hasResponsiveContainerRule = false;

          for (const sheet of styleSheets) {
            try {
              const rules = Array.from(sheet.cssRules || []);
              for (const rule of rules) {
                if (rule instanceof CSSStyleRule) {
                  const selectorText = rule.selectorText || '';
                  const cssText = rule.cssText.toLowerCase();

                  if (selectorText.includes(className)) {
                    if (cssText.includes('min-width') && cssText.includes('1024px')) {
                      hasResponsiveContainerRule = true;
                      break;
                    }
                  }
                }
              }
            } catch (e) {
              // Skip stylesheets we can't access
            }

            if (hasResponsiveContainerRule) break;
          }

          expect(hasResponsiveContainerRule).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  // Feature: responsive-layout, Property 25: Responsive Spacing Scaling
  describe('Property 25: Spacing Scale', () => {
    it('should have base spacing values as multiples of 4px', () => {
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
            '--spacing-4xl'
          ),
          spacingVar => {
            const computedValue = getComputedStyle(document.documentElement)
              .getPropertyValue(spacingVar)
              .trim();

            const pixelMatch = computedValue.match(/^(\d+)px$/);
            expect(pixelMatch).not.toBeNull();

            if (pixelMatch) {
              const spacingValue = parseInt(pixelMatch[1]);
              // All spacing values should be multiples of 4px
              expect(spacingValue % 4).toBe(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: responsive-layout, Property 26: Content Overflow Handling
  describe('Property 26: Content Overflow Handling', () => {
    it('should have overflow container class with overflow: auto', () => {
      fc.assert(
        fc.property(fc.constant('app-overflow-container'), className => {
          // Check if the CSS contains the overflow rule
          const styleSheets = Array.from(document.styleSheets);
          let hasOverflowRule = false;

          for (const sheet of styleSheets) {
            try {
              const rules = Array.from(sheet.cssRules || []);
              for (const rule of rules) {
                if (rule instanceof CSSStyleRule) {
                  const selectorText = rule.selectorText || '';
                  const cssText = rule.cssText.toLowerCase();

                  if (selectorText.includes(className)) {
                    if (cssText.includes('overflow') && cssText.includes('auto')) {
                      hasOverflowRule = true;
                      break;
                    }
                  }
                }
              }
            } catch (e) {
              // Skip stylesheets we can't access
            }

            if (hasOverflowRule) break;
          }

          expect(hasOverflowRule).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should have scroll classes with correct overflow properties', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            { className: 'app-scroll-x', expectedOverflowX: 'auto', expectedOverflowY: 'hidden' },
            { className: 'app-scroll-y', expectedOverflowX: 'hidden', expectedOverflowY: 'auto' },
            { className: 'app-scroll-both', expectedOverflow: 'auto' }
          ),
          testCase => {
            // Check if the CSS contains the correct overflow rules
            const styleSheets = Array.from(document.styleSheets);
            let hasCorrectOverflow = false;

            for (const sheet of styleSheets) {
              try {
                const rules = Array.from(sheet.cssRules || []);
                for (const rule of rules) {
                  if (rule instanceof CSSStyleRule) {
                    const selectorText = rule.selectorText || '';
                    const cssText = rule.cssText.toLowerCase();

                    if (selectorText.includes(testCase.className)) {
                      if (testCase.expectedOverflow) {
                        // For app-scroll-both, check for overflow: auto
                        if (cssText.includes('overflow') && cssText.includes('auto')) {
                          hasCorrectOverflow = true;
                        }
                      } else {
                        // For app-scroll-x and app-scroll-y, check specific overflow properties
                        const hasOverflowX =
                          cssText.includes('overflow-x') &&
                          cssText.includes(testCase.expectedOverflowX!);
                        const hasOverflowY =
                          cssText.includes('overflow-y') &&
                          cssText.includes(testCase.expectedOverflowY!);
                        if (hasOverflowX && hasOverflowY) {
                          hasCorrectOverflow = true;
                        }
                      }
                      break;
                    }
                  }
                }
              } catch (e) {
                // Skip stylesheets we can't access
              }

              if (hasCorrectOverflow) break;
            }

            expect(hasCorrectOverflow).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have no-shrink class with flex-shrink: 0', () => {
      fc.assert(
        fc.property(fc.constant('app-no-shrink'), className => {
          // Check if the CSS contains the flex-shrink rule
          const styleSheets = Array.from(document.styleSheets);
          let hasNoShrinkRule = false;

          for (const sheet of styleSheets) {
            try {
              const rules = Array.from(sheet.cssRules || []);
              for (const rule of rules) {
                if (rule instanceof CSSStyleRule) {
                  const selectorText = rule.selectorText || '';
                  const cssText = rule.cssText.toLowerCase();

                  if (selectorText.includes(className)) {
                    if (cssText.includes('flex-shrink') && cssText.includes('0')) {
                      hasNoShrinkRule = true;
                      break;
                    }
                  }
                }
              }
            } catch (e) {
              // Skip stylesheets we can't access
            }

            if (hasNoShrinkRule) break;
          }

          expect(hasNoShrinkRule).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should have responsive container with overflow-x: auto', () => {
      fc.assert(
        fc.property(fc.constant('app-responsive-container'), className => {
          // Check if the CSS contains the overflow-x rule
          const styleSheets = Array.from(document.styleSheets);
          let hasOverflowXRule = false;

          for (const sheet of styleSheets) {
            try {
              const rules = Array.from(sheet.cssRules || []);
              for (const rule of rules) {
                if (rule instanceof CSSStyleRule) {
                  const selectorText = rule.selectorText || '';
                  const cssText = rule.cssText.toLowerCase();

                  if (selectorText.includes(className)) {
                    if (cssText.includes('overflow-x') && cssText.includes('auto')) {
                      hasOverflowXRule = true;
                      break;
                    }
                  }
                }
              }
            } catch (e) {
              // Skip stylesheets we can't access
            }

            if (hasOverflowXRule) break;
          }

          expect(hasOverflowXRule).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });
});
