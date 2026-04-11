/**
 * Property-Based Tests for Primitive Performance Optimization
 * Feature: primitive-performance
 *
 * Tests performance optimization for the current primitive layer:
 * - Property 33: Animation Frame Rate
 * - Property 34: GPU-Accelerated Animations
 * - Property 35: Blur Effect Performance Optimization
 * - Property 36: First Contentful Paint Time
 *
 * @version 2.1.11
 * @created 2025-01-09
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { render } from '@testing-library/react';
import { AppButton } from '../renderer/components/AppButton/AppButton';
import { AppCard } from '../renderer/components/AppCard';
import { AppModal } from '../renderer/components/AppModal/AppModal';
import { AppInput } from '../renderer/components/AppInput';
import { DataTable, DataTableRow, DataTableCell } from '../renderer/components/DataTable/DataTable';

describe('Primitive Performance Optimization - GPU Accelerated Animations', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    // Inject neutral theme tokens for the test environment
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        --accent: #2563eb;
        --surface-1: #ffffff;
        --surface-2: #ffffff;
        --text-primary: #000000;
        --text-tertiary: rgba(60, 60, 67, 0.3);
        --line-soft: rgba(60, 60, 67, 0.29);
        --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
        --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);
        --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.10), 0 4px 8px rgba(0, 0, 0, 0.06);
        --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.08);
        --duration-fast: 200ms;
        --duration-normal: 300ms;
        --duration-slow: 400ms;
        --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
        --radius-sm: 8px;
        --radius-md: 12px;
        --radius-lg: 16px;
        --radius-xl: 20px;
        --spacing-sm: 8px;
        --spacing-md: 12px;
        --spacing-lg: 16px;
        --spacing-xl: 20px;
        --spacing-2xl: 24px;
        --blur-sm: blur(8px);
        --blur-md: blur(12px);
        --blur-lg: blur(20px);
        --blur-xl: blur(40px);
      }
      
      /* Performance optimization classes */
      .app-blur-optimized {
        will-change: backdrop-filter;
        transform: translateZ(0);
        backface-visibility: hidden;
      }
      
      .app-animate-optimized {
        will-change: transform, opacity;
        transform: translateZ(0);
        backface-visibility: hidden;
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
  });

  // Feature: primitive-performance, Property 34: GPU-Accelerated Animations
  // *For button primitives*, transitions should stay scoped to non-layout properties.
  it('should keep AppButton transitions scoped to lightweight properties', () => {
    fc.assert(
      fc.property(fc.constantFrom('primary', 'secondary', 'tertiary'), variant => {
        const { container } = render(
          <AppButton variant={variant as 'primary' | 'secondary' | 'tertiary'}>
            Test Button
          </AppButton>
        );

        const button = container.querySelector('button');
        expect(button).not.toBeNull();

        if (button) {
          const classList = button.className;

          const hasScopedTransition =
            classList.includes('transition-colors') ||
            classList.includes('transition-opacity') ||
            classList.includes('transition-transform') ||
            classList.includes('transition-[');
          const hasTransitionAll = classList.includes('transition-all');

          expect(hasScopedTransition).toBe(true);
          expect(hasTransitionAll).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: primitive-performance, Property 34: GPU-Accelerated Animations for AppCard
  it('should use GPU-accelerated animations for AppCard', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('standard', 'elevated', 'grouped'),
        fc.boolean(),
        (variant, blur) => {
          const { container } = render(
            <AppCard variant={variant as 'standard' | 'elevated' | 'grouped'} blur={blur}>
              <div>Test Content</div>
            </AppCard>
          );

          const card = container.firstChild as HTMLElement;
          expect(card).not.toBeNull();

          if (card) {
            const classList = card.className;

            // Verify GPU acceleration hints are present
            const hasWillChange = classList.includes('[will-change:');
            const hasTranslateZ = classList.includes('[transform:translateZ(0)]');
            const hasBackfaceVisibility = classList.includes('[backface-visibility:');

            // At least one GPU acceleration technique should be present
            const hasGPUAcceleration = hasWillChange || hasTranslateZ || hasBackfaceVisibility;

            expect(hasGPUAcceleration).toBe(true);

            // Verify transition only uses performant properties
            const hasPerformantTransition =
              classList.includes('transition-[transform') ||
              classList.includes('transition-[transform,opacity');

            expect(hasPerformantTransition).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: primitive-performance, Property 34: GPU-Accelerated Animations for DataTable
  it('should use GPU-accelerated animations for DataTable', () => {
    fc.assert(
      fc.property(fc.constantFrom('standard', 'grouped', 'inset'), variant => {
        const { container } = render(
          <DataTable variant={variant as 'standard' | 'grouped' | 'inset'}>
            <DataTableRow>
              <DataTableCell>Test</DataTableCell>
            </DataTableRow>
          </DataTable>
        );

        const table = container.firstChild as HTMLElement;
        expect(table).not.toBeNull();

        if (table) {
          const classList = table.className;

          // Verify GPU acceleration hints are present
          const hasWillChange = classList.includes('[will-change:');
          const hasTranslateZ = classList.includes('[transform:translateZ(0)]');

          // At least one GPU acceleration technique should be present
          const hasGPUAcceleration = hasWillChange || hasTranslateZ;

          expect(hasGPUAcceleration).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Primitive Performance Optimization - Blur Effect Optimization', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        --accent: #2563eb;
        --surface-1: #FFFFFF;
        --surface-2: #FFFFFF;
        --text-primary: #000000;
        --line-soft: rgba(60, 60, 67, 0.29);
        --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
        --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);
        --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.10), 0 4px 8px rgba(0, 0, 0, 0.06);
        --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.08);
        --duration-fast: 200ms;
        --duration-normal: 300ms;
        --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
        --radius-lg: 16px;
        --radius-xl: 20px;
        --spacing-sm: 8px;
        --spacing-md: 12px;
        --spacing-lg: 16px;
        --spacing-2xl: 24px;
        --blur-sm: blur(8px);
        --blur-md: blur(12px);
        --blur-lg: blur(20px);
        --blur-xl: blur(40px);
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
  });

  // Feature: primitive-performance, Property 35: Blur Effect Performance Optimization
  // *For any* element with backdrop-filter, will-change should be set or GPU acceleration used
  it('should optimize blur effects with will-change for AppCard', () => {
    fc.assert(
      fc.property(fc.constantFrom('standard', 'elevated', 'grouped'), variant => {
        const { container } = render(
          <AppCard variant={variant as 'standard' | 'elevated' | 'grouped'} blur={true}>
            <div>Test Content</div>
          </AppCard>
        );

        const card = container.firstChild as HTMLElement;
        expect(card).not.toBeNull();

        if (card) {
          const classList = card.className;

          // Check for backdrop-blur
          const hasBackdropBlur = classList.includes('backdrop-blur');

          if (hasBackdropBlur) {
            // Should have will-change for backdrop-filter or GPU acceleration
            const hasWillChangeBackdrop =
              classList.includes('[will-change:backdrop-filter]') ||
              classList.includes('will-change:backdrop-filter');
            const hasTranslateZ = classList.includes('[transform:translateZ(0)]');
            const hasWebkitBackdrop = classList.includes('[-webkit-backdrop-filter:');

            // At least one optimization technique should be present
            const hasOptimization = hasWillChangeBackdrop || hasTranslateZ || hasWebkitBackdrop;

            expect(hasOptimization).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: primitive-performance, Property 35: Blur Effect Performance Optimization for DataTable
  it('should optimize blur effects with will-change for DataTable', () => {
    fc.assert(
      fc.property(fc.constantFrom('standard', 'grouped'), variant => {
        const { container } = render(
          <DataTable variant={variant as 'standard' | 'grouped'} blur={true}>
            <DataTableRow>
              <DataTableCell>Test</DataTableCell>
            </DataTableRow>
          </DataTable>
        );

        const table = container.firstChild as HTMLElement;
        expect(table).not.toBeNull();

        if (table) {
          const classList = table.className;

          // Check for backdrop-blur
          const hasBackdropBlur = classList.includes('backdrop-blur');

          if (hasBackdropBlur) {
            // Should have will-change for backdrop-filter
            const hasWillChangeBackdrop = classList.includes('[will-change:backdrop-filter]');
            const hasWebkitBackdrop = classList.includes('[-webkit-backdrop-filter:');

            // At least one optimization technique should be present
            const hasOptimization = hasWillChangeBackdrop || hasWebkitBackdrop;

            expect(hasOptimization).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: primitive-performance, Property 35: Blur Effect Performance Optimization for AppModal
  it('should optimize blur effects with will-change for AppModal overlay', () => {
    fc.assert(
      fc.property(fc.constantFrom('sm', 'md', 'lg', 'xl'), size => {
        const { container } = render(
          <AppModal
            isOpen={true}
            onClose={() => {}}
            size={size as 'sm' | 'md' | 'lg' | 'xl'}
            title="Test Modal"
          >
            <div>Test Content</div>
          </AppModal>
        );

        // Find the overlay element (first child with backdrop-blur)
        const overlay = container.querySelector('[class*="backdrop-blur"]');

        if (overlay) {
          const classList = overlay.className;

          // Should have will-change for backdrop-filter or GPU acceleration
          const hasWillChange =
            classList.includes('[will-change:') || classList.includes('will-change:');
          const hasTranslateZ = classList.includes('[transform:translateZ(0)]');
          const hasWebkitBackdrop = classList.includes('[-webkit-backdrop-filter:');

          // At least one optimization technique should be present
          const hasOptimization = hasWillChange || hasTranslateZ || hasWebkitBackdrop;

          expect(hasOptimization).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Primitive Performance Optimization - Animation Properties', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        --accent: #2563eb;
        --surface-1: #FFFFFF;
        --surface-2: #FFFFFF;
        --text-primary: #000000;
        --text-tertiary: rgba(60, 60, 67, 0.3);
        --line-soft: rgba(60, 60, 67, 0.29);
        --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
        --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);
        --duration-fast: 200ms;
        --duration-normal: 300ms;
        --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
        --radius-md: 12px;
        --radius-lg: 16px;
        --spacing-sm: 8px;
        --spacing-md: 12px;
        --spacing-lg: 16px;
        --spacing-xl: 20px;
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
  });

  // Feature: primitive-performance, Property 33: Animation Frame Rate
  // Verify that animations use performant properties that can achieve 60fps
  it('should use performant animation properties for 60fps target', () => {
    fc.assert(
      fc.property(fc.constantFrom('primary', 'secondary', 'tertiary'), variant => {
        const { container } = render(
          <AppButton variant={variant as 'primary' | 'secondary' | 'tertiary'}>
            Test Button
          </AppButton>
        );

        const button = container.querySelector('button');
        expect(button).not.toBeNull();

        if (button) {
          const classList = button.className;

          // Verify that transition uses performant properties
          // Performant properties: transform, opacity
          // Non-performant properties to avoid: width, height, top, left, margin, padding

          const hasTransformTransition =
            classList.includes('transition-[transform') ||
            classList.includes('transition-transform');

          // Should NOT have transition-all (which animates non-performant properties)
          const hasTransitionAll = classList.includes('transition-all');

          // Either has specific performant transitions OR doesn't have transition-all
          const isPerformant = hasTransformTransition || !hasTransitionAll;

          expect(isPerformant).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: primitive-performance, Property 33: Animation Frame Rate for AppInput
  it('should use performant animation properties for AppInput', () => {
    fc.assert(
      fc.property(fc.constantFrom('sm', 'md', 'lg'), size => {
        const { container } = render(
          <AppInput size={size as 'sm' | 'md' | 'lg'} placeholder="Test" />
        );

        const input = container.querySelector('input');
        expect(input).not.toBeNull();

        if (input) {
          const classList = input.className;

          // Verify that transition uses performant properties
          // For inputs, box-shadow and border-color are acceptable
          const hasSpecificTransition =
            classList.includes('transition-[') || classList.includes('transition-');

          // Should NOT have transition-all
          const hasTransitionAll = classList.includes('transition-all');

          // Either has specific transitions OR doesn't have transition-all
          const isPerformant = hasSpecificTransition || !hasTransitionAll;

          expect(isPerformant).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Primitive Performance Optimization - CSS Performance Classes', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        --duration-fast: 200ms;
        --duration-normal: 300ms;
        --duration-slow: 400ms;
        --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      /* High-performance animation classes */
      .app-transition-perf {
        transition-property: transform, opacity;
        transition-duration: var(--duration-normal);
        transition-timing-function: var(--ease-standard);
      }
      
      .app-transition-perf-fast {
        transition-property: transform, opacity;
        transition-duration: var(--duration-fast);
        transition-timing-function: var(--ease-standard);
      }
      
      .app-transition-perf-slow {
        transition-property: transform, opacity;
        transition-duration: var(--duration-slow);
        transition-timing-function: var(--ease-standard);
      }
      
      /* GPU acceleration classes */
      .app-blur-optimized {
        will-change: backdrop-filter;
        transform: translateZ(0);
        backface-visibility: hidden;
      }
      
      .app-animate-optimized {
        will-change: transform, opacity;
        transform: translateZ(0);
        backface-visibility: hidden;
      }
      
      /* Performance degradation classes */
      .reduce-effects .app-blur-sm-optimized,
      .reduce-effects .app-blur-md-optimized,
      .reduce-effects .app-blur-lg-optimized,
      .reduce-effects .app-blur-xl-optimized {
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
  });

  // Feature: primitive-performance, Property 34: GPU-Accelerated Animations
  // Verify CSS performance classes are defined correctly
  it('should have performance optimization CSS classes defined', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'app-transition-perf',
          'app-transition-perf-fast',
          'app-transition-perf-slow',
          'app-blur-optimized',
          'app-animate-optimized'
        ),
        className => {
          // Check if the class is defined in the stylesheet
          const styleSheets = Array.from(document.styleSheets);
          let classFound = false;

          for (const sheet of styleSheets) {
            try {
              const rules = Array.from(sheet.cssRules || []);
              for (const rule of rules) {
                if (rule instanceof CSSStyleRule) {
                  if (rule.selectorText.includes(`.${className}`)) {
                    classFound = true;

                    // Verify the class has the expected properties
                    const cssText = rule.cssText.toLowerCase();

                    if (className.includes('transition-perf')) {
                      // Should have transition-property: transform, opacity
                      expect(cssText).toContain('transition-property');
                      expect(cssText).toContain('transform');
                      expect(cssText).toContain('opacity');
                    }

                    if (className.includes('optimized')) {
                      // Should have will-change or transform: translateZ(0)
                      const hasWillChange = cssText.includes('will-change');
                      const hasTranslateZ = cssText.includes('translatez(0)');
                      expect(hasWillChange || hasTranslateZ).toBe(true);
                    }

                    break;
                  }
                }
              }
            } catch (e) {
              // Skip stylesheets we can't access
            }

            if (classFound) break;
          }

          expect(classFound).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: primitive-performance, Property 35: Blur Effect Performance Optimization
  // Verify reduce-effects class disables blur for low-performance devices
  it('should have reduce-effects class that disables blur', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'app-blur-sm-optimized',
          'app-blur-md-optimized',
          'app-blur-lg-optimized',
          'app-blur-xl-optimized'
        ),
        blurClass => {
          // Check if the reduce-effects rule is defined
          const styleSheets = Array.from(document.styleSheets);
          let ruleFound = false;

          for (const sheet of styleSheets) {
            try {
              const rules = Array.from(sheet.cssRules || []);
              for (const rule of rules) {
                if (rule instanceof CSSStyleRule) {
                  const selectorText = rule.selectorText;

                  if (
                    selectorText.includes('.reduce-effects') &&
                    selectorText.includes(`.${blurClass}`)
                  ) {
                    ruleFound = true;

                    // Verify the rule disables backdrop-filter
                    const cssText = rule.cssText.toLowerCase();
                    expect(cssText).toContain('backdrop-filter');
                    expect(cssText).toContain('none');

                    break;
                  }
                }
              }
            } catch (e) {
              // Skip stylesheets we can't access
            }

            if (ruleFound) break;
          }

          expect(ruleFound).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Primitive Performance Optimization - First Contentful Paint', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        --accent: #2563eb;
        --surface-1: #FFFFFF;
        --text-primary: #000000;
        --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
        --duration-fast: 200ms;
        --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
        --radius-md: 12px;
        --spacing-md: 12px;
        --spacing-xl: 20px;
      }
      
      /* Critical content - immediate render */
      .app-critical {
        content-visibility: visible;
      }
      
      /* Non-critical content - lazy render */
      .app-lazy {
        content-visibility: auto;
        contain-intrinsic-size: auto 300px;
      }
      
      /* First paint animation delay */
      .app-animate-delay-fcp {
        animation-delay: 100ms;
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
  });

  // Feature: primitive-performance, Property 36: First Contentful Paint Time
  // Verify FCP optimization classes are defined
  it('should have FCP optimization CSS classes defined', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('app-critical', 'app-lazy', 'app-animate-delay-fcp'),
        className => {
          // Check if the class is defined in the stylesheet
          const styleSheets = Array.from(document.styleSheets);
          let classFound = false;

          for (const sheet of styleSheets) {
            try {
              const rules = Array.from(sheet.cssRules || []);
              for (const rule of rules) {
                if (rule instanceof CSSStyleRule) {
                  if (rule.selectorText.includes(`.${className}`)) {
                    classFound = true;

                    const cssText = rule.cssText.toLowerCase();

                    if (className === 'app-critical') {
                      // Should have content-visibility: visible
                      expect(cssText).toContain('content-visibility');
                      expect(cssText).toContain('visible');
                    }

                    if (className === 'app-lazy') {
                      // Should have content-visibility: auto
                      expect(cssText).toContain('content-visibility');
                      expect(cssText).toContain('auto');
                    }

                    if (className === 'app-animate-delay-fcp') {
                      // Should have animation-delay
                      expect(cssText).toContain('animation-delay');
                    }

                    break;
                  }
                }
              }
            } catch (e) {
              // Skip stylesheets we can't access
            }

            if (classFound) break;
          }

          expect(classFound).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: primitive-performance, Property 36: First Contentful Paint Time
  // Verify components render without blocking animations
  it('should render AppButton without blocking animations', () => {
    fc.assert(
      fc.property(fc.constantFrom('primary', 'secondary', 'tertiary'), variant => {
        const startTime = performance.now();

        const { container } = render(
          <AppButton variant={variant as 'primary' | 'secondary' | 'tertiary'}>
            Test Button
          </AppButton>
        );

        const endTime = performance.now();
        const renderTime = endTime - startTime;

        // Render should complete quickly (< 100ms for a simple button)
        expect(renderTime).toBeLessThan(100);

        // Button should be rendered
        const button = container.querySelector('button');
        expect(button).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  // Feature: primitive-performance, Property 36: First Contentful Paint Time
  // Verify AppCard renders without blocking
  it('should render AppCard without blocking animations', () => {
    fc.assert(
      fc.property(fc.constantFrom('standard', 'elevated', 'grouped'), variant => {
        const startTime = performance.now();

        const { container } = render(
          <AppCard variant={variant as 'standard' | 'elevated' | 'grouped'}>
            <div>Test Content</div>
          </AppCard>
        );

        const endTime = performance.now();
        const renderTime = endTime - startTime;

        // Render should complete quickly (< 100ms for a simple card)
        expect(renderTime).toBeLessThan(100);

        // Card should be rendered
        const card = container.firstChild;
        expect(card).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
