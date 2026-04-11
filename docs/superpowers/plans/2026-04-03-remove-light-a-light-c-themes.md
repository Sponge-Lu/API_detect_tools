# Remove Light A / Light C Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 `light-a` 与 `light-c` 主题，只保留 `light-b` 和 `dark`，并把历史主题值统一迁移到 `light-b`。

**Architecture:** 主题删除只发生在共享主题预设层、首屏主题注入脚本、设置页主题选择器和测试约束层。主进程与渲染进程继续通过 `normalizeThemeMode()` 共享同一套归一化逻辑，不新增新的主题抽象。

**Tech Stack:** TypeScript, React, Electron, Vitest, shared theme presets

---

### Task 1: Lock failing tests before deleting themes

**Files:**
- Modify: `src/__tests__/theme-system-redesign.test.tsx`
- Modify: `src/__tests__/theme-token-contract.property.test.tsx`
- Modify: `src/__tests__/theme-visual-consistency.test.tsx`

- [ ] **Step 1: Write the failing test**

Add assertions that:
- legacy values `light`, `system`, `light-a`, `light-c` normalize to `light-b`
- theme preset coverage only includes `light-b` and `dark`
- static CSS no longer contains `html[data-theme='light-c']`

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c node --max-old-space-size=16384 ..\\..\\node_modules\\vitest\\vitest.mjs run src\\__tests__\\theme-system-redesign.test.tsx src\\__tests__\\theme-token-contract.property.test.tsx src\\__tests__\\theme-visual-consistency.test.tsx`

Expected: FAIL because current implementation still exposes `light-a` / `light-c`.

### Task 2: Remove theme definitions and migration branches

**Files:**
- Modify: `src/shared/theme/themePresets.ts`
- Modify: `src/renderer/index.css`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/components/SettingsPanel.tsx`
- Modify: `src/shared/theme/FOLDER_INDEX.md`

- [ ] **Step 1: Write minimal implementation**

Change:
- `ThemeMode` to `light-b | dark`
- `DEFAULT_LIGHT_THEME` to `light-b`
- preset list to only `light-b` / `dark`
- CSS theme blocks to only default `:root`, `html[data-theme='light-b']` if needed, and `html[data-theme='dark']`
- bootstrap theme script to default and migrate to `light-b`
- settings theme icon map and picker to only render remaining themes

- [ ] **Step 2: Run focused tests to verify it passes**

Run: `cmd /c node --max-old-space-size=16384 ..\\..\\node_modules\\vitest\\vitest.mjs run src\\__tests__\\theme-system-redesign.test.tsx src\\__tests__\\theme-token-contract.property.test.tsx src\\__tests__\\theme-visual-consistency.test.tsx`

Expected: PASS

### Task 3: Verify downstream UI still works with the reduced theme set

**Files:**
- Modify: `src/__tests__/app-shell-redesign.test.tsx`

- [ ] **Step 1: Update stale mocks if they still use `light-a`**

Switch test fixtures or hook mocks to `light-b`.

- [ ] **Step 2: Run integration regression**

Run: `cmd /c node --max-old-space-size=16384 ..\\..\\node_modules\\vitest\\vitest.mjs run src\\__tests__\\app-shell-redesign.test.tsx src\\__tests__\\design-system-accessibility.property.test.tsx`

Expected: PASS
