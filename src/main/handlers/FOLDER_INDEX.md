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
| **index.ts** | 处理器注册入口，按依赖注入顺序注册全部域 | `registerAllHandlers()` |
| **unified-config-handlers.ts** | 配置读写、站点 CRUD、账户存储导入导出 | `load-config`, `save-config`, `sites:*`, `storage:*`, `get-all-accounts` |
| **account-handlers.ts** | 多账户查询、创建、更新与删除（含站点级 `cli_config` 更新） | `accounts:list`, `accounts:add`, `accounts:update`, `accounts:delete` |
| **token-handlers.ts** | Token 校验/初始化、API Key 增删查、本地 API Key 管理与模型刷新 | `token:validate`, `token:initialize-site`, `token:create-api-token`, `token:*local-api-key*` |
| **detection-handlers.ts** | 站点检测、签到与刷新（多账户刷新按 `site_type` 选择 token 续期路径），以及本地 CLI 配置静态检测与缓存清理 | `detect-site`, `checkin-and-refresh`, `site:checkinAll`, `site:refreshAll`, `detection:detect-cli-config`, `detection:detect-all-cli-config` |
| **browser-profile-handlers.ts** | 浏览器 Profile 登录、列举、显式绑定、打开站点与签到 | `browser-profile:list-account-options`, `browser-profile:bind-account`, `browser-profile:login-main`, `browser-profile:login-isolated` |
| **overview-handlers.ts** | 数据总览站点每日快照 | `overview:get-site-daily-snapshots` |
| **route-handlers.ts** | 路由服务、规则、模型注册表、统计/日志、会话实例与规则、profile 状态、端点测试 | `route:get-config`, `route:list-route-instances`, `route:upsert-session-rule`, `route:preview-profile-state-clear`, `endpoint-test:run` |
| **config-file-profile-handlers.ts** | 单卡片持久化、权威目标目录、模板应用/真实文件事务、凭证轮换与对话记录校验 | `config-file-profile:upsert`, `config-file-profile:target-catalog`, `config-file-profile:preview-direct-edit`, `config-file-profile:commit` |
| **dsh-integration-handlers.ts** | DSH 会话级路由接入：状态检测、一键接入、回滚、存量会话迁移 | `dsh-integration:status`, `dsh-integration:enable`, `dsh-integration:rollback`, `dsh-integration:migrate-sessions` |
| **cli-compat-handlers.ts** | 本地 CLI 配置读取、写入与托管站点 CLI 配置保存；站点级 `cli_config` 仅作 legacy fallback | `cli-compat:save-config`, `cli-compat:write-config` |
| **custom-cli-config-handlers.ts** | 直连接入点配置；保存后强制同步路由模型 registry | `custom-cli-config:load`, `custom-cli-config:save`, `custom-cli-config:fetch-models` |
| **backup-handlers.ts** | 本地备份、配置包导入导出、备份目录打开 | `backup:manual`, `backup:list`, `backup:restore-config`, `backup:export-config-package`, `backup:import-config-package` |
| **webdav-handlers.ts** | WebDAV 配置、连通性测试与云端备份管理 | `webdav:get-config`, `webdav:test-connection`, `webdav:upload-backup`, `webdav:restore-backup` |
| **update-handlers.ts** | 应用更新检查、下载、安装与更新设置 | `update:check`, `update:start-download`, `update:install`, `update:get-settings` |
| **theme-handlers.ts** | 主题读取与保存 | `theme:load`, `theme:save` |
| **close-behavior-handlers.ts** | 窗口关闭行为与托盘确认弹窗 | `close-behavior:get-settings`, `close-behavior:save-settings`, `close-behavior:quit-app` |
| **anyrouter-handlers.ts** | AnyRouter 站点用户哈希提取 | `anyrouter:extractUserHash`, `anyrouter:extractAllUserHashes` |

---

## 🔄 处理器模式

### 基础结构

```typescript
// src/main/handlers/dsh-integration-handlers.ts

import { ipcMain } from 'electron';
import { detectDshRouting, enableDshSessionRouting } from '../dsh-integration-service';

// 统一把异常收敛成 { ok, data } | { ok:false, error }
async function toResult<T>(operation: () => Promise<T>) {
  try {
    return { ok: true as const, data: await operation() };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerDshIntegrationHandlers(): void {
  ipcMain.handle('dsh-integration:status', () => toResult(() => detectDshRouting()));
  ipcMain.handle('dsh-integration:enable', (_, input) =>
    toResult(() => enableDshSessionRouting(input ?? {}))
  );
}
```

### 错误处理

Electron 只透传异常的 `message`，所以新式处理器（如 `dsh-integration-handlers.ts`）统一返回结构化结果：

```typescript
return { ok: false, error: '...' };
```

旧式处理器（如 `cli-compat-handlers.ts`）保留 `{ success, error }` 形状。两种形状都要求：**不把异常抛给渲染进程**，避免丢失错误分类信息。

---

## 📋 IPC 事件详解

### 配置与站点处理器 (unified-config-handlers.ts)

| 事件 | 请求参数 | 响应数据 | 职责 |
|------|---------|--------|------|
| `load-config` | 无 | `UnifiedConfig` | 加载并规范化 v3 配置 |
| `save-config` | `config` | `{ success }` | 原子保存配置（含加密字段） |
| `sites:add` | `site` | `UnifiedSite` | 新增站点 |
| `sites:update` | `id, updates` | `UnifiedSite` | 更新站点字段 |
| `sites:delete` / `sites:get-by-id` / `sites:get-by-url` / `sites:get-all` / `sites:update-token` | 站点标识 / 令牌 | 对应结果 | 站点 CRUD 与令牌写回 |
| `accounts:list` / `accounts:add` / `accounts:update` / `accounts:delete` | `accountId` / `data` | 账户或结果 | 账户 CRUD |
| `storage:export` / `storage:import` / `storage:get-account` / `storage:save-account` / `storage:update-token` / `storage:delete-account` | 账户数据 | 结果 | 账户级存储读写 |
| `get-all-accounts` | 无 | `AccountCredential[]` | 汇总全部账户 |

### Token 处理器 (token-handlers.ts)

| 事件 | 请求参数 | 响应数据 | 职责 |
|------|---------|--------|------|
| `token:validate` | `account` | 校验结果 | 校验账户凭证有效性 |
| `token:initialize-site` | `baseUrl` | 初始化结果 | 站点登录初始化并补建令牌 |
| `token:check-in` | 站点/账户 | 签到结果 | 执行签到 |
| `token:refresh-display-data` / `token:refresh-account-basic-info` | `accountId` | 缓存 | 刷新展示数据 / 基础账号信息 |
| `token:create-api-token` / `token:delete-api-token` / `token:fetch-api-tokens` | 令牌参数 | 令牌列表 | API Key 增删查 |
| `token:resolve-api-key-value` / `token:fetch-user-groups` / `token:fetch-model-pricing` | 站点/Key | 解析结果 | 明文 Key 解析、分组与定价 |
| `token:list-local-api-keys` / `token:add-local-api-key` / `token:update-local-api-key` / `token:delete-local-api-key` / `token:reveal-local-api-key` / `token:refresh-local-api-keys` | 本地 Key | 本地 Key 列表 | 本地 API Key 管理（Access Token 失效时仍可用） |

### 备份处理器 (backup-handlers.ts)

| 事件 | 请求参数 | 响应数据 | 职责 |
|------|---------|--------|------|
| `backup:manual` | 无 | `{ backupPath }` | 创建手动 portable 配置包备份 |
| `backup:list` | 无 | 备份列表 | 列出本地备份 |
| `backup:restore-config` | `backupFileName` | `{ success }` | 恢复指定备份 |
| `backup:export-config-package` / `backup:import-config-package` | 路径 / 包内容 | 结果 | 配置包导出与导入 |
| `backup:get-dir` / `backup:open-dir` / `backup:get-latest-time` | 无 | 路径 / 时间 | 备份目录与最新备份时间 |

### 浏览器 Profile 处理器 (browser-profile-handlers.ts)

| 事件 | 请求参数 | 响应数据 | 职责 |
|------|---------|--------|------|
| `browser-profile:list-account-options` | 无 | Profile 选项 | 列出可绑定 Profile |
| `browser-profile:bind-account` | `accountId, profileId` | 结果 | 显式绑定账户 Profile |
| `browser-profile:login-main` / `browser-profile:login-isolated` | 站点信息 | 登录结果 | 主 / 隔离浏览器登录 |
| `browser-profile:open-site` / `browser-profile:open-site-for-checkin` | 站点 + Profile | 结果 | 用指定 Profile 打开站点 / 签到页 |
| `browser-profile:detect` / `browser-profile:delete-profile` / `browser-profile:is-chrome-running` | 无 / `profileId` | 结果 | Profile 探测、删除与 Chrome 运行状态 |

### CLI 处理器 (cli-compat-handlers.ts)

| 事件 | 请求参数 | 响应数据 | 职责 |
|------|---------|--------|------|
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
| `getSectionParentPrefix` | `section: string` | `string \| null` | 获取 TOML section 的父级前缀 |
| `mergeSectionContent` | `existingLines, newLines` | `string[]` | 合并 TOML section 内容（智能合并） |
| `mergeTomlConfig` | `existingContent, newContent` | `string` | 合并 TOML 配置（智能合并，嵌套 section 替换） |
| `mergeConfigByType` | `filePath, existingContent, newContent` | `string` | 根据文件类型选择合并策略 |

#### TOML 智能合并规则

- **顶级参数**：只更新新配置中存在的参数，保留本地独有参数
- **普通 section**：合并 section 内容（更新重叠参数，保留独有参数）
- **嵌套 section**（如 `model_providers.XXX`）：如果新配置有同一父级的 section，则移除旧的子 section，只保留新配置中的子 section
- **空白行清理**：合并后自动清理多余的连续空白行

### 路由处理器 (route-handlers.ts)

| 分组 | 事件 | 职责 |
|------|------|------|
| 服务 | `route:get-config` / `route:save-server-config` / `route:start-server` / `route:stop-server` / `route:get-runtime-status` / `route:regenerate-api-key` | 网关配置与启停 |
| 规则与模型 | `route:list-rules` / `route:upsert-rule` / `route:delete-rule` / `route:get-model-registry` / `route:rebuild-model-registry` / `route:sync-model-registry-sources` / `route:refresh-model-metadata` / `route:upsert-model-display-item` / `route:delete-model-display-item` / `route:upsert-model-mapping-override` / `route:delete-model-mapping-override` / `route:save-cli-model-selections` / `route:save-cli-thinking-effort-selections` | 规则与模型注册表 |
| 统计与日志 | `route:get-analytics-overview` / `route:get-analytics-summary` / `route:get-analytics-distribution` / `route:get-object-stats` / `route:list-stats` / `route:reset-stats` / `route:reset-analytics` / `route:get-request-logs` / `route:clear-request-logs` / `route:fetch-latest-log` / `route:getHistoryBuckets` / `route:reset-path-states` | 分析、日志与 History |
| 会话实例 | `route:list-route-instances` / `route:create-armed-route-instance` / `route:update-route-instance` / `route:archive-route-instance` / `route:restore-route-instance` / `route:close-route-instance` / `route:cancel-armed-route-instance` / `route:update-session-settings` / `route:update-client-routing` / `route:clear-session-activity` | 会话卡片生命周期 |
| 会话规则与覆盖 | `route:list-sessions` / `route:list-session-rules` / `route:upsert-session-rule` / `route:delete-session-rule` / `route:rollback-session-rule` / `route:list-session-candidates` / `route:upsert-session-override` / `route:delete-session-override` | 扫描候选与手工覆盖 |
| profile 状态 | `route:preview-profile-state-clear` / `route:clear-profile-state` | 删除配置方案前的状态影响预览与清理 |
| 端点测试 | `endpoint-test:get-state` / `endpoint-test:save-selection` / `endpoint-test:run` | 三协议原生测试 |

### DSH 处理器 (dsh-integration-handlers.ts)

| 事件 | 请求参数 | 响应数据 | 职责 |
|------|---------|--------|------|
| `dsh-integration:status` | 无 | `DshRoutingStatus` | 检测 DSH 安装、patch / 凭据状态与漂移原因 |
| `dsh-integration:model-sources` | 无 | `DshModelSource[]` | 列出可注入 DSH 的模型来源 |
| `dsh-integration:enable` | `{ modelSourceId?, migrateSessions? }` | `EnableDshSessionRoutingResult` | 写入 patch 与凭据引用（DSH 运行时跳过迁移） |
| `dsh-integration:rollback` | 无 | `DshRollbackResult` | 按条目 id 撤销，返回被跳过文件 |
| `dsh-integration:migrate-sessions` | 无 | `DshSessionMigrationResult` | 迁移存量会话 provider 引用（需 DSH 已退出） |

### Overview 处理器 (overview-handlers.ts)

| 事件 | 请求参数 | 响应数据 | 职责 |
|------|---------|--------|------|
| `overview:get-site-daily-snapshots` | `{ siteId?, days? }` | `{ [siteId]: SiteDailySnapshot[] }` | 返回数据总览页使用的站点每日快照历史 |

---

## 🔐 安全考虑

### 1. 上下文隔离与最小暴露

`main.ts` 启用 `contextIsolation`，渲染进程只能通过 `preload.ts` 的 `contextBridge` 白名单调用通道；主进程服务实例不直接暴露给渲染进程。

### 2. 敏感字段加密

配置与直连配置在磁盘 I/O 边界由 `config-field-crypto.ts` 用 AES-256-GCM 加解密（`api_key` / `access_token` / `apiKey`），明文只在主进程内存中出现。

### 3. 文件写入白名单与事务

`config-file-profile:*` 只允许写入用户显式授权过的路径，写入前校验 revision / 路径 / hash / mtime / 权限；JSON、TOML、ENV 合并失败禁止降级为整文件覆盖。

### 4. 不返回明文凭据

列表类响应默认只返回脱敏 Key；需要明文时走独立通道（如 `token:reveal-local-api-key`），由用户主动触发。

---

## 📊 数据流

### 完整的 IPC 通信流程

```
渲染进程 (renderer/)
    ↓ ipcRenderer.invoke('sites:add', site)
    ↓
preload.ts (contextBridge 白名单)
    ↓
主进程 (main/)
    ↓ ipcMain.handle('sites:add', handler)
    ↓
处理器 (handlers/unified-config-handlers.ts)
    ↓ 调用 UnifiedConfigManager
    ↓
业务服务 (main/unified-config-manager.ts)
    ↓ 校验 + 原子写入 + 广播 app-data:changed
    ↓
返回结果到处理器 → 渲染进程 → 更新 UI
```

---

## 🧪 测试

处理器测试位于 `src/__tests__/`，按域划分（如 `cli-compat-handlers.test.ts`、`custom-cli-config-handlers.test.ts`）；路由相关逻辑主要覆盖在 `route-handlers` 之上的服务层测试中（`route-proxy-service.test.ts`、`route-session-service.test.ts` 等）。测试框架为 Vitest，`electron` 模块在 `src/__tests__/setup.ts` 中被 mock。

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/main/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 3.1.3
**更新日期**: 2026-10-22
