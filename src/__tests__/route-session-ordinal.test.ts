import { describe, expect, it } from 'vitest';
import {
  buildRouteSessionOrdinals,
  formatRouteSessionLabel,
  formatRouteSessionOrdinal,
} from '../renderer/utils/routeSessionOrdinal';
import type { RouteInstance } from '../shared/types/route-proxy';

const instance = (
  id: string,
  agentId: string,
  createdAt: number,
  overrides: Partial<RouteInstance> = {}
): RouteInstance =>
  ({
    id,
    display: {},
    modelId: 'm',
    reasoningEffort: 'medium',
    routingState: 'active',
    presenceState: 'unknown',
    createdAt,
    routeKey: { agentId, runtimeSlotId: id, sessionId: id },
    ...overrides,
  }) as RouteInstance;

describe('buildRouteSessionOrdinals', () => {
  it('numbers sessions per client in creation order', () => {
    const ordinals = buildRouteSessionOrdinals([
      instance('b', 'codex', 200),
      instance('a', 'codex', 100),
      instance('c', 'codex', 300),
    ]);

    expect(ordinals).toEqual({
      a: { primary: 1 },
      b: { primary: 2 },
      c: { primary: 3 },
    });
  });

  it('numbers each client independently', () => {
    const ordinals = buildRouteSessionOrdinals([
      instance('x1', 'codex', 100),
      instance('y1', 'claudeCode', 50),
      instance('x2', 'codex', 200),
      instance('y2', 'claudeCode', 400),
    ]);

    expect(ordinals).toEqual({
      x1: { primary: 1 },
      x2: { primary: 2 },
      y1: { primary: 1 },
      y2: { primary: 2 },
    });
  });

  it('keeps existing numbers stable when a session closes and a new one appears', () => {
    const before = buildRouteSessionOrdinals([
      instance('a', 'codex', 100),
      instance('b', 'codex', 200),
    ]);
    const after = buildRouteSessionOrdinals([
      instance('a', 'codex', 100, { routingState: 'closed' }),
      instance('b', 'codex', 200),
      instance('c', 'codex', 300),
    ]);

    // 只追加：已有卡片的编号不得漂移，否则用户刚记住的编号就失效了
    expect(after.a).toEqual(before.a);
    expect(after.b).toEqual(before.b);
    expect(after.c).toEqual({ primary: 3 });
  });

  it('breaks ties on identical creation times deterministically', () => {
    const ordinals = buildRouteSessionOrdinals([
      instance('z', 'codex', 100),
      instance('a', 'codex', 100),
    ]);

    expect(ordinals).toEqual({ a: { primary: 1 }, z: { primary: 2 } });
  });

  it('skips instances without a route key, such as an armed placeholder', () => {
    const armed = {
      id: 'armed',
      display: {},
      modelId: 'm',
      reasoningEffort: 'medium',
      routingState: 'armed',
      presenceState: 'unknown',
    } as RouteInstance;

    expect(buildRouteSessionOrdinals([armed, instance('a', 'codex', 100)])).toEqual({
      a: { primary: 1 },
    });
  });

  it('accepts the record form used by the routing config', () => {
    expect(
      buildRouteSessionOrdinals({
        a: instance('a', 'codex', 100),
        b: instance('b', 'codex', 200),
      })
    ).toEqual({ a: { primary: 1 }, b: { primary: 2 } });
  });

  it('does not let children consume primary ordinals', () => {
    const parent = instance('parent', 'codex', 200);
    const childOne = instance('child-1', 'codex', 250, {
      parentInstanceId: 'parent',
      childOrdinal: 1,
    });
    const childTwo = instance('child-2', 'codex', 300, {
      parentInstanceId: 'parent',
      childOrdinal: 2,
    });
    const earlierParent = instance('earlier', 'codex', 100);

    expect(buildRouteSessionOrdinals([parent, childOne, childTwo, earlierParent])).toEqual({
      earlier: { primary: 1 },
      parent: { primary: 2 },
      'child-1': { primary: 2, secondary: 1 },
      'child-2': { primary: 2, secondary: 2 },
    });
  });

  it('keeps persisted child ordinals stable when unrelated cards are added', () => {
    const parent = instance('parent', 'codex', 200);
    const child = instance('child', 'codex', 250, {
      parentInstanceId: 'parent',
      childOrdinal: 3,
    });
    const before = buildRouteSessionOrdinals([parent, child]);
    const after = buildRouteSessionOrdinals([
      parent,
      child,
      instance('later', 'codex', 300),
      instance('other-agent', 'claudeCode', 50),
    ]);

    expect(before.child).toEqual({ primary: 1, secondary: 3 });
    expect(after.child).toEqual({ primary: 1, secondary: 3 });
  });

  it('falls back to a primary ordinal for missing or invalid parents', () => {
    const orphan = instance('orphan', 'codex', 100, {
      parentInstanceId: 'missing',
      childOrdinal: 1,
    });
    const invalid = instance('invalid', 'codex', 200, {
      parentInstanceId: 'orphan',
      childOrdinal: 0,
    });

    expect(buildRouteSessionOrdinals([orphan, invalid])).toEqual({
      orphan: { primary: 1 },
      invalid: { primary: 2 },
    });
  });

  it('does not attach a child ordinal across profile boundaries', () => {
    const parent = instance('parent', 'codex', 100, { profileId: 'profile-a' });
    const crossProfileChild = instance('child', 'codex', 200, {
      profileId: 'profile-b',
      parentInstanceId: parent.id,
      childOrdinal: 1,
    });

    expect(buildRouteSessionOrdinals([parent, crossProfileChild])).toEqual({
      parent: { primary: 1 },
      child: { primary: 2 },
    });
  });

  it('returns nothing for missing input', () => {
    expect(buildRouteSessionOrdinals(undefined)).toEqual({});
    expect(buildRouteSessionOrdinals([])).toEqual({});
  });
});

describe('formatRouteSessionLabel', () => {
  it('appends the ordinal so two windows of one client are distinguishable', () => {
    expect(formatRouteSessionLabel('Codex', { primary: 2 })).toBe('Codex #2');
    expect(formatRouteSessionLabel('Codex', { primary: 2, secondary: 1 })).toBe('Codex #2.1');
    expect(formatRouteSessionOrdinal({ primary: 2, secondary: 1 })).toBe('#2.1');
  });

  it('leaves the name alone when there is no ordinal', () => {
    expect(formatRouteSessionLabel('Codex', undefined)).toBe('Codex');
  });
});
