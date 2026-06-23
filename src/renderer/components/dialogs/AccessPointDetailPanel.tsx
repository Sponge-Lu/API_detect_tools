/**
 * 接入点详情侧滑面板
 * 输入: AccessPoint (托管站点 | 直连配置), 账户数据, API Keys, 模型, CLI 配置
 * 输出: 三 tab 侧滑面板 UI（合并站点信息 / 模型 & 资源 / CLI 配置 & 测试）
 * 定位: 展示层 - 接入管理页行详情面板
 * 说明: 面板固定 720px，Tab 内容区独立滚动；托管/直连 Tab1 使用单一信息面承载身份与凭证。
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Info,
  Box,
  Settings as SettingsIcon,
  Link,
  Key,
  Copy,
  Eye,
  EyeOff,
  Save,
  Trash2,
  Plus,
} from 'lucide-react';
import { OverlayDrawer } from '../overlays/OverlayDrawer';
import { AppButton } from '../AppButton/AppButton';
import { SiteCardDetails } from '../SiteCard/SiteCardDetails';
import { AnyRouterConfigSection } from '../AnyRouterConfigSection';
import { ManagedCliConfigEditorContent } from './ManagedCliConfigEditorContent';
import { DirectCliConfigEditorContent } from './DirectCliConfigEditorContent';
import {
  DEFAULT_SITE_TYPE,
  SITE_TYPE_LABELS,
  SITE_TYPES,
  isAnyRouterSite,
  type SiteConfig,
  type SiteGroup,
  type SiteType,
} from '../../../shared/types/site';
import type { CustomCliConfig } from '../../../shared/types/custom-cli-config';
import type { DetectionResult } from '../../App';
import type { CliConfig } from '../../../shared/types/cli-config';
import type { CliCompatibilityResult } from '../../store/detectionStore';
import type {
  CodexTestDetail,
  GeminiTestDetail,
  ModelPricingData,
} from '../../../shared/types/site';

// 账号信息接口（从 SitesPage 提取）
export interface AccountInfo {
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
  anyRouterConfig?: {
    userHash?: string;
  };
}

// 选中项类型（托管站点或直连配置）
export type SelectedItem =
  | { type: 'managed'; site: SiteConfig; account: AccountInfo | null }
  | { type: 'custom-cli'; config: CustomCliConfig };

export type AccessPointType = 'managed' | 'direct';

export interface AccessPointDetailPanelProps {
  open: boolean;
  onClose: () => void;
  data: SelectedItem | null;
  // 托管站点相关数据
  siteResult?: DetectionResult;
  allAccounts?: AccountInfo[]; // 该站点的所有账号
  apiKeys?: any[];
  userGroups?: Record<string, { desc: string; ratio: number }>;
  modelPricing?: ModelPricingData | null;
  groups?: SiteGroup[];
  // CLI 配置与测试
  cliConfig?: CliConfig | null;
  isCliTesting?: boolean;
  // 托管 CLI 兼容性结果（驱动编辑器显示）
  cliCompatibility?: CliCompatibilityResult | null;
  cliCodexDetail?: CodexTestDetail | null;
  cliGeminiDetail?: GeminiTestDetail | null;
  // 全局确认弹窗回调（供内嵌编辑器使用，替代嵌套 ConfirmDialog/AppModal）
  showDialog?: (options: {
    type?: 'confirm' | 'warning';
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
  }) => Promise<boolean>;
  // 回调
  onAddAccount?: () => void;
  onDeleteAccount?: (accountId: string) => void | Promise<void>;
  onToggleGroupFilter?: (siteName: string, groupName: string | null) => void;
  onModelSearchChange?: (siteName: string, search: string) => void;
  onCopyToClipboard?: (text: string, label: string) => void;
  onOpenCreateTokenDialog?: (site: SiteConfig) => void;
  onRefreshToken?: (site: SiteConfig, token: any, index: number) => void;
  onDeleteToken?: (site: SiteConfig, token: any, index: number) => void;
  onSaveSiteMeta?: (
    siteId: string,
    updates: Partial<
      Pick<SiteConfig, 'site_type' | 'group' | 'extra_links' | 'force_enable_checkin'>
    >
  ) => void | Promise<void>;
  onSaveAccount?: (
    accountId: string,
    updates: Partial<
      Pick<
        AccountInfo,
        'account_name' | 'user_id' | 'access_token' | 'auto_refresh' | 'auto_refresh_interval'
      >
    >
  ) => void | Promise<void>;
  onSaveCliConfig?: (config: CliConfig) => void;
  onPersistCliConfig?: (config: CliConfig) => void | Promise<void>;
  onDeleteDirectConfig?: (config: CustomCliConfig) => void;
  onUpdateAnyRouterUserHash?: (accountId: string, userHash: string) => void | Promise<void>;
  onConfigChanged?: () => void | Promise<void>;
}

type TabId = 'info' | 'resources' | 'cli';

const TAB_META: Record<TabId, { id: TabId; label: string; icon: React.ComponentType<any> }> = {
  info: { id: 'info', label: '站点信息', icon: Info },
  resources: { id: 'resources', label: '模型 & 资源', icon: Box },
  cli: { id: 'cli', label: 'CLI 配置 & 测试', icon: SettingsIcon },
};

function InfoField({
  label,
  value,
  mono = false,
  tone = 'primary',
  className,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  tone?: 'primary' | 'secondary' | 'accent' | 'warning';
  className?: string;
}) {
  const toneClass =
    tone === 'accent'
      ? 'text-[var(--accent-strong)]'
      : tone === 'warning'
        ? 'text-[var(--warning)]'
        : tone === 'secondary'
          ? 'text-[var(--text-secondary)]'
          : 'text-[var(--text-primary)]';

  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className={`mt-1 truncate text-sm font-medium ${toneClass} ${mono ? 'font-mono' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function CopyInlineButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]"
      title={title}
      aria-label={title}
    >
      {children ?? <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function InlineSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[24px] w-[44px] shrink-0 rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
        checked
          ? 'border-[var(--accent)] bg-[var(--accent)]'
          : 'border-[var(--line-soft)] bg-[var(--surface-2)]'
      }`}
    >
      <span
        className={`mt-[1px] inline-block h-[18px] w-[18px] rounded-full border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-sm)] transition-transform ${
          checked ? 'translate-x-[21px]' : 'translate-x-[1px]'
        }`}
      />
    </button>
  );
}

interface ManagedSiteDraft {
  site_type: SiteType;
  group: string;
  extra_links: string;
  force_enable_checkin: boolean;
}

function buildManagedSiteDraft(
  site: SiteConfig | null | undefined,
  defaultGroupId: string
): ManagedSiteDraft {
  return {
    site_type: site?.site_type || DEFAULT_SITE_TYPE,
    group: site?.group || defaultGroupId,
    extra_links: site?.extra_links ?? '',
    force_enable_checkin: Boolean(site?.force_enable_checkin),
  };
}

interface ManagedAccountDraft {
  account_name: string;
  user_id: string;
  access_token: string;
  auto_refresh: boolean;
  auto_refresh_interval: number;
}

function buildManagedAccountDraft(account: AccountInfo | null): ManagedAccountDraft {
  return {
    account_name: account?.account_name ?? '',
    user_id: account?.user_id ?? '',
    access_token: account?.access_token ?? '',
    auto_refresh: Boolean(account?.auto_refresh),
    auto_refresh_interval: account?.auto_refresh_interval ?? 30,
  };
}

function formatBrowserProfileLabel(account: AccountInfo | null): string {
  if (!account) {
    return '未绑定浏览器';
  }

  if (account.auth_source === 'main_profile') {
    return '主浏览器 Profile';
  }

  const normalizedPath = account.browser_profile_path?.replace(/\\/g, '/');
  const profileLeaf = normalizedPath?.split('/').filter(Boolean).pop() ?? '';
  const slotMatch =
    profileLeaf.match(/(?:^|-)slot-(\d+)$/i) ??
    profileLeaf.match(/(?:^|[-_])profile[-_]?(\d+)$/i) ??
    profileLeaf.match(/(\d+)$/);
  const isolatedProfileLabel = slotMatch?.[1] ? `隔离 Profile ${slotMatch[1]}` : '隔离 Profile';

  if (account.auth_source === 'isolated_profile') {
    return isolatedProfileLabel;
  }

  if (account.auth_source === 'browser') {
    return account.browser_profile_path ? isolatedProfileLabel : '浏览器登录';
  }

  if (account.browser_profile_path) {
    return '默认 Profile';
  }

  return account.auth_source === 'manual' ? '未绑定浏览器' : '默认 Profile';
}

export function AccessPointDetailPanel({
  open,
  onClose,
  data,
  siteResult,
  allAccounts = [],
  apiKeys = [],
  userGroups = {},
  modelPricing,
  groups = [],
  cliConfig,
  isCliTesting = false,
  cliCompatibility,
  cliCodexDetail,
  cliGeminiDetail,
  showDialog,
  onAddAccount,
  onDeleteAccount,
  onToggleGroupFilter,
  onModelSearchChange,
  onCopyToClipboard,
  onOpenCreateTokenDialog,
  onRefreshToken,
  onDeleteToken,
  onSaveSiteMeta,
  onSaveAccount,
  onSaveCliConfig,
  onPersistCliConfig,
  onDeleteDirectConfig,
  onUpdateAnyRouterUserHash,
  onConfigChanged,
}: AccessPointDetailPanelProps) {
  const directIdentityFormId = 'direct-config-identity-form';
  // activeTab 持久化到 localStorage
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const saved = localStorage.getItem('panel-active-tab');
    return (saved as TabId) || 'info';
  });

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState<string>('');
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({});
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [showAccessToken, setShowAccessToken] = useState(false);
  const defaultGroupId =
    groups.find(group => group.id === 'default')?.id || groups[0]?.id || 'default';
  const managedGroups = groups.length > 0 ? groups : [{ id: defaultGroupId, name: '默认分组' }];
  const [managedSiteDraft, setManagedSiteDraft] = useState<ManagedSiteDraft>(() =>
    buildManagedSiteDraft(null, defaultGroupId)
  );
  const [managedAccountDraft, setManagedAccountDraft] = useState<ManagedAccountDraft>(() =>
    buildManagedAccountDraft(null)
  );
  const [savingManagedAccount, setSavingManagedAccount] = useState(false);

  // 持久化 activeTab
  useEffect(() => {
    localStorage.setItem('panel-active-tab', activeTab);
  }, [activeTab]);

  const isManagedSite = data?.type === 'managed';
  const isDirectConfig = data?.type === 'custom-cli';

  // 获取站点/配置基础信息
  const { title } = useMemo(() => {
    if (!data) return { title: '' };

    if (data.type === 'managed') {
      return {
        title: data.site.name,
      };
    } else {
      return {
        title: data.config.name || '未命名配置',
      };
    }
  }, [data]);

  const currentAccount = useMemo(() => {
    if (!data || data.type !== 'managed') return null;
    return data.account;
  }, [data]);
  const shouldShowAnyRouterConfig =
    data?.type === 'managed' &&
    currentAccount !== null &&
    (isAnyRouterSite(data.site.name) || Boolean(currentAccount.anyRouterConfig));

  const maskedAccessToken = useMemo(() => {
    const token = managedAccountDraft.access_token;
    if (!token) return '';

    return token.length <= 16
      ? `${token.slice(0, 4)}****${token.slice(-4)}`
      : `${token.slice(0, 8)}****${token.slice(-8)}`;
  }, [managedAccountDraft.access_token]);

  const savedManagedSiteDraft = useMemo(
    () => buildManagedSiteDraft(data?.type === 'managed' ? data.site : null, defaultGroupId),
    [data, defaultGroupId]
  );

  const savedManagedAccountDraft = useMemo(
    () => buildManagedAccountDraft(currentAccount),
    [currentAccount]
  );

  const isManagedSiteMetaDirty =
    data?.type === 'managed' &&
    (managedSiteDraft.site_type !== savedManagedSiteDraft.site_type ||
      managedSiteDraft.group !== savedManagedSiteDraft.group ||
      managedSiteDraft.extra_links !== savedManagedSiteDraft.extra_links ||
      managedSiteDraft.force_enable_checkin !== savedManagedSiteDraft.force_enable_checkin);

  const isManagedAccountDirty =
    currentAccount !== null &&
    (managedAccountDraft.account_name !== savedManagedAccountDraft.account_name ||
      managedAccountDraft.user_id !== savedManagedAccountDraft.user_id ||
      managedAccountDraft.access_token !== savedManagedAccountDraft.access_token ||
      managedAccountDraft.auto_refresh !== savedManagedAccountDraft.auto_refresh ||
      managedAccountDraft.auto_refresh_interval !== savedManagedAccountDraft.auto_refresh_interval);

  const otherAccounts = useMemo(() => {
    if (!data || data.type !== 'managed') return [];
    return allAccounts.filter(a => a.id !== data.account?.id);
  }, [data, allAccounts]);

  const currentAccountProfileLabel = useMemo(
    () => formatBrowserProfileLabel(currentAccount),
    [currentAccount]
  );

  // 标签过滤：托管站点和直连配置都显示全部三个 tab
  const visibleTabs = useMemo(() => {
    return [TAB_META.info, TAB_META.resources, TAB_META.cli];
  }, []);

  // 打开面板时始终重置为 Tab1
  useEffect(() => {
    if (open) {
      setActiveTab('info');
      setManagedSiteDraft(
        buildManagedSiteDraft(data?.type === 'managed' ? data.site : null, defaultGroupId)
      );
      setManagedAccountDraft(buildManagedAccountDraft(currentAccount));
      setShowAccessToken(false);
    }
  }, [currentAccount, data, defaultGroupId, open]);

  const updateManagedSiteDraft = useCallback(
    <K extends keyof ManagedSiteDraft>(key: K, value: ManagedSiteDraft[K]) => {
      setManagedSiteDraft(prev => ({ ...prev, [key]: value }));
    },
    []
  );

  const updateManagedAccountDraft = useCallback(
    <K extends keyof ManagedAccountDraft>(key: K, value: ManagedAccountDraft[K]) => {
      setManagedAccountDraft(prev => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleSaveManagedInfo = useCallback(async () => {
    if (data?.type !== 'managed') return;

    const normalizedInterval = Math.max(
      1,
      Math.round(Number(managedAccountDraft.auto_refresh_interval) || 30)
    );
    const accountUpdates = currentAccount
      ? {
          account_name: managedAccountDraft.account_name.trim() || currentAccount.account_name,
          user_id: managedAccountDraft.user_id.trim(),
          access_token: managedAccountDraft.access_token,
          auto_refresh: managedAccountDraft.auto_refresh,
          auto_refresh_interval: normalizedInterval,
        }
      : null;
    const normalizedSiteDraft: ManagedSiteDraft = {
      ...managedSiteDraft,
      extra_links: managedSiteDraft.extra_links.trim(),
    };

    setSavingManagedAccount(true);
    try {
      if (isManagedSiteMetaDirty && data.site.id && onSaveSiteMeta) {
        await onSaveSiteMeta(data.site.id, {
          site_type: normalizedSiteDraft.site_type,
          group: normalizedSiteDraft.group,
          extra_links: normalizedSiteDraft.extra_links || undefined,
          force_enable_checkin: normalizedSiteDraft.force_enable_checkin,
        });
        setManagedSiteDraft(normalizedSiteDraft);
      }
      if (currentAccount && accountUpdates && isManagedAccountDirty && onSaveAccount) {
        await onSaveAccount(currentAccount.id, accountUpdates);
        setManagedAccountDraft({ ...accountUpdates });
      }
    } finally {
      setSavingManagedAccount(false);
    }
  }, [
    currentAccount,
    data,
    isManagedAccountDirty,
    isManagedSiteMetaDirty,
    managedAccountDraft,
    managedSiteDraft,
    onSaveAccount,
    onSaveSiteMeta,
  ]);

  const handleToggleGroupFilter = useCallback(
    (siteName: string, groupName: string | null) => {
      setSelectedGroup(prev => (prev === groupName ? null : groupName));
      onToggleGroupFilter?.(siteName, groupName);
    },
    [onToggleGroupFilter]
  );

  const handleModelSearchChange = useCallback(
    (siteName: string, search: string) => {
      setModelSearch(search);
      onModelSearchChange?.(siteName, search);
    },
    [onModelSearchChange]
  );

  const handleToggleTokenVisibility = useCallback((key: string) => {
    setShowTokens(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleToggleModelSelection = useCallback((model: string) => {
    setSelectedModels(prev => {
      const next = new Set(prev);
      if (next.has(model)) {
        next.delete(model);
      } else {
        next.add(model);
      }
      return next;
    });
  }, []);

  const handleCopySelectedModels = useCallback(() => {
    if (selectedModels.size === 0) return;
    const modelsText = Array.from(selectedModels).join(',');
    onCopyToClipboard?.(modelsText, '已选模型');
  }, [selectedModels, onCopyToClipboard]);

  const handleClearSelectedModels = useCallback(() => {
    setSelectedModels(new Set());
  }, []);

  return (
    <OverlayDrawer
      isOpen={open}
      onClose={onClose}
      widthClassName="max-w-[720px]"
      placement="end"
      contentClassName="flex flex-col overflow-hidden"
      title={title}
      titleIcon={
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] ${
            isManagedSite
              ? 'bg-[var(--surface-3)] text-[var(--text-secondary)]'
              : 'bg-[var(--accent-soft)] text-[var(--accent-strong)]'
          }`}
        >
          {isManagedSite ? '站' : '直'}
        </div>
      }
    >
      {/* Tab 切换 */}
      <div className="mb-4 flex shrink-0 items-center gap-1 border-b border-[var(--line-soft)]">
        {visibleTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {/* Tab1: 站点信息 */}
        {activeTab === 'info' && (
          <div className="space-y-4">
            {isManagedSite && data.type === 'managed' && (
              <div className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      站点与账户
                    </div>
                  </div>
                  <AppButton variant="secondary" size="sm" onClick={onAddAccount}>
                    <Plus className="h-4 w-4" />
                    添加账户
                  </AppButton>
                </div>

                {currentAccount ? (
                  <>
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div>
                        <label className="mb-2 block text-xs font-medium text-[var(--text-secondary)]">
                          站点类型
                        </label>
                        <select
                          aria-label="站点类型"
                          value={managedSiteDraft.site_type}
                          onChange={event =>
                            updateManagedSiteDraft('site_type', event.target.value as SiteType)
                          }
                          className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)]"
                        >
                          {SITE_TYPES.map(siteType => (
                            <option key={siteType} value={siteType}>
                              {SITE_TYPE_LABELS[siteType]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-2 block text-xs font-medium text-[var(--text-secondary)]">
                          分组
                        </label>
                        <select
                          aria-label="分组"
                          value={managedSiteDraft.group}
                          onChange={event => updateManagedSiteDraft('group', event.target.value)}
                          className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)]"
                        >
                          {managedGroups.map(group => (
                            <option key={group.id} value={group.id}>
                              {group.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <InfoField label="浏览器 Profile" value={currentAccountProfileLabel} />
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-4 border-t border-[var(--line-soft)] pt-4 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-xs font-medium text-[var(--text-secondary)]">
                          站点 URL
                        </label>
                        <div className="flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2">
                          <Link className="h-4 w-4 flex-shrink-0 text-[var(--text-secondary)]" />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--accent-strong)]">
                            {data.site.url}
                          </span>
                          <CopyInlineButton
                            title="复制 URL"
                            onClick={() => onCopyToClipboard?.(data.site.url, 'URL')}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-2 block text-xs font-medium text-[var(--text-secondary)]">
                          加油站链接
                        </label>
                        <input
                          type="url"
                          aria-label="加油站链接"
                          value={managedSiteDraft.extra_links}
                          onChange={event =>
                            updateManagedSiteDraft('extra_links', event.target.value)
                          }
                          placeholder="https://..."
                          className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)]"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-xs font-medium text-[var(--text-secondary)]">
                          账户名
                        </label>
                        <input
                          type="text"
                          value={managedAccountDraft.account_name}
                          onChange={event =>
                            updateManagedAccountDraft('account_name', event.target.value)
                          }
                          className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)]"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-xs font-medium text-[var(--text-secondary)]">
                          User ID
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={managedAccountDraft.user_id}
                            onChange={event =>
                              updateManagedAccountDraft('user_id', event.target.value)
                            }
                            className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)]"
                          />
                          <CopyInlineButton
                            title="复制 User ID"
                            onClick={() =>
                              onCopyToClipboard?.(managedAccountDraft.user_id, 'User ID')
                            }
                          />
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <label className="mb-2 block text-xs font-medium text-[var(--text-secondary)]">
                          Access Token
                        </label>
                        <div className="flex items-center gap-2">
                          <div className="relative min-w-0 flex-1">
                            <Key className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
                            <input
                              type={showAccessToken ? 'text' : 'password'}
                              value={managedAccountDraft.access_token}
                              onChange={event =>
                                updateManagedAccountDraft('access_token', event.target.value)
                              }
                              placeholder={maskedAccessToken || 'Access Token'}
                              className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] py-2 pl-9 pr-3 font-mono text-sm text-[var(--text-primary)] transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)]"
                            />
                          </div>
                          <CopyInlineButton
                            title={showAccessToken ? '隐藏 Token' : '显示 Token'}
                            onClick={() => setShowAccessToken(prev => !prev)}
                          >
                            {showAccessToken ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </CopyInlineButton>
                          <CopyInlineButton
                            title="复制 Access Token"
                            onClick={() =>
                              onCopyToClipboard?.(managedAccountDraft.access_token, 'Access Token')
                            }
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-4 border-t border-[var(--line-soft)] pt-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px]">
                      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--surface-1)] px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[var(--text-secondary)]">
                            启用签到功能
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                            保存后按站点生效
                          </div>
                        </div>
                        <InlineSwitch
                          checked={managedSiteDraft.force_enable_checkin}
                          onChange={checked =>
                            updateManagedSiteDraft('force_enable_checkin', checked)
                          }
                          ariaLabel="启用签到功能"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--surface-1)] px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[var(--text-secondary)]">
                            自动刷新
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                            保存后按账户生效
                          </div>
                        </div>
                        <InlineSwitch
                          checked={managedAccountDraft.auto_refresh}
                          onChange={checked => updateManagedAccountDraft('auto_refresh', checked)}
                          ariaLabel="启用账户自动刷新"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-xs font-medium text-[var(--text-secondary)]">
                          间隔分钟
                        </label>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={managedAccountDraft.auto_refresh_interval}
                          onChange={event =>
                            updateManagedAccountDraft(
                              'auto_refresh_interval',
                              Math.max(1, Number(event.target.value) || 1)
                            )
                          }
                          disabled={!managedAccountDraft.auto_refresh}
                          className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50"
                        />
                      </div>
                    </div>

                    {shouldShowAnyRouterConfig && (
                      <div className="mt-4 border-t border-[var(--line-soft)] pt-4">
                        <AnyRouterConfigSection
                          siteId={data.site.id!}
                          accountId={currentAccount.id}
                          userHash={currentAccount.anyRouterConfig?.userHash || ''}
                          onUserHashChange={newHash =>
                            onUpdateAnyRouterUserHash?.(currentAccount.id, newHash)
                          }
                          onConfigChanged={onConfigChanged}
                          variant="inline"
                          showManualHelp={false}
                        />
                      </div>
                    )}

                    {otherAccounts.length > 0 && (
                      <details className="mt-4 border-t border-[var(--line-soft)] pt-4">
                        <summary className="cursor-pointer text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent)]">
                          其他账户 ({otherAccounts.length})
                        </summary>
                        <div className="mt-3 divide-y divide-[var(--line-soft)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)]">
                          {otherAccounts.map(account => (
                            <div
                              key={account.id}
                              className="flex items-center justify-between gap-3 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                                  {account.account_name}
                                </div>
                                <div className="text-xs text-[var(--text-secondary)]">
                                  {formatBrowserProfileLabel(account)}
                                </div>
                              </div>
                              <AppButton
                                variant="tertiary"
                                size="sm"
                                onClick={() => {
                                  void onDeleteAccount?.(account.id);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                删除
                              </AppButton>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line-soft)] pt-4">
                      <AppButton
                        variant="tertiary"
                        size="sm"
                        onClick={() => {
                          void onDeleteAccount?.(currentAccount.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        删除账户
                      </AppButton>
                      <AppButton
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          void handleSaveManagedInfo();
                        }}
                        disabled={
                          (!isManagedAccountDirty && !isManagedSiteMetaDirty) ||
                          savingManagedAccount
                        }
                      >
                        <Save className="h-4 w-4" />
                        {savingManagedAccount ? '保存中...' : '保存更改'}
                      </AppButton>
                    </div>
                  </>
                ) : (
                  <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-3 text-sm text-[var(--text-secondary)]">
                    该站点还没有账户。添加账户后可管理 API Key、User Hash、自动刷新与 CLI 测试。
                  </div>
                )}
              </div>
            )}

            {isDirectConfig && data.type === 'custom-cli' && (
              <div className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] p-4">
                <div className="border-b border-[var(--line-soft)] pb-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">直连配置</div>
                  </div>
                </div>

                <div className="mt-4 border-t border-[var(--line-soft)] pt-4">
                  <DirectCliConfigEditorContent
                    section="identity"
                    showHeader={false}
                    showSaveAction={false}
                    showModelSummary={false}
                    identityFormId={directIdentityFormId}
                    config={data.config}
                    onSaved={onConfigChanged}
                    showDialog={showDialog}
                  />
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line-soft)] pt-4">
                  <AppButton
                    variant="tertiary"
                    size="sm"
                    onClick={() => onDeleteDirectConfig?.(data.config)}
                  >
                    <Trash2 className="h-4 w-4" />
                    删除配置
                  </AppButton>
                  <AppButton variant="primary" size="sm" type="submit" form={directIdentityFormId}>
                    <Save className="h-4 w-4" />
                    保存配置
                  </AppButton>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab2: 模型 & 资源 */}
        {activeTab === 'resources' && (
          <div>
            {isManagedSite && data.type === 'managed' ? (
              currentAccount ? (
                <SiteCardDetails
                  site={data.site}
                  cardKey={`${data.site.name}::${currentAccount.id}`}
                  siteResult={siteResult}
                  apiKeys={apiKeys}
                  userGroups={userGroups}
                  modelPricing={modelPricing}
                  selectedGroup={selectedGroup}
                  modelSearch={modelSearch}
                  globalModelSearch=""
                  showTokens={showTokens}
                  selectedModels={selectedModels}
                  deletingTokenKey={null}
                  refreshingTokenKey={null}
                  onToggleGroupFilter={handleToggleGroupFilter}
                  onModelSearchChange={handleModelSearchChange}
                  onToggleTokenVisibility={handleToggleTokenVisibility}
                  onToggleModelSelection={handleToggleModelSelection}
                  onCopySelectedModels={handleCopySelectedModels}
                  onClearSelectedModels={handleClearSelectedModels}
                  onCopyToClipboard={onCopyToClipboard || (() => {})}
                  onOpenCreateTokenDialog={onOpenCreateTokenDialog || (() => {})}
                  onRefreshToken={onRefreshToken || (() => {})}
                  onDeleteToken={onDeleteToken || (() => {})}
                />
              ) : (
                <div className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] p-4 text-sm text-[var(--text-secondary)]">
                  添加账户后可查看模型、用户组与 API Key。
                </div>
              )
            ) : isDirectConfig && data.type === 'custom-cli' ? (
              <DirectCliConfigEditorContent
                section="models"
                config={data.config}
                onSaved={onConfigChanged}
                showDialog={showDialog}
              />
            ) : null}
          </div>
        )}

        {/* Tab3: CLI 配置 & 测试 */}
        {activeTab === 'cli' && (
          <div className="space-y-4">
            {/* 测试状态横幅 */}
            {isCliTesting && (
              <div className="rounded-[var(--radius-md)] border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--warning)]">
                正在测试 CLI 兼容性...
              </div>
            )}

            {isManagedSite && data.type === 'managed' && currentAccount ? (
              <ManagedCliConfigEditorContent
                siteId={data.site.id}
                siteName={data.site.name}
                accountId={currentAccount.id}
                accountName={currentAccount.account_name}
                siteUrl={data.site.url}
                apiKeys={apiKeys as any}
                siteModels={siteResult?.models || []}
                siteModelPricing={modelPricing}
                currentConfig={cliConfig ?? null}
                codexDetail={cliCodexDetail}
                geminiDetail={cliGeminiDetail}
                compatibility={cliCompatibility ?? null}
                showDialog={showDialog}
                onPersistConfig={onPersistCliConfig}
                onSave={config => {
                  onSaveCliConfig?.(config);
                }}
              />
            ) : isManagedSite && data.type === 'managed' && !currentAccount ? (
              <div className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] p-4 text-sm text-[var(--text-secondary)]">
                该站点尚未选择账户，请先在「站点信息」中选择或添加账户后再配置 CLI。
              </div>
            ) : isDirectConfig && data.type === 'custom-cli' ? (
              <DirectCliConfigEditorContent
                section="cli"
                config={data.config}
                onSaved={onConfigChanged}
                showDialog={showDialog}
              />
            ) : null}
          </div>
        )}
      </div>
    </OverlayDrawer>
  );
}
