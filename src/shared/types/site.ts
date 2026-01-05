/**
 * 输入: 无 (纯类型定义)
 * 输出: TypeScript 类型和接口 (Site, SiteGroup, SiteStatus, DetectionResult, LdcPaymentInfo 等)
 * 定位: 类型定义层 - 定义主进程和渲染进程共享的数据模型
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
  chat: boolean | null; // Chat Completions API 测试结果
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
  codexDetail?: CodexTestDetail; // Codex 详细测试结果（chat/responses）
  geminiCli: boolean | null;
  geminiDetail?: GeminiTestDetail; // Gemini CLI 详细测试结果（native/proxy）
  testedAt: number | null;
  error?: string;
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
  auto_refresh?: boolean; // 站点独立的自动刷新开关
  auto_refresh_interval?: number; // 自动刷新间隔（分钟），最小3分钟

  // === CLI 配置（保存在站点配置中，备份时不会丢失） ===
  cli_config?: CliConfigData;

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
    cli_compatibility?: CliCompatibilityData;
    // LDC 支付信息
    ldc_payment_supported?: boolean; // 是否支持 LDC 支付
    ldc_exchange_rate?: string; // 兑换比例（LDC:站点余额）
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
  browser_path?: string;
  webdav?: WebDAVConfig;
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
  auto_refresh?: boolean; // 站点独立的自动刷新开关
  auto_refresh_interval?: number; // 自动刷新间隔（分钟），最小3分钟
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
  // LDC 支付信息
  ldcPaymentSupported?: boolean; // 是否支持 LDC 支付
  ldcExchangeRate?: string; // 兑换比例（LDC:站点余额）
  ldcPaymentType?: string; // 支付方式类型，如 "epay"
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
