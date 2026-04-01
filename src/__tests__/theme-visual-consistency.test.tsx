import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GlobalCommandBar } from '../renderer/components/AppShell/GlobalCommandBar';

vi.mock('../renderer/components/CliConfigStatus', () => ({
  CliConfigStatusPanel: () => <div>Mock CLI Status</div>,
}));

describe('theme visual consistency', () => {
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

    expect(container.firstChild).toHaveClass(
      'bg-[var(--surface-1)]/90',
      'border-b',
      'border-[var(--line-soft)]'
    );
    expect(container.innerHTML).not.toContain('--ios-');
    expect(container.innerHTML).not.toContain('bg-blue-50');
    expect(container.innerHTML).not.toContain('border-gray-200');
  });
});
