/**
 * routeTtfb 单元测试
 */

import { describe, it, expect } from 'vitest';
import { computeFirstBytePercentiles, formatTtfb } from '../renderer/utils/routeTtfb';

describe('computeFirstBytePercentiles', () => {
  it('样本不足返回三个 null + 实际样本数', () => {
    const result = computeFirstBytePercentiles({ '0-200ms': 5, '200-500ms': 10 });
    expect(result.sampleCount).toBe(15);
    expect(result.p50).toBeNull();
    expect(result.p95).toBeNull();
    expect(result.p99).toBeNull();
  });

  it('样本充足时计算 P50/P95/P99 单调递增', () => {
    const histogram = {
      '0-200ms': 50,
      '200-500ms': 30,
      '500-1000ms': 15,
      '1000-3000ms': 4,
      '>5000ms': 1,
    };
    const result = computeFirstBytePercentiles(histogram);
    expect(result.sampleCount).toBe(100);
    expect(result.p50).not.toBeNull();
    expect(result.p95).not.toBeNull();
    expect(result.p99).not.toBeNull();
    expect(result.p95!).toBeGreaterThanOrEqual(result.p50!);
    expect(result.p99!).toBeGreaterThanOrEqual(result.p95!);
  });

  it('能解析 firstByteHistogram 桶边界 [200,500,1000,3000,5000,10000]', () => {
    const histogram = {
      '0-200ms': 50,
      '200-500ms': 25,
      '500-1000ms': 15,
      '1000-3000ms': 5,
      '3000-5000ms': 3,
      '5000-10000ms': 1,
      '>10000ms': 1,
    };
    const result = computeFirstBytePercentiles(histogram);
    expect(result.sampleCount).toBe(100);
    expect(result.p50).toBeGreaterThan(0);
  });

  it('空 histogram 返回 0 样本与 null', () => {
    const result = computeFirstBytePercentiles({});
    expect(result.sampleCount).toBe(0);
    expect(result.p50).toBeNull();
  });
});

describe('formatTtfb', () => {
  it('null 返回 —', () => {
    expect(formatTtfb(null)).toBe('—');
  });

  it('< 1000ms 显示 ms 整数', () => {
    expect(formatTtfb(180)).toBe('180ms');
    expect(formatTtfb(999)).toBe('999ms');
  });

  it('>= 1000ms 显示 1 位小数 s', () => {
    expect(formatTtfb(1000)).toBe('1.0s');
    expect(formatTtfb(1500)).toBe('1.5s');
    expect(formatTtfb(8400)).toBe('8.4s');
  });
});
