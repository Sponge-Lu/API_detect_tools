import { CheckCircle2, Clock3, FlaskConical, Play, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  ENDPOINT_TEST_PROTOCOLS,
  type EndpointTestProtocol,
  type EndpointTestSelectionState,
  type EndpointTestStateView,
  type EndpointTestTarget,
} from '../../../shared/types/route-proxy';
import {
  CLI_TARGET_PROTOCOLS,
  normalizeCliTargetProtocol,
  type CliTargetProtocol,
} from '../../../shared/types/cli-config';
import { toast } from '../../store/toastStore';
import { AppButton } from '../AppButton/AppButton';
import { AppSwitch } from '../AppSwitch';
import { PanelSection } from './PanelSection';

const PROTOCOL_META: Record<EndpointTestProtocol, { title: string; endpoint: string }> = {
  'anthropic-messages': { title: 'Anthropic Messages', endpoint: '/v1/messages' },
  'openai-responses': { title: 'OpenAI Responses', endpoint: '/v1/responses' },
  'openai-chat-completions': {
    title: 'OpenAI Chat Completions',
    endpoint: '/v1/chat/completions',
  },
};

interface EndpointTestPanelProps {
  target: EndpointTestTarget;
  routeTargetProtocol?: CliTargetProtocol;
  routeTargetProtocolNeedsConfirmation?: boolean;
  onRouteTargetProtocolChange?: (protocol: CliTargetProtocol) => void | Promise<void>;
}

function formatTestedAt(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(value);
}

function formatResultMessage(state: EndpointTestSelectionState): string {
  const latest = state.latest;
  if (!latest) return '';
  if (!latest.error) return latest.summary || '';
  return latest.error.split(/\r?\n/)[0].replace(/\s+/g, ' ').trim().slice(0, 200);
}

function updateProtocolState(
  view: EndpointTestStateView,
  protocol: EndpointTestProtocol,
  state: EndpointTestSelectionState
): EndpointTestStateView {
  return { ...view, protocols: { ...view.protocols, [protocol]: state } };
}

function createListAllModelsState(): Record<EndpointTestProtocol, boolean> {
  return Object.fromEntries(ENDPOINT_TEST_PROTOCOLS.map(protocol => [protocol, false])) as Record<
    EndpointTestProtocol,
    boolean
  >;
}

function getProtocolModels(
  view: EndpointTestStateView,
  protocol: EndpointTestProtocol,
  listAllModels: boolean,
  includeSelected = true
): string[] {
  const state = view.protocols[protocol];
  const apiKey = view.apiKeys.find(option => option.id === state.apiKeyId);
  const scopedModels = listAllModels ? view.models : (apiKey?.models ?? view.models);
  return Array.from(
    new Set([...scopedModels, ...(includeSelected && state.model ? [state.model] : [])])
  );
}

export function EndpointTestPanel({
  target,
  routeTargetProtocol,
  routeTargetProtocolNeedsConfirmation,
  onRouteTargetProtocolChange,
}: EndpointTestPanelProps) {
  const targetRef = useRef(target);
  targetRef.current = target;
  const [view, setView] = useState<EndpointTestStateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<EndpointTestProtocol | null>(null);
  const [listAllModels, setListAllModels] = useState(createListAllModelsState);
  const targetIdentity =
    target.kind === 'managed'
      ? `managed:${target.siteId}:${target.accountId}`
      : `direct:${target.configId}`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setView(null);
    setListAllModels(createListAllModelsState());

    void window.electronAPI.endpointTest
      ?.getState(targetRef.current)
      .then(response => {
        if (!active) return;
        if (!response.success || !response.data) {
          throw new Error(response.error || '无法加载测试配置');
        }
        setView(response.data);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : '无法加载测试配置');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [targetIdentity]);

  const saveSelection = async (
    protocol: EndpointTestProtocol,
    updates: Partial<Pick<EndpointTestSelectionState, 'apiKeyId' | 'model'>>
  ) => {
    if (!view) return;
    const current = view.protocols[protocol];
    const next = { ...current, ...updates };
    setView(updateProtocolState(view, protocol, next));
    if (!next.apiKeyId || !next.model) return;

    const response = await window.electronAPI.endpointTest?.saveSelection({
      target,
      protocol,
      apiKeyId: next.apiKeyId,
      model: next.model,
    });
    if (!response?.success || !response.data) {
      toast.error(response?.error || '保存测试选择失败');
      return;
    }
    setView(currentView =>
      currentView ? updateProtocolState(currentView, protocol, response.data!) : currentView
    );
  };

  const changeApiKey = async (protocol: EndpointTestProtocol, apiKeyId: string) => {
    if (!view) return;
    const current = view.protocols[protocol];
    const apiKey = view.apiKeys.find(option => option.id === apiKeyId);
    const availableModels = listAllModels[protocol] ? view.models : (apiKey?.models ?? view.models);
    const model = availableModels.includes(current.model || '')
      ? current.model
      : availableModels[0] || null;
    await saveSelection(protocol, { apiKeyId, model });
  };

  const runTest = async (protocol: EndpointTestProtocol) => {
    if (!view) return;
    const selection = view.protocols[protocol];
    if (!selection.apiKeyId || !selection.model) {
      toast.warning('请选择 API Key 和模型');
      return;
    }

    setRunning(protocol);
    try {
      const response = await window.electronAPI.endpointTest?.run({
        target,
        protocol,
        apiKeyId: selection.apiKeyId,
        model: selection.model,
      });
      if (!response?.success || !response.data) {
        throw new Error(response?.error || '测试失败');
      }
      setView(currentView =>
        currentView
          ? updateProtocolState(currentView, protocol, {
              ...currentView.protocols[protocol],
              latest: response.data,
            })
          : currentView
      );
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '测试失败');
    } finally {
      setRunning(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center text-sm text-[var(--text-secondary)]">
        <Clock3 className="mr-2 h-4 w-4 animate-pulse" />
        正在加载
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="flex min-h-48 items-center justify-center px-6 text-center text-sm text-[var(--danger)]">
        {error || '无法加载测试配置'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PanelSection title="路由上游协议" collapsible={false}>
        <select
          aria-label="路由上游协议"
          value={normalizeCliTargetProtocol(routeTargetProtocol)}
          onChange={event =>
            void onRouteTargetProtocolChange?.(normalizeCliTargetProtocol(event.target.value))
          }
          className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        >
          {CLI_TARGET_PROTOCOLS.map(protocol => (
            <option key={protocol} value={protocol}>
              {protocol === 'native'
                ? '自动 / 原生'
                : protocol === 'anthropic-messages'
                  ? 'Anthropic Messages'
                  : protocol === 'openai-chat-completions'
                    ? 'OpenAI Chat Completions'
                    : 'OpenAI Responses'}
            </option>
          ))}
        </select>
        {routeTargetProtocolNeedsConfirmation ? (
          <div className="mt-2 text-xs text-[var(--warning)]">
            旧 CLI 上游协议存在冲突，请确认当前选择。
          </div>
        ) : null}
      </PanelSection>
      {ENDPOINT_TEST_PROTOCOLS.map(protocol => {
        const meta = PROTOCOL_META[protocol];
        const state = view.protocols[protocol];
        const latest = state.latest;
        const resultMessage = formatResultMessage(state);
        const canRun = Boolean(state.apiKeyId && state.model);
        const modelOptions = getProtocolModels(view, protocol, listAllModels[protocol]);

        return (
          <PanelSection
            key={protocol}
            title={
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0">{meta.title}</span>
                <span className="min-w-0 truncate text-xs font-normal text-[var(--text-secondary)]">
                  {meta.endpoint}
                </span>
              </span>
            }
            collapsible={false}
            actions={
              <AppButton
                type="button"
                size="sm"
                className="!min-h-7 !px-2.5"
                onClick={() => void runTest(protocol)}
                loading={running === protocol}
                disabled={!canRun || running !== null}
                title={`测试 ${meta.endpoint}`}
              >
                <Play className="h-3.5 w-3.5" />
                测试
              </AppButton>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="min-w-0 space-y-1.5 text-xs text-[var(--text-secondary)]">
                <span>API Key</span>
                <select
                  value={state.apiKeyId || ''}
                  onChange={event => void changeApiKey(protocol, event.target.value)}
                  className="h-9 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                >
                  {view.apiKeys.length === 0 ? <option value="">无可用 API Key</option> : null}
                  {view.apiKeys.map(apiKey => (
                    <option key={apiKey.id} value={apiKey.id}>
                      {apiKey.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="min-w-0 space-y-1.5 text-xs text-[var(--text-secondary)]">
                <div className="flex min-h-4 items-center justify-between gap-2">
                  <label htmlFor={`endpoint-test-model-${protocol}`}>模型</label>
                  {target.kind === 'managed' ? (
                    <AppSwitch
                      checked={listAllModels[protocol]}
                      onCheckedChange={checked =>
                        setListAllModels(current => ({ ...current, [protocol]: checked }))
                      }
                      label="列出全部模型"
                      size="sm"
                      className="text-xs"
                    />
                  ) : null}
                </div>
                <select
                  id={`endpoint-test-model-${protocol}`}
                  value={state.model || ''}
                  onChange={event => void saveSelection(protocol, { model: event.target.value })}
                  className="h-9 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                >
                  {modelOptions.length === 0 ? <option value="">无可用模型</option> : null}
                  {modelOptions.map(model => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {latest ? (
              <div className="border-t border-[var(--line-muted)] pt-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                  <span
                    className={`inline-flex items-center gap-1.5 font-medium ${
                      latest.success ? 'text-[var(--success)]' : 'text-[var(--danger)]'
                    }`}
                  >
                    {latest.success ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    {latest.success ? '成功' : '失败'}
                  </span>
                  {latest.statusCode ? <span>HTTP {latest.statusCode}</span> : null}
                  <span>{latest.latencyMs} ms</span>
                  <span className="inline-flex items-center gap-1 text-[var(--text-tertiary)]">
                    <Clock3 className="h-3.5 w-3.5" />
                    最近测试：{formatTestedAt(latest.testedAt)}
                  </span>
                </div>
                {resultMessage ? (
                  <p
                    className={`mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-5 ${
                      latest.error ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {resultMessage}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-2 border-t border-[var(--line-muted)] pt-3 text-xs text-[var(--text-tertiary)]">
                <FlaskConical className="h-4 w-4" />
                尚未测试
              </div>
            )}
          </PanelSection>
        );
      })}
    </div>
  );
}
