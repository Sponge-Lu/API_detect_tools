/**
 * 输入: Config (应用配置含 accounts), 缓存数据, IPC 调用
 * 输出: 数据加载方法 (loadCachedData), 自动检测触发
 * 定位: 业务逻辑层 - 管理数据加载和缓存，支持 per-account 缓存、CLI 配置检测、状态持久化
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/hooks/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * 数据加载 Hook
 * 从 App.tsx 抽离的缓存数据加载逻辑
 * 支持启动时自动检测 CLI 配置 (Requirements 6.1)
 * 支持站点检测状态持久化 (Requirements 3.1-3.4)
 * 支持 per-account 缓存加载（多账户隔离）
 */

import { useCallback } from 'react';
import Logger from '../utils/logger';
import type { Config } from '../App';
import type { DetectionResult, DetectionCacheData } from '../../shared/types/site';
import type { CliCompatibilityResult, CliConfig } from '../store/detectionStore';
import type { SiteInfo } from '../../shared/types/config-detection';

/** 生成 per-account 复合 key */
const makeStoreKey = (siteName: string, accountId?: string) =>
  accountId ? `${siteName}::${accountId}` : siteName;

/** 将 DetectionCacheData 转换为 DetectionResult */
function toDetectionResult(
  name: string,
  url: string,
  cache: DetectionCacheData,
  accountId?: string
): DetectionResult {
  return {
    name,
    url,
    accountId,
    status: cache.status || '成功',
    error: cache.error,
    models: cache.models || [],
    balance: cache.balance,
    todayUsage: cache.today_usage,
    todayPromptTokens: cache.today_prompt_tokens,
    todayCompletionTokens: cache.today_completion_tokens,
    todayTotalTokens:
      cache.today_prompt_tokens !== undefined && cache.today_completion_tokens !== undefined
        ? cache.today_prompt_tokens + cache.today_completion_tokens
        : undefined,
    todayRequests: cache.today_requests,
    has_checkin: typeof cache.can_check_in === 'boolean',
    can_check_in: cache.can_check_in,
    apiKeys: cache.api_keys,
    userGroups: cache.user_groups,
    modelPricing: cache.model_pricing,
    lastRefresh: cache.last_refresh,
    ldcPaymentSupported: cache.ldc_payment_supported,
    ldcExchangeRate: cache.ldc_exchange_rate,
    ldcPaymentType: cache.ldc_payment_type,
    checkinStats: cache.checkin_stats
      ? {
          todayQuota: cache.checkin_stats.today_quota,
          checkinCount: cache.checkin_stats.checkin_count,
          totalCheckins: cache.checkin_stats.total_checkins,
          siteType: cache.checkin_stats.site_type,
        }
      : undefined,
  };
}

interface UseDataLoaderOptions {
  setResults: (results: DetectionResult[]) => void;
  setApiKeys: (siteName: string, keys: any[]) => void;
  setUserGroups: (
    siteName: string,
    groups: Record<string, { desc: string; ratio: number }>
  ) => void;
  setModelPricing: (siteName: string, pricing: any) => void;
  setCliCompatibility?: (siteName: string, result: CliCompatibilityResult) => void;
  setCliConfig?: (siteName: string, config: CliConfig) => void;
  /** CLI 配置检测函数 (Requirements 6.1) */
  detectCliConfig?: (sites: SiteInfo[]) => Promise<void>;
}

export function useDataLoader({
  setResults,
  setApiKeys,
  setUserGroups,
  setModelPricing,
  setCliCompatibility,
  setCliConfig,
  detectCliConfig,
}: UseDataLoaderOptions) {
  /**
   * 启动时加载缓存的显示数据（从 config.json）
   */
  const loadCachedData = useCallback(
    async (currentConfig: Config) => {
      try {
        Logger.info('📂 [useDataLoader] 加载缓存的显示数据...');

        const sites = currentConfig.sites;
        const accounts = currentConfig.accounts || [];
        Logger.info(`📊 [useDataLoader] 站点: ${sites?.length || 0}, 账户: ${accounts.length}`);

        if (!sites || sites.length === 0) {
          Logger.info('ℹ️ [useDataLoader] config.json 中没有缓存数据');
          return;
        }

        // 按 site_id 索引账户
        const accountsBySiteId = new Map<string, typeof accounts>();
        for (const acct of accounts) {
          const list = accountsBySiteId.get(acct.site_id) || [];
          list.push(acct);
          accountsBySiteId.set(acct.site_id, list);
        }

        const cachedResults: DetectionResult[] = [];

        for (const site of sites) {
          const siteId = (site as any).id as string | undefined;
          const siteAccounts = siteId ? accountsBySiteId.get(siteId) : undefined;

          if (siteAccounts && siteAccounts.length > 0) {
            // 优先加载账户级缓存
            for (const acct of siteAccounts) {
              if (acct.cached_data) {
                cachedResults.push(
                  toDetectionResult(site.name, site.url, acct.cached_data, acct.id)
                );
              }
            }
          } else if ((site as any).cached_data) {
            // 无账户站点 fallback 到 site.cached_data（legacy）
            cachedResults.push(toDetectionResult(site.name, site.url, (site as any).cached_data));
          }
        }

        Logger.info(`✅ [useDataLoader] 加载了 ${cachedResults.length} 条缓存结果`);
        setResults(cachedResults);

        // 加载扩展数据到 store（按 cardKey 存储）
        for (const result of cachedResults) {
          const key = makeStoreKey(result.name, result.accountId);
          if (result.modelPricing) setModelPricing(key, result.modelPricing);
          if (result.apiKeys) setApiKeys(key, result.apiKeys);
          if (result.userGroups) setUserGroups(key, result.userGroups);
        }

        // 加载 CLI 兼容性数据和配置（站点级，不按账户拆分）
        let cliCompatCount = 0;
        let cliConfigCount = 0;
        sites.forEach((site: any) => {
          const cliCompatibility = site.cached_data?.cli_compatibility || site.cli_compatibility;
          if (setCliCompatibility && cliCompatibility) {
            const isValid =
              typeof cliCompatibility === 'object' &&
              cliCompatibility !== null &&
              ('claudeCode' in cliCompatibility ||
                'codex' in cliCompatibility ||
                'geminiCli' in cliCompatibility);

            if (isValid) {
              const normalizedResult: CliCompatibilityResult = {
                claudeCode:
                  typeof cliCompatibility.claudeCode === 'boolean'
                    ? cliCompatibility.claudeCode
                    : null,
                codex: typeof cliCompatibility.codex === 'boolean' ? cliCompatibility.codex : null,
                codexDetail: cliCompatibility.codexDetail || undefined,
                geminiCli:
                  typeof cliCompatibility.geminiCli === 'boolean'
                    ? cliCompatibility.geminiCli
                    : null,
                geminiDetail: cliCompatibility.geminiDetail || undefined,
                testedAt:
                  typeof cliCompatibility.testedAt === 'number' ? cliCompatibility.testedAt : null,
                error:
                  typeof cliCompatibility.error === 'string' ? cliCompatibility.error : undefined,
              };
              setCliCompatibility(site.name, normalizedResult);
              cliCompatCount++;
            }
          }
          const cliConfig = site.cli_config || site.cached_data?.cli_config;
          if (setCliConfig && cliConfig) {
            setCliConfig(site.name, cliConfig);
            cliConfigCount++;
          }
        });
        if (cliCompatCount > 0) {
          Logger.info(`✅ [useDataLoader] 加载了 ${cliCompatCount} 个站点的 CLI 兼容性数据`);
        }
        if (cliConfigCount > 0) {
          Logger.info(`✅ [useDataLoader] 加载了 ${cliConfigCount} 个站点的 CLI 配置`);
        }

        // 启动时自动检测 CLI 配置（按站点去重）
        if (detectCliConfig) {
          const siteInfos: SiteInfo[] = sites
            .filter((s: any) => s.url && s.enabled)
            .map((s: any) => ({ id: s.name, name: s.name, url: s.url }));

          if (siteInfos.length > 0) {
            Logger.info('🔍 [useDataLoader] 启动时自动检测 CLI 配置...');
            detectCliConfig(siteInfos)
              .then(() => Logger.info('✅ [useDataLoader] CLI 配置自动检测完成'))
              .catch(error => Logger.error('❌ [useDataLoader] CLI 配置自动检测失败:', error));
          }
        }
      } catch (error) {
        Logger.error('❌ [useDataLoader] 加载缓存数据失败:', error);
      }
    },
    [
      setResults,
      setApiKeys,
      setUserGroups,
      setModelPricing,
      setCliCompatibility,
      setCliConfig,
      detectCliConfig,
    ]
  );

  return { loadCachedData };
}
