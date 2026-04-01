import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GlobalCommandBar } from '../renderer/components/AppShell/GlobalCommandBar';

vi.mock('../renderer/components/CliConfigStatus', () => ({
  CliConfigStatusPanel: () => <div>Mock CLI Status</div>,
}));

const globalCss = readFileSync(resolve(process.cwd(), 'src/renderer/index.css'), 'utf8');

describe('theme visual consistency', () => {
  it('defines a neutral global token contract instead of the legacy ios token layer', () => {
    expect(globalCss).toContain('--app-bg:');
    expect(globalCss).toContain('--surface-1:');
    expect(globalCss).toContain('--line-soft:');
    expect(globalCss).toContain('--text-primary:');
    expect(globalCss).toContain('--accent:');
    expect(globalCss).toContain('--overlay-mask:');
    expect(globalCss).toContain('--code-bg:');
    expect(globalCss).toContain("html[data-theme='light-b']");
    expect(globalCss).toContain("html[data-theme='light-c']");
    expect(globalCss).toContain("html[data-theme='dark']");
    expect(globalCss).toContain('.app-icon');
    expect(globalCss).not.toContain('.ios-icon {');
    expect(globalCss).not.toContain('.ios-icon-sm {');
    expect(globalCss).not.toContain('.ios-icon-md {');
    expect(globalCss).not.toContain('.ios-icon-lg {');
    expect(globalCss).not.toContain('.ios-icon-primary {');
    expect(globalCss).not.toContain('.ios-icon-success {');
    expect(globalCss).not.toContain('.ios-icon-error {');
    expect(globalCss).not.toContain('.ios-icon-warning {');
    expect(globalCss).not.toContain('.ios-icon-muted {');
  });

  it('keeps the global command bar on theme tokens instead of hardcoded gray and blue utilities', () => {
    const { container } = render(
      <GlobalCommandBar
        saving
        updateInfo={{
          hasUpdate: true,
          latestVersion: '3.1.0',
          releaseInfo: {
            version: '3.1.0',
            releaseDate: '2026-04-01',
            releaseNotes: 'notes',
            mandatory: false,
            downloadUrl: 'https://example.com/download',
          },
        }}
      />
    );

    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveClass(
      'bg-[var(--surface-1)]/90',
      'border-b',
      'border-[var(--line-soft)]'
    );
    expect(root.className).not.toContain('--ios-');
    expect(root.className).not.toContain('bg-blue-50');
    expect(root.className).not.toContain('border-gray-200');
  });
});
