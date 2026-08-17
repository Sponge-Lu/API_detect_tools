# API Hub Management Tools - 架构文档

## 架构概览

本项目采用 **Electron + React + TypeScript** 双进程架构：

- **主进程**：负责文件系统、浏览器自动化、HTTP 请求、配置持久化、路由代理与 IPC。
- **渲染进程**：负责工作台 UI、交互逻辑、状态管理和页面展示。
- **共享层**：负责前后端共用的类型、常量、schema 和主题预设。

当前版本为 **v3.0.4**。相较 `v2.1.24`，核心架构变化是：

- 配置模型升级为 v3：`sites + accounts + routing`
- 新增并行的 `本地路由`、`模型映射`、`配置文件` 工作区
- 本地路由升级为按 pathname 分派的三协议通用网关，客户端身份不参与基础协议和通道选择
- 接入点侧滑面板只提供三端点原生测试；顶部上游协议字段仅供真实路由使用
- 路由运行态、端点测试最新结果、分析桶和模型来源快照拆分到 bounded sidecar 文件
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
- `accounts`：站点账号、账号级自动刷新和 CLI 配置。
- `routing`：Route 工作台对应的稳定服务配置、规则、模型展示项、优先级与 CLI 选择。
- 运行态检测缓存、路由路径状态、端点测试 latest、路由分析桶和模型来源快照存入 `runtime-cache.json` 与 `state/route-*.json` sidecar 文件。

### 加载与恢复策略

`UnifiedConfigManager.loadConfig()` 的行为：

1. 读取 `config.json`。
2. 校验根结构，防止损坏文件被静默标准化为空配置。
3. 若为旧版本配置，则执行 `v2 -> v3` 自动迁移。
4. 若读取失败，会先短暂重试，避免并发原子写入期间的瞬时不可读被误判为持久损坏。
5. 若仍失败，则尝试从最近备份恢复。
6. 若原文件损坏，会先保留 `.corrupted.*.json` 副本，再生成/恢复有效配置。

---

## 渲染层架构

### 页面与壳层

`src/renderer/App.tsx` 负责整体布局：

- `VerticalSidebar`：一级导航
- `GlobalCommandBar`：全局操作区
- `PageHeader`：当前页标题与说明
- 页面工作台：
  - `DataOverviewPage`
  - `SitesPage`
  - `RoutePage`
  - `ModelMappingPage`
  - `ConfigFilesPage`
  - `LogsPage`
  - `CreditPage`
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
| `EndpointTestService` | 解析托管/直连目标，绕过协议转换执行三协议原生测试并保存最新时间 |
| `ConfigFileProfileService` | 配置卡片持久化、文件授权、预览事务、原子写入/回滚和会话记录扫描 |
| `RouteSessionService` | 会话规则提取、候选发现、活动生命周期、连接器关联和覆盖查询 |
| `CreditService` | Linux Do Credit 数据读取与充值跳转 |
| `UpdateService` | 版本检查、应用内下载、安装 |

### 端点测试执行路径

`endpoint-test:*` IPC 接收接入目标、协议、API Key 与模型。测试页保存接入点级上游协议，但 `EndpointTestService` 始终按被测协议构造原生请求，不调用协议转换层。托管目标同时返回站点全量模型与各 API Key 用户分组可用模型，直连目标返回已获取和手工模型并集。

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

Route 相关能力是 v3 主线相比 v2.1.24 最重要的新增模块之一。

### 主进程模块

- `route-proxy-service.ts`：三协议 pathname 分派、模型发现/根探测、代理启停、完整 Base URL 前缀拼接和请求执行
- `route-channel-resolver.ts`：通道路由决策
- `route-session-service.ts`：基于 `agentId + runtimeSlotId + sessionId` 的 RouteInstance 生命周期、ARMED 原子绑定、槽位切换和配置覆盖
- `route-rule-engine.ts`：规则匹配
- `route-model-registry-service.ts`：模型注册表与覆盖项
- `endpoint-test-service.ts`：三协议手动测试与最新结果持久化
- `route-analytics-service.ts`：聚合分析统计
- `route-health-service.ts`：健康检查
- `route-stats-service.ts`：统计写入
- `route-target-lock.ts`：手动端点测试的 loopback 目标锁定编解码与请求尝试预算

### 渲染层页面

- `RoutePage`：本地网关服务与会话级模型/思考强度覆盖
- `ModelMappingPage`：模型重定向、原始来源和候选优先级
- `ConfigFilesPage`：配置方案摘要卡片（整卡点击编辑）、规则详情、模板应用与本地文件保存（行级 diff 预览）和对话记录路径
- `DataOverviewPage`：数据总览页；路由数据子页展示 KPI、趋势、模型热力、通道散点与 Sankey；趋势图在 `24h` / `7d` 视窗内补齐完整小时/日期 X 轴
- `LogsPage`：日志页；路由日志按实际 Agent 动态筛选，首列纯文本展示 Agent，Token 固定两行展示输入/输出与缓存写/读
- `EndpointTestPanel`：接入点侧滑面板的独立测试页，每端点单独选择 Key/模型并显示最近测试时间

### IPC 命名空间

Route 功能统一挂在 `route:*`：

- `route:get-config`
- `route:save-server-config`
- `route:start-server` / `route:stop-server`
- `route:list-rules` / `route:upsert-rule` / `route:delete-rule`
- `route:get-model-registry` / `route:rebuild-model-registry`
- `endpoint-test:get-state` / `endpoint-test:save-selection` / `endpoint-test:run`
- `route:get-analytics-summary` / `route:get-analytics-distribution`
- `route:get-request-logs`
- `route:get-object-stats`
- `route:list-sessions` / `route:upsert-session-override` / `route:upsert-session-rule`
- `config-file-profile:load` / `config-file-profile:upsert` / `config-file-profile:delete`
- `config-file-profile:target-catalog` / `config-file-profile:preview` / `config-file-profile:preview-direct-edit` / `config-file-profile:commit`

---

## 配置文件与端点测试

### 存储位置

| 数据 | 位置 |
|------|------|
| 接入点上游协议 | `account.routeTargetProtocol` 或直连配置 `routeTargetProtocol` |
| 自定义配置卡片 | `${userData}/config-file-profiles.json` |
| 直连接入点 | `${userData}/custom-cli-configs.json` |
| 会话规则与覆盖 | `config.json` 的 `routing.sessionRouting`（活动记录仅在内存） |
| 端点测试最新状态 | `${userData}/state/route-endpoint-tests.json` |

### 当前策略

- 配置卡片不参与网关客户端识别；删除所有卡片后标准协议请求仍可路由。
- 四个旧 CLI 的完整配置由 `shared/config/builtin-client-configs.ts` 统一构建；未修改的简化示例可升级，用户修改不会被覆盖。
- 模板只保存目标引用和占位字符，真实 API Key 按需解析，不写入普通日志。
- 主进程提供过滤不可用目标的非敏感目录，并分别提供本地重定向、Key 分组、账户原始与直连模型域。
- 模板应用与真实文件编辑使用独立、绑定 revision/路径/hash/mtime/权限的事务；JSON/TOML/ENV 合并失败禁止降级覆盖。
- 对话记录扫描按路径、mtime 和大小缓存，坏文件形成逐路径诊断，记录独有会话保持候选状态。
- 会话窗口状态使用 `open/closed/unknown` 三态：记录级 `activePath` 可直接提供状态；JSON 顶层必须由 `windowOpenPath` 与 `currentSessionIdPath` 共同证明窗口打开且当前 ID 匹配。残留 ID、请求时间和文件 mtime 都不能产生 `open`。
- 会话路由在代理读取 JSON 请求体后、选择路由前归一化完整稳定三元键 `agentId + runtimeSlotId + sessionId`。完整内部 `x-api-detect-*` 键优先；当前 Codex 也可由原生 `x-codex-window-id` 与 `client_metadata` 的 `session_id/window_id` 等确定性字段组成键。缺失、冲突或不合法时不创建实例也不消耗 ARMED。首个未知键绑定预创建配置或按请求配置自动创建，同槽位新 Session 关闭旧实例，静默时长不改变状态。
- 静态 CLI 配置只负责生成并应用本地客户端文件，不承载动态会话身份。代理只剥离应用内部 `x-api-detect-*` 身份头，Codex 原生协议 Header 保持上送。
- 扫描候选保存的覆盖带有 `probable` 关联等级，只有后续 HTTP 请求提供相同稳定 ID 时才应用；手工预配置的稳定 ID 持久化为 `exact`，清理活动记录不会删除覆盖。

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
2. 普通代理请求按规则、模型注册表、站点优先级、API Key 优先级和运行时路径健康状态选择上游。
3. 手动端点测试使用 target lock 精确选择站点 / 账户 / API Key / 模型，不进入普通路由统计。
4. 运行结果写入 route runtime、endpoint tests 和 analytics 各自的 sidecar。
5. 渲染层通过 `routeStore`、数据总览页和日志页拉取摘要、分布、逐条请求尝试与最新状态。
6. 路由数据趋势图由前端按当前 scope 过滤后的桶级数据聚合；`24h` 固定生成 24 个小时点，`7d` 固定生成 7 个日期点，缺失桶保持零值，首个真实桶之前的空点只保留 X 轴标签。

---

## 认证与安全

当前认证链路基于“浏览器捕获 + 本地持久化”：

1. 首次登录时通过浏览器获取 `user_id` 与 `access_token`。
2. 若站点未直接返回 token，`TokenService` 会尝试自动创建访问令牌。
3. 后续请求优先使用缓存凭证。
4. 若遇到挑战页、Cloudflare 或会话异常，则回退浏览器模式。

已实现的保护措施：

- 配置原子写入
- 同一目标文件的 JSON/text 原子写入串行化，并对 Windows final rename 临时锁重试
- 损坏配置副本保留
- 自动备份与恢复
- manifest 配置包默认排除敏感配置、日志和受保护浏览器状态
- 登录浏览器与检测浏览器解耦

---

## 总结

从架构视角看，`v3.0.4` 的关键特征是：

- **数据模型更清晰**：站点、账号、稳定路由配置与高频运行态 sidecar 分层明确。
- **工作台能力更完整**：站点管理之外，新增路由代理运维面。
- **端点测试更明确**：协议中立、目标锁定、最新结果与时间持久化形成统一诊断链路。
- **UI 与主题体系收敛**：从旧命名和多套实验主题回到统一原语与双主题。
- **恢复能力更强**：配置迁移、坏文件保护和备份恢复成为内建能力。
