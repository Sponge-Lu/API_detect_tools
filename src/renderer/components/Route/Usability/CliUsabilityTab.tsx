/**
 * CLI 可用性检测 Sub-Tab
 * 输入: routeStore (探测数据缓存), configStore (站点配置)
 * 输出: CLI 探测历史表格，延迟可视化
 * 定位: 路由页 CLI 可用性子面板
 */

import { useEffect, useMemo, useRef, useState, memo } from 'react';
import type { CSSProperties } from 'react';
import { Play, Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useRouteStore } from '../../../store/routeStore';
import { toast } from '../../../store/toastStore';
import { AppCard, AppCardContent } from '../../AppCard';
import { AppButton } from '../../AppButton/AppButton';
import { AppInput } from '../../AppInput';
import ClaudeCodeIcon from '../../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../../assets/cli-icons/gemini.svg';
import type {
  RouteCliType,
  RouteCliProbeSample,
  RouteCliProbeCliView,
} from '../../../../shared/types/route-proxy';

type TimeRange = '24h' | '7d';
const CLI_PROBE_TIME_RANGES: TimeRange[] = ['24h', '7d'];
const CLI_TYPES: RouteCliType[] = ['claudeCode', 'codex', 'geminiCli'];
const CLI_USABILITY_GRID_TEMPLATE = '112px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)';
const HISTORY_BAR_GAP_PX = 1;
const HISTORY_CONFIG: Record<
  TimeRange,
  { pointCount: number; windowMs: number; barHeight: number; availabilityLabel: string }
> = {
  '24h': {
    pointCount: 32,
    windowMs: 24 * 60 * 60 * 1000,
    barHeight: 24,
    availabilityLabel: '最近24小时可用率',
  },
  '7d': {
    pointCount: 32,
    windowMs: 7 * 24 * 60 * 60 * 1000,
    barHeight: 24,
    availabilityLabel: '最近7天可用率',
  },
};

const CLI_META: Record<
  RouteCliType,
  {
    label: string;
    icon: string;
    iconSizeClass: string;
    cellBg: string;
  }
> = {
  claudeCode: {
    label: 'Claude Code',
    icon: ClaudeCodeIcon,
    iconSizeClass: 'h-[18px] w-[18px]',
    cellBg: 'bg-[var(--surface-1)]',
  },
  codex: {
    label: 'Codex',
    icon: CodexIcon,
    iconSizeClass: 'h-5 w-5',
    cellBg: 'bg-[var(--surface-1)]',
  },
  geminiCli: {
    label: 'Gemini CLI',
    icon: GeminiIcon,
    iconSizeClass: 'h-5 w-5',
    cellBg: 'bg-[var(--surface-1)]',
  },
};

// ============= History 条形图 =============

interface HistorySlot {
  bucketKey: number | null;
  samples: Array<RouteCliProbeSample | null>;
  aggregated: RouteCliProbeSample | null;
}

interface HistoryTrackLayout {
  barWidthPx: number | null;
  gapPx: number;
  style: CSSProperties;
}

function padTimePart(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatProbeLatency(ms?: number) {
  if (!ms) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatProbeDateTime(testedAt?: number) {
  if (!testedAt) return '—';
  const date = new Date(testedAt);
  return `${date.getFullYear()}-${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())} ${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}:${padTimePart(date.getSeconds())}`;
}

function formatProbeShortTime(testedAt?: number) {
  if (!testedAt) return '—';
  const date = new Date(testedAt);
  return `${padTimePart(date.getMonth() + 1)}/${padTimePart(date.getDate())} ${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`;
}

function getProbeReplyText(
  sample:
    | Pick<RouteCliProbeSample, 'claudeDetail' | 'codexDetail' | 'geminiDetail'>
    | null
    | undefined
): string {
  const replyText =
    sample?.claudeDetail?.replyText ??
    sample?.codexDetail?.replyText ??
    sample?.geminiDetail?.replyText;
  const normalized = replyText?.replace(/\s+/g, ' ').trim() ?? '';
  if (!normalized) return '';
  return normalized.length <= 72 ? normalized : `${normalized.slice(0, 69)}...`;
}

function getSegmentColor(sample: RouteCliProbeSample | null) {
  if (!sample) return 'bg-[var(--cli-history-empty)]';
  return sample.success ? 'bg-[var(--cli-history-success)]' : 'bg-[var(--cli-history-danger)]';
}

function formatProbeResult(sample: RouteCliProbeSample | null) {
  if (!sample) return '未测试';
  const replyText = getProbeReplyText(sample);
  if (sample.success) {
    if (replyText) {
      return `回答 ${replyText}`;
    }
    return `对话时间 ${formatProbeLatency(sample.totalLatencyMs)}`;
  }
  if (sample.statusCode !== undefined) {
    return `错误码 ${sample.statusCode}`;
  }
  if (sample.error) {
    return replyText ? `${sample.error} | 回答 ${replyText}` : sample.error;
  }
  return replyText ? `失败 | 回答 ${replyText}` : '失败';
}

function buildModelResultTooltip(
  model: NonNullable<RouteCliProbeCliView['models'][number]>,
  index: number
) {
  const lines = [
    `模型：${model.canonicalModel || `模型${index + 1}`}`,
    `测试时间：${formatProbeDateTime(model.testedAt)}`,
    `对话时间：${formatProbeLatency(model.totalLatencyMs)}`,
    `结果：${model.success === true ? '兼容' : model.success === false ? '失败' : '未测'}`,
  ];

  if (model.statusCode !== undefined) {
    lines.push(`失败摘要：错误码 ${model.statusCode}`);
  } else if (model.error?.trim()) {
    lines.push(`失败摘要：${model.error.trim()}`);
  }

  const replyText = getProbeReplyText(model);
  if (replyText) {
    lines.push(`回答：${replyText}`);
  }

  return lines.join('\n');
}

function pickAggregatedBucketSample(
  samples: Array<RouteCliProbeSample | null>
): RouteCliProbeSample | null {
  const valid = samples.filter(Boolean) as RouteCliProbeSample[];
  if (valid.length === 0) {
    return null;
  }

  const successful = valid
    .filter(sample => sample.success)
    .sort((left, right) => right.testedAt - left.testedAt);
  if (successful.length > 0) {
    return successful[0];
  }

  return [...valid].sort((left, right) => right.testedAt - left.testedAt)[0];
}

function buildHistorySlots(
  samplesByModel: Array<RouteCliProbeSample[]>,
  bucketMs: number,
  pointCount: number,
  windowStart: number,
  windowEnd: number
): HistorySlot[] {
  const slots: HistorySlot[] = Array.from({ length: pointCount }, (_, index) => ({
    bucketKey: windowStart + index * bucketMs,
    samples: new Array<RouteCliProbeSample | null>(samplesByModel.length).fill(null),
    aggregated: null,
  }));
  const slotIndexByBucket = new Map(slots.map((slot, index) => [slot.bucketKey, index]));

  samplesByModel.forEach((samples, modelIndex) => {
    for (const sample of samples) {
      if (sample.testedAt < windowStart || sample.testedAt > windowEnd) {
        continue;
      }
      const bucketKey = Math.floor(sample.testedAt / bucketMs) * bucketMs;
      const slotIndex = slotIndexByBucket.get(bucketKey);
      if (slotIndex === undefined) continue;

      const existing = slots[slotIndex].samples[modelIndex];
      if (!existing || sample.testedAt > existing.testedAt) {
        slots[slotIndex].samples[modelIndex] = sample;
      }
    }
  });

  slots.forEach(slot => {
    slot.aggregated = pickAggregatedBucketSample(slot.samples);
  });

  return slots;
}

function buildAggregatedTooltip(
  samples: Array<RouteCliProbeSample | null>,
  models: RouteCliProbeCliView['models']
) {
  const lines = models.map((model, index) => {
    const sample = samples[index] ?? null;
    const modelName = model?.canonicalModel || `模型${index + 1}`;
    return `${modelName}: ${formatProbeResult(sample)}`;
  });

  const latestSample = pickAggregatedBucketSample(samples);
  return `测试时间：${formatProbeDateTime(latestSample?.testedAt)}\n${lines.join('\n')}`;
}

function buildHistoryTrackLayout(
  trackWidth: number | null,
  pointCount: number,
  preferredGapPx: number,
  barHeight: number
): HistoryTrackLayout {
  const fallbackStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${pointCount}, minmax(0, 1fr))`,
    gap: `${preferredGapPx}px`,
    height: barHeight,
  };

  if (!trackWidth || trackWidth <= 0 || pointCount <= 0) {
    return {
      barWidthPx: null,
      gapPx: preferredGapPx,
      style: fallbackStyle,
    };
  }

  if (pointCount === 1) {
    const singleBarWidthPx = Math.max(1, Math.floor(trackWidth));
    return {
      barWidthPx: singleBarWidthPx,
      gapPx: 0,
      style: {
        gridTemplateColumns: `${singleBarWidthPx}px`,
        gap: '0px',
        height: barHeight,
      },
    };
  }

  const preferredTotalGapPx = preferredGapPx * (pointCount - 1);
  const barWidthPx = Math.max(1, Math.floor((trackWidth - preferredTotalGapPx) / pointCount));
  const gapPx = Number(
    Math.max(0, (trackWidth - barWidthPx * pointCount) / (pointCount - 1)).toFixed(3)
  );

  return {
    barWidthPx,
    gapPx,
    style: {
      gridTemplateColumns: `repeat(${pointCount}, ${barWidthPx}px)`,
      gap: `${gapPx}px`,
      height: barHeight,
    },
  };
}

const HistoryBars = memo(function HistoryBars({
  models,
  timeRange,
}: {
  models: RouteCliProbeCliView['models'];
  timeRange: TimeRange;
}) {
  const { pointCount, barHeight, slots, tooltips } = useMemo(() => {
    const { pointCount, windowMs, barHeight } = HISTORY_CONFIG[timeRange];
    const bucketMs = Math.floor(windowMs / pointCount);
    const windowEnd = Math.floor(Date.now() / bucketMs) * bucketMs;
    const windowStart = windowEnd - bucketMs * (pointCount - 1);
    const slots = buildHistorySlots(
      models.map(model => model?.history ?? []),
      bucketMs,
      pointCount,
      windowStart,
      windowEnd
    );

    return {
      pointCount,
      barHeight,
      slots,
      tooltips: slots.map(slot => buildAggregatedTooltip(slot.samples, models)),
    };
  }, [models, timeRange]);
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState<number | null>(null);

  useEffect(() => {
    const node = trackRef.current;
    if (!node) return;

    const measure = () => {
      const nextTrackWidth = Math.max(0, Math.floor(node.getBoundingClientRect().width));
      setTrackWidth(prevWidth => (prevWidth === nextTrackWidth ? prevWidth : nextTrackWidth));
    };

    measure();

    if (typeof ResizeObserver === 'function') {
      const resizeObserver = new ResizeObserver(() => {
        measure();
      });
      resizeObserver.observe(node);
      return () => {
        resizeObserver.disconnect();
      };
    }

    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [pointCount]);
  const trackLayout = useMemo(
    () => buildHistoryTrackLayout(trackWidth, pointCount, HISTORY_BAR_GAP_PX, barHeight),
    [trackWidth, pointCount, barHeight]
  );

  return (
    <div className="w-full">
      <div
        className="overflow-hidden rounded-[8px] border border-[var(--line-soft)] bg-[var(--surface-2)] p-[2px]"
        data-testid="cli-history-frame"
      >
        <div
          className="grid w-full items-stretch"
          data-testid="cli-history-track"
          data-bar-width={trackLayout.barWidthPx ?? undefined}
          data-gap-px={trackLayout.gapPx}
          ref={trackRef}
          style={trackLayout.style}
        >
          {slots.map((slot, slotIndex) => (
            <div
              key={slot.bucketKey ?? `empty-${slotIndex}`}
              className={`h-full cursor-help rounded-[3px] transition-opacity hover:opacity-80 ${getSegmentColor(slot.aggregated)}`}
              title={tooltips[slotIndex]}
              aria-label={tooltips[slotIndex]}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

// ============= 单个 CLI 单元格 =============

function getAvailabilityMeta(models: RouteCliProbeCliView['models'], timeRange: TimeRange) {
  const { windowMs, availabilityLabel } = HISTORY_CONFIG[timeRange];
  const rangeStart = Date.now() - windowMs;
  const samples = models
    .flatMap(model => model?.history ?? [])
    .filter(sample => sample.testedAt >= rangeStart);

  const total = samples.length;
  const passed = samples.filter(sample => sample.success).length;
  const rate = total > 0 ? Math.round((passed / total) * 100) : null;

  let toneClass = 'text-[var(--text-secondary)]';
  if (rate !== null) {
    if (rate >= 80) {
      toneClass = 'text-[var(--success)]';
    } else if (rate >= 50) {
      toneClass = 'text-[var(--warning)]';
    } else {
      toneClass = 'text-[var(--danger)]';
    }
  }

  return {
    label: availabilityLabel,
    rateText: rate === null ? '--' : `${rate}%`,
    toneClass,
  };
}

function parseIntervalMinutesInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

const CliCell = memo(function CliCell({
  cliView,
  timeRange,
}: {
  cliView: RouteCliProbeCliView;
  timeRange: TimeRange;
}) {
  const meta = CLI_META[cliView.cliType];
  const configuredModels = useMemo(
    () =>
      cliView.models.filter((model): model is NonNullable<RouteCliProbeCliView['models'][number]> =>
        Boolean(model)
      ),
    [cliView.models]
  );
  const availabilityMeta = useMemo(
    () => getAvailabilityMeta(configuredModels, timeRange),
    [configuredModels, timeRange]
  );

  const formatLatency = (ms?: number) => {
    if (!ms) return '—';
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  };

  const latencyColor = (ms?: number) => {
    if (!ms) return 'text-[var(--text-secondary)]';
    if (ms < 3000) return 'text-[var(--success)]';
    if (ms < 6000) return 'text-[var(--warning)]';
    return 'text-[var(--danger)]';
  };

  if (!cliView.accountId) {
    return (
      <div className={`p-3 ${meta.cellBg}`}>
        <div className="text-[10px] text-[var(--text-secondary)]">未选择可用账户</div>
        <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">
          无法显示该 CLI 的站点结果
        </div>
      </div>
    );
  }

  if (!cliView.enabled) {
    return (
      <div className={`p-3 ${meta.cellBg}`}>
        <div className="text-[10px] font-medium text-[var(--text-secondary)]">
          该站点未启用此 CLI
        </div>
      </div>
    );
  }

  if (configuredModels.length === 0) {
    return (
      <div className={`p-3 ${meta.cellBg}`}>
        <div className="text-[10px] text-[var(--text-tertiary)]">未配置测试模型</div>
      </div>
    );
  }

  return (
    <div className={`p-3 ${meta.cellBg}`}>
      <HistoryBars models={configuredModels} timeRange={timeRange} />
      <div className="mt-1 flex items-center justify-between gap-2 px-0.5 text-[10px] text-[var(--text-secondary)]">
        <span>{availabilityMeta.label}</span>
        <span className={`font-semibold tabular-nums ${availabilityMeta.toneClass}`}>
          {availabilityMeta.rateText}
        </span>
      </div>

      <div className="mt-2 space-y-0.5">
        {configuredModels.map((model, index) => {
          const statusText =
            model.success === true ? '兼容' : model.success === false ? '失败' : '未测';
          const statusClass =
            model.success === true
              ? 'text-[var(--success)]'
              : model.success === false
                ? 'text-[var(--danger)]'
                : 'text-[var(--text-secondary)]';

          return (
            <div
              key={`${model.canonicalModel}-${index}`}
              className="border-b border-[var(--line-soft)] px-1 py-1 last:border-b-0"
              title={buildModelResultTooltip(model, index)}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-primary)]">
                  {model.canonicalModel || `模型${index + 1}`}
                </div>
                <div className="tabular-nums text-[10px] text-[var(--text-secondary)]">
                  {formatProbeShortTime(model.testedAt)}
                </div>
                <div
                  className={`text-xs font-semibold tabular-nums ${latencyColor(model.totalLatencyMs)}`}
                >
                  {formatLatency(model.totalLatencyMs)}
                </div>
                <div className={`text-[10px] font-medium ${statusClass}`}>{statusText}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

function InlineProbeSettings({
  enabled,
  intervalMinutesInput,
  intervalError,
  dirty,
  saving,
  onToggle,
  onIntervalChange,
  onSave,
}: {
  enabled: boolean;
  intervalMinutesInput: string;
  intervalError: string | null;
  dirty: boolean;
  saving: boolean;
  onToggle: () => void;
  onIntervalChange: (value: string) => void;
  onSave: () => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-xs text-[var(--text-secondary)]">定时检测</span>
      <button
        type="button"
        onClick={onToggle}
        className={`relative h-5 w-10 rounded-full transition-colors ${enabled ? 'bg-[var(--accent)]' : 'bg-[var(--surface-3)]'}`}
        aria-label={enabled ? '关闭定时检测' : '开启定时检测'}
        aria-pressed={enabled}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--surface-1)] shadow transition-transform ${enabled ? 'left-5' : 'left-0.5'}`}
        />
      </button>
      <span className="text-xs text-[var(--text-secondary)]">间隔</span>
      <AppInput
        type="number"
        value={intervalMinutesInput}
        onChange={event => onIntervalChange(event.target.value)}
        min={10}
        max={1440}
        size="sm"
        className="w-20 text-center"
        containerClassName="w-20"
        aria-label="检测间隔（分钟）"
        error={!!intervalError}
        errorMessage={intervalError ?? undefined}
      />
      <span className="text-xs text-[var(--text-secondary)]">分钟</span>
      <AppButton
        variant={dirty ? 'primary' : 'secondary'}
        size="sm"
        onClick={() => {
          void onSave();
        }}
        disabled={!dirty || saving}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        <span className={saving ? 'ml-1' : ''}>保存设置</span>
      </AppButton>
    </div>
  );
}

// ============= 主组件 =============

export function CliUsabilityTab() {
  const {
    config,
    loading,
    cliProbeView,
    cliProbeTimeRange,
    cliProbeLoaded,
    cliProbeError,
    fetchCliProbeData,
    runProbeNow,
    saveCliProbeConfig,
  } = useRouteStore(
    useShallow(s => ({
      config: s.config,
      loading: s.loading,
      cliProbeView: s.cliProbeView,
      cliProbeTimeRange: s.cliProbeTimeRange,
      cliProbeLoaded: s.cliProbeLoaded,
      cliProbeError: s.cliProbeError,
      fetchCliProbeData: s.fetchCliProbeData,
      runProbeNow: s.runProbeNow,
      saveCliProbeConfig: s.saveCliProbeConfig,
    }))
  );
  const [timeRange, setTimeRange] = useState<TimeRange>(cliProbeTimeRange);
  const [probing, setProbing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const probeConfig = config?.cliProbe?.config || { enabled: false, intervalMinutes: 60 };
  const [draftEnabled, setDraftEnabled] = useState(probeConfig.enabled);
  const [draftIntervalInput, setDraftIntervalInput] = useState(String(probeConfig.intervalMinutes));

  useEffect(() => {
    setDraftEnabled(probeConfig.enabled);
    setDraftIntervalInput(String(probeConfig.intervalMinutes));
  }, [probeConfig.enabled, probeConfig.intervalMinutes]);

  const parsedDraftIntervalMinutes = parseIntervalMinutesInput(draftIntervalInput);
  const intervalError =
    draftIntervalInput.trim().length > 0 && parsedDraftIntervalMinutes === null
      ? '请输入有效数字'
      : null;
  const settingsDirty =
    draftEnabled !== probeConfig.enabled ||
    draftIntervalInput !== String(probeConfig.intervalMinutes);

  const handleSaveSettings = async () => {
    if (!settingsDirty) {
      return;
    }
    if (parsedDraftIntervalMinutes === null) {
      toast.error('请输入有效的检测间隔');
      return;
    }

    const normalizedIntervalMinutes = Math.min(1440, Math.max(10, parsedDraftIntervalMinutes));
    setSavingSettings(true);
    try {
      await saveCliProbeConfig({
        enabled: draftEnabled,
        intervalMinutes: normalizedIntervalMinutes,
      });
      setDraftIntervalInput(String(normalizedIntervalMinutes));
      toast.success('检测设置已保存');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '未知错误';
      toast.error(`保存设置失败: ${message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  // 首次加载或 timeRange 变化时获取数据（有缓存则跳过）
  useEffect(() => {
    fetchCliProbeData(timeRange);
  }, [timeRange, fetchCliProbeData]);

  useEffect(() => {
    if (cliProbeError) toast.error(cliProbeError);
  }, [cliProbeError]);

  const handleProbeNow = async () => {
    setProbing(true);
    try {
      const result = await runProbeNow();
      if (result) {
        toast.success(`探测完成: ${result.totalSamples} 样本, ${result.successSamples} 成功`);
        await fetchCliProbeData(timeRange, true);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '未知错误';
      toast.error(`探测失败: ${message}`);
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-3">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {CLI_PROBE_TIME_RANGES.map(r => (
            <AppButton
              key={r}
              variant={timeRange === r ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setTimeRange(r)}
            >
              {r}
            </AppButton>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <InlineProbeSettings
            enabled={draftEnabled}
            intervalMinutesInput={draftIntervalInput}
            intervalError={intervalError}
            dirty={settingsDirty}
            saving={savingSettings}
            onToggle={() => setDraftEnabled(value => !value)}
            onIntervalChange={setDraftIntervalInput}
            onSave={handleSaveSettings}
          />
          <AppButton variant="primary" size="sm" onClick={handleProbeNow} disabled={probing}>
            {probing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span className="ml-1">立即探测</span>
          </AppButton>
        </div>
      </div>

      {/* 内容区 */}
      {loading && !cliProbeLoaded ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)]" />
        </div>
      ) : cliProbeView.length === 0 ? (
        <AppCard className="p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            暂无探测数据，请先启用 CLI 探测或点击「立即探测」
          </p>
        </AppCard>
      ) : (
        <AppCard blur={false} hoverable={false} data-testid="cli-usability-grid-card">
          <AppCardContent className="p-0">
            {/* 表头 */}
            <div
              className="grid border-b border-[var(--line-soft)]"
              style={{ gridTemplateColumns: CLI_USABILITY_GRID_TEMPLATE }}
            >
              <div className="bg-[var(--surface-2)] px-4 py-2.5 text-xs font-medium text-[var(--text-secondary)]">
                站点
              </div>
              {CLI_TYPES.map(cli => (
                <div key={cli} className="bg-[var(--surface-2)] px-4 py-2.5 text-xs font-semibold">
                  <div className="flex items-center justify-center gap-2">
                    <img
                      src={CLI_META[cli].icon}
                      alt={CLI_META[cli].label}
                      className={CLI_META[cli].iconSizeClass}
                    />
                    <span className="text-[var(--text-primary)]">{CLI_META[cli].label}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* 数据行 */}
            {cliProbeView.map((siteView, idx) => (
              <div
                key={`${siteView.siteId}:${siteView.accountId || 'site'}`}
                data-testid={`cli-usability-row-${siteView.siteId}-${siteView.accountId || 'site'}`}
                className={`grid [content-visibility:auto] [contain-intrinsic-size:168px] ${idx < cliProbeView.length - 1 ? 'border-b border-[var(--line-soft)]' : ''}`}
                style={{ gridTemplateColumns: CLI_USABILITY_GRID_TEMPLATE }}
              >
                <div className="flex flex-col justify-center gap-0.5 border-r border-[var(--line-soft)] px-4 py-3">
                  <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                    {siteView.siteName}
                  </span>
                  <div className="min-w-0">
                    <span className="truncate text-[10px] text-[var(--text-secondary)]">
                      {siteView.accountName ? `账户: ${siteView.accountName}` : '未选择可用账户'}
                    </span>
                  </div>
                </div>
                {CLI_TYPES.map((cli, ci) => {
                  return (
                    <div key={cli} className={ci < 2 ? 'border-r border-[var(--line-soft)]' : ''}>
                      <CliCell cliView={siteView.clis[cli]} timeRange={timeRange} />
                    </div>
                  );
                })}
              </div>
            ))}
          </AppCardContent>
        </AppCard>
      )}
    </div>
  );
}
