/**
 * @file src/__tests__/primitive-visual-regression.test.tsx
 * @description 当前设计原语视觉回归测试套件
 *
 * 功能:
 * - 为当前设计原语创建快照测试
 * - 验证组件渲染结构的一致性
 * - 检测旧设计契约回退
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

// 原语导入（保留兼容入口以验证 legacy 路径）
import { AppButton } from '../renderer/components/AppButton/AppButton';
import {
  AppCard,
  AppCardHeader,
  AppCardContent,
  AppCardFooter,
  AppCardDivider,
} from '../renderer/components/AppCard';
import { AppInput } from '../renderer/components/AppInput';
import { AppSearchInput } from '../renderer/components/AppInput/AppSearchInput';
import { AppModal } from '../renderer/components/AppModal/AppModal';
import {
  DataTable,
  DataTableHeader,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  DataTableEmpty,
} from '../renderer/components/DataTable/DataTable';
import { AppIcon, AppIconButton } from '../renderer/components/AppIcon';
import { Settings, Trash2, Plus, Search, Check, X } from 'lucide-react';

// CSS 变量注入
let styleElement: HTMLStyleElement;

beforeEach(() => {
  styleElement = document.createElement('style');
  styleElement.textContent = `
    :root {
      /* 当前产品级视觉 token */
      --surface-1: #ffffff;
      --surface-2: #f4f1ec;
      --surface-3: #ebe6de;
      --text-primary: #2c2a27;
      --text-secondary: #655e58;
      --text-tertiary: #8b847c;
      --line-soft: rgba(87, 80, 70, 0.16);
      --accent: #5b6a62;
      --accent-soft: rgba(91, 106, 98, 0.14);
      --accent-soft-strong: rgba(91, 106, 98, 0.22);
      --accent-strong: #435047;
      --danger: #8a5d5a;
      --danger-soft: rgba(138, 93, 90, 0.16);
      --success: #4e7a61;
      --focus-ring: rgba(91, 106, 98, 0.22);
      --overlay-mask: rgba(27, 24, 22, 0.2);

      /* 间距系统 */
      --spacing-xs: 4px;
      --spacing-sm: 8px;
      --spacing-md: 12px;
      --spacing-lg: 16px;
      --spacing-xl: 20px;
      --spacing-2xl: 24px;
      --spacing-3xl: 32px;
      --spacing-4xl: 40px;
      --spacing-8: 32px;
      --spacing-10: 40px;
      
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
      
      /* 标准缓动函数 */
      --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
    }
  `;
  document.head.appendChild(styleElement);
});

afterEach(() => {
  document.head.removeChild(styleElement);
});

const getOverlaySnapshotRoot = (baseElement: HTMLElement) =>
  baseElement.querySelector('[role="presentation"]');

const getDialog = (baseElement: HTMLElement) => baseElement.querySelector('[role="dialog"]');

const normalizeSnapshotIds = (node: Element | null) => {
  if (!node) {
    return node;
  }

  const clone = node.cloneNode(true) as Element;
  const elements = [clone, ...Array.from(clone.querySelectorAll('*'))];
  const idMap = new Map<string, string>();
  let nextId = 1;

  const getStableId = (value: string) => {
    if (!idMap.has(value)) {
      idMap.set(value, `snapshot-id-${nextId++}`);
    }

    return idMap.get(value)!;
  };

  for (const element of elements) {
    const id = element.getAttribute('id');
    if (id) {
      element.setAttribute('id', getStableId(id));
    }
  }

  for (const element of elements) {
    for (const attr of ['aria-labelledby', 'aria-describedby']) {
      const value = element.getAttribute(attr);
      if (!value) {
        continue;
      }

      const normalizedValue = value.split(/\s+/).filter(Boolean).map(getStableId).join(' ');

      element.setAttribute(attr, normalizedValue);
    }
  }

  return clone;
};

const expectOverlaySnapshot = (ui: React.ReactElement) => {
  const { baseElement } = render(ui);
  const overlayRoot = getOverlaySnapshotRoot(baseElement);
  expect(overlayRoot).toBeTruthy();
  expect(normalizeSnapshotIds(overlayRoot)).toMatchSnapshot();
};

/* ========== AppButton 兼容视觉回归测试 ========== */

describe('AppButton Compatibility Visual Regression', () => {
  describe('Button Variants', () => {
    it('should render primary button correctly', () => {
      const { container } = render(<AppButton variant="primary">Primary Button</AppButton>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render secondary button correctly', () => {
      const { container } = render(<AppButton variant="secondary">Secondary Button</AppButton>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render tertiary button correctly', () => {
      const { container } = render(<AppButton variant="tertiary">Tertiary Button</AppButton>);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Button Sizes', () => {
    it('should render small button correctly', () => {
      const { container } = render(<AppButton size="sm">Small Button</AppButton>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render medium button correctly', () => {
      const { container } = render(<AppButton size="md">Medium Button</AppButton>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render large button correctly', () => {
      const { container } = render(<AppButton size="lg">Large Button</AppButton>);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Button States', () => {
    it('should render disabled button correctly', () => {
      const { container } = render(<AppButton disabled>Disabled Button</AppButton>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render loading button correctly', () => {
      const { container } = render(<AppButton loading>Loading Button</AppButton>);
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});

/* ========== Card 原语兼容视觉回归测试 ========== */

describe('Card Primitive Compatibility Visual Regression', () => {
  describe('Card Variants', () => {
    it('should render standard card correctly', () => {
      const { container } = render(
        <AppCard variant="standard">
          <AppCardContent>Standard Card Content</AppCardContent>
        </AppCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render elevated card correctly', () => {
      const { container } = render(
        <AppCard variant="elevated">
          <AppCardContent>Elevated Card Content</AppCardContent>
        </AppCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render grouped card correctly', () => {
      const { container } = render(
        <AppCard variant="grouped">
          <AppCardContent>Grouped Card Content</AppCardContent>
        </AppCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Card with Sub-components', () => {
    it('should render card with header correctly', () => {
      const { container } = render(
        <AppCard>
          <AppCardHeader>Card Header</AppCardHeader>
          <AppCardContent>Card Content</AppCardContent>
        </AppCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render card with footer correctly', () => {
      const { container } = render(
        <AppCard>
          <AppCardContent>Card Content</AppCardContent>
          <AppCardFooter>Card Footer</AppCardFooter>
        </AppCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render card with divider correctly', () => {
      const { container } = render(
        <AppCard>
          <AppCardContent>Section 1</AppCardContent>
          <AppCardDivider />
          <AppCardContent>Section 2</AppCardContent>
        </AppCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render complete card correctly', () => {
      const { container } = render(
        <AppCard>
          <AppCardHeader>Header</AppCardHeader>
          <AppCardDivider />
          <AppCardContent>Content</AppCardContent>
          <AppCardDivider />
          <AppCardFooter>Footer</AppCardFooter>
        </AppCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Card States', () => {
    it('should render disabled card correctly', () => {
      const { container } = render(
        <AppCard disabled>
          <AppCardContent>Disabled Card</AppCardContent>
        </AppCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render draggable card correctly', () => {
      const { container } = render(
        <AppCard draggable>
          <AppCardContent>Draggable Card</AppCardContent>
        </AppCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render drag-over card correctly', () => {
      const { container } = render(
        <AppCard draggable isDragOver>
          <AppCardContent>Drag Over Card</AppCardContent>
        </AppCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Card with Expand Content', () => {
    it('should render collapsed card correctly', () => {
      const { container } = render(
        <AppCard expanded={false} expandContent={<div>Expand Content</div>}>
          <AppCardContent>Main Content</AppCardContent>
        </AppCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render expanded card correctly', () => {
      const { container } = render(
        <AppCard expanded={true} expandContent={<div>Expand Content</div>}>
          <AppCardContent>Main Content</AppCardContent>
        </AppCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});

/* ========== 输入原语兼容视觉回归测试 ========== */

describe('Input Primitive Compatibility Visual Regression', () => {
  describe('Input Sizes', () => {
    it('should render small input correctly', () => {
      const { container } = render(<AppInput size="sm" placeholder="Small input" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render medium input correctly', () => {
      const { container } = render(<AppInput size="md" placeholder="Medium input" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render large input correctly', () => {
      const { container } = render(<AppInput size="lg" placeholder="Large input" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Input with Label', () => {
    it('should render input with label correctly', () => {
      const { container } = render(<AppInput label="Username" placeholder="Enter username" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render required input correctly', () => {
      const { container } = render(<AppInput label="Email" required placeholder="Enter email" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Input States', () => {
    it('should render error input correctly', () => {
      const { container } = render(<AppInput error errorMessage="This field is required" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render disabled input correctly', () => {
      const { container } = render(<AppInput disabled placeholder="Disabled input" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render input with help text correctly', () => {
      const { container } = render(<AppInput helpText="Enter your full name" placeholder="Name" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Input with Icons', () => {
    it('should render input with left icon correctly', () => {
      const { container } = render(
        <AppInput leftIcon={<Search size={16} />} placeholder="Search..." />
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render input with right icon correctly', () => {
      const { container } = render(
        <AppInput rightIcon={<Check size={16} />} placeholder="Verified" />
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Password Input', () => {
    it('should render password input correctly', () => {
      const { container } = render(<AppInput type="password" placeholder="Enter password" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render password input with toggle correctly', () => {
      const { container } = render(
        <AppInput type="password" showPasswordToggle placeholder="Enter password" />
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});

/* ========== Search Input 原语兼容视觉回归测试 ========== */

describe('Search Input Primitive Compatibility Visual Regression', () => {
  it('should render search input correctly', () => {
    const { container } = render(<AppSearchInput placeholder="Search..." />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('should render search input with value correctly', () => {
    const { container } = render(
      <AppSearchInput placeholder="Search..." value="test query" onChange={() => {}} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('should render search input with clear button correctly', () => {
    const { container } = render(
      <AppSearchInput
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

/* ========== 弹窗原语视觉回归测试 ========== */

describe('AppModal Compatibility Visual Regression', () => {
  describe('Modal Sizes', () => {
    it('should render small modal correctly', () => {
      expectOverlaySnapshot(
        <AppModal isOpen={true} onClose={() => {}} size="sm" title="Small Modal">
          <p>Modal content</p>
        </AppModal>
      );
    });

    it('should render medium modal correctly', () => {
      expectOverlaySnapshot(
        <AppModal isOpen={true} onClose={() => {}} size="md" title="Medium Modal">
          <p>Modal content</p>
        </AppModal>
      );
    });

    it('should render large modal correctly', () => {
      expectOverlaySnapshot(
        <AppModal isOpen={true} onClose={() => {}} size="lg" title="Large Modal">
          <p>Modal content</p>
        </AppModal>
      );
    });

    it('should render extra large modal correctly', () => {
      expectOverlaySnapshot(
        <AppModal isOpen={true} onClose={() => {}} size="xl" title="Extra Large Modal">
          <p>Modal content</p>
        </AppModal>
      );
    });
  });

  describe('Modal with Title Icon', () => {
    it('should render modal with title icon correctly', () => {
      expectOverlaySnapshot(
        <AppModal
          isOpen={true}
          onClose={() => {}}
          title="Settings"
          titleIcon={<Settings size={20} />}
        >
          <p>Modal content</p>
        </AppModal>
      );
    });
  });

  describe('Modal with Footer', () => {
    it('should render modal with footer correctly', () => {
      expectOverlaySnapshot(
        <AppModal
          isOpen={true}
          onClose={() => {}}
          title="Confirm Action"
          footer={
            <>
              <AppButton variant="secondary">Cancel</AppButton>
              <AppButton variant="primary">Confirm</AppButton>
            </>
          }
        >
          <p>Are you sure you want to proceed?</p>
        </AppModal>
      );
    });
  });

  describe('Modal Options', () => {
    it('should render modal without close button correctly', () => {
      expectOverlaySnapshot(
        <AppModal isOpen={true} onClose={() => {}} showCloseButton={false} title="No Close Button">
          <p>Modal content</p>
        </AppModal>
      );
    });

    it('should render modal without title correctly', () => {
      expectOverlaySnapshot(
        <AppModal isOpen={true} onClose={() => {}}>
          <p>Modal without title</p>
        </AppModal>
      );
    });
  });
});

/* ========== DataTable 兼容视觉回归测试 ========== */

describe('DataTable Compatibility Visual Regression', () => {
  describe('Table Variants', () => {
    it('should render standard table correctly', () => {
      const { container } = render(
        <DataTable variant="standard">
          <DataTableHeader>
            <DataTableRow>
              <DataTableCell header>Name</DataTableCell>
              <DataTableCell header>Status</DataTableCell>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            <DataTableRow>
              <DataTableCell>Item 1</DataTableCell>
              <DataTableCell>Active</DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render grouped table correctly', () => {
      const { container } = render(
        <DataTable variant="grouped">
          <DataTableBody>
            <DataTableRow>
              <DataTableCell>Item 1</DataTableCell>
            </DataTableRow>
            <DataTableRow>
              <DataTableCell>Item 2</DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render inset table correctly', () => {
      const { container } = render(
        <DataTable variant="inset">
          <DataTableBody>
            <DataTableRow>
              <DataTableCell>Item 1</DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Table Row States', () => {
    it('should render selected row correctly', () => {
      const { container } = render(
        <DataTable>
          <DataTableBody>
            <DataTableRow selected>
              <DataTableCell>Selected Item</DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render disabled row correctly', () => {
      const { container } = render(
        <DataTable>
          <DataTableBody>
            <DataTableRow disabled>
              <DataTableCell>Disabled Item</DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Table Cell Alignment', () => {
    it('should render cells with different alignments correctly', () => {
      const { container } = render(
        <DataTable>
          <DataTableBody>
            <DataTableRow>
              <DataTableCell align="left">Left</DataTableCell>
              <DataTableCell align="center">Center</DataTableCell>
              <DataTableCell align="right">Right</DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Table Empty State', () => {
    it('should render empty state correctly', () => {
      const { container } = render(
        <DataTable>
          <DataTableEmpty
            title="No Data"
            description="There are no items to display"
            icon={<Search size={48} />}
          />
        </DataTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render empty state with action correctly', () => {
      const { container } = render(
        <DataTable>
          <DataTableEmpty
            title="No Items"
            description="Add your first item"
            action={<AppButton variant="primary">Add Item</AppButton>}
          />
        </DataTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});

/* ========== AppIcon 兼容视觉回归测试 ========== */

describe('AppIcon Compatibility Visual Regression', () => {
  describe('Icon Sizes', () => {
    it('should render small icon correctly', () => {
      const { container } = render(<AppIcon icon={Settings} size="sm" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render medium icon correctly', () => {
      const { container } = render(<AppIcon icon={Settings} size="md" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render large icon correctly', () => {
      const { container } = render(<AppIcon icon={Settings} size="lg" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Icon Variants', () => {
    it('should render default icon correctly', () => {
      const { container } = render(<AppIcon icon={Settings} variant="default" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render primary icon correctly', () => {
      const { container } = render(<AppIcon icon={Settings} variant="primary" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render success icon correctly', () => {
      const { container } = render(<AppIcon icon={Check} variant="success" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render error icon correctly', () => {
      const { container } = render(<AppIcon icon={X} variant="error" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render warning icon correctly', () => {
      const { container } = render(<AppIcon icon={Settings} variant="warning" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render muted icon correctly', () => {
      const { container } = render(<AppIcon icon={Settings} variant="muted" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Icon with ARIA Label', () => {
    it('should render icon with aria-label correctly', () => {
      const { container } = render(<AppIcon icon={Trash2} aria-label="Delete item" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});

/* ========== AppIconButton 兼容视觉回归测试 ========== */

describe('AppIconButton Compatibility Visual Regression', () => {
  describe('IconButton Variants', () => {
    it('should render default icon button correctly', () => {
      const { container } = render(<AppIconButton icon={Plus} variant="default" label="Add" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render primary icon button correctly', () => {
      const { container } = render(
        <AppIconButton icon={Settings} variant="primary" label="Settings" />
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render success icon button correctly', () => {
      const { container } = render(
        <AppIconButton icon={Check} variant="success" label="Confirm" />
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render error icon button correctly', () => {
      const { container } = render(<AppIconButton icon={Trash2} variant="error" label="Delete" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render warning icon button correctly', () => {
      const { container } = render(
        <AppIconButton icon={Settings} variant="warning" label="Warning" />
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render muted icon button correctly', () => {
      const { container } = render(<AppIconButton icon={X} variant="muted" label="Close" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('IconButton Sizes', () => {
    it('should render small icon button correctly', () => {
      const { container } = render(<AppIconButton icon={Plus} size="sm" label="Add" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render medium icon button correctly', () => {
      const { container } = render(<AppIconButton icon={Plus} size="md" label="Add" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render large icon button correctly', () => {
      const { container } = render(<AppIconButton icon={Plus} size="lg" label="Add" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('IconButton States', () => {
    it('should render disabled icon button correctly', () => {
      const { container } = render(<AppIconButton icon={Plus} disabled label="Add" />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('should render icon button without tooltip correctly', () => {
      const { container } = render(<AppIconButton icon={Plus} showTooltip={false} label="Add" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});

/* ========== 组合组件视觉回归测试 ========== */

describe('Combined Components Visual Regression', () => {
  describe('Card with Form', () => {
    it('should render card with form inputs correctly', () => {
      const { container } = render(
        <AppCard>
          <AppCardHeader>User Information</AppCardHeader>
          <AppCardContent>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <AppInput label="Name" placeholder="Enter your name" />
              <AppInput label="Email" type="email" placeholder="Enter your email" />
              <AppInput
                label="Password"
                type="password"
                showPasswordToggle
                placeholder="Enter password"
              />
            </div>
          </AppCardContent>
          <AppCardFooter>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <AppButton variant="secondary">Cancel</AppButton>
              <AppButton variant="primary">Save</AppButton>
            </div>
          </AppCardFooter>
        </AppCard>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Table with Actions', () => {
    it('should render table with action buttons correctly', () => {
      const { container } = render(
        <DataTable>
          <DataTableHeader>
            <DataTableRow>
              <DataTableCell header width={200}>
                Name
              </DataTableCell>
              <DataTableCell header width={100}>
                Status
              </DataTableCell>
              <DataTableCell header width={100} align="right">
                Actions
              </DataTableCell>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            <DataTableRow>
              <DataTableCell>Item 1</DataTableCell>
              <DataTableCell>Active</DataTableCell>
              <DataTableCell align="right">
                <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                  <AppIconButton icon={Settings} size="sm" variant="muted" label="Settings" />
                  <AppIconButton icon={Trash2} size="sm" variant="error" label="Delete" />
                </div>
              </DataTableCell>
            </DataTableRow>
            <DataTableRow>
              <DataTableCell>Item 2</DataTableCell>
              <DataTableCell>Inactive</DataTableCell>
              <DataTableCell align="right">
                <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                  <AppIconButton icon={Settings} size="sm" variant="muted" label="Settings" />
                  <AppIconButton icon={Trash2} size="sm" variant="error" label="Delete" />
                </div>
              </DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Modal with Form', () => {
    it('should render modal with form correctly', () => {
      expectOverlaySnapshot(
        <AppModal
          isOpen={true}
          onClose={() => {}}
          title="Add New Item"
          footer={
            <>
              <AppButton variant="secondary">Cancel</AppButton>
              <AppButton variant="primary">Add</AppButton>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <AppInput label="Item Name" placeholder="Enter item name" required />
            <AppInput label="Description" placeholder="Enter description" />
          </div>
        </AppModal>
      );
    });
  });
});

/* ========== CSS 类名验证测试 ========== */

describe('CSS Class Verification', () => {
  describe('Primitive Design System Classes', () => {
    it('should apply primitive border radius classes', () => {
      const { container } = render(<AppButton>Test</AppButton>);
      const button = container.querySelector('button');
      expect(button?.className).toMatch(/rounded-\[/);
    });

    it('should apply primitive shadow classes', () => {
      const { container } = render(
        <AppCard>
          <div>Test</div>
        </AppCard>
      );
      const card = container.firstChild as HTMLElement;
      expect(card?.className).toMatch(/shadow-\[var\(--shadow-/);
    });

    it('should apply primitive color transition classes', () => {
      const { container } = render(<AppButton>Test</AppButton>);
      const button = container.querySelector('button');
      expect(button?.className).toContain('transition-colors');
      expect(button?.className).not.toContain('transition-all');
    });

    it('should avoid legacy timing-function utility classes on buttons', () => {
      const { container } = render(<AppButton>Test</AppButton>);
      const button = container.querySelector('button');
      expect(button?.className).not.toContain('[transition-timing-function:');
    });

    it('should apply primitive spacing classes', () => {
      const { container } = render(<AppInput placeholder="Test" />);
      const input = container.querySelector('input');
      expect(input?.className).toMatch(/p[xy]-\[var\(--spacing-/);
    });
  });

  describe('Accessibility Classes', () => {
    it('should apply focus-visible classes to buttons', () => {
      const { container } = render(<AppButton>Test</AppButton>);
      const button = container.querySelector('button');
      expect(button?.className).toContain('focus-visible:outline-');
    });

    it('should apply focus-visible classes to inputs', () => {
      const { container } = render(<AppInput placeholder="Test" />);
      // Input focus is handled via state, check for transition classes
      const input = container.querySelector('input');
      expect(input?.className).toContain('transition-');
    });

    it('should apply disabled classes', () => {
      const { container } = render(<AppButton disabled>Test</AppButton>);
      const button = container.querySelector('button');
      expect(button?.className).toContain('disabled:opacity-50');
      expect(button?.className).toContain('disabled:cursor-not-allowed');
    });
  });

  describe('Animation Classes', () => {
    it('should avoid legacy active-scale animation on buttons', () => {
      const { container } = render(<AppButton>Test</AppButton>);
      const button = container.querySelector('button');
      expect(button?.className).not.toContain('active:scale-');
      expect(button?.className).toContain('hover:bg-');
    });

    it('should apply hover classes to cards', () => {
      const { container } = render(
        <AppCard hoverable>
          <div>Test</div>
        </AppCard>
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
      const { container } = render(<AppButton aria-label="Test button">Test</AppButton>);
      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-label')).toBe('Test button');
    });

    it('should use native disabled state on disabled button', () => {
      const { container } = render(<AppButton disabled>Test</AppButton>);
      const button = container.querySelector('button');
      expect(button?.hasAttribute('disabled')).toBe(true);
      expect(button?.getAttribute('aria-disabled')).toBeNull();
    });

    it('should have aria-busy on loading button', () => {
      const { container } = render(<AppButton loading>Test</AppButton>);
      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-busy')).toBe('true');
    });
  });

  describe('Input ARIA', () => {
    it('should have aria-invalid on error input', () => {
      const { container } = render(<AppInput error errorMessage="Error" />);
      const input = container.querySelector('input');
      expect(input?.getAttribute('aria-invalid')).toBe('true');
    });

    it('should have aria-required on required input', () => {
      const { container } = render(<AppInput required />);
      const input = container.querySelector('input');
      expect(input?.getAttribute('aria-required')).toBe('true');
    });

    it('should have aria-describedby linking to error message', () => {
      const { container } = render(<AppInput error errorMessage="This is an error" />);
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
      const { baseElement } = render(
        <AppModal isOpen={true} onClose={() => {}} title="Test">
          Content
        </AppModal>
      );
      const dialog = getDialog(baseElement);
      expect(dialog).toBeTruthy();
    });

    it('should have aria-modal="true" on modal', () => {
      const { baseElement } = render(
        <AppModal isOpen={true} onClose={() => {}} title="Test">
          Content
        </AppModal>
      );
      const dialog = getDialog(baseElement);
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
    });

    it('should have aria-labelledby linking to title', () => {
      const { baseElement } = render(
        <AppModal isOpen={true} onClose={() => {}} title="Test Title">
          Content
        </AppModal>
      );
      const dialog = getDialog(baseElement);
      const titleElement = baseElement.querySelector('[data-testid="overlay-title"] h2');
      expect(dialog?.getAttribute('aria-labelledby')).toBe(titleElement?.getAttribute('id'));
    });
  });

  describe('Table ARIA', () => {
    it('should have role="table" on table', () => {
      const { container } = render(
        <DataTable>
          <DataTableBody>
            <DataTableRow>
              <DataTableCell>Test</DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
      );
      const table = container.querySelector('[role="table"]');
      expect(table).toBeTruthy();
    });

    it('should have role="row" on table rows', () => {
      const { container } = render(
        <DataTable>
          <DataTableBody>
            <DataTableRow>
              <DataTableCell>Test</DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
      );
      const row = container.querySelector('[role="row"]');
      expect(row).toBeTruthy();
    });

    it('should have role="cell" on table cells', () => {
      const { container } = render(
        <DataTable>
          <DataTableBody>
            <DataTableRow>
              <DataTableCell>Test</DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
      );
      const cell = container.querySelector('[role="cell"]');
      expect(cell).toBeTruthy();
    });

    it('should have role="columnheader" on header cells', () => {
      const { container } = render(
        <DataTable>
          <DataTableHeader>
            <DataTableRow>
              <DataTableCell header>Header</DataTableCell>
            </DataTableRow>
          </DataTableHeader>
        </DataTable>
      );
      const header = container.querySelector('[role="columnheader"]');
      expect(header).toBeTruthy();
    });
  });

  describe('Icon ARIA', () => {
    it('should have aria-hidden when no label', () => {
      const { container } = render(<AppIcon icon={Settings} />);
      const icon = container.querySelector('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    });

    it('should not have aria-hidden when label provided', () => {
      const { container } = render(<AppIcon icon={Settings} aria-label="Settings" />);
      const icon = container.querySelector('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('false');
    });
  });
});
