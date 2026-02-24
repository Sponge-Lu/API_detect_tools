# API Hub Management Tools - 架构文档

## 📖 目录

- [架构概览](#架构概览)
- [核心技术栈](#核心技术栈)
- [目录结构](#目录结构)
- [核心模块设计](#核心模块设计)
  - [状态管理 (Zustand)](#状态管理-zustand)
  - [IPC 通信架构](#ipc-通信架构)
  - [后端服务层](#后端服务层)
  - [认证与安全](#认证与安全)
- [关键工作流](#关键工作流)
  - [应用启动流程](#应用启动流程)
  - [站点检测流程](#站点检测流程)
  - [浏览器自动化流程](#浏览器自动化流程)

---

## 架构概览

本项目采用 **Electron + React + TypeScript** 技术栈，遵循 **主进程 (Main Process)** 与 **渲染进程 (Renderer Process)** 分离的架构模式。

- **主进程**：负责系统级操作，如文件读写、浏览器自动化 (Puppeteer)、网络请求代理、配置持久化等。
- **渲染进程**：负责 UI 展示、用户交互、状态管理，通过 IPC (Inter-Process Communication) 与主进程通信。

---

## 核心技术栈

| 领域 | 技术/库 | 用途 |
|------|---------|------|
| **框架** | Electron | 跨平台桌面应用运行时 |
| **前端** | React 18 | UI 构建库 |
| **语言** | TypeScript | 静态类型检查 |
| **构建** | Vite | 高性能构建工具 |
| **状态管理** | Zustand | 轻量级全局状态管理 |
| **样式** | Tailwind CSS | 原子化 CSS 框架 |
| **自动化** | Puppeteer | 无头浏览器控制 (用于自动登录/Cloudflare 绕过) |
| **验证** | Zod | 运行时 Schema 验证 |
| **测试** | Vitest | 单元测试框架 |

---

## 目录结构

```
src/
├── main/                          # Electron 主进程
│   ├── handlers/                  # IPC 处理器（按功能拆分）
│   │   ├── unified-config-handlers.ts # 统一配置处理器
│   │   ├── theme-handlers.ts      # 主题管理
│   │   ├── backup-handlers.ts     # 备份恢复
│   │   ├── token-handlers.ts      # 令牌与认证
│   │   ├── detection-handlers.ts  # 站点检测
│   │   ├── cli-compat-handlers.ts # CLI 兼容性测试
│   │   ├── custom-cli-config-handlers.ts # 自定义 CLI 配置
│   │   ├── update-handlers.ts     # 软件更新下载与安装
│   │   ├── webdav-handlers.ts     # WebDAV 云端备份
│   │   └── index.ts               # 统一注册入口
│   ├── utils/                     # 后端工具
│   ├── types/                     # 后端类型定义
│   ├── api-service.ts             # API 请求服务 (核心业务)
│   ├── token-service.ts           # 令牌管理服务
│   ├── chrome-manager.ts          # 浏览器自动化管理
│   ├── unified-config-manager.ts  # 统一配置管理 (config.json)
│   ├── backup-manager.ts          # 本地备份管理
│   ├── webdav-manager.ts          # WebDAV 云端备份管理
│   ├── update-service.ts          # 软件更新服务
│   ├── cli-compat-service.ts      # CLI 兼容性测试服务
│   ├── main.ts                    # 主进程入口
│   └── preload.ts                 # 预加载脚本 (IPC 桥接)
│
├── renderer/                      # React 渲染进程
│   ├── components/                # UI 组件
│   ├── hooks/                     # 自定义 Hooks (业务逻辑封装)
│   ├── store/                     # Zustand Store (状态管理)
│   ├── utils/                     # 前端工具
│   └── App.tsx                    # 主组件
│
└── shared/                        # 前后端共享
    ├── constants/                 # 常量定义
    ├── schemas/                   # Zod 验证 Schema
    └── types/                     # 统一类型定义
```

---

## 核心模块设计

### iOS 设计系统

项目采用 Apple Human Interface Guidelines 设计语言，实现了完整的 iOS 风格设计系统：

**CSS 变量体系** (`src/renderer/index.css`):
- 颜色系统：主色、背景色、文字色、边框色（支持浅色/深色模式）
- 字体系统：SF Pro 字体族，标准字号和字重
- 间距系统：8px 网格，所有间距值为 4px 的倍数
- 圆角系统：标准圆角值（4px、8px、12px、16px、20px）
- 阴影系统：多层次阴影效果
- 模糊系统：毛玻璃效果参数

**组件库** (`src/renderer/components/`):
| 组件 | 文件 | 功能 |
|------|------|------|
| IOSButton | `IOSButton/IOSButton.tsx` | Primary/Secondary/Tertiary 变体，支持 ref 转发 |
| IOSCard | `IOSCard/IOSCard.tsx` | 毛玻璃背景、展开/收起动画 |
| IOSInput | `IOSInput/IOSInput.tsx` | 聚焦状态、密码显示切换 |
| IOSModal | `IOSModal/IOSModal.tsx` | 缩放+淡入淡出动画、焦点陷阱 |
| IOSTable | `IOSTable/IOSTable.tsx` | 分组样式、交错淡入动画 |
| IOSIcon | `IOSIcon/IOSIcon.tsx` | 统一 1.5px stroke-width、标准尺寸 |

**性能优化**:
- GPU 加速：`transform: translateZ(0)` 和 `will-change` 属性
- 高性能动画：仅使用 `transform` 和 `opacity` 属性
- `prefers-reduced-motion` 支持：尊重用户的动画偏好设置

**无障碍性**:
- 焦点指示器：清晰的键盘焦点样式
- 键盘导航：完整的 Tab 键导航支持
- ARIA 属性：语义化的无障碍标签

**主题切换**:
- 300ms 平滑过渡
- 自动检测系统主题偏好
- 手动切换支持

### 状态管理 (Zustand)

为了避免 React Context 的性能问题和 Prop Drilling，项目采用 Zustand 进行状态管理，拆分为多个独立的 Store：

- **configStore**: 管理全局配置、站点列表、分组信息。
- **detectionStore**: 管理站点检测结果、加载状态、并发刷新状态。
- **uiStore**: 管理 UI 状态（如侧边栏折叠、拖拽状态）。
- **toastStore**: 管理全局通知消息。

**并发刷新支持**：
- `detectionStore` 使用 `detectingSites: Set<string>` 跟踪多个正在刷新的站点。
- `upsertResult` 方法确保并发刷新时结果不会互相覆盖。

**性能优化策略**：
- 模型列表采用分页渲染，默认只显示前 50 个模型，避免大量 DOM 元素导致的渲染延迟。
- 展开全部站点时同步加载缓存数据，确保即时响应。

### IPC 通信架构

主进程中的 IPC 处理器被拆分为多个独立的模块 (Handlers)，在 `main/handlers/index.ts` 中统一注册。

**通信模式**：
1. **渲染进程** 调用 `window.electronAPI.xxx()` (通过 `preload.ts` 暴露)。
2. **IPC 通道** 触发主进程对应的 `handle` 函数。
3. **主进程** 执行业务逻辑 (调用 Service 层)。
4. **结果返回** 给渲染进程 (Promise)。

### 后端服务层

主进程的业务逻辑封装在几个核心 Service 类中，实现关注点分离：

- **ApiService**: 处理所有 HTTP 请求，负责站点余额、模型列表、API Key 的获取。内置请求去重和缓存机制。日志统计时自动过滤非模型调用日志，确保今日消费、Token 使用量和请求次数只统计真正的模型调用。
- **TokenService**: 负责处理 API Key 的创建、删除、权限验证，以及适配不同站点的 Token 协议。同时负责签到功能，支持 Veloera 和 New API 两种站点类型的签到 API 兼容（不同的签到状态检测端点和签到执行端点）。
- **ChromeManager**: 管理 Puppeteer 实例的生命周期。负责启动浏览器、管理页面、注入脚本、提取 LocalStorage/Cookie 信息。支持浏览器复用和崩溃自动重启。
- **UnifiedConfigManager**: 负责 `config.json` 的读写，保证配置数据的原子性和一致性。支持前端兼容层，在保存旧格式配置时自动保留 WebDAV 等扩展配置。
- **WebDAVManager**: 负责 WebDAV 云端备份功能，包括连接测试、备份上传/下载/删除、自动清理旧备份等。使用动态 import 加载 ESM 模块以兼容 Electron 的 CommonJS 环境。
- **UpdateService**: 负责软件更新检测与应用内下载安装。通过 GitHub Releases API 获取最新版本信息，支持正式版/预发布检测，支持按平台选择安装包、下载进度上报、取消下载与安装触发。
- **CliCompatService**: 负责 CLI 兼容性测试功能，支持 Claude Code、Codex、Gemini CLI 三种工具的兼容性检测，通过模拟 API 请求验证站点是否支持特定 CLI 工具。Codex 仅测试 Responses API（chat 模式已废弃），Gemini CLI 支持双端点测试（Native 原生格式和 Proxy OpenAI 兼容格式），测试结果包含详细信息用于配置生成和用户提示。
- **CliConfigGenerator**: 负责生成 CLI 配置文件内容，支持 Claude Code、Codex 和 Gemini CLI 配置生成，按照 `docs/cli_config_template/` 中的模板格式生成配置。Claude Code 配置包含 HTTPS_PROXY 和 HTTP_PROXY 代理设置。Codex 配置固定使用 `wire_api = "responses"`（chat 模式已废弃）并添加测试结果注释。Gemini CLI 配置根据双端点测试结果添加端点说明和使用建议注释。同时提供配置模板函数用于未选择 API Key 和模型时的预览显示。应用配置时采用合并模式，只更新相关配置项，保留用户的其他设置。
- **CustomCliConfigHandlers**: 负责自定义 CLI 配置的 IPC 持久化（load/save）和模型拉取（OpenAI 兼容 `/v1/models`），用于非兼容站点或仅有 Base URL + Key 的场景。
- **CloseBehaviorManager**: 负责窗口关闭行为管理，支持退出应用或最小化到系统托盘。管理用户偏好设置的持久化，创建和管理系统托盘图标及上下文菜单。
- **CreditService**: 负责 Linux Do Credit 积分查询和充值功能。通过浏览器自动化在 credit.linux.do 会话中获取积分数据（基准值、余额、收支、交易记录等），并使用 `page.evaluate()` 绕过 Cloudflare 保护。支持登录状态检测、每日统计和交易记录查询。提供 LDC 充值功能，调用站点 `/api/user/pay` 端点获取支付 URL 并在浏览器中打开支付页面。

### CLI 配置数据存储

CLI 相关数据的存储位置设计：

| 数据类型 | 存储位置 | 说明 |
|---------|---------|------|
| **CLI 配置** | `site.cli_config` 或 `site.cached_data.cli_config` | 用户配置的 API Key、模型选择和启用状态，优先从站点根级别读取 |
| **CLI 兼容性结果** | `site.cached_data.cli_compatibility` 或 `site.cli_compatibility` | 测试结果缓存，包含 codexDetail 和 geminiDetail 详细信息，优先从 cached_data 读取 |
| **自定义 CLI 配置** | `${userData}/custom-cli-configs.json` | 自定义 Base URL + Key 的独立配置，包含模型缓存与启用状态 |

**CLI 配置项结构**：
```typescript
interface CliConfigItem {
  apiKeyId: number | null;  // 选择的 API Key ID
  model: string | null;     // CLI 使用模型
  testModel?: string | null; // 测试使用模型
  enabled: boolean;         // 是否启用（控制图标显示和测试）
}
```

**默认启用状态**：
- Claude Code: 默认启用
- Codex: 默认启用
- Gemini CLI: 默认启用

**兼容性处理**：
- `useDataLoader` 在加载时会同时检查两个位置，确保兼容旧版本数据结构
- CLI 配置优先从 `site.cli_config` 读取，兼容从 `site.cached_data.cli_config` 读取
- CLI 兼容性结果优先从 `site.cached_data.cli_compatibility` 读取，兼容从 `site.cli_compatibility` 读取
- `enabled` 字段可选，旧数据会使用默认值

### HTTP 客户端架构

为解决 Electron 打包后 BoringSSL 与某些服务器 TLS 握手失败的问题，项目实现了统一的 HTTP 客户端层：

```
src/main/utils/
├── electron-fetch.ts   # Electron net 模块封装
└── http-client.ts      # 统一 HTTP 客户端（自动切换）
```

**设计原理**：
- **开发环境**：Node.js 使用 OpenSSL，支持广泛的加密套件
- **打包环境**：Electron 使用 BoringSSL（Chrome 的 SSL 库），支持的加密套件更少
- **解决方案**：打包环境自动使用 Electron `net` 模块（Chromium 网络栈），与浏览器行为一致

**使用方式**：
```typescript
import { httpGet, httpPost, httpRequest } from './utils/http-client';

// 自动根据环境选择底层实现
const response = await httpGet(url, { headers, timeout });
```

### 认证与安全

**认证策略**：
1. **浏览器捕获**：首次添加站点时，通过 Puppeteer 启动浏览器，用户登录后自动捕获 `access_token` 和 `user_id`。
2. **持久化存储**：认证信息加密（目前为明文，计划升级）存储在本地配置文件中。
3. **静默刷新**：后续 API 请求直接使用保存的 Token，无需再次启动浏览器。
4. **Session 保持**：自动检测 Session 过期，必要时提示用户重新登录。

**认证错误处理**：

系统能够智能区分三种不同类型的认证问题，并提供精确的诊断信息：

| 错误类型 | 诊断标识 | 典型场景 | 解决方案 |
|---------|---------|---------|---------|
| **⏰ 会话过期** | 返回成功但无数据 | Access Token 有效，但服务端 Session 已失效 | 重新登录站点 |
| **🔑 Token 失效** | 返回 401 状态码 | Access Token 已过期或被撤销 | 重新获取 Token |
| **🚫 权限不足** | 返回 403 状态码 | 账户权限不足或已被禁用 | 检查账户状态 |

**关键技术细节**：
- 某些站点在 Session 过期时不返回标准的 401/403 状态码，而是返回 `{ success: true }` 但不包含 `data` 字段。系统会检测这种"空成功响应"模式并正确识别为会话过期。
- 当检测到会话过期时，系统会立即停止尝试其他 API 端点，避免不必要的请求。
- 认证错误对话框会根据错误类型提供精确的诊断和解决建议。

**Cloudflare 绕过**：
- 检测到 Cloudflare 拦截页面时，自动启动浏览器模式。
- 内置等待机制，直到 Cloudflare 验证通过后再提取数据。

---

## 关键工作流

### 应用启动流程

1. **Electron 启动**：加载 `main.ts`。
2. **配置加载**：`UnifiedConfigManager` 读取本地 `config.json`。
3. **主题应用**：读取主题配置，设置窗口背景色（避免白屏）。
4. **窗口创建**：创建主窗口，加载 React 应用。
5. **UI 初始化**：渲染进程通过 IPC 获取配置和缓存数据，恢复上次的界面状态。

### 站点检测流程

1. **触发检测**：用户点击刷新或自动定时触发。
2. **请求调度**：`ApiService` 接收请求，检查是否存在待处理的重复请求。
3. **数据获取**：
   - 并发获取：余额、模型列表、API Keys。
   - 错误处理：处理 401/403 认证错误，识别 Cloudflare 拦截。
4. **结果处理**：格式化数据（如统一价格单位），计算统计指标（RPM/TPM）。
5. **缓存更新**：将结果写入内存缓存并持久化到磁盘。
6. **UI 更新**：通过 `upsertResult` 安全更新单个站点结果，支持多站点并发刷新。使用 `isDetecting`（布尔值）独立跟踪每个站点的刷新 spinner 状态。

### 自动刷新流程

1. **定时器管理**：`useAutoRefresh` hook 为每个启用自动刷新的站点创建独立定时器。
2. **配置监听**：监听站点配置变化，自动创建/删除/重启定时器。
3. **并发执行**：多个站点的定时器独立运行，互不干扰。
4. **结果更新**：使用 `upsertResult` 确保并发刷新时结果不会互相覆盖。
5. **资源清理**：组件卸载时自动清理所有定时器。

### 浏览器自动化流程

1. **启动请求**：需要登录或绕过 Cloudflare 时触发。
2. **环境检查**：检查是否已有运行中的 Chrome 实例。
3. **实例管理**：
   - 若无实例：启动新浏览器，连接调试端口。
   - 若有实例：复用连接，创建新 Page。
4. **任务执行**：导航到目标 URL，注入脚本读取数据，或等待页面跳转。
5. **资源释放**：任务完成后关闭 Page；若无其他任务，延迟关闭浏览器实例以节省资源。

### 浏览器模式优化

**共享页面复用**：
- 当站点刷新进入浏览器模式后，后续所有 API 端点请求直接在浏览器上下文中执行，避免每个端点都先尝试 axios 再回退到浏览器的额外延迟。
- 通过 `sharedPage` 参数在 `fetchWithBrowserFallback` 方法间传递，实现页面复用。

**并发稳定性**：
- 使用 `page-exec-queue.ts` 对同一 Puppeteer Page 的 `page.evaluate` 调用进行队列串行化。
- 采用 WeakMap 按 Page 对象分组，FIFO 顺序执行任务。
- 有效降低并发检测时偶发的 "Execution context destroyed" 或 "Target closed" 错误。
- `cleanupOldPages` 在 `browserRefCount > 1` 时跳过清理，避免关闭并发任务正在使用的页面（v2.1.22+）。
- `fetchWithBrowserFallback` 在 `sharedPage` 被关闭时自动检测异常并重试创建新页面（v2.1.22+）。

**POST 请求浏览器回退**：
- POST 请求（如 `/api/user/amount` 获取 LDC 兑换比例）在遇到 401/403 时自动回退到浏览器模式。
- 浏览器模式下携带站点 Cookie 和会话信息，解决需要认证的 POST 端点问题。
