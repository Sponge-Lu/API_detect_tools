# Research: 状态放置 + 测试基线

- **Query**: Q8 / Q9 — `scope` / `selectedModel` 应该进 Zustand 还是留 local state；现有 `data-overview-page.test.tsx` 覆盖范围 + 改写清单
- **Scope**: internal
- **Date**: 2026-05-17
- **基础来源**: 与本目录 `06-existing-test-coverage.md`（Phase-1 已写）保持一致；状态决策为 Phase-2 新增

## Q8 · 状态管理决策

### 项目契约

`.trellis/spec/frontend/state-management.md` 明确（第 73-89 行）：

> Local component/page state — Keep local React state when the state is:
> - only used by one page
> - short-lived
> - purely presentational
> - too specific to justify polluting a global store

并列出反例（第 148-154 行）：

> Common Mistakes — Do not move page-only state into a global store just because the page is large.

### 现有 `view === 'route'` 的本地状态

`DataOverviewPage.tsx` 路由子页本地 state 已包括：

- `routeWindow: '24h' | '7d'`（PRD §联动总线第 1 项明确"沿用"）
- `routeSummary / routeDistribution / routeObjectStats / activePathStates` 等数据
- `latencyPercentiles`（derived useMemo）

新增的 `scope / selectedModel`：

- 仅 `RouteOverviewView` 子组件读取（PRD §Technical Approach 已规划拆分该子组件）
- 无跨页消费需求（站点子页不消费、其他页面无引用）
- 切 tab / 关页面应丢弃（PRD 没有要求持久化或跨会话恢复）
- 切 scope 触发 `setSelectedModel(null)`（PRD §联动总线明确）— 这种单向重置在父组件内 `useEffect` 处理最简单
- 切 scope 不触发 IPC（数据已经在 buckets 里），是纯 derived UI state

→ **符合 spec 中"keep local"的全部条件**。

### 决策：local state in `RouteOverviewView`

```tsx
// src/renderer/pages/DataOverviewPage.tsx 内拆出
function RouteOverviewView({ /* props from parent */ }) {
  const [routeWindow, setRouteWindow] = useState<'24h' | '7d'>('24h');
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  // 切 scope 自动重置 selectedModel
  useEffect(() => { setSelectedModel(null); }, [scope.kind, scope.kind === 'site' ? scope.siteId : scope.kind === 'custom-cli' ? scope.customCliId : null]);

  // 各图表数据 useMemo 依赖 [routeDistribution.buckets, scope, selectedModel]
}
```

### 不进 Zustand 的具体理由

- 不在 `routeStore.ts`：该 store 持有 `RoutingConfig / cliProbe*`，是路由功能后端配置面，与"数据总览的视图状态"语义不同。混入会让 store 边界模糊。
- 不开新 `routeOverviewStore.ts`：单页 ephemeral state，没有跨组件 / 跨页 / 持久化需求。新开 store 等于违反 spec 第 150 行反例。
- `useRouteStore` 在生产代码 `DataOverviewPage` 中实际未被消费（`grep` 确认），现有 `mockRouteConfig` 只是测试占位，可在新版测试中保留或删除。

## Q9 · 测试基线

### 测试文件

`src/__tests__/data-overview-page.test.tsx`（796 行），共 7 个 `it` block。

### 已有用例处置

| # | 行号 | 标题（截断） | 处置 | 原因 |
|---|---|---|---|---|
| 1 | :408-454 | filters negative account balances when building site overview metrics | **保留** | 纯函数测试，与路由子页无关 |
| 2 | :456-553 | renders site and route overview panels from shared overview subtab state | **重写** | 5 处断言失效（详见下方） |
| 3 | :555-585 | provides header actions from shared overview subtab state | **保留** + 小改 | 若 scope 下拉做在卡内则不动；若放 header 则需扩 |
| 4 | :587-606 | reloads overview data automatically after route overview change events | **保留** + 小改 | 删 `expect(getObjectStats).toHaveBeenCalledTimes(2)` |
| 5 | :608-652 | uses live today request totals when snapshots lag behind current site metrics | **保留** | 站点子页用例 |
| 6 | :654-774 | renders trend markers as fixed-size circles and keeps token matrix dots visible | **部分重写** | `:753-773` 路由趋势断言基于现有 RouteTrendHeroCard 三 sparkline 堆叠；新版 DOM 变化 |
| 7 | :776-795 | truncates long site names in checkin rows to seven chinese-character widths | **保留** | 签到子页 |

### 用例 #2 必删断言（具体行号）

- `:524` `screen.getByText('活跃对象')` — `RouteObjectStatsList` 删除
- `:526, :537` 通道健康矩阵相关 — `ChannelHealthList` 删除
- `:535` `延迟分位数` 文案 — 第 4 张 KPI 改为 TTFB P95 + 端到端 P99
- `:538-542` `expect(getObjectStats).toHaveBeenCalledWith(...)` — IPC 不再调用
- `:547-551` 活跃对象列表项断言

### 用例 #2 必加断言

- 4 张 KPI 卡均存在（请求量 / 成功率 / Tokens / TTFB+P99）
- TTFB 主值 + P99 副值同时渲染
- 范围下拉至少展示「全部聚合」+ 启用站点 + 自定义 CLI 选项
- 模型 treemap 渲染至少 1 格
- Sankey 至少渲染 1 个左节点 + 1 个右节点 + 1 条流带
- 散点至少渲染 1 个 `<circle>`

### 必新增用例（PRD §Definition of Done 要求）

1. **scope=site 过滤**：mock customCliConfigs + buckets，下拉切到 siteId，断言 trend / treemap / scatter / sankey 数据均基于该 site 子集
2. **scope=custom-cli 过滤**：用合成 `siteId = 'custom-cli-site-' + encodeURIComponent(id)`（与 `buildCustomCliRouteSiteId` 对齐）
3. **selectedModel 联动重置**：先点击模型 → 切 scope → 断言 `selectedModel === null`
4. **selectedModel 双向联动**：treemap 点击 → 散点高亮 + sankey 流过滤；Sankey 左节点点击 → treemap 同模型选中态
5. **selectedModel 取消选中**：点击同模型 / treemap 空白 → 还原
6. **Sankey 聚合**：超 6 模型 → 「其他」；超 8 通道 → 「其他」
7. **散点 log 轴**：给定 firstByteHistogram，断言渲染出的 `cx` 落在 log scale 预期区间（粗粒度 `cx > 0 && cx < width`）
8. **散点引线标签**：默认 4 条；选具体 scope 后该 scope 涉及通道恒亮
9. **TTFB KPI 双值**：第 4 张既渲染主值 P95 又渲染副值 P99 + 样本数

### Mock 适配

- **必须新增** `vi.mock('../renderer/store/customCliConfigStore')`（生产代码已经依赖 `useCustomCliConfigStore(state => state.configs)`，目前测试侥幸通过因为该 hook 走真实路径拿到默认 `configs: []`；新版本依赖 customCli 列表过滤后必须 mock）
- `getConfig` mock 仍可保留 `routePathStates`，散点 hover 标签可能借 `lastError`（非 PRD 必需）
- `getObjectStats` mock 可继续存在保持 IPC 兼容（向后兼容），但用例**不再断言**其被调用
- **必须新增** buckets fixture：`siteId = 'custom-cli-site-cfg-1'` 至少 1 条，覆盖自定义 CLI 流量路径（`cliType` 仍为 `claudeCode/codex/geminiCli`）

### Vitest 设置

- `src/__tests__/setup.ts` 提供全局 mock（已有）
- `package.json` `test` → `vitest run`，`test:watch` → `vitest`，单文件 `npx vitest run src/__tests__/data-overview-page.test.tsx`
- `vi.mock('../renderer/pages/DataOverviewPage', ...)` 不需要；直接 mock `window.electronAPI` 与 stores
- React Testing Library + `screen.getByText` 风格已有，沿用

## Caveats / Not Found

- 现有 `mockRouteConfig` 走 `useRouteStore` 但 `DataOverviewPage` 实际从 `getConfig` IPC 拉规则名单（`useRouteStore` 未被消费），重写时可考虑去 mock 或保留作占位。
- 现有 buckets mock 中 bucket #2 `routeRuleId: undefined`（`:201`）— 与生产 `recordRouteRequest` 短路逻辑（必须有 `routeRuleId`）矛盾，但仅是测试 fixture，渲染端不会过滤掉；可保留作"边界 fixture"。
- 无现有"heatmap colorScale"断言；改用成功率梯度后无需修改对应测试，仅需确认 `data-*` 属性 / inline `style` 上色不破坏可访问性查询。
