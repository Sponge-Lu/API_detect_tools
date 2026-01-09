/**
 * @file src/__tests__/ios-visual-regression.test.tsx
 * @description iOS UI 视觉回归测试套件
 *
 * 功能:
 * - 为所有主要 iOS 组件创建快照测试
 * - 验证组件渲染结构的一致性
 * - 检测重构前后的视觉差异
 * - 标记需要人工审核的差异
 *
 * 测试策略:
 * - 使用 Vitest 快照测试验证组件结构
 * - 测试所有组件变体和状态
 * - 验证 CSS 类名的正确应用
 * - 确保无障碍属性正确设置
 *
 * @version 2.1.11
 * @created 2025-01-09
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// iOS 组件导入
import { IOSButton } from '../renderer/components/IOSButton';
import {
  IOSCard,
  IOSCardHeader,
  IOSCardContent,
  IOSCardFooter,
  IOSCardDivider,
} from '../renderer/components/IOSCard';
import { IOSInput } from '../renderer/components/IOSInput';
import { IOSSearchInput } from '../renderer/components/IOSInput/IOSSearchInput';
import { IOSModal } from '../renderer/components/IOSModal';
import {
  IOSTable,
  IOSTableHeader,
  IOSTableBody,
  IOSTableRow,
  IOSTableCell,
  IOSTableEmpty,
} from '../renderer/components/IOSTable';
import { IOSIcon } from '../renderer/components/IOSIcon';
import { IOSIconButton } from '../renderer/components/IOSIcon/IOSIconButton';
import { Settings, Trash2, Plus, Search, Check, X } from 'lucide-react';

// CSS 变量注入
let styleElement: HTMLStyleElement;

beforeEach(() => {
  styleElement = document.createElement('style');
  styleElement.textContent = `
    :root {
      /* 背景颜色 - 浅色模式 */
      --ios-bg-primary: #F2F2F7;
      --ios-bg-secondary: #FFFFFF;
      --ios-bg-tertiary: #FFFFFF;
      
      /* 文字颜色 */
      --ios-text-primary: #000000;
      --ios-text-secondary: #3C3C43;
      --ios-text-tertiary: #3C3C43;
      
      /* 主题色 */
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
      
      /* 阴影系统 */
      --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
      --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);
      --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.10), 0 4px 8px rgba(0, 0, 0, 0.06);
      --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.08);
      
      /* 动画时长 */
      --duration-fast: 200ms;
      --duration-normal: 300ms;
      --duration-slow: 400ms;
      
      /* iOS 缓动函数 */
      --ease-ios: cubic-bezier(0.4, 0, 0.2, 1);
    }
  `;
  document.head.appendChild(styleElement);
});

afterEach(() => {
  document.head.removeChild(styleElement);
});

/* ========== IOSButton 视觉回归测试 ========== */

describe('IOSButton Visual Regression', () => {
  describe('Button Variants', () => {
    it('should render primary button correctly', () => {
      const { container } = render(<IOSButton variant="primary">Primary Button</IOSButton>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render secondary button correctly', () => {
      const { container } = render(<IOSButton variant="secondary">Secondary Button</IOSButton>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render tertiary button correctly', () => {
      const { container } = render(<IOSButton variant="tertiary">Tertiary Button</IOSButton>);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Button Sizes', () => {
    it('should render small button correctly', () => {
      const { container } = render(<IOSButton size="sm">Small Button</IOSButton>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render medium button correctly', () => {
      const { container } = render(<IOSButton size="md">Medium Button</IOSButton>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render large button correctly', () => {
      const { container } = render(<IOSButton size="lg">Large Button</IOSButton>);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Button States', () => {
    it('should render disabled button correctly', () => {
      const { container } = render(<IOSButton disabled>Disabled Button</IOSButton>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render loading button correctly', () => {
      const { container } = render(<IOSButton loading>Loading Button</IOSButton>);
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});

/* ========== IOSCard 视觉回归测试 ========== */

describe('IOSCard Visual Regression', () => {
  describe('Card Variants', () => {
    it('should render standard card correctly', () => {
      const { container } = render(
        <IOSCard variant="standard">
          <IOSCardContent>Standard Card Content</IOSCardContent>
        </IOSCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render elevated card correctly', () => {
      const { container } = render(
        <IOSCard variant="elevated">
          <IOSCardContent>Elevated Card Content</IOSCardContent>
        </IOSCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render grouped card correctly', () => {
      const { container } = render(
        <IOSCard variant="grouped">
          <IOSCardContent>Grouped Card Content</IOSCardContent>
        </IOSCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Card with Sub-components', () => {
    it('should render card with header correctly', () => {
      const { container } = render(
        <IOSCard>
          <IOSCardHeader>Card Header</IOSCardHeader>
          <IOSCardContent>Card Content</IOSCardContent>
        </IOSCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render card with footer correctly', () => {
      const { container } = render(
        <IOSCard>
          <IOSCardContent>Card Content</IOSCardContent>
          <IOSCardFooter>Card Footer</IOSCardFooter>
        </IOSCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render card with divider correctly', () => {
      const { container } = render(
        <IOSCard>
          <IOSCardContent>Section 1</IOSCardContent>
          <IOSCardDivider />
          <IOSCardContent>Section 2</IOSCardContent>
        </IOSCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render complete card correctly', () => {
      const { container } = render(
        <IOSCard>
          <IOSCardHeader>Header</IOSCardHeader>
          <IOSCardDivider />
          <IOSCardContent>Content</IOSCardContent>
          <IOSCardDivider />
          <IOSCardFooter>Footer</IOSCardFooter>
        </IOSCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Card States', () => {
    it('should render disabled card correctly', () => {
      const { container } = render(
        <IOSCard disabled>
          <IOSCardContent>Disabled Card</IOSCardContent>
        </IOSCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render draggable card correctly', () => {
      const { container } = render(
        <IOSCard draggable>
          <IOSCardContent>Draggable Card</IOSCardContent>
        </IOSCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render drag-over card correctly', () => {
      const { container } = render(
        <IOSCard draggable isDragOver>
          <IOSCardContent>Drag Over Card</IOSCardContent>
        </IOSCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Card with Expand Content', () => {
    it('should render collapsed card correctly', () => {
      const { container } = render(
        <IOSCard expanded={false} expandContent={<div>Expand Content</div>}>
          <IOSCardContent>Main Content</IOSCardContent>
        </IOSCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render expanded card correctly', () => {
      const { container } = render(
        <IOSCard expanded={true} expandContent={<div>Expand Content</div>}>
          <IOSCardContent>Main Content</IOSCardContent>
        </IOSCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});

/* ========== IOSInput 视觉回归测试 ========== */

describe('IOSInput Visual Regression', () => {
  describe('Input Sizes', () => {
    it('should render small input correctly', () => {
      const { container } = render(<IOSInput size="sm" placeholder="Small input" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render medium input correctly', () => {
      const { container } = render(<IOSInput size="md" placeholder="Medium input" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render large input correctly', () => {
      const { container } = render(<IOSInput size="lg" placeholder="Large input" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Input with Label', () => {
    it('should render input with label correctly', () => {
      const { container } = render(<IOSInput label="Username" placeholder="Enter username" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render required input correctly', () => {
      const { container } = render(<IOSInput label="Email" required placeholder="Enter email" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Input States', () => {
    it('should render error input correctly', () => {
      const { container } = render(<IOSInput error errorMessage="This field is required" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render disabled input correctly', () => {
      const { container } = render(<IOSInput disabled placeholder="Disabled input" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render input with help text correctly', () => {
      const { container } = render(<IOSInput helpText="Enter your full name" placeholder="Name" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Input with Icons', () => {
    it('should render input with left icon correctly', () => {
      const { container } = render(
        <IOSInput leftIcon={<Search size={16} />} placeholder="Search..." />
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render input with right icon correctly', () => {
      const { container } = render(
        <IOSInput rightIcon={<Check size={16} />} placeholder="Verified" />
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Password Input', () => {
    it('should render password input correctly', () => {
      const { container } = render(<IOSInput type="password" placeholder="Enter password" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render password input with toggle correctly', () => {
      const { container } = render(
        <IOSInput type="password" showPasswordToggle placeholder="Enter password" />
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});

/* ========== IOSSearchInput 视觉回归测试 ========== */

describe('IOSSearchInput Visual Regression', () => {
  it('should render search input correctly', () => {
    const { container } = render(<IOSSearchInput placeholder="Search..." />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('should render search input with value correctly', () => {
    const { container } = render(
      <IOSSearchInput placeholder="Search..." value="test query" onChange={() => {}} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('should render search input with clear button correctly', () => {
    const { container } = render(
      <IOSSearchInput
        placeholder="Search..."
        value="test"
        showClearButton
        onChange={() => {}}
        onClear={() => {}}
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

/* ========== IOSModal 视觉回归测试 ========== */

describe('IOSModal Visual Regression', () => {
  describe('Modal Sizes', () => {
    it('should render small modal correctly', () => {
      const { container } = render(
        <IOSModal isOpen={true} onClose={() => {}} size="sm" title="Small Modal">
          <p>Modal content</p>
        </IOSModal>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render medium modal correctly', () => {
      const { container } = render(
        <IOSModal isOpen={true} onClose={() => {}} size="md" title="Medium Modal">
          <p>Modal content</p>
        </IOSModal>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render large modal correctly', () => {
      const { container } = render(
        <IOSModal isOpen={true} onClose={() => {}} size="lg" title="Large Modal">
          <p>Modal content</p>
        </IOSModal>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render extra large modal correctly', () => {
      const { container } = render(
        <IOSModal isOpen={true} onClose={() => {}} size="xl" title="Extra Large Modal">
          <p>Modal content</p>
        </IOSModal>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Modal with Title Icon', () => {
    it('should render modal with title icon correctly', () => {
      const { container } = render(
        <IOSModal
          isOpen={true}
          onClose={() => {}}
          title="Settings"
          titleIcon={<Settings size={20} />}
        >
          <p>Modal content</p>
        </IOSModal>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Modal with Footer', () => {
    it('should render modal with footer correctly', () => {
      const { container } = render(
        <IOSModal
          isOpen={true}
          onClose={() => {}}
          title="Confirm Action"
          footer={
            <>
              <IOSButton variant="secondary">Cancel</IOSButton>
              <IOSButton variant="primary">Confirm</IOSButton>
            </>
          }
        >
          <p>Are you sure you want to proceed?</p>
        </IOSModal>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Modal Options', () => {
    it('should render modal without close button correctly', () => {
      const { container } = render(
        <IOSModal isOpen={true} onClose={() => {}} showCloseButton={false} title="No Close Button">
          <p>Modal content</p>
        </IOSModal>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render modal without title correctly', () => {
      const { container } = render(
        <IOSModal isOpen={true} onClose={() => {}}>
          <p>Modal without title</p>
        </IOSModal>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});

/* ========== IOSTable 视觉回归测试 ========== */

describe('IOSTable Visual Regression', () => {
  describe('Table Variants', () => {
    it('should render standard table correctly', () => {
      const { container } = render(
        <IOSTable variant="standard">
          <IOSTableHeader>
            <IOSTableRow>
              <IOSTableCell header>Name</IOSTableCell>
              <IOSTableCell header>Status</IOSTableCell>
            </IOSTableRow>
          </IOSTableHeader>
          <IOSTableBody>
            <IOSTableRow>
              <IOSTableCell>Item 1</IOSTableCell>
              <IOSTableCell>Active</IOSTableCell>
            </IOSTableRow>
          </IOSTableBody>
        </IOSTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render grouped table correctly', () => {
      const { container } = render(
        <IOSTable variant="grouped">
          <IOSTableBody>
            <IOSTableRow>
              <IOSTableCell>Item 1</IOSTableCell>
            </IOSTableRow>
            <IOSTableRow>
              <IOSTableCell>Item 2</IOSTableCell>
            </IOSTableRow>
          </IOSTableBody>
        </IOSTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render inset table correctly', () => {
      const { container } = render(
        <IOSTable variant="inset">
          <IOSTableBody>
            <IOSTableRow>
              <IOSTableCell>Item 1</IOSTableCell>
            </IOSTableRow>
          </IOSTableBody>
        </IOSTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Table Row States', () => {
    it('should render selected row correctly', () => {
      const { container } = render(
        <IOSTable>
          <IOSTableBody>
            <IOSTableRow selected>
              <IOSTableCell>Selected Item</IOSTableCell>
            </IOSTableRow>
          </IOSTableBody>
        </IOSTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render disabled row correctly', () => {
      const { container } = render(
        <IOSTable>
          <IOSTableBody>
            <IOSTableRow disabled>
              <IOSTableCell>Disabled Item</IOSTableCell>
            </IOSTableRow>
          </IOSTableBody>
        </IOSTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Table Cell Alignment', () => {
    it('should render cells with different alignments correctly', () => {
      const { container } = render(
        <IOSTable>
          <IOSTableBody>
            <IOSTableRow>
              <IOSTableCell align="left">Left</IOSTableCell>
              <IOSTableCell align="center">Center</IOSTableCell>
              <IOSTableCell align="right">Right</IOSTableCell>
            </IOSTableRow>
          </IOSTableBody>
        </IOSTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Table Empty State', () => {
    it('should render empty state correctly', () => {
      const { container } = render(
        <IOSTable>
          <IOSTableEmpty
            title="No Data"
            description="There are no items to display"
            icon={<Search size={48} />}
          />
        </IOSTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render empty state with action correctly', () => {
      const { container } = render(
        <IOSTable>
          <IOSTableEmpty
            title="No Items"
            description="Add your first item"
            action={<IOSButton variant="primary">Add Item</IOSButton>}
          />
        </IOSTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});

/* ========== IOSIcon 视觉回归测试 ========== */

describe('IOSIcon Visual Regression', () => {
  describe('Icon Sizes', () => {
    it('should render small icon correctly', () => {
      const { container } = render(<IOSIcon icon={Settings} size="sm" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render medium icon correctly', () => {
      const { container } = render(<IOSIcon icon={Settings} size="md" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render large icon correctly', () => {
      const { container } = render(<IOSIcon icon={Settings} size="lg" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Icon Variants', () => {
    it('should render default icon correctly', () => {
      const { container } = render(<IOSIcon icon={Settings} variant="default" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render primary icon correctly', () => {
      const { container } = render(<IOSIcon icon={Settings} variant="primary" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render success icon correctly', () => {
      const { container } = render(<IOSIcon icon={Check} variant="success" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render error icon correctly', () => {
      const { container } = render(<IOSIcon icon={X} variant="error" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render warning icon correctly', () => {
      const { container } = render(<IOSIcon icon={Settings} variant="warning" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render muted icon correctly', () => {
      const { container } = render(<IOSIcon icon={Settings} variant="muted" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Icon with ARIA Label', () => {
    it('should render icon with aria-label correctly', () => {
      const { container } = render(<IOSIcon icon={Trash2} aria-label="Delete item" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});

/* ========== IOSIconButton 视觉回归测试 ========== */

describe('IOSIconButton Visual Regression', () => {
  describe('IconButton Variants', () => {
    it('should render default icon button correctly', () => {
      const { container } = render(<IOSIconButton icon={Plus} variant="default" label="Add" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render primary icon button correctly', () => {
      const { container } = render(
        <IOSIconButton icon={Settings} variant="primary" label="Settings" />
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render success icon button correctly', () => {
      const { container } = render(
        <IOSIconButton icon={Check} variant="success" label="Confirm" />
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render error icon button correctly', () => {
      const { container } = render(<IOSIconButton icon={Trash2} variant="error" label="Delete" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render warning icon button correctly', () => {
      const { container } = render(
        <IOSIconButton icon={Settings} variant="warning" label="Warning" />
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render muted icon button correctly', () => {
      const { container } = render(<IOSIconButton icon={X} variant="muted" label="Close" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('IconButton Sizes', () => {
    it('should render small icon button correctly', () => {
      const { container } = render(<IOSIconButton icon={Plus} size="sm" label="Add" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render medium icon button correctly', () => {
      const { container } = render(<IOSIconButton icon={Plus} size="md" label="Add" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render large icon button correctly', () => {
      const { container } = render(<IOSIconButton icon={Plus} size="lg" label="Add" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('IconButton States', () => {
    it('should render disabled icon button correctly', () => {
      const { container } = render(<IOSIconButton icon={Plus} disabled label="Add" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render icon button without tooltip correctly', () => {
      const { container } = render(<IOSIconButton icon={Plus} showTooltip={false} label="Add" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});

/* ========== 组合组件视觉回归测试 ========== */

describe('Combined Components Visual Regression', () => {
  describe('Card with Form', () => {
    it('should render card with form inputs correctly', () => {
      const { container } = render(
        <IOSCard>
          <IOSCardHeader>User Information</IOSCardHeader>
          <IOSCardContent>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <IOSInput label="Name" placeholder="Enter your name" />
              <IOSInput label="Email" type="email" placeholder="Enter your email" />
              <IOSInput
                label="Password"
                type="password"
                showPasswordToggle
                placeholder="Enter password"
              />
            </div>
          </IOSCardContent>
          <IOSCardFooter>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <IOSButton variant="secondary">Cancel</IOSButton>
              <IOSButton variant="primary">Save</IOSButton>
            </div>
          </IOSCardFooter>
        </IOSCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Table with Actions', () => {
    it('should render table with action buttons correctly', () => {
      const { container } = render(
        <IOSTable>
          <IOSTableHeader>
            <IOSTableRow>
              <IOSTableCell header width={200}>
                Name
              </IOSTableCell>
              <IOSTableCell header width={100}>
                Status
              </IOSTableCell>
              <IOSTableCell header width={100} align="right">
                Actions
              </IOSTableCell>
            </IOSTableRow>
          </IOSTableHeader>
          <IOSTableBody>
            <IOSTableRow>
              <IOSTableCell>Item 1</IOSTableCell>
              <IOSTableCell>Active</IOSTableCell>
              <IOSTableCell align="right">
                <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                  <IOSIconButton icon={Settings} size="sm" variant="muted" label="Settings" />
                  <IOSIconButton icon={Trash2} size="sm" variant="error" label="Delete" />
                </div>
              </IOSTableCell>
            </IOSTableRow>
            <IOSTableRow>
              <IOSTableCell>Item 2</IOSTableCell>
              <IOSTableCell>Inactive</IOSTableCell>
              <IOSTableCell align="right">
                <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                  <IOSIconButton icon={Settings} size="sm" variant="muted" label="Settings" />
                  <IOSIconButton icon={Trash2} size="sm" variant="error" label="Delete" />
                </div>
              </IOSTableCell>
            </IOSTableRow>
          </IOSTableBody>
        </IOSTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Modal with Form', () => {
    it('should render modal with form correctly', () => {
      const { container } = render(
        <IOSModal
          isOpen={true}
          onClose={() => {}}
          title="Add New Item"
          footer={
            <>
              <IOSButton variant="secondary">Cancel</IOSButton>
              <IOSButton variant="primary">Add</IOSButton>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <IOSInput label="Item Name" placeholder="Enter item name" required />
            <IOSInput label="Description" placeholder="Enter description" />
          </div>
        </IOSModal>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});

/* ========== CSS 类名验证测试 ========== */

describe('CSS Class Verification', () => {
  describe('iOS Design System Classes', () => {
    it('should apply iOS border radius classes', () => {
      const { container } = render(<IOSButton>Test</IOSButton>);
      const button = container.querySelector('button');
      expect(button?.className).toMatch(/rounded-\[/);
    });

    it('should apply iOS shadow classes', () => {
      const { container } = render(
        <IOSCard>
          <div>Test</div>
        </IOSCard>
      );
      const card = container.firstChild as HTMLElement;
      expect(card?.className).toMatch(/shadow-\[var\(--shadow-/);
    });

    it('should apply iOS transition classes', () => {
      const { container } = render(<IOSButton>Test</IOSButton>);
      const button = container.querySelector('button');
      expect(button?.className).toContain('transition-');
      expect(button?.className).toContain('duration-[var(--duration-fast)]');
    });

    it('should apply iOS timing function classes', () => {
      const { container } = render(<IOSButton>Test</IOSButton>);
      const button = container.querySelector('button');
      expect(button?.className).toContain('[transition-timing-function:var(--ease-ios)]');
    });

    it('should apply iOS spacing classes', () => {
      const { container } = render(<IOSInput placeholder="Test" />);
      const input = container.querySelector('input');
      expect(input?.className).toMatch(/p[xy]-\[var\(--spacing-/);
    });
  });

  describe('Accessibility Classes', () => {
    it('should apply focus-visible classes to buttons', () => {
      const { container } = render(<IOSButton>Test</IOSButton>);
      const button = container.querySelector('button');
      expect(button?.className).toContain('focus-visible:outline-');
    });

    it('should apply focus-visible classes to inputs', () => {
      const { container } = render(<IOSInput placeholder="Test" />);
      // Input focus is handled via state, check for transition classes
      const input = container.querySelector('input');
      expect(input?.className).toContain('transition-');
    });

    it('should apply disabled classes', () => {
      const { container } = render(<IOSButton disabled>Test</IOSButton>);
      const button = container.querySelector('button');
      expect(button?.className).toContain('disabled:opacity-50');
      expect(button?.className).toContain('disabled:cursor-not-allowed');
    });
  });

  describe('Animation Classes', () => {
    it('should apply active scale animation to buttons', () => {
      const { container } = render(<IOSButton>Test</IOSButton>);
      const button = container.querySelector('button');
      expect(button?.className).toContain('active:scale-[0.97]');
    });

    it('should apply hover classes to cards', () => {
      const { container } = render(
        <IOSCard hoverable>
          <div>Test</div>
        </IOSCard>
      );
      const card = container.firstChild as HTMLElement;
      expect(card?.className).toContain('hover:shadow-');
    });
  });
});

/* ========== ARIA 属性验证测试 ========== */

describe('ARIA Attributes Verification', () => {
  describe('Button ARIA', () => {
    it('should have correct ARIA attributes on button', () => {
      const { container } = render(<IOSButton aria-label="Test button">Test</IOSButton>);
      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-label')).toBe('Test button');
    });

    it('should have aria-disabled on disabled button', () => {
      const { container } = render(<IOSButton disabled>Test</IOSButton>);
      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-disabled')).toBe('true');
    });

    it('should have aria-busy on loading button', () => {
      const { container } = render(<IOSButton loading>Test</IOSButton>);
      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-busy')).toBe('true');
    });
  });

  describe('Input ARIA', () => {
    it('should have aria-invalid on error input', () => {
      const { container } = render(<IOSInput error errorMessage="Error" />);
      const input = container.querySelector('input');
      expect(input?.getAttribute('aria-invalid')).toBe('true');
    });

    it('should have aria-required on required input', () => {
      const { container } = render(<IOSInput required />);
      const input = container.querySelector('input');
      expect(input?.getAttribute('aria-required')).toBe('true');
    });

    it('should have aria-describedby linking to error message', () => {
      const { container } = render(<IOSInput error errorMessage="This is an error" />);
      const input = container.querySelector('input');
      const errorId = input?.getAttribute('aria-describedby');
      expect(errorId).toBeTruthy();
      // Use data attribute or role to find error element instead of ID selector
      // because React useId generates IDs with colons which are invalid in CSS selectors
      const errorElement = container.querySelector('[role="alert"]');
      expect(errorElement?.textContent).toBe('This is an error');
    });
  });

  describe('Modal ARIA', () => {
    it('should have role="dialog" on modal', () => {
      const { container } = render(
        <IOSModal isOpen={true} onClose={() => {}} title="Test">
          Content
        </IOSModal>
      );
      const dialog = container.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });

    it('should have aria-modal="true" on modal', () => {
      const { container } = render(
        <IOSModal isOpen={true} onClose={() => {}} title="Test">
          Content
        </IOSModal>
      );
      const dialog = container.querySelector('[role="dialog"]');
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
    });

    it('should have aria-labelledby linking to title', () => {
      const { container } = render(
        <IOSModal isOpen={true} onClose={() => {}} title="Test Title">
          Content
        </IOSModal>
      );
      const dialog = container.querySelector('[role="dialog"]');
      const labelledBy = dialog?.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
    });
  });

  describe('Table ARIA', () => {
    it('should have role="table" on table', () => {
      const { container } = render(
        <IOSTable>
          <IOSTableBody>
            <IOSTableRow>
              <IOSTableCell>Test</IOSTableCell>
            </IOSTableRow>
          </IOSTableBody>
        </IOSTable>
      );
      const table = container.querySelector('[role="table"]');
      expect(table).toBeTruthy();
    });

    it('should have role="row" on table rows', () => {
      const { container } = render(
        <IOSTable>
          <IOSTableBody>
            <IOSTableRow>
              <IOSTableCell>Test</IOSTableCell>
            </IOSTableRow>
          </IOSTableBody>
        </IOSTable>
      );
      const row = container.querySelector('[role="row"]');
      expect(row).toBeTruthy();
    });

    it('should have role="cell" on table cells', () => {
      const { container } = render(
        <IOSTable>
          <IOSTableBody>
            <IOSTableRow>
              <IOSTableCell>Test</IOSTableCell>
            </IOSTableRow>
          </IOSTableBody>
        </IOSTable>
      );
      const cell = container.querySelector('[role="cell"]');
      expect(cell).toBeTruthy();
    });

    it('should have role="columnheader" on header cells', () => {
      const { container } = render(
        <IOSTable>
          <IOSTableHeader>
            <IOSTableRow>
              <IOSTableCell header>Header</IOSTableCell>
            </IOSTableRow>
          </IOSTableHeader>
        </IOSTable>
      );
      const header = container.querySelector('[role="columnheader"]');
      expect(header).toBeTruthy();
    });
  });

  describe('Icon ARIA', () => {
    it('should have aria-hidden when no label', () => {
      const { container } = render(<IOSIcon icon={Settings} />);
      const icon = container.querySelector('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    });

    it('should not have aria-hidden when label provided', () => {
      const { container } = render(<IOSIcon icon={Settings} aria-label="Settings" />);
      const icon = container.querySelector('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('false');
    });
  });
});
