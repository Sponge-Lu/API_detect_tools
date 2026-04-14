/**
 * @file src/renderer/components/dialogs/UnifiedCliConfigDialog.tsx
 * @description 统一 CLI 配置对话框
 *
 * 输入: UnifiedCliConfigDialogProps (站点数据、API Keys、CLI 配置、测试结果)
 * 输出: React 组件 (统一 CLI 配置对话框 UI)
 * 定位: 展示层 - 统一 CLI 配置对话框，支持 CLI 启用/禁用、配置选择、预览编辑和保存
 *
 * @version 2.1.14
 * @updated 2026-04-13 - 上调统一 CLI 配置弹窗目标高度，同时继续按当前视口约束避免越界
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import {
  Copy,
  Check,
  Edit2,
  Eye,
  Loader2,
  RotateCcw,
  Settings,
  Search,
  X,
  ChevronDown,
} from 'lucide-react';
import { AppButton } from '../AppButton/AppButton';
import { ConfirmDialog } from '../ConfirmDialog';
import { OverlayDrawer } from '../overlays/OverlayDrawer';
import type { CliConfig, ApiKeyInfo, CliModelTestResult } from '../../../shared/types/cli-config';
import type { CodexTestDetail, GeminiTestDetail } from '../../../shared/types/site';
import {
  CLI_TEST_MODEL_SLOT_COUNT,
  DEFAULT_CLI_CONFIG,
  normalizeCliTestModels,
  normalizeCliTestResults,
  sanitizeCliTestResults,
  sanitizeCliTestModels,
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
import { toast } from '../../store/toastStore';

// 导入 CLI 图标
import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../assets/cli-icons/gemini.svg';

function FormSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
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

export interface UnifiedCliConfigDialogProps {
  isOpen: boolean;
  siteName: string;
  accountName?: string;
  siteUrl: string;
  apiKeys: ApiKeyInfo[];
  siteModels: string[];
  currentConfig: CliConfig | null;
  codexDetail?: CodexTestDetail | null; // Codex 详细测试结果
  geminiDetail?: GeminiTestDetail | null; // Gemini CLI 详细测试结果，用于自动选择端点格式
  compatibility?: CliCompatibilityResult | null;
  isTestingCompatibility?: boolean;
  onTestCompatibility?: () => void;
  onApplySelectedCli?: (cliType: CliType, applyMode: 'merge' | 'overwrite') => void | Promise<void>;
  onPersistConfig?: (config: CliConfig) => void | Promise<void>;
  onClose: () => void;
  onSave: (config: CliConfig) => void;
}

type CliType = 'claudeCode' | 'codex' | 'geminiCli';

interface CliTypeConfig {
  key: CliType;
  name: string;
  icon: string;
  supported: boolean; // 是否支持配置生成
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

const CLI_DIALOG_HEIGHT_RATIO = 0.74;
const CLI_DIALOG_MAX_HEIGHT = 660;
const CLI_DIALOG_VIEWPORT_MARGIN = 32;

function getDialogViewportHeight(): number {
  if (typeof window === 'undefined') {
    return 0;
  }

  return (
    window.visualViewport?.height ??
    window.innerHeight ??
    document.documentElement.clientHeight ??
    0
  );
}

function toTestModelSlots(
  configItem?: Pick<NonNullable<CliConfig[CliType]>, 'testModel' | 'testModels'> | null
): string[] {
  const normalized = normalizeCliTestModels(configItem, CLI_TEST_MODEL_SLOT_COUNT);
  return Array.from({ length: CLI_TEST_MODEL_SLOT_COUNT }, (_, index) => normalized[index] || '');
}

/** 获取 API Key 的 ID */
function getApiKeyId(apiKey: ApiKeyInfo): number {
  return apiKey.id ?? apiKey.token_id ?? 0;
}

/** 获取 API Key 的实际 key 值 */
function getApiKeyValue(apiKey: ApiKeyInfo): string {
  return apiKey.key || apiKey.token || '';
}

interface CliModelTestState {
  slots: Array<CliModelTestResult | null>;
  testedAt: number | null;
  codexDetail: CodexTestDetail | null;
  geminiDetail: GeminiTestDetail | null;
}

function createEmptyCliModelTestState(): Record<CliType, CliModelTestState> {
  const emptySlots = Array.from({ length: CLI_TEST_MODEL_SLOT_COUNT }, () => null);
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
  const slots = normalizeCliTestResults(config, CLI_TEST_MODEL_SLOT_COUNT);
  const testedRows = slots.filter(Boolean) as CliModelTestResult[];
  return {
    slots,
    testedAt: testedRows.length > 0 ? Math.max(...testedRows.map(row => row.timestamp)) : null,
    codexDetail: null,
    geminiDetail: null,
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
  // 根据内容行数计算高度，保持编辑和预览模式高度一致
  const lineCount = file.content.split('\n').length;
  const contentHeight = Math.max(lineCount * 1.5, 8); // 每行约 1.5rem，最小 8rem

  // 代码区域使用统一的深色背景和统一的文字颜色
  // 所有配置文件使用相同的亮色，确保一致性和高对比度
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
 * 统一 CLI 配置对话框
 */
export function UnifiedCliConfigDialog({
  isOpen,
  siteName,
  accountName,
  siteUrl,
  apiKeys,
  siteModels,
  currentConfig,
  codexDetail,
  geminiDetail,
  onPersistConfig,
  onClose,
  onSave,
}: UnifiedCliConfigDialogProps) {
  // CLI 启用状态
  const [enabledState, setEnabledState] = useState<Record<CliType, boolean>>({
    claudeCode: true,
    codex: true,
    geminiCli: true,
  });

  // 当前选中的 CLI 类型
  const [selectedCli, setSelectedCli] = useState<CliType | null>('claudeCode');

  // 每个 CLI 的配置状态
  const [cliConfigs, setCliConfigs] = useState<
    Record<
      CliType,
      {
        apiKeyId: number | null;
        model: string | null;
        testModels: string[];
        editedFiles: GeneratedConfig | null;
      }
    >
  >({
    claudeCode: {
      apiKeyId: null,
      model: null,
      testModels: toTestModelSlots(null),
      editedFiles: null,
    },
    codex: { apiKeyId: null, model: null, testModels: toTestModelSlots(null), editedFiles: null },
    geminiCli: {
      apiKeyId: null,
      model: null,
      testModels: toTestModelSlots(null),
      editedFiles: null,
    },
  });

  // 生成的配置内容（可编辑）- 用于保存编辑后的内容
  const [editedConfig, setEditedConfig] = useState<GeneratedConfig | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isTestingSelectedModels, setIsTestingSelectedModels] = useState(false);
  const [cliModelTests, setCliModelTests] = useState<Record<CliType, CliModelTestState>>(
    createEmptyCliModelTestState()
  );
  const previousOpenRef = useRef(false);
  const previousDialogKeyRef = useRef<string | null>(null);
  const [dialogViewportHeight, setDialogViewportHeight] = useState(() => getDialogViewportHeight());

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const syncDialogViewportHeight = () => {
      setDialogViewportHeight(getDialogViewportHeight());
    };

    syncDialogViewportHeight();
    window.addEventListener('resize', syncDialogViewportHeight);
    window.visualViewport?.addEventListener('resize', syncDialogViewportHeight);

    return () => {
      window.removeEventListener('resize', syncDialogViewportHeight);
      window.visualViewport?.removeEventListener('resize', syncDialogViewportHeight);
    };
  }, [isOpen]);

  // 初始化配置
  useEffect(() => {
    const dialogKey = `${siteUrl}::${accountName ?? ''}`;
    const shouldInitialize =
      isOpen && (!previousOpenRef.current || previousDialogKeyRef.current !== dialogKey);

    if (shouldInitialize && currentConfig) {
      // 初始化启用状态
      const newEnabledState: Record<CliType, boolean> = {
        claudeCode: currentConfig.claudeCode?.enabled ?? DEFAULT_CLI_CONFIG.claudeCode.enabled,
        codex: currentConfig.codex?.enabled ?? DEFAULT_CLI_CONFIG.codex.enabled,
        geminiCli: currentConfig.geminiCli?.enabled ?? DEFAULT_CLI_CONFIG.geminiCli.enabled,
      };
      setEnabledState(newEnabledState);

      // 初始化配置
      setCliConfigs({
        claudeCode: {
          apiKeyId: currentConfig.claudeCode?.apiKeyId ?? null,
          model: currentConfig.claudeCode?.model ?? null,
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
      // 重置为默认状态
      setEnabledState({
        claudeCode: DEFAULT_CLI_CONFIG.claudeCode.enabled,
        codex: DEFAULT_CLI_CONFIG.codex.enabled,
        geminiCli: DEFAULT_CLI_CONFIG.geminiCli.enabled,
      });
      setCliConfigs({
        claudeCode: {
          apiKeyId: null,
          model: null,
          testModels: toTestModelSlots(null),
          editedFiles: null,
        },
        codex: {
          apiKeyId: null,
          model: null,
          testModels: toTestModelSlots(null),
          editedFiles: null,
        },
        geminiCli: {
          apiKeyId: null,
          model: null,
          testModels: toTestModelSlots(null),
          editedFiles: null,
        },
      });
      setCliModelTests(createEmptyCliModelTestState());
    }

    if (shouldInitialize) {
      setSelectedCli('claudeCode');
      setEditedConfig(null);
      setCopiedPath(null);
      setIsEditing(false);
      setShowResetConfirm(false);
      setIsTestingSelectedModels(false);
    }

    previousOpenRef.current = isOpen;
    previousDialogKeyRef.current = isOpen ? dialogKey : null;
  }, [accountName, currentConfig, isOpen, siteUrl]);

  // 当 CLI 类型改变时，保存当前编辑的配置并重置编辑状态
  useEffect(() => {
    // 保存之前 CLI 的编辑配置（这里无法获取之前的 selectedCli，所以在切换前处理）
    setEditedConfig(null);
    setIsEditing(false);
  }, [selectedCli]);

  // 切换 CLI 类型前保存编辑的配置
  const handleCliTypeChange = (newCliType: CliType) => {
    // 如果当前有编辑过的配置，先保存
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
  };

  // 获取当前 CLI 类型配置
  const currentCliConfig = useMemo(() => {
    return CLI_TYPES.find(c => c.key === selectedCli);
  }, [selectedCli]);

  // 获取可用模型列表
  const availableModels = useMemo(() => {
    if (!selectedCli) return [];
    const config = cliConfigs[selectedCli];
    if (!config.apiKeyId) return [];
    return Array.from(
      new Set(siteModels.filter(model => typeof model === 'string' && model.trim()))
    );
  }, [selectedCli, cliConfigs, siteModels]);

  // 获取选中的 API Key 对象
  const selectedApiKey = useMemo(() => {
    if (!selectedCli) return null;
    const config = cliConfigs[selectedCli];
    if (!config.apiKeyId) return null;
    return apiKeys.find(k => getApiKeyId(k) === config.apiKeyId) || null;
  }, [apiKeys, selectedCli, cliConfigs]);

  const effectiveCodexDetail = cliModelTests.codex.codexDetail ?? codexDetail ?? undefined;
  const effectiveGeminiDetail = cliModelTests.geminiCli.geminiDetail ?? geminiDetail ?? undefined;

  // 实时生成配置预览
  const realtimeConfig = useMemo(() => {
    if (!selectedCli || !selectedApiKey) return null;
    const config = cliConfigs[selectedCli];
    if (!config.model) return null;

    const params = {
      siteUrl,
      siteName,
      apiKey: getApiKeyValue(selectedApiKey),
      model: config.model,
    };

    if (selectedCli === 'claudeCode') {
      return generateClaudeCodeConfig(params);
    } else if (selectedCli === 'codex') {
      return generateCodexConfig({ ...params, codexDetail: effectiveCodexDetail });
    } else if (selectedCli === 'geminiCli') {
      return generateGeminiCliConfig({ ...params, geminiDetail: effectiveGeminiDetail });
    }
    return null;
  }, [
    selectedCli,
    selectedApiKey,
    cliConfigs,
    siteUrl,
    siteName,
    effectiveCodexDetail,
    effectiveGeminiDetail,
  ]);

  // 配置模板（未选择 API Key 和 model 时显示）
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

  // 当前显示的配置（优先级：编辑中的内容 > 已保存的编辑内容 > 实时生成的内容 > 模板）
  const savedEditedConfig = selectedCli ? cliConfigs[selectedCli]?.editedFiles : null;
  const displayConfig =
    isEditing && editedConfig
      ? editedConfig
      : savedEditedConfig || realtimeConfig || templateConfig;

  // 是否显示模板（未选择完整配置时）
  const isShowingTemplate = !realtimeConfig && !savedEditedConfig && !!templateConfig;

  // 切换 CLI 启用状态
  const handleToggleEnabled = (cliType: CliType) => {
    setEnabledState(prev => ({
      ...prev,
      [cliType]: !prev[cliType],
    }));
  };

  // 处理 API Key 选择变化
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
    // API Key 变化时重置编辑状态
    setEditedConfig(null);
    setIsEditing(false);
    setCliModelTests(prev => ({
      ...prev,
      [selectedCli]: createEmptyCliModelTestState()[selectedCli],
    }));
  };

  // 处理 CLI 模型选择变化
  const handleModelChange = (model: string | null) => {
    if (!selectedCli) return;
    setCliConfigs(prev => ({
      ...prev,
      [selectedCli]: { ...prev[selectedCli], model, editedFiles: null },
    }));
    // 模型变化时重置编辑状态
    setEditedConfig(null);
    setIsEditing(false);
  };

  // 处理测试模型选择变化
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

  // 复制配置内容
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
    const baseConfig = editedConfig || realtimeConfig;
    if (!baseConfig) return;
    setEditedConfig({
      files: baseConfig.files.map(file =>
        file.path === path ? { ...file, content: newContent } : file
      ),
    });
  };

  // 切换编辑/预览模式
  const toggleEditMode = () => {
    if (!isEditing) {
      // 进入编辑模式时，优先使用已保存的编辑配置，否则使用实时生成的配置
      const configToEdit = savedEditedConfig || realtimeConfig;
      if (configToEdit) {
        setEditedConfig(configToEdit);
      }
    }
    setIsEditing(!isEditing);
  };

  // 重置配置为默认值
  const handleResetConfig = () => {
    setEditedConfig(null);
    setIsEditing(false);
    if (selectedCli) {
      setCliConfigs(prev => ({
        ...prev,
        [selectedCli]: { ...prev[selectedCli], editedFiles: null },
      }));
    }
    setShowResetConfirm(false);
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
    let latestCodexDetail: CodexTestDetail | null = null;
    let latestGeminiDetail: GeminiTestDetail | null = null;
    let nextCliTestState = resetCliTestState;

    for (const { slotIndex: targetSlotIndex, model } of modelEntries) {
      let rowResult: CliModelTestResult;

      try {
        const response = await (window.electronAPI as any).cliCompat.testWithConfig({
          siteUrl,
          configs: [
            {
              cliType: selectedCli,
              apiKey: resolvedApiKey,
              model,
              baseUrl: siteUrl,
            },
          ],
        });

        const success = response.success === true && response.data?.[selectedCli] === true;
        latestTestedAt = Date.now();
        if (response.data?.codexDetail) latestCodexDetail = response.data.codexDetail;
        if (response.data?.geminiDetail) latestGeminiDetail = response.data.geminiDetail;
        if (!success) failedCount += 1;

        rowResult = {
          model,
          success,
          message: success ? undefined : (response.error ?? '测试失败'),
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
    if (failedCount === 0) {
      toast.success(`${CLI_TYPES.find(cli => cli.key === selectedCli)?.name ?? 'CLI'} 测试通过`);
    } else {
      toast.warning(
        `${CLI_TYPES.find(cli => cli.key === selectedCli)?.name ?? 'CLI'} 有 ${failedCount} 个测试模型未通过`
      );
    }
  };

  // 保存配置
  const handleSave = () => {
    // 如果当前 CLI 有编辑过的配置，先保存到 cliConfigs
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
  const dialogStyle = useMemo<CSSProperties | undefined>(() => {
    if (dialogViewportHeight <= 0) {
      return undefined;
    }

    const maxHeight = Math.max(dialogViewportHeight - CLI_DIALOG_VIEWPORT_MARGIN, 0);
    const preferredHeight = Math.min(
      dialogViewportHeight * CLI_DIALOG_HEIGHT_RATIO,
      CLI_DIALOG_MAX_HEIGHT,
      maxHeight
    );

    return {
      height: `${Math.floor(preferredHeight)}px`,
      maxHeight: `${Math.floor(maxHeight)}px`,
    };
  }, [dialogViewportHeight]);

  return (
    <OverlayDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={`CLI 配置 - ${siteName}${accountName ? ` / ${accountName}` : ''}`}
      titleIcon={<Settings className="w-5 h-5" />}
      placement="center"
      className="overflow-hidden"
      style={dialogStyle}
      widthClassName="max-w-[920px]"
      contentClassName="!p-0 flex-1 min-h-0"
      footer={
        <>
          <AppButton variant="tertiary" onClick={onClose}>
            取消
          </AppButton>
          <AppButton variant="primary" onClick={handleSave}>
            保存配置
          </AppButton>
        </>
      }
    >
      <div className="h-full min-h-0 space-y-4 overflow-y-auto px-6 py-4">
        <div className="grid grid-cols-3 gap-3">
          {CLI_TYPES.map(cli => (
            <div
              key={cli.key}
              className={`flex items-center gap-3 rounded-[var(--radius-md)] border px-4 py-2 transition-all ${
                selectedCli === cli.key
                  ? 'border-[var(--accent)] bg-[var(--accent-soft-strong)] shadow-sm ring-1 ring-[var(--accent)]/30'
                  : 'border-[var(--line-soft)] bg-[var(--surface-1)] hover:border-[var(--text-tertiary)]'
              }`}
            >
              <button
                type="button"
                onClick={() => handleCliTypeChange(cli.key)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <img src={cli.icon} alt={cli.name} className="h-5 w-5 shrink-0" />
                <span
                  className={`truncate text-sm ${
                    selectedCli === cli.key
                      ? 'font-medium text-[var(--accent)]'
                      : 'text-[var(--text-primary)]'
                  }`}
                >
                  {cli.name}
                </span>
              </button>
              <FormSwitch
                checked={enabledState[cli.key]}
                onChange={() => handleToggleEnabled(cli.key)}
              />
            </div>
          ))}
        </div>

        {/* API Key 和模型选择 - 仅支持的 CLI 显示 */}
        {selectedCli && currentCliConfig?.supported && (
          <>
            {/* API Key 选择 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                选择 API Key
              </label>
              {apiKeys.length === 0 ? (
                <div className="py-2 text-sm text-[var(--text-secondary)]">
                  该站点没有可用的 API Key
                </div>
              ) : (
                <select
                  value={cliConfigs[selectedCli]?.apiKeyId ?? ''}
                  onChange={e =>
                    handleApiKeyChange(e.target.value ? parseInt(e.target.value, 10) : null)
                  }
                  className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="">请选择 API Key</option>
                  {apiKeys.map(apiKey => {
                    const id = getApiKeyId(apiKey);
                    const modelCount = siteModels.length;
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

            {/* 模型选择 - 分为测试模型和 CLI 模型 */}
            {cliConfigs[selectedCli]?.apiKeyId && (
              <div className="grid grid-cols-2 gap-4">
                {/* 测试使用模型 */}
                <div>
                  <div className="mb-2 flex min-h-9 items-center justify-between gap-3">
                    <label className="block text-sm font-medium text-[var(--text-primary)]">
                      测试使用模型
                    </label>
                    <AppButton
                      variant="tertiary"
                      onClick={() => {
                        void handleTestSelectedModels();
                      }}
                      disabled={isTestingSelectedModels}
                    >
                      {isTestingSelectedModels ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      测试已选模型
                    </AppButton>
                  </div>
                  {availableModels.length > 0 ? (
                    <div className="space-y-2">
                      {cliConfigs[selectedCli]?.testModels.map((selectedModel, index) => (
                        <div key={index} className="flex items-center gap-3">
                          <SearchableModelSelector
                            models={availableModels.filter(model => {
                              const selectedModels = cliConfigs[selectedCli]?.testModels || [];
                              return model === selectedModel || !selectedModels.includes(model);
                            })}
                            selectedModel={selectedModel || null}
                            onSelect={model => handleTestModelChange(index, model)}
                            placeholder={`请选择测试模型 ${index + 1}`}
                            ariaLabel={`测试模型 ${index + 1}`}
                          />
                          {selectedCliTestState?.slots[index] ? (
                            <span
                              className={`shrink-0 text-xs font-medium ${
                                selectedCliTestState.slots[index]?.success
                                  ? 'text-[var(--success)]'
                                  : 'text-[var(--danger)]'
                              }`}
                            >
                              {selectedCliTestState.slots[index]?.success ? '成功' : '失败'}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-2 text-sm text-[var(--text-secondary)]">没有可用模型</div>
                  )}
                </div>
                {/* CLI 使用模型 */}
                <div>
                  <div className="mb-2 flex min-h-9 items-center justify-between gap-3">
                    <label className="block text-sm font-medium text-[var(--text-primary)]">
                      CLI 使用模型
                    </label>
                  </div>
                  {availableModels.length > 0 ? (
                    <SearchableModelSelector
                      models={availableModels}
                      selectedModel={cliConfigs[selectedCli]?.model ?? null}
                      onSelect={model => handleModelChange(model)}
                      placeholder="请选择 CLI 模型"
                      ariaLabel="CLI 使用模型"
                    />
                  ) : (
                    <div className="py-2 text-sm text-[var(--text-secondary)]">没有可用模型</div>
                  )}
                </div>
              </div>
            )}

            {/* 配置预览区域 - 始终显示，实时更新 */}
            {(selectedCli === 'claudeCode' ||
              selectedCli === 'codex' ||
              selectedCli === 'geminiCli') && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    配置文件预览
                    {isShowingTemplate && (
                      <span className="ml-2 text-xs text-[var(--warning)]">(模板)</span>
                    )}
                  </div>
                  {displayConfig && !isShowingTemplate && (
                    <div className="flex items-center gap-2">
                      {/* 重置按钮 - 仅在有编辑内容时显示 */}
                      {(editedConfig || savedEditedConfig) && (
                        <button
                          onClick={() => setShowResetConfirm(true)}
                          className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--warning)]/50 px-3 py-1.5 text-xs text-[var(--warning)] transition-all hover:bg-[var(--warning)]/10 active:scale-95"
                          title="重置为默认配置"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>重置</span>
                        </button>
                      )}
                      <button
                        onClick={toggleEditMode}
                        className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--line-soft)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-all hover:bg-[var(--surface-2)] active:scale-95"
                        title={isEditing ? '切换到预览模式' : '切换到编辑模式'}
                      >
                        {isEditing ? (
                          <>
                            <Eye className="w-3.5 h-3.5" />
                            <span>预览</span>
                          </>
                        ) : (
                          <>
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>编辑</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
                {/* 配置确认提醒 - 对所有 CLI 类型显示 */}
                <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-3 py-2">
                  <span className="text-[var(--warning)]">⚠️</span>
                  <span className="text-xs text-[var(--warning)]">
                    请去站点确认配置信息是否正确
                  </span>
                </div>
                {isShowingTemplate && (
                  <div className="rounded-[var(--radius-md)] bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--warning)]">
                    请选择 API Key 和 CLI 使用模型以生成实际配置，以下为配置模板
                  </div>
                )}
                {isEditing && (
                  <div className="text-xs text-[var(--text-secondary)]">
                    提示：您可以直接编辑配置内容，修改后点击复制按钮复制最终配置
                  </div>
                )}
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
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={showResetConfirm}
        type="warning"
        title="确认重置"
        message="确定要重置为默认配置吗？您的编辑内容将会丢失。"
        confirmText="确认重置"
        cancelText="取消"
        onConfirm={handleResetConfig}
        onCancel={() => setShowResetConfirm(false)}
        overlayZIndexClassName="z-[220]"
      />
    </OverlayDrawer>
  );
}
