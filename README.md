# API公益站检测工具

> 现代化桌面应用，自动检测公益站可用模型和账户余额

基于 **Tauri + React + Rust** 构建的高性能桌面应用，提供精美的UI界面和极低的资源占用。

[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-blue?style=flat-square)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square)](https://react.dev/)
[![Rust](https://img.shields.io/badge/Rust-Latest-orange?style=flat-square)](https://www.rust-lang.org/)

---

## ✨ 特性亮点

- 🎨 **现代UI设计** - 渐变背景、毛玻璃效果、流畅动画
- ⚡ **极致性能** - Rust后端，运行时内存仅~40MB
- 📦 **轻量打包** - 打包体积约8MB，远小于Electron（~100MB）
- 🔒 **安全可靠** - Tauri安全架构，系统级权限控制
- 🚀 **快速响应** - 并发检测，毫秒级界面响应
- 💾 **智能配置** - 自动保存到系统目录，支持导入导出

---

## 📦 快速开始

### 前置要求

| 软件 | 版本要求 | 下载链接 |
|------|----------|----------|
| Node.js | 16+ | [nodejs.org](https://nodejs.org/) |
| Rust | 最新稳定版 | [rustup.rs](https://rustup.rs/) |
| MSVC (Windows) | VS Build Tools | [下载链接](#windows安装) |

### 三步运行

```bash
# 1️⃣ 初始化环境（首次运行）
setup.bat

# 2️⃣ 启动开发模式
npm run tauri:dev

# 3️⃣ 打包发布（可选）
build-tauri.bat
```

---

## 🚀 详细安装指南

### Windows安装

#### 步骤1: 安装Node.js
1. 访问 [nodejs.org](https://nodejs.org/)
2. 下载LTS版本（推荐）
3. 运行安装程序，勾选"自动安装必要工具"
4. 验证安装：
   ```bash
   node --version
   npm --version
   ```

#### 步骤2: 安装Rust
1. 访问 [rustup.rs](https://rustup.rs/)
2. 下载并运行 `rustup-init.exe`
3. 选择默认安装（选项1）
4. 验证安装：
   ```bash
   rustc --version
   cargo --version
   ```

#### 步骤3: 安装Visual Studio Build Tools

**⚠️ 这一步很重要！** Rust在Windows上需要MSVC编译工具。

**方式A: 下载Build Tools（推荐，约6GB）**

1. 下载链接：https://aka.ms/vs/17/release/vs_BuildTools.exe
2. 运行安装程序
3. **必须勾选**：
   - ☑️ "使用C++的桌面开发"
4. 展开右侧"安装详细信息"，确保包含：
   - ✅ MSVC v143 - VS 2022 C++ x64/x86生成工具
   - ✅ Windows 10 SDK 或 Windows 11 SDK
5. 点击"安装"，等待完成（需要20-40分钟）
6. **重启所有终端和编辑器**

**方式B: 安装Visual Studio Community（完整IDE，约10-20GB）**

适合需要完整开发环境的用户。

#### 步骤4: 初始化项目

```bash
cd API_detect_tools
setup.bat
```

#### 步骤5: 运行应用

```bash
npm run tauri:dev
```

**首次运行说明：**
- 首次编译Rust代码需要5-10分钟（正常现象）
- 后续启动只需<1分钟
- 编译完成后应用窗口会自动打开

---

### Linux安装

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.0-dev \
  build-essential \
  curl \
  wget \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev

# 安装Node.js (使用nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install --lts

# 安装Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# 初始化项目
npm install
npm run tauri:dev
```

---

### macOS安装

```bash
# 安装Homebrew（如果没有）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装依赖
brew install node rust

# 初始化项目
npm install
npm run tauri:dev
```

---

## 🎯 核心功能

### 站点管理
- ✅ **添加站点** - 通过图形界面快速添加
- ✅ **编辑站点** - 修改URL、密钥等信息
- ✅ **删除站点** - 一键删除不需要的站点
- ✅ **启用/禁用** - 临时禁用站点而不删除配置
- ✅ **批量管理** - 支持多站点同时管理
- 🎯 **签到提醒** - 标记支持签到功能的站点

### 认证方式
- 🔑 **API Key模式** - 查询模型列表和令牌额度
- 🔐 **User Token模式** - 使用用户令牌查询信息
- 💡 **自动降级** - Token失败时自动使用API Key

### 检测功能
- 🚀 **并发检测** - 同时检测多个站点，速度快
- 📊 **实时结果** - 检测进度实时显示
- 📋 **模型列表** - 展示所有可用模型（支持重试机制）
- 💰 **余额查询** - 显示账户余额信息
  - ✅ 支持 One API、New API、Veloera API
  - ✅ 智能识别无限配额（显示 ∞）
  - ⚠️ API未开放时提示"需登录网页查看"
- ⚙️ **自定义超时** - 可配置请求超时时间
- 🔄 **自动重试** - 网络错误自动重试（指数退避）

### 全局设置
- ⏱️ **超时配置** - 1-60秒可调
- 🔄 **并发开关** - 串行/并发模式切换
- 👁️ **显示控制** - 选择是否显示禁用的站点

### 界面特性
- 🎨 **统一宽度** - 所有站点名称宽度一致，界面整齐
- 💜 **无限配额显示** - 特殊标识 "∞ 无限"
- 💛 **权限提示** - 余额无法获取时友好提示
- 🔍 **完整信息** - 悬停显示完整站点名称和提示信息

---

## 📝 配置说明

### 配置文件位置

应用运行后，配置会自动创建在系统标准目录：

```
Windows:  C:\Users\用户名\AppData\Roaming\com.api.detector\config.json
Linux:    ~/.config/com.api.detector/config.json
macOS:    ~/Library/Application Support/com.api.detector/config.json
```

### 配置格式

```json
{
  "sites": [
    {
      "name": "示例站点",
      "url": "https://api.example.com",
      "api_key": "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
      "system_token": "",
      "user_id": "",
      "enabled": true
    }
  ],
  "settings": {
    "timeout": 10,
    "concurrent": true,
    "show_disabled": false
  }
}
```

### 字段说明

#### 站点配置 (sites)

| 字段 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `name` | ✅ | 站点名称（自定义） | "OpenAI公益站" |
| `url` | ✅ | API基础URL | "https://api.example.com" |
| `api_key` | ✅ | API密钥 | "sk-xxxxx" |
| `system_token` | ❌ | 系统令牌（管理员） | "sat-xxxxx" |
| `user_id` | ❌ | 用户ID（配合system_token） | "123" |
| `enabled` | ✅ | 是否启用 | true/false |

#### 全局设置 (settings)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `timeout` | 数字 | 10 | 请求超时时间（秒） |
| `concurrent` | 布尔 | true | 是否并发检测 |
| `show_disabled` | 布尔 | false | 是否显示已禁用的站点 |

---

## 🛠️ 技术栈

### 前端技术
- **React 18** - 声明式UI框架
- **TypeScript** - 类型安全的JavaScript超集
- **Tailwind CSS** - 实用优先的CSS框架
- **Vite** - 下一代前端构建工具
- **Lucide Icons** - 精美的图标库

### 后端技术
- **Rust** - 内存安全的系统编程语言
- **Tauri 2.0** - 轻量级桌面应用框架
- **Reqwest** - 强大的HTTP客户端
- **Tokio** - 异步运行时
- **Serde** - 序列化/反序列化框架

---

## 📦 打包发布

### 开发模式（推荐开发时使用）

```bash
npm run tauri:dev
```

**特点：**
- ✅ 热重载 - 代码修改立即生效
- ✅ 快速启动 - 后续启动<1分钟
- ✅ 开发者工具 - 按F12打开DevTools
- ✅ 实时调试 - 查看日志和错误

### 生产打包

```bash
# Windows
build-tauri.bat

# 或手动执行
npm run build
npm run tauri:build
```

**输出位置：**
```
src-tauri/target/release/bundle/
├── nsis/          # Windows安装程序 (.exe)
├── msi/           # Windows MSI包 (.msi)
├── appimage/      # Linux AppImage (Linux)
└── macos/         # macOS应用包 (.app)
```

---

## 🔍 支持的API系统

### 兼容系统

| 系统 | 兼容性 | 余额查询 | 特殊说明 |
|------|--------|----------|----------|
| **New API** | ✅ 完全支持 | ✅ | 支持 `total_available`、`unlimited_quota` |
| **One API** | ✅ 完全支持 | ✅ | 支持 `data.user_info.quota` |
| **Veloera API** | ✅ 完全支持 | ✅ | 基于 New API，完全兼容 |
| **其他OpenAI兼容** | ✅ 基本支持 | ⚠️ | 部分站点可能限制余额API |

### 余额显示说明

| 显示内容 | 含义 | 说明 |
|---------|------|------|
| `$123.45` | 正常余额 | 成功获取实际可用余额 |
| `∞ 无限` | 无限配额 | 站点设置了无限额度 |
| `需登录网页查看` | API受限 | 站点未开放余额查询API给普通用户 |
| `--` | 未检测 | 尚未进行检测或检测失败 |

### 支持的余额格式

工具会自动识别以下响应格式：

```json
// One API 格式
{
  "data": {
    "user_info": {
      "quota": 500000  // 自动转换：÷ 500000 = $1.00
    }
  }
}

// New API 格式
{
  "data": {
    "total_available": 500000,  // 自动转换为美元
    "unlimited_quota": true     // 识别为无限配额
  }
}

// Veloera / 其他格式
{
  "data": {
    "quota": 10.5,           // 直接使用
    "balance": 20.0,         // 直接使用
    "remain_quota": 1000000  // 智能转换
  }
}
```

### API端点检测顺序

#### 模型列表
```
GET /v1/models
Authorization: Bearer {api_key}
```
- 支持自动重试（最多3次）
- 智能处理速率限制（429）

#### 余额查询（按优先级）

1. **用户信息端点**（最优先）
   ```
   GET /api/user/self
   Authorization: Bearer {api_key}
   new-api-user: {user_id}  (可选)
   Veloera-User: {user_id}  (可选)
   ```

2. **用户面板**
   ```
   GET /api/user/dashboard
   Authorization: Bearer {api_key}
   ```

3. **Token用量**（New API）
   ```
   GET /api/usage/token
   Authorization: Bearer {api_key}
   ```

4. **用户信息备用**
   ```
   GET /api/user/info
   Authorization: Bearer {api_key}
   ```

### 智能特性

- ✅ **自动单位转换** - 识别 token 数并转换为美元
- ✅ **无限配额识别** - 检测 `unlimited_quota: true`
- ✅ **降级策略** - User Token 失败自动降级到 API Key
- ✅ **多格式兼容** - 支持 10+ 种不同的余额字段格式
- ✅ **智能重试** - 网络错误自动重试，指数退避算法

---

## 📊 性能对比

### vs Electron

| 指标 | Tauri | Electron | 优势 |
|------|-------|----------|------|
| 运行时内存 | ~40MB | ~150MB | **75%↓** |
| 打包体积 | ~8MB | ~100MB | **92%↓** |
| 启动速度 | <1秒 | ~3秒 | **3倍快** |
| CPU占用 | 低 | 中 | 更省电 |

### vs Python Tkinter

| 指标 | Tauri | Python Tkinter | 优势 |
|------|-------|----------------|------|
| UI现代度 | ⭐⭐⭐⭐⭐ | ⭐⭐ | 更美观 |
| 响应速度 | 快 | 中 | 更流畅 |
| 跨平台 | 优秀 | 良好 | 更一致 |
| 打包体积 | ~8MB | ~15MB | **47%↓** |

---

## 🐛 常见问题

### Q1: 编译失败 - "找不到MSVC"

**现象：**
```
error: linker `link.exe` not found
```

**解决：**
1. 安装 Visual Studio Build Tools
2. 确保勾选"使用C++的桌面开发"
3. 重启所有终端和编辑器
4. 验证：`rustc --version` 应显示 `x86_64-pc-windows-msvc`

---

### Q2: 端口1420被占用

**现象：**
```
Error: Port 1420 is already in use
```

**解决：**
```bash
# 方法1: 关闭占用进程
taskkill /F /IM node.exe

# 方法2: 修改端口（编辑vite.config.ts）
server: {
  port: 1421,  // 改为其他端口
}
```

---

### Q3: 首次编译很慢

**说明：** 这是正常现象！

- **首次编译**：5-10分钟（需编译300+依赖）
- **后续编译**：<1分钟（仅编译修改部分）
- **建议**：首次编译时去喝杯咖啡☕

---

### Q4: 配置加载失败

**现象：** 应用打开显示"配置加载失败"

**解决：**
1. 检查配置文件路径（见上文"配置文件位置"）
2. 确保JSON格式正确
3. 查看终端错误信息
4. 删除配置文件，重启应用会自动创建默认配置

---

### Q5: Linux下缺少系统依赖

**现象：**
```
error: failed to run custom build command for `webkit2gtk-sys`
```

**解决：**
```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget libssl-dev libgtk-3-dev

# Fedora
sudo dnf install webkit2gtk4.0-devel openssl-devel gtk3-devel

# Arch
sudo pacman -S webkit2gtk gtk3
```

---

## 🎯 开发指南

### 项目结构

```
API_detect_tools/
├── src/                    # React前端源码
│   ├── components/         # UI组件
│   │   ├── SiteEditor.tsx      # 站点编辑对话框
│   │   ├── SettingsPanel.tsx   # 设置面板
│   │   └── DetectionResults.tsx# 检测结果展示
│   ├── App.tsx            # 主应用组件
│   ├── main.tsx           # 入口文件
│   └── index.css          # 全局样式
│
├── src-tauri/             # Rust后端源码
│   ├── src/
│   │   └── main.rs        # 核心逻辑（API检测、配置管理）
│   ├── icons/             # 应用图标
│   ├── Cargo.toml         # Rust依赖配置
│   └── tauri.conf.json    # Tauri应用配置
│
├── 配置文件
│   ├── package.json       # Node.js依赖
│   ├── vite.config.ts     # Vite构建配置
│   ├── tsconfig.json      # TypeScript配置
│   ├── tailwind.config.js # Tailwind CSS配置
│   └── postcss.config.js  # PostCSS配置
│
├── 脚本
│   ├── setup.bat          # Windows环境初始化
│   └── build-tauri.bat    # Windows打包脚本
│
└── 文档
    ├── README.md          # 本文档
    ├── config.example.json# 配置示例
    └── icon-source.svg    # 图标源文件
```

### 添加新功能

#### 1. 添加Rust命令

编辑 `src-tauri/src/main.rs`：

```rust
#[tauri::command]
async fn your_command(param: String) -> Result<String, String> {
    // 你的逻辑
    Ok("success".to_string())
}

// 注册命令
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_config,
            your_command,  // 添加这里
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 2. 前端调用

在React组件中：

```typescript
import { invoke } from "@tauri-apps/api/core";

const result = await invoke<string>("your_command", { 
  param: "value" 
});
```

### 调试技巧

#### 前端调试
```typescript
// 开发模式下按 F12 打开Chrome DevTools
console.log("Debug info:", data);
```

#### Rust调试
```rust
// 在终端查看输出
println!("Debug: {:?}", variable);
eprintln!("Error: {}", error);
```

---

## 📜 许可证

MIT License

Copyright (c) 2025

本项目基于MIT许可证开源，您可以自由使用、修改和分发。

---

## 🙏 致谢

感谢以下开源项目：

- [Tauri](https://tauri.app/) - 让桌面应用开发更简单
- [React](https://react.dev/) - 强大的UI库
- [Tailwind CSS](https://tailwindcss.com/) - 实用的CSS框架
- [Rust](https://www.rust-lang.org/) - 安全高效的系统语言
- [Vite](https://vitejs.dev/) - 快如闪电的构建工具

---

## 📞 支持与反馈

- 🐛 **问题反馈**: [GitHub Issues](../../issues)
- 💡 **功能建议**: [GitHub Discussions](../../discussions)
- ⭐ **如果这个项目对您有帮助，请给个Star！**

## 💡 使用技巧

### 余额查询说明

**重要提示**：部分公益站出于安全考虑，**不开放余额查询API给普通用户**。这种情况下：
- ✅ 模型列表可以正常获取
- ⚠️ 余额显示为"需登录网页查看"
- 💡 这是正常现象，不是工具bug
- 🌐 请登录网页端查看精确余额

### 最佳实践

1. **首次使用** - 建议先添加一个站点测试
2. **并发检测** - 站点较多时开启并发模式
3. **超时设置** - 网络较慢时适当增加超时时间
4. **定期检查** - 可开启自动刷新功能定期检测
5. **备份配置** - 重要配置建议手动备份config.json

### 故障排查

**问题：余额显示"需登录网页查看"**
- 原因：站点API未开放余额查询
- 解决：登录网页端查看，或联系站点管理员

**问题：模型列表为空**
- 原因：API Key权限不足或站点限制
- 解决：检查API Key是否正确，尝试重新生成

**问题：请求超时**
- 原因：网络延迟或站点响应慢
- 解决：增加超时时间（设置 > 超时配置）

---

**Made with ❤️ using Tauri, React, and Rust**
