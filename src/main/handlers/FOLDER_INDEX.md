# 📁 src/main/handlers/ - IPC 事件处理器

## 架构说明

**职责**: 处理渲染进程通过 IPC 发送的所有事件请求

**特点**:
- 每个处理器对应一个业务域
- 使用 `ipcMain.handle()` 注册异步处理器
- 统一的错误处理和日志记录
- 类型安全的请求/响应

**依赖关系**:
- 依赖 `main/` 中的各个服务 (ApiService, TokenService 等)
- 被 `main.ts` 中的 `registerAllHandlers()` 调用
- 与 `renderer/` 通过 IPC 通信

---

## 📂 文件清单

### 核心处理器

| 文件 | 职责 | 关键事件 |
|------|------|--------|
| **index.ts** | 处理器注册入口 | `registerAllHandlers()` |
| **close-behavior-handlers.ts** | 窗口关闭行为处理 | `close-behavior:get-settings`, `close-behavior:save-settings` 等 |
| **credit-handlers.ts** | Credit 积分检测处理 | `credit:fetch`, `credit:login`, `credit:logout` 等 |
| **api.handler.ts** | API 请求处理 | `api:request`, `api:checkBalance` 等 |
| **token.handler.ts** | Token 管理处理 | `token:get`, `token:save`, `token:delete` 等 |
| **config.handler.ts** | 配置管理处理 | `config:load`, `config:save`, `config:export` 等 |
| **backup.handler.ts** | 备份管理处理 | `backup:create`, `backup:restore`, `backup:upload` 等 |
| **cli.handler.ts** | CLI 兼容性处理 | `cli:test`, `cli:generateConfig` 等 |
| **browser.handler.ts** | 浏览器管理处理 | `browser:launch`, `browser:login` 等 |

---

## 🔄 处理器模式

### 基础结构

```typescript
// src/main/handlers/api.handler.ts

import { ipcMain } from 'electron';
import { ApiService } from '../api-service';

export function registerApiHandlers(apiService: ApiService) {
  // 处理 API 请求
  ipcMain.handle('api:request', async (event, config) => {
    try {
      const result = await apiService.request(config);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 处理查询余额
  ipcMain.handle('api:checkBalance', async (event, site) => {
    try {
      const balance = await apiService.checkBalance(site);
      return { success: true, data: balance };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ... 其他处理器
}
```

### 错误处理

```typescript
// 统一的错误处理模式
try {
  const result = await service.method(params);
  return { success: true, data: result };
} catch (error) {
  Logger.error(`[Handler] 错误: ${error.message}`);
  return { 
    success: false, 
    error: error.message,
    code: error.code || 'UNKNOWN_ERROR'
  };
}
```

---

## 📋 IPC 事件详解

### API 处理器 (api.handler.ts)

| 事件 | 请求参数 | 响应数据 | 职责 |
|------|---------|--------|------|
| `api:request` | `{ site, endpoint, method, data }` | API 响应 | 发送 API 请求 |
| `api:checkBalance` | `{ site }` | `{ balance, currency }` | 查询余额 |
| `api:checkStatus` | `{ site }` | `{ status, message }` | 检测站点状态 |
| `api:checkSignIn` | `{ site }` | `{ canSignIn, lastSignIn }` | 检测签到状态 |
| `api:signIn` | `{ site }` | `{ success, reward }` | 执行签到 |

### Token 处理器 (token.handler.ts)

| 事件 | 请求参数 | 响应数据 | 职责 |
|------|---------|--------|------|
| `token:get` | `{ site }` | `{ token, expiresAt }` | 获取 Token |
| `token:save` | `{ site, token, expiresAt }` | `{ success }` | 保存 Token |
| `token:delete` | `{ site }` | `{ success }` | 删除 Token |
| `token:refresh` | `{ site }` | `{ token, expiresAt }` | 刷新 Token |
| `token:list` | `{}` | `{ tokens: [...] }` | 列出所有 Token |

### 配置处理器 (config.handler.ts)

| 事件 | 请求参数 | 响应数据 | 职责 |
|------|---------|--------|------|
| `config:load` | `{}` | `{ config }` | 加载配置 |
| `config:save` | `{ config }` | `{ success }` | 保存配置 |
| `config:export` | `{ format }` | `{ data }` | 导出配置 |
| `config:import` | `{ data, format }` | `{ success }` | 导入配置 |
| `config:reset` | `{}` | `{ success }` | 重置配置 |

### 备份处理器 (backup.handler.ts)

| 事件 | 请求参数 | 响应数据 | 职责 |
|------|---------|--------|------|
| `backup:create` | `{}` | `{ backupPath }` | 创建本地备份 |
| `backup:restore` | `{ backupPath }` | `{ success }` | 恢复本地备份 |
| `backup:list` | `{}` | `{ backups: [...] }` | 列出备份列表 |
| `backup:delete` | `{ backupPath }` | `{ success }` | 删除备份 |
| `backup:upload` | `{}` | `{ success, url }` | 上传到云端 |
| `backup:download` | `{}` | `{ success }` | 从云端下载 |

### CLI 处理器 (cli-compat-handlers.ts)

| 事件 | 请求参数 | 响应数据 | 职责 |
|------|---------|--------|------|
| `cli-compat:test-with-config` | `{ siteUrl, configs }` | `{ results: [...] }` | 测试 CLI 兼容性 |
| `cli-compat:save-result` | `{ siteUrl, result }` | `{ success }` | 保存测试结果 |
| `cli-compat:save-config` | `{ siteUrl, cliConfig }` | `{ success }` | 保存 CLI 配置 |
| `cli-compat:write-config` | `{ cliType, files, applyMode }` | `{ success, writtenPaths }` | 写入配置文件 |

#### 辅助函数

| 函数 | 参数 | 返回值 | 职责 |
|------|------|--------|------|
| `resolveConfigPath` | `filePath: string` | `string` | 解析配置路径（~ 替换为主目录） |
| `ensureDirectoryExists` | `dirPath: string` | `void` | 确保目录存在 |
| `deepMerge` | `target, source` | `object` | 深度合并对象 |
| `mergeJsonConfig` | `existingContent, newContent` | `string` | 合并 JSON 配置 |
| `mergeEnvConfig` | `existingContent, newContent` | `string` | 合并 .env 配置 |
| `mergeSectionContent` | `existingLines, newLines` | `string[]` | 合并 TOML section 内容（智能合并） |
| `mergeTomlConfig` | `existingContent, newContent` | `string` | 合并 TOML 配置（智能合并） |
| `mergeConfigByType` | `filePath, existingContent, newContent` | `string` | 根据文件类型选择合并策略 |

### 浏览器处理器 (browser.handler.ts)

| 事件 | 请求参数 | 响应数据 | 职责 |
|------|---------|--------|------|
| `browser:launch` | `{ headless }` | `{ success, port }` | 启动浏览器 |
| `browser:login` | `{ site, url }` | `{ token }` | 自动登录 |
| `browser:close` | `{}` | `{ success }` | 关闭浏览器 |

### Credit 处理器 (credit-handlers.ts)

| 事件 | 请求参数 | 响应数据 | 职责 |
|------|---------|--------|------|
| `credit:fetch` | `{}` | `{ creditInfo }` | 获取积分数据 |
| `credit:fetch-daily-stats` | `{ days? }` | `{ dailyStats }` | 获取每日统计数据 |
| `credit:fetch-transactions` | `{ page?, pageSize? }` | `{ transactionList }` | 获取交易记录 |
| `credit:login` | `{}` | `{ success }` | 启动登录 |
| `credit:logout` | `{}` | `{ success }` | 登出 |
| `credit:get-status` | `{}` | `{ isLoggedIn }` | 获取登录状态 |
| `credit:save-config` | `{ config }` | `{ success }` | 保存配置 |
| `credit:load-config` | `{}` | `{ config }` | 加载配置 |
| `credit:get-cached` | `{}` | `{ cachedInfo }` | 获取缓存数据 |

---

## 🔐 安全考虑

### 1. 输入验证

```typescript
// 验证请求参数
const { site, endpoint } = config;
if (!site || !endpoint) {
  throw new Error('Missing required parameters');
}
```

### 2. 权限检查

```typescript
// 检查用户权限
if (!user.hasPermission('api:request')) {
  throw new Error('Permission denied');
}
```

### 3. 速率限制

```typescript
// 防止滥用
if (requestCount > MAX_REQUESTS_PER_MINUTE) {
  throw new Error('Rate limit exceeded');
}
```

### 4. 敏感信息过滤

```typescript
// 不返回敏感信息
const response = {
  success: true,
  data: {
    balance: result.balance,
    // 不返回 apiKey、token 等敏感信息
  }
};
```

---

## 📊 数据流

### 完整的 IPC 通信流程

```
渲染进程 (renderer/)
    ↓ ipcRenderer.invoke('api:request', params)
    ↓
主进程 (main/)
    ↓ ipcMain.handle('api:request', handler)
    ↓
处理器 (handlers/api.handler.ts)
    ↓ 调用 ApiService
    ↓
业务服务 (main/api-service.ts)
    ↓ 执行业务逻辑
    ↓
返回结果到处理器
    ↓
处理器返回结果到渲染进程
    ↓
渲染进程接收结果
    ↓ 更新 UI
```

---

## 🧪 测试

### 处理器测试

```typescript
// src/__tests__/handlers.test.ts

import { ipcMain } from 'electron';
import { registerApiHandlers } from '../main/handlers/api.handler';

describe('API Handlers', () => {
  it('should handle api:request', async () => {
    const mockApiService = {
      request: jest.fn().mockResolvedValue({ data: 'test' })
    };
    
    registerApiHandlers(mockApiService);
    
    const handler = ipcMain.handle.mock.calls[0][1];
    const result = await handler({}, { site: 'test' });
    
    expect(result.success).toBe(true);
  });
});
```

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/main/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.12  
**更新日期**: 2026-01-07
