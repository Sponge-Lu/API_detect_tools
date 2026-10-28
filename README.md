# API Hub Management Tools

<div align="center">
  <img src="build/icon.png" alt="Logo" width="128" height="128">
  <br><br>

  **API Hub Management Tools** 是一个用于管理、检测和运维 API 中转站的桌面客户端。

  当前版本：`v3.1.6`

  基于 [Electron](https://www.electronjs.org/) + [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) 构建。

  [⬇️ 下载最新版](https://github.com/Sponge-Lu/API_detect_tools/releases)
</div>

---



## 核心特性

- **多站点与多账号管理**：统一维护站点、账号、分组、排序、缓存数据和日常操作，支持批量签到。
- **数据总览**：默认首页，拆分为站点数据与路由数据，查看站点余额、今日消费、请求数、签到概览、资源榜单、路由 KPI 与趋势分析。
- **本地路由工作台**：集中配置代理服务、默认模型、模型重定向、通道优先级与三态熔断策略，按 Agent + 运行位置 + Session ID 做会话级路由。
- **全局固定模型路由**：按请求模型名称精确匹配，统一指定目标模型与思考强度，支持缺少会话身份的 MCP 请求。
- **DSH 会话级接入**：一键把 DeepSeek Harness 的 provider 指向本地路由，支持漂移检测、存量会话迁移与按条目回滚。
- **CLI 配置与兼容性**：支持 Claude Code、Codex、OpenCode、Grok Build 的配置生成、预览、编辑与一键写入，以及三协议原生端点测试。
- **更新与备份**：支持应用内更新、自动备份、本地恢复与 WebDAV 云端备份。


---

## 文档导航

- **[用户指南](docs/USER_GUIDE.md)**：功能说明、使用路径与 FAQ。
- **[开发指南](docs/DEVELOPMENT.md)**：环境准备、脚本、测试与提交流程。
- **[架构文档](docs/ARCHITECTURE.md)**：主进程、渲染进程、路由系统与配置模型说明。
- **[API 参考](docs/API_REFERENCE.md)**：接口与兼容性参考。
- **[DSH 会话级接入](docs/DSH_SESSION_ROUTING_INTEGRATION.md)**：DeepSeek Harness 接入的设计与约束。
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
