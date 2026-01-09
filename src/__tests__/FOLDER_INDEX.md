# 📁 src/__tests__/ - 测试文件

## 架构说明

**职责**: 提供项目的单元测试、集成测试和属性测试

**特点**:
- 使用 Vitest 作为测试框架
- 使用 React Testing Library 进行组件测试
- 使用 fast-check 进行属性测试
- 覆盖主进程、渲染进程和共享代码

**依赖关系**:
- 测试 `main/`, `renderer/`, `shared/` 中的代码
- 不被其他模块依赖
- 独立运行

---

## 📂 文件清单

### 测试文件

| 文件 | 职责 | 测试对象 |
|------|------|--------|
| **setup.ts** | 测试环境配置 | Vitest 配置 |
| **example.test.ts** | 示例测试 | 测试模板 |
| **schemas.test.ts** | Schema 验证测试 | Zod Schema |
| **groupStyle.test.tsx** | 分组样式测试 | groupStyle 工具 |
| **useSiteGroups.test.ts** | Hook 测试 | useSiteGroups Hook |
| **webdav-config.test.ts** | WebDAV 配置测试 | WebDAV 配置 |
| **webdav-manager.test.ts** | WebDAV 管理器测试 | WebDAVManager 类 |
| **update-service.test.ts** | 更新服务测试 | UpdateService 类 |
| **auto-refresh.property.test.ts** | 自动刷新属性测试 | 自动刷新逻辑 |
| **cli-compat-persistence.property.test.ts** | CLI 兼容性持久化测试 | CLI 兼容性数据 |
| **cli-compat-service.property.test.ts** | CLI 兼容性服务测试 | CliCompatService（含双端点测试） |
| **cli-config-generator.property.test.ts** | CLI 配置生成测试 | CLI 配置生成（含端点选择逻辑） |
| **filter-model-logs.property.test.ts** | 日志过滤属性测试 | 日志过滤逻辑 |
| **unified-cli-config.property.test.ts** | 统一 CLI 配置测试 | CLI 配置管理 |
| **useAutoRefresh.property.test.ts** | 自动刷新 Hook 测试 | useAutoRefresh Hook |
| **close-behavior-manager.property.test.ts** | 窗口关闭行为测试 | CloseBehaviorManager 设置持久化 |
| **config-detection.property.test.ts** | 配置检测属性测试 | ConfigDetectionService |
| **cli-config-priority.property.test.ts** | CLI 配置优先级测试 | CLI 配置优先级逻辑 |
| **codex-official-api-detection.property.test.ts** | Codex 官方 API Key 检测测试 | isOfficialOpenAIApiKey 函数 |
| **credit-service.property.test.ts** | Credit 服务属性测试 | CreditService 差值计算、错误处理、配置持久化、IPC 响应格式 |
| **useCredit.property.test.ts** | Credit Hook 属性测试 | useCredit Hook 自动刷新暂停逻辑 |
| **credit-panel.property.test.ts** | Credit 面板属性测试 | CreditPanel 差值颜色编码、日期格式化、交易状态徽章、交易金额格式化 |
| **ios-design-system.property.test.tsx** | iOS 设计系统属性测试 | CSS 变量系统、圆角、颜色、间距、阴影、模糊效果、动画系统、IOSButton 组件 |
| **ios-button.property.test.tsx** | iOS 按钮组件属性测试 | IOSButton 组件样式、交互、状态 |
| **ios-card.property.test.tsx** | iOS 卡片组件属性测试 | IOSCard 组件样式、交互、状态 |
| **ios-input.property.test.tsx** | iOS 输入框组件属性测试 | IOSInput、IOSSearchInput 组件样式、交互、状态 |
| **ios-modal.property.test.tsx** | iOS 弹窗组件属性测试 | IOSModal 组件样式、交互、状态 |
| **ios-table.property.test.tsx** | iOS 表格组件属性测试 | IOSTable、IOSTableHeader、IOSTableRow、IOSTableCell 组件样式、交互、状态 |
| **ios-responsive.property.test.tsx** | iOS 响应式布局属性测试 | 响应式布局系统、最小窗口尺寸、响应式间距、内容溢出处理 |
| **ios-accessibility.property.test.tsx** | iOS 无障碍性属性测试 | 文本对比度、焦点指示器、键盘导航、ARIA 属性、屏幕阅读器支持 |
| **ios-performance.property.test.tsx** | iOS 性能优化属性测试 | GPU 加速动画、毛玻璃效果优化、动画帧率、首屏渲染时间 |
| **ios-functional-preservation.property.test.tsx** | iOS 功能保持属性测试 | 按钮点击处理器、数据显示逻辑、表单验证逻辑、状态管理、API 调用、键盘导航 |
| **ios-icon.property.test.tsx** | iOS 图标组件属性测试 | IOSIcon、IOSIconButton 组件样式、尺寸、变体、无障碍属性 |
| **ios-visual-regression.test.tsx** | iOS 视觉回归测试 | 所有 iOS 组件的快照测试、CSS 类名验证、ARIA 属性验证 |

---

## 🧪 测试类型

### 单元测试

**职责**: 测试单个函数或类的功能

**示例**:
```typescript
// src/__tests__/schemas.test.ts
import { SiteSchema } from '../shared/schemas';

describe('SiteSchema', () => {
  it('should validate valid site', () => {
    const site = {
      id: '1',
      name: 'Test Site',
      baseUrl: 'https://api.test.com',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    expect(() => SiteSchema.parse(site)).not.toThrow();
  });

  it('should reject invalid site', () => {
    const site = {
      id: '1',
      name: 'Test Site',
      baseUrl: 'invalid-url'
    };
    
    expect(() => SiteSchema.parse(site)).toThrow();
  });
});
```

### 集成测试

**职责**: 测试多个模块之间的交互

**示例**:
```typescript
// src/__tests__/webdav-manager.test.ts
import { WebDAVManager } from '../main/webdav-manager';

describe('WebDAVManager', () => {
  let manager: WebDAVManager;

  beforeEach(() => {
    manager = new WebDAVManager(mockConfig);
  });

  it('should upload backup', async () => {
    const result = await manager.uploadBackup();
    expect(result.success).toBe(true);
  });

  it('should download backup', async () => {
    const result = await manager.downloadBackup();
    expect(result.success).toBe(true);
  });
});
```

### 属性测试

**职责**: 使用随机数据测试函数的属性

**示例**:
```typescript
// src/__tests__/cli-config-generator.property.test.ts
import fc from 'fast-check';
import { generateConfig } from '../renderer/services/cli-config-generator';

describe('CLI Config Generator - Property Tests', () => {
  it('should generate valid config for any site', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string(),
          name: fc.string(),
          baseUrl: fc.webUrl()
        }),
        (site) => {
          const config = generateConfig(site, 'claude-code');
          expect(config).toHaveProperty('tool');
          expect(config).toHaveProperty('enabled');
        }
      )
    );
  });
});
```

### 组件测试

**职责**: 测试 React 组件的渲染和交互

**示例**:
```typescript
// src/__tests__/components/SiteCard.test.tsx
import { render, screen } from '@testing-library/react';
import { SiteCard } from '../renderer/components/SiteCard';

describe('SiteCard', () => {
  it('should render site information', () => {
    const site = { id: '1', name: 'Test Site' };
    render(<SiteCard site={site} />);
    expect(screen.getByText('Test Site')).toBeInTheDocument();
  });

  it('should call onEdit when edit button clicked', () => {
    const site = { id: '1', name: 'Test Site' };
    const onEdit = jest.fn();
    render(<SiteCard site={site} onEdit={onEdit} />);
    
    screen.getByRole('button', { name: /edit/i }).click();
    expect(onEdit).toHaveBeenCalledWith(site);
  });
});
```

---

## 🔄 测试覆盖

### 覆盖范围

| 模块 | 覆盖率 | 测试文件 |
|------|--------|--------|
| **shared/** | 高 | schemas.test.ts, groupStyle.test.tsx |
| **main/** | 中 | webdav-manager.test.ts, update-service.test.ts |
| **renderer/** | 中 | useSiteGroups.test.ts, useAutoRefresh.property.test.ts |

### 运行测试

```bash
# 单次运行所有测试
npm run test

# 监听模式（开发时使用）
npm run test:watch

# 生成覆盖率报告
npm run test:coverage

# 运行特定测试文件
npm run test -- schemas.test.ts

# 运行匹配模式的测试
npm run test -- --grep "SiteSchema"
```

---

## 🎯 测试最佳实践

### 1. 清晰的测试名称

```typescript
// ✅ 好：清晰的测试描述
it('should validate valid site and not throw error', () => {
  // 测试代码
});

// ❌ 不好：模糊的测试描述
it('should work', () => {
  // 测试代码
});
```

### 2. 使用 AAA 模式

```typescript
// ✅ 好：Arrange-Act-Assert 模式
it('should add site to group', () => {
  // Arrange: 准备测试数据
  const group = { id: '1', name: 'Group 1', sites: [] };
  const site = { id: '1', name: 'Site 1' };
  
  // Act: 执行操作
  group.sites.push(site);
  
  // Assert: 验证结果
  expect(group.sites).toHaveLength(1);
  expect(group.sites[0]).toEqual(site);
});
```

### 3. 避免测试之间的依赖

```typescript
// ✅ 好：每个测试独立
describe('SiteGroup', () => {
  let group: SiteGroup;
  
  beforeEach(() => {
    group = { id: '1', name: 'Group 1', sites: [] };
  });
  
  it('should add site', () => {
    group.sites.push({ id: '1', name: 'Site 1' });
    expect(group.sites).toHaveLength(1);
  });
  
  it('should remove site', () => {
    group.sites = [];
    expect(group.sites).toHaveLength(0);
  });
});
```

### 4. Mock 外部依赖

```typescript
// ✅ 好：Mock IPC 调用
jest.mock('electron', () => ({
  ipcRenderer: {
    invoke: jest.fn().mockResolvedValue({ success: true })
  }
}));

it('should call IPC', async () => {
  const result = await window.ipcRenderer.invoke('api:request');
  expect(result.success).toBe(true);
});
```

---

## 📈 测试覆盖率目标

| 类型 | 目标 |
|------|------|
| 语句覆盖率 | > 80% |
| 分支覆盖率 | > 75% |
| 函数覆盖率 | > 80% |
| 行覆盖率 | > 80% |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引和 PROJECT_INDEX.md

---

**版本**: 2.1.12  
**更新日期**: 2025-01-09 - 添加 ios-visual-regression.test.tsx 视觉回归测试套件
