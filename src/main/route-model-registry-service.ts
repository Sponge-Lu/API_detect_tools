/**
 * 模型注册表服务
 * 输入: UnifiedConfig (站点/账户 cached_data.models), 人工覆盖规则
 * 输出: canonical 模型映射表, 厂商分类, 原始↔canonical 双向解析
 * 定位: 服务层 - 扫描所有站点模型 → 厂商分类 → 映射表管理
 */

import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';
import type {
  RouteModelVendor,
  RouteModelSourceRef,
  RouteModelMappingOverride,
  RouteModelRegistryEntry,
  RouteModelRegistryConfig,
  RouteCliType,
} from '../shared/types/route-proxy';
import { VENDOR_MATCH_RULES } from '../shared/types/route-proxy';

const log = Logger.scope('RouteModelRegistry');

/** 按前缀+关键词两阶段推断厂商 */
export function inferVendorFromModel(model: string): RouteModelVendor {
  const name = model.toLowerCase();
  // 阶段 1: 前缀匹配（高置信度）
  for (const { vendor, prefixes } of VENDOR_MATCH_RULES) {
    if (prefixes.some(p => p.test(name))) return vendor;
  }
  // 阶段 2: 关键词匹配（兜底，如 zai-glm-4-6 → glm）
  for (const { vendor, keywords } of VENDOR_MATCH_RULES) {
    if (keywords.some(k => k.test(name))) return vendor;
  }
  return 'unknown';
}

/**
 * 归一化模型名称为 canonical 形式
 * 规则：
 * 1. 去除 provider/ 前缀（如 "anthropic/claude-..."）
 * 2. 统一分隔符：. → -
 * 3. 去除末尾日期戳（如 -20251001, -20250219）
 * 4. 去除末尾 @版本 后缀（如 @2025-01-01）
 * 5. 去除末尾 :latest 等标签
 * 6. 统一版本号格式（4.5 → 4-5, 3.5 → 3-5）
 * 7. 规范化名称段顺序（把散落的版本号收拢）
 *
 * 示例:
 *   claude-haiku-4-5-20251001 → claude-haiku-4-5
 *   claude-haiku-4.5          → claude-haiku-4-5
 *   claude-4.5-haiku          → claude-4-5-haiku (保留原始段序)
 *   gpt-4o-mini-2024-07-18   → gpt-4o-mini
 *   deepseek/deepseek-chat    → deepseek-chat
 */
export function buildCanonicalName(rawModel: string, _vendor: RouteModelVendor): string {
  let name = rawModel;

  // 1. 去除 provider/ 前缀
  name = name.replace(/^[^/]+\//, '');

  // 2. 去除 @version 后缀
  name = name.replace(/@[\w.-]+$/, '');

  // 3. 去除 :tag 后缀 (如 :latest, :free)
  name = name.replace(/:[\w.-]+$/, '');

  // 4. 统一分隔符: 把 '.' 在版本号上下文中替换为 '-'
  //    匹配模式: 数字.数字 → 数字-数字
  name = name.replace(/(\d)\.(\d)/g, '$1-$2');

  // 5. 去除末尾日期戳 (8位连续数字，如 20251001, 20240718)
  name = name.replace(/-(\d{8})$/, '');

  // 6. 去除末尾完整日期 (如 -2024-07-18)
  name = name.replace(/-\d{4}-\d{2}-\d{2}$/, '');

  // 7. 转小写统一
  name = name.toLowerCase();

  // 8. 去除多余连字符
  name = name.replace(/-+/g, '-').replace(/^-|-$/g, '');

  return name;
}

/** 生成 source key */
function buildSourceKey(
  siteId: string,
  accountId: string | undefined,
  originalModel: string
): string {
  return `${siteId}:${accountId || 'site'}:${originalModel}`;
}

/**
 * 扫描所有站点/账户 cached_data.models 重建 registry
 */
export async function rebuildModelRegistry(force?: boolean): Promise<RouteModelRegistryConfig> {
  const config = unifiedConfigManager.exportConfigSync();
  if (!config) throw new Error('Config not loaded');

  const routing = unifiedConfigManager.getRoutingConfig();
  const existing = routing.modelRegistry;

  // 非强制模式且最近 5 分钟内已聚合，跳过
  if (
    !force &&
    existing.lastAggregatedAt &&
    Date.now() - existing.lastAggregatedAt < 5 * 60 * 1000
  ) {
    return existing;
  }

  const now = Date.now();
  const entries: Record<string, RouteModelRegistryEntry> = {};
  const overrides = existing.overrides; // 保留人工覆盖

  // 构建 sourceKey -> override 索引
  const overrideBySource = new Map<string, RouteModelMappingOverride>();
  for (const o of overrides) {
    overrideBySource.set(o.sourceKey, o);
  }

  const { sites, accounts } = config;

  // 收集所有模型来源
  for (const site of sites) {
    // 账户级模型
    const siteAccounts = accounts.filter(a => a.site_id === site.id && a.status === 'active');
    for (const account of siteAccounts) {
      const models = account.cached_data?.models || [];
      const apiKeyGroups = (account.cached_data?.api_keys || [])
        .map(k => k.group)
        .filter((g): g is string => !!g);
      const userGroupKeys = Object.keys(account.cached_data?.user_groups || {});

      for (const model of models) {
        processModelSource(entries, overrideBySource, {
          siteId: site.id,
          siteName: site.name,
          accountId: account.id,
          accountName: account.account_name,
          sourceType: 'account',
          originalModel: model,
          apiKeyGroups: [...new Set(apiKeyGroups)],
          userGroupKeys,
          now,
        });
      }
    }

    // 站点级 fallback（无账户时）
    if (siteAccounts.length === 0 && site.cached_data?.models) {
      for (const model of site.cached_data.models) {
        processModelSource(entries, overrideBySource, {
          siteId: site.id,
          siteName: site.name,
          sourceType: 'site',
          originalModel: model,
          now,
        });
      }
    }
  }

  const registry: RouteModelRegistryConfig = {
    version: 1,
    entries,
    overrides,
    lastAggregatedAt: now,
  };

  await unifiedConfigManager.updateRouteModelRegistry(registry);
  log.info(`Model registry rebuilt: ${Object.keys(entries).length} canonical models`);
  return registry;
}

function processModelSource(
  entries: Record<string, RouteModelRegistryEntry>,
  overrideBySource: Map<string, RouteModelMappingOverride>,
  params: {
    siteId: string;
    siteName: string;
    accountId?: string;
    accountName?: string;
    sourceType: 'account' | 'site';
    originalModel: string;
    apiKeyGroups?: string[];
    userGroupKeys?: string[];
    now: number;
  }
): void {
  const {
    siteId,
    siteName,
    accountId,
    accountName,
    sourceType,
    originalModel,
    apiKeyGroups,
    userGroupKeys,
    now,
  } = params;
  const sourceKey = buildSourceKey(siteId, accountId, originalModel);
  const override = overrideBySource.get(sourceKey);

  // exclude 操作：跳过此来源
  if (override?.action === 'exclude') return;

  const vendor = inferVendorFromModel(originalModel);
  let canonicalName: string;

  if (override?.action === 'pin' || override?.action === 'rename') {
    canonicalName = override.canonicalName;
  } else {
    canonicalName = buildCanonicalName(originalModel, vendor);
  }

  const source: RouteModelSourceRef = {
    sourceKey,
    siteId,
    siteName,
    accountId,
    accountName,
    sourceType,
    originalModel,
    vendor,
    apiKeyGroups,
    userGroupKeys,
    firstSeenAt: now,
    lastSeenAt: now,
  };

  if (!entries[canonicalName]) {
    entries[canonicalName] = {
      canonicalName,
      vendor,
      aliases: [originalModel],
      sources: [source],
      hasOverride: !!override,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    const entry = entries[canonicalName];
    if (!entry.aliases.includes(originalModel)) {
      entry.aliases.push(originalModel);
    }
    // 去重 source
    if (!entry.sources.some(s => s.sourceKey === sourceKey)) {
      entry.sources.push(source);
    }
    if (override) entry.hasOverride = true;
    entry.updatedAt = now;
  }
}

/** 获取当前 registry */
export function getModelRegistry(): RouteModelRegistryConfig {
  return unifiedConfigManager.getRoutingConfig().modelRegistry;
}

/** 按厂商过滤 registry 条目 */
export function listModelRegistryEntries(vendor?: RouteModelVendor): RouteModelRegistryEntry[] {
  const { entries } = getModelRegistry();
  const list = Object.values(entries);
  if (!vendor) return list;
  return list.filter(e => e.vendor === vendor);
}

/** 将原始模型名解析为 canonical 名称 */
export function resolveCanonicalName(params: {
  rawModel: string;
  siteId: string;
  accountId?: string;
}): string {
  const { rawModel, siteId, accountId } = params;
  const registry = getModelRegistry();

  // 1. 检查人工覆盖
  const sourceKey = buildSourceKey(siteId, accountId, rawModel);
  const override = registry.overrides.find(o => o.sourceKey === sourceKey);
  if (override?.action === 'pin' || override?.action === 'rename') {
    return override.canonicalName;
  }

  // 2. 在 registry entries 中查找
  for (const entry of Object.values(registry.entries)) {
    if (entry.aliases.includes(rawModel)) {
      // 检查是否来自同一站点/账户
      const matched = entry.sources.some(
        s =>
          s.siteId === siteId &&
          (!accountId || s.accountId === accountId) &&
          s.originalModel === rawModel
      );
      if (matched) return entry.canonicalName;
    }
  }

  // 3. Fallback: 自动生成
  const vendor = inferVendorFromModel(rawModel);
  return buildCanonicalName(rawModel, vendor);
}

/** 为通道解析实际应发给上游的原始模型名 */
export function resolveRawModelForChannel(params: {
  canonicalName: string;
  siteId: string;
  accountId: string;
  cliType: RouteCliType;
}): string | null {
  const { canonicalName, siteId, accountId } = params;
  const registry = getModelRegistry();
  const entry = registry.entries[canonicalName];
  if (!entry) return null;

  // 优先匹配同站点同账户的来源
  const exactMatch = entry.sources.find(s => s.siteId === siteId && s.accountId === accountId);
  if (exactMatch) return exactMatch.originalModel;

  // 次优：同站点任意账户
  const siteMatch = entry.sources.find(s => s.siteId === siteId);
  if (siteMatch) return siteMatch.originalModel;

  // 最后 fallback：canonical 本身（可能上游能识别）
  return canonicalName;
}

/** 新增/更新人工覆盖 */
export async function upsertModelMappingOverride(
  override: RouteModelMappingOverride
): Promise<RouteModelMappingOverride> {
  return unifiedConfigManager.upsertRouteModelMappingOverride(override);
}

/** 删除人工覆盖 */
export async function deleteModelMappingOverride(overrideId: string): Promise<boolean> {
  return unifiedConfigManager.deleteRouteModelMappingOverride(overrideId);
}
