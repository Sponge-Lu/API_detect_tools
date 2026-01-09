/**
 * 输入: 无 (纯类型定义)
 * 输出: TypeScript 类型和接口 (CreditInfo, CreditConfig, CreditState, CreditResponse, CreditLoginResult 等)
 * 定位: 类型定义层 - 定义 Linux Do Credit 积分检测功能的共享数据模型
 *       包含登录结果类型 CreditLoginResult，支持一次性返回所有数据
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/shared/types/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

// ============= IPC 通道常量 =============

/** Credit 相关 IPC 通道 */
export const CREDIT_CHANNELS = {
  /** 获取积分数据 */
  FETCH_CREDIT: 'credit:fetch',
  /** 获取每日统计数据 */
  FETCH_DAILY_STATS: 'credit:fetch-daily-stats',
  /** 获取交易记录 */
  FETCH_TRANSACTIONS: 'credit:fetch-transactions',
  /** 刷新所有数据（积分、每日统计、交易记录） */
  REFRESH_ALL: 'credit:refresh-all',
  /** 启动登录 */
  LOGIN: 'credit:login',
  /** 登出 */
  LOGOUT: 'credit:logout',
  /** 获取登录状态 */
  GET_STATUS: 'credit:get-status',
  /** 保存配置 */
  SAVE_CONFIG: 'credit:save-config',
  /** 加载配置 */
  LOAD_CONFIG: 'credit:load-config',
  /** 获取缓存数据 */
  GET_CACHED: 'credit:get-cached',
  /** 获取缓存的每日统计数据 */
  GET_CACHED_DAILY_STATS: 'credit:get-cached-daily-stats',
  /** 获取缓存的交易记录 */
  GET_CACHED_TRANSACTIONS: 'credit:get-cached-transactions',
  /** 发起充值 */
  INITIATE_RECHARGE: 'credit:initiate-recharge',
} as const;

/** IPC 通道类型 */
export type CreditChannel = (typeof CREDIT_CHANNELS)[keyof typeof CREDIT_CHANNELS];

// ============= 核心数据类型 =============

/**
 * 积分信息
 * 包含用户在 Linux Do Credit 平台的完整积分数据
 */
export interface CreditInfo {
  // 基础信息
  /** 用户 ID */
  id: number;
  /** 用户名 */
  username: string;
  /** 昵称 */
  nickname: string;
  /** 头像 URL */
  avatarUrl: string;
  /** 信任等级 (0-4) */
  trustLevel: number;

  // 积分信息
  /** 基准值（Credit 余额） - 来自 credit.linux.do */
  communityBalance: number;
  /** 当前分（论坛积分） - 来自 linux.do */
  gamificationScore: number;
  /** 差值（实时收入/支出） = gamificationScore - communityBalance */
  difference: number;

  // 收支信息
  /** 总收入 */
  totalReceive: string;
  /** 总支出 */
  totalPayment: string;
  /** 总转账 */
  totalTransfer: string;
  /** 社区总额 */
  totalCommunity: string;
  /** 可用余额 */
  availableBalance: string;

  // 支付信息
  /** 支付评分 */
  payScore: number;
  /** 支付等级 */
  payLevel: number;
  /** 是否有支付密钥 */
  isPayKey: boolean;
  /** 剩余配额 */
  remainQuota: string;
  /** 每日限额 */
  dailyLimit: number;

  // 状态信息
  /** 是否管理员 */
  isAdmin: boolean;
  /** 最后更新时间戳 */
  lastUpdated: number;
}

/**
 * 积分配置
 * 用户可配置的积分检测相关设置
 */
export interface CreditConfig {
  /** 是否启用积分检测功能 */
  enabled: boolean;
  /** 是否启用自动刷新 */
  autoRefresh: boolean;
  /** 刷新间隔（分钟），最小 5 分钟 */
  refreshInterval: number;
}

/**
 * 积分状态
 * 完整的积分检测状态，包含登录状态、加载状态、错误信息等
 */
export interface CreditState {
  /** 是否已登录 credit.linux.do */
  isLoggedIn: boolean;
  /** 是否正在加载数据 */
  isLoading: boolean;
  /** 错误信息，null 表示无错误 */
  error: string | null;
  /** 积分信息，null 表示未获取 */
  creditInfo: CreditInfo | null;
  /** 配置信息 */
  config: CreditConfig;
}

// ============= API 响应类型 =============

/**
 * 统一响应格式
 * 所有 IPC 处理器返回的标准格式
 */
export interface CreditResponse<T = unknown> {
  /** 操作是否成功 */
  success: boolean;
  /** 成功时的数据 */
  data?: T;
  /** 失败时的错误信息 */
  error?: string;
}

/**
 * credit.linux.do API 响应格式
 * /api/v1/oauth/user-info 接口返回的数据
 */
export interface CreditApiResponse {
  error_msg: string;
  data: {
    id: number;
    username: string;
    nickname: string;
    trust_level: number;
    avatar_url: string;
    total_receive: string;
    total_payment: string;
    total_transfer: string;
    total_community: string;
    community_balance: string;
    available_balance: string;
    pay_score: number;
    is_pay_key: boolean;
    is_admin: boolean;
    remain_quota: string;
    pay_level: number;
    daily_limit: number;
  };
}

/**
 * linux.do 用户信息 API 响应格式
 * /u/{username}.json 接口返回的数据
 */
export interface LinuxDoUserResponse {
  user: {
    username: string;
    gamification_score: number;
  };
}

// ============= 每日统计类型 =============

/**
 * 每日统计项
 * 单日的收入/支出数据
 */
export interface DailyStatItem {
  /** 日期，格式: "2025-12-24" */
  date: string;
  /** 收入金额，字符串格式如 "1" 或 "0" */
  income: string;
  /** 支出金额，字符串格式如 "5.1" 或 "0" */
  expense: string;
}

/**
 * 每日统计数据
 * 包含一段时间内的收支统计
 */
export interface DailyStats {
  /** 每日统计项列表 */
  items: DailyStatItem[];
  /** 总收入（计算值） */
  totalIncome: number;
  /** 总支出（计算值） */
  totalExpense: number;
  /** 最后更新时间戳 */
  lastUpdated: number;
}

/**
 * 每日统计 API 响应格式
 * /api/v1/dashboard/stats/daily 接口返回的数据
 */
export interface DailyStatsApiResponse {
  error_msg: string;
  data: DailyStatItem[];
}

// ============= 交易记录类型 =============

/** 交易状态 */
export type TransactionStatus = 'success' | 'failed' | 'pending';

/** 交易类型 */
export type TransactionType = 'payment' | 'transfer' | 'refund';

/**
 * 交易订单
 * 单笔交易的完整信息
 */
export interface TransactionOrder {
  /** 订单 ID */
  id: string;
  /** 订单号 */
  order_no: string;
  /** 订单名称 */
  order_name: string;
  /** 商户订单号 */
  merchant_order_no: string;
  /** 客户端 ID */
  client_id: string;
  /** 付款用户 ID */
  payer_user_id: number;
  /** 收款用户 ID */
  payee_user_id: number;
  /** 金额 */
  amount: string;
  /** 交易状态 */
  status: TransactionStatus;
  /** 交易类型 */
  type: TransactionType;
  /** 备注 */
  remark: string;
  /** 支付类型 */
  payment_type: string;
  /** 支付链接 ID */
  payment_link_id: string | null;
  /** 交易时间 */
  trade_time: string;
  /** 过期时间 */
  expires_at: string;
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
  /** 应用名称 */
  app_name: string;
  /** 应用主页 URL */
  app_homepage_url: string;
  /** 应用描述 */
  app_description: string;
  /** 重定向 URI */
  redirect_uri: string;
  /** 争议 ID */
  dispute_id: string | null;
  /** 付款用户名 */
  payer_username: string;
  /** 收款用户名 */
  payee_username: string;
  /** 付款用户头像 URL */
  payer_avatar_url: string;
  /** 收款用户头像 URL */
  payee_avatar_url: string;
}

/**
 * 交易记录列表
 * 包含分页信息的交易列表
 */
export interface TransactionList {
  /** 总数 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 订单列表 */
  orders: TransactionOrder[];
  /** 最后更新时间戳 */
  lastUpdated: number;
}

/**
 * 交易记录 API 请求格式
 * /api/v1/order/transactions POST 请求体
 */
export interface TransactionsApiRequest {
  page: number;
  page_size: number;
}

/**
 * 交易记录 API 响应格式
 * /api/v1/order/transactions 接口返回的数据
 */
export interface TransactionsApiResponse {
  error_msg: string;
  data: {
    total: number;
    page: number;
    page_size: number;
    orders: TransactionOrder[];
  };
}

// ============= 存储类型 =============

// ============= 充值相关类型 =============

/**
 * 充值 API 请求体
 * 调用站点 /api/user/pay 端点的请求格式
 */
export interface PayApiRequest {
  /** 充值金额（站点余额单位） */
  amount: number;
}

/**
 * 充值 API 响应体
 * 站点 /api/user/pay 端点返回的数据
 */
export interface PayApiResponse {
  /** 操作是否成功（可选，部分站点不返回此字段） */
  success?: boolean;
  /** 响应消息 */
  message: string;
  /** 支付数据 */
  data: {
    /** 设备类型，如 "pc" */
    device: string;
    /** 支付金额 */
    money: string;
    /** 订单名称，如 "TUC1" */
    name: string;
    /** 通知回调 URL */
    notify_url: string;
    /** 订单号，如 "USR808NOzABKYE1767090299" */
    out_trade_no: string;
    /** 支付 ID（加密） */
    pid: string;
    /** 支付完成后返回 URL */
    return_url: string;
    /** 签名，如 "bca16dd86b748245f6e4e18c490031df" */
    sign: string;
    /** 签名类型，如 "MD5" */
    sign_type: string;
    /** 支付类型，如 "epay" */
    type: string;
  };
  /** 支付提交 URL，如 "https://credit.linux.do/epay/pay/submit.php" */
  url: string;
}

/**
 * 充值请求参数（前端使用）
 * 发起充值时传递给 IPC 的参数
 */
export interface RechargeRequest {
  /** 站点 URL */
  siteUrl: string;
  /** 充值金额（站点余额单位） */
  amount: number;
  /** 站点认证 token */
  token: string;
  /** 用户 ID（用于 User-ID headers） */
  userId?: string;
  /** 支付方式类型（如 "epay"） */
  paymentType?: string;
}

/**
 * 充值响应（IPC 返回）
 * 充值操作的结果
 */
export interface RechargeResponse {
  /** 操作是否成功 */
  success: boolean;
  /** 完整的支付页面 URL（成功时返回） */
  paymentUrl?: string;
  /** 错误信息（失败时返回） */
  error?: string;
  /** 是否需要用户登录（浏览器已打开，等待用户登录） */
  needLogin?: boolean;
  /** 登录提示信息 */
  loginMessage?: string;
}

/**
 * Credit 存储数据格式
 * 持久化到 electron-store 的数据结构
 */
export interface CreditStorageData {
  /** 用户配置 */
  config: CreditConfig;
  /** 缓存的积分信息 */
  cachedInfo: CreditInfo | null;
  /** 缓存的每日统计数据 */
  cachedDailyStats: DailyStats | null;
  /** 缓存的交易记录 */
  cachedTransactions: TransactionList | null;
  /** 认证 cookies（加密存储） */
  cookies: string | null;
}

/**
 * 登录成功后返回的完整数据
 * 包含积分信息、每日统计和交易记录
 */
export interface CreditLoginResult {
  /** 积分信息 */
  creditInfo: CreditInfo;
  /** 每日统计数据 */
  dailyStats: DailyStats | null;
  /** 交易记录 */
  transactions: TransactionList | null;
}

// ============= 默认值 =============

/** 默认配置 */
export const DEFAULT_CREDIT_CONFIG: CreditConfig = {
  enabled: true,
  autoRefresh: false,
  refreshInterval: 5, // 默认 5 分钟
};

/** 最小刷新间隔（分钟） */
export const MIN_REFRESH_INTERVAL = 5;

// ============= 工具函数 =============

/**
 * 计算积分差值
 * @param gamificationScore 当前分（论坛积分）
 * @param communityBalance 基准值（Credit 余额）
 * @returns 差值
 */
export function calculateDifference(gamificationScore: number, communityBalance: number): number {
  return gamificationScore - communityBalance;
}

/**
 * 验证并修正刷新间隔
 * 确保刷新间隔不小于最小值
 * @param interval 用户输入的间隔
 * @returns 修正后的间隔
 */
export function clampRefreshInterval(interval: number): number {
  return Math.max(MIN_REFRESH_INTERVAL, interval);
}

/**
 * 获取差值的颜色类型
 * @param difference 差值
 * @returns 颜色类型：'positive' | 'negative' | 'neutral'
 */
export function getDifferenceColorType(difference: number): 'positive' | 'negative' | 'neutral' {
  if (difference > 0) return 'positive';
  if (difference < 0) return 'negative';
  return 'neutral';
}

/**
 * 填充默认配置
 * @param partial 部分配置
 * @returns 完整配置
 */
export function fillCreditConfigDefaults(partial: Partial<CreditConfig>): CreditConfig {
  return {
    enabled: partial.enabled ?? DEFAULT_CREDIT_CONFIG.enabled,
    autoRefresh: partial.autoRefresh ?? DEFAULT_CREDIT_CONFIG.autoRefresh,
    refreshInterval: clampRefreshInterval(
      partial.refreshInterval ?? DEFAULT_CREDIT_CONFIG.refreshInterval
    ),
  };
}

// ============= 每日统计工具函数 =============

/**
 * 计算每日统计的总收入
 * @param items 每日统计项列表
 * @returns 总收入
 */
export function calculateTotalIncome(items: DailyStatItem[]): number {
  return items.reduce((sum, item) => sum + parseFloat(item.income || '0'), 0);
}

/**
 * 计算每日统计的总支出
 * @param items 每日统计项列表
 * @returns 总支出
 */
export function calculateTotalExpense(items: DailyStatItem[]): number {
  return items.reduce((sum, item) => sum + parseFloat(item.expense || '0'), 0);
}

/**
 * 格式化日期为 MM/DD 格式
 * @param dateStr 日期字符串，格式: "2025-12-24"
 * @returns 格式化后的日期，如 "12/24"
 */
export function formatDateToMMDD(dateStr: string): string {
  // 验证输入格式是否为 YYYY-MM-DD
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  const parts = dateStr.split('-');
  const month = parts[1];
  const day = parts[2];
  return `${month}/${day}`;
}

/**
 * 格式化每日收入值（带 + 前缀）
 * @param income 收入值字符串
 * @returns 格式化后的值，如 "+10.00"
 */
export function formatDailyIncome(income: string): string {
  const value = parseFloat(income || '0');
  if (value === 0) return '0';
  return `+${value.toFixed(2)}`;
}

/**
 * 格式化每日支出值（带 - 前缀）
 * @param expense 支出值字符串
 * @returns 格式化后的值，如 "-5.10"
 */
export function formatDailyExpense(expense: string): string {
  const value = parseFloat(expense || '0');
  if (value === 0) return '0';
  return `-${value.toFixed(2)}`;
}

// ============= 交易记录工具函数 =============

/**
 * 获取交易状态的显示文本
 * @param status 交易状态
 * @returns 显示文本
 */
export function getTransactionStatusText(status: TransactionStatus): string {
  switch (status) {
    case 'success':
      return '成功';
    case 'failed':
      return '失败';
    case 'pending':
      return '待处理';
    default:
      return status;
  }
}

/**
 * 获取交易状态的颜色类型
 * @param status 交易状态
 * @returns 颜色类型
 */
export function getTransactionStatusColor(
  status: TransactionStatus
): 'success' | 'error' | 'warning' {
  switch (status) {
    case 'success':
      return 'success';
    case 'failed':
      return 'error';
    case 'pending':
      return 'warning';
    default:
      return 'warning';
  }
}

/**
 * 格式化交易金额（带 LDC 前缀）
 * @param amount 金额字符串
 * @returns 格式化后的金额，如 "LDC 0.1"
 */
export function formatTransactionAmount(amount: string): string {
  return `LDC ${amount}`;
}

/**
 * 格式化交易数量显示
 * @param count 交易数量
 * @returns 格式化后的文本，如 "活动  2"
 */
export function formatTransactionCount(count: number): string {
  return `活动  ${count}`;
}
