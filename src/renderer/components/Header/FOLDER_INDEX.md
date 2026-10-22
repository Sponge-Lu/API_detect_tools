# 📁 src/renderer/components/Header/ - 顶部导航栏

## 架构说明

**职责**: 应用顶部导航栏：当前页面标题、说明与右侧操作槽位。

**特点**:
- 标题/说明由 `AppShell/pageMeta.ts` 与当前 `activeTab` 决定
- 右侧操作区由各页面通过 `setPageHeaderActions` 注入（如 `刷新`、`24h / 7d`）
- 不内置主题切换与菜单：主题在 `设置` 页，导航在 `Sidebar/`

**依赖关系**:
- 被 `App.tsx` 使用
- 依赖 `store/uiStore` 的当前页面状态

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **Header.tsx** | 顶部导航栏主组件 | `Header`, `HeaderProps` |
| **index.ts** | 桶文件 | re-export `Header` |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 3.1.3
**更新日期**: 2026-10-22
