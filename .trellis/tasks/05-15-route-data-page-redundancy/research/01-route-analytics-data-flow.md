# Research: Route Analytics 数据流 / Scope 过滤可行性 / 禁用语义

- **Query**: 综合 Q1 / Q3 / Q10 — `RouteAnalyticsBucket` 的字段可空性、scope 过滤是否可纯靠 bucket 完成、disabled 与 UI 健康分桶的边界
- **Scope**: internal
- **Date**: 2026-05-17
- **基础来源**: 与本目录 `01-bucket-coverage.md`（Phase-1 已写）保持一致，本文件做 Phase-2 PRD 对齐补充

## Q1 · `RouteAnalyticsBucket` provenance

### 唯一写入入口与短路条件

- 写入函数：`recordRouteRequest()`（`src/main/route-analytics-service.ts:299-437`），新桶模板见 `:374-401`。
- 三元组短路（`src/main/route-analytics-service.ts:354-356`）：

  ```ts
  if (!config.enabled) return;
  if (!params.routeRuleId || !params.siteId || !params.accountId) return;
  ```

  → **任何缺 `routeRuleId / siteId / accountId` 的请求都不会写入桶**，仅落入内存日志 `routeRequestLogs`。一旦写桶，三元组必非空。`apiKeyId` 在所有真实写入路径都补齐。

### 8 个 `recordRouteRequest()` 调用点

| 位置 | 上下文 | siteId/accountId/apiKeyId | canonicalModel | cliType | 是否进桶 |
|---|---|---|---|---|---|
| `src/main/route-proxy-service.ts:886` | `geminiCli` 内部工具拦截 | undefined×3 | 可能 null | `geminiCli` | 否 |
| `:917` | `no_matching_rule` | undefined×3 | 可能 null | path 推断 | 否 |
| `:942` | `no_channels` | undefined×3 | 可能 null | path 推断 | 否 |
| `:965` | `all-disabled` 全禁用 | undefined×3 | 可能 null | path 推断 | 否 |
| `:1007` | `credentials_unavailable` | activeChannel.* | 解析后 | path 推断 | 是 |
| `:1118` | adapter `request-adapt` 失败 | activeChannel.* | 解析后 | path 推断 | 是 |
| `:1185` | 正常上游响应 | activeChannel.* | 解析后 | path 推断 | 是 |
| `:1296` | network try/catch | activeChannel.* | 解析后 | path 推断 | 是 |

探针锁定路径（`src/main/route-proxy-service.ts:855-869`，`routeRuleId='__probe_lock__'`）由 `if (!bypassRoutePathState)` 包住的统计调用 `:1167-1208` 跳过，**探针流量不进入 bucket**。

### `cliType` 字面量

`RouteCliType = 'claudeCode' | 'codex' | 'geminiCli'`（`src/shared/types/route-proxy.ts:18`）。`detectCliTypeFromPath()`（`src/main/route-proxy-service.ts:782`）从请求 URL 推断，**不存在 `'custom'` 字面量**。这是 PRD §过滤入口里 `cliType === 'custom'` 措辞的纠正点（详见 `02-custom-cli-integration.md`）。

### `canonicalModel` 可空性

- `:832-848` 三层 fallback：registry alias → raw → CLI default。最差 `null`。
- 写桶时 `params.canonicalModel || undefined`；`buildBucketKey` 缺失时填 `*`（`src/shared/types/route-proxy.ts:638-648`），多条无模型请求共用 `*` 桶。
- 后果：treemap / Sankey 的左节点必须显式过滤掉 `canonicalModel === undefined` 或显示为"未识别模型"，避免与"其他"聚合冲突。

### `siteId` 是否可能缺失（真实流量）

否。所有写入路径对 site/account/key 三元组都已齐全；不齐全的会被 `:354-356` 短路掉。短路掉的失败拦截不计入桶，所以 KPI 失败次数（PRD Row 1）不包含"无规则匹配 / 无通道 / 全禁用 / Gemini 内部工具"四种拦截 — 这一点保持现状即可，不是 PRD 要求重新定义。

## Q3 · scope 过滤可行性

### 选项列表数据源

| 选项 | 来源 | 备注 |
|---|---|---|
| 全部聚合 | 默认 | 无过滤 |
| 各站点 | `config.sites` 中 `enabled === true` 的条目 | `useConfigStore(s => s.config)`，已在 `DataOverviewPage.tsx:1466` 引用 |
| 各自定义 CLI | `useCustomCliConfigStore(s => s.configs)` 全量 | 该 store 已在生产代码中使用，但**测试中未 mock**（详见 `05-state-and-test-baseline.md`） |

实现侧：`scope = { kind: 'all' } | { kind: 'site', siteId } | { kind: 'custom-cli', customCliId }`，过滤 buckets：

```ts
function filterBucketsByScope(buckets: RouteAnalyticsBucket[], scope: Scope): RouteAnalyticsBucket[] {
  if (scope.kind === 'all') return buckets;
  if (scope.kind === 'site') return buckets.filter(b => b.siteId === scope.siteId);
  // custom-cli
  const targetSiteId = buildCustomCliRouteSiteId(scope.customCliId);
  return buckets.filter(b => b.siteId === targetSiteId);
}
```

不需要查 `routePathStates`、不需要看 `cliType`，纯字符串相等比较即可。

### 边界

- 空集后 trend / treemap / scatter / sankey 必须渲染骨架（"暂无数据"）而非崩溃。沿用现有 `RouteTrendHeroCard` 的空态分支模式（`DataOverviewPage.tsx` 内已有"暂无路由分析数据"路径）。
- 自定义 CLI 选项可能包含未发起过任何请求的配置（`configs` 是配置面，不是流量面）。这是合理的：用户切到该 scope 看到全空骨架，立即明白"该 CLI 还没用过"。
- 切 scope 必须 `setSelectedModel(null)`（PRD §联动总线明确）。

### 渲染层是否需要调主进程？

否。`scope` 完全是渲染层 derived state，依赖：

- `routeDistribution.buckets`（已通过 `route:get-analytics-distribution` 拉取，见 `DataOverviewPage.tsx` 现有逻辑）
- `config.sites`
- `customCliConfigStore.configs`

PRD §Out of Scope 明确"主进程新增 IPC"不在范围内，本任务实现侧严格守住该边界。

## Q10 · disabled vs degraded 语义

### 后端只有 `disabledUntil`

- 类型：`RoutePathState.disabledUntil?: number`（`src/shared/types/route-proxy.ts` ；`isRoutePathDisabled` 实现 `src/main/route-stats-service.ts:112-119`）。
- 触发条件：`outcome === 'failure' && successRate < minSuccessRate`（默认值见 `:158-176`）。
- 结束条件：`disabledUntil <= now` 自动失效。
- **没有任何 `degraded` 字段**：`grep -r "degraded" src/` 零命中（实测确认）。

### 前端 UI 健康分桶（仅视觉）

`resolveChannelHealthTone()`（`DataOverviewPage.tsx:1087-1098`）：

```ts
if (isDisabled || successRate < 0.8) → red '<80%'
else if (successRate < 0.95)         → orange '80-95%'
else                                  → green '≥95%'
```

`isDisabled` 来源是 `RoutePathState.disabledUntil > now`。`successRate < 0.8` 来源是 `RoutePathState.successRate`（窗口内统计）。

### 散点 / Sankey 颜色复用是否"撒谎"

不撒谎：

- 散点取自 `RouteAnalyticsBucket` 聚合后的成功率（`successCount / requestCount`），与 `RoutePathState.successRate` 是同一份数据的两种统计窗口。
- 颜色只表达"成功率分桶"，不引入"降级"语义；红色含义保持"<80% 成功率（或后端已禁用）"，与现有 `ChannelHealthList` 等价。
- PRD §Acceptance 第 9 条与 §ADR-lite 一致："仅作 UI 健康分桶，不引入降级 / 禁用语义"。

### Disabled 信息在散点上是否需要单独标记？

PRD 没要求。原 `ChannelHealthList` 在禁用状态显示徽标"已禁用"（`DataOverviewPage.tsx:1116-1146`），新散点可在 hover tooltip 文案里加 `已禁用` 字样（数据可从 `routePathStates` 反查），但**圆点本身的颜色不引入第四档**，避免破坏成功率梯度的视觉契约。这是实现期可选项，不阻塞 MVP。

## Caveats / Not Found

- 未发现任何代码路径让 `siteId` 在写桶时为空字符串（短路兜住了）；前端不需要 `b.siteId ?? '未知'` 防御。
- 探针 `__probe_lock__` 流量不进桶，不影响散点 / Sankey 数据；无需额外过滤。
- 失败拦截类（4 种短路）若想出现在散点，需要消费 `routeRequestLogs` — 不在本任务范围。
