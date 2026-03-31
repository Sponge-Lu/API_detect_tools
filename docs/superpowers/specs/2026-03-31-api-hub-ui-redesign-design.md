# API Hub UI Redesign Design

- Date: `2026-03-31`
- Scope: Electron renderer UI redesign
- Product: `API_detect_tools`
- Direction: `高级克制`

## 1. Goal

本次重设计的目标不是单纯换皮，而是在不牺牲信息密度和操作效率的前提下，重建整个桌面应用的视觉秩序、信息结构与交互节奏。

设计必须同时满足以下条件：

- 风格参考 `/.claude/UI_style.md`，保持低饱和、克制、少边框、无渐变。
- 所有主页面处于同一层级，不再保留“路由”父页面下的子页面切换。
- 站点管理页仍然是全产品的密度锚点，不能为了“高级感”牺牲快速排序、快速扫读、快速操作。
- 后续会对站点页字段重新规划以减少列数，但不能损失排序能力与操作效率。
- 所有弹窗、编辑窗口、侧边工作窗必须属于同一套 overlay 视觉系统。

## 2. Non-Goals

本设计不包含以下内容：

- 不在本阶段定义最终颜色 token 数值到 CSS 变量级别。
- 不在本阶段定义像素级组件尺寸或动画参数。
- 不在本阶段重写业务逻辑、状态管理或 IPC 结构。
- 不在本阶段扩展新功能，仅重组现有信息与操作方式。

## 3. Evidence Base

当前设计判断基于以下现状：

- 根布局当前为 `左侧导航 + 顶部状态栏 + 页面内容区`，见 [App.tsx](/D:/2_Github_Repository/API_detect_tools/src/renderer/App.tsx)。
- 当前左侧导航仍包含路由分组，见 [VerticalSidebar.tsx](/D:/2_Github_Repository/API_detect_tools/src/renderer/components/Sidebar/VerticalSidebar.tsx)。
- 当前页面层级类型中仍保留 `redirection / usability / proxystats` 作为路由相关 tab，见 [uiStore.ts](/D:/2_Github_Repository/API_detect_tools/src/renderer/store/uiStore.ts#L31)。
- 当前站点页表头是高密平铺列，包含 `余额 / 今日消费 / 总 Token / 请求 / RPM / TPM / 模型数 / 更新时间 / CLI兼容性` 等字段，见 [SitesPage.tsx](/D:/2_Github_Repository/API_detect_tools/src/renderer/pages/SitesPage.tsx#L109)。
- 当前站点页实际上已经支持 `站点 + 账户` 维度的扁平键与条目，见 [SitesPage.tsx](/D:/2_Github_Repository/API_detect_tools/src/renderer/pages/SitesPage.tsx#L102) 与 [SitesPage.tsx](/D:/2_Github_Repository/API_detect_tools/src/renderer/pages/SitesPage.tsx#L125)。
- 当前排序字段已将 `balance / todayUsage / totalTokens / requests / rpm / tpm / modelCount / lastUpdate` 明确为一等字段，见 [uiStore.ts](/D:/2_Github_Repository/API_detect_tools/src/renderer/store/uiStore.ts#L45)。
- 自定义 CLI 页目前是卡片式配置列表，见 [CustomCliPage.tsx](/D:/2_Github_Repository/API_detect_tools/src/renderer/pages/CustomCliPage.tsx)。
- 模型重定向页本质是 `左侧厂商筛选 + 右侧映射表`，见 [ModelRedirectionTab.tsx](/D:/2_Github_Repository/API_detect_tools/src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx)。
- CLI 可用性页本质是探测矩阵和历史条，见 [CliUsabilityTab.tsx](/D:/2_Github_Repository/API_detect_tools/src/renderer/components/Route/Usability/CliUsabilityTab.tsx)。
- 代理统计页本质包含服务器控制、CLI 默认模型和统计仪表，见 [ProxyStatsTab.tsx](/D:/2_Github_Repository/API_detect_tools/src/renderer/components/Route/ProxyStats/ProxyStatsTab.tsx)。
- 设置页目前已经是单页分区表单结构，见 [SettingsPanel.tsx](/D:/2_Github_Repository/API_detect_tools/src/renderer/components/SettingsPanel.tsx)。

## 4. Visual Direction

### 4.1 Tone

整体气质定义为：

- 高级
- 克制
- 冷静
- 专业
- 技术工具感，但不走监控大屏或炫技风

### 4.2 Visual Rules

- 主背景使用暖灰纸面感，而不是纯白。
- 容器层级使用石色与明度差建立结构，不依赖重描边。
- 主强调色使用低饱和苔灰或蓝灰，不允许高饱和消费级蓝紫。
- 禁止渐变。
- 禁止明显玻璃拟态、炫光和厚重阴影。
- 通过排版、留白和局部明度差建立层级，而不是靠颜色噪声。

### 4.3 Density Rule

本产品的高级感来自“高密但不乱”，不是“宽松大留白”。

因此：

- 保持桌面端高信息密度。
- 压缩列数，但不压缩信息能力。
- 减少重复视觉元素，保留高频信息和高频动作的直接可达性。

## 5. Information Architecture

所有主页面在同一层级，不再保留“路由”父页面。

一级导航调整为：

- `站点管理`
- `自定义 CLI`
- `模型重定向`
- `CLI 可用性`
- `代理统计`
- `设置`

说明：

- 顶部不承担子页面切换。
- 页内允许存在筛选、时间范围、分区索引等局部导航，但这些不构成主页面层级。

## 6. Global Shell

全局外壳定义为：

- `同层级左导航`
- `顶部全局命令栏`
- `页面独立标题区`

### 6.1 Left Navigation

- 使用窄导航栏作为全局一级入口。
- 导航栏表现为目录脊柱，强调稳定感和切换清晰度。
- 不再存在“路由”展开组。

### 6.2 Top Command Bar

顶部升级为全局命令栏，承担：

- 全局搜索
- 全局刷新入口
- 批量动作入口
- 保存状态
- 更新状态

顶部命令栏不承担页面内部二级导航。

### 6.3 Page Header

每个主页面拥有独立标题区，用于表达：

- 页面标题
- 页面摘要
- 页面专属动作

不同页面共享相同的标题区节奏，但不要求标题区内容完全相同。

## 7. Page Archetypes

统一的是外壳，不统一的是内容原型。

### 7.1 站点管理

原型：`高密操作列表`

### 7.2 自定义 CLI

原型：`配置工作台`

- 从卡片墙转向紧凑配置列表。
- 每个配置项显示名称、目标地址、启用状态、模型数、最近状态。
- 高频动作保留行内，详情通过抽屉或局部详情区承接。

### 7.3 模型重定向

原型：`映射目录页`

- 保留页内厂商筛选列。
- 主区是高密映射表。
- 展开只承接来源详情。

### 7.4 CLI 可用性

原型：`探测矩阵页`

- 一行代表一个 `site-account`。
- 三列代表不同 CLI。
- 主要信息为历史条、延迟和最近结果。

### 7.5 代理统计

原型：`运营控制页`

- 上半区为服务器控制与配置。
- 下半区为统计摘要与图表。
- 可以适当吸收模块化布局，但不能碎片化。

### 7.6 设置

原型：`单页分区表单`

- 仍为一个设置页面。
- 左侧为分区索引，右侧为连续表单区。
- 不拆成多个一级页面。

## 8. Site Management Design

站点管理页是整个产品的视觉锚点与效率锚点。

### 8.1 Basic Unit

基础单元定义为：

- `站点 + 账户`

而不是单纯站点。

说明：

- 默认每一行就是一个 `site-account row`。
- 站点名是主标识。
- 账户名是同一基本单元中的次级标识。
- 同站点多账户之间可以使用弱关联样式，但不做层级嵌套。

### 8.2 Core Workflow

站点页服务的核心流程是：

- 排序
- 扫描
- 点击动作

因此设计必须优先保障：

- 排序入口常驻
- 主列表单层可扫
- 高频动作无需先展开

### 8.3 Fixed Sort Bar

固定排序条常驻，只保留 3 个高频排序项：

- `余额`
- `今日消费`
- `总 Token`

说明：

- 这 3 个字段是站点日常使用中最关键的快速判断维度。
- 单击默认为降序，再次点击切换升序。
- 当前排序字段和方向必须显式显示。
- 排序偏好必须持久化。

### 8.4 More Sort Menu

次级排序项进入 `更多排序` 菜单：

- `请求`
- `RPM`
- `TPM`
- `更新时间`
- `模型数`
- `名称`

目的：

- 保留能力
- 不让固定排序条膨胀成第二排表头

### 8.5 Main Row Structure

主行结构不再延续传统宽表头，而改为紧凑的信息组：

- `站点身份组`：站点名、账户名、分组、可用性状态
- `资金信息组`：余额、今日消费
- `负载摘要组`：总 Token
- `能力摘要组`：模型数、CLI 兼容性摘要
- `操作组`：高频动作

说明：

- 主行信息组允许视觉合并，但排序逻辑仍保留精确字段。
- 这样既减列，又不影响快速扫读。

### 8.6 Expand Strategy

默认不依赖展开完成主任务。

展开只承接补充信息，例如：

- 更细的 token 拆分
- 额外模型信息
- 账户附加状态
- 非高频细节

展开不是高频动作的前置条件。

## 9. Action Strategy

### 9.1 High-Frequency Actions

以下动作必须直出在主行中：

- `签到`
- `刷新`
- `自动刷新`
- `展开`
- `加油站图标`
- `CLI入口`

说明：

- 这些是日常高频动作，不能因为设计美观而下沉。
- 它们必须在不展开的情况下直接可达。

### 9.2 Low-Frequency Actions

以下动作进入右键菜单或行尾更多菜单：

- `编辑站点`
- `删除站点`
- `添加账户`

说明：

- `添加账户` 虽然属于站点级动作，但使用频率低于站点日常操作。
- 菜单内容在右键与更多菜单中保持一致。

### 9.3 CLI Actions

CLI 相关操作不能与普通站点操作混在一起。

主行中只保留 `CLI入口`。

点击后打开专用 CLI 工作抽屉或侧边工作窗，内部承载：

- `配置`
- `测试`
- `应用`
- `结果反馈`

CLI 是独立任务域，不与刷新、签到、删除等动作共用同一操作块。

## 10. Overlay System

所有弹窗、编辑窗口、工作抽屉必须属于同一套 overlay 设计语言。

统一 family 包含：

- `确认弹窗`
- `编辑弹窗`
- `侧边工作窗`

### 10.1 Shared Rules

三类 overlay 必须共享：

- 同一背景逻辑
- 同一圆角体系
- 同一阴影与遮罩逻辑
- 同一标题栏结构
- 同一关闭按钮位置
- 同一正文间距
- 同一底部操作区样式
- 同一主要 / 次要 / 危险按钮语义

说明：

- `编辑站点`
- `添加账户`
- `CLI 配置/测试/应用`
- `删除确认`

都应当看起来像同一产品里的同一家族，而不是不同来源的弹窗集合。

## 11. Interaction Rules

### 11.1 Sorting

- 固定排序条常驻。
- 当前排序字段与方向显式可见。
- 排序偏好本地持久化。

### 11.2 Right-Click and More Menu

- 右键菜单是增强，不是唯一入口。
- 行尾 `更多` 菜单必须与右键菜单内容一致。

### 11.3 Expansion

- 展开只负责补充信息。
- 不负责主操作承接。

### 11.4 Global Command Bar

顶部只放全局动作。

不允许把页面专属的细碎操作堆进全局命令栏。

### 11.5 Feedback Levels

反馈分三级：

- `轻反馈`：Toast，用于复制成功、签到成功、刷新完成
- `中反馈`：行内状态或 CLI 抽屉内结果，用于测试与状态变更
- `强反馈`：确认弹窗，用于删除、覆盖、危险操作

### 11.6 Loading States

加载态必须贴近真实布局：

- 站点页使用列表骨架行
- CLI 页使用配置行骨架
- 统计页使用指标卡与图表骨架

禁止用空白大容器代替真实骨架。

### 11.7 Error States

- 局部错误优先局部展示。
- 单个站点失败只在该行显示状态与重试入口。
- 全局弹窗仅用于真正阻断流程的错误。

## 12. Expected Outcome

完成后，产品应具备以下体验特征：

- 所有主页面同层级，切换清晰。
- 主外壳统一，但每页内容原型明确。
- 站点页仍然高密高效，但不再是宽表头堆叠。
- 排序能力被保留且更聚焦。
- 高频动作仍然直接。
- CLI 任务域独立，认知边界清楚。
- 弹窗体系统一，整体感显著增强。

## 13. Risks and Mitigations

### Risk 1

减列后丢失快速判断能力。

Mitigation:

- 固定排序条保留核心字段。
- 主行中保留资金、能力与状态摘要。

### Risk 2

设计过度分层导致操作复杂。

Mitigation:

- 站点页保持单层高密列表。
- 展开只补充，不承接主动作。

### Risk 3

视觉统一后页面个性丢失。

Mitigation:

- 统一外壳与 overlay。
- 保留不同页面的内容原型差异。

## 14. Implementation Intent

后续实施时应优先从以下顺序落地：

1. 同层级导航与顶部命令栏
2. 站点页基础单元重构为 `site-account row`
3. 固定排序条与更多排序菜单
4. 高频 / 低频动作重新分配
5. CLI 专用抽屉
6. 统一 overlay 系统
7. 其余页面按各自原型适配
