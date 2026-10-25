import { useEffect, useRef } from 'react';
import { useAutoRefresh, type UseAutoRefreshOptions } from './useAutoRefresh';
import { useConfigStore } from '../store/configStore';
import { useDetectionStore } from '../store/detectionStore';
import { toast } from '../store/toastStore';
import { saveAppConfig } from '../services/config-commands';
import { currentDataEpoch } from '../services/data-generation';
import Logger from '../utils/logger';

export function useManagedAutoRefresh(detectSingle: UseAutoRefreshOptions['detectSingle']): void {
  const { config, setConfig } = useConfigStore();
  const { cliConfigDetection } = useDetectionStore();
  // 自动刷新（全局级，不随 Tab 切换卸载）
  useAutoRefresh({
    sites: config?.sites || [],
    accounts: config?.accounts || [],
    detectSingle,
    enabled: true,
    onRefresh: (siteName: string) => {
      toast.success(`${siteName} 自动刷新完成`);
    },
    onError: (siteName: string, error: Error) => {
      Logger.error(`[AutoRefresh] ${siteName} 刷新失败:`, error);
    },
  });

  // 跟踪上一次 CLI 检测的 managed 站点名
  const prevManagedSitesRef = useRef<Set<string>>(new Set());

  // CLI 检测变化时，同步自动刷新状态
  useEffect(() => {
    if (!cliConfigDetection) return;

    const currentConfig = useConfigStore.getState().config;
    if (!currentConfig) return;

    const managedSiteNames = new Set<string>();
    Object.values(cliConfigDetection).forEach(result => {
      if (result.sourceType === 'managed' && result.siteName) {
        managedSiteNames.add(result.siteName);
      }
    });

    const prevManaged = prevManagedSitesRef.current;

    let hasChanges = false;
    const newSites = currentConfig.sites.map(site => {
      const isManaged = managedSiteNames.has(site.name);
      const wasManaged = prevManaged.has(site.name);

      if (isManaged && !site.auto_refresh) {
        // 新 managed 或之前被关闭的 managed 站点 → 开启
        hasChanges = true;
        return {
          ...site,
          auto_refresh: true,
          auto_refresh_interval: site.auto_refresh_interval ?? 30,
        };
      }
      if (!isManaged && wasManaged && site.auto_refresh) {
        // 不再 managed 的站点 → 关闭
        hasChanges = true;
        return { ...site, auto_refresh: false };
      }
      return site;
    });

    prevManagedSitesRef.current = managedSiteNames;

    if (hasChanges) {
      const newConfig = { ...currentConfig, sites: newSites };
      const epoch = currentDataEpoch();
      saveAppConfig(newConfig)
        .then(() => {
          if (epoch === currentDataEpoch() && useConfigStore.getState().config === currentConfig)
            setConfig(newConfig);
        })
        .catch(err => {
          Logger.error('保存自动刷新配置失败:', err);
          toast.error('自动刷新设置保存失败，请刷新后重试');
        });
    }
  }, [cliConfigDetection, setConfig]);
}
