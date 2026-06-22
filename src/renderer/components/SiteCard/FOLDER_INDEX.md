# 📁 src/renderer/components/SiteCard/ - 站点列表行组件

## 架构说明

**职责**: 提供站点列表行显示和交互组件

**特点**:
- 使用连续表格行样式承载统一产品级列表表面
- 使用纯色背景 + 边框分隔（无渐变）
- 显示站点基本信息
- 显示检测结果
- 提供主行高频操作按钮
- 托管站点支持拖拽排序，直连配置行不参与排序
- 显示 LDC 支付支持状态
- 签到图标悬停显示签到统计 (New API 类型站点)

**依赖关系**:
- 被 `App.tsx` 使用
- 依赖 `hooks/` 处理业务逻辑
- 依赖 `store/` 管理状态

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **SiteCard.tsx** | 站点列表行主组件（保持主行信息栅格 + 右侧操作区的稳定结构；详情由接入点侧滑面板承载；支持 `custom-cli` 直连轻量行且可关闭拖拽） | `SiteCard` 组件 |
| **SiteCardHeader.tsx** | 列表行头部（站点、账户、刷新时间、余额、今日消费、模型数量、History 列；模型数按唯一模型去重，History 与站点名按钮不会误触发行选择） | `SiteCardHeader` 组件 |
| **SiteCardDetails.tsx** | 资源详情区（URL、Access Token、用户分组、API Keys、模型列表），由接入点侧滑面板 Tab2 复用；API Key 启用状态统一通过 shared `isApiKeyActive()` 兼容 `status/status_str/state/enabled` 字段，并提供单个 API Key 状态刷新按钮 | `SiteCardDetails` 组件 |
| **SiteCardActions.tsx** | 主行高频操作按钮（打开加油站、签到、刷新检测）；编辑/删除/添加账户/自动刷新等低频入口迁移到接入点侧滑面板 | `SiteCardActions` 组件 |
| **types.ts** | 类型定义（isDetecting 布尔值支持并发刷新，区分打开站点与签到页回调） | `SiteCardProps`, `SiteCardActionsProps` 等 |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 3.0.5
**更新日期**: 2026-06-17
