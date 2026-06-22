# 📁 src/renderer/ - React 前端 (UI)

## 架构说明

**职责**: React 前端应用，提供用户界面和交互体验

**特点**:
- 基于 React 18 + TypeScript 构建
- 使用 Tailwind CSS 进行样式管理
- 通过 IPC 与主进程通信
- Zustand 管理全局状态
- 自定义 Hooks 处理业务逻辑

**依赖关系**:
- 依赖 `shared/` 中的类型和常量
- 通过 IPC 调用 `main/` 的服务
- 使用 `components/` 构建 UI
- 使用 `hooks/` 处理业务逻辑

---

## 📂 文件清单

### 核心文件

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **App.tsx** | 应用根组件、页面壳层 | `App` 组件；根据 `activeTab + overviewSubtab` 派生数据总览 Header |
| **main.tsx** | 前端入口 | React 应用挂载 |
| **index.html** | HTML 模板 | 应用入口 HTML |
| **index.css** | 全局样式 | Tailwind CSS 导入、Light/Dark token、响应式布局系统 |
| **svg.d.ts** | SVG 类型定义 | SVG 导入类型 |

### 子文件夹

| 文件夹 | 职责 | 关键文件 |
|--------|------|--------|
| **pages/** | 页面容器 | DataOverviewPage, SitesPage, RoutePage, LogsPage |
| **components/** | UI 组件库 | 表格、表单、对话框等 |
| **hooks/** | 自定义 Hooks | 业务逻辑、状态管理 |
| **services/** | 前端服务 | IPC 通信、API 调用 |
| **store/** | 状态管理 | Zustand store |
| **utils/** | 工具函数 | 样式、日志等 |
| **assets/** | 静态资源 | 图标、图片等 |

---

## 🧩 Components (UI 组件)

### 主要组件

| 组件 | 职责 | Props |
|------|------|-------|
| **Header** | 顶部导航栏 | 主题切换、菜单 |
| **SiteCard** | 站点卡片 | 站点信息、操作按钮 |
| **SiteGroupTabs** | 站点分组标签 | 分组切换、新增 |
| **SiteListHeader** | 站点列表头部 | 搜索、筛选、排序 |
| **SiteEditor** | 站点编辑对话框 | 编辑站点信息 |
| **SettingsPanel** | 设置面板 | 应用设置 |
| **ConfirmDialog** | 确认对话框 | 删除确认等 |
| **DetectionResults** | 检测结果显示 | 检测结果展示 |
| **Toast** | 消息提示 | 成功、错误、警告 |
| **Skeleton** | 骨架屏 | 加载占位符 |
| **CliCompatibilityIcons** | CLI 兼容性图标 | 工具支持情况 |
| **CreateApiKeyDialog** | API Key 创建对话框 | 创建 API Key |

### 对话框组件 (dialogs/)

- 各类对话框的独立组件
- 支持表单验证、错误处理

---

## 📄 Pages (页面容器)

### 一级页面

| 页面 | 职责 | 关键内容 |
|------|------|--------|
| **DataOverviewPage** | 数据总览首页 | 左侧 `站点数据 / 路由数据` 子页对应内容、路由健康 KPI、站点余额/消费榜单、每日快照趋势、规则洞察、异常请求；路由运行趋势在 `24h` / `7d` 下补齐完整 X 轴 |
| **SitesPage** | 站点管理主页面 | 统一展示托管站点账户行与直连配置接入点；提供操作记录、添加接入点、批量检测/刷新/签到、History 时间桶列与接入点详情侧滑面板 |
| **CreditPage** | Linux Do Credit 页面 | 积分余额、每日统计、交易记录、充值入口 |
| **RoutePage** | 路由配置/操作页 | 代理服务、模型重定向，以及跳转到数据总览的统计入口 |
| **LogsPage** | 日志页内容容器 | 直接展示路由日志；通过逐条 push 追加并使用无卡片、带表头的横向滚动单行表格，展示 CLI 图标、原始模型、路由目标、Token（总/输入/输出/缓存写/缓存读）、参考金额、用时/首字、纯数字状态码与失败第二行 |
| **SettingsPage** | 设置页 | 应用设置、导入导出、备份入口 |

---

## 🎣 Hooks (业务逻辑)

### 核心 Hooks

| Hook | 职责 | 返回值 |
|------|------|--------|
| **useSiteGroups** | 站点分组管理 | 分组列表、操作方法 |
| **useAutoRefresh** | 自动刷新逻辑 | 刷新状态、控制方法 |
| **useSiteDetection** | 站点检测 | 检测状态、结果 |
| **useTokenManagement** | Token 管理 | Token 操作方法 |
| **useCheckIn** | 签到逻辑 | 签到状态、方法 |
| **useCliCompatTest** | CLI 兼容性测试 | 测试状态、结果、toast 提示 |
| **useDataLoader** | 数据加载 | 加载状态、数据 |
| **useSiteDrag** | 站点拖拽排序 | 拖拽状态、方法 |
| **useTheme** | 主题管理 | 主题模式、切换方法 |
| **useUpdate** | 应用更新检查 | 更新状态、方法 |

### Hook 特点

- 封装 IPC 通信逻辑
- 处理错误和加载状态
- 提供类型安全的接口
- 支持自动重试和超时控制

---

## 🏪 Store (状态管理)

### Zustand Stores

| Store | 职责 | 关键状态 |
|-------|------|--------|
| **configStore** | 配置管理 | 站点列表、设置 |
| **detectionStore** | 检测结果 | 检测状态、结果 |
| **uiStore** | UI 状态 | 一级页面切换（默认 `overview`）、`overviewSubtab` 子页切换、主题、模态框 |
| **toastStore** | 消息提示 | 可见 Toast 队列、当前会话事件历史 |

### Store 特点

- 使用 Zustand 进行状态管理
- 支持持久化存储
- 类型安全的 selector
- 自动订阅和更新

---

## 🔌 Services (IPC 通信)

### cli-config-generator.ts

**职责**: 生成 CLI 配置

**关键方法**:
- `generateConfig(site)` - 生成配置
- `generateCodexConfig(params)` - 生成 Codex 配置（含 wire_api 测试结果注释）
- `generateGeminiCliConfig(params)` - 生成 Gemini CLI 配置（含端点测试结果注释）
- `selectEndpointFormat(geminiDetail)` - 根据测试结果选择端点格式
- `generateEndpointComment(geminiDetail)` - 生成端点测试结果注释

### cli-compat-projection.ts

**职责**: 把 `routing.cliProbe.latest` 投影为站点页兼容性图标使用的结果，并补充来源标签。

**关键方法**:
- `projectCliCompatibilityMap(config)` - 生成站点/账户维度的兼容性映射
- `syncProjectedCliCompatibility(config, setCliCompatibility)` - 将投影结果同步到 `detectionStore`

### sessionEventLog.ts

**职责**: 当前会话关键操作记录

**关键方法**:
- `success()`, `info()`, `warning()`, `error()` - 将关键操作写入 `toastStore.eventHistory`

### IPC 通信模式

```typescript
// 调用主进程服务
const result = await window.ipcRenderer.invoke('api:request', {
  site: 'one-api',
  endpoint: '/api/user/info'
});
```

---

## 🎨 Utils (工具函数)

### groupStyle.tsx

**职责**: 站点分组样式生成

**关键函数**:
- `getGroupStyle(groupId)` - 获取分组样式
- `getGroupColor(groupId)` - 获取分组颜色

### logger.ts

**职责**: 前端日志记录

**关键方法**:
- `info()`, `warn()`, `error()` - 日志输出

### siteOverview.ts

**职责**: 基于当前站点/账户缓存生成数据总览页的资源指标

**关键方法**:
- `buildSiteOverviewMetrics(config, now?)` - 聚合站点余额、消费、请求与模型数量

### modelPricing.ts

**职责**: 归一化模型按 token / 按次计费方式与价格，供路由日志预计金额和模型重定向价格标签复用

**关键函数**:
- `resolveModelPricing(pricingData)` - 返回 `token` 或 `perCall` 模式及对应价格字段
- `isPerCallPricing(pricingData)` - 判断模型是否显式按次计费

### routeRulePresentation.ts

**职责**: 将路由规则转换为可解释展示文案

**关键方法**:
- `buildRouteRuleSummary(rule, context?)` - 生成人类可读摘要
- `buildRouteRuleSelectionReason(rule)` - 生成“为何命中”说明
- `buildRouteRuleTags(rule, context?)` - 生成紧凑标签列表

---

## 📊 数据流

### 用户操作流程

```
用户交互 (点击按钮、输入表单等)
    ↓
Hook 捕获事件
    ↓
调用 IPC 方法 (window.ipcRenderer.invoke)
    ↓
主进程处理请求
    ↓
返回结果到前端
    ↓
Hook 更新 Store
    ↓
组件重新渲染
    ↓
UI 更新
```

### 自动刷新流程

```
useAutoRefresh Hook 启动定时器
    ↓
定时调用 API 检测
    ↓
更新 detectionStore
    ↓
组件订阅 Store 变化
    ↓
自动重新渲染
```

---

## 🔄 组件通信

### Props 传递

```
App.tsx (根组件)
    ↓
Header, SiteGroupTabs, SiteListHeader
    ↓
SiteCard (站点卡片)
    ↓
操作按钮、菜单
```

### 事件处理

```
用户操作
    ↓
组件事件处理器
    ↓
调用 Hook 方法
    ↓
更新 Store
    ↓
其他组件订阅 Store 变化
    ↓
自动更新
```

---

## 🎯 关键特性

### 1. 响应式设计

- 使用 Tailwind CSS 响应式类
- 统一主题 token 的响应式变量（间距、字体大小）
- 最小窗口尺寸支持（1200x700）
- 内容溢出使用滚动而非压缩
- 深色模式自动切换

---

**版本**: 3.0.3
**更新日期**: 2026-06-17
