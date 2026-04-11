/**
 * Property-Based Tests for Input Primitive Compatibility
 * Feature: input-primitive-compatibility
 *
 * Tests input primitives and their legacy compatibility exports
 *
 * @version 2.1.11
 * @updated 2025-01-08 - 创建输入原语属性测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { render, fireEvent } from '@testing-library/react';
import { AppInput, AppSearchInput } from '../renderer/components/AppInput';

describe('Input Primitive Compatibility', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    // Inject neutral theme variables for input primitive tests
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        --accent: #5b6a62;
        --danger: #8a5d5a;
        --surface-1: #F2F2F7;
        --surface-2: #FFFFFF;
        --surface-3: #FFFFFF;
        --text-primary: #000000;
        --text-secondary: rgba(60, 60, 67, 0.6);
        --text-tertiary: rgba(60, 60, 67, 0.3);
        --line-soft: rgba(60, 60, 67, 0.29);
        --focus-ring: rgba(91, 106, 98, 0.18);
        --duration-fast: 200ms;
        --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
  });

  // Feature: input-primitive-compatibility, Property 20: Input Focus Ring
  // **Validates: Requirements 5.5**
  it('should apply focus ring with primary color at 10% opacity and 4px spread on focus', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('sm', 'md', 'lg'),
        fc.constantFrom('text', 'password', 'url', 'number', 'email'),
        (size, type) => {
          const { container } = render(
            <AppInput
              size={size as 'sm' | 'md' | 'lg'}
              type={type as 'text' | 'password' | 'url' | 'number' | 'email'}
              placeholder="Test input"
            />
          );

          const input = container.querySelector('input');
          expect(input).not.toBeNull();

          if (input) {
            // Trigger focus
            fireEvent.focus(input);

            // Check if the input has the focus box-shadow class
            const classList = input.className;

            // Should have the focus box-shadow with 4px spread and 10% opacity
            // The class should contain the focus ring styling
            expect(classList).toContain('[box-shadow:0_0_0_4px_var(--focus-ring)');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: input-primitive-compatibility, Property 29: Form Validation Logic Preservation
  // **Validates: Requirements 11.3**
  it('should preserve onChange handler functionality', () => {
    fc.assert(
      fc.property(
        // Use alphanumeric strings to avoid browser-specific input handling
        fc.stringMatching(/^[a-zA-Z0-9]*$/),
        fc.constantFrom('text', 'password', 'email'),
        (inputValue, type) => {
          let capturedValue = '';
          const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            capturedValue = e.target.value;
          };

          const { container } = render(
            <AppInput type={type as 'text' | 'password' | 'email'} onChange={handleChange} />
          );

          const input = container.querySelector('input');
          expect(input).not.toBeNull();

          if (input) {
            // Simulate typing
            fireEvent.change(input, { target: { value: inputValue } });

            // Verify the handler captured the correct value
            expect(capturedValue).toBe(inputValue);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify the shared primitive border radius
  it('should use the standard primitive border radius', () => {
    fc.assert(
      fc.property(fc.constantFrom('sm', 'md', 'lg'), size => {
        const { container } = render(<AppInput size={size as 'sm' | 'md' | 'lg'} />);

        const input = container.querySelector('input');
        expect(input).not.toBeNull();

        if (input) {
          const classList = input.className;

          // Verify it has a rounded class
          const hasRoundedClass = classList.match(/rounded-\[(\d+)px\]/);
          expect(hasRoundedClass).not.toBeNull();

          if (hasRoundedClass) {
            const radiusValue = parseInt(hasRoundedClass[1]);

            // Should be one of the supported primitive values (8-16px range for inputs)
            expect(radiusValue).toBeGreaterThanOrEqual(8);
            expect(radiusValue).toBeLessThanOrEqual(16);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify error state styling
  it('should apply error styling when error prop is true', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.string({ minLength: 1, maxLength: 50 }),
        (hasError, errorMessage) => {
          const { container } = render(
            <AppInput error={hasError} errorMessage={hasError ? errorMessage : undefined} />
          );

          const input = container.querySelector('input');
          expect(input).not.toBeNull();

          if (input) {
            const classList = input.className;

            if (hasError) {
              // Should have error border color
              expect(classList).toContain('border-[var(--danger)]');

              // Should display error message
              const errorEl = container.querySelector('p');
              expect(errorEl).not.toBeNull();
              if (errorEl) {
                expect(errorEl.textContent).toBe(errorMessage);
              }
            } else {
              // Should not have error border color
              expect(classList).not.toContain('border-[var(--danger)]');
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
      fc.property(fc.boolean(), disabled => {
        let changeCount = 0;
        const handleChange = () => {
          changeCount++;
        };

        const { container } = render(<AppInput disabled={disabled} onChange={handleChange} />);

        const input = container.querySelector('input');
        expect(input).not.toBeNull();

        if (input) {
          // Verify disabled attribute
          expect(input.disabled).toBe(disabled);

          // Verify disabled styling
          if (disabled) {
            const classList = input.className;
            expect(classList).toContain('opacity-50');
            expect(classList).toContain('cursor-not-allowed');
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify password toggle functionality
  it('should toggle password visibility when showPasswordToggle is true', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), password => {
        const { container } = render(
          <AppInput type="password" showPasswordToggle value={password} onChange={() => {}} />
        );

        const input = container.querySelector('input');
        const toggleButton = container.querySelector('button');

        expect(input).not.toBeNull();
        expect(toggleButton).not.toBeNull();

        if (input && toggleButton) {
          // Initially should be password type
          expect(input.type).toBe('password');

          // Click toggle button
          fireEvent.click(toggleButton);

          // Should now be text type
          expect(input.type).toBe('text');

          // Click again
          fireEvent.click(toggleButton);

          // Should be back to password type
          expect(input.type).toBe('password');
        }
      }),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify inner shadow styling
  it('should have inner shadow styling', () => {
    fc.assert(
      fc.property(fc.constantFrom('sm', 'md', 'lg'), size => {
        const { container } = render(<AppInput size={size as 'sm' | 'md' | 'lg'} />);

        const input = container.querySelector('input');
        expect(input).not.toBeNull();

        if (input) {
          const classList = input.className;

          // Should have inner shadow
          expect(classList).toContain('[box-shadow:inset_0_1px_2px_rgba(0,0,0,0.05)]');
        }
      }),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify transition timing
  it('should use the standard timing function for transitions', () => {
    fc.assert(
      fc.property(fc.constantFrom('sm', 'md', 'lg'), size => {
        const { container } = render(<AppInput size={size as 'sm' | 'md' | 'lg'} />);

        const input = container.querySelector('input');
        expect(input).not.toBeNull();

        if (input) {
          const classList = input.className;

          // Should have transition class (either transition-all or specific transition properties)
          const hasTransition =
            classList.includes('transition-all') || classList.includes('transition-[');
          expect(hasTransition).toBe(true);

          // Should use the shared standard timing function
          expect(classList).toContain('[transition-timing-function:var(--ease-standard)]');

          // Should use fast duration
          expect(classList).toContain('duration-[var(--duration-fast)]');
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Search Input Primitive Compatibility', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    // Inject neutral theme variables for search input tests
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        --accent: #5b6a62;
        --surface-1: #F2F2F7;
        --surface-2: #FFFFFF;
        --surface-3: #FFFFFF;
        --text-primary: #000000;
        --text-secondary: rgba(60, 60, 67, 0.6);
        --text-tertiary: rgba(60, 60, 67, 0.3);
        --focus-ring: rgba(91, 106, 98, 0.18);
        --duration-fast: 200ms;
        --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
  });

  // Feature: input-primitive-compatibility, Property 20: Input Focus Ring (for search input)
  // **Validates: Requirements 5.5**
  it('should apply focus ring on focus', () => {
    fc.assert(
      fc.property(fc.constantFrom('sm', 'md', 'lg'), size => {
        const { container } = render(
          <AppSearchInput size={size as 'sm' | 'md' | 'lg'} placeholder="Search..." />
        );

        const input = container.querySelector('input');
        expect(input).not.toBeNull();

        if (input) {
          // Trigger focus
          fireEvent.focus(input);

          // Check if the input has the focus box-shadow class
          const classList = input.className;

          // Should have the focus box-shadow with 4px spread and 10% opacity
          expect(classList).toContain('[box-shadow:0_0_0_4px_var(--focus-ring)]');
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: input-primitive-compatibility, Property 29: Form Validation Logic Preservation (for search input)
  // **Validates: Requirements 11.3**
  it('should preserve onChange handler functionality', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), searchValue => {
        let capturedValue = '';
        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
          capturedValue = e.target.value;
        };

        const { container } = render(<AppSearchInput onChange={handleChange} />);

        const input = container.querySelector('input');
        expect(input).not.toBeNull();

        if (input) {
          // Simulate typing
          fireEvent.change(input, { target: { value: searchValue } });

          // Verify the handler captured the correct value
          expect(capturedValue).toBe(searchValue);
        }
      }),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify clear button functionality
  it('should clear input when clear button is clicked', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), searchValue => {
        let currentValue = searchValue;
        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
          currentValue = e.target.value;
        };
        const handleClear = () => {
          currentValue = '';
        };

        const { container, rerender } = render(
          <AppSearchInput
            value={currentValue}
            onChange={handleChange}
            onClear={handleClear}
            showClearButton
          />
        );

        // Clear button should be visible when there's a value
        const clearButton = container.querySelector('button');
        expect(clearButton).not.toBeNull();

        if (clearButton) {
          // Click clear button
          fireEvent.click(clearButton);

          // Value should be cleared
          expect(currentValue).toBe('');
        }
      }),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify search icon is present
  it('should have search icon', () => {
    fc.assert(
      fc.property(fc.constantFrom('sm', 'md', 'lg'), size => {
        const { container } = render(<AppSearchInput size={size as 'sm' | 'md' | 'lg'} />);

        // Should have an SVG icon (search icon from lucide-react)
        const svg = container.querySelector('svg');
        expect(svg).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify the shared primitive border radius
  it('should use the standard primitive border radius', () => {
    fc.assert(
      fc.property(fc.constantFrom('sm', 'md', 'lg'), size => {
        const { container } = render(<AppSearchInput size={size as 'sm' | 'md' | 'lg'} />);

        const input = container.querySelector('input');
        expect(input).not.toBeNull();

        if (input) {
          const classList = input.className;

          // Verify it has a rounded class
          const hasRoundedClass = classList.match(/rounded-\[(\d+)px\]/);
          expect(hasRoundedClass).not.toBeNull();

          if (hasRoundedClass) {
            const radiusValue = parseInt(hasRoundedClass[1]);

            // Should be one of the supported primitive values (8-16px range for inputs)
            expect(radiusValue).toBeGreaterThanOrEqual(8);
            expect(radiusValue).toBeLessThanOrEqual(16);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify no border (search input specific)
  it('should have no border', () => {
    fc.assert(
      fc.property(fc.constantFrom('sm', 'md', 'lg'), size => {
        const { container } = render(<AppSearchInput size={size as 'sm' | 'md' | 'lg'} />);

        const input = container.querySelector('input');
        expect(input).not.toBeNull();

        if (input) {
          const classList = input.className;

          // Should have border-none class
          expect(classList).toContain('border-none');
        }
      }),
      { numRuns: 100 }
    );
  });

  // Additional test: Verify disabled state
  it('should handle disabled state correctly', () => {
    fc.assert(
      fc.property(fc.boolean(), disabled => {
        const { container } = render(
          <AppSearchInput disabled={disabled} value="test" onChange={() => {}} />
        );

        const input = container.querySelector('input');
        expect(input).not.toBeNull();

        if (input) {
          // Verify disabled attribute
          expect(input.disabled).toBe(disabled);

          // Verify disabled styling
          if (disabled) {
            const classList = input.className;
            expect(classList).toContain('opacity-50');
            expect(classList).toContain('cursor-not-allowed');

            // Clear button should not be visible when disabled
            const clearButton = container.querySelector('button');
            expect(clearButton).toBeNull();
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
