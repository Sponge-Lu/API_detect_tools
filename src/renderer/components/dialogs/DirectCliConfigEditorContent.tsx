/**
 * @file src/renderer/components/dialogs/DirectCliConfigEditorContent.tsx
 * @description 直连配置 CLI 编辑器内容组件（无 OverlayDrawer 外壳）
 *
 * 输入: DirectCliConfigEditorContentProps (配置对象、保存/取消回调)
 * 输出: React 内容组件 (配置名称、身份信息、模型拉取、按 CLI 聚合的配置/测试/预览/应用)
 * 定位: 展示层 - 嵌入接入点详情面板，维护直连配置且不创建嵌套抽屉
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Copy,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  Loader2,
  Globe,
  Settings,
  ChevronDown,
  ChevronUp,
  Search,
  X,
  Edit2,
  RotateCcw,
  Plus,
  Trash2,
} from 'lucide-react';
import { AppButton } from '../AppButton/AppButton';
import { AppSwitch } from '../AppSwitch';
import { useCustomCliConfigStore } from '../../store/customCliConfigStore';
import { toast } from '../../store/toastStore';
import {
  CUSTOM_CLI_GROUP_MULTIPLIER_MIN,
  normalizeCustomCliGroupMultiplier,
  normalizeCustomCliApiKeys,
  getCustomCliModelGroups,
  normalizeCustomCliSettings,
  type CustomCliApiKey,
  type CustomCliConfig,
  type CustomCliSettings,
} from '../../../shared/types/custom-cli-config';
import { normalizeCircledGroupLabel } from '../../../shared/utils/groupLabel';
import type { ModelPriceInfo, ModelPricingData, RouteAuthScheme } from '../../../shared/types/site';
import {
  BUILTIN_CLI_LABELS,
  BUILTIN_CLI_TYPES,
  CLI_UPSTREAM_PROTOCOLS,
  CLI_TARGET_PROTOCOLS,
  getCliTargetEndpoint,
  normalizeCliTargetProtocol,
  normalizeCliUpstreamProtocolsWithDefault,
  type BuiltinCliType,
  type CliTargetProtocol,
  type CliUpstreamProtocol,
} from '../../../shared/types/cli-config';
import {
  generateClaudeCodeConfig,
  generateCodexConfig,
  generateGrokBuildConfig,
  generateOpenCodeConfig,
  type GeneratedConfig,
} from '../../services/cli-config-generator';
import { PanelSection } from './PanelSection';
import { formatModelPrice, resolveModelPricing } from '../../utils/modelPricing';
import { getGroupTextColor } from '../../utils/groupStyle';
import {
  AccessPointResourceSectionHeader,
  AccessPointResourceShell,
  accessPointFormFieldLabelClass,
  accessPointFormInputClass,
  accessPointResourceActionClass,
  accessPointResourceIconActionClass,
  accessPointResourceListClass,
  accessPointResourceTokenListClass,
  accessPointResourceTokenRowClass,
} from './AccessPointResourcePrimitives';

// 导入 CLI 图标
import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import OpenCodeIcon from '../../assets/cli-icons/opencode.svg';
import GrokBuildIcon from '../../assets/cli-icons/grok.svg';

export interface DirectCliConfigEditorContentProps {
  config: CustomCliConfig;
  section?: 'all' | 'identity' | 'models' | 'cli';
  showHeader?: boolean;
  showSaveAction?: boolean;
  showModelSummary?: boolean;
  identityFormId?: string;
  onSaved?: () => void | Promise<void>;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  showDialog?: (options: {
    type?: 'confirm' | 'warning';
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
  }) => Promise<boolean>;
}

type CliType = BuiltinCliType;
const CLI_TYPE_KEYS: CliType[] = [...BUILTIN_CLI_TYPES];

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return fallback;
}

interface CliTypeConfig {
  key: CliType;
  name: string;
  icon: string;
}

const CLI_TYPES: CliTypeConfig[] = [
  { key: 'claudeCode', name: BUILTIN_CLI_LABELS.claudeCode, icon: ClaudeCodeIcon },
  { key: 'codex', name: BUILTIN_CLI_LABELS.codex, icon: CodexIcon },
  { key: 'openCode', name: BUILTIN_CLI_LABELS.openCode, icon: OpenCodeIcon },
  { key: 'grokBuild', name: BUILTIN_CLI_LABELS.grokBuild, icon: GrokBuildIcon },
];

const CLI_TARGET_PROTOCOL_LABELS: Record<CliTargetProtocol, string> = {
  native: '原生协议',
  'anthropic-messages': 'Anthropic Messages',
  'openai-chat-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
};

const CLI_UPSTREAM_PROTOCOL_LABELS: Record<CliUpstreamProtocol, string> = {
  'anthropic-messages': 'Anthropic Messages',
  'openai-chat-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
};

function buildCliTargetProtocolOptionLabel(
  cliType: CliType,
  targetProtocol: CliTargetProtocol,
  model?: string | null
): string {
  if (cliType === 'grokBuild' && targetProtocol === 'native') {
    return '原生协议 · 跟随 Grok Build 当前模型入口';
  }
  return `${CLI_TARGET_PROTOCOL_LABELS[targetProtocol]} · ${getCliTargetEndpoint(
    cliType,
    targetProtocol,
    model
  )}`;
}

function mergeManualModelName(
  manualModels: string[] | undefined,
  fetchedModels: string[],
  model: string
): string[] {
  const normalizedModel = model.trim();
  const fetchedModelSet = new Set(fetchedModels.map(currentModel => currentModel.trim()));
  const normalizedManualModels = (manualModels ?? [])
    .map(currentModel => currentModel.trim())
    .filter(currentModel => currentModel.length > 0);

  if (!normalizedModel || fetchedModelSet.has(normalizedModel)) {
    return Array.from(new Set(normalizedManualModels));
  }

  return Array.from(new Set([...normalizedManualModels, normalizedModel]));
}

function getModelInputOptions(config: CustomCliConfig): string[] {
  return Array.from(new Set([...(config.models ?? []), ...(config.manualModels ?? [])]));
}

function normalizeModelPricingState(
  pricingData: ModelPricingData | undefined
): Record<string, ModelPriceInfo> {
  return { ...(pricingData?.data ?? {}) };
}

function getQuotaTypeInfo(quotaType: number) {
  if (quotaType === 1) {
    return {
      icon: <span className="text-[10px] font-bold leading-none text-[var(--warning)]">次</span>,
      text: '按次',
      color: 'border-[var(--line-muted)] bg-[var(--warning-soft)] text-[var(--warning)]',
    };
  }

  return {
    icon: <span className="text-[10px] font-bold leading-none text-[var(--accent)]">量</span>,
    text: '按量',
    color: 'border-[var(--line-muted)] bg-[var(--accent-soft)] text-[var(--accent)]',
  };
}

function buildPriceInputValue(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function buildGroupMultiplierInputValue(value: unknown): string {
  return String(normalizeCustomCliGroupMultiplier(value));
}

function parseGroupMultiplierInput(value: string): number {
  if (!value.trim()) {
    return normalizeCustomCliGroupMultiplier(undefined);
  }
  return normalizeCustomCliGroupMultiplier(Number(value));
}

function parseOptionalPrice(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function serializeApiKeys(apiKeys: CustomCliApiKey[]): string {
  return JSON.stringify(
    apiKeys.map(({ name, key, group, groupMultiplier, models, lastModelFetch }) => ({
      name,
      key,
      group,
      groupMultiplier,
      models,
      lastModelFetch,
    }))
  );
}

function DirectModelPriceEditor({
  model,
  groups,
  pricing,
  onChange,
  onRemove,
}: {
  model: string;
  groups: string[];
  pricing?: ModelPriceInfo;
  onChange: (model: string, price: ModelPriceInfo) => void;
  onRemove: (model: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const resolved = resolveModelPricing(pricing);
  const isPerCall = resolved.mode === 'perCall';
  const quotaType = isPerCall ? 1 : 0;
  const quotaInfo = pricing ? getQuotaTypeInfo(quotaType) : null;

  const updateMode = (nextMode: 'token' | 'perCall') => {
    if (nextMode === 'perCall') {
      onChange(model, {
        quota_type: 1,
        type: 'times',
        input: pricing?.input,
      });
      return;
    }

    onChange(model, {
      quota_type: 0,
      type: 'tokens',
      input: pricing?.input,
      output: pricing?.output,
    });
  };

  const updateTokenPrice = (field: 'input' | 'output', value: string) => {
    const parsed = parseOptionalPrice(value);
    const next: ModelPriceInfo = {
      ...(pricing ?? {}),
      quota_type: 0,
      type: 'tokens',
      [field]: parsed,
    };
    if (next.input === undefined) delete next.input;
    if (next.output === undefined) delete next.output;
    onChange(model, next);
  };

  const updateCallPrice = (value: string) => {
    const parsed = parseOptionalPrice(value);
    const next: ModelPriceInfo = {
      quota_type: 1,
      type: 'times',
      input: parsed,
    };
    if (next.input === undefined) delete next.input;
    onChange(model, next);
  };

  return (
    <div
      className={`${expanded ? 'w-full' : 'max-w-full'} rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-3)] px-1.5 py-0.5 transition-colors hover:border-[color-mix(in_srgb,var(--accent)_40%,var(--line-soft))] hover:bg-[var(--surface-1)]`}
      data-testid="direct-model-item"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className="truncate font-mono text-xs font-medium text-[var(--text-primary)]"
              title={model}
            >
              {model}
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1 text-xs">
            {groups.map(group => (
              <span key={group} className={`font-medium ${getGroupTextColor(group)}`}>
                {group}
              </span>
            ))}
            {quotaInfo ? (
              <span
                className={`inline-flex items-center rounded border px-0.5 py-0 leading-none ${quotaInfo.color}`}
                title={quotaInfo.text}
              >
                {quotaInfo.icon}
              </span>
            ) : null}
            {pricing ? (
              <span className="flex shrink-0 items-center gap-1 text-xs">
                {isPerCall ? (
                  <span className="font-semibold text-[var(--warning)]">
                    ${resolved.callPrice !== null ? formatModelPrice(resolved.callPrice) : '—'}/次
                  </span>
                ) : (
                  <>
                    {resolved.inputPrice !== null ? (
                      <span className="font-semibold text-[var(--success)]">
                        ↑${formatModelPrice(resolved.inputPrice)}
                      </span>
                    ) : null}
                    {resolved.outputPrice !== null ? (
                      <span className="font-semibold text-[var(--accent)]">
                        ↓${formatModelPrice(resolved.outputPrice)}
                      </span>
                    ) : null}
                    {resolved.inputPrice === null && resolved.outputPrice === null ? (
                      <span className="text-[var(--text-tertiary)]">价格未完整</span>
                    ) : null}
                  </>
                )}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded(prev => !prev)}
            className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
            aria-label={
              expanded
                ? `收起 ${model} 价格编辑`
                : pricing
                  ? `编辑 ${model} 价格`
                  : `添加 ${model} 价格`
            }
            title={expanded ? '收起' : pricing ? '编辑价格' : '添加价格'}
          >
            {expanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : pricing ? (
              <Edit2 className="h-3 w-3" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-1.5 space-y-2 border-t border-[var(--line-soft)] pt-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[var(--text-secondary)]">计费模式</span>
            <button
              type="button"
              onClick={() => updateMode('token')}
              className={`rounded-[var(--radius-sm)] border px-2 py-1 ${!isPerCall ? 'border-transparent bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--line-soft)] text-[var(--text-secondary)]'}`}
            >
              按量
            </button>
            <button
              type="button"
              onClick={() => updateMode('perCall')}
              className={`rounded-[var(--radius-sm)] border px-2 py-1 ${isPerCall ? 'border-transparent bg-[var(--warning-soft)] text-[var(--warning)]' : 'border-[var(--line-soft)] text-[var(--text-secondary)]'}`}
            >
              按次
            </button>
            {pricing ? (
              <button
                type="button"
                onClick={() => onRemove(model)}
                className="ml-auto rounded-[var(--radius-sm)] px-1.5 py-0.5 text-xs text-[var(--danger)] hover:bg-[var(--danger-soft)]"
              >
                移除价格
              </button>
            ) : null}
          </div>

          {isPerCall ? (
            <label className="block text-xs text-[var(--text-secondary)]">
              单次调用价格 ($/次)
              <input
                type="number"
                min="0"
                step="0.000001"
                value={buildPriceInputValue(pricing?.input ?? pricing?.output)}
                onChange={event => updateCallPrice(event.target.value)}
                placeholder="例如 0.01"
                className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--accent)]"
              />
            </label>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs text-[var(--text-secondary)]">
                输入价格 ($/1M tokens)
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={buildPriceInputValue(pricing?.input)}
                  onChange={event => updateTokenPrice('input', event.target.value)}
                  placeholder="例如 3"
                  className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--accent)]"
                />
              </label>
              <label className="block text-xs text-[var(--text-secondary)]">
                输出价格 ($/1M tokens)
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={buildPriceInputValue(pricing?.output)}
                  onChange={event => updateTokenPrice('output', event.target.value)}
                  placeholder="例如 15"
                  className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--accent)]"
                />
              </label>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

const normalizeCliSetting = (setting?: CustomCliSettings | null): CustomCliSettings => {
  return normalizeCustomCliSettings(setting);
};

const normalizeCliSettings = (
  settings: Partial<CustomCliConfig['cliSettings']>
): CustomCliConfig['cliSettings'] =>
  Object.fromEntries(
    CLI_TYPE_KEYS.map(cliType => [cliType, normalizeCliSetting(settings[cliType])])
  ) as CustomCliConfig['cliSettings'];

function buildPerCliEditedFromSettings(
  cliSettings: CustomCliConfig['cliSettings']
): Record<CliType, GeneratedConfig | null> {
  const initEdited: Record<CliType, GeneratedConfig | null> = {
    claudeCode: null,
    codex: null,
    openCode: null,
    grokBuild: null,
  };

  for (const key of CLI_TYPE_KEYS) {
    const saved = cliSettings[key]?.editedFiles;
    if (saved && saved.length > 0) {
      initEdited[key] = {
        files: saved.map(file => ({
          ...file,
          language: file.path.toLowerCase().endsWith('.toml') ? 'toml' : 'json',
        })),
      };
    }
  }

  return initEdited;
}

function serializeEditedFiles(
  files: Array<{ path: string; content: string }> | null | undefined
): string {
  if (!files || files.length === 0) {
    return '';
  }

  return JSON.stringify(
    files
      .map(file => ({ path: file.path, content: file.content }))
      .sort((left, right) => left.path.localeCompare(right.path))
  );
}

function isDirectCliConfigDirty(params: {
  config: CustomCliConfig;
  name: string;
  baseUrl: string;
  modelUrl: string;
  apiKey: string;
  routeTargetProtocol: CliTargetProtocol;
  routeAuthScheme?: RouteAuthScheme;
  supportedProtocols?: CliUpstreamProtocol[];
  apiKeys: CustomCliApiKey[];
  gasStationUrl: string;
  groupMultiplierInput: string;
  notes: string;
  manualModels: string[];
  modelPricing: Record<string, ModelPriceInfo>;
  cliSettings: CustomCliConfig['cliSettings'];
  perCliEdited: Record<CliType, GeneratedConfig | null>;
  selectedCli: CliType | null;
  editedConfig: GeneratedConfig | null;
}): boolean {
  const {
    config,
    name,
    baseUrl,
    modelUrl,
    apiKey,
    routeTargetProtocol,
    routeAuthScheme,
    supportedProtocols,
    apiKeys,
    gasStationUrl,
    groupMultiplierInput,
    notes,
    manualModels,
    modelPricing,
    cliSettings,
    perCliEdited,
    selectedCli,
    editedConfig,
  } = params;

  if ((name.trim() || config.name) !== config.name) return true;
  if (baseUrl !== config.baseUrl) return true;
  if (routeTargetProtocol !== normalizeCliTargetProtocol(config.routeTargetProtocol)) return true;
  if (config.routeTargetProtocolNeedsConfirmation) return true;
  if ((routeAuthScheme || undefined) !== (config.routeAuthScheme || undefined)) return true;
  if (
    JSON.stringify(normalizeCliUpstreamProtocolsWithDefault(supportedProtocols)) !==
    JSON.stringify(normalizeCliUpstreamProtocolsWithDefault(config.supportedProtocols))
  ) {
    return true;
  }
  if ((modelUrl.trim() || '') !== (config.modelUrl || '')) return true;
  if (apiKey !== config.apiKey) return true;
  if (
    serializeApiKeys(apiKeys) !==
    serializeApiKeys(
      normalizeCustomCliApiKeys(config.apiKeys, {
        legacyApiKey: config.apiKey,
        legacyName: config.name,
        legacyGroupMultiplier: config.groupMultiplier,
      })
    )
  )
    return true;
  if ((gasStationUrl.trim() || '') !== (config.gasStationUrl || '')) return true;
  if (
    parseGroupMultiplierInput(groupMultiplierInput) !==
    normalizeCustomCliGroupMultiplier(config.groupMultiplier)
  ) {
    return true;
  }
  if ((notes || '') !== (config.notes || '')) return true;
  if (JSON.stringify(manualModels) !== JSON.stringify(config.manualModels || [])) return true;
  if (
    JSON.stringify(modelPricing) !== JSON.stringify(normalizeModelPricingState(config.modelPricing))
  ) {
    return true;
  }

  const baselineSettings = normalizeCliSettings(config.cliSettings);
  const finalPerCliEdited = { ...perCliEdited };
  if (selectedCli && editedConfig) {
    finalPerCliEdited[selectedCli] = editedConfig;
  }

  for (const key of CLI_TYPE_KEYS) {
    const current = normalizeCliSetting(cliSettings[key]);
    const baseline = baselineSettings[key];
    if (current.enabled !== baseline.enabled) return true;
    if ((current.model || null) !== (baseline.model || null)) return true;
    if ((current.targetProtocol || undefined) !== (baseline.targetProtocol || undefined)) {
      return true;
    }
    const edited = finalPerCliEdited[key];
    const currentEdited = edited
      ? edited.files.map(file => ({ path: file.path, content: file.content }))
      : (current.editedFiles ?? null);
    if (serializeEditedFiles(currentEdited) !== serializeEditedFiles(baseline.editedFiles)) {
      return true;
    }
  }

  return false;
}

/** 中性风格 Toggle Switch 组件 */
function FormSwitch({
  checked,
  onChange,
  disabled = false,
  size = 'md',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <AppSwitch
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      ariaLabel="启用该 CLI"
      size={size}
    />
  );
}

/** 配置文件显示组件 - 支持预览和编辑模式 */
function ConfigFileDisplay({
  file,
  onCopy,
  copiedPath,
  isEditing,
  onContentChange,
}: {
  file: { path: string; content: string };
  onCopy: (path: string, content: string) => void;
  copiedPath: string | null;
  isEditing: boolean;
  onContentChange: (path: string, content: string) => void;
}) {
  const isCopied = copiedPath === file.path;
  const lineCount = file.content.split('\n').length;
  const contentHeight = Math.max(lineCount * 1.5, 6);

  const codeBlockBg = 'bg-[var(--code-bg)]';
  const codeTextColor = 'text-[var(--code-text)]';

  return (
    <div className="border border-[var(--line-soft)] rounded-[var(--radius-md)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--surface-2)] border-b border-[var(--line-soft)]">
        <code className="text-sm font-mono text-[var(--text-primary)]">{file.path}</code>
        <button
          onClick={() => onCopy(file.path, file.content)}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] hover:bg-[var(--surface-1)] active:scale-95 transition-all"
        >
          {isCopied ? (
            <>
              <Check className="w-3.5 h-3.5 text-[var(--success)]" />
              <span className="text-[var(--success)]">已复制</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <span className="text-[var(--text-secondary)]">复制</span>
            </>
          )}
        </button>
      </div>
      {isEditing ? (
        <textarea
          value={file.content}
          onChange={e => onContentChange(file.path, e.target.value)}
          className={`w-full p-3 text-sm font-mono ${codeBlockBg} ${codeTextColor} border-none resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent)]`}
          style={{ height: `${contentHeight}rem` }}
          spellCheck={false}
        />
      ) : (
        <pre
          className={`p-3 text-sm font-mono ${codeBlockBg} overflow-x-auto whitespace-pre-wrap`}
          style={{ minHeight: `${contentHeight}rem` }}
        >
          <code className={codeTextColor}>{file.content}</code>
        </pre>
      )}
    </div>
  );
}

/** 单个 CLI 的模型选择下拉框 */
function CliModelSelector({
  models,
  selectedModel,
  onSelect,
  disabled,
  ariaLabel,
}: {
  models: string[];
  selectedModel: string | null;
  onSelect: (model: string | null) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!query) return models;
    return models.filter(m => m.toLowerCase().includes(query.toLowerCase()));
  }, [models, query]);
  const manualCandidate = query.trim();
  const canUseManualCandidate = manualCandidate.length > 0 && !models.includes(manualCandidate);

  return (
    <div className="relative min-w-0 flex-1" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen(!open)}
        className={`flex w-full min-w-0 items-center justify-between rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)] ${
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-[var(--text-tertiary)]'
        }`}
      >
        <span
          className={`truncate ${selectedModel ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}
        >
          {selectedModel || '选择模型'}
        </span>
        <ChevronDown
          className={`ml-2 h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="absolute z-[var(--z-dropdown)] w-full mt-1 bg-[var(--surface-1)] border border-[var(--line-soft)] rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] overflow-hidden">
          <div className="p-1.5 border-b border-[var(--line-soft)]">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && manualCandidate) {
                    e.preventDefault();
                    onSelect(manualCandidate);
                    setOpen(false);
                    setQuery('');
                  }
                  if (e.key === 'Escape') {
                    setOpen(false);
                  }
                }}
                placeholder="搜索模型..."
                className="w-full pl-7 pr-7 py-1 bg-[var(--surface-1)] border border-[var(--line-soft)] rounded-[var(--radius-sm)] text-xs text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--accent)] focus:border-transparent"
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                >
                  <X className="w-3.5 h-3.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]" />
                </button>
              )}
            </div>
          </div>
          {canUseManualCandidate && (
            <button
              type="button"
              onClick={() => {
                onSelect(manualCandidate);
                setOpen(false);
                setQuery('');
              }}
              className="w-full border-b border-[var(--line-soft)] px-3 py-2 text-left text-xs text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
            >
              使用手动模型：<span className="font-medium">{manualCandidate}</span>
            </button>
          )}
          <div className="max-h-40 overflow-y-auto">
            {filtered.length > 0 ? (
              filtered.map(model => (
                <button
                  key={model}
                  type="button"
                  onClick={() => {
                    onSelect(model);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                    selectedModel === model
                      ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--surface-1)]'
                  }`}
                >
                  {model}
                </button>
              ))
            ) : (
              <div className="px-3 py-3 text-xs text-[var(--text-secondary)] text-center">
                {models.length === 0 ? '请先拉取模型' : '无匹配结果'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 直连配置 CLI 编辑器内容
 */
export function DirectCliConfigEditorContent({
  config,
  section = 'all',
  showHeader = true,
  showSaveAction = true,
  showModelSummary = true,
  identityFormId,
  onSaved,
  onCancel,
  onDirtyChange,
  showDialog,
}: DirectCliConfigEditorContentProps) {
  const { updateConfig, saveConfigs, fetchModels, fetchingModels } = useCustomCliConfigStore();

  // 本地编辑状态
  const [name, setName] = useState(config.name);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [modelUrl, setModelUrl] = useState(config.modelUrl || '');
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [routeTargetProtocol, setRouteTargetProtocol] = useState<CliTargetProtocol>(() =>
    normalizeCliTargetProtocol(config.routeTargetProtocol)
  );
  const [routeAuthScheme, setRouteAuthScheme] = useState<RouteAuthScheme | undefined>(
    config.routeAuthScheme
  );
  const [supportedProtocols, setSupportedProtocols] = useState<CliUpstreamProtocol[]>(() =>
    normalizeCliUpstreamProtocolsWithDefault(config.supportedProtocols)
  );
  const [apiKeys, setApiKeys] = useState<CustomCliApiKey[]>(() =>
    normalizeCustomCliApiKeys(config.apiKeys, {
      legacyApiKey: config.apiKey,
      legacyName: config.name,
      legacyGroupMultiplier: config.groupMultiplier,
    })
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const [gasStationUrl, setGasStationUrl] = useState(config.gasStationUrl || '');
  const [groupMultiplierInput, setGroupMultiplierInput] = useState(() =>
    buildGroupMultiplierInputValue(config.groupMultiplier)
  );
  const [notes, setNotes] = useState(config.notes || '');
  const [manualModels, setManualModels] = useState<string[]>(config.manualModels || []);
  const [manualModelInput, setManualModelInput] = useState('');
  const [modelSearchText, setModelSearchText] = useState('');
  const [modelPricing, setModelPricing] = useState<Record<string, ModelPriceInfo>>(() =>
    normalizeModelPricingState(config.modelPricing)
  );
  const [cliSettings, setCliSettings] = useState<CustomCliConfig['cliSettings']>(() =>
    normalizeCliSettings(config.cliSettings)
  );
  const [selectedCli, setSelectedCli] = useState<CliType | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // 编辑模式状态
  const [editedConfig, setEditedConfig] = useState<GeneratedConfig | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // 每个 CLI 的编辑配置缓存（切换 CLI 时保留）
  const [perCliEdited, setPerCliEdited] = useState<Record<CliType, GeneratedConfig | null>>({
    claudeCode: null,
    codex: null,
    openCode: null,
    grokBuild: null,
  });
  const [applyingCli, setApplyingCli] = useState<CliType | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  // 获取当前配置的模型列表 (从 store 中实时获取以反映拉取结果)
  const { configs } = useCustomCliConfigStore();
  const currentConfig = configs.find(c => c.id === config.id);
  const models = currentConfig?.models || config.models;
  const currentApiKeys = useMemo(
    () =>
      normalizeCustomCliApiKeys(apiKeys, {
        legacyApiKey: apiKey,
        legacyName: name,
        legacyGroupMultiplier: config.groupMultiplier,
      }),
    [apiKey, apiKeys, config.groupMultiplier, name]
  );
  const existingKeyGroupOptions = useMemo(
    () =>
      Array.from(
        new Set(
          apiKeys
            .map(item => normalizeCircledGroupLabel(item.group))
            .filter(group => group.length > 0)
        )
      ),
    [apiKeys]
  );
  const keyGroupListId = `direct-key-group-options-${config.id}`;
  const modelOptions = useMemo(
    () =>
      getModelInputOptions({
        ...(currentConfig ?? config),
        models,
        manualModels,
      }),
    [config, currentConfig, manualModels, models]
  );
  const fetchedModelOptions = useMemo(
    () => Array.from(new Set(models.map(model => model.trim()).filter(Boolean))),
    [models]
  );
  const normalizedModelSearchText = modelSearchText.trim().toLowerCase();
  const filteredFetchedModelOptions = useMemo(() => {
    if (!normalizedModelSearchText) {
      return fetchedModelOptions;
    }

    return fetchedModelOptions.filter(model =>
      model.toLowerCase().includes(normalizedModelSearchText)
    );
  }, [fetchedModelOptions, normalizedModelSearchText]);

  // 重置状态
  useEffect(() => {
    setName(config.name);
    setBaseUrl(config.baseUrl);
    setModelUrl(config.modelUrl || '');
    setApiKey(config.apiKey);
    setRouteTargetProtocol(normalizeCliTargetProtocol(config.routeTargetProtocol));
    setRouteAuthScheme(config.routeAuthScheme);
    setSupportedProtocols(normalizeCliUpstreamProtocolsWithDefault(config.supportedProtocols));
    setApiKeys(
      normalizeCustomCliApiKeys(config.apiKeys, {
        legacyApiKey: config.apiKey,
        legacyName: config.name,
        legacyGroupMultiplier: config.groupMultiplier,
      })
    );
    setShowApiKey(false);
    setGasStationUrl(config.gasStationUrl || '');
    setGroupMultiplierInput(buildGroupMultiplierInputValue(config.groupMultiplier));
    setNotes(config.notes || '');
    setManualModels(config.manualModels || []);
    setManualModelInput('');
    setModelSearchText('');
    setModelPricing(normalizeModelPricingState(config.modelPricing));
    setCliSettings(normalizeCliSettings(config.cliSettings));
    setSelectedCli(null);
    setCopiedPath(null);
    setApplyingCli(null);
    setEditedConfig(null);
    setIsEditing(false);
    setShowResetConfirm(false);
    setPerCliEdited(buildPerCliEditedFromSettings(config.cliSettings));
  }, [config]);

  const generateConfigForCli = useCallback(
    (cliType: CliType): GeneratedConfig | null => {
      const cliModel = cliSettings[cliType]?.model;
      if (!cliModel || !baseUrl || !apiKey) return null;

      const params = {
        siteUrl: baseUrl,
        siteName: name || '自定义配置',
        apiKey,
        model: cliModel,
      };

      if (cliType === 'claudeCode') {
        return generateClaudeCodeConfig(params);
      } else if (cliType === 'codex') {
        return generateCodexConfig(params);
      } else if (cliType === 'openCode') {
        return generateOpenCodeConfig({
          ...params,
          targetProtocol: normalizeCliTargetProtocol(cliSettings.openCode.targetProtocol),
        });
      } else if (cliType === 'grokBuild') {
        return generateGrokBuildConfig({
          ...params,
          targetProtocol: normalizeCliTargetProtocol(cliSettings.grokBuild.targetProtocol),
        });
      }
      return null;
    },
    [apiKey, baseUrl, cliSettings, name]
  );

  // 生成配置预览 — 使用当前选中 CLI 的独立模型
  const configPreview = useMemo((): GeneratedConfig | null => {
    return selectedCli ? generateConfigForCli(selectedCli) : null;
  }, [generateConfigForCli, selectedCli]);

  // 处理 CLI 设置变更
  const handleCliSettingChange = (cliType: CliType, update: Partial<CustomCliSettings>) => {
    setCliSettings(prev => ({
      ...prev,
      [cliType]: { ...prev[cliType], ...update },
    }));
  };

  const handleUpdateCliModel = (cliType: CliType, model: string | null) => {
    const nextModel = model?.trim() || null;
    if (nextModel) {
      setManualModels(prev => mergeManualModelName(prev, models, nextModel));
    }
    setCliSettings(prev => {
      const current = prev[cliType];
      return {
        ...prev,
        [cliType]: {
          ...current,
          model: nextModel,
          editedFiles: nextModel ? current.editedFiles : null,
        },
      };
    });
  };

  const handleApplyCliConfig = async (cliType: CliType) => {
    const setting = cliSettings[cliType];
    if (!setting.enabled || !setting.model) {
      toast.error('该 CLI 未启用或未选择模型');
      return;
    }

    const configToApply =
      (selectedCli === cliType && editedConfig) ||
      perCliEdited[cliType] ||
      generateConfigForCli(cliType);

    if (!configToApply) {
      toast.error('请先填写 Base URL、API Key 和模型');
      return;
    }

    setApplyingCli(cliType);
    try {
      const result = await window.electronAPI.cliCompat.writeConfig({
        cliType,
        files: configToApply.files.map(file => ({
          path: file.path,
          content: file.content,
        })),
        applyMode: 'merge',
      });

      if (result.success) {
        const cliName = CLI_TYPES.find(cli => cli.key === cliType)?.name ?? cliType;
        toast.success(`${cliName} 配置已写入本地`);
      } else {
        toast.error(result.error ?? '写入配置失败');
      }
    } catch (error) {
      toast.error(getErrorMessage(error, '写入配置失败'));
    } finally {
      setApplyingCli(null);
    }
  };

  // 处理拉取模型
  const handleFetchModels = async () => {
    updateConfig(config.id, {
      baseUrl,
      modelUrl: modelUrl.trim() || undefined,
      apiKey: apiKeys[0]?.key || '',
      apiKeys,
      routeTargetProtocol,
      routeTargetProtocolNeedsConfirmation: false,
      routeAuthScheme,
      supportedProtocols,
    });
    try {
      await saveConfigs();
    } catch {
      setSaveFailed(true);
      return;
    }
    setSaveFailed(false);
    await fetchModels(config.id);
    const latestConfig = useCustomCliConfigStore
      .getState()
      .configs.find(candidate => candidate.id === config.id);
    if (latestConfig) {
      const nextCliSettings = normalizeCliSettings(latestConfig.cliSettings);
      setManualModels(latestConfig.manualModels || []);
      setApiKeys(normalizeCustomCliApiKeys(latestConfig.apiKeys));
      setApiKey(latestConfig.apiKey);
      setRouteTargetProtocol(normalizeCliTargetProtocol(latestConfig.routeTargetProtocol));
      setModelPricing(normalizeModelPricingState(latestConfig.modelPricing));
      setCliSettings(nextCliSettings);
      setPerCliEdited(buildPerCliEditedFromSettings(nextCliSettings));
      setEditedConfig(null);
      setIsEditing(false);
    }
  };

  // 复制配置
  const handleCopy = async (path: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  // 更新配置文件内容（编辑模式）
  const handleContentChange = (path: string, newContent: string) => {
    const baseConfig = editedConfig || configPreview;
    if (!baseConfig) return;
    setEditedConfig({
      files: baseConfig.files.map(file =>
        file.path === path ? { ...file, content: newContent } : file
      ),
    });
  };

  // 切换编辑/预览模式
  const toggleEditMode = () => {
    if (!selectedCli) return;
    const savedEdited = perCliEdited[selectedCli];
    const configToEdit = savedEdited || configPreview;
    if (configToEdit) {
      setEditedConfig(configToEdit);
    }
    setIsEditing(true);
  };

  // 保存编辑内容（编辑模式下的保存按钮）
  const handleSaveEdit = () => {
    if (selectedCli && editedConfig) {
      setPerCliEdited(prev => ({ ...prev, [selectedCli]: editedConfig }));
    }
    setIsEditing(false);
  };

  // 取消编辑（丢弃本次编辑）
  const handleCancelEdit = () => {
    setEditedConfig(null);
    setIsEditing(false);
  };

  // 重置配置为默认值
  const handleResetConfig = () => {
    setEditedConfig(null);
    setIsEditing(false);
    if (selectedCli) {
      setPerCliEdited(prev => ({ ...prev, [selectedCli]: null }));
    }
    setShowResetConfirm(false);
  };

  const handleAddManualModel = () => {
    const nextModel = manualModelInput.trim();
    if (!nextModel) return;
    setManualModels(prev => mergeManualModelName(prev, models, nextModel));
    setManualModelInput('');
  };

  const handleRemoveManualModel = (model: string) => {
    setManualModels(prev => prev.filter(currentModel => currentModel !== model));
    setCliSettings(prev => {
      const next = { ...prev };
      for (const key of CLI_TYPE_KEYS) {
        const current = next[key];
        next[key] = {
          ...current,
          model: current.model === model ? null : current.model,
        };
      }
      return next;
    });
  };

  const handleUpdateModelPrice = (model: string, price: ModelPriceInfo) => {
    setModelPricing(prev => ({
      ...prev,
      [model]: price,
    }));
  };

  const handleRemoveModelPrice = (model: string) => {
    setModelPricing(prev => {
      const next = { ...prev };
      delete next[model];
      return next;
    });
  };

  const updateApiKey = (keyId: string, updates: Partial<CustomCliApiKey>) => {
    setApiKeys(previous =>
      previous.map((item, index) => {
        if (item.id !== keyId) return item;
        const next = { ...item, ...updates };
        if (index === 0) {
          setApiKey(next.key);
          setGroupMultiplierInput(buildGroupMultiplierInputValue(next.groupMultiplier));
        }
        return next;
      })
    );
  };

  const addApiKey = () => {
    const now = Date.now();
    setApiKeys(previous => [
      ...previous,
      {
        id: `key_${now}_${Math.random().toString(36).slice(2, 8)}`,
        name: '',
        key: '',
        group: '',
        groupMultiplier: 1,
        models: [],
      },
    ]);
  };

  const removeApiKey = (keyId: string) => {
    setApiKeys(previous => {
      const next = previous.filter(item => item.id !== keyId);
      setApiKey(next[0]?.key || '');
      setGroupMultiplierInput(buildGroupMultiplierInputValue(next[0]?.groupMultiplier));
      return next;
    });
  };

  const requestResetConfig = async () => {
    if (showDialog) {
      const confirmed = await showDialog({
        type: 'warning',
        title: '确认重置',
        message: '确定要重置为默认配置吗？您的编辑内容将会丢失。',
        confirmText: '确认重置',
        cancelText: '取消',
      });
      if (!confirmed) return;
      handleResetConfig();
      return;
    }
    setShowResetConfirm(true);
  };

  // 切换 CLI 类型时保存当前编辑
  const handleCliTypeChange = (newCli: CliType | null) => {
    if (selectedCli && editedConfig) {
      setPerCliEdited(prev => ({ ...prev, [selectedCli]: editedConfig }));
    }
    setSelectedCli(newCli);
    setEditedConfig(null);
    setIsEditing(false);
  };

  // 当前显示的配置（优先级：编辑中 > 已保存编辑 > 自动生成）
  const savedEditedConfig = selectedCli ? perCliEdited[selectedCli] : null;
  const displayConfig =
    isEditing && editedConfig ? editedConfig : savedEditedConfig || configPreview;

  // 保存配置 — 每个 CLI 保留各自的模型和编辑内容
  const handleSave = async () => {
    // 如果当前 CLI 有编辑中的配置，先合并到 perCliEdited
    const finalPerCliEdited = { ...perCliEdited };
    if (selectedCli && editedConfig) {
      finalPerCliEdited[selectedCli] = editedConfig;
    }

    // 构建带 editedFiles 的 cliSettings
    const finalCliSettings = { ...cliSettings };
    for (const key of CLI_TYPE_KEYS) {
      const edited = finalPerCliEdited[key];
      finalCliSettings[key] = {
        ...finalCliSettings[key],
        editedFiles: edited ? edited.files.map(f => ({ path: f.path, content: f.content })) : null,
      };
    }

    updateConfig(config.id, {
      name: name.trim() || config.name,
      baseUrl,
      modelUrl: modelUrl.trim() || undefined,
      apiKey: apiKeys[0]?.key || '',
      apiKeys,
      routeTargetProtocol,
      routeTargetProtocolNeedsConfirmation: false,
      routeAuthScheme,
      supportedProtocols,
      gasStationUrl: gasStationUrl.trim() || undefined,
      groupMultiplier: parseGroupMultiplierInput(groupMultiplierInput),
      notes,
      manualModels,
      modelPricing: { data: modelPricing },
      cliSettings: finalCliSettings,
    });
    try {
      await saveConfigs();
    } catch {
      setSaveFailed(true);
      return;
    }
    setSaveFailed(false);
    await onSaved?.();
  };

  const isFetching = fetchingModels[config.id] || false;
  const showIdentitySection = section === 'all' || section === 'identity';
  const showModelsSection = section === 'all' || section === 'models';
  const showCliSection = section === 'all' || section === 'cli';
  const sectionTitle =
    section === 'identity'
      ? '直连配置身份'
      : section === 'models'
        ? '直连模型管理'
        : section === 'cli'
          ? '直连 CLI 配置'
          : '直连配置编辑';
  const sectionDescription =
    section === 'identity' ? '' : section === 'models' ? '' : section === 'cli' ? '' : '';
  const shouldShowHeader = showHeader && section !== 'cli';
  const shouldShowStandaloneSaveAction =
    !shouldShowHeader &&
    showSaveAction &&
    section !== 'cli' &&
    section !== 'identity' &&
    section !== 'models';
  const isDirty =
    saveFailed ||
    isDirectCliConfigDirty({
      config,
      name,
      baseUrl,
      modelUrl,
      apiKey,
      routeTargetProtocol,
      routeAuthScheme,
      supportedProtocols,
      apiKeys,
      gasStationUrl,
      groupMultiplierInput,
      notes,
      manualModels,
      modelPricing,
      cliSettings,
      perCliEdited,
      selectedCli,
      editedConfig,
    });
  const saveButtonVariant = isDirty ? 'danger' : 'primary';

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  return (
    <div className="space-y-3">
      {shouldShowHeader ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Settings className="h-4 w-4" />
              <span>{sectionTitle}</span>
            </div>
            {sectionDescription ? (
              <p className="mt-1 text-xs text-[var(--text-secondary)]">{sectionDescription}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onCancel ? (
              <AppButton variant="tertiary" size="sm" onClick={onCancel}>
                取消
              </AppButton>
            ) : null}
            {showSaveAction && !showModelsSection ? (
              <AppButton
                variant={saveButtonVariant}
                size="sm"
                onClick={handleSave}
                data-testid="direct-cli-save-button"
                data-dirty={isDirty ? 'true' : 'false'}
              >
                保存配置
              </AppButton>
            ) : null}
          </div>
        </div>
      ) : null}

      {shouldShowStandaloneSaveAction ? (
        <div className="flex justify-end">
          <AppButton
            variant={saveButtonVariant}
            size="sm"
            onClick={handleSave}
            data-testid="direct-cli-save-button"
            data-dirty={isDirty ? 'true' : 'false'}
          >
            保存配置
          </AppButton>
        </div>
      ) : null}

      <div className="space-y-3">
        {/* 基本信息 */}
        {showIdentitySection ? (
          <form
            id={identityFormId}
            className="space-y-3"
            onSubmit={event => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className={accessPointFormFieldLabelClass}>配置名称</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="例如: 我的 API"
                  className={accessPointFormInputClass}
                />
              </div>
              <div>
                <label className={accessPointFormFieldLabelClass}>
                  <Globe className="mr-1 inline h-3.5 w-3.5" />
                  Base URL
                </label>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className={accessPointFormInputClass}
                />
              </div>
              <div>
                <label className={accessPointFormFieldLabelClass}>路由上游协议</label>
                <select
                  aria-label="路由上游协议"
                  value={routeTargetProtocol}
                  onChange={event =>
                    setRouteTargetProtocol(normalizeCliTargetProtocol(event.target.value))
                  }
                  className={accessPointFormInputClass}
                >
                  {CLI_TARGET_PROTOCOLS.map(protocol => (
                    <option
                      key={protocol}
                      value={protocol}
                      disabled={
                        protocol !== 'native' &&
                        supportedProtocols !== undefined &&
                        !supportedProtocols.includes(protocol)
                      }
                    >
                      {protocol === 'native' ? '自动 / 原生' : CLI_TARGET_PROTOCOL_LABELS[protocol]}
                    </option>
                  ))}
                </select>
                {config.routeTargetProtocolNeedsConfirmation ? (
                  <p className="mt-1.5 text-xs text-[var(--warning)]">
                    旧配置存在协议冲突，请确认当前选择后保存。
                  </p>
                ) : null}
                {routeTargetProtocol !== 'native' &&
                supportedProtocols !== undefined &&
                !supportedProtocols.includes(routeTargetProtocol) ? (
                  <p className="mt-1.5 text-xs text-[var(--warning)]">
                    当前转换目标不在上游支持协议中；保存新的支持协议或切回自动后路由才会使用该上游。
                  </p>
                ) : null}
              </div>
              <div>
                <label className={accessPointFormFieldLabelClass}>上游鉴权方式</label>
                <select
                  aria-label="上游鉴权方式"
                  value={routeAuthScheme ?? ''}
                  onChange={event =>
                    setRouteAuthScheme(
                      event.target.value ? (event.target.value as RouteAuthScheme) : undefined
                    )
                  }
                  className={accessPointFormInputClass}
                >
                  <option value="">自动（按协议）</option>
                  <option value="bearer">Bearer</option>
                  <option value="x-api-key">x-api-key</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className={accessPointFormFieldLabelClass}>上游支持协议</label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {CLI_UPSTREAM_PROTOCOLS.map(protocol => {
                    const checked = supportedProtocols?.includes(protocol) ?? false;
                    return (
                      <label
                        key={protocol}
                        className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={event => {
                            const current = new Set(supportedProtocols ?? []);
                            if (event.target.checked) current.add(protocol);
                            else current.delete(protocol);
                            const nextProtocols = CLI_UPSTREAM_PROTOCOLS.filter(item =>
                              current.has(item)
                            );
                            if (nextProtocols.length === 0) return;
                            setSupportedProtocols(nextProtocols);
                            if (
                              routeTargetProtocol !== 'native' &&
                              !nextProtocols.includes(routeTargetProtocol)
                            ) {
                              setRouteTargetProtocol('native');
                            }
                          }}
                          className="h-4 w-4 rounded border-[var(--line-soft)]"
                        />
                        {CLI_UPSTREAM_PROTOCOL_LABELS[protocol]}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-xs text-[var(--text-tertiary)]">
                  至少选择一种协议；旧配置默认启用全部三种协议。
                </p>
              </div>
              <div>
                <label className={accessPointFormFieldLabelClass}>加油站链接</label>
                <input
                  aria-label="加油站链接"
                  type="url"
                  value={gasStationUrl}
                  onChange={e => setGasStationUrl(e.target.value)}
                  placeholder="https://example.com/topup"
                  className={accessPointFormInputClass}
                />
              </div>
              <div>
                <label className={accessPointFormFieldLabelClass}>模型 URL</label>
                <input
                  aria-label="模型 URL"
                  type="url"
                  value={modelUrl}
                  onChange={e => setModelUrl(e.target.value)}
                  placeholder="留空则使用 Base URL"
                  className={accessPointFormInputClass}
                />
              </div>
            </div>

            {showModelSummary ? (
              <div>
                <label className={accessPointFormFieldLabelClass}>模型概况</label>
                <div className="rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
                  已拉取 {models.length} 个模型，手动模型 {manualModels.length} 个
                </div>
              </div>
            ) : null}

            <div>
              <label className={accessPointFormFieldLabelClass}>备注信息</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="在此添加备注信息（可选）..."
                rows={3}
                className={`${accessPointFormInputClass} h-auto resize-none py-1.5`}
              />
            </div>
          </form>
        ) : null}

        {showModelsSection ? (
          <AccessPointResourceShell testId="direct-tab2-content">
            <div className="space-y-0.5">
              <AccessPointResourceSectionHeader
                title="令牌管理"
                meta={<> ({apiKeys.length})</>}
                actions={
                  <>
                    {showSaveAction ? (
                      <button
                        type="button"
                        onClick={() => void handleSave()}
                        className={`${accessPointResourceActionClass} ${
                          isDirty
                            ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                            : 'bg-[var(--accent-soft)] text-[var(--accent-strong)]'
                        }`}
                        aria-label="保存配置"
                        data-testid="direct-cli-save-button"
                        data-dirty={isDirty ? 'true' : 'false'}
                      >
                        保存
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={addApiKey}
                      className={accessPointResourceActionClass}
                      title="手动添加 API Key"
                    >
                      <Plus className="h-3 w-3" />
                      <span>手动添加</span>
                    </button>
                  </>
                }
              />
              {apiKeys.length === 0 ? (
                <div className="text-xs text-[var(--text-secondary)]">暂无 API Key</div>
              ) : (
                <div className={accessPointResourceTokenListClass}>
                  {apiKeys.map((item, index) => {
                    const copyId = `api-key-${item.id}`;
                    return (
                      <div
                        key={item.id}
                        className={accessPointResourceTokenRowClass}
                        data-testid="direct-api-key-row"
                      >
                        <input
                          aria-label={`API Key ${index + 1} 名称`}
                          value={item.name}
                          onChange={event => updateApiKey(item.id, { name: event.target.value })}
                          placeholder="名称"
                          className="min-w-0 w-[5rem] shrink-0 bg-transparent font-semibold text-[var(--text-primary)] outline-none"
                        />
                        <input
                          aria-label={`API Key ${index + 1} 分组`}
                          list={keyGroupListId}
                          value={item.group}
                          onChange={event => updateApiKey(item.id, { group: event.target.value })}
                          onBlur={event =>
                            updateApiKey(item.id, {
                              group: normalizeCircledGroupLabel(event.target.value),
                            })
                          }
                          placeholder="① 默认分组"
                          className="min-w-0 w-[6rem] shrink-0 bg-transparent text-[var(--text-secondary)] outline-none"
                        />
                        <input
                          aria-label={`API Key ${index + 1} 倍率`}
                          type="number"
                          min={CUSTOM_CLI_GROUP_MULTIPLIER_MIN}
                          step="0.001"
                          value={item.groupMultiplier}
                          onChange={event =>
                            updateApiKey(item.id, {
                              groupMultiplier: event.target.value.trim()
                                ? normalizeCustomCliGroupMultiplier(Number(event.target.value))
                                : 1,
                            })
                          }
                          className="w-[4rem] shrink-0 bg-transparent text-[var(--text-primary)] outline-none"
                        />
                        <div className="relative min-w-0 flex-1">
                          <input
                            aria-label={`API Key ${index + 1}`}
                            type={showApiKey ? 'text' : 'password'}
                            value={item.key}
                            onChange={event => updateApiKey(item.id, { key: event.target.value })}
                            placeholder="sk-..."
                            className="w-full bg-transparent py-0.5 pr-12 font-mono text-xs text-[var(--accent-strong)] outline-none"
                          />
                          <div className="absolute inset-y-0 right-1 flex items-center">
                            <button
                              type="button"
                              onClick={() => setShowApiKey(value => !value)}
                              className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)]"
                              aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                              title={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                            >
                              {showApiKey ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleCopy(copyId, item.key)}
                              className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={!item.key}
                              aria-label={copiedPath === copyId ? 'API Key 已复制' : '复制 API Key'}
                              title="复制 API Key"
                            >
                              {copiedPath === copyId ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeApiKey(item.id)}
                          className={`${accessPointResourceIconActionClass} text-[var(--danger)] hover:bg-[var(--danger-soft)]`}
                          aria-label={`删除 API Key ${index + 1}`}
                          title="删除"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        {item.models.length > 0 ? (
                          <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">
                            {item.models.length} 模型
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
              <datalist id={keyGroupListId}>
                {existingKeyGroupOptions.map(group => (
                  <option key={group} value={group} />
                ))}
              </datalist>
            </div>
            <div className="space-y-0.5">
              <AccessPointResourceSectionHeader
                title="可用模型"
                meta={
                  <>
                    {' '}
                    ({filteredFetchedModelOptions.length}/{models.length})
                  </>
                }
                actions={
                  <>
                    <div className="relative ml-7 w-[120px]">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-tertiary)]" />
                      <input
                        type="search"
                        aria-label="搜索可用模型"
                        value={modelSearchText}
                        onChange={e => setModelSearchText(e.target.value)}
                        placeholder="搜索模型"
                        className="h-7 w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] pl-7 pr-2 text-xs text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleFetchModels}
                      disabled={isFetching || !baseUrl || !apiKeys.some(item => item.key.trim())}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--success-soft)] px-2 py-1 text-xs font-medium text-[var(--success)] transition-colors hover:bg-[color-mix(in_srgb,var(--success)_20%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isFetching ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      拉取
                    </button>
                  </>
                }
              />
              {fetchedModelOptions.length > 0 ? (
                <div className={accessPointResourceListClass}>
                  <div className="flex flex-wrap gap-0.5">
                    {filteredFetchedModelOptions.length > 0 ? (
                      filteredFetchedModelOptions.map(model => (
                        <DirectModelPriceEditor
                          key={model}
                          model={model}
                          groups={getCustomCliModelGroups(currentApiKeys, model)}
                          pricing={modelPricing[model]}
                          onChange={handleUpdateModelPrice}
                          onRemove={handleRemoveModelPrice}
                        />
                      ))
                    ) : (
                      <div className="px-2 py-1 text-xs text-[var(--text-secondary)]">
                        没有匹配的模型
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-0.5">
              <AccessPointResourceSectionHeader
                title="手动模型"
                meta={<> ({manualModels.length})</>}
              />
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={manualModelInput}
                  onChange={e => setManualModelInput(e.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleAddManualModel();
                    }
                  }}
                  placeholder="输入上游未返回的模型名"
                  className="h-7 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 text-xs text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={handleAddManualModel}
                  className={accessPointResourceActionClass}
                >
                  <Plus className="h-3 w-3" />
                  添加
                </button>
              </div>
              <div className="flex flex-wrap gap-0.5 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)]/72 p-1">
                {manualModels.length > 0 ? (
                  manualModels.map(model => (
                    <span
                      key={model}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-xs text-[var(--text-primary)]"
                    >
                      <span className="max-w-[220px] truncate">{model}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveManualModel(model)}
                        className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-[var(--surface-2)]"
                        aria-label={`移除手动模型 ${model}`}
                      >
                        <X className="h-3 w-3 text-[var(--text-tertiary)]" />
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-[var(--text-secondary)]">暂无手动模型</span>
                )}
              </div>
            </div>
          </AccessPointResourceShell>
        ) : null}

        {/* CLI 配置：按 CLI 聚合模型、目标协议和应用操作 */}
        {showCliSection ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                CLI 配置（{CLI_TYPES.filter(cli => cliSettings[cli.key].enabled).length}/
                {CLI_TYPES.length}）
              </div>
              {showSaveAction && section === 'cli' ? (
                <AppButton
                  variant={saveButtonVariant}
                  size="sm"
                  onClick={handleSave}
                  data-testid="direct-cli-save-button"
                  data-dirty={isDirty ? 'true' : 'false'}
                >
                  保存配置
                </AppButton>
              ) : null}
            </div>

            <div className="space-y-2">
              {CLI_TYPES.map(cli => {
                const setting = cliSettings[cli.key];
                const isPreviewOpen = selectedCli === cli.key;

                return (
                  <PanelSection
                    key={cli.key}
                    collapsible={false}
                    title={
                      <span className="flex min-w-0 items-center gap-2">
                        <img src={cli.icon} alt={cli.name} className="h-4 w-4" />
                        <span className="shrink-0">{cli.name}</span>
                        <span className="min-w-0 truncate text-xs font-normal text-[var(--text-secondary)]">
                          {setting.enabled ? setting.model || '已启用 · 未选模型' : '已禁用'}
                        </span>
                      </span>
                    }
                    actions={
                      <>
                        <AppButton
                          variant="secondary"
                          size="sm"
                          className="!min-h-7 !px-2.5"
                          aria-label={`应用 ${cli.name}`}
                          onClick={() => handleApplyCliConfig(cli.key)}
                          disabled={
                            !setting.enabled ||
                            !setting.model ||
                            !baseUrl ||
                            !apiKey ||
                            applyingCli !== null
                          }
                        >
                          {applyingCli === cli.key ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          应用到本机
                        </AppButton>
                        <FormSwitch
                          checked={setting.enabled}
                          onChange={checked =>
                            handleCliSettingChange(cli.key, { enabled: checked })
                          }
                          size="sm"
                        />
                      </>
                    }
                  >
                    <div className="space-y-3">
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div className="space-y-1.5">
                            <label className="block text-xs font-medium text-[var(--text-secondary)]">
                              选择上游端口
                            </label>
                            <select
                              aria-label={`${cli.name} 选择上游端口`}
                              value={setting.targetProtocol ?? ''}
                              onChange={event =>
                                handleCliSettingChange(cli.key, {
                                  targetProtocol: event.target.value
                                    ? (event.target.value as CliTargetProtocol)
                                    : undefined,
                                })
                              }
                              disabled={!setting.enabled}
                              className={`h-8 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-0 text-xs transition-all disabled:opacity-50 focus:border-transparent focus:ring-2 focus:ring-[var(--accent)] ${
                                setting.targetProtocol
                                  ? 'text-[var(--text-primary)]'
                                  : 'text-[var(--text-tertiary)]'
                              }`}
                            >
                              <option value="">选择上游端口</option>
                              {CLI_TARGET_PROTOCOLS.map(protocol => (
                                <option key={protocol} value={protocol}>
                                  {buildCliTargetProtocolOptionLabel(
                                    cli.key,
                                    protocol,
                                    setting.model
                                  )}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-1.5">
                            <label className="block text-xs font-medium text-[var(--text-secondary)]">
                              API Key
                            </label>
                            <div className="flex min-h-9 items-center rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 text-sm text-[var(--text-secondary)]">
                              {apiKey ? '默认 API Key · 已配置' : '默认 API Key · 未配置'}
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <label className="block text-xs font-medium text-[var(--text-secondary)]">
                              CLI 使用模型
                            </label>
                            <CliModelSelector
                              models={modelOptions}
                              selectedModel={setting.model}
                              onSelect={model => handleUpdateCliModel(cli.key, model)}
                              disabled={!setting.enabled}
                              ariaLabel={`${cli.name} 主模型`}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-[var(--line-soft)] pt-3">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => handleCliTypeChange(isPreviewOpen ? null : cli.key)}
                            aria-expanded={isPreviewOpen}
                            aria-label={`${cli.name} 配置文件预览`}
                            className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]"
                          >
                            <ChevronDown
                              className={`h-3.5 w-3.5 transition-transform ${
                                isPreviewOpen ? '' : '-rotate-90'
                              }`}
                            />
                            <span>配置文件预览</span>
                          </button>
                          {isPreviewOpen && displayConfig ? (
                            <div className="flex items-center gap-1">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={handleCancelEdit}
                                    className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--line-soft)] px-2 py-1 text-xs text-[var(--text-secondary)] transition-all hover:bg-[var(--surface-2)] active:scale-95"
                                  >
                                    <X className="h-3 w-3" />
                                    <span>取消</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleSaveEdit}
                                    className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-1 text-xs text-[var(--accent)] transition-all hover:bg-[var(--accent)]/20 active:scale-95"
                                  >
                                    <Check className="h-3 w-3" />
                                    <span>保存</span>
                                  </button>
                                </>
                              ) : (
                                <>
                                  {savedEditedConfig ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void requestResetConfig();
                                      }}
                                      className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--warning)]/50 px-2 py-1 text-xs text-[var(--warning)] transition-all hover:bg-[var(--warning)]/10 active:scale-95"
                                      title="重置为默认配置"
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                      <span>重置</span>
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={toggleEditMode}
                                    className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--line-soft)] px-2 py-1 text-xs text-[var(--text-secondary)] transition-all hover:bg-[var(--surface-2)] active:scale-95"
                                    title="切换到编辑模式"
                                  >
                                    <Edit2 className="h-3 w-3" />
                                    <span>编辑</span>
                                  </button>
                                </>
                              )}
                            </div>
                          ) : null}
                        </div>
                        {isPreviewOpen ? (
                          displayConfig ? (
                            <div className="mt-3 space-y-3">
                              {isEditing ? (
                                <div className="text-xs text-[var(--text-secondary)]">
                                  提示：您可以直接编辑配置内容，修改后会随配置一起保存
                                </div>
                              ) : null}
                              <div className="space-y-2">
                                {displayConfig.files.map(file => (
                                  <ConfigFileDisplay
                                    key={file.path}
                                    file={file}
                                    onCopy={handleCopy}
                                    copiedPath={copiedPath}
                                    isEditing={isEditing}
                                    onContentChange={handleContentChange}
                                  />
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3 px-3 py-4 text-center text-sm text-[var(--text-secondary)]">
                              {!setting.model
                                ? '请为当前 CLI 选择模型以预览配置'
                                : '请填写 Base URL 和 API Key'}
                            </div>
                          )
                        ) : null}
                      </div>
                    </div>
                  </PanelSection>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {showCliSection && showResetConfirm ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-3">
          <div className="text-sm font-semibold text-[var(--text-primary)]">确认重置</div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            确定要重置为默认配置吗？您的编辑内容将会丢失。
          </p>
          <div className="mt-3 flex items-center gap-2">
            <AppButton variant="tertiary" size="sm" onClick={() => setShowResetConfirm(false)}>
              取消
            </AppButton>
            <AppButton variant="primary" size="sm" onClick={handleResetConfig}>
              确认重置
            </AppButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
