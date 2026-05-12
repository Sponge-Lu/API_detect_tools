# API Hub Management Tools

<div align="center">
  <img src="build/icon.png" alt="Logo" width="128" height="128">
  <br><br>

  **API Hub Management Tools** 是一个用于管理、检测和运维 API 中转站的桌面客户端。

  当前版本：`v3.0.1`

  基于 [Electron](https://www.electronjs.org/) + [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) 构建。

  [⬇️ 下载最新版](https://github.com/Sponge-Lu/API_detect_tools/releases)
</div>

---



## 核心特性

- **多站点与多账号管理**：统一维护站点、账号、分组、排序、缓存数据和日常操作。
- **自动认证与浏览器协作**：支持自动捕获登录凭证、Cloudflare/挑战页回退、按 Profile 打开站点。
- **Route 工作台**：集中配置模型映射、CLI 路由探测、代理统计、通道健康与请求日志。
- **数据总览**：查看站点余额、今日消费、请求数、签到概览、资源榜单与日级趋势。
- **账号级自动刷新**：支持站点级与账号级自动刷新，适配多账号站点。
- **CLI 配置与兼容性**：支持 Claude Code、Codex、Gemini CLI 的测试、配置生成、预览、编辑与一键写入。
- **AnyRouter/中转站适配**：支持 AnyRouter、CHY API 等站点的请求改写、配置生成与兼容性投影。
- **API Key 与签到工具**：可视化创建/删除 API Key，支持批量签到与福利入口。
- **Linux Do Credit**：支持 LDC 数据读取、统计查看与充值跳转。
- **更新与备份**：支持应用内更新、自动备份、本地恢复与 WebDAV 云端备份。

---

## v3.0.1 版本重点

- **v3 配置模型**：统一为 `sites + accounts + routing` 数据结构，旧配置加载时自动迁移。
- **路由代理增强**：新增模型重定向、CLI 可用性、代理统计、请求日志和通道健康矩阵。
- **数据页优化**：站点数据页补充每日签到概览、站点资源概览、趋势图和负余额过滤聚合。
- **CLI 兼容性增强**：完善 Claude Code、Codex、Gemini CLI 与自定义 CLI 的配置状态和探测结果展示。
- **站点适配扩展**：新增 AnyRouter/CHY API 请求改写能力，提升中转站兼容性。

---

## 文档导航

- **[用户指南](docs/USER_GUIDE.md)**：功能说明、使用路径与 FAQ。
- **[开发指南](docs/DEVELOPMENT.md)**：环境准备、脚本、测试与提交流程。
- **[架构文档](docs/ARCHITECTURE.md)**：主进程、渲染进程、路由系统与配置模型说明。
- **[API 参考](docs/API_REFERENCE.md)**：接口与兼容性参考。
- **[更新日志](CHANGELOG.md)**：版本历史与变更摘要。

---

## 快速开始

### 安装包

前往 [Releases 页面](https://github.com/Sponge-Lu/API_detect_tools/releases) 下载对应平台构建：

- **Windows**：`API Hub Management Tools Setup x.x.x.exe` 或 `API Hub Management Tools-x.x.x-portable.exe`
- **macOS**：`API Hub Management Tools-x.x.x.dmg` 或 `API Hub Management Tools-x.x.x-mac.zip`
- **Linux**：`API Hub Management Tools-x.x.x.AppImage` 或 `API Hub Management Tools-x.x.x.deb`

### 本地开发

```bash
git clone https://github.com/Sponge-Lu/API_detect_tools.git
cd API_detect_tools
npm install
npm run dev
```

### 常用命令

```bash
npm run dev            # 同时启动 Electron 主进程与 Vite 渲染进程
npm run build          # 构建 dist/ 与 dist-renderer/
npm run dist:win       # Windows 打包
npm run dist:mac       # macOS 打包
npm run dist:linux     # Linux 打包
npm run lint           # ESLint
npm run test           # Vitest
```

更多细节见 [开发指南](docs/DEVELOPMENT.md)。

---

## 许可证

[MIT License](LICENSE)
