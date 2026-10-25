import { saveAppConfig } from '../../services/config-commands';
import {
  AccountInfo,
  makeCardKey,
  getCustomCliDisplayName,
  buildCustomCliVirtualSite,
  buildCustomCliVirtualAccount,
  buildCustomCliVirtualResult,
} from './site-projections';
import Logger from '../../utils/logger';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';

import type { SiteSettingsChanges } from '../../components/dialogs';

import { AppButton } from '../../components/AppButton/AppButton';

import {
  useSiteGroups,
  useCheckIn,
  useTokenManagement,
  useSiteDrag,
  useSiteDetection,
  useDateString,
} from '../../hooks';
import type { NewApiTokenForm } from '../../hooks';

import { normalizeSiteSortField } from '../../utils/siteSort';
import { getSiteDailyStats } from '../../utils/siteDailyStats';
import {
  SITE_TYPES,
  SITE_TYPE_LABELS,
  type SiteConfig,
  type DetectionResult,
  type AnyRouterAccountConfig,
  type AccountBrowserProfileOptions,
  type AccountAuthSource,
  type BrowserProfileOptionId,
} from '../../../shared/types/site';
import type { Config, SiteGroup } from '../../../shared/types/renderer-config';
import {
  UNKNOWN_SITE_TYPE_FILTER,
  type SiteTypeFilterOption,
  type SiteTypeFilterValue,
} from '../../components/SiteListHeader/SiteListHeader';
import { useConfigStore } from '../../store/configStore';
import { useDetectionStore } from '../../store/detectionStore';
import { useUIStore } from '../../store/uiStore';
import { useCustomCliConfigStore } from '../../store/customCliConfigStore';
import { toast } from '../../store/toastStore';
import { DialogState, initialDialogState } from '../../components/ConfirmDialog';
import type { CustomCliConfig } from '../../../shared/types/custom-cli-config';
import {
  BackupInfo,
  EditingAccountInfo,
  CardOperationContext,
  FlattenedCardItem,
  SelectedSiteItem,
  SitesPageProps,
} from './SitesPageParts';
export function useSitesController({ setPageHeaderActions }: SitesPageProps) {
  // ========== 从 Store 读取状态 ==========
  const { config, setConfig, setSaving, updateSite: storeUpdateSite } = useConfigStore();

  const {
    apiKeys,
    userGroups,
    modelPricing,
    setApiKeys,
    setUserGroups,
    setModelPricing,
    getCliConfig,
  } = useDetectionStore();
  const {
    configs: customCliConfigs,
    fetchingModels,
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
  const [siteEditorInitialMode, setSiteEditorInitialMode] = useState<'auto' | 'manual'>('auto');
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
  const [showSiteSettings, setShowSiteSettings] = useState(false);
  const [savingSiteSettings, setSavingSiteSettings] = useState(false);

  // 多账户: 按站点 ID 预加载的账户列表
  const [accountsBySite, setAccountsBySite] = useState<Record<string, AccountInfo[]>>({});
  const [, setRefreshingTokenKey] = useState<string | null>(null);
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
          await saveAppConfig({ ...currentConfig, settings: newSettings });
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
      await saveAppConfig(newConfig);
      setConfig(newConfig);
    } catch (error) {
      Logger.error('保存配置失败:', error);
      toast.error('保存配置失败: ' + error);
      throw error;
    } finally {
      setSaving(false);
    }
  };

  // 弹窗辅助函数
  const showDialog = useCallback(
    (options: Partial<DialogState> & { message: string }): Promise<boolean> => {
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
    },
    [setDialogState]
  );

  const showAlert = useCallback(
    (
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
    },
    [setDialogState]
  );

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

  const handleSiteDetectionAuthError = useCallback(
    (sites: Array<{ name: string; url: string; error: string; accountId?: string }>) => {
      for (const site of sites) {
        addAuthErrorSite(site);
      }
      setShowAuthErrorDialog(true);
    },
    [addAuthErrorSite, setShowAuthErrorDialog]
  );

  const siteDetectionOptions = useMemo(
    () => ({
      onAuthError: handleSiteDetectionAuthError,
      showDialog,
    }),
    [handleSiteDetectionAuthError, showDialog]
  );

  // 站点检测 hook
  const { detectingSites, results, setResults, detectSingle, detectAllSites } =
    useSiteDetection(siteDetectionOptions);

  // 规范化站点分组配置
  const siteGroups: SiteGroup[] = useMemo(() => {
    if (
      !config?.siteGroups ||
      !Array.isArray(config.siteGroups) ||
      config.siteGroups.length === 0
    ) {
      return [{ id: 'default', name: '默认分组' }];
    }
    return config.siteGroups;
  }, [config?.siteGroups]);
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
      api_key: '',
      extra_links: site.extra_links,
      has_checkin: site.has_checkin,
      force_enable_checkin: site.force_enable_checkin,
      proxy_url: site.proxy_url,
      auto_refresh: site.auto_refresh,
      auto_refresh_interval: site.auto_refresh_interval,
    }),
    [defaultGroupId]
  );

  const createSiteWithDefaultAccount = useCallback(
    async (
      site: SiteConfig,
      auth: {
        systemToken?: string;
        userId?: string;
        authSource: AccountAuthSource;
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

      // 始终创建默认账户容器，即使凭证为空；否则站点会退化为“无账户”卡片，无法进行删除或本地 Key 管理。
      const accountResult = await (async () => {
        try {
          const result = await window.electronAPI.accounts?.add({
            site_id: createdSiteId,
            account_name: auth.accountName?.trim() || '默认账户',
            user_id: auth.userId?.trim() || '',
            access_token: auth.systemToken?.trim() || '',
            api_key: site.api_key,
            auth_source: auth.authSource,
            ...(auth.authSource === 'main_profile' ? { automation_slot: 0 } : {}),
            ...(auth.anyRouterConfig ? { anyRouterConfig: auth.anyRouterConfig } : {}),
          });
          if (!result?.success || !result.data?.id)
            throw new Error(result?.error || '创建默认账户失败');
          return result;
        } catch (error) {
          try {
            const rollback = await window.electronAPI.sites?.delete(createdSiteId);
            if (!rollback?.success) Logger.error('Failed to roll back the newly created site');
          } catch (rollbackError) {
            Logger.error('Failed to roll back the newly created site', rollbackError);
          }
          throw error;
        }
      })();

      const refreshedConfig = await window.electronAPI.loadConfig();
      setConfig(refreshedConfig);
      await loadAllAccounts(refreshedConfig?.sites);

      const refreshedSite =
        refreshedConfig?.sites?.find((item: SiteConfig) => item.id === createdSiteId) ||
        createdSite;

      const hasCredentials = Boolean(auth.systemToken?.trim() && auth.userId?.trim());
      if (!hasCredentials) return;

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
        const result = await window.electronAPI.accounts?.delete(account.id);
        if (!result?.success) throw new Error(result?.error || '删除账户失败');
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
          | 'account_name'
          | 'user_id'
          | 'access_token'
          | 'auto_refresh'
          | 'auto_refresh_interval'
          | 'routeTargetProtocol'
          | 'routeTargetProtocolNeedsConfirmation'
          | 'routeAuthScheme'
          | 'supportedProtocols'
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

  const handleLoadPanelBrowserProfiles = useCallback(
    async (siteId: string, accountId: string): Promise<AccountBrowserProfileOptions> => {
      const result = await window.electronAPI.browserProfile?.listAccountOptions(siteId, accountId);
      if (!result?.success || !result.data) {
        throw new Error(result?.error || '加载浏览器 Profile 失败');
      }
      return result.data;
    },
    []
  );

  const handleBindPanelBrowserProfile = useCallback(
    async (siteId: string, accountId: string, optionId: BrowserProfileOptionId) => {
      try {
        const result = await window.electronAPI.browserProfile?.bindAccount(
          siteId,
          accountId,
          optionId
        );
        if (!result?.success) {
          throw new Error(result?.error || '保存浏览器 Profile 失败');
        }

        const refreshedConfig = await window.electronAPI.loadConfig();
        setConfig(refreshedConfig);
        const refreshedAccountsBySite = await loadAllAccounts(refreshedConfig?.sites);
        setSelectedItem(prev => {
          if (prev?.type !== 'managed' || prev.account?.id !== accountId) {
            return prev;
          }
          const latestAccount = refreshedAccountsBySite[siteId]?.find(
            account => account.id === accountId
          );
          return latestAccount ? { ...prev, account: latestAccount } : prev;
        });

        toast.success('浏览器 Profile 已更新');
      } catch (err: any) {
        Logger.error('保存浏览器 Profile 失败:', err);
        toast.error('保存浏览器 Profile 失败: ' + (err?.message || err));
        throw err;
      }
    },
    [loadAllAccounts, setConfig]
  );

  const handleSavePanelSiteMeta = useCallback(
    async (
      siteId: string,
      updates: Partial<
        Pick<
          SiteConfig,
          'name' | 'url' | 'site_type' | 'group' | 'extra_links' | 'force_enable_checkin'
        >
      >
    ) => {
      if (!config) return;
      const updatedSites = config.sites.map(site =>
        site.id === siteId
          ? {
              ...site,
              ...updates,
              group: updates.group ?? site.group ?? defaultGroupId,
            }
          : site
      );
      const nextConfig = { ...config, sites: updatedSites };
      await saveConfig(nextConfig);

      setSelectedItem(prev => {
        if (prev?.type !== 'managed' || prev.site.id !== siteId) {
          return prev;
        }
        const latestSite = updatedSites.find(site => site.id === siteId) ?? prev.site;
        return { ...prev, site: latestSite };
      });
      toast.success('站点信息已保存');
    },
    [config, defaultGroupId, saveConfig]
  );

  const handleRefreshPanelAccountInfo = useCallback(
    async (_site: SiteConfig, accountId: string) => {
      try {
        const result = await window.electronAPI.token?.refreshAccountBasicInfo?.(accountId);
        if (!result?.success) {
          throw new Error(result?.error || '重新获取站点账户信息失败');
        }

        const refreshedConfig = await window.electronAPI.loadConfig();
        setConfig(refreshedConfig);
        const refreshedAccountsBySite = await loadAllAccounts(refreshedConfig?.sites);

        setSelectedItem(prev => {
          if (prev?.type !== 'managed' || prev.account?.id !== accountId) {
            return prev;
          }

          const latestSite =
            refreshedConfig?.sites?.find(candidate => candidate.id === prev.site.id) ?? prev.site;
          const latestAccount = latestSite.id
            ? refreshedAccountsBySite[latestSite.id]?.find(account => account.id === accountId)
            : null;

          return {
            ...prev,
            site: latestSite,
            account: latestAccount ?? prev.account,
          };
        });

        toast.success('站点账户信息已重新获取');
      } catch (error: any) {
        Logger.error('重新获取站点账户信息失败:', error);
        toast.error('重新获取站点账户信息失败: ' + (error?.message || error));
        throw error;
      }
    },
    [loadAllAccounts, setConfig]
  );

  const handleOpenDetectionSettings = useCallback(() => {
    setShowSiteSettings(true);
  }, []);

  const handleSaveSiteSettings = useCallback(
    async ({ siteRefreshSettings }: SiteSettingsChanges) => {
      setSavingSiteSettings(true);
      try {
        if (siteRefreshSettings) {
          const currentConfig = useConfigStore.getState().config;
          if (!currentConfig) {
            throw new Error('站点配置尚未加载');
          }
          const nextConfig = {
            ...currentConfig,
            settings: { ...currentConfig.settings, ...siteRefreshSettings },
          };
          await saveAppConfig(nextConfig);
          setConfig(nextConfig);
        }
        setShowSiteSettings(false);
        toast.success('站点设置已保存');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        Logger.error('保存站点设置失败:', error);
        toast.error('保存站点设置失败: ' + message);
      } finally {
        setSavingSiteSettings(false);
      }
    },
    [setConfig]
  );

  // 签到逻辑 hook
  const { handleCheckIn, handleCheckInAll } = useCheckIn({
    showDialog,
    showAlert,
    setCheckingIn,
  });
  const handleCheckInAllRef = useRef(handleCheckInAll);
  handleCheckInAllRef.current = handleCheckInAll;

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

  const handleOpenSite = async (site: SiteConfig) => {
    try {
      await window.electronAPI.openUrl(site.url);
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
  const handleOpenBackupDialog = useCallback(async () => {
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
  }, []);

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

  const handleRefreshDirectConfig = useCallback(async (configId: string) => {
    await useCustomCliConfigStore.getState().fetchModels(configId);
  }, []);

  // 一键刷新继承旧批量检测结果回写，再补充直连配置模型刷新
  const handleRefreshAll = useCallback(async () => {
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
  }, [
    accountsBySite,
    config,
    detectAllSites,
    loadAllAccounts,
    loadCustomCliConfigs,
    refreshAllDirectConfigModels,
    setConfig,
  ]);

  // 一键签到继承 useCheckIn 的批量过滤、结果回写和失败手动签到入口
  const handleCheckInAllSites = useCallback(async () => {
    setIsCheckingInAll(true);
    try {
      await handleCheckInAllRef.current();
      const cfg = await window.electronAPI.loadConfig();
      setConfig(cfg);
      await loadAllAccounts(cfg?.sites);
    } catch (error: any) {
      Logger.error('签到失败:', error);
      toast.error(`签到失败：${error.message}`);
    } finally {
      setIsCheckingInAll(false);
    }
  }, [loadAllAccounts, setConfig]);

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
          className="!h-7 !min-h-7"
          onClick={handleOpenDetectionSettings}
          title="打开站点设置"
          aria-label="设置"
        >
          设置
        </AppButton>
        <AppButton
          variant="secondary"
          size="sm"
          className="!h-7 !min-h-7"
          onClick={() => setShowOperationRecords(true)}
          title="查看应用操作记录"
          aria-label="操作记录"
        >
          操作记录
        </AppButton>
        <AppButton
          variant="secondary"
          size="sm"
          className="!h-7 !min-h-7"
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
          className="!h-7 !min-h-7"
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
          className="!h-7 !min-h-7"
          onClick={() => setShowAddAccessPointDialog(true)}
          title="添加站点"
          aria-label="添加站点"
        >
          添加站点
        </AppButton>
        <AppButton
          variant="secondary"
          size="sm"
          className="!h-7 !min-h-7"
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
      handleOpenBackupDialog,
      handleRefreshAll,
      handleCheckInAllSites,
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
  return {
    hasAccessPoints,
    siteGroups,
    effectiveActiveSiteGroupFilter,
    config,
    defaultGroupId,
    customCliConfigs,
    dragOverGroupIndex,
    draggedGroupIndex,
    handleGroupDragStart,
    handleGroupDragEnd,
    dragOverGroupId,
    handleGroupDragOver,
    setDragOverGroupId,
    handleGroupDragLeave,
    handleGroupDrop,
    handleDropOnGroup,
    toggleSiteGroupFilter,
    openEditGroupDialog,
    deleteSiteGroup,
    openCreateGroupDialog,
    globalModelSearch,
    handleGlobalModelSearchChange,
    setShowAddAccessPointDialog,
    handleOpenBackupDialog,
    visibleColumnWidths,
    setColumnWidth,
    effectiveSortField,
    sortOrder,
    toggleSort,
    resetSort,
    activeSiteTypeFilter,
    siteTypeFilterOptions,
    setActiveSiteTypeFilter,
    flattenedCards,
    siteHasMatchingModels,
    handleRowClick,
    modelPricing,
    fetchingModels,
    detectingSites,
    checkingIn,
    dragOverIndex,
    refreshMessage,
    getCliConfig,
    handleRefreshDirectConfig,
    detectSingle,
    handleCheckIn,
    handleOpenSite,
    openExtraLink,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setCliApplySite,
    setCliApplyCardKey,
    setCliApplyAnchorEl,
    showOperationRecords,
    setShowOperationRecords,
    showSiteEditor,
    siteBeingEdited,
    resolvedEditingAccount,
    siteEditorInitialMode,
    editingSite,
    storeUpdateSite,
    setConfig,
    loadAllAccounts,
    createSiteWithDefaultAccount,
    setShowSiteEditor,
    setEditingAccount,
    processingAuthErrorSite,
    authErrorSites,
    setAuthErrorSites,
    setProcessingAuthErrorSite,
    setShowAuthErrorDialog,
    showCreateGroupDialog,
    newGroupName,
    setNewGroupName,
    confirmCreateSiteGroup,
    closeCreateGroupDialog,
    showEditGroupDialog,
    editingGroup,
    editGroupName,
    setEditGroupName,
    confirmEditSiteGroup,
    closeEditGroupDialog,
    creatingTokenSite,
    tokenDialogVersion,
    newTokenForm,
    userGroups,
    tokenOperationContext,
    creatingTokenCardKey,
    creatingToken,
    setNewTokenForm,
    handleCreateTokenSubmit,
    closeCreateTokenDialogWithContext,
    cliApplySite,
    cliApplyAnchorEl,
    cliApplyCardKey,
    apiKeys,
    showBackupDialog,
    backupList,
    loadingBackups,
    setShowBackupDialog,
    showDialog,
    showAlert,
    addAccountSite,
    setAddAccountSite,
    showSiteSettings,
    savingSiteSettings,
    setShowSiteSettings,
    handleSaveSiteSettings,
    showAddAccessPointDialog,
    setEditingSite,
    setSiteEditorInitialMode,
    handleAddDirectConfig,
    selectedItem,
    panelOpen,
    handleClosePanel,
    results,
    accountsBySite,
    handleSavePanelSiteMeta,
    handleSavePanelAccount,
    handleLoadPanelBrowserProfiles,
    handleBindPanelBrowserProfile,
    handleRefreshPanelAccountInfo,
    deleteAccount,
    toggleGroupFilter,
    setModelSearchStore,
    copyToClipboard,
    handleOpenCreateTokenDialog,
    getCardContext,
    handleRefreshToken,
    handleDeleteToken,
    handleDeleteDirectConfig,
    handleUpdateAnyRouterUserHash,
    handleDirectConfigSaved,
  };
}
