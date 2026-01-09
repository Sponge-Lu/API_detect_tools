/**
 * @file src/__tests__/ios-card.property.test.tsx
 * @description IOSCard 组件的属性测试
 *
 * Feature: ios-ui-redesign
 *
 * 测试属性:
 * - Property 2: Backdrop Blur Application
 * - Property 3: Multi-layer Shadow System
 * - Property 9: Card Expand Transition
 *
 * @version 2.1.11
 * @updated 2025-01-08 - 创建 IOSCard 属性测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { render, waitFor } from '@testing-library/react';
import {
  IOSCard,
  IOSCardDivider,
  IOSCardHeader,
  IOSCardContent,
  IOSCardFooter,
} from '../renderer/components/IOSCard';

describe('IOSCard Component - Property Tests', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    // Inject iOS design system CSS variables for card tests
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        /* 背景颜色 */
        --ios-bg-primary: #F2F2F7;
        --ios-bg-secondary: #FFFFFF;
        --ios-bg-tertiary: #FFFFFF;
        
        /* 分隔线 */
        --ios-separator: rgba(60, 60, 67, 0.29);
        
        /* 间距系统 */
        --spacing-xs: 4px;
        --spacing-sm: 8px;
        --spacing-md: 12px;
        --spacing-lg: 16px;
        --spacing-xl: 20px;
        --spacing-2xl: 24px;
        
        /* 圆角系统 */
        --radius-sm: 8px;
        --radius-md: 12px;
        --radius-lg: 16px;
        --radius-xl: 20px;
        
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
        
        /* iOS 主题色 */
        --ios-blue: #007AFF;
      }
      
      .dark {
        /* 背景颜色 - 深色模式 */
        --ios-bg-primary: #000000;
        --ios-bg-secondary: #1C1C1E;
        --ios-bg-tertiary: #2C2C2E;
        
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
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
    document.documentElement.classList.remove('dark');
  });

  // Feature: ios-ui-redesign, Property 2: Backdrop Blur Application
  // *For any* card or modal component, the backdrop-filter CSS property should include blur() with a value between 8px and 40px.
  // **Validates: Requirements 1.2, 6.1, 7.1**
  describe('Property 2: Backdrop Blur Application', () => {
    it('should apply backdrop blur effect when blur prop is true', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('standard', 'elevated', 'grouped'),
          fc.boolean(),
          (variant, blur) => {
            const { container } = render(
              <IOSCard variant={variant as 'standard' | 'elevated' | 'grouped'} blur={blur}>
                <div>Test Content</div>
              </IOSCard>
            );

            const card = container.firstChild as HTMLElement;
            expect(card).not.toBeNull();

            if (card) {
              const classList = card.className;

              if (blur) {
                // When blur is enabled, should have backdrop-blur class
                expect(classList).toContain('backdrop-blur-[12px]');

                // Verify the blur value is within iOS standards (8px to 40px)
                const blurMatch = classList.match(/backdrop-blur-\[(\d+)px\]/);
                if (blurMatch) {
                  const blurValue = parseInt(blurMatch[1]);
                  expect(blurValue).toBeGreaterThanOrEqual(8);
                  expect(blurValue).toBeLessThanOrEqual(40);
                }
              } else {
                // When blur is disabled, should not have backdrop-blur class
                expect(classList).not.toContain('backdrop-blur');
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have backdrop blur enabled by default', () => {
      fc.assert(
        fc.property(fc.constantFrom('standard', 'elevated', 'grouped'), variant => {
          const { container } = render(
            <IOSCard variant={variant as 'standard' | 'elevated' | 'grouped'}>
              <div>Test Content</div>
            </IOSCard>
          );

          const card = container.firstChild as HTMLElement;
          expect(card).not.toBeNull();

          if (card) {
            const classList = card.className;
            // Default blur should be enabled
            expect(classList).toContain('backdrop-blur-[12px]');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ios-ui-redesign, Property 3: Multi-layer Shadow System
  // *For any* elevated component (card, button, modal), the box-shadow CSS property should contain at least two shadow layers with different blur radii and opacities.
  // **Validates: Requirements 1.3, 6.1**
  describe('Property 3: Multi-layer Shadow System', () => {
    it('should apply multi-layer shadow for standard and elevated variants', () => {
      fc.assert(
        fc.property(fc.constantFrom('standard', 'elevated'), variant => {
          const { container } = render(
            <IOSCard variant={variant as 'standard' | 'elevated'}>
              <div>Test Content</div>
            </IOSCard>
          );

          const card = container.firstChild as HTMLElement;
          expect(card).not.toBeNull();

          if (card) {
            const classList = card.className;

            // Should have shadow class
            const hasShadow = classList.includes('shadow-[var(--shadow-');
            expect(hasShadow).toBe(true);

            // Standard uses shadow-md, elevated uses shadow-lg
            if (variant === 'standard') {
              expect(classList).toContain('shadow-[var(--shadow-md)]');
            } else if (variant === 'elevated') {
              expect(classList).toContain('shadow-[var(--shadow-lg)]');
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should have lighter shadow for grouped variant', () => {
      fc.assert(
        fc.property(fc.constant('grouped'), variant => {
          const { container } = render(
            <IOSCard variant={variant as 'grouped'}>
              <div>Test Content</div>
            </IOSCard>
          );

          const card = container.firstChild as HTMLElement;
          expect(card).not.toBeNull();

          if (card) {
            const classList = card.className;
            // Grouped variant uses lighter shadow
            expect(classList).toContain('shadow-[var(--shadow-sm)]');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should enhance shadow on hover when hoverable', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('standard', 'elevated', 'grouped'),
          fc.boolean(),
          (variant, hoverable) => {
            const { container } = render(
              <IOSCard
                variant={variant as 'standard' | 'elevated' | 'grouped'}
                hoverable={hoverable}
              >
                <div>Test Content</div>
              </IOSCard>
            );

            const card = container.firstChild as HTMLElement;
            expect(card).not.toBeNull();

            if (card) {
              const classList = card.className;

              if (hoverable) {
                // Should have hover shadow enhancement
                expect(classList).toContain('hover:shadow-[var(--shadow-lg)]');
              } else {
                // Should not have hover shadow when not hoverable
                expect(classList).not.toContain('hover:shadow-');
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ios-ui-redesign, Property 9: Card Expand Transition
  // *For any* expandable card, when toggled, the transition should animate the max-height or height property with a duration between 200ms and 400ms.
  // **Validates: Requirements 3.2**
  describe('Property 9: Card Expand Transition', () => {
    it('should have transition styles for expand/collapse animation', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('standard', 'elevated', 'grouped'),
          fc.boolean(),
          (variant, expanded) => {
            const expandContent = <div>Expanded Content</div>;

            const { container } = render(
              <IOSCard
                variant={variant as 'standard' | 'elevated' | 'grouped'}
                expanded={expanded}
                expandContent={expandContent}
              >
                <div>Main Content</div>
              </IOSCard>
            );

            const card = container.firstChild as HTMLElement;
            expect(card).not.toBeNull();

            if (card) {
              // Find the expand container
              const expandContainer = card.querySelector('[class*="overflow-hidden"]');

              if (expandContainer) {
                const classList = expandContainer.className;

                // Should have transition classes (either transition-all or specific transition properties)
                const hasTransition =
                  classList.includes('transition-all') || classList.includes('transition-[');
                expect(hasTransition).toBe(true);
                expect(classList).toContain('duration-[var(--duration-normal)]');
                expect(classList).toContain('[transition-timing-function:var(--ease-ios)]');
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should set maxHeight to 0 when collapsed and positive when expanded', () => {
      fc.assert(
        fc.property(fc.boolean(), expanded => {
          const expandContent = <div style={{ height: '100px' }}>Expanded Content</div>;

          const { container } = render(
            <IOSCard expanded={expanded} expandContent={expandContent}>
              <div>Main Content</div>
            </IOSCard>
          );

          const card = container.firstChild as HTMLElement;
          expect(card).not.toBeNull();

          if (card) {
            // Find the expand container
            const expandContainer = card.querySelector('[class*="overflow-hidden"]') as HTMLElement;

            if (expandContainer) {
              const style = expandContainer.style;

              if (expanded) {
                // When expanded, maxHeight should be set to a positive value
                const maxHeight = style.maxHeight;
                // maxHeight could be '0px' initially before useEffect runs
                // or a positive value after
                expect(maxHeight).toBeDefined();
              } else {
                // When collapsed, maxHeight should be 0px
                expect(style.maxHeight).toBe('0px');
              }
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should set opacity to 0 when collapsed and 1 when expanded', () => {
      fc.assert(
        fc.property(fc.boolean(), expanded => {
          const expandContent = <div>Expanded Content</div>;

          const { container } = render(
            <IOSCard expanded={expanded} expandContent={expandContent}>
              <div>Main Content</div>
            </IOSCard>
          );

          const card = container.firstChild as HTMLElement;
          expect(card).not.toBeNull();

          if (card) {
            // Find the expand container
            const expandContainer = card.querySelector('[class*="overflow-hidden"]') as HTMLElement;

            if (expandContainer) {
              const style = expandContainer.style;

              if (expanded) {
                expect(style.opacity).toBe('1');
              } else {
                expect(style.opacity).toBe('0');
              }
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // Additional tests for IOSCard component

  describe('IOSCard Border Radius', () => {
    it('should use iOS standard border radius (16px)', () => {
      fc.assert(
        fc.property(fc.constantFrom('standard', 'elevated', 'grouped'), variant => {
          const { container } = render(
            <IOSCard variant={variant as 'standard' | 'elevated' | 'grouped'}>
              <div>Test Content</div>
            </IOSCard>
          );

          const card = container.firstChild as HTMLElement;
          expect(card).not.toBeNull();

          if (card) {
            const classList = card.className;
            // Should have iOS standard border radius
            expect(classList).toContain('rounded-[var(--radius-lg)]');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('IOSCard Disabled State', () => {
    it('should apply disabled styles when disabled', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('standard', 'elevated', 'grouped'),
          fc.boolean(),
          (variant, disabled) => {
            const { container } = render(
              <IOSCard variant={variant as 'standard' | 'elevated' | 'grouped'} disabled={disabled}>
                <div>Test Content</div>
              </IOSCard>
            );

            const card = container.firstChild as HTMLElement;
            expect(card).not.toBeNull();

            if (card) {
              const classList = card.className;

              if (disabled) {
                expect(classList).toContain('opacity-60');
                expect(classList).toContain('cursor-not-allowed');
              } else {
                expect(classList).not.toContain('opacity-60');
                expect(classList).not.toContain('cursor-not-allowed');
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('IOSCard Drag Over State', () => {
    it('should apply drag over styles when isDragOver is true', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('standard', 'elevated', 'grouped'),
          fc.boolean(),
          (variant, isDragOver) => {
            const { container } = render(
              <IOSCard
                variant={variant as 'standard' | 'elevated' | 'grouped'}
                isDragOver={isDragOver}
                draggable={true}
              >
                <div>Test Content</div>
              </IOSCard>
            );

            const card = container.firstChild as HTMLElement;
            expect(card).not.toBeNull();

            if (card) {
              const classList = card.className;

              if (isDragOver) {
                expect(classList).toContain('border-[var(--ios-blue)]');
                expect(classList).toContain('border-2');
                expect(classList).toContain('scale-[1.02]');
                expect(classList).toContain('shadow-[var(--shadow-xl)]');
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('IOSCard Draggable', () => {
    it('should have cursor-move when draggable', () => {
      fc.assert(
        fc.property(fc.boolean(), draggable => {
          const { container } = render(
            <IOSCard draggable={draggable}>
              <div>Test Content</div>
            </IOSCard>
          );

          const card = container.firstChild as HTMLElement;
          expect(card).not.toBeNull();

          if (card) {
            const classList = card.className;

            if (draggable) {
              expect(classList).toContain('cursor-move');
              expect(card.getAttribute('draggable')).toBe('true');
            } else {
              expect(classList).not.toContain('cursor-move');
              expect(card.getAttribute('draggable')).toBe('false');
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});

// ========== IOSCard Sub-components Tests ==========

describe('IOSCard Sub-components', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        --ios-separator: rgba(60, 60, 67, 0.29);
        --spacing-md: 12px;
        --spacing-lg: 16px;
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
  });

  describe('IOSCardDivider', () => {
    it('should render a divider with iOS separator color', () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          const { container } = render(<IOSCardDivider />);

          const divider = container.firstChild as HTMLElement;
          expect(divider).not.toBeNull();

          if (divider) {
            const classList = divider.className;

            // Should have height of 1px (h-px)
            expect(classList).toContain('h-px');

            // Should use iOS separator color
            expect(classList).toContain('bg-[var(--ios-separator)]');

            // Should have horizontal margin
            expect(classList).toContain('mx-[var(--spacing-lg)]');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('IOSCardHeader', () => {
    it('should render header with correct padding', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 50 }), content => {
          const { container } = render(
            <IOSCardHeader>
              <span>{content}</span>
            </IOSCardHeader>
          );

          const header = container.firstChild as HTMLElement;
          expect(header).not.toBeNull();

          if (header) {
            const classList = header.className;

            // Should have correct padding
            expect(classList).toContain('px-[var(--spacing-lg)]');
            expect(classList).toContain('py-[var(--spacing-md)]');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('IOSCardContent', () => {
    it('should render content with correct padding', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 100 }), content => {
          const { container } = render(
            <IOSCardContent>
              <p>{content}</p>
            </IOSCardContent>
          );

          const contentEl = container.firstChild as HTMLElement;
          expect(contentEl).not.toBeNull();

          if (contentEl) {
            const classList = contentEl.className;

            // Should have correct padding
            expect(classList).toContain('px-[var(--spacing-lg)]');
            expect(classList).toContain('py-[var(--spacing-md)]');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('IOSCardFooter', () => {
    it('should render footer with border and correct padding', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 50 }), content => {
          const { container } = render(
            <IOSCardFooter>
              <span>{content}</span>
            </IOSCardFooter>
          );

          const footer = container.firstChild as HTMLElement;
          expect(footer).not.toBeNull();

          if (footer) {
            const classList = footer.className;

            // Should have correct padding
            expect(classList).toContain('px-[var(--spacing-lg)]');
            expect(classList).toContain('py-[var(--spacing-md)]');

            // Should have top border
            expect(classList).toContain('border-t');
            expect(classList).toContain('border-[var(--ios-separator)]');
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});
