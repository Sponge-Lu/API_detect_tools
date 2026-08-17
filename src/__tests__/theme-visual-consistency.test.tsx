import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from '../renderer/components/AppShell/PageHeader';

const globalCss = readFileSync(resolve(process.cwd(), 'src/renderer/index.css'), 'utf8');
const useSiteDragSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/hooks/useSiteDrag.ts'),
  'utf8'
);
const configFilesPageSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/pages/ConfigFilesPage.tsx'),
  'utf8'
);
const creditPanelCompactSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/CreditPanel/CreditPanelCompact.tsx'),
  'utf8'
);
const transactionListCardSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/CreditPanel/TransactionListCard.tsx'),
  'utf8'
);
const detectionResultsSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/DetectionResults.tsx'),
  'utf8'
);
const toastSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/Toast/Toast.tsx'),
  'utf8'
);
const incomeStatsCardSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/CreditPanel/IncomeStatsCard.tsx'),
  'utf8'
);
const expenseStatsCardSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/CreditPanel/ExpenseStatsCard.tsx'),
  'utf8'
);
const rechargeSectionSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/CreditPanel/RechargeSection.tsx'),
  'utf8'
);
const sitesPageSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/pages/SitesPage.tsx'),
  'utf8'
);
const siteCardDetailsSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/SiteCard/SiteCardDetails.tsx'),
  'utf8'
);
const settingsPageSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/pages/SettingsPage.tsx'),
  'utf8'
);
const creditPageSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/pages/CreditPage.tsx'),
  'utf8'
);
const skeletonSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/Skeleton/Skeleton.tsx'),
  'utf8'
);
const managedCliConfigEditorContentSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/dialogs/ManagedCliConfigEditorContent.tsx'),
  'utf8'
);
const directCliConfigEditorContentSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/dialogs/DirectCliConfigEditorContent.tsx'),
  'utf8'
);
const appSource = readFileSync(resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8');
const groupStyleSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/utils/groupStyle.tsx'),
  'utf8'
);
const appCardSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/AppCard/AppCard.tsx'),
  'utf8'
);
const dataTablePrimitivesSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/DataTable/DataTablePrimitives.tsx'),
  'utf8'
);
const settingsPanelSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx'),
  'utf8'
);
const themePresetsSource = readFileSync(
  resolve(process.cwd(), 'src/shared/theme/themePresets.ts'),
  'utf8'
);
const topLevelRootBlock = globalCss.match(/:root\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
const iosUtilityDefinitions =
  globalCss.match(/^\s*(?:\.reduce-effects\s+)?\.ios-[A-Za-z0-9_-]+/gm) ?? [];

describe('theme visual consistency', () => {
  it('defines a neutral global token contract instead of the legacy ios token layer', () => {
    expect(globalCss).toContain('--app-bg:');
    expect(globalCss).toContain('--surface-1:');
    expect(globalCss).toContain('--line-muted:');
    expect(globalCss).toContain('--line-soft:');
    expect(globalCss).toContain('--text-primary:');
    expect(globalCss).toContain('--accent:');
    expect(globalCss).toContain('--overlay-mask:');
    expect(globalCss).toContain('--code-bg:');
    expect(globalCss).toContain('--ease-standard:');
    expect(globalCss).toContain('--ease-enter:');
    expect(globalCss).toContain('--ease-exit:');
    expect(globalCss).toContain("html[data-theme='light-b']");
    expect(globalCss).toContain("html[data-theme='dark']");
    expect(globalCss).toContain("html[data-theme='modern']");
    expect(globalCss).toContain("html[data-theme='modern-dark']");
    expect(globalCss).toContain('.tnum');
    expect(globalCss).not.toContain("html[data-theme='light-c']");
    expect(globalCss).toContain('.app-icon');
    expect(topLevelRootBlock).not.toContain('--ios-');
    expect(topLevelRootBlock).not.toContain('--ease-ios');
    expect(topLevelRootBlock).not.toContain('--ease-ios-in');
    expect(topLevelRootBlock).not.toContain('--ease-ios-out');
    expect(globalCss).not.toContain('.ios-icon {');
    expect(globalCss).not.toContain('.ios-icon-sm {');
    expect(globalCss).not.toContain('.ios-icon-md {');
    expect(globalCss).not.toContain('.ios-icon-lg {');
    expect(globalCss).not.toContain('.ios-icon-primary {');
    expect(globalCss).not.toContain('.ios-icon-success {');
    expect(globalCss).not.toContain('.ios-icon-error {');
    expect(globalCss).not.toContain('.ios-icon-warning {');
    expect(globalCss).not.toContain('.ios-icon-muted {');
    expect(globalCss).not.toContain("[class~='ios-icon']");
    expect(globalCss).not.toContain("[class~='ios-icon-sm']");
    expect(globalCss).not.toContain("[class~='ios-icon-md']");
    expect(globalCss).not.toContain("[class~='ios-icon-lg']");
    expect(globalCss).not.toContain("[class~='ios-icon-primary']");
    expect(globalCss).not.toContain("[class~='ios-icon-success']");
    expect(globalCss).not.toContain("[class~='ios-icon-error']");
    expect(globalCss).not.toContain("[class~='ios-icon-warning']");
    expect(globalCss).not.toContain("[class~='ios-icon-muted']");
    expect(globalCss).not.toContain("[class~='ios-icon-button']");
    expect(globalCss).not.toContain('iosFadeIn');
    expect(globalCss).not.toContain('iosFadeOut');
    expect(globalCss).not.toContain('iosScaleIn');
    expect(globalCss).not.toContain('iosScaleOut');
    expect(globalCss).not.toContain('iosSlideUp');
    expect(globalCss).not.toContain('iosSlideDown');
    expect(iosUtilityDefinitions).toHaveLength(0);
  });

  it('uses neutral scroll container selectors instead of legacy ios scroll helpers', () => {
    expect(useSiteDragSource).toContain("document.querySelector('.app-scroll-y')");
    expect(useSiteDragSource).not.toContain('.ios-scroll-y');
  });

  it('keeps the merged page header on theme tokens instead of hardcoded gray and blue utilities', () => {
    const { container } = render(<PageHeader title="站点管理" saving />);

    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveClass('bg-[var(--surface-1)]/90', 'border-b', 'border-[var(--line-soft)]');
    expect(root.className).not.toContain('--ios-');
    expect(root.className).not.toContain('bg-blue-50');
    expect(root.className).not.toContain('border-gray-200');
  });

  it('keeps config files page and settings loading state on product theme tokens', () => {
    expect(configFilesPageSource).not.toContain('text-green-600');
    expect(configFilesPageSource).not.toContain('text-blue-600');
    expect(configFilesPageSource).not.toContain('text-purple-600');
    expect(configFilesPageSource).not.toContain('text-orange-600');
    expect(configFilesPageSource).not.toContain('text-slate-500');
    expect(configFilesPageSource).not.toContain('bg-green-50');
    expect(configFilesPageSource).not.toContain('bg-blue-50');
    expect(configFilesPageSource).not.toContain('bg-purple-50');
    expect(configFilesPageSource).not.toContain('bg-orange-50');
    expect(configFilesPageSource).not.toContain('bg-slate-100');
    expect(settingsPageSource).not.toContain('text-slate-500');
  });

  it('keeps credit surfaces, detection results, and group tabs off legacy utility color palettes', () => {
    expect(creditPanelCompactSource).not.toContain('text-purple-600');
    expect(creditPanelCompactSource).not.toContain('text-blue-600');
    expect(creditPanelCompactSource).not.toContain('text-green-600');
    expect(creditPanelCompactSource).not.toContain('text-gray-600');
    expect(creditPanelCompactSource).not.toContain('text-primary-500');
    expect(creditPanelCompactSource).not.toContain('text-primary-600');
    expect(creditPanelCompactSource).not.toContain('dark:text-primary-400');
    expect(creditPanelCompactSource).not.toContain('bg-slate-50');
    expect(creditPanelCompactSource).not.toContain('text-slate-500');
    expect(creditPanelCompactSource).not.toContain('bg-white');
    expect(detectionResultsSource).not.toContain('text-primary-400');
    expect(transactionListCardSource).not.toContain('bg-green-100');
    expect(transactionListCardSource).not.toContain('bg-red-100');
    expect(transactionListCardSource).not.toContain('bg-yellow-100');
    expect(transactionListCardSource).not.toContain('bg-gray-100');
    expect(detectionResultsSource).not.toContain('text-gray-300');
    expect(detectionResultsSource).not.toContain('text-gray-400');
    expect(detectionResultsSource).not.toContain('border-green-500');
    expect(detectionResultsSource).not.toContain('border-red-500');
  });

  it('keeps toast and daily stats cards on product tokens instead of legacy light/dark palettes', () => {
    expect(toastSource).not.toContain('text-green-500');
    expect(toastSource).not.toContain('text-red-500');
    expect(toastSource).not.toContain('text-yellow-500');
    expect(toastSource).not.toContain('text-blue-500');
    expect(toastSource).not.toContain('bg-green-50');
    expect(toastSource).not.toContain('bg-red-50');
    expect(toastSource).not.toContain('bg-yellow-50');
    expect(toastSource).not.toContain('bg-blue-50');
    expect(toastSource).not.toContain('text-slate-700');
    expect(incomeStatsCardSource).not.toContain('bg-white');
    expect(incomeStatsCardSource).not.toContain('text-light-text');
    expect(incomeStatsCardSource).not.toContain('bg-primary-50');
    expect(expenseStatsCardSource).not.toContain('bg-white');
    expect(expenseStatsCardSource).not.toContain('text-light-text');
    expect(expenseStatsCardSource).not.toContain('bg-red-50');
    expect(expenseStatsCardSource).not.toContain('text-red-600');
    expect(rechargeSectionSource).not.toContain('bg-white');
    expect(rechargeSectionSource).not.toContain('text-light-text');
    expect(rechargeSectionSource).not.toContain('text-red-500');
    expect(rechargeSectionSource).not.toContain('focus:ring-primary-500');
  });

  it('keeps sites page controls and site detail chips on product tokens', () => {
    expect(sitesPageSource).not.toContain('border-light-border');
    expect(sitesPageSource).not.toContain('text-light-text');
    expect(sitesPageSource).not.toContain('bg-white/80');
    expect(sitesPageSource).not.toContain('bg-primary-100/80');
    expect(sitesPageSource).not.toContain('bg-primary-50/80');
    expect(siteCardDetailsSource).not.toContain('text-orange-700');
    expect(siteCardDetailsSource).not.toContain('text-blue-700');
    expect(siteCardDetailsSource).not.toContain('bg-orange-500/10');
    expect(siteCardDetailsSource).not.toContain('bg-blue-500/10');
    expect(siteCardDetailsSource).not.toContain('text-yellow-700');
    expect(siteCardDetailsSource).not.toContain('text-green-700');
    expect(siteCardDetailsSource).not.toContain('text-orange-600');
  });

  it('keeps credit page controls, skeleton surfaces, and cli toggle knobs on neutral theme tokens', () => {
    expect(creditPageSource).not.toContain('bg-white');
    expect(creditPageSource).not.toContain('text-primary-500');
    expect(creditPageSource).not.toContain('text-primary-600');
    expect(skeletonSource).not.toContain('bg-slate-200');
    expect(skeletonSource).not.toContain('dark:bg-slate-700');
    expect(skeletonSource).not.toContain('bg-white/80');
    expect(skeletonSource).not.toContain('dark:bg-slate-800/80');
    expect(skeletonSource).not.toContain('border-slate-200');
    expect(skeletonSource).not.toContain('dark:border-slate-700');
    expect(managedCliConfigEditorContentSource).not.toContain('bg-white');
    expect(managedCliConfigEditorContentSource).not.toContain('shadow-md');
    expect(directCliConfigEditorContentSource).not.toContain('bg-white');
    expect(directCliConfigEditorContentSource).not.toContain('shadow-md');
  });

  it('keeps app shell fallback states and group color helpers on neutral theme tokens', () => {
    expect(appSource).not.toContain('bg-light-bg');
    expect(appSource).not.toContain('dark:bg-dark-bg');
    expect(appSource).not.toContain('text-light-text');
    expect(appSource).not.toContain('dark:text-dark-text');
    expect(appSource).not.toContain('text-light-text-secondary');
    expect(appSource).not.toContain('dark:text-dark-text-secondary');
    expect(appSource).not.toContain('text-primary-500');
    expect(appSource).not.toContain('text-red-500');
    expect(groupStyleSource).not.toContain('text-red-600');
    expect(groupStyleSource).not.toContain('text-emerald-500');
    expect(groupStyleSource).not.toContain('text-blue-600');
    expect(groupStyleSource).not.toContain('text-amber-500');
    expect(groupStyleSource).not.toContain('text-violet-500');
    expect(groupStyleSource).not.toContain('text-cyan-500');
    expect(groupStyleSource).not.toContain('text-pink-500');
    expect(groupStyleSource).not.toContain('text-lime-600');
    expect(groupStyleSource).not.toContain('text-indigo-500');
    expect(groupStyleSource).not.toContain('text-orange-500');
    expect(groupStyleSource).not.toContain('dark:text-');
    expect(groupStyleSource).not.toContain('text-slate-400');
  });

  it('keeps shared card and theme preview primitives off dark-only utility fallbacks', () => {
    expect(appCardSource).not.toContain('dark:bg-opacity-95');
    expect(dataTablePrimitivesSource).not.toContain('dark:bg-opacity-95');
    expect(settingsPanelSource).not.toContain('dark:border-white/10');
  });

  it('keeps the reduced theme picker copy aligned with the current two-theme set', () => {
    expect(settingsPanelSource).not.toContain(
      '三套浅色主题与一套统一暗色主题共用布局密度，只调整基底色温与视觉重心。'
    );
    expect(themePresetsSource).not.toContain("label: 'Light B'");
    expect(themePresetsSource).toContain("label: 'Light'");
  });

  it('keeps modern themes as independent platinum white presets', () => {
    expect(themePresetsSource).toContain("id: 'modern'");
    expect(themePresetsSource).toContain("id: 'modern-dark'");
    expect(themePresetsSource).toContain("description: '铂金白 · 简洁浅色'");
    expect(themePresetsSource).toContain("description: '铂金白 · 简洁深色'");
    expect(themePresetsSource).toContain("accentColor: '#6B7280'");
    expect(themePresetsSource).toContain("accentColor: '#E5E7EB'");
    expect(themePresetsSource).not.toContain('#5E6AD2');
    expect(themePresetsSource).not.toContain('#7C85E0');
    expect(themePresetsSource).not.toContain('#3D8B7A');
    expect(themePresetsSource).not.toContain('#5BB8A5');
    expect(themePresetsSource).not.toContain('靛蓝');
    expect(globalCss).toContain('--accent: #6b7280');
    expect(globalCss).toContain('--accent: #e5e7eb');
    expect(globalCss).not.toContain('--accent: #5e6ad2');
    expect(globalCss).not.toContain('--accent: #7c85e0');
    expect(globalCss).not.toContain('--accent: #3d8b7a');
    expect(globalCss).not.toContain('--accent: #5bb8a5');

    const modernBlock = globalCss.match(/html\[data-theme='modern'\]\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    const modernDarkBlock =
      globalCss.match(/html\[data-theme='modern-dark'\]\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(modernBlock).toContain('--app-bg: #fafafa');
    expect(modernBlock).toContain('--accent: #6b7280');
    expect(modernBlock).not.toContain('--accent: #5c6b78');
    expect(modernDarkBlock).toContain('--app-bg: #0a0a0a');
    expect(modernDarkBlock).toContain('--accent: #e5e7eb');
    expect(modernDarkBlock).not.toContain('--accent: #8ea1ad');
  });
});
