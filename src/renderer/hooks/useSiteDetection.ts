/**
 * 输入: DetectionStore (检测状态), ConfigStore (配置), UIStore (刷新消息), IPC 调用
 * 输出: 检测方法 (detectSingle, detectAllSites), 检测状态 (detectingSites Set)
 * 定位: 业务逻辑层 - 管理站点检测操作和结果处理
 *
 * 并发安全: 使用 detectingSites (Set) 独立跟踪每个站点的刷新状态；
 * refreshMessage 的 setTimeout 清除前检查站点名匹配，避免误清其他站点消息
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/hooks/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * 站点检测 Hook
 * 封装站点检测相关的业务逻辑
 */

import { useCallback } from 'react';
import Logger from '../utils/logger';
import { useDetectionStore } from '../store/detectionStore';
import { useConfigStore } from '../store/configStore';
import { useUIStore } from '../store/uiStore';
import { toast } from '../store/toastStore';
import type { Config, DetectionResult, SiteConfig } from '../App';
import type { DialogState } from '../components/ConfirmDialog';

interface UseSiteDetectionOptions {
  onAuthError?: (sites: { name: string; url: string; error: string }[]) => void;
  showDialog?: (options: Partial<DialogState> & { message: string }) => Promise<boolean>;
}

// 检测错误是否为认证/权限错误
// 注意：仅 401/403 状态码或明确的登录/认证失败提示才算认证错误
// 404 等其他错误不应该触发认证错误处理流程
const isAuthenticationError = (error?: string): boolean => {
  if (!error) return false;

  // 1. 检测 HTTP 状态码：只有 401/403 算认证错误
  const codeMatch = error.match(/status code (\d{3})/i);
  if (codeMatch) {
    const statusCode = codeMatch[1];
    // 404 等非认证相关状态码直接返回 false
    if (statusCode !== '401' && statusCode !== '403') {
      return false;
    }
    // 401/403 是认证错误
    return true;
  }

  // 2. 检测明确的认证相关错误提示（匹配后端更新后的错误信息）
  return (
    // 新错误信息（后端已更新）
    error.includes('登录已过期') ||
    error.includes('登录可能已过期') ||
    error.includes('登录站点') ||
    error.includes('未登录') ||
    error.includes('请检查账号状态') ||
    // 旧错误信息（兼容性保留）
    error.includes('请重新获取 access_token') ||
    error.includes('认证失败') ||
    // 注意：单独的"权限不足"可能是业务权限问题，不一定需要重新登录
    // 只有明确包含登录相关提示时才算认证错误
    (error.includes('权限不足') && (error.includes('登录') || error.includes('凭证')))
  );
};

// 比较两个检测结果是否有实质性变化
const hasSignificantChanges = (
  oldResult: DetectionResult | undefined,
  newResult: DetectionResult
): boolean => {
  if (!oldResult) return true;
  return (
    oldResult.status !== newResult.status ||
    oldResult.balance !== newResult.balance ||
    oldResult.todayUsage !== newResult.todayUsage ||
    oldResult.models.length !== newResult.models.length ||
    JSON.stringify(oldResult.apiKeys) !== JSON.stringify(newResult.apiKeys)
  );
};

export function useSiteDetection(options: UseSiteDetectionOptions = {}) {
  const {
    results,
    setResults,
    upsertResult,
    detecting,
    setDetecting,
    detectingSite,
    detectingSites,
    setDetectingSite,
    addDetectingSite,
    removeDetectingSite,
    isDetectingSite,
    setApiKeys,
    setUserGroups,
    setModelPricing,
  } = useDetectionStore();

  const { siteAccounts, setSiteAccounts } = useConfigStore();
  const { setRefreshMessage } = useUIStore();

  // 检测单个站点
  const detectSingle = useCallback(
    async (site: SiteConfig, quickRefresh: boolean = true, config?: Config) => {
      // 使用 store 的方法检查，支持多站点并发
      if (isDetectingSite(site.name)) {
        Logger.info('⚠️ 站点正在刷新中，请稍候...');
        return;
      }
      addDetectingSite(site.name);

      try {
        const existingResult = results.find(r => r.name === site.name);
        const cachedResult = quickRefresh ? existingResult : undefined;
        const timeout = config?.settings?.timeout ?? 30;

        const rawResult = await window.electronAPI.detectSite(
          site,
          timeout,
          quickRefresh,
          cachedResult
        );

        const result: DetectionResult =
          rawResult.status === '失败' && existingResult
            ? { ...existingResult, status: rawResult.status, error: rawResult.error }
            : rawResult;

        if (rawResult.status === '失败' && isAuthenticationError(rawResult.error)) {
          options.onAuthError?.([{ name: site.name, url: site.url, error: rawResult.error || '' }]);
        } else if (rawResult.status === '失败') {
          toast.error(`${site.name} 连接失败: ${rawResult.error || '未知错误'}`);
        } else {
          const hasChanges = hasSignificantChanges(cachedResult, result);
          setRefreshMessage({
            site: site.name,
            message: hasChanges ? '✅ 数据已更新' : 'ℹ️ 数据无变化',
            type: hasChanges ? 'success' : 'info',
          });
          setTimeout(() => {
            if (useUIStore.getState().refreshMessage?.site === site.name) {
              setRefreshMessage(null);
            }
          }, 3000);
        }

        // 使用 upsertResult 安全地更新结果，避免并发刷新时的覆盖问题
        upsertResult(result);

        if (rawResult.status === '成功') {
          const acc = siteAccounts[site.name];
          if (acc) {
            setSiteAccounts({
              ...siteAccounts,
              [site.name]: { ...acc, last_sync_time: Date.now() },
            });
          }
          if (rawResult.apiKeys) setApiKeys(site.name, rawResult.apiKeys);
          if (rawResult.userGroups) setUserGroups(site.name, rawResult.userGroups);
          if (rawResult.modelPricing) {
            Logger.info(
              `💾 [useSiteDetection] 保存 ${site.name} 的定价数据，模型数: ${rawResult.modelPricing?.data ? Object.keys(rawResult.modelPricing.data).length : 0}`
            );
            setModelPricing(site.name, rawResult.modelPricing);
          }
        }

        return result;
      } catch (error: any) {
        Logger.error('检测失败:', error);
        const errorMessage = error?.message || String(error);
        let displayMessage = '❌ 刷新失败: ' + errorMessage;
        if (
          errorMessage.includes('浏览器已关闭') ||
          errorMessage.includes('操作已取消') ||
          errorMessage.includes('操作已被取消')
        ) {
          displayMessage = '⚠️ 浏览器已关闭，操作已取消。请重新打开浏览器后重试。';
        }
        setRefreshMessage({ site: site.name, message: displayMessage, type: 'info' });
        setTimeout(() => {
          if (useUIStore.getState().refreshMessage?.site === site.name) {
            setRefreshMessage(null);
          }
        }, 5000);
      } finally {
        removeDetectingSite(site.name);
      }
    },
    [
      results,
      siteAccounts,
      isDetectingSite,
      addDetectingSite,
      removeDetectingSite,
      upsertResult,
      setSiteAccounts,
      setApiKeys,
      setUserGroups,
      setModelPricing,
      setRefreshMessage,
      options,
    ]
  );

  // 检测所有站点
  const detectAllSites = useCallback(
    async (config: Config) => {
      const enabledSites = config.sites.filter(s => s.enabled);
      if (enabledSites.length === 0) return [];

      setDetecting(true);

      try {
        const timeoutSeconds = config.settings?.timeout ?? 30;
        const maxConcurrent = Math.min(
          5,
          Math.max(1, config.settings?.max_concurrent ?? (config.settings?.concurrent ? 3 : 1))
        );
        const workerCount = config.settings?.concurrent
          ? Math.min(maxConcurrent, enabledSites.length)
          : 1;

        let cursor = 0;
        const resultsBuffer: DetectionResult[] = [];
        const authErrors: { name: string; url: string; error: string }[] = [];
        let aborted = false;
        const interruptedSites: { name: string; error: string }[] = [];
        const upsertAuthError = (site: SiteConfig, error: string) => {
          const idx = authErrors.findIndex(a => a.name === site.name);
          if (idx >= 0) {
            authErrors[idx] = { ...authErrors[idx], error };
          } else {
            authErrors.push({ name: site.name, url: site.url, error });
          }
        };

        const runForSite = async (site: SiteConfig) => {
          const currentResults = useDetectionStore.getState().results;
          const existingResult = currentResults.find(r => r.name === site.name);
          const cachedResult = existingResult;

          const execDetect = async (quickRefresh: boolean) =>
            await window.electronAPI.detectSite(site, timeoutSeconds, quickRefresh, cachedResult);

          let rawResult: any;
          try {
            setDetectingSite(site.name);
            rawResult = await execDetect(true);
            // 认证错误不再立即弹窗，只收集错误，最后统一提醒
          } catch (error: any) {
            rawResult = {
              name: site.name,
              url: site.url,
              status: '失败',
              error: error?.message || String(error),
              models: [],
              balance: '-',
              todayUsage: '-',
              apiKeys: [],
            };
          } finally {
            setDetectingSite(null);
          }

          const result: DetectionResult =
            rawResult.status === '失败' && existingResult
              ? { ...existingResult, status: rawResult.status, error: rawResult.error }
              : rawResult;

          if (rawResult.status === '失败' && isAuthenticationError(rawResult.error)) {
            upsertAuthError(site, rawResult.error || '');
          } else if (rawResult.status === '失败') {
            interruptedSites.push({ name: site.name, error: rawResult.error || '未知错误' });
            aborted = true;
          }

          // 即时更新前端结果
          const latest = useDetectionStore.getState().results;
          const filtered = latest.filter(r => r.name !== site.name);
          setResults([...filtered, result]);

          // 更新时间戳
          if (result.status === '成功') {
            const latestAccounts = useConfigStore.getState().siteAccounts;
            if (latestAccounts[site.name]) {
              setSiteAccounts({
                ...latestAccounts,
                [site.name]: { ...latestAccounts[site.name], last_sync_time: Date.now() },
              });
            }
          }

          return result;
        };

        const worker = async () => {
          while (true) {
            if (aborted) break;
            const index = cursor++;
            if (index >= enabledSites.length) break;
            const site = enabledSites[index];
            const res = await runForSite(site);
            resultsBuffer[index] = res;
          }
        };

        await Promise.all(Array.from({ length: workerCount }, () => worker()));

        if (authErrors.length > 0) {
          options.onAuthError?.(authErrors);
        }

        // 连接失败提醒
        if (interruptedSites.length > 0) {
          const siteList = interruptedSites.map(s => `• ${s.name}：${s.error}`).join('\n');
          toast.error(`检测中断，以下站点连接失败：\n${siteList}`);
          options.showDialog?.({
            type: 'warning',
            title: '检测中断',
            message: `以下站点连接失败，已中断后续检测：\n\n${siteList}`,
            confirmText: '知道了',
          });
        }

        return resultsBuffer;
      } catch (error) {
        Logger.error('检测失败:', error);
        toast.error('检测失败: ' + error);
        return [];
      } finally {
        setDetecting(false);
        setDetectingSite(null);
        // 检测完成后关闭浏览器（如果有站点开启了自动刷新则保持浏览器开启）
        const hasAutoRefreshSite = config.sites.some(s => s.enabled && s.auto_refresh);
        if (hasAutoRefreshSite) {
          Logger.info('ℹ️ [useSiteDetection] 检测完成，有站点开启自动刷新，保持浏览器开启');
        } else {
          try {
            await window.electronAPI.closeBrowser?.();
            Logger.info('✅ [useSiteDetection] 检测完成，已关闭浏览器');
          } catch (err) {
            Logger.warn('⚠️ [useSiteDetection] 关闭浏览器失败:', err);
          }
        }
      }
    },
    [setDetecting, setDetectingSite, setResults, setSiteAccounts, options]
  );

  return {
    detecting,
    detectingSite,
    detectingSites,
    results,
    setResults,
    detectSingle,
    detectAllSites,
  };
}
