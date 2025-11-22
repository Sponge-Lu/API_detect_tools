/**
 * 令牌管理相关类型定义 - 精简版
 * 遵循单一数据源原则，减少冗余
 */

// 站点健康状态
export type SiteHealthStatus = "healthy" | "warning" | "error" | "unknown";

export interface HealthStatus {
  status: SiteHealthStatus;
  reason?: string;
}

/**
 * 站点账号 - 唯一的持久化数据结构
 * 存储在 token-storage.json 中
 */
export interface SiteAccount {
  // === 核心标识 ===
  id: string;                    // 唯一ID
  site_name: string;             // 站点名称
  site_url: string;              // 站点URL
  site_type: string;             // 站点类型 (newapi/oneapi等)
  
  // === 认证信息 (持久化到文件) ===
  user_id: number;               // 用户ID
  username: string;              // 用户名
  access_token: string;          // 系统访问令牌 (用于管理接口)
  
  // === 元数据 ===
  created_at: number;            // 创建时间戳
  updated_at: number;            // 更新时间戳
  last_sync_time: number;        // 最后同步时间戳
  
  // === 可选配置 ===
  exchange_rate?: number;        // 汇率 (CNY per USD)
  notes?: string;                // 用户备注
  health?: HealthStatus;         // 健康状态
  // 最近一次检测结果（用于界面恢复状态）
  last_detection_status?: string; // 上次检测状态（成功/失败）
  last_detection_error?: string;  // 上次检测错误信息
  
  // === 旧字段兼容 (保留以支持现有代码) ===
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

/**
 * UI缓存数据 - 仅存在于内存，不持久化
 * 用于显示在界面上的实时数据
 */
export interface CachedDisplayData {
  quota: number;                          // 账户余额
  today_quota_consumption: number;        // 今日消费额度
  today_prompt_tokens: number;            // 今日prompt tokens
  today_completion_tokens: number;        // 今日completion tokens
  today_requests_count: number;           // 今日请求次数
  apiKeys?: any[];                        // API密钥列表
  userGroups?: Record<string, {           // 用户分组信息
    desc: string;
    ratio: number;
  }>;
  modelPricing?: any;                     // 模型定价信息
  models?: string[];                      // 可用模型列表
  lastRefresh: number;                    // 最后刷新时间戳
  can_check_in?: boolean;                 // 是否可签到
}

/**
 * 存储配置 - token-storage.json 的结构
 */
export interface StorageConfig {
  accounts: SiteAccount[];
  last_updated: number;
}

/**
 * API 响应类型 - 通用
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

/**
 * 刷新结果
 */
export interface RefreshAccountResult {
  success: boolean;
  data?: CachedDisplayData;
  healthStatus: HealthCheckResult;
}

/**
 * 健康检查结果
 */
export interface HealthCheckResult {
  status: SiteHealthStatus;
  message: string;
}

/**
 * 站点配置（用于本地应用的简化格式）
 * 注意：这是渲染层使用的配置格式，与SiteAccount不同
 */
export interface SiteConfig {
  name: string;
  url: string;
  api_key: string;              // 用户创建的API Key (用于模型调用)
  system_token?: string;        // 系统访问令牌 (即access_token)
  user_id?: string;             // 用户ID (字符串格式)
  enabled: boolean;
  has_checkin?: boolean;        // 是否有签到功能（自动检测）
  force_enable_checkin?: boolean; // 用户手动启用签到
  extra_links?: string;         // 加油站链接（抽奖、额外签到等）
}