# API Hub Visual Refresh Design

- Date: `2026-04-01`
- Scope: `ui-redesign-gpt54` worktree visual refinement
- Product: `API_detect_tools`
- Status: `approved-for-planning`

## 1. Goal

本轮不是再次重做信息架构，而是在已经落地的新 UI 结构上，彻底移除残留的旧 iOS 视觉语言，并把全应用统一到同一套新的产品级设计语义中。

本轮设计需要同时满足以下条件：

- 保持现有主页面层级、页面原型和整体布局框架，不做第二次大重构。
- 所有 UI 相关内容都必须脱离旧 iOS 风格，包括命名、颜色变量、组件语义、文档描述和测试表述。
- 页面 Header 必须简洁、紧凑、占地小，不能再使用“工作台式大头部”。
- `Light A` 作为默认浅色主题。
- `CLI` 图标继续使用现有 Logo 资产表达，不改成文字缩写，也不改变其原有品牌色。
- overlay family 当前方向成立，仅做与新设计系统一致性的替换，不再额外扩大结构改动。

## 2. Evidence Base

本设计基于当前 worktree 中已经存在的新结构和仍未清理的旧视觉语义：

- [src/renderer/index.css](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/index.css) 仍以“iOS 设计系统变量”为核心描述和实现入口。
- [src/renderer/components/AppShell/GlobalCommandBar.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/components/AppShell/GlobalCommandBar.tsx) 仍直接依赖 `--ios-*` 变量，并继续使用 `IOSButton`。
- [src/renderer/components/AppShell/PageHeader.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/components/AppShell/PageHeader.tsx) 仍使用 iOS 变量，但页面头部本身已经趋向可压缩的简洁结构。
- [src/renderer/pages/SitesPage.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/pages/SitesPage.tsx) 仍在页面级组合中使用 `IOSButton`、`IOSTableBody` 等旧命名组件。
- [src/renderer/pages/CustomCliPage.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/pages/CustomCliPage.tsx) 已具备注册表 + inspector 的新原型，但内部样式仍明显沿用旧 token 体系。
- [src/renderer/components/dialogs/UnifiedCliConfigDialog.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/components/dialogs/UnifiedCliConfigDialog.tsx) 仍保留 `IOSButton`、`IOSToggle` 和大量 `--ios-*` 依赖。
- [src/shared/theme/themePresets.ts](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/shared/theme/themePresets.ts) 已建立 `Light A / Light B / Light C / Dark` 四主题基础预设，因此视觉统一应继续基于该方向扩展，而不是回退到旧 `light / dark / system` 语义。
- [docs/ui-preview.html](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/docs/ui-preview.html) 已作为本轮确认用的 HTML 预览稿，承载默认主题、Header 密度、页面气质和 overlay family 的直观确认。

结论：

- 当前问题不是某几个页面的小配色问题，而是“新结构 + 旧视觉语义”并存。
- 当前最优策略不是再次推翻布局，而是先完成一次系统性的去 iOS 化和语义统一。
- 页面 Header 的压缩和统一，是本轮最重要的全局视觉收敛点之一。

## 3. Approved Decisions

用户已确认以下结论：

1. 页面 Header 需要简洁且占地小。
2. `Light A` 为默认浅色主题。
3. 各页面整体布局本轮不重做，只做微调。
4. overlay family 当前方向已经可以，不需要再做新的结构探索。
5. `CLI` 图标必须使用现有 Logo，而不是文字占位。

## 4. Visual Direction

### 4.1 Tone

整体气质继续保持：

- 高级
- 克制
- 冷静
- 工具型
- 高密但不躁动

但需要进一步收敛掉仍带有旧 iOS 感的部分：

- 果冻感圆角
- 蓝色消费级高亮
- 强毛玻璃表面
- “组件像单独设计系统拼进来”的语义割裂

### 4.2 Core Visual Rules

- 不使用渐变。
- 继续采用低饱和度主题体系。
- 通过表面层级、文字粗细和留白建立结构，不靠重描边或高纯度强调色。
- 行为反馈以轻微明度变化为主，不使用强烈发光、厚阴影和高彩 hover。
- 保持桌面工具产品的高信息密度，不用大留白模拟“高级感”。

## 5. Theme System

### 5.1 Default Theme

默认主题固定为 `Light A`。

`Light A` 需要承担基准主题职责：

- 暖灰纸面背景
- 石色面板层级
- 苔灰 / 灰绿方向的克制强调
- 稳定、低噪声的工具感

### 5.2 Other Themes

- `Light B`：更偏冷灰矿物感，保持理性技术氛围。
- `Light C`：更偏中性工作室气质，但不能变成普通白底后台。
- `Dark`：统一石墨暗色，继续保持和浅色主题相同的结构语言。

### 5.3 Theme Constraints

- 四主题共享同一套语义 token、组件层级和布局。
- 主题切换不允许改变 Header 结构、站点页信息密度、按钮位置或 overlay 家族结构。
- `CLI` 图标作为品牌资产例外，保留现有 Logo 及颜色。

## 6. Global Shell

### 6.1 Global Command Bar

全局命令栏保留，但应继续压缩为薄工具条。

目标：

- 承担全局搜索
- 展示保存状态
- 展示更新状态
- 承担全局级动作，如下载更新

要求：

- 高度控制在紧凑工具条级别
- 不承担页面级筛选、分区说明或二级导航
- 视觉上更接近稳定的产品顶栏，而不是带有旧 iOS 玻璃感的“装饰层”

### 6.2 Page Header

页面 Header 为本轮重点收敛对象。

统一目标：

- 高度小
- 结构清晰
- 不制造额外视觉噪音

统一内容：

- 页面标题
- 一行简短说明
- 页面专属动作

明确禁止：

- 工作台式大头部
- 大面积说明块
- KPI 条带塞进 Header
- 页头与内容区重复表达同一层信息

页面内筛选、统计带、局部工具条，全部回归内容区。

## 7. Page-Level Direction

### 7.1 Sites Page

- 保留当前站点页作为高密效率锚点。
- 排序条、筛选、分组和主行高频动作继续留在内容区。
- 页头仅表达“站点管理”身份，不再承担工作台导语。

### 7.2 Custom CLI Page

- 保留 `配置注册表 + inspector` 原型。
- 不重新发明页面骨架，只做字体、背景、按钮、图标承载方式和密度微调。
- `CLI` 相关按钮、状态和入口必须使用现有 Logo 资产呈现，而不是字母替代。

### 7.3 Route Pages

适用于：

- 模型重定向
- CLI 可用性
- 代理统计

要求：

- 保留各自页面原型
- 不做第二次布局重排
- 统一页头语言、分区间距、局部标题样式和控件气质

### 7.4 Settings

- 继续保持单页分区表单结构。
- 主题选择区要直接表达四主题体系，且默认突出 `Light A`。

## 8. Component System Changes

### 8.1 Naming

所有仍带有 `IOS` 前缀或 “iOS 风格” 描述的 UI 相关对象，都应改为新的产品级中性命名。

包括但不限于：

- `IOSButton`
- `IOSModal`
- `IOSToggle`
- `IOSTable`
- 相关测试名
- 相关文档章节标题和描述

### 8.2 Tokens

应逐步移除 `--ios-*` 变量依赖，替换为新的语义 token，例如：

- `--app-bg`
- `--surface-*`
- `--text-*`
- `--accent`
- `--line-*`
- `--overlay-mask`

命名不必严格与本设计稿完全一致，但必须满足“中性、产品级、非 iOS 专属”。

### 8.3 Buttons and Inputs

- 按钮统一为新的紧凑工具产品语气。
- 主按钮强调依赖低饱和 accent，不使用旧蓝色体系。
- 次级按钮通过表面差和细线区分，不使用强烈 hover 涂抹。
- 输入框背景和边界应与当前四主题表面层级一致，避免旧 iOS 输入框质感。

## 9. Overlay Family

overlay family 结构已确认可继续沿用：

- 确认弹窗
- 编辑弹窗 / 编辑抽屉
- CLI 工作抽屉

本轮只做以下统一：

- 标题栏、正文区、底部操作区的视觉语义统一到新 token
- 关闭按钮、危险按钮、次要按钮统一到新的按钮语言
- 去掉旧 iOS 风格相关说明、变量和命名

本轮不再引入新的 overlay 原型。

## 10. Non-Goals

本轮不包含：

- 不再次推翻各页面整体布局。
- 不重新定义站点页信息架构。
- 不新增业务功能或 IPC 逻辑。
- 不改变 CLI 图标品牌色和 Logo 资产。
- 不做新的“工作台页头”方案探索。

## 11. Implementation Intent

实施顺序应为：

1. 先清理全局 token 和全局文案语义。
2. 再替换全局命令栏与页面 Header 的视觉语言。
3. 再替换共享 UI 组件命名与样式依赖。
4. 再对各页面做微调以消除突兀的字体、图标、按钮、背景层级。
5. 最后统一测试和文档中关于旧 iOS 设计的表述。

## 12. Acceptance Criteria

完成后应满足：

- 不再存在旧 iOS 设计语义作为产品主语言。
- 默认主题为 `Light A`。
- 页面 Header 全部简洁、紧凑、占地小。
- 页面整体布局框架保持稳定，仅做微调。
- `CLI` 图标使用现有 Logo，而不是文字替代。
- overlay family 保持统一且与新设计系统一致。

