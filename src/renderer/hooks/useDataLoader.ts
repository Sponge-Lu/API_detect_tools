/**
 * 输入: Config (应用配置), 缓存数据, IPC 调用
 * 输出: 数据加载方法 (loadData, loadCachedData), 加载状态, 自动检测触发
 * 定位: 业务逻辑层 - 管理数据加载和缓存，支持启动时自动检测 CLI 配置
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
 */

import { useCallback } from 'react';
import Logger from '../utils/logger';
import type { Config } from '../App';
import type { DetectionResult } from '../../shared/types/site';
import type { CliCompatibilityResult, CliConfig } from '../store/detectionStore';
import type { SiteInfo } from '../../shared/types/config-detection';

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
                    ? site.cached_data.today_prompt_tokens +
                      site.cached_data.today_completion_tokens
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

          // 加载 CLI 兼容性数据和配置（遍历所有站点，不仅仅是有 cached_data 的站点）
          let cliCompatCount = 0;
          let cliConfigCount = 0;
          sites.forEach((site: any) => {
            // CLI 兼容性结果：优先从 cached_data 加载，兼容从站点根级别加载
            const cliCompatibility = site.cached_data?.cli_compatibility || site.cli_compatibility;
            if (setCliCompatibility && cliCompatibility) {
              // 验证 CLI 兼容性数据格式是否有效
              const isValidCliCompatibility =
                typeof cliCompatibility === 'object' &&
                cliCompatibility !== null &&
                ('claudeCode' in cliCompatibility ||
                  'codex' in cliCompatibility ||
                  'geminiCli' in cliCompatibility);

              if (isValidCliCompatibility) {
                // 确保所有字段都有默认值，处理部分损坏的数据
                const normalizedResult: CliCompatibilityResult = {
                  claudeCode:
                    typeof cliCompatibility.claudeCode === 'boolean'
                      ? cliCompatibility.claudeCode
                      : null,
                  codex:
                    typeof cliCompatibility.codex === 'boolean' ? cliCompatibility.codex : null,
                  codexDetail: cliCompatibility.codexDetail || undefined, // 加载 Codex 详细测试结果
                  geminiCli:
                    typeof cliCompatibility.geminiCli === 'boolean'
                      ? cliCompatibility.geminiCli
                      : null,
                  geminiDetail: cliCompatibility.geminiDetail || undefined, // 加载 Gemini CLI 详细测试结果
                  testedAt:
                    typeof cliCompatibility.testedAt === 'number'
                      ? cliCompatibility.testedAt
                      : null,
                  error:
                    typeof cliCompatibility.error === 'string' ? cliCompatibility.error : undefined,
                };
                setCliCompatibility(site.name, normalizedResult);
                cliCompatCount++;
                Logger.info(`📋 [useDataLoader] 加载 ${site.name} 的 CLI 兼容性数据`);
              } else {
                Logger.warn(
                  `⚠️ [useDataLoader] ${site.name} 的 CLI 兼容性数据格式无效，将视为未测试状态`
                );
              }
            }
            // CLI 配置：优先从站点根级别加载，兼容从 cached_data 加载（旧版本数据）
            const cliConfig = site.cli_config || site.cached_data?.cli_config;
            if (setCliConfig && cliConfig) {
              setCliConfig(site.name, cliConfig);
              cliConfigCount++;
              Logger.info(`📋 [useDataLoader] 加载 ${site.name} 的 CLI 配置`);
            }
          });
          if (cliCompatCount > 0) {
            Logger.info(`✅ [useDataLoader] 加载了 ${cliCompatCount} 个站点的 CLI 兼容性数据`);
          }
          if (cliConfigCount > 0) {
            Logger.info(`✅ [useDataLoader] 加载了 ${cliConfigCount} 个站点的 CLI 配置`);
          }

          // 启动时自动检测 CLI 配置 (Requirements 6.1)
          if (detectCliConfig) {
            // 从缓存结果中提取站点信息用于匹配
            const siteInfos: SiteInfo[] = cachedResults
              .filter(r => r.url)
              .map(r => ({
                id: r.name,
                name: r.name,
                url: r.url!,
              }));

            if (siteInfos.length > 0) {
              Logger.info('🔍 [useDataLoader] 启动时自动检测 CLI 配置...');
              // 异步执行检测，不阻塞启动流程
              detectCliConfig(siteInfos)
                .then(() => {
                  Logger.info('✅ [useDataLoader] CLI 配置自动检测完成');
                })
                .catch(error => {
                  Logger.error('❌ [useDataLoader] CLI 配置自动检测失败:', error);
                });
            }
          }
        } else {
          Logger.info('ℹ️ [useDataLoader] config.json 中没有缓存数据');
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
