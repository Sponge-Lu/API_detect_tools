/**
 * 输入: RouteAnalyticsBucket[]，可选模型/通道 Top-N
 * 输出: 模型 → site/account/apiKey 通道二部图节点 + 流带（含「其他」聚合）
 * 定位: 工具层 - 路由数据子页模型→通道流向图聚合
 *
 * 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import type { RouteAnalyticsBucket } from '../../shared/types/route-proxy';
import type { ChannelNameLookup } from './routeScatter';

export const SANKEY_OTHER_MODEL_KEY = '__sankey_other_model__';
export const SANKEY_OTHER_CHANNEL_KEY = '__sankey_other_channel__';
const UNKNOWN_MODEL_KEY = '__sankey_unknown_model__';

export interface SankeyModelNode {
  key: string;
  canonicalModel: string;
  label: string;
  requests: number;
  successCount: number;
  failureCount: number;
  isOther: boolean;
}

export interface SankeyChannelNode {
  key: string;
  siteId: string;
  accountId: string;
  apiKeyId: string;
  label: string;
  requests: number;
  successCount: number;
  failureCount: number;
  isOther: boolean;
}

export interface SankeyLink {
  modelKey: string;
  channelKey: string;
  requests: number;
  successCount: number;
  failureCount: number;
  successRate: number;
}

export interface SankeyGraph {
  models: SankeyModelNode[];
  channels: SankeyChannelNode[];
  links: SankeyLink[];
}

interface AggregateBucket {
  requests: number;
  successCount: number;
  failureCount: number;
}

function ensureAggregate(map: Map<string, AggregateBucket>, key: string): AggregateBucket {
  const existing = map.get(key);
  if (existing) return existing;
  const created = { requests: 0, successCount: 0, failureCount: 0 };
  map.set(key, created);
  return created;
}

export function buildRouteSankeyGraph(
  buckets: RouteAnalyticsBucket[],
  options: {
    topModels?: number;
    topChannels?: number;
    lookup?: ChannelNameLookup;
  } = {}
): SankeyGraph {
  const topModels = options.topModels ?? 6;
  const topChannels = options.topChannels ?? 8;
  const lookup = options.lookup;

  const modelTotals = new Map<string, AggregateBucket & { label: string }>();
  const channelTotals = new Map<
    string,
    AggregateBucket & { siteId: string; accountId: string; apiKeyId: string; label: string }
  >();
  const pairTotals = new Map<string, AggregateBucket>();

  for (const bucket of buckets) {
    const siteId = bucket.siteId || '';
    const accountId = bucket.accountId || '';
    const apiKeyId = bucket.apiKeyId || '';
    if (!siteId || !accountId) continue;
    const channelKey = `${siteId}::${accountId}::${apiKeyId}`;
    const modelKey = bucket.canonicalModel || UNKNOWN_MODEL_KEY;

    const modelEntry = modelTotals.get(modelKey) || {
      requests: 0,
      successCount: 0,
      failureCount: 0,
      label: bucket.canonicalModel || '未识别模型',
    };
    modelEntry.requests += bucket.requestCount;
    modelEntry.successCount += bucket.successCount;
    modelEntry.failureCount += bucket.failureCount;
    modelTotals.set(modelKey, modelEntry);

    const channelEntry = channelTotals.get(channelKey) || {
      requests: 0,
      successCount: 0,
      failureCount: 0,
      siteId,
      accountId,
      apiKeyId,
      label: `${lookup?.resolveSiteName?.(siteId) || siteId} / ${
        lookup?.resolveAccountName?.(accountId) || accountId
      } / ${lookup?.resolveApiKeyName?.(apiKeyId) || apiKeyId || 'API Key'}`,
    };
    channelEntry.requests += bucket.requestCount;
    channelEntry.successCount += bucket.successCount;
    channelEntry.failureCount += bucket.failureCount;
    channelTotals.set(channelKey, channelEntry);

    const pair = ensureAggregate(pairTotals, `${modelKey}|${channelKey}`);
    pair.requests += bucket.requestCount;
    pair.successCount += bucket.successCount;
    pair.failureCount += bucket.failureCount;
  }

  const rankedModels = [...modelTotals.entries()].sort((a, b) => b[1].requests - a[1].requests);
  const rankedChannels = [...channelTotals.entries()].sort((a, b) => b[1].requests - a[1].requests);

  const keptModelKeys = new Set(rankedModels.slice(0, topModels).map(([key]) => key));
  const keptChannelKeys = new Set(rankedChannels.slice(0, topChannels).map(([key]) => key));

  const models: SankeyModelNode[] = rankedModels
    .filter(([key]) => keptModelKeys.has(key))
    .map(([key, entry]) => ({
      key,
      canonicalModel: entry.label,
      label: entry.label,
      requests: entry.requests,
      successCount: entry.successCount,
      failureCount: entry.failureCount,
      isOther: false,
    }));

  const channels: SankeyChannelNode[] = rankedChannels
    .filter(([key]) => keptChannelKeys.has(key))
    .map(([key, entry]) => ({
      key,
      siteId: entry.siteId,
      accountId: entry.accountId,
      apiKeyId: entry.apiKeyId,
      label: entry.label,
      requests: entry.requests,
      successCount: entry.successCount,
      failureCount: entry.failureCount,
      isOther: false,
    }));

  const otherModelAgg = { requests: 0, successCount: 0, failureCount: 0 };
  for (const [key, entry] of rankedModels) {
    if (!keptModelKeys.has(key)) {
      otherModelAgg.requests += entry.requests;
      otherModelAgg.successCount += entry.successCount;
      otherModelAgg.failureCount += entry.failureCount;
    }
  }
  if (otherModelAgg.requests > 0) {
    models.push({
      key: SANKEY_OTHER_MODEL_KEY,
      canonicalModel: '其他模型',
      label: '其他模型',
      requests: otherModelAgg.requests,
      successCount: otherModelAgg.successCount,
      failureCount: otherModelAgg.failureCount,
      isOther: true,
    });
  }

  const otherChannelAgg = { requests: 0, successCount: 0, failureCount: 0 };
  for (const [key, entry] of rankedChannels) {
    if (!keptChannelKeys.has(key)) {
      otherChannelAgg.requests += entry.requests;
      otherChannelAgg.successCount += entry.successCount;
      otherChannelAgg.failureCount += entry.failureCount;
    }
  }
  if (otherChannelAgg.requests > 0) {
    channels.push({
      key: SANKEY_OTHER_CHANNEL_KEY,
      siteId: '',
      accountId: '',
      apiKeyId: '',
      label: '其他通道',
      requests: otherChannelAgg.requests,
      successCount: otherChannelAgg.successCount,
      failureCount: otherChannelAgg.failureCount,
      isOther: true,
    });
  }

  const linkAggregate = new Map<string, AggregateBucket>();
  for (const [pairKey, value] of pairTotals.entries()) {
    const [modelKey, channelKey] = pairKey.split('|');
    const targetModel = keptModelKeys.has(modelKey) ? modelKey : SANKEY_OTHER_MODEL_KEY;
    const targetChannel = keptChannelKeys.has(channelKey) ? channelKey : SANKEY_OTHER_CHANNEL_KEY;
    const linkKey = `${targetModel}|${targetChannel}`;
    const agg = ensureAggregate(linkAggregate, linkKey);
    agg.requests += value.requests;
    agg.successCount += value.successCount;
    agg.failureCount += value.failureCount;
  }

  const links: SankeyLink[] = [...linkAggregate.entries()].map(([key, value]) => {
    const [modelKey, channelKey] = key.split('|');
    const denominator = value.successCount + value.failureCount;
    const successRate = denominator > 0 ? value.successCount / denominator : 1;
    return {
      modelKey,
      channelKey,
      requests: value.requests,
      successCount: value.successCount,
      failureCount: value.failureCount,
      successRate,
    };
  });

  return { models, channels, links };
}
