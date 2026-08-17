/**
 * 路由代理模块类型定义
 * 输入: 无 (纯类型定义)
 * 输出: 路由代理相关 TypeScript 类型、接口、常量、工具函数
 * 定位: 类型定义层 - 本地 HTTP 代理 + 模型注册表 + 端点测试 + 统计分析
 */

import {
  DEFAULT_CLI_TARGET_PROTOCOL,
  normalizeCliTargetProtocol,
  type BuiltinCliType,
  type CliTargetProtocol,
} from './cli-config';

// ============= 基础枚举 =============

/** CLI 类型 */
export type RouteCliType = BuiltinCliType;

export const ROUTE_SOURCE_PROTOCOLS = [
  'anthropic-messages',
  'openai-responses',
  'openai-chat-completions',
] as const;
export type RouteSourceProtocol = (typeof ROUTE_SOURCE_PROTOCOLS)[number];

export const ROUTE_CLI_MARKER_HEADER = 'x-api-detect-cli';
export const ROUTE_CLI_MARKER_VALUES: Record<RouteCliType, string> = {
  claudeCode: 'claudeCode',
  codex: 'codex',
  openCode: 'openCode',
  grokBuild: 'grokBuild',
};

/** 路由思考强度预设 */
export const ROUTE_THINKING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
/** 路由思考强度：预设值或用户自定义字符串 */
export type RouteThinkingEffort = string;

export const ROUTE_AGENT_ID_HEADER = 'x-api-detect-agent-id';
export const ROUTE_RUNTIME_SLOT_ID_HEADER = 'x-api-detect-runtime-slot-id';
export const ROUTE_SESSION_ID_HEADER = 'x-api-detect-session-id';
export const ROUTE_AGENT_NAME_HEADER = 'x-api-detect-agent-name';
export const ROUTE_RUNTIME_SLOT_LABEL_HEADER = 'x-api-detect-runtime-slot-label';

export interface RouteInstanceKey {
  agentId: string;
  runtimeSlotId: string;
  sessionId: string;
}

export interface RouteInstanceDisplay {
  observedAgentName?: string;
  observedRuntimeSlotLabel?: string;
  customAgentName?: string;
  customRuntimeSlotLabel?: string;
}

export type RouteInstanceRoutingState = 'armed' | 'active' | 'closed' | 'cancelled';
export type RouteInstancePresenceState = 'confirmed_open' | 'confirmed_closed' | 'unknown';
export type RouteInstanceClosedReason = 'replaced' | 'explicit' | 'lifecycle';

export interface RouteInstance {
  id: string;
  /** Profile namespace that owns this bound generation. ARMED and legacy records may be unscoped. */
  profileId?: string;
  routeKey?: RouteInstanceKey;
  display: RouteInstanceDisplay;
  modelId: string;
  reasoningEffort: RouteThinkingEffort;
  routingState: RouteInstanceRoutingState;
  presenceState: RouteInstancePresenceState;
  createdAt?: number;
  lastRequestAt?: number;
  closedAt?: number;
  closedReason?: RouteInstanceClosedReason;
}

export interface RouteInstanceUpdate {
  modelId?: string;
  reasoningEffort?: RouteThinkingEffort;
  customAgentName?: string | null;
  customRuntimeSlotLabel?: string | null;
}

export type RouteSessionRuleSource = 'header' | 'query' | 'json';
export type RouteSessionIdentityLevel = 'conversation' | 'window' | 'agent' | 'request';
export type RouteSessionAssociationLevel = 'exact' | 'linked' | 'probable' | 'unidentified';
export type RouteSessionActivityState = 'open' | 'closed' | 'unknown';

export interface RouteSessionExtractionRuleRevision {
  version: number;
  name: string;
  enabled: boolean;
  namespace: string;
  source: RouteSessionRuleSource;
  path: string;
  protocol?: CliTargetProtocol | 'any';
  identityLevel?: RouteSessionIdentityLevel;
  priority?: number;
  minLength?: number;
  maxLength?: number;
  valuePattern?: string;
  updatedAt: number;
}

export interface RouteSessionExtractionRule {
  id: string;
  name: string;
  enabled: boolean;
  namespace: string;
  source: RouteSessionRuleSource;
  path: string;
  protocol?: CliTargetProtocol | 'any';
  identityLevel?: RouteSessionIdentityLevel;
  priority?: number;
  minLength?: number;
  maxLength?: number;
  valuePattern?: string;
  version?: number;
  revisions?: RouteSessionExtractionRuleRevision[];
  createdAt?: number;
  updatedAt?: number;
}

export interface RouteSessionOverride {
  key: string;
  namespace: string;
  sessionId: string;
  displayName?: string;
  model: string | null;
  thinkingEffort: RouteThinkingEffort | null;
  associationLevel?: RouteSessionAssociationLevel;
  updatedAt: number;
}

export interface RouteSessionActivity extends RouteSessionOverride {
  clientLabel?: string;
  workspace?: string;
  protocol: CliTargetProtocol;
  requestedModel?: string | null;
  requestCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  active: boolean;
  activityState?: RouteSessionActivityState;
  associationLevel: RouteSessionAssociationLevel;
  sourceRuleId?: string;
  recordConnectorId?: string;
}

export interface RouteSessionCandidate {
  key: string;
  source: RouteSessionRuleSource;
  path: string;
  protocol: CliTargetProtocol;
  valueShape: string;
  observationCount: number;
  distinctValueCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface RouteSessionRoutingConfig {
  instances: Record<string, RouteInstance>;
  currentRouteBySlot: Record<string, string>;
  extractionRules: RouteSessionExtractionRule[];
  overrides: Record<string, RouteSessionOverride>;
  /** Legacy compatibility only; open-window state is never inferred from elapsed request time. */
  activeWindowMinutes: number;
  recentWindowHours?: number;
  historyRetentionDays?: number;
  overrideRetentionDays?: number;
}

export const DEFAULT_ROUTE_SESSION_EXTRACTION_RULES: RouteSessionExtractionRule[] = [
  {
    id: 'header-route-session-id',
    name: 'Route Session ID Header',
    enabled: true,
    namespace: 'route',
    source: 'header',
    path: 'x-route-session-id',
    identityLevel: 'conversation',
    priority: 100,
  },
  {
    id: 'header-claude-code-session-id',
    name: 'Claude Code Session ID Header',
    enabled: true,
    namespace: 'claude-code',
    source: 'header',
    path: 'x-claude-code-session-id',
    identityLevel: 'conversation',
    priority: 90,
  },
  {
    id: 'header-session-affinity',
    name: 'Session Affinity Header',
    enabled: true,
    namespace: 'session-affinity',
    source: 'header',
    path: 'x-session-affinity',
    identityLevel: 'conversation',
    priority: 80,
  },
  {
    id: 'header-session-id',
    name: 'Session ID Header',
    enabled: true,
    namespace: 'http',
    source: 'header',
    path: 'x-session-id',
    identityLevel: 'conversation',
    priority: 70,
  },
  {
    id: 'header-conversation-id',
    name: 'Conversation ID Header',
    enabled: true,
    namespace: 'http',
    source: 'header',
    path: 'x-conversation-id',
    identityLevel: 'conversation',
    priority: 70,
  },
  {
    id: 'header-thread-id',
    name: 'Thread ID Header',
    enabled: true,
    namespace: 'thread',
    source: 'header',
    path: 'thread-id',
    identityLevel: 'conversation',
    priority: 70,
  },
  {
    id: 'json-session-id',
    name: 'Session ID Field',
    enabled: true,
    namespace: 'body',
    source: 'json',
    path: 'session_id',
    identityLevel: 'conversation',
    priority: 60,
  },
  {
    id: 'json-conversation-id',
    name: 'Conversation ID Field',
    enabled: true,
    namespace: 'body',
    source: 'json',
    path: 'conversation_id',
    identityLevel: 'conversation',
    priority: 60,
  },
  {
    id: 'json-thread-id',
    name: 'Thread ID Field',
    enabled: true,
    namespace: 'thread',
    source: 'json',
    path: 'thread_id',
    identityLevel: 'conversation',
    priority: 60,
  },
];

export const DEFAULT_ROUTE_SESSION_ROUTING_CONFIG: RouteSessionRoutingConfig = {
  instances: {},
  currentRouteBySlot: {},
  extractionRules: DEFAULT_ROUTE_SESSION_EXTRACTION_RULES,
  overrides: {},
  activeWindowMinutes: 30,
  recentWindowHours: 24,
  historyRetentionDays: 30,
  overrideRetentionDays: 90,
};

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

export interface RouteStateAffinitySummary {
  profileId: string;
  total: number;
  responses: number;
  conversations: number;
  conversationItems: number;
}

/** 代理服务器配置 */
export interface RouteProxyServerConfig {
  enabled: boolean;
  host: '127.0.0.1';
  port: number;
  unifiedApiKey: string;
  upstreamProxyUrl?: string;
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
  sourceProtocol: RouteSourceProtocol;
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
  targetProtocol?: CliTargetProtocol;
  lastCanonicalModel?: string;
  lastResolvedModel?: string;
  lastStatusCode?: number;
  lastLatencyMs?: number;
  lastFirstByteLatencyMs?: number;
  lastUsedAt?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
}

/** 单条路由路径的短窗口运行态（用于临时禁用不可用路径） */
export interface RoutePathState extends Omit<RouteChannelKey, 'routeRuleId'> {
  routeRuleId?: string;
  cliType?: RouteCliType;
  targetProtocol?: CliTargetProtocol;
  canonicalModel?: string;
  resolvedModel?: string;
  windowStartedAt: number;
  windowRequestCount: number;
  windowSuccessCount: number;
  successRate: number;
  disabledUntil?: number;
  disabledReason?: 'success_rate_below_threshold';
  lastOutcome?: RouteOutcome;
  lastStatusCode?: number;
  lastLatencyMs?: number;
  lastError?: string;
  lastUsedAt?: number;
  lastSuccessAt?: number;
  lastSuccessRequestStartedAt?: number;
  lastFailureAt?: number;
  affinitySuppressedUntil?: number;
  affinitySuppressedAt?: number;
  updatedAt: number;
}

export type RouteEndpointCapabilityName =
  | 'claude_messages_count_tokens'
  | 'openai_responses_input_tokens';
export type RouteEndpointCapabilityStatus = 'unsupported';

export interface RouteEndpointCapabilityState {
  siteId: string;
  accountId: string;
  apiKeyId: string;
  cliType: RouteCliType;
  targetProtocol?: CliTargetProtocol;
  endpoint: RouteEndpointCapabilityName;
  status: RouteEndpointCapabilityStatus;
  reason?: string;
  statusCode?: number;
  lastError?: string;
  firstObservedAt: number;
  lastObservedAt: number;
  updatedAt: number;
}

export interface RoutePathStateResetParams {
  routeRuleId?: string;
  canonicalModel?: string;
  siteId?: string;
  accountId?: string;
  apiKeyId?: string;
  resolvedModel?: string;
  targetProtocol?: CliTargetProtocol;
}

/** 通道健康投影（由 probe latest 投影得出） */
export interface RouteChannelHealth extends RouteChannelKey {
  cliType: RouteCliType;
  targetProtocol?: CliTargetProtocol;
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

export interface RouteModelSourceApiKeyRef {
  apiKeyId: string;
  apiKeyName: string;
  accountId: string;
  accountName?: string;
  group: string;
}

export interface RouteVendorPriorityConfig {
  sitePriorities: Record<string, number>;
  apiKeyPriorities: Record<string, number>;
}

export interface RouteDisplayItemPriorityConfig {
  sitePriorities: Record<string, number>;
  apiKeyPriorities: Record<string, number>;
  disabledSiteIds?: string[];
  disabledApiKeyPriorityKeys?: string[];
  affinityInvalidatedAt?: number;
}

export interface RouteRuntimeConfig {
  maxAttemptsPerRoutePath: number;
  successRateWindowMinutes: number;
  disableDurationMinutes: number;
  minSuccessRate: number;
}

export const DEFAULT_ROUTE_VENDOR_SITE_PRIORITY = 0;
export const DEFAULT_ROUTE_VENDOR_API_KEY_PRIORITY = 0;
export const DEFAULT_ROUTE_RUNTIME_CONFIG: RouteRuntimeConfig = {
  maxAttemptsPerRoutePath: 3,
  successRateWindowMinutes: 60,
  disableDurationMinutes: 60,
  minSuccessRate: 0.3,
};

export function buildRouteApiKeyPriorityKey(
  siteId: string,
  accountId: string,
  apiKeyId: string
): string {
  return `${siteId}:${accountId}:${apiKeyId}`;
}

export function buildRouteVendorApiKeyPriorityKey(
  siteId: string,
  accountId: string,
  apiKeyId: string
): string {
  return buildRouteApiKeyPriorityKey(siteId, accountId, apiKeyId);
}

/** 模型来源引用 */
export interface RouteModelSourceRef {
  sourceKey: string;
  siteId: string;
  siteName: string;
  accountId?: string;
  accountName?: string;
  sourceType: 'account' | 'site' | 'customCli';
  originalModel: string;
  vendor: RouteModelVendor;
  availableCliTypes?: RouteCliType[];
  apiKeyGroups?: string[];
  apiKeyNamesByGroup?: Record<string, string[]>;
  userGroupKeys?: string[];
  availableUserGroups?: string[];
  availableApiKeys?: RouteModelSourceApiKeyRef[];
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

/** 路由页模型重定向展示项 */
export interface RouteModelDisplayItem {
  id: string;
  vendor: RouteModelVendor;
  canonicalName: string;
  sourceKeys: string[];
  originalModelOrder?: string[];
  priorityConfig?: RouteDisplayItemPriorityConfig;
  runtimeConfig?: RouteRuntimeConfig;
  mode: 'seeded' | 'manual';
  createdAt: number;
  updatedAt: number;
}

export const ROUTE_OVERRIDE_DISPLAY_ITEM_ID_PREFIX = 'override:';

export function buildRouteOverrideDisplayItemId(canonicalName: string): string {
  return `${ROUTE_OVERRIDE_DISPLAY_ITEM_ID_PREFIX}${canonicalName}`;
}

export function parseRouteOverrideDisplayItemId(displayItemId: string): string | null {
  if (!displayItemId.startsWith(ROUTE_OVERRIDE_DISPLAY_ITEM_ID_PREFIX)) {
    return null;
  }

  const canonicalName = displayItemId.slice(ROUTE_OVERRIDE_DISPLAY_ITEM_ID_PREFIX.length).trim();
  return canonicalName || null;
}

/** 模型注册表配置 */
export interface RouteModelRegistryConfig {
  version: number;
  sources: RouteModelSourceRef[];
  entries: Record<string, RouteModelRegistryEntry>;
  overrides: RouteModelMappingOverride[];
  displayItems: RouteModelDisplayItem[];
  vendorPriorities: Partial<Record<RouteModelVendor, RouteVendorPriorityConfig>>;
  lastAggregatedAt?: number;
}

// ============= 端点测试 =============

export const ENDPOINT_TEST_PROTOCOLS = [
  'anthropic-messages',
  'openai-responses',
  'openai-chat-completions',
] as const;

export type EndpointTestProtocol = (typeof ENDPOINT_TEST_PROTOCOLS)[number];

export type EndpointTestTarget =
  | { kind: 'managed'; siteId: string; accountId: string }
  | { kind: 'direct'; configId: string };

export interface EndpointTestApiKeyOption {
  id: string;
  label: string;
  group?: string;
  models?: string[];
}

export interface EndpointTestResult {
  success: boolean;
  endpoint: string;
  apiKeyId: string;
  apiKeyLabel: string;
  model: string;
  testedAt: number;
  latencyMs: number;
  statusCode?: number;
  summary?: string;
  error?: string;
}

export interface EndpointTestSelectionState {
  apiKeyId: string | null;
  model: string | null;
  latest?: EndpointTestResult;
}

export interface EndpointTestTargetState {
  targetKey: string;
  protocols: Partial<Record<EndpointTestProtocol, EndpointTestSelectionState>>;
  updatedAt: number;
}

export interface EndpointTestStateView {
  target: EndpointTestTarget;
  targetKey: string;
  apiKeys: EndpointTestApiKeyOption[];
  models: string[];
  protocols: Record<EndpointTestProtocol, EndpointTestSelectionState>;
}

export interface EndpointTestSelectionInput {
  target: EndpointTestTarget;
  protocol: EndpointTestProtocol;
  apiKeyId: string;
  model: string;
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

export const ROUTE_HISTORY_ENDPOINTS = [
  '/v1/messages',
  '/v1/responses',
  '/v1/chat/completions',
] as const;

export type RouteHistoryEndpoint = (typeof ROUTE_HISTORY_ENDPOINTS)[number];

export const ROUTE_HISTORY_ENDPOINT_LABELS: Record<RouteHistoryEndpoint, string> = {
  '/v1/messages': 'Anthropic',
  '/v1/responses': 'OpenAI',
  '/v1/chat/completions': 'OpenAI Chat',
};

export const UNKNOWN_ROUTE_HISTORY_ENDPOINT = '未知端点';

export function normalizeRouteHistoryEndpoint(value: unknown): string {
  if (typeof value !== 'string') return '';
  const rawEndpoint = value.trim();
  if (!rawEndpoint || rawEndpoint === UNKNOWN_ROUTE_HISTORY_ENDPOINT) return '';

  const withoutOrigin = rawEndpoint.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, '');
  const pathOnly = withoutOrigin.split(/[?#]/, 1)[0]?.trim() || '';
  if (!pathOnly) return '';

  const normalized = `${pathOnly.startsWith('/') ? '' : '/'}${pathOnly}`
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  return normalized === '/v1/chat/completion' ? '/v1/chat/completions' : normalized;
}

export function getRouteHistoryEndpointLabel(value: unknown): string {
  const rawEndpoint = typeof value === 'string' ? value.trim() : '';
  if (!rawEndpoint) return UNKNOWN_ROUTE_HISTORY_ENDPOINT;
  const normalized = normalizeRouteHistoryEndpoint(rawEndpoint);
  return ROUTE_HISTORY_ENDPOINT_LABELS[normalized as RouteHistoryEndpoint] || rawEndpoint;
}

export function compareRouteHistoryEndpoints(left: string, right: string): number {
  const leftIndex = ROUTE_HISTORY_ENDPOINTS.indexOf(
    normalizeRouteHistoryEndpoint(left) as RouteHistoryEndpoint
  );
  const rightIndex = ROUTE_HISTORY_ENDPOINTS.indexOf(
    normalizeRouteHistoryEndpoint(right) as RouteHistoryEndpoint
  );
  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  }
  return left.localeCompare(right);
}

/** History 时间桶数据结构 */
export interface HistoryBucket {
  bucketStart: number;
  bucketEnd: number;
  successRate: number | null;
  routeCount: number;
}

export interface HistoryEndpointTrack {
  targetEndpoint: string;
  buckets: HistoryBucket[];
}

/** History 时间桶查询参数 */
export interface RouteHistoryBucketsQuery {
  window: '48h';
  bucketSize: '2h';
  siteId?: string;
  accountId?: string;
}

/** 小时级分析桶 */
export interface RouteAnalyticsBucket {
  bucketKey: string;
  bucketStart: number;
  bucketSize: 'hour';
  cliType: RouteCliType;
  targetProtocol?: CliTargetProtocol;
  targetEndpoint?: string;
  routeRuleId?: string;
  canonicalModel?: string;
  siteId?: string;
  accountId?: string;
  apiKeyId?: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  neutralCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cachedTokens?: number;
  estimatedCostUsd?: number;
  statusCodeHistogram: Record<string, number>;
  latencyHistogram: Record<string, number>;
  firstByteHistogram: Record<string, number>;
  updatedAt: number;
}

/** 单条路由请求日志（当前运行会话内存态） */
export type RouteRequestKind = 'inference' | 'token-count';
export type RouteTokenUsageSource = 'upstream' | 'local-estimate';

export interface RouteRequestLogItem {
  id: string;
  requestId: string;
  requestSelectionStartedAt?: number;
  attempt: number;
  cliType: RouteCliType;
  agentId?: string;
  agentName?: string;
  targetProtocol?: CliTargetProtocol;
  targetEndpoint?: string;
  requestedModel?: string | null;
  reasoningEffort?: string;
  canonicalModel?: string | null;
  routeRuleId?: string;
  routeRuleName?: string;
  siteId?: string;
  siteName?: string;
  accountId?: string;
  accountName?: string;
  userGroupKey?: string;
  apiKeyId?: string;
  apiKeyName?: string;
  resolvedModel?: string;
  outcome: RouteOutcome;
  statusCode?: number;
  latencyMs?: number;
  firstByteLatencyMs?: number;
  requestKind?: RouteRequestKind;
  tokenUsageSource?: RouteTokenUsageSource;
  estimatedInputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cachedTokens?: number;
  estimatedCostUsd?: number;
  error?: string;
  createdAt: number;
}

/** 路由请求日志查询参数 */
export interface RouteRequestLogQuery {
  limit?: number;
  cliType?: RouteCliType;
  outcome?: RouteOutcome;
  routeRuleId?: string;
  siteId?: string;
}

export type RouteAnalyticsObjectStatsSort = 'requests' | 'tokens' | 'failureRisk' | 'successRate';

export type RouteAnalyticsWindow = '24h' | '7d';

export interface RouteAnalyticsWindowQuery {
  window: RouteAnalyticsWindow;
  cliType?: RouteCliType;
  routeRuleId?: string;
  canonicalModel?: string;
  siteId?: string;
}

export interface RouteAnalyticsSummary {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  neutralCount: number;
  successRate: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cachedTokens: number;
  estimatedCostUsd?: number;
}

export interface RouteAnalyticsDistribution {
  buckets: RouteAnalyticsBucket[];
  statusCodeHistogram: Record<string, number>;
  latencyHistogram: Record<string, number>;
  firstByteHistogram: Record<string, number>;
}

export interface RouteAnalyticsOverview {
  summary: RouteAnalyticsSummary;
  distribution: RouteAnalyticsDistribution;
}

export interface RouteAnalyticsObjectStatsQuery {
  window: RouteAnalyticsWindow;
  limit?: number;
  sortBy?: RouteAnalyticsObjectStatsSort;
}

export interface RouteAnalyticsObjectStatsItem {
  id: string;
  siteId?: string;
  siteName: string;
  accountId?: string;
  accountName: string;
  apiKeyId?: string;
  apiKeyName: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  neutralCount: number;
  successRate: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cachedTokens?: number;
  estimatedCostUsd?: number;
  lastUsedAt?: number;
  lastFailureAt?: number;
}

// ============= 顶层配置 =============

/** 路由模块配置（持久化到 config.json.routing） */
export interface RoutingConfig {
  server: RouteProxyServerConfig;
  rules: RouteRule[];
  cliModelSelections: Record<RouteCliType, string | null>;
  cliThinkingEffortSelections: Record<RouteCliType, RouteThinkingEffort | null>;
  sessionRouting?: RouteSessionRoutingConfig;
  stats: Record<string, RouteChannelStats>;
  routePathStates: Record<string, RoutePathState>;
  routeEndpointCapabilities?: Record<string, RouteEndpointCapabilityState>;
  health: Record<string, RouteChannelHealth>;
  modelRegistry: RouteModelRegistryConfig;
  endpointTests: Record<string, EndpointTestTargetState>;
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
  upstreamProxyUrl: '',
  requestTimeoutMs: 60000,
  retryCount: 1,
  healthCheckIntervalMinutes: 60,
};

export const DEFAULT_ANALYTICS_CONFIG: RouteAnalyticsConfig = {
  enabled: true,
  retentionDays: 7,
  bucketSizeMinutes: 60,
  recordTokenUsage: true,
  recordStatusCode: true,
  recordLatencyHistogram: true,
  latencyHistogramBuckets: [1000, 3000, 5000, 8000, 15000, 30000],
  firstByteHistogramBuckets: [200, 500, 1000, 3000, 5000, 10000],
};

export const ROUTE_SUCCESSFUL_PATH_AFFINITY_MS = 30 * 60 * 1000;

export const DEFAULT_MODEL_REGISTRY_CONFIG: RouteModelRegistryConfig = {
  version: 1,
  sources: [],
  entries: {},
  overrides: [],
  displayItems: [],
  vendorPriorities: {},
};

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  server: DEFAULT_ROUTE_PROXY_SERVER_CONFIG,
  rules: [],
  cliModelSelections: { claudeCode: null, codex: null, openCode: null, grokBuild: null },
  cliThinkingEffortSelections: {
    claudeCode: null,
    codex: null,
    openCode: null,
    grokBuild: null,
  },
  sessionRouting: DEFAULT_ROUTE_SESSION_ROUTING_CONFIG,
  stats: {},
  routePathStates: {},
  routeEndpointCapabilities: {},
  health: {},
  modelRegistry: DEFAULT_MODEL_REGISTRY_CONFIG,
  endpointTests: {},
  analytics: {
    config: DEFAULT_ANALYTICS_CONFIG,
    buckets: {},
  },
};

export function isRouteThinkingEffortPreset(
  value: string
): value is (typeof ROUTE_THINKING_EFFORT_LEVELS)[number] {
  return (ROUTE_THINKING_EFFORT_LEVELS as readonly string[]).includes(value);
}

export function normalizeRouteThinkingEffort(value: unknown): RouteThinkingEffort | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  if (isRouteThinkingEffortPreset(lower)) {
    return lower;
  }

  // Keep custom freeform values as-is (trimmed).
  return trimmed;
}

export function normalizeRouteThinkingEffortSelections(
  selections: Partial<Record<RouteCliType, unknown>> | null | undefined
): Record<RouteCliType, RouteThinkingEffort | null> {
  return {
    claudeCode: normalizeRouteThinkingEffort(selections?.claudeCode),
    codex: normalizeRouteThinkingEffort(selections?.codex),
    openCode: normalizeRouteThinkingEffort(selections?.openCode),
    grokBuild: normalizeRouteThinkingEffort(selections?.grokBuild),
  };
}

// ============= 工具函数 =============

export function buildStatsKey(key: RouteChannelKey): string {
  const targetProtocol = normalizeCliTargetProtocol(
    (key as RouteChannelKey & { targetProtocol?: CliTargetProtocol }).targetProtocol
  );
  return `${key.routeRuleId}:${key.siteId}:${key.accountId}:${key.apiKeyId}:${targetProtocol}`;
}

export function buildRoutePathStateKey(
  key: Omit<RouteChannelKey, 'routeRuleId'> & {
    routeRuleId?: string;
    canonicalModel?: string;
    resolvedModel?: string;
    targetProtocol?: CliTargetProtocol;
  }
): string {
  const canonicalModel = encodeURIComponent(key.canonicalModel || '*');
  const resolvedModel = encodeURIComponent(key.resolvedModel || '*');
  const targetProtocol = encodeURIComponent(normalizeCliTargetProtocol(key.targetProtocol));
  return `${key.routeRuleId}|${key.siteId}|${key.accountId}|${key.apiKeyId}|${targetProtocol}|${canonicalModel}|${resolvedModel}`;
}

export function buildRouteEndpointCapabilityKey(
  key: Pick<RouteEndpointCapabilityState, 'siteId' | 'accountId' | 'apiKeyId' | 'cliType'> & {
    targetProtocol?: CliTargetProtocol;
    endpoint: RouteEndpointCapabilityName;
  }
): string {
  const targetProtocol = encodeURIComponent(normalizeCliTargetProtocol(key.targetProtocol));
  return `${key.siteId}|${key.accountId}|${key.apiKeyId}|${key.cliType}|${targetProtocol}|${key.endpoint}`;
}

export function parseStatsKey(
  key: string
): (RouteChannelKey & { targetProtocol?: CliTargetProtocol }) | null {
  const parts = key.split(':');
  if (parts.length !== 4 && parts.length !== 5) return null;
  return {
    routeRuleId: parts[0],
    siteId: parts[1],
    accountId: parts[2],
    apiKeyId: parts[3],
    ...(parts.length === 5 ? { targetProtocol: normalizeCliTargetProtocol(parts[4]) } : {}),
  };
}

export function buildProbeKey(
  siteId: string,
  accountId: string,
  cliType: RouteCliType,
  canonicalModel: string,
  targetProtocol: CliTargetProtocol = DEFAULT_CLI_TARGET_PROTOCOL
): string {
  return `${siteId}:${accountId}:${cliType}:${normalizeCliTargetProtocol(targetProtocol)}:${canonicalModel}`;
}

export function buildSiteScopedProbeAccountId(siteId: string): string {
  return `site::${siteId}`;
}

export function buildBucketKey(
  bucketStart: number,
  cliType: RouteCliType,
  targetProtocol: CliTargetProtocol = DEFAULT_CLI_TARGET_PROTOCOL,
  canonicalModel?: string,
  siteId?: string,
  accountId?: string,
  apiKeyId?: string,
  routeRuleId?: string,
  targetEndpoint?: string
): string {
  return `${bucketStart}:${cliType}:${normalizeCliTargetProtocol(targetProtocol)}:${canonicalModel || '*'}:${siteId || '*'}:${accountId || '*'}:${apiKeyId || '*'}:${routeRuleId || '*'}:${targetEndpoint || '*'}`;
}

/** CLI 类型对应的请求路径前缀 */
export const CLI_TYPE_PATH_MAP: Record<RouteCliType, string[]> = {
  claudeCode: ['/v1/messages'],
  codex: ['/v1/responses'],
  openCode: ['/v1/messages', '/v1/chat/completions', '/v1/responses'],
  grokBuild: ['/v1/messages', '/v1/chat/completions', '/v1/responses'],
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

export function inferRouteModelVendor(model: string): RouteModelVendor {
  const name = model.trim().toLowerCase();

  for (const { vendor, prefixes } of VENDOR_MATCH_RULES) {
    if (prefixes.some(prefix => prefix.test(name))) {
      return vendor;
    }
  }

  for (const { vendor, keywords } of VENDOR_MATCH_RULES) {
    if (keywords.some(keyword => keyword.test(name))) {
      return vendor;
    }
  }

  return 'unknown';
}

export function normalizeRouteCliSelection(
  selectedModel: string | null | undefined,
  entries: Record<string, RouteModelRegistryEntry>
): string | null {
  const normalizedSelection = selectedModel?.trim();
  if (!normalizedSelection) {
    return null;
  }

  for (const entry of Object.values(entries)) {
    if (
      entry.canonicalName === normalizedSelection ||
      entry.aliases.includes(normalizedSelection)
    ) {
      return entry.canonicalName;
    }
  }

  return normalizedSelection;
}

export const ROUTE_MODEL_VENDOR_ORDER: RouteModelVendor[] = [
  'claude',
  'gpt',
  'gemini',
  'grok',
  'deepseek',
  'qwen',
  'glm',
  'minimax',
  'mistral',
  'llama',
  'unknown',
];

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeIntegerConfigValue(
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return clampNumber(Math.floor(value as number), min, max);
}

export function normalizeRouteRuntimeConfig(
  value: Partial<RouteRuntimeConfig> | null | undefined
): RouteRuntimeConfig {
  const minSuccessRateValue = Number(value?.minSuccessRate);
  const minSuccessRate = Number.isFinite(minSuccessRateValue)
    ? clampNumber(minSuccessRateValue, 0, 1)
    : DEFAULT_ROUTE_RUNTIME_CONFIG.minSuccessRate;

  return {
    maxAttemptsPerRoutePath: normalizeIntegerConfigValue(
      Number(value?.maxAttemptsPerRoutePath),
      DEFAULT_ROUTE_RUNTIME_CONFIG.maxAttemptsPerRoutePath,
      1,
      10
    ),
    successRateWindowMinutes: normalizeIntegerConfigValue(
      Number(value?.successRateWindowMinutes),
      DEFAULT_ROUTE_RUNTIME_CONFIG.successRateWindowMinutes,
      1,
      24 * 60
    ),
    disableDurationMinutes: normalizeIntegerConfigValue(
      Number(value?.disableDurationMinutes),
      DEFAULT_ROUTE_RUNTIME_CONFIG.disableDurationMinutes,
      1,
      24 * 60
    ),
    minSuccessRate,
  };
}

const ROUTE_MODEL_VENDOR_PRIORITY_PATTERNS: Partial<Record<RouteModelVendor, string[]>> = {
  gpt: ['gpt-5-4-pro', 'gpt-5-4', 'o3', 'gpt-5', 'gpt-5-4-mini', 'gpt-4-1', 'gpt-4o'],
  claude: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-haiku-4',
  ],
  gemini: [
    'gemini-3-1-pro',
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-3-1-flash-live',
    'gemini-3-1-flash-lite',
    'gemini-2-5-pro',
    'gemini-2-5-flash',
  ],
  grok: [
    'grok-4-20-multi-agent',
    'grok-4-20-reasoning',
    'grok-4-1-fast-reasoning',
    'grok-4-20',
    'grok-4-fast',
    'grok-4',
  ],
  deepseek: ['deepseek-reasoner', 'deepseek-r1', 'deepseek-chat', 'deepseek-v3-2', 'deepseek-v3'],
  qwen: [
    'qwen3-max',
    'qwen3-6-plus',
    'qwen3-coder-plus',
    'qwen3-coder-next',
    'qwen-max',
    'qwen-plus',
    'qwen-turbo',
  ],
  glm: ['glm-5-1', 'glm-5', 'glm-4-7', 'glm-4-5', 'glm-4-plus', 'glm-4-air', 'glm-4-flash'],
  minimax: ['minimax-m2-7', 'm2-7', 'minimax-m2-5', 'm2-5', 'minimax-m2-1', 'm2-1', 'm2'],
  mistral: [
    'mistral-large-3',
    'magistral-medium-1-2',
    'devstral-2',
    'mistral-medium-3-1',
    'mistral-small-4',
    'codestral',
  ],
  llama: [
    'llama-4-maverick',
    'meta-llama-4-maverick',
    'llama-4-scout',
    'meta-llama-4-scout',
    'llama-3-3',
    'meta-llama-3-3',
    'llama-3-1',
  ],
};

const ROUTE_MODEL_GENERIC_TIER_KEYWORDS: Array<[string, number]> = [
  ['multi-agent', 160],
  ['reasoning', 150],
  ['opus', 145],
  ['max', 140],
  ['ultra', 136],
  ['pro', 130],
  ['large', 126],
  ['maverick', 124],
  ['sonnet', 120],
  ['scout', 116],
  ['plus', 112],
  ['medium', 108],
  ['coder', 104],
  ['haiku', 100],
  ['mini', 96],
  ['flash', 92],
  ['lite', 88],
  ['small', 84],
  ['turbo', 80],
];

export function normalizeComparableRouteModelName(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^[^/]+\//, '')
    .replace(/@[\w.-]+$/, '')
    .replace(/:[\w.-]+$/, '')
    .replace(/(\d)\.(\d)/g, '$1-$2')
    .replace(/-(\d{8})$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getRouteModelPriorityIndex(vendor: RouteModelVendor, model: string): number {
  const normalized = normalizeComparableRouteModelName(model);
  const patterns = ROUTE_MODEL_VENDOR_PRIORITY_PATTERNS[vendor] ?? [];
  const index = patterns.findIndex(
    pattern =>
      normalized === pattern || normalized.startsWith(`${pattern}-`) || normalized.includes(pattern)
  );

  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function getRouteModelTierScore(model: string): number {
  const normalized = normalizeComparableRouteModelName(model);
  return ROUTE_MODEL_GENERIC_TIER_KEYWORDS.reduce((score, [keyword, weight]) => {
    return normalized.includes(keyword) ? score + weight : score;
  }, 0);
}

function getRouteModelVersionScore(model: string): number {
  const segments = normalizeComparableRouteModelName(model)
    .match(/\d+/g)
    ?.map(segment => Number(segment)) ?? [0];

  return segments.reduce((score, segment, index) => score + segment / 10 ** (index * 2), 0);
}

function getComparableEntryNames(entry: RouteModelRegistryEntry): string[] {
  return Array.from(new Set([entry.canonicalName, ...entry.aliases]));
}

function getBestEntryPriorityIndex(
  vendor: RouteModelVendor,
  entry: RouteModelRegistryEntry
): number {
  return getComparableEntryNames(entry).reduce((best, modelName) => {
    return Math.min(best, getRouteModelPriorityIndex(vendor, modelName));
  }, Number.POSITIVE_INFINITY);
}

function getBestEntryTierScore(entry: RouteModelRegistryEntry): number {
  return getComparableEntryNames(entry).reduce((best, modelName) => {
    return Math.max(best, getRouteModelTierScore(modelName));
  }, 0);
}

function getBestEntryVersionScore(entry: RouteModelRegistryEntry): number {
  return getComparableEntryNames(entry).reduce((best, modelName) => {
    return Math.max(best, getRouteModelVersionScore(modelName));
  }, 0);
}

export function compareRouteModelRegistryEntries(
  vendor: RouteModelVendor,
  left: RouteModelRegistryEntry,
  right: RouteModelRegistryEntry
): number {
  const leftPriority = getBestEntryPriorityIndex(vendor, left);
  const rightPriority = getBestEntryPriorityIndex(vendor, right);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  const leftTier = getBestEntryTierScore(left);
  const rightTier = getBestEntryTierScore(right);
  if (leftTier !== rightTier) {
    return rightTier - leftTier;
  }

  const leftVersion = getBestEntryVersionScore(left);
  const rightVersion = getBestEntryVersionScore(right);
  if (leftVersion !== rightVersion) {
    return rightVersion - leftVersion;
  }

  if (left.sources.length !== right.sources.length) {
    return right.sources.length - left.sources.length;
  }

  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }

  return left.canonicalName.localeCompare(right.canonicalName);
}
