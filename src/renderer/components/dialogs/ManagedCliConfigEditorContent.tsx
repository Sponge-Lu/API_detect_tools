/**
 * @file src/renderer/components/dialogs/ManagedCliConfigEditorContent.tsx
 * @description 托管站点 CLI 配置编辑器内容组件（无 OverlayDrawer 外壳）
 *
 * 输入: 站点 / 账户 / API Keys / 当前 CliConfig / 测试兼容性结果 / 持久化回调 / 确认回调
 * 输出: React 内容组件 (CLI 启用 / 模型选择 / 测试 / 配置预览编辑 / 保存)
 * 定位: 展示层 - 嵌入 AccessPointDetailPanel 托管 Tab3，无嵌套抽屉/弹窗
 *
 * 由旧托管 CLI 抽屉实现抽取为面板内嵌内容。
 * 720px 窄宽布局：CLI 折叠手风琴 + 模型/测试槽垂直堆叠 + 配置预览折叠。
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Copy, Check, Edit2, Eye, Loader2, RotateCcw, Search, X, ChevronDown } from 'lucide-react';
import { AppButton } from '../AppButton/AppButton';
import { PanelSection } from './PanelSection';
import type { CliConfig, ApiKeyInfo, CliModelTestResult } from '../../../shared/types/cli-config';
import type {
  ClaudeTestDetail,
  CodexTestDetail,
  GeminiTestDetail,
  ModelPricingData,
  UnifiedConfig,
} from '../../../shared/types/site';
import {
  CLI_TARGET_PROTOCOLS,
  DEFAULT_CLI_CONFIG,
  getCliTargetEndpoint,
  normalizeCliTestModels,
  normalizeCliTestResults,
  normalizeCliTargetProtocol,
  sanitizeCliTestResults,
  sanitizeCliTestModels,
  type CliTargetProtocol,
} from '../../../shared/types/cli-config';
import {
  generateClaudeCodeConfig,
  generateCodexConfig,
  generateGeminiCliConfig,
  generateClaudeCodeTemplate,
  generateCodexTemplate,
  generateGeminiCliTemplate,
  type GeneratedConfig,
  type ConfigFile,
} from '../../services/cli-config-generator';
import type { CliCompatibilityResult } from '../../store/detectionStore';
import { useRouteStore } from '../../store/routeStore';
import { toast } from '../../store/toastStore';
import {
  persistCliCompatibilityResult,
  type PersistedCliCompatibilityTestSample,
} from '../../services/cli-compat-sync';
import {
  mergeCliProbeLatestRecords,
  projectCliModelTestResultsFromLatest,
  resolveCliProbeSiteId,
} from '../../services/cli-compat-projection';

import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../assets/cli-icons/gemini.svg';

export type CliType = 'claudeCode' | 'codex' | 'geminiCli';

interface ConfirmOptions {
  type?: 'confirm' | 'warning';
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

export interface ManagedCliConfigEditorContentProps {
  siteId?: string;
  siteName: string;
  accountId?: string;
  accountName?: string;
  siteUrl: string;
  apiKeys: ApiKeyInfo[];
  siteModels: string[];
  siteModelPricing?: ModelPricingData | null;
  currentConfig: CliConfig | null;
  codexDetail?: CodexTestDetail | null;
  geminiDetail?: GeminiTestDetail | null;
  compatibility?: CliCompatibilityResult | null;
  /** 全局确认对话框回调（替代 ConfirmDialog/AppModal） */
  showDialog?: (options: ConfirmOptions) => Promise<boolean>;
  onPersistConfig?: (config: CliConfig) => void | Promise<void>;
  onSave: (config: CliConfig) => void;
}

function FormSwitch({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`
        relative inline-flex h-[24px] w-[44px] shrink-0 cursor-pointer rounded-full
        border-2 transition-colors duration-200 ease-in-out
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${
          checked
            ? 'bg-[var(--accent)] border-[var(--accent)]'
            : 'bg-[var(--surface-2)] border-[var(--line-soft)]'
        }
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-[18px] w-[18px] rounded-full
          border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-sm)] ring-0
          transition-transform duration-200 ease-in-out
          ${checked ? 'translate-x-[21px]' : 'translate-x-[1px]'}
          mt-[1px]
        `}
      />
    </button>
  );
}

function getCliFailureMessage(
  cliType: CliType,
  response: {
    error?: string;
    data?: {
      claudeError?: string;
      codexError?: string;
      geminiError?: string;
    };
  }
): string | undefined {
  if (cliType === 'claudeCode') {
    return response.data?.claudeError ?? response.error;
  }
  if (cliType === 'codex') {
    return response.data?.codexError ?? response.error;
  }
  return response.data?.geminiError ?? response.error;
}

interface CliCompatTestResponse {
  success?: boolean;
  error?: string;
  data?: {
    claudeCode?: boolean | null;
    codex?: boolean | null;
    geminiCli?: boolean | null;
    claudeDetail?: ClaudeTestDetail;
    codexDetail?: CodexTestDetail;
    geminiDetail?: GeminiTestDetail;
    claudeError?: string;
    codexError?: string;
    geminiError?: string;
  };
  samples?: PersistedCliCompatibilityTestSample[];
}

function buildPersistedCompatibilityResult(params: {
  selectedCli: CliType;
  compatibility?: CliCompatibilityResult | null;
  supported: boolean;
  testedAt: number | null;
  failureMessage?: string;
  latestClaudeDetail: ClaudeTestDetail | null;
  latestCodexDetail: CodexTestDetail | null;
  latestGeminiDetail: GeminiTestDetail | null;
}): CliCompatibilityResult {
  const {
    selectedCli,
    compatibility,
    supported,
    testedAt,
    failureMessage,
    latestClaudeDetail,
    latestCodexDetail,
    latestGeminiDetail,
  } = params;

  const result: CliCompatibilityResult = {
    claudeCode: compatibility?.claudeCode ?? null,
    claudeDetail: compatibility?.claudeDetail,
    claudeError: compatibility?.claudeError,
    codex: compatibility?.codex ?? null,
    codexDetail: compatibility?.codexDetail,
    codexError: compatibility?.codexError,
    geminiCli: compatibility?.geminiCli ?? null,
    geminiDetail: compatibility?.geminiDetail,
    geminiError: compatibility?.geminiError,
    testedAt: testedAt ?? compatibility?.testedAt ?? Date.now(),
    sourceLabel: compatibility?.sourceLabel,
  };

  if (selectedCli === 'claudeCode') {
    result.claudeCode = supported;
    result.claudeDetail = latestClaudeDetail ?? result.claudeDetail;
    result.claudeError = supported ? undefined : failureMessage;
  } else if (selectedCli === 'codex') {
    result.codex = supported;
    result.codexDetail = latestCodexDetail ?? result.codexDetail;
    result.codexError = supported ? undefined : failureMessage;
  } else {
    result.geminiCli = supported;
    result.geminiDetail = latestGeminiDetail ?? result.geminiDetail;
    result.geminiError = supported ? undefined : failureMessage;
  }

  return result;
}

interface CliTypeConfig {
  key: CliType;
  name: string;
  icon: string;
  supported: boolean;
}

const CLI_TYPES: CliTypeConfig[] = [
  {
    key: 'claudeCode',
    name: 'Claude Code',
    icon: ClaudeCodeIcon,
    supported: true,
  },
  { key: 'codex', name: 'Codex', icon: CodexIcon, supported: true },
  {
    key: 'geminiCli',
    name: 'Gemini CLI',
    icon: GeminiIcon,
    supported: true,
  },
];

const CLI_TARGET_PROTOCOL_LABELS: Record<CliTargetProtocol, string> = {
  native: '原生协议',
  'anthropic-messages': 'Anthropic Messages',
  'openai-chat-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
};

const PANEL_TEST_MODEL_SLOT_COUNT = 1;

function buildCliTargetProtocolOptionLabel(
  cliType: CliType,
  targetProtocol: CliTargetProtocol,
  model?: string | null
): string {
  return `${CLI_TARGET_PROTOCOL_LABELS[targetProtocol]} · ${getCliTargetEndpoint(
    cliType,
    targetProtocol,
    model
  )}`;
}

function normalizeOptionalCliTargetProtocol(value: unknown): CliTargetProtocol | undefined {
  return typeof value === 'string' && CLI_TARGET_PROTOCOLS.includes(value as CliTargetProtocol)
    ? normalizeCliTargetProtocol(value)
    : undefined;
}

function toTestModelSlots(
  configItem?: Pick<NonNullable<CliConfig[CliType]>, 'testModel' | 'testModels'> | null
): string[] {
  const normalized = normalizeCliTestModels(configItem, PANEL_TEST_MODEL_SLOT_COUNT);
  return Array.from({ length: PANEL_TEST_MODEL_SLOT_COUNT }, (_, index) => normalized[index] || '');
}

function getApiKeyId(apiKey: ApiKeyInfo): number {
  return apiKey.id ?? apiKey.token_id ?? 0;
}

function getApiKeyValue(apiKey: ApiKeyInfo): string {
  return apiKey.key || apiKey.token || '';
}

function collectSiteModelNames(
  siteModels: string[],
  siteModelPricing?: ModelPricingData | null
): string[] {
  const names = new Set<string>();

  for (const rawModel of siteModels) {
    if (typeof rawModel === 'string' && rawModel.trim()) {
      names.add(rawModel.trim());
    }
  }

  for (const modelName of Object.keys(siteModelPricing?.data || {})) {
    if (modelName.trim()) {
      names.add(modelName.trim());
    }
  }

  return Array.from(names);
}

function filterSiteModelsByGroups(
  siteModels: string[],
  siteModelPricing: ModelPricingData | null | undefined,
  allowedGroups: string[]
): string[] {
  const normalizedGroups = allowedGroups.map(group => group.trim()).filter(Boolean);
  if (normalizedGroups.length === 0 || !siteModelPricing?.data) {
    return siteModels;
  }

  const allowedGroupSet = new Set(normalizedGroups);
  return siteModels.filter(modelName => {
    const enableGroups = siteModelPricing.data?.[modelName]?.enable_groups;
    if (!enableGroups || enableGroups.length === 0) {
      return false;
    }
    return enableGroups.some(group => allowedGroupSet.has(group));
  });
}

function getScopedSiteModels(params: {
  siteModels: string[];
  siteModelPricing?: ModelPricingData | null;
  apiKey?: ApiKeyInfo | null;
  listAllModels: boolean;
}): string[] {
  const { siteModels, siteModelPricing, apiKey, listAllModels } = params;
  const allSiteModels = collectSiteModelNames(siteModels, siteModelPricing);
  if (listAllModels) {
    return allSiteModels;
  }

  const apiKeyGroup = apiKey?.group?.trim();
  if (!apiKeyGroup) {
    return allSiteModels;
  }

  return filterSiteModelsByGroups(allSiteModels, siteModelPricing, [apiKeyGroup]);
}

function normalizeComparableUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/:80(\/|$)/, '$1')
    .replace(/:443(\/|$)/, '$1')
    .replace(/\/v1\/?$/, '')
    .replace(/\/+$/, '');
}

function extractPreviewBaseUrl(
  cliType: CliType | null,
  config: GeneratedConfig | null
): string | null {
  if (!cliType || !config) {
    return null;
  }

  if (cliType === 'claudeCode') {
    const settingsFile = config.files.find(file => file.path.includes('settings.json'));
    if (!settingsFile) {
      return null;
    }

    try {
      const settings = JSON.parse(settingsFile.content);
      return settings?.env?.ANTHROPIC_BASE_URL ?? null;
    } catch {
      return null;
    }
  }

  if (cliType === 'codex') {
    const configFile = config.files.find(file => file.path.includes('config.toml'));
    if (!configFile) {
      return null;
    }

    const match = configFile.content.match(/base_url\s*=\s*"([^"]+)"/);
    return match?.[1]?.replace(/\/v1\/?$/, '') ?? null;
  }

  if (cliType === 'geminiCli') {
    const envFile = config.files.find(file => file.path.includes('.env'));
    if (!envFile) {
      return null;
    }

    const baseUrlLine = envFile.content
      .split('\n')
      .map(line => line.trim())
      .find(line => line.startsWith('GOOGLE_GEMINI_BASE_URL='));

    return baseUrlLine?.substring('GOOGLE_GEMINI_BASE_URL='.length) ?? null;
  }

  return null;
}

interface CliModelTestState {
  slots: Array<CliModelTestResult | null>;
  testedAt: number | null;
  codexDetail: CodexTestDetail | null;
  geminiDetail: GeminiTestDetail | null;
}

function createEmptyCliModelTestState(): Record<CliType, CliModelTestState> {
  const emptySlots = Array.from({ length: PANEL_TEST_MODEL_SLOT_COUNT }, () => null);
  return {
    claudeCode: {
      slots: [...emptySlots],
      testedAt: null,
      codexDetail: null,
      geminiDetail: null,
    },
    codex: {
      slots: [...emptySlots],
      testedAt: null,
      codexDetail: null,
      geminiDetail: null,
    },
    geminiCli: {
      slots: [...emptySlots],
      testedAt: null,
      codexDetail: null,
      geminiDetail: null,
    },
  };
}

function createCliModelTestStateFromConfig(
  config?: Pick<NonNullable<CliConfig[CliType]>, 'testModel' | 'testModels' | 'testResults'> | null
): CliModelTestState {
  const slots = normalizeCliTestResults(config, PANEL_TEST_MODEL_SLOT_COUNT);
  const testedRows = slots.filter(Boolean) as CliModelTestResult[];
  return {
    slots,
    testedAt: testedRows.length > 0 ? Math.max(...testedRows.map(row => row.timestamp)) : null,
    codexDetail: null,
    geminiDetail: null,
  };
}

function areCliModelTestResultsEqual(
  left: CliModelTestResult | null,
  right: CliModelTestResult | null
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.model === right.model &&
    left.success === right.success &&
    left.timestamp === right.timestamp &&
    left.message === right.message
  );
}

function areCliModelTestSlotsEqual(
  left: Array<CliModelTestResult | null>,
  right: Array<CliModelTestResult | null>
): boolean {
  return (
    left.length === right.length &&
    left.every((leftSlot, index) => areCliModelTestResultsEqual(leftSlot, right[index] ?? null))
  );
}

function getLatestCliModelTestedAt(
  currentTestedAt: number | null,
  slots: Array<CliModelTestResult | null>
): number | null {
  const timestamps = slots
    .map(slot => slot?.timestamp)
    .filter((timestamp): timestamp is number => typeof timestamp === 'number');
  if (timestamps.length === 0) {
    return currentTestedAt;
  }

  return Math.max(currentTestedAt ?? 0, ...timestamps);
}

function buildProjectionCliConfig(
  cliType: CliType,
  currentConfig: CliConfig | null,
  cliConfigs: Record<
    CliType,
    {
      apiKeyId: number | null;
      model: string | null;
      targetProtocol?: CliTargetProtocol;
      testModels: string[];
      editedFiles: GeneratedConfig | null;
    }
  >,
  testState: CliModelTestState
): NonNullable<CliConfig[CliType]> {
  const persistedConfig = currentConfig?.[cliType] ?? null;
  return {
    apiKeyId: persistedConfig?.apiKeyId ?? cliConfigs[cliType].apiKeyId,
    model: persistedConfig?.model ?? cliConfigs[cliType].model,
    targetProtocol: normalizeCliTargetProtocol(
      persistedConfig?.targetProtocol ?? cliConfigs[cliType].targetProtocol
    ),
    testModel: persistedConfig?.testModel ?? null,
    testModels: cliConfigs[cliType].testModels,
    testResults: testState.slots,
    enabled: persistedConfig?.enabled ?? true,
    editedFiles: persistedConfig?.editedFiles ?? null,
    applyMode: persistedConfig?.applyMode ?? 'merge',
  };
}

function SearchableModelSelector({
  models,
  selectedModel,
  onSelect,
  disabled = false,
  placeholder,
  ariaLabel,
}: {
  models: string[];
  selectedModel: string | null;
  onSelect: (model: string | null) => void;
  disabled?: boolean;
  placeholder: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredModels = useMemo(() => {
    if (!query) return models;
    return models.filter(model => model.toLowerCase().includes(query.toLowerCase()));
  }, [models, query]);

  return (
    <div className="relative flex-1" ref={ref}>
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setOpen(prev => !prev)}
        className={`flex w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm transition-all ${
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-[var(--text-tertiary)]'
        }`}
      >
        <span
          className={`truncate ${selectedModel ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}
        >
          {selectedModel || placeholder}
        </span>
        <ChevronDown
          className={`ml-2 h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-lg">
          <div className="border-b border-[var(--line-soft)] p-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                type="text"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="搜索模型..."
                className="w-full rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] py-1 pl-7 pr-7 text-xs text-[var(--text-primary)] focus:border-transparent focus:ring-1 focus:ring-[var(--accent)]"
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                >
                  <X className="h-3.5 w-3.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]" />
                </button>
              )}
            </div>
          </div>
          <div className="max-h-40 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                setOpen(false);
                setQuery('');
              }}
              className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                selectedModel === null
                  ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'
              }`}
            >
              清除选择
            </button>
            {filteredModels.length > 0 ? (
              filteredModels.map(model => (
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
                      : 'text-[var(--text-primary)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  {model}
                </button>
              ))
            ) : (
              <div className="px-3 py-3 text-center text-xs text-[var(--text-secondary)]">
                {models.length === 0 ? '没有可用模型' : '无匹配结果'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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
  file: ConfigFile;
  onCopy: (path: string, content: string) => void;
  copiedPath: string | null;
  isEditing: boolean;
  onContentChange: (path: string, content: string) => void;
}) {
  const isCopied = copiedPath === file.path;
  const lineCount = file.content.split('\n').length;
  const contentHeight = Math.max(lineCount * 1.5, 8);

  const codeBlockBg = 'bg-[var(--code-bg)]';
  const codeTextColor = 'text-[var(--code-text)]';

  return (
    <div className="border border-[var(--line-soft)] rounded-[var(--radius-md)] overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
        <code
          className="text-sm font-mono text-[var(--text-primary)]"
          title={`配置文件路径: ${file.path}`}
        >
          {file.path}
        </code>
        <button
          onClick={() => onCopy(file.path, file.content)}
          className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-xs transition-all hover:bg-[var(--surface-1)] active:scale-95"
          title="复制配置内容"
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
          className={`w-full resize-none border-none p-3 text-sm font-mono ${codeBlockBg} ${codeTextColor} focus:outline-none focus:ring-2 focus:ring-[var(--accent)]`}
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

/**
 * 托管站点 CLI 配置编辑器内容组件（嵌入面板 Tab3）
 */
export function ManagedCliConfigEditorContent({
  siteId,
  siteName,
  accountId,
  accountName,
  siteUrl,
  apiKeys,
  siteModels,
  siteModelPricing,
  currentConfig,
  codexDetail,
  geminiDetail,
  compatibility,
  showDialog,
  onPersistConfig,
  onSave,
}: ManagedCliConfigEditorContentProps) {
  const routeCliProbeLatest = useRouteStore(state => state.config?.cliProbe?.latest ?? null);

  // CLI 启用状态
  const [enabledState, setEnabledState] = useState<Record<CliType, boolean>>({
    claudeCode: true,
    codex: true,
    geminiCli: true,
  });
  const [listAllModels, setListAllModels] = useState(false);

  // 当前展开的 CLI 类型；允许全部折叠
  const [selectedCli, setSelectedCli] = useState<CliType | null>(null);

  const [cliConfigs, setCliConfigs] = useState<
    Record<
      CliType,
      {
        apiKeyId: number | null;
        model: string | null;
        targetProtocol?: CliTargetProtocol;
        testModels: string[];
        editedFiles: GeneratedConfig | null;
      }
    >
  >({
    claudeCode: {
      apiKeyId: null,
      model: null,
      targetProtocol: undefined,
      testModels: toTestModelSlots(null),
      editedFiles: null,
    },
    codex: {
      apiKeyId: null,
      model: null,
      targetProtocol: undefined,
      testModels: toTestModelSlots(null),
      editedFiles: null,
    },
    geminiCli: {
      apiKeyId: null,
      model: null,
      targetProtocol: undefined,
      testModels: toTestModelSlots(null),
      editedFiles: null,
    },
  });

  const [editedConfig, setEditedConfig] = useState<GeneratedConfig | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isTestingSelectedModels, setIsTestingSelectedModels] = useState(false);
  const [applyingCli, setApplyingCli] = useState<CliType | null>(null);
  const [cliModelTests, setCliModelTests] = useState<Record<CliType, CliModelTestState>>(
    createEmptyCliModelTestState()
  );
  const [loadedCliProbeConfig, setLoadedCliProbeConfig] = useState<Pick<
    UnifiedConfig,
    'sites' | 'routing'
  > | null>(null);
  const previousDialogKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadConfig = window.electronAPI.loadConfig;
    if (!loadConfig) {
      setLoadedCliProbeConfig(null);
      return;
    }

    void Promise.resolve()
      .then(() => loadConfig())
      .then(config => {
        if (cancelled) {
          return;
        }

        const loadedConfig = config as UnifiedConfig | null | undefined;
        setLoadedCliProbeConfig({
          sites: loadedConfig?.sites || [],
          routing: loadedConfig?.routing,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedCliProbeConfig(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accountId, siteId, siteName, siteUrl]);

  const projectedCliProbeLatest = useMemo(
    () =>
      mergeCliProbeLatestRecords(
        loadedCliProbeConfig?.routing?.cliProbe?.latest,
        routeCliProbeLatest
      ),
    [loadedCliProbeConfig?.routing?.cliProbe?.latest, routeCliProbeLatest]
  );

  const projectedCliProbeSiteId = useMemo(
    () => resolveCliProbeSiteId(loadedCliProbeConfig, { siteId, siteName, siteUrl }),
    [loadedCliProbeConfig, siteId, siteName, siteUrl]
  );

  // 挂载 / 站点-账户变化时从持久化配置（重新）初始化
  useEffect(() => {
    const dialogKey = `${siteUrl}::${accountName ?? ''}`;
    const shouldInitialize = previousDialogKeyRef.current !== dialogKey;

    if (shouldInitialize && currentConfig) {
      setEnabledState({
        claudeCode: currentConfig.claudeCode?.enabled ?? DEFAULT_CLI_CONFIG.claudeCode.enabled,
        codex: currentConfig.codex?.enabled ?? DEFAULT_CLI_CONFIG.codex.enabled,
        geminiCli: currentConfig.geminiCli?.enabled ?? DEFAULT_CLI_CONFIG.geminiCli.enabled,
      });
      setCliConfigs({
        claudeCode: {
          apiKeyId: currentConfig.claudeCode?.apiKeyId ?? null,
          model: currentConfig.claudeCode?.model ?? null,
          targetProtocol: normalizeOptionalCliTargetProtocol(
            currentConfig.claudeCode?.targetProtocol
          ),
          testModels: toTestModelSlots(currentConfig.claudeCode),
          editedFiles: currentConfig.claudeCode?.editedFiles
            ? {
                files: currentConfig.claudeCode.editedFiles.map(f => ({
                  ...f,
                  language: 'json' as const,
                })),
              }
            : null,
        },
        codex: {
          apiKeyId: currentConfig.codex?.apiKeyId ?? null,
          model: currentConfig.codex?.model ?? null,
          targetProtocol: normalizeOptionalCliTargetProtocol(currentConfig.codex?.targetProtocol),
          testModels: toTestModelSlots(currentConfig.codex),
          editedFiles: currentConfig.codex?.editedFiles
            ? {
                files: currentConfig.codex.editedFiles.map(f => ({
                  ...f,
                  language: f.path.endsWith('.toml') ? ('toml' as const) : ('json' as const),
                })),
              }
            : null,
        },
        geminiCli: {
          apiKeyId: currentConfig.geminiCli?.apiKeyId ?? null,
          model: currentConfig.geminiCli?.model ?? null,
          targetProtocol: normalizeOptionalCliTargetProtocol(
            currentConfig.geminiCli?.targetProtocol
          ),
          testModels: toTestModelSlots(currentConfig.geminiCli),
          editedFiles: currentConfig.geminiCli?.editedFiles
            ? {
                files: currentConfig.geminiCli.editedFiles.map(f => ({
                  ...f,
                  language: f.path.endsWith('.env') ? ('toml' as const) : ('json' as const),
                })),
              }
            : null,
        },
      });
      setCliModelTests({
        claudeCode: createCliModelTestStateFromConfig(currentConfig.claudeCode),
        codex: createCliModelTestStateFromConfig(currentConfig.codex),
        geminiCli: createCliModelTestStateFromConfig(currentConfig.geminiCli),
      });
    } else if (shouldInitialize) {
      setEnabledState({
        claudeCode: DEFAULT_CLI_CONFIG.claudeCode.enabled,
        codex: DEFAULT_CLI_CONFIG.codex.enabled,
        geminiCli: DEFAULT_CLI_CONFIG.geminiCli.enabled,
      });
      setCliConfigs({
        claudeCode: {
          apiKeyId: null,
          model: null,
          targetProtocol: undefined,
          testModels: toTestModelSlots(null),
          editedFiles: null,
        },
        codex: {
          apiKeyId: null,
          model: null,
          targetProtocol: undefined,
          testModels: toTestModelSlots(null),
          editedFiles: null,
        },
        geminiCli: {
          apiKeyId: null,
          model: null,
          targetProtocol: undefined,
          testModels: toTestModelSlots(null),
          editedFiles: null,
        },
      });
      setCliModelTests(createEmptyCliModelTestState());
    }

    if (shouldInitialize) {
      setSelectedCli(null);
      setEditedConfig(null);
      setCopiedPath(null);
      setIsEditing(false);
      setApplyingCli(null);
      setListAllModels(false);
    }

    previousDialogKeyRef.current = dialogKey;
  }, [accountName, currentConfig, siteUrl]);

  useEffect(() => {
    if (!projectedCliProbeSiteId || Object.keys(projectedCliProbeLatest).length === 0) {
      return;
    }

    setCliModelTests(prev => {
      const projectionConfig: CliConfig = {
        claudeCode: buildProjectionCliConfig(
          'claudeCode',
          currentConfig,
          cliConfigs,
          prev.claudeCode
        ),
        codex: buildProjectionCliConfig('codex', currentConfig, cliConfigs, prev.codex),
        geminiCli: buildProjectionCliConfig('geminiCli', currentConfig, cliConfigs, prev.geminiCli),
      };
      const projectedResults = projectCliModelTestResultsFromLatest({
        latest: projectedCliProbeLatest,
        siteId: projectedCliProbeSiteId,
        accountId,
        cliConfig: projectionConfig,
      });

      const next: Record<CliType, CliModelTestState> = {
        claudeCode: {
          ...prev.claudeCode,
          slots: projectedResults.claudeCode,
          testedAt: getLatestCliModelTestedAt(
            prev.claudeCode.testedAt,
            projectedResults.claudeCode
          ),
        },
        codex: {
          ...prev.codex,
          slots: projectedResults.codex,
          testedAt: getLatestCliModelTestedAt(prev.codex.testedAt, projectedResults.codex),
        },
        geminiCli: {
          ...prev.geminiCli,
          slots: projectedResults.geminiCli,
          testedAt: getLatestCliModelTestedAt(prev.geminiCli.testedAt, projectedResults.geminiCli),
        },
      };

      const unchanged =
        areCliModelTestSlotsEqual(prev.claudeCode.slots, next.claudeCode.slots) &&
        areCliModelTestSlotsEqual(prev.codex.slots, next.codex.slots) &&
        areCliModelTestSlotsEqual(prev.geminiCli.slots, next.geminiCli.slots);

      return unchanged ? prev : next;
    });
  }, [accountId, cliConfigs, currentConfig, projectedCliProbeLatest, projectedCliProbeSiteId]);

  // 切换或折叠 CLI 面板前保存当前编辑的配置
  const handleCliTypeChange = (newCliType: CliType | null) => {
    if (
      selectedCli &&
      editedConfig &&
      (selectedCli === 'claudeCode' || selectedCli === 'codex' || selectedCli === 'geminiCli')
    ) {
      setCliConfigs(prev => ({
        ...prev,
        [selectedCli]: { ...prev[selectedCli], editedFiles: editedConfig },
      }));
    }
    setSelectedCli(newCliType);
    setEditedConfig(null);
    setIsEditing(false);
  };

  const selectedApiKey = useMemo(() => {
    if (!selectedCli) return null;
    const config = cliConfigs[selectedCli];
    if (!config.apiKeyId) return null;
    return apiKeys.find(k => getApiKeyId(k) === config.apiKeyId) || null;
  }, [apiKeys, selectedCli, cliConfigs]);

  const selectedTargetProtocolValue = selectedCli
    ? (cliConfigs[selectedCli].targetProtocol ?? '')
    : '';

  const availableModels = useMemo(() => {
    if (!selectedCli || !selectedApiKey) {
      return [];
    }
    return getScopedSiteModels({
      siteModels,
      siteModelPricing,
      apiKey: selectedApiKey,
      listAllModels,
    });
  }, [selectedApiKey, selectedCli, siteModelPricing, siteModels, listAllModels]);

  useEffect(() => {
    if (!selectedCli || listAllModels) {
      return;
    }

    const currentConfigState = cliConfigs[selectedCli];
    if (!currentConfigState.apiKeyId) {
      return;
    }

    const availableModelSet = new Set(availableModels);
    const nextModel =
      currentConfigState.model && availableModelSet.has(currentConfigState.model)
        ? currentConfigState.model
        : null;
    const nextTestModels = currentConfigState.testModels.map(model =>
      model && availableModelSet.has(model) ? model : ''
    );
    const selectionChanged =
      nextModel !== currentConfigState.model ||
      nextTestModels.some((model, index) => model !== currentConfigState.testModels[index]);

    if (!selectionChanged) {
      return;
    }

    setCliConfigs(prev => ({
      ...prev,
      [selectedCli]: {
        ...prev[selectedCli],
        model: nextModel,
        testModels: nextTestModels,
        editedFiles: null,
      },
    }));
    setEditedConfig(null);
    setIsEditing(false);
    setCliModelTests(prev => ({
      ...prev,
      [selectedCli]: createEmptyCliModelTestState()[selectedCli],
    }));
  }, [availableModels, cliConfigs, listAllModels, selectedCli]);

  const effectiveCodexDetail = cliModelTests.codex.codexDetail ?? codexDetail ?? undefined;
  const effectiveGeminiDetail = cliModelTests.geminiCli.geminiDetail ?? geminiDetail ?? undefined;

  const generateConfigForCli = useCallback(
    (cliType: CliType): GeneratedConfig | null => {
      const config = cliConfigs[cliType];
      const apiKey = config.apiKeyId
        ? apiKeys.find(item => getApiKeyId(item) === config.apiKeyId)
        : null;
      if (!apiKey) return null;
      if (!config.model) return null;

      const params = {
        siteUrl,
        siteName,
        apiKey: getApiKeyValue(apiKey),
        model: config.model,
      };

      if (cliType === 'claudeCode') {
        return generateClaudeCodeConfig(params);
      } else if (cliType === 'codex') {
        return generateCodexConfig({ ...params, codexDetail: effectiveCodexDetail });
      } else if (cliType === 'geminiCli') {
        return generateGeminiCliConfig({ ...params, geminiDetail: effectiveGeminiDetail });
      }
      return null;
    },
    [apiKeys, cliConfigs, effectiveCodexDetail, effectiveGeminiDetail, siteName, siteUrl]
  );

  const realtimeConfig = useMemo(() => {
    return selectedCli ? generateConfigForCli(selectedCli) : null;
  }, [generateConfigForCli, selectedCli]);

  const templateConfig = useMemo(() => {
    if (selectedCli === 'claudeCode') {
      return generateClaudeCodeTemplate();
    } else if (selectedCli === 'codex') {
      return generateCodexTemplate();
    } else if (selectedCli === 'geminiCli') {
      return generateGeminiCliTemplate();
    }
    return null;
  }, [selectedCli]);

  const savedEditedConfig = selectedCli ? cliConfigs[selectedCli]?.editedFiles : null;
  const displayConfig =
    isEditing && editedConfig
      ? editedConfig
      : savedEditedConfig || realtimeConfig || templateConfig;
  const previewBaseUrl = useMemo(
    () => extractPreviewBaseUrl(selectedCli, displayConfig),
    [selectedCli, displayConfig]
  );

  const isShowingTemplate = !realtimeConfig && !savedEditedConfig && !!templateConfig;
  const previewBaseUrlMismatch = useMemo(() => {
    if (isShowingTemplate || !previewBaseUrl) {
      return null;
    }

    const normalizedPreviewUrl = normalizeComparableUrl(previewBaseUrl);
    const normalizedSiteUrl = normalizeComparableUrl(siteUrl);
    if (!normalizedPreviewUrl || !normalizedSiteUrl || normalizedPreviewUrl === normalizedSiteUrl) {
      return null;
    }

    return {
      previewBaseUrl: previewBaseUrl.replace(/\/+$/, ''),
      siteUrl: siteUrl.replace(/\/+$/, ''),
    };
  }, [isShowingTemplate, previewBaseUrl, siteUrl]);

  const handleToggleEnabled = (cliType: CliType) => {
    setEnabledState(prev => ({
      ...prev,
      [cliType]: !prev[cliType],
    }));
  };

  const handleApiKeyChange = (apiKeyId: number | null) => {
    if (!selectedCli) return;
    setCliConfigs(prev => ({
      ...prev,
      [selectedCli]: {
        ...prev[selectedCli],
        apiKeyId,
        model: null,
        testModels: toTestModelSlots(null),
        editedFiles: null,
      },
    }));
    setEditedConfig(null);
    setIsEditing(false);
    setCliModelTests(prev => ({
      ...prev,
      [selectedCli]: createEmptyCliModelTestState()[selectedCli],
    }));
  };

  const handleTargetProtocolChange = (value: string) => {
    if (!selectedCli) return;
    setCliConfigs(prev => ({
      ...prev,
      [selectedCli]: {
        ...prev[selectedCli],
        targetProtocol: value ? normalizeOptionalCliTargetProtocol(value) : undefined,
      },
    }));
  };

  const handleModelChange = (model: string | null) => {
    if (!selectedCli) return;
    setCliConfigs(prev => ({
      ...prev,
      [selectedCli]: { ...prev[selectedCli], model, editedFiles: null },
    }));
    setEditedConfig(null);
    setIsEditing(false);
  };

  const handleTestModelChange = (slotIndex: number, testModel: string | null) => {
    if (!selectedCli) return;
    setCliConfigs(prev => ({
      ...prev,
      [selectedCli]: {
        ...prev[selectedCli],
        testModels: prev[selectedCli].testModels.map((current, index) => {
          return index === slotIndex ? testModel || '' : current;
        }),
      },
    }));
    setCliModelTests(prev => ({
      ...prev,
      [selectedCli]: {
        ...prev[selectedCli],
        slots: prev[selectedCli].slots.map((slot, index) => (index === slotIndex ? null : slot)),
      },
    }));
  };

  const handleCopy = async (path: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  const handleContentChange = (path: string, newContent: string) => {
    const baseConfig = editedConfig || realtimeConfig;
    if (!baseConfig) return;
    setEditedConfig({
      files: baseConfig.files.map(file =>
        file.path === path ? { ...file, content: newContent } : file
      ),
    });
  };

  const toggleEditMode = () => {
    if (!isEditing) {
      const configToEdit = savedEditedConfig || realtimeConfig;
      if (configToEdit) {
        setEditedConfig(configToEdit);
      }
    }
    setIsEditing(!isEditing);
  };

  const handleResetConfig = async () => {
    setEditedConfig(null);
    setIsEditing(false);
    if (selectedCli) {
      setCliConfigs(prev => ({
        ...prev,
        [selectedCli]: { ...prev[selectedCli], editedFiles: null },
      }));
    }
  };

  const onResetConfirmRequested = async () => {
    if (showDialog) {
      const confirmed = await showDialog({
        type: 'warning',
        title: '确认重置',
        message: '确定要重置为默认配置吗？您的编辑内容将会丢失。',
        confirmText: '确认重置',
        cancelText: '取消',
      });
      if (!confirmed) return;
    }
    await handleResetConfig();
  };

  const buildConfigPayload = (
    testStates: Record<CliType, CliModelTestState> = cliModelTests
  ): CliConfig => {
    const getEditedFiles = (cliType: 'claudeCode' | 'codex' | 'geminiCli') => {
      if (selectedCli === cliType && editedConfig) {
        return editedConfig.files.map(f => ({ path: f.path, content: f.content }));
      }
      if (cliConfigs[cliType].editedFiles) {
        return cliConfigs[cliType].editedFiles!.files.map(f => ({
          path: f.path,
          content: f.content,
        }));
      }
      return null;
    };

    return {
      claudeCode: {
        apiKeyId: cliConfigs.claudeCode.apiKeyId,
        model: cliConfigs.claudeCode.model,
        targetProtocol: cliConfigs.claudeCode.targetProtocol
          ? normalizeCliTargetProtocol(cliConfigs.claudeCode.targetProtocol)
          : undefined,
        testModel: sanitizeCliTestModels(cliConfigs.claudeCode.testModels)[0] ?? null,
        testModels: sanitizeCliTestModels(cliConfigs.claudeCode.testModels),
        testResults: sanitizeCliTestResults(testStates.claudeCode.slots),
        enabled: enabledState.claudeCode,
        editedFiles: getEditedFiles('claudeCode'),
        applyMode: currentConfig?.claudeCode?.applyMode ?? 'merge',
      },
      codex: {
        apiKeyId: cliConfigs.codex.apiKeyId,
        model: cliConfigs.codex.model,
        targetProtocol: cliConfigs.codex.targetProtocol
          ? normalizeCliTargetProtocol(cliConfigs.codex.targetProtocol)
          : undefined,
        testModel: sanitizeCliTestModels(cliConfigs.codex.testModels)[0] ?? null,
        testModels: sanitizeCliTestModels(cliConfigs.codex.testModels),
        testResults: sanitizeCliTestResults(testStates.codex.slots),
        enabled: enabledState.codex,
        editedFiles: getEditedFiles('codex'),
        applyMode: currentConfig?.codex?.applyMode ?? 'merge',
      },
      geminiCli: {
        apiKeyId: cliConfigs.geminiCli.apiKeyId,
        model: cliConfigs.geminiCli.model,
        targetProtocol: cliConfigs.geminiCli.targetProtocol
          ? normalizeCliTargetProtocol(cliConfigs.geminiCli.targetProtocol)
          : undefined,
        testModel: sanitizeCliTestModels(cliConfigs.geminiCli.testModels)[0] ?? null,
        testModels: sanitizeCliTestModels(cliConfigs.geminiCli.testModels),
        testResults: sanitizeCliTestResults(testStates.geminiCli.slots),
        enabled: enabledState.geminiCli,
        editedFiles: getEditedFiles('geminiCli'),
        applyMode: currentConfig?.geminiCli?.applyMode ?? 'merge',
      },
    };
  };

  const handleTestSelectedModels = async () => {
    if (!selectedCli || isTestingSelectedModels) return;

    const config = cliConfigs[selectedCli];
    if (!config.apiKeyId) {
      toast.error('请先选择 API Key');
      return;
    }

    const apiKey = apiKeys.find(item => getApiKeyId(item) === config.apiKeyId);
    const resolvedApiKey = apiKey ? getApiKeyValue(apiKey) : '';
    if (!resolvedApiKey) {
      toast.error('未找到对应的 API Key');
      return;
    }

    const modelEntries = config.testModels
      .map((rawModel, slotIndex) => ({
        slotIndex,
        model: typeof rawModel === 'string' ? rawModel.trim() : '',
      }))
      .filter((entry): entry is { slotIndex: number; model: string } => Boolean(entry.model));
    if (modelEntries.length === 0) {
      toast.error('请先为当前 CLI 选择测试模型');
      return;
    }

    setIsTestingSelectedModels(true);
    const resetCliTestState = createEmptyCliModelTestState()[selectedCli];
    setCliModelTests(prev => ({
      ...prev,
      [selectedCli]: resetCliTestState,
    }));

    let failedCount = 0;
    let latestTestedAt: number | null = null;
    let selectedCliSupported = false;
    let latestFailureMessage: string | undefined;
    let latestCodexDetail: CodexTestDetail | null = null;
    let latestGeminiDetail: GeminiTestDetail | null = null;
    let latestClaudeDetail: ClaudeTestDetail | null = null;
    const persistedSamples: PersistedCliCompatibilityTestSample[] = [];
    let nextCliTestState = resetCliTestState;

    for (const { slotIndex: targetSlotIndex, model } of modelEntries) {
      let rowResult: CliModelTestResult;

      try {
        const response = (await (window.electronAPI as any).cliCompat.testWithWrapper({
          siteUrl,
          configs: [
            {
              cliType: selectedCli,
              apiKey: resolvedApiKey,
              model,
              baseUrl: siteUrl,
              targetProtocol: normalizeCliTargetProtocol(config.targetProtocol),
            },
          ],
        })) as CliCompatTestResponse;

        const success = response.success === true && response.data?.[selectedCli] === true;
        latestTestedAt = Date.now();
        selectedCliSupported = selectedCliSupported || success;
        if (response.data?.claudeDetail) latestClaudeDetail = response.data.claudeDetail;
        if (response.data?.codexDetail) latestCodexDetail = response.data.codexDetail;
        if (response.data?.geminiDetail) latestGeminiDetail = response.data.geminiDetail;
        if (Array.isArray(response.samples) && response.samples.length > 0) {
          persistedSamples.push(...response.samples);
        }
        if (!success) failedCount += 1;
        if (!success) {
          latestFailureMessage =
            getCliFailureMessage(selectedCli, response) ?? latestFailureMessage;
        }

        rowResult = {
          model,
          success,
          message: success
            ? undefined
            : (getCliFailureMessage(selectedCli, response) ?? '测试失败'),
          timestamp: latestTestedAt,
        };
      } catch (error) {
        latestTestedAt = Date.now();
        failedCount += 1;
        rowResult = {
          model,
          success: false,
          message: error instanceof Error ? error.message : '测试失败',
          timestamp: latestTestedAt,
        };
      }

      nextCliTestState = {
        ...nextCliTestState,
        testedAt: latestTestedAt,
        codexDetail: latestCodexDetail,
        geminiDetail: latestGeminiDetail,
        slots: nextCliTestState.slots.map((slot, slotIndex) =>
          slotIndex === targetSlotIndex ? rowResult : slot
        ),
      };

      const interimTestState = nextCliTestState;
      setCliModelTests(prev => ({
        ...prev,
        [selectedCli]: interimTestState,
      }));
    }

    setIsTestingSelectedModels(false);
    const nextTestStates = {
      ...cliModelTests,
      [selectedCli]: nextCliTestState,
    };

    if (onPersistConfig) {
      try {
        await onPersistConfig(buildConfigPayload(nextTestStates));
      } catch {
        toast.error('测试结果持久化失败');
      }
    }

    try {
      const persistResult = await persistCliCompatibilityResult(
        siteUrl,
        buildPersistedCompatibilityResult({
          selectedCli,
          compatibility,
          supported: selectedCliSupported,
          testedAt: latestTestedAt,
          failureMessage: latestFailureMessage,
          latestClaudeDetail,
          latestCodexDetail,
          latestGeminiDetail,
        }),
        {
          accountId,
          samples: persistedSamples,
        }
      );

      if (!persistResult.success) {
        toast.error(`测试结果同步到站点检测失败: ${persistResult.error ?? '未知错误'}`);
      }
    } catch (error) {
      toast.error(
        `测试结果同步到站点检测失败: ${error instanceof Error ? error.message : '未知错误'}`
      );
    }

    if (failedCount === 0) {
      toast.success(`${CLI_TYPES.find(cli => cli.key === selectedCli)?.name ?? 'CLI'} 测试通过`);
    } else {
      toast.warning(
        `${CLI_TYPES.find(cli => cli.key === selectedCli)?.name ?? 'CLI'} 有 ${failedCount} 个测试模型未通过`,
        10000
      );
    }
  };

  const handleApplyCliConfig = async (cliType: CliType) => {
    const config = cliConfigs[cliType];
    if (!enabledState[cliType] || !config.model) {
      toast.error('该 CLI 未启用或未选择模型');
      return;
    }

    const configToApply =
      (selectedCli === cliType && editedConfig) ||
      cliConfigs[cliType].editedFiles ||
      generateConfigForCli(cliType);

    if (!configToApply) {
      toast.error('请先选择 API Key 和模型');
      return;
    }

    const writeConfig = window.electronAPI.cliCompat?.writeConfig;
    if (!writeConfig) {
      toast.error('当前环境不支持写入本地 CLI 配置');
      return;
    }

    setApplyingCli(cliType);
    try {
      const result = await writeConfig({
        cliType,
        files: configToApply.files.map(file => ({
          path: file.path,
          content: file.content,
        })),
        applyMode: currentConfig?.[cliType]?.applyMode ?? 'merge',
      });

      if (result.success) {
        const cliName = CLI_TYPES.find(cli => cli.key === cliType)?.name ?? cliType;
        toast.success(`${cliName} 配置已写入本地`);
      } else {
        toast.error(result.error ?? '写入配置失败');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '写入配置失败');
    } finally {
      setApplyingCli(null);
    }
  };

  const handleSave = () => {
    if (
      selectedCli &&
      editedConfig &&
      (selectedCli === 'claudeCode' || selectedCli === 'codex' || selectedCli === 'geminiCli')
    ) {
      setCliConfigs(prev => ({
        ...prev,
        [selectedCli]: { ...prev[selectedCli], editedFiles: editedConfig },
      }));
    }

    onSave(buildConfigPayload());
  };

  const selectedCliTestState = selectedCli ? cliModelTests[selectedCli] : null;

  return (
    <div className="space-y-3">
      {/* CLI 列表头 + 操作 */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          CLI 配置（{CLI_TYPES.filter(cli => enabledState[cli.key]).length}/{CLI_TYPES.length}）
        </div>
        <div className="flex items-center gap-2">
          <AppButton variant="primary" size="sm" onClick={handleSave}>
            保存配置
          </AppButton>
        </div>
      </div>

      {/* 每个 CLI 一个折叠分区；允许全部折叠 */}
      <div className="space-y-2">
        {CLI_TYPES.map(cli => {
          const isOpen = selectedCli === cli.key;
          return (
            <PanelSection
              key={cli.key}
              collapsible
              expanded={isOpen}
              onExpandedChange={expanded => {
                handleCliTypeChange(expanded ? cli.key : null);
              }}
              title={
                <span className="flex items-center gap-2">
                  <img src={cli.icon} alt={cli.name} className="h-4 w-4" />
                  <span>{cli.name}</span>
                </span>
              }
              subtitle={
                enabledState[cli.key] ? (
                  cliConfigs[cli.key]?.model ? (
                    <span className="truncate">{cliConfigs[cli.key]?.model}</span>
                  ) : (
                    '已启用 · 未选模型'
                  )
                ) : (
                  '已禁用'
                )
              }
              actions={
                <>
                  <AppButton
                    variant="secondary"
                    size="sm"
                    aria-label={`应用 ${cli.name}`}
                    onClick={() => {
                      void handleApplyCliConfig(cli.key);
                    }}
                    disabled={
                      !enabledState[cli.key] ||
                      !cliConfigs[cli.key]?.apiKeyId ||
                      !cliConfigs[cli.key]?.model ||
                      applyingCli !== null
                    }
                  >
                    {applyingCli === cli.key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    应用到本机
                  </AppButton>
                  <FormSwitch
                    checked={enabledState[cli.key]}
                    onChange={() => handleToggleEnabled(cli.key)}
                    ariaLabel={`启用 ${cli.name}`}
                  />
                </>
              }
            >
              {isOpen ? (
                <div className="space-y-3">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-[var(--text-secondary)]">
                        连接配置
                      </div>
                      <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                        <span>列出全部模型</span>
                        <FormSwitch
                          checked={listAllModels}
                          onChange={setListAllModels}
                          ariaLabel="列出全部模型"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-[var(--text-secondary)]">
                          选择 API Key
                        </label>
                        {apiKeys.length === 0 ? (
                          <div className="py-2 text-xs text-[var(--text-secondary)]">
                            该站点没有可用的 API Key
                          </div>
                        ) : (
                          <select
                            aria-label="选择 API Key"
                            value={cliConfigs[cli.key]?.apiKeyId ?? ''}
                            onChange={e =>
                              handleApiKeyChange(
                                e.target.value ? parseInt(e.target.value, 10) : null
                              )
                            }
                            className="w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)]"
                          >
                            <option value="">请选择 API Key</option>
                            {apiKeys.map(apiKey => {
                              const id = getApiKeyId(apiKey);
                              const modelCount = getScopedSiteModels({
                                siteModels,
                                siteModelPricing,
                                apiKey,
                                listAllModels,
                              }).length;
                              return (
                                <option key={id} value={id}>
                                  {apiKey.name || `Key #${id}`}
                                  {apiKey.group ? ` [${apiKey.group}]` : ''}
                                  {` (${modelCount} 个模型)`}
                                </option>
                              );
                            })}
                          </select>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-[var(--text-secondary)]">
                          选择上游端口
                        </label>
                        <select
                          aria-label="选择上游端口"
                          value={selectedTargetProtocolValue}
                          onChange={event => handleTargetProtocolChange(event.target.value)}
                          className={`w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)] ${
                            selectedTargetProtocolValue
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
                                cliConfigs[cli.key]?.model
                              )}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 border-t border-[var(--line-soft)] pt-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex min-h-8 items-center">
                        <label className="block text-xs font-medium text-[var(--text-secondary)]">
                          CLI 使用模型
                        </label>
                      </div>
                      {!cliConfigs[cli.key]?.apiKeyId ? (
                        <div className="py-1 text-xs text-[var(--text-secondary)]">
                          选择 API Key 后可选择模型
                        </div>
                      ) : availableModels.length > 0 ? (
                        <SearchableModelSelector
                          models={availableModels}
                          selectedModel={cliConfigs[cli.key]?.model ?? null}
                          onSelect={model => handleModelChange(model)}
                          placeholder="请选择 CLI 模型"
                          ariaLabel="CLI 使用模型"
                        />
                      ) : (
                        <div className="py-1 text-xs text-[var(--text-secondary)]">
                          没有可用模型
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex min-h-8 items-center justify-between gap-2">
                        <label className="block text-xs font-medium text-[var(--text-secondary)]">
                          测试模型
                        </label>
                        <AppButton
                          variant="tertiary"
                          size="sm"
                          onClick={() => {
                            void handleTestSelectedModels();
                          }}
                          disabled={isTestingSelectedModels}
                        >
                          {isTestingSelectedModels ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          测试已选模型
                        </AppButton>
                      </div>
                      {!cliConfigs[cli.key]?.apiKeyId ? (
                        <div className="py-1 text-xs text-[var(--text-secondary)]">
                          选择 API Key 后可选择测试模型
                        </div>
                      ) : availableModels.length > 0 ? (
                        <div className="flex items-start gap-2">
                          <SearchableModelSelector
                            models={availableModels}
                            selectedModel={cliConfigs[cli.key]?.testModels[0] || null}
                            onSelect={model => handleTestModelChange(0, model)}
                            placeholder="请选择测试模型"
                            ariaLabel="测试模型"
                          />
                          {selectedCliTestState?.slots[0] ? (
                            <div className="min-w-[4rem] shrink-0 pt-2 text-right">
                              <span
                                className={`text-xs font-medium ${
                                  selectedCliTestState.slots[0]?.success
                                    ? 'text-[var(--success)]'
                                    : 'text-[var(--danger)]'
                                }`}
                              >
                                {selectedCliTestState.slots[0]?.success ? '成功' : '失败'}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="py-1 text-xs text-[var(--text-secondary)]">
                          没有可用模型
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 配置预览 */}
                  {(cli.key === 'claudeCode' || cli.key === 'codex' || cli.key === 'geminiCli') && (
                    <div className="space-y-3 border-t border-[var(--line-soft)] pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-medium text-[var(--text-secondary)]">
                          配置文件预览
                          {isShowingTemplate ? (
                            <span className="ml-1 text-xs text-[var(--warning)]">(模板)</span>
                          ) : null}
                        </div>
                        {displayConfig && !isShowingTemplate ? (
                          <div className="flex items-center gap-1">
                            {(editedConfig || savedEditedConfig) && (
                              <button
                                onClick={() => void onResetConfirmRequested()}
                                className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--warning)]/50 px-2 py-1 text-xs text-[var(--warning)] transition-all hover:bg-[var(--warning)]/10 active:scale-95"
                                title="重置为默认配置"
                              >
                                <RotateCcw className="h-3 w-3" />
                                <span>重置</span>
                              </button>
                            )}
                            <button
                              onClick={toggleEditMode}
                              className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--line-soft)] px-2 py-1 text-xs text-[var(--text-secondary)] transition-all hover:bg-[var(--surface-2)] active:scale-95"
                              title={isEditing ? '切换到预览模式' : '切换到编辑模式'}
                            >
                              {isEditing ? (
                                <>
                                  <Eye className="h-3 w-3" />
                                  <span>预览</span>
                                </>
                              ) : (
                                <>
                                  <Edit2 className="h-3 w-3" />
                                  <span>编辑</span>
                                </>
                              )}
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {previewBaseUrlMismatch && (
                        <div
                          role="alert"
                          className="rounded-[var(--radius-sm)] border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-2 py-1.5 text-xs text-[var(--warning)]"
                        >
                          检测到当前预览配置中的域名（{previewBaseUrlMismatch.previewBaseUrl}
                          ）与当前站点（
                          {previewBaseUrlMismatch.siteUrl}）不一致。站点页测试将优先使用当前站点
                          URL，建议重新生成并保存配置。
                        </div>
                      )}
                      {isShowingTemplate && (
                        <div className="rounded-[var(--radius-sm)] bg-[var(--warning)]/10 px-2 py-1.5 text-xs text-[var(--warning)]">
                          请选择 API Key 和 CLI 使用模型以生成实际配置，以下为配置模板
                        </div>
                      )}
                      {isEditing && (
                        <div className="text-xs text-[var(--text-secondary)]">
                          提示：您可以直接编辑配置内容，修改后点击复制按钮复制最终配置
                        </div>
                      )}
                      <div className="space-y-2">
                        {displayConfig?.files.map(file => (
                          <ConfigFileDisplay
                            key={file.path}
                            file={file}
                            onCopy={handleCopy}
                            copiedPath={copiedPath}
                            isEditing={isEditing && !isShowingTemplate}
                            onContentChange={handleContentChange}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </PanelSection>
          );
        })}
      </div>
    </div>
  );
}
