# 📁 src/main/types/ - 主进程类型定义

## 架构说明

**职责**: 定义主进程特有的 TypeScript 类型和接口

**特点**:
- 主进程专用的类型定义
- 与 `shared/types/` 互补
- 包含 Electron 相关的类型
- 支持 IPC 通信的类型定义

**依赖关系**:
- 依赖 `shared/types/` 中的基础类型
- 被 `main/` 中的各个服务使用
- 不被 `renderer/` 使用

---

## 📂 文件清单

### 核心类型文件

| 文件 | 职责 | 关键类型 |
|------|------|--------|
| **index.ts** | 类型导出入口 | 所有类型的统一导出 |
| **ipc.ts** | IPC 通信类型 | 请求/响应类型 |
| **service.ts** | 服务类型 | 各个服务的接口 |
| **config.ts** | 配置类型 | 应用配置相关 |
| **browser.ts** | 浏览器类型 | Chrome 管理相关 |

---

## 📝 类型定义详解

### ipc.ts - IPC 通信类型

```typescript
// 通用 IPC 请求/响应格式
interface IpcRequest<T = any> {
  id?: string;
  method: string;
  params?: T;
  timeout?: number;
}

interface IpcResponse<T = any> {
  id?: string;
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// 具体的 IPC 事件类型
interface ApiRequestParams {
  site: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: Record<string, any>;
  headers?: Record<string, string>;
}

interface TokenGetParams {
  site: string;
  forceRefresh?: boolean;
}

interface ConfigSaveParams {
  config: AppConfig;
  backup?: boolean;
}
```

### service.ts - 服务接口

```typescript
// ApiService 接口
interface IApiService {
  request(config: ApiRequestParams): Promise<any>;
  checkBalance(site: string): Promise<BalanceInfo>;
  checkStatus(site: string): Promise<StatusInfo>;
  checkSignIn(site: string): Promise<SignInInfo>;
  signIn(site: string): Promise<SignInResult>;
}

// TokenService 接口
interface ITokenService {
  getToken(site: string): Promise<string>;
  saveToken(site: string, token: string): Promise<void>;
  deleteToken(site: string): Promise<void>;
  refreshToken(site: string): Promise<string>;
  listTokens(): Promise<TokenInfo[]>;
}

// ChromeManager 接口
interface IChromeManager {
  launch(options?: LaunchOptions): Promise<void>;
  login(site: string): Promise<string>;
  cleanup(): Promise<void>;
  isRunning(): boolean;
}

// BackupManager 接口
interface IBackupManager {
  backup(): Promise<string>;
  restore(backupPath: string): Promise<void>;
  export(format: 'json' | 'yaml'): Promise<string>;
  import(data: string, format: 'json' | 'yaml'): Promise<void>;
}
```

### config.ts - 配置类型

```typescript
// 应用配置
interface AppConfig {
  sites: Site[];
  groups: SiteGroup[];
  settings: AppSettings;
  backup: BackupConfig;
  cli: CliConfig;
}

// 应用设置
interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  language: 'zh-CN' | 'en-US';
  autoRefresh: boolean;
  refreshInterval: number;
  concurrency: number;
  timeout: number;
  enableNotification: boolean;
  enableAutoBackup: boolean;
}

// 备份配置
interface BackupConfig {
  autoBackup: boolean;
  backupInterval: number;
  backupPath: string;
  maxBackups: number;
  webdav?: WebDAVConfig;
}

// WebDAV 配置
interface WebDAVConfig {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  remotePath: string;
}

// CLI 配置
interface CliConfig {
  tools: CliToolConfig[];
  defaultTool?: string;
}

interface CliToolConfig {
  name: string;
  enabled: boolean;
  model?: string;
  apiKey?: string;
}
```

### browser.ts - 浏览器类型

```typescript
// 浏览器启动选项
interface LaunchOptions {
  headless?: boolean;
  debugPort?: number;
  userDataDir?: string;
  args?: string[];
}

// 浏览器登录选项
interface LoginOptions {
  site: string;
  url: string;
  timeout?: number;
  waitForNavigation?: boolean;
}

// 浏览器登录结果
interface LoginResult {
  success: boolean;
  token?: string;
  error?: string;
  cookies?: Record<string, string>;
}

// 浏览器进程信息
interface BrowserProcessInfo {
  pid: number;
  debugPort: number;
  userDataDir: string;
  isRunning: boolean;
}
```

---

## 🔄 使用示例

### 在服务中使用

```typescript
// src/main/api-service.ts
import { IApiService, ApiRequestParams } from './types';

export class ApiService implements IApiService {
  async request(config: ApiRequestParams): Promise<any> {
    // 实现请求逻辑
  }
  
  async checkBalance(site: string): Promise<BalanceInfo> {
    // 实现查询余额逻辑
  }
}
```

### 在处理器中使用

```typescript
// src/main/handlers/api.handler.ts
import { IpcRequest, IpcResponse, ApiRequestParams } from '../types';

ipcMain.handle('api:request', async (event, params: ApiRequestParams) => {
  const response: IpcResponse = {
    success: true,
    data: await apiService.request(params)
  };
  return response;
});
```

---

## 🎯 设计原则

### 1. 类型安全

- 完整的类型定义
- 避免使用 `any`
- 编译时类型检查

### 2. 接口隔离

- 每个服务定义独立的接口
- 便于单元测试和 Mock
- 支持依赖注入

### 3. 可扩展性

- 使用泛型支持多种数据类型
- 易于添加新的类型定义
- 向后兼容

### 4. 文档化

- 为每个类型添加 JSDoc 注释
- 说明字段的含义和用途
- 提供使用示例

---

## 📊 类型关系图

```
AppConfig (应用配置)
├── sites: Site[] (来自 shared/types)
├── groups: SiteGroup[] (来自 shared/types)
├── settings: AppSettings
│   ├── theme
│   ├── language
│   └── ...
├── backup: BackupConfig
│   └── webdav?: WebDAVConfig
└── cli: CliConfig
    └── tools: CliToolConfig[]

IPC 通信
├── IpcRequest<T>
│   └── params: T
└── IpcResponse<T>
    ├── data?: T
    └── error?: ErrorInfo

服务接口
├── IApiService
├── ITokenService
├── IChromeManager
└── IBackupManager
```

---

## 🧪 测试

### 类型检查

```bash
npm run build:main  # 编译检查类型
```

### 类型测试

```typescript
// 验证类型定义
const config: AppConfig = {
  sites: [],
  groups: [],
  settings: {
    theme: 'dark',
    language: 'zh-CN',
    // ...
  }
};
```

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/main/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.8  
**更新日期**: 2025-12-24
