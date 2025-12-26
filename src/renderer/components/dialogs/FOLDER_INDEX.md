# 📁 src/renderer/components/dialogs/ - 对话框组件

## 架构说明

**职责**: 提供各类对话框组件

**特点**:
- 模态对话框
- 表单验证
- 错误提示
- 加载状态

**依赖关系**:
- 被 `App.tsx` 和其他组件使用
- 依赖 `store/uiStore` 管理对话框状态
- 依赖 `utils/` 工具函数

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **SiteEditorDialog.tsx** | 站点编辑对话框 | `SiteEditorDialog` 组件 |
| **SettingsDialog.tsx** | 设置对话框 | `SettingsDialog` 组件 |
| **ConfirmDialog.tsx** | 确认对话框 | `ConfirmDialog` 组件 |
| **ApiKeyDialog.tsx** | API Key 对话框 | `ApiKeyDialog` 组件 |
| **ApplyConfigPopover.tsx** | 应用配置弹出菜单 | `ApplyConfigPopover` 组件，支持选择 CLI 并写入配置，应用后自动刷新 CLI 配置检测状态 |
| **UnifiedCliConfigDialog.tsx** | 统一 CLI 配置对话框 | `UnifiedCliConfigDialog` 组件 |
| **CloseBehaviorDialog.tsx** | 窗口关闭行为对话框 | `CloseBehaviorDialog` 组件，用户选择退出或最小化到托盘 |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.9  
**更新日期**: 2025-12-26
