import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Activity,
  Gauge,
  Layers,
  Loader2,
  RefreshCw,
  Shield,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type {
  RouteAnalyticsBucket,
  RouteAnalyticsObjectStatsItem,
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
import {
  buildModelDistribution,
  squarifiedTreemap,
  type ModelDistributionItem,
} from '../utils/routeModelDistribution';

type RouteWindow = RouteAnalyticsWindow;
const ROUTE_WINDOW_OPTIONS: RouteWindow[] = ['24h', '7d'];
const AGGREGATED_SITE_OPTION_ID = '__aggregated_site__';
const AGGREGATED_SITE_OPTION_LABEL = '全部站点（聚合）';
const CHECKIN_SITE_NAME_MAX_WIDTH = 7;

interface RouteSummary {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  neutralCount: number;
  successRate: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

interface RouteDistribution {
  buckets: RouteAnalyticsBucket[];
  statusCodeHistogram: Record<string, number>;
  latencyHistogram: Record<string, number>;
  firstByteHistogram: Record<string, number>;
}

interface TrendPoint {
  key: string;
  label: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  slowRequestCount: number;
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

function formatSnapshotDayLabel(snapshotDate: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(
    parseDayKey(snapshotDate)
  );
}

function buildRouteTrendPoints(buckets: RouteAnalyticsBucket[], window: RouteWindow): TrendPoint[] {
  const grouped = new Map<string, TrendPoint>();

  const toKey = (bucketStart: number) => {
    const date = new Date(bucketStart);
    if (window === '24h') {
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
    }
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };

  for (const bucket of [...buckets].sort((left, right) => left.bucketStart - right.bucketStart)) {
    const key = toKey(bucket.bucketStart);
    const current =
      grouped.get(key) ||
      ({
        key,
        label: formatDateLabel(bucket.bucketStart, window),
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        totalTokens: 0,
        slowRequestCount: 0,
      } satisfies TrendPoint);

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

    grouped.set(key, current);
  }

  return Array.from(grouped.values());
}

function buildRouteTrendAxisLabels(points: TrendPoint[]): string[] {
  if (points.length === 0) return [];

  const lastIndex = points.length - 1;
  const indices = Array.from(
    new Set([0, Math.round(lastIndex * 0.33), Math.round(lastIndex * 0.66), lastIndex])
  );

  return indices
    .map(index => points[index]?.label || '')
    .filter((label, index, labels) => label.length > 0 && label !== labels[index - 1]);
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
  padding = 0
) {
  if (values.length === 0) return [];
  const displayValues = resolveSparklineDisplayValues(values);
  const definedValues = values.filter((value): value is number => value !== null);
  const plotWidth = Math.max(width - padding * 2, 0);
  const plotHeight = Math.max(height - padding * 2, 0);
  const resolveX = (index: number) =>
    values.length === 1 ? width / 2 : padding + (index / (values.length - 1)) * plotWidth;

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
  padding = 0
): string {
  const coordinates = buildSparklineCoordinates(values, width, height, padding);
  if (coordinates.length === 0) return '';

  const definedPointCount = values.filter(value => value !== null).length;
  if (definedPointCount === 0) return '';

  if (definedPointCount === 1) {
    const point = coordinates.find(coordinate => coordinate.value !== null);
    if (!point) return '';
    const startX = Math.max(point.x - 8, padding);
    const endX = Math.min(point.x + 8, width - padding);
    return `M ${startX.toFixed(2)} ${point.y.toFixed(2)} L ${endX.toFixed(2)} ${point.y.toFixed(2)}`;
  }

  return coordinates
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
  padding = 0
): string {
  const coordinates = buildSparklineCoordinates(values, width, height, padding);
  const linePath = buildSparklinePath(values, width, height, padding);
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
}) {
  if (values.length === 0) {
    return <div className={`${heightClass} rounded-[var(--radius-md)] ${emptyClass}`} />;
  }

  const chartWidth = 160;
  const pointPadding = Math.max(
    showPointMarkers ? 4 : 0,
    strokeWidth > 0 ? strokeWidth / 2 + 1 : 0
  );
  const coordinates = buildSparklineCoordinates(values, chartWidth, chartHeight, pointPadding);
  const barHeights = buildSparklineBarHeights(values, chartHeight);
  const barWidth = chartWidth / Math.max(values.length, 1);

  return (
    <div className={`relative ${heightClass} w-full overflow-visible`}>
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
            d={buildSparklineAreaPath(values, chartWidth, chartHeight, pointPadding)}
            fill="currentColor"
            className={areaClass}
          />
        ) : null}
        {showBars
          ? barHeights.map((barHeight, index) => {
              const isEmpty = values[index] === null;
              const x = index * barWidth + barWidth * 0.16;
              const width = barWidth * 0.68;
              const y = chartHeight - barHeight;

              return (
                <rect
                  key={`bar-${index}`}
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
            d={buildSparklinePath(values, chartWidth, chartHeight, pointPadding)}
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
  value: string;
  hint?: string;
  chip?: string;
  toneClass?: string;
  chipToneClass?: string;
}) {
  return (
    <AppCard
      blur={false}
      hoverable={false}
      className="h-full border border-white/70 bg-[var(--surface-3)] shadow-[var(--shadow-sm)]"
    >
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
          <div className="mt-auto pt-3 text-xs leading-5 text-[var(--text-tertiary)]">{hint}</div>
        ) : null}
      </AppCardContent>
    </AppCard>
  );
}

function RouteTrendHeroCard({
  routeWindow,
  requestTrend,
  successRateTrend,
  tokenTrend,
  trendPoints,
}: {
  routeWindow: RouteWindow;
  requestTrend: Array<number | null>;
  successRateTrend: Array<number | null>;
  tokenTrend: Array<number | null>;
  trendPoints: TrendPoint[];
}) {
  const requestSummary = buildTrendDeltaSummary(requestTrend);
  const axisLabels = buildRouteTrendAxisLabels(trendPoints);
  const requestBadge = formatTrendDeltaBadge(
    requestSummary.direction,
    requestSummary.deltaPercent,
    requestSummary.previousValue
  );
  const requestBadgeClass =
    requestSummary.direction === 'up'
      ? 'bg-[var(--success-soft)] text-[var(--success)]'
      : requestSummary.direction === 'down'
        ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
        : 'bg-[var(--surface-1)] text-[var(--text-secondary)]';

  return (
    <AppCard
      blur={false}
      hoverable={false}
      className="min-h-[264px] border border-white/70 bg-[var(--surface-3)] shadow-[var(--shadow-sm)]"
    >
      <AppCardContent className="flex h-full min-h-0 flex-col p-4">
        <SectionTitle
          icon={Activity}
          title="运营趋势"
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="rounded-full bg-[var(--surface-1)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-secondary)]">
                {routeWindow}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${requestBadgeClass}`}
              >
                {requestBadge}
              </span>
            </div>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-lg)] bg-[var(--surface-2)] p-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[var(--accent)]" />
              请求量
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
              成功率
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--warning)]" />
              Tokens
            </span>
          </div>
          <div className="relative min-h-[142px] flex-1">
            <div className="absolute inset-0">
              <Sparkline
                values={requestTrend}
                strokeClass="text-[var(--accent)]"
                showBars
                hideLine
                showGuides
                barClass="text-[var(--accent-soft-strong)]"
                chartHeight={150}
                heightClass="h-full"
              />
            </div>
            <div className="absolute inset-0">
              <Sparkline
                values={successRateTrend}
                strokeClass="text-[var(--success)]"
                showPointMarkers={successRateTrend.length > 1}
                chartHeight={150}
                heightClass="h-full"
                strokeWidth={2.2}
              />
            </div>
            <div className="absolute inset-0">
              <Sparkline
                values={tokenTrend}
                strokeClass="text-[var(--warning)]"
                strokeDasharray="4 4"
                chartHeight={150}
                heightClass="h-full"
                strokeWidth={2}
              />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[var(--text-tertiary)]">
            {axisLabels.length > 0 ? (
              axisLabels.map(label => (
                <span key={label} className="truncate">
                  {label}
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

function RouteObjectStatsList({ items }: { items: RouteAnalyticsObjectStatsItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-[188px] items-center justify-center text-sm text-[var(--text-secondary)]">
        当前时间窗口暂无路由对象统计
      </div>
    );
  }

  return (
    <div
      aria-label="活跃对象滚动区域"
      className="max-h-[196px] overflow-y-auto pr-1 [scrollbar-gutter:stable]"
    >
      <div className="divide-y divide-[var(--line-soft)]">
        {items.map(item => {
          const successRateBarWidth = Math.max(0, Math.min(item.successRate, 100));
          const riskTextClass =
            item.failureCount > 0 || item.successRate < 80
              ? 'text-[var(--danger)]'
              : 'text-[var(--success)]';
          const riskBarClass =
            item.failureCount > 0 || item.successRate < 80
              ? 'bg-[var(--danger)]'
              : 'bg-[var(--success)]';
          const failureTextClass =
            item.failureCount > 0 ? 'text-[var(--danger)]' : 'text-[var(--text-tertiary)]';

          return (
            <div
              key={item.id}
              aria-label={`活跃对象：${item.siteName} / ${item.accountName} / ${item.apiKeyName}`}
              className="px-1 py-1.5 [contain-intrinsic-size:60px] [content-visibility:auto]"
            >
              <div className="truncate text-sm font-semibold leading-tight text-[var(--text-primary)]">
                {item.siteName} / {item.accountName} / {item.apiKeyName}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] leading-none">
                <span className="font-medium text-[var(--text-secondary)]">
                  总请求 {formatCompactNumber(item.requestCount)}
                </span>
                <span className={`font-medium ${failureTextClass}`}>
                  失败 {formatCompactNumber(item.failureCount)}
                </span>
                <span className={`font-medium ${riskTextClass}`}>
                  成功率 {formatPercent(item.successRate)}
                </span>
                <span className="font-medium text-[var(--warning)]">
                  Tokens {item.totalTokens > 0 ? formatCompactNumber(item.totalTokens) : '暂无'}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-[var(--surface-1)]">
                <div
                  className={`h-1.5 rounded-full ${riskBarClass}`}
                  style={{ width: `${successRateBarWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function useContainerSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

function ModelHeatmapList({ items }: { items: ModelDistributionItem[] }) {
  const { ref, size } = useContainerSize<HTMLDivElement>();

  if (items.length === 0) {
    return (
      <div className="flex min-h-[136px] flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        当前时间窗口暂无模型调用
      </div>
    );
  }

  const layoutWidth = size.width > 0 ? size.width : 360;
  const layoutHeight = size.height > 0 ? size.height : 136;
  const nodes = squarifiedTreemap(items, item => item.requests, layoutWidth, layoutHeight);
  const maxFailureRate = Math.max(
    ...items.map(item => (item.requests > 0 ? item.failureCount / item.requests : 0)),
    0.0001
  );

  return (
    <div
      ref={ref}
      aria-label="模型热力分布 treemap"
      className="relative min-h-[136px] flex-1 overflow-hidden rounded-[var(--radius-md)] bg-[var(--surface-2)]"
    >
      {nodes.map(({ item, x, y, width, height }) => {
        const failureRate = item.requests > 0 ? item.failureCount / item.requests : 0;
        const intensity = Math.min(failureRate / maxFailureRate, 1);
        const background =
          item.failureCount > 0
            ? `color-mix(in srgb, var(--danger) ${20 + intensity * 50}%, var(--surface-3))`
            : `color-mix(in srgb, var(--accent) ${18 + (item.requests > 0 ? 35 : 0)}%, var(--surface-3))`;
        const textColor =
          item.failureCount > 0 && intensity > 0.5
            ? 'var(--text-on-accent, #fff)'
            : 'var(--text-primary)';
        const showLabel = width >= 48 && height >= 28;
        const showSub = width >= 72 && height >= 44;

        return (
          <div
            key={item.id}
            aria-label={`模型：${item.canonicalModel}`}
            title={`${item.canonicalModel} · ${getRouteCliLabel(item.cliType)} · 请求 ${item.requests} · 失败 ${item.failureCount} · Tokens ${formatCompactNumber(item.totalTokens)}`}
            className="absolute overflow-hidden border border-[var(--surface-2)] px-1.5 py-1"
            style={{
              left: x,
              top: y,
              width,
              height,
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
                {formatCompactNumber(item.requests)} req
                {item.failureCount > 0 ? ` · 失败 ${item.failureCount}` : ''}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface ChannelHealthDisplayItem {
  key: string;
  label: string;
  title: string;
  successRate: number;
  windowRequestCount: number;
  isDisabled: boolean;
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

function ChannelHealthList({ items }: { items: ChannelHealthDisplayItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-[136px] flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        暂无活跃通道
      </div>
    );
  }

  return (
    <div
      aria-label="通道健康矩阵"
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_32px_minmax(40px,auto)] gap-x-2 gap-y-1">
        {items.map(item => {
          const tone = resolveChannelHealthTone(item.successRate, item.isDisabled);

          return (
            <div
              key={item.key}
              aria-label={`通道健康：${item.label}`}
              className="contents"
              title={item.title}
            >
              <div className="min-w-0 truncate text-[11px] font-medium text-[var(--text-primary)]">
                {item.label}
              </div>
              <div
                className="h-3.5 rounded-[3px] border"
                style={{
                  background: item.isDisabled
                    ? 'var(--danger-soft)'
                    : `color-mix(in srgb, ${tone.background} ${Math.max(item.successRate, 0.1) * 100}%, var(--surface-1))`,
                  borderColor: item.isDisabled ? 'var(--danger)' : 'transparent',
                }}
              />
              <div className="text-[10px] font-semibold text-[var(--text-secondary)]">
                {formatPercent(item.successRate * 100)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
      className="relative flex min-h-[208px] flex-col overflow-hidden rounded-[18px] border border-white/70 bg-[var(--surface-3)] px-4 pb-3 pt-4 shadow-[var(--shadow-sm)]"
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

export function DataOverviewPage({
  setPageHeaderActions,
}: {
  setPageHeaderActions?: (actions: ReactNode | null) => void;
} = {}) {
  const config = useConfigStore(state => state.config);
  const customCliConfigs = useCustomCliConfigStore(state => state.configs);
  const activeTab = useUIStore(state => state.activeTab);
  const view = useUIStore(state => state.overviewSubtab);
  const [routeWindow, setRouteWindow] = useState<RouteWindow>('7d');
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [routeDistribution, setRouteDistribution] = useState<RouteDistribution | null>(null);
  const [routeObjectStats, setRouteObjectStats] = useState<RouteAnalyticsObjectStatsItem[]>([]);
  const [routePathStates, setRoutePathStates] = useState<Record<string, RoutePathState>>({});
  const [routeRulesById, setRouteRulesById] = useState<Record<string, string>>({});
  const [siteSnapshotsById, setSiteSnapshotsById] = useState<Record<string, SiteDailySnapshot[]>>(
    {}
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string>(AGGREGATED_SITE_OPTION_ID);
  const isOverviewActive = activeTab === 'overview';

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

  const loadOverview = useCallback(async () => {
    if (!window.electronAPI.route) {
      setError('当前环境未暴露 route IPC 接口。');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [summaryRes, distributionRes, objectStatsRes, configRes, snapshotsRes] =
        await Promise.all([
          window.electronAPI.route.getAnalyticsSummary({ window: routeWindow }),
          window.electronAPI.route.getAnalyticsDistribution({ window: routeWindow }),
          window.electronAPI.route.getObjectStats?.({
            window: routeWindow,
            limit: 8,
            sortBy: 'successRate',
          }),
          window.electronAPI.route.getConfig(),
          window.electronAPI.overview?.getSiteDailySnapshots({ days: 30 }),
        ]);

      if (!summaryRes?.success) {
        throw new Error(summaryRes?.error || '加载路由汇总失败');
      }
      if (!distributionRes?.success) {
        throw new Error(distributionRes?.error || '加载路由分布失败');
      }

      setRouteSummary(summaryRes.data || null);
      setRouteDistribution(distributionRes.data || null);
      setRouteObjectStats(objectStatsRes?.success ? objectStatsRes.data || [] : []);
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
      setSiteSnapshotsById(snapshotsRes?.success ? snapshotsRes.data || {} : {});
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : '加载数据总览失败');
    } finally {
      setLoading(false);
    }
  }, [routeWindow]);

  useEffect(() => {
    if (!isOverviewActive) {
      return;
    }

    void loadOverview();
  }, [isOverviewActive, loadOverview]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.appData?.onChanged?.(({ domains }) => {
      if (!isOverviewActive) {
        return;
      }

      if (!domains.includes('site-overview') && !domains.includes('route-overview')) {
        return;
      }

      void loadOverview();
    });

    return () => {
      unsubscribe?.();
    };
  }, [isOverviewActive, loadOverview]);

  const trendPoints = useMemo(
    () => buildRouteTrendPoints(routeDistribution?.buckets || [], routeWindow),
    [routeDistribution, routeWindow]
  );
  const requestTrend = trendPoints.map(point => point.requestCount);
  const successRateTrend = trendPoints.map(point => {
    const denominator = point.successCount + point.failureCount;
    return denominator > 0 ? Number(((point.successCount / denominator) * 100).toFixed(1)) : 0;
  });
  const tokenTrend = trendPoints.map(point => point.totalTokens);

  const latencyPercentiles = useMemo(
    () => computeLatencyPercentiles(routeDistribution?.latencyHistogram || {}),
    [routeDistribution]
  );

  const modelDistribution = useMemo(
    () => buildModelDistribution(routeDistribution?.buckets || []).slice(0, 8),
    [routeDistribution]
  );

  const activePathStates = useMemo<ChannelHealthDisplayItem[]>(() => {
    const siteNameById = new Map<string, string>();
    const accountNameById = new Map<string, string>();
    const apiKeyNameById = new Map<string, string>();

    if (config) {
      for (const site of config.sites || []) {
        if (site?.id) siteNameById.set(site.id, site.name || site.id);

        const siteCacheKeys =
          (site as { cached_data?: { api_keys?: Array<{ id?: string | number; name?: string }> } })
            ?.cached_data?.api_keys || [];
        for (const info of siteCacheKeys) {
          const id = info?.id != null ? String(info.id) : null;
          if (id) apiKeyNameById.set(id, info.name || id);
        }
      }

      for (const account of config.accounts || []) {
        if (account?.id) accountNameById.set(account.id, account.account_name || account.id);

        const accountCacheKeys = account?.cached_data?.api_keys || [];
        for (const info of accountCacheKeys) {
          const id = info?.id != null ? String(info.id) : null;
          if (id) apiKeyNameById.set(id, info.name || id);
        }
      }
    }

    for (const customCli of customCliConfigs || []) {
      if (!customCli?.id) continue;
      const label = customCli.name?.trim() || '自定义 CLI';
      siteNameById.set(`custom-cli-site-${encodeURIComponent(customCli.id)}`, label);
      accountNameById.set(`custom-cli-account-${encodeURIComponent(customCli.id)}`, label);
      apiKeyNameById.set(`custom-cli-key-${encodeURIComponent(customCli.id)}`, 'API Key');
    }

    const now = Date.now();
    return Object.values(routePathStates)
      .filter(state => state.windowRequestCount > 0)
      .sort((a, b) => b.windowRequestCount - a.windowRequestCount)
      .slice(0, 8)
      .map(state => {
        const siteLabel = state.siteId
          ? siteNameById.get(state.siteId) || state.siteId
          : '未知站点';
        const accountLabel = state.accountId
          ? accountNameById.get(state.accountId) || state.accountId
          : null;
        const apiKeyLabel = state.apiKeyId
          ? apiKeyNameById.get(state.apiKeyId) || state.apiKeyId
          : null;
        const ruleLabel = state.routeRuleId ? routeRulesById[state.routeRuleId] : null;
        const modelLabel = state.canonicalModel || ruleLabel || '未标记';
        const isDisabled = Boolean(state.disabledUntil && state.disabledUntil > now);
        const parts = [modelLabel, siteLabel, accountLabel, apiKeyLabel].filter(
          Boolean
        ) as string[];
        const label = parts.join(' / ');
        const title = `${label} · 请求 ${state.windowRequestCount} · 成功率 ${formatPercent(state.successRate * 100)}${isDisabled ? ' · 已禁用' : ''}`;

        return {
          key: `${state.routeRuleId}:${state.siteId}:${state.accountId}:${state.apiKeyId}`,
          label,
          title,
          successRate: state.successRate,
          windowRequestCount: state.windowRequestCount,
          isDisabled,
        };
      });
  }, [config, customCliConfigs, routePathStates, routeRulesById]);

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

  const requestTrendSummary = useMemo(() => buildTrendDeltaSummary(requestTrend), [requestTrend]);
  const tokenTrendSummary = useMemo(() => buildTrendDeltaSummary(tokenTrend), [tokenTrend]);

  const pageContainerClassName = 'flex-1 overflow-y-auto px-6 py-4';
  const pageContentClassName = view === 'route' ? 'flex min-h-full flex-col gap-4' : 'space-y-4';
  const headerActions = useMemo(
    () => (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {view === 'route'
          ? ROUTE_WINDOW_OPTIONS.map(windowOption => (
              <AppButton
                key={windowOption}
                variant={routeWindow === windowOption ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setRouteWindow(windowOption)}
              >
                {windowOption}
              </AppButton>
            ))
          : null}
        <AppButton
          variant="tertiary"
          size="sm"
          onClick={() => void loadOverview()}
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
    [loadOverview, loading, routeWindow, view]
  );

  useEffect(() => {
    setPageHeaderActions?.(headerActions);

    return () => {
      setPageHeaderActions?.(null);
    };
  }, [headerActions, setPageHeaderActions]);

  return (
    <div className={pageContainerClassName}>
      <div className={pageContentClassName}>
        {error ? (
          <AppCard blur={false} hoverable={false}>
            <AppCardContent className="p-4 text-sm text-[var(--danger)]">{error}</AppCardContent>
          </AppCard>
        ) : null}

        {view === 'site' ? (
          <>
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
                      <div className="mb-2 text-xs text-[var(--text-secondary)]">
                        今日消费最高站点
                      </div>
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
                      <option value={AGGREGATED_SITE_OPTION_ID}>
                        {AGGREGATED_SITE_OPTION_LABEL}
                      </option>
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
                      values={selectedSiteSnapshotSeries.map(
                        snapshot => snapshot?.todayUsage ?? null
                      )}
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
                      values={selectedSiteSnapshotSeries.map(
                        snapshot => snapshot?.totalTokens ?? null
                      )}
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
          </>
        ) : (
          <div aria-label="路由数据驾驶舱" className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 xl:flex-none">
              <RouteMetricCard
                label="路由请求量"
                value={routeSummary ? formatCompactNumber(routeSummary.totalRequests) : '—'}
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
                value={routeSummary ? formatPercent(routeSummary.successRate) : '—'}
                hint={`失败 ${formatCompactNumber(routeSummary?.failureCount || 0)} 次`}
                chip="健康度"
                toneClass={
                  routeSummary && routeSummary.successRate < 80
                    ? 'text-[var(--danger)]'
                    : 'text-[var(--success)]'
                }
                chipToneClass={
                  routeSummary && routeSummary.successRate < 80
                    ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                    : 'bg-[var(--success-soft)] text-[var(--success)]'
                }
              />
              <RouteMetricCard
                label="Token 消耗"
                value={
                  routeSummary && routeSummary.totalTokens > 0
                    ? formatCompactNumber(routeSummary.totalTokens)
                    : '暂无'
                }
                hint={
                  routeSummary && routeSummary.totalTokens > 0
                    ? `Prompt ${formatCompactNumber(routeSummary.promptTokens)} / Completion ${formatCompactNumber(routeSummary.completionTokens)} / Cache ${formatCompactNumber((routeSummary.cacheCreationTokens || 0) + (routeSummary.cacheReadTokens || 0))}`
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
                label="延迟分位数"
                value={
                  latencyPercentiles.sampleCount < 20
                    ? '样本不足'
                    : formatLatency(latencyPercentiles.p99)
                }
                hint={
                  latencyPercentiles.sampleCount < 20
                    ? `当前样本 ${latencyPercentiles.sampleCount} < 20`
                    : `P90 ${formatLatency(latencyPercentiles.p90)} / 样本 ${latencyPercentiles.sampleCount}`
                }
                chip="P99"
                toneClass={
                  latencyPercentiles.p99 !== null && latencyPercentiles.p99 >= 3000
                    ? 'text-[var(--danger)]'
                    : 'text-[var(--text-primary)]'
                }
                chipToneClass="bg-[var(--accent-soft)] text-[var(--accent)]"
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.78fr)]">
              <RouteTrendHeroCard
                routeWindow={routeWindow}
                requestTrend={requestTrend}
                successRateTrend={successRateTrend}
                tokenTrend={tokenTrend}
                trendPoints={trendPoints}
              />

              <AppCard
                blur={false}
                hoverable={false}
                className="min-h-[264px] border border-white/70 bg-[var(--surface-3)] shadow-[var(--shadow-sm)]"
              >
                <AppCardContent className="flex h-full min-h-0 flex-col p-4">
                  <SectionTitle icon={Gauge} title="活跃对象" />
                  <RouteObjectStatsList items={routeObjectStats} />
                </AppCardContent>
              </AppCard>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.10fr)_minmax(0,0.90fr)]">
              <AppCard
                blur={false}
                hoverable={false}
                className="h-[216px] border border-white/70 bg-[var(--surface-3)] shadow-[var(--shadow-sm)]"
              >
                <AppCardContent className="flex h-full min-h-0 flex-col p-3.5">
                  <SectionTitle icon={Layers} title="模型热力分布" />
                  <ModelHeatmapList items={modelDistribution} />
                </AppCardContent>
              </AppCard>

              <AppCard
                blur={false}
                hoverable={false}
                className="h-[216px] border border-white/70 bg-[var(--surface-3)] shadow-[var(--shadow-sm)]"
              >
                <AppCardContent className="flex h-full min-h-0 flex-col p-3.5">
                  <SectionTitle icon={Shield} title="通道健康矩阵" />
                  <ChannelHealthList items={activePathStates} />
                </AppCardContent>
              </AppCard>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
