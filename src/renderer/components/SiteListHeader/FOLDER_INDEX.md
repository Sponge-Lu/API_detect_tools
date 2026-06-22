# 📁 src/renderer/components/SiteListHeader/ - 站点列表头部

## 架构说明

**职责**: 提供站点列表头部 (站点/账户/刷新时间列、列宽、排序、History 选择器、批量动作槽位)

**特点**:
- 多列标题与列宽调整，账户和刷新时间作为独立只读列展示
- 在列头内联显示排序状态
- History 列头内嵌旧版 CLI 图标选择器和综合/探测/路由模式切换
- 右侧保留批量操作槽位
- 未传入 actions 时最后一列表头保持空白，不显示默认“操作”文案
- 保持列表扫描节奏稳定，不引入额外工具带

**依赖关系**:
- 被 `App.tsx` 使用
- 依赖 `store/uiStore` 管理搜索和筛选状态
- 依赖 `utils/` 工具函数

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **SiteListHeader.tsx** | 站点列头主组件，显示站点/账户/刷新时间等多列标题、列宽调节、内联排序提示，并在 History 表头提供旧 CLI 图标选择器与模式切换 | `SiteListHeader` 组件 |
| **SearchBar.tsx** | 搜索框 | `SearchBar` 组件 |
| **FilterBar.tsx** | 筛选栏 | `FilterBar` 组件 |
| **SortMenu.tsx** | 排序菜单 | `SortMenu` 组件 |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 3.0.5
**更新日期**: 2026-06-18
