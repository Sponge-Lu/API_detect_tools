/**
 * 应用全局常量
 * 集中管理硬编码值，提高代码可读性和可维护性
 */

// ============= 网络相关 =============

/** Chrome 调试端口 */
export const CHROME_DEBUG_PORT = 9222;

/** 默认 API 请求超时时间（秒） */
export const DEFAULT_API_TIMEOUT = 30;

/** 浏览器页面加载超时时间（毫秒） */
export const PAGE_LOAD_TIMEOUT = 30000;

/** 网络空闲等待超时（毫秒） */
export const NETWORK_IDLE_TIMEOUT = 3000;

/** 等待端口就绪最大时间（毫秒） */
export const PORT_READY_TIMEOUT = 5000;

/** 等待端口释放最大时间（毫秒） */
export const PORT_FREE_TIMEOUT = 3000;

/** Protocol 超时时间（毫秒） */
export const PROTOCOL_TIMEOUT = 60000;

// ============= 登录和验证相关 =============

/** 等待用户登录最大时间（毫秒，10分钟） */
export const MAX_LOGIN_WAIT_TIME = 600000;

/** 等待 Cloudflare 验证最大时间（毫秒，10分钟） */
export const MAX_CLOUDFLARE_WAIT_TIME = 600000;

/** 登录状态检查间隔（毫秒） */
export const LOGIN_CHECK_INTERVAL = 2000;

/** API 回退检查间隔（每 N 次 localStorage 检查后尝试 API） */
export const API_FALLBACK_CHECK_INTERVAL = 5;

/** Cloudflare 验证检查间隔（毫秒） */
export const CLOUDFLARE_CHECK_INTERVAL = 2000;

/** 验证完成后额外等待时间（毫秒） */
export const POST_VERIFICATION_DELAY = 2000;

// ============= 浏览器管理相关 =============

/** 浏览器关闭延迟时间（毫秒，引用计数为0后延迟关闭） */
export const BROWSER_CLEANUP_DELAY = 5000;

/** 浏览器重试延迟（毫秒） */
export const BROWSER_RETRY_DELAY = 1000;

/** 页面稳定等待时间（毫秒） */
export const PAGE_STABLE_DELAY = 500;

// ============= 数据换算相关 =============

/** 额度换算系数：1 美元 = 500000 内部单位 */
export const QUOTA_CONVERSION_FACTOR = 500000;

/** 默认汇率（CNY per USD） */
export const DEFAULT_EXCHANGE_RATE = 7.0;

// ============= UI 相关 =============

/** 刷新提示显示时间（毫秒） */
export const REFRESH_MESSAGE_DURATION = 3000;

/** Toast 显示时间（毫秒） */
export const TOAST_DURATION = 3000;

/** 复制成功提示持续时间（毫秒） */
export const COPY_SUCCESS_DURATION = 1000;

/** 默认窗口宽度 */
export const DEFAULT_WINDOW_WIDTH = 1280;

/** 默认窗口高度 */
export const DEFAULT_WINDOW_HEIGHT = 800;

// ============= 分页相关 =============

/** 日志查询每页条数 */
export const LOG_PAGE_SIZE = 100;

/** 日志查询最大页数 */
export const LOG_MAX_PAGES = 100;

// ============= 备份相关 =============

/** 备份保留数量 */
export const BACKUP_RETENTION_COUNT = 10;

/** 备份目录名 */
export const BACKUP_DIR_NAME = '.api-hub-management-tools';

// ============= HTTP 状态码 =============

/** 致命 HTTP 状态码列表（遇到这些状态码应停止重试） */
export const FATAL_HTTP_STATUS_CODES = [400, 401, 403, 500, 502, 503, 504, 522] as const;

/** 认证错误状态码 */
export const AUTH_ERROR_STATUS_CODES = [401, 403] as const;

// ============= API 端点 =============

/** 用户模型列表端点（按优先级排序） */
export const USER_MODELS_ENDPOINTS = [
  '/api/user/models',
  '/api/user/available_models',
  '/api/available_model',
] as const;

/** 用户信息端点（按优先级排序） */
export const USER_INFO_ENDPOINTS = ['/api/user/self', '/api/user/dashboard'] as const;

/** OpenAI 兼容模型端点 */
export const OPENAI_MODELS_ENDPOINT = '/v1/models';

/** 站点状态端点 */
export const SITE_STATUS_ENDPOINT = '/api/status';

/** 用户令牌端点 */
export const USER_TOKEN_ENDPOINT = '/api/user/token';

// ============= 主题相关 =============

/** 深色主题背景色 */
export const DARK_THEME_BG_COLOR = '#1a1b1e';

/** 浅色主题背景色 */
export const LIGHT_THEME_BG_COLOR = '#f8fafc';

// ============= 站点列表默认列宽 =============

/** 站点列表默认列宽（像素） */
export const DEFAULT_COLUMN_WIDTHS = [
  110, // 站点
  70, // 状态
  90, // 余额
  75, // 今日消费
  70, // 总 Token
  70, // 输入
  70, // 输出
  55, // 请求
  55, // RPM
  55, // TPM
  50, // 模型数
  60, // 更新时间
] as const;

/** 列宽最小值 */
export const COLUMN_MIN_WIDTH = 50;

/** 列宽最大值 */
export const COLUMN_MAX_WIDTH = 320;
