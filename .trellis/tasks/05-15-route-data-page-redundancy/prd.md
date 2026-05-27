# 路由数据页信息冗余优化

## Goal

数据总览 → 路由数据子页（`DataOverviewPage.tsx`，`view === 'route'` 分支）当前在 5 个区块重复展示请求量 / 成功率 / Tokens / 失败次数等同一指标，且缺少对**成功率**与**首字时间（TTFB）**的主线表达。本任务在不滚动的前提下（默认 1300×800 / 最小 1200×700）将 5 区块缩到 3 行 4 区块，并通过站点/CLI 过滤 + 模型选中两条联动链让用户能从全局逐步下钻到单条通道。

## Requirements

### 整体布局（KPI + 运行趋势 / 模型热力 + 散点 / Sankey）

```
┌──────────────────────────────────────────────────────────────────┐
│ Row 1 · 4 KPI（请求量 / 成功率 / Tokens / TTFB P95+端到端 P99） │ ~96
├──────────────────────────────────────────────────────────────────┤
│ Row 2 · 左 65% 运行趋势（优化版） │ Row 2 · 右 35% 模型热力 treemap │ ~252
├──────────────────────────────────────────────────────────────────┤
│ Row 3 · 左 60% 通道健康散点矩阵   │ Row 3 · 右 40% 模型→通道 Sankey │ ~268
└──────────────────────────────────────────────────────────────────┘
合计 ≈ 96 + 12 + 252 + 12 + 268 = 640px，1300×800 默认尺寸内不滚动
```

### Row 1 · 4 张 KPI（保持不变 + 合并卡）

- 请求量（chip = 趋势 badge）
- 成功率（chip = 健康度，hint = 失败次数）
- Token 消耗（chip = 趋势 badge，hint = Prompt / Completion / Cache）
- **TTFB P95 + 端到端 P99 合并卡**（合并旧延迟卡）：主值=TTFB P95，副值=端到端 P99，hint = "样本 N · P50/P99"
  - TTFB 数据源：`firstByteHistogram`，复用 `computeLatencyPercentiles`

### Row 2 · 运行趋势（优化版） + 模型热力 treemap

**运行趋势（左 65%，方案 G 趋势）**

- 主区：成功率面积图（绿色 0-100%）+ TTFB P95 折线（深绿）共轴
- 背景层：请求量灰柱作流量 context（不抢主色）
- 底部：失败次数小红点序列（取代失败折线，视觉占比 ≤10%）
- 顶部 chip：当前 P50 / P95 / P99 · 失败 N 次（折叠成一行）
- 删除原 `RouteTrendHeroCard` 内的 routeWindow chip 和请求量趋势 badge（已被 KPI 表达）
- **过滤入口**：标题栏新增"范围"下拉，选项 = `全部聚合 / <站点1> / <站点2> / ... / <自定义 CLI 1> / ...`
  - 默认 = 全部聚合
  - 选择具体站点 / 自定义 CLI 后：当前 routeWindow 内所有图层均按该 scope 过滤
  - 由前端基于 `bucket.siteId === buildCustomCliRouteSiteId(customCliId)` 字符串相等比较过滤聚合（`cliType` 仍是上游 CLI 协议 `'claudeCode' | 'codex' | 'geminiCli'`，无 `'custom'` 值，不参与过滤）
  - `canonicalModel` 在 bucket 中可能为 `undefined`（多次 `*` 共桶），treemap / Sankey 显式过滤或归为「未识别模型」

**模型热力 treemap（右 35%）**

- 面积 = 请求量
- **颜色 = 成功率梯度（绿→橙→红）**（替换原失败强度编码）
- 标签：模型名 + 请求量
- **联动入口（被影响方）**：当运行趋势的"范围"选中具体站点 / 自定义 CLI 时，treemap 仅展示该 scope 下的模型分布
- **联动出口（影响方）**：点击 treemap 内某模型 = 全局选中该模型，触发 Row 3 联动；再次点击同模型或点击空白 = 取消选中
- 选中模型时该格加白色边框 + 抬升阴影，其他格半透明 0.4

### Row 3 · 通道健康散点矩阵 + 模型 → 通道 Sankey 流图

**通道健康散点矩阵（左 60%，方案 G 散点）**

- X = TTFB P95（对数 200ms → 10s+）
- Y = 成功率（0-100%）
- 气泡大小 = 请求量
- 颜色：绿 = 成功率 ≥ 95%，橙 = 80-95%，红 = < 80%（仅 UI 视觉分桶，与后端无 degraded 状态关联）
- 象限淡背景：左上"快又稳"提示文案
- **点位辨识：Top-N 引线标签 + 高亮持久化**
  - 默认仅请求量前 4 通道画引线标签（`siteName / accountName`），其余仅圆点
  - 当运行趋势"范围"选中具体站点 / 自定义 CLI 但**未选模型**时：被该 scope 涉及的所有通道恒定显示标签（即便不是 Top-N），未涉及通道的标签隐藏并气泡变灰
  - 当**选中模型**（联动方案 B）时：被该模型涉及的通道高亮（保留颜色 + 加描边 + 显示标签），未涉及通道气泡降透明度至 0.25 且不显示标签；散点本身不被过滤掉
  - hover 任意点 = 临时显示该点完整标签 tooltip（站点 / 账号 / 模型 / 成功率 / TTFB / 请求量）

**模型 → 通道 Sankey 流图（右 40%）**

- 左节点 = 模型（最多 6 个，按请求量排序，其余聚合为"其他"）
- 右节点 = 通道（最多 8 个，节点 = `siteName / accountName`，其余聚合为"其他"）
- 流带粗细 = 该 (模型, 通道) 的请求量
- 流带颜色 = 该流成功率梯度（绿→橙→红）
- **联动行为**：
  - 未选模型：显示全局 top 模型 → top 通道全景
  - 选中模型（来自 treemap 点击）：仅保留该模型的流（其他流半透明 0.15）；同时左节点高亮该模型
  - Sankey 仅消费 treemap 的模型选中态来高亮对应左节点和流带；点击 Sankey 左侧模型节点不反向触发选中（单向联动）
- 数据：前端从 `RouteAnalyticsBucket` 聚合 `(canonicalModel, siteId+accountId)` → `requestCount / successRate`，无需新增 IPC

### 联动总线（state shape）

- `routeWindow`: '24h' | '7d'（沿用）
- `scope`: { kind: 'all' } | { kind: 'site', siteId } | { kind: 'custom-cli', customCliId }（新增，控制 Row 2 / Row 3 全部数据源过滤）
- `selectedModel`: string | null（新增，控制 treemap 选中态、Sankey 流过滤、散点 B 方案高亮）
- 联动规则：
  - 切换 `scope` → 重置 `selectedModel` 为 null（避免 scope 不再包含旧选中模型）
  - `selectedModel` 仅控制散点高亮 / Sankey 流，不再二次过滤 Row 2 数据（趋势 + treemap 反映 scope，散点 + Sankey 反映 scope ∩ selectedModel）

### 删除项（去重清单）

- 删除：`RouteObjectStatsList`（活跃对象列表，被散点 + Sankey 替代）
- 删除：`ChannelHealthList`（通道健康矩阵列表，被散点替代）
- 删除：`RouteTrendHeroCard` 顶部右侧的 routeWindow chip 与请求量趋势 badge
- 删除：模型 treemap 的失败强度颜色编码（改为成功率梯度）
- 不再使用：`route:get-object-stats` 调用（散点 + Sankey 直接消费 `analytics-distribution.buckets`）

## Acceptance Criteria

- [ ] 1300×800 默认尺寸下三行内容全部可见，无垂直滚动
- [ ] 1200×700 最小尺寸下 KPI + 运行趋势 + 至少一行 Row 3 可见
- [ ] 同一指标在路由数据子页的展示次数 ≤ 2 次（一次 KPI 总值 / 一次专属图表）
- [ ] 运行趋势支持 `全部 / 各站点 / 各自定义 CLI` 过滤，切换后 Row 2 / Row 3 数据全部跟随
- [ ] 选择具体 scope 但未选模型时，散点中该 scope 涉及的全部通道恒定显示引线标签
- [ ] 点击模型 treemap 任一格 → Sankey 仅保留该模型流 + 散点中该模型涉及通道高亮（其余降透明），不过滤散点点集
- [ ] 再次点击同模型或点击 treemap 空白 → 取消选中并复原
- [ ] treemap 模型选中单向驱动 Sankey：对应模型左节点和流带高亮，其他流带半透明；点击 Sankey 左侧模型节点不反向选中
- [ ] KPI 第四张展示 TTFB P95（主）+ 端到端 P99（副）双值
- [ ] 散点颜色仅作 UI 健康分桶，不引入"降级 / 禁用"语义（后端无 degraded，仅有 disabledUntil）
- [ ] 主题 token 沿用 `var(--success/-soft)` / `var(--warning/-soft)` / `var(--danger/-soft)` / `var(--accent)`，与冷灰矿物 / 石墨暗色双主题一致

## Definition of Done

- 单元测试覆盖：scope 过滤、selectedModel 联动重置、Sankey 聚合（`__tests__/data-overview-page.test.tsx` 同步重写）
- Lint / typecheck / vitest 全绿
- PROJECT_INDEX.md / FOLDER_INDEX.md / 文件头注释同步
- 手动验证：1300×800 与 1200×700 两个分辨率下不滚动；浅色 / 深色主题视觉一致

## Technical Approach

### 新增 / 改造的渲染层模块

- `src/renderer/pages/DataOverviewPage.tsx`：拆 `view === 'route'` 分支为独立子组件 `RouteOverviewView`，内部托管 scope / selectedModel / routeWindow 状态
- `src/renderer/utils/routeScopeFilter.ts`（新增）：按 scope 过滤 `RouteAnalyticsBucket[]`
- `src/renderer/utils/routeSankey.ts`（新增）：聚合 `(canonicalModel, channelKey)` → 节点 / 边数组，含 Top-N 截断与"其他"合并
- `src/renderer/utils/routeScatter.ts`（新增）：从 `routePathStates` + `analytics buckets` 聚合散点数据 + Top-N 引线选择
- `src/renderer/utils/routeTtfb.ts`（新增）：复用 `computeLatencyPercentiles` 处理 `firstByteHistogram`

### 复用与不变项

- IPC：`route:get-analytics-summary` / `route:get-analytics-distribution` / `route:get-config` / `overview:get-site-daily-snapshots` 不变
- 主进程：无改动
- 已有原语：`Sparkline`、`squarifiedTreemap`、`SectionTitle`、`AppCard` 沿用
- 颜色 token：完全沿用现有 `var(--*)` 体系，不新增设计变量

## Decision (ADR-lite)

**Context**：路由数据页 5 区块多次重复请求量 / 成功率 / Tokens / 失败，且未表达 TTFB 与"哪些通道不能用"。用户期望多图表、不滚动、按站点 / 自定义 CLI 过滤、点击模型联动。

**Decision**：
- 采用 4 区块三行布局：KPI / 运行趋势 + 模型热力 / 散点矩阵 + Sankey
- 散点颜色仅作 UI 健康分桶（绿/橙/红），不引入后端不存在的"降级"语义
- 弃用"禁用通道环阵"（依赖 `disabledUntil`，常态空），由"模型 → 通道 Sankey"接替"哪条通道不健康"的回答
- 联动规则：scope 控制数据源（趋势 + treemap + 散点 + Sankey）；selectedModel 仅控制散点高亮 + Sankey 流过滤，不二次过滤趋势 / treemap

**Consequences**：
- 优点：每个区块职责独立、无字段重叠；TTFB 与成功率成为视觉主轴；用户可从"全局 → 站点/CLI → 模型 → 通道"逐级下钻；无需新增 IPC
- 代价：新增 Sankey / 散点 / 引线标签算法实现量约 300-400 行；测试用例需重写
- 风险：`RouteAnalyticsBucket` 在站点维度的覆盖度依赖既有写入逻辑（实现期需校验自定义 CLI 是否完整记录 `siteId / accountId`）

## Out of Scope (explicit)

- 站点数据子页（`view === 'site'`）的信息组织
- 路由代理服务的数据采集与新增字段（如 degraded 状态）
- 主进程新增 IPC 或新分析维度
- 模型热力点击之外的多选过滤交互
- 趋势图缩放 / 拖刷选

## Technical Notes

- 主文件：`src/renderer/pages/DataOverviewPage.tsx:2042-2165`
- 关联类型：`src/shared/types/route-proxy.ts`（`RouteAnalyticsBucket` 已含 `siteId/accountId/canonicalModel/cliType` + `firstByteHistogram` 桶 [200,500,1000,3000,5000,10000]）
- 关联工具：`utils/routeLatency.ts`、`utils/routeModelDistribution.ts`、`utils/routeRulePresentation.ts`
- 测试文件：`src/__tests__/data-overview-page.test.tsx`
- 后端禁用语义：`src/main/route-stats-service.ts:158-176` 仅有 `disabledUntil`，无 `degraded` 字段；`isRoutePathDisabled` 判断 `disabledUntil > now`
- 默认窗口尺寸：`src/main/main.ts:91-95`（1300×800，最小 1200×700）
- 主题 token：`src/shared/theme/themePresets.ts`（Light = 冷灰矿物 / Dark = 石墨暗色）
