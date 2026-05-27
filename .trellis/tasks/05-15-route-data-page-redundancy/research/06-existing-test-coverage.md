# Research: Existing test coverage for DataOverviewPage

- **Query**: 现有 `data-overview-page.test.tsx` 覆盖了哪些行为？哪些 mock 必须保留 / 修改？哪些用例需重写？
- **Scope**: internal
- **Date**: 2026-05-17

## Findings

### 已有用例清单（共 6 个 it block）

文件：`src/__tests__/data-overview-page.test.tsx`（796 行）

| # | 行号 | 用例标题 | 覆盖范围 |
|---|---|---|---|
| 1 | :408-454 | filters negative account balances when building site overview metrics | 仅测试 `buildSiteOverviewMetrics`，不渲染路由数据子页 |
| 2 | :456-553 | renders site and route overview panels from shared overview subtab state | 站点子页 + 路由子页主渲染断言（含活跃对象、模型热力、通道健康、KPI、object-stats 调用） |
| 3 | :555-585 | provides header actions from shared overview subtab state | header 上的窗口切换按钮（24h/7d）渲染 |
| 4 | :587-606 | reloads overview data automatically after route overview change events | `appData.onChanged('route-overview')` 触发重拉 |
| 5 | :608-652 | uses live today request totals when snapshots lag behind current site metrics | 站点趋势卡的"今日实时"补丁（与路由子页无关） |
| 6 | :654-774 | renders trend markers as fixed-size circles and keeps token matrix dots visible | SiteTrendCard / Sparkline 内部细节 + 路由趋势 |
| 7 | :776-795 | truncates long site names in checkin rows to seven chinese-character widths | 站点签到行截断（与路由子页无关） |

### Mock 形态

**全局 store mocks**（`:128-141`）：
- `useConfigStore` → `{ config: mockConfig }`
- `useRouteStore` → `{ config: mockRouteConfig, loading: false }`
- `useUIStore` → `mockUIState`（`activeTab / overviewSubtab / setOverviewSubtab`）

**重要**：当前测试**未 mock `useCustomCliConfigStore`**，但生产代码 `DataOverviewPage.tsx:1466` 已经引用 `useCustomCliConfigStore(state => state.configs)`。这导致测试中该 hook 走真实路径（拿到默认 store 状态 `configs: []`），目前侥幸通过；新版本若依赖 customCli 列表过滤，必须在测试中 mock 该 store。

**`window.electronAPI.route` mocks**（`:156-351`）：
- `getAnalyticsSummary`（:158-170）— `{ totalRequests / successCount / failureCount / successRate / promptTokens / completionTokens / totalTokens }`
- `getAnalyticsDistribution`（:171-288）— 5 条 buckets，覆盖 claude/codex/gemini 三种 cliType，含完整 `firstByteHistogram / latencyHistogram / statusCodeHistogram`
- `getObjectStats`（:289-311）— **路由数据子页待删除**（PRD §删除项 "不再使用：`route:get-object-stats` 调用"）
- `getRequestLogs`（:312-315）
- `getConfig`（:316-350）— 返回 `routePathStates` + `rules`，用于活跃对象与规则映射

**`window.electronAPI.overview`** 与 **`window.electronAPI.appData`**（:353-405）— 与路由数据子页耦合极弱（站点快照走 overview，appData 走事件总线）。

### 测试影响地图

| 用例 | 操作 | 原因 |
|---|---|---|
| #1 (`filters negative account balances`) | **保留** | 纯函数测试，与路由子页无关 |
| #2 (`renders site and route overview panels`) | **重写** | 5 处断言失效：<br>• `:524` `screen.getByText('活跃对象')` — `RouteObjectStatsList` 删除<br>• `:526, 537` 通道健康矩阵 — `ChannelHealthList` 删除<br>• `:538-542` `expect(getObjectStats).toHaveBeenCalledWith(...)` — IPC 调用删除<br>• `:535` `延迟分位数` 需替换为 `TTFB P95 / P99` 双值<br>• `:547-551` 活跃对象列表项断言全部删除<br>新增断言：4 KPI 卡 / scope 下拉 / treemap 点击 / Sankey 节点 / 散点图 |
| #3 (`provides header actions`) | **保留**（小改） | header 仅展示窗口按钮，路由子页 header 行为可能不变；若新增 scope 下拉移到 header，则需扩 |
| #4 (`reloads overview data automatically`) | **保留**（小改） | `expect(getObjectStats).toHaveBeenCalledTimes(2)` 需删除 |
| #5 (`uses live today request totals`) | **保留** | 站点子页用例 |
| #6 (`renders trend markers as fixed-size circles`) | **部分重写** | `:753-773` 路由趋势部分断言基于现有 RouteTrendHeroCard 三 sparkline 堆叠；新版改成"成功率面积+TTFB 折线+灰柱+底部红点"后，DOM 结构变化，相关 markers / paths 断言需重写 |
| #7 (`truncates long site names`) | **保留** | 站点签到子页 |

### 必须新增的测试用例（PRD §Definition of Done "scope 过滤、selectedModel 联动重置、Sankey 聚合"）

1. **scope=site 过滤**：mock customCliConfigs + buckets，切换 scope 下拉到具体 siteId，断言 trend / treemap / scatter / sankey 数据都基于该 site 子集。
2. **scope=custom-cli 过滤**：使用合成 `siteId = custom-cli-site-<encodeURIComponent(id)>`（与 `buildCustomCliRouteSiteId` 对齐）。
3. **selectedModel 联动重置**：先点击模型 → 切换 scope → 断言 `selectedModel` 被重置为 null。
4. **selectedModel 双向联动**：treemap 点击 → 散点高亮 + sankey 流过滤；Sankey 左节点点击 → treemap 同模型选中态。
5. **selectedModel 取消选中**：点击同模型 / treemap 空白处 → 还原。
6. **Sankey 聚合**：超过 6 个模型 → "其他"；超过 8 通道 → "其他"。
7. **散点图 log 轴**：给定 firstByteHistogram，断言渲染出的 cx 落在 log scale 预期区间（粗粒度断言：`cx > 0` 且 `cx < width`）。
8. **散点图引线标签**：默认 4 条；选中具体 scope 后该 scope 涉及通道恒亮。
9. **TTFB KPI 双值**：第四张 KPI 既渲染主值 P95 又渲染副值 P99 + 样本数。

### Mock 适配清单

- 必须新增 `vi.mock('../renderer/store/customCliConfigStore')`（生产代码已依赖，本就缺）。
- `getConfig` 仍要返回 `routePathStates`（散点 hover 标签可能要 lastError；但 PRD 明确散点直接消费 buckets，故此 mock 可继续保留但断言可以放宽）。
- `getObjectStats` mock 可保留（向后兼容），但用例不再断言其被调用。
- 新增 buckets：用 `siteId = 'custom-cli-site-cfg-1'` 的桶来覆盖自定义 CLI 流量路径（cliType 仍为 `claudeCode/codex/geminiCli`）。

## Caveats / Not Found

- 现有测试用 `mockRouteConfig` 走 `useRouteStore`，但 `DataOverviewPage` 实际从 `getConfig` IPC 拉规则名单，`useRouteStore` 几乎未被消费 — 重写时可考虑去除该 mock 或保留作占位。
- 现有 buckets mock 中 bucket #2 `routeRuleId: undefined`（`:201`）— 与生产 `recordRouteRequest` 短路逻辑（必须有 `routeRuleId`，见 01-bucket-coverage 研究）矛盾，但仅是测试 fixture，渲染端不会过滤掉。新版同样可保留作"边界 fixture"。
- 没有针对"层级图（heatmap colorScale）"的现有断言；改用成功率梯度后无需修改对应测试，仅需确认 `data-*` 属性或 inline `style` 上色不破坏可访问性查询。
