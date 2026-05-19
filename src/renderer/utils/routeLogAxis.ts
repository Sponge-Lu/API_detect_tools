/**
 * 输入: 数据范围 [domainMin, domainMax] (ms) + 像素范围 [pixelStart, pixelEnd]
 * 输出: 分段时间刻度的 value↔pixel 互转 + 默认刻度生成
 * 定位: 工具层 - 路由通道散点矩阵 X 轴（首字响应）缩放
 *
 * 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

export interface ResponseTimeAxisScale {
  domainMin: number;
  domainMax: number;
  pixelStart: number;
  pixelEnd: number;
  toPixel(value: number): number;
  toValue(pixel: number): number;
}

interface AxisSegment {
  start: number;
  end: number;
  ratioStart: number;
  ratioEnd: number;
}

const FALLBACK_AXIS_SEGMENT: AxisSegment = {
  start: 30_000,
  end: 120_000,
  ratioStart: 0.68,
  ratioEnd: 1,
};

const DEFAULT_AXIS_SEGMENTS: AxisSegment[] = [
  { start: 0, end: 5_000, ratioStart: 0, ratioEnd: 0.38 },
  { start: 5_000, end: 30_000, ratioStart: 0.38, ratioEnd: 0.68 },
  { start: 30_000, end: 120_000, ratioStart: 0.68, ratioEnd: 1 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function findSegmentForValue(value: number, segments: AxisSegment[]): AxisSegment {
  return (
    segments.find(segment => value >= segment.start && value <= segment.end) ||
    segments[segments.length - 1] ||
    FALLBACK_AXIS_SEGMENT
  );
}

function findSegmentForRatio(ratio: number, segments: AxisSegment[]): AxisSegment {
  return (
    segments.find(segment => ratio >= segment.ratioStart && ratio <= segment.ratioEnd) ||
    segments[segments.length - 1] ||
    FALLBACK_AXIS_SEGMENT
  );
}

function valueToDefaultRatio(value: number): number {
  const segment = findSegmentForValue(value, DEFAULT_AXIS_SEGMENTS);
  const segmentRange = segment.end - segment.start || 1;
  const segmentRatio = (value - segment.start) / segmentRange;
  return segment.ratioStart + segmentRatio * (segment.ratioEnd - segment.ratioStart);
}

function defaultRatioToValue(ratio: number): number {
  const segment = findSegmentForRatio(ratio, DEFAULT_AXIS_SEGMENTS);
  const segmentRatio = (ratio - segment.ratioStart) / (segment.ratioEnd - segment.ratioStart || 1);
  return segment.start + segmentRatio * (segment.end - segment.start);
}

export function createSegmentedResponseTimeScale(
  domainMin: number,
  domainMax: number,
  pixelStart: number,
  pixelEnd: number
): ResponseTimeAxisScale {
  const axisMin = DEFAULT_AXIS_SEGMENTS[0]?.start ?? 0;
  const axisMax = FALLBACK_AXIS_SEGMENT.end;
  const safeMin = clamp(Math.max(0, domainMin), axisMin, axisMax - 1);
  const safeMax = clamp(Math.max(domainMax, safeMin + 1), safeMin + 1, axisMax);
  const pixelRange = pixelEnd - pixelStart;
  const minRatio = valueToDefaultRatio(safeMin);
  const maxRatio = valueToDefaultRatio(safeMax);
  const ratioRange = maxRatio - minRatio || 1;

  return {
    domainMin: safeMin,
    domainMax: safeMax,
    pixelStart,
    pixelEnd,
    toPixel(value: number): number {
      const safeValue = clamp(value, safeMin, safeMax);
      const ratio = (valueToDefaultRatio(safeValue) - minRatio) / ratioRange;
      return pixelStart + ratio * pixelRange;
    },
    toValue(pixel: number): number {
      const ratio = clamp((pixel - pixelStart) / (pixelRange || 1), 0, 1);
      const defaultRatio = minRatio + ratio * ratioRange;
      return clamp(defaultRatioToValue(defaultRatio), safeMin, safeMax);
    },
  };
}

export const DEFAULT_FIRST_BYTE_AXIS_TICKS = [1_000, 3_000, 5_000, 10_000, 30_000, 60_000, 120_000];

export function buildAxisTicks(
  domainMin: number,
  domainMax: number,
  preset: number[] = DEFAULT_FIRST_BYTE_AXIS_TICKS
): number[] {
  return preset.filter(tick => tick >= domainMin && tick <= domainMax);
}
