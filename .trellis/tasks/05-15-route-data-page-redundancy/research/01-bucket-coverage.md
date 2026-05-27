# Research: RouteAnalyticsBucket coverage

- **Query**: 对所有写入 RouteAnalyticsBucket 的代码路径，确认 siteId / accountId / apiKeyId / canonicalModel / cliType 的可空性，判断渲染层 scope 过滤是否能纯粹基于 bucket 完成
- **Scope**: internal
- **Date**: 2026-05-17

## Findings

### 唯一写入入口

`RouteAnalyticsBucket` 只在 `recordRouteRequest()`（`src/main/route-analytics-service.ts:299-437`）内创建/累计；新建桶模板见 `src/main/route-analytics-service.ts:374-401`，字段直接映射形参 `siteId / accountId / apiKeyId / canonicalModel / cliType / targetProtocol / routeRuleId`。

### 关键短路：必须三元组齐全才会写桶

`src/main/route-analytics-service.ts:354-356`

```ts
const config = getAnalyticsConfig();
if (!config.enabled) return;
if (!params.routeRuleId || !params.siteId || !params.accountId) return;
```

含义：**任何缺 `routeRuleId / siteId / accountId` 的请求都不会进入 bucket**，只会进入内存日志 `routeRequestLogs`。所以在所有进入 bucket 的桶里，`siteId / accountId` 一定是非空字符串、`routeRuleId` 非空。`apiKeyId` 形参可选，但所有真实写入路径都补齐了它（见下表）。

### 8 个 `recordRouteRequest()` 调用点对比

| 位置 | 上下文 | siteId | accountId | apiKeyId | canonicalModel | cliType | 是否进入 bucket |
|---|---|---|---|---|---|---|---|
| `src/main/route-proxy-service.ts:886` | `shouldBlockGeminiCliInternalUtilityRequest` 拦截 | undefined | undefined | undefined | 来自请求 (可能 null) | geminiCli | 否（短路） |
| `src/main/route-proxy-service.ts:917` | `no_matching_rule` | undefined | undefined | undefined | 可能 null | 来自路径 | 否（短路） |
| `src/main/route-proxy-service.ts:942` | `no_channels` | undefined | undefined | undefined | 可能 null | 来自路径 | 否（短路） |
| `src/main/route-proxy-service.ts:965` | `all-disabled` 全禁用 | undefined | undefined | undefined | 可能 null | 来自路径 | 否（短路） |
| `src/main/route-proxy-service.ts:1007` | `credentials_unavailable` | activeChannel.siteId | activeChannel.accountId | activeChannel.apiKeyId | 解析后 | 来自路径 | 是 |
| `src/main/route-proxy-service.ts:1118` | adapter request-adapt 失败 | activeChannel.siteId | activeChannel.accountId | activeChannel.apiKeyId | 解析后 | 来自路径 | 是 |
| `src/main/route-proxy-service.ts:1185` | 正常上游响应（成功 / 失败 / neutral） | activeChannel.siteId | activeChannel.accountId | activeChannel.apiKeyId | 解析后 | 来自路径 | 是 |
| `src/main/route-proxy-service.ts:1296` | `try` 抛异常的网络错误 | activeChannel.siteId | activeChannel.accountId | activeChannel.apiKeyId | 解析后 | 来自路径 | 是 |

参考：探针锁定路径见 `src/main/route-proxy-service.ts:855-869`，使用 `routeRuleId = '__probe_lock__'`，三元组都有。但 `bypassRoutePathState = Boolean(probeLock)` 时第 1167-1208 行的 `recordRouteRequest()` 不会被调用（包在 `if (!bypassRoutePathState)` 块内）；探针锁定流量不进入 bucket。

### 自定义 CLI 路径

- `cliType` 由 `detectCliTypeFromPath(pathname)` 推断（`src/main/route-proxy-service.ts:782`），始终是 `'claudeCode' | 'codex' | 'geminiCli'` 之一。**`RouteCliType` 类型本身没有 `'custom'` 值**（见 `src/shared/types/route-proxy.ts:18`）。即自定义 CLI 通道写入的 bucket，`cliType` 也是上游目标 CLI 协议而非 `'custom'`。
- `siteId / accountId / apiKeyId` 在自定义 CLI 通道下使用合成 id `custom-cli-site-<urlencoded id>` / `custom-cli-account-<...>` / `custom-cli-key-<...>`（见 `src/main/custom-cli-config-service.ts:50-60`）。这些合成 id 由 `src/main/route-model-registry-service.ts:575-577` 的 `RouteModelSourceRef` 写入，再被 `buildCanonicalModelChannels()` 透传到 `ResolvedChannel`（`src/main/route-channel-resolver.ts:520-523`），最终传给 `recordRouteRequest()`。

### canonicalModel 字段

`src/main/route-proxy-service.ts:832-848` 显示 `canonicalModel` 永远尝试三层 fallback：registry alias → raw → CLI 默认模型。即便都失败它也会是 `null`。`recordRouteRequest()` 进入 bucket 时存为 `params.canonicalModel || undefined`，所以 bucket 里 `canonicalModel` 字段可能是 `undefined`（未匹配到任何 raw / registry / 默认）。`buildBucketKey` 在 `canonicalModel` 缺失时填 `*`（`src/shared/types/route-proxy.ts:638-648`），所以多条无模型请求会共用同一个 `*` bucket。

### 结论：渲染层 scope 过滤的可行性

- **纯 bucket 即可完成**：scope = site / 自定义 CLI 都能直接由 `bucket.siteId` 字符串前缀匹配（`'custom-cli-site-' + encodeURIComponent(id)`）实现，无需任何 path-state 反查。这与 PRD 描述一致。
- **不可行的过滤维度**：失败拦截类（无规则匹配 / 无通道 / 全禁用 / Gemini 内部工具）的失败次数**不会出现在 bucket**。如果 PRD 的 Row 1 KPI"失败次数"想包含这些拦截，必须额外消费 `routeRequestLogs`；但当前实现已经接受 KPI 失败次数仅来自 bucket（`getAnalyticsSummary` 来自 bucket 累加，见 `src/main/route-analytics-service.ts:464-507`），保持现状即可。
- **PRD 措辞修正**：原文 `cliType === 'custom'` 不成立。判定自定义 CLI 应改用 `bucket.siteId.startsWith('custom-cli-site-')`（与 `LogsPage.tsx:224` 现有逻辑保持一致）。

## Caveats / Not Found

- 未发现 `route-stats-service.ts` 写入 bucket（它只维护 `RouteChannelStats` / `RoutePathState`），所以 `routePathStates` 与 bucket 是两套独立数据，渲染层无需混用。
- 探针锁定（`__probe_lock__`）流量不进入 bucket，因此 scope 过滤遇到该 routeRuleId 的桶可以忽略；目前只有真实代理流量才会贡献到分析。
