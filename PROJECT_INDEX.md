# 项目索引 - API Hub Management Tools

## 项目概览

**API Hub Management Tools** 是一个用于 API 中转站运维的 Electron 桌面应用，当前版本为 **v3.0.5**。

**技术栈**

- 前端：React 18 + TypeScript + Tailwind CSS + Vite
- 桌面壳层：Electron 28
- 状态管理：Zustand
- 自动化：Puppeteer Core
- 校验：Zod
- 测试：Vitest + React Testing Library + fast-check

---

## 目录结构

```text
.
├── src/
│   ├── main/                 # Electron 主进程、IPC、浏览器自动化、路由代理服务
│   ├── renderer/             # React UI、页面、组件、hooks、stores
│   ├── shared/               # 前后端共享类型、常量、theme、schema
│   └── __tests__/            # Vitest 测试与属性测试
├── docs/                     # 用户、开发、架构、参考资料与内部计划/设计文档
├── scripts/                  # 开发与构建辅助脚本
├── build/                    # 打包图标与资源
├── dist/                     # 主进程构建输出
├── dist-renderer/            # 渲染进程构建输出
└── release/                  # 打包产物
```

---

## 关键模块

### 主进程

| 模块 | 作用 |
|------|------|
| `src/main/main.ts` | Electron 生命周期、窗口创建、预加载绑定，并接入渲染健康监控 |
| `src/main/window-health-manager.ts` | 监听主框架加载、preload、渲染进程退出和无响应事件；持久化故障信息，执行一次有界自动恢复，并在持续失败时显示内置重试页 |
| `src/main/app-data-events.ts` | 主进程到渲染进程的数据变更通知桥，按域广播站点配置、站点快照和路由总览更新；广播会跳过已销毁窗口/webContents 并吞掉 Electron disposed-frame 竞态错误 |
| `src/main/app-storage-manifest.ts` | 本地存储清单，声明稳定配置、运行态缓存/统计、日志、备份、敏感设置和受保护浏览器状态的路径、owner、retention/cap 与备份边界；支持 lightweight/full-manifest/portable-config 模式 |
| `src/main/app-storage-bundle.ts` | 基于本地存储清单创建/恢复配置包；可迁移 portable 包仅含 config.json + custom-cli-configs.json，兼容旧 full-manifest 与 config-only 备份 |
| `src/main/unified-config-manager.ts` | v3 配置加载、迁移、legacy 默认账户、seeded 路由示例与旧 OpenCode 路由协议字段清理、缺失 `site_type` 旧站点保持未决、读取失败短重试、原子写入、备份恢复、账户级 `cli_config` 更新、路由配置持久化与路径暂停状态恢复，以及兼容保存时清理已删站点的孤儿账户；删除最后一个账户时自动移除站点配置；CLI probe latest/history 可一次性写入 sidecar |
| `src/main/runtime-cache-manager.ts` | 运行期缓存持久化，维护站点共享缓存、账户运行态缓存与 90 天/120 条上限的站点每日快照 |
| `src/main/chrome-manager.ts` | 多槽位检测浏览器池、独立登录浏览器、按目标域动态选择登录页面；兼容 legacy localStorage/Cookie 与 New API refresh AuthBundle，并仅用短期 Bearer 初始化长期 PAT；提供 Cookie/UA 投影后的 Electron Session 通用 GET/POST 请求、页面级登录态重读和账户 Profile 签到页复用 |
| `src/main/site-type-registry.ts` | 站点类型注册表，统一维护各类型的初始化/模型/余额/API Key/分组/定价端点策略 |
| `src/main/site-type-detector.ts` | 智能添加与多账户初始化前的站点类型自动识别 |
| `src/main/token-service.ts` | 登录初始化、按 site_type 选择端点与访问令牌策略，新版 New API 短期 session Bearer 仅用于创建长期 PAT；Sub2API 可从浏览器登录态重读并校验 JWT，显式 `site_type` 可覆盖 URL 反查；支持按账户浏览器槽位重新读取基础账号信息并在 access token 无效时重建；统一识别认证失败 envelope；NewAPI 脱敏 API Key 优先通过 `/api/token/batch/keys` 批量补全明文 key |
| `src/main/api-service.ts` | 站点检测、HTTP 请求、Bot/Cloudflare 挑战后的主进程浏览器会话回退、模型接口响应格式容错、NewAPI/Sub2API 认证失败 envelope 识别、同日手动签到完成状态保留、旧站点首次检测时自动识别并写回 `site_type`、LDC 支付信息探测，并在检测缓存落盘后触发站点每日快照采集 |
| `src/main/overview-service.ts` | 数据总览聚合服务，负责站点每日快照采集、查询与按日期汇总 |
| `src/main/custom-cli-config-service.ts` | 直连接入点持久化与旧四 CLI 上游协议迁移，并为模型注册表生成虚拟通道标识 |
| `src/main/config-file-profile-service.ts` | v3 配置方案、可用目标与模型域、单卡片 revision、结构化合并/覆盖、真实文件事务及增量对话记录扫描 |
| `src/main/route-session-service.ts` | 以 `agentId + runtimeSlotId + sessionId` 管理 RouteInstance，归一化完整内部键、Codex 原生窗口/会话元数据与 Claude Code 会话头，负责 ARMED 原子绑定、槽位 Session 切换、配置优先级和展示别名 |
| `src/main/route-session-activity-service.ts` | 将 RouteInstance 高频 `lastRequestAt` 从稳定配置拆到有界、合并、原子写 sidecar，支持启动 hydrate 与退出 flush |
| `src/main/custom-cli-model-service.ts` | 直连配置模型获取服务，通过配置 `baseUrl + /v1/models` 拉取模型列表并写回 `CustomCliConfig.models` |
| `src/main/handlers/*.ts` | `config:*`、`token:*`、`accounts:*`、`route:*`、`config-file-profile:*` 等 IPC；配置文件 I/O 和会话规则管理仅由主进程执行 |
| `src/main/route-*.ts` / `src/main/anyrouter-request-rewriter.ts` / `src/main/cli-protocol-adapter.ts` | 按入站 pathname 接收 Messages、Chat Completions 与 Responses 的通用本地网关，在请求体解析后关联运行时会话身份，并执行模型映射、会话覆盖、故障转移和必要的双向协议转换；隐藏提供模型发现、CORS 预检、根探测和精确 Token 计数契约 |
| `src/main/protocol-sse-transformer.ts` | 独立的跨协议增量 SSE 状态机，负责六个有向协议转换的分片解析、事件生命周期、工具/usage/error/terminal 透传 |
| `src/main/streaming-protocol-validator.ts` | 三标准协议的有界增量 SSE 校验器，按实际下游字节验证帧、生命周期、输出、usage 与工具参数，不重建完整响应体 |
| `src/main/endpoint-test-service.ts` | 手动执行 Messages、Responses 与 Chat Completions 非流式生成测试，保存每个接入目标/端点的最新选择、结果与测试时间 |
| `src/main/route-history-service.ts` | 站点管理 History 列时间桶聚合服务，按实际请求端点分别聚合 48h / 2h 成功率轨道，并规范化 Messages、Responses 与 Chat Completions 路径 |
| `src/main/route-state-manager.ts` | 路由运行态文件管理，将 stats/path state/health、CLI probe、analytics bucket 和模型来源快照拆到有 TTL/max-items 的 `state/*.json`，避免高频状态写入 `config.json` |
| `src/main/backup-manager.ts` / `webdav-manager.ts` | 本地备份与 WebDAV 云端配置包；自动备份 config-only 节流去重，手动/WebDAV/导出使用 plaintext portable 2 文件包；恢复后 reconcile 隔离 Profile slot |

### 渲染进程

| 模块 | 作用 |
|------|------|
| `src/renderer/App.tsx` | 侧边栏外壳与页面切换，注册并行的本地路由、模型映射、配置文件页面 |
| `src/renderer/components/AppErrorBoundary.tsx` | React 根错误边界，防止未捕获渲染异常留下白屏，并提供可见的重新加载操作 |
| `src/renderer/components/AppShell/pageMeta.ts` | 注册一级页面元数据，包含并行的本地路由、模型映射、配置文件和路由日志入口 |
| `src/renderer/components/Sidebar/VerticalSidebar.tsx` | 左侧导航组件，负责展示一级页面与 `数据总览` 子页入口 |
| `src/renderer/components/LoadingState.tsx` / `ErrorState.tsx` / `AppSwitch.tsx` / `AppSelect.tsx` / `PageContainer.tsx` | 统一加载/错误/开关/下拉/页面容器原语；配合 `App*`/`DataTable` 收敛全 App 三态与同类控件视觉 |
| `src/renderer/components/CreditPanel/DailyStatsCard.tsx` / `formatLastUpdated.ts` | 统一每日收支统计卡片（`variant: income/expense`，`Income/ExpenseStatsCard` 为其薄封装）与共享"更新于"时间格式化 |
| `src/renderer/pages/DataOverviewPage.tsx` | 数据总览首页，按 `overviewSubtab` 渲染 `SiteOverviewView` 或 `RouteOverviewView`：站点视图展示资源 / 签到 / 历史快照；路由视图三行布局（KPI / 运行趋势 + 模型热力 / 通道散点 + 模型→通道 Sankey），通过路由内容区实际尺寸选择紧凑/常规布局，并用 scope (全部 / 站点 / 自定义 CLI) 控制路由视图范围；运行趋势在 `24h` / `7d` 视窗内补齐完整小时/日期 X 轴，前置空桶只显示标签不绘制柱/线，并提供左侧请求量（0–max）与右侧成功率（0–100%）双纵轴及对齐的 0/50/100 参考线；用 treemap 的 selectedModel 控制散点高亮；Sankey 独立展示不参与模型联动。KPI 第四张为首字响应 P95 + 会话时间 P99 合并卡。 |
| `src/renderer/pages/SitesPage.tsx` | 站点管理主页面；接入点侧滑面板提供信息、资源和原生端点测试，不再承载 CLI 配置 |
| `src/renderer/pages/CreditPage.tsx` | LDC 积分页面，展示 Linux Do Credit 账户信息、收支统计与充值入口 |
| `src/renderer/pages/RoutePage.tsx` | 本地网关启停、鉴权、CORS、统计和会话级模型/思考强度路由 |
| `src/renderer/pages/ModelMappingPage.tsx` | 模型重定向、原始模型来源、站点/API Key 候选与优先级编辑 |
| `src/renderer/pages/ConfigFilesPage.tsx` | 任意客户端/CLI/SDK 的摘要卡片（可整卡点击编辑）与详情弹窗、模板应用与本地文件保存、行级 diff 预览和对话记录路径 |
| `src/renderer/pages/LogsPage.tsx` | 路由日志主页面，通过逐条 push 追加；按日志中的 Agent 动态筛选并以 Logo + 名称展示首列，Token 固定两行展示输入/输出与缓存写/读 |
| `src/renderer/components/AgentLogo.tsx` | 统一识别并展示主流 Agent/harness 产品 Logo，未知产品使用灰色占位图标 |
| `src/renderer/components/HistoryCell.tsx` / `src/renderer/components/Route/Usability/HistoryBucketBars.tsx` / `src/renderer/components/SiteListHeader/SiteListHeader.tsx` | 站点管理 History 列 UI：表头按实际请求端点切换单条 24 个 2h 时间桶轨道，数据来自 `route:getHistoryBuckets` IPC 并按成功率渐变着色 |
| `src/renderer/components/dialogs/AddAccessPointDialog.tsx` / `AccessPointDetailPanel.tsx` / `EndpointTestPanel.tsx` / `SiteSettingsDialog.tsx` | 统一添加接入点、接入点详情、三协议端点测试与站点刷新设置；端点测试独立选择 API Key/模型并显示最近测试时间 |
| `src/renderer/components/Route/*` | 路由页内部区块（会话路由、模型重定向、服务器/统计面板，以及站点管理 History 条形图复用组件） |
| `src/renderer/services/sessionEventLog.ts` | 将关键操作写入当前会话事件历史，供站点页操作记录弹窗展示 |
| `src/renderer/store/uiStore.ts` | 页面切换、`数据总览` 子页切换、侧边栏显示模式、排序、弹窗等 UI 状态 |
| `src/renderer/store/toastStore.ts` | 管理可见 Toast 队列与当前会话内事件历史 |
| `src/renderer/store/routeStore.ts` | Route 工作台的数据抓取、运行状态与路径暂停恢复动作 |
| `src/renderer/hooks/useAutoRefresh.ts` | 站点级/账号级自动刷新调度 |
| `src/renderer/utils/siteOverview.ts` | 将站点/账户最新缓存聚合为首页资源指标 |
| `src/renderer/utils/modelPricing.ts` | 统一解析模型按 token / 按次计费方式与价格，供路由日志和模型重定向复用 |
| `src/renderer/utils/routeRulePresentation.ts` | 将路由规则转换为可解释的摘要、命中原因与标签 |
| `src/renderer/utils/routeLatency.ts` | 从 latencyHistogram 桶估算 P90/P99 延迟分位数，样本 <20 时返回 null；命名导出桶解析与百分位算法供 routeTtfb 复用 |
| `src/renderer/utils/routeLogAxis.ts` | 散点矩阵首字响应 X 轴 0-120s 分段 value↔pixel 映射 + 默认刻度 (1s/3s/5s/10s/30s/60s/120s) |
| `src/renderer/utils/routeModelDistribution.ts` | 按 canonicalModel 聚合 RouteAnalyticsBucket 生成模型热力分布项（含成功率），并提供 squarified treemap 布局 |
| `src/renderer/utils/routeSankey.ts` | 路由数据子页模型 → site/account/apiKey 通道二部图聚合（Top-N + 「其他」合并 + link 成功率三档） |
| `src/renderer/utils/routeScatter.ts` | 通道散点点位聚合（成功率三档 / 首字响应 / 请求量）+ Top-N 引线候选 + greedy 防重叠布局 |
| `src/renderer/utils/routeScopeFilter.ts` | 路由数据子页 scope (全部 / 站点 / 自定义 CLI) 过滤 RouteAnalyticsBucket 与作用域比较 |
| `src/renderer/utils/routeTtfb.ts` | 首字时间 P50/P95/P99 分位数（基于 firstByteHistogram，复用 routeLatency 桶解析） |

### 共享层

| 模块 | 作用 |
|------|------|
| `src/shared/types/site.ts` | 站点、账户、浏览器 Profile 选择与绑定、账户级 CLI 配置、检测缓存（含 `has_checkin` / `can_check_in` 拆分）、API Key 活跃状态归一化、AnyRouter 站点名归一化识别、站点每日快照、运行期缓存等核心类型 |
| `src/shared/types/route-proxy.ts` | 通用网关、Responses 状态亲和摘要、模型来源、路径状态、会话路由、端点测试与分析统计类型 |
| `src/shared/config/builtin-client-configs.ts` | Claude Code、Codex、OpenCode、Grok Build 完整配置的共享唯一来源 |
| `src/shared/types/config-file-profile.ts` | 版本化配置方案、含协议元数据的目标目录、应用模式、文件事务和对话记录诊断类型 |
| `src/shared/theme/themePresets.ts` | `Light` / `Dark` 主题预设与旧值归一化 |
| `src/shared/constants/index.ts` | 列宽、默认值等共享常量 |
| `src/shared/utils/customCliRouteId.ts` | 自定义 CLI 路由通道合成 ID（site/account/apiKey）跨进程命名约定 helper |

---

## 当前页面结构

当前 UI 的一级页面由 `src/renderer/components/AppShell/pageMeta.ts` 注册：

- `数据总览`
- `站点管理`
- `LDC 积分`
- `本地路由`
- `模型映射`
- `配置文件`
- `路由日志`
- `设置`

说明：

- `数据总览` 是新的默认首页，排在第一个入口，承载路由健康、站点余额/消费、历史快照和异常请求。
- 左侧导航会在 `数据总览` 下显示两个子页：`站点数据` 与 `路由数据`；`路由日志` 是单一主入口，直接显示路由日志。
- `App.tsx` 会结合 `pageMeta.ts` 与 `uiStore.overviewSubtab` 在 Header 中显示当前标题和简洁说明；Header 右侧操作由 `DataOverviewPage` 注入，站点子页显示 `刷新`，路由子页显示 `24h / 7d / 刷新`。
- `credit` 已恢复为一级导航页，用于 Linux Do Credit 积分视图。
- `本地路由` 只承载网关与会话路由；模型映射和配置文件分别使用独立一级页面。
- 直连配置作为站点管理中的接入点展示；侧滑测试页始终原生探测三个协议，顶部上游协议选择仅保存真实路由策略。

---

## 核心数据流

### 配置加载

1. `main.ts` 启动应用并创建窗口。
2. `UnifiedConfigManager.loadConfig()` 读取 `config.json`。
3. 若遇到旧配置，则执行 `v2 -> v3` 迁移；若发现已升级配置仍残留站点级认证且缺少账户记录，则自动补建“默认账户”并持久化；若旧站点缺失 `site_type`，加载阶段保持未决而不是默认写成 `newapi`；若遇到损坏配置，则保留坏文件并尝试从最近备份恢复。
4. `preload.ts` 暴露 IPC API，渲染进程在 `App.tsx` 初始化阶段拉取配置与缓存。

### 站点检测

1. 渲染进程触发 `detectSite / detectAllSites`。
2. 主进程通过 `ApiService + TokenService + ChromeManager` 获取站点状态；旧站点若缺失 `site_type`，会在首次自动检测入口补做判型并写回配置。
3. 检测结果写回配置缓存，并由 `detectionStore` / 页面组件更新 UI。

### 自动刷新

1. `useAutoRefresh` 基于站点与账户配置生成刷新目标集合。
2. 当存在账户配置时，优先按账户粒度调度。
3. 检测成功后回写缓存；失败时通过 toast / 错误回调反馈。

### Route 工作台

1. 渲染进程通过 `route:*` IPC 拉取 `server / rules / modelRegistry / analytics`，通过 `endpoint-test:*` IPC 读写手动端点测试状态。
2. 主进程由 `route-proxy-service`、`endpoint-test-service`、`route-analytics-service` 与 `route-history-service` 负责运行时行为。端点测试通过 loopback 路由的 target lock 精确选择目标，不发送 CLI marker/User-Agent/originator，也不写入路由统计与 History。
3. 配置与统计通过 `UnifiedConfigManager` 写回 `config.routing`。

### 数据总览

1. 渲染进程站点子页通过 `overview:get-site-daily-snapshots` 拉取每日快照并结合 configStore 缓存聚合站点余额/消费榜单。
2. 路由子页通过 `route:get-analytics-summary`、`route:get-analytics-distribution`、`route:get-config` 拉取路由汇总、桶级分布与运行态；前端按 `scope` 在桶级做过滤后驱动「运行趋势」「模型热力 treemap」「通道散点矩阵」「模型 → 通道 Sankey」四块视图，其中运行趋势会为 `24h` 固定生成 24 个小时点、为 `7d` 固定生成 7 个日期点，并将缺失桶归零。
3. selectedModel 由模型热力 treemap 控制，仅影响散点高亮；Sankey 始终按当前 scope 独立展示模型到通道流向，不参与模型联动。切换 scope 自动重置 selectedModel。
4. `ApiService` 在检测缓存保存成功后触发 `overview-service` 采集当日快照，重启应用后仍可看到站点历史趋势。

### 端点测试

1. 接入点侧滑面板的“测试”页独立展示 Messages、Responses 与 Chat Completions。
2. 每个端点独立选择 API Key 与模型；托管目标默认按 API Key 用户分组过滤并可列出站点全部模型，直连目标列出已获取和手工模型并集；CLI 配置中的使用模型只用于生成/应用 CLI 配置。
3. 三协议统一发送“1.2和1.19哪个更大？”。最新选择、结果和 `testedAt` 保存在 `state/route-endpoint-tests.json`；成功、HTTP 失败、解析失败与超时都显示最近测试时间，失败正文只保留简短原因。

---

## 近期结构变化（v3.0.5 相对 v2.1.24）

- 新增 `src/main/endpoint-test-service.ts`、`src/main/route-target-lock.ts`
- 新增 `src/main/custom-cli-config-service.ts`
- 新增 `src/main/custom-cli-model-service.ts`
- 新增 `src/main/route-history-service.ts`
- 新增 `src/__tests__/endpoint-test-service.test.ts`、`src/__tests__/endpoint-test-panel.test.tsx`
- 新增 `src/__tests__/route-proxy-service.test.ts`
- 新增 `src/__tests__/route-rule-engine.test.ts`
- 新增 `src/main/route-analytics-service.ts`
- 新增 `src/main/route-channel-resolver.ts`
- 新增 `src/main/route-health-service.ts`
- 新增 `src/main/route-model-registry-service.ts`
- 新增 `src/main/route-proxy-service.ts`
- 新增 `src/main/cli-protocol-adapter.ts`
- 新增 `src/main/route-rule-engine.ts`
- 新增 `src/main/route-stats-service.ts`
- 新增 `src/main/handlers/route-handlers.ts`
- 新增 `src/main/overview-service.ts`
- 新增 `src/main/handlers/overview-handlers.ts`
- 新增 `src/renderer/store/routeStore.ts`
- 新增 `src/renderer/components/Route/`
- 新增 `src/renderer/components/HistoryCell.tsx`
- 新增 `src/renderer/components/dialogs/AddAccessPointDialog.tsx`
- 新增 `src/renderer/components/dialogs/AccessPointDetailPanel.tsx`
- 新增 `src/renderer/components/dialogs/ManagedCliConfigEditorContent.tsx`
- 新增 `src/renderer/components/dialogs/DirectCliConfigEditorContent.tsx`
- 新增 `src/renderer/components/dialogs/PanelSection.tsx`
- 新增 `src/renderer/components/dialogs/EndpointTestPanel.tsx`
- 新增 `src/renderer/components/dialogs/OperationRecordDialog.tsx`
- 新增 `src/renderer/components/Sidebar/`
- 新增 `src/renderer/components/AppCard/`、`AppIcon/`、`AppInput/`、`AppModal/`
- 新增 `src/renderer/pages/DataOverviewPage.tsx`
- 新增 `src/renderer/utils/siteOverview.ts`
- 新增 `src/renderer/utils/modelPricing.ts`
- 新增 `src/renderer/utils/routeRulePresentation.ts`
- 新增 `src/__tests__/data-overview-page.test.tsx`
- 新增 `src/__tests__/unified-cli-config-dialog.test.tsx`
- 新增 `src/__tests__/credit-service.test.ts`
- 新增 `src/__tests__/useCredit.test.ts`
- 新增 `scripts/dev-cleanup.cjs`、`scripts/dev-main.cjs`、`scripts/dev.cjs`、`scripts/run-node-module.cjs`、`scripts/repair-legacy-accounts.cjs`，并保留 `scripts/migrate-config-v224-to-v301.cjs` 用于将 v2.1.24 配置拆分为 clean config、runtime-cache 与 route state 文件
- 旧版 iOS 命名原语目录已全部退出主线设计系统
- `ApiKeyInfo` 新增 `status_str / state / enabled` 兼容字段，并通过 `getApiKeyAvailability()` / `isApiKeyActive()` 统一判断 API Key 是否可用
- 路由日志从紧凑网格调整为无卡片的带表头单行表格，统一展示 CLI 图标、原始模型、路由目标、Token（总/输入/输出/缓存写/缓存读）、参考金额、用时/首字、纯数字状态码与失败第二行
- 日志页取消会话事件子页，`路由日志` 主入口直接显示路由日志；站点管理页头新增 `操作记录` 弹窗入口，显示非路由请求的应用关键操作记录
- 路由数据运行趋势图补齐 `24h` / `7d` 完整时间轴；首个真实桶之前的空点只显示 X 轴标签，后续缺失桶保持现有零值绘制语义
- v3.0.5 进一步加固透明 SSE 流式转发，校验首包、终止事件和 Claude Code 消息结构，避免 malformed / incomplete stream 被误判成功
- v3.0.5 将自定义 CLI 配置纳入 CLI 可用性视图和立即探测，并通过虚拟站点/账户/API Key 标识携带自定义上游凭据
- v3.0.5 支持重置模型重定向的当前优先命中路径，并用 `routePathStates` 持久化/恢复成功路径 affinity
- v3.0.5 为 NewAPI 脱敏 API Key 增加 `/api/token/batch/keys` 批量明文补全，并在站点卡片提供单个 API Key 状态刷新
- v3.0.5 前端 UI 一致性与可访问性收口：新增 `--text-on-accent` 与 z-index 阶梯 token（toast > modal > drawer > dropdown > sticky）；新增 `LoadingState`/`ErrorState`/`AppSwitch`/`AppSelect`/`PageContainer` 原语并收敛全 App 三态、开关、下拉与导航激活态；`Income/ExpenseStatsCard` 合并为 `DailyStatsCard(variant)`，提取共享 `formatLastUpdated`；移除未使用的 `SiteGroupTabs/` 死代码目录

---

## 文档导航

- [用户指南](docs/USER_GUIDE.md)
- [开发指南](docs/DEVELOPMENT.md)
- [架构文档](docs/ARCHITECTURE.md)
- [API 参考](docs/API_REFERENCE.md)
- [站点检测参考](docs/METAPI_SITE_DETECTION_REFERENCE.md)
- [CLI 请求结构调研](docs/CLI_request.md)
- [更新日志](CHANGELOG.md)

---

## 索引维护

索引体系分为三层：

1. `PROJECT_INDEX.md`：项目级索引。
2. `FOLDER_INDEX.md`：目录级索引。
3. 文件头注释：记录模块输入、输出和定位。

当新增、删除或重构模块时，需同步更新相关索引文件。

---

**版本**：3.0.5
**更新日期**：2026-06-17
**维护者**：API Hub Team
