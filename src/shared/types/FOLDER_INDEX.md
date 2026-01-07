# 📁 src/shared/types/ - 共享类型定义

## 架构说明

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
| **site.ts** | 站点相关类型 | Site, SiteGroup, SiteStatus, CheckinStats, LdcPaymentInfo, cached_data (含 status/error) 等 |
| **cli-config.ts** | CLI 配置类型 | CliConfig, CliCompatibility 等 |
| **config-detection.ts** | CLI 配置检测类型 | ConfigSourceType, CliDetectionResult, AllCliDetectionResult 等 |
| **credit.ts** | Linux Do Credit 积分类型 | CreditInfo, CreditConfig, CreditState, CreditResponse 等 |

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
  // LDC 支付信息
  ldcPaymentSupported?: boolean;  // 是否支持 LDC 支付
  ldcExchangeRate?: string;       // 兑换比例（LDC:站点余额）
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

// LDC 支付相关类型
interface PayMethod {
  name: string;   // 支付方式名称，如 "Linuxdo Credit"
  type: string;   // 支付方式类型，如 "epay"
}

interface TopupInfoApiResponse {
  success: boolean;
  message: string;
  data: {
    amount_options: number[];
    pay_methods: PayMethod[];
    // ... 其他字段
  };
}

interface AmountApiResponse {
  success?: boolean;
  message?: string;
  data: string;   // 兑换比例，如 "10.00"
}

interface LdcPaymentInfo {
  ldcPaymentSupported: boolean;
  ldcExchangeRate?: string;
}
```

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

### cli-config.ts - CLI 配置类型

**职责**: 定义 CLI 工具配置相关类型

**关键类型**:
```typescript
// CLI 工具类型
type CliTool = 'claude-code' | 'codex' | 'gemini-cli' | 'chat';

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

// CLI 兼容性信息
interface CliCompatibility {
  tool: CliTool;
  supported: boolean;
  version?: string;
  features?: string[];
  error?: string;
}

// CLI 兼容性测试结果
interface CliCompatibilityResult {
  siteId: string;
  siteName: string;
  compatibility: CliCompatibility[];
  timestamp: number;
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

// 兼容性信息
const compatibility: CliCompatibility = {
  tool: 'claude-code',
  supported: true,
  version: '1.0.0',
  features: ['streaming', 'function-calling']
};

// 兼容性测试结果
const result: CliCompatibilityResult = {
  siteId: 'site-1',
  siteName: 'One API',
  compatibility: [compatibility],
  timestamp: Date.now()
};
```

### credit.ts - Linux Do Credit 积分类型

**职责**: 定义 Linux Do Credit 积分检测功能相关类型

**关键类型**:
```typescript
// 积分信息（完整版）
interface CreditInfo {
  // 基础信息
  id: number;                 // 用户 ID
  username: string;           // 用户名
  nickname: string;           // 昵称
  avatarUrl: string;          // 头像 URL
  trustLevel: number;         // 信任等级 (0-4)
  
  // 积分信息
  communityBalance: number;   // 基准值（Credit 余额）
  gamificationScore: number;  // 当前分（论坛积分）
  difference: number;         // 差值（实时收入/支出）
  
  // 收支信息
  totalReceive: string;       // 总收入
  totalPayment: string;       // 总支出
  totalTransfer: string;      // 总转账
  totalCommunity: string;     // 社区总额
  availableBalance: string;   // 可用余额
  
  // 支付信息
  payScore: number;           // 支付评分
  payLevel: number;           // 支付等级
  isPayKey: boolean;          // 是否有支付密钥
  remainQuota: string;        // 剩余配额
  dailyLimit: number;         // 每日限额
  
  // 状态信息
  isAdmin: boolean;           // 是否管理员
  lastUpdated: number;        // 最后更新时间戳
}

// 积分配置
interface CreditConfig {
  enabled: boolean;           // 是否启用
  autoRefresh: boolean;       // 是否自动刷新
  refreshInterval: number;    // 刷新间隔（秒），最小30秒
}

// 积分状态
interface CreditState {
  isLoggedIn: boolean;        // 是否已登录
  isLoading: boolean;         // 是否正在加载
  error: string | null;       // 错误信息
  creditInfo: CreditInfo | null;
  config: CreditConfig;
}

// 每日统计项
interface DailyStatItem {
  date: string;               // 日期，格式: "2025-12-24"
  income: string;             // 收入金额
  expense: string;            // 支出金额
}

// 每日统计数据
interface DailyStats {
  items: DailyStatItem[];     // 每日统计项列表
  totalIncome: number;        // 总收入（计算值）
  totalExpense: number;       // 总支出（计算值）
  lastUpdated: number;        // 最后更新时间戳
}

// 交易订单
interface TransactionOrder {
  id: string;                 // 订单 ID
  order_no: string;           // 订单号
  order_name: string;         // 订单名称
  amount: string;             // 金额
  status: TransactionStatus;  // 交易状态
  type: TransactionType;      // 交易类型
  trade_time: string;         // 交易时间
  // ... 更多字段
}

// 交易记录列表
interface TransactionList {
  total: number;              // 总数
  page: number;               // 当前页码
  pageSize: number;           // 每页数量
  orders: TransactionOrder[]; // 订单列表
  lastUpdated: number;        // 最后更新时间戳
}

// 统一响应格式
interface CreditResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// IPC 通道常量
const CREDIT_CHANNELS = {
  FETCH_CREDIT: 'credit:fetch',
  FETCH_DAILY_STATS: 'credit:fetch-daily-stats',
  FETCH_TRANSACTIONS: 'credit:fetch-transactions',
  LOGIN: 'credit:login',
  LOGOUT: 'credit:logout',
  GET_STATUS: 'credit:get-status',
  SAVE_CONFIG: 'credit:save-config',
  LOAD_CONFIG: 'credit:load-config',
  GET_CACHED: 'credit:get-cached',
  INITIATE_RECHARGE: 'credit:initiate-recharge',
} as const;

// 充值 API 请求体
interface PayApiRequest {
  amount: number;             // 充值金额（站点余额单位）
}

// 充值 API 响应体
interface PayApiResponse {
  success?: boolean;
  message: string;
  data: {
    device: string;           // 设备类型
    money: string;            // 支付金额
    name: string;             // 订单名称
    notify_url: string;       // 通知回调 URL
    out_trade_no: string;     // 订单号
    pid: string;              // 支付 ID
    return_url: string;       // 返回 URL
    sign: string;             // 签名
    sign_type: string;        // 签名类型
    type: string;             // 支付类型
  };
  url: string;                // 支付提交 URL
}

// 充值请求参数（前端使用）
interface RechargeRequest {
  siteUrl: string;            // 站点 URL
  amount: number;             // 充值金额
  token: string;              // 站点认证 token
}

// 充值响应（IPC 返回）
interface RechargeResponse {
  success: boolean;
  paymentUrl?: string;        // 支付页面 URL
  error?: string;
}
```

**使用示例**:
```typescript
// 积分信息
const creditInfo: CreditInfo = {
  id: 139654,
  username: 'testuser',
  nickname: 'Test User',
  avatarUrl: 'https://linux.do/user_avatar/...',
  trustLevel: 3,
  communityBalance: 1000,
  gamificationScore: 1050,
  difference: 50,
  totalReceive: '66',
  totalPayment: '25.1',
  totalTransfer: '0',
  totalCommunity: '16',
  availableBalance: '40.9',
  payScore: 25,
  payLevel: 0,
  isPayKey: true,
  remainQuota: '1000',
  dailyLimit: 1000,
  isAdmin: false,
  lastUpdated: Date.now()
};

// 积分配置
const creditConfig: CreditConfig = {
  enabled: true,
  autoRefresh: true,
  refreshInterval: 60
};

// 每日统计
const dailyStats: DailyStats = {
  items: [
    { date: '2025-12-24', income: '10', expense: '5.1' },
    { date: '2025-12-25', income: '0', expense: '0' }
  ],
  totalIncome: 10,
  totalExpense: 5.1,
  lastUpdated: Date.now()
};

// 交易记录
const transactions: TransactionList = {
  total: 2,
  page: 1,
  pageSize: 10,
  orders: [...],
  lastUpdated: Date.now()
};

// 统一响应
const response: CreditResponse<CreditInfo> = {
  success: true,
  data: creditInfo
};
```

---

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
├── ldcPaymentSupported?: boolean
├── ldcExchangeRate?: string
└── checkinStats?: CheckinStats

CachedData (缓存数据扩展)
├── status?: string           // 检测状态：'成功' | '失败'
└── error?: string            // 错误信息（仅失败时有值）

CheckinStats (签到统计数据)
├── todayQuota?: number
├── checkinCount?: number
├── totalCheckins?: number
└── siteType?: 'veloera' | 'newapi'

CliConfig (CLI 配置)
├── tool: CliTool
├── enabled: boolean
├── model?: string
├── apiKey?: string
└── baseUrl?: string

CliCompatibility (CLI 兼容性)
├── tool: CliTool
├── supported: boolean
├── version?: string
└── features?: string[]

CreditInfo (积分信息)
├── id: number
├── username: string
├── nickname: string
├── avatarUrl: string
├── trustLevel: number
├── communityBalance: number
├── gamificationScore: number
├── difference: number
├── totalReceive: string
├── totalPayment: string
├── totalTransfer: string
├── totalCommunity: string
├── availableBalance: string
├── payScore: number
├── payLevel: number
├── isPayKey: boolean
├── remainQuota: string
├── dailyLimit: number
├── isAdmin: boolean
└── lastUpdated: number

CreditConfig (积分配置)
├── enabled: boolean
├── autoRefresh: boolean
└── refreshInterval: number

CreditState (积分状态)
├── isLoggedIn: boolean
├── isLoading: boolean
├── error: string | null
├── creditInfo: CreditInfo | null
└── config: CreditConfig

DailyStatItem (每日统计项)
├── date: string
├── income: string
└── expense: string

DailyStats (每日统计数据)
├── items: DailyStatItem[]
├── totalIncome: number
├── totalExpense: number
└── lastUpdated: number

TransactionOrder (交易订单)
├── id: string
├── order_no: string
├── order_name: string
├── amount: string
├── status: TransactionStatus
├── type: TransactionType
├── trade_time: string
└── ... (更多字段)

TransactionList (交易记录列表)
├── total: number
├── page: number
├── pageSize: number
├── orders: TransactionOrder[]
└── lastUpdated: number
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

**版本**: 2.1.10  
**更新日期**: 2026-01-07
