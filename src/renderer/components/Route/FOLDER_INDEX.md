# 📁 src/renderer/components/Route/ - Route 页面组件

## 架构说明

**职责**: 提供会话路由区（mini/标准两种密度）、配置文件卡片区、独立模型映射工作区、代理服务器与 CLI 模型选择区块,以及站点 History 复用组件。

**特点**:
- `路由设置` 左列按客户端独立凭证分组，分组头切换客户端级/会话级并独立折叠；客户端卡片与会话卡片均可选择模型、思考强度和钉住保护，右侧为独立模型映射工作区。
- 模型映射工作区为两列布局（重定向模型列表 / 来源优先级详情），原始模型列已移除、原始模型在编辑弹窗内选择
- 本地路由页 = 代理服务器 + 配置文件卡片
- `RouteSubTabs.tsx` 已删除(无引用遗留组件)

## 文件清单

| 文件 | 职责 |
|------|------|
| `RouteSessionSection.tsx` | 按 profileId 分组的双模式路由卡片；分组头提供模式切换、计数和独立折叠，折叠状态本地保存；两类卡片均支持模型、思考强度和钉住，保留会话父子层级、预创建及生命周期操作；mini 供左侧窄列使用，标准密度在组内三列展示 |
| `ConfigProfilesSection.tsx` | 配置方案摘要卡片（可整卡点击编辑）、编辑弹窗、模板应用与本地文件保存预览（渲染于本地路由页） |
| `DshConfigControls.tsx` | DSH 状态与模型目录读取；编辑器仅在基本信息下方展示高级操作：检测、旧会话迁移及恢复预览 |
| `Redirection/ModelRedirectionTab.tsx` | 模型映射工作区：重定向模型列表（行内 `编辑` 文本按钮 + 删除图标按钮，独立渲染时同步/新增动作回退到工具栏）、来源优先级详情与编辑模态框 |
| `Redirection/ModelDiscoveryDialog.tsx` | 自动归组候选的搜索与勾选启用；只创建用户所选重定向，并持续收录同类原始模型 |
| `Usability/HistoryBucketBars.tsx` | 站点管理 History 列复用的单轨 48 小时 / 2 小时成功率条形图；按表头选择实际请求端点，通过 `route:getHistoryBuckets` IPC 获取数据并按成功率渐变着色，条形图右侧内联汇总 48h 请求数与加权成功率 |
| `ProxyStats/ProxyStatsTab.tsx` | 路由页代理服务器配置与启停结果提示、local-route profile 独立凭证生成/轮换、亲和映射影响预览/确认清理与 CLI 路由模型选择面板 |

## 更新日志

- 2026-09-19: mini 卡片布局再收紧——卡片列收窄至 240-280px 并把宽度让给优先级详情列；模型与思考强度合并同行；客户端名称改为纯文本展示（mini 密度不再可编辑，重命名走标准密度卡片）；备注内联到名称后方且降为 text-xs；卡片头标题/计数与模型映射工作区工具栏统一字号（标题 text-xs、计数 text-[11px]），客户端名称与映射列表主文本统一 13px；Session ID 上移至名称下方分隔线上方，模型/思考强度改为幽灵下拉（去外框留箭头、h-5），卡片 padding/gap/行高全面压缩至最扁（py-1、gap-0.5、备注 h-4、名称 leading-4，列表间距 gap-1.5）；重定向模型列表列宽微调至路由卡片宽度的 7/8（210-245px），路由卡片列保持 240-280px 不变
- 2026-09-18: `路由设置` 单页承载两个独立卡片区域——左列 mini 会话路由卡片、右侧模型映射工作区（不再嵌在同一张卡片内）；模型映射工作区移除"原始模型"列，`编辑` 按钮移入每个重定向模型行内、删除按钮改为垃圾桶图标，独立渲染时同步/新增按钮回退到列表工具栏；`RouteSessionSection` 新增 `mini` 密度并精简卡片信息（省略运行范围输入、创建/最近时间与字段标签）
- 2026-09-03: 会话路由卡片多轮迭代至「显示优先」分层结构——头部行（logo + 名称幽灵输入，客户端名称与 `#N` 编号同框展示、保存前剥离编号后缀 + 带文字的取消/CircleStop 关闭/归档按钮）、备注 hero 行（16px 会话色）、元信息行（Session ID + 复制 + 30% 宽运行范围幽灵输入）、带分隔线的配置区、轻量页脚；状态徽章移除（按钮与透明度已承载状态语义，未绑定提示按 armed/cancelled 分化文案）；整卡左缘 3px 会话色边、p-3/gap-2 留白、悬停微阴影；会话色与优先级色点同源（`utils/routeSessionOrdinal.ts`）；已关闭/已取消卡片降透明；卡片列表按创建时间稳定排序
- 2026-09-02: 页面内容互换——配置文件卡片(原"配置文件"页)迁入本地路由页成为 `ConfigProfilesSection.tsx`,会话路由区迁至新"路由设置"页
- 2026-08-08: 删除无引用的 `RouteSubTabs.tsx`;`ProxyStatsTab.tsx` 移除 `StatsDashboard`/`ProxyStatsTab` 导出,保留 `ServerSection`/`CliModelSection`;`ServerSection` 重写为 canonical AppCard + AppInput 风格
- 2026-04-16: 顶层"模型重定向"页面下线,`代理统计` 一级页更名为 `路由`
- 2026-04-16: 路由总览页增加单列厂商折叠式模型重定向区,默认收起并按厂商内 sourceKey 覆盖保存
- 2026-04-21: CLI 可用性矩阵改为按"站点-账户"多行展示,站点列缩窄后让三个 CLI history 区域相应放宽,并统一使用 24 小时制测试时间
- 2026-04-25: CLI history 条形图改为按实际测试样本逐条绘制,一个样本对应一个独立条形,不再按来源做额外标记
- 2026-06-17: 独立 CLI 可用性页面下线,History 条形图作为站点管理页 History 列组件保留
- 2026-04-01: 移除三张 live route 页面的顶部说明头带,操作条回收到内容区
- 2026-04-01: 进一步收紧 route 头带为单行不换行结构,匹配顶层 tab header 节奏
- 2026-04-01: 移除旧标签行,route 页头带改为更紧凑的单行信息带

## 架构与数据管理重构（2026-10-24）

- [ConfigProfilesSection.tsx](ConfigProfilesSection.tsx): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [config-profile-view.ts](config-profile-view.ts): 配置卡片 UI 草稿与模板辅助
- [ConfigProfilePreview.tsx](ConfigProfilePreview.tsx): CLI 文件预览和差异确认展示
- [ConfigProfileRuleEditor.tsx](ConfigProfileRuleEditor.tsx): 模板替换规则编辑控件
