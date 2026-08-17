/**
 * 代理服务&CLI 路由模型选择
 * 输入: routeStore (服务器配置/模型选择)
 * 输出: 服务器状态 + CLI 路由模型选择
 * 定位: 路由页代理服务器与 CLI 模型选择面板
 */

import { useCallback, useEffect, useState, useRef, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Square,
  Copy,
  KeyRound,
  Loader2,
  Activity,
  Edit2,
  RotateCcw,
  X,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Trash2,
  Plus,
} from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useRouteStore } from '../../../store/routeStore';
import { toast } from '../../../store/toastStore';
import { AppCard, AppCardContent } from '../../AppCard';
import { AppButton } from '../../AppButton/AppButton';
import { AppInput } from '../../AppInput/AppInput';
import { AppModal } from '../../AppModal/AppModal';
import { AgentLogo, AgentLogoSelect } from '../../AgentLogo';
import { buildRecommendedCliModelOptions } from '../Redirection/ModelRedirectionTab';
import ClaudeCodeIcon from '../../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../../assets/cli-icons/codex.svg';
import OpenCodeIcon from '../../../assets/cli-icons/opencode.svg';
import GrokBuildIcon from '../../../assets/cli-icons/grok.svg';
import {
  normalizeRouteThinkingEffort,
  isRouteThinkingEffortPreset,
  ROUTE_THINKING_EFFORT_LEVELS,
  normalizeRouteCliSelection,
  type RouteCliType,
  type RouteThinkingEffort,
  type RouteModelRegistryEntry,
  type RouteStateAffinitySummary,
} from '../../../../shared/types/route-proxy';
import type {
  ConfigFilePreviewTransaction,
  ConfigFileProfile,
  AgentLogoId,
} from '../../../../shared/types/config-file-profile';
import {
  generateClaudeCodeRouteConfig,
  generateCodexRouteConfig,
  generateGrokBuildRouteConfig,
  generateOpenCodeRouteConfig,
  type GeneratedConfig,
} from '../../../services/cli-config-generator';
import { BUILTIN_CLI_LABELS, BUILTIN_CLI_TYPES } from '../../../../shared/types/cli-config';

const ROUTE_CLI_TYPES: RouteCliType[] = [...BUILTIN_CLI_TYPES];
const CLI_LABELS: Record<RouteCliType, string> = BUILTIN_CLI_LABELS;
const CLI_ICON_CONFIGS: Record<RouteCliType, { src: string; className: string }> = {
  claudeCode: { src: ClaudeCodeIcon, className: 'h-[14px] w-[14px]' },
  codex: { src: CodexIcon, className: 'h-4 w-4' },
  openCode: { src: OpenCodeIcon, className: 'h-4 w-[13px]' },
  grokBuild: { src: GrokBuildIcon, className: 'h-4 w-4' },
};
const ROUTE_PROXY_DISPLAY_NAME = '本地路由代理';
const PROFILE_CREDENTIAL_ICON_BUTTON_CLASS =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-2)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50';

type RoutePreviewState = {
  cliType: RouteCliType;
  isEditing: boolean;
  draft: GeneratedConfig | null;
};
type CustomThinkingEffortDialogState = {
  cliType: RouteCliType;
  value: string;
};
interface ThinkingEffortSelectProps {
  cliType: RouteCliType;
  value: RouteThinkingEffort | null | undefined;
  onSelect: (value: RouteThinkingEffort | null) => void;
  onCustom: () => void;
  onDeleteCustom: () => void;
}

function ThinkingEffortSelect({
  cliType,
  value,
  onSelect,
  onCustom,
  onDeleteCustom,
}: ThinkingEffortSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const customValue = value && !isRouteThinkingEffortPreset(value) ? value : null;
  const displayValue = value || '未设置';

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(rect.width, 128);
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const openUpward = spaceBelow < 180 && rect.top > spaceBelow;
      setMenuStyle({
        position: 'fixed',
        left,
        width,
        top: openUpward ? undefined : rect.bottom + 4,
        bottom: openUpward ? window.innerHeight - rect.top + 4 : undefined,
        zIndex: 260,
      });
    };

    updatePosition();
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    const handleReposition = () => updatePosition();

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    event.preventDefault();
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    );
    const currentIndex = items.findIndex(item => item === document.activeElement);
    const nextIndex =
      event.key === 'ArrowDown'
        ? (currentIndex + 1) % items.length
        : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const selectValue = (nextValue: RouteThinkingEffort | null) => {
    onSelect(nextValue);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        data-testid={`route-cli-thinking-effort-${cliType}`}
        type="button"
        aria-label={`${CLI_LABELS[cliType]} 思考强度，当前 ${displayValue}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={isOpen ? menuId : undefined}
        onClick={() => setIsOpen(current => !current)}
        className="flex h-7 w-full items-center justify-between gap-2 rounded-md border border-[var(--line-soft)] bg-[var(--surface-2)] px-2 py-1 text-left text-xs text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1"
      >
        <span className="min-w-0 flex-1 truncate">{displayValue}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              data-testid={`route-cli-thinking-effort-menu-${cliType}`}
              role="menu"
              aria-label={`${CLI_LABELS[cliType]} 思考强度选项`}
              onKeyDown={handleMenuKeyDown}
              style={menuStyle}
              className="overflow-hidden rounded-md border border-[var(--line-soft)] bg-[var(--surface-1)] py-1 shadow-[var(--shadow-lg)]"
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!value}
                onClick={() => selectValue(null)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--surface-2)] focus:bg-[var(--surface-2)] focus:outline-none"
              >
                <Check className={`h-3.5 w-3.5 ${!value ? 'opacity-100' : 'opacity-0'}`} />
                <span>未设置</span>
              </button>
              {ROUTE_THINKING_EFFORT_LEVELS.map(option => (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === option}
                  onClick={() => selectValue(option)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--surface-2)] focus:bg-[var(--surface-2)] focus:outline-none"
                >
                  <Check
                    className={`h-3.5 w-3.5 ${value === option ? 'opacity-100' : 'opacity-0'}`}
                  />
                  <span>{option}</span>
                </button>
              ))}
              {customValue && (
                <div
                  data-testid={`route-cli-thinking-effort-custom-option-${cliType}`}
                  role="none"
                  className="flex items-center hover:bg-[var(--surface-2)] focus-within:bg-[var(--surface-2)]"
                >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={true}
                    onClick={() => {
                      setIsOpen(false);
                      triggerRef.current?.focus();
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs text-[var(--text-primary)] focus:outline-none"
                  >
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{customValue}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    title="删除自定义思考强度"
                    aria-label={`删除 ${CLI_LABELS[cliType]} 自定义思考强度`}
                    onClick={event => {
                      event.stopPropagation();
                      onDeleteCustom();
                      setIsOpen(false);
                      triggerRef.current?.focus();
                    }}
                    className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}
              <button
                data-testid={`route-cli-thinking-effort-custom-action-${cliType}`}
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  onCustom();
                }}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--surface-2)] focus:bg-[var(--surface-2)] focus:outline-none"
              >
                <span className="h-3.5 w-3.5" aria-hidden="true" />
                <span>自定义</span>
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

/** 代理服务器状态区 */
interface RoutePanelProps {
  className?: string;
  variant?: 'card' | 'pane';
}

function resolveCliSelectionDisplayValue(
  selectedModel: string | null | undefined,
  entries: RouteModelRegistryEntry[]
): string {
  return (
    normalizeRouteCliSelection(
      selectedModel,
      Object.fromEntries(entries.map(entry => [entry.canonicalName, entry]))
    ) ?? ''
  );
}

function buildRouteProxyBaseUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

function buildRouteCliGeneratedConfig(params: {
  cliType: RouteCliType;
  host: string;
  port: number;
  unifiedApiKey: string;
  model: string | null | undefined;
}): GeneratedConfig | null {
  const { cliType, host, port, unifiedApiKey, model } = params;
  if (!model) {
    return null;
  }

  const sharedParams = {
    siteUrl: buildRouteProxyBaseUrl(host, port),
    siteName: ROUTE_PROXY_DISPLAY_NAME,
    apiKey: unifiedApiKey,
    model,
  };

  if (cliType === 'claudeCode') {
    return generateClaudeCodeRouteConfig(sharedParams);
  }

  if (cliType === 'codex') {
    return generateCodexRouteConfig(sharedParams);
  }

  if (cliType === 'openCode') {
    return generateOpenCodeRouteConfig(sharedParams);
  }

  if (cliType === 'grokBuild') {
    return generateGrokBuildRouteConfig(sharedParams);
  }

  return null;
}

function cloneGeneratedConfig(config: GeneratedConfig): GeneratedConfig {
  return {
    files: config.files.map(file => ({ ...file })),
  };
}

function RouteConfigPreviewModal({
  previewState,
  displayConfig,
  baselineConfig,
  onClose,
  onEdit,
  onChangeFile,
  onSaveEdit,
  onCancelEdit,
  onReset,
}: {
  previewState: RoutePreviewState | null;
  displayConfig: GeneratedConfig | null;
  baselineConfig: GeneratedConfig | null;
  onClose: () => void;
  onEdit: () => void;
  onChangeFile: (path: string, content: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onReset: () => void;
}) {
  if (!previewState) {
    return null;
  }

  const title = `${CLI_LABELS[previewState.cliType]} 路由配置预览`;
  const isPreviewDirty =
    previewState.isEditing &&
    Boolean(previewState.draft) &&
    JSON.stringify(previewState.draft?.files ?? null) !==
      JSON.stringify(baselineConfig?.files ?? null);

  return (
    <div className="fixed inset-0 z-[var(--z-overlay-top)] flex items-center justify-center bg-black/45 p-6">
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[85vh] w-full max-w-[980px] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-xl)]"
      >
        <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{ROUTE_PROXY_DISPLAY_NAME}</p>
          </div>
          <div className="flex items-center gap-2">
            {previewState.isEditing ? (
              <>
                <AppButton variant="tertiary" size="sm" onClick={onCancelEdit}>
                  取消
                </AppButton>
                <AppButton
                  variant={isPreviewDirty ? 'danger' : 'primary'}
                  size="sm"
                  onClick={onSaveEdit}
                  data-testid="route-preview-save-button"
                  data-dirty={isPreviewDirty ? 'true' : 'false'}
                >
                  保存
                </AppButton>
              </>
            ) : (
              <>
                <AppButton variant="tertiary" size="sm" onClick={onReset}>
                  <RotateCcw className="h-4 w-4" />
                  重置
                </AppButton>
                <AppButton variant="secondary" size="sm" onClick={onEdit}>
                  <Edit2 className="h-4 w-4" />
                  编辑
                </AppButton>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)]"
              aria-label="关闭预览"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {displayConfig ? (
            displayConfig.files.map(file => (
              <div
                key={file.path}
                className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line-soft)]"
              >
                <div className="flex items-center justify-between border-b border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
                  <code className="text-sm text-[var(--text-primary)]">{file.path}</code>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(file.content);
                      toast.success('配置内容已复制');
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-1)]"
                    title="复制配置内容"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                {previewState.isEditing ? (
                  <textarea
                    aria-label={file.path}
                    value={file.content}
                    onChange={event => onChangeFile(file.path, event.target.value)}
                    className="min-h-[280px] w-full resize-y border-none bg-[var(--code-bg)] px-4 py-3 font-mono text-sm text-[var(--code-text)] focus:outline-none"
                    spellCheck={false}
                  />
                ) : (
                  <pre className="min-h-[280px] overflow-auto bg-[var(--code-bg)] px-4 py-3 text-sm text-[var(--code-text)]">
                    <code>{file.content}</code>
                  </pre>
                )}
              </div>
            ))
          ) : (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--line-soft)] bg-[var(--surface-2)] px-4 py-10 text-center text-sm text-[var(--text-secondary)]">
              请先为当前 CLI 选择模型。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RouteApplyPopover({
  isOpen,
  anchorEl,
  cliType,
  applyingCli,
  onApply,
  onClose,
}: {
  isOpen: boolean;
  anchorEl: HTMLButtonElement | null;
  cliType: RouteCliType | null;
  applyingCli: RouteCliType | null;
  onApply: (cli: RouteCliType, mode: 'merge' | 'overwrite') => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isPositioned, setIsPositioned] = useState(false);

  useEffect(() => {
    if (!isOpen || !anchorEl) {
      return;
    }

    let frameId = 0;
    const updatePosition = () => {
      const rect = anchorEl.getBoundingClientRect();
      const offset = 8;
      const viewportGutter = 8;
      setPosition({
        top: rect.bottom + offset,
        left: rect.left,
      });
      setIsPositioned(false);

      frameId = requestAnimationFrame(() => {
        if (!popoverRef.current) {
          return;
        }

        const popoverRect = popoverRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;
        const maxLeft = Math.max(
          viewportGutter,
          viewportWidth - popoverRect.width - viewportGutter
        );
        const maxTop = Math.max(
          viewportGutter,
          viewportHeight - popoverRect.height - viewportGutter
        );
        let nextTop = rect.bottom + offset;

        if (spaceBelow < popoverRect.height + 16 && spaceAbove > spaceBelow) {
          nextTop = rect.top - popoverRect.height - offset;
        }

        setPosition({
          top: Math.max(viewportGutter, Math.min(nextTop, maxTop)),
          left: Math.max(viewportGutter, Math.min(rect.left, maxLeft)),
        });
        setIsPositioned(true);
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorEl, isOpen]);

  useEffect(() => {
    if (!isOpen || !anchorEl) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || anchorEl.contains(target)) {
        return;
      }
      onClose();
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [anchorEl, isOpen, onClose]);

  if (!isOpen || !anchorEl || !cliType) {
    return null;
  }

  return createPortal(
    <div
      ref={popoverRef}
      className={`fixed z-[var(--z-popover-top)] min-w-[128px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-xl)] transition-opacity duration-100 ${
        isPositioned ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ top: position.top, left: position.left }}
    >
      <button
        type="button"
        onClick={() => onApply(cliType, 'merge')}
        disabled={applyingCli !== null}
        className="block w-full px-3 py-2 text-left text-xs text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        合并
      </button>
      {cliType !== 'openCode' && cliType !== 'grokBuild' && (
        <button
          type="button"
          onClick={() => onApply(cliType, 'overwrite')}
          disabled={applyingCli !== null}
          className="block w-full border-t border-[var(--line-soft)] px-3 py-2 text-left text-xs text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          覆盖
        </button>
      )}
    </div>,
    document.body
  );
}

export function ServerSection({ className = '' }: RoutePanelProps) {
  const { config, serverRunning, saveServerConfig, startServer, stopServer } = useRouteStore(
    useShallow(s => ({
      config: s.config,
      serverRunning: s.serverRunning,
      saveServerConfig: s.saveServerConfig,
      startServer: s.startServer,
      stopServer: s.stopServer,
    }))
  );
  const [toggling, setToggling] = useState(false);
  const [localRouteProfiles, setLocalRouteProfiles] = useState<ConfigFileProfile[]>([]);
  const [visibleProfileKeys, setVisibleProfileKeys] = useState<Record<string, boolean>>({});
  const [credentialActionProfileId, setCredentialActionProfileId] = useState<string | null>(null);
  const [rotationPreview, setRotationPreview] = useState<ConfigFilePreviewTransaction | null>(null);
  const [stateClearPreview, setStateClearPreview] = useState<RouteStateAffinitySummary | null>(
    null
  );
  const [credentialEditorProfileId, setCredentialEditorProfileId] = useState<string | 'new' | null>(
    null
  );
  const [credentialDraft, setCredentialDraft] = useState<{
    name: string;
    agentLogoId?: AgentLogoId;
  }>({ name: '' });
  const [savingCredential, setSavingCredential] = useState(false);
  const [deleteCredentialProfile, setDeleteCredentialProfile] = useState<ConfigFileProfile | null>(
    null
  );
  const server = config?.server;

  const reloadProfiles = useCallback(async () => {
    const profiles = await window.electronAPI.configFileProfiles.load();
    setLocalRouteProfiles(profiles.filter(profile => profile.target.kind === 'local-route'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void reloadProfiles().catch(
      error =>
        !cancelled && toast.error(error instanceof Error ? error.message : '加载代理服务器配置失败')
    );
    return () => {
      cancelled = true;
    };
  }, [reloadProfiles]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.appData?.onChanged?.(({ domains }) => {
      if (!domains.includes('config-file-profiles')) return;
      void reloadProfiles().catch(error =>
        toast.error(error instanceof Error ? error.message : '刷新客户端独立凭证失败')
      );
    });
    return () => unsubscribe?.();
  }, [reloadProfiles]);

  if (!config || !server) return null;

  const handleToggle = async () => {
    setToggling(true);
    try {
      if (serverRunning) {
        await stopServer();
        toast.success('代理服务器已停止');
      } else {
        const ok = await startServer();
        if (ok) toast.success(`代理服务器已启动 ${server.host}:${server.port}`);
        else toast.error('启动失败');
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '未知错误');
    } finally {
      setToggling(false);
    }
  };

  const openCredentialEditor = (profile?: ConfigFileProfile) => {
    setCredentialDraft({
      name: profile?.name || '',
      agentLogoId: profile?.agentLogoId,
    });
    setCredentialEditorProfileId(profile?.id || 'new');
  };

  const saveCredentialProfile = async () => {
    const name = credentialDraft.name.trim();
    if (!name || !credentialEditorProfileId) return;
    setSavingCredential(true);
    try {
      if (credentialEditorProfileId === 'new') {
        const now = Date.now();
        const saved = await window.electronAPI.configFileProfiles.upsert({
          profile: {
            id: crypto.randomUUID(),
            name,
            agentLogoId: credentialDraft.agentLogoId,
            credentialOnly: true,
            files: [],
            sessionRecordConnectors: [],
            sessionRecordPaths: [],
            target: { kind: 'local-route', model: null },
            createdAt: now,
            updatedAt: now,
          },
        });
        setLocalRouteProfiles(current => [...current, saved]);
        setCredentialEditorProfileId(saved.id);
        const generated = await window.electronAPI.configFileProfiles.generateRouteKey({
          profileId: saved.id,
          expectedRevision: saved.revision,
        });
        setLocalRouteProfiles(current =>
          current.map(profile => (profile.id === generated.id ? generated : profile))
        );
        setVisibleProfileKeys(current => ({ ...current, [generated.id]: false }));
        toast.success(`已添加 ${generated.name} 并生成独立 API Key`);
      } else {
        const current = localRouteProfiles.find(
          profile => profile.id === credentialEditorProfileId
        );
        if (!current?.credentialOnly) throw new Error('仅凭证客户端不存在');
        const updated = await window.electronAPI.configFileProfiles.upsert({
          profile: {
            ...current,
            name,
            agentLogoId: credentialDraft.agentLogoId,
          },
          expectedRevision: current.revision,
        });
        setLocalRouteProfiles(profiles =>
          profiles.map(profile => (profile.id === updated.id ? updated : profile))
        );
        toast.success('客户端信息已更新');
      }
      setCredentialEditorProfileId(null);
      setCredentialDraft({ name: '' });
    } catch (error) {
      await reloadProfiles().catch(() => undefined);
      toast.error(error instanceof Error ? error.message : '保存客户端凭证失败');
    } finally {
      setSavingCredential(false);
    }
  };

  const deleteStandaloneCredential = async () => {
    if (!deleteCredentialProfile?.credentialOnly) return;
    setSavingCredential(true);
    try {
      await window.electronAPI.configFileProfiles.delete({
        profileId: deleteCredentialProfile.id,
        expectedRevision: deleteCredentialProfile.revision,
      });
      setLocalRouteProfiles(current =>
        current.filter(profile => profile.id !== deleteCredentialProfile.id)
      );
      setDeleteCredentialProfile(null);
      toast.success('客户端独立凭证已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除客户端凭证失败');
    } finally {
      setSavingCredential(false);
    }
  };

  const generateProfileKey = async (profile: ConfigFileProfile) => {
    setCredentialActionProfileId(profile.id);
    try {
      const updated = await window.electronAPI.configFileProfiles.generateRouteKey({
        profileId: profile.id,
        expectedRevision: profile.revision,
      });
      setLocalRouteProfiles(current =>
        current.map(item => (item.id === updated.id ? updated : item))
      );
      setVisibleProfileKeys(current => ({ ...current, [updated.id]: false }));
      toast.success(`已为 ${updated.name} 生成独立 API Key`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成独立 API Key 失败');
    } finally {
      setCredentialActionProfileId(null);
    }
  };

  const previewProfileKeyRotation = async (profile: ConfigFileProfile) => {
    setCredentialActionProfileId(profile.id);
    try {
      setRotationPreview(
        await window.electronAPI.configFileProfiles.previewRouteKeyRotation({
          profileId: profile.id,
          expectedRevision: profile.revision,
        })
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成 API Key 轮换预览失败');
    } finally {
      setCredentialActionProfileId(null);
    }
  };

  const commitProfileKeyRotation = async () => {
    if (!rotationPreview) return;
    setCredentialActionProfileId(rotationPreview.profileId);
    try {
      await window.electronAPI.configFileProfiles.commit({
        transactionId: rotationPreview.transactionId,
      });
      await reloadProfiles();
      setVisibleProfileKeys(current => ({ ...current, [rotationPreview.profileId]: false }));
      setRotationPreview(null);
      toast.success('API Key 与客户端配置文件已同步轮换');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '轮换 API Key 失败');
    } finally {
      setCredentialActionProfileId(null);
    }
  };

  const previewProfileStateClear = async (profile: ConfigFileProfile) => {
    setCredentialActionProfileId(profile.id);
    try {
      const result = await window.electronAPI.route?.previewProfileStateClear?.(profile.id);
      if (!result?.success || !result.data) {
        throw new Error(result?.error || '无法读取状态资源影响范围');
      }
      setStateClearPreview(result.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取状态资源影响范围失败');
    } finally {
      setCredentialActionProfileId(null);
    }
  };

  const commitProfileStateClear = async () => {
    if (!stateClearPreview) return;
    setCredentialActionProfileId(stateClearPreview.profileId);
    try {
      const result = await window.electronAPI.route?.clearProfileState?.(
        stateClearPreview.profileId
      );
      if (!result?.success) throw new Error(result?.error || '清理状态资源失败');
      setStateClearPreview(null);
      toast.success(`已清理 ${result.data?.removed || 0} 条状态资源映射`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清理状态资源失败');
    } finally {
      setCredentialActionProfileId(null);
    }
  };

  return (
    <>
      <AppCard
        data-testid="route-server-section-card"
        className={className}
        hoverable={false}
        blur={false}
      >
        <AppCardContent className="p-4">
          <div className="mb-3 flex min-w-0 items-center gap-2">
            <Activity className="h-4 w-4 shrink-0 text-[var(--accent)]" />
            <span className="truncate text-sm font-medium">代理服务器</span>
            <span
              className={`inline-flex items-center gap-1 rounded-[var(--radius-full)] px-2 py-0.5 text-xs font-medium ${
                serverRunning
                  ? 'bg-[var(--success-soft)] text-[var(--success)]'
                  : 'bg-[var(--surface-2)] text-[var(--text-secondary)]'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${serverRunning ? 'bg-[var(--success)]' : 'bg-[var(--icon-muted)]'}`}
              />
              {serverRunning ? '运行中' : '已停止'}
            </span>
            <AppButton
              variant={serverRunning ? 'danger' : 'primary'}
              size="sm"
              className="ml-auto shrink-0"
              onClick={handleToggle}
              disabled={toggling}
            >
              {toggling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : serverRunning ? (
                <Square className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              <span className="ml-1">{serverRunning ? '停止' : '启动'}</span>
            </AppButton>
          </div>
          <div
            data-testid="route-server-primary-config-row"
            className="grid grid-cols-1 gap-3 md:grid-cols-3"
          >
            <AppInput
              id="route-server-port"
              label="端口"
              size="sm"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              defaultValue={server.port}
              onBlur={e => {
                const port = parseInt(e.target.value, 10);
                if (!isNaN(port) && port > 0 && port < 65536) saveServerConfig({ port });
              }}
            />
            <AppInput
              id="route-server-upstream-proxy"
              label="代理"
              size="sm"
              type="text"
              defaultValue={server.upstreamProxyUrl || ''}
              placeholder="http://127.0.0.1:7890"
              onBlur={e => saveServerConfig({ upstreamProxyUrl: e.target.value.trim() })}
            />
            <AppInput
              id="route-server-base-url"
              label="Base URL"
              size="sm"
              type="text"
              value={`http://${server.host}:${server.port}`}
              readOnly
              containerClassName="[&_input]:font-mono"
            />
          </div>
          <div className="mt-4 border-t border-[var(--line-muted)] pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">客户端独立凭证</p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  配置文件客户端与手动添加的第三方供应商客户端共用独立认证。
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-[var(--text-tertiary)]">
                  {localRouteProfiles.length} 个客户端
                </span>
                <AppButton size="sm" onClick={() => openCredentialEditor()}>
                  <Plus className="h-3.5 w-3.5" />
                  新增客户端
                </AppButton>
              </div>
            </div>
            <div
              className="grid grid-cols-3 gap-x-3 gap-y-1"
              data-testid="route-profile-credentials"
            >
              {localRouteProfiles.length === 0 ? (
                <p className="col-span-3 py-3 text-xs text-[var(--text-tertiary)]">
                  暂无客户端独立凭证
                </p>
              ) : (
                localRouteProfiles.map(profile => {
                  const credential = profile.localRouteCredential;
                  const visible = Boolean(visibleProfileKeys[profile.id]);
                  const busy = credentialActionProfileId === profile.id;
                  return (
                    <div
                      key={profile.id}
                      data-testid={`route-profile-credential-${profile.id}`}
                      className="min-w-0 space-y-1.5 border-t border-[var(--line-muted)] py-2.5"
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <AgentLogo
                            logoId={profile.agentLogoId}
                            agentId={profile.builtin?.clientType}
                            agentName={profile.name}
                            className="h-5 w-5"
                          />
                          <p className="truncate text-xs font-medium" title={profile.name}>
                            {profile.name}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <p className="text-[10px] text-[var(--text-tertiary)]">
                            {credential ? '已生成独立 Key' : '尚未生成 Key'}
                          </p>
                          {profile.credentialOnly ? (
                            <>
                              <button
                                type="button"
                                title="编辑客户端"
                                aria-label={`编辑 ${profile.name}`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                                onClick={() => openCredentialEditor(profile)}
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title="删除客户端"
                                aria-label={`删除 ${profile.name}`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                                onClick={() => setDeleteCredentialProfile(profile)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div
                        data-testid={`route-profile-credential-controls-${profile.id}`}
                        className="flex min-w-0 items-center gap-1"
                      >
                        <input
                          aria-label={`${profile.name} API Key`}
                          type={visible ? 'text' : 'password'}
                          value={credential?.apiKey || ''}
                          placeholder="尚未生成"
                          readOnly
                          className="h-8 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-2 font-mono text-xs text-[var(--text-primary)]"
                        />
                        {credential ? (
                          <div
                            data-testid={`route-profile-credential-actions-${profile.id}`}
                            className="flex shrink-0 items-center gap-0.5"
                          >
                            <button
                              type="button"
                              title={visible ? '隐藏' : '显示'}
                              aria-label={`${visible ? '隐藏' : '显示'} ${profile.name} API Key`}
                              className={PROFILE_CREDENTIAL_ICON_BUTTON_CLASS}
                              onClick={() =>
                                setVisibleProfileKeys(current => ({
                                  ...current,
                                  [profile.id]: !visible,
                                }))
                              }
                            >
                              {visible ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              title="复制"
                              aria-label={`复制 ${profile.name} API Key`}
                              className={PROFILE_CREDENTIAL_ICON_BUTTON_CLASS}
                              onClick={() => {
                                void navigator.clipboard.writeText(credential.apiKey);
                                toast.success('已复制');
                              }}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              title="轮换"
                              aria-label={`轮换 ${profile.name} API Key`}
                              className={PROFILE_CREDENTIAL_ICON_BUTTON_CLASS}
                              onClick={() => void previewProfileKeyRotation(profile)}
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              title="清理状态资源"
                              aria-label={`清理 ${profile.name} 状态资源`}
                              className={PROFILE_CREDENTIAL_ICON_BUTTON_CLASS}
                              onClick={() => void previewProfileStateClear(profile)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-[var(--radius-sm)] bg-[var(--accent)] px-2 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => void generateProfileKey(profile)}
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <KeyRound className="h-3.5 w-3.5" />
                            )}
                            生成
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </AppCardContent>
      </AppCard>
      <AppModal
        isOpen={credentialEditorProfileId !== null}
        onClose={() => setCredentialEditorProfileId(null)}
        title={credentialEditorProfileId === 'new' ? '新增客户端独立凭证' : '编辑客户端独立凭证'}
        titleIcon={<KeyRound className="h-5 w-5" />}
        size="sm"
        footer={
          <>
            <AppButton
              variant="tertiary"
              disabled={savingCredential}
              onClick={() => setCredentialEditorProfileId(null)}
            >
              取消
            </AppButton>
            <AppButton
              disabled={savingCredential || !credentialDraft.name.trim()}
              onClick={() => void saveCredentialProfile()}
            >
              {savingCredential ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {credentialEditorProfileId === 'new' ? '保存并生成' : '保存'}
            </AppButton>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1 text-xs">
            <span>客户端名称</span>
            <input
              autoFocus
              aria-label="客户端名称"
              value={credentialDraft.name}
              onChange={event =>
                setCredentialDraft(current => ({ ...current, name: event.target.value }))
              }
              className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 text-sm"
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span>Logo</span>
            <AgentLogoSelect
              value={credentialDraft.agentLogoId}
              agentName={credentialDraft.name}
              onChange={agentLogoId => setCredentialDraft(current => ({ ...current, agentLogoId }))}
            />
          </label>
        </div>
      </AppModal>
      <AppModal
        isOpen={deleteCredentialProfile !== null}
        onClose={() => setDeleteCredentialProfile(null)}
        title="删除客户端独立凭证"
        titleIcon={<Trash2 className="h-5 w-5" />}
        size="sm"
        footer={
          <>
            <AppButton
              variant="tertiary"
              disabled={savingCredential}
              onClick={() => setDeleteCredentialProfile(null)}
            >
              取消
            </AppButton>
            <AppButton
              variant="danger"
              disabled={savingCredential}
              onClick={() => void deleteStandaloneCredential()}
            >
              <Trash2 className="h-4 w-4" />
              确认删除
            </AppButton>
          </>
        }
      >
        <p className="text-sm text-[var(--text-secondary)]">
          删除 {deleteCredentialProfile?.name || '此客户端'} 后，其 API Key
          将立即失效，关联的本地状态映射也会清理。
        </p>
      </AppModal>
      <AppModal
        isOpen={rotationPreview !== null}
        onClose={() => setRotationPreview(null)}
        title="确认轮换客户端 API Key"
        titleIcon={<KeyRound className="h-5 w-5" />}
        size="lg"
        footer={
          <>
            <AppButton variant="tertiary" onClick={() => setRotationPreview(null)}>
              取消
            </AppButton>
            <AppButton
              disabled={credentialActionProfileId !== null}
              onClick={() => void commitProfileKeyRotation()}
            >
              <Check className="h-4 w-4" />
              确认轮换
            </AppButton>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            {rotationPreview?.files.length
              ? '新 Key 将同步写入以下客户端配置文件；确认前旧 Key 仍保持有效。'
              : '此客户端没有关联配置文件；确认后只更新客户端独立凭证。'}
          </p>
          <div className="divide-y divide-[var(--line-muted)] border-y border-[var(--line-muted)]">
            {(rotationPreview?.files || []).map(file => (
              <div
                key={file.fileId}
                className="flex min-w-0 items-center justify-between gap-3 py-2"
              >
                <span className="truncate font-mono text-xs" title={file.path}>
                  {file.path}
                </span>
                <span
                  className={file.changed ? 'text-[var(--warning)]' : 'text-[var(--text-tertiary)]'}
                >
                  {file.changed ? '将更新' : '无需修改'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </AppModal>
      <AppModal
        isOpen={stateClearPreview !== null}
        onClose={() => setStateClearPreview(null)}
        title="确认清理状态资源"
        titleIcon={<Trash2 className="h-5 w-5" />}
        size="md"
        footer={
          <>
            <AppButton variant="tertiary" onClick={() => setStateClearPreview(null)}>
              取消
            </AppButton>
            <AppButton
              variant="danger"
              disabled={credentialActionProfileId !== null || stateClearPreview?.total === 0}
              onClick={() => void commitProfileStateClear()}
            >
              <Trash2 className="h-4 w-4" />
              确认清理
            </AppButton>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            将删除此客户端的 {stateClearPreview?.total || 0}{' '}
            条本地亲和映射。上游资源不会被删除，后续状态请求也不会重新选路。
          </p>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="border-y border-[var(--line-muted)] py-2">
              <strong className="block text-base">{stateClearPreview?.responses || 0}</strong>
              Responses
            </div>
            <div className="border-y border-[var(--line-muted)] py-2">
              <strong className="block text-base">{stateClearPreview?.conversations || 0}</strong>
              Conversations
            </div>
            <div className="border-y border-[var(--line-muted)] py-2">
              <strong className="block text-base">
                {stateClearPreview?.conversationItems || 0}
              </strong>
              Items
            </div>
          </div>
        </div>
      </AppModal>
    </>
  );
}

/** CLI 路由模型选择区 */
export function CliModelSection({ className = '', variant = 'card' }: RoutePanelProps) {
  const { config } = useRouteStore(
    useShallow(s => ({
      config: s.config,
    }))
  );
  const saveCliModelSelections = async (_selections: unknown) => undefined;
  const saveCliThinkingEffortSelections = async (_selections: unknown) => undefined;
  const [previewState, setPreviewState] = useState<RoutePreviewState | null>(null);
  const [editedPreviews, setEditedPreviews] = useState<
    Partial<Record<RouteCliType, GeneratedConfig | null>>
  >({});
  const [applyMenuCli, setApplyMenuCli] = useState<RouteCliType | null>(null);
  const [applyingCli, setApplyingCli] = useState<RouteCliType | null>(null);
  const [customThinkingEffortDialog, setCustomThinkingEffortDialog] =
    useState<CustomThinkingEffortDialogState | null>(null);
  const applyButtonRefs = useRef<Partial<Record<RouteCliType, HTMLButtonElement | null>>>({});
  const modelOptions = useMemo(
    () => buildRecommendedCliModelOptions(config?.modelRegistry),
    [config?.modelRegistry]
  );

  if (!config || !config.server) return null;

  const { cliModelSelections, cliThinkingEffortSelections, server } = config;
  const normalizedCliSelections = Object.fromEntries(
    ROUTE_CLI_TYPES.map(cli => [
      cli,
      resolveCliSelectionDisplayValue(cliModelSelections?.[cli], modelOptions),
    ])
  ) as Record<RouteCliType, string>;
  const generatedConfigs = Object.fromEntries(
    ROUTE_CLI_TYPES.map(cli => [
      cli,
      buildRouteCliGeneratedConfig({
        cliType: cli,
        host: server.host,
        port: server.port,
        unifiedApiKey: server.unifiedApiKey,
        model: normalizedCliSelections[cli],
      }),
    ])
  ) as Record<RouteCliType, GeneratedConfig | null>;
  const previewConfig = previewState
    ? (previewState.draft ??
      editedPreviews[previewState.cliType] ??
      generatedConfigs[previewState.cliType])
    : null;
  const previewBaselineConfig = previewState
    ? (editedPreviews[previewState.cliType] ?? generatedConfigs[previewState.cliType])
    : null;

  const handleChange = (cli: RouteCliType, value: string) => {
    setPreviewState(current => (current?.cliType === cli ? null : current));
    setEditedPreviews(prev => ({
      ...prev,
      [cli]: null,
    }));
    setApplyMenuCli(null);
    saveCliModelSelections({ [cli]: value || null });
  };

  const handleThinkingEffortSelect = (cli: RouteCliType, value: RouteThinkingEffort | null) => {
    saveCliThinkingEffortSelections({ [cli]: value });
  };

  const handleOpenCustomThinkingEffort = (cli: RouteCliType) => {
    const existing = cliThinkingEffortSelections?.[cli];
    const initialValue = existing && !isRouteThinkingEffortPreset(existing) ? existing : '';
    setCustomThinkingEffortDialog({ cliType: cli, value: initialValue });
  };

  const handleSaveCustomThinkingEffort = () => {
    if (!customThinkingEffortDialog) {
      return;
    }

    const value = normalizeRouteThinkingEffort(customThinkingEffortDialog.value);
    if (!value) {
      return;
    }

    saveCliThinkingEffortSelections({ [customThinkingEffortDialog.cliType]: value });
    setCustomThinkingEffortDialog(null);
  };

  const handleDeleteCustomThinkingEffort = (cli: RouteCliType) => {
    saveCliThinkingEffortSelections({ [cli]: null });
  };

  const handleApplyRouteConfig = async (cli: RouteCliType, applyMode: 'merge' | 'overwrite') => {
    const generatedConfig = editedPreviews[cli] ?? generatedConfigs[cli];
    if (!generatedConfig || applyingCli) {
      return;
    }

    setApplyingCli(cli);
    try {
      const effectiveApplyMode = cli === 'openCode' || cli === 'grokBuild' ? 'merge' : applyMode;
      const result = await window.electronAPI.cliCompat.writeConfig({
        cliType: cli,
        files: generatedConfig.files.map(file => ({
          path: file.path,
          content: file.content,
        })),
        applyMode: effectiveApplyMode,
      });

      if (!result.success) {
        toast.error(`写入失败: ${result.error || '未知错误'}`);
        return;
      }

      setApplyMenuCli(null);
      try {
        await window.electronAPI.configDetection.clearCache(cli);
      } catch {
        /* ignore cache refresh failures */
      }
      toast.success(`${CLI_LABELS[cli]} 路由配置已写入本地`);

      if (cli === 'claudeCode') {
        setTimeout(() => {
          toast.info('使用 Claude Code for VS Code 需重启 IDE 编辑器');
        }, 1500);
      }
    } catch (error: unknown) {
      toast.error(`应用配置失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setApplyingCli(null);
    }
  };

  const handleOpenPreview = (cli: RouteCliType) => {
    setApplyMenuCli(null);
    setPreviewState({
      cliType: cli,
      isEditing: false,
      draft: null,
    });
  };

  const handlePreviewChange = (path: string, content: string) => {
    setPreviewState(prev => {
      if (!prev || !previewConfig) {
        return prev;
      }

      const nextDraft = prev.draft ?? cloneGeneratedConfig(previewConfig);
      return {
        ...prev,
        draft: {
          files: nextDraft.files.map(file => (file.path === path ? { ...file, content } : file)),
        },
      };
    });
  };

  const handlePreviewEdit = () => {
    if (!previewState || !previewConfig) {
      return;
    }

    setPreviewState({
      ...previewState,
      isEditing: true,
      draft: cloneGeneratedConfig(previewConfig),
    });
  };

  const handlePreviewSave = () => {
    if (!previewState?.draft) {
      return;
    }

    setEditedPreviews(prev => ({
      ...prev,
      [previewState.cliType]: previewState.draft,
    }));
    setPreviewState(prev =>
      prev
        ? {
            ...prev,
            isEditing: false,
            draft: null,
          }
        : null
    );
  };

  const handlePreviewReset = () => {
    if (!previewState) {
      return;
    }

    setEditedPreviews(prev => ({
      ...prev,
      [previewState.cliType]: null,
    }));
    setPreviewState(prev =>
      prev
        ? {
            ...prev,
            isEditing: false,
            draft: null,
          }
        : null
    );
  };

  const content = (
    <div className="px-3 py-2">
      <div className="mb-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <div className="shrink-0 text-xs font-semibold text-[var(--text-primary)]">
          CLI 路由模型选择
        </div>
        <p className="min-w-0 text-[11px] text-[var(--text-secondary)]">
          应用本地路由后，只需修改此处重定向模型即可，无需修改本地配置中的模型
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {ROUTE_CLI_TYPES.map(cli => {
          const iconConfig = CLI_ICON_CONFIGS[cli];

          return (
            <div
              key={cli}
              className="min-w-0 space-y-2 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] p-3"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs leading-4 text-[var(--text-secondary)]">
                  <img
                    src={iconConfig.src}
                    alt=""
                    aria-hidden="true"
                    className={`${iconConfig.className} shrink-0`}
                  />
                  <span className="truncate">{CLI_LABELS[cli]}</span>
                </label>
                <div
                  data-testid={`route-cli-actions-${cli}`}
                  className="flex shrink-0 items-center gap-1"
                >
                  <AppButton
                    variant="secondary"
                    size="sm"
                    onClick={() => handleOpenPreview(cli)}
                    disabled={!generatedConfigs[cli]}
                    aria-label={`预览 ${CLI_LABELS[cli]} 路由配置`}
                  >
                    预览
                  </AppButton>
                  <AppButton
                    ref={element => {
                      applyButtonRefs.current[cli] = element;
                    }}
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setPreviewState(null);
                      setApplyMenuCli(current => (current === cli ? null : cli));
                    }}
                    disabled={
                      !(editedPreviews[cli] ?? generatedConfigs[cli]) || applyingCli !== null
                    }
                    aria-label={`应用 ${CLI_LABELS[cli]} 路由配置`}
                  >
                    {applyingCli === cli ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        应用中
                      </>
                    ) : (
                      '应用'
                    )}
                  </AppButton>
                </div>
              </div>
              <div
                data-testid={`route-cli-selection-row-${cli}`}
                className="grid grid-cols-[minmax(0,1fr)_minmax(105px,0.576fr)] gap-1.5"
              >
                <select
                  value={normalizedCliSelections[cli]}
                  onChange={e => handleChange(cli, e.target.value)}
                  className="h-8 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--text-primary)]"
                >
                  <option value="">未选择</option>
                  {modelOptions.map(entry => (
                    <option key={entry.canonicalName} value={entry.canonicalName}>
                      {entry.canonicalName}
                    </option>
                  ))}
                </select>
                <ThinkingEffortSelect
                  cliType={cli}
                  value={cliThinkingEffortSelections[cli]}
                  onSelect={value => handleThinkingEffortSelect(cli, value)}
                  onCustom={() => handleOpenCustomThinkingEffort(cli)}
                  onDeleteCustom={() => handleDeleteCustomThinkingEffort(cli)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {variant === 'pane' ? (
        <div data-testid="route-cli-model-section-card" className={className}>
          {content}
        </div>
      ) : (
        <AppCard
          data-testid="route-cli-model-section-card"
          className={className}
          hoverable={false}
          blur={false}
        >
          {content}
        </AppCard>
      )}

      <RouteConfigPreviewModal
        previewState={previewState}
        displayConfig={previewConfig}
        baselineConfig={previewBaselineConfig}
        onClose={() => setPreviewState(null)}
        onEdit={handlePreviewEdit}
        onChangeFile={handlePreviewChange}
        onSaveEdit={handlePreviewSave}
        onCancelEdit={() =>
          setPreviewState(prev =>
            prev
              ? {
                  ...prev,
                  isEditing: false,
                  draft: null,
                }
              : null
          )
        }
        onReset={handlePreviewReset}
      />
      <RouteApplyPopover
        isOpen={applyMenuCli !== null}
        anchorEl={applyMenuCli ? (applyButtonRefs.current[applyMenuCli] ?? null) : null}
        cliType={applyMenuCli}
        applyingCli={applyingCli}
        onApply={(cli, mode) => {
          void handleApplyRouteConfig(cli, mode);
        }}
        onClose={() => setApplyMenuCli(null)}
      />
      <AppModal
        isOpen={customThinkingEffortDialog !== null}
        onClose={() => setCustomThinkingEffortDialog(null)}
        title="自定义思考强度"
        size="sm"
        footer={
          <>
            <AppButton variant="tertiary" onClick={() => setCustomThinkingEffortDialog(null)}>
              取消
            </AppButton>
            <AppButton
              variant="primary"
              onClick={handleSaveCustomThinkingEffort}
              disabled={!customThinkingEffortDialog?.value.trim()}
            >
              保存
            </AppButton>
          </>
        }
      >
        <AppInput
          data-testid="route-cli-thinking-effort-custom-input"
          label="自定义值"
          value={customThinkingEffortDialog?.value ?? ''}
          onChange={event =>
            setCustomThinkingEffortDialog(current =>
              current ? { ...current, value: event.target.value } : current
            )
          }
          onKeyDown={event => {
            if (event.key === 'Enter' && customThinkingEffortDialog?.value.trim()) {
              handleSaveCustomThinkingEffort();
            }
          }}
          placeholder="输入自定义字符串"
          aria-label="自定义思考强度"
        />
      </AppModal>
    </>
  );
}

/** 统计仪表盘（首次加载后缓存） */
