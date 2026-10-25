import { useCallback, useEffect, useRef } from 'react';
import type { Config } from '../../shared/types/renderer-config';
import { useConfigStore } from '../store/configStore';
import { useDetectionStore } from '../store/detectionStore';
import { useCustomCliConfigStore } from '../store/customCliConfigStore';
import { useRouteStore } from '../store/routeStore';
import { useUIStore } from '../store/uiStore';
import { normalizeSiteSortField } from '../utils/siteSort';
import Logger from '../utils/logger';
import { invalidateDataEpoch } from '../services/data-generation';

export function useApplicationData(loadCachedData: (config: Config) => Promise<void>) {
  const setConfig = useConfigStore(state => state.setConfig);
  const setLoading = useConfigStore(state => state.setLoading);
  const setSortField = useUIStore(state => state.setSortField);
  const setSortOrder = useUIStore(state => state.setSortOrder);
  const cachedLoader = useRef(loadCachedData);
  cachedLoader.current = loadCachedData;
  const sequence = useRef(0);
  const initialized = useRef(false);

  const loadConfig = useCallback(
    async (options?: { background?: boolean; restored?: boolean }): Promise<Config | null> => {
      const request = ++sequence.current;
      if (!options?.background) setLoading(true);
      try {
        const cfg = await window.electronAPI.loadConfig();
        if (request !== sequence.current) return null;
        const field = normalizeSiteSortField(cfg.settings?.sort?.field ?? null);
        const normalized = cfg.settings?.sort
          ? { ...cfg, settings: { ...cfg.settings, sort: { ...cfg.settings.sort, field } } }
          : cfg;
        setConfig(normalized);
        if (cfg.settings?.sort) {
          setSortField(field);
          setSortOrder(cfg.settings.sort.order);
        }
        if (!options?.background || options.restored) await cachedLoader.current(normalized);
        return normalized;
      } catch (error) {
        Logger.error('加载配置失败:', error);
        return null;
      } finally {
        if (request === sequence.current && !options?.background) setLoading(false);
      }
    },
    [setConfig, setLoading, setSortField, setSortOrder]
  );

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      void loadConfig();
    }
  }, [loadConfig]);

  useEffect(
    () =>
      window.electronAPI.appData?.onChanged?.(payload => {
        if (payload.restored) {
          invalidateDataEpoch();
          sequence.current++;
          useDetectionStore.setState({
            results: [],
            apiKeys: {},
            userGroups: {},
            modelPricing: {},
            cliConfigs: {},
            cliConfigDetection: null,
            detecting: false,
            detectingSites: new Set(),
            detectingSite: null,
          });
          useConfigStore.getState().setSiteAccounts({});
          useRouteStore.setState({ config: null });
          void useRouteStore.getState().fetchConfig();
          void useCustomCliConfigStore.getState().loadConfigs();
        }
        if (payload.domains.includes('site-config'))
          void loadConfig({ background: true, restored: payload.restored });
      }),
    [loadConfig]
  );

  return { loadConfig };
}
