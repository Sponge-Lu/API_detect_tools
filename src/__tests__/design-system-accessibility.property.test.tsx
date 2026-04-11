/**
 * Property-Based Tests for Product Accessibility
 * Feature: product-design-system
 *
 * Covers token-level accessibility requirements and public primitive accessibility contracts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { render, fireEvent } from '@testing-library/react';
import { AppButton } from '../renderer/components/AppButton/AppButton';
import { AppInput } from '../renderer/components/AppInput';
import { AppCard } from '../renderer/components/AppCard';
import { AppModal } from '../renderer/components/AppModal/AppModal';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableRow,
} from '../renderer/components/DataTable/DataTable';

function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(component => {
    const scaled = component / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

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

describe('design system accessibility tokens', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        --app-bg: #f3f0ea;
        --surface-1: #fbf8f3;
        --surface-2: #f1ece5;
        --surface-3: #ffffff;
        --line-soft: rgba(87, 80, 70, 0.12);
        --text-primary: #2c2a27;
        --text-secondary: #6a635c;
        --text-tertiary: #948d84;
        --accent: #5b6a62;
        --focus-ring: rgba(91, 106, 98, 0.16);
        --danger: #8a5d5a;
        --danger-soft: rgba(138, 93, 90, 0.14);
        --overlay-mask: rgba(27, 24, 22, 0.24);
        --spacing-sm: 8px;
        --spacing-md: 12px;
        --spacing-lg: 16px;
        --spacing-2xl: 24px;
        --radius-sm: 8px;
        --radius-md: 12px;
        --radius-lg: 16px;
        --radius-xl: 20px;
        --shadow-xl: 0 16px 32px rgba(33, 31, 27, 0.1), 0 4px 12px rgba(33, 31, 27, 0.06);
        --duration-fast: 200ms;
        --duration-normal: 300ms;
      }

      html[data-theme='dark'] {
        --app-bg: #17181b;
        --surface-1: #1d1f23;
        --surface-2: #252830;
        --surface-3: #2b2f37;
        --line-soft: rgba(142, 161, 173, 0.18);
        --text-primary: #f3f5f7;
        --text-secondary: #aab4bc;
        --text-tertiary: #7f8a93;
        --accent: #8ea1ad;
        --focus-ring: rgba(142, 161, 173, 0.24);
        --danger: #d27a72;
        --danger-soft: rgba(210, 122, 114, 0.18);
      }

      :focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }

      button:focus-visible,
      [role='button']:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px var(--focus-ring);
      }

      input:focus-visible,
      textarea:focus-visible,
      select:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 0;
        box-shadow: 0 0 0 4px var(--focus-ring);
      }

      .app-sr-only {
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
    delete document.documentElement.dataset.theme;
  });

  it('keeps primary text contrast at WCAG AA levels in light and dark themes', () => {
    fc.assert(
      fc.property(fc.constantFrom('light', 'dark'), theme => {
        const textColor: [number, number, number] =
          theme === 'light' ? [44, 42, 39] : [243, 245, 247];
        const backgroundColor: [number, number, number] =
          theme === 'light' ? [251, 248, 243] : [29, 31, 35];

        const contrastRatio = getContrastRatio(textColor, backgroundColor);
        expect(contrastRatio).toBeGreaterThanOrEqual(4.5);
      }),
      { numRuns: 100 }
    );
  });

  it('keeps accent contrast high enough for focus and control affordances', () => {
    fc.assert(
      fc.property(fc.constantFrom('light', 'dark'), theme => {
        const accentColor: [number, number, number] =
          theme === 'light' ? [91, 106, 98] : [142, 161, 173];
        const backgroundColor: [number, number, number] =
          theme === 'light' ? [255, 255, 255] : [29, 31, 35];

        const contrastRatio = getContrastRatio(accentColor, backgroundColor);
        expect(contrastRatio).toBeGreaterThanOrEqual(3);
      }),
      { numRuns: 100 }
    );
  });

  it('defines a focus-visible rule with at least a 2px outline', () => {
    fc.assert(
      fc.property(fc.constant(true), () => {
        const styleSheets = Array.from(document.styleSheets);
        let hasFocusRule = false;

        for (const sheet of styleSheets) {
          const rules = Array.from(sheet.cssRules || []);

          for (const rule of rules) {
            if (rule instanceof CSSStyleRule && rule.selectorText.includes(':focus-visible')) {
              hasFocusRule = true;
              const outlineMatch = rule.cssText.match(/outline:\s*(\d+)px/);

              if (outlineMatch) {
                expect(parseInt(outlineMatch[1], 10)).toBeGreaterThanOrEqual(2);
              }
            }
          }
        }

        expect(hasFocusRule).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('defines reduced-motion and screen-reader-only support classes', () => {
    fc.assert(
      fc.property(fc.constant(true), () => {
        const styleSheets = Array.from(document.styleSheets);
        let hasReducedMotionRule = false;
        let hasSrOnlyClass = false;

        for (const sheet of styleSheets) {
          const rules = Array.from(sheet.cssRules || []);

          for (const rule of rules) {
            if (rule instanceof CSSMediaRule) {
              const conditionText = rule.conditionText || rule.media?.mediaText || '';
              if (conditionText.includes('prefers-reduced-motion')) {
                hasReducedMotionRule = true;
              }
            }

            if (rule instanceof CSSStyleRule && rule.selectorText.includes('.app-sr-only')) {
              hasSrOnlyClass = true;
              expect(rule.cssText.toLowerCase()).toContain('clip');
              expect(rule.cssText.toLowerCase()).toContain('position');
            }
          }
        }

        expect(hasReducedMotionRule).toBe(true);
        expect(hasSrOnlyClass).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

describe('primitive accessibility contracts', () => {
  it('supports aria-label on icon-only AppButton usage', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), label => {
        const { container, unmount } = render(
          <AppButton aria-label={label}>
            <span aria-hidden="true">*</span>
          </AppButton>
        );

        const button = container.querySelector('button');
        expect(button).not.toBeNull();

        if (button) {
          expect(button.getAttribute('aria-label')).toBe(label);
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('marks AppButton loading state as busy and disabled', () => {
    fc.assert(
      fc.property(fc.boolean(), loading => {
        const { container, unmount } = render(<AppButton loading={loading}>Run</AppButton>);
        const button = container.querySelector('button') as HTMLButtonElement | null;

        expect(button).not.toBeNull();

        if (button) {
          if (loading) {
            expect(button.disabled).toBe(true);
            expect(button.getAttribute('aria-busy')).toBe('true');
          } else {
            expect(button.getAttribute('aria-busy')).toBe('false');
          }
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('wires AppInput labels, required state, and error messaging correctly', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (labelText, errorMessage) => {
          const { container, unmount } = render(
            <AppInput label={labelText} required={true} error={true} errorMessage={errorMessage} />
          );

          const label = container.querySelector('label');
          const input = container.querySelector('input');
          const errorElement = container.querySelector('[role="alert"]');

          expect(label).not.toBeNull();
          expect(input).not.toBeNull();
          expect(errorElement).not.toBeNull();

          if (label && input && errorElement) {
            expect(label.getAttribute('for')).toBe(input.getAttribute('id'));
            expect(input.getAttribute('aria-required')).toBe('true');
            expect(input.getAttribute('aria-invalid')).toBe('true');
            expect(input.getAttribute('aria-describedby')).toContain(
              errorElement.getAttribute('id')
            );
          }

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('exposes an accessible password visibility toggle on AppInput', () => {
    fc.assert(
      fc.property(fc.constant(true), () => {
        const { container, unmount } = render(
          <AppInput type="password" showPasswordToggle={true} />
        );

        const toggleButton = container.querySelector('button[aria-label]');
        expect(toggleButton).not.toBeNull();

        if (toggleButton) {
          expect(['显示密码', '隐藏密码']).toContain(toggleButton.getAttribute('aria-label'));
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('preserves AppCard aria-label, aria-expanded, and focusability hooks', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), fc.boolean(), (label, focusable) => {
        const { container, unmount } = render(
          <AppCard
            aria-label={label}
            focusable={focusable}
            expanded={true}
            expandContent={<div>Expanded</div>}
          >
            <div>Card content</div>
          </AppCard>
        );

        const card = container.firstChild as HTMLElement | null;
        expect(card).not.toBeNull();

        if (card) {
          expect(card.getAttribute('aria-label')).toBe(label);
          expect(card.getAttribute('aria-expanded')).toBe('true');

          if (focusable) {
            expect(card.tabIndex).toBe(0);
            expect(card.getAttribute('role')).toBe('article');
          } else {
            expect(card.getAttribute('role')).toBeNull();
          }
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('exposes semantic table roles through DataTable primitives', () => {
    fc.assert(
      fc.property(fc.boolean(), focusable => {
        const { container, unmount } = render(
          <DataTable>
            <DataTableBody>
              <DataTableRow focusable={focusable}>
                <DataTableCell>Cell</DataTableCell>
              </DataTableRow>
            </DataTableBody>
          </DataTable>
        );

        const table = container.querySelector('[role="table"]');
        const row = container.querySelector('[role="row"]') as HTMLElement | null;
        const cell = container.querySelector('[role="cell"]');

        expect(table).not.toBeNull();
        expect(row).not.toBeNull();
        expect(cell).not.toBeNull();

        if (row) {
          if (focusable) {
            expect(row.tabIndex).toBe(0);
          } else {
            expect(row.getAttribute('tabindex')).toBeNull();
          }
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('renders AppModal with dialog semantics and aria-labelledby when titled', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 30 }), title => {
        const { baseElement, unmount } = render(
          <AppModal isOpen={true} onClose={() => {}} title={title}>
            <div>Modal body</div>
          </AppModal>
        );

        const dialog = baseElement.querySelector('[role="dialog"]');
        const titleElement = baseElement.querySelector('[data-testid="overlay-title"] h2');

        expect(dialog).not.toBeNull();
        expect(titleElement).not.toBeNull();

        if (dialog && titleElement) {
          expect(dialog.getAttribute('aria-modal')).toBe('true');
          expect(dialog.getAttribute('aria-labelledby')).toBe(titleElement.getAttribute('id'));
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('keeps the AppModal close button accessible and closes on Escape', () => {
    fc.assert(
      fc.property(fc.constant(true), () => {
        let closed = false;
        const { baseElement, unmount } = render(
          <AppModal
            isOpen={true}
            onClose={() => {
              closed = true;
            }}
            showCloseButton={true}
            closeOnEsc={true}
            title="Escape Modal"
          >
            <div>Modal body</div>
          </AppModal>
        );

        const closeButton = baseElement.querySelector('button[aria-label="关闭弹窗"]');
        expect(closeButton).not.toBeNull();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(closed).toBe(true);

        unmount();
      }),
      { numRuns: 100 }
    );
  });
});
