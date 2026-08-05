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
| **window-health-manager.ts** | 主窗口渲染健康监控、有界自动恢复与内置错误页 | `createRendererHealthMonitor()`, `buildRendererRecoveryPage()` |
| **app-data-events.ts** | 主进程到渲染进程的数据变更通知桥，按域批量广播站点配置/站点总览/路由总览变更；广播会跳过已销毁窗口/webContents 并吞掉 Electron disposed-frame 竞态错误 | `notifyAppDataChanged()`, `broadcastRendererEvent()` |
| **app-storage-manifest.ts** | 应用本地存储清单，声明 stable config、runtime/cache/statistics、备份、日志、敏感设置与受保护浏览器状态的 owner、路径、retention/cap 和备份边界；支持 lightweight/full-manifest/portable-config 模式 | `APP_STORAGE_ENTRIES`, `resolveAppStorageManifest()` |
| **app-storage-bundle.ts** | 配置包创建/恢复；portable-config 仅含 config.json + custom-cli-configs；full-manifest 另含 runtime/settings；兼容 legacy config-only 恢复 | `createAppStorageBundleContent()`, `createPortableAppStorageBundleContent()`, `restoreAppStorageBackupContent()` |
| **config-field-crypto.ts** | 配置字段 AES-256-GCM 加密/解密，应用固定密钥版本化，在磁盘 I/O 边界透明加解密敏感字段（api_key, access_token, apiKey） | `encryptField()`, `decryptField()`, `encryptConfigFields()`, `decryptConfigFields()`, `encryptCustomCliConfigs()`, `decryptCustomCliConfigs()` |
| **api-service.ts** | API 请求服务、Bot/Cloudflare 挑战后的主进程浏览器会话回退、模型接口响应格式容错、NewAPI/Sub2API 认证失败 envelope 识别、检测状态持久化、同日手动签到完成状态保留、旧站点首次检测时自动写回 `site_type`，并在缓存更新后触发站点每日快照采集 | `ApiService` 类 |
| **overview-service.ts** | 数据总览聚合服务，维护站点每日快照的采集、查询和按日期汇总 | `captureSiteDailySnapshot()`, `getSiteDailySnapshots()`, `getSiteSnapshotTotals()` |
| **chrome-manager.ts** | Chrome 浏览器管理、多槽位架构、独立登录浏览器（loginBrowserState）、按目标域动态选择登录页面；兼容 legacy localStorage/Cookie 与 New API refresh AuthBundle，并仅用短期 Bearer 初始化长期 PAT；提供 Cookie/UA 投影后的 Electron Session 通用 GET/POST 请求、页面级登录态重读和账户 Profile 签到页复用 | `ChromeManager` 类 |
| **site-type-registry.ts** | 站点类型到初始化/端点/行为的注册表 | `getSiteTypeProfile()`, `resolveSiteType()` |
| **site-type-detector.ts** | 智能添加初始化前的站点类型自动识别 | `detectSiteType()` |
| **token-service.ts** | Token 认证服务，初始化阶段按 site_type 选择端点与 access token 策略，新版 New API 短期 session Bearer 仅用于创建长期 PAT；Sub2API 可从浏览器登录态重读并校验 JWT，显式 `site_type` 可覆盖 URL 反查；支持按账户浏览器槽位刷新 user_id/username/access_token 并在 token 无效时重建；统一识别认证失败 envelope，并在 NewAPI 脱敏 API Key 列表中优先使用 `/api/token/batch/keys` 批量补全明文 key | `TokenService` 类 |
| **endpoint-test-service.ts** | 解析托管/直连目标，执行 Messages、Responses 与 Chat Completions 手动 HTTP 测试，持久化最新选择、结果与 `testedAt` | `getEndpointTestState()`, `runEndpointTest()` |
| **custom-cli-config-service.ts** | 自定义 CLI 配置持久化服务，并为路由生成自定义 CLI 虚拟站点/账户/API Key 标识 | `loadCustomCliConfigStorage()`, `buildCustomCliRouteSiteId()` |
| **custom-cli-model-service.ts** | 直连配置模型获取服务，通过 `baseUrl + /v1/models` 获取模型列表并写回配置 | `fetchModels()`, `fetchAllModels()` |
| **backup-manager.ts** | 本地备份管理；自动备份保持 config-only 节流去重，手动备份生成 portable 2 文件包，恢复后重绑隔离 Profile | `backupManager` 实例 |
| **webdav-manager.ts** | WebDAV 云端 portable 配置包上传、列表、删除与恢复，兼容旧 full-manifest / config-only `.json` 备份 | `WebDAVManager` 类 |
| **unified-config-manager.ts** | 统一配置管理、损坏恢复、原子写入、legacy 字段清理、账户级 CLI 配置与路由运行态恢复 | `unifiedConfigManager` 实例 |
| **browser-profile-manager.ts** | 主/隔离浏览器 Profile 管理，多账户共享槽位；列出并校验账户可绑定 Profile，支持显式重绑；备份恢复后按旧 slot-N 重建空目录并重写 browser_profile_path | `BrowserProfileManager`, `listAccountProfileOptions()`, `bindAccountProfile()`, `reconcileIsolatedProfilesAfterRestore()` |
| **update-service.ts** | 应用更新服务 | `UpdateService` 类 |
| **config-detection-service.ts** | Claude Code、Codex、OpenCode、Grok Build 本地配置静态检测；Grok Build 仅读取 `~/.grok/config.toml`，不执行模型探测 | `ConfigDetectionService` 类 |
| **close-behavior-manager.ts** | 窗口关闭行为管理 | `CloseBehaviorManager` 类 |
| **credit-service.ts** | Linux Do Credit 积分检测、LDC 充值 | `CreditService` 类 |
| **route-channel-resolver.ts** | 路由通道解析，结合站点/账户/API Key/自定义 CLI 配置与厂商优先级选择实际通道；CLI targetProtocol 按账户级配置优先、站点级旧配置 fallback | `resolveChannels()`, `resolveChannelCredentials()` |
| **route-proxy-service.ts** | 本地路由代理服务器，按规则选择上游通道，支持流式转发、协议适配、客户端取消与端点测试 target lock 隔离 | `startRouteProxyServer()`, `stopRouteProxyServer()`, `extractUsageFromBody()` |
| **route-target-lock.ts** | 端点测试专用的 loopback 目标锁定编解码、终止错误状态与单测试上游尝试预算 | `buildTargetLockRouteApiKey()`, `parseTargetLockRouteApiKey()` |
| **anyrouter-request-rewriter.ts** | AnyRouter 请求/响应适配器：Claude Code 保留原始工具语义并注入 Anthropic 指纹，Codex 原生 Responses 透传，Google/Gemini GenerateContent 原生透传 | `rewriteForAnyRouter()`, `transformAnyRouterResponse()` |
| **cli-protocol-adapter.ts** | 通用 CLI 协议适配器：在 Anthropic Messages、OpenAI Chat Completions 与 OpenAI Responses 之间执行单次无损子集转换，覆盖文本、函数工具、共享 `tool_choice`/并行调用控制、思考强度、流式 SSE 与非流式 JSON；不可等价字段以 `CliProtocolAdapterError` 中立跳过候选 | `adaptRequestToTargetProtocol()`, `transformTargetProtocolResponse()`, `CliProtocolAdapterError` |
| **route-model-registry-service.ts** | 模型注册表来源聚合、手工/显式 override 展示项维护与厂商优先级配置；所有模型来源均标记四种内置路由 CLI 可用，扫描只刷新候选来源，不自动创建重定向 | `rebuildModelRegistry()`, `syncModelRegistrySources()` |
| **route-analytics-service.ts** | 路由请求分析、token/缓存 token/延迟/状态码统计与对象级排行 | `recordRouteRequest()`, `getRouteObjectStats()` |
| **route-history-service.ts** | History 时间桶聚合服务，只将真实路由请求按 48h / 2h 桶聚合为成功率数据 | `getHistoryBuckets()` |
| **route-stats-service.ts** | 路由调用统计与通道评分排序 | `recordOutcome()`, `sortChannelsByScore()` |
| **route-state-manager.ts** | 路由运行态文件管理，维护 `route-runtime.json`、`route-endpoint-tests.json`、`route-analytics.json` 与模型来源快照 | `routeStateManager` |
| **power-manager.ts** | 电源管理，阻止系统休眠 | `powerManager` 实例 |
| **preload.ts** | Preload 脚本 | IPC 上下文隔离，暴露统一站点 CRUD / 账户 / 浏览器 Profile 列表与绑定 / 检测 / token 基础信息刷新 / 路由路径恢复 / overview 接口，并提供总览数据变更与路由日志逐条追加订阅 |
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
启动电源保护 (powerManager.start)
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

**职责**: 发送 HTTP 请求到 API 站点，持久化检测状态，并在旧站点首次检测时自动识别并写回 `site_type`

**关键方法**:
- `request(config)` - 发送请求
- `checkBalance(site)` - 查询余额
- `checkStatus(site)` - 检测站点状态
- `checkSignIn(site)` - 检测签到状态
- `detectLdcPayment(site, timeout, sharedPage)` - 检测 LDC 支付支持
- `saveCachedDisplayData(siteUrl, result)` - 保存检测结果到缓存（含状态和错误信息）
- `saveLastDetectionStatus(siteUrl, status, error)` - 保存失败检测状态到缓存
- `refreshBalanceOnly(site, timeout, checkinStats, page, accountId)` - 轻量级余额刷新（支持账户级缓存）

**DetectionRequestContext（多账户上下文）**:
- `accountId` - 账户 ID，用于账户级缓存读写
- `browserSlot` - 浏览器槽位索引（0=主浏览器，N=隔离浏览器），由账户位置决定

**依赖**: TokenService (获取 Token)

**浏览器模式说明**:
- 当检测到 Cloudflare/Bot 防护并进入浏览器模式后，会复用同一 `sharedPage` 继续请求后续端点，避免每个端点重复 "axios → browser"。
- 共享页面上的请求会被串行化（`runOnPageQueue`），避免并发 `page.evaluate` 导致偶发不稳定。
- **并发安全**: `sharedPage` 被其他任务关闭时，自动检测 `Target closed` 异常并重试创建新页面。

### TokenService

**职责**: 管理 Token 的获取、存储、刷新，以及签到功能

**关键方法**:
- `getToken(site)` - 获取 Token
- `saveToken(site, token)` - 保存 Token
- `refreshToken(site)` - 刷新 Token
- `recreateSub2ApiAccessTokenFromBrowser(baseUrl, userId, context?)` - 从浏览器登录态重读并验证 Sub2API JWT
- `deleteToken(site)` - 删除 Token
- `checkSiteSupportsCheckIn(baseUrl, page?)` - 检查站点是否支持签到（兼容 Veloera/New API）
- `fetchCheckInStatus(baseUrl, userId, accessToken, page?, explicitSiteType?)` - 获取签到状态（按 `site_type` 选择端点）
- `checkIn(baseUrl, userId, accessToken, page?, explicitSiteType?)` - 执行签到（按 `site_type` 选择端点和响应格式，支持浏览器模式回退）
- `fetchCheckinStats(baseUrl, userId, accessToken, page?)` - 获取当月签到统计（New API）
- `checkInWithBrowser(baseUrl, userId, accessToken)` - 浏览器模式签到（绕过 Cloudflare）

**签到功能兼容性**:
- Veloera: `check_in_enabled`, `/api/user/check_in_status`, `/api/user/check_in`, `reward`
- New API: `checkin_enabled`, `/api/user/checkin?month=YYYY-MM`, `/api/user/checkin`, `quota_awarded`

**签到统计功能 (New API)**:
- 签到成功后自动获取签到统计数据
- 返回 `CheckinStats`: `todayQuota` (今日签到金额), `checkinCount` (当月签到次数), `totalCheckins` (累计签到次数)
- 支持浏览器模式回退，当 axios 被 Cloudflare 拦截时自动切换

**依赖**: ChromeManager (自动登录)

### ChromeManager

**职责**: 多槽位浏览器池管理，自动登录获取 Token，读取 localStorage 数据，并支持按账户 Profile 直接打开站点/签到

**多槽位架构**:
- slot 0 = 主浏览器 (`api-detector-chrome`)，所有站点的第 1 个账号共用
- slot N = 隔离浏览器 N (`api-detector-chrome-isolated-N`)，所有站点的第 N+1 个账号共用
- 每个槽位独立管理生命周期：browser / chromeProcess / debugPort / refCount / cleanupTimer
- 向后兼容：旧代码通过 getter/setter 代理透明访问 slot 0

**关键方法**:
- `launch()` - 启动浏览器
- `login(site)` - 自动登录
- `cleanup()` - 清理所有槽位资源
- `forceCleanup()` - 强制清理所有槽位（重置引用计数）
- `getLocalStorageData(url, waitForLogin, maxWaitTime, onStatus, { siteType })` - 获取 localStorage 数据（含按类型的 API 回退）
- `readAuthDataFromPage(page, url, { siteType })` - 在已打开页面上重读 localStorage/API 登录态
- `createPage(url, { slot })` - 创建页面（slot 0 走原有逻辑，slot N 走隔离浏览器）
- `createPageForSlot(url, slotIndex)` - 为指定隔离槽位创建页面
- `findExistingPageForUrl(url)` - 查找可复用的同域名页面
- `openSiteWithProfile(url, options)` - 使用指定 Profile 直接打开站点
- `openSiteWithProfileForCheckin(url, profileOptions, checkinOptions)` - 复用账户 Profile 打开站点，识别到登录后等待再自动关闭

**并发安全**:
- `cleanupOldPages` 在 `browserRefCount > 1` 时跳过清理，避免关闭其他并发检测任务正在使用的页面

**LocalStorageData 登录态字段**:
- `auth_user` / `auth_token` 可作为登录凭据读取，但不能单独推断为 Sub2API

**LocalStorageData 签到字段**:
- Veloera: `check_in_enabled`, `can_check_in`
- New API: `checkin_enabled`, `checkin.stats.checked_in_today` (取反得到 canCheckIn)

**特点**:
- 支持 Cloudflare 智能绕过
- 随机化调试端口，避免冲突
- 自动捕获登录凭证
- 支持两种站点类型的签到状态读取
- **页面复用策略**: 同域名页面复用，保持 session 连续性（v2.1.11+）

### ConfigDetectionService

**职责**: 检测 CLI 工具当前使用的配置来源

**关键方法**:
- `detectAll(sites)` - 检测所有 CLI 配置
- `detectClaudeCode(sites)` - 检测 Claude Code 配置
- `detectCodex(sites)` - 检测 Codex 配置
- `clearCache()` - 清除缓存
- `clearCacheFor(cliType)` - 清除指定 CLI 缓存

**支持工具**: Claude Code, Codex

**缓存机制**: 检测结果缓存 5 分钟，避免重复读取文件

### CreditService

**职责**: Linux Do Credit 积分检测服务

**关键方法**:
- `fetchCreditData()` - 获取积分数据（基准值、当前分、差值）
- `launchLogin()` - 启动浏览器登录
- `getLoginStatus()` - 获取登录状态
- `logout()` - 登出
- `saveConfig(config)` - 保存配置
- `loadConfig()` - 加载配置
- `getCachedCreditInfo()` - 获取缓存的积分数据

**依赖**: ChromeManager (浏览器登录)

### Route Registry / Probe Services

**职责**: 为 Route 工作台提供模型来源聚合、厂商优先级排序、CLI wrapper 探测和统计评分能力

**关键模块**:
- `route-model-registry-service.ts` - 聚合站点/账户和自定义 CLI 配置模型来源，来源扫描不自动创建重定向，仅从手工展示项和显式 override 构建 `entries`
- `route-cli-probe-service.ts` - 按站点下全部活跃账户和自定义 CLI 虚拟配置执行 Claude Code / Codex wrapper 探测，并维护 `history/latest`
- `route-channel-resolver.ts` - 解析可用通道、补全真实 API Key 或自定义 CLI 凭证、结合厂商优先级选择实际出口
- `route-stats-service.ts` - 记录运行结果并计算评分，供通道排序和统计视图复用

### PowerManager

**职责**: 电源管理，阻止系统在应用运行时进入休眠/睡眠状态

**关键方法**:
- `start()` - 启动电源保护
- `stop()` - 停止电源保护
- `isRunning()` - 检查是否正在运行
- `getStatus()` - 获取当前状态

**特点**:
- 使用 Electron `powerSaveBlocker` API
- 采用 `prevent-display-sleep` 模式，同时阻止显示器和系统休眠
- 特别适用于远程桌面环境，防止系统误判无用户活动而休眠

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

**职责**: 统一管理应用配置，自动迁移旧格式，并在配置损坏时优先从本地备份恢复

**关键方法**:
- `loadConfig()` - 加载配置
- `saveConfig()` - 原子保存配置
- `migrate()` - 迁移旧格式

### OverviewService

**职责**: 为 `数据总览` 页面提供站点级每日历史快照，并在主进程中复用当前检测缓存生成轻量趋势数据

**关键方法**:
- `captureSiteDailySnapshot(siteId, capturedAt?)` - 从站点/账户当前缓存生成当日快照
- `getSiteDailySnapshots({ siteId?, days? })` - 查询站点历史快照
- `getSiteSnapshotTotals({ days? })` - 按日期聚合全站快照总量

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

### Credit 相关

- `credit:fetch` - 获取积分数据
- `credit:login` - 启动登录
- `credit:logout` - 登出
- `credit:get-status` - 获取登录状态
- `credit:save-config` - 保存配置
- `credit:load-config` - 加载配置
- `credit:get-cached` - 获取缓存数据

### Overview 相关

- `overview:get-site-daily-snapshots` - 获取站点每日快照历史

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

**版本**: 3.0.5
**更新日期**: 2026-06-17
