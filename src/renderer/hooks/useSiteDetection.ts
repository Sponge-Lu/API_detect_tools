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
const isAuthenticationError = (error?: string): boolean => {
  if (!error) return false;
  const codeMatch = error.match(/status code (\d{3})/i);
  if (codeMatch && (codeMatch[1] === '401' || codeMatch[1] === '403')) return true;
  return (
    error.includes('请重新获取 access_token') ||
    error.includes('请检查 access_token') ||
    error.includes('认证失败') ||
    error.includes('权限不足') ||
    error.includes('返回成功但无数据')
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
    detecting,
    setDetecting,
    detectingSite,
    setDetectingSite,
    setApiKeys,
    setUserGroups,
    setModelPricing,
  } = useDetectionStore();

  const { siteAccounts, setSiteAccounts } = useConfigStore();
  const { setRefreshMessage } = useUIStore();

  // 检测单个站点
  const detectSingle = useCallback(
    async (site: SiteConfig, quickRefresh: boolean = true, config?: Config) => {
      if (detectingSite === site.name) {
        Logger.info('⚠️ 站点正在刷新中，请稍候...');
        return;
      }
      setDetectingSite(site.name);

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
        } else {
          const hasChanges = hasSignificantChanges(cachedResult, result);
          setRefreshMessage({
            site: site.name,
            message: hasChanges ? '✅ 数据已更新' : 'ℹ️ 数据无变化',
            type: hasChanges ? 'success' : 'info',
          });
          setTimeout(() => setRefreshMessage(null), 3000);
        }

        const filtered = results.filter(r => r.name !== site.name);
        setResults([...filtered, result]);

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
        setTimeout(() => setRefreshMessage(null), 5000);
      } finally {
        setDetectingSite(null);
      }
    },
    [
      detectingSite,
      results,
      siteAccounts,
      setDetectingSite,
      setResults,
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

            // 需要登录时提示并重试
            if (rawResult.status === '失败' && isAuthenticationError(rawResult.error)) {
              await window.electronAPI.launchChromeForLogin(site.url);
              if (options.showDialog) {
                const confirmed = await options.showDialog({
                  type: 'alert',
                  title: '需要登录',
                  message: `请在打开的浏览器中登录「${site.name}」，登录完成后点击"继续"以获取数据。`,
                  confirmText: '继续',
                  cancelText: '跳过',
                });
                if (confirmed) {
                  rawResult = await execDetect(false);
                } else {
                  upsertAuthError(site, rawResult.error || '');
                }
              } else {
                rawResult = await execDetect(false);
              }
            }
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

        return resultsBuffer;
      } catch (error) {
        Logger.error('检测失败:', error);
        toast.error('检测失败: ' + error);
        return [];
      } finally {
        setDetecting(false);
        setDetectingSite(null);
        // 检测完成后关闭浏览器
        try {
          await window.electronAPI.closeBrowser?.();
          Logger.info('✅ [useSiteDetection] 检测完成，已关闭浏览器');
        } catch (err) {
          Logger.warn('⚠️ [useSiteDetection] 关闭浏览器失败:', err);
        }
      }
    },
    [setDetecting, setDetectingSite, setResults, setSiteAccounts, options]
  );

  return {
    detecting,
    detectingSite,
    results,
    setResults,
    detectSingle,
    detectAllSites,
  };
}
