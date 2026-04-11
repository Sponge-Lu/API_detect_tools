# Sites Page Main-Row Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved sites-page folded-row redesign so the default desktop layout has no horizontal overflow, keeps the existing expandable `SiteCard` details, and matches the confirmed header / column / action behavior.

**Architecture:** Keep the current `App.tsx -> SitesPage -> SiteCard -> AppCard.expandContent` structure. Add a sites-tab page-header action slot owned by `App.tsx`, shrink the visible folded-row contract to seven data columns plus a separate action strip, and rebuild `SiteCardHeader` / `CliCompatibilityIcons` so the folded row carries the two-line site cell, compact zero-state metrics, renamed `CLI可用性` column, and text-based `CLI配置` trigger without touching backend or expanded-detail logic.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, React Testing Library, Tailwind utility classes

---

## File Structure

**Reference files**
- `docs/superpowers/specs/2026-04-09-sites-page-main-row-redesign-design.md`
- `src/renderer/components/AppShell/PageHeader.tsx`
- `src/renderer/components/AppShell/pageMeta.ts`

**Implementation files**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/pages/SitesPage.tsx`
- Modify: `src/shared/constants/index.ts`
- Modify: `src/renderer/utils/siteSort.ts`
- Modify: `src/renderer/components/SiteListHeader/SiteListHeader.tsx`
- Modify: `src/renderer/components/SiteCard/SiteCardHeader.tsx`
- Modify: `src/renderer/components/SiteCard/SiteCardActions.tsx`
- Modify: `src/renderer/components/SiteCard/types.ts`
- Modify: `src/renderer/components/CliCompatibilityIcons/CliCompatibilityIcons.tsx`

**Test files**
- Modify: `src/__tests__/app-shell-redesign.test.tsx`
- Modify: `src/__tests__/site-sort-compat.test.ts`
- Modify: `src/__tests__/sites-page-redesign.test.tsx`

## Task 1: Wire Sites Actions Into The Shared Page Header

**Files:**
- Reference: `src/renderer/components/AppShell/PageHeader.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/pages/SitesPage.tsx`
- Test: `src/__tests__/app-shell-redesign.test.tsx`

- [ ] **Step 1: Add a failing app-shell integration test for sites header actions**

In `src/__tests__/app-shell-redesign.test.tsx`, add a new test beside the existing normalized-visible-tab test that reuses the same `vi.doMock` scaffold but changes the `SitesPage` mock so it registers header actions through a prop:

```tsx
it('surfaces add and restore actions in the shared sites page header', async () => {
  vi.resetModules();

  vi.doMock('../renderer/pages/SitesPage', () => {
    const React = require('react');
    return {
      SitesPage: ({
        setPageHeaderActions,
      }: {
        setPageHeaderActions?: (actions: React.ReactNode | null) => void;
      }) => {
        React.useEffect(() => {
          setPageHeaderActions?.(
            <>
              <button type="button">添加站点</button>
              <button type="button">恢复站点</button>
            </>
          );
          return () => setPageHeaderActions?.(null);
        }, [setPageHeaderActions]);

        return <div>Mock Sites Page</div>;
      },
    };
  });

  const { default: App } = await import('../renderer/App');
  render(<App />);

  expect(await screen.findByRole('button', { name: '添加站点' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '恢复站点' })).toBeInTheDocument();
});
```

Use the same hook/store mocks that already make the existing normalized-visible-tab test pass; keep `uiState.activeTab = 'sites'`, and only replace the `SitesPage` mock plus the final assertions shown above.

- [ ] **Step 2: Run the app-shell test to verify it fails**

Run:

```bash
npm test -- src/__tests__/app-shell-redesign.test.tsx
```

Expected: FAIL because `App.tsx` does not currently hold a sites-page header action slot and `SitesPage` does not accept a `setPageHeaderActions` prop.

- [ ] **Step 3: Add a sites-page header action slot in `App.tsx`**

In `src/renderer/App.tsx`, add a local state value owned by the shell and forward it into `PageHeader` only for the `sites` tab:

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const [sitesPageHeaderActions, setSitesPageHeaderActions] = useState<ReactNode | null>(null);
const pageHeaderActions = visibleActiveTab === 'sites' ? sitesPageHeaderActions : null;

<PageHeader
  title={pageMeta.title}
  description={pageMeta.description}
  actions={pageHeaderActions}
/>

<SitesPage setPageHeaderActions={setSitesPageHeaderActions} />
```

Keep every non-sites tab unchanged. Do not move `PageHeader` itself or alter route-tab handling.

- [ ] **Step 4: Register add/restore buttons from `SitesPage` and split the top band**

In `src/renderer/pages/SitesPage.tsx`, add a prop and register a memoized button group:

```tsx
interface SitesPageProps {
  setPageHeaderActions?: (actions: React.ReactNode | null) => void;
}

export function SitesPage({ setPageHeaderActions }: SitesPageProps) {
  const pageHeaderActions = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <AppButton
          variant="primary"
          size="sm"
          onClick={() => {
            setEditingSite(null);
            setEditingAccount(null);
            setShowSiteEditor(true);
          }}
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          添加站点
        </AppButton>
        <AppButton
          variant="secondary"
          size="sm"
          onClick={handleOpenBackupDialog}
          title="从备份文件恢复站点配置"
        >
          <RefreshCw className="w-4 h-4" strokeWidth={2.5} />
          恢复站点
        </AppButton>
      </div>
    ),
    [handleOpenBackupDialog, setEditingSite, setEditingAccount, setShowSiteEditor]
  );

  useEffect(() => {
    setPageHeaderActions?.(pageHeaderActions);
    return () => setPageHeaderActions?.(null);
  }, [pageHeaderActions, setPageHeaderActions]);
}
```

Then remove the add/restore buttons from the group band around current lines `1108-1128`, leaving the global search block on the right side of the group row. Do not change the search behavior or backup dialog behavior in this task.

- [ ] **Step 5: Run the app-shell test again**

Run:

```bash
npm test -- src/__tests__/app-shell-redesign.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the header-action plumbing**

Run:

```bash
git add src/renderer/App.tsx src/renderer/pages/SitesPage.tsx src/__tests__/app-shell-redesign.test.tsx
git commit -m "feat(ui): move sites actions into shared page header"
```

## Task 2: Collapse The Visible Column Contract And Drop Hidden Sorts

**Files:**
- Modify: `src/shared/constants/index.ts`
- Modify: `src/renderer/utils/siteSort.ts`
- Modify: `src/renderer/components/SiteListHeader/SiteListHeader.tsx`
- Test: `src/__tests__/site-sort-compat.test.ts`
- Test: `src/__tests__/sites-page-redesign.test.tsx`

- [ ] **Step 1: Write failing tests for the new visible columns and hidden sort normalization**

In `src/__tests__/site-sort-compat.test.ts`, replace the supported-fields assertion so `lastUpdate` is now dropped:

```ts
it('drops sorts for columns that no longer render in the folded row', () => {
  expect(normalizeSiteSortField('requests')).toBeNull();
  expect(normalizeSiteSortField('rpm')).toBeNull();
  expect(normalizeSiteSortField('tpm')).toBeNull();
  expect(normalizeSiteSortField('lastUpdate')).toBeNull();
  expect(normalizeSiteSortField('ldcRatio')).toBeNull();
});
```

In `src/__tests__/sites-page-redesign.test.tsx`, replace the old header-label assertions with the new seven-column contract:

```tsx
it('renders only the visible folded-row columns', () => {
  render(
    <SiteListHeader
      columnWidths={[210, 100, 82, 108, 104, 64, 118]}
      onColumnWidthChange={vi.fn()}
      sortField="totalTokens"
      sortOrder="desc"
      onToggleSort={vi.fn()}
    />
  );

  expect(screen.getByRole('button', { name: '站点' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '余额' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '今日消费' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Token统计' })).toBeInTheDocument();
  expect(screen.getByText('请求统计')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '模型数' })).toBeInTheDocument();
  expect(screen.getByText('CLI可用性')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '更新时间' })).not.toBeInTheDocument();
  expect(screen.queryByText('LDC比例')).not.toBeInTheDocument();
});
```

Also update the sortable-columns test so it only expects `balance` and `totalTokens` toggles from the visible header buttons.

- [ ] **Step 2: Run the column-contract tests to verify they fail**

Run:

```bash
npm test -- src/__tests__/site-sort-compat.test.ts src/__tests__/sites-page-redesign.test.tsx
```

Expected: FAIL because `normalizeSiteSortField` still keeps `lastUpdate`, `DEFAULT_COLUMN_WIDTHS` still use the old 13-entry contract, and `SiteListHeader` still renders `更新时间 / CC-CX-Gemini? / LDC比例`.

- [ ] **Step 3: Replace the default folded-row width contract with seven visible data columns**

In `src/shared/constants/index.ts`, replace the old split-token/split-request/default width array with the new folded-row baseline:

```ts
export const DEFAULT_COLUMN_WIDTHS = [
  210, // 站点（两行：站点名 / 账户名 + 更新时间）
  100, // 余额
  82, // 今日消费
  108, // Token统计
  104, // 请求统计
  64, // 模型数
  118, // CLI可用性
] as const;
```

Keep `COLUMN_MIN_WIDTH` and `COLUMN_MAX_WIDTH` unchanged.

- [ ] **Step 4: Drop invisible sorts and rebuild `SiteListHeader` around the seven-column contract**

In `src/renderer/utils/siteSort.ts`, normalize hidden sorts to `null`:

```ts
export function normalizeSiteSortField(
  field: SortField | string | null | undefined
): SortField | null {
  switch (field) {
    case 'name':
    case 'balance':
    case 'todayUsage':
    case 'totalTokens':
    case 'modelCount':
      return field;
    case 'promptTokens':
    case 'completionTokens':
      return 'totalTokens';
    case 'requests':
    case 'rpm':
    case 'tpm':
    case 'lastUpdate':
    case 'ldcRatio':
    default:
      return null;
  }
}
```

In `src/renderer/components/SiteListHeader/SiteListHeader.tsx`, replace `ALL_COLUMNS` with:

```ts
const ALL_COLUMNS: SiteListColumn[] = [
  { label: '站点', field: 'name' },
  { label: '余额', field: 'balance' },
  { label: '今日消费', field: 'todayUsage' },
  { label: 'Token统计', field: 'totalTokens', centered: true },
  { label: '请求统计', centered: true },
  { label: '模型数', field: 'modelCount', centered: true },
  { label: 'CLI可用性', centered: true },
];
```

Keep the resize handles, sticky positioning, and `actions` slot. Do not give `请求统计` or `CLI可用性` a sortable field.

- [ ] **Step 5: Run the column-contract tests again**

Run:

```bash
npm test -- src/__tests__/site-sort-compat.test.ts src/__tests__/sites-page-redesign.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the column-contract changes**

Run:

```bash
git add src/shared/constants/index.ts src/renderer/utils/siteSort.ts src/renderer/components/SiteListHeader/SiteListHeader.tsx src/__tests__/site-sort-compat.test.ts src/__tests__/sites-page-redesign.test.tsx
git commit -m "feat(ui): collapse sites folded-row columns"
```

## Task 3: Rebuild The Folded Row Content And CLI Trigger

**Files:**
- Modify: `src/renderer/components/CliCompatibilityIcons/CliCompatibilityIcons.tsx`
- Modify: `src/renderer/components/SiteCard/SiteCardHeader.tsx`
- Modify: `src/renderer/components/SiteCard/SiteCardActions.tsx`
- Modify: `src/renderer/components/SiteCard/types.ts`
- Test: `src/__tests__/sites-page-redesign.test.tsx`

- [ ] **Step 1: Add failing folded-row tests for account/time layout, balance threshold formatting, zero-state collapse, and `CLI配置`**

In `src/__tests__/sites-page-redesign.test.tsx`, replace the old two-line metric assertions and add new folded-row expectations:

```tsx
it('renders the site secondary row with account on the left and time on the right', () => {
  render(
    <SiteCardHeader
      site={baseSite}
      siteResult={{ status: '成功', balance: 1234.56, models: [] } as any}
      lastSyncDisplay="7天"
      errorCode={null}
      timeoutSeconds={null}
      columnWidths={[210, 100, 82, 108, 104, 64, 118]}
      todayTotalTokens={0}
      todayPromptTokens={0}
      todayCompletionTokens={0}
      todayRequests={0}
      rpm={0}
      tpm={0}
      modelCount={3}
      accountId="account-1"
      accountName="Primary Account"
      onOpenSite={vi.fn()}
      cliCompatibility={{ claudeCode: true, codex: null, geminiCli: false, testedAt: Date.now() }}
      cliConfig={null}
      isCliTesting={false}
      onOpenCliConfig={vi.fn()}
      onTestCliCompat={vi.fn()}
      onApply={vi.fn()}
    />
  );

  expect(screen.getByText('Primary Account')).toBeInTheDocument();
  expect(screen.getByText('7天')).toBeInTheDocument();
  expect(screen.queryByText('输入 0 / 输出 0')).not.toBeInTheDocument();
  expect(screen.queryByText('RPM 0.00 / TPM 0')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'CLI配置' })).toBeInTheDocument();
});

it('formats balances below and above the 100000 threshold differently', () => {
  const { rerender } = render(
    <SiteCardHeader
      site={baseSite}
      siteResult={{ status: '成功', balance: 99999.99, models: [] } as any}
      lastSyncDisplay="12:34"
      errorCode={null}
      timeoutSeconds={null}
      columnWidths={[210, 100, 82, 108, 104, 64, 118]}
      todayTotalTokens={4200}
      todayPromptTokens={3000}
      todayCompletionTokens={1200}
      todayRequests={6}
      rpm={0.5}
      tpm={350}
      modelCount={3}
      accountId="account-1"
      accountName="Primary Account"
      onOpenSite={vi.fn()}
      cliCompatibility={{ claudeCode: true, codex: null, geminiCli: false, testedAt: Date.now() }}
      cliConfig={null}
      isCliTesting={false}
      onOpenCliConfig={vi.fn()}
      onTestCliCompat={vi.fn()}
      onApply={vi.fn()}
    />
  );

  expect(screen.getByText('$99999.99')).toBeInTheDocument();

  rerender(
    <SiteCardHeader
      site={baseSite}
      siteResult={{ status: '成功', balance: 123456.78, models: [] } as any}
      lastSyncDisplay="12:34"
      errorCode={null}
      timeoutSeconds={null}
      columnWidths={[210, 100, 82, 108, 104, 64, 118]}
      todayTotalTokens={4200}
      todayPromptTokens={3000}
      todayCompletionTokens={1200}
      todayRequests={6}
      rpm={0.5}
      tpm={350}
      modelCount={3}
      accountId="account-1"
      accountName="Primary Account"
      onOpenSite={vi.fn()}
      cliCompatibility={{ claudeCode: true, codex: null, geminiCli: false, testedAt: Date.now() }}
      cliConfig={null}
      isCliTesting={false}
      onOpenCliConfig={vi.fn()}
      onTestCliCompat={vi.fn()}
      onApply={vi.fn()}
    />
  );

  expect(screen.getByText('$123.5K')).toBeInTheDocument();
});
```

Keep the existing high-frequency-action assertions in the same file; they protect the icon strip while spacing changes.

- [ ] **Step 2: Run the folded-row test file to verify it fails**

Run:

```bash
npm test -- src/__tests__/sites-page-redesign.test.tsx
```

Expected: FAIL because `SiteCardHeader` still renders a standalone `更新时间` column, always prints the secondary token/request lines, formats every non-infinite balance with `toFixed(2)`, and `CliCompatibilityIcons` still renders a gear icon instead of a `CLI配置` text trigger.

- [ ] **Step 3: Add a text-trigger variant to `CliCompatibilityIcons`**

In `src/renderer/components/CliCompatibilityIcons/CliCompatibilityIcons.tsx`, extend the props instead of creating a second configuration component:

```tsx
export interface CliCompatibilityIconsProps {
  compatibility: CliCompatibilityResult | undefined;
  cliConfig: CliConfig | null;
  isLoading?: boolean;
  showActionButtons?: boolean;
  configTrigger?: 'icon' | 'text';
  configButtonLabel?: string;
  onConfig?: () => void;
  onTest?: () => void;
  onApply?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
}

export function CliCompatibilityIcons({
  compatibility,
  cliConfig,
  isLoading = false,
  showActionButtons = true,
  configTrigger = 'icon',
  configButtonLabel = 'CLI配置',
  onConfig,
  onTest,
  onApply,
}: CliCompatibilityIconsProps) {
  {onConfig && configTrigger === 'text' ? (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        onConfig();
      }}
      className="h-7 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-2 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      title="配置 CLI"
      aria-label={configButtonLabel}
    >
      {configButtonLabel}
    </button>
  ) : (
    // keep the existing gear button as the default branch
  )}
}
```

Do not change the `UnifiedCliConfigDialog` call site. It should keep the icon-style trigger by default.

- [ ] **Step 4: Rebuild `SiteCardHeader` around the seven-column folded-row contract**

In `src/renderer/components/SiteCard/SiteCardHeader.tsx`, keep the existing `formatNumber` helper and add a balance formatter:

```tsx
function formatBalanceDisplay(balance: number): string {
  if (balance === -1) return '∞';
  if (balance >= 100000) return `$${formatNumber(balance)}`;
  return `$${balance.toFixed(2)}`;
}
```

Then rewrite the site cell, remove the standalone time column, and collapse zero-state second lines:

```tsx
<div className="flex min-w-0 items-center">
  <div className="flex min-w-0 flex-col gap-[2px]">
    <div className="flex min-w-0 items-center gap-1.5">
      <button
        onClick={() => onOpenSite(site, accountId)}
        className="group flex min-w-0 items-center gap-1.5 transition-colors hover:text-[var(--accent)]"
        title={`打开站点 ${site.name}${siteResult ? (siteResult.status === '成功' ? ' (在线)' : ' (离线)') : ' (未检测)'}`}
      >
        {siteResult ? (
          siteResult.status === '成功' ? (
            <div className="h-2 w-2 rounded-full bg-[var(--success)] animate-pulse flex-shrink-0" />
          ) : (
            <div className="h-2 w-2 rounded-full bg-[var(--danger)] flex-shrink-0" />
          )
        ) : (
          <div className="h-2 w-2 rounded-full bg-[var(--text-tertiary)] flex-shrink-0" />
        )}
        <span className="truncate text-sm font-semibold text-[var(--text-primary)] md:text-base">
          {site.name}
        </span>
      </button>
    </div>
    <div className="flex min-w-0 items-center justify-between pl-[14px] text-[10px] text-[var(--text-tertiary)]">
      <span className="truncate">{accountName ?? '--'}</span>
      <span className="ml-2 shrink-0">{lastSyncDisplay ?? '--'}</span>
    </div>
  </div>
</div>

<div className="flex flex-col">
  {siteResult && siteResult.balance !== undefined && siteResult.balance !== null ? (
    <span className="truncate font-mono font-semibold text-[var(--success)]">
      {formatBalanceDisplay(siteResult.balance)}
    </span>
  ) : (
    <span className="text-[var(--text-tertiary)]">--</span>
  )}
</div>

<div className="flex flex-col items-center justify-center leading-tight">
  <span className={`font-mono font-medium ${todayTotalTokens > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
    {formatNumber(todayTotalTokens)}
  </span>
  {todayTotalTokens > 0 ? (
    <span className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
      输入 {formatNumber(todayPromptTokens)} / 输出 {formatNumber(todayCompletionTokens)}
    </span>
  ) : null}
</div>

<div className="flex flex-col items-center justify-center leading-tight">
  <span className={`font-mono font-medium ${todayRequests > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
    {formatNumber(todayRequests)}
  </span>
  {todayRequests > 0 ? (
    <span className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
      RPM {rpm.toFixed(2)} / TPM {formatNumber(Math.round(tpm))}
    </span>
  ) : null}
</div>

<CliCompatibilityIcons
  compatibility={cliCompatibility}
  cliConfig={cliConfig ?? null}
  isLoading={isCliTesting}
  configTrigger="text"
  configButtonLabel="CLI配置"
  onConfig={onOpenCliConfig}
  onTest={onTestCliCompat}
  onApply={onApply}
/>
```

Update `src/renderer/components/SiteCard/types.ts` only if the new `CliCompatibilityIcons` props require additional typing at the call site. Do not add new backend-facing types.

- [ ] **Step 5: Tighten the visible icon strip without removing actions**

In `src/renderer/components/SiteCard/SiteCardActions.tsx`, keep all current actions and aria labels, but compress the spacing so the folded row stays inside the standard shell width:

```tsx
return (
  <div
    className="ml-1 flex shrink-0 items-center gap-0.5"
    onContextMenu={event => {
      event.preventDefault();
      event.stopPropagation();
      openCursorMenu(event.clientX, event.clientY);
    }}
  >
```

And update the repeated icon-button classes from `p-1` to `p-[3px]` where possible. Do not move actions into the more-menu in this task.

- [ ] **Step 6: Run the folded-row redesign tests again**

Run:

```bash
npm test -- src/__tests__/sites-page-redesign.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the folded-row rendering changes**

Run:

```bash
git add src/renderer/components/CliCompatibilityIcons/CliCompatibilityIcons.tsx src/renderer/components/SiteCard/SiteCardHeader.tsx src/renderer/components/SiteCard/SiteCardActions.tsx src/renderer/components/SiteCard/types.ts src/__tests__/sites-page-redesign.test.tsx
git commit -m "feat(ui): redesign sites folded row content"
```

## Task 4: Verify The Whole Redesign End-To-End

**Files:**
- Reference: `docs/superpowers/specs/2026-04-09-sites-page-main-row-redesign-design.md`
- Verify: `src/__tests__/app-shell-redesign.test.tsx`
- Verify: `src/__tests__/site-sort-compat.test.ts`
- Verify: `src/__tests__/sites-page-redesign.test.tsx`
- Verify: `src/renderer/App.tsx`
- Verify: `src/renderer/pages/SitesPage.tsx`
- Verify: `src/renderer/components/SiteListHeader/SiteListHeader.tsx`
- Verify: `src/renderer/components/SiteCard/SiteCardHeader.tsx`
- Verify: `src/renderer/components/SiteCard/SiteCardActions.tsx`
- Verify: `src/renderer/components/CliCompatibilityIcons/CliCompatibilityIcons.tsx`
- Verify: `src/shared/constants/index.ts`
- Verify: `src/renderer/utils/siteSort.ts`

- [ ] **Step 1: Run the focused redesign suite**

Run:

```bash
npm test -- src/__tests__/app-shell-redesign.test.tsx src/__tests__/site-sort-compat.test.ts src/__tests__/sites-page-redesign.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the full project test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run ESLint on the touched files**

Run:

```bash
npx eslint src/renderer/App.tsx src/renderer/pages/SitesPage.tsx src/renderer/components/SiteListHeader/SiteListHeader.tsx src/renderer/components/SiteCard/SiteCardHeader.tsx src/renderer/components/SiteCard/SiteCardActions.tsx src/renderer/components/SiteCard/types.ts src/renderer/components/CliCompatibilityIcons/CliCompatibilityIcons.tsx src/shared/constants/index.ts src/renderer/utils/siteSort.ts src/__tests__/app-shell-redesign.test.tsx src/__tests__/site-sort-compat.test.ts src/__tests__/sites-page-redesign.test.tsx
```

Expected: `0 errors`.

- [ ] **Step 4: Compare the final UI against the approved spec before closing**

Manually confirm each spec item against the implemented UI:

```text
- header right side only contains 添加站点 / 恢复站点
- group row keeps groups on the left and global search on the right
- visible folded-row header is exactly: 站点 / 余额 / 今日消费 / Token统计 / 请求统计 / 模型数 / CLI可用性
- 更新时间 no longer occupies its own column
- LDC比例 is hidden from the folded row
- site secondary row is 账户名 on the left and 更新时间 on the right
- balance switches to abbreviated display at 100000
- zero token/request cells only show 0
- CLI配置 renders as a text trigger
- expanded SiteCard details still open and close normally
```
