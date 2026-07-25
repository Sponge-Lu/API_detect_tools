# 📁 src/renderer/components/dialogs/ - 对话框组件

## 架构说明

**职责**: 提供各类对话框组件

**特点**:
- 使用 `AppModal` 和 `OverlayDrawer` 组成统一 overlay 家族
- 模态对话框与侧边工作抽屉共用标题栏、正文间距和底部操作区语义
- 表单验证
- 错误提示
- 加载状态

**依赖关系**:
- 被 `App.tsx` 和其他组件使用
- 依赖 `AppModal` 与 `overlays/OverlayDrawer` 提供统一的 overlay 样式
- 依赖 `AppButton` 提供统一的按钮样式
- 部分对话框依赖 `store/uiStore` 或页面局部状态管理打开/关闭
- 依赖 `utils/` 工具函数

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **AuthErrorDialog.tsx** | 认证错误对话框 | `AuthErrorDialog` 组件，分析并展示 Session/Token 过期等问题 |
| **SiteGroupDialog.tsx** | 站点分组对话框 | `SiteGroupDialog` 组件，支持创建和编辑分组 |
| **ApplyConfigPopover.tsx** | 应用配置弹出菜单 | 支持四种内置 CLI；OpenCode 与 Grok Build 仅允许合并写入 |
| **ManagedCliConfigEditorContent.tsx** | 托管站点 CLI 配置编辑内容 | 覆盖四种内置 CLI 的启用、模型、上游协议、预览、保存与应用；仅 Claude Code / Codex 提供模型探测，OpenCode / Grok Build 明确禁用测试 |
| **DirectCliConfigEditorContent.tsx** | 直连配置编辑内容 | 覆盖四种内置 CLI 的模型、上游协议、预览与应用；仅 Claude Code / Codex 提供模型探测，OpenCode / Grok Build 明确禁用测试 |
| **PanelSection.tsx** | 面板通用折叠分区原语 | `PanelSection` 组件，为窄面板内的托管/直连 CLI 编辑器提供统一 section chrome |
| **CloseBehaviorDialog.tsx** | 窗口关闭行为对话框 | `CloseBehaviorDialog` 组件，用户选择退出或最小化到托盘 |
| **BackupSelectDialog.tsx** | 备份选择对话框 | `BackupSelectDialog` 组件，从备份目录选择配置包或旧版配置文件进行恢复 |
| **AutoRefreshDialog.tsx** | 自动刷新配置对话框 | `AutoRefreshDialog` 组件，由 SitesPage 调用，是自动刷新的唯一配置入口（默认30分钟） |
| **AddAccessPointDialog.tsx** | 添加接入点对话框 | `AddAccessPointDialog` 组件，统一提供托管站点智能/手动添加与直连配置新建入口 |
| **AccessPointDetailPanel.tsx** | 接入点详情侧滑面板 | `AccessPointDetailPanel` 组件，承载站点信息、模型 & 资源、CLI 配置 & 测试三 tab；Tab 内容区独立滚动；托管站点 Tab1 提供浏览器 Profile 选择器，可在未绑定、主浏览器和现有隔离浏览器间显式重绑，其中 `manual` 即使残留旧路径也保持未绑定；Tab2 复用 `SiteCardDetails`，Tab3 内嵌托管 CLI 配置/测试；直连配置 Tab1 用同一信息面承载配置名称、元信息与身份表单，Tab2/Tab3 分别内嵌模型和按 CLI 聚合的编辑内容 |
| **OperationRecordDialog.tsx** | 操作记录弹窗 | `OperationRecordDialog` 组件，读取当前会话 `toastStore.eventHistory` 中 `kind: 'action'` 的关键操作记录，排除普通 toast 通知与路由请求日志 |
| **CliProbeSettingsDialog.tsx** | 站点设置弹窗 | `SiteSettingsDialog` 组件（保留 `CliProbeSettingsDialog` 兼容导出），由 SitesPage 页头“设置”调用；分为“CLI 探测”和“站点刷新”两个页签，分别保存 `routing.cliProbe.config` 与站点刷新参数 |
| **DownloadUpdatePanel.tsx** | 下载更新面板 | `DownloadUpdatePanel` 组件，显示 changelog、下载进度和安装按钮 |
| **WebDAVBackupDialog.tsx** | WebDAV 配置包对话框 | `WebDAVBackupDialog` 组件，上传/恢复/删除云端 manifest 配置包 |
| **index.ts** | 导出文件 | 导出所有对话框组件 |

---

## 🎨 统一 Overlay 体系

当前对话框/工作窗体系基于统一 overlay family，具有以下特性：

- 产品级统一样式（圆角、统一表面色、少边框）
- 遮罩层（半透明黑色背景 + 模糊）
- 居中弹窗与侧边抽屉共用标题栏、正文间距和底部操作区
- 打开/关闭动画（缩放或滑入 + 淡入淡出）
- 按钮布局（底部横向排列，主要操作在右侧）
- 支持 ESC 键关闭
- 支持点击遮罩关闭

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 3.0.5
**更新日期**: 2026-06-22
