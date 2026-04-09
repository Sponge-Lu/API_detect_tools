# Sites Management Stats And Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sites page keep its header sticky, merge token/request stats columns, zero stale daily stats by local date, and reuse the login browser correctly during edit-site refresh.

**Architecture:** Keep this as two bounded slices. Renderer work extracts one pure daily-stats helper that both display and sorting use, then updates the header/card layout to the merged columns. Main-process work threads an explicit `loginMode` path through site initialization and adds a login-only cleanup IPC so edit-site refresh does not close unrelated detection browsers.

**Tech Stack:** TypeScript, React, Zustand, Electron IPC, Vitest, Testing Library

---

## File Map

- Create: `src/renderer/utils/siteDailyStats.ts`
- Create: `src/__tests__/site-daily-stats.test.ts`
- Create: `src/__tests__/browser-login-flow.test.ts`
- Modify: `src/renderer/components/SiteListHeader/SiteListHeader.tsx`
- Modify: `src/renderer/components/SiteCard/SiteCard.tsx`
- Modify: `src/renderer/components/SiteCard/SiteCardHeader.tsx`
- Modify: `src/renderer/pages/SitesPage.tsx`
- Modify: `src/renderer/utils/siteSort.ts`
- Modify: `src/main/token-service.ts`
- Modify: `src/main/handlers/token-handlers.ts`
- Modify: `src/main/handlers/detection-handlers.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/__tests__/setup.ts`
- Modify: `src/__tests__/site-sort-compat.test.ts`
- Modify: `src/__tests__/sites-page-redesign.test.tsx`

### Task 1: Lock local-day zeroing and hidden sort compatibility

**Files:**
- Create: `src/__tests__/site-daily-stats.test.ts`
- Modify: `src/__tests__/site-sort-compat.test.ts`
- Create: `src/renderer/utils/siteDailyStats.ts`
- Modify: `src/renderer/utils/siteSort.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/site-daily-stats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getSiteDailyStats } from '../renderer/utils/siteDailyStats';

describe('site daily stats', () => {
  it('keeps same-day values and derives rpm/tpm', () => {
    const stats = getSiteDailyStats(
      {
        todayUsage: 3.5,
        todayPromptTokens: 1200,
        todayCompletionTokens: 300,
        todayTotalTokens: 1500,
        todayRequests: 6,
        lastRefresh: new Date('2026-04-09T08:30:00').getTime(),
      } as any,
      new Date('2026-04-09T12:00:00')
    );

    expect(stats.todayTotalTokens).toBe(1500);
    expect(stats.todayRequests).toBe(6);
    expect(stats.rpm).toBeCloseTo(6 / 720, 6);
    expect(stats.tpm).toBeCloseTo(1500 / 720, 6);
  });

  it('zeros stale values when lastRefresh is from the previous local day', () => {
    const stats = getSiteDailyStats(
      {
        todayUsage: 8,
        todayPromptTokens: 8000,
        todayCompletionTokens: 2000,
        todayTotalTokens: 10000,
        todayRequests: 25,
        lastRefresh: new Date('2026-04-08T23:55:00').getTime(),
      } as any,
      new Date('2026-04-09T00:05:00')
    );

    expect(stats.todayUsage).toBe(0);
    expect(stats.todayTotalTokens).toBe(0);
    expect(stats.todayRequests).toBe(0);
    expect(stats.rpm).toBe(0);
    expect(stats.tpm).toBe(0);
  });
});
```

Update `src/__tests__/site-sort-compat.test.ts`:

```ts
expect(normalizeSiteSortField('promptTokens')).toBe('totalTokens');
expect(normalizeSiteSortField('completionTokens')).toBe('totalTokens');
expect(normalizeSiteSortField('requests')).toBeNull();
expect(normalizeSiteSortField('rpm')).toBeNull();
expect(normalizeSiteSortField('tpm')).toBeNull();
expect(normalizeSiteSortField('ldcRatio')).toBeNull();
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/__tests__/site-daily-stats.test.ts src/__tests__/site-sort-compat.test.ts
```

Expected: helper file missing; sort compatibility assertions fail.

- [ ] **Step 3: Write the minimal implementation**

Create `src/renderer/utils/siteDailyStats.ts`:

```ts
import type { DetectionResult } from '../../shared/types/site';

type DailyStatsSource = Pick<
  DetectionResult,
  'todayUsage' | 'todayPromptTokens' | 'todayCompletionTokens' | 'todayTotalTokens' | 'todayRequests' | 'lastRefresh'
> | undefined;

export function getSiteDailyStats(source: DailyStatsSource, now: Date = new Date()) {
  const isFreshToday =
    typeof source?.lastRefresh === 'number' &&
    new Date(source.lastRefresh).toDateString() === now.toDateString();
  const todayPromptTokens = isFreshToday ? source?.todayPromptTokens ?? 0 : 0;
  const todayCompletionTokens = isFreshToday ? source?.todayCompletionTokens ?? 0 : 0;
  const todayTotalTokens = isFreshToday ? source?.todayTotalTokens ?? todayPromptTokens + todayCompletionTokens : 0;
  const todayRequests = isFreshToday ? source?.todayRequests ?? 0 : 0;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const minutesSinceStart = Math.max((now.getTime() - dayStart.getTime()) / 60000, 1);

  return {
    todayUsage: isFreshToday ? source?.todayUsage ?? 0 : 0,
    todayPromptTokens,
    todayCompletionTokens,
    todayTotalTokens,
    todayRequests,
    rpm: todayRequests > 0 ? todayRequests / minutesSinceStart : 0,
    tpm: todayTotalTokens > 0 ? todayTotalTokens / minutesSinceStart : 0,
  };
}
```

Update `src/renderer/utils/siteSort.ts` so only visible sortable fields survive:

```ts
case 'name':
case 'balance':
case 'todayUsage':
case 'totalTokens':
case 'modelCount':
case 'lastUpdate':
  return field;
case 'promptTokens':
case 'completionTokens':
  return 'totalTokens';
case 'requests':
case 'rpm':
case 'tpm':
case 'ldcRatio':
default:
  return null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- src/__tests__/site-daily-stats.test.ts src/__tests__/site-sort-compat.test.ts
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/utils/siteDailyStats.ts src/renderer/utils/siteSort.ts src/__tests__/site-daily-stats.test.ts src/__tests__/site-sort-compat.test.ts
git commit -m "test(ui): lock local-day site stats behavior"
```

### Task 2: Lock the sticky merged-column renderer behavior

**Files:**
- Modify: `src/__tests__/sites-page-redesign.test.tsx`
- Modify: `src/renderer/components/SiteListHeader/SiteListHeader.tsx`
- Modify: `src/renderer/components/SiteCard/SiteCardHeader.tsx`

- [ ] **Step 1: Write the failing UI tests**

In `src/__tests__/sites-page-redesign.test.tsx`, add:

```tsx
it('renders a sticky header row with merged token and request statistic columns', () => {
  const { container } = render(
    <SiteListHeader
      columnWidths={[120, 75, 75, 110, 110, 60, 80, 160]}
      onColumnWidthChange={vi.fn()}
      sortField="totalTokens"
      sortOrder="desc"
      onToggleSort={vi.fn()}
    />
  );

  expect((container.firstElementChild as HTMLDivElement).className).toContain('sticky');
  expect(screen.getByRole('button', { name: 'Token统计' })).toBeInTheDocument();
  expect(screen.getByText('请求统计')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '请求统计' })).not.toBeInTheDocument();
});

it('renders token and request statistics as stacked two-line cells', () => {
  render(
    <SiteCardHeader
      site={baseSite}
      siteResult={undefined}
      lastSyncDisplay="12:34"
      errorCode={null}
      timeoutSeconds={null}
      columnWidths={[120, 75, 75, 110, 110, 60, 80, 160]}
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

  expect(screen.getByText('4.2K')).toBeInTheDocument();
  expect(screen.getByText('输入 3.0K / 输出 1.2K')).toBeInTheDocument();
  expect(screen.getByText('RPM 0.50 / TPM 350')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the renderer test file to verify it fails**

Run:

```bash
npm test -- src/__tests__/sites-page-redesign.test.tsx
```

Expected: current split columns and one-line cells break the assertions.

- [ ] **Step 3: Write the minimal implementation**

Update `src/renderer/components/SiteListHeader/SiteListHeader.tsx`:

```tsx
const ALL_COLUMNS: SiteListColumn[] = [
  { label: '站点', field: 'name' },
  { label: '余额', field: 'balance' },
  { label: '今日消费', field: 'todayUsage' },
  { label: 'Token统计', field: 'totalTokens', centered: true },
  { label: '请求统计', centered: true },
  { label: '模型数', field: 'modelCount', centered: true },
  { label: '更新时间', field: 'lastUpdate', centered: true },
  { label: 'CC-CX-Gemini?', centered: true },
  { label: 'LDC比例', centered: true },
];
```

and make the root sticky:

```tsx
className={`sticky top-0 z-20 grid ... bg-[var(--surface-1)]/95 ...`}
```

Update `src/renderer/components/SiteCard/SiteCardHeader.tsx`:

```tsx
<div className="flex flex-col items-center justify-center leading-tight">
  <span className="font-mono font-medium">{formatNumber(todayTotalTokens)}</span>
  <span className="mt-1 text-[10px] text-[var(--text-tertiary)]">
    输入 {formatNumber(todayPromptTokens)} / 输出 {formatNumber(todayCompletionTokens)}
  </span>
</div>

<div className="flex flex-col items-center justify-center leading-tight">
  <span className="font-mono font-medium">{formatNumber(todayRequests)}</span>
  <span className="mt-1 text-[10px] text-[var(--text-tertiary)]">
    RPM {rpm.toFixed(2)} / TPM {formatNumber(Math.round(tpm))}
  </span>
</div>
```

- [ ] **Step 4: Run the renderer test file to verify it passes**

Run:

```bash
npm test -- src/__tests__/sites-page-redesign.test.tsx
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SiteListHeader/SiteListHeader.tsx src/renderer/components/SiteCard/SiteCardHeader.tsx src/__tests__/sites-page-redesign.test.tsx
git commit -m "test(ui): lock merged site stats columns"
```

### Task 3: Integrate shared daily stats into cards and sorting

**Files:**
- Modify: `src/renderer/components/SiteCard/SiteCard.tsx`
- Modify: `src/renderer/pages/SitesPage.tsx`

- [ ] **Step 1: Write the failing stale-day card regression**

Append this test to `src/__tests__/sites-page-redesign.test.tsx`:

```tsx
it('zeroes stale daily usage before rendering the merged stats cells', () => {
  vi.setSystemTime(new Date('2026-04-09T09:00:00'));

  render(
    <SiteCard
      site={baseSite}
      index={0}
      siteResult={{
        status: '成功',
        todayUsage: 12,
        todayPromptTokens: 9000,
        todayCompletionTokens: 1000,
        todayTotalTokens: 10000,
        todayRequests: 99,
        lastRefresh: new Date('2026-04-08T23:58:00').getTime(),
        models: [],
      } as any}
      siteAccount={undefined}
      isExpanded={false}
      columnWidths={[120, 75, 75, 110, 110, 60, 80, 160]}
      accountId={undefined}
      accountName={undefined}
      accountAccessToken={undefined}
      accountUserId={undefined}
      cardKey="site-1"
      apiKeys={[]}
      userGroups={{}}
      modelPricing={null}
      isDetecting={false}
      checkingIn={null}
      dragOverIndex={null}
      refreshMessage={null}
      selectedGroup={null}
      modelSearch=""
      globalModelSearch=""
      showTokens={{}}
      selectedModels={new Set<string>()}
      deletingTokenKey={null}
      autoRefreshEnabled={false}
      cliCompatibility={{ claudeCode: true, codex: null, geminiCli: null, testedAt: Date.now() }}
      cliConfig={null}
      isCliTesting={false}
      onExpand={vi.fn()}
      onDetect={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onCheckIn={vi.fn()}
      onOpenSite={vi.fn()}
      onOpenExtraLink={vi.fn()}
      onCopyToClipboard={vi.fn()}
      onToggleAutoRefresh={vi.fn()}
      onOpenCliConfig={vi.fn()}
      onTestCliCompat={vi.fn()}
      onApply={vi.fn()}
      onAddAccount={vi.fn()}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onDragOver={vi.fn()}
      onDragLeave={vi.fn()}
      onDrop={vi.fn()}
      onToggleGroupFilter={vi.fn()}
      onModelSearchChange={vi.fn()}
      onToggleTokenVisibility={vi.fn()}
      onToggleModelSelection={vi.fn()}
      onCopySelectedModels={vi.fn()}
      onClearSelectedModels={vi.fn()}
      onOpenCreateTokenDialog={vi.fn()}
      onDeleteToken={vi.fn()}
    />
  );

  expect(screen.getByText('$-0.00')).toBeInTheDocument();
  expect(screen.getByText('输入 0 / 输出 0')).toBeInTheDocument();
  expect(screen.getByText('RPM 0.00 / TPM 0')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
npm test -- src/__tests__/sites-page-redesign.test.tsx -t "zeroes stale daily usage before rendering the merged stats cells"
```

Expected: stale raw values still render.

- [ ] **Step 3: Write the minimal implementation**

Update `src/renderer/components/SiteCard/SiteCard.tsx`:

```tsx
import { getSiteDailyStats } from '../../utils/siteDailyStats';

const dateStr = useDateString();
const dailyStats = useMemo(() => getSiteDailyStats(siteResult, new Date()), [siteResult, dateStr]);
const { todayUsage, todayPromptTokens, todayCompletionTokens, todayTotalTokens, todayRequests, rpm, tpm } = dailyStats;
```

Update `src/renderer/pages/SitesPage.tsx` so sorting uses the same helper and no hidden request-stat sort remains:

```tsx
const getSortValue = useCallback(
  (site: SiteConfig, siteResult?: DetectionResult): number | string => {
    const dailyStats = getSiteDailyStats(siteResult, new Date());
    switch (effectiveSortField) {
      case 'todayUsage':
        return dailyStats.todayUsage;
      case 'totalTokens':
        return dailyStats.todayTotalTokens;
      case 'balance':
        return siteResult?.balance ?? Number.NEGATIVE_INFINITY;
      case 'lastUpdate':
        return siteResult?.lastRefresh ? new Date(siteResult.lastRefresh).getTime() : 0;
      case 'name':
        return site.name.toLowerCase();
      default:
        return 0;
    }
  },
  [effectiveSortField, dateStr]
);
```

For per-site sorting, aggregate the active metric across all account results instead of reusing a balance-picked representative result:

```tsx
const sortMetric =
  effectiveSortField && effectiveSortField !== 'name'
    ? siteResults.reduce<number>(
        (best, result) => Math.max(best, Number(getSortValue(site, result))),
        Number(getSortValue(site, undefined))
      )
    : 0;
```

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run:

```bash
npm test -- src/__tests__/site-daily-stats.test.ts src/__tests__/sites-page-redesign.test.tsx
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SiteCard/SiteCard.tsx src/renderer/pages/SitesPage.tsx src/__tests__/sites-page-redesign.test.tsx
git commit -m "fix(ui): zero stale daily site stats"
```

### Task 4: Repair the login-browser initialization flow

**Files:**
- Create: `src/__tests__/browser-login-flow.test.ts`
- Modify: `src/main/token-service.ts`
- Modify: `src/main/handlers/token-handlers.ts`
- Modify: `src/main/handlers/detection-handlers.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/__tests__/setup.ts`
- Modify: `src/renderer/pages/SitesPage.tsx`

- [ ] **Step 1: Write the failing main-process tests**

Create `src/__tests__/browser-login-flow.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('browser login flow', () => {
  it('initializeSiteAccount uses login browser state when loginMode is enabled', async () => {
    vi.doMock('../main/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
    vi.doMock('../main/utils/http-client', () => ({ httpGet: vi.fn(), httpPost: vi.fn(), httpRequest: vi.fn() }));
    vi.doMock('../main/utils/page-exec-queue', () => ({ runOnPageQueue: vi.fn() }));
    const { TokenService } = await import('../main/token-service');

    const chromeManager = {
      getLocalStorageData: vi.fn(async (_url, _wait, _max, _status, options) => {
        expect(options).toEqual({ loginMode: true });
        return { userId: 7, username: 'demo', systemName: 'Demo Site', accessToken: null, supportsCheckIn: true, canCheckIn: true };
      }),
      createAccessTokenForLogin: vi.fn(async () => 'login-browser-token'),
    };

    const service = new TokenService(chromeManager as any);
    const result = await service.initializeSiteAccount('https://demo.example.com', true, 600000, undefined, { loginMode: true });

    expect(chromeManager.createAccessTokenForLogin).toHaveBeenCalledWith('https://demo.example.com', 7);
    expect(result.access_token).toBe('login-browser-token');
  });

  it('close-login-browser only cleans the login browser state', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    vi.doMock('electron', () => ({
      ipcMain: { handle: vi.fn((channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler)), on: vi.fn() },
      shell: { openExternal: vi.fn() },
    }));
    vi.doMock('../main/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
    vi.doMock('../main/unified-config-manager', () => ({ unifiedConfigManager: { getAccountById: vi.fn(), getAccountsBySiteId: vi.fn(() => []) } }));
    vi.doMock('../main/config-detection-service', () => ({ configDetectionService: { detectClaudeCode: vi.fn(), detectCodex: vi.fn(), detectGeminiCli: vi.fn(), detectAll: vi.fn() } }));

    const { registerDetectionHandlers } = await import('../main/handlers/detection-handlers');
    const chromeManager = { cleanup: vi.fn(), cleanupLoginBrowser: vi.fn(), launchForLogin: vi.fn() };

    registerDetectionHandlers({} as any, chromeManager as any, {} as any);
    await handlers.get('close-login-browser')?.({});

    expect(chromeManager.cleanupLoginBrowser).toHaveBeenCalledTimes(1);
    expect(chromeManager.cleanup).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the focused test file to verify it fails**

Run:

```bash
npm test -- src/__tests__/browser-login-flow.test.ts
```

Expected: `initializeSiteAccount` lacks the extra option; `close-login-browser` is not registered.

- [ ] **Step 3: Write the minimal implementation**

Update `src/main/token-service.ts`:

```ts
async initializeSiteAccount(
  baseUrl: string,
  waitForLogin: boolean = true,
  maxWaitTime: number = 600000,
  onStatus?: (status: string) => void,
  options?: { loginMode?: boolean }
): Promise<SiteAccount> {
  const loginMode = options?.loginMode === true;
  const localData = await this.chromeManager.getLocalStorageData(
    baseUrl,
    waitForLogin,
    maxWaitTime,
    onStatus,
    { loginMode }
  );

  let accessToken = localData.accessToken;
  if (!accessToken) {
    accessToken = loginMode
      ? await this.chromeManager.createAccessTokenForLogin(baseUrl, localData.userId)
      : await this.createAccessToken(baseUrl, localData.userId);
  }
```

Update `src/main/handlers/token-handlers.ts`:

```ts
await tokenService.initializeSiteAccount(baseUrl, true, 600000, status => sendSiteInitStatus(mainWindow, status), { loginMode: true });
```

Update `src/main/handlers/detection-handlers.ts`, `src/main/preload.ts`, `src/renderer/App.tsx`, `src/__tests__/setup.ts`:

```ts
ipcMain.handle('close-login-browser', async () => chromeManager.cleanupLoginBrowser());
```

```ts
closeLoginBrowser: () => ipcRenderer.invoke('close-login-browser'),
```

```ts
closeLoginBrowser: () => Promise<void>;
```

```ts
closeLoginBrowser: vi.fn(),
```

Update `src/renderer/pages/SitesPage.tsx` finalizer after edit/save refresh:

```tsx
await window.electronAPI.closeLoginBrowser?.();
```

- [ ] **Step 4: Run the focused test file to verify it passes**

Run:

```bash
npm test -- src/__tests__/browser-login-flow.test.ts
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add src/main/token-service.ts src/main/handlers/token-handlers.ts src/main/handlers/detection-handlers.ts src/main/preload.ts src/renderer/App.tsx src/__tests__/setup.ts src/renderer/pages/SitesPage.tsx src/__tests__/browser-login-flow.test.ts
git commit -m "fix(login): reuse login browser for site refresh"
```

### Task 5: Run the targeted verification bundle

**Files:**
- Modify: `docs/superpowers/specs/2026-04-09-sites-management-stats-and-login-design.md`
- Modify: `docs/superpowers/plans/2026-04-09-sites-management-stats-and-login.md`

- [ ] **Step 1: Keep the spec line that drops hidden request-stat sorting**

Ensure the spec still contains:

```md
- 旧配置中的 `requests`、`rpm`、`tpm` 排序设置在进入站点页时归一为无排序，避免出现“界面不可点击但仍被隐藏排序”的状态。
```

- [ ] **Step 2: Run the full targeted verification bundle**

Run:

```bash
npm test -- src/__tests__/site-daily-stats.test.ts src/__tests__/site-sort-compat.test.ts src/__tests__/sites-page-redesign.test.tsx src/__tests__/browser-login-flow.test.ts
```

Expected: `PASS`

- [ ] **Step 3: Run a focused lint pass**

Run:

```bash
npx eslint src/renderer/utils/siteDailyStats.ts src/renderer/utils/siteSort.ts src/renderer/components/SiteListHeader/SiteListHeader.tsx src/renderer/components/SiteCard/SiteCard.tsx src/renderer/components/SiteCard/SiteCardHeader.tsx src/renderer/pages/SitesPage.tsx src/main/token-service.ts src/main/handlers/token-handlers.ts src/main/handlers/detection-handlers.ts src/main/preload.ts src/renderer/App.tsx src/__tests__/site-daily-stats.test.ts src/__tests__/site-sort-compat.test.ts src/__tests__/sites-page-redesign.test.tsx src/__tests__/browser-login-flow.test.ts
```

Expected: `0 errors`

- [ ] **Step 4: Commit the verified bundle**

```bash
git add docs/superpowers/specs/2026-04-09-sites-management-stats-and-login-design.md docs/superpowers/plans/2026-04-09-sites-management-stats-and-login.md
git add src/renderer/utils/siteDailyStats.ts src/renderer/utils/siteSort.ts src/renderer/components/SiteListHeader/SiteListHeader.tsx src/renderer/components/SiteCard/SiteCard.tsx src/renderer/components/SiteCard/SiteCardHeader.tsx src/renderer/pages/SitesPage.tsx src/main/token-service.ts src/main/handlers/token-handlers.ts src/main/handlers/detection-handlers.ts src/main/preload.ts src/renderer/App.tsx src/__tests__/setup.ts src/__tests__/site-daily-stats.test.ts src/__tests__/site-sort-compat.test.ts src/__tests__/sites-page-redesign.test.tsx src/__tests__/browser-login-flow.test.ts
git commit -m "fix(ui): refresh site stats and login flow"
```
