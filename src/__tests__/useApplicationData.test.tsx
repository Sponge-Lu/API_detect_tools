import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../shared/types/renderer-config';
import { useApplicationData } from '../renderer/hooks/useApplicationData';
import { useConfigStore } from '../renderer/store/configStore';

const config: Config = {
  sites: [],
  settings: { timeout: 30, concurrent: true, show_disabled: false },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('application loading ownership', () => {
  it('clears foreground loading when a newer background response wins', async () => {
    const initial = deferred<Config>();
    const background = deferred<Config>();
    window.electronAPI.loadConfig = vi
      .fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(background.promise);
    const view = renderHook(() => useApplicationData(vi.fn().mockResolvedValue(undefined)));
    let refresh!: Promise<Config | null>;
    act(() => {
      refresh = view.result.current.loadConfig({ background: true });
    });
    await act(async () => {
      background.resolve(config);
      await refresh;
    });
    expect(useConfigStore.getState().loading).toBe(true);
    await act(async () => {
      initial.resolve({
        ...config,
        sites: [{ name: 'stale', url: 'https://stale.test', enabled: true }],
      });
      await initial.promise;
    });
    expect(useConfigStore.getState().loading).toBe(false);
    expect(useConfigStore.getState().config?.sites).toEqual([]);
    view.unmount();
  });
  it('keeps loading through an overlapping foreground failure', async () => {
    const initial = deferred<Config>();
    const second = deferred<Config>();
    window.electronAPI.loadConfig = vi
      .fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(second.promise);
    const view = renderHook(() => useApplicationData(vi.fn().mockResolvedValue(undefined)));
    let refresh!: Promise<Config | null>;
    act(() => {
      refresh = view.result.current.loadConfig();
    });
    await act(async () => {
      initial.reject(new Error('synthetic'));
      await initial.promise.catch(() => undefined);
    });
    expect(useConfigStore.getState().loading).toBe(true);
    await act(async () => {
      second.resolve(config);
      await refresh;
    });
    expect(useConfigStore.getState().loading).toBe(false);
    view.unmount();
  });
});
