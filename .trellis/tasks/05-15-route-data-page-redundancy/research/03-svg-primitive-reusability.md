# Research: SVG primitive reusability map

- **Query**: 现有 Sparkline / squarifiedTreemap / DotMatrixChart / ChannelHealthList 等图元在 PRD 三张新图（共轴成功率+TTFB+灰柱+底部红点 / log-X 散点 / 模型→通道 Sankey）下的复用情况
- **Scope**: internal
- **Date**: 2026-05-17

## Findings

### 现有图元清单

| 图元 | 文件 | 行号 | 接口要点 |
|---|---|---|---|
| `Sparkline` | `DataOverviewPage.tsx` | 562-803 | viewBox 160×N，支持 line / bars / area / guide / pointMarkers，单 SVG |
| `buildSparklineCoordinates` | 同文件 | 419-455 | 序列归一化 + 数据缺失填充 |
| `buildSparklinePath` / `buildSparklineAreaPath` | 同文件 | 457-498 | 折线 / 面积 path 生成 |
| `RouteTrendHeroCard` | 同文件 | 804-918 | 三图层堆叠（请求量灰柱 + 成功率折线 + Tokens 折线） |
| `ModelHeatmapList` | 同文件 | 1006-1076 | div + absolute 定位（**非 SVG**），颜色编码失败强度 |
| `squarifiedTreemap<T>(...)` | `routeModelDistribution.ts` | 67-157 | 通用 squarified 算法，与具体颜色 / 标签解耦 |
| `buildModelDistribution` | `routeModelDistribution.ts` | 29-55 | 按 `cliType:canonicalModel` 聚合 buckets |
| `ChannelHealthList` | `DataOverviewPage.tsx` | 1100-1146 | grid 三列水平条，无坐标轴 |
| `DotMatrixChart` | 同文件 | 1148-1188 | 7×6 点阵 |
| `computeLatencyPercentiles` | `routeLatency.ts` | 81-94 | histogram → P90/P99，可推广到 P50/P95 |

### 复用映射表

#### Chart 1：共轴成功率面积 + TTFB 折线 + 请求量灰柱 + 底部失败红点

| 子图层 | 复用现状 | 修改建议 |
|---|---|---|
| 灰色请求量柱 | `Sparkline` 已支持 `showBars + hideLine`（DataOverviewPage.tsx:645-649, 884-890 类似用法） | 直接复用 |
| 成功率绿色面积 | `Sparkline` 的 `showAreaFill + areaClass` 路径（`buildSparklineAreaPath` :485-498） | 直接复用，颜色 token 已有 `var(--success-soft)` |
| TTFB P95 折线 | `Sparkline` 的 line 模式 | 直接复用 |
| 顶部 P50/P95/P99 chip | 现有 `RouteTrendHeroCard` 顶部 chip 区（:843-852） | 替换文案；逻辑层用 `computeLatencyPercentiles` 扩展到 P50/P95 |
| 底部失败红点序列 | 当前无原语 | **新增 ≤30 行**：基于 `buildSparklineCoordinates` 算 X 坐标，每个非零 failureCount 渲染 `<circle r=2 fill=danger>` |
| 顶部范围下拉 | 无 | **新增** AppButton-like select 或 Headless `<select>`；触发时改 `scope` |

复用度：**85%**。结构改造约 60-100 行（含 chip 重排、范围下拉、底部红点）。

#### Chart 2：log10-X 散点（X=TTFB P95，Y=成功率，size=请求量）

| 子图层 | 复用现状 | 修改建议 |
|---|---|---|
| 坐标轴 / 网格 | `Sparkline` 有 `showGuides`（仅 3 条横向虚线，不带 label），无对数轴 | **新增**：`<svg>` + 自绘刻度。建议建 `routeScatter.ts` 导出 `buildLogTicks`（见 04-scatter-axes 研究） |
| 散点圆 | 无 | **新增**：`<circle>` 渲染 + 半径 sqrt 缩放 |
| 颜色分桶 | 无 | 沿用 `resolveChannelHealthTone()`（`DataOverviewPage.tsx:1087-1098`） — 已实现 ≥95% / 80-95% / <80% 三档 |
| 引线标签 | 无 | **新增**：见 04-scatter-axes 研究 |
| Quadrant tint | 无 | **新增**：两个 `<rect>` |
| Hover tooltip | 无（现有图都靠 `title=""`） | 复用 native `<title>`，足以满足 PRD |

复用度：**25%**。基本是新代码，但可以套用 `Sparkline` 的 viewBox 模式（`160 × N`）保持视觉一致。预计 150-180 行。

#### Chart 3：模型 → 通道 Sankey

| 子图层 | 复用现状 | 修改建议 |
|---|---|---|
| 节点矩形 | 无 | **新增**：左 6 / 右 8 节点 |
| 流带（贝塞尔） | 无 | **新增**：bezier-cubic path |
| 节点排序 + Top-N + "其他"聚合 | 无 | **新增**：`routeSankey.ts`（PRD 已规划） |
| 流带颜色 | 无 | 沿用 `resolveChannelHealthTone()` 三档颜色 |
| 数据聚合 | `buildModelDistribution` 仅按模型聚合 | 需要新建 `(canonicalModel, siteId+accountId)` 聚合（`routeSankey.ts`） |
| 高亮联动 | 无 | 父组件 `selectedModel` 控制 opacity |

复用度：**10%**（仅颜色 token 与 AppCard 容器）。预计 120-160 行 SVG + 40-80 行聚合（见 05-sankey-implementation 研究）。

### 必须保留 / 删除项

参考 PRD §删除项与 `DataOverviewPage.tsx:2129-2162`：

- 删除：`RouteObjectStatsList`（:920-983）、`ChannelHealthList`（:1100-1146）、`DotMatrixChart`（仅站点子页用，路由子页未用，**保留**）。
- 改造：`ModelHeatmapList`（:1006-1076）— `background` 计算需改成成功率梯度；新增点击回调与选中态描边/抬升阴影；其余结构不变。
- 改造：`RouteTrendHeroCard`（:804-918）— 移除 `routeWindow` chip + 请求量趋势 badge，加范围下拉 + 顶部 P50/P95/P99 chip + 底部红点序列；保留三图层 viewBox 堆叠模式。

### 推荐新增工具文件（最小 surface）

PRD 已规划，确认依赖关系：

- `src/renderer/utils/routeScopeFilter.ts`：bucket 按 scope 过滤（依赖 02-custom-cli-id-mapping 的 helper）
- `src/renderer/utils/routeSankey.ts`：`(canonicalModel, channelKey)` 聚合 + Top-6/8 + "其他"
- `src/renderer/utils/routeScatter.ts`：散点点位 + Top-N 引线候选
- `src/renderer/utils/routeTtfb.ts`：复用 `computeLatencyPercentiles`，补 P50/P95
- `src/renderer/utils/routeLogAxis.ts`（**新建议**）：log10 刻度生成 + 数值映射，复用于散点

## Caveats / Not Found

- `Sparkline` 当前 viewBox 固定 160×chartHeight + `preserveAspectRatio="none"`，**横向是非等比拉伸**。新散点图想要正圆和正确 log 刻度，需用 `preserveAspectRatio="xMidYMid meet"` 或动态 viewBox（实测见 `Sparkline.preserveAspectRatio="none"` 这一行 :617）。
- 现有图都没用 `<g>` 分组，直接堆放 SVG 元素；散点图建议引入 `<g transform="translate(...)">` 处理 padding / axis。
- `ChannelHealthList` 接收 `ChannelHealthDisplayItem[]`，本研究确认其字段（label / successRate / windowRequestCount / isDisabled）**已能映射散点维度**，但缺 `firstByteLatencyMs`；散点必须直接消费 bucket，不能复用该接口。
