# 📁 src/renderer/components/ - React UI 组件库

## 架构说明

**职责**: 提供应用的所有 React UI 组件

**特点**:
- 基于 React 18 + TypeScript
- 使用 Tailwind CSS 样式
- 组件化设计，高度可复用
- 支持深色模式
- 完整的类型定义

**依赖关系**:
- 被 `App.tsx` 和其他组件使用
- 依赖 `hooks/` 处理业务逻辑
- 依赖 `store/` 管理状态
- 依赖 `utils/` 工具函数

---

## 📂 文件清单

### 顶级组件

| 文件 | 职责 | Props |
|------|------|-------|
| **ConfirmDialog.tsx** | 确认对话框 | `open`, `title`, `message`, `onConfirm`, `onCancel` |
| **DetectionResults.tsx** | 检测结果显示 | `results`, `loading`, `onRetry` |
| **SettingsPanel.tsx** | 设置面板 | `open`, `onClose`, `settings`, `onSave` |
| **SiteEditor.tsx** | 站点编辑对话框 | `open`, `site`, `onSave`, `onCancel` |

### 子文件夹

| 文件夹 | 职责 | 关键组件 |
|--------|------|--------|
| **Header/** | 顶部导航栏 | Header, Menu, ThemeToggle |
| **SiteCard/** | 站点卡片 | SiteCard, SiteCardActions |
| **SiteGroupTabs/** | 站点分组标签 | SiteGroupTabs, GroupTab |
| **SiteListHeader/** | 站点列表头部 | SiteListHeader, SearchBar, FilterBar |
| **dialogs/** | 对话框组件 | 各类对话框 |
| **Skeleton/** | 骨架屏 | SkeletonLoader, SkeletonCard |
| **Toast/** | 消息提示 | Toast, ToastContainer |
| **CliCompatibilityIcons/** | CLI 兼容性图标 | CliIcon, CliIconGroup |
| **CliConfigStatus/** | CLI 配置状态显示 | CliConfigStatus, CliConfigStatusPanel |
| **CreateApiKeyDialog/** | API Key 创建对话框 | CreateApiKeyDialog |
| **CreditPanel/** | Linux Do Credit 积分面板 | CreditPanelCompact |
| **IOSButton/** | iOS 风格按钮 | IOSButton |
| **IOSCard/** | iOS 风格卡片 | IOSCard, IOSCardDivider, IOSCardHeader, IOSCardContent, IOSCardFooter |
| **IOSInput/** | iOS 风格输入框 | IOSInput, IOSSearchInput |
| **IOSModal/** | iOS 风格弹窗 | IOSModal |
| **IOSTable/** | iOS 风格表格 | IOSTable, IOSTableHeader, IOSTableRow, IOSTableCell, IOSTableBody, IOSTableDivider, IOSTableEmpty |

---

## 🧩 核心组件详解

### Header 组件

**职责**: 应用顶部导航栏

**Props**:
```typescript
interface HeaderProps {
  onMenuClick?: () => void;
  onSettingsClick?: () => void;
  onRefreshClick?: () => void;
}
```

**特点**:
- 主题切换按钮
- 菜单按钮
- 设置按钮
- 刷新按钮

### SiteCard 组件

**职责**: 显示单个站点的卡片

**Props**:
```typescript
interface SiteCardProps {
  site: Site;
  status?: SiteStatus;
  loading?: boolean;
  onEdit?: (site: Site) => void;
  onDelete?: (siteId: string) => void;
  onRefresh?: (siteId: string) => void;
  onSignIn?: (siteId: string) => void;
}
```

**特点**:
- 显示站点信息（名称、余额、消耗等）
- 操作按钮（编辑、删除、刷新、签到）
- 加载状态显示
- 错误状态显示

### SiteGroupTabs 组件

**职责**: 站点分组标签切换

**Props**:
```typescript
interface SiteGroupTabsProps {
  groups: SiteGroup[];
  activeGroupId?: string;
  onGroupChange?: (groupId: string) => void;
  onAddGroup?: () => void;
  onEditGroup?: (groupId: string) => void;
  onDeleteGroup?: (groupId: string) => void;
}
```

**特点**:
- 分组标签切换
- 新增分组按钮
- 编辑分组菜单
- 删除分组确认

### SiteListHeader 组件

**职责**: 站点列表头部（搜索、筛选、排序）

**Props**:
```typescript
interface SiteListHeaderProps {
  searchText?: string;
  onSearchChange?: (text: string) => void;
  sortBy?: 'name' | 'balance' | 'usage';
  onSortChange?: (sortBy: string) => void;
  filterStatus?: 'all' | 'online' | 'offline';
  onFilterChange?: (status: string) => void;
}
```

**特点**:
- 搜索框
- 排序选择
- 状态筛选
- 批量操作

### SiteEditor 组件

**职责**: 编辑站点信息的对话框

**Props**:
```typescript
interface SiteEditorProps {
  open: boolean;
  site?: Site;
  onSave: (site: Site) => void;
  onCancel: () => void;
}
```

**特点**:
- 表单验证
- 错误提示
- 加载状态
- 保存/取消按钮

### SettingsPanel 组件

**职责**: 应用设置面板

**Props**:
```typescript
interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}
```

**特点**:
- 主题设置
- 语言设置
- 自动刷新设置
- 并发设置
- 超时设置
- 备份设置

### IOSCard 组件

**职责**: iOS 风格卡片组件

**Props**:
```typescript
interface IOSCardProps {
  variant?: 'standard' | 'elevated' | 'grouped';
  blur?: boolean;
  hoverable?: boolean;
  expanded?: boolean;
  expandContent?: React.ReactNode;
  draggable?: boolean;
  isDragOver?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}
```

**特点**:
- iOS 风格样式（圆角、毛玻璃背景、阴影）
- 悬停状态（阴影增强、轻微上移）
- 展开/收起动画
- 拖拽支持
- 多种变体（standard, elevated, grouped）

### IOSInput 组件

**职责**: iOS 风格输入框组件

**Props**:
```typescript
interface IOSInputProps {
  size?: 'sm' | 'md' | 'lg';
  error?: boolean;
  errorMessage?: string;
  label?: string;
  showPasswordToggle?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerClassName?: string;
}
```

**特点**:
- iOS 风格样式（圆角、内阴影、背景色）
- 聚焦状态（边框高亮、box-shadow）
- 支持多种输入类型（text, password, url, number, email）
- 支持密码显示/隐藏切换
- 支持左右图标
- 支持错误状态和错误信息显示

### IOSSearchInput 组件

**职责**: iOS 风格搜索输入框组件

**Props**:
```typescript
interface IOSSearchInputProps {
  size?: 'sm' | 'md' | 'lg';
  showClearButton?: boolean;
  onClear?: () => void;
  containerClassName?: string;
}
```

**特点**:
- iOS 风格搜索框样式（圆角、背景色、搜索图标）
- 聚焦状态（背景色变化、box-shadow）
- 支持清除按钮
- 保持原有的 onChange 和搜索逻辑

### IOSModal 组件

**职责**: iOS 风格弹窗组件

**Props**:
```typescript
interface IOSModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  titleIcon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEsc?: boolean;
}
```

**特点**:
- iOS 风格样式（圆角、毛玻璃背景、居中）
- 遮罩层（半透明黑色背景 + 模糊）
- 打开/关闭动画（缩放 + 淡入淡出）
- 按钮布局（底部横向排列，主要操作在右侧）
- 支持 ESC 键关闭
- 支持点击遮罩关闭

### IOSTable 组件

**职责**: iOS 风格表格组件

**Props**:
```typescript
interface IOSTableProps {
  variant?: 'standard' | 'grouped' | 'inset';
  blur?: boolean;
  staggerAnimation?: boolean;
  children: React.ReactNode;
}
```

**特点**:
- iOS 风格样式（分组、圆角、背景色）
- 增加行高和内边距（至少 44px 高度）
- iOS 风格的分隔线（1px, 低对比度）
- 悬停状态（背景色变化）
- 优化表头样式（13px, 大写, 0.5px 字间距）
- 支持列表项交错淡入动画
- 支持固定表头（sticky）
- 完整的 ARIA 角色支持

**子组件**:
- `IOSTableHeader`: 表头组件，支持 sticky 定位
- `IOSTableRow`: 表格行组件，支持悬停、选中、禁用状态
- `IOSTableCell`: 单元格组件，支持对齐和宽度设置
- `IOSTableBody`: 表体容器组件
- `IOSTableDivider`: 分隔线组件
- `IOSTableEmpty`: 空状态组件

### Toast 组件

**职责**: 消息提示

**Props**:
```typescript
interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  onClose?: () => void;
}
```

**特点**:
- 多种类型（成功、错误、警告、信息）
- 自动关闭
- 堆叠显示
- 动画效果

### CreditPanelCompact 组件

**职责**: Linux Do Credit 积分面板（显示在表头区域）

**Props**:
```typescript
interface CreditPanelCompactProps {
  className?: string;
}
```

**特点**:
- 紧凑显示核心积分数据（基准值、当前分、差值）
- 点击展开详情弹出面板
- 展开面板包含完整积分信息和三栏布局（交易记录、收入统计、支出统计）
- 点击外部自动关闭展开面板
- 支持登录/登出、刷新、自动刷新配置

### CliCompatibilityIcons 组件

**职责**: 显示 CLI 工具兼容性图标

**Props**:
```typescript
interface CliCompatibilityIconsProps {
  compatibility: CliCompatibility[];
  size?: 'small' | 'medium' | 'large';
}
```

**特点**:
- 工具图标显示
- 支持状态指示
- 版本信息提示
- 响应式布局

---

## 🎨 样式系统

### Tailwind CSS 集成

- 使用 Tailwind CSS 进行样式管理
- 支持深色模式 (`dark:` 前缀)
- 响应式设计 (`sm:`, `md:`, `lg:` 等)
- 自定义颜色和间距

### 主题支持

```typescript
// 浅色主题
<div className="bg-white text-gray-900">

// 深色主题
<div className="dark:bg-gray-900 dark:text-white">

// 响应式
<div className="w-full md:w-1/2 lg:w-1/3">
```

---

## 🔄 组件通信

### Props 传递

```
App.tsx
  ↓
Header (接收 onMenuClick, onSettingsClick)
  ↓
SiteGroupTabs (接收 groups, onGroupChange)
  ↓
SiteListHeader (接收 searchText, onSearchChange)
  ↓
SiteCard (接收 site, status, onEdit, onDelete)
```

### 事件处理

```typescript
// 父组件
<SiteCard
  site={site}
  onEdit={(site) => handleEdit(site)}
  onDelete={(siteId) => handleDelete(siteId)}
/>

// 子组件
const SiteCard = ({ site, onEdit, onDelete }) => {
  return (
    <button onClick={() => onEdit(site)}>编辑</button>
    <button onClick={() => onDelete(site.id)}>删除</button>
  );
};
```

---

## 🧪 组件测试

### 测试示例

```typescript
// src/__tests__/components/SiteCard.test.tsx
import { render, screen } from '@testing-library/react';
import { SiteCard } from '../components/SiteCard';

describe('SiteCard', () => {
  it('should render site information', () => {
    const site = { id: '1', name: 'Test Site' };
    render(<SiteCard site={site} />);
    expect(screen.getByText('Test Site')).toBeInTheDocument();
  });
});
```

---

## 📈 扩展指南

### 添加新组件

1. 在 `components/` 中创建新文件或文件夹
2. 定义 Props 接口
3. 实现组件逻辑
4. 添加 JSDoc 注释
5. 编写单元测试
6. 导出到 `index.ts`

### 最佳实践

- 使用函数组件 + Hooks
- 完整的 TypeScript 类型
- 支持深色模式
- 响应式设计
- 无障碍支持 (a11y)
- 编写测试用例

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.11  
**更新日期**: 2025-01-08
