# IOSCard 组件

## 概述

该目录承载卡片原语。当前目录名仍保留 legacy 命名，但文档叙述遵循统一产品级设计系统。

## 文件结构

| 文件 | 描述 |
|------|------|
| `IOSCard.tsx` | 卡片原语实现 |
| `index.ts` | 导出入口 |
| `FOLDER_INDEX.md` | 本文档 |

## 组件

### IOSCard

主卡片原语，支持以下功能：
- 使用统一主题 token 的卡片表面、阴影和模糊效果
- 悬停状态（阴影增强、轻微上移）
- 展开/收起动画
- 拖拽支持
- 焦点、禁用和 `aria-expanded` 等无障碍语义

**Props:**
- `variant`: 卡片变体 (`'standard'` | `'elevated'` | `'grouped'`)
- `blur`: 是否启用模糊效果
- `hoverable`: 是否启用悬停效果
- `expanded`: 是否展开
- `expandContent`: 展开内容
- `draggable`: 是否可拖拽
- `isDragOver`: 是否处于拖拽悬停状态
- `disabled`: 是否禁用

### IOSCardDivider

卡片内分隔线原语，使用统一分隔线 token。

### IOSCardHeader / IOSCardContent / IOSCardFooter

卡片头部、内容区和底部操作区的被动布局原语。

## 使用建议

- 当前卡片原语仍以 `IOSCard` 命名导出
- 文档中不再将其描述为平台品牌化组件，而是视为产品级卡片原语

## 更新日志

- 2025-01-08: 创建卡片原语
