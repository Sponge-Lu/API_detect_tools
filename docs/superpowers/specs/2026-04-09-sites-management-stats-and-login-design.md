# Sites Management Stats And Login Design

- Date: `2026-04-09`
- Scope: `ui-redesign-gpt54` worktree single-page UI and targeted browser-flow fix
- Product: `API_detect_tools`
- Status: `approved-for-planning`

## 1. Goal

对站点管理页进行 5 项定向调整：

- 固定站点列表列头，向下滚动站点时列名保持可见。
- 修复编辑站点中“重新获取信息”时浏览器打开后立即关闭的问题。
- 将 `总Token / 输入 / 输出` 合并为 `Token统计` 列。
- 将 `请求 / RPM / TPM` 合并为 `请求统计` 列。
- 当运行机器进入新的一天时，将今日消费、Token 统计、请求统计按本地日期归零显示。

本次设计要求维持现有站点页结构、卡片体系、多账户模型和缓存结构，不引入新的页面模式，也不做配置 schema 迁移。

## 2. Evidence Base

当前实现与证据位于：

- [src/renderer/pages/SitesPage.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/pages/SitesPage.tsx)
- [src/renderer/components/SiteListHeader/SiteListHeader.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/components/SiteListHeader/SiteListHeader.tsx)
- [src/renderer/components/SiteCard/SiteCard.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/components/SiteCard/SiteCard.tsx)
- [src/renderer/components/SiteCard/SiteCardHeader.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/components/SiteCard/SiteCardHeader.tsx)
- [src/renderer/components/SiteEditor.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/components/SiteEditor.tsx)
- [src/renderer/utils/siteSort.ts](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/utils/siteSort.ts)
- [src/renderer/hooks/useDataLoader.ts](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/hooks/useDataLoader.ts)
- [src/main/handlers/detection-handlers.ts](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/main/handlers/detection-handlers.ts)
- [src/main/handlers/token-handlers.ts](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/main/handlers/token-handlers.ts)
- [src/main/token-service.ts](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/main/token-service.ts)
- [src/main/chrome-manager.ts](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/main/chrome-manager.ts)
- [src/shared/types/site.ts](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/shared/types/site.ts)
- [src/__tests__/sites-page-redesign.test.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/__tests__/sites-page-redesign.test.tsx)

代码证据显示：

- 列头由 `SiteListHeader` 的 `ALL_COLUMNS` 控制，目前 `总 Token / 输入 / 输出 / 请求 / RPM / TPM` 仍是独立列。
- 每行统计由 `SiteCardHeader` 渲染，RPM/TPM 在前端按“当天已过分钟数”即时计算。
- `SitesPage` 中列头和卡片列表位于同一个滚动容器内，但列头本身不是 sticky。
- `launch-chrome-for-login` 使用 `ChromeManager.launchForLogin()` 打开独立 `loginBrowserState`。
- `token:initialize-site` 当前调用 `TokenService.initializeSiteAccount()`，后者默认读取普通检测浏览器 `this.browser`，没有显式走 `loginBrowserState`。
- `close-browser` 调用 `chromeManager.cleanup()`，会同时清理登录浏览器和所有检测槽位。
- 今日消费和 Token/请求统计来自缓存字段 `today_usage / today_prompt_tokens / today_completion_tokens / today_requests`，当前只按缓存直接显示，没有按 `last_refresh` 的本地日期做跨天归零。

## 3. Approved Decision

用户已确认：

- 跨天归零按运行机器的本地日期解释。
- 本次修改优先采用最小范围实现，不做配置结构扩展。

因此本次采用：

- 前端合并列与本地日期归零显示。
- 后端最小修复“登录浏览器”和“初始化读取浏览器”之间的断链。
- 不新增 `stats_date` 等持久化字段。

## 4. Design

### 4.1 Sticky Header

将站点列头保持在站点列表滚动区域顶部：

- `SiteListHeader` 增加 sticky 样式能力。
- 在 `SitesPage` 当前滚动容器内使用 `top-0`、稳定背景色和高于卡片的 `z-index`。
- 不改变列宽拖拽、批量操作按钮和当前 grid 结构。

目标是只固定“列名所在行”，而不是固定整个页面头部。

### 4.2 Token统计列

将以下三列：

- `总 Token`
- `输入`
- `输出`

合并为单列 `Token统计`。

行内展示规则：

- 第一行显示总 Token。
- 第二行以更小字号显示 `输入 / 输出`。
- 第一行视觉高度与其余主列对齐。
- 排序只使用总 Token，不使用第二行的输入/输出拆分值。

排序规则：

- `SortField` 保留 `totalTokens`。
- `promptTokens` 与 `completionTokens` 不再作为可点击列存在。
- `normalizeSiteSortField()` 继续把旧配置中的 `promptTokens` 和 `completionTokens` 归一到 `totalTokens`，保证已有排序配置兼容。

### 4.3 请求统计列

将以下三列：

- `请求`
- `RPM`
- `TPM`

合并为单列 `请求统计`。

行内展示规则：

- 第一行显示请求总数。
- 第二行以更小字号显示 `RPM / TPM`。

交互规则：

- 该列不提供排序能力。
- `rpm` 与 `tpm` 不再在列头暴露点击排序入口。
- 旧配置中的 `requests`、`rpm`、`tpm` 排序设置在进入站点页时归一为无排序，避免出现“界面不可点击但仍被隐藏排序”的状态。

### 4.4 排序一致性

当前 `sortedSites` 在多账户站点上先选一个“代表结果”再对整站排序，该代表结果目前偏向余额最大账户，不适用于 Token 排序。

调整为：

- 当按 `balance` 排序时，选余额最佳账户值。
- 当按 `todayUsage` 排序时，选今日消费最佳账户值。
- 当按 `totalTokens` 排序时，选总 Token 最佳账户值。
- 当按 `modelCount`、`lastUpdate` 等其余可排序字段时，同样按当前字段求整站的最佳排序值。
- 当没有排序字段时，保持原始站点顺序。

这样可保证多账户站点的整站排序与当前激活列一致，不会出现“列显示看起来更大，但排序位置更低”的失真。

### 4.5 本地日期归零

不修改缓存结构，直接基于本地日期和 `last_refresh` 解释“今日”数据。

归零规则：

- 若缓存 `last_refresh` 对应的本地日期不是当前本地日期，则该缓存视为昨日或更早的数据。
- 此时以下字段显示为 `0`：
  - 今日消费
  - 今日总 Token
  - 今日输入 Token
  - 今日输出 Token
  - 今日请求数
  - 基于这些值推导出的 RPM / TPM

作用范围：

- `SitesPage` 的排序值计算。
- `SiteCardHeader` 的显示值。
- 依赖这些字段的主行样式和请求统计展示。

运行中跨过午夜时，页面应自动重算。现有 `useDateString()` 已提供“日期变化触发重渲染”的能力，本次将其扩展到站点页统计派生逻辑，而不是只用于“最后更新时间”文案。

### 4.6 重新获取信息的浏览器复用修复

根因：

- `launchChromeForLogin()` 打开的是独立登录浏览器 `loginBrowserState`。
- `initializeSiteAccount()` 当前读取的是普通检测浏览器 `this.browser`，两者断开。
- 初始化失败时又会走 `forceCleanup()`，把登录浏览器一起清掉，表现为“浏览器刚打开就关闭”。

修复策略：

- 让 `token:initialize-site` 显式走登录浏览器模式。
- `initializeSiteAccount()` 在“编辑站点重新获取信息”场景下，读取 `loginBrowserState` 的页面、Cookie、localStorage，并在该页面上下文中继续等待登录和创建 access token。
- 只在当前登录流程结束或用户取消时清理登录浏览器，不误清理检测槽位。

本次不改变：

- 普通站点检测对多槽位浏览器池的使用方式。
- `detect-site`、`detect-all-sites`、签到复用页等现有检测流程。

### 4.7 关闭浏览器的边界

当前 `close-browser` 会调用 `chromeManager.cleanup()`，它会同时清理登录浏览器和所有检测槽位。

为了避免编辑站点保存后误关其它正在运行的检测浏览器，本次将关闭语义收敛为：

- 编辑站点流程只关闭登录浏览器。
- 普通检测浏览器仍由引用计数与既有清理逻辑管理。

实现上允许采用以下任一等价方式：

- 新增只关闭登录浏览器的 IPC。
- 或在现有关闭入口上增加“仅登录浏览器”参数。

设计要求是“编辑站点保存后不应清理全部浏览器池”。

## 5. Scope

本次允许修改：

- [src/renderer/pages/SitesPage.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/pages/SitesPage.tsx)
- [src/renderer/components/SiteListHeader/SiteListHeader.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/components/SiteListHeader/SiteListHeader.tsx)
- [src/renderer/components/SiteCard/SiteCard.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/components/SiteCard/SiteCard.tsx)
- [src/renderer/components/SiteCard/SiteCardHeader.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/components/SiteCard/SiteCardHeader.tsx)
- [src/renderer/components/SiteEditor.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/components/SiteEditor.tsx)
- [src/renderer/store/uiStore.ts](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/store/uiStore.ts)
- [src/renderer/utils/siteSort.ts](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/utils/siteSort.ts)
- [src/main/handlers/detection-handlers.ts](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/main/handlers/detection-handlers.ts)
- [src/main/handlers/token-handlers.ts](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/main/handlers/token-handlers.ts)
- [src/main/token-service.ts](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/main/token-service.ts)
- [src/main/chrome-manager.ts](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/main/chrome-manager.ts)
- 相关测试文件

本次不修改：

- 配置文件 schema
- 站点页以外的整体布局
- 站点检测 API 逻辑本身
- 多账户数据模型
- 路由统计、积分页、CLI 页面

## 6. Risks and Constraints

- Sticky 列头如果缺少背景色或层级控制，会与卡片半透明样式叠色，影响可读性。
- 合并列会改变默认列宽分布，需同步校正测试中的 grid 断言。
- 多账户排序若仍沿用“余额代表整站”的旧逻辑，会导致 Token 排序错误。
- 跨天归零只影响显示和排序解释，不回写缓存；因此配置文件中仍会保留昨天最后一次真实检测值。
- 登录浏览器和检测浏览器共用关闭入口时容易互相误伤，必须收敛关闭粒度。

## 7. Verification Plan

测试与验证应覆盖：

- `SiteListHeader` 列头文本、可排序列和不可排序列断言更新。
- `SiteCardHeader` 中 `Token统计` 两行展示和 `请求统计` 两行展示。
- Sticky 列头存在对应 class 或属性断言。
- 多账户按 `totalTokens` 排序时取当前字段最佳值，而非余额最佳值。
- 跨天后 `todayUsage / todayTotalTokens / todayRequests / rpm / tpm` 显示为 0。
- 编辑站点“重新获取信息”流程调用时，初始化读取登录浏览器而不是普通检测浏览器。
- 保存后只关闭登录浏览器，不清空整个浏览器池。

验证命令在实现阶段至少应包括与站点页相关的 Vitest 测试。

## 8. Acceptance Criteria

完成后应满足：

- 站点页列头在站点列表滚动时保持固定。
- `Token统计` 列替代原 `总Token / 输入 / 输出` 三列。
- `请求统计` 列替代原 `请求 / RPM / TPM` 三列，且该列不可排序。
- `Token统计` 的排序仅按总 Token。
- 多账户站点在按总 Token 排序时顺序正确。
- 本地日期跨天后，今日消费、Token统计、请求统计自动归零显示。
- 编辑站点中点击“重新获取信息”时浏览器不会立即被关闭。
- 编辑站点保存后的关闭动作不会误清理其它检测浏览器。
