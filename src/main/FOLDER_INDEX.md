# 📁 src/main/ - Electron 主进程

## 架构说明

**职责**: Electron 主进程，处理应用生命周期、窗口管理、IPC 通信、后端业务逻辑

**特点**:
- 与操作系统交互（文件系统、进程管理）
- 管理浏览器窗口和渲染进程
- 处理 IPC 事件，与前端通信
- 执行敏感操作（Token 管理、API 请求、浏览器自动化）

**依赖关系**:
- 依赖 `shared/` 中的类型和常量
- 被 `renderer/` 通过 IPC 调用
- 调用 `handlers/` 处理 IPC 事件

---

## 📂 文件清单

### 核心文件

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **main.ts** | 应用入口、窗口管理 | `createWindow()`, `app.whenReady()` |
| **api-service.ts** | API 请求服务 | `ApiService` 类 |
| **chrome-manager.ts** | Chrome 浏览器管理 | `ChromeManager` 类 |
| **token-service.ts** | Token 认证服务 | `TokenService` 类 |
| **cli-compat-service.ts** | CLI 兼容性测试 | `CliCompatService` 类 |
| **backup-manager.ts** | 本地备份管理 | `backupManager` 实例 |
| **webdav-manager.ts** | WebDAV 云端备份 | `WebDAVManager` 类 |
| **unified-config-manager.ts** | 统一配置管理 | `unifiedConfigManager` 实例 |
| **update-service.ts** | 应用更新服务 | `UpdateService` 类 |
| **config-detection-service.ts** | CLI 配置检测服务 | `ConfigDetectionService` 类 |
| **close-behavior-manager.ts** | 窗口关闭行为管理 | `CloseBehaviorManager` 类 |
| **preload.ts** | Preload 脚本 | IPC 上下文隔离 |
| **api-request-helper.ts** | API 请求辅助函数 | 通用请求逻辑 |

### 子文件夹

| 文件夹 | 职责 |
|--------|------|
| **handlers/** | IPC 事件处理器 |
| **types/** | TypeScript 类型定义 |
| **utils/** | 工具函数 |

---

## 🔄 核心流程

### 应用启动流程

```
main.ts: app.whenReady()
    ↓
初始化 UnifiedConfigManager (加载配置)
    ↓
初始化 TokenService (Token 管理)
    ↓
初始化 ApiService (API 请求)
    ↓
注册所有 IPC 处理器 (handlers/)
    ↓
创建窗口 (createWindow)
    ↓
加载渲染进程 (dist-renderer/index.html)
```

### IPC 通信流程

```
渲染进程 (renderer/)
    ↓ ipcRenderer.invoke('event-name', data)
主进程 (handlers/)
    ↓ ipcMain.handle('event-name', handler)
处理业务逻辑 (api-service, token-service 等)
    ↓
返回结果到渲染进程
```

---

## 🧪 关键服务

### ApiService

**职责**: 发送 HTTP 请求到 API 站点

**关键方法**:
- `request(config)` - 发送请求
- `checkBalance(site)` - 查询余额
- `checkStatus(site)` - 检测站点状态
- `checkSignIn(site)` - 检测签到状态

**依赖**: TokenService (获取 Token)

### TokenService

**职责**: 管理 Token 的获取、存储、刷新

**关键方法**:
- `getToken(site)` - 获取 Token
- `saveToken(site, token)` - 保存 Token
- `refreshToken(site)` - 刷新 Token
- `deleteToken(site)` - 删除 Token

**依赖**: ChromeManager (自动登录)

### ChromeManager

**职责**: 启动 Chrome 浏览器，自动登录获取 Token

**关键方法**:
- `launch()` - 启动浏览器
- `login(site)` - 自动登录
- `cleanup()` - 清理资源

**特点**:
- 支持 Cloudflare 智能绕过
- 随机化调试端口，避免冲突
- 自动捕获登录凭证

### CliCompatService

**职责**: 测试站点对 CLI 工具的兼容性

**关键方法**:
- `testSite(config)` - 测试站点所有 CLI 兼容性
- `testClaudeCode(url, apiKey, model)` - 测试 Claude Code
- `testCodex(url, apiKey, model)` - 测试 Codex (Chat + Responses API)
- `testCodexWithDetail(url, apiKey, model)` - 测试 Codex 并返回详细结果
- `testGeminiCli(url, apiKey, model)` - 测试 Gemini CLI
- `testGeminiWithDetail(url, apiKey, model)` - 测试 Gemini CLI 双端点并返回详细结果

**支持工具**: Claude Code, Codex (Chat/Responses), Gemini CLI (Native/Proxy)

**双端点测试功能**:
- Codex: 同时测试 Chat Completions API 和 Responses API，返回 `codexDetail`
- Gemini CLI: 同时测试 Native 原生格式和 Proxy OpenAI 兼容格式，返回 `geminiDetail`
- 测试结果包含详细信息用于配置生成和用户提示

### ConfigDetectionService

**职责**: 检测 CLI 工具当前使用的配置来源

**关键方法**:
- `detectAll(sites)` - 检测所有 CLI 配置
- `detectClaudeCode(sites)` - 检测 Claude Code 配置
- `detectCodex(sites)` - 检测 Codex 配置
- `detectGeminiCli(sites)` - 检测 Gemini CLI 配置
- `clearCache()` - 清除缓存
- `clearCacheFor(cliType)` - 清除指定 CLI 缓存

**支持工具**: Claude Code, Codex, Gemini CLI

**缓存机制**: 检测结果缓存 5 分钟，避免重复读取文件

### BackupManager

**职责**: 本地备份与恢复

**关键方法**:
- `backup()` - 创建备份
- `restore(backupPath)` - 恢复备份
- `export()` - 导出配置
- `import(configPath)` - 导入配置

### WebDAVManager

**职责**: WebDAV 云端备份与同步

**关键方法**:
- `uploadBackup()` - 上传备份
- `downloadBackup()` - 下载备份
- `sync()` - 同步配置

**支持**: 坚果云、NextCloud 等 WebDAV 服务

### UnifiedConfigManager

**职责**: 统一管理应用配置，自动迁移旧格式

**关键方法**:
- `loadConfig()` - 加载配置
- `saveConfig()` - 保存配置
- `migrate()` - 迁移旧格式

---

## 📋 IPC 事件列表

### Token 相关

- `token:get` - 获取 Token
- `token:save` - 保存 Token
- `token:delete` - 删除 Token
- `token:refresh` - 刷新 Token

### API 相关

- `api:request` - 发送 API 请求
- `api:checkBalance` - 查询余额
- `api:checkStatus` - 检测状态
- `api:checkSignIn` - 检测签到

### 配置相关

- `config:load` - 加载配置
- `config:save` - 保存配置
- `config:export` - 导出配置
- `config:import` - 导入配置

### 备份相关

- `backup:create` - 创建备份
- `backup:restore` - 恢复备份
- `backup:upload` - 上传到云端
- `backup:download` - 从云端下载

### CLI 相关

- `cli:test` - 测试 CLI 兼容性
- `cli:generateConfig` - 生成 CLI 配置

---

## 🔐 安全考虑

1. **Context Isolation**: 启用上下文隔离，防止渲染进程直接访问 Node.js API
2. **Preload 脚本**: 通过 preload.ts 暴露安全的 IPC 接口
3. **Token 存储**: Token 仅存储在主进程，不暴露给渲染进程
4. **进程隔离**: 浏览器自动化在独立进程中运行

---

## 🚀 性能优化

1. **异步处理**: 所有 I/O 操作使用异步，避免阻塞主线程
2. **缓存机制**: Token、配置等数据缓存在内存中
3. **并发控制**: API 请求支持并发限制
4. **资源清理**: 应用退出时清理浏览器进程

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引和 PROJECT_INDEX.md

---

**版本**: 2.1.9  
**更新日期**: 2025-12-26
