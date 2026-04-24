import { describe, expect, it } from 'vitest';
import {
  buildCliCompatibilityTooltip,
  getCliCompatibilityIconClass,
} from '../renderer/components/CliCompatibilityIcons/cliCompatibilityMeta';

describe('custom cli compatibility metadata helpers', () => {
  it('matches the site-management icon classes for enabled CLI states', () => {
    expect(getCliCompatibilityIconClass({ enabled: true, configured: false, status: null })).toBe(
      'opacity-25 grayscale'
    );
    expect(getCliCompatibilityIconClass({ enabled: true, configured: true, status: null })).toBe(
      'opacity-50 grayscale'
    );
    expect(getCliCompatibilityIconClass({ enabled: true, configured: true, status: false })).toBe(
      'opacity-70 grayscale brightness-75'
    );
    expect(getCliCompatibilityIconClass({ enabled: true, configured: true, status: true })).toBe(
      'opacity-100'
    );
  });

  it('uses the disabled class when the CLI is not enabled', () => {
    expect(getCliCompatibilityIconClass({ enabled: false, configured: false, status: null })).toBe(
      'opacity-15 grayscale'
    );
  });

  it('builds tooltip text with detail status and tested time', () => {
    const tooltip = buildCliCompatibilityTooltip({
      name: 'Codex',
      enabled: true,
      configured: true,
      status: false,
      testedAt: Date.now() - 60_000,
      codexDetail: { responses: false, replyText: '答案是 3' },
      error: '期望包含 2',
    });

    expect(tooltip).toContain('Codex: 不支持');
    expect(tooltip).toContain('[responses: ✗, 回答: 答案是 3]');
    expect(tooltip).toContain('分钟前测试');
    expect(tooltip).toContain('错误: 期望包含 2');
  });
});
