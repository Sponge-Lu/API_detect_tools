# 📁 src/renderer/services/ - 前端服务层

## 架构说明

**职责**: 提供前端与主进程通信的服务层

**特点**:
- 封装 IPC 通信逻辑
- 提供类型安全的接口
- 统一的错误处理
- 支持请求超时和重试

**依赖关系**:
- 被 `hooks/` 使用
- 调用 IPC 与主进程通信
- 依赖 `shared/types/` 中的类型

---

## 📂 文件清单

### 核心服务文件

| 文件 | 职责 | 关键方法 |
|------|------|--------|
| **cli-config-generator.ts** | CLI 配置生成 | `generateConfig()`, `exportConfig()` |
| **cli-compat-projection.ts** | 将 `routing.cliProbe.latest` 投影为站点页 CLI 兼容性结果与 CLI 配置弹窗测试模型 slot | `projectCliCompatibilityMap()`, `projectCliModelTestResultsFromLatest()`, `mergeCliProbeLatestRecords()`, `syncProjectedCliCompatibility()` |
| **cli-compat-sync.ts** | 手动 CLI 测试结果落盘后的跨视图回灌 | `persistCliCompatibilityResult()`, `refreshPersistedCliProbeState()` |
| **sessionEventLog.ts** | 将关键操作写入会话事件历史 | `success()`, `info()`, `warning()`, `error()` |

---

## 🔌 服务详解

### cli-config-generator.ts - CLI 配置生成

**职责**: 生成和导出 CLI 工具配置

**关键导出**:
- `ConfigParams` - 基础配置参数接口
- `CodexConfigParams` - Codex 配置参数接口（支持 codexDetail）
- `GeneratedConfig` - 生成的配置结果
- `generateClaudeCodeConfig()` - 生成 Claude Code 配置
- `generateCodexConfig()` - 生成 Codex 配置（wire_api 固定为 responses，支持中文站点名称转换）
- `generateGeminiCliConfig()` - 生成 Gemini CLI 配置

**新增功能**:
- Codex 配置支持传入 `codexDetail` 参数
- `wire_api` 固定为 `"responses"`（chat 模式已废弃）
- 生成的配置文件包含测试结果注释
- 中文站点名称自动转换为拼音（使用 pinyin-pro 库）

---

### cli-compat-projection.ts - CLI 兼容性投影

**职责**: 将路由层统一保存的 `cliProbe.latest` 转换为站点页/账户卡片可直接消费的兼容性结果，并回灌到 CLI 配置弹窗的测试模型 slot。

**关键导出**:
- `projectCliCompatibilityMap()` - 基于 `sites / accounts / routing` 生成 detection store 需要的兼容性映射
- `projectCliModelTestResultsFromLatest()` - 按 `siteId + accountId + cliType + model` 将 canonical latest 结果合并进弹窗测试模型 slot
- `mergeCliProbeLatestRecords()` - 合并已加载配置与 route store 中的 latest 记录，保留更新的 sample
- `resolveCliProbeSiteId()` - 在弹窗只有站点名称/URL 时解析对应 `siteId`
- `syncProjectedCliCompatibility()` - 将投影结果批量同步到 `detectionStore`

**关键规则**:
- 账户卡片只使用自身 `accountId` 对应的最新结果，不再复用同站点其他账户的 probe 摘要
- 无账户卡片时，才允许使用 `site::{siteId}` 的站点级 probe 结果
- 弹窗测试模型 slot 只接收同一 `siteId/accountId/cliType/model` 的 latest 结果，并按 `testedAt` 保留更新值
- 同一 CLI 的多模型结果按“有一个成功即视为兼容”聚合，同时保留成功样本的细节文本
- 失败摘要按 CLI 独立保存；有错误码时仍保留上游错误正文，避免只显示 `错误码 429/503`

---

### cli-compat-sync.ts - CLI 测试结果同步

**职责**: 统一处理手动 CLI 测试写入 `routing.cliProbe` 后，对站点页兼容性卡片和路由 CLI 可用性视图缓存的刷新。

**关键导出**:
- `persistCliCompatibilityResult()` - 调用 `cli-compat:save-result`，并在成功后刷新 detection store / route store
- `refreshPersistedCliProbeState()` - 重新加载配置、重投影站点卡片兼容性结果，并在路由可用性页已加载时强制刷新 history 视图

**关键规则**:
- 站点管理里的“测试已选模型”和站点页统一兼容性测试都应走同一套持久化刷新链路
- 每次手动测试结果落盘后都强制刷新一次路由 CLI 可用性视图缓存，避免常驻挂载页面继续显示旧 history

---

### sessionEventLog.ts - 会话事件记录

**职责**: 将 renderer 侧的关键操作写入 `toastStore.eventHistory`，供日志页统一展示。

**关键导出**:
- `sessionEventLog.success()` - 记录成功操作
- `sessionEventLog.info()` - 记录一般操作
- `sessionEventLog.warning()` - 记录带风险提示的操作
- `sessionEventLog.error()` - 记录失败操作

---

## 🔄 IPC 通信模式

### 基础通信

```typescript
// 调用主进程服务
const result = await window.ipcRenderer.invoke('api:request', {
  site: 'one-api',
  endpoint: '/api/user/info',
  method: 'GET'
});

if (result.success) {
  console.log('请求成功:', result.data);
} else {
  console.error('请求失败:', result.error);
}
```

### 错误处理

```typescript
try {
  const result = await window.ipcRenderer.invoke('api:request', params);
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data;
} catch (error) {
  console.error('IPC 调用失败:', error);
  throw error;
}
```

### 超时处理

```typescript
// 添加超时控制
const timeout = (promise, ms) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), ms)
    )
  ]);
};

const result = await timeout(
  window.ipcRenderer.invoke('api:request', params),
  30000
);
```

---

## 📊 服务架构

### 分层结构

```
组件 (components/)
    ↓
Hook (hooks/)
    ↓
服务 (services/)
    ↓
IPC 通信
    ↓
主进程 (main/)
    ↓
业务逻辑 (api-service, token-service 等)
```

### 数据流

```
用户操作
    ↓
组件事件处理
    ↓
调用 Hook
    ↓
Hook 调用服务
    ↓
服务发送 IPC 请求
    ↓
主进程处理
    ↓
返回结果
    ↓
Hook 更新 Store
    ↓
组件重新渲染
```

---

## 🎯 最佳实践

### 1. 统一的错误处理

```typescript
// ✅ 好：统一的错误处理
export async function apiRequest(params) {
  try {
    const result = await window.ipcRenderer.invoke('api:request', params);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.data;
  } catch (error) {
    console.error('API 请求失败:', error);
    throw error;
  }
}
```

### 2. 类型安全

```typescript
// ✅ 好：完整的类型定义
interface ApiRequestParams {
  site: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: Record<string, any>;
}

export async function apiRequest(params: ApiRequestParams): Promise<any> {
  // 实现
}
```

### 3. 请求缓存

```typescript
// ✅ 好：缓存重复请求
const cache = new Map();

export async function getCachedData(key: string) {
  if (cache.has(key)) {
    return cache.get(key);
  }
  
  const data = await window.ipcRenderer.invoke('api:getData', { key });
  cache.set(key, data);
  return data;
}
```

### 4. 请求去重

```typescript
// ✅ 好：避免重复请求
const pendingRequests = new Map();

export async function apiRequest(params) {
  const key = JSON.stringify(params);
  
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key);
  }
  
  const promise = window.ipcRenderer.invoke('api:request', params);
  pendingRequests.set(key, promise);
  
  try {
    return await promise;
  } finally {
    pendingRequests.delete(key);
  }
}
```

---

## 🧪 服务测试

### 测试示例

```typescript
// src/__tests__/services/cli-config-generator.test.ts
import { generateConfig, exportConfig } from '../services/cli-config-generator';

describe('cli-config-generator', () => {
  it('should generate config for claude-code', async () => {
    const site = { id: '1', name: 'Test Site', baseUrl: 'https://api.test.com' };
    const config = await generateConfig(site, 'claude-code');
    
    expect(config.tool).toBe('claude-code');
    expect(config.enabled).toBe(true);
  });

  it('should export config as JSON', async () => {
    const json = await exportConfig('json');
    expect(() => JSON.parse(json)).not.toThrow();
  });
});
```

---

## 📈 扩展指南

### 添加新服务

1. 在 `services/` 中创建新文件
2. 定义服务接口
3. 实现服务方法
4. 添加 JSDoc 注释
5. 编写单元测试
6. 导出到 `index.ts`

### 模板

```typescript
// src/renderer/services/newService.ts
import { timeout } from '../utils/timeout';

interface NewServiceParams {
  // 参数定义
}

interface NewServiceResult {
  // 返回值定义
}

export async function newServiceMethod(
  params: NewServiceParams
): Promise<NewServiceResult> {
  try {
    const result = await timeout(
      window.ipcRenderer.invoke('new:method', params),
      30000
    );
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    return result.data;
  } catch (error) {
    console.error('Service error:', error);
    throw error;
  }
}
```

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/renderer/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.8  
**更新日期**: 2025-12-24
