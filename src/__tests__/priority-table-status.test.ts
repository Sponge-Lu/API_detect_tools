import { describe, expect, it } from 'vitest';
import {
  buildPriorityModelEntries,
  derivePriorityRowStatus,
  buildPrioritySessionDots,
  buildSessionChannelKey,
  formatRemainingDuration,
  formatRoutePathDisabledReasonLabel,
  sessionColorForKey,
  sessionColorForSession,
  type PriorityModelEntry,
  type RoutePathSuspensionLabel,
} from '../renderer/components/Route/Redirection/ModelRedirectionTab';
import type { RoutePathDisabledReason } from '../shared/types/route-proxy';

const NOW = 1_700_000_000_000;

const suspension = (
  originalModel: string,
  reason: RoutePathDisabledReason,
  offsetMs: number
): RoutePathSuspensionLabel => ({
  originalModel,
  reason,
  disabledUntil: NOW + offsetMs,
  label: 'x',
  title: 'x',
});

describe('formatRemainingDuration', () => {
  it('counts down in seconds under a minute', () => {
    expect(formatRemainingDuration(NOW + 45_000, NOW)).toBe('45s');
  });

  it('counts down in minutes under an hour', () => {
    expect(formatRemainingDuration(NOW + 4 * 60_000, NOW)).toBe('4m');
  });

  it('splits hours and minutes beyond an hour', () => {
    expect(formatRemainingDuration(NOW + 90 * 60_000, NOW)).toBe('1h30m');
    expect(formatRemainingDuration(NOW + 120 * 60_000, NOW)).toBe('2h');
  });

  it('never renders a negative remainder', () => {
    expect(formatRemainingDuration(NOW - 60_000, NOW)).toBe('0s');
  });
});

describe('formatRoutePathDisabledReasonLabel', () => {
  it('spells out the upstream rejection causes', () => {
    expect(formatRoutePathDisabledReasonLabel('upstream_credential_rejected')).toBe(
      '暂停·密钥无效'
    );
    expect(formatRoutePathDisabledReasonLabel('upstream_model_unavailable')).toBe(
      '暂停·模型不可用'
    );
    expect(formatRoutePathDisabledReasonLabel('upstream_quota_exhausted')).toBe('暂停·余额耗尽');
  });

  it('carries the item threshold on the success-rate label', () => {
    expect(formatRoutePathDisabledReasonLabel('success_rate_below_threshold', 0.8)).toBe(
      '暂停·成功率<80%'
    );
  });

  it('falls back to the default threshold when the item config is missing', () => {
    expect(formatRoutePathDisabledReasonLabel('success_rate_below_threshold')).toBe(
      '暂停·成功率<30%'
    );
  });
});

describe('buildPriorityModelEntries', () => {
  it('keeps price in the entry and never merges suspension text into it', () => {
    const entries = buildPriorityModelEntries(
      ['gpt-4o', 'claude-3'],
      { 'gpt-4o': '↑$1 ↓$3' },
      { 'claude-3': [suspension('claude-3', 'upstream_credential_rejected', 60_000)] }
    );

    expect(entries).toEqual([
      { model: 'gpt-4o', priceLabel: '↑$1 ↓$3' },
      {
        model: 'claude-3',
        priceLabel: undefined,
        suspension: {
          reason: 'upstream_credential_rejected',
          disabledUntil: NOW + 60_000,
        },
      },
    ]);
  });

  it('marks nothing as suspended when no state matches', () => {
    const entries = buildPriorityModelEntries(['gpt-4o'], undefined, {});
    expect(entries[0]?.suspension).toBeUndefined();
  });
});

describe('derivePriorityRowStatus', () => {
  const healthy = (model: string): PriorityModelEntry => ({ model });
  const down = (
    model: string,
    reason: RoutePathDisabledReason,
    offsetMs = 60_000
  ): PriorityModelEntry => ({
    model,
    suspension: { reason, disabledUntil: NOW + offsetMs },
  });

  it('reports nothing for a healthy row with no suspension', () => {
    expect(derivePriorityRowStatus([healthy('a')], [])).toBeNull();
  });

  it('reports partial suspension with the counts and the earliest recovery', () => {
    const status = derivePriorityRowStatus(
      [down('a', 'upstream_model_unavailable', 90_000), healthy('b'), healthy('c')],
      []
    );

    expect(status).toEqual({
      kind: 'partial',
      suspended: 1,
      total: 3,
      disabledUntil: NOW + 90_000,
    });
  });

  it('reports the dominant reason when every model is suspended', () => {
    const status = derivePriorityRowStatus(
      [
        down('a', 'upstream_credential_rejected', 60_000),
        down('b', 'upstream_credential_rejected', 90_000),
        down('c', 'upstream_quota_exhausted', 30_000),
      ],
      []
    );

    expect(status).toEqual({
      kind: 'suspended',
      reason: 'upstream_credential_rejected',
      disabledUntil: NOW + 60_000,
    });
  });

  it('breaks a reason tie by the earliest recovery so the badge does not flicker', () => {
    const status = derivePriorityRowStatus(
      [
        down('a', 'upstream_credential_rejected', 90_000),
        down('b', 'upstream_quota_exhausted', 30_000),
      ],
      []
    );

    expect(status).toEqual({
      kind: 'suspended',
      reason: 'upstream_quota_exhausted',
      disabledUntil: NOW + 30_000,
    });
  });

  it('reports suspension even when a path is otherwise disabled', () => {
    const status = derivePriorityRowStatus([down('a', 'upstream_model_unavailable')], []);
    expect(status).toMatchObject({ kind: 'suspended', reason: 'upstream_model_unavailable' });
  });
});

describe('session colour dots', () => {
  const instance = (id: string, overrides: Record<string, unknown> = {}) =>
    ({
      id,
      display: {},
      modelId: 'm',
      reasoningEffort: 'medium',
      routingState: 'active',
      presenceState: 'unknown',
      routeKey: { agentId: 'codex', runtimeSlotId: id, sessionId: id },
      ...overrides,
    }) as never;

  const bindingFor = (instanceId: string, siteId: string) => ({
    instanceId,
    profileId: '',
    siteId,
    accountId: 'acc-1',
    apiKeyId: 'key-1',
    canonicalModel: 'm',
    boundAt: 1,
    lastUsedAt: 1,
  });

  it('gives one key a stable colour and spreads different keys', () => {
    expect(sessionColorForKey('codex|a|a')).toBe(sessionColorForKey('codex|a|a'));
    const colors = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f'].map(key => sessionColorForKey(`codex|${key}|${key}`))
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it('resolves the display name through custom, observed, then agent id', () => {
    const dots = buildPrioritySessionDots(
      [bindingFor('i1', 's1'), bindingFor('i2', 's2'), bindingFor('i3', 's3')],
      {
        i1: instance('i1', { display: { customAgentName: '自定义', observedAgentName: '观测' } }),
        i2: instance('i2', { display: { observedAgentName: '观测' } }),
        i3: instance('i3'),
      },
      'm'
    );

    expect(dots.map(dot => dot.displayName)).toEqual(['自定义', '观测', 'codex']);
  });

  it('drops bindings whose session is no longer active', () => {
    const dots = buildPrioritySessionDots(
      [bindingFor('i1', 's1'), bindingFor('i2', 's2')],
      { i1: instance('i1'), i2: instance('i2', { routingState: 'closed' }) },
      'm'
    );

    expect(dots.map(dot => dot.instanceId)).toEqual(['i1']);
  });

  it('keys a dot to its channel so a row can match it', () => {
    const dots = buildPrioritySessionDots(
      [bindingFor('i1', 'site-x')],
      { i1: instance('i1') },
      'm'
    );

    expect(dots[0]?.channelKey).toBe(
      buildSessionChannelKey({ siteId: 'site-x', accountId: 'acc-1', apiKeyId: 'key-1' })
    );
  });

  it('returns nothing without bindings', () => {
    expect(buildPrioritySessionDots(undefined, {}, 'm')).toEqual([]);
    expect(buildPrioritySessionDots([], {}, 'm')).toEqual([]);
    expect(
      buildPrioritySessionDots([bindingFor('i1', 's1')], { i1: instance('i1') }, undefined)
    ).toEqual([]);
  });
});

describe('session dots stay inside one redirection model', () => {
  const instance = (id: string) =>
    ({
      id,
      display: {},
      modelId: 'x',
      reasoningEffort: 'medium',
      routingState: 'active',
      presenceState: 'unknown',
      routeKey: { agentId: 'codex', runtimeSlotId: id, sessionId: id },
    }) as never;

  const bindingOnModel = (instanceId: string, canonicalModel: string) => ({
    instanceId,
    profileId: '',
    siteId: 'site-1',
    accountId: 'acc-1',
    apiKeyId: 'key-1',
    canonicalModel,
    boundAt: 1,
    lastUsedAt: 1,
  });

  it('shows only the sessions bound to the current card model', () => {
    const dots = buildPrioritySessionDots(
      [bindingOnModel('session-a', 'model-a'), bindingOnModel('session-b', 'model-b')],
      { 'session-a': instance('session-a'), 'session-b': instance('session-b') },
      'model-a'
    );

    expect(dots.map(dot => dot.instanceId)).toEqual(['session-a']);
  });

  it('shows nothing on a card whose model no session is using', () => {
    const dots = buildPrioritySessionDots(
      [bindingOnModel('session-a', 'model-a')],
      { 'session-a': instance('session-a') },
      'model-c'
    );

    expect(dots).toEqual([]);
  });
});

describe('session dot palette is visually separable', () => {
  it('assigns eight distinct colours', () => {
    const colors = new Set(
      Array.from({ length: 40 }, (_, index) => sessionColorForKey(`codex|slot-${index}|s${index}`))
    );

    expect(colors.size).toBeGreaterThanOrEqual(6);
  });

  it('keeps every palette entry far apart in hue', () => {
    const used = Array.from({ length: 200 }, (_, index) =>
      sessionColorForKey(`agent|slot-${index}|session-${index}`)
    );
    const palette = [...new Set(used)];
    expect(palette.length).toBe(8);

    const hueOf = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      if (delta === 0) return 0;
      const raw =
        max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      return (raw * 60 + 360) % 360;
    };

    const hues = palette.map(hueOf).sort((left, right) => left - right);
    const gaps = hues.map((hue, index) =>
      index === 0 ? hue + 360 - hues[hues.length - 1]! : hue - hues[index - 1]!
    );

    // 相邻色相至少隔 25 度，避免绿/青、橙/琥珀这类难以分辨的相邻色
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(25);
  });
});

describe('session dots carry the client ordinal', () => {
  const instance = (id: string, agentId: string) =>
    ({
      id,
      display: {},
      modelId: 'm',
      reasoningEffort: 'medium',
      routingState: 'active',
      presenceState: 'unknown',
      routeKey: { agentId, runtimeSlotId: id, sessionId: id },
    }) as never;

  const bindingFor = (instanceId: string) => ({
    instanceId,
    profileId: '',
    siteId: 'site-1',
    accountId: 'acc-1',
    apiKeyId: 'key-1',
    canonicalModel: 'm',
    boundAt: 1,
    lastUsedAt: 1,
  });

  it('distinguishes two windows of the same client by ordinal', () => {
    const dots = buildPrioritySessionDots(
      [bindingFor('s1'), bindingFor('s2')],
      { s1: instance('s1', 'codex'), s2: instance('s2', 'codex') },
      'm',
      { s1: { primary: 1 }, s2: { primary: 2 } }
    );

    expect(dots.map(dot => dot.displayName)).toEqual(['codex #1', 'codex #2']);
  });

  it('uses the same hierarchical label as the route card', () => {
    const dots = buildPrioritySessionDots(
      [bindingFor('child')],
      { child: instance('child', 'codex') },
      'm',
      { child: { primary: 2, secondary: 1 } }
    );

    expect(dots[0]?.displayName).toBe('codex #2.1');
  });

  it('omits the ordinal when none is supplied', () => {
    const dots = buildPrioritySessionDots([bindingFor('s1')], { s1: instance('s1', 'codex') }, 'm');

    expect(dots[0]?.displayName).toBe('codex');
  });
});

describe('session colour separates windows of one client', () => {
  it('gives consecutive ordinals of one client different colours by construction', () => {
    const colors = [1, 2, 3, 4, 5, 6, 7, 8].map(primary =>
      sessionColorForSession('codex', { primary })
    );

    expect(new Set(colors).size).toBe(8);
  });

  it('keeps a session colour stable across renders', () => {
    expect(sessionColorForSession('codex', { primary: 2, secondary: 1 })).toBe(
      sessionColorForSession('codex', { primary: 2, secondary: 1 })
    );
  });

  it('starts different clients at different palette offsets', () => {
    const first = sessionColorForSession('codex', { primary: 1 });
    const second = sessionColorForSession('claudeCode', { primary: 1 });

    expect(first).not.toBe(second);
  });

  it('treats a missing ordinal as the first session', () => {
    expect(sessionColorForSession('codex', undefined)).toBe(
      sessionColorForSession('codex', { primary: 1 })
    );
  });
});
