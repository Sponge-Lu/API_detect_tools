/**
 * 路由代理模块类型定义
 * 输入: 无 (纯类型定义)
 * 输出: 路由代理相关 TypeScript 类型、接口、常量、工具函数
 * 定位: 类型定义层 - 本地 HTTP 代理 + 模型注册表 + CLI 探测 + 统计分析
 */

// ============= 基础枚举 =============

/** CLI 类型 */
export type RouteCliType = 'claudeCode' | 'codex' | 'geminiCli';

/** Pattern 匹配类型 */
export type RoutePatternType = 'exact' | 'wildcard' | 'regex';

/** 路由结果分类 */
export type RouteOutcome = 'success' | 'failure' | 'neutral';

/** 模型厂商归类 */
export type RouteModelVendor =
  | 'claude'
  | 'gpt'
  | 'gemini'
  | 'minimax'
  | 'glm'
  | 'qwen'
  | 'deepseek'
  | 'mistral'
  | 'llama'
  | 'grok'
  | 'unknown';

// ============= 代理服务器 =============

/** 代理服务器配置 */
export interface RouteProxyServerConfig {
  enabled: boolean;
  host: '127.0.0.1';
  port: number;
  unifiedApiKey: string;
  requestTimeoutMs: number;
  retryCount: number;
  healthCheckIntervalMinutes: number;
}

// ============= 路由规则 =============

/** 路由规则 */
export interface RouteRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  cliType: RouteCliType;
  patternType: RoutePatternType;
  pattern: string;
  allowedSiteIds?: string[];
  allowedAccountIds?: string[];
  allowedApiKeyGroups?: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

// ============= 通道与统计 =============

/** 通道四元组 key */
export interface RouteChannelKey {
  routeRuleId: string;
  siteId: string;
  accountId: string;
  apiKeyId: string;
}

/** 通道成功率统计（实时选路评分用） */
export interface RouteChannelStats extends RouteChannelKey {
  successCount: number;
  failureCount: number;
  neutralCount: number;
  consecutiveFailures: number;
  cliType?: RouteCliType;
  lastCanonicalModel?: string;
  lastResolvedModel?: string;
  lastStatusCode?: number;
  lastLatencyMs?: number;
  lastFirstByteLatencyMs?: number;
  lastUsedAt?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
}

/** 通道健康投影（由 probe latest 投影得出） */
export interface RouteChannelHealth extends RouteChannelKey {
  cliType: RouteCliType;
  healthy: boolean;
  canonicalModel?: string;
  rawModel?: string;
  endpointPingMs?: number;
  firstByteLatencyMs?: number;
  totalLatencyMs?: number;
  testedAt?: number;
  error?: string;
}

// ============= 模型注册表 =============

/** 模型来源引用 */
export interface RouteModelSourceRef {
  sourceKey: string;
  siteId: string;
  siteName: string;
  accountId?: string;
  accountName?: string;
  sourceType: 'account' | 'site';
  originalModel: string;
  vendor: RouteModelVendor;
  apiKeyGroups?: string[];
  userGroupKeys?: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  detectedAt?: number;
}

/** 模型映射人工覆盖 */
export interface RouteModelMappingOverride {
  id: string;
  sourceKey: string;
  canonicalName: string;
  action: 'pin' | 'exclude' | 'rename';
  note?: string;
  createdAt: number;
  updatedAt: number;
}

/** canonical 模型注册项 */
export interface RouteModelRegistryEntry {
  canonicalName: string;
  vendor: RouteModelVendor;
  aliases: string[];
  sources: RouteModelSourceRef[];
  hasOverride: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 模型注册表配置 */
export interface RouteModelRegistryConfig {
  version: number;
  entries: Record<string, RouteModelRegistryEntry>;
  overrides: RouteModelMappingOverride[];
  lastAggregatedAt?: number;
}

// ============= CLI 探测 =============

/** CLI 定时探测配置 */
export interface RouteCliProbeConfig {
  enabled: boolean;
  intervalMinutes: number;
  modelsPerCli: number;
  requestTimeoutMs: number;
  maxConcurrency: number;
  retentionDays: number;
  runOnStartup: boolean;
}

/** 单条 CLI 探测样本 */
export interface RouteCliProbeSample {
  sampleId: string;
  probeKey: string;
  siteId: string;
  accountId: string;
  cliType: RouteCliType;
  canonicalModel: string;
  rawModel: string;
  success: boolean;
  statusCode?: number;
  endpointPingMs?: number;
  firstByteLatencyMs?: number;
  totalLatencyMs?: number;
  error?: string;
  testedAt: number;
}

/** probe 维度最新快照 */
export interface RouteCliProbeLatest {
  probeKey: string;
  siteId: string;
  accountId: string;
  cliType: RouteCliType;
  canonicalModel: string;
  rawModel: string;
  healthy: boolean;
  lastSample: RouteCliProbeSample;
  lastSuccessAt?: number;
  lastFailureAt?: number;
}

/** CLI 可用性单模型展示视图 */
export interface RouteCliProbeModelView {
  canonicalModel: string;
  rawModel?: string;
  success: boolean | null;
  testedAt?: number;
  totalLatencyMs?: number;
  error?: string;
  history: RouteCliProbeSample[];
}

/** CLI 可用性单 CLI 展示视图 */
export interface RouteCliProbeCliView {
  cliType: RouteCliType;
  enabled: boolean;
  accountId?: string;
  accountName?: string;
  isFallbackAccount: boolean;
  accountReason?: string;
  models: RouteCliProbeModelView[];
}

/** CLI 可用性单站点展示视图 */
export interface RouteCliProbeSiteView {
  siteId: string;
  siteName: string;
  accountId?: string;
  accountName?: string;
  isFallbackAccount: boolean;
  accountReason?: string;
  clis: Record<RouteCliType, RouteCliProbeCliView>;
}

// ============= 分析统计 =============

/** 路由分析配置 */
export interface RouteAnalyticsConfig {
  enabled: boolean;
  retentionDays: number;
  bucketSizeMinutes: number;
  recordTokenUsage: boolean;
  recordStatusCode: boolean;
  recordLatencyHistogram: boolean;
  latencyHistogramBuckets: number[];
  firstByteHistogramBuckets: number[];
}

/** 小时级分析桶 */
export interface RouteAnalyticsBucket {
  bucketKey: string;
  bucketStart: number;
  bucketSize: 'hour';
  cliType: RouteCliType;
  routeRuleId?: string;
  canonicalModel?: string;
  siteId?: string;
  accountId?: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  neutralCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  statusCodeHistogram: Record<string, number>;
  latencyHistogram: Record<string, number>;
  firstByteHistogram: Record<string, number>;
  updatedAt: number;
}

// ============= 顶层配置 =============

/** 路由模块配置（持久化到 config.json.routing） */
export interface RoutingConfig {
  server: RouteProxyServerConfig;
  rules: RouteRule[];
  cliModelSelections: Record<RouteCliType, string | null>;
  stats: Record<string, RouteChannelStats>;
  health: Record<string, RouteChannelHealth>;
  modelRegistry: RouteModelRegistryConfig;
  cliProbe: {
    config: RouteCliProbeConfig;
    latest: Record<string, RouteCliProbeLatest>;
    history: Record<string, RouteCliProbeSample[]>;
  };
  analytics: {
    config: RouteAnalyticsConfig;
    buckets: Record<string, RouteAnalyticsBucket>;
  };
}

// ============= 默认值 =============

export const DEFAULT_ROUTE_PROXY_SERVER_CONFIG: RouteProxyServerConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 3210,
  unifiedApiKey: '',
  requestTimeoutMs: 300000,
  retryCount: 1,
  healthCheckIntervalMinutes: 60,
};

export const DEFAULT_CLI_PROBE_CONFIG: RouteCliProbeConfig = {
  enabled: false,
  intervalMinutes: 60,
  modelsPerCli: 3,
  requestTimeoutMs: 30000,
  maxConcurrency: 3,
  retentionDays: 30,
  runOnStartup: false,
};

export const DEFAULT_ANALYTICS_CONFIG: RouteAnalyticsConfig = {
  enabled: true,
  retentionDays: 30,
  bucketSizeMinutes: 60,
  recordTokenUsage: true,
  recordStatusCode: true,
  recordLatencyHistogram: true,
  latencyHistogramBuckets: [1000, 3000, 5000, 8000, 15000, 30000],
  firstByteHistogramBuckets: [200, 500, 1000, 3000, 5000, 10000],
};

export const DEFAULT_MODEL_REGISTRY_CONFIG: RouteModelRegistryConfig = {
  version: 1,
  entries: {},
  overrides: [],
};

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  server: DEFAULT_ROUTE_PROXY_SERVER_CONFIG,
  rules: [],
  cliModelSelections: { claudeCode: null, codex: null, geminiCli: null },
  stats: {},
  health: {},
  modelRegistry: DEFAULT_MODEL_REGISTRY_CONFIG,
  cliProbe: {
    config: DEFAULT_CLI_PROBE_CONFIG,
    latest: {},
    history: {},
  },
  analytics: {
    config: DEFAULT_ANALYTICS_CONFIG,
    buckets: {},
  },
};

// ============= 工具函数 =============

export function buildStatsKey(key: RouteChannelKey): string {
  return `${key.routeRuleId}:${key.siteId}:${key.accountId}:${key.apiKeyId}`;
}

export function parseStatsKey(key: string): RouteChannelKey | null {
  const parts = key.split(':');
  if (parts.length !== 4) return null;
  return {
    routeRuleId: parts[0],
    siteId: parts[1],
    accountId: parts[2],
    apiKeyId: parts[3],
  };
}

export function buildProbeKey(
  siteId: string,
  accountId: string,
  cliType: RouteCliType,
  canonicalModel: string
): string {
  return `${siteId}:${accountId}:${cliType}:${canonicalModel}`;
}

export function buildBucketKey(
  bucketStart: number,
  cliType: RouteCliType,
  canonicalModel?: string,
  siteId?: string,
  accountId?: string
): string {
  return `${bucketStart}:${cliType}:${canonicalModel || '*'}:${siteId || '*'}:${accountId || '*'}`;
}

/** CLI 类型对应的请求路径前缀 */
export const CLI_TYPE_PATH_MAP: Record<RouteCliType, string[]> = {
  claudeCode: ['/v1/messages'],
  codex: ['/v1/responses'],
  geminiCli: ['/v1beta/'],
};

/** 厂商匹配规则：prefixes 匹配前缀（优先），keywords 匹配名称中任意位置（兜底） */
export const VENDOR_MATCH_RULES: Array<{
  vendor: RouteModelVendor;
  prefixes: RegExp[];
  keywords: RegExp[];
}> = [
  { vendor: 'claude', prefixes: [/^claude/i], keywords: [/claude/i] },
  {
    vendor: 'gpt',
    prefixes: [/^gpt/i, /^o\d/i, /^chatgpt/i],
    keywords: [/\bgpt\b/i, /\bopenai\b/i],
  },
  { vendor: 'gemini', prefixes: [/^gemini/i], keywords: [/gemini/i] },
  { vendor: 'grok', prefixes: [/^grok/i], keywords: [/grok/i] },
  { vendor: 'deepseek', prefixes: [/^deepseek/i], keywords: [/deepseek/i] },
  { vendor: 'qwen', prefixes: [/^qwen/i], keywords: [/qwen/i, /tongyi/i] },
  { vendor: 'glm', prefixes: [/^glm/i, /^chatglm/i], keywords: [/\bglm\b/i, /zhipu/i] },
  { vendor: 'minimax', prefixes: [/^minimax/i, /^abab/i], keywords: [/minimax/i, /\babab/i] },
  {
    vendor: 'mistral',
    prefixes: [/^mistral/i, /^codestral/i, /^pixtral/i],
    keywords: [/mistral/i, /codestral/i, /pixtral/i],
  },
  { vendor: 'llama', prefixes: [/^llama/i, /^meta-llama/i], keywords: [/llama/i] },
];
