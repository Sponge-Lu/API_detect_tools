/**
 * 代理服务&统计 Sub-Tab
 * 输入: routeStore (服务器配置/模型选择/统计)
 * 输出: 服务器状态 + CLI 路由配置 + 统计仪表盘
 * 定位: 路由页代理统计子面板
 */

import { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Square,
  Copy,
  KeyRound,
  Loader2,
  Activity,
  BarChart3,
  Edit2,
  RotateCcw,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useRouteStore } from '../../../store/routeStore';
import { toast } from '../../../store/toastStore';
import { AppCard, AppCardContent } from '../../AppCard';
import { AppButton } from '../../AppButton/AppButton';
import { AppInput } from '../../AppInput';
import { buildRecommendedCliModelOptions } from '../Redirection/ModelRedirectionTab';
import {
  normalizeRouteCliSelection,
  type RouteCliType,
  type RouteModelRegistryEntry,
} from '../../../../shared/types/route-proxy';
import {
  generateClaudeCodeConfig,
  generateCodexConfig,
  generateGeminiCliConfig,
  type GeneratedConfig,
} from '../../../services/cli-config-generator';

const CLI_LABELS: Record<RouteCliType, string> = {
  claudeCode: 'Claude Code',
  codex: 'Codex',
  geminiCli: 'Gemini CLI',
};
const ROUTE_PROXY_DISPLAY_NAME = '本地路由代理';

type TimeRange = '24h' | '7d';
const STATS_TIME_RANGES: TimeRange[] = ['24h', '7d'];
type RoutePreviewState = {
  cliType: RouteCliType;
  isEditing: boolean;
  draft: GeneratedConfig | null;
};

/** 代理服务器状态区 */
interface RoutePanelProps {
  className?: string;
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
    return generateClaudeCodeConfig(sharedParams);
  }

  if (cliType === 'codex') {
    return generateCodexConfig(sharedParams);
  }

  return generateGeminiCliConfig(sharedParams);
}

function cloneGeneratedConfig(config: GeneratedConfig): GeneratedConfig {
  return {
    files: config.files.map(file => ({ ...file })),
  };
}

function RouteConfigPreviewModal({
  previewState,
  displayConfig,
  onClose,
  onEdit,
  onChangeFile,
  onSaveEdit,
  onCancelEdit,
  onReset,
}: {
  previewState: RoutePreviewState | null;
  displayConfig: GeneratedConfig | null;
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

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/45 p-6">
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
                <AppButton variant="primary" size="sm" onClick={onSaveEdit}>
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
      className={`fixed z-[260] min-w-[128px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-xl)] transition-opacity duration-100 ${
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
      <button
        type="button"
        onClick={() => onApply(cliType, 'overwrite')}
        disabled={applyingCli !== null}
        className="block w-full border-t border-[var(--line-soft)] px-3 py-2 text-left text-xs text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        覆盖
      </button>
    </div>,
    document.body
  );
}

export function ServerSection({ className = '' }: RoutePanelProps) {
  const { config, serverRunning, saveServerConfig, regenerateApiKey, startServer, stopServer } =
    useRouteStore(
      useShallow(s => ({
        config: s.config,
        serverRunning: s.serverRunning,
        saveServerConfig: s.saveServerConfig,
        regenerateApiKey: s.regenerateApiKey,
        startServer: s.startServer,
        stopServer: s.stopServer,
      }))
    );
  const [toggling, setToggling] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const server = config?.server;

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

  return (
    <AppCard data-testid="route-server-section-card" className={className}>
      <AppCardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[var(--accent)]" />
            <span className="font-medium text-sm">代理服务器</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
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
          </div>
          <AppButton
            variant={serverRunning ? 'secondary' : 'primary'}
            size="sm"
            onClick={handleToggle}
            disabled={toggling}
          >
            {toggling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : serverRunning ? (
              <Square className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span className="ml-1">{serverRunning ? '停止' : '启动'}</span>
          </AppButton>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">端口</label>
            <AppInput
              type="number"
              defaultValue={server.port}
              onBlur={e => {
                const port = parseInt(e.target.value, 10);
                if (!isNaN(port) && port > 0 && port < 65536) saveServerConfig({ port });
              }}
              className="w-full"
              size="sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Base URL</label>
            <div className="rounded bg-[var(--surface-2)] px-2 py-1.5 font-mono text-xs text-[var(--text-secondary)]">
              http://{server.host}:{server.port}
            </div>
          </div>
        </div>

        <div className="mt-3">
          <AppInput
            label="上游代理"
            size="sm"
            defaultValue={server.upstreamProxyUrl || ''}
            placeholder="http://127.0.0.1:7890"
            onBlur={e => saveServerConfig({ upstreamProxyUrl: e.target.value.trim() })}
            className="font-mono text-xs"
          />
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-xs text-[var(--text-secondary)]">路由 API Key</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 truncate rounded bg-[var(--surface-2)] px-2 py-1.5 font-mono text-xs text-[var(--text-secondary)]">
              {showKey ? server.unifiedApiKey : '••••••••••••••••'}
            </div>
            <button
              onClick={() => setShowKey(!showKey)}
              className="text-xs text-[var(--accent)] hover:underline"
            >
              {showKey ? '隐藏' : '显示'}
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(server.unifiedApiKey);
                toast.success('已复制');
              }}
              title="复制"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-3)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              onClick={async () => {
                const k = await regenerateApiKey();
                if (k) toast.success('已重新生成');
              }}
              title="重新生成"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-3)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
            >
              <KeyRound className="h-4 w-4" />
            </button>
          </div>
        </div>
      </AppCardContent>
    </AppCard>
  );
}

/** CLI 路由配置区 */
export function CliModelSection({ className = '' }: RoutePanelProps) {
  const { config, saveCliModelSelections } = useRouteStore(
    useShallow(s => ({
      config: s.config,
      saveCliModelSelections: s.saveCliModelSelections,
    }))
  );
  const [previewState, setPreviewState] = useState<RoutePreviewState | null>(null);
  const [editedPreviews, setEditedPreviews] = useState<
    Partial<Record<RouteCliType, GeneratedConfig | null>>
  >({});
  const [applyMenuCli, setApplyMenuCli] = useState<RouteCliType | null>(null);
  const [applyingCli, setApplyingCli] = useState<RouteCliType | null>(null);
  const applyButtonRefs = useRef<Partial<Record<RouteCliType, HTMLButtonElement | null>>>({});
  const modelOptions = useMemo(
    () => buildRecommendedCliModelOptions(config?.modelRegistry),
    [config?.modelRegistry]
  );

  if (!config || !config.server) return null;

  const { cliModelSelections, server } = config;
  const normalizedCliSelections = Object.fromEntries(
    (['claudeCode', 'codex', 'geminiCli'] as RouteCliType[]).map(cli => [
      cli,
      resolveCliSelectionDisplayValue(cliModelSelections?.[cli], modelOptions),
    ])
  ) as Record<RouteCliType, string>;
  const generatedConfigs = Object.fromEntries(
    (['claudeCode', 'codex', 'geminiCli'] as RouteCliType[]).map(cli => [
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

  const handleChange = (cli: RouteCliType, value: string) => {
    setPreviewState(current => (current?.cliType === cli ? null : current));
    setEditedPreviews(prev => ({
      ...prev,
      [cli]: null,
    }));
    setApplyMenuCli(null);
    saveCliModelSelections({ [cli]: value || null });
  };

  const handleApplyRouteConfig = async (cli: RouteCliType, applyMode: 'merge' | 'overwrite') => {
    const generatedConfig = editedPreviews[cli] ?? generatedConfigs[cli];
    if (!generatedConfig || applyingCli) {
      return;
    }

    setApplyingCli(cli);
    try {
      const result = await window.electronAPI.cliCompat.writeConfig({
        cliType: cli,
        files: generatedConfig.files.map(file => ({
          path: file.path,
          content: file.content,
        })),
        applyMode,
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

  return (
    <>
      <AppCard data-testid="route-cli-model-section-card" className={className}>
        <AppCardContent className="p-4">
          <div className="mb-4">
            <div className="text-sm font-medium text-[var(--text-primary)]">CLI 路由配置</div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              为 Claude Code、Codex 和 Gemini CLI 选择默认模型，并预览或写入本地配置。
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {(['claudeCode', 'codex', 'geminiCli'] as RouteCliType[]).map(cli => (
              <div key={cli} className="space-y-2">
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                  {CLI_LABELS[cli]}
                </label>
                <select
                  value={normalizedCliSelections[cli]}
                  onChange={e => handleChange(cli, e.target.value)}
                  className="w-full rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
                >
                  <option value="">未选择</option>
                  {modelOptions.map(entry => (
                    <option key={entry.canonicalName} value={entry.canonicalName}>
                      {entry.canonicalName}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <AppButton
                    variant="secondary"
                    size="sm"
                    className="h-8 flex-1"
                    onClick={() => handleOpenPreview(cli)}
                    disabled={!generatedConfigs[cli]}
                    aria-label={`预览 ${CLI_LABELS[cli]} 路由配置`}
                  >
                    预览
                  </AppButton>
                  <div className="flex-1">
                    <AppButton
                      ref={element => {
                        applyButtonRefs.current[cli] = element;
                      }}
                      variant="secondary"
                      size="sm"
                      className="h-8 w-full"
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
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          应用中
                        </>
                      ) : (
                        '应用'
                      )}
                    </AppButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </AppCardContent>
      </AppCard>

      <RouteConfigPreviewModal
        previewState={previewState}
        displayConfig={previewConfig}
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
    </>
  );
}

/** 统计仪表盘（首次加载后缓存） */
export function StatsDashboard({ className = '' }: RoutePanelProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef<Record<string, any>>({});

  useEffect(() => {
    if (loadedRef.current[timeRange]) {
      setSummary(loadedRef.current[timeRange]);
      return;
    }
    loadStats();
  }, [timeRange]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const res = await window.electronAPI.route?.getAnalyticsSummary({ window: timeRange });
      if (res?.success) {
        loadedRef.current[timeRange] = res.data;
        setSummary(res.data);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppCard className={`h-fit self-start ${className}`}>
      <AppCardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[var(--accent)]" />
            <span className="font-medium text-sm">数据统计</span>
          </div>
          <div className="flex gap-1">
            {STATS_TIME_RANGES.map(r => (
              <AppButton
                key={r}
                variant={timeRange === r ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setTimeRange(r)}
              >
                {r}
              </AppButton>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
          </div>
        ) : summary ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <StatRow label="总请求" value={summary.totalRequests} />
              <StatRow
                label="成功率"
                value={`${summary.successRate}%`}
                color={
                  summary.successRate >= 80 ? 'green' : summary.successRate >= 50 ? 'yellow' : 'red'
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatRow label="Prompt Tokens" value={formatNumber(summary.promptTokens)} />
              <StatRow label="Completion Tokens" value={formatNumber(summary.completionTokens)} />
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-[var(--text-secondary)]">暂无统计数据</div>
        )}
      </AppCardContent>
    </AppCard>
  );
}

function StatRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  const colorClass =
    color === 'green'
      ? 'text-[var(--success)]'
      : color === 'red'
        ? 'text-[var(--danger)]'
        : color === 'yellow'
          ? 'text-[var(--warning)]'
          : 'text-[var(--text-primary)]';

  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className={`text-sm font-semibold ${colorClass}`}>{value}</div>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function ProxyStatsTab() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-2">
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(360px,1.08fr)] xl:items-stretch">
          <ServerSection className="h-full self-stretch" />
          <CliModelSection className="h-full self-stretch" />
        </div>
        <StatsDashboard />
      </div>
    </div>
  );
}
