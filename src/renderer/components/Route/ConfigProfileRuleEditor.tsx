import {
  createFile,
  encodeTarget,
  decodeTarget,
  renderTemplatePreview,
} from './config-profile-view';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FilePlus2,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import type {
  ConfigFileAuthMode,
  ConfigFileDefinition,
  ConfigFileProfile,
  ConfigFileResolvedTargetValues,
  ConfigFileSnapshot,
  ConfigFileTargetCatalogEntry,
} from '../../../shared/types/config-file-profile';

import { AppButton } from '../AppButton/AppButton';

import { AppInput } from '../AppInput/AppInput';
import { AppSelect } from '../AppSelect';
import { AgentLogoSelect } from '../AgentLogo';

import {
  buildDshModelTemplate,
  getDshWriteModels,
  isDshConfigProfile,
} from '../../../shared/config/dsh-client-config';

export const CREDENTIAL_ICON_BUTTON_CLASS =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-2)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50';

export function RuleEditor(props: {
  profile: ConfigFileProfile;
  advancedActions?: ReactNode;
  catalog: ConfigFileTargetCatalogEntry[];
  currentEntry?: ConfigFileTargetCatalogEntry;
  showAll: boolean;
  models: string[];
  snapshots: ConfigFileSnapshot[];
  edits: Record<string, string>;
  onSelectScope: (showAll: boolean) => void;
  onUpdate: (update: (profile: ConfigFileProfile) => ConfigFileProfile) => void;
  routeKeyVisible: boolean;
  onToggleRouteKey: () => void;
  onGenerateRouteKey: () => void;
  onCopyRouteKey: () => void;
  onUpdateFile: (fileId: string, updates: Partial<ConfigFileDefinition>) => void;
  onRequestAuthMode: (authMode: ConfigFileAuthMode) => void;
  onReadLocal: () => void;
  onEditLocal: (fileId: string, content: string) => void;
  onSaveLocal: () => void;
  canBrowseBackups: boolean;
  onShowBackups: (fileId: string) => void;
  onRequestDeleteFile: (fileId: string) => void;
}) {
  const { profile } = props;
  const isDsh = isDshConfigProfile(profile);
  const authMode = profile.authMode ?? 'third-party';
  const isOfficial = authMode === 'official';
  const [resolvedValues, setResolvedValues] = useState<ConfigFileResolvedTargetValues | null>(null);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  /**
   * 配置模板默认隐藏：点击文件行内的「配置模板」按钮才展开，
   * 展开后该文件的三个面板为 1 行 3 列（模板 / 预览 / 本地配置）。
   */
  const [expandedTemplateFiles, setExpandedTemplateFiles] = useState<Record<string, boolean>>({});
  const toggleTemplateFile = (fileId: string) =>
    setExpandedTemplateFiles(current => ({ ...current, [fileId]: !current[fileId] }));
  const unavailableTarget = !props.currentEntry || !props.currentEntry.available;
  const selectedKey = profile.target.kind === 'managed' ? profile.target.apiKeyId : undefined;

  // 解析结果只依赖 target 与本地路由凭证；按稳定 key 触发，避免名称/模板/路径每次编辑都重置并重发 IPC
  const resolveKey = useMemo(() => {
    const target = profile.target;
    const scope =
      target.kind === 'managed'
        ? `managed:${target.siteId}:${target.accountId}:${target.apiKeyId ?? ''}`
        : target.kind === 'direct'
          ? `direct:${target.configId}`
          : `local-route:${profile.localRouteCredential?.apiKey ?? ''}`;
    return `${scope}:${target.model ?? ''}:${JSON.stringify(profile.dsh)}`;
  }, [profile.target, profile.localRouteCredential?.apiKey, profile.dsh]);

  useEffect(() => {
    let active = true;
    setResolvedValues(null);
    setApiKeyVisible(false);
    if (isOfficial || !props.currentEntry?.available) return () => undefined;
    void window.electronAPI.configFileProfiles
      .resolveValues({ profile })
      .then(values => {
        if (active) setResolvedValues(values);
      })
      .catch(() => {
        if (active) setResolvedValues(null);
      });
    return () => {
      active = false;
    };
    // resolveKey 已覆盖全部影响解析结果的输入；profile 仅用于透传给 IPC
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveKey, props.currentEntry]);

  const targetValues = resolvedValues || { baseUrl: '', apiKey: '', model: '' };

  return (
    <div className="space-y-3 p-3">
      {profile.isExample && !isDsh ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
          <div>
            <span className="text-sm font-semibold">接入方式</span>
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
              {isOfficial
                ? '使用客户端官方账号登录，无需站点 API Key'
                : '使用第三方 API 站点或本地路由'}
            </p>
          </div>
          <div
            role="group"
            aria-label="接入方式"
            className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--line-soft)] p-0.5"
          >
            {(['third-party', 'official'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                aria-pressed={authMode === mode}
                onClick={() => {
                  if (authMode !== mode) props.onRequestAuthMode(mode);
                }}
                className={`rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs transition-colors ${
                  authMode === mode
                    ? 'bg-[var(--surface-3)] font-medium text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {mode === 'third-party' ? '第三方 API' : '官方账号登录'}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <section className="space-y-2">
        <div className="flex items-center justify-between border-b border-[var(--line-muted)] pb-1.5">
          <div>
            <h3 className="text-sm font-semibold">基本信息</h3>
          </div>
          {!isOfficial && unavailableTarget ? (
            <span className="text-xs text-[var(--danger)]">
              {props.currentEntry?.unavailableReason || '目标需要重新选择'}
            </span>
          ) : null}
        </div>
        <div className="grid min-w-0 items-end gap-2 md:grid-cols-2 xl:grid-cols-[2fr_1.2fr_1.8fr_1fr]">
          <div className="grid min-w-0 grid-cols-2 items-end gap-2">
            <div className="min-w-0">
              <AppInput
                size="sm"
                label="名称"
                aria-label="配置名称"
                value={profile.name}
                onChange={event => props.onUpdate(item => ({ ...item, name: event.target.value }))}
              />
            </div>
            <div className="min-w-0 space-y-1">
              <span className="block text-sm font-medium text-[var(--text-primary)]">Logo</span>
              <AgentLogoSelect
                value={profile.agentLogoId}
                agentId={profile.builtin?.clientType}
                agentName={profile.name}
                ariaLabel={`${profile.name} Logo`}
                onChange={agentLogoId => props.onUpdate(item => ({ ...item, agentLogoId }))}
              />
            </div>
          </div>
          {isOfficial ? (
            <div className="min-w-0 md:col-span-2 xl:col-span-3">
              <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--line-soft)] px-3 py-2.5 text-xs leading-5 text-[var(--text-tertiary)]">
                官方账号登录由客户端自行完成（首次使用请运行 claude / codex login / opencode auth
                login / grok login），无需选择站点、API Key 或模型。
              </p>
            </div>
          ) : (
            <>
              {isDsh ? (
                <AppInput size="sm" label="配置目标" value="本地路由" readOnly />
              ) : (
                <AppSelect
                  size="sm"
                  label="配置目标"
                  aria-label={`${profile.name} 目标`}
                  containerClassName="min-w-0"
                  value={encodeTarget(profile.target)}
                  onChange={event =>
                    props.onUpdate(item => ({ ...item, target: decodeTarget(event.target.value) }))
                  }
                >
                  {unavailableTarget ? (
                    <option value={encodeTarget(profile.target)} disabled>
                      当前目标已不可用
                    </option>
                  ) : null}
                  {props.catalog
                    .filter(entry => entry.available)
                    .map(entry => (
                      <option key={entry.value} value={entry.value} disabled={!entry.available}>
                        {entry.label}
                        {!entry.available && entry.unavailableReason
                          ? `（${entry.unavailableReason}）`
                          : ''}
                      </option>
                    ))}
                </AppSelect>
              )}
              <div className="min-w-0 xl:min-w-0">
                {profile.target.kind === 'managed' ? (
                  <div className="flex min-w-0 items-end gap-0.5">
                    <AppSelect
                      size="sm"
                      label="API Key"
                      aria-label={`${profile.name} API Key`}
                      value={selectedKey || ''}
                      containerClassName="min-w-0 flex-1"
                      onChange={event =>
                        props.onUpdate(item => ({
                          ...item,
                          target:
                            item.target.kind === 'managed'
                              ? {
                                  ...item.target,
                                  apiKeyId: event.target.value || undefined,
                                  model: null,
                                }
                              : item.target,
                        }))
                      }
                    >
                      <option value="">选择 API Key</option>
                      {selectedKey &&
                      !props.currentEntry?.apiKeys.some(key => key.id === selectedKey) ? (
                        <option value={selectedKey} disabled>
                          当前 API Key 已不可用
                        </option>
                      ) : null}
                      {props.currentEntry?.apiKeys.map(key => (
                        <option key={key.id} value={key.id}>
                          {key.label}
                        </option>
                      ))}
                    </AppSelect>
                    <button
                      type="button"
                      className={`${CREDENTIAL_ICON_BUTTON_CLASS} mb-0.5`}
                      title={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                      aria-label={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                      onClick={() => setApiKeyVisible(current => !current)}
                    >
                      {apiKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                ) : profile.target.kind === 'local-route' ? (
                  <div className="space-y-1">
                    <span className="block text-sm font-medium text-[var(--text-primary)]">
                      API Key
                    </span>
                    <div className="flex min-w-0 gap-0.5">
                      <AppInput
                        size="sm"
                        readOnly
                        className="min-w-0 flex-1 font-mono"
                        containerClassName="min-w-0 flex-1"
                        aria-label={`${profile.name} API Key`}
                        type={props.routeKeyVisible ? 'text' : 'password'}
                        value={profile.localRouteCredential?.apiKey || ''}
                        placeholder="尚未生成独立 API Key"
                      />
                      {profile.localRouteCredential ? (
                        <>
                          <button
                            type="button"
                            className={CREDENTIAL_ICON_BUTTON_CLASS}
                            title={props.routeKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                            aria-label={props.routeKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                            onClick={props.onToggleRouteKey}
                          >
                            {props.routeKeyVisible ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            className={CREDENTIAL_ICON_BUTTON_CLASS}
                            title="复制 API Key"
                            aria-label="复制 API Key"
                            onClick={props.onCopyRouteKey}
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        className={CREDENTIAL_ICON_BUTTON_CLASS}
                        title={profile.localRouteCredential ? '重新生成 API Key' : '生成 API Key'}
                        aria-label={
                          profile.localRouteCredential ? '重新生成 API Key' : '生成 API Key'
                        }
                        onClick={props.onGenerateRouteKey}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <span className="block text-sm font-medium text-[var(--text-primary)]">
                      API Key
                    </span>
                    <div className="flex items-center gap-0.5">
                      <div className="flex h-9 min-w-0 flex-1 items-center truncate rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 font-mono text-xs text-[var(--text-secondary)]">
                        {resolvedValues?.apiKeyName ||
                          (profile.target.kind === 'direct' ? '直连 API Key' : '未选择 API Key')}
                      </div>
                      <button
                        type="button"
                        className={`${CREDENTIAL_ICON_BUTTON_CLASS} mb-0.5`}
                        title={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                        aria-label={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                        onClick={() => setApiKeyVisible(current => !current)}
                      >
                        {apiKeyVisible ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-end gap-2">
                <AppSelect
                  size="sm"
                  label={isDsh ? '默认模型' : '模型'}
                  aria-label={`${profile.name} 模型`}
                  value={profile.target.model || ''}
                  onChange={event =>
                    props.onUpdate(item => ({
                      ...item,
                      target: { ...item.target, model: event.target.value || null },
                    }))
                  }
                  containerClassName="min-w-0 flex-1"
                >
                  <option value="">
                    {isDsh ? `全部模型（${props.models.length} 个）` : '选择模型'}
                  </option>
                  {props.models.map(model => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </AppSelect>
                {profile.target.kind === 'managed' ? (
                  <div
                    role="group"
                    aria-label="模型显示范围"
                    className="flex shrink-0 items-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] text-xs"
                  >
                    <button
                      type="button"
                      aria-pressed={!props.showAll}
                      onClick={() => props.onSelectScope(false)}
                      className={`flex h-9 items-center px-3 transition-colors ${
                        !props.showAll
                          ? 'bg-[var(--surface-3)] font-medium text-[var(--text-primary)]'
                          : 'text-[var(--text-tertiary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]'
                      }`}
                    >
                      按分组
                    </button>
                    <button
                      type="button"
                      aria-pressed={props.showAll}
                      onClick={() => props.onSelectScope(true)}
                      className={`flex h-9 items-center border-l border-[var(--line-soft)] px-3 transition-colors ${
                        props.showAll
                          ? 'bg-[var(--surface-3)] font-medium text-[var(--text-primary)]'
                          : 'text-[var(--text-tertiary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]'
                      }`}
                    >
                      显示全部
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </section>

      {props.advancedActions}

      {!isOfficial && props.currentEntry && (
        <section className="flex flex-wrap gap-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-[var(--text-tertiary)]">{'{{BASE_URL}}'}</span>
            <span className="font-medium text-[var(--text-primary)]">
              {targetValues.baseUrl || '未设置'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-[var(--text-tertiary)]">{'{{API_KEY}}'}</span>
            <span className="font-medium text-[var(--text-primary)]">
              {targetValues.apiKey
                ? profile.target.kind === 'local-route'
                  ? !props.routeKeyVisible
                    ? `${targetValues.apiKey.slice(0, 4)}••••${targetValues.apiKey.slice(-4)}`
                    : targetValues.apiKey
                  : !apiKeyVisible
                    ? `${targetValues.apiKey.slice(0, 4)}••••${targetValues.apiKey.slice(-4)}`
                    : targetValues.apiKey
                : '未设置'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-[var(--text-tertiary)]">{'{{MODEL}}'}</span>
            <span className="font-medium text-[var(--text-primary)]">
              {targetValues.model || '未设置'}
            </span>
          </div>
        </section>
      )}

      <div className="flex items-end justify-between border-b border-[var(--line-muted)] pb-2">
        <div>
          <h3 className="text-sm font-semibold">文件规则</h3>
          <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
            维护模板并对照生成结果与本地内容
          </p>
        </div>
        <AppButton
          variant="tertiary"
          size="sm"
          disabled={isDsh}
          onClick={() =>
            props.onUpdate(item => ({ ...item, files: [...item.files, createFile(item.id)] }))
          }
        >
          <FilePlus2 className="h-4 w-4" />
          添加文件
        </AppButton>
      </div>

      <div className="space-y-3">
        {profile.files.map((file, fileIndex) => {
          const snapshot = props.snapshots.find(item => item.fileId === file.id);
          const template =
            isDsh && fileIndex === 0
              ? buildDshModelTemplate(
                  file.template,
                  getDshWriteModels(profile.target.model, props.models),
                  targetValues.model || profile.target.model || props.models[0] || '{{MODEL}}'
                )
              : file.template;
          const previewContent = template ? renderTemplatePreview(template, targetValues) : '';
          const templateVisible = expandedTemplateFiles[file.id] === true;
          /**
           * 三个面板共用同一高度，并跟随模板内容自适应：
           * text-xs 行高 16px + p-3 上下 24px + 边框 2px；
           * 下限 8 行避免空模板过矮，上限 32 行避免超长模板撑爆弹窗（超出部分内部滚动）。
           */
          const templateLines = Math.max(
            template ? template.split('\n').length : 0,
            previewContent ? previewContent.split('\n').length : 0
          );
          const panelHeight = Math.min(Math.max(templateLines, 8), 32) * 16 + 26;
          return (
            <section
              key={file.id}
              className="rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-3"
            >
              <div className="flex items-center gap-2">
                <h4 className="shrink-0 text-sm font-semibold">文件 {fileIndex + 1}</h4>
                <AppInput
                  size="sm"
                  className="min-w-0 flex-1 font-mono"
                  containerClassName="min-w-0 flex-1"
                  aria-label={`${profile.name} 文件路径`}
                  value={file.path}
                  readOnly={isDsh}
                  placeholder="配置文件路径"
                  onChange={event => props.onUpdateFile(file.id, { path: event.target.value })}
                />
                <AppButton
                  variant="tertiary"
                  size="sm"
                  aria-expanded={templateVisible}
                  title={templateVisible ? '隐藏配置模板' : '显示配置模板'}
                  aria-label={`${profile.name} 文件 ${fileIndex + 1} 配置模板开关`}
                  onClick={() => toggleTemplateFile(file.id)}
                >
                  {templateVisible ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  配置模板
                </AppButton>
                <AppButton
                  variant="tertiary"
                  size="sm"
                  title="删除文件"
                  disabled={isDsh}
                  aria-label={`${profile.name} 删除文件 ${fileIndex + 1}`}
                  onClick={() => props.onRequestDeleteFile(file.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </AppButton>
              </div>
              <div className="mt-3 overflow-x-auto">
                <div
                  className={`grid gap-3 ${
                    templateVisible ? 'min-w-[56rem] grid-cols-3' : 'min-w-[38rem] grid-cols-2'
                  }`}
                >
                  {templateVisible ? (
                    <div className="min-w-0 space-y-2">
                      <span className="flex h-8 items-center text-xs font-medium text-[var(--text-secondary)]">
                        配置模板
                      </span>
                      <textarea
                        aria-label={`${profile.name} 文件模板`}
                        value={template}
                        readOnly={isDsh}
                        style={{ height: panelHeight }}
                        onChange={event =>
                          props.onUpdateFile(file.id, { template: event.target.value })
                        }
                        placeholder="使用 {{BASE_URL}}、{{API_KEY}}、{{MODEL}} 作为占位符"
                        className="w-full resize-none overflow-auto whitespace-pre rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] p-3 font-mono text-xs leading-4 text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                      />
                    </div>
                  ) : null}
                  <div className="min-w-0 space-y-2">
                    <span className="flex h-8 items-center text-xs font-medium text-[var(--text-secondary)]">
                      {isDsh ? '模板示例（实际内容请点预览写入）' : '配置预览'}
                    </span>
                    <pre
                      style={{ height: panelHeight }}
                      className="overflow-auto whitespace-pre rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] p-3 font-mono text-xs leading-4 text-[var(--text-secondary)]"
                    >
                      {template ? previewContent : '选择配置目标并编辑模板后显示预览'}
                    </pre>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div className="flex h-8 items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[var(--text-secondary)]">
                        本地配置
                      </span>
                      <div className="flex items-center gap-1">
                        <AppButton
                          variant="secondary"
                          size="sm"
                          title="保存本地文件修改（预览后写入）"
                          disabled={!snapshot}
                          onClick={props.onSaveLocal}
                        >
                          <Save className="h-3.5 w-3.5" />
                          保存
                        </AppButton>
                        <AppButton
                          variant="tertiary"
                          size="sm"
                          disabled={!props.canBrowseBackups}
                          title="保存配置后可查看备份并预览恢复"
                          onClick={() => props.onShowBackups(file.id)}
                        >
                          备份
                        </AppButton>
                        <AppButton variant="tertiary" size="sm" onClick={props.onReadLocal}>
                          <RefreshCw className="h-3.5 w-3.5" />
                          读取
                        </AppButton>
                      </div>
                    </div>
                    {snapshot ? (
                      <textarea
                        aria-label={`${profile.name} 本地文件 ${file.path}`}
                        value={props.edits[file.id] ?? snapshot.content}
                        onChange={event => props.onEditLocal(file.id, event.target.value)}
                        style={{ height: panelHeight }}
                        className="w-full resize-none overflow-auto whitespace-pre rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] p-3 font-mono text-xs leading-4 text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                      />
                    ) : (
                      <div
                        style={{ height: panelHeight }}
                        className="flex items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--line-soft)] p-5 text-center text-xs text-[var(--text-tertiary)]"
                      >
                        点击「读取」加载本地文件
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          );
        })}
        {profile.files.length === 0 ? (
          <div className="flex min-h-48 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--line-soft)] p-6 text-sm text-[var(--text-tertiary)]">
            添加一个文件后开始编辑
          </div>
        ) : null}
      </div>
    </div>
  );
}
