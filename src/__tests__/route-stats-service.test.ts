import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RouteEndpointCapabilityState,
  RoutePathState,
  RoutingConfig,
} from '../shared/types/route-proxy';

const mocks = vi.hoisted(() => {
  const routing = {
    stats: {},
    routePathStates: {},
    routeEndpointCapabilities: {},
    modelRegistry: {
      version: 1,
      sources: [],
      entries: {},
      overrides: [],
      displayItems: [],
      vendorPriorities: {},
    },
  } as Pick<
    RoutingConfig,
    'modelRegistry' | 'routeEndpointCapabilities' | 'routePathStates' | 'stats'
  >;

  return {
    routing,
    upsertRoutePathState: vi.fn(async (state: RoutePathState) => {
      const key = [
        state.routeRuleId,
        state.siteId,
        state.accountId,
        state.apiKeyId,
        encodeURIComponent(state.targetProtocol || 'native'),
        encodeURIComponent(state.canonicalModel || '*'),
        encodeURIComponent(state.resolvedModel || '*'),
      ].join('|');
      routing.routePathStates[key] = state;
    }),
    upsertRouteEndpointCapabilityState: vi.fn(async (state: RouteEndpointCapabilityState) => {
      const key = [
        state.siteId,
        state.accountId,
        state.apiKeyId,
        state.cliType,
        encodeURIComponent(state.targetProtocol || 'native'),
        state.endpoint,
      ].join('|');
      routing.routeEndpointCapabilities![key] = state;
    }),
    upsertRouteChannelStatsBatch: vi.fn(async (statsList: Array<Record<string, unknown>>) => {
      for (const stats of statsList) {
        // 与真实 buildStatsKey 同款拼法：recordOutcome 下一次读 routing.stats 时要能命中
        const key = [
          stats.routeRuleId,
          stats.siteId,
          stats.accountId,
          stats.apiKeyId,
          stats.targetProtocol || 'native',
        ].join(':');
        routing.stats![key] = stats as never;
      }
    }),
  };
});

vi.mock('../main/utils/logger', () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock('../main/unified-config-manager', () => ({
  unifiedConfigManager: {
    getRoutingConfig: vi.fn(() => mocks.routing),
    upsertRoutePathState: mocks.upsertRoutePathState,
    upsertRouteEndpointCapabilityState: mocks.upsertRouteEndpointCapabilityState,
    upsertRouteChannelStatsBatch: mocks.upsertRouteChannelStatsBatch,
    persistRouteRuntimeState: vi.fn(async () => undefined),
    recordRouteStats: vi.fn(),
  },
}));

import {
  beginRoutePathAttempt,
  flushToStorage,
  invalidateRouteStats,
  getRoutePathDisabledUntil,
  isRouteEndpointUnsupported,
  isRoutePathDisabled,
  recordOutcome,
  resetRouteSiteBreakers,
  recordRouteEndpointUnsupported,
  recordRoutePathOutcome,
  ROUTE_PATH_DISABLE_LADDER_MINUTES,
  ROUTE_PATH_DISABLE_MS,
  ROUTE_PATH_MIN_DISABLE_SAMPLES,
} from '../main/route-stats-service';

const minutes = (value: number) => value * 60 * 1000;
const [RUNG_1, RUNG_2, RUNG_3] = ROUTE_PATH_DISABLE_LADDER_MINUTES;

const routePath = {
  routeRuleId: 'rule-1',
  siteId: 'site-1',
  accountId: 'acc-1',
  apiKeyId: 'key-1',
  cliType: 'claudeCode' as const,
  canonicalModel: 'claude-opus-4-6',
  resolvedModel: 'claude-opus-4.6-20260201',
};

describe('route-stats-service route path state', () => {
  beforeEach(() => {
    mocks.routing.routePathStates = {};
    mocks.routing.routeEndpointCapabilities = {};
    mocks.routing.modelRegistry.displayItems = [];
    mocks.upsertRoutePathState.mockClear();
    mocks.upsertRouteEndpointCapabilityState.mockClear();
  });

  it('keeps the first failed sample enabled so a manual recovery is not immediately undone', async () => {
    const now = 1_000_000;

    const state = await recordRoutePathOutcome(routePath, 'failure', { statusCode: 502 }, now);

    expect(state.windowRequestCount).toBe(1);
    expect(state.windowSuccessCount).toBe(0);
    expect(state.successRate).toBe(0);
    expect(state.disabledUntil).toBeUndefined();
    expect(isRoutePathDisabled(routePath, now + 1)).toBe(false);
  });

  it('opens the breaker on the first ladder rung when the success rate drops below threshold', async () => {
    const now = 1_100_000;

    await recordRoutePathOutcome(routePath, 'failure', { statusCode: 502 }, now);
    const state = await recordRoutePathOutcome(routePath, 'failure', { statusCode: 502 }, now + 1);

    expect(state.windowRequestCount).toBe(ROUTE_PATH_MIN_DISABLE_SAMPLES);
    expect(state.windowSuccessCount).toBe(0);
    expect(state.successRate).toBe(0);
    expect(state.disabledReason).toBe('success_rate_below_threshold');
    expect(state.disabledUntil).toBe(now + 1 + minutes(RUNG_1));
    expect(isRoutePathDisabled(routePath, now + 2)).toBe(true);
    expect(isRoutePathDisabled(routePath, now + 1 + minutes(RUNG_1) + 1)).toBe(false);
  });

  it('admits a single half-open probe once the open period expires', async () => {
    const now = 1_150_000;
    await recordRoutePathOutcome(routePath, 'failure', { statusCode: 502 }, now);
    await recordRoutePathOutcome(routePath, 'failure', { statusCode: 502 }, now + 1);
    const halfOpenAt = now + 1 + minutes(RUNG_1) + 1;

    expect(beginRoutePathAttempt(routePath, now + 2)).toBe(false);
    expect(beginRoutePathAttempt(routePath, halfOpenAt)).toBe(true);
    // 探测在途：其余请求视为不可用，并拿到短 Retry-After 提示
    expect(isRoutePathDisabled(routePath, halfOpenAt + 1)).toBe(true);
    expect(getRoutePathDisabledUntil(routePath, halfOpenAt + 1)).toBe(halfOpenAt + 1 + 5_000);

    const closed = await recordRoutePathOutcome(
      routePath,
      'success',
      { statusCode: 200 },
      halfOpenAt + 2
    );
    expect(closed.disabledUntil).toBeUndefined();
    expect(closed.disabledReason).toBeUndefined();
    expect(closed.disableStreak).toBeUndefined();
    // 闭合时重开窗口：旧失败样本不再计入
    expect(closed.windowRequestCount).toBe(1);
    expect(closed.successRate).toBe(1);
    expect(isRoutePathDisabled(routePath, halfOpenAt + 3)).toBe(false);
  });

  it('re-opens on the next ladder rung when the half-open probe fails', async () => {
    const now = 1_200_000;
    await recordRoutePathOutcome(routePath, 'failure', { statusCode: 502 }, now);
    await recordRoutePathOutcome(routePath, 'failure', { statusCode: 502 }, now + 1);
    const halfOpenAt = now + 1 + minutes(RUNG_1) + 1;
    expect(beginRoutePathAttempt(routePath, halfOpenAt)).toBe(true);

    const reopened = await recordRoutePathOutcome(
      routePath,
      'failure',
      { statusCode: 503 },
      halfOpenAt
    );

    expect(reopened.disabledReason).toBe('success_rate_below_threshold');
    expect(reopened.disableStreak).toBe(2);
    expect(reopened.disabledUntil).toBe(halfOpenAt + minutes(RUNG_2));
    expect(isRoutePathDisabled(routePath, halfOpenAt + 1)).toBe(true);
  });

  it('keeps the half-open state across neutral samples', async () => {
    const now = 1_250_000;
    await recordRoutePathOutcome(routePath, 'failure', { statusCode: 502 }, now);
    await recordRoutePathOutcome(routePath, 'failure', { statusCode: 502 }, now + 1);
    const halfOpenAt = now + 1 + minutes(RUNG_1) + 1;

    const state = await recordRoutePathOutcome(
      routePath,
      'neutral',
      { statusCode: 400 },
      halfOpenAt
    );

    expect(state.disabledUntil).toBeUndefined();
    expect(state.disabledReason).toBe('success_rate_below_threshold');
    expect(state.disableStreak).toBe(1);
  });

  it('does not count neutral responses as route path health samples', async () => {
    const now = 2_000_000;

    const state = await recordRoutePathOutcome(routePath, 'neutral', { statusCode: 400 }, now);

    expect(state.windowRequestCount).toBe(0);
    expect(state.windowSuccessCount).toBe(0);
    expect(state.disabledUntil).toBeUndefined();
    expect(isRoutePathDisabled(routePath, now + 1)).toBe(false);
  });

  it('uses route runtime config for disable duration and success rate threshold', async () => {
    const now = 3_000_000;

    await recordRoutePathOutcome(routePath, 'success', undefined, now);
    const firstFailure = await recordRoutePathOutcome(routePath, 'failure', undefined, now + 1, {
      successRateWindowMinutes: 5,
      disableDurationMinutes: 10,
      minSuccessRate: 0.4,
    });
    expect(firstFailure.successRate).toBe(0.5);
    expect(firstFailure.disabledUntil).toBeUndefined();

    // 配置的禁用时长是阶梯的上限
    const secondFailure = await recordRoutePathOutcome(routePath, 'failure', undefined, now + 2, {
      successRateWindowMinutes: 5,
      disableDurationMinutes: 1,
      minSuccessRate: 0.7,
    });
    expect(secondFailure.successRate).toBeCloseTo(1 / 3);
    expect(secondFailure.disabledUntil).toBe(now + 2 + 1 * 60 * 1000);
  });

  it('uses route runtime config for the success rate calculation window', async () => {
    const now = 4_000_000;
    const key = { ...routePath, apiKeyId: 'key-2' };

    await recordRoutePathOutcome(key, 'success', undefined, now, {
      successRateWindowMinutes: 10,
      disableDurationMinutes: 30,
      minSuccessRate: 0.8,
    });
    const state = await recordRoutePathOutcome(key, 'failure', undefined, now + 11 * 60 * 1000, {
      successRateWindowMinutes: 10,
      disableDurationMinutes: 30,
      minSuccessRate: 0.8,
    });

    expect(state.windowStartedAt).toBe(now + 11 * 60 * 1000);
    expect(state.windowRequestCount).toBe(1);
    expect(state.windowSuccessCount).toBe(0);
    expect(state.successRate).toBe(0);
  });

  it('keeps priority-hit reset suppression when the same route path reports success again', async () => {
    const now = 4_500_000;
    const key = { ...routePath, targetProtocol: 'native' as const };
    mocks.routing.routePathStates = {
      'rule-1|site-1|acc-1|key-1|native|claude-opus-4-6|claude-opus-4.6-20260201': {
        ...key,
        windowStartedAt: now - 1_000,
        windowRequestCount: 0,
        windowSuccessCount: 0,
        successRate: 1,
        affinitySuppressedAt: now - 500,
        affinitySuppressedUntil: now + 60_000,
        updatedAt: now - 500,
      },
    };

    const state = await recordRoutePathOutcome(key, 'success', { statusCode: 200 }, now);

    expect(state.lastOutcome).toBe('success');
    expect(state.lastSuccessAt).toBe(now);
    expect(state.affinitySuppressedAt).toBe(now - 500);
    expect(state.affinitySuppressedUntil).toBe(now + 60_000);
  });

  it('tracks the request selection time for the latest successful outcome', async () => {
    const now = 4_600_000;
    const requestSelectionStartedAt = now - 500;

    const state = await recordRoutePathOutcome(
      routePath,
      'success',
      { statusCode: 200, requestSelectionStartedAt },
      now
    );

    expect(state.lastSuccessRequestStartedAt).toBe(requestSelectionStartedAt);
  });

  it('preserves the successful request selection time after a later failure', async () => {
    const now = 4_700_000;
    const requestSelectionStartedAt = now - 500;

    await recordRoutePathOutcome(
      routePath,
      'success',
      { statusCode: 200, requestSelectionStartedAt },
      now
    );
    const state = await recordRoutePathOutcome(
      routePath,
      'failure',
      { statusCode: 502, requestSelectionStartedAt: now + 500 },
      now + 1_000
    );

    expect(state.lastSuccessRequestStartedAt).toBe(requestSelectionStartedAt);
  });

  it('does not let a pre-invalidation completion overwrite a later valid success', async () => {
    const affinityInvalidatedAt = 4_800_000;
    const validRequestStartedAt = affinityInvalidatedAt + 100;
    mocks.routing.modelRegistry.displayItems = [
      {
        id: 'manual-claude-opus',
        vendor: 'claude',
        canonicalName: routePath.canonicalModel,
        sourceKeys: ['site-1:acc-1:claude-opus-4.6-20260201'],
        priorityConfig: {
          sitePriorities: {},
          apiKeyPriorities: {},
          affinityInvalidatedAt,
        },
        mode: 'manual',
        createdAt: 1,
        updatedAt: affinityInvalidatedAt,
      },
    ];

    await recordRoutePathOutcome(
      routePath,
      'success',
      { statusCode: 200, requestSelectionStartedAt: validRequestStartedAt },
      affinityInvalidatedAt + 1_000
    );
    const state = await recordRoutePathOutcome(
      routePath,
      'success',
      { statusCode: 200, requestSelectionStartedAt: affinityInvalidatedAt - 100 },
      affinityInvalidatedAt + 2_000
    );

    expect(state.lastOutcome).toBe('success');
    expect(state.lastSuccessAt).toBe(affinityInvalidatedAt + 1_000);
    expect(state.lastSuccessRequestStartedAt).toBe(validRequestStartedAt);
    expect(state.windowRequestCount).toBe(2);
    expect(state.windowSuccessCount).toBe(2);
  });
});

describe('route-stats-service route endpoint capabilities', () => {
  beforeEach(() => {
    mocks.routing.routePathStates = {};
    mocks.routing.routeEndpointCapabilities = {};
    mocks.upsertRoutePathState.mockClear();
    mocks.upsertRouteEndpointCapabilityState.mockClear();
  });

  it('records and reads unsupported endpoint capability by site/account/key/cli/protocol', async () => {
    const now = 5_000_000;
    const key = { ...routePath, targetProtocol: 'anthropic-messages' as const };

    expect(isRouteEndpointUnsupported(key, 'claude_messages_count_tokens')).toBe(false);

    const state = await recordRouteEndpointUnsupported(
      key,
      'claude_messages_count_tokens',
      {
        statusCode: 404,
        error: 'Invalid URL (POST /v1/messages/count_tokens)',
        reason: 'upstream_unsupported',
      },
      now
    );

    expect(state).toMatchObject({
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-1',
      cliType: 'claudeCode',
      targetProtocol: 'anthropic-messages',
      endpoint: 'claude_messages_count_tokens',
      status: 'unsupported',
      reason: 'upstream_unsupported',
      statusCode: 404,
      firstObservedAt: now,
      lastObservedAt: now,
      updatedAt: now,
    });
    expect(isRouteEndpointUnsupported(key, 'claude_messages_count_tokens')).toBe(true);
    expect(
      isRouteEndpointUnsupported(
        { ...key, targetProtocol: 'openai-responses' },
        'claude_messages_count_tokens'
      )
    ).toBe(false);
  });
});

describe('route-stats-service buffered stats flush', () => {
  const flushKey = { ...routePath, targetProtocol: 'anthropic-messages' as const };

  beforeEach(() => {
    mocks.routing.stats = {};
    mocks.upsertRouteChannelStatsBatch.mockClear();
  });

  it('overwrites persisted stats with aggregated in-memory counts and adds no spurious neutral', async () => {
    // 回归：首个窗口的计数此前经 recordRouteStats('neutral') 落盘时全部丢失
    recordOutcome(flushKey, 'success', { statusCode: 200, latencyMs: 123 });
    recordOutcome(flushKey, 'failure', { statusCode: 500 });
    recordOutcome(flushKey, 'failure', { statusCode: 502 });

    await flushToStorage();

    expect(mocks.upsertRouteChannelStatsBatch).toHaveBeenCalledTimes(1);
    const statsList = mocks.upsertRouteChannelStatsBatch.mock.calls[0][0];
    expect(statsList).toHaveLength(1);
    expect(statsList[0]).toMatchObject({
      routeRuleId: flushKey.routeRuleId,
      siteId: flushKey.siteId,
      accountId: flushKey.accountId,
      apiKeyId: flushKey.apiKeyId,
      successCount: 1,
      failureCount: 2,
      neutralCount: 0,
      consecutiveFailures: 2,
      lastStatusCode: 502,
      lastLatencyMs: 123,
    });
  });

  it('clears the buffer after flush and keeps counting on top of flushed values', async () => {
    recordOutcome(flushKey, 'success', { statusCode: 200 });
    await flushToStorage();

    recordOutcome(flushKey, 'success', { statusCode: 200 });
    await flushToStorage();

    expect(mocks.upsertRouteChannelStatsBatch).toHaveBeenCalledTimes(2);
    const secondBatch = mocks.upsertRouteChannelStatsBatch.mock.calls[1][0];
    expect(secondBatch[0]).toMatchObject({ successCount: 2, failureCount: 0, neutralCount: 0 });
  });

  it('does not write anything when the buffer is empty', async () => {
    await flushToStorage();
    expect(mocks.upsertRouteChannelStatsBatch).not.toHaveBeenCalled();
  });
});

describe('route-stats-service confirmed unavailability', () => {
  beforeEach(() => {
    mocks.routing.routePathStates = {};
    mocks.routing.modelRegistry.displayItems = [];
    mocks.upsertRoutePathState.mockClear();
  });

  it('disables on the first confirmed rejection instead of waiting for the window', async () => {
    const now = 2_000_000;

    const state = await recordRoutePathOutcome(
      routePath,
      'failure',
      { statusCode: 401, confirmedUnavailable: 'upstream_credential_rejected' },
      now
    );

    expect(state.windowRequestCount).toBe(1);
    expect(state.disabledReason).toBe('upstream_credential_rejected');
    expect(state.disableStreak).toBe(1);
    expect(state.disabledUntil).toBe(now + minutes(RUNG_1));
    expect(isRoutePathDisabled(routePath, now + 1)).toBe(true);
  });

  it('escalates the ladder on consecutive confirmations of the same reason', async () => {
    let now = 2_100_000;

    const first = await recordRoutePathOutcome(
      routePath,
      'failure',
      { confirmedUnavailable: 'upstream_credential_rejected' },
      now
    );
    expect(first.disabledUntil).toBe(now + minutes(RUNG_1));

    now += minutes(RUNG_1) + 1;
    const second = await recordRoutePathOutcome(
      routePath,
      'failure',
      { confirmedUnavailable: 'upstream_credential_rejected' },
      now
    );
    expect(second.disableStreak).toBe(2);
    expect(second.disabledUntil).toBe(now + minutes(RUNG_2));

    now += minutes(RUNG_2) + 1;
    const third = await recordRoutePathOutcome(
      routePath,
      'failure',
      { confirmedUnavailable: 'upstream_credential_rejected' },
      now
    );
    expect(third.disableStreak).toBe(3);
    expect(third.disabledUntil).toBe(now + minutes(RUNG_3));

    now += minutes(RUNG_3) + 1;
    const fourth = await recordRoutePathOutcome(
      routePath,
      'failure',
      { confirmedUnavailable: 'upstream_credential_rejected' },
      now
    );
    expect(fourth.disableStreak).toBe(4);
    expect(fourth.disabledUntil).toBe(now + minutes(RUNG_3));
  });

  it('restarts the ladder when a different reason is confirmed', async () => {
    let now = 2_200_000;

    await recordRoutePathOutcome(
      routePath,
      'failure',
      { confirmedUnavailable: 'upstream_credential_rejected' },
      now
    );
    now += minutes(RUNG_1) + 1;
    await recordRoutePathOutcome(
      routePath,
      'failure',
      { confirmedUnavailable: 'upstream_credential_rejected' },
      now
    );

    now += minutes(RUNG_2) + 1;
    const switched = await recordRoutePathOutcome(
      routePath,
      'failure',
      { confirmedUnavailable: 'upstream_model_unavailable' },
      now
    );

    expect(switched.disabledReason).toBe('upstream_model_unavailable');
    expect(switched.disableStreak).toBe(1);
    expect(switched.disabledUntil).toBe(now + minutes(RUNG_1));
  });

  it('clears the streak after a success so recovery restarts at the first rung', async () => {
    let now = 2_300_000;

    await recordRoutePathOutcome(
      routePath,
      'failure',
      { confirmedUnavailable: 'upstream_quota_exhausted' },
      now
    );
    now += minutes(RUNG_1) + 1;
    const recovered = await recordRoutePathOutcome(routePath, 'success', { statusCode: 200 }, now);
    expect(recovered.disableStreak).toBeUndefined();

    now += 1;
    const again = await recordRoutePathOutcome(
      routePath,
      'failure',
      { confirmedUnavailable: 'upstream_quota_exhausted' },
      now
    );
    expect(again.disableStreak).toBe(1);
    expect(again.disabledUntil).toBe(now + minutes(RUNG_1));
  });

  it('never lets a ladder rung exceed the configured disable duration', async () => {
    let now = 2_400_000;
    const runtimeConfig = { disableDurationMinutes: 5 };

    const first = await recordRoutePathOutcome(
      routePath,
      'failure',
      { confirmedUnavailable: 'upstream_credential_rejected' },
      now,
      runtimeConfig
    );
    expect(first.disabledUntil).toBe(now + minutes(RUNG_1));

    now += minutes(RUNG_1) + 1;
    const second = await recordRoutePathOutcome(
      routePath,
      'failure',
      { confirmedUnavailable: 'upstream_credential_rejected' },
      now,
      runtimeConfig
    );
    expect(second.disabledUntil).toBe(now + minutes(5));
  });

  it('puts the statistical path on the same ladder as confirmed rejections', async () => {
    const now = 2_500_000;

    await recordRoutePathOutcome(routePath, 'failure', { statusCode: 502 }, now);
    const state = await recordRoutePathOutcome(routePath, 'failure', { statusCode: 502 }, now + 1);

    expect(state.disabledReason).toBe('success_rate_below_threshold');
    expect(state.disabledUntil).toBe(now + 1 + minutes(RUNG_1));
    expect(state.disableStreak).toBe(1);
  });

  it('never disables or touches the streak on a neutral sample', async () => {
    const now = 2_600_000;

    const state = await recordRoutePathOutcome(routePath, 'neutral', { statusCode: 400 }, now);

    expect(state.windowRequestCount).toBe(0);
    expect(state.disabledUntil).toBeUndefined();
    expect(state.disableStreak).toBeUndefined();
    expect(isRoutePathDisabled(routePath, now + 1)).toBe(false);
  });
});

describe('route-stats-service site-level breaker', () => {
  const keyA = { ...routePath, apiKeyId: 'site-key-a' };
  const keyB = { ...routePath, apiKeyId: 'site-key-b' };
  const keyC = { ...routePath, apiKeyId: 'site-key-c' };

  beforeEach(() => {
    mocks.routing.routePathStates = {};
    resetRouteSiteBreakers();
  });

  it('skips every key of a site after consecutive transport failures', async () => {
    const now = 5_000_000;

    await recordRoutePathOutcome(keyA, 'failure', { error: 'net::ERR_CONNECTION_RESET' }, now);
    expect(isRoutePathDisabled(keyC, now + 1)).toBe(false);
    await recordRoutePathOutcome(keyB, 'failure', { error: 'ECONNREFUSED 1.2.3.4:443' }, now + 2);

    expect(isRoutePathDisabled(keyC, now + 3)).toBe(true);
    expect(getRoutePathDisabledUntil(keyC, now + 3)).toBe(now + 2 + 60_000);
    expect(isRoutePathDisabled(keyC, now + 2 + 60_000 + 1)).toBe(false);
  });

  it('scopes 404-class rejections to the same site and model only', async () => {
    const now = 5_100_000;
    const otherModel = { ...keyC, resolvedModel: 'claude-sonnet-4.6' };

    for (const key of [keyA, keyB]) {
      await recordRoutePathOutcome(
        key,
        'failure',
        { statusCode: 404, confirmedUnavailable: 'upstream_model_unavailable' },
        now
      );
    }

    expect(isRoutePathDisabled(keyC, now + 1)).toBe(true);
    expect(isRoutePathDisabled(otherModel, now + 1)).toBe(false);
  });

  it('clears the site breaker on any success from the site', async () => {
    const now = 5_200_000;
    await recordRoutePathOutcome(keyA, 'failure', { error: 'ETIMEDOUT' }, now);
    await recordRoutePathOutcome(keyB, 'failure', { error: 'ETIMEDOUT' }, now + 1);
    expect(isRoutePathDisabled(keyC, now + 2)).toBe(true);

    await recordRoutePathOutcome(keyA, 'success', { statusCode: 200 }, now + 3);

    expect(isRoutePathDisabled(keyC, now + 4)).toBe(false);
  });

  it('ignores HTTP failures and adapter errors for the site scope', async () => {
    const now = 5_300_000;
    await recordRoutePathOutcome(keyA, 'failure', { statusCode: 500, error: 'boom' }, now);
    await recordRoutePathOutcome(keyB, 'failure', { error: 'adapter_response-adapt:x' }, now + 1);

    expect(isRoutePathDisabled(keyC, now + 2)).toBe(false);
  });
});
it('retains channel counts when a failed batch overlaps new requests', async () => {
  invalidateRouteStats();
  mocks.routing.stats = {};
  mocks.upsertRouteChannelStatsBatch.mockClear();
  let reject!: (error: Error) => void;
  mocks.upsertRouteChannelStatsBatch.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      })
  );
  recordOutcome(routePath, 'success');
  const failed = flushToStorage();
  recordOutcome(routePath, 'failure');
  reject(new Error('Injected channel batch failure'));
  await expect(failed).rejects.toThrow('Injected channel batch failure');
  await flushToStorage();
  expect(mocks.upsertRouteChannelStatsBatch.mock.calls[1][0]).toEqual([
    expect.objectContaining({ successCount: 1, failureCount: 1, neutralCount: 0 }),
  ]);
  await flushToStorage();
  expect(mocks.upsertRouteChannelStatsBatch).toHaveBeenCalledTimes(2);
  invalidateRouteStats();
});
