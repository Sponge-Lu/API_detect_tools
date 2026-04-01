# IOSTable 兼容目录

## 概述

该目录保留 legacy `IOSTable` 命名；当前对外推荐名称为 `DataTable`。

## 文件结构

| 文件 | 描述 |
|------|------|
| `IOSTable.tsx` | 表格原语实现文件，包含所有表格子原语 |
| `index.ts` | 将 `DataTable` 系列导出映射为 `IOSTable` 兼容别名 |
| `FOLDER_INDEX.md` | 本文件 |

## 原语说明

### DataTable / IOSTable

表格容器原语，支持以下变体：
- `standard`: 标准表面层级
- `grouped`: 分组表面层级
- `inset`: 内嵌透明层级

### DataTableHeader / DataTableRow / DataTableCell / DataTableBody / DataTableDivider / DataTableEmpty

这些表格子原语共同提供：
- 统一主题 token 驱动的圆角、背景、分隔线与文字语义
- 最小 44px 行高
- 悬停、选中、禁用和键盘焦点语义
- 交错淡入与响应式布局支持

## 使用建议

- 新代码优先直接使用 `DataTable` 系列
- 旧代码仍可通过 `IOSTable` 系列命名工作

## 版本历史

- 2025-01-08: 创建表格原语与兼容导出
