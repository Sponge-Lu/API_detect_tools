/**
 * 输入: window.electronAPI.dshIntegration（状态检测 / 一键接入 / 回滚 / 会话迁移）
 * 输出: 路由页顶部的 DSH 接入状态条与操作按钮
 * 定位: 展示层 - 让用户在完全不碰 DSH 配置文件的前提下完成会话级路由接入
 *
 * 为什么需要这条状态条：
 *   DSH 默认走 llm-pi-ai 的 anthropic-messages 通道，该通道的 compat gate 会
 *   withhold 会话标识头，代理侧因此拿不到会话身份，所有对话窗口会共用一张卡片。
 *   用户不可能自己知道要改 cordis.patch.yml，所以由应用在这里提示并代劳。
 *
 * 形态约定：
 *   - 未装 DSH / IPC 不可用 → 静默
 *   - 应用里一个供应商都没有 → 引导去「站点」页添加（不给接入按钮）
 *   - 未接入 / 模型目录变了 / 仍有会话钉在旧通道 → 警告卡（需要处理）
 *   - 已就绪 → 单行提示 + 恢复入口（不要留一个大黄框占着版面）
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/Route/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react';
import type {
  DshActionResult,
  DshModelSource,
  DshRoutingStatus,
} from '../../../shared/types/dsh-integration';
import { AppButton } from '../AppButton/AppButton';
import { AppSelect } from '../AppSelect';
import { toast } from '../../store/toastStore';

const warningCardClassName =
  'rounded-[var(--radius-md)] border border-[var(--warning)]/35 bg-[var(--warning-soft)] px-4 py-3';
const readyRowClassName =
  'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2';

/** 模型目录变化来自这些域；收到后延迟重算，避免连续事件把目录算好几遍 */
const MODEL_REFRESH_DOMAINS = [
  'route-overview',
  'site-config',
  'site-overview',
  'config-file-profiles',
];
const REFRESH_DEBOUNCE_MS = 600;

interface DshIntegrationBridge {
  status: () => Promise<DshActionResult<DshRoutingStatus>>;
  enable: (input: {
    migrateSessions?: boolean;
    modelSourceId?: string | null;
  }) => Promise<DshActionResult<unknown>>;
  rollback: () => Promise<DshActionResult<{ restoredFiles: string[]; skippedFiles: string[] }>>;
  migrateSessions: () => Promise<DshActionResult<{ changedRefs: number }>>;
}

function readApi(): DshIntegrationBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  // App.tsx 里那份 Window.electronAPI 是历史遗留的宽声明、未包含新增的 dshIntegration，
  // 这里做一次收窄，避免为了一个 UI 读口去改那个巨型声明。
  return (window as unknown as { electronAPI?: { dshIntegration?: DshIntegrationBridge } })
    .electronAPI?.dshIntegration;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-[var(--text-tertiary)]">{label}</span>
      <span className="truncate font-mono text-[var(--text-secondary)]">{value}</span>
    </div>
  );
}

function sourceOptionLabel(source: DshModelSource): string {
  return `${source.label}（${source.models.length} 个模型）`;
}

export function DshIntegrationBanner() {
  const [status, setStatus] = useState<DshRoutingStatus | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const api = readApi();
    if (!api) return;
    const result = await api.status();
    if (result.ok && result.data) {
      setStatus(result.data);
      setError(null);
    } else if (!result.ok) {
      setError(result.error ?? '检测 DeepSeek Harness 状态失败');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 模型目录变了要能自己发现：订阅应用数据变更，防抖后重算
  useEffect(() => {
    const unsubscribe = window.electronAPI?.appData?.onChanged?.(
      ({ domains }: { domains: string[] }) => {
        if (!domains.some(domain => MODEL_REFRESH_DOMAINS.includes(domain))) return;
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS);
      }
    );
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      unsubscribe?.();
    };
  }, [refresh]);

  const sources = useMemo(() => status?.modelSources ?? [], [status]);

  // 选中的来源：用户改过就听用户的；否则跟随 DSH 现有配置匹配到的来源，再否则第一个
  const effectiveSourceId =
    selectedSourceId && sources.some(source => source.id === selectedSourceId)
      ? selectedSourceId
      : (status?.matchedModelSourceId ?? sources[0]?.id ?? null);

  const handleEnable = useCallback(async () => {
    const api = readApi();
    if (!api || !status) return;
    setBusy(true);
    setError(null);
    try {
      // DSH 在运行时只写配置，会话迁移留给用户退出后再点一次
      const result = await api.enable({
        migrateSessions: !status.running,
        modelSourceId: effectiveSourceId,
      });
      if (!result.ok) {
        setError(result.error ?? '接入失败');
        return;
      }
      toast.success(
        status.running
          ? '已写入 DSH 配置，请重启 DeepSeek Harness 生效'
          : '已写入 DSH 配置并迁移存量会话，请启动 DeepSeek Harness'
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [effectiveSourceId, refresh, status]);

  const handleMigrate = useCallback(async () => {
    const api = readApi();
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.migrateSessions();
      if (!result.ok) {
        setError(result.error ?? '迁移存量会话失败');
        return;
      }
      toast.success(`已迁移 ${result.data?.changedRefs ?? 0} 处会话模型引用`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const handleRollback = useCallback(async () => {
    const api = readApi();
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.rollback();
      if (!result.ok) {
        setError(result.error ?? '恢复初始状态失败');
        return;
      }
      const restored = result.data?.restoredFiles?.length ?? 0;
      const skipped = result.data?.skippedFiles?.length ?? 0;
      if (skipped > 0) {
        setError(`有 ${skipped} 个文件撤销失败，请检查 DSH 目录权限后重试`);
        toast.error('部分文件未能恢复');
      } else if (restored === 0) {
        toast.success('当前没有需要撤销的改动');
      } else {
        toast.success('已恢复到接入前的 DSH 配置，重启 DeepSeek Harness 后生效');
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  // 没装 DSH、或 API 不可用时保持静默，不要给不用 DSH 的人添噪音
  if (!status || !status.installed) return null;

  const needsMigration = status.sessionsOnLegacyProvider > 0;
  const noModelSource = sources.length === 0;
  const modelDrift = status.drift.includes('models-out-of-sync');
  const errorLine = error ? (
    <div className="mt-2 text-xs text-[var(--danger)]" data-testid="dsh-integration-error">
      {error}
    </div>
  ) : null;

  // 就绪：只留一行，不占版面，但仍然给一个恢复入口
  if (status.configured && !needsMigration) {
    return (
      <div className={readyRowClassName} data-testid="dsh-integration-ready">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
          <CheckCircle2 size={14} className="text-[var(--success)]" aria-hidden="true" />
          DeepSeek Harness 已接入会话级路由
        </span>
        <span className="text-xs text-[var(--text-tertiary)]">
          {status.configuredModelCount} 个模型 · {status.expectedBaseUrl}
        </span>
        {errorLine}
        <span className="ml-auto flex items-center gap-2">
          <AppButton size="sm" variant="tertiary" loading={busy} onClick={() => void refresh()}>
            <RefreshCw size={13} className="mr-1" aria-hidden="true" />
            重新检测
          </AppButton>
          <AppButton
            size="sm"
            variant="tertiary"
            loading={busy}
            onClick={() => void handleRollback()}
          >
            <RotateCcw size={13} className="mr-1" aria-hidden="true" />
            恢复初始状态
          </AppButton>
        </span>
      </div>
    );
  }

  const title = noModelSource
    ? '还没有可用的模型供应商'
    : needsMigration
      ? 'DeepSeek Harness 还有会话在使用旧通道'
      : modelDrift
        ? '模型目录已变化，需要重新应用'
        : 'DeepSeek Harness 未启用会话级路由';

  return (
    <div className={warningCardClassName} data-testid="dsh-integration-banner">
      <div className="flex min-w-0 items-start gap-2.5">
        <TriangleAlert
          size={16}
          className="mt-0.5 shrink-0 text-[var(--warning)]"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
          <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
            {noModelSource
              ? 'DeepSeek Harness 的模型列表来自本应用的模型目录。请先在「站点」页添加模型供应商并刷新模型，再回来接入。'
              : needsMigration
                ? `有 ${status.sessionsOnLegacyProvider} 个会话仍指向旧的 local 通道，这些会话会和其他窗口共用一张卡片。`
                : status.summary}
          </div>

          {!noModelSource && (
            <div className="mt-2 grid gap-1 text-xs">
              <DetailRow label="目标地址" value={status.expectedBaseUrl} />
              <DetailRow
                label="模型"
                value={
                  status.configured
                    ? `${status.configuredModelCount} 个`
                    : `${status.missingModels.length + status.configuredModelCount} 个（待写入）`
                }
              />
              <DetailRow
                label="会话"
                value={`共 ${status.sessionsTotal} 个，其中 ${status.sessionsOnLegacyProvider} 个待迁移`}
              />
              {modelDrift && (
                <DetailRow
                  label="变化"
                  value={[
                    status.missingModels.length > 0 ? `新增 ${status.missingModels.length} 个` : '',
                    status.staleModels.length > 0 ? `移除 ${status.staleModels.length} 个` : '',
                  ]
                    .filter(Boolean)
                    .join('，')}
                />
              )}
            </div>
          )}

          {/* 多个供应商时让用户选：写进 DSH 的就是这一家的模型 */}
          {!noModelSource && sources.length > 1 && (
            <div className="mt-2 flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-xs text-[var(--text-tertiary)]">模型来源</span>
              <AppSelect
                size="sm"
                value={effectiveSourceId ?? ''}
                onChange={event => setSelectedSourceId(event.target.value)}
                disabled={busy}
                aria-label="选择模型来源"
                data-testid="dsh-integration-source-select"
                className="h-7 !py-0 text-xs"
              >
                {sources.map(source => (
                  <option key={source.id} value={source.id}>
                    {sourceOptionLabel(source)}
                  </option>
                ))}
              </AppSelect>
            </div>
          )}

          {errorLine}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!noModelSource && !status.configured && (
              <AppButton size="sm" loading={busy} onClick={() => void handleEnable()}>
                {modelDrift ? '重新应用' : '一键接入'}
              </AppButton>
            )}
            {status.configured && needsMigration && (
              <AppButton size="sm" loading={busy} onClick={() => void handleMigrate()}>
                迁移存量会话
              </AppButton>
            )}
            <AppButton size="sm" variant="secondary" loading={busy} onClick={() => void refresh()}>
              <RefreshCw size={13} className="mr-1" aria-hidden="true" />
              重新检测
            </AppButton>
            {status.configured && (
              <AppButton
                size="sm"
                variant="secondary"
                loading={busy}
                onClick={() => void handleRollback()}
              >
                <RotateCcw size={13} className="mr-1" aria-hidden="true" />
                恢复初始状态
              </AppButton>
            )}
            {!noModelSource && (
              <span className="text-xs text-[var(--text-tertiary)]">
                改配置前请先退出 DSH；也可以在该客户端分组里切到「客户端级」路由，用一张卡先跑起来。
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
