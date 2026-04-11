# API Hub Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining iOS-branded design language from the redesigned renderer UI, keep `Light A` as the default theme, compress all page headers, preserve existing CLI logos, and leave each page’s current layout structure intact with only micro-adjustments.

**Architecture:** Replace the renderer’s `--ios-*` token layer with a neutral product token layer anchored by `src/shared/theme/themePresets.ts`, then retheme the shell, overlays, and page-level surfaces without changing the information architecture. Rename active `IOS*` UI primitives to neutral names, retire or migrate the remaining legacy test/doc references, and verify the whole renderer with focused UI tests plus a production build.

**Tech Stack:** React, TypeScript, Tailwind utility classes, Electron main/renderer theme sync, Vitest, React Testing Library, existing SVG CLI logo assets

---

## File Structure

**Reference Spec**
- `docs/superpowers/specs/2026-04-01-api-hub-visual-refresh-design.md`
- `docs/ui-preview.html`

**Global Theme / Shell**
- `src/shared/theme/themePresets.ts`
- `src/main/main.ts`
- `src/main/handlers/theme-handlers.ts`
- `src/renderer/hooks/useTheme.ts`
- `src/renderer/index.css`
- `src/renderer/App.tsx`
- `src/renderer/components/AppShell/GlobalCommandBar.tsx`
- `src/renderer/components/AppShell/PageHeader.tsx`

**Shared UI Primitives To Rename / Retheme**
- `src/renderer/components/IOSButton/IOSButton.tsx`
- `src/renderer/components/IOSModal/IOSModal.tsx`
- `src/renderer/components/IOSTable/IOSTable.tsx`
- `src/renderer/components/IOSInput/IOSInput.tsx`
- `src/renderer/components/IOSCard/IOSCard.tsx`
- `src/renderer/components/ConfirmDialog.tsx`
- `src/renderer/components/overlays/OverlayFrame.tsx`
- `src/renderer/components/overlays/OverlayDrawer.tsx`

**Page / Surface Files**
- `src/renderer/pages/SitesPage.tsx`
- `src/renderer/pages/CustomCliPage.tsx`
- `src/renderer/components/CliCompatibilityIcons/CliCompatibilityIcons.tsx`
- `src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx`
- `src/renderer/components/Route/Usability/CliUsabilityTab.tsx`
- `src/renderer/components/Route/ProxyStats/ProxyStatsTab.tsx`
- `src/renderer/components/SettingsPanel.tsx`
- `src/renderer/components/SiteCard/SiteCard.tsx`
- `src/renderer/components/SiteCard/SiteCardActions.tsx`
- `src/renderer/components/SiteCard/SiteCardHeader.tsx`
- `src/renderer/components/SiteListHeader/SiteListHeader.tsx`
- `src/renderer/components/dialogs/AutoRefreshDialog.tsx`
- `src/renderer/components/dialogs/CustomCliConfigEditorDialog.tsx`
- `src/renderer/components/dialogs/DownloadUpdatePanel.tsx`
- `src/renderer/components/dialogs/UnifiedCliConfigDialog.tsx`
- `src/renderer/components/dialogs/WebDAVBackupDialog.tsx`

**Tests To Modify / Rename**
- `src/__tests__/app-shell-redesign.test.tsx`
- `src/__tests__/theme-system-redesign.test.tsx`
- `src/__tests__/theme-visual-consistency.test.tsx`
- `src/__tests__/custom-cli-page-redesign.test.tsx`
- `src/__tests__/overlay-family-redesign.test.tsx`
- `src/__tests__/ios-button.property.test.tsx`
- `src/__tests__/ios-modal.property.test.tsx`
- `src/__tests__/ios-design-system.property.test.tsx`
- `src/__tests__/ios-accessibility.property.test.tsx`
- `src/__tests__/ios-functional-preservation.property.test.tsx`

**Docs / Indexes To Update**
- `PROJECT_INDEX.md`
- `docs/ARCHITECTURE.md`
- `docs/USER_GUIDE.md`
- `docs/DEVELOPMENT.md`
- `src/__tests__/FOLDER_INDEX.md`
- `src/renderer/FOLDER_INDEX.md`
- `src/renderer/components/FOLDER_INDEX.md`
- `src/renderer/components/dialogs/FOLDER_INDEX.md`
- `src/renderer/components/overlays/FOLDER_INDEX.md`
- `src/shared/theme/FOLDER_INDEX.md`

**Boundary Notes**
- The worktree is already dirty. Do not revert unrelated redesign work.
- Keep the current page layouts. This plan only changes visual language, naming, and small spacing/weight/icon micro-adjustments.
- Preserve the existing CLI SVG assets in `src/renderer/assets/cli-icons/`.

## Task 1: Lock the New Token and Header Contract With Failing Tests

**Files:**
- Modify: `src/__tests__/app-shell-redesign.test.tsx`
- Modify: `src/__tests__/theme-visual-consistency.test.tsx`
- Modify: `src/__tests__/custom-cli-page-redesign.test.tsx`

- [ ] **Step 1: Update the page-header assertions to the new neutral tokens**

Add or replace the compact header assertions in `src/__tests__/app-shell-redesign.test.tsx` with:

```tsx
expect(screen.getByRole('heading', { name: '站点管理' })).toHaveClass(
  'text-[var(--text-primary)]'
);
expect(screen.getByText('集中维护站点配置、账号、检测结果与日常操作。')).toHaveClass(
  'text-[var(--text-secondary)]'
);
expect(container.querySelector('[data-testid="page-header-row"]')).toHaveClass('min-h-[40px]');
expect(queryByText('Workspace')).not.toBeInTheDocument();
```

- [ ] **Step 2: Update the global command bar token assertions**

Replace the token expectations in `src/__tests__/theme-visual-consistency.test.tsx` with:

```tsx
expect(container.firstChild).toHaveClass(
  'bg-[var(--surface-1)]/90',
  'border-b',
  'border-[var(--line-soft)]'
);
expect(container.innerHTML).not.toContain('--ios-');
expect(container.innerHTML).not.toContain('bg-blue-50');
expect(container.innerHTML).not.toContain('border-gray-200');
```

- [ ] **Step 3: Lock the CLI page to real SVG logos instead of text placeholders**

Append this assertion block to `src/__tests__/custom-cli-page-redesign.test.tsx`:

```tsx
expect(screen.getAllByAltText('Claude Code').length).toBeGreaterThan(0);
expect(screen.getAllByAltText('Codex').length).toBeGreaterThan(0);
expect(screen.getAllByAltText('Gemini CLI').length).toBeGreaterThan(0);
expect(screen.queryByText(/^C$/)).not.toBeInTheDocument();
expect(screen.queryByText(/^X$/)).not.toBeInTheDocument();
expect(screen.queryByText(/^G$/)).not.toBeInTheDocument();
```

- [ ] **Step 4: Run the focused tests and verify they fail for the expected reasons**

Run:

```bash
npm test -- src/__tests__/app-shell-redesign.test.tsx src/__tests__/theme-visual-consistency.test.tsx src/__tests__/custom-cli-page-redesign.test.tsx
```

Expected:
- `app-shell-redesign.test.tsx` fails because `PageHeader` still uses `--ios-text-*`.
- `theme-visual-consistency.test.tsx` fails because `GlobalCommandBar` still uses `--ios-*`.
- `custom-cli-page-redesign.test.tsx` fails because page-level CLI affordances still include text placeholders or do not consistently expose SVG logos.

- [ ] **Step 5: Commit the failing test lock**

```bash
git add src/__tests__/app-shell-redesign.test.tsx src/__tests__/theme-visual-consistency.test.tsx src/__tests__/custom-cli-page-redesign.test.tsx
git commit -m "test(ui): lock visual refresh token contract"
```

## Task 2: Replace the Global iOS Token Layer With Neutral Theme Tokens

**Files:**
- Modify: `src/shared/theme/themePresets.ts`
- Modify: `src/renderer/index.css`
- Modify: `src/main/main.ts`
- Modify: `src/main/handlers/theme-handlers.ts`
- Modify: `src/renderer/hooks/useTheme.ts`
- Modify: `src/__tests__/theme-system-redesign.test.tsx`

- [ ] **Step 1: Define the neutral token contract in `index.css`**

Replace the top-level `:root` token section in `src/renderer/index.css` with a neutral structure like:

```css
:root {
  font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', system-ui, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;

  --app-bg: #f3f0ea;
  --app-bg-muted: #ebe6de;
  --surface-1: #fbf8f3;
  --surface-2: #f1ece5;
  --surface-3: #ffffff;
  --line-soft: rgba(87, 80, 70, 0.12);
  --line-strong: rgba(87, 80, 70, 0.2);
  --text-primary: #2c2a27;
  --text-secondary: #6a635c;
  --text-tertiary: #948d84;
  --accent: #5b6a62;
  --accent-soft: rgba(91, 106, 98, 0.12);
  --accent-strong: #4d5952;
  --success: #58705d;
  --warning: #8b7457;
  --danger: #8a5d5a;
  --overlay-mask: rgba(27, 24, 22, 0.24);
  --code-bg: #1f2329;
  --code-text: #d7dbe0;
}

html[data-theme='light-b'] { /* override only values */ }
html[data-theme='light-c'] { /* override only values */ }
html[data-theme='dark'] { /* override only values */ }
```

- [ ] **Step 2: Remove the remaining `.ios-*` utility definitions**

Delete or rename the legacy blocks in `src/renderer/index.css`:

```css
/* remove */
.ios-icon { ... }
.ios-icon-sm { ... }
.ios-icon-md { ... }
.ios-icon-lg { ... }
.ios-icon-primary { ... }
.ios-icon-success { ... }
.ios-icon-error { ... }
.ios-icon-warning { ... }
.ios-icon-muted { ... }
```

If any helper class is still needed, recreate it with neutral names:

```css
.app-icon {
  stroke-width: 1.5px;
  color: currentColor;
  flex-shrink: 0;
}
```

- [ ] **Step 3: Keep `Light A` as the default and align window background helpers**

In `src/shared/theme/themePresets.ts`, make sure the exports remain or become:

```ts
export const DEFAULT_LIGHT_THEME: ThemeMode = 'light-a';

export function getWindowBackgroundColor(theme: ThemeMode): string {
  const preset = THEME_PRESETS.find(item => item.id === theme) ?? THEME_PRESETS[0];
  return preset.appBackground;
}
```

Then keep `src/main/main.ts` and `src/main/handlers/theme-handlers.ts` using:

```ts
const normalizedThemeMode = normalizeThemeMode(themeMode);
const backgroundColor = getWindowBackgroundColor(savedTheme);
```

- [ ] **Step 4: Update the theme migration test**

Keep `src/__tests__/theme-system-redesign.test.tsx` focused on the normalized default:

```tsx
it.each(['light', 'system'])('migrates legacy %s values to light-a', legacyTheme => {
  localStorage.setItem('app-theme-mode', legacyTheme);
  render(<ThemeHarness />);

  expect(document.documentElement.dataset.theme).toBe('light-a');
  expect(localStorage.getItem('app-theme-mode')).toBe('light-a');
});
```

- [ ] **Step 5: Run the theme tests and commit**

Run:

```bash
npm test -- src/__tests__/theme-system-redesign.test.tsx src/__tests__/theme-visual-consistency.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/shared/theme/themePresets.ts src/main/main.ts src/main/handlers/theme-handlers.ts src/renderer/hooks/useTheme.ts src/renderer/index.css src/__tests__/theme-system-redesign.test.tsx src/__tests__/theme-visual-consistency.test.tsx
git commit -m "refactor(theme): replace ios token layer"
```

## Task 3: Rename Active `IOS*` Primitives to Neutral Product Primitives

**Files:**
- Create: `src/renderer/components/AppButton/AppButton.tsx`
- Create: `src/renderer/components/AppModal/AppModal.tsx`
- Create: `src/renderer/components/DataTable/DataTable.tsx`
- Modify: `src/renderer/components/AppShell/GlobalCommandBar.tsx`
- Modify: `src/renderer/pages/SitesPage.tsx`
- Modify: `src/renderer/pages/CustomCliPage.tsx`
- Modify: `src/renderer/components/dialogs/UnifiedCliConfigDialog.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/__tests__/app-shell-redesign.test.tsx`

- [ ] **Step 1: Add `AppButton` and move active imports to it**

Create `src/renderer/components/AppButton/AppButton.tsx` with the neutral API:

```tsx
export interface AppButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(function AppButton(
  { variant = 'primary', size = 'md', loading = false, className = '', children, disabled, ...props },
  ref
) {
  const baseStyles =
    'inline-flex items-center justify-center gap-2 font-medium rounded-[var(--radius-md)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  const variantStyles = {
    primary: 'bg-[var(--accent-soft)] text-[var(--accent-strong)] hover:bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]',
    secondary: 'bg-[var(--surface-3)] text-[var(--text-secondary)] border border-[var(--line-soft)] hover:bg-[var(--surface-2)]',
    tertiary: 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-2)]',
    danger: 'bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_18%,transparent)]',
  };

  return (
    <button
      ref={ref}
      className={`${baseStyles} ${variantStyles[variant]} ${className}`.trim()}
      disabled={disabled || loading}
      {...props}
    >
      {children}
    </button>
  );
});
```

Update imports like:

```tsx
import { AppButton } from '../AppButton/AppButton';
```

- [ ] **Step 2: Add `AppModal` and switch the active overlay imports**

Create `src/renderer/components/AppModal/AppModal.tsx` from the current modal behavior, but replace the legacy styling:

```tsx
<div className={`fixed inset-0 ${overlayZIndexClassName} flex items-center justify-center p-4`}>
  <div className="absolute inset-0 bg-[var(--overlay-mask)] backdrop-blur-[8px]" />
  <div
    ref={modalRef}
    className={`relative w-full ${sizeClass} rounded-[var(--radius-xl)] border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-xl)] ${contentClassName}`}
  >
```

Then update active imports in `ConfirmDialog.tsx`, dialog files, and any tests to import `AppModal` instead of `IOSModal`.

- [ ] **Step 3: Add `DataTable` and move active table usage**

Create `src/renderer/components/DataTable/DataTable.tsx` by renaming the current exports:

```tsx
export {
  DataTable,
  DataTableHeader,
  DataTableRow,
  DataTableCell,
  DataTableBody,
  DataTableDivider,
  DataTableEmpty,
};
```

Update active usage in `SitesPage.tsx`:

```tsx
import { DataTableBody } from '../components/DataTable/DataTable';
```

- [ ] **Step 4: Update the app-shell mocks to the new import path**

Replace the mock blocks in `src/__tests__/app-shell-redesign.test.tsx`:

```tsx
vi.doMock('../renderer/components/AppButton/AppButton', () => ({
  AppButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));
```

- [ ] **Step 5: Run the focused primitive tests and commit**

Run:

```bash
npm test -- src/__tests__/app-shell-redesign.test.tsx src/__tests__/overlay-family-redesign.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/renderer/components/AppButton/AppButton.tsx src/renderer/components/AppModal/AppModal.tsx src/renderer/components/DataTable/DataTable.tsx src/renderer/components/AppShell/GlobalCommandBar.tsx src/renderer/pages/SitesPage.tsx src/renderer/pages/CustomCliPage.tsx src/renderer/components/dialogs/UnifiedCliConfigDialog.tsx src/renderer/App.tsx src/__tests__/app-shell-redesign.test.tsx
git commit -m "refactor(ui): rename active ios primitives"
```

## Task 4: Apply the Visual Refresh to Shell, Pages, and Overlays Without Reworking Layout

**Files:**
- Modify: `src/renderer/components/AppShell/GlobalCommandBar.tsx`
- Modify: `src/renderer/components/AppShell/PageHeader.tsx`
- Modify: `src/renderer/components/CliCompatibilityIcons/CliCompatibilityIcons.tsx`
- Modify: `src/renderer/pages/SitesPage.tsx`
- Modify: `src/renderer/pages/CustomCliPage.tsx`
- Modify: `src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx`
- Modify: `src/renderer/components/Route/Usability/CliUsabilityTab.tsx`
- Modify: `src/renderer/components/Route/ProxyStats/ProxyStatsTab.tsx`
- Modify: `src/renderer/components/SettingsPanel.tsx`
- Modify: `src/renderer/components/ConfirmDialog.tsx`
- Modify: `src/renderer/components/dialogs/AutoRefreshDialog.tsx`
- Modify: `src/renderer/components/dialogs/CustomCliConfigEditorDialog.tsx`
- Modify: `src/renderer/components/dialogs/DownloadUpdatePanel.tsx`
- Modify: `src/renderer/components/dialogs/UnifiedCliConfigDialog.tsx`
- Modify: `src/renderer/components/dialogs/WebDAVBackupDialog.tsx`

- [ ] **Step 1: Compress the shell chrome**

Update `GlobalCommandBar.tsx` and `PageHeader.tsx` to the new compact classes:

```tsx
<header className="z-[100] flex h-[42px] shrink-0 items-center border-b border-[var(--line-soft)] bg-[var(--surface-1)]/90 px-3 backdrop-blur-sm">
```

```tsx
<section className="shrink-0 border-b border-[var(--line-soft)] bg-[var(--surface-1)]/78 px-4 py-3">
  <div data-testid="page-header-row" className="flex min-h-[40px] min-w-0 items-center justify-between gap-3 overflow-hidden">
```

- [ ] **Step 2: Replace the remaining page-level `--ios-*` classes**

Examples to apply across page files:

```tsx
className="text-[var(--text-primary)]"
className="text-[var(--text-secondary)]"
className="border-[var(--line-soft)]"
className="bg-[var(--surface-1)]"
className="bg-[var(--surface-2)]"
className="bg-[var(--surface-3)]"
className="text-[var(--accent)]"
className="bg-[var(--accent-soft)]"
```

Do not move sections around; only change weights, surfaces, button tone, icon tone, and spacing density.

- [ ] **Step 3: Preserve real CLI logos and stop any text fallback**

Keep the real SVG asset imports in `CliCompatibilityIcons.tsx` and `CustomCliPage.tsx`:

```tsx
import ClaudeCodeIcon from '../assets/cli-icons/claude-code.svg';
import CodexIcon from '../assets/cli-icons/codex.svg';
import GeminiIcon from '../assets/cli-icons/gemini.svg';

<img src={icon} alt={name} className="h-full w-full" />
```

If any action cluster still uses `C / X / G` text fallback, replace it with the corresponding `<img>` tag and keep the original asset colors untouched.

- [ ] **Step 4: Rename the dialog-local `IOSToggle` helper**

In `src/renderer/components/dialogs/UnifiedCliConfigDialog.tsx`, replace the local helper:

```tsx
function FormSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`relative inline-flex h-[24px] w-[44px] rounded-full border transition-colors ${
        checked ? 'bg-[var(--accent)] border-[var(--accent)]' : 'bg-[var(--surface-2)] border-[var(--line-soft)]'
      }`}
    >
```

- [ ] **Step 5: Run the renderer-facing redesign tests and commit**

Run:

```bash
npm test -- src/__tests__/custom-cli-page-redesign.test.tsx src/__tests__/route-workbench-redesign.test.tsx src/__tests__/sites-page-redesign.test.tsx src/__tests__/overlay-family-redesign.test.tsx src/__tests__/ldc-ui-visibility.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/renderer/components/AppShell/GlobalCommandBar.tsx src/renderer/components/AppShell/PageHeader.tsx src/renderer/components/CliCompatibilityIcons/CliCompatibilityIcons.tsx src/renderer/pages/SitesPage.tsx src/renderer/pages/CustomCliPage.tsx src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx src/renderer/components/Route/Usability/CliUsabilityTab.tsx src/renderer/components/Route/ProxyStats/ProxyStatsTab.tsx src/renderer/components/SettingsPanel.tsx src/renderer/components/ConfirmDialog.tsx src/renderer/components/dialogs/AutoRefreshDialog.tsx src/renderer/components/dialogs/CustomCliConfigEditorDialog.tsx src/renderer/components/dialogs/DownloadUpdatePanel.tsx src/renderer/components/dialogs/UnifiedCliConfigDialog.tsx src/renderer/components/dialogs/WebDAVBackupDialog.tsx
git commit -m "style(ui): apply visual refresh to renderer surfaces"
```

## Task 5: Retire Remaining Legacy `IOS*` Names in Tests, Docs, and Passive Primitives

**Files:**
- Rename: `src/__tests__/ios-button.property.test.tsx` → `src/__tests__/app-button.property.test.tsx`
- Rename: `src/__tests__/ios-modal.property.test.tsx` → `src/__tests__/app-modal.property.test.tsx`
- Rename: `src/__tests__/ios-design-system.property.test.tsx` → `src/__tests__/theme-token-contract.property.test.tsx`
- Modify: `src/__tests__/ios-accessibility.property.test.tsx`
- Modify: `src/__tests__/ios-functional-preservation.property.test.tsx`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `PROJECT_INDEX.md`
- Modify: `src/__tests__/FOLDER_INDEX.md`
- Modify: `src/renderer/components/FOLDER_INDEX.md`
- Modify: `src/renderer/components/dialogs/FOLDER_INDEX.md`
- Modify: `src/renderer/components/overlays/FOLDER_INDEX.md`
- Modify: `src/shared/theme/FOLDER_INDEX.md`

- [ ] **Step 1: Rename the property tests and their imports**

Use explicit file moves:

```bash
Move-Item src/__tests__/ios-button.property.test.tsx src/__tests__/app-button.property.test.tsx
Move-Item src/__tests__/ios-modal.property.test.tsx src/__tests__/app-modal.property.test.tsx
Move-Item src/__tests__/ios-design-system.property.test.tsx src/__tests__/theme-token-contract.property.test.tsx
```

Then update imports and test titles, for example:

```tsx
import { AppButton } from '../renderer/components/AppButton/AppButton';

describe('AppButton Component', () => {
```

- [ ] **Step 2: Replace legacy wording in accessibility / preservation suites**

Update the legacy titles and imports in the remaining broad suites:

```tsx
import { AppButton } from '../renderer/components/AppButton/AppButton';
import { AppModal } from '../renderer/components/AppModal/AppModal';
import { DataTable, DataTableRow, DataTableCell, DataTableBody } from '../renderer/components/DataTable/DataTable';

describe('AppButton Accessibility', () => {
describe('DataTable Accessibility', () => {
```

- [ ] **Step 3: Replace the docs wording**

In `docs/ARCHITECTURE.md`, replace the old section:

```md
### iOS 设计系统
```

with:

```md
### 统一产品级设计系统

项目采用低饱和、克制的产品级桌面工具设计语言。渲染层通过共享语义 token 管理背景、表面层级、文字、强调色和 overlay 遮罩；四主题共享同一套结构语言，默认主题为 `Light A`。
```

Update component tables to reference `AppButton`, `AppModal`, `DataTable`, and remove Apple HIG wording from `docs/USER_GUIDE.md` and `docs/DEVELOPMENT.md`.

- [ ] **Step 4: Update project and folder indexes**

Examples:

```md
- `src/renderer/components/AppShell/PageHeader.tsx`：站点页保留紧凑页面头部，使用统一主题 token，不再沿用 iOS 语义。
- `src/renderer/components/overlays/`：统一 overlay 家族基础件，供 AppModal、CLI 工作抽屉等共享标题栏、正文区和底部操作区结构。
```

- [ ] **Step 5: Run the renamed tests, build, and commit**

Run:

```bash
npm test -- src/__tests__/app-button.property.test.tsx src/__tests__/app-modal.property.test.tsx src/__tests__/theme-token-contract.property.test.tsx src/__tests__/ios-accessibility.property.test.tsx src/__tests__/ios-functional-preservation.property.test.tsx
npm run build
git -c safe.directory=D:/2_Github_Repository/API_detect_tools/.worktrees/ui-redesign-gpt54 status --short
```

Expected:
- all listed tests PASS
- `npm run build` exits `0`
- `git status --short` shows only intended visual-refresh files

Commit:

```bash
git add src/__tests__/app-button.property.test.tsx src/__tests__/app-modal.property.test.tsx src/__tests__/theme-token-contract.property.test.tsx src/__tests__/ios-accessibility.property.test.tsx src/__tests__/ios-functional-preservation.property.test.tsx docs/ARCHITECTURE.md docs/USER_GUIDE.md docs/DEVELOPMENT.md PROJECT_INDEX.md src/__tests__/FOLDER_INDEX.md src/renderer/components/FOLDER_INDEX.md src/renderer/components/dialogs/FOLDER_INDEX.md src/renderer/components/overlays/FOLDER_INDEX.md src/shared/theme/FOLDER_INDEX.md
git commit -m "docs(ui): remove ios design language"
```

## Self-Review

**Spec coverage**
- Default `Light A`: covered in Task 2.
- Compact header and thin command bar: covered in Task 1 and Task 4.
- No large layout rewrite: enforced in Task 4 boundary notes.
- Preserve CLI logos instead of text placeholders: covered in Task 1 and Task 4.
- Remove old iOS naming from code, tests, and docs: covered in Task 3 and Task 5.

**Placeholder scan**
- No `TODO`, `TBD`, or “appropriate handling” placeholders remain.
- Each task lists exact files, commands, and concrete code snippets.

**Type consistency**
- New neutral primitive names are consistent across tasks: `AppButton`, `AppModal`, `DataTable`, `FormSwitch`.
- Token names are consistent across tasks: `--surface-*`, `--text-*`, `--line-*`, `--accent*`, `--overlay-mask`.

