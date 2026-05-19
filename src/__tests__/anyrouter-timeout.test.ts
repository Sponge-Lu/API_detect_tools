import { describe, it, expect } from 'vitest';
import { isAnyRouterSite } from '../shared/types/site';

describe('AnyRouter 站点识别', () => {
  it('应该正确识别 AnyRouter 站点', () => {
    expect(isAnyRouterSite('Any Router')).toBe(true);
    expect(isAnyRouterSite('any router')).toBe(true);
    expect(isAnyRouterSite('ANY ROUTER')).toBe(true);
    expect(isAnyRouterSite('  any router  ')).toBe(true);
    expect(isAnyRouterSite('AnyRouter')).toBe(true);
    expect(isAnyRouterSite('Any  Router')).toBe(true);
    expect(isAnyRouterSite('any-router')).toBe(true);
    expect(isAnyRouterSite('any_router')).toBe(true);
  });

  it('应该正确识别非 AnyRouter 站点', () => {
    expect(isAnyRouterSite('OneAPI')).toBe(false);
    expect(isAnyRouterSite('NewAPI')).toBe(false);
    expect(isAnyRouterSite('AnyRouter Pro')).toBe(false);
    expect(isAnyRouterSite('My AnyRouter')).toBe(false);
    expect(isAnyRouterSite('')).toBe(false);
  });
});
