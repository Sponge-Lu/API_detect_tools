import axios from 'axios';
import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { writeJsonFileAtomically } from './utils/atomic-json';
import Logger from './utils/logger';
import type { RouteModelMetadata } from '../shared/types/route-proxy';

const TTL = 24 * 60 * 60_000;
let cache: { fetchedAt: number; models: Record<string, RouteModelMetadata> } | undefined;
let pending: Promise<void> | undefined;
const cachePath = () => path.join(app.getPath('userData'), 'model-metadata.json');
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const nonNegative = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

export function parseModelMetadata(value: unknown): Record<string, RouteModelMetadata> {
  const models: Record<string, RouteModelMetadata> = {};
  for (const [providerId, provider] of Object.entries(object(value))) {
    for (const [id, item] of Object.entries(object(object(provider).models))) {
      const model = object(item);
      const limit = object(model.limit);
      const cost = object(model.cost);
      const modalities = object(model.modalities);
      const entry: RouteModelMetadata = {
        context: nonNegative(limit.context),
        inputLimit: nonNegative(limit.input),
        outputLimit: nonNegative(limit.output),
        reasoning: model.reasoning === true,
        toolCall: model.tool_call === true,
        inputModalities: Array.isArray(modalities.input)
          ? modalities.input.filter((v): v is string => typeof v === 'string')
          : [],
        reasoningEfforts: Array.isArray(model.reasoning_options)
          ? model.reasoning_options.flatMap(option => {
              const record = object(option);
              return record.type === 'effort' && Array.isArray(record.values)
                ? record.values.filter((v): v is string => typeof v === 'string')
                : [];
            })
          : [],
        cost: {
          input: nonNegative(cost.input),
          output: nonNegative(cost.output),
          cacheRead: nonNegative(cost.cache_read),
          cacheCreation: nonNegative(cost.cache_write),
        },
      };
      models[`${providerId}/${id}`] = entry;
      // Prefer the originating provider over relay-specific limits and prices.
      if (!models[id] || String(model.canonical_model_id ?? '').startsWith(`${providerId}/`))
        models[id] = entry;
    }
  }
  return models;
}

export async function loadModelMetadata(): Promise<void> {
  if (cache) return;
  try {
    const value = JSON.parse(await fs.readFile(cachePath(), 'utf8'));
    if (
      !Number.isFinite(value.fetchedAt) ||
      value.fetchedAt < 0 ||
      value.fetchedAt > Date.now() ||
      !value.models ||
      typeof value.models !== 'object' ||
      Array.isArray(value.models)
    )
      throw new Error('模型元数据缓存格式无效');
    cache = value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      Logger.warn('Model metadata cache unavailable', String(error));
  }
}

export async function refreshModelMetadata(force = false): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    await loadModelMetadata();
    if (!force && cache && Date.now() - cache.fetchedAt < TTL) return;
    const response = await axios.get('https://models.dev/api.json', {
      timeout: 10_000,
      maxContentLength: 20 * 1024 * 1024,
      maxRedirects: 0,
      responseType: 'json',
    });
    const models = parseModelMetadata(response.data);
    if (!Object.keys(models).length) throw new Error('模型元数据为空');
    const next = { fetchedAt: Date.now(), models };
    await writeJsonFileAtomically(cachePath(), next);
    cache = next;
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}

export function getModelMetadata(model: string | undefined): RouteModelMetadata | undefined {
  return model ? cache?.models[model] : undefined;
}
