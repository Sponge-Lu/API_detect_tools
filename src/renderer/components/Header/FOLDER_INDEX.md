# 📁 src/renderer/components/Header/ - 顶部导航栏

## 架构说明

**职责**: 提供应用顶部导航栏组件

**特点**:
- Logo 和应用标题
- Credit 面板（Linux Do Credit 积分监控）
- 保存状态指示器
- 设置按钮（带更新提示徽章）
- 响应式设计

**依赖关系**:
- 被 `App.tsx` 使用
- 依赖 `components/CreditPanel` 显示积分信息
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

**版本**: 2.1.10  
**更新日期**: 2025-12-30
