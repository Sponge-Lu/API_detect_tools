/**
 * 输入: 无 (纯类型定义)
 * 输出: TypeScript 类型和接口 (Site, SiteGroup, AccountCredential, DetectionResult, CheckinStats, LdcPaymentInfo 等)
 * 定位: 类型定义层 - 定义主进程和渲染进程共享的数据模型
 *
 * 多账户支持: AccountCredential 存储多账户凭证，UnifiedSite.active_account_id 指向当前激活账户
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/shared/types/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

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

/** Codex 详细测试结果 */
export interface CodexTestDetail {
  responses: boolean | null; // Responses API 测试结果
}

/** Gemini CLI 详细测试结果 */
export interface GeminiTestDetail {
  native: boolean | null; // Google 原生格式测试结果
  proxy: boolean | null; // OpenAI 兼容格式测试结果
}

/** CLI 兼容性数据 */
export interface CliCompatibilityData {
  claudeCode: boolean | null;
  codex: boolean | null;
  codexDetail?: CodexTestDetail; // Codex 详细测试结果（responses）
  geminiCli: boolean | null;
  geminiDetail?: GeminiTestDetail; // Gemini CLI 详细测试结果（native/proxy）
  testedAt: number | null;
  error?: string;
}

/** 签到统计数据 (New API 格式) */
export interface CheckinStats {
  /** 今日签到获得金额 (内部单位，需要 /500000 转换为美元) */
  todayQuota?: number;
  /** 当月签到次数 */
  checkinCount?: number;
  /** 累计签到次数 */
  totalCheckins?: number;
  /** 站点类型 */
  siteType?: 'veloera' | 'newapi';
}

// ============= LDC 支付类型 =============

/** 支付方式 */
export interface PayMethod {
  name: string; // 支付方式名称，如 "Linuxdo Credit"
  type: string; // 支付方式类型，如 "epay"
}

/** 充值信息 API 响应 - /api/user/topup/info */
export interface TopupInfoApiResponse {
  success: boolean;
  message: string;
  data: {
    amount_options: number[]; // 充值金额选项 [10, 20, 50, 100, 200, 500]
    creem_products: string; // Creem 产品配置
    discount: Record<string, unknown>; // 折扣配置
    enable_creem_topup: boolean; // 是否启用 Creem 充值
    enable_online_topup: boolean; // 是否启用在线充值
    enable_stripe_topup: boolean; // 是否启用 Stripe 充值
    min_topup: number; // 最小充值金额
    pay_methods: PayMethod[]; // 支付方式列表
    stripe_min_topup: number; // Stripe 最小充值金额
  };
}

/** 兑换比例 API 响应 - /api/user/amount */
export interface AmountApiResponse {
  success?: boolean;
  message?: string;
  data: string; // 兑换比例，如 "10.00" 表示 10 LDC = 1 站点余额
}

/** LDC 支付信息 */
export interface LdcPaymentInfo {
  ldcPaymentSupported: boolean; // 是否支持 LDC 支付
  ldcExchangeRate?: string; // 兑换比例（LDC:站点余额）
  ldcPaymentType?: string; // 支付方式类型，如 "epay"
}

/** 单个 CLI 配置项 */
export interface CliConfigItem {
  apiKeyId: number | null;
  model: string | null;
  enabled: boolean; // 是否启用（控制图标显示和测试）
}

/** CLI 配置数据 */
export interface CliConfigData {
  claudeCode: CliConfigItem;
  codex: CliConfigItem;
  geminiCli: CliConfigItem;
}

/** 默认 CLI 配置 - 所有 CLI 默认启用 */
export const DEFAULT_CLI_CONFIG_DATA: CliConfigData = {
  claudeCode: { apiKeyId: null, model: null, enabled: true },
  codex: { apiKeyId: null, model: null, enabled: true },
  geminiCli: { apiKeyId: null, model: null, enabled: true },
};

// ============= 多账户类型 =============

/** 账户认证来源 */
export type AccountAuthSource = 'main_profile' | 'isolated_profile' | 'manual';

/** 账户状态 */
export type AccountStatus = 'active' | 'expired' | 'revoked';

/**
 * 账户凭证 - 存储在 config.json 的多账户数据
 * 与 SiteAccount（TokenService 运行时 DTO）不同，这是持久化存储格式
 */
export interface AccountCredential {
  id: string;
  site_id: string; // 关联 UnifiedSite.id
  account_name: string; // UI 显示名
  user_id: string;
  username?: string;
  access_token: string;
  auth_source: AccountAuthSource;
  status: AccountStatus;
  browser_profile_path?: string; // isolated profile 持久化路径
  cached_data?: DetectionCacheData; // 账户级检测缓存
  metadata?: {
    oauth_provider?: 'github' | 'linuxdo';
    supports_checkin?: boolean;
  };
  created_at: number;
  updated_at: number;
}

/** 生成唯一账户ID */
export function generateAccountId(): string {
  return `acct_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============= 检测缓存数据 =============

/** 检测结果缓存（账户级或站点级） */
export interface DetectionCacheData {
  models?: string[];
  balance?: number;
  today_usage?: number;
  today_prompt_tokens?: number;
  today_completion_tokens?: number;
  today_requests?: number;
  api_keys?: ApiKeyInfo[];
  user_groups?: Record<string, UserGroupInfo>;
  model_pricing?: ModelPricingData;
  last_refresh?: number;
  can_check_in?: boolean;
  cli_compatibility?: CliCompatibilityData;
  ldc_payment_supported?: boolean;
  ldc_exchange_rate?: string;
  ldc_payment_type?: string;
  checkin_stats?: {
    today_quota?: number;
    checkin_count?: number;
    total_checkins?: number;
    site_type?: 'veloera' | 'newapi';
  };
  status?: string;
  error?: string;
  endpoint_hints?: {
    models_endpoint?: string;
    balance_endpoint?: string;
  };
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

  // === 多账户 ===
  active_account_id?: string; // 当前激活的账户 ID

  // === 认证信息（legacy projection，始终同步为 active account 的值） ===
  access_token?: string; // 系统访问令牌
  user_id?: string; // 用户ID

  // === API 配置 ===
  api_key?: string; // API Key（可选）

  // === 扩展配置 ===
  extra_links?: string; // 加油站链接
  has_checkin?: boolean; // 是否支持签到（检测结果）
  force_enable_checkin?: boolean; // 强制启用签到
  auto_refresh?: boolean; // 站点独立的自动刷新开关
  auto_refresh_interval?: number; // 自动刷新间隔（分钟），最小15分钟

  // === CLI 配置（保存在站点配置中，备份时不会丢失） ===
  cli_config?: CliConfigData;

  // === 检测结果缓存（无账户站点的 legacy fallback） ===
  cached_data?: DetectionCacheData;

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

/** 内建分组 ID */
export const BUILTIN_GROUP_IDS = {
  DEFAULT: 'default',
  UNAVAILABLE: 'unavailable',
} as const;

/** 应用设置 */
export interface Settings {
  timeout: number;
  concurrent: boolean;
  max_concurrent?: number;
  show_disabled: boolean;
  browser_path?: string;
  webdav?: WebDAVConfig;
  browser_profile?: {
    main_profile_path?: string; // 用户主 Chrome Profile 路径（自动检测或手动配置）
    isolated_root_dir?: string; // 隔离 Profile 存储根目录
  };
}

// ============= WebDAV 类型 =============

/** WebDAV 连接配置 */
export interface WebDAVConfig {
  enabled: boolean;
  serverUrl: string;
  username: string;
  password: string; // 存储时 Base64 编码
  remotePath: string; // 默认 '/api-hub-backups'
  maxBackups: number; // 默认 10
}

/** WebDAV 备份文件信息 */
export interface WebDAVBackupInfo {
  filename: string;
  path: string;
  lastModified: Date;
  size: number;
}

/** WebDAV 操作结果 */
export interface WebDAVResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/** WebDAV 配置默认值 */
export const DEFAULT_WEBDAV_CONFIG: WebDAVConfig = {
  enabled: false,
  serverUrl: '',
  username: '',
  password: '',
  remotePath: '/api-hub-backups',
  maxBackups: 10,
};

/** 填充 WebDAV 配置默认值 */
export function fillWebDAVConfigDefaults(partial: Partial<WebDAVConfig>): WebDAVConfig {
  return {
    enabled: partial.enabled ?? DEFAULT_WEBDAV_CONFIG.enabled,
    serverUrl: partial.serverUrl ?? DEFAULT_WEBDAV_CONFIG.serverUrl,
    username: partial.username ?? DEFAULT_WEBDAV_CONFIG.username,
    password: partial.password ?? DEFAULT_WEBDAV_CONFIG.password,
    remotePath: partial.remotePath ?? DEFAULT_WEBDAV_CONFIG.remotePath,
    maxBackups: partial.maxBackups ?? DEFAULT_WEBDAV_CONFIG.maxBackups,
  };
}

/**
 * 统一配置文件结构 - config.json
 */
export interface UnifiedConfig {
  version: string;
  sites: UnifiedSite[];
  accounts: AccountCredential[]; // 多账户凭证存储
  siteGroups: SiteGroup[];
  settings: Settings;
  last_updated: number;
}

// ============= 前端兼容类型 =============

/**
 * 站点配置 - 前端使用的格式
 */
export interface SiteConfig {
  id?: string; // 站点 ID（从统一配置传入，多账户操作需要）
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
  auto_refresh?: boolean; // 站点独立的自动刷新开关
  auto_refresh_interval?: number; // 自动刷新间隔（分钟），最小15分钟
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
  lastRefresh?: number;
  // 多账户: 标识此结果属于哪个账户（per-account 检测）
  accountId?: string;
  // LDC 支付信息
  ldcPaymentSupported?: boolean;
  ldcExchangeRate?: string;
  ldcPaymentType?: string;
  // 签到统计数据 (New API 类型站点)
  checkinStats?: CheckinStats;
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
  // LDC 支付信息
  ldcPaymentSupported?: boolean; // 是否支持 LDC 支付
  ldcExchangeRate?: string; // 兑换比例（LDC:站点余额）
  ldcPaymentType?: string; // 支付方式类型，如 "epay"
  // 签到统计数据 (New API)
  checkinStats?: CheckinStats;
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
