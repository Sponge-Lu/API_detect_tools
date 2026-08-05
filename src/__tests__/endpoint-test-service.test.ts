import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointTestProtocol } from '../shared/types/route-proxy';

const mocks = vi.hoisted(() => ({
  loadStorage: vi.fn(),
  resolveAccountApiKeyValue: vi.fn(),
  ensureRouteProxyReady: vi.fn(),
  saveEndpointTestsState: vi.fn(),
  buildTargetLockRouteApiKey: vi.fn(),
  exportConfigSync: vi.fn(),
  getRoutingConfig: vi.fn(),
}));

vi.mock('../main/custom-cli-config-service', () => ({
  buildCustomCliRouteAccountId: (id: string) => `custom-cli-account:${id}`,
  buildCustomCliRouteApiKeyId: (id: string) => `custom-cli-key:${id}`,
  buildCustomCliRouteSiteId: (id: string) => `custom-cli-site:${id}`,
  loadCustomCliConfigStorage: mocks.loadStorage,
}));

vi.mock('../main/route-channel-resolver', () => ({
  isRouteMaskedApiKeyValue: (value: string) => value.startsWith('masked:'),
  resolveAccountApiKeyValue: mocks.resolveAccountApiKeyValue,
}));

vi.mock('../main/route-model-registry-service', () => ({
  resolveApiKeyId: (apiKey: { id?: string | number }) => String(apiKey.id ?? 'unknown'),
}));

vi.mock('../main/route-proxy-service', () => ({
  ensureRouteProxyReady: mocks.ensureRouteProxyReady,
}));

vi.mock('../main/route-state-manager', () => ({
  routeStateManager: { saveEndpointTestsState: mocks.saveEndpointTestsState },
}));

vi.mock('../main/route-target-lock', () => ({
  buildTargetLockRouteApiKey: mocks.buildTargetLockRouteApiKey,
}));

vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: {
    exportConfigSync: mocks.exportConfigSync,
    getRoutingConfig: mocks.getRoutingConfig,
  },
}));

import {
  getEndpointTestState,
  runEndpointTest,
  saveEndpointTestSelection,
} from '../main/endpoint-test-service';

const directTarget = { kind: 'direct' as const, configId: 'direct-1' };
const directApiKeyId = 'custom-cli-key:direct-1';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('endpoint-test-service', () => {
  const routing = { endpointTests: {} as Record<string, unknown> };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    routing.endpointTests = {};
    mocks.loadStorage.mockResolvedValue({
      configs: [
        {
          id: 'direct-1',
          name: 'Direct One',
          baseUrl: 'https://direct.example/v1',
          apiKey: 'direct-secret',
          models: ['model-a', 'model-b'],
          manualModels: ['model-b', 'model-c'],
        },
      ],
    });
    mocks.getRoutingConfig.mockReturnValue(routing);
    mocks.ensureRouteProxyReady.mockResolvedValue({
      baseUrl: 'http://127.0.0.1:3456',
      unifiedApiKey: 'route-secret',
    });
    mocks.buildTargetLockRouteApiKey.mockReturnValue('target-lock-key');
    mocks.saveEndpointTestsState.mockResolvedValue(undefined);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it.each<{
    protocol: EndpointTestProtocol;
    endpoint: string;
    payload: unknown;
    expectedHeaders: Record<string, string>;
    expectedBody: Record<string, unknown>;
  }>([
    {
      protocol: 'anthropic-messages',
      endpoint: '/v1/messages',
      payload: { content: [{ type: 'text', text: 'OK messages' }] },
      expectedHeaders: {
        'Content-Type': 'application/json',
        'x-api-key': 'target-lock-key',
        'anthropic-version': '2023-06-01',
      },
      expectedBody: {
        model: 'model-a',
        max_tokens: 32,
        stream: false,
        messages: [{ role: 'user', content: '1.2和1.19哪个更大？' }],
      },
    },
    {
      protocol: 'openai-responses',
      endpoint: '/v1/responses',
      payload: { output_text: 'OK responses' },
      expectedHeaders: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer target-lock-key',
      },
      expectedBody: {
        model: 'model-a',
        input: '1.2和1.19哪个更大？',
        max_output_tokens: 32,
        stream: false,
      },
    },
    {
      protocol: 'openai-chat-completions',
      endpoint: '/v1/chat/completions',
      payload: { choices: [{ message: { content: 'OK chat' } }] },
      expectedHeaders: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer target-lock-key',
      },
      expectedBody: {
        model: 'model-a',
        max_tokens: 32,
        stream: false,
        messages: [{ role: 'user', content: '1.2和1.19哪个更大？' }],
      },
    },
  ])(
    'sends a protocol-only $protocol request and persists its tested time',
    async ({ protocol, endpoint, payload, expectedHeaders, expectedBody }) => {
      fetchMock.mockResolvedValue(jsonResponse(payload));
      const before = Date.now();

      const result = await runEndpointTest({
        target: directTarget,
        protocol,
        apiKeyId: directApiKeyId,
        model: 'model-a',
      });

      expect(result).toMatchObject({ success: true, endpoint, model: 'model-a' });
      expect(result.testedAt).toBeGreaterThanOrEqual(before);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`http://127.0.0.1:3456${endpoint}`);
      expect(init.headers).toEqual(expectedHeaders);
      expect(JSON.parse(String(init.body))).toEqual(expectedBody);

      const headerNames = Object.keys(init.headers as Record<string, string>).map(name =>
        name.toLowerCase()
      );
      expect(headerNames).not.toContain('user-agent');
      expect(headerNames).not.toContain('originator');
      expect(headerNames).not.toContain('x-api-detect-cli');
      expect(headerNames.some(name => name.includes('grok'))).toBe(false);
      expect(mocks.saveEndpointTestsState).toHaveBeenCalledTimes(1);
      expect(
        (
          routing.endpointTests['direct:direct-1'] as {
            protocols: Record<string, { latest: { testedAt: number } }>;
          }
        ).protocols[protocol].latest.testedAt
      ).toBe(result.testedAt);
    }
  );

  it.each([
    {
      name: 'HTTP failure',
      response: () => new Response('upstream rejected', { status: 503 }),
      expectedError: 'HTTP 503：upstream rejected',
    },
    {
      name: 'invalid JSON',
      response: () => new Response('not-json', { status: 200 }),
      expectedError: '响应不是有效 JSON',
    },
    {
      name: 'missing generated text',
      response: () => jsonResponse({ choices: [] }),
      expectedError: '响应中没有生成文本',
    },
  ])('persists testedAt for $name', async ({ response, expectedError }) => {
    fetchMock.mockResolvedValue(response());
    const before = Date.now();

    const result = await runEndpointTest({
      target: directTarget,
      protocol: 'openai-chat-completions',
      apiKeyId: directApiKeyId,
      model: 'model-a',
    });

    expect(result).toMatchObject({ success: false, error: expectedError });
    expect(result.testedAt).toBeGreaterThanOrEqual(before);
    expect(mocks.saveEndpointTestsState).toHaveBeenCalledTimes(1);
  });

  it('persists testedAt when fetch times out or throws', async () => {
    fetchMock.mockRejectedValue(new Error('request timed out'));
    const before = Date.now();

    const result = await runEndpointTest({
      target: directTarget,
      protocol: 'openai-responses',
      apiKeyId: directApiKeyId,
      model: 'model-a',
    });

    expect(result).toMatchObject({ success: false, error: '请求超时' });
    expect(result.testedAt).toBeGreaterThanOrEqual(before);
    expect(mocks.saveEndpointTestsState).toHaveBeenCalledTimes(1);
  });

  it('bounds success summaries to 1000 characters and failure reasons to 200 characters', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ output_text: `  ${'a'.repeat(1200)}  ` }));
    const success = await runEndpointTest({
      target: directTarget,
      protocol: 'openai-responses',
      apiKeyId: directApiKeyId,
      model: 'model-a',
    });
    expect(success.summary).toHaveLength(1000);

    fetchMock.mockResolvedValueOnce(new Response('b'.repeat(1200), { status: 500 }));
    const failure = await runEndpointTest({
      target: directTarget,
      protocol: 'openai-responses',
      apiKeyId: directApiKeyId,
      model: 'model-a',
    });
    expect(failure.error).toHaveLength(200);
  });

  it('persists and restores independent endpoint selections for a direct target', async () => {
    await saveEndpointTestSelection({
      target: directTarget,
      protocol: 'openai-responses',
      apiKeyId: directApiKeyId,
      model: 'model-c',
    });

    const state = await getEndpointTestState(directTarget);

    expect(state).toMatchObject({
      targetKey: 'direct:direct-1',
      apiKeys: [{ id: directApiKeyId, label: '默认 API Key' }],
      models: ['model-a', 'model-b', 'model-c'],
    });
    expect(state.protocols['openai-responses'].model).toBe('model-c');
    expect(state.protocols['anthropic-messages'].model).toBe('model-a');
  });

  it('uses the direct Base URL, API Key, and selected model in the target lock', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output_text: 'OK' }));

    await runEndpointTest({
      target: directTarget,
      protocol: 'openai-responses',
      apiKeyId: directApiKeyId,
      model: 'model-c',
    });

    expect(mocks.buildTargetLockRouteApiKey).toHaveBeenCalledWith('route-secret', {
      siteId: 'custom-cli-site:direct-1',
      accountId: 'custom-cli-account:direct-1',
      apiKeyId: directApiKeyId,
      canonicalModel: 'model-c',
      rawModel: 'model-c',
      targetProtocol: 'openai-responses',
      upstreamBaseUrl: 'https://direct.example/v1',
      upstreamApiKey: 'direct-secret',
    });
  });

  it('persists a tested time when a managed API Key cannot be resolved', async () => {
    mocks.exportConfigSync.mockReturnValue({
      sites: [{ id: 'site-1', name: 'Managed', url: 'https://managed.example', enabled: true }],
      accounts: [
        {
          id: 'account-1',
          site_id: 'site-1',
          cached_data: {
            api_keys: [{ id: 'key-1', name: 'Managed Key', status: 'active' }],
            models: ['managed-model'],
          },
        },
      ],
      routing: { server: { requestTimeoutMs: 1000 } },
    });
    mocks.resolveAccountApiKeyValue.mockResolvedValue(null);
    const before = Date.now();

    const result = await runEndpointTest({
      target: { kind: 'managed', siteId: 'site-1', accountId: 'account-1' },
      protocol: 'anthropic-messages',
      apiKeyId: 'key-1',
      model: 'managed-model',
    });

    expect(result).toMatchObject({ success: false, error: '无法解析所选 API Key' });
    expect(result.testedAt).toBeGreaterThanOrEqual(before);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.saveEndpointTestsState).toHaveBeenCalledTimes(1);
  });

  it('returns managed models scoped to each API Key group and preserves the full model list', async () => {
    mocks.exportConfigSync.mockReturnValue({
      sites: [{ id: 'site-1', name: 'Managed', url: 'https://managed.example', enabled: true }],
      accounts: [
        {
          id: 'account-1',
          site_id: 'site-1',
          cached_data: {
            api_keys: [
              { id: 'key-a', name: 'Alpha Key', group: 'alpha', status: 'active' },
              { id: 'key-b', name: 'Beta Key', group: 'beta', status: 'active' },
            ],
            models: ['shared-model'],
            model_pricing: {
              data: {
                'shared-model': { enable_groups: ['alpha', 'beta'] },
                'alpha-model': { enable_groups: ['alpha'] },
                'beta-model': { enable_groups: ['beta'] },
              },
            },
          },
        },
      ],
      routing: { server: { requestTimeoutMs: 1000 } },
    });

    const state = await getEndpointTestState({
      kind: 'managed',
      siteId: 'site-1',
      accountId: 'account-1',
    });

    expect(state.models).toEqual(['shared-model', 'alpha-model', 'beta-model']);
    expect(state.apiKeys).toEqual([
      {
        id: 'key-a',
        label: 'Alpha Key',
        group: 'alpha',
        models: ['shared-model', 'alpha-model'],
      },
      {
        id: 'key-b',
        label: 'Beta Key',
        group: 'beta',
        models: ['shared-model', 'beta-model'],
      },
    ]);
  });
});
