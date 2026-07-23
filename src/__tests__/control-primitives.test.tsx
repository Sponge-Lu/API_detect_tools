/**
 * Contract tests for AppSwitch / AppSelect / PageContainer primitives
 * Batch 3 — 一致性归拢
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppSwitch } from '../renderer/components/AppSwitch';
import { AppSelect } from '../renderer/components/AppSelect';
import { PageContainer } from '../renderer/components/PageContainer';

describe('AppSwitch primitive contract', () => {
  it('exposes role="switch" with aria-checked reflecting state', () => {
    fc.assert(
      fc.property(fc.boolean(), checked => {
        const { container, unmount } = render(
          <AppSwitch checked={checked} onCheckedChange={() => {}} ariaLabel="开关" />
        );
        const switchEl = container.querySelector('[role="switch"]');

        expect(switchEl).not.toBeNull();
        expect(switchEl?.getAttribute('aria-checked')).toBe(String(checked));
        expect(switchEl?.getAttribute('aria-label')).toBe('开关');

        unmount();
      }),
      { numRuns: 20 }
    );
  });

  it('invokes onCheckedChange with the toggled value on click', () => {
    fc.assert(
      fc.property(fc.boolean(), checked => {
        let received: boolean | null = null;
        const { container, unmount } = render(
          <AppSwitch
            checked={checked}
            onCheckedChange={next => {
              received = next;
            }}
            ariaLabel="开关"
          />
        );
        const switchEl = container.querySelector('[role="switch"]') as HTMLElement;
        fireEvent.click(switchEl);
        expect(received).toBe(!checked);
        unmount();
      }),
      { numRuns: 20 }
    );
  });

  it('wires visible label through aria-labelledby', () => {
    render(<AppSwitch checked={false} onCheckedChange={() => {}} label="自动刷新" />);
    const switchEl = screen.getByRole('switch');
    expect(switchEl.getAttribute('aria-labelledby')).toBeTruthy();
    expect(switchEl).toHaveAccessibleName('自动刷新');
  });
});

describe('AppSelect primitive contract', () => {
  it('renders a labelled select with options and token-driven classes', () => {
    render(
      <AppSelect label="选择 API Key" defaultValue="a">
        <option value="a">A</option>
        <option value="b">B</option>
      </AppSelect>
    );

    const select = screen.getByLabelText('选择 API Key') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.className).toContain('bg-[var(--surface-2)]');
    expect(select.value).toBe('a');
    expect(select.options.length).toBe(2);
  });

  it('surfaces error message with role="alert" and aria-invalid', () => {
    render(
      <AppSelect label="站点" error errorMessage="必选">
        <option value="">--</option>
      </AppSelect>
    );
    const select = screen.getByLabelText(/站点/);
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('必选');
  });
});

describe('PageContainer primitive contract', () => {
  it('applies the unified page padding and scroll container', () => {
    const { container } = render(<PageContainer>内容</PageContainer>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('px-6');
    expect(el.className).toContain('py-4');
    expect(el.className).toContain('overflow-y-auto');
    expect(el.textContent).toBe('内容');
  });
});
