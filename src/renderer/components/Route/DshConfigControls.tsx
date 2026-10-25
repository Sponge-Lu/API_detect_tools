import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConfigFileTargetCatalogEntry } from '../../../shared/types/config-file-profile';
import type {
  DshActionResult,
  DshModelSource,
  DshRoutingStatus,
  DshSessionMigrationResult,
} from '../../../shared/types/dsh-integration';
import { AppButton } from '../AppButton/AppButton';
import { toast } from '../../store/toastStore';

interface DshApi {
  status: () => Promise<DshActionResult<DshRoutingStatus>>;
  migrateSessions: () => Promise<DshActionResult<DshSessionMigrationResult>>;
}

function readApi(): DshApi | undefined {
  return (window as unknown as { electronAPI?: { dshIntegration?: DshApi } }).electronAPI
    ?.dshIntegration;
}

export function useDshRoutingStatus(enabled: boolean) {
  const [status, setStatus] = useState<DshRoutingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const cancelRefresh = useCallback(() => {
    ++requestId.current;
  }, []);
  const refresh = useCallback(async () => {
    const api = readApi();
    if (!api) return;
    const id = ++requestId.current;
    try {
      const result = await api.status();
      if (id !== requestId.current) return;
      if (!result.ok || !result.data) throw new Error(result.error || '检测 DSH 状态失败');
      setStatus(result.data);
      setError(null);
    } catch (cause) {
      if (id === requestId.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = window.electronAPI.appData?.onChanged?.(({ domains }) => {
      if (
        !domains.some(domain =>
          ['config-file-profiles', 'route-overview', 'site-config', 'site-overview'].includes(
            domain
          )
        )
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 600);
    });
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelRefresh();
      clearTimeout(timer);
      unsubscribe?.();
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, refresh, cancelRefresh]);
  return { status, error, refresh };
}

export function dshStatusLabel(status: DshRoutingStatus | null): string {
  if (!status) return '待检测';
  if (!status.installed) return '未安装';
  if (status.drift.includes('profile-not-initialized')) return '待初始化';
  if (!status.configured) return '待应用';
  return status.sessionsOnLegacyProvider > 0 ? '旧会话待迁移' : '已接入';
}

export function getDshConfigModelSources(
  catalog: ConfigFileTargetCatalogEntry[],
  status: DshRoutingStatus | null
): DshModelSource[] {
  return (
    status?.modelSources ??
    catalog
      .filter(item => item.available && item.allModels.length > 0)
      .map(item => ({ id: item.value, label: item.label, kind: item.kind, models: item.allModels }))
  );
}

export function DshConfigControls(props: {
  status: DshRoutingStatus | null;
  error: string | null;
  hasUnsavedChanges: boolean;
  onRefresh: () => Promise<void>;
  onRestore: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const migrate = async () => {
    const api = readApi();
    if (!api) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.migrateSessions();
      if (!result.ok) throw new Error(result.error || '迁移旧会话失败');
      toast.success(`已迁移 ${result.data?.changedRefs ?? 0} 处会话模型引用`);
      await props.onRefresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details
      className="rounded-[var(--radius-md)] border border-[var(--line-soft)] p-3"
      aria-label="DSH 高级操作"
    >
      <summary className="cursor-pointer text-xs font-medium">高级操作</summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <AppButton size="sm" variant="secondary" onClick={() => void props.onRefresh()}>
          重新检测
        </AppButton>
        <AppButton
          size="sm"
          variant="secondary"
          loading={busy}
          disabled={!props.status || props.status.running || !props.status.sessionsOnLegacyProvider}
          onClick={() => void migrate()}
        >
          迁移旧会话
        </AppButton>
        <AppButton
          size="sm"
          variant="secondary"
          disabled={props.hasUnsavedChanges}
          onClick={props.onRestore}
        >
          预览恢复接入前配置
        </AppButton>
      </div>
      <p className="mt-2 text-xs text-[var(--text-tertiary)]">
        共 {props.status?.sessionsTotal ?? 0} 个会话，
        {props.status?.sessionsOnLegacyProvider ?? 0} 个待迁移。迁移前请完全退出 DSH。
      </p>
      {(actionError || props.error) && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {actionError || props.error}
        </p>
      )}
    </details>
  );
}
