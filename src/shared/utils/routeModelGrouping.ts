import type {
  RouteModelAutoCollect,
  RouteModelDisplayItem,
  RouteModelSourceRef,
} from '../types/route-proxy';

function modelNameWithoutProvider(model: string): string {
  return model.trim().replace(/^.*\//, '').toLowerCase();
}

// Only fold naming differences; dates, tags and capability suffixes remain distinct.
export function getRouteModelKey(model: string): string {
  return modelNameWithoutProvider(model).replace(/(\d)\.(?=\d)/g, '$1-');
}

export function normalizeModelAutoCollect(
  value: RouteModelAutoCollect | undefined
): RouteModelAutoCollect | undefined {
  if (!value) return undefined;
  const modelKeys = Array.from(
    new Set((value.modelKeys || []).map(getRouteModelKey).filter(Boolean))
  );
  if (modelKeys.length === 0) return undefined;
  return {
    modelKeys,
    excludedModels: Array.from(
      new Set((value.excludedModels || []).map(model => model.trim()).filter(Boolean))
    ),
  };
}

export function collectRouteOriginalModels(
  selectedModels: string[],
  availableModels: string[],
  autoCollect?: RouteModelAutoCollect
): string[] {
  const selected = new Set(selectedModels);
  if (!autoCollect) return [...selected];
  const keys = new Set(autoCollect.modelKeys);
  for (const model of availableModels) {
    if (keys.has(getRouteModelKey(model))) selected.add(model);
  }
  const excluded = new Set(autoCollect.excludedModels);
  return [...selected].filter(model => !excluded.has(model));
}

export function expandRouteModelSourceKeys(
  item: RouteModelDisplayItem,
  sourcePool: RouteModelSourceRef[]
): string[] {
  const sourceKeys = new Set(item.sourceKeys);
  const models = collectRouteOriginalModels(
    [
      ...(item.originalModelOrder || []).map(model => model.trim()).filter(Boolean),
      ...sourcePool
        .filter(source => sourceKeys.has(source.sourceKey))
        .map(source => source.originalModel),
    ],
    sourcePool.map(source => source.originalModel),
    item.autoCollect
  );
  const selected = new Set(models);
  return sourcePool
    .filter(source => selected.has(source.originalModel))
    .map(source => source.sourceKey);
}

export interface RouteModelCandidate {
  modelKey: string;
  canonicalName: string;
  originalModels: string[];
  sourceKeys: string[];
  siteCount: number;
}

export function buildRouteModelCandidates(sources: RouteModelSourceRef[]): RouteModelCandidate[] {
  const groups = new Map<string, RouteModelSourceRef[]>();
  for (const source of sources) {
    const key = getRouteModelKey(source.originalModel);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(source);
    groups.set(key, group);
  }
  return [...groups]
    .map(([modelKey, group]) => {
      const originalModels = [...new Set(group.map(source => source.originalModel))].sort();
      return {
        modelKey,
        canonicalName: originalModels.map(modelNameWithoutProvider).sort()[0],
        originalModels,
        sourceKeys: [...new Set(group.map(source => source.sourceKey))],
        siteCount: new Set(group.map(source => source.siteId)).size,
      };
    })
    .sort((left, right) => left.canonicalName.localeCompare(right.canonicalName));
}
