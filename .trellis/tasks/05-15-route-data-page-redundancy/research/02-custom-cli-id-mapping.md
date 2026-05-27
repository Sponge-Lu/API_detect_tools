# Research: Custom CLI synthetic id mapping

- **Query**: 自定义 CLI 在 bucket 里的合成 id 何处生成？是否携带 `cliType === 'custom'`？渲染层从 customCliConfig.id 反推合成 id 应使用什么 helper？
- **Scope**: internal
- **Date**: 2026-05-17

## Findings

### 合成 id 的唯一生成来源

`src/main/custom-cli-config-service.ts:29-60`：

```ts
const CUSTOM_CLI_ROUTE_ID_PREFIX = 'custom-cli';
const CUSTOM_CLI_ROUTE_SITE_PREFIX = `${CUSTOM_CLI_ROUTE_ID_PREFIX}-site-`;
const CUSTOM_CLI_ROUTE_ACCOUNT_PREFIX = `${CUSTOM_CLI_ROUTE_ID_PREFIX}-account-`;
const CUSTOM_CLI_ROUTE_API_KEY_PREFIX = `${CUSTOM_CLI_ROUTE_ID_PREFIX}-key-`;

function encodeCustomCliConfigId(configId: string): string {
  const normalized = configId.trim();
  return encodeURIComponent(normalized || 'unknown');
}

export function buildCustomCliRouteSiteId(configId: string): string {
  return `${CUSTOM_CLI_ROUTE_SITE_PREFIX}${encodeCustomCliConfigId(configId)}`;
}
export function buildCustomCliRouteAccountId(configId: string): string { /* ... */ }
export function buildCustomCliRouteApiKeyId(configId: string): string { /* ... */ }

export function parseCustomCliRouteConfigId(siteId: string): string | null { /* 仅 siteId */ }
export function isCustomCliRouteChannel(siteId, accountId, apiKeyId): boolean { /* ... */ }
```

合成 id 流入 bucket 的链路：

1. `src/main/route-model-registry-service.ts:575-605` 在 `aggregateRouteModelRegistry()` 内为每个 `customConfig` 调用 `buildCustomCliRouteSiteId / buildCustomCliRouteAccountId / buildCustomCliRouteApiKeyId`，写入 `RouteModelSourceRef.siteId / accountId / availableApiKeys[].apiKeyId` 与 `sourceType: 'customCli'`。
2. `src/main/route-channel-resolver.ts:418-448` 在 `buildCanonicalModelChannels()` 复制这三段 id 到 `channelGroups`。
3. `src/main/route-channel-resolver.ts:520-535` 把它们装进 `ResolvedChannel`。
4. `src/main/route-proxy-service.ts:1185-1208` 在 `recordRouteRequest({ siteId: activeChannel.siteId, accountId: activeChannel.accountId, apiKeyId: activeChannel.apiKeyId, ... })` 把合成 id 写入 bucket。

### 子问题答复

**(a) `RouteAnalyticsBucket.siteId / accountId` 是否携带合成 id？**

是。运行时从 `ResolvedChannel` 透传，bucket 中的字段与 `buildCustomCliRouteSiteId(customCli.id)` 等返回值完全一致。`apiKeyId` 同样为 `buildCustomCliRouteApiKeyId(customCli.id)`。

**(b) 自定义 CLI 桶的 `cliType` 是否为 `'custom'`？**

否。`RouteCliType` 仅 `'claudeCode' | 'codex' | 'geminiCli'`（`src/shared/types/route-proxy.ts:18`）。`cliType` 由 `detectCliTypeFromPath(pathname)`（`src/main/route-proxy-service.ts:782`）从请求 URL 决定，反映客户端 CLI 协议；自定义 CLI 配置只能搭配这三种协议中的一种，**永远不会写入字符串 `'custom'`**。判定一个 bucket 来自自定义 CLI 必须用 `siteId.startsWith('custom-cli-site-')` 或调用 `parseCustomCliRouteConfigId(bucket.siteId) !== null`。

**(c) 渲染层 customCli.id ↔ 合成 id 的现成 helper？**

主进程已有：

- 正向：`buildCustomCliRouteSiteId(configId)` / `buildCustomCliRouteAccountId(configId)` / `buildCustomCliRouteApiKeyId(configId)`（`src/main/custom-cli-config-service.ts:50-60`）
- 反向：`parseCustomCliRouteConfigId(siteId)` 只接受 siteId，不接受 accountId/apiKeyId（`src/main/custom-cli-config-service.ts:62-68`）
- 三元组判定：`isCustomCliRouteChannel(siteId, accountId, apiKeyId)`（同文件 :70-84）

**渲染层暂无对应 helper**。`src/renderer/pages/DataOverviewPage.tsx:1631-1633` 与 `src/renderer/pages/LogsPage.tsx:224` 都是手写字符串拼接 / 前缀判定，没有共享工具。

### 推荐做法（渲染层最小补丁）

将 `src/main/custom-cli-config-service.ts:29-84` 的纯字符串 helper 抽到 `src/shared/utils/customCliRouteId.ts`（新增），由两侧导入。改动最小、零运行时风险：

```ts
// src/shared/utils/customCliRouteId.ts
const PREFIX = 'custom-cli';
export const CUSTOM_CLI_SITE_PREFIX = `${PREFIX}-site-`;
export const CUSTOM_CLI_ACCOUNT_PREFIX = `${PREFIX}-account-`;
export const CUSTOM_CLI_API_KEY_PREFIX = `${PREFIX}-key-`;

const encode = (id: string) => encodeURIComponent(id.trim() || 'unknown');

export const buildCustomCliRouteSiteId = (id: string) => `${CUSTOM_CLI_SITE_PREFIX}${encode(id)}`;
export const buildCustomCliRouteAccountId = (id: string) => `${CUSTOM_CLI_ACCOUNT_PREFIX}${encode(id)}`;
export const buildCustomCliRouteApiKeyId = (id: string) => `${CUSTOM_CLI_API_KEY_PREFIX}${encode(id)}`;

export function parseCustomCliRouteConfigId(siteId: string): string | null {
  if (!siteId.startsWith(CUSTOM_CLI_SITE_PREFIX)) return null;
  try {
    return decodeURIComponent(siteId.slice(CUSTOM_CLI_SITE_PREFIX.length)).trim() || null;
  } catch { return null; }
}

export const isCustomCliRouteSiteId = (siteId?: string) =>
  typeof siteId === 'string' && siteId.startsWith(CUSTOM_CLI_SITE_PREFIX);
```

`src/main/custom-cli-config-service.ts` 改为 `re-export` 即可保持向后兼容。

### scope 过滤模式（PRD 要求）

`scope = { kind: 'custom-cli', customCliId }` 的实现：

```ts
const targetSiteId = buildCustomCliRouteSiteId(customCliId);
const filtered = buckets.filter(b => b.siteId === targetSiteId);
```

不需要遍历 `cliType`，也不需要查询任何 path state；只用合成 siteId 字符串相等比较即可。

## Caveats / Not Found

- 没有出现 `'custom'` 作为 `RouteCliType` 字面量的代码路径——PRD §过滤入口里写的 `cliType === 'custom' + customCliId` 应当改写为 `siteId === buildCustomCliRouteSiteId(customCliId)`。
- 注意 `encodeURIComponent` 是非幂等输入但幂等输出：renderer 现行 `encodeURIComponent(customCli.id)`（`DataOverviewPage.tsx:1631`）与主进程使用同一编码，结果一致。需要避免对原始 `customCli.id` 做二次 encode。
