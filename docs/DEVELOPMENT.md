# API Hub Management Tools - 开发指南

## 环境准备

开发本项目前，请确认本地环境满足：

- Node.js `^20.19.0`、`^22.12.0` 或 `>=24.0.0`（与测试依赖的运行要求一致）
- npm
- 开发启动会准备固定版本的内置 Chromium，首次缺失时需要联网下载
- Windows、macOS 或 Linux 任一桌面系统

说明：

- 使用 `npm ci` 安装锁定依赖；开发与打包使用同一 Electron 版本。
- 浏览器路径的显式配置优先级保持一致：环境变量、配置文件、内置 Chromium、本机浏览器。

---

## 快速开始

```bash
git clone https://github.com/Sponge-Lu/API_detect_tools.git
cd API_detect_tools
npm ci
npm run dev
```

`npm run dev` 会执行：

1. `scripts/dev-cleanup.cjs` 清理开发进程。
2. `scripts/dev.cjs` 并行启动 Vite 与 `scripts/dev-main.cjs`。
3. `dev-main.cjs` 校验固定版本的 Chromium、编译主进程，等待 Vite 就绪后将准确地址传给 Electron。

其中 `dev.cjs` 会并行拉起主进程与 Vite 渲染进程，并为日志添加前缀。

主进程与 preload 修改后需要重启开发命令；渲染进程继续使用 Vite 热更新。
开发与打包均使用 Electron 网络栈，配置仍通过 `app.getPath('userData')` 加载。

---

## 常用脚本

### 开发

```bash
npm run dev            # 清理后同时启动主进程与渲染进程
npm run dev:main       # 仅启动 Electron 主进程
npm run dev:renderer   # 仅启动 Vite
npm run preview        # 构建页面并启动 Electron，使用与打包版一致的本地页面
```

### 构建

```bash
npm run build          # 构建全部
npm run build:main     # 构建主进程
npm run build:renderer # 构建渲染进程
```

### 打包

```bash
npm run dist           # 等价于 Windows 打包
npm run dist:win
npm run dist:mac
npm run dist:linux
```

打包后校验产物与当前构建一致，并启动内置浏览器执行页面检查：

```powershell
npm run verify:packaged -- release/win-unpacked/resources win32 x64
```

macOS 传入 `.app/Contents/Resources` 和 `darwin`，Linux 传入 `release/linux-unpacked/resources` 和 `linux`；最后一个参数为目标架构。跨架构时只校验资源，原生架构额外执行浏览器启动检查。CI 在上传产物前执行同一校验。

### 质量检查

```bash
npm run lint
npm run lint:fix
npm run format
npm run test
npm run test:watch
npm run test:coverage
npm run test:artifacts
```

`test:artifacts` 验证打包冒烟测试产物的保留规则。产品与驱动测试分别保留最新成功和失败产物，仅清理更早的已标记产物；未标记或无法识别的目录不自动删除。

---

## 当前代码组织

### 主进程

- `src/main/handlers/`：IPC handlers
- `src/main/route-*.ts`：Route 工作台对应的服务模块
- `src/main/unified-config-manager.ts`：v3 配置模型核心
- `src/main/chrome-manager.ts`：浏览器池与独立登录浏览器

### 渲染进程

- `src/renderer/components/`：UI 原语、对话框、工作台组件
- `src/renderer/pages/`：一级页面容器，包括数据总览、站点管理、本地路由、路由模型（会话路由卡片 + 模型映射合并）、路由日志、设置
- `src/renderer/store/`：`configStore`、`customCliConfigStore`、`detectionStore`、`routeStore`、`toastStore`、`uiStore`

### 共享层

- `src/shared/types/site.ts`
- `src/shared/types/route-proxy.ts`
- `src/shared/theme/themePresets.ts`

---

## 开发规范

### 代码风格

- 全部新代码使用 TypeScript
- 2 空格缩进
- 单引号
- 分号
- React 组件使用 PascalCase
- 变量与函数使用 camelCase

### 工具链

- ESLint：静态检查
- Prettier：格式化
- Vitest：测试

### 提交规范

推荐沿用 Conventional Commits：

- `feat:`
- `fix:`
- `docs:`
- `refactor:`
- `test:`
- `chore:`

版本发布提交通常会使用 `vX.Y.Z:` 前缀，并同步 `package.json.version` 与 `build.buildVersion`。

---

## 测试说明

### 基础命令

```bash
npm run test
npm run test:watch
npm run test:coverage
```

### 测试范围

- 单元测试：工具函数、服务层、store
- 组件测试：工作台 UI、对话框、页面结构
- 属性测试：设计系统、布局、交互和稳定性

### 设计系统相关测试

当前设计系统测试覆盖的是 **四套中性主题**（`Light` / `Dark` / `Modern` / `Modern Dark`）与 `App*` 原语体系，而不是旧的多套实验主题/iOS 原语体系。

代表性测试包括：

- `app-button.property.test.tsx`
- `app-modal.property.test.tsx`
- `app-icon-compatibility.property.test.tsx`
- `data-table-compatibility.property.test.tsx`
- `theme-token-contract.property.test.tsx`
- `design-system-accessibility.property.test.tsx`
- `ui-functional-preservation.property.test.tsx`

### Route 与工作台相关测试

当前主线还包含针对 v3 工作台的回归测试，例如：

- `endpoint-test-service.test.ts`
- `endpoint-test-panel.test.tsx`
- `route-proxy-service.test.ts`
- `route-upstream-forwarder.socket.test.ts`（真实 socket：SSE 分帧透传与中途断连）
- `route-model-registry-service.test.ts`
- `route-stats-service.test.ts`
- `route-upstream-failure.test.ts`
- `route-session-binding-service.test.ts` / `route-state-affinity-service.test.ts`
- `dsh-integration-service.test.ts` / `dsh-integration-banner.test.tsx`
- `data-overview-page.test.tsx`
- `route-workbench-redesign.test.tsx`
- `sites-page-redesign.test.tsx`
- `logs-page.test.tsx`
- `unified-cli-config-dialog.test.tsx`
- `custom-cli-config-editor-dialog.test.tsx`
- `custom-cli-config-service.test.ts`

当前 Route / CLI 相关测试重点覆盖：

- 三种端点的协议头/请求体、生成文本校验与无 CLI 特征请求
- 路由层 target lock 的 loopback 限制与单测试目标尝试预算；端点测试直连托管/直连目标并覆盖鉴权、路径和凭证解析
- 成功、HTTP 失败、解析失败和超时的 `testedAt` 持久化与 UI 展示
- 数据总览路由趋势图在 `24h` / `7d` 部分数据窗口下仍补齐完整 X 轴，并且前置空桶不绘制请求柱或趋势线
- 日志页的会话事件筛选、路由日志逐条 push 追加、紧凑请求尝试列表、Token/cache token 与参考金额展示

---

## 打包说明

打包由 `electron-builder` 负责，产物默认写入 `release/`：

- Windows：安装版与便携版
- macOS：`dmg`、`zip`
- Linux：`AppImage`、`deb`

注意：

- `npm run dist` 当前等价于 `npm run dist:win`
- macOS 打包通常需要在 macOS 环境下完成

---

## 贡献流程

1. 新建分支，例如 `feature/xxx` 或 `fix/xxx`
2. 编写代码与测试
3. 运行 `npm run lint` 与 `npm run test`
4. 提交变更
5. 发起 Pull Request

如改动涉及模块增删或结构调整，请同步更新：

- `PROJECT_INDEX.md`
- 对应目录下的 `FOLDER_INDEX.md`
- 必要的用户/架构/开发文档

---

## 常见问题

### Electron 安装失败

可尝试切换镜像后重新安装：

```bash
npm config set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

### 启动后白屏

优先检查：

- `dev:renderer` 是否已成功启动
- TypeScript 是否编译通过
- Electron preload / IPC 是否有报错

### 本地浏览器未探测到

可以通过以下方式指定浏览器：

- 环境变量：`CHROME_PATH` 或 `BROWSER_PATH`
- 应用配置：`settings.browser_path`

## SQLite 开发与回归（2026-10-24）

首次 Windows 安装后运行 npm run prepare:sqlite；build/dev 自动验证当前 Electron ABI，并构建 sandbox 可加载的单文件 preload。不要用宿主 Node 直接 require Electron ABI 的 better-sqlite3。

验证：npm test；npm run test:storage；npm run lint；npm run build；npm run verify:storage:product。最后一项实际打包并启动隔离 ASAR 产品，使用项目 .cache 内假 home/userData/CLI 文件和本地假上游；不改真实用户数据。schema SQL 只能追加新编号，不修改已应用迁移。详见 STORAGE_SCHEMA.md 和 STORAGE_OPERATIONS.md。
