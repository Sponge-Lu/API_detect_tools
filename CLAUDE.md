# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

API Hub Management Tools — Electron 桌面客户端，用于管理和监控多个 API 中转站（One API / New API / Veloera / Done Hub 等）。核心功能包括自动认证、实时监控余额/消耗/RPM、CLI 兼容性测试、API Key 管理、WebDAV 云备份、Linux Do Credit 积分查询与 LDC 充值。

## Tech Stack

- **Main Process**: Electron 28 + TypeScript (CommonJS, tsconfig.main.json)
- **Renderer Process**: React 18 + TypeScript + Tailwind CSS + Vite 5
- **State Management**: Zustand
- **Validation**: Zod
- **Browser Automation**: puppeteer-core
- **Build**: electron-builder (NSIS/portable/DMG/AppImage)
- **Test**: Vitest + React Testing Library + fast-check (property testing)
- **Lint**: ESLint 9 flat config + Prettier + Husky pre-commit (lint-staged)

## Commands

```bash
npm run dev              # 并行启动 main + renderer 开发模式
npm run dev:main         # 仅编译并启动主进程 (tsc + electron .)
npm run dev:renderer     # 仅启动 Vite dev server (port 5173)
npm run build            # 构建 main (tsc) + renderer (vite build)
npm run dist:win         # 构建 + 打包 Windows (NSIS + portable)
npm run dist:mac         # 构建 + 打包 macOS (DMG + ZIP)
npm run dist:linux       # 构建 + 打包 Linux (AppImage + deb)
npm run test             # vitest run (单次)
npm run test:watch       # vitest watch 模式
npm run test:coverage    # vitest + v8 覆盖率
npm run lint             # eslint src --ext .ts,.tsx
npm run lint:fix         # eslint --fix
npm run format           # prettier --write src
```

运行单个测试文件: `npx vitest run src/__tests__/example.test.ts`

## Architecture

双进程 Electron 架构，通过 IPC (ipcRenderer.invoke / ipcMain.handle) 通信:

```
src/
├── main/                  # Electron 主进程 (Node.js 环境, CommonJS)
│   ├── main.ts            # 入口: 窗口创建、服务初始化、生命周期
│   ├── preload.ts         # contextBridge 暴露 electronAPI 给渲染进程
│   ├── handlers/          # IPC handler 按领域拆分 (detection, token, backup, credit, cli-compat, update, webdav, account, browser-profile, custom-cli-config, theme, close-behavior, unified-config)
│   ├── chrome-manager.ts  # 多槽位浏览器池 (slot 0=主, slot N=隔离)
│   ├── browser-profile-manager.ts  # Chrome Profile 管理 (主/隔离)
│   ├── token-service.ts   # Token 获取/刷新/签到
│   ├── api-service.ts     # HTTP 请求、余额检测、LDC 支付探测
│   ├── cli-compat-service.ts  # CLI 协议级兼容性流式探测 (请求格式与真实 CLI 对齐)
│   ├── cli-wrapper-compat-service.ts  # 真实 CLI wrapper 测试 (隔离临时 HOME/CODEX_HOME/GEMINI_CLI_HOME)
│   ├── credit-service.ts  # Linux Do Credit 积分/充值
│   ├── update-service.ts  # 应用内更新检测/下载/安装
│   ├── unified-config-manager.ts  # 配置持久化与迁移
│   ├── backup-manager.ts  # 本地备份
│   └── webdav-manager.ts  # WebDAV 云端备份
├── renderer/              # React 前端 (ESM, Vite 构建)
│   ├── App.tsx            # 根组件
│   ├── components/        # UI 组件（当前统一使用 AppButton/AppCard/AppInput/AppModal/DataTable/AppIcon 等中性原语）
│   ├── hooks/             # 业务逻辑 hooks (useSiteGroups, useAutoRefresh, useCliCompatTest, useCredit, useUpdate 等)
│   ├── store/             # Zustand stores (configStore, detectionStore, uiStore, toastStore, customCliConfigStore)
│   ├── services/          # 前端服务层 (cli-config-generator)
│   └── pages/             # 页面组件
└── shared/                # 主进程与渲染进程共享
    ├── types/             # TypeScript 类型 (site, cli-config, config-detection, credit, custom-cli-config)
    ├── schemas/           # Zod 验证规则
    ├── constants/         # 常量
    └── utils/             # 共享工具函数
```

### Key Patterns

- **IPC 通信**: 渲染进程通过 `window.electronAPI.xxx()` 调用，preload.ts 桥接到主进程 handler。新增 IPC 接口需同步修改 preload.ts + 对应 handler 文件 + handlers/index.ts 注册。
- **服务层依赖链**: TokenService → ChromeManager, ApiService → TokenService, CliCompatService → ApiService, CliWrapperCompatService → child_process/fs/os/path, CreditService → ChromeManager。
- **CLI 兼容性测试链路**: 渲染进程统一通过 `window.electronAPI.cliCompat.testWithWrapper()` 调用主进程真实 wrapper 测试入口；该流程使用临时目录，不写入用户真实 CLI 配置目录。
- **状态管理**: Zustand store 拆分为 config (站点配置)、detection (检测结果)、ui (UI 状态)、toast (通知)、customCliConfig (CLI 配置)。
- **UI 组件**: 基于当前产品级中性设计系统的自定义组件库，统一使用 `App*` / `DataTable` 等公共原语入口。
- **测试**: 大量使用 fast-check 属性测试 (`*.property.test.ts`)，测试文件位于 `src/__tests__/`，setup 文件 `src/__tests__/setup.ts`。
- **配置文件路径**: Electron `app.getPath('userData')` 存储配置、Token、主题设置等。

### Build Outputs

- `dist/` — 主进程 TypeScript 编译输出 (tsc)
- `dist-renderer/` — 渲染进程 Vite 构建输出
- `release/` — electron-builder 打包产物

## Conventions

- 后端代码更改后须同步前端相应更改
- 代码风格: 精简高效、无冗余；注释/文档遵循"非必要不形成"
- 仅对需求做针对性改动，严禁影响现有功能
- Prettier: 单引号、2 空格缩进、尾逗号 es5、printWidth 100、箭头函数省略括号
- ESLint: `@typescript-eslint/no-explicit-any` warn, unused vars 以 `_` 前缀忽略
- Pre-commit hook: lint-staged (eslint --fix + prettier --write)
- 修改代码后更新分形索引系统: PROJECT_INDEX.md (根索引) + FOLDER_INDEX.md (文件夹索引) + 文件头注释 (Input/Output/Pos)
