# 📁 src/renderer/components/SiteListHeader/ - 站点列表头部

## 架构说明

**职责**: 提供站点列表头部 (搜索、筛选、排序)

**特点**:
- 搜索功能
- 排序选择
- 状态筛选
- 批量操作

**依赖关系**:
- 被 `App.tsx` 使用
- 依赖 `store/uiStore` 管理搜索和筛选状态
- 依赖 `utils/` 工具函数

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **SiteListHeader.tsx** | 列表头部主组件，显示列标题（站点、余额、消费、Token、RPM/TPM、模型数、更新时间、CLI兼容性、LDC支付） | `SiteListHeader` 组件 |
| **SearchBar.tsx** | 搜索框 | `SearchBar` 组件 |
| **FilterBar.tsx** | 筛选栏 | `FilterBar` 组件 |
| **SortMenu.tsx** | 排序菜单 | `SortMenu` 组件 |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.11  
**更新日期**: 2025-12-30
