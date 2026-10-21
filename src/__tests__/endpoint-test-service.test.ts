import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointTestProtocol } from '../shared/types/endpoint-test';

const mocks = vi.hoisted(() => ({
  loadStorage: vi.fn(),
  resolveUpstreamCredentials: vi.fn(),
  endpointTests: {} as Record<string, unknown>,
  saveEndpointTestTargets: vi.fn(),
  exportConfigSync: vi.fn(),
  getRoutingConfig: vi.fn(),
  httpRawRequest: vi.fn(),
}));

vi.mock('../main/custom-cli-config-service', () => ({
  buildCustomCliRouteAccountId: (id: string) => `custom-cli-account:${id}`,
  buildCustomCliRouteApiKeyId: (id: string, keyId?: string) =>
    `custom-cli-key:${id}${keyId ? `:${keyId}` : ''}`,
  buildCustomCliRouteSiteId: (id: string) => `custom-cli-site:${id}`,
  loadCustomCliConfigStorage: mocks.loadStorage,
}));

vi.mock('../main/upstream-credential-resolver', () => ({
  isMaskedApiKeyValue: (value: string) => value.startsWith('masked:'),
  resolveUpstreamCredentials: mocks.resolveUpstreamCredentials,
}));

vi.mock('../main/api-key-identity', () => ({
  resolveApiKeyId: (apiKey: { id?: string | number }) => String(apiKey.id ?? 'unknown'),
}));

// Endpoint probes must remain transport-isolated from the local Route Proxy.
vi.mock('../main/route-channel-resolver', () => {
  throw new Error('endpoint-test-service must not import route-channel-resolver');
});

vi.mock('../main/route-proxy-service', () => {
  throw new Error('endpoint-test-service must not import route-proxy-service');
});

vi.mock('../main/route-target-lock', () => {
  throw new Error('endpoint-test-service must not import route-target-lock');
});

vi.mock('../main/endpoint-test-state-service', () => ({
  endpointTestStateService: {
    ensureLoaded: vi.fn(),
    getTargets: () => mocks.endpointTests,
    saveTargets: mocks.saveEndpointTestTargets,
  },
}));

vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: {
    exportConfigSync: mocks.exportConfigSync,
    getRoutingConfig: mocks.getRoutingConfig,
  },
}));

vi.mock('../main/utils/http-client', () => ({
  httpRawRequest: mocks.httpRawRequest,
}));

import {
  getEndpointTestState,
  runEndpointTest,
  saveEndpointTestSelection,
} from '../main/endpoint-test-service';

const directTarget = { kind: 'direct' as const, configId: 'direct-1' };

describe('managed local key scopes', () => {
  it('includes local keys and their models without exposing raw values', async () => {
    mocks.exportConfigSync.mockReturnValue({
      sites: [{ id: 'site-1', name: 'Managed', url: 'https://example.com' }],
      accounts: [
        {
          id: 'account-1',
          site_id: 'site-1',
          local_api_keys: [
            {
              id: 'local-key',
              name: 'Local',
              key: 'plain-secret',
              models: ['local-model'],
              source: 'local',
            },
            {
              id: 'disabled-key',
              name: 'Disabled',
              key: 'disabled-secret',
              models: ['disabled-model'],
              status: false,
            },
          ],
        },
      ],
    });
    const result = await getEndpointTestState({
      kind: 'managed',
      siteId: 'site-1',
      accountId: 'account-1',
    });
    expect(result.apiKeys).toMatchObject([{ id: 'local-key', models: ['local-model'] }]);
    expect(result.models).toEqual(['local-model']);
    expect(JSON.stringify(result)).not.toContain('plain-secret');
  });
});
const directApiKeyId = 'custom-cli-key:direct-1';

function directConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'direct-1',
    name: 'Direct One',
    baseUrl: 'https://direct.example/v1',
    apiKey: 'direct-secret',
    models: ['model-a', 'model-b'],
    manualModels: ['model-b', 'model-c'],
    ...overrides,
  };
}

function rawJsonResponse(payload: unknown, status = 200) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify(payload)),
  };
}

function rawTextResponse(body: string, status = 200) {
  return { status, headers: {}, body: Buffer.from(body) };
}

describe('endpoint-test-service', () => {
  const routing = {
    endpointTests: {} as Record<string, unknown>,
    server: { upstreamProxyUrl: 'http://proxy.example:8080' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    routing.endpointTests = {};
    mocks.loadStorage.mockResolvedValue({ configs: [directConfig()] });
    mocks.getRoutingConfig.mockReturnValue(routing);
    mocks.resolveUpstreamCredentials.mockResolvedValue({
      baseUrl: 'https://direct.example/v1',
      apiKey: 'direct-secret',
    });
    mocks.httpRawRequest.mockResolvedValue(rawJsonResponse({ output_text: 'OK' }));
    mocks.endpointTests = routing.endpointTests;
    mocks.saveEndpointTestTargets.mockImplementation(async (targets: Record<string, unknown>) => {
      mocks.endpointTests = targets;
      routing.endpointTests = targets;
    });
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
        'x-api-key': 'direct-secret',
        'anthropic-version': '2023-06-01',
      },
      expectedBody: {
        model: 'model-a',
        max_tokens: 1024,
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
        Authorization: 'Bearer direct-secret',
      },
      expectedBody: {
        model: 'model-a',
        input: '1.2和1.19哪个更大？',
        max_output_tokens: 32,
        stream: false,
        store: false,
      },
    },
    {
      protocol: 'openai-chat-completions',
      endpoint: '/v1/chat/completions',
      payload: { choices: [{ message: { content: 'OK chat' } }] },
      expectedHeaders: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer direct-secret',
      },
      expectedBody: {
        model: 'model-a',
        max_tokens: 32,
        stream: false,
        messages: [{ role: 'user', content: '1.2和1.19哪个更大？' }],
      },
    },
  ])(
    'sends a direct $protocol request and persists its tested time',
    async ({ protocol, endpoint, payload, expectedHeaders, expectedBody }) => {
      mocks.httpRawRequest.mockResolvedValueOnce(rawJsonResponse(payload));
      const before = Date.now();

      const result = await runEndpointTest({
        target: directTarget,
        protocol,
        apiKeyId: directApiKeyId,
        model: 'model-a',
      });

      expect(result).toMatchObject({ success: true, endpoint, model: 'model-a' });
      expect(result.testedAt).toBeGreaterThanOrEqual(before);
      expect(mocks.httpRawRequest).toHaveBeenCalledTimes(1);
      const [url, config] = mocks.httpRawRequest.mock.calls[0] as [
        string,
        {
          headers: Record<string, string>;
          body: string;
          proxyUrl: string;
          preferElectronNet: boolean;
        },
      ];
      expect(url).toBe(`https://direct.example/v1${endpoint.slice('/v1'.length)}`);
      expect(config.headers).toEqual(expectedHeaders);
      expect(JSON.parse(config.body)).toEqual(expectedBody);
      expect(config.proxyUrl).toBe('http://proxy.example:8080');
      expect(config.preferElectronNet).toBe(true);
      expect(mocks.saveEndpointTestTargets).toHaveBeenCalledTimes(1);
      expect(
        (
          routing.endpointTests['direct:direct-1'] as {
            protocols: Record<string, { latest: { testedAt: number } }>;
          }
        ).protocols[protocol].latest.testedAt
      ).toBe(result.testedAt);
    }
  );

  it('does not start or call the Route Proxy', async () => {
    await runEndpointTest({
      target: directTarget,
      protocol: 'openai-chat-completions',
      apiKeyId: directApiKeyId,
      model: 'model-a',
    });

    expect(mocks.httpRawRequest).toHaveBeenCalledWith(
      'https://direct.example/v1/chat/completions',
      expect.any(Object)
    );
  });

  it('does not mutate normal route runtime or analytics state', async () => {
    const routeState = {
      health: { 'site-1:key-1:model-a': { consecutiveFailures: 2 } },
      stats: { 'site-1:key-1:model-a': { requests: 7 } },
      analytics: { buckets: { 'site-1/model-a': { requestCount: 3 } } },
    };
    Object.assign(routing, routeState);
    const before = structuredClone(routeState);

    await runEndpointTest({
      target: directTarget,
      protocol: 'openai-chat-completions',
      apiKeyId: directApiKeyId,
      model: 'model-a',
    });

    expect(routing.health).toEqual(before.health);
    expect(routing.stats).toEqual(before.stats);
    expect(routing.analytics).toEqual(before.analytics);
  });

  it.each([
    {
      name: 'HTTP failure',
      response: () => rawTextResponse('upstream rejected', 503),
      expectedError: 'HTTP 503：upstream rejected',
    },
    {
      name: 'invalid JSON',
      response: () => rawTextResponse('not-json'),
      expectedError: '响应不是有效 JSON',
    },
    {
      name: 'missing generated text',
      response: () => rawJsonResponse({ choices: [] }),
      expectedError: '响应中没有生成文本',
    },
  ])('persists testedAt for $name', async ({ response, expectedError }) => {
    mocks.httpRawRequest.mockResolvedValueOnce(response());
    const before = Date.now();

    const result = await runEndpointTest({
      target: directTarget,
      protocol: 'openai-chat-completions',
      apiKeyId: directApiKeyId,
      model: 'model-a',
    });

    expect(result).toMatchObject({ success: false, error: expectedError });
    expect(result.testedAt).toBeGreaterThanOrEqual(before);
    expect(mocks.saveEndpointTestTargets).toHaveBeenCalledTimes(1);
  });

  it('persists testedAt when the raw request times out or throws', async () => {
    mocks.httpRawRequest.mockRejectedValue(new Error('request timed out'));
    const before = Date.now();

    const result = await runEndpointTest({
      target: directTarget,
      protocol: 'openai-responses',
      apiKeyId: directApiKeyId,
      model: 'model-a',
    });

    expect(result).toMatchObject({ success: false, error: '请求超时' });
    expect(result.testedAt).toBeGreaterThanOrEqual(before);
    expect(mocks.saveEndpointTestTargets).toHaveBeenCalledTimes(1);
  });

  it('bounds success summaries to 1000 characters and failure reasons to 200 characters', async () => {
    mocks.httpRawRequest.mockResolvedValueOnce(
      rawJsonResponse({ output_text: `  ${'a'.repeat(1200)}  ` })
    );
    const success = await runEndpointTest({
      target: directTarget,
      protocol: 'openai-responses',
      apiKeyId: directApiKeyId,
      model: 'model-a',
    });
    expect(success.summary).toHaveLength(1000);

    mocks.httpRawRequest.mockResolvedValueOnce(rawTextResponse('b'.repeat(1200), 500));
    const failure = await runEndpointTest({
      target: directTarget,
      protocol: 'openai-responses',
      apiKeyId: directApiKeyId,
      model: 'model-a',
    });
    expect(failure.error).toHaveLength(200);
  });

  it('uses explicit auth overrides and joins provider paths without duplicating /v1', async () => {
    mocks.loadStorage.mockResolvedValue({
      configs: [
        directConfig({
          baseUrl: 'https://openrouter.example/api/v1',
          routeAuthScheme: 'x-api-key',
        }),
      ],
    });
    mocks.resolveUpstreamCredentials.mockResolvedValue({
      baseUrl: 'https://openrouter.example/api/v1',
      apiKey: 'provider-secret',
      authScheme: 'x-api-key',
    });

    await runEndpointTest({
      target: directTarget,
      protocol: 'openai-chat-completions',
      apiKeyId: directApiKeyId,
      model: 'model-a',
    });

    expect(mocks.httpRawRequest).toHaveBeenCalledWith(
      'https://openrouter.example/api/v1/chat/completions',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'provider-secret',
        },
      })
    );
  });

  it('defaults Anthropic tests to x-api-key regardless of the upstream hostname', async () => {
    mocks.loadStorage.mockResolvedValue({ configs: [directConfig({ name: 'SenseNova' })] });
    mocks.resolveUpstreamCredentials.mockResolvedValue({
      baseUrl: 'https://token.sensenova.cn',
      apiKey: 'sensenova-secret',
    });

    await runEndpointTest({
      target: directTarget,
      protocol: 'anthropic-messages',
      apiKeyId: directApiKeyId,
      model: 'model-a',
    });

    expect(mocks.httpRawRequest).toHaveBeenCalledWith(
      'https://token.sensenova.cn/v1/messages',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'sensenova-secret',
          'anthropic-version': '2023-06-01',
        },
      })
    );
  });

  it('saves an edited cURL template and executes it through raw HTTP with selected credentials', async () => {
    const curl = [
      "curl --request POST 'https://direct.example/v1/chat/completions'",
      "  --header 'Authorization: Bearer {{API_KEY}}'",
      "  --header 'Content-Type: application/json'",
      `  --data-raw '{"model":"{{MODEL}}","temperature":0.2,"messages":[{"role":"user","content":"custom"}]}'`,
    ].join(' \\\n');

    const saved = await saveEndpointTestSelection({
      target: directTarget,
      protocol: 'openai-chat-completions',
      apiKeyId: directApiKeyId,
      model: 'model-b',
      curl,
    });

    expect(saved.curl).toContain('temperature');
    expect(saved.curl).toContain('{{BASE_URL}}/chat/completions');
    expect(saved.curl).toContain('{{API_KEY}}');
    expect(saved.curl).toContain('{{MODEL}}');
    expect(saved.curl).not.toContain('direct-secret');
    const restored = await getEndpointTestState(directTarget);
    expect(restored.protocols['openai-chat-completions'].curl).toBe(saved.curl);

    mocks.loadStorage.mockResolvedValue({
      configs: [directConfig({ baseUrl: 'https://direct.example/api/v1' })],
    });
    mocks.resolveUpstreamCredentials.mockResolvedValue({
      baseUrl: 'https://direct.example/api/v1',
      apiKey: 'rotated-secret',
    });

    mocks.httpRawRequest.mockResolvedValueOnce(
      rawJsonResponse({ choices: [{ message: { content: 'custom ok' } }] })
    );
    const result = await runEndpointTest({
      target: directTarget,
      protocol: 'openai-chat-completions',
      apiKeyId: directApiKeyId,
      model: 'model-b',
    });

    expect(result).toMatchObject({ success: true, summary: 'custom ok' });
    expect(mocks.httpRawRequest).toHaveBeenCalledWith(
      'https://direct.example/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer rotated-secret',
          'Content-Type': 'application/json',
        },
      })
    );
    const requestConfig = mocks.httpRawRequest.mock.calls.at(-1)?.[1] as { body: string };
    expect(JSON.parse(requestConfig.body)).toMatchObject({
      model: 'model-b',
      temperature: 0.2,
    });
  });

  it('rejects edited cURL commands that target another origin', async () => {
    await expect(
      saveEndpointTestSelection({
        target: directTarget,
        protocol: 'openai-chat-completions',
        apiKeyId: directApiKeyId,
        model: 'model-a',
        curl: 'curl --request POST \'https://other.example/v1/chat/completions\' --data-raw \'{"model":"{{MODEL}}"}\'',
      })
    ).rejects.toThrow('当前上游地址');
    expect(mocks.httpRawRequest).not.toHaveBeenCalled();
  });

  it('rejects edited cURL commands outside the configured Base URL path', async () => {
    await expect(
      saveEndpointTestSelection({
        target: directTarget,
        protocol: 'openai-chat-completions',
        apiKeyId: directApiKeyId,
        model: 'model-a',
        curl: 'curl --request POST \'https://direct.example/admin\' --data-raw \'{"model":"{{MODEL}}"}\'',
      })
    ).rejects.toThrow('Base URL');
    expect(mocks.httpRawRequest).not.toHaveBeenCalled();
  });

  it('keeps Anthropic max_tokens fixed at 1024 for edited cURL templates', async () => {
    const saved = await saveEndpointTestSelection({
      target: directTarget,
      protocol: 'anthropic-messages',
      apiKeyId: directApiKeyId,
      model: 'model-a',
      curl: 'curl \'{{BASE_URL}}/messages\' --data-raw \'{"model":"{{MODEL}}","max_tokens":7,"messages":[]}\'',
    });
    expect(saved.curl).toContain('"max_tokens": 1024');

    mocks.httpRawRequest.mockResolvedValueOnce(
      rawJsonResponse({ content: [{ type: 'text', text: 'fixed limit' }] })
    );
    await runEndpointTest({
      target: directTarget,
      protocol: 'anthropic-messages',
      apiKeyId: directApiKeyId,
      model: 'model-a',
    });

    const request = mocks.httpRawRequest.mock.calls.at(-1)?.[1] as { body: string };
    expect(JSON.parse(request.body).max_tokens).toBe(1024);
  });

  it('runs an unsaved cURL draft without replacing the saved template', async () => {
    const saved = await saveEndpointTestSelection({
      target: directTarget,
      protocol: 'openai-chat-completions',
      apiKeyId: directApiKeyId,
      model: 'model-a',
      curl: 'curl \'{{BASE_URL}}/chat/completions\' --data-raw \'{"model":"{{MODEL}}","temperature":0.1}\'',
    });
    mocks.httpRawRequest.mockResolvedValueOnce(
      rawJsonResponse({ choices: [{ message: { content: 'draft ok' } }] })
    );

    await runEndpointTest({
      target: directTarget,
      protocol: 'openai-chat-completions',
      apiKeyId: directApiKeyId,
      model: 'model-b',
      curl: 'curl \'{{BASE_URL}}/chat/completions\' --header \'X-Draft: yes\' --data-raw \'{"model":"{{MODEL}}","temperature":0.9}\'',
    });

    const request = mocks.httpRawRequest.mock.calls.at(-1)?.[1] as {
      headers: Record<string, string>;
      body: string;
    };
    expect(request.headers['X-Draft']).toBe('yes');
    expect(JSON.parse(request.body)).toMatchObject({ model: 'model-b', temperature: 0.9 });
    const restored = await getEndpointTestState(directTarget);
    expect(restored.protocols['openai-chat-completions'].curl).toBe(saved.curl);
    expect(restored.protocols['openai-chat-completions'].curl).not.toContain('X-Draft');
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
      baseUrl: 'https://direct.example/v1',
      apiKeys: [{ id: directApiKeyId, label: '默认 API Key' }],
      models: ['model-a', 'model-b', 'model-c'],
    });
    expect(state.apiKeys[0].maskedApiKey).toBe('dire******ret');
    expect(state.apiKeys[0].maskedApiKey).not.toContain('direct-secret');
    expect(state.protocols['openai-responses'].model).toBe('model-c');
    expect(state.protocols['openai-responses'].curl).toContain('{{BASE_URL}}');
    expect(state.protocols['openai-responses'].curl).toContain('{{API_KEY}}');
    expect(state.protocols['openai-responses'].curl).toContain('{{MODEL}}');
    expect(state.protocols['anthropic-messages'].model).toBe('model-a');
  });

  it('lists every explicit API key and resolves the selected key directly', async () => {
    mocks.loadStorage.mockResolvedValue({
      configs: [
        directConfig({
          apiKeys: [
            { id: 'key-a', name: '主力 Key', key: 'direct-secret-a' },
            { id: 'key-b', name: '', key: 'direct-secret-b', models: ['model-b'] },
            { id: 'key-empty', name: '空 Key', key: '   ' },
          ],
        }),
      ],
    });
    mocks.resolveUpstreamCredentials.mockResolvedValue({
      baseUrl: 'https://direct.example/v1',
      apiKey: 'direct-secret-b',
    });

    const state = await getEndpointTestState(directTarget);
    expect(state.apiKeys).toMatchObject([
      { id: 'custom-cli-key:direct-1:key-a', label: 'Direct One / 主力 Key' },
      {
        id: 'custom-cli-key:direct-1:key-b',
        label: 'Direct One Key #2',
        models: ['model-b', 'model-c'],
      },
    ]);
    expect(state.apiKeys).toHaveLength(2);

    await runEndpointTest({
      target: directTarget,
      protocol: 'openai-responses',
      apiKeyId: 'custom-cli-key:direct-1:key-b',
      model: 'model-b',
    });

    expect(mocks.resolveUpstreamCredentials).toHaveBeenCalledWith({
      kind: 'direct',
      configId: 'direct-1',
      apiKeyId: 'key-b',
    });
  });

  it('syncs manual models into every direct key scope and the merged model list', async () => {
    mocks.loadStorage.mockResolvedValue({
      configs: [
        directConfig({
          models: ['model-a', 'model-b'],
          manualModels: ['model-c'],
          apiKeys: [
            { id: 'key-a', name: '主力 Key', key: 'direct-secret-a', models: ['model-a'] },
            { id: 'key-b', name: '', key: 'direct-secret-b', models: [] },
          ],
        }),
      ],
    });

    const state = await getEndpointTestState(directTarget);

    // 手动模型对所有 Key 可用（与路由模型注册表语义一致），无快照的 Key 回退到拉取 + 手动模型
    expect(state.apiKeys).toMatchObject([
      { id: 'custom-cli-key:direct-1:key-a', models: ['model-a', 'model-c'] },
      { id: 'custom-cli-key:direct-1:key-b', models: ['model-a', 'model-b', 'model-c'] },
    ]);
    expect(state.models).toEqual(expect.arrayContaining(['model-a', 'model-b', 'model-c']));
    expect(state.models).toHaveLength(3);
  });

  it('falls back to the first key when a stored selection no longer exists', async () => {
    routing.endpointTests['direct:direct-1'] = {
      targetKey: 'direct:direct-1',
      protocols: {
        'openai-responses': { apiKeyId: 'custom-cli-key:direct-1:removed-key', model: 'model-a' },
      },
      updatedAt: 1,
    };

    const state = await getEndpointTestState(directTarget);
    expect(state.protocols['openai-responses'].apiKeyId).toBe(directApiKeyId);
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
      routing: { server: { requestTimeoutMs: 1000, upstreamProxyUrl: '' } },
    });
    mocks.resolveUpstreamCredentials.mockResolvedValue(null);
    const before = Date.now();

    const result = await runEndpointTest({
      target: { kind: 'managed', siteId: 'site-1', accountId: 'account-1' },
      protocol: 'anthropic-messages',
      apiKeyId: 'key-1',
      model: 'managed-model',
    });

    expect(result).toMatchObject({ success: false, error: '无法解析所选 API Key' });
    expect(result.testedAt).toBeGreaterThanOrEqual(before);
    expect(mocks.httpRawRequest).not.toHaveBeenCalled();
    expect(mocks.saveEndpointTestTargets).toHaveBeenCalledTimes(1);
  });

  it('resolves managed credentials and sends the endpoint request directly upstream', async () => {
    mocks.exportConfigSync.mockReturnValue({
      sites: [
        { id: 'site-1', name: 'Managed', url: 'https://managed.example/api/v1', enabled: true },
      ],
      accounts: [
        {
          id: 'account-1',
          site_id: 'site-1',
          routeAuthScheme: 'x-api-key',
          cached_data: {
            api_keys: [{ id: 'key-1', name: 'Managed Key', status: 'active' }],
            models: ['managed-model'],
          },
        },
      ],
      routing: { server: { requestTimeoutMs: 1234, upstreamProxyUrl: '' } },
    });
    mocks.resolveUpstreamCredentials.mockResolvedValue({
      baseUrl: 'https://managed.example/api/v1',
      apiKey: 'managed-secret',
      authScheme: 'x-api-key',
    });
    mocks.httpRawRequest.mockResolvedValueOnce(
      rawJsonResponse({ content: [{ type: 'text', text: 'managed ok' }] })
    );

    const result = await runEndpointTest({
      target: { kind: 'managed', siteId: 'site-1', accountId: 'account-1' },
      protocol: 'anthropic-messages',
      apiKeyId: 'key-1',
      model: 'managed-model',
    });

    expect(result).toMatchObject({ success: true, summary: 'managed ok' });
    expect(mocks.resolveUpstreamCredentials).toHaveBeenCalledWith({
      kind: 'managed',
      siteId: 'site-1',
      accountId: 'account-1',
      apiKeyId: 'key-1',
    });
    expect(mocks.httpRawRequest).toHaveBeenCalledWith(
      'https://managed.example/api/v1/messages',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'managed-secret',
          'anthropic-version': '2023-06-01',
        },
        timeout: 1234,
        proxyUrl: 'http://proxy.example:8080',
        preferElectronNet: true,
      })
    );
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
      routing: { server: { requestTimeoutMs: 1000, upstreamProxyUrl: '' } },
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

  it('uses the same half-masked display for managed API keys', async () => {
    mocks.exportConfigSync.mockReturnValue({
      sites: [{ id: 'site-1', name: 'Managed', url: 'https://managed.example', enabled: true }],
      accounts: [
        {
          id: 'account-1',
          site_id: 'site-1',
          cached_data: {
            api_keys: [{ id: 'managed-key', key: 'managed-secret', status: 'active' }],
            models: ['managed-model'],
          },
        },
      ],
      routing: { server: { requestTimeoutMs: 1000, upstreamProxyUrl: '' } },
    });

    const state = await getEndpointTestState({
      kind: 'managed',
      siteId: 'site-1',
      accountId: 'account-1',
    });

    expect(state.apiKeys[0].maskedApiKey).toBe('mana*******ret');
    expect(state.apiKeys[0].maskedApiKey).not.toContain('managed-secret');
  });

  it('does not expose short API keys in the endpoint-test state', async () => {
    mocks.loadStorage.mockResolvedValue({ configs: [directConfig({ apiKey: 'abcd' })] });
    mocks.resolveUpstreamCredentials.mockResolvedValue({
      baseUrl: 'https://direct.example/v1',
      apiKey: 'abcd',
    });

    const state = await getEndpointTestState(directTarget);

    expect(state.apiKeys[0].maskedApiKey).toBe('****');
    expect(state.apiKeys[0].maskedApiKey).not.toContain('abcd');
  });
});
