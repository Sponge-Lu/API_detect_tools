# 📁 src/shared/utils/ - 共享工具函数

## 架构说明

**职责**: 提供主进程和渲染进程共享的工具函数

**特点**:
- 纯函数，无副作用
- 不依赖 Electron 或 React
- 被 `main/` 和 `renderer/` 使用
- 支持通用的工具操作

**依赖关系**:
- 被 `main/` 和 `renderer/` 导入
- 不依赖其他模块
- 可独立测试

---

## 📂 文件清单

### 核心工具文件

| 文件 | 职责 | 关键函数 |
|------|------|--------|
| **customCliRouteId.ts** | 自定义 CLI 路由通道合成 ID（site/account/apiKey）跨进程命名约定；统一前缀与 encode/decode | `buildCustomCliRouteSiteId()`, `parseCustomCliRouteConfigId()`, `isCustomCliRouteChannel()` |
| **headers.ts** | HTTP 请求头管理 | `getDefaultHeaders()`, `getAuthHeaders()` |
| **log-filter.ts** | 日志过滤和格式化 | `filterModelLogs()`, `maskSensitiveInfo()` |

---

## 🛠️ 工具函数详解

### headers.ts - HTTP 请求头管理

**职责**: 生成和管理 HTTP 请求头

**关键函数**:
```typescript
// 获取默认请求头
export function getDefaultHeaders(): Record<string, string> {
  return {
    'User-Agent': 'API Hub Management Tools/2.1.8',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip, deflate'
  };
}

// 获取认证请求头
export function getAuthHeaders(token: string): Record<string, string> {
  return {
    ...getDefaultHeaders(),
    'Authorization': `Bearer ${token}`
  };
}

// 获取 API Key 请求头
export function getApiKeyHeaders(apiKey: string): Record<string, string> {
  return {
    ...getDefaultHeaders(),
    'X-API-Key': apiKey
  };
}

// 合并请求头
export function mergeHeaders(
  ...headersList: Record<string, string>[]
): Record<string, string> {
  return Object.assign({}, ...headersList);
}

// 移除敏感请求头
export function removeSensitiveHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const sensitiveKeys = ['Authorization', 'X-API-Key', 'Cookie'];
  const filtered = { ...headers };
  
  sensitiveKeys.forEach(key => {
    delete filtered[key];
  });
  
  return filtered;
}
```

**使用示例**:
```typescript
// 获取默认请求头
const headers = getDefaultHeaders();

// 添加认证信息
const authHeaders = getAuthHeaders('sk-...');

// 添加 API Key
const apiKeyHeaders = getApiKeyHeaders('api-key-...');

// 合并多个请求头
const mergedHeaders = mergeHeaders(
  getDefaultHeaders(),
  { 'X-Custom-Header': 'value' }
);

// 移除敏感信息用于日志
const safeHeaders = removeSensitiveHeaders(headers);
```

### log-filter.ts - 日志过滤和格式化

**职责**: 过滤敏感信息和格式化日志

**关键函数**:
```typescript
// 过滤模型日志
export function filterModelLogs(logs: string[]): string[] {
  return logs.map(log => maskSensitiveInfo(log));
}

// 掩盖敏感信息
export function maskSensitiveInfo(text: string): string {
  // 掩盖 Token
  text = text.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***');
  
  // 掩盖 API Key
  text = text.replace(/api[_-]?key[=:]\s*[a-zA-Z0-9]{20,}/gi, 'api_key=***');
  
  // 掩盖密码
  text = text.replace(/password[=:]\s*[^\s,}]+/gi, 'password=***');
  
  // 掩盖邮箱
  text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '***@***.***');
  
  // 掩盖 URL 中的敏感参数
  text = text.replace(/([?&])(token|key|secret|password)=[^&\s]*/gi, '$1$2=***');
  
  return text;
}

// 格式化日志条目
export function formatLogEntry(
  level: string,
  message: string,
  timestamp?: Date
): string {
  const time = timestamp || new Date();
  const timeStr = time.toISOString();
  return `[${timeStr}] [${level}] ${message}`;
}

// 提取日志中的错误信息
export function extractErrorInfo(log: string): {
  message: string;
  stack?: string;
} {
  const lines = log.split('\n');
  const message = lines[0];
  const stack = lines.slice(1).join('\n');
  
  return {
    message: maskSensitiveInfo(message),
    stack: stack ? maskSensitiveInfo(stack) : undefined
  };
}

// 检查日志是否包含敏感信息
export function hasSensitiveInfo(text: string): boolean {
  const sensitivePatterns = [
    /sk-[a-zA-Z0-9]{20,}/,           // Token
    /api[_-]?key[=:]\s*[^\s,}]+/i,   // API Key
    /password[=:]\s*[^\s,}]+/i,      // Password
    /Bearer\s+[a-zA-Z0-9._-]+/       // Bearer Token
  ];
  
  return sensitivePatterns.some(pattern => pattern.test(text));
}

// 清理日志中的敏感信息
export function cleanSensitiveInfo(text: string): string {
  if (!hasSensitiveInfo(text)) {
    return text;
  }
  
  return maskSensitiveInfo(text);
}
```

**使用示例**:
```typescript
// 过滤日志
const logs = [
  'Token: sk-abc123def456',
  'API Key: api_key=xyz789',
  'Password: secret123'
];
const filtered = filterModelLogs(logs);
// 结果: ['Token: sk-***', 'API Key: api_key=***', 'Password: ***']

// 掩盖敏感信息
const text = 'Authorization: Bearer sk-abc123def456';
const masked = maskSensitiveInfo(text);
// 结果: 'Authorization: Bearer sk-***'

// 格式化日志
const formatted = formatLogEntry('INFO', '应用启动');
// 结果: '[2025-12-24T10:30:45.123Z] [INFO] 应用启动'

// 检查敏感信息
const hasSensitive = hasSensitiveInfo('Token: sk-abc123');
// 结果: true

// 清理日志
const cleaned = cleanSensitiveInfo('Token: sk-abc123');
// 结果: 'Token: sk-***'
```

---

## 🔄 使用示例

### 在主进程中使用

```typescript
// src/main/api-service.ts
import { getAuthHeaders, removeSensitiveHeaders } from '../shared/utils/headers';
import { maskSensitiveInfo } from '../shared/utils/log-filter';

async function request(config: ApiRequestParams) {
  const headers = getAuthHeaders(token);
  
  try {
    const response = await axios.request({
      ...config,
      headers
    });
    
    // 记录日志时移除敏感信息
    const safeHeaders = removeSensitiveHeaders(headers);
    Logger.info(`请求成功: ${config.endpoint}`, safeHeaders);
    
    return response.data;
  } catch (error) {
    // 掩盖错误信息中的敏感数据
    const safeError = maskSensitiveInfo(error.message);
    Logger.error(`请求失败: ${safeError}`);
    throw error;
  }
}
```

### 在渲染进程中使用

```typescript
// src/renderer/utils/logger.ts
import { formatLogEntry, maskSensitiveInfo } from '../../shared/utils/log-filter';

export class Logger {
  static info(message: string, ...args: any[]) {
    const formatted = formatLogEntry('INFO', message);
    const safe = maskSensitiveInfo(formatted);
    console.log(safe);
  }
  
  static error(message: string, error?: Error) {
    const formatted = formatLogEntry('ERROR', message);
    const safe = maskSensitiveInfo(formatted);
    console.error(safe);
    
    if (error) {
      const safeError = maskSensitiveInfo(error.message);
      console.error(safeError);
    }
  }
}
```

---

## 🎯 最佳实践

### 1. 保护敏感信息

```typescript
// ✅ 好：记录日志时掩盖敏感信息
Logger.info('Token:', maskSensitiveInfo(token));

// ❌ 不好：直接记录敏感信息
Logger.info('Token:', token);
```

### 2. 统一的请求头管理

```typescript
// ✅ 好：使用工具函数生成请求头
const headers = mergeHeaders(
  getDefaultHeaders(),
  getAuthHeaders(token)
);

// ❌ 不好：手动构造请求头
const headers = {
  'User-Agent': 'API Hub Management Tools/2.1.8',
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`
};
```

### 3. 日志格式化

```typescript
// ✅ 好：使用工具函数格式化日志
const log = formatLogEntry('INFO', '操作成功');

// ❌ 不好：手动格式化
const log = `[${new Date().toISOString()}] [INFO] 操作成功`;
```

---

## 🧪 工具函数测试

### 测试示例

```typescript
// src/__tests__/utils/log-filter.test.ts
import { maskSensitiveInfo, hasSensitiveInfo } from '../shared/utils/log-filter';

describe('log-filter', () => {
  it('should mask tokens', () => {
    const text = 'Token: sk-abc123def456';
    const masked = maskSensitiveInfo(text);
    expect(masked).toBe('Token: sk-***');
  });

  it('should detect sensitive info', () => {
    expect(hasSensitiveInfo('Token: sk-abc123')).toBe(true);
    expect(hasSensitiveInfo('Normal text')).toBe(false);
  });

  it('should mask API keys', () => {
    const text = 'api_key=xyz789abc123';
    const masked = maskSensitiveInfo(text);
    expect(masked).toContain('***');
  });
});
```

---

## 📈 扩展指南

### 添加新工具函数

1. 在 `utils/` 中创建新文件
2. 实现函数逻辑
3. 添加 JSDoc 注释
4. 编写单元测试
5. 导出到 `index.ts`

### 模板

```typescript
// src/shared/utils/newUtil.ts
/**
 * 新工具函数的描述
 * @param param1 - 参数1 的描述
 * @returns 返回值的描述
 * @example
 * const result = newUtilFunction('value');
 */
export function newUtilFunction(param1: string): string {
  // 实现
  return result;
}
```

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/shared/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.8  
**更新日期**: 2025-12-24
