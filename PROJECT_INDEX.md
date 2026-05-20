# 项目索引 - API Hub Management Tools

## 项目概览

**API Hub Management Tools** 是一个用于 API 中转站运维的 Electron 桌面应用，当前版本为 **v3.0.1**。

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
| `src/main/main.ts` | Electron 生命周期、窗口创建、预加载绑定 |
| `src/main/app-data-events.ts` | 主进程到渲染进程的数据变更通知桥，按域广播站点配置、站点快照和路由总览更新 |
| `src/main/app-storage-manifest.ts` | 本地存储清单，声明稳定配置、运行态缓存/统计、日志、备份、敏感设置和受保护浏览器状态的路径、owner、retention/cap 与备份边界 |
| `src/main/app-storage-bundle.ts` | 基于本地存储清单创建/恢复 manifest 配置包，限制默认备份范围并兼容旧版 config-only 备份 |
| `src/main/unified-config-manager.ts` | v3 配置加载、迁移、legacy 默认账户自愈修复、缺失 `site_type` 旧站点保持未决、原子写入、备份恢复、路由配置持久化与路径暂停状态恢复，以及兼容保存时清理已删站点的孤儿账户；删除最后一个账户时自动移除站点配置 |
| `src/main/runtime-cache-manager.ts` | 运行期缓存持久化，维护站点共享缓存、账户运行态缓存与 90 天/120 条上限的站点每日快照 |
| `src/main/chrome-manager.ts` | 多槽位检测浏览器池、独立登录浏览器、按 site_type 解析 localStorage / 初始化用户信息，并支持复用账户 Profile 打开签到页 |
| `src/main/site-type-registry.ts` | 站点类型注册表，统一维护各类型的初始化/模型/余额/API Key/分组/定价端点策略 |
| `src/main/site-type-detector.ts` | 智能添加与多账户初始化前的站点类型自动识别 |
| `src/main/token-service.ts` | 登录初始化、按 site_type 选择端点与访问令牌策略、按站点类型驱动签到/浏览器回退、账号数据刷新 |
| `src/main/api-service.ts` | 站点检测、HTTP 请求、模型接口响应格式容错、同日手动签到完成状态保留、旧站点首次检测时自动识别并写回 `site_type`、LDC 支付信息探测，并在检测缓存落盘后触发站点每日快照采集 |
| `src/main/overview-service.ts` | 数据总览聚合服务，负责站点每日快照采集、查询与按日期汇总 |
| `src/main/cli-wrapper-compat-service.ts` | 通过真实 Claude Code / Codex / Gemini CLI wrapper 做兼容性验证；当前 UI 统一通过该服务执行 CLI 可用性测试，使用临时目录隔离本机配置 |
| `src/main/custom-cli-config-service.ts` | 自定义 CLI 配置持久化与模型拉取服务，并为路由模型注册表生成自定义 CLI 虚拟通道标识 |
| `src/main/handlers/*.ts` | `config:*`、`token:*`、`accounts:*`、`route:*`、`overview:*` 等 IPC 通道；自定义 CLI 配置保存后会同步路由模型 registry |
| `src/main/route-*.ts` / `src/main/anyrouter-request-rewriter.ts` / `src/main/cli-protocol-adapter.ts` | 路由代理服务器、规则解析、模型注册表、自定义 CLI 路由来源、CLI 探测、probe-lock 定向测试、健康检查、统计分析；自定义 CLI 已拉取模型列表会过滤旧测试/选择残留；本地路由上游转发使用 Electron net raw 客户端并支持可选上游代理，透明成功 SSE 响应可边收边转发，流式首包等待仍受站点/配置超时约束，首个 SSE chunk 后活跃流空闲超时下限为 10 分钟，AnyRouter 通道对 Claude Code 保留原始工具语义并注入 Anthropic 指纹，对 Codex/Gemini 保持原生协议，其余显式协议适配统一走通用 CLI 协议转换器 |
| `src/main/route-state-manager.ts` | 路由运行态文件管理，将 stats/path state/health、CLI probe、analytics bucket 和模型来源快照拆到有 TTL/max-items 的 `state/*.json`，避免高频状态写入 `config.json` |
| `src/main/backup-manager.ts` / `webdav-manager.ts` | 本地备份与 WebDAV 云端配置包；自动备份 config-only 节流去重，手动/WebDAV 备份使用 manifest 包 |

### 渲染进程

| 模块 | 作用 |
|------|------|
| `src/renderer/App.tsx` | 侧边栏外壳、全局命令栏、页面切换、全局弹窗，并在收到站点配置变更通知后自动同步 configStore；当位于 `数据总览` 或 `日志` 时会根据对应子页状态派生 Header 标题/说明与右侧操作区 |
| `src/renderer/components/AppShell/pageMeta.ts` | 注册一级页面、`数据总览` 子页（站点数据 / 路由数据）以及 `日志` 子页（会话事件 / 路由日志）的导航、标题和简述元数据 |
| `src/renderer/components/Sidebar/VerticalSidebar.tsx` | 左侧导航组件，负责展示一级页面、`数据总览` 子页入口与 `日志` 子页入口 |
| `src/renderer/components/CliConfigStatus/*` | CLI 配置状态组件，展示 Claude Code / Codex / Gemini CLI 配置来源，并将匹配本地路由代理端口的 Base URL 显示为“本地路由”；本地路由、站点管理和自定义 CLI 均显示当前使用模型小字 |
| `src/renderer/pages/DataOverviewPage.tsx` | 数据总览首页，按 `overviewSubtab` 渲染 `SiteOverviewView` 或 `RouteOverviewView`：站点视图展示资源 / 签到 / 历史快照；路由视图三行布局（KPI / 运行趋势 + 模型热力 / 通道散点 + 模型→通道 Sankey），通过路由内容区实际尺寸选择紧凑/常规布局，并用 scope (全部 / 站点 / 自定义 CLI) 控制路由视图范围，用 treemap 的 selectedModel 控制散点高亮；Sankey 独立展示不参与模型联动。KPI 第四张为首字响应 P95 + 会话时间 P99 合并卡。 |
| `src/renderer/pages/SitesPage.tsx` | 站点管理主页面，负责站点/账户卡片、统一 CLI 配置对话框与检测缓存视图透传；打开 CLI 配置时透传 `siteId/accountId` 以便按 canonical probe key 回显最新模型测试结果 |
| `src/renderer/pages/CustomCliPage.tsx` | 自定义 CLI 配置页面；拉取模型后以最新模型列表清理该配置的旧 CLI 使用模型、测试模型与测试结果，并阻止旧本地编辑状态重新写回不属于当前配置的模型 |
| `src/renderer/pages/CreditPage.tsx` | LDC 积分页面，展示 Linux Do Credit 账户信息、收支统计与充值入口 |
| `src/renderer/pages/RoutePage.tsx` | 路由配置/操作页，组合代理服务与模型重定向，并引导用户跳转到数据总览查看统计 |
| `src/renderer/pages/LogsPage.tsx` | 日志页内容容器，按 `logsSubtab` 展示会话事件或路由日志，并压缩展示请求尝试、站点优先级、token 与参考金额明细 |
| `src/renderer/components/Route/*` | 路由页内部区块（模型重定向、CLI 可用性、服务器/统计面板） |
| `src/renderer/services/cli-compat-projection.ts` | 将 `routing.cliProbe.latest` 投影为站点页/账户卡片兼容性结果与 CLI 配置弹窗 per-model 测试 slot，并处理来源标记、站点级回退和最新时间戳合并 |
| `src/renderer/services/sessionEventLog.ts` | 将关键操作写入会话事件历史，供日志页展示 |
| `src/renderer/store/uiStore.ts` | 页面切换、`数据总览` / `日志` 子页切换、侧边栏显示模式、排序、弹窗等 UI 状态 |
| `src/renderer/store/toastStore.ts` | 管理可见 Toast 队列与会话内事件历史 |
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
| `src/shared/types/site.ts` | 站点、账户、检测缓存（含 `has_checkin` / `can_check_in` 拆分）、AnyRouter 站点名归一化识别、站点每日快照、运行期缓存等核心类型 |
| `src/shared/types/route-proxy.ts` | 路由规则、服务器配置（含上游代理）、模型来源、路径暂停状态、CLI 探测、分析统计类型 |
| `src/shared/theme/themePresets.ts` | `Light` / `Dark` 主题预设与旧值归一化 |
| `src/shared/constants/index.ts` | 列宽、默认值等共享常量 |
| `src/shared/utils/customCliRouteId.ts` | 自定义 CLI 路由通道合成 ID（site/account/apiKey）跨进程命名约定 helper |

---

## 当前页面结构

当前 UI 的一级页面由 `src/renderer/components/AppShell/pageMeta.ts` 注册：

- `数据总览`
- `站点管理`
- `自定义 CLI`
- `站点检测`
- `LDC 积分`
- `本地路由`
- `日志`
- `设置`

说明：

- `数据总览` 是新的默认首页，排在第一个入口，承载路由健康、站点余额/消费、历史快照和异常请求。
- 左侧导航会在 `数据总览` 下显示两个子页：`站点数据` 与 `路由数据`；在 `日志` 下显示两个子页：`会话事件` 与 `路由日志`。
- `App.tsx` 会结合 `pageMeta.ts` 与 `uiStore.overviewSubtab` / `uiStore.logsSubtab` 在 Header 中显示当前子页标题和简洁说明；Header 右侧操作由 `DataOverviewPage` 注入，站点子页显示 `刷新`，路由子页显示 `24h / 7d / 刷新`。
- `credit` 已恢复为一级导航页，用于 Linux Do Credit 积分视图。
- 模型重定向不再作为一级导航页，已并入 `本地路由` 总览页。
- `本地路由` 页现在聚焦代理服务、默认模型和模型重定向配置，不再承载主统计面板。

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

1. 渲染进程通过 `route:*` IPC 拉取 `server / rules / modelRegistry / cliProbe / analytics`。
2. 主进程中的 `route-proxy-service`、`route-cli-probe-service`、`route-analytics-service` 等模块负责运行时行为和统计；本地路由上游转发使用 Electron net raw 客户端，必要时读取 `routing.server.upstreamProxyUrl` 走上游代理；流式请求在上游返回成功 `text/event-stream` 且响应适配器透明时会边收边转发，失败响应仍缓冲以保留 fallback；模型注册表会同时聚合站点/账户模型与自定义 CLI 配置模型，并用自定义 CLI 已拉取模型列表隔离旧 Base URL/API Key 残留模型。自定义 CLI 配置保存后会强制同步持久化 registry，避免重启后路由模型选择继续读取旧来源。
3. 配置与统计通过 `UnifiedConfigManager` 写回 `config.routing`。

### 数据总览

1. 渲染进程站点子页通过 `overview:get-site-daily-snapshots` 拉取每日快照并结合 configStore 缓存聚合站点余额/消费榜单。
2. 路由子页通过 `route:get-analytics-summary`、`route:get-analytics-distribution`、`route:get-config` 拉取路由汇总、桶级分布与运行态；前端按 `scope` 在桶级做过滤后驱动「运行趋势」「模型热力 treemap」「通道散点矩阵」「模型 → 通道 Sankey」四块视图。
3. selectedModel 由模型热力 treemap 控制，仅影响散点高亮；Sankey 始终按当前 scope 独立展示模型到通道流向，不参与模型联动。切换 scope 自动重置 selectedModel。
4. `ApiService` 在检测缓存保存成功后触发 `overview-service` 采集当日快照，重启应用后仍可看到站点历史趋势。

### CLI 兼容性测试

1. 渲染进程中的 `useCliCompatTest`、站点页与 CLI 配置对话框统一调用 `cli-compat:test-with-wrapper`。
2. 主进程由 `cli-wrapper-compat-service.ts` 在隔离的临时 `HOME` / `CODEX_HOME` 中拉起真实 CLI；Codex 与 Gemini 的测试 prompt 统一改走 `stdin`，Gemini 仅依赖隔离 `HOME/.gemini` 而不再覆写 `GEMINI_CLI_HOME`，并显式关闭 Gemini 自身 sandbox relaunch、附带 `--skip-trust` 以避免 `stdin` 被改写成 `--prompt` 或被 trusted workspace 检查拦截。
3. 站点管理兼容性测试与 CLI 可用性探测统一落到 `config.routing.cliProbe`：主进程保存 `history/latest`，并按站点下全部活跃账户分别探测；站点页手动测试以及统一 CLI 配置抽屉里的“测试已选模型”在保存成功后，渲染进程都会通过 `cli-compat-sync.ts` 重新加载配置、重投影对应账户卡片，并强制刷新一次 route CLI history 视图缓存；可用性页固定展示 7 天 history，条形图按 `probeRunId` 批次聚合同一次检测的多个模型，批次颜色按全成功/全失败/混合结果区分；站点检测页 Header 右侧提供定时探测开关、小时制间隔自动保存与立即探测。
4. 由于真实测试不写入用户 CLI 配置目录，因此正常情况下无需备份或恢复测试前的本机 CLI 配置。

---

## 近期结构变化（v3.0.1 相对 v2.1.24）

- 新增 `src/main/cli-wrapper-compat-service.ts`
- 新增 `src/main/custom-cli-config-service.ts`
- 新增 `src/__tests__/cli-wrapper-compat-service.test.ts`
- 新增 `src/__tests__/useCliCompatTest.test.ts`
- 新增 `src/__tests__/route-proxy-service.test.ts`
- 新增 `src/__tests__/route-rule-engine.test.ts`
- 新增 `src/main/route-analytics-service.ts`
- 新增 `src/main/route-channel-resolver.ts`
- 新增 `src/main/route-cli-probe-service.ts`
- 新增 `src/main/route-health-service.ts`
- 新增 `src/main/route-model-registry-service.ts`
- 新增 `src/main/route-proxy-service.ts`
- 新增 `src/main/route-probe-lock.ts`
- 新增 `src/main/cli-protocol-adapter.ts`
- 新增 `src/main/route-rule-engine.ts`
- 新增 `src/main/route-stats-service.ts`
- 新增 `src/main/handlers/route-handlers.ts`
- 新增 `src/main/overview-service.ts`
- 新增 `src/main/handlers/overview-handlers.ts`
- 新增 `src/renderer/services/cli-compat-projection.ts`
- 新增 `src/renderer/store/routeStore.ts`
- 新增 `src/renderer/components/Route/`
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

**版本**：3.0.1
**更新日期**：2026-04-28
**维护者**：API Hub Team
