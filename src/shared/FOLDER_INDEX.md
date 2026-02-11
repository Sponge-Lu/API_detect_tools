# 📁 src/shared/ - 共享代码层

## 架构说明

**职责**: 提供主进程和渲染进程共享的类型、常量、验证规则和工具函数

**特点**:
- 零依赖，不依赖 Electron 或 React
- 纯 TypeScript 代码
- 被 `main/` 和 `renderer/` 同时使用
- 确保类型安全和数据一致性

**依赖关系**:
- 被 `main/` 和 `renderer/` 导入
- 不依赖其他模块
- 可独立测试

---

## 📂 文件清单

### 子文件夹

| 文件夹 | 职责 | 关键文件 |
|--------|------|--------|
| **types/** | TypeScript 类型定义 | site.ts, cli-config.ts |
| **schemas/** | Zod 数据验证规则 | index.ts |
| **constants/** | 常量定义 | index.ts |
| **utils/** | 工具函数 | headers.ts, log-filter.ts |

---

## 📝 Types (类型定义)

### site.ts

**职责**: 站点相关的类型定义

**关键类型**:
```typescript
interface Site {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  // ... 其他字段
}

interface SiteGroup {
  id: string;
  name: string;
  sites: Site[];
}

interface SiteStatus {
  balance: number;
  usage: number;
  rpm: number;
  tpm: number;
}
```

### cli-config.ts

**职责**: CLI 配置相关的类型定义

**关键类型**:
```typescript
interface CliConfig {
  tool: 'claude-code' | 'codex' | 'gemini-cli';
  enabled: boolean;
  model?: string;
  // ... 其他字段
}

interface CliCompatibility {
  tool: string;
  supported: boolean;
  codexDetail?: { responses: boolean | null };
  geminiDetail?: { native: boolean | null; proxy: boolean | null };
}

interface GeminiTestDetail {
  native: boolean | null;  // Google 原生格式测试结果
  proxy: boolean | null;   // OpenAI 兼容格式测试结果
}
```

---

## ✅ Schemas (数据验证)

### index.ts

**职责**: 使用 Zod 定义数据验证规则

**关键 Schema**:
```typescript
const SiteSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  // ...
});

const CliConfigSchema = z.object({
  tool: z.enum(['claude-code', 'codex', 'gemini-cli', 'chat']),
  enabled: z.boolean(),
  // ...
});
```

**用途**:
- 验证 API 响应数据
- 验证用户输入
- 运行时类型检查
- 生成 TypeScript 类型

---

## 🔢 Constants (常量定义)

### index.ts

**职责**: 定义应用全局常量

**关键常量**:
```typescript
// API 端点
export const API_ENDPOINTS = {
  ONE_API: 'https://api.one-api.com',
  NEW_API: 'https://api.new-api.com',
  // ...
};

// 超时时间
export const TIMEOUTS = {
  API_REQUEST: 30000,
  BROWSER_LAUNCH: 60000,
  // ...
};

// 并发限制
export const CONCURRENCY = {
  MAX_PARALLEL_REQUESTS: 5,
  MAX_BROWSER_INSTANCES: 3,
};

// CLI 工具列表
export const CLI_TOOLS = [
  'claude-code',
  'codex',
  'gemini-cli',
  'chat',
];
```

---

## 🛠️ Utils (工具函数)

### headers.ts

**职责**: HTTP 请求头生成和管理

**关键函数**:
```typescript
export function getDefaultHeaders(): Record<string, string> {
  return {
    'User-Agent': 'API Hub Management Tools/2.1.8',
    'Content-Type': 'application/json',
  };
}

export function getAuthHeaders(token: string): Record<string, string> {
  return {
    ...getDefaultHeaders(),
    'Authorization': `Bearer ${token}`,
  };
}
```

### log-filter.ts

**职责**: 日志过滤和格式化

**关键函数**:
```typescript
export function filterModelLogs(logs: string[]): string[] {
  // 过滤敏感信息（Token、密钥等）
  return logs.map(log => maskSensitiveInfo(log));
}

export function formatLogEntry(level: string, message: string): string {
  // 格式化日志条目
  return `[${new Date().toISOString()}] [${level}] ${message}`;
}
```

---

## 🔄 使用示例

### 在主进程中使用

```typescript
// src/main/api-service.ts
import { SiteSchema, API_ENDPOINTS } from '../shared';

async function checkBalance(site: Site) {
  // 验证站点数据
  const validSite = SiteSchema.parse(site);
  
  // 使用常量
  const url = `${API_ENDPOINTS[validSite.name]}/api/user/info`;
  
  // 发送请求
  const response = await axios.get(url);
  return response.data;
}
```

### 在渲染进程中使用

```typescript
// src/renderer/hooks/useSiteGroups.ts
import { SiteGroup, SiteGroupSchema } from '../../shared';

function useSiteGroups() {
  const [groups, setGroups] = useState<SiteGroup[]>([]);
  
  // 验证数据
  const validGroups = groups.map(g => SiteGroupSchema.parse(g));
  
  return { groups: validGroups };
}
```

---

## 📊 数据流

### 类型安全的数据流

```
主进程 (main/)
    ↓ 使用 shared/types
    ↓ 验证数据 (shared/schemas)
    ↓ 通过 IPC 发送
    ↓
渲染进程 (renderer/)
    ↓ 接收数据
    ↓ 验证数据 (shared/schemas)
    ↓ 使用 shared/types
    ↓ 更新 UI
```

---

## 🎯 设计原则

### 1. 零依赖

- 不依赖 Electron、React 等框架
- 可独立使用和测试
- 易于维护和扩展

### 2. 类型安全

- 完整的 TypeScript 类型定义
- 运行时数据验证 (Zod)
- 编译时类型检查

### 3. 单一职责

- 每个文件只负责一个方面
- 易于理解和维护
- 便于代码复用

### 4. 一致性

- 主进程和渲染进程使用相同的类型
- 确保数据一致性
- 减少 Bug

---

## 🧪 测试

### 类型测试

```bash
npm run test -- src/shared/types
```

### Schema 验证测试

```bash
npm run test -- src/shared/schemas
```

### 工具函数测试

```bash
npm run test -- src/shared/utils
```

---

## 📈 扩展指南

### 添加新类型

1. 在 `types/` 中创建新文件
2. 定义 TypeScript 接口
3. 在 `schemas/` 中添加 Zod 验证规则
4. 导出到 `index.ts`

### 添加新常量

1. 在 `constants/index.ts` 中添加
2. 使用 `export const` 导出
3. 添加注释说明用途

### 添加新工具函数

1. 在 `utils/` 中创建新文件
2. 实现函数逻辑
3. 添加 JSDoc 注释
4. 导出到 `index.ts`

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引和 PROJECT_INDEX.md

---

**版本**: 2.1.9  
**更新日期**: 2025-12-26
