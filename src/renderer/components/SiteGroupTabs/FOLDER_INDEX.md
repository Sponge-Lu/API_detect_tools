# 📁 src/renderer/components/SiteGroupTabs/ - 站点分组标签

## 架构说明

**职责**: 提供站点分组标签切换组件

**特点**:
- 分组标签显示
- 分组切换功能
- 新增/编辑/删除分组
- 拖拽排序分组

**依赖关系**:
- 被 `App.tsx` 使用
- 依赖 `hooks/useSiteGroups` 管理分组
- 依赖 `store/` 管理状态

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **SiteGroupTabs.tsx** | 分组标签主组件 | `SiteGroupTabs` 组件 |
| **GroupTab.tsx** | 单个分组标签 | `GroupTab` 组件 |
| **GroupMenu.tsx** | 分组菜单 (编辑、删除) | `GroupMenu` 组件 |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.8  
**更新日期**: 2025-12-24
