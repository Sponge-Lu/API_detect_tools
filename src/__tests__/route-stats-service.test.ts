import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RouteEndpointCapabilityState,
  RoutePathState,
  RoutingConfig,
} from '../shared/types/route-proxy';

const mocks = vi.hoisted(() => {
  const routing = {
    routePathStates: {},
    routeEndpointCapabilities: {},
  } as Pick<RoutingConfig, 'routeEndpointCapabilities' | 'routePathStates'>;

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
    recordRouteStats: vi.fn(),
  },
}));

import {
  isRouteEndpointUnsupported,
  isRoutePathDisabled,
  recordRouteEndpointUnsupported,
  recordRoutePathOutcome,
  ROUTE_PATH_DISABLE_MS,
  ROUTE_PATH_MIN_DISABLE_SAMPLES,
} from '../main/route-stats-service';

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

  it('disables a repeatedly failed route path for 30 minutes when the 5 minute success rate is below 80%', async () => {
    const now = 1_100_000;

    await recordRoutePathOutcome(routePath, 'failure', { statusCode: 502 }, now);
    const state = await recordRoutePathOutcome(routePath, 'failure', { statusCode: 502 }, now + 1);

    expect(state.windowRequestCount).toBe(ROUTE_PATH_MIN_DISABLE_SAMPLES);
    expect(state.windowSuccessCount).toBe(0);
    expect(state.successRate).toBe(0);
    expect(state.disabledUntil).toBe(now + 1 + ROUTE_PATH_DISABLE_MS);
    expect(isRoutePathDisabled(routePath, now + 2)).toBe(true);
    expect(isRoutePathDisabled(routePath, now + ROUTE_PATH_DISABLE_MS + 1)).toBe(false);
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

    const secondFailure = await recordRoutePathOutcome(routePath, 'failure', undefined, now + 2, {
      successRateWindowMinutes: 5,
      disableDurationMinutes: 10,
      minSuccessRate: 0.7,
    });
    expect(secondFailure.successRate).toBeCloseTo(1 / 3);
    expect(secondFailure.disabledUntil).toBe(now + 2 + 10 * 60 * 1000);
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
