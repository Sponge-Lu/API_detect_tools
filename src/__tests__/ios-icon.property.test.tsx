/**
 * Property-Based Tests for iOS Icon System
 * Feature: ios-ui-redesign
 *
 * Tests icon stroke consistency (Property 5)
 * Tests icon button ARIA labels (Property 39)
 *
 * @version 2.1.11
 * @created 2025-01-09
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { render, screen } from '@testing-library/react';
import {
  Settings,
  Trash2,
  Edit,
  Plus,
  X,
  Check,
  RefreshCw,
  Download,
  Search,
  Eye,
  EyeOff,
  ChevronDown,
  Calendar,
  Timer,
  TimerOff,
  Fuel,
  Pencil,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  Loader2,
} from 'lucide-react';
import { IOSIcon, IOSIconButton } from '../renderer/components/IOSIcon';

// All Lucide icons used in the project
const projectIcons = [
  { icon: Settings, name: 'Settings' },
  { icon: Trash2, name: 'Trash2' },
  { icon: Edit, name: 'Edit' },
  { icon: Plus, name: 'Plus' },
  { icon: X, name: 'X' },
  { icon: Check, name: 'Check' },
  { icon: RefreshCw, name: 'RefreshCw' },
  { icon: Download, name: 'Download' },
  { icon: Search, name: 'Search' },
  { icon: Eye, name: 'Eye' },
  { icon: EyeOff, name: 'EyeOff' },
  { icon: ChevronDown, name: 'ChevronDown' },
  { icon: Calendar, name: 'Calendar' },
  { icon: Timer, name: 'Timer' },
  { icon: TimerOff, name: 'TimerOff' },
  { icon: Fuel, name: 'Fuel' },
  { icon: Pencil, name: 'Pencil' },
  { icon: CheckCircle, name: 'CheckCircle' },
  { icon: XCircle, name: 'XCircle' },
  { icon: AlertTriangle, name: 'AlertTriangle' },
  { icon: Info, name: 'Info' },
  { icon: Loader2, name: 'Loader2' },
];

describe('iOS Icon System - Property Tests', () => {
  let styleElement: HTMLStyleElement;

  beforeEach(() => {
    // Inject iOS icon system CSS
    styleElement = document.createElement('style');
    styleElement.textContent = `
      /* iOS 图标系统 */
      .ios-icon {
        stroke-width: 2px;
        color: currentColor;
        flex-shrink: 0;
      }
      
      .ios-icon-sm {
        width: 16px;
        height: 16px;
      }
      
      .ios-icon-md {
        width: 20px;
        height: 20px;
      }
      
      .ios-icon-lg {
        width: 24px;
        height: 24px;
      }
      
      .ios-icon-primary {
        color: var(--ios-blue, #007AFF);
      }
      
      .ios-icon-success {
        color: var(--ios-green, #34C759);
      }
      
      .ios-icon-error {
        color: var(--ios-red, #FF3B30);
      }
      
      .ios-icon-warning {
        color: var(--ios-orange, #FF9500);
      }
      
      .ios-icon-muted {
        color: var(--ios-gray, #8E8E93);
      }
      
      .ios-icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 8px;
        border-radius: 12px;
        background: transparent;
        border: none;
        cursor: pointer;
      }
      
      /* 确保所有 lucide-react 图标默认使用 2px stroke-width */
      svg[class*="lucide"] {
        stroke-width: 2px;
      }
    `;
    document.head.appendChild(styleElement);
  });

  afterEach(() => {
    document.head.removeChild(styleElement);
  });

  // Feature: ios-ui-redesign, Property 5: Icon Stroke Consistency
  // *For any* icon component, the stroke-width should be 2px, and the width/height
  // should be one of the standard sizes: 16px, 20px, or 24px.
  // **Validates: Requirements 1.6, 9.2, 9.3**
  describe('Property 5: Icon Stroke Consistency', () => {
    it('should render IOSIcon with stroke-width of 2px', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...projectIcons),
          fc.constantFrom('sm', 'md', 'lg'),
          ({ icon, name }, size) => {
            const { container } = render(
              <IOSIcon icon={icon} size={size as 'sm' | 'md' | 'lg'} data-testid={`icon-${name}`} />
            );

            const svg = container.querySelector('svg');
            expect(svg).not.toBeNull();

            if (svg) {
              // Check stroke-width attribute
              const strokeWidth = svg.getAttribute('stroke-width');
              expect(strokeWidth).toBe('2');

              // Check that the icon has the ios-icon class
              expect(svg.classList.contains('ios-icon')).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should render IOSIcon with standard iOS sizes (16px, 20px, 24px)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...projectIcons),
          fc.constantFrom('sm', 'md', 'lg'),
          ({ icon, name }, size) => {
            const { container } = render(
              <IOSIcon icon={icon} size={size as 'sm' | 'md' | 'lg'} data-testid={`icon-${name}`} />
            );

            const svg = container.querySelector('svg');
            expect(svg).not.toBeNull();

            if (svg) {
              // Check width and height attributes
              const width = svg.getAttribute('width');
              const height = svg.getAttribute('height');

              // Valid sizes: 16, 20, 24
              const validSizes = ['16', '20', '24'];
              expect(validSizes).toContain(width);
              expect(validSizes).toContain(height);

              // Width and height should match
              expect(width).toBe(height);

              // Verify size mapping
              const expectedSizes: Record<string, string> = {
                sm: '16',
                md: '20',
                lg: '24',
              };
              expect(width).toBe(expectedSizes[size]);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should apply correct size CSS class', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...projectIcons),
          fc.constantFrom('sm', 'md', 'lg'),
          ({ icon }, size) => {
            const { container } = render(<IOSIcon icon={icon} size={size as 'sm' | 'md' | 'lg'} />);

            const svg = container.querySelector('svg');
            expect(svg).not.toBeNull();

            if (svg) {
              const sizeClassMap: Record<string, string> = {
                sm: 'ios-icon-sm',
                md: 'ios-icon-md',
                lg: 'ios-icon-lg',
              };

              expect(svg.classList.contains(sizeClassMap[size])).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should apply color variant CSS class', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...projectIcons),
          fc.constantFrom('default', 'primary', 'success', 'error', 'warning', 'muted'),
          ({ icon }, variant) => {
            const { container } = render(
              <IOSIcon
                icon={icon}
                variant={
                  variant as 'default' | 'primary' | 'success' | 'error' | 'warning' | 'muted'
                }
              />
            );

            const svg = container.querySelector('svg');
            expect(svg).not.toBeNull();

            if (svg) {
              if (variant !== 'default') {
                const variantClassMap: Record<string, string> = {
                  primary: 'ios-icon-primary',
                  success: 'ios-icon-success',
                  error: 'ios-icon-error',
                  warning: 'ios-icon-warning',
                  muted: 'ios-icon-muted',
                };

                expect(svg.classList.contains(variantClassMap[variant])).toBe(true);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ios-ui-redesign, Property 39: Icon Button ARIA Labels
  // *For any* button containing only an icon (no text), it should have an
  // aria-label or title attribute describing its function.
  // **Validates: Requirements 13.4**
  describe('Property 39: Icon Button ARIA Labels', () => {
    it('should render IOSIconButton with aria-label attribute', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...projectIcons),
          fc.string({ minLength: 1, maxLength: 50 }),
          ({ icon, name }, label) => {
            // Filter out empty or whitespace-only labels
            const trimmedLabel = label.trim();
            if (trimmedLabel.length === 0) return true; // Skip empty labels

            const { container } = render(
              <IOSIconButton icon={icon} label={trimmedLabel} data-testid={`icon-button-${name}`} />
            );

            const button = container.querySelector('button');
            expect(button).not.toBeNull();

            if (button) {
              // Check aria-label attribute
              const ariaLabel = button.getAttribute('aria-label');
              expect(ariaLabel).toBe(trimmedLabel);

              // Check title attribute (for tooltip)
              const title = button.getAttribute('title');
              expect(title).toBe(trimmedLabel);
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have accessible name for screen readers', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...projectIcons),
          fc.constantFrom(
            '设置',
            '删除',
            '编辑',
            '添加',
            '关闭',
            '确认',
            '刷新',
            '下载',
            '搜索',
            '显示密码',
            '隐藏密码',
            '展开',
            '收起',
            '签到',
            '自动刷新',
            '加油站'
          ),
          ({ icon }, label) => {
            const { container, unmount } = render(<IOSIconButton icon={icon} label={label} />);

            // The button should have aria-label for accessibility
            const button = container.querySelector('button');
            expect(button).not.toBeNull();

            if (button) {
              const ariaLabel = button.getAttribute('aria-label');
              expect(ariaLabel).toBe(label);
            }

            // Cleanup after each iteration to avoid duplicate elements
            unmount();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should hide icon from screen readers when button has label', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...projectIcons),
          fc.constantFrom('设置', '删除', '编辑', '添加', '关闭'),
          ({ icon }, label) => {
            const { container } = render(<IOSIconButton icon={icon} label={label} />);

            const svg = container.querySelector('svg');
            expect(svg).not.toBeNull();

            if (svg) {
              // Icon should be hidden from screen readers
              const ariaHidden = svg.getAttribute('aria-hidden');
              expect(ariaHidden).toBe('true');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow disabling tooltip while keeping aria-label', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...projectIcons),
          fc.constantFrom('设置', '删除', '编辑'),
          fc.boolean(),
          ({ icon }, label, showTooltip) => {
            const { container } = render(
              <IOSIconButton icon={icon} label={label} showTooltip={showTooltip} />
            );

            const button = container.querySelector('button');
            expect(button).not.toBeNull();

            if (button) {
              // aria-label should always be present
              expect(button.getAttribute('aria-label')).toBe(label);

              // title should only be present if showTooltip is true
              const title = button.getAttribute('title');
              if (showTooltip) {
                expect(title).toBe(label);
              } else {
                expect(title).toBeNull();
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have ios-icon-button class for consistent styling', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...projectIcons),
          fc.constantFrom('设置', '删除', '编辑'),
          ({ icon }, label) => {
            const { container } = render(<IOSIconButton icon={icon} label={label} />);

            const button = container.querySelector('button');
            expect(button).not.toBeNull();

            if (button) {
              expect(button.classList.contains('ios-icon-button')).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle disabled state correctly', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...projectIcons),
          fc.constantFrom('设置', '删除', '编辑'),
          fc.boolean(),
          ({ icon }, label, disabled) => {
            const { container } = render(
              <IOSIconButton icon={icon} label={label} disabled={disabled} />
            );

            const button = container.querySelector('button');
            expect(button).not.toBeNull();

            if (button) {
              expect(button.disabled).toBe(disabled);

              // aria-label should still be present when disabled
              expect(button.getAttribute('aria-label')).toBe(label);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Additional tests for IOSIcon component
  describe('IOSIcon Additional Properties', () => {
    it('should pass through additional props to SVG element', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...projectIcons),
          // Use alphanumeric strings only to avoid CSS selector issues
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]*$/),
          ({ icon }, testId) => {
            if (testId.length === 0) return true;

            const { container } = render(<IOSIcon icon={icon} data-testid={testId} />);

            const svg = container.querySelector(`[data-testid="${testId}"]`);
            expect(svg).not.toBeNull();

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should support aria-label for standalone icons', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...projectIcons),
          fc.constantFrom('成功', '错误', '警告', '信息'),
          ({ icon }, label) => {
            const { container } = render(<IOSIcon icon={icon} aria-label={label} />);

            const svg = container.querySelector('svg');
            expect(svg).not.toBeNull();

            if (svg) {
              expect(svg.getAttribute('aria-label')).toBe(label);
              // When aria-label is provided, aria-hidden should not be true
              expect(svg.getAttribute('aria-hidden')).not.toBe('true');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should set aria-hidden when no aria-label is provided', () => {
      fc.assert(
        fc.property(fc.constantFrom(...projectIcons), ({ icon }) => {
          const { container } = render(<IOSIcon icon={icon} />);

          const svg = container.querySelector('svg');
          expect(svg).not.toBeNull();

          if (svg) {
            // When no aria-label, icon should be hidden from screen readers
            expect(svg.getAttribute('aria-hidden')).toBe('true');
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});
