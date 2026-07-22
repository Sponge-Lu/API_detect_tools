import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from '../renderer/components/AppErrorBoundary';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppErrorBoundary', () => {
  it('renders a recoverable state when a child throws', () => {
    function BrokenChild(): JSX.Element {
      throw new Error('render failed');
    }

    render(
      <AppErrorBoundary>
        <BrokenChild />
      </AppErrorBoundary>
    );

    expect(screen.getByRole('heading', { name: '页面遇到问题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
    expect(console.error).toHaveBeenCalled();
  });

  it('delegates reload to the supplied recovery action', () => {
    const onReload = vi.fn();

    function BrokenChild(): JSX.Element {
      throw new Error('render failed');
    }

    render(
      <AppErrorBoundary onReload={onReload}>
        <BrokenChild />
      </AppErrorBoundary>
    );

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
