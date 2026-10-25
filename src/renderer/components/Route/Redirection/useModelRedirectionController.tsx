import {
  RedirectEditorDraft,
  DisplayItemDetailState,
  RouteRuntimeRuleDraft,
  DetailMissingApiKeyHint,
  DetailSiteGroup,
  PriorityDraft,
  PriorityHitRoutePath,
  createLocalId,
  getErrorMessage,
  buildPrioritySessionDots,
  countActiveRoutePathStatesForItem,
  upsertFirstHitPathLog,
  buildFirstHitPathLogsByCanonicalName,
  getPriorityHitRoutePathFromState,
  getPriorityHitApiKeyKeyFromRouteLog,
  getPriorityHitApiKeyKey,
  getPriorityHitRoutePathFromLog,
  getPriorityHitRoutePathResetParams,
  normalizePriorityKeyList,
  isPrioritySiteDisabled,
  isPriorityApiKeyDisabled,
  getEnabledPriorityApiKeys,
  canSortPrioritySite,
  sortDetailGroupsByPriority,
  buildSequentialPriorityDraft,
  serializePriorityConfig,
  priorityDraftMatches,
  createDisplayOrderPriorityDraft,
  moveArrayItem,
  getRegistrySourcePool,
  normalizeOriginalModelOrder,
  buildRedirectCandidateGroups,
  buildDisplayItemViews,
  shouldRefreshRegistrySourceDetails,
  buildDetailSiteAccountGroups,
  buildSiteOnlySourceNotices,
  createEmptyDraft,
  createEmptyPriorityDraft,
  createRouteRuntimeRuleDraft,
  createDefaultNewApiKeyForm,
} from './model-redirection-view';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useShallow } from 'zustand/shallow';
import { useCustomCliConfigStore } from '../../../store/customCliConfigStore';
import { useRouteStore } from '../../../store/routeStore';
import { toast } from '../../../store/toastStore';
import { AppButton } from '../../AppButton/AppButton';

import {
  collectRouteOriginalModels,
  getRouteModelKey,
  type RouteModelCandidate,
} from '../../../../shared/utils/routeModelGrouping';
import { type NewApiTokenForm } from '../../CreateApiKeyDialog/CreateApiKeyDialog';
import {
  DEFAULT_NEW_ROUTE_RUNTIME_CONFIG,
  inferRouteModelVendor,
  normalizeRouteRuntimeConfig,
} from '../../../../shared/types/route-proxy';
import type {
  RouteModelDisplayItem,
  RouteModelMappingOverride,
  RouteModelRegistryConfig,
  RouteModelRegistryEntry,
  RouteRequestLogItem,
} from '../../../../shared/types/route-proxy';
import type { SiteConfig, UnifiedConfig } from '../../../../shared/types/site';
import { buildRouteSessionOrdinals } from '../../../utils/routeSessionOrdinal';
import {
  RedirectEditorContext,
  RedirectEditorErrors,
  RouteRuntimeRuleState,
  RouteRuntimeRuleErrors,
  CreateApiKeyDialogState,
  QUOTA_CONVERSION_FACTOR,
  PRIORITY_RUNTIME_REFRESH_INTERVAL_MS,
  PRIORITY_ROUTE_LOG_LIMIT,
  ModelRedirectionTabProps,
} from './ModelRedirectionParts';
export function useModelRedirectionController({
  isActive = true,
  className = '',
  setPageHeaderActions,
}: ModelRedirectionTabProps = {}) {
  const customCliConfigs = useCustomCliConfigStore(state => state.configs);
  const {
    config,
    refreshRuntimeState,
    syncModelRegistrySources,
    upsertMappingOverride,
    upsertDisplayItem,
    deleteDisplayItem,
    deleteMappingOverride,
    resetPathStates,
  } = useRouteStore(
    useShallow(store => ({
      config: store.config,
      refreshRuntimeState: store.refreshRuntimeState,
      syncModelRegistrySources: store.syncModelRegistrySources,
      upsertMappingOverride: store.upsertMappingOverride,
      upsertDisplayItem: store.upsertDisplayItem,
      deleteDisplayItem: store.deleteDisplayItem,
      deleteMappingOverride: store.deleteMappingOverride,
      resetPathStates: store.resetPathStates,
    }))
  );
  const [syncingSources, setSyncingSources] = useState(false);
  const [refreshingMetadata, setRefreshingMetadata] = useState(false);
  const [resettingPathCanonicalName, setResettingPathCanonicalName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [selectedDisplayItemId, setSelectedDisplayItemId] = useState<string | null>(null);
  const [editorContext, setEditorContext] = useState<RedirectEditorContext | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    displayItemId: string;
    displayName: string;
  } | null>(null);
  const [sourceDetailState, setSourceDetailState] = useState<DisplayItemDetailState | null>(null);
  const [priorityDraft, setPriorityDraft] = useState<PriorityDraft>({
    sitePriorities: {},
    apiKeyPriorities: {},
    disabledSiteIds: [],
    disabledApiKeyPriorityKeys: [],
  });
  const [selectedPrioritySiteId, setSelectedPrioritySiteId] = useState<string | null>(null);
  const [selectedSessionInstanceId, setSelectedSessionInstanceId] = useState<string | null>(null);
  const [expandedMissingKeySiteIds, setExpandedMissingKeySiteIds] = useState<
    Record<string, boolean>
  >({});
  const [foldedPrioritySitesExpanded, setFoldedPrioritySitesExpanded] = useState(false);
  const [draft, setDraft] = useState<RedirectEditorDraft>(createEmptyDraft);
  const [errors, setErrors] = useState<RedirectEditorErrors>({});
  const [candidateQuery, setCandidateQuery] = useState('');
  const [priorityDetailConfig, setPriorityDetailConfig] = useState<UnifiedConfig | null>(null);
  const [routeRuleState, setRouteRuleState] = useState<RouteRuntimeRuleState | null>(null);
  const [routeRuleDraft, setRouteRuleDraft] = useState<RouteRuntimeRuleDraft>(() =>
    createRouteRuntimeRuleDraft()
  );
  const [routeRuleErrors, setRouteRuleErrors] = useState<RouteRuntimeRuleErrors>({});
  const [createApiKeyState, setCreateApiKeyState] = useState<CreateApiKeyDialogState | null>(null);
  const [newApiKeyForm, setNewApiKeyForm] = useState<NewApiTokenForm>(() =>
    createDefaultNewApiKeyForm()
  );
  const [creatingApiKey, setCreatingApiKey] = useState(false);
  const [firstHitPathLogsByCanonicalName, setFirstHitPathLogsByCanonicalName] = useState<
    Record<string, RouteRequestLogItem>
  >({});
  const sourceDetailStateRef = useRef(sourceDetailState);
  const registryRef = useRef(config?.modelRegistry);
  const requestLogsGenerationRef = useRef(0);
  const localPriorityInvalidationCutoffsRef = useRef<Record<string, number>>({});
  const savingPriorityRef = useRef(false);
  const pendingPrioritySaveRef = useRef<{
    draft: PriorityDraft;
    groups: DetailSiteGroup[];
  } | null>(null);
  const redirectNameInputId = useId();
  const searchInputId = useId();

  sourceDetailStateRef.current = sourceDetailState;
  registryRef.current = config?.modelRegistry;

  const registry = config?.modelRegistry;
  const displayItems = useMemo(() => buildDisplayItemViews(registry), [registry]);
  const selectedDisplayItem = useMemo(() => {
    if (displayItems.length === 0) {
      return null;
    }

    return (
      displayItems.find(displayItem => displayItem.item.id === selectedDisplayItemId) ??
      displayItems[0] ??
      null
    );
  }, [displayItems, selectedDisplayItemId]);
  const candidateGroups = useMemo(
    () => (registry ? buildRedirectCandidateGroups(getRegistrySourcePool(registry)) : []),
    [registry]
  );
  const shouldAutoRefreshSourceDetails = useMemo(
    () => shouldRefreshRegistrySourceDetails(registry),
    [registry]
  );
  const overrideBySource = useMemo(
    () =>
      new Map<string, RouteModelMappingOverride>(
        (registry?.overrides ?? []).map(override => [override.sourceKey, override])
      ),
    [registry?.overrides]
  );
  const detailSiteGroups = useMemo(
    () => buildDetailSiteAccountGroups(sourceDetailState, priorityDetailConfig, customCliConfigs),
    [customCliConfigs, priorityDetailConfig, sourceDetailState]
  );
  const sortedDetailSiteGroups = useMemo(() => {
    return sortDetailGroupsByPriority(detailSiteGroups, priorityDraft);
  }, [detailSiteGroups, priorityDraft]);
  const siteOnlySourceNotices = useMemo(
    () => buildSiteOnlySourceNotices(sourceDetailState),
    [sourceDetailState]
  );

  useEffect(() => {
    const nextSelectedId = selectedDisplayItem?.item.id ?? null;
    if (selectedDisplayItemId !== nextSelectedId) {
      setSelectedDisplayItemId(nextSelectedId);
    }
  }, [selectedDisplayItem, selectedDisplayItemId]);

  useEffect(() => {
    if (!sourceDetailState || detailSiteGroups.length === 0) {
      return;
    }

    const normalizedDraft = buildSequentialPriorityDraft(sortedDetailSiteGroups, priorityDraft);

    if (!priorityDraftMatches(normalizedDraft, priorityDraft)) {
      setPriorityDraft(normalizedDraft);
    }

    if (
      !selectedPrioritySiteId ||
      !detailSiteGroups.some(
        group =>
          group.siteId === selectedPrioritySiteId && canSortPrioritySite(group, priorityDraft)
      )
    ) {
      setSelectedPrioritySiteId(
        sortedDetailSiteGroups.find(group => canSortPrioritySite(group, priorityDraft))?.siteId ??
          null
      );
    }
  }, [
    detailSiteGroups,
    priorityDraft,
    priorityDraft.disabledApiKeyPriorityKeys,
    priorityDraft.disabledSiteIds,
    priorityDraft.apiKeyPriorities,
    priorityDraft.sitePriorities,
    selectedPrioritySiteId,
    sortedDetailSiteGroups,
    sourceDetailState,
  ]);
  const filteredCandidates = useMemo(() => {
    if (!candidateQuery.trim()) {
      return candidateGroups;
    }

    const query = candidateQuery.trim().toLowerCase();
    return candidateGroups.filter(candidate =>
      candidate.originalModel.toLowerCase().includes(query)
    );
  }, [candidateGroups, candidateQuery]);

  const closeEditor = useCallback(() => {
    setEditorContext(null);
    setDraft(createEmptyDraft());
    setErrors({});
    setCandidateQuery('');
  }, []);

  const closeSourceDetails = useCallback(() => {
    setSourceDetailState(null);
    setPriorityDetailConfig(null);
    setPriorityDraft({
      sitePriorities: {},
      apiKeyPriorities: {},
      disabledSiteIds: [],
      disabledApiKeyPriorityKeys: [],
    });
    setSelectedPrioritySiteId(null);
    setExpandedMissingKeySiteIds({});
    setFoldedPrioritySitesExpanded(false);
  }, []);

  const closeRouteRules = useCallback(() => {
    setRouteRuleState(null);
    setRouteRuleDraft(createRouteRuntimeRuleDraft());
    setRouteRuleErrors({});
  }, []);

  // 只重置草稿：保存仍由「保存路由规则」显式触发，dirty 态由既有比对逻辑自动得出。
  const handleResetRouteRuleDraft = useCallback(() => {
    setRouteRuleDraft(createRouteRuntimeRuleDraft(DEFAULT_NEW_ROUTE_RUNTIME_CONFIG));
    setRouteRuleErrors({});
  }, []);

  const closeCreateApiKeyDialog = useCallback(() => {
    setCreateApiKeyState(null);
    setNewApiKeyForm(createDefaultNewApiKeyForm());
    setCreatingApiKey(false);
  }, []);

  const toggleMissingKeyHints = useCallback((siteId: string) => {
    setExpandedMissingKeySiteIds(current => ({
      ...current,
      [siteId]: !current[siteId],
    }));
  }, []);

  const toggleFoldedPrioritySites = useCallback(() => {
    setFoldedPrioritySitesExpanded(current => !current);
  }, []);

  const refreshOpenSourceDetails = useCallback(
    (
      nextRegistry: RouteModelRegistryConfig,
      currentDetailState: DisplayItemDetailState | null = sourceDetailState
    ) => {
      if (!currentDetailState) {
        return;
      }

      const nextView = buildDisplayItemViews(nextRegistry).find(
        view =>
          view.item.id === currentDetailState.item.id ||
          view.item.canonicalName === currentDetailState.item.canonicalName
      );

      if (!nextView?.entry) {
        closeSourceDetails();
        return;
      }

      setSourceDetailState({
        item: nextView.item,
        entry: nextView.entry,
      });
    },
    [closeSourceDetails, sourceDetailState]
  );

  const openSourceDetails = useCallback(
    (item: RouteModelDisplayItem, entry: RouteModelRegistryEntry) => {
      const priorityConfig = item.priorityConfig ?? createEmptyPriorityDraft();
      const initialDetailGroups = buildDetailSiteAccountGroups(
        { item, entry },
        null,
        customCliConfigs
      );
      const nextPriorityDraft = createDisplayOrderPriorityDraft(
        initialDetailGroups,
        priorityConfig
      );
      const initialSortedGroups = sortDetailGroupsByPriority(
        initialDetailGroups,
        nextPriorityDraft
      );

      setSourceDetailState({ item, entry });
      setPriorityDetailConfig(null);
      setPriorityDraft(nextPriorityDraft);
      setSelectedPrioritySiteId(
        initialSortedGroups.find(group => canSortPrioritySite(group, nextPriorityDraft))?.siteId ??
          null
      );
      setExpandedMissingKeySiteIds({});
      setFoldedPrioritySitesExpanded(false);

      void window.electronAPI
        .loadConfig()
        .then(fullConfig => {
          setPriorityDetailConfig(fullConfig as UnifiedConfig);
        })
        .catch(() => {
          setPriorityDetailConfig(null);
        });
    },
    [customCliConfigs]
  );

  useEffect(() => {
    if (!selectedDisplayItem?.entry) {
      closeSourceDetails();
      return;
    }

    const isSameDetailItem =
      sourceDetailState &&
      (sourceDetailState.item.id === selectedDisplayItem.item.id ||
        sourceDetailState.item.canonicalName === selectedDisplayItem.item.canonicalName);

    if (isSameDetailItem) {
      const currentBoundary = sourceDetailState.item.priorityConfig?.affinityInvalidatedAt ?? 0;
      const selectedBoundary = selectedDisplayItem.item.priorityConfig?.affinityInvalidatedAt ?? 0;
      if (
        selectedDisplayItem.item.updatedAt > sourceDetailState.item.updatedAt ||
        selectedBoundary > currentBoundary
      ) {
        setSourceDetailState({
          item: selectedDisplayItem.item,
          entry: selectedDisplayItem.entry,
        });
      }
      return;
    }

    openSourceDetails(selectedDisplayItem.item, selectedDisplayItem.entry);
  }, [closeSourceDetails, openSourceDetails, selectedDisplayItem, sourceDetailState]);

  useEffect(() => {
    if (!isActive || !sourceDetailState) {
      return;
    }

    void refreshRuntimeState();
    const intervalId = window.setInterval(() => {
      void refreshRuntimeState();
    }, PRIORITY_RUNTIME_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isActive, refreshRuntimeState, sourceDetailState]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    let isMounted = true;
    const requestLogsGeneration = ++requestLogsGenerationRef.current;

    const requestLogs = window.electronAPI.route?.getRequestLogs?.({
      limit: PRIORITY_ROUTE_LOG_LIMIT,
    });
    void requestLogs
      ?.then(result => {
        if (
          !isMounted ||
          requestLogsGeneration !== requestLogsGenerationRef.current ||
          !result?.success
        ) {
          return;
        }

        const loadedLogsByCanonicalName = buildFirstHitPathLogsByCanonicalName(
          result.data ?? [],
          registryRef.current,
          localPriorityInvalidationCutoffsRef.current
        );
        setFirstHitPathLogsByCanonicalName(current =>
          Object.values(loadedLogsByCanonicalName).reduce<Record<string, RouteRequestLogItem>>(
            (acc, item) => upsertFirstHitPathLog(acc, item),
            current
          )
        );
      })
      .catch(() => undefined);

    const unsubscribe = window.electronAPI.route?.onRequestLogAppended?.(item => {
      const currentRegistry = registryRef.current;
      setFirstHitPathLogsByCanonicalName(current =>
        upsertFirstHitPathLog(
          current,
          item,
          currentRegistry ? buildDisplayItemViews(currentRegistry) : undefined,
          localPriorityInvalidationCutoffsRef.current
        )
      );
    });

    return () => {
      isMounted = false;
      requestLogsGenerationRef.current += 1;
      unsubscribe?.();
    };
  }, [isActive]);

  const openRouteRules = useCallback((item: RouteModelDisplayItem, displayName: string) => {
    setRouteRuleState({ item, displayName });
    setRouteRuleDraft(createRouteRuntimeRuleDraft(item.runtimeConfig));
    setRouteRuleErrors({});
  }, []);

  const openCreateApiKeyDialog = useCallback(
    async (siteGroup: DetailSiteGroup, hint: DetailMissingApiKeyHint) => {
      try {
        const fullConfig = (await window.electronAPI.loadConfig()) as UnifiedConfig;
        const site = fullConfig.sites.find(currentSite => currentSite.id === siteGroup.siteId);
        const account = fullConfig.accounts.find(
          currentAccount => currentAccount.id === hint.accountId
        );

        if (!site || !account) {
          throw new Error('无法定位对应站点或账户');
        }

        const groups = {
          ...(account.cached_data?.user_groups || {}),
        };
        if (!groups[hint.group]) {
          groups[hint.group] = {
            desc: '路由优先级弹窗创建',
            ratio: 1,
          };
        }

        const siteConfig: SiteConfig = {
          id: site.id,
          name: `${site.name} / ${account.account_name}`,
          url: site.url,
          site_type: site.site_type,
          api_key: '',
          system_token: account.access_token,
          user_id: account.user_id,
          enabled: site.enabled,
          group: site.group,
          has_checkin: site.has_checkin,
          force_enable_checkin: site.force_enable_checkin,
          extra_links: site.extra_links,
          auto_refresh: site.auto_refresh,
          auto_refresh_interval: site.auto_refresh_interval,
        };

        setCreateApiKeyState({
          site: siteConfig,
          account,
          groups,
          defaultGroup: hint.group,
        });
        setNewApiKeyForm(createDefaultNewApiKeyForm(hint.group));
      } catch (error: unknown) {
        toast.error(`打开创建 API key 弹窗失败: ${getErrorMessage(error)}`);
      }
    },
    []
  );

  const openCreateEditor = useCallback(() => {
    setEditorContext({
      mode: 'create',
      initialSourceKeys: [],
    });
    setDraft(createEmptyDraft());
    setErrors({});
    setCandidateQuery('');
  }, []);

  const openEditEditor = useCallback(
    (displayItem: RouteModelDisplayItem, entry: RouteModelRegistryEntry | null) => {
      if (!entry && !displayItem.autoCollect) {
        toast.error('当前重定向项缺少可编辑的来源，请先同步来源或重新创建重定向');
        return;
      }

      const sourceByKey = new Map(
        (entry?.sources || []).map(source => [source.sourceKey, source] as const)
      );
      const selectedOriginalModels = normalizeOriginalModelOrder(
        displayItem.originalModelOrder,
        displayItem.sourceKeys,
        sourceByKey
      );

      setEditorContext({
        mode: 'edit',
        storageVersion: displayItem.storageVersion,
        displayItemId: displayItem.id,
        displayItemMode: displayItem.mode,
        initialSourceKeys: displayItem.sourceKeys,
        displayItemCreatedAt: displayItem.createdAt,
      });
      setDraft({
        canonicalName: displayItem.canonicalName,
        selectedOriginalModels,
        autoCollect: displayItem.autoCollect,
      });
      setErrors({});
      setCandidateQuery('');
    },
    []
  );

  const handleRefreshMetadata = useCallback(async () => {
    setRefreshingMetadata(true);
    try {
      const result = await window.electronAPI.route?.refreshModelMetadata();
      if (!result?.success) throw new Error(result?.error || '无法刷新模型元数据');
      toast.success('模型元数据已刷新');
    } catch (error: unknown) {
      toast.error(`刷新元数据失败: ${getErrorMessage(error)}`);
    } finally {
      setRefreshingMetadata(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.electronAPI.route?.onModelMetadataUpdated?.(() => {
      void useRouteStore
        .getState()
        .fetchModelRegistry()
        .then(registry => {
          if (active && registry) refreshOpenSourceDetails(registry);
        })
        .catch(error => toast.error(`加载模型元数据失败: ${getErrorMessage(error)}`));
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [refreshOpenSourceDetails]);

  const handleSyncSources = useCallback(async () => {
    setSyncingSources(true);
    try {
      const syncedRegistry = await syncModelRegistrySources(true);
      if (!syncedRegistry) {
        throw new Error('无法同步模型来源');
      }
      refreshOpenSourceDetails(syncedRegistry);
      toast.success('模型来源已同步，现有规则未被覆盖');
    } catch (error: unknown) {
      toast.error(`同步失败: ${getErrorMessage(error)}`);
    } finally {
      setSyncingSources(false);
    }
  }, [refreshOpenSourceDetails, syncModelRegistrySources]);

  const handleResetRoutePaths = useCallback(
    async (item: RouteModelDisplayItem, displayName: string) => {
      setResettingPathCanonicalName(item.canonicalName);
      try {
        const cleared = await resetPathStates({ canonicalModel: item.canonicalName });
        if (cleared === null) {
          throw new Error('无法恢复路由路径');
        }

        toast.success(
          cleared > 0
            ? `${displayName} 已恢复 ${cleared} 条路由路径`
            : `${displayName} 没有需要恢复的路由路径`
        );
      } catch (error: unknown) {
        toast.error(`恢复失败: ${getErrorMessage(error)}`);
      } finally {
        setResettingPathCanonicalName(null);
      }
    },
    [resetPathStates]
  );

  const handleResetPriorityHitPath = useCallback(
    async (item: RouteModelDisplayItem, displayName: string, hitPath: PriorityHitRoutePath) => {
      const resetParams = getPriorityHitRoutePathResetParams(hitPath);
      if (!resetParams) {
        toast.error('当前优先命中路径已失效');
        return;
      }

      setResettingPathCanonicalName(item.canonicalName);
      try {
        const cleared = await resetPathStates(resetParams);
        if (cleared === null) {
          throw new Error('无法重置当前优先命中路径');
        }

        const resetCompletedAt = Date.now();
        requestLogsGenerationRef.current += 1;
        localPriorityInvalidationCutoffsRef.current[item.canonicalName] = Math.max(
          localPriorityInvalidationCutoffsRef.current[item.canonicalName] ?? 0,
          resetCompletedAt
        );
        setFirstHitPathLogsByCanonicalName(current => {
          if (!current[item.canonicalName]) {
            return current;
          }

          const next = { ...current };
          delete next[item.canonicalName];
          return next;
        });

        toast.success(
          cleared > 0
            ? `${displayName} 已重置当前优先命中路径`
            : `${displayName} 当前优先命中路径无需重置`
        );
      } catch (error: unknown) {
        toast.error(`重置失败: ${getErrorMessage(error)}`);
      } finally {
        setResettingPathCanonicalName(null);
      }
    },
    [resetPathStates]
  );

  const handleCreateApiKeySubmit = useCallback(async () => {
    if (!createApiKeyState) {
      return;
    }

    const name = newApiKeyForm.name.trim();
    if (!name) {
      toast.warning('请填写令牌名称');
      return;
    }

    const accessToken = createApiKeyState.account.access_token;
    const userIdNum = Number.parseInt(createApiKeyState.account.user_id || '0', 10);
    if (!accessToken || !userIdNum) {
      toast.error('当前账户缺少可用 access token 或 user id');
      return;
    }

    let remainQuota = 0;
    if (!newApiKeyForm.unlimitedQuota) {
      const quotaNumber = Number.parseFloat(newApiKeyForm.quota);
      if (!Number.isFinite(quotaNumber) || quotaNumber <= 0) {
        toast.warning('请输入大于 0 的额度（单位：美元）');
        return;
      }

      remainQuota = Math.floor(quotaNumber * QUOTA_CONVERSION_FACTOR);
    }

    let expiredTime = -1;
    if (newApiKeyForm.expiredTime) {
      const nextExpiredTime = new Date(newApiKeyForm.expiredTime);
      if (Number.isNaN(nextExpiredTime.getTime())) {
        toast.warning('请输入有效的过期时间');
        return;
      }
      if (nextExpiredTime.getTime() <= Date.now()) {
        toast.warning('过期时间必须晚于当前时间');
        return;
      }

      expiredTime = Math.floor(nextExpiredTime.getTime() / 1000);
    }

    setCreatingApiKey(true);
    try {
      const resp = await window.electronAPI.token?.createApiToken?.(
        createApiKeyState.site.url,
        userIdNum,
        accessToken,
        {
          name,
          remain_quota: remainQuota,
          expired_time: expiredTime,
          unlimited_quota: newApiKeyForm.unlimitedQuota,
          model_limits_enabled: false,
          model_limits: '',
          allow_ips: '',
          group: newApiKeyForm.group || createApiKeyState.defaultGroup,
        },
        createApiKeyState.account.id
      );

      if (!resp || resp.success !== true) {
        throw new Error(resp?.error || '创建 API Key 失败');
      }

      const syncedRegistry = await syncModelRegistrySources(true);
      if (!syncedRegistry) {
        throw new Error('API Key 已创建，但刷新模型来源失败');
      }

      refreshOpenSourceDetails(syncedRegistry);
      toast.success('API Key 创建成功');
      closeCreateApiKeyDialog();
    } catch (error: unknown) {
      toast.error(`创建 API Key 失败: ${getErrorMessage(error)}`);
    } finally {
      setCreatingApiKey(false);
    }
  }, [
    closeCreateApiKeyDialog,
    createApiKeyState,
    newApiKeyForm.expiredTime,
    newApiKeyForm.group,
    newApiKeyForm.name,
    newApiKeyForm.quota,
    newApiKeyForm.unlimitedQuota,
    refreshOpenSourceDetails,
    syncModelRegistrySources,
  ]);

  useEffect(() => {
    if (!config) {
      return;
    }

    if (shouldAutoRefreshSourceDetails) {
      void handleSyncSources();
    }
  }, [config, handleSyncSources, shouldAutoRefreshSourceDetails]);

  const toggleOriginalModel = useCallback((originalModel: string) => {
    setDraft(current => {
      const wasSelected = current.selectedOriginalModels.includes(originalModel);
      const selected = wasSelected
        ? current.selectedOriginalModels.filter(item => item !== originalModel)
        : [...current.selectedOriginalModels, originalModel];

      return {
        ...current,
        selectedOriginalModels: selected,
        autoCollect: current.autoCollect
          ? {
              modelKeys: wasSelected
                ? current.autoCollect.modelKeys
                : Array.from(
                    new Set([...current.autoCollect.modelKeys, getRouteModelKey(originalModel)])
                  ),
              excludedModels: wasSelected
                ? Array.from(new Set([...current.autoCollect.excludedModels, originalModel]))
                : current.autoCollect.excludedModels.filter(model => model !== originalModel),
            }
          : undefined,
      };
    });
    setErrors(current => ({ ...current, selectedOriginalModels: undefined }));
  }, []);

  useEffect(() => {
    setDraft(current => {
      if (!current.autoCollect) return current;
      const selectedOriginalModels = collectRouteOriginalModels(
        current.selectedOriginalModels,
        candidateGroups.map(candidate => candidate.originalModel),
        current.autoCollect
      );
      return selectedOriginalModels.length === current.selectedOriginalModels.length &&
        selectedOriginalModels.every(
          (model, index) => model === current.selectedOriginalModels[index]
        )
        ? current
        : { ...current, selectedOriginalModels };
    });
  }, [candidateGroups, draft.autoCollect]);

  const enableDiscoveredModel = useCallback(
    async (candidate: RouteModelCandidate) => {
      try {
        const now = Date.now();
        const saved = await upsertDisplayItem({
          id: createLocalId(),
          vendor: inferRouteModelVendor(candidate.canonicalName),
          canonicalName: candidate.canonicalName,
          sourceKeys: candidate.sourceKeys,
          originalModelOrder: candidate.originalModels,
          autoCollect: { modelKeys: [candidate.modelKey], excludedModels: [] },
          priorityConfig: createEmptyPriorityDraft(),
          runtimeConfig: DEFAULT_NEW_ROUTE_RUNTIME_CONFIG,
          mode: 'manual',
          createdAt: now,
          updatedAt: now,
        });
        if (!saved) throw new Error('无法保存重定向');
        return true;
      } catch (error: unknown) {
        toast.error(`启用 ${candidate.canonicalName} 失败: ${getErrorMessage(error)}`);
        return false;
      }
    },
    [upsertDisplayItem]
  );

  const stopNestedScrollPropagation = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

  const handleSave = useCallback(async () => {
    if (!editorContext) {
      return;
    }

    const canonicalName = draft.canonicalName.trim();
    const nextErrors: RedirectEditorErrors = {};
    if (!canonicalName) {
      nextErrors.canonicalName = '请输入重定向名称';
    }

    if (draft.selectedOriginalModels.length === 0 && !draft.autoCollect?.modelKeys.length) {
      nextErrors.selectedOriginalModels = '请至少勾选一个原始模型';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const conflictDisplayItem = displayItems.find(
      displayItem =>
        displayItem.item.canonicalName === canonicalName &&
        displayItem.item.id !== editorContext.displayItemId
    );
    if (conflictDisplayItem) {
      setErrors(current => ({
        ...current,
        canonicalName: '该重定向名称已存在，请直接编辑已有卡片',
      }));
      return;
    }

    const candidateMap = new Map(
      candidateGroups.map(candidate => [candidate.originalModel, candidate] as const)
    );
    const selectedSourceKeys = new Set<string>();
    for (const originalModel of draft.selectedOriginalModels) {
      const candidate = candidateMap.get(originalModel);
      if (!candidate) {
        continue;
      }

      for (const sourceKey of candidate.sourceKeys) {
        selectedSourceKeys.add(sourceKey);
      }
    }

    if (selectedSourceKeys.size === 0 && !draft.autoCollect?.modelKeys.length) {
      setErrors(current => ({
        ...current,
        selectedOriginalModels: '所选模型没有可写入的来源',
      }));
      return;
    }

    setSaving(true);
    try {
      const now = Date.now();
      for (const sourceKey of editorContext.initialSourceKeys) {
        if (selectedSourceKeys.has(sourceKey)) {
          continue;
        }

        const existingOverride = overrideBySource.get(sourceKey);
        if (existingOverride) {
          const deleted = await deleteMappingOverride(existingOverride.id);
          if (!deleted) {
            throw new Error(`无法删除来源 ${sourceKey} 的旧重定向`);
          }
        }
      }

      const existingDisplayItem = displayItems.find(
        item => item.item.id === editorContext.displayItemId
      )?.item;
      const savedRegistry = await upsertDisplayItem({
        id: editorContext.displayItemId ?? createLocalId(),
        storageVersion: editorContext.storageVersion,
        vendor: inferRouteModelVendor(canonicalName),
        canonicalName,
        sourceKeys: Array.from(selectedSourceKeys),
        originalModelOrder: [...draft.selectedOriginalModels],
        autoCollect: draft.autoCollect,
        priorityConfig: existingDisplayItem?.priorityConfig ?? createEmptyPriorityDraft(),
        // 判定依据必须是编辑器模式：existingDisplayItem 查找失败时也为 undefined，
        // 用它判新建会把默认值静默覆盖到既有项上。
        runtimeConfig:
          editorContext.mode === 'create'
            ? DEFAULT_NEW_ROUTE_RUNTIME_CONFIG
            : existingDisplayItem?.runtimeConfig,
        mode: editorContext.displayItemMode ?? 'manual',
        createdAt: editorContext.displayItemCreatedAt ?? now,
        updatedAt: now,
      });
      if (!savedRegistry) {
        throw new Error('无法保存重定向展示项');
      }

      for (const sourceKey of selectedSourceKeys) {
        const existingOverride = overrideBySource.get(sourceKey);
        if (draft.autoCollect && !existingOverride) continue;
        const savedOverride = await upsertMappingOverride({
          id: existingOverride?.id ?? createLocalId(),
          sourceKey,
          canonicalName,
          action: 'rename',
          note: existingOverride?.note,
          createdAt: existingOverride?.createdAt ?? now,
          updatedAt: now,
        });
        if (!savedOverride) {
          throw new Error(`无法保存来源 ${sourceKey} 的重定向`);
        }
      }

      toast.success(editorContext.mode === 'edit' ? '模型重定向已更新' : '模型重定向已新增');
      closeEditor();
    } catch (error: unknown) {
      toast.error(`保存失败: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }, [
    closeEditor,
    candidateGroups,
    deleteMappingOverride,
    displayItems,
    draft.canonicalName,
    draft.selectedOriginalModels,
    draft.autoCollect,
    editorContext,
    upsertDisplayItem,
    overrideBySource,
    upsertMappingOverride,
  ]);

  const handleDelete = useCallback(
    async (displayItemId: string) => {
      setSaving(true);
      try {
        const deletedRegistry = await deleteDisplayItem(displayItemId);
        if (!deletedRegistry) {
          throw new Error('无法删除重定向模型');
        }

        if (editorContext?.displayItemId === displayItemId) {
          closeEditor();
        }

        toast.success('重定向模型已删除');
        setDeleteConfirm(current => (current?.displayItemId === displayItemId ? null : current));
      } catch (error: unknown) {
        toast.error(`删除失败: ${getErrorMessage(error)}`);
      } finally {
        setSaving(false);
      }
    },
    [closeEditor, deleteDisplayItem, editorContext?.displayItemId]
  );

  const confirmDelete = useCallback(() => {
    if (!deleteConfirm) {
      return;
    }
    void handleDelete(deleteConfirm.displayItemId);
  }, [deleteConfirm, handleDelete]);

  const movePrioritySite = useCallback(
    (siteId: string, target: 'up' | 'down' | 'first' | 'last') => {
      const sortableGroups = sortedDetailSiteGroups.filter(group =>
        canSortPrioritySite(group, priorityDraft)
      );
      const foldedGroups = sortedDetailSiteGroups.filter(
        group => !canSortPrioritySite(group, priorityDraft)
      );
      const currentIndex = sortableGroups.findIndex(group => group.siteId === siteId);
      if (currentIndex < 0) {
        return;
      }

      const targetIndex =
        target === 'first'
          ? 0
          : target === 'last'
            ? sortableGroups.length - 1
            : target === 'up'
              ? currentIndex - 1
              : currentIndex + 1;
      const reorderedGroups = [
        ...moveArrayItem(sortableGroups, currentIndex, targetIndex),
        ...foldedGroups,
      ];

      setSelectedPrioritySiteId(siteId);
      setPriorityDraft(current => buildSequentialPriorityDraft(reorderedGroups, current));
    },
    [priorityDraft, sortedDetailSiteGroups]
  );

  const moveSelectedPrioritySite = useCallback(
    (target: 'up' | 'down' | 'first' | 'last') => {
      if (!selectedPrioritySiteId) {
        return;
      }

      movePrioritySite(selectedPrioritySiteId, target);
    },
    [movePrioritySite, selectedPrioritySiteId]
  );

  const movePriorityApiKey = useCallback(
    (siteId: string, apiKeyKey: string, target: 'up' | 'down') => {
      const siteGroup = sortedDetailSiteGroups.find(group => group.siteId === siteId);
      if (!siteGroup || !canSortPrioritySite(siteGroup, priorityDraft)) {
        return;
      }

      const enabledApiKeys = getEnabledPriorityApiKeys(siteGroup, priorityDraft);
      const disabledApiKeys = siteGroup.apiKeys.filter(apiKey =>
        isPriorityApiKeyDisabled(apiKey, priorityDraft)
      );
      const currentIndex = enabledApiKeys.findIndex(apiKey => apiKey.key === apiKeyKey);
      if (currentIndex < 0) {
        return;
      }

      const targetIndex = target === 'up' ? currentIndex - 1 : currentIndex + 1;
      const reorderedApiKeys = [
        ...moveArrayItem(enabledApiKeys, currentIndex, targetIndex),
        ...disabledApiKeys,
      ];
      const reorderedGroups = sortedDetailSiteGroups.map(group =>
        group.siteId === siteId ? { ...group, apiKeys: reorderedApiKeys } : group
      );

      setPriorityDraft(current => buildSequentialPriorityDraft(reorderedGroups, current));
    },
    [priorityDraft, sortedDetailSiteGroups]
  );

  const savePriorityDraft = useCallback(
    async (draftToSave: PriorityDraft, groupsForSave: DetailSiteGroup[]) => {
      pendingPrioritySaveRef.current = {
        draft: draftToSave,
        groups: groupsForSave,
      };
      if (savingPriorityRef.current) {
        return;
      }

      savingPriorityRef.current = true;
      setSaving(true);
      try {
        while (pendingPrioritySaveRef.current) {
          const pendingSave = pendingPrioritySaveRef.current;
          pendingPrioritySaveRef.current = null;

          const currentDetailState = sourceDetailStateRef.current;
          if (!currentDetailState) {
            continue;
          }

          const normalizedDraft = buildSequentialPriorityDraft(
            pendingSave.groups,
            pendingSave.draft
          );
          const priorityConfig = serializePriorityConfig(normalizedDraft);
          const updatedAt = Date.now();

          const savedRegistry = await upsertDisplayItem({
            ...currentDetailState.item,
            priorityConfig,
            updatedAt,
          });
          if (!savedRegistry) {
            throw new Error('无法保存重定向优先级');
          }

          const savedView = buildDisplayItemViews(savedRegistry).find(
            view =>
              view.item.id === currentDetailState.item.id ||
              view.item.canonicalName === currentDetailState.item.canonicalName
          );
          if (!savedView?.entry) {
            throw new Error('保存后的重定向配置不可用');
          }

          registryRef.current = savedRegistry;
          requestLogsGenerationRef.current += 1;
          const savedBoundary = savedView.item.priorityConfig?.affinityInvalidatedAt;
          if (savedBoundary !== undefined) {
            localPriorityInvalidationCutoffsRef.current[savedView.item.canonicalName] = Math.max(
              localPriorityInvalidationCutoffsRef.current[savedView.item.canonicalName] ?? 0,
              savedBoundary
            );
          }
          setFirstHitPathLogsByCanonicalName(current => {
            if (!current[savedView.item.canonicalName]) {
              return current;
            }

            const next = { ...current };
            delete next[savedView.item.canonicalName];
            return next;
          });

          const nextDetailState = { item: savedView.item, entry: savedView.entry };
          sourceDetailStateRef.current = nextDetailState;

          // A newer draft may have been queued while this save was in flight.
          if (pendingPrioritySaveRef.current) {
            continue;
          }

          setSourceDetailState(current =>
            current &&
            (current.item.id === currentDetailState.item.id ||
              current.item.canonicalName === currentDetailState.item.canonicalName)
              ? nextDetailState
              : current
          );
          setRouteRuleState(current =>
            current &&
            (current.item.id === currentDetailState.item.id ||
              current.item.canonicalName === currentDetailState.item.canonicalName)
              ? {
                  ...current,
                  item: savedView.item,
                }
              : current
          );
          setPriorityDraft(normalizedDraft);
          toast.success('重定向优先级已更新');
        }
      } catch (error: unknown) {
        toast.error(`保存失败: ${getErrorMessage(error)}`);
      } finally {
        savingPriorityRef.current = false;
        setSaving(false);
      }
    },
    [upsertDisplayItem]
  );

  const handleSaveDetails = useCallback(() => {
    void savePriorityDraft(priorityDraft, sortedDetailSiteGroups);
  }, [priorityDraft, savePriorityDraft, sortedDetailSiteGroups]);

  const togglePrioritySiteDisabled = useCallback(
    (siteId: string) => {
      const currentGroup = sortedDetailSiteGroups.find(group => group.siteId === siteId);
      setPriorityDraft(current => {
        const disabledSiteIds = normalizePriorityKeyList(current.disabledSiteIds);
        const nextDisabledSiteIds = disabledSiteIds.includes(siteId)
          ? disabledSiteIds.filter(currentSiteId => currentSiteId !== siteId)
          : [...disabledSiteIds, siteId];
        const nextInput = {
          ...current,
          disabledSiteIds: nextDisabledSiteIds,
        };
        const groupsForSave = sortDetailGroupsByPriority(detailSiteGroups, nextInput);
        const nextDraft = buildSequentialPriorityDraft(groupsForSave, nextInput);

        if (currentGroup && !canSortPrioritySite(currentGroup, nextDraft)) {
          setSelectedPrioritySiteId(
            sortedDetailSiteGroups.find(group => canSortPrioritySite(group, nextDraft))?.siteId ??
              null
          );
        } else {
          setSelectedPrioritySiteId(siteId);
        }

        void savePriorityDraft(nextDraft, groupsForSave);
        return nextDraft;
      });
    },
    [detailSiteGroups, savePriorityDraft, sortedDetailSiteGroups]
  );

  const togglePriorityApiKeyDisabled = useCallback(
    (siteId: string, apiKeyKey: string) => {
      setPriorityDraft(current => {
        const disabledApiKeyPriorityKeys = normalizePriorityKeyList(
          current.disabledApiKeyPriorityKeys
        );
        const nextDisabledApiKeyPriorityKeys = disabledApiKeyPriorityKeys.includes(apiKeyKey)
          ? disabledApiKeyPriorityKeys.filter(currentKey => currentKey !== apiKeyKey)
          : [...disabledApiKeyPriorityKeys, apiKeyKey];
        const nextInput = {
          ...current,
          disabledApiKeyPriorityKeys: nextDisabledApiKeyPriorityKeys,
        };
        const groupsForSave = sortDetailGroupsByPriority(detailSiteGroups, nextInput);
        const nextDraft = buildSequentialPriorityDraft(groupsForSave, nextInput);
        const siteGroup = sortedDetailSiteGroups.find(group => group.siteId === siteId);

        if (siteGroup && canSortPrioritySite(siteGroup, nextDraft)) {
          setSelectedPrioritySiteId(siteId);
        } else {
          setSelectedPrioritySiteId(
            sortedDetailSiteGroups.find(group => canSortPrioritySite(group, nextDraft))?.siteId ??
              null
          );
        }

        void savePriorityDraft(nextDraft, groupsForSave);
        return nextDraft;
      });
    },
    [detailSiteGroups, savePriorityDraft, sortedDetailSiteGroups]
  );

  const handleSaveRouteRules = useCallback(async () => {
    if (!routeRuleState) {
      return;
    }

    const maxAttemptsPerRoutePath = Number.parseInt(routeRuleDraft.maxAttemptsPerRoutePath, 10);
    const successRateWindowMinutes = Number.parseInt(routeRuleDraft.successRateWindowMinutes, 10);
    const disableDurationMinutes = Number.parseInt(routeRuleDraft.disableDurationMinutes, 10);
    const minSuccessRatePercent = Number.parseFloat(routeRuleDraft.minSuccessRatePercent);
    const nextErrors: RouteRuntimeRuleErrors = {};

    if (
      !Number.isFinite(maxAttemptsPerRoutePath) ||
      maxAttemptsPerRoutePath < 1 ||
      maxAttemptsPerRoutePath > 10
    ) {
      nextErrors.maxAttemptsPerRoutePath = '请输入 1-10 的整数';
    }

    if (
      !Number.isFinite(successRateWindowMinutes) ||
      successRateWindowMinutes < 1 ||
      successRateWindowMinutes > 1440
    ) {
      nextErrors.successRateWindowMinutes = '请输入 1-1440 的整数';
    }

    if (
      !Number.isFinite(disableDurationMinutes) ||
      disableDurationMinutes < 1 ||
      disableDurationMinutes > 1440
    ) {
      nextErrors.disableDurationMinutes = '请输入 1-1440 的整数';
    }

    if (
      !Number.isFinite(minSuccessRatePercent) ||
      minSuccessRatePercent < 0 ||
      minSuccessRatePercent > 100
    ) {
      nextErrors.minSuccessRatePercent = '请输入 0-100 的数字';
    }

    if (Object.keys(nextErrors).length > 0) {
      setRouteRuleErrors(nextErrors);
      return;
    }

    const runtimeConfig = normalizeRouteRuntimeConfig({
      maxAttemptsPerRoutePath,
      successRateWindowMinutes,
      disableDurationMinutes,
      minSuccessRate: minSuccessRatePercent / 100,
    });

    // Prefer the freshest display item so a stale dialog snapshot cannot clobber
    // a newer priority disable/reorder that auto-saved while this dialog stayed open.
    const latestItem =
      (sourceDetailStateRef.current &&
      (sourceDetailStateRef.current.item.id === routeRuleState.item.id ||
        sourceDetailStateRef.current.item.canonicalName === routeRuleState.item.canonicalName)
        ? sourceDetailStateRef.current.item
        : null) ||
      config?.modelRegistry?.displayItems.find(
        item =>
          item.id === routeRuleState.item.id ||
          item.canonicalName === routeRuleState.item.canonicalName
      ) ||
      routeRuleState.item;
    const updatedAt = Date.now();

    setSaving(true);
    try {
      const savedRegistry = await upsertDisplayItem({
        ...latestItem,
        runtimeConfig,
        updatedAt,
      });
      if (!savedRegistry) {
        throw new Error('无法保存路由规则');
      }

      setSourceDetailState(current =>
        current &&
        (current.item.id === latestItem.id ||
          current.item.canonicalName === latestItem.canonicalName)
          ? {
              ...current,
              item: {
                ...current.item,
                runtimeConfig,
                updatedAt,
              },
            }
          : current
      );

      toast.success('路由规则已更新');
      closeRouteRules();
    } catch (error: unknown) {
      toast.error(`保存失败: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }, [
    closeRouteRules,
    config?.modelRegistry?.displayItems,
    routeRuleDraft,
    routeRuleState,
    upsertDisplayItem,
  ]);

  const sortableDetailSiteGroups = sortedDetailSiteGroups.filter(group =>
    canSortPrioritySite(group, priorityDraft)
  );
  const foldedDetailSiteGroups = sortedDetailSiteGroups.filter(
    group => !canSortPrioritySite(group, priorityDraft)
  );
  const priorityDetailRows: Array<
    { kind: 'site'; siteGroup: DetailSiteGroup } | { kind: 'folded-sites' }
  > = [
    ...sortableDetailSiteGroups.map(siteGroup => ({ kind: 'site' as const, siteGroup })),
    ...(foldedDetailSiteGroups.length > 0 ? [{ kind: 'folded-sites' as const }] : []),
    ...(foldedPrioritySitesExpanded
      ? foldedDetailSiteGroups.map(siteGroup => ({ kind: 'site' as const, siteGroup }))
      : []),
  ];
  const foldedPrioritySiteSummary = [
    foldedDetailSiteGroups.length > 0 ? `${foldedDetailSiteGroups.length} 个站点已折叠` : null,
    foldedDetailSiteGroups.filter(group => isPrioritySiteDisabled(group, priorityDraft)).length > 0
      ? `${
          foldedDetailSiteGroups.filter(group => isPrioritySiteDisabled(group, priorityDraft))
            .length
        } 个站点已禁用`
      : null,
  ]
    .filter(Boolean)
    .join('，');
  const selectedPrioritySiteIndex = selectedPrioritySiteId
    ? sortableDetailSiteGroups.findIndex(group => group.siteId === selectedPrioritySiteId)
    : -1;
  const now = Date.now();
  const sessionDots = buildPrioritySessionDots(
    config?.sessionChannelBindings,
    config?.sessionRouting?.instances,
    selectedDisplayItem?.item.canonicalName,
    buildRouteSessionOrdinals(config?.sessionRouting?.instances)
  );
  const sourceDetailStatePriorityHitPath = sourceDetailState
    ? (getPriorityHitRoutePathFromState({
        states: config?.routePathStates,
        item: sourceDetailState.item,
        entry: sourceDetailState.entry,
        now,
        localInvalidationCutoff:
          localPriorityInvalidationCutoffsRef.current[sourceDetailState.item.canonicalName],
      }) ??
      getPriorityHitRoutePathFromLog(
        sourceDetailState.item,
        sourceDetailState.entry,
        firstHitPathLogsByCanonicalName[sourceDetailState.item.canonicalName],
        localPriorityInvalidationCutoffsRef.current[sourceDetailState.item.canonicalName]
      ))
    : null;
  const priorityHitApiKeyKey =
    getPriorityHitApiKeyKey(sourceDetailStatePriorityHitPath) ??
    (sourceDetailState
      ? getPriorityHitApiKeyKeyFromRouteLog(
          sourceDetailState.item,
          sourceDetailState.entry,
          localPriorityInvalidationCutoffsRef.current[sourceDetailState.item.canonicalName],
          firstHitPathLogsByCanonicalName[sourceDetailState.item.canonicalName]
        )
      : null);
  const selectedPriorityHitPath = selectedDisplayItem?.entry
    ? (getPriorityHitRoutePathFromState({
        states: config?.routePathStates,
        item: selectedDisplayItem.item,
        entry: selectedDisplayItem.entry,
        now,
        localInvalidationCutoff:
          localPriorityInvalidationCutoffsRef.current[selectedDisplayItem.item.canonicalName],
      }) ??
      getPriorityHitRoutePathFromLog(
        selectedDisplayItem.item,
        selectedDisplayItem.entry,
        firstHitPathLogsByCanonicalName[selectedDisplayItem.item.canonicalName],
        localPriorityInvalidationCutoffsRef.current[selectedDisplayItem.item.canonicalName]
      ))
    : null;
  const selectedPriorityHitResetParams =
    getPriorityHitRoutePathResetParams(selectedPriorityHitPath);
  const selectedActiveSuspensionCount = selectedDisplayItem
    ? countActiveRoutePathStatesForItem({
        states: config?.routePathStates,
        item: selectedDisplayItem.item,
        now,
      })
    : 0;
  const selectedMinSuccessRate = selectedDisplayItem
    ? normalizeRouteRuntimeConfig(selectedDisplayItem.item.runtimeConfig).minSuccessRate
    : undefined;
  const isResettingSelectedRoutePaths = selectedDisplayItem
    ? resettingPathCanonicalName === selectedDisplayItem.item.canonicalName
    : false;
  const isPriorityDirty = sourceDetailState
    ? !priorityDraftMatches(
        buildSequentialPriorityDraft(sortedDetailSiteGroups, priorityDraft),
        createDisplayOrderPriorityDraft(
          detailSiteGroups,
          sourceDetailState.item.priorityConfig ?? createEmptyPriorityDraft()
        )
      )
    : false;

  const pageHeaderActions = useMemo(
    () =>
      config ? (
        <div className="flex items-center gap-2">
          <AppButton
            type="button"
            variant="secondary"
            size="sm"
            className="!h-7 !min-h-7"
            onClick={handleRefreshMetadata}
            disabled={refreshingMetadata}
          >
            {refreshingMetadata ? '刷新中' : '刷新元数据'}
          </AppButton>
          <AppButton
            type="button"
            variant="secondary"
            size="sm"
            className="!h-7 !min-h-7"
            onClick={handleSyncSources}
            disabled={syncingSources}
          >
            {syncingSources ? '同步中' : '同步来源'}
          </AppButton>
          <AppButton
            type="button"
            size="sm"
            variant="secondary"
            className="!h-7 !min-h-7"
            onClick={() => setDiscoveryOpen(true)}
            disabled={syncingSources || saving}
          >
            选择重定向
          </AppButton>
          <AppButton
            type="button"
            size="sm"
            variant="secondary"
            className="!h-7 !min-h-7"
            onClick={openCreateEditor}
            disabled={syncingSources || saving}
          >
            新增重定向
          </AppButton>
        </div>
      ) : null,
    [
      config,
      handleRefreshMetadata,
      handleSyncSources,
      openCreateEditor,
      refreshingMetadata,
      saving,
      syncingSources,
    ]
  );

  useEffect(() => {
    setPageHeaderActions?.(pageHeaderActions);
    return () => setPageHeaderActions?.(null);
  }, [pageHeaderActions, setPageHeaderActions]);
  return {
    className,
    displayItems,
    setPageHeaderActions,
    pageHeaderActions,
    selectedDisplayItem,
    setSelectedDisplayItemId,
    openEditEditor,
    setDeleteConfirm,
    selectedPriorityHitResetParams,
    selectedPriorityHitPath,
    handleResetPriorityHitPath,
    saving,
    isResettingSelectedRoutePaths,
    handleResetRoutePaths,
    selectedActiveSuspensionCount,
    openRouteRules,
    moveSelectedPrioritySite,
    selectedPrioritySiteIndex,
    sortableDetailSiteGroups,
    isPriorityDirty,
    handleSaveDetails,
    siteOnlySourceNotices,
    sortedDetailSiteGroups,
    sessionDots,
    selectedSessionInstanceId,
    setSelectedSessionInstanceId,
    priorityDetailRows,
    foldedPrioritySitesExpanded,
    toggleFoldedPrioritySites,
    foldedPrioritySiteSummary,
    foldedDetailSiteGroups,
    priorityDraft,
    selectedPrioritySiteId,
    expandedMissingKeySiteIds,
    setSelectedPrioritySiteId,
    togglePrioritySiteDisabled,
    config,
    priorityHitApiKeyKey,
    movePriorityApiKey,
    now,
    selectedMinSuccessRate,
    togglePriorityApiKeyDisabled,
    toggleMissingKeyHints,
    openCreateApiKeyDialog,
    creatingApiKey,
    discoveryOpen,
    registry,
    setDiscoveryOpen,
    enableDiscoveredModel,
    editorContext,
    closeEditor,
    handleSave,
    redirectNameInputId,
    draft,
    setDraft,
    setErrors,
    errors,
    searchInputId,
    candidateQuery,
    setCandidateQuery,
    stopNestedScrollPropagation,
    toggleOriginalModel,
    filteredCandidates,
    routeRuleState,
    closeRouteRules,
    handleResetRouteRuleDraft,
    handleSaveRouteRules,
    routeRuleDraft,
    setRouteRuleDraft,
    setRouteRuleErrors,
    routeRuleErrors,
    createApiKeyState,
    newApiKeyForm,
    setNewApiKeyForm,
    handleCreateApiKeySubmit,
    closeCreateApiKeyDialog,
    deleteConfirm,
    confirmDelete,
  };
}
