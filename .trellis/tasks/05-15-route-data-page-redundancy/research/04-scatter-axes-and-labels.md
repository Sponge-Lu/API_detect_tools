# Research: Scatter axes & label de-overlap

- **Query**: 仓库内是否已有 log10 轴刻度或引线标签防重叠工具？若无，给出最小算法（伪码 + 复杂度）
- **Scope**: internal
- **Date**: 2026-05-17

## Findings

### 已有工具：无

- `src/renderer/utils/`（`routeLatency.ts` / `routeModelDistribution.ts` / `siteOverview.ts` / `routeRulePresentation.ts` 等）均不包含 log 轴 / 标签碰撞工具。`Grep` `log10|Math\.log10|leader.line|leaderLine|sankey` 在整个 `src/` 下零命中。
- `src/renderer/components/`（含 `Route/`）下没有任何坐标轴 / scale 抽象。
- `package.json` 只有 `axios / electron-log / lucide-react / pinyin-pro / @tanstack/react-virtual / zod / zustand / webdav / puppeteer-core` 等，无 `d3-scale / d3-array / @visx/scale / @visx/annotation` 等。

→ 必须自实现，inline 至 `src/renderer/utils/routeLogAxis.ts` 与 `src/renderer/utils/routeScatter.ts`。

### 算法 1：log10 轴刻度生成

PRD 域：TTFB P95，目标范围 200ms → 10000ms，散点 X 轴用 log10。建议 ticks = `[200, 500, 1000, 3000, 5000, 10000]`（与 `firstByteHistogramBuckets` 完全一致，见 `src/shared/types/route-proxy.ts:555`），无需运行时计算。

伪码（≤25 行，O(1)）：

```ts
// routeLogAxis.ts
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

### 算法 2：引线标签防重叠（greedy vertical nudge）

输入：`points: { x, y, labelText }[]`（已在 SVG 坐标系内）、`minSpacingPx`、`viewBoxHeight`。
输出：`labels: { anchorX, anchorY, labelX, labelY, leaderPath }[]`。

策略：列内候选标签按 anchorY 升序，扫描时若与上一个标签 baseline 距离 < `lineHeight + minSpacing`，向下推到刚好满足；最后若超出 viewBox 底部，再做一轮反向（top-down）压缩。引线为 `M anchorX anchorY L labelX-padding labelY` 直线（不需弧线，本场景空间足够）。

伪码：

```ts
// routeScatter.ts
interface LabelCandidate { idx: number; anchorX: number; anchorY: number; labelText: string; labelWidthPx: number; }
interface PlacedLabel { idx: number; anchorX: number; anchorY: number; labelX: number; labelY: number; labelWidthPx: number; labelText: string; }

const LABEL_LINE_HEIGHT = 14;        // 11px font + 3px gap
const LABEL_MIN_SPACING = 4;
const LABEL_HORIZONTAL_OFFSET = 12;  // 引线长度

export function placeLeaderLabels(
  candidates: LabelCandidate[],
  plot: { width: number; height: number; left: number; top: number }
): PlacedLabel[] {
  const sorted = [...candidates].sort((a, b) => a.anchorY - b.anchorY);
  const placed: PlacedLabel[] = [];
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
  // 反向 squeeze：若末尾溢出底边，从下往上回推
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

export const buildLeaderPath = (l: PlacedLabel) =>
  `M ${l.anchorX} ${l.anchorY} L ${l.labelX - 4} ${l.labelY}`;
```

复杂度：O(N log N)（排序）+ O(N)（两轮扫描）。N ≤ 4 默认 / ≤ 站点通道总数（实际 ≤ 30），常量级开销，无需虚拟化。

`labelWidthPx` 估算：调用方在 React 组件内用 `<canvas>` measureText 或简单 `text.length * 6`（对中文混合可改 `width = sum(c => 0xff < c ? 11 : 6)`，复用 `getCharacterDisplayWidth` 思路，见 `DataOverviewPage.tsx:117-119`）。

### 边界条件

- 同 anchorY 多点：排序稳定，按出现顺序依次下挪。
- 单点：直接放在 anchor 右侧。
- 数据为空：返回 `[]`。
- 标签水平溢出：`Math.min(labelX, plot.left + plot.width - labelWidthPx)`，超过则改为左侧（可在第一版省略，PRD 仅 4 个标签默认）。

### 推荐放置

- 算法 1 → 新建 `src/renderer/utils/routeLogAxis.ts`（≤ 30 行）
- 算法 2 → 写入 `src/renderer/utils/routeScatter.ts`（与 PRD 已规划文件合并），与 Top-N 引线候选选择函数共用一个文件。

## Caveats / Not Found

- 浏览器环境下 SVG `<text>` 实测宽度只能在挂载后获得；首次渲染建议用启发式估算（中文 1em / 英文 0.5em），让标签略有间隙也不会反复 reflow。需要更精确的话可在 `useLayoutEffect` 内用 `getBBox()` 二次校正。
- 没有 zoom / brush 需求（PRD §Out of Scope 明确"趋势图缩放 / 拖刷选"），所以 axis 只需静态 6 个固定刻度，不必处理动态域。
- 不引入任何外部库；`d3-scale` 单包 ≈ 60KB minified，相比手写 30 行的边际收益可忽略。
