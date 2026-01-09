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
| **App.tsx** | 应用根组件、路由 | `App` 组件 |
| **main.tsx** | 前端入口 | React 应用挂载 |
| **index.html** | HTML 模板 | 应用入口 HTML |
| **index.css** | 全局样式 | Tailwind CSS 导入、iOS 设计系统变量、响应式布局系统 |
| **svg.d.ts** | SVG 类型定义 | SVG 导入类型 |

### 子文件夹

| 文件夹 | 职责 | 关键文件 |
|--------|------|--------|
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
| **uiStore** | UI 状态 | 主题、模态框 |
| **toastStore** | 消息提示 | 消息队列 |

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
- iOS 设计系统响应式变量（间距、字体大小）
- 最小窗口尺寸支持（1024x768）
- 内容溢出使用滚动而非压缩
- 深色模式自动切换

---

**版本**: 2.1.11  
**更新日期**: 2025-01-09
