# Findings: Route Data Page Redundancy — Phase 2 研究总结

PRD: `.trellis/tasks/05-15-route-data-page-redundancy/prd.md`

## 研究产物索引

| 文件 | 覆盖问题 |
|---|---|
| `01-route-analytics-data-flow.md` | Q1 数据流可空性 / Q3 scope 过滤可行性 / Q10 disabled vs UI 健康分桶 |
| `02-custom-cli-integration.md` | Q2 自定义 CLI 数据模型 + 端到端 ID 链路 |
| `03-svg-primitive-audit.md` | Q4 现有图元复用 / Q5 TTFB / 延迟原语 |
| `04-scatter-and-sankey-algos.md` | Q6 log 轴 + 引线防重叠 / Q7 Sankey 依赖决策 |
| `05-state-and-test-baseline.md` | Q8 状态放置 / Q9 测试基线 |

附 Phase-1 已写文件（保持有效）：`01-bucket-coverage.md` / `02-custom-cli-id-mapping.md` / `03-svg-primitive-reusability.md` / `04-scatter-axes-and-labels.md` / `05-sankey-implementation.md` / `06-existing-test-coverage.md`。本次 Phase-2 文件是它们的 PRD 对齐重组，结论一致。

## 已确认的假设（PRD 与代码一致）

| 假设 | 验证 |
|---|---|
| `RouteAnalyticsBucket.firstByteHistogram` 桶边界 = `[200, 500, 1000, 3000, 5000, 10000]` | `src/shared/types/route-proxy.ts:555` 完全一致 |
| `siteId / accountId / apiKeyId / routeRuleId` 在 bucket 中非空 | `src/main/route-analytics-service.ts:354-356` 三元组短路 |
| `computeLatencyPercentiles` 适配任意 histogram（含 `firstByteHistogram`） | `src/renderer/utils/routeLatency.ts:81-94` 与 histogram 类型解耦 |
| 后端只有 `disabledUntil`，无 `degraded` | grep `degraded` 全仓零命中；`isRoutePathDisabled` 仅看 `disabledUntil > now`（`src/main/route-stats-service.ts:112-119`） |
| 自定义 CLI 走本地路由代理产生 bucket 数据 | `aggregateRouteModelRegistry` → `buildCanonicalModelChannels` → `recordRouteRequest`（链路完整） |
| `RouteObjectStatsList` / `ChannelHealthList` 无外部 consumer，可删 | grep 仅 `DataOverviewPage.tsx` 内 4 行命中 |
| `DotMatrixChart` 仅站点子页用，路由子页改造不能删 | `:1148-1188` 定义，`:1995` 附近 token 矩阵在用 |
| 仓库无 d3 / sankey / 任何图表库 | `package.json` + `package-lock.json` 双重确认 |
| 仓库无 log10 / leader-line / sankey 工具 | `src/` 全仓 grep 零命中 |

## PRD 假设需要修正的点

### 1. `cliType === 'custom'` 不存在

**PRD 原文**（§Row 2 过滤入口）：

> 由前端基于 `RouteAnalyticsBucket.siteId` / `cliType === 'custom'` + `customCliId`（通过 site 维度伪装的 `custom-cli-site-${id}`）过滤聚合

**事实**：`RouteCliType` 枚举只有 `'claudeCode' | 'codex' | 'geminiCli'`（`src/shared/types/route-proxy.ts:18`）。自定义 CLI 通道的 bucket，`cliType` 仍是上游 CLI 协议，由 URL 路径推断（`src/main/route-proxy-service.ts:782` `detectCliTypeFromPath`）。**永远不会是字符串 `'custom'`**。

**修正方案**：仅用 `bucket.siteId === buildCustomCliRouteSiteId(customCliId)` 字符串相等比较过滤即可，不需要看 `cliType`。`02-custom-cli-integration.md` 给出完整 helper 设计。

### 2. PRD 没说但需要补充的细节

- `canonicalModel` 在 bucket 中可能为 `undefined`（多次 `*` 共桶），treemap / Sankey 应显式过滤或显示「未识别模型」（详见 `01-route-analytics-data-flow.md` Q1）。
- KPI 第 4 张「样本不足」语义沿用现有 `< 20` 阈值（`computeLatencyPercentiles` 自带），新值文案需说明清楚。
- 散点上 disabled 状态在颜色上不引入第四档（保持三档梯度），可在 hover tooltip 文案中加「已禁用」字样。

### 3. 没有完全冲突，但需要在实现期决定的折中点

- TTFB 百分位扩展方式：扩 `computeLatencyPercentiles` 签名 vs 新建 `routeTtfb.ts` 复用其内部工具。**推荐后者**（无破坏性变更）。
- Sankey 流带颜色：离散三档 vs 线性渐变。**推荐离散**（与散点对齐 / 性能 / 视觉契约）。
- `scope / selectedModel`：local state vs Zustand。**推荐 local**，符合 `state-management.md` spec 第 73-89 行 / 反例第 150 行。

## 新文件 / 工具清单

### 新建工具文件

| 路径 | 行数预估 | 职责 |
|---|---|---|
| `src/shared/utils/customCliRouteId.ts` | 25-35 | 跨进程合成 id helper（主进程 re-export） |
| `src/renderer/utils/routeScopeFilter.ts` | 30-50 | bucket 按 scope 过滤；`Scope` 类型 |
| `src/renderer/utils/routeTtfb.ts` | 30-50 | `computeFirstBytePercentiles` + `formatTtfb` |
| `src/renderer/utils/routeLogAxis.ts` | 25-35 | log10 刻度 + 数值映射 |
| `src/renderer/utils/routeScatter.ts` | 100-150 | 散点点位 + Top-N 引线候选 + 防重叠 |
| `src/renderer/utils/routeSankey.ts` | 80-120 | `(model, channel)` 聚合 + Top-N + 「其他」 |

### 新建 React 组件

| 组件 | 行数预估 | 说明 |
|---|---|---|
| `RouteOverviewView`（在 `DataOverviewPage.tsx` 内拆出） | 200-300 | 托管 `routeWindow / scope / selectedModel` 三个 local state |
| `RouteTrendChart`（替换 / 改造 `RouteTrendHeroCard`） | 150-200 | 共轴成功率面积 + TTFB 折线 + 灰柱 + 底部红点 + 范围下拉 + 顶部分位 chip |
| `RouteScatterChart` | 120-160 | log-X 散点矩阵 + 引线 |
| `RouteSankeyChart` | 100-140 | 模型 → 通道 二部图 |

### 改造组件

- `ModelHeatmapList`：颜色编码改成功率梯度 + 点击回调 + 选中态描边/抬升阴影
- `RouteMetricCard` 第 4 张：合并 TTFB P95 + 端到端 P99 双值
- `resolveChannelHealthTone`：保持不变，复用到散点 / Sankey

### 删除组件 / 数据 / IPC

- `RouteObjectStatsList`（`DataOverviewPage.tsx:920-983`）
- `ChannelHealthList`（`DataOverviewPage.tsx:1100-1146`）
- `ChannelHealthDisplayItem` 类型（`:1078-1085`）
- `routeObjectStats` 数据加载逻辑（路由子页）
- `route:get-object-stats` IPC 调用（路由子页；handler 本身不删）

### 测试改写

详见 `05-state-and-test-baseline.md`：

- 保留 4 个用例（#1, #3, #5, #7）
- 重写 1 个（#2）+ 部分重写 1 个（#6）
- 小改 1 个（#4）
- 新增 9 个用例
- 新增 mock：`useCustomCliConfigStore`

## 推荐 PR 拆分（4 个 PR-sized chunks）

### PR 1 · 基建 + 工具层（约 300 行 / 测试 80 行）

- 新建 `src/shared/utils/customCliRouteId.ts` + 改 `src/main/custom-cli-config-service.ts` re-export
- 新建 `src/renderer/utils/routeScopeFilter.ts` + 单测
- 新建 `src/renderer/utils/routeTtfb.ts` + 单测（基于 `routeLatency` 内部工具）
- 新建 `src/renderer/utils/routeLogAxis.ts` + 单测
- 旧测试 `src/__tests__/data-overview-page.test.tsx` 不动

**验收**：lint / typecheck / vitest 全绿；无 UI 变化；现有路由子页表现完全不变。

### PR 2 · 拆分 `RouteOverviewView` + 4 KPI 改造（约 400 行 / 测试 100 行）

- 在 `DataOverviewPage.tsx` 内拆出 `RouteOverviewView` 子组件，托管 `routeWindow / scope / selectedModel` local state
- 改造第 4 张 KPI 为 TTFB P95 + 端到端 P99 双值卡（用 `routeTtfb.ts`）
- 删除 `routeObjectStats` 调用 + `RouteObjectStatsList` + `ChannelHealthList` + `ChannelHealthDisplayItem`
- 此时 Row 2 / Row 3 暂用占位骨架（trend 卡保留旧版 `RouteTrendHeroCard`，treemap / sankey / scatter 占位为空容器）
- 测试 #2 重写完成 KPI 部分；测试 #4 删 `getObjectStats` 断言

**验收**：1300×800 三行可见；旧"活跃对象 / 通道健康矩阵"消失；KPI 第 4 张展示双值；其余功能等价。

### PR 3 · Row 2 趋势 + treemap（约 500 行 / 测试 150 行）

- 新建 `RouteTrendChart` 组件：成功率面积 + TTFB 折线 + 灰柱 + 底部红点 + 范围下拉 + 顶部 P50/P95/P99 chip
- 改造 `ModelHeatmapList` → 成功率梯度 + 点击回调 + 选中态
- 接入 `scope` filter（趋势 + treemap）
- 接入 `selectedModel` 双向联动（treemap → state）
- 新增测试：scope 过滤趋势 / scope 过滤 treemap / treemap 点击切换 selectedModel / 切 scope 重置 selectedModel

**验收**：scope 下拉切换后 Row 2 跟随；treemap 点击 → 选中态生效；切 scope → selectedModel 重置。

### PR 4 · Row 3 散点 + Sankey（约 600 行 / 测试 200 行）

- 新建 `src/renderer/utils/routeScatter.ts`（点位聚合 + 引线选择 + 防重叠）
- 新建 `src/renderer/utils/routeSankey.ts`（二部图聚合 + Top-N + 「其他」）
- 新建 `RouteScatterChart` + `RouteSankeyChart`
- 接入 `scope`（数据源） + `selectedModel`（散点高亮 / Sankey 流过滤）
- Sankey 左节点点击 → 反向触发 `setSelectedModel`（与 treemap 双向）
- 新增测试：散点 log 轴 / 引线条数 / 散点高亮 / Sankey 聚合 / Sankey 双向联动

**验收**：所有 PRD §Acceptance Criteria 项目通过；1300×800 / 1200×700 双分辨率不滚动；浅色 / 深色主题视觉一致。

### 可选 PR 5 · spec / index 同步

- 更新 `.trellis/spec/` 相关章节（如 state-management 增加"路由数据视图状态在 page 级 local state"案例）
- 更新 `PROJECT_INDEX.md` / `src/renderer/pages/FOLDER_INDEX.md` / `src/renderer/utils/FOLDER_INDEX.md`
- 更新各新文件头注释（Input/Output/Pos）

PR 4 完成后任务即满足 §Definition of Done。
