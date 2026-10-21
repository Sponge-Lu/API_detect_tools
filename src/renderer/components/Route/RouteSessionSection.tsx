import { Archive, CircleStop, Copy, RefreshCw, RotateCcw, UserRoundPlus, X } from 'lucide-react';
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
import {
  buildRouteSessionOrdinals,
  formatRouteSessionLabel,
  sessionColorForSession,
} from '../../utils/routeSessionOrdinal';

const inputClassName =
  'h-7 min-w-0 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]';
// 幽灵输入：平时呈纯文本，悬停/聚焦才露出输入框轮廓，消除卡片表单感
const ghostInputClassName =
  'min-w-0 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1.5 outline-none hover:border-[var(--line-soft)] hover:bg-[var(--surface-1)] focus:border-[var(--accent)] focus:bg-[var(--surface-1)]';
// 备注是卡片的视觉锚点：全卡最大字号、会话色，空态以灰占位引导填写
const noteHeroClassName =
  'h-8 min-w-0 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1.5 text-[16px] font-semibold outline-none placeholder:font-normal placeholder:text-[var(--text-tertiary)] hover:border-[var(--line-soft)] focus:border-[var(--accent)] focus:bg-[var(--surface-1)]';
// !py-0：AppSelect size=sm 自带 py-[var(--spacing-sm)]（8px），级联顺序在 py-0 之后，普通 py-0 无效，h-7 下会裁切文字下半
const selectClassName = 'h-7 rounded-[var(--radius-sm)] !py-0 text-xs leading-4';
// mini 专用幽灵下拉：去外框留箭头（箭头为 AppSelect 内绝对定位图标，不受影响），h-5 压扁省纵向空间
const ghostSelectClassName =
  'h-5 rounded-[var(--radius-sm)] !border-transparent !bg-transparent !py-0 !pr-6 text-xs leading-4 hover:!border-[var(--line-soft)] focus:!border-[var(--accent)] focus:!bg-[var(--surface-1)]';
const flatInputClassName =
  'h-5 min-w-0 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]';
const CUSTOM_REASONING_EFFORT = '__custom__';
const SESSION_SCOPE_LABEL = '会话级路由';

function formatTime(value?: number): string {
  if (!value) return '等待首条请求';
  const date = new Date(value);
  const pad = (part: number) => part.toString().padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

/** input 的 size 按字符宽估算（CJK 记 2），让幽灵输入贴合内容宽度、编号得以紧跟其后 */
function inputSizeForContent(value: string): number {
  const width = [...value].reduce((sum, char) => sum + (char.charCodeAt(0) > 0xff ? 2 : 1), 0);
  return Math.max(2, Math.min(width + 1, 28));
}

interface ReasoningEffortEditorProps {
  instance: RouteInstance;
  onSave: (value: string) => Promise<void>;
  selectClassName?: string;
  customInputClassName?: string;
}

function resolveReasoningEffortMode(value: string): string {
  const normalized = value.trim().toLowerCase();
  return isRouteThinkingEffortPreset(normalized) ? normalized : CUSTOM_REASONING_EFFORT;
}

function ReasoningEffortEditor({
  instance,
  onSave,
  selectClassName: editorSelectClassName = selectClassName,
  customInputClassName: editorCustomInputClassName = inputClassName,
}: ReasoningEffortEditorProps) {
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
        className={editorSelectClassName}
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
          className={editorCustomInputClassName}
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

export function RouteSessionSection({ mini = false }: { mini?: boolean } = {}) {
  const config = useRouteStore(state => state.config);
  const [instances, setInstances] = useState<RouteInstance[]>([]);
  // 同一客户端开多个会话窗口时仅靠名称/色点无法区分，用稳定序号标识
  const sessionOrdinals = useMemo(() => buildRouteSessionOrdinals(instances), [instances]);
  // 子卡片（parentInstanceId 存在）不再平铺，而是叠放到其主卡片后方（半透明叠层常驻展示）
  const { rootInstances, childInstancesByParent } = useMemo(() => {
    const roots: RouteInstance[] = [];
    const children = new Map<string, RouteInstance[]>();
    for (const instance of instances) {
      if (instance.parentInstanceId) {
        const siblings = children.get(instance.parentInstanceId) || [];
        siblings.push(instance);
        children.set(instance.parentInstanceId, siblings);
      } else {
        roots.push(instance);
      }
    }
    return { rootInstances: roots, childInstancesByParent: children };
  }, [instances]);
  const [loading, setLoading] = useState(false);
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

  // 直接创建等待中的 armed 卡片（模型留空、思考强度默认 medium），选择在卡片上就地完成
  const createArmed = async () => {
    const response = await window.electronAPI.route?.createArmedRouteInstance?.({});
    if (!response?.success) {
      toast.error(response?.error || '创建等待路由失败');
      return;
    }
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

  const runAction = async (
    action: 'close' | 'cancel' | 'restore' | 'archive',
    instanceId: string
  ) => {
    const api = window.electronAPI.route;
    const response =
      action === 'close'
        ? await api?.closeRouteInstance?.(instanceId)
        : action === 'cancel'
          ? await api?.cancelArmedRouteInstance?.(instanceId)
          : action === 'restore'
            ? await api?.restoreRouteInstance?.(instanceId)
            : await api?.archiveRouteInstance?.(instanceId);
    if (!response?.success) {
      toast.error(response?.error || '路由操作失败');
      return;
    }
    await loadInstances();
  };

  return (
    <AppCard
      variant="standard"
      hoverable={false}
      blur={false}
      className={`flex min-h-0 flex-col ${mini ? 'h-full' : ''}`}
    >
      <div
        className={`flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line-soft)] ${
          mini ? 'h-9 px-2.5' : 'min-h-10 flex-wrap px-3 py-1.5'
        }`}
      >
        <div className="flex min-w-0 items-baseline gap-1.5">
          <h2
            className={`font-semibold text-[var(--text-primary)] ${mini ? 'text-xs' : 'text-sm'}`}
          >
            会话路由
          </h2>
          {mini ? (
            <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">
              {instances.length} 项
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <AppButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void createArmed()}
            disabled={instances.some(instance => instance.routingState === 'armed')}
            title={mini ? '为下一个新会话创建路由' : undefined}
          >
            <UserRoundPlus className="h-4 w-4" />
            {mini ? '新建路由' : '为下一个新会话创建路由'}
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

      {instances.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
          暂无会话路由。可以点击上方按钮为下一个新会话创建路由，也可以直接发送请求自动创建。
        </div>
      ) : (
        <div
          data-testid="route-session-grid-scroll"
          className={mini ? 'min-h-0 flex-1 overflow-y-auto' : 'overflow-x-auto'}
        >
          <div
            data-testid="route-session-grid"
            className={
              mini ? 'grid grid-cols-1 gap-1.5 p-1.5' : 'grid min-w-[60rem] grid-cols-3 gap-2 p-2'
            }
          >
            {rootInstances.map(instance => {
              const bound = Boolean(instance.routeKey);
              const ordinal = sessionOrdinals[instance.id];
              // 色点与会话卡片共用同一取色逻辑：客户端+编号共同决定，同会话颜色恒定
              const sessionColor = sessionColorForSession(
                instance.routeKey?.agentId ?? instance.id,
                ordinal
              );
              const childInstances = childInstancesByParent.get(instance.id) || [];
              return (
                <div key={instance.id} className="flex min-w-0 flex-col">
                  <SessionCard
                    instance={instance}
                    bound={bound}
                    ordinal={ordinal}
                    sessionColor={sessionColor}
                    onUpdate={updateInstance}
                    onRunAction={runAction}
                    modelOptions={modelOptions}
                    mini={mini}
                  />
                  {childInstances.length > 0 ? (
                    <div
                      data-testid={`route-session-children-${instance.id}`}
                      className="ml-4 flex flex-col"
                    >
                      {childInstances.map((child, index) => (
                        <SessionCard
                          key={child.id}
                          instance={child}
                          bound={Boolean(child.routeKey)}
                          ordinal={sessionOrdinals[child.id]}
                          sessionColor={sessionColor}
                          onUpdate={updateInstance}
                          onRunAction={runAction}
                          modelOptions={modelOptions}
                          isChild
                          stackLayer={index}
                          mini={mini}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AppCard>
  );
}

interface SessionCardProps {
  instance: RouteInstance;
  bound: boolean;
  ordinal: ReturnType<typeof buildRouteSessionOrdinals>[string];
  sessionColor: string;
  onUpdate: (instanceId: string, updates: RouteInstanceUpdate) => Promise<void>;
  onRunAction: (
    action: 'close' | 'cancel' | 'restore' | 'archive',
    instanceId: string
  ) => Promise<void>;
  modelOptions: string[];
  isChild?: boolean;
  stackLayer?: number;
  mini?: boolean;
}

function SessionCard({
  instance,
  bound,
  ordinal,
  sessionColor,
  onUpdate,
  onRunAction,
  modelOptions,
  isChild,
  stackLayer,
  mini = false,
}: SessionCardProps) {
  // 客户端名称与编号同框展示；编号仅为展示后缀，保存前剥离
  const nameWithOrdinal = formatRouteSessionLabel(effectiveAgentName(instance), ordinal);
  const terminated = instance.routingState === 'closed' || instance.routingState === 'cancelled';
  // mini 密度：动作按钮只留图标，文字说明交给 aria-label/title
  const actionButtonClassName = `flex items-center rounded-[var(--radius-sm)] text-[11px] text-[var(--text-secondary)] transition-colors ${
    mini ? 'p-0.5' : 'gap-1 px-1.5 py-1'
  }`;

  const actionButtons = (
    <div className="ml-auto flex shrink-0 items-center">
      {instance.routingState === 'armed' ? (
        <button
          type="button"
          aria-label="取消等待路由"
          title={mini ? '取消等待路由' : undefined}
          onClick={() => void onRunAction('cancel', instance.id)}
          className={`${actionButtonClassName} hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]`}
        >
          <X className="h-3.5 w-3.5" />
          {mini ? null : '取消'}
        </button>
      ) : instance.routingState === 'active' ? (
        <button
          type="button"
          aria-label={`关闭 ${instance.routeKey?.sessionId} 路由`}
          title={mini ? `关闭 ${instance.routeKey?.sessionId} 路由` : undefined}
          onClick={() => void onRunAction('close', instance.id)}
          className={`${actionButtonClassName} hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]`}
        >
          <CircleStop className="h-3.5 w-3.5" />
          {mini ? null : '关闭'}
        </button>
      ) : terminated ? (
        <>
          <button
            type="button"
            aria-label={`恢复 ${instance.routeKey?.sessionId || '已取消'} 路由`}
            title={mini ? `恢复 ${instance.routeKey?.sessionId || '已取消'} 路由` : undefined}
            onClick={() => void onRunAction('restore', instance.id)}
            className={`${actionButtonClassName} hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {mini ? null : '恢复'}
          </button>
          <button
            type="button"
            aria-label={`归档 ${instance.routeKey?.sessionId || '已取消'} 路由`}
            title={mini ? `归档 ${instance.routeKey?.sessionId || '已取消'} 路由` : undefined}
            onClick={() => void onRunAction('archive', instance.id)}
            className={`${actionButtonClassName} hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]`}
          >
            <Archive className="h-3.5 w-3.5" />
            {mini ? null : '归档'}
          </button>
        </>
      ) : null}
    </div>
  );

  const agentIdentity = bound ? (
    <>
      <AgentLogo
        agentId={instance.routeKey?.agentId}
        agentName={effectiveAgentName(instance)}
        className="h-4 w-4 shrink-0"
      />
      {mini ? (
        // mini 密度下名称仅作展示（重命名走标准密度卡片），字号与映射列表主文本一致
        <span
          className="min-w-0 shrink truncate text-[13px] font-semibold leading-4 text-[var(--text-primary)]"
          title={nameWithOrdinal}
        >
          {nameWithOrdinal}
        </span>
      ) : (
        <div className="flex min-w-0 flex-1 items-center">
          <input
            key={`${instance.id}-${nameWithOrdinal}`}
            size={inputSizeForContent(nameWithOrdinal)}
            className={`${ghostInputClassName} h-6 w-auto min-w-0 text-xs font-medium text-[var(--text-primary)]`}
            aria-label={`${instance.routeKey?.sessionId} Agent 名称`}
            title={nameWithOrdinal}
            defaultValue={nameWithOrdinal}
            onBlur={event => {
              const value = event.target.value.replace(/\s+#\d+(?:\.\d+)?$/, '').trim();
              void onUpdate(instance.id, {
                customAgentName: value === instance.display.observedAgentName ? null : value,
              });
            }}
          />
        </div>
      )}
    </>
  ) : null;

  const noteInput = (
    <input
      key={`${instance.id}-note-${instance.display.customNote ?? ''}`}
      className={mini ? `${ghostInputClassName} h-4 min-w-0 flex-1 text-xs` : noteHeroClassName}
      style={{ color: sessionColor }}
      aria-label={`${instance.id} 备注`}
      title={instance.display.customNote}
      placeholder={mini ? '备注' : '备注 · 标识这份工作'}
      defaultValue={instance.display.customNote ?? ''}
      onBlur={event => {
        const value = event.target.value.trim();
        if (value === (instance.display.customNote ?? '')) return;
        void onUpdate(instance.id, { customNote: value || null });
      }}
    />
  );

  const modelSelect = (
    <AppSelect
      size="sm"
      className={mini ? ghostSelectClassName : selectClassName}
      aria-label={`${instance.id} 路由模型`}
      value={instance.modelId}
      onChange={event => void onUpdate(instance.id, { modelId: event.target.value })}
    >
      {/* armed 卡片模型留空时以下拉占位项提示待选择 */}
      {instance.modelId ? null : <option value="">选择模型</option>}
      {modelOptions.map(model => (
        <option key={model} value={model}>
          {model}
        </option>
      ))}
    </AppSelect>
  );

  const effortEditor = (
    <ReasoningEffortEditor
      instance={instance}
      onSave={value => onUpdate(instance.id, { reasoningEffort: value })}
      selectClassName={mini ? ghostSelectClassName : selectClassName}
      customInputClassName={mini ? flatInputClassName : inputClassName}
    />
  );

  const sessionCopyButton = (
    <button
      type="button"
      aria-label={`复制 ${instance.routeKey?.sessionId} Session ID`}
      onClick={() => void navigator.clipboard.writeText(instance.routeKey!.sessionId)}
      className="shrink-0 rounded-[var(--radius-sm)] p-0.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--accent)]"
    >
      <Copy className="h-3 w-3" />
    </button>
  );

  if (mini) {
    // mini 卡片三行扁结构：头部(logo+名称+备注+动作图标) → Session(横线上方) → 横线下的幽灵下拉(模型+思考强度)；
    // 行高与间距压缩到最小（py-1/gap-0.5/下拉 h-5），运行范围标签、创建时间、字段标签与名称编辑在此密度下省略
    return (
      <article
        data-testid={`route-session-card-${instance.id}`}
        data-density="mini"
        className={`flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-md)] border border-l-[3px] border-[var(--line-soft)] bg-[var(--surface-2)] px-2 py-1 transition-shadow hover:shadow-sm ${
          terminated ? 'opacity-60' : ''
        } ${isChild ? '-mt-1.5 opacity-80 shadow-[0_-2px_6px_color-mix(in_srgb,var(--text-primary)_6%,transparent)]' : ''}`}
        style={{
          borderLeftColor: sessionColor,
          zIndex: isChild && stackLayer !== undefined ? -(stackLayer + 1) : undefined,
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {agentIdentity}
          {noteInput}
          {actionButtons}
        </div>
        {bound ? (
          <div className="flex min-w-0 items-center gap-1">
            <span
              className="min-w-0 flex-1 truncate font-mono text-[11px] leading-4 text-[var(--text-secondary)]"
              title={instance.routeKey?.sessionId}
            >
              {instance.routeKey?.sessionId}
            </span>
            {sessionCopyButton}
          </div>
        ) : null}
        <div className="flex min-w-0 items-center gap-1.5 border-t border-[var(--line-soft)] pt-0.5">
          <div className="min-w-0 flex-1">{modelSelect}</div>
          <div className="w-20 shrink-0">{effortEditor}</div>
        </div>
      </article>
    );
  }

  return (
    <article
      data-testid={`route-session-card-${instance.id}`}
      data-density="compact"
      className={`grid h-auto min-w-0 grid-rows-[auto_auto_auto_auto_auto] gap-2 rounded-[var(--radius-md)] border border-l-[3px] border-[var(--line-soft)] bg-[var(--surface-2)] p-3 transition-shadow hover:shadow-sm ${
        terminated ? 'opacity-60' : ''
      } ${isChild ? '-mt-1.5 opacity-80 shadow-[0_-2px_6px_color-mix(in_srgb,var(--text-primary)_6%,transparent)]' : ''}`}
      style={{
        borderLeftColor: sessionColor,
        zIndex: isChild && stackLayer !== undefined ? -(stackLayer + 1) : undefined,
      }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {agentIdentity}
        {actionButtons}
      </div>

      {noteInput}

      {bound ? (
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 text-[11px] leading-4">
            <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">Session</span>
            <span
              className="min-w-0 truncate font-mono text-[var(--text-secondary)]"
              title={instance.routeKey?.sessionId}
            >
              {instance.routeKey?.sessionId}
            </span>
            {sessionCopyButton}
          </div>
          <input
            key={`${instance.id}-${effectiveRuntimeScopeLabel(instance)}`}
            className={`${ghostInputClassName} h-6 w-[30%] shrink-0 text-[11px] text-[var(--text-secondary)]`}
            aria-label={`${instance.routeKey?.sessionId} 运行范围标签`}
            title={effectiveRuntimeScopeLabel(instance)}
            defaultValue={effectiveRuntimeScopeLabel(instance)}
            onBlur={event =>
              void onUpdate(instance.id, {
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
          {instance.routingState === 'cancelled' ? '已取消的预创建路由' : '等待首条完整路由键请求'}
        </span>
      )}

      <div className="grid min-h-0 grid-cols-2 content-start gap-2 border-t border-[var(--line-soft)] pt-2">
        <div className="grid min-w-0 content-start gap-1">
          <span className="text-[10px] leading-3 text-[var(--text-tertiary)]">模型</span>
          {modelSelect}
        </div>
        <div className="grid min-w-0 content-start gap-1">
          <span className="text-[10px] leading-3 text-[var(--text-tertiary)]">思考强度</span>
          {effortEditor}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] leading-3 text-[var(--text-tertiary)]">
        <span className="min-w-0 truncate">创建 {formatTime(instance.createdAt)}</span>
        <span className="min-w-0 truncate">最近 {formatTime(instance.lastRequestAt)}</span>
      </div>
    </article>
  );
}
