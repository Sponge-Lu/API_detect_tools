# API Hub Management Tools - 开发指南

## 环境准备

开发本项目前，请确认本地环境满足：

- Node.js `>= 18`
- npm
- 可用的 Chromium 浏览器，优先推荐 Google Chrome
- Windows、macOS 或 Linux 任一桌面系统

说明：

- 仓库当前使用 `package-lock.json`，默认以 `npm` 为主。
- 浏览器路径可通过环境变量或配置文件指定，开发阶段默认会自动探测。

---

## 快速开始

```bash
git clone https://github.com/Sponge-Lu/API_detect_tools.git
cd API_detect_tools
npm install
npm run dev
```

`npm run dev` 会执行：

1. `scripts/dev-cleanup.cjs`
2. `scripts/dev-main.cjs`
3. `scripts/dev.cjs`

其中 `dev.cjs` 会并行拉起主进程与 Vite 渲染进程，并为日志添加前缀。

---

## 常用脚本

### 开发

```bash
npm run dev            # 清理后同时启动主进程与渲染进程
npm run dev:main       # 仅启动 Electron 主进程
npm run dev:renderer   # 仅启动 Vite
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

### 质量检查

```bash
npm run lint
npm run lint:fix
npm run format
npm run test
npm run test:watch
npm run test:coverage
```

---

## 当前代码组织

### 主进程

- `src/main/handlers/`：IPC handlers
- `src/main/route-*.ts`：Route 工作台对应的服务模块
- `src/main/unified-config-manager.ts`：v3 配置模型核心
- `src/main/chrome-manager.ts`：浏览器池与独立登录浏览器

### 渲染进程

- `src/renderer/components/`：UI 原语、对话框、工作台组件
- `src/renderer/pages/`：一级页面与 Route 工作台页面
- `src/renderer/store/`：`configStore`、`detectionStore`、`uiStore`、`routeStore`

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

当前设计系统测试覆盖的是 **双主题** 与 `App*` 原语体系，而不是旧的多主题/iOS 原语体系。

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

- `route-cli-probe-service.test.ts`
- `route-workbench-redesign.test.tsx`
- `sites-page-redesign.test.tsx`
- `custom-cli-page-redesign.test.tsx`

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
