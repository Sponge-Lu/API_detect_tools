/**
 * 站点管理独立页面
 * 从 App.tsx 提取的站点管理核心逻辑和 UI
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
  ArrowUp,
  ArrowDown,
  Calendar,
} from 'lucide-react';
import { SiteEditor } from '../components/SiteEditor';
import { SiteCard } from '../components/SiteCard';
import {
  SiteGroupDialog,
  BackupSelectDialog,
  UnifiedCliConfigDialog,
  ApplyConfigPopover,
} from '../components/dialogs';
import type { CliConfig } from '../../shared/types/cli-config';
import { CreateApiKeyDialog } from '../components/CreateApiKeyDialog';
import { IOSButton } from '../components/IOSButton';
import { IOSTableHeader, IOSTableBody } from '../components/IOSTable';
import {
  useSiteGroups,
  useCheckIn,
  useTokenManagement,
  useSiteDrag,
  useSiteDetection,
  useAutoRefresh,
  useCliCompatTest,
} from '../hooks';
import type { NewApiTokenForm } from '../hooks';
import { getGroupTextColor } from '../utils/groupStyle';
import type { SiteConfig, DetectionResult } from '../../shared/types/site';
import type { Config, SiteGroup } from '../App';

import { useConfigStore } from '../store/configStore';
import { useDetectionStore } from '../store/detectionStore';
import { useUIStore, SortField } from '../store/uiStore';
import { toast } from '../store/toastStore';
import { DialogState, initialDialogState } from '../components/ConfirmDialog';

// 备份信息类型
interface BackupInfo {
  filename: string;
  path: string;
  timestamp: Date;
  size: number;
}

export function SitesPage() {
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
    selectedModels,
    toggleModelSelected,
    clearSelectedModels,
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
  } = useUIStore();

  // 备份选择对话框状态
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [backupList, setBackupList] = useState<BackupInfo[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);

  // CLI 配置对话框状态
  const [showCliConfigDialog, setShowCliConfigDialog] = useState(false);
  const [cliConfigSite, setCliConfigSite] = useState<SiteConfig | null>(null);

  // 应用配置弹出菜单状态
  const [showApplyConfigPopover, setShowApplyConfigPopover] = useState(false);
  const [applyConfigAnchorEl, setApplyConfigAnchorEl] = useState<HTMLElement | null>(null);
  const [applyConfigSite, setApplyConfigSite] = useState<SiteConfig | null>(null);

  // 兼容层
  const setNewTokenForm = (form: NewApiTokenForm | ((p: NewApiTokenForm) => NewApiTokenForm)) => {
    if (typeof form === 'function') {
      setNewTokenFormStore(form(newTokenForm));
    } else {
      setNewTokenFormStore(form);
    }
  };
  const setColumnWidths = (widths: number[] | ((p: number[]) => number[])) => {
    if (typeof widths === 'function') {
      const newWidths = widths(columnWidths);
      newWidths.forEach((w, i) => setColumnWidth(i, w));
    } else {
      widths.forEach((w, i) => setColumnWidth(i, w));
    }
  };

  const columnWidthsRef = useRef<number[]>(columnWidths);
  useEffect(() => {
    columnWidthsRef.current = columnWidths;
  }, [columnWidths]);

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
      const newSort = { field: sortField, order: sortOrder };
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
  }, [sortField, sortOrder, setConfig]);

  // 列宽调整
  const handleColumnResizeMouseDown = (event: React.MouseEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = columnWidthsRef.current[index];
    const minWidth = 50;
    const maxWidth = 320;

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      let nextWidth = startWidth + delta;
      if (nextWidth < minWidth) nextWidth = minWidth;
      if (nextWidth > maxWidth) nextWidth = maxWidth;

      setColumnWidths(prev => {
        const next = [...prev];
        next[index] = nextWidth;
        return next;
      });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // 切换分组选择
  const toggleGroupFilter = (siteName: string, groupName: string | null) => {
    const current = selectedGroup[siteName];
    setSelectedGroup(siteName, current === groupName ? null : groupName);
  };

  const handleOpenCreateTokenDialog = (site: SiteConfig) => {
    if (!site.system_token || !site.user_id) {
      toast.warning('当前站点未配置系统 Token 或用户 ID，请先在"编辑站点"中填写。');
      return;
    }
    openCreateTokenDialog(site);
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
    title?: string
  ) => {
    setDialogState({
      isOpen: true,
      type,
      title,
      message,
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
  const { detecting, detectingSite, results, setResults, detectSingle, detectAllSites } =
    useSiteDetection({
      onAuthError: sites => {
        setAuthErrorSites(sites);
        setShowAuthErrorDialog(true);
      },
      showDialog,
    });

  // 自动刷新 hook
  useAutoRefresh({
    sites: config?.sites || [],
    detectSingle,
    enabled: true,
    onRefresh: (siteName: string) => {
      toast.success(`${siteName} 自动刷新完成`);
    },
    onError: (siteName: string, error: Error) => {
      Logger.error(`[AutoRefresh] ${siteName} 刷新失败:`, error);
    },
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
          await window.electronAPI.closeBrowser?.();
        } catch (err) {
          Logger.warn('自动关闭浏览器失败:', err);
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
    await detectAllSites(config);
  };

  // 签到逻辑 hook
  const { handleCheckIn, handleCheckInAll, openCheckinPage } = useCheckIn({
    showDialog,
    showAlert,
    setCheckingIn,
  });

  // 令牌管理 hook
  const { handleDeleteToken: deleteToken, handleCreateTokenSubmit: createToken } =
    useTokenManagement({
      results,
      setResults,
      setApiKeys,
      showDialog,
      showAlert,
    });

  const handleDeleteToken = (site: SiteConfig, token: any, tokenIndex: number) => {
    deleteToken(site, token, tokenIndex, setDeletingTokenKey);
  };

  const handleCreateTokenSubmit = () => {
    if (!creatingTokenSite) return;
    createToken(creatingTokenSite, newTokenForm, setCreatingToken, closeCreateTokenDialog);
  };

  const openExtraLink = async (url: string) => {
    try {
      await window.electronAPI.openUrl(url);
    } catch (error) {
      Logger.error('打开加油站链接失败:', error);
      toast.error('打开加油站链接失败: ' + error);
    }
  };

  const toggleModelSelection = (model: string) => {
    toggleModelSelected(model);
  };

  const copySelectedModels = async () => {
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
      } else if (config?.sites?.length) {
        expandDebounceRef.current = setTimeout(() => {
          config.sites.forEach(site => {
            const siteResult = results.find(r => r.name === site.name);
            if (siteResult) {
              setApiKeys(site.name, siteResult.apiKeys || []);
              setUserGroups(site.name, siteResult.userGroups || {});
              setModelPricing(site.name, siteResult.modelPricing || { data: {} });
            }
          });
          setExpandedSites(new Set(config.sites.map(site => site.name)));
        }, 100);
      }
    },
    [
      modelSearch,
      clearAllModelSearch,
      setGlobalModelSearch,
      setExpandedSites,
      config?.sites,
      results,
      setApiKeys,
      setUserGroups,
      setModelPricing,
    ]
  );

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

  // 展开站点
  const handleExpandSite = (siteName: string) => {
    const isExpanding = !expandedSites.has(siteName);
    toggleSiteExpanded(siteName);

    if (isExpanding) {
      const siteResult = results.find(r => r.name === siteName);
      if (siteResult) {
        setApiKeys(siteName, siteResult.apiKeys || []);
        setUserGroups(siteName, siteResult.userGroups || {});
        setModelPricing(siteName, siteResult.modelPricing || { data: {} });
      }
    }
  };

  const handleToggleAllExpanded = () => {
    if (!config) return;
    const allSiteNames = config.sites.map(s => s.name);
    const allExpanded = allSiteNames.every(name => expandedSites.has(name));

    if (allExpanded) {
      setExpandedSites(new Set());
    } else {
      allSiteNames.forEach(siteName => {
        const siteResult = results.find(r => r.name === siteName);
        if (siteResult) {
          setApiKeys(siteName, siteResult.apiKeys || []);
          setUserGroups(siteName, siteResult.userGroups || {});
          setModelPricing(siteName, siteResult.modelPricing || { data: {} });
        }
      });
      setExpandedSites(new Set(allSiteNames));
    }
  };

  // 检查站点是否有匹配全局搜索的模型
  const siteHasMatchingModels = (site: SiteConfig, siteResult?: DetectionResult): boolean => {
    if (!globalModelSearch) return true;
    const searchTerm = globalModelSearch.toLowerCase();
    let models = siteResult?.models || [];
    const pricing = modelPricing[site.name];
    if (pricing?.data && typeof pricing.data === 'object') {
      const pricingModels = Object.keys(pricing.data);
      if (pricingModels.length > models.length) {
        models = pricingModels;
      }
    }
    return models.some(m => m.toLowerCase().includes(searchTerm));
  };

  // 获取站点的排序值
  const getSortValue = useCallback(
    (site: SiteConfig, siteResult?: DetectionResult): number | string => {
      if (!sortField) return 0;

      const todayPromptTokens = siteResult?.todayPromptTokens ?? 0;
      const todayCompletionTokens = siteResult?.todayCompletionTokens ?? 0;
      const todayTotalTokens =
        siteResult?.todayTotalTokens ?? todayPromptTokens + todayCompletionTokens;
      const todayRequests = siteResult?.todayRequests ?? 0;

      const now = new Date();
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const minutesSinceStart = Math.max((now.getTime() - dayStart.getTime()) / 60000, 1);
      const rpm = todayRequests > 0 ? todayRequests / minutesSinceStart : 0;
      const tpm = todayTotalTokens > 0 ? todayTotalTokens / minutesSinceStart : 0;

      const apiModelCount = siteResult?.models?.length || 0;
      const pricing = modelPricing[site.name];
      const pricingModelCount = pricing?.data ? Object.keys(pricing.data).length : 0;
      const modelCount = Math.max(apiModelCount, pricingModelCount);

      const lastSyncTime = siteResult?.lastRefresh || 0;

      switch (sortField) {
        case 'name':
          return site.name.toLowerCase();
        case 'balance':
          return siteResult?.balance ?? -Infinity;
        case 'todayUsage':
          return siteResult?.todayUsage ?? -Infinity;
        case 'totalTokens':
          return todayTotalTokens;
        case 'promptTokens':
          return todayPromptTokens;
        case 'completionTokens':
          return todayCompletionTokens;
        case 'requests':
          return todayRequests;
        case 'rpm':
          return rpm;
        case 'tpm':
          return tpm;
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
    [sortField, modelPricing]
  );

  // 排序后的站点列表
  const sortedSites = useMemo(() => {
    if (!config?.sites) return [];

    const sitesWithIndex = config.sites.map((site, index) => {
      const siteResult = results.find(r => r.name === site.name);
      return { site, index, siteResult };
    });

    if (!sortField) return sitesWithIndex;

    return [...sitesWithIndex].sort((a, b) => {
      const aValue = getSortValue(a.site, a.siteResult);
      const bValue = getSortValue(b.site, b.siteResult);

      let comparison = 0;
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        comparison = aValue.localeCompare(bValue);
      } else {
        comparison = (aValue as number) - (bValue as number);
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [config?.sites, results, sortField, sortOrder, getSortValue]);

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

  // 如果没有config，不渲染（由App.tsx保证有config才渲染页面）
  if (!config) return null;

  return (
    <>
      <div className="flex-1 overflow-y-hidden overflow-x-visible flex">
        <div className="flex-1 flex flex-col">
          {/* 站点分组控制栏 */}
          {config.sites.length > 0 && (
            <div className="min-w-[1180px] px-4 pt-2 pb-1 flex items-center justify-between text-[13px] text-slate-500 dark:text-slate-400 border-b border-slate-200/50 dark:border-slate-700/50 flex-shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-700 dark:text-slate-200">站点分组</span>
                <button
                  onClick={() => setActiveSiteGroupFilter(null)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[13px] transition-all ${
                    activeSiteGroupFilter === null
                      ? 'border-primary-500 bg-primary-500 text-white'
                      : 'border-slate-300 dark:border-slate-600 bg-white/80 dark:bg-slate-900/60 hover:border-primary-300'
                  }`}
                  title="显示全部站点"
                >
                  <span className="font-semibold">全部</span>
                  <span
                    className={`text-xs ${activeSiteGroupFilter === null ? 'text-white/80' : 'text-slate-400 dark:text-slate-500'}`}
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
                          ? 'border-primary-500 bg-primary-500 text-white'
                          : isDragOverForSort
                            ? 'border-primary-500 bg-primary-100/80 dark:bg-primary-900/50 scale-105'
                            : dragOverGroupId === groupId
                              ? 'border-primary-400 bg-primary-50/80 dark:bg-primary-900/30'
                              : 'border-slate-300 dark:border-slate-600 bg-white/80 dark:bg-slate-900/60 hover:border-primary-300'
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
                        className={`text-xs ${isActive ? 'text-white/80' : 'text-slate-400 dark:text-slate-500'}`}
                      >
                        {groupSitesCount} 个
                      </span>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          openEditGroupDialog(group);
                        }}
                        className={`hidden group-hover/tag:block p-0.5 rounded transition-colors ${isActive ? 'hover:bg-white/20 text-white/80 hover:text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-primary-500'}`}
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
                          className={`hidden group-hover/tag:block p-0.5 rounded transition-colors ${isActive ? 'hover:bg-white/20 text-white/80 hover:text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-red-500'}`}
                          title="删除分组"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
                <IOSButton
                  variant="tertiary"
                  size="sm"
                  onClick={openCreateGroupDialog}
                  title="新建分组"
                >
                  <Plus className="w-3 h-3" />
                  新建分组
                </IOSButton>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={globalModelSearch}
                    onChange={e => handleGlobalModelSearchChange(e.target.value)}
                    placeholder="搜索可用模型（全局）"
                    className="pl-8 pr-7 py-2 text-sm bg-white/80 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-primary-400 shadow-inner"
                  />
                  {globalModelSearch && (
                    <button
                      onClick={() => handleGlobalModelSearchChange('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      title="清空全局搜索"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <IOSButton
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setEditingSite(null);
                    setShowSiteEditor(true);
                  }}
                >
                  <Plus className="w-4 h-4" strokeWidth={2.5} />
                  添加站点
                </IOSButton>
                <IOSButton
                  variant="secondary"
                  size="sm"
                  onClick={handleOpenBackupDialog}
                  title="从备份文件恢复站点配置"
                >
                  <RefreshCw className="w-4 h-4" strokeWidth={2.5} />
                  恢复站点
                </IOSButton>
              </div>
            </div>
          )}

          {/* 站点列表区域 */}
          <div className="flex-1 overflow-y-auto overflow-x-visible px-4 pb-4 space-y-3 relative z-0 ios-scroll-y">
            {config.sites.length === 0 ? (
              <div className="text-center py-16 text-light-text-secondary dark:text-dark-text-secondary">
                <Server className="w-16 h-16 mx-auto mb-4 opacity-30" strokeWidth={1.5} />
                <p className="text-lg font-medium mb-2">还没有添加任何站点</p>
                <p className="text-sm mb-4">点击"添加站点"按钮开始</p>
                <div className="flex items-center justify-center gap-2">
                  <IOSButton
                    variant="primary"
                    onClick={() => {
                      setEditingSite(null);
                      setShowSiteEditor(true);
                    }}
                  >
                    <Plus className="w-4 h-4" strokeWidth={2.5} />
                    添加站点
                  </IOSButton>
                  <IOSButton variant="secondary" onClick={handleOpenBackupDialog}>
                    从备份恢复站点
                  </IOSButton>
                </div>
                <p className="text-xs mt-2 text-slate-400">从备份目录选择配置文件进行恢复</p>
              </div>
            ) : (
              <>
                <IOSTableHeader
                  sticky
                  className="min-w-[1180px] !px-4 !py-1 flex items-center justify-between !text-[13px] !font-semibold text-[var(--ios-text-secondary)]"
                >
                  <div
                    className="grid gap-x-1 flex-1 items-center select-none"
                    style={{ gridTemplateColumns: columnWidths.map(w => `${w}px`).join(' ') }}
                  >
                    {(
                      [
                        { label: '站点', field: 'name' },
                        { label: '余额', field: 'balance' },
                        { label: '今日消费', field: 'todayUsage' },
                        { label: '总 Token', field: 'totalTokens' },
                        { label: '输入', field: 'promptTokens' },
                        { label: '输出', field: 'completionTokens' },
                        { label: '请求', field: 'requests' },
                        { label: 'RPM', field: 'rpm' },
                        { label: 'TPM', field: 'tpm' },
                        { label: '模型数', field: 'modelCount' },
                        { label: '更新时间', field: 'lastUpdate' },
                        { label: 'CC-CX-Gemini?', field: null },
                        { label: 'LDC比例', field: 'ldcRatio' },
                      ] as { label: string; field: SortField | null }[]
                    ).map(({ label, field }, idx) => {
                      const centerHeader = idx >= 3 && idx <= 12;
                      const isActive = field && sortField === field;
                      const isSortable = field !== null;
                      return (
                        <div
                          key={label}
                          className={`relative flex items-center pr-1 min-h-[44px] ${
                            centerHeader ? 'justify-center text-center' : 'justify-start'
                          }`}
                        >
                          {isSortable ? (
                            <button
                              onClick={() => toggleSort(field)}
                              className={`flex items-center gap-0.5 hover:text-[var(--ios-blue)] transition-colors duration-[var(--duration-fast)] ${
                                isActive ? 'text-[var(--ios-blue)]' : ''
                              } ${centerHeader ? 'justify-center' : ''}`}
                              title={`点击按${label}排序`}
                            >
                              <span>{label}</span>
                              {isActive &&
                                (sortOrder === 'desc' ? (
                                  <ArrowDown className="w-3 h-3" />
                                ) : (
                                  <ArrowUp className="w-3 h-3" />
                                ))}
                            </button>
                          ) : (
                            <span className={centerHeader ? 'text-center w-full' : ''}>
                              {label}
                            </span>
                          )}
                          <div
                            onMouseDown={e => handleColumnResizeMouseDown(e, idx)}
                            className="absolute top-0 right-0 h-full w-1 cursor-col-resize group"
                          >
                            <div className="w-[3px] h-full mx-auto opacity-0 group-hover:opacity-60 bg-[var(--ios-separator)] transition-opacity duration-[var(--duration-fast)]" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleCheckInAll}
                      disabled={!!checkingIn || !config || config.sites.length === 0}
                      className="p-1 hover:bg-yellow-500/20 rounded-[var(--radius-sm)] transition-all duration-[var(--duration-fast)] disabled:opacity-50 disabled:cursor-not-allowed"
                      title="一键签到：批量签到所有可签到站点"
                    >
                      {checkingIn ? (
                        <Loader2
                          className="w-3.5 h-3.5 animate-spin text-yellow-500"
                          strokeWidth={2.5}
                        />
                      ) : (
                        <Calendar
                          className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400 hover:text-yellow-500"
                          strokeWidth={2.5}
                        />
                      )}
                    </button>
                    <button
                      onClick={handleToggleAllExpanded}
                      className="p-1 hover:bg-[rgba(0,0,0,0.05)] dark:hover:bg-[rgba(255,255,255,0.05)] rounded-[var(--radius-sm)] transition-all duration-[var(--duration-fast)]"
                      title={
                        config.sites.every(s => expandedSites.has(s.name)) ? '收起全部' : '展开全部'
                      }
                    >
                      <ChevronsUpDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleDetectAllSites}
                      disabled={detecting || !config || config.sites.length === 0}
                      className="p-1 hover:bg-[rgba(0,0,0,0.05)] dark:hover:bg-[rgba(255,255,255,0.05)] rounded-[var(--radius-sm)] transition-all duration-[var(--duration-fast)] disabled:opacity-50 disabled:cursor-not-allowed"
                      title="检测所有站点"
                    >
                      {detecting ? (
                        <Loader2
                          className="w-3.5 h-3.5 animate-spin text-[var(--ios-blue)]"
                          strokeWidth={2.5}
                        />
                      ) : (
                        <RefreshCw
                          className="w-3.5 h-3.5 text-[var(--ios-text-secondary)] hover:text-[var(--ios-blue)]"
                          strokeWidth={2.5}
                        />
                      )}
                    </button>
                    <div className="w-[71px]" />
                  </div>
                </IOSTableHeader>

                <IOSTableBody className="min-w-[1180px] space-y-3">
                  {sortedSites.map(({ site, index, siteResult: cachedResult }) => {
                    let siteResult = cachedResult;
                    if (!siteResult) {
                      siteResult = results.find(r => r.name === site.name);
                      if (!siteResult) {
                        try {
                          const siteOrigin = new URL(site.url).origin;
                          siteResult = results.find(r => {
                            try {
                              return new URL(r.url).origin === siteOrigin;
                            } catch {
                              return false;
                            }
                          });
                        } catch {
                          // ignore url parse error
                        }
                      }
                    }

                    const groupId = site.group || defaultGroupId;
                    if (activeSiteGroupFilter !== null && groupId !== activeSiteGroupFilter) {
                      return null;
                    }

                    if (!siteHasMatchingModels(site, siteResult)) {
                      return null;
                    }

                    const isExpanded = expandedSites.has(site.name);
                    const siteAccount = null;

                    return (
                      <SiteCard
                        key={site.name}
                        site={site}
                        index={index}
                        siteResult={siteResult}
                        siteAccount={siteAccount}
                        isExpanded={isExpanded}
                        columnWidths={columnWidths}
                        apiKeys={apiKeys[siteResult?.name || site.name] || []}
                        userGroups={userGroups[siteResult?.name || site.name] || {}}
                        modelPricing={modelPricing[site.name]}
                        detectingSite={detectingSite}
                        checkingIn={checkingIn}
                        dragOverIndex={dragOverIndex}
                        refreshMessage={refreshMessage}
                        selectedGroup={selectedGroup[site.name] || null}
                        modelSearch={modelSearch[site.name] || ''}
                        globalModelSearch={globalModelSearch}
                        showTokens={showTokens}
                        selectedModels={selectedModels}
                        deletingTokenKey={deletingTokenKey}
                        autoRefreshEnabled={site.auto_refresh ?? false}
                        cliCompatibility={getCompatibility(site.name)}
                        cliConfig={getCliConfig(site.name)}
                        isCliTesting={isCliTestingSite(site.name)}
                        onExpand={handleExpandSite}
                        onDetect={detectSingle}
                        onEdit={idx => {
                          setEditingSite(idx);
                          setShowSiteEditor(true);
                        }}
                        onDelete={deleteSite}
                        onCheckIn={handleCheckIn}
                        onOpenCheckinPage={openCheckinPage}
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
                        onToggleModelSelection={toggleModelSelection}
                        onCopySelectedModels={copySelectedModels}
                        onClearSelectedModels={clearSelectedModels}
                        onOpenCreateTokenDialog={handleOpenCreateTokenDialog}
                        onDeleteToken={handleDeleteToken}
                        onOpenCliConfig={() => {
                          setCliConfigSite(site);
                          setShowCliConfigDialog(true);
                        }}
                        onTestCliCompat={() => {
                          const siteApiKeys = apiKeys[siteResult?.name || site.name] || [];
                          testCliCompatSite(site.name, site.url, siteApiKeys);
                        }}
                        onApply={(e?: React.MouseEvent<HTMLButtonElement>) => {
                          setApplyConfigSite(site);
                          setApplyConfigAnchorEl(e?.currentTarget || null);
                          setShowApplyConfigPopover(true);
                        }}
                        onToggleAutoRefresh={() => {
                          const newSites = [...config.sites];
                          const interval = site.auto_refresh_interval || 5;
                          if (site.auto_refresh) {
                            newSites[index] = {
                              ...site,
                              auto_refresh: false,
                              auto_refresh_interval: interval,
                            };
                          } else {
                            newSites[index] = {
                              ...site,
                              auto_refresh: true,
                              auto_refresh_interval: interval,
                            };
                          }
                          saveConfig({ ...config, sites: newSites });
                        }}
                      />
                    );
                  })}
                </IOSTableBody>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===== 站点相关弹窗 ===== */}

      {showSiteEditor && (
        <SiteEditor
          site={editingSite !== null ? config.sites[editingSite] : undefined}
          onSave={async site => {
            const isEditing = editingSite !== null;
            if (isEditing) {
              await storeUpdateSite(editingSite, site);
            } else {
              addSite(site);
            }
            setShowSiteEditor(false);

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
                  await detectSingle(site, false);
                } catch (error: any) {
                  Logger.error('站点数据刷新失败:', error.message);
                } finally {
                  try {
                    await window.electronAPI.closeBrowser?.();
                  } catch (err) {
                    Logger.warn('关闭浏览器失败:', err);
                  }
                }
              }, 500);
            }
          }}
          onCancel={() => {
            setShowSiteEditor(false);
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
              results.find(r => r.name === creatingTokenSite.name)?.name || creatingTokenSite.name
            ] || {}
          }
          creating={creatingToken}
          onFormChange={partial => setNewTokenForm(prev => ({ ...prev, ...partial }))}
          onSubmit={handleCreateTokenSubmit}
          onClose={closeCreateTokenDialog}
        />
      )}

      {/* CLI 配置对话框 */}
      {cliConfigSite && (
        <UnifiedCliConfigDialog
          isOpen={showCliConfigDialog}
          siteName={cliConfigSite.name}
          siteUrl={cliConfigSite.url}
          apiKeys={apiKeys[cliConfigSite.name] || []}
          siteModels={results.find(r => r.name === cliConfigSite.name)?.models || []}
          currentConfig={getCliConfig(cliConfigSite.name)}
          codexDetail={getCompatibility(cliConfigSite.name)?.codexDetail}
          geminiDetail={getCompatibility(cliConfigSite.name)?.geminiDetail}
          onClose={() => {
            setShowCliConfigDialog(false);
            setCliConfigSite(null);
          }}
          onSave={async (newConfig: CliConfig) => {
            setCliConfig(cliConfigSite.name, newConfig);
            try {
              await (window.electronAPI as any).cliCompat.saveConfig(cliConfigSite.url, newConfig);
              toast.success('CLI 配置已保存');
            } catch {
              toast.error('保存 CLI 配置失败');
            }
            setShowCliConfigDialog(false);
            setCliConfigSite(null);
          }}
        />
      )}

      {/* 应用配置弹出菜单 */}
      {applyConfigSite && (
        <ApplyConfigPopover
          isOpen={showApplyConfigPopover}
          anchorEl={applyConfigAnchorEl}
          cliConfig={getCliConfig(applyConfigSite.name)}
          cliCompatibility={getCompatibility(applyConfigSite.name)}
          siteUrl={applyConfigSite.url}
          siteName={applyConfigSite.name}
          apiKeys={apiKeys[applyConfigSite.name] || []}
          onClose={() => {
            setShowApplyConfigPopover(false);
            setApplyConfigAnchorEl(null);
            setApplyConfigSite(null);
          }}
        />
      )}

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
    </>
  );
}
