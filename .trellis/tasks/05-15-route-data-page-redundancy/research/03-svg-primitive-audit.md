# Research: SVG 图元复用审计 + TTFB / 延迟原语

- **Query**: Q4 / Q5 — 现有 `Sparkline` / `squarifiedTreemap` / `DotMatrixChart` / `ChannelHealthList` / `RouteObjectStatsList` / `computeLatencyPercentiles` 在 PRD 三张新图（Row 2 趋势 / Row 2 treemap / Row 3 散点 / Row 3 sankey）下的复用情况，及 `firstByteHistogram` 桶边界确认
- **Scope**: internal
- **Date**: 2026-05-17
- **基础来源**: 与本目录 `03-svg-primitive-reusability.md`（Phase-1 已写）保持一致，本文件做 Phase-2 PRD 对齐补充

## 现有图元清单（带行号）

| 图元 / 函数 | 文件 : 行 | 说明 |
|---|---|---|
| `Sparkline` 组件 | `DataOverviewPage.tsx:562-803` | viewBox `160×N`，支持 `line / bars / area / guide / pointMarkers`，`preserveAspectRatio="none"` |
| `buildSparklineCoordinates` | `DataOverviewPage.tsx:419-455` | 序列归一化 + 缺失填充 |
| `buildSparklinePath / buildSparklineAreaPath` | `DataOverviewPage.tsx:457-498` | path-d 字符串生成 |
| `RouteTrendHeroCard` | `DataOverviewPage.tsx:804-918` | 三层 sparkline 堆叠卡 |
| `RouteObjectStatsList` | `DataOverviewPage.tsx:920-983` | 活跃对象列表 |
| `ModelHeatmapList` | `DataOverviewPage.tsx:1006-1076` | div + absolute 布局（**非 SVG**） |
| `resolveChannelHealthTone` | `DataOverviewPage.tsx:1087-1098` | UI 三档分桶 |
| `ChannelHealthList` | `DataOverviewPage.tsx:1100-1146` | grid 三列水平条 |
| `DotMatrixChart` | `DataOverviewPage.tsx:1148-1188` | 7×6 点阵（仅站点子页用） |
| `squarifiedTreemap<T>` | `src/renderer/utils/routeModelDistribution.ts:67-157` | 通用算法，与上色解耦 |
| `buildModelDistribution` | `src/renderer/utils/routeModelDistribution.ts:29-55` | 按 `cliType:canonicalModel` 聚合 buckets |
| `computeLatencyPercentiles` | `src/renderer/utils/routeLatency.ts:81-94` | histogram → P90/P99，样本 < 20 返 null |
| `formatLatency` | `src/renderer/utils/routeLatency.ts:96-100` | ms → `Xs / Yms` |

## Q4 · 复用映射

### Chart 1：成功率面积 + TTFB 折线 + 灰柱 + 底部红点（共轴）

| 子图层 | 复用 | 改造点 |
|---|---|---|
| 灰色请求量柱（背景） | `Sparkline showBars+hideLine` | 直接用 |
| 成功率绿色面积 | `Sparkline showAreaFill` | 直接用，`var(--success-soft)` |
| TTFB P95 折线 | `Sparkline` line 模式 | 直接用 |
| 顶部 P50/P95/P99 chip | `RouteTrendHeroCard:843-852` chip 区 | 替换文案 |
| 底部失败红点序列 | **无原语** | 新增 ≤30 行：从 `buildSparklineCoordinates` 拿 X，`<circle r=2 fill=danger>` per 非零失败 |
| 顶部范围下拉 | **无** | 新增（用 `<select>` 或 AppButton + portal） |

复用度 **85%**。结构改造约 60-100 行。建议拆 `RouteTrendHeroCard` 为独立组件 `RouteTrendChart`（PRD §Technical Approach 已规划独立 `RouteOverviewView` 子组件托管）。

### Chart 2：log10-X 散点矩阵（X=TTFB P95，Y=成功率，size=请求量）

| 子图层 | 复用 | 改造点 |
|---|---|---|
| 坐标轴 / 网格 | `Sparkline showGuides`（仅 3 条横向虚线，无 label） | 新增 `routeLogAxis.ts`，自绘 6 个 log 刻度 |
| 散点圆 | 无 | 新增 `<circle>` + sqrt 半径缩放 |
| 颜色分桶 | `resolveChannelHealthTone` | 直接复用三档 |
| 引线标签 | 无 | 新增 greedy vertical-nudge（详见 `04-scatter-and-sankey-algos.md`） |
| Quadrant tint（"快又稳"提示） | 无 | 新增 2 个 `<rect>` |
| Hover tooltip | 无（现有图靠 `<title>`） | 复用 native `<title>` 即可 |

复用度 **25%**。预计 150-180 行。`Sparkline` 的 `preserveAspectRatio="none"`（`:617`）非等比拉伸，**散点不能照搬**该 viewBox 模式 — 需要 `xMidYMid meet` 或动态 viewBox 保正圆与 log 刻度。

### Chart 3：模型 → 通道 Sankey

| 子图层 | 复用 | 改造点 |
|---|---|---|
| 节点矩形 + 流带 | 无 | 新增（详见 `04-scatter-and-sankey-algos.md`） |
| 流带颜色 | `resolveChannelHealthTone` | 离散三档（与散点对齐） |
| 数据聚合 | `buildModelDistribution` 仅按模型聚合，**不够** | 新增 `routeSankey.ts` 做 `(canonicalModel, channelKey)` 聚合 + Top-6/8 + "其他" |
| 选中态 | 无 | 父组件 `selectedModel` 控制 opacity |

复用度 **10%**。预计 120-160 行 SVG + 40-80 行聚合。

## 必须保留 / 删除（PRD §删除项核对）

| 组件 / 函数 | 行 | 处置 | 备注 |
|---|---|---|---|
| `RouteObjectStatsList` | `:920-983` | **删除** | 仅 `:2136` 在路由子页用，无其他 consumer（grep 确认） |
| `ChannelHealthList` | `:1100-1146` | **删除** | 仅 `:2160` 在路由子页用 |
| `ChannelHealthDisplayItem` 类型 | `:1078-1085` | **删除** | 仅 `ChannelHealthList` 消费 |
| `DotMatrixChart` | `:1148-1188` | **保留** | 站点子页 token 矩阵在用（`:1995` 附近），路由子页未用 |
| `ModelHeatmapList` | `:1006-1076` | **改造** | `background` 改成功率梯度；新增点击回调 + 选中态描边 |
| `RouteTrendHeroCard` | `:804-918` | **改造** | 移除 routeWindow chip + 请求量趋势 badge；加范围下拉 / 顶部分位 chip / 底部红点序列。或拆为 `RouteTrendChart` 新组件 |
| `RouteMetricCard`（4 KPI） | 现有 | **3 张保留 + 1 张改造** | 第 4 张「延迟分位数」改为 TTFB P95 主值 + 端到端 P99 副值（详见下方 Q5） |
| `routeObjectStats` 数据加载 | 路由子页 | **删除** IPC 调用 | PRD §删除项：不再用 `route:get-object-stats` |

`RouteObjectStatsList` 和 `ChannelHealthList` 全仓 grep 确认无其他 consumer：

```
DataOverviewPage.tsx:920  function RouteObjectStatsList(...)
DataOverviewPage.tsx:2136 <RouteObjectStatsList items={routeObjectStats} />
DataOverviewPage.tsx:1100 function ChannelHealthList(...)
DataOverviewPage.tsx:2160 <ChannelHealthList items={activePathStates} />
```

## Q5 · TTFB / 延迟原语

### `firstByteHistogram` 桶边界

`src/shared/types/route-proxy.ts:555`：

```ts
firstByteHistogramBuckets: [200, 500, 1000, 3000, 5000, 10000];
```

与 PRD 散点 X 轴 log10 域 `200ms → 10s+` 完全一致。

### `computeLatencyPercentiles` 是否通用

是。函数签名 `computeLatencyPercentiles(histogram: Record<string, number>): { p90, p99, sampleCount }`（`src/renderer/utils/routeLatency.ts:81-94`），**与具体 histogram 类型解耦**，只解析形如 `100-200ms` / `>10000ms` 的 bucket label。`firstByteHistogram` 与 `latencyHistogram` 的 label 格式相同（见 `src/main/route-analytics-service.ts:430-431`，使用同一个 `classifyLatency()`），可直接复用。

但缺 P50 / P95 — PRD §Row 1 KPI 第 4 张要 "P50/P99"，PRD §Row 2 顶部 chip 要 "P50 / P95 / P99"。

### 推荐：扩展为通用百分位

新增 `src/renderer/utils/routeTtfb.ts`：

```ts
import { computeLatencyPercentiles } from './routeLatency';

// 直接复用 routeLatency 内部桶解析（需要把 buildSortedBuckets / computePercentile 暴露出去）
// 或者 routeLatency 增加 percentiles 参数
export function computeFirstBytePercentiles(histogram: Record<string, number>): {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  sampleCount: number;
} {
  // ... 复用 buildSortedBuckets / computePercentile
}

export function formatTtfb(ms: number | null): string {
  if (ms === null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}
```

或者**更轻方案**：扩展 `routeLatency.ts` 让 `computeLatencyPercentiles` 接受 `percentiles: number[]` 并返回 `Record<string, number | null>`。但这会改变现有签名，需要同步改 `DataOverviewPage.tsx:1590` 和测试文件 `src/__tests__/route-latency.test.ts`。

**推荐增量方案**：把 `buildSortedBuckets / computePercentile` 改为命名 export（不改默认 `computeLatencyPercentiles` 签名），新文件 `routeTtfb.ts` 复用这两个内部工具实现 `computeFirstBytePercentiles`。这样向后兼容、无破坏性变更。

### KPI 第 4 张合并卡数据形态

PRD §Row 1 第 4 张：

- 主值 = TTFB P95 = `computeFirstBytePercentiles(routeDistribution.firstByteHistogram).p95`
- 副值 = 端到端 P99 = `computeLatencyPercentiles(routeDistribution.latencyHistogram).p99`（沿用现有）
- hint = `样本 N · P50/P99`（这里的 P50 / P99 是 TTFB 的 P50 与端到端的 P99 / 或者按 PRD 文意是 TTFB P50 + 端到端 P99，实现期需以 PRD 文案最终稿为准）

实现期注意：当 `sampleCount < 20` 时 P95 / P99 都为 null，UI 必须显示「样本不足」而非数字，与现有逻辑一致。

## 推荐新增工具文件清单

确认 PRD §Technical Approach 已规划项目：

| 文件 | 行数预估 | 职责 |
|---|---|---|
| `src/renderer/utils/routeScopeFilter.ts` | 30-50 | bucket 按 scope 过滤；导出 `Scope` 类型 |
| `src/renderer/utils/routeSankey.ts` | 80-120 | `(canonicalModel, channelKey)` 聚合 + Top-N + 「其他」 |
| `src/renderer/utils/routeScatter.ts` | 100-150 | 散点点位数据 + Top-N 引线候选 + 防重叠算法 |
| `src/renderer/utils/routeTtfb.ts` | 30-50 | `computeFirstBytePercentiles` + `formatTtfb` |
| `src/renderer/utils/routeLogAxis.ts`（**新建议**） | 25-35 | log10 刻度 + 数值映射，散点专用 |
| `src/shared/utils/customCliRouteId.ts`（**新建议**） | 25-35 | 跨进程合成 id helper（详见 `02-custom-cli-integration.md`） |

## Caveats / Not Found

- `Sparkline.preserveAspectRatio="none"` 是关键差异点，散点必须用独立 SVG，不能套娃在 Sparkline 内。
- 现有图都没用 `<g>` 分组；散点建议引入 `<g transform="translate(...)">` 处理 padding / axis。
- `ChannelHealthDisplayItem` 缺 `firstByteLatencyMs` 字段；散点不能借这个接口，必须直接消费 `RouteAnalyticsBucket`（PRD §Row 3 已确认）。
- `formatLatency` 现有实现 `≥1000ms → 2 位小数 s`，散点 hover tooltip 与 KPI 副值都可继续复用；无需新增格式化函数（除非 PRD 文案要求 `1.5s` 而非 `1.50s`，目前未明确）。
