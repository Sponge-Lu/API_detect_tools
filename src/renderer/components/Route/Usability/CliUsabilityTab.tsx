/**
 * CLI 可用性检测 Sub-Tab
 * 输入: routeStore (探测数据缓存), configStore (站点配置)
 * 输出: CLI 探测历史表格，延迟可视化
 * 定位: 路由页 CLI 可用性子面板
 */

import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Play, Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useRouteStore } from '../../../store/routeStore';
import { toast } from '../../../store/toastStore';
import { AppCard } from '../../AppCard';
import { AppButton } from '../../AppButton/AppButton';
import ClaudeCodeIcon from '../../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../../assets/cli-icons/gemini.svg';
import {
  DEFAULT_CLI_PROBE_CONFIG,
  type RouteCliType,
  type RouteCliProbeSample,
  type RouteCliProbeCliView,
} from '../../../../shared/types/route-proxy';

interface CliUsabilityTabProps {
  setPageHeaderActions?: (actions: ReactNode | null) => void;
}

type ProbeSettingsUpdate = {
  enabled: boolean;
  intervalMinutes: number;
};

type ProbeSettingsDraft = {
  enabled: boolean;
  intervalHoursInput: string;
};

type ProbeSettingsProps = {
  enabled: boolean;
  intervalHoursInput: string;
  intervalError: string | null;
  saving: boolean;
  onToggle: () => void;
  onIntervalChange: (value: string) => void;
};

type HeaderActionsProps = ProbeSettingsProps & {
  probing: boolean;
  onProbeNow: () => void;
};

type TimeRange = '7d';
const MIN_CLI_PROBE_INTERVAL_HOURS = 2;
const MAX_CLI_PROBE_INTERVAL_HOURS = 24;
const CLI_PROBE_SETTINGS_AUTOSAVE_DELAY_MS = 400;
const CLI_PROBE_TIME_RANGE: TimeRange = '7d';
const CLI_TYPES: RouteCliType[] = ['claudeCode', 'codex', 'geminiCli'];
const CLI_USABILITY_GRID_TEMPLATE = '112px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)';
const HISTORY_BAR_GAP_PX = 1;
const HISTORY_CONFIG: Record<
  TimeRange,
  { pointCount: number; windowMs: number; barHeight: number; availabilityLabel: string }
> = {
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
  key: string;
  probeRunId: string | null;
  testedAt: number | null;
  samples: Array<{
    sample: RouteCliProbeSample;
    modelName: string;
  }>;
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
    | undefined,
  maxLength = 72
): string {
  const replyText =
    sample?.claudeDetail?.replyText ??
    sample?.codexDetail?.replyText ??
    sample?.geminiDetail?.replyText;
  const normalized = replyText?.replace(/\s+/g, ' ').trim() ?? '';
  if (!normalized) return '';
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}

function truncateSummary(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function getSegmentColor(slot: HistorySlot) {
  if (slot.samples.length === 0) return 'bg-[var(--cli-history-empty)]';
  const successCount = slot.samples.filter(item => item.sample.success).length;
  if (successCount === slot.samples.length) return 'bg-[var(--cli-history-success)]';
  if (successCount === 0) return 'bg-[var(--cli-history-danger)]';
  return 'bg-[var(--warning)]';
}

function formatProbeResult(
  sample: RouteCliProbeSample | null,
  options?: { replyLimit?: number; summaryLimit?: number }
) {
  if (!sample) return '未测试';
  const replyText = getProbeReplyText(sample, options?.replyLimit ?? 72);
  let result: string;
  if (sample.success) {
    if (replyText) {
      result = `回答 ${replyText}`;
    } else {
      result = `对话时间 ${formatProbeLatency(sample.totalLatencyMs)}`;
    }
  } else if (sample.statusCode !== undefined) {
    result = `错误码 ${sample.statusCode}`;
  } else if (sample.error) {
    result = replyText ? `${sample.error} | 回答 ${replyText}` : sample.error;
  } else {
    result = replyText ? `失败 | 回答 ${replyText}` : '失败';
  }

  return options?.summaryLimit ? truncateSummary(result, options.summaryLimit) : result;
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

function buildHistorySlots(
  models: RouteCliProbeCliView['models'],
  pointCount: number,
  windowStart: number,
  windowEnd: number
): HistorySlot[] {
  const groups = new Map<string, HistorySlot>();
  models.forEach((model, modelIndex) => {
    (model?.history ?? [])
      .filter(sample => sample.testedAt >= windowStart && sample.testedAt <= windowEnd)
      .forEach(sample => {
        const probeRunId = sample.probeRunId;
        if (!probeRunId) return;
        const existing = groups.get(probeRunId);
        const modelName = model?.canonicalModel || `模型${modelIndex + 1}`;
        if (existing) {
          existing.testedAt = Math.max(existing.testedAt ?? sample.testedAt, sample.testedAt);
          existing.samples.push({ sample, modelName });
          return;
        }

        groups.set(probeRunId, {
          key: probeRunId,
          probeRunId,
          testedAt: sample.testedAt,
          samples: [{ sample, modelName }],
        });
      });
  });

  const events = Array.from(groups.values())
    .map(slot => ({
      ...slot,
      samples: [...slot.samples].sort((left, right) =>
        left.modelName.localeCompare(right.modelName)
      ),
    }))
    .sort((left, right) => (left.testedAt ?? 0) - (right.testedAt ?? 0))
    .slice(-pointCount);

  const emptyCount = Math.max(0, pointCount - events.length);
  const emptySlots: HistorySlot[] = Array.from({ length: emptyCount }, (_, index) => ({
    key: `empty-${index}`,
    probeRunId: null,
    testedAt: null,
    samples: [],
  }));

  return [...emptySlots, ...events];
}

function buildHistoryTooltip(slot: HistorySlot) {
  if (slot.samples.length === 0) {
    return '未测试';
  }

  const lines = [
    `检测批次：${slot.probeRunId || '—'}`,
    `测试时间：${formatProbeDateTime(slot.testedAt ?? undefined)}`,
  ];

  slot.samples.forEach(({ sample, modelName }, index) => {
    lines.push(
      '',
      `${index + 1}. 模型：${modelName || '—'}`,
      `对话时间：${formatProbeLatency(sample.totalLatencyMs)}`,
      `结果：${sample.success ? '兼容' : '失败'}`,
      `摘要：${formatProbeResult(sample, { replyLimit: 295, summaryLimit: 295 })}`
    );
  });

  return lines.join('\n');
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
    const windowEnd = Date.now();
    const windowStart = windowEnd - windowMs;
    const slots = buildHistorySlots(models, pointCount, windowStart, windowEnd);

    return {
      pointCount,
      barHeight,
      slots,
      tooltips: slots.map(slot => buildHistoryTooltip(slot)),
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
              key={slot.key}
              className={`h-full cursor-help rounded-[3px] transition-opacity hover:opacity-80 ${getSegmentColor(slot)}`}
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
    .filter(sample => sample.probeRunId && sample.testedAt >= rangeStart);

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

function parseIntervalHoursInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function normalizeIntervalHoursToMinutes(intervalHours: number): number {
  const normalizedHours = Math.min(
    MAX_CLI_PROBE_INTERVAL_HOURS,
    Math.max(MIN_CLI_PROBE_INTERVAL_HOURS, intervalHours)
  );
  return Math.round(normalizedHours * 60);
}

function formatIntervalHoursInput(intervalMinutes: number): string {
  const rawHours = intervalMinutes / 60;
  const normalizedHours = Math.min(
    MAX_CLI_PROBE_INTERVAL_HOURS,
    Math.max(MIN_CLI_PROBE_INTERVAL_HOURS, rawHours)
  );
  return Number.isInteger(normalizedHours)
    ? String(normalizedHours)
    : String(Number(normalizedHours.toFixed(2)));
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
  intervalHoursInput,
  intervalError,
  saving,
  onToggle,
  onIntervalChange,
}: ProbeSettingsProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2" aria-busy={saving}>
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
      <input
        type="number"
        value={intervalHoursInput}
        onChange={event => onIntervalChange(event.target.value)}
        min={MIN_CLI_PROBE_INTERVAL_HOURS}
        max={MAX_CLI_PROBE_INTERVAL_HOURS}
        step={1}
        className={`h-7 w-16 rounded-[8px] border bg-[var(--surface-2)] px-2 text-center text-xs tabular-nums text-[var(--text-primary)] outline-none transition-[border-color,box-shadow] duration-[var(--duration-fast)] [box-shadow:inset_0_1px_2px_rgba(0,0,0,0.05)] ${
          intervalError
            ? 'border-[var(--danger)]'
            : 'border-[var(--line-soft)] focus:border-[var(--accent)] focus:[box-shadow:0_0_0_3px_var(--focus-ring),inset_0_1px_2px_rgba(0,0,0,0.05)]'
        }`}
        aria-label="检测间隔（小时）"
        aria-invalid={!!intervalError}
        title={intervalError ?? '检测间隔（小时）'}
      />
      <span className="text-xs text-[var(--text-secondary)]">小时</span>
      {saving ? (
        <Loader2
          className="h-3.5 w-3.5 animate-spin text-[var(--text-secondary)]"
          aria-label="正在自动保存检测设置"
        />
      ) : null}
    </div>
  );
}

function HeaderActions({
  enabled,
  intervalHoursInput,
  intervalError,
  saving,
  probing,
  onToggle,
  onIntervalChange,
  onProbeNow,
}: HeaderActionsProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2.5">
      <InlineProbeSettings
        enabled={enabled}
        intervalHoursInput={intervalHoursInput}
        intervalError={intervalError}
        saving={saving}
        onToggle={onToggle}
        onIntervalChange={onIntervalChange}
      />
      <AppButton variant="primary" size="sm" onClick={onProbeNow} disabled={probing}>
        {probing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Play className="w-3.5 h-3.5" />
        )}
        <span className="ml-1">立即探测</span>
      </AppButton>
    </div>
  );
}

// ============= 主组件 =============

export function CliUsabilityTab({ setPageHeaderActions }: CliUsabilityTabProps = {}) {
  const {
    config,
    loading,
    cliProbeView,
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
      cliProbeLoaded: s.cliProbeLoaded,
      cliProbeError: s.cliProbeError,
      fetchCliProbeData: s.fetchCliProbeData,
      runProbeNow: s.runProbeNow,
      saveCliProbeConfig: s.saveCliProbeConfig,
    }))
  );
  const timeRange = CLI_PROBE_TIME_RANGE;
  const [probing, setProbing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const probeConfig = config?.cliProbe?.config || DEFAULT_CLI_PROBE_CONFIG;
  const [draftSettings, setDraftSettings] = useState<ProbeSettingsDraft>(() => ({
    enabled: probeConfig.enabled,
    intervalHoursInput: formatIntervalHoursInput(probeConfig.intervalMinutes),
  }));
  const hasUserEditedSettingsRef = useRef(false);
  const settingsEditVersionRef = useRef(0);
  const activeSaveVersionRef = useRef(0);

  useEffect(() => {
    if (hasUserEditedSettingsRef.current) {
      return;
    }

    setDraftSettings({
      enabled: probeConfig.enabled,
      intervalHoursInput: formatIntervalHoursInput(probeConfig.intervalMinutes),
    });
  }, [probeConfig.enabled, probeConfig.intervalMinutes]);

  const parsedDraftIntervalHours = parseIntervalHoursInput(draftSettings.intervalHoursInput);
  const intervalError =
    draftSettings.intervalHoursInput.trim().length === 0
      ? '请输入检测间隔'
      : parsedDraftIntervalHours === null
        ? '请输入有效数字'
        : null;
  const normalizedDraftIntervalMinutes =
    parsedDraftIntervalHours === null
      ? null
      : normalizeIntervalHoursToMinutes(parsedDraftIntervalHours);
  const settingsDirty =
    draftSettings.enabled !== probeConfig.enabled ||
    (normalizedDraftIntervalMinutes !== null &&
      normalizedDraftIntervalMinutes !== probeConfig.intervalMinutes);

  const markSettingsEdited = useCallback(() => {
    hasUserEditedSettingsRef.current = true;
    settingsEditVersionRef.current += 1;
  }, []);

  const handleToggleProbe = useCallback(() => {
    markSettingsEdited();
    setDraftSettings(current => ({ ...current, enabled: !current.enabled }));
  }, [markSettingsEdited]);

  const handleIntervalChange = useCallback(
    (value: string) => {
      markSettingsEdited();
      setDraftSettings(current => ({ ...current, intervalHoursInput: value }));
    },
    [markSettingsEdited]
  );

  useEffect(() => {
    if (
      !hasUserEditedSettingsRef.current ||
      !settingsDirty ||
      normalizedDraftIntervalMinutes === null
    ) {
      return;
    }

    const requestVersion = settingsEditVersionRef.current;
    const updates: ProbeSettingsUpdate = {
      enabled: draftSettings.enabled,
      intervalMinutes: normalizedDraftIntervalMinutes,
    };
    const timerId = window.setTimeout(() => {
      activeSaveVersionRef.current = requestVersion;
      setSavingSettings(true);
      void saveCliProbeConfig(updates)
        .then(() => {
          if (settingsEditVersionRef.current !== requestVersion) {
            return;
          }

          hasUserEditedSettingsRef.current = false;
          setDraftSettings({
            enabled: updates.enabled,
            intervalHoursInput: formatIntervalHoursInput(updates.intervalMinutes),
          });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : '未知错误';
          toast.error(`自动保存检测设置失败: ${message}`);
        })
        .finally(() => {
          if (activeSaveVersionRef.current === requestVersion) {
            setSavingSettings(false);
          }
        });
    }, CLI_PROBE_SETTINGS_AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timerId);
  }, [draftSettings.enabled, normalizedDraftIntervalMinutes, saveCliProbeConfig, settingsDirty]);

  // 首次加载时获取 7 天数据（有缓存则跳过）
  useEffect(() => {
    fetchCliProbeData(timeRange);
  }, [timeRange, fetchCliProbeData]);

  useEffect(() => {
    if (cliProbeError) toast.error(cliProbeError);
  }, [cliProbeError]);

  const handleProbeNow = useCallback(async () => {
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
  }, [fetchCliProbeData, runProbeNow, timeRange]);

  const headerActions = useMemo(
    () => (
      <HeaderActions
        enabled={draftSettings.enabled}
        intervalHoursInput={draftSettings.intervalHoursInput}
        intervalError={intervalError}
        saving={savingSettings}
        probing={probing}
        onToggle={handleToggleProbe}
        onIntervalChange={handleIntervalChange}
        onProbeNow={handleProbeNow}
      />
    ),
    [
      draftSettings.enabled,
      draftSettings.intervalHoursInput,
      handleIntervalChange,
      handleProbeNow,
      handleToggleProbe,
      intervalError,
      probing,
      savingSettings,
    ]
  );

  useEffect(() => {
    if (!setPageHeaderActions) {
      return;
    }

    setPageHeaderActions(headerActions);
    return () => setPageHeaderActions(null);
  }, [headerActions, setPageHeaderActions]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
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
        <div
          className="overflow-hidden border-y border-[var(--line-soft)] bg-[var(--surface-1)] shadow-none"
          data-testid="cli-usability-grid-card"
        >
          <div className="p-0">
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
          </div>
        </div>
      )}
    </div>
  );
}
