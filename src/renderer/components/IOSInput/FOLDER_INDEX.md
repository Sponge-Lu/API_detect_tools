# IOSInput 组件文件夹

## 概述
iOS 风格输入框组件，包含标准输入框和搜索输入框两种变体。

## 文件列表

| 文件 | 用途 | 主要导出 |
|------|------|----------|
| `IOSInput.tsx` | iOS 风格标准输入框组件 | `IOSInput`, `IOSInputProps` |
| `IOSSearchInput.tsx` | iOS 风格搜索输入框组件 | `IOSSearchInput`, `IOSSearchInputProps` |
| `index.ts` | 组件导出入口 | 所有组件和类型 |

## 组件特性

### IOSInput
- iOS 风格样式（圆角、内阴影、背景色）
- 聚焦状态（边框高亮、box-shadow）
- 支持多种输入类型（text, password, url, number, email）
- 支持密码显示/隐藏切换
- 支持左右图标
- 支持错误状态和错误信息显示
- 保持原有的 onChange 和验证逻辑

### IOSSearchInput
- iOS 风格搜索框样式（圆角、背景色、搜索图标）
- 聚焦状态（背景色变化、box-shadow）
- 支持清除按钮
- 保持原有的 onChange 和搜索逻辑

## 使用示例

```tsx
import { IOSInput, IOSSearchInput } from './IOSInput';

// 标准输入框
<IOSInput
  label="用户名"
  placeholder="请输入用户名"
  value={username}
  onChange={(e) => setUsername(e.target.value)}
/>

// 密码输入框
<IOSInput
  type="password"
  label="密码"
  showPasswordToggle
  value={password}
  onChange={(e) => setPassword(e.target.value)}
/>

// 搜索输入框
<IOSSearchInput
  placeholder="搜索..."
  value={searchQuery}
  onChange={(e) => setSearchQuery(e.target.value)}
  onClear={() => setSearchQuery('')}
/>
```

## 版本历史
- 2025-01-08: 创建 IOSInput 和 IOSSearchInput 组件
