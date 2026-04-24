/**
 * @file src/__tests__/ui-functional-preservation.property.test.tsx
 * @description 产品级 UI 原语功能保持属性测试
 *
 * Feature: product-design-system
 *
 * 验证中性原语重命名后，交互回调、受控状态、表单提交流程与键盘行为保持不变。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { render, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import { AppButton, type AppButtonProps } from '../renderer/components/AppButton/AppButton';
import { AppInput } from '../renderer/components/AppInput';
import { AppCard } from '../renderer/components/AppCard';
import { AppModal } from '../renderer/components/AppModal/AppModal';

const buttonVariants: NonNullable<AppButtonProps['variant']>[] = [
  'primary',
  'secondary',
  'tertiary',
  'danger',
];

const buttonSizes: NonNullable<AppButtonProps['size']>[] = ['sm', 'md', 'lg'];

const getOverlayRoot = (baseElement: HTMLElement): HTMLElement | null =>
  baseElement.querySelector('[role="presentation"]');

const StatefulTestComponent: React.FC<{
  initialValue: string;
  onStateChange?: (value: string) => void;
}> = ({ initialValue, onStateChange }) => {
  const [value, setValue] = useState(initialValue);

  const handleChange = (newValue: string) => {
    setValue(newValue);
    onStateChange?.(newValue);
  };

  return (
    <div>
      <AppInput
        value={value}
        onChange={event => handleChange(event.target.value)}
        data-testid="stateful-input"
      />
      <span data-testid="display-value">{value}</span>
    </div>
  );
};

describe('UI functional preservation contracts', () => {
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
        --accent-soft: rgba(91, 106, 98, 0.12);
        --accent-soft-strong: rgba(91, 106, 98, 0.18);
        --accent-strong: #4d5952;
        --danger: #8a5d5a;
        --danger-soft: rgba(138, 93, 90, 0.14);
        --overlay-mask: rgba(27, 24, 22, 0.24);
        --focus-ring: rgba(91, 106, 98, 0.16);
        --spacing-sm: 8px;
        --spacing-md: 12px;
        --spacing-lg: 16px;
        --spacing-2xl: 24px;
        --radius-sm: 8px;
        --radius-md: 12px;
        --radius-lg: 16px;
        --radius-xl: 20px;
        --shadow-md: 0 2px 8px rgba(33, 31, 27, 0.06), 0 1px 2px rgba(33, 31, 27, 0.04);
        --shadow-lg: 0 8px 24px rgba(33, 31, 27, 0.08), 0 2px 8px rgba(33, 31, 27, 0.04);
        --shadow-xl: 0 16px 32px rgba(33, 31, 27, 0.1), 0 4px 12px rgba(33, 31, 27, 0.06);
        --duration-fast: 200ms;
        --duration-normal: 300ms;
        --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
      }
    `;

    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
  });

  it('preserves AppButton onClick behavior across variants and sizes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...buttonVariants),
        fc.constantFrom(...buttonSizes),
        fc.integer({ min: 0, max: 50 }),
        (variant, size, clickCount) => {
          let actualClickCount = 0;

          const { container, unmount } = render(
            <AppButton variant={variant} size={size} onClick={() => actualClickCount++}>
              Test Button
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

  it('does not trigger AppButton onClick when disabled', () => {
    fc.assert(
      fc.property(fc.constantFrom(...buttonVariants), variant => {
        let clickCount = 0;

        const { container, unmount } = render(
          <AppButton variant={variant} disabled={true} onClick={() => clickCount++}>
            Disabled
          </AppButton>
        );

        const button = container.querySelector('button');
        expect(button).not.toBeNull();

        if (button) {
          fireEvent.click(button);
          expect(clickCount).toBe(0);
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('renders AppCard title attributes and child content exactly as provided', () => {
    fc.assert(
      fc.property(
        fc
          .stringMatching(/^[a-zA-Z0-9]+$/)
          .filter(value => value.length >= 1 && value.length <= 50),
        fc.stringMatching(/^[a-zA-Z0-9]*$/).filter(value => value.length <= 50),
        (title, content) => {
          const { container, unmount } = render(
            <AppCard title={title}>
              <div data-testid="card-content">{content}</div>
            </AppCard>
          );

          const card = container.querySelector('[title]');
          const contentElement = container.querySelector('[data-testid="card-content"]');

          expect(card).not.toBeNull();
          expect(contentElement).not.toBeNull();

          if (card && contentElement) {
            expect(card.getAttribute('title')).toBe(title);
            expect(contentElement.textContent).toBe(content);
          }

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('preserves controlled AppInput values', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9]*$/).filter(value => value.length <= 50),
        inputValue => {
          const { container, unmount } = render(
            <AppInput value={inputValue} onChange={() => {}} />
          );

          const input = container.querySelector('input') as HTMLInputElement | null;
          expect(input).not.toBeNull();

          if (input) {
            expect(input.value).toBe(inputValue);
          }

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('renders AppModal title and content correctly through the neutral public primitive', () => {
    fc.assert(
      fc.property(
        fc
          .stringMatching(/^[a-zA-Z0-9 ]+$/)
          .filter(value => value.trim().length >= 1 && value.length <= 50),
        fc
          .stringMatching(/^[a-zA-Z0-9 ]+$/)
          .filter(value => value.trim().length >= 1 && value.length <= 80),
        (title, content) => {
          const { baseElement, unmount } = render(
            <AppModal isOpen={true} onClose={() => {}} title={title}>
              <div>{content}</div>
            </AppModal>
          );

          expect(baseElement.querySelector('[role="dialog"]')).not.toBeNull();
          expect(baseElement.textContent).toContain(title);
          expect(baseElement.textContent).toContain(content);

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('preserves AppInput onChange handlers and captured values', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-zA-Z0-9]*$/), inputValue => {
        let capturedValue = '';

        const { container, unmount } = render(
          <AppInput
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              capturedValue = event.target.value;
            }}
          />
        );

        const input = container.querySelector('input');
        expect(input).not.toBeNull();

        if (input) {
          fireEvent.change(input, { target: { value: inputValue } });
          expect(capturedValue).toBe(inputValue);
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('preserves AppInput error-state rendering', () => {
    fc.assert(
      fc.property(
        fc
          .stringMatching(/^[a-zA-Z0-9]+$/)
          .filter(value => value.length >= 5 && value.length <= 50),
        errorMessage => {
          const { container, unmount } = render(
            <AppInput error={true} errorMessage={errorMessage} />
          );

          const input = container.querySelector('input');
          const errorElement = container.querySelector('[role="alert"]');

          expect(input).not.toBeNull();
          expect(errorElement).not.toBeNull();

          if (input && errorElement) {
            expect(input.className).toContain('border-[var(--danger)]');
            expect(errorElement.textContent).toBe(errorMessage);
          }

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('preserves local state propagation through AppInput updates', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9]*$/).filter(value => value.length <= 20),
        fc
          .stringMatching(/^[a-zA-Z0-9]+$/)
          .filter(value => value.length >= 1 && value.length <= 20),
        (initialValue, nextValue) => {
          const stateChanges: string[] = [];

          const { container, unmount } = render(
            <StatefulTestComponent
              initialValue={initialValue}
              onStateChange={value => stateChanges.push(value)}
            />
          );

          const input = container.querySelector('input');
          const display = container.querySelector('[data-testid="display-value"]');

          expect(input).not.toBeNull();
          expect(display).not.toBeNull();

          if (input && display) {
            expect(display.textContent).toBe(initialValue);

            fireEvent.change(input, { target: { value: nextValue } });

            expect(stateChanges).toContain(nextValue);
            expect(display.textContent).toBe(nextValue);
          }

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('preserves modal close callbacks on overlay clicks', () => {
    fc.assert(
      fc.property(fc.boolean(), closeOnOverlayClick => {
        const onClose = vi.fn();

        const { baseElement, unmount } = render(
          <AppModal
            isOpen={true}
            onClose={onClose}
            closeOnOverlayClick={closeOnOverlayClick}
            title="Overlay Test"
          >
            <div>Content</div>
          </AppModal>
        );

        const overlayRoot = getOverlayRoot(baseElement);
        expect(overlayRoot).not.toBeNull();

        if (overlayRoot) {
          fireEvent.mouseDown(overlayRoot);
          fireEvent.mouseUp(overlayRoot);
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

  it('preserves AppCard expanded-state reflection when props change', () => {
    fc.assert(
      fc.property(fc.boolean(), initialExpanded => {
        const { container, rerender, unmount } = render(
          <AppCard expanded={initialExpanded} expandContent={<div>Expanded content</div>}>
            <div>Main content</div>
          </AppCard>
        );

        const initialCard = container.firstChild as HTMLElement | null;
        expect(initialCard).not.toBeNull();

        if (initialCard) {
          expect(initialCard.getAttribute('aria-expanded')).toBe(String(initialExpanded));
        }

        rerender(
          <AppCard expanded={!initialExpanded} expandContent={<div>Expanded content</div>}>
            <div>Main content</div>
          </AppCard>
        );

        const updatedCard = container.firstChild as HTMLElement | null;
        expect(updatedCard).not.toBeNull();

        if (updatedCard) {
          expect(updatedCard.getAttribute('aria-expanded')).toBe(String(!initialExpanded));
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('preserves async payload handlers on AppButton actions', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...buttonVariants),
        fc
          .stringMatching(/^[a-zA-Z0-9]+$/)
          .filter(value => value.length >= 1 && value.length <= 20),
        (variant, payload) => {
          let capturedPayload: string | null = null;

          const { container, unmount } = render(
            <AppButton variant={variant} onClick={() => (capturedPayload = payload)}>
              Submit
            </AppButton>
          );

          const button = container.querySelector('button');
          expect(button).not.toBeNull();

          if (button) {
            fireEvent.click(button);
            expect(capturedPayload).toBe(payload);
          }

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('preserves form submission handlers built from AppInput and AppButton', () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc
            .stringMatching(/^[a-zA-Z]+$/)
            .filter(value => value.length >= 1 && value.length <= 10),
          email: fc.stringMatching(/^[a-z]+@[a-z]+\.[a-z]+$/).filter(value => value.length <= 30),
        }),
        formData => {
          let submittedData: typeof formData | null = null;

          const { container, unmount } = render(
            <form
              onSubmit={event => {
                event.preventDefault();
                submittedData = formData;
              }}
            >
              <AppInput value={formData.name} onChange={() => {}} placeholder="Name" />
              <AppInput value={formData.email} onChange={() => {}} placeholder="Email" />
              <AppButton type="submit" variant="primary">
                Submit
              </AppButton>
            </form>
          );

          const form = container.querySelector('form');
          expect(form).not.toBeNull();

          if (form) {
            fireEvent.submit(form);
            expect(submittedData).toEqual(formData);
          }

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('preserves keyboard handlers on buttons and inputs', () => {
    fc.assert(
      fc.property(fc.constantFrom('Enter', ' ', 'Tab', 'ArrowUp', 'ArrowDown'), key => {
        let pressedKey: string | null = null;

        const { container, unmount } = render(
          <div>
            <AppButton onKeyDown={event => (pressedKey = event.key)}>Button</AppButton>
            <AppInput onKeyDown={event => (pressedKey = event.key)} />
          </div>
        );

        const button = container.querySelector('button');
        const input = container.querySelector('input');

        expect(button).not.toBeNull();
        expect(input).not.toBeNull();

        if (key === 'Enter' || key === ' ') {
          if (button) {
            fireEvent.keyDown(button, { key });
          }
        } else if (input) {
          fireEvent.keyDown(input, { key });
        }

        expect(pressedKey).toBe(key);

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('preserves AppModal closeOnEsc behavior', () => {
    fc.assert(
      fc.property(fc.constant(true), () => {
        let closed = false;

        const { unmount } = render(
          <AppModal
            isOpen={true}
            onClose={() => {
              closed = true;
            }}
            closeOnEsc={true}
            title="Escape Modal"
          >
            <div>Content</div>
          </AppModal>
        );

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(closed).toBe(true);

        unmount();
      }),
      { numRuns: 100 }
    );
  });
});
