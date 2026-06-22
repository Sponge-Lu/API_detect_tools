/**
 * 站点管理独立页面
 * 从 App.tsx 提取的站点管理核心逻辑和 UI
 *
 * 并发刷新: 使用 detectingSites (Set) 为每个 SiteCard 计算独立的 isDetecting 布尔值
 */

import Logger from '../utils/logger';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Server, Plus, Trash2, Pencil, Search, X } from 'lucide-react';
import { SiteEditor } from '../components/SiteEditor';
import { AddAccountDialog } from '../components/AddAccountDialog';
import { SiteCard } from '../components/SiteCard';
import { SiteListHeader } from '../components/SiteListHeader';
import {
  SiteGroupDialog,
  BackupSelectDialog,
  ApplyConfigPopover,
  AddAccessPointDialog,
  AccessPointDetailPanel,
  OperationRecordDialog,
  CliProbeSettingsDialog,
} from '../components/dialogs';
import type { CliConfig } from '../../shared/types/cli-config';
import { useRouteStore } from '../store/routeStore';
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
import {
  SITE_TYPES,
  SITE_TYPE_LABELS,
  type SiteConfig,
  type DetectionResult,
  type AnyRouterAccountConfig,
} from '../../shared/types/site';
import {
  DEFAULT_CLI_PROBE_CONFIG,
  type RouteCliProbeConfig,
} from '../../shared/types/route-proxy';
import type { Config, SiteGroup } from '../App';
import {
  UNKNOWN_SITE_TYPE_FILTER,
  type SiteTypeFilterOption,
  type SiteTypeFilterValue,
} from '../components/SiteListHeader/SiteListHeader';

import { useConfigStore } from '../store/configStore';
import { useDetectionStore } from '../store/detectionStore';
import { useUIStore } from '../store/uiStore';
import { useCustomCliConfigStore } from '../store/customCliConfigStore';
import { toast } from '../store/toastStore';
import { DialogState, initialDialogState } from '../components/ConfirmDialog';
import type { CustomCliConfig } from '../../shared/types/custom-cli-config';
import {
  buildCustomCliRouteAccountId,
  buildCustomCliRouteSiteId,
} from '../../shared/utils/customCliRouteId';

// 备份信息类型
interface BackupInfo {
  filename: string;
  path: string;
  timestamp: Date;
  size: number;
  kind?: 'legacy-config' | 'storage-bundle';
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
  anyRouterConfig?: AnyRouterAccountConfig;
}

interface AddedAccountInfo {
  id?: string;
  account_name?: string;
  user_id?: string;
}

interface EditingAccountInfo {
  id: string;
  account_name?: string;
  user_id?: string;
  access_token?: string;
  anyRouterConfig?: AnyRouterAccountConfig;
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

function getCustomCliDisplayName(config: CustomCliConfig): string {
  return config.name?.trim() || '未命名直连配置';
}

function buildCustomCliVirtualSite(config: CustomCliConfig, defaultGroupId: string): SiteConfig {
  return {
    id: buildCustomCliRouteSiteId(config.id),
    name: getCustomCliDisplayName(config),
    url: config.baseUrl || '',
    api_key: config.apiKey || '',
    enabled: true,
    group: defaultGroupId,
  };
}

function buildCustomCliVirtualAccount(config: CustomCliConfig): AccountInfo {
  return {
    id: buildCustomCliRouteAccountId(config.id),
    account_name: '直连配置',
    user_id: '',
    access_token: config.apiKey || '',
    status: config.baseUrl ? 'active' : 'incomplete',
    auth_source: 'custom-cli',
  };
}

function buildCustomCliVirtualResult(config: CustomCliConfig): DetectionResult {
  return {
    name: getCustomCliDisplayName(config),
    url: config.baseUrl || '',
    status: config.baseUrl && config.apiKey ? '成功' : '未配置',
    models: config.models || [],
    has_checkin: false,
    accountId: buildCustomCliRouteAccountId(config.id),
    lastRefresh: config.lastModelFetch,
  };
}

/** 展平后的卡片条目 */
type ManagedCardItem = {
  type: 'managed';
  site: SiteConfig;
  index: number;
  siteResult?: DetectionResult;
  account: AccountInfo | null;
  cardKey: string;
};

type CustomCliCardItem = {
  type: 'custom-cli';
  config: CustomCliConfig;
  index: number;
  cardKey: string;
  site: SiteConfig;
  account: AccountInfo;
  siteResult: DetectionResult;
};

type FlattenedCardItem = ManagedCardItem | CustomCliCardItem;

type SelectedSiteItem =
  | { type: 'managed'; site: SiteConfig; account: AccountInfo | null }
  | { type: 'custom-cli'; config: CustomCliConfig };

interface SitesPageProps {
  setPageHeaderActions?: (actions: React.ReactNode | null) => void;
}

export function SitesPage({ setPageHeaderActions }: SitesPageProps) {
  // ========== 从 Store 读取状态 ==========
  const { config, setConfig, setSaving, updateSite: storeUpdateSite } = useConfigStore();

  const { apiKeys, userGroups, modelPricing, setApiKeys, setUserGroups, setModelPricing } =
    useDetectionStore();
  const {
    configs: customCliConfigs,
    loadConfigs: loadCustomCliConfigs,
    addConfig: addCustomCliConfig,
    deleteConfig: deleteCustomCliConfig,
  } = useCustomCliConfigStore();

  const {
    showSiteEditor,
    setShowSiteEditor,
    editingSite,
    setEditingSite,
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
    setDeletingTokenKey,
    setDialogState,
    authErrorSites,
    addAuthErrorSite,
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

  // 添加接入点弹窗状态
  const [showAddAccessPointDialog, setShowAddAccessPointDialog] = useState(false);
  const [pendingNewCustomCliConfigId, setPendingNewCustomCliConfigId] = useState<string | null>(
    null
  );

  // 一键刷新/签到状态
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCheckingInAll, setIsCheckingInAll] = useState(false);

  // 侧滑面板状态
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SelectedSiteItem | null>(null);

  const [cliApplySite, setCliApplySite] = useState<SiteConfig | null>(null);
  const [cliApplyCardKey, setCliApplyCardKey] = useState<string | null>(null);
  const [cliApplyAnchorEl, setCliApplyAnchorEl] = useState<HTMLElement | null>(null);
  const [tokenOperationContext, setTokenOperationContext] = useState<CardOperationContext | null>(
    null
  );

  // 自动刷新对话框状态
  const [addAccountSite, setAddAccountSite] = useState<SiteConfig | null>(null);
  const [editingAccount, setEditingAccount] = useState<EditingAccountInfo | null>(null);
  const [activeSiteTypeFilter, setActiveSiteTypeFilter] = useState<SiteTypeFilterValue | null>(
    null
  );
  const [showOperationRecords, setShowOperationRecords] = useState(false);
  const [showCliProbeSettings, setShowCliProbeSettings] = useState(false);
  const [savingCliProbeSettings, setSavingCliProbeSettings] = useState(false);
  const [runningCliProbe, setRunningCliProbe] = useState(false);

  // 多账户: 按站点 ID 预加载的账户列表
  const [accountsBySite, setAccountsBySite] = useState<Record<string, AccountInfo[]>>({});
  const [, setRefreshingTokenKey] = useState<string | null>(null);
  const dateStr = useDateString();

  const routeCliProbeConfig = useRouteStore(state => state.config?.cliProbe?.config ?? null);
  const fetchRouteConfig = useRouteStore(state => state.fetchConfig);
  const saveRouteCliProbeConfig = useRouteStore(state => state.saveCliProbeConfig);
  const runRouteProbeNow = useRouteStore(state => state.runProbeNow);

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
      if (!sites) return {};
      const sitesWithId = sites.filter(s => s.id);
      if (sitesWithId.length === 0) return {};

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
      return newAccountsBySite;
    },
    [config?.sites]
  );

  useEffect(() => {
    loadAllAccounts();
  }, [loadAllAccounts]);

  useEffect(() => {
    void loadCustomCliConfigs();
  }, [loadCustomCliConfigs]);

  const siteBeingEdited = editingSite !== null ? config?.sites[editingSite] : undefined;

  const resolvedEditingAccount = editingAccount ?? null;

  const siteTypeFilterOptions = useMemo<SiteTypeFilterOption[]>(() => {
    if (!config?.sites?.length) return [];

    const counts = new Map<SiteTypeFilterValue, number>();
    for (const site of config.sites) {
      const key = site.site_type ?? UNKNOWN_SITE_TYPE_FILTER;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const options: SiteTypeFilterOption[] = [];
    for (const siteType of SITE_TYPES) {
      const count = counts.get(siteType);
      if (!count) continue;
      options.push({
        value: siteType,
        label: SITE_TYPE_LABELS[siteType],
        count,
      });
    }

    const unknownCount = counts.get(UNKNOWN_SITE_TYPE_FILTER);
    if (unknownCount) {
      options.push({
        value: UNKNOWN_SITE_TYPE_FILTER,
        label: '未识别',
        count: unknownCount,
      });
    }

    return options;
  }, [config?.sites]);

  useEffect(() => {
    if (activeSiteTypeFilter === null) return;
    const stillExists = siteTypeFilterOptions.some(option => option.value === activeSiteTypeFilter);
    if (!stillExists) {
      setActiveSiteTypeFilter(null);
    }
  }, [activeSiteTypeFilter, siteTypeFilterOptions]);

  // 切换分组选择
  const toggleGroupFilter = (siteName: string, groupName: string | null) => {
    const current = selectedGroup[siteName];
    setSelectedGroup(siteName, current === groupName ? null : groupName);
  };

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
  const { detectingSites, results, setResults, detectSingle, detectAllSites } =
    useSiteDetection({
      onAuthError: sites => {
        for (const site of sites) {
          addAuthErrorSite(site);
        }
        setShowAuthErrorDialog(true);
      },
      showDialog,
    });

  // CLI 兼容性测试 hook
  const {
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
  const effectiveActiveSiteGroupFilter = activeSiteGroupFilter ?? defaultGroupId;

  useEffect(() => {
    const stillExists = siteGroups.some(group => group.id === activeSiteGroupFilter);
    if (activeSiteGroupFilter === null || !stillExists) {
      setActiveSiteGroupFilter(defaultGroupId);
    }
  }, [activeSiteGroupFilter, defaultGroupId, setActiveSiteGroupFilter, siteGroups]);

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

  const buildSitePayloadForCreate = useCallback(
    (site: SiteConfig) => ({
      name: site.name,
      url: site.url,
      site_type: site.site_type,
      enabled: site.enabled,
      group: site.group || defaultGroupId,
      api_key: site.api_key,
      extra_links: site.extra_links,
      has_checkin: site.has_checkin,
      force_enable_checkin: site.force_enable_checkin,
      auto_refresh: site.auto_refresh,
      auto_refresh_interval: site.auto_refresh_interval,
    }),
    [defaultGroupId]
  );

  const createSiteWithDefaultAccount = useCallback(
    async (
      site: SiteConfig,
      auth: {
        systemToken: string;
        userId: string;
        accountName?: string;
        anyRouterConfig?: AnyRouterAccountConfig;
      }
    ) => {
      const siteResult = await window.electronAPI.sites?.add(buildSitePayloadForCreate(site));
      if (!siteResult?.success || !siteResult.data?.id) {
        throw new Error(siteResult?.error || '创建站点失败');
      }

      const createdSiteId = siteResult.data.id;
      const createdSite = siteResult.data as SiteConfig;

      const accountResult = await window.electronAPI.accounts?.add({
        site_id: createdSiteId,
        account_name: auth.accountName?.trim() || '默认账户',
        user_id: auth.userId,
        access_token: auth.systemToken,
        auth_source: 'manual',
        ...(auth.anyRouterConfig ? { anyRouterConfig: auth.anyRouterConfig } : {}),
      });

      if (!accountResult?.success || !accountResult.data?.id) {
        throw new Error(accountResult?.error || '创建默认账户失败');
      }

      const refreshedConfig = await window.electronAPI.loadConfig();
      setConfig(refreshedConfig);
      await loadAllAccounts(refreshedConfig?.sites);

      const refreshedSite =
        refreshedConfig?.sites?.find((item: SiteConfig) => item.id === createdSiteId) ||
        createdSite;

      setTimeout(async () => {
        try {
          await detectSingle(refreshedSite, false, undefined, accountResult.data.id);
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
    },
    [buildSitePayloadForCreate, detectSingle, loadAllAccounts, setConfig]
  );

  const deleteAccount = useCallback(
    async (site: SiteConfig, account: AccountInfo) => {
      const confirmed = await showDialog({
        type: 'warning',
        title: '删除账户',
        message: `确定要删除「${site.name}」的账户「${account.account_name}」吗？\n此操作不可恢复。`,
        confirmText: '删除',
      });
      if (!confirmed) return false;

      try {
        await window.electronAPI.accounts?.delete(account.id);
        const cfg = await window.electronAPI.loadConfig();
        setConfig(cfg);
        await loadAllAccounts(cfg?.sites);
        toast.success('账户已删除');
        return true;
      } catch (err: any) {
        Logger.error('删除账户失败:', err);
        toast.error('删除账户失败: ' + err?.message);
        return false;
      }
    },
    [loadAllAccounts, setConfig, showDialog]
  );

  const handleSavePanelAccount = useCallback(
    async (
      accountId: string,
      updates: Partial<
        Pick<
          AccountInfo,
          'account_name' | 'user_id' | 'access_token' | 'auto_refresh' | 'auto_refresh_interval'
        >
      >
    ) => {
      try {
        const result = await window.electronAPI.accounts?.update(accountId, updates);
        if (!result?.success) {
          throw new Error(result?.error || '保存账户配置失败');
        }

        const refreshedConfig = await window.electronAPI.loadConfig();
        setConfig(refreshedConfig);
        const refreshedAccountsBySite = await loadAllAccounts(refreshedConfig?.sites);

        setSelectedItem(prev => {
          if (prev?.type !== 'managed' || !prev.account || prev.account.id !== accountId) {
            return prev;
          }
          const latestAccount = prev.site.id
            ? refreshedAccountsBySite[prev.site.id]?.find(account => account.id === accountId)
            : null;
          return {
            ...prev,
            account: latestAccount ?? {
              ...prev.account,
              ...updates,
            },
          };
        });

        toast.success('账户配置已保存');
      } catch (err: any) {
        Logger.error('保存账户配置失败:', err);
        toast.error('保存账户配置失败: ' + (err?.message || err));
        throw err;
      }
    },
    [loadAllAccounts, setConfig]
  );

  const handleDetectAllSites = useCallback(async () => {
    setRunningCliProbe(true);
    try {
      await runRouteProbeNow();
    } catch (error: any) {
      Logger.error('CLI 可用性即时探测失败:', error);
      toast.error('CLI 可用性即时探测失败: ' + (error?.message || error));
    } finally {
      setRunningCliProbe(false);
    }
  }, [runRouteProbeNow]);

  const handleOpenDetectionSettings = useCallback(async () => {
    try {
      await fetchRouteConfig();
    } catch (error) {
      Logger.warn('加载 CLI 探测设置失败，将使用默认设置:', error);
    }
    setShowCliProbeSettings(true);
  }, [fetchRouteConfig]);

  const handleSaveCliProbeSettings = useCallback(
    async (nextConfig: RouteCliProbeConfig) => {
      setSavingCliProbeSettings(true);
      try {
        await saveRouteCliProbeConfig(nextConfig);
        setShowCliProbeSettings(false);
      } catch (error: any) {
        Logger.error('保存 CLI 可用性检测设置失败:', error);
        toast.error('保存 CLI 可用性检测设置失败: ' + (error?.message || error));
      } finally {
        setSavingCliProbeSettings(false);
      }
    },
    [saveRouteCliProbeConfig]
  );

  // 签到逻辑 hook
  const { handleCheckIn, handleCheckInAll } = useCheckIn({
    showDialog,
    showAlert,
    setCheckingIn,
  });

  // 令牌管理 hook
  const {
    handleRefreshToken: refreshToken,
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

  const handleRefreshToken = (
    site: SiteConfig,
    token: any,
    tokenIndex: number,
    context?: CardOperationContext
  ) => {
    refreshToken(site, token, tokenIndex, setRefreshingTokenKey, context);
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
            type: 'managed',
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
          type: 'managed',
          site,
          index,
          siteResult,
          account: null,
          cardKey: site.name,
        });
      }
    }

    customCliConfigs.forEach((customCliConfig, customIndex) => {
      const virtualSite = buildCustomCliVirtualSite(customCliConfig, defaultGroupId);
      const virtualAccount = buildCustomCliVirtualAccount(customCliConfig);
      items.push({
        type: 'custom-cli',
        config: customCliConfig,
        index: sortedSites.length + customIndex,
        site: virtualSite,
        account: virtualAccount,
        siteResult: buildCustomCliVirtualResult(customCliConfig),
        cardKey: `custom-cli::${customCliConfig.id}`,
      });
    });

    return items;
  }, [sortedSites, accountsBySite, results, customCliConfigs, defaultGroupId]);

  // 全局模型搜索（需要放在 flattenedCards 之后）
  const hasAccessPoints = flattenedCards.length > 0;

  const handleGlobalModelSearchChange = useCallback(
    (value: string) => {
      if (Object.values(modelSearch).some(text => text && text.trim() !== '')) {
        clearAllModelSearch();
      }

      setGlobalModelSearch(value);

      if (expandDebounceRef.current) {
        clearTimeout(expandDebounceRef.current);
      }

      if (value && flattenedCards.length > 0) {
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

  const refreshAllDirectConfigModels = useCallback(async () => {
    const currentConfigs = useCustomCliConfigStore.getState().configs;
    let success = 0;
    let failed = 0;

    for (const directConfig of currentConfigs) {
      if (!directConfig.baseUrl || !directConfig.apiKey) {
        continue;
      }

      const models = await useCustomCliConfigStore.getState().fetchModels(directConfig.id);
      if (models.length > 0) {
        success += 1;
      } else {
        failed += 1;
      }
    }

    return { success, failed };
  }, []);

  // 一键刷新继承旧批量检测结果回写，再补充直连配置模型刷新
  const handleRefreshAll = async () => {
    if (!config) return;
    setIsRefreshing(true);
    try {
      if (config.sites.length > 0) {
        await detectAllSites(config, accountsBySite);
      }
      const directRefresh = await refreshAllDirectConfigModels();

      const cfg = await window.electronAPI.loadConfig();
      setConfig(cfg);
      await loadAllAccounts(cfg?.sites);
      await loadCustomCliConfigs();

      if (directRefresh.success > 0 || directRefresh.failed > 0) {
        const message =
          directRefresh.failed === 0
            ? `直连配置模型刷新完成：${directRefresh.success} 个`
            : `直连配置模型刷新完成：${directRefresh.success} 成功，${directRefresh.failed} 失败`;
        if (directRefresh.failed === 0) {
          toast.success(message);
        } else {
          toast.warning(message);
        }
      }
    } catch (error: any) {
      Logger.error('刷新失败:', error);
      toast.error(`刷新失败：${error.message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  // 一键签到继承 useCheckIn 的批量过滤、结果回写和失败手动签到入口
  const handleCheckInAllSites = async () => {
    setIsCheckingInAll(true);
    try {
      await handleCheckInAll();
      const cfg = await window.electronAPI.loadConfig();
      setConfig(cfg);
      await loadAllAccounts(cfg?.sites);
    } catch (error: any) {
      Logger.error('签到失败:', error);
      toast.error(`签到失败：${error.message}`);
    } finally {
      setIsCheckingInAll(false);
    }
  };

  // 处理行点击事件 - 打开侧滑面板
  const handleRowClick = useCallback((cardItem: FlattenedCardItem) => {
    if (cardItem.type === 'custom-cli') {
      setSelectedItem({
        type: 'custom-cli',
        config: cardItem.config,
      });
      setPanelOpen(true);
      return;
    }

    setSelectedItem({
      type: 'managed',
      site: cardItem.site,
      account: cardItem.account,
    });
    setPanelOpen(true);
  }, []);

  const refreshSelectedDirectConfig = useCallback(
    async (configId: string) => {
      await loadCustomCliConfigs();
      const latestConfig = useCustomCliConfigStore
        .getState()
        .configs.find(config => config.id === configId);
      if (latestConfig) {
        setSelectedItem(prev =>
          prev?.type === 'custom-cli' && prev.config.id === latestConfig.id
            ? { type: 'custom-cli', config: latestConfig }
            : prev
        );
      }
    },
    [loadCustomCliConfigs]
  );

  // 关闭侧滑面板
  const handleClosePanel = useCallback(() => {
    const closingItem = selectedItem;
    const shouldRollbackPending =
      closingItem?.type === 'custom-cli' &&
      pendingNewCustomCliConfigId !== null &&
      pendingNewCustomCliConfigId === closingItem.config.id;

    const close = () => {
      setPanelOpen(false);
      // 延迟清空 selectedItem，避免动画过程中内容消失
      setTimeout(() => setSelectedItem(null), 300);
    };

    if (!shouldRollbackPending) {
      close();
      return;
    }

    const rollback = async () => {
      await deleteCustomCliConfig(closingItem.config.id);
      setPendingNewCustomCliConfigId(null);
      close();
    };

    void rollback();
  }, [deleteCustomCliConfig, pendingNewCustomCliConfigId, selectedItem]);

  const handleAddDirectConfig = useCallback(() => {
    const newConfig = addCustomCliConfig({ name: '新建直连配置' });
    setPendingNewCustomCliConfigId(newConfig.id);
    setSelectedItem({
      type: 'custom-cli',
      config: newConfig,
    });
    setPanelOpen(true);
  }, [addCustomCliConfig]);

  const handleDirectConfigSaved = useCallback(
    async (configId: string) => {
      if (pendingNewCustomCliConfigId === configId) {
        setPendingNewCustomCliConfigId(null);
      }
      await refreshSelectedDirectConfig(configId);
    },
    [pendingNewCustomCliConfigId, refreshSelectedDirectConfig]
  );

  const handleDeleteDirectConfig = useCallback(
    async (config: CustomCliConfig) => {
      const confirmed = await showDialog({
        type: 'warning',
        title: '删除直连配置',
        message: `确定要删除直连配置「${getCustomCliDisplayName(config)}」吗？此操作不可恢复。`,
        confirmText: '删除',
      });
      if (!confirmed) return;

      await deleteCustomCliConfig(config.id);
      if (selectedItem?.type === 'custom-cli' && selectedItem.config.id === config.id) {
        handleClosePanel();
      }
    },
    [deleteCustomCliConfig, handleClosePanel, selectedItem, showDialog]
  );

  const handleUpdateAnyRouterUserHash = useCallback(
    async (accountId: string, userHash: string) => {
      let nextAnyRouterConfig: AnyRouterAccountConfig = { userHash };

      setSelectedItem(prev => {
        if (prev?.type !== 'managed' || !prev.account || prev.account.id !== accountId) {
          return prev;
        }
        nextAnyRouterConfig = {
          ...(prev.account.anyRouterConfig || {}),
          userHash,
        };
        return {
          ...prev,
          account: {
            ...prev.account,
            anyRouterConfig: nextAnyRouterConfig,
          },
        };
      });

      setAccountsBySite(prev => {
        const nextEntries = Object.entries(prev).map(([siteId, siteAccounts]) => [
          siteId,
          siteAccounts.map(account =>
            account.id === accountId
              ? {
                  ...account,
                  anyRouterConfig: {
                    ...(account.anyRouterConfig || {}),
                    userHash,
                  },
                }
              : account
          ),
        ]);
        return Object.fromEntries(nextEntries) as Record<string, AccountInfo[]>;
      });

      const latestConfig = useConfigStore.getState().config;
      if (latestConfig?.accounts) {
        setConfig({
          ...latestConfig,
          accounts: latestConfig.accounts.map(account =>
            account.id === accountId
              ? {
                  ...account,
                  anyRouterConfig: {
                    ...((account as { anyRouterConfig?: AnyRouterAccountConfig }).anyRouterConfig ||
                      {}),
                    userHash,
                  },
                }
              : account
          ),
        });
      }

      try {
        const result = await window.electronAPI.accounts?.update(accountId, {
          anyRouterConfig: nextAnyRouterConfig,
        });
        if (!result?.success) {
          throw new Error(result?.error || '保存 User Hash 失败');
        }
      } catch (error: any) {
        Logger.error('保存 AnyRouter User Hash 失败:', error);
        toast.error(`保存 User Hash 失败: ${error?.message || error}`);
      }
    },
    [setConfig]
  );

  // 统计数据
  const activeSitesCount = useMemo(() => {
    const managedSites = config?.sites.length || 0;
    const customConfigs = customCliConfigs.length;
    return managedSites + customConfigs;
  }, [config, customCliConfigs.length]);

  const pageHeaderActions = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <AppButton
          variant="secondary"
          size="sm"
          onClick={handleOpenDetectionSettings}
          title="打开检测设置"
          aria-label="探测设置"
        >
          探测设置
        </AppButton>
        <AppButton
          variant="secondary"
          size="sm"
          onClick={handleDetectAllSites}
          loading={runningCliProbe}
          disabled={activeSitesCount === 0}
          title="立即执行一次站点 CLI 可用性探测"
          aria-label="立即探测"
        >
          立即探测
        </AppButton>
        <AppButton
          variant="secondary"
          size="sm"
          onClick={() => setShowOperationRecords(true)}
          title="查看应用操作记录"
          aria-label="操作记录"
        >
          操作记录
        </AppButton>
        <AppButton
          variant="secondary"
          size="sm"
          onClick={handleRefreshAll}
          loading={isRefreshing}
          disabled={activeSitesCount === 0}
          title="一键刷新所有托管站点 Token + 直连配置模型"
          aria-label="一键刷新"
        >
          一键刷新
        </AppButton>
        <AppButton
          variant="secondary"
          size="sm"
          onClick={handleCheckInAllSites}
          loading={isCheckingInAll}
          disabled={!config || config.sites.length === 0 || Boolean(checkingIn)}
          title="一键签到所有支持签到的站点"
          aria-label="一键签到"
        >
          一键签到
        </AppButton>
        <AppButton
          variant="primary"
          size="sm"
          onClick={() => setShowAddAccessPointDialog(true)}
          title="添加站点"
          aria-label="添加站点"
        >
          添加站点
        </AppButton>
        <AppButton
          variant="secondary"
          size="sm"
          onClick={handleOpenBackupDialog}
          title="从备份文件恢复站点配置"
          aria-label="恢复站点"
        >
          恢复站点
        </AppButton>
      </div>
    ),
    [
      handleOpenDetectionSettings,
      handleDetectAllSites,
      handleOpenBackupDialog,
      handleRefreshAll,
      handleCheckInAllSites,
      runningCliProbe,
      isRefreshing,
      isCheckingInAll,
      activeSitesCount,
      checkingIn,
      config,
    ]
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
          {hasAccessPoints && (
            <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--line-soft)] px-4 pb-1 pt-2 text-[13px] text-[var(--text-secondary)]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-[var(--text-primary)]">站点分组</span>
                {siteGroups.map((group, groupIndex) => {
                  const groupId = group.id;
                  const isActive = effectiveActiveSiteGroupFilter === groupId;
                  const groupSitesCount =
                    config.sites.filter(s => (s.group || defaultGroupId) === groupId).length +
                    (groupId === defaultGroupId ? customCliConfigs.length : 0);
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
                          ? `当前显示「${group.name}」分组的站点\n拖动站点卡片到此可移动分组\n拖动分组标签可调整顺序`
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
          <div className="relative z-0 flex-1 overflow-x-visible overflow-y-auto px-4 pb-4">
            {!hasAccessPoints ? (
              <div className="py-16 text-center text-[var(--text-secondary)]">
                <Server className="w-16 h-16 mx-auto mb-4 opacity-30" strokeWidth={1.5} />
                <p className="text-lg font-medium mb-2">还没有添加任何接入点</p>
                <p className="text-sm mb-4">点击"添加站点"按钮开始添加托管站点或直连配置</p>
                <div className="flex items-center justify-center gap-2">
                  <AppButton variant="primary" onClick={() => setShowAddAccessPointDialog(true)}>
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
                  activeSiteTypeFilter={activeSiteTypeFilter}
                  siteTypeFilterOptions={siteTypeFilterOptions}
                  onSiteTypeFilterChange={setActiveSiteTypeFilter}
                />

                <DataTableBody>
                  {flattenedCards.map(cardItem => {
                    const { site, index, siteResult, account, cardKey: ck } = cardItem;
                    const groupId = site.group || defaultGroupId;
                    if (groupId !== effectiveActiveSiteGroupFilter) {
                      return null;
                    }

                    const siteTypeValue = site.site_type ?? UNKNOWN_SITE_TYPE_FILTER;
                    if (activeSiteTypeFilter !== null && siteTypeValue !== activeSiteTypeFilter) {
                      return null;
                    }

                    if (cardItem.type === 'custom-cli') {
                      if (globalModelSearch) {
                        const searchTerm = globalModelSearch.toLowerCase();
                        const directModels = [
                          ...(cardItem.config.models || []),
                          ...(cardItem.config.manualModels || []),
                        ];
                        if (!directModels.some(model => model.toLowerCase().includes(searchTerm))) {
                          return null;
                        }
                      }
                    } else if (!siteHasMatchingModels(site, siteResult, ck)) {
                      return null;
                    }

                    return (
                      <div
                        key={ck}
                        onClick={() => handleRowClick(cardItem)}
                        className="cursor-pointer"
                      >
                        <SiteCard
                          key={ck}
                          site={site}
                          index={index}
                          siteResult={siteResult}
                          siteAccount={null}
                          columnWidths={visibleColumnWidths}
                          accessPointType={cardItem.type}
                          draggable={cardItem.type === 'managed'}
                          accountId={account?.id}
                          accountName={account?.account_name}
                          cardKey={ck}
                          modelPricing={
                            cardItem.type === 'custom-cli'
                              ? null
                              : modelPricing[ck] || modelPricing[site.name]
                          }
                          isDetecting={
                            cardItem.type === 'custom-cli' ? false : detectingSites.has(ck)
                          }
                          checkingIn={checkingIn}
                          dragOverIndex={dragOverIndex}
                          refreshMessage={refreshMessage}
                          cliCompatibility={
                            cardItem.type === 'custom-cli' ? undefined : getCompatibility(ck)
                          }
                          cliConfig={cardItem.type === 'custom-cli' ? null : getCliConfig(ck)}
                          isCliTesting={
                            cardItem.type === 'custom-cli' ? false : isCliTestingSite(ck)
                          }
                          onDetect={(s, accountId) =>
                            cardItem.type === 'custom-cli'
                              ? undefined
                              : detectSingle(s, true, undefined, accountId || account?.id)
                          }
                          onCheckIn={(s, aid) => {
                            if (cardItem.type === 'managed') {
                              handleCheckIn(s, aid || account?.id);
                            }
                          }}
                          onOpenSite={(s, aid) => {
                            if (cardItem.type === 'managed') {
                              handleOpenSite(s, aid || account?.id);
                            }
                          }}
                          onOpenExtraLink={openExtraLink}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          onApply={event => {
                            setCliApplySite(site);
                            setCliApplyCardKey(ck);
                            setCliApplyAnchorEl(event?.currentTarget ?? null);
                          }}
                        />
                      </div>
                    );
                  })}
                </DataTableBody>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===== 站点相关弹窗 ===== */}

      <OperationRecordDialog
        open={showOperationRecords}
        onClose={() => setShowOperationRecords(false)}
      />

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
                      account_name:
                        auth.accountName?.trim() ||
                        resolvedEditingAccount.account_name ||
                        '默认账户',
                      access_token: auth.systemToken,
                      user_id: auth.userId,
                      // AnyRouter 配置
                      ...(auth.anyRouterConfig ? { anyRouterConfig: auth.anyRouterConfig } : {}),
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
                await createSiteWithDefaultAccount(site, auth);
              }
            } catch (error: any) {
              Logger.error('保存站点失败:', error);
              toast.error(`保存站点失败: ${error?.message || '未知错误'}`);
              return;
            }

            setShowSiteEditor(false);
            setEditingAccount(null);

            if (processingAuthErrorSite) {
              const processedAccountId = resolvedEditingAccount?.id;
              const remaining = authErrorSites.filter(item => {
                if (item.name !== processingAuthErrorSite) return true;
                if (!processedAccountId) return false;
                return item.accountId !== processedAccountId;
              });
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
          onConfigChanged={async () => {
            // 重新加载配置，以便其他账户也能看到更新的 hash
            const refreshedConfig = await window.electronAPI.loadConfig();
            setConfig(refreshedConfig);
            await loadAllAccounts(refreshedConfig?.sites);
          }}
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

      {/* CLI 应用配置弹出菜单由 ApplyConfigPopover 单独承载 */}

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
            message: `确定要从备份「${backup.filename}」恢复配置吗？\n\n配置包会恢复配置与默认运行态；旧版配置备份只恢复 config.json。恢复前会自动备份当前配置。`,
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
          onSuccess={async (addedAccount?: AddedAccountInfo) => {
            const cfg = await window.electronAPI.loadConfig();
            setConfig(cfg);
            await loadAllAccounts(cfg?.sites);
            if (cfg) {
              const refreshedSite = cfg.sites.find(s => s.url === addAccountSite.url);
              if (refreshedSite?.id) {
                const addedAccountId = addedAccount?.id;
                if (addedAccountId) {
                  detectSingle(refreshedSite, false, undefined, addedAccountId);
                  return;
                }

                // 回退：旧数据路径仍按最新账户触发一次刷新
                const listRes = await window.electronAPI.accounts?.list(refreshedSite.id);
                const accounts = listRes?.success ? listRes.data : undefined;
                if (accounts && accounts.length > 0) {
                  const newAccount = accounts[accounts.length - 1];
                  detectSingle(refreshedSite, false, undefined, newAccount.id);
                  return;
                }

                detectSingle(refreshedSite);
              }
            }
          }}
          onClose={() => setAddAccountSite(null)}
        />
      )}


      <CliProbeSettingsDialog
        isOpen={showCliProbeSettings}
        config={routeCliProbeConfig ?? DEFAULT_CLI_PROBE_CONFIG}
        saving={savingCliProbeSettings}
        onClose={() => {
          if (!savingCliProbeSettings) {
            setShowCliProbeSettings(false);
          }
        }}
        onSave={handleSaveCliProbeSettings}
      />

      {/* 添加接入点弹窗 */}
      <AddAccessPointDialog
        isOpen={showAddAccessPointDialog}
        onClose={() => setShowAddAccessPointDialog(false)}
        onSmartAdd={() => {
          setEditingSite(null);
          setEditingAccount(null);
          setShowSiteEditor(true);
        }}
        onManualAdd={() => {
          setEditingSite(null);
          setEditingAccount(null);
          setShowSiteEditor(true);
        }}
        onAddDirectConfig={handleAddDirectConfig}
      />

      {/* 侧滑面板 */}
      {selectedItem && (
        <AccessPointDetailPanel
          open={panelOpen}
          onClose={handleClosePanel}
          data={selectedItem}
          siteResult={results.find(
            r =>
              selectedItem.type === 'managed' &&
              selectedItem.account !== null &&
              r.name === selectedItem.site.name &&
              r.accountId === selectedItem.account.id
          )}
          allAccounts={
            selectedItem.type === 'managed' && selectedItem.site.id
              ? accountsBySite[selectedItem.site.id] || []
              : []
          }
          apiKeys={
            selectedItem.type === 'managed' && selectedItem.account
              ? apiKeys[makeCardKey(selectedItem.site.name, selectedItem.account.id)] ||
                apiKeys[selectedItem.site.name] ||
                []
              : []
          }
          userGroups={
            selectedItem.type === 'managed' && selectedItem.account
              ? userGroups[makeCardKey(selectedItem.site.name, selectedItem.account.id)] ||
                userGroups[selectedItem.site.name] ||
                {}
              : {}
          }
          modelPricing={
            selectedItem.type === 'managed' && selectedItem.account
              ? modelPricing[makeCardKey(selectedItem.site.name, selectedItem.account.id)] ||
                modelPricing[selectedItem.site.name]
              : null
          }
          cliConfig={
            selectedItem.type === 'managed' && selectedItem.account
              ? getCliConfig(makeCardKey(selectedItem.site.name, selectedItem.account.id))
              : null
          }
          isCliTesting={isCliTestingSite(
            selectedItem.type === 'managed' && selectedItem.account
              ? makeCardKey(selectedItem.site.name, selectedItem.account.id)
              : ''
          )}
          cliCompatibility={
            selectedItem.type === 'managed' && selectedItem.account
              ? (getCompatibility(makeCardKey(selectedItem.site.name, selectedItem.account.id)) ??
                null)
              : null
          }
          cliCodexDetail={
            selectedItem.type === 'managed' && selectedItem.account
              ? getCompatibility(makeCardKey(selectedItem.site.name, selectedItem.account.id))
                  ?.codexDetail
              : null
          }
          cliGeminiDetail={
            selectedItem.type === 'managed' && selectedItem.account
              ? getCompatibility(makeCardKey(selectedItem.site.name, selectedItem.account.id))
                  ?.geminiDetail
              : null
          }
          showDialog={showDialog}
          onAddAccount={() => {
            if (selectedItem.type === 'managed') {
              setAddAccountSite(selectedItem.site);
            }
          }}
          onSaveAccount={handleSavePanelAccount}
          onDeleteAccount={async (accountId: string) => {
            if (selectedItem.type !== 'managed') return;
            const account = selectedItem.site.id
              ? accountsBySite[selectedItem.site.id]?.find(a => a.id === accountId)
              : null;
            if (account) {
              const deleted = await deleteAccount(selectedItem.site, account);
              if (deleted && selectedItem.account?.id === accountId) {
                handleClosePanel();
              }
            }
          }}
          onToggleGroupFilter={toggleGroupFilter}
          onModelSearchChange={(siteName, search) => setModelSearchStore(siteName, search)}
          onCopyToClipboard={copyToClipboard}
          onOpenCreateTokenDialog={(site: SiteConfig) => {
            if (selectedItem.type !== 'managed' || !selectedItem.account) return;
            const cardKey = makeCardKey(site.name, selectedItem.account.id);
            handleOpenCreateTokenDialog(site, getCardContext(cardKey, selectedItem.account));
          }}
          onRefreshToken={(site: SiteConfig, token: any, index: number) => {
            if (selectedItem.type !== 'managed' || !selectedItem.account) return;
            const cardKey = makeCardKey(site.name, selectedItem.account.id);
            handleRefreshToken(site, token, index, getCardContext(cardKey, selectedItem.account));
          }}
          onDeleteToken={(site: SiteConfig, token: any, index: number) => {
            if (selectedItem.type !== 'managed' || !selectedItem.account) return;
            const cardKey = makeCardKey(site.name, selectedItem.account.id);
            handleDeleteToken(site, token, index, getCardContext(cardKey, selectedItem.account));
          }}
          onDeleteDirectConfig={handleDeleteDirectConfig}
          onUpdateAnyRouterUserHash={handleUpdateAnyRouterUserHash}
          onSaveCliConfig={async (newConfig: CliConfig) => {
            if (selectedItem.type !== 'managed') return;
            try {
              const cardKey = makeCardKey(selectedItem.site.name, selectedItem.account?.id);
              const result = await (window.electronAPI as any).cliCompat.saveConfig(
                selectedItem.site.url,
                newConfig,
                selectedItem.account?.id
              );
              if (!result?.success) {
                throw new Error(result?.error ?? '保存 CLI 配置失败');
              }
              setCliConfig(cardKey, newConfig);
              toast.success('CLI 配置已保存');
            } catch {
              toast.error('保存 CLI 配置失败');
            }
          }}
          onConfigChanged={async () => {
            if (selectedItem.type === 'managed') {
              const refreshedConfig = await window.electronAPI.loadConfig();
              setConfig(refreshedConfig);
              await loadAllAccounts(refreshedConfig?.sites);
            } else {
              await handleDirectConfigSaved(selectedItem.config.id);
            }
          }}
        />
      )}
    </>
  );
}
