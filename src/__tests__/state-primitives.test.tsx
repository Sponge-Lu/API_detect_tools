/**
 * Contract tests for LoadingState / ErrorState primitives
 * Batch 2 — 状态三态收口
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { render, screen } from '@testing-library/react';
import { LoadingState, type LoadingStateProps } from '../renderer/components/LoadingState';
import { ErrorState } from '../renderer/components/ErrorState';

const sizes: NonNullable<LoadingStateProps['size']>[] = ['sm', 'md', 'lg'];

describe('LoadingState primitive contract', () => {
  it('renders a polite status region with a spinning loader for every size', () => {
    fc.assert(
      fc.property(fc.constantFrom(...sizes), size => {
        const { container, unmount } = render(<LoadingState size={size} />);
        const status = container.querySelector('[role="status"]');

        expect(status).not.toBeNull();
        expect(status?.getAttribute('aria-live')).toBe('polite');
        expect(container.querySelector('.animate-spin')).not.toBeNull();

        unmount();
      }),
      { numRuns: 20 }
    );
  });

  it('hides the message node when message is empty but keeps the spinner', () => {
    const { container } = render(<LoadingState message="" />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByText('加载中...')).toBeNull();
  });
});

describe('ErrorState primitive contract', () => {
  it('exposes role="alert" and renders title + description', () => {
    const { container } = render(<ErrorState title="加载失败" description="网络错误" />);

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(screen.getByText('加载失败')).toBeTruthy();
    expect(screen.getByText('网络错误')).toBeTruthy();
  });

  it('omits description node when not provided', () => {
    const { container } = render(<ErrorState title="出错了" />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(screen.getByText('出错了')).toBeTruthy();
  });
});
