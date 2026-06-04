import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, Gauge, Layers, Loader2, RefreshCw, Wallet, type LucideIcon } from 'lucide-react';
import type {
  RouteAnalyticsBucket,
  RouteAnalyticsDistribution,
  RouteAnalyticsOverview,
  RouteAnalyticsSummary,
  RouteAnalyticsWindow,
  RoutePathState,
} from '../../shared/types/route-proxy';
import type { SiteDailySnapshot } from '../../shared/types/site';
import { AppButton } from '../components/AppButton/AppButton';
import { AppCard, AppCardContent } from '../components/AppCard';
import { useConfigStore } from '../store/configStore';
import { useCustomCliConfigStore } from '../store/customCliConfigStore';
import { useUIStore } from '../store/uiStore';
import { getRouteCliLabel } from '../utils/routeRulePresentation';
import {
  buildSiteCheckinOverviewRows,
  buildSiteOverviewMetrics,
  sumNonNegativeBalances,
  toNonNegativeBalance,
  type SiteCheckinOverviewRow,
  type SiteOverviewMetric,
} from '../utils/siteOverview';
import { computeLatencyPercentiles, formatLatency } from '../utils/routeLatency';
import { computeFirstBytePercentiles, formatTtfb } from '../utils/routeTtfb';
import { ROUTE_SCOPE_ALL, filterBucketsByScope, type RouteScope } from '../utils/routeScopeFilter';
import { buildCustomCliRouteSiteId } from '../../shared/utils/customCliRouteId';
import {
  buildRouteScatterPoints,
  buildScatterLabelCandidates,
  estimateLabelWidth,
  selectScatterLabels,
  type ChannelNameLookup,
  type ScatterPoint,
} from '../utils/routeScatter';
import {
  buildRouteSankeyGraph,
  SANKEY_OTHER_CHANNEL_KEY,
  type SankeyGraph,
} from '../utils/routeSankey';
import {
  buildAxisTicks,
  createSegmentedResponseTimeScale,
  DEFAULT_FIRST_BYTE_AXIS_TICKS,
} from '../utils/routeLogAxis';
import {
  buildModelDistribution,
  squarifiedTreemap,
  type ModelDistributionItem,
} from '../utils/routeModelDistribution';

type RouteWindow = RouteAnalyticsWindow;
const ROUTE_WINDOW_OPTIONS: RouteWindow[] = ['24h', '7d'];
const ROUTE_WINDOW_POINT_COUNTS: Record<RouteWindow, number> = {
  '24h': 24,
  '7d': 7,
};
const AGGREGATED_SITE_OPTION_ID = '__aggregated_site__';
const AGGREGATED_SITE_OPTION_LABEL = '全部站点（聚合）';
const CHECKIN_SITE_NAME_MAX_WIDTH = 7;

type RouteSummary = RouteAnalyticsSummary;
type RouteDistribution = RouteAnalyticsDistribution;

interface TrendPoint {
  key: string;
  timestamp: number;
  label: string;
  hasData: boolean;
  requestCount: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  slowRequestCount: number;
  firstByteHistogram: Record<string, number>;
}

interface RankedMetricItem {
  id: string;
  label: string;
  value: number;
  sublabel?: string;
}

type TrendDirection = 'up' | 'down' | 'flat' | 'none';

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatCurrency(value: number): string {
  if (value === -1) return '∞';
  if (Math.abs(value) >= 100_000) return `$${formatCompactNumber(value)}`;
  return `$${value.toFixed(2)}`;
}

function formatCheckinQuota(value: number): string {
  if (value === 0) return '$0.00';
  const dollars = value / 500000;
  if (dollars >= 0.01) return `$${dollars.toFixed(2)}`;
  if (dollars >= 0.001) return `$${dollars.toFixed(3)}`;
  return `$${dollars.toFixed(4)}`;
}

function getCharacterDisplayWidth(char: string): number {
  return (char.codePointAt(0) || 0) <= 0xff ? 0.5 : 1;
}

function truncateTextByDisplayWidth(text: string, maxWidth: number): string {
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

function formatDateLabel(timestamp: number, window: RouteWindow): string {
  const date = new Date(timestamp);
  if (window === '24h') {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}

function floorRouteTrendDate(timestamp: number, window: RouteWindow): Date {
  const date = new Date(timestamp);
  if (window === '24h') {
    date.setMinutes(0, 0, 0);
    return date;
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

function addRouteTrendStep(date: Date, window: RouteWindow, steps: number): Date {
  const nextDate = new Date(date);
  if (window === '24h') {
    nextDate.setHours(nextDate.getHours() + steps);
    return nextDate;
  }
  nextDate.setDate(nextDate.getDate() + steps);
  return nextDate;
}

function buildRouteTrendKey(timestamp: number, window: RouteWindow): string {
  const date = floorRouteTrendDate(timestamp, window);
  if (window === '24h') {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
  }
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function createEmptyTrendPoint(timestamp: number, window: RouteWindow): TrendPoint {
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
    slowRequestCount: 0,
    firstByteHistogram: {},
  };
}

function formatSnapshotDayLabel(snapshotDate: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(
    parseDayKey(snapshotDate)
  );
}

function buildRouteTrendPoints(buckets: RouteAnalyticsBucket[], window: RouteWindow): TrendPoint[] {
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
    current.slowRequestCount += Object.entries(bucket.latencyHistogram).reduce(
      (sum, [label, count]) => {
        const isSlowBucket =
          label.startsWith('>') ||
          (() => {
            const match = label.match(/-(\d+)ms$/);
            return match ? Number(match[1]) >= 5000 : false;
          })();
        return sum + (isSlowBucket ? count : 0);
      },
      0
    );
    for (const [label, count] of Object.entries(bucket.firstByteHistogram || {})) {
      current.firstByteHistogram[label] = (current.firstByteHistogram[label] || 0) + count;
    }

    grouped.set(key, current);
  }

  return Array.from(grouped.values()).sort((left, right) => left.timestamp - right.timestamp);
}

function formatDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDayKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function buildSevenDaySnapshotSeries(
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

function isFreshToday(timestamp: number | undefined, now: Date = new Date()): boolean {
  return typeof timestamp === 'number' && formatDayKey(new Date(timestamp)) === formatDayKey(now);
}

function buildLiveTodaySnapshot(
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

function mergeLiveTodaySnapshot(
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

function buildTrendDeltaSummary(values: Array<number | null>): {
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

function formatTrendDeltaBadge(
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

function resolveTrendPointLeftPercent(index: number, pointCount: number): number {
  if (pointCount <= 1) return 50;
  const chartWidth = 160;
  const pointPadding = 4;
  const plotWidth = chartWidth - pointPadding * 2;
  const x = pointPadding + (index / (pointCount - 1)) * plotWidth;
  return (x / chartWidth) * 100;
}

function resolveSparklineDisplayValues(values: Array<number | null>): number[] {
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

function buildSparklineBarHeights(values: Array<number | null>, chartHeight: number): number[] {
  if (values.length === 0) return [];

  const displayValues = resolveSparklineDisplayValues(values);
  const definedValues = values.filter((value): value is number => value !== null);
  if (definedValues.length === 0) {
    return new Array(values.length).fill(Math.max(chartHeight * 0.12, 6));
  }

  const max = Math.max(...displayValues, 1);
  const min = Math.min(...displayValues, 0);
  const hasVariance = max !== min;

  return displayValues.map(value => {
    if (!hasVariance) {
      return Math.max(chartHeight * 0.52, 12);
    }

    const ratio = (value - min) / (max - min || 1);
    return Math.max(ratio * chartHeight, 8);
  });
}

function buildSparklineCoordinates(
  values: Array<number | null>,
  width: number,
  height: number,
  padding = 0,
  pointLeftPercents?: number[]
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

  const rawMax = Math.max(...displayValues);
  const rawMin = Math.min(...displayValues);
  const max = Math.max(rawMax, 1);
  const min = Math.min(rawMin, 0);
  const range = max - min || 1;
  const hasVariance = rawMax !== rawMin;

  return displayValues.map((displayValue, index) => {
    const x = resolveX(index);
    const y = hasVariance
      ? padding + plotHeight - ((displayValue - min) / range) * plotHeight
      : padding + plotHeight * 0.45;
    return { value: values[index], x, y };
  });
}

function buildSparklinePath(
  values: Array<number | null>,
  width: number,
  height: number,
  padding = 0,
  pointLeftPercents?: number[],
  startIndex = 0
): string {
  const coordinates = buildSparklineCoordinates(values, width, height, padding, pointLeftPercents);
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

function buildSparklineAreaPath(
  values: Array<number | null>,
  width: number,
  height: number,
  padding = 0,
  pointLeftPercents?: number[]
): string {
  const coordinates = buildSparklineCoordinates(values, width, height, padding, pointLeftPercents);
  const linePath = buildSparklinePath(values, width, height, padding, pointLeftPercents);
  if (coordinates.length === 0 || !linePath) return '';

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return `${linePath} L ${last.x.toFixed(2)} ${height.toFixed(2)} L ${first.x.toFixed(2)} ${height.toFixed(2)} Z`;
}

function buildMatrixColumnLevels(values: Array<number | null>, rows: number): number[] {
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

function buildAggregatedSiteSnapshots(
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

function Sparkline({
  values,
  strokeClass,
  emptyClass = 'bg-[var(--surface-2)]',
  showPointMarkers = false,
  showEmptyPoints = false,
  showBars = false,
  showAreaFill = false,
  showGuides = false,
  hideLine = false,
  barClass = 'text-[var(--accent-soft-strong)]',
  emptyBarClass = 'text-[var(--line-soft)]',
  areaClass = 'text-[var(--accent-soft)]',
  guideClass = 'text-[var(--line-soft)]',
  heightClass = 'h-14',
  chartHeight = 56,
  strokeWidth = 2.5,
  strokeDasharray,
  pointLeftPercents,
  alignBarsToPoints = false,
  skipLeadingNullDraw = false,
  trendSeries,
}: {
  values: Array<number | null>;
  strokeClass: string;
  emptyClass?: string;
  showPointMarkers?: boolean;
  showEmptyPoints?: boolean;
  showBars?: boolean;
  showAreaFill?: boolean;
  showGuides?: boolean;
  hideLine?: boolean;
  barClass?: string;
  emptyBarClass?: string;
  areaClass?: string;
  guideClass?: string;
  heightClass?: string;
  chartHeight?: number;
  strokeWidth?: number;
  strokeDasharray?: string;
  pointLeftPercents?: number[];
  alignBarsToPoints?: boolean;
  skipLeadingNullDraw?: boolean;
  trendSeries?: string;
}) {
  if (values.length === 0) {
    return <div className={`${heightClass} rounded-[var(--radius-md)] ${emptyClass}`} />;
  }

  const chartWidth = 160;
  const pointPadding = Math.max(
    showPointMarkers ? 4 : 0,
    strokeWidth > 0 ? strokeWidth / 2 + 1 : 0
  );
  const coordinates = buildSparklineCoordinates(
    values,
    chartWidth,
    chartHeight,
    pointPadding,
    pointLeftPercents
  );
  const barHeights = buildSparklineBarHeights(values, chartHeight);
  const barWidth = chartWidth / Math.max(values.length, 1);
  const alignedBarWidth =
    coordinates.length > 1
      ? Math.min(
          barWidth * 0.72,
          ((coordinates[coordinates.length - 1].x - coordinates[0].x) /
            Math.max(coordinates.length - 1, 1)) *
            0.58
        )
      : barWidth * 0.36;
  const pointLefts = coordinates
    .map(coordinate => `${((coordinate.x / chartWidth) * 100).toFixed(2)}%`)
    .join(',');
  const firstDefinedIndex = values.findIndex(value => value !== null);
  const lineStartIndex = skipLeadingNullDraw && firstDefinedIndex > 0 ? firstDefinedIndex : 0;
  const leadingNullEndIndex =
    skipLeadingNullDraw && firstDefinedIndex === -1
      ? values.length
      : skipLeadingNullDraw
        ? lineStartIndex
        : 0;

  return (
    <div
      className={`relative ${heightClass} w-full overflow-visible`}
      data-trend-series={trendSeries}
      data-trend-point-lefts={trendSeries ? pointLefts : undefined}
      data-trend-point-markers={trendSeries ? String(showPointMarkers) : undefined}
    >
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="absolute inset-0 h-full w-full overflow-visible"
        preserveAspectRatio="none"
      >
        {showGuides
          ? [0.18, 0.52, 0.86].map(ratio => {
              const y = chartHeight * ratio;
              return (
                <line
                  key={`guide-${ratio}`}
                  x1="0"
                  y1={y}
                  x2={chartWidth}
                  y2={y}
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeDasharray="3 4"
                  vectorEffect="non-scaling-stroke"
                  className={guideClass}
                />
              );
            })
          : null}
        {showAreaFill ? (
          <path
            d={buildSparklineAreaPath(
              values,
              chartWidth,
              chartHeight,
              pointPadding,
              pointLeftPercents
            )}
            fill="currentColor"
            className={areaClass}
          />
        ) : null}
        {showBars
          ? barHeights.map((barHeight, index) => {
              const isEmpty = values[index] === null;
              if (skipLeadingNullDraw && isEmpty && index < leadingNullEndIndex) {
                return null;
              }

              const coordinate = coordinates[index];
              const width = alignBarsToPoints ? alignedBarWidth : barWidth * 0.68;
              const x =
                alignBarsToPoints && coordinate
                  ? coordinate.x - width / 2
                  : index * barWidth + barWidth * 0.16;
              const y = chartHeight - barHeight;

              return (
                <rect
                  key={`bar-${index}`}
                  data-trend-bar-point-index={trendSeries ? index : undefined}
                  data-trend-bar-center-left={
                    trendSeries && coordinate
                      ? `${((coordinate.x / chartWidth) * 100).toFixed(2)}%`
                      : undefined
                  }
                  x={x}
                  y={y}
                  width={width}
                  height={barHeight}
                  rx="2"
                  fill={isEmpty ? 'transparent' : 'currentColor'}
                  stroke={isEmpty ? 'currentColor' : 'none'}
                  strokeWidth={isEmpty ? 1 : 0}
                  className={isEmpty ? emptyBarClass : barClass}
                />
              );
            })
          : null}
        {!hideLine ? (
          <path
            d={buildSparklinePath(
              values,
              chartWidth,
              chartHeight,
              pointPadding,
              pointLeftPercents,
              lineStartIndex
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className={strokeClass}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={strokeDasharray}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      {showPointMarkers
        ? coordinates.map((coordinate, index) => {
            if (coordinate.value === null && !showEmptyPoints) {
              return null;
            }

            const markerClass =
              coordinate.value === null
                ? 'h-[5px] w-[5px] border border-current bg-[var(--surface-2)] text-[var(--line-soft)]'
                : `h-[5.5px] w-[5.5px] bg-current ${strokeClass}`;

            return (
              <span
                key={`${index}-${coordinate.x}`}
                aria-hidden="true"
                className={`pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full ${markerClass}`}
                style={{
                  left: `${(coordinate.x / chartWidth) * 100}%`,
                  top: `${(coordinate.y / chartHeight) * 100}%`,
                }}
              />
            );
          })
        : null}
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-[var(--accent)]" />
          <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        </div>
        {subtitle ? <p className="mt-1 text-xs text-[var(--text-secondary)]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  toneClass = 'text-[var(--text-primary)]',
}: {
  label: string;
  value: string;
  hint?: string;
  toneClass?: string;
}) {
  return (
    <AppCard blur={false} hoverable={false}>
      <AppCardContent className="p-4">
        <div className="text-xs text-[var(--text-secondary)]">{label}</div>
        <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
        {hint ? <div className="mt-2 text-xs text-[var(--text-tertiary)]">{hint}</div> : null}
      </AppCardContent>
    </AppCard>
  );
}

function RouteMetricCard({
  label,
  value,
  hint,
  chip,
  toneClass = 'text-[var(--text-primary)]',
  chipToneClass = 'bg-[var(--surface-1)] text-[var(--text-secondary)]',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  chip?: string;
  toneClass?: string;
  chipToneClass?: string;
}) {
  return (
    <AppCard aria-label={`${label} KPI`} blur={false} hoverable={false} className="h-full">
      <AppCardContent className="flex h-full flex-col p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11px] font-semibold tracking-[0.06em] text-[var(--text-secondary)]">
            {label}
          </div>
          {chip ? (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${chipToneClass}`}
            >
              {chip}
            </span>
          ) : null}
        </div>
        <div
          className={`mt-2.5 text-[26px] font-semibold leading-none tracking-[-0.03em] ${toneClass}`}
        >
          {value}
        </div>
        {hint ? (
          <div
            className="mt-auto truncate whitespace-nowrap pt-3 text-xs leading-5 text-[var(--text-tertiary)]"
            title={typeof hint === 'string' ? hint : undefined}
          >
            {hint}
          </div>
        ) : null}
      </AppCardContent>
    </AppCard>
  );
}

function RouteTrendChart({
  trendPoints,
  successRateTrend,
  ttfbTrend,
  requestTrend,
  failureCounts,
  ttfbP50,
  ttfbP95,
  ttfbP99,
  failureCountTotal,
  scopeOptions,
  scopeValue,
  onScopeChange,
  compact = false,
}: {
  trendPoints: TrendPoint[];
  successRateTrend: Array<number | null>;
  ttfbTrend: Array<number | null>;
  requestTrend: Array<number | null>;
  failureCounts: number[];
  ttfbP50: number | null;
  ttfbP95: number | null;
  ttfbP99: number | null;
  failureCountTotal: number;
  scopeOptions: Array<{ value: string; label: string }>;
  scopeValue: string;
  onScopeChange: (value: string) => void;
  compact?: boolean;
}) {
  const trendChartHeight = compact ? 124 : 132;
  const trendChartMinHeightClass = compact ? 'min-h-[124px]' : 'min-h-[132px]';
  const trendPointLeftPercents = useMemo(
    () => trendPoints.map((_, index) => resolveTrendPointLeftPercent(index, trendPoints.length)),
    [trendPoints]
  );
  const axisLabels = trendPoints.map((point, index) => ({
    key: point.key,
    label: point.label,
    x: trendPointLeftPercents[index] ?? resolveTrendPointLeftPercent(index, trendPoints.length),
  }));
  const hasFailurePoints = failureCounts.some(count => count > 0);
  const failureCountMax = Math.max(...failureCounts, 1);
  const failurePoints = useMemo(
    () =>
      failureCounts.map((count, index) => ({
        count,
        x:
          trendPointLeftPercents[index] ??
          resolveTrendPointLeftPercent(index, failureCounts.length),
      })),
    [failureCounts, trendPointLeftPercents]
  );

  return (
    <AppCard
      aria-label="运行趋势图"
      data-trend-point-count={trendPoints.length}
      blur={false}
      hoverable={false}
      className={compact ? 'min-h-[224px]' : 'min-h-[244px]'}
    >
      <AppCardContent className="flex h-full min-h-0 flex-col p-4">
        <SectionTitle
          icon={Activity}
          title="运行趋势"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="选择运行趋势范围"
                data-trend-scope-select="true"
                value={scopeValue}
                onChange={event => onScopeChange(event.target.value)}
                className="-mt-1.5 h-6 rounded-md border border-[var(--line-soft)] bg-[var(--surface-2)] px-2 text-[11px] text-[var(--text-primary)]"
              >
                {scopeOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          }
        />
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1.5">
            <span
              data-trend-legend="success-rate"
              className="relative h-2 w-4 text-[var(--success)]"
            >
              <span
                data-trend-legend-line="solid"
                className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 bg-current"
              />
              <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
            </span>
            成功率
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span data-trend-legend="ttfb-p95" className="relative h-2 w-4 text-[var(--success)]">
              <span
                data-trend-legend-line="dashed"
                className="absolute left-0 right-0 top-1/2 h-0 -translate-y-1/2 border-t border-dashed border-current"
              />
              <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
            </span>
            首字响应 P95
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm bg-[var(--line-soft)]" />
            请求量
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--danger)]" />
            失败次数
          </span>
          <span className="ml-auto inline-flex flex-wrap items-center gap-2 text-[var(--text-tertiary)]">
            <span>P50 {formatTtfb(ttfbP50)}</span>
            <span>P95 {formatTtfb(ttfbP95)}</span>
            <span>P99 {formatTtfb(ttfbP99)}</span>
            <span>失败 {formatCompactNumber(failureCountTotal)} 次</span>
          </span>
        </div>
        <div
          data-trend-chart-frame="true"
          className="-mx-2 flex min-h-0 flex-1 flex-col rounded-[var(--radius-lg)] bg-[var(--surface-2)] px-5 py-3"
        >
          <div className={`relative ${trendChartMinHeightClass} flex-1`}>
            <div className="absolute inset-0">
              <Sparkline
                values={requestTrend}
                strokeClass="text-transparent"
                showBars
                hideLine
                showGuides
                barClass="text-[var(--line-soft)]"
                emptyBarClass="text-[var(--line-soft)]"
                chartHeight={trendChartHeight}
                heightClass="h-full"
                strokeWidth={0}
                pointLeftPercents={trendPointLeftPercents}
                alignBarsToPoints
                skipLeadingNullDraw
                trendSeries="requests"
              />
            </div>
            <div className="absolute inset-0">
              <Sparkline
                values={successRateTrend}
                strokeClass="text-[var(--success)]"
                showPointMarkers={successRateTrend.length > 0}
                chartHeight={trendChartHeight}
                heightClass="h-full"
                strokeWidth={2.2}
                pointLeftPercents={trendPointLeftPercents}
                skipLeadingNullDraw
                trendSeries="success-rate"
              />
            </div>
            <div className="absolute inset-0">
              <Sparkline
                values={ttfbTrend}
                strokeClass="text-[var(--success)]"
                strokeDasharray="4 3"
                showPointMarkers={ttfbTrend.length > 0}
                chartHeight={trendChartHeight}
                heightClass="h-full"
                strokeWidth={1.8}
                pointLeftPercents={trendPointLeftPercents}
                skipLeadingNullDraw
                trendSeries="ttfb-p95"
              />
            </div>
            {hasFailurePoints
              ? failurePoints.map((point, index) => {
                  if (point.count <= 0) return null;
                  const markerSize = 8 + Math.min(8, (point.count / failureCountMax) * 8);
                  const bottom = 8 + (point.count / failureCountMax) * 18;
                  return (
                    <span
                      key={`fail-marker-${index}`}
                      aria-hidden="true"
                      data-trend-failure-marker="true"
                      data-trend-point-index={index}
                      className="absolute z-20 -translate-x-1/2"
                      style={{ left: `${point.x}%`, bottom }}
                      title={`该时段失败 ${point.count} 次`}
                    >
                      <span
                        className="block rounded-full border-2 border-[var(--danger)] bg-[var(--surface-3)] shadow-[0_0_0_2px_var(--danger-soft)]"
                        style={{ width: markerSize, height: markerSize }}
                      />
                    </span>
                  );
                })
              : null}
          </div>
          <div className="relative mt-2 h-4 text-[9px] leading-3 text-[var(--text-tertiary)]">
            {axisLabels.length > 0 ? (
              axisLabels.map(item => (
                <span
                  key={item.key}
                  data-trend-axis-label="true"
                  className="absolute max-w-[64px] -translate-x-1/2 truncate text-center"
                  style={{ left: `${item.x}%` }}
                >
                  {item.label}
                </span>
              ))
            ) : (
              <span>等待更多趋势分桶</span>
            )}
          </div>
        </div>
      </AppCardContent>
    </AppCard>
  );
}

function useContainerSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ref = useCallback((nextElement: T | null) => {
    setElement(nextElement);
  }, []);

  useLayoutEffect(() => {
    if (!element) return;

    const update = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { ref, size };
}

function modelHealthTone(item: ModelDistributionItem): {
  bg: string;
  tier: 'good' | 'warn' | 'bad';
} {
  if (item.requests === 0) return { bg: 'var(--surface-2)', tier: 'good' };
  if (item.successRate < 0.8) return { bg: 'var(--danger)', tier: 'bad' };
  if (item.successRate < 0.95) return { bg: 'var(--warning)', tier: 'warn' };
  return { bg: 'var(--success)', tier: 'good' };
}

function tierToColorVar(tier: 'good' | 'warn' | 'bad'): string {
  if (tier === 'bad') return 'var(--danger)';
  if (tier === 'warn') return 'var(--warning)';
  return 'var(--success)';
}

interface RouteScatterChartProps {
  points: ScatterPoint[];
  scopeIsSpecific: boolean;
  selectedModel: string | null;
  disabledKeys: Set<string>;
}

const FIRST_BYTE_AXIS_MAX_MS = 60_000;
const TOP_SUCCESS_LABEL_COUNT = 5;

function formatFirstByteAxisTick(ms: number): string {
  if (ms >= FIRST_BYTE_AXIS_MAX_MS) return '60s+';
  if (ms >= 1000) return `${ms / 1000}s`;
  return `${ms}ms`;
}

function buildCompactChannelLabel(point: ScatterPoint): string {
  const siteName = truncateTextByDisplayWidth(point.siteName, 7);
  const accountName = truncateTextByDisplayWidth(point.accountName, 6);
  const apiKeyName = truncateTextByDisplayWidth(point.apiKeyName, 7);
  return `${siteName} / ${accountName} / ${apiKeyName}`;
}

function RouteScatterChart({
  points,
  scopeIsSpecific,
  selectedModel,
  disabledKeys,
}: RouteScatterChartProps) {
  const { ref, size } = useContainerSize<HTMLDivElement>();

  if (points.length === 0) {
    return (
      <div
        ref={ref}
        className="flex h-full min-h-[180px] items-center justify-center text-sm text-[var(--text-secondary)]"
      >
        当前窗口暂无通道流量
      </div>
    );
  }

  const width = Math.max(size.width || 0, 460);
  const height = Math.max(size.height || 0, 232);
  const paddingLeft = 8;
  const labelColumnWidth = 164;
  const paddingTop = 12;
  const successPlotTop = 28;
  const paddingBottom = 22;
  const plotRight = width - labelColumnWidth;
  const plotHeight = height - paddingBottom - successPlotTop;

  const firstByteDomainMin = 0;
  const firstByteDomainMax = FIRST_BYTE_AXIS_MAX_MS;
  const scaleX = createSegmentedResponseTimeScale(
    firstByteDomainMin,
    firstByteDomainMax,
    paddingLeft,
    plotRight
  );
  const ticks = buildAxisTicks(
    firstByteDomainMin,
    firstByteDomainMax,
    DEFAULT_FIRST_BYTE_AXIS_TICKS
  );
  const maxRequests = Math.max(...points.map(point => point.requests), 1);

  const forcedKeys = new Set<string>();
  if (selectedModel !== null) {
    for (const point of points) {
      if (point.canonicalModels.includes(selectedModel)) forcedKeys.add(point.key);
    }
  }
  if (scopeIsSpecific && selectedModel === null) {
    for (const point of points) forcedKeys.add(point.key);
  }

  const shouldShowInlineLabels = scopeIsSpecific || selectedModel !== null;
  const labelKeys = new Set(
    shouldShowInlineLabels
      ? buildScatterLabelCandidates(points, {
          topN: scopeIsSpecific && selectedModel === null ? 4 : 0,
          forcedKeys,
        })
      : []
  );

  const projected = points.map(point => {
    const x = point.ttfbMs !== null ? scaleX.toPixel(point.ttfbMs) : paddingLeft;
    const y = successPlotTop + (1 - point.successRate) * plotHeight;
    const radius = Math.max(4, Math.min(18, Math.sqrt(point.requests / maxRequests) * 18 + 4));
    const isHighlighted =
      selectedModel === null ? true : point.canonicalModels.includes(selectedModel);
    return {
      point,
      x,
      y,
      radius,
      isHighlighted,
      isDisabled: disabledKeys.has(point.key),
    };
  });
  const topSuccessLabels = projected
    .filter(item => item.isHighlighted)
    .sort(
      (a, b) =>
        b.point.successRate - a.point.successRate ||
        b.point.requests - a.point.requests ||
        (a.point.ttfbMs ?? FIRST_BYTE_AXIS_MAX_MS) - (b.point.ttfbMs ?? FIRST_BYTE_AXIS_MAX_MS)
    )
    .slice(0, TOP_SUCCESS_LABEL_COUNT)
    .map((item, index) => ({
      ...item,
      labelX: plotRight + 18,
      labelY: paddingTop + 36 + index * 29,
      text: buildCompactChannelLabel(item.point),
    }));

  const labelCandidates = projected
    .filter(item => labelKeys.has(item.point.key))
    .sort((a, b) => b.point.requests - a.point.requests)
    .map(item => {
      const text = buildCompactChannelLabel(item.point);
      const estimatedWidth = Math.min(estimateLabelWidth(text), 140);
      return {
        key: item.point.key,
        text,
        x: item.x,
        y: item.y - item.radius - 4,
        estimatedWidth,
        estimatedHeight: 14,
      };
    });
  const placedLabels = new Map<string, { x: number; y: number; text: string }>();
  for (const label of selectScatterLabels(labelCandidates, { width, height })) {
    placedLabels.set(label.key, { x: label.x, y: label.y, text: label.text });
  }

  return (
    <div ref={ref} className="relative h-full min-h-[180px] w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-label="通道健康散点矩阵 SVG"
      >
        {/* 网格线 */}
        {ticks.map(tick => {
          const x = scaleX.toPixel(tick);
          return (
            <line
              key={`x-grid-${tick}`}
              data-scatter-grid-line="true"
              x1={x}
              x2={x}
              y1={successPlotTop}
              y2={height - paddingBottom}
              stroke="var(--line-soft)"
              strokeWidth={0.9}
              strokeDasharray="3 3"
              opacity={0.85}
            />
          );
        })}
        {[0, 25, 50, 75, 100].map(percent => {
          const y = successPlotTop + (1 - percent / 100) * plotHeight;
          return (
            <line
              key={`y-grid-${percent}`}
              data-scatter-grid-line="true"
              x1={paddingLeft}
              x2={plotRight}
              y1={y}
              y2={y}
              stroke="var(--line-soft)"
              strokeWidth={0.9}
              strokeDasharray="3 3"
              opacity={0.85}
            />
          );
        })}
        {/* 轴线 */}
        <line
          x1={paddingLeft}
          x2={plotRight}
          y1={height - paddingBottom}
          y2={height - paddingBottom}
          stroke="var(--line-soft)"
          strokeWidth={1}
        />
        <line
          x1={paddingLeft}
          x2={paddingLeft}
          y1={successPlotTop}
          y2={height - paddingBottom}
          stroke="var(--line-soft)"
          strokeWidth={1}
        />
        {/* X 轴 ticks */}
        {ticks.map(tick => {
          const x = scaleX.toPixel(tick);
          return (
            <g key={`x-tick-${tick}`}>
              <line
                x1={x}
                x2={x}
                y1={height - paddingBottom}
                y2={height - paddingBottom + 4}
                stroke="var(--line-soft)"
                strokeWidth={1}
              />
              <text
                x={x}
                y={height - paddingBottom + 14}
                textAnchor="middle"
                fontSize={11}
                fill="var(--text-tertiary)"
              >
                {formatFirstByteAxisTick(tick)}
              </text>
            </g>
          );
        })}
        {/* Y 轴 ticks */}
        {[0, 25, 50, 75, 100].map(percent => {
          const y = successPlotTop + (1 - percent / 100) * plotHeight;
          return (
            <g key={`y-tick-${percent}`}>
              <line
                x1={paddingLeft - 4}
                x2={paddingLeft}
                y1={y}
                y2={y}
                stroke="var(--line-soft)"
                strokeWidth={1}
              />
              <text
                x={paddingLeft - 5}
                y={y + 3}
                textAnchor="end"
                fontSize={11}
                fill="var(--text-tertiary)"
              >
                {percent}%
              </text>
            </g>
          );
        })}
        {/* 数据点 */}
        {projected.map(({ point, x, y, radius, isHighlighted, isDisabled }) => {
          const opacity = isHighlighted ? 1 : 0.25;
          const fill = tierToColorVar(point.tier);
          return (
            <g key={point.key} opacity={opacity}>
              <circle
                cx={x}
                cy={y}
                r={radius}
                fill={fill}
                fillOpacity={0.65}
                stroke={
                  isDisabled ? 'var(--danger)' : isHighlighted ? 'var(--surface-3)' : 'transparent'
                }
                strokeWidth={isDisabled ? 1.5 : 1.2}
              />
              <title>
                {[
                  `${point.siteName} / ${point.accountName} / ${point.apiKeyName}`,
                  point.canonicalModels.length > 0
                    ? `模型：${point.canonicalModels.slice(0, 3).join(', ')}${point.canonicalModels.length > 3 ? '…' : ''}`
                    : '模型：未识别',
                  `请求 ${point.requests}`,
                  `成功率 ${(point.successRate * 100).toFixed(1)}%`,
                  `首字响应 ${formatTtfb(point.ttfbMs)}`,
                  isDisabled ? '已禁用' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </title>
            </g>
          );
        })}
        {/* 右侧成功率 Top5 通道标签 */}
        <text
          x={plotRight + 18}
          y={paddingTop + 8}
          fill="var(--text-secondary)"
          fontSize={10.5}
          fontWeight={600}
          data-scatter-success-label-title="true"
        >
          成功率前五通道
        </text>
        {topSuccessLabels.length > 0 ? (
          topSuccessLabels.map(({ point, x, y, radius, labelX, labelY, text }) => (
            <g
              key={`top-success-${point.key}`}
              data-scatter-success-label="true"
              pointerEvents="none"
            >
              <line
                x1={x + radius}
                y1={y}
                x2={labelX - 5}
                y2={labelY - 4}
                stroke="var(--line-strong)"
                strokeWidth={0.8}
                strokeDasharray="2 2"
              />
              <text
                x={labelX}
                y={labelY - 6}
                fill="var(--text-primary)"
                fontSize={10.5}
                fontWeight={600}
              >
                {text}
              </text>
              <text x={labelX} y={labelY + 7} fill="var(--text-tertiary)" fontSize={10.5}>
                成功 {(point.successRate * 100).toFixed(1)}% · 首字 {formatTtfb(point.ttfbMs)}
              </text>
              <title>{`${point.siteName} / ${point.accountName} / ${point.apiKeyName}`}</title>
            </g>
          ))
        ) : (
          <text x={plotRight + 18} y={paddingTop + 30} fill="var(--text-tertiary)" fontSize={10.5}>
            暂无通道
          </text>
        )}
        {/* 引线 + 标签 */}
        {projected.map(({ point, x, y, radius, isHighlighted }) => {
          const label = placedLabels.get(point.key);
          if (!label || !isHighlighted) return null;
          return (
            <g key={`label-${point.key}`} pointerEvents="none">
              <title>{label.text}</title>
              <line
                data-scatter-inline-label="true"
                x1={x}
                y1={y - radius}
                x2={label.x}
                y2={label.y + 4}
                stroke="var(--line-strong)"
                strokeWidth={0.8}
                strokeDasharray="2 2"
              />
              <rect
                x={label.x - estimateLabelWidth(label.text) / 2}
                y={label.y - 10}
                width={estimateLabelWidth(label.text)}
                height={14}
                rx={3}
                fill="color-mix(in srgb, var(--surface-3) 92%, transparent)"
                stroke="var(--line-soft)"
                strokeWidth={0.6}
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill="var(--text-primary)"
              >
                {label.text}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

interface RouteSankeyChartProps {
  graph: SankeyGraph;
  selectedModel?: string | null;
}

function sankeyLinkTier(successRate: number): 'good' | 'warn' | 'bad' {
  if (successRate < 0.8) return 'bad';
  if (successRate < 0.95) return 'warn';
  return 'good';
}

function buildSankeyLinkPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): string {
  const cx1 = sourceX + (targetX - sourceX) * 0.5;
  const cx2 = targetX - (targetX - sourceX) * 0.5;
  return `M ${sourceX} ${sourceY} C ${cx1} ${sourceY}, ${cx2} ${targetY}, ${targetX} ${targetY}`;
}

function formatSankeyModelLabel(label: string): string {
  return truncateTextByDisplayWidth(label, 18);
}

function formatSankeyChannelLabel(label: string): string {
  const [siteName, accountName, ...rest] = label.split(' / ');
  const apiKeyName = rest.join(' / ');
  const compactSiteName = truncateTextByDisplayWidth(siteName || label, 8);
  if (!accountName) return compactSiteName;

  const compactAccountName = truncateTextByDisplayWidth(accountName, 6);
  if (!apiKeyName) return `${compactSiteName} / ${compactAccountName}`;

  return `${compactSiteName} / ${compactAccountName} / ${truncateTextByDisplayWidth(apiKeyName, 7)}`;
}

function RouteSankeyChart({ graph, selectedModel = null }: RouteSankeyChartProps) {
  if (graph.links.length === 0) {
    return (
      <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-[var(--text-secondary)]">
        当前窗口暂无模型 → 通道流向
      </div>
    );
  }

  const width = 532;
  const height = 248;
  const paddingTop = 8;
  const paddingBottom = 10;
  const nodeWidth = 8;
  const innerHeight = height - paddingTop - paddingBottom;

  const totalModelRequests = graph.models.reduce((sum, m) => sum + m.requests, 0) || 1;
  const totalChannelRequests = graph.channels.reduce((sum, c) => sum + c.requests, 0) || 1;
  const gapBetweenNodes = 4;

  // 计算节点高度（含 gap 调整）
  function layoutColumn<T extends { requests: number }>(
    nodes: T[],
    total: number
  ): Array<{ node: T; y: number; h: number }> {
    const gapTotal = Math.max(0, nodes.length - 1) * gapBetweenNodes;
    const availableHeight = Math.max(innerHeight - gapTotal, 40);
    const minNodeHeight = Math.max(2, Math.min(6, availableHeight / Math.max(nodes.length, 1)));
    const rawHeights = nodes.map(node =>
      Math.max((node.requests / total) * availableHeight, minNodeHeight)
    );
    const rawTotal = rawHeights.reduce((sum, height) => sum + height, 0) || 1;
    const shrinkRatio = rawTotal > availableHeight ? availableHeight / rawTotal : 1;
    let cursor = paddingTop;
    return nodes.map((node, index) => {
      const h = Math.max(rawHeights[index] * shrinkRatio, 2);
      const layout = { node, y: cursor, h };
      cursor += h + gapBetweenNodes;
      return layout;
    });
  }

  const modelColumn = layoutColumn(graph.models, totalModelRequests);
  const channelColumn = layoutColumn(graph.channels, totalChannelRequests);

  const modelLayoutByKey = new Map(modelColumn.map(item => [item.node.key, item]));
  const channelLayoutByKey = new Map(channelColumn.map(item => [item.node.key, item]));

  // 每个节点的流带起点位置（从 y 顶端开始累加）
  const modelOffsetByKey = new Map<string, number>();
  const channelOffsetByKey = new Map<string, number>();
  for (const item of modelColumn) modelOffsetByKey.set(item.node.key, item.y);
  for (const item of channelColumn) channelOffsetByKey.set(item.node.key, item.y);

  const modelColX = 92;
  const channelColX = 368;

  const linksSorted = [...graph.links].sort((a, b) => b.requests - a.requests);
  const selectedModelKey =
    selectedModel === null
      ? null
      : graph.models.find(model => model.canonicalModel === selectedModel)?.key || null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-full w-full overflow-visible"
      preserveAspectRatio="xMidYMid meet"
      aria-label="模型→通道 Sankey 流图 SVG"
      data-sankey-selected-model={selectedModelKey ? selectedModel : undefined}
    >
      {/* 流带（先渲染避免覆盖节点） */}
      {linksSorted.map(link => {
        const modelLayout = modelLayoutByKey.get(link.modelKey);
        const channelLayout = channelLayoutByKey.get(link.channelKey);
        if (!modelLayout || !channelLayout) return null;
        const modelOffset = modelOffsetByKey.get(link.modelKey) ?? 0;
        const channelOffset = channelOffsetByKey.get(link.channelKey) ?? 0;
        const thickness = Math.max(
          (link.requests / totalModelRequests) *
            (innerHeight - Math.max(0, graph.models.length - 1) * gapBetweenNodes),
          2
        );
        const tier = sankeyLinkTier(link.successRate);
        const color = tierToColorVar(tier);
        const isSelectedFlow = selectedModelKey !== null && link.modelKey === selectedModelKey;
        const sourceY = modelOffset + thickness / 2;
        modelOffsetByKey.set(link.modelKey, modelOffset + thickness + 0.5);
        const targetY = channelOffset + thickness / 2;
        channelOffsetByKey.set(link.channelKey, channelOffset + thickness + 0.5);
        const path = buildSankeyLinkPath(modelColX + nodeWidth, sourceY, channelColX, targetY);
        return (
          <path
            key={`link-${link.modelKey}-${link.channelKey}`}
            data-sankey-link="true"
            data-sankey-link-model={link.modelKey}
            data-sankey-link-selected={selectedModelKey ? String(isSelectedFlow) : undefined}
            d={path}
            stroke={color}
            strokeOpacity={selectedModelKey ? (isSelectedFlow ? 0.72 : 0.15) : 0.6}
            strokeWidth={thickness}
            fill="none"
          />
        );
      })}
      {/* 模型节点（左侧） */}
      {modelColumn.map(({ node, y, h }) => {
        const isSelected = selectedModelKey !== null && node.key === selectedModelKey;
        const dim = selectedModelKey !== null && !isSelected;
        return (
          <g
            key={`model-${node.key}`}
            aria-label={`Sankey 模型节点：${node.label}`}
            data-sankey-model-selected={selectedModelKey ? String(isSelected) : undefined}
            opacity={dim ? 0.35 : 1}
          >
            <rect
              x={modelColX}
              y={y}
              width={nodeWidth}
              height={h}
              rx={2}
              fill={isSelected ? 'var(--accent)' : 'var(--text-secondary)'}
              opacity={isSelected ? 1 : 0.85}
            />
            <text
              x={modelColX - 4}
              y={y + h / 2 + 3}
              textAnchor="end"
              fontSize={11}
              fontWeight={isSelected ? 700 : 500}
              fill="var(--text-primary)"
            >
              {formatSankeyModelLabel(node.label)}
            </text>
            <title>{`${node.label} · 请求 ${node.requests}`}</title>
          </g>
        );
      })}
      {/* 通道节点（右侧） */}
      {channelColumn.map(({ node, y, h }) => (
        <g key={`channel-${node.key}`} aria-label={`Sankey 通道节点：${node.label}`}>
          <rect
            x={channelColX}
            y={y}
            width={nodeWidth}
            height={h}
            rx={2}
            fill={node.key === SANKEY_OTHER_CHANNEL_KEY ? 'var(--line-strong)' : 'var(--accent)'}
            opacity={0.85}
          />
          <text
            x={channelColX + nodeWidth + 4}
            y={y + h / 2 + 3}
            textAnchor="start"
            fontSize={10}
            fontWeight={500}
            fill="var(--text-primary)"
          >
            {formatSankeyChannelLabel(node.label)}
          </text>
          <title>{`${node.label} · 请求 ${node.requests}`}</title>
        </g>
      ))}
    </svg>
  );
}

void SANKEY_OTHER_CHANNEL_KEY;

function ModelHeatmapList({
  items,
  selectedModel = null,
  onSelectModel,
}: {
  items: ModelDistributionItem[];
  selectedModel?: string | null;
  onSelectModel?: (canonicalModel: string | null) => void;
}) {
  const { ref, size } = useContainerSize<HTMLDivElement>();

  if (items.length === 0) {
    return (
      <div className="flex min-h-[136px] flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        当前时间窗口暂无模型调用
      </div>
    );
  }

  const layoutWidth = size.width > 0 ? size.width : 360;
  const layoutHeight = size.height > 0 ? size.height : 176;
  const nodes = squarifiedTreemap(items, item => item.requests, layoutWidth, layoutHeight);
  const handleBackgroundClick = onSelectModel ? () => onSelectModel(null) : undefined;
  const toPercent = (value: number, total: number) =>
    `${Math.max(0, Math.min(100, total > 0 ? (value / total) * 100 : 0))}%`;

  return (
    <div
      ref={ref}
      aria-label="模型热力分布 treemap"
      data-treemap-layout-size={`${Math.round(layoutWidth)}x${Math.round(layoutHeight)}`}
      onClick={handleBackgroundClick}
      className="relative min-h-[176px] flex-1 overflow-hidden rounded-[var(--radius-md)] bg-[var(--surface-2)]"
    >
      {nodes.map(({ item, x, y, width, height }) => {
        const tone = modelHealthTone(item);
        const isSelected = selectedModel !== null && item.canonicalModel === selectedModel;
        const dim = selectedModel !== null && !isSelected;
        const successPct = Math.round(item.successRate * 100);
        // 颜色混合比例：成功率越高混入主调越多；失败站点保留 danger 高亮
        const mixPct =
          tone.tier === 'bad' ? 38 + Math.min(item.failureCount, 12) * 3 : 24 + successPct / 5;
        const background = `color-mix(in srgb, ${tone.bg} ${mixPct}%, var(--surface-3))`;
        const textColor =
          tone.tier === 'bad' && successPct < 80
            ? 'var(--text-on-accent, #fff)'
            : 'var(--text-primary)';
        const showLabel = width >= 48 && height >= 28;
        const showSub = width >= 72 && height >= 44;

        return (
          <div
            key={item.id}
            data-treemap-node="true"
            role={onSelectModel ? 'button' : undefined}
            tabIndex={onSelectModel ? 0 : undefined}
            aria-label={`模型：${item.canonicalModel}`}
            aria-pressed={onSelectModel ? isSelected : undefined}
            title={`${item.canonicalModel} · ${getRouteCliLabel(item.cliType)} · 请求 ${item.requests} · 成功率 ${successPct}% · Tokens ${formatCompactNumber(item.totalTokens)}`}
            onClick={
              onSelectModel
                ? event => {
                    event.stopPropagation();
                    onSelectModel(isSelected ? null : item.canonicalModel);
                  }
                : undefined
            }
            onKeyDown={
              onSelectModel
                ? event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectModel(isSelected ? null : item.canonicalModel);
                    }
                  }
                : undefined
            }
            className={`absolute box-border overflow-hidden border px-1.5 py-1 transition-[opacity,box-shadow] duration-150 ${
              isSelected
                ? 'border-[color-mix(in_srgb,var(--accent)_42%,var(--line-muted))] shadow-[0_0_0_2px_var(--surface-3),0_4px_18px_-4px_rgba(0,0,0,0.45)] z-10'
                : 'border-[var(--surface-2)]'
            } ${dim ? 'opacity-40' : 'opacity-100'} ${onSelectModel ? 'cursor-pointer' : ''}`}
            style={{
              left: toPercent(x, layoutWidth),
              top: toPercent(y, layoutHeight),
              width: toPercent(width, layoutWidth),
              height: toPercent(height, layoutHeight),
              background,
              color: textColor,
            }}
          >
            {showLabel ? (
              <div className="break-all text-[11px] font-semibold leading-tight">
                {item.canonicalModel}
              </div>
            ) : null}
            {showSub ? (
              <div className="break-all text-[10px] leading-tight opacity-80">
                {formatCompactNumber(item.requests)} req · {successPct}%
                {item.failureCount > 0 ? ` · 失败 ${item.failureCount}` : ''}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
function resolveChannelHealthTone(
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

void resolveChannelHealthTone; // 散点 / Sankey 将在后续 PR 中复用

function DotMatrixChart({
  values,
  activeClass = 'bg-[var(--accent)] opacity-75',
  inactiveClass = 'bg-[var(--line-soft)] opacity-30',
  rows = 6,
}: {
  values: Array<number | null>;
  activeClass?: string;
  inactiveClass?: string;
  rows?: number;
}) {
  const levels = buildMatrixColumnLevels(values, rows);

  if (levels.length === 0) {
    return <div className="h-full rounded-[var(--radius-md)] bg-[var(--surface-2)]" />;
  }

  return (
    <div className="relative h-full overflow-hidden rounded-[var(--radius-md)]">
      <div className="grid h-full grid-cols-7 gap-1.5">
        {levels.map((level, columnIndex) => (
          <div
            key={`matrix-col-${columnIndex}`}
            className="grid h-full grid-rows-6 place-items-center gap-1 [contain-intrinsic-size:56px] [content-visibility:auto]"
          >
            {Array.from({ length: rows }, (_, rowIndex) => {
              const active = values[columnIndex] !== null && rows - rowIndex <= level;
              return (
                <span
                  key={`matrix-dot-${columnIndex}-${rowIndex}`}
                  className={`block h-1.5 w-1.5 rounded-full ${active ? activeClass : inactiveClass}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--surface-1)]/35 to-transparent" />
    </div>
  );
}

function compactTrendSeries(values: Array<number | null>): Array<number | null> {
  const definedValues = values.filter((value): value is number => value !== null);
  if (definedValues.length >= 2 && definedValues.length < values.length) {
    return definedValues;
  }
  return values;
}

function SiteTrendCard({
  label,
  values,
  valueFormatter,
  chartVariant,
  strokeClass,
  barClass = 'text-[var(--accent-soft-strong)]',
  areaClass = 'text-[var(--accent-soft)]',
  latestSnapshotLabel,
  showPointMarkers = false,
  showEmptyPoints = false,
  showAreaFill = false,
  strokeWidth = 2.1,
}: {
  label: string;
  values: Array<number | null>;
  valueFormatter: (value: number) => string;
  chartVariant: 'area' | 'bars' | 'line' | 'matrix';
  strokeClass: string;
  barClass?: string;
  areaClass?: string;
  latestSnapshotLabel: string | null;
  showPointMarkers?: boolean;
  showEmptyPoints?: boolean;
  showAreaFill?: boolean;
  strokeWidth?: number;
}) {
  const summary = buildTrendDeltaSummary(values);
  const badgeLabel = formatTrendDeltaBadge(
    summary.direction,
    summary.deltaPercent,
    summary.previousValue
  );
  const badgeClass =
    summary.direction === 'up'
      ? 'bg-[var(--success-soft)] text-[var(--success)]'
      : summary.direction === 'down'
        ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
        : 'bg-[var(--surface-2)] text-[var(--text-secondary)]';
  const valueLabel = summary.currentValue === null ? '—' : valueFormatter(summary.currentValue);
  const chartValues =
    chartVariant === 'bars' || chartVariant === 'matrix' ? values : compactTrendSeries(values);

  return (
    <div
      aria-label={`${label} 趋势卡片`}
      className="relative flex min-h-[208px] flex-col overflow-hidden rounded-[18px] border border-[var(--line-muted)] bg-[var(--surface-3)] px-4 pb-3 pt-4 shadow-[var(--shadow-sm)]"
    >
      <div className="relative z-10 flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-[11px] font-semibold tracking-[0.06em] text-[var(--text-secondary)]">
            {label}
          </h3>
          <span
            className={`shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}
          >
            {badgeLabel}
          </span>
        </div>
        <div className="mt-2 text-[18px] font-semibold leading-none tracking-[-0.01em] text-[var(--text-primary)] xl:text-[20px]">
          {valueLabel}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-4 right-4 z-10 text-[10px] leading-none text-[var(--text-tertiary)]">
        {latestSnapshotLabel ? `最近记录 ${latestSnapshotLabel}` : '等待更多日级快照'}
      </div>
      {chartVariant === 'area' ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 h-[104px] overflow-hidden">
          <Sparkline
            values={chartValues}
            strokeClass={strokeClass}
            showAreaFill={showAreaFill}
            areaClass={areaClass}
            chartHeight={86}
            heightClass="h-full"
            strokeWidth={2.2}
          />
        </div>
      ) : null}
      {chartVariant === 'bars' ? (
        <div className="pointer-events-none absolute bottom-8 left-4 right-4 h-[78px]">
          <Sparkline
            values={chartValues}
            strokeClass="text-transparent"
            showBars
            hideLine
            barClass={barClass}
            emptyBarClass="text-[var(--line-soft)]"
            chartHeight={72}
            heightClass="h-full"
            strokeWidth={0}
          />
        </div>
      ) : null}
      {chartVariant === 'line' ? (
        <div className="pointer-events-none absolute bottom-8 left-4 right-4 h-[74px]">
          <Sparkline
            values={chartValues}
            strokeClass={strokeClass}
            showPointMarkers={showPointMarkers}
            showEmptyPoints={showEmptyPoints}
            chartHeight={64}
            heightClass="h-full"
            strokeWidth={strokeWidth}
          />
        </div>
      ) : null}
      {chartVariant === 'matrix' ? (
        <div className="pointer-events-none absolute bottom-8 left-4 right-4 h-[78px]">
          <DotMatrixChart
            values={chartValues}
            activeClass="bg-[var(--warning)] opacity-75"
            inactiveClass="bg-[var(--line-soft)] opacity-30"
          />
        </div>
      ) : null}
    </div>
  );
}

function RankedList({
  items,
  valueFormatter,
  emptyText,
  maxValue,
  compact = false,
}: {
  items: RankedMetricItem[];
  valueFormatter: (value: number) => string;
  emptyText: string;
  maxValue?: number;
  compact?: boolean;
}) {
  if (items.length === 0) {
    return <div className="py-6 text-center text-sm text-[var(--text-secondary)]">{emptyText}</div>;
  }

  const scaleMax = maxValue ?? Math.max(...items.map(item => item.value), 1);
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {items.map(item => (
        <div
          key={item.id}
          className={`${compact ? 'space-y-0.5' : 'space-y-1'} [contain-intrinsic-size:56px] [content-visibility:auto]`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              {compact ? (
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">
                    {item.label}
                  </span>
                  {item.sublabel ? (
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      {item.sublabel}
                    </span>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {item.label}
                  </div>
                  {item.sublabel ? (
                    <div className="truncate text-xs text-[var(--text-secondary)]">
                      {item.sublabel}
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <div
              className={`${compact ? 'text-[13px]' : 'text-sm'} shrink-0 font-semibold text-[var(--text-primary)]`}
            >
              {valueFormatter(item.value)}
            </div>
          </div>
          <div className={`${compact ? 'h-1.5' : 'h-2'} rounded-full bg-[var(--surface-1)]`}>
            <div
              className={`${compact ? 'h-1.5' : 'h-2'} rounded-full bg-[var(--accent)]`}
              style={{ width: `${Math.max((item.value / scaleMax) * 100, 4)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function CheckinStatusList({
  items,
  emptyText,
}: {
  items: SiteCheckinOverviewRow[];
  emptyText: string;
}) {
  if (items.length === 0) {
    return <div className="py-6 text-center text-sm text-[var(--text-secondary)]">{emptyText}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        aria-label="每日签到概览滚动区域"
        className="min-h-0 flex-1 overflow-y-auto pr-4 [scrollbar-gutter:stable]"
      >
        <div className="space-y-0.5">
          {items.map(item => {
            const statusLabel =
              item.pendingCheckins > 0
                ? `待签 ${item.pendingCheckins}/${item.checkinTargetCount}`
                : item.completedCheckins > 0
                  ? '已签到'
                  : '待确认';
            const truncatedSiteName = truncateTextByDisplayWidth(
              item.siteName,
              CHECKIN_SITE_NAME_MAX_WIDTH
            );
            const statusClass =
              item.pendingCheckins > 0
                ? 'bg-[var(--warning-soft)] text-[var(--warning)]'
                : item.completedCheckins > 0
                  ? 'bg-[var(--success-soft)] text-[var(--success)]'
                  : 'bg-[var(--surface-1)] text-[var(--text-secondary)]';

            return (
              <div
                key={item.id}
                className="grid grid-cols-[minmax(0,1.4fr)_108px_44px_58px] items-center gap-2 py-1 [contain-intrinsic-size:40px] [content-visibility:auto]"
              >
                <div className="min-w-0 truncate whitespace-nowrap text-[12px] font-medium text-[var(--text-primary)]">
                  <span title={item.siteName}>{truncatedSiteName}</span>
                  <span className="ml-1 text-[10px] font-normal text-[var(--text-secondary)]">
                    / {item.accountName}
                  </span>
                </div>
                <div className="truncate whitespace-nowrap text-left text-[10px] text-[var(--text-secondary)]">
                  <span>本月 {formatCompactNumber(item.monthCheckinCount)}</span>
                  <span className="mx-1">/</span>
                  <span>累计 {formatCompactNumber(item.totalCheckins)}</span>
                </div>
                <div className="flex justify-start">
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${statusClass}`}
                  >
                    {statusLabel}
                  </span>
                </div>
                <div className="text-right text-[11px] font-medium text-[var(--text-primary)]">
                  {item.todayCheckinQuota > 0
                    ? `+${formatCheckinQuota(item.todayCheckinQuota)}`
                    : '—'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface SubViewProps {
  setPageHeaderActions?: (actions: ReactNode | null) => void;
  isOverviewActive: boolean;
  isVisible: boolean;
}

export function DataOverviewPage({
  setPageHeaderActions,
}: {
  setPageHeaderActions?: (actions: ReactNode | null) => void;
} = {}) {
  const activeTab = useUIStore(state => state.activeTab);
  const view = useUIStore(state => state.overviewSubtab);
  const isOverviewActive = activeTab === 'overview';
  const isRouteView = view === 'route';
  const isSiteView = !isRouteView;

  return (
    <div
      className="relative min-h-0 flex-1"
      data-overview-views-keepalive="true"
      data-overview-active-view={isRouteView ? 'route' : 'site'}
    >
      <div
        data-testid="overview-view-site"
        aria-hidden={!isSiteView}
        className={`absolute inset-0 min-h-0 transition-opacity duration-100 ${
          isSiteView ? 'visible z-10 opacity-100' : 'invisible z-0 opacity-0 pointer-events-none'
        }`}
      >
        <SiteOverviewView
          setPageHeaderActions={setPageHeaderActions}
          isOverviewActive={isOverviewActive}
          isVisible={isSiteView}
        />
      </div>
      <div
        data-testid="overview-view-route"
        aria-hidden={!isRouteView}
        className={`absolute inset-0 min-h-0 transition-opacity duration-100 ${
          isRouteView ? 'visible z-10 opacity-100' : 'invisible z-0 opacity-0 pointer-events-none'
        }`}
      >
        <RouteOverviewView
          setPageHeaderActions={setPageHeaderActions}
          isOverviewActive={isOverviewActive}
          isVisible={isRouteView}
        />
      </div>
    </div>
  );
}

function SiteOverviewView({ setPageHeaderActions, isOverviewActive, isVisible }: SubViewProps) {
  const config = useConfigStore(state => state.config);
  const [siteSnapshotsById, setSiteSnapshotsById] = useState<Record<string, SiteDailySnapshot[]>>(
    {}
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string>(AGGREGATED_SITE_OPTION_ID);

  const siteMetrics = useMemo(() => (config ? buildSiteOverviewMetrics(config) : []), [config]);
  const rankedSiteMetrics = useMemo(
    () =>
      [...siteMetrics].sort(
        (left, right) => right.todayUsage - left.todayUsage || right.balance - left.balance
      ),
    [siteMetrics]
  );

  useEffect(() => {
    if (
      selectedSiteId !== AGGREGATED_SITE_OPTION_ID &&
      !rankedSiteMetrics.some(metric => metric.siteId === selectedSiteId)
    ) {
      setSelectedSiteId(AGGREGATED_SITE_OPTION_ID);
    }
  }, [rankedSiteMetrics, selectedSiteId]);

  const loadSnapshots = useCallback(async () => {
    if (!window.electronAPI.overview?.getSiteDailySnapshots) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const snapshotsRes = await window.electronAPI.overview.getSiteDailySnapshots({ days: 30 });
      setSiteSnapshotsById(snapshotsRes?.success ? snapshotsRes.data || {} : {});
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : '加载站点历史快照失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOverviewActive) return;
    void loadSnapshots();
  }, [isOverviewActive, loadSnapshots]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.appData?.onChanged?.(({ domains }) => {
      if (!isOverviewActive) return;
      if (!domains.includes('site-overview')) return;
      void loadSnapshots();
    });
    return () => {
      unsubscribe?.();
    };
  }, [isOverviewActive, loadSnapshots]);

  const enabledSiteMetrics = useMemo(
    () => siteMetrics.filter(metric => metric.enabled),
    [siteMetrics]
  );
  const checkinSiteMetrics = useMemo(
    () => enabledSiteMetrics.filter(metric => metric.supportsCheckin),
    [enabledSiteMetrics]
  );
  const checkinRows = useMemo(() => (config ? buildSiteCheckinOverviewRows(config) : []), [config]);
  const orderedCheckinRows = useMemo(
    () =>
      [...checkinRows].sort(
        (left, right) =>
          right.pendingCheckins - left.pendingCheckins ||
          right.todayCheckinQuota - left.todayCheckinQuota ||
          right.monthCheckinCount - left.monthCheckinCount
      ),
    [checkinRows]
  );
  const activeSiteCount = enabledSiteMetrics.length;
  const visibleSiteCount = siteMetrics.length;
  const activeModelCount = siteMetrics.reduce((sum, metric) => sum + metric.modelCount, 0);
  const totalBalance = sumNonNegativeBalances(siteMetrics);
  const totalUsage = siteMetrics.reduce((sum, metric) => sum + metric.todayUsage, 0);
  const totalTodayRequestCount = siteMetrics.reduce((sum, metric) => sum + metric.todayRequests, 0);
  const totalTodayPromptTokenCount = siteMetrics.reduce(
    (sum, metric) => sum + metric.todayPromptTokens,
    0
  );
  const totalTodayCompletionTokenCount = siteMetrics.reduce(
    (sum, metric) => sum + metric.todayCompletionTokens,
    0
  );
  const totalTodayTokenCount = totalTodayPromptTokenCount + totalTodayCompletionTokenCount;
  const totalCheckinQuota = checkinSiteMetrics.reduce(
    (sum, metric) => sum + metric.todayCheckinQuota,
    0
  );
  const pendingCheckinSiteCount = checkinSiteMetrics.filter(
    metric => metric.pendingCheckins > 0
  ).length;
  const completedCheckinSiteCount = checkinSiteMetrics.filter(
    metric => metric.pendingCheckins === 0 && metric.completedCheckins > 0
  ).length;
  const aggregatedSiteMetric = useMemo<SiteOverviewMetric | null>(() => {
    if (siteMetrics.length === 0) return null;

    return {
      siteId: AGGREGATED_SITE_OPTION_ID,
      siteName: AGGREGATED_SITE_OPTION_LABEL,
      enabled: true,
      accountCount: siteMetrics.reduce((sum, metric) => sum + metric.accountCount, 0),
      balance: sumNonNegativeBalances(siteMetrics),
      todayUsage: siteMetrics.reduce((sum, metric) => sum + metric.todayUsage, 0),
      todayRequests: siteMetrics.reduce((sum, metric) => sum + metric.todayRequests, 0),
      todayPromptTokens: siteMetrics.reduce((sum, metric) => sum + metric.todayPromptTokens, 0),
      todayCompletionTokens: siteMetrics.reduce(
        (sum, metric) => sum + metric.todayCompletionTokens,
        0
      ),
      totalTokens: siteMetrics.reduce((sum, metric) => sum + metric.totalTokens, 0),
      modelCount: siteMetrics.reduce((sum, metric) => sum + metric.modelCount, 0),
      lastRefresh: siteMetrics.reduce((max, metric) => Math.max(max, metric.lastRefresh), 0),
      hasError: siteMetrics.some(metric => metric.hasError),
      supportsCheckin: checkinSiteMetrics.length > 0,
      checkinTargetCount: checkinSiteMetrics.reduce(
        (sum, metric) => sum + metric.checkinTargetCount,
        0
      ),
      pendingCheckins: checkinSiteMetrics.reduce((sum, metric) => sum + metric.pendingCheckins, 0),
      completedCheckins: checkinSiteMetrics.reduce(
        (sum, metric) => sum + metric.completedCheckins,
        0
      ),
      todayCheckinQuota: totalCheckinQuota,
      monthCheckinCount: checkinSiteMetrics.reduce(
        (sum, metric) => sum + metric.monthCheckinCount,
        0
      ),
      totalCheckins: checkinSiteMetrics.reduce((sum, metric) => sum + metric.totalCheckins, 0),
    };
  }, [checkinSiteMetrics, siteMetrics, totalCheckinQuota]);
  const aggregatedSiteSnapshots = useMemo(
    () =>
      buildAggregatedSiteSnapshots(
        siteSnapshotsById,
        siteMetrics.map(metric => metric.siteId)
      ),
    [siteMetrics, siteSnapshotsById]
  );
  const selectedSiteSnapshots = useMemo(
    () =>
      selectedSiteId === AGGREGATED_SITE_OPTION_ID
        ? aggregatedSiteSnapshots
        : [...(siteSnapshotsById[selectedSiteId] || [])]
            .sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate))
            .slice(-7),
    [aggregatedSiteSnapshots, selectedSiteId, siteSnapshotsById]
  );
  const currentSiteMetric =
    selectedSiteId === AGGREGATED_SITE_OPTION_ID
      ? aggregatedSiteMetric
      : rankedSiteMetrics.find(metric => metric.siteId === selectedSiteId) || null;
  const selectedSiteSnapshotsWithLiveToday = useMemo(
    () => mergeLiveTodaySnapshot(selectedSiteSnapshots, buildLiveTodaySnapshot(currentSiteMetric)),
    [currentSiteMetric, selectedSiteSnapshots]
  );
  const selectedSiteSnapshotSeries = useMemo(
    () => buildSevenDaySnapshotSeries(selectedSiteSnapshotsWithLiveToday),
    [selectedSiteSnapshotsWithLiveToday]
  );
  const latestSelectedSnapshotLabel = useMemo(() => {
    const latestSnapshot = [...selectedSiteSnapshotSeries]
      .reverse()
      .find((snapshot): snapshot is SiteDailySnapshot => snapshot !== null);
    return latestSnapshot ? formatSnapshotDayLabel(latestSnapshot.snapshotDate) : null;
  }, [selectedSiteSnapshotSeries]);

  const balanceRankItems = useMemo(
    () =>
      [...enabledSiteMetrics]
        .sort((left, right) => right.balance - left.balance)
        .map(metric => ({
          id: `${metric.siteId}:balance`,
          label: metric.siteName,
          value: metric.balance,
          sublabel: `${metric.accountCount || 1} 个账户 / ${metric.modelCount} 个模型`,
        })),
    [enabledSiteMetrics]
  );
  const usageRankItems = useMemo(
    () =>
      [...enabledSiteMetrics]
        .sort((left, right) => right.todayUsage - left.todayUsage)
        .map(metric => ({
          id: `${metric.siteId}:usage`,
          label: metric.siteName,
          value: metric.todayUsage,
          sublabel: `请求 ${metric.todayRequests} / Tokens ${formatCompactNumber(metric.totalTokens)}`,
        })),
    [enabledSiteMetrics]
  );

  const headerActions = useMemo(
    () => (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <AppButton
          variant="tertiary"
          size="sm"
          onClick={() => void loadSnapshots()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          刷新
        </AppButton>
      </div>
    ),
    [loadSnapshots, loading]
  );

  useEffect(() => {
    if (!isOverviewActive || !isVisible) return;
    setPageHeaderActions?.(headerActions);
    return () => {
      setPageHeaderActions?.(null);
    };
  }, [headerActions, isOverviewActive, isVisible, setPageHeaderActions]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="space-y-4">
        {error ? (
          <AppCard blur={false} hoverable={false}>
            <AppCardContent className="p-4 text-sm text-[var(--danger)]">{error}</AppCardContent>
          </AppCard>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="可用站点数"
            value={formatCompactNumber(activeSiteCount)}
            hint={`展示站点 ${visibleSiteCount} 个 / 模型 ${formatCompactNumber(activeModelCount)} 个`}
          />
          <MetricCard
            label="站点总余额"
            value={formatCurrency(totalBalance)}
            hint={`最近刷新 ${
              currentSiteMetric?.siteId === AGGREGATED_SITE_OPTION_ID
                ? '按站点聚合'
                : currentSiteMetric?.siteName || '按活跃站点排序'
            }`}
          />
          <MetricCard
            label="今日消费"
            value={formatCurrency(totalUsage)}
            hint={`今日请求 ${formatCompactNumber(totalTodayRequestCount)} · 今日 Tokens ${formatCompactNumber(totalTodayTokenCount)}`}
            toneClass="text-[var(--warning)]"
          />
          <MetricCard
            label="今日签到收益"
            value={formatCheckinQuota(totalCheckinQuota)}
            hint={`已签 ${completedCheckinSiteCount} 个 / 待签 ${pendingCheckinSiteCount} 个`}
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] xl:items-stretch">
          <AppCard
            blur={false}
            hoverable={false}
            role="region"
            aria-label="每日签到概览"
            className="xl:h-[248px]"
          >
            <AppCardContent className="flex h-full flex-col p-3.5">
              <SectionTitle icon={Activity} title="每日签到概览" />
              <div className="mt-0.5 min-h-0 flex-1">
                <CheckinStatusList
                  items={orderedCheckinRows}
                  emptyText="当前没有可展示的签到站点"
                />
              </div>
            </AppCardContent>
          </AppCard>

          <AppCard
            blur={false}
            hoverable={false}
            role="region"
            aria-label="站点资源概览"
            className="xl:h-[248px]"
          >
            <AppCardContent className="flex h-full flex-col p-3.5">
              <SectionTitle icon={Wallet} title="站点资源概览" />
              <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-2">
                <div className="min-h-0">
                  <div className="mb-2 text-xs text-[var(--text-secondary)]">余额最高站点</div>
                  <div className="h-full overflow-y-auto pr-1">
                    <RankedList
                      items={balanceRankItems}
                      valueFormatter={formatCurrency}
                      emptyText="暂无站点余额数据"
                      compact
                    />
                  </div>
                </div>
                <div className="min-h-0">
                  <div className="mb-2 text-xs text-[var(--text-secondary)]">今日消费最高站点</div>
                  <div className="h-full overflow-y-auto pr-1">
                    <RankedList
                      items={usageRankItems}
                      valueFormatter={formatCurrency}
                      emptyText="暂无站点消费数据"
                      compact
                    />
                  </div>
                </div>
              </div>
            </AppCardContent>
          </AppCard>
        </div>

        <AppCard blur={false} hoverable={false}>
          <AppCardContent className="p-4">
            <SectionTitle
              icon={Activity}
              title="站点历史趋势"
              actions={
                <select
                  aria-label="选择站点历史"
                  value={selectedSiteId}
                  onChange={event =>
                    setSelectedSiteId(event.target.value || AGGREGATED_SITE_OPTION_ID)
                  }
                  className="h-7 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 text-xs text-[var(--text-primary)]"
                >
                  <option value={AGGREGATED_SITE_OPTION_ID}>{AGGREGATED_SITE_OPTION_LABEL}</option>
                  {rankedSiteMetrics.map(metric => (
                    <option key={metric.siteId} value={metric.siteId}>
                      {metric.siteName}
                    </option>
                  ))}
                </select>
              }
            />

            {selectedSiteSnapshotSeries.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SiteTrendCard
                  label="近 7 日余额波动"
                  values={selectedSiteSnapshotSeries.map(snapshot => snapshot?.balance ?? null)}
                  valueFormatter={formatCurrency}
                  chartVariant="area"
                  areaClass="text-[var(--success-soft)]"
                  latestSnapshotLabel={latestSelectedSnapshotLabel}
                  showAreaFill
                  showPointMarkers
                  showEmptyPoints
                  strokeClass="text-[var(--success)]"
                />
                <SiteTrendCard
                  label="近 7 日消费趋势"
                  values={selectedSiteSnapshotSeries.map(snapshot => snapshot?.todayUsage ?? null)}
                  valueFormatter={formatCurrency}
                  chartVariant="bars"
                  strokeClass="text-[var(--accent)]"
                  latestSnapshotLabel={latestSelectedSnapshotLabel}
                  barClass="text-[var(--accent)]"
                  strokeWidth={2.4}
                />
                <SiteTrendCard
                  label="近 7 日请求量 (Reqs)"
                  values={selectedSiteSnapshotSeries.map(
                    snapshot => snapshot?.todayRequests ?? null
                  )}
                  valueFormatter={formatCompactNumber}
                  chartVariant="line"
                  strokeClass="text-[var(--accent)]"
                  latestSnapshotLabel={latestSelectedSnapshotLabel}
                  showPointMarkers
                  showEmptyPoints
                />
                <SiteTrendCard
                  label="近 7 日 Tokens"
                  values={selectedSiteSnapshotSeries.map(snapshot => snapshot?.totalTokens ?? null)}
                  valueFormatter={formatCompactNumber}
                  chartVariant="matrix"
                  strokeClass="text-[var(--text-primary)]"
                  areaClass="text-[var(--accent-soft)]"
                  latestSnapshotLabel={latestSelectedSnapshotLabel}
                  strokeWidth={3.25}
                />
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-[var(--text-secondary)]">
                暂无站点每日快照。完成一次站点检测后，这里会开始累计日级历史。
              </div>
            )}
          </AppCardContent>
        </AppCard>
      </div>
    </div>
  );
}

const ROUTE_SCOPE_AGGREGATED_OPTION = '__aggregated__';
const ROUTE_SCOPE_SITE_PREFIX = 'site:';
const ROUTE_SCOPE_CUSTOM_PREFIX = 'customCli:';

function serializeRouteScope(scope: RouteScope): string {
  if (scope.kind === 'site') return `${ROUTE_SCOPE_SITE_PREFIX}${scope.siteId}`;
  if (scope.kind === 'customCli') return `${ROUTE_SCOPE_CUSTOM_PREFIX}${scope.customCliId}`;
  return ROUTE_SCOPE_AGGREGATED_OPTION;
}

function parseRouteScopeOption(value: string): RouteScope {
  if (value.startsWith(ROUTE_SCOPE_SITE_PREFIX)) {
    return { kind: 'site', siteId: value.slice(ROUTE_SCOPE_SITE_PREFIX.length) };
  }
  if (value.startsWith(ROUTE_SCOPE_CUSTOM_PREFIX)) {
    return { kind: 'customCli', customCliId: value.slice(ROUTE_SCOPE_CUSTOM_PREFIX.length) };
  }
  return ROUTE_SCOPE_ALL;
}

interface RouteScopeOption {
  value: string;
  label: string;
}

function RouteOverviewView({ setPageHeaderActions, isOverviewActive, isVisible }: SubViewProps) {
  const config = useConfigStore(state => state.config);
  const customCliConfigs = useCustomCliConfigStore(state => state.configs);
  const [routeWindow, setRouteWindow] = useState<RouteWindow>('7d');
  const [scope, setScope] = useState<RouteScope>(ROUTE_SCOPE_ALL);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [routeDistribution, setRouteDistribution] = useState<RouteDistribution | null>(null);
  const [routePathStates, setRoutePathStates] = useState<Record<string, RoutePathState>>({});
  const [routeRulesById, setRouteRulesById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopeOptions = useMemo<RouteScopeOption[]>(() => {
    const siteOptions: RouteScopeOption[] = (config?.sites || [])
      .filter(site => Boolean(site?.id) && site.enabled !== false)
      .map(site => ({
        value: serializeRouteScope({ kind: 'site', siteId: site.id! }),
        label: site.name?.trim() || site.id!,
      }));
    const customOptions: RouteScopeOption[] = (customCliConfigs || [])
      .filter(item => Boolean(item?.id))
      .map(item => ({
        value: serializeRouteScope({ kind: 'customCli', customCliId: item.id }),
        label: `${item.name?.trim() || '自定义 CLI'}（自定义 CLI）`,
      }));
    return [
      { value: ROUTE_SCOPE_AGGREGATED_OPTION, label: '全部聚合' },
      ...siteOptions,
      ...customOptions,
    ];
  }, [config, customCliConfigs]);

  useEffect(() => {
    if (scope.kind === 'all') return;
    const exists = scopeOptions.some(option => option.value === serializeRouteScope(scope));
    if (!exists) {
      setScope(ROUTE_SCOPE_ALL);
    }
  }, [scope, scopeOptions]);

  useEffect(() => {
    setSelectedModel(null);
  }, [scope]);

  const loadRouteData = useCallback(async () => {
    const routeApi = window.electronAPI.route;
    if (!routeApi) {
      setError('当前环境未暴露 route IPC 接口。');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const analyticsPromise: Promise<{
        summary: RouteAnalyticsOverview['summary'] | null;
        distribution: RouteAnalyticsOverview['distribution'] | null;
      }> = routeApi.getAnalyticsOverview
        ? routeApi.getAnalyticsOverview({ window: routeWindow }).then(overviewRes => {
            if (!overviewRes?.success) {
              throw new Error(overviewRes?.error || '加载路由总览失败');
            }
            return {
              summary: overviewRes.data?.summary || null,
              distribution: overviewRes.data?.distribution || null,
            };
          })
        : Promise.all([
            routeApi.getAnalyticsSummary({ window: routeWindow }),
            routeApi.getAnalyticsDistribution({ window: routeWindow }),
          ]).then(([summaryRes, distributionRes]) => {
            if (!summaryRes?.success) {
              throw new Error(summaryRes?.error || '加载路由汇总失败');
            }
            if (!distributionRes?.success) {
              throw new Error(distributionRes?.error || '加载路由分布失败');
            }
            return {
              summary: summaryRes.data || null,
              distribution: distributionRes.data || null,
            };
          });

      const [analyticsData, configRes] = await Promise.all([
        analyticsPromise,
        routeApi.getConfig(),
      ]);

      setRouteSummary(analyticsData.summary);
      setRouteDistribution(analyticsData.distribution);
      setRoutePathStates(configRes?.success ? configRes.data?.routePathStates || {} : {});
      const rulesData = configRes?.success ? configRes.data?.rules : null;
      if (Array.isArray(rulesData)) {
        const ruleMap: Record<string, string> = {};
        for (const rule of rulesData as Array<{ id?: string; name?: string }>) {
          if (rule?.id) ruleMap[rule.id] = rule.name || rule.id;
        }
        setRouteRulesById(ruleMap);
      } else {
        setRouteRulesById({});
      }
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : '加载路由数据失败');
    } finally {
      setLoading(false);
    }
  }, [routeWindow]);

  useEffect(() => {
    if (!isOverviewActive) return;
    void loadRouteData();
  }, [isOverviewActive, loadRouteData]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.appData?.onChanged?.(({ domains }) => {
      if (!isOverviewActive) return;
      if (!domains.includes('route-overview')) return;
      void loadRouteData();
    });
    return () => {
      unsubscribe?.();
    };
  }, [isOverviewActive, loadRouteData]);

  const filteredBuckets = useMemo(
    () => filterBucketsByScope(routeDistribution?.buckets || [], scope),
    [routeDistribution, scope]
  );

  const trendPoints = useMemo(
    () => buildRouteTrendPoints(filteredBuckets, routeWindow),
    [filteredBuckets, routeWindow]
  );
  const hasTrendData = trendPoints.some(point => point.hasData);
  const firstDataTrendIndex = trendPoints.findIndex(point => point.hasData);
  const isLeadingEmptyTrendPoint = useCallback(
    (index: number, point: TrendPoint) =>
      (!hasTrendData || index < firstDataTrendIndex) && !point.hasData,
    [firstDataTrendIndex, hasTrendData]
  );
  const requestTrend = trendPoints.map((point, index) =>
    isLeadingEmptyTrendPoint(index, point) ? null : point.requestCount
  );
  const successRateTrend = trendPoints.map((point, index) => {
    if (isLeadingEmptyTrendPoint(index, point)) return null;
    const denominator = point.successCount + point.failureCount;
    return denominator > 0 ? Number(((point.successCount / denominator) * 100).toFixed(1)) : null;
  });
  const tokenTrend = trendPoints.map(point => point.totalTokens);
  const failureCounts = trendPoints.map(point => point.failureCount);
  const failureCountTotal = failureCounts.reduce((sum, count) => sum + count, 0);

  const scopedFirstByteHistogram = useMemo(() => {
    if (scope.kind === 'all') return routeDistribution?.firstByteHistogram || {};
    const merged: Record<string, number> = {};
    for (const bucket of filteredBuckets) {
      for (const [label, count] of Object.entries(bucket.firstByteHistogram || {})) {
        merged[label] = (merged[label] || 0) + count;
      }
    }
    return merged;
  }, [filteredBuckets, routeDistribution, scope]);
  const scopedLatencyHistogram = useMemo(() => {
    if (scope.kind === 'all') return routeDistribution?.latencyHistogram || {};
    const merged: Record<string, number> = {};
    for (const bucket of filteredBuckets) {
      for (const [label, count] of Object.entries(bucket.latencyHistogram || {})) {
        merged[label] = (merged[label] || 0) + count;
      }
    }
    return merged;
  }, [filteredBuckets, routeDistribution, scope]);

  const latencyPercentiles = useMemo(
    () => computeLatencyPercentiles(scopedLatencyHistogram),
    [scopedLatencyHistogram]
  );
  const ttfbPercentiles = useMemo(
    () => computeFirstBytePercentiles(scopedFirstByteHistogram),
    [scopedFirstByteHistogram]
  );
  const ttfbTrend = useMemo(
    () =>
      trendPoints.map((point, index) =>
        isLeadingEmptyTrendPoint(index, point)
          ? null
          : (computeFirstBytePercentiles(point.firstByteHistogram).p95 ?? null)
      ),
    [isLeadingEmptyTrendPoint, trendPoints]
  );

  const modelDistribution = useMemo(
    () => buildModelDistribution(filteredBuckets).slice(0, 8),
    [filteredBuckets]
  );

  const scopedRouteSummary = useMemo(() => {
    if (scope.kind === 'all') return routeSummary;
    const aggregate = filteredBuckets.reduce(
      (acc, bucket) => {
        acc.totalRequests += bucket.requestCount;
        acc.successCount += bucket.successCount;
        acc.failureCount += bucket.failureCount;
        acc.neutralCount += bucket.neutralCount;
        acc.promptTokens += bucket.promptTokens;
        acc.completionTokens += bucket.completionTokens;
        acc.totalTokens += bucket.totalTokens;
        acc.cachedTokens += bucket.cachedTokens || 0;
        acc.cacheCreationTokens += bucket.cacheCreationTokens || 0;
        acc.cacheReadTokens += bucket.cacheReadTokens || 0;
        return acc;
      },
      {
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        neutralCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }
    );
    const denominator = aggregate.successCount + aggregate.failureCount;
    const successRate = denominator > 0 ? (aggregate.successCount / denominator) * 100 : 0;
    return { ...aggregate, successRate } satisfies RouteSummary;
  }, [filteredBuckets, routeSummary, scope]);

  const requestTrendSummary = useMemo(() => buildTrendDeltaSummary(requestTrend), [requestTrend]);
  const tokenTrendSummary = useMemo(() => buildTrendDeltaSummary(tokenTrend), [tokenTrend]);

  const ttfbHasSamples = ttfbPercentiles.sampleCount > 0 && ttfbPercentiles.p95 !== null;
  const latencyHasSamples = latencyPercentiles.sampleCount > 0 && latencyPercentiles.p99 !== null;
  const firstByteSessionValue = (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span>{ttfbHasSamples ? formatTtfb(ttfbPercentiles.p95) : '样本不足'}</span>
      <span className="text-[var(--text-tertiary)]">/</span>
      <span>{latencyHasSamples ? formatLatency(latencyPercentiles.p99) : '样本不足'}</span>
    </span>
  );
  const ttfbHint = (() => {
    if (!ttfbHasSamples) {
      return `当前样本 ${ttfbPercentiles.sampleCount} < 20`;
    }
    return `P50 ${formatTtfb(ttfbPercentiles.p50)} · 样本 ${ttfbPercentiles.sampleCount}`;
  })();
  const ttfbToneClass =
    ttfbHasSamples && ttfbPercentiles.p95 !== null && ttfbPercentiles.p95 >= 60_000
      ? 'text-[var(--danger)]'
      : 'text-[var(--accent)]';

  const headerActions = useMemo(
    () => (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {ROUTE_WINDOW_OPTIONS.map(windowOption => (
          <AppButton
            key={windowOption}
            variant={routeWindow === windowOption ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setRouteWindow(windowOption)}
          >
            {windowOption}
          </AppButton>
        ))}
        <AppButton
          variant="tertiary"
          size="sm"
          onClick={() => void loadRouteData()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          刷新
        </AppButton>
      </div>
    ),
    [loadRouteData, loading, routeWindow]
  );

  useEffect(() => {
    if (!isOverviewActive || !isVisible) return;
    setPageHeaderActions?.(headerActions);
    return () => {
      setPageHeaderActions?.(null);
    };
  }, [headerActions, isOverviewActive, isVisible, setPageHeaderActions]);

  // 站点 / 自定义 CLI 友好名称查找
  const channelNameLookup = useMemo<ChannelNameLookup>(() => {
    const siteNameById = new Map<string, string>();
    const accountNameById = new Map<string, string>();
    const apiKeyNameById = new Map<string, string>();
    if (config) {
      for (const site of config.sites || []) {
        if (site?.id) siteNameById.set(site.id, site.name || site.id);
        const cacheKeys =
          (site as { cached_data?: { api_keys?: Array<{ id?: string | number; name?: string }> } })
            ?.cached_data?.api_keys || [];
        for (const info of cacheKeys) {
          const id = info?.id != null ? String(info.id) : null;
          if (id) apiKeyNameById.set(id, info.name || id);
        }
      }
      for (const account of config.accounts || []) {
        if (account?.id) accountNameById.set(account.id, account.account_name || account.id);
        const cacheKeys = account?.cached_data?.api_keys || [];
        for (const info of cacheKeys) {
          const id = info?.id != null ? String(info.id) : null;
          if (id) apiKeyNameById.set(id, info.name || id);
        }
      }
    }
    for (const customCli of customCliConfigs || []) {
      if (!customCli?.id) continue;
      const label = customCli.name?.trim() || '自定义 CLI';
      siteNameById.set(buildCustomCliRouteSiteId(customCli.id), label);
      accountNameById.set(`custom-cli-account-${encodeURIComponent(customCli.id)}`, label);
      apiKeyNameById.set(`custom-cli-key-${encodeURIComponent(customCli.id)}`, 'API Key');
    }
    return {
      resolveSiteName: id => siteNameById.get(id) || id || '未知站点',
      resolveAccountName: id => accountNameById.get(id) || id || '未知账户',
      resolveApiKeyName: id => apiKeyNameById.get(id) || id || 'API Key',
    };
  }, [config, customCliConfigs]);

  const scatterPoints = useMemo(
    () => buildRouteScatterPoints(filteredBuckets, channelNameLookup),
    [filteredBuckets, channelNameLookup]
  );
  const sankeyGraph = useMemo(
    () => buildRouteSankeyGraph(filteredBuckets, { lookup: channelNameLookup }),
    [filteredBuckets, channelNameLookup]
  );

  const disabledChannelKeys = useMemo(() => {
    const now = Date.now();
    const result = new Set<string>();
    for (const state of Object.values(routePathStates)) {
      if (state.disabledUntil && state.disabledUntil > now) {
        result.add(`${state.siteId}::${state.accountId}::${state.apiKeyId || ''}`);
      }
    }
    return result;
  }, [routePathStates]);

  const scopeSelectValue = serializeRouteScope(scope);
  const { ref: routeContentRef, size: routeContentSize } = useContainerSize<HTMLDivElement>();
  const routeContentMeasured = routeContentSize.height > 0;
  const routeIsCompact = routeContentMeasured && routeContentSize.height < 640;
  const routeGapClass = routeIsCompact ? 'gap-3' : 'gap-4';
  const routeSecondRowClass = routeIsCompact
    ? 'grid gap-3 xl:grid-cols-[minmax(0,1.34fr)_minmax(340px,0.96fr)]'
    : 'grid gap-4 xl:grid-cols-[minmax(0,1.34fr)_minmax(360px,0.96fr)]';
  const routeThirdRowClass = routeIsCompact
    ? 'grid gap-3 xl:grid-cols-[minmax(0,1.10fr)_minmax(0,0.90fr)]'
    : 'grid gap-4 xl:grid-cols-[minmax(0,1.10fr)_minmax(0,0.90fr)]';
  const routeThirdRowHeightClass = routeIsCompact ? 'h-[220px]' : 'h-[250px]';
  const routeHeatmapHeightClass = routeIsCompact ? 'min-h-[224px]' : 'min-h-[244px]';
  const routeOverviewState = useMemo(
    () =>
      JSON.stringify({
        scope,
        selectedModel,
        pathStateCount: Object.keys(routePathStates).length,
        ruleCount: Object.keys(routeRulesById).length,
        scatterPointCount: scatterPoints.length,
        sankeyLinkCount: sankeyGraph.links.length,
      }),
    [
      routePathStates,
      routeRulesById,
      sankeyGraph.links.length,
      scatterPoints.length,
      scope,
      selectedModel,
    ]
  );

  return (
    <div
      ref={routeContentRef}
      data-route-content-scroll="true"
      className="flex-1 overflow-y-auto px-6 pb-2 pt-4"
    >
      <div
        aria-label="路由数据驾驶舱"
        data-route-content-size={`${routeContentSize.width}x${routeContentSize.height}`}
        data-route-layout={routeIsCompact ? 'compact' : 'regular'}
        className={`flex min-h-full flex-col ${routeGapClass}`}
      >
        {error ? (
          <AppCard blur={false} hoverable={false}>
            <AppCardContent className="p-4 text-sm text-[var(--danger)]">{error}</AppCardContent>
          </AppCard>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 xl:flex-none">
          <RouteMetricCard
            label="路由请求量"
            value={scopedRouteSummary ? formatCompactNumber(scopedRouteSummary.totalRequests) : '—'}
            hint={`窗口 ${routeWindow}`}
            chip={formatTrendDeltaBadge(
              requestTrendSummary.direction,
              requestTrendSummary.deltaPercent,
              requestTrendSummary.previousValue
            )}
            chipToneClass={
              requestTrendSummary.direction === 'up'
                ? 'bg-[var(--success-soft)] text-[var(--success)]'
                : requestTrendSummary.direction === 'down'
                  ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                  : 'bg-[var(--surface-1)] text-[var(--text-secondary)]'
            }
          />
          <RouteMetricCard
            label="路由成功率"
            value={scopedRouteSummary ? formatPercent(scopedRouteSummary.successRate) : '—'}
            hint={`失败 ${formatCompactNumber(scopedRouteSummary?.failureCount || 0)} 次`}
            chip="健康度"
            toneClass={
              scopedRouteSummary && scopedRouteSummary.successRate < 80
                ? 'text-[var(--danger)]'
                : 'text-[var(--success)]'
            }
            chipToneClass={
              scopedRouteSummary && scopedRouteSummary.successRate < 80
                ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                : 'bg-[var(--success-soft)] text-[var(--success)]'
            }
          />
          <RouteMetricCard
            label="Token 消耗"
            value={
              scopedRouteSummary && scopedRouteSummary.totalTokens > 0
                ? formatCompactNumber(scopedRouteSummary.totalTokens)
                : '暂无'
            }
            hint={
              scopedRouteSummary && scopedRouteSummary.totalTokens > 0
                ? `输入 ${formatCompactNumber(scopedRouteSummary.promptTokens)} / 输出 ${formatCompactNumber(scopedRouteSummary.completionTokens)} / 缓存 ${formatCompactNumber((scopedRouteSummary.cacheCreationTokens || 0) + (scopedRouteSummary.cacheReadTokens || 0))}`
                : '上游未返回 usage 或暂无成功请求'
            }
            chip={formatTrendDeltaBadge(
              tokenTrendSummary.direction,
              tokenTrendSummary.deltaPercent,
              tokenTrendSummary.previousValue
            )}
            toneClass="text-[var(--warning)]"
            chipToneClass="bg-[var(--warning-soft)] text-[var(--warning)]"
          />
          <RouteMetricCard
            label="首字响应 / 会话时间"
            value={firstByteSessionValue}
            hint={ttfbHint}
            chip="响应体验"
            toneClass={ttfbToneClass}
            chipToneClass="bg-[var(--accent-soft)] text-[var(--accent)]"
          />
        </div>

        <div data-route-second-row="true" className={routeSecondRowClass}>
          <RouteTrendChart
            trendPoints={trendPoints}
            successRateTrend={successRateTrend}
            ttfbTrend={ttfbTrend}
            requestTrend={requestTrend}
            failureCounts={failureCounts}
            ttfbP50={ttfbPercentiles.p50}
            ttfbP95={ttfbPercentiles.p95}
            ttfbP99={ttfbPercentiles.p99}
            failureCountTotal={failureCountTotal}
            scopeOptions={scopeOptions}
            scopeValue={scopeSelectValue}
            onScopeChange={value => setScope(parseRouteScopeOption(value))}
            compact={routeIsCompact}
          />

          <AppCard
            blur={false}
            hoverable={false}
            data-route-heatmap-card="true"
            className={routeHeatmapHeightClass}
          >
            <AppCardContent className="flex h-full min-h-0 flex-col p-4">
              <div className="flex h-full min-h-0 flex-col" onClick={() => setSelectedModel(null)}>
                <SectionTitle icon={Layers} title="模型热力分布" />
                <ModelHeatmapList
                  items={modelDistribution}
                  selectedModel={selectedModel}
                  onSelectModel={setSelectedModel}
                />
              </div>
            </AppCardContent>
          </AppCard>
        </div>

        <div data-route-third-row="true" className={routeThirdRowClass}>
          <AppCard
            blur={false}
            hoverable={false}
            data-route-third-row-card="scatter"
            className={routeThirdRowHeightClass}
          >
            <AppCardContent className="flex h-full min-h-0 flex-col p-3.5">
              <SectionTitle icon={Gauge} title="通道健康散点矩阵" />
              <div className="min-h-0 flex-1">
                <RouteScatterChart
                  points={scatterPoints}
                  scopeIsSpecific={scope.kind !== 'all'}
                  selectedModel={selectedModel}
                  disabledKeys={disabledChannelKeys}
                />
              </div>
            </AppCardContent>
          </AppCard>

          <AppCard
            blur={false}
            hoverable={false}
            data-route-third-row-card="sankey"
            className={routeThirdRowHeightClass}
          >
            <AppCardContent className="flex h-full min-h-0 flex-col p-3.5">
              <SectionTitle icon={Activity} title="模型 → 通道流向" />
              <div className="min-h-0 flex-1">
                <RouteSankeyChart graph={sankeyGraph} selectedModel={selectedModel} />
              </div>
            </AppCardContent>
          </AppCard>
        </div>

        {/* 占位：作用域 / 选中模型 / 路径名称查找等状态保留给后续 PR 使用 */}
        <span
          aria-hidden="true"
          data-route-overview-state={routeOverviewState}
          className="hidden"
        />
      </div>
    </div>
  );
}
