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
  hasObservedRouteInstanceEvidence,
  listRouteSessionCandidates,
  listRouteInstances,
  normalizeRouteInstanceCollections,
  ROUTE_SESSION_CANDIDATE_MAX_COUNT,
  ROUTE_SESSION_CANDIDATE_MAX_VALUE_HASHES,
  ROUTE_SESSION_CANDIDATE_TTL_MS,
  restoreRouteInstance,
  resolveRouteInstanceForRequest,
  type ObservedRouteInstanceKey,
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

function resolveObserved(
  config: RouteSessionRoutingConfig,
  observedKey: ObservedRouteInstanceKey | null,
  requestAt: number,
  requestedModel: string | null,
  profileId = 'profile-1'
) {
  return resolveRouteInstanceForRequest({
    config,
    profileId,
    observedKey,
    requestedModel,
    requestedReasoningEffort: 'high',
    defaultModel: 'default-model',
    defaultReasoningEffort: 'medium',
    requestAt,
  });
}

function codexTurnRequest(
  threadId: string,
  metadata: Record<string, unknown> = {},
  projection: 'body' | 'header' = 'body'
) {
  const headers: Record<string, string> = {
    'x-codex-window-id': `${threadId}:0`,
    'session-id': threadId,
  };
  const turnMetadata = JSON.stringify({
    thread_id: threadId,
    request_kind: 'turn',
    thread_source: 'system',
    ...metadata,
  });
  const clientMetadata: Record<string, unknown> = {};
  if (projection === 'header') headers['x-codex-turn-metadata'] = turnMetadata;
  else clientMetadata['x-codex-turn-metadata'] = turnMetadata;
  return { headers, body: { client_metadata: clientMetadata } };
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
    expect(listRouteSessionCandidates(3_000 + ROUTE_SESSION_CANDIDATE_TTL_MS + 1)).toEqual([]);
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
      lineage: { source: 'codex', rootSessionId: 'session-1' },
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
      lineage: { source: 'codex', rootSessionId: 'session-2' },
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

  it('parses Codex 0.151 compatibility headers and bounded turn metadata', () => {
    expect(
      extractObservedRouteInstanceKey(
        {
          headers: {
            'x-codex-window-id': 'window-1',
            'session-id': 'root-session',
            'thread-id': 'child-thread',
            'x-codex-parent-thread-id': 'root-thread',
            'x-openai-subagent': 'worker',
            'x-codex-turn-metadata': JSON.stringify({
              session_id: 'root-session',
              thread_id: 'child-thread',
              parent_thread_id: 'root-thread',
            }),
          },
        },
        null
      )
    ).toEqual({
      agentId: 'codex',
      runtimeSlotId: 'root-session',
      sessionId: 'root-session',
      lineage: {
        source: 'codex',
        rootSessionId: 'root-session',
        parentSessionId: 'root-thread',
        threadId: 'child-thread',
      },
      observedAgentName: 'Codex',
      observedRuntimeSlotLabel: 'Codex 会话',
    });
  });

  it('recognizes Codex compatibility headers without requiring x-codex aliases', () => {
    expect(
      extractObservedRouteInstanceKey({
        headers: {
          'x-codex-window-id': 'window-compat',
          'session-id': 'root-session',
          'thread-id': 'root-thread',
        },
      })
    ).toMatchObject({
      agentId: 'codex',
      runtimeSlotId: 'root-session',
      sessionId: 'root-session',
      lineage: { source: 'codex', rootSessionId: 'root-session' },
    });
  });

  it.each(['body', 'header'] as const)(
    'recognizes native Codex system turns from the %s metadata projection',
    projection => {
      const request = codexTurnRequest('helper-thread', {}, projection);
      expect(extractObservedRouteInstanceKey(request, request.body)).toMatchObject({
        agentId: 'codex',
        runtimeSlotId: 'helper-thread',
        sessionId: 'helper-thread',
        lineage: {
          source: 'codex',
          requestKind: 'turn',
          threadSource: 'system',
          isUtility: true,
        },
      });
    }
  );

  it('reconciles body and header metadata while keeping fork lineage observational', () => {
    const request = codexTurnRequest('helper-thread', { forked_from_thread_id: 'fork-source' });
    Object.assign(request.body.client_metadata, {
      request_kind: 'turn',
      thread_source: 'system',
      forked_from_thread_id: 'fork-source',
    });
    request.headers['x-codex-turn-metadata'] = String(
      request.body.client_metadata['x-codex-turn-metadata']
    );
    const key = extractObservedRouteInstanceKey(request, request.body);
    expect(key?.lineage).toMatchObject({
      requestKind: 'turn',
      threadSource: 'system',
      forkedFromThreadId: 'fork-source',
      isUtility: true,
    });
    expect(key?.lineage?.parentSessionId).toBeUndefined();
  });

  it.each(['empty', 'armed', 'one root', 'two roots', 'another profile'])(
    'leaves %s unchanged across repeated title and recap system threads',
    scenario => {
      const config = baseConfig();
      const rootCount = scenario === 'two roots' ? 2 : scenario.includes('root') ? 1 : 0;
      for (let index = 0; index < rootCount; index += 1) {
        const request = codexTurnRequest(`root-${index}`, { thread_source: 'user' });
        const root = resolveObserved(
          config,
          extractObservedRouteInstanceKey(request, request.body),
          1_000,
          'gpt-5.6-sol'
        ).instance!;
        root.modelId = 'user-selected-model';
        root.reasoningEffort = 'low';
        root.display.customAgentName = 'User label';
      }
      if (scenario === 'armed') createArmedRouteInstance(config, 'chosen-model', 'max');
      if (scenario === 'another profile') {
        const request = codexTurnRequest('other-root', { thread_source: 'user' });
        resolveObserved(
          config,
          extractObservedRouteInstanceKey(request, request.body),
          1_000,
          'gpt-5.6-sol',
          'profile-2'
        );
      }
      const before = JSON.parse(JSON.stringify(config));
      for (const [index, threadId] of ['title-1', 'recap-1', 'recap-2', 'recap-3'].entries()) {
        const request = codexTurnRequest(threadId, {}, index % 2 ? 'header' : 'body');
        const key = extractObservedRouteInstanceKey(request, request.body);
        for (const model of ['gpt-5.6-sol', 'gpt-5.6-terra', null]) {
          expect(resolveObserved(config, key, 1_100 + index * 30_000, model)).toEqual({
            instance: null,
            changed: false,
            resolutionPath: 'utility',
            memberAppended: false,
            utilityRequest: true,
          });
          expect(config).toEqual(before);
        }
      }
    }
  );

  it.each(['active', 'closed'])(
    'does not reuse, revive, or normalize an exact %s legacy helper card',
    state => {
      const config = baseConfig();
      const oldRequest = codexTurnRequest('old-helper', { thread_source: 'user' });
      const oldCard = resolveObserved(
        config,
        extractObservedRouteInstanceKey(oldRequest, oldRequest.body),
        1_000,
        'old-model'
      ).instance!;
      if (state === 'closed') closeRouteInstance(config, oldCard.id, 1_100);
      oldCard.routeKey!.runtimeSlotId = 'old-helper:5';
      const before = JSON.parse(JSON.stringify(config));
      const request = codexTurnRequest('old-helper');
      const result = resolveObserved(
        config,
        extractObservedRouteInstanceKey(request, request.body),
        2_000,
        'helper-model'
      );
      expect(result).toMatchObject({
        instance: null,
        changed: false,
        resolutionPath: 'utility',
        memberAppended: false,
        utilityRequest: true,
      });
      expect(result.createdReason).toBeUndefined();
      expect(config).toEqual(before);
    }
  );

  it('does not append system threads to an otherwise matching root alias', () => {
    const config = baseConfig();
    const rootRequest = codexTurnRequest('root-thread', { thread_source: 'user' });
    resolveObserved(
      config,
      extractObservedRouteInstanceKey(rootRequest, rootRequest.body),
      1_000,
      'gpt-5.6-sol'
    );
    const request = codexTurnRequest('helper-thread', { forked_from_thread_id: 'unverified-fork' });
    request.headers['session-id'] = 'root-thread';
    const before = JSON.parse(JSON.stringify(config));
    const result = resolveObserved(
      config,
      extractObservedRouteInstanceKey(request, request.body),
      2_000,
      'gpt-5.6-sol'
    );
    expect(result).toMatchObject({
      instance: null,
      changed: false,
      resolutionPath: 'utility',
      memberAppended: false,
    });
    expect(config).toEqual(before);
  });

  it.each(['turn', 'prewarm', 'compaction', 'memory', 'title', 'catch-up', 'recap'])(
    'does not classify %s requests without the exact system source as utility',
    requestKind => {
      const config = baseConfig();
      for (const threadSource of [undefined, 'user', 'unknown', 'internal', 'SYSTEM']) {
        const request = codexTurnRequest(`thread-${String(threadSource)}`, {
          request_kind: requestKind,
          thread_source: threadSource,
        });
        const key = extractObservedRouteInstanceKey(request, request.body);
        expect(key).not.toBeNull();
        expect(key?.lineage?.isUtility).toBeUndefined();
        const resolution = resolveObserved(config, key, 1_000, 'gpt-5.6-sol');
        expect(resolution).toMatchObject({
          changed: true,
          resolutionPath: 'created',
          createdReason: 'unseen_identity',
          memberAppended: false,
        });
        expect(resolution.instance?.parentInstanceId).toBeUndefined();
      }
      expect(Object.values(config.instances)).toHaveLength(5);
    }
  );

  it.each([null, 'gpt-5.6-sol', 'gpt-5.6-terra'])(
    'reuses the matching Codex session card for fork requests with model %s',
    requestedModel => {
      const config = baseConfig();
      const rootRequest = codexTurnRequest('root-thread', { thread_source: 'user' });
      const root = resolveObserved(
        config,
        extractObservedRouteInstanceKey(rootRequest, rootRequest.body),
        1_000,
        'gpt-5.6-sol'
      ).instance!;
      for (const forkId of ['root-thread']) {
        const request = codexTurnRequest(`fork-${forkId}`, {
          thread_source: 'user',
          forked_from_thread_id: forkId,
        });
        request.headers['session-id'] = 'root-thread';
        const key = extractObservedRouteInstanceKey(request, request.body);
        expect(key?.lineage?.forkedFromThreadId).toBe(forkId);
        expect(key?.lineage?.parentSessionId).toBeUndefined();
        const result = resolveObserved(config, key, 2_000, requestedModel);
        expect(result).toMatchObject({
          changed: true,
          resolutionPath: 'parent',
          memberAppended: true,
        });
        expect(result.instance?.id).toBe(root.id);
        expect(result.instance?.clientModelId).toBe('gpt-5.6-sol');
      }
      const unknownFork = codexTurnRequest('unknown-fork', {
        thread_source: 'user',
        forked_from_thread_id: 'unknown-thread',
      });
      const unknownResult = resolveObserved(
        config,
        extractObservedRouteInstanceKey(unknownFork, unknownFork.body),
        3_000,
        requestedModel
      );
      expect(unknownResult).toMatchObject({
        instance: null,
        resolutionPath: 'parent-unresolved',
        memberAppended: false,
      });
      expect(root.clientModelId).toBe('gpt-5.6-sol');
      expect(Object.values(config.instances)).toHaveLength(1);
    }
  );

  it.each(['request_kind', 'thread_source', 'forked_from_thread_id', 'subagent_kind'])(
    'rejects malformed or conflicting %s metadata across projections',
    field => {
      for (const value of [null, 42, '', 'x'.repeat(513), 'bad\u0001value', ['system'], {}]) {
        const request = codexTurnRequest('helper-thread', { [field]: value });
        expect(hasObservedRouteInstanceEvidence(request, request.body)).toBe(true);
        expect(extractObservedRouteInstanceKey(request, request.body)).toBeNull();
      }
      const request = codexTurnRequest('helper-thread', { [field]: 'system' });
      request.headers['x-codex-turn-metadata'] = JSON.stringify({ [field]: 'different' });
      expect(extractObservedRouteInstanceKey(request, request.body)).toBeNull();
      delete request.headers['x-codex-turn-metadata'];
      request.body.client_metadata[field] = 'different';
      expect(extractObservedRouteInstanceKey(request, request.body)).toBeNull();
    }
  );

  it.each(['body', 'header'] as const)('rejects invalid %s turn metadata envelopes', projection => {
    for (const value of ['{bad-json', '{}'.padEnd(8_193), '[]', 'null']) {
      const request = codexTurnRequest('helper-thread', {}, projection);
      if (projection === 'header') request.headers['x-codex-turn-metadata'] = value;
      else request.body.client_metadata['x-codex-turn-metadata'] = value;
      expect(extractObservedRouteInstanceKey(request, request.body)).toBeNull();
    }
  });

  it('preserves explicit identity priority over system metadata', () => {
    const request = codexTurnRequest('helper-thread');
    Object.assign(request.headers, {
      [ROUTE_AGENT_ID_HEADER]: 'explicit-agent',
      [ROUTE_RUNTIME_SLOT_ID_HEADER]: 'explicit-slot',
      [ROUTE_SESSION_ID_HEADER]: 'explicit-session',
    });
    const key = extractObservedRouteInstanceKey(request, request.body);
    expect(key).toMatchObject({ agentId: 'explicit-agent', sessionId: 'explicit-session' });
    expect(key?.lineage).toBeUndefined();
    expect(resolveObserved(baseConfig(), key, 1_000, 'explicit-model').resolutionPath).toBe(
      'created'
    );
    delete request.headers[ROUTE_SESSION_ID_HEADER];
    expect(extractObservedRouteInstanceKey(request, request.body)).toBeNull();
  });

  it('does not select the Codex adapter from generic metadata property names', () => {
    const request = {
      headers: { 'x-session-id': 'generic-session', 'user-agent': 'GenericClient/1.0' },
    };
    const body = {
      client_metadata: {
        request_kind: 'turn',
        thread_source: 'system',
        forked_from_thread_id: 'generic-fork',
      },
    };
    const key = extractObservedRouteInstanceKey(request, body);
    expect(key).toMatchObject({ agentId: 'session:http', sessionId: 'generic-session' });
    expect(key?.lineage).toBeUndefined();
  });

  it.each(['gpt-5.6-sol', 'gpt-5.6-terra'])(
    'preserves verified subagent routing with system metadata and model %s',
    requestedModel => {
      const config = baseConfig();
      const rootRequest = codexTurnRequest('root-thread', { thread_source: 'user' });
      const parent = resolveObserved(
        config,
        extractObservedRouteInstanceKey(rootRequest, rootRequest.body),
        1_000,
        'gpt-5.6-sol'
      ).instance!;
      const request = codexTurnRequest('child-thread', {
        parent_thread_id: 'root-thread',
        subagent_kind: 'thread_spawn',
      });
      request.headers['session-id'] = 'root-thread';
      request.headers['x-openai-subagent'] = 'worker';
      const key = extractObservedRouteInstanceKey(request, request.body);
      expect(key?.lineage?.isUtility).toBeUndefined();
      const result = resolveObserved(config, key, 2_000, requestedModel);
      expect(result).toMatchObject({
        changed: true,
        resolutionPath: 'parent',
        memberAppended: true,
      });
      expect(result.instance?.id).toBe(parent.id);
      expect(result.instance?.parentInstanceId).toBeUndefined();
      expect(result.instance?.clientModelId).toBe('gpt-5.6-sol');
      expect(result.createdReason).toBeUndefined();
      delete request.headers['x-openai-subagent'];
      const canonicalKey = extractObservedRouteInstanceKey(request, request.body);
      expect(canonicalKey).toEqual(key);
      const repeated = resolveObserved(config, canonicalKey, 2_000, requestedModel);
      expect(repeated).toMatchObject({
        changed: false,
        resolutionPath: 'parent',
        memberAppended: false,
      });
      expect(repeated.createdReason).toBeUndefined();
      expect(Object.values(config.instances)).toHaveLength(1);
    }
  );

  it.each(['body', 'header', 'flat', 'conflicting'])(
    'rejects %s system subagent metadata without a parent and preserves ARMED',
    projection => {
      for (const subagentKind of ['thread_spawn', null]) {
        const request = codexTurnRequest(
          'child-thread',
          projection === 'flat' ? {} : { subagent_kind: subagentKind },
          projection === 'header' ? 'header' : 'body'
        );
        if (projection === 'flat') request.body.client_metadata.subagent_kind = subagentKind;
        if (projection === 'conflicting') {
          request.headers['x-codex-turn-metadata'] = JSON.stringify({
            thread_source: 'system',
            subagent_kind: 'other-kind',
          });
        }
        const key = extractObservedRouteInstanceKey(request, request.body);
        expect(key).toBeNull();
        for (const withArmed of [false, true]) {
          const config = baseConfig();
          if (withArmed) createArmedRouteInstance(config, 'chosen-model', 'max');
          const before = JSON.parse(JSON.stringify(config));
          expect(resolveObserved(config, key, 1_000, 'gpt-5.6-sol')).toEqual({
            instance: null,
            changed: false,
          });
          expect(config).toEqual(before);
          expect(Object.keys(config.instances)).toHaveLength(withArmed ? 1 : 0);
        }
      }
    }
  );

  it('rejects malformed or conflicting system subagent kinds even with a complete parent chain', () => {
    for (const subagentKind of [null, 42, ['thread_spawn'], { kind: 'thread_spawn' }]) {
      const request = codexTurnRequest('child-thread', {
        parent_thread_id: 'root-thread',
        subagent_kind: subagentKind,
      });
      expect(extractObservedRouteInstanceKey(request, request.body)).toBeNull();
    }
    const conflicting = codexTurnRequest('child-thread', {
      parent_thread_id: 'root-thread',
      subagent_kind: 'thread_spawn',
    });
    conflicting.headers['x-codex-turn-metadata'] = JSON.stringify({
      thread_source: 'system',
      subagent_kind: 'other-kind',
    });
    expect(extractObservedRouteInstanceKey(conflicting, conflicting.body)).toBeNull();
  });

  it('rejects system metadata with an incomplete or self-referencing subagent chain', () => {
    const request = codexTurnRequest('child-thread');
    request.headers['x-openai-subagent'] = 'worker';
    expect(extractObservedRouteInstanceKey(request, request.body)).toBeNull();
    request.headers['x-codex-parent-thread-id'] = 'child-thread';
    expect(extractObservedRouteInstanceKey(request, request.body)).toBeNull();
  });

  it('keeps the root card when Codex changes threads without a parent marker', () => {
    const config = baseConfig();
    const root = extractObservedRouteInstanceKey({
      headers: {
        'x-codex-window-id': 'window-1',
        'session-id': 'root-session',
        'thread-id': 'root-thread',
      },
    });
    const nextThread = extractObservedRouteInstanceKey({
      headers: {
        'x-codex-window-id': 'window-2',
        'session-id': 'root-session',
        'thread-id': 'next-thread',
      },
    });

    const first = resolveObserved(config, root, 1_000, 'gpt-5.6-sol').instance!;
    const resolution = resolveObserved(config, nextThread, 1_000, 'gpt-5.6-sol');
    const repeated = resolution.instance!;

    expect(root).toMatchObject({
      runtimeSlotId: 'root-session',
      sessionId: 'root-session',
      lineage: { rootSessionId: 'root-session', threadId: 'root-thread' },
    });
    expect(nextThread).toMatchObject({
      runtimeSlotId: 'root-session',
      sessionId: 'root-session',
      lineage: { rootSessionId: 'root-session', threadId: 'next-thread' },
    });
    expect(repeated.id).toBe(first.id);
    expect(resolution).toMatchObject({
      changed: true,
      resolutionPath: 'exact',
      memberAppended: true,
    });
    expect(resolution.createdReason).toBeUndefined();
    expect(resolveObserved(config, nextThread, 1_000, 'gpt-5.6-sol')).toMatchObject({
      changed: false,
      resolutionPath: 'exact',
      memberAppended: false,
    });
    expect(first.memberSessionIds).toEqual(['root-thread', 'next-thread']);
    expect(Object.values(config.instances)).toHaveLength(1);
  });

  it.each(['thread-first', 'session-first'])(
    'reuses one Codex card across identity enrichment and rollback (%s)',
    order => {
      const config = baseConfig();
      const key = (sessionId: string | undefined, threadId: string) =>
        extractObservedRouteInstanceKey({
          headers: {
            'x-codex-window-id': 'window-1',
            'session-id': sessionId,
            'thread-id': threadId,
          },
        });
      const first = resolveObserved(
        config,
        key(order === 'session-first' ? 'session-1' : undefined, 'thread-1'),
        1_000,
        'client-model'
      ).instance!;
      updateRouteInstance(config, first.id, {
        modelId: 'chosen-model',
        reasoningEffort: 'max',
        customNote: 'Keep this route',
      });
      const armed = createArmedRouteInstance(config, 'next-model', 'high');
      const requests = [
        key(order === 'thread-first' ? 'session-1' : undefined, 'thread-1'),
        key('session-1', 'thread-2'),
        key(undefined, 'thread-1'),
        key(undefined, 'thread-2'),
      ];
      for (const [index, request] of requests.entries()) {
        const result = resolveObserved(config, request, 2_000 + index, 'client-model');
        expect(result.instance?.id).toBe(first.id);
        expect(result.createdReason).toBeUndefined();
      }
      expect(first).toMatchObject({
        modelId: 'chosen-model',
        reasoningEffort: 'max',
        display: { customNote: 'Keep this route' },
        createdAt: 1_000,
        lastRequestAt: 2_003,
      });
      expect(armed.routingState).toBe('armed');
      expect(listRouteInstances(config)).toHaveLength(2);
    }
  );

  it.each(['body', 'header'] as const)(
    'shares Codex child sessions and their later thread-only requests with the parent (%s)',
    projection => {
      const config = baseConfig();
      const root = extractObservedRouteInstanceKey({
        headers: {
          'x-codex-window-id': 'window-1',
          'session-id': 'root-session',
          'thread-id': 'root-thread',
        },
      });
      const first = resolveObserved(config, root, 1_000, 'root-model').instance!;
      let parentThreadId = 'root-thread';
      for (const threadId of ['child-thread', 'nested-thread']) {
        const request = codexTurnRequest(
          threadId,
          { parent_thread_id: parentThreadId },
          projection
        );
        const child = extractObservedRouteInstanceKey(request, request.body);
        const result = resolveObserved(config, child, 2_000, 'child-model');
        expect(result.instance?.id).toBe(first.id);
        expect(result.resolutionPath).toBe('parent');
        expect(first.memberSessionIds).toContain(threadId);
        parentThreadId = threadId;
      }
      expect(first.clientModelId).toBe('root-model');
      for (const threadId of ['child-thread', 'nested-thread']) {
        const resumed = extractObservedRouteInstanceKey({
          headers: { 'x-codex-window-id': 'window-2', 'thread-id': threadId },
        });
        expect(resolveObserved(config, resumed, 3_000, 'child-model').instance?.id).toBe(first.id);
      }
      expect(first.modelId).toBe('root-model');
      expect(listRouteInstances(config)).toHaveLength(1);
    }
  );

  it('reuses a Codex fork card when later requests omit session and fork metadata', () => {
    const config = baseConfig();
    const request = codexTurnRequest('root-thread', { thread_source: 'user' });
    const first = resolveObserved(
      config,
      extractObservedRouteInstanceKey(request, request.body),
      1_000,
      'client-model'
    ).instance!;
    const fork = codexTurnRequest('fork-thread', {
      thread_source: 'user',
      forked_from_thread_id: 'root-thread',
    });
    expect(
      resolveObserved(
        config,
        extractObservedRouteInstanceKey(fork, fork.body),
        2_000,
        'client-model'
      ).instance?.id
    ).toBe(first.id);
    const resumed = extractObservedRouteInstanceKey({
      headers: { 'x-codex-window-id': 'window-2', 'thread-id': 'fork-thread' },
    });
    expect(resolveObserved(config, resumed, 3_000, 'client-model').instance?.id).toBe(first.id);
    expect(listRouteInstances(config)).toHaveLength(1);
  });

  it.each(['different-profile', 'independent-session', 'closed-route'])(
    'keeps Codex alias lookup isolated for %s',
    scenario => {
      const config = baseConfig();
      const key = (sessionId: string | undefined, threadId: string) =>
        extractObservedRouteInstanceKey({
          headers: {
            'x-codex-window-id': 'same-window',
            'session-id': sessionId,
            'thread-id': threadId,
          },
        });
      const first = resolveObserved(config, key('session-1', 'thread-1'), 1_000, 'model').instance!;
      if (scenario === 'closed-route') closeRouteInstance(config, first.id, 1_500);
      const next = resolveObserved(
        config,
        scenario === 'independent-session'
          ? key('session-2', 'thread-2')
          : key(undefined, 'thread-1'),
        2_000,
        'model',
        scenario === 'different-profile' ? 'profile-2' : 'profile-1'
      ).instance!;
      expect(next.id).not.toBe(first.id);
      expect(listRouteInstances(config)).toHaveLength(2);
      expect(first.routingState).toBe(scenario === 'closed-route' ? 'closed' : 'active');
    }
  );

  it('does not merge conflicting Codex aliases or consume an ARMED route', () => {
    const config = baseConfig();
    for (const suffix of ['1', '2']) {
      const key = extractObservedRouteInstanceKey({
        headers: {
          'x-codex-window-id': 'same-window',
          'session-id': `session-${suffix}`,
          'thread-id': `thread-${suffix}`,
        },
      });
      resolveObserved(config, key, 1_000, 'model');
    }
    const armed = createArmedRouteInstance(config, 'chosen-model', 'max');
    const before = JSON.parse(JSON.stringify(config));
    const conflict = extractObservedRouteInstanceKey({
      headers: {
        'x-codex-window-id': 'same-window',
        'session-id': 'thread-1',
        'thread-id': 'thread-2',
      },
    });
    expect(resolveObserved(config, conflict, 2_000, 'model')).toMatchObject({
      instance: null,
      memberAppended: false,
    });
    expect(armed.routingState).toBe('armed');
    expect(config).toEqual(before);
  });

  it('refreshes Codex client model for a session while keeping thread aliases on one card', () => {
    const config = baseConfig();
    const session = (threadId: string): ObservedRouteInstanceKey => ({
      agentId: 'codex',
      runtimeSlotId: 'stable-session',
      sessionId: 'stable-session',
      lineage: { source: 'codex', rootSessionId: 'stable-session', threadId },
    });
    const first = resolveObserved(config, session('thread-a'), 1_000, 'model-a').instance!;
    const next = resolveObserved(config, session('thread-b'), 2_000, 'model-b');

    expect(next.instance?.id).toBe(first.id);
    expect(next).toMatchObject({ resolutionPath: 'exact', memberAppended: true });
    expect(first).toMatchObject({
      clientModelId: 'model-b',
      memberSessionIds: ['thread-a', 'thread-b'],
    });
    expect(Object.values(config.instances)).toHaveLength(1);
  });

  it('creates one stable child card for a verified different-model Codex thread', () => {
    const config = baseConfig();
    const root = extractObservedRouteInstanceKey({
      headers: {
        'x-codex-window-id': 'window-root',
        'session-id': 'root-session',
        'thread-id': 'root-thread',
      },
    });
    const child = extractObservedRouteInstanceKey({
      headers: {
        'x-codex-window-id': 'window-child',
        'session-id': 'root-session',
        'thread-id': 'child-thread',
        'x-codex-parent-thread-id': 'root-thread',
      },
    });

    const parent = resolveObserved(config, root, 1_000, 'gpt-5.6-sol').instance!;
    const first = resolveObserved(config, child, 2_000, 'gpt-5.6-terra').instance!;
    const repeated = resolveObserved(config, child, 3_000, 'gpt-5.6-terra').instance!;

    expect(first.id).toBe(parent.id);
    expect(repeated.id).toBe(first.id);
    expect(first).toMatchObject({
      clientModelId: 'gpt-5.6-sol',
      routeKey: { agentId: 'codex', runtimeSlotId: 'root-session', sessionId: 'root-session' },
      memberSessionIds: ['root-thread', 'child-thread'],
    });
    expect(Object.values(config.instances)).toHaveLength(1);
  });

  it('rejects malformed or conflicting Codex lineage projections', () => {
    expect(
      extractObservedRouteInstanceKey({
        headers: {
          'x-codex-window-id': 'window-1',
          'thread-id': 'child-thread',
          'x-codex-parent-thread-id': 'root-thread',
          'x-codex-turn-metadata': '{not-json',
        },
      })
    ).toBeNull();
    expect(
      hasObservedRouteInstanceEvidence({
        headers: {
          'x-codex-window-id': 'window-1',
          'thread-id': 'child-thread',
          'x-openai-subagent': 'worker',
        },
      })
    ).toBe(true);
    expect(
      extractObservedRouteInstanceKey({
        headers: {
          'x-codex-window-id': 'window-1',
          'thread-id': 'child-thread',
          'x-codex-parent-thread-id': 'root-thread',
          'x-codex-turn-metadata': JSON.stringify({
            thread_id: 'different-child',
            parent_thread_id: 'root-thread',
          }),
        },
      })
    ).toBeNull();
    expect(
      extractObservedRouteInstanceKey({
        headers: {
          'x-codex-window-id': 'window-1',
          'thread-id': 'child-thread',
          'x-openai-subagent': 'worker',
        },
      })
    ).toBeNull();
  });

  it('extracts Claude Code and OpenCode child lineage only from their native adapters', () => {
    expect(
      extractObservedRouteInstanceKey({
        headers: {
          'x-claude-code-session-id': 'claude-root',
          'x-claude-code-agent-id': 'claude-child',
          'x-claude-code-parent-agent-id': 'claude-parent',
        },
      })
    ).toEqual({
      agentId: 'claudeCode',
      runtimeSlotId: 'claude-child',
      sessionId: 'claude-child',
      lineage: {
        source: 'claudeCode',
        rootSessionId: 'claude-root',
        parentSessionId: 'claude-parent',
      },
      observedAgentName: 'Claude Code',
      observedRuntimeSlotLabel: 'Claude Code 会话',
    });
    expect(
      extractObservedRouteInstanceKey({
        headers: {
          'user-agent': 'OpenCode/2.0',
          'x-session-affinity': 'opencode-child',
          'x-parent-session-id': 'opencode-root',
        },
      })
    ).toEqual({
      agentId: 'session:session-affinity',
      runtimeSlotId: 'opencode-child',
      sessionId: 'opencode-child',
      lineage: { source: 'openCode', parentSessionId: 'opencode-root' },
      observedAgentName: 'OpenCode',
      observedRuntimeSlotLabel: '会话级路由',
    });
    expect(
      extractObservedRouteInstanceKey({
        headers: {
          'user-agent': 'GenericClient/1.0',
          'x-session-affinity': 'generic-child',
          'x-parent-session-id': 'untrusted-parent',
        },
      })
    ).toMatchObject({
      agentId: 'session:session-affinity',
      sessionId: 'generic-child',
    });
  });

  it('does not promote Grok request ids into route identity', () => {
    expect(
      extractObservedRouteInstanceKey({
        headers: { 'user-agent': 'Grok Build/1.0', 'x-request-id': 'request-1' },
      })
    ).toBeNull();
  });

  it('binds an ARMED route from the Claude Code session header despite a different request model', () => {
    const observedKey = extractObservedRouteInstanceKey({
      headers: { 'x-claude-code-session-id': 'claude-session-1' },
    });
    expect(observedKey).toEqual({
      agentId: 'claudeCode',
      runtimeSlotId: 'claude-session-1',
      sessionId: 'claude-session-1',
      lineage: { source: 'claudeCode', rootSessionId: 'claude-session-1' },
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
  it('shares same-model Codex children with the parent route card', () => {
    const config = baseConfig();
    const parentKey: ObservedRouteInstanceKey = {
      agentId: 'codex',
      runtimeSlotId: 'root-thread',
      sessionId: 'root-thread',
      lineage: { source: 'codex', rootSessionId: 'root-session' },
      observedAgentName: 'Codex',
    };
    const childKey: ObservedRouteInstanceKey = {
      agentId: 'codex',
      runtimeSlotId: 'child-thread',
      sessionId: 'child-thread',
      lineage: {
        source: 'codex',
        rootSessionId: 'root-session',
        parentSessionId: 'root-thread',
      },
      observedAgentName: 'Codex',
    };
    const parent = resolveObserved(config, parentKey, 1_000, 'gpt-5.6-sol').instance!;
    parent.modelId = 'manually-routed-model';

    const child = resolveObserved(config, childKey, 2_000, 'gpt-5.6-sol');

    expect(child.instance?.id).toBe(parent.id);
    expect(parent).toMatchObject({
      clientModelId: 'gpt-5.6-sol',
      modelId: 'manually-routed-model',
      memberSessionIds: ['root-session', 'child-thread'],
      lastRequestAt: 2_000,
    });
    expect(Object.values(config.instances)).toHaveLength(1);
  });

  it('reuses one Codex card for child threads regardless of requested model', () => {
    const config = baseConfig();
    const parentKey: ObservedRouteInstanceKey = {
      agentId: 'codex',
      runtimeSlotId: 'root-thread',
      sessionId: 'root-thread',
      lineage: { source: 'codex', rootSessionId: 'root-session' },
    };
    const childKey = (sessionId: string): ObservedRouteInstanceKey => ({
      agentId: 'codex',
      runtimeSlotId: sessionId,
      sessionId,
      lineage: {
        source: 'codex',
        rootSessionId: 'root-session',
        parentSessionId: 'root-thread',
      },
    });
    const parent = resolveObserved(config, parentKey, 1_000, 'gpt-5.6-sol').instance!;

    const first = resolveObserved(
      config,
      childKey('child-terra'),
      2_000,
      'gpt-5.6-terra'
    ).instance!;
    const repeated = resolveObserved(
      config,
      childKey('child-terra'),
      3_000,
      'gpt-5.6-terra'
    ).instance!;
    const second = resolveObserved(config, childKey('child-luna'), 4_000, 'gpt-5.6-luna').instance!;

    expect(repeated.id).toBe(first.id);
    expect(first.id).toBe(parent.id);
    expect(second.id).toBe(parent.id);
    expect(parent).toMatchObject({
      clientModelId: 'gpt-5.6-sol',
      memberSessionIds: ['root-session', 'child-terra', 'child-luna'],
      lastRequestAt: 4_000,
    });
    expect(Object.values(config.instances)).toHaveLength(1);
  });

  it('applies the same-model sharing rule to Claude Code and OpenCode adapters', () => {
    const cases = [
      {
        root: extractObservedRouteInstanceKey({
          headers: { 'x-claude-code-session-id': 'claude-root' },
        }),
        same: extractObservedRouteInstanceKey({
          headers: {
            'x-claude-code-session-id': 'claude-root',
            'x-claude-code-agent-id': 'claude-same',
          },
        }),
        different: extractObservedRouteInstanceKey({
          headers: {
            'x-claude-code-session-id': 'claude-root',
            'x-claude-code-agent-id': 'claude-different',
          },
        }),
      },
      {
        root: extractObservedRouteInstanceKey({
          headers: { 'user-agent': 'OpenCode/2.0', 'x-session-affinity': 'opencode-root' },
        }),
        same: extractObservedRouteInstanceKey({
          headers: {
            'user-agent': 'OpenCode/2.0',
            'x-session-affinity': 'opencode-same',
            'x-parent-session-id': 'opencode-root',
          },
        }),
        different: extractObservedRouteInstanceKey({
          headers: {
            'user-agent': 'OpenCode/2.0',
            'x-session-affinity': 'opencode-different',
            'x-parent-session-id': 'opencode-root',
          },
        }),
      },
    ];

    for (const item of cases) {
      const config = baseConfig();
      const parent = resolveObserved(config, item.root, 1_000, 'parent-model').instance!;
      const sameModel = resolveObserved(config, item.same, 2_000, 'parent-model').instance!;
      const differentModel = resolveObserved(
        config,
        item.different,
        3_000,
        'child-model'
      ).instance!;

      expect(sameModel.id).toBe(parent.id);
      expect(differentModel).toMatchObject({
        parentInstanceId: parent.id,
        childOrdinal: 1,
        clientModelId: 'child-model',
      });
    }
  });

  it('resolves nested lineage through a verified member or child alias', () => {
    const config = baseConfig();
    const parent = resolveObserved(
      config,
      {
        agentId: 'claudeCode',
        runtimeSlotId: 'claude-root',
        sessionId: 'claude-root',
        lineage: { source: 'claudeCode', rootSessionId: 'claude-root' },
      },
      1_000,
      'claude-opus'
    ).instance!;
    const firstChild = resolveObserved(
      config,
      {
        agentId: 'claudeCode',
        runtimeSlotId: 'agent-1',
        sessionId: 'agent-1',
        lineage: {
          source: 'claudeCode',
          rootSessionId: 'claude-root',
          parentSessionId: 'claude-root',
        },
      },
      2_000,
      'claude-sonnet'
    ).instance!;
    const nested = resolveObserved(
      config,
      {
        agentId: 'claudeCode',
        runtimeSlotId: 'agent-2',
        sessionId: 'agent-2',
        lineage: {
          source: 'claudeCode',
          rootSessionId: 'claude-root',
          parentSessionId: 'agent-1',
        },
      },
      3_000,
      'claude-sonnet'
    ).instance!;

    expect(firstChild.parentInstanceId).toBe(parent.id);
    expect(nested).toMatchObject({ parentInstanceId: parent.id, childOrdinal: 2 });
  });

  it('leaves ARMED untouched when a child parent cannot be proven', () => {
    const config = baseConfig();
    const armed = createArmedRouteInstance(config, 'chosen-model', 'max');
    const resolution = resolveObserved(
      config,
      {
        agentId: 'codex',
        runtimeSlotId: 'orphan-child',
        sessionId: 'orphan-child',
        lineage: {
          source: 'codex',
          rootSessionId: 'missing-root',
          parentSessionId: 'missing-parent',
        },
      },
      1_000,
      'gpt-5.6-terra'
    );

    expect(resolution).toMatchObject({
      instance: null,
      resolutionPath: 'parent-unresolved',
      memberAppended: false,
    });
    expect(config.instances[armed.id].routingState).toBe('armed');
  });

  it('keeps parent resolution profile-scoped', () => {
    const config = baseConfig();
    resolveObserved(
      config,
      {
        agentId: 'codex',
        runtimeSlotId: 'root-thread',
        sessionId: 'root-thread',
        lineage: { source: 'codex', rootSessionId: 'root-session' },
      },
      1_000,
      'gpt-5.6-sol',
      'profile-a'
    );

    const orphan = resolveObserved(
      config,
      {
        agentId: 'codex',
        runtimeSlotId: 'child-thread',
        sessionId: 'child-thread',
        lineage: {
          source: 'codex',
          rootSessionId: 'root-session',
          parentSessionId: 'root-thread',
        },
      },
      2_000,
      'gpt-5.6-terra',
      'profile-b'
    );

    expect(orphan.instance).toBeNull();
    expect(Object.values(config.instances)).toHaveLength(1);
  });

  it('normalizes malformed optional lineage without repairing parent graphs', () => {
    const config = baseConfig();
    config.instances.legacy = {
      id: 'legacy',
      routeKey: { agentId: 'codex', runtimeSlotId: 'legacy', sessionId: 'legacy' },
      clientModelId: '  ',
      parentInstanceId: 'missing-parent',
      childOrdinal: 0,
      memberSessionIds: [' child ', 'child', 'legacy', '\u0001invalid'],
      display: {},
      modelId: 'model',
      reasoningEffort: 'medium',
      routingState: 'closed',
      presenceState: 'unknown',
    };

    expect(normalizeRouteInstanceCollections(config)).toBe(true);
    expect(config.instances.legacy).toMatchObject({
      parentInstanceId: 'missing-parent',
      memberSessionIds: ['child'],
    });
    expect(config.instances.legacy).not.toHaveProperty('clientModelId');
    expect(config.instances.legacy).not.toHaveProperty('childOrdinal');
  });

  it('does not merge existing parentless polluted cards', () => {
    const config = baseConfig();
    config.instances = Object.fromEntries(
      ['internal-1', 'internal-2'].map((sessionId, index) => [
        sessionId,
        {
          id: sessionId,
          profileId: 'profile-1',
          routeKey: { agentId: 'codex', runtimeSlotId: sessionId, sessionId },
          display: { observedAgentName: 'Codex' },
          modelId: 'model',
          reasoningEffort: 'medium',
          routingState: 'active',
          presenceState: 'unknown',
          createdAt: 1_000 + index,
        },
      ])
    );

    normalizeRouteInstanceCollections(config);

    expect(Object.keys(config.instances)).toEqual(['internal-1', 'internal-2']);
    expect(Object.values(config.instances).every(instance => !instance.parentInstanceId)).toBe(
      true
    );
  });

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
    const first = resolve(config, 'session-a', 1_000, 'request-a', 'slot-a');
    const second = resolve(config, 'session-b', 1_001, 'request-b', 'slot-b');
    expect(first.instance?.id).toBe(armed.id);
    expect(first).toMatchObject({ changed: true, resolutionPath: 'armed', memberAppended: false });
    expect(first.createdReason).toBeUndefined();
    expect(second.instance?.id).not.toBe(armed.id);
    expect(second).toMatchObject({
      changed: true,
      resolutionPath: 'created',
      createdReason: 'unseen_identity',
      memberAppended: false,
      instance: { modelId: 'request-b', reasoningEffort: 'high' },
    });
  });

  it('keeps stored route overrides while refreshing the direct client model', () => {
    const config = baseConfig();
    const first = resolve(config, 'session-1', 1_000).instance!;
    const repeated = resolve(config, 'session-1', 2_000, 'different-model');
    expect(config.instances[first.id]).toMatchObject({
      modelId: 'request-model',
      clientModelId: 'different-model',
      reasoningEffort: 'high',
      createdAt: 1_000,
      lastRequestAt: 2_000,
    });
    expect(repeated).toMatchObject({
      changed: true,
      resolutionPath: 'exact',
      memberAppended: false,
    });
    expect(repeated.createdReason).toBeUndefined();
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
    const first = resolve(
      config,
      'shared-session',
      1_000,
      'model-a',
      'slot-1',
      'profile-a'
    ).instance!;
    const second = resolve(
      config,
      'shared-session',
      2_000,
      'model-b',
      'slot-1',
      'profile-b'
    ).instance!;

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
      customNote: '重点会话',
    });
    expect(instance.routeKey).toEqual(routeKey);
    expect(instance).toMatchObject({
      modelId: 'new-model',
      reasoningEffort: 'vendor-ultra',
      display: {
        customAgentName: 'My Agent',
        customRuntimeSlotLabel: 'Work',
        customNote: '重点会话',
      },
    });
    updateRouteInstance(config, instance.id, { customNote: '   ' });
    expect(instance.display.customNote).toBeUndefined();
  });

  it('cancels an ARMED route without adding timestamps', () => {
    const config = baseConfig();
    const armed = createArmedRouteInstance(config, 'model', 'low');
    cancelArmedRouteInstance(config, armed.id);
    expect(listRouteInstances(config)[0]).toMatchObject({ routingState: 'cancelled' });
    expect(config.instances[armed.id]).not.toHaveProperty('createdAt');
  });

  it('restores a closed route as the active current slot', () => {
    const config = baseConfig();
    const instance = resolve(config, 'session-1', 1_000).instance!;
    closeRouteInstance(config, instance.id, 2_000);

    const restored = restoreRouteInstance(config, instance.id, 3_000);

    expect(restored).toMatchObject({ id: instance.id, routingState: 'active' });
    expect(restored).not.toHaveProperty('closedAt');
    expect(restored).not.toHaveProperty('closedReason');
    expect(config.currentRouteBySlot['["profile-1","agent-1","slot-1"]']).toBe(instance.id);
  });

  it('closes an active slot occupant when restoring an older generation', () => {
    const config = baseConfig();
    const target = resolve(config, 'session-1', 1_000).instance!;
    closeRouteInstance(config, target.id, 1_500);
    const current = resolve(config, 'session-2', 2_000).instance!;

    const restored = restoreRouteInstance(config, target.id, 3_000);

    expect(restored.id).toBe(target.id);
    expect(restored.routingState).toBe('active');
    expect(config.instances[current.id]).toMatchObject({
      routingState: 'closed',
      closedReason: 'replaced',
      closedAt: 3_000,
    });
    expect(config.currentRouteBySlot['["profile-1","agent-1","slot-1"]']).toBe(target.id);
  });

  it('restores a cancelled pre-created route to the armed state', () => {
    const config = baseConfig();
    const instance = createArmedRouteInstance(config, 'model', 'low');
    cancelArmedRouteInstance(config, instance.id);

    const restored = restoreRouteInstance(config, instance.id);

    expect(restored).toMatchObject({ id: instance.id, routingState: 'armed' });
    expect(restored).not.toHaveProperty('closedAt');
    expect(restored).not.toHaveProperty('closedReason');
    expect(restored).not.toHaveProperty('createdAt');
  });

  it('rejects restoring active, armed, or missing route instances', () => {
    const config = baseConfig();
    const active = resolve(config, 'session-1', 1_000).instance!;
    const armed = createArmedRouteInstance(config, 'model', 'low');

    expect(() => restoreRouteInstance(config, active.id)).toThrow('可恢复的路由实例不存在');
    expect(() => restoreRouteInstance(config, armed.id)).toThrow('可恢复的路由实例不存在');
    expect(() => restoreRouteInstance(config, 'missing')).toThrow('可恢复的路由实例不存在');
  });
});
