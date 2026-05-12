/**
 * 路由延迟分位数计算单元测试
 */

import { describe, it, expect } from 'vitest';
import { computeLatencyPercentiles, formatLatency } from '../renderer/utils/routeLatency';

describe('computeLatencyPercentiles', () => {
  it('样本不足时返回 null', () => {
    const histogram = {
      '0-100ms': 5,
      '100-500ms': 10,
    };

    const result = computeLatencyPercentiles(histogram);

    expect(result.sampleCount).toBe(15);
    expect(result.p90).toBeNull();
    expect(result.p99).toBeNull();
  });

  it('样本充足时计算 P90/P99', () => {
    const histogram = {
      '0-100ms': 50,
      '100-500ms': 30,
      '500-1000ms': 15,
      '1000-3000ms': 4,
      '>5000ms': 1,
    };

    const result = computeLatencyPercentiles(histogram);

    expect(result.sampleCount).toBe(100);
    expect(result.p90).toBeGreaterThan(0);
    expect(result.p99).toBeGreaterThan(0);
    expect(result.p99).toBeGreaterThanOrEqual(result.p90!);
  });

  it('P90 应落在第 90 百分位桶的中点', () => {
    const histogram = {
      '0-100ms': 89,
      '100-500ms': 10,
      '500-1000ms': 1,
    };

    const result = computeLatencyPercentiles(histogram);

    expect(result.p90).toBeGreaterThanOrEqual(50);
    expect(result.p90).toBeLessThanOrEqual(300);
  });

  it('P99 应落在第 99 百分位桶的中点', () => {
    const histogram = {
      '0-100ms': 98,
      '100-500ms': 1,
      '500-1000ms': 1,
    };

    const result = computeLatencyPercentiles(histogram);

    expect(result.p99).toBeGreaterThanOrEqual(50);
    expect(result.p99).toBeLessThanOrEqual(750);
  });

  it('处理开放式桶 >5000ms', () => {
    const histogram = {
      '0-100ms': 20,
      '>5000ms': 80,
    };

    const result = computeLatencyPercentiles(histogram);

    expect(result.p90).toBeGreaterThan(5000);
    expect(result.p99).toBeGreaterThan(5000);
  });

  it('空 histogram 返回 0 样本', () => {
    const result = computeLatencyPercentiles({});

    expect(result.sampleCount).toBe(0);
    expect(result.p90).toBeNull();
    expect(result.p99).toBeNull();
  });
});

describe('formatLatency', () => {
  it('null 返回 —', () => {
    expect(formatLatency(null)).toBe('—');
  });

  it('小于 1000ms 显示 ms', () => {
    expect(formatLatency(50)).toBe('50ms');
    expect(formatLatency(999)).toBe('999ms');
  });

  it('大于等于 1000ms 显示 s', () => {
    expect(formatLatency(1000)).toBe('1.00s');
    expect(formatLatency(1500)).toBe('1.50s');
    expect(formatLatency(5234)).toBe('5.23s');
  });
});
