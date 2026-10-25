import {
  TrendPoint,
  formatCompactNumber,
  formatCheckinQuota,
  truncateTextByDisplayWidth,
  buildTrendDeltaSummary,
  formatTrendDeltaBadge,
  resolveTrendPointLeftPercent,
  buildSparklineBarHeights,
  buildSparklineCoordinates,
  buildSparklinePath,
  buildSparklineAreaPath,
  buildMatrixColumnLevels,
  MODEL_HEATMAP_BAD_THRESHOLD,
  MODEL_HEATMAP_WARN_THRESHOLD,
  modelHealthTone,
  tierToColorVar,
  FIRST_BYTE_AXIS_MAX_MS,
  formatFirstByteAxisTick,
  buildCompactChannelLabel,
  sankeyLinkTier,
  buildSankeyLinkPath,
  formatSankeyModelLabel,
  formatSankeyChannelLabel,
  HeatCell,
  HEAT_HALF_HOURS,
  formatHeatCellTitle,
  compactTrendSeries,
} from './metrics';
import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, type LucideIcon } from 'lucide-react';

import { AppCard, AppCardContent } from '../../components/AppCard';

import { type SiteCheckinOverviewRow } from '../../utils/siteOverview';

import { formatTtfb } from '../../utils/routeTtfb';

import {
  buildScatterLabelCandidates,
  estimateLabelWidth,
  selectScatterLabels,
  type ScatterPoint,
} from '../../utils/routeScatter';
import { SANKEY_OTHER_CHANNEL_KEY, type SankeyGraph } from '../../utils/routeSankey';
import {
  buildAxisTicks,
  createSegmentedResponseTimeScale,
  DEFAULT_FIRST_BYTE_AXIS_TICKS,
} from '../../utils/routeLogAxis';
import { squarifiedTreemap, type ModelDistributionItem } from '../../utils/routeModelDistribution';

export const CHECKIN_SITE_NAME_MAX_WIDTH = 7;

export interface RankedMetricItem {
  id: string;
  label: string;
  value: number;
  sublabel?: string;
}

export function Sparkline({
  values,
  strokeClass,
  emptyClass = 'bg-[var(--surface-2)]',
  showPointMarkers = false,
  showEmptyPoints = false,
  showBars = false,
  showAreaFill = false,
  showGuides = false,
  guideRatios = [0.18, 0.52, 0.86],
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
  valueMin,
  valueMax,
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
  guideRatios?: number[];
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
  valueMin?: number;
  valueMax?: number;
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
    pointLeftPercents,
    valueMin,
    valueMax
  );
  const barHeights = buildSparklineBarHeights(values, chartHeight, valueMin, valueMax);
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
          ? guideRatios.map(ratio => {
              const y = chartHeight * ratio;
              return (
                <line
                  key={`guide-${ratio}`}
                  data-trend-guide={trendSeries ? 'true' : undefined}
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
              pointLeftPercents,
              valueMin,
              valueMax
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
              const x = alignBarsToPoints
                ? coordinate
                  ? Math.min(Math.max(coordinate.x - width / 2, 0), Math.max(chartWidth - width, 0))
                  : 0
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
              lineStartIndex,
              valueMin,
              valueMax
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

export function SectionTitle({
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
    <div
      className={`mb-1.5 flex justify-between gap-2 ${subtitle ? 'items-start' : 'items-center'}`}
    >
      <div className="min-w-0">
        <div className="flex h-5 items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
          <h2 className="truncate text-[13px] font-semibold leading-5 text-[var(--text-primary)]">
            {title}
          </h2>
        </div>
        {subtitle ? (
          <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex h-5 shrink-0 items-center">{actions}</div> : null}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  toneClass = 'text-[var(--text-primary)]',
  compact = false,
  sparklineValues,
  sparklineClass = 'text-[var(--accent)]',
  chip,
  chipToneClass = 'bg-[var(--surface-2)] text-[var(--text-secondary)]',
}: {
  label: string;
  value: string;
  hint?: string;
  toneClass?: string;
  compact?: boolean;
  sparklineValues?: Array<number | null>;
  sparklineClass?: string;
  chip?: string;
  chipToneClass?: string;
}) {
  return (
    <AppCard blur={false} hoverable={false} className="h-full">
      <AppCardContent className={compact ? 'flex h-full flex-col p-2' : 'p-4'}>
        <div className="flex items-start justify-between gap-1.5">
          <div
            className={
              compact
                ? 'truncate text-[11px] font-semibold tracking-[0.04em] text-[var(--text-secondary)]'
                : 'text-xs text-[var(--text-secondary)]'
            }
            title={label}
          >
            {label}
          </div>
          {chip ? (
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${chipToneClass}`}
            >
              {chip}
            </span>
          ) : null}
        </div>
        <div
          className={`tnum ${compact ? 'mt-0.5 truncate text-[18px] leading-none tracking-[-0.03em]' : 'mt-2 text-2xl'} font-semibold tabular-nums ${toneClass}`}
          title={value}
        >
          {value}
        </div>
        {sparklineValues && sparklineValues.length > 0 ? (
          <div className={compact ? 'mt-1 h-6' : 'mt-1.5 h-8'}>
            <Sparkline
              values={sparklineValues}
              strokeClass={sparklineClass}
              showAreaFill
              areaClass="text-[var(--accent-soft)]"
              heightClass={compact ? 'h-6' : 'h-8'}
              chartHeight={compact ? 24 : 32}
              strokeWidth={1.6}
            />
          </div>
        ) : null}
        {hint ? (
          <div
            className={
              compact
                ? 'mt-auto truncate whitespace-nowrap pt-1 text-[11px] leading-3 text-[var(--text-tertiary)]'
                : 'mt-2 text-xs text-[var(--text-tertiary)]'
            }
            title={hint}
          >
            {hint}
          </div>
        ) : null}
      </AppCardContent>
    </AppCard>
  );
}

export function RouteMetricCard({
  label,
  value,
  hint,
  chip,
  toneClass = 'text-[var(--text-primary)]',
  chipToneClass = 'bg-[var(--surface-1)] text-[var(--text-secondary)]',
  compact = false,
  sparklineValues,
  sparklineClass = 'text-[var(--accent)]',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  chip?: string;
  toneClass?: string;
  chipToneClass?: string;
  compact?: boolean;
  sparklineValues?: Array<number | null>;
  sparklineClass?: string;
}) {
  return (
    <AppCard
      aria-label={`${label} KPI`}
      data-sparkline-values={sparklineValues
        ?.map(value => (value === null ? 'null' : String(value)))
        .join(',')}
      blur={false}
      hoverable={false}
      className="h-full"
    >
      <AppCardContent className={`flex h-full flex-col ${compact ? 'p-2' : 'p-3.5'}`}>
        <div className="flex items-start justify-between gap-1.5">
          <div
            className={`truncate font-semibold text-[var(--text-secondary)] ${
              compact ? 'text-[11px] tracking-[0.04em]' : 'text-[11px] tracking-[0.06em]'
            }`}
            title={label}
          >
            {label}
          </div>
          {chip ? (
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${chipToneClass}`}
            >
              {chip}
            </span>
          ) : null}
        </div>
        <div
          className={`tnum ${compact ? 'mt-0.5 text-[18px]' : 'mt-2.5 text-[26px]'} font-semibold leading-none tracking-[-0.03em] tabular-nums ${toneClass}`}
        >
          {value}
        </div>
        {sparklineValues && sparklineValues.length > 0 ? (
          <div className={compact ? 'mt-1 h-6' : 'mt-1.5 h-8'}>
            <Sparkline
              values={sparklineValues}
              strokeClass={sparklineClass}
              showAreaFill
              areaClass="text-[var(--accent-soft)]"
              heightClass={compact ? 'h-6' : 'h-8'}
              chartHeight={compact ? 24 : 32}
              strokeWidth={1.6}
            />
          </div>
        ) : null}
        {hint ? (
          <div
            className={`${compact ? 'pt-1 text-[11px] leading-3' : 'pt-3 text-xs leading-5'} mt-auto truncate whitespace-nowrap text-[var(--text-tertiary)]`}
            title={typeof hint === 'string' ? hint : undefined}
          >
            {hint}
          </div>
        ) : null}
      </AppCardContent>
    </AppCard>
  );
}

export const DONUT_PALETTE = [
  'var(--accent)',
  'var(--success)',
  'var(--warning)',
  'var(--danger)',
  'var(--accent-strong)',
  'var(--text-secondary)',
  'var(--cli-history-success)',
  'var(--text-tertiary)',
];

export function ModelDonutChart({
  items,
  emptyText = '暂无模型分布',
}: {
  items: Array<{ id: string; label: string; value: number }>;
  emptyText?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[var(--text-secondary)]">
        {emptyText}
      </div>
    );
  }

  const total = Math.max(
    items.reduce((sum, item) => sum + item.value, 0),
    1
  );
  const size = 120;
  const radius = 44;
  const stroke = 16;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex h-full min-h-0 items-center gap-3">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-[108px] w-[108px] shrink-0">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={stroke}
        />
        {items.map((item, index) => {
          const ratio = item.value / total;
          const dash = ratio * circumference;
          const segment = (
            <circle
              key={item.id}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={DONUT_PALETTE[index % DONUT_PALETTE.length]}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          offset += dash;
          return segment;
        })}
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="tnum fill-[var(--text-primary)] text-[13px] font-semibold"
        >
          {formatCompactNumber(total)}
        </text>
      </svg>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {items.map((item, index) => (
          <div key={item.id} className="flex items-center gap-1.5 text-[11px]">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: DONUT_PALETTE[index % DONUT_PALETTE.length] }}
            />
            <span
              className="min-w-0 flex-1 truncate text-[var(--text-secondary)]"
              title={item.label}
            >
              {item.label}
            </span>
            <span className="tnum shrink-0 tabular-nums text-[var(--text-primary)]">
              {formatCompactNumber(item.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RouteTrendChart({
  trendPoints,
  successRateTrend,
  requestTrend,
  failureCounts,
  failureCountTotal,
  compact = false,
  className,
}: {
  trendPoints: TrendPoint[];
  successRateTrend: Array<number | null>;
  requestTrend: Array<number | null>;
  failureCounts: number[];
  failureCountTotal: number;
  compact?: boolean;
  className?: string;
}) {
  const trendChartHeight = compact ? 92 : 132;
  const trendChartMinHeightClass = compact ? 'min-h-[92px]' : 'min-h-[132px]';
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
  const requestAxisMax = Math.max(
    ...requestTrend.filter((value): value is number => value !== null),
    1
  );
  const requestAxisTicks = [requestAxisMax, requestAxisMax / 2, 0];
  const formatRequestAxisTick = (value: number) =>
    value > 0 && value < 1 ? value.toFixed(1) : formatCompactNumber(value);

  return (
    <AppCard
      aria-label="运行趋势图"
      data-trend-point-count={trendPoints.length}
      blur={false}
      hoverable={false}
      className={className ?? (compact ? 'min-h-[176px]' : 'min-h-[244px]')}
    >
      <AppCardContent className="flex h-full min-h-0 flex-col p-3">
        <SectionTitle icon={Activity} title="运行趋势" />
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
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
            <span className="h-2 w-3 rounded-sm bg-[var(--line-soft)]" />
            请求量
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--danger)]" />
            失败次数
          </span>
          <span className="ml-auto inline-flex flex-wrap items-center gap-2 text-[var(--text-tertiary)]">
            <span>失败 {formatCompactNumber(failureCountTotal)} 次</span>
          </span>
        </div>
        <div
          data-trend-chart-frame="true"
          className="-mx-2 flex min-h-0 flex-1 flex-col rounded-[var(--radius-lg)] bg-[var(--surface-2)] px-2.5 py-2"
        >
          <div className="flex min-h-0 flex-1 gap-3 pt-1">
            <div
              data-trend-y-axis="requests"
              aria-hidden="true"
              className="flex w-8 shrink-0 flex-col items-end justify-between text-[11px] leading-none text-[var(--text-secondary)]"
            >
              {requestAxisTicks.map(tick => (
                <span key={tick} className="tnum" data-trend-y-axis-tick="true">
                  {formatRequestAxisTick(tick)}
                </span>
              ))}
            </div>
            <div className={`relative ${trendChartMinHeightClass} min-h-0 flex-1`}>
              <div className="absolute inset-0">
                <Sparkline
                  values={requestTrend}
                  strokeClass="text-transparent"
                  showBars
                  hideLine
                  showGuides
                  guideRatios={[0, 0.5, 1]}
                  barClass="text-[var(--line-soft)]"
                  emptyBarClass="text-[var(--line-soft)]"
                  chartHeight={trendChartHeight}
                  heightClass="h-full"
                  strokeWidth={0}
                  pointLeftPercents={trendPointLeftPercents}
                  alignBarsToPoints
                  skipLeadingNullDraw
                  valueMin={0}
                  valueMax={requestAxisMax}
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
                  valueMin={0}
                  valueMax={100}
                  trendSeries="success-rate"
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
            <div
              data-trend-y-axis="success-rate"
              aria-hidden="true"
              className="flex w-7 shrink-0 flex-col items-start justify-between text-[11px] leading-none text-[var(--text-secondary)]"
            >
              <span className="tnum" data-trend-y-axis-tick="true">
                100%
              </span>
              <span className="tnum" data-trend-y-axis-tick="true">
                50%
              </span>
              <span className="tnum" data-trend-y-axis-tick="true">
                0%
              </span>
            </div>
          </div>
          <div className="mt-2 flex h-4 gap-3 text-[11px] leading-3 text-[var(--text-secondary)]">
            <div className="w-8 shrink-0" />
            <div className="relative min-w-0 flex-1">
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
            <div className="w-7 shrink-0" />
          </div>
        </div>
      </AppCardContent>
    </AppCard>
  );
}

export function useContainerSize<T extends HTMLElement>() {
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

export interface RouteScatterChartProps {
  points: ScatterPoint[];
  scopeIsSpecific: boolean;
  selectedModel: string | null;
  disabledKeys: Set<string>;
}

export const TOP_SUCCESS_LABEL_COUNT = 5;

export function RouteScatterChart({
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

export interface RouteSankeyChartProps {
  graph: SankeyGraph;
  selectedModel?: string | null;
}

export function RouteSankeyChart({ graph, selectedModel = null }: RouteSankeyChartProps) {
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

export function ModelHeatmapList({
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
        // 颜色混合比例：降低 danger 触发区间与饱和度，避免中等成功率过早发红
        const mixPct =
          tone.tier === 'bad'
            ? 30 + Math.min(item.failureCount, 10) * 2
            : tone.tier === 'warn'
              ? 22 + Math.max(0, MODEL_HEATMAP_WARN_THRESHOLD * 100 - successPct) / 3
              : 24 + Math.min(successPct, 100) / 6;
        const background = `color-mix(in srgb, ${tone.bg} ${mixPct}%, var(--surface-3))`;
        const textColor =
          tone.tier === 'bad' && successPct < MODEL_HEATMAP_BAD_THRESHOLD * 100
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
            title={`${item.canonicalModel} · 请求 ${item.requests} · 成功率 ${successPct}% · Tokens ${formatCompactNumber(item.totalTokens)}`}
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
                ? 'border-[color-mix(in_srgb,var(--accent)_42%,var(--line-muted))] shadow-[0_0_0_2px_var(--surface-3),0_4px_18px_-4px_color-mix(in_srgb,var(--text-primary)_45%,transparent)] z-10'
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
              <div className="break-all text-[11px] leading-tight opacity-80">
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
// 散点 / Sankey 将在后续 PR 中复用

export function DotMatrixChart({
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
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[color-mix(in_srgb,var(--surface-1)_35%,transparent)] to-transparent" />
    </div>
  );
}

export function RequestHeatGrid({ cells }: { cells: HeatCell[] }) {
  const visibleCells = cells.filter(cell => cell.visible);
  const hasAnyData = visibleCells.some(cell => cell.hasData);

  if (!hasAnyData) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[var(--text-secondary)]">
        暂无请求量
      </div>
    );
  }

  const maxValue = Math.max(...visibleCells.map(cell => cell.requestCount), 1);

  const resolveCellStyle = (cell: HeatCell): React.CSSProperties => {
    if (!cell.visible) return { background: 'transparent' };
    if (!cell.hasData) return { background: 'var(--surface-2)' };
    const ratio = Math.min(cell.requestCount / maxValue, 1);
    if (ratio >= 0.8) return { background: 'var(--success)' };
    if (ratio >= 0.4) return { background: 'color-mix(in srgb, var(--success) 60%, transparent)' };
    return {
      background: 'color-mix(in srgb, var(--success) 60%, transparent)',
      opacity: 0.4 + ratio * 0.6,
    };
  };

  return (
    <div
      className="grid h-full w-full gap-[3px]"
      style={{
        gridTemplateRows: `repeat(${HEAT_HALF_HOURS}, minmax(0, 1fr))`,
        gridAutoFlow: 'column',
        gridAutoColumns: 'minmax(0, 1fr)',
      }}
      data-testid="overview-heat-grid"
      role="img"
      aria-label="7 天请求热力图"
    >
      {cells.map((cell, index) => (
        <span
          key={`heat-cell-${index}`}
          className="rounded-[3px] transition-opacity"
          style={resolveCellStyle(cell)}
          title={cell.visible && cell.hasData ? formatHeatCellTitle(cell) : undefined}
          aria-hidden={!cell.visible || undefined}
        />
      ))}
    </div>
  );
}

export function SiteTrendCard({
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
      className="relative flex min-h-[208px] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--line-muted)] bg-[var(--surface-3)] px-4 pb-3 pt-4 shadow-[var(--shadow-sm)]"
    >
      <div className="relative z-10 flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-[11px] font-semibold tracking-[0.06em] text-[var(--text-secondary)]">
            {label}
          </h3>
          <span
            className={`shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold ${badgeClass}`}
          >
            {badgeLabel}
          </span>
        </div>
        <div className="mt-2 text-[18px] font-semibold leading-none tracking-[-0.01em] text-[var(--text-primary)] xl:text-[20px]">
          {valueLabel}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-4 right-4 z-10 text-[11px] leading-none text-[var(--text-tertiary)]">
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

export function RankedList({
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

export function CheckinStatusList({
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
        className="app-scrollbar-none min-h-0 flex-1 overflow-y-auto pr-1"
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
            const monthTotalTitle = `本月 ${formatCompactNumber(item.monthCheckinCount)} / 累计 ${formatCompactNumber(item.totalCheckins)}`;
            const amountText =
              item.todayCheckinQuota > 0 ? `+${formatCheckinQuota(item.todayCheckinQuota)}` : '—';

            return (
              <div
                key={item.id}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 py-1 [contain-intrinsic-size:36px] [content-visibility:auto]"
                title={monthTotalTitle}
              >
                <div className="min-w-0">
                  <div className="truncate whitespace-nowrap text-[12px] font-medium text-[var(--text-primary)]">
                    <span title={item.siteName}>{truncatedSiteName}</span>
                    <span className="ml-1 text-[11px] font-normal text-[var(--text-secondary)]">
                      / {item.accountName}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-[var(--text-tertiary)]">
                    本月 {formatCompactNumber(item.monthCheckinCount)}
                    <span className="mx-1">/</span>
                    累计 {formatCompactNumber(item.totalCheckins)}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${statusClass}`}
                >
                  {statusLabel}
                </span>
                <div className="tnum shrink-0 whitespace-nowrap text-right text-[11px] font-medium tabular-nums text-[var(--text-primary)]">
                  {amountText}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
