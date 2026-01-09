# IOSCard 组件

## 概述

iOS 风格卡片组件，提供统一的卡片样式和交互效果。

## 文件结构

| 文件 | 描述 |
|------|------|
| `IOSCard.tsx` | 卡片组件实现 |
| `index.ts` | 组件导出入口 |
| `FOLDER_INDEX.md` | 本文档 |

## 组件

### IOSCard

主卡片组件，支持以下功能：
- iOS 风格样式（圆角、毛玻璃背景、阴影）
- 悬停状态（阴影增强、轻微上移）
- 展开/收起动画
- 拖拽支持

**Props:**
- `variant`: 卡片变体 (`'standard'` | `'elevated'` | `'grouped'`)
- `blur`: 是否启用毛玻璃效果
- `hoverable`: 是否启用悬停效果
- `expanded`: 是否展开
- `expandContent`: 展开内容
- `draggable`: 是否可拖拽
- `isDragOver`: 是否处于拖拽悬停状态
- `disabled`: 是否禁用

### IOSCardDivider

卡片内分隔线组件，使用 iOS 风格的细线和低对比度颜色。

### IOSCardHeader

卡片头部组件，提供标准的内边距。

### IOSCardContent

卡片内容组件，提供标准的内边距。

### IOSCardFooter

卡片底部组件，带有顶部边框分隔线。

## 使用示例

```tsx
import { IOSCard, IOSCardHeader, IOSCardContent, IOSCardDivider } from './IOSCard';

<IOSCard variant="standard" hoverable>
  <IOSCardHeader>
    <h3>卡片标题</h3>
  </IOSCardHeader>
  <IOSCardDivider />
  <IOSCardContent>
    <p>卡片内容</p>
  </IOSCardContent>
</IOSCard>
```

## 依赖

- React
- CSS 变量（来自 `index.css` 的 iOS 设计系统）

## 更新日志

- 2025-01-08: 创建 IOSCard 组件
