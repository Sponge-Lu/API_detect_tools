import { describe, expect, it, vi } from 'vitest';

describe('test environment alert shim', () => {
  it('stubs window.alert as a vitest mock', () => {
    expect(vi.isMockFunction(window.alert)).toBe(true);
  });
});
