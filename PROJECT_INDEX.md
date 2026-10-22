# 项目索引 - API Hub Management Tools

## 项目概览

**API Hub Management Tools** 是一个用于 API 中转站运维的 Electron 桌面应用，当前版本为 **v3.1.3**。

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
| `src/main/request-rectifier.ts` | 按明确上游错误修复 thinking 签名、思考配置和 opaque 状态，供路由执行单次重试 |
| `src/main/config-file-backups.ts` | CLI 配置集中备份、首次原件与最近十份保留、历史迁移、备份列表及恢复读取 |
| `src/main/model-metadata-service.ts` | models.dev 元数据解析与缓存、启动后台刷新及手动刷新入口 |
| `src/main/main.ts` | Electron 生命周期、窗口创建、预加载绑定；显式开发 URL 加载热更新页面，其余模式加载构建页面，并接入渲染健康监控 |
| `src/main/window-health-manager.ts` | 统一开发、预览与打包页面加载；监听主框架加载、preload、渲染进程退出和无响应事件，执行有界恢复与错误页重试 |
| `src/main/app-data-events.ts` | 主进程到渲染进程的数据变更通知桥，按域广播站点配置、站点快照和路由总览更新；广播会跳过已销毁窗口/webContents 并吞掉 Electron disposed-frame 竞态错误 |
| `src/main/app-storage-manifest.ts` | 本地存储清单，声明稳定配置、运行态缓存/统计、日志、备份、敏感设置和受保护浏览器状态的路径、owner、retention/cap 与备份边界；支持 lightweight/full-manifest/portable-config 模式 |
| `src/main/app-storage-bundle.ts` | 基于本地存储清单创建/恢复配置包；可迁移 portable 包仅含 config.json + custom-cli-configs.json，兼容旧 full-manifest 与 config-only 备份 |
| `src/main/unified-config-manager.ts` | v3 配置加载、迁移、legacy 默认账户、seeded 路由示例与旧 OpenCode 路由协议字段清理、缺失 `site_type` 旧站点保持未决、读取失败短重试、原子写入、备份恢复、账户级 `cli_config` 更新、路由配置持久化与路径暂停状态恢复，以及兼容保存时清理已删站点的孤儿账户；删除最后一个账户时自动移除站点配置；CLI probe latest/history 可一次性写入 sidecar |
| `src/main/runtime-cache-manager.ts` | 运行期缓存持久化，维护站点共享缓存、账户运行态缓存与 90 天/120 条上限的站点每日快照 |
| `src/main/chrome-manager.ts` | 多槽位检测浏览器池、独立登录浏览器、按目标域动态选择登录页面；兼容 legacy localStorage/Cookie 与 New API refresh AuthBundle，并仅用短期 Bearer 初始化长期 PAT；提供 Cookie/UA 投影后的 Electron Session 通用 GET/POST 请求、页面级登录态重读和账户 Profile 签到页复用 |
| `src/main/browser-runtime/bundled-resolver.ts` | 解析打包内置 Chromium（`<resources>/chromium/<os>-<arch>/`，`extraResources` 的 `${os}-${arch}` 宏命名），校验可执行文件与 `VERSION` 标记；缺失返回 null，由 chrome-manager 继续本机浏览器降级链；产物由 `npm run fetch:chromium` 落地 |
| `src/main/site-type-registry.ts` | 站点类型注册表，统一维护各类型的初始化/模型/余额/API Key/分组/定价端点策略 |
| `src/main/site-type-detector.ts` | 智能添加与多账户初始化前的站点类型自动识别 |
| `src/main/token-service.ts` | 登录初始化、按 site_type 选择端点与访问令牌策略，新版 New API 短期 session Bearer 仅用于创建长期 PAT；Sub2API 可从浏览器登录态重读并校验 JWT，显式 `site_type` 可覆盖 URL 反查；支持按账户浏览器槽位重新读取基础账号信息并在 access token 无效时重建；统一识别认证失败 envelope；NewAPI 脱敏 API Key 优先通过 `/api/token/batch/keys` 批量补全明文 key |
| `src/main/api-service.ts` | 站点检测、HTTP 请求、Bot/Cloudflare 挑战后的主进程浏览器会话回退、模型接口响应格式容错、NewAPI/Sub2API 认证失败 envelope 识别、API Key 分组异常归集、同日手动签到完成状态保留、旧站点首次检测时自动识别并写回 `site_type`，并在检测缓存落盘后触发站点每日快照采集 |
| `src/main/overview-service.ts` | 数据总览聚合服务，负责站点每日快照采集、查询与按日期汇总 |
| `src/main/upstream-credential-resolver.ts` | 中性解析托管/直连真实上游 Base URL、API Key 与鉴权方案，不启动路由、选择通道或写入路由运行态 |
| `src/main/api-key-identity.ts` | 生成稳定 API Key 标识，供路由、端点测试与配置服务共享 |
| `src/main/endpoint-test-state-service.ts` | 独立维护端点测试 sidecar 选择与最新结果，不参与 Route runtime / stats / analytics |
| `src/main/custom-cli-config-service.ts` | 直连接入点持久化与旧四 CLI 上游协议迁移，并为模型注册表生成虚拟通道标识 |
| `src/main/config-file-profile-service.ts` | v3 配置方案、可用目标与模型域、单卡片 revision、结构化合并/覆盖、真实文件事务及增量对话记录扫描 |
| `src/main/dsh-integration-service.ts` | DSH 会话级路由接入：状态检测、从路由运行时派生 baseURL/密钥/模型目录、注释保留式 cordis.patch.yml 合并、备份回滚、存量会话 provider 迁移 |
| `src/main/route-session-service.ts` | 管理 RouteInstance 身份、DSH 原生及兼容会话标识、父子谱系、ARMED 绑定与生命周期；钉住卡片禁止归档，身份合并保留保护状态 |
| `src/main/route-session-activity-service.ts` | 将 RouteInstance 高频 `lastRequestAt` 从稳定配置拆到有界、合并、原子写 sidecar，支持启动 hydrate 与退出 flush |
| `src/main/custom-cli-model-service.ts` | 直连配置模型获取服务，通过配置 `modelUrl`（为空时回退 `baseUrl`）拼接 `/v1/models` 拉取模型列表并写回 `CustomCliConfig.models` |
| `src/main/handlers/*.ts` | 按域注册 IPC：`sites:*` / `accounts:*` / `storage:*` / `token:*` / `route:*` / `config-file-profile:*` / `endpoint-test:*` / `dsh-integration:*` / `overview:*` / `detection:*` / `cli-compat:*` / `custom-cli-config:*` / `anyrouter:*` / `close-behavior:*` / `backup:*` / `webdav:*` / `update:*` / `theme:*` / `browser-profile:*`，另有 `load-config` / `save-config` / `open-url` / `fetch-with-cookies` 等扁平通道；配置文件 I/O 和会话规则管理仅由主进程执行 |
| `src/main/route-*.ts` / `src/main/anyrouter-request-rewriter.ts` / `src/main/cli-protocol-adapter.ts` | 按入站 pathname 接收 Messages、Chat Completions 与 Responses 的通用本地网关，在请求体解析后关联运行时会话身份，并执行模型映射、会话覆盖、故障转移和必要的双向协议转换；上游失败按类别记账（仅请求侧致命记 `neutral`，不改变转移行为），凭证/模型/配额确证不可用时按阶梯时长首次即禁用该路径，全通道失败吸收为可重试 503；隐藏提供模型发现、CORS 预检、根探测和精确 Token 计数契约 |
| `src/main/protocol-sse-transformer.ts` | 独立的跨协议增量 SSE 状态机，负责六个有向协议转换的分片解析、事件生命周期、工具/usage/error/terminal 透传 |
| `src/main/streaming-protocol-validator.ts` | 三标准协议的有界增量 SSE 校验器，按实际下游字节验证帧、生命周期、输出、usage 与工具参数，不重建完整响应体 |
| `src/main/endpoint-test-service.ts` | 通过中性凭证层直连上游执行 Messages、Responses 与 Chat Completions 非流式生成测试，不依赖任何路由模块，并保存每个接入目标/端点的最新选择、结果与测试时间 |
| `src/main/route-history-service.ts` | 站点管理 History 列时间桶聚合服务，按实际请求端点分别聚合 48h / 2h 成功率轨道，并规范化 Messages、Responses 与 Chat Completions 路径 |
| `src/main/route-upstream-forwarder.ts` | 单次上游尝试的传输层：上游 URL / 请求头构造、增量流校验与协议转换、原生 Anthropic 流延迟提交窗口与截断降级、SSE 错误补发 |
| `src/main/route-request-context.ts` | 单个下游请求的生命周期状态：客户端取消传播、尝试计数、请求日志上下文与终结错误码诊断 |
| `src/main/route-usage.ts` | 上游响应体 / SSE 用量与思考强度解析（纯函数），供代理与日志共用 |
| `src/main/route-proxy-shared.ts` | 路由代理模块间共享的路径与协议推断小工具 |
| `src/main/route-upstream-failure.ts` | 上游失败分类（请求侧 / 通道侧 / 瞬时 / 配额耗尽）、确证不可用原因解析、`Retry-After` 解析与响应体摘要归一化 |
| `src/main/route-rule-engine.ts` | 路由规则匹配与命中解释，规则选路与单次请求改写抽为独立函数 |
| `src/main/route-session-binding-service.ts` | 会话-通道绑定 sidecar，让并发会话各自粘在不同上游通道；通道级绑定使换模型仍保住 prompt cache 亲和性 |
| `src/main/route-state-affinity-service.ts` | Stateful Responses 本地亲和映射、非敏感 profile 分类摘要，以及按 profile / site / account / API Key 的实体清理 |
| `src/main/route-state-manager.ts` | 路由运行态文件管理，只维护 `route-runtime.json`、`route-analytics.json` 与模型来源快照；端点测试状态由独立 sidecar 管理，避免高频状态写入 `config.json` |
| `src/main/local-api-key-service.ts` | Access Token 无效时仍可独立管理本地 API Key，并按 Key 刷新 / 保留模型快照 |
| `src/main/config-field-crypto.ts` | 配置字段 AES-256-GCM 加解密，在磁盘 I/O 边界透明处理 `api_key` / `access_token` / `apiKey` 等敏感字段 |
| `src/main/anyrouter-hash-extractor.ts` | AnyRouter 页面哈希指纹提取，配合请求改写器完成上游校验 |
| `src/main/backup-manager.ts` / `webdav-manager.ts` | 本地备份与 WebDAV 云端配置包；自动备份 config-only 节流去重，手动/WebDAV/导出使用 plaintext portable 2 文件包；恢复后 reconcile 隔离 Profile slot |

### 渲染进程

| 模块 | 作用 |
|------|------|
| `src/renderer/App.tsx` | 侧边栏外壳与页面切换，懒加载 6 个一级页面（数据总览 / 站点管理 / 本地路由 / 路由模型 / 路由日志 / 设置） |
| `src/renderer/components/AppErrorBoundary.tsx` | React 根错误边界，防止未捕获渲染异常留下白屏，并提供可见的重新加载操作 |
| `src/renderer/components/AppShell/pageMeta.ts` | 注册一级页面元数据（`overview` / `sites` / `route` / `config-files` / `logs` / `settings`）与 `数据总览` 两个子页 |
| `src/renderer/components/Sidebar/VerticalSidebar.tsx` | 左侧导航组件，负责展示一级页面与 `数据总览` 子页入口 |
| `src/renderer/components/LoadingState.tsx` / `ErrorState.tsx` / `AppSwitch.tsx` / `AppSelect.tsx` / `PageContainer.tsx` | 统一加载/错误/开关/下拉/页面容器原语；配合 `App*`/`DataTable` 收敛全 App 三态与同类控件视觉 |
| `src/renderer/pages/DataOverviewPage.tsx` | 数据总览首页，按 `overviewSubtab` 渲染 `SiteOverviewView` 或 `RouteOverviewView`：站点视图展示资源 / 签到 / 历史快照；路由视图三行布局（KPI / 运行趋势 + 模型热力 / 通道散点 + 模型→通道 Sankey），通过路由内容区实际尺寸选择紧凑/常规布局，并用 scope (全部 / 站点 / 自定义 CLI) 控制路由视图范围；运行趋势在 `24h` / `7d` 视窗内补齐完整小时/日期 X 轴，前置空桶只显示标签不绘制柱/线，并提供左侧请求量（0–max）与右侧成功率（0–100%）双纵轴及对齐的 0/50/100 参考线；用 treemap 的 selectedModel 控制散点高亮；Sankey 独立展示不参与模型联动。KPI 第四张为首字响应 P95 + 会话时间 P99 合并卡。 |
| `src/renderer/pages/SitesPage.tsx` | 站点管理主页面；站点与直连配置名称统一调用系统浏览器并保留完整 URL；接入点侧滑面板提供信息、资源和原生端点测试，不再承载 CLI 配置 |
| `src/renderer/pages/RoutePage.tsx` | 本地路由页：服务器区块 + DSH 接入状态条 + 配置文件卡片区 |
| `src/renderer/pages/RouteSettingsPage.tsx` | 路由模型页（`config-files`）：左列按独立客户端分组的双模式路由卡片（240-280px），分组头切换客户端级/会话级、独立折叠并记住状态，两类卡片均支持模型、思考强度和钉住保护；右侧为模型映射工作区 |
| `src/renderer/pages/LogsPage.tsx` | 路由日志主页面，通过逐条 push 追加；按日志中的 Agent 动态筛选并以 Logo + 名称展示首列，Token 固定两行展示输入/输出与缓存写/读 |
| `src/renderer/components/AgentLogo.tsx` | 统一识别并展示主流 Agent/harness 产品 Logo，未知产品使用灰色占位图标 |
| `src/renderer/components/HistoryCell.tsx` / `src/renderer/components/Route/Usability/HistoryBucketBars.tsx` / `src/renderer/components/SiteListHeader/SiteListHeader.tsx` | 站点管理 History 列 UI：表头按实际请求端点切换单条 24 个 2h 时间桶轨道，数据来自 `route:getHistoryBuckets` IPC 并按成功率渐变着色，条形图右侧内联汇总 48h 请求数与加权成功率 |
| `src/renderer/components/dialogs/AddAccessPointDialog.tsx` / `AccessPointDetailPanel.tsx` / `AccessPointResourcePrimitives.tsx` / `EndpointTestPanel.tsx` / `SiteSettingsDialog.tsx` | 统一添加接入点、接入点详情、托管/直连 Tab1 信息表单、Tab2 资源布局与 Tab3 端点测试共享紧凑视觉规格、三协议端点测试与站点刷新设置；端点测试独立选择 API Key/模型并显示最近测试时间 |
| `src/renderer/components/Route/*` | 路由页内部区块（`DshIntegrationBanner` 接入状态条、`ConfigProfilesSection` 配置卡片、`RouteSessionSection` 双模式会话卡片、`ProxyStats/` 服务器与 CLI 模型区块、`Redirection/` 模型映射、`Usability/` History 条形图） |
| `src/renderer/services/sessionEventLog.ts` | 将关键操作写入当前会话事件历史，供站点页操作记录弹窗展示 |
| `src/renderer/store/uiStore.ts` | 页面切换、`数据总览` 子页切换、侧边栏显示模式、排序、弹窗等 UI 状态 |
| `src/renderer/store/toastStore.ts` | 管理可见 Toast 队列与当前会话内事件历史 |
| `src/renderer/store/routeStore.ts` | Route 工作台的数据抓取、运行状态与路径暂停恢复动作；启停同步缓存启用状态，失败回读运行状态并隔离过期状态响应 |
| `src/renderer/hooks/useAutoRefresh.ts` | 站点级/账号级自动刷新调度 |
| `src/renderer/hooks/useCheckIn.ts` | 批量签到目标按保存的站点/账户配置生成，检测结果缓存用于签到状态过滤 |
| `src/renderer/utils/siteOverview.ts` | 将站点/账户最新缓存聚合为首页资源指标 |
| `src/renderer/utils/modelPricing.ts` | 统一解析模型按 token / 按次计费方式与价格，供路由日志和模型重定向复用 |
| `src/renderer/utils/routeRulePresentation.ts` | 将路由规则转换为可解释的摘要、命中原因与标签 |
| `src/renderer/utils/routeSessionOrdinal.ts` | 为父 RouteInstance 分配稳定主编号，并以持久化 childOrdinal 生成异模型子卡 `#N.M` 编号；客户端+编号哈希取色的会话色板（sessionColorForSession） |
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
| `src/shared/types/site.ts` | 站点、账户、浏览器 Profile 选择与绑定、账户级 CLI 配置、检测缓存（含 `has_checkin` / `can_check_in` 拆分）、站点刷新异常、API Key 活跃状态归一化、AnyRouter 站点名归一化识别、站点每日快照、运行期缓存等核心类型 |
| `src/shared/types/endpoint-test.ts` | 独立手动上游端点测试目标、协议、选择状态与结果类型 |
| `src/shared/types/route-proxy.ts` | 通用网关、Responses 状态亲和摘要、模型来源、路径状态、含父实例/副编号/客户端模型的会话路由与分析统计类型；兼容 re-export 端点测试类型 |
| `src/shared/config/builtin-client-configs.ts` | Claude Code、Codex、OpenCode、Grok Build 完整配置的共享唯一来源 |
| `src/shared/types/config-file-profile.ts` | 版本化配置方案、含协议元数据的目标目录、应用模式、文件事务和对话记录诊断类型 |
| `src/shared/types/dsh-integration.ts` | DSH 接入状态、漂移原因、请求/结果类型与 DSH 侧常量（条目 id `llm-deepseek`、provider id `deepseek-official`、凭据引用名） |
| `src/shared/types/cli-config.ts` / `custom-cli-config.ts` / `config-detection.ts` | CLI 配置模型与内置模板类型；直连接入点配置与模型；本地 CLI 配置静态检测结果 |
| `src/shared/theme/themePresets.ts` | `Light` / `Dark` / `Modern` / `Modern Dark` 主题预设与旧值归一化 |
| `src/shared/constants/index.ts` | 列宽、默认值等共享常量 |
| `src/shared/utils/apiConfig.ts` | 站点密钥来源、认证方式与 API 地址的共享解析 |
| `src/shared/utils/customCliRouteId.ts` / `groupLabel.ts` | 自定义 CLI 真实多 Key 路由通道合成 ID helper；数字分组前缀到圆圈数字标签的共享规范化 |
| `src/shared/utils/modelPricing.ts` / `url-matcher.ts` / `headers.ts` / `log-filter.ts` | 模型计费解析；URL 匹配；协议 Header 处理；日志筛选的跨进程共享实现 |
| `src/shared/utils/date.ts` | 本地时区"同一天"判断 `isSameLocalDay()`，"今日已签/今日已刷新"类判断的跨进程单一收敛点 |

---

## 当前页面结构

当前 UI 的一级页面由 `src/renderer/components/AppShell/pageMeta.ts` 注册：

- `数据总览`
- `站点管理`
- `本地路由`
- `路由模型`
- `路由日志`
- `设置`

说明：

- `数据总览` 是默认首页，排在第一个入口，承载路由健康、站点余额/消费、历史快照和异常请求。
- 左侧导航会在 `数据总览` 下显示两个子页：`站点数据` 与 `路由数据`；`路由日志` 是单一主入口，直接显示路由日志。
- `App.tsx` 会结合 `pageMeta.ts` 与 `uiStore.overviewSubtab` 在 Header 中显示当前标题和简洁说明；Header 右侧操作由 `DataOverviewPage` 注入，站点子页显示 `刷新`，路由子页显示 `24h / 7d / 刷新`。
- `本地路由`（`route`）承载网关与配置文件卡片区；`路由模型`（`config-files`，组件为 `RouteSettingsPage`）单页合并 mini 会话路由卡片与模型映射工作区，原 `model-mapping` 一级页面已下线（旧持久化 id 映射到 `config-files`）。
- `TabId` 全集为 `overview | sites | route | config-files | logs | settings`，其中 `route` 与 `config-files` 同属 `ROUTE_TAB_IDS`。
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

1. 渲染进程通过 `route:*` IPC 拉取 `server / rules / modelRegistry / analytics`，通过 `endpoint-test:*` IPC 读写手动端点测试状态，通过 `dsh-integration:*` IPC 检测并应用 DSH 会话级接入。
2. 主进程由 `route-proxy-service`、`endpoint-test-service`、`route-analytics-service` 与 `route-history-service` 负责运行时行为。代理监听按请求顺序串行启停，启动失败清理监听实例。端点测试通过中性 `upstream-credential-resolver` 获取真实目标后直接请求上游；不导入路由通道/代理/target-lock 模块，不发送 CLI marker/User-Agent/originator，也不写入路由统计与 History。
3. 配置与统计通过 `UnifiedConfigManager` 写回 `config.routing`。

### DSH 会话级接入

1. 渲染进程 `RoutePage` 顶部的 `DshIntegrationBanner` 调用 `dsh-integration:status` 获取接入状态、漂移原因、可用模型来源与仍钉在旧 provider 的会话数。
2. `dsh-integration-service` 从路由运行时派生 `baseURL`、API Key 与模型目录（不硬编码），用 `yaml` 的 `parseDocument()` 对 `~/.dsh/profiles/<profile>/cordis.patch.yml` 做注释保留式合并，并把凭据引用写入 `~/.dsh/.credentials.yaml`。
3. `dsh-integration:enable` 只写配置（DSH 运行时跳过会话迁移）；`dsh-integration:migrate-sessions` 在 DSH 已退出时改写存量会话的 `modelSelection.lastUsed` 与 `subagentModelSelectionPolicy`。
4. `dsh-integration:rollback` 按条目 id 撤销写入（保留用户手改内容），必要时回退到同目录最新的 `.apidetect-*.bak`；`writtenHashes` 清单记录在 `.api-detect-dsh-integration.json`。

### 数据总览

1. 渲染进程站点子页通过 `overview:get-site-daily-snapshots` 拉取每日快照并结合 configStore 缓存聚合站点余额/消费榜单。
2. 路由子页通过 `route:get-analytics-overview`、`route:get-analytics-summary`、`route:get-analytics-distribution`、`route:get-config` 拉取路由汇总、桶级分布与运行态；前端按 `scope` 在桶级做过滤后驱动「运行趋势」「模型热力 treemap」「通道散点矩阵」「模型 → 通道 Sankey」四块视图，其中运行趋势会为 `24h` 固定生成 24 个小时点、为 `7d` 固定生成 7 个日期点，并将缺失桶归零。
3. selectedModel 由模型热力 treemap 控制，仅影响散点高亮；Sankey 始终按当前 scope 独立展示模型到通道流向，不参与模型联动。切换 scope 自动重置 selectedModel。
4. `ApiService` 在检测缓存保存成功后触发 `overview-service` 采集当日快照，重启应用后仍可看到站点历史趋势。

### 端点测试

1. 接入点侧滑面板的“测试”页独立展示 Messages、Responses 与 Chat Completions。
2. 每个端点独立选择 API Key 与模型；托管目标默认按 API Key 用户分组过滤并可列出站点全部模型，直连目标列出已获取和手工模型并集；CLI 配置中的使用模型只用于生成/应用 CLI 配置。
3. 三协议统一发送“1.2和1.19哪个更大？”。最新选择、结果和 `testedAt` 保存在 `state/route-endpoint-tests.json`；成功、HTTP 失败、解析失败与超时都显示最近测试时间，失败正文只保留简短原因。

---

## 近期结构变化

### v3.1.3

- **DSH 会话级接入**：新增 `src/main/dsh-integration-service.ts`、`src/main/handlers/dsh-integration-handlers.ts`、`src/shared/types/dsh-integration.ts`、`src/renderer/components/Route/DshIntegrationBanner.tsx` 与 `dsh-integration-service.test.ts` / `dsh-integration-banner.test.tsx`；`RoutePage` 在服务器区块与配置卡片区之间挂载接入状态条
- **路由代理拆分**：`route-proxy-service.ts` 拆出 `route-upstream-forwarder.ts`（单次上游传输）、`route-request-context.ts`（请求生命周期）、`route-usage.ts`（用量解析）、`route-proxy-shared.ts`；新增 `route-upstream-failure.ts` 失败分类与 `route-upstream-forwarder.socket.test.ts` 真实 socket 集成测试
- **会话与状态 sidecar**：新增 `route-session-binding-service.ts`（会话-通道绑定）与 `route-state-affinity-service.ts`（Stateful Responses 亲和映射）
- **熔断模型**：`route-stats-service.ts` 改为三态熔断（2/10/30 分钟阶梯打开 → 半开单探测 → 成功闭合）并新增站点级熔断；移除 `route-health-service.ts` 及 `route:get-health` / `route:run-health-check` IPC
- **热路径写入**：路径状态改为内存写入 + 延迟落盘，分析桶落盘间隔 5s → 30s，`state/` 下状态文件改为紧凑 JSON
- **终结响应**：全部路径挂起从 400 改为 503 + `Retry-After`，终结分支错误码写入主日志 `Route request completed`
- 客户端 Logo 补齐 `kimi` / `kwaipilot`，`AgentLogo` 别名表同步

### v3.1.2

- 中性上游凭证解析 `upstream-credential-resolver.ts` 与稳定 Key 标识 `api-key-identity.ts`
- 端点测试状态独立到 `endpoint-test-state-service.ts`（`state/route-endpoint-tests.json`）
- 会话色板 `sessionColorForSession()`（`src/renderer/utils/routeSessionOrdinal.ts`）
- Linux Do Credit（LDC）积分子系统整体移除：删除 `credit-service.ts`、`credit-handlers.ts`、`types/credit.ts`、`CreditPage`、`CreditPanel/`、`useCredit` / `useLdcSites`、站点检测中的 LDC 支付探测与站点列表 LDC 列；`credit:*` IPC、`LDC_UI_VISIBILITY`、`LDC_PAYMENT_NAMES` 一并清理，旧持久化 `'credit'` 标签页回退到站点管理

### v3.1.1

- 会话父子谱系与 `#N` / `#N.M` 编号、上游失败分类与阶梯禁用、会话-通道绑定侧车、直连多 Key 表单、本地 API Key 管理、分组标签圆圈数字规范化
- 页面架构拆分：原 `配置文件` 页并入 `本地路由`，新增一级页承载会话路由卡片区（当前导航名为 `路由模型`，`TabId` 为 `config-files`）

### v3.0.5 相对 v2.1.24

- 新增 `src/main/endpoint-test-service.ts`、`src/main/upstream-credential-resolver.ts`、`src/main/api-key-identity.ts`、`src/main/route-target-lock.ts`
- 新增 `src/main/custom-cli-config-service.ts`
- 新增 `src/main/custom-cli-model-service.ts`
- 新增 `src/main/route-history-service.ts`
- 新增 `src/__tests__/endpoint-test-service.test.ts`、`src/__tests__/upstream-credential-resolver.test.ts`、`src/__tests__/endpoint-test-panel.test.tsx`
- 新增 `src/__tests__/route-proxy-service.test.ts`
- 新增 `src/__tests__/route-rule-engine.test.ts`
- 新增 `src/main/route-analytics-service.ts`
- 新增 `src/main/route-channel-resolver.ts`
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
- 新增 `src/renderer/components/dialogs/AccessPointResourcePrimitives.tsx`
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
- [DSH 会话级接入设计](docs/DSH_SESSION_ROUTING_INTEGRATION.md)
- [客户端会话身份审计](docs/CLIENT_SESSION_IDENTITY_AUDIT.md)
- [CLI 请求结构调研](docs/CLI_request.md)
- [更新日志](CHANGELOG.md)

---

## 索引维护

站点配置共用 `src/shared/utils/apiConfig.ts` 处理密钥来源、认证方式和 API 地址；开发与打包统一使用 Electron 网络栈及固定版本的内置 Chromium。`scripts/dev-main.cjs` 和 `scripts/before-pack.cjs` 共用浏览器准备逻辑；`npm run preview` 加载构建页面，`npm run verify:packaged` 校验打包代码、前端资源、运行依赖与浏览器版本，并在原生架构执行浏览器页面检查。
本地密钥并发与持久化回归覆盖位于 `src/__tests__/local-api-key-service.test.ts`。

索引体系分为三层：

1. `PROJECT_INDEX.md`：项目级索引。
2. `FOLDER_INDEX.md`：目录级索引。
3. 文件头注释：记录模块输入、输出和定位。

当新增、删除或重构模块时，需同步更新相关索引文件。

---

**版本**：3.1.3
**更新日期**：2026-10-22
**维护者**：API Hub Team
