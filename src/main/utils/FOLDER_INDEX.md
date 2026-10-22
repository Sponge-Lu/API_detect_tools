# 📁 src/main/utils/ - 主进程工具函数

## 架构说明

**职责**: 主进程共用的底层能力：原子写盘、HTTP/Electron 网络、日志、CLI 配置解析、站点匹配与页面执行串行化。

**特点**:
- 以纯函数/单例为主，不持有业务状态
- 磁盘写入统一走 `atomic-json.ts`，保证同目标串行与 Windows rename 重试
- 网络请求统一走 `http-client.ts`（内部优先 Electron net，不可用时回退 axios）
- 无 `index.ts` 桶文件，按模块直接引用

**依赖关系**:
- 被 `main/` 下各服务与 `handlers/` 使用
- `logger.ts` 基于 `electron-log`，其余模块基本不依赖 Electron

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **atomic-json.ts** | 原子文本/JSON 读写；同目标写入串行化，Windows final rename 临时锁重试，清理残留临时文件 | `writeTextFileAtomically()`, `writeJsonFileAtomically()`, `readJsonFile()`, `cleanupStaleTempFiles()` |
| **http-client.ts** | 统一 HTTP：GET/POST/流式/raw/删除；支持上游代理、流式首包、SSE 转发、空闲超时与取消 | `httpGet()`, `httpPost()`, `httpPostStream()`, `httpRawRequest()`, `httpRawStreamRequest()`, `httpRequest()` |
| **electron-fetch.ts** | Electron `net` 封装：首包探测、raw SSE 边收边回调、`AbortSignal` 取消、分段空闲超时、代理 session 与受限 Header 过滤 | `electronFetch()`, `electronFetchStream()`, `electronFetchRawStream()`, `normalizeProxyUrl()`, `isElectronNetAvailable()` |
| **logger.ts** | 基于 `electron-log` 的统一日志器，主日志与渲染日志共用格式 | `Logger` |
| **config-parsers.ts** | Claude Code / Codex / OpenCode / Grok Build 配置解析与「生效配置」推导 | `parseClaudeCodeConfig()`, `parseCodexConfig()`, `parseOpenCodeConfig()`, `parseGrokBuildConfig()`, `getEffectiveCodexConfig()`, `checkCodexOAuthStatus()` |
| **toml-parser.ts** | TOML 解析与内容规范化（Grok Build / Codex 使用） | `parseTomlFile()`, `parseTomlString()`, `normalizeTomlContent()` |
| **env-parser.ts** | `.env` 解析 | `parseEnvFile()`, `parseEnvString()` |
| **site-matcher.ts** | URL 归一化、站点匹配与官方站点判定 | `normalizeUrl()`, `urlsEqual()`, `matchSite()`, `isOfficialUrl()`, `determineSourceType()` |
| **page-exec-queue.ts** | 同一 Puppeteer Page 的 `evaluate` 串行化，避免并发导致的不稳定 | `runOnPageQueue()` |
| **request-manager.ts** | 请求去重与短期缓存 | `requestManager` |

---

## 📝 关键约束

### 原子写入

所有配置文件、sidecar、备份的落盘都必须经过 `writeJsonFileAtomically()` / `writeTextFileAtomically()`：
- 同目标文件写入自动串行（避免并发覆盖）
- 先写临时文件再 rename，失败重试 Windows 临时锁
- 读取侧对损坏内容有明确抛错，不静默降级为空对象

### 网络栈选择

`http-client.ts` 优先使用 Electron `net`（Chromium 网络栈，继承系统代理与 TLS 行为），仅在不可用时回退 axios。涉及流式（SSE）的调用必须使用 `*Stream` 系列，以便保留首包探测与取消能力。

---

## 🔄 自指

当此文件夹中的文件变化时，更新本索引、src/main/FOLDER_INDEX.md 和 PROJECT_INDEX.md

---

**版本**: 3.1.3
**更新日期**: 2026-10-22
