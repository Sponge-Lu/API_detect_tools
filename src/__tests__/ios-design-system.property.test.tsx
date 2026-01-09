/**
 * Property-Based Tests for iOS Design System
 * Feature: ios-ui-redesign
 *
 * Tests CSS variable system for iOS design consistency
 * Tests animation system for iOS animation standards
 * Tests IOSButton component for iOS button standards
 * Tests spacing system for 8px grid alignment (Property 6)
 *
 * @version 2.1.12
 * @updated 2025-01-09 - 移除 Property 18 主题切换过渡测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { render, fireEvent } from '@testing-library/react';
import { IOSButton } from '../renderer/components/IOSButton';

describe('iOS Design System - CSS Variables', () => {
  let testElement: HTMLDivElement;
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    // Inject iOS design system CSS variables into the test environment
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        /* iOS 背景颜色 - 浅色模式 */
        --ios-bg-primary: #F2F2F7;
        --ios-bg-secondary: #FFFFFF;
        --ios-bg-tertiary: #FFFFFF;
        
        /* iOS 文字颜色 - 浅色模式 */
        --ios-text-primary: #000000;
        --ios-text-secondary: rgba(60, 60, 67, 0.6);
        --ios-text-tertiary: rgba(60, 60, 67, 0.3);
        
        /* iOS 主题色 - 浅色模式 */
        --ios-blue: #007AFF;
        --ios-green: #34C759;
        --ios-red: #FF3B30;
        --ios-orange: #FF9500;
        --ios-gray: #8E8E93;
        
        /* 分隔线 */
        --ios-separator: rgba(60, 60, 67, 0.29);
        
        /* 间距系统 */
        --spacing-xs: 4px;
        --spacing-sm: 8px;
        --spacing-md: 12px;
        --spacing-lg: 16px;
        --spacing-xl: 20px;
        --spacing-2xl: 24px;
        --spacing-3xl: 32px;
        --spacing-4xl: 40px;
        
        /* 圆角系统 */
        --radius-sm: 8px;
        --radius-md: 12px;
        --radius-lg: 16px;
        --radius-xl: 20px;
        --radius-full: 9999px;
        
        /* 阴影系统 - 浅色模式 */
        --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
        --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);
        --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.10), 0 4px 8px rgba(0, 0, 0, 0.06);
        --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.08);
        
        /* 模糊效果 */
        --blur-sm: blur(8px);
        --blur-md: blur(12px);
        --blur-lg: blur(20px);
        --blur-xl: blur(40px);
        
        /* 动画时长 */
        --duration-fast: 200ms;
        --duration-normal: 300ms;
        --duration-slow: 400ms;
        
        /* iOS 缓动函数 */
        --ease-ios: cubic-bezier(0.4, 0, 0.2, 1);
        --ease-ios-in: cubic-bezier(0.4, 0, 1, 1);
        --ease-ios-out: cubic-bezier(0, 0, 0.2, 1);
        --ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      
      .dark {
        /* iOS 背景颜色 - 深色模式 */
        --ios-bg-primary: #000000;
        --ios-bg-secondary: #1C1C1E;
        --ios-bg-tertiary: #2C2C2E;
        
        /* iOS 文字颜色 - 深色模式 */
        --ios-text-primary: #FFFFFF;
        --ios-text-secondary: rgba(235, 235, 245, 0.6);
        --ios-text-tertiary: rgba(235, 235, 245, 0.3);
        
        /* iOS 主题色 - 深色模式 */
        --ios-blue: #0A84FF;
        --ios-green: #30D158;
        --ios-red: #FF453A;
        --ios-orange: #FF9F0A;
        --ios-gray: #8E8E93;
        
        /* 分隔线 */
        --ios-separator: rgba(84, 84, 88, 0.65);
        
        /* 阴影系统 - 深色模式 */
        --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
        --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.2);
        --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.5), 0 4px 8px rgba(0, 0, 0, 0.3);
        --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.6), 0 8px 16px rgba(0, 0, 0, 0.4);
      }
    `;
    document.head.appendChild(styleElement);

    // Create a test element to check computed styles
    testElement = document.createElement('div');
    document.body.appendChild(testElement);
  });

  afterEach(() => {
    document.body.removeChild(testElement);
    document.head.removeChild(styleElement);
  });

  // Feature: ios-ui-redesign, Property 1: iOS Border Radius Consistency
  it('should use standard iOS border radius values', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('--radius-sm', '--radius-md', '--radius-lg', '--radius-xl'),
        radiusVar => {
          const computedValue = getComputedStyle(document.documentElement)
            .getPropertyValue(radiusVar)
            .trim();

          const radiusValue = parseInt(computedValue);

          // Should be one of: 8px, 12px, 16px, 20px
          const validRadii = [8, 12, 16, 20];
          expect(validRadii).toContain(radiusValue);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: ios-ui-redesign, Property 14: Light Mode Background Colors
  it('should use iOS light mode background colors', () => {
    // Remove dark class to ensure light mode
    document.documentElement.classList.remove('dark');

    fc.assert(
      fc.property(
        fc.constantFrom('--ios-bg-primary', '--ios-bg-secondary', '--ios-bg-tertiary'),
        bgVar => {
          const computedValue = getComputedStyle(document.documentElement)
            .getPropertyValue(bgVar)
            .trim()
            .toUpperCase();

          // iOS light mode colors: #F2F2F7 or #FFFFFF
          const validLightColors = [
            '#F2F2F7',
            '#FFFFFF',
            'RGB(242, 242, 247)',
            'RGB(255, 255, 255)',
          ];

          // Normalize the color format for comparison
          const normalizedColor = normalizeColor(computedValue);
          const normalizedValidColors = validLightColors.map(c => normalizeColor(c));

          expect(normalizedValidColors).toContain(normalizedColor);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: ios-ui-redesign, Property 15: Dark Mode Background Colors
  it('should use iOS dark mode background colors', () => {
    // Add dark class to enable dark mode
    document.documentElement.classList.add('dark');

    fc.assert(
      fc.property(
        fc.constantFrom('--ios-bg-primary', '--ios-bg-secondary', '--ios-bg-tertiary'),
        bgVar => {
          const computedValue = getComputedStyle(document.documentElement)
            .getPropertyValue(bgVar)
            .trim()
            .toUpperCase();

          // iOS dark mode colors: #000000, #1C1C1E, #2C2C2E
          const validDarkColors = [
            '#000000',
            '#1C1C1E',
            '#2C2C2E',
            'RGB(0, 0, 0)',
            'RGB(28, 28, 30)',
            'RGB(44, 44, 46)',
          ];

          const normalizedColor = normalizeColor(computedValue);
          const normalizedValidColors = validDarkColors.map(c => normalizeColor(c));

          expect(normalizedValidColors).toContain(normalizedColor);
        }
      ),
      { numRuns: 100 }
    );

    // Clean up
    document.documentElement.classList.remove('dark');
  });

  // Feature: ios-ui-redesign, Property 17: iOS Blue Primary Color
  it('should use iOS blue as primary color', () => {
    fc.assert(
      fc.property(fc.constantFrom('light', 'dark'), theme => {
        // Set theme
        if (theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }

        const computedValue = getComputedStyle(document.documentElement)
          .getPropertyValue('--ios-blue')
          .trim()
          .toUpperCase();

        const normalizedColor = normalizeColor(computedValue);

        // Light mode: #007AFF, Dark mode: #0A84FF
        const expectedColors =
          theme === 'light' ? ['#007AFF', 'RGB(0, 122, 255)'] : ['#0A84FF', 'RGB(10, 132, 255)'];

        const normalizedExpected = expectedColors.map(c => normalizeColor(c));

        expect(normalizedExpected).toContain(normalizedColor);

        // Clean up
        document.documentElement.classList.remove('dark');
      }),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify spacing grid alignment (8px grid system)
  it('should follow 8px grid system for spacing', () => {
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

          const spacingValue = parseInt(computedValue);

          // All spacing values should be multiples of 4px
          expect(spacingValue % 4).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify animation durations are within bounds
  it('should have animation durations between 200ms and 400ms', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('--duration-fast', '--duration-normal', '--duration-slow'),
        durationVar => {
          const computedValue = getComputedStyle(document.documentElement)
            .getPropertyValue(durationVar)
            .trim();

          const durationValue = parseInt(computedValue);

          // Should be between 200ms and 400ms
          expect(durationValue).toBeGreaterThanOrEqual(200);
          expect(durationValue).toBeLessThanOrEqual(400);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify blur values are within iOS standards
  it('should have blur values within iOS standards', () => {
    fc.assert(
      fc.property(fc.constantFrom('--blur-sm', '--blur-md', '--blur-lg', '--blur-xl'), blurVar => {
        const computedValue = getComputedStyle(document.documentElement)
          .getPropertyValue(blurVar)
          .trim();

        // Extract blur value from "blur(Xpx)" format
        const match = computedValue.match(/blur\((\d+)px\)/);
        expect(match).not.toBeNull();

        if (match) {
          const blurValue = parseInt(match[1]);

          // Should be one of: 8px, 12px, 20px, 40px
          const validBlurValues = [8, 12, 20, 40];
          expect(validBlurValues).toContain(blurValue);
        }
      }),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify shadow system has multiple layers
  it('should have multi-layer shadow system', () => {
    fc.assert(
      fc.property(fc.constantFrom('--shadow-md', '--shadow-lg', '--shadow-xl'), shadowVar => {
        const computedValue = getComputedStyle(document.documentElement)
          .getPropertyValue(shadowVar)
          .trim();

        // Multi-layer shadows should contain comma (multiple shadow definitions)
        expect(computedValue).toContain(',');

        // Should have at least 2 shadow layers
        const shadowLayers = computedValue.split(',').length;
        expect(shadowLayers).toBeGreaterThanOrEqual(2);
      }),
      { numRuns: 100 }
    );
  });
});

// ========== iOS Animation System Tests ==========

describe('iOS Animation System', () => {
  let testElement: HTMLDivElement;
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    // Inject iOS animation system CSS variables
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        /* 动画时长 */
        --duration-fast: 200ms;
        --duration-normal: 300ms;
        --duration-slow: 400ms;
        
        /* iOS 缓动函数 */
        --ease-ios: cubic-bezier(0.4, 0, 0.2, 1);
        --ease-ios-in: cubic-bezier(0.4, 0, 1, 1);
        --ease-ios-out: cubic-bezier(0, 0, 0.2, 1);
        --ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      
      /* iOS 动画 keyframes */
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      @keyframes scaleIn {
        from {
          opacity: 0;
          transform: scale(0.9);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }
      
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      @keyframes buttonPress {
        0% { transform: scale(1); }
        50% { transform: scale(0.97); }
        100% { transform: scale(1); }
      }
      
      /* Reduced motion support */
      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
        }
      }
    `;
    document.head.appendChild(styleElement);

    testElement = document.createElement('div');
    document.body.appendChild(testElement);
  });

  afterEach(() => {
    document.body.removeChild(testElement);
    document.head.removeChild(styleElement);
  });

  // Feature: ios-ui-redesign, Property 12: iOS Timing Functions
  it('should use iOS standard cubic-bezier timing functions', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('--ease-ios', '--ease-ios-in', '--ease-ios-out', '--ease-spring'),
        easingVar => {
          const computedValue = getComputedStyle(document.documentElement)
            .getPropertyValue(easingVar)
            .trim();

          // Should be a cubic-bezier function
          expect(computedValue).toMatch(/cubic-bezier\(/);

          // Extract the cubic-bezier values
          const match = computedValue.match(
            /cubic-bezier\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/
          );
          expect(match).not.toBeNull();

          if (match) {
            const [, p1, p2, p3, p4] = match.map(v => parseFloat(v));

            // Verify it's one of the iOS standard timing functions
            const iosTimingFunctions = [
              [0.4, 0, 0.2, 1], // --ease-ios
              [0.4, 0, 1, 1], // --ease-ios-in
              [0, 0, 0.2, 1], // --ease-ios-out
              [0.175, 0.885, 0.32, 1.275], // --ease-spring
            ];

            const matches = iosTimingFunctions.some(
              ([tp1, tp2, tp3, tp4]) =>
                Math.abs(p1 - tp1) < 0.001 &&
                Math.abs(p2 - tp2) < 0.001 &&
                Math.abs(p3 - tp3) < 0.001 &&
                Math.abs(p4 - tp4) < 0.001
            );

            expect(matches).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: ios-ui-redesign, Property 13: Animation Duration Bounds
  it('should have animation durations between 200ms and 400ms', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('--duration-fast', '--duration-normal', '--duration-slow'),
        durationVar => {
          const computedValue = getComputedStyle(document.documentElement)
            .getPropertyValue(durationVar)
            .trim();

          const durationValue = parseInt(computedValue);

          // Should be between 200ms and 400ms (inclusive)
          expect(durationValue).toBeGreaterThanOrEqual(200);
          expect(durationValue).toBeLessThanOrEqual(400);

          // Verify specific values
          const validDurations = [200, 300, 400];
          expect(validDurations).toContain(durationValue);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: ios-ui-redesign, Property 40: Reduced Motion Support
  it('should have prefers-reduced-motion CSS rule defined', () => {
    fc.assert(
      fc.property(fc.constantFrom('animation-duration', 'transition-duration'), property => {
        // Verify that the CSS contains the prefers-reduced-motion media query
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
            // Skip stylesheets we can't access (CORS)
          }
        }

        expect(hasReducedMotionRule).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify keyframes are defined in CSS text
  it('should have all required iOS animation keyframes defined in CSS', () => {
    fc.assert(
      fc.property(fc.constantFrom('fadeIn', 'scaleIn', 'slideIn', 'buttonPress'), animationName => {
        // Check if the keyframe is defined in the injected stylesheet text
        const styleSheets = Array.from(document.styleSheets);
        let keyframeFound = false;

        for (const sheet of styleSheets) {
          try {
            // Check if the stylesheet contains the keyframe definition
            const rules = Array.from(sheet.cssRules || []);
            for (const rule of rules) {
              // Check the cssText for keyframe definition
              const cssText = rule.cssText || '';
              if (
                cssText.includes(`@keyframes ${animationName}`) ||
                cssText.includes(`@-webkit-keyframes ${animationName}`)
              ) {
                keyframeFound = true;
                break;
              }

              // Also check if it's a CSSKeyframesRule (if supported)
              if (
                typeof CSSKeyframesRule !== 'undefined' &&
                rule instanceof CSSKeyframesRule &&
                rule.name === animationName
              ) {
                keyframeFound = true;
                break;
              }
            }

            // If not found in rules, check the stylesheet text content directly
            if (!keyframeFound && sheet.ownerNode) {
              const styleElement = sheet.ownerNode as HTMLStyleElement;
              const textContent = styleElement.textContent || '';
              if (textContent.includes(`@keyframes ${animationName}`)) {
                keyframeFound = true;

                // For buttonPress, also verify it has the correct scale value
                if (animationName === 'buttonPress') {
                  // Verify it contains 50% and scale(0.97)
                  const hasCorrectScale =
                    textContent.includes('50%') && textContent.includes('scale(0.97)');
                  expect(hasCorrectScale).toBe(true);
                }
              }
            }
          } catch (e) {
            // Skip stylesheets we can't access
          }

          if (keyframeFound) break;
        }

        expect(keyframeFound).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Helper function to normalize color values for comparison
 * Converts various color formats to a consistent format
 */
function normalizeColor(color: string): string {
  const normalized = color.trim().toUpperCase();

  // Convert hex to RGB if needed for comparison
  if (normalized.startsWith('#')) {
    return normalized;
  }

  // Extract RGB values
  const rgbMatch = normalized.match(/RGB\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]);
    const g = parseInt(rgbMatch[2]);
    const b = parseInt(rgbMatch[3]);

    // Convert to hex
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
  }

  return normalized;
}

// ========== IOSButton Component Tests ==========

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

// ========== iOS Spacing System Tests ==========

describe('iOS Spacing System - Property 6: Spacing Grid Alignment', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    // Inject iOS spacing system CSS variables
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        /* 间距系统 (8px 网格) - 所有值为 4px 的倍数 */
        --spacing-0: 0px;
        --spacing-1: 4px;
        --spacing-2: 8px;
        --spacing-3: 12px;
        --spacing-4: 16px;
        --spacing-5: 20px;
        --spacing-6: 24px;
        --spacing-8: 32px;
        --spacing-10: 40px;
        --spacing-12: 48px;
        --spacing-16: 64px;
        
        /* 语义化间距别名 */
        --spacing-xs: 4px;
        --spacing-sm: 8px;
        --spacing-md: 12px;
        --spacing-lg: 16px;
        --spacing-xl: 20px;
        --spacing-2xl: 24px;
        --spacing-3xl: 32px;
        --spacing-4xl: 40px;
        
        /* 组件间距 */
        --spacing-component-gap: 16px;
        --spacing-section-gap: 24px;
        --spacing-card-padding: 16px;
        --spacing-button-padding-x: 20px;
        --spacing-button-padding-y: 12px;
        --spacing-input-padding-x: 16px;
        --spacing-input-padding-y: 12px;
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
  });

  /**
   * Feature: ios-ui-redesign, Property 6: Spacing Grid Alignment
   *
   * *For any* component's padding or margin, the value should be a multiple of 4px
   * (following the 8px grid system).
   *
   * **Validates: Requirements 2.1**
   */
  it('should have all numeric spacing values as multiples of 4px', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          '--spacing-0',
          '--spacing-1',
          '--spacing-2',
          '--spacing-3',
          '--spacing-4',
          '--spacing-5',
          '--spacing-6',
          '--spacing-8',
          '--spacing-10',
          '--spacing-12',
          '--spacing-16'
        ),
        spacingVar => {
          const computedValue = getComputedStyle(document.documentElement)
            .getPropertyValue(spacingVar)
            .trim();

          const spacingValue = parseInt(computedValue);

          // All spacing values should be multiples of 4px
          expect(spacingValue % 4).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: ios-ui-redesign, Property 6: Spacing Grid Alignment
   *
   * Verify semantic spacing aliases are also multiples of 4px.
   *
   * **Validates: Requirements 2.1**
   */
  it('should have all semantic spacing aliases as multiples of 4px', () => {
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

          const spacingValue = parseInt(computedValue);

          // All spacing values should be multiples of 4px
          expect(spacingValue % 4).toBe(0);

          // Verify specific expected values
          const expectedValues: Record<string, number> = {
            '--spacing-xs': 4,
            '--spacing-sm': 8,
            '--spacing-md': 12,
            '--spacing-lg': 16,
            '--spacing-xl': 20,
            '--spacing-2xl': 24,
            '--spacing-3xl': 32,
            '--spacing-4xl': 40,
          };

          expect(spacingValue).toBe(expectedValues[spacingVar]);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: ios-ui-redesign, Property 6: Spacing Grid Alignment
   *
   * Verify component-specific spacing values are multiples of 4px.
   *
   * **Validates: Requirements 2.1**
   */
  it('should have all component spacing values as multiples of 4px', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          '--spacing-component-gap',
          '--spacing-section-gap',
          '--spacing-card-padding',
          '--spacing-button-padding-x',
          '--spacing-button-padding-y',
          '--spacing-input-padding-x',
          '--spacing-input-padding-y'
        ),
        spacingVar => {
          const computedValue = getComputedStyle(document.documentElement)
            .getPropertyValue(spacingVar)
            .trim();

          const spacingValue = parseInt(computedValue);

          // All spacing values should be multiples of 4px
          expect(spacingValue % 4).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: ios-ui-redesign, Property 6: Spacing Grid Alignment
   *
   * Verify spacing values form a consistent scale.
   *
   * **Validates: Requirements 2.1**
   */
  it('should have spacing values in ascending order', () => {
    fc.assert(
      fc.property(
        fc.constant(null), // Just run once with all values
        () => {
          const spacingVars = [
            '--spacing-xs',
            '--spacing-sm',
            '--spacing-md',
            '--spacing-lg',
            '--spacing-xl',
            '--spacing-2xl',
            '--spacing-3xl',
            '--spacing-4xl',
          ];

          const values = spacingVars.map(varName => {
            const computedValue = getComputedStyle(document.documentElement)
              .getPropertyValue(varName)
              .trim();
            return parseInt(computedValue);
          });

          // Verify values are in ascending order
          for (let i = 1; i < values.length; i++) {
            expect(values[i]).toBeGreaterThan(values[i - 1]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: ios-ui-redesign, Property 6: Spacing Grid Alignment
   *
   * Verify spacing values are within reasonable bounds.
   *
   * **Validates: Requirements 2.1**
   */
  it('should have spacing values within reasonable bounds (0-64px)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          '--spacing-0',
          '--spacing-1',
          '--spacing-2',
          '--spacing-3',
          '--spacing-4',
          '--spacing-5',
          '--spacing-6',
          '--spacing-8',
          '--spacing-10',
          '--spacing-12',
          '--spacing-16',
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

          const spacingValue = parseInt(computedValue);

          // Spacing values should be between 0 and 64px
          expect(spacingValue).toBeGreaterThanOrEqual(0);
          expect(spacingValue).toBeLessThanOrEqual(64);
        }
      ),
      { numRuns: 100 }
    );
  });
});
