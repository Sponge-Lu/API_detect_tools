# 📁 src/renderer/components/Header/ - 顶部导航栏

## 架构说明

**职责**: 提供应用顶部导航栏组件

**特点**:
- 主题切换功能
- 菜单和设置按钮
- 刷新按钮
- 响应式设计

**依赖关系**:
- 被 `App.tsx` 使用
- 依赖 `hooks/useTheme` 进行主题管理
- 依赖 `store/uiStore` 管理 UI 状态

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **Header.tsx** | 顶部导航栏主组件 | `Header` 组件 |
| **ThemeToggle.tsx** | 主题切换按钮 | `ThemeToggle` 组件 |
| **Menu.tsx** | 菜单组件 | `Menu` 组件 |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.8  
**更新日期**: 2025-12-24
