/**
 * routeLogAxis 单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FIRST_BYTE_AXIS_TICKS,
  buildAxisTicks,
  createSegmentedResponseTimeScale,
} from '../renderer/utils/routeLogAxis';

describe('createSegmentedResponseTimeScale', () => {
  const scale = createSegmentedResponseTimeScale(0, 120000, 0, 100);

  it('domainMin 映射到 pixelStart', () => {
    expect(scale.toPixel(0)).toBeCloseTo(0, 5);
  });

  it('domainMax 映射到 pixelEnd', () => {
    expect(scale.toPixel(120000)).toBeCloseTo(100, 5);
  });

  it('给 5s 以下的快速区分配更大的横向空间', () => {
    expect(scale.toPixel(5000)).toBeCloseTo(38, 5);
    expect(scale.toPixel(30000)).toBeCloseTo(68, 5);
  });

  it('超出 domain 的值被夹紧', () => {
    expect(scale.toPixel(-1)).toBeCloseTo(0, 5);
    expect(scale.toPixel(180000)).toBeCloseTo(100, 5);
  });

  it('toValue 与 toPixel 互逆', () => {
    const original = 60000;
    const pixel = scale.toPixel(original);
    expect(scale.toValue(pixel)).toBeCloseTo(original, 0);
  });

  it('传入子区间 domain 时仍映射到完整像素范围', () => {
    const scopedScale = createSegmentedResponseTimeScale(5000, 60000, 10, 90);

    expect(scopedScale.toPixel(5000)).toBeCloseTo(10, 5);
    expect(scopedScale.toPixel(60000)).toBeCloseTo(90, 5);
    expect(scopedScale.toValue(10)).toBeCloseTo(5000, 0);
    expect(scopedScale.toValue(90)).toBeCloseTo(60000, 0);
  });
});

describe('buildAxisTicks', () => {
  it('默认 ticks 覆盖 120s 首字响应超时窗口', () => {
    expect(DEFAULT_FIRST_BYTE_AXIS_TICKS).toEqual([1000, 3000, 5000, 10000, 30000, 60000, 120000]);
  });

  it('过滤超出 domain 的 tick', () => {
    expect(buildAxisTicks(5000, 60000)).toEqual([5000, 10000, 30000, 60000]);
  });

  it('支持自定义 preset', () => {
    expect(buildAxisTicks(0, 100, [10, 50, 100, 500])).toEqual([10, 50, 100]);
  });
});
