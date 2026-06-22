/**
 * 输入: DialogState (对话框状态), 主题配置, 列表配置
 * 输出: UiState (UI 状态), UI 操作方法
 * 定位: 状态管理层 - 管理 UI 交互、对话框和布局状态
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/store/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * UI 状态管理
 * 管理界面交互状态
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SiteConfig } from '../App';
import { DialogState, DialogType, initialDialogState } from '../components/ConfirmDialog';
import { COLUMN_WIDTHS_VERSION, DEFAULT_COLUMN_WIDTHS } from '../../shared/constants';
import type { HistoryMode } from '../components/Route/Usability/HistoryBucketBars';
import type { RouteCliType } from '../../shared/types/route-proxy';

import type { ReleaseInfo } from '../hooks/useUpdate';

interface RefreshMessage {
  site: string;
  message: string;
  type: 'success' | 'info';
}

// Tab 页面类型（一级页面由 page metadata registry 定义；旧 route 子页仍需兼容）
export type TabId = 'overview' | 'sites' | 'route' | 'logs' | 'credit' | 'settings';

export type VisibleTabId = TabId;
export type OverviewSubtab = 'site' | 'route';
export type SidebarDisplayMode = 'expanded' | 'icon-only';
export type SettingsSection = 'general' | 'detection' | 'sync' | 'update' | 'data';

// 路由相关的 TabId
export const ROUTE_TAB_IDS: TabId[] = ['route'];
export const isRouteTab = (id: TabId) => ROUTE_TAB_IDS.includes(id);

// 排序字段类型
export type SortField =
  | 'name'
  | 'balance'
  | 'todayUsage'
  | 'totalTokens'
  | 'promptTokens'
  | 'completionTokens'
  | 'requests'
  | 'rpm'
  | 'tpm'
  | 'modelCount'
  | 'lastUpdate'
  | 'ldcRatio';

// 排序方向
export type SortOrder = 'asc' | 'desc';

interface AuthErrorSite {
  name: string;
  url: string;
  error: string;
  accountId?: string;
}

interface NewApiTokenForm {
  name: string;
  group: string;
  unlimitedQuota: boolean;
  quota: string;
  expiredTime: string;
}

interface UIState {
  // 当前活跃的 Tab 页面
  activeTab: TabId;
  overviewSubtab: OverviewSubtab;

  // 面板状态
  showSiteEditor: boolean;
  editingSite: number | null;

  // 站点展开状态
  expandedSites: Set<string>;

  // 模型选择
  selectedModels: Set<string>;

  // Token 显示状态
  showTokens: Record<string, boolean>;

  // 分组筛选
  selectedGroup: Record<string, string | null>;
  activeSiteGroupFilter: string | null;

  // 模型搜索
  modelSearch: Record<string, string>;
  globalModelSearch: string;

  // 提示消息
  refreshMessage: RefreshMessage | null;

  // 签到状态
  checkingIn: string | null;

  // 拖拽状态
  draggedIndex: number | null;
  dragOverIndex: number | null;
  dragOverGroupId: string | null;
  draggedGroupIndex: number | null;
  dragOverGroupIndex: number | null;

  // 创建 API Key 弹窗
  creatingTokenSite: SiteConfig | null;
  creatingTokenCardKey: string | null;
  tokenDialogVersion: number;
  newTokenForm: NewApiTokenForm;
  creatingToken: boolean;
  deletingTokenKey: string | null;

  // 确认弹窗
  dialogState: DialogState;

  // 认证错误弹窗
  authErrorSites: AuthErrorSite[];
  showAuthErrorDialog: boolean;
  processingAuthErrorSite: string | null;

  // 列宽
  columnWidths: number[];
  /** 已应用列宽默认值的版本；小于 COLUMN_WIDTHS_VERSION 时会在加载时一次性重置 */
  columnWidthsVersion: number;

  // History 列：CLI 类型与模式（共享于列表头与所有行）
  historyCliType: RouteCliType;
  historyMode: HistoryMode;

  // 排序状态
  sortField: SortField | null;
  sortOrder: SortOrder;

  // 下载更新面板
  showDownloadPanel: boolean;
  downloadPanelRelease: ReleaseInfo | null;

  // 侧边栏显示模式
  sidebarDisplayMode: SidebarDisplayMode;

  // 设置页当前分类
  activeSettingsSection: SettingsSection;

  // Actions - 面板
  setShowSiteEditor: (show: boolean) => void;
  setEditingSite: (index: number | null) => void;
  openSiteEditor: (index?: number) => void;
  closeSiteEditor: () => void;

  // Actions - 展开
  toggleSiteExpanded: (name: string) => void;
  setExpandedSites: (sites: Set<string>) => void;

  // Actions - 模型
  toggleModelSelected: (model: string) => void;
  clearSelectedModels: () => void;

  // Actions - Token 显示
  toggleTokenVisibility: (siteName: string) => void;

  // Actions - 分组筛选
  setSelectedGroup: (siteName: string, groupName: string | null) => void;
  setActiveSiteGroupFilter: (groupId: string | null) => void;

  // Actions - 模型搜索
  setModelSearch: (siteName: string, search: string) => void;
  setGlobalModelSearch: (search: string) => void;
  clearAllModelSearch: () => void;

  // Actions - 提示消息
  setRefreshMessage: (message: RefreshMessage | null) => void;
  showRefreshSuccess: (site: string, message: string) => void;

  // Actions - 签到
  setCheckingIn: (siteName: string | null) => void;

  // Actions - 拖拽
  setDraggedIndex: (index: number | null) => void;
  setDragOverIndex: (index: number | null) => void;
  setDragOverGroupId: (groupId: string | null) => void;
  setDraggedGroupIndex: (index: number | null) => void;
  setDragOverGroupIndex: (index: number | null) => void;
  resetDragState: () => void;

  // Actions - 创建 API Key
  openCreateTokenDialog: (site: SiteConfig, cardKey?: string) => void;
  closeCreateTokenDialog: () => void;
  setNewTokenForm: (form: Partial<NewApiTokenForm>) => void;
  setCreatingToken: (creating: boolean) => void;
  setDeletingTokenKey: (key: string | null) => void;

  // Actions - 确认弹窗
  setDialogState: (state: DialogState) => void;
  showConfirmDialog: (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: { confirmText?: string; cancelText?: string; type?: DialogType }
  ) => void;
  closeDialog: () => void;

  // Actions - 认证错误
  addAuthErrorSite: (site: AuthErrorSite) => void;
  removeAuthErrorSite: (name: string, accountId?: string) => void;
  setAuthErrorSites: (sites: AuthErrorSite[]) => void;
  setShowAuthErrorDialog: (show: boolean) => void;
  setProcessingAuthErrorSite: (name: string | null) => void;
  clearAuthErrors: () => void;

  // Actions - 列宽
  setColumnWidth: (index: number, width: number) => void;
  resetColumnWidths: () => void;

  // Actions - History 列选择器
  setHistoryCliType: (cliType: RouteCliType) => void;
  setHistoryMode: (mode: HistoryMode) => void;

  // Actions - 排序
  setSortField: (field: SortField | null) => void;
  setSortOrder: (order: SortOrder) => void;
  toggleSort: (field: SortField) => void;
  resetSort: () => void;

  // Actions - Tab 切换
  setActiveTab: (tab: TabId) => void;
  setOverviewSubtab: (subtab: OverviewSubtab) => void;

  // Actions - 下载面板
  openDownloadPanel: (release: ReleaseInfo) => void;
  closeDownloadPanel: () => void;

  // Actions - 侧边栏
  setSidebarDisplayMode: (mode: SidebarDisplayMode) => void;
  toggleSidebarDisplayMode: () => void;

  // Actions - 设置页分类
  setActiveSettingsSection: (section: SettingsSection) => void;
}

const initialNewTokenForm: NewApiTokenForm = {
  name: '',
  group: 'default',
  unlimitedQuota: true,
  quota: '',
  expiredTime: '',
};

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // 初始状态
      activeTab: 'overview' as TabId,
      overviewSubtab: 'site',
      showSiteEditor: false,
      editingSite: null,
      expandedSites: new Set(),
      selectedModels: new Set(),
      showTokens: {},
      selectedGroup: {},
      activeSiteGroupFilter: 'default',
      modelSearch: {},
      globalModelSearch: '',
      refreshMessage: null,
      checkingIn: null,
      draggedIndex: null,
      dragOverIndex: null,
      dragOverGroupId: null,
      draggedGroupIndex: null,
      dragOverGroupIndex: null,
      creatingTokenSite: null,
      creatingTokenCardKey: null,
      tokenDialogVersion: 0,
      newTokenForm: initialNewTokenForm,
      creatingToken: false,
      deletingTokenKey: null,
      dialogState: initialDialogState,
      authErrorSites: [],
      showAuthErrorDialog: false,
      processingAuthErrorSite: null,
      columnWidths: [...DEFAULT_COLUMN_WIDTHS],
      columnWidthsVersion: COLUMN_WIDTHS_VERSION,
      historyCliType: 'claudeCode',
      historyMode: 'combined',
      sortField: null,
      sortOrder: 'desc',
      showDownloadPanel: false,
      downloadPanelRelease: null,
      sidebarDisplayMode: 'expanded',
      activeSettingsSection: 'general',

      // 面板 Actions
      setShowSiteEditor: show => set({ showSiteEditor: show }),
      setEditingSite: index => set({ editingSite: index }),

      openSiteEditor: (index?: number) => {
        set({
          showSiteEditor: true,
          editingSite: index ?? null,
        });
      },

      closeSiteEditor: () => {
        set({
          showSiteEditor: false,
          editingSite: null,
        });
      },

      // 展开 Actions
      toggleSiteExpanded: name => {
        const { expandedSites } = get();
        const newSet = new Set(expandedSites);
        if (newSet.has(name)) {
          newSet.delete(name);
        } else {
          newSet.add(name);
        }
        set({ expandedSites: newSet });
      },

      setExpandedSites: sites => set({ expandedSites: sites }),

      // 模型 Actions
      toggleModelSelected: model => {
        const { selectedModels } = get();
        const newSet = new Set(selectedModels);
        if (newSet.has(model)) {
          newSet.delete(model);
        } else {
          newSet.add(model);
        }
        set({ selectedModels: newSet });
      },

      clearSelectedModels: () => set({ selectedModels: new Set() }),

      // Token 显示 Actions
      toggleTokenVisibility: siteName => {
        const { showTokens } = get();
        set({ showTokens: { ...showTokens, [siteName]: !showTokens[siteName] } });
      },

      // 分组筛选 Actions
      setSelectedGroup: (siteName, groupName) => {
        const { selectedGroup } = get();
        set({
          selectedGroup: {
            ...selectedGroup,
            [siteName]: selectedGroup[siteName] === groupName ? null : groupName,
          },
        });
      },

      setActiveSiteGroupFilter: groupId => set({ activeSiteGroupFilter: groupId }),

      // 模型搜索 Actions
      setModelSearch: (siteName, search) => {
        const { modelSearch } = get();
        set({ modelSearch: { ...modelSearch, [siteName]: search } });
      },
      setGlobalModelSearch: search => set({ globalModelSearch: search }),
      clearAllModelSearch: () => set({ modelSearch: {} }),

      // 提示消息 Actions
      setRefreshMessage: message => set({ refreshMessage: message }),

      showRefreshSuccess: (site, message) => {
        set({ refreshMessage: { site, message, type: 'success' } });
        setTimeout(() => {
          const { refreshMessage } = get();
          if (refreshMessage?.site === site) {
            set({ refreshMessage: null });
          }
        }, 3000);
      },

      // 签到 Actions
      setCheckingIn: siteName => set({ checkingIn: siteName }),

      // 拖拽 Actions
      setDraggedIndex: index => set({ draggedIndex: index }),
      setDragOverIndex: index => set({ dragOverIndex: index }),
      setDragOverGroupId: groupId => set({ dragOverGroupId: groupId }),
      setDraggedGroupIndex: index => set({ draggedGroupIndex: index }),
      setDragOverGroupIndex: index => set({ dragOverGroupIndex: index }),

      resetDragState: () =>
        set({
          draggedIndex: null,
          dragOverIndex: null,
          dragOverGroupId: null,
          draggedGroupIndex: null,
          dragOverGroupIndex: null,
        }),

      // 创建 API Key Actions
      openCreateTokenDialog: (site, cardKey?) => {
        set({
          creatingTokenSite: site,
          creatingTokenCardKey: cardKey || site.name,
          tokenDialogVersion: get().tokenDialogVersion + 1,
          newTokenForm: initialNewTokenForm,
          creatingToken: false,
        });
      },

      closeCreateTokenDialog: () => {
        set({
          creatingTokenSite: null,
          creatingTokenCardKey: null,
          newTokenForm: initialNewTokenForm,
        });
      },

      setNewTokenForm: form => {
        const { newTokenForm } = get();
        set({ newTokenForm: { ...newTokenForm, ...form } });
      },

      setCreatingToken: creating => set({ creatingToken: creating }),
      setDeletingTokenKey: key => set({ deletingTokenKey: key }),

      // 确认弹窗 Actions
      setDialogState: state => set({ dialogState: state }),

      showConfirmDialog: (title, message, onConfirm, options = {}) => {
        set({
          dialogState: {
            isOpen: true,
            title,
            message,
            confirmText: options.confirmText || '确认',
            cancelText: options.cancelText || '取消',
            type: options.type || 'warning',
            onConfirm,
            onCancel: () => get().closeDialog(),
          },
        });
      },

      closeDialog: () => set({ dialogState: initialDialogState }),

      // 认证错误 Actions
      addAuthErrorSite: site => {
        const { authErrorSites } = get();
        if (!authErrorSites.some(s => s.name === site.name && s.accountId === site.accountId)) {
          set({ authErrorSites: [...authErrorSites, site] });
        }
      },

      removeAuthErrorSite: (name, accountId) => {
        const { authErrorSites } = get();
        set({
          authErrorSites: authErrorSites.filter(site => {
            if (site.name !== name) return true;
            if (!accountId) return false;
            return site.accountId !== accountId;
          }),
        });
      },

      setAuthErrorSites: sites => set({ authErrorSites: sites }),
      setShowAuthErrorDialog: show => set({ showAuthErrorDialog: show }),
      setProcessingAuthErrorSite: name => set({ processingAuthErrorSite: name }),

      clearAuthErrors: () =>
        set({
          authErrorSites: [],
          showAuthErrorDialog: false,
          processingAuthErrorSite: null,
        }),

      // 列宽 Actions
      setColumnWidth: (index, width) => {
        const { columnWidths } = get();
        const newWidths = [...columnWidths];
        newWidths[index] = Math.max(50, Math.min(320, width));
        set({ columnWidths: newWidths });
      },

      resetColumnWidths: () =>
        set({
          columnWidths: [...DEFAULT_COLUMN_WIDTHS],
          columnWidthsVersion: COLUMN_WIDTHS_VERSION,
        }),

      setHistoryCliType: cliType => set({ historyCliType: cliType }),
      setHistoryMode: historyMode => set({ historyMode }),

      // 排序 Actions
      setSortField: field => set({ sortField: field }),
      setSortOrder: order => set({ sortOrder: order }),

      toggleSort: field => {
        const { sortField, sortOrder } = get();
        if (sortField === field) {
          // 同一字段：切换排序方向，或第三次点击取消排序
          if (sortOrder === 'desc') {
            set({ sortOrder: 'asc' });
          } else {
            // 已经是升序，再点击取消排序
            set({ sortField: null, sortOrder: 'desc' });
          }
        } else {
          // 新字段：默认降序
          set({ sortField: field, sortOrder: 'desc' });
        }
      },

      resetSort: () => set({ sortField: null, sortOrder: 'desc' }),

      // Tab 切换
      setActiveTab: (tab: TabId) => set({ activeTab: tab }),
      setOverviewSubtab: (subtab: OverviewSubtab) => set({ overviewSubtab: subtab }),

      // 下载面板
      openDownloadPanel: (release: ReleaseInfo) =>
        set({ showDownloadPanel: true, downloadPanelRelease: release }),
      closeDownloadPanel: () => set({ showDownloadPanel: false, downloadPanelRelease: null }),

      // 侧边栏
      setSidebarDisplayMode: mode => set({ sidebarDisplayMode: mode }),
      toggleSidebarDisplayMode: () =>
        set(state => ({
          sidebarDisplayMode: state.sidebarDisplayMode === 'expanded' ? 'icon-only' : 'expanded',
        })),

      setActiveSettingsSection: activeSettingsSection => set({ activeSettingsSection }),
    }),
    {
      name: 'api-hub-ui-storage',
      version: 6,
      partialize: state => ({
        sidebarDisplayMode: state.sidebarDisplayMode,
        columnWidths: state.columnWidths,
        columnWidthsVersion: state.columnWidthsVersion,
        historyCliType: state.historyCliType,
        historyMode: state.historyMode,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<UIState>;
        const persistedVersion = persisted.columnWidthsVersion ?? 1;
        const currentVersion = COLUMN_WIDTHS_VERSION;
        const needsReset =
          !Array.isArray(persisted.columnWidths) ||
          persisted.columnWidths.length !== DEFAULT_COLUMN_WIDTHS.length ||
          persistedVersion < currentVersion;
        const columnWidths = needsReset
          ? [...DEFAULT_COLUMN_WIDTHS]
          : (persisted.columnWidths as number[]);

        // 一次性迁移：从旧 localStorage 顶层 key 取出 HistoryCell 的选择
        const VALID_CLI_TYPES: RouteCliType[] = ['claudeCode', 'codex', 'geminiCli'];
        const VALID_MODES: HistoryMode[] = ['combined', 'probe', 'route'];
        const legacyCli =
          typeof localStorage !== 'undefined'
            ? (localStorage.getItem('historyCell:selectedCli') as RouteCliType | null)
            : null;
        const legacyMode =
          typeof localStorage !== 'undefined'
            ? (localStorage.getItem('historyCell:selectedMode') as HistoryMode | null)
            : null;
        if (legacyCli && VALID_CLI_TYPES.includes(legacyCli)) {
          persisted.historyCliType = legacyCli;
        }
        if (legacyMode && VALID_MODES.includes(legacyMode)) {
          persisted.historyMode = legacyMode;
        }
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('historyCell:selectedCli');
            localStorage.removeItem('historyCell:selectedMode');
          }
        } catch {
          /* ignore */
        }

        return {
          ...currentState,
          ...persisted,
          columnWidths,
          columnWidthsVersion: currentVersion,
        };
      },
      migrate: (persistedState: any, _version: number) => {
        // 迁移旧的 activeTab 值：'cli' 和 'usability' → 'sites'
        if (persistedState && typeof persistedState === 'object') {
          const activeTab = persistedState.activeTab;
          if (activeTab === 'cli' || activeTab === 'usability') {
            persistedState.activeTab = 'sites';
          }
        }
        return persistedState as UIState;
      },
    }
  )
);
