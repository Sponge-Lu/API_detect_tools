# brainstorm: 日志页显示路由日志

## Goal

让现有日志页能够看到请求级路由日志，支持排查每次代理请求的选路结果，而不只是显示路由页的操作摘要。

## What I already know

* 现有日志页是 [src/renderer/pages/LogsPage.tsx](/D:/2_Github_Repository/API_detect_tools/src/renderer/pages/LogsPage.tsx:73)，数据完全来自 `toastStore.eventHistory`。
* `eventHistory` 只保存 renderer 会话事件，不读取主进程日志文件，也不读取 route analytics / route proxy 的逐条请求数据。
* `routeStore` 已经通过 `sessionEventLog` 写入很多 `source: 'route'` 的操作摘要，例如启动/停止代理、保存规则、同步来源、执行健康检查、CLI 探测等。
* 因此，“路由操作摘要”其实已经会出现在日志页，只是当前没有单独的“路由”筛选/分区。
* 真正的“代理请求级路由日志”当前没有现成 UI 数据源：
  * `src/main/route-analytics-service.ts` 只有按小时聚合的 bucket 统计与 summary/distribution 查询；
  * `src/main/utils/logger.ts` 会把主进程日志写入 `userData/logs/main.log`，但 LogsPage 没有读取它；
  * `route-proxy-service.ts` 也没有为每次代理请求维护结构化的逐条日志列表。
* 当前请求链路里可以直接拿到或较稳定推导出这些字段：
  * 请求 CLI、canonical model、原始请求 model、路由到的站点、账户、API key、最终发给上游的原始模型、状态码、耗时、时间；
  * 用户分组/API key 分组在 canonical 通道解析链路中有来源数据，但当前 `ResolvedChannel` 没有显式携带，若走 generic channel 或站点级 key，分组可能只能记为 `unknown`。

## Assumptions (temporary)

* 用户要的是请求级 route log，不是会话事件摘要。
* 日志页仍然是统一入口，但要新增“路由请求日志”数据区或视图。
* 请求级 route log 应优先采用“结构化日志 + IPC + LogsPage 展示”，而不是直接解析 `main.log` 文本文件。

## Open Questions

* 当前无阻塞性开放问题。
* 2026-05-22 追加：路由请求日志可读性改进已收敛到 B-1 终版方案；本轮进入实现阶段，规则见下方 Requirements 与 Technical Notes。

## Requirements (evolving)

* 日志页需要显示请求级 route log，而不是只有 route 操作摘要。
* 日志页采用页面内双视图切换：`会话事件` / `路由请求日志`。
* 每条 route log 至少记录：
  * 请求 CLI
  * 请求模型 / canonical model
  * 路由到的站点
  * 路由到的账户
  * 路由到的用户分组
  * 路由到的 API key
  * 最终使用的原始模型
  * 状态码
  * 耗时
  * 时间
* 日志页需要能区分“会话事件”与“路由请求日志”两类数据。
* 请求级 route log 需要有清晰的数据来源、保留范围、筛选维度和性能边界。
* 路由请求日志只保留当前运行会话，应用重启后清空。
* 若某次请求无法可靠解析用户分组或分组来源，需要允许字段为空或显示 `unknown`，不能伪造。
* 2026-05-22 终版 B-1：现有请求尝试列表保留紧凑行，不引入父子折叠时间线；改造仅作用于第二、三行的视觉结构。
* 2026-05-22 终版 B-1：第二、三行合并到同一个 4 列 CSS Grid 容器，列模板 `grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_9rem] gap-x-3 gap-y-0.5`（列 2 与列 3 等宽）；列 1 段标 / 列 4 文案上下严格对齐。
* 2026-05-22 终版 B-1：列 1 行首段标固定为中文双字（`路由` / `用量`），样式 `tracking-wider text-[var(--text-tertiary)] font-medium`，字号继承自容器 `text-xs`，与第 2/3 行所有内容保持同号；不再引入新的 lucide / emoji 图标作为锚点。
* 2026-05-22 终版 B-1：列 2 内容形态——第二行 `{requestedModel} → {canonicalModel}`（同名也保留 `→`，表示路由规则确实命中）；第三行 `Token {total}（输入 {prompt}，输出 {completion}）`，数字使用 `tabular-nums`。
* 2026-05-22 终版 B-1：列 3 内容形态——第二行普通站点显示 `{站点} / {账户} / {分组} / {API Key}` 路径文本；自定义 CLI 仅显示规范化后的站点名（如 `DuckCoding`），不再渲染 `账户=无 / 分组=无 / API Key=默认` 占位项；第三行有缓存时显示 `缓存 创建 {n} · 命中 {m}`，仅其中之一非零时仅显示对应分项，全无显示 `无缓存`。
* 2026-05-22 终版 B-1：列 3 文本末尾紧跟一个 `RouteLogInfoIcon`（`shrink-0`，使用 lucide `AlertCircle`），hover/focus 显示说明 tooltip：普通站点 = `依次为：站点 / 账户 / 分组 / API Key（此次请求最终命中的来源链路）`，自定义 CLI = `自定义 CLI 来源（账户 / 分组 / API Key 不适用）`。
* 2026-05-22 终版 B-1：列 2、列 3 的所有可变长字段必须 `truncate`（`min-w-0 + truncate`），并在原 DOM 节点上挂 `title` 属性显示完整值；不允许换行撑高行高。
* 2026-05-22 终版 B-1：列 4 固定宽度 `9rem`，左对齐，第 2/3 行均使用纯文本（不再使用 chip / pill 样式）——第二行渲染 `优先级 {N}`（"优先级"与数值之间保留 1 个空格，去掉旧的"站点"前缀，保留 0-based 数值与 `无` 兜底）；第三行渲染 `预计金额 {≈¥...}` 后紧跟 `RouteLogInfoIcon`（lucide `AlertCircle`，沿用原费用公式 tooltip 文案）。
* 2026-05-22 终版 B-1：失败信息仍保留在第一行尾部，不下沉到独立行；耗时 · 时间也保留在第一行右上角。

## Acceptance Criteria (evolving)

* [ ] 日志页可以直接看到请求级路由日志。
* [ ] 用户能区分“会话事件”与“路由代理请求”两类数据。
* [ ] 日志页可在 `会话事件` 与 `路由请求日志` 两个视图之间切换。
* [ ] 单条 route log 可展示请求 CLI、模型、站点、账户、用户分组/API key、原始模型、状态码、耗时、时间。
* [ ] 所选方案的数据来源与刷新行为清晰可验证。
* [ ] 当前运行会话内产生的 route log 可见，应用重启后不保留历史。
* [ ] 2026-05-22 终版 B-1：第二、三行合并到同一个 4 列 grid 容器，列 2/3 等宽，列 1 段标与列 4 文案左边缘上下对齐。
* [ ] 2026-05-22 终版 B-1：列 4 不使用 chip / pill / 背景色，第二行纯文本 `优先级 N`（含空格），第三行纯文本 `预计金额 ≈¥...` + 信息图标；第 2/3 行字号统一为 `text-xs`（含列 1 段标）。
* [ ] 2026-05-22 终版 B-1：站点路径末尾出现 `RouteLogInfoIcon`（AlertCircle），hover 显示对应 tooltip；自定义 CLI 显示折叠后的站点名 + 专用 tooltip 文案。
* [ ] 2026-05-22 终版 B-1：第 2/3 列文本超长 `truncate` 且 `title` 显示完整值，不出现换行；同名模型仍保留 `→`。

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 先不做日志导出、全文搜索、跨会话云同步。
* 先不改变 route analytics 现有统计面板的展示逻辑。
* 先不承诺对历史已有代理请求做回填。

## Research Notes

### Current state in repo

* `LogsPage`：只读 `toastStore.eventHistory`，是“当前会话事件页”，不是主进程日志查看器。
* `sessionEventLog`：可快速扩展 source/category，但只能记录 renderer 主动写入的摘要事件。
* `route analytics`：已有聚合统计，但不是逐条请求日志，无法直接还原一条条 route request。
* `electron-log/main.log`：可读，但当前格式面向诊断，不适合作为结构化 UI 数据源。

### Feasible approaches here

**Approach A: 在现有日志页强化 route 会话事件** (Minimal)

* How it works:
  * 继续使用 `toastStore.eventHistory`
  * 给 LogsPage 增加 `source=route` 的筛选/分组/统计
* Pros:
  * 改动最小
  * 不需要新的 main/renderer IPC
  * 与现有日志页定位一致
* Cons:
  * 只能看到“操作摘要”，看不到每次代理请求
  * 无法排查某一条真实 route 转发失败

**Approach B: 新增结构化 route request log 数据源** (Chosen direction)

* How it works:
  * main 进程在 route proxy 成功/失败后写入结构化请求日志
  * 通过新的 IPC 提供给 renderer
  * LogsPage 增加“路由请求日志”视图或第二数据区
* Pros:
  * 真正满足“路由日志”语义
  * 可按 CLI / 模型 / 站点 / 状态筛选
  * 后续可扩展导出、保留策略、问题排查
* Cons:
  * 需要改 main + preload + renderer
  * 要决定内存保留/落盘策略

**Approach C: 读取并解析 `main.log` 中的 route 相关行**

* How it works:
  * renderer 通过 IPC 读取主进程日志文件
  * 前端按 `[Route...]` 前缀过滤显示
* Pros:
  * 复用现有文件日志
* Cons:
  * 当前 route 逐条请求日志并不完整
  * 文本解析脆弱
  * 不适合做稳定的筛选/排序/结构化展示

## Technical Notes

* LogsPage: [src/renderer/pages/LogsPage.tsx](/D:/2_Github_Repository/API_detect_tools/src/renderer/pages/LogsPage.tsx:73)
* Event store: [src/renderer/store/toastStore.ts](/D:/2_Github_Repository/API_detect_tools/src/renderer/store/toastStore.ts:18)
* Session event helper: [src/renderer/services/sessionEventLog.ts](/D:/2_Github_Repository/API_detect_tools/src/renderer/services/sessionEventLog.ts:21)
* Route store action logging: [src/renderer/store/routeStore.ts](/D:/2_Github_Repository/API_detect_tools/src/renderer/store/routeStore.ts:133)
* Route analytics aggregation only: [src/main/route-analytics-service.ts](/D:/2_Github_Repository/API_detect_tools/src/main/route-analytics-service.ts:74)
* Route IPC currently exposes analytics summary/distribution but not request log list: [src/main/handlers/route-handlers.ts](/D:/2_Github_Repository/API_detect_tools/src/main/handlers/route-handlers.ts:302)
* Main file logger path is available, but LogsPage does not consume it: [src/main/utils/logger.ts](/D:/2_Github_Repository/API_detect_tools/src/main/utils/logger.ts:18)
* Current route channel data already knows:
  * `siteId/accountId/apiKeyId/resolvedModel`: [src/main/route-channel-resolver.ts](/D:/2_Github_Repository/API_detect_tools/src/main/route-channel-resolver.ts:388)
  * source-level `availableUserGroups/apiKeyGroups/availableApiKeys`: [src/shared/types/route-proxy.ts](/D:/2_Github_Repository/API_detect_tools/src/shared/types/route-proxy.ts:136), [src/main/route-model-registry-service.ts](/D:/2_Github_Repository/API_detect_tools/src/main/route-model-registry-service.ts:616)
* Current limitation:
  * `ResolvedChannel` does not carry `userGroup` explicitly; if needed in logs, this must be attached during channel resolution or reconstructed before persisting.
  * `route analytics` stores bucket aggregates only, not append-only request records.
* 2026-05-22 B-1 实现要点：
  * 在 `src/renderer/pages/LogsPage.tsx` 中删除原有 `route-request-target-line` / `route-request-token-line` 两个独立 div，新增一个 `data-testid="route-request-detail-grid"` 的 4 列 grid 容器，两行作为 grid 的子元素，共享列模板。
  * 抽取通用组件 `RouteLogInfoIcon`（沿用原 `RouteLogCostFormulaIcon` 的 portal/定位逻辑），图标统一使用 lucide `AlertCircle`；原 `RouteLogCostFormulaIcon` 已重命名替换。
  * 原 `RouteLogInlineField` 已完全删除（连同 `ReactNode` 类型 import 一起清理）；列 4 的"优先级"与"预计金额"改为 `<span>` 纯文本（tertiary 标签 + primary 数值），与第 2/3 行其余文本保持同号同色规则。
  * 原 `route-request-site-priority` 测试 hook 的 chip 文案从 `站点顺位 N` 改为 `优先级 N`；保留 `data-testid="route-request-site-priority"` 以便测试断言切换到新文案。
  * `isCustomCliLog` 分支控制列 3 渲染（自定义 CLI 走简化路径 + 不同 tooltip 文案）；`formatRouteLogCachePath` 等小工具函数可在文件内提取，避免 JSX 内嵌长三元。
  * `src/__tests__/logs-page.test.tsx` 必须同步更新：旧断言（`请求模型gpt-5.4`、`站点站点 A`、`API KeyKey Alpha`、`站点顺位 N`、`缓存创建20` 等）替换为新的路径文本（`gpt-5.4 → gpt-5.4`、`站点 A / 主账户 / vip / Key Alpha`、`优先级 N`、`缓存 创建 20 · 命中 40` 等）；金额公式 tooltip 与新的"站点路径说明" tooltip 都需断言。

## Decision (ADR-lite)

**Context**: LogsPage currently only shows renderer-side session events, but the requested feature needs per-request route-level diagnostics.

**Decision**: Use a new structured route request log data source in main process, expose it via IPC, and render it in LogsPage as a distinct route log view/section.
LogsPage uses an in-page two-view switch instead of mixing the two datasets.

**Consequences**:

* Requires main + preload + renderer updates.
* We can show detailed request-level fields reliably.
* Retention scope is now fixed to current runtime session only, which keeps implementation lightweight.
* LogsPage presentation is now fixed to a two-view switch, which keeps both datasets clear and avoids mixed-card complexity.

## Technical Approach

* Main process:
  * Add an in-memory route request log buffer dedicated to the current runtime session.
  * Append one structured record per proxied request after channel selection / upstream completion.
  * Record request metadata and resolved routing metadata in a shape purpose-built for UI display.
  * Expose IPC methods to list and clear runtime route request logs.
* Shared contract:
  * Add typed route request log record/query types under `src/shared/types/route-proxy.ts`.
* Preload / renderer bridge:
  * Expose `route:get-request-logs` and `route:clear-request-logs`.
* Renderer:
  * Extend LogsPage from a single event-history view into two views:
    * `会话事件`
    * `路由请求日志`
  * Keep existing event view behavior unchanged.
  * Add request-log list rendering optimized for dense structured records.
  * Add only lightweight MVP controls as needed for readability; do not expand to a full observability console.

## Implementation Plan (small PRs)

* PR1: shared types + main-process runtime route request log store + append/list/clear IPC
* PR2: preload bridge + LogsPage two-view switch + route request log list UI
* PR3: focused tests for main log capture, IPC wiring, and LogsPage view switching/rendering
