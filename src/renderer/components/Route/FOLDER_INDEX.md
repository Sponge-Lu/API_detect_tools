# 📁 src/renderer/components/Route/ - Route 页面组件

## 架构说明

**职责**: 提供本地路由会话区、独立模型映射页、代理服务器与 CLI 模型选择区块,以及站点 History 复用组件。

**特点**:
- 模型重定向由独立的"模型映射"一级页面承载
- 本地路由页以服务器状态、CLI 模型选择和会话级覆盖为核心
- `RouteSubTabs.tsx` 已删除(无引用遗留组件)

## 文件清单

| 文件 | 职责 |
|------|------|
| `RouteSessionSection.tsx` | 固定三列紧凑 RouteInstance 卡片、预创建模型/思考强度、会话级运行范围、展示别名和显式生命周期操作 |
| `Redirection/ModelRedirectionTab.tsx` | 模型映射页的手工/显式 override 重定向卡片区与编辑模态框 |
| `Usability/HistoryBucketBars.tsx` | 站点管理 History 列复用的单轨 48 小时 / 2 小时成功率条形图；按表头选择实际请求端点，通过 `route:getHistoryBuckets` IPC 获取数据并按成功率渐变着色 |
| `ProxyStats/ProxyStatsTab.tsx` | 路由页代理服务器配置、local-route profile 独立凭证生成/轮换、亲和映射影响预览/确认清理与 CLI 路由模型选择面板 |

## 更新日志

- 2026-08-08: 删除无引用的 `RouteSubTabs.tsx`;`ProxyStatsTab.tsx` 移除 `StatsDashboard`/`ProxyStatsTab` 导出,保留 `ServerSection`/`CliModelSection`;`ServerSection` 重写为 canonical AppCard + AppInput 风格
- 2026-04-16: 顶层"模型重定向"页面下线,`代理统计` 一级页更名为 `路由`
- 2026-04-16: 路由总览页增加单列厂商折叠式模型重定向区,默认收起并按厂商内 sourceKey 覆盖保存
- 2026-04-21: CLI 可用性矩阵改为按"站点-账户"多行展示,站点列缩窄后让三个 CLI history 区域相应放宽,并统一使用 24 小时制测试时间
- 2026-04-25: CLI history 条形图改为按实际测试样本逐条绘制,一个样本对应一个独立条形,不再按来源做额外标记
- 2026-06-17: 独立 CLI 可用性页面下线,History 条形图作为站点管理页 History 列组件保留
- 2026-04-01: 移除三张 live route 页面的顶部说明头带,操作条回收到内容区
- 2026-04-01: 进一步收紧 route 头带为单行不换行结构,匹配顶层 tab header 节奏
- 2026-04-01: 移除旧标签行,route 页头带改为更紧凑的单行信息带
