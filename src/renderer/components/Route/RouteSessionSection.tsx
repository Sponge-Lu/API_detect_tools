import { Archive, Copy, RefreshCw, Square, UserRoundPlus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ROUTE_THINKING_EFFORT_LEVELS,
  isRouteThinkingEffortPreset,
  type RouteInstance,
  type RouteInstanceUpdate,
} from '../../../shared/types/route-proxy';
import { useRouteStore } from '../../store/routeStore';
import { toast } from '../../store/toastStore';
import { AppButton } from '../AppButton/AppButton';
import { AppCard } from '../AppCard';
import { AppSelect } from '../AppSelect';
import { AgentLogo } from '../AgentLogo';

const inputClassName =
  'h-7 min-w-0 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]';
const CUSTOM_REASONING_EFFORT = '__custom__';
const SESSION_SCOPE_LABEL = '会话级路由';
const SESSION_SCOPE_DESCRIPTION = '未提供稳定物理窗口标识';

function formatTime(value?: number): string {
  if (!value) return '等待首条请求';
  const date = new Date(value);
  const pad = (part: number) => part.toString().padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function stateLabel(instance: RouteInstance): string {
  if (instance.routingState === 'armed') return '等待下一个新会话';
  if (instance.routingState === 'active') return '当前';
  if (instance.routingState === 'closed') return '已关闭';
  return '已取消';
}

function effectiveAgentName(instance: RouteInstance): string {
  return (
    instance.display.customAgentName ||
    instance.display.observedAgentName ||
    instance.routeKey?.agentId ||
    '未知 Agent'
  );
}

function isSessionScopedRoute(instance: RouteInstance): boolean {
  return Boolean(
    instance.routeKey && instance.routeKey.runtimeSlotId === instance.routeKey.sessionId
  );
}

function defaultRuntimeScopeLabel(instance: RouteInstance): string {
  if (isSessionScopedRoute(instance)) return SESSION_SCOPE_LABEL;
  return (
    instance.display.observedRuntimeSlotLabel ||
    instance.routeKey?.runtimeSlotId ||
    '未提供稳定运行位置'
  );
}

function effectiveRuntimeScopeLabel(instance: RouteInstance): string {
  return instance.display.customRuntimeSlotLabel || defaultRuntimeScopeLabel(instance);
}

interface ReasoningEffortEditorProps {
  instance: RouteInstance;
  onSave: (value: string) => Promise<void>;
}

function resolveReasoningEffortMode(value: string): string {
  const normalized = value.trim().toLowerCase();
  return isRouteThinkingEffortPreset(normalized) ? normalized : CUSTOM_REASONING_EFFORT;
}

function ReasoningEffortEditor({ instance, onSave }: ReasoningEffortEditorProps) {
  const [mode, setMode] = useState(() => resolveReasoningEffortMode(instance.reasoningEffort));
  const [customValue, setCustomValue] = useState(() =>
    resolveReasoningEffortMode(instance.reasoningEffort) === CUSTOM_REASONING_EFFORT
      ? instance.reasoningEffort
      : ''
  );
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (editing) return;
    const nextMode = resolveReasoningEffortMode(instance.reasoningEffort);
    setMode(nextMode);
    setCustomValue(nextMode === CUSTOM_REASONING_EFFORT ? instance.reasoningEffort : '');
  }, [editing, instance.reasoningEffort]);

  const selectMode = async (nextMode: string) => {
    setMode(nextMode);
    if (nextMode === CUSTOM_REASONING_EFFORT) {
      setEditing(true);
      return;
    }
    setEditing(true);
    await onSave(nextMode);
    setEditing(false);
  };

  const saveCustomValue = async () => {
    const normalized = customValue.trim();
    if (!normalized) {
      const currentMode = resolveReasoningEffortMode(instance.reasoningEffort);
      setMode(currentMode);
      setCustomValue(currentMode === CUSTOM_REASONING_EFFORT ? instance.reasoningEffort : '');
      setEditing(false);
      return;
    }
    await onSave(normalized);
    setCustomValue(normalized);
    setEditing(false);
  };

  return (
    <div className="grid min-w-0 gap-1">
      <AppSelect
        size="sm"
        aria-label={`${instance.id} 思考强度`}
        value={mode}
        onChange={event => void selectMode(event.target.value)}
      >
        {ROUTE_THINKING_EFFORT_LEVELS.map(effort => (
          <option key={effort} value={effort}>
            {effort}
          </option>
        ))}
        <option value={CUSTOM_REASONING_EFFORT}>自定义</option>
      </AppSelect>
      {mode === CUSTOM_REASONING_EFFORT ? (
        <input
          autoFocus
          className={inputClassName}
          aria-label={`${instance.id} 自定义思考强度`}
          value={customValue}
          onFocus={() => setEditing(true)}
          onChange={event => setCustomValue(event.target.value)}
          onBlur={() => void saveCustomValue()}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      ) : null}
    </div>
  );
}

export function RouteSessionSection() {
  const config = useRouteStore(state => state.config);
  const [instances, setInstances] = useState<RouteInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ modelId: '', reasoningEffort: 'medium' });
  const draftReasoningEffortMode = resolveReasoningEffortMode(draft.reasoningEffort);
  const modelOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...Object.values(config?.modelRegistry.entries || {}).map(entry => entry.canonicalName),
          ...instances.map(instance => instance.modelId),
        ])
      ).filter(Boolean),
    [config?.modelRegistry.entries, instances]
  );

  const loadInstances = useCallback(async () => {
    setLoading(true);
    try {
      const response = await window.electronAPI.route?.listRouteInstances?.();
      if (!response?.success) throw new Error(response?.error || '加载会话路由失败');
      setInstances(response.data || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载会话路由失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInstances();
    const timer = window.setInterval(() => void loadInstances(), 3000);
    return () => window.clearInterval(timer);
  }, [loadInstances]);

  const createArmed = async () => {
    if (!draft.modelId.trim() || !draft.reasoningEffort.trim()) {
      toast.error('请选择模型并填写思考强度');
      return;
    }
    const response = await window.electronAPI.route?.createArmedRouteInstance?.({
      modelId: draft.modelId.trim(),
      reasoningEffort: draft.reasoningEffort.trim(),
    });
    if (!response?.success) {
      toast.error(response?.error || '创建等待路由失败');
      return;
    }
    setShowCreate(false);
    await loadInstances();
  };

  const updateInstance = async (instanceId: string, updates: RouteInstanceUpdate) => {
    const response = await window.electronAPI.route?.updateRouteInstance?.(instanceId, updates);
    if (!response?.success) {
      toast.error(response?.error || '保存路由失败');
      await loadInstances();
      return;
    }
    setInstances(current =>
      current.map(instance => (instance.id === instanceId ? response.data || instance : instance))
    );
  };

  const runAction = async (action: 'close' | 'cancel' | 'archive', instanceId: string) => {
    const api = window.electronAPI.route;
    const response =
      action === 'close'
        ? await api?.closeRouteInstance?.(instanceId)
        : action === 'cancel'
          ? await api?.cancelArmedRouteInstance?.(instanceId)
          : await api?.archiveRouteInstance?.(instanceId);
    if (!response?.success) {
      toast.error(response?.error || '路由操作失败');
      return;
    }
    await loadInstances();
  };

  return (
    <AppCard variant="standard" hoverable={false} blur={false} className="flex min-h-0 flex-col">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-[var(--line-soft)] px-3 py-1.5">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">会话路由</h2>
        <div className="flex items-center gap-1">
          <AppButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setShowCreate(value => !value)}
            disabled={instances.some(instance => instance.routingState === 'armed')}
          >
            <UserRoundPlus className="h-4 w-4" />
            为下一个新会话创建路由
          </AppButton>
          <AppButton
            type="button"
            variant="tertiary"
            size="sm"
            onClick={() => void loadInstances()}
            aria-label="刷新会话路由"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </AppButton>
        </div>
      </div>

      {showCreate ? (
        <div className="grid gap-2 border-b border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2 sm:grid-cols-[minmax(180px,1fr)_160px_auto] sm:items-start">
          <AppSelect
            size="sm"
            aria-label="预创建路由模型"
            value={draft.modelId}
            onChange={event => setDraft(current => ({ ...current, modelId: event.target.value }))}
          >
            <option value="">选择模型</option>
            {modelOptions.map(model => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </AppSelect>
          <div className="grid min-w-0 gap-1">
            <AppSelect
              size="sm"
              aria-label="预创建路由思考强度"
              value={draftReasoningEffortMode}
              onChange={event =>
                setDraft(current => ({
                  ...current,
                  reasoningEffort:
                    event.target.value === CUSTOM_REASONING_EFFORT ? '' : event.target.value,
                }))
              }
            >
              {ROUTE_THINKING_EFFORT_LEVELS.map(effort => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
              <option value={CUSTOM_REASONING_EFFORT}>自定义</option>
            </AppSelect>
            {draftReasoningEffortMode === CUSTOM_REASONING_EFFORT ? (
              <input
                autoFocus
                className={inputClassName}
                aria-label="预创建路由自定义思考强度"
                placeholder="输入自定义值"
                value={draft.reasoningEffort}
                onChange={event =>
                  setDraft(current => ({ ...current, reasoningEffort: event.target.value }))
                }
              />
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-1">
            <AppButton
              type="button"
              variant="tertiary"
              size="sm"
              onClick={() => setShowCreate(false)}
            >
              取消
            </AppButton>
            <AppButton type="button" size="sm" onClick={() => void createArmed()}>
              创建
            </AppButton>
          </div>
        </div>
      ) : null}

      {instances.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
          暂无会话路由。可以先为下一个新会话选择模型和思考强度，也可以直接发送请求自动创建。
        </div>
      ) : (
        <div data-testid="route-session-grid-scroll" className="overflow-x-auto">
          <div
            data-testid="route-session-grid"
            className="grid min-w-[60rem] grid-cols-3 gap-2 p-2"
          >
            {instances.map(instance => {
              const bound = Boolean(instance.routeKey);
              const sessionScopedRoute = isSessionScopedRoute(instance);
              return (
                <article
                  key={instance.id}
                  data-testid={`route-session-card-${instance.id}`}
                  data-density="compact"
                  className="grid h-[13.5rem] min-w-0 grid-rows-[auto_auto_auto_1fr_auto] gap-2 rounded-[var(--radius-md)] border border-[var(--line-muted)] bg-[var(--surface-2)] p-2.5"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 truncate rounded-[var(--radius-full)] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                        {stateLabel(instance)}
                      </span>
                      {bound ? (
                        <AgentLogo
                          agentId={instance.routeKey?.agentId}
                          agentName={effectiveAgentName(instance)}
                          className="h-4 w-4"
                        />
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center">
                      {instance.routingState === 'armed' ? (
                        <button
                          type="button"
                          aria-label="取消等待路由"
                          onClick={() => void runAction('cancel', instance.id)}
                          className="p-1 text-[var(--text-secondary)] hover:text-[var(--danger)]"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : instance.routingState === 'active' ? (
                        <button
                          type="button"
                          aria-label={`关闭 ${instance.routeKey?.sessionId} 路由`}
                          onClick={() => void runAction('close', instance.id)}
                          className="p-1 text-[var(--text-secondary)] hover:text-[var(--danger)]"
                        >
                          <Square className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          aria-label={`归档 ${instance.routeKey?.sessionId || '已取消'} 路由`}
                          onClick={() => void runAction('archive', instance.id)}
                          className="p-1 text-[var(--text-secondary)] hover:text-[var(--danger)]"
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {bound ? (
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] gap-1.5">
                      <input
                        key={`${instance.id}-${effectiveAgentName(instance)}`}
                        className={`${inputClassName} w-full font-medium`}
                        aria-label={`${instance.routeKey?.sessionId} Agent 名称`}
                        title={effectiveAgentName(instance)}
                        defaultValue={effectiveAgentName(instance)}
                        onBlur={event =>
                          void updateInstance(instance.id, {
                            customAgentName:
                              event.target.value === instance.display.observedAgentName
                                ? null
                                : event.target.value,
                          })
                        }
                      />
                      <input
                        key={`${instance.id}-${effectiveRuntimeScopeLabel(instance)}`}
                        className={`${inputClassName} w-full`}
                        aria-label={`${instance.routeKey?.sessionId} 运行范围标签`}
                        title={effectiveRuntimeScopeLabel(instance)}
                        defaultValue={effectiveRuntimeScopeLabel(instance)}
                        onBlur={event =>
                          void updateInstance(instance.id, {
                            customRuntimeSlotLabel:
                              event.target.value === defaultRuntimeScopeLabel(instance)
                                ? null
                                : event.target.value,
                          })
                        }
                      />
                    </div>
                  ) : (
                    <span className="min-w-0 truncate text-xs text-[var(--text-secondary)]">
                      等待首条完整路由键请求
                    </span>
                  )}

                  {bound ? (
                    <div className="grid min-w-0 gap-1">
                      <div className="flex h-7 min-w-0 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--surface-1)] px-2 text-xs text-[var(--text-secondary)]">
                        <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">
                          Session
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate font-mono"
                          title={instance.routeKey?.sessionId}
                        >
                          {instance.routeKey?.sessionId}
                        </span>
                        <button
                          type="button"
                          aria-label={`复制 ${instance.routeKey?.sessionId} Session ID`}
                          onClick={() =>
                            void navigator.clipboard.writeText(instance.routeKey!.sessionId)
                          }
                          className="shrink-0 p-1"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {sessionScopedRoute ? (
                        <span
                          className="truncate text-[10px] text-[var(--text-tertiary)]"
                          title={SESSION_SCOPE_DESCRIPTION}
                        >
                          {SESSION_SCOPE_DESCRIPTION}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div />
                  )}

                  <div className="grid min-h-0 grid-cols-2 content-start gap-1.5">
                    <div className="grid min-w-0 content-start gap-1">
                      <span className="text-[10px] text-[var(--text-tertiary)]">模型</span>
                      <AppSelect
                        size="sm"
                        aria-label={`${instance.id} 路由模型`}
                        value={instance.modelId}
                        onChange={event =>
                          void updateInstance(instance.id, { modelId: event.target.value })
                        }
                      >
                        {modelOptions.map(model => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </AppSelect>
                    </div>
                    <div className="grid min-w-0 content-start gap-1">
                      <span className="text-[10px] text-[var(--text-tertiary)]">思考强度</span>
                      <ReasoningEffortEditor
                        instance={instance}
                        onSave={value => updateInstance(instance.id, { reasoningEffort: value })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-[var(--line-soft)] pt-1.5 text-[10px] text-[var(--text-tertiary)]">
                    <span className="min-w-0 truncate">创建 {formatTime(instance.createdAt)}</span>
                    <span className="min-w-0 truncate text-right">
                      最近 {formatTime(instance.lastRequestAt)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </AppCard>
  );
}
