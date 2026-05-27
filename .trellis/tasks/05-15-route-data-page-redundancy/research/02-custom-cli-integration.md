# Research: Custom CLI 数据模型与端到端 ID 链路

- **Query**: Q2 — 自定义 CLI 配置形态、注册表里的虚拟 channel、合成 id 端到端约定、是否走代理产生分析数据
- **Scope**: internal
- **Date**: 2026-05-17
- **基础来源**: 与本目录 `02-custom-cli-id-mapping.md`（Phase-1 已写）保持一致，本文件做 Phase-2 PRD 对齐补充

## CustomCliConfig 类型

`src/shared/types/custom-cli-config.ts:74-99`：

```ts
export interface CustomCliConfig {
  id: string;             // 唯一标识（运行时随机）
  name: string;           // 用户可改的显示名（PRD scope 下拉的 label 来源）
  baseUrl: string;        // 上游 API
  apiKey: string;
  models: string[];       // 拉取到的模型列表（不参与代理统计）
  lastModelFetch?: number;
  notes?: string;
  cliSettings: {
    claudeCode: CustomCliSettings;
    codex: CustomCliSettings;
    geminiCli: CustomCliSettings;
  };
  createdAt: number;
  updatedAt: number;
}
```

Store 形态：`src/renderer/store/customCliConfigStore.ts`

- `configs: CustomCliConfig[]`（多个并存，无上限）
- `activeConfigId: string | null`（当前应用到 CLI 的配置）
- 持久化路径：`window.electronAPI.customCliConfig.load/save`

## 自定义 CLI 与「自定义 CLI 页」的范围

PRD 中"自定义 CLI"专指上述 `CustomCliConfig`，其 UI 入口：

- 页面：`src/renderer/pages/CustomCliPage.tsx`
- IPC：`src/main/handlers/custom-cli-config-handlers.ts`
- 主进程服务：`src/main/custom-cli-config-service.ts`

**与 `RouteCliType` 区分**：`RouteCliType ∈ { 'claudeCode', 'codex', 'geminiCli' }`，是协议；`CustomCliConfig` 是用户给该协议指定的目标上游配置。**不是同一个概念**。

**与 CLI 兼容性测试条目区分**：CLI 兼容性测试由 `RouteCliProbeSample / cli-compat-service.ts` 驱动（`routeStore.cliProbeLatest`），与 `CustomCliConfig` 无关。

## 注册表：虚拟 channel 接入点

`src/main/route-model-registry-service.ts:575-605`，`aggregateRouteModelRegistry()` 遍历 `customConfigs`：

```ts
for (const customConfig of customConfigs) {
  const sourceRef: RouteModelSourceRef = {
    sourceType: 'customCli',
    siteId: buildCustomCliRouteSiteId(customConfig.id),
    accountId: buildCustomCliRouteAccountId(customConfig.id),
    availableApiKeys: [{
      apiKeyId: buildCustomCliRouteApiKeyId(customConfig.id),
      ...
    }],
    ...
  };
  // 把模型 alias / canonical 加入 entries
}
```

→ 在注册表里，自定义 CLI 用 `sourceType: 'customCli'` 标识，三个 ID 字段全部使用 `buildCustomCliRoute*Id(customConfig.id)` 合成。

## ID 链路全景（end-to-end）

```
CustomCliConfig.id (runtime 随机字符串)
       │
       │  buildCustomCliRouteSiteId(id) = "custom-cli-site-" + encodeURIComponent(id)
       │  buildCustomCliRouteAccountId(id) = "custom-cli-account-" + encodeURIComponent(id)
       │  buildCustomCliRouteApiKeyId(id) = "custom-cli-key-" + encodeURIComponent(id)
       ▼
RouteModelSourceRef { siteId, accountId, availableApiKeys[].apiKeyId }
src/main/route-model-registry-service.ts:575-605
       │
       │  buildCanonicalModelChannels()
       ▼
ChannelGroup → ResolvedChannel { siteId, accountId, apiKeyId }
src/main/route-channel-resolver.ts:418-535
       │
       │  代理转发并 recordRouteRequest({ siteId: activeChannel.siteId, ... })
       ▼
RouteAnalyticsBucket { siteId, accountId, apiKeyId, canonicalModel, cliType, routeRuleId }
src/main/route-proxy-service.ts:1185-1208 → src/main/route-analytics-service.ts:299-437
       │
       │  同样写入 routePathStates
       ▼
RoutePathState { siteId, accountId, apiKeyId, ... }
src/main/route-stats-service.ts:130-200
```

`DataOverviewPage.tsx:1628-1634` 现有逻辑用同样的 `custom-cli-site-${encodeURIComponent(customCli.id)}` 构造 lookup map，名称解析到 `customCli.name`。

## 关键纠正：`cliType` 永远不是 `'custom'`

PRD §Row 2 过滤入口写：

> 由前端基于 `RouteAnalyticsBucket.siteId` / `cliType === 'custom'` + `customCliId`（通过 site 维度伪装的 `custom-cli-site-${id}`）过滤聚合

**前半段对（用 `siteId` 过滤），后半段错（不存在 `cliType === 'custom'`）**：

- `RouteCliType` 枚举只有三个值（`src/shared/types/route-proxy.ts:18`）。
- 自定义 CLI 通道的 bucket，`cliType` 仍是上游 CLI 协议（`'claudeCode' | 'codex' | 'geminiCli'`），由 URL 路径决定。
- 判定一个 bucket 来自自定义 CLI 必须用：

  ```ts
  bucket.siteId.startsWith('custom-cli-site-')   // 字符串前缀
  // 或
  parseCustomCliRouteConfigId(bucket.siteId) !== null  // helper 反向解析
  ```

## 自定义 CLI 是否走本地代理产生分析数据？

是。

- 用户在 `CustomCliPage` 添加配置 → `applyConfig` 写 `activeConfigId`。
- 主进程在 `aggregateRouteModelRegistry()` 把它合成为虚拟 channel 加入注册表。
- 当用户用真实 CLI 工具（claude / codex / gemini）发请求到本地路由代理（`route-proxy-service.ts`）时，路由解析器选中该虚拟 channel，转发到 `customConfig.baseUrl`。
- `recordRouteRequest()` 把合成 siteId/accountId/apiKeyId 写桶。

→ **自定义 CLI 流量与站点账号流量在 bucket 层完全等价**，区别只是 `siteId` 字符串前缀。

## 多自定义 CLI 并存

`configs: CustomCliConfig[]` 无数量上限。每个配置独立产生一组 `(siteId, accountId, apiKeyId)`，互不干扰。Scope 下拉应列出全部 `configs`（即使 `lastModelFetch === undefined` 表示从未拉过模型，也照样列出 — 它仍可能有真实流量）。

## 推荐：抽公用 helper

主进程已有：

- `buildCustomCliRouteSiteId / buildCustomCliRouteAccountId / buildCustomCliRouteApiKeyId`（`src/main/custom-cli-config-service.ts:50-60`）
- `parseCustomCliRouteConfigId / isCustomCliRouteChannel`（`:62-84`）

渲染层暂无，`DataOverviewPage.tsx:1631-1633` / `LogsPage.tsx:224` 都是手写字符串拼接。

**建议新增 `src/shared/utils/customCliRouteId.ts`** 把上述 helper 抽到 shared，主进程现有文件 re-export 保持向后兼容：

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

跨进程零运行时风险（纯字符串）。

## Caveats / Not Found

- `encodeURIComponent` 是非幂等输入但幂等输出：renderer 现行 `encodeURIComponent(customCli.id)`（`DataOverviewPage.tsx:1631`）与主进程同款编码，结果一致。**不要对原始 `customCli.id` 二次 encode**。
- 没有发现任何代码用 `'custom'` 作为 `RouteCliType` 字面量；PRD 该处措辞需在 implement 阶段同步更正（或在新文件注释中显式说明语义映射）。
- 测试 fixture 应使用合成 siteId 直接构造，不用反向调 helper；端到端测试可用 helper 验证字符串拼接的正确性。
