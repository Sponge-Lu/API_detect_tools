# API Hub Management Tools

<div align="center">
  <img src="build/icon.png" alt="Logo" width="128" height="128">
  <br><br>

  **API Hub Management Tools** 是一个用于管理、检测和运维 API 中转站的桌面客户端。

  当前版本：`v3.0.5`

  基于 [Electron](https://www.electronjs.org/) + [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) 构建。

  [⬇️ 下载最新版](https://github.com/Sponge-Lu/API_detect_tools/releases)
</div>

---



## 核心特性

- **多站点与多账号管理**：统一维护站点、账号、分组、排序、缓存数据和日常操作。
- **自动认证与浏览器协作**：支持自动捕获登录凭证、Cloudflare/挑战页回退、按 Profile 打开站点。
- **数据总览**：默认首页，拆分为站点数据与路由数据，查看站点余额、今日消费、请求数、签到概览、资源榜单、路由 KPI 与趋势分析。
- **本地路由工作台**：集中配置代理服务、默认模型、模型重定向、通道优先级与运行时路径健康策略。
- **账号级自动刷新**：支持站点级与账号级自动刷新，适配多账号站点。
- **CLI 配置与兼容性**：支持 Claude Code、Codex、Gemini CLI 的测试、配置生成、预览、编辑与一键写入。
- **AnyRouter/中转站适配**：支持 AnyRouter、CHY API 等站点的请求改写、配置生成与兼容性投影。
- **API Key 与签到工具**：可视化创建/删除 API Key，支持批量签到与福利入口。
- **Linux Do Credit**：支持 LDC 数据读取、统计查看与充值跳转。
- **更新与备份**：支持应用内更新、自动备份、本地恢复与 WebDAV 云端备份。

---

## v3.0.5 版本重点

- **路由流式响应加固**：透明 SSE 转发会校验首包、终止事件和 Claude Code 消息结构， malformed / incomplete 响应会记录明确错误并避免静默成功。
- **probe-lock 探测容错**：瞬时上游错误可在预算内重试，首个终结上游结果优先于 CLI 后续噪声，Claude JSON 错误会摘要化显示。
- **自定义 CLI 纳入探测**：CLI 可用性页支持自定义 CLI 虚拟配置行，立即探测会携带自定义上游 URL/API Key。
- **路由优先命中可重置**：模型重定向详情支持重置当前优先命中路径，重启后也能从运行态恢复命中状态。
- **API Key 兼容增强**：NewAPI 脱敏 key 优先通过批量接口补全明文，站点卡片支持单个 API Key 状态刷新。
- **日志和统计展示优化**：路由日志展示上游响应摘要、站点优先级排名和更准确的失败细节；调整模型重定向站点排序后，已展示日志会按最新优先级实时刷新。

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
