/**
 * 站点管理独立页面
 * 从 App.tsx 提取的站点管理核心逻辑和 UI
 *
 * 并发刷新: 使用 detectingSites (Set) 为每个 SiteCard 计算独立的 isDetecting 布尔值
 */

import Logger from '../utils/logger';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Server,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  RefreshCw,
  Search,
  X,
  ChevronsUpDown,
  Calendar,
} from 'lucide-react';
import { SiteEditor } from '../components/SiteEditor';
import { AddAccountDialog } from '../components/AddAccountDialog';
import { SiteCard } from '../components/SiteCard';
import { SiteListHeader } from '../components/SiteListHeader';
import {
  SiteGroupDialog,
  BackupSelectDialog,
  UnifiedCliConfigDialog,
  AutoRefreshDialog,
  ApplyConfigPopover,
} from '../components/dialogs';
import type { CliConfig } from '../../shared/types/cli-config';
import { CreateApiKeyDialog } from '../components/CreateApiKeyDialog';
import { AppButton } from '../components/AppButton/AppButton';
import { DataTableBody } from '../components/DataTable/DataTable';
import {
  useSiteGroups,
  useCheckIn,
  useTokenManagement,
  useSiteDrag,
  useSiteDetection,
  useCliCompatTest,
  useDateString,
} from '../hooks';
import type { NewApiTokenForm } from '../hooks';
import { getGroupTextColor } from '../utils/groupStyle';
import { normalizeSiteSortField } from '../utils/siteSort';
import { getSiteDailyStats } from '../utils/siteDailyStats';
import type { SiteConfig, DetectionResult } from '../../shared/types/site';
import type { Config, SiteGroup } from '../App';

import { useConfigStore } from '../store/configStore';
import { useDetectionStore } from '../store/detectionStore';
import { useUIStore } from '../store/uiStore';
import { toast } from '../store/toastStore';
import { DialogState, initialDialogState } from '../components/ConfirmDialog';

// 备份信息类型
interface BackupInfo {
  filename: string;
  path: string;
  timestamp: Date;
  size: number;
}

// 账户信息（来自 accounts:list IPC）
interface AccountInfo {
  id: string;
  account_name: string;
  user_id: string;
  username?: string;
  access_token?: string;
  status: string;
  auth_source: string;
  browser_profile_path?: string;
  auto_refresh?: boolean;
  auto_refresh_interval?: number;
}

interface AutoRefreshDialogTarget {
  site: SiteConfig;
  account: AccountInfo | null;
  label: string;
  currentInterval: number;
}

interface EditingAccountInfo {
  id: string;
  account_name?: string;
  user_id?: string;
  access_token?: string;
}

interface CardOperationContext {
  cardKey: string;
  accountId?: string;
  accountName?: string;
  accessToken?: string;
  userId?: string;
}

/** 生成 per-account 复合 key */
function makeCardKey(siteName: string, accountId?: string): string {
  return accountId ? `${siteName}::${accountId}` : siteName;
}

const EMPTY_SELECTED_MODELS = new Set<string>();

/** 展平后的卡片条目 */
interface FlattenedCardItem {
  site: SiteConfig;
  index: number;
  siteResult?: DetectionResult;
  account: AccountInfo | null;
  cardKey: string;
}

interface SitesPageProps {
  setPageHeaderActions?: (actions: React.ReactNode | null) => void;
}

export function SitesPage({ setPageHeaderActions }: SitesPageProps) {
  // ========== 从 Store 读取状态 ==========
  const {
    config,
    setConfig,
    setSaving,
    addSite: storeAddSite,
    updateSite: storeUpdateSite,
    deleteSite: storeDeleteSite,
  } = useConfigStore();

  const { apiKeys, userGroups, modelPricing, setApiKeys, setUserGroups, setModelPricing } =
    useDetectionStore();

  const {
    showSiteEditor,
    setShowSiteEditor,
    editingSite,
    setEditingSite,
    expandedSites,
    setExpandedSites,
    toggleSiteExpanded,
    showTokens,
    toggleTokenVisibility,
    selectedGroup,
    setSelectedGroup,
    activeSiteGroupFilter,
    setActiveSiteGroupFilter,
    modelSearch,
    globalModelSearch,
    setModelSearch: setModelSearchStore,
    setGlobalModelSearch,
    clearAllModelSearch,
    refreshMessage,
    checkingIn,
    setCheckingIn,
    draggedGroupIndex,
    setDraggedGroupIndex,
    dragOverGroupIndex,
    setDragOverGroupIndex,
    creatingTokenSite,
    creatingTokenCardKey,
    openCreateTokenDialog,
    closeCreateTokenDialog,
    tokenDialogVersion,
    newTokenForm,
    setNewTokenForm: setNewTokenFormStore,
    creatingToken,
    setCreatingToken,
    deletingTokenKey,
    setDeletingTokenKey,
    setDialogState,
    authErrorSites,
    setAuthErrorSites,
    setShowAuthErrorDialog,
    processingAuthErrorSite,
    setProcessingAuthErrorSite,
    columnWidths,
    setColumnWidth,
    sortField,
    sortOrder,
    toggleSort,
    resetSort,
  } = useUIStore();

  // 备份选择对话框状态
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [backupList, setBackupList] = useState<BackupInfo[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);

  // CLI 配置对话框状态
  const [showCliConfigDialog, setShowCliConfigDialog] = useState(false);
  const [cliConfigSite, setCliConfigSite] = useState<SiteConfig | null>(null);
  const [cliConfigCardKey, setCliConfigCardKey] = useState<string | null>(null);
  const [cliConfigAccountId, setCliConfigAccountId] = useState<string | null>(null);
  const [cliConfigSiteResult, setCliConfigSiteResult] = useState<DetectionResult | null>(null);
  const [cliApplySite, setCliApplySite] = useState<SiteConfig | null>(null);
  const [cliApplyCardKey, setCliApplyCardKey] = useState<string | null>(null);
  const [cliApplyAnchorEl, setCliApplyAnchorEl] = useState<HTMLElement | null>(null);
  const [tokenOperationContext, setTokenOperationContext] = useState<CardOperationContext | null>(
    null
  );

  // 自动刷新对话框状态
  const [autoRefreshDialogTarget, setAutoRefreshDialogTarget] =
    useState<AutoRefreshDialogTarget | null>(null);
  const [addAccountSite, setAddAccountSite] = useState<SiteConfig | null>(null);
  const [editingAccount, setEditingAccount] = useState<EditingAccountInfo | null>(null);

  // 多账户: 按站点 ID 预加载的账户列表
  const [accountsBySite, setAccountsBySite] = useState<Record<string, AccountInfo[]>>({});
  const [selectedModelsByCard, setSelectedModelsByCard] = useState<Record<string, Set<string>>>({});
  const dateStr = useDateString();

  // 兼容层
  const setNewTokenForm = (form: NewApiTokenForm | ((p: NewApiTokenForm) => NewApiTokenForm)) => {
    if (typeof form === 'function') {
      setNewTokenFormStore(form(newTokenForm));
    } else {
      setNewTokenFormStore(form);
    }
  };

  const visibleColumnWidths = useMemo(() => columnWidths, [columnWidths]);

  const effectiveSortField = normalizeSiteSortField(sortField);

  // 排序设置变化时保存到 config
  const sortSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (!configRef.current) return;
    if (sortSaveTimeoutRef.current) {
      clearTimeout(sortSaveTimeoutRef.current);
    }
    sortSaveTimeoutRef.current = setTimeout(async () => {
      const currentConfig = configRef.current;
      if (!currentConfig) return;
      const currentSort = currentConfig.settings?.sort;
      const newSort = { field: effectiveSortField, order: sortOrder };
      if (currentSort?.field !== newSort.field || currentSort?.order !== newSort.order) {
        const newSettings = { ...currentConfig.settings, sort: newSort };
        try {
          await window.electronAPI.saveConfig({ ...currentConfig, settings: newSettings });
          setConfig({ ...currentConfig, settings: newSettings });
        } catch (error) {
          Logger.error('保存排序设置失败:', error);
        }
      }
    }, 500);
    return () => {
      if (sortSaveTimeoutRef.current) {
        clearTimeout(sortSaveTimeoutRef.current);
      }
    };
  }, [effectiveSortField, sortOrder, setConfig]);

  // 多账户: 预加载所有站点的账户列表
  const loadAllAccounts = useCallback(
    async (overrideSites?: SiteConfig[]) => {
      const sites = overrideSites || config?.sites;
      if (!sites) return;
      const sitesWithId = sites.filter(s => s.id);
      if (sitesWithId.length === 0) return;

      const newAccountsBySite: Record<string, AccountInfo[]> = {};

      await Promise.all(
        sitesWithId.map(async site => {
          try {
            const listRes = await window.electronAPI.accounts?.list(site.id!);
            if (listRes?.success && listRes.data) {
              newAccountsBySite[site.id!] = listRes.data;
            }
          } catch {
            // ignore per-site errors
          }
        })
      );

      setAccountsBySite(newAccountsBySite);
    },
    [config?.sites]
  );

  useEffect(() => {
    loadAllAccounts();
  }, [loadAllAccounts]);

  const siteBeingEdited = editingSite !== null ? config?.sites[editingSite] : undefined;

  const resolvedEditingAccount = editingAccount ?? null;

  // 切换分组选择
  const toggleGroupFilter = (siteName: string, groupName: string | null) => {
    const current = selectedGroup[siteName];
    setSelectedGroup(siteName, current === groupName ? null : groupName);
  };

  const getSelectedModelsForCard = useCallback(
    (cardKey: string) => selectedModelsByCard[cardKey] || EMPTY_SELECTED_MODELS,
    [selectedModelsByCard]
  );

  const getCardContext = useCallback(
    (cardKey: string, account?: AccountInfo | null): CardOperationContext => ({
      cardKey,
      accountId: account?.id,
      accountName: account?.account_name,
      accessToken: account?.access_token,
      userId: account?.user_id,
    }),
    []
  );

  const closeCreateTokenDialogWithContext = useCallback(() => {
    closeCreateTokenDialog();
    setTokenOperationContext(null);
  }, [closeCreateTokenDialog]);

  const handleOpenCreateTokenDialog = (site: SiteConfig, context?: CardOperationContext) => {
    const accessToken = context?.accessToken ?? site.system_token;
    const userId = context?.userId ?? site.user_id;
    if (!accessToken || !userId) {
      toast.warning('当前账户未配置系统 Token 或用户 ID，请先在“编辑站点”中填写。');
      return;
    }
    setTokenOperationContext(context || { cardKey: site.name });
    openCreateTokenDialog(site, context?.cardKey);
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} 已复制到剪贴板`);
    } catch (error) {
      Logger.error('复制失败:', error);
      toast.error('复制失败: ' + error);
    }
  };

  // saveConfig
  const saveConfig = async (newConfig: Config) => {
    try {
      setSaving(true);
      await window.electronAPI.saveConfig(newConfig);
      setConfig(newConfig);
    } catch (error) {
      Logger.error('保存配置失败:', error);
      toast.error('保存配置失败: ' + error);
    } finally {
      setSaving(false);
    }
  };

  const updateLocalAccountAutoRefresh = useCallback(
    (
      siteId: string,
      accountId: string,
      updates: Pick<AccountInfo, 'auto_refresh' | 'auto_refresh_interval'>
    ) => {
      setAccountsBySite(prev => {
        const siteAccounts = prev[siteId];
        if (!siteAccounts) return prev;
        return {
          ...prev,
          [siteId]: siteAccounts.map(account =>
            account.id === accountId ? { ...account, ...updates } : account
          ),
        };
      });

      const latestConfig = useConfigStore.getState().config;
      if (!latestConfig?.accounts) return;
      setConfig({
        ...latestConfig,
        accounts: latestConfig.accounts.map(account =>
          account.id === accountId ? { ...account, ...updates } : account
        ),
      });
    },
    [setConfig]
  );

  const openAutoRefreshDialog = useCallback((site: SiteConfig, account?: AccountInfo | null) => {
    const currentInterval = account?.auto_refresh_interval ?? site.auto_refresh_interval ?? 30;
    const label = account ? `${site.name} / ${account.account_name}` : site.name;
    setAutoRefreshDialogTarget({
      site,
      account: account || null,
      label,
      currentInterval,
    });
  }, []);

  // 弹窗辅助函数
  const showDialog = (options: Partial<DialogState> & { message: string }): Promise<boolean> => {
    return new Promise(resolve => {
      setDialogState({
        isOpen: true,
        type: options.type || 'confirm',
        title: options.title,
        message: options.message,
        confirmText: options.confirmText,
        cancelText: options.cancelText,
        onConfirm: () => {
          setDialogState(initialDialogState);
          resolve(true);
        },
        onCancel: () => {
          setDialogState(initialDialogState);
          resolve(false);
        },
      });
    });
  };

  const showAlert = (
    message: string,
    type: 'success' | 'error' | 'alert' | 'warning' = 'alert',
    title?: string,
    content?: React.ReactNode
  ) => {
    setDialogState({
      isOpen: true,
      type,
      title,
      message,
      content,
      onConfirm: () => setDialogState(initialDialogState),
    });
  };

  // 站点拖拽 hook
  const {
    dragOverIndex,
    dragOverGroupId,
    setDragOverGroupId,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDropOnGroup,
  } = useSiteDrag({ config, saveConfig });

  // 站点检测 hook
  const { detecting, detectingSites, results, setResults, detectSingle, detectAllSites } =
    useSiteDetection({
      onAuthError: sites => {
        setAuthErrorSites(sites);
        setShowAuthErrorDialog(true);
      },
      showDialog,
    });

  // CLI 兼容性测试 hook
  const {
    testSite: testCliCompatSite,
    isTestingSite: isCliTestingSite,
    getCompatibility,
    getCliConfig,
    setCliConfig,
  } = useCliCompatTest();

  // 规范化站点分组配置
  const siteGroups: SiteGroup[] = (() => {
    if (
      !config?.siteGroups ||
      !Array.isArray(config.siteGroups) ||
      config.siteGroups.length === 0
    ) {
      return [{ id: 'default', name: '默认分组' }];
    }
    return config.siteGroups;
  })();
  const defaultGroupId: string = siteGroups.find(g => g.id === 'default')?.id || siteGroups[0].id;

  // 站点分组管理 hook
  const {
    showCreateGroupDialog,
    newGroupName,
    setNewGroupName,
    showEditGroupDialog,
    editingGroup,
    editGroupName,
    setEditGroupName,
    openCreateGroupDialog,
    openEditGroupDialog,
    closeCreateGroupDialog,
    closeEditGroupDialog,
    confirmCreateSiteGroup,
    confirmEditSiteGroup,
    deleteSiteGroup,
    toggleSiteGroupFilter,
  } = useSiteGroups({
    config,
    saveConfig,
    showDialog,
    showAlert,
    activeSiteGroupFilter,
    setActiveSiteGroupFilter,
    defaultGroupId,
  });

  // 站点操作
  const addSite = async (site: SiteConfig) => {
    await storeAddSite(site);
    setTimeout(async () => {
      try {
        await detectSingle(site, false);
      } catch (error: any) {
        Logger.error('新站点数据刷新失败:', error.message);
      } finally {
        try {
          await window.electronAPI.closeLoginBrowser?.();
        } catch (err) {
          Logger.warn('自动关闭登录浏览器失败:', err);
        }
      }
    }, 300);
  };

  const deleteSite = async (index: number) => {
    if (!config) return;
    const siteName = config.sites[index]?.name || '该站点';
    const confirmed = await showDialog({
      type: 'warning',
      title: '删除站点',
      message: `确定要删除「${siteName}」吗？\n此操作不可恢复。`,
      confirmText: '删除',
    });
    if (!confirmed) return;
    await storeDeleteSite(index);
  };

  const handleDetectAllSites = async () => {
    if (!config) return;
    await detectAllSites(config, accountsBySite);
  };

  // 签到逻辑 hook
  const { handleCheckIn, handleCheckInAll } = useCheckIn({
    showDialog,
    showAlert,
    setCheckingIn,
  });

  // 令牌管理 hook
  const {
    refreshSiteApiKeys,
    handleDeleteToken: deleteToken,
    handleCreateTokenSubmit: createToken,
  } = useTokenManagement({
    results,
    setResults,
    setApiKeys,
    showDialog,
    showAlert,
  });

  const handleDeleteToken = (
    site: SiteConfig,
    token: any,
    tokenIndex: number,
    context?: CardOperationContext
  ) => {
    deleteToken(site, token, tokenIndex, setDeletingTokenKey, context);
  };

  const handleCreateTokenSubmit = () => {
    if (!creatingTokenSite) return;
    createToken(
      creatingTokenSite,
      newTokenForm,
      setCreatingToken,
      closeCreateTokenDialogWithContext,
      tokenOperationContext || { cardKey: creatingTokenCardKey || creatingTokenSite.name }
    );
  };

  const openExtraLink = async (url: string) => {
    try {
      await window.electronAPI.openUrl(url);
    } catch (error) {
      Logger.error('打开加油站链接失败:', error);
      toast.error('打开加油站链接失败: ' + error);
    }
  };

  const handleOpenSite = async (site: SiteConfig, accountId?: string) => {
    const siteUrl = site.url.replace(/\/$/, '');

    try {
      const openResult = await window.electronAPI.browserProfile?.openSite(
        site.id,
        siteUrl,
        accountId
      );

      if (openResult?.success) {
        return;
      }

      if (openResult?.error) {
        showAlert(`打开站点失败：${openResult.error}`, 'error');
        return;
      }

      await window.electronAPI.openUrl(siteUrl);
    } catch (error: any) {
      Logger.error('打开站点失败:', error);
      showAlert(`打开站点失败：${error?.message || error}`, 'error');
    }
  };

  const toggleModelSelection = useCallback((cardKey: string, model: string) => {
    setSelectedModelsByCard(prev => {
      const current = prev[cardKey] || new Set<string>();
      const next = new Set(current);
      if (next.has(model)) {
        next.delete(model);
      } else {
        next.add(model);
      }

      return {
        ...prev,
        [cardKey]: next,
      };
    });
  }, []);

  const clearSelectedModels = useCallback((cardKey: string) => {
    setSelectedModelsByCard(prev => {
      if (!prev[cardKey] || prev[cardKey].size === 0) {
        return prev;
      }

      return {
        ...prev,
        [cardKey]: new Set<string>(),
      };
    });
  }, []);

  const copySelectedModels = async (cardKey: string) => {
    const selectedModels = getSelectedModelsForCard(cardKey);
    if (selectedModels.size === 0) {
      toast.warning('请先选择要复制的模型');
      return;
    }
    const modelsText = Array.from(selectedModels).join(',');
    try {
      await navigator.clipboard.writeText(modelsText);
      toast.success(`已复制 ${selectedModels.size} 个模型到剪贴板`);
    } catch (error) {
      Logger.error('复制失败:', error);
      toast.error('复制失败: ' + error);
    }
  };

  // 全局模型搜索
  const expandDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // 分组标签拖拽排序
  const handleGroupDragStart = (e: React.DragEvent, index: number) => {
    e.stopPropagation();
    setDraggedGroupIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    (e.target as HTMLElement).style.opacity = '0.5';
  };

  const handleGroupDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).style.opacity = '1';
    setDraggedGroupIndex(null);
    setDragOverGroupIndex(null);
  };

  const handleGroupDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedGroupIndex !== null && draggedGroupIndex !== index) {
      setDragOverGroupIndex(index);
    }
  };

  const handleGroupDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverGroupIndex(null);
  };

  const handleGroupDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    if (!config || draggedGroupIndex === null || draggedGroupIndex === dropIndex) {
      setDragOverGroupIndex(null);
      return;
    }

    const currentGroups =
      Array.isArray(config.siteGroups) && config.siteGroups.length > 0
        ? [...config.siteGroups]
        : [{ id: 'default', name: '默认分组' }];

    const [draggedGroup] = currentGroups.splice(draggedGroupIndex, 1);
    currentGroups.splice(dropIndex, 0, draggedGroup);

    await saveConfig({ ...config, siteGroups: currentGroups });
    setDragOverGroupIndex(null);
  };

  // 展开站点（cardKey 可以是 siteName 或 siteName::accountId）
  const handleExpandSite = (cardKey: string) => {
    const isExpanding = !expandedSites.has(cardKey);
    toggleSiteExpanded(cardKey);

    if (isExpanding) {
      // 尝试从 flattenedCards 找到对应的检测结果
      const card = flattenedCards.find(c => c.cardKey === cardKey);
      const siteResult = card?.siteResult;
      if (siteResult) {
        setApiKeys(cardKey, siteResult.apiKeys || []);
        setUserGroups(cardKey, siteResult.userGroups || {});
        setModelPricing(cardKey, siteResult.modelPricing || { data: {} });
      }
    }
  };

  const handleToggleAllExpanded = () => {
    if (!config) return;
    const allCardKeys = flattenedCards.map(c => c.cardKey);
    const allExpanded = allCardKeys.every(key => expandedSites.has(key));

    if (allExpanded) {
      setExpandedSites(new Set());
    } else {
      flattenedCards.forEach(card => {
        if (card.siteResult) {
          setApiKeys(card.cardKey, card.siteResult.apiKeys || []);
          setUserGroups(card.cardKey, card.siteResult.userGroups || {});
          setModelPricing(card.cardKey, card.siteResult.modelPricing || { data: {} });
        }
      });
      setExpandedSites(new Set(allCardKeys));
    }
  };

  // 检查站点是否有匹配全局搜索的模型
  const siteHasMatchingModels = (
    site: SiteConfig,
    siteResult?: DetectionResult,
    storeKey: string = site.name
  ): boolean => {
    if (!globalModelSearch) return true;
    const searchTerm = globalModelSearch.toLowerCase();
    let models = siteResult?.models || [];
    const pricing = modelPricing[storeKey] || modelPricing[site.name];
    if (pricing?.data && typeof pricing.data === 'object') {
      const pricingModels = Object.keys(pricing.data);
      if (pricingModels.length > models.length) {
        models = pricingModels;
      }
      // 排除用户无权访问的模型（enable_groups 须与 userGroups 有交集）
      const siteGroups = userGroups[storeKey] || userGroups[site.name];
      const groupKeys =
        siteGroups && Object.keys(siteGroups).length > 0 ? new Set(Object.keys(siteGroups)) : null;
      models = models.filter(m => {
        const modelData = pricing.data[m];
        if (!modelData) return true;
        const eg = modelData.enable_groups;
        if (!eg || eg.length === 0) return false;
        return !groupKeys || eg.some((g: string) => groupKeys.has(g));
      });
    }
    return models.some(m => m.toLowerCase().includes(searchTerm));
  };

  // 获取站点的排序值
  const getSortValue = useCallback(
    (site: SiteConfig, siteResult?: DetectionResult): number | string => {
      if (!effectiveSortField) return 0;

      const dailyStats = getSiteDailyStats(siteResult, new Date());

      const apiModelCount = siteResult?.models?.length || 0;
      const storeKey = makeCardKey(site.name, siteResult?.accountId);
      const pricing = modelPricing[storeKey] || modelPricing[site.name];
      const pricingModelCount = pricing?.data ? Object.keys(pricing.data).length : 0;
      const modelCount = Math.max(apiModelCount, pricingModelCount);

      const lastSyncTime = siteResult?.lastRefresh || 0;

      switch (effectiveSortField) {
        case 'name':
          return site.name.toLowerCase();
        case 'balance':
          return siteResult?.balance ?? -Infinity;
        case 'todayUsage':
          return dailyStats.todayUsage;
        case 'totalTokens':
          return dailyStats.todayTotalTokens;
        case 'modelCount':
          return modelCount;
        case 'lastUpdate':
          return lastSyncTime ? new Date(lastSyncTime).getTime() : 0;
        case 'ldcRatio': {
          const rate = siteResult?.ldcExchangeRate;
          if (!rate || !siteResult?.ldcPaymentSupported) return -Infinity;
          const ratio = parseFloat(rate);
          return isNaN(ratio) ? -Infinity : ratio;
        }
        default:
          return 0;
      }
    },
    [effectiveSortField, modelPricing, dateStr]
  );

  // 排序后的站点列表
  const sortedSites = useMemo(() => {
    if (!config?.sites) return [];

    const sitesWithIndex = config.sites.map((site, index) => {
      const siteResults = results.filter(r => r.name === site.name);
      const sortMetric =
        effectiveSortField && effectiveSortField !== 'name'
          ? siteResults.reduce<number>(
              (best, result) => Math.max(best, Number(getSortValue(site, result))),
              Number(getSortValue(site, undefined))
            )
          : 0;
      return { site, index, siteResult: siteResults[0], sortMetric };
    });

    if (!effectiveSortField) return sitesWithIndex;

    return [...sitesWithIndex].sort((a, b) => {
      if (effectiveSortField === 'name') {
        const comparison = a.site.name.toLowerCase().localeCompare(b.site.name.toLowerCase());
        return sortOrder === 'asc' ? comparison : -comparison;
      }

      const comparison = a.sortMetric - b.sortMetric;
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [config?.sites, results, effectiveSortField, sortOrder, getSortValue, dateStr]);

  // 展平为 per-account 卡片列表
  const flattenedCards: FlattenedCardItem[] = useMemo(() => {
    const items: FlattenedCardItem[] = [];

    for (const { site, index, siteResult } of sortedSites) {
      const siteId = site.id;
      const accounts = siteId ? accountsBySite[siteId] : undefined;

      if (accounts && accounts.length > 0) {
        // 站点有账户：每个账户一张卡片
        for (const account of accounts) {
          const key = makeCardKey(site.name, account.id);
          // 查找该账户的检测结果
          const accountResult = results.find(
            r => r.name === site.name && r.accountId === account.id
          ); // 严格 per-account 查找，不 fallback 到站点级结果
          items.push({
            site,
            index,
            siteResult: accountResult,
            account,
            cardKey: key,
          });
        }
      } else {
        // 站点没有账户：保持单张卡片
        items.push({
          site,
          index,
          siteResult,
          account: null,
          cardKey: site.name,
        });
      }
    }

    return items;
  }, [sortedSites, accountsBySite, results]);

  // 每个站点的首张卡片 key（用于仅在默认账户卡片上显示「添加账户」按钮）
  const firstCardKeyPerSite = useMemo(() => {
    const seen = new Set<string>();
    const first = new Set<string>();
    for (const { site, cardKey } of flattenedCards) {
      const siteId = site.id || site.name;
      if (!seen.has(siteId)) {
        seen.add(siteId);
        first.add(cardKey);
      }
    }
    return first;
  }, [flattenedCards]);

  // 全局模型搜索（需要放在 flattenedCards 之后）
  const handleGlobalModelSearchChange = useCallback(
    (value: string) => {
      if (Object.values(modelSearch).some(text => text && text.trim() !== '')) {
        clearAllModelSearch();
      }

      setGlobalModelSearch(value);

      if (expandDebounceRef.current) {
        clearTimeout(expandDebounceRef.current);
      }

      if (!value) {
        setExpandedSites(new Set());
      } else if (flattenedCards.length > 0) {
        expandDebounceRef.current = setTimeout(() => {
          flattenedCards.forEach(card => {
            if (card.siteResult) {
              setApiKeys(card.cardKey, card.siteResult.apiKeys || []);
              setUserGroups(card.cardKey, card.siteResult.userGroups || {});
              setModelPricing(card.cardKey, card.siteResult.modelPricing || { data: {} });
            }
          });
        }, 100);
      }
    },
    [
      modelSearch,
      clearAllModelSearch,
      setGlobalModelSearch,
      setExpandedSites,
      flattenedCards,
      setApiKeys,
      setUserGroups,
      setModelPricing,
    ]
  );

  // 打开备份列表
  const handleOpenBackupDialog = async () => {
    setLoadingBackups(true);
    setShowBackupDialog(true);
    try {
      const backups = (await (window.electronAPI as any).backup?.list?.()) || [];
      setBackupList(backups);
    } catch (error) {
      Logger.error('获取备份列表失败:', error);
      setBackupList([]);
    } finally {
      setLoadingBackups(false);
    }
  };

  const pageHeaderActions = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <AppButton
          variant="primary"
          size="sm"
          onClick={() => {
            setEditingSite(null);
            setEditingAccount(null);
            setShowSiteEditor(true);
          }}
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          添加站点
        </AppButton>
        <AppButton
          variant="secondary"
          size="sm"
          onClick={handleOpenBackupDialog}
          title="从备份文件恢复站点配置"
        >
          <RefreshCw className="w-4 h-4" strokeWidth={2.5} />
          恢复站点
        </AppButton>
      </div>
    ),
    [handleOpenBackupDialog, setEditingSite, setShowSiteEditor]
  );

  useEffect(() => {
    setPageHeaderActions?.(pageHeaderActions);
    return () => setPageHeaderActions?.(null);
  }, [pageHeaderActions, setPageHeaderActions]);

  // 如果没有config，不渲染（由App.tsx保证有config才渲染页面）
  if (!config) return null;

  return (
    <>
      <div className="flex-1 overflow-y-hidden overflow-x-visible flex">
        <div className="flex-1 flex flex-col">
          {/* 站点分组控制栏 */}
          {config.sites.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--line-soft)] px-4 pb-1 pt-2 text-[13px] text-[var(--text-secondary)]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-[var(--text-primary)]">站点分组</span>
                <button
                  onClick={() => setActiveSiteGroupFilter(null)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[13px] transition-all ${
                    activeSiteGroupFilter === null
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                      : 'border-[var(--line-soft)] bg-[var(--surface-1)]/88 hover:border-[color-mix(in_srgb,var(--accent)_28%,var(--line-soft))]'
                  }`}
                  title="显示全部站点"
                >
                  <span className="font-semibold">全部</span>
                  <span
                    className={`text-xs ${activeSiteGroupFilter === null ? 'text-white/80' : 'text-[var(--text-tertiary)]'}`}
                  >
                    {config.sites.length} 个
                  </span>
                </button>
                {siteGroups.map((group, groupIndex) => {
                  const groupId = group.id;
                  const isActive = activeSiteGroupFilter === groupId;
                  const groupSitesCount = config.sites.filter(
                    s => (s.group || defaultGroupId) === groupId
                  ).length;
                  const colorClass = getGroupTextColor(group.name);
                  const isDefaultGroup = groupId === defaultGroupId;
                  const isDragOverForSort =
                    dragOverGroupIndex === groupIndex && draggedGroupIndex !== null;
                  return (
                    <div
                      key={groupId}
                      draggable
                      onDragStart={e => handleGroupDragStart(e, groupIndex)}
                      onDragEnd={handleGroupDragEnd}
                      className={`group/tag inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[13px] transition-all cursor-grab active:cursor-grabbing ${
                        isActive
                          ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                          : isDragOverForSort
                            ? 'scale-105 border-[var(--accent)] bg-[var(--accent-soft)]'
                            : dragOverGroupId === groupId
                              ? 'border-[color-mix(in_srgb,var(--accent)_36%,var(--line-soft))] bg-[var(--surface-2)]'
                              : 'border-[var(--line-soft)] bg-[var(--surface-1)]/88 hover:border-[color-mix(in_srgb,var(--accent)_28%,var(--line-soft))]'
                      }`}
                      onDragOver={e => {
                        e.preventDefault();
                        if (draggedGroupIndex !== null) {
                          handleGroupDragOver(e, groupIndex);
                        } else {
                          setDragOverGroupId(groupId);
                        }
                      }}
                      onDragLeave={e => {
                        e.preventDefault();
                        if (draggedGroupIndex !== null) {
                          handleGroupDragLeave(e);
                        } else {
                          if (dragOverGroupId === groupId) {
                            setDragOverGroupId(null);
                          }
                        }
                      }}
                      onDrop={e => {
                        if (draggedGroupIndex !== null) {
                          handleGroupDrop(e, groupIndex);
                        } else {
                          handleDropOnGroup(e, groupId);
                        }
                      }}
                      onClick={() => toggleSiteGroupFilter(groupId)}
                      title={
                        isActive
                          ? '点击显示全部站点'
                          : `点击只显示「${group.name}」分组的站点\n拖动站点卡片到此可移动分组\n拖动分组标签可调整顺序`
                      }
                    >
                      <span
                        className={`flex items-center gap-1 ${isActive ? 'text-white' : colorClass}`}
                      >
                        <span className="font-semibold">{group.name}</span>
                      </span>
                      <span
                        className={`text-xs ${isActive ? 'text-white/80' : 'text-[var(--text-tertiary)]'}`}
                      >
                        {groupSitesCount} 个
                      </span>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          openEditGroupDialog(group);
                        }}
                        className={`hidden rounded p-0.5 transition-colors group-hover/tag:block ${isActive ? 'text-white/80 hover:bg-white/20 hover:text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]'}`}
                        title="编辑分组名称"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      {!isDefaultGroup && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            deleteSiteGroup(groupId);
                          }}
                          className={`hidden rounded p-0.5 transition-colors group-hover/tag:block ${isActive ? 'text-white/80 hover:bg-white/20 hover:text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--accent-soft)] hover:text-[var(--danger)]'}`}
                          title="删除分组"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
                <AppButton
                  variant="tertiary"
                  size="sm"
                  onClick={openCreateGroupDialog}
                  title="新建分组"
                >
                  <Plus className="w-3 h-3" />
                  新建分组
                </AppButton>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
                  <input
                    value={globalModelSearch}
                    onChange={e => handleGlobalModelSearchChange(e.target.value)}
                    placeholder="搜索可用模型（全局）"
                    className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-1)]/88 py-2 pl-8 pr-7 text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  {globalModelSearch && (
                    <button
                      onClick={() => handleGlobalModelSearchChange('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                      title="清空全局搜索"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 站点列表区域 */}
          <div className="relative z-0 flex-1 space-y-3 overflow-x-visible overflow-y-auto px-4 pb-4">
            {config.sites.length === 0 ? (
              <div className="py-16 text-center text-[var(--text-secondary)]">
                <Server className="w-16 h-16 mx-auto mb-4 opacity-30" strokeWidth={1.5} />
                <p className="text-lg font-medium mb-2">还没有添加任何站点</p>
                <p className="text-sm mb-4">点击"添加站点"按钮开始</p>
                <div className="flex items-center justify-center gap-2">
                  <AppButton
                    variant="primary"
                    onClick={() => {
                      setEditingSite(null);
                      setEditingAccount(null);
                      setShowSiteEditor(true);
                    }}
                  >
                    <Plus className="w-4 h-4" strokeWidth={2.5} />
                    添加站点
                  </AppButton>
                  <AppButton variant="secondary" onClick={handleOpenBackupDialog}>
                    从备份恢复站点
                  </AppButton>
                </div>
                <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                  从备份目录选择配置文件进行恢复
                </p>
              </div>
            ) : (
              <>
                <SiteListHeader
                  columnWidths={visibleColumnWidths}
                  onColumnWidthChange={setColumnWidth}
                  sortField={effectiveSortField}
                  sortOrder={sortOrder}
                  onToggleSort={toggleSort}
                  onResetSort={resetSort}
                  actions={
                    <div className="ml-1 flex shrink-0 items-center gap-0.5">
                      <button
                        onClick={handleCheckInAll}
                        disabled={!!checkingIn || !config || config.sites.length === 0}
                        className="rounded-[var(--radius-sm)] p-[3px] text-[var(--warning)] transition-colors hover:bg-[var(--warning-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                        title="一键签到：批量签到所有可签到站点"
                      >
                        {checkingIn ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin text-[var(--warning)]"
                            strokeWidth={2}
                          />
                        ) : (
                          <Calendar className="h-3.5 w-3.5" strokeWidth={2} />
                        )}
                      </button>
                      <button
                        onClick={handleToggleAllExpanded}
                        className="rounded-[var(--radius-sm)] p-[3px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                        title={
                          flattenedCards.length > 0 &&
                          flattenedCards.every(c => expandedSites.has(c.cardKey))
                            ? '收起全部'
                            : '展开全部'
                        }
                      >
                        <ChevronsUpDown className="w-3.5 h-3.5" strokeWidth={2} />
                      </button>
                      <button
                        onClick={handleDetectAllSites}
                        disabled={detecting || !config || config.sites.length === 0}
                        className="rounded-[var(--radius-sm)] p-[3px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                        title="检测所有站点"
                      >
                        {detecting ? (
                          <Loader2
                            className="w-3.5 h-3.5 animate-spin text-[var(--accent)]"
                            strokeWidth={2}
                          />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
                        )}
                      </button>
                      <div className="w-[48px]" aria-hidden="true" />
                    </div>
                  }
                />

                <DataTableBody className="space-y-3">
                  {flattenedCards.map(({ site, index, siteResult, account, cardKey: ck }) => {
                    const groupId = site.group || defaultGroupId;
                    if (activeSiteGroupFilter !== null && groupId !== activeSiteGroupFilter) {
                      return null;
                    }

                    if (!siteHasMatchingModels(site, siteResult, ck)) {
                      return null;
                    }

                    const isExpanded = expandedSites.has(ck);
                    const cardContext = getCardContext(ck, account);

                    return (
                      <SiteCard
                        key={ck}
                        site={site}
                        index={index}
                        siteResult={siteResult}
                        siteAccount={null}
                        isExpanded={isExpanded}
                        columnWidths={visibleColumnWidths}
                        accountId={account?.id}
                        accountName={account?.account_name}
                        accountAccessToken={account?.access_token}
                        accountUserId={account?.user_id}
                        cardKey={ck}
                        apiKeys={apiKeys[ck] || apiKeys[site.name] || []}
                        userGroups={userGroups[ck] || userGroups[site.name] || {}}
                        modelPricing={modelPricing[ck] || modelPricing[site.name]}
                        isDetecting={detectingSites.has(ck)}
                        checkingIn={checkingIn}
                        dragOverIndex={dragOverIndex}
                        refreshMessage={refreshMessage}
                        selectedGroup={selectedGroup[ck] || null}
                        modelSearch={modelSearch[ck] || ''}
                        globalModelSearch={globalModelSearch}
                        showTokens={showTokens}
                        selectedModels={getSelectedModelsForCard(ck)}
                        deletingTokenKey={deletingTokenKey}
                        autoRefreshEnabled={
                          account
                            ? (account.auto_refresh ?? site.auto_refresh ?? false)
                            : (site.auto_refresh ?? false)
                        }
                        cliCompatibility={getCompatibility(ck)}
                        cliConfig={getCliConfig(ck)}
                        isCliTesting={isCliTestingSite(ck)}
                        onExpand={() => handleExpandSite(ck)}
                        onDetect={(s, accountId) =>
                          detectSingle(s, true, undefined, accountId || account?.id)
                        }
                        onEdit={(idx, account) => {
                          setEditingSite(idx);
                          setEditingAccount(account ?? null);
                          setShowSiteEditor(true);
                        }}
                        onDelete={async (_idx: number) => {
                          if (account) {
                            // 多账户卡片：删除该账户而非整个站点
                            const confirmed = await showDialog({
                              type: 'warning',
                              title: '删除账户',
                              message: `确定要删除「${site.name}」的账户「${account.account_name}」吗？\n此操作不可恢复。`,
                              confirmText: '删除',
                            });
                            if (!confirmed) return;
                            try {
                              await window.electronAPI.accounts?.delete(account.id);
                              // 重新加载配置和账户列表
                              const cfg = await window.electronAPI.loadConfig();
                              setConfig(cfg);
                              await loadAllAccounts(cfg?.sites);
                            } catch (err: any) {
                              Logger.error('删除账户失败:', err);
                              toast.error('删除账户失败: ' + err?.message);
                            }
                          } else {
                            // 无账户卡片：删除整个站点
                            deleteSite(index);
                          }
                        }}
                        onCheckIn={(s, aid) => handleCheckIn(s, aid || account?.id)}
                        onOpenSite={(s, aid) => handleOpenSite(s, aid || account?.id)}
                        onOpenExtraLink={openExtraLink}
                        onCopyToClipboard={copyToClipboard}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onToggleGroupFilter={toggleGroupFilter}
                        onModelSearchChange={(siteName, search) =>
                          setModelSearchStore(siteName, search)
                        }
                        onToggleTokenVisibility={toggleTokenVisibility}
                        onToggleModelSelection={model => toggleModelSelection(ck, model)}
                        onCopySelectedModels={() => copySelectedModels(ck)}
                        onClearSelectedModels={() => clearSelectedModels(ck)}
                        onOpenCreateTokenDialog={s => handleOpenCreateTokenDialog(s, cardContext)}
                        onDeleteToken={(s, t, i) => handleDeleteToken(s, t, i, cardContext)}
                        onOpenCliConfig={() => {
                          setCliConfigSite(site);
                          setCliConfigCardKey(ck);
                          setCliConfigAccountId(account?.id || null);
                          setCliConfigSiteResult(siteResult || null);
                          setShowCliConfigDialog(true);
                        }}
                        onApply={event => {
                          setCliApplySite(site);
                          setCliApplyCardKey(ck);
                          setCliApplyAnchorEl(event?.currentTarget ?? null);
                        }}
                        onAddAccount={
                          firstCardKeyPerSite.has(ck)
                            ? () => {
                                setAddAccountSite(site);
                              }
                            : undefined
                        }
                        onToggleAutoRefresh={async () => {
                          if (account && site.id) {
                            const accountAutoRefresh = account.auto_refresh ?? site.auto_refresh;

                            if (accountAutoRefresh) {
                              try {
                                await window.electronAPI.accounts?.update(account.id, {
                                  auto_refresh: false,
                                });
                                updateLocalAccountAutoRefresh(site.id, account.id, {
                                  auto_refresh: false,
                                });
                              } catch (err) {
                                Logger.error('保存账户自动刷新配置失败:', err);
                                toast.error('保存账户自动刷新配置失败');
                              }
                            } else {
                              openAutoRefreshDialog(site, account);
                            }
                            return;
                          }

                          const latestConfig = useConfigStore.getState().config;
                          if (!latestConfig) return;
                          const latestIndex = latestConfig.sites.findIndex(s =>
                            site.id ? s.id === site.id : s.name === site.name
                          );
                          if (latestIndex === -1) return;
                          const latestSite = latestConfig.sites[latestIndex];

                          if (latestSite.auto_refresh) {
                            const newSites = [...latestConfig.sites];
                            newSites[latestIndex] = { ...latestSite, auto_refresh: false };
                            const newConfig = { ...latestConfig, sites: newSites };
                            setConfig(newConfig);
                            window.electronAPI.saveConfig(newConfig).catch(err => {
                              Logger.error('保存自动刷新配置失败:', err);
                            });
                          } else {
                            openAutoRefreshDialog(site);
                          }
                        }}
                      />
                    );
                  })}
                </DataTableBody>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===== 站点相关弹窗 ===== */}

      {showSiteEditor && (
        <SiteEditor
          key={`${siteBeingEdited?.id || 'new-site'}:${resolvedEditingAccount?.id || 'site'}`}
          site={siteBeingEdited}
          editingAccount={resolvedEditingAccount}
          onSave={async (site, auth) => {
            const isEditing = editingSite !== null;
            try {
              if (isEditing && editingSite !== null && config) {
                const currentSite = config.sites[editingSite];

                await storeUpdateSite(editingSite, {
                  ...site,
                  system_token: resolvedEditingAccount
                    ? currentSite.system_token
                    : site.system_token,
                  user_id: resolvedEditingAccount ? currentSite.user_id : site.user_id,
                });

                if (resolvedEditingAccount) {
                  const updateResult = await window.electronAPI.accounts?.update(
                    resolvedEditingAccount.id,
                    {
                      access_token: auth.systemToken,
                      user_id: auth.userId,
                    }
                  );

                  if (!updateResult?.success) {
                    throw new Error(updateResult?.error || '更新账户凭证失败');
                  }
                }

                const refreshedConfig = await window.electronAPI.loadConfig();
                setConfig(refreshedConfig);
                await loadAllAccounts(refreshedConfig?.sites);
              } else {
                await addSite(site);
              }
            } catch (error: any) {
              Logger.error('保存站点失败:', error);
              toast.error(`保存站点失败: ${error?.message || '未知错误'}`);
              return;
            }

            setShowSiteEditor(false);
            setEditingAccount(null);

            if (processingAuthErrorSite) {
              const remaining = authErrorSites.filter(s => s.name !== processingAuthErrorSite);
              setAuthErrorSites(remaining);
              setProcessingAuthErrorSite(null);
              if (remaining.length > 0) {
                setTimeout(() => {
                  setShowAuthErrorDialog(true);
                }, 300);
              }
            }

            if (isEditing) {
              setTimeout(async () => {
                try {
                  await detectSingle(site, false, undefined, resolvedEditingAccount?.id);
                } catch (error: any) {
                  Logger.error('站点数据刷新失败:', error.message);
                } finally {
                  try {
                    await window.electronAPI.closeLoginBrowser?.();
                  } catch (err) {
                    Logger.warn('关闭登录浏览器失败:', err);
                  }
                }
              }, 500);
            }
          }}
          onCancel={() => {
            setShowSiteEditor(false);
            setEditingAccount(null);
            if (processingAuthErrorSite && authErrorSites.length > 0) {
              setProcessingAuthErrorSite(null);
              setTimeout(() => {
                setShowAuthErrorDialog(true);
              }, 300);
            }
          }}
          groups={siteGroups}
          defaultGroupId={defaultGroupId}
        />
      )}

      {/* 创建站点分组弹窗 */}
      <SiteGroupDialog
        mode="create"
        isOpen={showCreateGroupDialog}
        groupName={newGroupName}
        onGroupNameChange={setNewGroupName}
        onConfirm={confirmCreateSiteGroup}
        onClose={closeCreateGroupDialog}
      />

      {/* 编辑站点分组弹窗 */}
      <SiteGroupDialog
        mode="edit"
        isOpen={showEditGroupDialog && !!editingGroup}
        groupName={editGroupName}
        editingGroup={editingGroup}
        onGroupNameChange={setEditGroupName}
        onConfirm={confirmEditSiteGroup}
        onClose={closeEditGroupDialog}
      />

      {/* 创建 API Key 弹窗 */}
      {creatingTokenSite && (
        <CreateApiKeyDialog
          key={tokenDialogVersion}
          site={creatingTokenSite}
          form={newTokenForm}
          groups={
            userGroups[
              tokenOperationContext?.cardKey || creatingTokenCardKey || creatingTokenSite.name
            ] ||
            userGroups[creatingTokenSite.name] ||
            {}
          }
          creating={creatingToken}
          onFormChange={partial => setNewTokenForm(prev => ({ ...prev, ...partial }))}
          onSubmit={handleCreateTokenSubmit}
          onClose={closeCreateTokenDialogWithContext}
        />
      )}

      {/* CLI 配置对话框 */}
      {cliConfigSite && (
        <UnifiedCliConfigDialog
          isOpen={showCliConfigDialog}
          siteName={cliConfigSite.name}
          accountName={
            cliConfigAccountId
              ? accountsBySite[cliConfigSite.id || '']?.find(a => a.id === cliConfigAccountId)
                  ?.account_name
              : undefined
          }
          siteUrl={cliConfigSite.url}
          apiKeys={
            apiKeys[cliConfigCardKey ?? cliConfigSite.name] || apiKeys[cliConfigSite.name] || []
          }
          siteModels={cliConfigSiteResult?.models || []}
          currentConfig={getCliConfig(cliConfigCardKey ?? cliConfigSite.name)}
          codexDetail={getCompatibility(cliConfigCardKey ?? cliConfigSite.name)?.codexDetail}
          geminiDetail={getCompatibility(cliConfigCardKey ?? cliConfigSite.name)?.geminiDetail}
          compatibility={getCompatibility(cliConfigCardKey ?? cliConfigSite.name) ?? null}
          isTestingCompatibility={isCliTestingSite(cliConfigCardKey ?? cliConfigSite.name)}
          onTestCompatibility={() => {
            void (async () => {
              const cardKey = cliConfigCardKey ?? cliConfigSite.name;
              const account = cliConfigAccountId
                ? accountsBySite[cliConfigSite.id || '']?.find(a => a.id === cliConfigAccountId) ||
                  null
                : null;
              const refreshedApiKeys = await refreshSiteApiKeys(cliConfigSite, {
                cardKey,
                accountId: account?.id,
                accessToken: account?.access_token,
                userId: account?.user_id,
              });
              await testCliCompatSite(
                cardKey,
                account?.account_name
                  ? `${cliConfigSite.name} / ${account.account_name}`
                  : cliConfigSite.name,
                cliConfigSite.url,
                refreshedApiKeys.length > 0
                  ? refreshedApiKeys
                  : apiKeys[cardKey] || apiKeys[cliConfigSite.name] || [],
                account?.id
              );
            })();
          }}
          onClose={() => {
            setShowCliConfigDialog(false);
            setCliConfigSite(null);
            setCliConfigCardKey(null);
            setCliConfigAccountId(null);
            setCliConfigSiteResult(null);
          }}
          onPersistConfig={async (newConfig: CliConfig) => {
            const cardKey = cliConfigCardKey ?? cliConfigSite.name;
            const result = await (window.electronAPI as any).cliCompat.saveConfig(
              cliConfigSite.url,
              newConfig,
              cliConfigAccountId || undefined
            );
            if (!result?.success) {
              throw new Error(result?.error ?? '保存 CLI 配置失败');
            }
            setCliConfig(cardKey, newConfig);
          }}
          onSave={async (newConfig: CliConfig) => {
            try {
              const result = await (window.electronAPI as any).cliCompat.saveConfig(
                cliConfigSite.url,
                newConfig,
                cliConfigAccountId || undefined
              );
              if (!result?.success) {
                throw new Error(result?.error ?? '保存 CLI 配置失败');
              }
              setCliConfig(cliConfigCardKey ?? cliConfigSite.name, newConfig);
              toast.success('CLI 配置已保存');
            } catch {
              toast.error('保存 CLI 配置失败');
              return;
            }
            setShowCliConfigDialog(false);
            setCliConfigSite(null);
            setCliConfigCardKey(null);
            setCliConfigAccountId(null);
            setCliConfigSiteResult(null);
          }}
        />
      )}

      <ApplyConfigPopover
        isOpen={Boolean(cliApplySite && cliApplyAnchorEl)}
        anchorEl={cliApplyAnchorEl}
        cliConfig={
          cliApplySite ? (getCliConfig(cliApplyCardKey ?? cliApplySite.name) ?? null) : null
        }
        cliCompatibility={
          cliApplySite ? (getCompatibility(cliApplyCardKey ?? cliApplySite.name) ?? null) : null
        }
        siteUrl={cliApplySite?.url ?? ''}
        siteName={cliApplySite?.name ?? ''}
        apiKeys={
          cliApplySite
            ? apiKeys[cliApplyCardKey ?? cliApplySite.name] || apiKeys[cliApplySite.name] || []
            : []
        }
        onClose={() => {
          setCliApplySite(null);
          setCliApplyCardKey(null);
          setCliApplyAnchorEl(null);
        }}
      />

      {/* 备份选择对话框 */}
      <BackupSelectDialog
        isOpen={showBackupDialog}
        backups={backupList}
        loading={loadingBackups}
        onSelect={async backup => {
          setShowBackupDialog(false);
          const confirmed = await showDialog({
            type: 'confirm',
            title: '确认恢复',
            message: `确定要从备份文件「${backup.filename}」恢复配置吗？\n\n恢复前会自动备份当前配置。`,
            confirmText: '恢复',
          });
          if (!confirmed) return;
          try {
            const result = await (window.electronAPI as any).backup?.restoreConfig?.(
              backup.filename
            );
            if (result?.success) {
              showAlert('配置已恢复，正在重新加载...', 'success', '恢复成功');
              // Reload config
              const cfg = await window.electronAPI.loadConfig();
              setConfig(cfg);
            } else {
              showAlert('恢复失败：' + (result?.error || '未知错误'), 'error');
            }
          } catch (error: any) {
            showAlert('恢复失败：' + error.message, 'error');
          }
        }}
        onClose={() => setShowBackupDialog(false)}
      />

      {/* 添加账户对话框 */}
      {addAccountSite?.id && (
        <AddAccountDialog
          isOpen={!!addAccountSite}
          siteId={addAccountSite.id}
          siteName={addAccountSite.name}
          siteUrl={addAccountSite.url}
          onSuccess={async () => {
            const cfg = await window.electronAPI.loadConfig();
            setConfig(cfg);
            await loadAllAccounts(cfg?.sites);
            if (cfg) {
              const refreshedSite = cfg.sites.find(s => s.url === addAccountSite.url);
              if (refreshedSite?.id) {
                // 只刷新新添加的账户（列表末尾），不影响已有账户
                const listRes = await window.electronAPI.accounts?.list(refreshedSite.id);
                const accounts = listRes?.success ? listRes.data : undefined;
                if (accounts && accounts.length > 0) {
                  const newAccount = accounts[accounts.length - 1];
                  detectSingle(refreshedSite, false, undefined, newAccount.id);
                } else {
                  detectSingle(refreshedSite);
                }
              }
            }
          }}
          onClose={() => setAddAccountSite(null)}
        />
      )}

      {/* 自动刷新设置对话框 */}
      <AutoRefreshDialog
        isOpen={!!autoRefreshDialogTarget}
        siteName={autoRefreshDialogTarget?.label || ''}
        currentInterval={autoRefreshDialogTarget?.currentInterval ?? 30}
        onConfirm={async intervalMinutes => {
          if (!autoRefreshDialogTarget) return;

          const { site, account } = autoRefreshDialogTarget;

          if (account && site.id) {
            try {
              await window.electronAPI.accounts?.update(account.id, {
                auto_refresh: true,
                auto_refresh_interval: intervalMinutes,
              });
              updateLocalAccountAutoRefresh(site.id, account.id, {
                auto_refresh: true,
                auto_refresh_interval: intervalMinutes,
              });
            } catch (err) {
              Logger.error('保存账户自动刷新配置失败:', err);
              toast.error('保存账户自动刷新配置失败');
            } finally {
              setAutoRefreshDialogTarget(null);
            }
            return;
          }

          const latestConfig = useConfigStore.getState().config;
          if (!latestConfig) return;
          const idx = latestConfig.sites.findIndex(s =>
            site.id ? s.id === site.id : s.name === site.name
          );
          if (idx === -1) return;
          const newSites = [...latestConfig.sites];
          newSites[idx] = {
            ...latestConfig.sites[idx],
            auto_refresh: true,
            auto_refresh_interval: intervalMinutes,
          };
          const newConfig = { ...latestConfig, sites: newSites };
          setConfig(newConfig);
          window.electronAPI.saveConfig(newConfig).catch(err => {
            Logger.error('保存自动刷新配置失败:', err);
          });
          setAutoRefreshDialogTarget(null);
        }}
        onCancel={() => setAutoRefreshDialogTarget(null)}
      />
    </>
  );
}
