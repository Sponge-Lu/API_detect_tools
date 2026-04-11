# 📁 src/renderer/components/SiteCard/ - 站点卡片组件

## 架构说明

**职责**: 提供站点卡片显示和交互组件

**特点**:
- 使用兼容卡片原语承载统一产品级表面样式
- 使用纯色背景 + 边框分隔（无渐变）
- 显示站点基本信息
- 显示检测结果
- 提供操作按钮
- 支持拖拽排序
- 支持展开/收起动画
- 显示 LDC 支付支持状态
- 签到图标悬停显示签到统计 (New API 类型站点)

**依赖关系**:
- 被 `App.tsx` 使用
- 依赖 `AppCard` 原语提供统一卡片表面
- 依赖 `hooks/` 处理业务逻辑
- 依赖 `store/` 管理状态

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **SiteCard.tsx** | 站点卡片主组件（保持主行信息栅格 + 右侧操作区的稳定结构） | `SiteCard` 组件 |
| **SiteCardHeader.tsx** | 卡片头部（沿用多列信息栅格，CLI 图标与动作保持内联） | `SiteCardHeader` 组件 |
| **SiteCardDetails.tsx** | 卡片详情（URL、Access Token、用户分组、API Keys、模型列表），沿用统一分隔线与表面层级 | `SiteCardDetails` 组件 |
| **SiteCardActions.tsx** | 卡片操作按钮（高频动作直出，低频动作进入更多菜单；更多菜单使用固定定位避免被卡片裁切） | `SiteCardActions` 组件 |
| **types.ts** | 类型定义（isDetecting 布尔值支持并发刷新，区分打开站点与签到页回调） | `SiteCardProps`, `SiteCardActionsProps` 等 |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 3.0.1
**更新日期**: 2026-04-01
