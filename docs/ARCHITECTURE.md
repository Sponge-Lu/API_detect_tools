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
│   │   └── index.ts               # 统一注册入口
│   ├── utils/                     # 后端工具
│   ├── types/                     # 后端类型定义
│   ├── api-service.ts             # API 请求服务 (核心业务)
│   ├── token-service.ts           # 令牌管理服务
│   ├── chrome-manager.ts          # 浏览器自动化管理
│   ├── unified-config-manager.ts  # 统一配置管理 (config.json)
│   ├── backup-manager.ts          # 备份管理
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

### 状态管理 (Zustand)

为了避免 React Context 的性能问题和 Prop Drilling，项目采用 Zustand 进行状态管理，拆分为多个独立的 Store：

- **configStore**: 管理全局配置、站点列表、分组信息。
- **detectionStore**: 管理站点检测结果、加载状态。
- **uiStore**: 管理 UI 状态（如侧边栏折叠、拖拽状态）。
- **toastStore**: 管理全局通知消息。

### IPC 通信架构

主进程中的 IPC 处理器被拆分为多个独立的模块 (Handlers)，在 `main/handlers/index.ts` 中统一注册。

**通信模式**：
1. **渲染进程** 调用 `window.electronAPI.xxx()` (通过 `preload.ts` 暴露)。
2. **IPC 通道** 触发主进程对应的 `handle` 函数。
3. **主进程** 执行业务逻辑 (调用 Service 层)。
4. **结果返回** 给渲染进程 (Promise)。

### 后端服务层

主进程的业务逻辑封装在几个核心 Service 类中，实现关注点分离：

- **ApiService**: 处理所有 HTTP 请求，负责站点余额、模型列表、API Key 的获取。内置请求去重和缓存机制。
- **TokenService**: 负责处理 API Key 的创建、删除、权限验证，以及适配不同站点的 Token 协议。
- **ChromeManager**: 管理 Puppeteer 实例的生命周期。负责启动浏览器、管理页面、注入脚本、提取 LocalStorage/Cookie 信息。支持浏览器复用和崩溃自动重启。
- **UnifiedConfigManager**: 负责 `config.json` 的读写，保证配置数据的原子性和一致性。

### 认证与安全

**认证策略**：
1. **浏览器捕获**：首次添加站点时，通过 Puppeteer 启动浏览器，用户登录后自动捕获 `access_token` 和 `user_id`。
2. **持久化存储**：认证信息加密（目前为明文，计划升级）存储在本地配置文件中。
3. **静默刷新**：后续 API 请求直接使用保存的 Token，无需再次启动浏览器。
4. **Session 保持**：自动检测 Session 过期，必要时提示用户重新登录。

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
6. **UI 更新**：通过 IPC 推送最新数据到渲染进程。

### 浏览器自动化流程

1. **启动请求**：需要登录或绕过 Cloudflare 时触发。
2. **环境检查**：检查是否已有运行中的 Chrome 实例。
3. **实例管理**：
   - 若无实例：启动新浏览器，连接调试端口。
   - 若有实例：复用连接，创建新 Page。
4. **任务执行**：导航到目标 URL，注入脚本读取数据，或等待页面跳转。
5. **资源释放**：任务完成后关闭 Page；若无其他任务，延迟关闭浏览器实例以节省资源。