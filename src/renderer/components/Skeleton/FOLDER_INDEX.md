# 📁 src/renderer/components/Skeleton/ - 骨架屏组件

## 架构说明

**职责**: 提供加载占位符骨架屏组件

**特点**:
- 加载状态显示
- 动画效果
- 响应式设计
- 支持深色模式

**依赖关系**:
- 被 `App.tsx` 和其他组件使用
- 依赖 `store/uiStore` 管理加载状态
- 依赖 Tailwind CSS 样式

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **SkeletonLoader.tsx** | 通用骨架屏加载器 | `SkeletonLoader` 组件 |
| **SkeletonCard.tsx** | 卡片骨架屏 | `SkeletonCard` 组件 |
| **SkeletonTable.tsx** | 表格骨架屏 | `SkeletonTable` 组件 |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.8  
**更新日期**: 2025-12-24
