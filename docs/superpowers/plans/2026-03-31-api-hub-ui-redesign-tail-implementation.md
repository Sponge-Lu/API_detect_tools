# API Hub UI Redesign Tail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the approved API Hub renderer redesign by removing the remaining card-wall and route-page inconsistencies, then verify the new UI end-to-end.

**Architecture:** Reuse the already-landed shell, theme system, and overlay family. Convert `CustomCliPage` into a dense registry-plus-inspector workbench, introduce a small shared route-page workbench rhythm without changing route business logic, and close the remaining sites-page parity gap by making right-click actions mirror the row more-menu actions.

**Tech Stack:** React, TypeScript, Zustand, Vitest, React Testing Library, Electron renderer IPC APIs, existing overlay components

---

## File Structure

**Reference Files:**
- `docs/superpowers/specs/2026-03-31-api-hub-ui-redesign-design.md`
- `src/renderer/App.tsx`
- `src/renderer/pages/CustomCliPage.tsx`
- `src/renderer/components/dialogs/CustomCliConfigEditorDialog.tsx`
- `src/renderer/store/customCliConfigStore.ts`
- `src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx`
- `src/renderer/components/Route/Usability/CliUsabilityTab.tsx`
- `src/renderer/components/Route/ProxyStats/ProxyStatsTab.tsx`
- `src/renderer/components/SiteCard/SiteCard.tsx`
- `src/renderer/components/SiteCard/SiteCardActions.tsx`

**Tests To Add Or Update:**
- `src/__tests__/custom-cli-page-redesign.test.tsx`
- `src/__tests__/route-workbench-redesign.test.tsx`
- `src/__tests__/sites-page-redesign.test.tsx`

**Docs To Update If Files Change:**
- `PROJECT_INDEX.md`
- `src/__tests__/FOLDER_INDEX.md`
- `src/renderer/components/FOLDER_INDEX.md`
- `src/renderer/components/SiteCard/FOLDER_INDEX.md`

## Task 1: Lock the Remaining Spec With Failing UI Tests

**Files:**
- Create: `src/__tests__/custom-cli-page-redesign.test.tsx`
- Create: `src/__tests__/route-workbench-redesign.test.tsx`
- Modify: `src/__tests__/sites-page-redesign.test.tsx`

- [ ] **Step 1: Write the failing Custom CLI page test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CustomCliPage } from '../renderer/pages/CustomCliPage';

vi.mock('../renderer/store/customCliConfigStore', () => ({
  useCustomCliConfigStore: () => ({
    configs: [
      {
        id: 'cfg-1',
        name: 'Main Endpoint',
        baseUrl: 'https://example.com',
        apiKey: 'sk-test',
        models: ['claude-3-5-sonnet', 'gpt-4.1'],
        notes: 'alpha',
        cliSettings: {
          claudeCode: { enabled: true, model: 'claude-3-5-sonnet', testModels: [] },
          codex: { enabled: true, model: 'gpt-4.1', testModels: [] },
          geminiCli: { enabled: false, model: null, testModels: [] },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'cfg-2',
        name: 'Backup Endpoint',
        baseUrl: 'https://backup.example.com',
        apiKey: 'sk-backup',
        models: ['gemini-2.5-pro'],
        notes: '',
        cliSettings: {
          claudeCode: { enabled: false, model: null, testModels: [] },
          codex: { enabled: false, model: null, testModels: [] },
          geminiCli: { enabled: true, model: 'gemini-2.5-pro', testModels: [] },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    loading: false,
    loadConfigs: vi.fn(),
    addConfig: vi.fn(),
    deleteConfig: vi.fn(),
  }),
}));

vi.mock('../renderer/store/detectionStore', () => ({
  useDetectionStore: () => ({
    clearCliConfigDetection: vi.fn(),
    detectCliConfig: vi.fn(),
  }),
}));

vi.mock('../renderer/store/configStore', () => ({
  useConfigStore: () => ({
    config: { sites: [] },
  }),
}));

vi.mock('../renderer/components/dialogs/CustomCliConfigEditorDialog', () => ({
  CustomCliConfigEditorDialog: () => <div>Mock Custom CLI Editor</div>,
}));

describe('Custom CLI page redesign', () => {
  it('renders a registry-first workbench with a selected inspector instead of a card wall', () => {
    render(<CustomCliPage />);

    expect(screen.getByText('配置注册表')).toBeInTheDocument();
    expect(screen.getByText('工作区')).toBeInTheDocument();
    expect(screen.getByText('Main Endpoint')).toBeInTheDocument();
    expect(screen.getByText('Backup Endpoint')).toBeInTheDocument();
    expect(screen.getByText('https://example.com')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the Custom CLI page test to verify it fails**

Run: `npm test -- src/__tests__/custom-cli-page-redesign.test.tsx`

Expected: FAIL because `CustomCliPage` still renders the old card-wall layout and does not expose `配置注册表` / `工作区`.

- [ ] **Step 3: Write the failing route workbench test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelRedirectionTab } from '../renderer/components/Route/Redirection/ModelRedirectionTab';
import { CliUsabilityTab } from '../renderer/components/Route/Usability/CliUsabilityTab';
import { ProxyStatsTab } from '../renderer/components/Route/ProxyStats/ProxyStatsTab';

vi.mock('../renderer/store/routeStore', () => ({
  useRouteStore: (selector: any) =>
    selector({
      config: {
        modelRegistry: {
          entries: {
            'claude-3-5-sonnet': {
              vendor: 'claude',
              canonicalName: 'claude-3-5-sonnet',
              aliases: ['claude-sonnet'],
              sources: [],
              hasOverride: false,
            },
          },
        },
        cliProbe: { config: { enabled: true, intervalMinutes: 60 } },
        cliModelSelections: { claudeCode: 'claude-3-5-sonnet', codex: null, geminiCli: null },
        server: { host: '127.0.0.1', port: 3000, unifiedApiKey: 'route-key' },
      },
      loading: false,
      cliProbeView: [],
      cliProbeTimeRange: '24h',
      cliProbeLoaded: true,
      cliProbeError: null,
      serverRunning: true,
      rebuildModelRegistry: vi.fn(),
      fetchCliProbeData: vi.fn(),
      runProbeNow: vi.fn(),
      saveCliProbeConfig: vi.fn(),
      saveCliModelSelections: vi.fn(),
      saveServerConfig: vi.fn(),
      regenerateApiKey: vi.fn(),
      startServer: vi.fn(),
      stopServer: vi.fn(),
    }),
}));

describe('Route workbench redesign', () => {
  it('gives each route tab a shared workbench header rhythm', () => {
    render(
      <>
        <ModelRedirectionTab />
        <CliUsabilityTab />
        <ProxyStatsTab />
      </>
    );

    expect(screen.getAllByText('工作台视图').length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 4: Run the route workbench test to verify it fails**

Run: `npm test -- src/__tests__/route-workbench-redesign.test.tsx`

Expected: FAIL because the route tabs do not yet render a shared workbench header language.

- [ ] **Step 5: Extend the existing sites redesign test with right-click parity and verify it fails**

Add this test to `src/__tests__/sites-page-redesign.test.tsx`:

```tsx
it('opens the same low-frequency actions from row context menu parity', () => {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const onAddAccount = vi.fn();

  render(
    <SiteCardActions
      site={baseSite}
      index={0}
      siteResult={{ status: '成功' } as any}
      isExpanded={false}
      isDetecting={false}
      checkingIn={null}
      autoRefreshEnabled={false}
      editAccount={null}
      onExpand={vi.fn()}
      onDetect={vi.fn()}
      onEdit={onEdit}
      onDelete={onDelete}
      onCheckIn={vi.fn()}
      onOpenExtraLink={vi.fn()}
      onToggleAutoRefresh={vi.fn()}
      onAddAccount={onAddAccount}
    />
  );

  fireEvent.contextMenu(screen.getByRole('button', { name: '更多操作' }));

  expect(screen.getByRole('button', { name: '编辑站点' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '删除站点' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '添加账户' })).toBeInTheDocument();
});
```

Run: `npm test -- src/__tests__/sites-page-redesign.test.tsx`

Expected: FAIL because the component currently supports the row more-menu only, not a right-click parity menu.

## Task 2: Rebuild `CustomCliPage` as a Registry + Workbench

**Files:**
- Modify: `src/renderer/pages/CustomCliPage.tsx`
- Modify: `src/__tests__/custom-cli-page-redesign.test.tsx`

- [ ] **Step 1: Replace the page-level card wall with a three-part workbench shell**

Implement a structure with:
- top summary band with `配置总数 / 活跃 CLI 数 / 已映射模型数`
- left/center registry titled `配置注册表`
- right inspector titled `工作区`

Use the existing store data only; do not add new persistence or IPC.

- [ ] **Step 2: Keep registry rows dense and selection-based**

Each row should expose:
- configuration name
- base URL
- enabled CLI summary
- model count
- updated time
- quick actions for `编辑 / 应用 / 删除`

Selection should switch the right-side inspector without opening a new route or subpage.

- [ ] **Step 3: Reuse the existing editor drawer instead of re-inventing editing**

Keep `CustomCliConfigEditorDialog` as the edit surface and continue opening it from page actions.
Reuse the existing apply logic for CLI config writes; only relocate the action affordances into the new page layout.

- [ ] **Step 4: Run the focused Custom CLI test and fix until green**

Run: `npm test -- src/__tests__/custom-cli-page-redesign.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run the existing overlay test to confirm editor-family reuse still works**

Run: `npm test -- src/__tests__/overlay-family-redesign.test.tsx`

Expected: PASS.

## Task 3: Give the Three Route Pages One Shared Workbench Rhythm

**Files:**
- Modify: `src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx`
- Modify: `src/renderer/components/Route/Usability/CliUsabilityTab.tsx`
- Modify: `src/renderer/components/Route/ProxyStats/ProxyStatsTab.tsx`
- Create or Modify: `src/renderer/components/Route/` shared helper if a small shared presentational wrapper is needed
- Modify: `src/__tests__/route-workbench-redesign.test.tsx`

- [ ] **Step 1: Add a small shared route workbench header pattern**

The smallest acceptable slice is a compact top band per route page containing:
- section label
- one-line operational summary
- page-local action cluster

Do not reintroduce nested route pages or route-level business changes.

- [ ] **Step 2: Normalize page body rhythm**

Keep each page’s archetype intact:
- redirection stays vendor rail + mapping registry
- usability stays matrix + probe controls
- proxy stats stays server/control + metrics

Only align spacing, header density, titles, summary chips, and section boundaries.

- [ ] **Step 3: Run the focused route workbench test and fix until green**

Run: `npm test -- src/__tests__/route-workbench-redesign.test.tsx`

Expected: PASS.

- [ ] **Step 4: Run existing app-shell tests that cover route mounting**

Run: `npm test -- src/__tests__/app-shell-redesign.test.tsx src/__tests__/ldc-ui-visibility.test.tsx`

Expected: PASS.

- [ ] **Step 5: Keep CSS/layout changes local**

If extra classes or wrappers are needed, keep them in these route files or a small local shared component. Do not modify unrelated store or IPC logic.

## Task 4: Close the Sites Right-Click Parity Gap

**Files:**
- Modify: `src/renderer/components/SiteCard/SiteCardActions.tsx`
- Modify: `src/__tests__/sites-page-redesign.test.tsx`

- [ ] **Step 1: Reuse the existing low-frequency action list for both menu entry points**

Keep `编辑站点 / 删除站点 / 添加账户` exactly the same as the existing more-menu items.

- [ ] **Step 2: Open the same menu on `contextmenu`**

Add right-click handling on the actions region or row trigger so the same low-frequency menu appears at cursor position, without changing the more-menu behavior.

- [ ] **Step 3: Run the focused sites redesign test and fix until green**

Run: `npm test -- src/__tests__/sites-page-redesign.test.tsx`

Expected: PASS.

- [ ] **Step 4: Re-run the site sort compatibility test**

Run: `npm test -- src/__tests__/site-sort-compat.test.ts`

Expected: PASS.

- [ ] **Step 5: Keep high-frequency actions untouched**

Do not move or hide `签到 / 刷新 / 自动刷新 / 展开 / 加油站图标 / CLI入口`.

## Task 5: Update Indexes and Verify the Whole Tail

**Files:**
- Modify as needed: `PROJECT_INDEX.md`
- Modify as needed: `src/__tests__/FOLDER_INDEX.md`
- Modify as needed: `src/renderer/components/FOLDER_INDEX.md`
- Modify as needed: `src/renderer/components/SiteCard/FOLDER_INDEX.md`

- [ ] **Step 1: Update index docs for any new tests or shared route helper**

Describe the new responsibilities and files plainly; do not rewrite unrelated sections.

- [ ] **Step 2: Run the focused redesign regression suite**

Run:

```bash
npm test -- src/__tests__/custom-cli-page-redesign.test.tsx src/__tests__/route-workbench-redesign.test.tsx src/__tests__/sites-page-redesign.test.tsx src/__tests__/overlay-family-redesign.test.tsx src/__tests__/ldc-ui-visibility.test.tsx src/__tests__/site-sort-compat.test.ts
```

Expected: all listed tests PASS.

- [ ] **Step 3: Run a production build**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 4: Review the diff against the remaining spec**

Confirm directly that:
- `CustomCliPage` is registry-first
- route tabs share one instrument-panel language
- sites row right-click parity exists
- overlay family still behaves consistently

- [ ] **Step 5: Record completion in git status only after fresh verification**

Run:

```bash
git -c safe.directory=D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54 status --short
```

Expected: only the intended modified files appear for this tail implementation.
