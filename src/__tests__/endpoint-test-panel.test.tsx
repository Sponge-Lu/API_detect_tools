import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EndpointTestPanel } from '../renderer/components/dialogs/EndpointTestPanel';
import type {
  EndpointTestSelectionInput,
  EndpointTestSelectionState,
  EndpointTestStateView,
} from '../shared/types/endpoint-test';

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('../renderer/store/toastStore', () => ({
  toast: toastMocks,
}));

const target = { kind: 'direct' as const, configId: 'direct-1' };
const initialState: EndpointTestStateView = {
  target,
  targetKey: 'direct:direct-1',
  baseUrl: 'https://direct.example/v1',
  apiKeys: [
    {
      id: 'key-a',
      label: 'Key A',
      maskedApiKey: 'dire******ret',
      models: ['messages-model', 'chat-model'],
    },
    { id: 'key-b', label: 'Key B', maskedApiKey: 'respo******ret', models: ['responses-model'] },
  ],
  models: ['messages-model', 'responses-model', 'chat-model'],
  protocols: {
    'anthropic-messages': {
      apiKeyId: 'key-a',
      model: 'messages-model',
      curl: "curl '{{BASE_URL}}/messages' --header 'x-api-key: {{API_KEY}}' --data-raw '{\"model\":\"{{MODEL}}\"}'",
      latest: {
        success: true,
        endpoint: '/v1/messages',
        apiKeyId: 'key-a',
        apiKeyLabel: 'Key A',
        model: 'messages-model',
        testedAt: 1_770_000_000_000,
        latencyMs: 120,
        statusCode: 200,
        summary: 'OK',
      },
    },
    'openai-responses': {
      apiKeyId: 'key-b',
      model: 'responses-model',
      curl: "curl '{{BASE_URL}}/responses' --header 'Authorization: Bearer {{API_KEY}}' --data-raw '{\"model\":\"{{MODEL}}\"}'",
      latest: {
        success: false,
        endpoint: '/v1/responses',
        apiKeyId: 'key-b',
        apiKeyLabel: 'Key B',
        model: 'responses-model',
        testedAt: 1_770_000_100_000,
        latencyMs: 310,
        statusCode: 503,
        error: 'upstream unavailable',
      },
    },
    'openai-chat-completions': {
      apiKeyId: 'key-a',
      model: 'chat-model',
      curl: "curl '{{BASE_URL}}/chat/completions' --header 'Authorization: Bearer {{API_KEY}}' --data-raw '{\"model\":\"{{MODEL}}\"}'",
    },
  },
};

describe('EndpointTestPanel', () => {
  const getState = vi.fn();
  const saveSelection = vi.fn();
  const run = vi.fn();
  const saveAuthScheme = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getState.mockResolvedValue({ success: true, data: structuredClone(initialState) });
    saveSelection.mockImplementation(async (input: EndpointTestSelectionInput) => ({
      success: true,
      data: {
        apiKeyId: input.apiKeyId,
        model: input.model,
      } satisfies EndpointTestSelectionState,
    }));
    run.mockResolvedValue({
      success: true,
      data: {
        success: true,
        endpoint: '/v1/chat/completions',
        apiKeyId: 'key-a',
        apiKeyLabel: 'Key A',
        model: 'chat-model',
        testedAt: 1_770_000_200_000,
        latencyMs: 88,
        statusCode: 200,
        summary: 'OK chat',
      },
    });

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { endpointTest: { getState, saveSelection, run } },
    });
  });

  it('gives each embedded endpoint its own card boundary', async () => {
    render(<EndpointTestPanel target={target} embedded />);

    await screen.findByTitle('测试 /v1/messages');

    for (const protocol of [
      'anthropic-messages',
      'openai-responses',
      'openai-chat-completions',
    ] as const) {
      expect(screen.getByTestId(`endpoint-test-card-${protocol}`)).toHaveClass(
        'rounded-[var(--radius-md)]',
        'border',
        'border-[var(--line-soft)]',
        'bg-[var(--surface-3)]'
      );
    }

    expect(screen.getByText('/v1/messages')).toHaveClass('font-mono', 'bg-[var(--surface-2)]');
  });

  it('renders three endpoint tests and restores independent persisted selections', async () => {
    render(<EndpointTestPanel target={target} />);

    await screen.findByTitle('测试 /v1/messages');
    const messagesTitle = screen.getByText('/v1/messages').parentElement;
    expect(messagesTitle).toHaveClass('items-center');
    expect(messagesTitle).toHaveTextContent('Anthropic Messages/v1/messages');
    expect(screen.getAllByText('OpenAI Responses')).toHaveLength(1);
    expect(screen.getAllByText('OpenAI Chat Completions')).toHaveLength(1);
    expect(screen.getByText('/v1/messages')).toBeInTheDocument();
    expect(screen.getByText('/v1/responses')).toBeInTheDocument();
    expect(screen.getByText('/v1/chat/completions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anthropic Messages' })).not.toBeInTheDocument();
    expect(screen.getByTitle('测试 /v1/messages')).toHaveClass('!min-h-7', '!px-2.5');

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects).toHaveLength(6);
    expect(selects.map(select => select.value)).toEqual([
      'key-a',
      'messages-model',
      'key-b',
      'responses-model',
      'key-a',
      'chat-model',
    ]);
    expect(screen.queryByRole('option', { name: 'cli-usage-model' })).not.toBeInTheDocument();
    for (const label of [
      'Anthropic Messages cURL',
      'OpenAI Responses cURL',
      'OpenAI Chat Completions cURL',
    ]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: '展开 Anthropic Messages cURL 编辑器' }));
    const curl = screen.getByLabelText('Anthropic Messages cURL') as HTMLTextAreaElement;
    expect(curl.value).toContain("curl 'https://direct.example/v1/messages'");
    expect(curl.value).toContain('x-api-key: dire******ret');
    expect(curl.value).toContain('"model":"messages-model"');
    expect(curl.value).not.toContain('{{BASE_URL}}');
    expect(curl.value).not.toContain('{{API_KEY}}');
    expect(curl.value).not.toContain('{{MODEL}}');
  });

  it('starts cURL editors collapsed and fills missing persisted templates with defaults', async () => {
    const state = structuredClone(initialState);
    for (const protocol of Object.keys(state.protocols) as Array<keyof typeof state.protocols>) {
      state.protocols[protocol].curl = '';
    }
    getState.mockResolvedValueOnce({ success: true, data: state });

    render(<EndpointTestPanel target={target} />);
    await screen.findByTitle('测试 /v1/messages');

    expect(screen.queryByLabelText('Anthropic Messages cURL')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开 Anthropic Messages cURL 编辑器' }));

    const curl = screen.getByLabelText('Anthropic Messages cURL') as HTMLTextAreaElement;
    expect(curl.value).toContain("curl --request POST 'https://direct.example/v1/messages'");
    expect(curl.value).toContain('x-api-key: dire******ret');
    expect(curl.value).toContain('"model": "messages-model"');
    expect(curl.value).toContain('"max_tokens": 1024');
    expect(
      screen.getByRole('button', { name: '折叠 Anthropic Messages cURL 编辑器' })
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps route configuration controls out of the endpoint test panel', async () => {
    render(<EndpointTestPanel target={target} />);

    await screen.findByTitle('测试 /v1/messages');
    expect(screen.queryByRole('combobox', { name: '路由上游协议' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '上游鉴权方式' })).not.toBeInTheDocument();
    expect(screen.queryByText('上游支持协议')).not.toBeInTheDocument();
    expect(saveAuthScheme).not.toHaveBeenCalled();
  });

  it('shows the latest test time for both successful and failed results', async () => {
    render(<EndpointTestPanel target={target} />);

    expect(await screen.findByText('upstream unavailable')).toBeInTheDocument();
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getAllByText(/最近测试：/)).toHaveLength(2);
  });

  it('limits legacy verbose failure details in the UI', async () => {
    const state = structuredClone(initialState);
    state.protocols['openai-responses'].latest!.error = `brief reason\n${'detail'.repeat(100)}`;
    getState.mockResolvedValueOnce({ success: true, data: state });

    render(<EndpointTestPanel target={target} />);

    expect(await screen.findByText('brief reason')).toBeInTheDocument();
    expect(screen.queryByText(/detaildetail/)).not.toBeInTheDocument();
  });

  it('saves endpoint selections independently', async () => {
    render(<EndpointTestPanel target={target} />);
    await screen.findByTitle('测试 /v1/messages');

    const messagesModel = screen.getByLabelText('模型', {
      selector: '#endpoint-test-model-anthropic-messages',
    });
    fireEvent.change(messagesModel, { target: { value: 'chat-model' } });

    await waitFor(() => {
      expect(saveSelection).toHaveBeenCalledWith({
        target,
        protocol: 'anthropic-messages',
        apiKeyId: 'key-a',
        model: 'chat-model',
      });
    });
    expect(
      screen.getByLabelText('模型', { selector: '#endpoint-test-model-openai-responses' })
    ).toHaveValue('responses-model');
    expect(
      screen.getByLabelText('模型', { selector: '#endpoint-test-model-openai-chat-completions' })
    ).toHaveValue('chat-model');
  });

  it('shows editable cURL per endpoint and saves only the selected protocol command', async () => {
    render(<EndpointTestPanel target={target} />);
    await screen.findByTitle('测试 /v1/messages');

    fireEvent.click(screen.getByRole('button', { name: '展开 Anthropic Messages cURL 编辑器' }));
    const curl = screen.getByLabelText('Anthropic Messages cURL') as HTMLTextAreaElement;
    expect(curl).toBeInTheDocument();
    fireEvent.change(curl, { target: { value: "curl 'https://direct.example/v1/messages'" } });
    fireEvent.click(screen.getAllByTitle('保存 cURL')[0]);

    await waitFor(() => {
      expect(saveSelection).toHaveBeenCalledWith({
        target,
        protocol: 'anthropic-messages',
        apiKeyId: 'key-a',
        model: 'messages-model',
        curl: "curl '{{BASE_URL}}/messages'",
      });
    });
    expect(saveSelection).not.toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'openai-responses' })
    );
  });

  it('replaces model and API key placeholders when the selection changes', async () => {
    render(<EndpointTestPanel target={target} />);
    await screen.findByTitle('测试 /v1/messages');

    fireEvent.click(screen.getByRole('button', { name: '展开 Anthropic Messages cURL 编辑器' }));
    const curl = screen.getByLabelText('Anthropic Messages cURL') as HTMLTextAreaElement;
    expect(curl.value).toContain('dire******ret');
    expect(curl.value).toContain('messages-model');

    fireEvent.change(
      screen.getByLabelText('模型', { selector: '#endpoint-test-model-anthropic-messages' }),
      { target: { value: 'chat-model' } }
    );
    await waitFor(() => {
      expect(curl.value).toContain('chat-model');
      expect(curl.value).not.toContain('messages-model');
    });

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'key-b' } });
    await waitFor(() => {
      expect(curl.value).toContain('respo******ret');
      expect(curl.value).not.toContain('dire******ret');
    });
  });

  it('executes an unsaved cURL draft without including it in API/model autosave', async () => {
    render(<EndpointTestPanel target={target} />);
    await screen.findByTitle('测试 /v1/messages');

    fireEvent.click(screen.getByRole('button', { name: '展开 Anthropic Messages cURL 编辑器' }));
    const draft =
      'curl \'{{BASE_URL}}/messages\' --header \'x-api-key: {{API_KEY}}\' --data-raw \'{"model":"{{MODEL}}","draft":true}\'';
    fireEvent.change(screen.getByLabelText('Anthropic Messages cURL'), {
      target: { value: draft },
    });
    fireEvent.change(
      screen.getByLabelText('模型', { selector: '#endpoint-test-model-anthropic-messages' }),
      { target: { value: 'chat-model' } }
    );

    await waitFor(() => {
      expect(saveSelection).toHaveBeenCalledWith({
        target,
        protocol: 'anthropic-messages',
        apiKeyId: 'key-a',
        model: 'chat-model',
      });
    });
    fireEvent.click(screen.getByTitle('测试 /v1/messages'));
    await waitFor(() => {
      expect(run).toHaveBeenCalledWith({
        target,
        protocol: 'anthropic-messages',
        apiKeyId: 'key-a',
        model: 'chat-model',
        curl: draft,
      });
    });
  });

  it('updates the displayed latest test time from a completed run', async () => {
    render(<EndpointTestPanel target={target} />);
    await screen.findByTitle('测试 /v1/messages');

    fireEvent.click(screen.getByTitle('测试 /v1/chat/completions'));

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith({
        target,
        protocol: 'openai-chat-completions',
        apiKeyId: 'key-a',
        model: 'chat-model',
        curl: initialState.protocols['openai-chat-completions'].curl,
      });
    });
    expect(await screen.findByText('OK chat')).toBeInTheDocument();
    expect(screen.getAllByText(/最近测试：/)).toHaveLength(3);
  });

  it('filters managed models by API Key and can list all site models per endpoint', async () => {
    const managedTarget = {
      kind: 'managed' as const,
      siteId: 'site-1',
      accountId: 'account-1',
    };
    getState.mockResolvedValueOnce({
      success: true,
      data: {
        ...structuredClone(initialState),
        target: managedTarget,
        targetKey: 'managed:site-1:account-1',
        apiKeys: [
          { id: 'key-a', label: 'Alpha Key', group: 'alpha', models: ['messages-model'] },
          { id: 'key-b', label: 'Beta Key', group: 'beta', models: ['responses-model'] },
        ],
        protocols: {
          ...structuredClone(initialState.protocols),
          'anthropic-messages': { apiKeyId: 'key-a', model: 'messages-model' },
        },
      },
    });

    render(<EndpointTestPanel target={managedTarget} />);
    await screen.findByTitle('测试 /v1/messages');

    const modelSelect = screen.getByLabelText('模型', {
      selector: '#endpoint-test-model-anthropic-messages',
    });
    expect(modelSelect).toHaveDisplayValue('messages-model');
    expect(within(modelSelect).queryByRole('option', { name: 'responses-model' })).toBeNull();

    const listAllSwitch = screen.getAllByRole('switch', { name: '列出全部模型' })[0];
    fireEvent.click(listAllSwitch);
    expect(
      within(modelSelect).getByRole('option', { name: 'responses-model' })
    ).toBeInTheDocument();

    fireEvent.click(listAllSwitch);
    const apiKeySelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(apiKeySelect, { target: { value: 'key-b' } });
    await waitFor(() => expect(modelSelect).toHaveValue('responses-model'));
  });
});
