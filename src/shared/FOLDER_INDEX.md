# 📁 src/shared/ - 共享代码层

## 架构说明

**职责**: 提供主进程和渲染进程共享的类型、常量、验证规则和工具函数

**特点**:
- 零依赖，不依赖 Electron 或 React
- 纯 TypeScript 代码
- 被 `main/` 和 `renderer/` 同时使用
- 确保类型安全和数据一致性

**依赖关系**:
- 被 `main/` 和 `renderer/` 导入
- 不依赖其他模块
- 可独立测试

---

## 📂 文件清单

### 子文件夹

| 文件夹 | 职责 | 关键文件 |
|--------|------|--------|
| **types/** | TypeScript 类型定义 | site.ts, endpoint-test.ts, route-proxy.ts |
| **schemas/** | Zod 数据验证规则 | index.ts |
| **constants/** | 常量定义 | index.ts；含站点列表列宽默认值、列宽版本与最大宽度 |
| **theme/** | 主题预设与模式归一化 | themePresets.ts |
| **utils/** | 工具函数 | apiConfig.ts, customCliRouteId.ts, groupLabel.ts, date.ts, headers.ts, log-filter.ts, modelPricing.ts, url-matcher.ts |

---

## 📝 Types (类型定义)

### site.ts

**职责**: 站点相关的类型定义，覆盖配置、账户浏览器 Profile 选择契约、检测缓存、API Key 活跃状态归一化、运行期缓存和站点每日快照

**关键类型**:
```typescript
interface Site {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  // ... 其他字段
}

interface SiteGroup {
  id: string;
  name: string;
  sites: Site[];
}

interface SiteStatus {
  balance: number;
  usage: number;
  rpm: number;
  tpm: number;
}

interface SiteDailySnapshot {
  siteId: string;
  snapshotDate: string;
  capturedAt: number;
  balance: number;
  todayUsage: number;
  todayRequests: number;
  todayPromptTokens: number;
  todayCompletionTokens: number;
  totalTokens: number;
}

interface RuntimeCacheFile {
  site_shared_by_site_id: Record<string, SiteSharedDetectionData>;
  site_runtime_by_site_id: Record<string, SiteRuntimeDetectionData>;
  account_runtime_by_account_id: Record<string, AccountRuntimeDetectionData>;
  site_daily_snapshots_by_site_id: Record<string, SiteDailySnapshot[]>;
}

type ApiKeyAvailability = 'active' | 'inactive' | 'unknown';
function getApiKeyAvailability(apiKey): ApiKeyAvailability;
function isApiKeyActive(apiKey): boolean;
```

### endpoint-test.ts

**职责**: 手动上游端点测试的独立共享契约；定义目标、协议、API Key 选项、选择状态与结果，不包含路由运行态

### route-proxy.ts

**职责**: 路由工作台共享契约，覆盖代理服务、模型注册表和统计配置；端点测试类型通过兼容 re-export 暴露

**关键类型**:
```typescript
interface RoutingConfig {
  server: RouteProxyServerConfig;
  modelRegistry: RouteModelRegistryConfig;
  /** legacy compatibility projection; persisted records are owned by endpoint-test sidecar */
  endpointTests: Record<string, EndpointTestTargetState>;
  analytics: RouteAnalyticsConfig;
}

interface RouteProxyServerConfig {
  upstreamProxyUrl?: string; // Optional upstream-only proxy URL used by the local route proxy
}

interface RouteModelRegistryConfig {
  sources: RouteModelSourceRef[];
  displayItems: RouteModelDisplayItem[];
  vendorPriorities: Partial<Record<RouteModelVendor, RouteVendorPriorityConfig>>;
}
```

### cli-config.ts

**职责**: CLI 配置相关的类型定义

**关键类型**:
```typescript
interface CliConfig {
  tool: 'claude-code' | 'codex';
  enabled: boolean;
  model?: string;
  // ... 其他字段
}

```

---

## ✅ Schemas (数据验证)

### index.ts

**职责**: 使用 Zod 定义主进程/渲染进程共用的输入校验规则

**关键 Schema**:
```typescript
export const urlSchema;          // 站点 Base URL
export const siteNameSchema;
export const apiKeySchema;
export const systemTokenSchema;
export const userIdSchema;
export const siteConfigSchema;   // 站点配置（含派生输入/输出类型）
export const createApiTokenSchema;
export const settingsSchema;
export const siteGroupSchema;
export const configSchema;
export type SiteConfigInput  = z.input<typeof siteConfigSchema>;
export type SiteConfigOutput = z.output<typeof siteConfigSchema>;
```

**用途**:
- 校验用户输入（添加/编辑站点、创建 API Key）
- 校验导入的配置文件
- 推导 TypeScript 类型，避免手写重复定义

---

## 🔢 Constants (常量定义)

### index.ts

**职责**: 跨进程共用的时间/端口/换算常量（**不含** API 地址或 CLI 清单）

**关键常量**:
```typescript
export const CHROME_DEBUG_PORT = 9222;
export const DEFAULT_API_TIMEOUT = 30;        // 秒
export const PAGE_LOAD_TIMEOUT = 30000;
export const NETWORK_IDLE_TIMEOUT = 3000;
export const PORT_READY_TIMEOUT = 5000;
export const PROTOCOL_TIMEOUT = 60000;
export const MAX_LOGIN_WAIT_TIME = 600000;
export const MAX_CLOUDFLARE_WAIT_TIME = 600000;
export const LOGIN_CHECK_INTERVAL = 2000;
export const BROWSER_CLEANUP_DELAY = 5000;
export const QUOTA_CONVERSION_FACTOR = 500000;
export const DEFAULT_EXCHANGE_RATE = 7.0;
export const TOAST_DURATION = 3000;
```

站点列表列宽默认值、列宽版本与最大宽度等 UI 常量也在本文件中。

---

## 🛠️ Utils (工具函数)

### customCliRouteId.ts

**职责**: 统一自定义 CLI 在路由分析中的合成 site/account/apiKey ID 命名约定。

**关键函数**:
```typescript
buildCustomCliRouteSiteId(configId);
buildCustomCliRouteAccountId(configId);
buildCustomCliRouteApiKeyId(configId);
parseCustomCliRouteConfigId(siteId);
isCustomCliRouteChannel(siteId, accountId, apiKeyId);
```

### headers.ts

**职责**: 生成兼容不同中转站大小写习惯的用户 ID 请求头。

**关键函数**:
```typescript
getAllUserIdHeaders(userId);
```

### log-filter.ts

**职责**: 判断模型调用日志并聚合 usage / quota 指标。

**关键函数**:
```typescript
isModelLog(item);
aggregateUsageData(items);
filterAndAggregateUsageData(items);
```

---

## 🔄 使用示例

### 在主进程中使用

```typescript
// src/main/api-service.ts
import { siteConfigSchema } from '../shared/schemas';
import { DEFAULT_API_TIMEOUT } from '../shared/constants';

async function checkBalance(site: SiteConfig) {
  const validSite = siteConfigSchema.parse(site);
  const timeoutMs = DEFAULT_API_TIMEOUT * 1000;
  // ...
}
```

### 在渲染进程中使用

```typescript
// src/renderer/hooks/useSiteGroups.ts
import type { SiteGroup } from '../../shared/types/site';
import { siteGroupSchema } from '../../shared/schemas';

function useSiteGroups(raw: SiteGroup[]) {
  const groups = raw.map(g => siteGroupSchema.parse(g));
  return { groups };
}
```

> 注意：`src/shared/` 下没有 `index.ts` 桶文件，必须按子路径导入（`shared/types/...`、`shared/utils/...`）。

---

## 📊 数据流

### 类型安全的数据流

```
主进程 (main/)
    ↓ 使用 shared/types
    ↓ 验证数据 (shared/schemas)
    ↓ 通过 IPC 发送
    ↓
渲染进程 (renderer/)
    ↓ 接收数据
    ↓ 验证数据 (shared/schemas)
    ↓ 使用 shared/types
    ↓ 更新 UI
```

---

## 🎯 设计原则

### 1. 零依赖

- 不依赖 Electron、React 等框架
- 可独立使用和测试
- 易于维护和扩展

### 2. 类型安全

- 完整的 TypeScript 类型定义
- 运行时数据验证 (Zod)
- 编译时类型检查

### 3. 单一职责

- 每个文件只负责一个方面
- 易于理解和维护
- 便于代码复用

### 4. 一致性

- 主进程和渲染进程使用相同的类型
- 确保数据一致性
- 减少 Bug

---

## 🧪 测试

### 类型测试

```bash
npm run test -- src/shared/types
```

### Schema 验证测试

```bash
npm run test -- src/shared/schemas
```

### 工具函数测试

```bash
npm run test -- src/shared/utils
```

---

## 📈 扩展指南

### 添加新类型

1. 在 `types/` 中新建或补充现有文件
2. 定义 TypeScript 接口/类型
3. 需要运行期校验时在 `schemas/` 补 Zod schema
4. 在 `PROJECT_INDEX.md` 与 `types/FOLDER_INDEX.md` 登记

### 添加新常量

1. 在 `constants/index.ts` 中添加 `export const`
2. 添加注释说明单位（秒 / 毫秒）

### 添加新工具函数

1. 在 `utils/` 中新建文件
2. 实现纯函数并写 JSDoc
3. 在 `utils/FOLDER_INDEX.md` 登记

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引和 PROJECT_INDEX.md

---

**版本**: 3.1.3
**更新日期**: 2026-10-22
