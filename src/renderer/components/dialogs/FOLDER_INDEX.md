# 📁 src/renderer/components/dialogs/ - 对话框组件

## 架构说明

**职责**: 提供各类对话框组件

**特点**:
- 使用 IOSModal 组件实现 iOS 风格弹窗
- 模态对话框
- 表单验证
- 错误提示
- 加载状态

**依赖关系**:
- 被 `App.tsx` 和其他组件使用
- 依赖 `IOSModal` 组件提供统一的弹窗样式
- 依赖 `IOSButton` 组件提供统一的按钮样式
- 依赖 `store/uiStore` 管理对话框状态
- 依赖 `utils/` 工具函数

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **AuthErrorDialog.tsx** | 认证错误对话框 | `AuthErrorDialog` 组件，分析并展示 Session/Token 过期等问题 |
| **SiteGroupDialog.tsx** | 站点分组对话框 | `SiteGroupDialog` 组件，支持创建和编辑分组 |
| **ApplyConfigPopover.tsx** | 应用配置弹出菜单 | `ApplyConfigPopover` 组件，支持选择 CLI 并写入配置 |
| **UnifiedCliConfigDialog.tsx** | 统一 CLI 配置对话框 | `UnifiedCliConfigDialog` 组件，支持 CLI 启用/禁用、配置选择、预览编辑和保存 |
| **CloseBehaviorDialog.tsx** | 窗口关闭行为对话框 | `CloseBehaviorDialog` 组件，用户选择退出或最小化到托盘 |
| **BackupSelectDialog.tsx** | 备份选择对话框 | `BackupSelectDialog` 组件，从备份目录选择配置文件进行恢复 |
| **AutoRefreshDialog.tsx** | 自动刷新配置对话框 | `AutoRefreshDialog` 组件 |
| **DownloadUpdatePanel.tsx** | 下载更新面板 | `DownloadUpdatePanel` 组件，显示 changelog、下载进度和安装按钮 |
| **WebDAVBackupDialog.tsx** | WebDAV 备份对话框 | `WebDAVBackupDialog` 组件 |
| **index.ts** | 导出文件 | 导出所有对话框组件 |

---

## 🎨 iOS 风格重构

所有对话框组件已使用 IOSModal 重构，具有以下特性：

- iOS 风格样式（圆角、毛玻璃背景、居中）
- 遮罩层（半透明黑色背景 + 模糊）
- 打开/关闭动画（缩放 + 淡入淡出）
- 按钮布局（底部横向排列，主要操作在右侧）
- 支持 ESC 键关闭
- 支持点击遮罩关闭

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.21
**更新日期**: 2026-02-24
