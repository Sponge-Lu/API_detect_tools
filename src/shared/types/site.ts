/**
 * 统一站点数据模型
 * 单一数据源：config.json
 */

// ============= 基础类型 =============

/** 站点健康状态 */
export type SiteHealthStatus = 'healthy' | 'warning' | 'error' | 'unknown';

/** 健康状态详情 */
export interface HealthStatus {
  status: SiteHealthStatus;
  reason?: string;
}

/** 用户分组信息 */
export interface UserGroupInfo {
  desc: string;
  ratio: number;
}

// ============= 统一站点类型 =============

/**
 * 统一站点配置 - 合并原 SiteConfig 和 SiteAccount
 * 单一数据源，消除数据不一致问题
 */
export interface UnifiedSite {
  // === 唯一标识 ===
  id: string; // 唯一ID，不再依赖URL匹配

  // === 基础配置 ===
  name: string;
  url: string;
  enabled: boolean;
  group: string; // 分组ID，默认 "default"

  // === 认证信息（原 token-storage） ===
  access_token?: string; // 系统访问令牌
  user_id?: string; // 用户ID

  // === API 配置 ===
  api_key?: string; // API Key（可选）

  // === 扩展配置 ===
  extra_links?: string; // 加油站链接
  has_checkin?: boolean; // 是否支持签到（检测结果）
  force_enable_checkin?: boolean; // 强制启用签到

  // === 检测结果缓存 ===
  cached_data?: {
    models: string[];
    balance?: number;
    today_usage?: number;
    today_prompt_tokens?: number;
    today_completion_tokens?: number;
    today_requests?: number;
    api_keys?: ApiKeyInfo[];
    user_groups?: Record<string, UserGroupInfo>;
    model_pricing?: ModelPricingData;
    last_refresh: number;
    can_check_in?: boolean;
  };

  // === 元数据 ===
  created_at?: number;
  updated_at?: number;
  last_sync_time?: number;
}

/** 站点分组 */
export interface SiteGroup {
  id: string;
  name: string;
}

/** 应用设置 */
export interface Settings {
  timeout: number;
  concurrent: boolean;
  max_concurrent?: number;
  show_disabled: boolean;
  auto_refresh: boolean;
  refresh_interval: number;
  browser_path?: string;
}

/**
 * 统一配置文件结构 - config.json
 */
export interface UnifiedConfig {
  version: string;
  sites: UnifiedSite[];
  siteGroups: SiteGroup[];
  settings: Settings;
  last_updated: number;
}

// ============= 前端兼容类型 =============

/**
 * 站点配置 - 前端使用的格式
 */
export interface SiteConfig {
  name: string;
  url: string;
  api_key: string;
  system_token?: string;
  user_id?: string;
  enabled: boolean;
  group?: string;
  has_checkin?: boolean;
  force_enable_checkin?: boolean;
  extra_links?: string;
}

/**
 * 站点账号 - TokenService 使用的格式
 */
export interface SiteAccount {
  id: string;
  name: string;
  url: string;
  site_name: string;
  site_url: string;
  site_type: string;
  user_id: number;
  username: string;
  access_token: string;
  created_at: number;
  updated_at: number;
  last_sync_time: number;
  exchange_rate?: number;
  notes?: string;
  health?: HealthStatus;
  last_detection_status?: string;
  last_detection_error?: string;
  account_info?: {
    id: number;
    access_token: string;
    username: string;
    quota: number;
    today_prompt_tokens: number;
    today_completion_tokens: number;
    today_quota_consumption: number;
    today_requests_count: number;
  };
  can_check_in?: boolean;
  supports_check_in?: boolean;
}

// ============= 检测结果类型 =============

/**
 * 检测结果 - 站点检测返回的数据
 */
export interface DetectionResult {
  name: string;
  url: string;
  status: string;
  models: string[];
  balance?: number;
  todayUsage?: number;
  todayPromptTokens?: number;
  todayCompletionTokens?: number;
  todayTotalTokens?: number;
  todayRequests?: number;
  error?: string;
  has_checkin: boolean;
  can_check_in?: boolean;
  apiKeys?: ApiKeyInfo[];
  userGroups?: Record<string, UserGroupInfo>;
  modelPricing?: ModelPricingData;
  lastRefresh?: number; // 最后刷新时间
}

// ============= 辅助类型 =============

/** API Key 信息 */
export interface ApiKeyInfo {
  id?: number;
  token_id?: number;
  name?: string;
  key?: string;
  token?: string;
  remain_quota?: number;
  unlimited_quota?: boolean;
  expired_time?: number;
  created_time?: number;
  group?: string;
  models?: string;
  status?: number;
}

/** 模型定价数据 */
export interface ModelPricingData {
  data?: Record<string, ModelPriceInfo>;
}

/** 单个模型价格信息 */
export interface ModelPriceInfo {
  input?: number;
  output?: number;
  group_ratio?: number;
}

/** 缓存的显示数据 */
export interface CachedDisplayData {
  quota: number;
  today_quota_consumption: number;
  today_prompt_tokens: number;
  today_completion_tokens: number;
  today_requests_count: number;
  apiKeys?: ApiKeyInfo[];
  userGroups?: Record<string, UserGroupInfo>;
  modelPricing?: ModelPricingData;
  models?: string[];
  lastRefresh: number;
  can_check_in?: boolean;
}

// ============= API 响应类型 =============

/** 通用 API 响应 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/** 刷新结果 */
export interface RefreshAccountResult {
  success: boolean;
  data?: CachedDisplayData;
  healthStatus: HealthCheckResult;
}

/** 健康检查结果 */
export interface HealthCheckResult {
  status: SiteHealthStatus;
  message: string;
}

// ============= 类型工具 =============

/** 从 UnifiedSite 提取用于显示的字段 */
export type SiteDisplayInfo = Pick<UnifiedSite, 'name' | 'url' | 'enabled' | 'group'>;

/** 从 DetectionResult 提取统计数据 */
export type SiteStats = Pick<
  DetectionResult,
  'balance' | 'todayUsage' | 'todayPromptTokens' | 'todayCompletionTokens' | 'todayRequests'
>;

/** 创建站点时的必填字段 */
export type CreateSiteInput = Pick<UnifiedSite, 'name' | 'url'> &
  Partial<Omit<UnifiedSite, 'name' | 'url' | 'id'>>;

// ============= 工具函数 =============

/** 生成唯一站点ID */
export function generateSiteId(): string {
  return `site_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
