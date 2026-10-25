import type { RouteAnalyticsBucket, RouteAnalyticsWindow } from '../../../shared/types/route-proxy';
import type { SiteDailySnapshot } from '../../../shared/types/site';

import { toNonNegativeBalance, type SiteOverviewMetric } from '../../utils/siteOverview';

import { type ScatterPoint } from '../../utils/routeScatter';

import { type ModelDistributionItem } from '../../utils/routeModelDistribution';

export type RouteWindow = RouteAnalyticsWindow;

export const ROUTE_WINDOW_POINT_COUNTS: Record<RouteWindow, number> = {
  '24h': 24,
  '7d': 7,
};

export const AGGREGATED_SITE_OPTION_ID = '__aggregated_site__';

export interface TrendPoint {
  key: string;
  timestamp: number;
  label: string;
  hasData: boolean;
  requestCount: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  latencyHistogram: Record<string, number>;
  firstByteHistogram: Record<string, number>;
}

export type TrendDirection = 'up' | 'down' | 'flat' | 'none';

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatCurrency(value: number): string {
  if (value === -1) return '∞';
  if (Math.abs(value) >= 100_000) return `$${formatCompactNumber(value)}`;
  return `$${value.toFixed(2)}`;
}

export function formatCheckinQuota(value: number): string {
  if (value === 0) return '$0.00';
  const dollars = value / 500000;
  if (dollars >= 0.01) return `$${dollars.toFixed(2)}`;
  if (dollars >= 0.001) return `$${dollars.toFixed(3)}`;
  return `$${dollars.toFixed(4)}`;
}

export function getCharacterDisplayWidth(char: string): number {
  return (char.codePointAt(0) || 0) <= 0xff ? 0.5 : 1;
}

export function truncateTextByDisplayWidth(text: string, maxWidth: number): string {
  let width = 0;
  let result = '';

  for (const char of text) {
    const charWidth = getCharacterDisplayWidth(char);
    if (width + charWidth > maxWidth) {
      return `${result}…`;
    }
    result += char;
    width += charWidth;
  }

  return result;
}

export function formatDateLabel(timestamp: number, window: RouteWindow): string {
  const date = new Date(timestamp);
  if (window === '24h') {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}

export function floorRouteTrendDate(timestamp: number, window: RouteWindow): Date {
  const date = new Date(timestamp);
  if (window === '24h') {
    date.setMinutes(0, 0, 0);
    return date;
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

export function addRouteTrendStep(date: Date, window: RouteWindow, steps: number): Date {
  const nextDate = new Date(date);
  if (window === '24h') {
    nextDate.setHours(nextDate.getHours() + steps);
    return nextDate;
  }
  nextDate.setDate(nextDate.getDate() + steps);
  return nextDate;
}

export function buildRouteTrendKey(timestamp: number, window: RouteWindow): string {
  const date = floorRouteTrendDate(timestamp, window);
  if (window === '24h') {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
  }
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function createEmptyTrendPoint(timestamp: number, window: RouteWindow): TrendPoint {
  const normalizedTimestamp = floorRouteTrendDate(timestamp, window).getTime();

  return {
    key: buildRouteTrendKey(normalizedTimestamp, window),
    timestamp: normalizedTimestamp,
    label: formatDateLabel(normalizedTimestamp, window),
    hasData: false,
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    totalTokens: 0,
    latencyHistogram: {},
    firstByteHistogram: {},
  };
}

export function formatSnapshotDayLabel(snapshotDate: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(
    parseDayKey(snapshotDate)
  );
}

export function buildRouteTrendPoints(
  buckets: RouteAnalyticsBucket[],
  window: RouteWindow
): TrendPoint[] {
  const grouped = new Map<string, TrendPoint>();
  const pointCount = ROUTE_WINDOW_POINT_COUNTS[window];
  const latestTimestamp = Math.max(Date.now(), ...buckets.map(bucket => bucket.bucketStart));
  const endDate = floorRouteTrendDate(latestTimestamp, window);
  const startDate = addRouteTrendStep(endDate, window, -(pointCount - 1));

  for (let index = 0; index < pointCount; index += 1) {
    const bucketDate = addRouteTrendStep(startDate, window, index);
    const point = createEmptyTrendPoint(bucketDate.getTime(), window);
    grouped.set(point.key, point);
  }

  for (const bucket of [...buckets].sort((left, right) => left.bucketStart - right.bucketStart)) {
    const key = buildRouteTrendKey(bucket.bucketStart, window);
    const current = grouped.get(key) || createEmptyTrendPoint(bucket.bucketStart, window);

    current.hasData = true;
    current.requestCount += bucket.requestCount;
    current.successCount += bucket.successCount;
    current.failureCount += bucket.failureCount;
    current.totalTokens += bucket.totalTokens;
    for (const [label, count] of Object.entries(bucket.latencyHistogram || {})) {
      current.latencyHistogram[label] = (current.latencyHistogram[label] || 0) + count;
    }
    for (const [label, count] of Object.entries(bucket.firstByteHistogram || {})) {
      current.firstByteHistogram[label] = (current.firstByteHistogram[label] || 0) + count;
    }

    grouped.set(key, current);
  }

  return Array.from(grouped.values()).sort((left, right) => left.timestamp - right.timestamp);
}

export function formatDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDayKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

export function buildSevenDaySnapshotSeries(
  snapshots: SiteDailySnapshot[],
  now: Date = new Date()
): Array<SiteDailySnapshot | null> {
  if (snapshots.length === 0) return [];

  const snapshotsByDay = new Map<string, SiteDailySnapshot>();
  for (const snapshot of snapshots) {
    const current = snapshotsByDay.get(snapshot.snapshotDate);
    if (!current || snapshot.capturedAt >= current.capturedAt) {
      snapshotsByDay.set(snapshot.snapshotDate, snapshot);
    }
  }

  const latestSnapshotDay = [...snapshotsByDay.keys()].sort().at(-1) || formatDayKey(now);
  const todayDay = formatDayKey(now);
  const endDay = latestSnapshotDay > todayDay ? latestSnapshotDay : todayDay;
  const endDate = parseDayKey(endDay);

  return Array.from({ length: 7 }, (_, index) => {
    const dayKey = formatDayKey(addDays(endDate, index - 6));
    return snapshotsByDay.get(dayKey) || null;
  });
}

export function isFreshToday(timestamp: number | undefined, now: Date = new Date()): boolean {
  return typeof timestamp === 'number' && formatDayKey(new Date(timestamp)) === formatDayKey(now);
}

export function buildLiveTodaySnapshot(
  metric: SiteOverviewMetric | null,
  now: Date = new Date()
): SiteDailySnapshot | null {
  if (!metric || !isFreshToday(metric.lastRefresh, now)) {
    return null;
  }

  return {
    siteId: metric.siteId,
    snapshotDate: formatDayKey(now),
    capturedAt: metric.lastRefresh,
    balance: metric.balance,
    todayUsage: metric.todayUsage,
    todayRequests: metric.todayRequests,
    todayPromptTokens: metric.todayPromptTokens,
    todayCompletionTokens: metric.todayCompletionTokens,
    totalTokens: metric.totalTokens,
  };
}

export function mergeLiveTodaySnapshot(
  snapshots: SiteDailySnapshot[],
  liveTodaySnapshot: SiteDailySnapshot | null
): SiteDailySnapshot[] {
  if (!liveTodaySnapshot) {
    return snapshots;
  }

  return [
    ...snapshots.filter(snapshot => snapshot.snapshotDate !== liveTodaySnapshot.snapshotDate),
    liveTodaySnapshot,
  ].sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate));
}

export function buildTrendDeltaSummary(values: Array<number | null>): {
  currentValue: number | null;
  previousValue: number | null;
  deltaPercent: number | null;
  direction: TrendDirection;
} {
  const definedValues = values.filter((value): value is number => value !== null);
  if (definedValues.length === 0) {
    return {
      currentValue: null,
      previousValue: null,
      deltaPercent: null,
      direction: 'none',
    };
  }

  const currentValue = definedValues[definedValues.length - 1];
  const previousValue = definedValues.length > 1 ? definedValues[definedValues.length - 2] : null;

  if (previousValue === null) {
    return { currentValue, previousValue, deltaPercent: null, direction: 'none' };
  }

  const delta = currentValue - previousValue;
  if (Math.abs(delta) < 0.000001) {
    return { currentValue, previousValue, deltaPercent: 0, direction: 'flat' };
  }

  if (previousValue === 0) {
    return {
      currentValue,
      previousValue,
      deltaPercent: null,
      direction: delta > 0 ? 'up' : 'down',
    };
  }

  return {
    currentValue,
    previousValue,
    deltaPercent: (delta / Math.abs(previousValue)) * 100,
    direction: delta > 0 ? 'up' : 'down',
  };
}

export function formatTrendDeltaBadge(
  direction: TrendDirection,
  deltaPercent: number | null,
  previousValue: number | null
): string {
  if (direction === 'none') return '首日记录';
  if (direction === 'flat') return '持平';
  if (previousValue === 0 || deltaPercent === null) {
    return direction === 'up' ? '新增' : '回落';
  }

  const precision = Math.abs(deltaPercent) >= 100 ? 0 : 1;
  return `${direction === 'up' ? '+' : '-'}${Math.abs(deltaPercent).toFixed(precision)}%`;
}

export function resolveTrendPointLeftPercent(index: number, pointCount: number): number {
  if (pointCount <= 1) return 50;
  const chartWidth = 160;
  const pointPadding = 4;
  const plotWidth = chartWidth - pointPadding * 2;
  const x = pointPadding + (index / (pointCount - 1)) * plotWidth;
  return (x / chartWidth) * 100;
}

export function resolveSparklineDisplayValues(values: Array<number | null>): number[] {
  if (values.length === 0) return [];

  const firstDefinedIndex = values.findIndex(value => value !== null);
  if (firstDefinedIndex === -1) {
    return new Array(values.length).fill(0);
  }

  const resolvedValues = [...values] as Array<number | null>;
  const firstDefinedValue = values[firstDefinedIndex] as number;

  for (let index = 0; index < firstDefinedIndex; index += 1) {
    resolvedValues[index] = firstDefinedValue;
  }

  let lastDefinedIndex = firstDefinedIndex;
  let lastDefinedValue = firstDefinedValue;

  for (let index = firstDefinedIndex + 1; index < values.length; index += 1) {
    const currentValue = values[index];
    if (currentValue !== null) {
      const gapLength = index - lastDefinedIndex;
      if (gapLength > 1) {
        const delta = (currentValue - lastDefinedValue) / gapLength;
        for (let fillIndex = 1; fillIndex < gapLength; fillIndex += 1) {
          resolvedValues[lastDefinedIndex + fillIndex] = lastDefinedValue + delta * fillIndex;
        }
      }

      resolvedValues[index] = currentValue;
      lastDefinedIndex = index;
      lastDefinedValue = currentValue;
    }
  }

  for (let index = lastDefinedIndex + 1; index < values.length; index += 1) {
    resolvedValues[index] = lastDefinedValue;
  }

  return resolvedValues.map(value => value ?? 0);
}

export function resolveSparklineValueDomain(
  values: Array<number | null>,
  valueMin?: number,
  valueMax?: number
): { min: number; max: number; fixed: boolean } {
  const fixed = typeof valueMin === 'number' && typeof valueMax === 'number' && valueMax > valueMin;
  const displayValues = resolveSparklineDisplayValues(values);
  if (fixed) return { min: valueMin, max: valueMax, fixed: true };
  return { min: Math.min(...displayValues, 0), max: Math.max(...displayValues, 1), fixed: false };
}

export function buildSparklineBarHeights(
  values: Array<number | null>,
  chartHeight: number,
  valueMin?: number,
  valueMax?: number
): number[] {
  if (values.length === 0) return [];

  const displayValues = resolveSparklineDisplayValues(values);
  const definedValues = values.filter((value): value is number => value !== null);
  if (definedValues.length === 0) {
    return new Array(values.length).fill(Math.max(chartHeight * 0.12, 6));
  }

  const domain = resolveSparklineValueDomain(values, valueMin, valueMax);
  const hasVariance = domain.fixed || domain.max !== domain.min;

  return displayValues.map(value => {
    if (!hasVariance) {
      return Math.max(chartHeight * 0.52, 12);
    }

    const ratio = Math.min(1, Math.max(0, (value - domain.min) / (domain.max - domain.min || 1)));
    if (domain.fixed) {
      return ratio > 0 ? Math.max(ratio * chartHeight, 2) : 0;
    }
    return Math.max(ratio * chartHeight, 8);
  });
}

export function buildSparklineCoordinates(
  values: Array<number | null>,
  width: number,
  height: number,
  padding = 0,
  pointLeftPercents?: number[],
  valueMin?: number,
  valueMax?: number
) {
  if (values.length === 0) return [];
  const displayValues = resolveSparklineDisplayValues(values);
  const definedValues = values.filter((value): value is number => value !== null);
  const plotWidth = Math.max(width - padding * 2, 0);
  const plotHeight = Math.max(height - padding * 2, 0);
  const resolveX = (index: number) => {
    const pointLeftPercent = pointLeftPercents?.[index];
    if (typeof pointLeftPercent === 'number' && Number.isFinite(pointLeftPercent)) {
      return (pointLeftPercent / 100) * width;
    }
    return values.length === 1 ? width / 2 : padding + (index / (values.length - 1)) * plotWidth;
  };

  if (definedValues.length === 0) {
    return values.map((value, index) => ({
      value,
      x: resolveX(index),
      y: height / 2,
    }));
  }

  const domain = resolveSparklineValueDomain(values, valueMin, valueMax);
  const rawMax = Math.max(...displayValues);
  const rawMin = Math.min(...displayValues);
  const max = domain.fixed ? domain.max : Math.max(rawMax, 1);
  const min = domain.fixed ? domain.min : Math.min(rawMin, 0);
  const range = max - min || 1;
  const hasVariance = domain.fixed || rawMax !== rawMin;

  return displayValues.map((displayValue, index) => {
    const x = resolveX(index);
    const y = hasVariance
      ? padding + plotHeight - ((displayValue - min) / range) * plotHeight
      : padding + plotHeight * 0.45;
    return { value: values[index], x, y };
  });
}

export function buildSparklinePath(
  values: Array<number | null>,
  width: number,
  height: number,
  padding = 0,
  pointLeftPercents?: number[],
  startIndex = 0,
  valueMin?: number,
  valueMax?: number
): string {
  const coordinates = buildSparklineCoordinates(
    values,
    width,
    height,
    padding,
    pointLeftPercents,
    valueMin,
    valueMax
  );
  if (coordinates.length === 0) return '';

  const definedPointCount = values.filter(value => value !== null).length;
  if (definedPointCount === 0) return '';

  if (definedPointCount === 1) {
    if (startIndex > 0) return '';

    const point = coordinates.find(coordinate => coordinate.value !== null);
    if (!point) return '';
    const startX = Math.max(point.x - 8, padding);
    const endX = Math.min(point.x + 8, width - padding);
    return `M ${startX.toFixed(2)} ${point.y.toFixed(2)} L ${endX.toFixed(2)} ${point.y.toFixed(2)}`;
  }

  return coordinates
    .slice(startIndex)
    .map(
      (coordinate, index) =>
        `${index === 0 ? 'M' : 'L'} ${coordinate.x.toFixed(2)} ${coordinate.y.toFixed(2)}`
    )
    .join(' ');
}

export function buildSparklineAreaPath(
  values: Array<number | null>,
  width: number,
  height: number,
  padding = 0,
  pointLeftPercents?: number[],
  valueMin?: number,
  valueMax?: number
): string {
  const coordinates = buildSparklineCoordinates(
    values,
    width,
    height,
    padding,
    pointLeftPercents,
    valueMin,
    valueMax
  );
  const linePath = buildSparklinePath(
    values,
    width,
    height,
    padding,
    pointLeftPercents,
    0,
    valueMin,
    valueMax
  );
  if (coordinates.length === 0 || !linePath) return '';

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return `${linePath} L ${last.x.toFixed(2)} ${height.toFixed(2)} L ${first.x.toFixed(2)} ${height.toFixed(2)} Z`;
}

export function buildMatrixColumnLevels(values: Array<number | null>, rows: number): number[] {
  if (values.length === 0) return [];

  const definedValues = values.filter((value): value is number => value !== null);
  if (definedValues.length === 0) {
    return new Array(values.length).fill(0);
  }

  const displayValues = resolveSparklineDisplayValues(values);
  const max = Math.max(...displayValues, 1);
  const min = Math.min(...displayValues, 0);
  const range = max - min;

  return displayValues.map(value => {
    if (range === 0) return Math.max(Math.round(rows * 0.6), 1);

    const ratio = (value - min) / range;
    return Math.max(1, Math.min(rows, Math.round(ratio * (rows - 1)) + 1));
  });
}

export function buildAggregatedSiteSnapshots(
  snapshotsById: Record<string, SiteDailySnapshot[]>,
  siteIds: string[]
): SiteDailySnapshot[] {
  if (siteIds.length === 0) return [];

  const allowedSiteIds = new Set(siteIds);
  const grouped = new Map<string, SiteDailySnapshot>();

  for (const [siteId, snapshots] of Object.entries(snapshotsById)) {
    if (!allowedSiteIds.has(siteId)) continue;

    for (const snapshot of snapshots) {
      const current = grouped.get(snapshot.snapshotDate) || {
        siteId: AGGREGATED_SITE_OPTION_ID,
        snapshotDate: snapshot.snapshotDate,
        capturedAt: snapshot.capturedAt,
        balance: 0,
        todayUsage: 0,
        todayRequests: 0,
        todayPromptTokens: 0,
        todayCompletionTokens: 0,
        totalTokens: 0,
      };

      current.capturedAt = Math.max(current.capturedAt, snapshot.capturedAt);
      current.balance += toNonNegativeBalance(snapshot.balance);
      current.todayUsage += snapshot.todayUsage;
      current.todayRequests += snapshot.todayRequests;
      current.todayPromptTokens += snapshot.todayPromptTokens;
      current.todayCompletionTokens += snapshot.todayCompletionTokens;
      current.totalTokens += snapshot.totalTokens;
      grouped.set(snapshot.snapshotDate, current);
    }
  }

  return [...grouped.values()]
    .sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate))
    .slice(-7);
}

export const MODEL_HEATMAP_BAD_THRESHOLD = 0.6;

export const MODEL_HEATMAP_WARN_THRESHOLD = 0.9;

export function modelHealthTone(item: ModelDistributionItem): {
  bg: string;
  tier: 'good' | 'warn' | 'bad';
} {
  if (item.requests === 0) return { bg: 'var(--surface-2)', tier: 'good' };
  if (item.successRate < MODEL_HEATMAP_BAD_THRESHOLD) {
    return { bg: 'var(--danger)', tier: 'bad' };
  }
  if (item.successRate < MODEL_HEATMAP_WARN_THRESHOLD) {
    return { bg: 'var(--warning)', tier: 'warn' };
  }
  return { bg: 'var(--success)', tier: 'good' };
}

export function tierToColorVar(tier: 'good' | 'warn' | 'bad'): string {
  if (tier === 'bad') return 'var(--danger)';
  if (tier === 'warn') return 'var(--warning)';
  return 'var(--success)';
}

export const FIRST_BYTE_AXIS_MAX_MS = 60_000;

export function formatFirstByteAxisTick(ms: number): string {
  if (ms >= FIRST_BYTE_AXIS_MAX_MS) return '60s+';
  if (ms >= 1000) return `${ms / 1000}s`;
  return `${ms}ms`;
}

export function buildCompactChannelLabel(point: ScatterPoint): string {
  const siteName = truncateTextByDisplayWidth(point.siteName, 7);
  const accountName = truncateTextByDisplayWidth(point.accountName, 6);
  const apiKeyName = truncateTextByDisplayWidth(point.apiKeyName, 7);
  return `${siteName} / ${accountName} / ${apiKeyName}`;
}

export function sankeyLinkTier(successRate: number): 'good' | 'warn' | 'bad' {
  if (successRate < 0.8) return 'bad';
  if (successRate < 0.95) return 'warn';
  return 'good';
}

export function buildSankeyLinkPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): string {
  const cx1 = sourceX + (targetX - sourceX) * 0.5;
  const cx2 = targetX - (targetX - sourceX) * 0.5;
  return `M ${sourceX} ${sourceY} C ${cx1} ${sourceY}, ${cx2} ${targetY}, ${targetX} ${targetY}`;
}

export function formatSankeyModelLabel(label: string): string {
  return truncateTextByDisplayWidth(label, 18);
}

export function formatSankeyChannelLabel(label: string): string {
  const [siteName, accountName, ...rest] = label.split(' / ');
  const apiKeyName = rest.join(' / ');
  const compactSiteName = truncateTextByDisplayWidth(siteName || label, 8);
  if (!accountName) return compactSiteName;

  const compactAccountName = truncateTextByDisplayWidth(accountName, 6);
  if (!apiKeyName) return `${compactSiteName} / ${compactAccountName}`;

  return `${compactSiteName} / ${compactAccountName} / ${truncateTextByDisplayWidth(apiKeyName, 7)}`;
}

export function resolveChannelHealthTone(
  successRate: number,
  isDisabled: boolean
): { background: string; label: string } {
  if (isDisabled || successRate < 0.8) {
    return { background: 'var(--danger)', label: '<80%' };
  }
  if (successRate < 0.95) {
    return { background: 'var(--warning)', label: '80-95%' };
  }
  return { background: 'var(--success)', label: '≥95%' };
}

/** 小时级热力格子（半天分列，右对齐当前半天） */
export interface HeatCell {
  hourStart: number;
  requestCount: number;
  /** 落在 7d 窗口内且未到未来：渲染上色 / 中性灰 */
  visible: boolean;
  hasData: boolean;
}

export const HEAT_HALF_HOURS = 12;

export const HEAT_WINDOW_HOURS = 7 * 24;
// 168

/**
 * 输入: 路由分析小时桶 + 当前时间
 * 输出: 列固定 12 行的完整网格（列数 14 或 15），列单位=半天，右对齐当前所处半天。
 * 当前小时恰为半天末小时（11/23）→ 14 列；否则 15 列（7d 起点那半天整列都在窗口内）。
 * 每列 row 0..11 = 该半天 0..11 小时（上午列 hour 0-11，下午列 hour 12-23），row↔hour 固定。
 * visible = hourStart 落在 (now-7d, nowHour]：显示格恒 168；越界 / 未来为透明占位（visible=false）。
 */
export function buildHourlyHeatCells(buckets: RouteAnalyticsBucket[], now: number): HeatCell[] {
  const nowHour = new Date(now);
  nowHour.setMinutes(0, 0, 0);
  const nowHourTs = nowHour.getTime();
  const hourMs = 60 * 60 * 1000;
  const cutoff = nowHourTs - HEAT_WINDOW_HOURS * hourMs;

  const byHour = new Map<number, number>();
  for (const bucket of buckets) {
    const bucketHour = new Date(bucket.bucketStart);
    bucketHour.setMinutes(0, 0, 0);
    const ts = bucketHour.getTime();
    if (ts <= cutoff || ts > nowHourTs) continue;
    byHour.set(ts, (byHour.get(ts) || 0) + bucket.requestCount);
  }

  const elapsedInHalf = nowHour.getHours() % HEAT_HALF_HOURS;
  const columnCount = elapsedInHalf === HEAT_HALF_HOURS - 1 ? 14 : 15;
  const currentHalfStart = nowHourTs - elapsedInHalf * hourMs;

  const cells: HeatCell[] = [];
  for (let column = 0; column < columnCount; column += 1) {
    const columnStart = currentHalfStart - (columnCount - 1 - column) * HEAT_HALF_HOURS * hourMs;
    for (let row = 0; row < HEAT_HALF_HOURS; row += 1) {
      const hourStart = columnStart + row * hourMs;
      const inWindow = hourStart > cutoff && hourStart <= nowHourTs;
      const requestCount = inWindow ? byHour.get(hourStart) || 0 : 0;
      cells.push({
        hourStart,
        requestCount,
        visible: inWindow,
        hasData: requestCount > 0,
      });
    }
  }
  return cells;
}

export function formatHeatCellTitle(cell: HeatCell): string {
  const date = new Date(cell.hourStart);
  const dateLabel = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const hourLabel = String(date.getHours()).padStart(2, '0');
  return `${dateLabel} ${hourLabel}时 · ${formatCompactNumber(cell.requestCount)} 次`;
}

export function compactTrendSeries(values: Array<number | null>): Array<number | null> {
  const definedValues = values.filter((value): value is number => value !== null);
  if (definedValues.length >= 2 && definedValues.length < values.length) {
    return definedValues;
  }
  return values;
}
