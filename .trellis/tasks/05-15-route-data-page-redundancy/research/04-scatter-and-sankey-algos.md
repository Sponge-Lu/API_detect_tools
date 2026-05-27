# Research: 散点 log 轴 / 引线标签 + Sankey 算法与依赖决策

- **Query**: Q6 / Q7 — 现有 log scale / leader-line / sankey 工具是否存在；若无，最小算法骨架与依赖决策
- **Scope**: mixed (internal grep + external bundle estimate)
- **Date**: 2026-05-17
- **基础来源**: 与本目录 `04-scatter-axes-and-labels.md` / `05-sankey-implementation.md`（Phase-1 已写）保持一致

## Q6 · 散点算法

### 已有工具：无

仓库 grep 确认（针对 `src/`）：

- `log10|Math\.log10|leader.line|leaderLine|sankey` 全部零命中
- `src/renderer/utils/` 下没有任何坐标轴 / scale 抽象
- `package.json` `dependencies` / `devDependencies` 不含 `d3-scale / d3-array / d3-shape / @visx/* / recharts / @nivo/*` 等任何图表库

→ 必须自实现。

### 算法 1：log10 X 轴刻度（O(1)）

PRD 域：TTFB P95，200ms → 10000ms。建议 ticks = `[200, 500, 1000, 3000, 5000, 10000]`，与 `firstByteHistogramBuckets`（`src/shared/types/route-proxy.ts:555`）完全一致。无需运行时计算。

```ts
// src/renderer/utils/routeLogAxis.ts （新建，≤30 行）
export const TTFB_AXIS_TICKS_MS = [200, 500, 1000, 3000, 5000, 10000] as const;
export const TTFB_AXIS_MIN = 200;
export const TTFB_AXIS_MAX = 10000;

const log10 = (v: number) => Math.log(Math.max(v, 1)) / Math.LN10;
const LOG_MIN = log10(TTFB_AXIS_MIN);
const LOG_MAX = log10(TTFB_AXIS_MAX);

export function logXScale(valueMs: number, plotWidth: number, paddingLeft: number): number {
  const clamped = Math.min(Math.max(valueMs, TTFB_AXIS_MIN), TTFB_AXIS_MAX);
  const ratio = (log10(clamped) - LOG_MIN) / (LOG_MAX - LOG_MIN || 1);
  return paddingLeft + ratio * plotWidth;
}

export function formatTtfbTick(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(0)}s` : `${ms}ms`;
}
```

复杂度：O(1) 每点。

### 算法 2：Top-N 引线 + 防重叠（greedy vertical-nudge，O(N log N)）

输入：`points: { x, y, labelText, labelWidthPx }[]`（已在 SVG 坐标系内）、`plot: { width, height, left, top }`。
输出：每个点一对 `{ anchorX, anchorY, labelX, labelY }`，引线为 `M anchorX anchorY L labelX-4 labelY` 的直线。

策略：

1. 候选按 anchorY 升序。
2. 顺序扫描，每个标签若与上一个 `lastBottom + minSpacing` 距离 < `lineHeight`，向下推。
3. 末尾若溢出 `plot.bottom`，反向 squeeze 一遍。
4. 标签水平位置：`Math.min(anchorX + 12, plot.right - labelWidthPx)`，超过则改放左侧（首版可省，PRD 默认 4 个标签）。

```ts
// 写入 src/renderer/utils/routeScatter.ts
const LABEL_LINE_HEIGHT = 14;        // 11px font + 3px gap
const LABEL_MIN_SPACING = 4;
const LABEL_HORIZONTAL_OFFSET = 12;

export function placeLeaderLabels(candidates, plot) {
  const sorted = [...candidates].sort((a, b) => a.anchorY - b.anchorY);
  const placed = [];
  let lastBottom = -Infinity;
  for (const c of sorted) {
    let labelY = c.anchorY;
    if (labelY - LABEL_LINE_HEIGHT / 2 < lastBottom + LABEL_MIN_SPACING) {
      labelY = lastBottom + LABEL_MIN_SPACING + LABEL_LINE_HEIGHT / 2;
    }
    const labelX = Math.min(c.anchorX + LABEL_HORIZONTAL_OFFSET, plot.left + plot.width - c.labelWidthPx);
    placed.push({ ...c, labelX, labelY });
    lastBottom = labelY + LABEL_LINE_HEIGHT / 2;
  }
  // 反向 squeeze
  const overflow = lastBottom - (plot.top + plot.height);
  if (overflow > 0) {
    let cap = plot.top + plot.height - LABEL_LINE_HEIGHT / 2;
    for (let i = placed.length - 1; i >= 0; i--) {
      if (placed[i].labelY > cap) placed[i].labelY = cap;
      cap = placed[i].labelY - LABEL_LINE_HEIGHT - LABEL_MIN_SPACING;
    }
  }
  return placed;
}
```

复杂度：O(N log N) + O(N)。N 默认 4，触发 scope 过滤后可能 ≤ 30，常量级开销，无需虚拟化。

`labelWidthPx` 估算：中文字符 ≈ 11px，英文/数字 ≈ 6px（与 `getCharacterDisplayWidth` 思路相同，见 `DataOverviewPage.tsx:117-119`），可在 `useLayoutEffect` 内用 `getBBox()` 二次校正。

### Top-N 引线候选选择规则

PRD §Row 3 / Acceptance 条目：

- 默认：仅请求量前 4 通道画引线标签
- 选 scope 但未选模型：scope 涉及的所有通道恒定显示标签
- 选 selectedModel：scope ∩ selectedModel 涉及的通道高亮 + 显示标签

实现：

```ts
function selectLabeledChannels(
  points: ScatterPoint[],
  scope: Scope,
  selectedModel: string | null
): Set<string> {
  // 1) 优先级 1：被 selectedModel 涉及的通道（Set A）
  // 2) 优先级 2：被 scope 涉及的通道（Set B）
  // 3) 兜底：按 requestCount desc 取 Top-4（Set C）
  if (selectedModel) return setA;
  if (scope.kind !== 'all') return setB;
  return setC;
}
```

## Q7 · Sankey 依赖决策

### 现有依赖

`package.json` 中无任何图表库（grep `node_modules/(d3-sankey|d3-shape|recharts|@visx|@nivo)` 在 `package-lock.json` 零命中）。

### 选项 A：引入 `d3-sankey`

- 大小：核心 4-6KB gzip + `d3-array` ≈ 6KB + `d3-shape` ≈ 8KB ≈ **18-22KB gzip / 60-80KB min** 增量
- 类型：需 `@types/d3-sankey`
- ESM-only，Vite `optimizeDeps` 兼容
- 风险：第一次为本项目引入 d3 体系，未来 90% 能力闲置
- 项目 CLAUDE.md 明确"严禁影响用户现有的其他功能 / 精简高效"，引入新 dep 需充分理由

### 选项 B：自实现 SVG sankey（推荐）

理由：

1. **场景退化为简单二部图**：左 ≤ 6（模型，含「其他」）、右 ≤ 8（通道，含「其他」）、最大 6×8 = 48 流带。无需层次布局、无需消除交叉。d3-sankey 的复杂层次能力全部用不上。
2. **Bundle 体积**：自实现 ≈ 6KB（含散点 / 轴工具），d3 路线 18-22KB gzip 增量 — 在 Electron 包内不致命，但首屏 JS 解析时间可感知。
3. **风格契约**：仓库内现有所有图表都是手写 SVG（`Sparkline / squarifiedTreemap / ChannelHealthList / DotMatrixChart`）。引入 d3 偏离既有风格，与 CLAUDE.md「精简高效、毫无冗余」冲突。
4. **可读性**：本场景 d3-sankey 的 API（`sankey() / sankeyLinkHorizontal()`）对非 d3 用户的学习曲线 > 100 行直白 SVG。
5. **共用工具**：自实现可与 `routeScatter.ts / routeLogAxis.ts` 共用坐标换算 / 颜色 token / `resolveChannelHealthTone`，形成自治的渲染层图元体系。

### 自实现算法骨架

```ts
// src/renderer/utils/routeSankey.ts （新建，80-120 行）
export interface SankeyNode { id: string; label: string; weight: number; side: 'left' | 'right'; }
export interface SankeyLink {
  sourceId: string;       // canonicalModel | "__OTHER_MODEL__"
  targetId: string;       // channelKey | "__OTHER_CHANNEL__"
  weight: number;         // requestCount
  successCount: number;   // 用于上色（绿/橙/红）
  successRate: number;
}
export interface SankeyData {
  leftNodes: SankeyNode[];   // ≤ 6 + 可选「其他」
  rightNodes: SankeyNode[];  // ≤ 8 + 可选「其他」
  links: SankeyLink[];
}

// 1) 聚合 buckets → Map<(canonicalModel, channelKey), { weight, successCount }>
//    channelKey = `${siteId}:${accountId}` (apiKeyId 不参与 — 同账号多 key 视作同通道)
// 2) 模型按 weight desc 取 Top-6，多余合并 "__OTHER_MODEL__"
// 3) 通道按 weight desc 取 Top-8，多余合并 "__OTHER_CHANNEL__"
// 4) 重新计算每条流（含「其他」节点）的 weight + successCount + successRate
export function buildSankeyData(
  buckets: RouteAnalyticsBucket[],
  channelLabelMap: Map<string, string>   // siteId:accountId → "siteName / accountName"
): SankeyData;

// 渲染层（SVG）：
// nodeRect = { x, y, width, height }，y 从顶部累加 weight*scale + gap
// linkPath: 对每条流在源/目标节点内按权重切片（与 d3-sankey 同款的 yOffset 累加）
//   贝塞尔三次曲线：M sx,sy0 C cx,sy0 cx,ty0 tx,ty0 L tx,ty1 C cx,ty1 cx,sy1 sx,sy1 Z
//   控制点 cx = (sx + tx) / 2
```

预估代码量：`routeSankey.ts` 80-120 行 + `RouteSankeyChart.tsx` 100-140 行 = 总 180-260 行。

### 联动行为

- `selectedModel` 由父组件 state 提供。
- 渲染时：`link.opacity = selectedModel == null ? 0.6 : link.sourceId === selectedModel ? 0.9 : 0.15`。
- 左节点 `<rect onClick>` → 父组件 `setSelectedModel(prev => prev === id ? null : id)`，与 treemap 共享同一 `onModelToggle(modelId)` 回调（PRD §Row 3 双向联动）。

### 流带颜色

PRD §Row 3 写"流带颜色 = 该流成功率梯度"。两种实现：

- **A. 离散三档**（推荐）：`resolveChannelHealthTone(successRate, false).background`，与散点对齐。代码 ≤ 5 行。
- **B. 线性渐变**：每条流定义 `<linearGradient>`，从源节点 fill 到目标节点 fill。代码量大，性能 OK（≤ 48 个）。但与现有视觉契约不一致。

→ 推荐 A，简洁且符合「UI 三档健康分桶」语义。

## Caveats / Not Found

- 无 zoom / brush 需求（PRD §Out of Scope 明确），axis 静态 6 个固定刻度即可，不必处理动态域。
- 浏览器 SVG `<text>` 实测宽度只能在挂载后 `getBBox()` 拿到；首版用启发式估算，让标签略有间隙也不会反复 reflow。
- 不引入任何外部库；`d3-scale` 单包 ≈ 60KB minified，相比手写 30 行边际收益可忽略。
- 若日后扩展到三层 Sankey（模型 → CLI → 通道）应重新评估 d3-sankey；本 PRD 明确两层，不存在扩展压力。
