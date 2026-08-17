import { describe, expect, it } from 'vitest';
import {
  ROUTE_AGENT_ID_HEADER,
  ROUTE_AGENT_NAME_HEADER,
  ROUTE_RUNTIME_SLOT_ID_HEADER,
  ROUTE_RUNTIME_SLOT_LABEL_HEADER,
  ROUTE_SESSION_ID_HEADER,
  type RouteSessionRoutingConfig,
} from '../shared/types/route-proxy';
import {
  cancelArmedRouteInstance,
  closeRouteInstance,
  createArmedRouteInstance,
  clearRouteSessionCandidates,
  discoverRouteSessionCandidates,
  extractObservedRouteInstanceKey,
  listRouteSessionCandidates,
  listRouteInstances,
  normalizeRouteInstanceCollections,
  ROUTE_SESSION_CANDIDATE_MAX_COUNT,
  ROUTE_SESSION_CANDIDATE_MAX_VALUE_HASHES,
  ROUTE_SESSION_CANDIDATE_TTL_MS,
  resolveRouteInstanceForRequest,
  updateRouteInstance,
} from '../main/route-session-service';

const baseConfig = (): RouteSessionRoutingConfig => ({
  instances: {},
  currentRouteBySlot: {},
  extractionRules: [],
  overrides: {},
  activeWindowMinutes: 30,
  recentWindowHours: 24,
  historyRetentionDays: 30,
  overrideRetentionDays: 90,
});

const observed = (sessionId: string, runtimeSlotId = 'slot-1') => ({
  agentId: 'agent-1',
  runtimeSlotId,
  sessionId,
  observedAgentName: 'Codex',
  observedRuntimeSlotLabel: 'Terminal A',
});

function resolve(
  config: RouteSessionRoutingConfig,
  sessionId: string,
  requestAt: number,
  requestedModel = 'request-model',
  runtimeSlotId = 'slot-1',
  profileId = 'profile-1'
) {
  return resolveRouteInstanceForRequest({
    config,
    profileId,
    observedKey: observed(sessionId, runtimeSlotId),
    requestedModel,
    requestedReasoningEffort: 'high',
    defaultModel: 'default-model',
    defaultReasoningEffort: 'medium',
    requestAt,
  });
}

describe('route instance identity boundary', () => {
  it('bounds and expires high-cardinality session candidate observations', () => {
    clearRouteSessionCandidates();
    const headers = Object.fromEntries(
      Array.from({ length: ROUTE_SESSION_CANDIDATE_MAX_COUNT + 40 }, (_, index) => [
        `x-session-${index}`,
        `value-${index}`,
      ])
    );
    discoverRouteSessionCandidates({ headers, url: '/' }, null, 'openai-responses', 1_000);

    expect(listRouteSessionCandidates(1_000)).toHaveLength(ROUTE_SESSION_CANDIDATE_MAX_COUNT);

    for (let index = 0; index < ROUTE_SESSION_CANDIDATE_MAX_VALUE_HASHES + 20; index += 1) {
      discoverRouteSessionCandidates(
        { headers: { 'x-session-shared': `value-${index}` }, url: '/' },
        null,
        'openai-responses',
        2_000 + index
      );
    }
    const shared = listRouteSessionCandidates(3_000).find(
      candidate => candidate.path === 'x-session-shared'
    );
    expect(shared?.distinctValueCount).toBe(ROUTE_SESSION_CANDIDATE_MAX_VALUE_HASHES);
    expect(
      listRouteSessionCandidates(3_000 + ROUTE_SESSION_CANDIDATE_TTL_MS + 1)
    ).toEqual([]);
    clearRouteSessionCandidates();
  });

  it('prefers a complete explicit route key and does not mix an incomplete one with native evidence', () => {
    const headers = {
      [ROUTE_AGENT_ID_HEADER]: ' agent-1 ',
      [ROUTE_RUNTIME_SLOT_ID_HEADER]: 'slot-1',
      [ROUTE_SESSION_ID_HEADER]: 'session-1',
      [ROUTE_AGENT_NAME_HEADER]: 'Codex',
      [ROUTE_RUNTIME_SLOT_LABEL_HEADER]: 'Terminal A',
    };
    const nativeBody = {
      client_metadata: { session_id: 'native-session', window_id: 'native-window' },
    };
    expect(extractObservedRouteInstanceKey({ headers }, nativeBody)).toEqual(observed('session-1'));
    expect(
      extractObservedRouteInstanceKey(
        {
          headers: { ...headers, [ROUTE_RUNTIME_SLOT_ID_HEADER]: undefined },
        },
        nativeBody
      )
    ).toBeNull();
  });

  it('resolves Codex identity from native header and body metadata combinations', () => {
    expect(
      extractObservedRouteInstanceKey(
        { headers: { 'x-codex-window-id': 'window-1' } },
        { client_metadata: { session_id: 'session-1' } }
      )
    ).toEqual({
      agentId: 'codex',
      runtimeSlotId: 'session-1',
      sessionId: 'session-1',
      observedAgentName: 'Codex',
      observedRuntimeSlotLabel: 'Codex 会话',
    });
    expect(
      extractObservedRouteInstanceKey(
        { headers: {} },
        { client_metadata: { window_id: 'window-2', session_id: 'session-2' } }
      )
    ).toEqual({
      agentId: 'codex',
      runtimeSlotId: 'session-2',
      sessionId: 'session-2',
      observedAgentName: 'Codex',
      observedRuntimeSlotLabel: 'Codex 会话',
    });
    expect(
      extractObservedRouteInstanceKey(
        { headers: { 'x-codex-window-id': 'window-3', 'x-codex-thread-id': 'thread-3' } },
        null
      )
    ).toEqual({
      agentId: 'codex',
      runtimeSlotId: 'thread-3',
      sessionId: 'thread-3',
      observedAgentName: 'Codex',
      observedRuntimeSlotLabel: 'Codex 会话',
    });
  });

  it('binds an ARMED route from the Claude Code session header despite a different request model', () => {
    const observedKey = extractObservedRouteInstanceKey({
      headers: { 'x-claude-code-session-id': 'claude-session-1' },
    });
    expect(observedKey).toEqual({
      agentId: 'claudeCode',
      runtimeSlotId: 'claude-session-1',
      sessionId: 'claude-session-1',
      observedAgentName: 'Claude Code',
      observedRuntimeSlotLabel: 'Claude Code 会话',
    });

    const config = baseConfig();
    const armed = createArmedRouteInstance(config, 'precreated-model', 'max');
    const resolution = resolveRouteInstanceForRequest({
      config,
      profileId: 'profile-1',
      observedKey,
      requestedModel: 'actual-request-model',
      requestedReasoningEffort: 'low',
      defaultModel: 'default-model',
      defaultReasoningEffort: 'medium',
      requestAt: 1_000,
    });

    expect(resolution.instance).toMatchObject({
      id: armed.id,
      modelId: 'precreated-model',
      reasoningEffort: 'max',
      routingState: 'active',
      routeKey: {
        agentId: 'claudeCode',
        runtimeSlotId: 'claude-session-1',
        sessionId: 'claude-session-1',
      },
    });
  });

  it('binds an ARMED route from a generic stable session header without model matching', () => {
    const observedKey = extractObservedRouteInstanceKey({
      headers: { 'x-session-id': 'opencode-session-1', 'user-agent': 'OpenCode/1.2.3' },
    });
    expect(observedKey).toEqual({
      agentId: 'session:http',
      runtimeSlotId: 'opencode-session-1',
      sessionId: 'opencode-session-1',
      observedAgentName: 'OpenCode',
      observedRuntimeSlotLabel: '会话级路由',
    });

    const config = baseConfig();
    const armed = createArmedRouteInstance(config, 'precreated-model', 'vendor-ultra');
    const resolution = resolveRouteInstanceForRequest({
      config,
      profileId: 'profile-1',
      observedKey,
      requestedModel: 'actual-request-model',
      requestedReasoningEffort: 'low',
      defaultModel: 'default-model',
      defaultReasoningEffort: 'medium',
      requestAt: 2_000,
    });

    expect(resolution.instance).toMatchObject({
      id: armed.id,
      modelId: 'precreated-model',
      reasoningEffort: 'vendor-ultra',
      routeKey: {
        agentId: 'session:http',
        runtimeSlotId: 'opencode-session-1',
        sessionId: 'opencode-session-1',
      },
    });
  });

  it('uses Codex window metadata as source evidence instead of persistent route identity', () => {
    const first = extractObservedRouteInstanceKey(
      { headers: { 'x-codex-window-id': 'session-1:5' } },
      { client_metadata: { session_id: 'session-1' } }
    );
    const afterCompaction = extractObservedRouteInstanceKey(
      { headers: { 'x-codex-window-id': 'session-1:6' } },
      { client_metadata: { session_id: 'session-1' } }
    );

    expect(first).toMatchObject({ runtimeSlotId: 'session-1', sessionId: 'session-1' });
    expect(afterCompaction).toMatchObject({
      runtimeSlotId: 'session-1',
      sessionId: 'session-1',
    });
  });

  it('rejects incomplete or ambiguous native identity without synthetic fallbacks', () => {
    expect(
      extractObservedRouteInstanceKey(
        { headers: {} },
        { client_metadata: { session_id: 'session-only' } }
      )
    ).toBeNull();
    expect(
      extractObservedRouteInstanceKey(
        { headers: {} },
        { client_metadata: { window_id: 'window-only' } }
      )
    ).toBeNull();
    expect(
      extractObservedRouteInstanceKey(
        { headers: { 'x-codex-window-id': 'window-header' } },
        { client_metadata: { window_id: 'window-body', session_id: 'session-1' } }
      )
    ).toBeNull();
  });

  it('rejects unsafe native identity values', () => {
    expect(
      extractObservedRouteInstanceKey(
        { headers: { 'x-codex-window-id': 'window-\u0001' } },
        { client_metadata: { session_id: 'session-1' } }
      )
    ).toBeNull();
    expect(
      extractObservedRouteInstanceKey(
        { headers: {} },
        { client_metadata: { window_id: 'w'.repeat(513), session_id: 'session-1' } }
      )
    ).toBeNull();
  });

  it('does not consume ARMED when the route key is incomplete', () => {
    const config = baseConfig();
    const armed = createArmedRouteInstance(config, 'chosen-model', 'xhigh');
    expect(
      resolveRouteInstanceForRequest({
        config,
        profileId: 'profile-1',
        observedKey: null,
        requestedModel: 'request-model',
        requestedReasoningEffort: 'low',
        defaultModel: 'default-model',
        defaultReasoningEffort: 'medium',
        requestAt: 1_000,
      })
    ).toEqual({ instance: null, changed: false });
    expect(config.instances[armed.id].routingState).toBe('armed');
  });
});

describe('route instance lifecycle', () => {
  it('allows one ARMED route, does not timestamp it, and binds it on the first new key', () => {
    const config = baseConfig();
    const armed = createArmedRouteInstance(config, 'chosen-model', 'xhigh');
    expect(armed).not.toHaveProperty('createdAt');
    expect(() => createArmedRouteInstance(config, 'other', 'low')).toThrow('已有一个路由');

    const result = resolve(config, 'session-1', 1_234);
    expect(result.instance).toMatchObject({
      id: armed.id,
      modelId: 'chosen-model',
      reasoningEffort: 'xhigh',
      routingState: 'active',
      createdAt: 1_234,
      lastRequestAt: 1_234,
      routeKey: { agentId: 'agent-1', runtimeSlotId: 'slot-1', sessionId: 'session-1' },
    });
  });

  it('claims ARMED once when two unseen keys arrive and auto-creates the other', () => {
    const config = baseConfig();
    const armed = createArmedRouteInstance(config, 'chosen-model', 'max');
    const first = resolve(config, 'session-a', 1_000, 'request-a', 'slot-a').instance;
    const second = resolve(config, 'session-b', 1_001, 'request-b', 'slot-b').instance;
    expect(first?.id).toBe(armed.id);
    expect(second?.id).not.toBe(armed.id);
    expect(second).toMatchObject({ modelId: 'request-b', reasoningEffort: 'high' });
  });

  it('keeps stored configuration and createdAt across repeated requests', () => {
    const config = baseConfig();
    const first = resolve(config, 'session-1', 1_000).instance!;
    const repeated = resolve(config, 'session-1', 2_000, 'different-model');
    expect(config.instances[first.id]).toMatchObject({
      modelId: 'request-model',
      reasoningEffort: 'high',
      createdAt: 1_000,
      lastRequestAt: 2_000,
    });
    expect(repeated.changed).toBe(false);
  });

  it('merges legacy Codex context-window routes for the same session', () => {
    const config = baseConfig();
    config.instances = {
      first: {
        id: 'first',
        routeKey: {
          agentId: 'codex',
          runtimeSlotId: 'session-1:5',
          sessionId: 'session-1',
        },
        display: { observedAgentName: 'Codex' },
        modelId: 'first-model',
        reasoningEffort: 'high',
        routingState: 'closed',
        presenceState: 'unknown',
        createdAt: 1_000,
        lastRequestAt: 1_500,
        closedAt: 1_600,
        closedReason: 'replaced',
      },
      second: {
        id: 'second',
        routeKey: {
          agentId: 'codex',
          runtimeSlotId: 'session-1:6',
          sessionId: 'session-1',
        },
        display: { observedAgentName: 'Codex' },
        modelId: 'second-model',
        reasoningEffort: 'low',
        routingState: 'closed',
        presenceState: 'confirmed_closed',
        createdAt: 2_000,
        lastRequestAt: 2_500,
        closedAt: 2_600,
        closedReason: 'replaced',
      },
      third: {
        id: 'third',
        routeKey: {
          agentId: 'codex',
          runtimeSlotId: 'session-1:7',
          sessionId: 'session-1',
        },
        display: { observedAgentName: 'Codex' },
        modelId: 'third-model',
        reasoningEffort: 'max',
        routingState: 'active',
        presenceState: 'confirmed_open',
        createdAt: 3_000,
        lastRequestAt: 3_500,
      },
    };
    config.currentRouteBySlot = { legacy: 'third' };

    expect(normalizeRouteInstanceCollections(config)).toBe(true);
    expect(normalizeRouteInstanceCollections(config)).toBe(false);
    expect(listRouteInstances(config)).toEqual([
      expect.objectContaining({
        id: 'first',
        routeKey: {
          agentId: 'codex',
          runtimeSlotId: 'session-1',
          sessionId: 'session-1',
        },
        modelId: 'first-model',
        reasoningEffort: 'high',
        routingState: 'active',
        presenceState: 'confirmed_open',
        createdAt: 1_000,
        lastRequestAt: 3_500,
      }),
    ]);
    expect(config.currentRouteBySlot).toEqual({ '["","codex","session-1"]': 'first' });
  });

  it('keeps closed generations immutable when an earlier session is observed again', () => {
    const config = baseConfig();
    const first = resolve(config, 'session-1', 1_000).instance!;
    const second = resolve(config, 'session-2', 2_000).instance!;
    expect(config.instances[first.id]).toMatchObject({
      routingState: 'closed',
      closedReason: 'replaced',
      closedAt: 2_000,
    });
    expect(second.routingState).toBe('active');

    const reopened = resolve(config, 'session-1', 3_000, 'ignored-model').instance!;
    expect(reopened.id).not.toBe(first.id);
    expect(reopened).toMatchObject({
      routingState: 'active',
      modelId: 'ignored-model',
      createdAt: 3_000,
      lastRequestAt: 3_000,
    });
    expect(config.instances[first.id]).toMatchObject({
      routingState: 'closed',
      closedReason: 'replaced',
      closedAt: 2_000,
    });
    expect(config.instances[second.id].routingState).toBe('closed');
  });

  it('isolates identical route keys by Profile', () => {
    const config = baseConfig();
    const first = resolve(config, 'shared-session', 1_000, 'model-a', 'slot-1', 'profile-a').instance!;
    const second = resolve(config, 'shared-session', 2_000, 'model-b', 'slot-1', 'profile-b').instance!;

    expect(second.id).not.toBe(first.id);
    expect(first).toMatchObject({ profileId: 'profile-a', modelId: 'model-a' });
    expect(second).toMatchObject({ profileId: 'profile-b', modelId: 'model-b' });
  });

  it('creates one successor generation after explicit close without reviving the closed card', () => {
    const config = baseConfig();
    const closed = resolve(config, 'session-1', 1_000).instance!;
    closeRouteInstance(config, closed.id, 2_000);

    const successor = resolve(config, 'session-1', 3_000, 'successor-model').instance!;
    const concurrent = resolve(config, 'session-1', 3_000, 'ignored-concurrent-model').instance!;

    expect(successor.id).not.toBe(closed.id);
    expect(concurrent.id).toBe(successor.id);
    expect(config.instances[closed.id]).toMatchObject({
      routingState: 'closed',
      closedReason: 'explicit',
      closedAt: 2_000,
    });
  });

  it('updates only editable configuration and display aliases', () => {
    const config = baseConfig();
    const instance = resolve(config, 'session-1', 1_000).instance!;
    const routeKey = { ...instance.routeKey };
    updateRouteInstance(config, instance.id, {
      modelId: 'new-model',
      reasoningEffort: 'vendor-ultra',
      customAgentName: 'My Agent',
      customRuntimeSlotLabel: 'Work',
    });
    expect(instance.routeKey).toEqual(routeKey);
    expect(instance).toMatchObject({
      modelId: 'new-model',
      reasoningEffort: 'vendor-ultra',
      display: { customAgentName: 'My Agent', customRuntimeSlotLabel: 'Work' },
    });
  });

  it('cancels an ARMED route without adding timestamps', () => {
    const config = baseConfig();
    const armed = createArmedRouteInstance(config, 'model', 'low');
    cancelArmedRouteInstance(config, armed.id);
    expect(listRouteInstances(config)[0]).toMatchObject({ routingState: 'cancelled' });
    expect(config.instances[armed.id]).not.toHaveProperty('createdAt');
  });
});
