import { describe, expect, it } from 'vitest';
import type { RouteModelDisplayItem, RouteModelSourceRef } from '../shared/types/route-proxy';
import {
  buildRouteModelCandidates,
  expandRouteModelSourceKeys,
  getRouteModelKey,
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
