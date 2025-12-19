import Logger from './utils/logger';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Server,
  Plus,
  Play,
  Trash2,
  Pencil,
  XCircle,
  Loader2,
  RefreshCw,
  Search,
  X,
  ChevronsUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { SiteEditor } from './components/SiteEditor';
import { SettingsPanel } from './components/SettingsPanel';
import { ConfirmDialog, DialogState, initialDialogState } from './components/ConfirmDialog';
import { Header } from './components/Header';
import { SiteCard } from './components/SiteCard';
import { AuthErrorDialog, SiteGroupDialog, BackupSelectDialog } from './components/dialogs';
import { CreateApiKeyDialog } from './components/CreateApiKeyDialog';
import { ToastContainer } from './components/Toast';
import {
  useTheme,
  useSiteGroups,
  useCheckIn,
  useTokenManagement,
  useDataLoader,
  useSiteDrag,
  useSiteDetection,
  useUpdate,
  useAutoRefresh,
} from './hooks';
import type { NewApiTokenForm } from './hooks';
import { getGroupTextColor } from './utils/groupStyle';
// 从共享的types文件导入并重新导出类型
import type { SiteConfig, DetectionResult } from '../shared/types/site';
export type { SiteConfig, DetectionResult } from '../shared/types/site';

// 导入 Zustand Store
import { useConfigStore } from './store/configStore';
import { useDetectionStore } from './store/detectionStore';
import { useUIStore, SortField } from './store/uiStore';
import { useToastStore, toast } from './store/toastStore';

declare global {
  interface Window {
    electronAPI: {
      loadConfig: () => Promise<Config>;
      saveConfig: (config: Config) => Promise<void>;
      launchChromeForLogin: (url: string) => Promise<{ success: boolean; message: string }>;
      closeBrowser: () => Promise<void>;
      getCookies: (url: string) => Promise<any[]>;
      fetchWithCookies: (
        url: string,
        options: any
      ) => Promise<{ ok: boolean; status: number; statusText: string; data: any }>;
      detectSite: (
        site: SiteConfig,
        timeout: number,
        quickRefresh?: boolean,
        cachedData?: DetectionResult,
        forceAcceptEmpty?: boolean
      ) => Promise<DetectionResult>;
      detectAllSites: (
        config: Config,
        quickRefresh?: boolean,
        cachedResults?: DetectionResult[]
      ) => Promise<DetectionResult[]>;
      openUrl: (url: string) => Promise<void>;
      getAllAccounts: () => Promise<any[]>;
      token?: any;
      storage?: any;
      theme?: {
        save: (themeMode: 'light' | 'dark' | 'system') => Promise<{ success: boolean }>;
        load: () => Promise<{ success: boolean; data?: 'light' | 'dark' | 'system' }>;
      };
      webdav?: {
        testConnection: (config: any) => Promise<{ success: boolean; error?: string }>;
        saveConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
        getConfig: () => Promise<{ success: boolean; data?: any; error?: string }>;
        listBackups: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        uploadBackup: () => Promise<{ success: boolean; data?: string; error?: string }>;
        restoreBackup: (filename: string) => Promise<{ success: boolean; error?: string }>;
        deleteBackup: (filename: string) => Promise<{ success: boolean; error?: string }>;
      };
      backup?: {
        list: () => Promise<any[]>;
      };
      update?: {
        check: () => Promise<{
          hasUpdate: boolean;
          hasPreReleaseUpdate: boolean;
          currentVersion: string;
          latestVersion: string;
          latestPreReleaseVersion?: string;
          releaseInfo?: {
            version: string;
            releaseDate: string;
            releaseNotes: string;
            downloadUrl: string;
            htmlUrl: string;
            isPreRelease: boolean;
          };
          preReleaseInfo?: {
            version: string;
            releaseDate: string;
            releaseNotes: string;
            downloadUrl: string;
            htmlUrl: string;
            isPreRelease: boolean;
          };
        }>;
        getCurrentVersion: () => Promise<string>;
        openDownload: (url: string) => Promise<void>;
        getSettings: () => Promise<{
          autoCheckEnabled: boolean;
          includePreRelease: boolean;
          lastCheckTime?: string;
        }>;
        saveSettings: (settings: {
          autoCheckEnabled: boolean;
          includePreRelease: boolean;
          lastCheckTime?: string;
        }) => Promise<void>;
      };
    };
  }
}

export interface Settings {
  timeout: number;
  concurrent: boolean;
  max_concurrent?: number;
  show_disabled: boolean;
  // 新增：浏览器可执行文件路径（可选），用于自定义 Chromium / Edge / 便携版浏览器
  browser_path?: string;
  // WebDAV 云端备份配置
  webdav?: {
    enabled: boolean;
    serverUrl: string;
    username: string;
    password: string;
    remotePath: string;
    maxBackups: number;
  };
  // 站点列表排序设置
  sort?: {
    field: string | null;
    order: 'asc' | 'desc';
  };
}

// 新增：站点分组配置
export interface SiteGroup {
  id: string; // 分组唯一ID，例如 "default" 或 "group_xxx"
  name: string; // 分组显示名称，例如 "默认分组"、"国内站点"
}

export interface Config {
  sites: SiteConfig[];
  settings: Settings;
  // 新增：站点分组列表，可选（兼容旧版本配置）
  siteGroups?: SiteGroup[];
}

// DetectionResult 已从 shared/types/site 导入

// NewApiTokenForm 类型已从 hooks 导入

// 备份信息类型
interface BackupInfo {
  filename: string;
  path: string;
  timestamp: Date;
  size: number;
}

function App() {
  // 初始化主题系统
  useTheme();

  // 软件更新检查
  const { updateInfo, settings: updateSettings, checkForUpdatesInBackground } = useUpdate();

  // Toast store
  const { toasts, removeToast } = useToastStore();

  // 备份选择对话框状态
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [backupList, setBackupList] = useState<BackupInfo[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);

  // ========== 从 Store 读取状态 ==========
  // configStore
  const {
    config,
    setConfig,
    loading,
    setLoading,
    saving,
    setSaving,
    addSite: storeAddSite,
    updateSite: storeUpdateSite,
    deleteSite: storeDeleteSite,
  } = useConfigStore();
  // detectionStore - 获取展示用的数据和 setter（检测状态由 useSiteDetection hook 管理）
  const { apiKeys, userGroups, modelPricing, setApiKeys, setUserGroups, setModelPricing } =
    useDetectionStore();
  // uiStore
  const {
    showSiteEditor,
    setShowSiteEditor,
    showSettings,
    setShowSettings,
    editingSite,
    setEditingSite,
    expandedSites,
    setExpandedSites,
    toggleSiteExpanded,
    selectedModels,
    toggleModelSelected,
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
    setRefreshMessage,
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
    dialogState,
    setDialogState,
    authErrorSites,
    setAuthErrorSites,
    showAuthErrorDialog,
    setShowAuthErrorDialog,
    processingAuthErrorSite,
    setProcessingAuthErrorSite,
    columnWidths,
    setColumnWidth,
    sortField,
    sortOrder,
    toggleSort,
    setSortField,
    setSortOrder,
  } = useUIStore();

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

  // 保持 ref 与 state 同步，并在变更时写入 localStorage
  useEffect(() => {
    columnWidthsRef.current = columnWidths;
    try {
      window.localStorage.setItem('siteListColumnWidths', JSON.stringify(columnWidths));
    } catch {
      // 某些环境可能禁用存储，忽略错误即可
    }
  }, [columnWidths]);

  // 排序设置变化时保存到 config
  const sortSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (!configRef.current) return;
    // 防抖保存，避免频繁写入
    if (sortSaveTimeoutRef.current) {
      clearTimeout(sortSaveTimeoutRef.current);
    }
    sortSaveTimeoutRef.current = setTimeout(async () => {
      const currentConfig = configRef.current;
      if (!currentConfig) return;
      const currentSort = currentConfig.settings?.sort;
      const newSort = { field: sortField, order: sortOrder };
      // 只有当排序设置真正变化时才保存
      if (currentSort?.field !== newSort.field || currentSort?.order !== newSort.order) {
        const newSettings = { ...currentConfig.settings, sort: newSort };
        try {
          await window.electronAPI.saveConfig({ ...currentConfig, settings: newSettings });
          // 更新本地 config 状态（不触发重新渲染循环）
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

  // 列宽调整：在表头右侧拖动分隔线即可调整宽度
  const handleColumnResizeMouseDown = (event: React.MouseEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = columnWidthsRef.current[index];

    // 最小/最大列宽，防止列被拖没或过宽
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

  // toggleTokenVisibility 已从 uiStore 导入

  // 切换分组选择
  const toggleGroupFilter = (siteName: string, groupName: string | null) => {
    const current = selectedGroup[siteName];
    setSelectedGroup(siteName, current === groupName ? null : groupName);
  };

  // openCreateTokenDialog 和 closeCreateTokenDialog 已从 uiStore 导入
  // 但需要包装一下以添加验证逻辑
  const handleOpenCreateTokenDialog = (site: SiteConfig) => {
    if (!site.system_token || !site.user_id) {
      toast.warning('当前站点未配置系统 Token 或用户 ID，请先在"编辑站点"中填写。');
      return;
    }
    openCreateTokenDialog(site);
  };

  // 复制到剪贴板
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} 已复制到剪贴板`);
    } catch (error) {
      Logger.error('复制失败:', error);
      toast.error('复制失败: ' + error);
    }
  };

  // saveConfig 需要在 useSiteDrag 之前定义
  const saveConfig = async (newConfig: Config) => {
    try {
      setSaving(true);
      await window.electronAPI.saveConfig(newConfig);
      setConfig(newConfig);
      Logger.info('✅ [App] 配置已保存');
    } catch (error) {
      Logger.error('❌ [App] 保存配置失败:', error);
      toast.error('保存配置失败: ' + error);
    } finally {
      setSaving(false);
    }
  };

  // 站点拖拽 hook
  const {
    draggedIndex: _draggedIndex, // 在 hook 内部使用，此处仅解构以保持 API 完整性
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

  useEffect(() => {
    // 先加载配置，再加载缓存数据
    const init = async () => {
      const cfg = await loadConfig();
      if (cfg) {
        await loadCachedData(cfg);
      }
    };
    init();
  }, []);

  // 启动时自动检查更新（后台静默检查，不阻塞用户交互）
  useEffect(() => {
    // 仅在自动检查启用时执行
    if (updateSettings.autoCheckEnabled) {
      // 延迟执行，确保应用完全加载后再检查
      const timer = setTimeout(() => {
        checkForUpdatesInBackground();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [updateSettings.autoCheckEnabled, checkForUpdatesInBackground]);

  // 当expandedSites改变时，确保UI能正确显示
  useEffect(() => {
    Logger.info('📊 [App] State更新:');
    Logger.info('   - apiKeys:', Object.keys(apiKeys).length, '个站点的数据');
    Logger.info('   - expandedSites:', Array.from(expandedSites));
    expandedSites.forEach(siteName => {
      if (apiKeys[siteName]) {
        Logger.info(`   - ${siteName} 的apiKeys:`, apiKeys[siteName].length, '个');
      }
    });
  }, [apiKeys, expandedSites]);

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

  // 站点检测 hook
  const { detecting, detectingSite, results, setResults, detectSingle, detectAllSites } =
    useSiteDetection({
      onAuthError: sites => {
        setAuthErrorSites(sites);
        setShowAuthErrorDialog(true);
      },
      showDialog,
    });

  // 自动刷新 hook - 管理站点自动刷新定时器
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

  // 数据加载 hook（需要在 setResults 可用后初始化）
  const { loadCachedData } = useDataLoader({
    setResults,
    setApiKeys,
    setUserGroups,
    setModelPricing,
  });

  const loadConfig = async (): Promise<Config | null> => {
    try {
      setLoading(true);
      const cfg = await window.electronAPI.loadConfig();
      setConfig(cfg);
      // 从配置中恢复排序设置
      if (cfg?.settings?.sort) {
        const { field, order } = cfg.settings.sort;
        if (field) {
          setSortField(field as SortField);
        }
        if (order) {
          setSortOrder(order);
        }
      }
      return cfg;
    } catch (error) {
      Logger.error('加载配置失败:', error);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // 规范化站点分组配置（确保始终存在一个"默认分组"）- 提前计算供 hook 使用
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

  // 站点操作：使用 Store 方法，添加额外逻辑
  const addSite = async (site: SiteConfig) => {
    await storeAddSite(site);
    Logger.info('✅ [App] 站点已添加到配置，开始刷新数据...');

    // 延迟刷新，确保config已更新并对话框已关闭
    setTimeout(async () => {
      try {
        await detectSingle(site, false);
        Logger.info('✅ [App] 新站点数据刷新完成');
      } catch (error: any) {
        Logger.error('⚠️ [App] 新站点数据刷新失败:', error.message);
      } finally {
        try {
          await window.electronAPI.closeBrowser?.();
          Logger.info('✅ [App] 已尝试自动关闭浏览器');
        } catch (err) {
          Logger.warn('⚠️ [App] 自动关闭浏览器失败:', err);
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

  // 包装 detectAllSites 以传入 config
  const handleDetectAllSites = async () => {
    if (!config) return;
    await detectAllSites(config);
  };

  // 签到逻辑 hook
  const { handleCheckIn, openCheckinPage } = useCheckIn({
    showDialog,
    showAlert,
    setCheckingIn,
    detectSingle: async (site, quickRefresh) => {
      await detectSingle(site, quickRefresh);
    },
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

  // 包装 handleDeleteToken 以适配 SiteCard 的调用签名
  const handleDeleteToken = (site: SiteConfig, token: any, tokenIndex: number) => {
    deleteToken(site, token, tokenIndex, setDeletingTokenKey);
  };

  // 包装 handleCreateTokenSubmit 以适配 CreateApiKeyDialog 的调用签名
  const handleCreateTokenSubmit = () => {
    if (!creatingTokenSite) return;
    createToken(creatingTokenSite, newTokenForm, setCreatingToken, closeCreateTokenDialog);
  };

  /**
   * 打开加油站链接
   */
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

    // 使用逗号分隔所有选中的模型
    const modelsText = Array.from(selectedModels).join(',');
    try {
      await navigator.clipboard.writeText(modelsText);
      toast.success(`已复制 ${selectedModels.size} 个模型到剪贴板`);
    } catch (error) {
      Logger.error('复制失败:', error);
      toast.error('复制失败: ' + error);
    }
  };

  // 防抖展开站点的 ref
  const expandDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // 全局模型搜索：展开所有站点并清空单站搜索框
  const handleGlobalModelSearchChange = useCallback(
    (value: string) => {
      if (Object.values(modelSearch).some(text => text && text.trim() !== '')) {
        clearAllModelSearch();
      }

      setGlobalModelSearch(value);

      // 清除之前的防抖
      if (expandDebounceRef.current) {
        clearTimeout(expandDebounceRef.current);
      }

      if (!value) {
        // 清空搜索时立即收起所有站点
        setExpandedSites(new Set());
      } else if (config?.sites?.length) {
        // 有搜索内容时，防抖展开所有站点（100ms，仅用于避免输入时频繁触发）
        expandDebounceRef.current = setTimeout(() => {
          // 为所有站点加载缓存数据
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

  // 分组标签拖拽排序处理函数
  const handleGroupDragStart = (e: React.DragEvent, index: number) => {
    // 阻止事件冒泡，避免与站点拖拽冲突
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

    // 获取当前分组列表
    const currentGroups =
      Array.isArray(config.siteGroups) && config.siteGroups.length > 0
        ? [...config.siteGroups]
        : [{ id: 'default', name: '默认分组' }];

    // 重新排序分组
    const [draggedGroup] = currentGroups.splice(draggedGroupIndex, 1);
    currentGroups.splice(dropIndex, 0, draggedGroup);

    await saveConfig({ ...config, siteGroups: currentGroups });
    setDragOverGroupIndex(null);
  };

  // 当展开站点时从缓存中加载数据（所有数据在检测时已获取）
  const handleExpandSite = (siteName: string) => {
    const isExpanding = !expandedSites.has(siteName);
    toggleSiteExpanded(siteName);

    if (isExpanding) {
      // 展开时从 DetectionResult 缓存中加载数据
      const siteResult = results.find(r => r.name === siteName);
      if (siteResult) {
        // 从缓存加载数据到 state（即使为空也要设置，避免使用旧数据）
        setApiKeys(siteName, siteResult.apiKeys || []);
        setUserGroups(siteName, siteResult.userGroups || {});
        setModelPricing(siteName, siteResult.modelPricing || { data: {} });
      }
    }
  };

  // 展开/收起全部站点
  const handleToggleAllExpanded = () => {
    if (!config) return;
    const allSiteNames = config.sites.map(s => s.name);
    const allExpanded = allSiteNames.every(name => expandedSites.has(name));

    if (allExpanded) {
      // 收起全部
      setExpandedSites(new Set());
    } else {
      // 展开全部 - 同时为所有站点加载缓存数据
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
    if (!globalModelSearch) return true; // 无搜索时显示所有
    const searchTerm = globalModelSearch.toLowerCase();

    // 获取模型列表
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

      // 计算 Token 相关值
      const todayPromptTokens = siteResult?.todayPromptTokens ?? 0;
      const todayCompletionTokens = siteResult?.todayCompletionTokens ?? 0;
      const todayTotalTokens =
        siteResult?.todayTotalTokens ?? todayPromptTokens + todayCompletionTokens;
      const todayRequests = siteResult?.todayRequests ?? 0;

      // 计算 RPM / TPM
      const now = new Date();
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const minutesSinceStart = Math.max((now.getTime() - dayStart.getTime()) / 60000, 1);
      const rpm = todayRequests > 0 ? todayRequests / minutesSinceStart : 0;
      const tpm = todayTotalTokens > 0 ? todayTotalTokens / minutesSinceStart : 0;

      // 计算模型数量
      const apiModelCount = siteResult?.models?.length || 0;
      const pricing = modelPricing[site.name];
      const pricingModelCount = pricing?.data ? Object.keys(pricing.data).length : 0;
      const modelCount = Math.max(apiModelCount, pricingModelCount);

      // 获取最后更新时间
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
        default:
          return 0;
      }
    },
    [sortField, modelPricing]
  );

  // 排序后的站点列表（带原始索引）
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-light-bg dark:bg-dark-bg relative">
        {/* 装饰背景 */}
        <div className="light-bg-decoration dark:dark-bg-decoration"></div>
        <div className="text-center relative z-10">
          <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary-500" />
          <p className="text-light-text-secondary dark:text-dark-text-secondary">加载配置中...</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-screen bg-light-bg dark:bg-dark-bg relative">
        {/* 装饰背景 */}
        <div className="light-bg-decoration dark:dark-bg-decoration"></div>
        <div className="text-center relative z-10">
          <XCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
          <p className="text-light-text dark:text-dark-text mb-4">配置加载失败</p>
          <button
            onClick={loadConfig}
            className="px-6 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-all shadow-lg hover:shadow-xl"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text relative overflow-x-auto overflow-y-hidden">
      {/* 装饰背景 */}
      <div className="light-bg-decoration dark:dark-bg-decoration"></div>

      {/* 主要内容 */}
      <div className="relative z-10 h-full flex flex-col">
        <Header
          saving={saving}
          hasUpdate={updateInfo?.hasUpdate}
          onOpenSettings={() => setShowSettings(true)}
        />

        <div className="flex-1 overflow-y-hidden overflow-x-visible flex">
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-3 bg-white/60 dark:bg-dark-card/60 backdrop-blur-sm border-b border-light-border dark:border-dark-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditingSite(null);
                    setShowSiteEditor(true);
                  }}
                  className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-all flex items-center gap-2 text-sm font-medium shadow-md hover:shadow-lg"
                >
                  <Plus className="w-4 h-4" strokeWidth={2.5} />
                  添加站点
                </button>
                {/* 从备份恢复站点按钮 */}
                <button
                  onClick={async () => {
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
                  }}
                  className="px-3 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg transition-all flex items-center gap-1.5 text-sm font-medium shadow-md hover:shadow-lg"
                  title="从备份文件恢复站点配置"
                >
                  <RefreshCw className="w-4 h-4" strokeWidth={2.5} />
                  恢复站点
                </button>
              </div>
              <div className="flex items-center gap-3">
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
                <button
                  onClick={handleDetectAllSites}
                  disabled={detecting || !config || config.sites.length === 0}
                  className="px-5 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-all flex items-center gap-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
                >
                  {detecting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.5} />
                      检测中...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" strokeWidth={2.5} />
                      检测所有站点
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 站点分组控制栏：固定在滚动容器外面，始终可见 */}
            {config.sites.length > 0 && (
              <div className="min-w-[1180px] px-4 pt-2 pb-1 flex items-center justify-between text-[13px] text-slate-500 dark:text-slate-400 bg-light-bg dark:bg-dark-bg border-b border-slate-200/50 dark:border-slate-700/50 flex-shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">站点分组</span>
                  {/* 显示全部按钮 */}
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
                          // 区分：如果正在拖拽分组，则处理分组排序；否则处理站点移动到分组
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
                          // 区分：如果正在拖拽分组，则处理分组排序；否则处理站点移动到分组
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
                        {/* 站点数量 - 始终显示 */}
                        <span
                          className={`text-xs ${isActive ? 'text-white/80' : 'text-slate-400 dark:text-slate-500'}`}
                        >
                          {groupSitesCount} 个
                        </span>
                        {/* 编辑按钮 - 悬停时显示 */}
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
                        {/* 删除按钮 - 悬停时显示，且不是默认分组 */}
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
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    小提示：分组标签、站点卡片可拖动调整顺序
                  </span>
                  <button
                    onClick={openCreateGroupDialog}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-dashed border-slate-300 dark:border-slate-600 text-[13px] text-slate-600 dark:text-slate-200 hover:border-primary-400 hover:text-primary-500"
                  >
                    <Plus className="w-3 h-3" />
                    新建分组
                  </button>
                </div>
              </div>
            )}

            {/* 站点列表区域：纵向滚动交给内部容器，横向滚动交给整体窗口（根容器 overflow-x-auto） */}
            <div className="flex-1 overflow-y-auto overflow-x-visible px-4 pb-4 space-y-3">
              {config.sites.length === 0 ? (
                <div className="text-center py-16 text-light-text-secondary dark:text-dark-text-secondary">
                  <Server className="w-16 h-16 mx-auto mb-4 opacity-30" strokeWidth={1.5} />
                  <p className="text-lg font-medium mb-2">还没有添加任何站点</p>
                  <p className="text-sm mb-4">点击"添加站点"按钮开始</p>
                  {/* 恢复站点按钮 */}
                  <button
                    onClick={async () => {
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
                    }}
                    className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg transition-all text-sm font-medium shadow-md hover:shadow-lg"
                  >
                    🔄 从备份恢复站点
                  </button>
                  <p className="text-xs mt-2 text-slate-400">从备份目录选择配置文件进行恢复</p>
                </div>
              ) : (
                // 为了在窗口变窄时出现横向滚动条，内部内容设置一个最小宽度（由根容器负责横向滚动）
                <>
                  {/* 列表表头（固定在滚动容器顶部）：站点名称 / 状态 / 余额 / 今日消费 / 总Token / 输入 / 输出 / 请求 / RPM / TPM / 模型数 / 更新时间 / 操作 */}
                  <div className="min-w-[1180px] sticky top-0 z-20 px-4 py-2 bg-gradient-to-r from-emerald-50/60 to-amber-50/60 dark:from-emerald-900/20 dark:to-amber-900/20 backdrop-blur-sm border-b border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-100">
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
                        ] as { label: string; field: SortField }[]
                      ).map(({ label, field }, idx) => {
                        const centerHeader = idx >= 3 && idx <= 10; // 总 Token / 输入 / 输出 / 请求 / RPM / TPM / 模型数 / 更新时间
                        const isActive = sortField === field;
                        return (
                          <div
                            key={label}
                            className={`relative flex items-center pr-1 ${
                              centerHeader ? 'justify-center text-center' : 'justify-start'
                            }`}
                          >
                            <button
                              onClick={() => toggleSort(field)}
                              className={`flex items-center gap-0.5 hover:text-primary-500 transition-colors ${
                                isActive ? 'text-primary-500' : ''
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
                            {/* 列宽调整拖拽条：占据单元格右侧 4px 区域 */}
                            <div
                              onMouseDown={e => handleColumnResizeMouseDown(e, idx)}
                              className="absolute top-0 right-0 h-full w-1 cursor-col-resize group"
                            >
                              <div className="w-[3px] h-full mx-auto opacity-0 group-hover:opacity-60 bg-slate-300 dark:bg-slate-500 transition-opacity" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleToggleAllExpanded}
                        className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-all mr-[46px]"
                        title={
                          config.sites.every(s => expandedSites.has(s.name))
                            ? '收起全部'
                            : '展开全部'
                        }
                      >
                        <ChevronsUpDown className="w-4 h-4" />
                      </button>
                      <span className="w-[72px] text-right pr-1">站点操作</span>
                    </div>
                  </div>

                  <div className="min-w-[1180px] space-y-3">
                    {sortedSites.map(({ site, index, siteResult: cachedResult }) => {
                      // 使用排序时已缓存的结果，或重新查找
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

                      // 按分组筛选决定是否渲染该站点
                      const groupId = site.group || defaultGroupId;
                      if (activeSiteGroupFilter !== null && groupId !== activeSiteGroupFilter) {
                        return null;
                      }

                      // 全局模型搜索时，隐藏没有匹配模型的站点
                      if (!siteHasMatchingModels(site, siteResult)) {
                        return null;
                      }

                      const isExpanded = expandedSites.has(site.name);
                      // 账号信息也优先按名称匹配，失败时按URL回退
                      // 新架构下不再需要 siteAccounts，直接从 config 获取
                      const siteAccount = null; // 兼容旧代码

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
                          onOpenCreateTokenDialog={handleOpenCreateTokenDialog}
                          onDeleteToken={handleDeleteToken}
                          onToggleAutoRefresh={() => {
                            const newSites = [...config.sites];
                            // 获取当前间隔值或使用默认值5分钟
                            const interval = site.auto_refresh_interval || 5;
                            if (site.auto_refresh) {
                              // 关闭自动刷新，但保留间隔值
                              newSites[index] = {
                                ...site,
                                auto_refresh: false,
                                auto_refresh_interval: interval,
                              };
                            } else {
                              // 开启自动刷新：使用已保存的间隔或默认值5分钟
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
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {/* 关闭 relative z-10 h-full flex flex-col 的 div */}
      </div>

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

            // 如果正在处理认证错误站点，从列表中移除并检查是否还有剩余
            if (processingAuthErrorSite) {
              const remaining = authErrorSites.filter(s => s.name !== processingAuthErrorSite);
              setAuthErrorSites(remaining);
              setProcessingAuthErrorSite(null);

              // 如果还有剩余站点，重新显示弹窗
              if (remaining.length > 0) {
                setTimeout(() => {
                  setShowAuthErrorDialog(true);
                }, 300); // 延迟显示，让 SiteEditor 关闭动画完成
              }
            }

            // 保存后刷新站点数据（编辑模式下刷新当前站点）
            if (isEditing) {
              // 延迟刷新，等待配置保存完成
              setTimeout(async () => {
                try {
                  await detectSingle(site, false); // 完整刷新（非快速模式）
                  Logger.info('✅ [App] 站点数据刷新完成:', site.name);
                } catch (error: any) {
                  Logger.error('⚠️ [App] 站点数据刷新失败:', error.message);
                } finally {
                  // 刷新完成后尝试关闭浏览器（会检查引用计数，不会误关其他检测）
                  try {
                    await window.electronAPI.closeBrowser?.();
                    Logger.info('✅ [App] 已尝试关闭浏览器');
                  } catch (err) {
                    Logger.warn('⚠️ [App] 关闭浏览器失败:', err);
                  }
                }
              }, 500);
            }
          }}
          onCancel={() => {
            setShowSiteEditor(false);

            // 如果取消编辑但还有认证错误站点，重新显示弹窗
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

      {showSettings && (
        <SettingsPanel
          settings={config.settings}
          config={config}
          onSave={async settings => {
            await saveConfig({ ...config, settings });
            setShowSettings(false);
          }}
          onCancel={() => setShowSettings(false)}
          onImport={async newConfig => {
            await saveConfig(newConfig);
            setShowSettings(false);
          }}
          initialUpdateInfo={updateInfo}
        />
      )}

      {/* 认证错误弹窗 */}
      {showAuthErrorDialog && authErrorSites.length > 0 && (
        <AuthErrorDialog
          sites={authErrorSites}
          configSites={config.sites}
          onClose={() => setShowAuthErrorDialog(false)}
          onEditSite={(siteIndex, siteName) => {
            setProcessingAuthErrorSite(siteName);
            setEditingSite(siteIndex);
            setShowSiteEditor(true);
            setShowAuthErrorDialog(false);
          }}
          onProcessAll={() => {
            const firstSite = authErrorSites[0];
            const siteIndex = config.sites.findIndex(s => s.name === firstSite.name);
            if (siteIndex !== -1) {
              setProcessingAuthErrorSite(firstSite.name);
              setEditingSite(siteIndex);
              setShowSiteEditor(true);
            }
            setShowAuthErrorDialog(false);
          }}
          onForceRefresh={async (siteIndex, siteName) => {
            const site = config.sites[siteIndex];
            if (!site) return;

            // 从列表中移除当前站点
            const remaining = authErrorSites.filter(s => s.name !== siteName);
            setAuthErrorSites(remaining);

            // 如果没有剩余站点，关闭弹窗
            if (remaining.length === 0) {
              setShowAuthErrorDialog(false);
            }

            // 强制获取数据（接受空数据）
            try {
              const existingResult = results.find(r => r.name === siteName);
              const timeout = config.settings?.timeout ?? 30;
              const result = await window.electronAPI.detectSite(
                site,
                timeout,
                false,
                undefined,
                true
              );

              // 更新结果（无论是否为空）
              const filtered = results.filter(r => r.name !== site.name);
              setResults([...filtered, result]);

              // 使用与其他刷新操作完全一致的提示方式
              const hasChanges =
                !existingResult ||
                existingResult.status !== result.status ||
                existingResult.balance !== result.balance ||
                existingResult.todayUsage !== result.todayUsage ||
                existingResult.models.length !== result.models.length ||
                JSON.stringify(existingResult.apiKeys) !== JSON.stringify(result.apiKeys);

              setRefreshMessage({
                site: siteName,
                message: hasChanges ? '✅ 数据已更新' : 'ℹ️ 数据无变化',
                type: hasChanges ? 'success' : 'info',
              });
              setTimeout(() => setRefreshMessage(null), 3000);
            } catch (error: any) {
              setRefreshMessage({
                site: siteName,
                message: `❌ 刷新失败: ${error.message}`,
                type: 'info',
              });
              setTimeout(() => setRefreshMessage(null), 5000);
            }
          }}
          onOpenSite={async url => {
            try {
              await window.electronAPI.openUrl(url);
            } catch (error: any) {
              toast.error(`打开站点失败: ${error.message}`);
            }
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
              results.find(r => r.name === creatingTokenSite.name)?.name || creatingTokenSite.name
            ] || {}
          }
          creating={creatingToken}
          onFormChange={partial => setNewTokenForm(prev => ({ ...prev, ...partial }))}
          onSubmit={handleCreateTokenSubmit}
          onClose={closeCreateTokenDialog}
        />
      )}

      {/* 自定义确认弹窗 */}
      <ConfirmDialog
        isOpen={dialogState.isOpen}
        type={dialogState.type}
        title={dialogState.title}
        message={dialogState.message}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        onConfirm={dialogState.onConfirm || (() => setDialogState(initialDialogState))}
        onCancel={dialogState.onCancel}
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
              const cfg = await loadConfig();
              if (cfg) {
                await loadCachedData(cfg);
              }
            } else {
              showAlert('恢复失败：' + (result?.error || '未知错误'), 'error');
            }
          } catch (error: any) {
            showAlert('恢复失败：' + error.message, 'error');
          }
        }}
        onClose={() => setShowBackupDialog(false)}
      />

      {/* Toast 通知 */}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}

export default App;
