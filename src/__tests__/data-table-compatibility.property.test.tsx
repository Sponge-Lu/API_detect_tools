/**
 * @file src/__tests__/data-table-compatibility.property.test.tsx
 * @description DataTable 兼容属性测试
 *
 * Feature: data-table-compatibility
 *
 * 测试属性:
 * - Property 22: Table Row Height
 * - Property 23: Table Header Styling
 * - Property 7: Separator Line Styling
 *
 * @version 2.1.11
 * @updated 2025-01-08 - 创建表格原语属性测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { render } from '@testing-library/react';
import {
  DataTable,
  DataTableHeader,
  DataTableRow,
  DataTableCell,
  DataTableBody,
  DataTableDivider,
  DataTableEmpty,
} from '../renderer/components/DataTable/DataTable';

describe('DataTable Compatibility - Property Tests', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    // Inject neutral theme variables for data table tests
    styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        --surface-1: #ffffff;
        --surface-2: #f4f1ec;
        --surface-3: #ebe6de;
        --text-primary: #000000;
        --text-secondary: rgba(60, 60, 67, 0.6);
        --line-soft: rgba(60, 60, 67, 0.29);
        --accent: #5b6a62;
        --icon-muted: #8e8e93;
        --spacing-xs: 4px;
        --spacing-sm: 8px;
        --spacing-md: 12px;
        --spacing-lg: 16px;
        --spacing-xl: 20px;
        --spacing-2xl: 24px;
        --spacing-4xl: 40px;
        --radius-sm: 8px;
        --radius-md: 12px;
        --radius-lg: 16px;
        --radius-xl: 20px;
        --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
        --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);
        --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.10), 0 4px 8px rgba(0, 0, 0, 0.06);
        --duration-fast: 200ms;
        --duration-normal: 300ms;
        --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      .dark {
        --surface-1: #1d1f23;
        --surface-2: #252930;
        --line-soft: rgba(84, 84, 88, 0.65);
      }
      
      @keyframes slideIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
    document.documentElement.classList.remove('dark');
  });

  // Feature: data-table-compatibility, Property 22: Table Row Height
  // *For any* table row, the min-height should be at least 44px (minimum touch target) with padding of at least 12px.
  // **Validates: Requirements 8.2**
  describe('Property 22: Table Row Height', () => {
    it('should have minimum height of 44px for all table rows', () => {
      fc.assert(
        fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (hoverable, selected, disabled) => {
          const { container } = render(
            <DataTable>
              <DataTableBody>
                <DataTableRow hoverable={hoverable} selected={selected} disabled={disabled}>
                  <DataTableCell>Test Content</DataTableCell>
                </DataTableRow>
              </DataTableBody>
            </DataTable>
          );

          const row = container.querySelector('.data-table-row');
          expect(row).not.toBeNull();

          if (row) {
            const classList = row.className;
            // Should have min-height of 44px
            expect(classList).toContain('min-h-[44px]');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should have padding of at least 12px (spacing-md)', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10 }), animationIndex => {
          const { container } = render(
            <DataTable>
              <DataTableBody>
                <DataTableRow animationIndex={animationIndex}>
                  <DataTableCell>Test Content</DataTableCell>
                </DataTableRow>
              </DataTableBody>
            </DataTable>
          );

          const row = container.querySelector('.data-table-row');
          expect(row).not.toBeNull();

          if (row) {
            const classList = row.className;
            // Should have padding using spacing-lg (16px) horizontally and spacing-md (12px) vertically
            expect(classList).toContain('px-[var(--spacing-lg)]');
            expect(classList).toContain('py-[var(--spacing-md)]');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // Feature: data-table-compatibility, Property 23: Table Header Styling
  // *For any* table header, the font-size should be 13px, font-weight should be 600, and text-transform should be uppercase.
  // **Validates: Requirements 8.5**
  describe('Property 23: Table Header Styling', () => {
    it('should have correct font styling for table header', () => {
      fc.assert(
        fc.property(fc.boolean(), sticky => {
          const { container } = render(
            <DataTable>
              <DataTableHeader sticky={sticky}>
                <DataTableCell header>Header Content</DataTableCell>
              </DataTableHeader>
            </DataTable>
          );

          const header = container.querySelector('.data-table-header');
          expect(header).not.toBeNull();

          if (header) {
            const classList = header.className;
            // Should have font-size of 13px
            expect(classList).toContain('text-[13px]');
            // Should have font-weight of 600 (semibold)
            expect(classList).toContain('font-semibold');
            // Should have uppercase text
            expect(classList).toContain('uppercase');
            // Should have letter-spacing of 0.5px
            expect(classList).toContain('tracking-[0.08em]');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should have correct styling for header cells', () => {
      fc.assert(
        fc.property(fc.constantFrom('left', 'center', 'right'), align => {
          const { container } = render(
            <DataTable>
              <DataTableHeader>
                <DataTableCell header align={align as 'left' | 'center' | 'right'}>
                  Header Cell
                </DataTableCell>
              </DataTableHeader>
            </DataTable>
          );

          const cell = container.querySelector('.data-table-cell');
          expect(cell).not.toBeNull();

          if (cell) {
            const classList = cell.className;
            // Header cells should have specific styling
            expect(classList).toContain('text-[13px]');
            expect(classList).toContain('font-semibold');
            expect(classList).toContain('uppercase');
            expect(classList).toContain('tracking-[0.08em]');
            expect(classList).toContain('text-[var(--text-secondary)]');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should support sticky positioning', () => {
      fc.assert(
        fc.property(fc.boolean(), sticky => {
          const { container } = render(
            <DataTable>
              <DataTableHeader sticky={sticky}>
                <DataTableCell header>Header</DataTableCell>
              </DataTableHeader>
            </DataTable>
          );

          const header = container.querySelector('.data-table-header');
          expect(header).not.toBeNull();

          if (header) {
            const classList = header.className;

            if (sticky) {
              expect(classList).toContain('sticky');
              expect(classList).toContain('top-0');
              expect(classList).toContain('z-10');
              expect(classList).toContain('backdrop-blur-[12px]');
            } else {
              expect(classList).not.toContain('sticky');
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // Feature: data-table-compatibility, Property 7: Separator Line Styling
  // *For any* separator or divider element, the border-width should be 1px and the color should have low opacity (< 0.3 in light mode, < 0.7 in dark mode).
  // **Validates: Requirements 6.3, 8.3**
  describe('Property 7: Separator Line Styling', () => {
    it('should have 1px border for row separators', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 5 }), rowCount => {
          const rows = Array.from({ length: rowCount }, (_, i) => (
            <DataTableRow key={i}>
              <DataTableCell>Row {i + 1}</DataTableCell>
            </DataTableRow>
          ));

          const { container } = render(
            <DataTable>
              <DataTableBody>{rows}</DataTableBody>
            </DataTable>
          );

          const tableRows = container.querySelectorAll('.data-table-row');
          expect(tableRows.length).toBe(rowCount);

          tableRows.forEach(row => {
            const classList = row.className;
            // Should have border-bottom
            expect(classList).toContain('border-b');
            // Should use the shared separator token (low opacity)
            expect(classList).toContain('border-[var(--line-soft)]');
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should remove border from last row', () => {
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 5 }), rowCount => {
          const rows = Array.from({ length: rowCount }, (_, i) => (
            <DataTableRow key={i}>
              <DataTableCell>Row {i + 1}</DataTableCell>
            </DataTableRow>
          ));

          const { container } = render(
            <DataTable>
              <DataTableBody>{rows}</DataTableBody>
            </DataTable>
          );

          const tableRows = container.querySelectorAll('.data-table-row');
          expect(tableRows.length).toBe(rowCount);

          // All rows should have the last:border-b-0 class
          tableRows.forEach(row => {
            const classList = row.className;
            expect(classList).toContain('last:border-b-0');
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should have correct styling for DataTableDivider', () => {
      fc.assert(
        fc.property(fc.boolean(), inset => {
          const { container } = render(
            <DataTable>
              <DataTableDivider inset={inset} />
            </DataTable>
          );

          const divider = container.querySelector('.data-table-divider');
          expect(divider).not.toBeNull();

          if (divider) {
            const classList = divider.className;
            // Should have height of 1px
            expect(classList).toContain('h-px');
            // Should use the shared separator token
            expect(classList).toContain('bg-[var(--line-soft)]');

            if (inset) {
              // Should have left margin when inset
              expect(classList).toContain('ml-[var(--spacing-lg)]');
            } else {
              expect(classList).not.toContain('ml-[var(--spacing-lg)]');
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should have border on table header', () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          const { container } = render(
            <DataTable>
              <DataTableHeader>
                <DataTableCell header>Header</DataTableCell>
              </DataTableHeader>
            </DataTable>
          );

          const header = container.querySelector('.data-table-header');
          expect(header).not.toBeNull();

          if (header) {
            const classList = header.className;
            // Should have border-bottom
            expect(classList).toContain('border-b');
            expect(classList).toContain('border-[var(--line-soft)]');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // Additional tests for the data table compatibility layer

  describe('DataTable Variants', () => {
    it('should apply correct styles for each variant', () => {
      fc.assert(
        fc.property(fc.constantFrom('standard', 'grouped', 'inset'), variant => {
          const { container } = render(
            <DataTable variant={variant as 'standard' | 'grouped' | 'inset'}>
              <DataTableBody>
                <DataTableRow>
                  <DataTableCell>Content</DataTableCell>
                </DataTableRow>
              </DataTableBody>
            </DataTable>
          );

          const table = container.querySelector('.data-table');
          expect(table).not.toBeNull();

          if (table) {
            const classList = table.className;

            // All variants should have border radius
            expect(classList).toContain('rounded-[var(--radius-lg)]');

            if (variant === 'standard') {
              expect(classList).toContain('bg-[var(--surface-1)]');
              expect(classList).toContain('shadow-[var(--shadow-sm)]');
            } else if (variant === 'grouped') {
              expect(classList).toContain('bg-[var(--surface-1)]');
              expect(classList).toContain('shadow-[var(--shadow-sm)]');
            } else if (variant === 'inset') {
              expect(classList).toContain('bg-transparent');
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('DataTableRow Hover State', () => {
    it('should apply hover styles when hoverable', () => {
      fc.assert(
        fc.property(fc.boolean(), fc.boolean(), (hoverable, disabled) => {
          const { container } = render(
            <DataTable>
              <DataTableBody>
                <DataTableRow hoverable={hoverable} disabled={disabled}>
                  <DataTableCell>Content</DataTableCell>
                </DataTableRow>
              </DataTableBody>
            </DataTable>
          );

          const row = container.querySelector('.data-table-row');
          expect(row).not.toBeNull();

          if (row) {
            const classList = row.className;

            if (hoverable && !disabled) {
              // Should have hover background change
              expect(classList).toContain('hover:bg-[var(--surface-2)]');
              expect(classList).toContain('cursor-pointer');
            } else {
              expect(classList).not.toContain('hover:bg-[var(--surface-2)]');
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('DataTableRow Selected State', () => {
    it('should apply selected styles when selected', () => {
      fc.assert(
        fc.property(fc.boolean(), selected => {
          const { container } = render(
            <DataTable>
              <DataTableBody>
                <DataTableRow selected={selected}>
                  <DataTableCell>Content</DataTableCell>
                </DataTableRow>
              </DataTableBody>
            </DataTable>
          );

          const row = container.querySelector('.data-table-row');
          expect(row).not.toBeNull();

          if (row) {
            const classList = row.className;

            if (selected) {
              expect(classList).toContain('bg-[var(--accent-soft)]');
            } else {
              expect(classList).not.toContain('bg-[var(--accent-soft)]');
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('DataTableCell Alignment', () => {
    it('should apply correct alignment styles', () => {
      fc.assert(
        fc.property(fc.constantFrom('left', 'center', 'right'), align => {
          const { container } = render(
            <DataTable>
              <DataTableBody>
                <DataTableRow>
                  <DataTableCell align={align as 'left' | 'center' | 'right'}>
                    Content
                  </DataTableCell>
                </DataTableRow>
              </DataTableBody>
            </DataTable>
          );

          const cell = container.querySelector('.data-table-cell');
          expect(cell).not.toBeNull();

          if (cell) {
            const classList = cell.className;

            if (align === 'left') {
              expect(classList).toContain('text-left');
              expect(classList).toContain('justify-start');
            } else if (align === 'center') {
              expect(classList).toContain('text-center');
              expect(classList).toContain('justify-center');
            } else if (align === 'right') {
              expect(classList).toContain('text-right');
              expect(classList).toContain('justify-end');
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('DataTable Empty State', () => {
    it('should render empty state with correct styling', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 100 }),
          (title, description) => {
            const { container } = render(
              <DataTable>
                <DataTableEmpty title={title} description={description} />
              </DataTable>
            );

            const empty = container.querySelector('.data-table-empty');
            expect(empty).not.toBeNull();

            if (empty) {
              const classList = empty.className;
              // Should be centered
              expect(classList).toContain('flex');
              expect(classList).toContain('flex-col');
              expect(classList).toContain('items-center');
              expect(classList).toContain('justify-center');
              expect(classList).toContain('text-center');
              // Should have vertical padding
              expect(classList).toContain('py-[var(--spacing-4xl)]');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('DataTable Stagger Animation', () => {
    it('should apply animation delay based on index', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10 }), animationIndex => {
          const { container } = render(
            <DataTable staggerAnimation>
              <DataTableBody>
                <DataTableRow animationIndex={animationIndex}>
                  <DataTableCell>Content</DataTableCell>
                </DataTableRow>
              </DataTableBody>
            </DataTable>
          );

          const row = container.querySelector('.data-table-row') as HTMLElement;
          expect(row).not.toBeNull();

          if (row) {
            // Should have animation class
            const classList = row.className;
            expect(classList).toContain(
              'animate-[slideIn_var(--duration-normal)_var(--ease-standard)_both]'
            );

            // Should have animation delay based on index (capped at 500ms)
            const expectedDelay = Math.min(animationIndex * 50, 500);
            expect(row.style.animationDelay).toBe(`${expectedDelay}ms`);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('DataTable ARIA Roles', () => {
    it('should have correct ARIA roles', () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          const { container } = render(
            <DataTable>
              <DataTableHeader>
                <DataTableCell header>Header</DataTableCell>
              </DataTableHeader>
              <DataTableBody>
                <DataTableRow>
                  <DataTableCell>Cell</DataTableCell>
                </DataTableRow>
              </DataTableBody>
            </DataTable>
          );

          const table = container.querySelector('.data-table');
          const header = container.querySelector('.data-table-header');
          const body = container.querySelector('.data-table-body');
          const row = container.querySelector('.data-table-row');
          const headerCell = container.querySelector('.data-table-cell[role="columnheader"]');
          const cell = container.querySelector('.data-table-cell[role="cell"]');

          expect(table?.getAttribute('role')).toBe('table');
          expect(header?.getAttribute('role')).toBe('rowgroup');
          expect(body?.getAttribute('role')).toBe('rowgroup');
          expect(row?.getAttribute('role')).toBe('row');
          expect(headerCell).not.toBeNull();
          expect(cell).not.toBeNull();
        }),
        { numRuns: 100 }
      );
    });
  });
});
