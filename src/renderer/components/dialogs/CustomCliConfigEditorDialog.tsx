/**
 * @file src/renderer/components/dialogs/CustomCliConfigEditorDialog.tsx
 * @description 自定义 CLI 配置编辑器对话框
 *
 * 输入: CustomCliConfigEditorDialogProps (配置对象、回调)
 * 输出: React 组件 (自定义 CLI 配置编辑 UI)
 * 定位: 展示层 - 编辑自定义 CLI 配置，每个 CLI 独立选择模型，配置预览、应用配置
 */

import { useState, useEffect, useMemo, useRef } from 'react';
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
import { IOSModal } from '../IOSModal';
import { IOSButton } from '../IOSButton';
import { useCustomCliConfigStore } from '../../store/customCliConfigStore';
import { toast } from '../../store/toastStore';
import type { CustomCliConfig, CustomCliSettings } from '../../../shared/types/custom-cli-config';
import { CLI_TEST_MODEL_SLOT_COUNT, sanitizeCliTestModels } from '../../../shared/types/cli-config';
import {
  generateClaudeCodeConfig,
  generateCodexConfig,
  generateGeminiCliConfig,
  type GeneratedConfig,
} from '../../services/cli-config-generator';

// 导入 CLI 图标
import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../assets/cli-icons/gemini.svg';

export interface CustomCliConfigEditorDialogProps {
  isOpen: boolean;
  config: CustomCliConfig;
  onClose: () => void;
}

type CliType = 'claudeCode' | 'codex' | 'geminiCli';

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

type CliTestOutcome = {
  model: string;
  success: boolean;
  message?: string;
  timestamp: number;
};

type TestSummaries = Record<CliType, CliTestOutcome[]>;

const createInitialTestSummaries = (): TestSummaries => ({
  claudeCode: [],
  codex: [],
  geminiCli: [],
});

const createInitialEditedConfigs = (
  config: CustomCliConfig
): Record<CliType, GeneratedConfig | null> => {
  const initialEdited: Record<CliType, GeneratedConfig | null> = {
    claudeCode: null,
    codex: null,
    geminiCli: null,
  };

  for (const key of ['claudeCode', 'codex', 'geminiCli'] as CliType[]) {
    const saved = config.cliSettings[key]?.editedFiles;
    if (saved && saved.length > 0) {
      initialEdited[key] = { files: saved.map(file => ({ ...file, language: 'json' as const })) };
    }
  }

  return initialEdited;
};

const normalizeCliSetting = (setting: CustomCliSettings): CustomCliSettings => ({
  ...setting,
  testModels: setting.testModels ?? [],
});

const normalizeCliSettings = (
  settings: CustomCliConfig['cliSettings']
): CustomCliConfig['cliSettings'] => ({
  claudeCode: normalizeCliSetting(settings.claudeCode),
  codex: normalizeCliSetting(settings.codex),
  geminiCli: normalizeCliSetting(settings.geminiCli),
});

/** iOS 风格 Toggle Switch 组件 */
function IOSToggle({
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
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ios-blue)]
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${
          checked
            ? 'bg-[var(--ios-blue)] border-[var(--ios-blue)]'
            : 'bg-[var(--ios-separator)] border-[var(--ios-separator)]'
        }
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-[18px] w-[18px] rounded-full
          bg-white shadow-md ring-0
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

  const codeBlockBg = 'bg-[#1e1e1e]';
  const codeTextColor = 'text-[#d4d4d4]';

  return (
    <div className="border border-[var(--ios-separator)] rounded-[var(--radius-md)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--ios-bg-tertiary)] border-b border-[var(--ios-separator)]">
        <code className="text-sm font-mono text-[var(--ios-text-primary)]">{file.path}</code>
        <button
          onClick={() => onCopy(file.path, file.content)}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] hover:bg-[var(--ios-bg-secondary)] active:scale-95 transition-all"
        >
          {isCopied ? (
            <>
              <Check className="w-3.5 h-3.5 text-[var(--ios-green)]" />
              <span className="text-[var(--ios-green)]">已复制</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-[var(--ios-text-secondary)]" />
              <span className="text-[var(--ios-text-secondary)]">复制</span>
            </>
          )}
        </button>
      </div>
      {isEditing ? (
        <textarea
          value={file.content}
          onChange={e => onContentChange(file.path, e.target.value)}
          className={`w-full p-3 text-sm font-mono ${codeBlockBg} ${codeTextColor} border-none resize-none focus:outline-none focus:ring-2 focus:ring-[var(--ios-blue)]`}
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
  placeholder = '选择模型',
  allowClear = false,
  ariaLabel,
}: {
  models: string[];
  selectedModel: string | null;
  onSelect: (model: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  allowClear?: boolean;
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

  return (
    <div className="flex-1 relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen(!open)}
        className={`w-full flex items-center justify-between px-2.5 py-1.5 bg-[var(--ios-bg-secondary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-xs transition-all ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-[var(--ios-gray)]'
        }`}
      >
        <span
          className={`truncate ${selectedModel ? 'text-[var(--ios-text-primary)]' : 'text-[var(--ios-text-tertiary)]'}`}
        >
          {selectedModel || placeholder}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 ml-1 text-[var(--ios-text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-[var(--ios-bg-primary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] shadow-lg overflow-hidden">
          <div className="p-1.5 border-b border-[var(--ios-separator)]">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--ios-text-tertiary)]" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="搜索模型..."
                className="w-full pl-7 pr-7 py-1 bg-[var(--ios-bg-secondary)] border border-[var(--ios-separator)] rounded-[var(--radius-sm)] text-xs text-[var(--ios-text-primary)] focus:ring-1 focus:ring-[var(--ios-blue)] focus:border-transparent"
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                >
                  <X className="w-3.5 h-3.5 text-[var(--ios-text-tertiary)] hover:text-[var(--ios-text-secondary)]" />
                </button>
              )}
            </div>
          </div>
          <div className="max-h-40 overflow-y-auto">
            {allowClear && selectedModel && (
              <button
                type="button"
                onClick={() => {
                  onSelect(null);
                  setOpen(false);
                  setQuery('');
                }}
                className="w-full px-3 py-1.5 text-left text-xs text-[var(--ios-text-secondary)] hover:bg-[var(--ios-bg-secondary)] transition-colors border-b border-[var(--ios-separator)]"
              >
                清空选择
              </button>
            )}
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
                      ? 'bg-[var(--ios-blue)]/10 text-[var(--ios-blue)]'
                      : 'text-[var(--ios-text-primary)] hover:bg-[var(--ios-bg-secondary)]'
                  }`}
                >
                  {model}
                </button>
              ))
            ) : (
              <div className="px-3 py-3 text-xs text-[var(--ios-text-secondary)] text-center">
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
 * 自定义 CLI 配置编辑器对话框
 */
export function CustomCliConfigEditorDialog({
  isOpen,
  config,
  onClose,
}: CustomCliConfigEditorDialogProps) {
  const { updateConfig, saveConfigs, fetchModels, fetchingModels } = useCustomCliConfigStore();

  // 本地编辑状态
  const [name, setName] = useState(config.name);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [notes, setNotes] = useState(config.notes || '');
  const [cliSettings, setCliSettings] = useState<CustomCliConfig['cliSettings']>(() =>
    normalizeCliSettings(config.cliSettings)
  );
  const [selectedCli, setSelectedCli] = useState<CliType>('claudeCode');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // 编辑模式状态
  const [editedConfig, setEditedConfig] = useState<GeneratedConfig | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // 每个 CLI 的编辑配置缓存（切换 CLI 时保留）
  const [perCliEdited, setPerCliEdited] = useState<Record<CliType, GeneratedConfig | null>>(() =>
    createInitialEditedConfigs(config)
  );
  const [testSummaries, setTestSummaries] = useState<TestSummaries>(createInitialTestSummaries);
  const [testingCli, setTestingCli] = useState<CliType | null>(null);
  const [applyingCli, setApplyingCli] = useState<CliType | null>(null);
  const hasMountedRef = useRef(false);

  // 获取当前配置的模型列表 (从 store 中实时获取以反映拉取结果)
  const { configs } = useCustomCliConfigStore();
  const currentConfig = configs.find(c => c.id === config.id);
  const models = currentConfig?.models || config.models;

  // 重置状态
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (isOpen) {
      setName(config.name);
      setBaseUrl(config.baseUrl);
      setApiKey(config.apiKey);
      setNotes(config.notes || '');
      setCliSettings(normalizeCliSettings(config.cliSettings));
      setSelectedCli('claudeCode');
      setCopiedPath(null);
      setTestSummaries(createInitialTestSummaries());
      setTestingCli(null);
      setApplyingCli(null);
      setEditedConfig(null);
      setIsEditing(false);
      setShowResetConfirm(false);
      setPerCliEdited(createInitialEditedConfigs(config));
    }
  }, [isOpen, config]);

  const generateConfigForCli = (cliType: CliType): GeneratedConfig | null => {
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
  };

  const getEffectiveConfigForCli = (cliType: CliType): GeneratedConfig | null => {
    if (selectedCli === cliType && editedConfig) {
      return editedConfig;
    }
    return perCliEdited[cliType] || generateConfigForCli(cliType);
  };

  // 生成配置预览 — 使用当前选中 CLI 的独立模型
  const configPreview = generateConfigForCli(selectedCli);

  // 处理 CLI 设置变更
  const handleCliSettingChange = (cliType: CliType, update: Partial<CustomCliSettings>) => {
    setCliSettings(prev => ({
      ...prev,
      [cliType]: { ...prev[cliType], ...update },
    }));
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
      .slice(0, CLI_TEST_MODEL_SLOT_COUNT);
  };

  const recordTestResult = (cliType: CliType, summary: CliTestOutcome) => {
    setTestSummaries(prev => ({
      ...prev,
      [cliType]: [summary, ...prev[cliType]].slice(0, CLI_TEST_MODEL_SLOT_COUNT),
    }));
  };

  const getErrorMessage = (error: unknown) => {
    if (error instanceof Error) {
      return error.message;
    }
    return undefined;
  };

  const handleTestModelSlotChange = (cliType: CliType, index: number, model: string | null) => {
    setCliSettings(prev => {
      const current = prev[cliType];
      const nextModels = [...getTestModelsForSetting(current)];
      nextModels[index] = model;
      const normalized = sanitizeCliTestModels(nextModels, CLI_TEST_MODEL_SLOT_COUNT).filter(
        (item, itemIndex, array) => array.indexOf(item) === itemIndex
      );
      return {
        ...prev,
        [cliType]: {
          ...current,
          testModels: normalized,
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
      toast.error('请启用 CLI 并添加测试模型');
      return;
    }

    setTestingCli(cliType);
    let hadError = false;
    try {
      for (const model of cliTestTargets) {
        try {
          const response = await window.electronAPI.cliCompat.testWithConfig({
            siteUrl: baseUrl,
            configs: [
              {
                cliType,
                apiKey,
                model,
                baseUrl,
              },
            ],
          });
          const success = response.success && response.data?.[cliType] === true;
          const message = success ? undefined : (response.error ?? '未通过');
          recordTestResult(cliType, {
            model,
            success,
            message,
            timestamp: Date.now(),
          });
          if (!success) {
            hadError = true;
          }
        } catch (error: unknown) {
          hadError = true;
          recordTestResult(cliType, {
            model,
            success: false,
            message: getErrorMessage(error),
            timestamp: Date.now(),
          });
        }
      }
    } finally {
      setTestingCli(null);
    }

    if (hadError) {
      toast.error('部分测试未通过，请查看结果');
    } else {
      toast.success('CLI 测试已完成');
    }
  };

  // 处理拉取模型
  const handleFetchModels = async () => {
    updateConfig(config.id, { baseUrl, apiKey });
    await fetchModels(config.id);
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

  const handleApplyCliConfig = async (cliType: CliType) => {
    const setting = cliSettings[cliType];
    if (!setting.enabled || !setting.model) {
      toast.error('该 CLI 未启用或未选择模型');
      return;
    }
    const configToApply = getEffectiveConfigForCli(cliType);
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
        toast.error(`写入失败: ${result.error || '未知错误'}`);
      }
    } catch (error: unknown) {
      toast.error(`应用配置失败: ${getErrorMessage(error) || '未知错误'}`);
    } finally {
      setApplyingCli(null);
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
    const savedEdited = perCliEdited[selectedCli];
    const configToEdit = savedEdited || configPreview;
    if (configToEdit) {
      setEditedConfig(configToEdit);
    }
    setIsEditing(true);
  };

  // 保存编辑内容（编辑模式下的保存按钮）
  const handleSaveEdit = () => {
    if (editedConfig) {
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
    setPerCliEdited(prev => ({ ...prev, [selectedCli]: null }));
    setShowResetConfirm(false);
  };

  // 切换 CLI 类型时保存当前编辑
  const handleCliTypeChange = (newCli: CliType) => {
    if (editedConfig) {
      setPerCliEdited(prev => ({ ...prev, [selectedCli]: editedConfig }));
    }
    setSelectedCli(newCli);
    setEditedConfig(null);
    setIsEditing(false);
  };

  // 当前显示的配置（优先级：编辑中 > 已保存编辑 > 自动生成）
  const savedEditedConfig = perCliEdited[selectedCli];
  const displayConfig =
    isEditing && editedConfig ? editedConfig : savedEditedConfig || configPreview;
  const selectedCliMeta = CLI_TYPES.find(cli => cli.key === selectedCli) ?? CLI_TYPES[0];
  const getOutcomeForModel = (cliType: CliType, model: string | null) => {
    if (!model) return undefined;
    return testSummaries[cliType].find(summary => summary.model === model);
  };

  // 保存配置 — 每个 CLI 保留各自的模型和编辑内容
  const handleSave = async () => {
    // 如果当前 CLI 有编辑中的配置，先合并到 perCliEdited
    const finalPerCliEdited = { ...perCliEdited };
    if (editedConfig) {
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
      cliSettings: finalCliSettings,
    });
    await saveConfigs();
    onClose();
  };

  const isFetching = fetchingModels[config.id] || false;

  return (
    <IOSModal
      isOpen={isOpen}
      onClose={onClose}
      title={config.name ? `编辑: ${config.name}` : '新建自定义配置'}
      titleIcon={<Settings className="w-5 h-5" />}
      size="xl"
      contentClassName="!p-0 !max-h-[70vh]"
      footer={
        <>
          <IOSButton variant="tertiary" onClick={onClose}>
            取消
          </IOSButton>
          <IOSButton variant="primary" onClick={handleSave}>
            保存配置
          </IOSButton>
        </>
      }
    >
      <div className="px-6 py-4 space-y-4 overflow-y-auto">
        {/* 基本信息 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-2">
              配置名称
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如: 我的 API"
              className="w-full px-3 py-2 bg-[var(--ios-bg-secondary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-primary)] focus:ring-2 focus:ring-[var(--ios-blue)] focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-2">
              <Globe className="w-4 h-4 inline mr-1" />
              Base URL
            </label>
            <input
              type="url"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com"
              className="w-full px-3 py-2 bg-[var(--ios-bg-secondary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-primary)] focus:ring-2 focus:ring-[var(--ios-blue)] focus:border-transparent transition-all"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-2">
              <Key className="w-4 h-4 inline mr-1" />
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 bg-[var(--ios-bg-secondary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-primary)] focus:ring-2 focus:ring-[var(--ios-blue)] focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-2">
              可用模型{' '}
              <span className="text-[var(--ios-text-secondary)] font-normal">
                ({models.length}个)
              </span>
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 bg-[var(--ios-bg-secondary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-secondary)]">
                {models.length > 0 ? `已拉取 ${models.length} 个模型` : '尚未拉取模型'}
              </div>
              <IOSButton
                variant="secondary"
                size="sm"
                onClick={handleFetchModels}
                disabled={isFetching || !baseUrl || !apiKey}
              >
                {isFetching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                拉取
              </IOSButton>
            </div>
          </div>
        </div>

        {/* 备注 */}
        <div>
          <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-2">
            备注信息
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="在此添加备注信息（可选）..."
            rows={2}
            className="w-full px-3 py-2 bg-[var(--ios-bg-secondary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-primary)] focus:ring-2 focus:ring-[var(--ios-blue)] focus:border-transparent transition-all resize-none"
          />
        </div>

        {/* CLI 配置 */}
        <div>
          <label className="block text-sm font-semibold text-[var(--ios-text-primary)] mb-2">
            CLI 配置
          </label>
          <div className="space-y-3">
            {CLI_TYPES.map(cli => {
              const setting = cliSettings[cli.key];
              return (
                <div
                  key={cli.key}
                  className={`grid grid-cols-1 lg:grid-cols-[minmax(0,180px)_auto_minmax(0,1fr)_auto_auto] gap-3 items-center px-4 py-3 rounded-[var(--radius-md)] border transition-colors ${
                    setting.enabled
                      ? 'border-[var(--ios-blue)]/30 bg-[var(--ios-blue)]/5'
                      : 'border-[var(--ios-separator)] bg-[var(--ios-bg-tertiary)]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <img src={cli.icon} alt={cli.name} className="w-4 h-4 shrink-0" />
                    <span className="text-sm text-[var(--ios-text-primary)] truncate">
                      {cli.name}
                    </span>
                  </div>
                  <IOSToggle
                    checked={setting.enabled}
                    onChange={checked => handleCliSettingChange(cli.key, { enabled: checked })}
                  />
                  <CliModelSelector
                    models={models}
                    selectedModel={setting.model}
                    onSelect={model => handleCliSettingChange(cli.key, { model })}
                    disabled={!setting.enabled}
                    ariaLabel={`${cli.name} 主模型`}
                  />
                  <IOSButton
                    variant="secondary"
                    size="sm"
                    aria-label={`预览 ${cli.name}`}
                    onClick={() => handleCliTypeChange(cli.key)}
                  >
                    预览
                  </IOSButton>
                  <IOSButton
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
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      '应用'
                    )}
                  </IOSButton>
                </div>
              );
            })}
          </div>
        </div>

        {/* CLI 预览 */}
        <div>
          <label className="block text-sm font-semibold text-[var(--ios-text-primary)] mb-2">
            配置预览
          </label>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-md)] border border-[var(--ios-blue)]/30 bg-[var(--ios-blue)]/10">
              <img src={selectedCliMeta.icon} alt={selectedCliMeta.name} className="w-4 h-4" />
              <span className="text-sm text-[var(--ios-text-primary)]">{selectedCliMeta.name}</span>
            </div>
            <span className="text-xs text-[var(--ios-text-secondary)]">
              点击上方对应 CLI 的“预览”可切换当前配置预览
            </span>
          </div>

          {/* 配置预览内容 */}
          {displayConfig ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-[var(--ios-text-primary)]">
                  配置文件预览
                </div>
                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <>
                      {/* 编辑模式：保存和取消按钮 */}
                      <button
                        onClick={handleCancelEdit}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--ios-separator)] text-[var(--ios-text-secondary)] hover:bg-[var(--ios-bg-tertiary)] active:scale-95 transition-all"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>取消</span>
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--ios-blue)] bg-[var(--ios-blue)]/10 text-[var(--ios-blue)] hover:bg-[var(--ios-blue)]/20 active:scale-95 transition-all"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>保存</span>
                      </button>
                    </>
                  ) : (
                    <>
                      {/* 预览模式：重置按钮（仅有已保存编辑时显示）+ 编辑按钮 */}
                      {savedEditedConfig && (
                        <button
                          onClick={() => setShowResetConfirm(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--ios-orange)]/50 text-[var(--ios-orange)] hover:bg-[var(--ios-orange)]/10 active:scale-95 transition-all"
                          title="重置为默认配置"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>重置</span>
                        </button>
                      )}
                      <button
                        onClick={toggleEditMode}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--ios-separator)] text-[var(--ios-text-secondary)] hover:bg-[var(--ios-bg-tertiary)] active:scale-95 transition-all"
                        title="切换到编辑模式"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>编辑</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
              {isEditing && (
                <div className="text-xs text-[var(--ios-text-secondary)]">
                  提示：您可以直接编辑配置内容，修改后会随配置一起保存
                </div>
              )}
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
          ) : (
            <div className="px-3 py-4 text-sm text-[var(--ios-text-secondary)] text-center bg-[var(--ios-bg-tertiary)] rounded-[var(--radius-md)] border border-[var(--ios-separator)]">
              {!cliSettings[selectedCli]?.model
                ? '请为当前 CLI 选择模型以预览配置'
                : '请填写 Base URL 和 API Key'}
            </div>
          )}
        </div>
      </div>

      {/* 重置确认对话框 */}
      {showResetConfirm && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center rounded-[var(--radius-xl)]">
          <div className="bg-[var(--ios-bg-secondary)] rounded-[var(--radius-lg)] shadow-[var(--shadow-xl)] p-5 mx-4 max-w-sm">
            <h3 className="text-base font-medium text-[var(--ios-text-primary)] mb-2">确认重置</h3>
            <p className="text-sm text-[var(--ios-text-secondary)] mb-4">
              确定要重置为默认配置吗？您的编辑内容将会丢失。
            </p>
            <div className="flex justify-end gap-2">
              <IOSButton size="sm" variant="tertiary" onClick={() => setShowResetConfirm(false)}>
                取消
              </IOSButton>
              <IOSButton
                size="sm"
                variant="primary"
                onClick={handleResetConfig}
                className="bg-[var(--ios-orange)] hover:bg-[var(--ios-orange)]/90"
              >
                确认重置
              </IOSButton>
            </div>
          </div>
        </div>
      )}

      {/* CLI 测试 */}
      <div className="space-y-2">
        <div>
          <p className="text-sm font-semibold text-[var(--ios-text-primary)]">CLI 测试</p>
          <p className="text-xs text-[var(--ios-text-secondary)]">
            每个 CLI 最多选择 3 个测试模型，点击列标题后的“测试”只会测试当前列。
          </p>
        </div>
        <div
          data-testid="cli-test-columns"
          className="grid grid-cols-1 md:grid-cols-3 md:divide-x divide-[var(--ios-separator)] text-xs"
        >
          {CLI_TYPES.map(cli => {
            const setting = cliSettings[cli.key];
            const summaries = testSummaries[cli.key];
            const latest = summaries[0];
            const selectedTestModels = getTestModelsForSetting(setting);
            const canRunCliTests =
              Boolean(baseUrl && apiKey) && setting.enabled && selectedTestModels.length > 0;
            return (
              <div key={`${cli.key}-test`} className="space-y-3 px-4 py-3 first:pl-0 last:pr-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <img src={cli.icon} alt={cli.name} className="w-4 h-4 shrink-0" />
                    <span className="text-sm text-[var(--ios-text-primary)] truncate">
                      {cli.name}
                    </span>
                  </div>
                  <IOSButton
                    variant="secondary"
                    size="sm"
                    aria-label={`测试 ${cli.name}`}
                    onClick={() => handleRunCliTests(cli.key)}
                    disabled={!canRunCliTests || testingCli !== null}
                  >
                    {testingCli === cli.key ? <Loader2 className="w-4 h-4 animate-spin" /> : '测试'}
                  </IOSButton>
                </div>
                <div className="text-[0.65rem] text-[var(--ios-text-secondary)]">
                  {setting.enabled ? '测试模型槽位' : '当前 CLI 未启用'}
                </div>
                <div className="space-y-2">
                  {Array.from({ length: CLI_TEST_MODEL_SLOT_COUNT }, (_, index) => {
                    const model = selectedTestModels[index] ?? null;
                    const outcome = getOutcomeForModel(cli.key, model);
                    return (
                      <div
                        key={`${cli.key}-slot-${index}`}
                        className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center"
                      >
                        <CliModelSelector
                          models={models}
                          selectedModel={model}
                          onSelect={nextModel =>
                            handleTestModelSlotChange(cli.key, index, nextModel)
                          }
                          disabled={!setting.enabled || models.length === 0}
                          placeholder={`测试模型 ${index + 1}`}
                          allowClear
                          ariaLabel={`${cli.name} 测试模型 ${index + 1}`}
                        />
                        <span
                          className={`px-2 py-1 rounded-[var(--radius-sm)] border text-[0.65rem] ${
                            outcome
                              ? outcome.success
                                ? 'border-[var(--ios-blue)] bg-[var(--ios-blue)]/10 text-[var(--ios-blue)]'
                                : 'border-red-200 bg-red-50 text-red-600'
                              : 'border-[var(--ios-separator)] bg-[var(--ios-bg-tertiary)] text-[var(--ios-text-secondary)]'
                          }`}
                          title={outcome?.message}
                        >
                          {outcome ? (outcome.success ? '通过' : '失败') : model ? '未测' : '未选'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="text-[0.65rem] text-[var(--ios-text-secondary)]">
                  最近结果：
                  <span className="ml-1">
                    {latest ? new Date(latest.timestamp).toLocaleTimeString() : '未测试'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </IOSModal>
  );
}
