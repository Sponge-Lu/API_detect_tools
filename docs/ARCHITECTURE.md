# API Hub Management Tools - 架构文档

## 架构概览

本项目采用 **Electron + React + TypeScript** 双进程架构：

- **主进程**：负责文件系统、浏览器自动化、HTTP 请求、配置持久化、路由代理与 IPC。
- **渲染进程**：负责工作台 UI、交互逻辑、状态管理和页面展示。
- **共享层**：负责前后端共用的类型、常量、schema 和主题预设。

当前版本为 **v3.0.4**。相较 `v2.1.24`，核心架构变化是：

- 配置模型升级为 v3：`sites + accounts + routing`
- 新增 `数据总览`、`本地路由` 与 `日志` 工作区，并接入对应主进程路由服务
- CLI 兼容性 UI 测试链路统一切换到真实 wrapper 执行，并通过临时目录隔离本机 CLI 配置
- 路由运行态、CLI 探测、分析桶和模型来源快照拆分到 bounded sidecar 文件，稳定配置不再承载高频状态
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
- `routing`：Route 工作台对应的稳定服务配置、规则、模型展示项、优先级、CLI 选择和探测配置。
- 运行态检测缓存、路由路径状态、CLI 探测 latest/history、路由分析桶和模型来源快照存入 `runtime-cache.json` 与 `state/route-*.json` sidecar 文件，不写回稳定 `config.json`。

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
  - `CustomCliPage`
  - `RoutePage`
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
| `CliCompatService` | 协议级 CLI 兼容性探测，请求格式与真实 CLI 对齐，用于底层能力判断与属性测试 |
| `CliWrapperCompatService` | 拉起真实 Claude Code / Codex / Gemini CLI wrapper，在隔离临时目录中执行当前 UI 的 CLI 可用性测试，并监听本地路由 probe-lock 终止错误以提前结束失败测试 |
| `CreditService` | Linux Do Credit 数据读取与充值跳转 |
| `UpdateService` | 版本检查、应用内下载、安装 |

### CLI 兼容性执行路径

当前前端入口统一走 `cli-compat:test-with-wrapper` IPC，由 `CliWrapperCompatService` 在临时 `HOME` / `CODEX_HOME` / Gemini `HOME/.gemini` 中生成最小配置并执行真实 CLI。测试结束后删除临时目录，不修改用户真实 CLI 配置目录，因此常规测试流程不需要备份或恢复本机 CLI 配置。

站点手动测试与 route 自动探测都会通过本地路由代理的 probe-lock API Key 进行精确定向。probe-lock payload 绑定 `siteId / accountId / apiKeyId / cliType / probeRunId / canonicalModel / rawModel / targetProtocol`，只允许 loopback 客户端使用，且不会转发给上游。

当路由代理观察到 probe-lock 的确定性终止错误（例如无效 API Key、CLI 类型不匹配、非 loopback 请求、凭据不可用、上游 4xx/5xx、所有通道失败或 probe-lock 单模型上游尝试耗尽）时，会通知 wrapper 测试进程提前终止。wrapper 也会记录 CLI 是否真正向本地代理发起过请求，用于区分“上游失败”和“CLI 未连接到代理”。

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

- `route-proxy-service.ts`：代理服务器启停与运行状态
- `route-channel-resolver.ts`：通道路由决策
- `route-rule-engine.ts`：规则匹配
- `route-model-registry-service.ts`：模型注册表与覆盖项
- `route-cli-probe-service.ts`：CLI 探测配置、历史与最新结果
- `route-analytics-service.ts`：聚合分析统计
- `route-health-service.ts`：健康检查
- `route-stats-service.ts`：统计写入
- `route-probe-lock.ts`：CLI 手动测试 / 自动探测的本地定向锁、请求观察、终止错误缓存与单模型上游尝试预算

### 渲染层页面

- `RoutePage`：本地路由配置/操作页，承载代理服务、CLI 默认模型与模型重定向配置
- `DataOverviewPage`：数据总览页；路由数据子页展示 KPI、趋势、模型热力、通道散点与 Sankey；趋势图在 `24h` / `7d` 视窗内补齐完整小时/日期 X 轴
- `LogsPage`：日志页；路由日志子页展示逐条请求尝试、命中路径、站点优先级、Token/cache token 与参考金额
- `CliUsabilityTab`：CLI 探测状态、7 天历史批次条、自动探测设置与诊断信息，当前作为站点检测相关工作区使用

### IPC 命名空间

Route 功能统一挂在 `route:*`：

- `route:get-config`
- `route:save-server-config`
- `route:start-server` / `route:stop-server`
- `route:list-rules` / `route:upsert-rule` / `route:delete-rule`
- `route:get-model-registry` / `route:rebuild-model-registry`
- `route:save-cli-probe-config` / `route:run-cli-probe-now`
- `route:get-analytics-summary` / `route:get-analytics-distribution`
- `route:get-request-logs`
- `route:get-object-stats`

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
- **Gemini CLI**：保留 Native/Proxy 兼容数据结构；路由测试链路会阻断已知内部辅助模型请求，避免 helper/default 模型绕过用户选择。
- 手动 CLI 测试与 route/site detection 探测结果以 `routing.cliProbe.latest/history` 为共享最新结果源；站点卡片、统一 CLI 配置抽屉和 CLI 可用性矩阵都从该源投影。

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
3. CLI probe-lock 请求跳过普通 fallback 语义，精确钉到当前站点 / 账户 / API Key / 模型；单模型测试只允许一次真实上游尝试。
4. 运行结果写入 sidecar 中的 route runtime、probe 和 analytics 状态。
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
- **CLI 测试链路更确定**：真实 wrapper 测试、probe-lock 定向和 route latest 投影形成统一诊断链路。
- **UI 与主题体系收敛**：从旧命名和多套实验主题回到统一原语与双主题。
- **恢复能力更强**：配置迁移、坏文件保护和备份恢复成为内建能力。
