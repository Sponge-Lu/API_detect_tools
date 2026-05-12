import { describe, it, expect } from 'vitest';
import { isAnyRouterSite } from '../shared/types/site';

describe('AnyRouter 站点识别', () => {
  it('应该正确识别 AnyRouter 站点', () => {
    expect(isAnyRouterSite('Any Router')).toBe(true);
    expect(isAnyRouterSite('any router')).toBe(true);
    expect(isAnyRouterSite('ANY ROUTER')).toBe(true);
    expect(isAnyRouterSite('  any router  ')).toBe(true);
  });

  it('应该正确识别非 AnyRouter 站点', () => {
    expect(isAnyRouterSite('OneAPI')).toBe(false);
    expect(isAnyRouterSite('NewAPI')).toBe(false);
    expect(isAnyRouterSite('AnyRouter')).toBe(false); // 没有空格
    expect(isAnyRouterSite('Any  Router')).toBe(false); // 双空格
    expect(isAnyRouterSite('')).toBe(false);
  });
});
