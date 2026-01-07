# 📁 src/renderer/components/SiteCard/ - 站点卡片组件

## 架构说明

**职责**: 提供站点卡片显示和交互组件

**特点**:
- 显示站点基本信息
- 显示检测结果
- 提供操作按钮
- 支持拖拽排序
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
| **SiteCard.tsx** | 站点卡片主组件 | `SiteCard` 组件 |
| **SiteCardHeader.tsx** | 卡片头部 (站点名称、状态、余额、消费、Token、RPM/TPM、模型数、更新时间、CLI兼容性、LDC 支付状态) | `SiteCardHeader` 组件 |
| **SiteCardDetails.tsx** | 卡片详情（URL、Access Token、用户分组、API Keys、模型列表） | `SiteCardDetails` 组件 |
| **SiteCardActions.tsx** | 卡片操作按钮（加油站、签到(含统计tooltip)、展开、刷新、自动刷新、编辑、删除） | `SiteCardActions` 组件 |
| **types.ts** | 类型定义 | `SiteCardProps`, `SiteCardActionsProps` 等 |

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.12  
**更新日期**: 2026-01-06
