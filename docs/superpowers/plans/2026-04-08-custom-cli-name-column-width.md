# Custom CLI Name Column Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将自定义 CLI 页左侧配置表的“名称”列从当前固定宽度 `104px` 再收窄一点，同时保持表头与数据行完全对齐。

**Architecture:** 当前左侧配置表已经把列模板集中在 `CONFIG_TABLE_GRID_CLASS` 常量中，表头和数据行都复用这一单一来源。最小改动方案是不改变表格结构、不切换回 `fr` 布局，而是把常量从 `104px` 调整为更小的固定值，并把测试里已经分裂的两处 class 断言统一到同一目标值。

**Tech Stack:** TypeScript, React, Tailwind utility classes, Vitest, Testing Library

---

### Task 1: Lock the desired narrower width in the focused regression test

**Files:**
- Modify: `src/__tests__/custom-cli-page-redesign.test.tsx`
- Test: `src/__tests__/custom-cli-page-redesign.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/__tests__/custom-cli-page-redesign.test.tsx`, update the focused left-table assertion so both the header row and the selected data row expect the same narrower target width:

```tsx
expect(tableHeader?.className).toContain(
  'grid-cols-[96px_minmax(0,1.2fr)_76px_minmax(0,1fr)]'
);

const selectedRow = screen.getByRole('row', {
  name: /Main Endpoint https:\/\/example\.com/i,
});
expect(selectedRow.className).toContain(
  'grid-cols-[96px_minmax(0,1.2fr)_76px_minmax(0,1fr)]'
);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/__tests__/custom-cli-page-redesign.test.tsx -t "renders the left table without model count and defaults to the first config in the editor"
```

Expected: `FAIL` because the page implementation still uses `CONFIG_TABLE_GRID_CLASS = 'grid-cols-[104px_minmax(0,1.2fr)_76px_minmax(0,1fr)]'`.

### Task 2: Narrow the shared grid constant with the minimal production change

**Files:**
- Modify: `src/renderer/pages/CustomCliPage.tsx`
- Test: `src/__tests__/custom-cli-page-redesign.test.tsx`

- [ ] **Step 1: Write minimal implementation**

In `src/renderer/pages/CustomCliPage.tsx`, change the single shared grid constant from `104px` to `96px`:

```tsx
const CONFIG_TABLE_GRID_CLASS = 'grid-cols-[96px_minmax(0,1.2fr)_76px_minmax(0,1fr)]';
```

Do not change:
- the number of columns
- the `BaseURL` column sizing logic
- the `CLI测试` fixed `76px` column
- the `备注` elastic `minmax(0,1fr)` column

- [ ] **Step 2: Run the focused test to verify it passes**

Run:

```bash
npm test -- src/__tests__/custom-cli-page-redesign.test.tsx -t "renders the left table without model count and defaults to the first config in the editor"
```

Expected: `PASS`

- [ ] **Step 3: Run the full page regression file**

Run:

```bash
npm test -- src/__tests__/custom-cli-page-redesign.test.tsx
```

Expected: `PASS`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/pages/CustomCliPage.tsx src/__tests__/custom-cli-page-redesign.test.tsx
git commit -m "fix(ui): narrow custom cli name column"
```

### Task 3: Verify no hidden plan drift remains in the written design artifacts

**Files:**
- Modify: `docs/superpowers/specs/2026-04-08-custom-cli-name-column-width-design.md`

- [ ] **Step 1: Correct stale implementation evidence in the spec**

Replace the stale evidence that describes the current table as:

```md
grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_76px_minmax(0,1fr)]
```

with the actual current implementation baseline:

```md
grid-cols-[104px_minmax(0,1.2fr)_76px_minmax(0,1fr)]
```

and update the design section so it explicitly states this plan narrows the existing fixed-width name column instead of switching layout modes.

- [ ] **Step 2: Run a quick consistency check**

Verify manually that:
- the spec now matches the code baseline that existed before implementation
- the plan still matches the spec after the correction
- no remaining references claim the current implementation is using `0.9fr`

Expected: spec, plan, and code history all describe the same starting point.
