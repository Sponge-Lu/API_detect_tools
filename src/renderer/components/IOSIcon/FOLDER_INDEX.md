# IOSIcon 组件目录

## 概述
iOS 风格图标组件，提供统一的图标样式、尺寸和无障碍支持。

## 文件结构

| 文件 | 用途 |
|------|------|
| `IOSIcon.tsx` | iOS 风格图标组件，统一 stroke-width 和尺寸 |
| `IOSIconButton.tsx` | iOS 风格图标按钮，带无障碍支持 |
| `index.ts` | 组件导出 |

## 组件特性

### IOSIcon
- 统一 stroke-width 为 2px
- 标准尺寸: sm (16px), md (20px), lg (24px)
- 支持颜色变体: default, primary, success, error, warning, muted
- 支持 aria-label 无障碍标签

### IOSIconButton
- 自动添加 aria-label 和 title 属性
- 统一的悬停和按下效果
- 支持禁用状态
- 必需的 label 属性确保无障碍性

## 使用示例

```tsx
import { Settings, Trash2 } from 'lucide-react';
import { IOSIcon, IOSIconButton } from './IOSIcon';

// 基础图标
<IOSIcon icon={Settings} size="md" />

// 带颜色变体的图标
<IOSIcon icon={Trash2} size="sm" variant="error" />

// 图标按钮
<IOSIconButton icon={Settings} label="设置" onClick={handleSettings} />
```

## 版本历史
- 2025-01-09: 初始创建，实现 iOS 风格图标系统
