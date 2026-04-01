/**
 * @file src/__tests__/app-modal.property.test.tsx
 * @description AppModal 组件的属性测试
 *
 * Feature: product-design-system
 *
 * 验证中性弹窗原语的动画、遮罩、语义标记与交互回调契约。
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { render, fireEvent } from '@testing-library/react';
import { AppModal, type AppModalProps } from '../renderer/components/AppModal/AppModal';

const modalSizes: NonNullable<AppModalProps['size']>[] = ['sm', 'md', 'lg', 'xl'];

const getOverlayRoot = (baseElement: HTMLElement): HTMLElement | null =>
  baseElement.querySelector('[role="presentation"]');

const getOverlayMask = (baseElement: HTMLElement): HTMLElement | null =>
  baseElement.querySelector('[role="presentation"] [aria-hidden="true"]');

const getDialog = (baseElement: HTMLElement): HTMLElement | null =>
  baseElement.querySelector('[role="dialog"]');

describe('AppModal primitive contract', () => {
  it('renders the expected overlay and dialog transition classes', () => {
    fc.assert(
      fc.property(fc.constantFrom(...modalSizes), size => {
        const { baseElement, unmount } = render(
          <AppModal isOpen={true} onClose={vi.fn()} size={size} title="Test Modal">
            <div>Modal content</div>
          </AppModal>
        );

        const overlayRoot = getOverlayRoot(baseElement);
        const dialog = getDialog(baseElement);

        expect(overlayRoot).not.toBeNull();
        expect(dialog).not.toBeNull();

        if (overlayRoot && dialog) {
          const overlayClassList = overlayRoot.className;
          const dialogClassList = dialog.className;

          expect(overlayClassList).toContain('fixed');
          expect(overlayClassList).toContain('inset-0');
          expect(overlayClassList).toContain('transition-opacity');
          expect(overlayClassList).toContain('duration-200');
          expect(overlayClassList).toContain('z-[200]');

          expect(dialogClassList).toContain('transition-[transform,opacity]');
          expect(dialogClassList).toContain('duration-200');
          expect(dialogClassList.includes('opacity-100') || dialogClassList.includes('opacity-0')).toBe(
            true
          );
          expect(dialogClassList.includes('scale-100') || dialogClassList.includes('scale-95')).toBe(
            true
          );
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('applies the correct size classes to the dialog surface', () => {
    fc.assert(
      fc.property(fc.constantFrom(...modalSizes), size => {
        const { baseElement, unmount } = render(
          <AppModal isOpen={true} onClose={vi.fn()} size={size} title="Size Check">
            <div>Modal content</div>
          </AppModal>
        );

        const dialog = getDialog(baseElement);
        expect(dialog).not.toBeNull();

        if (dialog) {
          const classList = dialog.className;
          const sizeClassMap: Record<NonNullable<AppModalProps['size']>, string> = {
            sm: 'max-w-sm',
            md: 'max-w-md',
            lg: 'max-w-lg',
            xl: 'max-w-3xl',
          };

          expect(classList).toContain(sizeClassMap[size]);
          expect(classList).toContain('rounded-[var(--radius-xl)]');
          expect(classList).toContain('border-[var(--line-soft)]');
          expect(classList).toContain('bg-[var(--surface-1)]');
          expect(classList).toContain('shadow-[var(--shadow-xl)]');
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('renders an overlay mask with the shared overlay token and blur treatment', () => {
    fc.assert(
      fc.property(fc.constantFrom(...modalSizes), size => {
        const { baseElement, unmount } = render(
          <AppModal isOpen={true} onClose={vi.fn()} size={size} title="Mask Check">
            <div>Modal content</div>
          </AppModal>
        );

        const overlayMask = getOverlayMask(baseElement);
        expect(overlayMask).not.toBeNull();

        if (overlayMask) {
          const classList = overlayMask.className;
          expect(classList).toContain('absolute');
          expect(classList).toContain('inset-0');
          expect(classList).toContain('bg-[var(--overlay-mask)]');
          expect(classList).toContain('backdrop-blur-[8px]');
          expect(classList).toContain('transition-opacity');
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('renders shared chrome markers for title, body, and footer when supplied', () => {
    fc.assert(
      fc.property(fc.constant(true), () => {
        const { baseElement, unmount } = render(
          <AppModal
            isOpen={true}
            onClose={vi.fn()}
            title="Chrome Contract"
            footer={
              <>
                <button type="button">Cancel</button>
                <button type="button">Confirm</button>
              </>
            }
          >
            <div>Modal content</div>
          </AppModal>
        );

        const title = baseElement.querySelector('[data-testid="overlay-title"]');
        const body = baseElement.querySelector('[data-testid="overlay-body"]');
        const footer = baseElement.querySelector('[data-testid="overlay-footer"]');

        expect(title).not.toBeNull();
        expect(body).not.toBeNull();
        expect(footer).not.toBeNull();

        if (footer) {
          const classList = footer.className;
          expect(classList).toContain('justify-end');
          expect(classList).toContain('gap-3');
          expect(classList).toContain('bg-[var(--surface-2)]');
          expect(classList).toContain('border-t');
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('shows or hides the close button according to showCloseButton', () => {
    fc.assert(
      fc.property(fc.boolean(), showCloseButton => {
        const { baseElement, unmount } = render(
          <AppModal
            isOpen={true}
            onClose={vi.fn()}
            title="Close Button"
            showCloseButton={showCloseButton}
          >
            <div>Modal content</div>
          </AppModal>
        );

        const closeButton = baseElement.querySelector('button[aria-label="关闭弹窗"]');

        if (showCloseButton) {
          expect(closeButton).not.toBeNull();
        } else {
          expect(closeButton).toBeNull();
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('preserves overlay click close behavior', () => {
    fc.assert(
      fc.property(fc.boolean(), closeOnOverlayClick => {
        const onClose = vi.fn();
        const { baseElement, unmount } = render(
          <AppModal
            isOpen={true}
            onClose={onClose}
            title="Overlay Close"
            closeOnOverlayClick={closeOnOverlayClick}
          >
            <div>Modal content</div>
          </AppModal>
        );

        const overlayRoot = getOverlayRoot(baseElement);
        expect(overlayRoot).not.toBeNull();

        if (overlayRoot) {
          fireEvent.click(overlayRoot);

          if (closeOnOverlayClick) {
            expect(onClose).toHaveBeenCalledTimes(1);
          } else {
            expect(onClose).not.toHaveBeenCalled();
          }
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('connects the dialog title to aria-labelledby when a title is provided', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9 ]+$/).filter(value => value.trim().length >= 3 && value.length <= 30),
        title => {
          const { baseElement, unmount } = render(
            <AppModal isOpen={true} onClose={vi.fn()} title={title}>
              <div>Modal content</div>
            </AppModal>
          );

          const dialog = getDialog(baseElement);
          const titleElement = baseElement.querySelector('[data-testid="overlay-title"] h2');

          expect(dialog).not.toBeNull();
          expect(titleElement).not.toBeNull();

          if (dialog && titleElement) {
            expect(dialog.getAttribute('aria-labelledby')).toBe(titleElement.getAttribute('id'));
            expect(titleElement.textContent).toBe(title);
          }

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('does not render when closed', () => {
    fc.assert(
      fc.property(fc.constant(false), isOpen => {
        const { baseElement, unmount } = render(
          <AppModal isOpen={isOpen} onClose={vi.fn()} title="Closed Modal">
            <div>Modal content</div>
          </AppModal>
        );

        expect(getOverlayRoot(baseElement)).toBeNull();
        expect(getDialog(baseElement)).toBeNull();

        unmount();
      }),
      { numRuns: 100 }
    );
  });
});
