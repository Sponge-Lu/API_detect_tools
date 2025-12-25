# 📁 src/shared/constants/ - 常量定义

## 架构说明

**职责**: 定义应用全局常量

**特点**:
- 集中管理常量
- 被 `main/` 和 `renderer/` 使用
- 易于维护和修改
- 支持类型安全

**依赖关系**:
- 被 `main/` 和 `renderer/` 导入
- 不依赖其他模块
- 可独立维护

---

## 📂 文件清单

### 核心常量文件

| 文件 | 职责 | 关键常量 |
|------|------|--------|
| **index.ts** | 常量导出入口 | 所有常量的统一导出 |

---

## 🔢 常量详解

### API 端点常量

```typescript
// API 站点端点
export const API_ENDPOINTS = {
  ONE_API: 'https://api.one-api.com',
  NEW_API: 'https://api.new-api.com',
  VELOERA: 'https://api.veloera.com',
  DONE_HUB: 'https://api.done-hub.com',
  // ... 其他站点
} as const;

// API 路径
export const API_PATHS = {
  USER_INFO: '/api/user/info',
  BALANCE: '/api/user/balance',
  USAGE: '/api/user/usage',
  SIGN_IN: '/api/user/sign-in',
  MODELS: '/api/models',
  // ... 其他路径
} as const;
```

### 超时和并发常量

```typescript
// 超时时间 (毫秒)
export const TIMEOUTS = {
  API_REQUEST: 30000,        // API 请求超时
  BROWSER_LAUNCH: 60000,     // 浏览器启动超时
  BROWSER_LOGIN: 120000,     // 浏览器登录超时
  DETECTION: 30000,          // 检测超时
  BACKUP_UPLOAD: 60000,      // 备份上传超时
} as const;

// 并发限制
export const CONCURRENCY = {
  MAX_PARALLEL_REQUESTS: 5,   // 最大并发请求数
  MAX_BROWSER_INSTANCES: 3,   // 最大浏览器实例数
  MAX_DETECTION_TASKS: 10,    // 最大检测任务数
} as const;

// 重试配置
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,            // 最大重试次数
  INITIAL_DELAY: 1000,        // 初始延迟 (毫秒)
  MAX_DELAY: 10000,           // 最大延迟 (毫秒)
  BACKOFF_MULTIPLIER: 2,      // 退避倍数
} as const;
```

### 刷新和更新常量

```typescript
// 自动刷新配置
export const AUTO_REFRESH = {
  DEFAULT_INTERVAL: 60000,    // 默认刷新间隔 (毫秒)
  MIN_INTERVAL: 10000,        // 最小刷新间隔
  MAX_INTERVAL: 600000,       // 最大刷新间隔
} as const;

// 应用更新配置
export const UPDATE_CONFIG = {
  CHECK_INTERVAL: 3600000,    // 检查更新间隔 (1小时)
  DOWNLOAD_TIMEOUT: 300000,   // 下载超时 (5分钟)
} as const;
```

### CLI 工具常量

```typescript
// CLI 工具列表
export const CLI_TOOLS = [
  'claude-code',
  'codex',
  'gemini-cli',
  'chat'
] as const;

// CLI 工具配置
export const CLI_TOOL_CONFIG = {
  'claude-code': {
    name: 'Claude Code',
    description: 'Anthropic Claude Code',
    defaultModel: 'claude-3-5-sonnet'
  },
  'codex': {
    name: 'OpenAI Codex',
    description: 'OpenAI Codex',
    defaultModel: 'code-davinci-002'
  },
  'gemini-cli': {
    name: 'Google Gemini CLI',
    description: 'Google Gemini CLI',
    defaultModel: 'gemini-pro'
  },
  'chat': {
    name: 'Chat',
    description: 'Chat Interface',
    defaultModel: 'gpt-4'
  }
} as const;
```

### 存储和备份常量

```typescript
// 存储路径
export const STORAGE_PATHS = {
  CONFIG: 'config.json',
  BACKUP: 'backups',
  LOGS: 'logs',
  CACHE: 'cache',
  TEMP: 'temp'
} as const;

// 备份配置
export const BACKUP_CONFIG = {
  AUTO_BACKUP_INTERVAL: 3600000,  // 自动备份间隔 (1小时)
  MAX_BACKUPS: 10,                // 最大备份数
  BACKUP_RETENTION_DAYS: 30,      // 备份保留天数
} as const;

// WebDAV 配置
export const WEBDAV_CONFIG = {
  SYNC_INTERVAL: 1800000,         // 同步间隔 (30分钟)
  UPLOAD_TIMEOUT: 60000,          // 上传超时
  DOWNLOAD_TIMEOUT: 60000,        // 下载超时
} as const;
```

### UI 和主题常量

```typescript
// 主题配置
export const THEME_CONFIG = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system'
} as const;

// 语言配置
export const LANGUAGE_CONFIG = {
  ZH_CN: 'zh-CN',
  EN_US: 'en-US'
} as const;

// 颜色方案
export const COLOR_SCHEMES = {
  PRIMARY: '#3B82F6',
  SUCCESS: '#10B981',
  WARNING: '#F59E0B',
  ERROR: '#EF4444',
  INFO: '#06B6D4'
} as const;
```

### 日志和调试常量

```typescript
// 日志级别
export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
} as const;

// 日志配置
export const LOG_CONFIG = {
  MAX_LOG_SIZE: 10 * 1024 * 1024,  // 10MB
  MAX_LOG_FILES: 5,
  LOG_RETENTION_DAYS: 7
} as const;
```

### 应用版本常量

```typescript
// 应用版本
export const APP_VERSION = '2.1.8';

// 应用信息
export const APP_INFO = {
  NAME: 'API Hub Management Tools',
  VERSION: APP_VERSION,
  AUTHOR: 'API Hub Team',
  HOMEPAGE: 'https://github.com/Sponge-Lu/API_detect_tools',
  ISSUES: 'https://github.com/Sponge-Lu/API_detect_tools/issues'
} as const;
```

---

## 🔄 使用示例

### 在主进程中使用

```typescript
// src/main/api-service.ts
import { API_ENDPOINTS, TIMEOUTS, RETRY_CONFIG } from '../shared/constants';

async function checkBalance(site: Site) {
  const baseUrl = API_ENDPOINTS[site.name];
  const endpoint = API_PATHS.BALANCE;
  
  return retry(
    () => timeout(
      axios.get(`${baseUrl}${endpoint}`),
      TIMEOUTS.API_REQUEST
    ),
    { maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS }
  );
}
```

### 在渲染进程中使用

```typescript
// src/renderer/hooks/useAutoRefresh.ts
import { AUTO_REFRESH } from '../../shared/constants';

export function useAutoRefresh() {
  const [interval, setInterval] = useState(AUTO_REFRESH.DEFAULT_INTERVAL);
  
  const handleSetInterval = (newInterval: number) => {
    if (newInterval < AUTO_REFRESH.MIN_INTERVAL) {
      newInterval = AUTO_REFRESH.MIN_INTERVAL;
    }
    if (newInterval > AUTO_REFRESH.MAX_INTERVAL) {
      newInterval = AUTO_REFRESH.MAX_INTERVAL;
    }
    setInterval(newInterval);
  };
  
  return { interval, handleSetInterval };
}
```

---

## 🎯 最佳实践

### 1. 使用 `as const` 保证类型安全

```typescript
// ✅ 好：使用 as const
export const TIMEOUTS = {
  API_REQUEST: 30000,
  BROWSER_LAUNCH: 60000
} as const;

// 现在 TIMEOUTS.API_REQUEST 的类型是 30000，而不是 number

// ❌ 不好：不使用 as const
export const TIMEOUTS = {
  API_REQUEST: 30000,
  BROWSER_LAUNCH: 60000
};

// TIMEOUTS.API_REQUEST 的类型是 number
```

### 2. 分组相关常量

```typescript
// ✅ 好：按功能分组
export const TIMEOUTS = { /* ... */ };
export const CONCURRENCY = { /* ... */ };
export const AUTO_REFRESH = { /* ... */ };

// ❌ 不好：混乱的常量
export const TIMEOUT_API = 30000;
export const TIMEOUT_BROWSER = 60000;
export const MAX_REQUESTS = 5;
```

### 3. 添加注释

```typescript
// ✅ 好：添加注释说明
export const TIMEOUTS = {
  API_REQUEST: 30000,        // API 请求超时 (毫秒)
  BROWSER_LAUNCH: 60000,     // 浏览器启动超时 (毫秒)
} as const;
```

### 4. 避免硬编码

```typescript
// ✅ 好：使用常量
const interval = AUTO_REFRESH.DEFAULT_INTERVAL;

// ❌ 不好：硬编码
const interval = 60000;
```

---

## 🧪 常量测试

### 测试示例

```typescript
// src/__tests__/constants.test.ts
import { TIMEOUTS, CONCURRENCY, CLI_TOOLS } from '../shared/constants';

describe('Constants', () => {
  it('should have valid timeout values', () => {
    expect(TIMEOUTS.API_REQUEST).toBeGreaterThan(0);
    expect(TIMEOUTS.BROWSER_LAUNCH).toBeGreaterThan(0);
  });

  it('should have valid concurrency values', () => {
    expect(CONCURRENCY.MAX_PARALLEL_REQUESTS).toBeGreaterThan(0);
    expect(CONCURRENCY.MAX_BROWSER_INSTANCES).toBeGreaterThan(0);
  });

  it('should have all CLI tools', () => {
    expect(CLI_TOOLS).toContain('claude-code');
    expect(CLI_TOOLS).toContain('codex');
  });
});
```

---

## 📈 扩展指南

### 添加新常量

1. 在 `constants/index.ts` 中添加新常量
2. 使用 `as const` 保证类型安全
3. 添加注释说明
4. 编写单元测试

### 模板

```typescript
// 新常量的模板
export const NEW_FEATURE_CONFIG = {
  /** 配置项1 的描述 */
  OPTION_1: 'value1',
  
  /** 配置项2 的描述 */
  OPTION_2: 1000,
  
  /** 配置项3 的描述 */
  OPTION_3: true
} as const;
```

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/shared/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.8  
**更新日期**: 2025-12-24
