import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EndpointTestPanel } from '../renderer/components/dialogs/EndpointTestPanel';
import type {
  EndpointTestSelectionInput,
  EndpointTestSelectionState,
  EndpointTestStateView,
} from '../shared/types/route-proxy';

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
  apiKeys: [
    { id: 'key-a', label: 'Key A', models: ['messages-model', 'chat-model'] },
    { id: 'key-b', label: 'Key B', models: ['responses-model'] },
  ],
  models: ['messages-model', 'responses-model', 'chat-model'],
  protocols: {
    'anthropic-messages': {
      apiKeyId: 'key-a',
      model: 'messages-model',
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
    },
  },
};

describe('EndpointTestPanel', () => {
  const getState = vi.fn();
  const saveSelection = vi.fn();
  const run = vi.fn();

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

  it('renders three endpoint tests and restores independent persisted selections', async () => {
    render(<EndpointTestPanel target={target} />);

    const messagesTitle = (await screen.findByText('Anthropic Messages')).parentElement;
    expect(messagesTitle).toHaveClass('items-center');
    expect(messagesTitle).toHaveTextContent('Anthropic Messages/v1/messages');
    expect(screen.getByText('OpenAI Responses')).toBeInTheDocument();
    expect(screen.getByText('OpenAI Chat Completions')).toBeInTheDocument();
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
    await screen.findByText('Anthropic Messages');

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(selects[1], { target: { value: 'chat-model' } });

    await waitFor(() => {
      expect(saveSelection).toHaveBeenCalledWith({
        target,
        protocol: 'anthropic-messages',
        apiKeyId: 'key-a',
        model: 'chat-model',
      });
    });
    expect(selects[3]).toHaveValue('responses-model');
    expect(selects[5]).toHaveValue('chat-model');
  });

  it('updates the displayed latest test time from a completed run', async () => {
    render(<EndpointTestPanel target={target} />);
    await screen.findByText('Anthropic Messages');

    fireEvent.click(screen.getByTitle('测试 /v1/chat/completions'));

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith({
        target,
        protocol: 'openai-chat-completions',
        apiKeyId: 'key-a',
        model: 'chat-model',
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
    await screen.findByText('Anthropic Messages');

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
