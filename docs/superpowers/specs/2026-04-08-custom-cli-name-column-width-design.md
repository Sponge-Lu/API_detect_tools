# Custom CLI Name Column Width Design

- Date: `2026-04-08`
- Scope: `ui-redesign-gpt54` worktree single-page UI adjustment
- Product: `API_detect_tools`
- Status: `approved-for-planning`

## 1. Goal

将自定义 CLI 页左侧配置表中的“名称”列宽度调小一点，保留当前四列表格结构、信息顺序和交互行为不变。

本次调整的目标是：

- 让“名称”列占比略小于当前实现。
- 给 `BaseURL` 列释放更多横向空间。
- 不改变 `CLI测试` 与 `备注` 列的含义和展示方式。
- 不引入新的表格组件、样式层或布局模式。

## 2. Evidence Base

当前实现位于：

- [src/renderer/pages/CustomCliPage.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/pages/CustomCliPage.tsx)

代码证据显示，表头和数据行目前共用同一套 grid 列模板：

- `grid-cols-[104px_minmax(0,1.2fr)_76px_minmax(0,1fr)]`

该模板分别出现在：

- 配置表头
- 配置数据行

测试证据位于：

- [src/__tests__/custom-cli-page-redesign.test.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/__tests__/custom-cli-page-redesign.test.tsx)

现有测试明确断言了上述 class 字符串，因此列模板修改必须同步更新测试。

## 3. Approved Decision

用户已确认在当前固定宽度方案上继续微调：

- 将“名称”列从 `104px` 收窄到 `96px`。
- 保持其余三列逻辑不变。
- 表头与数据行继续复用同一套列模板。

未采纳方案：

- 不切换回 `fr` 比例布局。
- 不允许只改表头不改数据行。

## 4. Design

### 4.1 Layout Change

将左侧配置表的列模板从：

- `grid-cols-[104px_minmax(0,1.2fr)_76px_minmax(0,1fr)]`

调整为：

- `grid-cols-[96px_minmax(0,1.2fr)_76px_minmax(0,1fr)]`

该调整只收窄现有固定宽度“名称”列，同时保持：

- `BaseURL` 仍为主信息列。
- `CLI测试` 仍保持固定宽度。
- `备注` 仍保留弹性空间。

### 4.2 Scope

仅修改以下内容：

- [src/renderer/pages/CustomCliPage.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/renderer/pages/CustomCliPage.tsx) 中左侧配置表表头与数据行的列模板
- [src/__tests__/custom-cli-page-redesign.test.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/__tests__/custom-cli-page-redesign.test.tsx) 中对应 class 断言

不修改：

- 右侧配置编辑区
- CLI 配置区
- CLI 测试区
- 其它页面或共享表格组件

## 5. Risks and Constraints

- 若“名称”列收窄过多，长名称会更早触发截断。
- 由于当前实现使用 `truncate`，视觉影响主要体现在可见字符数量，而不会导致换行破版。
- 表头与数据行必须保持完全一致的列模板，否则会出现列对不齐。

## 6. Verification Plan

验证方式：

- 更新并运行 [src/__tests__/custom-cli-page-redesign.test.tsx](/D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54/src/__tests__/custom-cli-page-redesign.test.tsx) 的相关测试。
- 确认“名称 / BaseURL / CLI测试 / 备注”四列仍正常渲染。
- 确认测试断言与实现一致。

## 7. Acceptance Criteria

完成后应满足：

- 左侧配置表“名称”列宽度比当前略小。
- 表头与数据行列对齐。
- `BaseURL` 列获得相应更多空间。
- 现有页面结构和行为不变。
- 对应测试通过。
