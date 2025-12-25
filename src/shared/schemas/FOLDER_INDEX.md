# 📁 src/shared/schemas/ - Zod 数据验证规则

## 架构说明

**职责**: 使用 Zod 定义数据验证规则

**特点**:
- 运行时数据验证
- 生成 TypeScript 类型
- 被 `main/` 和 `renderer/` 使用
- 确保数据一致性和安全性

**依赖关系**:
- 依赖 Zod 库
- 依赖 `types/` 中的类型定义
- 被 `main/` 和 `renderer/` 使用

---

## 📂 文件清单

### 核心 Schema 文件

| 文件 | 职责 | 关键 Schema |
|------|------|-----------|
| **index.ts** | Schema 导出入口 | 所有 Schema 的统一导出 |

---

## ✅ Schema 详解

### 站点相关 Schema

```typescript
// 站点 Schema
export const SiteSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  token: z.string().optional(),
  tokenExpiresAt: z.number().optional(),
  groupId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  metadata: z.record(z.any()).optional()
});

// 站点分组 Schema
export const SiteGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  sites: z.array(SiteSchema),
  createdAt: z.number(),
  updatedAt: z.number()
});

// 站点状态 Schema
export const SiteStatusSchema = z.object({
  siteId: z.string(),
  online: z.boolean(),
  balance: z.number().min(0),
  currency: z.string(),
  usage: z.number().min(0),
  rpm: z.number().min(0),
  tpm: z.number().min(0),
  lastChecked: z.number(),
  error: z.string().optional()
});

// 检测结果 Schema
export const DetectionResultSchema = z.object({
  siteId: z.string(),
  siteName: z.string(),
  status: z.enum(['success', 'failed', 'timeout']),
  balance: z.number().optional(),
  usage: z.number().optional(),
  error: z.string().optional(),
  duration: z.number().min(0),
  timestamp: z.number()
});
```

### CLI 相关 Schema

```typescript
// CLI 工具类型 Schema
export const CliToolSchema = z.enum([
  'claude-code',
  'codex',
  'gemini-cli',
  'chat'
]);

// CLI 配置 Schema
export const CliConfigSchema = z.object({
  tool: CliToolSchema,
  enabled: z.boolean(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  timeout: z.number().min(1000).optional(),
  metadata: z.record(z.any()).optional()
});

// CLI 兼容性 Schema
export const CliCompatibilitySchema = z.object({
  tool: CliToolSchema,
  supported: z.boolean(),
  version: z.string().optional(),
  features: z.array(z.string()).optional(),
  error: z.string().optional()
});

// CLI 兼容性结果 Schema
export const CliCompatibilityResultSchema = z.object({
  siteId: z.string(),
  siteName: z.string(),
  compatibility: z.array(CliCompatibilitySchema),
  timestamp: z.number()
});
```

### 应用配置 Schema

```typescript
// 应用设置 Schema
export const AppSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  language: z.enum(['zh-CN', 'en-US']),
  autoRefresh: z.boolean(),
  refreshInterval: z.number().min(1000),
  concurrency: z.number().min(1).max(5),
  timeout: z.number().min(1000),
  enableNotification: z.boolean(),
  enableAutoBackup: z.boolean()
});

// 备份配置 Schema
export const BackupConfigSchema = z.object({
  autoBackup: z.boolean(),
  backupInterval: z.number().min(1000),
  backupPath: z.string(),
  maxBackups: z.number().min(1),
  webdav: z.object({
    enabled: z.boolean(),
    url: z.string().url(),
    username: z.string(),
    password: z.string(),
    remotePath: z.string()
  }).optional()
});

// 应用配置 Schema
export const AppConfigSchema = z.object({
  sites: z.array(SiteSchema),
  groups: z.array(SiteGroupSchema),
  settings: AppSettingsSchema,
  backup: BackupConfigSchema,
  cli: z.object({
    tools: z.array(CliConfigSchema),
    defaultTool: z.string().optional()
  })
});
```

---

## 🔄 使用示例

### 在主进程中使用

```typescript
// src/main/api-service.ts
import { SiteSchema, DetectionResultSchema } from '../shared/schemas';

async function checkBalance(site: any) {
  // 验证站点数据
  const validSite = SiteSchema.parse(site);
  
  // 发送请求
  const result = await axios.get(`${validSite.baseUrl}/api/user/info`);
  
  // 验证响应数据
  const validResult = DetectionResultSchema.parse({
    siteId: validSite.id,
    siteName: validSite.name,
    status: 'success',
    balance: result.data.balance,
    duration: Date.now() - startTime,
    timestamp: Date.now()
  });
  
  return validResult;
}
```

### 在渲染进程中使用

```typescript
// src/renderer/hooks/useSiteGroups.ts
import { SiteGroupSchema } from '../../shared/schemas';

function useSiteGroups() {
  const [groups, setGroups] = useState<SiteGroup[]>([]);
  
  const handleAddGroup = async (name: string) => {
    const newGroup = {
      id: generateId(),
      name,
      sites: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    // 验证数据
    const validGroup = SiteGroupSchema.parse(newGroup);
    setGroups([...groups, validGroup]);
  };
  
  return { groups, handleAddGroup };
}
```

### 错误处理

```typescript
// 验证失败时处理错误
try {
  const validSite = SiteSchema.parse(siteData);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('验证失败:', error.errors);
    // 处理验证错误
  }
}
```

---

## 🎯 最佳实践

### 1. 验证输入

```typescript
// ✅ 好：验证用户输入
const handleSaveConfig = async (config: any) => {
  try {
    const validConfig = AppConfigSchema.parse(config);
    await saveConfig(validConfig);
  } catch (error) {
    showError('配置格式错误');
  }
};
```

### 2. 验证 API 响应

```typescript
// ✅ 好：验证 API 响应
const result = await apiRequest();
const validResult = DetectionResultSchema.parse(result);
```

### 3. 类型推导

```typescript
// ✅ 好：从 Schema 推导类型
type Site = z.infer<typeof SiteSchema>;
type SiteGroup = z.infer<typeof SiteGroupSchema>;

// 现在 Site 和 SiteGroup 类型与 Schema 保持同步
```

### 4. 自定义验证

```typescript
// ✅ 好：添加自定义验证规则
export const SiteSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  apiKey: z.string().optional()
}).refine(
  (data) => data.apiKey || data.token,
  { message: 'apiKey 或 token 至少需要一个' }
);
```

---

## 🧪 Schema 测试

### 测试示例

```typescript
// src/__tests__/schemas.test.ts
import { SiteSchema, SiteGroupSchema } from '../shared/schemas';

describe('Schemas', () => {
  it('should validate valid site', () => {
    const site = {
      id: '1',
      name: 'Test Site',
      baseUrl: 'https://api.test.com',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    expect(() => SiteSchema.parse(site)).not.toThrow();
  });

  it('should reject invalid site', () => {
    const site = {
      id: '1',
      name: 'Test Site',
      baseUrl: 'invalid-url' // 无效的 URL
    };
    
    expect(() => SiteSchema.parse(site)).toThrow();
  });

  it('should validate site group', () => {
    const group = {
      id: '1',
      name: 'Group 1',
      sites: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    expect(() => SiteGroupSchema.parse(group)).not.toThrow();
  });
});
```

---

## 📈 扩展指南

### 添加新 Schema

1. 在 `schemas/index.ts` 中添加新 Schema
2. 定义验证规则
3. 添加注释说明
4. 编写单元测试

### 模板

```typescript
// 新 Schema 的模板
export const NewSchema = z.object({
  /** 字段1 的描述 */
  field1: z.string().min(1),
  
  /** 字段2 的描述 */
  field2: z.number().min(0),
  
  /** 字段3 的描述 (可选) */
  field3: z.string().optional()
});

// 从 Schema 推导类型
export type NewType = z.infer<typeof NewSchema>;
```

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/shared/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 2.1.8  
**更新日期**: 2025-12-24
