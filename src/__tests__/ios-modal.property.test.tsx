/**
 * @file src/__tests__/ios-modal.property.test.tsx
 * @description IOSModal 组件的属性测试
 *
 * Feature: ios-ui-redesign
 *
 * 测试属性:
 * - Property 10: Modal Animation Combination
 * - Property 21: Modal Overlay Styling
 *
 * @version 2.1.11
 * @updated 2025-01-08 - 修复 PBT 测试失败问题
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { IOSModal } from '../renderer/components/IOSModal';

describe('IOSModal Component - Property Tests', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    // Inject iOS design system CSS variables for modal tests
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        /* 背景颜色 */
        --ios-bg-primary: #F2F2F7;
        --ios-bg-secondary: #FFFFFF;
        --ios-bg-tertiary: #FFFFFF;
        
        /* 文字颜色 */
        --ios-text-primary: #000000;
        --ios-text-secondary: rgba(60, 60, 67, 0.6);
        
        /* 主题色 */
        --ios-blue: #007AFF;
        --ios-gray: #8E8E93;
        
        /* 分隔线 */
        --ios-separator: rgba(60, 60, 67, 0.29);
        
        /* 间距系统 */
        --spacing-lg: 16px;
        --spacing-2xl: 24px;
        
        /* 圆角系统 */
        --radius-md: 12px;
        --radius-xl: 20px;
        
        /* 阴影系统 */
        --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.08);
        
        /* 动画时长 */
        --duration-fast: 200ms;
        --duration-normal: 300ms;
        
        /* iOS 缓动函数 */
        --ease-ios: cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      .dark {
        --ios-bg-secondary: #1C1C1E;
        --ios-bg-tertiary: #2C2C2E;
        --ios-text-primary: #FFFFFF;
        --ios-separator: rgba(84, 84, 88, 0.65);
        --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.6), 0 8px 16px rgba(0, 0, 0, 0.4);
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
    document.documentElement.classList.remove('dark');
  });

  // Feature: ios-ui-redesign, Property 10: Modal Animation Combination
  // *For any* modal component, the opening/closing animation should combine both opacity (fade) and transform scale changes.
  // **Validates: Requirements 3.3, 7.3, 7.4**
  describe('Property 10: Modal Animation Combination', () => {
    it('should have transition classes for opacity and scale animation', () => {
      fc.assert(
        fc.property(fc.constantFrom('sm', 'md', 'lg', 'xl'), size => {
          const onClose = vi.fn();
          const { container } = render(
            <IOSModal
              isOpen={true}
              onClose={onClose}
              size={size as 'sm' | 'md' | 'lg' | 'xl'}
              title="Test Modal"
            >
              <div>Test Content</div>
            </IOSModal>
          );

          // Find the modal content container (not the overlay)
          const modalContent = container.querySelector(
            '[class*="bg-\\[var\\(--ios-bg-secondary\\)\\]"]'
          );
          expect(modalContent).not.toBeNull();

          if (modalContent) {
            const classList = modalContent.className;

            // Should have transition class (either transition-all or specific transition properties)
            const hasTransition =
              classList.includes('transition-all') || classList.includes('transition-[');
            expect(hasTransition).toBe(true);

            // Should have duration for animation timing
            expect(classList).toContain('duration-[var(--duration-normal)]');

            // Should have iOS timing function
            expect(classList).toContain('[transition-timing-function:var(--ease-ios)]');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should have opacity and scale classes for animation states', () => {
      fc.assert(
        fc.property(
          // Only test with isOpen=true since modal doesn't render when closed
          fc.constantFrom('sm', 'md', 'lg', 'xl'),
          size => {
            const onClose = vi.fn();
            const { container } = render(
              <IOSModal
                isOpen={true}
                onClose={onClose}
                size={size as 'sm' | 'md' | 'lg' | 'xl'}
                title="Test Modal"
              >
                <div>Test Content</div>
              </IOSModal>
            );

            const modalContent = container.querySelector(
              '[class*="bg-\\[var\\(--ios-bg-secondary\\)\\]"]'
            );
            expect(modalContent).not.toBeNull();

            if (modalContent) {
              const classList = modalContent.className;
              // When open, should have opacity and scale classes for animation
              const hasOpacityClass =
                classList.includes('opacity-100') || classList.includes('opacity-0');
              const hasScaleClass =
                classList.includes('scale-100') || classList.includes('scale-95');
              expect(hasOpacityClass).toBe(true);
              expect(hasScaleClass).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should animate overlay opacity separately', () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          const onClose = vi.fn();
          const { container } = render(
            <IOSModal isOpen={true} onClose={onClose} title="Test Modal">
              <div>Test Content</div>
            </IOSModal>
          );

          // Find the overlay (has bg-black/40 and backdrop-blur)
          const overlay = container.querySelector('[class*="bg-black\\/40"]');
          expect(overlay).not.toBeNull();

          if (overlay) {
            const classList = overlay.className;

            // Overlay should have its own transition for opacity
            expect(classList).toContain('transition-opacity');
            expect(classList).toContain('duration-[var(--duration-normal)]');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ios-ui-redesign, Property 21: Modal Overlay Styling
  // *For any* modal overlay, the background should be rgba(0, 0, 0, 0.4) with backdrop-filter blur applied.
  // **Validates: Requirements 7.2**
  describe('Property 21: Modal Overlay Styling', () => {
    it('should have semi-transparent black background on overlay', () => {
      fc.assert(
        fc.property(fc.constantFrom('sm', 'md', 'lg', 'xl'), size => {
          const onClose = vi.fn();
          const { container } = render(
            <IOSModal
              isOpen={true}
              onClose={onClose}
              size={size as 'sm' | 'md' | 'lg' | 'xl'}
              title="Test Modal"
            >
              <div>Test Content</div>
            </IOSModal>
          );

          // Find the overlay element
          const overlay = container.querySelector('[class*="bg-black\\/40"]');
          expect(overlay).not.toBeNull();

          if (overlay) {
            const classList = overlay.className;

            // Should have semi-transparent black background (40% opacity)
            expect(classList).toContain('bg-black/40');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should have backdrop blur effect on overlay', () => {
      fc.assert(
        fc.property(fc.constantFrom('sm', 'md', 'lg', 'xl'), size => {
          const onClose = vi.fn();
          const { container } = render(
            <IOSModal
              isOpen={true}
              onClose={onClose}
              size={size as 'sm' | 'md' | 'lg' | 'xl'}
              title="Test Modal"
            >
              <div>Test Content</div>
            </IOSModal>
          );

          // Find the overlay element
          const overlay = container.querySelector('[class*="bg-black\\/40"]');
          expect(overlay).not.toBeNull();

          if (overlay) {
            const classList = overlay.className;

            // Should have backdrop blur (8px as per iOS design)
            expect(classList).toContain('backdrop-blur-[8px]');

            // Verify blur value is within iOS standards (8px to 40px)
            const blurMatch = classList.match(/backdrop-blur-\[(\d+)px\]/);
            if (blurMatch) {
              const blurValue = parseInt(blurMatch[1]);
              expect(blurValue).toBeGreaterThanOrEqual(8);
              expect(blurValue).toBeLessThanOrEqual(40);
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should cover the entire viewport', () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          const onClose = vi.fn();
          const { container } = render(
            <IOSModal isOpen={true} onClose={onClose} title="Test Modal">
              <div>Test Content</div>
            </IOSModal>
          );

          // Find the root modal container
          const modalRoot = container.firstChild as HTMLElement;
          expect(modalRoot).not.toBeNull();

          if (modalRoot) {
            const classList = modalRoot.className;

            // Should be fixed positioned
            expect(classList).toContain('fixed');

            // Should cover entire viewport (inset-0)
            expect(classList).toContain('inset-0');

            // Should have high z-index
            expect(classList).toContain('z-50');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // Additional tests for IOSModal component

  describe('IOSModal Border Radius', () => {
    it('should use iOS standard border radius (20px / radius-xl)', () => {
      fc.assert(
        fc.property(fc.constantFrom('sm', 'md', 'lg', 'xl'), size => {
          const onClose = vi.fn();
          const { container } = render(
            <IOSModal
              isOpen={true}
              onClose={onClose}
              size={size as 'sm' | 'md' | 'lg' | 'xl'}
              title="Test Modal"
            >
              <div>Test Content</div>
            </IOSModal>
          );

          const modalContent = container.querySelector(
            '[class*="bg-\\[var\\(--ios-bg-secondary\\)\\]"]'
          );
          expect(modalContent).not.toBeNull();

          if (modalContent) {
            const classList = modalContent.className;
            // Should have iOS standard border radius for modals
            expect(classList).toContain('rounded-[var(--radius-xl)]');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('IOSModal Size Variants', () => {
    it('should apply correct max-width based on size prop', () => {
      fc.assert(
        fc.property(fc.constantFrom('sm', 'md', 'lg', 'xl'), size => {
          const onClose = vi.fn();
          const { container } = render(
            <IOSModal
              isOpen={true}
              onClose={onClose}
              size={size as 'sm' | 'md' | 'lg' | 'xl'}
              title="Test Modal"
            >
              <div>Test Content</div>
            </IOSModal>
          );

          const modalContent = container.querySelector(
            '[class*="bg-\\[var\\(--ios-bg-secondary\\)\\]"]'
          );
          expect(modalContent).not.toBeNull();

          if (modalContent) {
            const classList = modalContent.className;

            // Should have correct max-width class based on size
            const sizeMap: Record<string, string> = {
              sm: 'max-w-sm',
              md: 'max-w-md',
              lg: 'max-w-lg',
              xl: 'max-w-3xl',
            };

            expect(classList).toContain(sizeMap[size]);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('IOSModal Close Button', () => {
    it('should show close button when showCloseButton is true', () => {
      fc.assert(
        fc.property(fc.boolean(), showCloseButton => {
          const onClose = vi.fn();
          const { container } = render(
            <IOSModal
              isOpen={true}
              onClose={onClose}
              showCloseButton={showCloseButton}
              title="Test Modal"
            >
              <div>Test Content</div>
            </IOSModal>
          );

          // Find close button (has X icon)
          const closeButton = container.querySelector('button[class*="active:scale-95"]');

          if (showCloseButton) {
            expect(closeButton).not.toBeNull();
          } else {
            // When showCloseButton is false and there's a title, header still renders but without close button
            // The button should not exist
            expect(closeButton).toBeNull();
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('IOSModal Overlay Click', () => {
    it('should call onClose when clicking overlay if closeOnOverlayClick is true', () => {
      fc.assert(
        fc.property(fc.boolean(), closeOnOverlayClick => {
          const onClose = vi.fn();
          const { container } = render(
            <IOSModal
              isOpen={true}
              onClose={onClose}
              closeOnOverlayClick={closeOnOverlayClick}
              title="Test Modal"
            >
              <div>Test Content</div>
            </IOSModal>
          );

          // Find the root modal container (the clickable overlay area)
          const modalRoot = container.firstChild as HTMLElement;
          expect(modalRoot).not.toBeNull();

          if (modalRoot) {
            // Reset mock
            onClose.mockClear();

            // Click on the overlay (the root element)
            fireEvent.click(modalRoot);

            if (closeOnOverlayClick) {
              expect(onClose).toHaveBeenCalledTimes(1);
            } else {
              expect(onClose).not.toHaveBeenCalled();
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('IOSModal Shadow', () => {
    it('should have iOS shadow-xl for elevated appearance', () => {
      fc.assert(
        fc.property(fc.constantFrom('sm', 'md', 'lg', 'xl'), size => {
          const onClose = vi.fn();
          const { container } = render(
            <IOSModal
              isOpen={true}
              onClose={onClose}
              size={size as 'sm' | 'md' | 'lg' | 'xl'}
              title="Test Modal"
            >
              <div>Test Content</div>
            </IOSModal>
          );

          const modalContent = container.querySelector(
            '[class*="bg-\\[var\\(--ios-bg-secondary\\)\\]"]'
          );
          expect(modalContent).not.toBeNull();

          if (modalContent) {
            const classList = modalContent.className;
            // Should have shadow-xl for elevated modal appearance
            expect(classList).toContain('shadow-[var(--shadow-xl)]');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('IOSModal Backdrop Blur on Content', () => {
    it('should have backdrop blur on modal content for glass effect', () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          const onClose = vi.fn();
          const { container } = render(
            <IOSModal isOpen={true} onClose={onClose} title="Test Modal">
              <div>Test Content</div>
            </IOSModal>
          );

          const modalContent = container.querySelector(
            '[class*="bg-\\[var\\(--ios-bg-secondary\\)\\]"]'
          );
          expect(modalContent).not.toBeNull();

          if (modalContent) {
            const classList = modalContent.className;
            // Should have backdrop blur for glass effect (20px)
            expect(classList).toContain('backdrop-blur-[20px]');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('IOSModal Footer Layout', () => {
    it('should render footer with correct layout (right-aligned buttons)', () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          const onClose = vi.fn();
          const { container } = render(
            <IOSModal
              isOpen={true}
              onClose={onClose}
              title="Test Modal"
              footer={
                <>
                  <button>Cancel</button>
                  <button>Confirm</button>
                </>
              }
            >
              <div>Test Content</div>
            </IOSModal>
          );

          // Find footer (has border-t and bg-tertiary)
          const footer = container.querySelector(
            '[class*="border-t"][class*="bg-\\[var\\(--ios-bg-tertiary\\)\\]"]'
          );
          expect(footer).not.toBeNull();

          if (footer) {
            const classList = footer.className;

            // Should have flex layout
            expect(classList).toContain('flex');

            // Should have items aligned center
            expect(classList).toContain('items-center');

            // Should have justify-end for right-aligned buttons
            expect(classList).toContain('justify-end');

            // Should have gap between buttons (using CSS variable for 8px grid system)
            expect(classList).toContain('gap-[var(--spacing-md)]');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('IOSModal Title and Icon', () => {
    it('should render title when provided', () => {
      fc.assert(
        fc.property(
          // Use alphanumeric strings to avoid special character issues and duplicate text
          fc.stringMatching(/^[a-zA-Z0-9]+$/).filter(s => s.length >= 3 && s.length <= 30),
          title => {
            const onClose = vi.fn();
            const { container, unmount } = render(
              <IOSModal isOpen={true} onClose={onClose} title={title}>
                <div>Test Content</div>
              </IOSModal>
            );

            // Title should be rendered - use querySelector to avoid duplicate issues
            const titleEl = container.querySelector('h2');
            expect(titleEl).not.toBeNull();
            if (titleEl) {
              expect(titleEl.textContent).toBe(title);
            }

            // Clean up to avoid multiple elements in DOM
            unmount();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('IOSModal Not Rendered When Closed', () => {
    it('should not render when isOpen is false', () => {
      fc.assert(
        fc.property(fc.constant(false), isOpen => {
          const onClose = vi.fn();
          const { container } = render(
            <IOSModal isOpen={isOpen} onClose={onClose} title="Test Modal">
              <div>Test Content</div>
            </IOSModal>
          );

          // Modal should not be in the DOM when closed
          expect(container.firstChild).toBeNull();
        }),
        { numRuns: 100 }
      );
    });
  });
});
