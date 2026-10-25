# 📁 src/main/ - Electron 主进程

新增采纳模块：`request-rectifier.ts` 提供错误触发的窄口径请求修复；`config-file-backups.ts` 管理集中备份、历史迁移与恢复读取；`model-metadata-service.ts` 提供 models.dev 缓存、启动后台刷新及手动刷新。实现状态见 `docs/PEER_BENCHMARK_AND_ADOPTION.md`。

## 架构说明

`storage/database/`：SQLite schema、注入路径的连接、同步事务与校验快照；未在模块导入时打开数据库。

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
| **main.ts** | 应用入口、显式开发页面与构建页面加载、窗口管理 | `createWindow()`, `app.whenReady()` |
| **window-health-manager.ts** | 统一开发/预览/打包页面加载、渲染健康监控、有界恢复与内置错误页 | `loadApplicationRenderer()`, `createRendererHealthMonitor()`, `buildRendererRecoveryPage()` |
| **app-data-events.ts** | 主进程到渲染进程的数据变更通知桥，按域批量广播站点配置/站点总览/路由总览变更；广播会跳过已销毁窗口/webContents 并吞掉 Electron disposed-frame 竞态错误 | `notifyAppDataChanged()`, `broadcastRendererEvent()` |
| **app-storage-manifest.ts** | 应用本地存储清单，声明 stable config、runtime/cache/statistics、备份、日志、敏感设置与受保护浏览器状态的 owner、路径、retention/cap 和备份边界；支持 lightweight/full-manifest/portable-config 模式 | `APP_STORAGE_ENTRIES`, `resolveAppStorageManifest()` |
| **app-storage-bundle.ts** | 配置包创建/恢复；portable-config 仅含 config.json + custom-cli-configs；full-manifest 另含 runtime/settings；兼容 legacy config-only 恢复 | `createAppStorageBundleContent()`, `createPortableAppStorageBundleContent()`, `restoreAppStorageBackupContent()` |
| **config-field-crypto.ts** | 配置字段 AES-256-GCM 加密/解密，应用固定密钥版本化，在磁盘 I/O 边界透明加解密敏感字段（api_key, access_token, apiKey） | `encryptField()`, `decryptField()`, `encryptConfigFields()`, `decryptConfigFields()`, `encryptCustomCliConfigs()`, `decryptCustomCliConfigs()` |
| **request-rectifier.ts** | 按明确上游错误修复 thinking 签名、思考配置与 opaque 状态，供路由执行单次重试 | `rectifyRejectedRequest()` |
| **config-file-backups.ts** | CLI 配置集中备份：首次原件与最近十份保留（`CONFIG_BACKUP_RETENTION`）、历史迁移、备份列表与恢复读取 | `backupConfigFile()`, `listConfigFileBackups()`, `readConfigFileBackup()`, `migrateLegacyConfigBackups()` |
| **model-metadata-service.ts** | models.dev 元数据解析与缓存、启动后台刷新及手动刷新入口 | `getModelMetadata()`, `refreshModelMetadata()` |
| **api-service.ts** | API 请求服务、Bot/Cloudflare 挑战后的主进程浏览器会话回退、模型接口响应格式容错、NewAPI/Sub2API 认证失败 envelope 识别、检测状态持久化、API Key 分组异常归集、同日手动签到完成状态保留、旧站点首次检测时自动写回 `site_type`，并在缓存更新后触发站点每日快照采集；检测/刷新 HTTP 请求透传站点级 `proxy_url` 代理 | `ApiService` 类 |
| **overview-service.ts** | 数据总览聚合服务，维护站点每日快照的采集、查询和按日期汇总 | `captureSiteDailySnapshot()`, `getSiteDailySnapshots()`, `getSiteSnapshotTotals()` |
| **chrome-manager.ts** | Chrome 浏览器管理、多槽位架构、独立登录浏览器（loginBrowserState）、按目标域动态选择登录页面；兼容 legacy localStorage/Cookie 与 New API refresh AuthBundle，并仅用短期 Bearer 初始化长期 PAT；提供 Cookie/UA 投影后的 Electron Session 通用 GET/POST 请求、页面级登录态重读和账户 Profile 签到页复用 | `ChromeManager` 类 |
| **site-type-registry.ts** | 站点类型到初始化/端点/行为的注册表 | `getSiteTypeProfile()`, `resolveSiteType()` |
| **site-type-detector.ts** | 智能添加初始化前的站点类型自动识别 | `detectSiteType()` |
| **token-service.ts** | Token 认证服务，初始化阶段按 site_type 选择端点与 access token 策略，新版 New API 短期 session Bearer 仅用于创建长期 PAT；Sub2API 可从浏览器登录态重读并校验 JWT，显式 `site_type` 可覆盖 URL 反查；支持按账户浏览器槽位刷新 user_id/username/access_token 并在 token 无效时重建；统一识别认证失败 envelope，并在 NewAPI 脱敏 API Key 列表中优先使用 `/api/token/batch/keys` 批量补全明文 key；API Keys/用户分组/模型定价检测请求支持站点级 `proxyUrl` 代理透传 | `TokenService` 类 |
| **endpoint-test-service.ts** | 解析托管/直连目标，绕过本地 Route Proxy 直接执行 Messages、Responses 与 Chat Completions 上游测试，持久化最新选择、结果与 `testedAt` | `getEndpointTestState()`, `runEndpointTest()` |
| **endpoint-test-state-service.ts** | 独立保存端点测试选择与最新结果 sidecar；不读写路由运行态、统计或分析 | `endpointTestStateService` |
| **upstream-credential-resolver.ts** | 中性上游凭证解析层；解析托管/直连 Base URL、真实 API Key 与鉴权方案，不启动路由或写入路由运行态 | `resolveUpstreamCredentials()`, `resolveAccountApiKeyValue()` |
| **api-key-identity.ts** | 中性 API Key 稳定标识工具，供路由、端点测试和配置服务共享 | `resolveApiKeyId()` |
| **custom-cli-config-service.ts** | 直连接入点持久化、旧 CLI 协议迁移、虚拟路由标识与删除后的 affinity 清理 | `loadCustomCliConfigStorage()`, `buildCustomCliRouteSiteId()` |
| **config-file-profile-service.ts** | v3 配置方案、独立本地路由凭证、可用目标/模型域、结构化合并/覆盖、revision 文件事务、删除 affinity 清理和增量对话记录扫描 | `upsertConfigFileProfile()`, `previewConfigFileProfileRouteKeyRotation()`, `deleteConfigFileProfile()`, `scanSavedSessionRecordsWithDiagnostics()` |
| **dsh-integration-service.ts** | DSH 接入：检测 profile/patch/凭据状态、从路由运行时派生 baseURL/密钥/模型目录、注释保留式改写 cordis.patch.yml、备份与回滚、存量会话 provider 迁移 | `detectDshRouting()`, `enableDshSessionRouting()`, `rollbackDshSessionRouting()`, `migrateDshSessionProviders()` |
| **dsh-config-file-profile.ts** | DSH 内置配置卡片：旧凭证方案迁移、专用文件校验、模型来源和独立路由凭据解析 | `createDshConfigFileProfile()`, `migrateDshConfigFileProfiles()`, `resolveDshProfileConfig()` |
| **route-state-affinity-service.ts** | Stateful Responses 本地亲和映射、非敏感 profile 分类摘要与按 profile/site/account/API Key 实体清理；兼容清理旧 Conversation sidecar 记录 | `summarizeProfile()`, `removeByProfile()`, `removeBySites()`, `removeByAccount()`, `removeByApiKey()` |
| **route-session-activity-service.ts** | RouteInstance 高频 `lastRequestAt` sidecar，按 instance/profile 合并写入、TTL/容量压缩、启动 hydrate 与退出 flush | `hydrate()`, `touch()`, `flush()`, `removeByProfile()` |
| **custom-cli-model-service.ts** | 直连配置模型获取服务，通过 `modelUrl`（为空时回退 `baseUrl`）获取模型列表并写回配置 | `fetchModels()`, `fetchAllModels()` |
| **local-api-key-service.ts** | Access Token 无效时仍可独立管理本地 API Key，并按 Key 刷新/保留模型快照 | `listLocalApiKeys()`, `addLocalApiKey()`, `refreshLocalApiKeys()` |
| **backup-manager.ts** | 本地备份管理；自动备份保持 config-only 节流去重，手动备份生成 portable 2 文件包，恢复后重绑隔离 Profile | `backupManager` 实例 |
| **webdav-manager.ts** | WebDAV 云端 portable 配置包上传、列表、删除与恢复，兼容旧 full-manifest / config-only `.json` 备份 | `WebDAVManager` 类 |
| **unified-config-manager.ts** | 统一配置管理、损坏恢复、原子写入、legacy 字段清理、账户级 CLI 配置、客户端双模式路由与卡片钉住状态持久化及失败回滚 | `unifiedConfigManager` 实例 |
| **browser-profile-manager.ts** | 主/隔离浏览器 Profile 管理，多账户共享槽位；列出并校验账户可绑定 Profile，支持显式重绑；备份恢复后按旧 slot-N 重建空目录并重写 browser_profile_path | `BrowserProfileManager`, `listAccountProfileOptions()`, `bindAccountProfile()`, `reconcileIsolatedProfilesAfterRestore()` |
| **update-service.ts** | 应用更新服务 | `UpdateService` 类 |
| **config-detection-service.ts** | Claude Code、Codex、OpenCode、Grok Build 本地配置静态检测；Grok Build 仅读取 `~/.grok/config.toml`，不执行模型探测 | `ConfigDetectionService` 类 |
| **close-behavior-manager.ts** | 窗口关闭行为管理 | `CloseBehaviorManager` 类 |
| **route-channel-resolver.ts** | 路由通道选择与目标协议解析；凭证接口仅保留兼容导出，实际解析由中性上游凭证层负责 | `resolveChannels()`, `resolveChannelCredentials()`, `resolveChannelTarget()` |
| **route-proxy-service.ts** | 三标准协议通用本地网关调度：串行启停监听、持久化开关与运行态双重请求闸门、启动失败清理、请求分类/凭证/会话解析、规则选路与亲和排序、尝试循环与终结响应；失败终结统一以 warn 级「Route request completed」附错误码落主日志，全部路径挂起回 503 + Retry-After | `handleRequest()`, `startProxyServer()`, `stopProxyServer()` |
| **route-upstream-forwarder.ts** | 单次上游尝试的传输层：上游 URL/请求头构造、增量流校验/协议转换、原生 Anthropic 流延迟提交窗口与截断降级、SSE 错误补发 | `forwardToUpstream()`, `buildUpstreamRequestUrl()`, `buildUpstreamHeaders()` |
| **route-request-context.ts** | 单个下游请求的生命周期状态：客户端取消传播、尝试计数、请求日志上下文与终结错误码诊断 | `RouteRequestContext`, `markRouteTerminalError()` |
| **route-usage.ts** | 上游响应体/SSE 用量与思考强度解析（纯函数） | `extractUsageFromBody()`, `extractRouteReasoningEffort()` |
| **route-proxy-shared.ts** | 路由代理模块间共享的路径/协议推断小工具 | `inferSourceProtocol()`, `getRequestPathname()` |
| **route-session-service.ts** | RouteInstance 三元键、DSH 原生及兼容会话标识、父子谱系、ARMED 和生命周期管理；钉住保护阻止归档，归一化合并保留保护状态 | `extractObservedRouteInstanceKey()`, `resolveRouteInstanceForRequest()`, `listRouteInstances()` |
| **route-target-lock.ts** | 路由层内部 target-lock 请求的编解码、终止错误状态与单测试上游尝试预算；端点测试不依赖 | `buildTargetLockRouteApiKey()`, `parseTargetLockRouteApiKey()` |
| **anyrouter-request-rewriter.ts** | AnyRouter 请求/响应适配器：Claude Code 保留原始工具语义并注入 Anthropic 指纹，Codex 原生 Responses 透传，Google/Gemini GenerateContent 原生透传 | `rewriteForAnyRouter()`, `transformAnyRouterResponse()` |
| **cli-protocol-adapter.ts** | 通用 CLI 协议适配器：在 Anthropic Messages、OpenAI Chat Completions 与 OpenAI Responses 之间执行单次无损子集转换，覆盖文本、函数工具、共享 `tool_choice`/并行调用控制、思考强度、流式 SSE 与非流式 JSON；不可等价字段以 `CliProtocolAdapterError` 中立跳过候选 | `adaptRequestToTargetProtocol()`, `transformTargetProtocolResponse()`, `CliProtocolAdapterError` |
| **protocol-sse-transformer.ts** | 协议对之间的增量 SSE 状态机，处理任意传输/UTF-8 分片、文本/工具/usage/error/terminal 事件与下游生命周期 | `IncrementalProtocolSseTransformer`, `ProtocolSseTransformError` |
| **streaming-protocol-validator.ts** | Messages、Responses 与 Chat Completions 的有界增量 SSE 协议校验，维护终止、输出、usage 与工具参数状态 | `createIncrementalStreamingValidator()`, `StreamingProtocolValidationError` |
| **route-model-registry-service.ts** | 模型注册表来源聚合、真实直连多 Key/托管本地 Key 模型候选、已选重定向自动收录与排除、手工/显式 override 展示项维护与厂商优先级配置 | `rebuildModelRegistry()`, `syncModelRegistrySources()` |
| **route-analytics-service.ts** | 路由请求分析、token/缓存 token/延迟/状态码统计与对象级排行 | `recordRouteRequest()`, `getRouteObjectStats()` |
| **route-history-service.ts** | History 时间桶聚合服务，将真实路由请求按 Messages、Responses、Chat Completions 等实际请求端点分轨聚合为 48h / 2h 成功率数据 | `getHistoryBuckets()` |
| **route-stats-service.ts** | 路径级三态熔断（阶梯打开 2/10/30 分钟 → 半开单探测 → 成功闭合）、站点级熔断（连续传输异常 / 同站点同模型 404 类）、通道统计内存批量 flush；路径状态热路径不等待落盘 | `recordRoutePathOutcome()`, `beginRoutePathAttempt()`, `getRoutePathDisabledUntil()`, `sortChannelsByScore()` |
| **route-upstream-failure.ts** | 上游失败分类（请求侧/通道侧/瞬时/配额耗尽）、确证不可用原因解析、响应体摘要归一化、Retry-After 解析与聚合响应留存排序 | `classifyUpstreamFailure()`, `resolveRoutePathDisabledReason()`, `failureClassToOutcome()` |
| **route-rule-engine.ts** | 规则匹配与命中解释；协议/模型提取、规则排序与匹配抽为独立纯函数 | `findMatchingProtocolRule()`, `sortRules()`, `detectSourceProtocolFromPath()`, `extractModelFromBody()` |
| **route-session-binding-service.ts** | 会话-通道绑定侧车，让并发会话各自粘在不同上游通道；通道级绑定（不含模型）使换模型仍保住 prompt cache 亲和性 | `routeSessionBindingService`, `listActive()` |
| **runtime-cache-manager.ts** | 运行期缓存持久化：站点共享缓存、账户运行态缓存与 90 天 / 120 条上限的站点每日快照 | `RuntimeCacheManager`, `runtimeCacheManager` |
| **anyrouter-hash-extractor.ts** | AnyRouter 页面哈希指纹提取，配合 `anyrouter-request-rewriter` 完成上游校验 | `extractUserHash()` |
| **route-state-manager.ts** | 路由运行态文件管理，只维护 `route-runtime.json`、`route-analytics.json` 与模型来源快照；端点测试状态由独立 sidecar 管理 | `routeStateManager` |
| **power-manager.ts** | 电源管理，阻止系统休眠 | `powerManager` 实例 |
| **preload.ts** | Preload 脚本 | IPC 上下文隔离，暴露统一站点 CRUD / 账户 / 浏览器 Profile 列表与绑定 / 检测 / token 基础信息刷新 / 路由路径恢复 / overview 接口，并提供总览数据变更与路由日志逐条追加订阅 |
| **api-request-helper.ts** | API 请求辅助函数 | 通用请求逻辑 |

### 子文件夹

| 文件夹 | 职责 |
|--------|------|
| **browser-runtime/** | 内置 Chromium（打包分发）路径解析，浏览器降级链的第一主路径 |
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

**支持工具**: Claude Code、Codex、OpenCode、Grok Build（Grok Build 仅读取 `~/.grok/config.toml`，不做模型探测）

**缓存机制**: 检测结果缓存 5 分钟，避免重复读取文件

### Route Registry / Model Services

**职责**: 为 Route 工作台提供模型来源聚合、厂商优先级排序、通道路由与统计能力

**关键模块**:
- `route-model-registry-service.ts` - 聚合站点/账户和自定义 CLI 配置模型来源，来源扫描不自动创建重定向，仅从手工展示项和显式 override 构建 `entries`
- `route-channel-resolver.ts` - 解析可用路由通道、结合厂商优先级选择实际出口并确定目标协议
- `upstream-credential-resolver.ts` - 独立解析托管/直连真实上游凭证，供路由代理与端点测试共享
- `route-stats-service.ts` - 路径/站点级熔断状态机与通道统计；排序只依赖用户配置的优先级，不健康路径由熔断器剔除而非评分下沉
- `route-upstream-failure.ts` - 纯函数失败分类器；仅 `request_fatal` 记 `neutral` 以避免调用方载荷缺陷误禁用健康通道，故障转移行为不受其影响

> 已移除：`route-health-service.ts` 及 `route:get-health` / `route:run-health-check` IPC（v3.1.3 起由三态熔断取代，见 `route-stats-service.ts`）。

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

以下为 `ipcMain.handle()` / `webContents.send()` 实际注册的通道（按域分组，定义分散在各 `handlers/*.ts` 与 `app-data-events.ts`）。

### 无命名空间的扁平通道

- `load-config` / `save-config` - 读取 / 原子保存 v3 配置（`unified-config-handlers`）
- `get-all-accounts` - 汇总全部账户（`unified-config-handlers`）
- `detect-site` / `checkin-and-refresh` / `refresh-balance-only` - 单站检测、签到后刷新、轻量余额刷新（`detection-handlers`）
- `site:checkinAll` / `site:refreshAll` - 批量签到 / 批量刷新
- `open-url` / `fetch-with-cookies` / `launch-chrome-for-login` / `close-browser` / `close-login-browser` - 浏览器与外部链接（`detection-handlers`）

### 配置与站点

- `sites:get-all` / `sites:get-by-id` / `sites:get-by-url` / `sites:add` / `sites:update` / `sites:delete` / `sites:update-token`
- `accounts:list` / `accounts:add` / `accounts:update` / `accounts:delete`
- `storage:get-account` / `storage:save-account` / `storage:update-token` / `storage:delete-account` / `storage:export` / `storage:import`

### 检测与 Token

- `token:initialize-site` / `token:validate` / `token:check-in`
- `token:refresh-display-data` / `token:refresh-account-basic-info`
- `token:create-api-token` / `token:delete-api-token` / `token:fetch-api-tokens` / `token:resolve-api-key-value`
- `token:fetch-user-groups` / `token:fetch-model-pricing`
- `token:add-local-api-key` / `token:update-local-api-key` / `token:delete-local-api-key` / `token:list-local-api-keys` / `token:reveal-local-api-key` / `token:refresh-local-api-keys`
- `detection:detect-cli-config` / `detection:detect-all-cli-config` / `detection:read-cli-config-files` / `detection:reset-cli-config` / `detection:clear-cli-config-cache` / `detection:save-cli-config-file`

### 浏览器 Profile

- `browser-profile:detect` / `browser-profile:delete-profile` / `browser-profile:is-chrome-running`
- `browser-profile:list-account-options` / `browser-profile:bind-account`
- `browser-profile:login-main` / `browser-profile:login-isolated`
- `browser-profile:open-site` / `browser-profile:open-site-for-checkin` / `browser-profile:persist-checkin-completion`

### 路由（`route:*`）

- 服务：`route:get-config` / `route:save-server-config` / `route:start-server` / `route:stop-server` / `route:get-runtime-status` / `route:regenerate-api-key`
- 规则与模型：`route:list-rules` / `route:upsert-rule` / `route:delete-rule` / `route:get-model-registry` / `route:rebuild-model-registry` / `route:sync-model-registry-sources` / `route:refresh-model-metadata` / `route:upsert-model-display-item` / `route:delete-model-display-item` / `route:upsert-model-mapping-override` / `route:delete-model-mapping-override` / `route:save-cli-model-selections` / `route:save-cli-thinking-effort-selections`
- 统计与日志：`route:get-analytics-overview` / `route:get-analytics-summary` / `route:get-analytics-distribution` / `route:get-object-stats` / `route:list-stats` / `route:reset-stats` / `route:reset-analytics` / `route:get-request-logs` / `route:clear-request-logs` / `route:fetch-latest-log` / `route:getHistoryBuckets` / `route:reset-path-states`
- 会话实例：`route:list-route-instances` / `route:create-armed-route-instance` / `route:update-route-instance` / `route:archive-route-instance` / `route:restore-route-instance` / `route:close-route-instance` / `route:cancel-armed-route-instance` / `route:update-session-settings` / `route:update-client-routing` / `route:clear-session-activity`
- 会话规则与覆盖：`route:list-sessions` / `route:list-session-rules` / `route:upsert-session-rule` / `route:delete-session-rule` / `route:rollback-session-rule` / `route:list-session-candidates` / `route:upsert-session-override` / `route:delete-session-override`
- profile 状态：`route:preview-profile-state-clear` / `route:clear-profile-state`
- 端点测试：`endpoint-test:get-state` / `endpoint-test:save-selection` / `endpoint-test:run`

### 配置卡片（`config-file-profile:*`）

- 基础：`load` / `upsert` / `delete` / `target-catalog`
- 预览与事务：`preview` / `preview-direct-edit` / `commit` / `read-files`
- 备份：`list-backups` / `preview-backup-restore` / `restore-builtin` / `restore-missing-builtins`
- 凭证与授权：`generate-route-key` / `preview-route-key-rotation` / `switch-auth-mode` / `resolve-values`
- 诊断：`validate-session-record`

### DSH 接入

- `dsh-integration:status` / `model-sources` / `enable` / `rollback` / `migrate-sessions`

### 总览 / 备份 / 更新 / 其它

- `overview:get-site-daily-snapshots`
- `backup:manual` / `backup:list` / `backup:restore-config` / `backup:export-config-package` / `backup:import-config-package` / `backup:get-dir` / `backup:open-dir` / `backup:get-latest-time`
- `webdav:get-config` / `webdav:save-config` / `webdav:test-connection` / `webdav:upload-backup` / `webdav:list-backups` / `webdav:delete-backup` / `webdav:restore-backup`
- `update:check` / `update:get-current-version` / `update:get-settings` / `update:save-settings` / `update:start-download` / `update:cancel-download` / `update:install` / `update:open-download`
- `theme:load` / `theme:save`
- `cli-compat:save-config` / `cli-compat:write-config`
- `custom-cli-config:load` / `custom-cli-config:save` / `custom-cli-config:fetch-models`
- `close-behavior:get-settings` / `save-settings` / `show-dialog` / `dialog-response` / `minimize-to-tray` / `quit-app`
- `anyrouter:extractUserHash` / `anyrouter:extractAllUserHashes`

### 主进程推送事件（`webContents.send`）

- `app-data:changed` - 按域广播站点配置 / 站点快照 / 路由总览变更（`app-data-events.ts`）
- `route:request-log-appended` - 路由日志逐条追加
- `route:model-metadata-updated` - 模型元数据刷新完成
- `update:download-progress` - 下载进度
- `site-init-status` - 站点初始化状态
- `close-behavior:show-dialog` - 关闭行为确认弹窗

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

**版本**: 3.1.3
**更新日期**: 2026-10-22

## 架构与数据管理重构（2026-10-24）

- [main.ts](main.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [preload.ts](preload.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [unified-config-manager.ts](unified-config-manager.ts): 稳定配置事务发布，保留期间更新的运行缓存
- [runtime-cache-manager.ts](runtime-cache-manager.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [config-file-profile-service.ts](config-file-profile-service.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [custom-cli-config-service.ts](custom-cli-config-service.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [route-state-manager.ts](route-state-manager.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [route-stats-service.ts](route-stats-service.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [route-analytics-service.ts](route-analytics-service.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [route-session-activity-service.ts](route-session-activity-service.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [route-session-binding-service.ts](route-session-binding-service.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [route-state-affinity-service.ts](route-state-affinity-service.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [endpoint-test-state-service.ts](endpoint-test-state-service.ts): 相关行为回归测试
- [route-history-service.ts](route-history-service.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [route-proxy-service.ts](route-proxy-service.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [backup-manager.ts](backup-manager.ts): 自动备份先节流后快照，强制备份与内容去重
- [webdav-manager.ts](webdav-manager.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [close-behavior-manager.ts](close-behavior-manager.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [update-service.ts](update-service.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [token-service.ts](token-service.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [chrome-manager.ts](chrome-manager.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [browser-profile-manager.ts](browser-profile-manager.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [app-storage-bundle.ts](app-storage-bundle.ts): portable/full 配置包按所需域读取一致性快照
- [app-storage-manifest.ts](app-storage-manifest.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [api-service.ts](api-service.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [config-file-backups.ts](config-file-backups.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为

## 职责子模块（2026-10-24）

- [storage/](storage/FOLDER_INDEX.md)
- [config/](config/FOLDER_INDEX.md)
- [auth/](auth/FOLDER_INDEX.md)
- [clients/](clients/FOLDER_INDEX.md)
- [browser-runtime/](browser-runtime/FOLDER_INDEX.md)
