/**
 * 数据加载 Hook
 * 从 App.tsx 抽离的缓存数据加载逻辑
 */

import Logger from '../utils/logger';
import type { Config } from '../App';
import type { DetectionResult } from '../../shared/types/site';

interface UseDataLoaderOptions {
  setResults: (results: DetectionResult[]) => void;
  setApiKeys: (siteName: string, keys: any[]) => void;
  setUserGroups: (
    siteName: string,
    groups: Record<string, { desc: string; ratio: number }>
  ) => void;
  setModelPricing: (siteName: string, pricing: any) => void;
}

export function useDataLoader({
  setResults,
  setApiKeys,
  setUserGroups,
  setModelPricing,
}: UseDataLoaderOptions) {
  /**
   * 启动时加载缓存的显示数据（从 config.json）
   */
  const loadCachedData = async (currentConfig: Config) => {
    try {
      Logger.info('📂 [useDataLoader] 加载缓存的显示数据...');

      // 从统一配置中获取站点数据
      const sites = currentConfig.sites;
      Logger.info('📊 [useDataLoader] 从 config.json 获取到站点数据:', sites?.length || 0);

      if (sites && sites.length > 0) {
        // 转换为 DetectionResult 格式（使用 cached_data）
        const cachedResults: DetectionResult[] = sites
          .filter((site: any) => !!site.cached_data)
          .map((site: any) => {
            return {
              name: site.name,
              url: site.url,
              status: '成功', // 缓存数据默认显示成功
              error: undefined,
              models: site.cached_data?.models || [],
              balance: site.cached_data?.balance,
              todayUsage: site.cached_data?.today_usage,
              todayPromptTokens: site.cached_data?.today_prompt_tokens,
              todayCompletionTokens: site.cached_data?.today_completion_tokens,
              todayTotalTokens:
                site.cached_data?.today_prompt_tokens !== undefined &&
                site.cached_data?.today_completion_tokens !== undefined
                  ? site.cached_data.today_prompt_tokens + site.cached_data.today_completion_tokens
                  : undefined,
              todayRequests: site.cached_data?.today_requests,
              has_checkin: typeof site.cached_data?.can_check_in === 'boolean',
              can_check_in: site.cached_data?.can_check_in,
              apiKeys: site.cached_data?.api_keys,
              userGroups: site.cached_data?.user_groups,
              modelPricing: site.cached_data?.model_pricing,
              lastRefresh: site.cached_data?.last_refresh,
            };
          });

        Logger.info(`✅ [useDataLoader] 加载了 ${cachedResults.length} 个站点的缓存数据`);
        setResults(cachedResults);

        // 加载扩展数据到 state
        cachedResults.forEach(result => {
          if (result.modelPricing) setModelPricing(result.name, result.modelPricing);
          if (result.apiKeys) setApiKeys(result.name, result.apiKeys);
          if (result.userGroups) setUserGroups(result.name, result.userGroups);
        });
      } else {
        Logger.info('ℹ️ [useDataLoader] config.json 中没有缓存数据');
      }
    } catch (error) {
      Logger.error('❌ [useDataLoader] 加载缓存数据失败:', error);
    }
  };

  return { loadCachedData };
}
