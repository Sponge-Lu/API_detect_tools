# API Hub Management Tools - 架构文档

## 架构概览

本项目采用 **Electron + React + TypeScript** 双进程架构：

- **主进程**：负责文件系统、浏览器自动化、HTTP 请求、配置持久化、路由代理与 IPC。
- **渲染进程**：负责工作台 UI、交互逻辑、状态管理和页面展示。
- **共享层**：负责前后端共用的类型、常量、schema 和主题预设。

当前版本为 **v3.1.5**。相较 `v2.1.24`，核心架构变化是：

- 配置模型升级为 v3：`sites + accounts + routing`
- 新增 `本地路由` 与合并后的 `路由模型`（mini 会话路由卡片 + 模型映射）工作区
- 本地路由升级为按 pathname 分派的三协议通用网关，客户端身份不参与基础协议和通道选择
- 接入点侧滑面板只提供三端点原生测试；顶部上游协议字段仅供真实路由使用
- 路由运行态、端点测试最新结果、分析桶和模型来源快照拆分到 bounded sidecar 文件
- 新增 DSH 会话级接入：把 DeepSeek Harness 的 provider 指向本地路由并迁移存量会话
- UI 原语迁移到 `App*` 中性命名体系
- 主题系统支持 `Light` / `Dark` / `Modern` / `Modern Dark` 四套预设

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
  version: string; // 当前为 '3.0'
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
- 页面工作台（顺序与 `APP_PAGE_ORDER` 一致）：
  - `DataOverviewPage`（数据总览）
  - `SitesPage`（站点管理）
  - `RoutePage`（本地路由）
  - `RouteSettingsPage`（路由模型）
  - `LogsPage`（路由日志）
  - `SettingsPage`（设置）

### 设计系统

当前 UI 使用统一产品级原语体系：

- `AppButton`
- `AppInput`
- `AppModal`
- `DataTable`
- `AppCard`
- `AppIcon`

主题预设由 `src/shared/theme/themePresets.ts` 管理，目前支持：

- `light-b`（Light）：默认浅色主题
- `dark`（Dark）：深色主题
- `modern`（Modern）：铂金白浅色
- `modern-dark`（Modern Dark）：铂金白深色

旧主题值会在加载时归一化到当前支持集合。

### Zustand 状态划分

- `configStore`：配置与保存状态
- `detectionStore`：站点检测结果、CLI 检测缓存
- `uiStore`：当前页面、排序、弹窗、侧边栏状态
- `routeStore`：Route 工作台数据与运行状态
- `customCliConfigStore`：直连接入点配置
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
| `EndpointTestStateService` | 独立维护端点测试选择与最新结果的 sidecar，不参与路由运行态、统计或分析 |
| `ConfigFileProfileService` | 配置卡片持久化、文件授权、预览事务、原子写入/回滚和会话记录扫描 |
| `RouteSessionService` | 会话规则提取、候选发现、活动生命周期、连接器关联和覆盖查询 |
| `RouteProxyService` | 三协议通用网关的调度层：监听启停、请求分类、凭证与会话解析、选路与尝试循环、终结响应 |
| `DshIntegrationService` | DSH（DeepSeek Harness）会话级接入：状态检测、模型来源派生、注释保留式 YAML 合并、回滚与存量会话迁移 |
| `UpdateService` | 版本检查、应用内下载、安装 |

### 全局固定模型路由

`routing.globalModelRoutes` 保存精确请求模型、目标模型、思考强度与启用状态，经 SQLite 配置映射持久化，并由 `route:get-config` 回传渲染进程。代理完成凭证解析后，优先匹配启用的固定模型路由；命中时无需会话身份即可选择目标模型，随后沿用模型映射、通道优先级和故障转移。日志以 `global-model` 标记模型选择来源。

### 端点测试执行路径

`endpoint-test:*` IPC 接收接入目标、协议、API Key 与模型。测试页保存接入点级上游协议，但 `EndpointTestService` 始终按被测协议构造原生请求，不调用本地 Route Proxy 或协议转换层；请求直接发送到选定站点/直连配置的 Base URL，并沿用配置的上游代理。托管目标同时返回站点全量模型与各 API Key 用户分组可用模型，直连目标返回已获取和手工模型并集。

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

- `route-proxy-service.ts`：三协议 pathname 分派、模型发现/根探测、代理启停、规则选路与尝试循环调度
- `route-upstream-forwarder.ts`：单次上游尝试的传输、SSE 校验/转换与提交窗口
- `route-request-context.ts`：单请求生命周期（取消传播、尝试计数、日志上下文、终结错误诊断）
- `route-usage.ts`：上游响应体 / SSE 用量与思考强度解析（纯函数）
- `route-proxy-shared.ts`：路径与协议推断小工具
- `route-channel-resolver.ts`：通道路由决策
- `route-upstream-failure.ts`：上游失败分类（请求侧 / 通道侧 / 瞬时 / 配额耗尽）与确证不可用原因解析
- `upstream-credential-resolver.ts`：中性解析托管/直连真实上游凭证；路由与端点测试共享解析结果，但不共享传输执行
- `api-key-identity.ts`：生成稳定 API Key 标识，不属于路由选择或端点传输
- `endpoint-test-state-service.ts`：独立维护端点测试 sidecar；路由状态管理器不再加载或保存端点测试结果
- `route-session-service.ts`：基于 `agentId + runtimeSlotId + sessionId` 的 RouteInstance 生命周期、ARMED 原子绑定、槽位切换和配置覆盖
- `route-session-binding-service.ts`：会话-通道绑定 sidecar，让并发会话各自粘在不同上游通道（通道级绑定，换模型仍保住 prompt cache 亲和）
- `route-session-activity-service.ts`：`lastRequestAt` 高频写入的有界 sidecar（合并写入、TTL/容量压缩、退出 flush）
- `route-state-affinity-service.ts`：Stateful Responses 本地亲和映射与按 profile / site / account / API Key 的实体清理
- `route-rule-engine.ts`：规则匹配与命中解释
- `route-model-registry-service.ts`：模型注册表与覆盖项
- `endpoint-test-service.ts`：三协议手动测试与最新结果持久化
- `route-analytics-service.ts`：聚合分析统计
- `route-stats-service.ts`：路径级三态熔断（阶梯打开 → 半开单探测 → 闭合）、站点级熔断与通道统计写入
- `route-target-lock.ts`：路由层内部 target-lock 请求的编解码与请求尝试预算；端点测试不依赖此模块

### 渲染层页面

- `RoutePage`：本地网关服务 + DSH 接入状态条 + 配置文件卡片区（配置方案摘要卡片、规则详情、模板应用与本地文件保存、行级 diff 预览和对话记录路径）
- `RouteSettingsPage`（导航名 `路由模型`）：mini 会话路由卡片（`RouteSessionSection mini`）与模型映射工作区（`ModelRedirectionTab` leadingPane 布局）单页合并；重定向模型列表行内编辑/图标删除，原始模型列移入编辑弹窗
- `DataOverviewPage`：数据总览页；路由数据子页展示 KPI、趋势、模型热力、通道散点与 Sankey；趋势图在 `24h` / `7d` 视窗内补齐完整小时/日期 X 轴
- `LogsPage`：日志页；路由日志按实际 Agent 动态筛选，首列纯文本展示 Agent，Token 固定两行展示输入/输出与缓存写/读
- `EndpointTestPanel`：接入点侧滑面板的独立测试页，每端点单独选择 Key/模型并显示最近测试时间

### IPC 命名空间

Route 与 DSH 功能分别挂在 `route:*`、`endpoint-test:*`、`config-file-profile:*`、`dsh-integration:*`：

**服务与配置**

- `route:get-config` / `route:save-server-config`
- `route:start-server` / `route:stop-server` / `route:get-runtime-status`
- `route:regenerate-api-key`

**规则与模型**

- `route:list-rules` / `route:upsert-rule` / `route:delete-rule`
- `route:get-model-registry` / `route:rebuild-model-registry` / `route:sync-model-registry-sources` / `route:refresh-model-metadata`
- `route:upsert-model-display-item` / `route:upsert-model-mapping-override` / `route:delete-model-mapping-override`
- `route:save-cli-model-selections` / `route:save-cli-thinking-effort-selections`

**统计与日志**

- `route:get-analytics-overview` / `route:get-analytics-summary` / `route:get-analytics-distribution`
- `route:get-object-stats` / `route:list-stats` / `route:reset-stats` / `route:reset-analytics`
- `route:get-request-logs` / `route:clear-request-logs` / `route:fetch-latest-log`
- `route:getHistoryBuckets` / `route:reset-path-states`

**会话实例与规则**

- `route:list-route-instances` / `route:create-armed-route-instance` / `route:update-route-instance` / `route:archive-route-instance` / `route:restore-route-instance` / `route:close-route-instance` / `route:cancel-armed-route-instance`
- `route:update-session-settings` / `route:update-client-routing` / `route:clear-session-activity`
- `route:list-sessions` / `route:list-session-rules` / `route:upsert-session-rule` / `route:delete-session-rule` / `route:rollback-session-rule` / `route:list-session-candidates`
- `route:upsert-session-override` / `route:delete-session-override`
- `route:preview-profile-state-clear` / `route:clear-profile-state`

**端点测试**

- `endpoint-test:get-state` / `endpoint-test:save-selection` / `endpoint-test:run`

**配置文件卡片**

- `config-file-profile:load` / `config-file-profile:upsert` / `config-file-profile:delete`
- `config-file-profile:target-catalog` / `config-file-profile:preview` / `config-file-profile:preview-direct-edit` / `config-file-profile:commit`
- `config-file-profile:read-files` / `config-file-profile:list-backups` / `config-file-profile:preview-backup-restore`
- `config-file-profile:generate-route-key` / `config-file-profile:preview-route-key-rotation` / `config-file-profile:switch-auth-mode`
- `config-file-profile:restore-builtin` / `config-file-profile:restore-missing-builtins` / `config-file-profile:validate-session-record`

**DSH 接入**

- `dsh-integration:status` / `dsh-integration:model-sources`
- `dsh-integration:enable` / `dsh-integration:rollback` / `dsh-integration:migrate-sessions`

---

## DSH 会话级接入

DSH（DeepSeek Harness）默认走 `llm-pi-ai` 的 `anthropic-messages` 通道，该适配器的 compat gate 会 withhold `sendSessionAffinityHeaders` / `sessionAffinityFormat`，代理侧拿不到会话身份，所有窗口会共用一张路由卡片。**没有零配置退路**：`dsh-llm-pi-ai` 对 gate 表里出现的 compat 字段直接抛错，因此只能把 provider 换成会发送会话头的 `dsh-llm-deepseek-api-key`。

### 模块边界

- `src/main/dsh-integration-service.ts`：唯一直接读写 DSH 文件的模块，导出 `detectDshRouting` / `enableDshSessionRouting` / `rollbackDshSessionRouting` / `migrateDshSessionProviders` / `listDshModelSources`
- `src/main/handlers/dsh-integration-handlers.ts`：`dsh-integration:*` IPC，统一返回 `{ ok, data } | { ok:false, error }`
- `src/renderer/components/Route/DshIntegrationBanner.tsx`：挂在 `RoutePage` 的状态条；DSH 未安装或 IPC 不可用时静默不渲染
- `src/shared/types/dsh-integration.ts`：状态、漂移原因、模型来源与结果类型

### 写入策略

- **不硬编码用户数据**：`baseURL` 取 `getRoutingConfig().server`，API Key 取匹配 `^(dsh|deepseek[\s_-]*harness)$` 的配置方案凭证（否则新建仅凭证方案），模型列表取 `getConfigFileTargetCatalog()` 的对应目标
- **注释保留式改写**：用 `yaml` 的 `parseDocument()` 读写 `cordis.patch.yml`，不做 parse + stringify，保留用户注释与 `!!js` 标签
- **条目 id 必须是 `llm-deepseek`**：patch 层按 id 合并，写错 id 会让 `deepseek-official` 重复注册并导致 settings 命名空间错位
- **保守合并**：`agent-default-model` 仅在缺失或仍为 `local` 时改写；`allowedModels` 仅在整表都是 `local` 时替换；已存在的 route 条目保留用户自定义字段
- **回滚按 id 撤销**：`revertManagedPatchEntries()` / `revertCredentialRef()` 只还原应用写过的三个条目，用户手改内容保留；manifest 丢失时回退到同目录最新的 `.apidetect-*.bak`
- **会话迁移需 DSH 已退出**：改写 `~/.dsh/storages/session_projcache/sessions/*.json` 的 `modelSelection.lastUsed` 与 `subagentModelSelectionPolicy` 两处 provider 引用

### 状态判定

`drift` 是状态机，`ok` 是唯一「无需处理」的取值；其余取值（`dsh-not-installed`、`patch-entry-missing`、`models-out-of-sync`、`no-model-source`、`sessionsOnLegacyProvider` 等）驱动状态条的警告态与操作按钮。`no-model-source` 优先于 `patch-file-missing`，避免没建过 patch 时掩盖真正的病因。

---

## 配置文件与端点测试

### 存储位置

| 数据 | 位置 |
|------|------|
| 接入点上游协议 | `account.routeTargetProtocol` 或直连配置 `routeTargetProtocol` |
| 上游鉴权方式 | `account.routeAuthScheme` 或直连配置 `routeAuthScheme`；未设置时按协议/提供商自动选择 |
| 自定义配置卡片 | `${userData}/config-file-profiles.json` |
| 直连接入点 | `${userData}/custom-cli-configs.json` |
| 会话规则与覆盖 | `config.json` 的 `routing.sessionRouting`（活动记录仅在内存） |
| 路由运行态 / 分析桶 / 模型来源 | `${userData}/state/route-runtime.json`、`route-analytics.json`、`route-model-sources.json` |
| 会话活动 / 会话-通道绑定 / 亲和映射 | `${userData}/state/route-session-activity.json`、`route-session-bindings.json`、`route-state-affinity.json` |
| 端点测试最新状态 | `${userData}/state/route-endpoint-tests.json` |
| DSH 接入清单 | `${userData}/.api-detect-dsh-integration.json`（记录写入哈希与备份基线） |

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
3. 手动端点测试直接使用选定站点 / 账户 / API Key / 模型请求上游，不经过本地 Route Proxy，也不进入普通路由统计。
4. 运行结果分别写入 route runtime、endpoint tests 和 analytics 各自的 sidecar；端点测试只写 endpoint-tests sidecar。
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

从架构视角看，`v3.1.3` 的关键特征是：

- **数据模型更清晰**：站点、账号、稳定路由配置与高频运行态 sidecar 分层明确。
- **工作台能力更完整**：站点管理之外，新增路由代理运维面。
- **端点测试更明确**：协议中立、上游直连、最新结果与时间持久化形成统一诊断链路。
- **UI 与主题体系收敛**：从旧命名和多套实验主题回到统一原语与四套中性主题。
- **恢复能力更强**：配置迁移、坏文件保护和备份恢复成为内建能力。

## 2026-10-24 存储与职责边界更新

当前持久化模型以 [STORAGE_SCHEMA.md](STORAGE_SCHEMA.md) 为准，迁移/备份/错误与回退见 [STORAGE_OPERATIONS.md](STORAGE_OPERATIONS.md)。本文此前 JSON 文件布局描述保留作旧格式和逻辑交换标识说明，不再表示迁移后有多份可独立修改的数据源。

启动顺序：单实例锁 → 显式数据库/schema 校验 → 一次性旧文件适配/原始备份/事务导入 → CLI 中断恢复 → 配置投影与服务组装 → IPC/窗口。运行态和稳定意图分域，事务提交后发布稳定配置；恢复用维护屏障与 generation 失效旧回调。

main/config 管理实体与旧格式/defaults；main/storage 管理 DB/仓储/命令/应用恢复；main/auth 按 authentication/checkin/api-keys/detection 分离操作；main/clients 管理内容合并、模板升级、目标解析与会话解析；browser-runtime 区分槽位/路径和 page-auth。既有 route-request-context/upstream-forwarder/rule-engine/usage 继续复用。

Renderer 的共享契约移至 shared/types；App 初始化/自动刷新交给 useApplicationData/useManagedAutoRefresh；站点与模型重定向用局部控制 Hook，展示不负责持久化拼装；overview 分离纯聚合和两类视图/图表；卡片的模板编辑、预览与 DSH 控件保留独立边界。架构测试检查进程依赖、存储底层依赖和旧全量写入口。

验收与平台限制见 [ARCHITECTURE_REFACTOR_PROGRESS.md](ARCHITECTURE_REFACTOR_PROGRESS.md)。
