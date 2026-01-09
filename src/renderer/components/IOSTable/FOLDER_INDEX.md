# IOSTable 组件目录

## 概述
iOS 风格表格组件，提供分组、圆角、背景色等 iOS 设计语言特性。

## 文件结构

| 文件 | 描述 |
|------|------|
| `IOSTable.tsx` | 表格组件主文件，包含 IOSTable、IOSTableHeader、IOSTableRow、IOSTableCell、IOSTableBody、IOSTableDivider、IOSTableEmpty 组件 |
| `index.ts` | 组件导出入口 |
| `FOLDER_INDEX.md` | 本文件 |

## 组件说明

### IOSTable
表格容器组件，支持以下变体：
- `standard`: 标准样式，带边框和阴影
- `grouped`: 分组样式，无边框
- `inset`: 内嵌样式，透明背景

### IOSTableHeader
表头组件，支持固定在顶部（sticky）

### IOSTableRow
表格行组件，特性：
- 最小高度 44px（iOS 触摸目标标准）
- 悬停状态背景色变化
- 支持选中和禁用状态
- 支持交错淡入动画

### IOSTableCell
单元格组件，支持：
- 左/中/右对齐
- 表头/普通单元格样式
- 自定义宽度

### IOSTableBody
表体容器组件

### IOSTableDivider
分隔线组件，支持缩进

### IOSTableEmpty
空状态组件，显示无数据提示

## 设计规范

- 圆角: 16px (var(--radius-lg))
- 行高: 最小 44px
- 分隔线: 1px, 低对比度颜色
- 表头: 13px, 大写, 0.5px 字间距
- 动画: 200-400ms, iOS 缓动函数

## 依赖关系

- 依赖 CSS 变量系统 (src/renderer/index.css)
- 被 App.tsx 站点列表使用

## 版本历史

- 2025-01-08: 创建组件
