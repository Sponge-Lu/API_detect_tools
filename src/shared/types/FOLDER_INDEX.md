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
| **site.ts** | 站点相关类型 | Site, SiteGroup, SiteStatus 等 |
| **cli-config.ts** | CLI 配置类型 | CliConfig, CliCompatibility 等 |
| **config-detection.ts** | CLI 配置检测类型 | ConfigSourceType, CliDetectionResult, AllCliDetectionResult 等 |

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
}

// Token 信息
interface TokenInfo {
  siteId: string;
  token: string;
  expiresAt?: number;
  createdAt: number;
  lastUsed?: number;
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
└── error?: string

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

**版本**: 2.1.8  
**更新日期**: 2025-12-24
