/**
 * @file src/renderer/components/dialogs/DirectCliConfigEditorContent.tsx
 * @description 直连配置 CLI 编辑器内容组件（无 OverlayDrawer 外壳）
 *
 * 输入: DirectCliConfigEditorContentProps (配置对象、保存/取消回调)
 * 输出: React 内容组件 (身份信息、模型拉取、按 CLI 聚合的配置/测试/预览/应用)
 * 定位: 展示层 - 嵌入接入点详情面板，维护直连配置且不创建嵌套抽屉
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Copy,
  Check,
  RefreshCw,
  Loader2,
  Key,
  Globe,
  Settings,
  ChevronDown,
  Search,
  X,
  Edit2,
  RotateCcw,
} from 'lucide-react';
import { AppButton } from '../AppButton/AppButton';
import { useCustomCliConfigStore } from '../../store/customCliConfigStore';
import { toast } from '../../store/toastStore';
import {
  createEmptyCustomCliTestState,
  normalizeCustomCliTestState,
  type CustomCliConfig,
  type CustomCliSettings,
  type CustomCliTestState,
} from '../../../shared/types/custom-cli-config';
import {
  CLI_TARGET_PROTOCOLS,
  getCliTargetEndpoint,
  normalizeCliTargetProtocol,
  type CliTargetProtocol,
} from '../../../shared/types/cli-config';
import {
  generateClaudeCodeConfig,
  generateCodexConfig,
  generateGeminiCliConfig,
  type GeneratedConfig,
} from '../../services/cli-config-generator';
import { PanelSection } from './PanelSection';

// 导入 CLI 图标
import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../assets/cli-icons/gemini.svg';

export interface DirectCliConfigEditorContentProps {
  config: CustomCliConfig;
  section?: 'all' | 'identity' | 'models' | 'cli';
  showHeader?: boolean;
  showSaveAction?: boolean;
  showModelSummary?: boolean;
  identityFormId?: string;
  onSaved?: () => void | Promise<void>;
  onCancel?: () => void;
  showDialog?: (options: {
    type?: 'confirm' | 'warning';
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
  }) => Promise<boolean>;
}

type CliType = 'claudeCode' | 'codex' | 'geminiCli';

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
  { key: 'claudeCode', name: 'Claude Code', icon: ClaudeCodeIcon },
  { key: 'codex', name: 'Codex', icon: CodexIcon },
  { key: 'geminiCli', name: 'Gemini CLI', icon: GeminiIcon },
];

const CLI_TARGET_PROTOCOL_LABELS: Record<CliTargetProtocol, string> = {
  native: '原生协议',
  'anthropic-messages': 'Anthropic Messages',
  'openai-chat-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
};

const PANEL_TEST_MODEL_LIMIT = 1;

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

const normalizeCliSetting = (setting: CustomCliSettings): CustomCliSettings => ({
  ...setting,
  testModels: setting.testModels ?? [],
  testState: normalizeCustomCliTestState(setting.testState),
});

const normalizeCliSettings = (
  settings: CustomCliConfig['cliSettings']
): CustomCliConfig['cliSettings'] => ({
  claudeCode: normalizeCliSetting(settings.claudeCode),
  codex: normalizeCliSetting(settings.codex),
  geminiCli: normalizeCliSetting(settings.geminiCli),
});

function buildPerCliEditedFromSettings(
  cliSettings: CustomCliConfig['cliSettings']
): Record<CliType, GeneratedConfig | null> {
  const initEdited: Record<CliType, GeneratedConfig | null> = {
    claudeCode: null,
    codex: null,
    geminiCli: null,
  };

  for (const key of ['claudeCode', 'codex', 'geminiCli'] as CliType[]) {
    const saved = cliSettings[key]?.editedFiles;
    if (saved && saved.length > 0) {
      initEdited[key] = { files: saved.map(f => ({ ...f, language: 'json' as const })) };
    }
  }

  return initEdited;
}

/** 中性风格 Toggle Switch 组件 */
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
            : 'bg-[var(--line-soft)] border-[var(--line-soft)]'
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
        <div className="absolute z-50 w-full mt-1 bg-[var(--surface-1)] border border-[var(--line-soft)] rounded-[var(--radius-md)] shadow-lg overflow-hidden">
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
  showDialog,
}: DirectCliConfigEditorContentProps) {
  const { updateConfig, saveConfigs, fetchModels, fetchingModels } = useCustomCliConfigStore();

  // 本地编辑状态
  const [name, setName] = useState(config.name);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [notes, setNotes] = useState(config.notes || '');
  const [manualModels, setManualModels] = useState<string[]>(config.manualModels || []);
  const [manualModelInput, setManualModelInput] = useState('');
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
    geminiCli: null,
  });
  const [testingCli, setTestingCli] = useState<CliType | null>(null);
  const [applyingCli, setApplyingCli] = useState<CliType | null>(null);

  // 获取当前配置的模型列表 (从 store 中实时获取以反映拉取结果)
  const { configs } = useCustomCliConfigStore();
  const currentConfig = configs.find(c => c.id === config.id);
  const models = currentConfig?.models || config.models;
  const modelOptions = useMemo(
    () =>
      getModelInputOptions({
        ...(currentConfig ?? config),
        models,
        manualModels,
      }),
    [config, currentConfig, manualModels, models]
  );

  // 重置状态
  useEffect(() => {
    setName(config.name);
    setBaseUrl(config.baseUrl);
    setApiKey(config.apiKey);
    setNotes(config.notes || '');
    setManualModels(config.manualModels || []);
    setManualModelInput('');
    setCliSettings(normalizeCliSettings(config.cliSettings));
    setSelectedCli(null);
    setCopiedPath(null);
    setTestingCli(null);
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
      } else if (cliType === 'geminiCli') {
        return generateGeminiCliConfig(params);
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

  const getTestModelsForSetting = (setting: CustomCliSettings) => {
    const candidates =
      setting.testModels && setting.testModels.length > 0
        ? setting.testModels
        : setting.model
          ? [setting.model]
          : [];
    return candidates
      .map(m => m.trim())
      .filter(Boolean)
      .slice(0, PANEL_TEST_MODEL_LIMIT);
  };

  const handleAddTestModel = (cliType: CliType, model: string) => {
    const nextModel = model.trim();
    if (!nextModel) return;
    setManualModels(prev => mergeManualModelName(prev, models, nextModel));

    setCliSettings(prev => {
      const current = prev[cliType];
      return {
        ...prev,
        [cliType]: {
          ...current,
          testModels: [nextModel],
        },
      };
    });
  };

  const handleRunCliTests = async (cliType: CliType) => {
    if (!baseUrl || !apiKey) {
      toast.error('请先填写 Base URL 和 API Key');
      return;
    }

    const setting = cliSettings[cliType];
    if (!setting.enabled) {
      toast.error('请先启用该 CLI');
      return;
    }

    const cliTestTargets = getTestModelsForSetting(setting);
    if (cliTestTargets.length === 0) {
      toast.error('请启用 CLI 并选择测试模型');
      return;
    }

    setTestingCli(cliType);
    const slots = createEmptyCustomCliTestState().slots;
    let allSuccess = cliTestTargets.length > 0;
    let testedAt: number | null = null;
    let claudeDetail: CustomCliTestState['claudeDetail'];
    let codexDetail: CustomCliTestState['codexDetail'];
    let geminiDetail: CustomCliTestState['geminiDetail'];
    try {
      for (const [index, model] of cliTestTargets.entries()) {
        try {
          const response = await window.electronAPI.cliCompat.testWithWrapper({
            siteUrl: baseUrl,
            configs: [
              {
                cliType,
                apiKey,
                model,
                baseUrl,
                targetProtocol: normalizeCliTargetProtocol(setting.targetProtocol),
              },
            ],
          });
          const success = response.success && response.data?.[cliType] === true;
          testedAt = Date.now();
          slots[index] = {
            model,
            success,
            message: success ? undefined : (getCliFailureMessage(cliType, response) ?? '未通过'),
            timestamp: testedAt,
          };
          if (!success) allSuccess = false;
          if (response.data?.claudeDetail) claudeDetail = response.data.claudeDetail;
          if (response.data?.codexDetail) codexDetail = response.data.codexDetail;
          if (response.data?.geminiDetail) geminiDetail = response.data.geminiDetail;
        } catch (error) {
          testedAt = Date.now();
          slots[index] = {
            model,
            success: false,
            message: getErrorMessage(error, '测试失败'),
            timestamp: testedAt,
          };
          allSuccess = false;
        }
      }

      const nextTestState: CustomCliTestState = {
        status: cliTestTargets.length > 0 ? allSuccess : null,
        testedAt,
        claudeDetail,
        codexDetail,
        geminiDetail,
        slots,
      };
      const nextCliSettings = {
        ...(currentConfig?.cliSettings ?? config.cliSettings),
        [cliType]: {
          ...(currentConfig?.cliSettings?.[cliType] ?? config.cliSettings[cliType]),
          ...cliSettings[cliType],
          testState: nextTestState,
        },
      };
      setCliSettings(prev => ({
        ...prev,
        [cliType]: {
          ...prev[cliType],
          testState: nextTestState,
        },
      }));
      updateConfig(config.id, { cliSettings: nextCliSettings });
      await saveConfigs();
    } finally {
      setTestingCli(null);
    }

    if (allSuccess) {
      toast.success('CLI 测试已完成');
    } else {
      toast.error('部分测试未通过，请查看结果');
    }
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
    updateConfig(config.id, { baseUrl, apiKey });
    await fetchModels(config.id);
    const latestConfig = useCustomCliConfigStore
      .getState()
      .configs.find(candidate => candidate.id === config.id);
    if (latestConfig) {
      const nextCliSettings = normalizeCliSettings(latestConfig.cliSettings);
      setManualModels(latestConfig.manualModels || []);
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
      for (const key of ['claudeCode', 'codex', 'geminiCli'] as CliType[]) {
        const current = next[key];
        next[key] = {
          ...current,
          model: current.model === model ? null : current.model,
          testModels: (current.testModels ?? []).filter(testModel => testModel !== model),
          testState: current.model === model ? null : current.testState,
        };
      }
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
    for (const key of ['claudeCode', 'codex', 'geminiCli'] as CliType[]) {
      const edited = finalPerCliEdited[key];
      finalCliSettings[key] = {
        ...finalCliSettings[key],
        testModels: finalCliSettings[key].testModels ?? [],
        editedFiles: edited ? edited.files.map(f => ({ path: f.path, content: f.content })) : null,
      };
    }

    updateConfig(config.id, {
      name,
      baseUrl,
      apiKey,
      notes,
      manualModels,
      cliSettings: finalCliSettings,
    });
    await saveConfigs();
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
    !shouldShowHeader && showSaveAction && section !== 'cli' && section !== 'identity';

  return (
    <div className="space-y-4">
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
            {showSaveAction ? (
              <AppButton variant="primary" size="sm" onClick={handleSave}>
                保存配置
              </AppButton>
            ) : null}
          </div>
        </div>
      ) : null}

      {shouldShowStandaloneSaveAction ? (
        <div className="flex justify-end">
          <AppButton variant="primary" size="sm" onClick={handleSave}>
            保存配置
          </AppButton>
        </div>
      ) : null}

      <div className="space-y-4">
        {/* 基本信息 */}
        {showIdentitySection ? (
          <form
            id={identityFormId}
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                  配置名称
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="例如: 我的 API"
                  className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                  <Globe className="mr-1 inline h-4 w-4" />
                  Base URL
                </label>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                  <Key className="mr-1 inline h-4 w-4" />
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              {showModelSummary ? (
                <div>
                  <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                    模型概况
                  </label>
                  <div className="rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                    已拉取 {models.length} 个模型，手动模型 {manualModels.length} 个
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                备注信息
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="在此添加备注信息（可选）..."
                rows={3}
                className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
          </form>
        ) : null}

        {showModelsSection ? (
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                可用模型{' '}
                <span className="font-normal text-[var(--text-secondary)]">
                  ({models.length}个)
                </span>
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                  {models.length > 0 ? `已拉取 ${models.length} 个模型` : '尚未拉取模型'}
                </div>
                <AppButton
                  variant="secondary"
                  size="sm"
                  onClick={handleFetchModels}
                  disabled={isFetching || !baseUrl || !apiKey}
                >
                  {isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  拉取
                </AppButton>
              </div>
              {models.length > 0 ? (
                <div className="mt-3 grid max-h-[280px] grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2">
                  {models.map(model => (
                    <div
                      key={model}
                      className="truncate rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-primary)]"
                      title={model}
                    >
                      {model}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                手动模型
              </label>
              <div className="flex items-center gap-2">
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
                  className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-all focus:border-transparent focus:ring-2 focus:ring-[var(--accent)]"
                />
                <AppButton variant="secondary" size="sm" onClick={handleAddManualModel}>
                  添加模型
                </AppButton>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {manualModels.length > 0 ? (
                  manualModels.map(model => (
                    <span
                      key={model}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 py-0.5 text-xs text-[var(--text-primary)]"
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
          </div>
        ) : null}

        {/* CLI 配置与测试：按 CLI 聚合配置、测试模型、结果和操作 */}
        {showCliSection ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                CLI 配置（{CLI_TYPES.filter(cli => cliSettings[cli.key].enabled).length}/
                {CLI_TYPES.length}）
              </div>
              {showSaveAction && section === 'cli' ? (
                <AppButton variant="primary" size="sm" onClick={handleSave}>
                  保存配置
                </AppButton>
              ) : null}
            </div>

            <div className="space-y-2">
              {CLI_TYPES.map(cli => {
                const setting = cliSettings[cli.key];
                const explicitTestModels = setting.testModels ?? [];
                const selectedTestModels = getTestModelsForSetting(setting);
                const summaries = normalizeCustomCliTestState(setting.testState).slots.filter(
                  Boolean
                );
                const selectedTestModel = explicitTestModels[0] ?? null;
                const selectedTestOutcome = selectedTestModel
                  ? summaries.find(summary => summary?.model === selectedTestModel)
                  : undefined;
                const canRunCliTests =
                  Boolean(baseUrl && apiKey) && setting.enabled && selectedTestModels.length > 0;
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
                      setting.enabled ? (
                        setting.model ? (
                          <span className="truncate">{setting.model}</span>
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
                        />
                      </>
                    }
                  >
                    {isOpen ? (
                      <div className="space-y-3">
                        <div className="space-y-3">
                          <div className="text-xs font-medium text-[var(--text-secondary)]">
                            连接配置
                          </div>

                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                                className={`w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm transition-all disabled:opacity-50 focus:border-transparent focus:ring-2 focus:ring-[var(--accent)] ${
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
                          </div>
                        </div>

                        <div className="space-y-2 border-t border-[var(--line-soft)] pt-3">
                          <div className="flex items-center justify-between gap-2">
                            <label className="block text-xs font-medium text-[var(--text-secondary)]">
                              测试模型
                            </label>
                            <AppButton
                              variant="tertiary"
                              size="sm"
                              aria-label={`测试 ${cli.name}`}
                              onClick={() => handleRunCliTests(cli.key)}
                              disabled={!canRunCliTests || testingCli !== null}
                            >
                              {testingCli === cli.key ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : null}
                              测试已选模型
                            </AppButton>
                          </div>
                          {modelOptions.length > 0 ? (
                            <div className="flex items-start gap-2">
                              <CliModelSelector
                                models={modelOptions}
                                selectedModel={selectedTestModel}
                                onSelect={model => {
                                  if (model) {
                                    handleAddTestModel(cli.key, model);
                                  }
                                }}
                                disabled={!setting.enabled}
                                ariaLabel={`${cli.name} 测试模型`}
                              />
                              {selectedTestOutcome ? (
                                <div className="min-w-[4rem] shrink-0 pt-2 text-right">
                                  <span
                                    className={`text-xs font-medium ${
                                      selectedTestOutcome.success
                                        ? 'text-[var(--success)]'
                                        : 'text-[var(--danger)]'
                                    }`}
                                  >
                                    {selectedTestOutcome.success ? '成功' : '失败'}
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

                        <div className="space-y-3 border-t border-[var(--line-soft)] pt-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-medium text-[var(--text-secondary)]">
                              配置文件预览
                            </div>
                            {displayConfig ? (
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
                          {displayConfig ? (
                            <div className="space-y-3">
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
                            <div className="px-3 py-4 text-center text-sm text-[var(--text-secondary)]">
                              {!setting.model
                                ? '请为当前 CLI 选择模型以预览配置'
                                : '请填写 Base URL 和 API Key'}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
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
