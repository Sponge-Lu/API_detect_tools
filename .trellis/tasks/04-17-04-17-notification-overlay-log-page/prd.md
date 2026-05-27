# brainstorm: notification overlay limits and log page

## Goal

解决当前顶部通知弹窗在高频场景下遮挡主界面的问题，尤其是长错误信息会覆盖右半边应用区域；同时评估并设计一个“日志页”，用于集中查看应用操作与通知信息，降低仅靠瞬时 toast 反馈带来的可见性与可追溯性不足。

## What I already know

* 用户提供的截图 `docs/picture/11.PNG` 显示：多个通知会在窗口顶部中央纵向堆叠，长文本错误会明显遮挡右侧主内容。
* 当前 Toast UI 在 `src/renderer/components/Toast/Toast.tsx` 中实现，容器固定在顶部中央，所有 toast 全量渲染；单条消息没有长度/高度限制，也没有“最多显示几条”的约束。
* 当前 Toast 状态在 `src/renderer/store/toastStore.ts` 中实现，只有 `toasts` 当前队列，没有历史记录、数量上限、去重策略或折叠策略。
* 当前一级页面导航由 `src/renderer/store/uiStore.ts`、`src/renderer/components/AppShell/pageMeta.ts`、`src/renderer/components/Sidebar/VerticalSidebar.tsx` 和 `src/renderer/App.tsx` 共同定义；现有可见页面只有 `sites / cli / usability / route / settings`，没有日志页。
* 主进程日志在 `src/main/utils/logger.ts` 中已经通过 `electron-log` 写入 `userData/logs/main.log`；但当前 `src/main/preload.ts` 没有暴露任何“读取日志”的 IPC。
* 渲染进程日志在 `src/renderer/utils/logger.ts` 中仅输出到控制台，没有持久化，也没有现成的日志页数据源。
* 仓库中存在大量 `toast.success/error/warning/info(...)` 调用点，说明通知系统已经是广泛复用的全局反馈机制，适合作为日志页的一个数据来源。

## Assumptions (temporary)

* 这是一个中等复杂度任务：会影响全局通知体验、导航结构和至少一个新的页面/状态层。
* “日志页”本轮 MVP 的目标更偏向“应用操作与通知可回看”，不一定等同于完整的调试日志查看器。
* 当前最需要先解决的是 UI 遮挡与可追踪性，而不是构建一个完整的统一日志基础设施。

## Open Questions

* 无

## Requirements (evolving)

* Toast 通知在高频与长文本场景下不能遮挡大面积主内容。
* Toast 需要有明确的数量上限与尺寸上限。
* Toast MVP 方案固定为：
  * 屏幕上最多同时显示 3 条 toast。
  * 单条 toast 文本最多显示 2 行，超出部分截断。
  * 详细内容不在 toast 内展开，统一由日志页承接。
* 应用内需要新增一个可进入的日志页，用于查看当前会话内的通知与关键操作信息。
* 新能力应尽量复用现有 toast / sidebar / page meta / store 模式，而不是引入与现有结构完全不同的页面机制。
* 本轮不接入主进程 `main.log`，不新增主进程日志读取 IPC。
* 日志页至少覆盖两类会话内事件：
  * 所有 toast 通知
  * 关键操作事件，如保存、删除、检测、刷新、CLI 测试、路由相关关键动作

## Acceptance Criteria (evolving)

* [ ] 当短时间内连续出现多条通知时，屏幕上同时展示的通知数量最多为 3 条，不再纵向堆满右侧内容区。
* [ ] 当通知内容很长时，单条通知最多显示 2 行文本，超出内容被截断，不再覆盖大面积页面主体。
* [ ] Toast 本身不提供展开全文能力；用户可通过日志页查看完整内容。
* [ ] 用户可以从一级导航进入日志页。
* [ ] 日志页至少能看到当前会话内的最近通知和关键操作记录，并能区分状态类型（如 success / warning / error / info）。
* [ ] 关键操作记录至少覆盖保存、删除、检测/刷新、CLI 测试、路由操作这些高频且对诊断有价值的动作。

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 完整的跨主进程/渲染进程统一可检索审计系统
* 远程日志上传、导出、同步
* 本轮未确认前，不默认加入复杂筛选、全文检索、日志下载等高级能力
* 读取或展示主进程 `userData/logs/main.log`

## Technical Notes

* 相关 UI 入口和结构：
  * `src/renderer/components/Toast/Toast.tsx`
  * `src/renderer/store/toastStore.ts`
  * `src/renderer/store/uiStore.ts`
  * `src/renderer/components/AppShell/pageMeta.ts`
  * `src/renderer/components/Sidebar/VerticalSidebar.tsx`
  * `src/renderer/App.tsx`
* 现有主进程日志能力：
  * `src/main/utils/logger.ts` 已有文件持久化能力，但前端暂无读取接口。
* 现有共享日志工具：
  * `src/shared/utils/log-filter.ts` 当前是“模型调用日志聚合”工具，不是通用的日志脱敏/格式化器；如果日志页直接读 `main.log`，还需要额外处理敏感信息暴露风险。
* 现有文档存在轻微漂移：
  * `src/renderer/store/FOLDER_INDEX.md` 提到 `toastStore.ts` 的能力比真实实现更丰富；落地时应以实际代码为准并同步文档。

## Feasible Approaches Here

**Approach A: 会话内事件中心** (最小实现)

* How it works:
  * 限制 toast 可见数量和单条尺寸：最多 3 条、每条最多 2 行、超出截断。
  * `toastStore` 同时维护“当前可见通知 + 有界历史记录”。
  * 在关键 UI 操作处记录结构化事件，日志页读取这份会话内历史。
* Pros:
  * 改动集中在 renderer，风险低。
  * 不暴露主进程原始日志，安全边界更清晰。
  * 很适合解决“通知消失后无处查看”的核心问题。
* Cons:
  * 重启后历史丢失。
  * 无法覆盖主进程级报错与底层运行日志。

**Approach B: 会话内事件中心 + 主进程日志查看** (扩展型)

* How it works:
  * 包含 Approach A。
  * 新增 IPC，让日志页可读取并展示 `main.log` 的尾部内容。
* Pros:
  * 对排障更有价值，尤其是主进程异常和后台任务失败。
  * 用户能在应用内查看实际运行日志。
* Cons:
  * 需要新增日志读取、分页/截断、敏感信息过滤规则。
  * 会出现“结构化操作记录”和“原始日志行”两类数据并存的设计问题。

**Approach C: 统一持久化事件流** (完整方案)

* How it works:
  * 新建结构化日志存储，把 toast、操作事件、主进程关键事件统一落地，再由日志页读取。
* Pros:
  * 长期最一致，后续可扩展筛选、搜索、导出。
* Cons:
  * 范围明显扩大，不适合当前以遮挡修复为起点的 MVP。

## Decision (ADR-lite)

**Context**: 需要先控制实现范围，优先解决 toast 遮挡和“通知消失后不可回看”的问题。
**Decision**: 采用 **Approach A: 会话内事件中心**。toast 固定为“最多 3 条、每条最多 2 行、超出截断、不在 toast 内展开全文”；在 renderer 内维护有界事件历史；新增一级“日志页”读取当前会话事件；日志范围包含 toast 通知与关键操作，不追求完整 UI 操作流。
**Consequences**: 实现范围可控，风险低，能直接解决当前 UX 痛点；toast 遮挡问题可以被稳定压住；日志页对排障比“仅通知历史”更有价值；但重启后历史丢失，也暂不覆盖主进程底层日志。

## Technical Approach

* 扩展 `toastStore`：
  * 保留当前可见 toast 队列。
  * 增加会话内事件历史（有界长度）与统一的事件写入方法。
  * 所有 `toast.*` 调用默认写入通知历史。
* 新增日志页：
  * 在 `uiStore.ts`、`pageMeta.ts`、`VerticalSidebar.tsx`、`App.tsx` 中注册新的一级 tab。
  * 页面展示当前会话的通知与关键操作，按时间倒序显示，并带类型标记。
* 关键操作埋点：
  * 优先覆盖保存、删除、检测/刷新、CLI 测试、路由操作。
  * 沿用现有页面/Hook 中已存在的成功失败处理点，避免额外引入横切框架。
* UI 约束：
  * `ToastContainer` 仅渲染最近 3 条可见通知。
  * 单条消息使用固定宽度/最大宽度与 2 行截断样式。

## Implementation Plan (small PRs)

* PR1: 扩展 toast store 为“可见通知 + 会话事件历史”，并限制 toast 的数量与尺寸；补充 store / toast 组件测试。
* PR2: 新增日志页与侧边栏入口，接入通知历史展示。
* PR3: 在关键操作流中补埋点，并补充页面级/交互级测试与索引文档更新。
