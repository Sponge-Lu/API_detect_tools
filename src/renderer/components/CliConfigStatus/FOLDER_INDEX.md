# 📁 src/renderer/components/CliConfigStatus/ - CLI 配置状态

## 架构说明

**职责**: 提供 CLI 工具配置来源状态与当前模型显示组件

**特点**:
- 显示 CLI 配置来源类型（应用管理/官方 API/订阅账号/其他中转站/未配置）
- 当 CLI Base URL 指向本机路由代理端口时，显示为“本地路由”，并用小字显示当前 CLI 默认模型
- 站点管理配置与自定义 CLI 配置会用小字显示当前 CLI 使用模型
- 支持紧凑模式和完整模式
- 根据状态类型显示不同的颜色和样式
- 显示站点名称、URL 等详细信息

**依赖关系**:
- 被 `CliConfigStatusPanel` 和其他组件使用
- 依赖 `shared/types/config-detection` 获取类型定义
- 依赖 `routeStore` 读取本地路由代理服务器端口和默认模型
- 依赖 `detectionStore` / `customCliConfigStore` 读取站点与自定义 CLI 模型

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **CliConfigStatus.tsx** | 单个 CLI 配置状态组件，含本地路由代理显示覆盖和模型小字 | `CliConfigStatus` 组件 |
| **CliConfigStatusPanel.tsx** | CLI 配置状态面板组件 | `CliConfigStatusPanel` 组件 |
| **index.ts** | 模块导出 | 组件和类型导出 |

---

## 🎯 关键功能

### 配置来源类型显示

- **managed**: 绿色 - 使用应用管理的站点，小字显示站点/账户 CLI 模型
- **本地路由**: 绿色 - CLI Base URL 匹配当前本机路由代理端口，小字显示 `cliModelSelections` 当前模型
- **official**: 蓝色 - 使用官方 API
- **subscription**: 紫色 - 使用订阅账号
- **other**: 橙色 - 使用其他中转站；若匹配自定义 CLI 配置，小字显示该配置的 CLI 模型
- **unknown**: 灰色 - 未配置

### 显示模式

- **紧凑模式**: 仅显示图标和简短状态标签
- **完整模式**: 显示图标、状态标签和 URL 详情

---

## 🔄 自引用

当此文件夹中的文件变化时，更新本索引、src/renderer/components/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.9  
**更新日期**: 2026-05-06
