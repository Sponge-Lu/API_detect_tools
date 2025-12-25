# 📁 src/renderer/utils/ - 前端工具函数

## 架构说明

**职责**: 提供前端使用的工具函数和辅助模块

**特点**:
- 纯函数，无副作用
- 可复用的通用逻辑
- 支持样式、日志、格式化等
- 被组件和 Hook 使用

**依赖关系**:
- 被 `components/` 和 `hooks/` 使用
- 不依赖 Electron 特定功能
- 可独立测试

---

## 📂 文件清单

### 核心工具文件

| 文件 | 职责 | 关键函数 |
|------|------|--------|
| **groupStyle.tsx** | 分组样式生成 | `getGroupStyle()`, `getGroupColor()` |
| **logger.ts** | 日志记录 | `info()`, `warn()`, `error()`, `debug()` |

---

## 🎨 工具函数详解

### groupStyle.tsx - 分组样式生成

**职责**: 为站点分组生成样式和颜色

**关键函数**:
```typescript
// 获取分组样式
export function getGroupStyle(groupId: string): {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
};

// 获取分组颜色
export function getGroupColor(groupId: string): string;

// 获取分组背景色
export function getGroupBgColor(groupId: string): string;

// 获取分组文本色
export function getGroupTextColor(groupId: string): string;

// 生成分组样式类名
export function getGroupClassName(groupId: string): string;
```

**使用示例**:
```typescript
// 在组件中使用
const style = getGroupStyle(groupId);
<div style={style}>
  {groupName}
</div>

// 使用 Tailwind 类名
const className = getGroupClassName(groupId);
<div className={className}>
  {groupName}
</div>

// 获取颜色
const color = getGroupColor(groupId);
<span style={{ color }}>
  {groupName}
</span>
```

**颜色方案**:
```typescript
// 预定义的颜色方案
const colorSchemes = [
  { bg: '#FF6B6B', text: '#FFFFFF' }, // 红色
  { bg: '#4ECDC4', text: '#FFFFFF' }, // 青色
  { bg: '#45B7D1', text: '#FFFFFF' }, // 蓝色
  { bg: '#FFA07A', text: '#FFFFFF' }, // 橙色
  { bg: '#98D8C8', text: '#FFFFFF' }, // 绿色
  { bg: '#F7DC6F', text: '#333333' }, // 黄色
  { bg: '#BB8FCE', text: '#FFFFFF' }, // 紫色
  { bg: '#85C1E2', text: '#FFFFFF' }, // 浅蓝
];
```

### logger.ts - 日志记录

**职责**: 前端日志记录

**关键方法**:
```typescript
// 日志级别
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// 日志记录
export class Logger {
  static debug(message: string, ...args: any[]): void;
  static info(message: string, ...args: any[]): void;
  static warn(message: string, ...args: any[]): void;
  static error(message: string, ...args: any[]): void;
  
  // 设置日志级别
  static setLevel(level: LogLevel): void;
  
  // 获取日志
  static getLogs(): string[];
  
  // 清空日志
  static clearLogs(): void;
}

// 使用示例
Logger.info('应用启动');
Logger.warn('警告信息');
Logger.error('错误信息', error);
```

**日志格式**:
```
[2025-12-24 10:30:45] [INFO] 应用启动
[2025-12-24 10:30:46] [WARN] 警告信息
[2025-12-24 10:30:47] [ERROR] 错误信息
```

---

## 🔄 使用示例

### 在组件中使用

```typescript
// src/renderer/components/SiteCard.tsx
import { getGroupStyle } from '../utils/groupStyle';
import Logger from '../utils/logger';

export function SiteCard({ site, group }) {
  const groupStyle = getGroupStyle(group.id);
  
  Logger.info(`渲染站点卡片: ${site.name}`);
  
  return (
    <div style={groupStyle}>
      <h3>{site.name}</h3>
      <p>余额: {site.balance}</p>
    </div>
  );
}
```

### 在 Hook 中使用

```typescript
// src/renderer/hooks/useSiteGroups.ts
import { getGroupColor } from '../utils/groupStyle';
import Logger from '../utils/logger';

export function useSiteGroups() {
  const handleAddGroup = (name: string) => {
    Logger.info(`添加分组: ${name}`);
    
    const color = getGroupColor(generateId());
    // 使用颜色创建分组
  };
  
  return { handleAddGroup };
}
```

---

## 🎯 最佳实践

### 1. 纯函数

```typescript
// ✅ 好：纯函数，无副作用
export function getGroupColor(groupId: string): string {
  const hash = hashString(groupId);
  return colors[hash % colors.length];
}

// ❌ 不好：有副作用
export function getGroupColor(groupId: string): string {
  console.log('获取颜色'); // 副作用
  return colors[0];
}
```

### 2. 类型安全

```typescript
// ✅ 好：完整的类型定义
export function getGroupStyle(groupId: string): {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
} {
  // 实现
}

// ❌ 不好：使用 any
export function getGroupStyle(groupId: any): any {
  // 实现
}
```

### 3. 文档化

```typescript
// ✅ 好：添加 JSDoc 注释
/**
 * 获取分组的样式对象
 * @param groupId - 分组 ID
 * @returns 包含背景色、边框色、文本色的样式对象
 * @example
 * const style = getGroupStyle('group-1');
 * <div style={style}>Group Name</div>
 */
export function getGroupStyle(groupId: string): GroupStyle {
  // 实现
}
```

### 4. 性能优化

```typescript
// ✅ 好：缓存计算结果
const styleCache = new Map<string, GroupStyle>();

export function getGroupStyle(groupId: string): GroupStyle {
  if (styleCache.has(groupId)) {
    return styleCache.get(groupId)!;
  }
  
  const style = computeStyle(groupId);
  styleCache.set(groupId, style);
  return style;
}
```

---

## 🧪 工具函数测试

### 测试示例

```typescript
// src/__tests__/utils/groupStyle.test.ts
import { getGroupStyle, getGroupColor } from '../utils/groupStyle';

describe('groupStyle', () => {
  it('should return consistent color for same groupId', () => {
    const color1 = getGroupColor('group-1');
    const color2 = getGroupColor('group-1');
    expect(color1).toBe(color2);
  });

  it('should return different colors for different groupIds', () => {
    const color1 = getGroupColor('group-1');
    const color2 = getGroupColor('group-2');
    expect(color1).not.toBe(color2);
  });

  it('should return valid style object', () => {
    const style = getGroupStyle('group-1');
    expect(style).toHaveProperty('backgroundColor');
    expect(style).toHaveProperty('borderColor');
    expect(style).toHaveProperty('textColor');
  });
});
```

---

## 📈 扩展指南

### 添加新工具函数

1. 在 `utils/` 中创建新文件
2. 实现函数逻辑
3. 添加 JSDoc 注释
4. 编写单元测试
5. 导出到 `index.ts`

### 模板

```typescript
// src/renderer/utils/newUtil.ts
/**
 * 新工具函数的描述
 * @param param1 - 参数1 的描述
 * @returns 返回值的描述
 * @example
 * const result = newUtilFunction('value');
 */
export function newUtilFunction(param1: string): string {
  // 实现
  return result;
}
```

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.8  
**更新日期**: 2025-12-24
