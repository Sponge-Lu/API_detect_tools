# 📁 src/renderer/components/Skeleton/ - 骨架屏组件

## 架构说明

**职责**: 提供加载占位符骨架屏组件。

**特点**:
- 三种粒度：通用块、站点卡片、站点列表
- 纯 CSS 动画（Tailwind），无额外依赖
- 跟随主题 token，深浅色表现一致

**依赖关系**:
- 被站点页与数据总览页使用
- 不依赖 store，纯展示组件

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **Skeleton.tsx** | 通用骨架块 + 站点卡片 / 站点列表两种预设 | `Skeleton`, `SiteCardSkeleton`, `SiteListSkeleton` |
| **index.ts** | 桶文件 | re-export 上述组件 |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 3.1.3
**更新日期**: 2026-10-22
