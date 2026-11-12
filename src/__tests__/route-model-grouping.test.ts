import { describe, expect, it } from 'vitest';
import type { RouteModelDisplayItem, RouteModelSourceRef } from '../shared/types/route-proxy';
import {
  buildRouteModelCandidates,
  expandRouteModelSourceKeys,
  getRouteModelKey,
  normalizeModelAutoCollect,
} from '../shared/utils/routeModelGrouping';

function source(originalModel: string, siteId = 'site-1'): RouteModelSourceRef {
  return {
    originalModel,
    siteId,
    sourceKey: `${siteId}:${originalModel}`,
    siteName: siteId,
    sourceType: 'site',
    vendor: 'gpt',
    firstSeenAt: 1,
    lastSeenAt: 1,
  };
}

describe('automatic model collection', () => {
  it.each([
    ['claude-opus-4-6', 'claude-opus-4-6'],
    ['claude-opus-4.6', 'claude-opus-4-6'],
    ['claude-opus-4-6-thinking', 'claude-opus-4-6'],
    ['claude-opus-4-5-20251101', 'claude-opus-4-5'],
    ['claude-opus-4-5(fingerprint≈k10)', 'claude-opus-4-5'],
    ['Anthropic/Claude-Opus-4.5-20251101-thinking(fingerprint≈k10)', 'claude-opus-4-5'],
    ['claude-sonnet-4-5-thinking-2025-11-01', 'claude-sonnet-4-5'],
    ['claude-haiku-4-5-20251101', 'claude-haiku-4-5'],
    ['claude-opus-4-5-custom', 'claude-opus-4-5-custom'],
    ['claude-opus-4-5:free', 'claude-opus-4-5:free'],
    ['claude-opus-4-5@v2', 'claude-opus-4-5@v2'],
    ['claude-opus-4-5(extended)', 'claude-opus-4-5(extended)'],
  ])('normalizes %s to %s', (originalModel, expectedKey) => {
    expect(getRouteModelKey(originalModel)).toBe(expectedKey);
  });

  it('names Claude candidates after the base version while retaining every original source', () => {
    const sources = [
      source('claude-opus-4-6'),
      source('claude-opus-4-6-thinking', 'site-2'),
      source('claude-opus-4.6', 'site-3'),
      source('claude-opus-4-5-20251101'),
      source('claude-opus-4-5(fingerprint≈k10)', 'site-2'),
      source('claude-sonnet-4-5-thinking'),
    ];
    const candidates = buildRouteModelCandidates(sources);
    expect(candidates).toHaveLength(3);
    for (const [canonicalName, groupSources] of [
      ['claude-opus-4-6', sources.slice(0, 3)],
      ['claude-opus-4-5', sources.slice(3, 5)],
      ['claude-sonnet-4-5', sources.slice(5)],
    ] as const) {
      expect(candidates.find(candidate => candidate.canonicalName === canonicalName)).toMatchObject(
        {
          modelKey: canonicalName,
          originalModels: groupSources.map(item => item.originalModel).sort(),
          sourceKeys: groupSources.map(item => item.sourceKey),
        }
      );
    }
  });

  it('collects Claude variants for existing auto groups and preserves exact manual exclusions', () => {
    const sources = [
      source('claude-opus-4-5-20251101'),
      source('claude-opus-4-5-thinking'),
      source('claude-opus-4-5(fingerprint≈k10)'),
      source('claude-opus-4-5(fingerprint≈k10)', 'site-2'),
      source('claude-opus-4-6'),
    ];
    const item: RouteModelDisplayItem = {
      id: 'claude-route',
      canonicalName: 'my-claude',
      vendor: 'claude',
      sourceKeys: [sources[0].sourceKey],
      mode: 'manual',
      createdAt: 1,
      updatedAt: 1,
      autoCollect: {
        modelKeys: ['claude-opus-4-5-20251101'],
        excludedModels: ['claude-opus-4-5(fingerprint≈k10)'],
      },
    };
    expect(normalizeModelAutoCollect(item.autoCollect)?.modelKeys).toEqual(['claude-opus-4-5']);
    expect(expandRouteModelSourceKeys(item, sources)).toEqual(
      sources.slice(0, 2).map(item => item.sourceKey)
    );
    delete item.autoCollect;
    expect(expandRouteModelSourceKeys(item, sources)).toEqual([sources[0].sourceKey]);
  });

  it('groups provider and version separator aliases without merging variants or dates', () => {
    const models = [
      'gpt-5.4',
      'openai/gpt-5-4',
      'gpt-5.4-mini',
      'gpt-5.4-thinking',
      'gpt-5.4-20260101',
      'gpt-5.4:free',
      'gpt-5.4@v2',
    ];
    const groups = buildRouteModelCandidates([
      ...models.map(model => source(model)),
      source('gpt-5.4', 'site-2'),
    ]);
    expect(groups).toHaveLength(6);
    expect(groups.find(group => group.modelKey === getRouteModelKey('gpt-5.4'))).toMatchObject({
      originalModels: ['gpt-5.4', 'openai/gpt-5-4'],
      siteCount: 2,
    });
    expect(new Set(groups.map(group => group.modelKey)).size).toBe(6);
  });

  it('keeps manual selection exact and auto collection excludes across sites', () => {
    const sources = [
      source('gpt-5.4'),
      source('gpt-5.4', 'site-2'),
      source('openai/gpt-5.4'),
      source('mirror/gpt-5-4'),
      source('mirror/gpt-5-4', 'site-2'),
      source('gpt-5.4-mini'),
    ];
    const item: RouteModelDisplayItem = {
      id: 'route',
      canonicalName: 'my-route',
      vendor: 'gpt',
      sourceKeys: [sources[0].sourceKey],
      originalModelOrder: ['gpt-5.4'],
      mode: 'manual',
      createdAt: 1,
      updatedAt: 1,
    };
    expect(expandRouteModelSourceKeys(item, sources)).toEqual(
      sources.slice(0, 2).map(item => item.sourceKey)
    );
    item.autoCollect = { modelKeys: ['gpt-5-4'], excludedModels: ['mirror/gpt-5-4'] };
    expect(expandRouteModelSourceKeys(item, sources)).toEqual(
      sources.slice(0, 3).map(item => item.sourceKey)
    );
    item.sourceKeys = [];
    item.originalModelOrder = [];
    expect(expandRouteModelSourceKeys(item, sources)).toEqual(
      sources.slice(0, 3).map(item => item.sourceKey)
    );
  });
});
