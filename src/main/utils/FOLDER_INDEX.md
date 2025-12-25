# 📁 src/main/utils/ - 主进程工具函数

## 架构说明

**职责**: 提供主进程使用的工具函数和辅助模块

**特点**:
- 纯函数，无副作用
- 可复用的通用逻辑
- 支持日志、错误处理、文件操作等
- 被各个服务和处理器使用

**依赖关系**:
- 被 `main/` 中的各个服务使用
- 不依赖 Electron 主进程特定功能
- 可独立测试

---

## 📂 文件清单

### 核心工具文件

| 文件 | 职责 | 关键函数 |
|------|------|--------|
| **logger.ts** | 日志记录 | `info()`, `warn()`, `error()`, `debug()` |
| **file-utils.ts** | 文件操作 | `readFile()`, `writeFile()`, `deleteFile()` 等 |
| **crypto-utils.ts** | 加密解密 | `encrypt()`, `decrypt()`, `hash()` |
| **retry-utils.ts** | 重试机制 | `retry()`, `withRetry()` |
| **path-utils.ts** | 路径处理 | `getConfigPath()`, `getBackupPath()` 等 |
| **time-utils.ts** | 时间处理 | `sleep()`, `timeout()`, `formatTime()` |
| **validation-utils.ts** | 数据验证 | `validateUrl()`, `validateEmail()` 等 |
| **toml-parser.ts** | TOML 解析 | `parseTomlFile()`, `parseTomlString()` |
| **env-parser.ts** | ENV 解析 | `parseEnvFile()`, `parseEnvString()` |
| **config-parsers.ts** | CLI 配置解析 | `parseClaudeCodeConfig()`, `parseCodexConfig()`, `parseGeminiCliConfig()` 等 |
| **site-matcher.ts** | 站点匹配 | `normalizeUrl()`, `matchSite()`, `isOfficialUrl()`, `determineSourceType()` |

---

## 📝 工具函数详解

### logger.ts - 日志记录

```typescript
// 日志级别
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// 日志记录
export class Logger {
  static debug(message: string, ...args: any[]): void;
  static info(message: string, ...args: any[]): void;
  static warn(message: string, ...args: any[]): void;
  static error(message: string, ...args: any[]): void;
  
  // 设置日志级别
  static setLevel(level: LogLevel): void;
  
  // 获取日志文件路径
  static getLogPath(): string;
  
  // 清理旧日志
  static cleanOldLogs(days: number): void;
}

// 使用示例
Logger.info('应用启动');
Logger.error('发生错误', error);
```

### file-utils.ts - 文件操作

```typescript
// 文件读写
export async function readFile(path: string): Promise<string>;
export async function writeFile(path: string, content: string): Promise<void>;
export async function appendFile(path: string, content: string): Promise<void>;
export async function deleteFile(path: string): Promise<void>;

// 目录操作
export async function createDir(path: string): Promise<void>;
export async function deleteDir(path: string): Promise<void>;
export async function listFiles(path: string): Promise<string[]>;

// 文件检查
export async function fileExists(path: string): Promise<boolean>;
export async function isDirectory(path: string): Promise<boolean>;
export async function getFileSize(path: string): Promise<number>;

// 使用示例
const content = await readFile('/path/to/file.txt');
await writeFile('/path/to/file.txt', 'new content');
```

### crypto-utils.ts - 加密解密

```typescript
// 加密解密
export function encrypt(text: string, key: string): string;
export function decrypt(encrypted: string, key: string): string;

// 哈希
export function hash(text: string, algorithm: 'sha256' | 'md5'): string;

// 生成密钥
export function generateKey(length: number): string;

// 使用示例
const encrypted = encrypt('sensitive data', 'secret-key');
const decrypted = decrypt(encrypted, 'secret-key');
```

### retry-utils.ts - 重试机制

```typescript
// 重试选项
interface RetryOptions {
  maxAttempts: number;
  delay: number;
  backoff?: 'linear' | 'exponential';
  onRetry?: (attempt: number, error: Error) => void;
}

// 重试函数
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T>;

// 装饰器形式
export function withRetry(options: RetryOptions) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    // 装饰器实现
  };
}

// 使用示例
const result = await retry(
  () => apiService.request(config),
  { maxAttempts: 3, delay: 1000, backoff: 'exponential' }
);
```

### path-utils.ts - 路径处理

```typescript
// 获取应用路径
export function getAppPath(): string;
export function getConfigPath(): string;
export function getBackupPath(): string;
export function getLogPath(): string;
export function getTempPath(): string;

// 路径操作
export function joinPath(...segments: string[]): string;
export function resolvePath(path: string): string;
export function getFileName(path: string): string;
export function getFileExtension(path: string): string;

// 使用示例
const configPath = getConfigPath();
const backupPath = joinPath(getBackupPath(), 'backup-2025-12-24.json');
```

### time-utils.ts - 时间处理

```typescript
// 延迟
export async function sleep(ms: number): Promise<void>;

// 超时
export async function timeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T>;

// 时间格式化
export function formatTime(date: Date, format: string): string;
export function formatDuration(ms: number): string;

// 时间计算
export function addDays(date: Date, days: number): Date;
export function getDaysDiff(date1: Date, date2: Date): number;

// 使用示例
await sleep(1000);
const result = await timeout(apiRequest(), 30000);
const formatted = formatTime(new Date(), 'YYYY-MM-DD HH:mm:ss');
```

### validation-utils.ts - 数据验证

```typescript
// URL 验证
export function validateUrl(url: string): boolean;
export function isValidHttpUrl(url: string): boolean;

// 邮箱验证
export function validateEmail(email: string): boolean;

// Token 验证
export function validateToken(token: string): boolean;

// API Key 验证
export function validateApiKey(key: string): boolean;

// 使用示例
if (validateUrl(siteUrl)) {
  // 处理有效的 URL
}
```

---

## 🔄 使用示例

### 在服务中使用

```typescript
// src/main/api-service.ts
import Logger from './utils/logger';
import { retry } from './utils/retry-utils';
import { timeout } from './utils/time-utils';

export class ApiService {
  async request(config: ApiRequestParams) {
    Logger.info(`发送请求: ${config.endpoint}`);
    
    try {
      const result = await retry(
        () => timeout(this.sendRequest(config), 30000),
        { maxAttempts: 3, delay: 1000 }
      );
      
      Logger.info(`请求成功: ${config.endpoint}`);
      return result;
    } catch (error) {
      Logger.error(`请求失败: ${error.message}`);
      throw error;
    }
  }
}
```

### 在处理器中使用

```typescript
// src/main/handlers/backup.handler.ts
import { readFile, writeFile } from '../utils/file-utils';
import { getBackupPath } from '../utils/path-utils';
import { formatTime } from '../utils/time-utils';

ipcMain.handle('backup:create', async () => {
  const backupPath = joinPath(
    getBackupPath(),
    `backup-${formatTime(new Date(), 'YYYY-MM-DD-HHmmss')}.json`
  );
  
  const config = await readFile(getConfigPath());
  await writeFile(backupPath, config);
  
  return { success: true, backupPath };
});
```

---

## 🎯 设计原则

### 1. 单一职责

- 每个文件只负责一个方面
- 函数功能单一明确
- 易于理解和维护

### 2. 可复用性

- 通用的工具函数
- 支持多种使用场景
- 减少代码重复

### 3. 错误处理

- 统一的错误处理
- 详细的错误日志
- 支持重试机制

### 4. 性能优化

- 异步操作
- 缓存机制
- 资源清理

---

## 🧪 测试

### 工具函数测试

```bash
npm run test -- src/main/utils
```

### 测试示例

```typescript
// src/__tests__/utils/retry-utils.test.ts
describe('retry-utils', () => {
  it('should retry on failure', async () => {
    let attempts = 0;
    const fn = jest.fn(async () => {
      attempts++;
      if (attempts < 3) throw new Error('Failed');
      return 'success';
    });
    
    const result = await retry(fn, { maxAttempts: 3, delay: 10 });
    expect(result).toBe('success');
    expect(attempts).toBe(3);
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

### 最佳实践

- 使用 TypeScript 类型
- 添加详细的注释
- 处理边界情况
- 编写测试用例
- 避免副作用

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/main/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.8  
**更新日期**: 2025-12-24
