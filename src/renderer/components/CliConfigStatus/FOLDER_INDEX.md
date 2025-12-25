# 📁 src/renderer/components/CliConfigStatus/ - CLI 配置状态

## 架构说明

**职责**: 提供 CLI 工具配置来源状态显示组件

**特点**:
- 显示 CLI 配置来源类型（应用管理/官方 API/订阅账号/其他中转站/未配置）
- 支持紧凑模式和完整模式
- 根据状态类型显示不同的颜色和样式
- 显示站点名称、URL 等详细信息

**依赖关系**:
- 被 `CliConfigStatusPanel` 和其他组件使用
- 依赖 `shared/types/config-detection` 获取类型定义

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **CliConfigStatus.tsx** | 单个 CLI 配置状态组件 | `CliConfigStatus` 组件 |
| **CliConfigStatusPanel.tsx** | CLI 配置状态面板组件 | `CliConfigStatusPanel` 组件 |
| **index.ts** | 模块导出 | 组件和类型导出 |

---

## 🎯 关键功能

### 配置来源类型显示

- **managed**: 绿色 - 使用应用管理的站点
- **official**: 蓝色 - 使用官方 API
- **subscription**: 紫色 - 使用订阅账号
- **other**: 橙色 - 使用其他中转站
- **unknown**: 灰色 - 未配置

### 显示模式

- **紧凑模式**: 仅显示图标和简短状态标签
- **完整模式**: 显示图标、状态标签和 URL 详情

---

## 🔄 自引用

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.9  
**更新日期**: 2025-12-25
