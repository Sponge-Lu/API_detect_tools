# 📁 src/shared/types/ - 共享类型定义
## 架构说明

`app-storage-contract.ts`：SQLite 存储命令结果、稳定 scope、并发版本与纯版本令牌校验；不依赖 Main 或驱动。
**职责**: 定义主进程和渲染进程共享的 TypeScript 类型
**特点**:
- 纯类型定义，无实现代码
- 被 `main/` 和 `renderer/` 同时使用
- 确保类型一致性
- 支持编译时类型检查
**依赖关系**:
- 被 `main/` 和 `renderer/` 导入
- 不依赖其他模块
- 可独立维护
---
## 📂 文件清单
### 核心类型文件
| 文件 | 职责 | 关键类型 |
|------|------|--------|
| **site.ts** | 站点（含站点级 `proxy_url` 刷新代理）、账户接入点级上游协议、检测缓存与运行期快照类型 | Site, UnifiedSite, AccountCredential, SiteDailySnapshot, RuntimeCacheFile |
| **endpoint-test.ts** | 手动上游端点测试目标、协议、API Key 选项、选择状态与结果 | EndpointTestTarget, EndpointTestProtocol, EndpointTestResult |
| **route-proxy.ts** | 通用网关、客户端双模式设置、卡片钉住状态、请求路由来源、Responses affinity、模型映射、会话父子谱系和端点历史类型 | RoutingConfig, RouteClientRoutingConfig, RouteInstance, RouteRequestLogItem, HistoryEndpointTrack |
| **config-file-profile.ts** | 版本化配置方案、DSH 专用设置、YAML 文件与恢复事务、含协议元数据的目标目录和对话记录扫描类型 | ConfigFileProfile, ConfigFileTargetCatalogEntry, ConfigFilePreviewTransaction, ConfigSessionRecordScanResult |
| **dsh-integration.ts** | DeepSeek Harness 会话级路由接入的状态/漂移原因/请求与结果类型，含 DSH 侧常量（条目 id、provider id、凭据 ref） | DshRoutingStatus, DshDriftReason, EnableDshSessionRoutingInput, EnableDshSessionRoutingResult, DshActionResult |
| **cli-config.ts** | 四种内置 CLI 的配置与目标协议类型 | BuiltinCliType, CliConfig, CLI_TARGET_PROTOCOLS |
| **custom-cli-config.ts** | 直连接入点配置、模型列表 URL 及接入点级上游协议 | CustomCliConfig, modelUrl, routeTargetProtocol, manualModels |
| **config-detection.ts** | 四种 CLI 本地配置静态检测类型与官方端点/路径 | ConfigSourceType, CliDetectionResult, AllCliDetectionResult 等 |
---
## 📝 类型详解
### site.ts - 站点相关类型
**职责**: 定义站点、分组、状态等相关类型
**关键类型**:
```typescript
// 站点信息
interface Site {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  token?: string;
  tokenExpiresAt?: number;
  groupId?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, any>;
}

// 站点分组
interface SiteGroup {
  id: string;
  name: string;
  sites: Site[];
  createdAt: number;
  updatedAt: number;
}

// 站点状态
interface SiteStatus {
  siteId: string;
  online: boolean;
  balance: number;
  currency: string;
  usage: number;
  rpm: number;
  tpm: number;
  lastChecked: number;
  error?: string;
}

// 站点检测结果
interface DetectionResult {
  siteId: string;
  siteName: string;
  status: 'success' | 'failed' | 'timeout';
  balance?: number;
  usage?: number;
  error?: string;
  duration: number;
  timestamp: number;
  // 签到统计数据 (New API 类型站点)
  checkinStats?: CheckinStats;    // 签到统计
}

// cached_data 扩展字段（站点检测状态持久化）
interface CachedData {
  // ... 其他字段
  status?: string;    // 检测状态：'成功' | '失败'
  error?: string;     // 错误信息（仅失败时有值）
}

// 签到统计数据 (New API 格式)
interface CheckinStats {
  todayQuota?: number;      // 今日签到金额 (内部单位，需要 /500000 转换为美元)
  checkinCount?: number;    // 当月签到次数
  totalCheckins?: number;   // 累计签到次数
  siteType?: 'veloera' | 'newapi';
}

// Token 信息
interface TokenInfo {
  siteId: string;
  token: string;
  expiresAt?: number;
  createdAt: number;
  lastUsed?: number;
}
```
**当前约束**:
- `has_checkin` 表示站点或账户是否具备签到能力，`can_check_in` 表示当前运行态是否还能执行签到
- `getApiKeyAvailability()` / `isApiKeyActive()` 是 API Key 可用性判断的共享入口；调用方不要只用 `status === 1` 判断，因为不同站点可能返回 `status_str`、`state` 或 `enabled`
- `SiteDailySnapshot` 用于 `数据总览` 页的站点日级历史趋势，存入 `RuntimeCacheFile.site_daily_snapshots_by_site_id`
**使用示例**:
```typescript
// 创建站点
const site: Site = {
  id: 'site-1',
  name: 'One API',
  baseUrl: 'https://api.one-api.com',
  apiKey: 'sk-...',
  groupId: 'group-1',
  createdAt: Date.now(),
  updatedAt: Date.now()
};

// 创建分组
const group: SiteGroup = {
  id: 'group-1',
  name: 'Production',
  sites: [site],
  createdAt: Date.now(),
  updatedAt: Date.now()
};

// 站点状态
const status: SiteStatus = {
  siteId: 'site-1',
  online: true,
  balance: 100,
  currency: 'CNY',
  usage: 50,
  rpm: 10,
  tpm: 1000,
  lastChecked: Date.now()
};
```
### endpoint-test.ts - 手动端点测试类型
**职责**: 定义与路由运行态完全独立的手动上游测试契约
**关键类型**:
```typescript
type EndpointTestProtocol =
  | 'anthropic-messages'
  | 'openai-responses'
  | 'openai-chat-completions';

type EndpointTestTarget =
  | { kind: 'managed'; siteId: string; accountId: string }
  | { kind: 'direct'; configId: string };

interface EndpointTestResult {
  success: boolean;
  endpoint: string;
  apiKeyId: string;
  apiKeyLabel: string;
  model: string;
  testedAt: number;
  latencyMs: number;
}
```

### route-proxy.ts - 路由工作台类型
**职责**: 定义路由代理、模型注册表、profile affinity 分类摘要、History 请求端点标签和统计分析相关共享契约；通过 re-export 保持旧端点测试导入兼容
**关键类型**:
```typescript
interface RouteProxyServerConfig {
  upstreamProxyUrl?: string; // Optional upstream-only proxy URL used by the local route proxy
}

interface RouteModelRegistryConfig {
  sources: RouteModelSourceRef[];
  entries: Record<string, RouteModelRegistryEntry>;
  displayItems: RouteModelDisplayItem[];
  vendorPriorities: Partial<Record<RouteModelVendor, RouteVendorPriorityConfig>>;
}

interface RouteModelSourceRef {
  sourceType: 'account' | 'site' | 'customCli';
  availableCliTypes?: RouteCliType[];
}

interface RouteInstanceKey {
  agentId: string;
  runtimeSlotId: string;
  sessionId: string;
}

interface RouteInstance {
  id: string;
  routeKey?: RouteInstanceKey;
  clientModelId?: string;
  parentInstanceId?: string;
  childOrdinal?: number;
  memberSessionIds?: string[];
  routingState: 'armed' | 'active' | 'closed' | 'cancelled';
  modelId: string;
  reasoningEffort: string;
  createdAt?: number;
  lastRequestAt?: number;
}

interface RouteAnalyticsObjectStatsItem {
  siteId?: string;
  accountId?: string;
  apiKeyId?: string;
  requestCount: number;
  successRate: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cachedTokens?: number;
}
```
**关键辅助函数**:
- `buildBucketKey()` - 构造包含 CLI / 模型 / 站点 / 账户 / API Key 的分析桶索引键
- `normalizeRouteCliSelection()` - 将 CLI 默认模型统一归一到 canonical 名称
- `compareRouteModelRegistryEntries()` - 按厂商优先模式、层级词和版本号排序模型
### cli-config.ts - CLI 配置类型
**职责**: 定义 CLI 工具配置相关类型
**关键类型**:
```typescript
// CLI 工具类型
type CliTool = 'claude-code' | 'codex' | 'chat';

// CLI 配置
interface CliConfig {
  tool: CliTool;
  enabled: boolean;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  metadata?: Record<string, any>;
}

// CLI 配置生成结果
interface CliConfigGenerateResult {
  tool: CliTool;
  config: CliConfig;
  format: 'json' | 'yaml' | 'env';
  content: string;
}
```
**使用示例**:
```typescript
// CLI 配置
const cliConfig: CliConfig = {
  tool: 'claude-code',
  enabled: true,
  model: 'gpt-4',
  apiKey: 'sk-...',
  baseUrl: 'https://api.openai.com',
  timeout: 30000
};

```
## 🔄 类型关系图

```
Site (站点)
├── id: string
├── name: string
├── baseUrl: string
├── apiKey?: string
├── token?: string
├── groupId?: string
└── metadata?: Record<string, any>

SiteGroup (分组)
├── id: string
├── name: string
└── sites: Site[]

SiteStatus (站点状态)
├── siteId: string
├── online: boolean
├── balance: number
├── usage: number
├── rpm: number
└── tpm: number

DetectionResult (检测结果)
├── siteId: string
├── status: 'success' | 'failed' | 'timeout'
├── balance?: number
├── usage?: number
├── error?: string
└── checkinStats?: CheckinStats

CachedData (缓存数据扩展)
├── status?: string           // 检测状态：'成功' | '失败'
└── error?: string            // 错误信息（仅失败时有值）

CheckinStats (签到统计数据)
├── todayQuota?: number
├── checkinCount?: number
├── totalCheckins?: number
└── siteType?: 'veloera' | 'newapi'

SiteDailySnapshot (站点每日快照)
├── siteId: string
├── snapshotDate: string
├── capturedAt: number
├── balance: number
├── todayUsage: number
├── todayRequests: number
├── todayPromptTokens: number
├── todayCompletionTokens: number
└── totalTokens: number

RuntimeCacheFile (运行期缓存文件)
├── site_shared_by_site_id: Record<string, SiteSharedDetectionData>
├── site_runtime_by_site_id: Record<string, SiteRuntimeDetectionData>
├── account_runtime_by_account_id: Record<string, AccountRuntimeDetectionData>
├── site_daily_snapshots_by_site_id: Record<string, SiteDailySnapshot[]>
└── last_updated: number

CliConfig (CLI 配置)
├── tool: CliTool
├── enabled: boolean
├── model?: string
├── apiKey?: string
└── baseUrl?: string

```
---
## 🎯 设计原则
### 1. 类型安全
- 完整的类型定义
- 避免使用 `any`
- 编译时类型检查
### 2. 可扩展性
- 使用 `metadata` 字段存储扩展数据
- 支持向后兼容
- 易于添加新字段
### 3. 一致性
- 主进程和渲染进程使用相同的类型
- 确保数据一致性
- 减少 Bug
### 4. 文档化
- 为每个类型添加注释
- 说明字段的含义
- 提供使用示例
---
## 🧪 类型检查
### 编译时检查

```bash
npm run build:main    # 编译主进程，检查类型
npm run build:renderer # 编译渲染进程，检查类型
```
### 类型验证

```typescript
// 验证类型定义
const site: Site = {
  id: '1',
  name: 'Test',
  baseUrl: 'https://api.test.com',
  createdAt: Date.now(),
  updatedAt: Date.now()
};

// TypeScript 会检查类型
// 如果字段类型不匹配，会报错
```
---
## 📈 扩展指南
### 添加新类型

1. 在 `types/` 中创建新文件
2. 定义 TypeScript 接口
3. 添加注释说明
4. 导出到 `index.ts`
### 模板

```typescript
// src/shared/types/newType.ts
/**
 * 新类型的描述
 */
export interface NewType {
  /** 字段1 的描述 */
  field1: string;
  
  /** 字段2 的描述 */
  field2?: number;
  
  /** 字段3 的描述 */
  field3: Record<string, any>;
}
```
---
## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/shared/FOLDER_INDEX.md 和 PROJECT_INDEX.md
---
**版本**: 3.0.3
**更新日期**: 2026-05-25

## 架构与数据管理重构（2026-10-24）

- [electron-api.ts](electron-api.ts): preload 与 Renderer 共用的 ElectronAPI 类型契约
- [renderer-config.ts](renderer-config.ts): Renderer 配置/偏好契约，避免反向依赖 App
- [config-commands.ts](config-commands.ts): 配置保存的按 ID 命令转换与 canonical 响应处理
- [custom-cli-commands.ts](custom-cli-commands.ts): 直连配置逐 ID 修改/顺序/激活命令
- [app-storage-contract.ts](app-storage-contract.ts): StateVersion、稳定 scope 和命令结果契约
- [config-file-profile.ts](config-file-profile.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [route-command-channels.ts](route-command-channels.ts): 必须携带稳定版本的 route 写通道清单
- [route-proxy.ts](route-proxy.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
