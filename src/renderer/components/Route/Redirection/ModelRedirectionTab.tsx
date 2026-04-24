/**
 * 模型重定向区块
 * 单列厂商折叠布局，按 sourceKey 保存重定向覆盖
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useRouteStore } from '../../../store/routeStore';
import { toast } from '../../../store/toastStore';
import { AppButton } from '../../AppButton/AppButton';
import { AppCard, AppCardContent } from '../../AppCard';
import { AppModal } from '../../AppModal/AppModal';
import { VendorIcon, getVendorLabel } from '../../../assets/vendor-icons';
import {
  buildRouteVendorApiKeyPriorityKey,
  compareRouteModelRegistryEntries,
  DEFAULT_ROUTE_VENDOR_API_KEY_PRIORITY,
  DEFAULT_ROUTE_VENDOR_SITE_PRIORITY,
  ROUTE_MODEL_VENDOR_ORDER,
} from '../../../../shared/types/route-proxy';
import type {
  RouteModelDisplayItem,
  RouteModelMappingOverride,
  RouteModelRegistryConfig,
  RouteModelRegistryEntry,
  RouteModelSourceRef,
  RouteModelVendor,
  RouteVendorPriorityConfig,
} from '../../../../shared/types/route-proxy';

interface VendorCandidateGroup {
  originalModel: string;
  sourceKeys: string[];
  siteCount: number;
  sourceCount: number;
}

interface VendorSection {
  vendor: RouteModelVendor;
  displayItems: Array<{
    item: RouteModelDisplayItem;
    entry: RouteModelRegistryEntry | null;
    displayName: string;
  }>;
  summaryItems: Array<{
    item: RouteModelDisplayItem;
    entry: RouteModelRegistryEntry | null;
    displayName: string;
  }>;
  candidateGroups: VendorCandidateGroup[];
}

interface RedirectEditorContext {
  mode: 'create' | 'edit';
  vendor: RouteModelVendor;
  displayItemId?: string;
  displayItemMode?: RouteModelDisplayItem['mode'];
  initialSourceKeys: string[];
  displayItemCreatedAt?: number;
}

interface RedirectEditorDraft {
  canonicalName: string;
  selectedOriginalModels: string[];
}

interface RedirectEditorErrors {
  canonicalName?: string;
  selectedOriginalModels?: string;
}

interface SourceDetailState {
  entry: RouteModelRegistryEntry;
  item: RouteModelDisplayItem;
}

interface SourceDetailSiteGroup {
  key: string;
  siteId: string;
  siteName: string;
  accountName?: string;
  availableUserGroups: string[];
  apiKeyNamesByGroup: Map<string, Set<string>>;
}

interface SourceDetailModelGroup {
  originalModel: string;
  siteCount: number;
  sourceCount: number;
  sites: SourceDetailSiteGroup[];
}

interface VendorPriorityApiKeyRow {
  key: string;
  apiKeyId: string;
  apiKeyName: string;
  accountId: string;
  accountName?: string;
  group: string;
}

interface VendorPrioritySiteGroup {
  siteId: string;
  siteName: string;
  apiKeys: VendorPriorityApiKeyRow[];
}

function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `redirect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function parsePriorityInput(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.round(parsed));
}

function getRegistrySourcePool(registry: RouteModelRegistryConfig): RouteModelSourceRef[] {
  if (registry.sources.length > 0) {
    return registry.sources;
  }

  const dedupedSources = new Map<string, RouteModelSourceRef>();
  for (const entry of Object.values(registry.entries)) {
    for (const source of entry.sources) {
      if (!dedupedSources.has(source.sourceKey)) {
        dedupedSources.set(source.sourceKey, source);
      }
    }
  }

  return Array.from(dedupedSources.values());
}

function normalizeOriginalModelOrder(
  originalModelOrder: string[] | undefined,
  sourceKeys: string[],
  sourceByKey: Map<string, RouteModelSourceRef>
): string[] {
  const availableModels = sourceKeys
    .map(sourceKey => sourceByKey.get(sourceKey)?.originalModel)
    .filter((model): model is string => !!model);
  const availableModelSet = new Set(availableModels);
  const normalized = Array.from(
    new Set(
      (originalModelOrder || [])
        .map(model => model.trim())
        .filter(model => model.length > 0 && availableModelSet.has(model))
    )
  );

  for (const model of availableModels) {
    if (!normalized.includes(model)) {
      normalized.push(model);
    }
  }

  return normalized;
}

function buildDisplayItemEntry(
  displayItem: RouteModelDisplayItem,
  sourceByKey: Map<string, RouteModelSourceRef>,
  overrideBySource: Map<string, RouteModelMappingOverride>
): RouteModelRegistryEntry | null {
  const originalModelOrder = normalizeOriginalModelOrder(
    displayItem.originalModelOrder,
    displayItem.sourceKeys,
    sourceByKey
  );
  const orderIndex = new Map(originalModelOrder.map((model, index) => [model, index]));

  const sources = displayItem.sourceKeys
    .slice()
    .sort((left, right) => {
      const leftSource = sourceByKey.get(left);
      const rightSource = sourceByKey.get(right);
      const leftIndex = leftSource
        ? (orderIndex.get(leftSource.originalModel) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
      const rightIndex = rightSource
        ? (orderIndex.get(rightSource.originalModel) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      return left.localeCompare(right);
    })
    .map(sourceKey => sourceByKey.get(sourceKey))
    .filter((source): source is RouteModelSourceRef => !!source);

  if (sources.length === 0) {
    return null;
  }

  return {
    canonicalName: displayItem.canonicalName,
    vendor: displayItem.vendor,
    aliases: Array.from(new Set(sources.map(source => source.originalModel))),
    sources,
    hasOverride: sources.some(source => overrideBySource.has(source.sourceKey)),
    createdAt: displayItem.createdAt,
    updatedAt: displayItem.updatedAt,
  };
}

function buildVendorCandidateGroups(sources: RouteModelSourceRef[]): VendorCandidateGroup[] {
  const groups = new Map<string, { sourceKeys: Set<string>; siteIds: Set<string> }>();

  for (const source of sources) {
    if (!groups.has(source.originalModel)) {
      groups.set(source.originalModel, {
        sourceKeys: new Set<string>(),
        siteIds: new Set<string>(),
      });
    }

    groups.get(source.originalModel)!.sourceKeys.add(source.sourceKey);
    groups.get(source.originalModel)!.siteIds.add(source.siteId);
  }

  return Array.from(groups.entries())
    .map(([originalModel, group]) => ({
      originalModel,
      sourceKeys: Array.from(group.sourceKeys),
      siteCount: group.siteIds.size,
      sourceCount: group.sourceKeys.size,
    }))
    .sort((left, right) => left.originalModel.localeCompare(right.originalModel));
}

export function buildVendorSections(registry?: RouteModelRegistryConfig): VendorSection[] {
  if (!registry) {
    return [];
  }

  const sourcePool = getRegistrySourcePool(registry);
  const overrideBySource = new Map(
    registry.overrides.map(override => [override.sourceKey, override])
  );
  const sourceByKey = new Map(sourcePool.map(source => [source.sourceKey, source]));

  const fallbackDisplayItems =
    registry.displayItems.length > 0
      ? registry.displayItems
      : ROUTE_MODEL_VENDOR_ORDER.flatMap(vendor => {
          const vendorEntries = Object.values(registry.entries)
            .filter(entry => entry.vendor === vendor)
            .slice()
            .sort((left, right) => compareRouteModelRegistryEntries(vendor, left, right));

          return vendorEntries.slice(0, 3).map((entry, index) => ({
            id: `fallback:${vendor}:${index}`,
            vendor,
            canonicalName: entry.canonicalName,
            sourceKeys: entry.sources.map(source => source.sourceKey),
            originalModelOrder: Array.from(
              new Set(entry.sources.map(source => source.originalModel))
            ),
            mode: 'seeded' as const,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          }));
        });

  return ROUTE_MODEL_VENDOR_ORDER.flatMap(vendor => {
    const vendorSources = sourcePool.filter(source => source.vendor === vendor);
    const resolvedDisplayItems = fallbackDisplayItems
      .filter(item => item.vendor === vendor)
      .map(item => {
        const entry = buildDisplayItemEntry(item, sourceByKey, overrideBySource);

        return {
          item,
          entry,
          displayName: item.canonicalName,
        };
      });

    if (vendorSources.length === 0 && resolvedDisplayItems.length === 0) {
      return [];
    }

    return [
      {
        vendor,
        displayItems: resolvedDisplayItems,
        summaryItems: resolvedDisplayItems.filter(item => item.item.mode === 'seeded').slice(0, 3),
        candidateGroups: buildVendorCandidateGroups(sourcePool),
      },
    ];
  });
}

export function buildRecommendedCliModelOptions(
  registry?: RouteModelRegistryConfig
): RouteModelRegistryEntry[] {
  const dedupedEntries = new Map<string, RouteModelRegistryEntry>();

  for (const section of buildVendorSections(registry)) {
    for (const displayItem of section.displayItems) {
      const entry = displayItem.entry;
      if (!entry) {
        continue;
      }

      if (!dedupedEntries.has(entry.canonicalName)) {
        dedupedEntries.set(entry.canonicalName, entry);
      }
    }
  }

  return Array.from(dedupedEntries.values());
}

export function shouldRefreshRegistrySourceDetails(registry?: RouteModelRegistryConfig): boolean {
  if (!registry) {
    return false;
  }

  return getRegistrySourcePool(registry).some(source => {
    if (source.sourceType !== 'account') {
      return false;
    }

    return source.availableUserGroups === undefined || source.availableApiKeys === undefined;
  });
}

export function shouldRefreshRegistryDisplayItems(registry?: RouteModelRegistryConfig): boolean {
  if (!registry) {
    return false;
  }

  if (getRegistrySourcePool(registry).length === 0) {
    return false;
  }

  return (
    registry.displayItems.length === 0 ||
    registry.displayItems.some(item => (item.originalModelOrder?.length ?? 0) === 0)
  );
}

function formatSourceSummary(sources: RouteModelSourceRef[]): string {
  const siteCount = new Set(sources.map(source => source.siteId)).size;
  return `${siteCount} 站点 · ${sources.length} 来源`;
}

function buildSourceDetailGroups(detailState: SourceDetailState | null): SourceDetailModelGroup[] {
  if (!detailState) {
    return [];
  }

  const { entry, item } = detailState;
  const originalModelOrder = normalizeOriginalModelOrder(
    item.originalModelOrder,
    item.sourceKeys,
    new Map(entry.sources.map(source => [source.sourceKey, source] as const))
  );
  const grouped = new Map<string, SourceDetailModelGroup>();

  for (const source of entry.sources) {
    if (!grouped.has(source.originalModel)) {
      grouped.set(source.originalModel, {
        originalModel: source.originalModel,
        siteCount: 0,
        sourceCount: 0,
        sites: [],
      });
    }

    const modelGroup = grouped.get(source.originalModel)!;
    modelGroup.sourceCount += 1;

    const siteKey = `${source.siteId}:${source.accountId || 'site'}`;
    let siteGroup = modelGroup.sites.find(site => site.key === siteKey);
    if (!siteGroup) {
      siteGroup = {
        key: siteKey,
        siteId: source.siteId,
        siteName: source.siteName,
        accountName: source.accountName,
        availableUserGroups: [],
        apiKeyNamesByGroup: new Map<string, Set<string>>(),
      };
      modelGroup.sites.push(siteGroup);
      modelGroup.siteCount += 1;
    }

    for (const userGroup of source.availableUserGroups || []) {
      if (!siteGroup.availableUserGroups.includes(userGroup)) {
        siteGroup.availableUserGroups.push(userGroup);
      }
    }

    for (const apiKey of source.availableApiKeys || []) {
      if (!siteGroup.apiKeyNamesByGroup.has(apiKey.group)) {
        siteGroup.apiKeyNamesByGroup.set(apiKey.group, new Set<string>());
      }
      siteGroup.apiKeyNamesByGroup.get(apiKey.group)!.add(apiKey.apiKeyName);
    }
  }

  const orderedModels = originalModelOrder.filter(model => grouped.has(model));
  for (const model of Array.from(grouped.keys()).sort((left, right) => left.localeCompare(right))) {
    if (!orderedModels.includes(model)) {
      orderedModels.push(model);
    }
  }

  return orderedModels
    .map(model => grouped.get(model))
    .filter((group): group is SourceDetailModelGroup => !!group);
}

function buildVendorPrioritySiteGroups(section: VendorSection | null): VendorPrioritySiteGroup[] {
  if (!section) {
    return [];
  }

  const grouped = new Map<string, VendorPrioritySiteGroup>();

  for (const displayItem of section.displayItems) {
    for (const source of displayItem.entry?.sources || []) {
      const allowedGroups = new Set(
        (source.availableUserGroups || []).map(group => group.trim()).filter(Boolean)
      );
      const eligibleApiKeys = (source.availableApiKeys || []).filter(apiKey =>
        allowedGroups.has(apiKey.group.trim())
      );

      if (allowedGroups.size === 0 || eligibleApiKeys.length === 0) {
        continue;
      }

      const siteGroup =
        grouped.get(source.siteId) ||
        (() => {
          const next: VendorPrioritySiteGroup = {
            siteId: source.siteId,
            siteName: source.siteName,
            apiKeys: [],
          };
          grouped.set(source.siteId, next);
          return next;
        })();

      for (const apiKey of eligibleApiKeys) {
        const key = buildRouteVendorApiKeyPriorityKey(
          source.siteId,
          apiKey.accountId,
          apiKey.apiKeyId
        );
        if (siteGroup.apiKeys.some(item => item.key === key)) {
          continue;
        }

        siteGroup.apiKeys.push({
          key,
          apiKeyId: apiKey.apiKeyId,
          apiKeyName: apiKey.apiKeyName,
          accountId: apiKey.accountId,
          accountName: apiKey.accountName,
          group: apiKey.group,
        });
      }
    }
  }

  return Array.from(grouped.values());
}

function createEmptyDraft(): RedirectEditorDraft {
  return {
    canonicalName: '',
    selectedOriginalModels: [],
  };
}

export function ModelRedirectionTab() {
  const {
    config,
    rebuildModelRegistry,
    syncModelRegistrySources,
    upsertMappingOverride,
    upsertDisplayItem,
    deleteDisplayItem,
    saveVendorPriorityConfig,
    deleteMappingOverride,
  } = useRouteStore(
    useShallow(store => ({
      config: store.config,
      rebuildModelRegistry: store.rebuildModelRegistry,
      syncModelRegistrySources: store.syncModelRegistrySources,
      upsertMappingOverride: store.upsertMappingOverride,
      upsertDisplayItem: store.upsertDisplayItem,
      deleteDisplayItem: store.deleteDisplayItem,
      saveVendorPriorityConfig: store.saveVendorPriorityConfig,
      deleteMappingOverride: store.deleteMappingOverride,
    }))
  );
  const [syncingSources, setSyncingSources] = useState(false);
  const [resettingDefaults, setResettingDefaults] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedVendors, setExpandedVendors] = useState<Set<RouteModelVendor>>(new Set());
  const [editorContext, setEditorContext] = useState<RedirectEditorContext | null>(null);
  const [sourceDetailState, setSourceDetailState] = useState<SourceDetailState | null>(null);
  const [priorityEditorVendor, setPriorityEditorVendor] = useState<RouteModelVendor | null>(null);
  const [priorityDraft, setPriorityDraft] = useState<{
    sitePriorities: Record<string, string>;
    apiKeyPriorities: Record<string, string>;
  }>({
    sitePriorities: {},
    apiKeyPriorities: {},
  });
  const [draft, setDraft] = useState<RedirectEditorDraft>(createEmptyDraft);
  const [errors, setErrors] = useState<RedirectEditorErrors>({});
  const [candidateQuery, setCandidateQuery] = useState('');
  const redirectNameInputId = useId();
  const searchInputId = useId();

  const registry = config?.modelRegistry;
  const vendorSections = useMemo(() => buildVendorSections(registry), [registry]);
  const shouldAutoRefreshSourceDetails = useMemo(
    () => shouldRefreshRegistrySourceDetails(registry),
    [registry]
  );
  const shouldAutoRefreshDisplayItems = useMemo(
    () => shouldRefreshRegistryDisplayItems(registry),
    [registry]
  );
  const shouldBootstrapRegistry = useMemo(
    () => vendorSections.length === 0 && !registry?.lastAggregatedAt,
    [registry?.lastAggregatedAt, vendorSections.length]
  );
  const sectionByVendor = useMemo(
    () => new Map(vendorSections.map(section => [section.vendor, section])),
    [vendorSections]
  );
  const overrideBySource = useMemo(
    () =>
      new Map<string, RouteModelMappingOverride>(
        (registry?.overrides ?? []).map(override => [override.sourceKey, override])
      ),
    [registry?.overrides]
  );
  const vendorPriorities = useMemo(
    () => registry?.vendorPriorities ?? {},
    [registry?.vendorPriorities]
  );

  const editorSection = editorContext ? (sectionByVendor.get(editorContext.vendor) ?? null) : null;
  const prioritySection = priorityEditorVendor
    ? (sectionByVendor.get(priorityEditorVendor) ?? null)
    : null;
  const sourceDetailGroups = useMemo(
    () => buildSourceDetailGroups(sourceDetailState),
    [sourceDetailState]
  );
  const prioritySiteGroups = useMemo(
    () => buildVendorPrioritySiteGroups(prioritySection),
    [prioritySection]
  );
  const sortedPrioritySiteGroups = useMemo(() => {
    const originalIndexBySiteId = new Map(
      prioritySiteGroups.map((group, index) => [group.siteId, index] as const)
    );

    return prioritySiteGroups.slice().sort((left, right) => {
      const leftPriority = parsePriorityInput(
        priorityDraft.sitePriorities[left.siteId],
        DEFAULT_ROUTE_VENDOR_SITE_PRIORITY
      );
      const rightPriority = parsePriorityInput(
        priorityDraft.sitePriorities[right.siteId],
        DEFAULT_ROUTE_VENDOR_SITE_PRIORITY
      );

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return (
        (originalIndexBySiteId.get(left.siteId) ?? Number.MAX_SAFE_INTEGER) -
        (originalIndexBySiteId.get(right.siteId) ?? Number.MAX_SAFE_INTEGER)
      );
    });
  }, [priorityDraft.sitePriorities, prioritySiteGroups]);
  const filteredCandidates = useMemo(() => {
    if (!editorSection) {
      return [];
    }

    if (!candidateQuery.trim()) {
      return editorSection.candidateGroups;
    }

    const query = candidateQuery.trim().toLowerCase();
    return editorSection.candidateGroups.filter(candidate =>
      candidate.originalModel.toLowerCase().includes(query)
    );
  }, [candidateQuery, editorSection]);

  const toggleVendor = useCallback((vendor: RouteModelVendor) => {
    setExpandedVendors(current => {
      const next = new Set(current);
      if (next.has(vendor)) {
        next.delete(vendor);
      } else {
        next.add(vendor);
      }
      return next;
    });
  }, []);

  const closeEditor = useCallback(() => {
    setEditorContext(null);
    setDraft(createEmptyDraft());
    setErrors({});
    setCandidateQuery('');
  }, []);

  const closeSourceDetails = useCallback(() => {
    setSourceDetailState(null);
  }, []);

  const closePriorityEditor = useCallback(() => {
    setPriorityEditorVendor(null);
    setPriorityDraft({
      sitePriorities: {},
      apiKeyPriorities: {},
    });
  }, []);

  const openPriorityEditor = useCallback(
    (vendor: RouteModelVendor) => {
      const section = sectionByVendor.get(vendor) ?? null;
      const siteGroups = buildVendorPrioritySiteGroups(section);
      const priorityConfig = vendorPriorities[vendor] ?? {
        sitePriorities: {},
        apiKeyPriorities: {},
      };

      setPriorityEditorVendor(vendor);
      setPriorityDraft({
        sitePriorities: Object.fromEntries(
          siteGroups.map(group => [
            group.siteId,
            String(
              priorityConfig.sitePriorities[group.siteId] ?? DEFAULT_ROUTE_VENDOR_SITE_PRIORITY
            ),
          ])
        ),
        apiKeyPriorities: Object.fromEntries(
          siteGroups.flatMap(group =>
            group.apiKeys.map(apiKey => [
              apiKey.key,
              String(
                priorityConfig.apiKeyPriorities[apiKey.key] ?? DEFAULT_ROUTE_VENDOR_API_KEY_PRIORITY
              ),
            ])
          )
        ),
      });
    },
    [sectionByVendor, vendorPriorities]
  );

  const openCreateEditor = useCallback((vendor: RouteModelVendor) => {
    setEditorContext({
      mode: 'create',
      vendor,
      initialSourceKeys: [],
    });
    setDraft(createEmptyDraft());
    setErrors({});
    setCandidateQuery('');
  }, []);

  const openEditEditor = useCallback(
    (
      vendor: RouteModelVendor,
      displayItem: RouteModelDisplayItem,
      entry: RouteModelRegistryEntry | null
    ) => {
      if (!entry) {
        toast.error('当前重定向项缺少可编辑的来源，请先同步来源或重置默认重定向');
        return;
      }

      const sourceByKey = new Map(entry.sources.map(source => [source.sourceKey, source] as const));
      const selectedOriginalModels = normalizeOriginalModelOrder(
        displayItem.originalModelOrder,
        displayItem.sourceKeys,
        sourceByKey
      );

      setEditorContext({
        mode: 'edit',
        vendor,
        displayItemId: displayItem.id,
        displayItemMode: displayItem.mode,
        initialSourceKeys: displayItem.sourceKeys,
        displayItemCreatedAt: displayItem.createdAt,
      });
      setDraft({
        canonicalName: entry.canonicalName,
        selectedOriginalModels,
      });
      setErrors({});
      setCandidateQuery('');
    },
    []
  );

  const handleSyncSources = useCallback(async () => {
    setSyncingSources(true);
    try {
      const syncedRegistry = await syncModelRegistrySources(true);
      if (!syncedRegistry) {
        throw new Error('无法同步模型来源');
      }
      toast.success('模型来源已同步，现有规则未被覆盖');
    } catch (error: unknown) {
      toast.error(`同步失败: ${getErrorMessage(error)}`);
    } finally {
      setSyncingSources(false);
    }
  }, [syncModelRegistrySources]);

  const handleResetDefaults = useCallback(async () => {
    setResettingDefaults(true);
    try {
      const rebuiltRegistry = await rebuildModelRegistry(true);
      if (!rebuiltRegistry) {
        throw new Error('无法重置默认重定向');
      }
      toast.success('默认模型重定向已重置');
    } catch (error: unknown) {
      toast.error(`重置失败: ${getErrorMessage(error)}`);
    } finally {
      setResettingDefaults(false);
    }
  }, [rebuildModelRegistry]);

  useEffect(() => {
    if (!config) {
      return;
    }

    if (shouldAutoRefreshDisplayItems) {
      void handleResetDefaults();
      return;
    }

    if (shouldAutoRefreshSourceDetails || shouldBootstrapRegistry) {
      void handleSyncSources();
    }
  }, [
    config,
    handleResetDefaults,
    handleSyncSources,
    shouldBootstrapRegistry,
    shouldAutoRefreshDisplayItems,
    shouldAutoRefreshSourceDetails,
  ]);

  const toggleOriginalModel = useCallback((originalModel: string) => {
    setDraft(current => {
      const selected = current.selectedOriginalModels.includes(originalModel)
        ? current.selectedOriginalModels.filter(item => item !== originalModel)
        : [...current.selectedOriginalModels, originalModel];

      return {
        ...current,
        selectedOriginalModels: selected,
      };
    });
    setErrors(current => ({ ...current, selectedOriginalModels: undefined }));
  }, []);

  const stopNestedScrollPropagation = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

  const handleSave = useCallback(async () => {
    if (!editorContext || !editorSection) {
      return;
    }

    const canonicalName = draft.canonicalName.trim();
    const nextErrors: RedirectEditorErrors = {};
    if (!canonicalName) {
      nextErrors.canonicalName = '请输入重定向名称';
    }

    if (draft.selectedOriginalModels.length === 0) {
      nextErrors.selectedOriginalModels = '请至少勾选一个原始模型';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const candidateMap = new Map(
      editorSection.candidateGroups.map(candidate => [candidate.originalModel, candidate])
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

    if (selectedSourceKeys.size === 0) {
      setErrors(current => ({
        ...current,
        selectedOriginalModels: '所选模型没有可写入的来源',
      }));
      return;
    }

    setSaving(true);
    try {
      const now = Date.now();
      for (const sourceKey of selectedSourceKeys) {
        const existingOverride = overrideBySource.get(sourceKey);
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

      const savedRegistry = await upsertDisplayItem({
        id: editorContext.displayItemId ?? createLocalId(),
        vendor: editorContext.vendor,
        canonicalName,
        sourceKeys: Array.from(selectedSourceKeys),
        originalModelOrder: [...draft.selectedOriginalModels],
        mode: editorContext.displayItemMode ?? 'manual',
        createdAt: editorContext.displayItemCreatedAt ?? now,
        updatedAt: now,
      });
      if (!savedRegistry) {
        throw new Error('无法保存重定向展示项');
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
    deleteMappingOverride,
    draft.canonicalName,
    draft.selectedOriginalModels,
    editorContext,
    editorSection,
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
      } catch (error: unknown) {
        toast.error(`删除失败: ${getErrorMessage(error)}`);
      } finally {
        setSaving(false);
      }
    },
    [closeEditor, deleteDisplayItem, editorContext?.displayItemId]
  );

  const handleSaveVendorPriorities = useCallback(async () => {
    if (!priorityEditorVendor) {
      return;
    }

    const priorityConfig: RouteVendorPriorityConfig = {
      sitePriorities: Object.fromEntries(
        prioritySiteGroups.map(group => [
          group.siteId,
          parsePriorityInput(
            priorityDraft.sitePriorities[group.siteId],
            DEFAULT_ROUTE_VENDOR_SITE_PRIORITY
          ),
        ])
      ),
      apiKeyPriorities: Object.fromEntries(
        prioritySiteGroups.flatMap(group =>
          group.apiKeys.map(apiKey => [
            apiKey.key,
            parsePriorityInput(
              priorityDraft.apiKeyPriorities[apiKey.key],
              DEFAULT_ROUTE_VENDOR_API_KEY_PRIORITY
            ),
          ])
        )
      ),
    };

    setSaving(true);
    try {
      const savedRegistry = await saveVendorPriorityConfig(priorityEditorVendor, priorityConfig);
      if (!savedRegistry) {
        throw new Error('无法保存站点优先级');
      }

      toast.success('站点优先级已更新');
      closePriorityEditor();
    } catch (error: unknown) {
      toast.error(`保存失败: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }, [
    closePriorityEditor,
    priorityDraft.apiKeyPriorities,
    priorityDraft.sitePriorities,
    priorityEditorVendor,
    prioritySiteGroups,
    saveVendorPriorityConfig,
  ]);

  if (!config) {
    return null;
  }

  return (
    <>
      <AppCard className="overflow-hidden">
        <AppCardContent className="p-0">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line-soft)] px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[var(--text-primary)]">
                <Layers3 className="h-4 w-4 text-[var(--accent)]" />
                <h2 className="text-sm font-semibold">模型重定向</h2>
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                同步来源不会覆盖现有规则；仅在需要重新生成每个厂商默认 3
                个重定向时，才使用重置默认重定向。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <AppButton
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleSyncSources}
                disabled={syncingSources || resettingDefaults}
              >
                {syncingSources ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span>同步来源</span>
              </AppButton>
              <AppButton
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleResetDefaults}
                disabled={resettingDefaults || syncingSources}
              >
                {resettingDefaults ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span>重置默认重定向</span>
              </AppButton>
            </div>
          </div>

          {vendorSections.length > 0 ? (
            <div className="space-y-3 p-5">
              {vendorSections.map(section => {
                const isExpanded = expandedVendors.has(section.vendor);

                return (
                  <section
                    key={section.vendor}
                    className="relative isolate overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)]/70"
                  >
                    <div className="relative z-0 flex items-center gap-3 px-4 py-4">
                      <button
                        type="button"
                        onClick={() => toggleVendor(section.vendor)}
                        aria-expanded={isExpanded}
                        className="relative z-0 flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] text-[var(--text-secondary)]">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </span>

                        <div className="grid min-w-0 flex-1 grid-cols-[160px_minmax(0,1fr)] items-center gap-4">
                          <div className="flex min-w-0 items-center gap-2">
                            <VendorIcon
                              vendor={section.vendor}
                              className="h-4 w-4 shrink-0 text-[var(--accent)]"
                            />
                            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                              {getVendorLabel(section.vendor)}
                            </h3>
                          </div>

                          <div className="flex min-w-0 justify-start">
                            <div className="scrollbar-hide flex max-w-full flex-nowrap items-center justify-start gap-2 overflow-x-auto">
                              {section.summaryItems.map(displayItem => (
                                <span
                                  key={displayItem.item.id}
                                  className="inline-flex shrink-0 items-center rounded-full border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
                                >
                                  {displayItem.displayName}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </button>

                      <div className="relative z-20 flex shrink-0 items-center gap-2">
                        <AppButton
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={event => {
                            event.stopPropagation();
                            openPriorityEditor(section.vendor);
                          }}
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                          <span>站点优先级</span>
                        </AppButton>
                        <AppButton
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={event => {
                            event.stopPropagation();
                            openCreateEditor(section.vendor);
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>新增重定向</span>
                        </AppButton>
                      </div>
                    </div>

                    {isExpanded ? (
                      <div className="relative z-10 border-t border-[var(--line-soft)] px-4 pb-4 pt-3">
                        <div className="space-y-3">
                          {section.displayItems.map(displayItem => {
                            const entry = displayItem.entry;

                            return (
                              <article
                                key={displayItem.item.id}
                                className="relative isolate rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-4"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <code className="font-mono text-[13px] font-semibold text-[var(--text-primary)]">
                                        {displayItem.displayName}
                                      </code>
                                      {displayItem.item.mode === 'manual' ? (
                                        <span className="rounded-full bg-[var(--warning-soft)] px-2 py-1 text-[11px] text-[var(--warning)]">
                                          手工新增
                                        </span>
                                      ) : (
                                        <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                                          默认槽位
                                        </span>
                                      )}
                                      {entry ? (
                                        <>
                                          <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                                            {formatSourceSummary(entry.sources)}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setSourceDetailState({
                                                entry,
                                                item: displayItem.item,
                                              })
                                            }
                                            className="relative z-20 rounded-full border border-[var(--line-soft)] bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                                          >
                                            详情
                                          </button>
                                        </>
                                      ) : (
                                        <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                                          来源待同步
                                        </span>
                                      )}
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {entry ? (
                                        entry.aliases.length > 0 ? (
                                          entry.aliases.map(alias => (
                                            <span
                                              key={alias}
                                              className="rounded-full border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-secondary)]"
                                            >
                                              {alias}
                                            </span>
                                          ))
                                        ) : (
                                          <span className="rounded-full border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-secondary)]">
                                            {entry.canonicalName}
                                          </span>
                                        )
                                      ) : (
                                        <span className="rounded-full border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-secondary)]">
                                          {displayItem.item.canonicalName}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="relative z-20 flex shrink-0 items-center gap-2 self-start">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openEditEditor(
                                          section.vendor,
                                          displayItem.item,
                                          displayItem.entry
                                        )
                                      }
                                      className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                                      aria-label={`编辑 ${displayItem.displayName}`}
                                      title="编辑模型重定向"
                                      disabled={saving}
                                    >
                                      <Edit3 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleDelete(displayItem.item.id)}
                                      className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] text-[var(--text-secondary)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
                                      aria-label={`删除 ${displayItem.displayName}`}
                                      title="删除重定向模型"
                                      disabled={saving}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 px-5 py-10 text-center">
              <div className="text-sm font-medium text-[var(--text-primary)]">暂无模型重定向</div>
              <p className="max-w-xl text-xs text-[var(--text-secondary)]">
                先同步来源拉取当前站点模型；如需重新生成每个厂商默认 3
                个重定向，再使用重置默认重定向。
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <AppButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleSyncSources}
                  disabled={syncingSources || resettingDefaults}
                >
                  立即同步来源
                </AppButton>
                <AppButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleResetDefaults}
                  disabled={resettingDefaults || syncingSources}
                >
                  重置默认重定向
                </AppButton>
              </div>
            </div>
          )}
        </AppCardContent>
      </AppCard>

      <AppModal
        isOpen={editorContext !== null}
        onClose={closeEditor}
        title={editorContext?.mode === 'edit' ? '编辑模型重定向' : '新增模型重定向'}
        size="xl"
        className="!h-[72vh] !max-h-[72vh] !max-w-4xl"
        contentClassName="!flex !min-h-0 !max-h-none !flex-1 !overflow-hidden !px-0 !py-0"
        footer={
          <div className="flex justify-end gap-2">
            <AppButton type="button" variant="secondary" onClick={closeEditor} disabled={saving}>
              取消
            </AppButton>
            <AppButton type="button" onClick={handleSave} loading={saving}>
              {editorContext?.mode === 'edit' ? '保存修改' : '新增重定向'}
            </AppButton>
          </div>
        }
      >
        <div className="flex min-h-0 flex-1 basis-0 flex-col gap-4 px-6 py-4">
          <div
            data-testid="redirect-editor-input-row"
            className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-start"
          >
            <label
              htmlFor={redirectNameInputId}
              className="text-sm font-medium text-[var(--text-primary)] md:pt-2"
            >
              重定向名称
            </label>
            <div className="min-w-0 space-y-1">
              <input
                id={redirectNameInputId}
                type="text"
                value={draft.canonicalName}
                onChange={event => {
                  setDraft(current => ({ ...current, canonicalName: event.target.value }));
                  setErrors(current => ({ ...current, canonicalName: undefined }));
                }}
                placeholder="例如：claude-sonnet-4-6"
                className={`w-full rounded-[var(--radius-md)] border bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:ring-2 ${
                  errors.canonicalName
                    ? 'border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger-soft)]'
                    : 'border-[var(--line-soft)] focus:border-[var(--accent)] focus:ring-[var(--accent-soft)]'
                }`}
                autoFocus
              />
              {errors.canonicalName ? (
                <div className="text-xs text-[var(--danger)]">{errors.canonicalName}</div>
              ) : null}
            </div>

            <label
              htmlFor={searchInputId}
              className="text-sm font-medium text-[var(--text-primary)] md:pt-2"
            >
              原始名称
            </label>
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                id={searchInputId}
                type="text"
                value={candidateQuery}
                onChange={event => setCandidateQuery(event.target.value)}
                placeholder="搜索模型..."
                aria-label="搜索原始名称"
                className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] py-2 pl-9 pr-10 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
              />
              {candidateQuery ? (
                <button
                  type="button"
                  onClick={() => setCandidateQuery('')}
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                  aria-label="清空搜索"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 basis-0 flex-col gap-2">
            <div className="flex min-h-0 flex-1 basis-0 flex-col gap-3 md:flex-row">
              <section className="flex min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] md:min-h-0 md:w-[38%] md:min-w-[18rem]">
                <div
                  data-testid="selected-original-models-header"
                  className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--line-soft)] px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      已选原始模型
                    </div>
                    <span className="rounded-full bg-[var(--surface-1)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                      已选 {draft.selectedOriginalModels.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(current => ({ ...current, selectedOriginalModels: [] }));
                      setErrors(current => ({ ...current, selectedOriginalModels: undefined }));
                    }}
                    className="text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={draft.selectedOriginalModels.length === 0}
                  >
                    清空已选
                  </button>
                </div>
                <div
                  data-testid="selected-original-models-list"
                  className="min-h-[9rem] max-h-56 overflow-y-auto overscroll-contain px-4 py-3 [scrollbar-gutter:stable] md:min-h-0 md:max-h-none md:flex-1 md:basis-0"
                  onWheelCapture={stopNestedScrollPropagation}
                >
                  {draft.selectedOriginalModels.length > 0 ? (
                    <div className="flex flex-wrap content-start gap-2">
                      {draft.selectedOriginalModels.map(originalModel => (
                        <span
                          key={originalModel}
                          className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--accent)]/20 bg-[var(--accent-soft)]/70 px-2.5 py-1"
                        >
                          <code className="truncate font-mono text-[11px] text-[var(--text-primary)]">
                            {originalModel}
                          </code>
                          <button
                            type="button"
                            onClick={() => toggleOriginalModel(originalModel)}
                            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--danger)]"
                            aria-label={`取消选择 ${originalModel}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--line-soft)] bg-[var(--surface-1)] px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
                      还没有选择原始模型
                    </div>
                  )}
                </div>
              </section>

              <section className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)]">
                <div
                  data-testid="original-model-candidate-header"
                  className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--line-soft)] px-4 py-3"
                >
                  <div className="text-sm font-medium text-[var(--text-primary)]">原始模型</div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {filteredCandidates.length} 个候选
                  </div>
                </div>
                <div
                  data-testid="original-model-candidate-list"
                  className="min-h-0 flex-1 basis-0 overflow-y-auto overscroll-contain p-3"
                  onWheelCapture={stopNestedScrollPropagation}
                >
                  <div className="space-y-2">
                    {filteredCandidates.length > 0 ? (
                      filteredCandidates.map(candidate => {
                        const checked = draft.selectedOriginalModels.includes(
                          candidate.originalModel
                        );

                        return (
                          <label
                            key={candidate.originalModel}
                            className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border px-3 py-2 transition-colors ${
                              checked
                                ? 'border-[var(--accent)] bg-[var(--accent-soft)]/60'
                                : 'border-[var(--line-soft)] bg-[var(--surface-2)] hover:border-[var(--icon-muted)]'
                            }`}
                          >
                            <span
                              className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                checked
                                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                                  : 'border-[var(--line-soft)] bg-[var(--surface-1)] text-transparent'
                              }`}
                            >
                              <Check className="h-3 w-3" />
                            </span>
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={checked}
                              onChange={() => toggleOriginalModel(candidate.originalModel)}
                            />

                            <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                              <code className="min-w-0 flex-1 font-mono text-[12px] text-[var(--text-primary)]">
                                {candidate.originalModel}
                              </code>
                              <div className="shrink-0 text-right text-[11px] text-[var(--text-secondary)]">
                                {candidate.siteCount} 站点 / {candidate.sourceCount} 来源
                              </div>
                            </div>
                          </label>
                        );
                      })
                    ) : (
                      <div className="px-3 py-8 text-center text-sm text-[var(--text-secondary)]">
                        无匹配结果
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>

            {errors.selectedOriginalModels ? (
              <div className="text-xs text-[var(--danger)]">{errors.selectedOriginalModels}</div>
            ) : null}
          </div>
        </div>
      </AppModal>

      <AppModal
        isOpen={sourceDetailState !== null}
        onClose={closeSourceDetails}
        title={sourceDetailState ? `${sourceDetailState.entry.canonicalName} 来源详情` : '来源详情'}
        size="lg"
        footer={
          <div className="flex justify-end">
            <AppButton type="button" variant="secondary" onClick={closeSourceDetails}>
              关闭
            </AppButton>
          </div>
        }
      >
        <div className="space-y-3 px-1 py-2">
          {sourceDetailGroups.map(group => (
            <section
              key={group.originalModel}
              className="rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-[13px] font-semibold text-[var(--text-primary)]">
                  {group.originalModel}
                </code>
                <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                  {group.siteCount} 站点
                </span>
                <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                  {group.sourceCount} 来源
                </span>
              </div>

              <div className="mt-3 space-y-3">
                {group.sites.map(site => (
                  <div
                    key={site.key}
                    className="rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">
                        {site.siteName}
                      </span>
                      {site.accountName ? (
                        <span className="rounded-full bg-[var(--surface-1)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                          {site.accountName}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3">
                      <div className="text-xs font-medium text-[var(--text-secondary)]">
                        可用用户分组
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {site.availableUserGroups.length > 0 ? (
                          site.availableUserGroups.map(userGroup => {
                            const apiKeyNames = Array.from(
                              site.apiKeyNamesByGroup.get(userGroup) ?? []
                            );
                            const label =
                              apiKeyNames.length > 0
                                ? `${userGroup} (${apiKeyNames.join(', ')})`
                                : userGroup;

                            return (
                              <span
                                key={`${site.key}:${userGroup}`}
                                className={`rounded-full border px-2.5 py-1 text-[11px] ${
                                  apiKeyNames.length > 0
                                    ? 'border-[var(--accent)]/25 bg-[var(--accent-soft-strong)] font-medium text-[var(--accent-strong)]'
                                    : 'border-[var(--line-soft)] bg-[var(--surface-1)] text-[var(--text-secondary)]'
                                }`}
                              >
                                {label}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-xs text-[var(--text-secondary)]">
                            当前原始模型没有可用分组
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </AppModal>

      <AppModal
        isOpen={priorityEditorVendor !== null}
        onClose={closePriorityEditor}
        title={
          priorityEditorVendor
            ? `${getVendorLabel(priorityEditorVendor)} 站点优先级（数字越小优先级越高）`
            : '站点优先级（数字越小优先级越高）'
        }
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <AppButton type="button" variant="secondary" onClick={closePriorityEditor}>
              取消
            </AppButton>
            <AppButton type="button" onClick={handleSaveVendorPriorities} loading={saving}>
              保存优先级
            </AppButton>
          </div>
        }
      >
        <div className="space-y-4 px-1 py-2">
          {sortedPrioritySiteGroups.length > 0 ? (
            sortedPrioritySiteGroups.map(siteGroup => (
              <section
                key={siteGroup.siteId}
                className="rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {siteGroup.siteName}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <span>站点优先级</span>
                    <input
                      type="number"
                      value={
                        priorityDraft.sitePriorities[siteGroup.siteId] ??
                        String(DEFAULT_ROUTE_VENDOR_SITE_PRIORITY)
                      }
                      onChange={event =>
                        setPriorityDraft(current => ({
                          ...current,
                          sitePriorities: {
                            ...current.sitePriorities,
                            [siteGroup.siteId]: event.target.value,
                          },
                        }))
                      }
                      className="w-20 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                    />
                  </label>
                </div>

                <div className="mt-4 space-y-2">
                  {siteGroup.apiKeys.map(apiKey => (
                    <div
                      key={apiKey.key}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {apiKey.apiKeyName}
                          {apiKey.accountName ? ` (${apiKey.accountName})` : ''}
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                          用户分组：{apiKey.group}
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <span>API key 优先级</span>
                        <input
                          type="number"
                          value={
                            priorityDraft.apiKeyPriorities[apiKey.key] ??
                            String(DEFAULT_ROUTE_VENDOR_API_KEY_PRIORITY)
                          }
                          onChange={event =>
                            setPriorityDraft(current => ({
                              ...current,
                              apiKeyPriorities: {
                                ...current.apiKeyPriorities,
                                [apiKey.key]: event.target.value,
                              },
                            }))
                          }
                          className="w-20 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-4 py-6 text-sm text-[var(--text-secondary)]">
              当前厂商还没有可配置优先级的可用站点或 API key。
            </div>
          )}
        </div>
      </AppModal>
    </>
  );
}
