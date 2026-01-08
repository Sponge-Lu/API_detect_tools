# API Hub Management Tools - 开发指南

## 📖 目录

- [环境准备](#环境准备)
- [快速开始](#快速开始)
- [开发规范](#开发规范)
  - [代码风格](#代码风格)
  - [Git 提交规范](#git-提交规范)
  - [分支管理](#分支管理)
- [构建与打包](#构建与打包)
- [测试指南](#测试指南)
- [贡献流程](#贡献流程)

---

## 环境准备

在开始开发之前，请确保您的开发环境满足以下要求：

- **操作系统**: Windows 10/11, macOS, Linux
- **Node.js**: v18.x 或更高版本
- **包管理器**: npm (推荐 v9+) 或 pnpm
- **浏览器**: Google Chrome (开发调试必需)

---

## 快速开始

1. **克隆仓库**

   ```bash
   git clone https://github.com/Sponge-Lu/API_detect_tools.git
   cd API_detect_tools
   ```

2. **安装依赖**

   ```bash
   npm install
   # 或
   pnpm install
   ```

3. **启动开发环境**

   ```bash
   npm run dev
   ```

   此命令将同时启动 Vite 开发服务器 (渲染进程) 和 Electron (主进程)。

---

## 开发规范

### 代码风格

本项目使用 **ESLint** + **Prettier** 强制统一代码风格。

- **Lint 检查**: `npm run lint`
- **格式化**: `npm run format`

**核心规则**:
- 使用 TypeScript 编写所有新代码。
- 缩进使用 2 个空格。
- 使用分号。
- 组件命名使用 PascalCase (如 `SiteCard.tsx`)。
- 变量和函数命名使用 camelCase (如 `fetchData`)。

### Git 提交规范

请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

- `feat`: 新功能
- `fix`: 修复 Bug
- `docs`: 文档变更
- `style`: 代码格式调整 (不影响逻辑)
- `refactor`: 代码重构 (无新功能或 Bug 修复)
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建过程或辅助工具变更

**示例**:
```
feat: add dark mode support
fix: resolve crash when closing browser
docs: update architecture documentation
```

### 分支管理

- `main`: 主分支，保持随时可发布状态。
- `develop`: 开发分支，包含最新特性。
- `feature/*`: 功能分支，从 develop 分出，完成后合并回 develop。
- `fix/*`: 修复分支。

---

## 构建与打包

本项目使用 **electron-builder** 进行多平台打包，支持 Windows、macOS、Linux。

### 本地构建

**Windows**:
```bash
npm run dist:win
```
产物：`release/` 目录
- `API Hub Management Tools Setup x.x.x.exe` - 安装版
- `API Hub Management Tools-x.x.x-portable.exe` - 便携版

**macOS**:
```bash
npm run dist:mac
```
产物：`release/` 目录
- `API Hub Management Tools-x.x.x.dmg` - 安装包
- `API Hub Management Tools-x.x.x-mac.zip` - 压缩包

**Linux**:
```bash
npm run dist:linux
```
产物：`release/` 目录
- `API Hub Management Tools-x.x.x.AppImage` - 通用格式
- `API Hub Management Tools-x.x.x.deb` - Debian/Ubuntu

### 自动化构建（GitHub Actions）

项目配置了 GitHub Actions 工作流，可自动构建多平台安装包。

**触发方式**：

1. **推送 tag 自动发布**：
   ```bash
   git tag v2.1.11
   git push origin v2.1.11
   ```
   推送 tag 后会自动在 Windows、macOS、Linux 三个平台构建，并创建 GitHub Release。

2. **手动触发**：
   - 进入 GitHub 仓库的 Actions 页面
   - 选择 "Build and Release" 工作流
   - 点击 "Run workflow"

**构建产物**：
- 所有平台的安装包会自动上传到 GitHub Release
- 可在 Actions 页面下载构建产物（Artifacts）

### 图标文件

打包需要在 `build/` 目录准备图标文件：
- `icon.png` - 1024x1024 PNG 图标（通用，electron-builder 会自动转换）
- `icon.ico` - Windows 图标（可选，优先使用）

**注意**：
- macOS 打包只能在 macOS 系统上进行（需要代码签名）
- 推荐使用 GitHub Actions 进行跨平台构建

---

## 测试指南

本项目使用 **Vitest** 进行单元测试。

**运行所有测试**:
```bash
npm run test
```

**运行特定测试文件**:
```bash
npm run test src/__tests__/example.test.ts
```

**编写测试**:
测试文件位于 `src/__tests__/` 目录。建议为核心业务逻辑 (如 Hooks, Utils) 编写测试用例。

**属性测试 (Property-Based Testing)**:
本项目使用 fast-check 进行属性测试，验证代码在各种输入下的正确性。属性测试文件以 `.property.test.ts` 结尾。

```bash
# 运行所有属性测试
npm run test src/__tests__/*.property.test.ts
```

---

## 贡献流程

1. Fork 本仓库。
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)。
3. 提交更改 (`git commit -m 'feat: Add some AmazingFeature'`)。
4. 推送到分支 (`git push origin feature/AmazingFeature`)。
5. 提交 Pull Request。

---

## 常见问题

### 开发时遇到 "Electron failed to install"？
尝试设置镜像源或使用代理：
```bash
npm config set ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

### 启动后白屏？
检查控制台报错。通常是因为 Vite 服务器未完全启动 Electron 就加载了页面，或者 TypeScript 编译错误。

### 依赖安装慢？
推荐使用淘宝镜像源或 `pnpm`。