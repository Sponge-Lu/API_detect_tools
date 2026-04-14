# API Hub Management Tools - 架构文档

## 架构概览

本项目采用 **Electron + React + TypeScript** 双进程架构：

- **主进程**：负责文件系统、浏览器自动化、HTTP 请求、配置持久化、路由代理与 IPC。
- **渲染进程**：负责工作台 UI、交互逻辑、状态管理和页面展示。
- **共享层**：负责前后端共用的类型、常量、schema 和主题预设。

当前版本为 **v3.0.1**。相较 `v2.1.24`，核心架构变化是：

- 配置模型升级为 v3：`sites + accounts + routing`
- 新增 Route 工作台与对应主进程路由服务
- UI 原语迁移到 `App*` 中性命名体系
- 主题系统收敛为 `Light` / `Dark`

---

## 技术栈

| 领域 | 技术 |
|------|------|
| 桌面运行时 | Electron 28 |
| UI | React 18 |
| 语言 | TypeScript |
| 构建 | Vite + electron-builder |
| 状态管理 | Zustand |
| 自动化 | Puppeteer Core |
| 数据校验 | Zod |
| 测试 | Vitest + React Testing Library + fast-check |

---

## 目录结构

```text
src/
├── main/
│   ├── handlers/              # IPC handlers
│   ├── utils/                 # 主进程工具、HTTP 客户端等
│   ├── api-service.ts
│   ├── chrome-manager.ts
│   ├── token-service.ts
│   ├── unified-config-manager.ts
│   ├── route-*.ts             # 路由代理、规则、探测、分析等服务
│   ├── main.ts
│   └── preload.ts
├── renderer/
│   ├── components/            # UI 原语、对话框、工作台组件
│   ├── hooks/                 # 业务 hooks
│   ├── pages/                 # 顶层页面
│   ├── store/                 # Zustand stores
│   ├── services/
│   ├── utils/
│   └── App.tsx
├── shared/
│   ├── constants/
│   ├── schemas/
│   ├── theme/
│   ├── types/
│   └── utils/
└── __tests__/
```

---

## 配置模型

`UnifiedConfigManager` 是单一配置源。当前配置文件核心结构如下：

```ts
interface UnifiedConfig {
  version: '3.0';
  sites: UnifiedSite[];
  accounts: AccountCredential[];
  siteGroups: SiteGroup[];
  settings: Settings;
  routing?: RoutingConfig;
  last_updated: number;
}
```

### v3 配置要点

- `sites`：站点元信息、站点级设置、兼容层字段。
- `accounts`：站点账号、账号级自动刷新、缓存数据、CLI 配置。
- `routing`：Route 工作台对应的服务配置和运行统计。

### 加载与恢复策略

`UnifiedConfigManager.loadConfig()` 的行为：

1. 读取 `config.json`。
2. 校验根结构，防止损坏文件被静默标准化为空配置。
3. 若为旧版本配置，则执行 `v2 -> v3` 自动迁移。
4. 若读取失败，则尝试从最近备份恢复。
5. 若原文件损坏，会先保留 `.corrupted.*.json` 副本，再生成/恢复有效配置。

---

## 渲染层架构

### 页面与壳层

`src/renderer/App.tsx` 负责整体布局：

- `VerticalSidebar`：一级导航
- `GlobalCommandBar`：全局操作区
- `PageHeader`：当前页标题与说明
- 页面工作台：
  - `SitesPage`
  - `CustomCliPage`
  - `ModelRedirectionTab`
  - `CliUsabilityTab`
  - `ProxyStatsTab`
  - `SettingsPage`

### 设计系统

当前 UI 使用统一产品级原语体系：

- `AppButton`
- `AppInput`
- `AppModal`
- `DataTable`
- `AppCard`
- `AppIcon`

主题预设由 `src/shared/theme/themePresets.ts` 管理，目前仅支持：

- `light-b`：默认浅色主题
- `dark`：深色主题

旧主题值会在加载时归一化到当前支持集合。

### Zustand 状态划分

- `configStore`：配置与保存状态
- `detectionStore`：站点检测结果、CLI 检测缓存
- `uiStore`：当前页面、排序、弹窗、侧边栏状态
- `routeStore`：Route 工作台数据与运行状态
- `toastStore`：全局通知

---

## 主进程架构

### 核心服务

| 服务 | 职责 |
|------|------|
| `ApiService` | 站点检测、HTTP 请求、余额/模型/API Key 数据抓取 |
| `TokenService` | 登录初始化、token 校验、签到、access token 自动补建 |
| `ChromeManager` | 多槽位检测浏览器池、独立登录浏览器、页面复用与清理 |
| `UnifiedConfigManager` | 配置加载、迁移、原子写入、备份恢复、路由配置持久化 |
| `CliCompatService` | Claude Code / Codex / Gemini CLI 兼容性测试 |
| `CreditService` | Linux Do Credit 数据读取与充值跳转 |
| `UpdateService` | 版本检查、应用内下载、安装 |

### 浏览器管理模型

`ChromeManager` 当前包含两类浏览器资源：

- **检测浏览器池**：按槽位管理，`slot 0` 为主槽位，`slot N` 为隔离槽位。
- **独立登录浏览器**：专门处理登录，不占用检测槽位。

这样做的目的：

- 避免登录流程与批量检测共享同一个浏览器实例。
- 支持多账号场景下按槽位或按 Profile 工作。
- 在站点需要浏览器上下文时复用页面，减少重复回退成本。

### HTTP 客户端层

主进程通过 `src/main/utils/http-client.ts` 统一 HTTP 行为：

- 开发环境优先走 Node/OpenSSL。
- 打包环境可回退到 Electron `net`（Chromium 网络栈）。
- 用于处理 TLS 差异、系统代理继承和部分下载场景。

---

## Route 工作台

Route 相关能力是 v3.0.1 相比 v2.1.24 最重要的新增模块之一。

### 主进程模块

- `route-proxy-service.ts`：代理服务器启停与运行状态
- `route-channel-resolver.ts`：通道路由决策
- `route-rule-engine.ts`：规则匹配
- `route-model-registry-service.ts`：模型注册表与覆盖项
- `route-cli-probe-service.ts`：CLI 探测配置、历史与最新结果
- `route-analytics-service.ts`：聚合分析统计
- `route-health-service.ts`：健康检查
- `route-stats-service.ts`：统计写入

### 渲染层页面

- `ModelRedirectionTab`：模型映射与重定向规则
- `CliUsabilityTab`：CLI 探测状态、历史与诊断
- `ProxyStatsTab`：代理统计、运行状态、健康信息

### IPC 命名空间

Route 功能统一挂在 `route:*`：

- `route:get-config`
- `route:save-server-config`
- `route:start-server` / `route:stop-server`
- `route:list-rules` / `route:upsert-rule` / `route:delete-rule`
- `route:get-model-registry` / `route:rebuild-model-registry`
- `route:save-cli-probe-config` / `route:run-cli-probe-now`
- `route:get-analytics-summary` / `route:get-analytics-distribution`

---

## CLI 配置与兼容性

### 存储位置

| 数据 | 位置 |
|------|------|
| 站点 CLI 配置 | `account.cli_config` 或兼容层 `site.cli_config` |
| CLI 兼容性缓存 | `account.cached_data.cli_compatibility` 或兼容字段 |
| 自定义 CLI 配置 | `${userData}/custom-cli-configs.json` |

### 当前策略

- **Claude Code**：支持配置生成与应用。
- **Codex**：仅使用 Responses API，`wire_api = "responses"`。
- **Gemini CLI**：保留 Native/Proxy 双端点探测，实际支持判断以 Native 为主。

---

## 关键工作流

### 应用启动

1. `main.ts` 创建窗口。
2. `UnifiedConfigManager` 加载并规范化配置。
3. `preload.ts` 暴露 IPC API。
4. 渲染进程初始化 stores、拉取缓存并恢复 UI。

### 站点检测

1. 页面触发检测。
2. `ApiService` 调度请求。
3. `TokenService` 解析认证与账号上下文。
4. 必要时 `ChromeManager` 介入浏览器回退。
5. 结果回写缓存并更新渲染层状态。

### 自动刷新

1. `useAutoRefresh` 基于站点和账号生成刷新目标。
2. 若站点存在账户列表，则优先按账号维度调度。
3. 定时触发 `detectSingle(..., accountId)`。

### 路由统计

1. Route 请求经过规则解析与通道选择。
2. 运行结果写入 `routing.stats`、`routing.health` 与 `routing.analytics`。
3. 渲染层通过 `routeStore` 拉取摘要、分布与最新状态。

---

## 认证与安全

当前认证链路基于“浏览器捕获 + 本地持久化”：

1. 首次登录时通过浏览器获取 `user_id` 与 `access_token`。
2. 若站点未直接返回 token，`TokenService` 会尝试自动创建访问令牌。
3. 后续请求优先使用缓存凭证。
4. 若遇到挑战页、Cloudflare 或会话异常，则回退浏览器模式。

已实现的保护措施：

- 配置原子写入
- 损坏配置副本保留
- 自动备份与恢复
- 登录浏览器与检测浏览器解耦

---

## 总结

从架构视角看，`v3.0.1` 的关键特征是：

- **数据模型更清晰**：站点、账号、路由配置分层明确。
- **工作台能力更完整**：站点管理之外，新增路由代理运维面。
- **UI 与主题体系收敛**：从旧命名和多套实验主题回到统一原语与双主题。
- **恢复能力更强**：配置迁移、坏文件保护和备份恢复成为内建能力。
