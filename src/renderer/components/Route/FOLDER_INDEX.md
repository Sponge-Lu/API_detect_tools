# 📁 src/renderer/components/Route/ - Route 页面组件

## 架构说明

**职责**: 提供模型重定向、CLI 可用性、代理统计相关的 route 页面组件。

**特点**:
- 三张 route 页面不再额外挂载顶部 header / 说明头带
- 操作控件回收到各自内容区内部，避免重复的信息层
- 保持各自原型不变：目录页、矩阵页、运营控制页
- 不改动 route store / IPC，仅调整展示层层级

## 文件清单

| 文件 | 职责 |
|------|------|
| `RouteSubTabs.tsx` | 遗留 route 子页切换条，供旧 RoutePage 使用 |
| `Redirection/ModelRedirectionTab.tsx` | 模型重定向目录页 |
| `Usability/CliUsabilityTab.tsx` | CLI 可用性矩阵页 |
| `ProxyStats/ProxyStatsTab.tsx` | 代理统计控制台 |

## 更新日志

- 2026-04-01: 移除三张 live route 页面的顶部说明头带，操作条回收到内容区
- 2026-04-01: 进一步收紧 route 头带为单行不换行结构，匹配顶层 tab header 节奏
- 2026-04-01: 移除旧标签行，route 页头带改为更紧凑的单行信息带
