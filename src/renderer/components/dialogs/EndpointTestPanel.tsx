import { CheckCircle2, ChevronDown, Clock3, FlaskConical, Play, Save, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  ENDPOINT_TEST_PROTOCOLS,
  type EndpointTestProtocol,
  type EndpointTestSelectionState,
  type EndpointTestStateView,
  type EndpointTestTarget,
} from '../../../shared/types/endpoint-test';
import { toast } from '../../store/toastStore';
import { AppButton } from '../AppButton/AppButton';
import { AppSwitch } from '../AppSwitch';
import {
  AccessPointResourceSectionHeader,
  accessPointFormFieldLabelClass,
  accessPointFormFieldLabelTextClass,
  accessPointFormInputClass,
} from './AccessPointResourcePrimitives';
import { PanelSection } from './PanelSection';

const PROTOCOL_META: Record<EndpointTestProtocol, { title: string; endpoint: string }> = {
  'anthropic-messages': { title: 'Anthropic Messages', endpoint: '/v1/messages' },
  'openai-responses': { title: 'OpenAI Responses', endpoint: '/v1/responses' },
  'openai-chat-completions': {
    title: 'OpenAI Chat Completions',
    endpoint: '/v1/chat/completions',
  },
};

const DEFAULT_TEST_PROMPT = '1.2和1.19哪个更大？';

interface EndpointTestPanelProps {
  target: EndpointTestTarget;
  /** Render endpoint sections without card chrome when hosted inside the access-point shell. */
  embedded?: boolean;
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

function createCurlExpandedState(): Record<EndpointTestProtocol, boolean> {
  return Object.fromEntries(ENDPOINT_TEST_PROTOCOLS.map(protocol => [protocol, false])) as Record<
    EndpointTestProtocol,
    boolean
  >;
}

function getEndpointPathSuffix(baseUrl: string | undefined, endpoint: string): string {
  if (!baseUrl) return endpoint;
  try {
    const baseSegments = new URL(baseUrl).pathname.split('/').filter(Boolean);
    const endpointSegments = endpoint.split('/').filter(Boolean);
    let overlap = 0;
    const maxOverlap = Math.min(baseSegments.length, endpointSegments.length);
    for (let size = 1; size <= maxOverlap; size += 1) {
      if (
        baseSegments.slice(-size).every((segment, index) => segment === endpointSegments[index])
      ) {
        overlap = size;
      }
    }
    const suffix = endpointSegments.slice(overlap).join('/');
    return suffix ? `/${suffix}` : '';
  } catch {
    return endpoint;
  }
}

function createDefaultCurlTemplate(protocol: EndpointTestProtocol, baseUrl?: string): string {
  const headers =
    protocol === 'anthropic-messages'
      ? [
          'x-api-key: {{API_KEY}}',
          'anthropic-version: 2023-06-01',
          'Content-Type: application/json',
        ]
      : ['Authorization: Bearer {{API_KEY}}', 'Content-Type: application/json'];
  const body =
    protocol === 'anthropic-messages'
      ? {
          model: '{{MODEL}}',
          max_tokens: 1024,
          stream: false,
          messages: [{ role: 'user', content: DEFAULT_TEST_PROMPT }],
        }
      : protocol === 'openai-responses'
        ? {
            model: '{{MODEL}}',
            input: DEFAULT_TEST_PROMPT,
            max_output_tokens: 32,
            stream: false,
            store: false,
          }
        : {
            model: '{{MODEL}}',
            max_tokens: 32,
            stream: false,
            messages: [{ role: 'user', content: DEFAULT_TEST_PROMPT }],
          };

  return [
    `curl --request POST '{{BASE_URL}}${getEndpointPathSuffix(baseUrl, PROTOCOL_META[protocol].endpoint)}'`,
    ...headers.map(header => `  --header '${header}'`),
    `  --data-raw '${JSON.stringify(body, null, 2)}'`,
  ].join(' \\\n');
}

function createCurlDrafts(view?: EndpointTestStateView): Record<EndpointTestProtocol, string> {
  return Object.fromEntries(
    ENDPOINT_TEST_PROTOCOLS.map(protocol => {
      const persisted = view?.protocols[protocol].curl;
      return [
        protocol,
        persisted?.trim() ? persisted : createDefaultCurlTemplate(protocol, view?.baseUrl),
      ];
    })
  ) as Record<EndpointTestProtocol, string>;
}

function replaceTemplateValue(value: string, source: string, placeholder: string): string {
  return source ? value.split(source).join(placeholder) : value;
}

function expandCurlTemplate(
  template: string,
  baseUrl: string,
  maskedApiKey: string,
  model: string
): string {
  return template
    .split('{{BASE_URL}}')
    .join(baseUrl.replace(/\/+$/, ''))
    .split('{{API_KEY}}')
    .join(maskedApiKey || '****')
    .split('{{MODEL}}')
    .join(model);
}

function collapseCurlTemplate(
  value: string,
  baseUrl: string,
  maskedApiKey: string,
  model: string
): string {
  let collapsed = replaceTemplateValue(value, baseUrl.replace(/\/+$/, ''), '{{BASE_URL}}');
  collapsed = replaceTemplateValue(collapsed, maskedApiKey, '{{API_KEY}}');
  return replaceTemplateValue(collapsed, model, '{{MODEL}}');
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

export function EndpointTestPanel({ target, embedded = false }: EndpointTestPanelProps) {
  const targetRef = useRef(target);
  targetRef.current = target;
  const [view, setView] = useState<EndpointTestStateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<EndpointTestProtocol | null>(null);
  const [listAllModels, setListAllModels] = useState(createListAllModelsState);
  const [curlDrafts, setCurlDrafts] = useState(createCurlDrafts);
  const [curlExpanded, setCurlExpanded] = useState(createCurlExpandedState);
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
    setCurlDrafts(createCurlDrafts());
    setCurlExpanded(createCurlExpandedState());

    void window.electronAPI.endpointTest
      ?.getState(targetRef.current)
      .then(response => {
        if (!active) return;
        if (!response.success || !response.data) {
          throw new Error(response.error || '无法加载测试配置');
        }
        setView(response.data);
        setCurlDrafts(createCurlDrafts(response.data));
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
      currentView
        ? updateProtocolState(currentView, protocol, { ...next, ...response.data })
        : currentView
    );
  };

  const saveCurl = async (protocol: EndpointTestProtocol) => {
    if (!view) return;
    const state = view.protocols[protocol];
    const curl = curlDrafts[protocol];
    if (!state.apiKeyId || !state.model || !curl.trim()) {
      toast.warning('请输入有效的 cURL 代码');
      return;
    }
    const response = await window.electronAPI.endpointTest?.saveSelection({
      target,
      protocol,
      apiKeyId: state.apiKeyId,
      model: state.model,
      curl,
    });
    if (!response?.success || !response.data) {
      toast.error(response?.error || '保存 cURL 失败');
      return;
    }
    setView(currentView =>
      currentView
        ? updateProtocolState(currentView, protocol, {
            ...currentView.protocols[protocol],
            ...response.data,
          })
        : currentView
    );
    setCurlDrafts(current => ({ ...current, [protocol]: response.data!.curl || curl }));
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
        curl: curlDrafts[protocol],
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
      {ENDPOINT_TEST_PROTOCOLS.map(protocol => {
        const meta = PROTOCOL_META[protocol];
        const state = view.protocols[protocol];
        const latest = state.latest;
        const resultMessage = formatResultMessage(state);
        const canRun = Boolean(state.apiKeyId && state.model);
        const modelOptions = getProtocolModels(view, protocol, listAllModels[protocol]);
        const selectedApiKey = view.apiKeys.find(option => option.id === state.apiKeyId);
        const maskedApiKey = selectedApiKey?.maskedApiKey || '****';
        const displayedCurl = expandCurlTemplate(
          curlDrafts[protocol],
          view.baseUrl ?? '',
          maskedApiKey,
          state.model || ''
        );
        const title = (
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[var(--text-primary)]">{meta.title}</span>
            <span className="min-w-0 truncate rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[11px] font-normal text-[var(--text-secondary)]">
              {meta.endpoint}
            </span>
          </span>
        );
        const actions = (
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
        );
        const body = (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block min-w-0">
                <span className={accessPointFormFieldLabelClass}>API Key</span>
                <select
                  value={state.apiKeyId || ''}
                  onChange={event => void changeApiKey(protocol, event.target.value)}
                  className={accessPointFormInputClass}
                >
                  {view.apiKeys.length === 0 ? <option value="">无可用 API Key</option> : null}
                  {view.apiKeys.map(apiKey => (
                    <option key={apiKey.id} value={apiKey.id}>
                      {apiKey.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="min-w-0">
                <div className="mb-1.5 flex min-h-4 items-center justify-between gap-2">
                  <label
                    htmlFor={`endpoint-test-model-${protocol}`}
                    className={accessPointFormFieldLabelTextClass}
                  >
                    模型
                  </label>
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
                  className={accessPointFormInputClass}
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

            <div className="space-y-2 border-t border-[var(--line-soft)] pt-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius-sm)] py-1 text-left text-xs font-medium text-[var(--text-secondary)] outline-none hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                  aria-expanded={curlExpanded[protocol]}
                  aria-controls={`endpoint-test-curl-content-${protocol}`}
                  aria-label={`${curlExpanded[protocol] ? '折叠' : '展开'} ${meta.title} cURL 编辑器`}
                  onClick={() =>
                    setCurlExpanded(current => ({ ...current, [protocol]: !current[protocol] }))
                  }
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                      curlExpanded[protocol] ? 'rotate-0' : '-rotate-90'
                    }`}
                  />
                  <span>cURL</span>
                </button>
                {curlExpanded[protocol] ? (
                  <AppButton
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="!min-h-7 !px-2.5"
                    onClick={() => void saveCurl(protocol)}
                    disabled={!curlDrafts[protocol].trim() || !canRun || running !== null}
                    title="保存 cURL"
                  >
                    <Save className="h-3.5 w-3.5" />
                    保存
                  </AppButton>
                ) : null}
              </div>
              {curlExpanded[protocol] ? (
                <div id={`endpoint-test-curl-content-${protocol}`}>
                  <textarea
                    id={`endpoint-test-curl-${protocol}`}
                    aria-label={`${meta.title} cURL`}
                    value={displayedCurl}
                    onChange={event =>
                      setCurlDrafts(current => ({
                        ...current,
                        [protocol]: collapseCurlTemplate(
                          event.target.value,
                          view.baseUrl ?? '',
                          maskedApiKey,
                          state.model || ''
                        ),
                      }))
                    }
                    rows={8}
                    spellCheck={false}
                    className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-1.5 font-mono text-xs leading-5 text-[var(--text-primary)] outline-none transition-colors focus:border-transparent focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>
              ) : null}
            </div>

            {latest ? (
              <div className="border-t border-[var(--line-soft)] pt-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                  <span
                    className={`inline-flex items-center gap-1.5 font-medium ${
                      latest.success ? 'text-[var(--success)]' : 'text-[var(--danger)]'
                    }`}
                  >
                    {latest.success ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5" />
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
              <div className="flex items-center gap-2 border-t border-[var(--line-soft)] pt-3 text-xs text-[var(--text-tertiary)]">
                <FlaskConical className="h-3.5 w-3.5" />
                尚未测试
              </div>
            )}
          </>
        );

        if (embedded) {
          return (
            <section
              key={protocol}
              data-testid={`endpoint-test-card-${protocol}`}
              className="space-y-2 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-3)] px-2.5 py-2"
            >
              <AccessPointResourceSectionHeader title={title} actions={actions} />
              {body}
            </section>
          );
        }

        return (
          <PanelSection key={protocol} title={title} collapsible={false} actions={actions}>
            {body}
          </PanelSection>
        );
      })}
    </div>
  );
}
