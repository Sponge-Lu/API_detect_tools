# Research: Sankey implementation choice

- **Query**: 现有依赖是否已包含 sankey 能力？若无，d3-sankey 与自实现孰优？
- **Scope**: mixed (internal package check + external bundle estimate)
- **Date**: 2026-05-17

## Findings

### 现有依赖（`package.json`）

`dependencies`：`@iarna/toml / @tanstack/react-virtual / axios / electron-log / pinyin-pro / puppeteer-core / webdav / zod / zustand`
`devDependencies` 涉及 UI：`react / react-dom / lucide-react / tailwindcss / clsx`

`package-lock.json` 中 `grep "node_modules/(d3-sankey|d3-shape|recharts|@visx|@nivo)"` 零命中。**没有任何图表库**（连 d3-shape / d3-array 都没有）。

### 选项 A：引入 `d3-sankey`

- npm 当前最新版 `d3-sankey@0.12.3`（截至 2024）。
- minified+gzip 大小（bundlephobia 历史值）：核心包约 4-6KB gzip / 18KB min。但其依赖：
  - `d3-array` ≈ 6 KB gzip
  - `d3-shape` ≈ 8 KB gzip（用于流带 path）
- 累计：≈ 18-22 KB gzip / 60-80 KB min。
- 引入意味着第一次为本项目引入 d3 体系。后续散点 / 趋势图若不再扩展，d3 90% 能力闲置。
- 类型：需要 `@types/d3-sankey`。
- 风险：electron renderer (Vite + esbuild) 兼容良好，但 ESM-only 与 commonjs 互操作需 Vite `optimizeDeps`。对 hot reload 影响极小。

### 选项 B：自实现 SVG sankey

- 节点数：左 ≤ 6（模型）右 ≤ 8（通道），最大 6×8 = 48 流带。完全二部图，**无需层次布局算法**，无需消除交叉。
- 每节点 y 位置：节点高度 ∝ 节点入/出权重，垂直堆叠。
- 流带：贝塞尔三次曲线 `C` 命令，与 d3-sankey-link 同结构（仅 1 个 `path` per 流）。
- 关键工作量预估：
  - 节点权重聚合 + 排序 + Top-N 截断 + "其他"合并：30-40 行（PRD 已规划 `routeSankey.ts`）
  - 节点 y 布局：20 行（累加 + gap）
  - 流带 path 生成（每条流在源/目标节点上按权重切片）：30-40 行
  - SVG 渲染（节点矩形 + 流带 + label）：50-70 行
  - hover / 选中态：20-30 行
- 总计：**150-210 行**（包括 React 组件 + 工具函数）。

### 推荐：**选项 B（自实现）**

理由：

1. **场景边界明确**：完全二部图 + 无交叉 + 节点数固定上限 6/8。这是 d3-sankey 的退化形态，复杂层次/分层/反向边的能力都用不上。
2. **Bundle 体积**：18-22KB gzip 增量 vs 自实现 ~6KB（含其他散点 / 轴工具），差距显著。Electron 包虽不在意 KB，但首屏 JS 解析时间在 1300×800 的低端开发机上仍可感知。
3. **代码风格契约**：项目 CLAUDE.md 明确"精简高效、毫无冗余"，且仓库内现有所有图表都是手写 SVG（`Sparkline / squarifiedTreemap / ChannelHealthList / DotMatrixChart`），引入 d3 偏离既有风格。
4. **维护成本**：自实现可与 `routeScatter.ts / routeLogAxis.ts` 共用工具（坐标换算、颜色 token、`resolveChannelHealthTone` 重用），形成一套自治的渲染层图元体系。
5. **可读性**：本场景下 d3-sankey 的 API（`sankey() / sankeyLinkHorizontal()`）对非 d3 用户而言学习曲线高于 100 行直白 SVG。

### 自实现关键算法骨架

```ts
// routeSankey.ts
export interface SankeyNode { id: string; label: string; weight: number; side: 'left' | 'right'; }
export interface SankeyLink {
  sourceId: string; targetId: string;
  weight: number;
  successRate: number;      // 用于上色（绿/橙/红，复用 resolveChannelHealthTone）
}

export interface SankeyData {
  leftNodes: SankeyNode[];   // ≤ 6 + 1 "其他"
  rightNodes: SankeyNode[];  // ≤ 8 + 1 "其他"
  links: SankeyLink[];
}

// 1) 聚合 buckets → (canonicalModel, channelKey) → { weight, successRate }
// 2) 对模型按 weight 取 Top-6，多余合并为"其他"（左节点）
// 3) 对通道按 weight 取 Top-8，多余合并为"其他"（右节点）
// 4) 重新计算每条流（包含落入"其他"的）权重与加权成功率
export function buildSankeyData(buckets: RouteAnalyticsBucket[]): SankeyData;

// 渲染层：
// nodeRect = { x, y, width, height }，y 从顶部累加 weight*scale + gap
// linkPath = bezier(C) 从源节点右边 (sourceX1, sourceY) 到目标节点左边 (targetX0, targetY)
//   控制点 = (sourceX1 + (targetX0-sourceX1)*0.5, sourceY) 与 (sourceX1 + (targetX0-sourceX1)*0.5, targetY)
// 节点内的"流带切片 y 偏移"：源/目标节点内按权重累加（与 d3-sankey 同款）
```

### 联动行为实现

- `selectedModel` 来自父组件 state（`routeOverviewView`）。
- 渲染时 `link.opacity = selectedModel == null ? 0.6 : link.sourceId === selectedModel ? 0.9 : 0.15`。
- 左节点 `<rect onClick>` → 父组件 `setSelectedModel(prev => prev === id ? null : id)`，与 treemap 共享同一回调。

## Caveats / Not Found

- 若日后扩展到多层（模型 → CLI → 通道）则需要重新评估 d3-sankey；当前 PRD 明确两层，不存在扩展压力。
- 流带颜色梯度（PRD §Row 3 "流带颜色 = 该流成功率梯度"）若想做线性渐变，可用 `<linearGradient>` per-link，性能可接受（≤ 48 个）；或简化为离散三档（绿 / 橙 / 红），与散点保持一致 — 推荐后者以降低渲染开销并对齐配色语义。
- `@types/d3-sankey` 与 d3 主版本对齐需检查；自实现完全无类型外部依赖。
