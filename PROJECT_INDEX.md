# 项目索引 - API Hub Management Tools

## 项目概览

**API Hub Management Tools** 是一个用于 API 中转站运维的 Electron 桌面应用，当前版本为 **v3.0.1**。

**技术栈**

- 前端：React 18 + TypeScript + Tailwind CSS + Vite
- 桌面壳层：Electron 28
- 状态管理：Zustand
- 自动化：Puppeteer Core
- 校验：Zod
- 测试：Vitest + React Testing Library + fast-check

---

## 目录结构

```text
.
├── src/
│   ├── main/                 # Electron 主进程、IPC、浏览器自动化、路由代理服务
│   ├── renderer/             # React UI、页面、组件、hooks、stores
│   ├── shared/               # 前后端共享类型、常量、theme、schema
│   └── __tests__/            # Vitest 测试与属性测试
├── docs/                     # 用户、开发、架构、参考资料与内部计划/设计文档
├── scripts/                  # 开发与构建辅助脚本
├── build/                    # 打包图标与资源
├── dist/                     # 主进程构建输出
├── dist-renderer/            # 渲染进程构建输出
└── release/                  # 打包产物
```

---

## 关键模块

### 主进程

| 模块 | 作用 |
|------|------|
| `src/main/main.ts` | Electron 生命周期、窗口创建、预加载绑定 |
| `src/main/unified-config-manager.ts` | v3 配置加载、迁移、legacy 默认账户自愈修复、缺失 `site_type` 旧站点保持未决、原子写入、备份恢复、路由配置持久化，以及兼容保存时清理已删站点的孤儿账户；删除最后一个账户时自动移除站点配置 |
| `src/main/chrome-manager.ts` | 多槽位检测浏览器池、独立登录浏览器、按 site_type 解析 localStorage / 初始化用户信息 |
| `src/main/site-type-registry.ts` | 站点类型注册表，统一维护各类型的初始化/模型/余额/API Key/分组/定价端点策略 |
| `src/main/site-type-detector.ts` | 智能添加与多账户初始化前的站点类型自动识别 |
| `src/main/token-service.ts` | 登录初始化、按 site_type 选择端点与访问令牌策略、按站点类型驱动签到/浏览器回退、账号数据刷新 |
| `src/main/api-service.ts` | 站点检测、HTTP 请求、旧站点首次检测时自动识别并写回 `site_type`、LDC 支付信息探测 |
| `src/main/cli-wrapper-compat-service.ts` | 通过真实 Claude Code / Codex / Gemini CLI wrapper 做兼容性验证；当前 UI 统一通过该服务执行 CLI 可用性测试，使用临时目录隔离本机配置 |
| `src/main/handlers/*.ts` | `config:*`、`token:*`、`accounts:*`、`route:*` 等 IPC 通道 |
| `src/main/route-*.ts` | 路由代理服务器、规则解析、模型注册表、CLI 探测、健康检查、统计分析 |
| `src/main/backup-manager.ts` / `webdav-manager.ts` | 本地备份与 WebDAV 云端备份 |

### 渲染进程

| 模块 | 作用 |
|------|------|
| `src/renderer/App.tsx` | 侧边栏外壳、全局命令栏、页面切换、全局弹窗 |
| `src/renderer/pages/SitesPage.tsx` | 站点管理主页面 |
| `src/renderer/pages/CustomCliPage.tsx` | 自定义 CLI 配置页面 |
| `src/renderer/pages/CreditPage.tsx` | LDC 积分页面，展示 Linux Do Credit 账户信息、收支统计与充值入口 |
| `src/renderer/pages/RoutePage.tsx` | 路由总览页，组合代理服务、CLI 默认模型、统计与模型重定向 |
| `src/renderer/pages/LogsPage.tsx` | 会话日志页，展示通知历史与关键操作记录 |
| `src/renderer/components/Route/*` | 路由页内部区块（模型重定向、CLI 可用性、服务器/统计面板） |
| `src/renderer/services/cli-compat-projection.ts` | 将 `routing.cliProbe.latest` 投影为站点页/账户卡片使用的 CLI 兼容性展示结果，并处理来源标记与站点级回退 |
| `src/renderer/services/sessionEventLog.ts` | 将关键操作写入会话事件历史，供日志页展示 |
| `src/renderer/store/uiStore.ts` | 页面切换、侧边栏显示模式、排序、弹窗等 UI 状态 |
| `src/renderer/store/toastStore.ts` | 管理可见 Toast 队列与会话内事件历史 |
| `src/renderer/store/routeStore.ts` | Route 工作台的数据抓取与运行状态 |
| `src/renderer/hooks/useAutoRefresh.ts` | 站点级/账号级自动刷新调度 |

### 共享层

| 模块 | 作用 |
|------|------|
| `src/shared/types/site.ts` | 站点、账户、检测缓存（含 `has_checkin` / `can_check_in` 拆分）、签到等核心类型 |
| `src/shared/types/route-proxy.ts` | 路由规则、服务器配置、CLI 探测、分析统计类型 |
| `src/shared/theme/themePresets.ts` | `Light` / `Dark` 主题预设与旧值归一化 |
| `src/shared/constants/index.ts` | 列宽、默认值等共享常量 |

---

## 当前页面结构

当前 UI 的一级页面由 `src/renderer/components/AppShell/pageMeta.ts` 注册：

- `站点管理`
- `自定义 CLI`
- `LDC 积分`
- `CLI 可用性`
- `路由`
- `日志`
- `设置`

说明：

- `credit` 已恢复为一级导航页，用于 Linux Do Credit 积分视图。
- 模型重定向不再作为一级导航页，已并入 `路由` 总览页。
- `CLI 可用性` 仍保持独立入口，`路由` 页负责代理服务、默认模型、统计和最近重定向。

---

## 核心数据流

### 配置加载

1. `main.ts` 启动应用并创建窗口。
2. `UnifiedConfigManager.loadConfig()` 读取 `config.json`。
3. 若遇到旧配置，则执行 `v2 -> v3` 迁移；若发现已升级配置仍残留站点级认证且缺少账户记录，则自动补建“默认账户”并持久化；若旧站点缺失 `site_type`，加载阶段保持未决而不是默认写成 `newapi`；若遇到损坏配置，则保留坏文件并尝试从最近备份恢复。
4. `preload.ts` 暴露 IPC API，渲染进程在 `App.tsx` 初始化阶段拉取配置与缓存。

### 站点检测

1. 渲染进程触发 `detectSite / detectAllSites`。
2. 主进程通过 `ApiService + TokenService + ChromeManager` 获取站点状态；旧站点若缺失 `site_type`，会在首次自动检测入口补做判型并写回配置。
3. 检测结果写回配置缓存，并由 `detectionStore` / 页面组件更新 UI。

### 自动刷新

1. `useAutoRefresh` 基于站点与账户配置生成刷新目标集合。
2. 当存在账户配置时，优先按账户粒度调度。
3. 检测成功后回写缓存；失败时通过 toast / 错误回调反馈。

### Route 工作台

1. 渲染进程通过 `route:*` IPC 拉取 `server / rules / modelRegistry / cliProbe / analytics`。
2. 主进程中的 `route-proxy-service`、`route-cli-probe-service`、`route-analytics-service` 等模块负责运行时行为和统计。
3. 配置与统计通过 `UnifiedConfigManager` 写回 `config.routing`。

### CLI 兼容性测试

1. 渲染进程中的 `useCliCompatTest`、站点页与 CLI 配置对话框统一调用 `cli-compat:test-with-wrapper`。
2. 主进程由 `cli-wrapper-compat-service.ts` 在隔离的临时 `HOME` / `CODEX_HOME` / `GEMINI_CLI_HOME` 中拉起真实 CLI。
3. 站点管理兼容性测试与 CLI 可用性探测统一落到 `config.routing.cliProbe`：主进程保存 `history/latest`，并按站点下全部活跃账户分别探测；渲染进程再通过 `cli-compat-projection.ts` 投影回对应账户卡片，失败摘要按 CLI 独立展示；自定义 CLI 仍沿用独立配置与测试状态存储。
4. 由于真实测试不写入用户 CLI 配置目录，因此正常情况下无需备份或恢复测试前的本机 CLI 配置。

---

## 近期结构变化（v3.0.1 相对 v2.1.24）

- 新增 `src/main/cli-wrapper-compat-service.ts`
- 新增 `src/__tests__/cli-wrapper-compat-service.test.ts`
- 新增 `src/main/route-analytics-service.ts`
- 新增 `src/main/route-channel-resolver.ts`
- 新增 `src/main/route-cli-probe-service.ts`
- 新增 `src/main/route-health-service.ts`
- 新增 `src/main/route-model-registry-service.ts`
- 新增 `src/main/route-proxy-service.ts`
- 新增 `src/main/route-rule-engine.ts`
- 新增 `src/main/route-stats-service.ts`
- 新增 `src/main/handlers/route-handlers.ts`
- 新增 `src/renderer/services/cli-compat-projection.ts`
- 新增 `src/renderer/store/routeStore.ts`
- 新增 `src/renderer/components/Route/`
- 新增 `src/renderer/components/Sidebar/`
- 新增 `src/renderer/components/AppCard/`、`AppIcon/`、`AppInput/`、`AppModal/`
- 新增 `src/__tests__/unified-cli-config-dialog.test.tsx`
- 新增 `src/__tests__/credit-service.test.ts`
- 新增 `src/__tests__/useCredit.test.ts`
- 新增 `scripts/dev-cleanup.cjs`、`scripts/dev-main.cjs`、`scripts/dev.cjs`、`scripts/run-node-module.cjs`、`scripts/repair-legacy-accounts.cjs`
- 旧版 iOS 命名原语目录已全部退出主线设计系统

---

## 文档导航

- [用户指南](docs/USER_GUIDE.md)
- [开发指南](docs/DEVELOPMENT.md)
- [架构文档](docs/ARCHITECTURE.md)
- [API 参考](docs/API_REFERENCE.md)
- [站点检测参考](docs/METAPI_SITE_DETECTION_REFERENCE.md)
- [更新日志](CHANGELOG.md)

---

## 索引维护

索引体系分为三层：

1. `PROJECT_INDEX.md`：项目级索引。
2. `FOLDER_INDEX.md`：目录级索引。
3. 文件头注释：记录模块输入、输出和定位。

当新增、删除或重构模块时，需同步更新相关索引文件。

---

**版本**：3.0.1
**更新日期**：2026-04-16
**维护者**：API Hub Team
